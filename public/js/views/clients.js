// 7. Clientes: lista com código, situação, contato, responsáveis, cartas, crédito, próxima ação e última atividade.
import { get, download } from '../api.js';
import { html, render, $, $$, on, fresh, state, selectOptions, opts, productItems, userItems, pager, toastError, can, table, badge, fmtMoney, fmtDateTime, relTime, K } from '../ui.js';
import { contractForm } from '../forms.js';
import { contractsTable } from './contact.js';
import { bindDrawerLinks } from '../drawer.js';

let saved = { active: '1' };
const CATEGORY_FILTER = [
  { value: 'so_imovel', label: 'Somente imóvel' },
  { value: 'so_veiculo', label: 'Somente veículo' },
  { value: 'so_servico', label: 'Somente serviço' },
  { value: 'ambas', label: 'Mais de uma (ex.: imóvel e veículo)' },
];

async function clientList(box) {
  const manager = can.manage();
  render(box, html`<div class="page-head"><div><h1>Clientes</h1><p class="muted">${manager ? 'Clientes de toda a sua visão.' : 'Seus clientes.'} Clique no nome para ver o resumo sem sair da lista.</p></div>
      ${can.admin() ? html`<div class="actions"><button class="btn" data-act="export">Exportar CSV</button></div>` : ''}</div>
    <form class="filters" data-f>
      <label class="grow">Buscar<input type="search" name="q" value="${saved.q || ''}" placeholder="Nome, código (C-…), telefone, e-mail ou CPF/CNPJ"></label>
      <label>Situação<select name="active">${selectOptions([{ value: '1', label: 'Ativo' }, { value: '0', label: 'Inativo' }], saved.active, { placeholder: 'Todas' })}</select></label>
      <label>PF/PJ<select name="kind">${selectOptions([{ value: 'PF', label: 'PF' }, { value: 'PJ', label: 'PJ' }], saved.kind, { placeholder: 'Todos' })}</select></label>
      ${manager ? html`<label>Responsável pós-venda<select name="postsale_owner_id">${selectOptions(userItems(), saved.postsale_owner_id, { placeholder: 'Todos' })}</select></label>
        <label>Especialista<select name="seller_id">${selectOptions(userItems(), saved.seller_id, { placeholder: 'Todos' })}</select></label>` : ''}
      <label>Categoria<select name="category">${selectOptions(CATEGORY_FILTER, saved.category, { placeholder: 'Todas' })}</select></label>
    </form><div id="list"></div>`);
  const form = $('[data-f]', box);
  let page = 1;
  const load = async () => {
    saved = Object.fromEntries(new FormData(form).entries());
    try {
      const r = await get('/api/clientes', { ...saved, page, limit: 50 });
      render($('#list', box), html`<section class="card">${table(
        [
          { label: 'Código', render: (c) => html`<a href="#/clientes/${c.id}">${c.code}</a>`, cls: 'nowrap' },
          { label: 'Nome', render: (c) => html`<a href="#/clientes/${c.id}" data-drawer="${c.id}"><strong>${c.name}</strong></a> <small class="muted">${c.kind}</small>` },
          { label: 'Situação', render: (c) => (c.active ? badge('Ativo', 'ok') : badge('Inativo', 'muted')) },
          { label: 'Contato', render: (c) => html`${c.whatsapp || c.phone1 || '—'}${c.email ? html`<br><small>${c.email}</small>` : ''}` },
          { label: 'Resp. pós-venda', render: (c) => c.postsale_name || '—' },
          { label: 'Especialista da venda', render: (c) => c.seller_name || '—' },
          { label: 'Cartas', render: (c) => html`${c.cartas}${c.categories.length ? html`<br><small>${c.categories.map((k) => opts('categoria_credito', { all: true }).find((o) => o.value === k)?.label || k).join(' + ')}</small>` : ''}`, cls: 'num' },
          { label: 'Crédito contratado', render: (c) => fmtMoney(c.credit_total), cls: 'num' },
          { label: 'Próxima ação', render: (c) => (c.next_action ? html`<span class="${new Date(c.next_action.due_at) < new Date() ? 'overdue' : ''}">${c.next_action.title}</span><br><small>${fmtDateTime(c.next_action.due_at)}</small>` : html`<span class="warn-text small">Sem próxima ação</span>`) },
          { label: 'Última atividade', render: (c) => (c.last_activity ? html`${K('activity_types', c.last_activity.type)}<br><small>${relTime(c.last_activity.at)}</small>` : '—') },
        ],
        r.rows,
        { emptyMsg: 'Nenhum cliente com esses filtros. Clientes entram aqui quando o pagamento da venda é confirmado.' },
      )}${pager(r.total, r.page, r.limit)}</section>`);
    } catch (e) {
      toastError(e);
    }
  };
  let t;
  form.addEventListener('input', (e) => {
    if (e.target.name !== 'q') return;
    clearTimeout(t);
    t = setTimeout(() => ((page = 1), load()), 300);
  });
  form.addEventListener('change', (e) => e.target.name !== 'q' && ((page = 1), load()));
  form.addEventListener('submit', (e) => e.preventDefault());
  on(box, 'click', '[data-page]', (e, b) => ((page = Number(b.dataset.page)), load()));
  on(box, 'click', '[data-act=export]', () => download('/api/exportar/cadastros', { relationship: 'cliente' }).catch(toastError));
  bindDrawerLinks(box);
  await load();
}

