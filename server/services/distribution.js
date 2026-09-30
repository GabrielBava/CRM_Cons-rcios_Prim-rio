'use strict';
/**
 * Entrada e distribuição de prospects e leads (tela do administrador).
 * Fila de cadastros sem responsável, por canal de origem, e distribuição:
 *  - manual (escolhendo o especialista);
 *  - roleta: sequencial (um para cada, na ordem) ou pela menor carteira em aberto, respeitando o peso e os canais de cada um;
 *  - automática: ao entrar pela API ou importação, o lead já cai na roleta (opcional).
 * Cada distribuição cria a tarefa "Primeiro contato" com prazo curto (speed to lead) e fica registrada.
 */
const { visibleOwnerIds, assertAssignable, audit, optionLabel } = require('../core');
const { badRequest, notFound, nowIso } = require('../util');
const { tx, getSetting, setSetting } = require('../db');
const { insertActivity } = require('./activities');
const { requireModule } = require('../permissions');

function roleta(db) {
  return { mode: 'sequencial', auto: false, participants: [], last_user_id: null, first_contact_hours: 1, ...(getSetting(db, 'roleta') || {}) };
}

function queue(db, user, q = {}) {
  requireModule(user, 'distribuicao');
  const where = ['c.owner_id IS NULL', 'c.merged_into_id IS NULL', 'c.anonymized_at IS NULL', 'COALESCE(c.active, 1) = 1'];
  const params = [];
  if (q.origin) {
    where.push('c.origin = ?');
    params.push(q.origin);
  }
  if (q.relationship) {
    where.push('c.relationship = ?');
    params.push(q.relationship);
  }
  const rows = db
    .prepare(`SELECT c.id, c.code, c.name, c.kind, c.relationship, c.origin, c.campaign, c.phone1, c.whatsapp, c.email, c.city, c.state, c.temperature, c.created_at,
      (SELECT o.credit_value FROM opportunities o WHERE o.contact_id = c.id ORDER BY o.id DESC LIMIT 1) AS credit_value
      FROM contacts c WHERE ${where.join(' AND ')} ORDER BY c.created_at LIMIT 1000`)
    .all(...params);
  const byOrigin = db
    .prepare(`SELECT COALESCE(origin, 'sem_origem') AS origin, COUNT(*) AS fila FROM contacts c WHERE c.owner_id IS NULL AND c.merged_into_id IS NULL AND c.anonymized_at IS NULL AND COALESCE(c.active, 1) = 1 GROUP BY 1 ORDER BY 2 DESC`)
    .all()
    .map((r) => ({ ...r, label: r.origin === 'sem_origem' ? 'Sem origem' : optionLabel(db, 'origem', r.origin) }));
  const since = (h) => new Date(Date.now() - h * 3600000).toISOString();
  const received = db.prepare('SELECT COUNT(*) AS hoje FROM contacts WHERE created_at >= ? AND merged_into_id IS NULL').get(since(24)).hoje;
  const week = db.prepare('SELECT COUNT(*) AS n FROM contacts WHERE created_at >= ? AND merged_into_id IS NULL').get(since(24 * 7)).n;
  // Distribuídos e ainda sem tentativa de contato depois do prazo (candidatos a redistribuição)
  const hours = roleta(db).first_contact_hours || 1;
  const noContact = db
    .prepare(`SELECT c.id, c.code, c.name, c.origin, c.assigned_at, u.name AS owner_name, c.owner_id FROM contacts c JOIN users u ON u.id = c.owner_id
      WHERE c.assigned_at IS NOT NULL AND c.assigned_at < ? AND c.relationship <> 'cliente' AND c.merged_into_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.contact_id = c.id AND a.user_id IS NOT NULL AND a.occurred_at >= c.assigned_at AND a.type NOT IN ('cadastro','tarefa','mudanca_etapa'))
      ORDER BY c.assigned_at LIMIT 200`)
    .all(since(hours));
  const log = db
    .prepare(`SELECT d.*, c.code AS contact_code, c.name AS contact_name, t.name AS to_name, f.name AS from_name, b.name AS by_name FROM distribution_log d
      JOIN contacts c ON c.id = d.contact_id JOIN users t ON t.id = d.to_user LEFT JOIN users f ON f.id = d.from_user LEFT JOIN users b ON b.id = d.by_user
      ORDER BY d.id DESC LIMIT 50`)
    .all();
  return { rows, by_origin: byOrigin, received_24h: received, received_7d: week, oldest_waiting: rows[0]?.created_at || null, no_contact: noContact, no_contact_hours: hours, log, roleta: roletaStatus(db, user) };
}

