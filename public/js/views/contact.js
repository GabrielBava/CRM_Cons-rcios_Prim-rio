import { get, post, patch } from '../api.js';
import {
  html, raw, render, $, $$, on, fresh, state, field, formData, opts, toItems, userItems, table, badge, relBadge, optoutBadge, K, optLabel,
  fmtDate, fmtDateTime, fmtMoney, fmtDuration, relTime, modal, confirmDialog, toast, toastError, can, empty, userName,
} from '../ui.js';
import {
  activityForm, taskForm, completeTask, cancelTask, opportunityForm, simulationForm, proposalForm, quickSimulation, openProposalSimulator,
  proposalDetail, contractForm, consentForm, extractCustom, dupList,
} from '../forms.js';
import { nextActionCell } from './leads.js';
import * as RT from './record-tabs.js';

const TABS = [
  ['resumo', 'Resumo'],
  ['cadastro', '1. Cadastro'],
  ['origem', '2. Origem'],
  ['endereco', '3. Endereço'],
  ['negocio', '4. Negócio'],
  ['financeiro', '5. Financeiro'],
  ['propostas', '6. Propostas'],
  ['agenda', '7. Agenda e tarefas'],
  ['produtos', '8. Produtos contratados'],
  ['historico', '9. Histórico'],
  ['relacionamentos', 'Relacionamentos'],
  ['documentos', 'Documentos'],
  ['prevenda', 'Pré-venda'],
  ['posvenda', 'Pós-venda'],
  ['privacidade', 'Preferências e LGPD'],
  ['auditoria', 'Auditoria'],
];
// Endereços antigos das abas (links já compartilhados continuam funcionando)
const TAB_ALIASES = { oportunidades: 'negocio', tarefas: 'agenda', simulacoes: 'propostas', origens: 'origem', contatos: 'relacionamentos' };

export async function show(view, { id, sub }) {
  let c = await get(`/api/cadastros/${id}`);
  if (c.merged_into_id) {
    location.hash = `#/leads/${c.merged_into_id}`;
    return;
  }
  let tab = TAB_ALIASES[sub] || sub || 'resumo';
  const reload = async () => {
    c = await get(`/api/cadastros/${id}`);
    draw();
  };
  const draw = () => {
    const tabs = TABS;
    const base = c.relationship === 'cliente' ? 'clientes' : 'leads';
    // O menu lateral acompanha o tipo do registro: cliente fica em "Clientes"; prospect e lead, em "Prospects e leads"
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === base));
    const active = c.active !== 0;
    const openOpps = c.opportunities.filter((o) => ['aberta', 'pausada'].includes(o.status));
    const referral = c.referred_by || c.origin === 'indicacao';
    const w = can.write() && !c.anonymized_at;
    render(view, html`<div class="page">
      <div class="record-head">
        <div class="crumbs"><a href="#/${base}">${c.relationship === 'cliente' ? 'Clientes' : 'Prospects e leads'}</a> / ${c.code}</div>
        <div class="title-row"><h1>${c.name}</h1><span class="kind-chip" title="${c.kind === 'PJ' ? 'Pessoa jurídica' : 'Pessoa física'}">${c.kind}</span></div>
        <div class="id-cards">
          <div class="id-card"><span>ID</span><strong>${c.code}</strong></div>
          <div class="id-card"><span>Tipo</span><strong>${K('relationships', c.relationship)}</strong>${c.relationship === 'cliente' ? '' : html`<small>${K('lead_status', c.lead_status)}</small>`}</div>
          <div class="id-card ${active ? 'ok' : 'off'}"><span>Status</span><strong>${active ? 'Ativo' : 'Inativo'}</strong>${w ? html`<button class="link-btn" data-act="toggle-active">${active ? 'Inativar' : 'Reativar'}</button>` : ''}${!active && c.inactive_reason ? html`<small>${c.inactive_reason}</small>` : ''}</div>
          <div class="id-card"><span>Responsável</span><strong>${c.owner_name || 'Sem responsável'}</strong></div>
          <div class="id-card"><span>Origem</span><strong>${optLabel('origem', c.origin)}</strong>${c.temperature ? html`<small>${badge(optLabel('temperatura', c.temperature), `temp-${c.temperature}`)}</small>` : ''}</div>
          <div class="id-card"><span>Valor em oportunidades</span><strong>${fmtMoney(c.open_value)}</strong><small>${openOpps.length} em andamento</small></div>
          ${referral ? html`<div class="id-card flag"><span>Indicação</span><strong>★ Indicado</strong><small>${c.referred_by ? html`por <a href="#/leads/${c.referred_by.id}">${c.referred_by.name}</a>` : 'indicante não informado'}</small></div>` : ''}
        </div>
        ${c.optouts.length || c.finance_summary.qtd_atrasado || c.anonymized_at ? html`<div class="badges">${optoutBadge(c.optouts)} ${c.finance_summary.qtd_atrasado ? badge(`Financeiro: ${c.finance_summary.qtd_atrasado} em atraso`, 'danger') : ''} ${c.anonymized_at ? badge('Anonimizado', 'danger') : ''}</div>` : ''}
        ${w
          ? html`<div class="actions record-actions">
            <button class="btn primary" data-act="activity">Registrar atividade</button>
            <button class="btn" data-act="task">Nova tarefa</button>
            <button class="btn" data-act="opp">Novo negócio</button>
            <button class="btn" data-act="client-link" title="${active ? 'Link para o cliente atualizar cadastro, endereço e documentos' : 'Cadastro inativo'}" ${active ? '' : raw('disabled')}>Link cadastro${c.client_link ? html` <span class="dot-ok" title="Link ativo"></span>` : ''}</button>
            <button class="btn" data-act="proposal-sim" title="Abre o simulador com o nome e o contato do cliente">Gerar proposta</button>
          </div>`
          : ''}
        <div class="muted small">Criado em ${fmtDateTime(c.created_at)}${c.created_by_name ? ` por ${c.created_by_name}` : ''} · atualizado ${relTime(c.updated_at)}${c.updated_by_name ? ` por ${c.updated_by_name}` : ''}</div>
      </div>
      <div class="next-action ${!c.next_action ? 'missing' : c.next_action.due_at && new Date(c.next_action.due_at) < new Date() ? 'late' : ''}">
        <span>Próxima ação:</span> ${nextActionCell(c.next_action)}
      </div>
      ${c.missing_recommended.length && !c.anonymized_at ? html`<div class="alert warn">Cadastro incompleto. Recomendado completar: ${c.missing_recommended.map((f) => FIELD_LABELS[f] || f).join(', ')}. <a href="#/${base}/${c.id}/cadastro" data-tab="cadastro">Completar</a></div>` : ''}
      <nav class="tabs">${tabs.map(([k, l]) => html`<a href="#/${base}/${c.id}/${k}" class="${tab === k ? 'active' : ''}" data-tab="${k}">${l}${countFor(c, k)}</a>`)}</nav>
      <div id="tab"></div>
    </div>`);
    drawTab();
  };
  const drawTab = async () => {
    const box = fresh($('#tab', view));
    try {
      await TAB_RENDER[tab](box, c, reload);
    } catch (e) {
      render(box, html`<div class="alert danger">${e.message}</div>`);
    }
  };
  on(view, 'click', '[data-tab]', (e, a) => {
    e.preventDefault();
    tab = a.dataset.tab;
    history.replaceState(null, '', `#/${c.relationship === 'cliente' ? 'clientes' : 'leads'}/${c.id}/${tab}`);
    $$('.tabs [data-tab]', view).forEach((x) => x.classList.toggle('active', x.dataset.tab === tab));
    drawTab();
  });
  on(view, 'click', '[data-act=activity]', async (e, b) => {
    if (await activityForm(c, { opportunity_id: b.dataset.opp, type: b.dataset.type })) reload();
  });
  on(view, 'click', '[data-act=task]', async (e, b) => {
    if (await taskForm({ contact: c, opportunity_id: b.dataset.opp, type: b.dataset.type })) reload();
  });
  on(view, 'click', '[data-act=opp]', async () => {
    const r = await opportunityForm(c);
    if (r) reload();
  });
  on(view, 'click', '[data-act=client-link]', () => RT.clientLinkDialog(c, reload).catch(toastError));
  on(view, 'click', '[data-act=proposal-sim]', async () => {
    if (await openProposalSimulator(c, c.opportunities.find((o) => o.status === 'aberta')?.id)) setTimeout(reload, 300);
  });
  on(view, 'click', '[data-act=toggle-active]', async () => {
    const activating = c.active === 0;
    const ok = await modal({
      title: activating ? 'Reativar cadastro' : 'Inativar cadastro',
      body: activating
        ? html`<p>O cadastro volta a ficar ativo e poderá receber um novo link de cadastro.</p>`
        : html`<p>Cadastros inativos não recebem link de cadastro nem pesquisa. <strong>O link de cadastro enviado ao cliente será revogado automaticamente.</strong></p>${field({ name: 'inactive_reason', label: 'Motivo da inativação', type: 'textarea', full: true })}`,
      submitLabel: activating ? 'Reativar' : 'Inativar',
      danger: !activating,
      onSubmit: (d) => patch(`/api/cadastros/${c.id}`, { active: activating, inactive_reason: d.inactive_reason }),
    });
    if (ok) {
      toast(activating ? 'Cadastro reativado.' : 'Cadastro inativado.');
      reload();
    }
  });
  draw();
}

