'use strict';
/**
 * Entrada genérica de leads (site, formulários, conectores intermediários) e de eventos de mensagens (WhatsApp).
 * Todos os eventos são guardados com o ID externo para evitar duplicidade e permitir reprocessamento.
 */
const { requireManager, loadContact, audit, paging } = require('../core');
const { badRequest, notFound, clean, normalizePhone, normalizeEmail, nowIso } = require('../util');
const { tx } = require('../db');
const { insertActivity, optouts } = require('./activities');
const { mapPayload, logEvent, getIntegration } = require('./integrations');
const { findDuplicates, createContact, insertOrigin } = require('./contacts');
const { findByPhone, flexibleIso } = require('./dialer');

const SYSTEM_USER = { id: null, role: 'admin', name: 'Integração' };

function saveEvent(db, key, externalId, payload, status, extra = {}) {
  const now = nowIso();
  const existing = extra.eventId ? { id: extra.eventId } : externalId ? db.prepare('SELECT id FROM inbound_events WHERE integration = ? AND external_id = ?').get(key, externalId) : null;
  if (existing) {
    db.prepare('UPDATE inbound_events SET payload = ?, status = ?, contact_id = ?, error_message = ?, attempts = attempts + 1, processed_at = ? WHERE id = ?').run(
      JSON.stringify(payload), status, extra.contact_id ?? null, extra.error ?? null, now, existing.id,
    );
    return existing.id;
  }
  const r = db
    .prepare('INSERT INTO inbound_events (integration, external_id, payload, status, contact_id, error_message, received_at, processed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(key, externalId ?? null, JSON.stringify(payload), status, extra.contact_id ?? null, extra.error ?? null, now, now);
  return Number(r.lastInsertRowid);
}

/* ------------------------- Leads ------------------------- */

function processLead(db, integ, payload, { eventId } = {}) {
  const m = mapPayload(payload, integ.mapping);
  const platform = clean(m.platform) || 'api';
  const externalId = m.external_id != null ? String(m.external_id) : null;
  if (externalId && !eventId) {
    const prev = db.prepare("SELECT id, status FROM inbound_events WHERE integration = 'api_leads' AND external_id = ?").get(`${platform}:${externalId}`);
    if (prev && prev.status === 'processado') return { status: 'duplicado', message: 'Lead já recebido anteriormente.' };
    const origin = db.prepare('SELECT contact_id FROM contact_origins WHERE platform = ? AND platform_lead_id = ?').get(platform, externalId);
    if (origin) return { status: 'duplicado', message: 'Lead já existe no CRM (mesmo ID da plataforma).' };
  }
  const key = externalId ? `${platform}:${externalId}` : null;
  const phoneNorm = m.phone ? normalizePhone(m.phone) : null;
  const email = normalizeEmail(m.email);
  if (!clean(m.name) && !phoneNorm && !email) {
    const id = saveEvent(db, 'api_leads', key, payload, 'erro', { error: 'Lead sem nome, telefone ou e-mail válidos.', eventId });
    return { status: 'erro', event_id: id, message: 'Lead sem nome, telefone ou e-mail válidos.' };
  }
  let originValue = clean(m.origin) || (platform === 'meta_ads' ? 'meta_ads' : 'site');
  if (!db.prepare("SELECT 1 FROM options WHERE list = 'origem' AND value = ?").get(originValue)) originValue = 'outra';
  const originDetails = {
    origin: originValue,
    campaign_name: m.campaign_name,
    platform,
    platform_lead_id: externalId,
    campaign_id: m.campaign_id,
    adset_id: m.adset_id,
    ad_id: m.ad_id,
    received_at: flexibleIso(m.received_at) || nowIso(),
    utm_source: m.utm_source,
    utm_medium: m.utm_medium,
    utm_campaign: m.utm_campaign,
    utm_content: m.utm_content,
    utm_term: m.utm_term,
    source_ref: 'api_leads',
  };
  const dups = findDuplicates(db, { phones: [phoneNorm], email });
  if (dups.length > 1) {
    const id = saveEvent(db, 'api_leads', key, payload, 'sem_vinculo', { error: `Dados coincidem com ${dups.length} cadastros (${dups.map((d) => d.code).join(', ')}). Revise.`, eventId });
    return { status: 'sem_vinculo', event_id: id, message: 'Mais de um cadastro corresponde ao lead.' };
  }
  if (dups.length === 1) {
    const c = dups[0];
    insertOrigin(db, SYSTEM_USER, c.id, originDetails);
    insertActivity(db, {
      contact_id: c.id,
      type: 'cadastro',
      notes: `Novo contato recebido via ${platform}${m.campaign_name ? ` (campanha: ${m.campaign_name})` : ''}. Cadastro já existente — nenhuma duplicata criada.${m.notes ? `\n${m.notes}` : ''}`,
      source: 'api_leads',
    });
    const id = saveEvent(db, 'api_leads', key, payload, 'processado', { contact_id: c.id, eventId });
    return { status: 'existente', event_id: id, contact_code: c.code };
  }
  const isPJ = String(m.kind || '').toUpperCase() === 'PJ';
  const res = createContact(
    db,
    SYSTEM_USER,
    {
      kind: isPJ ? 'PJ' : 'PF',
      name: clean(m.name) || clean(m.company) || 'Lead sem nome',
      trade_name: isPJ ? clean(m.company) : null,
      phone1: m.phone,
      email: m.email,
      city: m.city,
      state: m.state,
      origin: originValue,
      campaign: m.campaign_name,
      initial_notes: m.notes,
      relationship: 'lead',
      owner_id: integ.config.default_owner_id || null,
      origin_details: originDetails,
      create_opportunity: true,
    },
    { system: true, skipDuplicateCheck: true, source: 'api_leads', sourceLabel: `via ${platform}` },
  );
  const id = saveEvent(db, 'api_leads', key, payload, 'processado', { contact_id: res.id, eventId });
  // Sem responsável definido: entra na fila de distribuição (ou na roleta automática, se estiver ligada)
  if (!integ.config.default_owner_id) require('./distribution').autoDistribute(db, res.id);
  return { status: 'criado', event_id: id, contact_code: res.code };
}

function receiveLeads(db, integ, body) {
  const items = Array.isArray(body) ? body : Array.isArray(body?.leads) ? body.leads : [body];
  if (items.length > 500) throw badRequest('Envie no máximo 500 leads por requisição.');
  return items.map((p) => {
    try {
      const r = tx(db, () => processLead(db, integ, p));
      logEvent(db, 'api_leads', 'lead', p?.[integ.mapping.external_id] ?? null, r.status === 'erro' ? 'erro' : r.status === 'duplicado' ? 'duplicado' : r.status === 'sem_vinculo' ? 'sem_vinculo' : 'sucesso', r.message || r.contact_code, null);
      return r;
    } catch (e) {
      const ext = p?.[integ.mapping.external_id];
      const platform = p?.[integ.mapping.platform] || 'api';
      const id = saveEvent(db, 'api_leads', ext ? `${platform}:${ext}` : null, p, 'erro', { error: e.message });
      logEvent(db, 'api_leads', 'lead', ext ?? null, 'erro', e.message, p);
      return { status: 'erro', event_id: id, message: e.message };
    }
  });
}

/* ------------------------- WhatsApp ------------------------- */

function processMessage(db, integ, payload, forcedContact) {
  const m = mapPayload(payload, integ.mapping);
  const externalId = m.external_id != null ? String(m.external_id) : null;
  if (!externalId) {
    const id = saveEvent(db, 'whatsapp', null, payload, 'erro', { error: 'ID da mensagem ausente (necessário para evitar duplicidade).' });
    return { status: 'erro', event_id: id, message: 'ID da mensagem ausente.' };
  }
  if (!forcedContact && db.prepare("SELECT 1 FROM activities WHERE source = 'whatsapp' AND external_id = ?").get(externalId)) {
    return { status: 'duplicado', message: 'Mensagem já registrada.' };
  }
  const phoneNorm = m.phone ? normalizePhone(m.phone) : null;
  let contactId = forcedContact?.id;
  let ccId = null;
  if (!contactId) {
    const cands = findByPhone(db, phoneNorm);
    if (cands.length !== 1) {
      const msg = cands.length ? `Telefone corresponde a ${cands.length} cadastros.` : 'Nenhum cadastro com este telefone.';
      const id = saveEvent(db, 'whatsapp', externalId, payload, 'sem_vinculo', { error: msg });
      return { status: 'sem_vinculo', event_id: id, message: msg };
    }
    contactId = cands[0].id;
    ccId = cands[0].company_contact_id;
  }
  const dir = String(m.direction || '').toLowerCase();
  const outbound = ['saida', 'saída', 'out', 'outbound', 'enviada', 'sent'].some((x) => dir.includes(x));
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId);
  const notes = [];
  notes.push(integ.config.store_message_text && m.text ? String(m.text).slice(0, 4000) : '[conteúdo da mensagem não armazenado]');
  if (m.message_type) notes.push(`Tipo: ${m.message_type}`);
  const o = optouts(contact);
  if (outbound && (o.includes('todos') || o.includes('whatsapp'))) notes.push('ATENÇÃO: este cadastro registrou oposição a contatos por WhatsApp.');
  const occurred = flexibleIso(m.occurred_at) || nowIso();
  insertActivity(db, {
    contact_id: contactId,
    company_contact_id: ccId,
    type: outbound ? 'mensagem_enviada' : 'mensagem_recebida',
    channel: 'whatsapp',
    direction: outbound ? 'saida' : 'entrada',
    notes: notes.join('\n'),
    occurred_at: occurred,
    source: 'whatsapp',
    external_id: externalId,
  });
  const id = saveEvent(db, 'whatsapp', externalId, payload, 'processado', { contact_id: contactId });
  return { status: 'registrado', event_id: id, contact_code: contact.code };
}

