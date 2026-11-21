'use strict';
/**
 * BI do time (Gestão do time › BI do time): painel de performance da squad só para o líder e o administrador.
 *
 * Filtros: período (dia, semana, quinzena, mês vigente ou data específica/intervalo), time (administrador),
 * colaborador da squad e área de negócio. Cada indicador traz o valor do período anterior de mesmo tamanho.
 *
 * Definições (horários de Brasília):
 *  - Pipeline geral / Valor em pipeline: negócios abertos agora (retrato do momento, não depende do período);
 *    valor = maior proposta ativa do negócio ou, sem proposta, o crédito desejado.
 *  - Leads recebidos: leads atribuídos ao colaborador no período (data de atribuição ou de cadastro).
 *  - Leads movimentados: negócios que mudaram de etapa no período.
 *  - Taxa de agendamento: R1 agendadas no período ÷ leads recebidos no período.
 *  - Taxa de no-show: reuniões (R1 e R2) com horário no período em que o cliente não compareceu ÷ (realizadas + no-show).
 *  - Taxa de realização R1/R2: reuniões realizadas ÷ reuniões com horário no período (já passado), sem as canceladas.
 *  - TMR: tempo médio entre receber o lead e o primeiro contato.
 *  - TMA: duração média das ligações e conversas registradas (com duração).
 *  - TME: tempo médio de espera do lead na fila de distribuição até ser atribuído.
 *  - Ligações realizadas: ligações feitas (atendidas e tentativas sem atendimento).
 *  - Tarefas criadas/concluídas no período; em atraso: pendentes vencidas agora.
 *  - Conversão por etapa: dos negócios criados no período, quantos chegaram a cada etapa (% da etapa anterior e % do topo).
 *  - Win rate: negócios ganhos ÷ (ganhos + perdidos) fechados no período.
 *  - Ciclo médio de vendas: dias entre a criação e o ganho do negócio (ganhos no período).
 *  - Receita gerada: crédito vendido (vendas não canceladas no período); ticket médio = receita ÷ vendas.
 *  - Motivos de perda (MP): negócios perdidos no período por motivo.
 */
const { requireModule } = require('../permissions');
const { forbidden, badRequest } = require('../util');

const DAY = 86400000;
const SP = 3 * 3600000;
const AREAS = ['consorcio', 'planejamento', 'seguros', 'investimentos'];

const guard = (user) => {
  requireModule(user, 'time');
  if (!['admin', 'gestor'].includes(user.role)) throw forbidden('O BI do time é para líderes de equipe e administradores.');
};

/** Período em horário de Brasília: dia, semana (segunda a hoje), quinzena vigente, mês vigente ou data específica. */
function periodOf(q = {}, now = Date.now()) {
  const sp = new Date(now - SP);
  const y = sp.getUTCFullYear();
  const m = sp.getUTCMonth();
  const d = sp.getUTCDate();
  const midnight = Date.UTC(y, m, d) + SP;
  let from;
  let to = now;
  let label;
  const kind = ['dia', 'semana', 'quinzena', 'mes', 'data'].includes(q.periodo) ? q.periodo : 'mes';
  if (kind === 'dia') {
    from = midnight;
    label = 'Hoje';
  } else if (kind === 'semana') {
    from = midnight - ((sp.getUTCDay() + 6) % 7) * DAY;
    label = 'Esta semana';
  } else if (kind === 'quinzena') {
    from = Date.UTC(y, m, d <= 15 ? 1 : 16) + SP;
    label = d <= 15 ? '1ª quinzena do mês' : '2ª quinzena do mês';
  } else if (kind === 'data') {
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const de = re.test(q.de || '') ? q.de : null;
    const ate = re.test(q.ate || '') ? q.ate : de;
    if (!de) throw badRequest('Informe a data (de) no formato AAAA-MM-DD.');
    from = Date.parse(`${de}T00:00:00Z`) + SP;
    to = Math.min(Date.parse(`${ate}T23:59:59.999Z`) + SP, Math.max(now, from + DAY - 1));
    if (to < from) throw badRequest('A data final deve ser depois da inicial.');
    label = ate && ate !== de ? `${de.split('-').reverse().join('/')} a ${ate.split('-').reverse().join('/')}` : de.split('-').reverse().join('/');
  } else {
    from = Date.UTC(y, m, 1) + SP;
    label = 'Mês vigente';
  }
  const len = Math.max(to - from, 3600000);
  return { kind, label, from: new Date(from).toISOString(), to: new Date(to).toISOString(), prev_from: new Date(from - len).toISOString(), prev_to: new Date(from).toISOString() };
}

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const round = (v) => (v == null ? null : Math.round(v));

