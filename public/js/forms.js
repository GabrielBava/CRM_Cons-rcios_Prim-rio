// Formulários compartilhados entre as telas (modais).
import { get, post, patch } from './api.js';
import {
  html, raw, esc, modal, field, opts, toItems, userItems, productItems, state, toast, toastError, K, optLabel, fmtMoney, fmtDate,
  fmtDateTime, badge, $, $$, on, confirmDialog, can, stageById, table,
} from './ui.js';
import { qualFormFields, bindQualForm } from './qualification.js';

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
      ${field({ name: 'relationship', label: 'Tipo', type: 'select', options: [{ value: 'prospect', label: 'Prospect (ainda sem interesse demonstrado)' }, { value: 'lead', label: 'Lead (demonstrou interesse)' }], value: defaults.relationship || 'lead', allowEmpty: false })}
      ${field({ name: 'owner_id', label: 'Responsável', type: 'select', options: userItems(), value: defaults.owner_id !== undefined ? defaults.owner_id : state.user.id, allowEmpty: can.manage(), placeholder: 'Sem responsável (fila de distribuição)', disabled: !can.manage() })}
      ${field({ name: 'product_id', label: 'Produto de interesse', type: 'select', options: productItems() })}
      ${field({ name: 'initial_notes', label: 'Observações iniciais', type: 'textarea', full: true })}
      ${field({ name: 'create_opportunity', label: 'Criar negócio no funil (etapa "Prospect" ou "Lead")', type: 'checkbox', value: true, full: true })}
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
      ${field({ name: 'priority', label: 'Prioridade', type: 'select', options: toItems(state.meta.constants.task_priorities), value: task?.priority || 'normal', allowEmpty: false })}
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

