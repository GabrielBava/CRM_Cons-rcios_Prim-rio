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
  const openOpps = db.prepare(`SELECT o.*,
    (SELECT MAX(pr.credit_value) FROM proposals pr WHERE pr.opportunity_id = o.id AND pr.status IN ('rascunho','apresentada','em_analise','aprovada')) AS proposal_value
    FROM opportunities o JOIN contacts c ON c.id = o.contact_id
    WHERE ${os.sql} AND c.merged_into_id IS NULL AND (o.status IN ('aberta','pausada') OR (o.status IN ('ganha','perdida') AND o.closed_at >= ?))`).all(...os.params, monthStart);
  // Valor de cada etapa = proposta ativa (ou o crédito desejado); temperatura de cada negócio para o panorama quente/morno/frio
  const { temperatureOf } = require('./opportunities');
  const funnel = stages.map((s) => {
    const cards = openOpps.filter((o) => o.stage_id === s.id);
    const temps = { quente: 0, morno: 0, frio: 0 };
    if (s.kind === 'aberta') for (const o of cards) temps[temperatureOf(o).level]++;
    return { id: s.id, key: s.key, name: s.name, kind: s.kind, count: cards.length, value: cards.reduce((t, o) => t + (o.proposal_value ?? o.credit_value ?? 0), 0), temps };
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
  const awaiting = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(credit_value), 0) AS v FROM sales s WHERE ${ss.sql} AND s.status IN ('aguardando_pagamento','aguardando_alocacao')`).get(...ss.params);

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
  const ranking = db.prepare(`SELECT u.id, u.name, u.photo, u.job_title, COUNT(s.id) AS vendas, COALESCE(SUM(s.credit_value), 0) AS credito FROM users u
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
  if (awaiting.n) add('info', `${awaiting.n} venda(s) aguardando a alocação da cota e a confirmação do time`, '#/vendas');
  if (goal.missing_credit) {
    const cards = ticket ? Math.ceil(goal.missing_credit / ticket) : null;
    add('info', `Faltam ${fmt(goal.missing_credit)} para a meta${cards ? ` (≈ ${cards} carta(s) do seu ticket médio)` : ''}${goal.daily_needed ? `; ritmo de ${fmt(goal.daily_needed)} por dia útil` : ''}`, '#/metas');
  }
  if (rotting) add('warn', `${rotting} negócio(s) parado(s) além do prazo da etapa no funil`, '#/funil');
  if (trainings.length) add('info', `${trainings.length} treinamento(s) obrigatório(s) pendente(s)`, '#/treinamentos');
  if (birthdays.length) add('ok', `${birthdays.length} cliente(s) fazendo aniversário nesta semana: ótimo momento para pedir indicação`, null);

  const v360 = overview360(db, user, q, { ids, single, cs, os, ss, ts, stages, openOpps, proposals, propRows, goal, actions });

  return {
    v360,
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

/* ------------------------- Painel 360 ------------------------- */

const DAY = 86400000;
const SP = 3 * 3600000;
const spDay = (ms) => new Date(ms - SP).toISOString().slice(0, 10);
const spMidnight = (ms) => {
  const d = new Date(ms - SP);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + SP;
};
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);

/**
 * Visão 360 do painel inicial: indicadores do topo no período escolhido (dia, semana, quinzena, mês ou data),
 * ganhos e perdidos dos últimos 7 dias, calendário dos próximos 5 dias, pipeline horizontal (leads, R$ e TMA por
 * etapa), ranking da squad, meta do mês e insights da IA Vero.
 */
function overview360(db, user, q, ctx) {
  const bi = require('./bi');
  const period = bi.periodOf(q);
  const { from, to } = period;
  const { cs, os, ts } = ctx;
  const now = Date.now();
  const one = (sql, ...p) => db.prepare(sql).get(...p) || {};
  const received = (since, until = new Date(now).toISOString()) => one(`SELECT COUNT(*) AS n FROM contacts c WHERE ${cs.sql} AND c.merged_into_id IS NULL AND COALESCE(c.assigned_at, c.created_at) >= ? AND COALESCE(c.assigned_at, c.created_at) < ?`, ...cs.params, since, until).n || 0;
  const leads24 = received(new Date(now - DAY).toISOString());
  const leadsPeriod = received(from, to);
  const won = one(`SELECT COUNT(*) AS n FROM opportunities o WHERE ${os.sql} AND o.status = 'ganha' AND o.closed_at >= ? AND o.closed_at < ?`, ...os.params, from, to).n || 0;
  const tmr = one(`SELECT AVG((julianday(c.first_contact_at) - julianday(COALESCE(c.assigned_at, c.created_at))) * 86400) AS s FROM contacts c
    WHERE ${cs.sql} AND c.merged_into_id IS NULL AND c.first_contact_at IS NOT NULL AND c.first_contact_at >= COALESCE(c.assigned_at, c.created_at)
      AND COALESCE(c.assigned_at, c.created_at) >= ? AND COALESCE(c.assigned_at, c.created_at) < ?`, ...cs.params, from, to).s;
  const ss = ctx.ss;
  const d0 = spDay(Date.parse(from));
  const d1 = spDay(Date.parse(to) - 1);
  const ps = ctx.single ? { sql: 'pr.owner_id = ?', params: [ctx.single] } : ctx.ids === null ? { sql: '1=1', params: [] } : { sql: `pr.owner_id IN (${ctx.ids.map(() => '?').join(',')})`, params: ctx.ids };
  const rev = bi.revenue(db, { sql: ss.sql.replace(/\bs\./g, 'sa.'), params: ss.params }, ps, d0, d1);
  const decided = one(`SELECT SUM(pr.status = 'aprovada') AS a, COUNT(*) AS n FROM proposals pr WHERE ${ps.sql} AND pr.status IN ('aprovada','recusada','expirada')
    AND COALESCE(pr.accepted_at, pr.refused_at, pr.updated_at) >= ? AND COALESCE(pr.accepted_at, pr.refused_at, pr.updated_at) < ?`, ...ps.params, from, to);
  const todayStart = new Date(spMidnight(now)).toISOString();
  const todayEnd = new Date(spMidnight(now) + DAY - 1).toISOString();
  const meetingsToday = one(`SELECT COUNT(*) AS n FROM tasks t WHERE ${ts.sql} AND t.type = 'reuniao' AND t.status != 'cancelada' AND t.due_at BETWEEN ? AND ?`, ...ts.params, todayStart, todayEnd).n || 0;
  const tasksToday = one(`SELECT COUNT(*) AS n FROM tasks t WHERE ${ts.sql} AND t.status = 'pendente' AND t.due_at BETWEEN ? AND ?`, ...ts.params, todayStart, todayEnd).n || 0;
  const kpis = {
    leads_24h: leads24, leads_periodo: leadsPeriod,
    taxa_conversao: pct(won, leadsPeriod), ganhos: won,
    tempo_resposta: tmr == null ? null : Math.round(tmr),
    propostas_andamento: ctx.proposals.summary.em_andamento, propostas_valor: ctx.proposals.summary.valor_andamento,
    vendas_valor: rev.receita, vendas_qtd: rev.vendas, receita_credito: rev.credito, receita_planejamento: rev.planejamento,
    taxa_conversao_propostas: pct(decided.a || 0, decided.n || 0), propostas_aceitas: decided.a || 0, propostas_decididas: decided.n || 0,
    agendas_hoje: meetingsToday, tarefas_hoje: tasksToday,
  };

  // Ganhos e perdidos dos últimos 7 dias (por dia, horário de Brasília)
  const start7 = spMidnight(now) - 6 * DAY;
  const closed = db.prepare(`SELECT o.status, o.closed_at, COALESCE((SELECT MAX(pr.credit_value) FROM proposals pr WHERE pr.opportunity_id = o.id AND pr.status IN ('apresentada','em_analise','aprovada')), o.credit_value, 0) AS v
    FROM opportunities o WHERE ${os.sql} AND o.status IN ('ganha','perdida') AND o.closed_at >= ?`).all(...os.params, new Date(start7).toISOString());
  const days7 = [...Array(7)].map((_, i) => {
    const day = spDay(start7 + i * DAY + 3600000);
    const rows = closed.filter((r) => spDay(Date.parse(r.closed_at)) === day);
    return { day, ganhos: rows.filter((r) => r.status === 'ganha').length, perdidos: rows.filter((r) => r.status === 'perdida').length, valor_ganho: rows.filter((r) => r.status === 'ganha').reduce((t, r) => t + (r.v || 0), 0) };
  });

  // Calendário dos próximos 5 dias: reuniões e tarefas
  const cal = db.prepare(`SELECT t.id, t.title, t.type, t.due_at, t.status, t.priority, t.meeting_kind, t.contact_id, c.name AS contact_name FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id
    WHERE ${ts.sql} AND t.status != 'cancelada' AND t.due_at >= ? AND t.due_at < ? ORDER BY t.due_at`).all(...ts.params, todayStart, new Date(spMidnight(now) + 5 * DAY).toISOString());
  const calendar = [...Array(5)].map((_, i) => {
    const day = spDay(spMidnight(now) + i * DAY + 3600000);
    const items = cal.filter((t) => spDay(Date.parse(t.due_at)) === day);
    const sorted = [...items.filter((t) => t.type === 'reuniao'), ...items.filter((t) => t.type !== 'reuniao')];
    return { day, total: items.length, reunioes: items.filter((t) => t.type === 'reuniao').length, items: sorted.slice(0, 6) };
  });

  // Pipeline horizontal: leads, R$ e TMA (tempo médio na etapa, em horas, das saídas dos últimos 90 dias; sem saídas, a idade média dos cards)
  const exits = Object.fromEntries(db.prepare(`SELECT h.from_stage_id AS id, AVG(h.seconds_in_previous) AS s FROM stage_history h JOIN opportunities o ON o.id = h.opportunity_id
    WHERE ${os.sql} AND h.from_stage_id IS NOT NULL AND h.seconds_in_previous IS NOT NULL AND h.moved_at >= ? GROUP BY h.from_stage_id`).all(...os.params, new Date(now - 90 * DAY).toISOString()).map((r) => [r.id, r.s]));
  const { temperatureOf } = require('./opportunities');
  const open = ctx.openOpps.filter((o) => o.status === 'aberta');
  const pipeline = ctx.stages.filter((st) => st.kind === 'aberta').map((st) => {
    const cards = open.filter((o) => o.stage_id === st.id);
    const age = cards.length ? cards.reduce((t, o) => t + (now - Date.parse(o.stage_entered_at)), 0) / cards.length / 1000 : null;
    const sec = exits[st.id] ?? age;
    const temps = { quente: 0, morno: 0, frio: 0 };
    for (const o of cards) temps[temperatureOf(o).level]++;
    return { id: st.id, key: st.key, name: st.name, leads: cards.length, valor: cards.reduce((t, o) => t + (o.proposal_value ?? o.credit_value ?? 0), 0), tma_horas: sec == null ? null : Math.round((sec / 3600) * 10) / 10, temps };
  });
  const cenario = pipeline.reduce((t, s) => ({ leads: t.leads + s.leads, valor: t.valor + s.valor, quente: t.quente + s.temps.quente, morno: t.morno + s.temps.morno, frio: t.frio + s.temps.frio }), { leads: 0, valor: 0, quente: 0, morno: 0, frio: 0 });
  const wonMonth = ctx.stages.find((st) => st.kind === 'ganho');
  cenario.ganhos_mes = wonMonth ? ctx.openOpps.filter((o) => o.stage_id === wonMonth.id).length : 0;

  // Ranking da squad (crédito vendido no mês): o especialista vê o próprio time
  const month = spDay(now).slice(0, 7);
  let rank = db.prepare(`SELECT u.id, u.name, u.photo, u.job_title, u.team_id, COUNT(s.id) AS vendas, COALESCE(SUM(s.credit_value), 0) AS credito FROM users u
    LEFT JOIN sales s ON s.seller_id = u.id AND s.status != 'cancelada' AND substr(COALESCE(s.payment_date, s.confirmed_at, s.created_at), 1, 7) = ?
    WHERE u.active = 1 AND u.role IN ('consultor','gestor') GROUP BY u.id ORDER BY credito DESC, vendas DESC, u.name`).all(month);
  if (user.role !== 'admin' && user.role !== 'leitura') rank = rank.filter((r) => (user.team_id ? r.team_id === user.team_id : r.id === user.id));

  // Insights da IA Vero: ações do dia + leitura dos números do período
  const ids = ctx.ids === null ? db.prepare("SELECT id FROM users WHERE active = 1 AND role IN ('consultor','gestor','admin')").all().map((r) => r.id) : ctx.ids;
  let insights = [];
  if (ids.length) {
    const k = bi.metrics(db, ids, null, from, to);
    const p = bi.metrics(db, ids, null, period.prev_from, period.prev_to);
    insights = bi.insights(k, p, bi.funnel(db, ids, null, from, to), [], [], Number(q.variante) || 0).slice(0, 4);
  }
  const AREA = { danger: 'Urgente', warn: 'Atenção', ok: 'Oportunidade', info: 'Lembrete' };
  const acts = ctx.actions.slice(0, 4).map((a) => ({ tone: AREA[a.level] ? a.level : 'info', area: AREA[a.level] || 'Lembrete', text: a.text, href: a.href }));
  return { period, kpis, days7, calendar, pipeline, cenario, ranking: rank.slice(0, 8), goal: ctx.goal, insights: [...acts, ...insights].slice(0, 7) };
}

module.exports = { home };