const FIELD_LABELS = {
  phone1: 'telefone principal', email: 'e-mail', city: 'cidade', state: 'UF', origin: 'origem', pref_channel: 'canal preferido',
  legal_name: 'razão social', doc: 'CPF/CNPJ', company_contact: 'contato da empresa', birth_date: 'data de nascimento', profession: 'profissão',
  segment: 'segmento', owner_id: 'responsável', whatsapp: 'WhatsApp', temperature: 'temperatura', rg: 'RG',
  nationality: 'nacionalidade', birthplace: 'naturalidade', sex: 'sexo', marital_status: 'estado civil', property_regime: 'regime de bens',
  mother_name: 'nome da mãe', income_range: 'renda mensal', net_worth_range: 'patrimônio', spouse_name: 'nome do cônjuge', spouse_doc: 'CPF do cônjuge',
  trade_name: 'nome fantasia', opening_date: 'data de abertura', main_activity: 'atividade', revenue_range: 'faturamento', legal_rep: 'representante legal',
};

function countFor(c, k) {
  const n = {
    negocio: c.opportunities.length, agenda: c.tasks.filter((t) => t.status === 'pendente').length, propostas: c.simulations.length + c.proposals.length,
    produtos: c.contracts.length, relacionamentos: c.kind === 'PJ' ? c.partners.length + c.company_contacts.filter((x) => x.active).length : 0,
    documentos: c.attachments.length, endereco: c.addresses.length, prevenda: c.sale_checklist.missing.length, financeiro: c.finance_summary.qtd_atrasado,
  }[k];
  if (k === 'prevenda' && n) return html` <span class="count warn">${n}</span>`;
  if (k === 'financeiro' && n) return html` <span class="count danger">${n}</span>`;
  return n ? html` <span class="count">${n}</span>` : '';
}

/* ------------------------- Abas ------------------------- */

const WA_ICON = raw('<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.87 9.87 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.23 8.23 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24a8.24 8.24 0 0 1 8.24 8.25c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.12-.16.25-.64.81-.78.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28Z"/></svg>');

/** Abre a conversa no WhatsApp com o número do cliente (padrão Brasil quando vier sem DDI). */
export function waButton(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 11) d = `55${d}`;
  return html`<a class="wa-btn" href="https://wa.me/${d}" target="_blank" rel="noopener noreferrer" title="Abrir conversa no WhatsApp">${WA_ICON}<span>WhatsApp</span></a>`;
}

function preVendaCard(c) {
  const ck = c.sale_checklist;
  const done = ck.items.length - ck.missing.length;
  return html`<section class="card"><div class="section-head"><h3>Pré-venda</h3><a href="#" data-tab="prevenda" class="small">abrir</a></div>
    <div class="progress-bar"><span style="width:${ck.items.length ? (done / ck.items.length) * 100 : 100}%"></span></div>
    ${ck.complete ? html`<p>${badge('Ficha completa', 'ok')} Venda liberada.</p>` : html`<p>${done} de ${ck.items.length} itens completos. Faltam: ${ck.missing.slice(0, 5).map((m) => m.label).join(', ')}${ck.missing.length > 5 ? '…' : ''}</p>`}
    <p class="small muted">Link de cadastro: ${c.client_link ? `ativo até ${fmtDateTime(c.client_link.expires_at)}${c.client_link.last_used_at ? ` · último acesso ${relTime(c.client_link.last_used_at)}` : ' · ainda não acessado'}` : 'nenhum link ativo'}</p></section>`;
}

function posVendaCard(c) {
  const done = c.post_sale.filter((p) => p.done_at).length;
  const last = c.nps_surveys.find((n) => n.status === 'respondida');
  const pending = c.nps_surveys.find((n) => n.status === 'pendente');
  return html`<section class="card"><div class="section-head"><h3>Pós-venda</h3><a href="#" data-tab="posvenda" class="small">abrir</a></div>
    <div class="progress-bar"><span style="width:${c.post_sale.length ? (done / c.post_sale.length) * 100 : 0}%"></span></div>
    <p>${done} de ${c.post_sale.length} etapas concluídas${c.post_sale.find((p) => !p.done_at) ? html`. Próxima: <strong>${c.post_sale.find((p) => !p.done_at).label}</strong>` : '.'}</p>
    <p class="small muted">NPS: ${last ? `nota ${last.score} em ${fmtDate(last.answered_at)}` : 'nenhuma resposta'}${pending ? ' · pesquisa aguardando resposta' : ''} · Estratégias de lance: ${c.bid_strategies.length} de ${c.contracts.length} produto(s)</p></section>`;
}

const kvs = (label, v) => html`<div><span>${label}</span>${v ?? '—'}</div>`;

