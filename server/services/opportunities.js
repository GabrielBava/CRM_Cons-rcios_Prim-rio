'use strict';
const { PRIORITIES } = require('../constants');
const {
  loadContact,
  contactScope,
  assertAssignable,
  requireAdmin,
  audit,
  diff,
  buildUpdate,
  paging,
  isManager,
  optionLabel,
} = require('../core');
const { badRequest, notFound, forbidden, clean, toNumber, toIso, uuid, nowIso } = require('../util');
const { tx, nextCode, getSetting } = require('../db');
const { insertActivity, listActivities } = require('./activities');

const OPP_FIELDS = [
  'title', 'product_id', 'priority', 'company_contact_id', 'credit_category', 'credit_value', 'term_months', 'installment_min',
  'installment_max', 'quotas', 'payment_modality', 'strategy', 'contemplation_type', 'bid_own_resources', 'fgts_available',
  'embedded_bid_interest', 'urgency', 'objective', 'qualification_criteria', 'next_action', 'next_action_at', 'owner_id', 'custom',
  'pause_reason', 'objective_type', 'product_type', 'credit_purpose', 'financial_moment', 'employment_type', 'has_fgts', 'decision_maker',
  'existing_products', 'existing_consortium_value', 'existing_consortium_admin', 'existing_financing_balance', 'existing_financing_cet',
  'existing_financing_bank',
];
const OPTION_FIELDS = {
  credit_category: 'categoria_credito',
  payment_modality: 'modalidade_pagamento',
  strategy: 'estrategia',
  contemplation_type: 'tipo_contemplacao',
  urgency: 'urgencia',
  objective_type: 'objetivo',
  product_type: 'tipo_produto',
  financial_moment: 'momento_financeiro',
  employment_type: 'tipo_contratacao',
  has_fgts: 'possui_fgts',
  decision_maker: 'decisor',
  existing_products: 'possui_produto',
};

function assertOption(db, list, value, label) {
  if (value == null) return;
  const ok = db.prepare('SELECT 1 FROM options WHERE list = ? AND value = ?').get(list, value);
  if (!ok) throw badRequest(`Valor inválido para ${label}.`);
}

function normalizeOpp(db, data, contactId) {
  const o = {};
  for (const f of ['title', 'objective', 'qualification_criteria', 'next_action', 'pause_reason', 'embedded_bid_interest', 'credit_purpose',
    'existing_consortium_admin', 'existing_financing_bank']) {
    if (data[f] !== undefined) o[f] = clean(data[f]);
  }
  if (o.embedded_bid_interest && !['sim', 'nao', 'avaliar', 'nao_se_aplica'].includes(o.embedded_bid_interest)) {
    throw badRequest('Interesse em lance embutido inválido.');
  }
  for (const [f, list] of Object.entries(OPTION_FIELDS)) {
    if (data[f] !== undefined) {
      o[f] = clean(data[f]);
      assertOption(db, list, o[f], f);
    }
  }
  if (data.existing_financing_cet !== undefined) {
    o.existing_financing_cet = toNumber(data.existing_financing_cet);
    if (o.existing_financing_cet != null && (o.existing_financing_cet < 0 || o.existing_financing_cet > 100)) throw badRequest('CET deve estar entre 0 e 100% ao ano.');
  }
  for (const f of ['credit_value', 'installment_min', 'installment_max', 'bid_own_resources', 'fgts_available', 'existing_consortium_value', 'existing_financing_balance']) {
    if (data[f] !== undefined) {
      o[f] = toNumber(data[f]);
      if (o[f] != null && o[f] < 0) throw badRequest('Valores monetários não podem ser negativos.');
    }
  }
  for (const f of ['term_months', 'quotas']) {
    if (data[f] !== undefined) {
      const n = toNumber(data[f]);
      if (n != null && (!Number.isInteger(n) || n <= 0)) throw badRequest(f === 'quotas' ? 'Quantidade de cotas inválida.' : 'Prazo deve ser um número inteiro de meses.');
      o[f] = n;
    }
  }
  if (o.installment_min != null && o.installment_max != null && o.installment_min > o.installment_max) {
    throw badRequest('A parcela mínima não pode ser maior que a máxima.');
  }
  if (data.priority !== undefined) {
    if (!PRIORITIES[data.priority]) throw badRequest('Prioridade inválida.');
    o.priority = data.priority;
  }
  if (data.next_action_at !== undefined) o.next_action_at = toIso(data.next_action_at);
  if (data.product_id !== undefined) {
    o.product_id = data.product_id ? Number(data.product_id) : null;
    if (o.product_id && !db.prepare('SELECT 1 FROM products WHERE id = ?').get(o.product_id)) throw badRequest('Produto inválido.');
  }
  if (data.company_contact_id !== undefined) {
    o.company_contact_id = data.company_contact_id ? Number(data.company_contact_id) : null;
    if (o.company_contact_id && !db.prepare('SELECT 1 FROM company_contacts WHERE id = ? AND company_id = ?').get(o.company_contact_id, contactId)) {
      throw badRequest('Contato da empresa não pertence a este cadastro.');
    }
  }
  if (data.owner_id !== undefined) o.owner_id = data.owner_id ? Number(data.owner_id) : null;
  if (data.custom !== undefined) {
    const { validateCustom } = require('./contacts');
    const defs = validateCustom(db, 'opportunity', data.custom);
    o.custom = defs;
  }
  return o;
}

