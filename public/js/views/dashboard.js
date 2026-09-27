import { get } from '../api.js';
import { html, render, $, on, filterBar, readFilters, fmtDateTime, fmtPct, relTime, table, empty, K, badge } from '../ui.js';

let saved = { period: '30d' };

export async function show(view) {
  render(view, html`<div class="page">
    <div class="page-head"><h1>Painel inicial</h1></div>
    ${filterBar(saved)}
    <div id="dash"></div>
  </div>`);
  const form = $('[data-filters]', view);
  const load = async () => {
    const { values, query } = readFilters(form);
    saved = values;
    const box = $('#dash', view);
    box.classList.add('loading');
    try {
      const d = await get('/api/dashboard', query);
      render(box, content(d));
    } finally {
      box.classList.remove('loading');
    }
  };
  form.addEventListener('change', load);
  await load();
}

function convTable(title, rows) {
  return html`<section class="card"><h3>${title}</h3>${table(
    [
      { label: 'Grupo', render: (r) => r.rotulo || 'Não informado' },
      { label: 'Oportunidades', key: 'oportunidades', cls: 'num' },
      { label: 'Ganhas', key: 'ganhas', cls: 'num' },
      { label: 'Perdidas', key: 'perdidas', cls: 'num' },
      { label: 'Conversão', render: (r) => fmtPct(r.taxa), cls: 'num' },
    ],
    rows,
    { emptyMsg: 'Sem oportunidades criadas no período.' },
  )}</section>`;
}

function content(d) {
  const maxStalled = Math.max(1, ...d.stalled_by_stage.map((s) => s.total));
  return html`
    <p class="muted small">Período: ${fmtDateTime(d.period.from)} a ${fmtDateTime(d.period.to)}. Passe o mouse (ou toque) no ícone ⓘ para ver como cada indicador é calculado.</p>
    <div class="kpis">${d.kpis.map(
      (k) => html`<div class="kpi">
        <div class="kpi-label">${k.label} <span class="info" tabindex="0" title="${k.def}">ⓘ</span></div>
        <div class="kpi-value">${k.link ? html`<a href="${k.link}">${k.value}</a>` : k.value}</div>
        ${k.sub ? html`<div class="kpi-sub">${k.sub}</div>` : ''}
      </div>`,
    )}</div>
    <div class="cols">
      <section class="card">
        <h3>Leads parados por etapa <span class="info" tabindex="0" title="${d.stalled_def}">ⓘ</span></h3>
        ${d.stalled_by_stage.every((s) => !s.total)
          ? empty('Nenhuma oportunidade aberta.')
          : html`<div class="bars">${d.stalled_by_stage.map(
              (s) => html`<a class="bar-row" href="#/funil?stage_id=${s.id}">
                <span class="bar-label">${s.name}</span>
                <span class="bar"><span class="bar-fill" style="width:${(s.total / maxStalled) * 100}%"></span><span class="bar-fill stalled" style="width:${((s.parados || 0) / maxStalled) * 100}%"></span></span>
                <span class="bar-val">${s.parados || 0} / ${s.total}</span></a>`,
            )}</div><p class="legend"><span class="sw"></span> abertas <span class="sw stalled"></span> paradas há ${d.stalled_days}+ dias</p>`}
      </section>
      <section class="card">
        <h3>Próximas tarefas e retornos ${d.overdue_tasks ? badge(`${d.overdue_tasks} atrasada(s)`, 'danger') : ''}</h3>
        ${d.upcoming_tasks.length
          ? html`<ul class="task-list">${d.upcoming_tasks.map(
              (t) => html`<li class="${new Date(t.due_at) < new Date() ? 'overdue' : ''}">
                <div><strong>${t.title}</strong> <small>${K('task_types', t.type)}</small></div>
                <div class="muted small">${t.contact_id ? html`<a href="#/leads/${t.contact_id}">${t.contact_name}</a> · ` : ''}${fmtDateTime(t.due_at)} (${relTime(t.due_at)}) · ${t.assigned_name || '—'}</div>
              </li>`,
            )}</ul><p><a href="#/agenda">Ver agenda completa →</a></p>`
          : empty('Nenhuma tarefa pendente.')}
      </section>
    </div>
    <p class="muted small">${d.conversion.def}</p>
    <div class="cols three">
      ${convTable('Conversão por origem', d.conversion.by_origin)}
      ${convTable('Conversão por usuário', d.conversion.by_user)}
      ${convTable('Conversão por produto', d.conversion.by_product)}
    </div>`;
}