/** Indicadores de um grupo de pessoas (ids) no período, com filtro opcional de área. */
function metrics(db, ids, area, from, to) {
  const ph = ids.map(() => '?').join(',');
  const nowIso = new Date().toISOString();
  const upTo = to < nowIso ? to : nowIso;
  const aOpp = (al) => (area ? ` AND ${al}.business_area = ?` : '');
  const aCt = (col) => (area ? ` AND EXISTS (SELECT 1 FROM opportunities ax WHERE ax.contact_id = ${col} AND ax.business_area = ?)` : '');
  const A = area ? [area] : [];
  const one = (sql, ...p) => db.prepare(sql).get(...p) || {};
  const out = {};

  const pipe = one(`SELECT COUNT(*) AS n, SUM(COALESCE((SELECT MAX(pr.credit_value) FROM proposals pr WHERE pr.opportunity_id = o.id AND pr.status IN ('rascunho','apresentada','em_analise','aprovada')), o.credit_value, 0)) AS v
    FROM opportunities o JOIN pipeline_stages s ON s.id = o.stage_id WHERE o.status = 'aberta' AND s.kind = 'aberta' AND o.owner_id IN (${ph})${aOpp('o')}`, ...ids, ...A);
  out.pipeline_qtd = pipe.n || 0;
  out.pipeline_valor = pipe.v || 0;
  out.leads_recebidos = one(`SELECT COUNT(*) AS n FROM contacts c WHERE c.merged_into_id IS NULL AND COALESCE(c.assigned_at, c.created_at) >= ? AND COALESCE(c.assigned_at, c.created_at) < ? AND c.owner_id IN (${ph})${aCt('c.id')}`, from, to, ...ids, ...A).n || 0;
  out.leads_movimentados = one(`SELECT COUNT(DISTINCT h.opportunity_id) AS n FROM stage_history h JOIN opportunities o ON o.id = h.opportunity_id
    WHERE h.from_stage_id IS NOT NULL AND h.moved_at >= ? AND h.moved_at < ? AND o.owner_id IN (${ph})${aOpp('o')}`, from, to, ...ids, ...A).n || 0;

  // Reuniões
  const meet = (cond, ...p) => one(`SELECT COUNT(*) AS n FROM tasks t WHERE t.type = 'reuniao' AND ${cond} AND t.assigned_to IN (${ph})${aCt('t.contact_id')}`, ...p, ...ids, ...A).n || 0;
  out.r1_agendadas = meet("COALESCE(t.meeting_kind, 'r1') = 'r1' AND t.rescheduled_from IS NULL AND t.created_at >= ? AND t.created_at < ?", from, to);
  for (const k of ['r1', 'r2']) {
    const inWin = `COALESCE(t.meeting_kind, 'r1') = '${k}' AND t.due_at >= ? AND t.due_at < ?`;
    const previstas = meet(`${inWin} AND NOT (t.status = 'cancelada' AND COALESCE(t.outcome, '') IN ('', 'cancelada'))`, from, upTo);
    const realizadas = meet(`${inWin} AND t.status = 'concluida' AND t.outcome = 'realizada'`, from, upTo);
    const noShow = meet(`${inWin} AND t.outcome = 'nao_compareceu'`, from, upTo);
    out[`${k}_previstas`] = previstas;
    out[`${k}_realizadas`] = realizadas;
    out[`${k}_no_show`] = noShow;
    out[`taxa_realizacao_${k}`] = pct(realizadas, previstas);
  }
  out.taxa_agendamento = pct(out.r1_agendadas, out.leads_recebidos);
  out.taxa_no_show = pct(out.r1_no_show + out.r2_no_show, out.r1_realizadas + out.r2_realizadas + out.r1_no_show + out.r2_no_show);

  // Tempos (segundos)
  out.tmr = round(one(`SELECT AVG((julianday(c.first_contact_at) - julianday(COALESCE(c.assigned_at, c.created_at))) * 86400) AS s FROM contacts c
    WHERE c.merged_into_id IS NULL AND c.first_contact_at IS NOT NULL AND c.first_contact_at >= COALESCE(c.assigned_at, c.created_at)
      AND COALESCE(c.assigned_at, c.created_at) >= ? AND COALESCE(c.assigned_at, c.created_at) < ? AND c.owner_id IN (${ph})${aCt('c.id')}`, from, to, ...ids, ...A).s);
  out.tma = round(one(`SELECT AVG(a.duration_seconds) AS s FROM activities a WHERE a.duration_seconds > 0
    AND a.type IN ('ligacao_realizada','ligacao_recebida','conversa_presencial','conversa_video','reuniao_realizada')
    AND a.occurred_at >= ? AND a.occurred_at < ? AND a.user_id IN (${ph})${aCt('a.contact_id')}`, from, to, ...ids, ...A).s);
  out.tme = round(one(`SELECT AVG((julianday(f.at) - julianday(c.created_at)) * 86400) AS s FROM contacts c
    JOIN (SELECT contact_id, MIN(created_at) AS at FROM distribution_log WHERE from_user IS NULL GROUP BY contact_id) f ON f.contact_id = c.id
    JOIN distribution_log d ON d.contact_id = c.id AND d.created_at = f.at
    WHERE f.at >= c.created_at AND f.at >= ? AND f.at < ? AND d.to_user IN (${ph})${aCt('c.id')}`, from, to, ...ids, ...A).s);

  // Ligações e tarefas
  const calls = one(`SELECT COUNT(*) AS n, SUM(a.type = 'ligacao_realizada') AS ok FROM activities a WHERE a.type IN ('ligacao_realizada','tentativa_sem_atendimento')
    AND a.occurred_at >= ? AND a.occurred_at < ? AND a.user_id IN (${ph})${aCt('a.contact_id')}`, from, to, ...ids, ...A);
  out.ligacoes = calls.n || 0;
  out.ligacoes_atendidas = calls.ok || 0;
  out.tarefas_criadas = one(`SELECT COUNT(*) AS n FROM tasks t WHERE t.created_at >= ? AND t.created_at < ? AND t.assigned_to IN (${ph})${aCt('t.contact_id')}`, from, to, ...ids, ...A).n || 0;
  out.tarefas_concluidas = one(`SELECT COUNT(*) AS n FROM tasks t WHERE t.status = 'concluida' AND t.completed_at >= ? AND t.completed_at < ? AND t.assigned_to IN (${ph})${aCt('t.contact_id')}`, from, to, ...ids, ...A).n || 0;
  out.tarefas_atraso = one(`SELECT COUNT(*) AS n FROM tasks t WHERE t.status = 'pendente' AND t.due_at < ? AND t.assigned_to IN (${ph})${aCt('t.contact_id')}`, nowIso, ...ids, ...A).n || 0;

  // Resultado
  const closed = one(`SELECT SUM(o.status = 'ganha') AS g, SUM(o.status = 'perdida') AS p, AVG(CASE WHEN o.status = 'ganha' THEN julianday(o.closed_at) - julianday(o.created_at) END) AS ciclo
    FROM opportunities o WHERE o.status IN ('ganha','perdida') AND o.closed_at >= ? AND o.closed_at < ? AND o.owner_id IN (${ph})${aOpp('o')}`, from, to, ...ids, ...A);
  out.ganhos = closed.g || 0;
  out.perdidos = closed.p || 0;
  out.win_rate = pct(out.ganhos, out.ganhos + out.perdidos);
  out.ciclo_dias = closed.ciclo == null ? null : Math.round(closed.ciclo * 10) / 10;
  const d0 = new Date(Date.parse(from) - SP).toISOString().slice(0, 10);
  const d1 = new Date(Date.parse(to) - SP - 1).toISOString().slice(0, 10);
  const sales = one(`SELECT COUNT(*) AS n, SUM(sa.credit_value) AS v FROM sales sa LEFT JOIN opportunities o ON o.id = sa.opportunity_id
    WHERE sa.status != 'cancelada' AND substr(COALESCE(sa.payment_date, sa.confirmed_at, sa.created_at), 1, 10) BETWEEN ? AND ? AND sa.seller_id IN (${ph})${aOpp('o')}`, d0, d1, ...ids, ...A);
  out.vendas = sales.n || 0;
  out.receita = sales.v || 0;
  out.ticket_medio = out.vendas ? Math.round(out.receita / out.vendas) : null;
  out.propostas = one(`SELECT COUNT(*) AS n FROM proposals pr WHERE pr.version = 1 AND pr.created_at >= ? AND pr.created_at < ? AND pr.owner_id IN (${ph})${area ? ' AND COALESCE(pr.area, \'consorcio\') = ?' : ''}`, from, to, ...ids, ...A).n || 0;
  return out;
}

