// Abas da ficha do lead/cliente: Origem, Endereço, Negócio, Financeiro, Relacionamentos, Documentos, Pré-venda e Pós-venda.
import { get, post, patch } from '../api.js';
import {
  html, raw, render, $, on, state, field, formData, opts, userItems, table, badge, optLabel, K, fmtDate, fmtDateTime, fmtMoney, relTime,
  modal, toast, toastError, can, empty, todayLocal } from '../ui.js';
import { qualBlocks, qualProgress, tempBadge } from '../qualification.js';
import { timelineList, bindTimeline } from '../postsale-timeline.js';
import { opportunityForm, contractForm } from '../forms.js';

const ro = (c) => !can.write() || !!c.anonymized_at;
const catLabel = (k) => optLabel('categoria_credito', k.category || state.meta.products.find((p) => p.id === k.product_id)?.category);

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    r.readAsDataURL(file);
  });
}

async function pickContact(title, excludeId) {
  return modal({
    title,
    body: html`<div class="field full"><label>Buscar cadastro</label><input type="search" name="q" placeholder="nome, telefone, e-mail ou código"></div><div class="pick-results"></div>`,
    submitLabel: 'Selecionar',
    onMount(form) {
      let t;
      form.q.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          const rows = (await get('/api/busca', { q: form.q.value })).filter((r) => r.kind === 'contact' && r.id !== excludeId);
          render($('.pick-results', form), rows.length ? html`${rows.map((r) => html`<label class="check"><input type="radio" name="pick" value="${r.id}"> ${r.code} — ${r.title} <small>${r.subtitle}</small></label>`)}` : empty('Nenhum cadastro encontrado.'));
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

const kv = (label, v) => html`<div><span>${label}</span>${v == null || v === '' ? '—' : v}</div>`;

/* ------------------------- 2. Origem ------------------------- */

export async function origem(box, c, reload, extra) {
  render(box, html`<div class="cols">
    <form class="card" id="orig"><h3>Origem e responsável</h3>
      <fieldset ${ro(c) ? raw('disabled') : ''}><div class="grid">
        ${field({ name: 'origin', label: 'Origem do lead', type: 'select', options: opts('origem'), value: c.origin })}
        ${field({ name: 'campaign', label: 'Campanha ou ação de origem', value: c.campaign })}
        <div class="field"><label>Temperatura do lead</label><div class="static-field">${c.temperature ? tempBadge(c.temperature) : html`<span class="muted">—</span>`}</div><small>Calculada pela qualificação do negócio: quente, morno ou frio.</small></div>
        ${field({ name: 'owner_id', label: 'Responsável atual', type: 'select', options: userItems(), value: c.owner_id, placeholder: 'Sem responsável', disabled: !can.manage() })}
        <div class="field"><label>Data de cadastro</label><input value="${fmtDateTime(c.created_at)}" disabled></div>
        ${field({ name: 'first_contact_at', label: 'Data do primeiro contato', type: 'datetime', value: c.first_contact_at, help: 'Preenchida automaticamente na primeira tentativa de contato.' })}
        <div class="field full"><label>Indicado por</label>
          <div class="inline-actions">${c.referred_by ? html`<a href="#/leads/${c.referred_by.id}">${c.referred_by.code} — ${c.referred_by.name}</a>` : html`<span class="muted">Ninguém informado</span>`}
          ${ro(c) ? '' : html`<button type="button" class="btn small" data-act="ref-pick">${c.referred_by ? 'Trocar' : 'Informar'}</button>${c.referred_by ? html`<button type="button" class="btn small ghost" data-act="ref-clear">Remover</button>` : ''}`}</div></div>
        ${field({ name: 'initial_notes', label: 'Observações', type: 'textarea', value: c.initial_notes, full: true })}
      </div>${ro(c) ? '' : html`<div class="form-actions"><button class="btn primary" type="submit">Salvar origem</button></div>`}</fieldset>
    </form>
    <section class="card"><h3>Indicações feitas por este cadastro</h3>
      ${c.referrals.length ? html`<ul class="opp-list">${c.referrals.map((r) => html`<li><a href="#/leads/${r.id}">${r.code} — ${r.name}</a> ${badge(K('relationships', r.relationship), `rel-${r.relationship}`)} <small class="muted">${fmtDate(r.created_at)}</small></li>`)}</ul>` : empty('Nenhuma indicação registrada.')}
    </section>
  </div><div id="origin-history"></div>`);
  $('#orig', box).addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    if (!can.manage()) delete d.owner_id;
    try {
      await patch(`/api/cadastros/${c.id}`, d);
      toast('Origem atualizada.');
      reload();
    } catch (ex) {
      toastError(ex);
    }
  });
  on(box, 'click', '[data-act=ref-pick]', async () => {
    const id = await pickContact('Quem indicou este cadastro?', c.id);
    if (!id) return;
    await patch(`/api/cadastros/${c.id}`, { referred_by_id: id }).then(reload).catch(toastError);
  });
  on(box, 'click', '[data-act=ref-clear]', () => patch(`/api/cadastros/${c.id}`, { referred_by_id: null }).then(reload).catch(toastError));
  if (extra) await extra($('#origin-history', box), c, reload);
}

/* ------------------------- 3. Endereço ------------------------- */

/**
 * Busca o endereço assim que o CEP tem 8 dígitos. Se não encontrar (ou o serviço estiver fora), libera o preenchimento manual.
 * Usado na ficha e na página do cliente.
 */
export function bindCepAutofill(form, lookup) {
  const msg = $('.cep-msg', form);
  let last = '';
  const run = async () => {
    const cep = form.cep.value.replace(/\D/g, '');
    if (cep.length > 5) form.cep.value = `${cep.slice(0, 5)}-${cep.slice(5, 8)}`;
    if (cep.length !== 8 || cep === last) return;
    last = cep;
    msg.textContent = 'Buscando endereço…';
    msg.className = 'cep-msg';
    try {
      const r = await lookup(cep);
      for (const f of ['street', 'district', 'city', 'state', 'ibge']) if (r[f] && form[f]) form[f].value = r[f];
      if (r.complement && form.complement && !form.complement.value) form.complement.value = r.complement;
      msg.textContent = 'Endereço encontrado. Confira e informe o número.';
      msg.className = 'cep-msg ok-text';
      form.number.focus();
    } catch (e) {
      msg.textContent = `${e.status === 404 ? 'CEP não localizado.' : 'Não foi possível consultar o CEP agora.'} Preencha o endereço manualmente.`;
      msg.className = 'cep-msg warn-text';
      form.street.focus();
    }
  };
  form.cep.addEventListener('input', run);
  form.cep.addEventListener('blur', run);
}

function addressForm(c, a = {}) {
  return modal({
    title: a.id ? 'Editar endereço' : 'Novo endereço',
    wide: true,
    body: html`<div class="grid three">
      <div class="field"><label>CEP</label><input name="cep" value="${a.cep || ''}" inputmode="numeric" placeholder="00000-000" maxlength="9" autocomplete="postal-code"><small class="cep-msg">Ao digitar os 8 números, o endereço é preenchido automaticamente.</small></div>
      ${field({ name: 'type', label: 'Tipo', type: 'select', options: opts('tipo_endereco'), value: a.type || 'residencial', allowEmpty: false })}
      ${field({ name: 'is_primary', label: 'Endereço principal', type: 'checkbox', value: a.id ? !!a.is_primary : !c.addresses.length })}
      ${field({ name: 'street', label: 'Logradouro', value: a.street, full: true })}
      ${field({ name: 'number', label: 'Número', value: a.number })}
      ${field({ name: 'complement', label: 'Complemento', value: a.complement })}
      ${field({ name: 'district', label: 'Bairro', value: a.district })}
      ${field({ name: 'city', label: 'Cidade', value: a.city })}
      ${field({ name: 'state', label: 'Estado (UF)', value: a.state, maxlength: 2 })}
      ${field({ name: 'notes', label: 'Observação', type: 'textarea', value: a.notes, full: true, rows: 2, placeholder: 'ex.: ponto de referência, horário para entrega de documentos' })}
      <input type="hidden" name="ibge" value="${a.ibge || ''}">
    </div>`,
    onMount(form) {
      bindCepAutofill(form, (cep) => get(`/api/cep/${cep}`));
    },
    async onSubmit(d) {
      await post(`/api/cadastros/${c.id}/enderecos`, { ...d, id: a.id });
      toast('Endereço salvo.');
      return true;
    },
  });
}

export async function endereco(box, c, reload) {
  render(box, html`<section class="card">
    <div class="section-head"><h3>Endereços</h3>${ro(c) ? '' : html`<button class="btn" data-act="addr-new">+ Adicionar endereço</button>`}</div>
    <p class="hint">Ao digitar o CEP, logradouro, bairro, cidade e UF são preenchidos automaticamente; se o CEP não for localizado, preencha manualmente. O endereço principal define a cidade e a UF exibidas nas listas.</p>
    ${c.addresses.length
      ? html`<div class="cols">${c.addresses.map((a) => html`<div class="card inner">
          <div class="section-head"><strong>${optLabel('tipo_endereco', a.type)}</strong>${a.is_primary ? badge('Principal', 'ok') : ''}</div>
          <p>${[a.street, a.number].filter(Boolean).join(', ') || '—'}${a.complement ? ` — ${a.complement}` : ''}<br>${[a.district, a.city, a.state].filter(Boolean).join(' · ')}<br><span class="muted">CEP ${a.cep ? `${a.cep.slice(0, 5)}-${a.cep.slice(5)}` : '—'}</span></p>
          ${a.notes ? html`<p class="small"><strong>Observação:</strong> ${a.notes}</p>` : ''}
          ${ro(c) ? '' : html`<div class="inline-actions"><button class="btn small" data-addr-edit="${a.id}">Editar</button><button class="btn small ghost" data-addr-del="${a.id}">Remover</button></div>`}
        </div>`)}</div>`
      : html`${empty('Nenhum endereço cadastrado.')}${c.city || c.state ? html`<p class="muted small">Cidade/UF informadas no cadastro rápido: ${[c.city, c.state].filter(Boolean).join('/')}</p>` : ''}`}
  </section>`);
  on(box, 'click', '[data-act=addr-new]', async () => (await addressForm(c)) && reload());
  on(box, 'click', '[data-addr-edit]', async (e, b) => (await addressForm(c, c.addresses.find((a) => a.id === Number(b.dataset.addrEdit)))) && reload());
  on(box, 'click', '[data-addr-del]', async (e, b) => {
    const ok = await modal({ title: 'Remover endereço', body: html`<p>Remover este endereço? A remoção fica registrada na auditoria.</p>`, submitLabel: 'Remover', danger: true, onSubmit: () => true });
    if (ok) post(`/api/enderecos/${b.dataset.addrDel}/remover`).then(reload).catch(toastError);
  });
}

/* ------------------------- 4. Negócio ------------------------- */

export async function negocio(box, c, reload) {
  const opp = c.opportunities;
  const r1 = (o) => html`${o.temperature && o.status === 'aberta' ? html`<p class="temp-line">${tempBadge(o.temperature)} <small class="muted">${o.temperature_reason || ''}</small></p>` : ''}${qualProgress(o, c.kind)}${qualBlocks(o, c.kind)}`;
  render(box, html`<section class="card">
    <div class="section-head"><h3>Negócios</h3>${ro(c) ? '' : html`<button class="btn" data-act="opp">+ Novo negócio</button>`}</div>
    <p class="hint">A qualificação fica em cinco blocos: necessidade, prazo, capacidade, estratégia e decisão. Em Lead e Tentativa de contato, busque o máximo de respostas; o que faltar é completado na R1. Cada negócio segue o funil com sua própria etapa e próxima ação.</p>
  </section>
  ${opp.length ? opp.map((o) => html`<section class="card">
      <div class="section-head"><div><h3><a href="#/oportunidades/${o.id}">${o.code}</a> ${o.title || ''}</h3>
        <div class="badges">${badge(o.stage_name, `kind-${o.stage_kind}`)} ${badge(K('opp_status', o.status), o.status === 'ganha' ? 'ok' : o.status === 'perdida' ? 'danger' : '')} ${o.product_name ? badge(o.product_name) : ''}</div></div>
        ${ro(c) ? '' : html`<button class="btn small" data-opp-edit="${o.id}">Editar qualificação</button>`}</div>
      ${r1(o)}
      <p class="small muted">Responsável: ${o.owner_name || '—'} · Próxima ação: ${o.next_action ? `${o.next_action} (${fmtDateTime(o.next_action_at)})` : 'nenhuma'}</p>
    </section>`) : html`<section class="card">${empty('Nenhum negócio registrado.')}</section>`}`);
  on(box, 'click', '[data-act=opp]', async () => (await opportunityForm(c)) && reload());
  on(box, 'click', '[data-opp-edit]', async (e, b) => {
    const o = await get(`/api/oportunidades/${b.dataset.oppEdit}`);
    if (await opportunityForm(c, o)) reload();
  });
}

/* ------------------------- 5. Financeiro ------------------------- */

const FIN_STATUS = { a_vencer: ['A vencer', ''], atrasado: ['Em atraso', 'danger'], pago: ['Pago', 'ok'], negociado: ['Negociado', 'warn'], cancelado: ['Cancelado', 'muted'] };
export const finBadge = (s) => badge(FIN_STATUS[s]?.[0] || s, FIN_STATUS[s]?.[1] || '');

export function entryForm(contactId, contracts, e = {}) {
  return modal({
    title: e.id ? `Editar ${e.code}` : 'Novo lançamento',
    body: html`<div class="grid">
      ${field({ name: 'type', label: 'Tipo', type: 'select', options: opts('tipo_lancamento'), value: e.type || 'parcela', allowEmpty: false })}
      ${contracts.length ? field({ name: 'contract_id', label: 'Contrato', type: 'select', options: contracts.map((k) => ({ value: k.id, label: `${k.code}${k.contract_number ? ` · ${k.contract_number}` : ''}` })), value: e.contract_id, placeholder: 'Nenhum' }) : ''}
      ${field({ name: 'installment_number', label: 'Nº da parcela', type: 'number', value: e.installment_number, min: 0, step: 1 })}
      ${field({ name: 'due_date', label: 'Vencimento', type: 'date', value: e.due_date, required: true })}
      ${field({ name: 'amount', label: 'Valor (R$)', type: 'money', value: e.amount, required: true })}
      ${field({ name: 'description', label: 'Descrição', value: e.description })}
      ${field({ name: 'notes', label: 'Observações', type: 'textarea', value: e.notes, full: true })}
    </div>`,
    async onSubmit(d) {
      if (e.id) await patch(`/api/financeiro/${e.id}`, d);
      else await post('/api/financeiro', { ...d, contact_id: contactId });
      toast('Lançamento salvo.');
      return true;
    },
  });
}

export function entryAction(e, action) {
  if (action === 'pagar') {
    return modal({
      title: `Registrar pagamento — ${e.code}`,
      body: html`<div class="grid">
        ${field({ name: 'paid_at', label: 'Data do pagamento', type: 'date', value: todayLocal(), required: true })}
        ${field({ name: 'paid_amount', label: 'Valor pago (R$)', type: 'money', value: e.amount })}
        ${field({ name: 'payment_method', label: 'Forma de pagamento', type: 'select', options: opts('forma_pagamento') })}
        ${field({ name: 'notes', label: 'Observações', type: 'textarea', full: true })}
      </div>`,
      submitLabel: 'Registrar pagamento',
      async onSubmit(d) {
        await patch(`/api/financeiro/${e.id}`, { ...d, action: 'pagar' });
        toast('Pagamento registrado.');
        return true;
      },
    });
  }
  const titles = { negociar: 'Marcar como negociado', cancelar: 'Cancelar lançamento', reabrir: 'Reabrir lançamento' };
  return modal({
    title: `${titles[action]} — ${e.code}`,
    body: field({ name: 'notes', label: action === 'negociar' ? 'O que foi combinado' : action === 'cancelar' ? 'Motivo' : 'Observação', type: 'textarea', required: action !== 'reabrir', full: true }),
    submitLabel: titles[action],
    danger: action === 'cancelar',
    async onSubmit(d) {
      await patch(`/api/financeiro/${e.id}`, { ...d, action });
      toast('Lançamento atualizado.');
      return true;
    },
  });
}

export function entriesTable(rows, { showContact = false, write = true } = {}) {
  return table(
    [
      { label: 'Vencimento', render: (e) => html`<span class="${e.display_status === 'atrasado' ? 'overdue' : ''}">${fmtDate(e.due_date)}${e.days_late ? html`<br><small>${e.days_late} dia(s) em atraso</small>` : ''}</span>` },
      ...(showContact ? [{ label: 'Cliente', render: (e) => html`<a href="#/leads/${e.contact_id}/financeiro">${e.contact_name}</a><br><small>${e.contact_code}</small>` }] : []),
      { label: 'Lançamento', render: (e) => html`<strong>${optLabel('tipo_lancamento', e.type)}${e.installment_number ? ` nº ${e.installment_number}` : ''}</strong><br><small>${e.code}${e.contract_code ? ` · ${e.contract_code}` : ''}${e.contract_number ? ` · ${e.contract_number}` : ''}</small>${e.description ? html`<br><small>${e.description}</small>` : ''}` },
      { label: 'Valor', render: (e) => fmtMoney(e.amount), cls: 'num' },
      { label: 'Situação', render: (e) => html`${finBadge(e.display_status)}${e.paid_at ? html`<br><small>Pago em ${fmtDate(e.paid_at)}${e.paid_amount != null && e.paid_amount !== e.amount ? ` · ${fmtMoney(e.paid_amount)}` : ''}${e.payment_method ? ` · ${optLabel('forma_pagamento', e.payment_method)}` : ''}</small>` : ''}${e.notes ? html`<br><small class="muted">${e.notes}</small>` : ''}` },
      {
        label: '',
        render: (e) => {
          if (!write) return '';
          if (['a_vencer', 'atrasado', 'negociado'].includes(e.display_status)) {
            return html`<button class="btn small primary" data-fin="pagar" data-id="${e.id}">Pagar</button> <button class="btn small" data-fin="editar" data-id="${e.id}">Editar</button> ${e.display_status !== 'negociado' ? html`<button class="btn small ghost" data-fin="negociar" data-id="${e.id}">Negociado</button>` : ''} <button class="btn small ghost" data-fin="cancelar" data-id="${e.id}">Cancelar</button>`;
          }
          return html`<button class="btn small ghost" data-fin="reabrir" data-id="${e.id}">Reabrir</button>`;
        },
      },
    ],
    rows,
    { emptyMsg: 'Nenhum lançamento.' },
  );
}

export function bindEntries(root, getRows, getContracts, reload) {
  on(root, 'click', '[data-fin]', async (ev, b) => {
    const e = getRows().find((x) => x.id === Number(b.dataset.id));
    try {
      const ok = b.dataset.fin === 'editar' ? await entryForm(e.contact_id, getContracts(e), e) : await entryAction(e, b.dataset.fin);
      if (ok) reload();
    } catch (ex) {
      toastError(ex);
    }
  });
}

export async function financeiro(box, c, reload) {
  const f = await get(`/api/cadastros/${c.id}/financeiro`);
  const s = f.summary;
  const w = !ro(c);
  render(box, html`
    <div class="kpis small">
      <div class="kpi"><div class="kpi-label">Pago</div><div class="kpi-value">${fmtMoney(s.pago)}</div></div>
      <div class="kpi"><div class="kpi-label">A vencer</div><div class="kpi-value">${fmtMoney(s.a_vencer)}</div><div class="kpi-sub">${s.proximo_vencimento ? `Próximo: ${fmtDate(s.proximo_vencimento)}` : 'Sem vencimentos futuros'}</div></div>
      <div class="kpi ${s.qtd_atrasado ? 'alert-kpi' : ''}"><div class="kpi-label">Em atraso</div><div class="kpi-value">${fmtMoney(s.atrasado)}</div><div class="kpi-sub">${s.qtd_atrasado} lançamento(s)${s.atraso_desde ? ` desde ${fmtDate(s.atraso_desde)}` : ''}</div></div>
      <div class="kpi"><div class="kpi-label">Pendências abertas</div><div class="kpi-value">${s.pendencias_abertas}</div></div>
    </div>
    <section class="card">
      <div class="section-head"><h3>Lançamentos</h3>${w ? html`<span class="inline-actions"><button class="btn" data-act="fin-new">+ Lançamento</button>${c.contracts.length ? html`<button class="btn" data-act="fin-gen">Gerar parcelas de um contrato</button>` : ''}</span>` : ''}</div>
      <p class="hint">O cliente paga à administradora; aqui a equipe acompanha cada parcela. Parcelas vencidas e não pagas geram uma tarefa para o responsável financeiro.</p>
      ${entriesTable(f.entries, { write: w })}
    </section>
    <section class="card">
      <div class="section-head"><h3>Pendências e acordos</h3>${w ? html`<button class="btn" data-act="issue-new">+ Pendência</button>` : ''}</div>
      ${table(
        [
          { label: 'Aberta em', render: (i) => fmtDate(i.opened_at) },
          { label: 'Descrição', render: (i) => html`<strong>${i.description}</strong>${i.contract_code ? html`<br><small>${i.contract_code}</small>` : ''}` },
          { label: 'Valor', render: (i) => fmtMoney(i.amount), cls: 'num' },
          { label: 'Acordo', render: (i) => html`${i.agreement || '—'}${i.due_date ? html`<br><small>Prazo: ${fmtDate(i.due_date)}</small>` : ''}` },
          { label: 'Situação', render: (i) => badge({ aberta: 'Aberta', em_negociacao: 'Em negociação', resolvida: 'Resolvida' }[i.status], { aberta: 'danger', em_negociacao: 'warn', resolvida: 'ok' }[i.status]) },
          { label: '', render: (i) => (w ? html`<button class="btn small" data-issue="${i.id}">Atualizar</button>` : '') },
        ],
        f.issues,
        { emptyMsg: 'Nenhuma pendência registrada.' },
      )}
    </section>`);
  const contractsOf = () => c.contracts;
  bindEntries(box, () => f.entries, contractsOf, reload);
  on(box, 'click', '[data-act=fin-new]', async () => (await entryForm(c.id, c.contracts)) && reload());
  on(box, 'click', '[data-act=fin-gen]', async () => {
    const ok = await modal({
      title: 'Gerar parcelas do contrato',
      body: html`<p class="hint">Cria uma parcela por mês a partir do primeiro vencimento. Parcelas com o mesmo número não são duplicadas.</p><div class="grid">
        ${field({ name: 'contract_id', label: 'Contrato', type: 'select', options: c.contracts.map((k) => ({ value: k.id, label: `${k.code}${k.contract_number ? ` · ${k.contract_number}` : ''} — ${fmtMoney(k.installment_value)}/mês` })), allowEmpty: false, full: true })}
        ${field({ name: 'first_due_date', label: 'Primeiro vencimento', type: 'date', help: 'Se vazio, usa a data do contrato.' })}
        ${field({ name: 'count', label: 'Quantidade de parcelas', type: 'number', help: 'Se vazio, usa o prazo do contrato.' })}
        ${field({ name: 'amount', label: 'Valor da parcela (R$)', type: 'money', help: 'Se vazio, usa o valor do contrato.' })}
        ${field({ name: 'start_number', label: 'Começar pela parcela nº', type: 'number', value: 1 })}
      </div>`,
      submitLabel: 'Gerar parcelas',
      async onSubmit(d) {
        const r = await post(`/api/contratos/${d.contract_id}/gerar-parcelas`, d);
        toast(`${r.created} parcela(s) gerada(s).`);
        return true;
      },
    });
    if (ok) reload();
  });
  const issueForm = (i = {}) =>
    modal({
      title: i.id ? 'Atualizar pendência' : 'Nova pendência financeira',
      body: html`<div class="grid">
        ${field({ name: 'description', label: 'Descrição', value: i.description, required: !i.id, full: true })}
        ${c.contracts.length ? field({ name: 'contract_id', label: 'Contrato', type: 'select', options: c.contracts.map((k) => ({ value: k.id, label: k.code })), value: i.contract_id, placeholder: 'Nenhum' }) : ''}
        ${field({ name: 'amount', label: 'Valor (R$)', type: 'money', value: i.amount })}
        ${field({ name: 'status', label: 'Situação', type: 'select', options: [{ value: 'aberta', label: 'Aberta' }, { value: 'em_negociacao', label: 'Em negociação' }, { value: 'resolvida', label: 'Resolvida' }], value: i.status || 'aberta', allowEmpty: false })}
        ${field({ name: 'due_date', label: 'Prazo combinado', type: 'date', value: i.due_date })}
        ${field({ name: 'agreement', label: 'Acordo / combinado', type: 'textarea', value: i.agreement, full: true })}
      </div>`,
      async onSubmit(d) {
        await post('/api/financeiro/pendencias', { ...d, id: i.id, contact_id: c.id });
        toast('Pendência salva.');
        return true;
      },
    });
  on(box, 'click', '[data-act=issue-new]', async () => (await issueForm()) && reload());
  on(box, 'click', '[data-issue]', async (e, b) => (await issueForm(f.issues.find((x) => x.id === Number(b.dataset.issue)))) && reload());
}

/* ------------------------- Relacionamentos ------------------------- */

export async function relacionamentos(box, c, reload, companyContacts) {
  const casado = (state.meta.options.estado_civil || []).find((o) => o.value === c.marital_status)?.flags?.conjuge;
  render(box, html`${c.kind === 'PF' ? html`<form class="card" id="spouse"><h3>Cônjuge</h3>
      ${!casado ? html`<p class="hint">Aplicável quando o estado civil é casado(a) ou união estável${c.marital_status ? ` (atual: ${optLabel('estado_civil', c.marital_status)})` : ''}.</p>` : html`<p class="hint">Obrigatório na venda para casados e em união estável.</p>`}
      <fieldset ${ro(c) ? raw('disabled') : ''}><div class="grid">
        ${field({ name: 'spouse_name', label: 'Nome do cônjuge', value: c.spouse_name, sale: casado })}
        ${field({ name: 'spouse_doc', label: 'CPF do cônjuge', value: c.spouse_doc, sale: casado })}
        ${field({ name: 'spouse_profession', label: 'Profissão', value: c.spouse_profession })}
        ${field({ name: 'spouse_income_range', label: 'Renda mensal', type: 'select', options: opts('faixa_renda'), value: c.spouse_income_range })}
      </div>${ro(c) ? '' : html`<div class="form-actions"><button class="btn primary" type="submit">Salvar cônjuge</button></div>`}</fieldset></form>` : html`<section class="card">
      <div class="section-head"><h3>Sócios e representantes legais</h3>${ro(c) ? '' : html`<button class="btn" data-act="partner-new">+ Adicionar</button>`}</div>
      <p class="hint">Na venda é obrigatório ao menos um representante legal.</p>
      ${table(
        [
          { label: 'Nome', render: (p) => html`<strong>${p.name}</strong>${p.is_legal_rep ? html` ${badge('Representante legal', 'ok')}` : ''}${!p.active ? html` ${badge('Inativo', 'muted')}` : ''}` },
          { label: 'Vínculo', render: (p) => optLabel('relacao_socio', p.relation) },
          { label: 'CPF', render: (p) => (p.doc ? `***.${p.doc.slice(3, 6)}.${p.doc.slice(6, 9)}-**` : '—') },
          { label: 'Participação', render: (p) => (p.share_pct != null ? `${p.share_pct}%` : '—') },
          { label: 'Contato', render: (p) => html`${p.phone || '—'}<br><small>${p.email || ''}</small>` },
          { label: '', render: (p) => (ro(c) ? '' : html`<button class="btn small" data-partner="${p.id}">Editar</button>`) },
        ],
        c.partners,
        { emptyMsg: 'Nenhum sócio ou representante cadastrado.' },
      )}</section><div id="cc"></div>`}`);
  if (c.kind === 'PF') {
    $('#spouse', box).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await patch(`/api/cadastros/${c.id}`, formData(e.target));
        toast('Dados do cônjuge salvos.');
        reload();
      } catch (ex) {
        toastError(ex);
      }
    });
    return;
  }
  const partnerForm = (p = {}) =>
    modal({
      title: p.id ? `Editar ${p.name}` : 'Novo sócio ou representante',
      body: html`<div class="grid">
        ${field({ name: 'name', label: 'Nome', value: p.name, required: true })}
        ${field({ name: 'doc', label: 'CPF', value: p.doc })}
        ${field({ name: 'relation', label: 'Vínculo', type: 'select', options: opts('relacao_socio'), value: p.relation || 'socio', allowEmpty: false })}
        ${field({ name: 'share_pct', label: 'Participação (%)', type: 'number', value: p.share_pct, step: '0.01' })}
        ${field({ name: 'phone', label: 'Telefone', type: 'tel', value: p.phone })}
        ${field({ name: 'email', label: 'E-mail', type: 'email', value: p.email })}
        ${field({ name: 'is_legal_rep', label: 'É representante legal', type: 'checkbox', value: !!p.is_legal_rep })}
        ${p.id ? field({ name: 'active', label: 'Ativo', type: 'checkbox', value: p.active !== 0 }) : ''}
      </div>`,
      async onSubmit(d) {
        await post(`/api/cadastros/${c.id}/socios`, { ...d, id: p.id });
        toast('Registro salvo.');
        return true;
      },
    });
  on(box, 'click', '[data-act=partner-new]', async () => (await partnerForm()) && reload());
  on(box, 'click', '[data-partner]', async (e, b) => (await partnerForm(c.partners.find((p) => p.id === Number(b.dataset.partner)))) && reload());
  if (companyContacts) await companyContacts($('#cc', box), c, reload);
}