const TAB_RENDER = {
  async resumo(box, c) {
    const open = c.opportunities.filter((o) => ['aberta', 'pausada'].includes(o.status));
    const hist = await get(`/api/cadastros/${c.id}/historico`, { limit: 8 });
    render(box, html`<div class="cols">
      <section class="card">
        <h3>Dados principais</h3>
        <div class="kv">
          <div><span>Telefone</span>${c.phone1 || '—'}${c.phone2 ? html`<br>${c.phone2}` : ''}</div>
          <div><span>WhatsApp</span>${c.whatsapp || '—'} ${waButton(c.whatsapp || c.phone1)}</div>
          <div><span>E-mail</span>${c.email || '—'}</div>
          <div><span>Cidade/UF</span>${[c.city, c.state].filter(Boolean).join('/') || '—'}</div>
          <div><span>Origem</span>${optLabel('origem', c.origin)}${c.campaign ? html`<br><small>${c.campaign}</small>` : ''}</div>
          <div><span>Primeiro contato</span>${fmtDateTime(c.first_contact_at)}</div>
          <div><span>Canal preferido</span>${optLabel('canal', c.pref_channel)}</div>
          <div><span>Melhor horário</span>${c.pref_time || '—'}</div>
          ${c.kind === 'PJ' ? html`<div><span>Contato principal</span>${c.company_contacts.find((x) => x.is_primary)?.name || '—'}</div>` : ''}
          ${c.contact_restriction ? html`<div class="full"><span>Restrição de contato</span><strong class="warn-text">${c.contact_restriction}</strong></div>` : ''}
          ${c.initial_notes ? html`<div class="full"><span>Observações iniciais</span>${c.initial_notes}</div>` : ''}
        </div>
      </section>
      <section class="card">
        <h3>Oportunidades em andamento</h3>
        ${open.length
          ? html`<ul class="opp-list">${open.map((o) => html`<li><a href="#/oportunidades/${o.id}"><strong>${o.code}</strong> ${o.title || ''}</a> — ${badge(o.stage_name, o.status === 'pausada' ? 'muted' : '')}
              <div class="small muted">${o.product_name || 'Produto não definido'} · ${fmtMoney(o.credit_value)} · ${o.owner_name || '—'}${o.next_action ? html` · Próxima: ${o.next_action} (${fmtDateTime(o.next_action_at)})` : ''}</div></li>`)}</ul>`
          : empty('Nenhuma oportunidade em andamento.')}
        ${c.contracts.length ? html`<h3>Produtos contratados</h3><ul>${c.contracts.map((k) => html`<li>${k.code} — ${k.product_name || optLabel('categoria_credito', k.category)} · ${fmtMoney(k.credit_value)} · ${optLabel('status_contrato', k.status)}</li>`)}</ul>` : ''}
      </section>
    </div>
    <div class="cols">
      ${c.relationship === 'cliente' ? posVendaCard(c) : preVendaCard(c)}
      <section class="card"><div class="section-head"><h3>Financeiro</h3><a href="#/leads/${c.id}/financeiro" data-tab="financeiro" class="small">abrir</a></div>
        <div class="kv">${kvs('Pago', fmtMoney(c.finance_summary.pago))}${kvs('A vencer', fmtMoney(c.finance_summary.a_vencer))}${kvs('Em atraso', html`<span class="${c.finance_summary.qtd_atrasado ? 'overdue' : ''}">${fmtMoney(c.finance_summary.atrasado)} (${c.finance_summary.qtd_atrasado})</span>`)}${kvs('Próximo vencimento', fmtDate(c.finance_summary.proximo_vencimento))}</div></section>
    </div>
    <section class="card"><h3>Atividades recentes</h3>${noteBox(c)}${timeline(hist.rows)}<p><a href="#/leads/${c.id}/historico" data-tab="historico">Ver histórico completo →</a></p></section>`);
    bindNote(box, c);
  },

  async cadastro(box, c, reload) {
    const cfg = state.meta.settings.field_config?.[c.kind === 'PJ' ? 'contact_pj' : 'contact_pf'] || {};
    const vis = (f) => cfg[f]?.visible !== false;
    const rec = (f) => c.recommended_fields.includes(f);
    const saleKeys = new Set(c.sale_checklist.items.map((i) => i.key));
    const F = (f, extra) => (vis(f) ? field({ name: f, value: c[f], recommended: rec(f), sale: saleKeys.has(f), ...extra }) : '');
    const ro = !can.write() || c.anonymized_at;
    const married = (state.meta.options.estado_civil || []).find((o) => o.value === c.marital_status)?.flags?.conjuge;
    render(box, html`<form class="card" id="edit">
      <fieldset ${ro ? raw('disabled') : ''}>
      <div class="grid">
        ${c.kind === 'PJ'
          ? html`${F('name', { label: 'Nome de exibição', required: true })}${F('legal_name', { label: 'Razão social' })}${F('trade_name', { label: 'Nome fantasia' })}
            ${F('doc', { label: 'CNPJ' })}${F('state_registration', { label: 'Inscrição estadual' })}${F('opening_date', { label: 'Data de abertura', type: 'date' })}
            ${F('main_activity', { label: 'Atividade / CNAE' })}${F('segment', { label: 'Segmento', type: 'select', options: opts('segmento') })}
            ${F('company_size', { label: 'Porte', type: 'select', options: opts('porte') })}${F('revenue_range', { label: 'Faturamento anual', type: 'select', options: opts('faixa_faturamento') })}
            ${F('website', { label: 'Site', type: 'url' })}`
          : html`${F('name', { label: 'Nome completo', required: true })}${F('doc', { label: 'CPF' })}${F('rg', { label: 'RG' })}
            ${F('birth_date', { label: 'Data de nascimento', type: 'date' })}${F('sex', { label: 'Sexo', type: 'select', options: opts('sexo') })}
            ${F('marital_status', { label: 'Estado civil', type: 'select', options: opts('estado_civil') })}
            <div class="regime-wrap" ${married ? '' : raw('hidden')}>${F('property_regime', { label: 'Regime de bens', type: 'select', options: opts('regime_bens') })}</div>
            ${F('birthplace', { label: 'Naturalidade (cidade/UF)' })}${F('nationality', { label: 'Nacionalidade' })}
            ${F('mother_name', { label: 'Nome da mãe' })}${F('profession', { label: 'Profissão' })}
            ${F('income_range', { label: 'Renda mensal', type: 'select', options: opts('faixa_renda') })}${F('net_worth_range', { label: 'Patrimônio estimado', type: 'select', options: opts('faixa_patrimonio') })}`}
        ${F('phone1', { label: 'Telefone 1', type: 'tel' })}${F('phone2', { label: 'Telefone 2', type: 'tel' })}
        ${F('whatsapp', { label: 'WhatsApp', type: 'tel' })}${F('email', { label: 'E-mail', type: 'email' })}
        ${field({ name: 'relationship', label: 'Tipo de registro', type: 'select', options: toItems(state.meta.constants.relationships), value: c.relationship, allowEmpty: false })}
        ${field({ name: 'lead_status', label: 'Status do lead', type: 'select', options: toItems(state.meta.constants.lead_status), value: c.lead_status, allowEmpty: false })}
        <div class="field full"><label>Documentos e arquivos</label><p class="small">${c.attachments.length} arquivo(s) anexado(s). <a href="#/leads/${c.id}/documentos" data-tab="documentos">Anexar documento de identificação, comprovantes e outros arquivos</a>.</p></div>
        ${customFieldsFor('contact', c.custom)}
      </div>
      <div class="modal-error" hidden></div>
      ${ro ? '' : html`<div class="form-actions"><button class="btn primary" type="submit">Salvar alterações</button></div>`}
      </fieldset>
    </form>
    <p class="muted small">Campos marcados como <span class="rec sale">venda</span> são obrigatórios para concluir a venda. Origem, responsável e observações ficam na aba Origem; cidade e UF, na aba Endereço.</p>`);
    const form = $('#edit', box);
    if (form.marital_status) {
      form.marital_status.addEventListener('change', () => {
        const f = (state.meta.options.estado_civil || []).find((o) => o.value === form.marital_status.value);
        $('.regime-wrap', form).hidden = !f?.flags?.conjuge;
      });
    }
    let confirmDup = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('.modal-error', form);
      err.hidden = true;
      const d = formData(form);
      d.custom = extractCustom(d);
      delete d.owner_id;
      try {
        const r = await patch(`/api/cadastros/${c.id}`, { ...d, confirm_duplicate: confirmDup });
        toast(r.changed ? 'Cadastro atualizado.' : 'Nenhuma alteração.');
        reload();
      } catch (ex) {
        err.hidden = false;
        if (ex.status === 409 && ex.details?.duplicates) {
          err.innerHTML = String(html`${dupList(ex.details.duplicates)}<p>Clique em salvar novamente para confirmar mesmo assim.</p>`);
          confirmDup = true;
        } else err.textContent = ex.message;
      }
    });
  },

  async contatos(box, c, reload) {
    const rows = c.company_contacts;
    render(box, html`<section class="card">
      <div class="section-head"><h3>Contatos vinculados à empresa</h3>${can.write() ? html`<button class="btn" data-act="cc-new">+ Adicionar contato</button>` : ''}</div>
      <p class="hint">Cada contato tem preferências e histórico próprios, sempre vinculados a esta empresa.</p>
      ${table(
        [
          { label: 'Nome', render: (x) => html`<strong>${x.name}</strong>${x.is_primary ? html` ${badge('Principal', 'ok')}` : ''}${!x.active ? html` ${badge('Inativo', 'muted')}` : ''} ${optoutBadge(x.optouts)}` },
          { label: 'Cargo', render: (x) => x.role || '—' },
          { label: 'Telefone', render: (x) => html`${x.phone || '—'}${x.whatsapp ? html`<br><small>WhatsApp: ${x.whatsapp}</small>` : ''}` },
          { label: 'E-mail', render: (x) => x.email || '—' },
          { label: 'Preferência', render: (x) => html`${optLabel('canal', x.pref_channel)}${x.pref_time ? html`<br><small>${x.pref_time}</small>` : ''}` },
          { label: '', render: (x) => (can.write() ? html`<button class="btn small" data-act="cc-edit" data-id="${x.id}">Editar</button> <button class="btn small ghost" data-act="cc-hist" data-id="${x.id}">Histórico</button>` : html`<button class="btn small ghost" data-act="cc-hist" data-id="${x.id}">Histórico</button>`) },
        ],
        rows,
        { emptyMsg: 'Nenhum contato vinculado.' },
      )}</section><div id="cc-hist"></div>`);
    const form = (x = {}) =>
      modal({
        title: x.id ? `Editar contato — ${x.name}` : 'Novo contato da empresa',
        body: html`<div class="grid">
          ${field({ name: 'name', label: 'Nome', value: x.name, required: true })}
          ${field({ name: 'role', label: 'Cargo', value: x.role })}
          ${field({ name: 'phone', label: 'Telefone', type: 'tel', value: x.phone })}
          ${field({ name: 'whatsapp', label: 'WhatsApp', type: 'tel', value: x.whatsapp })}
          ${field({ name: 'email', label: 'E-mail', type: 'email', value: x.email })}
          ${field({ name: 'pref_channel', label: 'Canal preferido', type: 'select', options: opts('canal'), value: x.pref_channel })}
          ${field({ name: 'pref_time', label: 'Melhor horário', value: x.pref_time })}
          ${field({ name: 'is_primary', label: 'Contato principal', type: 'checkbox', value: !!x.is_primary })}
          ${x.id ? field({ name: 'active', label: 'Ativo', type: 'checkbox', value: x.active !== 0 }) : ''}
          ${field({ name: 'notes', label: 'Observações', type: 'textarea', value: x.notes, full: true })}
        </div>`,
        async onSubmit(d) {
          if (x.id) await patch(`/api/contatos-empresa/${x.id}`, d);
          else await post(`/api/cadastros/${c.id}/contatos`, d);
          toast('Contato salvo.');
          return true;
        },
      });
    on(box, 'click', '[data-act=cc-new]', async () => (await form()) && reload());
    on(box, 'click', '[data-act=cc-edit]', async (e, b) => (await form(rows.find((x) => x.id === Number(b.dataset.id)))) && reload());
    on(box, 'click', '[data-act=cc-hist]', async (e, b) => {
      const x = rows.find((y) => y.id === Number(b.dataset.id));
      const h = await get(`/api/cadastros/${c.id}/historico`, { company_contact_id: x.id });
      render($('#cc-hist', box), html`<section class="card"><h3>Histórico de ${x.name}</h3>${timeline(h.rows)}</section>`);
    });
  },

  async oportunidades(box, c, reload) {
    render(box, html`<section class="card">
      <div class="section-head"><h3>Oportunidades</h3>${can.write() ? html`<button class="btn" data-act="opp">+ Nova oportunidade</button>` : ''}</div>
      ${table(
        [
          { label: 'Código', render: (o) => html`<a href="#/oportunidades/${o.id}">${o.code}</a>` },
          { label: 'Etapa', render: (o) => html`${o.stage_name}<br><small>${K('opp_status', o.status)}</small>` },
          { label: 'Produto', render: (o) => html`${o.product_name || '—'}<br><small>${optLabel('categoria_credito', o.credit_category)}</small>` },
          { label: 'Crédito', render: (o) => fmtMoney(o.credit_value), cls: 'num' },
          { label: 'Estratégia', render: (o) => html`${optLabel('estrategia', o.strategy)}${o.strategy ? (o.strategy_validated_at ? html` ${badge('validada', 'ok')}` : html` ${badge('não validada', 'warn')}`) : ''}` },
          { label: 'Responsável', render: (o) => o.owner_name || '—' },
          { label: 'Próxima ação', render: (o) => (o.next_action ? html`${o.next_action}<br><small>${fmtDateTime(o.next_action_at)}</small>` : '—') },
          { label: 'Criada', render: (o) => fmtDate(o.created_at) },
        ],
        c.opportunities,
        { emptyMsg: 'Nenhuma oportunidade.' },
      )}</section>`);
  },

  async historico(box, c) {
    const types = Object.entries(state.meta.constants.activity_types).map(([value, v]) => ({ value, label: v.label }));
    render(box, html`<section class="card">
      ${noteBox(c)}
      <form class="filters" data-hf>
        <label>Tipo<select name="type"><option value="">Todos</option>${types.map((t) => html`<option value="${t.value}">${t.label}</option>`)}</select></label>
        ${c.company_contacts.length ? html`<label>Contato<select name="company_contact_id"><option value="">Todos</option>${c.company_contacts.map((x) => html`<option value="${x.id}">${x.name}</option>`)}</select></label>` : ''}
        <label>Origem do registro<select name="source"><option value="">Todas</option><option value="manual">Manual</option><option value="discadora">Discadora</option><option value="simulador">Simulador</option><option value="whatsapp">WhatsApp</option><option value="api_leads">API de leads</option><option value="importacao">Importação</option><option value="cliente">Cliente (link)</option><option value="sistema">Sistema</option></select></label>
        <label>Fase<select name="phase"><option value="">Todas</option><option value="pre_venda">Pré-venda</option><option value="venda">Venda</option><option value="pos_venda">Pós-venda</option></select></label>
      </form>
      <div id="tl"></div></section>`);
    const f = $('[data-hf]', box);
    const load = async () => {
      const h = await get(`/api/cadastros/${c.id}/historico`, Object.fromEntries(new FormData(f).entries()));
      render($('#tl', box), timeline(h.rows));
    };
    f.addEventListener('change', load);
    bindNote(box, c, load);
    await load();
  },

  async tarefas(box, c, reload) {
    render(box, html`<section class="card">
      <div class="section-head"><h3>Tarefas e retornos</h3>${can.write() ? html`<span><button class="btn" data-act="task">+ Nova tarefa</button> <button class="btn" data-act="task" data-type="reuniao">+ Agendar reunião</button></span>` : ''}</div>
      ${tasksTable(c.tasks)}</section>`);
    bindTasks(box, c.tasks, reload);
  },

  async simulacoes(box, c, reload) {
    const openOpp = c.opportunities.find((o) => o.status === 'aberta');
    const w = can.write() && !c.anonymized_at;
    render(box, html`<section class="card">
      <div class="section-head"><h3>Simulações</h3>${w ? html`<button class="btn primary" data-act="sim-quick">Gerar simulação</button>` : ''}</div>
      <p class="hint">Cada simulação registra a data, a hora e quem a gerou. Quando o simulador for conectado, os valores simulados passam a aparecer aqui (a simulação não gera proposta nem PDF).</p>
      ${table(
        [
          { label: 'Código', render: (s) => (s.source === 'crm' ? html`<strong>${s.code}</strong>` : html`<a href="#" data-sim="${s.id}">${s.code}</a>`) },
          { label: 'Data e hora', render: (s) => fmtDateTime(s.created_at) },
          { label: 'Gerada por', render: (s) => s.user_name || (s.source === 'simulador' ? 'Simulador' : '—') },
          { label: 'Negócio', render: (s) => s.opportunity_code || '—' },
          { label: 'Valores', render: (s) => (s.credit_value != null ? html`${fmtMoney(s.credit_value)}${s.term_months ? ` · ${s.term_months} m` : ''}${s.installment ? html`<br><small>parcela ${fmtMoney(s.installment)}</small>` : ''}` : html`<span class="muted small">no simulador</span>`) },
        ],
        c.simulations,
        { emptyMsg: 'Nenhuma simulação gerada.' },
      )}</section>
      <section class="card">
        <div class="section-head"><h3>Propostas</h3>${w ? html`<span class="inline-actions"><button class="btn primary" data-act="proposal-sim">Gerar proposta</button>${c.opportunities.length ? html`<button class="btn" data-act="prop-new">Registrar proposta gerada</button>` : ''}</span>` : ''}</div>
        <p class="hint">"Gerar proposta" abre o simulador com o nome completo e o contato do cliente preenchidos. Depois de gerar o PDF, registre a proposta aqui com o link e o anexo.</p>
        ${table(
          [
            { label: 'Código', render: (p) => html`<a href="#" data-prop="${p.id}">${p.code}</a> <small>v${p.version}</small>` },
            { label: 'Oportunidade', render: (p) => p.opportunity_code },
            { label: 'Produto', render: (p) => p.product_name || '—' },
            { label: 'Crédito', render: (p) => fmtMoney(p.credit_value), cls: 'num' },
            { label: 'Prazo', render: (p) => (p.term_months ? `${p.term_months} m` : '—') },
            { label: 'Parcela inicial', render: (p) => fmtMoney(p.initial_installment), cls: 'num' },
            { label: 'Status', render: (p) => badge(K('proposal_status', p.status), `st-${p.status}`) },
            { label: 'Validade', render: (p) => fmtDate(p.valid_until) },
            { label: 'Criada', render: (p) => fmtDateTime(p.created_at) },
          ],
          c.proposals,
          { emptyMsg: 'Nenhuma proposta.' },
        )}</section>`);
    on(box, 'click', '[data-act=sim-quick]', async () => (await quickSimulation(c.id, openOpp?.id)) && reload());
    on(box, 'click', '[data-sim]:not([data-act])', async (e, a) => {
      e.preventDefault();
      const s = await get(`/api/simulacoes/${a.dataset.sim}`);
      if (await simulationForm(c, { simulation: s })) reload();
    });
    on(box, 'click', '[data-act=prop-new]', async () => {
      const items = c.opportunities.map((o) => ({ value: o.id, label: `${o.code} — ${o.stage_name}` }));
      const pick = await modal({ title: 'Nova proposta', body: field({ name: 'opp', label: 'Oportunidade', type: 'select', options: items, value: openOpp?.id, allowEmpty: false, full: true }), submitLabel: 'Continuar', onSubmit: (d) => d.opp });
      if (!pick) return;
      const opp = c.opportunities.find((o) => o.id === Number(pick));
      if (await proposalForm(opp, c.simulations.filter((s) => s.opportunity_id === opp.id))) reload();
    });
    on(box, 'click', '[data-prop]', (e, a) => {
      e.preventDefault();
      proposalDetail(a.dataset.prop, reload);
    });
  },

  async produtos(box, c, reload) {
    render(box, html`<section class="card">
      <div class="section-head"><h3>Produtos contratados</h3></div>
      ${contractsTable(c.contracts)}
      <p class="hint">Os produtos contratados são lançados somente na conclusão da venda (funil › Venda concluída). Aqui é possível consultar e atualizar os dados de cada contrato; as parcelas ficam na aba Financeiro.</p></section>`);
    on(box, 'click', '[data-contract]', async (e, a) => {
      e.preventDefault();
      if (!can.write()) return;
      if (await contractForm(c, c.contracts.find((k) => k.id === Number(a.dataset.contract)))) reload();
    });
  },

  async origens(box, c, reload) {
    render(box, html`<section class="card">
      <div class="section-head"><h3>Origens e campanhas</h3>${can.write() ? html`<button class="btn" data-act="origin-new">+ Registrar nova origem</button>` : ''}</div>
      <p class="hint">Cada entrada do contato (formulário, campanha, importação) é registrada aqui, sem duplicar o cadastro. Campos não fornecidos pela plataforma ficam vazios.</p>
      ${table(
        [
          { label: 'Recebido em', render: (o) => fmtDateTime(o.received_at || o.created_at) },
          { label: 'Origem', render: (o) => optLabel('origem', o.origin) },
          { label: 'Plataforma', render: (o) => o.platform || '—' },
          { label: 'Campanha', render: (o) => html`${o.campaign_name || '—'}${o.campaign_id ? html`<br><small>ID ${o.campaign_id}</small>` : ''}` },
          { label: 'Conjunto / anúncio', render: (o) => html`${o.adset_id || '—'} / ${o.ad_id || '—'}` },
          { label: 'ID do lead na plataforma', render: (o) => o.platform_lead_id || '—' },
          { label: 'UTM', render: (o) => [o.utm_source, o.utm_medium, o.utm_campaign, o.utm_content, o.utm_term].filter(Boolean).join(' · ') || '—' },
          { label: 'Registro', render: (o) => o.source_ref || 'manual' },
        ],
        c.origins,
        { emptyMsg: 'Nenhuma origem registrada.' },
      )}</section>`);
    on(box, 'click', '[data-act=origin-new]', async () => {
      const ok = await modal({
        title: 'Registrar origem',
        wide: true,
        body: html`<div class="grid">
          ${field({ name: 'origin', label: 'Origem', type: 'select', options: opts('origem') })}
          ${field({ name: 'campaign_name', label: 'Nome da campanha' })}
          ${field({ name: 'platform', label: 'Plataforma' })}
          ${field({ name: 'platform_lead_id', label: 'ID do lead na plataforma' })}
          ${field({ name: 'campaign_id', label: 'ID da campanha' })}
          ${field({ name: 'adset_id', label: 'ID do conjunto de anúncios' })}
          ${field({ name: 'ad_id', label: 'ID do anúncio' })}
          ${field({ name: 'received_at', label: 'Data de recebimento', type: 'datetime' })}
          ${field({ name: 'utm_source', label: 'utm_source' })}${field({ name: 'utm_medium', label: 'utm_medium' })}
          ${field({ name: 'utm_campaign', label: 'utm_campaign' })}${field({ name: 'utm_content', label: 'utm_content' })}
        </div>`,
        onSubmit: (d) => post(`/api/cadastros/${c.id}/origens`, d),
      });
      if (ok) {
        toast('Origem registrada.');
        reload();
      }
    });
  },

  async privacidade(box, c, reload) {
    const ro = !can.write() || c.anonymized_at;
    render(box, html`<div class="cols">
      <form class="card" id="prefs"><h3>Preferências de contato</h3>
        <fieldset ${ro ? raw('disabled') : ''}><div class="grid">
          ${field({ name: 'pref_channel', label: 'Canal preferido', type: 'select', options: opts('canal'), value: c.pref_channel })}
          ${field({ name: 'pref_time', label: 'Melhor horário para contato', value: c.pref_time, placeholder: 'ex.: dias úteis após 18h' })}
          ${field({ name: 'pref_phone', label: 'Telefone preferencial', value: c.pref_phone })}
          ${field({ name: 'pref_frequency', label: 'Frequência de contato', type: 'select', options: opts('frequencia_contato'), value: c.pref_frequency })}
          ${field({ name: 'contact_restriction', label: 'Restrição ou observação de contato', type: 'textarea', value: c.contact_restriction, full: true })}
          ${field({ name: 'pref_source', label: 'Origem desta preferência', placeholder: 'ex.: informado pelo cliente na ligação', full: true })}
        </div>
        <p class="muted small">Última atualização: ${fmtDateTime(c.pref_updated_at)}${c.pref_source ? ` · ${c.pref_source}` : ''}</p>
        ${ro ? '' : html`<button class="btn primary" type="submit">Salvar preferências</button>`}</fieldset>
      </form>
      <section class="card">
        <div class="section-head"><h3>Consentimentos e oposições</h3>${ro ? '' : html`<button class="btn" data-act="consent">Registrar</button>`}</div>
        <p>Situação atual: ${c.optouts.length ? optoutBadge(c.optouts) : badge('Sem restrições registradas', 'ok')}</p>
        ${table(
          [
            { label: 'Data', render: (k) => fmtDateTime(k.recorded_at) },
            { label: 'Tipo', render: (k) => (k.status === 'oposicao' ? badge('Oposição', 'danger') : badge('Consentimento', 'ok')) },
            { label: 'Canal', render: (k) => K('contact_channels', k.channel) },
            { label: 'Contato', render: (k) => k.company_contact_name || 'Cadastro' },
            { label: 'Origem', render: (k) => k.source },
            { label: 'Registrado por', render: (k) => k.recorded_by_name || '—' },
          ],
          c.consents,
          { emptyMsg: 'Nenhum registro.' },
        )}
      </section>
    </div>
    <section class="card">
      <div class="section-head"><h3>Solicitações do titular (LGPD)</h3>${ro ? '' : html`<button class="btn" data-act="request">Registrar solicitação</button>`}</div>
      ${table(
        [
          { label: 'Data', render: (r) => fmtDateTime(r.requested_at) },
          { label: 'Tipo', render: (r) => K('data_request_types', r.type) },
          { label: 'Detalhes', render: (r) => r.details || '—' },
          { label: 'Status', render: (r) => badge(r.status, r.status === 'concluida' ? 'ok' : r.status === 'recusada' ? 'danger' : 'warn') },
          { label: 'Resolução', render: (r) => html`${r.resolution || '—'}${r.resolved_at ? html`<br><small>${fmtDateTime(r.resolved_at)}</small>` : ''}` },
          { label: '', render: (r) => (!ro && !['concluida', 'recusada'].includes(r.status) ? html`<button class="btn small" data-act="resolve" data-id="${r.id}">Atualizar</button>` : '') },
        ],
        c.data_requests,
        { emptyMsg: 'Nenhuma solicitação registrada.' },
      )}
      <p class="hint">Correções de dados são feitas na aba Cadastro e ficam registradas na auditoria. Oposição a contato deve ser registrada em "Consentimentos e oposições".</p>
    </section>
    ${can.manage() && !c.anonymized_at ? html`<section class="card danger-zone"><h3>Ações administrativas</h3>
      <p><button class="btn" data-act="merge">Mesclar outro cadastro neste</button> <small class="muted">Traz histórico, oportunidades, propostas e origens do outro cadastro para este.</small></p>
      ${can.admin() ? html`<p><button class="btn danger" data-act="anonymize">Anonimizar dados pessoais</button> <small class="muted">Irreversível. Remove dados pessoais mantendo indicadores agregados.</small></p>` : ''}
    </section>` : ''}`);
    $('#prefs', box).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await patch(`/api/cadastros/${c.id}`, formData(e.target));
        toast('Preferências salvas.');
        reload();
      } catch (ex) {
        toastError(ex);
      }
    });
    on(box, 'click', '[data-act=consent]', async () => (await consentForm(c)) && reload());
    on(box, 'click', '[data-act=request]', async () => {
      const ok = await modal({
        title: 'Registrar solicitação do titular',
        body: html`<div class="grid">${field({ name: 'type', label: 'Tipo', type: 'select', options: toItems(state.meta.constants.data_request_types), required: true })}
          ${field({ name: 'requested_at', label: 'Data da solicitação', type: 'datetime', value: new Date().toISOString() })}
          ${field({ name: 'details', label: 'Detalhes', type: 'textarea', full: true })}</div>`,
        onSubmit: (d) => post(`/api/cadastros/${c.id}/solicitacoes`, d),
      });
      if (ok) reload();
    });
    on(box, 'click', '[data-act=resolve]', async (e, b) => {
      const ok = await modal({
        title: 'Atualizar solicitação',
        body: html`<div class="grid">${field({ name: 'status', label: 'Status', type: 'select', options: [{ value: 'em_andamento', label: 'Em andamento' }, { value: 'concluida', label: 'Concluída' }, { value: 'recusada', label: 'Recusada' }], allowEmpty: false })}
          ${field({ name: 'resolution', label: 'Resolução / justificativa', type: 'textarea', full: true, required: true })}</div>`,
        onSubmit: (d) => patch(`/api/solicitacoes/${b.dataset.id}`, d),
      });
      if (ok) reload();
    });
    on(box, 'click', '[data-act=merge]', () => mergeDialog(c));
    on(box, 'click', '[data-act=anonymize]', async () => {
      const ok = await modal({
        title: 'Anonimizar cadastro',
        danger: true,
        submitLabel: 'Anonimizar definitivamente',
        body: html`<p>Esta ação remove nome, documentos, telefones, e-mails, observações e conteúdos de atividades de <strong>${c.name}</strong>. Indicadores agregados são mantidos. <strong>Não pode ser desfeita.</strong></p>
          ${field({ name: 'reason', label: 'Motivo / solicitação que fundamenta', type: 'textarea', required: true, full: true })}`,
        onSubmit: (d) => post(`/api/cadastros/${c.id}/anonimizar`, d),
      });
      if (ok) {
        toast('Cadastro anonimizado.');
        reload();
      }
    });
  },

  origem: (box, c, reload) => RT.origem(box, c, reload, TAB_RENDER.origens),
  endereco: RT.endereco,
  negocio: RT.negocio,
  financeiro: RT.financeiro,
  propostas: (box, c, reload) => TAB_RENDER.simulacoes(box, c, reload),
  agenda: (box, c, reload) => TAB_RENDER.tarefas(box, c, reload),
  relacionamentos: (box, c, reload) => RT.relacionamentos(box, c, reload, TAB_RENDER.contatos),
  documentos: RT.documentos,
  prevenda: RT.prevenda,
  posvenda: RT.posvenda,

  async auditoria(box, c) {
    const rows = await get(`/api/cadastros/${c.id}/auditoria`);
    render(box, html`<section class="card"><h3>Histórico de alterações</h3>${table(
      [
        { label: 'Data', render: (r) => fmtDateTime(r.created_at) },
        { label: 'Usuário', render: (r) => r.user_name || 'Sistema/integração' },
        { label: 'Registro', render: (r) => `${r.entity}${r.entity_id ? ` #${r.entity_id}` : ''}` },
        { label: 'Ação', key: 'action' },
        { label: 'Alterações', render: (r) => (r.changes ? changesView(r.changes) : '—') },
      ],
      rows,
      { emptyMsg: 'Sem registros.' },
    )}</section>`);
  },
};

