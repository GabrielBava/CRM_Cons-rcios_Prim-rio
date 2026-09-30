import { get, post, download } from '../api.js';
import {
  html, render, $, $$, on, fresh, state, selectOptions, opts, userItems, table, pager, badge, fmtDateTime, fmtDuration, optLabel, K, can, modal, field,
  toast, toastError, empty, PERIODS, periodRange, crmTabs,
} from '../ui.js';

let saved = { period: '7d' };
const SOURCES = [
  { value: 'manual', label: 'Manual' },
  { value: 'discadora', label: 'Discadora' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'simulador', label: 'Simulador' },
  { value: 'api_leads', label: 'API de leads' },
  { value: 'importacao', label: 'Importação' },
  { value: 'sistema', label: 'Sistema' },
];

export async function show(view, { params }) {
  let tab = params.aba || 'atividades';
  const tabs = [['atividades', 'Atividades'], ...(can.manage() ? [['discadora', 'Eventos da discadora'], ['entradas', 'Entradas de leads e mensagens']] : [])];
  render(view, html`<div class="page">
    ${crmTabs('atividades')}
    <div class="page-head"><h1>Ligações e atividades</h1></div>
    <nav class="tabs">${tabs.map(([k, l]) => html`<a href="#" data-tab="${k}" class="${tab === k ? 'active' : ''}">${l}</a>`)}</nav>
    <div id="tab"></div></div>`);
  const draw = () => {
    const box = fresh($('#tab', view));
    ({ atividades, discadora, entradas })[tab](box);
  };
  on(view, 'click', '[data-tab]', (e, a) => {
    e.preventDefault();
    tab = a.dataset.tab;
    $$('[data-tab]', view).forEach((x) => x.classList.toggle('active', x === a));
    draw();
  });
  draw();
}

function atividades(box) {
  const types = Object.entries(state.meta.constants.activity_types).map(([value, v]) => ({ value, label: v.label }));
  render(box, html`
    <form class="filters" data-f>
      <label>Período<select name="period">${selectOptions(PERIODS, saved.period, { allowEmpty: false })}</select></label>
      <label class="custom-range" ${saved.period === 'custom' ? '' : 'hidden'}>De<input type="date" name="cfrom" value="${saved.cfrom || ''}"></label>
      <label class="custom-range" ${saved.period === 'custom' ? '' : 'hidden'}>Até<input type="date" name="cto" value="${saved.cto || ''}"></label>
      <label>Tipo<select name="type">${selectOptions([{ value: 'ligacao_realizada,tentativa_sem_atendimento,ligacao_recebida', label: 'Todas as ligações' }, ...types], saved.type, { placeholder: 'Todos' })}</select></label>
      <label>Resultado<select name="result">${selectOptions(opts('resultado_ligacao'), saved.result, { placeholder: 'Todos' })}</select></label>
      <label>Usuário<select name="user_id">${selectOptions(userItems(), saved.user_id, { placeholder: 'Todos' })}</select></label>
      <label>Registrado via<select name="source">${selectOptions(SOURCES, saved.source, { placeholder: 'Todos' })}</select></label>
      ${state.user.role !== 'leitura' ? html`<button type="button" class="btn" data-act="export">Exportar CSV</button>` : ''}
    </form>
    <p class="hint">Ligações podem ser registradas manualmente no cadastro do lead. Eventos da discadora com o mesmo ID de chamada são registrados uma única vez.</p>
    <div id="list"></div>`);
  const form = $('[data-f]', box);
  let page = 1;
  const query = () => {
    const d = Object.fromEntries(new FormData(form).entries());
    saved = d;
    $$('.custom-range', form).forEach((el) => (el.hidden = d.period !== 'custom'));
    return { ...periodRange(d.period, { from: d.cfrom, to: d.cto }), type: d.type, result: d.result, user_id: d.user_id, source: d.source };
  };
  const load = async () => {
    try {
      const r = await get('/api/atividades', { ...query(), page, limit: 50 });
      render($('#list', box), html`<section class="card">${table(
        [
          { label: 'Data', render: (a) => fmtDateTime(a.occurred_at) },
          { label: 'Tipo', render: (a) => html`<strong>${K('activity_types', a.type)}</strong>${a.result ? html`<br>${badge(optLabel('resultado_ligacao', a.result))}` : ''}` },
          { label: 'Cadastro', render: (a) => html`<a href="#/leads/${a.contact_id}">${a.contact_name}</a>${a.company_contact_name ? html`<br><small>${a.company_contact_name}</small>` : ''}` },
          { label: 'Duração', render: (a) => fmtDuration(a.duration_seconds) },
          { label: 'Usuário', render: (a) => a.user_name || '—' },
          { label: 'Via', render: (a) => html`${SOURCES.find((s) => s.value === a.source)?.label || a.source}${a.external_id ? html`<br><small class="muted">ID ${a.external_id}</small>` : ''}` },
          { label: 'Observação', render: (a) => html`<span class="clip">${a.notes || '—'}</span>` },
        ],
        r.rows,
        { emptyMsg: 'Nenhuma atividade no período.' },
      )}${pager(r.total, r.page, r.limit)}</section>`);
    } catch (e) {
      toastError(e);
    }
  };
  form.addEventListener('change', () => ((page = 1), load()));
  on(box, 'click', '[data-page]', (e, b) => ((page = Number(b.dataset.page)), load()));
  on(box, 'click', '[data-act=export]', () => download('/api/exportar/atividades', query()).catch(toastError));
  load();
}