/* ------------------------- Documentos ------------------------- */

const DOC_STATUS = {
  pendente: ['Pendente', 'warn'],
  recebido: ['Aguardando validação', 'warn'],
  aprovado: ['Aprovado', 'ok'],
  recusado: ['Reprovado', 'danger'],
  vencido: ['Vencido', 'danger'],
};
export const docBadge = (s) => badge(DOC_STATUS[s]?.[0] || s, DOC_STATUS[s]?.[1] || '');
const requiredTypes = (c) => (state.meta.settings.doc_checklist || {})[c.kind] || [];
const oppLabel = (o) => `${o.code}${o.title ? ` — ${o.title}` : ''} (${o.stage_name})`;

/** Caixas para vincular o anexo a uma ou mais vendas (negócios) do cliente. */
function oppChecks(c, selected = []) {
  if (!c.opportunities.length) return html`<div class="field full"><label>Vincular à venda</label><small>Nenhum negócio cadastrado para vincular.</small></div>`;
  return html`<fieldset class="field full"><legend>Vincular à venda <small class="muted">(o mesmo arquivo pode valer para mais de uma)</small></legend>
    ${c.opportunities.map((o) => html`<label class="check"><input type="checkbox" name="opp_${o.id}" ${selected.includes(o.id) ? raw('checked') : ''}> ${oppLabel(o)}</label>`)}</fieldset>`;
}
const pickedOpps = (c, d) => c.opportunities.filter((o) => d[`opp_${o.id}`]).map((o) => o.id);

