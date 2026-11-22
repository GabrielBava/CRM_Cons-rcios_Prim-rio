// 10. Vendas: a venda nasce na pré-venda com o comprovante de pagamento e aguarda a alocação da(s) cota(s) pela administradora.
// O especialista informa a alocação; o time (líder ou administrador) confirma: cada cota vira um produto do cliente,
// as comissões são geradas e começa o pós-venda.
import { get, post } from '../api.js';
import { html, render, $, on, state, selectOptions, userItems, opts, table, badge, fmtMoney, fmtDate, fmtDateTime, modal, field, toast, toastError, can, optLabel, todayLocal } from '../ui.js';
import { fileToBase64, openAttachmentFile } from './record-tabs.js';

let saved = {};
const STATUS = { aguardando_alocacao: ['Aguardando alocação', 'warn'], aguardando_pagamento: ['Aguardando pagamento', 'warn'], confirmada: ['Confirmada', 'ok'], cancelada: ['Cancelada', 'danger'] };
const PAY = { pix: 'Pix', boleto: 'Boleto' };
const pending = (v) => ['aguardando_alocacao', 'aguardando_pagamento'].includes(v.status);
const quotaChips = (v) => html`<div class="quota-chips">${(v.quotas || []).map((q) => html`<span class="chip-sm ${q.allocated_on ? 'ok' : ''}" title="${q.allocated_on ? `Alocada em ${fmtDate(q.allocated_on)}` : 'Alocação não informada'}">${q.group_code || '—'}/${q.quota_code || '—'} · ${fmtMoney(q.credit_value)}${q.allocated_on ? ' ✓' : ''}</span>`)}</div>`;
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
      <div class="page-head"><div><h1>Vendas</h1><p class="muted">A venda chega da pré-venda com o comprovante de pagamento. O especialista acompanha a alocação da cota no portal da administradora e o time confirma a venda: aí começa o pós-venda.</p></div></div>
      <div class="kpis small">
        <div class="kpi ${s.aguardando ? 'alert-kpi' : ''}"><div class="kpi-label">Aguardando alocação</div><div class="kpi-value">${s.aguardando}</div><div class="kpi-sub">${fmtMoney(s.aguardando_valor)} em crédito${s.alocacao_atrasada ? ` · ${s.alocacao_atrasada} há mais de ${s.sla_dias} dias` : ''}</div></div>
        <div class="kpi"><div class="kpi-label">Confirmadas no mês</div><div class="kpi-value">${s.confirmadas_mes}</div><div class="kpi-sub">${fmtMoney(s.credito_mes)} em crédito</div></div>
        <div class="kpi"><div class="kpi-label">Formalização pelo especialista</div><div class="kpi-value">${s.formalizacao_especialista != null ? `${s.formalizacao_especialista}%` : '—'}</div><div class="kpi-sub">comprovante e alocação em até ${s.sla_dias} dias</div></div>
        <div class="kpi"><div class="kpi-label">Canceladas no mês</div><div class="kpi-value">${s.canceladas_mes}</div></div>
      </div>
      <form class="filters" data-f>
        <label>Situação<select name="status">${selectOptions(Object.entries(STATUS).filter(([k]) => k !== 'aguardando_pagamento').map(([value, [label]]) => ({ value, label })), saved.status, { placeholder: 'Todas' })}</select></label>
        ${can.manage() ? html`<label>Especialista<select name="seller_id">${selectOptions(userItems(), saved.seller_id, { placeholder: 'Todos' })}</select></label>` : ''}
        <label>Mês do pagamento<input type="month" name="month" value="${saved.month || ''}"></label>
        <label class="grow">Buscar<input type="search" name="q" value="${saved.q || ''}" placeholder="Cliente, ID da venda (VD-…), grupo/cota ou nº do contrato"></label>
      </form>
      <section class="card">${table(
        [
          { label: 'Venda', render: (v) => html`<a href="#" data-open="${v.id}"><strong>${v.code}</strong></a><br><small>${v.pre_sale_code || ''}</small>` },
          { label: 'Cliente', render: (v) => html`<a href="#/leads/${v.contact_id}">${v.contact_name}</a><br><small>${v.contact_code}</small>` },
          { label: 'Plano', render: (v) => html`${v.plan_name || '—'}<br><small>${v.administrator_name || ''} · ${optLabel('categoria_credito', v.category)}</small>` },
          { label: 'Crédito e cotas', render: (v) => html`<strong>${fmtMoney(v.credit_value)}</strong> <small class="muted">${(v.quotas || []).length || 1} cota(s)</small>${quotaChips(v)}` },
          { label: 'Pagamento', render: (v) => (v.payment_date ? html`${PAY[v.payment_method] || 'Pago'} em ${fmtDate(v.payment_date)}<br><small>${fmtMoney(v.boleto_value)}</small>` : v.boleto_due ? html`vence ${fmtDate(v.boleto_due)}<br><small>${fmtMoney(v.boleto_value)}</small>` : '—') },
          { label: 'Especialista', render: (v) => v.seller_name || '—' },
          { label: 'Situação', render: (v) => html`${saleBadge(v.status)}${v.status === 'aguardando_alocacao' && v.allocation_checked_at ? html`<br><small class="ok-text">alocação informada</small>` : v.status === 'aguardando_alocacao' && v.payment_date ? html`<br><small class="${(Date.now() - Date.parse(v.payment_date)) / 86400000 > s.sla_dias ? 'overdue' : 'muted'}">pago há ${Math.max(0, Math.floor((Date.now() - Date.parse(v.payment_date)) / 86400000))} dia(s)</small>` : ''}` },
          {
            label: '',
            render: (v) =>
              pending(v) && can.write()
                ? html`${v.status === 'aguardando_alocacao' ? html`<button class="btn small" data-alloc="${v.id}">Informar alocação</button> ` : ''}${can.manage() ? html`<button class="btn small primary" data-confirm="${v.id}">Confirmar venda</button> ` : ''}<button class="btn small ghost" data-cancel="${v.id}">Cancelar</button>`
                : html`<button class="btn small" data-open="${v.id}">Detalhes</button>`,
          },
        ],
        d.rows,
        { emptyMsg: 'Nenhuma venda com esses filtros. A venda é registrada na Pré-venda, quando o comprovante de pagamento é anexado.' },
      )}</section>
      <p class="hint">Quem cuida da formalização é o especialista: anexa o comprovante na pré-venda e confere no portal da administradora se a cota foi alocada. ${state.meta.settings.formalization_bonus_pct ? `Feito em até ${s.sla_dias} dias após o pagamento, rende o bônus de formalização de ${String(state.meta.settings.formalization_bonus_pct).replace('.', ',')}% do crédito.` : 'A comissão só é gerada na confirmação da venda, depois da alocação.'}</p>
    </div>`);
    const f = $('[data-f]', view);
    f.addEventListener('change', () => ((saved = Object.fromEntries(new FormData(f).entries())), load()));
    f.addEventListener('submit', (e) => e.preventDefault());
  };
  on(view, 'click', '[data-confirm]', async (e, b) => (await allocationForm(Number(b.dataset.confirm), 'confirmar')) && load());
  on(view, 'click', '[data-alloc]', async (e, b) => (await allocationForm(Number(b.dataset.alloc), 'informar')) && load());
  on(view, 'click', '[data-cancel]', async (e, b) => {
    const ok = await modal({
      title: 'Cancelar venda (antes da confirmação)',
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

/**
 * Alocação da cota: o especialista informa (grupo, cota, nº do contrato e "alocada" conferido no portal);
 * o time confirma a venda com os mesmos dados.
 */
export async function allocationForm(id, mode) {
  const v = await get(`/api/vendas/${id}`);
  const confirm = mode === 'confirmar';
  const legacy = v.status === 'aguardando_pagamento';
  return modal({
    title: confirm ? `Confirmar a venda ${v.code}` : `Informar a alocação — ${v.code}`,
    wide: true,
    body: html`<div class="kv"><div><span>Cliente</span>${v.contact_name}</div><div><span>Plano</span>${v.plan_name || '—'} · ${v.administrator_name || ''}</div><div><span>Crédito</span>${fmtMoney(v.credit_value)} · ${(v.quotas || []).length} cota(s)</div>
        <div><span>Pagamento</span>${v.payment_date ? `${PAY[v.payment_method] || ''} em ${fmtDate(v.payment_date)}` : 'comprovante pendente'}${v.payment_attachment ? html` · <a href="#" data-att="${v.payment_attachment.id}">comprovante</a>` : ''}</div>
        ${v.allocation_checked_at ? html`<div><span>Alocação informada</span>${fmtDate(v.allocation_checked_at)} por ${v.allocation_checked_by_name || '—'}</div>` : ''}</div>
      <p class="small">${confirm ? 'Confirme quando a administradora tiver alocado as cotas para o cliente. Cada cota vira um produto contratado do cliente, todos com este ID de venda.' : 'Confira no portal da administradora e marque as cotas já alocadas para o cliente. Corrija grupo, cota ou contrato se mudou.'}</p>
      <div class="alloc-list">${(v.quotas || []).map((q) => html`<div class="quota-row" data-alloc-row="${q.id}">
          <span class="quota-n">${q.position}ª</span>
          <label>Crédito<input value="${fmtMoney(q.credit_value)}" disabled></label>
          <label>Grupo<input data-a="group_code" value="${q.group_code || ''}" required></label>
          <label>Cota<input data-a="quota_code" value="${q.quota_code || ''}" required></label>
          <label>Nº do contrato<input data-a="contract_number" value="${q.contract_number || ''}" required></label>
          <label class="check"><input type="checkbox" data-a="allocated" ${q.allocated_on || confirm ? 'checked' : ''}> alocada${q.allocated_on ? html` <small class="muted">${fmtDate(q.allocated_on)}</small>` : ''}</label></div>`)}</div>
      <div class="grid">
        ${field({ name: 'allocated_on', label: 'Data da alocação na administradora', type: 'date', value: todayLocal(), required: true })}
        ${legacy ? html`${field({ name: 'payment_date', label: 'Data do pagamento', type: 'date', value: todayLocal(), required: true })}<div class="field"><label>Comprovante de pagamento <span class="req">*</span></label><input type="file" name="file" required accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"></div>` : ''}
        ${confirm ? html`<h4 class="full">Pós-venda: como o cliente prefere ser atendido</h4>
          ${field({ name: 'pref_channel', label: 'Canal preferido', type: 'select', options: opts('canal') })}
          ${field({ name: 'pref_time', label: 'Melhor horário', placeholder: 'ex.: dias úteis após 18h' })}` : field({ name: 'notes', label: 'Observação', placeholder: 'ex.: conferido no portal da administradora', full: true })}
      </div>
      ${confirm ? html`<p class="hint">Ao confirmar: os produtos entram no cadastro do cliente, o negócio vai para "Venda", as comissões são geradas pela política da administradora/plano e começa o funil de pós-venda (onboarding em D+1).</p>` : ''}`,
    submitLabel: confirm ? 'Confirmar venda' : 'Salvar alocação',
    onMount(form) {
      on(form, 'click', '[data-att]', (e, a) => (e.preventDefault(), openAttachmentFile(a.dataset.att)));
    },
    async onSubmit(d, form) {
      const quotas = [...form.querySelectorAll('[data-alloc-row]')].map((r) => ({
        id: Number(r.dataset.allocRow),
        group_code: r.querySelector('[data-a=group_code]').value,
        quota_code: r.querySelector('[data-a=quota_code]').value,
        contract_number: r.querySelector('[data-a=contract_number]').value,
        allocated: r.querySelector('[data-a=allocated]').checked,
      }));
      if (confirm && quotas.some((q) => !q.allocated)) throw new Error('Para confirmar a venda, todas as cotas precisam estar alocadas.');
      const body = { ...d, quotas };
      if (legacy) {
        const file = form.file.files[0];
        if (!file) throw new Error('Anexe o comprovante de pagamento.');
        Object.assign(body, { file: undefined, filename: file.name, mime: file.type, content_base64: await fileToBase64(file) });
      }
      if (confirm) {
        const r = await post(`/api/vendas/${id}/confirmar`, body);
        toast(`Venda confirmada: ${r.contracts.length} produto(s) no cadastro do cliente (${r.contracts.map((k) => k.code).join(', ')}).${r.commissions ? ` ${r.commissions} parcela(s) de comissão prevista(s).` : ''}${r.bonus ? ` Bônus de formalização: ${fmtMoney(r.bonus)}.` : ''}`);
      } else {
        const r = await post(`/api/vendas/${id}/alocacao`, body);
        toast(r.all_allocated ? 'Alocação informada. O time foi avisado para confirmar a venda.' : 'Alocação parcial registrada.');
      }
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
        <div><span>Cotas</span>${(v.quotas || []).length || 1}</div>
        <div><span>Especialista</span>${v.seller_name || '—'}</div>
        <div><span>Pagamento</span>${v.payment_date ? html`${PAY[v.payment_method] || ''} em ${fmtDate(v.payment_date)}${v.payment_attachment ? html` · <a href="#" data-att="${v.payment_attachment.id}">comprovante</a>` : ''}` : 'aguardando'}</div>
        <div><span>Confirmação</span>${v.confirmed_at ? `${fmtDateTime(v.confirmed_at)} por ${v.confirmed_by_name || '—'}` : 'aguardando a alocação'}</div>
        <div><span>Proposta / pré-venda</span>${v.proposal_code || '—'} · ${v.pre_sale_code || '—'}</div>
      </div>
      <h4>Cotas e produtos</h4>
      ${table(
        [
          { label: '', render: (q) => `${q.position}ª` },
          { label: 'Grupo / cota', render: (q) => `${q.group_code || '—'} / ${q.quota_code || '—'}` },
          { label: 'Nº do contrato', render: (q) => q.contract_number || '—' },
          { label: 'Crédito', render: (q) => fmtMoney(q.credit_value), cls: 'num' },
          { label: 'Alocada', render: (q) => (q.allocated_on ? html`${fmtDate(q.allocated_on)}<br><small>${q.allocated_by_name || ''}</small>` : html`<span class="warn-text">não informada</span>`) },
          { label: 'Produto', render: (q) => q.contract_code || '—' },
        ],
        v.quotas || [],
        { emptyMsg: 'Venda anterior ao registro de cotas.' },
      )}
      <div class="alert ${v.formalization.by_seller ? 'ok' : ''} small"><strong>Formalização:</strong> comprovante anexado por ${v.formalization_by_name || '—'}${v.allocation_checked_at ? ` · alocação informada por ${v.allocation_checked_by_name || '—'} ${v.formalization.days_to_allocation != null ? `${v.formalization.days_to_allocation} dia(s) após o pagamento` : ''}` : ' · alocação ainda não informada'}.
        ${v.formalization.by_seller ? 'Feita pelo especialista no prazo.' : `Prazo: ${v.formalization.sla_days} dias após o pagamento.`}${v.bonus_pct ? ` Bônus de formalização: ${String(v.bonus_pct).replace('.', ',')}% do crédito.` : ''}</div>
      ${v.cancellation ? html`<div class="alert danger">Cancelamento ${v.cancellation.code} em ${fmtDate(v.cancellation.cancelled_on)} (${v.cancellation.days_after_sale} dia(s) após a venda): ${optLabel('motivo_cancelamento', v.cancellation.reason)} — ${v.cancellation.description}. Responsável: ${v.cancellation.responsible_name}. Estorno: ${fmtMoney(v.cancellation.chargeback_total)}.</div>` : v.status === 'cancelada' ? html`<div class="alert danger">Cancelada antes da confirmação: ${v.cancel_reason}</div>` : ''}
      <h4>Comissões</h4>
      ${table(
        [
          { label: 'Parcela', render: (c) => (c.kind === 'estorno' ? badge('Estorno', 'danger') : c.kind === 'bonus' ? badge('Bônus de formalização', 'ok') : `${c.installment_no}ª`) },
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
      on(form, 'click', '[data-att]', (e, a) => (e.preventDefault(), openAttachmentFile(a.dataset.att)));
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
        ${field({ name: 'cancelled_on', label: 'Data do cancelamento', type: 'date', value: todayLocal(), required: true })}
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
