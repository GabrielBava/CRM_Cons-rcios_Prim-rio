// Formulários compartilhados entre as telas (modais).
import { get, post, patch } from './api.js';
import {
  html, raw, esc, modal, field, opts, toItems, userItems, productItems, state, toast, toastError, K, optLabel, fmtMoney, fmtDate,
  fmtDateTime, badge, $, $$, on, confirmDialog, can, stageById, table,
} from './ui.js';

const nav = (hash) => (location.hash = hash);

/* ------------------------- Cadastro rápido ------------------------- */

function dupList(dups) {
  return html`<div class="dup-box"><strong>Possível duplicidade encontrada:</strong><ul>${dups.map(
    (d) => html`<li>${d.visible
      ? html`<a href="#/leads/${d.id}" data-open-dup>${d.code} — ${d.name}</a> <small>(${d.reasons.join(', ')} · responsável: ${d.owner_name || '—'})</small>`
      : html`${d.code} — cadastro de outro responsável (${d.owner_name}) <small>(${d.reasons.join(', ')}). Solicite acesso ao gestor.</small>`}</li>`,
  )}</ul></div>`;
}

export function quickCreateContact(defaults = {}) {
  const kind = defaults.kind || 'PF';
  const cfg = state.meta.settings.field_config || {};
  const visible = (k, f) => (cfg[k === 'PJ' ? 'contact_pj' : 'contact_pf']?.[f]?.visible !== false);
  const body = html`
    <div class="seg" role="radiogroup">
      <label><input type="radio" name="kind" value="PF" ${kind === 'PF' ? raw('checked') : ''}> Pessoa física</label>
      <label><input type="radio" name="kind" value="PJ" ${kind === 'PJ' ? raw('checked') : ''}> Pessoa jurídica</label>
    </div>
    <p class="hint">Só o nome é obrigatório. Campos marcados como <span class="rec">recomendado</span> podem ser completados depois.</p>
    <div class="grid">
      ${field({ name: 'name', label: 'Nome completo ou nome de contato', required: true, full: true })}
      <div class="pj-only full grid" ${kind === 'PJ' ? '' : raw('hidden')}>
        ${field({ name: 'trade_name', label: 'Empresa / nome fantasia', recommended: true })}
        ${field({ name: 'contact_role', label: 'Cargo do contato' })}
      </div>
      ${field({ name: 'phone1', label: 'Telefone principal', type: 'tel', recommended: true, placeholder: '(11) 91234-5678' })}
      ${field({ name: 'phone2', label: 'Telefone secundário', type: 'tel' })}
      ${field({ name: 'email', label: 'E-mail', type: 'email', recommended: true })}
      ${field({ name: 'city', label: 'Cidade' })}
      ${field({ name: 'state', label: 'UF', maxlength: 2, placeholder: 'SP' })}
      ${visible(kind, 'doc') ? field({ name: 'doc', label: 'CPF ou CNPJ (opcional)', help: 'Informe apenas se necessário para o cadastro.' }) : ''}
      ${field({ name: 'origin', label: 'Origem do lead', type: 'select', options: opts('origem'), value: defaults.origin, recommended: true })}
      ${field({ name: 'campaign', label: 'Campanha ou ação de origem' })}
      ${field({ name: 'first_contact_at', label: 'Data do primeiro contato', type: 'datetime' })}
      ${field({ name: 'owner_id', label: 'Responsável', type: 'select', options: userItems(), value: state.user.id, allowEmpty: can.manage(), placeholder: 'Sem responsável', disabled: !can.manage() })}
      ${field({ name: 'product_id', label: 'Produto de interesse', type: 'select', options: productItems() })}
      ${field({ name: 'initial_notes', label: 'Observações iniciais', type: 'textarea', full: true })}
      ${field({ name: 'create_opportunity', label: 'Criar oportunidade no funil (etapa "Novo prospect")', type: 'checkbox', value: true, full: true })}
      <details class="full"><summary>Dados de campanha digital (opcional)</summary>
        <p class="hint">Preencha somente os dados que a plataforma forneceu. Campos sem informação ficam vazios.</p>
        <div class="grid">
          ${field({ name: 'o_platform', label: 'Plataforma', placeholder: 'ex.: meta_ads' })}
          ${field({ name: 'o_platform_lead_id', label: 'ID do lead na plataforma' })}
          ${field({ name: 'o_campaign_id', label: 'ID da campanha' })}
          ${field({ name: 'o_adset_id', label: 'ID do conjunto de anúncios' })}
          ${field({ name: 'o_ad_id', label: 'ID do anúncio' })}
          ${field({ name: 'o_received_at', label: 'Data de recebimento', type: 'datetime' })}
          ${field({ name: 'o_utm_source', label: 'utm_source' })}
          ${field({ name: 'o_utm_medium', label: 'utm_medium' })}
          ${field({ name: 'o_utm_campaign', label: 'utm_campaign' })}
          ${field({ name: 'o_utm_content', label: 'utm_content' })}
        </div>
      </details>
    </div>
    <div class="dup-live"></div>`;
  let confirmDup = false;
  return modal({
    title: 'Novo prospect / lead',
    wide: true,
    body,
    submitLabel: 'Salvar cadastro',
    onMount(form, close) {
      on(form, 'change', 'input[name=kind]', () => {
        const pj = form.kind.value === 'PJ';
        $$('.pj-only', form).forEach((el) => (el.hidden = !pj));
        form.querySelector('label[for^=f_name]').childNodes[0].textContent = pj ? 'Nome do contato principal ' : 'Nome completo ou nome de contato ';
      });
      on(form, 'click', '[data-open-dup]', () => close(null));
      const check = async () => {
        const d = { phone1: form.phone1.value, phone2: form.phone2.value, email: form.email.value, doc: form.doc?.value };
        if (!d.phone1 && !d.phone2 && !d.email && !d.doc) return;
        try {
          const r = await post('/api/cadastros/verificar-duplicidade', d);
          $('.dup-live', form).innerHTML = r.duplicates.length ? String(dupList(r.duplicates)) : '';
        } catch {}
      };
      ['phone1', 'phone2', 'email', 'doc'].forEach((n) => form[n]?.addEventListener('blur', check));
    },
    async onSubmit(d, form) {
      const origin_details = {};
      for (const [k, v] of Object.entries(d)) if (k.startsWith('o_') && v) origin_details[k.slice(2)] = v;
      const payload = { ...d, origin_details, confirm_duplicate: confirmDup };
      for (const k of Object.keys(payload)) if (k.startsWith('o_')) delete payload[k];
      if (d.kind === 'PJ') {
        payload.contact_name = d.name;
        payload.name = d.trade_name || d.name;
        payload.contact_phone = d.phone1;
        payload.contact_email = d.email;
      }
      if (!can.manage()) delete payload.owner_id;
      try {
        const r = await post('/api/cadastros', payload);
        toast(`Cadastro ${r.code} criado.`);
        nav(`#/leads/${r.id}`);
        return r;
      } catch (e) {
        if (e.status === 409 && e.details?.duplicates) {
          $('.dup-live', form).innerHTML = String(html`${dupList(e.details.duplicates)}<p class="warn-text">Abra o cadastro existente ou clique em "Criar mesmo assim" para confirmar um novo cadastro.</p>`);
          confirmDup = true;
          form.querySelector('button[type=submit]').textContent = 'Criar mesmo assim';
          return false;
        }
        throw e;
      }
    },
  });
}

