// 4. Agendas e tarefas: a Central do especialista (tudo o que precisa ser feito numa fila só, atrasadas primeiro, com a
// ação que conclui cada item: WhatsApp pronto, ligação, confirmação, resultado da reunião), a Semana (calendário) e a
// Lista completa.
import { get, post } from '../api.js';
import { html, render, $, $$, on, state, selectOptions, userItems, toItems, can, toast, toastError, K, badge, fmtDateTime, relTime, subnav, empty, modal, confirmDialog, fmtPhone } from '../ui.js';
import { taskForm, completeTaskWithActivity, activityForm } from '../forms.js';
import { tasksTable, bindTasks } from './contact.js';
import { scheduleR1Dialog, meetingLinks, rescheduleDialog } from '../meeting.js';
import { bindDrawerLinks } from '../drawer.js';
import { icon } from '../icons.js';

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
  const visao = ['semana', 'lista'].includes(params.visao) ? params.visao : 'central';
  if (visao === 'central') return showCentral(view);
  if (!saved.assigned_to && state.user.role === 'consultor') saved.assigned_to = String(state.user.id);
  let week = params.semana ? new Date(`${params.semana}T12:00:00`) : startOfWeek();
  render(view, html`<div class="page">
    ${pageHead()}
    <div id="kpis"></div>
    ${tabs(visao)}
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
      {
        const days = [...Array(7)].map((_, i) => new Date(week.getTime() + i * 86400000));
        const wkEnd = new Date(week.getTime() + 7 * 86400000);
        const before = rows.filter((t) => new Date(t.due_at) < week);
        render($('#list', view), html`<div class="week-nav"><button class="btn small" data-week="-1">◀ Semana anterior</button><strong>${days[0].toLocaleDateString('pt-BR')} a ${days[6].toLocaleDateString('pt-BR')}</strong><button class="btn small" data-week="1">Próxima semana ▶</button><button class="btn small ghost" data-week="0">Hoje</button></div>
          ${before.length ? html`<div class="alert warn">${before.length} tarefa(s) pendente(s) de antes desta semana (veja na Central).</div>` : ''}
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

/* ------------------------- Central do especialista ------------------------- */

const pageHead = () => html`<div class="page-head"><div><h1>Agendas e tarefas</h1><p class="muted">Tudo o que você precisa fazer, numa fila só: atrasadas primeiro (da mais estourada para a menos) e depois as próximas. Cada item já traz a ação que o conclui.</p></div>
  ${can.write() ? html`<div class="actions"><button class="btn primary" data-act="new">+ Nova tarefa</button><button class="btn r1" data-act="new-meeting">+ Agendar R1</button></div>` : ''}</div>`;
const tabs = (visao) => subnav([['#/agenda', 'Central', 'central'], ['#/agenda?visao=semana', 'Semana', 'semana'], ['#/agenda?visao=lista', 'Lista completa', 'lista']], visao);

const CAT_ICON = { whatsapp: 'whatsapp', confirmacao: 'confirmar', resultado: 'bandeira', follow_reuniao: 'historico', follow_proposta: 'propostas', ligacao: 'telefone', reuniao: 'calendario', tarefa: 'lista' };
let centralSaved = { assigned_to: '', cat: '' };

/** "Atrasada há 2 d 4 h" / "em 35 min" / "hoje 14:30". */
function whenLabel(i) {
  const diff = Date.now() - Date.parse(i.due_at);
  const abs = Math.abs(diff);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  const m = Math.max(1, Math.floor((abs % 3600000) / 60000));
  const dur = d ? `${d} d${h ? ` ${h} h` : ''}` : h ? `${h} h${m && h < 3 ? ` ${m} min` : ''}` : `${m} min`;
  return diff > 0 ? `Atrasada há ${dur}` : abs < 12 * 3600000 ? `em ${dur}` : new Date(i.due_at).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

function itemActions(i) {
  const btn = (act, label, ic, cls = '') => html`<button type="button" class="btn small ${cls}" data-wq="${act}" data-key="${i.key}">${ic ? icon(ic, 14) : ''} ${label}</button>`;
  const wa = i.wa_text && i.contact_id ? btn('wa', i.category === 'confirmacao' ? 'Pedir confirmação' : i.category === 'follow_proposta' ? 'WhatsApp com a proposta' : i.no_show ? 'WhatsApp para remarcar' : 'WhatsApp', 'whatsapp', 'primary') : '';
  const call = i.phone ? btn('call', 'Ligar', 'telefone') : '';
  switch (i.category) {
    case 'whatsapp': return html`${btn('reply', 'Responder', 'whatsapp', 'primary')}${btn('open-wa', 'Abrir conversa', 'chat', 'ghost')}`;
    case 'confirmacao': return html`${i.waiting ? '' : wa}${call}${btn('confirmed', 'Cliente confirmou', 'confirmar', i.waiting ? 'primary' : '')}`;
    case 'resultado': return html`${btn('done-meeting', 'Realizada', 'confirmar', 'primary')}${btn('no-show', 'Não compareceu', 'parar')}${btn('reschedule', 'Remarcar', 'calendario', 'ghost')}`;
    case 'reuniao': return html`${i.meeting?.url ? html`<a class="btn small primary" href="${i.meeting.url}" target="_blank" rel="noopener">${icon('externo', 14)} Entrar na reunião</a>` : ''}${wa}`;
    case 'follow_reuniao': return html`${wa}${call}${i.no_show ? btn('reschedule', 'Remarcar', 'calendario', 'ghost') : ''}`;
    case 'follow_proposta':
    case 'ligacao': return html`${i.category === 'ligacao' ? html`${call ? btn('call', 'Ligar', 'telefone', 'primary') : ''}${wa}` : html`${wa}${call}`}${btn('done', 'Registrar', 'confirmar', 'ghost')}`;
    default: return html`${btn('done', 'Concluir', 'confirmar', 'primary')}${wa}`;
  }
}

function itemCard(i, { team }) {
  return html`<article class="wq-item cat-${i.category} ${i.overdue ? 'late' : ''} ${i.waiting ? 'waiting' : ''}" data-item="${i.key}">
    <div class="wq-when"><span>${whenLabel(i)}</span><small>${fmtDateTime(i.due_at)}</small></div>
    <div class="wq-main">
      <div class="wq-top"><span class="wq-cat">${icon(CAT_ICON[i.category] || 'lista', 13)} ${i.category_label}</span>${i.priority === 'urgente' ? badge('Urgente', 'danger') : i.priority === 'alta' && i.category !== 'whatsapp' ? badge('Alta', 'warn') : ''}${i.unread ? html`<span class="badge ok">${i.unread} não lida(s)</span>` : ''}</div>
      <strong class="wq-title">${i.title}</strong>
      <small class="wq-sub">${i.contact_id ? html`<a href="#/leads/${i.contact_id}" data-drawer="${i.contact_id}" ${i.opportunity_id ? `data-opp="${i.opportunity_id}"` : ''}>${i.contact_name}</a>` : i.contact_name || ''}${i.stage_name ? ` · ${i.stage_name}` : ''}${i.phone ? ` · ${fmtPhone(i.phone)}` : ''}${i.channel_label ? ` · ${i.channel_label}` : ''}${team && i.assigned_name ? ` · ${i.assigned_name}` : ''}</small>
      ${i.detail ? html`<small class="wq-detail">${i.detail}</small>` : ''}
      <form class="wq-reply" data-reply="${i.key}" hidden><textarea name="body" rows="2" placeholder="Escreva a resposta…" required></textarea><div class="wq-reply-acts"><button type="submit" class="btn small primary">${icon('enviar', 14)} Enviar</button><button type="button" class="btn small ghost" data-wq="reply-cancel" data-key="${i.key}">Cancelar</button></div></form>
    </div>
    <div class="wq-acts">${itemActions(i)}</div>
  </article>`;
}

async function showCentral(view) {
  if (!centralSaved.assigned_to) centralSaved.assigned_to = '';
  const lead = can.manage();
  render(view, html`<div class="page">${pageHead()}<div id="wq-kpis"></div>${tabs('central')}
    <div class="wq-bar">${lead ? html`<label>Fila de<select data-wq-owner><option value="">Mim</option>${userItems().filter((u) => Number(u.value) !== state.user.id).map((u) => html`<option value="${u.value}" ${String(centralSaved.assigned_to) === String(u.value) ? 'selected' : ''}>${u.label}</option>`)}<option value="todos" ${centralSaved.assigned_to === 'todos' ? 'selected' : ''}>Toda a equipe</option></select></label>` : ''}
      <div class="chips" data-wq-cats></div></div>
    <section class="card wq-card"><header class="wq-head"><h3>Fila de trabalho</h3><small class="muted" data-wq-count></small></header><div class="wq-board" data-wq-board></div></section></div>`);
  let d = null;
  const byKey = (k) => d?.items.find((x) => x.key === k);
  const draw = () => {
    const k = d.kpis;
    render($('#wq-kpis', view), html`<div class="kpis small">
      <div class="kpi ${k.atrasadas ? 'alert-kpi' : ''}"><div class="kpi-label">Atrasadas</div><div class="kpi-value">${k.atrasadas}</div></div>
      <div class="kpi"><div class="kpi-label">Para hoje</div><div class="kpi-value">${k.hoje}</div></div>
      <div class="kpi ${k.whatsapp ? 'alert-kpi' : ''}"><div class="kpi-label">WhatsApp sem resposta</div><div class="kpi-value">${k.whatsapp}</div></div>
      <div class="kpi"><div class="kpi-label">Reuniões a confirmar</div><div class="kpi-value">${k.confirmar}</div></div>
      <div class="kpi"><div class="kpi-label">Na fila (7 dias)</div><div class="kpi-value">${k.total}</div></div></div>`);
    render($('[data-wq-cats]', view), html`${[{ key: '', label: 'Todas', count: d.items.length }, ...d.categories.filter((c) => c.count)].map((c) => html`<button type="button" class="chip ${centralSaved.cat === c.key ? 'active' : ''}" data-wq-cat="${c.key}">${c.label} <b>${c.count}</b></button>`)}`);
    const list = centralSaved.cat ? d.items.filter((i) => i.category === centralSaved.cat) : d.items;
    $('[data-wq-count]', view).textContent = `${list.length} item(ns) · ${list.filter((i) => i.overdue).length} atrasado(s)`;
    render($('[data-wq-board]', view), list.length ? html`${list.map((i) => itemCard(i, { team: d.owners === 'todos' }))}` : empty('Nada pendente por aqui. 👏'));
  };
  const load = async () => {
    try {
      d = await get('/api/central', { assigned_to: centralSaved.assigned_to || undefined });
      draw();
    } catch (e) {
      toastError(e);
    }
  };
  const contactOf = (id) => get(`/api/cadastros/${id}`);

  // WhatsApp pronto: o especialista revisa e envia pelo WhatsApp do CRM (ou pelo celular, se o CRM não tiver número)
  const sendWa = async (i) => {
    const r = await modal({
      title: `WhatsApp para ${i.contact_name}`,
      wide: true,
      submitLabel: 'Enviar',
      body: html`<p class="hint">${i.phone ? `Para ${fmtPhone(i.phone)}. ` : ''}Revise a mensagem antes de enviar. Ela vai pelo WhatsApp do CRM e fica no histórico do lead${i.task_id && !['reuniao', 'resultado', 'confirmacao'].includes(i.category) ? '; a tarefa é concluída' : ''}.</p>
        <div class="field full"><textarea name="body" rows="7" required>${i.wa_text}</textarea></div>`,
      async onSubmit(f) {
        return post('/api/central/whatsapp', { contact_id: i.contact_id, body: f.body, task_id: i.category === 'confirmacao' || i.category === 'reuniao' ? undefined : i.task_id, confirm_meeting_id: i.category === 'confirmacao' ? i.meeting.id : undefined });
      },
    });
    if (!r) return;
    if (r.sent) {
      toast(i.category === 'confirmacao' ? 'Pedido de confirmação enviado. Quando o cliente responder, clique em "Cliente confirmou".' : 'Mensagem enviada.');
      return load();
    }
    // Sem número no CRM: abre o WhatsApp do aparelho com a mensagem pronta e registra depois
    window.open(r.fallback_url, '_blank', 'noopener');
    if (await confirmDialog('Mensagem enviada?', 'O CRM ainda não tem um número do WhatsApp conectado para você, então a mensagem abriu no WhatsApp do seu aparelho. Depois de enviar, registre aqui para concluir o item e guardar no histórico do lead.', { confirmLabel: 'Registrar como enviada' })) {
      await post('/api/central/feito', { contact_id: i.contact_id, notes: i.wa_text, task_id: i.category === 'confirmacao' || i.category === 'reuniao' ? undefined : i.task_id, confirm_meeting_id: i.category === 'confirmacao' ? i.meeting.id : undefined });
      toast('Registrado.');
      load();
    }
  };

  // Ligar: abre o telefone (celular, softphone ou discadora) e o registro da ligação (resultado e próxima ação)
  const call = async (i) => {
    const to = String(i.phone || '').replace(/\D/g, '');
    if (to) window.location.href = `tel:+${to.length <= 11 ? `55${to}` : to}`;
    const c = await contactOf(i.contact_id);
    const ok = i.task && i.task_id ? await completeTaskWithActivity({ ...i.task, title: `Ligar · ${i.task.title}` }, c) : await activityForm(c, { opportunity_id: i.opportunity_id, type: 'ligacao_realizada' });
    if (ok) load();
  };

  on(view, 'change', '[data-wq-owner]', (e, el) => {
    centralSaved.assigned_to = el.value;
    load();
  });
  on(view, 'click', '[data-wq-cat]', (e, b) => {
    centralSaved.cat = b.dataset.wqCat;
    draw();
  });
  on(view, 'click', '[data-wq]', async (e, b) => {
    const i = byKey(b.dataset.key);
    if (!i) return;
    const act = b.dataset.wq;
    try {
      if (act === 'wa') return sendWa(i);
      if (act === 'call') return call(i);
      if (act === 'reply' || act === 'reply-cancel') {
        const f = $(`[data-reply="${i.key}"]`, view);
        f.hidden = act === 'reply-cancel';
        if (!f.hidden) f.body.focus();
        return undefined;
      }
      if (act === 'open-wa') {
        location.hash = `#/comunicacao/whatsapp/${i.conversation_id}`;
        return undefined;
      }
      if (act === 'confirmed') {
        await post(`/api/reunioes/${i.meeting.id}/confirmar`, {});
        toast('Reunião confirmada.');
        return load();
      }
      if (act === 'done-meeting' || act === 'no-show') {
        const r = await post(`/api/reunioes/${i.meeting.id}/resultado`, { result: act === 'done-meeting' ? 'realizada' : 'nao_compareceu' });
        toast(r.hint || (act === 'done-meeting' ? 'Reunião registrada como realizada.' : 'Registrado: o cliente não compareceu. O follow-up para remarcar entrou na fila.'));
        return load();
      }
      if (act === 'reschedule') {
        if (await rescheduleDialog(i.meeting.id, i.meeting.kind)) load();
        return undefined;
      }
      if (act === 'done') {
        const c = i.contact_id ? await contactOf(i.contact_id) : null;
        const t = (await get('/api/tarefas', { contact_id: i.contact_id || undefined, status: 'pendente', limit: 200 })).rows.find((x) => x.id === i.task_id) || i.task;
        const ok = c ? await completeTaskWithActivity(t, c) : await taskForm({ task: t });
        if (ok) load();
      }
    } catch (ex) {
      toastError(ex);
    }
    return undefined;
  });
  on(view, 'submit', '[data-reply]', async (e, f) => {
    e.preventDefault();
    const i = byKey(f.dataset.reply);
    const body = f.body.value.trim();
    if (!i || !body) return;
    const b = f.querySelector('[type=submit]');
    b.disabled = true;
    try {
      await post(`/api/whatsapp/conversas/${i.conversation_id}/mensagens`, { body });
      toast('Resposta enviada.');
      load();
    } catch (ex) {
      toastError(ex);
      b.disabled = false;
    }
  });
  on(view, 'click', '[data-act=new]', async () => (await taskForm({})) && load());
  on(view, 'click', '[data-act=new-meeting]', async () => (await scheduleR1Dialog({})) && load());
  bindDrawerLinks(view, () => ({ onChange: load }));
  await load();
  return undefined;
}
