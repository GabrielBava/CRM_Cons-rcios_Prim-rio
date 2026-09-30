// 10. Vendas: vendas registradas na pré-venda aguardam o pagamento; com o comprovante, a venda é confirmada,
// o produto entra no cadastro do cliente, as comissões são geradas e o onboarding é agendado.
import { get, post } from '../api.js';
import { html, render, $, on, state, selectOptions, userItems, opts, table, badge, fmtMoney, fmtDate, fmtDateTime, modal, field, toast, toastError, can, optLabel } from '../ui.js';
import { fileToBase64 } from './record-tabs.js';

let saved = {};
const STATUS = { aguardando_pagamento: ['Aguardando pagamento', 'warn'], confirmada: ['Confirmada', 'ok'], cancelada: ['Cancelada', 'danger'] };
export const saleBadge = (s) => badge(STATUS[s]?.[0] || s, STATUS[s]?.[1] || '');

export async function show(view) {
  const load = async () => {
    let d;
    try {
      d = await get('/api/vendas', saved);
    } catch (e) {
      render(view, html`<div class="page"><div class="alert danger">${e.message}</div></div>`);
      return;
    }
    const s = d.summary;
    render(view, html`<div class="page">
      <div class="page-head"><div><h1>Vendas</h1><p class="muted">Cada venda tem um ID único. Com o comprovante de pagamento, a venda é confirmada e passa para o cadastro do cliente.</p></div></div>
      <div class="kpis small">
        <div class="kpi ${s.aguardando ? 'alert-kpi' : ''}"><div class="kpi-label">Aguardando pagamento</div><div class="kpi-value">${s.aguardando}</div><div class="kpi-sub">${fmtMoney(s.aguardando_valor)} em crédito</div></div>
        <div class="kpi"><div class="kpi-label">Confirmadas no mês</div><div class="kpi-value">${s.confirmadas_mes}</div><div class="kpi-sub">${fmtMoney(s.credito_mes)} em crédito</div></div>
        <div class="kpi"><div class="kpi-label">Canceladas no mês</div><div class="kpi-value">${s.canceladas_mes}</div></div>
      </div>
      <form class="filters" data-f>
        <label>Situação<select name="status">${selectOptions(Object.entries(STATUS).map(([value, [label]]) => ({ value, label })), saved.status, { placeholder: 'Todas' })}</select></label>
        ${can.manage() ? html`<label>Especialista<select name="seller_id">${selectOptions(userItems(), saved.seller_id, { placeholder: 'Todos' })}</select></label>` : ''}
        <label>Mês<input type="month" name="month" value="${saved.month || ''}"></label>
        <label class="grow">Buscar<input type="search" name="q" value="${saved.q || ''}" placeholder="Cliente ou ID da venda (VD-…)"></label>
      </form>
      <section class="card">${table(
        [
          { label: 'Venda', render: (v) => html`<a href="#" data-open="${v.id}"><strong>${v.code}</strong></a><br><small>${v.pre_sale_code || ''}</small>` },
          { label: 'Cliente', render: (v) => html`<a href="#/leads/${v.contact_id}">${v.contact_name}</a><br><small>${v.contact_code}</small>` },
          { label: 'Plano', render: (v) => html`${v.plan_name || '—'}<br><small>${v.administrator_name || ''} · ${optLabel('categoria_credito', v.category)}</small>` },
          { label: 'Crédito', render: (v) => html`${fmtMoney(v.credit_value)}${v.installment_value ? html`<br><small>parcela ${fmtMoney(v.installment_value)}</small>` : ''}`, cls: 'num' },
          { label: 'Adesão', render: (v) => html`${fmtDate(v.adhesion_date)}${v.adhesion_number ? html`<br><small>nº ${v.adhesion_number}</small>` : ''}` },
          { label: 'Boleto / pagamento', render: (v) => (v.payment_date ? html`pago em ${fmtDate(v.payment_date)}` : v.boleto_due ? html`<span class="${v.boleto_due < new Date().toISOString().slice(0, 10) ? 'overdue' : ''}">vence ${fmtDate(v.boleto_due)}</span><br><small>${fmtMoney(v.boleto_value)}</small>` : '—') },
          { label: 'Especialista', render: (v) => v.seller_name || '—' },
          { label: 'Situação', render: (v) => html`${saleBadge(v.status)}${v.contract_code ? html`<br><small>${v.contract_code}</small>` : ''}` },
          {
            label: '',
            render: (v) =>
              v.status === 'aguardando_pagamento' && can.write()
                ? html`<button class="btn small primary" data-confirm="${v.id}">Confirmar pagamento</button> <button class="btn small ghost" data-cancel="${v.id}">Cancelar</button>`
                : html`<button class="btn small" data-open="${v.id}">Detalhes</button>`,
          },
        ],
        d.rows,
        { emptyMsg: 'Nenhuma venda com esses filtros. As vendas são registradas na Pré-venda, ao emitir o boleto.' },
      )}</section>
    </div>`);
    const f = $('[data-f]', view);
    f.addEventListener('change', () => ((saved = Object.fromEntries(new FormData(f).entries())), load()));
    f.addEventListener('submit', (e) => e.preventDefault());
  };
  on(view, 'click', '[data-confirm]', async (e, b) => (await confirmPayment(Number(b.dataset.confirm))) && load());
  on(view, 'click', '[data-cancel]', async (e, b) => {
    const ok = await modal({
      title: 'Cancelar venda (antes do pagamento)',
      body: field({ name: 'reason', label: 'Motivo', type: 'textarea', required: true, full: true }),
      submitLabel: 'Cancelar venda',
      cancelLabel: 'Voltar',
      danger: true,
      onSubmit: (d) => post(`/api/vendas/${b.dataset.cancel}/cancelar`, d),
    });
    if (ok) {
      toast('Venda cancelada.');
      load();
    }
  });
  on(view, 'click', '[data-open]', (e, b) => {
    e.preventDefault();
    saleDetail(Number(b.dataset.open), load).catch(toastError);
  });
  await load();
}