/* ------------------------- Atividade manual ------------------------- */

const MANUAL_TYPES = () =>
  Object.entries(state.meta.constants.activity_types)
    .filter(([, v]) => !v.system)
    .map(([value, v]) => ({ value, label: v.label }));

export function activityForm(contact, { opportunity_id, type } = {}) {
  const callResults = opts('resultado_ligacao');
  const oppItems = (contact.opportunities || []).map((o) => ({ value: o.id, label: `${o.code} — ${o.stage_name}` }));
  const ccItems = (contact.company_contacts || []).filter((c) => c.active).map((c) => ({ value: c.id, label: `${c.name}${c.role ? ` (${c.role})` : ''}` }));
  const blocked = contact.optouts || [];
  const body = html`
    ${blocked.length ? html`<div class="alert danger">Atenção: ${blocked.includes('todos') ? 'este cadastro pediu para não receber contatos.' : `oposição a contatos por ${blocked.map((c) => K('contact_channels', c)).join(', ')}.`} Registros de contato ativo nesses canais serão recusados.</div>` : ''}
    <div class="grid">
      ${field({ name: 'type', label: 'Tipo de atividade', type: 'select', options: MANUAL_TYPES(), value: type || 'ligacao_realizada', required: true, allowEmpty: false })}
      ${field({ name: 'occurred_at', label: 'Data e hora', type: 'datetime', value: new Date().toISOString(), required: true })}
      <div class="field call-only"><label>Resultado da ligação</label><select name="result">${raw(String(html`<option value="">Não informado</option>${callResults.map((o) => html`<option value="${o.value}">${o.label}</option>`)}`))}</select></div>
      ${field({ name: 'duration', label: 'Duração (mm:ss ou segundos)', placeholder: '03:25' })}
      ${field({ name: 'channel', label: 'Canal', type: 'select', options: opts('canal'), placeholder: 'Padrão do tipo' })}
      ${oppItems.length ? field({ name: 'opportunity_id', label: 'Oportunidade', type: 'select', options: oppItems, value: opportunity_id, placeholder: 'Nenhuma específica' }) : ''}
      ${ccItems.length ? field({ name: 'company_contact_id', label: 'Contato da empresa', type: 'select', options: ccItems, placeholder: 'Empresa (geral)' }) : ''}
      ${field({ name: 'notes', label: 'Observação', type: 'textarea', full: true })}
      ${field({ name: 'next_action', label: 'Próxima ação', placeholder: 'ex.: Ligar para apresentar simulação' })}
      ${field({ name: 'return_at', label: 'Data de retorno', type: 'datetime', help: 'Cria uma tarefa de retorno automaticamente.' })}
    </div>`;
  return modal({
    title: `Registrar atividade — ${contact.name}`,
    wide: true,
    body,
    onMount(form) {
      const sync = () => {
        const t = state.meta.constants.activity_types[form.type.value];
        $$('.call-only', form).forEach((el) => (el.hidden = !t?.call));
        form.duration.closest('.field').hidden = !t?.call && !['conversa_presencial', 'conversa_video', 'reuniao_realizada'].includes(form.type.value);
      };
      form.type.addEventListener('change', sync);
      sync();
    },
    async onSubmit(d) {
      const t = state.meta.constants.activity_types[d.type];
      if (!t.call) delete d.result;
      await post('/api/atividades', { ...d, contact_id: contact.id });
      toast('Atividade registrada.');
      return true;
    },
  });
}

/* ------------------------- Tarefas ------------------------- */