function firstOpenStage(db, relationship) {
  // Lead (demonstrou interesse) já entra na etapa "Lead"; os demais começam em "Prospect"
  if (relationship === 'lead') {
    const lead = db.prepare("SELECT * FROM pipeline_stages WHERE active = 1 AND kind = 'aberta' AND key = 'lead'").get();
    if (lead) return lead;
  }
  const s = db.prepare("SELECT * FROM pipeline_stages WHERE active = 1 AND kind = 'aberta' ORDER BY position LIMIT 1").get();
  if (!s) throw badRequest('Nenhuma etapa aberta configurada no funil.');
  return s;
}

/** Cria a oportunidade sem checagens de acesso (chamada por serviços que já validaram). */
function createOpportunityRow(db, user, data) {
  const contact = db.prepare('SELECT id, owner_id, code, relationship FROM contacts WHERE id = ?').get(Number(data.contact_id));
  const o = normalizeOpp(db, data, contact.id);
  let stage = firstOpenStage(db, contact.relationship);
  if (data.stage_id) {
    stage = db.prepare('SELECT * FROM pipeline_stages WHERE id = ? AND active = 1').get(Number(data.stage_id));
    if (!stage || stage.kind !== 'aberta') throw badRequest('Oportunidades novas devem iniciar em uma etapa aberta.');
  }
  if (o.product_id && !o.credit_category) {
    o.credit_category = db.prepare('SELECT category FROM products WHERE id = ?').get(o.product_id)?.category || null;
  }
  const now = nowIso();
  const code = nextCode(db, 'opportunity', 'OP');
  const row = {
    priority: 'media',
    custom: '{}',
    ...o,
    code,
    uid: uuid(),
    contact_id: contact.id,
    stage_id: stage.id,
    status: 'aberta',
    owner_id: o.owner_id ?? contact.owner_id ?? user.id,
    stage_entered_at: now,
    created_by: user.id,
    updated_by: user.id,
    created_at: now,
    updated_at: now,
  };
  const cols = Object.keys(row);
  const r = db.prepare(`INSERT INTO opportunities (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c] ?? null));
  const id = Number(r.lastInsertRowid);
  db.prepare(
    'INSERT INTO stage_history (opportunity_id, from_stage_id, to_stage_id, from_stage_name, to_stage_name, user_id, moved_at) VALUES (?, NULL, ?, NULL, ?, ?, ?)',
  ).run(id, stage.id, stage.name, user.id, now);
  insertActivity(db, {
    contact_id: contact.id,
    opportunity_id: id,
    type: 'cadastro',
    notes: `Oportunidade ${code} criada na etapa "${stage.name}".`,
    user_id: user.id,
  });
  audit(db, user, 'opportunity', id, 'criada', { code, etapa: stage.name }, contact.id);
  return { id, code };
}

function createOpportunity(db, user, data) {
  const c = loadContact(db, user, data.contact_id, { write: true });
  if (c.merged_into_id) throw badRequest('Cadastro mesclado. Use o cadastro de destino.');
  if (c.anonymized_at) throw badRequest('Cadastro anonimizado.');
  const owner = data.owner_id ? Number(data.owner_id) : c.owner_id || user.id;
  if (user.role === 'consultor' && owner !== user.id) throw forbidden('Especialistas só podem criar oportunidades sob sua responsabilidade.');
  assertAssignable(db, user, owner);
  return tx(db, () => createOpportunityRow(db, user, { ...data, contact_id: c.id, owner_id: owner }));
}

function loadOpp(db, user, id, { write = false } = {}) {
  const o = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(Number(id));
  if (!o) throw notFound('Oportunidade não encontrada.');
  loadContact(db, user, o.contact_id, { write });
  return o;
}

function updateOpportunity(db, user, id, data) {
  const before = loadOpp(db, user, id, { write: true });
  const o = normalizeOpp(db, data, before.contact_id);
  delete o.pause_reason;
  if (o.owner_id !== undefined && o.owner_id !== before.owner_id) {
    if (!isManager(user)) throw forbidden('Apenas líderes de equipe e administradores podem transferir oportunidades.');
    assertAssignable(db, user, o.owner_id);
  }
  const changes = diff(before, o, OPP_FIELDS);
  if (!Object.keys(changes).length) return { changed: false };
  if (changes.strategy) {
    o.strategy_validated_by = null;
    o.strategy_validated_at = null;
  }
  o.updated_at = nowIso();
  o.updated_by = user.id;
  tx(db, () => {
    const u = buildUpdate('opportunities', before.id, o, [...OPP_FIELDS, 'strategy_validated_by', 'strategy_validated_at', 'updated_at', 'updated_by']);
    db.prepare(u.sql).run(...u.params);
    audit(db, user, 'opportunity', before.id, 'alterada', changes, before.contact_id);
  });
  return { changed: true };
}

function validateStrategy(db, user, id) {
  const o = loadOpp(db, user, id, { write: true });
  if (!o.strategy) throw badRequest('Defina a estratégia antes de validá-la.');
  const now = nowIso();
  tx(db, () => {
    db.prepare('UPDATE opportunities SET strategy_validated_by = ?, strategy_validated_at = ?, updated_at = ? WHERE id = ?').run(user.id, now, now, o.id);
    insertActivity(db, {
      contact_id: o.contact_id,
      opportunity_id: o.id,
      type: 'observacao',
      notes: `Estratégia "${optionLabel(db, 'estrategia', o.strategy)}" validada pelo consultor ${user.name}.`,
      user_id: user.id,
    });
    audit(db, user, 'opportunity', o.id, 'estrategia_validada', { estrategia: o.strategy }, o.contact_id);
  });
}

const STATUS_BY_KIND = { aberta: 'aberta', ganho: 'ganha', perdido: 'perdida', nutricao: 'pausada' };

function moveStage(db, user, id, data, opts = {}) {
  const o = loadOpp(db, user, id, { write: true });
  const to = db.prepare('SELECT * FROM pipeline_stages WHERE id = ? AND active = 1').get(Number(data.stage_id));
  if (!to) throw badRequest('Etapa de destino inválida.');
  if (to.id === o.stage_id) return { changed: false };
  const from = db.prepare('SELECT * FROM pipeline_stages WHERE id = ?').get(o.stage_id);
  const { validateMove } = require('./pipeline');
  const check = validateMove(db, user, o, from, to, data, opts);
  if (to.kind === 'nutricao') {
    if (!clean(data.pause_reason) && !clean(data.reason)) throw badRequest('Informe o motivo para mover o negócio para "Nutrição futura".');
    if (!toIso(data.return_at)) throw badRequest('Informe a data para retomar o contato com o lead.');
  }
  const lostReason = clean(data.lost_reason);
  const reason = clean(data.reason);
  if (to.kind === 'perdido') {
    if (!lostReason) throw badRequest('Informe o motivo da perda para mover a oportunidade para "Perdido".');
    assertOption(db, 'motivo_perda', lostReason, 'motivo da perda');
  }
  const now = nowIso();
  return tx(db, () => {
    const seconds = Math.max(0, Math.round((Date.parse(now) - Date.parse(o.stage_entered_at)) / 1000));
    const upd = { stage_id: to.id, status: STATUS_BY_KIND[to.kind], stage_entered_at: now, updated_at: now, updated_by: user.id };
    if (to.kind === 'perdido') {
      upd.lost_reason = lostReason;
      upd.lost_notes = clean(data.lost_notes);
      upd.closed_at = now;
    } else if (to.kind === 'ganho') {
      upd.closed_at = now;
    } else if (to.kind === 'nutricao') {
      upd.pause_reason = clean(data.pause_reason) || reason;
      upd.closed_at = null;
    } else {
      upd.closed_at = null;
      if (o.status === 'perdida') {
        upd.lost_reason = null;
        upd.lost_notes = null;
      }
    }
    const u = buildUpdate('opportunities', o.id, upd, Object.keys(upd));
    db.prepare(u.sql).run(...u.params);
    const baseReason =
      to.kind === 'perdido'
        ? `${optionLabel(db, 'motivo_perda', lostReason)}${upd.lost_notes ? ` — ${upd.lost_notes}` : ''}`
        : to.kind === 'nutricao'
          ? upd.pause_reason
          : reason;
    const reasonText = [baseReason, check.forced ? '(passagem forçada pelo administrador)' : null].filter(Boolean).join(' ') || null;
    if (to.kind === 'nutricao') {
      db.prepare("INSERT INTO tasks (contact_id, opportunity_id, type, title, notes, due_at, assigned_to, created_by, created_at, updated_at) VALUES (?, ?, 'follow_up', ?, ?, ?, ?, ?, ?, ?)")
        .run(o.contact_id, o.id, 'Retomar contato (nutrição futura)', upd.pause_reason, toIso(data.return_at), o.owner_id ?? user.id, user.id, now, now);
    }
    // Prospect que avança no funil passa a ser lead
    if (to.key && to.key !== 'prospect' && to.kind === 'aberta') {
      db.prepare("UPDATE contacts SET relationship = 'lead', updated_at = ? WHERE id = ? AND relationship = 'prospect'").run(now, o.contact_id);
    }
    db.prepare(
      `INSERT INTO stage_history (opportunity_id, from_stage_id, to_stage_id, from_stage_name, to_stage_name, seconds_in_previous, reason, user_id, moved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(o.id, from?.id ?? null, to.id, from?.name ?? null, to.name, seconds, reasonText ?? null, user.id, now);
    insertActivity(db, {
      contact_id: o.contact_id,
      opportunity_id: o.id,
      type: 'mudanca_etapa',
      notes: `${o.code}: "${from?.name ?? '—'}" → "${to.name}"${reasonText ? `. Motivo: ${reasonText}` : ''}`,
      user_id: user.id,
    });
    audit(db, user, 'opportunity', o.id, check.forced ? 'etapa_forcada' : 'etapa_alterada', { etapa: [from?.name, to.name], motivo: reasonText ?? null }, o.contact_id);
    let contract = null;
    if (to.kind === 'ganho') {
      const c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(o.contact_id);
      db.prepare(
        "UPDATE contacts SET relationship = 'cliente', lead_status = 'convertido', client_status = 'ativo', converted_at = COALESCE(converted_at, ?), updated_at = ? WHERE id = ?",
      ).run(now, now, c.id);
      if (c.relationship !== 'cliente') {
        insertActivity(db, { contact_id: c.id, opportunity_id: o.id, type: 'cadastro', notes: `Cadastro convertido em cliente pela venda ${o.code}. Histórico preservado.`, user_id: user.id });
        audit(db, user, 'contact', c.id, 'convertido_cliente', { oportunidade: o.code }, c.id);
      }
      if (data.contract) {
        const { createContractRow } = require('./clients');
        contract = createContractRow(db, user, { ...data.contract, contact_id: c.id, opportunity_id: o.id });
      }
    }
    return { changed: true, contract };
  });
}

