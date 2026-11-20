// Comunicação: Inbox (chat interno entre colaboradores), Tickets (chamados internos com responsável, prazo e anexos)
// e WhatsApp da empresa (conversas com clientes pela API oficial do WhatsApp Business).
import { get, post, patch, download } from '../api.js';
import { html, raw, render, $, $$, on, state, modal, field, toast, toastError, avatar, badge, empty, fmtDateTime, fmtDate, relTime, optLabel, opts, hasModule, subnav, selectOptions, can } from '../ui.js';
import { icon } from '../icons.js';
import { fileToBase64 } from './record-tabs.js';
import { quickCreateContact } from '../forms.js';
import { openLeadDrawer } from '../drawer.js';

const TABS = [['inbox', 'Inbox', 'inbox'], ['tickets', 'Tickets', 'tickets'], ['whatsapp', 'WhatsApp', 'whatsapp']];
const tabs = (active) => subnav(TABS.filter(([, , m]) => hasModule(m)).map(([k, l]) => [`#/comunicacao/${k}`, l, k]), active);
const size = (b) => (b >= 1048576 ? `${(b / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round((b || 0) / 1024))} KB`);
const hm = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayLabel = (iso) => {
  const d = new Date(iso);
  const t = new Date();
  const y = new Date(Date.now() - 86400000);
  if (d.toDateString() === t.toDateString()) return 'Hoje';
  if (d.toDateString() === y.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
};
const shortWhen = (iso) => (iso ? (new Date(iso).toDateString() === new Date().toDateString() ? hm(iso) : new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })) : '');
const counts = () => window.dispatchEvent(new Event('crm:comm-counts'));
let people = null;
const loadPeople = async () => (people ||= await get('/api/inbox/pessoas'));
async function readFiles(input) {
  const out = [];
  for (const f of input?.files || []) {
    if (f.size > 15 * 1024 * 1024) throw new Error(`"${f.name}" passa de 15 MB.`);
    out.push({ filename: f.name, content_base64: await fileToBase64(f) });
  }
  return out;
}
const dlFile = (url) => download(url).catch(toastError);

export async function show(view, { id, sub, params = {} }) {
  const tab = id || 'inbox';
  const mod = TABS.find(([k]) => k === tab)?.[2];
  if (!mod) return render(view, html`<div class="page"><h1>Página não encontrada</h1></div>`);
  if (!hasModule(mod)) {
    const first = TABS.find(([, , m]) => hasModule(m));
    return render(view, html`<div class="page">${first ? tabs(tab) : ''}<h1>Acesso não liberado</h1><p class="muted">Seu usuário não tem acesso a esta área. Fale com o administrador.</p></div>`);
  }
  if (tab === 'tickets') return sub ? ticketDetail(view, sub) : ticketList(view, params);
  if (tab === 'whatsapp') return whatsapp(view, sub, params);
  return inbox(view, sub);
}

/* =========================== Inbox (chat interno) =========================== */

