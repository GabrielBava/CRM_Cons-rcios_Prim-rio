// Painel lateral (gaveta) com o resumo do lead/cliente: consulta rápida sem sair da tela atual.
import { get } from './api.js';
import { html, render, $, on, state, badge, relBadge, optLabel, K, fmtMoney, fmtDate, fmtDateTime, relTime, can, empty, optoutBadge } from './ui.js';
import { activityForm, taskForm, moveStage } from './forms.js';
import { qualProgress } from './qualification.js';

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

/**
 * Abre o painel com o cadastro. opts.oppId: negócio em foco (mostra etapa, valor e "mover etapa").
 * opts.onChange: chamado depois de uma alteração feita pelo painel (atividade, tarefa, etapa).
 */
export async function openLeadDrawer(contactId, { oppId = null, onChange = null } = {}) {
  close();
  const el = document.createElement('div');
  el.className = 'drawer-wrap';
  el.innerHTML = '<div class="drawer-backdrop" data-close></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="Resumo do cadastro" tabindex="-1"><div class="drawer-body"><p class="muted">Carregando…</p></div></aside>';
  document.body.appendChild(el);
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  current = { el, onKey, opener: document.activeElement };
  requestAnimationFrame(() => el.classList.add('open'));
  const panel = $('.drawer', el);
  panel.focus();
  on(el, 'click', '[data-close]', close);

  const draw = async () => {
    let c;
    let hist = [];
    try {
      [c, hist] = await Promise.all([get(`/api/cadastros/${contactId}`), get(`/api/cadastros/${contactId}/historico`, { limit: 6 }).then((r) => r.rows).catch(() => [])]);
    } catch (e) {
      render($('.drawer-body', el), html`<div class="drawer-head"><h2>Cadastro</h2><button class="icon" data-close aria-label="Fechar">×</button></div><div class="alert danger">${e.message}</div>`);
      return;
    }
    const opp = c.opportunities.find((o) => o.id === Number(oppId)) || c.opportunities.find((o) => o.status === 'aberta') || c.opportunities[0];
    const props = c.proposals.filter((p) => p.status !== 'substituida').slice(0, 3);
    const pend = c.tasks.filter((t) => t.status === 'pendente').slice(0, 4);
    const wa = waLink(c.whatsapp || c.phone1);
    const w = can.write();
    current.contact = c;
    current.opp = opp;
    render($('.drawer-body', el), html`
      <div class="drawer-head">
        <div><h2>${c.name}</h2>
          <div class="badges">${relBadge(c.relationship)} ${c.active === 0 ? badge('Inativo', 'muted') : ''} ${c.temperature ? badge(optLabel('temperatura', c.temperature)) : ''} ${optoutBadge(c.optouts)}</div>
          <small class="muted">ID ${c.code} · ${c.kind} · desde ${fmtDate(c.created_at)}</small></div>
        <button class="icon" data-close aria-label="Fechar painel">×</button>
      </div>
      <div class="drawer-actions">
        <a class="btn small primary" href="#/leads/${c.id}" data-close>Abrir cadastro</a>
        ${wa ? html`<a class="btn small" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
        ${c.phone1 ? html`<a class="btn small" href="tel:${String(c.phone1).replace(/[^\d+]/g, '')}">Ligar</a>` : ''}
        ${w ? html`<button class="btn small" data-dact="activity">Registrar atividade</button><button class="btn small" data-dact="task">Nova tarefa</button>` : ''}
      </div>
      <section><h4>Contato</h4><dl class="kv-list">
        <div><dt>Telefone</dt><dd>${c.phone1 || '—'}</dd></div>
        <div><dt>WhatsApp</dt><dd>${c.whatsapp || '—'}</dd></div>
        <div><dt>E-mail</dt><dd>${c.email || '—'}</dd></div>
        <div><dt>Cidade</dt><dd>${c.city ? `${c.city}${c.state ? `/${c.state}` : ''}` : '—'}</dd></div>
        <div><dt>Origem</dt><dd>${optLabel('origem', c.origin) || '—'}${c.campaign ? html`<br><small>${c.campaign}</small>` : ''}</dd></div>
        <div><dt>Responsável</dt><dd>${c.owner_name || '—'}</dd></div>
      </dl></section>
      ${opp ? html`<section><h4>Informações de negócio · ${opp.code}</h4>
      ${qualProgress(opp, c.kind, { compact: true })}
      <dl class="kv-list">
        <div><dt>Etapa</dt><dd>${badge(opp.stage_name, `kind-${opp.stage_kind}`)}</dd></div>
        <div><dt>Categoria de interesse</dt><dd>${optLabel('categoria_credito', opp.credit_category) || '—'}</dd></div>
        <div><dt>Objetivo</dt><dd>${optLabel('objetivo', opp.objective_type) || '—'}${opp.credit_purpose_type ? html`<br><small>${optLabel('finalidade_credito', opp.credit_purpose_type)}</small>` : ''}</dd></div>
        <div><dt>Tipo de produto</dt><dd>${optLabel('tipo_produto', opp.product_type) || '—'}</dd></div>
        <div><dt>Crédito desejado</dt><dd>${fmtMoney(opp.credit_value)}</dd></div>
        <div><dt>Prazo objetivo</dt><dd>${opp.term_months ? `${opp.term_months} meses` : '—'}</dd></div>
        <div><dt>Capacidade de parcela</dt><dd>${opp.installment_min || opp.installment_max ? html`${opp.installment_min ? `ideal ${fmtMoney(opp.installment_min)}` : ''}${opp.installment_min && opp.installment_max ? html`<br>` : ''}${opp.installment_max ? `máxima ${fmtMoney(opp.installment_max)}` : ''}` : '—'}</dd></div>
        <div><dt>Urgência</dt><dd>${optLabel('urgencia', opp.urgency) || '—'}</dd></div>
        <div><dt>Já teve consórcio</dt><dd>${opp.had_consortium === 'sim' ? html`Sim<br><small>${opp.existing_consortium_admin || 'administradora não informada'} · ${opp.existing_consortium_value ? fmtMoney(opp.existing_consortium_value) : 'crédito não informado'}</small>` : opp.had_consortium === 'nao' ? 'Não' : '—'}</dd></div>
        <div><dt>Próxima ação</dt><dd>${c.next_action?.title ? html`${c.next_action.title}<br><small>${fmtDateTime(c.next_action.due_at)}</small>` : html`<span class="warn-text">sem próxima ação</span>`}</dd></div>
      </dl>
      ${w && opp.status !== 'ganha' ? html`<label class="inline-move">Mover etapa <select data-dmove><option value="">—</option>${state.meta.stages.filter((s) => s.id !== opp.stage_id && s.kind !== 'ganho').map((s) => html`<option value="${s.id}">${s.name}</option>`)}</select></label>` : ''}
      <p><a href="#/oportunidades/${opp.id}" data-close>Ver negócio completo →</a></p></section>` : ''}
      <section><h4>Propostas</h4>${props.length
        ? html`<ul class="mini-list">${props.map((p) => html`<li><strong>${p.code}</strong> · ${fmtMoney(p.credit_value)} ${badge(K('proposal_status', p.status), `st-${p.status}`)}<br><small class="muted">${fmtDate(p.created_at)}${p.refusal_reason ? ` · recusa: ${optLabel('motivo_recusa_proposta', p.refusal_reason)}` : ''}</small></li>`)}</ul>`
        : empty('Nenhuma proposta.')}</section>
      <section><h4>Tarefas pendentes</h4>${pend.length
        ? html`<ul class="mini-list">${pend.map((t) => html`<li class="${new Date(t.due_at) < new Date() ? 'overdue' : ''}">${t.title}<br><small>${fmtDateTime(t.due_at)} · ${relTime(t.due_at)}</small></li>`)}</ul>`
        : empty('Nenhuma tarefa pendente.')}</section>
      <section><h4>Últimas atividades</h4>${hist.length
        ? html`<ul class="mini-list">${hist.map((a) => html`<li><strong>${K('activity_types', a.type)}</strong> <small class="muted">${relTime(a.occurred_at || a.created_at)}</small>${a.notes ? html`<br><small>${a.notes.length > 140 ? `${a.notes.slice(0, 140)}…` : a.notes}</small>` : ''}</li>`)}</ul>`
        : empty('Sem atividades.')}</section>
      ${c.contracts.length ? html`<section><h4>Produtos contratados</h4><p>${c.contracts.length} carta(s) · ${fmtMoney(c.contracts.reduce((t, k) => t + (k.credit_value || 0), 0))}</p></section>` : ''}`);
  };
  on(el, 'click', '[data-dact]', async (e, b) => {
    const { contact: c, opp } = current || {};
    if (!c) return;
    const ok = b.dataset.dact === 'activity' ? await activityForm(c, { opportunity_id: opp?.id }) : await taskForm({ contact: c, opportunity_id: opp?.id });
    if (ok) {
      draw();
      onChange?.();
    }
  });
  on(el, 'change', '[data-dmove]', async (e, sel) => {
    const { opp } = current || {};
    if (!sel.value || !opp) return;
    const ok = await moveStage({ ...opp, contact_name: current.contact.name }, sel.value);
    sel.value = '';
    if (ok) {
      draw();
      onChange?.();
    }
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
