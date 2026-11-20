'use strict';
/**
 * Gestão do time (líder de equipe e administrador): organograma e dashboard da squad.
 *
 *  - Organograma: diretoria (administradores) → times (líder e especialistas), com foto, cargo e os números do mês
 *    de cada pessoa (negócios em andamento, R1 do mês, vendas do mês).
 *  - Dashboard da squad: por especialista no período — leads recebidos, tentativas, qualificados, R1 agendadas,
 *    realizadas, no-show e remarcadas, R2, propostas, vendas, perdidos e SLA estourado — com as taxas de conversão,
 *    o funil atual da squad e os motivos de perda (MP).
 * O líder vê o próprio time; o administrador vê todos e escolhe o time.
 */
const { requireModule } = require('../permissions');
const { forbidden, toIso } = require('../util');

const guard = (user) => {
  requireModule(user, 'time');
  if (!['admin', 'gestor'].includes(user.role)) throw forbidden('A gestão do time é para líderes de equipe e administradores.');
};

function monthRange() {
  const d = new Date(Date.now() - 3 * 3600000);
  const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 3));
  return { from: from.toISOString(), to: new Date().toISOString() };
}

/** Times visíveis: o líder vê o(s) próprio(s); o administrador vê todos. */
function visibleTeams(db, user) {
  const all = db.prepare('SELECT t.*, u.name AS leader_name FROM teams t LEFT JOIN users u ON u.id = t.leader_id ORDER BY t.name').all();
  if (user.role === 'admin') return all;
  return all.filter((t) => t.id === user.team_id || t.leader_id === user.id);
}

/** Números do mês por pessoa (para o organograma). */
function personMetrics(db, ids, from, to) {
  if (!ids.length) return {};
  const ph = ids.map(() => '?').join(',');
  const out = Object.fromEntries(ids.map((id) => [id, { abertos: 0, r1_mes: 0, vendas_mes: 0, credito_mes: 0 }]));
  for (const r of db.prepare(`SELECT owner_id AS id, COUNT(*) AS n FROM opportunities WHERE status = 'aberta' AND owner_id IN (${ph}) GROUP BY owner_id`).all(...ids)) out[r.id].abertos = r.n;
  for (const r of db.prepare(`SELECT assigned_to AS id, COUNT(*) AS n FROM tasks WHERE type = 'reuniao' AND COALESCE(meeting_kind, 'r1') = 'r1' AND created_at BETWEEN ? AND ? AND rescheduled_from IS NULL AND assigned_to IN (${ph}) GROUP BY assigned_to`).all(from, to, ...ids)) out[r.id].r1_mes = r.n;
  for (const r of db.prepare(`SELECT seller_id AS id, COUNT(*) AS n, SUM(credit_value) AS v FROM sales WHERE status != 'cancelada' AND substr(COALESCE(payment_date, confirmed_at, created_at), 1, 10) BETWEEN ? AND ? AND seller_id IN (${ph}) GROUP BY seller_id`).all(from.slice(0, 10), to.slice(0, 10), ...ids)) {
    out[r.id].vendas_mes = r.n;
    out[r.id].credito_mes = r.v || 0;
  }
  return out;
}

const PERSON_COLS = 'id, name, email, role, team_id, job_title, photo, phone, whatsapp, active';

function orgChart(db, user) {
  guard(user);
  const { from, to } = monthRange();
  const teams = visibleTeams(db, user);
  const users = db.prepare(`SELECT ${PERSON_COLS} FROM users WHERE active = 1 ORDER BY name`).all();
  const metrics = personMetrics(db, users.map((u) => u.id), from, to);
  const node = (u) => ({ ...u, metrics: metrics[u.id] || null });
  const directors = user.role === 'admin' ? users.filter((u) => u.role === 'admin').map(node) : [];
  const teamNodes = teams.map((t) => {
    const members = users.filter((u) => u.team_id === t.id && u.id !== t.leader_id);
    const leader = users.find((u) => u.id === t.leader_id) || null;
    return {
      id: t.id, name: t.name,
      leader: leader ? node(leader) : null,
      members: members.map(node),
      totals: [leader, ...members].filter(Boolean).reduce((a, u) => {
        const m = metrics[u.id] || {};
        a.pessoas += 1;
        a.abertos += m.abertos || 0;
        a.r1_mes += m.r1_mes || 0;
        a.vendas_mes += m.vendas_mes || 0;
        a.credito_mes += m.credito_mes || 0;
        return a;
      }, { pessoas: 0, abertos: 0, r1_mes: 0, vendas_mes: 0, credito_mes: 0 }),
    };
  });
  const teamIds = new Set(teams.map((t) => t.id));
  const noTeam = user.role === 'admin' ? users.filter((u) => u.role !== 'admin' && !teamIds.has(u.team_id)).map(node) : [];
  return { month_from: from, directors, teams: teamNodes, no_team: noTeam };
}

