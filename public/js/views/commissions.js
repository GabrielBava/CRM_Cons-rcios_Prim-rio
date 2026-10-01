// 12. Comissões e cancelamentos: comissões do mês por especialista (parcelas conforme a política da administradora),
// cancelamentos com motivo concreto e responsável (estorno) e o índice de cancelamento por especialista.
import { get, post } from '../api.js';
import { html, render, $, $$, on, fresh, table, badge, selectOptions, userItems, fmtMoney, fmtDate, fmtPct, optLabel, modal, field, toast, toastError, can, subnav, monthLabel } from '../ui.js';
import { registerCancellation } from './salesview.js';

const STATUS = { prevista: ['Prevista (em carência)', 'muted'], liberada: ['Liberada', 'warn'], paga: ['Paga', 'ok'], cancelada: ['Cancelada', 'danger'] };
const stBadge = (s) => badge(STATUS[s]?.[0] || s, STATUS[s]?.[1] || '');
let filter = { competence: new Date().toISOString().slice(0, 7) };

export async function show(view, { params = {} } = {}) {
  const tab = ['cancelamentos', 'indicadores'].includes(params.aba) ? params.aba : 'comissoes';
  render(view, html`<div class="page">
    <div class="page-head"><div><h1>Comissões e cancelamentos</h1><p class="muted">${can.manage() ? 'Comissões da equipe, cancelamentos e índice de cancelamento por especialista.' : 'Suas comissões do mês, o que já foi liberado e seus cancelamentos.'}</p></div></div>
    ${subnav(
      [
        ['#/comissoes', 'Comissões', 'comissoes'],
        ['#/comissoes?aba=cancelamentos', 'Cancelamentos', 'cancelamentos'],
        ['#/comissoes?aba=indicadores', 'Índice de cancelamento', 'indicadores'],
      ],
      tab,
    )}
    <div id="tab"></div></div>`);
  const box = fresh($('#tab', view));
  if (tab === 'cancelamentos') return cancellations(box);
  if (tab === 'indicadores') return indicators(box);
  return commissions(box);
}

