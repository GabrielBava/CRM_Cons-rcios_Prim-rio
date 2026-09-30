// Ficha Cadastral do Participante: página aberta pelo cliente (sem login) para completar cadastro, endereço e documentos
// e concluir a pré-venda, com instruções e aviso de privacidade (LGPD).
import { get, post } from '../api.js';
import { html, raw, render, $, on, field, formData, toast, toastError, fmtDateTime } from '../ui.js';
import { fileToBase64, bindCepAutofill } from './record-tabs.js';

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
const DOC_PUBLIC = { pendente: ['Pendente', 'warn'], recebido: ['Recebido: em conferência', ''], aprovado: ['Aprovado', 'ok'], recusado: ['Reprovado: envie novamente', 'danger'], vencido: ['Vencido: envie um atualizado', 'danger'] };
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
  const filled = () => ['name', 'doc', 'email'].filter((f) => f in d.values).every((f) => d.values[f]);
  const draw = () => {
    render(app, html`<div class="public-page">
      <header><h1>Ficha Cadastral do Participante</h1>
        <p class="muted">${d.company ? `${d.company} · ` : ''}Cadastro para a sua adesão ao consórcio${d.consultant ? `, com ${d.consultant} como seu especialista` : ''}. Este link é pessoal e vale até ${fmtDateTime(d.expires_at)}.</p></header>
      ${d.completed ? html`<div class="alert ok-alert"><strong>Cadastro enviado. Obrigado!</strong> Seu especialista vai conferir os dados e os documentos e seguir com o termo de adesão. Se precisar corrigir algo, ainda é possível editar abaixo.</div>` : ''}
      <section class="card howto"><h2>Como preencher</h2>
        <ol class="steps-public">
          <li class="${filled() ? 'done' : ''}"><strong>Confira seus dados</strong> e complete o que estiver em branco. Clique em "Salvar meus dados".</li>
          <li class="${d.address?.cep ? 'done' : ''}"><strong>Endereço:</strong> digite o CEP e o endereço é preenchido automaticamente.</li>
          <li class="${d.documents.every((x) => ['recebido', 'aprovado'].includes(x.status)) ? 'done' : ''}"><strong>Documentos:</strong> envie foto legível ou PDF de cada documento pedido.</li>
          <li class="${d.completed ? 'done' : ''}"><strong>Conclua o cadastro</strong> no botão no fim da página. Pronto: seu especialista é avisado na hora.</li>
        </ol>
        <p class="small muted">Leva cerca de 5 minutos. Você pode salvar e voltar depois pelo mesmo link.</p></section>
      <form class="card" id="pf" novalidate>
        <h2>${d.kind === 'PJ' ? 'Dados da empresa' : 'Seus dados'}</h2>
        <div class="grid">${fieldsFor(main)}</div>
        ${d.kind === 'PF' ? html`<div class="spouse" ${married() ? '' : raw('hidden')}><h3>Cônjuge</h3><div class="grid">${fieldsFor(SPOUSE)}</div></div>` : ''}
        <h2>Endereço</h2>
        <div class="grid">
          <div class="field"><label>CEP</label><input name="cep" value="${d.address?.cep || ''}" inputmode="numeric" maxlength="9" autocomplete="postal-code"><small class="cep-msg">Digite o CEP para preencher o endereço automaticamente.</small></div>
          ${field({ name: 'street', label: 'Logradouro', value: d.address?.street })}
          ${field({ name: 'number', label: 'Número', value: d.address?.number })}
          ${field({ name: 'complement', label: 'Complemento', value: d.address?.complement })}
          ${field({ name: 'district', label: 'Bairro', value: d.address?.district })}
          ${field({ name: 'city', label: 'Cidade', value: d.address?.city })}
          ${field({ name: 'state', label: 'Estado (UF)', value: d.address?.state, maxlength: 2 })}
          ${field({ name: 'notes', label: 'Observação sobre o endereço', type: 'textarea', value: d.address?.notes, full: true, rows: 2 })}
        </div>
        <div class="modal-error" hidden></div>
        <div class="form-actions"><button class="btn primary" type="submit">Salvar meus dados</button></div>
      </form>
      <section class="card"><h2>Documentos obrigatórios</h2>
        <p class="muted">Envie os documentos abaixo em PDF ou foto legível (até 8 MB cada). Cada arquivo é conferido pelo seu especialista.</p>
        <ul class="checklist doc-list">${d.documents.map((doc) => {
          const st = DOC_PUBLIC[doc.status] || DOC_PUBLIC.pendente;
          return html`<li class="${doc.status === 'aprovado' ? 'ok' : ''}"><span class="mark">${doc.status === 'aprovado' ? '✓' : '○'}</span> <span class="grow">${doc.label}</span> <span class="badge ${st[1]}">${st[0]}</span>
          ${['pendente', 'recusado', 'vencido'].includes(doc.status) ? html`<label class="btn small primary upload-btn">${doc.status === 'pendente' ? 'Enviar arquivo' : 'Enviar novamente'}<input type="file" data-doc="${doc.type}" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic" hidden></label>` : ''}</li>`;
        })}</ul>
        <p class="upload-msg small muted"></p>
      </section>
      <section class="card"><h2>Concluir cadastro</h2>
        <p class="muted">Depois de salvar os dados e enviar os documentos, clique em concluir para avisar seu especialista.</p>
        <label class="check"><input type="checkbox" id="lgpd-ok" ${d.completed ? raw('checked') : ''}> Li e concordo com o tratamento dos meus dados pessoais para a contratação do consórcio, conforme o aviso abaixo.</label>
        <div class="modal-error" id="done-err" hidden></div>
        <div class="form-actions"><button class="btn primary big" type="button" data-act="complete">${d.completed ? 'Enviar novamente' : 'Concluir cadastro'}</button></div></section>
      <footer class="lgpd small muted"><strong>Privacidade (LGPD — Lei 13.709/2018).</strong> Os dados e documentos informados aqui são usados somente para análise cadastral, emissão do contrato de adesão junto à administradora do consórcio, cumprimento de obrigações legais e regulatórias (inclusive prevenção à lavagem de dinheiro) e para o seu atendimento. Eles são compartilhados apenas com a administradora escolhida e guardados pelo prazo exigido em lei. Você pode pedir acesso, correção ou informações sobre o uso dos seus dados ao seu especialista${d.company ? ` ou à ${d.company}` : ''}. Nunca pedimos senhas bancárias ou códigos recebidos por SMS.</footer>
    </div>`);
    const form = $('#pf', app);
    form.marital_status?.addEventListener('change', () => ($('.spouse', app).hidden = !married()));
    bindCepAutofill(form, (cep) => get(`/api/publico/cep/${cep}`, { token }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('.modal-error', form);
      err.hidden = true;
      const all = formData(form);
      const values = {};
      for (const f of Object.keys(d.values)) if (f in all) values[f] = all[f];
      const address = {};
      for (const f of ['cep', 'street', 'number', 'complement', 'district', 'city', 'state', 'notes']) address[f] = all[f];
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
  on(app, 'click', '[data-act=complete]', async (e, b) => {
    const err = $('#done-err', app);
    err.hidden = true;
    if (!$('#lgpd-ok', app).checked) {
      err.hidden = false;
      err.textContent = 'Marque a concordância com o aviso de privacidade para concluir.';
      return;
    }
    b.disabled = true;
    try {
      await post('/api/publico/ficha/concluir', { token });
      render(app, html`<div class="public-page"><div class="card center"><h1>Cadastro concluído!</h1>
        <p>Recebemos seus dados e documentos${d.consultant ? `. ${d.consultant} vai conferir tudo` : ''} e entrar em contato para os próximos passos: termo de adesão, contrato, assinatura e boleto.</p>
        <p class="muted">Você pode fechar esta página.</p></div></div>`);
    } catch (ex) {
      err.hidden = false;
      err.textContent = ex.message;
      b.disabled = false;
    }
  });
  draw();
}

/* ------------------------- Pesquisa de satisfação (NPS) ------------------------- */

export async function showNps(app, token) {
  render(app, html`<div class="public-page"><div class="card">Carregando…</div></div>`);
  let d;
  try {
    d = await get('/api/publico/nps', { token });
  } catch (e) {
    render(app, html`<div class="public-page"><div class="card"><h1>Pesquisa indisponível</h1><p>${e.message}</p></div></div>`);
    return;
  }
  const company = d.company || 'nossa empresa';
  if (d.status !== 'pendente') {
    const msg = { respondida: 'Esta pesquisa já foi respondida. Muito obrigado pela sua avaliação!', expirada: 'Esta pesquisa expirou. Se quiser nos avaliar, fale com seu especialista.', cancelada: 'Esta pesquisa foi cancelada.' }[d.status];
    render(app, html`<div class="public-page"><div class="card"><h1>Pesquisa de satisfação</h1><p>${msg}</p></div></div>`);
    return;
  }
  const scale = (name, from, to) => html`<div class="scale" role="radiogroup">${Array.from({ length: to - from + 1 }, (_, i) => from + i).map((n) => html`<label class="scale-opt"><input type="radio" name="${name}" value="${n}"><span>${n}</span></label>`)}</div>`;
  render(app, html`<div class="public-page">
    <header><h1>Pesquisa de satisfação</h1><p class="muted">Olá, ${d.first_name}! Sua opinião nos ajuda a melhorar. Leva menos de 1 minuto.</p></header>
    <form class="card nps-form" id="nps" novalidate>
      <div class="q"><h2>De 0 a 10, quanto você recomendaria ${company} a um amigo ou familiar? <span class="req">*</span></h2>
        ${scale('score', 0, 10)}<div class="scale-legend"><span>Nada provável</span><span>Muito provável</span></div></div>
      ${d.questions.map((q) => html`<div class="q"><h3>${q.label}</h3>${scale(`q_${q.key}`, 1, 5)}<div class="scale-legend"><span>Muito ruim</span><span>Excelente</span></div></div>`)}
      ${field({ name: 'comment', label: 'O que podemos melhorar? (opcional)', type: 'textarea', full: true, rows: 3 })}
      <div class="modal-error" hidden></div>
      <div class="form-actions"><button class="btn primary" type="submit">Enviar avaliação</button></div>
      <p class="small muted">Pesquisa válida até ${fmtDateTime(d.expires_at)}.</p>
    </form></div>`);
  const form = $('#nps', app);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.modal-error', form);
    err.hidden = true;
    const all = formData(form);
    if (all.score === undefined) {
      err.hidden = false;
      err.textContent = 'Escolha uma nota de 0 a 10.';
      return;
    }
    const answers = {};
    for (const q of d.questions) if (all[`q_${q.key}`] !== undefined) answers[q.key] = Number(all[`q_${q.key}`]);
    try {
      await post('/api/publico/nps', { token, score: Number(all.score), answers, comment: all.comment });
      render(app, html`<div class="public-page"><div class="card"><h1>Obrigado!</h1><p>Sua avaliação foi registrada. Ela é muito importante para ${company}.</p></div></div>`);
    } catch (ex) {
      err.hidden = false;
      err.textContent = ex.message;
    }
  });
}
