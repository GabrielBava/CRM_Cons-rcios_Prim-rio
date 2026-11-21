// Painel lateral (gaveta) com o resumo do lead/cliente: consulta rápida sem sair da tela atual.
// Modelo de painel de lead (estreito, uma coluna): cabeçalho com Ganho/Perdido em destaque, contato (copiar o número,
// WhatsApp da empresa, cadastro completo) e abas em carrossel: IA Vero, Detalhes, Atividades, Qualificação, Agendas
// (R1/R2), Produtos, Diagnóstico, Tarefas, Notas, Propostas e Histórico. A etapa muda só no pipeline.
import { get, post, patch } from './api.js';
import { html, raw, render, $, $$, on, state, badge, relBadge, optLabel, K, fmtMoney, fmtDate, fmtDateTime, relTime, can, empty, optoutBadge, modal, field, opts, userItems, toast, toastError, formData, avatar, hasModule, fmtMoneyInput, parseMoneyBR } from './ui.js';
import { activityForm, taskForm, lostDialog, completeTask, cancelTask, opportunityForm, proposalDetail, attemptDialog, qualifyDialog, newProposalFlow, CONTACT_CHANNELS, PROPOSAL_AREAS } from './forms.js';
import { qualProgress, qualBlocks, tempBadge } from './qualification.js';
import { scheduleMeetingDialog, meetingLinks, meetingCard, bindMeetingCards, R1_STAGES, MEETING_LABEL } from './meeting.js';
import { linkBadge, readTime, optionButtons, bindOptionButtons } from './proposal-actions.js';
import { renderAiTab, renderProductsTab, renderDiagTab, renderFilesTab, renderReferralsTab, bindLeadTabs, copyText } from './leadtabs.js';
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

/** Abas do painel (carrossel). A IA Vero vem antes de Detalhes. */
const TABS = [
  ['ia', 'IA Vero'], ['detalhes', 'Detalhes'], ['atividades', 'Atividades'], ['tarefas', 'Tarefas'], ['qualificacao', 'Qualificação'],
  ['diagnostico', 'Diagnóstico'], ['agendas', 'Agendas'], ['produtos', 'Produtos'], ['propostas', 'Propostas'], ['notas', 'Notas'],
  ['arquivos', 'Arquivos'], ['recomendacoes', 'Recomendações'], ['historico', 'Histórico'],
];
/** Atividades de contato (enviadas e recebidas) por canal: totais do topo da aba Atividades. */
const CHANNEL_TYPES = {
  ligacao: { out: 'ligacao_realizada', in: 'ligacao_recebida' },
  whatsapp: { out: 'mensagem_enviada', in: 'mensagem_recebida' },
  email: { out: 'email_enviado', in: 'email_recebido' },
  direct: { out: 'direct_enviado', in: 'direct_recebido' },
  linkedin: { out: 'linkedin_enviado', in: 'linkedin_recebido' },
};
/** O que conta como "trabalhar o lead" (libera o Perdido). Mesma lista do servidor. */
const WORK_TYPES = ['ligacao_realizada', 'tentativa_sem_atendimento', 'ligacao_recebida', 'mensagem_enviada', 'mensagem_recebida', 'email_enviado', 'email_recebido',
  'direct_enviado', 'direct_recebido', 'linkedin_enviado', 'linkedin_recebido', 'conversa_presencial', 'conversa_video', 'reuniao_realizada', 'reuniao_nao_realizada', 'observacao'];