export function taskForm({ contact, opportunity_id, type, task } = {}) {
  const oppItems = (contact?.opportunities || []).filter((o) => o.status === 'aberta' || o.status === 'pausada').map((o) => ({ value: o.id, label: `${o.code} — ${o.stage_name}` }));
  const tomorrow = new Date(Date.now() + 86400000);
  tomorrow.setHours(10, 0, 0, 0);
  return modal({
    title: task ? 'Editar tarefa' : `Nova tarefa${contact ? ` — ${contact.name}` : ''}`,
    body: html`<div class="grid">
      ${task ? '' : field({ name: 'type', label: 'Tipo', type: 'select', options: toItems(state.meta.constants.task_types), value: type || 'retorno', allowEmpty: false })}
      ${field({ name: 'title', label: 'Descrição', value: task?.title, placeholder: 'ex.: Retornar com simulação', full: !task })}
      ${field({ name: 'due_at', label: 'Data e hora', type: 'datetime', value: task?.due_at || tomorrow.toISOString(), required: true })}
      ${field({ name: 'assigned_to', label: 'Responsável', type: 'select', options: userItems(), value: task?.assigned_to || state.user.id, allowEmpty: false, disabled: !can.manage() })}
      ${!task && oppItems.length ? field({ name: 'opportunity_id', label: 'Oportunidade', type: 'select', options: oppItems, value: opportunity_id, placeholder: 'Nenhuma' }) : ''}
      ${field({ name: 'notes', label: 'Observações', type: 'textarea', value: task?.notes, full: true })}
    </div>`,
    async onSubmit(d) {
      if (!can.manage()) delete d.assigned_to;
      if (task) await patch(`/api/tarefas/${task.id}`, d);
      else await post('/api/tarefas', { ...d, contact_id: contact?.id });
      toast(task ? 'Tarefa atualizada.' : 'Tarefa criada.');
      return true;
    },
  });
}

export function completeTask(task) {
  const meeting = task.type === 'reuniao';
  return modal({
    title: `Concluir: ${task.title}`,
    body: html`<div class="grid">
      ${meeting ? field({ name: 'outcome', label: 'Resultado da reunião', type: 'select', options: toItems(state.meta.constants.meeting_outcomes), required: true, full: true }) : ''}
      ${field({ name: 'notes', label: 'Observação', type: 'textarea', full: true })}
    </div>
    ${meeting ? html`<p class="hint">Se a reunião foi remarcada, conclua esta tarefa como "Remarcada" e crie uma nova.</p>` : ''}`,
    submitLabel: 'Concluir tarefa',
    async onSubmit(d) {
      await patch(`/api/tarefas/${task.id}`, { action: 'concluir', ...d });
      toast('Tarefa concluída.');
      return true;
    },
  });
}

export async function cancelTask(task) {
  if (!(await confirmDialog('Cancelar tarefa', `Cancelar a tarefa "${task.title}"? O registro permanece no histórico.`))) return false;
  await patch(`/api/tarefas/${task.id}`, { action: 'cancelar' });
  toast('Tarefa cancelada.');
  return true;
}

/* ------------------------- Oportunidade ------------------------- */

function customFields(entity, values = {}) {
  const defs = state.meta.custom_fields.filter((f) => f.entity === entity);
  if (!defs.length) return '';
  return html`<fieldset class="full"><legend>Campos adicionais</legend><div class="grid">${defs.map((f) =>
    field({
      name: `cf_${f.key}`,
      label: f.label,
      type: f.type === 'boolean' ? 'checkbox' : f.type === 'select' ? 'select' : f.type,
      options: (f.options || []).map((o) => ({ value: o, label: o })),
      value: values[f.key],
    }),
  )}</div></fieldset>`;
}
export function extractCustom(d) {
  const custom = {};
  for (const k of Object.keys(d)) {
    if (k.startsWith('cf_')) {
      custom[k.slice(3)] = d[k];
      delete d[k];
    }
  }
  return custom;
}

