// Operacional › Calendário: panorama 360 (somente leitura) de tudo o que o usuário tem para fazer e do que já fez —
// tarefas, R1, R2, one-on-ones marcados pelo líder e as atividades registradas. Visões por dia, semana, mês e período.
// Nada é agendado por aqui: as reuniões e tarefas nascem no Pipeline, na Agenda e tarefas e em Gestão do time.
import { get } from '../api.js';
import { html, raw, render, $, $$, on, state, modal, toastError, K, optLabel, empty, can } from '../ui.js';

const KINDS = {
  r1: { label: 'R1', cls: 'k-r1' },
  r2: { label: 'R2', cls: 'k-r2' },
  one_on_one: { label: 'One-on-one', cls: 'k-1on1' },
  tarefa: { label: 'Tarefas', cls: 'k-task' },
  atividade: { label: 'Atividades feitas', cls: 'k-act' },
};
const VIEWS = [['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês'], ['periodo', 'Período']];
const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const STATE_LABEL = { pendente: 'Pendente', concluida: 'Concluída', no_show: 'Não compareceu (NS)', remarcada: 'Remarcada', feita: 'Registrada' };

// who: '' = meu calendário; 'todos' = equipe/empresa (padrão do líder e do administrador); 'u:<id>'; 't:<id>'
let saved = { view: 'semana', date: null, who: null, hidden: [], from: '', to: '' };

const pad = (n) => String(n).padStart(2, '0');
const dKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => new Date(`${k}T00:00:00`);
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const startOfWeek = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return addDays(x, -((x.getDay() + 6) % 7));
};
const hm = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const longDay = (d) => d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

/** Intervalo consultado e rótulo da visão atual. */
function range() {
  const base = saved.date ? parseKey(saved.date) : new Date(new Date().setHours(0, 0, 0, 0));
  if (saved.view === 'dia') return { from: base, to: addDays(base, 1), label: longDay(base) };
  if (saved.view === 'mes') {
    const first = new Date(base.getFullYear(), base.getMonth(), 1);
    const gridStart = startOfWeek(first);
    return { from: gridStart, to: addDays(gridStart, 42), month: base.getMonth(), label: first.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) };
  }
  if (saved.view === 'periodo') {
    const from = saved.from ? parseKey(saved.from) : startOfWeek(base);
    const to = saved.to ? addDays(parseKey(saved.to), 1) : addDays(from, 14);
    return { from, to: to > from ? to : addDays(from, 1), label: `${from.toLocaleDateString('pt-BR')} a ${addDays(to, -1).toLocaleDateString('pt-BR')}` };
  }
  const s = startOfWeek(base);
  return { from: s, to: addDays(s, 7), label: `${s.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} a ${addDays(s, 6).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}` };
}

function move(step) {
  const base = saved.date ? parseKey(saved.date) : new Date();
  if (saved.view === 'dia') saved.date = dKey(addDays(base, step));
  else if (saved.view === 'semana') saved.date = dKey(addDays(base, 7 * step));
  else if (saved.view === 'mes') saved.date = dKey(new Date(base.getFullYear(), base.getMonth() + step, 1));
}

const evTitle = (e) => (e.kind === 'atividade' ? `${e.title}${e.contact_name ? ` · ${e.contact_name}` : ''}` : e.kind === 'tarefa' || e.kind === 'one_on_one' ? e.title : `${KINDS[e.kind].label} · ${e.contact_name || e.title}`);
const pill = (e, { time = true } = {}) => html`<button type="button" class="cal-ev ${KINDS[e.kind].cls} st-${e.state} ${e.overdue ? 'overdue' : ''}" data-ev="${e.id}" title="${evTitle(e)}">
  ${time ? html`<span class="t">${hm(e.start)}</span>` : ''}<span class="x">${evTitle(e)}</span>${e.state === 'no_show' ? html`<span class="badge ns">NS</span>` : ''}</button>`;

