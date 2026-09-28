import { get, download } from '../api.js';
import { html, render, $, $$, on, fresh, state, selectOptions, opts, productItems, userItems, pager, toastError, can } from '../ui.js';
import { contractForm } from '../forms.js';
import * as leads from './leads.js';
import { contractsTable } from './contact.js';

export async function show(view, ctx) {
  let tab = ctx.params.aba || 'clientes';
  render(view, html`<div class="page">
    <nav class="tabs"><a href="#" data-tab="clientes" class="${tab === 'clientes' ? 'active' : ''}">Clientes</a><a href="#" data-tab="contratos" class="${tab === 'contratos' ? 'active' : ''}">Produtos contratados</a></nav>
    <div id="tab"></div></div>`);
  const draw = () => {
    const box = fresh($('#tab', view));
    if (tab === 'clientes') return leads.show(box, { params: ctx.params }, { relationship: 'cliente', title: 'Clientes' });
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
  render(box, html`<div class="page-head"><h1>Produtos contratados</h1>${state.user.role !== 'leitura' ? html`<div class="actions"><button class="btn" data-act="export">Exportar CSV</button></div>` : ''}</div>
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