/**
 * Anexar arquivo. Com doc_type (documento obrigatório): pede só arquivo, venda, validade e observação.
 * Sem doc_type: permite escolher o tipo, exceto os obrigatórios (esses são enviados pela lista de obrigatórios).
 */
export function uploadForm(c, { doc_type } = {}) {
  const req = requiredTypes(c);
  // Sem os obrigatórios (enviados pela lista própria) e sem os tipos exclusivos do outro tipo de pessoa
  const kindFlag = c.kind === 'PJ' ? 'pj' : 'pf';
  const types = opts('tipo_documento').filter((o) => !req.includes(o.value) && (!(o.flags?.pf || o.flags?.pj) || o.flags[kindFlag]));
  return modal({
    title: doc_type ? `Enviar: ${optLabel('tipo_documento', doc_type)}` : 'Anexar arquivo',
    body: html`<div class="grid">
      ${doc_type ? '' : field({ name: 'doc_type', label: 'Tipo de documento', type: 'select', options: types, value: 'outro', allowEmpty: false })}
      <div class="field ${doc_type ? 'full' : ''}"><label>Arquivo <span class="req">*</span></label><input type="file" name="file" required accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt,.odt,.ods"><small>PDF, imagem ou documento, até 8 MB.</small></div>
      ${oppChecks(c, c.opportunities.filter((o) => o.status === 'aberta').map((o) => o.id).slice(0, 1))}
      ${field({ name: 'valid_until', label: 'Validade', type: 'date' })}
      ${field({ name: 'notes', label: 'Observação', type: 'textarea', full: true, rows: 2 })}
    </div>
    <p class="hint">Arquivos anexados pela equipe entram como aprovados. Os enviados pelo cliente, pelo link de cadastro, aguardam a sua validação.</p>`,
    submitLabel: 'Anexar',
    async onSubmit(d, form) {
      const file = form.file.files[0];
      if (!file) throw new Error('Escolha o arquivo.');
      if (file.size > 8 * 1024 * 1024) throw new Error('Arquivo maior que 8 MB.');
      const content_base64 = await fileToBase64(file);
      await post(`/api/cadastros/${c.id}/anexos`, {
        doc_type: doc_type || d.doc_type,
        opportunity_ids: pickedOpps(c, d),
        valid_until: d.valid_until,
        notes: d.notes,
        filename: file.name,
        mime: file.type,
        content_base64,
      });
      toast('Arquivo anexado.');
      return true;
    },
  });
}

