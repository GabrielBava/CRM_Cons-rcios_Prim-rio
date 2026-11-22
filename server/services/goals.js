'use strict';
/**
 * Metas mensais de venda (crédito vendido e número de vendas) por especialista e por equipe.
 * O realizado considera as vendas com pagamento confirmado no mês (data do pagamento).
 */
const { requireAdmin, visibleOwnerIds, audit } = require('../core');
const { badRequest, toNumber, nowIso } = require('../util');
const { tx } = require('../db');

const monthRe = /^\d{4}-(0[1-9]|1[0-2])$/;
const thisMonth = () => new Date().toISOString().slice(0, 7);

/** Dias úteis (seg–sex) restantes no mês, contando hoje. */
function businessDaysLeft(month) {
  const [y, m] = month.split('-').map(Number);
  const now = new Date();
  const start = month === thisMonth() ? now.getDate() : 1;
  if (month < thisMonth()) return 0;
  const last = new Date(y, m, 0).getDate();
  let n = 0;
  for (let d = start; d <= last; d++) if (![0, 6].includes(new Date(y, m - 1, d).getDay())) n++;
  return n;
}

function realized(db, month, userIds) {
  const where = ["status IN ('confirmada','cancelada')", 'substr(payment_date, 1, 7) = ?'];
  const params = [month];
  if (userIds) {
    if (!userIds.length) return { credit: 0, sales: 0 };
    where.push(`seller_id IN (${userIds.map(() => '?').join(',')})`);
    params.push(...userIds);
  }
  // Cancelamentos não descontam a venda do mês em que ela ocorreu; o indicador de cancelamento fica em Comissões e cancelamentos
  const r = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(credit_value), 0) AS v FROM sales WHERE ${where.join(' AND ')}`).get(...params);
  return { credit: r.v, sales: r.n };
}

function withProgress(goal, real, month) {
  const pctCredit = goal?.target_credit ? Math.round((real.credit / goal.target_credit) * 1000) / 10 : null;
  const pctSales = goal?.target_sales ? Math.round((real.sales / goal.target_sales) * 1000) / 10 : null;
  const missingCredit = goal?.target_credit ? Math.max(0, goal.target_credit - real.credit) : null;
  const days = businessDaysLeft(month);
  return {
    target_credit: goal?.target_credit ?? null,
    target_sales: goal?.target_sales ?? null,
    realized_credit: real.credit,
    realized_sales: real.sales,
    pct_credit: pctCredit,
    pct_sales: pctSales,
    missing_credit: missingCredit,
    missing_sales: goal?.target_sales ? Math.max(0, goal.target_sales - real.sales) : null,
    business_days_left: days,
    daily_needed: missingCredit && days ? Math.round(missingCredit / days) : null,
  };
}

/** Metas do mês com o realizado. Especialista vê a própria; líder, a equipe; administrador, todas. */
function goalsBoard(db, user, q = {}) {
  const month = monthRe.test(q.month || '') ? q.month : thisMonth();
  const ids = visibleOwnerIds(db, user);
  const users = db.prepare("SELECT u.id, u.name, u.role, u.team_id, t.name AS team_name FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.active = 1 AND u.role IN ('consultor','gestor') ORDER BY t.name, u.name").all()
    .filter((u) => ids === null || ids.includes(u.id));
  const goals = db.prepare('SELECT * FROM goals WHERE month = ?').all(month);
  const people = users.map((u) => ({ ...u, ...withProgress(goals.find((g) => g.scope === 'user' && g.user_id === u.id), realized(db, month, [u.id]), month) }));
  const teams = db.prepare('SELECT t.*, l.name AS leader_name FROM teams t LEFT JOIN users l ON l.id = t.leader_id ORDER BY t.name').all()
    .filter((t) => user.role === 'admin' || t.id === user.team_id)
    .map((t) => {
      const members = db.prepare('SELECT id FROM users WHERE team_id = ? AND active = 1').all(t.id).map((r) => r.id);
      const explicit = goals.find((g) => g.scope === 'team' && g.team_id === t.id);
      const sum = people.filter((p) => p.team_id === t.id);
      const goal = explicit || { target_credit: sum.reduce((a, p) => a + (p.target_credit || 0), 0) || null, target_sales: sum.reduce((a, p) => a + (p.target_sales || 0), 0) || null };
      return { id: t.id, name: t.name, leader_name: t.leader_name, explicit: !!explicit, ...withProgress(goal, realized(db, month, members), month) };
    });
  const totalGoal = { target_credit: people.reduce((a, p) => a + (p.target_credit || 0), 0) || null, target_sales: people.reduce((a, p) => a + (p.target_sales || 0), 0) || null };
  const total = withProgress(totalGoal, realized(db, month, ids === null ? null : users.map((u) => u.id)), month);
  return { month, people, teams, total, can_edit: user.role === 'admin' };
}

/** Progresso de um usuário (usado no painel inicial). */
function userProgress(db, userId, month = thisMonth()) {
  const goal = db.prepare("SELECT * FROM goals WHERE month = ? AND scope = 'user' AND user_id = ?").get(month, userId);
  return { month, ...withProgress(goal, realized(db, month, [userId]), month) };
}

function saveGoals(db, user, data) {
  requireAdmin(user);
  const month = data.month;
  if (!monthRe.test(month || '')) throw badRequest('Mês inválido (use AAAA-MM).');
  const items = Array.isArray(data.items) ? data.items : [];
  const now = nowIso();
  tx(db, () => {
    for (const it of items) {
      const scope = it.scope === 'team' ? 'team' : 'user';
      const credit = toNumber(it.target_credit);
      const count = it.target_sales === '' || it.target_sales == null ? null : Number(it.target_sales);
      if (credit != null && credit < 0) throw badRequest('Meta de crédito inválida.');
      if (count != null && (!Number.isInteger(count) || count < 0)) throw badRequest('Meta de quantidade de vendas inválida.');
      const uid = scope === 'user' ? Number(it.user_id) : null;
      const tid = scope === 'team' ? Number(it.team_id) : null;
      db.prepare('DELETE FROM goals WHERE month = ? AND scope = ? AND COALESCE(user_id, 0) = ? AND COALESCE(team_id, 0) = ?').run(month, scope, uid || 0, tid || 0);
      if (credit || count) db.prepare('INSERT INTO goals (month, scope, user_id, team_id, target_credit, target_sales, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(month, scope, uid, tid, credit, count, user.id, now);
    }
    audit(db, user, 'goals', null, 'salvas', { mes: month, itens: items.length });
  });
}

/** Copia as metas de um mês para outro (sem sobrescrever as já cadastradas). */
function copyGoals(db, user, data) {
  requireAdmin(user);
  if (!monthRe.test(data.from || '') || !monthRe.test(data.to || '')) throw badRequest('Meses inválidos.');
  const rows = db.prepare('SELECT * FROM goals WHERE month = ?').all(data.from);
  const now = nowIso();
  let n = 0;
  tx(db, () => {
    for (const g of rows) {
      const exists = db.prepare('SELECT 1 FROM goals WHERE month = ? AND scope = ? AND COALESCE(user_id, 0) = ? AND COALESCE(team_id, 0) = ?').get(data.to, g.scope, g.user_id || 0, g.team_id || 0);
      if (exists) continue;
      db.prepare('INSERT INTO goals (month, scope, user_id, team_id, target_credit, target_sales, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(data.to, g.scope, g.user_id, g.team_id, g.target_credit, g.target_sales, user.id, now);
      n++;
    }
  });
  return { copied: n };
}

module.exports = { goalsBoard, userProgress, saveGoals, copyGoals, businessDaysLeft };