function changesView(ch) {
  return html`<ul class="changes">${Object.entries(ch).map(([k, v]) =>
    Array.isArray(v) && v.length === 2 ? html`<li><code>${k}</code>: ${v[0] ?? '∅'} → <strong>${v[1] ?? '∅'}</strong></li>` : html`<li><code>${k}</code>: ${typeof v === 'object' ? JSON.stringify(v) : v}</li>`,
  )}</ul>`;
}

async function mergeDialog(c) {
  const ok = await modal({
    title: `Mesclar outro cadastro em ${c.code}`,
    wide: true,
    body: html`<p>Busque o cadastro duplicado. Ele será incorporado a <strong>${c.code} — ${c.name}</strong>: atividades, oportunidades, propostas, simulações, origens e consentimentos serão preservados; campos vazios deste cadastro serão completados com os do outro. Oposições a contato dos dois cadastros são somadas.</p>
      <div class="field full"><label>Buscar cadastro</label><input type="search" name="q" placeholder="nome, telefone, e-mail ou código"></div>
      <div class="merge-results"></div><input type="hidden" name="source_id">`,
    submitLabel: 'Mesclar',
    danger: true,
    onMount(form) {
      let t;
      form.q.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          const rows = (await get('/api/busca', { q: form.q.value })).filter((r) => r.kind === 'contact' && r.id !== c.id);
          render($('.merge-results', form), rows.length ? html`${rows.map((r) => html`<label class="check"><input type="radio" name="pick" value="${r.id}"> ${r.code} — ${r.title} <small>${r.subtitle}</small></label>`)}` : empty('Nenhum cadastro encontrado.'));
        }, 250);
      });
      on(form, 'change', 'input[name=pick]', (e, r) => (form.source_id.value = r.value));
    },
    async onSubmit(d) {
      if (!d.source_id) throw new Error('Selecione o cadastro a ser mesclado.');
      return post(`/api/cadastros/${c.id}/mesclar`, { source_id: Number(d.source_id) });
    },
  });
  if (ok) {
    toast('Cadastros mesclados.');
    location.hash = `#/leads/${c.id}/historico`;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
}

