// Módulo Financeiro (ERP): acompanhamento de parcelas e pagamentos de todos os clientes.
import { get, download } from '../api.js';
import { html, render, $, $$, on, state, selectOptions, userItems, pager, fmtMoney, toastError, PERIODS, periodRange } from '../ui.js';
import { entriesTable, bindEntries } from './record-tabs.js';

let saved = { status: 'atrasado', period: '' };

export async function show(view) {
  render(view, html`<div class="page">
    <div class="page-head"><h1>Financeiro</h1>${state.user.role !== 'leitura' ? html`<div class="actions"><button class="btn" data-act="export">Exportar CSV</button></div>` : ''}</div>
    <p class="hint">Parcelas e valores que os clientes pagam à administradora, acompanhados pela equipe. Lançamentos vencidos e não pagos aparecem como "Em atraso" e geram tarefa para o responsável financeiro definido em Configurações › Geral. Para lançar ou gerar parcelas, abra a aba Financeiro do cliente.</p>
    <div id="kpis"></div>
    <form class="filters" data-f>
      <label>Situação<select name="status">${selectOptions([
        { value: 'atrasado', label: 'Em atraso' },
        { value: 'a_vencer', label: 'A vencer' },
        { value: 'pago', label: 'Pagos' },
        { value: 'negociado', label: 'Negociados' },
        { value: 'cancelado', label: 'Cancelados' },
      ], saved.status, { placeholder: 'Todas' })}</select></label>
      <label>Vencimento<select name="period">${selectOptions(PERIODS.filter((p) => p.value !== 'hoje'), saved.period, { placeholder: 'Qualquer data' })}</select></label>
      <label class="custom-range" hidden>De<input type="date" name="cfrom"></label><label class="custom-range" hidden>Até<input type="date" name="cto"></label>
      <label>Responsável pelo cliente<select name="owner_id">${selectOptions(userItems(), saved.owner_id, { placeholder: 'Todos' })}</select></label>
      <label class="grow">Buscar<input type="search" name="q" placeholder="Cliente, código, contrato ou nº na administradora"></label>
    </form>
    <div id="list"></div></div>`);
  const form = $('[data-f]', view);
  let page = 1;
  let data = { rows: [] };
  const query = () => {
    const d = Object.fromEntries(new FormData(form).entries());
    saved = d;
    $$('.custom-range', form).forEach((el) => (el.hidden = d.period !== 'custom'));
    const range = d.period ? periodRange(d.period, { from: d.cfrom, to: d.cto }) : {};
    return { status: d.status, owner_id: d.owner_id, q: d.q, from: range.from, to: range.to };
  };
  const load = async () => {
    try {
      data = await get('/api/financeiro', { ...query(), page, limit: 100 });
      const t = data.totals;
      render($('#kpis', view), html`<div class="kpis small">
        <div class="kpi"><div class="kpi-label">Recebido (filtro atual)</div><div class="kpi-value">${fmtMoney(t.pago)}</div></div>
        <div class="kpi"><div class="kpi-label">A vencer (filtro atual)</div><div class="kpi-value">${fmtMoney(t.a_vencer)}</div></div>
        <div class="kpi ${t.qtd_atrasado ? 'alert-kpi' : ''}"><div class="kpi-label">Em atraso (filtro atual)</div><div class="kpi-value">${fmtMoney(t.atrasado)}</div><div class="kpi-sub">${t.qtd_atrasado || 0} lançamento(s)</div></div>
      </div>`);
      render($('#list', view), html`<section class="card">${entriesTable(data.rows, { showContact: true, write: state.user.role !== 'leitura' })}${pager(data.total, data.page, data.limit)}</section>`);
    } catch (e) {
      toastError(e);
    }
  };
  bindEntries(view, () => data.rows, () => [], load);
  form.addEventListener('change', () => ((page = 1), load()));
  let tmr;
  form.addEventListener('input', (e) => {
    if (e.target.name !== 'q') return;
    clearTimeout(tmr);
    tmr = setTimeout(() => ((page = 1), load()), 300);
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  on(view, 'click', '[data-page]', (e, b) => ((page = Number(b.dataset.page)), load()));
  on(view, 'click', '[data-act=export]', () => download('/api/exportar/financeiro', query()).catch(toastError));
  await load();
}
