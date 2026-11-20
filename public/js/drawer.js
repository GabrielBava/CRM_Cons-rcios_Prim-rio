// Painel lateral (gaveta) com o resumo do lead/cliente: consulta rápida sem sair da tela atual.
// Modelo de painel de lead: cabeçalho com Ganho/Perdido, bloco R1/R2 à direita e abas em carrossel.
import { get, post, patch } from './api.js';
import { html, raw, render, $, $$, on, state, badge, relBadge, optLabel, K, fmtMoney, fmtDate, fmtDateTime, relTime, can, empty, optoutBadge, modal, field, opts, userItems, toast, toastError, formData, avatar, hasModule } from './ui.js';
import { activityForm, taskForm, moveStage, lostDialog, completeTask, cancelTask, opportunityForm, proposalForm, proposalDetail, openProposalSimulator } from './forms.js';
import { qualProgress, qualBlocks, tempBadge } from './qualification.js';
import { scheduleMeetingDialog, meetingLinks, meetingCard, bindMeetingCards, R1_STAGES, MEETING_LABEL } from './meeting.js';
import { icon } from './icons.js';

const YES_NO = [{ value: 'sim', label: 'Sim' }, { value: 'nao', label: 'Não' }, { value: 'nao_sabe', label: 'Não sabe' }];

/** Troca de responsável (mesmas regras do "Transferir responsável" em massa): novo responsável, coluna e motivo. */
export function changeOwnerDialog(contact, opp) {
  return modal({
    title: `Trocar responsável — ${contact.name}`,
    body: html`<p class="muted small">Responsável atual: <strong>${contact.owner_name || 'sem responsável'}</strong></p>
      <div class="grid">${field({ name: 'owner_id', label: 'Novo responsável', type: 'select', options: userItems().filter((u) => u.value !== contact.owner_id), required: true, full: true })}
      ${opp ? field({ name: 'stage_id', label: 'Coluna do funil para o novo responsável', type: 'select', options: state.meta.stages.filter((x) => x.kind === 'aberta').map((x) => ({ value: x.id, label: x.name })), placeholder: 'Manter a etapa atual', full: true }) : ''}
      ${field({ name: 'reason', label: 'Motivo da transferência', type: 'textarea', rows: 2, full: true, required: true, placeholder: 'Ex.: redistribuição da carteira, férias, especialidade' })}</div>
      <p class="hint">O cadastro, os negócios abertos e as tarefas pendentes passam para o novo responsável, que recebe uma notificação.</p>`,
    submitLabel: 'Transferir',
    async onSubmit(d) {
      if (opp) {
        const r = await post('/api/oportunidades/lote', { action: 'responsavel', ids: [opp.id], owner_id: d.owner_id, stage_id: d.stage_id || undefined, reason: d.reason });
        if (r.failed) throw new Error(r.results[0]?.error || 'Não foi possível transferir.');
      } else {
        await post('/api/distribuicao', { contact_ids: [contact.id], method: 'redistribuicao', user_id: d.owner_id });
      }
      toast('Responsável alterado.');
      return true;
    },
  });
}

let current = null;

function close() {
  if (!current) return;
  const { el, onKey, opener } = current;
  el.classList.remove('open');
  document.removeEventListener('keydown', onKey);
  setTimeout(() => el.remove(), 200);
  current = null;
  opener?.focus?.();
}

const waLink = (n) => {
  const d = String(n || '').replace(/\D/g, '');
  return d ? `https://wa.me/${d.length <= 11 ? `55${d}` : d}` : null;
};

/** Campos do bloco "Negócio" editáveis no painel (os mesmos da qualificação, mais área e co-responsável). */
function bizForm(o) {
  return html`<div class="grid biz-grid">
    ${field({ name: 'business_area', label: 'Área responsável', type: 'select', options: opts('area_negocio'), value: o.business_area || 'consorcio', allowEmpty: false, full: true })}
    ${field({ name: 'co_owner_id', label: 'Co-responsável', type: 'select', options: userItems(), value: o.co_owner_id, placeholder: 'Nenhum', full: true })}
    ${field({ name: 'credit_category', label: 'Categoria de interesse', type: 'select', options: opts('categoria_credito'), value: o.credit_category, full: true })}
    ${field({ name: 'objective_type', label: 'Objetivo', type: 'select', options: opts('objetivo'), value: o.objective_type, full: true })}
    ${field({ name: 'credit_purpose_type', label: 'Finalidade do crédito', type: 'select', options: opts('finalidade_credito'), value: o.credit_purpose_type, full: true })}
    ${field({ name: 'product_type', label: 'Tipo de produto', type: 'select', options: opts('tipo_produto'), value: o.product_type, full: true })}
    ${field({ name: 'credit_value', label: 'Valor estimado (crédito desejado)', type: 'money', value: o.credit_value, full: true })}
    ${field({ name: 'urgency', label: 'Prioridade (quando quer)', type: 'select', options: opts('urgencia'), value: o.urgency, full: true })}
    ${field({ name: 'term_months', label: 'Prazo objetivo (meses)', type: 'number', value: o.term_months, min: 1, step: 1, full: true })}
    ${field({ name: 'installment_min', label: 'Parcela ideal', type: 'money', value: o.installment_min })}
    ${field({ name: 'installment_max', label: 'Parcela máxima', type: 'money', value: o.installment_max })}
    ${field({ name: 'had_consortium', label: 'Já teve consórcio', type: 'select', options: YES_NO, value: o.had_consortium, full: true })}
  </div>
  <div class="inline-actions"><button type="submit" class="btn small primary">Salvar</button><button type="button" class="btn small ghost" data-biz-cancel>Cancelar</button></div>`;
}