function discadora(box) {
  let status = 'sem_vinculo';
  render(box, html`
    <div class="alert">Eventos recebidos pelo endpoint da discadora. Status da integração em <a href="#/configuracoes/integracoes">Configurações › Integrações</a>. Eventos sem vínculo precisam de conferência manual; eventos com erro podem ser reprocessados após ajustar o mapeamento.</div>
    <form class="filters" data-f>
      <label>Situação<select name="status">${selectOptions([
        { value: 'sem_vinculo', label: 'Sem vínculo (conferir)' },
        { value: 'erro', label: 'Com erro' },
        { value: 'vinculado', label: 'Vinculados' },
        { value: 'descartado', label: 'Descartados' },
      ], status, { placeholder: 'Todos' })}</select></label>
      <label class="grow">Buscar<input type="search" name="q" placeholder="ID da chamada, telefone ou ID do lead"></label>
    </form><div id="list"></div>`);
  const form = $('[data-f]', box);
  let rows = [];
  const load = async () => {
    const d = Object.fromEntries(new FormData(form).entries());
    try {
      const r = await get('/api/discadora/eventos', { ...d, limit: 100 });
      rows = r.rows;
      const c = r.counts;
      render($('#list', box), html`<p class="muted small">Totais: ${c.vinculado || 0} vinculados · ${c.sem_vinculo || 0} sem vínculo · ${c.erro || 0} com erro · ${c.descartado || 0} descartados</p>
        <section class="card">${table(
          [
            { label: 'Recebido', render: (e) => html`${fmtDateTime(e.received_at)}${e.attempts > 1 ? html`<br><small>${e.attempts} tentativas</small>` : ''}` },
            { label: 'ID da chamada', render: (e) => e.external_call_id || html`<span class="warn-text">ausente</span>` },
            { label: 'Telefone / ID lead', render: (e) => html`${e.phone || '—'}<br><small>${e.lead_ref || '—'}</small>` },
            { label: 'Início / duração', render: (e) => html`${fmtDateTime(e.started_at)}<br><small>${fmtDuration(e.duration_seconds)}</small>` },
            { label: 'Resultado', render: (e) => html`${optLabel('resultado_ligacao', e.result)}${e.result_raw ? html`<br><small>recebido: ${e.result_raw}</small>` : ''}` },
            { label: 'Agente', render: (e) => html`${e.user_name || '—'}${e.agent_ref && !e.user_name ? html`<br><small class="warn-text">${e.agent_ref} (não mapeado)</small>` : ''}` },
            { label: 'Situação', render: (e) => html`${badge({ vinculado: 'Vinculado', sem_vinculo: 'Sem vínculo', erro: 'Erro', descartado: 'Descartado' }[e.status], { vinculado: 'ok', sem_vinculo: 'warn', erro: 'danger', descartado: 'muted' }[e.status])}${e.contact_id ? html`<br><a href="#/leads/${e.contact_id}">${e.contact_code}</a>` : ''}${e.error_message ? html`<br><small>${e.error_message}</small>` : ''}` },
            {
              label: '',
              render: (e) => (['sem_vinculo', 'erro'].includes(e.status)
                ? html`<button class="btn small primary" data-ev="link" data-id="${e.id}">Vincular</button> <button class="btn small" data-ev="retry" data-id="${e.id}">Reprocessar</button> <button class="btn small ghost" data-ev="discard" data-id="${e.id}">Descartar</button> <button class="btn small ghost" data-ev="raw" data-id="${e.id}">Dados</button>`
                : html`<button class="btn small ghost" data-ev="raw" data-id="${e.id}">Dados</button>`),
            },
          ],
          rows,
          { emptyMsg: 'Nenhum evento nesta situação.' },
        )}</section>`);
    } catch (e) {
      toastError(e);
    }
  };
  form.addEventListener('change', load);
  let t;
  form.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(load, 300);
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  on(box, 'click', '[data-ev]', async (e, b) => {
    const ev = rows.find((x) => x.id === Number(b.dataset.id));
    try {
      if (b.dataset.ev === 'raw') {
        let pretty = ev.raw_payload;
        try {
          pretty = JSON.stringify(JSON.parse(ev.raw_payload), null, 2);
        } catch {}
        return modal({ title: `Evento #${ev.id}`, body: html`<pre class="code">${pretty}</pre>` });
      }
      if (b.dataset.ev === 'retry') {
        const r = await post(`/api/discadora/eventos/${ev.id}/reprocessar`);
        toast(`Resultado: ${r.status}${r.message ? ` — ${r.message}` : ''}`, r.status === 'vinculado' ? 'ok' : 'error');
      }
      if (b.dataset.ev === 'discard') {
        const ok = await modal({ title: 'Descartar evento', body: field({ name: 'reason', label: 'Motivo', required: true, full: true }), submitLabel: 'Descartar', danger: true, onSubmit: (d) => post(`/api/discadora/eventos/${ev.id}/descartar`, d) });
        if (!ok) return;
      }
      if (b.dataset.ev === 'link') {
        const picked = await pickContact(`Vincular chamada ${ev.external_call_id || ''} (${ev.phone || 'sem telefone'})`, ev.candidates);
        if (!picked) return;
        await post(`/api/discadora/eventos/${ev.id}/vincular`, { contact_id: picked });
        toast('Evento vinculado e atividade registrada.');
      }
      load();
    } catch (ex) {
      toastError(ex);
    }
  });
  load();
}

