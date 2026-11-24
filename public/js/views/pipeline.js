import { get, post, download } from '../api.js';
import {
  html, raw, render, $, $$, on, state, selectOptions, opts, toItems, userItems, stageItems, fmtMoney, fmtDateTime, fmtDate, relTime,
  badge, optoutBadge, optLabel, K, can, toast, toastError, table, empty, fresh, crmTabs, modal, field, fixPlurals, parseMoneyBR, fmtMoneyInput,
} from '../ui.js';
import { bindDrawerLinks } from '../drawer.js';
import { icon } from '../icons.js';
import { qualBlocks, qualProgress, tempBadge, tempPanel } from '../qualification.js';
import { transcriptFlow, downloadR1Template } from '../r1.js';
import { moveStage, opportunityForm, activityForm, taskForm, simulationForm, proposalForm, proposalDetail, quickSimulation, openProposalSimulator } from '../forms.js';
import { timeline, tasksTable, bindTasks } from './contact.js';
import { scheduleMeetingDialog, R1_STAGES } from '../meeting.js';

let saved = {};
let sortBy = 'next_action';
let sortDir = 'asc';
const SORTS = [
  { value: 'next_action', label: 'Próxima atividade' },
  { value: 'value', label: 'Valor da negociação' },
  { value: 'entry', label: 'Data de entrada do lead' },
  { value: 'created', label: 'Data de criação do negócio' },
];
const sortKey = {
  next_action: (o) => (o.next_action_at ? Date.parse(o.next_action_at) : null),
  value: (o) => o.deal_value ?? null,
  entry: (o) => (o.contact_created_at ? Date.parse(o.contact_created_at) : null),
  created: (o) => Date.parse(o.created_at),
};
/** Ordena os cartões de cada coluna; quem não tem o dado (ex.: sem próxima atividade) fica sempre no fim. */
function sortCards(cards) {
  const f = sortKey[sortBy];
  return [...cards].sort((a, b) => {
    const x = f(a);
    const y = f(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return sortDir === 'asc' ? x - y : y - x;
  });
}

export async function show(view, { key, id, params }) {
  if (key === 'oportunidades' && id) return showOpp(view, id);
  const s = { ...saved, ...params };
  const manager = can.manage();
  render(view, html`<div class="page wide">
    ${crmTabs('funil')}
    <div class="page-head"><div><h1>Pipeline</h1><p class="muted small">0 Prospect · 1 Lead · 2 Tentativa · 3 Qualificação · 4 R1 · 5 R2 · 6 Negociação · 7 Venda — para todas as áreas (consórcio, planejamento, seguros e investimentos).</p></div>
      <div class="actions">
        <div class="seg small"><button class="btn small ${!['lista', 'perdidos'].includes(s.mode) ? 'active' : ''}" data-mode="kanban">Comercial</button><button class="btn small ${s.mode === 'lista' ? 'active' : ''}" data-mode="lista">Lista</button>${manager ? html`<button class="btn small ${s.mode === 'perdidos' ? 'active' : ''}" data-mode="perdidos" title="Funil de perdidos: onde cada lead foi perdido e o motivo (MP)">Perdidos</button>` : ''}</div>
        ${can.admin() ? html`<button class="btn" data-act="export">Exportar CSV</button>` : ''}
      </div></div>
    <form class="pipe-bar" data-f>
      <div class="pb-line">
        <label class="pb-search"><span class="sr-only">Buscar</span>${icon('buscar', 16)}<input type="search" name="q" value="${s.q || ''}" placeholder="Buscar por nome, código, telefone ou e-mail"></label>
        <span class="kanban-only pb-sort"><label><span class="sr-only">Ordenar por</span><select data-sort aria-label="Ordenar por">${selectOptions(SORTS, sortBy, { allowEmpty: false })}</select></label>
          <button type="button" class="btn small sort-dir" data-sortdir aria-label="Inverter a ordem" title="Inverter a ordem">${sortDir === 'asc' ? '↑' : '↓'}</button></span>
        <button type="button" class="btn pb-filter-btn" data-filters aria-expanded="false" aria-controls="pipe-filters">${icon('filtro', 15)} Filtros <span class="count" data-fcount hidden>0</span></button>
        <label class="check archived-toggle kanban-only"><input type="checkbox" data-archived ${s.archived ? raw('checked') : ''}> Arquivados</label>
        ${can.write() ? html`<button type="button" class="btn kanban-only" data-act="bulk" aria-pressed="false">${icon('selecionar', 15)} Mover em massa</button>` : ''}
      </div>
      <div class="pb-chips" data-fchips></div>
      <div class="filter-panel" id="pipe-filters" hidden>
        <div class="fp-grid">
          ${manager ? html`<label>Responsável<select name="owner_id">${selectOptions(userItems(), s.owner_id, { placeholder: 'Todos' })}</select></label>` : ''}
          <label>Área<select name="area">${selectOptions(opts('area_negocio'), s.area, { placeholder: 'Todas' })}</select></label>
          <label>Origem<select name="origin">${selectOptions(opts('origem'), s.origin, { placeholder: 'Todas' })}</select></label>
          <label>Etapa<select name="stage_id">${selectOptions(stageItems(), s.stage_id, { placeholder: 'Todas' })}</select></label>
          <label>Próxima ação<select name="next_action">${selectOptions([{ value: 'atrasada', label: 'Atrasada' }, { value: 'hoje', label: 'Para hoje' }, { value: 'sem', label: 'Sem próxima ação' }], s.next_action, { placeholder: 'Qualquer' })}</select></label>
          <label>Prioridade<select name="priority">${selectOptions(toItems(state.meta.constants.priorities), s.priority, { placeholder: 'Todas' })}</select></label>
          <fieldset class="fp-range"><legend>Data de criação</legend><label><span>De</span><input type="date" name="created_from" value="${s.created_from || ''}"></label><label><span>Até</span><input type="date" name="created_to" value="${s.created_to || ''}"></label></fieldset>
          <fieldset class="fp-range"><legend>Valor</legend><label><span>Mínimo</span><span class="money-input"><span aria-hidden="true">R$</span><input type="text" inputmode="decimal" data-money name="value_min" value="${s.value_min ? fmtMoneyInput(s.value_min) : ''}" placeholder="0,00"></span></label><label><span>Máximo</span><span class="money-input"><span aria-hidden="true">R$</span><input type="text" inputmode="decimal" data-money name="value_max" value="${s.value_max ? fmtMoneyInput(s.value_max) : ''}" placeholder="0,00"></span></label></fieldset>
          <label>Fechadas nos últimos<select name="closed_days">${selectOptions([{ value: '30', label: '30 dias' }, { value: '60', label: '60 dias' }, { value: '180', label: '180 dias' }, { value: '3650', label: 'Todas' }], s.closed_days || '60', { allowEmpty: false })}</select></label>
        </div>
        <div class="fp-actions"><button type="button" class="btn small ghost" data-fclear>Limpar filtros</button><button type="button" class="btn small primary" data-fclose>Ver resultados</button></div>
      </div>
    </form>
    <div id="board"></div>
    <div class="drop-bar" hidden aria-hidden="true">${state.meta.stages.filter((x) => ['nutricao', 'perdido'].includes(x.kind)).map((x) => html`<div class="drop-zone kind-${x.kind}" data-stage="${x.id}"><strong>${x.name}</strong><small>Solte aqui para arquivar</small></div>`)}</div>
    <div class="bulk-bar" hidden><strong data-bulk-count>0 selecionado(s)</strong>
      <button type="button" class="btn small ghost" data-act="bulk-all">Selecionar todos visíveis</button>
      <span class="grow"></span>
      <button type="button" class="btn primary" data-act="bulk-move">Mover para etapa…</button>
      ${manager ? html`<button type="button" class="btn" data-act="bulk-owner">Transferir responsável…</button>` : ''}
      <button type="button" class="btn ghost" data-act="bulk-cancel">Cancelar</button></div>
  </div>`);
  const form = $('[data-f]', view);
  let mode = s.mode === 'perdidos' && !manager ? 'kanban' : s.mode || 'kanban';
  let archived = !!s.archived;
  let data = null;
  let bulk = false;
  const selected = new Set();
  // Filtros: os valores em R$ vão como número; vazios não são enviados
  const query = () => {
    const q = Object.fromEntries(new FormData(form).entries());
    for (const k of ['value_min', 'value_max']) {
      const n = parseMoneyBR(q[k]);
      if (n === '' || Number.isNaN(n)) delete q[k];
      else q[k] = String(n);
    }
    for (const k of Object.keys(q)) if (q[k] === '') delete q[k];
    return q;
  };
  const FILTER_LABEL = { owner_id: 'Responsável', area: 'Área', origin: 'Origem', stage_id: 'Etapa', next_action: 'Próxima ação', priority: 'Prioridade', created_from: 'Criado de', created_to: 'Criado até', value_min: 'Valor mínimo', value_max: 'Valor máximo' };
  /** Botão "Filtros" com o número de filtros ativos e as etiquetas removíveis abaixo da barra. */
  const syncFilters = () => {
    const q = query();
    const active = Object.keys(FILTER_LABEL).filter((k) => q[k] != null);
    const cnt = $('[data-fcount]', view);
    cnt.hidden = !active.length;
    cnt.textContent = active.length;
    const show = (k) => {
      const el = form.elements[k];
      if (k.startsWith('value_')) return fmtMoney(Number(q[k]));
      if (k.startsWith('created_')) return fmtDate(q[k]);
      return el?.selectedOptions?.[0]?.textContent || q[k];
    };
    render($('[data-fchips]', view), html`${active.map((k) => html`<span class="fchip">${FILTER_LABEL[k]}: <strong>${show(k)}</strong><button type="button" data-fdel="${k}" aria-label="Remover filtro ${FILTER_LABEL[k]}">×</button></span>`)}`);
  };
  const allCards = () => data?.stages.flatMap((st) => st.cards) || [];
  const syncBulk = () => {
    const bar = $('.bulk-bar', view);
    bar.hidden = !bulk;
    $('[data-bulk-count]', view).textContent = fixPlurals(`${selected.size} selecionado(s)`);
    $$('[data-act=bulk-move], [data-act=bulk-owner]', view).forEach((b) => (b.disabled = !selected.size));
    $('[data-act=bulk]', view)?.setAttribute('aria-pressed', String(bulk));
    $('[data-act=bulk]', view)?.classList.toggle('active', bulk);
  };
  const draw = () => {
    const box = $('#board', view);
    if (mode === 'kanban' && data) render(box, board(data, bulk, selected, archived));
    syncBulk();
  };
  const load = async () => {
    saved = { ...query(), mode, archived };
    syncFilters();
    const box = $('#board', view);
    box.classList.add('loading');
    try {
      if (mode === 'kanban') {
        data = await get('/api/funil', query());
        const ids = new Set(allCards().map((c) => c.id));
        [...selected].forEach((sid) => !ids.has(sid) && selected.delete(sid));
        draw();
      } else if (mode === 'perdidos') {
        const q = query();
        const r = await get('/api/funil/perdidos', { q: q.q, owner_id: q.owner_id, area: q.area, origin: q.origin, category: q.category, days: q.closed_days === '3650' ? 3650 : q.closed_days || 90 });
        render(box, lostBoardView(r));
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
  const panel = $('#pipe-filters', view);
  const togglePanel = (open = panel.hidden) => {
    panel.hidden = !open;
    $('[data-filters]', view).setAttribute('aria-expanded', String(open));
    $('[data-filters]', view).classList.toggle('active', open);
  };
  on(view, 'click', '[data-filters]', () => togglePanel());
  on(view, 'click', '[data-fclose]', () => togglePanel(false));
  on(view, 'click', '[data-fclear]', () => {
    for (const k of Object.keys(FILTER_LABEL)) if (form.elements[k]) form.elements[k].value = '';
    load();
  });
  on(view, 'click', '[data-fdel]', (e, b) => {
    if (form.elements[b.dataset.fdel]) form.elements[b.dataset.fdel].value = '';
    load();
  });
  // Fecha o painel de filtros ao clicar fora dele
  view.addEventListener('click', (e) => {
    if (!panel.hidden && !e.target.closest('#pipe-filters, [data-filters]')) togglePanel(false);
  });
  on(view, 'click', '[data-mode]', (e, b) => {
    mode = b.dataset.mode;
    $$('[data-mode]', view).forEach((x) => x.classList.toggle('active', x === b));
    $$('.kanban-only', view).forEach((x) => (x.hidden = mode !== 'kanban'));
    $('.page-head h1', view).textContent = mode === 'perdidos' ? 'Pipeline de perdidos' : 'Pipeline';
    if (mode !== 'kanban') {
      bulk = false;
      selected.clear();
    }
    load();
  });
  on(view, 'change', '[data-sort]', (e, sel) => ((sortBy = sel.value), draw()));
  on(view, 'change', '[data-archived]', (e, c) => {
    archived = c.checked;
    saved.archived = archived;
    draw();
  });
  on(view, 'click', '[data-sortdir]', (e, b) => {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    b.textContent = sortDir === 'asc' ? '↑' : '↓';
    draw();
  });
  on(view, 'click', '[data-act=export]', () => download('/api/exportar/oportunidades', query()).catch(toastError));
  bindDrawerLinks(view, () => ({ onChange: load }));

  /* ---- Seleção e ações em massa ---- */
  on(view, 'click', '[data-act=bulk]', () => {
    bulk = !bulk;
    if (!bulk) selected.clear();
    draw();
  });
  on(view, 'click', '[data-act=bulk-cancel]', () => {
    bulk = false;
    selected.clear();
    draw();
  });
  on(view, 'change', '[data-sel]', (e, c) => {
    const n = Number(c.dataset.sel);
    if (c.checked) selected.add(n);
    else selected.delete(n);
    c.closest('.opp-card').classList.toggle('selected', c.checked);
    syncBulk();
  });
  on(view, 'change', '[data-sel-col]', (e, c) => {
    const st = data.stages.find((x) => x.id === Number(c.dataset.selCol));
    st.cards.forEach((k) => (c.checked ? selected.add(k.id) : selected.delete(k.id)));
    draw();
  });
  on(view, 'click', '[data-act=bulk-all]', () => {
    allCards().forEach((k) => selected.add(k.id));
    draw();
  });
  const runBulk = async (body) => {
    const r = await post('/api/oportunidades/lote', { ...body, ids: [...selected] });
    if (r.failed) {
      await modal({
        title: `${r.done} movido(s), ${r.failed} não movido(s)`,
        body: html`<p>Os cartões abaixo não cumprem as regras da etapa (ou não puderam ser alterados):</p>
          <ul class="missing-list">${r.results.filter((x) => !x.ok).map((x) => html`<li><strong>${x.code || `#${x.id}`}</strong>: ${x.error}</li>`)}</ul>`,
      });
    } else toast(`${r.done} cartão(ões) atualizados.`);
    bulk = false;
    selected.clear();
    load();
    return true;
  };
  on(view, 'click', '[data-act=bulk-move]', () => {
    if (!selected.size) return;
    modal({
      title: `Mover ${selected.size} cartão(ões)`,
      body: html`<div class="grid">${field({ name: 'stage_id', label: 'Etapa de destino', type: 'select', options: state.meta.stages.filter((x) => x.kind !== 'ganho').map((x) => ({ value: x.id, label: x.name })), required: true, full: true })}
        <div class="full" data-k="perdido" hidden>${field({ name: 'lost_reason', label: 'Motivo da perda', type: 'select', options: opts('motivo_perda'), full: true })}${field({ name: 'lost_notes', label: 'Detalhe (opcional)', full: true })}</div>
        <div class="full" data-k="nutricao" hidden>${field({ name: 'pause_reason', label: 'Motivo da pausa', full: true })}${field({ name: 'return_at', label: 'Retomar contato em', type: 'date', full: true })}</div>
        ${field({ name: 'reason', label: 'Observação (obrigatória para voltar etapas)', type: 'textarea', rows: 2, full: true })}</div>
        <p class="hint">Cada cartão é validado pelas regras do funil. A etapa "Venda" só é alcançada pela confirmação do pagamento.</p>`,
      submitLabel: 'Mover cartões',
      onMount(f) {
        const sync = () => {
          const st = state.meta.stages.find((x) => x.id === Number(f.stage_id.value));
          $$('[data-k]', f).forEach((d) => (d.hidden = d.dataset.k !== st?.kind));
        };
        f.stage_id.addEventListener('change', sync);
      },
      async onSubmit(d) {
        const st = state.meta.stages.find((x) => x.id === Number(d.stage_id));
        if (st?.kind === 'perdido' && !d.lost_reason) throw new Error('Informe o motivo da perda.');
        if (st?.kind === 'nutricao' && (!d.pause_reason || !d.return_at)) throw new Error('Informe o motivo e a data para retomar o contato.');
        return runBulk({ action: 'etapa', ...d });
      },
    });
  });
  on(view, 'click', '[data-act=bulk-owner]', () => {
    if (!selected.size) return;
    modal({
      title: `Transferir ${selected.size} cartão(ões)`,
      body: html`<div class="grid">${field({ name: 'owner_id', label: 'Novo responsável', type: 'select', options: userItems(), required: true, full: true })}
        ${field({ name: 'stage_id', label: 'Coluna do funil para o novo responsável', type: 'select', options: state.meta.stages.filter((x) => x.kind === 'aberta').map((x) => ({ value: x.id, label: x.name })), placeholder: 'Manter a etapa atual', full: true })}
        ${field({ name: 'reason', label: 'Motivo da transferência', type: 'textarea', rows: 2, full: true, placeholder: 'Ex.: redistribuição da carteira, férias, desligamento' })}</div>
        <p class="hint">O cadastro, os negócios abertos e as tarefas pendentes passam para o novo responsável, que recebe uma notificação.</p>`,
      submitLabel: 'Transferir',
      onSubmit: (d) => runBulk({ action: 'responsavel', ...d }),
    });
  });

  const doMove = async (oppId, stageId) => {
    const card = allCards().find((c) => c.id === Number(oppId));
    if (!card || card.stage_id === Number(stageId)) return;
    const r = await moveStage(card, stageId);
    if (r) load();
  };
  // Arrastar e soltar (desktop). No celular e no teclado, o painel lateral do cartão tem "Mover etapa".
  on(view, 'dragstart', '.opp-card', (e, c) => {
    if (bulk) return e.preventDefault();
    e.dataTransfer.setData('text/plain', c.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    c.classList.add('dragging');
    if (!archived) $('.drop-bar', view).hidden = false;
  });
  on(view, 'dragend', '.opp-card', (e, c) => {
    c.classList.remove('dragging');
    $('.drop-bar', view).hidden = true;
  });
  on(view, 'dragover', '.column, .drop-zone', (e, col) => {
    if (!can.write() || bulk) return;
    e.preventDefault();
    col.classList.add('over');
  });
  on(view, 'dragleave', '.column, .drop-zone', (e, col) => col.classList.remove('over'));
  on(view, 'drop', '.column, .drop-zone', (e, col) => {
    e.preventDefault();
    col.classList.remove('over');
    $('.drop-bar', view).hidden = true;
    const oppId = e.dataTransfer.getData('text/plain');
    if (oppId) doMove(oppId, col.dataset.stage);
  });
  if (mode !== 'kanban') $$('.kanban-only', view).forEach((x) => (x.hidden = true));
  await load();
}

/** Contadores das colunas R1 e R2: agendadas, realizadas, remarcadas (R) e no-show (NS). */
function meetingCounters(s) {
  const kind = s.key === 'r2' ? 'r2' : s.key === 'r1' ? 'r1' : null;
  if (!kind) return '';
  const ms = s.cards.map((c) => c.meetings?.[kind]).filter(Boolean);
  const n = (f) => ms.filter(f).length;
  const ag = n((m) => ['agendada', 'remarcada'].includes(m.state));
  const ok = n((m) => m.state === 'realizada');
  const rm = n((m) => m.state === 'remarcada');
  const ns = n((m) => m.state === 'no_show');
  return html`<div class="col-meet" title="Agendadas · realizadas · remarcadas · no-show"><span>${ag} agend.</span><span class="ok-text">${ok} feitas</span>${rm ? html`<span class="badge rm">R ${rm}</span>` : ''}${ns ? html`<span class="badge ns">NS ${ns}</span>` : ''}</div>`;
}

function board(d, bulk, selected, archived) {
  const cols = d.stages.filter((s) => archived || !['nutricao', 'perdido'].includes(s.kind));
  return html`<div class="kanban ${bulk ? 'bulk' : ''}">${cols.map(
    (s) => html`<section class="column kind-${s.kind}" data-stage="${s.id}" data-key="${s.key || ''}">
      <header>${bulk && s.cards.length ? html`<input type="checkbox" data-sel-col="${s.id}" aria-label="Selecionar todos de ${s.name}" ${s.cards.every((c) => selected.has(c.id)) ? raw('checked') : ''}>` : ''}<strong>${s.name}</strong>${['nutricao', 'perdido'].includes(s.kind) ? html`<small class="archived-tag">arquivado</small>` : ''}<span class="count">${s.count}</span>${s.total_credit ? html`<small>${fmtMoney(s.total_credit)}</small>` : ''}${meetingCounters(s)}</header>
      <div class="cards">${s.cards.length ? sortCards(s.cards).map((c) => card(c, bulk, selected)) : html`<div class="empty small">—</div>`}</div>
    </section>`,
  )}</div><p class="muted small">Clique no nome para abrir o painel do lead sem sair do pipeline. Arraste os cartões entre as etapas: para R1 ou R2 abre o agendamento da reunião; para Perdido, os motivos de perda (MP). Ao arrastar, aparecem as áreas de arquivamento (Nutrição futura e Perdido). NS = não compareceu à reunião; R = reunião remarcada. Fechadas aparecem por ${d.closed_days} dias.</p>`;
}

const SLA_TONE = { ok: 'ok', atencao: 'warn', estourado: 'danger' };
const fmtShort = (iso) => `${new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
const scoreTone = (n) => (n >= 70 ? 'hi' : n >= 40 ? 'mid' : 'lo');

/** Marcas de reunião do cartão: NS (amarelo), R (azul), data da R1/R2 e se a R2 já foi marcada. */
function meetingTags(o) {
  const m = o.meetings || {};
  const out = [];
  const one = (k, x) => {
    if (!x) return;
    const K = k.toUpperCase();
    if (x.state === 'no_show') out.push(html`<span class="badge ns" title="${K}: o cliente não compareceu">NS</span>`);
    if (x.state === 'remarcada') out.push(html`<span class="badge rm" title="${K} remarcada${x.reschedules > 1 ? ` ${x.reschedules}x` : ''}">R</span>`);
    if (['agendada', 'remarcada'].includes(x.state)) out.push(html`<span class="chip-sm meet ${x.confirmed ? 'confirmed' : ''}" title="${K} agendada${x.confirmed ? ' (presença confirmada)' : ''}">${K} ${fmtShort(x.at)}</span>`);
    if (x.state === 'realizada') out.push(html`<span class="chip-sm ok-chip">${K} feita</span>`);
  };
  one('r1', m.r1);
  one('r2', m.r2);
  if (['r1', 'r2'].includes(o.stage_key) && !m.r2) out.push(html`<span class="chip-sm muted">R2 não agendada</span>`);
  return out.length ? html`<div class="card-meet">${out}</div>` : '';
}

function card(o, bulk, selected) {
  const late = o.next_action_at && new Date(o.next_action_at) < new Date() && o.status === 'aberta';
  const sel = selected.has(o.id);
  const campaign = o.campaign || o.origin_campaign || o.contact_campaign;
  return html`<article class="opp-card prio-${o.priority} ${o.stalled ? 'stalled' : ''} ${sel ? 'selected' : ''} ${o.sla ? `sla-${o.sla.level}` : ''}" draggable="${can.write() && !bulk ? 'true' : 'false'}" data-id="${o.id}">
    ${bulk ? html`<input type="checkbox" class="card-check" data-sel="${o.id}" aria-label="Selecionar ${o.contact_name}" ${sel ? raw('checked') : ''}>` : ''}
    <div class="card-title-row"><a href="#/leads/${o.contact_id}" class="title" data-drawer="${o.contact_id}" data-opp="${o.id}">${o.contact_name}</a>
      <span class="card-badges">${o.wa_conversation_id ? html`<a class="wa-badge ${o.wa_unread ? 'unread' : ''}" href="#/comunicacao/whatsapp/${o.wa_conversation_id}" title="Tem conversa no WhatsApp${o.wa_unread ? ` · ${o.wa_unread} não lida(s)` : ''}" aria-label="Abrir a conversa no WhatsApp">${icon('whatsapp', 14)}${o.wa_unread ? html`<b>${o.wa_unread}</b>` : ''}</a>` : ''}${o.stage_kind === 'aberta' ? tempBadge(o.temperature, o.temperature_info) : ''}<span class="badge pfpj" title="${o.contact_kind === 'PJ' ? 'Pessoa jurídica' : 'Pessoa física'}">${o.contact_kind === 'PJ' ? 'PJ' : 'PF'}</span></span></div>
    <div class="card-tags">${o.referred_by_name ? html`<span class="chip-sm ref-chip" title="Indicação de ${o.referred_by_name}">Indicação</span>` : ''}<span class="chip-sm area area-${o.business_area || 'consorcio'}" title="Área responsável">${optLabel('area_negocio', o.business_area || 'consorcio')}</span>${o.credit_category ? html`<span class="chip-sm muted">${optLabel('categoria_credito', o.credit_category)}</span>` : ''}</div>
    <div class="small card-origin" title="Origem e campanha">${optLabel('origem', o.contact_origin) || 'Sem origem'}${campaign ? html` · <span class="muted">${campaign}</span>` : ''}</div>
    <div class="card-metrics">
      <span class="deal-value" title="Valor estimado${o.deal_value_source === 'proposta' ? ' (maior proposta ativa)' : ''}">${o.deal_value ? fmtMoney(o.deal_value) : html`<span class="muted">Sem valor</span>`}</span>
      ${o.sla ? html`<span class="badge ${SLA_TONE[o.sla.level] || ''}" title="SLA da atividade">${o.sla.text}</span>` : ''}
      ${o.score != null ? html`<span class="score s-${scoreTone(o.score)}" title="Score do lead (0 a 100)">${o.score}</span>` : ''}
    </div>
    ${meetingTags(o)}
    <div class="small next ${late ? 'overdue' : ''}">${o.next_action ? html`▸ ${o.next_action} ${o.next_action_at ? html`<span>(${relTime(o.next_action_at)})</span>` : ''}` : html`<span class="warn-text">Sem próxima ação</span>`}</div>
    <div class="card-foot"><span class="small muted">${o.owner_name || '—'} · ${o.days_in_stage}d na etapa</span>${optoutBadge(o.contact_optouts)}${o.status === 'perdida' && o.lost_reason ? badge(optLabel('motivo_perda', o.lost_reason), 'muted') : ''}</div>
  </article>`;
}

function oppTable(rows) {
  return table(
    [
      { label: 'Cadastro', render: (o) => html`<a href="#/leads/${o.contact_id}" data-drawer="${o.contact_id}" data-opp="${o.id}">${o.contact_name}</a> ${o.status === 'aberta' ? tempBadge(o.temperature, o.temperature_info) : ''} ${optoutBadge(o.contact_optouts)}<br><small>${o.contact_code} · <a href="#/oportunidades/${o.id}">${o.code}</a></small>` },
      { label: 'Etapa', render: (o) => html`${o.stage_name}<br><small>${K('opp_status', o.status)}</small>` },
      { label: 'Área', render: (o) => optLabel('area_negocio', o.business_area || 'consorcio') },
      { label: 'Score', cls: 'num', render: (o) => (o.score != null ? o.score : '—') },
      { label: 'Origem', render: (o) => optLabel('origem', o.contact_origin) },
      { label: 'Categoria', render: (o) => optLabel('categoria_credito', o.credit_category) || '—' },
      { label: 'Valor', render: (o) => html`${fmtMoney(o.deal_value)}${o.deal_value ? html`<br><small>${o.deal_value_source === 'proposta' ? 'proposta' : 'desejado'}</small>` : ''}`, cls: 'num' },
      { label: 'Responsável', render: (o) => o.owner_name || '—' },
      { label: 'Próxima atividade', render: (o) => (o.next_action ? html`${o.next_action}<br><small>${fmtDateTime(o.next_action_at)}</small>` : html`<span class="warn-text">—</span>`) },
      { label: 'Entrada', render: (o) => fmtDate(o.contact_created_at) },
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
    loadCriteria();
  };
  // Critérios da próxima etapa (regras de passagem) e roteiro da etapa atual
  const loadCriteria = async () => {
    const box = $('#criteria', view);
    if (!box) return;
    const stage = state.meta.stages.find((s) => s.id === o.stage_id);
    try {
      const r = await get(`/api/oportunidades/${o.id}/criterios`);
      const next = r.next_stage;
      const ok = r.criteria.every((c) => c.ok);
      render(box, html`<div class="section-head"><h3>${next ? html`Para avançar para <strong>${next.name}</strong>` : 'Etapa final'}</h3>
          ${next && next.kind !== 'ganho' && can.write() ? html`<button class="btn ${ok ? 'primary' : ''}" data-act="advance" data-stage="${next.id}" ${ok ? '' : 'disabled'}>Avançar para ${next.name}</button>` : ''}</div>
        ${next?.kind === 'ganho' ? html`<p class="hint">A etapa Venda é preenchida automaticamente quando o pagamento é confirmado em <a href="#/vendas">Vendas</a> (aceite da proposta → pré-venda → boleto → pagamento).</p>` : ''}
        ${r.criteria.length ? html`<ul class="checklist">${r.criteria.map((c) => html`<li class="${c.ok ? 'ok' : ''}"><span class="mark">${c.ok ? '✓' : '○'}</span> <span class="grow"><strong>${c.label}</strong>${c.ok ? '' : html`<br><small class="muted">${c.hint}</small>`}</span></li>`)}</ul>` : next && next.kind !== 'ganho' ? html`<p class="muted small">Sem critérios obrigatórios para esta passagem.</p>` : ''}
        ${stage?.playbook ? html`<details ${ok ? '' : 'open'}><summary>Roteiro da etapa ${stage.name}</summary><p class="small">${stage.playbook}</p></details>` : ''}`);
    } catch (e) {
      render(box, html`<p class="warn-text small">${e.message}</p>`);
    }
  };
  const draw = () => {
    const kv = (label, v) => html`<div><span>${label}</span>${v ?? '—'}</div>`;
    render(view, html`<div class="page">
      <div class="page-head"><div>
        <div class="crumbs"><a href="#/funil">Pipeline</a> / <a href="#/leads/${o.contact_id}">${o.contact_name}</a> / ${o.code}</div>
        <h1>${o.code} ${o.title ? html`— ${o.title}` : ''} ${o.status === 'aberta' ? tempBadge(o.temperature, o.temperature_info) : ''}</h1>
        <div class="badges">${badge(o.stage_name, `kind-${o.stage_kind}`)} ${badge(K('opp_status', o.status), o.status === 'ganha' ? 'ok' : o.status === 'perdida' ? 'danger' : '')} ${badge(`Prioridade ${K('priorities', o.priority)}`)} ${optoutBadge(o.contact_optouts)} ${o.stalled ? badge(`Sem atividade há ${o.days_without_activity} dias`, 'danger') : ''}</div>
        <div class="muted small">Cadastro: <a href="#/leads/${o.contact_id}">${o.contact_code} — ${o.contact_name}</a> · Responsável: ${o.owner_name || '—'} · ${o.days_in_stage} dia(s) na etapa atual</div>
      </div>
      ${can.write() ? html`<div class="actions">
        <label class="inline">Mover para <select data-move-detail>${html`<option value="">—</option>`}${state.meta.stages.filter((s) => s.id !== o.stage_id).map((s) => html`<option value="${s.id}">${s.name}</option>`)}</select></label>
        ${o.status === 'aberta' && R1_STAGES.includes(o.stage_key) && !o.meetings?.r1 ? html`<button class="btn r1" data-act="r1-schedule">Agendar R1</button>` : ''}
        ${o.status === 'aberta' && o.stage_key === 'r1' && !o.meetings?.r2 ? html`<button class="btn r1" data-act="r2-schedule">Agendar R2</button>` : ''}
        <button class="btn" data-act="edit">Editar</button>
        <button class="btn primary" data-act="activity">Registrar atividade</button>
        <button class="btn" data-act="task">Nova tarefa</button>
      </div>` : ''}</div>
      <div class="next-action ${!o.next_action ? 'missing' : o.next_action_at && new Date(o.next_action_at) < new Date() ? 'late' : ''}"><span>Próxima ação:</span> ${o.next_action ? html`<strong>${o.next_action}</strong> ${o.next_action_at ? html`<small>${fmtDateTime(o.next_action_at)} · ${relTime(o.next_action_at)}</small>` : ''}` : html`<span class="warn-text">Nenhuma próxima ação definida</span>`}</div>
      ${o.status === 'perdida' ? html`<div class="alert danger">Perdida: ${optLabel('motivo_perda', o.lost_reason)}${o.lost_notes ? ` — ${o.lost_notes}` : ''}</div>` : ''}
      ${o.status === 'pausada' && o.pause_reason ? html`<div class="alert warn">Em nutrição: ${o.pause_reason}</div>` : ''}
      ${o.status === 'aberta' ? html`<section class="card criteria-card" id="criteria"><p class="muted small">Carregando critérios da próxima etapa…</p></section>` : ''}
      <section class="card"><div class="section-head"><h3>Qualificação do negócio</h3>${can.write() ? html`<span class="inline-actions"><button class="btn small" data-act="r1">Anexar transcrição da R1</button><button class="btn small" data-act="edit">Editar qualificação</button></span>` : ''}</div>
        ${tempPanel(o)}
        ${qualProgress(o, contact.kind)}
        ${qualBlocks(o, contact.kind, { extra: { strategy: o.strategy ? html`${optLabel('estrategia', o.strategy)} ${o.strategy_validated_at ? badge(`validada por ${o.strategy_validated_by_name} em ${fmtDate(o.strategy_validated_at)}`, 'ok') : html`${badge('não validada pelo consultor', 'warn')} ${can.write() ? html`<button class="btn small" data-act="validate">Validar</button>` : ''}`}` : null } })}
        ${o.transcripts?.length ? html`<div class="r1-list"><strong class="small">Transcrições da R1</strong><ul>${o.transcripts.map((t) => html`<li><small>${t.filename || 'Transcrição'} · ${fmtDateTime(t.created_at)} · ${t.user_name || '—'} · ${t.fields} campo(s) identificados${t.applied ? `, ${t.applied} preenchido(s)` : ', nenhum aplicado'}</small></li>`)}</ul></div>` : html`<p class="hint">Depois da R1, anexe a transcrição da reunião: o CRM identifica os campos e completa só os que estão vazios. <a href="#" data-act="r1-template">Modelo da transcrição (Excel)</a></p>`}
      </section>
      <div class="cols">
        <section class="card"><h3>Dados de gestão</h3><div class="kv">
          ${kv('Prioridade no funil', K('priorities', o.priority))}${kv('Responsável', o.owner_name)}
          <div class="full"><span>Objetivo nas palavras do cliente</span>${o.objective || '—'}</div>
          <div class="full"><span>Critério de qualificação</span>${o.qualification_criteria || '—'}</div>
          ${Object.entries(o.custom || {}).map(([k, v]) => kv(state.meta.custom_fields.find((f) => f.key === k && f.entity === 'opportunity')?.label || k, String(v)))}
        </div></section>
        <section class="card"><h3>Histórico de etapas</h3>
          <ol class="stage-history">${o.stage_history.map((h) => html`<li><strong>${h.to_stage_name}</strong> <small class="muted">${fmtDateTime(h.moved_at)} · ${h.user_name || 'Sistema'}${h.from_stage_name ? ` · vindo de "${h.from_stage_name}" após ${Math.round((h.seconds_in_previous || 0) / 86400)} dia(s)` : ''}</small>${h.reason ? html`<div class="small">${h.reason}</div>` : ''}</li>`)}</ol>
        </section>
      </div>
      <section class="card">
        <div class="section-head"><h3>Simulações</h3>${can.write() ? html`<button class="btn primary" data-act="sim-quick">Gerar simulação</button>` : ''}</div>
        ${table(
          [
            { label: 'Código', render: (s) => (s.source === 'crm' ? html`<strong>${s.code}</strong>` : html`<a href="#" data-sim="${s.id}">${s.code}</a>`) },
            { label: 'Data e hora', render: (s) => fmtDateTime(s.created_at) },
            { label: 'Gerada por', render: (s) => s.user_name || (s.source === 'simulador' ? 'Simulador' : '—') },
            { label: 'Valores', render: (s) => (s.credit_value != null ? html`${fmtMoney(s.credit_value)}${s.term_months ? ` · ${s.term_months} m` : ''}` : html`<span class="muted small">no simulador</span>`) },
          ],
          o.simulations,
          { emptyMsg: 'Nenhuma simulação.' },
        )}
      </section>
      <section class="card">
        <div class="section-head"><h3>Propostas</h3>${can.write() ? html`<span class="inline-actions"><button class="btn primary" data-act="proposal-sim">Gerar proposta</button><button class="btn" data-act="prop-new">Registrar proposta gerada</button></span>` : ''}</div>
        ${table(
          [
            { label: 'Código', render: (p) => html`<a href="#" data-prop="${p.id}">${String(p.code).replace(/-v\d+$/, '')}</a> v${p.version}` },
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
  on(view, 'click', '[data-act=advance]', async (e, b) => (await moveStage(o, b.dataset.stage)) && reload());
  on(view, 'change', '[data-move-detail]', async (e, sel) => {
    if (!sel.value) return;
    const r = await moveStage(o, sel.value);
    sel.value = '';
    if (r) reload();
  });
  on(view, 'click', '[data-act=edit]', async () => (await opportunityForm(contact, o)) && reload());
  on(view, 'click', '[data-act=r1]', async () => (await transcriptFlow(o)) && reload());
  on(view, 'click', '[data-act=r1-schedule]', async () => (await scheduleMeetingDialog({ contactId: o.contact_id, oppId: o.id, kind: 'r1', moveTo: true })) && reload());
  on(view, 'click', '[data-act=r2-schedule]', async () => (await scheduleMeetingDialog({ contactId: o.contact_id, oppId: o.id, kind: 'r2', moveTo: true })) && reload());
  on(view, 'click', '[data-act=r1-template]', (e) => (e.preventDefault(), downloadR1Template()));
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
  on(view, 'click', '[data-act=sim-quick]', async () => (await quickSimulation(o.contact_id, o.id)) && reload());
  on(view, 'click', '[data-act=proposal-sim]', async () => (await openProposalSimulator(contact, o.id)) && setTimeout(reload, 300));
  on(view, 'click', '[data-sim]:not([data-act])', async (e, a) => {
    e.preventDefault();
    const s = await get(`/api/simulacoes/${a.dataset.sim}`);
    if (await simulationForm(contact, { simulation: s })) reload();
  });
  on(view, 'click', '[data-act=prop-new]', async () => (await proposalForm(o, o.simulations)) && reload());
  on(view, 'click', '[data-prop]', (e, a) => {
    e.preventDefault();
    proposalDetail(a.dataset.prop, reload);
  });
  await reload();
}

/**
 * Funil de perdidos (líder e administrador): espelho do funil comercial, sem Venda. Cada coluna mostra os leads perdidos
 * naquela etapa e os motivos (MP) mais frequentes.
 */
function lostBoardView(r) {
  const max = Math.max(1, ...r.stages.map((s) => s.count));
  return html`<div class="lost-wrap">
    <div class="lost-summary"><div><small>Perdidos no período</small><strong>${r.total}</strong><small>desde ${fmtDate(r.from)}</small></div>
      <div class="lost-reasons">${r.reasons.length ? r.reasons.slice(0, 9).map((x) => html`<span class="mp-chip"><strong>${x.n}</strong> ${x.label}</span>`) : html`<span class="muted small">Nenhuma perda no período.</span>`}</div></div>
    <div class="kanban lost-board">${r.stages.map((s) => html`<section class="column kind-perdido-col">
      <header><strong>${s.name}</strong><span class="count">${s.count}</span>${s.total_value ? html`<small class="muted">${fmtMoney(s.total_value)}</small>` : ''}</header>
      <div class="lost-bar"><span style="width:${Math.round((s.count / max) * 100)}%"></span></div>
      ${s.reasons.length ? html`<ul class="lost-mp">${s.reasons.map((x) => html`<li><span>${x.label}</span><strong>${x.n}</strong></li>`)}</ul>` : ''}
      <div class="cards">${s.cards.length ? s.cards.map((o) => html`<article class="opp-card lost-card"><a href="#/leads/${o.contact_id}" data-drawer="${o.contact_id}" data-opp="${o.id}"><strong>${o.contact_name}</strong></a>
        <small class="muted">${o.code} · ${o.owner_name || 'sem responsável'}</small>
        <div class="badges"><span class="badge danger">${optLabel('motivo_perda', o.lost_reason) || 'Sem motivo'}</span>${o.deal_value ? html` <small>${fmtMoney(o.deal_value)}</small>` : ''}</div>
        ${o.lost_notes ? html`<p class="small">${o.lost_notes}</p>` : ''}<small class="muted">Perdido em ${fmtDate(o.closed_at)}</small></article>`) : html`<p class="muted small empty-col">Nenhuma perda nesta etapa.</p>`}</div>
    </section>`)}</div></div>`;
}