export function opportunityFields(o = {}, companyContacts = [], kind = 'PF') {
  const ccItems = companyContacts.filter((c) => c.active !== 0).map((c) => ({ value: c.id, label: c.name }));
  return html`<div class="grid">
    ${field({ name: 'title', label: 'Título (opcional)', value: o.title, placeholder: 'ex.: Imóvel para moradia', full: true })}
    <p class="hint full">Em Lead e Tentativa de contato, busque o máximo destas respostas. O que ficar em branco pode ser completado depois da R1.</p>
    ${qualFormFields(o, kind)}
    <h4 class="full qual-form-title">Gestão do negócio<small>Responsável, prioridade interna e próxima ação.</small></h4>
    ${field({ name: 'priority', label: 'Prioridade no funil', type: 'select', options: toItems(state.meta.constants.priorities), value: o.priority || 'media', allowEmpty: false })}
    ${field({ name: 'owner_id', label: 'Responsável', type: 'select', options: userItems(), value: o.owner_id || state.user.id, allowEmpty: false, disabled: !can.manage() })}
    ${ccItems.length ? field({ name: 'company_contact_id', label: 'Contato da empresa', type: 'select', options: ccItems, value: o.company_contact_id }) : ''}
    ${field({ name: 'objective', label: 'Objetivo nas palavras do cliente', type: 'textarea', value: o.objective, full: true })}
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
    body: opportunityFields(opp || { owner_id: contact.owner_id }, contact.company_contacts || [], contact.kind),
    onMount(form) {
      bindQualForm(form);
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
  if (to.kind === 'ganho') {
    return modal({
      title: 'Etapa "Venda"',
      body: html`<p>O negócio entra em <strong>${to.name}</strong> automaticamente quando o pagamento da venda é confirmado.</p>
        <ol class="small"><li>Proposta aceita → abre a <a href="#/prevenda">Pré-venda</a> (cadastro do cliente, termo de adesão, contrato e boleto).</li>
        <li>Boleto emitido → a venda aparece em <a href="#/vendas">Vendas</a> aguardando pagamento.</li>
        <li>Comprovante anexado e pagamento confirmado → o negócio vai para "${to.name}" e o cadastro vira cliente.</li></ol>`,
    }).then(() => null);
  }
  let body;
  const from = stageById(opp.stage_id);
  const backward = !!from && from.kind === 'aberta' && to.kind === 'aberta' && to.position < from.position;
  if (to.kind === 'perdido') {
    body = html`<p>Mover <strong>${opp.code}</strong> para <strong>${to.name}</strong>.</p><div class="grid">
      ${field({ name: 'lost_reason', label: 'Motivo da perda', type: 'select', options: opts('motivo_perda'), required: true, full: true })}
      ${field({ name: 'lost_notes', label: 'Detalhes', type: 'textarea', full: true })}</div>`;
  } else if (to.kind === 'nutricao') {
    const d = new Date(Date.now() + 30 * 86400000);
    d.setHours(10, 0, 0, 0);
    body = html`<p>Mover <strong>${opp.code}</strong> para <strong>${to.name}</strong>. Será criada uma tarefa para retomar o contato na data escolhida.</p><div class="grid">
      ${field({ name: 'pause_reason', label: 'Motivo', type: 'textarea', required: true, full: true })}
      ${field({ name: 'return_at', label: 'Retomar o contato em', type: 'datetime', value: d.toISOString(), required: true })}</div>`;
  } else {
    body = html`<p>Mover <strong>${opp.code}</strong>${opp.stage_name ? html` de <strong>${opp.stage_name}</strong>` : ''} para <strong>${to.name}</strong>.</p>
      ${to.playbook ? html`<p class="hint">${to.playbook}</p>` : ''}
      ${field({ name: 'reason', label: backward ? 'Motivo para voltar a etapa' : 'Observação (opcional)', type: 'textarea', full: true, required: backward })}
      ${can.admin() ? field({ name: 'force', label: 'Forçar a passagem mesmo sem os critérios (administrador, exige justificativa na observação)', type: 'checkbox', full: true }) : ''}`;
  }
  return modal({
    title: 'Mover negócio',
    body,
    submitLabel: 'Mover',
    async onSubmit(d, form, errBox) {
      const payload = { stage_id: to.id, reason: d.reason, lost_reason: d.lost_reason, lost_notes: d.lost_notes, pause_reason: d.pause_reason, return_at: d.return_at, force: d.force };
      try {
        const r = await post(`/api/oportunidades/${opp.id}/etapa`, payload);
        toast(`Movido para "${to.name}".`);
        return r;
      } catch (e) {
        if (e.details?.missing) {
          errBox.hidden = false;
          errBox.innerHTML = String(html`<strong>Para entrar em "${e.details.stage}" falta:</strong><ul class="missing-list">${e.details.missing.map((m) => html`<li>${m.label}${m.stage && m.stage !== e.details.stage ? html` <small>(etapa ${m.stage})</small>` : ''}<br><small>${m.hint}</small></li>`)}</ul>`);
          return false;
        }
        throw e;
      }
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

/** "Gerar simulação": registra data, hora e quem gerou (os valores ficam no simulador). */
export async function quickSimulation(contactId, oppId) {
  try {
    const r = await post(`/api/cadastros/${contactId}/simulacao-rapida`, { opportunity_id: oppId || undefined });
    toast(`Simulação ${r.code} registrada em ${fmtDateTime(r.created_at)}.`);
    return r;
  } catch (e) {
    toastError(e);
    return null;
  }
}

/**
 * "Gerar proposta": abre o simulador de propostas já com o nome completo e o contato do cliente.
 * A janela é aberta antes da chamada à API para não ser bloqueada pelo navegador.
 */
export async function openProposalSimulator(contact, oppId) {
  const w = window.open('about:blank', '_blank');
  try {
    const r = await post('/api/propostas/iniciar', { contact_id: contact.id, opportunity_id: oppId || undefined });
    r.name = contact.name;
    r.phone = contact.whatsapp || contact.phone1;
    if (w) {
      w.opener = null;
      w.location.href = r.url;
      toast(`Proposta ${r.code} iniciada: o simulador abriu com o nome e o contato do cliente. Depois de gerar o PDF, complete os dados em Propostas.`);
    } else {
      await modal({
        title: 'Abrir simulador de propostas',
        body: html`<p>O navegador bloqueou a nova janela. Use o link abaixo:</p>
          <p><a class="btn primary" href="${r.url}" target="_blank" rel="noopener noreferrer">Abrir simulador</a></p>
          <div class="kv">${html`<div><span>Nome completo</span>${r.name || '—'}</div><div><span>Contato</span>${r.phone || '—'}</div>`}</div>`,
      });
    }
    return true;
  } catch (e) {
    if (w) w.close();
    toastError(e);
    return false;
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

const quotaList = (p) => {
  try {
    return p.quota_values ? JSON.parse(p.quota_values) : [];
  } catch {
    return [];
  }
};
const pctTxt = (v, dec = 2) => (v == null || v === '' ? null : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: dec })}%`);
const ADHESION_OPTS = [{ value: 'sim', label: 'Sim' }, { value: 'nao', label: 'Não' }];
const DEDUCTION_OPTS = [{ value: 'parcela', label: 'Reduz a parcela' }, { value: 'prazo', label: 'Reduz o prazo' }];

