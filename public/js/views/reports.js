import { get, download } from '../api.js';
import { html, render, $, on, filterBar, readFilters, table, fmtMoney, fmtPct, fmtNum, fmtDate, fmtDateTime, fmtDuration, toastError } from '../ui.js';

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

export async function show(view, { id }) {
  const list = await get('/api/relatorios');
  let key = id && list[id] ? id : 'leads_por_origem';
  render(view, html`<div class="page">
    <div class="page-head"><h1>Relatórios</h1></div>
    <div class="report-layout">
      <nav class="report-nav">${Object.entries(list).map(([k, l]) => html`<a href="#/relatorios/${k}" data-rep="${k}" class="${k === key ? 'active' : ''}">${l}</a>`)}</nav>
      <div>
        ${filterBar(saved)}
        <div id="rep"></div>
      </div>
    </div></div>`);
  const form = $('[data-filters]', view);
  const load = async () => {
    const { values, query } = readFilters(form);
    saved = values;
    const box = $('#rep', view);
    box.classList.add('loading');
    try {
      const r = await get(`/api/relatorios/${key}`, query);
      render(box, html`<section class="card">
        <div class="section-head"><h2>${r.title}</h2><button class="btn" data-act="csv">Exportar CSV</button></div>
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
  form.addEventListener('change', load);
  on(view, 'click', '[data-rep]', (e, a) => {
    e.preventDefault();
    key = a.dataset.rep;
    history.replaceState(null, '', `#/relatorios/${key}`);
    view.querySelectorAll('[data-rep]').forEach((x) => x.classList.toggle('active', x === a));
    load();
  });
  on(view, 'click', '[data-act=csv]', () => download(`/api/relatorios/${key}/csv`, readFilters(form).query).catch(toastError));
  await load();
}