/* ------------------------- Componentes locais ------------------------- */

function customFieldsFor(entity, values = {}) {
  const defs = state.meta.custom_fields.filter((f) => f.entity === entity);
  return defs.map((f) =>
    field({
      name: `cf_${f.key}`,
      label: f.label,
      type: f.type === 'boolean' ? 'checkbox' : f.type,
      options: (f.options || []).map((o) => ({ value: o, label: o })),
      value: values?.[f.key],
    }),
  );
}

export function noteBox(c) {
  if (!can.write() || c.anonymized_at) return '';
  return html`<form class="note-box" data-note>
    <textarea name="notes" rows="2" placeholder="Adicionar observação ao histórico (não apaga registros anteriores)…" required></textarea>
    <div class="note-actions">
      <button class="btn small" type="button" data-act="activity" data-type="ligacao_realizada">Ligação</button>
      <button class="btn small" type="button" data-act="activity" data-type="mensagem_enviada">Mensagem</button>
      <button class="btn small" type="button" data-act="activity" data-type="reuniao_realizada">Reunião</button>
      <button class="btn small primary" type="submit">Adicionar observação</button>
    </div></form>`;
}
function bindNote(box, c, after) {
  const f = $('[data-note]', box);
  if (!f) return;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!f.notes.value.trim()) return;
    try {
      await post('/api/atividades', { contact_id: c.id, type: 'observacao', notes: f.notes.value });
      toast('Observação adicionada.');
      f.notes.value = '';
      if (after) after();
      else window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (ex) {
      toastError(ex);
    }
  });
}