export function opportunityFields(o = {}, companyContacts = []) {
  const ccItems = companyContacts.filter((c) => c.active !== 0).map((c) => ({ value: c.id, label: c.name }));
  return html`<div class="grid">
    ${field({ name: 'title', label: 'Título (opcional)', value: o.title, placeholder: 'ex.: Imóvel para moradia', full: true })}
    <h4 class="full">Qualificação (R1)</h4>
    ${field({ name: 'objective_type', label: '(R1) Objetivo', type: 'select', options: opts('objetivo'), value: o.objective_type })}
    ${field({ name: 'product_type', label: '(R1) Produto', type: 'select', options: opts('tipo_produto'), value: o.product_type })}
    ${field({ name: 'credit_purpose', label: '(R1) Para que é o crédito', value: o.credit_purpose, placeholder: 'ex.: apartamento para morar', full: true })}
    ${field({ name: 'financial_moment', label: '(R1) Momento financeiro', type: 'select', options: opts('momento_financeiro'), value: o.financial_moment })}
    ${field({ name: 'employment_type', label: 'Tipo de contratação', type: 'select', options: opts('tipo_contratacao'), value: o.employment_type })}
    ${field({ name: 'has_fgts', label: '(R1) Possui FGTS (PF)', type: 'select', options: opts('possui_fgts'), value: o.has_fgts })}
    ${field({ name: 'decision_maker', label: 'Quem decide a compra', type: 'select', options: opts('decisor'), value: o.decision_maker })}
    ${field({ name: 'existing_products', label: 'Já possui consórcio ou financiamento', type: 'select', options: opts('possui_produto'), value: o.existing_products })}
    <div class="grid full existing-cons">${field({ name: 'existing_consortium_value', label: 'Consórcio atual: valor (R$)', type: 'money', value: o.existing_consortium_value })}${field({ name: 'existing_consortium_admin', label: 'Consórcio atual: administradora', value: o.existing_consortium_admin })}</div>
    <div class="grid full existing-fin">${field({ name: 'existing_financing_balance', label: 'Financiamento: saldo devedor (R$)', type: 'money', value: o.existing_financing_balance })}${field({ name: 'existing_financing_cet', label: 'Financiamento: CET (% a.a.)', type: 'number', value: o.existing_financing_cet, step: '0.01' })}${field({ name: 'existing_financing_bank', label: 'Financiamento: banco', value: o.existing_financing_bank })}</div>
    <h4 class="full">Condições desejadas</h4>
    ${field({ name: 'product_id', label: 'Produto', type: 'select', options: productItems(), value: o.product_id })}
    ${field({ name: 'credit_category', label: 'Categoria do crédito', type: 'select', options: opts('categoria_credito'), value: o.credit_category })}
    ${field({ name: 'credit_value', label: 'Crédito desejado (R$)', type: 'money', value: o.credit_value, min: 0 })}
    ${field({ name: 'term_months', label: 'Prazo de interesse (meses)', type: 'number', value: o.term_months, min: 1, step: 1 })}
    ${field({ name: 'installment_max', label: '(R1) Capacidade de parcela (R$/mês)', type: 'money', value: o.installment_max, min: 0 })}
    ${field({ name: 'installment_min', label: 'Parcela mínima desejada (R$)', type: 'money', value: o.installment_min, min: 0 })}
    ${field({ name: 'quotas', label: 'Quantidade de cotas', type: 'number', value: o.quotas, min: 1, step: 1 })}
    ${field({ name: 'payment_modality', label: 'Modalidade de pagamento pretendida', type: 'select', options: opts('modalidade_pagamento'), value: o.payment_modality })}
    ${field({ name: 'strategy', label: 'Estratégia', type: 'select', options: opts('estrategia'), value: o.strategy, help: 'A estratégia só é considerada recomendação após validação do consultor.' })}
    ${field({ name: 'contemplation_type', label: 'Contemplação de interesse', type: 'select', options: opts('tipo_contemplacao'), value: o.contemplation_type })}
    ${field({ name: 'bid_own_resources', label: '(R1) Capital/reserva para lance (R$)', type: 'money', value: o.bid_own_resources, min: 0 })}
    ${field({ name: 'fgts_available', label: '(R1) FGTS disponível (R$)', type: 'money', value: o.fgts_available, min: 0, help: 'Somente PF.' })}
    ${field({ name: 'embedded_bid_interest', label: 'Interesse em lance embutido', type: 'select', options: [{ value: 'sim', label: 'Sim' }, { value: 'nao', label: 'Não' }, { value: 'avaliar', label: 'Avaliar' }, { value: 'nao_se_aplica', label: 'Não se aplica / não permitido' }], value: o.embedded_bid_interest })}
    ${field({ name: 'urgency', label: '(R1) Prazo objetivo', type: 'select', options: opts('urgencia'), value: o.urgency })}
    ${field({ name: 'priority', label: 'Prioridade', type: 'select', options: toItems(state.meta.constants.priorities), value: o.priority || 'media', allowEmpty: false })}
    ${ccItems.length ? field({ name: 'company_contact_id', label: 'Contato da empresa', type: 'select', options: ccItems, value: o.company_contact_id }) : ''}
    ${field({ name: 'owner_id', label: 'Responsável', type: 'select', options: userItems(), value: o.owner_id || state.user.id, allowEmpty: false, disabled: !can.manage() })}
    ${field({ name: 'objective', label: 'Objetivo declarado pelo lead', type: 'textarea', value: o.objective, full: true })}
    ${field({ name: 'qualification_criteria', label: 'Critério de qualificação', type: 'textarea', value: o.qualification_criteria, full: true })}
    ${field({ name: 'next_action', label: 'Próxima ação comercial', value: o.next_action })}
    ${field({ name: 'next_action_at', label: 'Data da próxima ação', type: 'datetime', value: o.next_action_at })}
    ${customFields('opportunity', o.custom || {})}
  </div>`;
}

export function opportunityForm(contact, opp) {
  return modal({
    title: opp ? `Editar ${opp.code}` : `Nova oportunidade — ${contact.name}`,
    wide: true,
    body: opportunityFields(opp || { owner_id: contact.owner_id }, contact.company_contacts || []),
    onMount(form) {
      const sync = () => {
        const v = form.existing_products.value;
        $('.existing-cons', form).hidden = !['consorcio', 'ambos'].includes(v);
        $('.existing-fin', form).hidden = !['financiamento', 'ambos'].includes(v);
      };
      form.existing_products.addEventListener('change', sync);
      sync();
    },
    async onSubmit(d) {
      d.custom = extractCustom(d);
      if (!can.manage()) delete d.owner_id;
      if (opp) {
        await patch(`/api/oportunidades/${opp.id}`, d);
        toast('Oportunidade atualizada.');
        return true;
      }
      const r = await post('/api/oportunidades', { ...d, contact_id: contact.id });
      toast(`Oportunidade ${r.code} criada.`);
      return r;
    },
  });
}