export async function show(view, { params = {} } = {}) {
  if (params.visao && VIEWS.some(([k]) => k === params.visao)) saved.view = params.visao;
  if (params.data) saved.date = params.data;
  const manager = ['admin', 'gestor'].includes(state.user.role);
  render(view, html`<div class="page wide cal-page">
    <div class="page-head"><div><h1>Calendário</h1><p class="muted">Panorama 360 de agendas e atividades: R1, R2, one-on-ones, tarefas e tudo o que foi registrado. Somente visualização — as agendas são criadas no Pipeline, em Agendas e tarefas e em Gestão do time.</p></div></div>
    <div class="cal-toolbar">
      <div class="cal-nav"><button type="button" class="btn small" data-cal="hoje">Hoje</button><button type="button" class="btn small icon-btn" data-cal="prev" aria-label="Anterior">‹</button><button type="button" class="btn small icon-btn" data-cal="next" aria-label="Próximo">›</button><strong class="cal-label" aria-live="polite"></strong></div>
      <div class="seg small" role="group" aria-label="Visão">${VIEWS.map(([k, l]) => html`<button type="button" class="btn small" data-view="${k}">${l}</button>`)}</div>
      <form class="cal-period" data-period hidden><label>De<input type="date" name="from"></label><label>Até<input type="date" name="to"></label></form>
      ${manager ? html`<label class="cal-who">Calendário de<select data-who></select></label>` : ''}
    </div>
    <div class="cal-legend" data-legend></div>
    <div class="cal-kpis" data-kpis></div>
    <div id="cal-body" class="cal-body"></div>
  </div>`);
  let data = null;
  let peopleLoaded = false;

  const fillWho = (d) => {
    const sel = $('[data-who]', view);
    if (!sel || peopleLoaded) return;
    peopleLoaded = true;
    const others = d.people.filter((p) => p.id !== state.user.id);
    sel.innerHTML = String(html`<option value="">Meu calendário</option>
      <option value="todos">${state.user.role === 'admin' ? 'Toda a empresa' : 'Toda a equipe'}</option>
      ${d.teams.length > 1 || state.user.role === 'admin' ? d.teams.map((t) => html`<option value="t:${t.id}">Time ${t.name}</option>`) : ''}
      <optgroup label="Pessoas">${others.map((p) => html`<option value="u:${p.id}">${p.name}</option>`)}</optgroup>`);
    sel.value = saved.who;
  };

  const load = async () => {
    const r = range();
    $('.cal-label', view).textContent = r.label.charAt(0).toUpperCase() + r.label.slice(1);
    $$('[data-view]', view).forEach((b) => b.classList.toggle('active', b.dataset.view === saved.view));
    const per = $('[data-period]', view);
    per.hidden = saved.view !== 'periodo';
    $$('[data-cal=prev], [data-cal=next]', view).forEach((b) => (b.hidden = saved.view === 'periodo'));
    if (saved.view === 'periodo') {
      per.from.value = dKey(r.from);
      per.to.value = dKey(addDays(r.to, -1));
    }
    const q = { from: r.from.toISOString(), to: r.to.toISOString() };
    if (saved.who === 'todos') q.todos = 1;
    else if (saved.who.startsWith('u:')) q.user_id = saved.who.slice(2);
    else if (saved.who.startsWith('t:')) q.team_id = saved.who.slice(2);
    const box = $('#cal-body', view);
    box.classList.add('loading');
    try {
      data = await get('/api/calendario', q);
    } catch (e) {
      box.classList.remove('loading');
      return toastError(e);
    }
    box.classList.remove('loading');
    fillWho(data);
    draw(r);
  };

  const visible = () => data.events.filter((e) => !saved.hidden.includes(e.kind));
  const multi = () => !!saved.who && !saved.who.startsWith('u:');

  const draw = (r) => {
    const t = data.totals;
    render($('[data-legend]', view), html`${Object.entries(KINDS).map(([k, v]) => html`<button type="button" class="cal-chip ${v.cls} ${saved.hidden.includes(k) ? 'off' : ''}" data-kind="${k}" aria-pressed="${!saved.hidden.includes(k)}"><span class="dot"></span>${v.label}<small>${data.events.filter((e) => e.kind === k).length}</small></button>`)}`);
    render($('[data-kpis]', view), html`<span><strong>${t.r1}</strong> R1</span><span><strong>${t.r2}</strong> R2</span><span><strong>${t.one_on_one}</strong> one-on-one</span><span><strong>${t.pendentes}</strong> pendentes</span><span class="${t.atrasadas ? 'danger-text' : ''}"><strong>${t.atrasadas}</strong> atrasadas</span><span class="${t.no_show ? 'warn-text' : ''}"><strong>${t.no_show}</strong> no-show</span><span><strong>${t.atividades}</strong> atividades feitas</span><span class="muted">${data.scope}</span>`);
    const evs = visible();
    const byDay = {};
    for (const e of evs) (byDay[dKey(new Date(e.start))] ||= []).push(e);
    const today = dKey(new Date());
    const box = $('#cal-body', view);
    if (saved.view === 'mes') {
      const days = Array.from({ length: 42 }, (_, i) => addDays(r.from, i));
      render(box, html`<div class="cal-month"><div class="cal-wd">${WEEKDAYS.map((w) => html`<div>${w}</div>`)}</div>
        <div class="cal-grid">${days.map((d) => {
          const k = dKey(d);
          const list = byDay[k] || [];
          return html`<div class="cal-cell ${d.getMonth() !== r.month ? 'out' : ''} ${k === today ? 'today' : ''}">
            <button type="button" class="cal-daynum" data-goto="${k}" aria-label="Ver o dia ${d.toLocaleDateString('pt-BR')}">${d.getDate()}</button>
            ${list.slice(0, 4).map((e) => pill(e))}${list.length > 4 ? html`<button type="button" class="cal-more" data-goto="${k}">+${list.length - 4} mais</button>` : ''}
          </div>`;
        })}</div></div>`);
    } else if (saved.view === 'semana') {
      const days = Array.from({ length: 7 }, (_, i) => addDays(r.from, i));
      render(box, html`<div class="cal-week">${days.map((d, i) => {
        const k = dKey(d);
        const list = byDay[k] || [];
        return html`<section class="cal-col ${k === today ? 'today' : ''}"><header><button type="button" class="link-btn" data-goto="${k}"><small>${WEEKDAYS[i]}</small><strong>${d.getDate()}</strong></button><span class="count">${list.length}</span></header>
          <div class="cal-col-body">${list.length ? list.map((e) => pill(e)) : html`<p class="muted small">Livre</p>`}</div></section>`;
      })}</div>`);
    } else {
      // Dia e Período: lista detalhada por data
      const keys = Object.keys(byDay).sort();
      render(box, keys.length ? html`<div class="cal-agenda">${keys.map((k) => html`<section><h3 class="${k === today ? 'today' : ''}">${longDay(parseKey(k))}${k === today ? html` <span class="badge info">hoje</span>` : ''}</h3>
        <ul>${byDay[k].map((e) => html`<li class="${KINDS[e.kind].cls} st-${e.state} ${e.overdue ? 'overdue' : ''}"><button type="button" data-ev="${e.id}">
          <span class="t">${hm(e.start)}${e.end ? html`<small>${hm(e.end)}</small>` : ''}</span>
          <span class="b"><strong>${evTitle(e)}</strong><small>${KINDS[e.kind].label}${e.kind !== 'atividade' ? ` · ${STATE_LABEL[e.state] || e.state}` : ''}${e.overdue ? ' · atrasada' : ''}${multi() || e.user_id !== state.user.id ? ` · ${e.user_name || '—'}` : ''}${e.created_by_name ? ` · marcado por ${e.created_by_name}` : ''}</small>
            ${e.notes ? html`<small class="muted">${e.notes.length > 140 ? `${e.notes.slice(0, 140)}…` : e.notes}</small>` : ''}</span>
          ${e.state === 'no_show' ? html`<span class="badge ns">NS</span>` : e.confirmed ? html`<span class="badge ok">confirmada</span>` : ''}</button></li>`)}</ul></section>`)}</div>`
        : empty(saved.view === 'dia' ? 'Nada agendado nem registrado neste dia.' : 'Nada no período.'));
    }
  };

  const detail = (e) => modal({
    title: evTitle(e),
    body: html`<dl class="kv-list">
      <div><dt>Tipo</dt><dd>${KINDS[e.kind].label}${e.kind === 'tarefa' ? ` · ${K('task_types', e.type)}` : ''}</dd></div>
      <div><dt>Quando</dt><dd>${new Date(e.start).toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' })}${e.end ? ` às ${hm(e.end)}` : ''}</dd></div>
      <div><dt>Situação</dt><dd>${STATE_LABEL[e.state] || e.state}${e.overdue ? html` · <span class="danger-text">atrasada</span>` : ''}${e.confirmed ? ' · presença confirmada' : ''}</dd></div>
      <div><dt>${e.kind === 'atividade' ? 'Registrado por' : 'Responsável'}</dt><dd>${e.user_name || '—'}${e.created_by_name ? html`<br><small>marcado por ${e.created_by_name}</small>` : ''}</dd></div>
      ${e.contact_id ? html`<div><dt>Cliente</dt><dd><a href="#/leads/${e.contact_id}" data-close-modal>${e.contact_name}</a></dd></div>` : ''}
      ${e.result ? html`<div><dt>Resultado</dt><dd>${optLabel('resultado_ligacao', e.result)}</dd></div>` : ''}
      ${e.notes ? html`<div><dt>Observações</dt><dd class="pre">${e.notes}</dd></div>` : ''}
    </dl>
    ${e.meeting_url ? html`<p><a class="btn primary" href="${e.meeting_url}" target="_blank" rel="noopener">Entrar na reunião</a></p>` : ''}
    <p class="hint">O calendário é só para visualizar. ${e.kind === 'atividade' ? 'Atividades são registradas no painel do lead.' : html`Para concluir, remarcar ou editar, use <a href="#/agenda" data-close-modal>Agendas e tarefas</a>${e.contact_id ? ' ou o painel do lead' : ''}.`}</p>`,
    submitLabel: null,
    cancelLabel: 'Fechar',
    onMount(form, close) {
      on(form, 'click', '[data-close-modal]', () => close(null));
    },
  });

  on(view, 'click', '[data-cal]', (ev, b) => {
    if (b.dataset.cal === 'hoje') saved.date = null;
    else move(b.dataset.cal === 'next' ? 1 : -1);
    load();
  });
  on(view, 'click', '[data-view]', (ev, b) => {
    saved.view = b.dataset.view;
    load();
  });
  on(view, 'click', '[data-goto]', (ev, b) => {
    saved.date = b.dataset.goto;
    saved.view = 'dia';
    load();
  });
  on(view, 'click', '[data-kind]', (ev, b) => {
    const k = b.dataset.kind;
    saved.hidden = saved.hidden.includes(k) ? saved.hidden.filter((x) => x !== k) : [...saved.hidden, k];
    draw(range());
  });
  on(view, 'click', '[data-ev]', (ev, b) => {
    const e = data?.events.find((x) => x.id === b.dataset.ev);
    if (e) detail(e);
  });
  on(view, 'change', '[data-who]', (ev, sel) => {
    saved.who = sel.value;
    load();
  });
  on(view, 'change', '[data-period] input', () => {
    const f = $('[data-period]', view);
    saved.from = f.from.value;
    saved.to = f.to.value;
    if (saved.from && saved.to && saved.to < saved.from) return toastError(new Error('O fim do período precisa ser depois do início.'));
    return load();
  });
  if (!manager) saved.who = '';
  else if (saved.who === null) saved.who = 'todos';
  await load();
}
