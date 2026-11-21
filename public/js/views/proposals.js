// Propostas: todas as propostas (consórcio e carta contemplada, planejamento financeiro, seguros e investimentos) em
// Kanban pela régua de follow-up (Dia 0, 2, 5, 9, 14 e 21) ou em Lista, com o link on-line rastreável para o cliente
// (Aguardando / Lido / Avançar, tempo na proposta e acessos), PDF e modelo de mensagem do WhatsApp.
import { get, post, patch, download } from '../api.js';
import { html, render, $, on, state, selectOptions, opts, userItems, badge, fmtMoney, fmtDate, fmtDateTime, relTime, optLabel, K, can, modal, field, toast, toastError, empty } from '../ui.js';
import { icon } from '../icons.js';
import { proposalDetail, newProposalFlow } from '../forms.js';
import { probBadge } from './dashboard.js';
import { linkBadge, readTime, optionButtons, bindOptionButtons } from '../proposal-actions.js';
import { bindDrawerLinks } from '../drawer.js';

const VIEW_KEY = 'crm-prop-view';
const savedView = () => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'lista' ? 'lista' : 'kanban';
  } catch {
    return 'kanban';
  }
};
let saved = { status: 'andamento' };

const STEPS = [['D0', 'Dia 0'], ['D2', 'Dia 2'], ['D5', 'Dia 5'], ['D9', 'Dia 9'], ['D14', 'Dia 14'], ['D21', 'Dia 21']];
const COLS = [['gerada', 'Gerada', 'ainda não enviada'], ...STEPS.map(([k, l]) => [k, l, null])];
const AREA_LABEL = { consorcio: 'Consórcio', seguros: 'Seguros', planejamento: 'Planejamento', investimentos: 'Investimentos' };
const ACTIVE = ['rascunho', 'apresentada', 'em_analise'];

/** Área e categoria: consórcio mostra a categoria (ou "carta contemplada"); as outras áreas, o nome da área. */
const areaCell = (p) => {
  const a = p.area || 'consorcio';
  const sub = a === 'consorcio' ? (p.consortium_kind === 'contemplada' ? 'Carta contemplada' : optLabel('categoria_credito', p.category) || '') : p.diagnostic_id ? 'do diagnóstico' : '';
  return html`<span class="chip-sm area area-${a}">${AREA_LABEL[a]}</span>${sub ? html`<small class="muted"> ${sub}</small>` : ''}`;
};
const code = (p) => String(p.code).replace(/-v\d+$/, '');
const dateTime = (v) => {
  const [d, t] = String(fmtDateTime(v)).split(', ');
  return html`${d}${t ? html`<br><small class="muted">${t}</small>` : ''}`;
};

/** Régua: Dia 0 a Dia 21 (feito, atrasado, a fazer, cancelado). */
const REGUA_LABEL = { feito: 'feito', atrasado: 'atrasado', pendente: 'a fazer', cancelado: 'encerrado' };
const regua = (p) => html`<span class="regua">${(p.regua || []).map((r) => html`<span class="rg rg-${r.status || 'none'} ${p.next_step === r.step ? 'rg-next' : ''}" title="${STEPS.find(([k]) => k === r.step)[1]}${r.status ? ` · ${REGUA_LABEL[r.status]}` : ''}${r.due_at ? ` · ${fmtDateTime(r.due_at)}` : ''}">${r.step.slice(1)}</span>`)}</span>`;

