// Qualificação do negócio em blocos: necessidade, prazo, capacidade, estratégia e decisão.
// Usada no formulário do negócio, na ficha (4. Negócio), na tela do negócio e no painel lateral.
import { html, field, opts, optLabel, fmtMoney, productItems, $, $$ } from './ui.js';

const YES_NO_UNKNOWN = [{ value: 'sim', label: 'Sim' }, { value: 'nao', label: 'Não' }, { value: 'nao_sabe', label: 'Não sabe' }];
const YES_NO = [{ value: 'sim', label: 'Sim' }, { value: 'nao', label: 'Não' }];
const EMBEDDED = [{ value: 'sim', label: 'Sim' }, { value: 'nao', label: 'Não' }, { value: 'avaliar', label: 'Avaliar' }, { value: 'nao_se_aplica', label: 'Não se aplica / não permitido' }];

/**
 * Campos de cada bloco. list = lista configurável; options = lista fixa; showIf = só aparece com esta resposta;
 * pf = só pessoa física.
 */
export const QUAL_BLOCKS = [
  {
    key: 'necessidade',
    title: 'Necessidade',
    hint: 'O que o cliente quer conquistar com o crédito.',
    fields: [
      { name: 'objective_type', label: 'Objetivo', list: 'objetivo' },
      { name: 'credit_purpose_type', label: 'Finalidade do crédito', list: 'finalidade_credito' },
      { name: 'credit_category', label: 'Categoria de interesse', list: 'categoria_credito' },
      { name: 'housing_purpose', label: 'Moradia: morar ou investir?', list: 'finalidade_moradia', showIf: ['credit_category', 'imovel'] },
      { name: 'product_type', label: 'Tipo de produto', list: 'tipo_produto' },
      { name: 'credit_value', label: 'Crédito desejado', type: 'money' },
      { name: 'product_id', label: 'Plano de interesse', type: 'product' },
      { name: 'credit_purpose', label: 'Detalhe da finalidade', placeholder: 'ex.: apartamento de 2 quartos para morar', full: true },
    ],
  },
  {
    key: 'prazo',
    title: 'Prazo',
    hint: 'Curto: até 3 meses. Médio: até 12 meses. Longo: 24 meses ou mais.',
    fields: [
      { name: 'urgency', label: 'Prioridade: quando quer o crédito', list: 'urgencia' },
      { name: 'contemplation_type', label: 'Contemplação de interesse', list: 'tipo_contemplacao' },
      { name: 'term_months', label: 'Prazo do plano', type: 'months' },
    ],
  },
  {
    key: 'capacidade',
    title: 'Capacidade',
    hint: 'Quanto cabe no orçamento do cliente por mês.',
    fields: [
      { name: 'installment_min', label: 'Parcela ideal', type: 'money', help: 'O valor que o cliente considera confortável.' },
      { name: 'installment_max', label: 'Parcela máxima', type: 'money', help: 'Até onde ele pode chegar.' },
      { name: 'financial_moment', label: 'Momento financeiro', list: 'momento_financeiro' },
      { name: 'employment_type', label: 'Fonte de renda', list: 'tipo_contratacao' },
    ],
  },
  {
    key: 'estrategia',
    title: 'Estratégia',
    hint: 'Recursos para lance e como chegar à contemplação.',
    fields: [
      { name: 'has_bid_resources', label: 'Terá recurso próprio para lance?', options: YES_NO_UNKNOWN },
      { name: 'bid_own_resources', label: 'Quanto tem para lance', type: 'money', showIf: ['has_bid_resources', 'sim'] },
      { name: 'bid_source', label: 'O lance vem de', list: 'origem_lance', showIf: ['has_bid_resources', 'sim'] },
      { name: 'has_fgts', label: 'Possui FGTS?', list: 'possui_fgts', pf: true },
      { name: 'fgts_available', label: 'FGTS disponível', type: 'money', pf: true, showIf: ['has_fgts', 'sim'] },
      { name: 'embedded_bid_interest', label: 'Interesse em lance embutido', options: EMBEDDED },
      { name: 'quotas', label: 'Quantidade de cotas', type: 'int' },
      { name: 'strategy', label: 'Estratégia', list: 'estrategia', help: 'A estratégia só vale como recomendação depois de validada pelo consultor.' },
      { name: 'payment_modality', label: 'Modalidade de pagamento', list: 'modalidade_pagamento' },
      { name: 'has_property', label: 'Possui imóvel?', options: YES_NO },
      { name: 'property_type', label: 'Tipo do imóvel', list: 'tipo_imovel', showIf: ['has_property', 'sim'] },
      { name: 'property_value', label: 'Valor do imóvel', type: 'money', showIf: ['has_property', 'sim'] },
      { name: 'property_free_liens', label: 'Imóvel livre de ônus?', options: YES_NO, showIf: ['has_property', 'sim'] },
      { name: 'pays_rent', label: 'Paga aluguel hoje?', options: YES_NO },
      { name: 'rent_value', label: 'Valor do aluguel', type: 'money', showIf: ['pays_rent', 'sim'] },
    ],
  },
  {
    key: 'decisao',
    title: 'Decisão',
    hint: 'Quem decide e qual a experiência do cliente com consórcio.',
    fields: [
      { name: 'decision_maker', label: 'Fator decisor', list: 'decisor' },
      { name: 'decision_notes', label: 'Quem mais participa da decisão', placeholder: 'ex.: esposa, Ana; sócio, Pedro' },
      { name: 'had_consortium', label: 'Já teve consórcio?', options: YES_NO },
      { name: 'existing_consortium_admin', label: 'Administradora', showIf: ['had_consortium', 'sim'] },
      { name: 'existing_consortium_value', label: 'Crédito contratado', type: 'money', showIf: ['had_consortium', 'sim'] },
      { name: 'has_financing', label: 'Possui financiamento hoje?', options: YES_NO },
      { name: 'existing_financing_balance', label: 'Financiamento: saldo devedor', type: 'money', showIf: ['has_financing', 'sim'] },
      { name: 'existing_financing_cet', label: 'Financiamento: CET (% a.a.)', type: 'pct', showIf: ['has_financing', 'sim'] },
      { name: 'existing_financing_bank', label: 'Financiamento: banco', showIf: ['has_financing', 'sim'] },
    ],
  },
];

