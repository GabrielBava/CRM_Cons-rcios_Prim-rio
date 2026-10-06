// Ficha Cadastral do Participante: página aberta pelo cliente (sem login) para completar cadastro, endereço e documentos
// e concluir a pré-venda, com instruções e aviso de privacidade (LGPD).
import { get, post } from '../api.js';
import { html, raw, render, $, $$, on, field, formData, toast, toastError, fmtDateTime } from '../ui.js';
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

/* Chave de acesso da ficha (depois dos 4 dígitos do celular): só nesta aba do navegador, por até 2 horas */
const keyStore = {
  get: (t) => {
    try {
      return sessionStorage.getItem(`ficha:${t}`) || '';
    } catch {
      return '';
    }
  },
  set: (t, k) => {
    try {
      if (k) sessionStorage.setItem(`ficha:${t}`, k);
      else sessionStorage.removeItem(`ficha:${t}`);
    } catch {}
  },
};

/** Tela de segurança: "Olá, Nome Sobrenome" e os 4 últimos dígitos do celular antes de qualquer dado. */
function verifyScreen(app, token, d, onOk) {
  render(app, html`<div class="public-page">
    <header><span class="brand-logo" role="img" aria-label="Vero Consórcios"></span><h1>Ficha Cadastral do Participante</h1></header>
    <form class="card verify-card" id="vf" novalidate>
      <h2>Olá, ${d.greeting || 'cliente'}!</h2>
      <p>Por questões de segurança, favor informar os <strong>últimos quatro dígitos do seu telefone celular</strong> para seguir com as informações.</p>
      ${d.has_phone === false ? html`<div class="alert warn">Não encontramos um celular no seu cadastro. Fale com seu especialista para receber um novo link.</div>` : ''}
      <div class="digits" role="group" aria-label="Últimos 4 dígitos do celular">${[0, 1, 2, 3].map((i) => html`<input class="digit" inputmode="numeric" maxlength="1" autocomplete="off" aria-label="Dígito ${i + 1}" data-i="${i}">`)}</div>
      <div class="modal-error" ${d.locked_until ? '' : raw('hidden')}>${d.locked_until ? 'Por segurança, o acesso está bloqueado por alguns minutos. Tente de novo mais tarde ou fale com seu especialista.' : ''}</div>
      <button class="btn primary big" type="submit">Continuar</button>
      <p class="small muted">Seus dados só aparecem depois desta confirmação. Nunca pedimos senhas ou códigos recebidos por SMS.${d.company ? ` · ${d.company}` : ''}</p>
    </form></div>`);
  const form = $('#vf', app);
  const inputs = [...form.querySelectorAll('.digit')];
  inputs[0].focus();
  inputs.forEach((inp, i) => {
    inp.addEventListener('input', () => {
      inp.value = inp.value.replace(/\D/g, '').slice(-1);
      if (inp.value && inputs[i + 1]) inputs[i + 1].focus();
      if (inputs.every((x) => x.value)) form.requestSubmit();
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !inp.value && inputs[i - 1]) inputs[i - 1].focus();
    });
    inp.addEventListener('paste', (e) => {
      const t = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(-4);
      if (t.length === 4) {
        e.preventDefault();
        t.split('').forEach((ch, k) => (inputs[k].value = ch));
        form.requestSubmit();
      }
    });
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.modal-error', form);
    err.hidden = true;
    const digits = inputs.map((x) => x.value).join('');
    if (digits.length !== 4) {
      err.hidden = false;
      err.textContent = 'Informe os 4 últimos dígitos do seu celular.';
      return;
    }
    try {
      const r = await post('/api/publico/ficha/verificar', { token, digits });
      keyStore.set(token, r.key);
      onOk(r.key);
    } catch (ex) {
      err.hidden = false;
      err.textContent = ex.message;
      inputs.forEach((x) => (x.value = ''));
      inputs[0].focus();
    }
  });
}