/** Movimentação entre etapas com as exigências de cada tipo de etapa. */
export function moveStage(opp, stageId) {
  const to = stageById(stageId);
  if (!to) return Promise.resolve(null);
  let body;
  if (to.kind === 'perdido') {
    body = html`<p>Mover <strong>${opp.code}</strong> para <strong>${to.name}</strong>.</p><div class="grid">
      ${field({ name: 'lost_reason', label: 'Motivo da perda', type: 'select', options: opts('motivo_perda'), required: true, full: true })}
      ${field({ name: 'lost_notes', label: 'Detalhes', type: 'textarea', full: true })}</div>`;
  } else if (to.kind === 'ganho') {
    body = html`<p>Registrar a venda de <strong>${opp.code}</strong>. O cadastro passa a ser <strong>cliente</strong>, mantendo todo o histórico.</p>
      ${field({ name: 'register_contract', label: 'Registrar agora o produto contratado', type: 'checkbox', value: true, full: true })}
      <div class="grid contract-fields">
        ${field({ name: 'administrator', label: 'Administradora' })}
        ${field({ name: 'group_code', label: 'Grupo' })}
        ${field({ name: 'quota_code', label: 'Cota' })}
        ${field({ name: 'credit_value', label: 'Crédito contratado (R$)', type: 'money', value: opp.credit_value })}
        ${field({ name: 'term_months', label: 'Prazo (meses)', type: 'number', value: opp.term_months })}
        ${field({ name: 'quotas', label: 'Quantidade de cotas', type: 'number', value: opp.quotas || 1 })}
        ${field({ name: 'contracted_at', label: 'Data da contratação', type: 'date', value: new Date().toISOString().slice(0, 10) })}
        ${field({ name: 'status', label: 'Status do contrato', type: 'select', options: opts('status_contrato'), value: 'em_formalizacao', allowEmpty: false })}
      </div>`;
  } else if (to.kind === 'nutricao') {
    body = html`<p>Mover <strong>${opp.code}</strong> para <strong>${to.name}</strong>.</p>${field({ name: 'pause_reason', label: 'Motivo da pausa', type: 'textarea', full: true })}`;
  } else {
    body = html`<p>Mover <strong>${opp.code}</strong> de <strong>${opp.stage_name || ''}</strong> para <strong>${to.name}</strong>.</p>${field({ name: 'reason', label: 'Observação (opcional)', type: 'textarea', full: true })}`;
  }
  return modal({
    title: to.kind === 'ganho' ? 'Registrar venda' : 'Mover oportunidade',
    body,
    submitLabel: to.kind === 'ganho' ? 'Confirmar venda' : 'Mover',
    onMount(form) {
      if (form.register_contract) {
        const sync = () => ($('.contract-fields', form).hidden = !form.register_contract.checked);
        form.register_contract.addEventListener('change', sync);
      }
    },
    async onSubmit(d) {
      const payload = { stage_id: to.id, reason: d.reason, lost_reason: d.lost_reason, lost_notes: d.lost_notes, pause_reason: d.pause_reason };
      if (to.kind === 'ganho' && d.register_contract) {
        const { register_contract, ...contract } = d;
        payload.contract = contract;
      }
      const r = await post(`/api/oportunidades/${opp.id}/etapa`, payload);
      toast(to.kind === 'ganho' ? 'Venda registrada.' : `Movida para "${to.name}".`);
      return r;
    },
  });
}

/* ------------------------- Simulador ------------------------- */

export function simulatorButton(contact, opp) {
  const sim = state.meta.simulator;
  if (!sim.available) {
    return html`<button class="btn" disabled title="${sim.message}">Criar simulação para este lead</button> ${badge('Integração pendente', 'muted')}`;
  }
  return html`<button class="btn" data-act="open-simulator" data-contact="${contact.id}" data-opp="${opp?.id || ''}">Criar simulação para este lead</button>${sim.status !== 'ativa' ? badge('Simulador em teste', 'warn') : ''}`;
}

export async function openSimulator(contactId, oppId, originScreen) {
  const w = window.open('about:blank', '_blank');
  try {
    const r = await post('/api/simulacoes/link', { contact_id: contactId, opportunity_id: oppId || undefined, origin_screen: originScreen });
    if (w) {
      w.opener = null;
      w.location.href = r.url;
    } else window.open(r.url, '_blank', 'noopener');
    toast(`Link do simulador gerado (válido até ${fmtDateTime(r.expires_at)}).`);
  } catch (e) {
    if (w) w.close();
    toastError(e);
  }
}

export function simulationForm(contact, { opportunity_id, simulation } = {}) {
  const oppItems = (contact.opportunities || []).map((o) => ({ value: o.id, label: `${o.code} — ${o.stage_name}` }));
  const s = simulation || {};
  const fromSimulator = s.source === 'simulador';
  return modal({
    title: simulation ? `Simulação ${s.code} (v${s.version})` : `Registrar simulação — ${contact.name}`,
    wide: true,
    body: html`${!simulation ? html`<p class="hint">Use este registro manual enquanto o simulador não estiver integrado, informando os dados gerados no simulador.</p>` : ''}
      ${fromSimulator ? html`<div class="alert">Simulação recebida do simulador: os valores só podem ser alterados no próprio simulador. Aqui é possível atualizar status e observações.</div>` : ''}
      <div class="grid">
        ${!simulation && oppItems.length ? field({ name: 'opportunity_id', label: 'Oportunidade', type: 'select', options: oppItems, value: opportunity_id, placeholder: 'Nenhuma' }) : ''}
        ${field({ name: 'credit_value', label: 'Crédito simulado (R$)', type: 'money', value: s.credit_value, required: !simulation, disabled: fromSimulator })}
        ${field({ name: 'term_months', label: 'Prazo (meses)', type: 'number', value: s.term_months, disabled: fromSimulator })}
        ${field({ name: 'installment', label: 'Parcela estimada (R$)', type: 'money', value: s.installment, disabled: fromSimulator })}
        ${field({ name: 'payment_modality', label: 'Modalidade de pagamento', type: 'select', options: opts('modalidade_pagamento'), value: s.payment_modality, disabled: fromSimulator })}
        ${field({ name: 'strategy', label: 'Estratégia selecionada', type: 'select', options: opts('estrategia'), value: s.strategy, disabled: fromSimulator })}
        ${field({ name: 'status', label: 'Status', type: 'select', options: toItems(state.meta.constants.simulation_status), value: s.status || 'salva', allowEmpty: false })}
        ${field({ name: 'view_url', label: 'Link para consultar a simulação', type: 'url', value: s.view_url, full: true, disabled: fromSimulator })}
        ${!simulation ? field({ name: 'external_id', label: 'ID da simulação no simulador (se houver)' }) : ''}
        ${field({ name: 'notes', label: 'Observações', type: 'textarea', value: s.notes, full: true })}
      </div>
      ${simulation?.versions?.length ? html`<h3>Versões anteriores</h3>${table(
        [
          { label: 'Versão', key: 'version' },
          { label: 'Crédito', render: (v) => fmtMoney(v.snapshot.credit_value) },
          { label: 'Prazo', render: (v) => v.snapshot.term_months ?? '—' },
          { label: 'Parcela', render: (v) => fmtMoney(v.snapshot.installment) },
          { label: 'Status', render: (v) => K('simulation_status', v.snapshot.status) },
          { label: 'Substituída em', render: (v) => fmtDateTime(v.created_at) },
        ],
        simulation.versions,
      )}` : ''}`,
    submitLabel: simulation ? 'Salvar nova versão' : 'Registrar simulação',
    async onSubmit(d) {
      for (const k of Object.keys(d)) if (d[k] === '' && fromSimulator) delete d[k];
      if (simulation) {
        await patch(`/api/simulacoes/${s.id}`, fromSimulator ? { status: d.status, notes: d.notes } : d);
        toast('Nova versão da simulação salva.');
        return true;
      }
      const r = await post('/api/simulacoes', { ...d, contact_id: contact.id });
      toast(`Simulação ${r.code} registrada.`);
      return r;
    },
  });
}