/* ------------------------- Consultas ------------------------- */

function oppFilters(db, user, q) {
  const where = ['c.merged_into_id IS NULL'];
  const params = [];
  const s = contactScope(db, user, 'c');
  where.push(s.sql);
  params.push(...s.params);
  if (q.owner_id) {
    where.push('o.owner_id = ?');
    params.push(Number(q.owner_id));
  }
  if (q.product_id) {
    where.push('o.product_id = ?');
    params.push(Number(q.product_id));
  }
  if (q.stage_id) {
    where.push('o.stage_id = ?');
    params.push(Number(q.stage_id));
  }
  if (q.origin) {
    where.push('c.origin = ?');
    params.push(q.origin);
  }
  if (q.priority) {
    where.push('o.priority = ?');
    params.push(q.priority);
  }
  if (q.status) {
    const vals = String(q.status).split(',');
    where.push(`o.status IN (${vals.map(() => '?').join(',')})`);
    params.push(...vals);
  }
  if (q.contact_id) {
    where.push('o.contact_id = ?');
    params.push(Number(q.contact_id));
  }
  if (q.next_action === 'atrasada') where.push("o.next_action_at IS NOT NULL AND o.next_action_at < strftime('%Y-%m-%dT%H:%M:%fZ','now') AND o.status = 'aberta'");
  if (q.next_action === 'hoje') where.push("date(o.next_action_at, 'localtime') = date('now', 'localtime')");
  if (q.next_action === 'sem') where.push("o.next_action IS NULL AND o.status = 'aberta'");
  if (q.q) {
    where.push('(c.name LIKE ? OR o.code = ? OR o.title LIKE ? OR c.code = ?)');
    params.push(`%${q.q}%`, String(q.q).toUpperCase(), `%${q.q}%`, String(q.q).toUpperCase());
  }
  if (q.from) {
    where.push('o.created_at >= ?');
    params.push(toIso(q.from));
  }
  if (q.to) {
    where.push('o.created_at <= ?');
    params.push(toIso(q.to));
  }
  return { where, params };
}

