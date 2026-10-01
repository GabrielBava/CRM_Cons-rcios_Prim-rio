// 6. Propostas: esteira de follow-up (D0 a D10), panorama com probabilidade de fechamento e nova proposta a partir do cadastro.
import { get, post, patch, download } from '../api.js';
import { html, render, $, on, state, selectOptions, opts, userItems, table, badge, fmtMoney, fmtDate, fmtDateTime, relTime, optLabel, K, can, modal, field, toast, toastError, empty, subnav } from '../ui.js';
import { proposalDetail, openProposalSimulator } from '../forms.js';
import { probBadge } from './dashboard.js';

let saved = { status: 'andamento' };

const COLS = [
  ['gerada', 'Gerada (não enviada)'],
  ['enviada', 'Enviada'],
  ['D0', 'D0'],
  ['D1', 'D+1'],
  ['D2', 'D+2'],
  ['D3', 'D+3'],
  ['D5', 'D+5'],
  ['D10', 'D+10'],
];

export async function show(view, { params }) {
  const tab = params.aba === 'panorama' ? 'panorama' : 'esteira';
  const manager = can.manage();
  render(view, html`<div class="page wide">
    <div class="page-head"><div><h1>Propostas</h1><p class="muted">Cada proposta nasce do cadastro do cliente e segue a esteira de follow-up até o fechamento.</p></div>
      <div class="actions">${can.write() ? html`<button class="btn primary" data-act="new">+ Nova proposta</button>` : ''}${can.admin() ? html`<button class="btn" data-act="export">Exportar CSV</button>` : ''}</div></div>
    ${subnav([['#/propostas', 'Esteira de propostas', 'esteira'], ['#/propostas?aba=panorama', 'Panorama geral', 'panorama']], tab)}
    <div id="kpis"></div>
    <form class="filters" data-f>
      <label ${tab === 'esteira' ? 'hidden' : ''}>Situação<select name="status">${selectOptions([{ value: 'andamento', label: 'Em andamento' }, { value: 'aprovada', label: 'Aceitas' }, { value: 'recusada', label: 'Recusadas' }, { value: 'expirada', label: 'Expiradas' }], saved.status, { placeholder: 'Todas' })}</select></label>
      ${manager ? html`<label>Especialista<select name="owner_id">${selectOptions(userItems(), saved.owner_id, { placeholder: 'Todos' })}</select></label>` : ''}
      <label>Categoria<select name="category">${selectOptions(opts('categoria_credito'), saved.category, { placeholder: 'Todas' })}</select></label>
      <label>Chance de fechamento<select name="level">${selectOptions([{ value: 'alta', label: 'Alta' }, { value: 'media', label: 'Média' }, { value: 'baixa', label: 'Baixa' }], saved.level, { placeholder: 'Todas' })}</select></label>
      <label class="check"><input type="checkbox" name="alerts" value="1" ${saved.alerts ? 'checked' : ''}> Só com alerta</label>
    </form>
    <div id="list"></div></div>`);
  const form = $('[data-f]', view);
  let data = null;
  const load = async () => {
    const f = Object.fromEntries(new FormData(form).entries());
    saved = f;
    try {
      // A esteira mostra todas as situações (em andamento, aceitas e recusadas recentes); o panorama segue o filtro
      data = await get('/api/propostas-panorama', { status: tab === 'esteira' ? '' : f.status, owner_id: f.owner_id, category: f.category });
    } catch (e) {
      return toastError(e);
    }
    let rows = data.rows;
    if (f.level) rows = rows.filter((p) => p.level === f.level);
    if (f.alerts) rows = rows.filter((p) => p.alerts.length);
    const s = data.summary;
    render($('#kpis', view), html`<div class="kpis small">
      <div class="kpi"><div class="kpi-label">Geradas no mês</div><div class="kpi-value">${s.geradas_mes}</div><div class="kpi-sub">${s.enviadas_mes} enviadas</div></div>
      <div class="kpi"><div class="kpi-label">Em andamento</div><div class="kpi-value">${s.em_andamento}</div><div class="kpi-sub">${fmtMoney(s.valor_andamento)} em crédito</div></div>
      <div class="kpi"><div class="kpi-label">Potencial ponderado</div><div class="kpi-value">${fmtMoney(s.potencial_ponderado)}</div><div class="kpi-sub">crédito × chance de fechamento</div></div>
      <div class="kpi"><div class="kpi-label">Chance de fechamento</div><div class="kpi-value">${s.alta} / ${s.media} / ${s.baixa}</div><div class="kpi-sub">alta / média / baixa</div></div>
      <div class="kpi ${s.com_alerta ? 'alert-kpi' : ''}"><div class="kpi-label">Com alerta</div><div class="kpi-value">${s.com_alerta}</div><div class="kpi-sub">follow-up atrasado, validade ou sem decisão</div></div>
      <div class="kpi"><div class="kpi-label">Taxa de aceite</div><div class="kpi-value">${s.taxa_aceite != null ? `${s.taxa_aceite}%` : '—'}</div><div class="kpi-sub">aceitas ÷ decididas</div></div>
    </div>`);
    render($('#list', view), tab === 'esteira' ? board(rows, s) : overview(rows));
  };
  form.addEventListener('change', load);
  on(view, 'click', '[data-prop]', (e, a) => {
    e.preventDefault();
    proposalDetail(a.dataset.prop, load);
  });
  on(view, 'click', '[data-done]', async (e, b) => {
    const ok = await modal({
      title: 'Registrar follow-up',
      body: html`<p><strong>${b.dataset.title}</strong></p><p class="hint">${b.dataset.script || ''}</p>${field({ name: 'notes', label: 'Como foi o contato?', type: 'textarea', full: true, required: true })}
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
}

function card(p) {
  const nf = p.next_followup;
  const script = nf ? state.meta.constants.proposal_cadence.find((c) => nf.title.startsWith(c.title.split(' · ')[0]))?.script : '';
  return html`<article class="opp-card prop-card lvl-${p.level}">
    <a href="#" data-prop="${p.id}" class="title">${p.contact_name}</a>
    <div class="small muted">${p.code} · ${optLabel('categoria_credito', p.category)} · ${p.owner_name || '—'}</div>
    <div class="small">${fmtMoney(p.credit_value)}${p.initial_installment ? ` · parcela ${fmtMoney(p.initial_installment)}` : ''}</div>
    <div>${probBadge(p)}</div>
    ${nf ? html`<div class="small ${nf.overdue ? 'overdue' : ''}">▸ ${nf.title.replace(/ \(PR-\d+\)$/, '')} (${relTime(nf.due_at)})</div>` : ''}
    ${p.alerts.length ? html`<div class="small warn-text">${p.alerts.join(' · ')}</div>` : ''}
    ${can.write() && nf ? html`<button class="btn small" data-done="${nf.id}" data-proposal="${p.id}" data-title="${nf.title}" data-script="${script || ''}">Registrar follow-up</button>` : ''}
    ${p.status === 'rascunho' && can.write() ? html`<button class="btn small" data-prop="${p.id}">Completar e enviar</button>` : ''}
  </article>`;
}

const RECENT = 60 * 86400000;
const recent = (d) => d && Date.now() - Date.parse(d) < RECENT;

function board(rows, summary) {
  const active = rows.filter((p) => ['rascunho', 'apresentada', 'em_analise'].includes(p.status));
  const accepted = rows.filter((p) => p.status === 'aprovada' && recent(p.accepted_at || p.updated_at));
  const refused = rows.filter((p) => p.status === 'recusada' && recent(p.refused_at || p.updated_at));
  const col = (key) => active.filter((p) => p.cadence_stage === key);
  const total = (list) => fmtMoney(list.reduce((t, p) => t + (p.credit_value || 0), 0));
  const reasons = summary.recusas_por_motivo || [];
  return html`<div class="kanban">${COLS.map(([k, label]) => {
    const cards = col(k);
    return html`<section class="column"><header><strong>${label}</strong><span class="count">${cards.length}</span>${cards.length ? html`<small>${total(cards)}</small>` : ''}</header>
      <div class="cards">${cards.length ? cards.map(card) : html`<div class="empty small">—</div>`}</div></section>`;
  })}
    <section class="column kind-ganho"><header><strong>Aceitas</strong><span class="count">${accepted.length}</span><small>${accepted.length ? total(accepted) : 'seguem para a pré-venda'}</small></header>
      <div class="cards">${accepted.length ? accepted.map((p) => html`<article class="opp-card"><a href="#" data-prop="${p.id}" class="title">${p.contact_name}</a><div class="small">${fmtMoney(p.credit_value)} · aceita em ${fmtDate(p.accepted_at)}</div><a class="small" href="#/prevenda">ver pré-venda</a></article>`) : html`<div class="empty small">—</div>`}</div></section>
    <section class="column kind-perdido"><header><strong>Recusadas</strong><span class="count">${refused.length}</span><small>${refused.length ? total(refused) : 'com o motivo da recusa'}</small></header>
      <div class="cards">${refused.length
        ? refused.map((p) => html`<article class="opp-card refused"><a href="#" data-prop="${p.id}" class="title">${p.contact_name}</a>
            <div class="small">${fmtMoney(p.credit_value)} · recusada em ${fmtDate(p.refused_at || p.updated_at)}</div>
            <div>${badge(optLabel('motivo_recusa_proposta', p.refusal_reason) || 'Motivo não informado', 'danger')}</div>
            ${p.refusal_notes ? html`<div class="small muted">${p.refusal_notes}</div>` : ''}
            ${p.retake_at ? html`<div class="small">▸ Retomar em ${fmtDate(p.retake_at)}</div>` : ''}</article>`)
        : html`<div class="empty small">—</div>`}</div></section>
  </div>
  ${reasons.length ? html`<section class="card"><h3>Motivos de recusa</h3>
    <p class="hint">Base para o trabalho de recuperação (closer): os motivos marcados como recuperáveis indicam clientes que podem voltar com uma nova condição ou em outro momento.</p>
    <div class="reason-bars">${reasons.map((r) => html`<div class="reason-row"><span>${r.label} ${r.recuperavel ? badge('recuperável', 'ok') : ''}</span>
      <span class="bar"><span style="width:${Math.round((r.count / reasons[0].count) * 100)}%"></span></span><strong>${r.count}</strong><small class="muted">${fmtMoney(r.credit)}</small></div>`)}</div></section>` : ''}
  <p class="muted small">A coluna indica o último follow-up concluído. Enviada pela manhã, a proposta tem D0 no fim do dia; à tarde, a esteira começa no D+1 (dias úteis). Aceitas e recusadas mostram os últimos 60 dias. Para recusar, abra a proposta e informe o motivo.</p>`;
}

function overview(rows) {
  return html`<section class="card">${table(
    [
      { label: 'Proposta', render: (p) => html`<a href="#" data-prop="${p.id}">${p.code}</a> <small>v${p.version}</small>` },
      { label: 'Cliente', render: (p) => html`<a href="#/leads/${p.contact_id}">${p.contact_name}</a><br><small>${p.contact_code}</small>` },
      { label: 'Categoria', render: (p) => optLabel('categoria_credito', p.category) },
      { label: 'Crédito', render: (p) => html`${fmtMoney(p.credit_value)}${p.initial_installment ? html`<br><small>parcela ${fmtMoney(p.initial_installment)}</small>` : ''}`, cls: 'num' },
      { label: 'Gerada / enviada', render: (p) => html`${fmtDate(p.created_at)}<br><small>${p.presented_at ? `enviada ${fmtDate(p.presented_at)}` : 'não enviada'}</small>` },
      { label: 'Situação', render: (p) => html`${badge(K('proposal_status', p.status), `st-${p.status}`)}<br><small>${['rascunho', 'apresentada', 'em_analise'].includes(p.status) ? `esteira: ${p.cadence_stage}` : ''}</small>` },
      { label: 'Chance', render: (p) => html`<span title="${p.factors.map(([l, v]) => `${l} (${v > 0 ? '+' : ''}${v})`).join('\n')}">${probBadge(p)}</span><br><small>ponderado ${fmtMoney(p.weighted)}</small>` },
      { label: 'Próximo follow-up', render: (p) => (p.next_followup ? html`<span class="${p.next_followup.overdue ? 'overdue' : ''}">${fmtDateTime(p.next_followup.due_at)}</span><br><small>${p.next_followup.title.replace(/ \(PR-\d+\)$/, '')}</small>` : '—') },
      { label: 'Especialista', render: (p) => p.owner_name || '—' },
      { label: 'Alertas', render: (p) => (p.alerts.length ? html`<span class="warn-text small">${p.alerts.join(' · ')}</span>` : '—') },
    ],
    rows,
    { emptyMsg: 'Nenhuma proposta com esses filtros.' },
  )}<p class="muted small">Passe o mouse sobre a chance para ver os fatores considerados.</p></section>`;
}

/** Nova proposta: escolhe o cliente pelo nome ou ID e o negócio; o simulador abre com nome e contato preenchidos. */
async function newProposal() {
  let chosen = null;
  const ok = await modal({
    title: 'Nova proposta',
    wide: true,
    body: html`<p class="hint">A proposta é sempre vinculada ao cadastro do cliente. Busque pelo nome, telefone ou ID (ex.: C-000010).</p>
      <div class="field full"><label>Cliente</label><input type="search" name="q" placeholder="Nome, telefone ou ID" autocomplete="off"></div>
      <div class="pick-results"></div><div class="opp-pick"></div>`,
    submitLabel: 'Abrir o simulador',
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
      await openProposalSimulator(chosen, Number(d.opportunity_id));
      return true;
    },
  });
  return ok;
}
