// Página aberta pelo cliente (sem login) para atualizar os dados externos: cadastro, endereço e documentos.
import { get, post } from '../api.js';
import { html, raw, render, $, on, field, formData, toast, toastError, fmtDateTime } from '../ui.js';
import { fileToBase64 } from './record-tabs.js';

const LABELS = {
  name: 'Nome completo', doc: 'CPF', rg: 'RG', phone1: 'Telefone 1', phone2: 'Telefone 2', whatsapp: 'WhatsApp', email: 'E-mail',
  birthplace: 'Naturalidade (cidade/UF)', nationality: 'Nacionalidade', sex: 'Sexo', marital_status: 'Estado civil', property_regime: 'Regime de bens',
  birth_date: 'Data de nascimento', mother_name: 'Nome da mãe', profession: 'Profissão', income_range: 'Renda mensal',
  spouse_name: 'Nome do cônjuge', spouse_doc: 'CPF do cônjuge', spouse_profession: 'Profissão do cônjuge', spouse_income_range: 'Renda do cônjuge',
  legal_name: 'Razão social', trade_name: 'Nome fantasia', state_registration: 'Inscrição estadual', opening_date: 'Data de abertura',
  main_activity: 'Atividade / CNAE', revenue_range: 'Faturamento anual', website: 'Site',
};
const LISTS = { sex: 'sexo', marital_status: 'estado_civil', property_regime: 'regime_bens', income_range: 'faixa_renda', spouse_income_range: 'faixa_renda', revenue_range: 'faixa_faturamento' };
const TYPES = { birth_date: 'date', opening_date: 'date', email: 'email', phone1: 'tel', phone2: 'tel', whatsapp: 'tel', website: 'url' };
const SPOUSE = ['spouse_name', 'spouse_doc', 'spouse_profession', 'spouse_income_range', 'property_regime'];

export async function show(app, token) {
  render(app, html`<div class="public-page"><div class="card">Carregando…</div></div>`);
  let d;
  try {
    d = await get('/api/publico/ficha', { token });
  } catch (e) {
    render(app, html`<div class="public-page"><div class="card"><h1>Link indisponível</h1><p>${e.message}</p></div></div>`);
    return;
  }
  const opt = (f) => (d.options[LISTS[f]] || []).map((o) => ({ value: o.value, label: o.label }));
  const married = () => (d.options.estado_civil || []).find((o) => o.value === ($('[name=marital_status]', app)?.value ?? d.values.marital_status))?.flags?.conjuge;
  const fieldsFor = (list) =>
    list.map((f) => field({ name: f, label: LABELS[f] || f, value: d.values[f], type: LISTS[f] ? 'select' : TYPES[f] || 'text', options: LISTS[f] ? opt(f) : undefined }));
  const main = Object.keys(d.values).filter((f) => !SPOUSE.includes(f));
  const draw = () => {
    render(app, html`<div class="public-page">
      <header><h1>Atualização de cadastro</h1><p class="muted">Seus dados ficam registrados com segurança e são usados apenas para a contratação e o atendimento${d.consultant ? `, com ${d.consultant} como seu consultor` : ''}. Este link vale até ${fmtDateTime(d.expires_at)}.</p></header>
      <form class="card" id="pf" novalidate>
        <h2>${d.kind === 'PJ' ? 'Dados da empresa' : 'Seus dados'}</h2>
        <div class="grid">${fieldsFor(main)}</div>
        ${d.kind === 'PF' ? html`<div class="spouse" ${married() ? '' : raw('hidden')}><h3>Cônjuge</h3><div class="grid">${fieldsFor(SPOUSE)}</div></div>` : ''}
        <h2>Endereço</h2>
        <div class="grid">
          <div class="field"><label>CEP</label><div class="inline-actions"><input name="cep" value="${d.address?.cep || ''}" inputmode="numeric" style="flex:1"><button type="button" class="btn small" data-act="cep">Buscar</button></div><small class="cep-msg"></small></div>
          ${field({ name: 'street', label: 'Logradouro', value: d.address?.street })}
          ${field({ name: 'number', label: 'Número', value: d.address?.number })}
          ${field({ name: 'complement', label: 'Complemento', value: d.address?.complement })}
          ${field({ name: 'district', label: 'Bairro', value: d.address?.district })}
          ${field({ name: 'city', label: 'Cidade', value: d.address?.city })}
          ${field({ name: 'state', label: 'Estado (UF)', value: d.address?.state, maxlength: 2 })}
        </div>
        <div class="modal-error" hidden></div>
        <div class="form-actions"><button class="btn primary" type="submit">Salvar meus dados</button></div>
      </form>
      <section class="card"><h2>Documentos</h2>
        <p class="muted">Envie os documentos abaixo em PDF ou foto legível (até 8 MB cada).</p>
        <ul class="checklist">${d.documents.map((doc) => html`<li class="${doc.status !== 'pendente' ? 'ok' : ''}"><span class="mark">${doc.status !== 'pendente' ? '✓' : '○'}</span> ${doc.label} <small class="muted">${doc.status === 'pendente' ? 'pendente' : doc.status === 'aprovado' ? 'aprovado' : 'recebido'}</small>
          <label class="btn small upload-btn">Enviar arquivo<input type="file" data-doc="${doc.type}" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic" hidden></label></li>`)}</ul>
        <p class="upload-msg small muted"></p>
      </section>
    </div>`);
    const form = $('#pf', app);
    form.marital_status?.addEventListener('change', () => ($('.spouse', app).hidden = !married()));
    on(form, 'click', '[data-act=cep]', async () => {
      const msg = $('.cep-msg', form);
      msg.textContent = 'Buscando…';
      try {
        const r = await get(`/api/publico/cep/${form.cep.value.replace(/\D/g, '')}`, { token });
        for (const f of ['street', 'district', 'city', 'state']) if (r[f]) form[f].value = r[f];
        msg.textContent = 'Endereço encontrado. Confira e informe o número.';
      } catch (e) {
        msg.textContent = e.message;
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('.modal-error', form);
      err.hidden = true;
      const all = formData(form);
      const values = {};
      for (const f of Object.keys(d.values)) if (f in all) values[f] = all[f];
      const address = {};
      for (const f of ['cep', 'street', 'number', 'complement', 'district', 'city', 'state']) address[f] = all[f];
      try {
        await post('/api/publico/ficha', { token, values, address });
        toast('Dados salvos. Obrigado!');
        d = await get('/api/publico/ficha', { token });
        draw();
      } catch (ex) {
        err.hidden = false;
        err.textContent = ex.message;
      }
    });
  };
  on(app, 'change', 'input[data-doc]', async (e, input) => {
    const file = input.files[0];
    if (!file) return;
    const msg = $('.upload-msg', app);
    if (file.size > 8 * 1024 * 1024) {
      msg.textContent = 'Arquivo maior que 8 MB.';
      return;
    }
    msg.textContent = `Enviando ${file.name}…`;
    try {
      await post('/api/publico/ficha/anexo', { token, doc_type: input.dataset.doc, filename: file.name, mime: file.type, content_base64: await fileToBase64(file) });
      toast('Arquivo enviado.');
      d = await get('/api/publico/ficha', { token });
      draw();
    } catch (ex) {
      msg.textContent = ex.message;
      toastError(ex);
    }
  });
  draw();
}