/** Especialistas aptos (ativos e com perfil de venda) e carteira em aberto de cada um. */
function candidates(db) {
  return db
    .prepare(`SELECT u.id, u.name, u.team_id, (SELECT COUNT(*) FROM opportunities o WHERE o.owner_id = u.id AND o.status = 'aberta') AS carteira
      FROM users u WHERE u.active = 1 AND u.role IN ('consultor','gestor') ORDER BY u.name`)
    .all();
}

function roletaStatus(db, user) {
  const cfg = roleta(db);
  const ids = visibleOwnerIds(db, user);
  const list = candidates(db).filter((c) => ids === null || ids.includes(c.id)).map((c) => {
    const p = cfg.participants.find((x) => x.user_id === c.id);
    return { ...c, active: p ? p.active !== false : false, weight: p?.weight || 1, origins: p?.origins || [] };
  });
  return { ...cfg, participants: list };
}

function saveRoleta(db, user, data) {
  requireModule(user, 'distribuicao');
  if (user.role !== 'admin') throw badRequest('Apenas o administrador configura a roleta.');
  const valid = new Set(candidates(db).map((c) => c.id));
  const participants = (Array.isArray(data.participants) ? data.participants : [])
    .filter((p) => valid.has(Number(p.user_id)))
    .map((p) => ({ user_id: Number(p.user_id), active: !!p.active, weight: Math.min(5, Math.max(1, Number(p.weight) || 1)), origins: Array.isArray(p.origins) ? p.origins.filter(Boolean) : [] }));
  const hours = Number(data.first_contact_hours) || 1;
  if (hours < 0.25 || hours > 72) throw badRequest('Prazo do primeiro contato: entre 15 minutos e 72 horas.');
  const cfg = { ...roleta(db), mode: data.mode === 'menor_carteira' ? 'menor_carteira' : 'sequencial', auto: !!data.auto, participants, first_contact_hours: hours };
  setSetting(db, 'roleta', cfg);
  audit(db, user, 'settings', null, 'roleta_alterada', { modo: cfg.mode, automatica: cfg.auto, participantes: participants.filter((p) => p.active).length });
}

/** Escolhe o próximo especialista da roleta para um cadastro (respeita canal e peso). */
function pickNext(db, contact, cfg) {
  const cands = candidates(db);
  let pool = cfg.participants.filter((p) => p.active && cands.find((c) => c.id === p.user_id));
  const byOrigin = pool.filter((p) => !p.origins.length || p.origins.includes(contact.origin));
  if (byOrigin.length) pool = byOrigin;
  if (!pool.length) return null;
  if (cfg.mode === 'menor_carteira') {
    return pool
      .map((p) => ({ ...p, load: (cands.find((c) => c.id === p.user_id).carteira || 0) / (p.weight || 1) }))
      .sort((a, b) => a.load - b.load || a.user_id - b.user_id)[0].user_id;
  }
  // Sequencial com peso: cada especialista aparece "peso" vezes na volta
  const ring = pool.flatMap((p) => Array(p.weight || 1).fill(p.user_id));
  const lastIdx = cfg.cursor != null ? cfg.cursor : ring.lastIndexOf(cfg.last_user_id);
  const idx = (lastIdx + 1) % ring.length;
  cfg.cursor = idx;
  return ring[idx];
}