async function commissions(box) {
  const admin = can.admin();
  const load = async () => {
    let d;
    try {
      d = await get('/api/comissoes', filter);
    } catch (e) {
      return toastError(e);
    }
    const s = d.summary;
    const total = d.rows.filter((r) => r.status !== 'cancelada').reduce((t, r) => t + r.amount, 0);
    render(box, html`
      <div class="kpis small">
        <div class="kpi"><div class="kpi-label">A receber em ${monthLabel(s.month)}</div><div class="kpi-value">${fmtMoney(s.a_receber_mes)}</div><div class="kpi-sub">${fmtMoney(s.liberado_mes)} já liberado</div></div>
        <div class="kpi"><div class="kpi-label">Pago no mês</div><div class="kpi-value">${fmtMoney(s.pago_mes)}</div></div>
        <div class="kpi ${s.estornos_mes ? 'alert-kpi' : ''}"><div class="kpi-label">Estornos no mês</div><div class="kpi-value">${fmtMoney(s.estornos_mes)}</div><div class="kpi-sub">deduções por cancelamento</div></div>
        <div class="kpi"><div class="kpi-label">Previsto próximos 3 meses</div><div class="kpi-value">${fmtMoney(s.previsto_3_meses)}</div></div>
      </div>
      <form class="filters" data-f>
        <label>Competência<input type="month" name="competence" value="${filter.competence || ''}"></label>
        ${can.manage() ? html`<label>Especialista<select name="user_id">${selectOptions(userItems(), filter.user_id, { placeholder: 'Todos' })}</select></label>` : ''}
        <label>Situação<select name="status">${selectOptions(Object.entries(STATUS).map(([value, [label]]) => ({ value, label })), filter.status, { placeholder: 'Todas' })}</select></label>
        ${admin ? html`<div class="grow"></div><button type="button" class="btn primary" data-act="pay" disabled>Marcar selecionadas como pagas</button>` : ''}
      </form>
      <section class="card">${table(
        [
          ...(admin ? [{ label: html`<input type="checkbox" data-all aria-label="Selecionar liberadas">`, render: (r) => (r.status === 'liberada' && r.kind === 'comissao' ? html`<input type="checkbox" data-sel="${r.id}" aria-label="Selecionar">` : '') }] : []),
          { label: 'Competência', render: (r) => monthLabel(r.competence) },
          { label: 'Venda', render: (r) => html`<strong>${r.sale_code}</strong><br><a href="#/leads/${r.contact_id}"><small>${r.contact_name}</small></a>` },
          { label: 'Plano', render: (r) => html`${r.plan_name || '—'}<br><small>${r.administrator_name || ''}</small>` },
          ...(can.manage() ? [{ label: 'Especialista', render: (r) => r.user_name }] : []),
          { label: 'Parcela', render: (r) => (r.kind === 'estorno' ? badge('Estorno', 'danger') : html`${r.installment_no}ª · ${fmtPct(r.pct)} de ${fmtMoney(r.base_value)}`) },
          { label: 'Valor', render: (r) => html`<strong class="${r.amount < 0 ? 'overdue' : ''}">${fmtMoney(r.amount)}</strong>`, cls: 'num' },
          { label: 'Situação', render: (r) => html`${stBadge(r.status)}${r.status === 'prevista' && r.release_on ? html`<br><small>libera em ${fmtDate(r.release_on)}</small>` : ''}${r.paid_at ? html`<br><small>paga em ${fmtDate(r.paid_at)}</small>` : ''}${r.cancellation_code ? html`<br><small>${r.cancellation_code}</small>` : ''}` },
        ],
        d.rows,
        { emptyMsg: 'Nenhuma comissão nesta competência. As comissões são geradas quando a venda é confirmada.' },
      )}
      ${d.rows.length ? html`<p class="right"><strong>Total da lista: ${fmtMoney(total)}</strong></p>` : ''}</section>
      <p class="hint">A parcela fica "prevista" durante a carência (ex.: 7 dias sem cancelamento) e depois é liberada para pagamento. As regras de cada administradora ficam em Administradoras; um plano pode ter tabela própria.</p>`);
    const f = $('[data-f]', box);
    f.addEventListener('change', (e) => {
      if (e.target.name) {
        filter = Object.fromEntries(new FormData(f).entries());
        load();
      }
    });
  };
  const sync = () => {
    const btn = $('[data-act=pay]', box);
    if (btn) btn.disabled = !$$('[data-sel]:checked', box).length;
  };
  on(box, 'change', '[data-all]', (e, c) => ($$('[data-sel]', box).forEach((i) => (i.checked = c.checked)), sync()));
  on(box, 'change', '[data-sel]', sync);
  on(box, 'click', '[data-act=pay]', async () => {
    const ids = $$('[data-sel]:checked', box).map((i) => Number(i.dataset.sel));
    try {
      const r = await post('/api/comissoes/pagar', { ids });
      toast(`${r.paid} parcela(s) marcada(s) como paga(s).`);
      load();
    } catch (e) {
      toastError(e);
    }
  });
  await load();
}