async function inbox(view, openId) {
  render(view, html`<div class="page wide comm-page">${tabs('inbox')}
    <div class="chat-shell" data-shell>
      <aside class="chat-list"><div class="chat-list-head"><input type="search" placeholder="Buscar conversa" data-q aria-label="Buscar conversa">
        <button type="button" class="btn small primary" data-act="new-direct" title="Nova conversa">${icon('adicionar', 14)}Conversa</button><button type="button" class="btn small" data-act="new-group" title="Novo grupo">Grupo</button></div>
        <div class="chat-items" data-items><p class="muted small pad">Carregando…</p></div></aside>
      <section class="chat-main" data-main><div class="chat-empty">${icon('chat', 40)}<p>Escolha uma conversa ou comece uma nova.</p><small class="muted">Chat interno da equipe: demandas rápidas, combinados e anotações. Para pedidos com prazo e entrega, abra um <a href="#/comunicacao/tickets">ticket</a>.</small></div></section>
    </div></div>`);
  let list = [];
  let current = null;
  let lastId = 0;
  let timer = null;
  let listTimer = null;

  const drawList = () => {
    const q = ($('[data-q]', view).value || '').toLowerCase();
    const rows = list.filter((c) => !q || c.title.toLowerCase().includes(q));
    render($('[data-items]', view), rows.length ? html`${rows.map((c) => html`<button type="button" class="chat-item ${current?.id === c.id ? 'active' : ''} ${c.unread ? 'unread' : ''}" data-conv="${c.id}">
      ${c.kind === 'grupo' ? html`<span class="avatar initials group" aria-hidden="true">${icon('colaboradores', 18)}</span>` : avatar({ name: c.title, photo: c.photo }, 40)}
      <span class="ci-body"><span class="ci-top"><strong>${c.title}</strong><small>${shortWhen(c.last?.at || c.last_message_at)}</small></span>
        <span class="ci-last">${c.last ? html`${c.kind === 'grupo' || c.last.user_name === 'Você' ? html`<b>${c.last.user_name}:</b> ` : ''}${c.last.body}` : html`<i class="muted">Sem mensagens</i>`}</span></span>
      ${c.unread ? html`<span class="ci-badge">${c.unread}</span>` : ''}</button>`)}` : empty(list.length ? 'Nenhuma conversa com esse nome.' : 'Nenhuma conversa ainda. Clique em "Conversa" para falar com alguém da equipe.'));
  };
  const loadList = async () => {
    try {
      list = await get('/api/inbox/conversas');
    } catch (e) {
      return toastError(e);
    }
    drawList();
    return list;
  };

  const msgHtml = (m, prev) => {
    const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
    const sep = newDay ? html`<div class="chat-day"><span>${dayLabel(m.created_at)}</span></div>` : '';
    if (m.system) return html`${sep}<div class="chat-sys">${m.body}</div>`;
    const showName = current?.kind === 'grupo' && !m.mine && (!prev || prev.user_id !== m.user_id || newDay || prev.system);
    return html`${sep}<div class="bubble-row ${m.mine ? 'mine' : ''}" data-mid="${m.id}"><div class="bubble">
      ${showName ? html`<b class="b-name">${m.user_name}</b>` : ''}
      ${m.body ? html`<p>${m.body}</p>` : ''}
      ${m.filename ? html`<button type="button" class="file-chip" data-chatfile="${m.id}">${icon('anexo', 14)}<span>${m.filename}</span><small>${size(m.size)}</small></button>` : ''}
      <small class="b-time">${hm(m.created_at)}</small></div></div>`;
  };

  const openConv = async (cid, { silent = false } = {}) => {
    clearInterval(timer);
    let d;
    try {
      d = await get(`/api/inbox/conversas/${cid}/mensagens`);
    } catch (e) {
      return toastError(e);
    }
    current = list.find((c) => c.id === Number(cid)) || (await loadList()).find((c) => c.id === Number(cid));
    if (!current) return undefined;
    if (!silent) history.replaceState(null, '', `#/comunicacao/inbox/${cid}`);
    $('[data-shell]', view).classList.add('has-conv');
    const msgs = d.rows;
    lastId = msgs.length ? msgs[msgs.length - 1].id : 0;
    const isGroup = current.kind === 'grupo';
    render($('[data-main]', view), html`<header class="chat-head"><button type="button" class="btn small ghost chat-back" data-act="back" aria-label="Voltar">‹</button>
        ${isGroup ? html`<span class="avatar initials group" aria-hidden="true">${icon('colaboradores', 18)}</span>` : avatar({ name: current.title, photo: current.photo }, 40)}
        <div class="grow"><strong>${current.title}</strong><small class="muted">${isGroup ? current.members.map((u) => u.name).join(', ') : current.subtitle || 'Conversa direta'}</small></div>
        ${isGroup ? html`<button type="button" class="btn small ghost" data-act="group">Participantes</button>` : ''}</header>
      <div class="chat-msgs" data-msgs>${msgs.length ? msgs.map((m, i) => msgHtml(m, msgs[i - 1])) : html`<p class="muted small center">Comece a conversa.</p>`}</div>
      <form class="chat-compose" data-compose><label class="btn small ghost attach" title="Anexar arquivo">${icon('anexo', 16)}<input type="file" name="file" hidden></label>
        <div class="grow"><small class="attach-name" data-attach hidden></small><textarea name="body" rows="1" placeholder="Escreva uma mensagem (Enter envia, Shift+Enter quebra a linha)" aria-label="Mensagem"></textarea></div>
        <button type="submit" class="btn primary" aria-label="Enviar">${icon('enviar', 16)}</button></form>`);
    const box = $('[data-msgs]', view);
    box.scrollTop = box.scrollHeight;
    current.unread = 0;
    drawList();
    counts();
    $('[data-compose] textarea', view).focus();
    timer = setInterval(poll, 4000);
    return undefined;
  };

  const poll = async () => {
    if (!current || !view.isConnected) return;
    let d;
    try {
      d = await get(`/api/inbox/conversas/${current.id}/mensagens`, { after_id: lastId });
    } catch {
      return;
    }
    if (!d.rows.length) return;
    const box = $('[data-msgs]', view);
    if (!box) return;
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    const prevEl = box.querySelector('[data-mid]:last-of-type');
    let prev = prevEl ? { created_at: new Date().toISOString(), user_id: null } : null;
    for (const m of d.rows) {
      if (box.querySelector(`[data-mid="${m.id}"]`)) continue;
      box.insertAdjacentHTML('beforeend', String(msgHtml(m, prev)));
      prev = m;
    }
    lastId = d.rows[d.rows.length - 1].id;
    if (near) box.scrollTop = box.scrollHeight;
  };

  const send = async (form) => {
    if (!current) return;
    const body = form.body.value.trim();
    let files = [];
    try {
      files = await readFiles(form.file);
    } catch (e) {
      return toastError(e);
    }
    if (!body && !files.length) return undefined;
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const m = await post(`/api/inbox/conversas/${current.id}/mensagens`, { body, file: files[0] });
      form.body.value = '';
      form.file.value = '';
      $('[data-attach]', view).hidden = true;
      const box = $('[data-msgs]', view);
      box.querySelector('.center')?.remove();
      const last = box.querySelector('[data-mid]:last-of-type');
      box.insertAdjacentHTML('beforeend', String(msgHtml({ ...m, mine: true }, last ? { created_at: new Date().toISOString(), user_id: m.user_id } : null)));
      lastId = Math.max(lastId, m.id);
      box.scrollTop = box.scrollHeight;
      loadList();
    } catch (e) {
      toastError(e);
    } finally {
      btn.disabled = false;
      form.body.focus();
    }
    return undefined;
  };

  on(view, 'click', '[data-conv]', (e, b) => openConv(b.dataset.conv));
  on(view, 'input', '[data-q]', drawList);
  on(view, 'submit', '[data-compose]', (e, f) => (e.preventDefault(), send(f)));
  on(view, 'keydown', '[data-compose] textarea', (e, t) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(t.form);
    }
  });
  on(view, 'change', '[data-compose] input[type=file]', (e, inp) => {
    const n = $('[data-attach]', view);
    n.hidden = !inp.files.length;
    n.textContent = inp.files.length ? `📎 ${inp.files[0].name}` : '';
  });
  on(view, 'click', '[data-chatfile]', (e, b) => dlFile(`/api/inbox/arquivos/${b.dataset.chatfile}`));
  on(view, 'click', '[data-act=back]', () => {
    $('[data-shell]', view).classList.remove('has-conv');
    clearInterval(timer);
    current = null;
    history.replaceState(null, '', '#/comunicacao/inbox');
    drawList();
  });
  on(view, 'click', '[data-act=new-direct]', async () => {
    const ps = await loadPeople().catch(toastError);
    if (!ps) return;
    const r = await modal({
      title: 'Nova conversa',
      body: html`<div class="field full"><label>Buscar colaborador</label><input type="search" name="q" placeholder="Nome, cargo ou time" autocomplete="off"></div><div class="pick-list" data-pick-list>${ps.map((u) => html`<button type="button" class="pick-item" data-pick="${u.id}" data-search="${`${u.name} ${u.job_title || ''} ${u.team_name || ''}`.toLowerCase()}">${avatar(u, 28)} <span><strong>${u.name}</strong><small>${u.job_title || ''}${u.team_name ? ` · ${u.team_name}` : ''}</small></span></button>`)}</div>`,
      onMount(form, close) {
        form.q.addEventListener('input', () => $$('[data-pick]', form).forEach((b) => (b.hidden = !b.dataset.search.includes(form.q.value.toLowerCase()))));
        on(form, 'click', '[data-pick]', async (ev, b) => {
          try {
            close(await post('/api/inbox/conversas', { user_id: Number(b.dataset.pick) }));
          } catch (err) {
            toastError(err);
          }
        });
        form.q.focus();
      },
    });
    if (r) {
      await loadList();
      openConv(r.id);
    }
  });
  on(view, 'click', '[data-act=new-group]', async () => {
    const ps = await loadPeople().catch(toastError);
    if (!ps) return;
    const r = await modal({
      title: 'Novo grupo',
      body: html`${field({ name: 'title', label: 'Nome do grupo', required: true, full: true, placeholder: 'Ex.: Time Centro, Marketing + Comercial' })}
        <fieldset class="check-list"><legend>Participantes</legend>${ps.map((u) => html`<label class="check"><input type="checkbox" name="m" value="${u.id}"> ${u.name}${u.job_title ? html` <small class="muted">· ${u.job_title}</small>` : ''}</label>`)}</fieldset>`,
      submitLabel: 'Criar grupo',
      onSubmit: (d, form) => post('/api/inbox/conversas', { title: d.title, member_ids: $$('input[name=m]:checked', form).map((c) => Number(c.value)) }),
    });
    if (r) {
      await loadList();
      openConv(r.id);
    }
  });
  on(view, 'click', '[data-act=group]', async () => {
    if (!current) return;
    const ps = await loadPeople().catch(() => []);
    const owner = current.created_by === state.user.id || state.user.role === 'admin';
    const memberIds = new Set(current.members.map((u) => u.id));
    const r = await modal({
      title: `Participantes — ${current.title}`,
      body: html`<ul class="mini-list">${current.members.map((u) => html`<li>${avatar(u, 24)} ${u.name}${owner && u.id !== state.user.id ? html` <label class="check inline"><input type="checkbox" name="rm" value="${u.id}"> retirar</label>` : ''}</li>`)}</ul>
        ${owner ? html`${field({ name: 'title', label: 'Nome do grupo', value: current.title, full: true })}
          <fieldset class="check-list"><legend>Incluir</legend>${ps.filter((u) => !memberIds.has(u.id)).map((u) => html`<label class="check"><input type="checkbox" name="add" value="${u.id}"> ${u.name}</label>`)}</fieldset>` : ''}
        <label class="check"><input type="checkbox" name="leave"> Sair do grupo</label>`,
      submitLabel: 'Salvar',
      onSubmit: (d, form) => patch(`/api/inbox/conversas/${current.id}`, d.leave ? { leave: true } : { title: d.title, add_ids: $$('input[name=add]:checked', form).map((c) => Number(c.value)), remove_ids: $$('input[name=rm]:checked', form).map((c) => Number(c.value)) }),
    });
    if (!r) return;
    await loadList();
    if (list.some((c) => c.id === current.id)) openConv(current.id);
    else $('[data-act=back]', view)?.click();
  });

  await loadList();
  if (openId) await openConv(openId, { silent: true });
  listTimer = setInterval(() => view.isConnected && loadList(), 15000);
  return () => {
    clearInterval(timer);
    clearInterval(listTimer);
  };
}