const OPP_SELECT = `SELECT o.*, c.name AS contact_name, c.code AS contact_code, c.kind AS contact_kind, c.origin AS contact_origin,
  c.optouts AS contact_optouts, s.name AS stage_name, s.kind AS stage_kind, p.name AS product_name, u.name AS owner_name,
  (SELECT t.title || '|' || t.due_at FROM tasks t WHERE t.opportunity_id = o.id AND t.status = 'pendente' ORDER BY t.due_at LIMIT 1) AS next_task
  FROM opportunities o JOIN contacts c ON c.id = o.contact_id JOIN pipeline_stages s ON s.id = o.stage_id
  LEFT JOIN products p ON p.id = o.product_id LEFT JOIN users u ON u.id = o.owner_id`;

function decorate(db, rows) {
  const stalledDays = Number(getSetting(db, 'stalled_days')) || 7;
  const now = Date.now();
  for (const r of rows) {
    const last = Date.parse(r.last_activity_at || r.stage_entered_at);
    r.days_in_stage = Math.floor((now - Date.parse(r.stage_entered_at)) / 86400000);
    r.days_without_activity = Math.floor((now - last) / 86400000);
    r.stalled = r.status === 'aberta' && r.days_without_activity >= stalledDays;
    r.contact_optouts = JSON.parse(r.contact_optouts || '[]');
    if (r.next_task) {
      const i = r.next_task.lastIndexOf('|');
      const t = { title: r.next_task.slice(0, i), due_at: r.next_task.slice(i + 1) };
      if (!r.next_action_at || t.due_at < r.next_action_at) {
        r.next_action = t.title;
        r.next_action_at = t.due_at;
      }
    }
    delete r.next_task;
    r.custom = JSON.parse(r.custom || '{}');
  }
  return rows;
}

