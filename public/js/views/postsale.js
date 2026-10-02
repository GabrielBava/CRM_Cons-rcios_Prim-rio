// 11. Pós-venda: começa na confirmação da venda (cota alocada). Funil de farm com linha do tempo D+N e alertas,
// satisfação (NPS) com alertas e motivos, e estratégias de lance com histórico.
import { get, post } from '../api.js';
import { html, render, raw, $, $$, on, fresh, state, selectOptions, opts, userItems, table, badge, fmtMoney, fmtNum, fmtDate, fmtDateTime, relTime, optLabel, can, modal, field, toast, toastError, empty, subnav } from '../ui.js';
import { bindDrawerLinks } from '../drawer.js';
import { npsCategory, NPS_ANSWER_LABELS, bidSummary, bidForm, bidHistoryList, copyBox, pageUrl, bindCopy } from './record-tabs.js';
import { timelineList, bindTimeline, psBadge } from '../postsale-timeline.js';

const PREF = { whatsapp: 'WhatsApp', ligacao: 'Ligação', email: 'E-mail', sms: 'SMS', presencial: 'Presencial' };

export async function show(view, { params = {} } = {}) {
  const tab = ['nps', 'lances'].includes(params.aba) ? params.aba : 'checklist';
  render(view, html`<div class="page wide">
    <div class="page-head"><div><h1>Pós-venda</h1><p class="muted">Começa na confirmação da venda (cota alocada). Cada etapa tem um prazo D+N; a tarefa da próxima etapa entra na agenda do responsável.</p></div></div>
    ${subnav([['#/posvenda', 'Funil de pós-venda', 'checklist'], ['#/posvenda?aba=nps', 'Satisfação (NPS)', 'nps'], ['#/posvenda?aba=lances', 'Estratégias de lance', 'lances']], tab)}
    <div id="tab"></div></div>`);
  const box = fresh($('#tab', view));
  bindDrawerLinks(box);
  if (tab === 'nps') return npsTab(box);
  if (tab === 'lances') return bidsTab(box);
  return checklistTab(box);
}

/* ------------------------- Checklist ------------------------- */

let ckSaved = { status: 'incompleto', view: 'funil' };
const salesCell = (c) => html`${c.sales.length ? c.sales.map((v) => html`<div><strong>${v.code}</strong> · ${fmtMoney(v.credit_value)}${v.quotas_count > 1 ? html` <small class="muted">${v.quotas_count} cotas</small>` : ''}</div>`) : html`<span class="muted small">${fmtMoney(c.credit_total)}</span>`}${c.without_strategy ? html`<small class="warn-text">${c.without_strategy} carta(s) sem estratégia de lance</small>` : ''}`;

