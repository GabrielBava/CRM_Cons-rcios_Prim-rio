'use strict';
const { PROPOSAL_STATUS } = require('../constants');
const { loadContact, childScope, audit, diff, paging } = require('../core');
const { badRequest, notFound, clean, toNumber, toDateOnly, nowIso } = require('../util');
const { tx, nextCode } = require('../db');
const { insertActivity } = require('./activities');
const { assertOption, loadOpp } = require('./opportunities');

const COMMERCIAL_FIELDS = [
  'product_id', 'credit_value', 'term_months', 'initial_installment', 'payment_modality', 'admin_fee_pct', 'reserve_fund_pct',
  'insurance_pct', 'other_costs', 'readjustment_index', 'readjustment_assumptions', 'strategy', 'valid_until', 'simulation_id',
];
const FREE_FIELDS = ['link_url', 'notes'];
const FINAL = ['aprovada', 'recusada', 'expirada', 'substituida'];

function normalize(db, data, contactId) {
  const o = {};
  for (const f of ['other_costs', 'readjustment_assumptions', 'notes']) if (data[f] !== undefined) o[f] = clean(data[f]);
  for (const f of ['credit_value', 'initial_installment']) {
    if (data[f] !== undefined) {
      o[f] = toNumber(data[f]);
      if (o[f] != null && o[f] < 0) throw badRequest('Valores não podem ser negativos.');
    }
  }
  for (const f of ['admin_fee_pct', 'reserve_fund_pct', 'insurance_pct']) {
    if (data[f] !== undefined) {
      o[f] = toNumber(data[f]);
      if (o[f] != null && (o[f] < 0 || o[f] > 100)) throw badRequest('Percentuais devem estar entre 0 e 100.');
    }
  }
  if (data.term_months !== undefined) {
    const n = toNumber(data.term_months);
    if (n != null && (!Number.isInteger(n) || n <= 0)) throw badRequest('Prazo deve ser um número inteiro de meses.');
    o.term_months = n;
  }
  if (data.payment_modality !== undefined) {
    o.payment_modality = clean(data.payment_modality);
    assertOption(db, 'modalidade_pagamento', o.payment_modality, 'modalidade de pagamento');
  }
  if (data.strategy !== undefined) {
    o.strategy = clean(data.strategy);
    assertOption(db, 'estrategia', o.strategy, 'estratégia');
  }
  if (data.readjustment_index !== undefined) {
    o.readjustment_index = clean(data.readjustment_index);
    assertOption(db, 'indice_reajuste', o.readjustment_index, 'índice de reajuste');
  }
  if (data.valid_until !== undefined) o.valid_until = toDateOnly(data.valid_until);
  if (data.product_id !== undefined) {
    o.product_id = data.product_id ? Number(data.product_id) : null;
    if (o.product_id && !db.prepare('SELECT 1 FROM products WHERE id = ?').get(o.product_id)) throw badRequest('Produto inválido.');
  }
  if (data.link_url !== undefined) {
    o.link_url = clean(data.link_url);
    if (o.link_url) {
      try {
        const u = new URL(o.link_url);
        if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
      } catch {
        throw badRequest('Link da proposta inválido.');
      }
    }
  }
  if (data.simulation_id !== undefined) {
    o.simulation_id = data.simulation_id ? Number(data.simulation_id) : null;
    if (o.simulation_id && !db.prepare('SELECT 1 FROM simulations WHERE id = ? AND contact_id = ?').get(o.simulation_id, contactId)) {
      throw badRequest('Simulação não pertence a este lead.');
    }
  }
  return o;
}