/* =========================== Tickets =========================== */

const T_STATUS = { aberto: ['Aberto', 'info'], em_andamento: ['Em andamento', 'warn'], devolvido: ['Devolvido', 'rm'], concluido: ['Concluído', 'ok'], cancelado: ['Cancelado', 'muted'] };
const T_PRIO = { baixa: ['Baixa', 'muted'], normal: ['Normal', ''], alta: ['Alta', 'warn'], urgente: ['Urgente', 'danger'] };
const tStatus = (s) => badge(T_STATUS[s]?.[0] || s, T_STATUS[s]?.[1] || '');
const tPrio = (p) => badge(T_PRIO[p]?.[0] || p, T_PRIO[p]?.[1] || '');
let tSaved = { caixa: 'recebidos', status: 'abertos', categoria: '', q: '' };

async function newTicket() {
  const ps = await loadPeople().catch(toastError);
  if (!ps) return null;
  return modal({
    title: 'Novo ticket',
    wide: true,
    body: html`<p class="hint">Use o ticket para pedir uma entrega com prazo a outra pessoa ou área (ex.: arte para campanha, ajuste de contrato, acesso a sistema). O responsável recebe o aviso, atua e devolve ou conclui.</p>
      <div class="grid">
      ${field({ name: 'title', label: 'Título', required: true, full: true, placeholder: 'Ex.: Arte para a campanha de imóvel sem juros' })}
      ${field({ name: 'assignee_id', label: 'Responsável', type: 'select', options: [{ value: state.user.id, label: `${state.user.name} (eu)` }, ...ps.map((u) => ({ value: u.id, label: `${u.name}${u.job_title ? ` · ${u.job_title}` : ''}` }))], required: true })}
      ${field({ name: 'category', label: 'Categoria', type: 'select', options: opts('categoria_ticket'), value: 'outro', allowEmpty: false })}
      ${field({ name: 'priority', label: 'Prioridade', type: 'select', options: Object.entries(T_PRIO).map(([value, [label]]) => ({ value, label })), value: 'normal', allowEmpty: false })}
      ${field({ name: 'due_date', label: 'Prazo', type: 'date' })}
      ${field({ name: 'description', label: 'Descrição', type: 'textarea', rows: 5, required: true, full: true, placeholder: 'O que precisa ser feito, para quando, formato, referências…' })}
      <div class="field full"><label>Anexos (opcional)</label><input type="file" name="files" multiple><small>Até 10 arquivos de 15 MB: PDF, imagens, Office, ZIP, vídeo.</small></div></div>`,
    submitLabel: 'Abrir ticket',
    async onSubmit(d, form) {
      const files = await readFiles(form.files);
      const r = await post('/api/tickets', { ...d, files });
      toast(`Ticket ${r.code} aberto.`);
      return r;
    },
  });
}

