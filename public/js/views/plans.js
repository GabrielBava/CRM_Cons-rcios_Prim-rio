// 15. Planos: condições de cada plano por administradora (taxa, fundo de reserva, prazo, lances, adesão, reajuste e
// faixa de crédito com incremento). A faixa é validada nas propostas e no termo de adesão.
import { get, post } from '../api.js';
import { html, render, $, on, table, badge, field, modal, opts, optLabel, selectOptions, fmtMoney, toast, toastError, can } from '../ui.js';
import { optionListCard, bindOptionList, refreshMeta } from './settings.js';
import { scheduleEditor, bindSchedules, readSchedule, scheduleText } from './administrators.js';

const INDEXES = [
  { value: 'pre5', label: 'Pré-fixado 5% a.a.' },
  { value: 'pre6', label: 'Pré-fixado 6% a.a.' },
  { value: 'ipca', label: 'IPCA' },
  { value: 'incc', label: 'INCC' },
  { value: 'inpc', label: 'INPC' },
  { value: 'outro', label: 'Outro índice' },
];
const p2 = (v) => (v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%`);

const kMoney = (v) => (v >= 1000 && v % 1000 === 0 ? `R$ ${(v / 1000).toLocaleString('pt-BR')} mil` : fmtMoney(v));
/** Descrição curta da faixa de crédito: "R$ 100 mil a R$ 180 mil · de 10 em 10 mil". */
export function creditRange(p) {
  if (p.credit_min == null && p.credit_max == null && !p.credit_step) return 'Livre';
  const a = p.credit_min != null ? kMoney(p.credit_min) : 'sem mínimo';
  const b = p.credit_max != null ? kMoney(p.credit_max) : 'sem máximo';
  const step = p.credit_step ? kMoney(p.credit_step).replace('R$ ', '') : null;
  return html`${a} a ${b}<br><small>${step ? `de ${step} em ${step}` : 'valor livre na faixa'}</small>`;
}

export async function show(view, { params = {} } = {}) {
  let filter = { administrator_id: params.administradora || '' };
  let rows = [];
  let adms = [];
  const admin = can.admin();
  const load = async () => {
    try {
      [rows, adms] = await Promise.all([get('/api/planos', filter), get('/api/administradoras')]);
    } catch (e) {
      return toastError(e);
    }
    render(view, html`<div class="page">
      <div class="page-head"><div><h1>Planos</h1><p class="muted">Condições de cada plano por administradora. A faixa de crédito e o incremento são conferidos nas propostas e no termo de adesão.</p></div>
        ${admin ? html`<div class="actions"><button class="btn primary" data-act="new" ${adms.length ? '' : 'disabled'}>+ Novo plano</button></div>` : ''}</div>
      ${admin && !adms.length ? html`<div class="alert warn">Cadastre primeiro uma administradora em <a href="#/administradoras">Administradoras</a>.</div>` : ''}
      <form class="filters" data-f><label>Administradora<select name="administrator_id">${selectOptions(adms.map((a) => ({ value: a.id, label: a.name })), filter.administrator_id, { placeholder: 'Todas' })}</select></label></form>
      <section class="card">${table(
        [
          { label: 'Plano', render: (p) => html`<strong>${p.name}</strong>${p.plan_code ? html` <small class="muted">${p.plan_code}</small>` : ''}${p.active ? '' : html` ${badge('Inativo', 'muted')}`}<br><small>${p.administrator_name || p.administrator || '—'} · ${optLabel('categoria_credito', p.category)}</small>` },
          { label: 'Taxa adm.', render: (p) => p2(p.admin_fee_pct), cls: 'num' },
          { label: 'Fundo reserva', render: (p) => p2(p.reserve_fund_pct), cls: 'num' },
          { label: 'Prazo', render: (p) => html`${p.term_months ? `${p.term_months} meses` : '—'}${p.term_options ? html`<br><small>opções: ${p.term_options}</small>` : ''}` },
          { label: 'Lances', render: (p) => html`${p.embedded_bid ? html`Embutido ${p2(p.embedded_bid_pct)}<br>` : ''}${p.fixed_bid ? `Fixo ${p2(p.fixed_bid_pct)}` : ''}${!p.embedded_bid && !p.fixed_bid ? '—' : ''}` },
          { label: 'Adesão', render: (p) => (p.adhesion ? html`${p2(p.adhesion_pct)}${p.adhesion_months ? html`<br><small>em ${p.adhesion_months}x</small>` : ''}` : 'Não') },
          { label: 'Reajuste', render: (p) => p.index_label || '—' },
          { label: 'Crédito', render: (p) => creditRange(p) },
          { label: 'Comissão', render: (p) => (p.commission_schedule?.length ? scheduleText(p.commission_schedule) : html`<small class="muted">da administradora</small>`) },
          { label: '', render: (p) => (admin ? html`<button class="btn small" data-edit="${p.id}">Editar</button>` : '') },
        ],
        rows,
        { emptyMsg: 'Nenhum plano cadastrado.' },
      )}</section>
      ${admin ? html`<div class="cols">
        ${optionListCard('categoria_credito', 'Categorias de crédito')}
        ${optionListCard('estrategia', 'Estratégias', 'Estratégias são registradas nas oportunidades e propostas; só valem como recomendação após validação do especialista.')}
        ${optionListCard('modalidade_pagamento', 'Modalidades de pagamento')}
        ${optionListCard('tipo_contemplacao', 'Tipos de contemplação')}
      </div>` : ''}
    </div>`);
    const f = $('[data-f]', view);
    f.addEventListener('change', () => ((filter = Object.fromEntries(new FormData(f).entries())), load()));
  };

  const toggle = (form) => {
    for (const k of ['embedded_bid', 'fixed_bid', 'adhesion']) {
      const on_ = form[k].checked;
      form.querySelectorAll(`[data-dep="${k}"]`).forEach((el) => {
        el.hidden = !on_;
        el.querySelectorAll('input').forEach((i) => (i.disabled = !on_));
      });
    }
    form.querySelector('[data-dep=outro]').hidden = form.readjustment_index.value !== 'outro';
  };
  const form = (p = { active: 1 }) =>
    modal({
      title: p.id ? `Editar ${p.name}` : 'Novo plano',
      wide: true,
      body: html`<div class="grid three">
          ${field({ name: 'administrator_id', label: 'Administradora', type: 'select', options: adms.filter((a) => a.active || a.id === p.administrator_id).map((a) => ({ value: a.id, label: a.name })), value: p.administrator_id ?? filter.administrator_id, required: true })}
          ${field({ name: 'name', label: 'Nome do plano', value: p.name, required: true, placeholder: 'Ex.: HS Imóvel 200' })}
          ${field({ name: 'plan_code', label: 'Código na administradora', value: p.plan_code })}
          ${field({ name: 'category', label: 'Categoria', type: 'select', options: opts('categoria_credito'), value: p.category })}
          ${p.id ? field({ name: 'active', label: 'Ativo', type: 'checkbox', value: p.active }) : ''}
        </div>
        <h4>Taxas e prazo</h4><div class="grid three">
          ${field({ name: 'admin_fee_pct', label: 'Taxa de administração (%)', type: 'number', step: '0.01', min: 0, value: p.admin_fee_pct })}
          ${field({ name: 'reserve_fund_pct', label: 'Fundo de reserva (%)', type: 'number', step: '0.01', min: 0, value: p.reserve_fund_pct })}
          ${field({ name: 'insurance_pct', label: 'Seguro (% a.m., opcional)', type: 'number', step: '0.0001', min: 0, value: p.insurance_pct })}
          ${field({ name: 'term_months', label: 'Prazo (meses)', type: 'number', step: '1', min: 1, value: p.term_months })}
          ${field({ name: 'term_options', label: 'Outros prazos disponíveis', value: p.term_options, placeholder: 'Ex.: 180, 200, 220' })}
        </div>
        <h4>Lances e adesão</h4><div class="grid three">
          ${field({ name: 'embedded_bid', label: 'Aceita lance embutido', type: 'checkbox', value: p.embedded_bid })}
          <div data-dep="embedded_bid">${field({ name: 'embedded_bid_pct', label: 'Lance embutido: base (%)', type: 'number', step: '0.01', min: 0, value: p.embedded_bid_pct })}</div><div></div>
          ${field({ name: 'fixed_bid', label: 'Tem lance fixo', type: 'checkbox', value: p.fixed_bid })}
          <div data-dep="fixed_bid">${field({ name: 'fixed_bid_pct', label: 'Lance fixo (%)', type: 'number', step: '0.01', min: 0, value: p.fixed_bid_pct })}</div><div></div>
          ${field({ name: 'adhesion', label: 'Cobra adesão', type: 'checkbox', value: p.adhesion })}
          <div data-dep="adhesion">${field({ name: 'adhesion_pct', label: 'Adesão (%)', type: 'number', step: '0.01', min: 0, value: p.adhesion_pct })}</div>
          <div data-dep="adhesion">${field({ name: 'adhesion_months', label: 'Diluída em (meses)', type: 'number', step: '1', min: 1, value: p.adhesion_months })}</div>
        </div>
        <h4>Reajuste</h4><div class="grid">
          ${field({ name: 'readjustment_index', label: 'Índice de correção', type: 'select', options: INDEXES, value: p.readjustment_index })}
          <div data-dep="outro">${field({ name: 'readjustment_other', label: 'Qual índice?', value: p.readjustment_other })}</div>
        </div>
        <h4>Limites de crédito</h4><div class="grid three">
          ${field({ name: 'credit_min', label: 'Crédito mínimo (R$)', type: 'money', value: p.credit_min })}
          ${field({ name: 'credit_max', label: 'Crédito máximo (R$)', type: 'money', value: p.credit_max })}
          ${field({ name: 'credit_step', label: 'Incremento (R$)', type: 'money', value: p.credit_step, help: 'Em branco = valor livre dentro da faixa.' })}
        </div>
        <p class="hint">Ex.: HS de R$ 100.000 a R$ 180.000 de R$ 10.000 em R$ 10.000 (100, 110, 120… 180 mil). Ou incremento de R$ 5.000, ou valor livre.</p>
        <h4>Comissão específica do plano (opcional)</h4>
        ${scheduleEditor('commission_schedule', p.commission_schedule || [], { title: 'Parcelas da comissão (% do crédito)', help: 'Deixe sem parcelas para usar a tabela da administradora.' })}
        ${field({ name: 'description', label: 'Descrição', type: 'textarea', value: p.description, full: true })}
        ${field({ name: 'notes', label: 'Observações internas', type: 'textarea', value: p.notes, full: true })}`,
      onMount(f) {
        bindSchedules(f);
        toggle(f);
        f.addEventListener('change', () => toggle(f));
      },
      async onSubmit(d, f) {
        await post('/api/planos', { ...d, id: p.id, commission_schedule: readSchedule(f, 'commission_schedule') });
        toast('Plano salvo.');
        await refreshMeta();
        return true;
      },
    });
  on(view, 'click', '[data-act=new]', async () => (await form()) && load());
  on(view, 'click', '[data-edit]', async (e, b) => (await form(rows.find((p) => p.id === Number(b.dataset.edit)))) && load());
  if (admin) bindOptionList(view, load);
  await load();
}
