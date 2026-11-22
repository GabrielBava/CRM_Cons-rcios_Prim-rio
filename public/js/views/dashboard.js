// 1. Painel inicial: visão do dia do especialista (ou consolidada para líder e administrador) e ações sugeridas.
import { get } from '../api.js';
import { html, render, $, on, state, selectOptions, userItems, fmtMoney, fmtMoneyShort, badge, empty, toast, toastError, monthLabel, avatar } from '../ui.js';
import { bindDrawerLinks } from '../drawer.js';
import { tempBadge } from '../qualification.js';
import { icon } from '../icons.js';
import { onboardingCard } from './onboarding.js';

const LEVEL = { alta: ['Alta', 'ok'], media: ['Média', 'warn'], baixa: ['Baixa', 'danger'] };
export const probBadge = (p) => badge(`${LEVEL[p.level]?.[0] || '—'} · ${p.probability}%`, LEVEL[p.level]?.[1] || '');
const pctBar = (pct) => html`<div class="progress-bar goal"><span style="width:${Math.min(100, pct || 0)}%"></span></div>`;

let selected = '';
let filter = { periodo: 'mes', de: '', ate: '', variante: 0 };
const PERIODS = [['dia', 'Dia'], ['semana', 'Semana'], ['quinzena', 'Quinzena'], ['mes', 'Mês'], ['data', 'Data específica']];
const kpiIco = (name) => html`<span class="kpi-ico">${icon(name, 15)}</span>`;
// Etiqueta escrita de cada ação sugerida (o status nunca é comunicado só pela cor)
const actionTag = (a) => (a.level === 'danger' ? badge('Urgente', 'danger') : a.level === 'warn' ? (/hoje/i.test(a.text) ? badge('Hoje', 'warn') : badge('Atenção', 'warn')) : a.level === 'ok' ? badge('Oportunidade', 'ok') : '');
// Número primeiro, em destaque: "7 leads ainda sem nenhum contato"
const actionText = (t) => {
  const m = String(t).match(/^((?:Faltam\s+)?(?:R\$\s?)?[\d.,]+\s+[^\s:;]+)(.*)$/);
  return m ? html`<strong>${m[1]}</strong>${m[2]}` : t;
};
export { actionTag, actionText };

