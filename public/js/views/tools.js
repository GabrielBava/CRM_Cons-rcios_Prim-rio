// Ferramentas: reúne o que o especialista usa no dia a dia, separado por área (Consórcio, Planejamento financeiro,
// Seguros e Investimentos) e um bloco Geral (kit, marca, importação). Inclui a base de conhecimento da IA Vero.
import { get, post, patch } from '../api.js';
import { html, render, on, state, can, hasModule, modal, field, toast, toastError, $, empty, fmtDateTime } from '../ui.js';
import { icon } from '../icons.js';
import { openR1Model, downloadR1Model } from '../meeting.js';
import { downloadR1Template } from '../r1.js';
import { openLeadDrawer } from '../drawer.js';

const SIM_URL = 'ferramentas/simulador-consorcio.html';

/** Escolha do cliente para abrir o diagnóstico financeiro (busca por nome, código, telefone ou e-mail). */
function pickClient() {
  return modal({
    title: 'Diagnóstico financeiro — para qual cliente?',
    body: html`<p class="hint">O diagnóstico é gerado pelo lead: escolha o cliente e o painel dele abre na aba Diagnóstico.</p>
      <div class="field full"><label>Buscar cadastro</label><input type="search" name="q" placeholder="Nome, código (C-…), telefone ou e-mail" autocomplete="off"></div>
      <div class="pick-list" role="listbox"></div>`,
    onMount(form, close) {
      let t;
      const box = $('.pick-list', form);
      form.q.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          const q = form.q.value.trim();
          if (q.length < 2) return (box.innerHTML = '');
          try {
            const r = await get('/api/cadastros', { q, limit: 8 });
            box.innerHTML = String(r.rows.length
              ? html`${r.rows.map((c) => html`<button type="button" class="pick-item" data-pick="${c.id}"><strong>${c.name}</strong><small>${c.code}${c.email ? ` · ${c.email}` : ''}${c.phone1 ? ` · ${c.phone1}` : ''}</small></button>`)}`
              : html`<p class="muted small">Nenhum cadastro encontrado.</p>`);
          } catch (e) {
            toastError(e);
          }
          return undefined;
        }, 250);
      });
      on(form, 'click', '[data-pick]', (e, b) => close(Number(b.dataset.pick)));
      form.q.focus();
    },
  });
}

const card = (t) => (t.href
  ? html`<a class="tool-card" href="${t.href}" ${t.external ? 'target="_blank" rel="noopener"' : ''}><span class="tool-ico">${icon(t.ic, 22)}</span><strong>${t.title}${t.external ? html` ${icon('externo', 13)}` : ''}</strong><small>${t.text}</small></a>`
  : t.soon
    ? html`<div class="tool-card soon"><span class="tool-ico">${icon(t.ic, 22)}</span><strong>${t.title}</strong><small>${t.text}</small><span class="badge muted">em breve</span></div>`
    : html`<div class="tool-card"><button type="button" class="tool-main" data-act="${t.act}"><span class="tool-ico">${icon(t.ic, 22)}</span><strong>${t.title}</strong><small>${t.text}</small></button>${t.extra || ''}</div>`);