const SOURCE_LABEL = { manual: 'manual', discadora: 'discadora', simulador: 'simulador', whatsapp: 'WhatsApp', api_leads: 'API de leads', importacao: 'importação', sistema: 'sistema', cliente: 'cliente (link)' };
const PHASE_LABEL = { pre_venda: 'Pré-venda', venda: 'Venda', pos_venda: 'Pós-venda' };

export function timeline(rows) {
  if (!rows.length) return empty('Nenhuma atividade registrada.');
  return html`<ol class="timeline">${rows.map((a) => {
    const t = state.meta.constants.activity_types[a.type] || { label: a.type };
    return html`<li class="tl-${a.type} src-${a.source}">
      <div class="tl-head"><strong>${t.label}</strong>${a.phase ? html` <span class="badge phase-${a.phase}">${PHASE_LABEL[a.phase]}</span>` : ''}
        ${a.result ? badge(optLabel('resultado_ligacao', a.result)) : ''}
        ${a.duration_seconds ? html`<span class="muted small">${fmtDuration(a.duration_seconds)}</span>` : ''}
        ${a.channel && !t.channel ? html`<span class="muted small">${optLabel('canal', a.channel)}</span>` : ''}
        <span class="muted small">· ${fmtDateTime(a.occurred_at)} · ${a.user_name || (a.source === 'sistema' ? 'Sistema' : 'Não identificado')} · via ${SOURCE_LABEL[a.source] || a.source}</span>
        ${a.opportunity_code ? html`<a class="small" href="#/oportunidades/${a.opportunity_id}">${a.opportunity_code}</a>` : ''}
        ${a.company_contact_name ? html`<span class="small">· ${a.company_contact_name}</span>` : ''}
        ${a.contact_name && a.showContact ? html`<a class="small" href="#/leads/${a.contact_id}">${a.contact_name}</a>` : ''}
      </div>
      ${a.notes ? html`<div class="tl-notes">${a.notes}</div>` : ''}
      ${a.next_action || a.return_at ? html`<div class="small">Próxima ação: <strong>${a.next_action || '—'}</strong>${a.return_at ? ` · retorno em ${fmtDateTime(a.return_at)}` : ''}</div>` : ''}
    </li>`;
  })}</ol>`;
}