export async function show(view, { params }) {
  let mode = params.ver === 'lista' ? 'lista' : params.ver === 'kanban' ? 'kanban' : savedView();
  const manager = can.manage();
  render(view, html`<div class="page wide proposals-page">
    <div class="page-head"><div><h1>Propostas</h1><p class="muted">Consórcio, carta contemplada, planejamento financeiro, seguros e investimentos: do envio do link ao aceite, com a régua de follow-up.</p></div>
      <div class="actions">${can.write() ? html`<button class="btn primary" data-act="new">${icon('adicionar', 16)} Nova proposta</button>` : ''}${can.admin() ? html`<button class="btn" data-act="export">Exportar CSV</button>` : ''}</div></div>
    <div id="kpis"></div>
    <form class="pipe-bar prop-bar" data-f><div class="pb-line">
      <label class="pb-search">${icon('buscar', 16)}<input type="search" name="q" placeholder="Buscar cliente ou ID da proposta" value="${saved.q || ''}" aria-label="Buscar"></label>
      <select name="area" aria-label="Área">${selectOptions(Object.entries(AREA_LABEL).map(([value, label]) => ({ value, label })), saved.area, { placeholder: 'Todas as áreas' })}</select>
      <select name="status" aria-label="Situação">${selectOptions([{ value: 'andamento', label: 'Em andamento' }, { value: 'aprovada', label: 'Aceitas' }, { value: 'recusada', label: 'Recusadas' }, { value: 'expirada', label: 'Expiradas' }], saved.status, { placeholder: 'Todas as situações' })}</select>
      <select name="link" aria-label="Link do cliente">${selectOptions([{ value: 'aguardando', label: 'Link: aguardando' }, { value: 'lido', label: 'Link: lido' }, { value: 'avancar', label: 'Link: avançar' }, { value: 'sem_link', label: 'Link não gerado' }], saved.link, { placeholder: 'Link do cliente' })}</select>
      ${manager ? html`<select name="owner_id" aria-label="Usuário">${selectOptions(userItems(), saved.owner_id, { placeholder: 'Todos os usuários' })}</select>` : ''}
      <span class="seg view-toggle" role="group" aria-label="Visualização">
        <button type="button" data-mode="kanban" class="${mode === 'kanban' ? 'active' : ''}">${icon('kanban', 16)} Kanban</button>
        <button type="button" data-mode="lista" class="${mode === 'lista' ? 'active' : ''}">${icon('lista', 16)} Lista</button></span>
    </div></form>
    <div id="list"></div></div>`);
  const form = $('[data-f]', view);
  let data = null;
  let rows = [];
  const draw = () => render($('#list', view), mode === 'kanban' ? board(rows, data.summary, saved.status) : list(rows));
  const load = async () => {
    const f = Object.fromEntries(new FormData(form).entries());
    saved = f;
    try {
      // O Kanban mostra as em andamento e as aceitas/recusadas recentes; a Lista segue o filtro de situação
      data = await get('/api/propostas-panorama', { status: mode === 'kanban' && f.status === 'andamento' ? '' : f.status, owner_id: f.owner_id, area: f.area, q: f.q });
    } catch (e) {
      return toastError(e);
    }
    rows = data.rows;
    if (f.link) rows = rows.filter((p) => p.link_status === f.link);
    const s = data.summary;
    render($('#kpis', view), html`<div class="kpis small prop-kpis">
      <div class="kpi"><div class="kpi-label">Em andamento</div><div class="kpi-value">${s.em_andamento}</div><div class="kpi-sub">${fmtMoney(s.valor_andamento)}</div></div>
      <div class="kpi"><div class="kpi-label">Geradas no mês</div><div class="kpi-value">${s.geradas_mes}</div><div class="kpi-sub">${s.enviadas_mes} enviadas</div></div>
      <div class="kpi"><div class="kpi-label">Link aguardando</div><div class="kpi-value">${s.links_aguardando}</div><div class="kpi-sub">enviado e ainda não aberto</div></div>
      <div class="kpi"><div class="kpi-label">Link lido</div><div class="kpi-value">${s.links_lidos}</div><div class="kpi-sub">cliente abriu a proposta</div></div>
      <div class="kpi ${s.querem_avancar ? 'ok-kpi' : ''}"><div class="kpi-label">Querem avançar</div><div class="kpi-value">${s.querem_avancar}</div><div class="kpi-sub">clicaram em "Avançar"</div></div>
      <div class="kpi"><div class="kpi-label">Taxa de aceite</div><div class="kpi-value">${s.taxa_aceite != null ? `${s.taxa_aceite}%` : '—'}</div><div class="kpi-sub">aceitas ÷ decididas</div></div>
    </div>`);
    draw();
  };
  let t;
  form.addEventListener('change', load);
  form.q.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(load, 300);
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  on(form, 'click', '[data-mode]', (e, b) => {
    mode = b.dataset.mode;
    try {
      localStorage.setItem(VIEW_KEY, mode);
    } catch {}
    form.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('active', x === b));
    load();
  });
  on(view, 'click', '[data-prop]', (e, a) => {
    e.preventDefault();
    proposalDetail(a.dataset.prop, load);
  });
  bindOptionButtons(view, (id) => rows.find((p) => p.id === id), load);
  bindDrawerLinks(view);
  on(view, 'click', '[data-done]', async (e, b) => {
    const p = rows.find((x) => x.id === Number(b.dataset.proposal));
    const step = state.meta.constants.proposal_cadence.find((c) => c.step === p?.next_step);
    const ok = await modal({
      title: 'Registrar follow-up',
      body: html`<p><strong>${step?.title || b.dataset.title}</strong></p><p class="hint">${step?.script || ''}</p>${field({ name: 'notes', label: 'Como foi o contato?', type: 'textarea', full: true, required: true })}
        ${field({ name: 'response', label: 'Retorno do cliente', type: 'select', options: opts('resposta_proposta'), placeholder: 'Sem registrar' })}`,
      submitLabel: 'Concluir follow-up',
      async onSubmit(d) {
        await patch(`/api/tarefas/${b.dataset.done}`, { action: 'concluir', notes: d.notes });
        if (d.response) await post(`/api/propostas/${b.dataset.proposal}/resposta`, { response: d.response, notes: d.notes });
        toast('Follow-up registrado.');
        return true;
      },
    });
    if (ok) load();
  });
  on(view, 'click', '[data-act=export]', () => download('/api/exportar/propostas', {}).catch(toastError));
  on(view, 'click', '[data-act=new]', () => newProposal().then((r) => r && load()));
  await load();
  // Aviso "cliente abriu / quer avançar": abre a proposta direto
  if (params.id) proposalDetail(params.id, load);
}

