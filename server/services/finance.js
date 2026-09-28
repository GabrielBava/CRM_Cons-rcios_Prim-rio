'use strict';
/**
 * Financeiro do cliente (módulo ERP): parcelas e demais valores que o cliente paga à administradora,
 * acompanhados pela empresa para avisar e cobrar. Atraso = lançamento "a vencer" com vencimento passado.
 */
const { loadContact, childScope, audit, paging, optionLabel } = require('../core');
const { badRequest, notFound, clean, toNumber, toDateOnly, nowIso } = require('../util');
const { tx, nextCode, getSetting } = require('../db');
const { insertActivity } = require('./activities');

const today = () => new Date().toISOString().slice(0, 10);
const STATUS_LABEL = { a_vencer: 'A vencer', atrasado: 'Em atraso', pago: 'Pago', negociado: 'Negociado', cancelado: 'Cancelado' };
const DISPLAY_STATUS_SQL = "CASE WHEN f.status = 'a_vencer' AND f.due_date < ? THEN 'atrasado' ELSE f.status END";

function assertList(db, list, v, label) {
  if (v && !db.prepare('SELECT 1 FROM options WHERE list = ? AND value = ?').get(list, v)) throw badRequest(`Valor inválido para ${label}.`);
}

function decorate(r) {
  r.display_status = r.status === 'a_vencer' && r.due_date < today() ? 'atrasado' : r.status;
  r.days_late = r.display_status === 'atrasado' ? Math.floor((Date.parse(today()) - Date.parse(r.due_date)) / 86400000) : 0;
  return r;
}

function summary(db, contactId) {
  const t = today();
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN status = 'pago' THEN COALESCE(paid_amount, amount) END), 0) AS pago,
        COALESCE(SUM(CASE WHEN status = 'a_vencer' AND due_date >= ? THEN amount END), 0) AS a_vencer,
        COALESCE(SUM(CASE WHEN status = 'a_vencer' AND due_date < ? THEN amount END), 0) AS atrasado,
        SUM(status = 'a_vencer' AND due_date < ?) AS qtd_atrasado,
        MIN(CASE WHEN status = 'a_vencer' AND due_date >= ? THEN due_date END) AS proximo_vencimento,
        MIN(CASE WHEN status = 'a_vencer' AND due_date < ? THEN due_date END) AS atraso_desde
       FROM finance_entries WHERE contact_id = ?`,
    )
    .get(t, t, t, t, t, contactId);
  const issues = db.prepare("SELECT COUNT(*) AS n FROM finance_issues WHERE contact_id = ? AND status <> 'resolvida'").get(contactId).n;
  return { ...r, qtd_atrasado: r.qtd_atrasado || 0, pendencias_abertas: issues };
}

function normalizeEntry(db, data, contactId) {
  const o = {};
  if (data.type !== undefined) {
    o.type = clean(data.type) || 'parcela';
    assertList(db, 'tipo_lancamento', o.type, 'tipo de lançamento');
  }
  if (data.contract_id !== undefined) {
    o.contract_id = data.contract_id ? Number(data.contract_id) : null;
    if (o.contract_id && !db.prepare('SELECT 1 FROM contracts WHERE id = ? AND contact_id = ?').get(o.contract_id, contactId)) throw badRequest('Contrato não pertence a este cliente.');
  }
  if (data.installment_number !== undefined) {
    const n = toNumber(data.installment_number);
    if (n != null && (!Number.isInteger(n) || n < 0)) throw badRequest('Número da parcela inválido.');
    o.installment_number = n;
  }
  if (data.description !== undefined) o.description = clean(data.description);
  if (data.notes !== undefined) o.notes = clean(data.notes);
  if (data.due_date !== undefined) {
    o.due_date = toDateOnly(data.due_date);
    if (!o.due_date) throw badRequest('Informe o vencimento.');
  }
  if (data.amount !== undefined) {
    o.amount = toNumber(data.amount);
    if (o.amount == null || o.amount <= 0) throw badRequest('Informe um valor maior que zero.');
  }
  return o;
}

function createEntry(db, user, data) {
  const c = loadContact(db, user, data.contact_id, { write: true });
  const o = normalizeEntry(db, { type: 'parcela', ...data }, c.id);
  if (!o.due_date || o.amount == null) throw badRequest('Informe vencimento e valor.');
  return tx(db, () => {
    const now = nowIso();
    const code = nextCode(db, 'finance', 'FIN');
    const row = { ...o, code, contact_id: c.id, status: 'a_vencer', created_by: user.id, created_at: now, updated_at: now };
    const cols = Object.keys(row);
    const id = Number(db.prepare(`INSERT INTO finance_entries (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((k) => row[k] ?? null)).lastInsertRowid);
    audit(db, user, 'finance_entry', id, 'criado', { code, valor: o.amount, vencimento: o.due_date }, c.id);
    return { id, code };
  });
}

