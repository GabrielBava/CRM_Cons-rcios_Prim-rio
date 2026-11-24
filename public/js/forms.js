// Formulários compartilhados entre as telas (modais).
import { get, post, patch } from './api.js';
import {
  html, raw, esc, modal, field, opts, toItems, userItems, productItems, state, toast, toastError, K, optLabel, fmtMoney, fmtDate,
  fmtDateTime, badge, $, $$, on, confirmDialog, can, stageById, table, todayLocal } from './ui.js';
import { qualFormFields, bindQualForm } from './qualification.js';
import { transcriptFlow } from './r1.js';
import { downloadLeadTemplate } from './lead-import.js';
import { icon } from './icons.js';
import { linkBadge, readTime, optionButtons, bindOptionButtons } from './proposal-actions.js';
import { scheduleMeetingDialog } from './meeting.js';

const nav = (hash) => (location.hash = hash);

/* ------------------------- Cadastro rápido ------------------------- */

function dupList(dups) {
  return html`<div class="dup-box"><strong>Possível duplicidade encontrada:</strong><ul>${dups.map(
    (d) => html`<li>${d.visible
      ? html`<a href="#/leads/${d.id}" data-open-dup>${d.code} — ${d.name}</a> <small>(${d.reasons.join(', ')} · responsável: ${d.owner_name || '—'})</small>`
      : html`${d.code} — cadastro de outro responsável (${d.owner_name}) <small>(${d.reasons.join(', ')}). Solicite acesso ao gestor.</small>`}</li>`,
  )}</ul></div>`;
}

/**
 * Novo lead, em blocos: Dados (nome ou empresa, telefones, WhatsApp e e-mail), Origem (origem, campanha/ação, CPF/CNPJ e
 * CEP opcionais), Área (área de interesse, responsável = usuário atual, tipo prospect ou lead) e Geral (observações).
 * Telefone, e-mail ou CPF/CNPJ já existentes na base geram só um alerta: o cadastro é salvo assim mesmo.
 */
