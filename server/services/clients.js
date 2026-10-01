'use strict';
const { loadContact, childScope, contactScope, audit, diff, buildUpdate, paging } = require('../core');
const { badRequest, notFound, clean, toNumber, toDateOnly, toIso, nowIso } = require('../util');
const { tx, nextCode } = require('../db');
const { insertActivity } = require('./activities');
const { assertOption } = require('./opportunities');

const CONTRACT_FIELDS = [
  'product_id', 'category', 'administrator', 'group_code', 'quota_code', 'credit_value', 'term_months', 'contracted_at', 'quotas',
  'status', 'payment_modality', 'strategy', 'notes', 'proposal_id', 'contract_number', 'installment_value', 'due_day', 'first_due_date',
  'contemplated_at', 'contemplation_type', 'bid_value', 'acquired_asset', 'seller_id', 'sale_value',
];

function normalizeContract(db, data, contactId) {
  const o = {};
  for (const f of ['administrator', 'group_code', 'quota_code', 'notes']) if (data[f] !== undefined) o[f] = clean(data[f]);
  if (data.product_id !== undefined) {
    o.product_id = data.product_id ? Number(data.product_id) : null;
    if (o.product_id && !db.prepare('SELECT 1 FROM products WHERE id = ?').get(o.product_id)) throw badRequest('Produto inválido.');
  }
  if (data.category !== undefined) {
    o.category = clean(data.category);
    assertOption(db, 'categoria_credito', o.category, 'categoria');
  }
  if (data.status !== undefined) {
    o.status = clean(data.status);
    assertOption(db, 'status_contrato', o.status, 'status do contrato');
  }
  if (data.payment_modality !== undefined) {
    o.payment_modality = clean(data.payment_modality);
    assertOption(db, 'modalidade_pagamento', o.payment_modality, 'modalidade de pagamento');
  }
  if (data.strategy !== undefined) {
    o.strategy = clean(data.strategy);
    assertOption(db, 'estrategia', o.strategy, 'estratégia');
  }
  if (data.credit_value !== undefined) o.credit_value = toNumber(data.credit_value);
  for (const f of ['contract_number', 'acquired_asset']) if (data[f] !== undefined) o[f] = clean(data[f]);
  for (const f of ['installment_value', 'bid_value', 'sale_value']) {
    if (data[f] !== undefined) {
      o[f] = toNumber(data[f]);
      if (o[f] != null && o[f] < 0) throw badRequest('Valores não podem ser negativos.');
    }
  }
  if (data.due_day !== undefined) {
    const n = toNumber(data.due_day);
    if (n != null && (!Number.isInteger(n) || n < 1 || n > 31)) throw badRequest('Dia de vencimento deve estar entre 1 e 31.');
    o.due_day = n;
  }
  for (const f of ['first_due_date', 'contemplated_at']) if (data[f] !== undefined) o[f] = toDateOnly(data[f]);
  if (data.contemplation_type !== undefined) {
    o.contemplation_type = clean(data.contemplation_type);
    assertOption(db, 'tipo_contemplacao', o.contemplation_type, 'tipo de contemplação');
  }
  if (data.seller_id !== undefined) {
    o.seller_id = data.seller_id ? Number(data.seller_id) : null;
    if (o.seller_id && !db.prepare('SELECT 1 FROM users WHERE id = ?').get(o.seller_id)) throw badRequest('Vendedor inválido.');
  }
  for (const f of ['term_months', 'quotas']) {
    if (data[f] !== undefined) {
      const n = toNumber(data[f]);
      if (n != null && (!Number.isInteger(n) || n <= 0)) throw badRequest('Prazo e quantidade de cotas devem ser inteiros positivos.');
      o[f] = n;
    }
  }
  if (data.contracted_at !== undefined) o.contracted_at = toDateOnly(data.contracted_at);
  if (data.proposal_id !== undefined) {
    o.proposal_id = data.proposal_id ? Number(data.proposal_id) : null;
    if (o.proposal_id && !db.prepare('SELECT 1 FROM proposals WHERE id = ? AND contact_id = ?').get(o.proposal_id, contactId)) {
      throw badRequest('Proposta não pertence a este cliente.');
    }
  }
  return o;
}