/** Abre um anexo (ex.: comprovante de pagamento) em outra aba. */
export async function openAttachmentFile(id) {
  try {
    const { url } = await fileUrl(id);
    window.open(url, '_blank', 'noopener');
  } catch (e) {
    toastError(e);
  }
}

/** Busca o arquivo e devolve uma URL local para exibição (imagem ou PDF) e o próprio arquivo. */
async function fileUrl(id) {
  const res = await fetch(`/api/anexos/${id}`, { headers: { 'X-Requested-With': 'crm' }, credentials: 'same-origin' });
  if (!res.ok) {
    let msg = `Erro ${res.status}`;
    try {
      msg = (await res.json()).error || msg;
    } catch {}
    throw new Error(msg);
  }
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), blob };
}

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    r.readAsDataURL(blob);
  });

/** Verificar o anexo: mostra o arquivo e permite aprovar ou reprovar (com motivo). */
export async function verifyAttachment(c, a, reload) {
  let url = null;
  const w = !ro(c);
  const canReview = w && ['recebido', 'recusado', 'aprovado'].includes(a.status);
  const r = await modal({
    title: `Verificar anexo — ${optLabel('tipo_documento', a.doc_type)}`,
    wide: true,
    body: html`<div class="kv">
        ${kv('Arquivo', a.filename)}${kv('Situação', docBadge(a.status))}
        ${kv('Enviado', html`${fmtDateTime(a.created_at)} · ${a.source === 'cliente' ? 'pelo cliente (link)' : a.uploaded_by_name || '—'}`)}
        ${kv('Validade', a.valid_until ? fmtDate(a.valid_until) : null)}
        ${kv('Vendas vinculadas', a.opportunity_ids.map((id) => c.opportunities.find((o) => o.id === id)?.code).filter(Boolean).join(', ') || null)}
        ${kv('Observação', a.notes)}
        ${a.reviewed_at ? kv('Validado', `${fmtDateTime(a.reviewed_at)} · ${a.reviewed_by_name || '—'}`) : ''}
      </div>
      <div class="file-view"><p class="muted">Carregando arquivo…</p></div>
      ${canReview ? html`<div class="review-box" hidden>${field({ name: 'notes', label: 'Motivo da reprovação', type: 'textarea', full: true, rows: 2 })}</div>` : ''}`,
    submitLabel: 'Aprovar',
    onMount(form, close) {
      const viewBox = $('.file-view', form);
      fileUrl(a.id)
        .then(async ({ url: u, blob }) => {
          url = u;
          const isImg = /^image\//.test(a.mime || '') || /\.(png|jpe?g|webp|gif)$/i.test(a.filename);
          const isPdf = a.mime === 'application/pdf' || /\.pdf$/i.test(a.filename);
          if (isImg) {
            render(viewBox, html`<img src="${await blobToDataUrl(blob)}" alt="${a.filename}">`);
            const img = $('img', viewBox);
            img.addEventListener('error', () => {
              const msg = document.createElement('p');
              msg.className = 'muted';
              msg.textContent = 'Este ambiente bloqueou a pré-visualização. Use "Abrir em nova aba".';
              img.replaceWith(msg);
            });
          }
          else if (isPdf) render(viewBox, html`<iframe src="${u}" title="${a.filename}"></iframe><p class="small muted">Se o PDF não aparecer, use "Abrir em nova aba".</p>`);
          else render(viewBox, html`<p class="muted">Pré-visualização indisponível para este tipo de arquivo.</p>`);
          viewBox.insertAdjacentHTML('beforeend', String(html`<p><a class="btn small" href="${u}" target="_blank" rel="noopener" download="${a.filename}">Abrir em nova aba</a></p>`));
        })
        .catch((e) => render(viewBox, html`<p class="warn-text">${e.message}</p>`));
      if (!canReview) return;
      const foot = form.querySelector('footer');
      const reject = document.createElement('button');
      reject.type = 'button';
      reject.className = 'btn danger';
      reject.textContent = 'Reprovar';
      foot.insertBefore(reject, foot.lastElementChild);
      reject.addEventListener('click', async () => {
        const box = $('.review-box', form);
        if (box.hidden) {
          box.hidden = false;
          form.notes.focus();
          reject.textContent = 'Confirmar reprovação';
          return;
        }
        if (!form.notes.value.trim()) {
          form.notes.focus();
          return;
        }
        try {
          await patch(`/api/anexos/${a.id}`, { status: 'recusado', notes: form.notes.value });
          toast('Documento reprovado.');
          close('changed');
        } catch (e) {
          toastError(e);
        }
      });
    },
    onSubmit:
      canReview && a.status !== 'aprovado'
        ? async () => {
            await patch(`/api/anexos/${a.id}`, { status: 'aprovado' });
            toast('Documento aprovado.');
            return 'changed';
          }
        : undefined,
  });
  if (url) URL.revokeObjectURL(url);
  if (r === 'changed') reload();
}