export async function show(view, { id } = {}) {
  if (id === 'ia') return knowledgeView(view);
  if (id === 'diagnostico') {
    await show(view);
    const cid = await pickClient();
    if (cid) openLeadDrawer(cid, { tab: 'diagnostico' });
    return undefined;
  }
  const company = state.meta.settings.company_name || 'Vero Consórcios';
  const lead = can.manage();
  const clusters = [
    {
      key: 'consorcio', title: 'Consórcio', ic: 'consorcio', text: 'Simulação, proposta e reunião de apresentação.',
      tools: [
        { href: SIM_URL, external: true, ic: 'simulador', title: 'Simulador de consórcio', text: 'Simulador da Vero Consórcios (acesso com a senha da equipe). Abre numa nova guia.' },
        hasModule('simulador') && { href: '#/simulador', ic: 'propostas', title: 'Simulador de propostas', text: 'Simule cartas, parcelas e lances e gere a proposta que volta para o CRM.' },
        { act: 'r1-open', ic: 'propostas', title: 'Modelo da R1', text: `Apresentação oficial da ${company} com o seu nome, foto e contato.`, extra: html`<button type="button" class="btn small" data-act="r1-download">Baixar</button>` },
        { act: 'r1-template', ic: 'baixar', title: 'Modelo da transcrição da R1', text: 'Planilha para registrar o que foi dito na R1 e completar a qualificação.' },
      ],
    },
    {
      key: 'planejamento', title: 'Planejamento financeiro', ic: 'planejamento', text: 'Diagnóstico, Estrela Vero e plano de ação.',
      tools: [
        { act: 'diag', ic: 'diagnostico', title: 'Diagnóstico financeiro', text: 'Gerado pelo lead: escolha o cliente e o painel dele abre na aba Diagnóstico.' },
      ],
    },
    { key: 'seguros', title: 'Seguros', ic: 'seguros', text: 'Proteção da renda, da família e do patrimônio.', tools: [{ soon: true, ic: 'seguros', title: 'Cotação de seguros', text: 'Vida, automóvel/frota, residencial/empresarial e saúde.' }] },
    { key: 'investimentos', title: 'Investimentos', ic: 'investimentos', text: 'Captação: reserva, migração de carteira, aporte e previdência.', tools: [{ soon: true, ic: 'investimentos', title: 'Simulador de investimentos', text: 'Reserva de emergência, previdência e comparativo de carteiras.' }] },
    {
      key: 'geral', title: 'Geral', ic: 'ferramentas', text: 'Materiais, marca e importação.',
      tools: [
        { href: '#/ferramentas/ia', ic: 'ia', title: 'Base da IA Vero', text: lead ? 'Objeções, perguntas, dicas e mensagens que a IA Vero sugere no painel do lead.' : 'Veja o que a IA Vero usa para sugerir respostas e perguntas.' },
        { href: '#/integracao/kit', ic: 'ferramentas', title: 'Kit do especialista', text: 'WhatsApp Business, LinkedIn com a capa da Vero e materiais de apoio.' },
        { href: '#/integracao/marca', ic: 'avaliacao', title: 'Manual da marca', text: 'Posicionamento, cores, tipografia e tom de voz.' },
        hasModule('crm') && can.write() && { href: '#/importar', ic: 'importar', title: 'Importar leads', text: 'Planilha do Excel com validação e verificação de duplicados.' },
      ],
    },
  ];
  render(view, html`<div class="page">
    <div class="page-head"><div><h1>Ferramentas</h1><p class="muted">Tudo o que você usa no atendimento, separado por área.</p></div></div>
    ${clusters.map((c) => html`<section class="tool-cluster area-${c.key}"><header>${icon(c.ic, 20)}<div><h2>${c.title}</h2><small class="muted">${c.text}</small></div></header>
      <div class="tool-grid">${c.tools.filter(Boolean).map(card)}</div></section>`)}
  </div>`);
  on(view, 'click', '[data-act=r1-open]', () => openR1Model(''));
  on(view, 'click', '[data-act=r1-download]', () => downloadR1Model(''));
  on(view, 'click', '[data-act=r1-template]', () => downloadR1Template());
  on(view, 'click', '[data-act=diag]', async () => {
    const id = await pickClient();
    if (id) openLeadDrawer(id, { tab: 'diagnostico' });
  });
  return undefined;
}

/* ------------------------- Base de conhecimento da IA Vero ------------------------- */