/** Campos que o simulador de propostas usa nas características do plano: avisa o que falta na proposta. */
export function proposalPlanGaps(p) {
  const gaps = [];
  if (p.admin_fee_pct == null) gaps.push('taxa de administração');
  if (p.reserve_fund_pct == null) gaps.push('fundo de reserva');
  if (!p.readjustment_index) gaps.push('índice de reajuste');
  if (p.has_adhesion == null) gaps.push('adesão (sim ou não)');
  if (p.has_adhesion === 1 && (p.adhesion_pct == null || !p.adhesion_months)) gaps.push('percentual e diluição da adesão');
  if (p.payment_modality === 'parcela_reduzida' && p.reducer_pct == null) gaps.push('% do fator redutor');
  if (!p.bid_deduction) gaps.push('abatimento do lance (parcela ou prazo)');
  if (!p.contemplation_month) gaps.push('projeção de contemplação (mês)');
  if (!p.quota_split_strategy) gaps.push('divisão das cotas');
  return gaps;
}

function proposalFields(p = {}, simulations = []) {
  const quotas = quotaList(p);
  return html`<div class="grid">
    <h4 class="full qual-form-title">Identificação<small>Plano, crédito e simulação de origem.</small></h4>
    ${simulations.length ? field({ name: 'simulation_id', label: 'Baseada na simulação', type: 'select', options: simulations.map((s) => ({ value: s.id, label: `${s.code} v${s.version} — ${fmtMoney(s.credit_value)}` })), value: p.simulation_id, placeholder: 'Nenhuma', help: 'Campos vazios são preenchidos com os dados da simulação.' }) : ''}
    ${field({ name: 'product_id', label: 'Plano', type: 'select', options: productItems(), value: p.product_id, help: 'Taxas, adesão e prazo do plano entram automaticamente quando ficam em branco.' })}
    ${field({ name: 'category', label: 'Categoria', type: 'select', options: opts('categoria_credito'), value: p.category })}
    ${field({ name: 'credit_value', label: 'Crédito total (R$)', type: 'money', value: p.credit_value })}
    ${field({ name: 'valid_until', label: 'Validade', type: 'date', value: p.valid_until })}
    ${field({ name: 'link_url', label: 'Link ou arquivo da proposta (URL)', type: 'url', value: p.link_url, full: true })}
    <h4 class="full qual-form-title">Características do plano<small>Os mesmos campos do simulador de propostas.</small></h4>
    ${field({ name: 'term_months', label: 'Prazo (meses)', type: 'number', value: p.term_months })}
    ${field({ name: 'initial_installment', label: 'Parcela inicial estimada (R$)', type: 'money', value: p.initial_installment })}
    ${field({ name: 'payment_modality', label: 'Modalidade de pagamento', type: 'select', options: opts('modalidade_pagamento'), value: p.payment_modality })}
    ${field({ name: 'reducer_pct', label: 'Fator redutor (% de redução)', type: 'number', value: p.reducer_pct, step: '0.01', help: 'Só para parcela reduzida.' })}
    ${field({ name: 'admin_fee_pct', label: 'Taxa de administração (%)', type: 'number', value: p.admin_fee_pct, step: '0.01' })}
    ${field({ name: 'reserve_fund_pct', label: 'Fundo de reserva (%)', type: 'number', value: p.reserve_fund_pct, step: '0.01' })}
    ${field({ name: 'insurance_pct', label: 'Seguro prestamista (% a.m.)', type: 'number', value: p.insurance_pct, step: '0.0001' })}
    ${field({ name: 'has_adhesion', label: 'Tem adesão?', type: 'select', options: ADHESION_OPTS, value: p.has_adhesion === 1 ? 'sim' : p.has_adhesion === 0 ? 'nao' : '' })}
    <div class="cond" data-if="has_adhesion=sim">${field({ name: 'adhesion_pct', label: 'Adesão (% do crédito)', type: 'number', value: p.adhesion_pct, step: '0.01' })}${field({ name: 'adhesion_months', label: 'Adesão diluída em (vezes)', type: 'number', value: p.adhesion_months, min: 1, step: 1 })}</div>
    ${field({ name: 'readjustment_index', label: 'Índice de reajuste', type: 'select', options: opts('indice_reajuste'), value: p.readjustment_index })}
    ${field({ name: 'readjustment_rate', label: 'Taxa estimada do índice (% a.a.)', type: 'number', value: p.readjustment_rate, step: '0.01' })}
    ${field({ name: 'embedded_bid_pct', label: 'Lance embutido (% do crédito)', type: 'number', value: p.embedded_bid_pct, step: '0.01' })}
    ${field({ name: 'bid_deduction', label: 'Abatimento do lance', type: 'select', options: DEDUCTION_OPTS, value: p.bid_deduction })}
    ${field({ name: 'contemplation_month', label: 'Projeção de contemplação (mês)', type: 'number', value: p.contemplation_month, min: 1, step: 1 })}
    ${field({ name: 'other_costs', label: 'Outros custos considerados', type: 'textarea', value: p.other_costs, full: true })}
    ${field({ name: 'readjustment_assumptions', label: 'Premissas de reajuste', type: 'textarea', value: p.readjustment_assumptions, full: true })}
    <h4 class="full qual-form-title">Estratégia e divisão das cotas<small>Como o crédito foi dividido e por quê.</small></h4>
    ${field({ name: 'strategy', label: 'Estratégia apresentada', type: 'select', options: opts('estrategia'), value: p.strategy })}
    ${field({ name: 'quota_split_strategy', label: 'Divisão das cotas', type: 'select', options: opts('divisao_cotas'), value: p.quota_split_strategy })}
    ${field({ name: 'quotas', label: 'Quantidade de cotas', type: 'number', value: p.quotas, min: 1, step: 1 })}
    ${field({ name: 'quota_values', label: 'Crédito de cada cota (R$, separados por ;)', value: quotas.join('; '), placeholder: 'ex.: 250000; 250000; 250000; 250000', help: 'A soma precisa ser igual ao crédito total.' })}
    ${field({ name: 'quota_split_notes', label: 'Lógica da divisão', type: 'textarea', value: p.quota_split_notes, full: true, placeholder: 'ex.: 4 cotas de R$ 250 mil em grupos diferentes para aumentar as chances de contemplação por lance.' })}
    ${field({ name: 'notes', label: 'Observações', type: 'textarea', value: p.notes, full: true })}
  </div>`;
}