function receiveMessages(db, integ, body) {
  const items = Array.isArray(body) ? body : Array.isArray(body?.mensagens) ? body.mensagens : [body];
  if (items.length > 500) throw badRequest('Envie no máximo 500 mensagens por requisição.');
  return items.map((p) => {
    try {
      const r = tx(db, () => processMessage(db, integ, p));
      logEvent(db, 'whatsapp', 'mensagem', p?.[integ.mapping.external_id] ?? null, r.status === 'registrado' ? 'sucesso' : r.status, r.message || r.contact_code, null);
      return r;
    } catch (e) {
      logEvent(db, 'whatsapp', 'mensagem', p?.[integ.mapping.external_id] ?? null, 'erro', e.message, p);
      return { status: 'erro', message: e.message };
    }
  });
}

/* ------------------------- Fila de revisão ------------------------- */

function listInbound(db, user, q) {
  requireManager(user);
  const where = ['1=1'];
  const params = [];
  if (q.integration) {
    where.push('e.integration = ?');
    params.push(q.integration);
  }
  if (q.status) {
    where.push('e.status = ?');
    params.push(q.status);
  }
  const { limit, offset, page } = paging(q);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM inbound_events e WHERE ${where.join(' AND ')}`).get(...params).n;
  const rows = db
    .prepare(`SELECT e.*, c.code AS contact_code, c.name AS contact_name FROM inbound_events e LEFT JOIN contacts c ON c.id = e.contact_id WHERE ${where.join(' AND ')} ORDER BY e.id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  return { total, page, limit, rows };
}