/** Abas do painel (carrossel). */
const TABS = [
  ['detalhes', 'Detalhes'], ['atividades', 'Atividades'], ['qualificacao', 'Qualificação'], ['tarefas', 'Tarefas'],
  ['agendas', 'Agendas'], ['notas', 'Notas'], ['propostas', 'Propostas'], ['historico', 'Histórico'],
];
/** Canais do filtro de atividades e o tipo usado no registro rápido. */
const CHANNELS = [
  ['ligacao', 'Telefone', 'ligacao_realizada', 'telefone'],
  ['whatsapp', 'WhatsApp', 'mensagem_enviada', 'whatsapp'],
  ['email', 'E-mail', 'email_enviado', 'email'],
  ['direct', 'Direct', 'direct_enviado', 'direct'],
];
/** O que conta como "trabalhar o lead" (libera o Perdido). Mesma lista do servidor. */
const WORK_TYPES = ['ligacao_realizada', 'tentativa_sem_atendimento', 'ligacao_recebida', 'mensagem_enviada', 'mensagem_recebida', 'email_enviado', 'email_recebido',
  'direct_enviado', 'direct_recebido', 'conversa_presencial', 'conversa_video', 'reuniao_realizada', 'reuniao_nao_realizada', 'observacao'];
const chanOf = (a) => a.channel || state.meta.constants.activity_types[a.type]?.channel || null;
const AUDIT_LABEL = {
  'contact:criado': 'Cadastro criado', 'contact:alterado': 'Cadastro alterado', 'contact:distribuido': 'Lead distribuído', 'contact:convertido_cliente': 'Virou cliente',
  'contact:mesclado': 'Cadastros mesclados', 'contact:ficha_enviada_email': 'Ficha cadastral enviada', 'contact:responsavel_pos_venda': 'Responsável do pós-venda',
  'opportunity:criada': 'Negócio criado', 'opportunity:alterada': 'Negócio alterado', 'opportunity:transferida': 'Responsável transferido',
  'opportunity:qualificacao_preenchida': 'Qualificação preenchida', 'opportunity:estrategia_validada': 'Estratégia validada', 'opportunity:transcricao_r1_anexada': 'Transcrição da R1 anexada',
  'task:criada': 'Tarefa criada', 'task:alterada': 'Tarefa alterada', 'task:concluida': 'Tarefa concluída', 'task:cancelada': 'Tarefa cancelada',
  'task:reuniao_remarcada': 'Reunião remarcada', 'task:reuniao_confirmada': 'Presença confirmada', 'task:confirmacao_desfeita': 'Confirmação desfeita', 'task:link_reuniao': 'Link da reunião salvo',
};
/** Nomes legíveis dos campos alterados (os demais aparecem como estão). */
const FIELD_LABEL = {
  next_action: 'próxima ação', next_action_at: 'data da próxima ação', business_area: 'área', credit_value: 'valor estimado', credit_category: 'categoria', objective_type: 'objetivo',
  urgency: 'prioridade', installment_min: 'parcela ideal', installment_max: 'parcela máxima', term_months: 'prazo', strategy: 'estratégia', owner_id: 'responsável', co_owner_id: 'co-responsável',
  titulo: 'título', tipo: 'tipo', prazo: 'prazo', resultado: 'resultado', email: 'e-mail', phone1: 'telefone', whatsapp: 'WhatsApp', temperature: 'temperatura', code: 'código', etapa: 'etapa',
};
const OUTCOME_LABEL = { realizada: 'realizada', nao_compareceu: 'não compareceu', remarcada: 'remarcada', cancelada: 'cancelada' };
const fmtVal = (v) => {
  if (v == null || v === '') return '—';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fmtDateTime(v);
  if (typeof v === 'string' && OUTCOME_LABEL[v]) return OUTCOME_LABEL[v];
  return String(v).length > 60 ? `${String(v).slice(0, 60)}…` : String(v);
};
const fmtChange = (v) => (Array.isArray(v) ? `${fmtVal(v[0])} → ${fmtVal(v[1])}` : typeof v === 'object' && v ? JSON.stringify(v) : fmtVal(v));

