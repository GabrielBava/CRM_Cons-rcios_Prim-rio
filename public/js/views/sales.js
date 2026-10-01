import { get, download } from '../api.js';
import { html, render, $, $$, on, fresh, state, selectOptions, userItems, productItems, toItems, table, pager, badge, fmtMoney, fmtDate, fmtDateTime, optLabel, K, toastError, PERIODS, periodRange, can } from '../ui.js';
import { proposalDetail, simulationForm } from '../forms.js';

export async function show(view, { params }) {
  let tab = params.aba || 'propostas';
  render(view, html`<div class="page">
    <div class="page-head"><h1>Simulações e propostas</h1></div>
    <div class="alert ${state.meta.simulator.available ? '' : 'warn'}">Simulador: ${state.meta.simulator.message} Para criar uma simulação, abra o cadastro do lead ou a oportunidade.</div>
    <nav class="tabs"><a href="#" data-tab="propostas" class="${tab === 'propostas' ? 'active' : ''}">Propostas</a><a href="#" data-tab="simulacoes" class="${tab === 'simulacoes' ? 'active' : ''}">Simulações</a></nav>
    <div id="tab"></div></div>`);
  const draw = () => (tab === 'propostas' ? proposals : simulations)(fresh($('#tab', view)));
  on(view, 'click', '[data-tab]', (e, a) => {
    e.preventDefault();
    tab = a.dataset.tab;
    $$('[data-tab]', view).forEach((x) => x.classList.toggle('active', x === a));
    draw();
  });
  draw();
}

function periodFields(p = '90d') {
  return html`<label>Período de criação<select name="period">${selectOptions(PERIODS, p, { allowEmpty: false })}</select></label>
    <label class="custom-range" hidden>De<input type="date" name="cfrom"></label><label class="custom-range" hidden>Até<input type="date" name="cto"></label>`;
}
function readPeriod(form) {
  const d = Object.fromEntries(new FormData(form).entries());
  $$('.custom-range', form).forEach((el) => (el.hidden = d.period !== 'custom'));
  const { period, cfrom, cto, ...rest } = d;
  return { ...periodRange(period, { from: cfrom, to: cto }), ...rest };
}

function proposals(box) {
  render(box, html`<form class="filters" data-f>
      ${periodFields()}
      <label>Status<select name="status">${selectOptions(toItems(state.meta.constants.proposal_status), '', { placeholder: 'Todos' })}</select></label>
      <label>Responsável<select name="owner_id">${selectOptions(userItems(), '', { placeholder: 'Todos' })}</select></label>
      <label>Produto<select name="product_id">${selectOptions(productItems(), '', { placeholder: 'Todos' })}</select></label>
      <label class="check"><input type="checkbox" name="current" value="1" checked> Ocultar versões substituídas</label>
      ${can.admin() ? html`<button type="button" class="btn" data-act="export">Exportar CSV</button>` : ''}
    </form><div id="list"></div>`);
  const form = $('[data-f]', box);
  let page = 1;
  const load = async () => {
    try {
      const r = await get('/api/propostas', { ...readPeriod(form), page, limit: 50 });
      render($('#list', box), html`<section class="card">${table(
        [
          { label: 'Código', render: (p) => html`<a href="#" data-prop="${p.id}">${p.code}</a> <small>v${p.version}</small>` },
          { label: 'Cadastro', render: (p) => html`<a href="#/leads/${p.contact_id}">${p.contact_name}</a>` },
          { label: 'Oportunidade', render: (p) => html`<a href="#/oportunidades/${p.opportunity_id}">${p.opportunity_code}</a>` },
          { label: 'Produto', render: (p) => p.product_name || '—' },
          { label: 'Crédito', render: (p) => fmtMoney(p.credit_value), cls: 'num' },
          { label: 'Prazo', render: (p) => (p.term_months ? `${p.term_months} m` : '—') },
          { label: 'Parcela inicial', render: (p) => fmtMoney(p.initial_installment), cls: 'num' },
          { label: 'Status', render: (p) => badge(K('proposal_status', p.status), `st-${p.status}`) },
          { label: 'Validade', render: (p) => fmtDate(p.valid_until) },
          { label: 'Responsável', render: (p) => p.owner_name || '—' },
          { label: 'Criada', render: (p) => fmtDateTime(p.created_at) },
        ],
        r.rows,
        { emptyMsg: 'Nenhuma proposta no período.' },
      )}${pager(r.total, r.page, r.limit)}</section>`);
    } catch (e) {
      toastError(e);
    }
  };
  form.addEventListener('change', () => ((page = 1), load()));
  on(box, 'click', '[data-page]', (e, b) => ((page = Number(b.dataset.page)), load()));
  on(box, 'click', '[data-prop]', (e, a) => {
    e.preventDefault();
    proposalDetail(a.dataset.prop, load);
  });
  on(box, 'click', '[data-act=export]', () => download('/api/exportar/propostas', readPeriod(form)).catch(toastError));
  load();
}

