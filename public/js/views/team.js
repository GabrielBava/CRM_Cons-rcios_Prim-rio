// Gestão do time (líder de equipe e administrador): organograma e dashboard da squad.
import { get, post } from '../api.js';
import { html, render, $, on, avatar, fmtMoney, fmtNum, fmtPct, toast, toastError, subnav, selectOptions, empty, table, modal, field, fmtDateTime, badge, state } from '../ui.js';

/** Abas da Gestão do time (as mesmas do menu): Organograma, Dashboard, BI e Distribuição de leads. */
export const teamTabs = (active) => subnav([['#/time/organograma', 'Organograma', 'organograma'], ['#/time/squad', 'Dashboard', 'squad'], ['#/time/bi', 'BI', 'bi'],
  ...((state.user?.modules || []).includes('distribuicao') ? [['#/entrada', 'Distribuição de leads', 'distribuicao']] : [])], active);
const tabs = teamTabs;

export async function show(view, { id }) {
  if (id === 'one-on-ones') return oneOnOnes(view);
  if (id === 'bi') return import('./team-bi.js').then((m) => m.show(view, tabs));
  return id === 'squad' ? squad(view) : orgChart(view);
}

/* ------------------------- One-on-ones ------------------------- */

const pad = (n) => String(n).padStart(2, '0');
/** O líder marca o one-on-one com alguém da equipe: aparece no calendário dos dois (Operacional › Calendário). */
async function oneOnOnes(view) {
  render(view, html`<div class="page">${tabs('organograma')}
    <div class="page-head"><div><h1>One-on-ones</h1><p class="muted">Conversas individuais do líder com cada pessoa do time. O one-on-one marcado aqui aparece no calendário do líder e do liderado.</p></div>
      <div class="actions"><a class="btn ghost" href="#/time/organograma">← Organograma</a><button class="btn primary" data-act="new">+ Marcar one-on-one</button></div></div>
    <div id="oo"></div></div>`);
  let org = null;
  const load = async () => {
    const box = $('#oo', view);
    let rows;
    try {
      [rows, org] = await Promise.all([get('/api/time/one-on-ones'), org ? Promise.resolve(org) : get('/api/time/organograma')]);
    } catch (e) {
      return render(box, html`<div class="alert danger">${e.message}</div>`);
    }
    const st = (t) => (t.status === 'pendente' ? (new Date(t.due_at) < new Date() ? badge('Aguardando registro', 'warn') : badge('Agendado', 'info')) : badge('Realizado', 'ok'));
    render(box, rows.length ? html`<section class="card">${table([
      { label: 'Quando', render: (t) => html`<strong>${fmtDateTime(t.due_at)}</strong>${t.ends_at ? html`<br><small>até ${new Date(t.ends_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small>` : ''}` },
      { label: 'Pessoa', render: (t) => html`<span class="sq-person">${avatar({ name: t.member_name, photo: t.member_photo }, 28)} ${t.member_name}</span>` },
      { label: 'Marcado por', render: (t) => t.leader_name || '—' },
      { label: 'Pauta', render: (t) => (t.notes ? html`<small>${t.notes}</small>` : html`<span class="muted">—</span>`) },
      { label: 'Situação', render: (t) => html`${st(t)}${t.meeting_url ? html` <a class="small" href="${t.meeting_url}" target="_blank" rel="noopener">link</a>` : ''}` },
    ], rows)}</section>` : empty('Nenhum one-on-one marcado. Use "Marcar one-on-one".'));
  };
  on(view, 'click', '[data-act=new]', async () => {
    if (!org) org = await get('/api/time/organograma').catch(() => null);
    const people = org ? [...org.teams.flatMap((t) => [t.leader, ...t.members]), ...org.no_team].filter((u) => u && u.id !== undefined && u.id !== state.user.id) : [];
    const seen = new Set();
    const opts = people.filter((u) => !seen.has(u.id) && seen.add(u.id)).map((u) => ({ value: u.id, label: u.name }));
    const d = new Date(Date.now() + 86400000);
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const r = await modal({
      title: 'Marcar one-on-one',
      body: html`<div class="grid">
        ${field({ name: 'user_id', label: 'Com quem', type: 'select', options: opts, required: true, full: true })}
        ${field({ name: 'date', label: 'Data', type: 'date', value: day, required: true })}
        ${field({ name: 'start', label: 'Início', type: 'time', value: '09:00', required: true })}
        ${field({ name: 'end', label: 'Término', type: 'time', value: '09:30', required: true })}
        ${field({ name: 'meeting_url', label: 'Link da videochamada (opcional)', type: 'url', placeholder: 'https://meet.google.com/…', full: true })}
        ${field({ name: 'agenda', label: 'Pauta', type: 'textarea', rows: 3, full: true, placeholder: 'Ex.: metas do mês, pipeline, desenvolvimento, feedback' })}</div>`,
      submitLabel: 'Marcar',
      onSubmit: (v) => post('/api/time/one-on-ones', { user_id: v.user_id, start_at: new Date(`${v.date}T${v.start}:00`).toISOString(), end_at: new Date(`${v.date}T${v.end}:00`).toISOString(), meeting_url: v.meeting_url, agenda: v.agenda }),
    });
    if (r) {
      toast('One-on-one marcado: já aparece no calendário de vocês dois.');
      load();
    }
  });
  await load();
}

