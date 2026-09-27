import { get } from '../api.js';
import { html, render, $, on, state, selectOptions, userItems, toItems, can, toastError, periodRange } from '../ui.js';
import { taskForm } from '../forms.js';
import { tasksTable, bindTasks } from './contact.js';

let saved = { view: 'pendentes', assigned_to: '' };

export async function show(view) {
  if (!saved.assigned_to && state.user.role === 'consultor') saved.assigned_to = String(state.user.id);
  render(view, html`<div class="page">
    <div class="page-head"><h1>Agenda e tarefas</h1>${can.write() ? html`<div class="actions"><button class="btn primary" data-act="new">+ Nova tarefa</button><button class="btn" data-act="new-meeting">+ Agendar reunião</button></div>` : ''}</div>
    <p class="hint">Para vincular a tarefa a um lead, crie-a a partir do cadastro ou da oportunidade.</p>
    <form class="filters" data-f>
      <label>Visão<select name="view">${selectOptions([
        { value: 'pendentes', label: 'Pendentes (atrasadas primeiro)' },
        { value: 'atrasadas', label: 'Somente atrasadas' },
        { value: 'hoje', label: 'Hoje' },
        { value: 'semana', label: 'Próximos 7 dias' },
        { value: 'concluidas', label: 'Concluídas' },
        { value: 'canceladas', label: 'Canceladas' },
      ], saved.view, { allowEmpty: false })}</select></label>
      <label>Responsável<select name="assigned_to">${selectOptions(userItems(), saved.assigned_to, { placeholder: 'Todos' })}</select></label>
      <label>Tipo<select name="type">${selectOptions(toItems(state.meta.constants.task_types), saved.type, { placeholder: 'Todos' })}</select></label>
    </form>
    <div id="list"></div></div>`);
  const form = $('[data-f]', view);
  let rows = [];
  const load = async () => {
    const d = Object.fromEntries(new FormData(form).entries());
    saved = d;
    const q = { assigned_to: d.assigned_to, type: d.type };
    if (['pendentes', 'atrasadas', 'hoje', 'semana'].includes(d.view)) q.status = 'pendente';
    if (d.view === 'atrasadas') q.overdue = '1';
    if (d.view === 'hoje') Object.assign(q, periodRange('hoje'), { to: new Date(new Date().setHours(23, 59, 59, 999)).toISOString() });
    if (d.view === 'semana') Object.assign(q, { from: new Date().toISOString(), to: new Date(Date.now() + 7 * 86400000).toISOString() });
    if (d.view === 'concluidas') q.status = 'concluida';
    if (d.view === 'canceladas') q.status = 'cancelada';
    try {
      const r = await get('/api/tarefas', { ...q, limit: 300 });
      rows = r.rows;
      const late = rows.filter((t) => t.status === 'pendente' && new Date(t.due_at) < new Date()).length;
      render($('#list', view), html`${late ? html`<div class="alert danger">${late} tarefa(s) atrasada(s) nesta visão.</div>` : ''}<section class="card">${tasksTable(rows, { showContact: true })}</section>`);
    } catch (e) {
      toastError(e);
    }
  };
  form.addEventListener('change', load);
  bindTasks(view, () => rows, load);
  on(view, 'click', '[data-act=new]', async () => (await taskForm({})) && load());
  on(view, 'click', '[data-act=new-meeting]', async () => (await taskForm({ type: 'reuniao' })) && load());
  await load();
}