export function tasksTable(tasks, { showContact = false } = {}) {
  return table(
    [
      { label: 'Prazo', render: (t) => html`<span class="${t.status === 'pendente' && new Date(t.due_at) < new Date() ? 'overdue' : ''}">${fmtDateTime(t.due_at)}<br><small>${relTime(t.due_at)}</small></span>` },
      { label: 'Tarefa', render: (t) => html`<strong>${t.title}</strong><br><small>${K('task_types', t.type)}${t.opportunity_code ? ` · ${t.opportunity_code}` : ''}</small>${t.notes ? html`<br><small class="muted">${t.notes}</small>` : ''}` },
      ...(showContact ? [{ label: 'Cadastro', render: (t) => (t.contact_id ? html`<a href="#/leads/${t.contact_id}">${t.contact_name}</a> ${optoutBadge(t.contact_optouts)}` : '—') }] : []),
      { label: 'Responsável', render: (t) => t.assigned_name || '—' },
      { label: 'Status', render: (t) => html`${badge(t.status === 'pendente' ? 'Pendente' : t.status === 'concluida' ? 'Concluída' : 'Cancelada', t.status === 'pendente' ? 'warn' : t.status === 'concluida' ? 'ok' : 'muted')}${t.outcome ? html`<br><small>${K('meeting_outcomes', t.outcome)}</small>` : ''}` },
      {
        label: '',
        render: (t) =>
          t.status === 'pendente' && can.write()
            ? html`<button class="btn small primary" data-task-act="done" data-id="${t.id}">Concluir</button> <button class="btn small" data-task-act="edit" data-id="${t.id}">Editar</button> <button class="btn small ghost" data-task-act="cancel" data-id="${t.id}">Cancelar</button>`
            : '',
      },
    ],
    tasks,
    { emptyMsg: 'Nenhuma tarefa.' },
  );
}