export async function documentos(box, c, reload) {
  const req = c.sale_checklist.items.filter((i) => i.group === 'Documentos');
  const w = !ro(c);
  const latestOf = (type) => c.attachments.find((a) => a.doc_type === type);
  const waiting = c.attachments.filter((a) => a.status === 'recebido');
  render(box, html`${waiting.length ? html`<div class="alert warn">${waiting.length} arquivo(s) enviado(s) pelo cliente aguardando validação. Clique em "Verificar" para aprovar ou reprovar.</div>` : ''}
    <section class="card">
      <div class="section-head"><h3>Documentos obrigatórios (${c.kind === 'PJ' ? 'pessoa jurídica' : 'pessoa física'})</h3></div>
      ${req.length ? html`<ul class="checklist doc-list">${req.map((i) => {
        const last = latestOf(i.doc_type);
        return html`<li class="${i.ok ? 'ok' : ''}"><span class="mark">${i.ok ? '✓' : '○'}</span> <span class="grow">${i.label}</span> ${docBadge(i.status)}
          ${last ? html`<button class="btn small" data-verify="${last.id}">Verificar</button>` : ''}
          ${w && !i.ok && i.status !== 'recebido' ? html`<button class="btn small primary" data-upload-type="${i.doc_type}">Enviar</button>` : ''}</li>`;
      })}</ul>` : empty('Nenhum documento obrigatório configurado.')}
      <p class="hint">A lista por tipo de pessoa é definida em Configurações › Geral. Só documentos aprovados (e dentro da validade) liberam a venda.</p>
    </section>
    <section class="card"><div class="section-head"><h3>Todos os arquivos</h3>${w ? html`<button class="btn" data-act="upload">+ Anexar arquivo</button>` : ''}</div>
      ${table(
        [
          { label: 'Arquivo', render: (a) => html`<strong>${a.filename}</strong><br><small>${optLabel('tipo_documento', a.doc_type)} · ${a.size < 1024 ? '< 1' : Math.round(a.size / 1024)} KB</small>` },
          { label: 'Situação', render: (a) => html`${docBadge(a.status)}${a.valid_until ? html`<br><small class="${a.valid_until < todayLocal() ? 'overdue' : ''}">Validade: ${fmtDate(a.valid_until)}</small>` : ''}` },
          { label: 'Enviado', render: (a) => html`${fmtDateTime(a.created_at)}<br><small>${a.source === 'cliente' ? 'pelo cliente (link)' : a.uploaded_by_name || '—'}</small>` },
          { label: 'Vendas', render: (a) => a.opportunity_ids.map((id) => c.opportunities.find((o) => o.id === id)?.code).filter(Boolean).join(', ') || '—' },
          { label: 'Observação', render: (a) => a.notes || '—' },
          { label: '', render: (a) => html`<button class="btn small ${a.status === 'recebido' ? 'primary' : ''}" data-verify="${a.id}">Verificar</button>${w ? html` <button class="btn small ghost" data-link-opps="${a.id}">Vendas</button>` : ''}${w && can.manage() ? html` <button class="btn small ghost" data-doc-del="${a.id}">Remover</button>` : ''}` },
        ],
        c.attachments,
        { emptyMsg: 'Nenhum arquivo anexado.' },
      )}
    </section>`);
  on(box, 'click', '[data-act=upload]', async () => (await uploadForm(c)) && reload());
  on(box, 'click', '[data-upload-type]', async (e, b) => (await uploadForm(c, { doc_type: b.dataset.uploadType })) && reload());
  on(box, 'click', '[data-verify]', (e, b) => verifyAttachment(c, c.attachments.find((a) => a.id === Number(b.dataset.verify)), reload).catch(toastError));
  on(box, 'click', '[data-link-opps]', async (e, b) => {
    const a = c.attachments.find((x) => x.id === Number(b.dataset.linkOpps));
    const ok = await modal({
      title: `Vendas do arquivo ${a.filename}`,
      body: oppChecks(c, a.opportunity_ids),
      async onSubmit(d) {
        await patch(`/api/anexos/${a.id}`, { opportunity_ids: pickedOpps(c, d) });
        toast('Vínculos atualizados.');
        return true;
      },
    });
    if (ok) reload();
  });
  on(box, 'click', '[data-doc-del]', async (e, b) => {
    const notes = await modal({ title: 'Remover arquivo', body: field({ name: 'notes', label: 'Motivo da remoção', type: 'textarea', required: true, full: true }), submitLabel: 'Remover', danger: true, onSubmit: (d) => d.notes });
    if (!notes) return;
    await patch(`/api/anexos/${b.dataset.docDel}`, { status: 'removido', notes }).then(() => (toast('Arquivo removido.'), reload())).catch(toastError);
  });
}