const DAY = 86400000;
/** Prazo para agendar a R1: 3 dias depois do primeiro contato. */
function r1Deadline(c, o) {
  if (!c.first_contact_at) return null;
  const due = new Date(Date.parse(c.first_contact_at) + 3 * DAY);
  const m = o?.meetings?.r1;
  if (m) return { due, level: 'ok', text: m.state === 'realizada' ? 'R1 realizada' : 'R1 agendada' };
  const left = Math.ceil((due - Date.now()) / DAY);
  return { due, level: left < 0 ? 'danger' : left <= 1 ? 'warn' : '', text: left < 0 ? `vencido há ${-left} dia(s)` : left === 0 ? 'vence hoje' : `faltam ${left} dia(s)` };
}
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
    const phone = c.whatsapp || c.phone1 || c.phone2;
    const tabCount = {
      atividades: acts.filter((a) => a.type !== 'observacao' && !state.meta.constants.activity_types[a.type]?.system).length,
      tarefas: c.tasks.filter((t) => t.status === 'pendente' && t.type !== 'reuniao').length,
      agendas: c.tasks.filter((t) => t.type === 'reuniao').length,
      notas: acts.filter((a) => a.type === 'observacao').length,
      propostas: c.proposals.filter((p) => p.status !== 'substituida').length,
    };
    render($('.drawer-body', el), html`
      <header class="lead-head">
        <div class="lead-id">${avatar({ name: c.name }, 44)}
          <div class="grow"><h2>${c.name} <a href="#/leads/${c.id}" class="rec-link" data-close title="Abrir cadastro completo" aria-label="Abrir cadastro completo">${icon('cadastros', 16)}</a></h2>
            <small class="muted">${c.trade_name ? `${c.trade_name} · ` : ''}<span class="badge pfpj">${c.kind}</span> ID ${c.code}</small>
            <div class="badges">${relBadge(c.relationship)} ${o?.temperature ? tempBadge(o.temperature, o.temperature_info) : c.temperature ? tempBadge(c.temperature) : ''} ${o ? html`<span class="chip-sm area area-${o.business_area || 'consorcio'}">${optLabel('area_negocio', o.business_area || 'consorcio')}</span>` : ''} ${o?.score != null ? html`<span class="score s-${o.score >= 70 ? 'hi' : o.score >= 40 ? 'mid' : 'lo'}" title="Score do lead">${o.score}</span>` : ''} ${o?.sla ? badge(o.sla.text, { ok: 'ok', atencao: 'warn', estourado: 'danger' }[o.sla.level]) : ''} ${optoutBadge(c.optouts)}</div>
          </div>
          <button class="icon" data-close aria-label="Fechar painel">×</button>
        </div>
        <div class="lead-actions">
          ${phone ? html`<button type="button" class="contact-chip" data-copy-phone="${phone}" title="Copiar o número">${icon('telefone', 14)} ${phone} ${icon('copiar', 12)}</button>` : html`<span class="muted small">Sem telefone</span>`}
          ${hasModule('whatsapp') ? html`<a class="contact-chip wa" href="#/comunicacao/whatsapp?contato=${c.id}" data-close title="Conversar pelo WhatsApp oficial da empresa (fica no CRM)">${icon('whatsapp', 14)} WhatsApp</a>` : ''}
          <span class="grow"></span>
          ${showWon ? html`<button class="btn won-btn" data-dact="won" title="Ganho = R1 agendada: abre o agendamento e leva o lead para a coluna R1">Ganho</button>` : ''}
          ${w && o && ['aberta', 'pausada'].includes(o.status) ? html`<button class="btn lost-btn" data-dact="lost" data-force="${!worked && can.admin() ? '1' : ''}" ${worked || can.admin() ? '' : raw('aria-disabled="true"')} title="${worked ? 'Dar o lead como perdido (motivo MP)' : can.admin() ? 'Sem atividade registrada: como administrador, informe a justificativa' : 'Registre ao menos uma atividade antes de dar o lead como perdido'}">Perdido</button>` : ''}
        </div>
      </header>
      <nav class="tab-carousel" aria-label="Seções do lead"><button type="button" class="tc-arrow" data-tc="-1" aria-label="Abas anteriores">‹</button>
        <div class="tc-track" role="tablist">${TABS.map(([k, label]) => html`<button type="button" role="tab" class="tc-tab ${current.tab === k ? 'active' : ''} ${k === 'ia' ? 'tc-ia' : ''}" aria-selected="${current.tab === k}" data-tab="${k}">${k === 'ia' ? icon('ia', 13) : ''}${label}${tabCount[k] ? html`<span class="count">${tabCount[k]}</span>` : ''}</button>`)}</div>
        <button type="button" class="tc-arrow" data-tc="1" aria-label="Próximas abas">›</button></nav>
      <div class="tab-body" data-tab-body></div>`);
    drawTab();
    $('.tc-tab.active', el)?.scrollIntoView({ block: 'nearest', inline: 'center' });
  };

  /** Indicadores de reuniões do lead: agendadas, realizadas, remarcadas e no-show. */
  const meetingStats = (tasks) => {
    const ms = tasks.filter((t) => t.type === 'reuniao');
    const n = (f) => ms.filter(f).length;
    return html`<div class="mt-kpis"><div><strong>${ms.length}</strong><small>Agendadas</small></div><div><strong>${n((t) => t.outcome === 'realizada')}</strong><small>Realizadas</small></div><div><strong>${n((t) => t.outcome === 'remarcada' || t.rescheduled_from)}</strong><small>Remarcadas</small></div><div class="${n((t) => t.outcome === 'nao_compareceu') ? 'ns' : ''}"><strong>${n((t) => t.outcome === 'nao_compareceu')}</strong><small>No-show</small></div></div>`;
  };

  const drawTab = async () => {
    const box = $('[data-tab-body]', el);
    if (!box || !current) return;
    const { contact: c, opp: o, acts, tab } = current;
    const w = can.write();
    const edit = w && o && ['aberta', 'pausada'].includes(o.status);
    if (tab === 'ia') {
      await renderAiTab(box, current);
    } else if (tab === 'produtos') {
      await renderProductsTab(box, current);
    } else if (tab === 'diagnostico') {
      await renderDiagTab(box, current);
    } else if (tab === 'arquivos') {
      await renderFilesTab(box, current);
    } else if (tab === 'recomendacoes') {
      await renderReferralsTab(box, current);
    } else if (tab === 'detalhes') {
      const dl = r1Deadline(c, o);
      const row = (label, v, extra = '') => html`<div class="${extra}"><dt>${label}</dt><dd>${v == null || v === '' ? html`<span class="muted">—</span>` : v}</dd></div>`;
      const lock = (label) => html`${icon('senha', 12)} ${label}`;
      render(box, html`
        <section class="det-block"><h4>Dados</h4><dl class="kv-list">
          ${row('ID', html`<strong>${c.code}</strong>`)}
          ${row('Nome completo', c.name)}
          ${row('Telefone', c.whatsapp || c.phone1 || c.phone2)}
          ${row('E-mail', c.email)}
          ${row('Origem / campanha', html`${optLabel('origem', c.origin) || '—'}${o?.campaign || o?.origin_campaign || c.campaign ? html`<br><small class="muted">${o?.campaign || o?.origin_campaign || c.campaign}</small>` : ''}`)}
          ${row('Responsável', html`<span class="owner-dd">${c.owner_name || '—'}${can.manage() && w ? html`<button type="button" class="gear-btn" data-dact="owner" title="Trocar responsável" aria-label="Trocar responsável">${icon('configuracoes', 15)}</button>` : ''}</span>`)}
          ${row('Score', o?.score != null ? html`<span class="score s-${o.score >= 70 ? 'hi' : o.score >= 40 ? 'mid' : 'lo'}">${o.score}</span> <small class="muted">de 100</small>` : null)}
          ${c.kind === 'PJ' ? row('Empresa', c.trade_name ? html`${c.trade_name}<br><small class="muted">${c.name}</small>` : c.name) : ''}
        </dl></section>
        ${o ? html`<section class="det-block biz-info"><div class="section-head"><h4>Negociação</h4>${edit ? html`<button type="button" class="btn small ghost" data-dact="edit-biz">Editar</button>` : ''}</div>
          <form class="biz-form" hidden>${bizForm(o)}</form>
          <dl class="kv-list biz-view">
            ${row('Área', optLabel('area_negocio', o.business_area || 'consorcio'))}
            ${row('Valor da oportunidade', edit ? html`<span class="money-input inline-money"><span aria-hidden="true">R$</span><input type="text" inputmode="decimal" data-money data-opp-value value="${fmtMoneyInput(o.credit_value)}" aria-label="Valor da oportunidade" placeholder="0,00"></span>${o.deal_value_source === 'proposta' ? html`<br><small class="muted">Maior proposta ativa: ${fmtMoney(o.deal_value)}</small>` : ''}` : fmtMoney(o.credit_value))}
            ${row('Objetivo', optLabel('objetivo', o.objective_type))}
            ${row('Categoria', optLabel('categoria_credito', o.credit_category))}
            ${row('Prioridade', optLabel('urgencia', o.urgency))}
            ${row('Próxima ação', o.next_action ? html`${o.next_action}${o.next_action_at ? html`<br><small class="${new Date(o.next_action_at) < new Date() ? 'overdue' : 'muted'}">${fmtDateTime(o.next_action_at)} · ${relTime(o.next_action_at)}</small>` : ''}` : html`<span class="warn-text">Sem próxima ação</span>`)}
          </dl>
          <dl class="kv-list dates">
            ${row(lock('Data de cadastro'), fmtDateTime(c.created_at))}
            ${row(lock('Data do primeiro contato'), c.first_contact_at ? fmtDateTime(c.first_contact_at) : html`<span class="muted">Ainda sem contato</span>`)}
            ${row(lock('Prazo da cadência'), dl ? html`${fmtDate(dl.due.toISOString())} ${badge(dl.text.charAt(0).toUpperCase() + dl.text.slice(1), dl.level)}<br><small class="muted">R1 em até 3 dias após o 1º contato</small>` : html`<span class="muted">Conta a partir do primeiro contato</span>`)}
            ${row('Previsão de fechamento', edit ? html`<input type="date" class="inline-date" data-close-date value="${o.expected_close_date || ''}" aria-label="Previsão de fechamento">` : o.expected_close_date ? fmtDate(o.expected_close_date) : null)}
          </dl>
          <p class="small"><a href="#/oportunidades/${o.id}" data-close>Ver negócio completo →</a></p></section>` : ''}
        ${c.contracts.length ? html`<section class="det-block"><h4>Produtos contratados</h4><p>${c.contracts.length} carta(s) · ${fmtMoney(c.contracts.reduce((t, k) => t + (k.credit_value || 0), 0))}</p></section>` : ''}`);
    } else if (tab === 'atividades') {
      const work = acts.filter((a) => a.type !== 'observacao' && !state.meta.constants.activity_types[a.type]?.system);
      const list = work.filter((a) => !current.chan || chanOf(a) === current.chan);
      const chIcon = (a) => CONTACT_CHANNELS.find((x) => x.key === chanOf(a))?.icon || 'chat';
      const chLabel = (a) => CONTACT_CHANNELS.find((x) => x.key === chanOf(a))?.label || optLabel('canal', chanOf(a)) || 'Outro';
      render(box, html`
        ${w ? html`<section class="reg-block"><h4>Registrar atividade</h4><div class="reg-btns">${CONTACT_CHANNELS.map((ch) => html`<button type="button" class="reg-btn ch-${ch.key}" data-reg="${ch.key}" title="Registrar ${ch.label}">${icon(ch.icon, 20)}<span>${ch.label}</span></button>`)}</div></section>` : ''}
        <div class="act-totals" role="group" aria-label="Totais por canal (clique para filtrar)"><button type="button" class="act-total ${!current.chan ? 'active' : ''}" data-chan=""><strong>${work.length}</strong><small>Todas</small></button>${CONTACT_CHANNELS.map((ch) => html`<button type="button" class="act-total ch-${ch.key} ${current.chan === ch.key ? 'active' : ''}" data-chan="${ch.key}">${icon(ch.icon, 14)}<strong>${work.filter((a) => chanOf(a) === ch.key).length}</strong><small>${ch.label}</small></button>`)}</div>
        <h4 class="act-hist-title">Histórico de atividades</h4>
        ${list.length ? html`<ul class="act-hist">${list.map((a) => html`<li class="ch-${chanOf(a) || 'outro'}" title="${a.notes || ''}">
          <span class="ah-ch">${icon(chIcon(a), 15)}<span>${chLabel(a)}</span></span>
          <span class="ah-what"><strong>${K('activity_types', a.type)}</strong>${a.result ? html`<small>${optLabel('resultado_ligacao', a.result)}</small>` : ''}</span>
          <span class="ah-when">${fmtDateTime(a.occurred_at)}<small>${a.user_name || 'Sistema'}</small></span></li>`)}</ul>` : empty('Nenhuma atividade neste filtro.')}`);
    } else if (tab === 'qualificacao') {
      render(box, o ? html`<div class="section-head"><h4>Qualificação</h4>${edit ? html`<span class="inline-actions"><button type="button" class="btn small" data-dact="edit-qual">Editar</button>${o.qualified_at ? '' : html`<button type="button" class="btn small primary" data-dact="conclude-qual">Concluir qualificação</button>`}</span>` : ''}</div>
        ${o.qualified_at ? html`<div class="alert ok-alert small">Qualificação concluída em ${fmtDateTime(o.qualified_at)}${o.qualified_by_name ? ` por ${o.qualified_by_name}` : ''}.</div>` : html`<p class="hint">Preencha o que levantou com o cliente e clique em <strong>Concluir qualificação</strong>: o lead passa de Tentativa de contato para Qualificação.</p>`}
        ${qualProgress(o, c.kind)}${qualBlocks(o, c.kind)}` : empty('Sem negócio para qualificar.'));
    } else if (tab === 'tarefas') {
      const tasks = c.tasks.filter((t) => t.type !== 'reuniao' || t.status === 'pendente');
      render(box, html`<div class="section-head"><h4>Tarefas</h4>${w ? html`<span class="inline-actions"><button type="button" class="btn small primary" data-dact="task">Nova tarefa</button><a class="btn small ghost" href="#/agenda" data-close>Agenda de tarefas</a></span>` : ''}</div>
        ${tasks.length ? html`<ul class="feed tasks">${tasks.map((t) => html`<li class="${t.status === 'pendente' && new Date(t.due_at) < new Date() ? 'overdue' : ''} st-${t.status}"><div><strong>${t.title}</strong> <small class="muted">${K('task_types', t.type)} · ${fmtDateTime(t.due_at)}${t.status === 'pendente' ? ` · ${relTime(t.due_at)}` : ''}</small></div>
          ${t.status === 'pendente' && w && t.type !== 'reuniao' ? html`<div class="inline-actions"><button type="button" class="btn small primary" data-task-done="${t.id}">Concluir</button><button type="button" class="btn small ghost" data-task-cancel="${t.id}">Cancelar</button></div>` : t.status !== 'pendente' ? html`<small>${t.status === 'concluida' ? 'Concluída' : 'Cancelada'}${t.completed_at ? ` em ${fmtDate(t.completed_at)}` : ''}</small>` : html`<small class="muted">Reunião: use a aba Agendas.</small>`}</li>`)}</ul>` : empty('Nenhuma tarefa.')}`);
    } else if (tab === 'agendas') {
      const ms = c.tasks.filter((t) => t.type === 'reuniao').sort((x, y) => (x.due_at < y.due_at ? 1 : -1));
      const m = o?.meetings || {};
      const kindL = (t) => MEETING_LABEL[t.meeting_kind] || (String(t.title).startsWith('[R2]') ? 'R2' : 'R1');
      const out = (t) => (t.status === 'pendente' ? badge(new Date(t.due_at) < new Date() ? 'Aguardando resultado' : 'Agendada', 'warn') : t.outcome === 'realizada' ? badge('Concluída', 'ok') : t.outcome === 'nao_compareceu' ? html`<span class="badge ns">Não participou (NS)</span>` : t.outcome === 'remarcada' ? html`<span class="badge rm">Remarcada</span>` : badge(K('meeting_outcomes', t.outcome) || 'Cancelada', 'muted'));
      const mw = w && o && ['aberta', 'pausada'].includes(o.status);
      // A R2 só é liberada depois da R1 agendada e concluída
      const r1Done = m.r1?.state === 'realizada' || c.tasks.some((t) => t.type === 'reuniao' && (t.meeting_kind || 'r1') === 'r1' && t.outcome === 'realizada');
      render(box, html`${meetingStats(c.tasks)}
        ${o ? html`<div class="mt-cards">${meetingCard('r1', m.r1, { write: mw, canSchedule: o.status === 'aberta' })}${meetingCard('r2', m.r2, { write: mw, canSchedule: o.status === 'aberta' && r1Done })}</div>` : html`<p class="muted small">Sem negócio aberto. <a href="#/leads/${c.id}" data-close>Abrir o cadastro</a> para criar.</p>`}
        <div class="section-head"><h4>Histórico de agendas</h4></div>
        ${ms.length ? html`<ul class="feed meetings">${ms.map((t) => html`<li><div><span class="badge kind-meet">${kindL(t)}</span> <strong>${fmtDateTime(t.due_at)}</strong>${t.ends_at ? html` <small>às ${new Date(t.ends_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small>` : ''} ${out(t)} ${t.confirmed_at ? badge('presença confirmada', 'ok') : ''}${t.rescheduled_from ? html` <small class="muted">(remarcação)</small>` : ''}</div>
          <small class="muted">${t.title} · ${t.assigned_name || '—'}</small>${t.notes ? html`<p class="small">${t.notes}</p>` : ''}${t.status === 'pendente' ? html`<div>${meetingLinks(t)}</div>` : ''}</li>`)}</ul>` : empty('Nenhuma reunião agendada para este lead.')}`);
    } else if (tab === 'notas') {
      const notes = acts.filter((a) => a.type === 'observacao');
      render(box, html`${w ? html`<form class="note-form" data-note><textarea name="notes" rows="3" placeholder="Escreva uma nota sobre o lead (fica no histórico e conta como atividade)" required></textarea><div class="inline-actions"><button type="submit" class="btn small primary">Salvar nota</button></div></form>` : ''}
        ${notes.length ? html`<ul class="feed notes">${notes.map((a) => html`<li><p>${a.notes}</p><small class="muted">${a.user_name || '—'} · ${fmtDateTime(a.occurred_at)}</small></li>`)}</ul>` : empty('Nenhuma nota.')}`);
    } else if (tab === 'propostas') {
      const props = c.proposals;
      const areaL = (a) => PROPOSAL_AREAS.find((x) => x.value === (a || 'consorcio'))?.label || 'Consórcio';
      render(box, html`<div class="section-head"><h4>Propostas do lead</h4>${edit ? html`<button type="button" class="btn small primary" data-dact="prop-new">Gerar proposta</button>` : ''}</div>
        <p class="hint">Consórcio, seguros, planejamento financeiro ou investimentos. A proposta gerada libera a etapa Negociação.</p>
        ${props.length ? html`<ul class="feed">${props.map((p) => html`<li><div><a href="#" data-prop="${p.id}"><strong>${p.code}</strong></a> <span class="chip-sm area area-${p.area || 'consorcio'}">${areaL(p.area)}</span> · ${fmtMoney(p.credit_value)}${p.term_months ? ` · ${p.term_months} meses` : ''} ${badge(K('proposal_status', p.status), `st-${p.status}`)}</div>${p.description ? html`<p class="small">${p.description}</p>` : ''}<small class="muted">${fmtDateTime(p.created_at)}${p.product_name ? ` · ${p.product_name}` : ''}${p.consortium_kind === 'contemplada' ? ' · carta contemplada' : ''}${p.refusal_reason ? ` · recusa: ${optLabel('motivo_recusa_proposta', p.refusal_reason)}` : ''}</small>
          ${p.status !== 'substituida' ? html`<div class="prop-feed-link">${linkBadge(p)}${p.link_views ? html`<small class="muted">${p.link_views} acesso(s) · ${readTime(p.link_seconds)}</small>` : ''}${optionButtons(p)}</div>` : ''}</li>`)}</ul>` : empty('Nenhuma proposta gerada para este lead.')}`);
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
  // Bloco "Registrar atividade": canal já escolhido; registrar um contato leva o lead de Lead para Tentativa
  on(el, 'click', '[data-reg]', async (e, b) => {
    const { contact: c, opp: o } = current;
    if (await attemptDialog(c, { opportunity_id: o?.id, channel: b.dataset.reg, quick: true })) changed();
  });
  on(el, 'click', '[data-copy-phone]', (e, b) => copyText(b.dataset.copyPhone, 'Número copiado.'));
  on(el, 'change', '[data-close-date]', async (e, inp) => {
    const { opp } = current || {};
    if (!opp) return;
    try {
      await patch(`/api/oportunidades/${opp.id}`, { expected_close_date: inp.value || null });
      toast(inp.value ? 'Previsão de fechamento salva.' : 'Previsão de fechamento removida.');
      onChange?.();
    } catch (ex) {
      toastError(ex);
    }
  });
  on(el, 'change', '[data-opp-value]', async (e, inp) => {
    const { opp } = current || {};
    if (!opp) return;
    const n = parseMoneyBR(inp.value);
    if (Number.isNaN(n)) return toastError(new Error('Valor inválido.'));
    try {
      await patch(`/api/oportunidades/${opp.id}`, { credit_value: n === '' ? null : n });
      toast('Valor da oportunidade salvo.');
      onChange?.();
    } catch (ex) {
      toastError(ex);
    }
  });
  bindOptionButtons(el, (id) => current?.contact?.proposals?.find((p) => p.id === id), () => changed());
  bindLeadTabs(el, () => current, {
    redraw: (tab) => {
      if (!current) return;
      if (tab) current.tab = tab;
      drawTab();
    },
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
    else if (act === 'conclude-qual') ok = await qualifyDialog(opp.id);
    else if (act === 'prop-new') ok = await newProposalFlow({ ...opp, contact_name: c.name }, c, { simulations: opp.simulations || [] });
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