/* ------------------------- Propostas ------------------------- */

function proposalFields(p = {}, simulations = []) {
  return html`<div class="grid">
    ${simulations.length ? field({ name: 'simulation_id', label: 'Baseada na simulação', type: 'select', options: simulations.map((s) => ({ value: s.id, label: `${s.code} v${s.version} — ${fmtMoney(s.credit_value)}` })), value: p.simulation_id, placeholder: 'Nenhuma', help: 'Campos vazios são preenchidos com os dados da simulação.' }) : ''}
    ${field({ name: 'product_id', label: 'Produto', type: 'select', options: productItems(), value: p.product_id })}
    ${field({ name: 'credit_value', label: 'Crédito (R$)', type: 'money', value: p.credit_value })}
    ${field({ name: 'term_months', label: 'Prazo (meses)', type: 'number', value: p.term_months })}
    ${field({ name: 'initial_installment', label: 'Parcela inicial estimada (R$)', type: 'money', value: p.initial_installment })}
    ${field({ name: 'payment_modality', label: 'Modalidade de pagamento', type: 'select', options: opts('modalidade_pagamento'), value: p.payment_modality })}
    ${field({ name: 'strategy', label: 'Estratégia apresentada', type: 'select', options: opts('estrategia'), value: p.strategy })}
    ${field({ name: 'admin_fee_pct', label: 'Taxa de administração (%)', type: 'number', value: p.admin_fee_pct, step: '0.01' })}
    ${field({ name: 'reserve_fund_pct', label: 'Fundo de reserva (%)', type: 'number', value: p.reserve_fund_pct, step: '0.01' })}
    ${field({ name: 'insurance_pct', label: 'Seguro (%)', type: 'number', value: p.insurance_pct, step: '0.0001' })}
    ${field({ name: 'readjustment_index', label: 'Índice de reajuste', type: 'select', options: opts('indice_reajuste'), value: p.readjustment_index })}
    ${field({ name: 'valid_until', label: 'Validade', type: 'date', value: p.valid_until })}
    ${field({ name: 'other_costs', label: 'Outros custos considerados', type: 'textarea', value: p.other_costs, full: true })}
    ${field({ name: 'readjustment_assumptions', label: 'Premissas de reajuste', type: 'textarea', value: p.readjustment_assumptions, full: true })}
    ${field({ name: 'link_url', label: 'Link ou arquivo da proposta (URL)', type: 'url', value: p.link_url, full: true })}
    ${field({ name: 'notes', label: 'Observações', type: 'textarea', value: p.notes, full: true })}
  </div>`;
}

export function proposalForm(opp, simulations = [], { simulation_id } = {}) {
  return modal({
    title: `Nova proposta — ${opp.code}`,
    wide: true,
    body: html`${proposalFields({ simulation_id, product_id: opp.product_id }, simulations)}
      ${field({ name: 'status', label: 'Salvar como', type: 'select', options: [{ value: 'rascunho', label: 'Rascunho' }, { value: 'apresentada', label: 'Apresentada ao cliente' }], value: 'rascunho', allowEmpty: false })}`,
    async onSubmit(d) {
      const r = await post('/api/propostas', { ...d, opportunity_id: opp.id });
      toast(`Proposta ${r.code} criada.`);
      return r;
    },
  });
}