async function checklistTab(box) {
  const manager = can.manage();
  const w = can.write();
  let data;
  const load = async () => {
    try {
      data = await get('/api/pos-venda', { ...ckSaved, view: undefined });
    } catch (e) {
      return toastError(e);
    }
    const s = data.summary;
    const cols = [...data.items.map((i) => ({ key: i.value, label: i.label, days: i.days })), { key: 'concluido', label: 'Funil concluído', days: null }];
    const card = (c) => html`<article class="opp-card ps-card ${c.next_item?.status === 'atrasado' ? 'prio-alta' : ''}">
        <a class="title" href="#/clientes/${c.id}" data-drawer="${c.id}">${c.name}</a>
        <div class="small muted">${c.code} · ${c.postsale_name || 'sem responsável'}</div>
        <div class="small">${salesCell(c)}</div>
        ${c.next_item ? html`<div class="small">${psBadge(c.next_item.status)} ${c.next_item.due_at ? html`até ${fmtDate(c.next_item.due_at)}` : ''}</div>` : ''}
        <div class="small muted">${c.done}/${c.total} etapas · cliente há ${c.days_since_sale ?? '—'} dia(s)</div>
        ${w ? html`<button type="button" class="btn small" data-ck="${c.id}">Linha do tempo</button>` : ''}
      </article>`;
    render(box, html`
      <div class="kpis small">
        <div class="kpi"><div class="kpi-label">Clientes no funil</div><div class="kpi-value">${s.incompletos}</div><div class="kpi-sub">${s.concluidos} com o funil concluído</div></div>
        <div class="kpi ${s.atrasados ? 'alert-kpi' : ''}"><div class="kpi-label">Com etapa atrasada</div><div class="kpi-value">${s.atrasados}</div><div class="kpi-sub">passaram do prazo D+N</div></div>
        <div class="kpi ${s.sem_estrategia ? 'alert-kpi' : ''}"><div class="kpi-label">Cartas sem estratégia de lance</div><div class="kpi-value">${s.sem_estrategia}</div><div class="kpi-sub"><a href="#/posvenda?aba=lances">ver estratégias</a></div></div>
      </div>
      <div class="ps-ruler">${data.items.map((i) => html`<span><strong>D+${i.days}</strong> ${i.label}</span>`)}</div>
      <form class="filters" data-f>
        <label class="grow">Buscar<input type="search" name="q" value="${ckSaved.q || ''}" placeholder="Cliente, código ou venda (VD-…)"></label>
        <label>Situação<select name="status">${selectOptions([{ value: 'incompleto', label: 'Em andamento' }, { value: 'atrasado', label: 'Com etapa atrasada' }, { value: 'completo', label: 'Funil concluído' }], ckSaved.status, { placeholder: 'Todos' })}</select></label>
        <label>Etapa atual<select name="item">${selectOptions(data.items.map((i) => ({ value: i.value, label: `D+${i.days} · ${i.label}` })), ckSaved.item, { placeholder: 'Qualquer' })}</select></label>
        ${manager ? html`<label>Responsável pós-venda<select name="postsale_owner_id">${selectOptions(userItems(), ckSaved.postsale_owner_id, { placeholder: 'Todos' })}</select></label>` : ''}
        <div class="seg small"><button type="button" class="btn small ${ckSaved.view !== 'lista' ? 'active' : ''}" data-view="funil">Funil</button><button type="button" class="btn small ${ckSaved.view === 'lista' ? 'active' : ''}" data-view="lista">Lista</button></div>
      </form>
      ${ckSaved.view === 'lista'
        ? html`<section class="card">${table(
            [
              { label: 'Cliente', render: (c) => html`<a href="#/clientes/${c.id}" data-drawer="${c.id}"><strong>${c.name}</strong></a><br><small>${c.code} · cliente há ${c.days_since_sale ?? '—'} dia(s)</small>` },
              { label: 'Vendas', render: salesCell },
              {
                label: 'Responsável pós-venda',
                render: (c) => (manager ? html`<select data-owner="${c.id}" aria-label="Responsável pós-venda de ${c.name}">${selectOptions(userItems(), c.postsale_id, { placeholder: 'Especialista do cliente' })}</select>` : c.postsale_name || '—'),
              },
              {
                label: 'Etapa atual',
                render: (c) => html`<div class="ck-dots" title="${c.checklist.map((i) => `${i.done_at ? '✓' : '○'} D+${i.days} ${i.label}`).join('\n')}">${c.checklist.map((i) => html`<span class="dot ${i.status === 'feito' ? 'ok' : i.status === 'atrasado' ? 'danger' : 'muted'}"></span>`)} <strong>${c.done}/${c.total}</strong></div>
                  ${c.next_item ? html`<small>${c.next_item.label} · D+${c.next_item.days}</small> ${psBadge(c.next_item.status)}` : html`<small class="ok-text">Funil concluído</small>`}`,
              },
              { label: 'NPS', render: (c) => (c.nps_score != null ? html`${badge(`Nota ${c.nps_score}`, npsCategory(c.nps_score)[1])}<br><small>${fmtDate(c.nps_at)}</small>` : c.nps_pending ? badge('Aguardando resposta', 'warn') : html`<span class="muted small">sem pesquisa</span>`) },
              { label: '', render: (c) => html`${w ? html`<button class="btn small primary" data-ck="${c.id}">Linha do tempo</button> ` : ''}<a class="btn small ghost" href="#/clientes/${c.id}/posvenda">Ficha</a>` },
            ],
            data.rows,
            { emptyMsg: 'Nenhum cliente com esses filtros. O pós-venda começa quando a venda é confirmada.' },
          )}</section>`
        : html`<div class="kanban ps-kanban">${cols.filter((col) => col.key !== 'concluido' || ckSaved.status !== 'incompleto').map((col) => {
            const list = data.rows.filter((r) => r.stage === col.key);
            const late = list.filter((r) => r.next_item?.status === 'atrasado').length;
            return html`<section class="column ${col.key === 'concluido' ? 'kind-ganho' : ''}">
              <header><strong>${col.days != null ? html`<span class="muted">D+${col.days}</span> ` : ''}${col.label}</strong> <span class="count">${list.length}</span>${late ? html`<br><small class="danger-text">${late} atrasado(s)</small>` : ''}</header>
              <div class="cards">${list.length ? list.map(card) : html`<p class="muted small">Ninguém nesta etapa.</p>`}</div></section>`;
          })}</div>`}
      <p class="hint">Linha do tempo a partir da confirmação da venda: ${data.items.map((i) => `D+${i.days} ${i.label.toLowerCase()}`).join(' · ')}. A indicação só é pedida para clientes promotores no NPS; com nota baixa, a etapa é dispensada e a satisfação é tratada antes. Os prazos ficam em Configurações › Geral.</p>`);
    const f = $('[data-f]', box);
    let t;
    const read = () => ({ ...Object.fromEntries(new FormData(f).entries()), view: ckSaved.view });
    f.addEventListener('input', (e) => {
      if (e.target.name !== 'q') return;
      clearTimeout(t);
      t = setTimeout(() => ((ckSaved = read()), load()), 300);
    });
    f.addEventListener('change', (e) => e.target.name !== 'q' && ((ckSaved = read()), load()));
    f.addEventListener('submit', (e) => e.preventDefault());
  };
  on(box, 'click', '[data-view]', (e, b) => {
    ckSaved = { ...ckSaved, view: b.dataset.view };
    load();
  });
  on(box, 'change', '[data-owner]', async (e, sel) => {
    try {
      await post(`/api/pos-venda/${sel.dataset.owner}/responsavel`, { user_id: sel.value || null });
      toast('Responsável pós-venda atualizado.');
    } catch (ex) {
      toastError(ex);
      load();
    }
  });
  on(box, 'click', '[data-ck]', async (e, b) => {
    const id = Number(b.dataset.ck);
    let c = data.rows.find((r) => r.id === id);
    let changed = false;
    await modal({
      title: `Pós-venda — ${c.name}`,
      wide: true,
      body: html`<p class="small muted">${c.sales.map((v) => `${v.code} · ${fmtMoney(v.credit_value)}`).join(' · ')}${c.postsale_name ? ` · responsável: ${c.postsale_name}` : ''}</p><div data-tl>${timelineList(c.checklist, { w })}</div>`,
      onMount(form) {
        bindTimeline(form, id, () => c.checklist, async () => {
          changed = true;
          const d2 = await get('/api/pos-venda', { q: c.code, status: '' });
          c = d2.rows.find((r) => r.id === id) || c;
          render($('[data-tl]', form), timelineList(c.checklist, { w }));
        });
      },
    });
    if (changed) load();
  });
  await load();
}