function simulations(box) {
  render(box, html`<form class="filters" data-f>
      ${periodFields()}
      <label>Status<select name="status">${selectOptions(toItems(state.meta.constants.simulation_status), '', { placeholder: 'Todos' })}</select></label>
      <label>Origem<select name="source">${selectOptions([{ value: 'simulador', label: 'Simulador' }, { value: 'manual', label: 'Manual' }], '', { placeholder: 'Todas' })}</select></label>
      <label>Usuário<select name="user_id">${selectOptions(userItems(), '', { placeholder: 'Todos' })}</select></label>
      ${can.admin() ? html`<button type="button" class="btn" data-act="export">Exportar CSV</button>` : ''}
    </form><div id="list"></div>`);
  const form = $('[data-f]', box);
  let page = 1;
  const load = async () => {
    try {
      const r = await get('/api/simulacoes', { ...readPeriod(form), page, limit: 50 });
      render($('#list', box), html`<section class="card">${table(
        [
          { label: 'Código', render: (s) => html`<a href="#" data-sim="${s.id}" data-contact="${s.contact_id}">${s.code}</a> <small>v${s.version}</small>` },
          { label: 'Origem', render: (s) => (s.source === 'simulador' ? badge('Simulador', 'ok') : badge('Manual')) },
          { label: 'Cadastro', render: (s) => html`<a href="#/leads/${s.contact_id}">${s.contact_name}</a>` },
          { label: 'Oportunidade', render: (s) => (s.opportunity_id ? html`<a href="#/oportunidades/${s.opportunity_id}">${s.opportunity_code}</a>` : '—') },
          { label: 'Crédito', render: (s) => fmtMoney(s.credit_value), cls: 'num' },
          { label: 'Prazo', render: (s) => (s.term_months ? `${s.term_months} m` : '—') },
          { label: 'Parcela', render: (s) => fmtMoney(s.installment), cls: 'num' },
          { label: 'Estratégia', render: (s) => optLabel('estrategia', s.strategy) },
          { label: 'Status', render: (s) => K('simulation_status', s.status) },
          { label: 'Usuário', render: (s) => s.user_name || '—' },
          { label: 'Data', render: (s) => fmtDateTime(s.created_at) },
          { label: '', render: (s) => (s.view_url ? html`<a href="${s.view_url}" target="_blank" rel="noopener noreferrer">consultar</a>` : '') },
        ],
        r.rows,
        { emptyMsg: 'Nenhuma simulação no período.' },
      )}${pager(r.total, r.page, r.limit)}</section>`);
    } catch (e) {
      toastError(e);
    }
  };
  form.addEventListener('change', () => ((page = 1), load()));
  on(box, 'click', '[data-page]', (e, b) => ((page = Number(b.dataset.page)), load()));
  on(box, 'click', '[data-sim]', async (e, a) => {
    e.preventDefault();
    try {
      const [s, c] = await Promise.all([get(`/api/simulacoes/${a.dataset.sim}`), get(`/api/cadastros/${a.dataset.contact}`)]);
      if (await simulationForm(c, { simulation: s })) load();
    } catch (ex) {
      toastError(ex);
    }
  });
  on(box, 'click', '[data-act=export]', () => download('/api/exportar/simulacoes', readPeriod(form)).catch(toastError));
  load();
}
