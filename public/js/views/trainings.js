// 13. Treinamentos: materiais em PDF, vídeo, link ou texto por tema (FGTS, como funciona o consórcio, cálculos, lances…),
// com questionário de verificação, obrigatoriedade por perfil e acompanhamento de progresso pelo administrador.
import { get, post } from '../api.js';
import { html, render, raw, $, $$, on, fresh, badge, field, modal, opts, optLabel, toast, toastError, can, subnav, fmtDate, fmtDateTime, empty, state } from '../ui.js';
import { fileToBase64 } from './record-tabs.js';

const KIND = { pdf: 'PDF', video: 'Vídeo', link: 'Link', texto: 'Texto' };
const STATUS = { concluido: ['Concluído', 'ok'], em_andamento: ['Em andamento', 'warn'], nao_iniciado: ['Não iniciado', 'muted'] };
const stBadge = (s) => badge(STATUS[s][0], STATUS[s][1]);

/** Link de vídeo incorporável (YouTube/Vimeo); outros links abrem em nova aba. */
function embedUrl(u) {
  const yt = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vm = u.match(/vimeo\.com\/(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return null;
}

export async function show(view, { params = {} } = {}) {
  const admin = can.admin();
  const tab = admin && params.aba === 'acompanhamento' ? 'acompanhamento' : 'materiais';
  render(view, html`<div class="page">
    <div class="page-head"><div><h1>Treinamentos</h1><p class="muted">Materiais por tema, com questionário de fixação. Os obrigatórios aparecem no painel inicial até serem concluídos.</p></div>
      ${admin ? html`<div class="actions"><button class="btn primary" data-act="new">+ Novo material</button></div>` : ''}</div>
    ${admin ? subnav([['#/treinamentos', 'Materiais', 'materiais'], ['#/treinamentos?aba=acompanhamento', 'Acompanhamento da equipe', 'acompanhamento']], tab) : ''}
    <div id="tab"></div></div>`);
  const box = fresh($('#tab', view));
  // Recarrega a tela pelo roteador (elemento novo, sem ouvintes duplicados)
  const reload = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
  on(view, 'click', '[data-act=new]', async () => (await trainingForm()) && reload());
  if (tab === 'acompanhamento') return tracking(box);
  return list(box);
}

async function list(box) {
  const admin = can.admin();
  let cat = '';
  const load = async () => {
    let d;
    try {
      d = await get('/api/treinamentos');
    } catch (e) {
      return toastError(e);
    }
    const s = d.summary;
    const items = d.items.filter((t) => !cat || t.category === cat);
    const order = opts('categoria_treinamento', { all: true }).map((o) => o.value);
    const groups = [...new Set(items.map((t) => t.category || ''))].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
    render(box, html`
      <div class="kpis small">
        <div class="kpi"><div class="kpi-label">Concluídos</div><div class="kpi-value">${s.concluidos} / ${s.total}</div><div class="progress-bar goal"><span style="width:${s.total ? Math.round((s.concluidos / s.total) * 100) : 0}%"></span></div></div>
        <div class="kpi ${s.obrigatorios_pendentes ? 'alert-kpi' : ''}"><div class="kpi-label">Obrigatórios pendentes</div><div class="kpi-value">${s.obrigatorios_pendentes}</div><div class="kpi-sub">de ${s.obrigatorios} obrigatório(s)</div></div>
        <div class="kpi ${s.atrasados ? 'alert-kpi' : ''}"><div class="kpi-label">Com prazo vencido</div><div class="kpi-value">${s.atrasados}</div></div>
      </div>
      <div class="chips">${[{ value: '', label: 'Todos os temas' }, ...opts('categoria_treinamento')].map((o) => html`<button type="button" class="chip ${cat === o.value ? 'active' : ''}" data-cat="${o.value}">${o.label}</button>`)}</div>
      ${items.length
        ? groups.map((g) => html`<section class="card"><h3>${g ? optLabel('categoria_treinamento', g) : 'Sem tema'}</h3>
            <div class="training-list">${items.filter((t) => (t.category || '') === g).map((t) => html`<article class="training ${t.active ? '' : 'inactive'}">
              <div><strong><a href="#" data-open="${t.id}">${t.title}</a></strong> ${badge(KIND[t.kind] || t.kind)}${t.required ? html` ${badge('Obrigatório', t.overdue ? 'danger' : 'warn')}` : ''}${t.active ? '' : html` ${badge('Inativo', 'muted')}`}
                ${t.description ? html`<p class="muted small">${t.description}</p>` : ''}
                <small class="muted">${[t.duration_min ? `${t.duration_min} min` : '', t.questions ? `questionário com ${t.questions} pergunta(s), nota mínima ${t.pass_score}%` : '', t.due_at ? `prazo ${fmtDate(t.due_at)}` : ''].filter(Boolean).join(' · ')}</small></div>
              <div class="training-side">${stBadge(t.status)}${t.progress.quiz_score != null ? html`<small>nota ${t.progress.quiz_score}%</small>` : ''}
                <button class="btn small ${t.status === 'concluido' ? '' : 'primary'}" data-open="${t.id}">${t.status === 'concluido' ? 'Rever' : t.status === 'em_andamento' ? 'Continuar' : 'Começar'}</button>
                ${admin ? html`<button class="btn small ghost" data-edit="${t.id}">Editar</button>` : ''}</div>
            </article>`)}</div></section>`)
        : empty(admin ? 'Nenhum material cadastrado. Use "+ Novo material" para enviar PDFs, vídeos e textos.' : 'Nenhum material disponível ainda.')}
      <p class="hint">Sugestões de trilha: 1) Como funciona o consórcio; 2) Lances (livre, fixo e embutido); 3) Uso do FGTS; 4) Cálculos financeiros (consórcio x financiamento); 5) Objeções e ética na venda; 6) LGPD no atendimento.</p>`);
    box._items = d.items;
  };
  on(box, 'click', '[data-cat]', (e, b) => ((cat = b.dataset.cat), load()));
  on(box, 'click', '[data-open]', async (e, b) => {
    e.preventDefault();
    await openTraining(Number(b.dataset.open));
    load();
  });
  on(box, 'click', '[data-edit]', async (e, b) => {
    let t;
    try {
      t = await get(`/api/treinamentos/${b.dataset.edit}`);
    } catch (err) {
      return toastError(err);
    }
    if (await trainingForm(t)) load();
  });
  await load();
}

async function fileBlobUrl(id) {
  const res = await fetch(`/api/treinamentos/${id}/arquivo`, { headers: { 'X-Requested-With': 'crm' }, credentials: 'same-origin' });
  if (!res.ok) {
    let msg = `Erro ${res.status}`;
    try {
      msg = (await res.json()).error || msg;
    } catch {}
    throw new Error(msg);
  }
  return URL.createObjectURL(await res.blob());
}

async function openTraining(id) {
  let t;
  try {
    t = await get(`/api/treinamentos/${id}`);
  } catch (e) {
    return toastError(e);
  }
  const done = t.status === 'concluido';
  const embed = t.video_url && embedUrl(t.video_url);
  let blobUrl = null;
  await modal({
    title: t.title,
    wide: true,
    body: html`${t.description ? html`<p class="muted">${t.description}</p>` : ''}
      ${t.kind === 'pdf' && t.file_name ? html`<div class="file-view training-file"><p class="muted">Carregando ${t.file_name}…</p></div>` : ''}
      ${t.video_url ? (embed ? html`<div class="video"><iframe src="${embed}" title="${t.title}" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></div>` : '') : ''}
      ${t.video_url ? html`<p><a class="btn small" href="${t.video_url}" target="_blank" rel="noopener">Abrir ${t.kind === 'video' ? 'vídeo' : 'link'} em nova aba</a></p>` : ''}
      ${t.content ? html`<div class="training-text">${raw(String(html`${t.content}`).replace(/\n/g, '<br>'))}</div>` : ''}
      ${t.quiz.length
        ? html`<h4>Questionário de fixação ${done ? html`<small class="muted">(concluído com nota ${t.progress.quiz_score ?? '—'}%)</small>` : html`<small class="muted">(nota mínima ${t.pass_score}%)</small>`}</h4>
          <ol class="quiz">${t.quiz.map((q, i) => html`<li><p><strong>${q.question}</strong></p>${q.options.map((o, j) => html`<label class="check"><input type="radio" name="q${i}" value="${j}"> ${o}</label>`)}</li>`)}</ol>`
        : ''}
      <p class="small muted">Acessos: ${t.progress.open_count} · último em ${fmtDateTime(t.progress.last_opened_at)}${t.progress.completed_at ? ` · concluído em ${fmtDate(t.progress.completed_at)}` : ''}</p>`,
    submitLabel: t.quiz.length ? 'Enviar respostas' : done ? 'Fechar' : 'Marcar como concluído',
    onMount(form) {
      const fv = $('.training-file', form);
      if (!fv) return;
      fileBlobUrl(t.id)
        .then((u) => {
          blobUrl = u;
          render(fv, html`<iframe src="${u}" title="${t.file_name}"></iframe><p><a class="btn small" href="${u}" target="_blank" rel="noopener" download="${t.file_name}">Abrir ${t.file_name} em nova aba</a></p>`);
        })
        .catch((e) => render(fv, html`<p class="warn-text">${e.message}</p>`));
    },
    async onSubmit(d) {
      if (done && !t.quiz.length) return true;
      const answers = t.quiz.map((q, i) => (d[`q${i}`] === undefined ? null : Number(d[`q${i}`])));
      if (answers.some((a) => a == null)) throw new Error('Responda todas as perguntas.');
      const r = await post(`/api/treinamentos/${t.id}/concluir`, { answers });
      if (!r.passed) throw new Error(`Nota ${r.score}%: abaixo da mínima de ${r.pass_score}%. Revise o material e tente novamente.`);
      toast(r.score != null ? `Treinamento concluído com nota ${r.score}%.` : 'Treinamento concluído.');
      return true;
    },
  });
  if (blobUrl) URL.revokeObjectURL(blobUrl);
}

/* ------------------------- Cadastro (administrador) ------------------------- */

function quizEditor(quiz = []) {
  const q = (item = { options: ['', ''] }, i = 0) => html`<fieldset class="quiz-q" data-q>
    <legend>Pergunta <span data-qn>${i + 1}</span> <button type="button" class="icon" data-q-del aria-label="Remover pergunta">×</button></legend>
    <input data-k="question" value="${item.question || ''}" placeholder="Enunciado">
    <small class="muted">Marque a alternativa correta:</small>
    <div data-opts>${(item.options || ['', '']).map((o, j) => html`<label class="quiz-opt"><input type="radio" name="correct_${i}_${Math.random().toString(36).slice(2, 6)}" data-correct ${item.correct === j ? raw('checked') : ''}><input data-opt value="${o}" placeholder="Alternativa ${j + 1}"></label>`)}</div>
    <button type="button" class="btn small ghost" data-opt-add>+ Alternativa</button></fieldset>`;
  return html`<div class="field full" data-quiz><label>Questionário (opcional)</label>
    <div data-qs>${quiz.map((item, i) => q(item, i))}</div>
    <button type="button" class="btn small" data-q-add>+ Pergunta</button>
    <template data-q-tpl>${q()}</template></div>`;
}

function bindQuiz(form) {
  const renumber = () => $$('[data-q]', form).forEach((f, i) => ($('[data-qn]', f).textContent = i + 1));
  on(form, 'click', '[data-q-add]', () => {
    const tpl = $('[data-q-tpl]', form).innerHTML.replace(/name="correct_[^"]+"/g, `name="correct_${Date.now()}"`);
    $('[data-qs]', form).insertAdjacentHTML('beforeend', tpl);
    renumber();
  });
  on(form, 'click', '[data-q-del]', (e, b) => (b.closest('[data-q]').remove(), renumber()));
  on(form, 'click', '[data-opt-add]', (e, b) => {
    const box = $('[data-opts]', b.closest('[data-q]'));
    const name = $('[data-correct]', box)?.name || `correct_${Date.now()}`;
    box.insertAdjacentHTML('beforeend', `<label class="quiz-opt"><input type="radio" name="${name}" data-correct><input data-opt placeholder="Alternativa ${box.children.length + 1}"></label>`);
  });
}

const readQuiz = (form) =>
  $$('[data-q]', form).map((f) => {
    const optEls = $$('[data-opt]', f);
    const radios = $$('[data-correct]', f);
    return { question: $('[data-k=question]', f).value, options: optEls.map((o) => o.value), correct: radios.findIndex((r) => r.checked) };
  });

function trainingForm(t = { kind: 'pdf', pass_score: 70, active: 1, required_roles: [], quiz: [] }) {
  const roles = state.meta.roles ? Object.entries(state.meta.roles).filter(([k]) => k !== 'admin') : [['consultor', 'Especialista'], ['gestor', 'Líder de equipe']];
  return modal({
    title: t.id ? `Editar ${t.title}` : 'Novo material de treinamento',
    wide: true,
    body: html`<div class="grid">
        ${field({ name: 'title', label: 'Título', value: t.title, required: true, full: true })}
        ${field({ name: 'category', label: 'Tema', type: 'select', options: opts('categoria_treinamento'), value: t.category })}
        ${field({ name: 'kind', label: 'Tipo de material', type: 'select', options: Object.entries(KIND).map(([value, label]) => ({ value, label })), value: t.kind, allowEmpty: false })}
        ${field({ name: 'description', label: 'Resumo', type: 'textarea', rows: 2, value: t.description, full: true })}
        <div class="field full" data-kind="pdf"><label>Arquivo PDF ${t.file_name ? html`<small class="muted">(atual: ${t.file_name} — envie outro para substituir)</small>` : ''}</label><input type="file" name="file" accept=".pdf,.pptx,.docx,.png,.jpg,.jpeg"><small>Até 15 MB.</small></div>
        <div class="full" data-kind="video link">${field({ name: 'video_url', label: 'Endereço do vídeo ou link', value: t.video_url, placeholder: 'https://www.youtube.com/watch?v=…', full: true })}</div>
        ${field({ name: 'content', label: 'Texto / roteiro do conteúdo', type: 'textarea', rows: 6, value: t.content, full: true })}
        ${field({ name: 'duration_min', label: 'Duração estimada (min)', type: 'number', min: 0, step: '1', value: t.duration_min })}
        ${field({ name: 'position', label: 'Ordem no tema', type: 'number', min: 0, step: '1', value: t.position ?? 0 })}
        <fieldset class="field full"><legend>Obrigatório para</legend>${roles.map(([k, label]) => html`<label class="check"><input type="checkbox" data-role="${k}" ${t.required_roles.includes(k) ? raw('checked') : ''}> ${typeof label === 'object' ? label.label : label}</label>`)}</fieldset>
        ${field({ name: 'due_days', label: 'Prazo para concluir (dias após publicar)', type: 'number', min: 0, step: '1', value: t.due_days })}
        ${field({ name: 'pass_score', label: 'Nota mínima no questionário (%)', type: 'number', min: 0, step: '1', value: t.pass_score })}
        ${quizEditor(t.quiz)}
        ${t.id ? field({ name: 'active', label: 'Ativo (visível para a equipe)', type: 'checkbox', value: t.active }) : ''}
      </div>`,
    onMount(form) {
      bindQuiz(form);
      const sync = () => $$('[data-kind]', form).forEach((el) => (el.hidden = !el.dataset.kind.split(' ').includes(form.kind.value)));
      form.kind.addEventListener('change', sync);
      sync();
    },
    async onSubmit(d, form) {
      const { file, ...rest } = d;
      const body = { ...rest, id: t.id, quiz: readQuiz(form), required_roles: $$('[data-role]:checked', form).map((c) => c.dataset.role) };
      const f = form.file.files[0];
      if (f) {
        if (f.size > 15 * 1024 * 1024) throw new Error('Arquivo maior que 15 MB.');
        body.content_base64 = await fileToBase64(f);
        body.file_name = f.name;
        body.file_mime = f.type;
      }
      if (d.kind === 'pdf' && !f && !t.file_name) throw new Error('Envie o arquivo PDF.');
      if (['video', 'link'].includes(d.kind) && !d.video_url) throw new Error('Informe o endereço do vídeo ou link.');
      await post('/api/treinamentos', body);
      toast('Material salvo.');
      return true;
    },
  });
}

/* ------------------------- Acompanhamento ------------------------- */

async function tracking(box) {
  let d;
  try {
    d = await get('/api/treinamentos/acompanhamento');
  } catch (e) {
    return toastError(e);
  }
  const cell = (c) => {
    const s = STATUS[c.status];
    return html`<td class="center" title="${s[0]}${c.score != null ? ` · nota ${c.score}%` : ''}${c.last_opened_at ? ` · último acesso ${fmtDateTime(c.last_opened_at)}` : ''}"><span class="dot ${s[1]}"></span>${c.required ? html`<small>*</small>` : ''}${c.score != null ? html`<br><small>${c.score}%</small>` : ''}</td>`;
  };
  render(box, d.trainings.length && d.users.length
    ? html`<section class="card"><div class="table-wrap"><table class="tracking"><thead><tr><th>Usuário</th><th class="num">Obrigatórios</th><th class="num">Total</th>${d.trainings.map((t) => html`<th class="rot" title="${optLabel('categoria_treinamento', t.category)}">${t.title}</th>`)}</tr></thead>
        <tbody>${d.users.map((u) => html`<tr><td><strong>${u.name}</strong><br><small>${state.meta.roles?.[u.role]?.label || state.meta.roles?.[u.role] || u.role}</small></td>
          <td class="num">${badge(`${u.required_done}/${u.required}`, u.required && u.required_done < u.required ? 'warn' : 'ok')}</td><td class="num">${u.done}/${d.trainings.length}</td>${u.cells.map(cell)}</tr>`)}</tbody></table></div>
        <p class="hint"><span class="dot ok"></span> concluído · <span class="dot warn"></span> em andamento · <span class="dot muted"></span> não iniciado · * obrigatório para o perfil</p></section>`
    : empty('Cadastre materiais e usuários para acompanhar o progresso.'));
}
