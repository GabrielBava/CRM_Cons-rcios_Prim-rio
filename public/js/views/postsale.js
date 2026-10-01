// 11. Pós-venda: depois do pagamento confirmado, o acompanhamento do cliente (sempre ligado ao cadastro):
// checklist, satisfação (NPS) com alertas e motivos, e estratégias de lance com histórico.
import { get, post } from '../api.js';
import { html, render, raw, $, $$, on, fresh, state, selectOptions, opts, userItems, table, badge, fmtMoney, fmtNum, fmtDate, fmtDateTime, relTime, optLabel, can, modal, field, toast, toastError, empty, subnav } from '../ui.js';
import { bindDrawerLinks } from '../drawer.js';
import { npsCategory, NPS_ANSWER_LABELS, bidSummary, bidForm, bidHistoryList, copyBox, pageUrl, bindCopy } from './record-tabs.js';

const PREF = { whatsapp: 'WhatsApp', ligacao: 'Ligação', email: 'E-mail', sms: 'SMS', presencial: 'Presencial' };

export async function show(view, { params = {} } = {}) {
  const tab = ['nps', 'lances'].includes(params.aba) ? params.aba : 'checklist';
  render(view, html`<div class="page wide">
    <div class="page-head"><div><h1>Pós-venda</h1><p class="muted">Começa na confirmação do pagamento. Tudo fica registrado no cadastro do cliente.</p></div></div>
    ${subnav([['#/posvenda', 'Checklist dos clientes', 'checklist'], ['#/posvenda?aba=nps', 'Satisfação (NPS)', 'nps'], ['#/posvenda?aba=lances', 'Estratégias de lance', 'lances']], tab)}
    <div id="tab"></div></div>`);
  const box = fresh($('#tab', view));
  bindDrawerLinks(box);
  if (tab === 'nps') return npsTab(box);
  if (tab === 'lances') return bidsTab(box);
  return checklistTab(box);
}

/* ------------------------- Checklist ------------------------- */