function entradas(box) {
  render(box, html`
    <div class="alert">Leads recebidos pela API de entrada e mensagens de WhatsApp que não puderam ser vinculados automaticamente ou tiveram erro. Nenhum cadastro é duplicado: leads que coincidem com cadastros existentes recebem apenas um novo registro de origem.</div>
    <form class="filters" data-f>
      <label>Integração<select name="integration">${selectOptions([{ value: 'api_leads', label: 'API de leads' }, { value: 'whatsapp', label: 'WhatsApp' }], '', { placeholder: 'Todas' })}</select></label>
      <label>Situação<select name="status">${selectOptions([{ value: 'sem_vinculo', label: 'Sem vínculo' }, { value: 'erro', label: 'Com erro' }, { value: 'processado', label: 'Processados' }, { value: 'duplicado', label: 'Descartados/duplicados' }], 'sem_vinculo', { placeholder: 'Todas' })}</select></label>
    </form><div id="list"></div>`);
  const form = $('[data-f]', box);
  let rows = [];
  const load = async () => {
    try {
      const r = await get('/api/entradas', { ...Object.fromEntries(new FormData(form).entries()), limit: 100 });
      rows = r.rows;
      render($('#list', box), html`<section class="card">${table(
        [
          { label: 'Recebido', render: (e) => fmtDateTime(e.received_at) },
          { label: 'Integração', render: (e) => (e.integration === 'whatsapp' ? 'WhatsApp' : 'API de leads') },
          { label: 'ID externo', render: (e) => e.external_id || '—' },
          { label: 'Situação', render: (e) => html`${badge(e.status, { processado: 'ok', sem_vinculo: 'warn', erro: 'danger', duplicado: 'muted' }[e.status])}${e.contact_id ? html`<br><a href="#/leads/${e.contact_id}">${e.contact_code}</a>` : ''}${e.error_message ? html`<br><small>${e.error_message}</small>` : ''}` },
          { label: '', render: (e) => html`${e.status !== 'processado' && e.status !== 'duplicado' ? html`<button class="btn small primary" data-ev="link" data-id="${e.id}">Vincular</button> <button class="btn small" data-ev="retry" data-id="${e.id}">Reprocessar</button> <button class="btn small ghost" data-ev="discard" data-id="${e.id}">Descartar</button> ` : ''}<button class="btn small ghost" data-ev="raw" data-id="${e.id}">Dados</button>` },
        ],
        rows,
        { emptyMsg: 'Nenhum evento.' },
      )}</section>`);
    } catch (e) {
      toastError(e);
    }
  };
  form.addEventListener('change', load);
  on(box, 'click', '[data-ev]', async (e, b) => {
    const ev = rows.find((x) => x.id === Number(b.dataset.id));
    try {
      if (b.dataset.ev === 'raw') {
        let pretty = ev.payload;
        try {
          pretty = JSON.stringify(JSON.parse(ev.payload), null, 2);
        } catch {}
        return modal({ title: `Evento #${ev.id}`, body: html`<pre class="code">${pretty}</pre>` });
      }
      if (b.dataset.ev === 'retry') {
        const r = await post(`/api/entradas/${ev.id}/reprocessar`, {});
        toast(`Resultado: ${r.status}${r.message ? ` — ${r.message}` : ''}`);
      }
      if (b.dataset.ev === 'discard') {
        const ok = await modal({ title: 'Descartar evento', body: field({ name: 'reason', label: 'Motivo', required: true, full: true }), submitLabel: 'Descartar', danger: true, onSubmit: (d) => post(`/api/entradas/${ev.id}/descartar`, d) });
        if (!ok) return;
      }
      if (b.dataset.ev === 'link') {
        const picked = await pickContact('Vincular a um cadastro existente');
        if (!picked) return;
        await post(`/api/entradas/${ev.id}/reprocessar`, { contact_id: picked });
        toast('Evento vinculado.');
      }
      load();
    } catch (ex) {
      toastError(ex);
    }
  });
  load();
}