/* ------------------------- Pré-venda ------------------------- */

export const pageUrl = (path) => `${location.href.split('#')[0]}#/${path}`;

/** Mostra um link com botão de copiar (a área de transferência pode estar bloqueada: nesse caso o texto é selecionado). */
export function copyBox(url) {
  // Na versão de teste no navegador, o link é aberto na mesma aba (os dados ficam só neste navegador)
  const test = window.CRM_PREVIEW ? html`<a class="btn small primary" href="${url.slice(url.indexOf('#'))}">Testar como cliente</a>` : '';
  return html`<div class="copy-box"><code class="selectable" data-copy-src>${url}</code><button type="button" class="btn small" data-copy>Copiar</button>${test}<span class="small muted copy-msg"></span></div>`;
}
export function bindCopy(root) {
  on(root, 'click', '[data-copy]', async (e, b) => {
    const wrap = b.closest('.copy-box');
    const src = $('[data-copy-src]', wrap);
    const msg = $('.copy-msg', wrap);
    try {
      await navigator.clipboard.writeText(src.textContent);
      msg.textContent = 'Copiado.';
    } catch {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(src);
      sel.removeAllRanges();
      sel.addRange(range);
      msg.textContent = 'Selecionado: use Ctrl+C para copiar.';
    }
  });
}

/** Botão "Link cadastro": mostra o link ativo (sem gerar outro) ou gera um novo quando não houver. */
export async function clientLinkDialog(c, reload) {
  if (c.active === 0) throw new Error('Cadastro inativo: reative o cadastro para gerar o link.');
  let link = c.client_link;
  let created = false;
  if (!link) {
    const ok = await modal({
      title: 'Gerar link de cadastro',
      body: html`<p>O cliente poderá conferir e atualizar cadastro, endereço e documentos obrigatórios. Campos internos (origem, negócio, financeiro) não aparecem para ele. O link vale por ${state.meta.settings.client_link_days} dia(s).</p>`,
      submitLabel: 'Gerar link',
      onSubmit: async () => {
        const r = await post(`/api/cadastros/${c.id}/link-cliente`);
        link = { token: r.token, expires_at: r.expires_at, created_at: new Date().toISOString(), access_count: 0, submissions: 0 };
        return true;
      },
    });
    if (!ok) return;
    created = true;
  }
  await modal({
    title: created ? 'Link de cadastro gerado' : 'Link de cadastro ativo',
    body: html`<p>Envie este link ao cliente. Válido até <strong>${fmtDateTime(link.expires_at)}</strong>.</p>
      ${link.token ? copyBox(pageUrl(`ficha/${link.token}`)) : html`<p class="warn-text">O endereço deste link não está disponível. Revogue-o na aba Pré-venda e gere outro.</p>`}
      <div class="kv">${kv('Acessos', link.access_count || 0)}${kv('Último acesso', link.last_used_at ? fmtDateTime(link.last_used_at) : 'ainda não acessado')}</div>
      <p class="hint">Enquanto este link estiver ativo não é possível gerar outro. Para encerrar o acesso, use "Revogar link" na aba Pré-venda.</p>`,
    onMount: (form) => bindCopy(form),
  });
  reload();
}

const LINK_STATUS = { ativo: ['Ativo', 'ok'], revogado: ['Revogado', 'danger'], expirado: ['Expirado', 'muted'] };