function insertProposal(db, user, row) {
  const now = nowIso();
  const full = { status: 'rascunho', version: 1, ...row, code: nextCode(db, 'proposal', 'PR'), owner_id: row.owner_id ?? user.id, created_by: user.id, created_at: now, updated_at: now };
  if (full.status === 'apresentada') full.presented_at = now;
  const cols = Object.keys(full);
  const r = db.prepare(`INSERT INTO proposals (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => full[c] ?? null));
  return { id: Number(r.lastInsertRowid), code: full.code, version: full.version };
}

function createProposal(db, user, data) {
  const opp = loadOpp(db, user, data.opportunity_id, { write: true });
  const o = normalize(db, data, opp.contact_id);
  if (o.simulation_id) {
    // Pré-preenche com a simulação escolhida, sem sobrescrever o que foi informado
    const s = db.prepare('SELECT * FROM simulations WHERE id = ?').get(o.simulation_id);
    for (const [pf, sf] of [['credit_value', 'credit_value'], ['term_months', 'term_months'], ['initial_installment', 'installment'], ['payment_modality', 'payment_modality'], ['strategy', 'strategy']]) {
      if (o[pf] == null && s[sf] != null) o[pf] = s[sf];
    }
  }
  if (o.product_id == null && opp.product_id) o.product_id = opp.product_id;
  const status = data.status && ['rascunho', 'apresentada', 'em_analise'].includes(data.status) ? data.status : 'rascunho';
  return tx(db, () => {
    const res = insertProposal(db, user, { ...o, contact_id: opp.contact_id, opportunity_id: opp.id, status, owner_id: opp.owner_id });
    insertActivity(db, { contact_id: opp.contact_id, opportunity_id: opp.id, type: 'proposta', notes: `Proposta ${res.code} (v1) criada — ${PROPOSAL_STATUS[status]}.`, user_id: user.id, ref_type: 'proposal', ref_id: res.id });
    audit(db, user, 'proposal', res.id, 'criada', { code: res.code, status }, opp.contact_id);
    return res;
  });
}

function loadProposal(db, user, id, write) {
  const p = db.prepare('SELECT * FROM proposals WHERE id = ?').get(Number(id));
  if (!p) throw notFound('Proposta não encontrada.');
  loadContact(db, user, p.contact_id, { write });
  return p;
}

function updateProposal(db, user, id, data) {
  const p = loadProposal(db, user, id, true);
  const o = normalize(db, data, p.contact_id);
  const commercialChanged = COMMERCIAL_FIELDS.filter((f) => o[f] !== undefined && String(o[f] ?? '') !== String(p[f] ?? ''));
  if (commercialChanged.length && p.status !== 'rascunho') {
    throw badRequest('Propostas já apresentadas não podem ter condições alteradas. Crie uma nova versão.');
  }
  if (FINAL.includes(p.status) && Object.keys(o).length) throw badRequest('Propostas encerradas não podem ser alteradas.');
  const changes = diff(p, o, [...COMMERCIAL_FIELDS, ...FREE_FIELDS]);
  if (!Object.keys(changes).length) return;
  const keys = Object.keys(o);
  tx(db, () => {
    db.prepare(`UPDATE proposals SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => o[k]), nowIso(), p.id);
    audit(db, user, 'proposal', p.id, 'alterada', changes, p.contact_id);
  });
}

function changeStatus(db, user, id, data) {
  const p = loadProposal(db, user, id, true);
  const status = data.status;
  if (!PROPOSAL_STATUS[status]) throw badRequest('Status inválido.');
  if (status === p.status) return;
  if (FINAL.includes(p.status)) throw badRequest(`A proposta está "${PROPOSAL_STATUS[p.status]}" e não pode mudar de status. Crie uma nova versão se necessário.`);
  if (status === 'substituida') throw badRequest('O status "substituída" é definido automaticamente ao criar uma nova versão.');
  const now = nowIso();
  tx(db, () => {
    db.prepare('UPDATE proposals SET status = ?, presented_at = CASE WHEN ? = \'apresentada\' AND presented_at IS NULL THEN ? ELSE presented_at END, updated_at = ? WHERE id = ?').run(status, status, now, now, p.id);
    insertActivity(db, {
      contact_id: p.contact_id,
      opportunity_id: p.opportunity_id,
      type: 'proposta',
      notes: `Proposta ${p.code} (v${p.version}): ${PROPOSAL_STATUS[p.status]} → ${PROPOSAL_STATUS[status]}${clean(data.notes) ? `. ${clean(data.notes)}` : ''}`,
      user_id: user.id,
      ref_type: 'proposal',
      ref_id: p.id,
    });
    audit(db, user, 'proposal', p.id, 'status_alterado', { status: [p.status, status] }, p.contact_id);
  });
}

function newVersion(db, user, id, data) {
  const p = loadProposal(db, user, id, true);
  if (p.status === 'substituida') throw badRequest('Esta versão já foi substituída. Use a versão mais recente.');
  const child = db.prepare('SELECT code FROM proposals WHERE previous_id = ?').get(p.id);
  if (child) throw badRequest(`Já existe uma versão mais recente (${child.code}).`);
  const o = normalize(db, data || {}, p.contact_id);
  const base = {};
  for (const f of [...COMMERCIAL_FIELDS, 'link_url']) base[f] = p[f];
  return tx(db, () => {
    const res = insertProposal(db, user, {
      ...base,
      ...o,
      contact_id: p.contact_id,
      opportunity_id: p.opportunity_id,
      version: p.version + 1,
      previous_id: p.id,
      status: 'rascunho',
      owner_id: p.owner_id,
    });
    if (!FINAL.includes(p.status)) {
      db.prepare("UPDATE proposals SET status = 'substituida', updated_at = ? WHERE id = ?").run(nowIso(), p.id);
    }
    insertActivity(db, {
      contact_id: p.contact_id,
      opportunity_id: p.opportunity_id,
      type: 'proposta',
      notes: `Nova versão da proposta: ${res.code} (v${p.version + 1}) substitui ${p.code} (v${p.version}).`,
      user_id: user.id,
      ref_type: 'proposal',
      ref_id: res.id,
    });
    audit(db, user, 'proposal', res.id, 'nova_versao', { anterior: p.code }, p.contact_id);
    audit(db, user, 'proposal', p.id, 'substituida', { nova: res.code }, p.contact_id);
    return res;
  });
}