/** Visão da proposta em blocos (somente leitura). */
function proposalBlocks(p) {
  const row = (label, v, full) => html`<div class="${full ? 'full' : ''}"><dt>${label}</dt><dd>${v == null || v === '' ? html`<span class="muted">—</span>` : v}</dd></div>`;
  const quotas = quotaList(p);
  return html`<div class="qual-blocks prop-blocks">
    <div class="qual-block"><h4>Identificação</h4><dl>
      ${row('Proposta', html`<strong>${p.code}</strong> · versão ${p.version}`)}
      ${row('Status', badge(K('proposal_status', p.status), `st-${p.status}`))}
      ${row('Cliente', html`<a href="#/leads/${p.contact_id}">${p.contact_code} — ${p.contact_name}</a>`)}
      ${row('Negócio', html`<a href="#/oportunidades/${p.opportunity_id}">${p.opportunity_code}</a>`)}
      ${row('Simulação', p.simulation_code)}
      ${row('Responsável', p.owner_name)}
      ${row('Criada em', fmtDateTime(p.created_at))}
      ${row('Apresentada em', p.presented_at ? fmtDateTime(p.presented_at) : null)}
      ${row('Validade', p.valid_until ? fmtDate(p.valid_until) : null)}
      ${row('Link', p.link_url ? html`<a href="${p.link_url}" target="_blank" rel="noopener noreferrer">abrir a proposta</a>` : null)}
    </dl></div>
    <div class="qual-block"><h4>Características do plano</h4><dl>
      ${row('Plano', p.product_name ? html`${p.product_name}${p.plan_code ? html` <small class="muted">${p.plan_code}</small>` : ''}` : null)}
      ${row('Administradora', p.administrator_name)}
      ${row('Categoria', optLabel('categoria_credito', p.category))}
      ${row('Crédito total', fmtMoney(p.credit_value))}
      ${row('Prazo', p.term_months ? `${p.term_months} meses` : null)}
      ${row('Parcela inicial', p.initial_installment != null ? fmtMoney(p.initial_installment) : null)}
      ${row('Modalidade', p.payment_modality ? html`${optLabel('modalidade_pagamento', p.payment_modality)}${p.reducer_pct != null ? ` · redutor de ${pctTxt(p.reducer_pct)}` : ''}` : null)}
      ${row('Taxa de administração', pctTxt(p.admin_fee_pct))}
      ${row('Fundo de reserva', pctTxt(p.reserve_fund_pct))}
      ${row('Seguro prestamista', p.insurance_pct != null ? `${pctTxt(p.insurance_pct, 4)} a.m.` : null)}
      ${row('Adesão', p.has_adhesion === 1 ? `Sim · ${pctTxt(p.adhesion_pct) || '% não informado'} em ${p.adhesion_months ? `${p.adhesion_months} vez(es)` : '— vezes'}` : p.has_adhesion === 0 ? 'Não' : null)}
      ${row('Índice de reajuste', p.readjustment_index ? html`${optLabel('indice_reajuste', p.readjustment_index)}${p.readjustment_rate != null ? ` (${pctTxt(p.readjustment_rate)} a.a.)` : ''}` : null)}
      ${row('Lance embutido', pctTxt(p.embedded_bid_pct))}
      ${row('Abatimento do lance', p.bid_deduction ? DEDUCTION_OPTS.find((o) => o.value === p.bid_deduction)?.label : null)}
      ${row('Projeção de contemplação', p.contemplation_month ? `mês ${p.contemplation_month}` : null)}
      ${p.other_costs ? row('Outros custos', p.other_costs, true) : ''}
      ${p.readjustment_assumptions ? row('Premissas de reajuste', p.readjustment_assumptions, true) : ''}
    </dl></div>
    <div class="qual-block"><h4>Estratégia e divisão das cotas</h4><dl>
      ${row('Estratégia', optLabel('estrategia', p.strategy))}
      ${row('Quantidade de cotas', p.quotas)}
      ${row('Divisão', optLabel('divisao_cotas', p.quota_split_strategy))}
      ${quotas.length ? row('Cotas', html`<span class="quota-chips">${quotas.map((v, i) => html`<span class="chip-sm">${i + 1}ª ${fmtMoney(v)}</span>`)}</span>`, true) : ''}
      ${row('Lógica da divisão', p.quota_split_notes, true)}
    </dl></div>
  </div>`;
}