/* ------------------------- Organograma ------------------------- */

const ROLE = { admin: 'Diretoria', gestor: 'Líder de equipe', consultor: 'Especialista', leitura: 'Consulta' };
const person = (u, cls = '') => html`<div class="org-person ${cls}">
  ${avatar(u, 44)}
  <div class="org-info"><strong>${u.name}</strong><small>${u.job_title || ROLE[u.role] || ''}</small>
    ${u.metrics ? html`<div class="org-metrics"><span title="Negócios em andamento">${fmtNum(u.metrics.abertos)} abertos</span><span title="R1 agendadas no mês">${fmtNum(u.metrics.r1_mes)} R1</span><span title="Vendas no mês">${fmtNum(u.metrics.vendas_mes)} vendas</span></div>` : ''}
  </div></div>`;

async function orgChart(view) {
  let d;
  try {
    d = await get('/api/time/organograma');
  } catch (e) {
    return render(view, html`<div class="page">${tabs('organograma')}<div class="alert danger">${e.message}</div></div>`);
  }
  render(view, html`<div class="page wide">
    ${tabs('organograma')}
    <div class="page-head"><div><h1>Organograma</h1><p class="muted">Quem lidera quem e os números do mês de cada pessoa (negócios em andamento, R1 agendadas e vendas).</p></div>
      <div class="actions"><a class="btn" href="#/time/one-on-ones">One-on-ones</a></div></div>
    <div class="org">
      ${d.directors.length ? html`<div class="org-level org-top">${d.directors.map((u) => person(u, 'director'))}</div><div class="org-line" aria-hidden="true"></div>` : ''}
      <div class="org-teams">${d.teams.length ? d.teams.map((t) => html`<section class="org-team card">
        <header><h3>${t.name}</h3><small class="muted">${t.totals.pessoas} pessoa(s) · ${fmtNum(t.totals.abertos)} abertos · ${fmtNum(t.totals.r1_mes)} R1 · ${fmtNum(t.totals.vendas_mes)} vendas (${fmtMoney(t.totals.credito_mes)})</small></header>
        ${t.leader ? person(t.leader, 'leader') : html`<p class="muted small">Time sem líder definido (Usuários › Equipes).</p>`}
        <div class="org-members">${t.members.length ? t.members.map((u) => person(u)) : html`<p class="muted small">Sem especialistas neste time.</p>`}</div>
      </section>`) : empty('Nenhum time cadastrado. Crie as equipes e defina os líderes em Usuários.')}</div>
      ${d.no_team.length ? html`<section class="card org-noteam"><h3>Sem time</h3><div class="org-members">${d.no_team.map((u) => person(u))}</div></section>` : ''}
    </div>
  </div>`);
}

/* ------------------------- Dashboard da squad ------------------------- */

let saved = { periodo: 'mes' };
const PERIODS = [['mes', 'Este mês'], ['30d', 'Últimos 30 dias'], ['90d', 'Últimos 90 dias'], ['ano', 'Este ano']];
function periodRange(p) {
  const now = new Date();
  if (p === '30d') return { from: new Date(now - 30 * 86400000).toISOString() };
  if (p === '90d') return { from: new Date(now - 90 * 86400000).toISOString() };
  if (p === 'ano') return { from: new Date(now.getFullYear(), 0, 1).toISOString() };
  return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString() };
}

