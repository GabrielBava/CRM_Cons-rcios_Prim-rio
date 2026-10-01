'use strict';
/**
 * Pós-venda (menu próprio): começa na confirmação do pagamento e fica sempre ligado ao cadastro do cliente.
 * - Checklist: 1ª parcela paga, onboarding, estratégia de lance, recebimento do boleto, preferências de contato e indicação.
 * - Satisfação (NPS): pesquisas, alertas (detratores sem tratativa, pendentes, expiradas), histórico e motivos de insatisfação.
 * - Estratégias de lance por carta, com histórico de quem cadastrou, data e hora.
 */
const { contactScope, loadContact, requireManager, assertAssignable, audit, optionLabel } = require('../core');
const { badRequest, notFound, clean, nowIso } = require('../util');
const { tx } = require('../db');
const { insertActivity } = require('./activities');
const record = require('./record');

const CLIENTS = (sc) => `FROM contacts c WHERE c.relationship = 'cliente' AND c.merged_into_id IS NULL AND c.anonymized_at IS NULL AND ${sc.sql}`;

function checklistItems(db) {
  return db.prepare("SELECT value, label FROM options WHERE list = 'etapa_pos_venda' AND active = 1 ORDER BY position").all();
}

/** Clientes em pós-venda com o andamento do checklist, responsável, NPS e estratégia de lance. */
function overview(db, user, q = {}) {
  const sc = contactScope(db, user, 'c');
  const items = checklistItems(db);
  const params = [...sc.params];
  let extra = '';
  if (q.q) {
    extra += ' AND (c.name LIKE ? OR c.code = ?)';
    params.push(`%${q.q}%`, String(q.q).toUpperCase());
  }
  if (q.postsale_owner_id) {
    extra += ' AND COALESCE(c.postsale_owner_id, c.owner_id) = ?';
    params.push(Number(q.postsale_owner_id));
  }
  const rows = db
    .prepare(`SELECT c.id, c.code, c.name, c.kind, COALESCE(c.active, 1) AS active, c.whatsapp, c.phone1, c.email, c.converted_at, c.nps_score, c.nps_at,
      c.pref_channel, c.pref_time, COALESCE(c.postsale_owner_id, c.owner_id) AS postsale_id, c.owner_id
      ${CLIENTS(sc)} AND EXISTS (SELECT 1 FROM contracts k WHERE k.contact_id = c.id AND k.status <> 'cancelado')${extra} ORDER BY c.converted_at DESC LIMIT 500`)
    .all(...params);
  const done = db.prepare('SELECT item, done_at FROM post_sale_items WHERE contact_id = ? AND contract_id IS NULL AND done_at IS NOT NULL');
  const userName = db.prepare('SELECT name FROM users WHERE id = ?');
  const contracts = db.prepare("SELECT k.id, k.code, k.credit_value, k.category, b.id AS strategy_id FROM contracts k LEFT JOIN bid_strategies b ON b.contract_id = k.id WHERE k.contact_id = ? AND k.status <> 'cancelado'");
  const pendingNps = db.prepare("SELECT COUNT(*) AS n FROM nps_surveys WHERE contact_id = ? AND answered_at IS NULL AND cancelled_at IS NULL AND expires_at > ?");
  const now = nowIso();
  const out = rows.map((r) => {
    const d = new Map(done.all(r.id).map((x) => [x.item, x.done_at]));
    const ks = contracts.all(r.id);
    const checklist = items.map((i) => ({ item: i.value, label: i.label, done_at: d.get(i.value) || null }));
    const doneCount = checklist.filter((i) => i.done_at).length;
    return {
      ...r,
      postsale_name: r.postsale_id ? userName.get(r.postsale_id)?.name || null : null,
      checklist,
      done: doneCount,
      total: items.length,
      complete: doneCount === items.length,
      next_item: checklist.find((i) => !i.done_at) || null,
      cartas: ks.length,
      credit_total: ks.reduce((t, k) => t + (k.credit_value || 0), 0),
      without_strategy: ks.filter((k) => !k.strategy_id).length,
      nps_pending: pendingNps.get(r.id, now).n > 0,
      days_since_sale: r.converted_at ? Math.floor((Date.now() - Date.parse(r.converted_at)) / 86400000) : null,
    };
  });
  let filtered = out;
  if (q.status === 'incompleto') filtered = out.filter((r) => !r.complete);
  if (q.status === 'completo') filtered = out.filter((r) => r.complete);
  if (q.item) filtered = filtered.filter((r) => !r.checklist.find((i) => i.item === q.item)?.done_at);
  return {
    items,
    rows: filtered,
    summary: {
      clientes: out.length,
      incompletos: out.filter((r) => !r.complete).length,
      sem_estrategia: out.reduce((t, r) => t + r.without_strategy, 0),
      por_item: items.map((i) => ({ item: i.value, label: i.label, pendentes: out.filter((r) => !r.checklist.find((x) => x.item === i.value).done_at).length })),
    },
  };
}