function board(db, user, q) {
  const stages = db.prepare('SELECT * FROM pipeline_stages WHERE active = 1 ORDER BY position').all();
  const { where, params } = oppFilters(db, user, q);
  const closedDays = Number(q.closed_days) || 60;
  where.push(`(o.status IN ('aberta','pausada') OR o.closed_at >= ?)`);
  params.push(new Date(Date.now() - closedDays * 86400000).toISOString());
  const rows = decorate(db, db.prepare(`${OPP_SELECT} WHERE ${where.join(' AND ')} ORDER BY o.stage_entered_at`).all(...params));
  return {
    stages: stages.map((s) => {
      const cards = rows.filter((r) => r.stage_id === s.id);
      return { ...s, count: cards.length, total_credit: cards.reduce((a, r) => a + (r.credit_value || 0), 0), cards };
    }),
    closed_days: closedDays,
  };
}

function listOpportunities(db, user, q) {
  const { where, params } = oppFilters(db, user, q);
  const { limit, offset, page } = q.all ? { limit: 100000, offset: 0, page: 1 } : paging(q);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM opportunities o JOIN contacts c ON c.id = o.contact_id WHERE ${where.join(' AND ')}`).get(...params).n;
  const rows = decorate(db, db.prepare(`${OPP_SELECT} WHERE ${where.join(' AND ')} ORDER BY o.updated_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset));
  return { total, page, limit, rows };
}

