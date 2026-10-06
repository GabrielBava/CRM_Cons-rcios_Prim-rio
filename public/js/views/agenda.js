// 4. Agenda e tarefas: visão completa das tarefas do especialista (R1, follow-ups de proposta, revisar proposta,
// pré-venda, ligações) em Hoje, Semana (calendário), Urgentes e Lista, com indicadores do dia.
import { get } from '../api.js';
import { html, render, $, $$, on, state, selectOptions, userItems, toItems, can, toastError, K, badge, fmtDateTime, relTime, subnav, empty } from '../ui.js';
import { taskForm } from '../forms.js';
import { tasksTable, bindTasks } from './contact.js';
import { scheduleR1Dialog, meetingLinks } from '../meeting.js';

// Filtros rápidos por tipo de tarefa
const GROUPS = {
  r1: ['R1 / reuniões', ['reuniao']],
  follow: ['Follow-up de proposta', ['follow_up_proposta', 'follow_up', 'enviar_proposta']],
  revisar: ['Revisar proposta', ['revisar_proposta']],
  prevenda: ['Pré-venda e documentos', ['pre_venda', 'documentacao', 'venda']],
  ligacoes: ['Ligações e retornos', ['primeiro_contato', 'ligar', 'retorno']],
  pos: ['Onboarding e pós-venda', ['onboarding', 'pos_venda', 'financeiro']],
};
let saved = { assigned_to: '', group: '' };

const dayKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const startOfWeek = (d = new Date()) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};
const hhmm = (v) => new Date(v).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const late = (t) => t.status === 'pendente' && new Date(t.due_at) < new Date();

