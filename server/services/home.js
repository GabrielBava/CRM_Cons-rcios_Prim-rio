'use strict';
/**
 * Painel inicial do especialista (e visão consolidada para líder e administrador):
 * o que entrou, o que está em andamento, o que foi vendido, quanto há de comissão e como está a meta —
 * mais a lista de ações sugeridas para aumentar as vendas hoje.
 */
const { visibleOwnerIds } = require('../core');
const { badRequest, nowIso } = require('../util');

const IN = (a) => a.map(() => '?').join(',');

function home(db, user, q = {}) {
  const visible = visibleOwnerIds(db, user);
  let ids = visible;
  let single = user.role === 'consultor' ? user.id : null;
  if (q.user_id) {
    const uid = Number(q.user_id);
    if (visible !== null && !visible.includes(uid)) throw badRequest('Usuário fora do seu escopo.');
    ids = [uid];
    single = uid;
  }
  const own = (col) => (ids === null ? { sql: '1=1', params: [] } : { sql: `${col} IN (${IN(ids)})`, params: ids });
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const monthStart = `${month}-01T00:00:00.000Z`;
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();
  const nowIsoStr = nowIso();

  // Leads recebidos (atribuídos ao especialista ou criados no escopo)
  const cs = own('c.owner_id');
  const received = (from) => db.prepare(`SELECT COUNT(*) AS n FROM contacts c WHERE ${cs.sql} AND c.merged_into_id IS NULL AND COALESCE(c.assigned_at, c.created_at) >= ?`).get(...cs.params, from).n;
  const leads = { mes: received(monthStart), hoje: received(todayStart) };

  // Funil (negócios abertos por etapa)
  const os = own('o.owner_id');
  const stages = db.prepare("SELECT id, name, kind, key, rot_days FROM pipeline_stages WHERE active = 1 ORDER BY position").all();
  const openOpps = db.prepare(`SELECT o.id, o.stage_id, o.credit_value, o.stage_entered_at, o.last_activity_at, o.status FROM opportunities o JOIN contacts c ON c.id = o.contact_id
    WHERE ${os.sql} AND c.merged_into_id IS NULL AND (o.status IN ('aberta','pausada') OR (o.status IN ('ganha','perdida') AND o.closed_at >= ?))`).all(...os.params, monthStart);
  const funnel = stages.map((s) => {
    const cards = openOpps.filter((o) => o.stage_id === s.id);
    return { id: s.id, name: s.name, kind: s.kind, count: cards.length, value: cards.reduce((t, o) => t + (o.credit_value || 0), 0) };
  });
  const rotting = openOpps.filter((o) => {
    const st = stages.find((s) => s.id === o.stage_id);
    return o.status === 'aberta' && st?.rot_days && (Date.now() - Date.parse(o.stage_entered_at)) / 86400000 > st.rot_days;
  }).length;

  // Propostas
  const proposals = require('./proposals').panorama(db, user, { status: 'andamento', ...(single ? { owner_id: single } : {}) });
  const propRows = ids === null ? proposals.rows : proposals.rows.filter((p) => ids.includes(p.owner_id));
  const followToday = db.prepare(`SELECT COUNT(*) AS n FROM tasks t WHERE ${own('t.assigned_to').sql} AND t.status = 'pendente' AND t.type = 'follow_up_proposta' AND t.due_at <= ?`).get(...own('t.assigned_to').params, todayEnd).n;

  // Vendas
  const ss = own('s.seller_id');
  const salesMonth = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(credit_value), 0) AS v FROM sales s WHERE ${ss.sql} AND s.status IN ('confirmada','cancelada') AND substr(s.payment_date, 1, 7) = ?`).get(...ss.params, month);
  const awaiting = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(credit_value), 0) AS v FROM sales s WHERE ${ss.sql} AND s.status = 'aguardando_pagamento'`).get(...ss.params);

  // Comissões do mês
  const commissions = require('./sales').commissionSummary(db, user, single);

  // Meta
  const goals = require('./goals');
  const goal = single ? goals.userProgress(db, single, month) : goals.goalsBoard(db, user, { month }).total;

  // Agenda
  const ts = own('t.assigned_to');
  const taskCount = (cond, p = []) => db.prepare(`SELECT COUNT(*) AS n FROM tasks t WHERE ${ts.sql} AND t.status = 'pendente' AND ${cond}`).get(...ts.params, ...p).n;
  const agenda = {
    hoje: taskCount('t.due_at BETWEEN ? AND ?', [todayStart, todayEnd]),
    atrasadas: taskCount('t.due_at < ?', [nowIsoStr]),
    urgentes: taskCount("t.priority = 'urgente'"),
    r1_semana: taskCount("t.type = 'reuniao' AND t.due_at BETWEEN ? AND ?", [todayStart, new Date(Date.now() + 7 * 86400000).toISOString()]),
    lista: db.prepare(`SELECT t.id, t.title, t.type, t.due_at, t.priority, t.contact_id, c.name AS contact_name FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id
      WHERE ${ts.sql} AND t.status = 'pendente' AND t.due_at <= ? ORDER BY t.priority = 'urgente' DESC, t.due_at LIMIT 8`).all(...ts.params, todayEnd),
  };

  // Pré-vendas paradas
  const presales = require('./sales').listPreSales(db, user, { status: 'ativas', ...(single ? { owner_id: single } : {}) });

  // Leads sem primeiro contato (distribuídos e sem nenhuma atividade do especialista)
  const noContact = db.prepare(`SELECT COUNT(*) AS n FROM contacts c WHERE ${cs.sql} AND c.relationship <> 'cliente' AND c.merged_into_id IS NULL
    AND COALESCE(c.assigned_at, c.created_at) >= ? AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.contact_id = c.id AND a.user_id IS NOT NULL AND a.type NOT IN ('cadastro','tarefa','mudanca_etapa'))`)
    .get(...cs.params, new Date(Date.now() - 30 * 86400000).toISOString()).n;

  // Ranking do mês
  const ranking = db.prepare(`SELECT u.id, u.name, COUNT(s.id) AS vendas, COALESCE(SUM(s.credit_value), 0) AS credito FROM users u
    LEFT JOIN sales s ON s.seller_id = u.id AND s.status IN ('confirmada','cancelada') AND substr(s.payment_date, 1, 7) = ?
    WHERE u.active = 1 AND u.role IN ('consultor','gestor') GROUP BY u.id ORDER BY credito DESC, vendas DESC, u.name`).all(month);
  const position = single ? ranking.findIndex((r) => r.id === single) + 1 : null;

  // Aniversariantes (clientes) nos próximos 7 dias
  const days = [...Array(7)].map((_, i) => new Date(Date.now() + i * 86400000).toISOString().slice(5, 10));
  const birthdays = db.prepare(`SELECT c.id, c.name, c.birth_date FROM contacts c WHERE ${cs.sql} AND c.relationship = 'cliente' AND c.birth_date IS NOT NULL AND substr(c.birth_date, 6, 5) IN (${IN(days)}) AND c.merged_into_id IS NULL ORDER BY substr(c.birth_date, 6, 5) LIMIT 10`)
    .all(...cs.params, ...days);

  // Treinamentos obrigatórios
  const trainings = require('./trainings').pendingFor(db, single ? db.prepare('SELECT * FROM users WHERE id = ?').get(single) : user);

  // Ticket médio (para traduzir a meta em número de cartas)
  const ticket = db.prepare(`SELECT AVG(credit_value) AS v FROM sales s WHERE ${ss.sql} AND s.status IN ('confirmada','cancelada')`).get(...ss.params).v ||
    (propRows.length ? propRows.reduce((t, p) => t + (p.credit_value || 0), 0) / propRows.length : null);

  // Ações sugeridas (ordem de impacto)
  const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const actions = [];
  const add = (level, text, href) => actions.push({ level, text, href });
  const urgent = agenda.urgentes;
  if (urgent) add('danger', `${urgent} tarefa(s) urgente(s) na agenda`, '#/agenda?visao=urgentes');
  if (noContact) add('danger', `${noContact} lead(s) ainda sem nenhum contato: quanto antes, maior a conversão`, '#/leads?no_attempt=1');
  if (followToday) add('warn', `${followToday} follow-up(s) de proposta para hoje ou atrasados`, '#/propostas');
  const high = propRows.filter((p) => p.level === 'alta');
  if (high.length) add('ok', `${high.length} proposta(s) com alta chance de fechamento (${fmt(high.reduce((t, p) => t + (p.credit_value || 0), 0))}): priorize o fechamento`, '#/propostas');
  const stale = presales.rows.filter((r) => r.stale).length;
  if (stale) add('warn', `${stale} pré-venda(s) parada(s) há mais de ${require('../db').getSetting(db, 'presale_alert_hours') || 24}h`, '#/prevenda');
  if (awaiting.n) add('info', `${awaiting.n} venda(s) aguardando confirmação do pagamento`, '#/vendas');
  if (goal.missing_credit) {
    const cards = ticket ? Math.ceil(goal.missing_credit / ticket) : null;
    add('info', `Faltam ${fmt(goal.missing_credit)} para a meta${cards ? ` (≈ ${cards} carta(s) do seu ticket médio)` : ''}${goal.daily_needed ? `; ritmo de ${fmt(goal.daily_needed)} por dia útil` : ''}`, '#/metas');
  }
  if (rotting) add('warn', `${rotting} negócio(s) parado(s) além do prazo da etapa no funil`, '#/funil');
  if (trainings.length) add('info', `${trainings.length} treinamento(s) obrigatório(s) pendente(s)`, '#/treinamentos');
  if (birthdays.length) add('ok', `${birthdays.length} cliente(s) fazendo aniversário nesta semana: ótimo momento para pedir indicação`, null);

  return {
    scope: single ? { user_id: single, name: db.prepare('SELECT name FROM users WHERE id = ?').get(single)?.name } : { all: ids === null },
    month,
    leads,
    proposals: { ...proposals.summary, lista: propRows.filter((p) => p.alerts.length || p.level === 'alta').slice(0, 8) },
    sales: { mes: salesMonth.n, credito_mes: salesMonth.v, aguardando: awaiting.n, aguardando_valor: awaiting.v },
    commissions,
    goal,
    funnel,
    rotting,
    agenda,
    presales: presales.summary,
    no_contact: noContact,
    ranking: user.role === 'consultor' ? [] : ranking,
    position: position ? { position, of: ranking.length } : null,
    birthdays,
    trainings,
    actions,
  };
}

module.exports = { home };