async function ticketList(view, params) {
  if (params.caixa) tSaved.caixa = params.caixa;
  const manager = ['admin', 'gestor'].includes(state.user.role);
  const boxes = [['recebidos', 'Para mim'], ['enviados', 'Abertos por mim'], ...(manager ? [['todos', state.user.role === 'admin' ? 'Todos' : 'Do meu time']] : [])];
  render(view, html`<div class="page wide comm-page">${tabs('tickets')}
    <div class="page-head"><div><h1>Tickets</h1><p class="muted">Chamados internos: quem pede, quem faz, o prazo e a entrega, tudo registrado.</p></div>
      <div class="actions"><button class="btn primary" data-act="new">+ Novo ticket</button></div></div>
    <div class="ticket-bar"><div class="seg small" role="group">${boxes.map(([k, l]) => html`<button type="button" class="btn small ${tSaved.caixa === k ? 'active' : ''}" data-box="${k}">${l}</button>`)}</div>
      <form class="filters inline" data-f><label>Situação<select name="status">${selectOptions([{ value: 'abertos', label: 'Em aberto' }, { value: 'concluido', label: 'Concluídos' }, { value: 'cancelado', label: 'Cancelados' }, { value: '', label: 'Todos' }], tSaved.status, { allowEmpty: false })}</select></label>
        <label>Categoria<select name="categoria">${selectOptions(opts('categoria_ticket'), tSaved.categoria, { placeholder: 'Todas' })}</select></label>
        <label class="grow">Buscar<input type="search" name="q" value="${tSaved.q}" placeholder="Título, código ou descrição"></label></form></div>
    <div id="tk"></div></div>`);
  const load = async () => {
    const f = $('[data-f]', view);
    tSaved = { ...tSaved, status: f.status.value, categoria: f.categoria.value, q: f.q.value };
    const box = $('#tk', view);
    let rows;
    try {
      rows = await get('/api/tickets', { caixa: tSaved.caixa, status: tSaved.status, categoria: tSaved.categoria, q: tSaved.q });
    } catch (e) {
      return toastError(e);
    }
    render(box, rows.length ? html`<div class="ticket-list">${rows.map((t) => html`<a class="ticket-card st-${t.status} ${t.overdue ? 'overdue' : ''}" href="#/comunicacao/tickets/${t.id}">
      <div class="tc-top"><small class="muted">${t.code} · ${optLabel('categoria_ticket', t.category)}</small><span>${tPrio(t.priority)} ${tStatus(t.status)}</span></div>
      <strong>${t.title}</strong>
      <div class="tc-people">${avatar({ name: t.requester_name, photo: t.requester_photo }, 22)}<small>${t.requester_name}</small><span aria-hidden="true">→</span>${avatar({ name: t.assignee_name, photo: t.assignee_photo }, 22)}<small>${t.assignee_name}</small></div>
      <div class="tc-foot"><small class="${t.overdue ? 'danger-text' : 'muted'}">${t.due_date ? `Prazo ${fmtDate(t.due_date)}${t.overdue ? ' · atrasado' : ''}` : 'Sem prazo'}</small><small class="muted">${t.files ? `📎 ${t.files} · ` : ''}${t.comments ? `💬 ${t.comments} · ` : ''}atualizado ${relTime(t.updated_at)}</small></div>
    </a>`)}</div>` : empty(tSaved.caixa === 'recebidos' ? 'Nenhum ticket para você nesta situação.' : 'Nenhum ticket nesta situação.'));
    counts();
    return undefined;
  };
  let t;
  on(view, 'input', '[data-f] input', () => {
    clearTimeout(t);
    t = setTimeout(load, 300);
  });
  on(view, 'change', '[data-f] select', load);
  on(view, 'submit', '[data-f]', (e) => e.preventDefault());
  on(view, 'click', '[data-box]', (e, b) => {
    tSaved.caixa = b.dataset.box;
    $$('[data-box]', view).forEach((x) => x.classList.toggle('active', x === b));
    load();
  });
  on(view, 'click', '[data-act=new]', async () => {
    const r = await newTicket();
    if (r) location.hash = `#/comunicacao/tickets/${r.id}`;
  });
  await load();
}

const EV_ICON = { criado: '🆕', comentario: '💬', iniciado: '▶️', devolvido: '↩️', respondido: '↪️', concluido: '✅', reaberto: '🔄', cancelado: '⛔', transferido: '🔀' };