/** Campos essenciais (mesma lista do servidor) para o indicador "qualificação X de Y". */
const ESSENTIAL = [
  ['objective_type', 'Objetivo'], ['credit_purpose_type', 'Finalidade'], ['credit_category', 'Categoria'], ['credit_value', 'Crédito desejado'],
  ['urgency', 'Prioridade do crédito'], ['installment_min', 'Parcela ideal'], ['installment_max', 'Parcela máxima'],
  ['financial_moment', 'Momento financeiro'], ['has_bid_resources', 'Recurso para lance'], ['has_fgts', 'FGTS', 'PF'],
  ['decision_maker', 'Fator decisor'], ['had_consortium', 'Experiência com consórcio'],
];
const isEmpty = (v) => v == null || v === '';

/* ------------------------- Temperatura (quente, morno, frio) ------------------------- */

export const TEMP = { quente: 'Quente', morno: 'Morno', frio: 'Frio' };
const TEMP_RULE = {
  quente: 'Prazo curto, valor definido e lance ou parcela informados.',
  morno: 'Objetivo e valor definidos, sem prazo curto ou sem lance/parcela.',
  frio: 'Só curiosidade: sem valor nem prazo.',
};
/** Selo da temperatura (ao lado do nome). info = { has, missing } calculado pelo servidor. */
export function tempBadge(level, info = null, { short = false } = {}) {
  if (!level) return '';
  const why = info ? `${TEMP[level]}: ${info.has.length ? info.has.join(', ') : 'sem valor nem prazo'}${info.missing.length ? `. Para esquentar: ${info.missing.join(', ')}` : ''}` : `${TEMP[level]}: ${TEMP_RULE[level]}`;
  return html`<span class="temp temp-${level}" title="${why}"><span class="temp-dot" aria-hidden="true"></span>${short ? '' : TEMP[level]}</span>`;
}
/** Painel da temperatura no negócio: o que tem e o que falta para esquentar. */
export function tempPanel(o) {
  const t = o.temperature_info;
  if (!t) return '';
  return html`<div class="temp-panel temp-${t.level}">
    <div>${tempBadge(t.level, t)} <small class="muted">${TEMP_RULE[t.level]}</small></div>
    <small>${t.has.length ? html`Tem: ${t.has.join(', ')}.` : 'Ainda sem valor nem prazo.'}${t.missing.length ? html` <strong>Para esquentar:</strong> ${t.missing.join(', ')}.` : ''}</small>
  </div>`;
}