/* ------------------------- Satisfação (NPS) ------------------------- */

let npsSaved = { months: '12' };
async function npsTab(box) {
  const w = can.write();
  let d;
  const load = async () => {
    try {
      d = await get('/api/pos-venda/nps', npsSaved);
    } catch (e) {
      return toastError(e);
    }
    const s = d.summary;
    const npsKind = s.nps == null ? '' : s.nps >= 50 ? 'ok' : s.nps >= 0 ? 'warn' : 'danger';
    const maxReason = Math.max(1, ...s.motivos.map((m) => m.n));
    render(box, html`
      <div class="kpis small">
        <div class="kpi"><div class="kpi-label">NPS (${d.months} meses)</div><div class="kpi-value ${npsKind}-text">${s.nps ?? '—'}</div><div class="kpi-sub">% promotores − % detratores</div></div>
        <div class="kpi"><div class="kpi-label">Respondidas</div><div class="kpi-value">${s.respondidas} / ${s.enviadas}</div><div class="kpi-sub">${s.taxa_resposta != null ? `${s.taxa_resposta}% de resposta` : 'nenhuma enviada'}</div></div>
        <div class="kpi"><div class="kpi-label">Promotores · Neutros · Detratores</div><div class="kpi-value"><span class="ok-text">${s.promotores}</span> · <span class="warn-text">${s.neutros}</span> · <span class="danger-text">${s.detratores}</span></div></div>
        <div class="kpi ${s.sem_tratativa ? 'alert-kpi' : ''}"><div class="kpi-label">Detratores sem tratativa</div><div class="kpi-value">${s.sem_tratativa}</div><div class="kpi-sub">trate em até 24 h</div></div>
      </div>
      <div class="cols">
        <section class="card"><h3>Alertas</h3>${d.alerts.length
          ? html`<ul class="actions-list">${d.alerts.slice(0, 15).map((a) => html`<li class="lvl-${a.level}"><span class="dot"></span><span class="grow"><a href="#/clientes/${a.contact_id}" data-drawer="${a.contact_id}">${a.text}</a></span>
              ${w && a.kind === 'detrator' ? html`<button class="btn small" data-treat="${a.survey_id}">Registrar tratativa</button>` : ''}
              ${w && a.kind === 'sem_pesquisa' ? html`<button class="btn small" data-send="${a.contact_id}">Enviar pesquisa</button>` : ''}</li>`)}</ul>`
          : empty('Nenhum alerta. 👏')}</section>
        <section class="card"><h3>Motivos de insatisfação</h3>${s.motivos.length
          ? html`<div class="reason-bars">${s.motivos.map((m) => html`<div class="reason-row short"><span>${m.label}</span><span class="bar"><span style="width:${Math.round((m.n / maxReason) * 100)}%"></span></span><strong>${m.n}</strong></div>`)}</div>`
          : empty('Nenhum motivo registrado no período.')}
          <h4>Avaliações complementares (1 a 5)</h4>
          <dl class="kv-list">${Object.values(s.perguntas).map((q) => html`<div><dt>${q.label}</dt><dd>${fmtNum(q.avg)}${q.n ? html` <small class="muted">(${q.n})</small>` : ''}</dd></div>`)}</dl></section>
      </div>
      <form class="filters" data-f>
        <label>Período<select name="months">${selectOptions([{ value: '3', label: 'Últimos 3 meses' }, { value: '6', label: 'Últimos 6 meses' }, { value: '12', label: 'Últimos 12 meses' }, { value: '24', label: 'Últimos 24 meses' }], npsSaved.months, { allowEmpty: false })}</select></label>
        <label>Situação<select name="status">${selectOptions([{ value: 'pendente', label: 'Aguardando resposta' }, { value: 'respondida', label: 'Respondida' }, { value: 'expirada', label: 'Expirada' }, { value: 'cancelada', label: 'Cancelada' }], npsSaved.status, { placeholder: 'Todas' })}</select></label>
        <label>Classificação<select name="category">${selectOptions([{ value: 'promotor', label: 'Promotores (9-10)' }, { value: 'neutro', label: 'Neutros (7-8)' }, { value: 'detrator', label: 'Detratores (0-6)' }], npsSaved.category, { placeholder: 'Todas' })}</select></label>
        <label class="check"><input type="checkbox" name="treated" value="0" ${npsSaved.treated === '0' ? 'checked' : ''}> Só detratores sem tratativa</label>
      </form>
      <section class="card"><h3>Histórico das pesquisas</h3>${table(
        [
          { label: 'Pesquisa', render: (n) => html`<strong>${n.code}</strong><br><small>${fmtDate(n.created_at)} · ${n.created_by_name || '—'}</small>` },
          { label: 'Cliente', render: (n) => html`<a href="#/clientes/${n.contact_id}" data-drawer="${n.contact_id}">${n.contact_name}</a><br><small>${n.contact_code}${n.contract_code ? ` · ${n.contract_code}` : ''}</small>` },
          { label: 'Situação', render: (n) => html`${badge({ pendente: 'Aguardando', respondida: 'Respondida', expirada: 'Expirada', cancelada: 'Cancelada' }[n.status], { pendente: 'warn', respondida: 'ok', expirada: 'muted', cancelada: 'muted' }[n.status])}${n.first_access_at && n.status === 'pendente' ? html`<br><small>aberta ${relTime(n.first_access_at)}</small>` : ''}` },
          { label: 'Nota', render: (n) => (n.score != null ? html`${badge(`${n.score} · ${npsCategory(n.score)[0]}`, npsCategory(n.score)[1])}<br><small>${fmtDateTime(n.answered_at)}</small>` : '—') },
          { label: 'Motivo e comentário', render: (n) => html`${n.dissatisfaction_reason ? html`<strong>${optLabel('motivo_insatisfacao', n.dissatisfaction_reason)}</strong><br>` : ''}${n.comment ? html`<em class="small">"${n.comment}"</em>` : ''}${n.answers ? html`<br><small class="muted">${Object.entries(n.answers).map(([k, v]) => `${NPS_ANSWER_LABELS[k] || k}: ${v}/5`).join(' · ')}</small>` : ''}${!n.comment && !n.dissatisfaction_reason && !n.answers ? '—' : ''}` },
          {
            label: 'Tratativa',
            render: (n) => (n.treated_at
              ? html`<small>${n.treatment_notes}<br><span class="muted">${fmtDateTime(n.treated_at)} · ${n.treated_by_name || '—'}</span></small>`
              : n.category && n.category !== 'promotor' && w ? html`<button class="btn small ${n.category === 'detrator' ? 'primary' : ''}" data-treat="${n.id}">Registrar tratativa</button>` : '—'),
          },
        ],
        d.rows,
        { emptyMsg: 'Nenhuma pesquisa no período. Gere a pesquisa na ficha do cliente (aba Pós-venda) ou pelos alertas acima.' },
      )}</section>`);
    const f = $('[data-f]', box);
    f.addEventListener('change', () => ((npsSaved = Object.fromEntries(new FormData(f).entries())), load()));
  };
  on(box, 'click', '[data-treat]', async (e, b) => {
    const n = d.rows.find((r) => r.id === Number(b.dataset.treat)) || {};
    const ok = await modal({
      title: `Tratativa da pesquisa ${n.code || ''}`,
      body: html`${n.score != null ? html`<p>${n.contact_name}: nota <strong>${n.score}</strong>${n.comment ? html` — <em>"${n.comment}"</em>` : ''}</p>` : ''}
        ${field({ name: 'reason', label: 'Motivo da insatisfação', type: 'select', options: opts('motivo_insatisfacao'), value: n.dissatisfaction_reason, full: true })}
        ${field({ name: 'notes', label: 'O que foi conversado e combinado com o cliente', type: 'textarea', rows: 4, required: true, full: true })}`,
      submitLabel: 'Registrar tratativa',
      onSubmit: (data) => post(`/api/pos-venda/nps/${b.dataset.treat}/tratativa`, data),
    });
    if (ok) {
      toast('Tratativa registrada.');
      load();
    }
  });
  on(box, 'click', '[data-send]', async (e, b) => {
    try {
      const r = await post(`/api/cadastros/${b.dataset.send}/nps`, {});
      await modal({ title: `Pesquisa ${r.code} gerada`, body: html`<p>Envie este link ao cliente:</p>${copyBox(pageUrl(`nps/${r.token}`))}`, onMount: (form) => bindCopy(form) });
      load();
    } catch (ex) {
      toastError(ex);
    }
  });
  await load();
}