export async function show(view, ctx) {
  let tab = ctx.params.aba || 'clientes';
  render(view, html`<div class="page">
    <nav class="tabs"><a href="#" data-tab="clientes" class="${tab === 'clientes' ? 'active' : ''}">Clientes</a><a href="#" data-tab="contratos" class="${tab === 'contratos' ? 'active' : ''}">Produtos contratados</a></nav>
    <div id="tab"></div></div>`);
  const draw = () => {
    const box = fresh($('#tab', view));
    if (tab === 'clientes') return clientList(box);
    return contracts(box);
  };
  on(view, 'click', '[data-tab]', (e, a) => {
    e.preventDefault();
    tab = a.dataset.tab;
    $$('[data-tab]', view).forEach((x) => x.classList.toggle('active', x === a));
    draw();
  });
  await draw();
}

async function contracts(box) {
  render(box, html`<div class="page-head"><h1>Produtos contratados</h1>${can.admin() ? html`<div class="actions"><button class="btn" data-act="export">Exportar CSV</button></div>` : ''}</div>
    <p class="hint">Um cliente pode ter vários produtos contratados. Eles são lançados somente na conclusão da venda (funil › Venda concluída).</p>
    <form class="filters" data-f>
      <label>Status<select name="status">${selectOptions(opts('status_contrato'), '', { placeholder: 'Todos' })}</select></label>
      <label>Produto<select name="product_id">${selectOptions(productItems(), '', { placeholder: 'Todos' })}</select></label>
      <label>Responsável<select name="owner_id">${selectOptions(userItems(), '', { placeholder: 'Todos' })}</select></label>
    </form><div id="list"></div>`);
  const form = $('[data-f]', box);
  let page = 1;
  let rows = [];
  const load = async () => {
    try {
      const r = await get('/api/contratos', { ...Object.fromEntries(new FormData(form).entries()), page, limit: 50 });
      rows = r.rows;
      render($('#list', box), html`<section class="card">${contractsTable(rows, { showContact: true })}${pager(r.total, r.page, r.limit)}</section>`);
    } catch (e) {
      toastError(e);
    }
  };
  form.addEventListener('change', () => ((page = 1), load()));
  on(box, 'click', '[data-page]', (e, b) => ((page = Number(b.dataset.page)), load()));
  on(box, 'click', '[data-contract]', async (e, a) => {
    e.preventDefault();
    if (!can.write()) return;
    const k = rows.find((x) => x.id === Number(a.dataset.contract));
    const c = await get(`/api/cadastros/${k.contact_id}`);
    if (await contractForm(c, k)) load();
  });
  on(box, 'click', '[data-act=export]', () => download('/api/exportar/contratos', Object.fromEntries(new FormData(form).entries())).catch(toastError));
  load();
}