async function ticketDetail(view, id) {
  const draw = async () => {
    let t;
    try {
      t = await get(`/api/tickets/${id}`);
    } catch (e) {
      return render(view, html`<div class="page">${tabs('tickets')}<div class="alert danger">${e.message}</div><p><a href="#/comunicacao/tickets">← Voltar aos tickets</a></p></div>`);
    }
    const c = t.can;
    const files = (list) => (list.length ? html`<div class="file-row">${list.map((f) => html`<button type="button" class="file-chip" data-tfile="${f.id}">${icon('anexo', 14)}<span>${f.filename}</span><small>${size(f.size)}</small></button>`)}</div>` : '');
    render(view, html`<div class="page comm-page">${tabs('tickets')}
      <div class="crumbs"><a href="#/comunicacao/tickets">Tickets</a> / ${t.code}</div>
      <div class="ticket-head card">
        <div class="th-top"><div><small class="muted">${t.code} · ${optLabel('categoria_ticket', t.category)}</small><h1>${t.title}</h1></div><span>${tPrio(t.priority)} ${tStatus(t.status)}</span></div>
        <dl class="th-meta">
          <div><dt>Solicitante</dt><dd>${avatar({ name: t.requester_name, photo: t.requester_photo }, 24)} ${t.requester_name}</dd></div>
          <div><dt>Responsável</dt><dd>${avatar({ name: t.assignee_name, photo: t.assignee_photo }, 24)} ${t.assignee_name}</dd></div>
          <div><dt>Prazo</dt><dd class="${t.overdue ? 'danger-text' : ''}">${t.due_date ? fmtDate(t.due_date) : '—'}${t.overdue ? ' · atrasado' : ''}</dd></div>
          <div><dt>Aberto em</dt><dd>${fmtDateTime(t.created_at)}</dd></div>
          ${t.completed_at ? html`<div><dt>Concluído em</dt><dd>${fmtDateTime(t.completed_at)}</dd></div>` : ''}
          ${t.contact_id ? html`<div><dt>Cliente</dt><dd><a href="#/leads/${t.contact_id}">${t.contact_name}</a></dd></div>` : ''}
        </dl>
        <div class="th-desc"><h4>Descrição</h4><p class="pre">${t.description}</p>${files(t.events[0]?.files || [])}</div>
        ${t.status === 'devolvido' && c.responder ? html`<div class="alert warn small">O responsável devolveu o ticket para você. Responda com o que falta para ele continuar.</div>` : ''}
        <div class="th-actions">
          ${c.iniciar ? html`<button class="btn" data-ta="iniciar">Começar a atuar</button>` : ''}
          ${c.concluir ? html`<button class="btn success" data-ta="concluir">Concluir</button>` : ''}
          ${c.devolver ? html`<button class="btn warn" data-ta="devolver">Devolver ao solicitante</button>` : ''}
          ${c.responder ? html`<button class="btn primary" data-ta="responder">Responder e reenviar</button>` : ''}
          ${c.reabrir ? html`<button class="btn" data-ta="reabrir">Reabrir</button>` : ''}
          ${c.transferir ? html`<button class="btn ghost" data-ta="transferir">Transferir</button>` : ''}
          ${c.cancelar ? html`<button class="btn ghost danger" data-ta="cancelar">Cancelar ticket</button>` : ''}
        </div>
      </div>
      <section class="card"><h3>Andamento</h3>
        <ol class="ticket-timeline">${t.events.map((e) => html`<li class="ev-${e.kind}"><span class="ev-ico" aria-hidden="true">${EV_ICON[e.kind] || '•'}</span>
          <div><div class="ev-head">${avatar({ name: e.user_name, photo: e.user_photo }, 22)} <strong>${e.user_name || 'Sistema'}</strong> ${e.label} <small class="muted">${fmtDateTime(e.created_at)}</small></div>
          ${e.body ? html`<p class="pre">${e.body}</p>` : ''}${e.kind !== 'criado' ? files(e.files) : ''}</div></li>`)}</ol>
        ${c.comentar ? html`<form class="ticket-comment" data-comment><textarea name="body" rows="3" placeholder="Escreva um comentário (fica no histórico e avisa a outra pessoa)"></textarea>
          <div class="inline-actions"><label class="btn small ghost">${icon('anexo', 14)} Anexar<input type="file" name="files" multiple hidden></label><small class="attach-name" data-attach></small><span class="grow"></span><button type="submit" class="btn small primary">Comentar</button></div></form>` : ''}
      </section></div>`);
    return t;
  };
  let t = await draw();
  const act = async (action) => {
    if (!t) return;
    const needs = { devolver: 'O que falta ou precisa ser ajustado', responder: 'Sua resposta', reabrir: 'Por que reabrir', cancelar: 'Motivo do cancelamento', concluir: 'Entrega / observação (opcional)', iniciar: 'Observação (opcional)', transferir: 'Observação (opcional)' };
    const ps = action === 'transferir' ? await loadPeople().catch(() => []) : [];
    const r = await modal({
      title: { iniciar: 'Começar a atuar', concluir: 'Concluir ticket', devolver: 'Devolver ao solicitante', responder: 'Responder e reenviar', reabrir: 'Reabrir ticket', cancelar: 'Cancelar ticket', transferir: 'Transferir ticket' }[action],
      body: html`${action === 'transferir' ? field({ name: 'assignee_id', label: 'Novo responsável', type: 'select', options: ps.filter((u) => u.id !== t.assignee_id).map((u) => ({ value: u.id, label: u.name })), required: true, full: true }) : ''}
        ${field({ name: 'body', label: needs[action], type: 'textarea', rows: 4, full: true, required: ['devolver', 'responder', 'reabrir', 'cancelar'].includes(action) })}
        ${['concluir', 'devolver', 'responder', 'reabrir'].includes(action) ? html`<div class="field full"><label>Anexos${action === 'concluir' ? ' (a entrega)' : ''}</label><input type="file" name="files" multiple></div>` : ''}`,
      submitLabel: 'Confirmar',
      danger: action === 'cancelar',
      async onSubmit(d, form) {
        return post(`/api/tickets/${id}/acao`, { action, body: d.body, assignee_id: d.assignee_id, files: await readFiles(form.files) });
      },
    });
    if (r) {
      toast('Ticket atualizado.');
      t = await draw();
      counts();
    }
  };
  on(view, 'click', '[data-ta]', (e, b) => act(b.dataset.ta));
  on(view, 'click', '[data-tfile]', (e, b) => dlFile(`/api/tickets/arquivos/${b.dataset.tfile}`));
  on(view, 'change', '[data-comment] input[type=file]', (e, inp) => ($('[data-attach]', view).textContent = [...inp.files].map((f) => f.name).join(', ')));
  on(view, 'submit', '[data-comment]', async (e, f) => {
    e.preventDefault();
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await post(`/api/tickets/${id}/acao`, { action: 'comentar', body: f.body.value, files: await readFiles(f.files) });
      t = await draw();
    } catch (ex) {
      toastError(ex);
      btn.disabled = false;
    }
  });
  counts();
}