export function bindTasks(box, tasks, reload) {
  on(box, 'click', '[data-task-act]', async (e, b) => {
    const t = (typeof tasks === 'function' ? tasks() : tasks).find((x) => x.id === Number(b.dataset.id));
    try {
      let ok = false;
      if (b.dataset.taskAct === 'done') ok = await completeTask(t);
      if (b.dataset.taskAct === 'edit') ok = await taskForm({ task: t });
      if (b.dataset.taskAct === 'cancel') ok = await cancelTask(t);
      if (ok) reload();
    } catch (ex) {
      toastError(ex);
    }
  });
}

export function contractsTable(rows, { showContact = false } = {}) {
  return table(
    [
      { label: 'Código', render: (k) => html`<a href="#" data-contract="${k.id}">${k.code}</a>${k.contract_number ? html`<br><small>Nº ${k.contract_number}</small>` : ''}` },
      ...(showContact ? [{ label: 'Cliente', render: (k) => html`<a href="#/leads/${k.contact_id}">${k.contact_name}</a>` }] : []),
      { label: 'Categoria', render: (k) => optLabel('categoria_credito', k.category || state.meta.products.find((p) => p.id === k.product_id)?.category) },
      { label: 'Administradora', render: (k) => k.administrator || '—' },
      { label: 'Grupo / cota', render: (k) => `${k.group_code || '—'} / ${k.quota_code || '—'}` },
      { label: 'Crédito', render: (k) => fmtMoney(k.credit_value), cls: 'num' },
      { label: 'Parcela', render: (k) => html`${fmtMoney(k.installment_value)}${k.due_day ? html`<br><small>vence dia ${k.due_day}</small>` : ''}`, cls: 'num' },
      { label: 'Prazo / cotas', render: (k) => `${k.term_months ? `${k.term_months} m` : '—'} · ${k.quotas ?? '—'}` },
      { label: 'Contratação', render: (k) => fmtDate(k.contracted_at) },
      { label: 'Status', render: (k) => html`${badge(optLabel('status_contrato', k.status))}${k.contemplated_at ? html`<br><small>Contemplado em ${fmtDate(k.contemplated_at)}${k.contemplation_type ? ` (${optLabel('tipo_contemplacao', k.contemplation_type)})` : ''}</small>` : ''}` },
      { label: 'Vendedor', render: (k) => html`${k.seller_name || (k.seller_id ? userName(k.seller_id) : '—')}${k.sale_value ? html`<br><small>Venda da carta: ${fmtMoney(k.sale_value)}</small>` : ''}` },
    ],
    rows,
    { emptyMsg: 'Nenhum produto contratado.' },
  );
}