/** Painel de satisfação: NPS do período, distribuição, motivos de insatisfação, alertas e histórico das pesquisas. */
function npsBoard(db, user, q = {}) {
  const sc = contactScope(db, user, 'c');
  const months = Math.min(36, Math.max(1, Number(q.months) || 12));
  const from = new Date(Date.now() - months * 30 * 86400000).toISOString();
  const now = nowIso();
  const surveys = db
    .prepare(`SELECT n.id, n.code, n.contact_id, n.contract_id, n.created_at, n.expires_at, n.first_access_at, n.answered_at, n.score, n.answers, n.comment,
      n.cancelled_at, n.cancel_reason, n.dissatisfaction_reason, n.treated_at, n.treatment_notes, c.name AS contact_name, c.code AS contact_code,
      u.name AS created_by_name, t.name AS treated_by_name, k.code AS contract_code, COALESCE(c.postsale_owner_id, c.owner_id) AS postsale_id
      FROM nps_surveys n JOIN contacts c ON c.id = n.contact_id LEFT JOIN users u ON u.id = n.created_by LEFT JOIN users t ON t.id = n.treated_by
      LEFT JOIN contracts k ON k.id = n.contract_id WHERE ${sc.sql} AND n.created_at >= ? ORDER BY n.created_at DESC`)
    .all(...sc.params, from)
    .map((n) => {
      const status = record.npsStatus(n, now);
      const category = n.score == null ? null : n.score >= 9 ? 'promotor' : n.score >= 7 ? 'neutro' : 'detrator';
      return { ...n, answers: n.answers ? JSON.parse(n.answers) : null, status, category };
    });
  const answered = surveys.filter((s) => s.status === 'respondida');
  const count = (cat) => answered.filter((s) => s.category === cat).length;
  const nps = answered.length ? Math.round(((count('promotor') - count('detrator')) / answered.length) * 100) : null;
  const reasons = {};
  for (const s of answered) if (s.dissatisfaction_reason) reasons[s.dissatisfaction_reason] = (reasons[s.dissatisfaction_reason] || 0) + 1;
  const qAvg = {};
  for (const [key, label] of record.NPS_QUESTIONS) {
    const vals = answered.map((s) => s.answers?.[key]).filter((v) => v != null);
    qAvg[key] = { label, avg: vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null, n: vals.length };
  }
  // Clientes sem nenhuma pesquisa 30 dias depois da venda
  const noSurvey = db
    .prepare(`SELECT c.id, c.code, c.name, c.converted_at ${CLIENTS(sc)} AND COALESCE(c.active, 1) = 1 AND c.converted_at <= ?
      AND NOT EXISTS (SELECT 1 FROM nps_surveys n WHERE n.contact_id = c.id) ORDER BY c.converted_at LIMIT 50`)
    .all(...sc.params, new Date(Date.now() - 30 * 86400000).toISOString());
  const alerts = [
    ...answered.filter((s) => s.category === 'detrator' && !s.treated_at).map((s) => ({ level: 'danger', kind: 'detrator', survey_id: s.id, contact_id: s.contact_id, text: `${s.contact_name}: nota ${s.score} sem tratativa${s.dissatisfaction_reason ? ` (${optionLabel(db, 'motivo_insatisfacao', s.dissatisfaction_reason)})` : ''}` })),
    ...surveys.filter((s) => s.status === 'pendente' && Date.now() - Date.parse(s.created_at) > 5 * 86400000).map((s) => ({ level: 'warn', kind: 'pendente', survey_id: s.id, contact_id: s.contact_id, text: `${s.contact_name}: pesquisa enviada há ${Math.floor((Date.now() - Date.parse(s.created_at)) / 86400000)} dias sem resposta` })),
    ...surveys.filter((s) => s.status === 'expirada').slice(0, 20).map((s) => ({ level: 'muted', kind: 'expirada', survey_id: s.id, contact_id: s.contact_id, text: `${s.contact_name}: pesquisa expirou sem resposta` })),
    ...noSurvey.map((c) => ({ level: 'info', kind: 'sem_pesquisa', contact_id: c.id, text: `${c.name}: cliente há mais de 30 dias sem pesquisa de satisfação` })),
  ];
  let rows = surveys;
  if (q.status) rows = rows.filter((s) => s.status === q.status);
  if (q.category) rows = rows.filter((s) => s.category === q.category);
  if (q.treated === '0') rows = rows.filter((s) => s.category === 'detrator' && !s.treated_at);
  return {
    months,
    summary: {
      nps,
      enviadas: surveys.filter((s) => s.status !== 'cancelada').length,
      respondidas: answered.length,
      taxa_resposta: surveys.filter((s) => s.status !== 'cancelada').length ? Math.round((answered.length / surveys.filter((s) => s.status !== 'cancelada').length) * 100) : null,
      promotores: count('promotor'),
      neutros: count('neutro'),
      detratores: count('detrator'),
      sem_tratativa: answered.filter((s) => s.category === 'detrator' && !s.treated_at).length,
      perguntas: qAvg,
      motivos: Object.entries(reasons).map(([reason, n]) => ({ reason, label: optionLabel(db, 'motivo_insatisfacao', reason), n })).sort((a, b) => b.n - a.n),
    },
    alerts,
    rows,
  };
}

