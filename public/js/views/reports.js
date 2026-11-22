// Relatórios por perfil: o especialista vê só o próprio desempenho (sem exportar); RH, financeiro e vendas gerais
// aparecem conforme a permissão. Exportação em Excel (.xlsx) ou CSV e, para o administrador, o pacote completo.
import { get, download } from '../api.js';
import { html, render, $, on, filterBar, readFilters, table, fmtMoney, fmtPct, fmtNum, fmtDate, fmtDateTime, fmtDuration, toastError, state } from '../ui.js';

let saved = { period: '30d' };

const fmt = (type, v) => {
  if (v == null || v === '') return '—';
  switch (type) {
    case 'money': return fmtMoney(v);
    case 'pct': return fmtPct(v);
    case 'int':
    case 'num': return fmtNum(v);
    case 'date': return fmtDate(v);
    case 'datetime': return fmtDateTime(v);
    case 'duration': return fmtDuration(v);
    default: return String(v);
  }
};

function reportTable(columns, rows, totals) {
  const cols = columns.map((c) => ({ label: c.label, cls: ['int', 'num', 'money', 'pct', 'duration'].includes(c.type) ? 'num' : '', render: (r) => fmt(c.type, r[c.key]) }));
  return html`${table(cols, rows, { emptyMsg: 'Sem dados para os filtros selecionados.' })}${totals ? html`<div class="totals">${columns.filter((c) => totals[c.key] != null).map((c) => html`<span><strong>${c.label}:</strong> ${fmt(c.type, totals[c.key])}</span>`)}</div>` : ''}`;
}

// Filtros que fazem sentido em cada grupo (os comerciais usam todos; os demais só o período)
const FILTERS = { Comercial: ['period', 'owner', 'origin', 'stage', 'product', 'status'] };

export async function show(view, { id }) {
  const cat = await get('/api/relatorios');
  const byKey = Object.fromEntries(cat.reports.map((r) => [r.key, r]));
  let key = id && byKey[id] ? id : cat.reports[0]?.key;
  if (!key) {
    render(view, html`<div class="page"><h1>Relatórios</h1><p class="muted">Nenhum relatório disponível para o seu perfil.</p></div>`);
    return;
  }
  const groups = [...new Set(cat.reports.map((r) => r.group))];
  const shell = () => render(view, html`<div class="page">
    <div class="page-head"><div><h1>Relatórios</h1><p class="muted">${state.user.role === 'consultor'
      ? 'Seus números de vendas e comissões. Os relatórios respeitam o seu nível de acesso: dados de leads e clientes não aparecem aqui.'
      : 'Relatórios da operação conforme o seu acesso. Exporte em Excel para analisar ou conectar ao BI.'}</p></div>
      ${cat.package ? html`<div class="actions"><button class="btn" data-act="package">Exportar pacote completo (Excel)</button></div>` : ''}</div>
    <div class="report-layout">
      <nav class="report-nav">${groups.map((g) => html`<div class="report-group">${g}</div>${cat.reports.filter((r) => r.group === g).map((r) => html`<a href="#/relatorios/${r.key}" data-rep="${r.key}" class="${r.key === key ? 'active' : ''}">${r.title}</a>`)}`)}</nav>
      <div>
        <div data-filterbox>${filterBar(saved, { show: FILTERS[byKey[key].group] || ['period'] })}</div>
        <div id="rep"></div>
      </div>
    </div></div>`);
  shell();
  let form = $('[data-filters]', view);
  const load = async () => {
    const { values, query } = readFilters(form);
    saved = { ...saved, ...values };
    const box = $('#rep', view);
    box.classList.add('loading');
    try {
      const r = await get(`/api/relatorios/${key}`, query);
      render(box, html`<section class="card">
        <div class="section-head"><h2>${r.title}</h2>${r.exportable ? html`<div class="inline-actions"><button class="btn primary" data-act="xlsx">Exportar Excel</button><button class="btn ghost" data-act="csv">CSV</button></div>` : html`<small class="muted">Exportação não disponível para o seu perfil.</small>`}</div>
        <div class="definition"><strong>Como é calculado</strong><ul>${r.definition.map((d) => html`<li>${d}</li>`)}</ul>
          <small class="muted">Período: ${fmtDateTime(r.period.from)} a ${fmtDateTime(r.period.to)}. Os dados respeitam o seu nível de acesso.</small></div>
        ${reportTable(r.columns, r.rows, r.totals)}
      </section>
      ${r.extra ? html`<section class="card"><h3>${r.extra.title}</h3>${reportTable(r.extra.columns, r.extra.rows)}</section>` : ''}`);
    } catch (e) {
      toastError(e);
    } finally {
      box.classList.remove('loading');
    }
  };
  const bindForm = () => {
    form = $('[data-filters]', view);
    form.addEventListener('change', load);
  };
  bindForm();
  on(view, 'click', '[data-rep]', (e, a) => {
    e.preventDefault();
    const prevGroup = byKey[key].group;
    key = a.dataset.rep;
    history.replaceState(null, '', `#/relatorios/${key}`);
    view.querySelectorAll('[data-rep]').forEach((x) => x.classList.toggle('active', x === a));
    if (byKey[key].group !== prevGroup) {
      render($('[data-filterbox]', view), filterBar(saved, { show: FILTERS[byKey[key].group] || ['period'] }));
      bindForm();
    }
    load();
  });
  on(view, 'click', '[data-act=csv]', () => download(`/api/relatorios/${key}/csv`, readFilters(form).query).catch(toastError));
  on(view, 'click', '[data-act=xlsx]', () => download(`/api/relatorios/${key}/xlsx`, readFilters(form).query).catch(toastError));
  on(view, 'click', '[data-act=package]', () => download('/api/relatorios-pacote.xlsx', readFilters(form).query).catch(toastError));
  await load();
}