export async function proposalDetail(id, onChange) {
  const p = await get(`/api/propostas/${id}`);
  const editable = p.status === 'rascunho' && can.write();
  const final = ['aprovada', 'recusada', 'expirada', 'substituida'].includes(p.status);
  const nextStatuses = ['rascunho', 'apresentada', 'em_analise', 'aprovada', 'recusada', 'expirada'].filter((s) => s !== p.status);
  const body = html`
    <div class="kv">
      <div><span>Proposta</span><strong>${p.code} · versão ${p.version}</strong></div>
      <div><span>Status</span>${badge(K('proposal_status', p.status), `st-${p.status}`)}</div>
      <div><span>Cliente</span><a href="#/leads/${p.contact_id}">${p.contact_code} — ${p.contact_name}</a></div>
      <div><span>Oportunidade</span><a href="#/oportunidades/${p.opportunity_id}">${p.opportunity_code}</a></div>
      <div><span>Simulação</span>${p.simulation_code || '—'}</div>
      <div><span>Responsável</span>${p.owner_name || '—'}</div>
      <div><span>Criada em</span>${fmtDateTime(p.created_at)}</div>
      <div><span>Apresentada em</span>${fmtDateTime(p.presented_at)}</div>
    </div>
    ${editable ? proposalFields(p) : html`<div class="kv">
      <div><span>Produto</span>${p.product_name || '—'}</div>
      <div><span>Crédito</span>${fmtMoney(p.credit_value)}</div>
      <div><span>Prazo</span>${p.term_months ? `${p.term_months} meses` : '—'}</div>
      <div><span>Parcela inicial</span>${fmtMoney(p.initial_installment)}</div>
      <div><span>Modalidade</span>${optLabel('modalidade_pagamento', p.payment_modality)}</div>
      <div><span>Estratégia</span>${optLabel('estrategia', p.strategy)}</div>
      <div><span>Taxa de administração</span>${p.admin_fee_pct != null ? `${p.admin_fee_pct}%` : '—'}</div>
      <div><span>Fundo de reserva</span>${p.reserve_fund_pct != null ? `${p.reserve_fund_pct}%` : '—'}</div>
      <div><span>Seguro</span>${p.insurance_pct != null ? `${p.insurance_pct}%` : '—'}</div>
      <div><span>Reajuste</span>${optLabel('indice_reajuste', p.readjustment_index)}</div>
      <div><span>Validade</span>${fmtDate(p.valid_until)}</div>
      <div><span>Link</span>${p.link_url ? html`<a href="${p.link_url}" target="_blank" rel="noopener noreferrer">abrir</a>` : '—'}</div>
      <div class="full"><span>Outros custos</span>${p.other_costs || '—'}</div>
      <div class="full"><span>Premissas de reajuste</span>${p.readjustment_assumptions || '—'}</div>
      <div class="full"><span>Observações</span>${p.notes || '—'}</div>
    </div>`}
    ${p.accepted_at ? html`<div class="alert">Aceite em ${fmtDate(p.accepted_at)} via ${optLabel('canal_aceite', p.accepted_channel)}. Próxima etapa: <a href="#/leads/${p.contact_id}/prevenda">ficha de pré-venda</a>.</div>` : ''}
    ${p.refusal_reason ? html`<div class="alert warn">Recusada: ${optLabel('motivo_recusa_proposta', p.refusal_reason)}.</div>` : ''}
    ${!final && can.write() ? html`<div class="inline-actions"><label>Alterar status para <select name="new_status"><option value="">—</option>${nextStatuses.map((s) => html`<option value="${s}">${K('proposal_status', s)}</option>`)}</select></label>
      <label class="st-extra st-aprovada" hidden>Canal do aceite <select name="accepted_channel"><option value="">Selecione…</option>${opts('canal_aceite').map((o) => html`<option value="${o.value}">${o.label}</option>`)}</select></label>
      <label class="st-extra st-aprovada" hidden>Data do aceite <input type="date" name="accepted_at" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label class="st-extra st-recusada" hidden>Motivo <select name="refusal_reason"><option value="">Selecione…</option>${opts('motivo_recusa_proposta').map((o) => html`<option value="${o.value}">${o.label}</option>`)}</select></label>
      <button type="button" class="btn small" data-act="apply-status">Aplicar</button></div>` : ''}
    ${p.status !== 'substituida' && can.write() ? html`<p><button type="button" class="btn small" data-act="new-version">Criar nova versão</button> <small class="muted">A versão atual será marcada como substituída (se ainda estiver em aberto) e preservada no histórico.</small></p>` : ''}
    <h3>Versões</h3>
    <ul class="versions">${p.versions.map((v) => html`<li class="${v.current ? 'current' : ''}"><a href="#" data-proposal="${v.id}">${v.code} · v${v.version}</a> — ${K('proposal_status', v.status)} · ${fmtDateTime(v.created_at)}</li>`)}</ul>
    <h3>Histórico de alterações</h3>
    <ul class="audit">${p.history.map((h) => html`<li>${fmtDateTime(h.created_at)} · ${h.user_name || 'Sistema'} · ${h.action}${h.changes ? html` <code>${JSON.stringify(h.changes)}</code>` : ''}</li>`)}</ul>`;
  return modal({
    title: `Proposta ${p.code}`,
    wide: true,
    body,
    submitLabel: 'Salvar alterações',
    onSubmit: editable
      ? async (d) => {
          delete d.new_status;
          await patch(`/api/propostas/${p.id}`, d);
          toast('Proposta atualizada.');
          onChange?.();
          return true;
        }
      : undefined,
    onMount(form, close) {
      form.new_status?.addEventListener('change', () => {
        $$('.st-extra', form).forEach((el) => (el.hidden = !el.classList.contains(`st-${form.new_status.value}`)));
      });
      on(form, 'click', '[data-act=apply-status]', async () => {
        const s = form.new_status.value;
        if (!s) return;
        try {
          await post(`/api/propostas/${p.id}/status`, { status: s, accepted_channel: form.accepted_channel?.value, accepted_at: form.accepted_at?.value, refusal_reason: form.refusal_reason?.value });
          if (s === 'aprovada') toast('Aceite registrado. Tarefa criada para completar a ficha de pré-venda.');
          toast('Status atualizado.');
          close(true);
          onChange?.();
        } catch (e) {
          toastError(e);
        }
      });
      on(form, 'click', '[data-act=new-version]', async () => {
        try {
          const r = await post(`/api/propostas/${p.id}/nova-versao`, {});
          toast(`Versão ${r.version} criada (${r.code}).`);
          close(true);
          onChange?.();
          proposalDetail(r.id, onChange);
        } catch (e) {
          toastError(e);
        }
      });
      on(form, 'click', '[data-proposal]', (e, t) => {
        e.preventDefault();
        close(null);
        proposalDetail(t.dataset.proposal, onChange);
      });
    },
  });
}

/* ------------------------- Contratos ------------------------- */