/** Tratativa de uma avaliação (detrator ou neutro): o que foi feito com o cliente. Conclui a tarefa de tratar o NPS. */
function treatNps(db, user, id, data) {
  const n = db.prepare('SELECT * FROM nps_surveys WHERE id = ?').get(Number(id));
  if (!n) throw notFound('Pesquisa não encontrada.');
  loadContact(db, user, n.contact_id, { write: true });
  if (!n.answered_at) throw badRequest('Só é possível registrar a tratativa de uma pesquisa respondida.');
  const notes = clean(data.notes);
  if (!notes || notes.length < 10) throw badRequest('Descreva a tratativa: o que foi conversado e combinado com o cliente (mínimo de 10 caracteres).');
  const reason = clean(data.reason);
  if (reason && !db.prepare("SELECT 1 FROM options WHERE list = 'motivo_insatisfacao' AND value = ?").get(reason)) throw badRequest('Motivo inválido.');
  const now = nowIso();
  tx(db, () => {
    db.prepare('UPDATE nps_surveys SET treated_at = ?, treated_by = ?, treatment_notes = ?, dissatisfaction_reason = COALESCE(?, dissatisfaction_reason) WHERE id = ?').run(now, user.id, notes, reason ?? null, n.id);
    db.prepare("UPDATE tasks SET status = 'concluida', completed_at = ?, completed_by = ?, updated_at = ? WHERE contact_id = ? AND status = 'pendente' AND type = 'pos_venda' AND title LIKE ?").run(now, user.id, now, n.contact_id, `Tratar avaliação NPS ${n.code}%`);
    insertActivity(db, { contact_id: n.contact_id, type: 'pos_venda', notes: `Tratativa da pesquisa ${n.code} (nota ${n.score}): ${notes}`, user_id: user.id });
    audit(db, user, 'nps', n.id, 'tratativa_registrada', { motivo: reason }, n.contact_id);
  });
}

