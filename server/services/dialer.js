'use strict';
/**
 * Recebimento de eventos da discadora.
 * - Idempotência pelo ID externo da chamada (o mesmo evento nunca gera duas atividades).
 * - Vínculo pelo ID do lead; na ausência, pelo telefone; sem correspondência única, vai para a fila "sem vínculo".
 * - O resultado nunca é presumido: sem informação, fica "não informado".
 */
const { NO_ANSWER_RESULTS } = require('../constants');
const { loadContact, requireManager, audit, paging } = require('../core');
const { badRequest, notFound, clean, normalizePhone, nowIso } = require('../util');
const { tx } = require('../db');
const { insertActivity, parseDuration, optouts } = require('./activities');
const { logEvent, mapPayload, getIntegration } = require('./integrations');

const PROVIDER = 'discadora';

function flexibleIso(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' || /^\d{9,13}$/.test(String(v))) {
    const n = Number(v);
    const d = new Date(n > 1e12 ? n : n * 1000);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  let s = String(v).trim();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T]?(\d{2}:\d{2}(?::\d{2})?)?$/);
  if (br) s = `${br[3]}-${br[2]}-${br[1]}T${br[4] || '00:00:00'}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function normalizeDirection(v) {
  if (!v) return null;
  const s = String(v).toLowerCase();
  if (['in', 'inbound', 'entrada', 'recebida', 'receptivo'].some((x) => s.includes(x))) return 'entrada';
  if (['out', 'outbound', 'saida', 'saída', 'realizada', 'ativo'].some((x) => s.includes(x))) return 'saida';
  return null;
}

function mapResult(db, integ, raw) {
  if (raw == null || raw === '') return 'nao_informado';
  const map = integ.config.result_map || {};
  const key = String(raw).trim();
  const found = Object.entries(map).find(([k]) => k.toLowerCase() === key.toLowerCase());
  if (found) return found[1];
  const opt = db.prepare("SELECT value FROM options WHERE list = 'resultado_ligacao' AND lower(value) = lower(?)").get(key);
  return opt ? opt.value : 'outro';
}

/** Converte o payload bruto nos campos do CRM, registrando problemas sem inventar valores. */
function mapEvent(db, integ, payload) {
  const m = mapPayload(payload, integ.mapping);
  const problems = [];
  const started = flexibleIso(m.started_at);
  const ended = flexibleIso(m.ended_at);
  if (started === undefined) problems.push(`Data de início inválida: "${m.started_at}"`);
  if (ended === undefined) problems.push(`Data de término inválida: "${m.ended_at}"`);
  let duration = null;
  if (m.duration_seconds != null) {
    try {
      duration = parseDuration(m.duration_seconds);
    } catch {
      problems.push(`Duração inválida: "${m.duration_seconds}"`);
    }
  } else if (started && ended) duration = Math.max(0, Math.round((Date.parse(ended) - Date.parse(started)) / 1000));
  const phone = m.phone != null ? String(m.phone) : null;
  return {
    external_call_id: m.external_call_id != null ? String(m.external_call_id) : null,
    lead_ref: m.lead_ref != null ? String(m.lead_ref) : null,
    phone,
    phone_norm: phone ? normalizePhone(phone) : null,
    started_at: started || null,
    ended_at: ended || null,
    duration_seconds: duration,
    agent_ref: m.agent_ref != null ? String(m.agent_ref) : null,
    technical_status: m.technical_status != null ? String(m.technical_status) : null,
    result_raw: m.result != null ? String(m.result) : null,
    result: mapResult(db, integ, m.result),
    classification: m.classification != null ? String(m.classification) : null,
    recording_url: integ.config.store_recording_url && m.recording_url ? String(m.recording_url) : null,
    direction: normalizeDirection(m.direction),
    call_origin: m.call_origin != null ? String(m.call_origin) : 'discadora',
    problems,
  };
}

function findByRef(db, ref) {
  if (!ref) return null;
  let c = db.prepare('SELECT * FROM contacts WHERE code = ? OR uid = ?').get(String(ref).toUpperCase(), String(ref));
  let guard = 0;
  while (c && c.merged_into_id && guard++ < 10) c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(c.merged_into_id);
  return c && !c.anonymized_at ? c : null;
}

function findByPhone(db, phoneNorm) {
  if (!phoneNorm) return [];
  const direct = db
    .prepare(
      `SELECT id, code, name, NULL AS company_contact_id FROM contacts WHERE merged_into_id IS NULL AND anonymized_at IS NULL
       AND (phone1_norm = ? OR phone2_norm = ? OR whatsapp_norm = ?)`,
    )
    .all(phoneNorm, phoneNorm, phoneNorm);
  const viaCompany = db
    .prepare(
      `SELECT c.id, c.code, c.name, cc.id AS company_contact_id FROM company_contacts cc JOIN contacts c ON c.id = cc.company_id
       WHERE cc.active = 1 AND c.merged_into_id IS NULL AND (cc.phone_norm = ? OR cc.whatsapp_norm = ?)`,
    )
    .all(phoneNorm, phoneNorm);
  const all = [...direct];
  for (const v of viaCompany) if (!all.find((a) => a.id === v.id)) all.push(v);
  return all;
}

/** Tenta vincular o evento e gerar a atividade. Retorna o status final. */
function linkAndRecord(db, eventId, forced) {
  const ev = db.prepare('SELECT * FROM call_events WHERE id = ?').get(eventId);
  let contact = null;
  let companyContactId = null;
  const notes = [];
  if (forced) {
    contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(forced.contact_id);
    companyContactId = forced.company_contact_id || null;
    notes.push(`Vínculo manual por ${forced.user.name}.`);
  } else {
    contact = findByRef(db, ev.lead_ref);
    if (ev.lead_ref && !contact) notes.push(`ID de lead "${ev.lead_ref}" não encontrado no CRM.`);
    if (!contact) {
      const cands = findByPhone(db, ev.phone_norm);
      if (cands.length === 1) {
        contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(cands[0].id);
        companyContactId = cands[0].company_contact_id;
        notes.push('Vinculado automaticamente pelo telefone.');
      } else {
        const msg = !ev.phone_norm
          ? 'Evento sem ID de lead válido e sem telefone reconhecível.'
          : cands.length
            ? `Telefone corresponde a ${cands.length} cadastros. Confirme o vínculo manualmente.`
            : 'Nenhum cadastro encontrado para o ID do lead ou telefone.';
        db.prepare("UPDATE call_events SET status = 'sem_vinculo', error_message = ?, candidates = ?, processed_at = ? WHERE id = ?").run(
          [notes.join(' '), msg].filter(Boolean).join(' '),
          JSON.stringify(cands.map((c) => ({ id: c.id, code: c.code, name: c.name }))),
          nowIso(),
          ev.id,
        );
        return { status: 'sem_vinculo', event_id: ev.id, message: msg };
      }
    } else if (ev.phone_norm) {
      const cc = db.prepare('SELECT id FROM company_contacts WHERE company_id = ? AND (phone_norm = ? OR whatsapp_norm = ?)').get(contact.id, ev.phone_norm, ev.phone_norm);
      if (cc) companyContactId = cc.id;
    }
  }
  const agent = ev.agent_ref
    ? db.prepare('SELECT id, name FROM users WHERE lower(dialer_agent_ref) = lower(?) OR lower(email) = lower(?)').get(ev.agent_ref, ev.agent_ref)
    : null;
  if (ev.agent_ref && !agent) notes.push(`Agente "${ev.agent_ref}" não mapeado para um usuário do CRM.`);
  const opp = db
    .prepare("SELECT id FROM opportunities WHERE contact_id = ? AND status IN ('aberta','pausada') ORDER BY updated_at DESC LIMIT 1")
    .get(contact.id);
  const blocked = optouts(contact);
  if (ev.direction !== 'entrada' && (blocked.includes('todos') || blocked.includes('ligacao'))) {
    notes.push('ATENÇÃO: este cadastro registrou oposição a ligações. Revise a lista enviada à discadora.');
  }
  const type = ev.direction === 'entrada' ? 'ligacao_recebida' : NO_ANSWER_RESULTS.includes(ev.result) ? 'tentativa_sem_atendimento' : 'ligacao_realizada';
  const detail = [
    ev.classification && `Classificação: ${ev.classification}`,
    ev.technical_status && `Status técnico: ${ev.technical_status}`,
    ev.result === 'outro' && ev.result_raw && `Resultado informado pela discadora: "${ev.result_raw}"`,
    ev.phone && `Telefone: ${ev.phone}`,
    ...notes,
  ].filter(Boolean);
  const activityId = insertActivity(db, {
    contact_id: contact.id,
    company_contact_id: companyContactId,
    opportunity_id: opp?.id ?? null,
    type,
    channel: 'ligacao',
    direction: ev.direction || 'saida',
    result: ev.result,
    duration_seconds: ev.duration_seconds,
    notes: detail.join('\n'),
    occurred_at: ev.started_at || ev.received_at,
    source: 'discadora',
    external_id: ev.external_call_id,
    call_event_id: ev.id,
    user_id: agent?.id ?? null,
    created_by: forced ? forced.user.id : null,
  });
  db.prepare(
    "UPDATE call_events SET status = 'vinculado', contact_id = ?, user_id = ?, activity_id = ?, error_message = ?, candidates = NULL, processed_at = ? WHERE id = ?",
  ).run(contact.id, agent?.id ?? null, activityId, notes.length ? notes.join(' ') : null, nowIso(), ev.id);
  return { status: 'vinculado', event_id: ev.id, activity_id: activityId, contact_code: contact.code };
}

const EVENT_COLS = ['external_call_id', 'lead_ref', 'phone', 'phone_norm', 'started_at', 'ended_at', 'duration_seconds', 'agent_ref',
  'technical_status', 'result', 'result_raw', 'classification', 'recording_url', 'call_origin'];

function ingestOne(db, integ, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    logEvent(db, PROVIDER, 'chamada', null, 'erro', 'Evento não é um objeto JSON.', payload);
    return { status: 'erro', message: 'Evento não é um objeto JSON.' };
  }
  const ev = mapEvent(db, integ, payload);
  const raw = JSON.stringify(payload);
  const now = nowIso();
  return tx(db, () => {
    if (!ev.external_call_id) {
      const r = db
        .prepare("INSERT INTO call_events (provider, raw_payload, status, error_message, received_at, phone, phone_norm) VALUES (?, ?, 'erro', ?, ?, ?, ?)")
        .run(PROVIDER, raw, 'ID da chamada ausente. Verifique o mapeamento de campos (sem ele não é possível evitar duplicidade).', now, ev.phone, ev.phone_norm);
      logEvent(db, PROVIDER, 'chamada', null, 'erro', 'ID da chamada ausente.', payload);
      return { status: 'erro', event_id: Number(r.lastInsertRowid), message: 'ID da chamada ausente.' };
    }
    const existing = db.prepare('SELECT * FROM call_events WHERE provider = ? AND external_call_id = ?').get(PROVIDER, ev.external_call_id);
    if (existing && ['vinculado', 'descartado'].includes(existing.status)) {
      logEvent(db, PROVIDER, 'chamada', ev.external_call_id, 'duplicado', 'Evento já registrado; ignorado.', null);
      return { status: 'duplicado', event_id: existing.id, message: 'Evento já registrado anteriormente.' };
    }
    let id;
    if (existing) {
      id = existing.id;
      db.prepare(`UPDATE call_events SET ${EVENT_COLS.map((c) => `${c} = ?`).join(', ')}, raw_payload = ?, attempts = attempts + 1 WHERE id = ?`).run(
        ...EVENT_COLS.map((c) => ev[c] ?? null), raw, id,
      );
    } else {
      const r = db
        .prepare(`INSERT INTO call_events (provider, ${EVENT_COLS.join(', ')}, raw_payload, status, received_at) VALUES (?, ${EVENT_COLS.map(() => '?').join(', ')}, ?, 'erro', ?)`)
        .run(PROVIDER, ...EVENT_COLS.map((c) => ev[c] ?? null), raw, now);
      id = Number(r.lastInsertRowid);
    }
    if (ev.problems.length) {
      const msg = ev.problems.join('; ');
      db.prepare("UPDATE call_events SET status = 'erro', error_message = ?, processed_at = ? WHERE id = ?").run(msg, now, id);
      logEvent(db, PROVIDER, 'chamada', ev.external_call_id, 'erro', msg, payload);
      return { status: 'erro', event_id: id, message: msg };
    }
    const res = linkAndRecord(db, id);
    logEvent(db, PROVIDER, 'chamada', ev.external_call_id, res.status === 'vinculado' ? 'sucesso' : 'sem_vinculo', res.message || `Vinculado a ${res.contact_code}`, null);
    return res;
  });
}

function ingest(db, integ, body) {
  const events = Array.isArray(body) ? body : Array.isArray(body?.eventos) ? body.eventos : [body];
  if (events.length > 500) throw badRequest('Envie no máximo 500 eventos por requisição.');
  return events.map((p) => {
    try {
      return ingestOne(db, integ, p);
    } catch (e) {
      logEvent(db, PROVIDER, 'chamada', p?.[integ.mapping.external_call_id] ?? null, 'erro', e.message, p);
      return { status: 'erro', message: e.message };
    }
  });
}

/** Simula o processamento sem gravar nada (para conferir o mapeamento). */
function preview(db, user, payload) {
  requireManager(user);
  const integ = getIntegration(db, PROVIDER);
  const ev = mapEvent(db, integ, payload || {});
  const existing = ev.external_call_id ? db.prepare('SELECT id, status FROM call_events WHERE provider = ? AND external_call_id = ?').get(PROVIDER, ev.external_call_id) : null;
  const byRef = findByRef(db, ev.lead_ref);
  const byPhone = findByPhone(db, ev.phone_norm);
  return {
    mapped: ev,
    duplicate: existing || null,
    match: byRef ? { by: 'id_lead', code: byRef.code, name: byRef.name } : byPhone.length === 1 ? { by: 'telefone', code: byPhone[0].code, name: byPhone[0].name } : null,
    phone_candidates: byPhone.map((c) => ({ code: c.code, name: c.name })),
  };
}

function listEvents(db, user, q) {
  requireManager(user);
  const where = ['1=1'];
  const params = [];
  if (q.status) {
    where.push('e.status = ?');
    params.push(q.status);
  }
  if (q.q) {
    where.push('(e.external_call_id = ? OR e.phone_norm LIKE ? OR e.lead_ref = ?)');
    params.push(q.q, `%${String(q.q).replace(/\D/g, '') || q.q}%`, q.q);
  }
  const { limit, offset, page } = paging(q);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM call_events e WHERE ${where.join(' AND ')}`).get(...params).n;
  const rows = db
    .prepare(
      `SELECT e.id, e.external_call_id, e.lead_ref, e.phone, e.started_at, e.duration_seconds, e.agent_ref, e.result, e.result_raw,
        e.technical_status, e.status, e.error_message, e.candidates, e.attempts, e.received_at, e.processed_at, e.contact_id, e.raw_payload,
        c.name AS contact_name, c.code AS contact_code, u.name AS user_name
       FROM call_events e LEFT JOIN contacts c ON c.id = e.contact_id LEFT JOIN users u ON u.id = e.user_id
       WHERE ${where.join(' AND ')} ORDER BY e.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  rows.forEach((r) => (r.candidates = r.candidates ? JSON.parse(r.candidates) : []));
  const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM call_events GROUP BY status').all().map((r) => [r.status, r.n]));
  return { total, page, limit, rows, counts };
}

function loadEvent(db, id) {
  const ev = db.prepare('SELECT * FROM call_events WHERE id = ?').get(Number(id));
  if (!ev) throw notFound('Evento não encontrado.');
  return ev;
}

function linkManually(db, user, id, contactId, companyContactId) {
  requireManager(user);
  const ev = loadEvent(db, id);
  if (!['sem_vinculo', 'erro'].includes(ev.status)) throw badRequest('Apenas eventos sem vínculo ou com erro podem ser vinculados manualmente.');
  if (!ev.external_call_id) throw badRequest('Evento sem ID da chamada. Corrija o mapeamento e reprocesse.');
  const c = loadContact(db, user, contactId, { write: true });
  return tx(db, () => {
    const res = linkAndRecord(db, ev.id, { contact_id: c.id, company_contact_id: companyContactId ? Number(companyContactId) : null, user });
    logEvent(db, PROVIDER, 'vinculo_manual', ev.external_call_id, 'sucesso', `Vinculado manualmente a ${c.code} por ${user.name}`, null);
    audit(db, user, 'call_event', ev.id, 'vinculado_manual', { contato: c.code }, c.id);
    return res;
  });
}

function reprocess(db, user, id) {
  requireManager(user);
  const ev = loadEvent(db, id);
  if (!['sem_vinculo', 'erro'].includes(ev.status)) throw badRequest('Somente eventos sem vínculo ou com erro podem ser reprocessados.');
  const integ = getIntegration(db, PROVIDER);
  const payload = JSON.parse(ev.raw_payload || '{}');
  const mapped = mapEvent(db, integ, payload);
  return tx(db, () => {
    if (!mapped.external_call_id) {
      db.prepare('UPDATE call_events SET attempts = attempts + 1, processed_at = ? WHERE id = ?').run(nowIso(), ev.id);
      return { status: 'erro', message: 'ID da chamada continua ausente com o mapeamento atual.' };
    }
    const other = db.prepare('SELECT id, status FROM call_events WHERE provider = ? AND external_call_id = ? AND id <> ?').get(PROVIDER, mapped.external_call_id, ev.id);
    if (other) {
      db.prepare("UPDATE call_events SET status = 'descartado', error_message = ?, processed_at = ? WHERE id = ?").run(`Duplicado do evento #${other.id}.`, nowIso(), ev.id);
      return { status: 'duplicado', message: `Evento duplicado do #${other.id}; descartado.` };
    }
    db.prepare(`UPDATE call_events SET ${EVENT_COLS.map((c) => `${c} = ?`).join(', ')}, attempts = attempts + 1 WHERE id = ?`).run(...EVENT_COLS.map((c) => mapped[c] ?? null), ev.id);
    if (mapped.problems.length) {
      const msg = mapped.problems.join('; ');
      db.prepare("UPDATE call_events SET status = 'erro', error_message = ?, processed_at = ? WHERE id = ?").run(msg, nowIso(), ev.id);
      return { status: 'erro', message: msg };
    }
    const res = linkAndRecord(db, ev.id);
    logEvent(db, PROVIDER, 'reprocessamento', mapped.external_call_id, res.status === 'vinculado' ? 'sucesso' : 'sem_vinculo', res.message || `Vinculado a ${res.contact_code}`, null);
    audit(db, user, 'call_event', ev.id, 'reprocessado', { resultado: res.status });
    return res;
  });
}

function discard(db, user, id, reason) {
  requireManager(user);
  const ev = loadEvent(db, id);
  if (ev.status === 'vinculado') throw badRequest('Eventos já vinculados não podem ser descartados.');
  if (!clean(reason)) throw badRequest('Informe o motivo do descarte.');
  db.prepare("UPDATE call_events SET status = 'descartado', error_message = ?, processed_at = ? WHERE id = ?").run(`Descartado: ${clean(reason)}`, nowIso(), ev.id);
  audit(db, user, 'call_event', ev.id, 'descartado', { motivo: clean(reason) });
}

module.exports = { ingest, preview, listEvents, linkManually, reprocess, discard, mapEvent, findByPhone, flexibleIso };