/** Funil de conversão dos negócios criados no período: quantos chegaram a cada etapa e o tempo médio em cada uma. */
function funnel(db, ids, area, from, to) {
  const ph = ids.map(() => '?').join(',');
  const A = area ? [area] : [];
  const stages = db.prepare("SELECT id, key, name, position, kind FROM pipeline_stages WHERE active = 1 AND kind IN ('aberta','ganho') ORDER BY position").all();
  const posOf = new Map(stages.map((s, i) => [s.id, i]));
  const opps = db.prepare(`SELECT o.id, o.stage_id, o.lost_from_stage_id FROM opportunities o WHERE o.created_at >= ? AND o.created_at < ? AND o.owner_id IN (${ph})${area ? ' AND o.business_area = ?' : ''}`).all(from, to, ...ids, ...A);
  const reached = stages.map(() => 0);
  for (const o of opps) {
    let max = Math.max(posOf.get(o.stage_id) ?? -1, posOf.get(o.lost_from_stage_id) ?? -1, 0);
    for (const h of db.prepare('SELECT to_stage_id FROM stage_history WHERE opportunity_id = ?').all(o.id)) max = Math.max(max, posOf.get(h.to_stage_id) ?? -1);
    for (let k = 0; k <= max; k++) reached[k]++;
  }
  // Tempo médio na etapa: saídas da etapa no período (negócios do grupo)
  const times = Object.fromEntries(db.prepare(`SELECT h.from_stage_id AS id, AVG(h.seconds_in_previous) AS s, COUNT(*) AS n FROM stage_history h JOIN opportunities o ON o.id = h.opportunity_id
    WHERE h.from_stage_id IS NOT NULL AND h.seconds_in_previous IS NOT NULL AND h.moved_at >= ? AND h.moved_at < ? AND o.owner_id IN (${ph})${area ? ' AND o.business_area = ?' : ''} GROUP BY h.from_stage_id`).all(from, to, ...ids, ...A).map((r) => [r.id, r]));
  const top = reached[0] || 0;
  return stages.map((s, i) => ({
    key: s.key, name: s.name, kind: s.kind, n: reached[i],
    pct_topo: pct(reached[i], top), conv_etapa: i === 0 ? null : pct(reached[i], reached[i - 1]),
    tempo_medio: times[s.id] ? Math.round(times[s.id].s) : null,
  }));
}

