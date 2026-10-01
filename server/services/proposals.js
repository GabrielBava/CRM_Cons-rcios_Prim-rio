'use strict';
const { PROPOSAL_STATUS, PROPOSAL_CADENCE } = require('../constants');
const { loadContact, childScope, audit, diff, paging, optionLabel } = require('../core');
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
const ACTIVE = ['rascunho', 'apresentada', 'em_analise'];

/* ------------------------- Esteira de follow-up (D0 a D10) ------------------------- */

// Horários no fuso de Brasília (UTC−3, sem horário de verão)
const SP_OFFSET = 3 * 3600000;
function spDate(base, businessDays, hh, mm) {
  const d = new Date(new Date(base).getTime() - SP_OFFSET);
  let added = 0;
  while (added < businessDays) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (![0, 6].includes(d.getUTCDay())) added++;
  }
  while (businessDays > 0 && [0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(hh, mm, 0, 0);
  return new Date(d.getTime() + SP_OFFSET).toISOString();
}

/**
 * Cria as tarefas da esteira a partir do envio. Enviada pela manhã (até 13h): D0 no fim do dia (17h30).
 * Enviada à tarde: começa no D+1. Depois D+2, D+3, D+5 e D+10 (dias úteis).
 */
function startCadence(db, user, p, sentAt) {
  const localHour = new Date(new Date(sentAt).getTime() - SP_OFFSET).getUTCHours();
  const opp = db.prepare('SELECT owner_id FROM opportunities WHERE id = ?').get(p.opportunity_id);
  const now = nowIso();
  for (const c of PROPOSAL_CADENCE) {
    if (c.days === 0 && localHour >= 13) continue;
    const due = c.days === 0 ? spDate(sentAt, 0, 17, 30) : spDate(sentAt, c.days, 10, 0);
    db.prepare(`INSERT INTO tasks (contact_id, opportunity_id, type, title, notes, due_at, assigned_to, priority, proposal_id, cadence_step, created_by, created_at, updated_at)
      VALUES (?, ?, 'follow_up_proposta', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(p.contact_id, p.opportunity_id, `${c.title} (${p.code})`, c.script, due, p.owner_id ?? opp?.owner_id ?? user.id, c.step === 'D10' ? 'alta' : 'normal', p.id, c.step, user.id, now, now);
  }
  const first = db.prepare("SELECT title, due_at FROM tasks WHERE proposal_id = ? AND status = 'pendente' ORDER BY due_at LIMIT 1").get(p.id);
  if (first) db.prepare('UPDATE opportunities SET next_action = ?, next_action_at = ? WHERE id = ?').run(first.title, first.due_at, p.opportunity_id);
}

function stopCadence(db, proposalId, reason) {
  const now = nowIso();
  db.prepare("UPDATE tasks SET status = 'cancelada', notes = COALESCE(notes, '') || ?, updated_at = ? WHERE proposal_id = ? AND status = 'pendente' AND cadence_step IS NOT NULL").run(`\n[Esteira encerrada: ${reason}]`, now, proposalId);
}

/* ------------------------- Probabilidade de fechamento ------------------------- */

/**
 * Pontuação de 5 a 95 com base em sinais usados em vendas consultivas: temperatura do lead, R1 realizada, decisor
 * definido, parcela dentro da capacidade, resposta do cliente, follow-ups em dia, pré-venda iniciada e tempo sem decisão.
 */
function proposalScore(db, p) {
  if (p.status === 'aprovada') return { score: 100, level: 'fechada', factors: [['Proposta aceita', 0]] };
  if (['recusada', 'expirada', 'substituida'].includes(p.status)) return { score: 0, level: 'encerrada', factors: [] };
  const c = db.prepare('SELECT temperature FROM contacts WHERE id = ?').get(p.contact_id) || {};
  const o = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(p.opportunity_id) || {};
  const f = [];
  let s = 25;
  if (c.temperature === 'quente') f.push(['Lead quente', 20]);
  else if (c.temperature === 'morno') f.push(['Lead morno', 10]);
  else if (c.temperature === 'frio') f.push(['Lead frio', -5]);
  const r1 = db.prepare("SELECT 1 FROM tasks WHERE contact_id = ? AND type = 'reuniao' AND status = 'concluida' AND outcome = 'realizada' LIMIT 1").get(p.contact_id) ||
    db.prepare("SELECT 1 FROM activities WHERE contact_id = ? AND type = 'reuniao_realizada' LIMIT 1").get(p.contact_id);
  f.push(r1 ? ['R1 realizada', 15] : ['Sem R1 registrada', -10]);
  if (o.decision_maker) f.push(['Decisor identificado', 5]);
  if (p.initial_installment && o.installment_max) f.push(p.initial_installment <= o.installment_max ? ['Parcela dentro da capacidade', 15] : ['Parcela acima da capacidade', -15]);
  if (p.last_response) {
    const opt = db.prepare("SELECT label, flags FROM options WHERE list = 'resposta_proposta' AND value = ?").get(p.last_response);
    const pts = JSON.parse(opt?.flags || '{}').score || 0;
    f.push([`Resposta do cliente: ${opt?.label || p.last_response}`, pts]);
  }
  const overdue = db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE proposal_id = ? AND status = 'pendente' AND due_at < ?").get(p.id, nowIso()).n;
  const done = db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE proposal_id = ? AND status = 'concluida'").get(p.id).n;
  if (overdue) f.push([`${overdue} follow-up(s) atrasado(s)`, -10]);
  else if (done) f.push(['Follow-ups em dia', 5]);
  const ps = db.prepare("SELECT status FROM pre_sales WHERE opportunity_id = ? AND status <> 'cancelada' ORDER BY id DESC LIMIT 1").get(p.opportunity_id);
  if (ps) f.push(['Pré-venda iniciada', 15]);
  const sent = p.presented_at ? Math.floor((Date.now() - Date.parse(p.presented_at)) / 86400000) : null;
  if (sent != null && sent > 10) f.push([`${sent} dias sem decisão`, -20]);
  else if (sent != null && sent > 5) f.push([`${sent} dias sem decisão`, -10]);
  if (p.status === 'rascunho') f.push(['Ainda não enviada ao cliente', -10]);
  s += f.reduce((t, [, v]) => t + v, 0);
  s = Math.max(5, Math.min(95, s));
  return { score: s, level: s >= 70 ? 'alta' : s >= 40 ? 'media' : 'baixa', factors: f };
}

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
    const plan = o.product_id && db.prepare('SELECT * FROM products WHERE id = ?').get(o.product_id);
    if (o.product_id && !plan) throw badRequest('Plano inválido.');
    if (plan) {
      if (!o.category && plan.category) o.category = plan.category;
      const credit = o.credit_value !== undefined ? o.credit_value : toNumber(data.credit_value);
      const err = require('./catalog').creditError(plan, credit);
      if (err) throw badRequest(err);
    }
  }
  if (data.category !== undefined && data.category !== '') {
    o.category = clean(data.category);
    assertOption(db, 'categoria_credito', o.category, 'categoria');
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
    const res = insertProposal(db, user, { ...o, category: o.category ?? opp.credit_category ?? null, contact_id: opp.contact_id, opportunity_id: opp.id, status, owner_id: opp.owner_id });
    if (status === 'apresentada') startCadence(db, user, { id: res.id, code: res.code, contact_id: opp.contact_id, opportunity_id: opp.id, owner_id: opp.owner_id }, nowIso());
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
  const extra = {};
  if (status === 'aprovada') {
    extra.accepted_channel = clean(data.accepted_channel);
    if (!extra.accepted_channel) throw badRequest('Informe por qual canal o cliente aceitou a proposta.');
    assertOption(db, 'canal_aceite', extra.accepted_channel, 'canal do aceite');
    extra.accepted_at = toDateOnly(data.accepted_at) || now.slice(0, 10);
    extra.accepted_by = user.id;
  }
  if (status === 'recusada') {
    extra.refusal_reason = clean(data.refusal_reason);
    if (!extra.refusal_reason) throw badRequest('Informe o motivo da recusa.');
    assertOption(db, 'motivo_recusa_proposta', extra.refusal_reason, 'motivo da recusa');
    extra.refusal_notes = clean(data.refusal_notes) ?? null;
    extra.refused_at = now;
    if (data.retake_at) {
      extra.retake_at = toDateOnly(data.retake_at);
      if (!extra.retake_at || extra.retake_at <= now.slice(0, 10)) throw badRequest('A data para retomar o contato deve ser futura.');
    }
  }
  tx(db, () => {
    db.prepare('UPDATE proposals SET status = ?, presented_at = CASE WHEN ? = \'apresentada\' AND presented_at IS NULL THEN ? ELSE presented_at END, updated_at = ? WHERE id = ?').run(status, status, now, now, p.id);
    const ek = Object.keys(extra);
    if (ek.length) db.prepare(`UPDATE proposals SET ${ek.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...ek.map((k) => extra[k]), p.id);
    if (status === 'aprovada') {
      // Aceite: abre a pré-venda (na primeira venda do cliente, gera o link de cadastro para adesão)
      require('./sales').openPreSale(db, user, { proposal_id: p.id });
    }
    if (status === 'apresentada' && !p.presented_at) {
      if (data.sent_channel) db.prepare('UPDATE proposals SET sent_channel = ? WHERE id = ?').run(clean(data.sent_channel), p.id);
      startCadence(db, user, { ...p, status }, now);
    }
    if (FINAL.includes(status)) stopCadence(db, p.id, PROPOSAL_STATUS[status]);
    // Recusa com data de retomada: agenda o novo contato (base para o trabalho de recuperação)
    if (status === 'recusada' && extra.retake_at) {
      db.prepare(`INSERT INTO tasks (contact_id, opportunity_id, type, title, notes, due_at, assigned_to, priority, proposal_id, created_by, created_at, updated_at)
        VALUES (?, ?, 'retorno', ?, ?, ?, ?, 'normal', ?, ?, ?, ?)`)
        .run(p.contact_id, p.opportunity_id, `Retomar proposta recusada ${p.code}`, `Motivo da recusa: ${optionLabel(db, 'motivo_recusa_proposta', extra.refusal_reason)}.${extra.refusal_notes ? ` ${extra.refusal_notes}` : ''} Verifique se o momento mudou e apresente uma nova condição.`,
          `${extra.retake_at}T13:00:00.000Z`, p.owner_id ?? user.id, p.id, user.id, now, now);
    }
    insertActivity(db, {
      contact_id: p.contact_id,
      opportunity_id: p.opportunity_id,
      type: 'proposta',
      notes: `Proposta ${p.code} (v${p.version}): ${PROPOSAL_STATUS[p.status]} → ${PROPOSAL_STATUS[status]}${extra.accepted_channel ? `. Aceite via ${optionLabel(db, 'canal_aceite', extra.accepted_channel)}; próxima etapa: ficha de pré-venda` : ''}${extra.refusal_reason ? `. Motivo: ${optionLabel(db, 'motivo_recusa_proposta', extra.refusal_reason)}` : ''}${clean(data.notes) ? `. ${clean(data.notes)}` : ''}`,
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
      stopCadence(db, p.id, `substituída pela ${res.code}`);
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
      stopCadence(db, p.id, 'proposta expirada');
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

/** Resposta do cliente à proposta (alimenta a probabilidade e a esteira). */
function registerResponse(db, user, id, data) {
  const p = loadProposal(db, user, id, true);
  if (!ACTIVE.includes(p.status)) throw badRequest('A proposta já está encerrada.');
  const resp = clean(data.response);
  assertOption(db, 'resposta_proposta', resp, 'resposta do cliente');
  if (!resp) throw badRequest('Informe a resposta do cliente.');
  const now = nowIso();
  tx(db, () => {
    db.prepare('UPDATE proposals SET last_response = ?, last_response_at = ?, updated_at = ? WHERE id = ?').run(resp, now, now, p.id);
    insertActivity(db, { contact_id: p.contact_id, opportunity_id: p.opportunity_id, type: 'proposta', notes: `Retorno do cliente sobre a proposta ${p.code}: ${optionLabel(db, 'resposta_proposta', resp)}.${clean(data.notes) ? ` ${clean(data.notes)}` : ''}`, user_id: user.id, source: 'manual', ref_type: 'proposal', ref_id: p.id });
    if (resp === 'negativa') {
      db.prepare("INSERT INTO tasks (contact_id, opportunity_id, type, title, notes, due_at, assigned_to, priority, proposal_id, created_by, created_at, updated_at) VALUES (?, ?, 'revisar_proposta', ?, ?, ?, ?, 'alta', ?, ?, ?, ?)")
        .run(p.contact_id, p.opportunity_id, `Revisar a proposta ${p.code}: nova versão, nutrição ou perdido`, 'O cliente respondeu que não vai seguir agora. Entenda a objeção e decida o próximo passo.', new Date(Date.now() + 3600000).toISOString(), p.owner_id ?? user.id, p.id, user.id, now, now);
    }
    audit(db, user, 'proposal', p.id, 'resposta_cliente', { resposta: resp }, p.contact_id);
  });
}

/**
 * Nova proposta: exige o cadastro do cliente (ID) com nome e contato e um negócio aberto.
 * Cria o registro (rascunho) e devolve o link do simulador com o nome e o contato preenchidos.
 */
function startProposal(db, user, data) {
  const c = loadContact(db, user, data.contact_id, { write: true });
  if (!c.name || !(c.whatsapp || c.phone1 || c.phone2)) throw badRequest('Para gerar a proposta, o cadastro precisa ter nome completo e telefone/WhatsApp.');
  let opp = data.opportunity_id ? db.prepare("SELECT * FROM opportunities WHERE id = ? AND contact_id = ?").get(Number(data.opportunity_id), c.id) : null;
  if (!opp) opp = db.prepare("SELECT * FROM opportunities WHERE contact_id = ? AND status = 'aberta' ORDER BY updated_at DESC LIMIT 1").get(c.id);
  if (!opp || opp.status !== 'aberta') throw badRequest('Abra um negócio para este cliente antes de gerar a proposta.');
  const res = tx(db, () => {
    const r = insertProposal(db, user, { contact_id: c.id, opportunity_id: opp.id, status: 'rascunho', owner_id: opp.owner_id, product_id: opp.product_id, credit_value: opp.credit_value, term_months: opp.term_months, category: opp.credit_category });
    insertActivity(db, { contact_id: c.id, opportunity_id: opp.id, type: 'proposta', notes: `Proposta ${r.code} iniciada no simulador por ${user.name}.`, user_id: user.id, ref_type: 'proposal', ref_id: r.id });
    audit(db, user, 'proposal', r.id, 'iniciada', { code: r.code }, c.id);
    return r;
  });
  const link = require('./record').proposalSimulatorLink(db, user, c.id, { opportunity_id: opp.id, proposal_code: res.code });
  return { ...res, url: link.url };
}

/** Panorama: propostas vigentes com etapa da esteira, próximo follow-up, alertas e probabilidade. */
/** Recusas agrupadas por motivo (com marca de "recuperável"): base para o trabalho de recuperação (closer). */
function refusalBreakdown(db, rows) {
  const opts = db.prepare("SELECT value, label, flags FROM options WHERE list = 'motivo_recusa_proposta'").all();
  const map = new Map();
  for (const r of rows) {
    const k = r.refusal_reason || 'sem_motivo';
    const cur = map.get(k) || { reason: k, count: 0, credit: 0 };
    cur.count++;
    cur.credit += r.credit_value || 0;
    map.set(k, cur);
  }
  return [...map.values()]
    .map((x) => {
      const o = opts.find((op) => op.value === x.reason);
      return { ...x, label: o?.label || 'Sem motivo informado', recuperavel: !!JSON.parse(o?.flags || '{}').recuperavel };
    })
    .sort((a, b) => b.count - a.count);
}

function panorama(db, user, q = {}) {
  const sc = childScope(db, user, 'pr');
  const where = [sc.sql, "pr.status <> 'substituida'"];
  const params = [...sc.params];
  if (q.owner_id) {
    where.push('pr.owner_id = ?');
    params.push(Number(q.owner_id));
  }
  if (q.status === 'andamento') where.push("pr.status IN ('rascunho','apresentada','em_analise')");
  else if (q.status) {
    where.push('pr.status = ?');
    params.push(q.status);
  }
  if (q.category) {
    where.push('COALESCE(pr.category, o.credit_category) = ?');
    params.push(q.category);
  }
  if (q.from) {
    where.push('pr.created_at >= ?');
    params.push(q.from);
  }
  const rows = db
    .prepare(`SELECT pr.*, c.name AS contact_name, c.code AS contact_code, c.whatsapp AS contact_whatsapp, c.phone1 AS contact_phone, c.temperature,
      o.code AS opportunity_code, COALESCE(pr.category, o.credit_category) AS category, pd.name AS product_name, u.name AS owner_name
      FROM proposals pr JOIN contacts c ON c.id = pr.contact_id JOIN opportunities o ON o.id = pr.opportunity_id
      LEFT JOIN products pd ON pd.id = pr.product_id LEFT JOIN users u ON u.id = pr.owner_id WHERE ${where.join(' AND ')} ORDER BY pr.created_at DESC LIMIT 1000`)
    .all(...params);
  const now = nowIso();
  const out = rows.map((p) => {
    const sc2 = proposalScore(db, p);
    const tasks = db.prepare('SELECT id, title, due_at, status, cadence_step, completed_at FROM tasks WHERE proposal_id = ? ORDER BY due_at').all(p.id);
    const cad = tasks.filter((t) => t.cadence_step);
    const next = tasks.find((t) => t.status === 'pendente');
    const lastDone = [...cad].reverse().find((t) => t.status === 'concluida');
    const days = p.presented_at ? Math.floor((Date.now() - Date.parse(p.presented_at)) / 86400000) : null;
    const alerts = [];
    if (next && next.due_at < now) alerts.push('Follow-up atrasado');
    if (p.valid_until && ACTIVE.includes(p.status)) {
      const left = Math.floor((Date.parse(`${p.valid_until}T23:59:59Z`) - Date.now()) / 86400000);
      if (left <= 2) alerts.push(left < 0 ? 'Validade vencida' : `Validade vence em ${left} dia(s)`);
    }
    if (p.status === 'rascunho' && Date.now() - Date.parse(p.created_at) > 86400000) alerts.push('Gerada e ainda não enviada');
    if (ACTIVE.includes(p.status) && cad.length && !cad.some((t) => t.status === 'pendente')) alerts.push('Esteira concluída sem decisão: fechar, nutrir ou perder');
    const stage = !ACTIVE.includes(p.status) ? p.status : p.status === 'rascunho' ? 'gerada' : lastDone?.cadence_step || (cad.length ? 'enviada' : 'enviada');
    return {
      ...p,
      probability: sc2.score,
      level: sc2.level,
      factors: sc2.factors,
      weighted: p.credit_value ? Math.round((p.credit_value * sc2.score) / 100) : 0,
      cadence_stage: stage,
      next_followup: next ? { id: next.id, title: next.title, due_at: next.due_at, overdue: next.due_at < now } : null,
      cadence: cad.map((t) => ({ step: t.cadence_step, status: t.status, due_at: t.due_at })),
      days_since_sent: days,
      alerts,
    };
  });
  const active = out.filter((p) => ACTIVE.includes(p.status));
  const month = new Date().toISOString().slice(0, 7);
  // Geradas no mês e taxa de aceite consideram todas as propostas visíveis (independem do filtro de situação)
  const base = db
    .prepare(`SELECT pr.status, pr.created_at, pr.presented_at, pr.refusal_reason, pr.credit_value FROM proposals pr JOIN opportunities o ON o.id = pr.opportunity_id
      WHERE ${sc.sql} AND pr.status <> 'substituida'${q.owner_id ? ' AND pr.owner_id = ?' : ''}`)
    .all(...sc.params, ...(q.owner_id ? [Number(q.owner_id)] : []));
  const monthRows = base.filter((p) => p.created_at.slice(0, 7) === month);
  const decided = base.filter((p) => ['aprovada', 'recusada', 'expirada'].includes(p.status));
  return {
    rows: out,
    cadence: PROPOSAL_CADENCE.map(({ step, title }) => ({ step, title })),
    summary: {
      geradas_mes: monthRows.length,
      enviadas_mes: monthRows.filter((p) => p.presented_at).length,
      em_andamento: active.length,
      valor_andamento: active.reduce((t, p) => t + (p.credit_value || 0), 0),
      potencial_ponderado: active.reduce((t, p) => t + p.weighted, 0),
      alta: active.filter((p) => p.level === 'alta').length,
      media: active.filter((p) => p.level === 'media').length,
      baixa: active.filter((p) => p.level === 'baixa').length,
      com_alerta: active.filter((p) => p.alerts.length).length,
      recusas_por_motivo: refusalBreakdown(db, base.filter((p) => p.status === 'recusada')),
      taxa_aceite: decided.length ? Math.round((decided.filter((p) => p.status === 'aprovada').length / decided.length) * 1000) / 10 : null,
    },
  };
}

module.exports = { createProposal, updateProposal, changeStatus, newVersion, expireSweep, getProposal, listProposals, registerResponse, startProposal, panorama, proposalScore, startCadence };