/** Cria um novo produto contratado. Contratos anteriores nunca são sobrescritos. */
function createContractRow(db, user, data) {
  const contactId = Number(data.contact_id);
  const o = normalizeContract(db, data, contactId);
  let opp = null;
  if (data.opportunity_id) {
    opp = db.prepare('SELECT * FROM opportunities WHERE id = ? AND contact_id = ?').get(Number(data.opportunity_id), contactId);
    if (!opp) throw badRequest('Oportunidade não pertence a este cliente.');
    // Completa com os dados comerciais da oportunidade quando não informados
    for (const [f, of] of [['product_id', 'product_id'], ['category', 'credit_category'], ['credit_value', 'credit_value'], ['term_months', 'term_months'],
      ['quotas', 'quotas'], ['payment_modality', 'payment_modality'], ['strategy', 'strategy']]) {
      if (o[f] == null && opp[of] != null) o[f] = opp[of];
    }
  }
  if (o.product_id && !o.administrator) o.administrator = db.prepare('SELECT administrator FROM products WHERE id = ?').get(o.product_id)?.administrator ?? null;
  const now = nowIso();
  const code = nextCode(db, 'contract', 'CT');
  const row = { status: 'em_formalizacao', seller_id: opp?.owner_id ?? user.id, ...o, code, contact_id: contactId, opportunity_id: opp?.id ?? null, owner_id: opp?.owner_id ?? user.id, created_by: user.id, created_at: now, updated_at: now };
  const cols = Object.keys(row);
  const r = db.prepare(`INSERT INTO contracts (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c] ?? null));
  const id = Number(r.lastInsertRowid);
  insertActivity(db, { contact_id: contactId, opportunity_id: opp?.id, type: 'cadastro', notes: `Produto contratado registrado: ${code}.`, user_id: user.id, ref_type: 'contract', ref_id: id });
  audit(db, user, 'contract', id, 'criado', { code }, contactId);
  return { id, code };
}

function createContract(db, user, data) {
  const c = loadContact(db, user, data.contact_id, { write: true });
  return tx(db, () => {
    const res = createContractRow(db, user, { ...data, contact_id: c.id });
    if (c.relationship !== 'cliente') {
      db.prepare("UPDATE contacts SET relationship = 'cliente', client_status = 'ativo', lead_status = 'convertido', converted_at = COALESCE(converted_at, ?) WHERE id = ?").run(nowIso(), c.id);
      audit(db, user, 'contact', c.id, 'convertido_cliente', { contrato: res.code }, c.id);
    }
    return res;
  });
}

function updateContract(db, user, id, data) {
  const k = db.prepare('SELECT * FROM contracts WHERE id = ?').get(Number(id));
  if (!k) throw notFound('Contrato não encontrado.');
  loadContact(db, user, k.contact_id, { write: true });
  const o = normalizeContract(db, data, k.contact_id);
  const changes = diff(k, o, CONTRACT_FIELDS);
  if (!Object.keys(changes).length) return;
  o.updated_at = nowIso();
  tx(db, () => {
    const u = buildUpdate('contracts', k.id, o, [...CONTRACT_FIELDS, 'updated_at']);
    db.prepare(u.sql).run(...u.params);
    audit(db, user, 'contract', k.id, 'alterado', changes, k.contact_id);
  });
}

function listContracts(db, user, q) {
  const s = childScope(db, user, 'k');
  const where = [s.sql];
  const params = [...s.params];
  if (q.status) {
    where.push('k.status = ?');
    params.push(q.status);
  }
  if (q.product_id) {
    where.push('k.product_id = ?');
    params.push(Number(q.product_id));
  }
  if (q.owner_id) {
    where.push('k.owner_id = ?');
    params.push(Number(q.owner_id));
  }
  if (q.seller_id) {
    where.push('k.seller_id = ?');
    params.push(Number(q.seller_id));
  }
  if (q.contact_id) {
    where.push('k.contact_id = ?');
    params.push(Number(q.contact_id));
  }
  if (q.from) {
    where.push('k.created_at >= ?');
    params.push(toIso(q.from));
  }
  if (q.to) {
    where.push('k.created_at <= ?');
    params.push(toIso(q.to));
  }
  const { limit, offset, page } = q.all ? { limit: 100000, offset: 0, page: 1 } : paging(q);
  const base = `FROM contracts k JOIN contacts c ON c.id = k.contact_id LEFT JOIN products p ON p.id = k.product_id
    LEFT JOIN users u ON u.id = k.owner_id LEFT JOIN proposals pr ON pr.id = k.proposal_id LEFT JOIN opportunities o ON o.id = k.opportunity_id
    WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) AS n ${base}`).get(...params).n;
  const rows = db
    .prepare(`SELECT k.*, c.name AS contact_name, c.code AS contact_code, p.name AS product_name, u.name AS owner_name, (SELECT name FROM users su WHERE su.id = k.seller_id) AS seller_name, pr.code AS proposal_code, o.code AS opportunity_code
      ${base} ORDER BY k.created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  return { total, page, limit, rows };
}

/**
 * Lista de clientes (menu Clientes): código, nome, situação, contato, responsável pós-venda, especialista da venda,
 * quantidade de cartas (produtos), crédito contratado, próxima ação e última atividade.
 * Filtros: busca, situação, PF/PJ, responsável pós-venda, especialista e categoria (só imóvel, só veículo, só serviço ou mais de uma).
 */