function lostReasons(db, ids, area, from, to) {
  const ph = ids.map(() => '?').join(',');
  const A = area ? [area] : [];
  const rows = db.prepare(`SELECT o.lost_reason AS motivo, COUNT(*) AS n FROM opportunities o WHERE o.status = 'perdida' AND o.closed_at >= ? AND o.closed_at < ? AND o.owner_id IN (${ph})${area ? ' AND o.business_area = ?' : ''} GROUP BY o.lost_reason ORDER BY n DESC`).all(from, to, ...ids, ...A);
  const total = rows.reduce((t, r) => t + r.n, 0);
  return rows.map((r) => ({ motivo: r.motivo, n: r.n, pct: pct(r.n, total), label: db.prepare("SELECT label FROM options WHERE list = 'motivo_perda' AND value = ?").get(r.motivo)?.label || r.motivo || 'Não informado' }));
}

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const fmtTime = (s) => {
  if (s == null) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
};

/**
 * Insights da IA Vero sobre o período: comparação com o período anterior, gargalos do funil, no-show, tempo de
 * resposta, tarefas em atraso e destaques do time. "Regenerar" muda o foco (variante) e a ordem.
 */
function insights(k, p, fun, lost, people, variant = 0) {
  const out = [];
  const pt = (v) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const delta = (a, b) => (a == null || b == null ? null : Math.round((a - b) * 10) / 10);
  const d = (key) => delta(k[key], p[key]);
  if (k.leads_recebidos || p.leads_recebidos) {
    const dl = k.leads_recebidos - p.leads_recebidos;
    out.push({ tone: dl >= 0 ? 'ok' : 'warn', area: 'Volume', text: `${k.leads_recebidos} leads recebidos no período (${dl >= 0 ? '+' : ''}${dl} vs. período anterior) e ${k.leads_movimentados} negócios movimentados no funil.` });
  }
  if (k.taxa_agendamento != null) {
    const dd = d('taxa_agendamento');
    out.push({ tone: k.taxa_agendamento >= 30 ? 'ok' : 'warn', area: 'Agendamento', text: `Taxa de agendamento de ${pt(k.taxa_agendamento)}%${dd != null ? ` (${dd >= 0 ? '+' : ''}${pt(dd)} p.p.)` : ''}. ${k.taxa_agendamento < 30 ? 'Reforce o roteiro da primeira ligação e a oferta de dois horários para a R1.' : 'Mantenha a cadência de primeiro contato em até 5 minutos.'}` });
  }
  if (k.taxa_no_show != null && k.taxa_no_show > 0) {
    out.push({ tone: k.taxa_no_show > 20 ? 'danger' : 'info', area: 'No-show', text: `No-show de ${pt(k.taxa_no_show)}% nas reuniões. ${k.taxa_no_show > 20 ? 'Confirme a R1 na véspera e 1 hora antes pelo WhatsApp: costuma reduzir o no-show pela metade.' : 'Dentro do esperado; siga confirmando as reuniões na véspera.'}` });
  }
  if (k.tmr != null) out.push({ tone: k.tmr > 3600 ? 'warn' : 'ok', area: 'Velocidade', text: `Primeiro atendimento em ${fmtTime(k.tmr)} em média (TMR). ${k.tmr > 3600 ? 'Leads atendidos depois de 1 hora convertem bem menos: priorize a fila de novos no início de cada bloco de ligações.' : 'Bom tempo de resposta.'}` });
  // Gargalo do funil: menor conversão entre etapas com volume
  const steps = fun.filter((s) => s.conv_etapa != null && fun[fun.indexOf(s) - 1]?.n >= 3);
  if (steps.length) {
    const worst = steps.reduce((a, b) => (b.conv_etapa < a.conv_etapa ? b : a));
    const prevName = fun[fun.indexOf(worst) - 1].name;
    out.push({ tone: 'warn', area: 'Funil', text: `Maior perda de conversão entre ${prevName} e ${worst.name} (${pt(worst.conv_etapa)}%). Revise o que o time faz nessa passagem e os motivos de perda dessa etapa.` });
  }
  if (lost.length) out.push({ tone: 'info', area: 'Motivos de perda', text: `Principal motivo de perda: ${lost[0].label} (${lost[0].n}, ${pt(lost[0].pct)}% das perdas). ${lost.length > 1 ? `Em seguida: ${lost[1].label}.` : ''}` });
  if (k.tarefas_atraso) {
    const worst = [...people].sort((a, b) => b.tarefas_atraso - a.tarefas_atraso)[0];
    out.push({ tone: 'danger', area: 'Tarefas', text: `${k.tarefas_atraso} tarefas em atraso no time${worst?.tarefas_atraso ? `; ${worst.nome.split(' ')[0]} concentra ${worst.tarefas_atraso}` : ''}. Combine um bloco para zerar os atrasos antes de novos contatos.` });
  }
  if (k.win_rate != null) out.push({ tone: k.win_rate >= 25 ? 'ok' : 'warn', area: 'Fechamento', text: `Win rate de ${pt(k.win_rate)}% (${k.ganhos} ganhos e ${k.perdidos} perdidos)${k.ciclo_dias != null ? `, ciclo médio de ${pt(k.ciclo_dias)} dias` : ''}.` });
  if (k.receita) out.push({ tone: 'ok', area: 'Receita', text: `${fmtMoney(k.receita)} em crédito vendido em ${k.vendas} venda(s), ticket médio de ${fmtMoney(k.ticket_medio)}${p.receita ? ` (${k.receita >= p.receita ? '+' : ''}${Math.round(((k.receita - p.receita) / p.receita) * 100)}% vs. período anterior)` : ''}.` });
  const top = [...people].filter((x) => x.receita || x.r1_realizadas).sort((a, b) => b.receita - a.receita || b.r1_realizadas - a.r1_realizadas)[0];
  if (top) out.push({ tone: 'ok', area: 'Destaque', text: `Destaque do período: ${top.nome} (${top.vendas} venda(s), ${top.r1_realizadas} R1 realizada(s)). Vale compartilhar a abordagem com o time no próximo one-on-one.` });
  if (!out.length) out.push({ tone: 'info', area: 'Período', text: 'Ainda não há movimento suficiente neste período para gerar insights. Amplie o período ou escolha outro colaborador.' });
  // Variante: muda a ordem e o foco (até 6 itens)
  const n = out.length;
  const rot = variant % n;
  return [...out.slice(rot), ...out.slice(0, rot)].slice(0, 6);
}