function card(p) {
  const nf = p.next_followup;
  return html`<article class="opp-card prop-card lvl-${p.level} ${p.link_status === 'avancar' ? 'wants' : ''}">
    <div class="prop-card-top"><a href="#" data-prop="${p.id}" class="title">${p.contact_name}</a>${probBadge(p)}</div>
    <div class="small muted">${code(p)} · ${p.owner_name || '—'}</div>
    <div class="prop-card-area">${areaCell(p)}</div>
    <div class="prop-card-value">${fmtMoney(p.credit_value)}${p.initial_installment && (p.area || 'consorcio') === 'consorcio' ? html`<small> · parcela ${fmtMoney(p.initial_installment)}</small>` : ''}</div>
    <div class="prop-card-link">${linkBadge(p)}${p.link_views ? html`<small class="muted">${p.link_views} acesso(s) · ${readTime(p.link_seconds)}</small>` : ''}</div>
    ${ACTIVE.includes(p.status) && p.status !== 'rascunho' ? regua(p) : ''}
    ${nf ? html`<div class="small ${nf.overdue ? 'overdue' : ''}">▸ ${nf.title.replace(/ \(PR-[\d-v]+\)$/, '')} (${relTime(nf.due_at)})</div>` : ''}
    ${p.alerts.length ? html`<div class="small warn-text">${p.alerts.join(' · ')}</div>` : ''}
    <div class="prop-card-foot">${optionButtons(p)}
      ${can.write() && nf ? html`<button class="btn small" data-done="${nf.id}" data-proposal="${p.id}" data-title="${nf.title}">Registrar follow-up</button>` : ''}
      ${p.status === 'rascunho' && can.write() ? html`<button class="btn small" data-p-wa="${p.id}">Enviar ao cliente</button>` : ''}</div>
  </article>`;
}

const RECENT = 60 * 86400000;
const recent = (d) => d && Date.now() - Date.parse(d) < RECENT;

