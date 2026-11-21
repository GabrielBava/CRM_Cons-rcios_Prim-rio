// BI do time (Gestão do time): painel de performance da squad para o líder e o administrador, com os dados do CRM.
// Filtros: período (dia, semana, quinzena, mês vigente ou data específica), time, colaborador e área.
import { get } from '../api.js';
import { html, render, $, $$, on, avatar, fmtMoney, fmtNum, selectOptions, empty, toast, toastError, subnav, state } from '../ui.js';
import { icon } from '../icons.js';

const PERIODS = [['dia', 'Dia'], ['semana', 'Semana'], ['quinzena', 'Quinzena'], ['mes', 'Mês vigente'], ['data', 'Data específica']];
const AREA_LABEL = { consorcio: 'Consórcio', planejamento: 'Planejamento', seguros: 'Seguros', investimentos: 'Investimentos' };
let saved = { periodo: 'mes', variante: 0 };

/** hh:mm:ss (as horas passam de 24 quando o tempo é longo). */
export function hms(s) {
  if (s == null) return '—';
  s = Math.max(0, Math.round(s));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}
const pctTxt = (v) => (v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const money0 = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }));
const days = (v) => (v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dia${v === 1 ? '' : 's'}`);
const stageTime = (s) => (s == null ? '—' : s >= 86400 ? `${(s / 86400).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} d` : `${Math.max(1, Math.round(s / 3600))} h`);

/**
 * Indicadores: [chave, rótulo, formato, menor é melhor?, definição]. formato: n (quantidade), money, pct, hms, days.
 * A comparação com o período anterior usa p.p. para taxas e % para quantidades e valores.
 */
const GROUPS = [
  ['Pipeline e entrada', [
    ['pipeline_qtd', 'Pipeline geral', 'n', false, 'Negócios em andamento agora (retrato do momento).', true],
    ['pipeline_valor', 'Valor em pipeline', 'money', false, 'Soma dos negócios em andamento: maior proposta ativa ou, sem proposta, o crédito desejado.', true],
    ['leads_recebidos', 'Leads recebidos', 'n', false, 'Leads atribuídos no período (data de atribuição ou de cadastro).'],
    ['leads_movimentados', 'Leads movimentados', 'n', false, 'Negócios que mudaram de etapa no período.'],
  ]],
  ['Agenda', [
    ['taxa_agendamento', 'Taxa de agendamento', 'pct', false, 'R1 agendadas no período ÷ leads recebidos no período.'],
    ['taxa_no_show', 'Taxa de no-show', 'pct', true, 'Reuniões (R1 e R2) do período em que o cliente não compareceu ÷ (realizadas + no-show).'],
    ['taxa_realizacao_r1', 'Taxa de realização R1', 'pct', false, 'R1 realizadas ÷ R1 com horário no período (sem as canceladas).'],
    ['taxa_realizacao_r2', 'Taxa de realização R2', 'pct', false, 'R2 realizadas ÷ R2 com horário no período (sem as canceladas).'],
  ]],
  ['Atendimento', [
    ['tmr', 'TMR · 1º atendimento', 'hms', true, 'Tempo médio entre receber o lead e o primeiro contato.'],
    ['tma', 'TMA · atendimento', 'hms', true, 'Duração média das ligações e conversas registradas com duração.'],
    ['tme', 'TME · espera na fila', 'hms', true, 'Tempo médio do lead na fila de distribuição até ser atribuído.'],
    ['ligacoes', 'Ligações realizadas', 'n', false, 'Ligações feitas no período (atendidas e sem atendimento).'],
  ]],
  ['Tarefas', [
    ['tarefas_criadas', 'Tarefas criadas', 'n', false, 'Tarefas criadas no período para o time.'],
    ['tarefas_concluidas', 'Tarefas concluídas', 'n', false, 'Tarefas concluídas no período.'],
    ['tarefas_atraso', 'Tarefas em atraso', 'n', true, 'Tarefas pendentes com prazo vencido agora.', true],
  ]],
  ['Resultado', [
    ['win_rate', 'Win rate', 'pct', false, 'Negócios ganhos ÷ (ganhos + perdidos) fechados no período.'],
    ['ciclo_dias', 'Ciclo médio de vendas', 'days', true, 'Dias entre a criação e o ganho do negócio (ganhos no período).'],
    ['receita', 'Receita gerada', 'money', false, 'Crédito vendido no período (vendas não canceladas).'],
    ['ticket_medio', 'Ticket médio', 'money', false, 'Receita gerada ÷ número de vendas.'],
  ]],
];

function fmt(v, f) {
  if (f === 'money') return money0(v);
  if (f === 'pct') return pctTxt(v);
  if (f === 'hms') return hms(v);
  if (f === 'days') return days(v);
  return fmtNum(v ?? 0);
}

/** Variação contra o período anterior: p.p. nas taxas, % nas quantidades e valores; cor pelo que é melhor. */
function delta(v, p, f, lowerBetter) {
  if (v == null || p == null) return '';
  let txt;
  let diff;
  if (f === 'pct') {
    diff = Math.round((v - p) * 10) / 10;
    txt = `${diff > 0 ? '+' : ''}${diff.toLocaleString('pt-BR')} p.p.`;
  } else if (!p) {
    if (!v) return '';
    diff = 1;
    txt = 'novo';
  } else {
    diff = (v - p) / Math.abs(p);
    txt = `${diff > 0 ? '+' : ''}${Math.round(diff * 100)}%`;
  }
  if (!diff) return html`<span class="bi-delta flat">= anterior</span>`;
  const good = lowerBetter ? diff < 0 : diff > 0;
  return html`<span class="bi-delta ${good ? 'up' : 'down'}" title="Período anterior: ${fmt(p, f)}">${diff > 0 ? '▲' : '▼'} ${txt}</span>`;
}

function kpiGroups(d) {
  const k = d.kpis;
  const p = d.prev;
  return html`<div class="bi-groups">${GROUPS.map(([title, items], gi) => html`<section class="bi-group g-${gi}"><h3>${title}</h3><div class="bi-tiles">
    ${items.map(([key, label, f, lower, def, snapshot]) => html`<div class="bi-tile" title="${def}"><span class="bi-label">${label}</span><strong class="bi-value">${fmt(k[key], f)}</strong>
      <span class="bi-sub">${snapshot ? html`<span class="muted">agora</span>` : delta(k[key], p[key], f, lower)}${key === 'ligacoes' ? html` <span class="muted">${fmtNum(k.ligacoes_atendidas)} atendidas</span>` : ''}${key === 'win_rate' ? html` <span class="muted">${k.ganhos} ganhos · ${k.perdidos} perdidos</span>` : ''}${key === 'taxa_realizacao_r1' ? html` <span class="muted">${k.r1_realizadas}/${k.r1_previstas}</span>` : ''}${key === 'taxa_realizacao_r2' ? html` <span class="muted">${k.r2_realizadas}/${k.r2_previstas}</span>` : ''}</span></div>`)}
  </div></section>`)}</div>`;
}

/** Funil de conversão horizontal: faixa contínua com a altura proporcional aos negócios que chegaram a cada etapa. */
function funnelChart(fun) {
  if (!fun.length || !fun[0].n) return empty('Nenhum negócio criado no período para montar o funil.');
  const top = fun[0].n;
  const W = 1000;
  const H = 120;
  const w = W / fun.length;
  const h = (n) => Math.max(6, (n / top) * (H - 8));
  let path = `M 0 ${(H - h(fun[0].n)) / 2}`;
  fun.forEach((s, i) => {
    const y = (H - h(s.n)) / 2;
    const next = fun[i + 1] ? (H - h(fun[i + 1].n)) / 2 : y;
    path += ` L ${i * w + w * 0.55} ${y} C ${i * w + w * 0.8} ${y} ${i * w + w * 0.8} ${next} ${(i + 1) * w} ${next}`;
  });
  for (let i = fun.length - 1; i >= 0; i--) {
    const y = (H + h(fun[i].n)) / 2;
    const prev = fun[i - 1] ? (H + h(fun[i - 1].n)) / 2 : y;
    path += ` L ${i * w + w * 0.55} ${y} C ${i * w + w * 0.2} ${y} ${i * w + w * 0.2} ${prev} ${i * w} ${prev}`;
  }
  path += ' Z';
  return html`<div class="bi-funnel" style="--n:${fun.length}">
    <div class="bf-cols">${fun.map((s) => html`<div class="bf-col ${s.kind === 'ganho' ? 'won' : ''}"><span class="bf-name">${s.name}</span><strong class="bf-n">${fmtNum(s.n)}</strong>
      <span class="bf-pct">${pctTxt(s.pct_topo)} do topo</span></div>`)}</div>
    <svg class="bf-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="bfg" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="var(--primary-bright)" stop-opacity=".9"/><stop offset="1" stop-color="var(--primary)" stop-opacity=".55"/></linearGradient></defs>
      <path d="${path}" fill="url(#bfg)"/>${fun.slice(1).map((s, i) => html`<line x1="${(i + 1) * w}" x2="${(i + 1) * w}" y1="0" y2="${H}" class="bf-sep"/>`)}</svg>
    <div class="bf-cols bf-foot">${fun.map((s) => html`<div class="bf-col"><span>${s.conv_etapa == null ? 'entrada' : html`<b>${pctTxt(s.conv_etapa)}</b> da etapa anterior`}</span><span class="muted">tempo médio ${stageTime(s.tempo_medio)}</span></div>`)}</div>
  </div>`;
}

function lostChart(lost) {
  if (!lost.length) return empty('Nenhum negócio perdido no período.');
  const max = lost[0].n;
  return html`<div class="bi-bars">${lost.map((l) => html`<div class="bi-bar"><span class="bb-label">${l.label}</span><span class="bb-track"><span style="width:${Math.round((l.n / max) * 100)}%"></span></span><strong>${l.n}</strong><small class="muted">${pctTxt(l.pct)}</small></div>`)}</div>`;
}

function peopleTable(rows) {
  if (!rows.length) return empty('Nenhum colaborador neste filtro.');
  return html`<div class="table-wrap"><table class="data bi-table"><thead><tr><th>#</th><th>Colaborador</th><th class="num">Leads</th><th class="num">Agend.</th><th class="num">Realiz. R1</th><th class="num">No-show</th><th class="num">TMR</th><th class="num">Ligações</th><th class="num">Atraso</th><th class="num">Propostas</th><th class="num">Win rate</th><th class="num">Receita</th><th class="num">Ticket</th></tr></thead>
    <tbody>${rows.map((r, i) => html`<tr>
      <td data-label="#"><span class="bi-rank r${i + 1}">${i + 1}</span></td>
      <td data-label="Colaborador"><span class="sq-person">${avatar({ name: r.nome, photo: r.foto }, 28)} <span><strong>${r.nome}</strong>${r.cargo ? html`<br><small class="muted">${r.cargo}</small>` : ''}</span></span></td>
      <td data-label="Leads" class="num">${fmtNum(r.leads_recebidos)}</td>
      <td data-label="Agendamento" class="num">${pctTxt(r.taxa_agendamento)}</td>
      <td data-label="Realização R1" class="num">${pctTxt(r.taxa_realizacao_r1)}</td>
      <td data-label="No-show" class="num ${r.taxa_no_show > 20 ? 'danger-text' : ''}">${pctTxt(r.taxa_no_show)}</td>
      <td data-label="TMR" class="num">${hms(r.tmr)}</td>
      <td data-label="Ligações" class="num">${fmtNum(r.ligacoes)}</td>
      <td data-label="Tarefas em atraso" class="num ${r.tarefas_atraso ? 'danger-text' : ''}">${fmtNum(r.tarefas_atraso)}</td>
      <td data-label="Propostas" class="num">${fmtNum(r.propostas)}</td>
      <td data-label="Win rate" class="num">${pctTxt(r.win_rate)}</td>
      <td data-label="Receita" class="num"><strong>${money0(r.receita)}</strong></td>
      <td data-label="Ticket médio" class="num">${money0(r.ticket_medio)}</td></tr>`)}</tbody></table></div>`;
}

const TONE_LABEL = { ok: 'Positivo', warn: 'Atenção', danger: 'Crítico', info: 'Informativo' };
function insightsCard(items) {
  return html`<section class="card bi-ai"><div class="bi-ai-head"><span class="vai-orb xs" aria-hidden="true"><span></span><i></i></span><h3>Insights da Vero IA</h3>
    <span class="bi-ai-actions"><button type="button" class="btn small" data-bi="regen">${icon('ia', 14)} Regenerar</button><button type="button" class="btn small ghost" data-bi="copy">${icon('copiar', 14)} Copiar</button></span></div>
    <ul class="bi-ai-list">${items.map((x) => html`<li class="tone-${x.tone}"><span class="bi-ai-dot" title="${TONE_LABEL[x.tone] || ''}"></span><div><strong>${x.area}</strong><p>${x.text}</p></div></li>`)}</ul></section>`;
}

const DEFINITIONS = () => html`<details class="card bi-defs"><summary>Como cada indicador é calculado</summary><dl>${GROUPS.flatMap(([, items]) => items).map(([, label, , , def]) => html`<dt>${label}</dt><dd>${def}</dd>`)}
  <dt>Taxa de conversão por etapa</dt><dd>Dos negócios criados no período, quantos chegaram a cada etapa; mostra o % da etapa anterior, o % do topo e o tempo médio que os negócios ficaram na etapa.</dd>
  <dt>Motivos de perda (MP)</dt><dd>Negócios perdidos no período, por motivo, com a participação de cada um.</dd>
  <dt>Comparação</dt><dd>Cada indicador compara com o período anterior de mesmo tamanho (ex.: mês vigente até hoje × os mesmos dias antes do início do mês). Pipeline e tarefas em atraso são o retrato de agora.</dd></dl></details>`;

export async function show(view, tabs) {
  const admin = state.user.role === 'admin';
  render(view, html`<div class="page wide bi-page">${tabs('bi')}
    <div class="page-head"><div><h1>BI do time</h1><p class="muted">Performance da squad com os dados do CRM: entrada, agenda, atendimento, tarefas, funil e resultado.</p></div><div class="bi-period" data-bi-period></div></div>
    <form class="bi-filters" data-f>
      <span class="view-toggle bi-seg" role="group" aria-label="Período">${PERIODS.map(([v, l]) => html`<button type="button" data-periodo="${v}" class="${saved.periodo === v ? 'active' : ''}">${l}</button>`)}</span>
      <span class="bi-dates" ${saved.periodo === 'data' ? '' : 'hidden'}><label>De <input type="date" name="de" value="${saved.de || ''}"></label><label>Até <input type="date" name="ate" value="${saved.ate || ''}"></label></span>
      <select name="time" aria-label="Time" ${admin ? '' : 'hidden'}></select>
      <select name="colaborador" aria-label="Colaborador"></select>
      <select name="area" aria-label="Área">${selectOptions(Object.entries(AREA_LABEL).map(([value, label]) => ({ value, label })), saved.area, { placeholder: 'Todas as áreas' })}</select>
    </form>
    <div id="bi"></div></div>`);
  const form = $('[data-f]', view);
  const box = $('#bi', view);
  let data = null;
  const load = async () => {
    const f = Object.fromEntries(new FormData(form).entries());
    saved = { ...saved, ...f };
    if (saved.periodo === 'data' && !saved.de) {
      render(box, html`<section class="card">${empty('Escolha a data (ou o intervalo) para ver os indicadores.')}</section>`);
      return;
    }
    box.classList.add('loading');
    try {
      data = await get('/api/time/bi', { periodo: saved.periodo, de: saved.de, ate: saved.ate, time: saved.time, colaborador: saved.colaborador, area: saved.area, variante: saved.variante });
    } catch (e) {
      box.classList.remove('loading');
      return toastError(e);
    }
    box.classList.remove('loading');
    const fl = data.filters;
    form.time.innerHTML = String(selectOptions(fl.teams.map((t) => ({ value: t.id, label: t.name })), fl.team_id || '', { placeholder: 'Todos os times' }));
    form.colaborador.innerHTML = String(selectOptions(fl.people.map((u) => ({ value: u.id, label: u.name })), fl.colaborador || '', { placeholder: 'Toda a squad' }));
    const pr = data.period;
    const dt = (iso) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    render($('[data-bi-period]', view), html`<span class="chip-sm">${pr.label}</span> <small class="muted">${dt(pr.from)} a ${dt(new Date(Date.parse(pr.to) - 1).toISOString())} · comparado a ${dt(pr.prev_from)}–${dt(new Date(Date.parse(pr.prev_to) - 1).toISOString())}</small>`);
    if (!data.kpis) return render(box, html`<section class="card">${empty('Nenhum colaborador neste time.')}</section>`);
    render(box, html`${kpiGroups(data)}
      <section class="card"><div class="section-head"><h3>Taxa de conversão por etapa</h3><small class="muted">negócios criados no período · ${fmtNum(data.funnel[0]?.n || 0)} no topo</small></div>${funnelChart(data.funnel)}</section>
      <div class="bi-cols">
        <section class="card"><h3>Motivos de perda (MP)</h3>${lostChart(data.lost)}</section>
        ${insightsCard(data.insights)}
      </div>
      <section class="card"><div class="section-head"><h3>Por colaborador</h3><small class="muted">ranking por receita gerada no período</small></div>${peopleTable(data.people)}</section>
      ${DEFINITIONS()}`);
  };
  on(form, 'click', '[data-periodo]', (e, b) => {
    saved.periodo = b.dataset.periodo;
    $$('[data-periodo]', form).forEach((x) => x.classList.toggle('active', x === b));
    $('.bi-dates', form).hidden = saved.periodo !== 'data';
    if (saved.periodo === 'data' && !form.de.value) {
      form.de.value = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
    }
    load();
  });
  form.addEventListener('change', (e) => {
    if (e.target.name === 'time') form.colaborador.value = '';
    load();
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  on(view, 'click', '[data-bi=regen]', () => {
    saved.variante = (Number(saved.variante) || 0) + 1;
    load().then(() => toast('Insights regenerados.'));
  });
  on(view, 'click', '[data-bi=copy]', async () => {
    const text = (data?.insights || []).map((x) => `• ${x.area}: ${x.text}`).join('\n');
    try {
      await navigator.clipboard.writeText(`Insights da Vero IA · ${data.period.label}\n${text}`);
    } catch {
      /* navegador sem permissão de área de transferência */
    }
    toast('Insights copiados.');
  });
  await load();
}
