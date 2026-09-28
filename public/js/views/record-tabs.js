// Abas da ficha do lead/cliente: Origem, Endereço, Negócio, Financeiro, Relacionamentos, Documentos, Pré-venda e Pós-venda.
import { get, post, patch, download } from '../api.js';
import {
  html, raw, render, $, on, state, field, formData, opts, userItems, table, badge, optLabel, K, fmtDate, fmtDateTime, fmtMoney, relTime,
  modal, toast, toastError, can, empty,
} from '../ui.js';
import { opportunityForm, contractForm } from '../forms.js';

const ro = (c) => !can.write() || !!c.anonymized_at;

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
        ${field({ name: 'temperature', label: 'Temperatura do lead', type: 'select', options: opts('temperatura'), value: c.temperature })}
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

function addressForm(c, a = {}) {
  return modal({
    title: a.id ? 'Editar endereço' : 'Novo endereço',
    wide: true,
    body: html`<div class="grid three">
      <div class="field"><label>CEP</label><div class="inline-actions"><input name="cep" value="${a.cep || ''}" inputmode="numeric" placeholder="00000-000" style="flex:1"><button type="button" class="btn small" data-act="cep">Buscar</button></div><small class="cep-msg">Digite o CEP e clique em Buscar para preencher o endereço.</small></div>
      ${field({ name: 'type', label: 'Tipo', type: 'select', options: opts('tipo_endereco'), value: a.type || 'residencial', allowEmpty: false })}
      ${field({ name: 'is_primary', label: 'Endereço principal', type: 'checkbox', value: a.id ? !!a.is_primary : !c.addresses.length })}
      ${field({ name: 'street', label: 'Logradouro', value: a.street, full: true })}
      ${field({ name: 'number', label: 'Número', value: a.number })}
      ${field({ name: 'complement', label: 'Complemento', value: a.complement })}
      ${field({ name: 'district', label: 'Bairro', value: a.district })}
      ${field({ name: 'city', label: 'Cidade', value: a.city })}
      ${field({ name: 'state', label: 'Estado (UF)', value: a.state, maxlength: 2 })}
      <input type="hidden" name="ibge" value="${a.ibge || ''}">
    </div>`,
    onMount(form) {
      const lookup = async () => {
        const msg = $('.cep-msg', form);
        const cep = form.cep.value.replace(/\D/g, '');
        if (cep.length !== 8) {
          msg.textContent = 'O CEP deve ter 8 dígitos.';
          return;
        }
        msg.textContent = 'Buscando…';
        try {
          const r = await get(`/api/cep/${cep}`);
          for (const f of ['street', 'district', 'city', 'state', 'ibge']) if (r[f]) form[f].value = r[f];
          if (r.complement && !form.complement.value) form.complement.value = r.complement;
          msg.textContent = 'Endereço encontrado. Confira e informe o número.';
          form.number.focus();
        } catch (e) {
          msg.textContent = e.message;
        }
      };
      on(form, 'click', '[data-act=cep]', lookup);
      form.cep.addEventListener('blur', () => form.cep.value.replace(/\D/g, '').length === 8 && !form.street.value && lookup());
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
    <p class="hint">A busca por CEP preenche logradouro, bairro, cidade e UF. O endereço principal define a cidade e a UF exibidas nas listas.</p>
    ${c.addresses.length
      ? html`<div class="cols">${c.addresses.map((a) => html`<div class="card inner">
          <div class="section-head"><strong>${optLabel('tipo_endereco', a.type)}</strong>${a.is_primary ? badge('Principal', 'ok') : ''}</div>
          <p>${[a.street, a.number].filter(Boolean).join(', ') || '—'}${a.complement ? ` — ${a.complement}` : ''}<br>${[a.district, a.city, a.state].filter(Boolean).join(' · ')}<br><span class="muted">CEP ${a.cep ? `${a.cep.slice(0, 5)}-${a.cep.slice(5)}` : '—'}</span></p>
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
  const r1 = (o) => html`<div class="kv">
    ${kv('(R1) Objetivo', optLabel('objetivo', o.objective_type))}
    ${kv('(R1) Produto', optLabel('tipo_produto', o.product_type))}
    ${kv('Categoria', optLabel('categoria_credito', o.credit_category))}
    ${kv('(R1) Crédito desejado', html`${fmtMoney(o.credit_value)}${o.credit_purpose ? html`<br><small>${o.credit_purpose}</small>` : ''}`)}
    ${kv('(R1) Prazo objetivo', optLabel('urgencia', o.urgency))}
    ${kv('(R1) Momento financeiro', optLabel('momento_financeiro', o.financial_moment))}
    ${kv('(R1) Capacidade de parcela', o.installment_max ? fmtMoney(o.installment_max) : null)}
    ${kv('Tipo de contratação', optLabel('tipo_contratacao', o.employment_type))}
    ${kv('(R1) Capital/reserva para lance', o.bid_own_resources != null ? fmtMoney(o.bid_own_resources) : null)}
    ${c.kind === 'PF' ? kv('(R1) FGTS', html`${optLabel('possui_fgts', o.has_fgts)}${o.fgts_available ? ` · ${fmtMoney(o.fgts_available)}` : ''}`) : ''}
    ${kv('Quem decide a compra', optLabel('decisor', o.decision_maker))}
    ${kv('Já possui', html`${optLabel('possui_produto', o.existing_products)}${['consorcio', 'ambos'].includes(o.existing_products) ? html`<br><small>Consórcio: ${fmtMoney(o.existing_consortium_value)} · ${o.existing_consortium_admin || 'administradora não informada'}</small>` : ''}${['financiamento', 'ambos'].includes(o.existing_products) ? html`<br><small>Financiamento: saldo ${fmtMoney(o.existing_financing_balance)} · CET ${o.existing_financing_cet != null ? `${o.existing_financing_cet}% a.a.` : '—'} · ${o.existing_financing_bank || 'banco não informado'}</small>` : ''}`)}
  </div>`;
  render(box, html`<section class="card">
    <div class="section-head"><h3>Negócios</h3>${ro(c) ? '' : html`<button class="btn" data-act="opp">+ Novo negócio</button>`}</div>
    <p class="hint">Preencha a qualificação a partir da R1 (ligação ou WhatsApp). Cada negócio segue o funil com sua própria etapa e próxima ação.</p>
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
        ${field({ name: 'paid_at', label: 'Data do pagamento', type: 'date', value: new Date().toISOString().slice(0, 10), required: true })}
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

const DOC_STATUS = { pendente: ['Pendente', 'warn'], recebido: ['Recebido', ''], aprovado: ['Aprovado', 'ok'], recusado: ['Recusado', 'danger'] };
const docBadge = (s) => badge(DOC_STATUS[s]?.[0] || s, DOC_STATUS[s]?.[1] || '');

export function uploadForm(c, { doc_type, proposal_id, contract_id } = {}) {
  return modal({
    title: 'Anexar arquivo',
    body: html`<div class="grid">
      ${field({ name: 'doc_type', label: 'Tipo de documento', type: 'select', options: opts('tipo_documento'), value: doc_type || 'outro', allowEmpty: false })}
      <div class="field"><label>Arquivo (PDF, imagem ou documento, até 8 MB)</label><input type="file" name="file" required accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt,.odt,.ods"></div>
      ${!proposal_id && c.proposals?.length ? field({ name: 'proposal_id', label: 'Vincular à proposta', type: 'select', options: c.proposals.map((p) => ({ value: p.id, label: `${p.code} v${p.version}` })), placeholder: 'Nenhuma' }) : ''}
      ${!contract_id && c.contracts?.length ? field({ name: 'contract_id', label: 'Vincular ao contrato', type: 'select', options: c.contracts.map((k) => ({ value: k.id, label: k.code })), placeholder: 'Nenhum' }) : ''}
      ${field({ name: 'valid_until', label: 'Validade (se houver)', type: 'date' })}
      ${field({ name: 'notes', label: 'Observações', type: 'textarea', full: true })}
    </div>`,
    submitLabel: 'Anexar',
    async onSubmit(d, form) {
      const file = form.file.files[0];
      if (!file) throw new Error('Escolha um arquivo.');
      if (file.size > 8 * 1024 * 1024) throw new Error('Arquivo maior que 8 MB.');
      const content_base64 = await fileToBase64(file);
      delete d.file;
      await post(`/api/cadastros/${c.id}/anexos`, { ...d, proposal_id: d.proposal_id || proposal_id, contract_id: d.contract_id || contract_id, filename: file.name, mime: file.type, content_base64 });
      toast('Arquivo anexado.');
      return true;
    },
  });
}

export async function documentos(box, c, reload) {
  const req = c.sale_checklist.items.filter((i) => i.group === 'Documentos');
  const w = !ro(c);
  render(box, html`<section class="card">
      <div class="section-head"><h3>Documentos obrigatórios para a venda (${c.kind})</h3>${w ? html`<button class="btn primary" data-act="upload">+ Anexar arquivo</button>` : ''}</div>
      ${req.length ? html`<ul class="checklist">${req.map((i) => html`<li class="${i.ok ? 'ok' : ''}"><span class="mark">${i.ok ? '✓' : '○'}</span> ${i.label} ${docBadge(i.status)} ${w && !i.ok ? html`<button class="btn small" data-upload-type="${i.key.slice(4)}">Enviar</button>` : ''}</li>`)}</ul>` : empty('Nenhum documento obrigatório configurado.')}
      <p class="hint">A lista de documentos por tipo de pessoa é definida em Configurações › Geral. Arquivos enviados pelo cliente pelo link chegam como "Recebido" para conferência.</p>
    </section>
    <section class="card"><h3>Todos os arquivos</h3>
      ${table(
        [
          { label: 'Arquivo', render: (a) => html`<strong>${a.filename}</strong><br><small>${optLabel('tipo_documento', a.doc_type)} · ${(a.size / 1024).toFixed(0)} KB</small>` },
          { label: 'Situação', render: (a) => html`${docBadge(a.status)}${a.valid_until ? html`<br><small class="${a.valid_until < new Date().toISOString().slice(0, 10) ? 'overdue' : ''}">Validade: ${fmtDate(a.valid_until)}</small>` : ''}` },
          { label: 'Enviado', render: (a) => html`${fmtDateTime(a.created_at)}<br><small>${a.source === 'cliente' ? 'pelo cliente (link)' : a.uploaded_by_name || '—'}</small>` },
          { label: 'Vínculo', render: (a) => [a.proposal_id && c.proposals.find((p) => p.id === a.proposal_id)?.code, a.contract_id && c.contracts.find((k) => k.id === a.contract_id)?.code].filter(Boolean).join(' · ') || '—' },
          { label: 'Observações', render: (a) => a.notes || '—' },
          {
            label: '',
            render: (a) => html`<button class="btn small" data-dl="${a.id}">Baixar</button>${w ? html` <button class="btn small ghost" data-doc-ok="${a.id}">Aprovar</button> <button class="btn small ghost" data-doc-no="${a.id}">Recusar</button>${can.manage() ? html` <button class="btn small ghost" data-doc-del="${a.id}">Remover</button>` : ''}` : ''}`,
          },
        ],
        c.attachments,
        { emptyMsg: 'Nenhum arquivo anexado.' },
      )}
    </section>`);
  on(box, 'click', '[data-act=upload]', async () => (await uploadForm(c)) && reload());
  on(box, 'click', '[data-upload-type]', async (e, b) => (await uploadForm(c, { doc_type: b.dataset.uploadType })) && reload());
  on(box, 'click', '[data-dl]', (e, b) => download(`/api/anexos/${b.dataset.dl}`).catch(toastError));
  const review = async (id, status, withNote) => {
    let notes;
    if (withNote) {
      notes = await modal({ title: status === 'recusado' ? 'Recusar documento' : 'Remover arquivo', body: field({ name: 'notes', label: status === 'recusado' ? 'Motivo (será exibido na ficha)' : 'Motivo da remoção', type: 'textarea', required: true, full: true }), submitLabel: 'Confirmar', danger: status === 'removido', onSubmit: (d) => d.notes });
      if (!notes) return;
    }
    await patch(`/api/anexos/${id}`, { status, ...(notes ? { notes } : {}) });
    toast('Documento atualizado.');
    reload();
  };
  on(box, 'click', '[data-doc-ok]', (e, b) => review(b.dataset.docOk, 'aprovado').catch(toastError));
  on(box, 'click', '[data-doc-no]', (e, b) => review(b.dataset.docNo, 'recusado', true).catch(toastError));
  on(box, 'click', '[data-doc-del]', (e, b) => review(b.dataset.docDel, 'removido', true).catch(toastError));
}

/* ------------------------- Pré-venda ------------------------- */

export async function clientLinkDialog(c, reload) {
  const r = await post(`/api/cadastros/${c.id}/link-cliente`);
  const url = `${location.href.split('#')[0]}#/ficha/${r.token}`;
  await modal({
    title: 'Link para o cliente atualizar os dados',
    body: html`<p>Envie este link ao cliente. Ele poderá atualizar cadastro, endereço e enviar documentos até <strong>${fmtDateTime(r.expires_at)}</strong>. Campos internos (origem, negócio, financeiro) não aparecem para ele.</p>
      <pre class="code selectable" id="link-url">${url}</pre>
      <p class="inline-actions"><button type="button" class="btn small" data-act="copy">Copiar link</button><span class="small muted copy-msg"></span></p>
      <p class="hint">Um link novo não invalida os anteriores. Use "Revogar links" na aba Pré-venda para encerrar o acesso.</p>`,
    onMount(form) {
      on(form, 'click', '[data-act=copy]', async () => {
        try {
          await navigator.clipboard.writeText(url);
          $('.copy-msg', form).textContent = 'Copiado.';
        } catch {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents($('#link-url', form));
          sel.removeAllRanges();
          sel.addRange(range);
          $('.copy-msg', form).textContent = 'Selecionado: use Ctrl+C para copiar.';
        }
      });
    },
  });
  reload();
}

export async function prevenda(box, c, reload) {
  const ck = c.sale_checklist;
  const done = ck.items.filter((i) => i.ok).length;
  const groups = [...new Set(ck.items.map((i) => i.group))];
  const acceptedProp = c.proposals.find((p) => p.status === 'aprovada');
  render(box, html`<section class="card">
      <div class="section-head"><h3>Ficha de pré-venda</h3>${ck.complete ? badge('Completa: venda liberada', 'ok') : badge(`${ck.missing.length} pendência(s)`, 'warn')}</div>
      <p class="hint">Dados e documentos obrigatórios para concluir a venda. ${state.meta.settings.require_sale_checklist ? 'A etapa "Venda concluída" só é liberada com a ficha completa.' : 'A exigência está desativada em Configurações, então a venda pode ser concluída mesmo com pendências.'}</p>
      ${acceptedProp ? html`<div class="alert">Proposta ${acceptedProp.code} aceita${acceptedProp.accepted_at ? ` em ${fmtDate(acceptedProp.accepted_at)}` : ''}${acceptedProp.accepted_channel ? ` via ${optLabel('canal_aceite', acceptedProp.accepted_channel)}` : ''}. Complete a ficha abaixo para concluir a venda.</div>` : ''}
      <div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${ck.items.length}" aria-valuenow="${done}"><span style="width:${ck.items.length ? (done / ck.items.length) * 100 : 100}%"></span></div>
      <p class="small muted">${done} de ${ck.items.length} itens completos</p>
      <div class="cols">${groups.map((g) => html`<div><h4>${g}</h4><ul class="checklist">${ck.items.filter((i) => i.group === g).map((i) => html`<li class="${i.ok ? 'ok' : ''}"><span class="mark">${i.ok ? '✓' : '○'}</span> ${i.label} ${i.ok ? '' : html`<a href="#/leads/${c.id}/${i.tab}" data-tab="${i.tab}" class="small">completar</a>`}</li>`)}</ul></div>`)}</div>
    </section>
    <section class="card">
      <div class="section-head"><h3>Link para o cliente completar os dados</h3>${ro(c) ? '' : html`<span class="inline-actions"><button class="btn" data-act="client-link">Gerar link</button>${c.client_link ? html`<button class="btn ghost" data-act="revoke-links">Revogar links</button>` : ''}</span>`}</div>
      ${c.client_link ? html`<p>Link ativo criado em ${fmtDateTime(c.client_link.created_at)}, válido até ${fmtDateTime(c.client_link.expires_at)}. ${c.client_link.last_used_at ? `Último acesso: ${relTime(c.client_link.last_used_at)} · ${c.client_link.submissions} envio(s).` : 'Ainda não acessado.'}</p>` : html`<p class="muted">Nenhum link ativo. O cliente atualiza só os dados externos (cadastro, endereço e documentos); a equipe recebe uma tarefa para conferir.</p>`}
    </section>`);
  on(box, 'click', '[data-act=client-link]', () => clientLinkDialog(c, reload).catch(toastError));
  on(box, 'click', '[data-act=revoke-links]', async () => {
    const ok = await modal({ title: 'Revogar links', body: html`<p>Os links enviados ao cliente deixarão de funcionar imediatamente.</p>`, submitLabel: 'Revogar', danger: true, onSubmit: () => true });
    if (ok) post(`/api/cadastros/${c.id}/link-cliente/revogar`).then(() => (toast('Links revogados.'), reload())).catch(toastError);
  });
}

/* ------------------------- Pós-venda ------------------------- */

export async function posvenda(box, c, reload) {
  const w = !ro(c);
  render(box, html`<div class="cols">
    <section class="card"><h3>Checklist de pós-venda</h3>
      ${c.relationship !== 'cliente' ? html`<p class="hint">Aplicável depois da venda concluída.</p>` : ''}
      <ul class="checklist">${c.post_sale.map((p) => html`<li class="${p.done_at ? 'ok' : ''}"><label class="check"><input type="checkbox" data-ps="${p.item}" ${p.done_at ? raw('checked') : ''} ${w ? '' : raw('disabled')}> ${p.label}</label>
        ${p.done_at ? html`<small class="muted">${fmtDate(p.done_at)} · ${p.done_by_name || '—'}${p.notes ? ` · ${p.notes}` : ''}</small>` : ''}</li>`)}</ul>
      <p class="hint">As etapas são configuráveis em Configurações › Listas › Etapas do pós-venda.</p>
    </section>
    <form class="card" id="nps"><h3>Satisfação (NPS)</h3>
      <fieldset ${w ? '' : raw('disabled')}><div class="grid">
        ${field({ name: 'nps_score', label: 'Nota de 0 a 10', type: 'number', value: c.nps_score, min: 0, step: 1, help: '0 a 6 detrator · 7 e 8 neutro · 9 e 10 promotor' })}
        <div class="field"><label>Registrado em</label><input value="${c.nps_at ? fmtDateTime(c.nps_at) : '—'}" disabled></div>
        ${field({ name: 'nps_comment', label: 'Comentário do cliente', type: 'textarea', value: c.nps_comment, full: true })}
      </div>${w ? html`<div class="form-actions"><button class="btn primary" type="submit">Salvar NPS</button></div>` : ''}</fieldset>
      <p class="hint">Link de pesquisa NPS para o cliente responder: integração pendente (planejada).</p>
    </form>
  </div>
  <section class="card"><h3>Indicações</h3>
    ${c.referrals.length ? html`<ul class="opp-list">${c.referrals.map((r) => html`<li><a href="#/leads/${r.id}">${r.code} — ${r.name}</a> <small class="muted">${fmtDate(r.created_at)}</small></li>`)}</ul>` : empty('Este cliente ainda não indicou ninguém. Registre o "Indicado por" no cadastro do novo lead.')}
  </section>`);
  on(box, 'change', '[data-ps]', async (e, cb) => {
    try {
      await post(`/api/cadastros/${c.id}/pos-venda`, { item: cb.dataset.ps, done: cb.checked });
      reload();
    } catch (ex) {
      cb.checked = !cb.checked;
      toastError(ex);
    }
  });
  $('#nps', box).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await patch(`/api/cadastros/${c.id}`, formData(e.target));
      toast('NPS registrado.');
      reload();
    } catch (ex) {
      toastError(ex);
    }
  });
}

/* ------------------------- Produtos contratados: gerar parcelas ------------------------- */
export { contractForm };