function assign(db, user, contactId, toUser, method) {
  const c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(Number(contactId));
  if (!c) throw notFound('Cadastro não encontrado.');
  if (user) assertAssignable(db, user, toUser);
  const now = nowIso();
  const hours = roleta(db).first_contact_hours || 1;
  db.prepare('UPDATE contacts SET owner_id = ?, assigned_at = ?, assigned_by = ?, updated_at = ? WHERE id = ?').run(toUser, now, user?.id ?? null, now, c.id);
  db.prepare("UPDATE opportunities SET owner_id = ?, updated_at = ? WHERE contact_id = ? AND status IN ('aberta','pausada')").run(toUser, now, c.id);
  db.prepare("UPDATE tasks SET assigned_to = ? WHERE contact_id = ? AND status = 'pendente' AND (assigned_to IS NULL OR assigned_to = ?)").run(toUser, c.id, c.owner_id ?? -1);
  db.prepare('INSERT INTO distribution_log (contact_id, from_user, to_user, method, by_user, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(c.id, c.owner_id ?? null, toUser, method, user?.id ?? null, now);
  const opp = db.prepare("SELECT id FROM opportunities WHERE contact_id = ? AND status = 'aberta' ORDER BY id DESC LIMIT 1").get(c.id);
  db.prepare("INSERT INTO tasks (contact_id, opportunity_id, type, title, notes, due_at, assigned_to, priority, created_by, created_at, updated_at) VALUES (?, ?, 'primeiro_contato', ?, ?, ?, ?, 'alta', ?, ?, ?)")
    .run(c.id, opp?.id ?? null, `Primeiro contato: ${c.name}`, `Lead recebido via ${optionLabel(db, 'origem', c.origin) || 'origem não informada'}. Quanto antes o contato, maior a chance de conversão.`, new Date(Date.now() + hours * 3600000).toISOString(), toUser, user?.id ?? null, now, now);
  const toName = db.prepare('SELECT name FROM users WHERE id = ?').get(toUser)?.name;
  const label = { manual: 'manualmente', roleta: 'pela roleta', auto: 'automaticamente pela roleta', redistribuicao: 'por redistribuição' }[method] || method;
  insertActivity(db, { contact_id: c.id, type: 'cadastro', notes: `Cadastro distribuído ${label} para ${toName}.`, user_id: user?.id ?? null });
  audit(db, user, 'contact', c.id, 'distribuido', { para: toName, metodo: method }, c.id);
}

/** Distribui os cadastros escolhidos para um especialista ou pela roleta. */
function distribute(db, user, data) {
  requireModule(user, 'distribuicao');
  const ids = (Array.isArray(data.contact_ids) ? data.contact_ids : []).map(Number).filter(Boolean);
  if (!ids.length) throw badRequest('Selecione os cadastros a distribuir.');
  const scope = visibleOwnerIds(db, user);
  const method = data.method === 'roleta' ? 'roleta' : data.method === 'redistribuicao' ? 'redistribuicao' : 'manual';
  const cfg = roleta(db);
  const result = [];
  tx(db, () => {
    for (const id of ids) {
      const c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
      if (!c) continue;
      if (c.owner_id && method !== 'redistribuicao') continue;
      if (c.owner_id && scope !== null && !scope.includes(c.owner_id)) continue;
      let to = method === 'roleta' || (method === 'redistribuicao' && !data.user_id) ? pickNext(db, c, cfg) : Number(data.user_id);
      if (method === 'redistribuicao' && to === c.owner_id) to = pickNext(db, c, cfg);
      if (!to) throw badRequest('Nenhum especialista ativo na roleta para este canal. Configure os participantes da roleta.');
      assign(db, user, c.id, to, method);
      cfg.last_user_id = to;
      result.push({ contact_id: c.id, user_id: to });
    }
    setSetting(db, 'roleta', cfg);
  });
  return { distributed: result.length, result };
}

/** Distribuição automática na entrada (API de leads, importação), se ligada. */
function autoDistribute(db, contactId) {
  const cfg = roleta(db);
  if (!cfg.auto) return null;
  const c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId);
  if (!c || c.owner_id) return null;
  const to = pickNext(db, c, cfg);
  if (!to) return null;
  assign(db, null, c.id, to, 'auto');
  cfg.last_user_id = to;
  setSetting(db, 'roleta', cfg);
  return to;
}

module.exports = { queue, roletaStatus, saveRoleta, distribute, autoDistribute };