export async function confirmPayment(id) {
  const v = await get(`/api/vendas/${id}`);
  return modal({
    title: `Confirmar pagamento — ${v.code}`,
    wide: true,
    body: html`<div class="kv"><div><span>Cliente</span>${v.contact_name}</div><div><span>Plano</span>${v.plan_name || '—'} · ${v.administrator_name || ''}</div><div><span>Crédito</span>${fmtMoney(v.credit_value)}</div><div><span>Boleto</span>${fmtMoney(v.boleto_value)} · vence ${fmtDate(v.boleto_due)}</div></div>
      <div class="grid">
        ${field({ name: 'payment_date', label: 'Data do pagamento', type: 'date', value: new Date().toISOString().slice(0, 10), required: true })}
        <div class="field"><label>Comprovante de pagamento <span class="req">*</span></label><input type="file" name="file" required accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"></div>
        ${field({ name: 'group_code', label: 'Grupo', value: v.group_code })}
        ${field({ name: 'quota_code', label: 'Cota', value: v.quota_code })}
        <h4 class="full">Onboarding: como o cliente prefere ser atendido</h4>
        ${field({ name: 'pref_channel', label: 'Canal preferido', type: 'select', options: opts('canal') })}
        ${field({ name: 'pref_time', label: 'Melhor horário', placeholder: 'ex.: dias úteis após 18h' })}
      </div>
      <p class="hint">Ao confirmar: o produto contratado entra no cadastro do cliente, o negócio vai para a etapa "Venda", as comissões são calculadas pela política da administradora/plano e é criada a tarefa de onboarding.</p>`,
    submitLabel: 'Confirmar venda',
    async onSubmit(d, form) {
      const file = form.file.files[0];
      if (!file) throw new Error('Anexe o comprovante de pagamento.');
      if (file.size > 8 * 1024 * 1024) throw new Error('Arquivo maior que 8 MB.');
      const r = await post(`/api/vendas/${id}/confirmar`, { ...d, file: undefined, filename: file.name, mime: file.type, content_base64: await fileToBase64(file) });
      toast(`Venda confirmada. Produto ${r.contract.code} registrado no cliente.${r.commissions ? ` ${r.commissions} parcela(s) de comissão prevista(s).` : ''}`);
      return true;
    },
  });
}