export async function show(view, { params = {} } = {}) {
  const visao = ['semana', 'urgentes', 'lista'].includes(params.visao) ? params.visao : 'hoje';
  if (!saved.assigned_to && state.user.role === 'consultor') saved.assigned_to = String(state.user.id);
  let week = params.semana ? new Date(`${params.semana}T12:00:00`) : startOfWeek();
  render(view, html`<div class="page">
    <div class="page-head"><div><h1>Agenda e tarefas</h1><p class="muted">Tudo o que precisa ser feito, por ordem de urgência. Tarefas de proposta, pré-venda e onboarding são criadas automaticamente.</p></div>
      ${can.write() ? html`<div class="actions"><button class="btn primary" data-act="new">+ Nova tarefa</button><button class="btn r1" data-act="new-meeting">+ Agendar R1</button></div>` : ''}</div>
    <div id="kpis"></div>
    ${subnav([['#/agenda', 'Hoje', 'hoje'], ['#/agenda?visao=semana', 'Semana', 'semana'], ['#/agenda?visao=urgentes', 'Urgentes', 'urgentes'], ['#/agenda?visao=lista', 'Lista completa', 'lista']], visao)}
    <form class="filters" data-f ${!can.manage() && visao !== 'lista' ? 'hidden' : ''}>
      ${can.manage() ? html`<label>Responsável<select name="assigned_to">${selectOptions(userItems(), saved.assigned_to, { placeholder: 'Todos' })}</select></label>` : ''}
      ${visao === 'lista'
        ? html`<label>Situação<select name="status">${selectOptions([{ value: 'pendente', label: 'Pendentes' }, { value: 'concluida', label: 'Concluídas' }, { value: 'cancelada', label: 'Canceladas' }], saved.status || 'pendente', { allowEmpty: false })}</select></label>
          <label>Tipo<select name="type">${selectOptions(toItems(state.meta.constants.task_types), saved.type, { placeholder: 'Todos' })}</select></label>`
        : ''}
    </form>
    ${visao !== 'lista' ? html`<div class="chips">${[['', 'Todas'], ...Object.entries(GROUPS).map(([k, [l]]) => [k, l])].map(([k, l]) => html`<button type="button" class="chip ${saved.group === k ? 'active' : ''}" data-group="${k}">${l}</button>`)}</div>` : ''}
    <div id="list"></div></div>`);
  const form = $('[data-f]', view);
  let rows = [];

  const kpis = (pend) => {
    const now = new Date();
    const today = dayKey(now);
    const wk0 = startOfWeek();
    const wk1 = new Date(wk0.getTime() + 7 * 86400000);
    const n = (f) => pend.filter(f).length;
    render($('#kpis', view), html`<div class="kpis small">
      <div class="kpi ${n(late) ? 'alert-kpi' : ''}"><div class="kpi-label">Atrasadas</div><div class="kpi-value">${n(late)}</div></div>
      <div class="kpi"><div class="kpi-label">Para hoje</div><div class="kpi-value">${n((t) => dayKey(t.due_at) === today && !late(t))}</div></div>
      <div class="kpi ${n((t) => t.priority === 'urgente') ? 'alert-kpi' : ''}"><div class="kpi-label">Urgentes</div><div class="kpi-value">${n((t) => t.priority === 'urgente')}</div></div>
      <div class="kpi"><div class="kpi-label">R1 na semana</div><div class="kpi-value">${n((t) => t.type === 'reuniao' && new Date(t.due_at) >= wk0 && new Date(t.due_at) < wk1)}</div></div>
      <div class="kpi"><div class="kpi-label">Follow-ups de proposta hoje</div><div class="kpi-value">${n((t) => t.type === 'follow_up_proposta' && dayKey(t.due_at) <= today)}</div></div>
    </div>`);
  };

  const card = (t, { time = true } = {}) => html`<div class="agenda-item ${late(t) ? 'late' : ''} prio-${t.priority || 'normal'}">
    <div class="agenda-time">${time ? hhmm(t.due_at) : ''}</div>
    <div class="agenda-body">${t.priority === 'urgente' ? html`${badge('Urgente', 'danger')} ` : t.priority === 'alta' ? html`${badge('Alta', 'warn')} ` : ''}<strong>${t.title}</strong>
      <br><small>${K('task_types', t.type)}${t.contact_id ? html` · <a href="#/leads/${t.contact_id}">${t.contact_name}</a>` : ''}${can.manage() ? ` · ${t.assigned_name || '—'}` : ''}${late(t) ? html` · <span class="overdue">${relTime(t.due_at)}</span>` : ''}</small>
      ${t.notes ? html`<br><small class="muted">${t.notes.length > 160 ? `${t.notes.slice(0, 160)}…` : t.notes}</small>` : ''}${t.type === 'reuniao' ? html`<br>${meetingLinks(t)}` : ''}</div>
    ${t.status === 'pendente' && can.write() ? html`<div class="agenda-acts"><button class="btn small primary" data-task-act="done" data-id="${t.id}">Concluir</button><button class="btn small ghost" data-task-act="edit" data-id="${t.id}" title="Editar ou reagendar">✎</button></div>` : ''}
  </div>`;

  const load = async () => {
    const d = Object.fromEntries(new FormData(form).entries());
    saved = { ...saved, ...d };
    const types = saved.group ? GROUPS[saved.group][1].join(',') : undefined;
    try {
      if (visao === 'lista') {
        const r = await get('/api/tarefas', { assigned_to: saved.assigned_to, status: saved.status || 'pendente', type: saved.type, limit: 300 });
        rows = r.rows;
        const pend = await get('/api/tarefas', { assigned_to: saved.assigned_to, status: 'pendente', limit: 500 });
        kpis(pend.rows);
        render($('#list', view), html`<section class="card">${tasksTable(rows, { showContact: true })}</section>`);
        return;
      }
      const q = { assigned_to: saved.assigned_to, status: 'pendente', limit: 500 };
      const all = (await get('/api/tarefas', q)).rows;
      kpis(all);
      rows = types ? all.filter((t) => types.split(',').includes(t.type)) : all;
      if (visao === 'hoje') {
        const today = dayKey(new Date());
        const lateRows = rows.filter(late);
        const todays = rows.filter((t) => !late(t) && dayKey(t.due_at) === today);
        const tomorrow = rows.filter((t) => dayKey(t.due_at) === dayKey(Date.now() + 86400000));
        const am = todays.filter((t) => new Date(t.due_at).getHours() < 12);
        const pm = todays.filter((t) => new Date(t.due_at).getHours() >= 12);
        render($('#list', view), html`<div class="cols">
          <div>
            ${lateRows.length ? html`<section class="card danger-card"><h3>Atrasadas (${lateRows.length})</h3>${lateRows.map((t) => card(t, { time: false }))}</section>` : ''}
            <section class="card"><h3>Manhã</h3>${am.length ? am.map((t) => card(t)) : empty('Nada agendado para a manhã.')}</section>
            <section class="card"><h3>Tarde</h3>${pm.length ? pm.map((t) => card(t)) : empty('Nada agendado para a tarde.')}</section>
          </div>
          <div>
            <section class="card"><h3>Amanhã (${tomorrow.length})</h3>${tomorrow.length ? tomorrow.map((t) => card(t)) : empty('Nada agendado.')}</section>
            <section class="card"><h3>Rotina sugerida do especialista</h3><ol class="tips">
              <li><strong>8h–9h:</strong> atrasadas e urgentes (pré-venda sem acesso, propostas sem resposta).</li>
              <li><strong>9h–12h:</strong> bloco de ligações: primeiro contato dos leads novos em até 5 minutos e follow-ups D+1…D+10.</li>
              <li><strong>Manhã:</strong> envie as propostas cedo; o follow-up D0 acontece no fim do mesmo dia.</li>
              <li><strong>14h–17h:</strong> R1 (reuniões de diagnóstico) e apresentações de proposta.</li>
              <li><strong>17h–18h:</strong> follow-up D0 das propostas enviadas pela manhã e planejamento do dia seguinte.</li>
            </ol></section>
          </div></div>`);
      } else if (visao === 'urgentes') {
        const urg = rows.filter((t) => t.priority === 'urgente' || t.priority === 'alta' || late(t));
        render($('#list', view), html`<section class="card"><h3>Urgentes, prioridade alta e atrasadas (${urg.length})</h3>${urg.length ? urg.map((t) => card(t)) : empty('Nenhuma pendência urgente. 👏')}</section>`);
      } else {
        const days = [...Array(7)].map((_, i) => new Date(week.getTime() + i * 86400000));
        const wkEnd = new Date(week.getTime() + 7 * 86400000);
        const before = rows.filter((t) => new Date(t.due_at) < week);
        render($('#list', view), html`<div class="week-nav"><button class="btn small" data-week="-1">◀ Semana anterior</button><strong>${days[0].toLocaleDateString('pt-BR')} a ${days[6].toLocaleDateString('pt-BR')}</strong><button class="btn small" data-week="1">Próxima semana ▶</button><button class="btn small ghost" data-week="0">Hoje</button></div>
          ${before.length ? html`<div class="alert warn">${before.length} tarefa(s) pendente(s) de antes desta semana (veja em Hoje ou Urgentes).</div>` : ''}
          <div class="week-grid">${days.map((d) => {
            const list = rows.filter((t) => dayKey(t.due_at) === dayKey(d));
            return html`<div class="week-day ${dayKey(d) === dayKey(new Date()) ? 'today' : ''} ${[0, 6].includes(d.getDay()) ? 'weekend' : ''}"><div class="week-head">${d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })} <small>${list.length || ''}</small></div>
              ${list.map((t) => html`<a href="#" class="week-task ${late(t) ? 'late' : ''} prio-${t.priority || 'normal'} type-${t.type}" data-task-act="edit" data-id="${t.id}" title="${t.title} — ${t.contact_name || ''}">${hhmm(t.due_at)} ${t.title}</a>`)}</div>`;
          })}</div>
          ${rows.filter((t) => new Date(t.due_at) >= wkEnd).length ? html`<p class="hint">${rows.filter((t) => new Date(t.due_at) >= wkEnd).length} tarefa(s) nas semanas seguintes.</p>` : ''}`);
      }
    } catch (e) {
      toastError(e);
    }
  };
  form.addEventListener('change', load);
  on(view, 'click', '[data-group]', (e, b) => {
    saved.group = b.dataset.group;
    $$('[data-group]', view).forEach((x) => x.classList.toggle('active', x === b));
    load();
  });
  on(view, 'click', '[data-week]', (e, b) => {
    const n = Number(b.dataset.week);
    week = n === 0 ? startOfWeek() : new Date(week.getTime() + n * 7 * 86400000);
    load();
  });
  on(view, 'click', 'a[data-task-act]', (e) => e.preventDefault());
  bindTasks(view, () => rows, load);
  on(view, 'click', '[data-act=new]', async () => (await taskForm({})) && load());
  on(view, 'click', '[data-act=new-meeting]', async () => (await scheduleR1Dialog({})) && load());
  await load();
}