function board(rows, summary, status) {
  const active = rows.filter((p) => ACTIVE.includes(p.status));
  const accepted = rows.filter((p) => p.status === 'aprovada' && (status === 'aprovada' || recent(p.accepted_at || p.updated_at)));
  const refused = rows.filter((p) => ['recusada', 'expirada'].includes(p.status) && (status === 'recusada' || status === 'expirada' || recent(p.refused_at || p.updated_at)));
  const col = (key) => active.filter((p) => p.cadence_stage === key);
  const total = (l) => fmtMoney(l.reduce((t, p) => t + (p.credit_value || 0), 0));
  const reasons = summary.recusas_por_motivo || [];
  const showActive = !['aprovada', 'recusada', 'expirada'].includes(status);
  return html`<div class="kanban prop-kanban">${showActive ? COLS.map(([k, label, hint]) => {
    const cards = col(k);
    const late = cards.filter((p) => p.next_followup?.overdue).length;
    return html`<section class="column" data-key="${k}"><header><strong>${label}</strong><span class="count">${cards.length}</span>
      <small>${cards.length ? total(cards) : hint || '—'}${late ? html` · <span class="overdue">${late} atrasado(s)</span>` : ''}</small></header>
      <div class="cards">${cards.length ? cards.map(card) : html`<div class="empty small">—</div>`}</div></section>`;
  }) : ''}
    ${status !== 'recusada' && status !== 'expirada' ? html`<section class="column kind-ganho"><header><strong>Aceitas</strong><span class="count">${accepted.length}</span><small>${accepted.length ? total(accepted) : 'seguem para a pré-venda'}</small></header>
      <div class="cards">${accepted.length ? accepted.map((p) => html`<article class="opp-card"><a href="#" data-prop="${p.id}" class="title">${p.contact_name}</a><div class="small muted">${code(p)} · ${p.owner_name || '—'}</div><div>${areaCell(p)}</div><div class="small">${fmtMoney(p.credit_value)} · aceita em ${fmtDate(p.accepted_at)}</div><a class="small" href="#/prevenda">ver pré-venda</a></article>`) : html`<div class="empty small">—</div>`}</div></section>` : ''}
    ${status !== 'aprovada' ? html`<section class="column kind-perdido"><header><strong>Recusadas</strong><span class="count">${refused.length}</span><small>${refused.length ? total(refused) : 'com o motivo da recusa'}</small></header>
      <div class="cards">${refused.length
        ? refused.map((p) => html`<article class="opp-card refused"><a href="#" data-prop="${p.id}" class="title">${p.contact_name}</a>
            <div class="small muted">${code(p)} · ${p.owner_name || '—'}</div>
            <div class="small">${fmtMoney(p.credit_value)} · ${p.status === 'expirada' ? 'expirada' : 'recusada'} em ${fmtDate(p.refused_at || p.updated_at)}</div>
            ${p.refusal_reason ? html`<div>${badge(optLabel('motivo_recusa_proposta', p.refusal_reason), 'danger')}</div>` : ''}
            ${p.retake_at ? html`<div class="small">▸ Retomar em ${fmtDate(p.retake_at)}</div>` : ''}</article>`)
        : html`<div class="empty small">—</div>`}</div></section>` : ''}
  </div>
  ${reasons.length && showActive ? html`<section class="card"><h3>Motivos de recusa</h3>
    <div class="reason-bars">${reasons.map((r) => html`<div class="reason-row"><span>${r.label} ${r.recuperavel ? badge('recuperável', 'ok') : ''}</span>
      <span class="bar"><span style="width:${Math.round((r.count / reasons[0].count) * 100)}%"></span></span><strong>${r.count}</strong><small class="muted">${fmtMoney(r.credit)}</small></div>`)}</div></section>` : ''}
  <p class="muted small">A coluna é o próximo passo da régua (dias corridos a partir do envio; sábado e domingo passam para segunda). Enviada até as 16h, o Dia 0 é no próprio dia. Aceitas e recusadas mostram os últimos 60 dias.</p>`;
}

