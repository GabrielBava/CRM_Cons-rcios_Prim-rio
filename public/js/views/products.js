import { get, post } from '../api.js';
import { html, render, on, state, table, badge, field, modal, opts, optLabel, can, toast } from '../ui.js';
import { optionListCard, bindOptionList, refreshMeta } from './settings.js';

export async function show(view) {
  const load = async () => {
    const products = await get('/api/produtos');
    render(view, html`<div class="page">
      <div class="page-head"><h1>Produtos e estratégias</h1>${can.manage() ? html`<div class="actions"><button class="btn primary" data-act="new">+ Novo produto</button></div>` : ''}</div>
      <section class="card"><h3>Produtos</h3>
        <p class="hint">Cadastre os produtos/planos comercializados. Não há condições comerciais pré-definidas: taxas e prazos são registrados em cada proposta.</p>
        ${table(
          [
            { label: 'Produto', render: (p) => html`<strong>${p.name}</strong>${!p.active ? html` ${badge('Inativo', 'muted')}` : ''}${p.description ? html`<br><small class="muted">${p.description}</small>` : ''}` },
            { label: 'Categoria', render: (p) => optLabel('categoria_credito', p.category) },
            { label: 'Administradora', render: (p) => p.administrator || '—' },
            { label: 'Oportunidades', key: 'opportunities', cls: 'num' },
            { label: 'Contratos', key: 'contracts', cls: 'num' },
            { label: '', render: (p) => (can.manage() ? html`<button class="btn small" data-edit="${p.id}">Editar</button>` : '') },
          ],
          products,
        )}
      </section>
      <div class="cols">
        ${optionListCard('estrategia', 'Estratégias', 'Estratégias são registradas nas oportunidades e propostas; só valem como recomendação após validação do consultor.')}
        ${optionListCard('categoria_credito', 'Categorias de crédito')}
        ${optionListCard('modalidade_pagamento', 'Modalidades de pagamento')}
        ${optionListCard('tipo_contemplacao', 'Tipos de contemplação')}
      </div></div>`);
    view._products = products;
  };
  const form = (p = {}) =>
    modal({
      title: p.id ? `Editar ${p.name}` : 'Novo produto',
      body: html`<div class="grid">
        ${field({ name: 'name', label: 'Nome', value: p.name, required: true, full: true })}
        ${field({ name: 'category', label: 'Categoria', type: 'select', options: opts('categoria_credito'), value: p.category })}
        ${field({ name: 'administrator', label: 'Administradora', value: p.administrator })}
        ${field({ name: 'description', label: 'Descrição', type: 'textarea', value: p.description, full: true })}
        ${p.id ? field({ name: 'active', label: 'Ativo', type: 'checkbox', value: p.active }) : ''}
      </div>`,
      async onSubmit(d) {
        await post('/api/produtos', { ...d, id: p.id });
        toast('Produto salvo.');
        await refreshMeta();
        return true;
      },
    });
  on(view, 'click', '[data-act=new]', async () => (await form()) && load());
  on(view, 'click', '[data-edit]', async (e, b) => (await form(view._products.find((p) => p.id === Number(b.dataset.edit)))) && load());
  bindOptionList(view, load);
  await load();
}