/* =========================== WhatsApp da empresa =========================== */

const WA_TICK = { pendente: '🕓', simulada: '✓ teste', enviada: '✓', entregue: '✓✓', lida: '✓✓', falhou: '⚠', recebida: '' };
let waSaved = { filtro: '', q: '' };

async function whatsapp(view, openId, params) {
  let status = null;
  try {
    status = await get('/api/whatsapp/status');
  } catch (e) {
    return render(view, html`<div class="page">${tabs('whatsapp')}<div class="alert danger">${e.message}</div></div>`);
  }
  const notReady = !status.configured && !status.sandbox;
  render(view, html`<div class="page wide comm-page">${tabs('whatsapp')}
    ${notReady ? html`<div class="alert warn"><strong>WhatsApp da empresa ainda não conectado.</strong> As conversas recebidas aparecem aqui quando a conta oficial (WhatsApp Business) estiver ligada ao CRM. ${state.user.role === 'admin' ? html`<a href="#/configuracoes/integracoes">Conectar agora</a> (Configurações › Integrações).` : 'Peça ao administrador para conectar em Configurações › Integrações.'}</div>`
      : status.sandbox ? html`<div class="alert info small"><strong>Modo de teste:</strong> as mensagens ficam só no CRM (não saem pelo WhatsApp) até a conta oficial ser conectada.</div>` : ''}
    <div class="chat-shell wa" data-shell>
      <aside class="chat-list"><div class="chat-list-head"><input type="search" placeholder="Nome ou telefone" data-q value="${waSaved.q}" aria-label="Buscar conversa">
        <button type="button" class="btn small primary" data-act="wa-new">${icon('adicionar', 14)}Conversa</button></div>
        <div class="chip-filter">${[['', 'Todas'], ['minhas', 'Minhas'], ['nao_lidas', 'Não lidas'], ['sem_cadastro', 'Sem cadastro'], ...(can.manage() ? [['sem_responsavel', 'Sem responsável']] : [])].map(([k, l]) => html`<button type="button" class="chip ${waSaved.filtro === k ? 'active' : ''}" data-wf="${k}">${l}</button>`)}</div>
        <div class="chat-items" data-items><p class="muted small pad">Carregando…</p></div></aside>
      <section class="chat-main" data-main><div class="chat-empty">${icon('whatsapp', 40)}<p>Conversas com clientes pelo WhatsApp da empresa${status.display_number ? html` <strong>${status.display_number}</strong>` : ''}.</p>
        <small class="muted">As mensagens entram no histórico do lead. Texto livre só até 24 horas depois da última mensagem do cliente; depois disso, a conversa recomeça com o modelo aprovado.</small></div></section>
    </div></div>`);
  let list = [];
  let conv = null;
  let lastId = 0;
  let timer = null;
  let listTimer = null;

  const drawList = () => render($('[data-items]', view), list.length ? html`${list.map((c) => html`<button type="button" class="chat-item ${conv?.id === c.id ? 'active' : ''} ${c.unread ? 'unread' : ''}" data-wc="${c.id}">
      ${avatar({ name: c.name }, 40)}
      <span class="ci-body"><span class="ci-top"><strong>${c.name}</strong><small>${shortWhen(c.last_message_at)}</small></span>
        <span class="ci-last">${c.last_direction === 'out' ? html`<b>Você:</b> ` : ''}${c.last_body || html`<i class="muted">Sem mensagens</i>`}</span>
        <span class="ci-meta"><small>${c.phone}</small>${!c.contact_id ? html`<span class="badge warn">sem cadastro</span>` : ''}${c.window_open ? html`<span class="badge ok" title="Pode responder com texto livre">24h aberta</span>` : ''}${can.manage() && c.assigned_name ? html`<small class="muted">${c.assigned_name}</small>` : ''}</span></span>
      ${c.unread ? html`<span class="ci-badge">${c.unread}</span>` : ''}</button>`)}` : empty('Nenhuma conversa neste filtro.'));
  const loadList = async () => {
    try {
      list = await get('/api/whatsapp/conversas', { filtro: waSaved.filtro, q: waSaved.q });
    } catch (e) {
      return toastError(e);
    }
    drawList();
    return list;
  };

  const msgHtml = (m, prev) => {
    const sep = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString() ? html`<div class="chat-day"><span>${dayLabel(m.created_at)}</span></div>` : '';
    const mine = m.direction === 'out';
    return html`${sep}<div class="bubble-row ${mine ? 'mine' : ''}" data-mid="${m.id}"><div class="bubble ${m.kind === 'template' ? 'tpl' : ''} ${m.status === 'falhou' ? 'failed' : ''}">
      ${mine && m.user_name ? html`<b class="b-name">${m.user_name}</b>` : ''}
      ${m.kind === 'template' ? html`<small class="muted">Modelo aprovado</small>` : ''}
      <p>${m.body}</p>
      ${m.media_id ? html`<button type="button" class="file-chip" data-wamedia="${m.id}">${icon('anexo', 14)}<span>${m.filename || `Arquivo (${m.kind})`}</span></button>` : ''}
      ${m.error ? html`<small class="danger-text">${m.error}</small>` : ''}
      <small class="b-time">${hm(m.created_at)} ${mine ? html`<span class="tick ${m.status}" data-st="${m.id}" title="${m.status}">${WA_TICK[m.status] || ''}</span>` : ''}</small></div></div>`;
  };

  const header = (c, cfg) => html`<header class="chat-head"><button type="button" class="btn small ghost chat-back" data-act="back" aria-label="Voltar">‹</button>
      ${avatar({ name: c.name }, 40)}
      <div class="grow"><strong>${c.name}</strong><small class="muted">${c.phone}${c.profile_name && c.contact_name && c.profile_name !== c.contact_name ? ` · no WhatsApp: ${c.profile_name}` : ''}${c.assigned_name ? ` · responsável: ${c.assigned_name}` : ''}</small></div>
      <div class="inline-actions">
        ${c.contact_id ? html`<button type="button" class="btn small" data-act="lead">Abrir lead</button>` : html`<button type="button" class="btn small primary" data-act="link">Vincular cadastro</button><button type="button" class="btn small" data-act="create">Criar lead</button>`}
        ${can.manage() ? html`<button type="button" class="btn small ghost" data-act="assign">Responsável</button>` : ''}
        <button type="button" class="btn small ghost" data-act="close">${c.status === 'encerrada' ? 'Reabrir' : 'Encerrar'}</button>
      </div></header>
    <div class="wa-window ${c.window_open ? 'open' : 'closed'}">${c.window_open
      ? html`Janela de atendimento aberta até <strong>${new Date(c.window_ends_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</strong>: responda com texto livre.`
      : html`Fora da janela de 24 horas: para falar com o cliente, envie o modelo aprovado${cfg.template?.name ? html` (<code>${cfg.template.name}</code>)` : ''}. Quando ele responder, a conversa reabre.`}</div>`;

  const openConv = async (id, { silent = false } = {}) => {
    clearInterval(timer);
    let d;
    try {
      d = await get(`/api/whatsapp/conversas/${id}`);
    } catch (e) {
      return toastError(e);
    }
    conv = d.conversation;
    if (!silent) history.replaceState(null, '', `#/comunicacao/whatsapp/${id}`);
    $('[data-shell]', view).classList.add('has-conv');
    const msgs = d.messages;
    lastId = msgs.length ? msgs[msgs.length - 1].id : 0;
    render($('[data-main]', view), html`${header(conv, d.config)}
      <div class="chat-msgs wa-msgs" data-msgs>${msgs.length ? msgs.map((m, i) => msgHtml(m, msgs[i - 1])) : html`<p class="muted small center">Nenhuma mensagem ainda.</p>`}</div>
      <form class="chat-compose" data-compose>
        <button type="button" class="btn small" data-act="template" title="Enviar o modelo aprovado (inicia ou retoma a conversa)">Modelo</button>
        <div class="grow"><textarea name="body" rows="1" ${conv.window_open ? '' : raw('disabled')} placeholder="${conv.window_open ? 'Mensagem para o cliente (Enter envia)' : 'Fora da janela de 24 horas: use "Modelo"'}" aria-label="Mensagem"></textarea></div>
        <button type="submit" class="btn primary" ${conv.window_open ? '' : raw('disabled')} aria-label="Enviar">${icon('enviar', 16)}</button></form>`);
    const box = $('[data-msgs]', view);
    box.scrollTop = box.scrollHeight;
    const row = list.find((x) => x.id === conv.id);
    if (row) row.unread = 0;
    drawList();
    counts();
    timer = setInterval(poll, 5000);
    return d;
  };
  const poll = async () => {
    if (!conv || !view.isConnected) return;
    let d;
    try {
      d = await get(`/api/whatsapp/conversas/${conv.id}`, { after_id: lastId });
    } catch {
      return;
    }
    const box = $('[data-msgs]', view);
    if (!box) return;
    for (const s of d.statuses) {
      const el = box.querySelector(`[data-st="${s.id}"]`);
      if (el && !el.classList.contains(s.status)) {
        el.className = `tick ${s.status}`;
        el.textContent = WA_TICK[s.status] || '';
      }
    }
    if (d.conversation.window_open !== conv.window_open) return openConv(conv.id, { silent: true });
    if (!d.messages.length) return;
    for (const m of d.messages) if (!box.querySelector(`[data-mid="${m.id}"]`)) box.insertAdjacentHTML('beforeend', String(msgHtml(m, { created_at: new Date().toISOString() })));
    lastId = d.messages[d.messages.length - 1].id;
    box.scrollTop = box.scrollHeight;
    loadList();
  };
  const send = async (payload) => {
    try {
      const m = await post(`/api/whatsapp/conversas/${conv.id}/mensagens`, payload);
      const box = $('[data-msgs]', view);
      box.querySelector('.center')?.remove();
      box.insertAdjacentHTML('beforeend', String(msgHtml(m, { created_at: new Date().toISOString() })));
      lastId = Math.max(lastId, m.id);
      box.scrollTop = box.scrollHeight;
      loadList();
      return m;
    } catch (e) {
      toastError(e);
      if (conv) openConv(conv.id, { silent: true });
      return null;
    }
  };
  const pickContact = (title) => modal({
    title,
    body: html`<div class="field full"><label>Buscar cadastro</label><input type="search" name="q" placeholder="Nome, código, telefone ou e-mail" autocomplete="off"></div><div class="pick-list" data-pl></div>`,
    onMount(form, close) {
      let t;
      form.q.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          const q = form.q.value.trim();
          if (q.length < 2) return (form.querySelector('[data-pl]').innerHTML = '');
          const r = await get('/api/cadastros', { q, limit: 8 }).catch(() => ({ rows: [] }));
          form.querySelector('[data-pl]').innerHTML = String(r.rows.length ? html`${r.rows.map((c) => html`<button type="button" class="pick-item" data-pick="${c.id}"><strong>${c.name}</strong><small>${c.code}${c.whatsapp || c.phone1 ? ` · ${c.whatsapp || c.phone1}` : ''}</small></button>`)}` : html`<p class="muted small">Nenhum cadastro encontrado.</p>`);
          return undefined;
        }, 250);
      });
      on(form, 'click', '[data-pick]', (e, b) => close(Number(b.dataset.pick)));
      form.q.focus();
    },
  });

  on(view, 'click', '[data-wc]', (e, b) => openConv(b.dataset.wc));
  on(view, 'click', '[data-wf]', (e, b) => {
    waSaved.filtro = b.dataset.wf;
    $$('[data-wf]', view).forEach((x) => x.classList.toggle('active', x === b));
    loadList();
  });
  let qt;
  on(view, 'input', '[data-q]', (e, inp) => {
    clearTimeout(qt);
    qt = setTimeout(() => {
      waSaved.q = inp.value;
      loadList();
    }, 300);
  });
  on(view, 'submit', '[data-compose]', async (e, f) => {
    e.preventDefault();
    const body = f.body.value.trim();
    if (!body) return;
    f.body.value = '';
    await send({ body });
    f.body.focus();
  });
  on(view, 'keydown', '[data-compose] textarea', (e, t) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      t.form.requestSubmit();
    }
  });
  on(view, 'click', '[data-act=template]', async () => {
    const st = status.template || {};
    const r = await modal({
      title: 'Enviar modelo aprovado',
      body: html`<p class="hint">Fora das 24 horas, a Meta só permite iniciar a conversa com um modelo (template) aprovado no Gerenciador do WhatsApp. Se o modelo tiver variáveis ({{1}}, {{2}}…), preencha na ordem.</p><div class="grid">
        ${field({ name: 'template', label: 'Nome do modelo', value: st.name || '', required: true, placeholder: 'ex.: retomar_contato' })}
        ${field({ name: 'language', label: 'Idioma', value: st.language || 'pt_BR' })}
        ${field({ name: 'p1', label: 'Variável {{1}} (opcional)', value: conv?.contact_name?.split(' ')[0] || '' })}
        ${field({ name: 'p2', label: 'Variável {{2}} (opcional)' })}</div>`,
      submitLabel: 'Enviar modelo',
      onSubmit: (d) => send({ template: d.template, language: d.language, params: [d.p1, d.p2].filter(Boolean) }),
    });
    if (r) toast('Modelo enviado.');
  });
  on(view, 'click', '[data-act=lead]', () => conv?.contact_id && openLeadDrawer(conv.contact_id, { onChange: () => openConv(conv.id, { silent: true }) }));
  on(view, 'click', '[data-act=link]', async () => {
    const cid = await pickContact('Vincular a conversa a um cadastro');
    if (!cid) return;
    try {
      await patch(`/api/whatsapp/conversas/${conv.id}`, { contact_id: cid });
      toast('Conversa vinculada ao cadastro.');
      await loadList();
      openConv(conv.id, { silent: true });
    } catch (e) {
      toastError(e);
    }
  });
  on(view, 'click', '[data-act=create]', async () => {
    const r = await quickCreateContact({ name: conv.profile_name || '', phone1: conv.phone.replace(/^\+55\s?/, ''), origin: 'whatsapp', stay: true });
    if (!r?.id) return;
    await patch(`/api/whatsapp/conversas/${conv.id}`, { contact_id: r.id }).catch(toastError);
    await loadList();
    openConv(conv.id, { silent: true });
  });
  on(view, 'click', '[data-act=assign]', async () => {
    const r = await modal({
      title: 'Responsável pela conversa',
      body: field({ name: 'assigned_to', label: 'Responsável', type: 'select', options: (state.meta.users || []).filter((u) => u.active !== 0).map((u) => ({ value: u.id, label: u.name })), value: conv.assigned_to, full: true }),
      submitLabel: 'Salvar',
      onSubmit: (d) => patch(`/api/whatsapp/conversas/${conv.id}`, { assigned_to: d.assigned_to || null }),
    });
    if (r) {
      await loadList();
      openConv(conv.id, { silent: true });
    }
  });
  on(view, 'click', '[data-act=close]', async () => {
    await patch(`/api/whatsapp/conversas/${conv.id}`, { status: conv.status === 'encerrada' ? 'aberta' : 'encerrada' }).catch(toastError);
    await loadList();
    openConv(conv.id, { silent: true });
  });
  on(view, 'click', '[data-act=back]', () => {
    $('[data-shell]', view).classList.remove('has-conv');
    clearInterval(timer);
    conv = null;
    history.replaceState(null, '', '#/comunicacao/whatsapp');
    drawList();
  });
  on(view, 'click', '[data-act=wa-new]', async () => {
    const cid = await pickContact('Conversar com um cliente');
    if (!cid) return;
    try {
      const r = await post('/api/whatsapp/conversas', { contact_id: cid });
      await loadList();
      openConv(r.id);
    } catch (e) {
      toastError(e);
    }
  });
  on(view, 'click', '[data-wamedia]', (e, b) => dlFile(`/api/whatsapp/midia/${b.dataset.wamedia}`));

  await loadList();
  // Vindo do painel do lead (?contato=ID): abre ou cria a conversa com o cliente
  if (params.contato) {
    try {
      const r = await post('/api/whatsapp/conversas', { contact_id: Number(params.contato) });
      await loadList();
      await openConv(r.id);
      // Resposta sugerida pela IA Vero (?texto=): fica pronta no campo de mensagem para revisar e enviar
      const box = $('[data-compose] [name=body]', view);
      if (params.texto && box) {
        box.value = params.texto;
        box.focus();
      }
    } catch (e) {
      toastError(e);
    }
  } else if (openId) await openConv(openId, { silent: true });
  listTimer = setInterval(() => view.isConnected && loadList(), 20000);
  return () => {
    clearInterval(timer);
    clearInterval(listTimer);
  };
}