function list(rows) {
  if (!rows.length) return html`<section class="card">${empty('Nenhuma proposta com esses filtros.')}</section>`;
  return html`<section class="card table-card"><div class="table-wrap"><table class="data prop-table">
    <thead><tr><th>ID proposta</th><th>Cliente</th><th>Área / categoria</th><th class="num">Valor</th><th>Status</th><th>Usuário</th><th>Gerada em</th>
      <th>Régua follow <small>(dias)</small></th><th>Link do cliente</th><th class="num">Tempo na proposta</th><th class="num">Acessos</th><th>Opções</th></tr></thead>
    <tbody>${rows.map((p) => html`<tr>
      <td data-label="ID proposta" class="nowrap"><a href="#" data-prop="${p.id}"><strong>${code(p)}</strong></a>${p.version > 1 ? html` <small>v${p.version}</small>` : ''}</td>
      <td data-label="Cliente"><a href="#/leads/${p.contact_id}" data-drawer="${p.contact_id}">${p.contact_name}</a><br><small class="muted">${p.contact_code}</small></td>
      <td data-label="Área / categoria">${areaCell(p)}</td>
      <td data-label="Valor" class="num nowrap">${fmtMoney(p.credit_value)}</td>
      <td data-label="Status">${badge(K('proposal_status', p.status), `st-${p.status}`)}</td>
      <td data-label="Usuário">${p.owner_name || '—'}</td>
      <td data-label="Gerada em" class="nowrap">${dateTime(p.generated_at || p.created_at)}</td>
      <td data-label="Régua follow">${p.status === 'rascunho' ? html`<span class="muted small">não enviada</span>` : regua(p)}</td>
      <td data-label="Link do cliente">${linkBadge(p)}</td>
      <td data-label="Tempo na proposta" class="num nowrap">${readTime(p.link_seconds)}</td>
      <td data-label="Acessos" class="num">${p.link_views || 0}</td>
      <td data-label="Opções">${optionButtons(p)}</td>
    </tr>`)}</tbody></table></div>
    <p class="muted small">Régua: <span class="rg rg-feito">0</span> feito · <span class="rg rg-pendente rg-next">2</span> próximo · <span class="rg rg-atrasado">5</span> atrasado · <span class="rg rg-none">9</span> sem tarefa. Link: Aguardando (enviado, não aberto), Lido (data e hora da primeira abertura) e Avançar (cliente clicou em "Quero avançar").</p></section>`;
}

/** Nova proposta: escolhe o cliente pelo nome ou ID e o negócio; segue para a área (consórcio, contemplada, planejamento…). */
async function newProposal() {
  let chosen = null;
  const ok = await modal({
    title: 'Nova proposta',
    wide: true,
    body: html`<p class="hint">A proposta é sempre vinculada ao cadastro do cliente. Busque pelo nome, telefone ou ID (ex.: C-000010).</p>
      <div class="field full"><label>Cliente</label><input type="search" name="q" placeholder="Nome, telefone ou ID" autocomplete="off"></div>
      <div class="pick-results"></div><div class="opp-pick"></div>`,
    submitLabel: 'Continuar',
    onMount(form) {
      let t;
      form.q.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          if (form.q.value.trim().length < 2) return;
          const rows = (await get('/api/busca', { q: form.q.value })).filter((r) => r.kind === 'contact');
          render($('.pick-results', form), rows.length ? html`${rows.map((r) => html`<label class="check"><input type="radio" name="pick" value="${r.id}"> <strong>${r.title}</strong> <small>${r.code}${r.subtitle ? ` · ${r.subtitle}` : ''}</small></label>`)}` : empty('Nenhum cadastro encontrado. Cadastre o lead antes de gerar a proposta.'));
        }, 250);
      });
      on(form, 'change', 'input[name=pick]', async (e, r) => {
        chosen = await get(`/api/cadastros/${r.value}`);
        const open = chosen.opportunities.filter((o) => o.status === 'aberta');
        render($('.opp-pick', form), open.length
          ? field({ name: 'opportunity_id', label: 'Negócio', type: 'select', options: open.map((o) => ({ value: o.id, label: `${o.code} — ${o.stage_name}${o.credit_value ? ` · ${fmtMoney(o.credit_value)}` : ''}` })), allowEmpty: false, full: true })
          : html`<div class="alert warn">Este cadastro não tem negócio aberto. Abra um negócio na ficha antes de gerar a proposta.</div>`);
      });
    },
    async onSubmit(d) {
      if (!chosen) throw new Error('Escolha o cliente.');
      if (!d.opportunity_id) throw new Error('O cliente precisa ter um negócio aberto.');
      const opp = await get(`/api/oportunidades/${d.opportunity_id}`);
      await newProposalFlow({ ...opp, contact_name: chosen.name }, chosen);
      return true;
    },
  });
  return ok;
}
