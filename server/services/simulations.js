'use strict';
/**
 * Simulações vinculadas ao lead.
 * O link do simulador leva apenas um token aleatório e temporário (nunca CPF/CNPJ ou dados pessoais).
 * O token é guardado como hash, vale para um único lead/oportunidade e expira.
 */
const { SIMULATION_STATUS } = require('../constants');
const { loadContact, childScope, audit, paging } = require('../core');
const { HttpError, badRequest, notFound, conflict, clean, toNumber, randomToken, sha256, nowIso } = require('../util');
const { tx, nextCode, getSetting } = require('../db');
const { insertActivity } = require('./activities');
const { getIntegration, logEvent, mapPayload } = require('./integrations');
const { assertOption } = require('./opportunities');

const SIM_FIELDS = ['credit_value', 'term_months', 'installment', 'payment_modality', 'strategy', 'view_url', 'status', 'notes'];

function simulatorAvailability(db) {
  const integ = getIntegration(db, 'simulador');
  const ready = ['em_teste', 'ativa', 'erro'].includes(integ.status) && !!integ.config.base_url && !!integ.token_hash;
  return {
    available: ready,
    status: integ.status,
    message: ready
      ? integ.status === 'ativa'
        ? 'Simulador integrado.'
        : 'Simulador em homologação (integração ainda não validada).'
      : 'Integração pendente: o simulador ainda não está conectado. Registre a simulação manualmente.',
  };
}