/* ------------------------- Estratégias de lance ------------------------- */

let bidSaved = {};
async function bidsTab(box) {
  const w = can.write();
  let d;
  const asStrategy = (r) => (r.will_bid == null ? {} : { ...r, id: r.id });
  const load = async () => {
    try {
      d = await get('/api/pos-venda/lances', bidSaved);
    } catch (e) {
      return toastError(e);
    }
    const s = d.summary;
    render(box, html`
      <div class="kpis small">
        <div class="kpi"><div class="kpi-label">Cartas ativas</div><div class="kpi-value">${s.cartas}</div></div>
        <div class="kpi ${s.sem_estrategia ? 'alert-kpi' : ''}"><div class="kpi-label">Sem estratégia definida</div><div class="kpi-value">${s.sem_estrategia}</div></div>
        ${s.por_tipo.map((t) => html`<div class="kpi"><div class="kpi-label">Lance ${t.label.toLowerCase()}</div><div class="kpi-value">${t.n}</div></div>`)}
        <div class="kpi"><div class="kpi-label">Aguardar sorteio</div><div class="kpi-value">${s.sem_lance}</div></div>
      </div>
      <form class="filters" data-f>
        <label class="grow">Buscar<input type="search" name="q" value="${bidSaved.q || ''}" placeholder="Cliente, código do cliente ou da carta (CT-…)"></label>
        <label>Situação<select name="situacao">${selectOptions([{ value: 'sem', label: 'Sem estratégia' }, { value: 'com', label: 'Com estratégia' }], bidSaved.situacao, { placeholder: 'Todas' })}</select></label>
        <label>Tipo de lance<select name="bid_type">${selectOptions([{ value: 'embutido', label: 'Embutido' }, { value: 'fixo', label: 'Fixo' }, { value: 'livre', label: 'Livre' }], bidSaved.bid_type, { placeholder: 'Todos' })}</select></label>
      </form>
      <section class="card">${table(
        [
          { label: 'Carta', render: (r) => html`<strong>${r.code}</strong><br><small>grupo ${r.group_code || '—'} · cota ${r.quota_code || '—'}</small>` },
          { label: 'Cliente', render: (r) => html`<a href="#/clientes/${r.contact_id}" data-drawer="${r.contact_id}">${r.contact_name}</a><br><small>${r.contact_code}</small>` },
          { label: 'Categoria', render: (r) => html`${optLabel('categoria_credito', r.category) || '—'}<br><small>${r.administrator || ''}</small>` },
          { label: 'Crédito', render: (r) => fmtMoney(r.credit_value), cls: 'num' },
          { label: 'Estratégia atual', render: (r) => html`${bidSummary(r.will_bid == null ? null : r)}${r.notes ? html`<br><small class="muted">${r.notes}</small>` : ''}` },
          { label: 'Cadastrada por', render: (r) => (r.updated_at ? html`${r.updated_by_name || '—'}<br><small>${fmtDateTime(r.updated_at)}</small>` : '—') },
          { label: 'Histórico', render: (r) => (r.changes ? html`<button class="btn small ghost" data-hist="${r.id}">${r.changes} registro(s)</button>` : '—') },
          { label: '', render: (r) => (w ? html`<button class="btn small ${r.will_bid == null ? 'primary' : ''}" data-bid="${r.id}">${r.will_bid == null ? 'Cadastrar' : 'Alterar'}</button>` : '') },
        ],
        d.rows,
        { emptyMsg: 'Nenhuma carta com esses filtros.' },
      )}</section>
      <p class="hint">Recomendação: defina a estratégia no onboarding e revise a cada assembleia (lance livre médio dos últimos meses, saldo de FGTS e capacidade de lance do cliente). Cada alteração fica no histórico com quem cadastrou, data e hora.</p>`);
    const f = $('[data-f]', box);
    let t;
    f.addEventListener('input', (e) => {
      if (e.target.name !== 'q') return;
      clearTimeout(t);
      t = setTimeout(() => ((bidSaved = Object.fromEntries(new FormData(f).entries())), load()), 300);
    });
    f.addEventListener('change', (e) => e.target.name !== 'q' && ((bidSaved = Object.fromEntries(new FormData(f).entries())), load()));
    f.addEventListener('submit', (e) => e.preventDefault());
  };
  on(box, 'click', '[data-bid]', async (e, b) => {
    const r = d.rows.find((x) => x.id === Number(b.dataset.bid));
    if (await bidForm(r, asStrategy(r))) load();
  });
  on(box, 'click', '[data-hist]', async (e, b) => {
    try {
      const h = await get(`/api/pos-venda/lances/${b.dataset.hist}/historico`);
      await modal({ title: `Histórico de estratégias — ${h.contract.code}`, body: h.history.length ? bidHistoryList(h.history) : empty('Sem registros.'), onMount: (form) => form.querySelector('details')?.setAttribute('open', '') });
    } catch (ex) {
      toastError(ex);
    }
  });
  await load();
}