export function quickCreateContact(defaults = {}) {
  const me = state.user;
  const areas = opts('area_negocio');
  const block = (title, ic, inner) => html`<fieldset class="lead-block"><legend>${icon(ic, 15)} ${title}</legend><div class="grid">${inner}</div></fieldset>`;
  const body = html`
    ${defaults.referral_id ? html`<div class="referral-box"><span class="badge ok">Indicação</span> <span>Indicado por <strong>${defaults.referral_from}</strong></span>
      ${field({ name: 'referral_note', label: 'Comentário da indicação', type: 'textarea', rows: 2, full: true, placeholder: `Ex.: ${defaults.referral_from} indicou o cliente; ele quer trocar de carro no próximo ano.` })}</div>` : ''}
    ${block('Dados', 'leads', html`
      ${field({ name: 'name', label: 'Nome completo ou empresa', required: true, full: true, value: defaults.name })}
      ${field({ name: 'phone1', label: 'Telefone principal', type: 'tel', placeholder: '(11) 91234-5678', value: defaults.phone1 })}
      ${field({ name: 'phone2', label: 'Telefone secundário', type: 'tel' })}
      ${field({ name: 'whatsapp', label: 'WhatsApp', type: 'tel', value: defaults.whatsapp, placeholder: 'Se for diferente do telefone' })}
      ${field({ name: 'email', label: 'E-mail', type: 'email', value: defaults.email })}`)}
    ${block('Origem', 'entrada', html`
      ${field({ name: 'origin', label: 'Origem do lead', type: 'select', options: opts('origem'), value: defaults.origin || (defaults.referral_id && opts('origem').some((o) => o.value === 'indicacao') ? 'indicacao' : undefined) })}
      ${field({ name: 'campaign', label: 'Campanha / ação' })}
      ${field({ name: 'doc', label: 'CPF ou CNPJ (opcional)' })}
      ${field({ name: 'cep', label: 'CEP (opcional)', placeholder: '00000-000', maxlength: 9 })}`)}
    ${block('Área', 'consorcio', html`
      ${field({ name: 'business_area', label: 'Área de interesse', type: 'select', options: areas, value: defaults.business_area || 'consorcio', allowEmpty: false })}
      <div class="field"><label>Responsável</label><input value="${me.name}" readonly disabled title="O lead fica com quem o cadastrou"></div>
      ${field({ name: 'relationship', label: 'Tipo', type: 'select', options: [{ value: 'prospect', label: 'Prospect' }, { value: 'lead', label: 'Lead' }], value: defaults.relationship || 'lead', allowEmpty: false })}`)}
    ${block('Geral', 'lista', html`${field({ name: 'initial_notes', label: 'Observações', type: 'textarea', rows: 3, full: true })}`)}
    <div class="dup-live" aria-live="polite"></div>
    ${can.write() && !defaults.referral_id ? html`<p class="small muted import-line">Tem uma base de leads? <button type="button" class="link-btn" data-lead-import>Importar planilha</button> · <button type="button" class="link-btn" data-lead-template>baixar o modelo</button></p>` : ''}`;
  return modal({
    title: defaults.referral_id ? 'Novo lead · indicação' : 'Novo lead',
    wide: true,
    body,
    submitLabel: 'Salvar cadastro',
    onMount(form, close) {
      on(form, 'click', '[data-open-dup]', () => close(null));
      on(form, 'click', '[data-lead-template]', () => downloadLeadTemplate());
      on(form, 'click', '[data-lead-import]', () => {
        close(null);
        nav('#/importar');
      });
      // Alerta de duplicidade (telefone, WhatsApp, e-mail ou CPF/CNPJ já na base): só avisa, não impede o cadastro
      const check = async () => {
        const d = { phone1: form.phone1.value, phone2: form.phone2.value || form.whatsapp.value, email: form.email.value, doc: form.doc.value };
        if (!d.phone1 && !d.phone2 && !d.email && !d.doc) return;
        try {
          const r = await post('/api/cadastros/verificar-duplicidade', d);
          $('.dup-live', form).innerHTML = r.duplicates.length ? String(html`${dupList(r.duplicates)}<p class="small muted">É só um alerta: confira se não é o mesmo cliente. O cadastro pode ser salvo.</p>`) : '';
        } catch {}
      };
      ['phone1', 'phone2', 'whatsapp', 'email', 'doc'].forEach((n) => form[n]?.addEventListener('blur', check));
      form.cep.addEventListener('input', () => {
        const v = form.cep.value.replace(/\D/g, '').slice(0, 8);
        form.cep.value = v.length > 5 ? `${v.slice(0, 5)}-${v.slice(5)}` : v;
      });
    },
    async onSubmit(d) {
      const docDigits = String(d.doc || '').replace(/\D/g, '');
      const kind = docDigits.length === 14 ? 'PJ' : 'PF';
      const payload = { ...d, kind, owner_id: me.id, create_opportunity: true, confirm_duplicate: true };
      if (kind === 'PJ') {
        payload.trade_name = d.name;
        payload.contact_name = d.name;
        payload.contact_phone = d.phone1;
        payload.contact_email = d.email;
      }
      if (defaults.referral_id) payload.referral_id = defaults.referral_id;
      const r = await post('/api/cadastros', payload);
      const dupCodes = (r.duplicates_confirmed || []).map((x) => x.code).filter(Boolean);
      toast(`${defaults.referral_id ? `Indicação cadastrada: ${r.code} já está no seu pipeline.` : `Cadastro ${r.code} criado.`}${dupCodes.length ? ` Atenção: dados parecidos com ${dupCodes.join(', ')}.` : ''}`);
      if (defaults.after) defaults.after(r);
      else if (!defaults.stay) nav(`#/leads/${r.id}`);
      return r;
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
      ${task ? '' : field({ name: 'type', label: 'Tipo', type: 'select', options: toItems(state.meta.constants.task_types).filter((t) => t.value !== 'reuniao'), value: type && type !== 'reuniao' ? type : 'retorno', allowEmpty: false, help: 'Para a R1, use o botão "Agendar R1" (cliente, horário, Google Agenda e convite).' })}
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
    ${field({ name: 'business_area', label: 'Área responsável', type: 'select', options: opts('area_negocio'), value: o.business_area || 'consorcio', allowEmpty: false })}
    ${field({ name: 'priority', label: 'Prioridade no funil', type: 'select', options: toItems(state.meta.constants.priorities), value: o.priority || 'media', allowEmpty: false })}
    ${field({ name: 'owner_id', label: 'Responsável', type: 'select', options: userItems(), value: o.owner_id || state.user.id, allowEmpty: false, disabled: !can.manage() })}
    ${field({ name: 'co_owner_id', label: 'Co-responsável (ex.: especialista de outra área)', type: 'select', options: userItems(), value: o.co_owner_id, placeholder: 'Nenhum' })}
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
    body: html`${opp ? html`<div class="import-banner r1-banner"><div><strong>Transcrição da R1</strong><small>Anexe o arquivo da reunião: os campos identificados preenchem o que ainda está pendente (os já preenchidos não mudam).</small></div><div class="import-banner-actions"><button type="button" class="btn small primary" data-r1-attach>Anexar transcrição da R1</button></div></div>` : ''}${opportunityFields(opp || { owner_id: contact.owner_id }, contact.company_contacts || [], contact.kind)}`,
    onMount(form, close) {
      bindQualForm(form);
      on(form, 'click', '[data-r1-attach]', async () => {
        // Aplicada a transcrição, o formulário fecha para recarregar com os campos preenchidos
        const r = await transcriptFlow(opp);
        if (r) close(true);
      });
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
  const from = stageById(opp.stage_id);
  // Regras de passagem (avanço): Tentativa exige uma tentativa registrada; Qualificação, a qualificação concluída;
  // Negociação, uma proposta gerada. Faltando, abre o pop-up que resolve o critério (e o negócio avança junto).
  const forward = from?.kind === 'aberta' && to.kind === 'aberta' && to.position > from.position;
  if (forward && ['tentativa', 'qualificado', 'negociacao'].includes(to.key)) {
    return get(`/api/oportunidades/${opp.id}/criterios`, { stage_id: to.id })
      .then(async (r) => {
        const miss = (k) => r.criteria.some((c) => c.key === k && !c.ok);
        let optouts = opp.optouts || opp.contact_optouts || [];
        if (typeof optouts === 'string') try { optouts = JSON.parse(optouts); } catch { optouts = []; }
        if (miss('tentativa_registrada')) return attemptDialog({ id: opp.contact_id, name: opp.contact_name, optouts }, { opportunity_id: opp.id, stageName: to.name });
        if (miss('qualificacao_concluida')) return qualifyDialog(opp.id);
        if (miss('proposta_gerada')) return proposalNeededDialog(opp);
        return moveStageDialog(opp, to, from);
      })
      .catch((e) => (toastError(e), null));
  }
  // Até a R1 (Prospect, Lead, Tentativa ou Qualificação) → R1: abre o agendamento da R1 ("Ganho") e move junto.
  // R1 → R2: abre o agendamento da R2. Já existe reunião futura marcada: só move.
  const meetingKind = (to.key === 'r1' && from?.kind === 'aberta' && from.position < to.position) ? 'r1' : (to.key === 'r2' && from?.kind === 'aberta' && from.position < to.position) ? 'r2' : null;
  if (meetingKind) {
    return get('/api/r1/contexto', { contact_id: opp.contact_id, kind: meetingKind })
      .then((ctx) => {
        if (ctx.pending.some((t) => new Date(t.due_at) > new Date())) return moveStageDialog(opp, to, from);
        return scheduleMeetingDialog({ contactId: opp.contact_id, oppId: opp.id, kind: meetingKind, moveTo: true, won: meetingKind === 'r1' });
      })
      .catch((e) => (toastError(e), null));
  }
  if (to.kind === 'perdido') {
    // Sem atividade registrada: o especialista é avisado; o administrador pode forçar com justificativa
    return get('/api/cadastros/' + opp.contact_id + '/historico', { limit: 300 })
      .then((r) => {
        const worked = r.rows.some((a) => WORK_TYPES.includes(a.type));
        if (!worked && !can.admin()) {
          toast('Para dar o lead como perdido, registre antes ao menos uma atividade (ligação, WhatsApp, e-mail ou direct).', 'error');
          return null;
        }
        return lostDialog(opp, to, { force: !worked });
      })
      .catch((e) => (toastError(e), null));
  }
  return moveStageDialog(opp, to, from);
}

/** Atividades que liberam o "Perdido" (mesma lista do servidor). */
const WORK_TYPES = ['ligacao_realizada', 'tentativa_sem_atendimento', 'ligacao_recebida', 'mensagem_enviada', 'mensagem_recebida', 'email_enviado', 'email_recebido',
  'direct_enviado', 'direct_recebido', 'linkedin_enviado', 'linkedin_recebido', 'conversa_presencial', 'conversa_video', 'reuniao_realizada', 'reuniao_nao_realizada', 'observacao'];

/** Motivos de perda (MP): as 9 categorias, cada uma com a explicação, e o detalhe do que aconteceu. */
export function lostDialog(opp, to = state.meta.stages.find((s) => s.kind === 'perdido'), { force = false } = {}) {
  const list = opts('motivo_perda');
  return modal({
    title: `Perdido — ${opp.contact_name || opp.code}`,
    wide: true,
    submitLabel: 'Marcar como perdido',
    danger: true,
    body: html`<p class="small muted">Escolha o motivo da perda (MP). Ele alimenta os relatórios e o dashboard da squad. Só é possível dar como perdido depois de registrar ao menos uma atividade com o lead.</p>
      <div class="mp-grid" role="radiogroup" aria-label="Motivo da perda">${list.map((o, i) => html`<label class="mp-opt"><input type="radio" name="lost_reason" value="${o.value}" ${i === -1 ? raw('checked') : ''}><span><strong>${o.label}</strong>${o.flags?.hint ? html`<small>${o.flags.hint}</small>` : ''}</span></label>`)}</div>
      ${field({ name: 'lost_notes', label: 'O que aconteceu (detalhe)', type: 'textarea', rows: 2, full: true, placeholder: 'Ex.: achou a parcela alta; vai retomar quando vender o carro.' })}
      ${force ? html`<div class="alert warn small">Este lead ainda não tem nenhuma atividade registrada. Como administrador, você pode dar como perdido mesmo assim, com a justificativa (fica na auditoria).</div>${field({ name: 'reason', label: 'Justificativa', type: 'textarea', rows: 2, full: true, required: true, placeholder: 'Ex.: cadastro duplicado; lead de teste' })}` : ''}`,
    async onSubmit(d) {
      if (!d.lost_reason) throw new Error('Escolha o motivo da perda (MP).');
      const r = await post(`/api/oportunidades/${opp.id}/etapa`, { stage_id: to.id, lost_reason: d.lost_reason, lost_notes: d.lost_notes, ...(force ? { force: true, reason: d.reason } : {}) });
      toast('Lead marcado como perdido.');
      return r;
    },
  });
}

function moveStageDialog(opp, to, from) {
  let body;
  const backward = !!from && from.kind === 'aberta' && to.kind === 'aberta' && to.position < from.position;
  if (to.kind === 'nutricao') {
    const d = new Date(Date.now() + 30 * 86400000);
    d.setHours(10, 0, 0, 0);
    body = html`<p>Mover <strong>${opp.code}</strong> para <strong>${to.name}</strong> (arquivado). Será criada uma tarefa para retomar o contato na data escolhida.</p><div class="grid">
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
      const payload = { stage_id: to.id, reason: d.reason, pause_reason: d.pause_reason, return_at: d.return_at, force: d.force, ganho: to.key === 'r1' && !backward };
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

/* ------------------------- Regras de passagem: tentativa, qualificação e proposta ------------------------- */

/** Canais do registro rápido de atividade (bloco "Registrar atividade" e pop-up da tentativa). */
export const CONTACT_CHANNELS = [
  { key: 'ligacao', label: 'Telefone', icon: 'telefone', type: 'ligacao_realizada' },
  { key: 'whatsapp', label: 'WhatsApp', icon: 'whatsapp', type: 'mensagem_enviada' },
  { key: 'email', label: 'E-mail', icon: 'email', type: 'email_enviado' },
  { key: 'direct', label: 'Direct', icon: 'direct', type: 'direct_enviado' },
  { key: 'linkedin', label: 'LinkedIn', icon: 'linkedin', type: 'linkedin_enviado' },
];


// Resultados que indicam que não houve contato: sugerem "Nova tentativa de contato" como próxima ação
const NO_CONTACT = ['nao_atendida', 'ocupado', 'caixa_postal', 'numero_invalido', 'interrompida', 'sem_resposta', 'visualizou', 'nao_entregue'];
const tomorrow10 = () => {
  const d = new Date(Date.now() + 86400000);
  if (d.getDay() === 6) d.setDate(d.getDate() + 2);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
};

/** Campos da atividade: canal, resultado (por canal), observação e a próxima ação em lista (vira a tarefa de aproximação). */
function contactActivityFields(channel, { blocked = [], nextDefault = '' } = {}) {
  return html`${blocked.length ? html`<div class="alert danger small">Oposição a contato: ${blocked.includes('todos') ? 'todos os canais' : blocked.map((c) => K('contact_channels', c)).join(', ')}.</div>` : ''}
    <div class="chan-pick" role="radiogroup" aria-label="Canal">${CONTACT_CHANNELS.map((c) => html`<label class="chan-opt ch-${c.key}"><input type="radio" name="type" value="${c.type}" ${c.key === channel ? raw('checked') : ''}><span>${icon(c.icon, 20)}<strong>${c.label}</strong></span></label>`)}</div>
    <div class="grid">
      <div class="field"><label for="f_result">Resultado</label><select name="result" id="f_result" required></select></div>
      <div class="field"><label for="f_next">Próxima ação</label><select name="next_kind" id="f_next"><option value="">Nenhuma</option>${opts('proxima_acao').map((o) => html`<option value="${o.value}" ${o.value === nextDefault ? raw('selected') : ''}>${o.label}</option>`)}</select></div>
      ${field({ name: 'notes', label: 'Observação', type: 'textarea', rows: 2, full: true, placeholder: 'Ex.: liguei para apresentar a Vero; não atendeu, deixei mensagem no WhatsApp.' })}
      <div class="field next-when" hidden>${field({ name: 'return_at', label: 'Quando', type: 'datetime', value: tomorrow10() })}</div>
    </div>`;
}
/** Liga a troca de canal (resultados de ligação ou de mensagem) e a sugestão de nova tentativa quando não houve contato. */
function bindContactActivity(form) {
  const fill = () => {
    const call = form.querySelector('input[name=type]:checked')?.value === 'ligacao_realizada';
    const list = opts(call ? 'resultado_ligacao' : 'resultado_mensagem').filter((o) => !['nao_informado'].includes(o.value));
    const cur = form.result.value;
    form.result.innerHTML = String(html`<option value="">Selecione…</option>${list.map((o) => html`<option value="${o.value}" ${o.value === cur ? raw('selected') : ''}>${o.label}</option>`)}`);
  };
  const syncNext = () => ($('.next-when', form).hidden = !form.next_kind.value);
  on(form, 'change', 'input[name=type]', fill);
  form.result.addEventListener('change', () => {
    if (NO_CONTACT.includes(form.result.value) && !form.next_kind.value) form.next_kind.value = 'nova_tentativa';
    syncNext();
  });
  form.next_kind.addEventListener('change', syncNext);
  fill();
  syncNext();
}
/** Payload da atividade (a ligação sem atendimento vira "tentativa sem atendimento"). */
function contactActivityPayload(d) {
  if (!d.type) throw new Error('Escolha o canal.');
  if (!d.result) throw new Error('Informe o resultado da ação.');
  const payload = { type: d.type, result: d.result, notes: d.notes, occurred_at: new Date().toISOString() };
  if (d.type === 'ligacao_realizada' && ['nao_atendida', 'ocupado', 'caixa_postal', 'numero_invalido', 'interrompida'].includes(d.result)) payload.type = 'tentativa_sem_atendimento';
  if (d.next_kind) {
    payload.next_action = opts('proxima_acao').find((o) => o.value === d.next_kind)?.label || d.next_kind;
    payload.return_at = d.return_at || tomorrow10();
  }
  return payload;
}

/**
 * Registrar atividade (painel do lead) ou tentativa de contato (Lead → Tentativa): canal, resultado do que foi feito,
 * observação e próxima ação (lista). A próxima ação vira uma tarefa de aproximação, que só pode ser concluída.
 */
export function attemptDialog(contact, { opportunity_id, channel = 'ligacao', stageName = 'Tentativa de contato', quick = false } = {}) {
  return modal({
    title: `${quick ? 'Registrar atividade' : 'Registrar tentativa de contato'} — ${contact.name || ''}`,
    wide: true,
    submitLabel: quick ? 'Registrar' : 'Registrar e avançar',
    body: html`${quick ? '' : html`<p class="hint">Para o lead entrar em <strong>${stageName}</strong> é preciso ao menos uma tentativa de contato registrada. Escolha o canal usado:</p>`}
      ${contactActivityFields(channel, { blocked: contact.optouts || [] })}`,
    onMount(form) {
      bindContactActivity(form);
    },
    async onSubmit(d) {
      await post('/api/atividades', { ...contactActivityPayload(d), contact_id: contact.id, opportunity_id });
      toast(d.next_kind ? 'Atividade registrada e próxima ação criada em Tarefas.' : quick ? 'Atividade registrada.' : 'Tentativa registrada: o lead está em Tentativa de contato.');
      return true;
    },
  });
}

/**
 * Concluir tarefa do painel do lead: registra o que foi feito (canal, resultado e observação) e, se ainda não houve
 * contato, já cria a próxima ação — e assim por diante até o contato. Tarefas sem contato com o cliente podem ser
 * concluídas só com a observação (as de aproximação, não).
 */
export function completeTaskWithActivity(task, contact) {
  const approach = !!task.source_activity_id;
  const chan = /whats/i.test(task.title) ? 'whatsapp' : /e-?mail/i.test(task.title) ? 'email' : /direct|instagram/i.test(task.title) ? 'direct' : /linkedin/i.test(task.title) ? 'linkedin' : 'ligacao';
  return modal({
    title: `Concluir: ${task.title}`,
    wide: true,
    submitLabel: 'Concluir tarefa',
    body: html`${approach ? html`<p class="hint">Tarefa de aproximação: registre o que você fez e o resultado. Sem contato? Escolha a próxima ação: uma nova tarefa é criada até conseguir falar com o cliente.</p>` : html`<label class="check full"><input type="checkbox" name="no_contact" value="1"> Tarefa sem contato com o cliente (concluir só com a observação)</label>`}
      <div class="act-fields">${contactActivityFields(chan, { blocked: contact.optouts || [] })}</div>`,
    onMount(form) {
      bindContactActivity(form);
      const sync = () => {
        const off = !!form.no_contact?.checked;
        $('.act-fields .chan-pick', form).hidden = off;
        form.result.closest('.field').hidden = off;
        form.result.required = !off;
      };
      form.no_contact?.addEventListener('change', sync);
      sync();
    },
    async onSubmit(d) {
      if (d.no_contact) {
        await patch(`/api/tarefas/${task.id}`, { action: 'concluir', notes: d.notes });
        if (d.next_kind) await post('/api/tarefas', { contact_id: contact.id, opportunity_id: task.opportunity_id, title: opts('proxima_acao').find((o) => o.value === d.next_kind)?.label, due_at: d.return_at || tomorrow10(), type: 'retorno' });
      } else {
        await patch(`/api/tarefas/${task.id}`, { action: 'concluir', activity: contactActivityPayload(d) });
      }
      toast(d.next_kind ? 'Tarefa concluída e próxima ação criada.' : 'Tarefa concluída.');
      return true;
    },
  });
}

/**
 * Concluir a qualificação (Tentativa → Qualificação): o formulário da qualificação com o botão "Concluir qualificação".
 * Ao menos um campo precisa estar preenchido; ao concluir, o negócio vai para a etapa Qualificação.
 */
export async function qualifyDialog(oppId) {
  let o;
  try {
    o = await get(`/api/oportunidades/${oppId}`);
  } catch (e) {
    toastError(e);
    return null;
  }
  return modal({
    title: `Qualificação — ${o.contact_name || o.code}`,
    wide: true,
    submitLabel: 'Concluir qualificação',
    body: html`<p class="hint">Preencha o que conseguiu levantar com o cliente (ao menos um campo) e clique em <strong>Concluir qualificação</strong>: o lead vai para a etapa Qualificação. O que ficar em branco pode ser completado depois da R1.</p>
      ${o.qualified_at ? html`<div class="alert ok-alert small">Qualificação concluída em ${fmtDateTime(o.qualified_at)}${o.qualified_by_name ? ` por ${o.qualified_by_name}` : ''}.</div>` : ''}
      <div class="grid">${field({ name: 'business_area', label: 'Área responsável', type: 'select', options: opts('area_negocio'), value: o.business_area || 'consorcio', allowEmpty: false })}${qualFormFields(o, o.contact_kind || 'PF')}</div>`,
    onMount(form) {
      bindQualForm(form);
    },
    async onSubmit(d) {
      const fields = Object.fromEntries(Object.entries(d).filter(([, v]) => v != null && v !== ''));
      const r = await post(`/api/oportunidades/${o.id}/concluir-qualificacao`, { fields });
      toast(r.moved ? 'Qualificação concluída: o lead está em Qualificação.' : 'Qualificação concluída.');
      return r;
    },
  });
}

/** Áreas da proposta, na ordem do pop-up "Gerar proposta". */
export const PROPOSAL_AREAS = [
  { value: 'consorcio', label: 'Consórcio', icon: 'consorcio' },
  { value: 'planejamento', label: 'Planejamento financeiro', icon: 'planejamento' },
  { value: 'seguros', label: 'Seguros', icon: 'seguros' },
  { value: 'investimentos', label: 'Investimentos', icon: 'investimentos' },
];

/** Proposta de seguros, planejamento financeiro ou investimentos: descrição, valor, validade e link. */
export function areaProposalForm(opp, area = 'seguros') {
  const a = PROPOSAL_AREAS.find((x) => x.value === area) || PROPOSAL_AREAS[1];
  const ph = { seguros: 'Ex.: Seguro de vida — capital de R$ 500 mil, prêmio mensal de R$ 180, seguradora X.', planejamento: 'Ex.: Planejamento financeiro completo — 6 encontros, honorário de R$ 2.400.', investimentos: 'Ex.: Migração de carteira de R$ 350 mil para a assessoria — perfil moderado.' }[a.value];
  return modal({
    title: `Proposta de ${a.label.toLowerCase()} — ${opp.contact_name || opp.code}`,
    wide: true,
    submitLabel: 'Gerar proposta',
    body: html`<div class="grid">
      ${field({ name: 'description', label: 'Descrição da proposta', type: 'textarea', rows: 3, full: true, required: true, placeholder: ph })}
      ${field({ name: 'credit_value', label: a.value === 'seguros' ? 'Valor (capital segurado ou prêmio, R$)' : a.value === 'investimentos' ? 'Valor da captação (R$)' : 'Valor da proposta (R$)', type: 'money' })}
      ${field({ name: 'valid_until', label: 'Validade', type: 'date' })}
      ${field({ name: 'link_url', label: 'Link ou arquivo da proposta (URL)', type: 'url', full: true })}
      ${field({ name: 'notes', label: 'Observações', type: 'textarea', rows: 2, full: true })}
      ${field({ name: 'status', label: 'Salvar como', type: 'select', options: [{ value: 'rascunho', label: 'Rascunho' }, { value: 'apresentada', label: 'Apresentada ao cliente' }], value: 'apresentada', allowEmpty: false })}
    </div>`,
    async onSubmit(d) {
      const r = await post('/api/propostas', { ...d, area: a.value, opportunity_id: opp.id });
      toast(r.moved ? `Proposta ${r.code} gerada: o negócio foi para Negociação.` : `Proposta ${r.code} gerada.`);
      return r;
    },
  });
}

/** Carta contemplada (consórcio): crédito disponível, entrada (ágio), parcelas restantes e administradora. */
export function contempladaForm(opp) {
  return modal({
    title: `Carta contemplada — ${opp.contact_name || opp.code}`,
    wide: true,
    submitLabel: 'Gerar proposta',
    body: html`<p class="hint">Carta já contemplada (crédito disponível após a transferência). A proposta entra em Propostas como consórcio e segue a régua de follow-up quando enviada.</p>
    <div class="grid">
      ${field({ name: 'credit_value', label: 'Crédito da carta (R$)', type: 'money', required: true })}
      ${field({ name: 'entry_value', label: 'Entrada / ágio (R$)', type: 'money' })}
      ${field({ name: 'remaining_installments', label: 'Parcelas restantes', type: 'number', min: 1 })}
      ${field({ name: 'initial_installment', label: 'Valor da parcela (R$)', type: 'money' })}
      ${field({ name: 'administrator_id', label: 'Administradora', type: 'select', options: admItems({}) })}
      ${field({ name: 'category', label: 'Categoria', type: 'select', options: opts('categoria_credito') })}
      ${field({ name: 'description', label: 'Detalhes da carta', type: 'textarea', rows: 2, full: true, placeholder: 'Ex.: grupo 1234, cota 56; transferência em até 15 dias após a aprovação do cadastro.' })}
      ${field({ name: 'valid_until', label: 'Validade', type: 'date' })}
      ${field({ name: 'status', label: 'Salvar como', type: 'select', options: [{ value: 'rascunho', label: 'Gerada (ainda não enviada)' }, { value: 'apresentada', label: 'Apresentada ao cliente' }], value: 'rascunho', allowEmpty: false })}
    </div>`,
    async onSubmit(d) {
      const r = await post('/api/propostas', { ...d, area: 'consorcio', consortium_kind: 'contemplada', opportunity_id: opp.id });
      toast(r.moved ? `Proposta ${r.code} gerada: o negócio foi para Negociação.` : `Proposta ${r.code} gerada.`);
      return r;
    },
  });
}

/**
 * Gerar proposta: Consórcio abre o simulador com o nome e o contato do cliente; Planejamento só com o diagnóstico
 * financeiro concluído (escolha do modelo); Seguros e Investimentos ainda não estão liberados.
 */
export async function newProposalFlow(opp, contact) {
  const cid = contact?.id || opp.contact_id;
  let diag = null;
  try {
    diag = (await get(`/api/cadastros/${cid}/diagnostico`)).current;
  } catch {
    diag = null;
  }
  const planOk = diag?.status === 'concluido';
  const avail = {
    consorcio: [true, 'Abre o simulador com o nome e o contato do cliente.'],
    planejamento: [planOk, planOk ? 'Diagnóstico concluído: escolha o modelo.' : 'Liberado depois de concluir o diagnóstico financeiro do lead.'],
    seguros: [false, 'Em breve.'],
    investimentos: [false, 'Em breve.'],
  };
  const area = await modal({
    title: `Gerar proposta — ${opp.contact_name || contact?.name || opp.code}`,
    body: html`<p class="hint">A proposta aparece em Propostas e libera a etapa Negociação.</p>
      <div class="area-pick">${PROPOSAL_AREAS.map((x) => html`<button type="button" class="area-card area-${x.value}" data-area="${x.value}" ${avail[x.value][0] ? '' : raw('disabled aria-disabled="true"')}>${icon(x.icon, 22)}<strong>${x.label}</strong><small>${avail[x.value][1]}</small></button>`)}</div>
      <p class="small muted">Carta contemplada? <button type="button" class="link-btn" data-area="contemplada">Registrar carta contemplada</button></p>`,
    onMount(form, close) {
      on(form, 'click', '[data-area]:not([disabled])', (e, b) => close(b.dataset.area));
    },
  });
  if (!area) return null;
  if (area === 'consorcio') return openProposalSimulator(contact || { id: opp.contact_id, name: opp.contact_name }, opp.id);
  if (area === 'contemplada') return contempladaForm(opp);
  if (area === 'planejamento' && planOk) {
    const { diagProposalDialog } = await import('./leadtabs.js');
    return diagProposalDialog(diag);
  }
  return null;
}

/** R2 → Negociação sem proposta: explica a regra e leva para a geração da proposta. */
async function proposalNeededDialog(opp) {
  const go = await modal({
    title: 'Negociação exige proposta',
    body: html`<p>Para o negócio <strong>${opp.code}</strong> entrar em <strong>Negociação</strong>, gere a proposta para o cliente — de consórcio, seguros, planejamento financeiro ou investimentos. Ela aparece em Propostas e o negócio avança automaticamente.</p>`,
    submitLabel: 'Gerar proposta',
    onSubmit: () => true,
  });
  if (!go) return null;
  let full = opp;
  try {
    full = await get(`/api/oportunidades/${opp.id}`);
  } catch {
    /* segue com o que tem */
  }
  return newProposalFlow(full, null);
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

/**
 * "Gerar simulação": abre o Simulador de consórcio da Vero numa nova guia, já com o nome e o contato do cliente
 * (?crm=<id do cadastro>), e registra aqui a data, a hora e quem gerou (os valores ficam no simulador).
 * A guia abre antes da chamada à API para não ser bloqueada pelo navegador.
 */
export async function quickSimulation(contactId, oppId) {
  window.open(new URL(`ferramentas/simulador-consorcio.html?crm=${Number(contactId)}`, document.baseURI).href, '_blank', 'noopener');
  try {
    const r = await post(`/api/cadastros/${contactId}/simulacao-rapida`, { opportunity_id: oppId || undefined });
    toast(`Simulação ${r.code} registrada em ${fmtDateTime(r.created_at)}. O simulador abriu numa nova guia com os dados do cliente.`);
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
      toast(`Proposta ${r.code} iniciada: o simulador abriu com o nome e o contato do cliente. Ao gerar o PDF, os valores e o PDF voltam para o CRM.`);
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

/* Administradora e plano da proposta: só os cadastrados e ativos (guia Planos) ou "Outros" */
const planOf = (id) => state.meta.products.find((x) => x.id === Number(id));
const admItems = (p = {}) => (state.meta.administrators || []).filter((a) => a.active || a.id === p.administrator_id).map((a) => ({ value: a.id, label: a.name }));
function planItems(admId, p = {}) {
  if (!admId) return [];
  const list = state.meta.products.filter((x) => x.administrator_id === Number(admId) && (x.active || x.id === p.product_id));
  return [...list.map((x) => ({ value: x.id, label: `${x.plan_code ? `${x.plan_code} · ` : ''}${x.name}${x.active ? '' : ' (inativo)'}` })), { value: 'outros', label: 'Outros (condições livres)' }];
}
/** Liga administradora → planos e aplica as condições do plano cadastrado (taxa e fundo de reserva ficam travados). */
export function bindPlanFields(form) {
  if (!form.administrator_id || !form.product_id) return;
  const lock = () => {
    const pl = planOf(form.product_id.value);
    for (const [f, k] of [['admin_fee_pct', 'admin_fee_pct'], ['reserve_fund_pct', 'reserve_fund_pct']]) {
      if (!form[f]) continue;
      const fixed = !!pl && pl[k] != null;
      form[f].readOnly = fixed;
      form[f].closest('.field')?.classList.toggle('locked', fixed);
    }
  };
  form.administrator_id.addEventListener('change', () => {
    const items = planItems(form.administrator_id.value);
    form.product_id.innerHTML = String(html`<option value="">Selecione…</option>${items.map((o) => html`<option value="${o.value}">${o.label}</option>`)}`);
    lock();
  });
  form.product_id.addEventListener('change', () => {
    const pl = planOf(form.product_id.value);
    if (pl) {
      const set = (f, v) => form[f] && v != null && (form[f].value = v);
      set('admin_fee_pct', pl.admin_fee_pct);
      set('reserve_fund_pct', pl.reserve_fund_pct);
      set('insurance_pct', pl.insurance_pct);
      set('term_months', pl.term_months);
      if (form.category && pl.category) form.category.value = pl.category;
      if (form.has_adhesion) {
        form.has_adhesion.value = pl.adhesion ? 'sim' : 'nao';
        form.has_adhesion.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (pl.adhesion) {
        set('adhesion_pct', pl.adhesion_pct);
        set('adhesion_months', pl.adhesion_months);
      }
      if (pl.embedded_bid) set('embedded_bid_pct', pl.embedded_bid_pct);
      if (form.readjustment_index && pl.readjustment_index && [...form.readjustment_index.options].some((o) => o.value === pl.readjustment_index)) form.readjustment_index.value = pl.readjustment_index;
    }
    lock();
  });
  lock();
}

function proposalFields(p = {}, simulations = []) {
  const quotas = quotaList(p);
  return html`<div class="grid">
    <h4 class="full qual-form-title">Identificação<small>Plano, crédito e simulação de origem.</small></h4>
    ${simulations.length ? field({ name: 'simulation_id', label: 'Baseada na simulação', type: 'select', options: simulations.map((s) => ({ value: s.id, label: `${s.code} v${s.version} — ${fmtMoney(s.credit_value)}` })), value: p.simulation_id, placeholder: 'Nenhuma', help: 'Campos vazios são preenchidos com os dados da simulação.' }) : ''}
    ${field({ name: 'administrator_id', label: 'Administradora', type: 'select', options: admItems(p), value: p.administrator_id ?? planOf(p.product_id)?.administrator_id, required: true })}
    ${field({ name: 'product_id', label: 'Plano', type: 'select', options: planItems(p.administrator_id ?? planOf(p.product_id)?.administrator_id, p), value: p.plan_other ? 'outros' : p.product_id, required: true, help: 'Só os planos ativos da guia Planos. "Outros": condições livres, informadas pelo especialista.' })}
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
      ${row('Proposta', html`<strong>${String(p.code).replace(/-v\d+$/, '')}</strong> · versão ${p.version}`)}
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
    ${p.area && p.area !== 'consorcio' ? html`<div class="qual-block"><h4>Proposta de ${(PROPOSAL_AREAS.find((x) => x.value === p.area)?.label || p.area).toLowerCase()}</h4><dl>
      ${row('Área', PROPOSAL_AREAS.find((x) => x.value === p.area)?.label)}
      ${row('Valor', p.credit_value != null ? fmtMoney(p.credit_value) : null)}
      ${row('Descrição', p.description, true)}
      ${p.notes ? row('Observações', p.notes, true) : ''}
    </dl></div></div>` : html`<div class="qual-block"><h4>Características do plano</h4><dl>
      ${row('Plano', p.plan_other ? html`Outros <small class="muted">condições informadas pelo especialista</small>` : p.product_name ? html`${p.plan_code ? html`<strong>${p.plan_code}</strong> · ` : ''}${p.product_name}` : null)}
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
  </div>`}`;
}

export function proposalForm(opp, simulations = [], { simulation_id } = {}) {
  return modal({
    title: `Nova proposta — ${opp.code}`,
    wide: true,
    body: html`${proposalFields({ simulation_id, product_id: planOf(opp.product_id)?.active ? opp.product_id : null, quotas: opp.quotas, strategy: opp.strategy, credit_value: opp.credit_value, payment_modality: opp.payment_modality }, simulations)}
      ${field({ name: 'status', label: 'Salvar como', type: 'select', options: [{ value: 'rascunho', label: 'Rascunho' }, { value: 'apresentada', label: 'Apresentada ao cliente' }], value: 'rascunho', allowEmpty: false })}`,
    onMount(form) {
      bindQualForm(form);
      bindPlanFields(form);
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
    ${p.status !== 'substituida' ? html`<div class="prop-linkbar"><div><strong>Link do cliente</strong> ${linkBadge(p)} <small class="muted">${p.link_views || 0} acesso(s) · ${readTime(p.link_seconds)} na proposta</small></div>${optionButtons(p)}</div>` : ''}
    ${p.consortium_kind === 'contemplada' ? html`<div class="alert info small">Carta contemplada: crédito ${fmtMoney(p.credit_value)}${p.entry_value != null ? ` · entrada ${fmtMoney(p.entry_value)}` : ''}${p.remaining_installments ? ` · ${p.remaining_installments} parcelas restantes${p.initial_installment ? ` de ${fmtMoney(p.initial_installment)}` : ''}` : ''}.</div>` : ''}
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
      <label class="st-extra st-aprovada" hidden>Data do aceite <input type="date" name="accepted_at" value="${todayLocal()}"></label>
      <label class="st-extra st-apresentada" hidden>Enviada por <select name="sent_channel"><option value="whatsapp">WhatsApp</option><option value="email">E-mail</option><option value="presencial">Presencial</option><option value="video">Videochamada</option></select></label>
      <label class="st-extra st-recusada" hidden>Motivo da recusa <select name="refusal_reason"><option value="">Selecione…</option>${opts('motivo_recusa_proposta').map((o) => html`<option value="${o.value}">${o.label}${o.flags?.recuperavel ? ' (recuperável)' : ''}</option>`)}</select></label>
      <label class="st-extra st-recusada" hidden>Detalhe <input name="refusal_notes" placeholder="O que o cliente disse?"></label>
      <label class="st-extra st-recusada" hidden>Retomar contato em <input type="date" name="retake_at"></label>
      <button type="button" class="btn small" data-act="apply-status">Aplicar</button></div>` : ''}
    ${p.status !== 'substituida' && can.write() ? html`<p><button type="button" class="btn small" data-act="new-version">Criar nova versão</button> <small class="muted">Abre o simulador com as condições desta proposta; ao clicar em "Atualizar proposta", o PDF e os novos valores entram na versão ${p.version + 1}. A versão atual fica no histórico.</small></p>` : ''}
    <details class="prop-history"><summary>Versões e histórico de alterações</summary>
    <h4>Versões</h4>
    <ul class="versions">${p.versions.map((v) => html`<li class="${v.current ? 'current' : ''}"><a href="#" data-proposal="${v.id}">${String(v.code).replace(/-v\d+$/, '')} · v${v.version}</a> — ${K('proposal_status', v.status)} · ${fmtDateTime(v.created_at)}</li>`)}</ul>
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
      if (editable) {
        bindQualForm(form);
        bindPlanFields(form);
      }
      bindOptionButtons(form, () => p, onChange);
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
          else if (s === 'apresentada') toast('Proposta enviada: a régua de follow-up (Dia 0 a Dia 21) foi criada na agenda.');
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
        // A nova versão abre no simulador com as condições atuais e o botão "Atualizar proposta"
        const w = window.open('about:blank', '_blank');
        try {
          const r = await post(`/api/propostas/${p.id}/nova-versao`, {});
          if (r.url && w) {
            w.opener = null;
            w.location.href = r.url;
          } else if (w) w.close();
          toast(`Versão ${r.version} da proposta ${String(r.code).replace(/-v\d+$/, '')} criada${r.url ? ': ajuste no simulador e clique em "Atualizar proposta"' : ''}.`);
          close(true);
          onChange?.();
          if (!w && r.url) await modal({ title: 'Abrir simulador', body: html`<p>O navegador bloqueou a nova janela.</p><p><a class="btn primary" href="${r.url}" target="_blank" rel="noopener noreferrer">Abrir simulador</a></p>` });
          proposalDetail(r.id, onChange);
        } catch (e) {
          if (w) w.close();
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
  const propItems = (contact?.proposals || []).map((p) => ({ value: p.id, label: `${String(p.code).replace(/-v\d+$/, '')} v${p.version} — ${K('proposal_status', p.status)}` }));
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
      ${field({ name: 'contract_number', label: 'Contrato da cota (nº na administradora)', value: k.contract_number })}
      ${field({ name: 'term_months', label: 'Prazo (meses)', type: 'number', value: k.term_months })}
      <h4 class="full qual-form-title">Crédito e parcela<small>O crédito contratado é o da venda; o disponível muda com reajustes e lances.</small></h4>
      ${field({ name: 'credit_value', label: 'Crédito contratado', type: 'money', value: k.credit_value })}
      ${field({ name: 'available_credit', label: 'Crédito disponível', type: 'money', value: k.available_credit, help: 'Em branco na criação: igual ao contratado.' })}
      ${field({ name: 'installment_initial', label: 'Parcela inicial', type: 'money', value: k.installment_initial ?? (contract ? null : undefined), help: 'Valor da parcela na contratação.' })}
      ${field({ name: 'installment_value', label: 'Parcela atual', type: 'money', value: k.installment_value, help: 'Ajustada pelo especialista de pós-venda (reajustes).' })}
      ${field({ name: 'quotas', label: 'Quantidade de cotas', type: 'number', value: k.quotas })}
      <h4 class="full qual-form-title">Datas<small>Contratação = venda; adesão = alocação da cota na administradora.</small></h4>
      ${field({ name: 'contracted_at', label: 'Data da contratação (venda)', type: 'date', value: k.contracted_at })}
      ${field({ name: 'adhesion_date', label: 'Data da adesão (alocação)', type: 'date', value: k.adhesion_date })}
      ${field({ name: 'next_readjustment_date', label: 'Próximo reajuste', type: 'date', value: k.next_readjustment_date })}
      ${field({ name: 'status', label: 'Status do contrato', type: 'select', options: opts('status_contrato'), value: k.status || 'em_formalizacao', allowEmpty: false })}
      ${field({ name: 'payment_modality', label: 'Modalidade de pagamento', type: 'select', options: opts('modalidade_pagamento'), value: k.payment_modality })}
      ${field({ name: 'strategy', label: 'Estratégia associada', type: 'select', options: opts('estrategia'), value: k.strategy })}
      ${field({ name: 'due_day', label: 'Dia de vencimento', type: 'number', value: k.due_day, min: 1, step: 1 })}
      ${field({ name: 'first_due_date', label: 'Primeiro vencimento', type: 'date', value: k.first_due_date })}
      ${field({ name: 'seller_id', label: 'Vendedor da venda', type: 'select', options: userItems(), value: k.seller_id, placeholder: 'Não informado' })}
      <h4 class="full qual-form-title">Contemplação<small>Sorteio, lance livre, fixo, fidelidade ou retido; o cliente escolhe usar o crédito (faturamento) ou vender a carta.</small></h4>
      ${field({ name: 'contemplated_at', label: 'Data da contemplação', type: 'date', value: k.contemplated_at })}
      ${field({ name: 'contemplation_type', label: 'Tipo de contemplação', type: 'select', options: opts('tipo_contemplacao'), value: k.contemplation_type })}
      ${field({ name: 'bid_value', label: 'Valor do lance', type: 'money', value: k.bid_value })}
      ${field({ name: 'contemplation_credit', label: 'Crédito disponível na contemplação', type: 'money', value: k.contemplation_credit })}
      ${field({ name: 'net_to_pay', label: 'Líquido a pagar', type: 'money', value: k.net_to_pay, help: 'Saldo devedor que o cliente ainda paga depois da contemplação.' })}
      ${field({ name: 'client_choice', label: 'Escolha do cliente', type: 'select', options: opts('escolha_contemplacao'), value: k.client_choice, placeholder: 'Ainda não decidiu' })}
      ${field({ name: 'acquired_asset', label: 'Bem adquirido', value: k.acquired_asset })}
      ${field({ name: 'sale_value', label: 'Valor de venda da carta', type: 'money', value: k.sale_value, help: 'Quando o cliente escolhe vender a carta contemplada.' })}
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