export async function show(host, token) {
  // Cada abertura usa um contêiner novo (os eventos de uma abertura anterior não se acumulam)
  const app = document.createElement('div');
  host.replaceChildren(app);
  render(app, html`<div class="public-page"><div class="card">Carregando…</div></div>`);
  let key = keyStore.get(token);
  let d;
  const fetchForm = () => get('/api/publico/ficha', { token }, key ? { 'X-Ficha-Key': key } : {});
  try {
    d = await fetchForm();
  } catch (e) {
    render(app, html`<div class="public-page"><div class="card"><h1>Link indisponível</h1><p>${e.message}</p></div></div>`);
    return;
  }
  if (d.needs_verification) {
    keyStore.set(token, '');
    verifyScreen(app, token, d, async (k) => {
      key = k;
      try {
        d = await fetchForm();
        start();
      } catch (e) {
        render(app, html`<div class="public-page"><div class="card"><h1>Link indisponível</h1><p>${e.message}</p></div></div>`);
      }
    });
    return;
  }
  start();

  function start() {
  // Rascunho local: o que o cliente digitou fica preservado ao salvar, enviar documentos ou ver o que falta
  let draft = null;
  let missing = new Set();
  const opt = (f) => (d.options[LISTS[f]] || []).map((o) => ({ value: o.value, label: o.label }));
  const val = (f) => (draft && f in draft.values ? draft.values[f] : d.values[f]);
  const addrVal = (f) => (draft && f in draft.address ? draft.address[f] : d.address?.[f]);
  const isMarried = (v) => (d.options.estado_civil || []).find((o) => o.value === v)?.flags?.conjuge;
  const married = () => isMarried($('[name=marital_status]', app)?.value ?? val('marital_status'));
  const req = d.required || { fields: [], spouse: [], address: [] };
  const requiredNow = () => [...req.fields, ...(married() ? req.spouse : []), ...req.address];
  const fieldsFor = (list) =>
    list.map((f) => field({ name: f, label: LABELS[f] || f, value: val(f), type: LISTS[f] ? 'select' : TYPES[f] || 'text', options: LISTS[f] ? opt(f) : undefined, required: [...req.fields, ...req.spouse].includes(f) }));
  const main = Object.keys(d.values).filter((f) => !SPOUSE.includes(f));
  const filled = () => req.fields.every((f) => val(f));
  const auth = (body) => ({ ...body, token, key });
  /** Lê o formulário para o rascunho (sem perder nada do que foi digitado). */
  const syncDraft = () => {
    const form = $('#pf', app);
    if (!form) return;
    const all = formData(form);
    draft = { values: {}, address: {} };
    for (const f of Object.keys(d.values)) if (f in all) draft.values[f] = all[f];
    for (const f of ['cep', 'street', 'number', 'complement', 'district', 'city', 'state', 'notes']) draft.address[f] = all[f];
  };
  /** Destaca em vermelho claro os campos obrigatórios vazios (e os documentos que faltam). */
  const markMissing = (scroll) => {
    const form = $('#pf', app);
    if (!form) return [];
    const empty = requiredNow().filter((f) => form[f] && !String(form[f].value || '').trim());
    $$('.field.missing', form).forEach((el) => el.classList.remove('missing'));
    empty.forEach((f) => form[f].closest('.field')?.classList.add('missing'));
    $$('.doc-list li', app).forEach((li) => li.classList.toggle('missing', missing.has(`doc:${li.dataset.doc}`)));
    if (scroll && empty.length) {
      form[empty[0]].focus();
      form[empty[0]].scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    return empty;
  };
  const save = async () => {
    syncDraft();
    await post('/api/publico/ficha', auth({ values: draft.values, address: draft.address }));
    const fresh = await fetchForm();
    if (fresh.needs_verification) throw Object.assign(new Error('Sua confirmação expirou.'), { expired: true });
    d = fresh;
    draft = null;
  };
  const expired = () => {
    keyStore.set(token, '');
    toastError(new Error('Por segurança, confirme de novo os 4 últimos dígitos do seu celular.'));
    show(host, token);
  };
  const draw = () => {
    render(app, html`<div class="public-page">
      <header><span class="brand-logo" role="img" aria-label="Vero Consórcios"></span><h1>Ficha Cadastral do Participante</h1>
        <p class="muted">${d.company ? `${d.company} · ` : ''}Cadastro para a sua adesão ao consórcio${d.consultant ? `, com ${d.consultant} como seu especialista` : ''}. Este link é pessoal e vale até ${fmtDateTime(d.expires_at)}.</p></header>
      ${d.completed ? html`<div class="alert ok-alert"><strong>Cadastro enviado. Obrigado!</strong> Seu especialista vai conferir os dados e os documentos e seguir com o termo de adesão. Se precisar corrigir algo, ainda é possível editar abaixo.</div>` : ''}
      <section class="card howto"><h2>Como preencher</h2>
        <ol class="steps-public">
          <li class="${filled() ? 'done' : ''}"><strong>Confira seus dados</strong> e complete o que estiver em branco. Os campos com <span class="req">*</span> são obrigatórios. Clique em "Salvar meus dados".</li>
          <li class="${d.address?.cep ? 'done' : ''}"><strong>Endereço:</strong> digite o CEP e o endereço é preenchido automaticamente.</li>
          <li class="${d.documents.every((x) => ['recebido', 'aprovado'].includes(x.status)) ? 'done' : ''}"><strong>Documentos:</strong> envie o documento de identificação e o comprovante de endereço, em foto ou PDF.</li>
          <li class="${d.completed ? 'done' : ''}"><strong>Conclua o cadastro</strong> no botão no fim da página. Pronto: seu especialista é avisado na hora.</li>
        </ol>
        <p class="small muted">Leva cerca de 5 minutos. Você pode salvar e voltar depois pelo mesmo link.</p></section>
      <form class="card" id="pf" novalidate>
        <h2>${d.kind === 'PJ' ? 'Dados da empresa' : 'Seus dados'}</h2>
        <div class="grid">${fieldsFor(main)}</div>
        ${d.kind === 'PF' ? html`<div class="spouse" ${married() ? '' : raw('hidden')}><h3>Cônjuge</h3><div class="grid">${fieldsFor(SPOUSE)}</div></div>` : ''}
        <h2>Endereço</h2>
        <div class="grid">
          <div class="field"><label>CEP${req.address.includes('cep') ? html` <span class="req">*</span>` : ''}</label><input name="cep" value="${addrVal('cep') || ''}" inputmode="numeric" maxlength="9" autocomplete="postal-code"><small class="cep-msg">Digite o CEP para preencher o endereço automaticamente.</small></div>
          ${field({ name: 'street', label: 'Logradouro', value: addrVal('street'), required: req.address.includes('street') })}
          ${field({ name: 'number', label: 'Número', value: addrVal('number'), required: req.address.includes('number') })}
          ${field({ name: 'complement', label: 'Complemento', value: addrVal('complement') })}
          ${field({ name: 'district', label: 'Bairro', value: addrVal('district'), required: req.address.includes('district') })}
          ${field({ name: 'city', label: 'Cidade', value: addrVal('city'), required: req.address.includes('city') })}
          ${field({ name: 'state', label: 'Estado (UF)', value: addrVal('state'), maxlength: 2, required: req.address.includes('state') })}
          ${field({ name: 'notes', label: 'Observação sobre o endereço', type: 'textarea', value: addrVal('notes'), full: true, rows: 2 })}
        </div>
        <div class="modal-error" hidden></div>
        <div class="form-actions"><button class="btn primary" type="submit">Salvar meus dados</button></div>
      </form>
      <section class="card"><h2>Documentos obrigatórios</h2>
        <p class="muted">Envie uma <strong>foto legível</strong> (pode ser do celular) ou um <strong>PDF</strong> de cada documento, até 8 MB. Cada arquivo é conferido pelo seu especialista.</p>
        <ul class="checklist doc-list">${d.documents.map((doc) => {
          const st = DOC_PUBLIC[doc.status] || DOC_PUBLIC.pendente;
          return html`<li class="${doc.status === 'aprovado' ? 'ok' : ''}" data-doc="${doc.type}"><span class="mark">${doc.status === 'aprovado' ? '✓' : '○'}</span> <span class="grow">${doc.label}</span> <span class="badge ${st[1]}">${st[0]}</span>
          ${['pendente', 'recusado', 'vencido'].includes(doc.status) ? html`<label class="btn small primary upload-btn">${doc.status === 'pendente' ? 'Enviar foto ou PDF' : 'Enviar novamente'}<input type="file" data-doc="${doc.type}" accept="image/*,application/pdf,.pdf,.heic" hidden></label>` : ''}</li>`;
        })}</ul>
        <p class="upload-msg small muted"></p>
      </section>
      <section class="card"><h2>Concluir cadastro</h2>
        <p class="muted">Ao concluir, os dados desta página são salvos e o seu especialista é avisado.</p>
        <label class="check"><input type="checkbox" id="lgpd-ok" ${d.completed ? raw('checked') : ''}> Li e concordo com o tratamento dos meus dados pessoais para a contratação do consórcio, conforme o aviso abaixo.</label>
        <div class="modal-error" id="done-err" hidden></div>
        <div class="form-actions"><button class="btn primary big" type="button" data-act="complete">${d.completed ? 'Enviar novamente' : 'Concluir cadastro'}</button></div></section>
      <footer class="lgpd small muted"><strong>Privacidade (LGPD — Lei 13.709/2018).</strong> Os dados e documentos informados aqui são usados somente para análise cadastral, emissão do contrato de adesão junto à administradora do consórcio, cumprimento de obrigações legais e regulatórias (inclusive prevenção à lavagem de dinheiro) e para o seu atendimento. Eles são compartilhados apenas com a administradora escolhida e guardados pelo prazo exigido em lei. Você pode pedir acesso, correção ou informações sobre o uso dos seus dados ao seu especialista${d.company ? ` ou à ${d.company}` : ''}. Nunca pedimos senhas bancárias ou códigos recebidos por SMS.</footer>
    </div>`);
    const form = $('#pf', app);
    form.marital_status?.addEventListener('change', () => ($('.spouse', app).hidden = !married()));
    bindCepAutofill(form, (cep) => get(`/api/publico/cep/${cep}`, { token }, { 'X-Ficha-Key': key }));
    // O vermelho some assim que o campo é preenchido
    form.addEventListener('input', (e) => {
      const f = e.target.closest('.field.missing');
      if (f && String(e.target.value || '').trim()) f.classList.remove('missing');
    });
    if (missing.size) markMissing(false);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('.modal-error', form);
      err.hidden = true;
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await save();
        draw();
        const empty = markMissing(true);
        if (empty.length) toast(`Dados salvos. Ainda faltam ${empty.length} campo(s) obrigatório(s), destacados em vermelho.`, 'error');
        else toast('Dados salvos. Obrigado!');
      } catch (ex) {
        if (ex.expired || ex.status === 401) return expired();
        err.hidden = false;
        err.textContent = ex.message;
        markMissing(true);
      } finally {
        btn.disabled = false;
      }
    });
  };
  on(app, 'change', 'input[type=file][data-doc]', async (e, input) => {
    const file = input.files[0];
    if (!file) return;
    const msg = $('.upload-msg', app);
    if (file.size > 8 * 1024 * 1024) {
      msg.textContent = 'Arquivo maior que 8 MB. Tire uma nova foto ou envie um PDF menor.';
      return;
    }
    if (!/^image\//.test(file.type) && file.type !== 'application/pdf' && !/\.(pdf|heic|jpe?g|png|webp)$/i.test(file.name)) {
      msg.textContent = 'Envie uma foto (imagem) ou um arquivo PDF.';
      return;
    }
    msg.textContent = `Enviando ${file.name}…`;
    syncDraft();
    try {
      await post('/api/publico/ficha/anexo', auth({ doc_type: input.dataset.doc, filename: file.name, mime: file.type, content_base64: await fileToBase64(file) }));
      toast('Arquivo enviado.');
      const fresh = await fetchForm();
      if (fresh.needs_verification) return expired();
      d = fresh;
      missing.delete(`doc:${input.dataset.doc}`);
      draw();
    } catch (ex) {
      if (ex.status === 401) return expired();
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
      // Salva o que está na tela antes de concluir (nada do que foi digitado se perde)
      await save();
      await post('/api/publico/ficha/concluir', auth({}));
      keyStore.set(token, '');
      render(app, html`<div class="public-page"><div class="card center"><h1>Cadastro concluído!</h1>
        <p>Recebemos seus dados e documentos${d.consultant ? `. ${d.consultant} vai conferir tudo` : ''} e entrar em contato para os próximos passos: termo de adesão, contrato, assinatura e boleto.</p>
        <p class="muted">Você pode fechar esta página.</p></div></div>`);
    } catch (ex) {
      if (ex.expired || ex.status === 401) return expired();
      missing = new Set((ex.details?.missing || []).map((m) => m.key));
      draw();
      const empty = markMissing(true);
      const docs = (ex.details?.missing || []).filter((m) => m.group === 'Documentos');
      const box = $('#done-err', app);
      box.hidden = false;
      box.textContent = empty.length || docs.length
        ? `Quase lá! Complete o que está destacado em vermelho${docs.length ? ` e envie: ${docs.map((m) => m.label).join(', ')}` : ''}. O que você já preencheu foi salvo.`
        : ex.message;
      if (!empty.length && docs.length) $('.doc-list li.missing', app)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      $('[data-act=complete]', app).disabled = false;
    }
  });
  draw();
  }
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
    render(app, html`<div class="public-page"><header><span class="brand-logo" role="img" aria-label="Vero Consórcios"></span></header><div class="card"><h1>Pesquisa de satisfação</h1><p>${msg}</p></div></div>`);
    return;
  }
  const scale = (name, from, to) => html`<div class="scale" role="radiogroup">${Array.from({ length: to - from + 1 }, (_, i) => from + i).map((n) => html`<label class="scale-opt"><input type="radio" name="${name}" value="${n}"><span>${n}</span></label>`)}</div>`;
  render(app, html`<div class="public-page">
    <header><span class="brand-logo" role="img" aria-label="Vero Consórcios"></span><h1>Pesquisa de satisfação</h1><p class="muted">Olá, ${d.first_name}! Sua opinião nos ajuda a melhorar. Leva menos de 1 minuto.</p></header>
    <form class="card nps-form" id="nps" novalidate>
      <div class="q"><h2>De 0 a 10, quanto você recomendaria ${company} a um amigo ou familiar? <span class="req">*</span></h2>
        ${scale('score', 0, 10)}<div class="scale-legend"><span>Nada provável</span><span>Muito provável</span></div></div>
      ${d.questions.map((q) => html`<div class="q"><h3>${q.label}</h3>${scale(`q_${q.key}`, 1, 5)}<div class="scale-legend"><span>Muito ruim</span><span>Excelente</span></div></div>`)}
      ${d.reasons?.length ? html`<div class="q nps-reason" hidden><h3>O que mais pesou na sua nota?</h3>${field({ name: 'reason', label: 'Motivo principal', type: 'select', options: d.reasons, full: true })}</div>` : ''}
      ${field({ name: 'comment', label: 'O que podemos melhorar? (opcional)', type: 'textarea', full: true, rows: 3 })}
      <div class="modal-error" hidden></div>
      <div class="form-actions"><button class="btn primary" type="submit">Enviar avaliação</button></div>
      <p class="small muted">Pesquisa válida até ${fmtDateTime(d.expires_at)}.</p>
    </form></div>`);
  const form = $('#nps', app);
  // Notas até 8: pergunta o motivo principal (alimenta os motivos de insatisfação no pós-venda)
  form.addEventListener('change', (e) => {
    if (e.target.name === 'score' && $('.nps-reason', form)) $('.nps-reason', form).hidden = Number(e.target.value) > 8;
  });
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
      await post('/api/publico/nps', { token, score: Number(all.score), answers, comment: all.comment, reason: Number(all.score) <= 8 ? all.reason || undefined : undefined });
      render(app, html`<div class="public-page"><div class="card"><h1>Obrigado!</h1><p>Sua avaliação foi registrada. Ela é muito importante para ${company}.</p></div></div>`);
    } catch (ex) {
      err.hidden = false;
      err.textContent = ex.message;
    }
  });
}
