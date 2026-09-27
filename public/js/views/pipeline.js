import { get, post, download } from '../api.js';
import {
  html, render, $, $$, on, state, selectOptions, opts, toItems, userItems, productItems, stageItems, fmtMoney, fmtDateTime, fmtDate, relTime,
  badge, optoutBadge, optLabel, K, can, toast, toastError, table, empty, fresh,
} from '../ui.js';
import { moveStage, opportunityForm, activityForm, taskForm, simulatorButton, openSimulator, simulationForm, proposalForm, proposalDetail } from '../forms.js';
import { timeline, tasksTable, bindTasks } from './contact.js';

let saved = {};

export async function show(view, { key, id, params }) {
  if (key === 'oportunidades' && id) return showOpp(view, id);
  const s = { ...saved, ...params };
  render(view, html`<div class="page wide">
    <div class="page-head"><h1>Funil comercial</h1>
      <div class="actions">
        <div class="seg small"><button class="btn small ${s.mode !== 'lista' ? 'active' : ''}" data-mode="kanban">Kanban</button><button class="btn small ${s.mode === 'lista' ? 'active' : ''}" data-mode="lista">Lista</button></div>
        ${state.user.role !== 'leitura' ? html`<button class="btn" data-act="export">Exportar CSV</button>` : ''}
      </div></div>
    <form class="filters" data-f>
      <label class="grow">Buscar<input type="search" name="q" value="${s.q || ''}" placeholder="Nome, código do cadastro ou da oportunidade"></label>
      <label>Responsável<select name="owner_id">${selectOptions(userItems(), s.owner_id, { placeholder: 'Todos' })}</select></label>
      <label>Origem<select name="origin">${selectOptions(opts('origem'), s.origin, { placeholder: 'Todas' })}</select></label>
      <label>Produto<select name="product_id">${selectOptions(productItems(), s.product_id, { placeholder: 'Todos' })}</select></label>
      <label>Etapa<select name="stage_id">${selectOptions(stageItems(), s.stage_id, { placeholder: 'Todas' })}</select></label>
      <label>Prioridade<select name="priority">${selectOptions(toItems(state.meta.constants.priorities), s.priority, { placeholder: 'Todas' })}</select></label>
      <label>Próxima ação<select name="next_action">${selectOptions([{ value: 'atrasada', label: 'Atrasada' }, { value: 'hoje', label: 'Para hoje' }, { value: 'sem', label: 'Sem próxima ação' }], s.next_action, { placeholder: 'Qualquer' })}</select></label>
      <label>Fechadas nos últimos<select name="closed_days">${selectOptions([{ value: '30', label: '30 dias' }, { value: '60', label: '60 dias' }, { value: '180', label: '180 dias' }, { value: '3650', label: 'Todas' }], s.closed_days || '60', { allowEmpty: false })}</select></label>
    </form>
    <div id="board"></div></div>`);
  const form = $('[data-f]', view);
  let mode = s.mode || 'kanban';
  let data = null;
  const query = () => Object.fromEntries(new FormData(form).entries());
  const load = async () => {
    saved = { ...query(), mode };
    const box = $('#board', view);
    box.classList.add('loading');
    try {
      if (mode === 'kanban') {
        data = await get('/api/funil', query());
        render(box, board(data));
      } else {
        const r = await get('/api/oportunidades', { ...query(), limit: 200 });
        render(box, oppTable(r.rows));
      }
    } catch (e) {
      toastError(e);
    } finally {
      box.classList.remove('loading');
    }
  };
  let t;
  form.addEventListener('input', (e) => {
    if (e.target.name !== 'q') return;
    clearTimeout(t);
    t = setTimeout(load, 300);
  });
  form.addEventListener('change', (e) => e.target.name !== 'q' && load());
  form.addEventListener('submit', (e) => e.preventDefault());
  on(view, 'click', '[data-mode]', (e, b) => {
    mode = b.dataset.mode;
    $$('[data-mode]', view).forEach((x) => x.classList.toggle('active', x === b));
    load();
  });
  on(view, 'click', '[data-act=export]', () => download('/api/exportar/oportunidades', query()).catch(toastError));

  const doMove = async (oppId, stageId) => {
    const card = data?.stages.flatMap((st) => st.cards).find((c) => c.id === Number(oppId));
    if (!card || card.stage_id === Number(stageId)) return;
    const r = await moveStage(card, stageId);
    if (r) load();
  };
  // Arrastar e soltar (desktop)
  on(view, 'dragstart', '.opp-card', (e, c) => {
    e.dataTransfer.setData('text/plain', c.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    c.classList.add('dragging');
  });
  on(view, 'dragend', '.opp-card', (e, c) => c.classList.remove('dragging'));
  on(view, 'dragover', '.column', (e, col) => {
    if (!can.write()) return;
    e.preventDefault();
    col.classList.add('over');
  });
  on(view, 'dragleave', '.column', (e, col) => col.classList.remove('over'));
  on(view, 'drop', '.column', (e, col) => {
    e.preventDefault();
    col.classList.remove('over');
    const oppId = e.dataTransfer.getData('text/plain');
    if (oppId) doMove(oppId, col.dataset.stage);
  });
  // Alternativa sem arrastar (celular e teclado)
  on(view, 'change', 'select[data-move]', (e, sel) => {
    if (sel.value) doMove(sel.dataset.move, sel.value).finally(() => (sel.value = ''));
  });
  await load();
}

function board(d) {
  return html`<div class="kanban">${d.stages.map(
    (s) => html`<section class="column kind-${s.kind}" data-stage="${s.id}">
      <header><strong>${s.name}</strong><span class="count">${s.count}</span>${s.total_credit ? html`<small>${fmtMoney(s.total_credit)}</small>` : ''}</header>
      <div class="cards">${s.cards.length ? s.cards.map(card) : html`<div class="empty small">—</div>`}</div>
    </section>`,
  )}</div><p class="muted small">Arraste os cartões entre as etapas ou use "Mover para". Oportunidades fechadas aparecem por ${d.closed_days} dias. Cartões com borda vermelha estão sem atividade há ${state.meta.settings.stalled_days}+ dias.</p>`;
}

function card(o) {
  const late = o.next_action_at && new Date(o.next_action_at) < new Date() && o.status === 'aberta';
  return html`<article class="opp-card prio-${o.priority} ${o.stalled ? 'stalled' : ''}" draggable="${can.write() ? 'true' : 'false'}" data-id="${o.id}">
    <a href="#/oportunidades/${o.id}" class="title">${o.contact_name}</a>
    <div class="small muted">${o.code} · ${o.product_name || optLabel('categoria_credito', o.credit_category)}</div>
    ${o.credit_value ? html`<div class="small">${fmtMoney(o.credit_value)}${o.term_months ? ` · ${o.term_months}m` : ''}</div>` : ''}
    <div class="small ${late ? 'overdue' : ''}">${o.next_action ? html`▸ ${o.next_action} ${o.next_action_at ? html`<span>(${relTime(o.next_action_at)})</span>` : ''}` : html`<span class="warn-text">Sem próxima ação</span>`}</div>
    <div class="card-foot"><span class="small muted">${o.owner_name || '—'} · ${o.days_in_stage}d na etapa</span>${optoutBadge(o.contact_optouts)}${o.status === 'perdida' && o.lost_reason ? badge(optLabel('motivo_perda', o.lost_reason), 'muted') : ''}</div>
    ${can.write() ? html`<select data-move="${o.id}" aria-label="Mover para etapa"><option value="">Mover para…</option>${state.meta.stages.filter((s) => s.id !== o.stage_id).map((s) => html`<option value="${s.id}">${s.name}</option>`)}</select>` : ''}
  </article>`;
}

function oppTable(rows) {
  return table(
    [
      { label: 'Código', render: (o) => html`<a href="#/oportunidades/${o.id}">${o.code}</a>` },
      { label: 'Cadastro', render: (o) => html`<a href="#/leads/${o.contact_id}">${o.contact_name}</a> ${optoutBadge(o.contact_optouts)}` },
      { label: 'Etapa', render: (o) => html`${o.stage_name}<br><small>${K('opp_status', o.status)}</small>` },
      { label: 'Prioridade', render: (o) => K('priorities', o.priority) },
      { label: 'Produto', render: (o) => o.product_name || '—' },
      { label: 'Crédito', render: (o) => fmtMoney(o.credit_value), cls: 'num' },
      { label: 'Origem', render: (o) => optLabel('origem', o.contact_origin) },
      { label: 'Responsável', render: (o) => o.owner_name || '—' },
      { label: 'Próxima ação', render: (o) => (o.next_action ? html`${o.next_action}<br><small>${fmtDateTime(o.next_action_at)}</small>` : html`<span class="warn-text">—</span>`) },
      { label: 'Na etapa', render: (o) => `${o.days_in_stage} d` },
    ],
    rows,
    { emptyMsg: 'Nenhuma oportunidade.' },
  );
}

/* ------------------------- Detalhe da oportunidade ------------------------- */

async function showOpp(view, id) {
  let o;
  let contact;
  const reload = async () => {
    o = await get(`/api/oportunidades/${id}`);
    contact = await get(`/api/cadastros/${o.contact_id}`);
    draw();
  };
  const draw = () => {
    const kv = (label, v) => html`<div><span>${label}</span>${v ?? '—'}</div>`;
    render(view, html`<div class="page">
      <div class="page-head"><div>
        <div class="crumbs"><a href="#/funil">Funil</a> / <a href="#/leads/${o.contact_id}">${o.contact_name}</a> / ${o.code}</div>
        <h1>${o.code} ${o.title ? html`— ${o.title}` : ''}</h1>
        <div class="badges">${badge(o.stage_name, `kind-${o.stage_kind}`)} ${badge(K('opp_status', o.status), o.status === 'ganha' ? 'ok' : o.status === 'perdida' ? 'danger' : '')} ${badge(`Prioridade ${K('priorities', o.priority)}`)} ${optoutBadge(o.contact_optouts)} ${o.stalled ? badge(`Sem atividade há ${o.days_without_activity} dias`, 'danger') : ''}</div>
        <div class="muted small">Cadastro: <a href="#/leads/${o.contact_id}">${o.contact_code} — ${o.contact_name}</a> · Responsável: ${o.owner_name || '—'} · ${o.days_in_stage} dia(s) na etapa atual</div>
      </div>
      ${can.write() ? html`<div class="actions">
        <label class="inline">Mover para <select data-move-detail>${html`<option value="">—</option>`}${state.meta.stages.filter((s) => s.id !== o.stage_id).map((s) => html`<option value="${s.id}">${s.name}</option>`)}</select></label>
        <button class="btn" data-act="edit">Editar</button>
        <button class="btn primary" data-act="activity">Registrar atividade</button>
        <button class="btn" data-act="task">Nova tarefa</button>
      </div>` : ''}</div>
      <div class="next-action ${!o.next_action ? 'missing' : o.next_action_at && new Date(o.next_action_at) < new Date() ? 'late' : ''}"><span>Próxima ação:</span> ${o.next_action ? html`<strong>${o.next_action}</strong> ${o.next_action_at ? html`<small>${fmtDateTime(o.next_action_at)} · ${relTime(o.next_action_at)}</small>` : ''}` : html`<span class="warn-text">Nenhuma próxima ação definida</span>`}</div>
      ${o.status === 'perdida' ? html`<div class="alert danger">Perdida: ${optLabel('motivo_perda', o.lost_reason)}${o.lost_notes ? ` — ${o.lost_notes}` : ''}</div>` : ''}
      ${o.status === 'pausada' && o.pause_reason ? html`<div class="alert warn">Em nutrição: ${o.pause_reason}</div>` : ''}
      <div class="cols">
        <section class="card"><h3>Dados comerciais</h3><div class="kv">
          ${kv('Produto', o.product_name)}${kv('Categoria do crédito', optLabel('categoria_credito', o.credit_category))}
          ${kv('Crédito desejado', fmtMoney(o.credit_value))}${kv('Prazo de interesse', o.term_months ? `${o.term_months} meses` : null)}
          ${kv('Faixa de parcela', o.installment_min || o.installment_max ? `${fmtMoney(o.installment_min)} a ${fmtMoney(o.installment_max)}` : null)}
          ${kv('Cotas', o.quotas)}${kv('Modalidade de pagamento', optLabel('modalidade_pagamento', o.payment_modality))}
          <div><span>Estratégia</span>${optLabel('estrategia', o.strategy)} ${o.strategy ? (o.strategy_validated_at ? badge(`validada por ${o.strategy_validated_by_name} em ${fmtDate(o.strategy_validated_at)}`, 'ok') : html`${badge('não validada pelo consultor', 'warn')} ${can.write() ? html`<button class="btn small" data-act="validate">Validar</button>` : ''}`) : ''}</div>
          ${kv('Contemplação de interesse', optLabel('tipo_contemplacao', o.contemplation_type))}
          ${kv('Recursos próprios p/ lance', fmtMoney(o.bid_own_resources))}${kv('FGTS disponível', fmtMoney(o.fgts_available))}
          ${kv('Lance embutido', { sim: 'Sim', nao: 'Não', avaliar: 'Avaliar', nao_se_aplica: 'Não se aplica' }[o.embedded_bid_interest])}
          ${kv('Urgência', optLabel('urgencia', o.urgency))}
          <div class="full"><span>Objetivo declarado</span>${o.objective || '—'}</div>
          <div class="full"><span>Critério de qualificação</span>${o.qualification_criteria || '—'}</div>
          ${Object.entries(o.custom || {}).map(([k, v]) => kv(state.meta.custom_fields.find((f) => f.key === k && f.entity === 'opportunity')?.label || k, String(v)))}
        </div></section>
        <section class="card"><h3>Histórico de etapas</h3>
          <ol class="stage-history">${o.stage_history.map((h) => html`<li><strong>${h.to_stage_name}</strong> <small class="muted">${fmtDateTime(h.moved_at)} · ${h.user_name || 'Sistema'}${h.from_stage_name ? ` · vindo de "${h.from_stage_name}" após ${Math.round((h.seconds_in_previous || 0) / 86400)} dia(s)` : ''}</small>${h.reason ? html`<div class="small">${h.reason}</div>` : ''}</li>`)}</ol>
        </section>
      </div>
      <section class="card">
        <div class="section-head"><h3>Simulações</h3><span>${can.write() ? html`${simulatorButton(contact, o)} <button class="btn" data-act="sim-manual">Registrar simulação manual</button>` : ''}</span></div>
        ${table(
          [
            { label: 'Código', render: (s) => html`<a href="#" data-sim="${s.id}">${s.code}</a> v${s.version}` },
            { label: 'Origem', render: (s) => s.source },
            { label: 'Crédito', render: (s) => fmtMoney(s.credit_value), cls: 'num' },
            { label: 'Prazo', render: (s) => s.term_months ?? '—' },
            { label: 'Parcela', render: (s) => fmtMoney(s.installment), cls: 'num' },
            { label: 'Estratégia', render: (s) => optLabel('estrategia', s.strategy) },
            { label: 'Status', render: (s) => K('simulation_status', s.status) },
            { label: 'Data', render: (s) => fmtDateTime(s.created_at) },
            { label: '', render: (s) => (can.write() ? html`<button class="btn small" data-act="prop-from-sim" data-sim="${s.id}">Gerar proposta</button>` : '') },
          ],
          o.simulations,
          { emptyMsg: 'Nenhuma simulação.' },
        )}
      </section>
      <section class="card">
        <div class="section-head"><h3>Propostas</h3>${can.write() ? html`<button class="btn" data-act="prop-new">+ Nova proposta</button>` : ''}</div>
        ${table(
          [
            { label: 'Código', render: (p) => html`<a href="#" data-prop="${p.id}">${p.code}</a> v${p.version}` },
            { label: 'Crédito', render: (p) => fmtMoney(p.credit_value), cls: 'num' },
            { label: 'Prazo', render: (p) => p.term_months ?? '—' },
            { label: 'Parcela inicial', render: (p) => fmtMoney(p.initial_installment), cls: 'num' },
            { label: 'Status', render: (p) => badge(K('proposal_status', p.status), `st-${p.status}`) },
            { label: 'Validade', render: (p) => fmtDate(p.valid_until) },
            { label: 'Criada', render: (p) => fmtDateTime(p.created_at) },
          ],
          o.proposals,
          { emptyMsg: 'Nenhuma proposta.' },
        )}
      </section>
      <section class="card"><div class="section-head"><h3>Tarefas</h3></div>${tasksTable(o.tasks)}</section>
      <section class="card"><h3>Atividades desta oportunidade</h3>${timeline(o.activities)}</section>
    </div>`);
  };
  bindTasks(view, () => o.tasks, reload);
  on(view, 'change', '[data-move-detail]', async (e, sel) => {
    if (!sel.value) return;
    const r = await moveStage(o, sel.value);
    sel.value = '';
    if (r) reload();
  });
  on(view, 'click', '[data-act=edit]', async () => (await opportunityForm(contact, o)) && reload());
  on(view, 'click', '[data-act=activity]', async () => (await activityForm(contact, { opportunity_id: o.id })) && reload());
  on(view, 'click', '[data-act=task]', async () => (await taskForm({ contact, opportunity_id: o.id })) && reload());
  on(view, 'click', '[data-act=validate]', async () => {
    try {
      await post(`/api/oportunidades/${o.id}/validar-estrategia`);
      toast('Estratégia validada.');
      reload();
    } catch (e) {
      toastError(e);
    }
  });
  on(view, 'click', '[data-act=open-simulator]', (e, b) => openSimulator(o.contact_id, o.id, 'oportunidade').then(() => setTimeout(reload, 500)));
  on(view, 'click', '[data-act=sim-manual]', async () => (await simulationForm(contact, { opportunity_id: o.id })) && reload());
  on(view, 'click', '[data-sim]:not([data-act])', async (e, a) => {
    e.preventDefault();
    const s = await get(`/api/simulacoes/${a.dataset.sim}`);
    if (await simulationForm(contact, { simulation: s })) reload();
  });
  on(view, 'click', '[data-act=prop-new]', async () => (await proposalForm(o, o.simulations)) && reload());
  on(view, 'click', '[data-act=prop-from-sim]', async (e, b) => (await proposalForm(o, o.simulations, { simulation_id: Number(b.dataset.sim) })) && reload());
  on(view, 'click', '[data-prop]', (e, a) => {
    e.preventDefault();
    proposalDetail(a.dataset.prop, reload);
  });
  await reload();
}