async function cancellations(box) {
  let range = {};
  const load = async () => {
    let rows;
    try {
      rows = await get('/api/cancelamentos', range);
    } catch (e) {
      return toastError(e);
    }
    render(box, html`
      <form class="filters" data-f>
        <label>De<input type="date" name="from" value="${range.from || ''}"></label><label>Até<input type="date" name="to" value="${range.to || ''}"></label>
        ${can.manage() ? html`<div class="grow"></div><button type="button" class="btn danger" data-act="new">Registrar cancelamento</button>` : ''}
      </form>
      <section class="card">${table(
        [
          { label: 'Cancelamento', render: (c) => html`<strong>${c.code}</strong><br><small>${fmtDate(c.cancelled_on)}</small>` },
          { label: 'Venda', render: (c) => html`${c.sale_code}<br><a href="#/leads/${c.contact_id}"><small>${c.contact_name}</small></a>` },
          { label: 'Crédito', render: (c) => fmtMoney(c.credit_value), cls: 'num' },
          { label: 'Motivo', render: (c) => html`<strong>${optLabel('motivo_cancelamento', c.reason)}</strong><br><small>${c.description}</small>` },
          { label: 'Dias após a venda', render: (c) => html`${c.days_after_sale ?? '—'}${c.within_7_days ? html` ${badge('até 7 dias', 'warn')}` : ''}`, cls: 'num' },
          { label: 'Especialista', render: (c) => html`${c.seller_name || '—'}${c.responsible_name && c.responsible_name !== c.seller_name ? html`<br><small>responsável: ${c.responsible_name}</small>` : ''}` },
          { label: 'Estorno', render: (c) => (c.chargeback_total ? html`<span class="overdue">${fmtMoney(-c.chargeback_total)}</span>` : '—'), cls: 'num' },
        ],
        rows,
        { emptyMsg: 'Nenhum cancelamento registrado.' },
      )}</section>`);
    const f = $('[data-f]', box);
    f.addEventListener('change', () => ((range = Object.fromEntries(new FormData(f).entries())), load()));
  };
  on(box, 'click', '[data-act=new]', async () => {
    let sales;
    try {
      sales = (await get('/api/vendas', { status: 'confirmada' })).rows;
    } catch (e) {
      return toastError(e);
    }
    const picked = await modal({
      title: 'Registrar cancelamento',
      body: sales.length
        ? field({ name: 'sale_id', label: 'Venda confirmada', type: 'select', required: true, full: true, options: sales.map((s) => ({ value: s.id, label: `${s.code} · ${s.contact_name} · ${fmtMoney(s.credit_value)}` })) })
        : html`<p>Não há vendas confirmadas para cancelar.</p>`,
      submitLabel: 'Continuar',
      onSubmit: sales.length ? (d) => sales.find((s) => s.id === Number(d.sale_id)) : undefined,
    });
    if (picked && picked !== true && (await registerCancellation(picked))) load();
  });
  await load();
}

async function indicators(box) {
  let d;
  try {
    d = await get('/api/cancelamentos/indicadores');
  } catch (e) {
    return toastError(e);
  }
  render(box, html`<section class="card">
    <h3>Índice de cancelamento de ${fmtDate(d.from)} a ${fmtDate(d.to)}</h3>
    <p class="hint">Cancelamentos ÷ vendas pagas no período. A partir de 10% o especialista entra em alerta: vale revisar a qualidade da venda (expectativa de contemplação, capacidade de pagamento e entendimento do produto) para evitar vendas "empurradas".</p>
    ${table(
      [
        { label: 'Especialista', render: (r) => html`<strong>${r.name}</strong>${r.active ? '' : html` ${badge('Inativo', 'muted')}`}` },
        { label: 'Vendas', key: 'vendas', cls: 'num' },
        { label: 'Crédito vendido', render: (r) => fmtMoney(r.credito), cls: 'num' },
        { label: 'Cancelamentos', key: 'cancelamentos', cls: 'num' },
        { label: 'Em até 7 dias', key: 'cancelamentos_7_dias', cls: 'num' },
        { label: 'Estornos', render: (r) => (r.estornos ? fmtMoney(-r.estornos) : '—'), cls: 'num' },
        { label: 'Índice', render: (r) => (r.taxa == null ? '—' : badge(fmtPct(r.taxa), r.alerta ? 'danger' : r.taxa > 0 ? 'warn' : 'ok')) },
      ],
      d.rows.sort((a, b) => (b.taxa ?? -1) - (a.taxa ?? -1)),
      { emptyMsg: 'Sem vendas no período.' },
    )}</section>`);
}