/**
 * Abre o painel com o cadastro. opts.oppId: negócio em foco (mostra etapa, valor e "mover etapa").
 * opts.onChange: chamado depois de uma alteração feita pelo painel (atividade, tarefa, etapa).
 */
export async function openLeadDrawer(contactId, { oppId = null, onChange = null, tab = null } = {}) {
  close();
  const el = document.createElement('div');
  el.className = 'drawer-wrap';
  el.innerHTML = '<div class="drawer-backdrop" data-close></div><aside class="drawer lead-drawer" role="dialog" aria-modal="true" aria-label="Painel do lead" tabindex="-1"><div class="drawer-body"><p class="muted">Carregando…</p></div></aside>';
  document.body.appendChild(el);
  // Esc fecha o painel só quando não há um pop-up aberto por cima dele
  const onKey = (e) => e.key === 'Escape' && !document.querySelector('.modal-backdrop') && close();
  document.addEventListener('keydown', onKey);
  current = { el, onKey, opener: document.activeElement, tab: tab || 'detalhes', chan: '' };
  requestAnimationFrame(() => el.classList.add('open'));
  const panel = $('.drawer', el);
  panel.focus();
  on(el, 'click', '[data-close]', close);

  const changed = async () => {
    await draw();
    onChange?.();
  };

  const draw = async () => {
    let c;
    let acts = [];
    let o = null;
    try {
      [c, acts] = await Promise.all([get(`/api/cadastros/${contactId}`), get(`/api/cadastros/${contactId}/historico`, { limit: 300 }).then((r) => r.rows).catch(() => [])]);
      const base = c.opportunities.find((x) => x.id === Number(oppId)) || c.opportunities.find((x) => x.status === 'aberta') || c.opportunities[0];
      if (base) o = await get(`/api/oportunidades/${base.id}`);
    } catch (e) {
      render($('.drawer-body', el), html`<div class="drawer-head"><h2>Cadastro</h2><button class="icon" data-close aria-label="Fechar">×</button></div><div class="alert danger">${e.message}</div>`);
      return;
    }
    if (!current) return;
    current.contact = c;
    current.opp = o;
    current.acts = acts;
    const w = can.write();
    const open = o && o.status === 'aberta';
    const worked = acts.some((a) => WORK_TYPES.includes(a.type));
    const m = o?.meetings || {};
    const showWon = w && open && R1_STAGES.includes(o.stage_key);
    const wa = waLink(c.whatsapp || c.phone1);
    const tabCount = {
      atividades: acts.filter((a) => a.type !== 'observacao' && !state.meta.constants.activity_types[a.type]?.system).length,
      tarefas: c.tasks.filter((t) => t.status === 'pendente').length,
      agendas: c.tasks.filter((t) => t.type === 'reuniao').length,
      notas: acts.filter((a) => a.type === 'observacao').length,
      propostas: c.proposals.filter((p) => p.status !== 'substituida').length,
    };
    render($('.drawer-body', el), html`
      <header class="lead-head">
        <div class="lead-id">${avatar({ name: c.name }, 48)}
          <div class="grow"><h2>${c.name}</h2>
            <small class="muted">${c.trade_name ? `${c.trade_name} · ` : ''}<span class="badge pfpj">${c.kind}</span> ID ${c.code} · desde ${fmtDate(c.created_at)}</small>
            <div class="badges">${relBadge(c.relationship)} ${o?.temperature ? tempBadge(o.temperature, o.temperature_info) : c.temperature ? tempBadge(c.temperature) : ''} ${o ? html`<span class="chip-sm area area-${o.business_area || 'consorcio'}">${optLabel('area_negocio', o.business_area || 'consorcio')}</span>` : ''} ${o?.score != null ? html`<span class="score s-${o.score >= 70 ? 'hi' : o.score >= 40 ? 'mid' : 'lo'}" title="Score do lead">${o.score}</span>` : ''} ${o?.sla ? badge(o.sla.text, { ok: 'ok', atencao: 'warn', estourado: 'danger' }[o.sla.level]) : ''} ${optoutBadge(c.optouts)}</div>
          </div>
          <button class="icon" data-close aria-label="Fechar painel">×</button>
        </div>
        ${o ? html`<div class="lead-stage">
          ${w && o.status !== 'ganha' ? html`<label class="stage-pill kind-${o.stage_kind}"><span class="sr-only">Etapa</span><select data-dmove aria-label="Mover etapa"><option value="">${o.stage_name}${o.status === 'pausada' ? ' (arquivado)' : ''}</option>${state.meta.stages.filter((st) => st.id !== o.stage_id && st.kind !== 'ganho').map((st) => html`<option value="${st.id}">→ ${st.name}</option>`)}</select></label>` : badge(o.stage_name, `kind-${o.stage_kind}`)}
          <span class="muted small">${o.days_in_stage}d na etapa · ${o.owner_name || 'sem responsável'}${o.co_owner_name ? ` + ${o.co_owner_name}` : ''}</span>
          <span class="grow"></span>
          ${showWon ? html`<button class="btn small success" data-dact="won" title="Ganho = R1 agendada: abre o agendamento e leva o lead para a coluna R1">Ganho</button>` : ''}
          ${w && o && ['aberta', 'pausada'].includes(o.status) ? html`<button class="btn small danger-solid" data-dact="lost" data-force="${!worked && can.admin() ? '1' : ''}" ${worked || can.admin() ? '' : raw('aria-disabled="true"')} title="${worked ? 'Dar o lead como perdido (motivo MP)' : can.admin() ? 'Sem atividade registrada: como administrador, informe a justificativa' : 'Registre ao menos uma atividade antes de dar o lead como perdido'}">Perdido</button>` : ''}
        </div>` : ''}
        <div class="lead-contact">
          ${c.phone1 ? html`<a href="tel:${String(c.phone1).replace(/[^\d+]/g, '')}" title="Ligar">${icon('telefone', 14)} ${c.phone1}</a>` : ''}
          ${wa ? html`<a href="${wa}" target="_blank" rel="noopener" title="Abrir o WhatsApp">${icon('whatsapp', 14)} WhatsApp</a>` : ''}
          ${wa && hasModule('whatsapp') ? html`<a href="#/comunicacao/whatsapp?contato=${c.id}" data-close title="Conversar pelo WhatsApp oficial da empresa (fica no CRM)">${icon('chat', 14)} WhatsApp da empresa</a>` : ''}
          ${c.email ? html`<a href="mailto:${c.email}" title="Enviar e-mail">${icon('email', 14)} ${c.email}</a>` : ''}
          <a href="#/leads/${c.id}" data-close class="muted">Abrir cadastro completo →</a>
        </div>
      </header>
      <div class="lead-cols">
        <div class="lead-main">
          <nav class="tab-carousel" aria-label="Seções do lead"><button type="button" class="tc-arrow" data-tc="-1" aria-label="Abas anteriores">‹</button>
            <div class="tc-track" role="tablist">${TABS.map(([k, label]) => html`<button type="button" role="tab" class="tc-tab ${current.tab === k ? 'active' : ''}" aria-selected="${current.tab === k}" data-tab="${k}">${label}${tabCount[k] ? html`<span class="count">${tabCount[k]}</span>` : ''}</button>`)}</div>
            <button type="button" class="tc-arrow" data-tc="1" aria-label="Próximas abas">›</button></nav>
          <div class="tab-body" data-tab-body></div>
        </div>
        <aside class="lead-side" aria-label="Reuniões">
          ${o ? html`
            <h4>Reuniões</h4>
            ${meetingCard('r1', m.r1, { write: w && ['aberta', 'pausada'].includes(o.status), canSchedule: open })}
            ${meetingCard('r2', m.r2, { write: w && ['aberta', 'pausada'].includes(o.status), canSchedule: open && (m.r1?.state === 'realizada' || o.stage_key === 'r2') })}
            ${meetingStats(c.tasks)}` : html`<p class="muted small">Sem negócio aberto. <a href="#/leads/${c.id}" data-close>Abrir o cadastro</a> para criar.</p>`}
          ${w ? html`<div class="side-actions"><button class="btn small" data-dact="task">Nova tarefa</button><a class="btn small ghost" href="#/agenda" data-close>Abrir agenda</a></div>` : ''}
        </aside>
      </div>`);
    drawTab();
  };

  /** Indicadores de reuniões do lead: agendadas, realizadas, remarcadas e no-show. */
  const meetingStats = (tasks) => {
    const ms = tasks.filter((t) => t.type === 'reuniao');
    if (!ms.length) return '';
    const n = (f) => ms.filter(f).length;
    return html`<div class="mt-kpis"><div><strong>${ms.length}</strong><small>agendadas</small></div><div><strong>${n((t) => t.outcome === 'realizada')}</strong><small>realizadas</small></div><div><strong>${n((t) => t.outcome === 'remarcada')}</strong><small>remarcadas</small></div><div class="${n((t) => t.outcome === 'nao_compareceu') ? 'ns' : ''}"><strong>${n((t) => t.outcome === 'nao_compareceu')}</strong><small>no-show</small></div></div>`;
  };

  const drawTab = async () => {
    const box = $('[data-tab-body]', el);
    if (!box || !current) return;
    const { contact: c, opp: o, acts, tab } = current;
    const w = can.write();
    const edit = w && o && ['aberta', 'pausada'].includes(o.status);
    if (tab === 'detalhes') {
      render(box, html`
        ${o ? html`<section class="biz-info"><div class="section-head"><h4>Negócio ${o.code}</h4>${edit ? html`<button type="button" class="btn small ghost" data-dact="edit-biz">Editar</button>` : ''}</div>
          <form class="biz-form" hidden>${bizForm(o)}</form>
          <dl class="kv-list biz-view">
            <div><dt>Área responsável</dt><dd>${optLabel('area_negocio', o.business_area || 'consorcio')}</dd></div>
            <div><dt>Valor estimado</dt><dd>${o.deal_value ? html`${fmtMoney(o.deal_value)} <small class="muted">${o.deal_value_source === 'proposta' ? 'proposta' : 'desejado'}</small>` : '—'}</dd></div>
            <div><dt>Categoria</dt><dd>${optLabel('categoria_credito', o.credit_category) || '—'}</dd></div>
            <div><dt>Objetivo</dt><dd>${optLabel('objetivo', o.objective_type) || '—'}</dd></div>
            <div><dt>Prioridade (quando quer)</dt><dd>${optLabel('urgencia', o.urgency) || '—'}</dd></div>
            <div><dt>Capacidade de parcela</dt><dd>${o.installment_min || o.installment_max ? html`${o.installment_min ? `ideal ${fmtMoney(o.installment_min)}` : ''}${o.installment_min && o.installment_max ? html`<br>` : ''}${o.installment_max ? `máxima ${fmtMoney(o.installment_max)}` : ''}` : '—'}</dd></div>
            <div><dt>Próxima ação</dt><dd>${o.next_action ? html`${o.next_action}${o.next_action_at ? html`<br><small class="${new Date(o.next_action_at) < new Date() ? 'overdue' : ''}">${fmtDateTime(o.next_action_at)} · ${relTime(o.next_action_at)}</small>` : ''}` : html`<span class="warn-text">sem próxima ação</span>`}</dd></div>
            <div><dt>Score / SLA</dt><dd>${o.score ?? '—'} pontos${o.sla ? html`<br><small>${o.sla.text}</small>` : ''}</dd></div>
          </dl>
          <p><a href="#/oportunidades/${o.id}" data-close>Ver negócio completo →</a></p></section>` : ''}
        <section><h4>Contato</h4><dl class="kv-list">
          <div><dt>Telefone</dt><dd>${c.phone1 || '—'}</dd></div>
          <div><dt>WhatsApp</dt><dd>${c.whatsapp || '—'}</dd></div>
          <div><dt>E-mail</dt><dd>${c.email || '—'}</dd></div>
          <div><dt>Cidade</dt><dd>${c.city ? `${c.city}${c.state ? `/${c.state}` : ''}` : '—'}</dd></div>
          <div><dt>Origem e campanha</dt><dd>${optLabel('origem', c.origin) || '—'}${o?.campaign || c.campaign ? html`<br><small>${o?.campaign || c.campaign}</small>` : ''}</dd></div>
          <div><dt>Responsável</dt><dd class="owner-dd">${c.owner_name || '—'}${can.manage() && w ? html`<button type="button" class="gear-btn" data-dact="owner" title="Trocar responsável" aria-label="Trocar responsável">${icon('configuracoes', 15)}</button>` : ''}</dd></div>
        </dl></section>
        ${c.contracts.length ? html`<section><h4>Produtos contratados</h4><p>${c.contracts.length} carta(s) · ${fmtMoney(c.contracts.reduce((t, k) => t + (k.credit_value || 0), 0))}</p></section>` : ''}`);
    } else if (tab === 'atividades') {
      const work = acts.filter((a) => a.type !== 'observacao' && !state.meta.constants.activity_types[a.type]?.system);
      const list = work.filter((a) => !current.chan || chanOf(a) === current.chan);
      render(box, html`
        ${w ? html`<div class="quick-acts">${CHANNELS.map(([, label, type, ic]) => html`<button type="button" class="btn small" data-quick="${type}">${icon(ic, 14)} ${label}</button>`)}<button type="button" class="btn small ghost" data-quick="">Outra…</button></div>` : ''}
        <div class="chip-filter" role="group" aria-label="Filtrar por canal"><button type="button" class="chip ${!current.chan ? 'active' : ''}" data-chan="">Todas</button>${CHANNELS.map(([k, label]) => html`<button type="button" class="chip ${current.chan === k ? 'active' : ''}" data-chan="${k}">${label} <small>${work.filter((a) => chanOf(a) === k).length}</small></button>`)}</div>
        ${list.length ? html`<ul class="feed">${list.map((a) => html`<li class="ch-${chanOf(a) || 'outro'}"><div><strong>${K('activity_types', a.type)}</strong>${a.result ? html` · ${optLabel('resultado_ligacao', a.result)}` : ''} <small class="muted">${fmtDateTime(a.occurred_at)} · ${a.user_name || 'Sistema'}</small></div>${a.notes ? html`<p>${a.notes}</p>` : ''}</li>`)}</ul>` : empty('Nenhuma atividade neste filtro.')}`);
    } else if (tab === 'qualificacao') {
      render(box, o ? html`<div class="section-head"><h4>Qualificação</h4>${edit ? html`<button type="button" class="btn small" data-dact="edit-qual">Editar qualificação</button>` : ''}</div>
        ${qualProgress(o, c.kind)}${qualBlocks(o, c.kind)}` : empty('Sem negócio para qualificar.'));
    } else if (tab === 'tarefas') {
      const tasks = c.tasks.filter((t) => t.type !== 'reuniao' || t.status === 'pendente');
      render(box, html`<div class="section-head"><h4>Tarefas</h4>${w ? html`<span class="inline-actions"><button type="button" class="btn small primary" data-dact="task">Nova tarefa</button><a class="btn small ghost" href="#/agenda" data-close>Agenda de tarefas</a></span>` : ''}</div>
        ${tasks.length ? html`<ul class="feed tasks">${tasks.map((t) => html`<li class="${t.status === 'pendente' && new Date(t.due_at) < new Date() ? 'overdue' : ''} st-${t.status}"><div><strong>${t.title}</strong> <small class="muted">${K('task_types', t.type)} · ${fmtDateTime(t.due_at)}${t.status === 'pendente' ? ` · ${relTime(t.due_at)}` : ''}</small></div>
          ${t.status === 'pendente' && w && t.type !== 'reuniao' ? html`<div class="inline-actions"><button type="button" class="btn small primary" data-task-done="${t.id}">Concluir</button><button type="button" class="btn small ghost" data-task-cancel="${t.id}">Cancelar</button></div>` : t.status !== 'pendente' ? html`<small>${t.status === 'concluida' ? 'Concluída' : 'Cancelada'}${t.completed_at ? ` em ${fmtDate(t.completed_at)}` : ''}</small>` : html`<small class="muted">Reunião: use o bloco ao lado.</small>`}</li>`)}</ul>` : empty('Nenhuma tarefa.')}`);
    } else if (tab === 'agendas') {
      const ms = c.tasks.filter((t) => t.type === 'reuniao').sort((x, y) => (x.due_at < y.due_at ? 1 : -1));
      const kindL = (t) => MEETING_LABEL[t.meeting_kind] || (String(t.title).startsWith('[R2]') ? 'R2' : 'R1');
      const out = (t) => (t.status === 'pendente' ? badge(new Date(t.due_at) < new Date() ? 'Aguardando resultado' : 'Agendada', 'warn') : t.outcome === 'realizada' ? badge('Realizada', 'ok') : t.outcome === 'nao_compareceu' ? html`<span class="badge ns">Não compareceu (NS)</span>` : t.outcome === 'remarcada' ? html`<span class="badge rm">Remarcada</span>` : badge(K('meeting_outcomes', t.outcome) || 'Cancelada', 'muted'));
      render(box, html`<div class="section-head"><h4>Histórico de agendas</h4>${w && o?.status === 'aberta' ? html`<span class="inline-actions"><button type="button" class="btn small" data-mt-new="r1">Agendar R1</button><button type="button" class="btn small" data-mt-new="r2">Agendar R2</button></span>` : ''}</div>
        ${ms.length ? html`<ul class="feed meetings">${ms.map((t) => html`<li><div><span class="badge kind-meet">${kindL(t)}</span> <strong>${fmtDateTime(t.due_at)}</strong>${t.ends_at ? html` <small>às ${new Date(t.ends_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small>` : ''} ${out(t)} ${t.confirmed_at ? badge('presença confirmada', 'ok') : ''}${t.rescheduled_from ? html` <small class="muted">(remarcação)</small>` : ''}</div>
          <small class="muted">${t.title} · ${t.assigned_name || '—'}</small>${t.notes ? html`<p class="small">${t.notes}</p>` : ''}${t.status === 'pendente' ? html`<div>${meetingLinks(t)}</div>` : ''}</li>`)}</ul>` : empty('Nenhuma reunião agendada para este lead.')}`);
    } else if (tab === 'notas') {
      const notes = acts.filter((a) => a.type === 'observacao');
      render(box, html`${w ? html`<form class="note-form" data-note><textarea name="notes" rows="3" placeholder="Escreva uma nota sobre o lead (fica no histórico e conta como atividade)" required></textarea><div class="inline-actions"><button type="submit" class="btn small primary">Salvar nota</button></div></form>` : ''}
        ${notes.length ? html`<ul class="feed notes">${notes.map((a) => html`<li><p>${a.notes}</p><small class="muted">${a.user_name || '—'} · ${fmtDateTime(a.occurred_at)}</small></li>`)}</ul>` : empty('Nenhuma nota.')}`);
    } else if (tab === 'propostas') {
      const props = c.proposals;
      render(box, html`<div class="section-head"><h4>Propostas do lead</h4>${edit ? html`<span class="inline-actions"><button type="button" class="btn small primary" data-dact="prop-sim">Gerar proposta</button><button type="button" class="btn small" data-dact="prop-new">Registrar proposta</button></span>` : ''}</div>
        ${props.length ? html`<ul class="feed">${props.map((p) => html`<li><div><a href="#" data-prop="${p.id}"><strong>${p.code}</strong></a> · ${fmtMoney(p.credit_value)}${p.term_months ? ` · ${p.term_months} meses` : ''} ${badge(K('proposal_status', p.status), `st-${p.status}`)}</div><small class="muted">${fmtDateTime(p.created_at)}${p.product_name ? ` · ${p.product_name}` : ''}${p.refusal_reason ? ` · recusa: ${optLabel('motivo_recusa_proposta', p.refusal_reason)}` : ''}</small></li>`)}</ul>` : empty('Nenhuma proposta gerada para este lead.')}`);
    } else if (tab === 'historico') {
      render(box, html`<p class="muted small">Carregando o histórico…</p>`);
      let audit = [];
      try {
        audit = await get(`/api/cadastros/${c.id}/auditoria`);
      } catch {
        audit = [];
      }
      if (!current || current.tab !== 'historico') return;
      const items = [
        ...(o?.stage_history || []).map((h) => ({ at: h.moved_at, title: h.from_stage_name ? `${h.from_stage_name} → ${h.to_stage_name}` : `Entrou em ${h.to_stage_name}`, who: h.user_name || 'Sistema', text: h.reason, cls: 'stage' })),
        ...audit.filter((a) => !['etapa_alterada', 'etapa_forcada'].includes(a.action)).map((a) => ({ at: a.created_at, title: AUDIT_LABEL[`${a.entity}:${a.action}`] || String(a.action).replace(/_/g, ' '), who: a.user_name || 'Sistema', text: a.changes ? Object.entries(a.changes).filter(([k]) => !['custom', 'updated_at'].includes(k)).slice(0, 5).map(([k, v]) => `${FIELD_LABEL[k] || k.replace(/_/g, ' ')}: ${fmtChange(v)}`).join(' · ') : '', cls: a.entity })),
        ...acts.filter((a) => ['reuniao_agendada', 'reuniao_nao_realizada', 'simulacao', 'proposta', 'pos_venda'].includes(a.type)).map((a) => ({ at: a.occurred_at, title: K('activity_types', a.type), who: a.user_name || 'Sistema', text: a.notes, cls: 'activity' })),
      ].sort((x, y) => (x.at < y.at ? 1 : -1));
      render(box, items.length ? html`<ol class="hist">${items.map((i) => html`<li class="h-${i.cls}"><strong>${i.title}</strong> <small class="muted">${fmtDateTime(i.at)} · ${i.who}</small>${i.text ? html`<div class="small">${i.text}</div>` : ''}</li>`)}</ol>` : empty('Sem movimentações registradas.'));
    }
  };

  // Abas (carrossel): clique na aba ou nas setas
  on(el, 'click', '[data-tab]', (e, b) => {
    current.tab = b.dataset.tab;
    $$('[data-tab]', el).forEach((x) => {
      x.classList.toggle('active', x === b);
      x.setAttribute('aria-selected', String(x === b));
    });
    b.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    drawTab();
  });
  on(el, 'click', '[data-tc]', (e, b) => {
    const i = TABS.findIndex(([k]) => k === current.tab);
    const next = TABS[(i + Number(b.dataset.tc) + TABS.length) % TABS.length][0];
    $(`[data-tab="${next}"]`, el)?.click();
  });
  on(el, 'click', '[data-chan]', (e, b) => {
    current.chan = b.dataset.chan;
    drawTab();
  });
  on(el, 'click', '[data-quick]', async (e, b) => {
    const { contact: c, opp: o } = current;
    if (await activityForm(c, { opportunity_id: o?.id, type: b.dataset.quick || undefined })) changed();
  });
  on(el, 'click', '[data-task-done]', async (e, b) => {
    const t = current.contact.tasks.find((x) => x.id === Number(b.dataset.taskDone));
    if (t && (await completeTask(t))) changed();
  });
  on(el, 'click', '[data-task-cancel]', async (e, b) => {
    const t = current.contact.tasks.find((x) => x.id === Number(b.dataset.taskCancel));
    if (t && (await cancelTask(t))) changed();
  });
  on(el, 'click', '[data-mt-new]', async (e, b) => {
    const { contact: c, opp: o } = current;
    if (await scheduleMeetingDialog({ contactId: c.id, oppId: o?.id, kind: b.dataset.mtNew, moveTo: true })) changed();
  });
  on(el, 'click', '[data-prop]', (e, a) => {
    e.preventDefault();
    proposalDetail(a.dataset.prop, changed);
  });
  on(el, 'submit', '[data-note]', async (e, f) => {
    e.preventDefault();
    const { contact: c, opp: o } = current;
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await post('/api/atividades', { contact_id: c.id, opportunity_id: o?.id, type: 'observacao', notes: f.notes.value, occurred_at: new Date().toISOString() });
      toast('Nota salva.');
      changed();
    } catch (ex) {
      toastError(ex);
      btn.disabled = false;
    }
  });
  bindMeetingCards(el, () => ({ contactId: current.contact.id, oppId: current.opp?.id, onChange: changed }));

  on(el, 'click', '[data-dact]', async (e, b) => {
    const { contact: c, opp } = current || {};
    if (!c) return;
    const act = b.dataset.dact;
    if (act === 'edit-biz') {
      const f = $('.biz-form', el);
      f.hidden = !f.hidden;
      $('.biz-view', el).hidden = !f.hidden;
      b.textContent = f.hidden ? 'Editar' : 'Fechar';
      return;
    }
    let ok = false;
    if (act === 'won') ok = await scheduleMeetingDialog({ contactId: c.id, oppId: opp?.id, kind: 'r1', moveTo: true, won: true });
    else if (act === 'lost') {
      if (b.getAttribute('aria-disabled') === 'true') {
        toast('Para dar o lead como perdido, registre antes ao menos uma atividade (ligação, WhatsApp, e-mail ou direct).', 'error');
        current.tab = 'atividades';
        return draw();
      }
      ok = await lostDialog({ ...opp, contact_name: c.name }, undefined, { force: b.dataset.force === '1' });
    } else if (act === 'task') ok = await taskForm({ contact: c, opportunity_id: opp?.id });
    else if (act === 'owner') ok = await changeOwnerDialog(c, opp && ['aberta', 'pausada'].includes(opp.status) ? opp : null);
    else if (act === 'edit-qual') ok = await opportunityForm(c, opp);
    else if (act === 'prop-sim') ok = await openProposalSimulator(c, opp.id);
    else if (act === 'prop-new') ok = await proposalForm(opp, opp.simulations || []);
    if (ok) changed();
  });
  // Edição do bloco "Negócio" no próprio painel
  on(el, 'submit', '.biz-form', async (e, f) => {
    e.preventDefault();
    const { opp } = current || {};
    if (!opp) return;
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await patch(`/api/oportunidades/${opp.id}`, formData(f));
      toast('Informações do negócio atualizadas.');
      await changed();
    } catch (ex) {
      toastError(ex);
    } finally {
      btn.disabled = false;
    }
  });
  on(el, 'click', '[data-biz-cancel]', () => {
    $('.biz-form', el).hidden = true;
    $('.biz-view', el).hidden = false;
    const b = $('[data-dact=edit-biz]', el);
    if (b) b.textContent = 'Editar';
  });
  on(el, 'change', '[data-dmove]', async (e, sel) => {
    const { opp } = current || {};
    if (!sel.value || !opp) return;
    const ok = await moveStage({ ...opp, contact_name: current.contact.name }, sel.value);
    sel.value = '';
    if (ok) changed();
  });
  await draw();
}

/**
 * Liga os links de nome à gaveta: clique esquerdo abre o painel; Ctrl/Cmd/Shift + clique ou botão do meio
 * (rolagem) seguem o link e abrem o cadastro em uma nova guia.
 */
export function bindDrawerLinks(root, getOpts = () => ({})) {
  on(root, 'click', '[data-drawer]', (e, a) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openLeadDrawer(Number(a.dataset.drawer), { oppId: a.dataset.opp ? Number(a.dataset.opp) : null, ...getOpts(a) });
  });
}

// Mudou de tela: o painel lateral fecha junto
if (typeof window !== 'undefined') window.addEventListener('hashchange', () => close());