function expireSweep(db) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.prepare("SELECT * FROM proposals WHERE status IN ('rascunho','apresentada','em_analise') AND valid_until IS NOT NULL AND valid_until < ?").all(today);
  for (const p of rows) {
    tx(db, () => {
      db.prepare("UPDATE proposals SET status = 'expirada', updated_at = ? WHERE id = ?").run(nowIso(), p.id);
      insertActivity(db, { contact_id: p.contact_id, opportunity_id: p.opportunity_id, type: 'proposta', notes: `Proposta ${p.code} expirou (validade ${p.valid_until}).`, ref_type: 'proposal', ref_id: p.id });
      audit(db, null, 'proposal', p.id, 'expirada', { validade: p.valid_until }, p.contact_id);
    });
  }
  return rows.length;
}

function getProposal(db, user, id) {
  const p = loadProposal(db, user, id, false);
  const row = db
    .prepare(`SELECT pr.*, c.name AS contact_name, c.code AS contact_code, o.code AS opportunity_code, pd.name AS product_name, s.code AS simulation_code, u.name AS owner_name
      FROM proposals pr JOIN contacts c ON c.id = pr.contact_id JOIN opportunities o ON o.id = pr.opportunity_id LEFT JOIN products pd ON pd.id = pr.product_id
      LEFT JOIN simulations s ON s.id = pr.simulation_id LEFT JOIN users u ON u.id = pr.owner_id WHERE pr.id = ?`)
    .get(p.id);
  // Cadeia de versões (anteriores e posteriores)
  const chain = [];
  let prevId = p.previous_id;
  while (prevId) {
    const r = db.prepare('SELECT id, code, version, status, created_at, previous_id FROM proposals WHERE id = ?').get(prevId);
    if (!r) break;
    chain.unshift(r);
    prevId = r.previous_id;
  }
  chain.push({ id: p.id, code: p.code, version: p.version, status: p.status, created_at: p.created_at, current: true });
  let next = db.prepare('SELECT id, code, version, status, created_at FROM proposals WHERE previous_id = ?').get(p.id);
  while (next) {
    chain.push(next);
    next = db.prepare('SELECT id, code, version, status, created_at FROM proposals WHERE previous_id = ?').get(next.id);
  }
  row.versions = chain;
  row.history = db.prepare('SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.entity = \'proposal\' AND a.entity_id = ? ORDER BY a.id DESC').all(p.id)
    .map((r) => ({ ...r, changes: r.changes ? JSON.parse(r.changes) : null }));
  return row;
}

function listProposals(db, user, q) {
  const sc = childScope(db, user, 'pr');
  const where = [sc.sql];
  const params = [...sc.params];
  for (const [k, col] of [['status', 'pr.status'], ['opportunity_id', 'pr.opportunity_id'], ['contact_id', 'pr.contact_id'], ['owner_id', 'pr.owner_id'], ['product_id', 'pr.product_id']]) {
    if (q[k]) {
      where.push(`${col} = ?`);
      params.push(['status'].includes(k) ? q[k] : Number(q[k]));
    }
  }
  if (q.current === '1') where.push("pr.status <> 'substituida'");
  if (q.from) {
    where.push('pr.created_at >= ?');
    params.push(q.from);
  }
  if (q.to) {
    where.push('pr.created_at <= ?');
    params.push(q.to);
  }
  const { limit, offset, page } = q.all ? { limit: 100000, offset: 0, page: 1 } : paging(q);
  const base = `FROM proposals pr JOIN contacts c ON c.id = pr.contact_id JOIN opportunities o ON o.id = pr.opportunity_id
    LEFT JOIN products pd ON pd.id = pr.product_id LEFT JOIN users u ON u.id = pr.owner_id WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) AS n ${base}`).get(...params).n;
  const rows = db
    .prepare(`SELECT pr.*, c.name AS contact_name, c.code AS contact_code, o.code AS opportunity_code, pd.name AS product_name, u.name AS owner_name
      ${base} ORDER BY pr.created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  return { total, page, limit, rows };
}

module.exports = { createProposal, updateProposal, changeStatus, newVersion, expireSweep, getProposal, listProposals };