function reprocessInbound(db, user, id, contactId) {
  requireManager(user);
  const ev = db.prepare('SELECT * FROM inbound_events WHERE id = ?').get(Number(id));
  if (!ev) throw notFound('Evento não encontrado.');
  if (ev.status === 'processado') throw badRequest('Evento já processado.');
  const integ = getIntegration(db, ev.integration);
  const payload = JSON.parse(ev.payload || '{}');
  return tx(db, () => {
    let r;
    if (ev.integration === 'whatsapp') {
      const forced = contactId ? loadContact(db, user, contactId, { write: true }) : null;
      r = processMessage(db, integ, payload, forced);
    } else if (contactId) {
      const c = loadContact(db, user, contactId, { write: true });
      const m = mapPayload(payload, integ.mapping);
      insertOrigin(db, user, c.id, {
        origin: m.origin, campaign_name: m.campaign_name, platform: m.platform, platform_lead_id: m.external_id,
        campaign_id: m.campaign_id, adset_id: m.adset_id, ad_id: m.ad_id, received_at: flexibleIso(m.received_at), source_ref: 'api_leads',
      });
      insertActivity(db, { contact_id: c.id, type: 'cadastro', notes: `Lead recebido via ${m.platform || 'API'} vinculado manualmente a este cadastro.`, user_id: user.id });
      db.prepare("UPDATE inbound_events SET status = 'processado', contact_id = ?, error_message = NULL, processed_at = ?, attempts = attempts + 1 WHERE id = ?").run(c.id, nowIso(), ev.id);
      r = { status: 'vinculado', contact_code: c.code };
    } else {
      r = processLead(db, integ, payload, { eventId: ev.id });
    }
    audit(db, user, 'inbound_event', ev.id, 'reprocessado', { resultado: r.status });
    return r;
  });
}

function discardInbound(db, user, id, reason) {
  requireManager(user);
  const ev = db.prepare('SELECT * FROM inbound_events WHERE id = ?').get(Number(id));
  if (!ev) throw notFound('Evento não encontrado.');
  if (ev.status === 'processado') throw badRequest('Evento já processado.');
  if (!clean(reason)) throw badRequest('Informe o motivo do descarte.');
  db.prepare("UPDATE inbound_events SET status = 'duplicado', error_message = ?, processed_at = ? WHERE id = ?").run(`Descartado: ${clean(reason)}`, nowIso(), ev.id);
  audit(db, user, 'inbound_event', ev.id, 'descartado', { motivo: clean(reason) });
}

module.exports = { receiveLeads, receiveMessages, listInbound, reprocessInbound, discardInbound };