/** Seleção de cadastro por busca (com candidatos sugeridos). */
export function pickContact(title, candidates = []) {
  return modal({
    title,
    wide: true,
    body: html`${candidates.length ? html`<p><strong>Cadastros com o mesmo telefone:</strong></p>${candidates.map((c) => html`<label class="check"><input type="radio" name="pick" value="${c.id}"> ${c.code} — ${c.name}</label>`)}` : ''}
      <div class="field full"><label>Buscar outro cadastro</label><input type="search" name="q" placeholder="nome, telefone, e-mail ou código"></div>
      <div class="pick-results"></div>`,
    submitLabel: 'Vincular',
    onMount(form) {
      let t;
      form.q.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          const rows = (await get('/api/busca', { q: form.q.value })).filter((r) => r.kind === 'contact');
          render($('.pick-results', form), rows.length ? html`${rows.map((r) => html`<label class="check"><input type="radio" name="pick" value="${r.id}"> ${r.code} — ${r.title} <small>${r.subtitle}</small></label>`)}` : empty('Nenhum resultado.'));
        }, 250);
      });
    },
    onSubmit(d, form) {
      const v = form.querySelector('input[name=pick]:checked')?.value;
      if (!v) throw new Error('Selecione um cadastro.');
      return Number(v);
    },
  });
}