function getOpportunity(db, user, id) {
  const o = loadOpp(db, user, id);
  const row = decorate(db, [db.prepare(`${OPP_SELECT} WHERE o.id = ?`).get(o.id)])[0];
  row.stage_history = db
    .prepare('SELECT h.*, u.name AS user_name FROM stage_history h LEFT JOIN users u ON u.id = h.user_id WHERE h.opportunity_id = ? ORDER BY h.moved_at, h.id')
    .all(o.id);
  row.simulations = db.prepare('SELECT s.*, u.name AS user_name FROM simulations s LEFT JOIN users u ON u.id = s.user_id WHERE s.opportunity_id = ? ORDER BY s.created_at DESC').all(o.id);
  row.proposals = db.prepare('SELECT pr.*, p.name AS product_name FROM proposals pr LEFT JOIN products p ON p.id = pr.product_id WHERE pr.opportunity_id = ? ORDER BY pr.created_at DESC').all(o.id);
  row.tasks = db.prepare('SELECT t.*, u.name AS assigned_name FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to WHERE t.opportunity_id = ? ORDER BY t.status = \'pendente\' DESC, t.due_at').all(o.id);
  row.contracts = db.prepare('SELECT * FROM contracts WHERE opportunity_id = ?').all(o.id);
  row.activities = listActivities(db, user, { opportunity_id: o.id, limit: 200 }).rows;
  row.company_contacts = db.prepare('SELECT id, name, role FROM company_contacts WHERE company_id = ? AND active = 1').all(o.contact_id);
  row.strategy_validated_by_name = o.strategy_validated_by ? db.prepare('SELECT name FROM users WHERE id = ?').get(o.strategy_validated_by)?.name : null;
  return row;
}

/* ------------------------- Configuração do funil ------------------------- */

function listStages(db, includeInactive) {
  return db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM opportunities o WHERE o.stage_id = s.id) AS opp_count FROM pipeline_stages s
       ${includeInactive ? '' : 'WHERE s.active = 1'} ORDER BY s.active DESC, s.position`,
    )
    .all();
}

function saveStage(db, user, data) {
  requireAdmin(user);
  const name = clean(data.name);
  if (!name) throw badRequest('Informe o nome da etapa.');
  const now = nowIso();
  if (data.id) {
    const s = db.prepare('SELECT * FROM pipeline_stages WHERE id = ?').get(Number(data.id));
    if (!s) throw notFound();
    let active = data.active === undefined ? s.active : data.active ? 1 : 0;
    if (!active && ['ganho', 'perdido'].includes(s.kind)) throw badRequest('As etapas de venda concluída e perda são obrigatórias e não podem ser desativadas.');
    if (!active && s.active) {
      const n = db.prepare('SELECT COUNT(*) AS n FROM opportunities WHERE stage_id = ?').get(s.id).n;
      if (n) throw badRequest(`Existem ${n} oportunidades nesta etapa. Mova-as antes de desativá-la.`);
    }
    const playbook = data.playbook !== undefined ? clean(data.playbook) : s.playbook;
    const rot = data.rot_days !== undefined ? (data.rot_days === '' || data.rot_days == null ? null : Number(data.rot_days)) : s.rot_days;
    if (rot != null && (!Number.isInteger(rot) || rot < 1 || rot > 365)) throw badRequest('Dias para considerar parado: entre 1 e 365.');
    const training = data.training_id !== undefined ? (data.training_id ? Number(data.training_id) : null) : s.training_id;
    db.prepare('UPDATE pipeline_stages SET name = ?, active = ?, playbook = ?, rot_days = ?, training_id = ? WHERE id = ?').run(name, active, playbook ?? null, rot, training, s.id);
    audit(db, user, 'stage', s.id, 'alterada', diff(s, { name, active, playbook, rot_days: rot }, ['name', 'active', 'playbook', 'rot_days']));
    return s.id;
  }
  const kind = data.kind || 'aberta';
  if (!['aberta', 'nutricao'].includes(kind)) throw badRequest('Novas etapas podem ser do tipo "aberta" ou "nutrição".');
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM pipeline_stages').get().p;
  const r = db.prepare('INSERT INTO pipeline_stages (name, position, kind, created_at) VALUES (?, ?, ?, ?)').run(name, pos, kind, now);
  audit(db, user, 'stage', Number(r.lastInsertRowid), 'criada', { name, kind });
  return Number(r.lastInsertRowid);
}

function reorderStages(db, user, ids) {
  requireAdmin(user);
  if (!Array.isArray(ids)) throw badRequest('Lista de etapas inválida.');
  tx(db, () => {
    ids.forEach((id, i) => db.prepare('UPDATE pipeline_stages SET position = ? WHERE id = ?').run(i, Number(id)));
    audit(db, user, 'stage', null, 'reordenadas', { ordem: ids });
  });
}

module.exports = {
  createOpportunity,
  createOpportunityRow,
  updateOpportunity,
  validateStrategy,
  moveStage,
  board,
  listOpportunities,
  getOpportunity,
  loadOpp,
  listStages,
  saveStage,
  reorderStages,
  assertOption,
};
