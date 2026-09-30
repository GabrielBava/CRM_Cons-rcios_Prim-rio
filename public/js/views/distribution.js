// 2. Prospects e leads: fila de entrada por canal e distribuição (manual, roleta e automática) aos especialistas.
import { get, post, patch } from '../api.js';
import { html, raw, render, $, $$, on, state, selectOptions, opts, userItems, table, badge, fmtDateTime, relTime, fmtMoney, optLabel, K, modal, field, toast, toastError, empty, can } from '../ui.js';
import { quickCreateContact } from '../forms.js';

let filters = {};

export async function show(view) {
  const load = async () => {
    let d;
    try {
      d = await get('/api/distribuicao', filters);
    } catch (e) {
      render(view, html`<div class="page"><div class="alert danger">${e.message}</div></div>`);
      return;
    }
    const r = d.roleta;
    const active = r.participants.filter((p) => p.active);
    render(view, html`<div class="page">
      <div class="page-head"><div><h1>Prospects e leads</h1><p class="muted">Entrada de novos contatos por canal e distribuição aos especialistas.</p></div>
        <div class="actions"><button class="btn" data-act="new">+ Cadastrar lead</button><a class="btn" href="#/importar">Importar planilha</a>${state.user.role === 'admin' ? html`<button class="btn" data-act="roleta">Configurar roleta</button>` : ''}</div></div>
      <div class="kpis small">
        <div class="kpi ${d.rows.length ? 'alert-kpi' : ''}"><div class="kpi-label">Aguardando distribuição</div><div class="kpi-value">${d.rows.length}</div><div class="kpi-sub">${d.oldest_waiting ? `mais antigo ${relTime(d.oldest_waiting)}` : 'fila vazia'}</div></div>
        <div class="kpi"><div class="kpi-label">Entradas nas últimas 24 h</div><div class="kpi-value">${d.received_24h}</div><div class="kpi-sub">${d.received_7d} nos últimos 7 dias</div></div>
        <div class="kpi ${d.no_contact.length ? 'alert-kpi' : ''}"><div class="kpi-label">Distribuídos sem contato</div><div class="kpi-value">${d.no_contact.length}</div><div class="kpi-sub">há mais de ${d.no_contact_hours} h sem nenhuma atividade</div></div>
        <div class="kpi"><div class="kpi-label">Roleta</div><div class="kpi-value">${active.length}</div><div class="kpi-sub">especialista(s) · ${r.mode === 'menor_carteira' ? 'menor carteira' : 'sequencial'} · automática ${r.auto ? 'ligada' : 'desligada'}</div></div>
      </div>
      <section class="card"><h3>Entradas por canal (aguardando)</h3>
        ${d.by_origin.length ? html`<div class="chips">${d.by_origin.map((o) => html`<button class="chip ${filters.origin === o.origin ? 'active' : ''}" data-origin="${o.origin === 'sem_origem' ? '' : o.origin}">${o.label} <strong>${o.fila}</strong></button>`)}${filters.origin ? html`<button class="chip" data-origin="">Todos</button>` : ''}</div>` : html`<p class="muted">Nenhum cadastro aguardando.</p>`}
      </section>
      <section class="card">
        <div class="section-head"><h3>Fila de distribuição</h3>
          <span class="inline-actions"><label class="inline">Para<select data-to>${selectOptions(userItems().filter((u) => state.meta.users.find((x) => x.id === u.value && ['consultor', 'gestor'].includes(x.role))), '', { placeholder: 'Escolha o especialista' })}</select></label>
          <button class="btn" data-act="assign">Distribuir selecionados</button><button class="btn primary" data-act="roleta-run">Distribuir pela roleta</button></span></div>
        <p class="hint">Selecione os cadastros e escolha o especialista, ou use a roleta (${r.mode === 'menor_carteira' ? 'vai para quem tem a menor carteira em aberto' : 'um para cada especialista, na ordem'}). Cada distribuição cria a tarefa "Primeiro contato" com prazo de ${r.first_contact_hours} h.</p>
        ${table(
          [
            { label: html`<input type="checkbox" data-all aria-label="Selecionar todos">`, render: (c) => html`<input type="checkbox" data-sel="${c.id}" aria-label="Selecionar ${c.name}">` },
            { label: 'Entrada', render: (c) => html`${fmtDateTime(c.created_at)}<br><small class="${Date.now() - Date.parse(c.created_at) > 3600000 ? 'overdue' : 'muted'}">${relTime(c.created_at)}</small>` },
            { label: 'Cadastro', render: (c) => html`<a href="#/leads/${c.id}"><strong>${c.name}</strong></a><br><small>${c.code} · ${K('relationships', c.relationship)} · ${c.kind}</small>` },
            { label: 'Canal / campanha', render: (c) => html`${optLabel('origem', c.origin)}${c.campaign ? html`<br><small>${c.campaign}</small>` : ''}` },
            { label: 'Contato', render: (c) => html`${c.whatsapp || c.phone1 || '—'}<br><small>${c.email || ''}</small>` },
            { label: 'Local', render: (c) => [c.city, c.state].filter(Boolean).join('/') || '—' },
            { label: 'Crédito', render: (c) => (c.credit_value ? fmtMoney(c.credit_value) : '—'), cls: 'num' },
          ],
          d.rows,
          { emptyMsg: 'Nenhum prospect ou lead aguardando distribuição.' },
        )}
      </section>
      ${d.no_contact.length ? html`<section class="card"><div class="section-head"><h3>Distribuídos e ainda sem contato</h3><button class="btn" data-act="redistribute">Redistribuir selecionados pela roleta</button></div>
        <p class="hint">Leads distribuídos há mais de ${d.no_contact_hours} h sem nenhuma ligação, mensagem ou anotação do especialista.</p>
        ${table(
          [
            { label: '', render: (c) => html`<input type="checkbox" data-resel="${c.id}">` },
            { label: 'Cadastro', render: (c) => html`<a href="#/leads/${c.id}">${c.name}</a><br><small>${c.code}</small>` },
            { label: 'Canal', render: (c) => optLabel('origem', c.origin) },
            { label: 'Especialista', render: (c) => c.owner_name },
            { label: 'Distribuído', render: (c) => html`${fmtDateTime(c.assigned_at)}<br><small class="overdue">${relTime(c.assigned_at)}</small>` },
          ],
          d.no_contact,
        )}</section>` : ''}
      <section class="card"><h3>Últimas distribuições</h3>
        ${table(
          [
            { label: 'Quando', render: (l) => fmtDateTime(l.created_at) },
            { label: 'Cadastro', render: (l) => html`<a href="#/leads/${l.contact_id}">${l.contact_code} — ${l.contact_name}</a>` },
            { label: 'Para', render: (l) => html`${l.to_name}${l.from_name ? html`<br><small>antes: ${l.from_name}</small>` : ''}` },
            { label: 'Como', render: (l) => ({ manual: 'Manual', roleta: 'Roleta', auto: 'Automática (roleta)', redistribuicao: 'Redistribuição' })[l.method] || l.method },
            { label: 'Por', render: (l) => l.by_name || 'Sistema' },
          ],
          d.log,
          { emptyMsg: 'Nenhuma distribuição registrada.' },
        )}
      </section>
    </div>`);
  };
  const selected = (attr) => $$(`input[${attr}]:checked`, view).map((i) => Number(i.getAttribute(attr)));
  on(view, 'change', '[data-all]', (e, cb) => $$('input[data-sel]', view).forEach((i) => (i.checked = cb.checked)));
  on(view, 'click', '[data-origin]', (e, b) => ((filters = { ...filters, origin: b.dataset.origin || undefined }), load()));
  on(view, 'click', '[data-act=new]', async () => (await quickCreateContact({ owner_id: '' })) && load());
  const run = async (body) => {
    try {
      const r = await post('/api/distribuicao', body);
      toast(`${r.distributed} cadastro(s) distribuído(s).`);
      load();
    } catch (e) {
      toastError(e);
    }
  };
  on(view, 'click', '[data-act=assign]', () => {
    const ids = selected('data-sel');
    const to = $('[data-to]', view).value;
    if (!ids.length) return toastError(new Error('Selecione ao menos um cadastro.'));
    if (!to) return toastError(new Error('Escolha o especialista.'));
    run({ contact_ids: ids, user_id: Number(to), method: 'manual' });
  });
  on(view, 'click', '[data-act=roleta-run]', () => {
    const ids = selected('data-sel');
    const all = $$('input[data-sel]', view).map((i) => Number(i.dataset.sel));
    if (!all.length) return toastError(new Error('Não há cadastros na fila.'));
    run({ contact_ids: ids.length ? ids : all, method: 'roleta' });
  });
  on(view, 'click', '[data-act=redistribute]', () => {
    const ids = selected('data-resel');
    if (!ids.length) return toastError(new Error('Selecione os cadastros a redistribuir.'));
    run({ contact_ids: ids, method: 'redistribuicao' });
  });
  on(view, 'click', '[data-act=roleta]', async () => {
    const d = await get('/api/distribuicao');
    const r = d.roleta;
    const ok = await modal({
      title: 'Configurar a roleta de distribuição',
      wide: true,
      body: html`<div class="grid">
          ${field({ name: 'mode', label: 'Regra', type: 'select', options: [{ value: 'sequencial', label: 'Sequencial (um para cada, na ordem, respeitando o peso)' }, { value: 'menor_carteira', label: 'Menor carteira em aberto (equilibra a carga)' }], value: r.mode, allowEmpty: false, full: true })}
          ${field({ name: 'first_contact_hours', label: 'Prazo para o primeiro contato (horas)', type: 'number', value: r.first_contact_hours, step: '0.25', min: 0.25 })}
          ${field({ name: 'auto', label: 'Distribuir automaticamente os leads que entram pela API (sem responsável definido)', type: 'checkbox', value: r.auto, full: true })}
        </div>
        <h4>Participantes</h4>
        <table class="compact"><thead><tr><th>Participa</th><th>Especialista</th><th>Carteira aberta</th><th>Peso</th><th>Canais (vazio = todos)</th></tr></thead><tbody>
          ${r.participants.map((p) => html`<tr><td><input type="checkbox" name="p_${p.id}" ${p.active ? raw('checked') : ''}></td><td>${p.name}</td><td>${p.carteira}</td>
            <td><select name="w_${p.id}">${[1, 2, 3, 4, 5].map((n) => html`<option ${n === p.weight ? raw('selected') : ''}>${n}</option>`)}</select></td>
            <td><select name="o_${p.id}" multiple size="3">${opts('origem').map((o) => html`<option value="${o.value}" ${p.origins.includes(o.value) ? raw('selected') : ''}>${o.label}</option>`)}</select></td></tr>`)}
        </tbody></table>
        <p class="hint">Peso 2 recebe o dobro de leads do peso 1 na regra sequencial. Canais limitam quem recebe cada origem (ex.: indicações só para especialistas seniores).</p>`,
      async onSubmit(v, form) {
        const participants = r.participants.map((p) => ({ user_id: p.id, active: !!v[`p_${p.id}`], weight: Number(v[`w_${p.id}`]) || 1, origins: [...form[`o_${p.id}`].selectedOptions].map((o) => o.value) }));
        await patch('/api/distribuicao/roleta', { mode: v.mode, auto: v.auto, first_contact_hours: v.first_contact_hours, participants });
        toast('Roleta atualizada.');
        return true;
      },
    });
    if (ok) load();
  });
  await load();
}