export function qualStatus(o, kind = 'PF') {
  const fields = ESSENTIAL.filter(([, , only]) => !only || only === kind);
  const missing = fields.filter(([f]) => isEmpty(o[f])).map(([key, label]) => ({ key, label }));
  return { total: fields.length, filled: fields.length - missing.length, missing };
}

/** Faixa "Qualificação 8 de 12" com barra e o que falta perguntar. */
export function qualProgress(o, kind = 'PF', { compact = false } = {}) {
  const s = qualStatus(o, kind);
  const pct = Math.round((s.filled / s.total) * 100);
  return html`<div class="qual-progress ${s.missing.length ? '' : 'done'}">
    <div class="qual-progress-head"><strong>Qualificação ${s.filled} de ${s.total}</strong><span class="muted small">${pct}%</span></div>
    <div class="progress-bar goal ${s.missing.length ? '' : 'done'}"><span style="width:${pct}%"></span></div>
    ${s.missing.length && !compact ? html`<small class="muted">Falta perguntar: ${s.missing.map((m) => m.label).join(', ')}.</small>` : ''}
  </div>`;
}

function display(f, o) {
  const v = o[f.name];
  if (isEmpty(v)) return null;
  if (f.list) return optLabel(f.list, v);
  if (f.options) return f.options.find((x) => x.value === v)?.label || v;
  if (f.type === 'money') return fmtMoney(v);
  if (f.type === 'months') return `${v} meses`;
  if (f.type === 'pct') return `${String(v).replace('.', ',')}% a.a.`;
  if (f.type === 'product') return o.product_name || productItems().find((p) => String(p.value) === String(v))?.label || null;
  return String(v);
}

const visible = (f, o, kind) => (!f.pf || kind === 'PF') && (!f.showIf || o[f.showIf[0]] === f.showIf[1]);

/** Visão em blocos (somente leitura). extra[campo] substitui a exibição de um campo (ex.: estratégia com validação). */
export function qualBlocks(o, kind = 'PF', { extra = {}, only } = {}) {
  const blocks = only ? QUAL_BLOCKS.filter((b) => only.includes(b.key)) : QUAL_BLOCKS;
  return html`<div class="qual-blocks">${blocks.map((b) => html`<div class="qual-block">
      <h4>${b.title}</h4>
      <dl>${b.fields.filter((f) => visible(f, o, kind)).map((f) => html`<div class="${f.full ? 'full' : ''}"><dt>${f.label}</dt><dd>${extra[f.name] ?? display(f, o) ?? html`<span class="muted">—</span>`}</dd></div>`)}</dl>
    </div>`)}</div>`;
}

/** Campos do formulário, em blocos. */
export function qualFormFields(o = {}, kind = 'PF') {
  return QUAL_BLOCKS.map((b) => html`<h4 class="full qual-form-title">${b.title}<small>${b.hint}</small></h4>
    ${b.fields.filter((f) => !f.pf || kind === 'PF').map((f) => {
      const base = { name: f.name, label: f.label, value: o[f.name], placeholder: f.placeholder, help: f.help, full: f.full };
      let fld;
      if (f.list) fld = field({ ...base, type: 'select', options: opts(f.list) });
      else if (f.options) fld = field({ ...base, type: 'select', options: f.options });
      else if (f.type === 'money') fld = field({ ...base, label: `${f.label} (R$)`, type: 'money', min: 0 });
      else if (f.type === 'months') fld = field({ ...base, label: `${f.label} (meses)`, type: 'number', min: 1, step: 1 });
      else if (f.type === 'int') fld = field({ ...base, type: 'number', min: 1, step: 1 });
      else if (f.type === 'pct') fld = field({ ...base, type: 'number', step: '0.01' });
      else if (f.type === 'product') fld = field({ ...base, type: 'select', options: productItems() });
      else fld = field(base);
      return f.showIf ? html`<div class="cond ${f.full ? 'full' : ''}" data-if="${f.showIf[0]}=${f.showIf[1]}">${fld}</div>` : fld;
    })}`);
}

/** Mostra/oculta os campos condicionais do formulário conforme as respostas. */
export function bindQualForm(form) {
  const sync = () => $$('[data-if]', form).forEach((el) => {
    const [name, value] = el.dataset.if.split('=');
    el.hidden = form.elements[name]?.value !== value;
  });
  form.addEventListener('change', (e) => {
    if (e.target.name && $(`[data-if^="${e.target.name}="]`, form)) sync();
  });
  sync();
}

