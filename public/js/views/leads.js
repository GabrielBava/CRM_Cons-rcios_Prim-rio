import { get, download } from '../api.js';
import {
  html, render, $, on, state, selectOptions, opts, toItems, userItems, stageItems, productItems, table, pager, relBadge, badge, optoutBadge,
  fmtDateTime, relTime, optLabel, K, can, toastError,
} from '../ui.js';
import { quickCreateContact } from '../forms.js';

let saved = { sort: 'recentes' };

export function nextActionCell(na) {
  if (!na) return html`<span class="warn-text small">Sem próxima ação</span>`;
  const late = na.due_at && new Date(na.due_at) < new Date();
  return html`<div class="${late ? 'overdue' : ''}"><strong>${na.title}</strong><br><small>${na.due_at ? `${fmtDateTime(na.due_at)} · ${relTime(na.due_at)}` : 'sem data'}</small></div>`;
}

export function contactsTable(rows) {
  return table(
    [
      { label: 'Código', render: (r) => html`<a href="#/leads/${r.id}">${r.code}</a>` },
      {
        label: 'Nome',
        render: (r) => html`<a href="#/leads/${r.id}"><strong>${r.name}</strong></a> <small class="muted">${r.kind}</small><br>${relBadge(r.relationship)} ${r.relationship !== 'cliente' ? badge(K('lead_status', r.lead_status)) : badge(K('client_status', r.client_status), 'ok')} ${optoutBadge(r.optouts)}`,
      },
      { label: 'Contato', render: (r) => html`${r.phone1 || r.whatsapp || html`<span class="warn-text">sem telefone</span>`}<br><small>${r.email || ''}</small>` },
      { label: 'Cidade/UF', render: (r) => [r.city, r.state].filter(Boolean).join('/') || '—' },
      { label: 'Origem', render: (r) => html`${optLabel('origem', r.origin)}${r.campaign ? html`<br><small>${r.campaign}</small>` : ''}` },
      { label: 'Responsável', render: (r) => r.owner_name || html`<span class="warn-text">sem responsável</span>` },
      { label: 'Próxima ação', render: (r) => nextActionCell(r.next_action) },
      { label: 'Última atividade', render: (r) => (r.last_activity_at ? relTime(r.last_activity_at) : html`<span class="warn-text">nenhuma</span>`) },
    ],
    rows,
    { emptyMsg: 'Nenhum cadastro encontrado com esses filtros.' },
  );
}

export async function show(view, { params }, preset = {}) {
  const fixed = preset.relationship;
  const s = { ...saved, ...params, ...preset };
  render(view, html`<div class="page">
    <div class="page-head">
      <h1>${preset.title || 'Prospects e leads'}</h1>
      <div class="actions">
        ${can.write() && !fixed ? html`<button class="btn primary" data-act="new">+ Novo lead</button><a class="btn" href="#/importar">Importar CSV</a>` : ''}
        ${state.user.role !== 'leitura' ? html`<button class="btn" data-act="export">Exportar CSV</button>` : ''}
        ${state.user.role !== 'leitura' && !fixed ? html`<button class="btn" data-act="export-dialer" title="Exclui automaticamente quem se opôs a ligações">Lista para discadora</button>` : ''}
      </div>
    </div>
    <form class="filters" data-f>
      <label class="grow">Buscar<input type="search" name="q" value="${s.q || ''}" placeholder="Nome, telefone, e-mail, CPF/CNPJ ou código"></label>
      ${fixed ? '' : html`<label>Tipo de registro<select name="relationship">${selectOptions(toItems(state.meta.constants.relationships), s.relationship, { placeholder: 'Todos' })}</select></label>`}
      ${fixed ? html`<label>Status do cliente<select name="client_status">${selectOptions(toItems(state.meta.constants.client_status), s.client_status, { placeholder: 'Todos' })}</select></label>`
        : html`<label>Status do lead<select name="lead_status">${selectOptions(toItems(state.meta.constants.lead_status), s.lead_status, { placeholder: 'Todos' })}</select></label>`}
      <label>PF/PJ<select name="kind">${selectOptions([{ value: 'PF', label: 'Pessoa física' }, { value: 'PJ', label: 'Pessoa jurídica' }], s.kind, { placeholder: 'Todos' })}</select></label>
      <label>Responsável<select name="owner_id">${selectOptions([...userItems(), ...(can.manage() ? [{ value: 'none', label: 'Sem responsável' }] : [])], s.owner_id, { placeholder: 'Todos' })}</select></label>
      <label>Origem<select name="origin">${selectOptions(opts('origem'), s.origin, { placeholder: 'Todas' })}</select></label>
      <label>Campanha<input name="campaign" value="${s.campaign || ''}" placeholder="nome ou ID"></label>
      <label>Etapa<select name="stage_id">${selectOptions(stageItems(), s.stage_id, { placeholder: 'Todas' })}</select></label>
      <label>Produto<select name="product_id">${selectOptions(productItems(), s.product_id, { placeholder: 'Todos' })}</select></label>
      <label>Ordenar<select name="sort">${selectOptions([{ value: 'recentes', label: 'Mais recentes' }, { value: 'antigos', label: 'Mais antigos' }, { value: 'nome', label: 'Nome' }, { value: 'atualizados', label: 'Atualizados recentemente' }], s.sort, { allowEmpty: false })}</select></label>
      <label class="check"><input type="checkbox" name="no_attempt" value="1" ${s.no_attempt === '1' ? 'checked' : ''}> Sem tentativa de contato</label>
      <label class="check"><input type="checkbox" name="incomplete" value="1" ${s.incomplete === '1' ? 'checked' : ''}> Cadastro incompleto</label>
      <label class="check"><input type="checkbox" name="do_not_contact" value="1" ${s.do_not_contact === '1' ? 'checked' : ''}> Com restrição de contato</label>
    </form>
    <div id="list"></div>
  </div>`);
  const form = $('[data-f]', view);
  let page = 1;
  const query = () => {
    const d = Object.fromEntries(new FormData(form).entries());
    if (!fixed) saved = { ...d };
    return { ...d, ...(fixed ? { relationship: fixed } : {}), page, limit: 50 };
  };
  const load = async () => {
    const box = $('#list', view);
    box.classList.add('loading');
    try {
      const r = await get('/api/cadastros', query());
      render(box, html`${contactsTable(r.rows)}${pager(r.total, r.page, r.limit)}`);
    } catch (e) {
      toastError(e);
    } finally {
      box.classList.remove('loading');
    }
  };
  let t;
  form.addEventListener('input', (e) => {
    if (e.target.name !== 'q' && e.target.name !== 'campaign') return;
    clearTimeout(t);
    t = setTimeout(() => ((page = 1), load()), 300);
  });
  form.addEventListener('change', (e) => {
    if (e.target.name === 'q' || e.target.name === 'campaign') return;
    page = 1;
    load();
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  on(view, 'click', '[data-page]', (e, b) => {
    page = Number(b.dataset.page);
    load();
  });
  on(view, 'click', '[data-act=new]', () => quickCreateContact());
  on(view, 'click', '[data-act=export]', () => download('/api/exportar/cadastros', { ...query(), page: undefined, limit: undefined }).catch(toastError));
  on(view, 'click', '[data-act=export-dialer]', () => download('/api/exportar/lista_discadora', { ...query(), page: undefined, limit: undefined }).catch(toastError));
  await load();
}