/** hh:mm:ss */
const hms = (s) => {
  if (s == null) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(Math.round(s % 60))}`;
};
const pctTxt = (v) => (v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const WEEK = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const dayLabel = (iso, today) => {
  const d = new Date(`${iso}T12:00:00`);
  return iso === today ? 'Hoje' : `${WEEK[d.getDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
};
const hhmm = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Ganhos (verde) e perdidos (vermelho) por dia, últimos 7 dias. */
function winLossChart(days, today) {
  const max = Math.max(1, ...days.map((d) => Math.max(d.ganhos, d.perdidos)));
  const tg = days.reduce((t, d) => t + d.ganhos, 0);
  const tp = days.reduce((t, d) => t + d.perdidos, 0);
  return html`<div class="wl-head"><span class="wl-legend"><i class="wl-won"></i> Ganhos <strong>${tg}</strong></span><span class="wl-legend"><i class="wl-lost"></i> Perdidos <strong>${tp}</strong></span>
      <span class="muted small">${fmtMoneyShort(days.reduce((t, d) => t + d.valor_ganho, 0))} ganhos na semana</span></div>
    <div class="wl-chart" role="img" aria-label="Ganhos e perdidos nos últimos 7 dias: ${tg} ganhos e ${tp} perdidos">${days.map((d) => html`<div class="wl-day">
      <div class="wl-bars"><span class="wl-bar won" style="height:${(d.ganhos / max) * 100}%" title="${d.ganhos} ganho(s)">${d.ganhos ? html`<b>${d.ganhos}</b>` : ''}</span><span class="wl-bar lost" style="height:${(d.perdidos / max) * 100}%" title="${d.perdidos} perdido(s)">${d.perdidos ? html`<b>${d.perdidos}</b>` : ''}</span></div>
      <span class="wl-label">${dayLabel(d.day, today)}</span></div>`)}</div>`;
}

function calendar5(cal, today) {
  return html`<ol class="cal5">${cal.map((d) => html`<li class="${d.day === today ? 'today' : ''}"><div class="cal5-day"><strong>${dayLabel(d.day, today)}</strong><small class="muted">${d.total ? `${d.total} item(ns)${d.reunioes ? ` · ${d.reunioes} reunião(ões)` : ''}` : 'livre'}</small></div>
    ${d.items.length ? html`<ul>${d.items.map((t) => html`<li class="${t.type === 'reuniao' ? 'meet' : ''} ${t.status === 'concluida' ? 'done' : ''}"><time>${hhmm(t.due_at)}</time><span>${t.type === 'reuniao' ? html`<b>${String(t.meeting_kind || 'r1').toUpperCase()}</b> ` : ''}${t.contact_id ? html`<a href="#/leads/${t.contact_id}" data-drawer="${t.contact_id}">${t.contact_name || t.title}</a>` : t.title}${t.type !== 'reuniao' && t.contact_id ? html`<small class="muted"> · ${t.title.replace(/ \(PR-[\d-v]+\)$/, '').slice(0, 48)}</small>` : ''}</span></li>`)}${d.total > d.items.length ? html`<li class="more"><a href="#/agenda">+${d.total - d.items.length} na agenda</a></li>` : ''}</ul>` : ''}</li>`)}</ol>`;
}

function pipeline360(stages, c) {
  return html`<div class="p360-summary">
      <div><span>Leads no pipeline</span><strong>${c.leads}</strong></div>
      <div><span>R$ em oportunidade</span><strong>${fmtMoneyShort(c.valor)}</strong></div>
      <div><span>Temperatura</span><strong class="p360-temps">${tempBadge('quente')} ${c.quente} ${tempBadge('morno')} ${c.morno} ${tempBadge('frio')} ${c.frio}</strong></div>
      <div><span>Vendas no mês</span><strong>${c.ganhos_mes}</strong></div></div>
    <div class="p360-flow" role="list">${stages.map((s, i) => html`<a class="p360-stage" role="listitem" href="#/funil" style="--i:${i}">
      <span class="p360-name">${s.name}</span><strong class="p360-n">${s.leads}</strong><span class="p360-sub">${s.leads === 1 ? 'lead' : 'leads'}</span>
      <span class="p360-val">${s.valor ? fmtMoneyShort(s.valor) : 'R$ 0'}</span><span class="p360-tma" title="Tempo médio na etapa (horas)">TMA ${s.tma_horas == null ? '—' : `${s.tma_horas.toLocaleString('pt-BR')} h`}</span></a>`)}</div>`;
}

function filterLabel() {
  const p = PERIODS.find(([v]) => v === filter.periodo)?.[1] || 'Mês';
  const per = filter.periodo === 'data' && filter.de ? `${filter.de.split('-').reverse().join('/')}${filter.ate && filter.ate !== filter.de ? ` a ${filter.ate.split('-').reverse().join('/')}` : ''}` : p === 'Mês' ? 'Mês vigente' : p;
  const who = selected ? userItems().find((u) => String(u.value) === String(selected))?.label : null;
  return `${per}${who ? ` · ${who}` : ''}`;
}

export async function show(view) {
  const manager = ['admin', 'gestor', 'leitura'].includes(state.user.role);
  const load = async () => {
    let d;
    let ob = null;
    try {
      [d, ob] = await Promise.all([get('/api/inicio', { ...(selected ? { user_id: selected } : {}), periodo: filter.periodo, de: filter.de, ate: filter.ate, variante: filter.variante }), get('/api/integracao').catch(() => null)]);
    } catch (e) {
      toastError(e);
      return;
    }
    const hour = new Date().getHours();
    const hello = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
    const v = d.v360;
    const k = v.kpis;
    const g = v.goal;
    const today = v.calendar[0]?.day;
    const per = v.period.kind === 'mes' ? 'no mês' : v.period.kind === 'dia' ? 'hoje' : 'no período';
    render(view, html`<div class="page wide home360">
      <div class="page-head"><div><h1>${hello}, ${state.user.name.split(' ')[0]}!</h1><p class="muted">${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })} · ${d.scope.name ? `visão de ${d.scope.name}` : d.scope.all ? 'visão de toda a empresa' : 'visão da sua equipe'}</p></div>
        <div class="h360-filter"><button type="button" class="btn pb-filter-btn" data-hf aria-expanded="false">${icon('filtro', 16)} ${filterLabel()}</button>
          <form class="filter-panel h360-panel" data-hf-panel hidden>
            <fieldset class="h360-periods"><legend>Período</legend>${PERIODS.map(([val, l]) => html`<label class="h360-opt"><input type="radio" name="periodo" value="${val}" ${filter.periodo === val ? 'checked' : ''}> ${l}</label>`)}</fieldset>
            <div class="h360-dates" ${filter.periodo === 'data' ? '' : 'hidden'}><label>De<input type="date" name="de" value="${filter.de}"></label><label>Até<input type="date" name="ate" value="${filter.ate}"></label></div>
            ${manager ? html`<label class="h360-who">Ver<select name="user">${selectOptions(userItems(), selected, { placeholder: state.user.role === 'admin' ? 'Toda a empresa' : 'Minha equipe' })}</select></label>` : ''}
            <div class="fp-actions"><button type="button" class="btn ghost" data-hf-close>Cancelar</button><button class="btn primary">Aplicar</button></div>
          </form></div></div>
      ${onboardingCard(ob)}

      <div class="kpis k360">
        <a class="kpi" href="#/leads">${kpiIco('leads')}<div class="kpi-label">Leads recebidos (24 horas)</div><div class="kpi-value">${k.leads_24h}</div><div class="kpi-sub">${k.leads_periodo} ${per}${d.no_contact ? html` · <span class="overdue">${d.no_contact} sem contato</span>` : ''}</div></a>
        <a class="kpi" href="#/funil">${kpiIco('relatorios')}<div class="kpi-label">Taxa de conversão</div><div class="kpi-value">${pctTxt(k.taxa_conversao)}</div><div class="kpi-sub">${k.ganhos} ganho(s) de ${k.leads_periodo} lead(s) ${per}</div></a>
        <a class="kpi" href="#/leads">${kpiIco('telefone')}<div class="kpi-label">Tempo médio de resposta</div><div class="kpi-value mono">${hms(k.tempo_resposta)}</div><div class="kpi-sub">do lead recebido ao 1º contato</div></a>
        <a class="kpi" href="#/propostas">${kpiIco('propostas')}<div class="kpi-label">Propostas em andamento</div><div class="kpi-value">${k.propostas_andamento}</div><div class="kpi-sub">${fmtMoney(k.propostas_valor)}</div></a>
        <a class="kpi" href="#/vendas">${kpiIco('vendas')}<div class="kpi-label">Receita ${v.period.kind === 'mes' ? 'no mês' : 'no período'}</div><div class="kpi-value">${fmtMoneyShort(k.vendas_valor)}</div><div class="kpi-sub" title="Crédito vendido + valor de planejamento vendido">${k.vendas_qtd} venda(s)${k.receita_planejamento ? ` · ${fmtMoneyShort(k.receita_credito)} crédito + ${fmtMoneyShort(k.receita_planejamento)} planejamento` : ` · ${fmtMoney(k.vendas_valor)}`}</div></a>
        <a class="kpi" href="#/propostas?ver=lista">${kpiIco('confirmar')}<div class="kpi-label">Taxa de conversão de propostas</div><div class="kpi-value">${pctTxt(k.taxa_conversao_propostas)}</div><div class="kpi-sub">${k.propostas_aceitas} aceita(s) de ${k.propostas_decididas} decidida(s)</div></a>
        <a class="kpi ${d.agenda.atrasadas ? 'alert-kpi' : ''}" href="#/agenda">${kpiIco('agenda')}<div class="kpi-label">Agendas de hoje</div><div class="kpi-value">${k.agendas_hoje}</div><div class="kpi-sub">reuniões · ${k.tarefas_hoje} tarefa(s) · ${d.agenda.atrasadas} atrasada(s)</div></a>
      </div>

      <div class="h360-row">
        <section class="card"><div class="section-head"><h3>Ganhos e perdidos · últimos 7 dias</h3><a href="#/funil?ver=perdidos" class="small">ver perdidos</a></div>${winLossChart(v.days7, today)}</section>
        <section class="card"><div class="section-head"><h3>Calendário · 5 dias</h3><a href="#/calendario" class="small">abrir</a></div>${calendar5(v.calendar, today)}</section>
      </div>

      <section class="card"><div class="section-head"><h3>Pipeline · cenário geral</h3><a href="#/funil" class="small">abrir o pipeline</a></div>${pipeline360(v.pipeline, v.cenario)}
        <p class="hint">Leads e R$ de oportunidade por etapa (proposta ativa ou, sem proposta, o crédito desejado). TMA: tempo médio que os negócios ficam na etapa, em horas.</p></section>

      <div class="h360-three">
        <section class="card"><div class="section-head"><h3>Ranking da squad</h3><small class="muted">crédito vendido no mês</small></div>
          ${v.ranking.length ? html`<ol class="ranking ranking-people">${v.ranking.map((r, i) => html`<li class="${i < 3 && r.vendas ? `top top-${i + 1}` : ''} ${r.id === state.user.id ? 'me' : ''}">
            <span class="rank-pos">${i + 1}º</span>${avatar(r, 32)}
            <span class="rank-who"><strong>${r.name}</strong>${r.job_title ? html`<small>${r.job_title}</small>` : ''}</span>
            <span class="rank-nums"><strong>${r.vendas} ${r.vendas === 1 ? 'venda' : 'vendas'}</strong><small>${fmtMoneyShort(r.credito)}</small></span></li>`)}</ol>` : empty('Sem ranking para mostrar.')}</section>
        <section class="card"><div class="section-head"><h3>Meta de ${monthLabel(d.month)}</h3><a href="#/metas" class="small">detalhes</a></div>
          ${g.target_credit || g.target_sales
            ? html`<div class="goal-head"><div class="goal-ring" style="--p:${Math.min(100, g.pct_credit || 0)}"><span>${pctTxt(g.pct_credit ?? 0)}</span></div>
                <p>${g.realized_sales ? html`<strong>${g.realized_sales} ${g.realized_sales === 1 ? 'venda' : 'vendas'}</strong> no mês.` : 'Nenhuma venda registrada ainda.'}${g.target_sales && g.target_sales > g.realized_sales ? html`<br>Faltam <strong>${g.target_sales - g.realized_sales} ${g.target_sales - g.realized_sales === 1 ? 'venda' : 'vendas'}</strong> para a meta.` : ''}</p></div>
              <div class="goal-row"><span>Crédito vendido</span><strong>${fmtMoneyShort(g.realized_credit)} / ${fmtMoneyShort(g.target_credit)}</strong></div>${pctBar(g.pct_credit)}
              <div class="goal-row"><span>Vendas</span><strong>${g.realized_sales} / ${g.target_sales ?? '—'}</strong></div>${pctBar(g.pct_sales)}
              <div class="goal-tiles">
                <div><span>Falta</span><strong>${g.missing_credit != null ? fmtMoneyShort(g.missing_credit) : '—'}</strong></div>
                <div><span>Ritmo / dia útil</span><strong>${g.daily_needed ? fmtMoneyShort(g.daily_needed) : '—'}</strong></div>
                <div><span>Dias úteis</span><strong>${g.business_days_left}</strong></div></div>`
            : html`<p class="muted">Nenhuma meta cadastrada para este mês. O administrador cadastra as metas em Metas.</p>`}</section>
        <section class="card bi-ai"><div class="bi-ai-head"><span class="vai-orb xs" aria-hidden="true"><span></span><i></i></span><h3>Insights da Vero IA</h3>
          <span class="bi-ai-actions"><button type="button" class="btn small" data-h360="regen">${icon('ia', 14)} Regenerar</button><button type="button" class="btn small ghost" data-h360="copy">${icon('copiar', 14)} Copiar</button></span></div>
          ${v.insights.length ? html`<ul class="bi-ai-list">${v.insights.map((x) => html`<li class="tone-${x.tone}"><span class="bi-ai-dot"></span><div><strong>${x.area}</strong><p>${x.href ? html`<a href="${x.href}">${actionText(x.text)}</a>` : x.text}</p></div></li>`)}</ul>` : empty('Tudo em dia. Aproveite para prospectar e pedir indicações.')}</section>
      </div>
    </div>`);
    const btn = $('[data-hf]', view);
    const panel = $('[data-hf-panel]', view);
    btn.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      btn.setAttribute('aria-expanded', String(!panel.hidden));
    });
    $('[data-hf-close]', view).addEventListener('click', () => {
      panel.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    });
    panel.addEventListener('change', (e) => {
      if (e.target.name === 'periodo') {
        $('.h360-dates', panel).hidden = e.target.value !== 'data';
        if (e.target.value === 'data' && !panel.de.value) panel.de.value = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
      }
    });
    panel.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(panel).entries());
      filter = { ...filter, periodo: f.periodo || 'mes', de: f.de || '', ate: f.ate || '' };
      if (manager) selected = f.user || '';
      load();
    });
    cur = v;
  };
  let cur = null;
  on(view, 'click', '[data-h360=regen]', () => {
    filter.variante = (filter.variante || 0) + 1;
    load().then(() => toast('Insights regenerados.'));
  });
  on(view, 'click', '[data-h360=copy]', async () => {
    if (!cur) return;
    const text = cur.insights.map((x) => `• ${x.area}: ${x.text}`).join('\n');
    try {
      await navigator.clipboard.writeText(`Insights da Vero IA · ${cur.period.label}\n${text}`);
    } catch {}
    toast('Insights copiados.');
  });
  bindDrawerLinks(view);
  await load();
}