export function contractForm(contact, contract) {
  const k = contract || {};
  const oppItems = (contact?.opportunities || []).map((o) => ({ value: o.id, label: `${o.code} — ${o.stage_name}` }));
  const propItems = (contact?.proposals || []).map((p) => ({ value: p.id, label: `${p.code} v${p.version} — ${K('proposal_status', p.status)}` }));
  return modal({
    title: contract ? `Produto contratado ${k.code}` : `Registrar produto contratado — ${contact.name}`,
    wide: true,
    body: html`<p class="hint">Cada contratação é um registro novo. Contratos anteriores não são sobrescritos.</p><div class="grid">
      ${!contract && oppItems.length ? field({ name: 'opportunity_id', label: 'Oportunidade', type: 'select', options: oppItems, placeholder: 'Nenhuma' }) : ''}
      ${field({ name: 'product_id', label: 'Produto', type: 'select', options: productItems(), value: k.product_id })}
      ${field({ name: 'category', label: 'Categoria', type: 'select', options: opts('categoria_credito'), value: k.category })}
      ${field({ name: 'administrator', label: 'Administradora', value: k.administrator })}
      ${field({ name: 'group_code', label: 'Grupo', value: k.group_code })}
      ${field({ name: 'quota_code', label: 'Cota', value: k.quota_code })}
      ${field({ name: 'credit_value', label: 'Crédito contratado (R$)', type: 'money', value: k.credit_value })}
      ${field({ name: 'term_months', label: 'Prazo (meses)', type: 'number', value: k.term_months })}
      ${field({ name: 'quotas', label: 'Quantidade de cotas', type: 'number', value: k.quotas })}
      ${field({ name: 'contracted_at', label: 'Data da contratação', type: 'date', value: k.contracted_at })}
      ${field({ name: 'status', label: 'Status do contrato', type: 'select', options: opts('status_contrato'), value: k.status || 'em_formalizacao', allowEmpty: false })}
      ${field({ name: 'payment_modality', label: 'Modalidade de pagamento', type: 'select', options: opts('modalidade_pagamento'), value: k.payment_modality })}
      ${field({ name: 'strategy', label: 'Estratégia associada', type: 'select', options: opts('estrategia'), value: k.strategy })}
      ${field({ name: 'contract_number', label: 'Nº do contrato na administradora', value: k.contract_number })}
      ${field({ name: 'installment_value', label: 'Valor da parcela (R$)', type: 'money', value: k.installment_value })}
      ${field({ name: 'due_day', label: 'Dia de vencimento', type: 'number', value: k.due_day, min: 1, step: 1 })}
      ${field({ name: 'first_due_date', label: 'Primeiro vencimento', type: 'date', value: k.first_due_date })}
      ${field({ name: 'seller_id', label: 'Vendedor da venda', type: 'select', options: userItems(), value: k.seller_id, placeholder: 'Não informado' })}
      ${field({ name: 'sale_value', label: 'Valor de venda da carta (R$)', type: 'money', value: k.sale_value, help: 'Para carta contemplada vendida.' })}
      <h4 class="full">Contemplação</h4>
      ${field({ name: 'contemplated_at', label: 'Data da contemplação', type: 'date', value: k.contemplated_at })}
      ${field({ name: 'contemplation_type', label: 'Tipo de contemplação', type: 'select', options: opts('tipo_contemplacao'), value: k.contemplation_type })}
      ${field({ name: 'bid_value', label: 'Valor do lance (R$)', type: 'money', value: k.bid_value })}
      ${field({ name: 'acquired_asset', label: 'Bem adquirido', value: k.acquired_asset })}
      ${propItems.length ? field({ name: 'proposal_id', label: 'Proposta vinculada', type: 'select', options: propItems, value: k.proposal_id, placeholder: 'Nenhuma' }) : ''}
      ${field({ name: 'notes', label: 'Observações', type: 'textarea', value: k.notes, full: true })}
    </div>`,
    async onSubmit(d) {
      if (contract) {
        await patch(`/api/contratos/${k.id}`, d);
        toast('Contrato atualizado.');
        return true;
      }
      const r = await post('/api/contratos', { ...d, contact_id: contact.id });
      toast(`Produto contratado ${r.code} registrado.`);
      return r;
    },
  });
}

/* ------------------------- Preferências / consentimento ------------------------- */

export function consentForm(contact) {
  const ccItems = (contact.company_contacts || []).map((c) => ({ value: c.id, label: c.name }));
  return modal({
    title: 'Registrar consentimento ou oposição a contato',
    body: html`<div class="grid">
      ${field({ name: 'status', label: 'Tipo', type: 'select', options: [{ value: 'oposicao', label: 'Oposição (não deseja ser contatado)' }, { value: 'consentimento', label: 'Consentimento / retirada da oposição' }], allowEmpty: false, full: true })}
      ${field({ name: 'channel', label: 'Canal', type: 'select', options: toItems(state.meta.constants.contact_channels), allowEmpty: false })}
      ${ccItems.length ? field({ name: 'company_contact_id', label: 'Contato da empresa', type: 'select', options: ccItems, placeholder: 'A empresa (todos os contatos)' }) : ''}
      ${field({ name: 'source', label: 'Origem da solicitação', required: true, placeholder: 'ex.: pedido por telefone em ligação' })}
      ${field({ name: 'recorded_at', label: 'Data da solicitação', type: 'datetime', value: new Date().toISOString() })}
      ${field({ name: 'notes', label: 'Observações', type: 'textarea', full: true })}
    </div><p class="hint">O histórico é mantido. A oposição bloqueia o registro de contatos ativos pelo canal e retira o cadastro da lista exportada para a discadora.</p>`,
    async onSubmit(d) {
      await post(`/api/cadastros/${contact.id}/consentimentos`, d);
      toast('Preferência registrada.');
      return true;
    },
  });
}

export { dupList };