function teamDashboard(db, user, q = {}) {
  guard(user);
  const team = require('./team');
  const teams = team.visibleTeams(db, user);
  const teamId = q.time ? Number(q.time) : null;
  if (teamId && !teams.some((t) => t.id === teamId)) throw forbidden('Você não lidera este time.');
  const area = q.area && AREAS.includes(q.area) ? q.area : null;
  const period = periodOf(q);
  const scope = teamId ? teams.filter((t) => t.id === teamId) : teams;
  const all = db.prepare("SELECT id, name, photo, job_title, team_id, role FROM users WHERE active = 1 AND role IN ('consultor','gestor') ORDER BY name").all();
  let people = user.role === 'admin' && !teamId ? all : all.filter((u) => scope.some((t) => t.id === u.team_id || t.leader_id === u.id));
  const squad = people.map((u) => ({ id: u.id, name: u.name }));
  if (q.colaborador) {
    const id = Number(q.colaborador);
    if (!people.some((u) => u.id === id)) throw forbidden('Colaborador fora da sua squad.');
    people = people.filter((u) => u.id === id);
  }
  const ids = people.map((u) => u.id);
  const base = { period, filters: { teams: teams.map((t) => ({ id: t.id, name: t.name })), team_id: teamId, people: squad, colaborador: q.colaborador ? Number(q.colaborador) : null, area }, areas: AREAS };
  if (!ids.length) return { ...base, kpis: null, prev: null, funnel: [], lost: [], people: [], insights: [] };
  const k = metrics(db, ids, area, period.from, period.to);
  const p = metrics(db, ids, area, period.prev_from, period.prev_to);
  const fun = funnel(db, ids, area, period.from, period.to);
  const lost = lostReasons(db, ids, area, period.from, period.to);
  const rows = people.map((u) => ({ id: u.id, nome: u.name, foto: u.photo, cargo: u.job_title, ...metrics(db, [u.id], area, period.from, period.to) }))
    .sort((a, b) => b.receita - a.receita || b.ganhos - a.ganhos || b.r1_realizadas - a.r1_realizadas || a.nome.localeCompare(b.nome));
  const variant = Number(q.variante) || 0;
  return { ...base, kpis: k, prev: p, funnel: fun, lost, people: rows, insights: insights(k, p, fun, lost, rows, variant), variant };
}

module.exports = { teamDashboard, periodOf, metrics, funnel, insights };
