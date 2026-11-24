// Ferramentas: reúne o que o especialista usa no dia a dia, separado por área (Consórcio, Planejamento financeiro,
// Seguros e Investimentos) e um bloco Geral (kit, marca, importação). Inclui a base de conhecimento da IA Vero.
import { get, post, patch, put } from '../api.js';
import { html, render, on, state, can, hasModule, modal, field, toast, toastError, $, empty, fmtDateTime, formData } from '../ui.js';
import { icon } from '../icons.js';
import { openLeadDrawer } from '../drawer.js';
import { openSimulator } from '../leadtabs.js';

const PICK = {
  diagnostico: { title: 'Diagnóstico financeiro — para qual cliente?', hint: 'O diagnóstico é gerado pelo lead: escolha o cliente e o painel dele abre na aba Diagnóstico.' },
  simulador: { title: 'Simulador de consórcio — para qual cliente?', hint: 'Escolha o cliente: o simulador abre numa nova guia com o nome e o contato dele já preenchidos.' },
};

/** Escolha do cliente para abrir uma ferramenta (busca por nome, código, telefone ou e-mail). */
function pickClient(kind = 'diagnostico') {
  const k = PICK[kind];
  return modal({
    title: k.title,
    body: html`<p class="hint">${k.hint}</p>
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
  if (id === 'lps') return can.manage() ? lpsView(view) : render(view, html`<div class="page"><h1>Acesso não liberado</h1><p class="muted">LPs e rastreio são do líder e do administrador.</p></div>`);
  if (id === 'diagnostico' || id === 'simulador') {
    await show(view);
    const cid = await pickClient(id);
    if (cid && id === 'diagnostico') openLeadDrawer(cid, { tab: 'diagnostico' });
    if (cid && id === 'simulador') openSimulator(cid);
    return undefined;
  }
  const lead = can.manage();
  const clusters = [
    {
      key: 'consorcio', title: 'Consórcio', ic: 'consorcio', text: 'Simulação de consórcio para o cliente.',
      tools: [
        { act: 'sim', ic: 'simulador', title: 'Simulador de consórcio', text: 'Escolha o cliente: o simulador da Vero abre numa nova guia com o nome e o contato dele (acesso com a senha da equipe).' },
      ],
    },
    {
      key: 'planejamento', title: 'Planejamento financeiro', ic: 'planejamento', text: 'Diagnóstico financeiro, Estrela Vero e plano de ação.',
      tools: [
        { act: 'diag', ic: 'diagnostico', title: 'Diagnóstico financeiro', text: 'Escolha o cliente: o diagnóstico abre ligado a ele e fica salvo no CRM (aba Diagnóstico do lead).' },
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
        lead && { href: '#/ferramentas/lps', ic: 'link', title: 'LPs e rastreio (UTM)', text: 'LPs que enviam leads ao CRM, gerador de links com UTM e desempenho por campanha.' },
      ],
    },
  ];
  render(view, html`<div class="page">
    <div class="page-head"><div><h1>Ferramentas</h1><p class="muted">Tudo o que você usa no atendimento, separado por área.</p></div></div>
    ${clusters.map((c) => html`<section class="tool-cluster area-${c.key}"><header>${icon(c.ic, 20)}<div><h2>${c.title}</h2><small class="muted">${c.text}</small></div></header>
      <div class="tool-grid">${c.tools.filter(Boolean).map(card)}</div></section>`)}
  </div>`);
  on(view, 'click', '[data-act=sim]', async () => {
    const id = await pickClient('simulador');
    if (id) openSimulator(id);
  });
  on(view, 'click', '[data-act=diag]', async () => {
    const id = await pickClient('diagnostico');
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
      ${st ? html`<div class="alert ${st.generative ? 'ok-alert' : ''} small">${st.generative ? html`IA generativa ligada (${st.provider_name || ''} · ${st.model}). As respostas usam os dados do lead e esta base.` : html`Motor interno da IA Vero ativo (sem custo e sem envio de dados para fora).${st.can_configure ? html` Para ligar a IA generativa, veja Configurações › Integrações.` : ''}`}</div>` : ''}
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


/* ------------------------- LPs e rastreio (UTM) ------------------------- */

const slugify = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const pctTxt = (v) => (v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copiado.');
  } catch {
    toast('Não foi possível copiar: selecione e copie manualmente.');
  }
}

/** Edição das LPs cadastradas (administrador): nome, identificador, área e endereço. */
function editPages(d) {
  const row = (p = {}) => html`<div class="lp-edit-row">
    <input name="nome" placeholder="Nome (ex.: LP Seguros de vida)" value="${p.nome || ''}" aria-label="Nome da LP" required>
    <input name="slug" placeholder="identificador (ex.: seguros-vida)" value="${p.slug || ''}" aria-label="Identificador" ${p.arquivo ? 'readonly title="LP com arquivo no CRM: o identificador não muda"' : ''}>
    <select name="area" aria-label="Área">${Object.entries(d.areas).map(([v, l]) => html`<option value="${v}" ${v === (p.area || 'consorcio') ? 'selected' : ''}>${l}</option>`)}</select>
    <input name="url" type="url" placeholder="https://… (endereço publicado)" value="${p.url || ''}" aria-label="Endereço">
    <button type="button" class="icon-btn" data-lp-del title="Remover" aria-label="Remover" ${p.arquivo ? 'disabled' : ''}>×</button></div>`;
  return modal({
    title: 'LPs cadastradas',
    wide: true,
    body: html`<p class="hint">Cadastre cada LP com a área dela (consórcio, planejamento, seguros ou investimentos). O identificador é o que a LP envia em <code>VERO_LP.lp</code> e aparece no desempenho.</p>
      <div class="lp-edit">${d.pages.map(row)}</div><button type="button" class="btn small" data-lp-add>${icon('adicionar', 14)} Adicionar LP</button>`,
    onMount(form) {
      on(form, 'click', '[data-lp-add]', () => $('.lp-edit', form).insertAdjacentHTML('beforeend', String(row())));
      on(form, 'click', '[data-lp-del]', (e, b) => b.closest('.lp-edit-row').remove());
      on(form, 'input', '[name=nome]', (e, i) => {
        const s = i.closest('.lp-edit-row').querySelector('[name=slug]');
        if (!s.readOnly && !s.dataset.touched) s.value = slugify(i.value.replace(/^lp\s+/i, ''));
      });
      on(form, 'input', '[name=slug]', (e, i) => (i.dataset.touched = '1'));
    },
    async onSubmit(_, form) {
      const pages = [...form.querySelectorAll('.lp-edit-row')].map((r) => ({ nome: r.querySelector('[name=nome]').value, slug: r.querySelector('[name=slug]').value, area: r.querySelector('[name=area]').value, url: r.querySelector('[name=url]').value }));
      await put('/api/lps', { pages });
      toast('LPs salvas.');
    },
  });
}

async function lpsView(view) {
  let d;
  try {
    d = await get('/api/lps');
  } catch (e) {
    render(view, html`<div class="page"><div class="alert danger">${e.message}</div></div>`);
    return undefined;
  }
  const preview = !!window.CRM_PREVIEW;
  const month = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 7);
  const lpOpts = d.pages.map((p) => html`<option value="${p.slug}" ${p.slug === d.pages[0]?.slug ? 'selected' : ''}>${p.nome}</option>`);
  render(view, html`<div class="page lps-page">
    <div class="page-head"><div><h1>LPs e rastreio</h1><p class="muted">As LPs enviam cada cadastro direto para o CRM (origem LP, área do formulário, tudo o que a pessoa preencheu e a campanha). Use o mesmo padrão de UTM em todos os links para comparar as campanhas.</p></div>
      <div class="actions"><a class="btn ghost" href="#/ferramentas">← Ferramentas</a>${d.can_edit ? html`<button class="btn" data-lp="edit">Editar LPs</button>` : ''}</div></div>

    <section class="card"><h3>LPs</h3>
      <div class="table-wrap"><table class="data lp-table"><thead><tr><th>LP</th><th>Área</th><th>Endereço</th><th class="num">Leads (30 dias)</th><th>Ações</th></tr></thead>
        <tbody>${d.pages.map((p) => html`<tr>
          <td data-label="LP"><strong>${p.nome}</strong><br><small class="muted">${p.slug}</small></td>
          <td data-label="Área"><span class="chip-sm area area-${p.area}">${d.areas[p.area]}</span></td>
          <td data-label="Endereço">${p.url ? html`<a href="${p.url}" target="_blank" rel="noopener">${p.url}</a>` : html`<span class="muted">—</span>`}</td>
          <td data-label="Leads (30 dias)" class="num" data-lp-count="${p.slug}">…</td>
          <td data-label="Ações"><span class="inline-actions"><button type="button" class="btn small" data-lp-link="${p.slug}">Gerar link</button>${p.arquivo && !preview ? html`<a class="btn small" href="/api/lps/${p.slug}/arquivo" download="${p.arquivo}" title="Arquivo pronto para a hospedagem, já com o endereço deste CRM">${icon('baixar', 14)} Baixar ${p.arquivo}</a>` : ''}</span></td></tr>`)}</tbody></table></div>
      <p class="small muted">Os leads chegam em <code>${d.endpoint}</code>${d.crm_url ? '' : ' (defina PUBLIC_URL com o endereço do CRM)'}. Os arquivos baixados aqui já vêm com esse endereço; é só subir na hospedagem (consórcio como <code>index.html</code>, planejamento como <code>lp-planejamento.html</code>).</p>
    </section>

    <section class="card"><h3>Gerar link com UTM</h3>
      <form class="grid utm-form" data-utm>
        <div class="field"><label>LP</label><select name="lp">${lpOpts}<option value="">Outro endereço</option></select></div>
        <div class="field" data-utm-url hidden><label>Endereço da página</label><input name="url" type="url" placeholder="https://…"></div>
        <div class="field"><label>Fonte (utm_source)</label><select name="source">${d.padrao.fontes.map(([v, l]) => html`<option value="${v}">${l} · ${v}</option>`)}<option value="">Outra…</option></select></div>
        <div class="field" data-utm-other-source hidden><label>Outra fonte</label><input name="source_other" placeholder="ex.: parceiro-joao"></div>
        <div class="field"><label>Mídia (utm_medium)</label><select name="medium">${d.padrao.midias.map(([v, l]) => html`<option value="${v}">${l} · ${v}</option>`)}<option value="">Outra…</option></select></div>
        <div class="field" data-utm-other-medium hidden><label>Outra mídia</label><input name="medium_other" placeholder="ex.: podcast"></div>
        <div class="field"><label>Tema da campanha</label><input name="tema" placeholder="ex.: imovel, alavancagem, dividas, seguro-vida" value="geral"></div>
        <div class="field"><label>Campanha (utm_campaign)</label><input name="campaign" data-utm-campaign></div>
        <div class="field"><label>Conteúdo / criativo (utm_content)</label><input name="content" placeholder="ex.: video-casa-15s, carrossel-3"></div>
        <div class="field"><label>Público ou palavra-chave (utm_term)</label><input name="term" placeholder="ex.: lookalike-clientes, consorcio-imovel"></div>
        <div class="field full"><label>Link para usar no anúncio, post ou mensagem</label>
          <div class="utm-out"><input readonly data-utm-out aria-label="Link gerado"><button type="button" class="btn primary small" data-utm-copy>${icon('copiar', 14)} Copiar</button><a class="btn small" data-utm-open target="_blank" rel="noopener">Abrir</a></div></div>
      </form>
    </section>

    <section class="card"><div class="section-head"><h3>Desempenho das LPs</h3>
      <form class="inline-actions" data-perf><select name="dias" aria-label="Período">${[[7, '7 dias'], [30, '30 dias'], [90, '90 dias'], [365, '12 meses']].map(([v, l]) => html`<option value="${v}" ${v === 30 ? 'selected' : ''}>${l}</option>`)}</select>
        <select name="por" aria-label="Agrupar por">${[['lp', 'por LP'], ['formulario', 'por formulário'], ['area', 'por área'], ['fonte', 'por fonte'], ['midia', 'por mídia'], ['campanha', 'por campanha'], ['conteudo', 'por conteúdo (criativo)']].map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></form></div>
      <div data-perf-box></div>
      <p class="small muted">Entradas = envios de formulário (o mesmo cadastro pode enviar mais de uma vez, sem duplicar). Com R1 = cadastros com R1 agendada. Conversão = cadastros com negócio ganho ÷ cadastros.</p>
    </section>

    <details class="card utm-std"><summary>Padrão de UTM da Vero</summary>
      <ul class="utm-rules">
        <li>Tudo em <strong>minúsculas</strong>, sem acento e sem espaço (use hífen). O gerador acima já faz isso.</li>
        <li><strong>utm_campaign</strong> = <code>área_tema_aaaa-mm</code>, ex.: <code>consorcio_imovel_${month}</code>, <code>planejamento_dividas_${month}</code>, <code>seguros_vida_${month}</code>.</li>
        <li><strong>utm_content</strong> = o criativo (vídeo, carrossel, post) e <strong>utm_term</strong> = o público ou a palavra-chave.</li>
        <li>Google Ads e Meta Ads: deixe também a marcação automática ligada (gclid e fbclid são guardados no lead).</li>
        <li>Sem UTM, o CRM identifica o canal pelo site de origem (Google orgânico, Instagram, direto…). O primeiro e o último contato ficam salvos por 90 dias no navegador da pessoa.</li>
      </ul>
      <div class="utm-std-grid"><div><h4>Fontes</h4><dl>${d.padrao.fontes.map(([v, l]) => html`<dt><code>${v}</code></dt><dd>${l}</dd>`)}</dl></div>
        <div><h4>Mídias</h4><dl>${d.padrao.midias.map(([v, l]) => html`<dt><code>${v}</code></dt><dd>${l}</dd>`)}</dl></div></div>
      <h4>LP nova (seguros, investimentos ou um tema específico)</h4>
      <p class="small">1) Cadastre a LP em <strong>Editar LPs</strong>. 2) Prepare o arquivo com <code>node scripts/preparar-lp.js entrada.html saida.html --lp seguros-vida --area seguros --crm ${d.crm_url || 'https://SEU-CRM'}</code> ou cole no <code>&lt;head&gt;</code>:</p>
      <pre class="code-block">&lt;script&gt;window.VERO_LP={crm:"${d.crm_url || 'https://SEU-CRM'}",lp:"seguros-vida",area:"seguros"};&lt;/script&gt;
&lt;script src="${d.script}"&gt;&lt;/script&gt;</pre>
      <p class="small">3) No envio do formulário: <code>VeroLP.enviar({ nome, email, celular, preferencia_contato, melhor_horario, aceite_privacidade: true, respostas: { 'Pergunta': 'Resposta' } })</code>. Tudo o que vier em <code>respostas</code> fica na nota do lead.</p>
    </details>
  </div>`);

  // Gerador de link
  const f = $('[data-utm]', view);
  const pageOf = (s) => d.pages.find((p) => p.slug === s);
  let campaignTouched = false;
  const build = () => {
    const v = formData(f);
    $('[data-utm-url]', f).hidden = !!v.lp;
    $('[data-utm-other-source]', f).hidden = !!v.source;
    $('[data-utm-other-medium]', f).hidden = !!v.medium;
    const area = v.lp ? pageOf(v.lp)?.area : 'consorcio';
    if (!campaignTouched) f.campaign.value = [area, slugify(v.tema) || 'geral', month].join('_');
    const base = v.lp ? pageOf(v.lp)?.url : v.url;
    let out = '';
    try {
      const u = new URL(base || '');
      // Valores do padrão: minúsculas, sem acento, hífen no lugar de espaço (o "_" do padrão fica)
      const utmVal = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '');
      const set = (k, x) => (utmVal(x) ? u.searchParams.set(k, utmVal(x)) : u.searchParams.delete(k));
      set('utm_source', v.source || v.source_other);
      set('utm_medium', v.medium || v.medium_other);
      set('utm_campaign', f.campaign.value);
      set('utm_content', v.content);
      set('utm_term', v.term);
      out = u.toString();
    } catch {
      out = '';
    }
    $('[data-utm-out]', f).value = out || 'Informe o endereço da LP (Editar LPs) para gerar o link.';
    $('[data-utm-open]', f).href = out || '#';
  };
  on(f, 'input', 'input, select', (e, el) => {
    if (el.name === 'campaign') campaignTouched = true;
    if (el.name === 'tema' || el.name === 'lp') campaignTouched = false;
    build();
  });
  on(f, 'change', 'select', build);
  on(f, 'click', '[data-utm-copy]', () => {
    const v = $('[data-utm-out]', f).value;
    if (/^https?:/.test(v)) copy(v);
  });
  build();
  on(view, 'click', '[data-lp-link]', (e, b) => {
    f.lp.value = b.dataset.lpLink;
    campaignTouched = false;
    build();
    f.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  on(view, 'click', '[data-lp=edit]', async () => {
    if (await editPages(d)) lpsView(view);
  });

  // Desempenho
  const pf = $('[data-perf]', view);
  const loadPerf = async () => {
    const box = $('[data-perf-box]', view);
    try {
      const v = formData(pf);
      const r = await get('/api/lps/desempenho', v);
      render(box, r.rows.length ? html`<div class="table-wrap"><table class="data"><thead><tr><th>${pf.por.selectedOptions[0].textContent.replace(/^por /, '').replace(/^./, (c) => c.toUpperCase())}</th><th class="num">Entradas</th><th class="num">Cadastros</th><th class="num">Com R1</th><th class="num">Ganhos</th><th class="num">Taxa de R1</th><th class="num">Conversão</th></tr></thead>
        <tbody>${r.rows.map((x) => html`<tr><td data-label="Grupo"><strong>${x.chave}</strong></td><td data-label="Entradas" class="num">${x.entradas}</td><td data-label="Cadastros" class="num">${x.cadastros}</td><td data-label="Com R1" class="num">${x.com_r1}</td><td data-label="Ganhos" class="num">${x.ganhos}</td><td data-label="Taxa de R1" class="num">${pctTxt(x.taxa_r1)}</td><td data-label="Conversão" class="num">${pctTxt(x.conversao)}</td></tr>`)}</tbody></table></div>`
        : empty('Nenhum lead das LPs neste período.'));
    } catch (e) {
      render(box, html`<div class="alert danger">${e.message}</div>`);
    }
  };
  on(pf, 'change', 'select', loadPerf);
  loadPerf();
  // Leads de 30 dias por LP (coluna da tabela de LPs)
  get('/api/lps/desempenho', { dias: 30, por: 'lp' }).then((r) => {
    for (const p of d.pages) {
      const cell = view.querySelector(`[data-lp-count="${p.slug}"]`);
      if (cell) cell.textContent = String(r.rows.find((x) => x.chave === p.nome)?.entradas || 0);
    }
  }).catch(() => {});
  return undefined;
}