async function squad(view) {
  render(view, html`<div class="page wide">${tabs('squad')}<div class="page-head"><div><h1>Dashboard</h1><p class="muted">Indicadores do time por especialista: da entrada do lead à venda, com R1, no-show, remarcações e SLA.</p></div></div>
    <form class="filters" data-f>
      <label>Período<select name="periodo">${selectOptions(PERIODS.map(([value, label]) => ({ value, label })), saved.periodo, { allowEmpty: false })}</select></label>
      <label data-team-box hidden>Time<select name="time"></select></label>
    </form><div id="sq"></div></div>`);
  const form = $('[data-f]', view);
  const load = async () => {
    saved = { periodo: form.periodo.value, time: form.time.value };
    const box = $('#sq', view);
    box.classList.add('loading');
    let d;
    try {
      d = await get('/api/time/squad', { ...periodRange(saved.periodo), time: saved.time || '' });
    } catch (e) {
      box.classList.remove('loading');
      return toastError(e);
    }
    box.classList.remove('loading');
    const tb = $('[data-team-box]', view);
    if (d.teams.length > 1 || (d.teams.length && !d.team_id)) {
      tb.hidden = false;
      form.time.innerHTML = String(selectOptions(d.teams.map((t) => ({ value: t.id, label: t.name })), d.team_id || '', { placeholder: 'Todos os times' }));
    }
    const t = d.totals || {};
    const kpi = (label, v, sub = '') => html`<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value">${v}</div>${sub ? html`<div class="kpi-sub">${sub}</div>` : ''}</div>`;
    const maxF = Math.max(1, ...d.funnel.map((f) => f.n));
    render(box, html`
      <div class="kpis small">
        ${kpi('Leads recebidos', fmtNum(t.leads))}
        ${kpi('Tentativas', fmtNum(t.tentativas))}
        ${kpi('R1 agendadas', fmtNum(t.r1_agendadas), t.tx_lead_r1 != null ? `${fmtPct(t.tx_lead_r1)} dos leads` : '')}
        ${kpi('R1 realizadas', fmtNum(t.r1_realizadas), t.tx_comparecimento != null ? `comparecimento ${fmtPct(t.tx_comparecimento)}` : '')}
        ${kpi('No-show R1', fmtNum(t.r1_no_show), `${t.tx_no_show_r1 != null ? `${fmtPct(t.tx_no_show_r1)} · ` : ''}${fmtNum(t.r1_remarcadas)} remarcada(s)`)}
        ${kpi('R2 realizadas', fmtNum(t.r2_realizadas), `${fmtNum(t.r2_agendadas)} agendada(s)`)}
        ${kpi('No-show R2', fmtNum(t.r2_no_show), t.tx_no_show_r2 != null ? fmtPct(t.tx_no_show_r2) : '')}
        ${kpi('Vendas', fmtNum(t.vendas), fmtMoney(t.credito))}
        ${kpi('SLA estourado', fmtNum(t.sla_estourado), `de ${fmtNum(t.abertos)} em andamento`)}
      </div>
      <section class="card"><h3>Por especialista</h3>${table([
        { label: 'Especialista', render: (r) => html`<span class="sq-person">${avatar({ name: r.nome, photo: r.foto }, 28)} <span><strong>${r.nome}</strong>${r.cargo ? html`<br><small class="muted">${r.cargo}</small>` : ''}</span></span>` },
        { label: 'Leads', cls: 'num', render: (r) => fmtNum(r.leads) },
        { label: 'Tentativas', cls: 'num', render: (r) => fmtNum(r.tentativas) },
        { label: 'Qualificados', cls: 'num', render: (r) => fmtNum(r.qualificados) },
        { label: 'R1 agend.', cls: 'num', render: (r) => fmtNum(r.r1_agendadas) },
        { label: 'R1 feitas', cls: 'num', render: (r) => fmtNum(r.r1_realizadas) },
        { label: 'NS R1', cls: 'num', render: (r) => html`<span class="${r.r1_no_show ? 'warn-text' : ''}">${fmtNum(r.r1_no_show)}</span>` },
        { label: 'Remarc.', cls: 'num', render: (r) => fmtNum(r.r1_remarcadas) },
        { label: 'R2 feitas', cls: 'num', render: (r) => fmtNum(r.r2_realizadas) },
        { label: 'NS R2', cls: 'num', render: (r) => html`<span class="${r.r2_no_show ? 'warn-text' : ''}">${fmtNum(r.r2_no_show)}</span>` },
        { label: 'Propostas', cls: 'num', render: (r) => fmtNum(r.propostas) },
        { label: 'Vendas', cls: 'num', render: (r) => html`${fmtNum(r.vendas)}${r.credito ? html`<br><small>${fmtMoney(r.credito)}</small>` : ''}` },
        { label: 'Perdidos', cls: 'num', render: (r) => fmtNum(r.perdidos) },
        { label: 'Lead → R1', cls: 'num', render: (r) => (r.tx_lead_r1 == null ? '—' : fmtPct(r.tx_lead_r1)) },
        { label: 'SLA', cls: 'num', render: (r) => html`<span class="${r.sla_estourado ? 'danger-text' : ''}">${fmtNum(r.sla_estourado)}/${fmtNum(r.abertos)}</span>` },
      ], d.rows, { emptyMsg: 'Nenhum especialista neste time.' })}</section>
      <div class="cols">
        <section class="card"><h3>Pipeline da squad agora</h3><div class="sq-funnel">${d.funnel.map((f) => html`<div class="bar-row"><span>${f.name}${f.ns ? html` <span class="badge ns">NS ${f.ns}</span>` : ''}</span><span class="bar"><span style="width:${Math.round((f.n / maxF) * 100)}%"></span></span><strong>${f.n}</strong></div>`)}</div></section>
        <section class="card"><h3>Motivos de perda (MP)</h3>${d.lost.length ? html`<div class="sq-funnel">${d.lost.map((l) => html`<div class="bar-row"><span>${l.label}</span><span class="bar"><span style="width:${Math.round((l.n / d.lost[0].n) * 100)}%"></span></span><strong>${l.n}</strong></div>`)}</div>` : empty('Nenhum lead perdido no período.')}</section>
      </div>`);
  };
  form.addEventListener('change', load);
  on(view, 'submit', '[data-f]', (e) => e.preventDefault());
  await load();
}