export function proposalForm(opp, simulations = [], { simulation_id } = {}) {
  return modal({
    title: `Nova proposta — ${opp.code}`,
    wide: true,
    body: html`${proposalFields({ simulation_id, product_id: opp.product_id, quotas: opp.quotas, strategy: opp.strategy, credit_value: opp.credit_value, payment_modality: opp.payment_modality }, simulations)}
      ${field({ name: 'status', label: 'Salvar como', type: 'select', options: [{ value: 'rascunho', label: 'Rascunho' }, { value: 'apresentada', label: 'Apresentada ao cliente' }], value: 'rascunho', allowEmpty: false })}`,
    onMount(form) {
      bindQualForm(form);
    },
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
  const gaps = proposalPlanGaps(p);
  const body = html`
    ${editable ? proposalFields(p) : proposalBlocks(p)}
    ${!editable && gaps.length && !final ? html`<div class="alert warn small">Conferência com o simulador: falta informar ${gaps.join(', ')}. Para completar, crie uma nova versão.</div>` : ''}
    ${!editable && can.write() ? html`<div class="prop-notes"><label for="prop-notes"><strong>Observações</strong> <small class="muted">ficam salvas na proposta e no histórico</small></label>
      <textarea id="prop-notes" name="notes_edit" rows="3" placeholder="Inclua uma informação sobre esta proposta">${p.notes || ''}</textarea>
      <div class="inline-actions"><button type="button" class="btn small" data-act="save-notes">Salvar observação</button></div></div>`
      : !editable && p.notes ? html`<p class="small"><strong>Observações:</strong> ${p.notes}</p>` : ''}
    ${p.accepted_at ? html`<div class="alert">Aceite em ${fmtDate(p.accepted_at)} via ${optLabel('canal_aceite', p.accepted_channel)}. Próxima etapa: <a href="#/prevenda">pré-venda</a>.</div>` : ''}
    ${['apresentada', 'em_analise'].includes(p.status) && can.write() ? html`<div class="inline-actions"><label>Retorno do cliente <select name="response"><option value="">—</option>${opts('resposta_proposta').map((o) => html`<option value="${o.value}" ${p.last_response === o.value ? raw('selected') : ''}>${o.label}</option>`)}</select></label><button type="button" class="btn small" data-act="response">Registrar retorno</button>${p.last_response_at ? html`<small class="muted">último: ${fmtDateTime(p.last_response_at)}</small>` : ''}</div>` : ''}
    ${p.refusal_reason ? html`<div class="alert warn">Recusada${p.refused_at ? ` em ${fmtDate(p.refused_at)}` : ''}: <strong>${optLabel('motivo_recusa_proposta', p.refusal_reason)}</strong>.${p.refusal_notes ? ` ${p.refusal_notes}` : ''}${p.retake_at ? html`<br>Retomar contato em ${fmtDate(p.retake_at)}.` : ''}</div>` : ''}
    ${!final && can.write() ? html`<div class="inline-actions"><label>Alterar status para <select name="new_status"><option value="">—</option>${nextStatuses.map((s) => html`<option value="${s}">${K('proposal_status', s)}</option>`)}</select></label>
      <label class="st-extra st-aprovada" hidden>Canal do aceite <select name="accepted_channel"><option value="">Selecione…</option>${opts('canal_aceite').map((o) => html`<option value="${o.value}">${o.label}</option>`)}</select></label>
      <label class="st-extra st-aprovada" hidden>Data do aceite <input type="date" name="accepted_at" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label class="st-extra st-apresentada" hidden>Enviada por <select name="sent_channel"><option value="whatsapp">WhatsApp</option><option value="email">E-mail</option><option value="presencial">Presencial</option><option value="video">Videochamada</option></select></label>
      <label class="st-extra st-recusada" hidden>Motivo da recusa <select name="refusal_reason"><option value="">Selecione…</option>${opts('motivo_recusa_proposta').map((o) => html`<option value="${o.value}">${o.label}${o.flags?.recuperavel ? ' (recuperável)' : ''}</option>`)}</select></label>
      <label class="st-extra st-recusada" hidden>Detalhe <input name="refusal_notes" placeholder="O que o cliente disse?"></label>
      <label class="st-extra st-recusada" hidden>Retomar contato em <input type="date" name="retake_at"></label>
      <button type="button" class="btn small" data-act="apply-status">Aplicar</button></div>` : ''}
    ${p.status !== 'substituida' && can.write() ? html`<p><button type="button" class="btn small" data-act="new-version">Criar nova versão</button> <small class="muted">A versão atual será marcada como substituída (se ainda estiver em aberto) e preservada no histórico.</small></p>` : ''}
    <details class="prop-history"><summary>Versões e histórico de alterações</summary>
    <h4>Versões</h4>
    <ul class="versions">${p.versions.map((v) => html`<li class="${v.current ? 'current' : ''}"><a href="#" data-proposal="${v.id}">${v.code} · v${v.version}</a> — ${K('proposal_status', v.status)} · ${fmtDateTime(v.created_at)}</li>`)}</ul>
    <h4>Histórico de alterações</h4>
    <ul class="audit">${p.history.map((h) => html`<li>${fmtDateTime(h.created_at)} · ${h.user_name || 'Sistema'} · ${h.action}${h.changes ? html` <code>${JSON.stringify(h.changes)}</code>` : ''}</li>`)}</ul></details>`;
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
      if (editable) bindQualForm(form);
      on(form, 'click', '[data-act=save-notes]', async () => {
        try {
          await patch(`/api/propostas/${p.id}`, { notes: form.notes_edit.value });
          toast('Observação salva.');
          onChange?.();
        } catch (e) {
          toastError(e);
        }
      });
      form.new_status?.addEventListener('change', () => {
        $$('.st-extra', form).forEach((el) => (el.hidden = !el.classList.contains(`st-${form.new_status.value}`)));
      });
      on(form, 'click', '[data-act=apply-status]', async () => {
        const s = form.new_status.value;
        if (!s) return;
        try {
          await post(`/api/propostas/${p.id}/status`, { status: s, accepted_channel: form.accepted_channel?.value, accepted_at: form.accepted_at?.value, refusal_reason: form.refusal_reason?.value, refusal_notes: form.refusal_notes?.value, retake_at: form.retake_at?.value || undefined, sent_channel: form.sent_channel?.value });
          if (s === 'aprovada') toast('Aceite registrado. A pré-venda foi aberta (veja em Pré-venda).');
          else if (s === 'apresentada') toast('Proposta enviada: a esteira de follow-up D0 a D10 foi criada na agenda.');
          else toast('Status atualizado.');
          close(true);
          onChange?.();
        } catch (e) {
          toastError(e);
        }
      });
      on(form, 'click', '[data-act=response]', async () => {
        if (!form.response.value) return;
        try {
          await post(`/api/propostas/${p.id}/resposta`, { response: form.response.value });
          toast('Retorno registrado. A probabilidade de fechamento foi atualizada.');
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