function listClients(db, user, q = {}) {
  const sc = contactScope(db, user, 'c');
  const where = ["c.relationship = 'cliente'", 'c.merged_into_id IS NULL', 'c.anonymized_at IS NULL', sc.sql];
  const params = [...sc.params];
  const ACTIVE_K = "k.status <> 'cancelado'";
  if (q.q) {
    const term = String(q.q).trim();
    const d = term.replace(/\D/g, '');
    const or = ['c.name LIKE ?', 'c.trade_name LIKE ?', 'c.code = ?', 'c.email_norm LIKE ?'];
    params.push(`%${term}%`, `%${term}%`, term.toUpperCase(), `%${term.toLowerCase()}%`);
    if (d.length >= 4) {
      or.push('c.phone1_norm LIKE ?', 'c.phone2_norm LIKE ?', 'c.whatsapp_norm LIKE ?', 'c.doc = ?');
      params.push(`%${d}%`, `%${d}%`, `%${d}%`, d);
    }
    where.push(`(${or.join(' OR ')})`);
  }
  if (q.active === '1' || q.active === '0') {
    where.push('COALESCE(c.active, 1) = ?');
    params.push(Number(q.active));
  }
  if (q.kind === 'PF' || q.kind === 'PJ') {
    where.push('c.kind = ?');
    params.push(q.kind);
  }
  if (q.postsale_owner_id) {
    where.push('COALESCE(c.postsale_owner_id, c.owner_id) = ?');
    params.push(Number(q.postsale_owner_id));
  }
  const SELLER = `COALESCE((SELECT k.seller_id FROM contracts k WHERE k.contact_id = c.id AND k.seller_id IS NOT NULL ORDER BY k.created_at DESC LIMIT 1), c.owner_id)`;
  if (q.seller_id) {
    where.push(`${SELLER} = ?`);
    params.push(Number(q.seller_id));
  }
  const CATS = `(SELECT GROUP_CONCAT(DISTINCT COALESCE(k.category, p.category)) FROM contracts k LEFT JOIN products p ON p.id = k.product_id WHERE k.contact_id = c.id AND ${ACTIVE_K})`;
  if (q.category) {
    const only = { so_imovel: 'imovel', so_veiculo: 'veiculo', so_servico: 'servico' }[q.category];
    if (only) {
      where.push(`${CATS} = ?`);
      params.push(only);
    } else if (q.category === 'ambas') where.push(`instr(COALESCE(${CATS}, ''), ',') > 0`);
  }
  const base = `FROM contacts c WHERE ${where.join(' AND ')}`;
  const { limit, offset, page } = paging(q);
  const total = db.prepare(`SELECT COUNT(*) AS n ${base}`).get(...params).n;
  const order = { nome: 'c.name COLLATE NOCASE', credito: 'credit_total DESC', recentes: 'c.converted_at DESC' }[q.sort] || 'c.name COLLATE NOCASE';
  const rows = db
    .prepare(`SELECT c.id, c.code, c.name, c.kind, COALESCE(c.active, 1) AS active, c.phone1, c.whatsapp, c.email, c.owner_id, c.converted_at,
      COALESCE(c.postsale_owner_id, c.owner_id) AS postsale_id, ${SELLER} AS seller_id,
      (SELECT COUNT(*) FROM contracts k WHERE k.contact_id = c.id AND ${ACTIVE_K}) AS cartas,
      (SELECT COALESCE(SUM(k.credit_value), 0) FROM contracts k WHERE k.contact_id = c.id AND ${ACTIVE_K}) AS credit_total,
      ${CATS} AS categories,
      (SELECT t.title || '|' || t.due_at FROM tasks t WHERE t.contact_id = c.id AND t.status = 'pendente' ORDER BY t.due_at LIMIT 1) AS next_task,
      (SELECT a.type || '|' || COALESCE(a.occurred_at, a.created_at) FROM activities a WHERE a.contact_id = c.id ORDER BY COALESCE(a.occurred_at, a.created_at) DESC LIMIT 1) AS last_act
      ${base} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  const name = db.prepare('SELECT name FROM users WHERE id = ?');
  const split = (v) => {
    if (!v) return null;
    const i = v.indexOf('|');
    return [v.slice(0, i), v.slice(i + 1)];
  };
  for (const r of rows) {
    r.postsale_name = r.postsale_id ? name.get(r.postsale_id)?.name || null : null;
    r.seller_name = r.seller_id ? name.get(r.seller_id)?.name || null : null;
    r.categories = r.categories ? r.categories.split(',') : [];
    const t = split(r.next_task);
    r.next_action = t ? { title: t[0], due_at: t[1] } : null;
    const a = split(r.last_act);
    r.last_activity = a ? { type: a[0], at: a[1] } : null;
    delete r.next_task;
    delete r.last_act;
  }
  return { total, page, limit, rows };
}

module.exports = { createContract, createContractRow, updateContract, listContracts, listClients };