export async function prevenda(box, c, reload) {
  const ck = c.sale_checklist;
  const done = ck.items.filter((i) => i.ok).length;
  const pct = ck.items.length ? Math.round((done / ck.items.length) * 100) : 100;
  const groups = [...new Set(ck.items.map((i) => i.group))];
  const acceptedProp = c.proposals.find((p) => p.status === 'aprovada');
  const link = c.client_link;
  const active = c.active !== 0;
  const w = !ro(c);
  render(box, html`<section class="card presale-hero ${ck.complete ? 'done' : ''}">
      <div class="ring" style="--p:${pct}"><span>${pct}%</span></div>
      <div><h3>${ck.complete ? 'Ficha completa: venda liberada' : `${ck.missing.length} pendência(s) para concluir a venda`}</h3>
        <p class="muted">${done} de ${ck.items.length} itens completos. ${state.meta.settings.require_sale_checklist ? 'A etapa "Venda concluída" só é liberada com a ficha completa.' : 'A exigência está desativada em Configurações.'}</p>
        ${acceptedProp ? html`<p class="small">Proposta ${acceptedProp.code} aceita${acceptedProp.accepted_at ? ` em ${fmtDate(acceptedProp.accepted_at)}` : ''}${acceptedProp.accepted_channel ? ` via ${optLabel('canal_aceite', acceptedProp.accepted_channel)}` : ''}.</p>` : ''}</div>
    </section>
    <div class="presale-grid">${groups.map((g) => {
      const items = ck.items.filter((i) => i.group === g);
      const ok = items.filter((i) => i.ok).length;
      return html`<section class="card presale-group ${ok === items.length ? 'done' : ''}">
        <div class="section-head"><h3>${g}</h3><span class="count ${ok === items.length ? 'ok' : 'warn'}">${ok}/${items.length}</span></div>
        <ul class="presale-items">${items.map((i) => html`<li class="${i.ok ? 'ok' : 'miss'}"><span class="mark">${i.ok ? '✓' : '!'}</span><span class="grow">${i.label}${i.status && !i.ok ? html` ${docBadge(i.status)}` : ''}</span>${i.ok ? '' : html`<a href="#" data-tab="${i.tab}" class="small">completar</a>`}</li>`)}</ul>
      </section>`;
    })}</div>
    <section class="card">
      <div class="section-head"><h3>Link de cadastro para o cliente</h3>
        ${w && active ? (link ? html`<span class="inline-actions"><button class="btn ghost" data-act="revoke-links">Revogar link</button></span>` : html`<button class="btn primary" data-act="client-link">Gerar link</button>`) : ''}</div>
      ${!active ? html`<div class="alert warn">Cadastro inativo: o link foi revogado e não é possível gerar outro até reativar o cadastro.</div>` : ''}
      ${link
        ? html`${link.token ? copyBox(pageUrl(`ficha/${link.token}`)) : ''}
          <div class="link-stats">
            <div><span>Gerado</span><strong>${fmtDateTime(link.created_at)}</strong><small>${link.created_by_name || '—'}</small></div>
            <div><span>Válido até</span><strong>${fmtDateTime(link.expires_at)}</strong><small>${relTime(link.expires_at)}</small></div>
            <div><span>Primeiro acesso</span><strong>${link.first_used_at ? fmtDateTime(link.first_used_at) : 'Não acessado'}</strong></div>
            <div><span>Último acesso</span><strong>${link.last_used_at ? fmtDateTime(link.last_used_at) : '—'}</strong><small>${link.last_used_at ? relTime(link.last_used_at) : ''}</small></div>
            <div><span>Acessos</span><strong>${link.access_count || 0}</strong></div>
            <div><span>Envios de dados</span><strong>${link.submissions || 0}</strong></div>
          </div>`
        : active ? html`<p class="muted">Nenhum link ativo. Gere um link para o cliente conferir e completar cadastro, endereço e documentos; a equipe recebe uma tarefa para conferir o que ele enviar.</p>` : ''}
      ${c.client_links.length ? html`<details ${link ? '' : raw('open')}><summary>Histórico de links (${c.client_links.length})</summary>${table(
        [
          { label: 'Gerado', render: (l) => html`${fmtDateTime(l.created_at)}<br><small>${l.created_by_name || '—'}</small>` },
          { label: 'Situação', render: (l) => badge(LINK_STATUS[l.status][0], LINK_STATUS[l.status][1]) },
          { label: 'Primeiro acesso', render: (l) => (l.first_used_at ? fmtDateTime(l.first_used_at) : 'não acessado') },
          { label: 'Último acesso', render: (l) => (l.last_used_at ? fmtDateTime(l.last_used_at) : '—') },
          { label: 'Acessos / envios', render: (l) => `${l.access_count || 0} / ${l.submissions || 0}` },
          { label: 'Encerramento', render: (l) => (l.revoked_at ? html`${fmtDateTime(l.revoked_at)}<br><small>${[l.revoked_by_name, l.revoke_reason].filter(Boolean).join(' · ') || '—'}</small>` : l.status === 'expirado' ? `expirou em ${fmtDateTime(l.expires_at)}` : '—') },
        ],
        c.client_links,
      )}</details>` : ''}
    </section>`);
  bindCopy(box);
  on(box, 'click', '[data-act=client-link]', () => clientLinkDialog(c, reload).catch(toastError));
  on(box, 'click', '[data-act=revoke-links]', async () => {
    const ok = await modal({
      title: 'Revogar link de cadastro',
      body: html`<p>O link enviado ao cliente deixa de funcionar imediatamente. Depois disso é possível gerar um novo link.</p>${field({ name: 'reason', label: 'Motivo (opcional)', type: 'textarea', full: true, rows: 2 })}`,
      submitLabel: 'Revogar',
      danger: true,
      onSubmit: (d) => post(`/api/cadastros/${c.id}/link-cliente/revogar`, { reason: d.reason }),
    });
    if (ok) {
      toast('Link revogado.');
      reload();
    }
  });
}

/* ------------------------- Pós-venda ------------------------- */

const NPS_STATUS = { pendente: ['Aguardando resposta', 'warn'], respondida: ['Respondida', 'ok'], expirada: ['Expirada', 'muted'], cancelada: ['Cancelada', 'danger'] };
export const npsCategory = (n) => (n >= 9 ? ['Promotor', 'ok'] : n >= 7 ? ['Neutro', 'warn'] : ['Detrator', 'danger']);
export const NPS_ANSWER_LABELS = { atendimento: 'Atendimento do consultor', clareza: 'Clareza das informações', agilidade: 'Agilidade da contratação', confianca: 'Confiança na empresa' };
const BID_TYPES = { embutido: 'Embutido', fixo: 'Fixo', livre: 'Livre' };

/** Histórico das estratégias de lance de uma carta: o que foi definido, por quem, data e hora. */
export function bidHistoryList(history) {
  return html`<details class="bid-history"><summary>Histórico (${history.length})</summary><ol>${history.map((h) => html`<li><strong>${bidSummary(h)}</strong><br><small class="muted">${fmtDateTime(h.created_at)} · ${h.created_by_name || '—'}${h.notes ? ` · ${h.notes}` : ''}</small></li>`)}</ol></details>`;
}

export function bidSummary(b) {
  if (!b) return html`<span class="muted">Estratégia não cadastrada</span>`;
  if (!b.will_bid) return html`${badge('Sem lance', 'muted')}`;
  return html`${badge(`Lance ${BID_TYPES[b.bid_type].toLowerCase()}`, 'ok')}${b.bid_type === 'livre' ? html` <strong>${String(b.bid_pct).replace('.', ',')}%</strong> do crédito${b.use_embedded ? ' · usa embutido' : ''}${b.use_fgts ? ' · usa FGTS' : ''}` : ''}`;
}

export function bidForm(k, b = {}) {
  return modal({
    title: `Estratégia de lance — ${k.code}`,
    body: html`<div class="kv">
        ${kv('Categoria', catLabel(k))}${kv('Administradora', k.administrator)}
        ${kv('Grupo / cota', `${k.group_code || '—'} / ${k.quota_code || '—'}`)}${kv('Crédito', fmtMoney(k.credit_value))}
      </div>
      <div class="grid">
        <fieldset class="field full"><legend>Vai ofertar lance?</legend>
          <label class="check"><input type="radio" name="will_bid" value="sim" ${b.will_bid ? raw('checked') : ''}> Sim</label>
          <label class="check"><input type="radio" name="will_bid" value="nao" ${b.id && !b.will_bid ? raw('checked') : ''}> Não, aguardar sorteio</label>
        </fieldset>
        <div class="bid-on full" ${b.will_bid ? '' : raw('hidden')}><div class="grid">
          ${field({ name: 'bid_type', label: 'Tipo de lance', type: 'select', options: Object.entries(BID_TYPES).map(([value, label]) => ({ value, label })), value: b.bid_type })}
          <div class="bid-free" ${b.bid_type === 'livre' ? '' : raw('hidden')}>${field({ name: 'bid_pct', label: 'Percentual do lance livre (% do crédito)', type: 'number', value: b.bid_pct, min: 0, step: '0.01' })}</div>
          <div class="bid-free full" ${b.bid_type === 'livre' ? '' : raw('hidden')}>
            ${field({ name: 'use_embedded', label: 'Vai usar lance embutido', type: 'checkbox', value: !!b.use_embedded })}
            ${field({ name: 'use_fgts', label: 'Vai usar FGTS', type: 'checkbox', value: !!b.use_fgts })}
          </div>
        </div></div>
        ${field({ name: 'notes', label: 'Observações', type: 'textarea', value: b.notes, full: true, rows: 2 })}
      </div>`,
    onMount(form) {
      const sync = () => {
        const yes = form.querySelector('input[name=will_bid]:checked')?.value === 'sim';
        $('.bid-on', form).hidden = !yes;
        form.querySelectorAll('.bid-free').forEach((el) => (el.hidden = !(yes && form.bid_type.value === 'livre')));
      };
      form.addEventListener('change', sync);
    },
    async onSubmit(d) {
      if (!d.will_bid) throw new Error('Informe se o cliente vai ofertar lance.');
      await post(`/api/contratos/${k.id}/estrategia-lance`, { ...d, will_bid: d.will_bid === 'sim' });
      toast('Estratégia de lance salva.');
      return true;
    },
  });
}