let ckSaved = { status: 'incompleto' };
async function checklistTab(box) {
  const manager = can.manage();
  const w = can.write();
  let data;
  const load = async () => {
    try {
      data = await get('/api/pos-venda', ckSaved);
    } catch (e) {
      return toastError(e);
    }
    const s = data.summary;
    render(box, html`
      <div class="kpis small">
        <div class="kpi"><div class="kpi-label">Clientes em acompanhamento</div><div class="kpi-value">${s.clientes}</div></div>
        <div class="kpi ${s.incompletos ? 'alert-kpi' : ''}"><div class="kpi-label">Checklist incompleto</div><div class="kpi-value">${s.incompletos}</div></div>
        <div class="kpi ${s.sem_estrategia ? 'alert-kpi' : ''}"><div class="kpi-label">Cartas sem estratégia de lance</div><div class="kpi-value">${s.sem_estrategia}</div><div class="kpi-sub"><a href="#/posvenda?aba=lances">ver estratégias</a></div></div>
      </div>
      <div class="chips">${s.por_item.map((i) => html`<button type="button" class="chip ${ckSaved.item === i.item ? 'active' : ''}" data-item="${i.item}">${i.label} <strong>${i.pendentes}</strong></button>`)}</div>
      <form class="filters" data-f>
        <label class="grow">Buscar<input type="search" name="q" value="${ckSaved.q || ''}" placeholder="Nome ou código do cliente"></label>
        <label>Checklist<select name="status">${selectOptions([{ value: 'incompleto', label: 'Incompleto' }, { value: 'completo', label: 'Completo' }], ckSaved.status, { placeholder: 'Todos' })}</select></label>
        <label>Item pendente<select name="item">${selectOptions(data.items.map((i) => ({ value: i.value, label: i.label })), ckSaved.item, { placeholder: 'Qualquer' })}</select></label>
        ${manager ? html`<label>Responsável pós-venda<select name="postsale_owner_id">${selectOptions(userItems(), ckSaved.postsale_owner_id, { placeholder: 'Todos' })}</select></label>` : ''}
      </form>
      <section class="card">${table(
        [
          { label: 'Cliente', render: (c) => html`<a href="#/clientes/${c.id}" data-drawer="${c.id}"><strong>${c.name}</strong></a><br><small>${c.code} · cliente há ${c.days_since_sale ?? '—'} dia(s)</small>` },
          {
            label: 'Responsável pós-venda',
            render: (c) => (manager ? html`<select data-owner="${c.id}" aria-label="Responsável pós-venda de ${c.name}">${selectOptions(userItems(), c.postsale_id, { placeholder: 'Especialista do cliente' })}</select>` : c.postsale_name || '—'),
          },
          {
            label: 'Checklist',
            render: (c) => html`<div class="ck-dots" title="${c.checklist.map((i) => `${i.done_at ? '✓' : '○'} ${i.label}`).join('\n')}">${c.checklist.map((i) => html`<span class="dot ${i.done_at ? 'ok' : 'muted'}"></span>`)} <strong>${c.done}/${c.total}</strong></div>
              ${c.next_item ? html`<small>Próximo: ${c.next_item.label}</small>` : html`<small class="ok-text">Completo</small>`}`,
          },
          { label: 'Preferências', render: (c) => (c.pref_channel ? html`${PREF[c.pref_channel] || c.pref_channel}${c.pref_time ? html`<br><small>${c.pref_time}</small>` : ''}` : html`<span class="warn-text small">não informadas</span>`) },
          { label: 'NPS', render: (c) => (c.nps_score != null ? html`${badge(`Nota ${c.nps_score}`, npsCategory(c.nps_score)[1])}<br><small>${fmtDate(c.nps_at)}</small>` : c.nps_pending ? badge('Aguardando resposta', 'warn') : html`<span class="muted small">sem pesquisa</span>`) },
          { label: 'Cartas', render: (c) => html`${c.cartas} · ${fmtMoney(c.credit_total)}${c.without_strategy ? html`<br><small class="warn-text">${c.without_strategy} sem estratégia de lance</small>` : ''}` },
          { label: '', render: (c) => html`${w ? html`<button class="btn small primary" data-ck="${c.id}">Checklist</button> ` : ''}<a class="btn small ghost" href="#/clientes/${c.id}/posvenda">Ficha</a>` },
        ],
        data.rows,
        { emptyMsg: 'Nenhum cliente com esses filtros. O pós-venda começa quando o pagamento da venda é confirmado.' },
      )}</section>
      <p class="hint">"1ª parcela" é marcada quando o pagamento da 1ª parcela é baixado no financeiro; "Estratégia de lance" ao salvar a estratégia; "Preferências de contato" quando o canal e o horário são informados na confirmação da venda. Os itens são configuráveis em Configurações › Listas.</p>`);
    const f = $('[data-f]', box);
    let t;
    f.addEventListener('input', (e) => {
      if (e.target.name !== 'q') return;
      clearTimeout(t);
      t = setTimeout(() => ((ckSaved = Object.fromEntries(new FormData(f).entries())), load()), 300);
    });
    f.addEventListener('change', (e) => e.target.name !== 'q' && ((ckSaved = Object.fromEntries(new FormData(f).entries())), load()));
    f.addEventListener('submit', (e) => e.preventDefault());
  };
  on(box, 'click', '[data-item]', (e, b) => {
    ckSaved = { ...ckSaved, item: ckSaved.item === b.dataset.item ? '' : b.dataset.item, status: '' };
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
    const c = data.rows.find((r) => r.id === Number(b.dataset.ck));
    const ok = await modal({
      title: `Checklist de pós-venda — ${c.name}`,
      body: html`<ul class="checklist">${c.checklist.map((i) => html`<li class="${i.done_at ? 'ok' : ''}"><label class="check"><input type="checkbox" data-item-ck="${i.item}" ${i.done_at ? raw('checked') : ''}> ${i.label}</label>${i.done_at ? html` <small class="muted">${fmtDateTime(i.done_at)}</small>` : ''}</li>`)}</ul>
        ${field({ name: 'notes', label: 'Observação (vai para o histórico do cliente)', type: 'textarea', rows: 2, full: true })}`,
      submitLabel: 'Salvar checklist',
      async onSubmit(d, form) {
        for (const cb of $$('[data-item-ck]', form)) {
          const was = !!c.checklist.find((i) => i.item === cb.dataset.itemCk).done_at;
          if (cb.checked !== was) await post(`/api/cadastros/${c.id}/pos-venda`, { item: cb.dataset.itemCk, done: cb.checked, notes: d.notes });
        }
        toast('Checklist atualizado.');
        return true;
      },
    });
    if (ok) load();
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