function createLink(db, user, data) {
  const c = loadContact(db, user, data.contact_id, { write: true });
  if (c.anonymized_at) throw badRequest('Cadastro anonimizado.');
  const avail = simulatorAvailability(db);
  if (!avail.available) throw new HttpError(409, avail.message);
  let oppId = null;
  if (data.opportunity_id) {
    const o = db.prepare('SELECT id FROM opportunities WHERE id = ? AND contact_id = ?').get(Number(data.opportunity_id), c.id);
    if (!o) throw badRequest('Oportunidade não pertence a este cadastro.');
    oppId = o.id;
  }
  const integ = getIntegration(db, 'simulador');
  const hours = Number(getSetting(db, 'simulation_link_hours')) || 24;
  const token = randomToken(32);
  const now = nowIso();
  const expires = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  const r = db
    .prepare('INSERT INTO simulation_links (token_hash, contact_id, opportunity_id, created_by, origin_screen, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(sha256(token), c.id, oppId, user.id, clean(data.origin_screen) || 'cadastro', now, expires);
  const url = new URL(integ.config.base_url);
  url.searchParams.set('crm_token', token);
  logEvent(db, 'simulador', 'link_criado', null, 'info', `Link criado para ${c.code} por ${user.name} (expira em ${hours}h).`, null);
  audit(db, user, 'simulation_link', Number(r.lastInsertRowid), 'criado', { expira_em: expires, origem: clean(data.origin_screen) || 'cadastro' }, c.id);
  return { url: url.toString(), expires_at: expires };
}

function resolveToken(db, token) {
  if (!token || typeof token !== 'string') throw new HttpError(401, 'Token da simulação ausente.');
  const link = db.prepare('SELECT * FROM simulation_links WHERE token_hash = ?').get(sha256(token));
  if (!link) throw new HttpError(401, 'Token da simulação inválido.');
  if (link.revoked_at) throw new HttpError(401, 'Token da simulação revogado.');
  if (Date.parse(link.expires_at) < Date.now()) throw new HttpError(401, 'Token da simulação expirado. Gere um novo link no CRM.');
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(link.contact_id);
  if (!contact || contact.anonymized_at) throw new HttpError(410, 'Cadastro indisponível.');
  return { link, contact };
}

/** Dados de pré-preenchimento entregues ao simulador (somente o necessário, sem CPF/CNPJ). */
function context(db, token) {
  const { link, contact } = resolveToken(db, token);
  const opp = link.opportunity_id ? db.prepare('SELECT * FROM opportunities WHERE id = ?').get(link.opportunity_id) : null;
  const owner = db.prepare('SELECT name, email FROM users WHERE id = ?').get(link.created_by);
  const now = nowIso();
  db.prepare('UPDATE simulation_links SET first_used_at = COALESCE(first_used_at, ?), last_used_at = ? WHERE id = ?').run(now, now, link.id);
  logEvent(db, 'simulador', 'contexto', null, 'info', `Contexto consultado para ${contact.code}.`, null);
  return {
    id_lead: contact.uid,
    codigo_lead: contact.code,
    id_oportunidade: opp?.uid ?? null,
    codigo_oportunidade: opp?.code ?? null,
    tipo_pessoa: contact.kind,
    nome: contact.name,
    empresa: contact.kind === 'PJ' ? contact.trade_name || contact.legal_name || null : null,
    telefone: contact.phone1 || contact.whatsapp || null,
    email: contact.email || null,
    consultor: owner ? { nome: owner.name, email: owner.email } : null,
    interesse: opp
      ? {
          categoria: opp.credit_category,
          credito: opp.credit_value,
          prazo_meses: opp.term_months,
          modalidade_pagamento: opp.payment_modality,
          estrategia: opp.strategy,
        }
      : null,
    expira_em: link.expires_at,
  };
}

function normalizeSim(db, m) {
  const o = {};
  if (m.credit_value !== undefined) o.credit_value = toNumber(m.credit_value);
  if (m.installment !== undefined) o.installment = toNumber(m.installment);
  if (m.term_months !== undefined) {
    const n = toNumber(m.term_months);
    if (n != null && (!Number.isInteger(n) || n <= 0)) throw badRequest('Prazo inválido.');
    o.term_months = n;
  }
  for (const f of ['payment_modality', 'strategy', 'view_url', 'notes']) if (m[f] !== undefined) o[f] = clean(m[f] == null ? null : String(m[f]));
  if (o.view_url) {
    try {
      const u = new URL(o.view_url);
      if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
    } catch {
      throw badRequest('Link de consulta da simulação inválido.');
    }
  }
  if (m.status !== undefined) {
    const s = clean(m.status);
    if (s && !SIMULATION_STATUS[s]) throw badRequest(`Status da simulação inválido. Use: ${Object.keys(SIMULATION_STATUS).join(', ')}.`);
    o.status = s || 'salva';
  }
  return o;
}

function saveVersion(db, sim, userId) {
  const snapshot = {};
  for (const f of SIM_FIELDS) snapshot[f] = sim[f];
  db.prepare('INSERT INTO simulation_versions (simulation_id, version, snapshot, created_at, created_by) VALUES (?, ?, ?, ?, ?)').run(
    sim.id, sim.version, JSON.stringify(snapshot), nowIso(), userId ?? null,
  );
}

/** Cria ou versiona uma simulação. Nunca apaga a versão anterior. */
function upsertSimulation(db, { contactId, oppId, linkId, source, externalId, fields, userId, raw }) {
  const now = nowIso();
  const existing = externalId ? db.prepare('SELECT * FROM simulations WHERE source = ? AND external_id = ?').get(source, externalId) : null;
  if (existing) {
    if (existing.contact_id !== contactId) throw conflict('Esta simulação pertence a outro lead. Operação recusada.');
    const merged = { ...existing, ...fields };
    const changed = SIM_FIELDS.some((f) => String(existing[f] ?? '') !== String(merged[f] ?? ''));
    if (!changed) return { id: existing.id, code: existing.code, version: existing.version, unchanged: true };
    saveVersion(db, existing, userId);
    db.prepare(
      `UPDATE simulations SET ${SIM_FIELDS.map((f) => `${f} = ?`).join(', ')}, version = version + 1, raw_payload = ?, updated_at = ? WHERE id = ?`,
    ).run(...SIM_FIELDS.map((f) => merged[f] ?? null), raw ?? existing.raw_payload, now, existing.id);
    insertActivity(db, {
      contact_id: contactId,
      opportunity_id: existing.opportunity_id,
      type: 'simulacao',
      notes: `Simulação ${existing.code} atualizada para a versão ${existing.version + 1}.`,
      user_id: userId,
      source,
      ref_type: 'simulation',
      ref_id: existing.id,
    });
    return { id: existing.id, code: existing.code, version: existing.version + 1 };
  }
  const code = nextCode(db, 'simulation', 'SIM');
  const r = db
    .prepare(
      `INSERT INTO simulations (code, contact_id, opportunity_id, link_id, external_id, source, ${SIM_FIELDS.join(', ')}, raw_payload, user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ${SIM_FIELDS.map(() => '?').join(', ')}, ?, ?, ?, ?)`,
    )
    .run(code, contactId, oppId ?? null, linkId ?? null, externalId ?? null, source, ...SIM_FIELDS.map((f) => (f === 'status' ? fields.status || 'salva' : fields[f] ?? null)), raw ?? null, userId ?? null, now, now);
  const id = Number(r.lastInsertRowid);
  insertActivity(db, {
    contact_id: contactId,
    opportunity_id: oppId,
    type: 'simulacao',
    notes: `Simulação ${code} registrada${source === 'simulador' ? ' pelo simulador' : ' manualmente'}.`,
    user_id: userId,
    source,
    ref_type: 'simulation',
    ref_id: id,
  });
  return { id, code, version: 1 };
}

/** Retorno do simulador: valida o token e o vínculo antes de gravar. */
function receiveFromSimulator(db, integ, body) {
  const m = mapPayload(body || {}, integ.mapping);
  const { link, contact } = resolveToken(db, m.token || body?.token);
  if (m.lead_ref && m.lead_ref !== contact.uid && String(m.lead_ref).toUpperCase() !== contact.code) {
    logEvent(db, 'simulador', 'simulacao', m.external_id, 'erro', 'ID do lead diverge do token.', null);
    throw conflict('O ID do lead enviado não corresponde ao token. Simulação recusada.');
  }
  let oppId = link.opportunity_id;
  if (m.opportunity_ref) {
    const o = db.prepare('SELECT id, contact_id FROM opportunities WHERE uid = ? OR code = ?').get(String(m.opportunity_ref), String(m.opportunity_ref).toUpperCase());
    if (!o || o.contact_id !== contact.id) {
      logEvent(db, 'simulador', 'simulacao', m.external_id, 'erro', 'Oportunidade não pertence ao lead do token.', null);
      throw conflict('A oportunidade informada não pertence ao lead deste token.');
    }
    if (link.opportunity_id && o.id !== link.opportunity_id) throw conflict('A oportunidade informada difere da vinculada ao token.');
    oppId = o.id;
  }
  if (!m.external_id) throw badRequest('Informe o ID da simulação no simulador (necessário para versionar e evitar duplicidade).');
  const fields = normalizeSim(db, { status: m.status ?? 'salva', ...m });
  let userId = link.created_by;
  if (m.user_ref) {
    const u = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(String(m.user_ref));
    if (u) userId = u.id;
  }
  return tx(db, () => {
    const res = upsertSimulation(db, {
      contactId: contact.id,
      oppId,
      linkId: link.id,
      source: 'simulador',
      externalId: String(m.external_id),
      fields,
      userId,
      raw: JSON.stringify(body).slice(0, 20000),
    });
    db.prepare('UPDATE simulation_links SET last_used_at = ? WHERE id = ?').run(nowIso(), link.id);
    logEvent(db, 'simulador', 'simulacao', String(m.external_id), 'sucesso', `${res.code} v${res.version} para ${contact.code}`, null);
    return { id_simulacao_crm: res.code, versao: res.version, lead: contact.code, sem_alteracao: !!res.unchanged };
  });
}

function createManual(db, user, data) {
  const c = loadContact(db, user, data.contact_id, { write: true });
  let oppId = null;
  if (data.opportunity_id) {
    const o = db.prepare('SELECT id FROM opportunities WHERE id = ? AND contact_id = ?').get(Number(data.opportunity_id), c.id);
    if (!o) throw badRequest('Oportunidade não pertence a este cadastro.');
    oppId = o.id;
  }
  const fields = normalizeSim(db, { status: data.status || 'salva', ...data });
  if (fields.payment_modality) assertOption(db, 'modalidade_pagamento', fields.payment_modality, 'modalidade de pagamento');
  if (fields.strategy) assertOption(db, 'estrategia', fields.strategy, 'estratégia');
  if (fields.credit_value == null) throw badRequest('Informe o crédito simulado.');
  return tx(db, () => {
    const res = upsertSimulation(db, {
      contactId: c.id,
      oppId,
      source: 'manual',
      externalId: clean(data.external_id) ?? null,
      fields,
      userId: user.id,
    });
    audit(db, user, 'simulation', res.id, 'registrada', { code: res.code, versao: res.version }, c.id);
    return res;
  });
}

function updateManual(db, user, id, data) {
  const s = db.prepare('SELECT * FROM simulations WHERE id = ?').get(Number(id));
  if (!s) throw notFound('Simulação não encontrada.');
  loadContact(db, user, s.contact_id, { write: true });
  if (s.source !== 'manual') {
    // Simulações vindas do simulador só mudam de status no CRM; valores são alterados no próprio simulador
    const keys = Object.keys(data).filter((k) => SIM_FIELDS.includes(k) && k !== 'status' && k !== 'notes');
    if (keys.length) throw badRequest('Valores de simulações do simulador só podem ser alterados no próprio simulador.');
  }
  const fields = normalizeSim(db, data);
  if (fields.payment_modality) assertOption(db, 'modalidade_pagamento', fields.payment_modality, 'modalidade de pagamento');
  if (fields.strategy) assertOption(db, 'estrategia', fields.strategy, 'estratégia');
  return tx(db, () => {
    saveVersion(db, s, user.id);
    const merged = { ...s, ...fields };
    db.prepare(`UPDATE simulations SET ${SIM_FIELDS.map((f) => `${f} = ?`).join(', ')}, version = version + 1, updated_at = ? WHERE id = ?`).run(
      ...SIM_FIELDS.map((f) => merged[f] ?? null), nowIso(), s.id,
    );
    audit(db, user, 'simulation', s.id, 'nova_versao', { versao: s.version + 1 }, s.contact_id);
    insertActivity(db, { contact_id: s.contact_id, opportunity_id: s.opportunity_id, type: 'simulacao', notes: `Simulação ${s.code} atualizada para a versão ${s.version + 1}.`, user_id: user.id, ref_type: 'simulation', ref_id: s.id });
  });
}

function getSimulation(db, user, id) {
  const s = db
    .prepare('SELECT s.*, c.name AS contact_name, c.code AS contact_code, o.code AS opportunity_code, u.name AS user_name FROM simulations s JOIN contacts c ON c.id = s.contact_id LEFT JOIN opportunities o ON o.id = s.opportunity_id LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?')
    .get(Number(id));
  if (!s) throw notFound('Simulação não encontrada.');
  loadContact(db, user, s.contact_id);
  s.versions = db.prepare('SELECT v.*, u.name AS user_name FROM simulation_versions v LEFT JOIN users u ON u.id = v.created_by WHERE simulation_id = ? ORDER BY version DESC').all(s.id).map((v) => ({ ...v, snapshot: JSON.parse(v.snapshot) }));
  delete s.raw_payload;
  return s;
}

function listSimulations(db, user, q) {
  const sc = childScope(db, user, 's');
  const where = [sc.sql];
  const params = [...sc.params];
  if (q.contact_id) {
    where.push('s.contact_id = ?');
    params.push(Number(q.contact_id));
  }
  if (q.status) {
    where.push('s.status = ?');
    params.push(q.status);
  }
  if (q.user_id) {
    where.push('s.user_id = ?');
    params.push(Number(q.user_id));
  }
  if (q.source) {
    where.push('s.source = ?');
    params.push(q.source);
  }
  if (q.from) {
    where.push('s.created_at >= ?');
    params.push(q.from);
  }
  if (q.to) {
    where.push('s.created_at <= ?');
    params.push(q.to);
  }
  const { limit, offset, page } = q.all ? { limit: 100000, offset: 0, page: 1 } : paging(q);
  const base = `FROM simulations s JOIN contacts c ON c.id = s.contact_id LEFT JOIN opportunities o ON o.id = s.opportunity_id LEFT JOIN users u ON u.id = s.user_id WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) AS n ${base}`).get(...params).n;
  const rows = db
    .prepare(`SELECT s.id, s.code, s.contact_id, s.opportunity_id, s.source, s.external_id, s.credit_value, s.term_months, s.installment, s.payment_modality, s.strategy, s.view_url, s.status, s.version, s.created_at, s.updated_at,
      c.name AS contact_name, c.code AS contact_code, o.code AS opportunity_code, u.name AS user_name ${base} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  return { total, page, limit, rows };
}

module.exports = { simulatorAvailability, createLink, context, receiveFromSimulator, createManual, updateManual, getSimulation, listSimulations, resolveToken };