export async function posvenda(box, c, reload) {
  const w = !ro(c);
  const pending = c.nps_surveys.find((n) => n.status === 'pendente');
  const last = c.nps_surveys.find((n) => n.status === 'respondida');
  const bidOf = (k) => c.bid_strategies.find((b) => b.contract_id === k.id);
  render(box, html`<div class="cols">
    <section class="card"><h3>Funil de pós-venda</h3>
      ${c.relationship !== 'cliente' ? html`<p class="hint">Começa na confirmação da venda (cota alocada).</p>` : ''}
      <div data-tl>${timelineList(c.post_sale, { w: w && c.relationship === 'cliente' })}</div>
      <p class="hint">Prazos D+N a partir da confirmação da venda. A 1ª parcela é marcada pelo comprovante, a estratégia de lance ao salvá-la e o NPS quando o cliente responde; a indicação só é pedida para promotores.</p>
    </section>
    <section class="card"><div class="section-head"><h3>Pesquisa de satisfação (NPS)</h3>
        ${w && c.active !== 0 && !pending ? html`<button class="btn primary" data-act="nps-new">Gerar link da pesquisa</button>` : ''}</div>
      ${last ? html`<div class="nps-last"><div class="nps-score ${npsCategory(last.score)[1]}">${last.score}</div><div><strong>${npsCategory(last.score)[0]}</strong> · respondida em ${fmtDate(last.answered_at)}${last.comment ? html`<br><em>"${last.comment}"</em>` : ''}</div></div>` : html`<p class="muted">Nenhuma pesquisa respondida ainda.</p>`}
      ${pending ? html`<div class="alert">Pesquisa ${pending.code} aguardando resposta até ${fmtDateTime(pending.expires_at)}. ${pending.first_access_at ? `Aberta pelo cliente em ${fmtDateTime(pending.first_access_at)}.` : 'Ainda não aberta pelo cliente.'}</div>${pending.token ? copyBox(pageUrl(`nps/${pending.token}`)) : ''}` : ''}
      <p class="hint">O cliente responde a nota de 0 a 10 e avalia atendimento, clareza, agilidade e confiança. Notas de 0 a 6 criam uma tarefa de pós-venda para o responsável. Pesquisas não são excluídas: apenas canceladas, com justificativa.</p>
    </section>
  </div>
  <section class="card"><h3>Histórico de pesquisas</h3>${table(
    [
      { label: 'Pesquisa', render: (n) => html`<strong>${n.code}</strong>${n.contract_code ? html`<br><small>${n.contract_code}</small>` : ''}` },
      { label: 'Gerada', render: (n) => html`${fmtDateTime(n.created_at)}<br><small>${n.created_by_name || '—'}</small>` },
      { label: 'Situação', render: (n) => badge(NPS_STATUS[n.status][0], NPS_STATUS[n.status][1]) },
      { label: 'Acesso do cliente', render: (n) => (n.first_access_at ? html`${fmtDateTime(n.first_access_at)}${n.last_access_at && n.last_access_at !== n.first_access_at ? html`<br><small>último: ${fmtDateTime(n.last_access_at)}</small>` : ''}` : 'não acessada') },
      { label: 'Resposta', render: (n) => (n.status === 'respondida' ? html`${badge(`Nota ${n.score}`, npsCategory(n.score)[1])} <small>${fmtDateTime(n.answered_at)}</small>${n.answers ? html`<br><small>${Object.entries(n.answers).map(([k, v]) => `${NPS_ANSWER_LABELS[k] || k}: ${v}/5`).join(' · ')}</small>` : ''}${n.comment ? html`<br><small><em>${n.comment}</em></small>` : ''}` : n.status === 'cancelada' ? html`<small>${fmtDateTime(n.cancelled_at)} · ${n.cancelled_by_name || '—'}<br>${n.cancel_reason}</small>` : '—') },
      { label: '', render: (n) => (w && n.status === 'pendente' ? html`<button class="btn small ghost" data-nps-cancel="${n.id}">Cancelar</button>` : '') },
    ],
    c.nps_surveys,
    { emptyMsg: 'Nenhuma pesquisa gerada.' },
  )}</section>
  <section class="card"><h3>Estratégias de lance por produto</h3>
    ${c.contracts.length ? html`<div class="bid-grid">${c.contracts.map((k) => {
      const b = bidOf(k);
      return html`<div class="card inner">
        <div class="section-head"><strong>${k.sale_code ? `${k.sale_code} · ` : ''}${k.code}${k.contract_number ? ` · nº ${k.contract_number}` : ''}</strong>${w ? html`<button class="btn small" data-bid="${k.id}">${b ? 'Editar' : 'Cadastrar'} estratégia</button>` : ''}</div>
        <div class="kv">${kv('Categoria', catLabel(k))}${kv('Administradora', k.administrator)}${kv('Grupo / cota', `${k.group_code || '—'} / ${k.quota_code || '—'}`)}${kv('Crédito', fmtMoney(k.credit_value))}</div>
        <p>${bidSummary(b)}</p>
        ${b ? html`<p class="small muted">Atualizada em ${fmtDateTime(b.updated_at)} · ${b.updated_by_name || '—'}${b.notes ? ` · ${b.notes}` : ''}</p>` : ''}
        ${b?.history?.length ? bidHistoryList(b.history) : ''}
      </div>`;
    })}</div>` : empty('Nenhum produto contratado. A estratégia de lance é cadastrada para cada produto depois da venda.')}
  </section>
  <section class="card"><h3>Indicações</h3>
    ${c.referrals.length ? html`<ul class="opp-list">${c.referrals.map((r) => html`<li><a href="#/leads/${r.id}">${r.code} — ${r.name}</a> <small class="muted">${fmtDate(r.created_at)}</small></li>`)}</ul>` : empty('Este cliente ainda não indicou ninguém. Registre o "Indicado por" no cadastro do novo lead.')}
  </section>`);
  bindCopy(box);
  bindTimeline(box, c.id, () => c.post_sale, reload);
  on(box, 'click', '[data-act=nps-new]', async () => {
    let r = null;
    const ok = await modal({
      title: 'Gerar pesquisa de satisfação',
      body: html`<p>O cliente recebe um link para responder a pesquisa (válido por ${state.meta.settings.nps_link_days} dias).</p>
        ${c.contracts.length ? field({ name: 'contract_id', label: 'Produto avaliado (opcional)', type: 'select', options: c.contracts.map((k) => ({ value: k.id, label: `${k.code} — ${catLabel(k)}` })), placeholder: 'Atendimento em geral', full: true }) : ''}`,
      submitLabel: 'Gerar link',
      onSubmit: async (d) => {
        r = await post(`/api/cadastros/${c.id}/nps`, d);
        return true;
      },
    });
    if (!ok) return;
    await modal({ title: `Pesquisa ${r.code} gerada`, body: html`<p>Envie este link ao cliente:</p>${copyBox(pageUrl(`nps/${r.token}`))}`, onMount: (form) => bindCopy(form) });
    reload();
  });
  on(box, 'click', '[data-nps-cancel]', async (e, b) => {
    const ok = await modal({
      title: 'Cancelar pesquisa',
      body: html`<p>A pesquisa continua no histórico, marcada como cancelada, e o link deixa de funcionar.</p>${field({ name: 'reason', label: 'Justificativa do cancelamento', type: 'textarea', required: true, full: true })}`,
      submitLabel: 'Cancelar pesquisa',
      cancelLabel: 'Voltar',
      danger: true,
      onSubmit: (d) => post(`/api/nps/${b.dataset.npsCancel}/cancelar`, d),
    });
    if (ok) {
      toast('Pesquisa cancelada.');
      reload();
    }
  });
  on(box, 'click', '[data-bid]', async (e, b) => {
    const k = c.contracts.find((x) => x.id === Number(b.dataset.bid));
    if (await bidForm(k, bidOf(k) || {})) reload();
  });
}

/* ------------------------- Produtos contratados: gerar parcelas ------------------------- */
export { contractForm };
