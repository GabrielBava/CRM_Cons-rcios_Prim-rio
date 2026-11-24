// Comunicação: Inbox (chat interno entre colaboradores), Tickets (chamados internos com responsável, prazo e anexos)
// e WhatsApp (conversas com clientes pelo número oficial e pelo WhatsApp Lite, na tela views/whatsapp.js).
import { get, post, patch, download } from '../api.js';
import { html, render, $, $$, on, state, modal, field, toast, toastError, avatar, badge, empty, fmtDateTime, fmtDate, relTime, optLabel, opts, hasModule, subnav, selectOptions, can } from '../ui.js';
import { icon } from '../icons.js';
import { fileToBase64 } from './record-tabs.js';
import { whatsapp as waView } from './whatsapp.js';

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
  if (tab === 'whatsapp') return waView(view, sub, params, tabs('whatsapp'));
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

/* =========================== WhatsApp (oficial e Lite) =========================== */
// A tela fica em views/whatsapp.js.