/** Dashboard da squad: indicadores por especialista no período e funil atual. */
function squadDashboard(db, user, q = {}) {
  guard(user);
  const teams = visibleTeams(db, user);
  const teamId = q.time ? Number(q.time) : null;
  if (teamId && !teams.some((t) => t.id === teamId)) throw forbidden('Você não lidera este time.');
  const def = monthRange();
  const from = q.from ? toIso(q.from) : def.from;
  const to = q.to ? toIso(q.to) : def.to;
  const scopeTeams = teamId ? teams.filter((t) => t.id === teamId) : teams;
  let people = db.prepare(`SELECT ${PERSON_COLS} FROM users WHERE active = 1 AND role IN ('consultor','gestor') ORDER BY name`).all()
    .filter((u) => scopeTeams.some((t) => t.id === u.team_id || t.leader_id === u.id));
  if (user.role === 'admin' && !teamId) people = db.prepare(`SELECT ${PERSON_COLS} FROM users WHERE active = 1 AND role IN ('consultor','gestor') ORDER BY name`).all();
  const ids = people.map((u) => u.id);
  if (!ids.length) return { teams, team_id: teamId, period: { from, to }, rows: [], totals: null, funnel: [], lost: [] };
  const ph = ids.map(() => '?').join(',');
  const d0 = from.slice(0, 10);
  const d1 = to.slice(0, 10);
  const blank = () => ({ leads: 0, tentativas: 0, qualificados: 0, r1_agendadas: 0, r1_realizadas: 0, r1_no_show: 0, r1_remarcadas: 0, r2_agendadas: 0, r2_realizadas: 0, propostas: 0, vendas: 0, credito: 0, perdidos: 0, ganhos_r1: 0, abertos: 0, sla_estourado: 0 });
  const m = Object.fromEntries(ids.map((id) => [id, blank()]));
  const put = (rows, key, val = 'n') => rows.forEach((r) => m[r.id] && (m[r.id][key] = r[val] || 0));
  put(db.prepare(`SELECT owner_id AS id, COUNT(*) AS n FROM contacts WHERE merged_into_id IS NULL AND COALESCE(assigned_at, created_at) BETWEEN ? AND ? AND owner_id IN (${ph}) GROUP BY owner_id`).all(from, to, ...ids), 'leads');
  put(db.prepare(`SELECT user_id AS id, COUNT(*) AS n FROM activities WHERE type IN ('ligacao_realizada','tentativa_sem_atendimento','mensagem_enviada','email_enviado','direct_enviado') AND occurred_at BETWEEN ? AND ? AND user_id IN (${ph}) GROUP BY user_id`).all(from, to, ...ids), 'tentativas');
  put(db.prepare(`SELECT o.owner_id AS id, COUNT(DISTINCT h.opportunity_id) AS n FROM stage_history h JOIN opportunities o ON o.id = h.opportunity_id JOIN pipeline_stages s ON s.id = h.to_stage_id WHERE s.key = 'qualificado' AND h.moved_at BETWEEN ? AND ? AND o.owner_id IN (${ph}) GROUP BY o.owner_id`).all(from, to, ...ids), 'qualificados');
  const meet = (kind, cond, key, dateCol = 'created_at') =>
    put(db.prepare(`SELECT assigned_to AS id, COUNT(*) AS n FROM tasks WHERE type = 'reuniao' AND COALESCE(meeting_kind, 'r1') = ? AND ${cond} AND ${dateCol} BETWEEN ? AND ? AND assigned_to IN (${ph}) GROUP BY assigned_to`).all(kind, from, to, ...ids), key);
  meet('r1', 'rescheduled_from IS NULL', 'r1_agendadas');
  meet('r1', "status = 'concluida' AND outcome = 'realizada'", 'r1_realizadas', 'completed_at');
  meet('r1', "outcome = 'nao_compareceu'", 'r1_no_show', 'completed_at');
  meet('r1', 'rescheduled_from IS NOT NULL', 'r1_remarcadas');
  meet('r2', 'rescheduled_from IS NULL', 'r2_agendadas');
  meet('r2', "status = 'concluida' AND outcome = 'realizada'", 'r2_realizadas', 'completed_at');
  put(db.prepare(`SELECT owner_id AS id, COUNT(*) AS n FROM proposals WHERE version = 1 AND created_at BETWEEN ? AND ? AND owner_id IN (${ph}) GROUP BY owner_id`).all(from, to, ...ids), 'propostas');
  for (const r of db.prepare(`SELECT seller_id AS id, COUNT(*) AS n, SUM(credit_value) AS v FROM sales WHERE status != 'cancelada' AND substr(COALESCE(payment_date, confirmed_at, created_at), 1, 10) BETWEEN ? AND ? AND seller_id IN (${ph}) GROUP BY seller_id`).all(d0, d1, ...ids)) {
    if (m[r.id]) {
      m[r.id].vendas = r.n;
      m[r.id].credito = r.v || 0;
    }
  }
  put(db.prepare(`SELECT owner_id AS id, COUNT(*) AS n FROM opportunities WHERE status = 'perdida' AND closed_at BETWEEN ? AND ? AND owner_id IN (${ph}) GROUP BY owner_id`).all(from, to, ...ids), 'perdidos');
  put(db.prepare(`SELECT owner_id AS id, COUNT(*) AS n FROM opportunities WHERE r1_won_at BETWEEN ? AND ? AND owner_id IN (${ph}) GROUP BY owner_id`).all(from, to, ...ids), 'ganhos_r1');
  // Situação atual: negócios abertos e SLA estourado
  const opps = require('./opportunities');
  const open = opps.board(db, { ...user, role: 'admin' }, { owner_ids: ids }).stages.flatMap((s) => s.cards).filter((c) => c.status === 'aberta' && ids.includes(c.owner_id));
  for (const c of open) {
    m[c.owner_id].abertos += 1;
    if (c.sla?.level === 'estourado') m[c.owner_id].sla_estourado += 1;
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
  const rate = (x) => ({
    ...x,
    tx_lead_r1: pct(x.r1_agendadas, x.leads),
    tx_comparecimento: pct(x.r1_realizadas, x.r1_realizadas + x.r1_no_show),
    tx_r1_venda: pct(x.vendas, x.r1_realizadas),
  });
  const rows = people.map((u) => rate({ id: u.id, nome: u.name, foto: u.photo, cargo: u.job_title, ...m[u.id] }));
  const totals = rate(rows.reduce((t, r) => {
    for (const k of Object.keys(blank())) t[k] = (t[k] || 0) + (r[k] || 0);
    return t;
  }, {}));
  const stageOrder = db.prepare("SELECT id, name, key, kind FROM pipeline_stages WHERE active = 1 AND kind = 'aberta' ORDER BY position").all();
  const funnel = stageOrder.map((s) => {
    const cards = open.filter((c) => c.stage_id === s.id);
    return { key: s.key, name: s.name, n: cards.length, ns: cards.filter((c) => c.meetings?.r1?.state === 'no_show').length, valor: cards.reduce((t, c) => t + (c.deal_value || 0), 0) };
  });
  const lost = db.prepare(`SELECT o.lost_reason AS motivo, COUNT(*) AS n FROM opportunities o WHERE o.status = 'perdida' AND o.closed_at BETWEEN ? AND ? AND o.owner_id IN (${ph}) GROUP BY o.lost_reason ORDER BY n DESC`).all(from, to, ...ids)
    .map((r) => ({ ...r, label: db.prepare("SELECT label FROM options WHERE list = 'motivo_perda' AND value = ?").get(r.motivo)?.label || r.motivo || 'Não informado' }));
  return { teams, team_id: teamId, period: { from, to }, rows, totals, funnel, lost };
}

module.exports = { orgChart, squadDashboard };