/** Cartas (produtos contratados) com a estratégia de lance atual e o histórico de alterações. */
function bidBoard(db, user, q = {}) {
  const sc = contactScope(db, user, 'c');
  const params = [...sc.params];
  let extra = '';
  if (q.q) {
    extra += ' AND (c.name LIKE ? OR c.code = ? OR k.code = ?)';
    params.push(`%${q.q}%`, String(q.q).toUpperCase(), String(q.q).toUpperCase());
  }
  if (q.situacao === 'sem') extra += ' AND b.id IS NULL';
  if (q.situacao === 'com') extra += ' AND b.id IS NOT NULL';
  if (q.bid_type) {
    extra += ' AND b.bid_type = ?';
    params.push(q.bid_type);
  }
  const rows = db
    .prepare(`SELECT k.id, k.code, k.contact_id, k.credit_value, k.category, k.administrator, k.group_code, k.quota_code, k.contracted_at, k.status,
      c.name AS contact_name, c.code AS contact_code, b.will_bid, b.bid_type, b.bid_pct, b.use_embedded, b.use_fgts, b.notes, b.updated_at, u.name AS updated_by_name,
      (SELECT COUNT(*) FROM bid_strategy_history h WHERE h.contract_id = k.id) AS changes
      FROM contracts k JOIN contacts c ON c.id = k.contact_id LEFT JOIN bid_strategies b ON b.contract_id = k.id LEFT JOIN users u ON u.id = b.updated_by
      WHERE ${sc.sql} AND k.status <> 'cancelado' AND c.merged_into_id IS NULL${extra} ORDER BY b.id IS NOT NULL, k.contracted_at DESC LIMIT 500`)
    .all(...params);
  return {
    rows,
    summary: {
      cartas: rows.length,
      sem_estrategia: rows.filter((r) => r.bid_type == null && r.will_bid == null).length,
      por_tipo: Object.entries(record.BID_TYPES).map(([k, label]) => ({ type: k, label, n: rows.filter((r) => r.bid_type === k).length })),
      sem_lance: rows.filter((r) => r.will_bid === 0).length,
    },
  };
}

function bidHistory(db, user, contractId) {
  const k = db.prepare('SELECT id, contact_id, code FROM contracts WHERE id = ?').get(Number(contractId));
  if (!k) throw notFound('Produto contratado não encontrado.');
  loadContact(db, user, k.contact_id);
  return { contract: k, history: record.bidHistory(db, k.id) };
}

/** Define o responsável pós-venda do cliente (administrador ou líder). */
function setOwner(db, user, contactId, data) {
  requireManager(user);
  const c = loadContact(db, user, contactId, { write: true });
  const to = data.user_id ? Number(data.user_id) : null;
  if (to) assertAssignable(db, user, to);
  db.prepare('UPDATE contacts SET postsale_owner_id = ?, updated_at = ? WHERE id = ?').run(to, nowIso(), c.id);
  const name = to ? db.prepare('SELECT name FROM users WHERE id = ?').get(to)?.name : null;
  insertActivity(db, { contact_id: c.id, type: 'pos_venda', notes: `Responsável pós-venda: ${name || 'o especialista responsável pelo cliente'}.`, user_id: user.id });
  audit(db, user, 'contact', c.id, 'responsavel_pos_venda', { para: to }, c.id);
  if (to) require('./notifications').notify(db, to, { kind: 'pos_venda', title: `Você é o responsável pós-venda de ${c.name}`, link: `#/clientes/${c.id}`, exclude: user.id });
}

module.exports = { overview, npsBoard, treatNps, bidBoard, bidHistory, setOwner };