export async function saleDetail(id, reload) {
  const v = await get(`/api/vendas/${id}`);
  const r = await modal({
    title: `Venda ${v.code}`,
    wide: true,
    body: html`<div class="kv">
        <div><span>Situação</span>${saleBadge(v.status)}</div>
        <div><span>Cliente</span><a href="#/leads/${v.contact_id}">${v.contact_code} — ${v.contact_name}</a></div>
        <div><span>Plano</span>${v.plan_name || '—'} · ${v.administrator_name || ''}</div>
        <div><span>Categoria</span>${optLabel('categoria_credito', v.category)}</div>
        <div><span>Crédito</span>${fmtMoney(v.credit_value)}</div>
        <div><span>Prazo / parcela</span>${v.term_months ? `${v.term_months} meses` : '—'} · ${fmtMoney(v.installment_value)}</div>
        <div><span>Adesão</span>${fmtDate(v.adhesion_date)}${v.adhesion_number ? ` · nº ${v.adhesion_number}` : ''}</div>
        <div><span>Grupo / cota</span>${v.group_code || '—'} / ${v.quota_code || '—'}</div>
        <div><span>Especialista</span>${v.seller_name || '—'}</div>
        <div><span>Pagamento</span>${v.payment_date ? `${fmtDate(v.payment_date)} · confirmado por ${v.confirmed_by_name || '—'}` : 'aguardando'}</div>
        <div><span>Produto contratado</span>${v.contract_code || '—'}</div>
        <div><span>Proposta / pré-venda</span>${v.proposal_code || '—'} · ${v.pre_sale_code || '—'}</div>
      </div>
      ${v.cancellation ? html`<div class="alert danger">Cancelamento ${v.cancellation.code} em ${fmtDate(v.cancellation.cancelled_on)} (${v.cancellation.days_after_sale} dia(s) após a venda): ${optLabel('motivo_cancelamento', v.cancellation.reason)} — ${v.cancellation.description}. Responsável: ${v.cancellation.responsible_name}. Estorno: ${fmtMoney(v.cancellation.chargeback_total)}.</div>` : v.status === 'cancelada' ? html`<div class="alert danger">Cancelada antes do pagamento: ${v.cancel_reason}</div>` : ''}
      <h4>Comissões</h4>
      ${table(
        [
          { label: 'Parcela', render: (c) => (c.kind === 'estorno' ? badge('Estorno', 'danger') : `${c.installment_no}ª`) },
          { label: 'Competência', render: (c) => c.competence.split('-').reverse().join('/') },
          { label: '% do crédito', render: (c) => (c.pct != null ? `${String(c.pct).replace('.', ',')}%` : '—') },
          { label: 'Valor', render: (c) => fmtMoney(c.amount), cls: 'num' },
          { label: 'Situação', render: (c) => html`${c.status}${c.release_on && c.status === 'prevista' ? html`<br><small>libera em ${fmtDate(c.release_on)}</small>` : ''}` },
          { label: 'Especialista', render: (c) => c.user_name },
        ],
        v.commissions,
        { emptyMsg: 'Sem comissões (venda não confirmada ou sem tabela de comissão).' },
      )}
      <details><summary>Histórico</summary><ul class="audit">${v.history.map((h) => html`<li>${fmtDateTime(h.created_at)} · ${h.user_name || 'Sistema'} · ${h.action}</li>`)}</ul></details>
      ${v.status === 'confirmada' && can.manage() ? html`<p><button type="button" class="btn small danger" data-register-cancel>Registrar cancelamento da cota</button></p>` : ''}`,
    onMount(form, close) {
      on(form, 'click', '[data-register-cancel]', async () => {
        close(null);
        if (await registerCancellation(v)) reload?.();
      });
    },
  });
  return r;
}

/** Registro de cancelamento (líder e administrador): motivo concreto e especialista responsável pela dedução. */
export function registerCancellation(v) {
  return modal({
    title: `Cancelamento da venda ${v.code}`,
    wide: true,
    body: html`<p>Cliente <strong>${v.contact_name}</strong> · crédito ${fmtMoney(v.credit_value)} · pago em ${fmtDate(v.payment_date)}.</p>
      <div class="grid">
        ${field({ name: 'cancelled_on', label: 'Data do cancelamento', type: 'date', value: new Date().toISOString().slice(0, 10), required: true })}
        ${field({ name: 'reason', label: 'Motivo', type: 'select', options: opts('motivo_cancelamento'), required: true })}
        ${field({ name: 'responsible_id', label: 'Especialista responsável (dedução da comissão)', type: 'select', options: state.meta.users.map((u) => ({ value: u.id, label: u.name })), value: v.seller_id, allowEmpty: false })}
        ${field({ name: 'description', label: 'Descrição do motivo concreto', type: 'textarea', required: true, full: true, help: 'Ex.: cliente desistiu no prazo de 7 dias por mudança de planos; perdeu o emprego; etc.' })}
      </div>
      <p class="hint">Parcelas de comissão ainda não pagas são canceladas. As já pagas são estornadas do especialista responsável, conforme a política de estorno da administradora.</p>`,
    submitLabel: 'Registrar cancelamento',
    danger: true,
    async onSubmit(d) {
      const r = await post(`/api/vendas/${v.id}/cancelamento`, d);
      toast(`Cancelamento ${r.code} registrado.${r.chargeback ? ` Estorno de ${fmtMoney(r.chargeback)}.` : ''}`);
      return true;
    },
  });
}