async function knowledgeView(view) {
  const lead = can.manage();
  const draw = async () => {
    let r;
    let st = null;
    try {
      [r, st] = await Promise.all([get('/api/ia/conhecimento'), get('/api/ia/status').catch(() => null)]);
    } catch (e) {
      render(view, html`<div class="page"><div class="alert danger">${e.message}</div></div>`);
      return;
    }
    const kinds = r.kinds;
    render(view, html`<div class="page">
      <div class="page-head"><div><h1>Base da IA Vero</h1><p class="muted">O que a IA Vero usa para orientar o especialista: objeções, perguntas, dicas de condução e mensagens prontas. Os itens mais bem avaliados (👍) aparecem primeiro no painel do lead.</p></div>
        <div class="actions"><a class="btn ghost" href="#/ferramentas">← Ferramentas</a>${lead ? html`<button class="btn primary" data-kb-new>${icon('adicionar', 15)} Novo item</button>` : ''}</div></div>
      ${st ? html`<div class="alert ${st.generative ? 'ok-alert' : ''} small">${st.generative ? html`IA generativa ligada (${st.model}). As respostas usam os dados do lead e esta base.` : html`Motor interno da IA Vero ativo (sem custo e sem envio de dados para fora).${st.can_configure ? html` Para ligar a IA generativa, veja Configurações › Integrações.` : ''}`}</div>` : ''}
      ${r.rows.length ? html`<div class="kb-list">${r.rows.map((k) => html`<article class="kb-item ${k.active ? '' : 'off'}"><header><span class="badge">${kinds[k.kind]}</span><strong>${k.title}</strong>${k.stage_key ? html`<small class="muted">etapa ${state.meta.stages.find((s) => s.key === k.stage_key)?.name || k.stage_key}</small>` : ''}<span class="grow"></span><small class="muted">👍 ${k.likes} · 👎 ${k.dislikes}</small>${lead ? html`<button class="link-btn" data-kb-edit="${k.id}">Editar</button>` : ''}</header>
        <p>${k.content}</p><small class="muted">${k.created_by_name || '—'} · ${fmtDateTime(k.created_at)}${k.active ? '' : ' · inativo'}</small></article>`)}</div>` : empty('Nenhum item cadastrado ainda. A IA Vero já usa as objeções e as perguntas SPIN padrão.')}
      <h3>Objeções padrão</h3>
      <div class="kb-list">${r.builtin.objections.map((o) => html`<article class="kb-item"><header><span class="badge muted">padrão</span><strong>${o.title}</strong></header><p>${o.response}</p><small class="muted">${o.tip}</small></article>`)}</div>
    </div>`);
    view._kb = r;
  };
  const form = (k = null) => modal({
    title: k ? 'Editar item da base' : 'Novo item da base da IA Vero',
    wide: true,
    body: html`<div class="grid">
      ${k ? '' : field({ name: 'kind', label: 'Tipo', type: 'select', options: Object.entries(view._kb.kinds).map(([value, label]) => ({ value, label })), required: true, allowEmpty: false })}
      ${field({ name: 'stage_key', label: 'Etapa (opcional)', type: 'select', options: state.meta.stages.filter((s) => s.kind === 'aberta').map((s) => ({ value: s.key, label: s.name })), value: k?.stage_key, placeholder: 'Todas as etapas' })}
      ${field({ name: 'title', label: 'Título', value: k?.title, required: true, full: true, placeholder: 'Ex.: "Vou falar com meu sócio"' })}
      ${field({ name: 'content', label: 'Conteúdo (use {nome} para o primeiro nome do cliente)', type: 'textarea', rows: 5, value: k?.content, required: true, full: true })}
      ${k ? field({ name: 'active', label: 'Ativo', type: 'checkbox', value: !!k.active, full: true }) : ''}
    </div>`,
    async onSubmit(d) {
      if (k) await patch(`/api/ia/conhecimento/${k.id}`, { ...d, active: !!d.active });
      else await post('/api/ia/conhecimento', d);
      toast('Base da IA atualizada.');
      return true;
    },
  });
  on(view, 'click', '[data-kb-new]', async () => (await form()) && draw());
  on(view, 'click', '[data-kb-edit]', async (e, b) => {
    const k = view._kb.rows.find((x) => x.id === Number(b.dataset.kbEdit));
    if (k && (await form(k))) draw();
  });
  await draw();
  return undefined;
}