function loadEntry(db, user, id, write) {
  const e = db.prepare('SELECT * FROM finance_entries WHERE id = ?').get(Number(id));
  if (!e) throw notFound('Lançamento não encontrado.');
  loadContact(db, user, e.contact_id, { write });
  return e;
}

function closeAlert(db, user, e, note) {
  if (!e.alert_task_id) return;
  db.prepare("UPDATE tasks SET status = 'concluida', outcome = NULL, completed_at = ?, completed_by = ?, notes = COALESCE(notes || ' — ', '') || ?, updated_at = ? WHERE id = ? AND status = 'pendente'")
    .run(nowIso(), user?.id ?? null, note, nowIso(), e.alert_task_id);
}

function updateEntry(db, user, id, data) {
  const e = loadEntry(db, user, id, true);
  const now = nowIso();
  if (data.action === 'pagar') {
    if (!['a_vencer', 'negociado'].includes(e.status)) throw badRequest('Só lançamentos em aberto podem ser baixados.');
    const paidAt = toDateOnly(data.paid_at) || today();
    const paid = data.paid_amount === undefined || data.paid_amount === '' ? e.amount : toNumber(data.paid_amount);
    if (paid == null || paid <= 0) throw badRequest('Valor pago inválido.');
    const method = clean(data.payment_method);
    assertList(db, 'forma_pagamento', method, 'forma de pagamento');
    return tx(db, () => {
      db.prepare("UPDATE finance_entries SET status = 'pago', paid_at = ?, paid_amount = ?, payment_method = ?, notes = COALESCE(?, notes), updated_at = ? WHERE id = ?")
        .run(paidAt, paid, method ?? null, clean(data.notes) ?? null, now, e.id);
      closeAlert(db, user, e, `pagamento registrado em ${paidAt}`);
      insertActivity(db, { contact_id: e.contact_id, type: 'financeiro', notes: `Pagamento registrado: ${e.code}${e.installment_number ? ` (parcela ${e.installment_number})` : ''} — R$ ${paid.toFixed(2).replace('.', ',')} em ${paidAt.split('-').reverse().join('/')}${method ? ` via ${optionLabel(db, 'forma_pagamento', method)}` : ''}.`, user_id: user.id, ref_type: 'finance_entry', ref_id: e.id });
      audit(db, user, 'finance_entry', e.id, 'pago', { valor: paid, data: paidAt }, e.contact_id);
    });
  }
  if (data.action === 'negociar' || data.action === 'cancelar' || data.action === 'reabrir') {
    const status = { negociar: 'negociado', cancelar: 'cancelado', reabrir: 'a_vencer' }[data.action];
    if (data.action !== 'reabrir' && !clean(data.notes)) throw badRequest('Descreva o motivo ou o que foi combinado.');
    return tx(db, () => {
      db.prepare('UPDATE finance_entries SET status = ?, notes = COALESCE(?, notes), paid_at = CASE WHEN ? = \'a_vencer\' THEN NULL ELSE paid_at END, paid_amount = CASE WHEN ? = \'a_vencer\' THEN NULL ELSE paid_amount END, updated_at = ? WHERE id = ?')
        .run(status, clean(data.notes) ?? null, status, status, now, e.id);
      if (status !== 'a_vencer') closeAlert(db, user, e, `lançamento ${STATUS_LABEL[status].toLowerCase()}`);
      if (status === 'a_vencer') db.prepare('UPDATE finance_entries SET alert_task_id = NULL WHERE id = ?').run(e.id);
      insertActivity(db, { contact_id: e.contact_id, type: 'financeiro', notes: `${e.code}: ${STATUS_LABEL[e.status]} → ${STATUS_LABEL[status]}${data.notes ? `. ${clean(data.notes)}` : ''}`, user_id: user.id, ref_type: 'finance_entry', ref_id: e.id });
      audit(db, user, 'finance_entry', e.id, status, { motivo: clean(data.notes) }, e.contact_id);
    });
  }
  if (e.status === 'pago') throw badRequest('Lançamentos pagos não podem ser editados. Reabra antes, se necessário.');
  const o = normalizeEntry(db, data, e.contact_id);
  const keys = Object.keys(o);
  if (!keys.length) return;
  tx(db, () => {
    db.prepare(`UPDATE finance_entries SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => o[k] ?? null), now, e.id);
    audit(db, user, 'finance_entry', e.id, 'alterado', o, e.contact_id);
  });
}

/** Gera as parcelas mensais de um contrato (não duplica números de parcela já existentes). */
function generateInstallments(db, user, contractId, data) {
  const k = db.prepare('SELECT * FROM contracts WHERE id = ?').get(Number(contractId));
  if (!k) throw notFound('Contrato não encontrado.');
  loadContact(db, user, k.contact_id, { write: true });
  const amount = data.amount !== undefined && data.amount !== '' ? toNumber(data.amount) : k.installment_value;
  if (!amount || amount <= 0) throw badRequest('Informe o valor da parcela (no contrato ou aqui).');
  const first = toDateOnly(data.first_due_date) || k.first_due_date;
  if (!first) throw badRequest('Informe a data do primeiro vencimento.');
  const count = data.count !== undefined && data.count !== '' ? toNumber(data.count) : k.term_months;
  if (!count || !Number.isInteger(count) || count < 1 || count > 420) throw badRequest('Quantidade de parcelas deve ser entre 1 e 420.');
  const start = data.start_number ? toNumber(data.start_number) : 1;
  const [y, m, d] = first.split('-').map(Number);
  const day = k.due_day || d;
  return tx(db, () => {
    const now = nowIso();
    let created = 0;
    for (let i = 0; i < count; i++) {
      const n = start + i;
      if (db.prepare("SELECT 1 FROM finance_entries WHERE contract_id = ? AND type = 'parcela' AND installment_number = ?").get(k.id, n)) continue;
      const dt = new Date(Date.UTC(y, m - 1 + i, 1));
      const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
      dt.setUTCDate(Math.min(day, last));
      const code = nextCode(db, 'finance', 'FIN');
      db.prepare("INSERT INTO finance_entries (code, contact_id, contract_id, type, installment_number, due_date, amount, status, created_by, created_at, updated_at) VALUES (?, ?, ?, 'parcela', ?, ?, ?, 'a_vencer', ?, ?, ?)")
        .run(code, k.contact_id, k.id, n, dt.toISOString().slice(0, 10), amount, user.id, now, now);
      created++;
    }
    insertActivity(db, { contact_id: k.contact_id, type: 'financeiro', notes: `${created} parcela(s) gerada(s) para o contrato ${k.code}.`, user_id: user.id, ref_type: 'contract', ref_id: k.id });
    audit(db, user, 'contract', k.id, 'parcelas_geradas', { quantidade: created, valor: amount, primeiro_vencimento: first }, k.contact_id);
    return { created };
  });
}

function listEntries(db, user, q) {
  const s = childScope(db, user, 'f');
  const t = today();
  const where = [s.sql, 'c.merged_into_id IS NULL'];
  const params = [...s.params];
  if (q.contact_id) {
    where.push('f.contact_id = ?');
    params.push(Number(q.contact_id));
  }
  if (q.contract_id) {
    where.push('f.contract_id = ?');
    params.push(Number(q.contract_id));
  }
  if (q.status) {
    where.push(`${DISPLAY_STATUS_SQL} = ?`);
    params.push(t, q.status);
  }
  if (q.owner_id) {
    where.push('c.owner_id = ?');
    params.push(Number(q.owner_id));
  }
  if (q.from) {
    where.push('f.due_date >= ?');
    params.push(String(q.from).slice(0, 10));
  }
  if (q.to) {
    where.push('f.due_date <= ?');
    params.push(String(q.to).slice(0, 10));
  }
  if (q.q) {
    where.push('(c.name LIKE ? OR c.code = ? OR f.code = ? OR k.code = ? OR k.contract_number = ?)');
    const u = String(q.q).toUpperCase();
    params.push(`%${q.q}%`, u, u, u, q.q);
  }
  const { limit, offset, page } = q.all ? { limit: 100000, offset: 0, page: 1 } : paging(q);
  const base = `FROM finance_entries f JOIN contacts c ON c.id = f.contact_id LEFT JOIN contracts k ON k.id = f.contract_id LEFT JOIN users u ON u.id = c.owner_id WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) AS n ${base}`).get(...params).n;
  const totals = db
    .prepare(`SELECT COALESCE(SUM(CASE WHEN f.status = 'pago' THEN COALESCE(f.paid_amount, f.amount) END), 0) AS pago,
      COALESCE(SUM(CASE WHEN f.status = 'a_vencer' AND f.due_date >= '${t}' THEN f.amount END), 0) AS a_vencer,
      COALESCE(SUM(CASE WHEN f.status = 'a_vencer' AND f.due_date < '${t}' THEN f.amount END), 0) AS atrasado,
      SUM(f.status = 'a_vencer' AND f.due_date < '${t}') AS qtd_atrasado ${base}`)
    .get(...params);
  const rows = db
    .prepare(`SELECT f.*, c.name AS contact_name, c.code AS contact_code, k.code AS contract_code, k.contract_number, u.name AS owner_name
      ${base} ORDER BY (f.status = 'a_vencer' AND f.due_date < '${t}') DESC, f.due_date ASC, f.id LIMIT ? OFFSET ?`)
    .all(...params, limit, offset)
    .map(decorate);
  return { total, page, limit, rows, totals };
}

/* ---------- Pendências e acordos ---------- */

function saveIssue(db, user, data) {
  const c = loadContact(db, user, data.contact_id, { write: true });
  const description = clean(data.description);
  if (!description && !data.id) throw badRequest('Descreva a pendência.');
  const status = data.status || 'aberta';
  if (!['aberta', 'em_negociacao', 'resolvida'].includes(status)) throw badRequest('Situação inválida.');
  const amount = data.amount === undefined || data.amount === '' ? null : toNumber(data.amount);
  const now = nowIso();
  const contractId = data.contract_id ? Number(data.contract_id) : null;
  if (contractId && !db.prepare('SELECT 1 FROM contracts WHERE id = ? AND contact_id = ?').get(contractId, c.id)) throw badRequest('Contrato não pertence a este cliente.');
  return tx(db, () => {
    if (data.id) {
      const i = db.prepare('SELECT * FROM finance_issues WHERE id = ? AND contact_id = ?').get(Number(data.id), c.id);
      if (!i) throw notFound('Pendência não encontrada.');
      db.prepare('UPDATE finance_issues SET description = COALESCE(?, description), amount = ?, agreement = ?, due_date = ?, status = ?, contract_id = ?, resolved_at = ?, updated_at = ? WHERE id = ?')
        .run(description, amount, clean(data.agreement) ?? null, toDateOnly(data.due_date) ?? null, status, contractId, status === 'resolvida' ? i.resolved_at || now : null, now, i.id);
      if (i.status !== status) insertActivity(db, { contact_id: c.id, type: 'financeiro', notes: `Pendência financeira: ${i.description} — ${status.replace('_', ' ')}.${data.agreement ? ` Acordo: ${clean(data.agreement)}` : ''}`, user_id: user.id });
      audit(db, user, 'finance_issue', i.id, 'alterada', { status: [i.status, status] }, c.id);
      return i.id;
    }
    const r = db.prepare('INSERT INTO finance_issues (contact_id, contract_id, description, amount, agreement, due_date, status, opened_at, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(c.id, contractId, description, amount, clean(data.agreement) ?? null, toDateOnly(data.due_date) ?? null, status, now, user.id, now);
    insertActivity(db, { contact_id: c.id, type: 'financeiro', notes: `Pendência financeira registrada: ${description}.`, user_id: user.id });
    audit(db, user, 'finance_issue', Number(r.lastInsertRowid), 'criada', { descricao: description }, c.id);
    return Number(r.lastInsertRowid);
  });
}

function contactFinance(db, user, contactId) {
  const c = loadContact(db, user, contactId);
  return {
    summary: summary(db, c.id),
    entries: listEntries(db, user, { contact_id: c.id, all: true }).rows,
    issues: db.prepare('SELECT i.*, k.code AS contract_code FROM finance_issues i LEFT JOIN contracts k ON k.id = i.contract_id WHERE i.contact_id = ? ORDER BY i.status = \'resolvida\', i.opened_at DESC').all(c.id),
  };
}

/** Cria uma tarefa para o responsável financeiro (ou o responsável do cliente) para cada lançamento em atraso. */
function overdueSweep(db) {
  const t = today();
  const financeUser = getSetting(db, 'finance_user_id');
  const rows = db
    .prepare(`SELECT f.*, c.name AS contact_name, c.owner_id FROM finance_entries f JOIN contacts c ON c.id = f.contact_id
      WHERE f.status = 'a_vencer' AND f.due_date < ? AND c.anonymized_at IS NULL
      AND (f.alert_task_id IS NULL OR NOT EXISTS (SELECT 1 FROM tasks tk WHERE tk.id = f.alert_task_id))`)
    .all(t);
  for (const f of rows) {
    tx(db, () => {
      const now = nowIso();
      const assignee = financeUser && db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(financeUser) ? financeUser : f.owner_id;
      const title = `Parcela em atraso: ${f.code}${f.installment_number ? ` (nº ${f.installment_number})` : ''} — venc. ${f.due_date.split('-').reverse().join('/')}`;
      const r = db.prepare("INSERT INTO tasks (contact_id, type, title, notes, due_at, assigned_to, created_at, updated_at) VALUES (?, 'financeiro', ?, ?, ?, ?, ?, ?)")
        .run(f.contact_id, title, `Valor: R$ ${Number(f.amount).toFixed(2).replace('.', ',')}. Avisar o cliente e registrar o pagamento ou a negociação.`, now, assignee ?? null, now, now);
      db.prepare('UPDATE finance_entries SET alert_task_id = ? WHERE id = ?').run(Number(r.lastInsertRowid), f.id);
      insertActivity(db, { contact_id: f.contact_id, type: 'financeiro', notes: `Alerta de atraso gerado para ${f.code}.`, ref_type: 'finance_entry', ref_id: f.id });
    });
  }
  return rows.length;
}

module.exports = { summary, createEntry, updateEntry, generateInstallments, listEntries, saveIssue, contactFinance, overdueSweep, STATUS_LABEL };
