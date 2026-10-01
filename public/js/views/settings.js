import { get, post, patch } from '../api.js';
import {
  html, render, $, $$, on, fresh, state, table, badge, field, modal, selectOptions, toItems, userItems, fmtDateTime, can, toast, toastError,
  statusIntegration, K, empty, formData,
} from '../ui.js';

export async function refreshMeta() {
  state.meta = await get('/api/meta');
  state.user = state.meta.user;
}

/* ------------------------- Listas configuráveis (reutilizado em Produtos) ------------------------- */

export function optionListCard(list, title, hint) {
  const items = state.meta.options[list] || [];
  const flagEff = list === 'resultado_ligacao';
  return html`<section class="card" data-list="${list}">
    <div class="section-head"><h3>${title}</h3>${can.admin() ? html`<button class="btn small" data-opt-new="${list}">+ Adicionar</button>` : ''}</div>
    ${hint ? html`<p class="hint">${hint}</p>` : ''}
    <ul class="opt-list">${items.map(
      (o) => html`<li class="${o.active ? '' : 'inactive'}"><span>${o.label} <small class="muted">${o.value}</small>${flagEff && o.flags.efetivo ? html` ${badge('efetivo', 'ok')}` : ''}${o.active ? '' : html` ${badge('inativo', 'muted')}`}</span>
        ${can.admin() ? html`<button class="btn small ghost" data-opt-edit="${o.id}" data-list="${list}">Editar</button>` : ''}</li>`,
    )}</ul></section>`;
}

export function bindOptionList(root, reload) {
  const form = (list, o = {}) =>
    modal({
      title: o.id ? `Editar "${o.label}"` : `Novo item — ${state.meta.list_labels[list]}`,
      body: html`<div class="grid">
        ${field({ name: 'label', label: 'Rótulo exibido', value: o.label, required: true, full: true })}
        ${!o.id ? field({ name: 'value', label: 'Identificador (opcional)', help: 'Gerado automaticamente a partir do rótulo. Usado em integrações e importações.' }) : ''}
        ${list === 'resultado_ligacao' ? field({ name: 'efetivo', label: 'Conta como contato efetivo (entra na taxa de contato)', type: 'checkbox', value: o.flags?.efetivo, full: true }) : ''}
        ${o.id ? field({ name: 'active', label: 'Ativo', type: 'checkbox', value: o.active }) : ''}
      </div>`,
      async onSubmit(d) {
        const flags = list === 'resultado_ligacao' ? { ...(o.flags || {}), efetivo: !!d.efetivo } : o.flags;
        await post('/api/opcoes', { id: o.id, list, label: d.label, value: d.value, active: d.active, flags });
        toast('Lista atualizada.');
        await refreshMeta();
        return true;
      },
    });
  on(root, 'click', '[data-opt-new]', async (e, b) => (await form(b.dataset.optNew)) && reload());
  on(root, 'click', '[data-opt-edit]', async (e, b) => {
    const o = state.meta.options[b.dataset.list].find((x) => x.id === Number(b.dataset.optEdit));
    if (await form(b.dataset.list, o)) reload();
  });
}

/* ------------------------- Tela ------------------------- */

const TABS = [
  ['funil', 'Etapas do funil', true],
  ['listas', 'Listas', true],
  ['campos', 'Campos', true],
  ['integracoes', 'Integrações', false],
  ['geral', 'Geral', true],
  ['auditoria', 'Auditoria', true],
];

export async function show(view, { id }) {
  const tabs = TABS.filter(([, , adminOnly]) => !adminOnly || can.admin());
  let tab = tabs.find(([k]) => k === id)?.[0] || tabs[0][0];
  render(view, html`<div class="page">
    <div class="page-head"><h1>Configurações</h1></div>
    ${can.admin() ? html`<p class="hint">Usuários, equipes e permissões ficam em <a href="#/usuarios">17. Usuários</a>.</p>` : ''}
    <nav class="tabs">${tabs.map(([k, l]) => html`<a href="#/configuracoes/${k}" data-tab="${k}" class="${tab === k ? 'active' : ''}">${l}</a>`)}</nav>
    <div id="tab"></div></div>`);
  const draw = async () => {
    const box = fresh($('#tab', view));
    try {
      await RENDER[tab](box, draw);
    } catch (e) {
      render(box, html`<div class="alert danger">${e.message}</div>`);
    }
  };
  on(view, 'click', '[data-tab]', (e, a) => {
    e.preventDefault();
    tab = a.dataset.tab;
    history.replaceState(null, '', `#/configuracoes/${tab}`);
    $$('[data-tab]', view).forEach((x) => x.classList.toggle('active', x === a));
    draw();
  });
  await draw();
}

const RENDER = {
  async funil(box, redraw) {
    const [stages, rules] = await Promise.all([get('/api/etapas'), get('/api/funil/regras')]);
    const active = stages.filter((s) => s.active);
    const KIND = { aberta: 'Aberta', ganho: 'Venda concluída', perdido: 'Perda', nutricao: 'Nutrição' };
    const ruleLabel = (k) => rules.rules.find((r) => r.key === k)?.label || k;
    render(box, html`<section class="card">
      <div class="section-head"><h3>Etapas do funil</h3><button class="btn primary" data-act="stage-new">+ Nova etapa</button></div>
      <p class="hint">Renomeie, reordene ou crie etapas. As etapas de "venda concluída" e "perda" são obrigatórias (a perda exige motivo). Etapas com oportunidades não podem ser desativadas.</p>
      <ol class="stage-admin">${stages.map(
        (s) => html`<li class="${s.active ? '' : 'inactive'}"><span><strong>${s.name}</strong> ${badge(KIND[s.kind])} <small class="muted">${s.opp_count} oportunidade(s)${s.rot_days ? ` · parada após ${s.rot_days} dia(s)` : ''}</small>${s.active ? '' : html` ${badge('inativa', 'muted')}`}
          ${s.key && rules.stage_rules[s.key]?.length ? html`<br><small>Para entrar: ${rules.stage_rules[s.key].map(ruleLabel).join(' · ')}</small>` : ''}</span>
          <span>${s.active ? html`<button class="btn small ghost" data-up="${s.id}" ${active[0]?.id === s.id ? 'disabled' : ''}>↑</button><button class="btn small ghost" data-down="${s.id}" ${active[active.length - 1]?.id === s.id ? 'disabled' : ''}>↓</button>` : ''}
          <button class="btn small" data-stage="${s.id}">Editar</button></span></li>`,
      )}</ol></section>
      <form class="card" id="rules"><h3>Regras de passagem entre etapas</h3>
        <p class="hint">Como nos CRMs de mercado (Pipedrive, RD Station), o negócio só entra numa etapa quando cumpre os critérios marcados. Assim um lead não pula direto para a venda: a etapa Venda só é alcançada pela confirmação do pagamento em Vendas.</p>
        ${field({ name: 'funnel_sequential', label: 'Avançar uma etapa por vez (o administrador pode forçar, com justificativa registrada na auditoria)', type: 'checkbox', value: rules.sequential, full: true })}
        <div class="table-wrap"><table class="matrix compact"><thead><tr><th>Critério</th>${active.filter((s) => s.key && !['prospect', 'perdido', 'nutricao'].includes(s.key)).map((s) => html`<th class="center">${s.name}</th>`)}</tr></thead>
          <tbody>${rules.rules.map((r) => html`<tr><td>${r.label}<br><small class="muted">${r.hint}</small></td>
            ${active.filter((s) => s.key && !['prospect', 'perdido', 'nutricao'].includes(s.key)).map((s) => html`<td class="center"><input type="checkbox" data-rule="${s.key}:${r.key}" aria-label="${r.label} em ${s.name}" ${(rules.stage_rules[s.key] || []).includes(r.key) ? 'checked' : ''} ${s.key === 'venda' ? 'disabled' : ''}></td>`)}</tr>`)}</tbody></table></div>
        <button class="btn primary" type="submit">Salvar regras</button></form>`);
    $('#rules', box).addEventListener('submit', async (e) => {
      e.preventDefault();
      const sr = {};
      for (const c of $$('[data-rule]', e.target)) {
        const [st, r] = c.dataset.rule.split(':');
        sr[st] = sr[st] || [];
        if (c.checked) sr[st].push(r);
      }
      try {
        await patch('/api/configuracoes', { stage_rules: sr, funnel_sequential: e.target.funnel_sequential.checked });
        await refreshMeta();
        toast('Regras do funil salvas.');
        redraw();
      } catch (ex) {
        toastError(ex);
      }
    });
    const move = async (id, dir) => {
      const ids = active.map((s) => s.id);
      const i = ids.indexOf(Number(id));
      const j = i + dir;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await post('/api/etapas/ordem', { ids });
      await refreshMeta();
      redraw();
    };
    on(box, 'click', '[data-up]', (e, b) => move(b.dataset.up, -1).catch(toastError));
    on(box, 'click', '[data-down]', (e, b) => move(b.dataset.down, 1).catch(toastError));
    const form = (s = {}) =>
      modal({
        title: s.id ? `Editar etapa` : 'Nova etapa',
        wide: true,
        body: html`<div class="grid">${field({ name: 'name', label: 'Nome', value: s.name, required: true, full: true })}
          ${!s.id ? field({ name: 'kind', label: 'Tipo', type: 'select', options: [{ value: 'aberta', label: 'Aberta (em andamento)' }, { value: 'nutricao', label: 'Nutrição / pausa' }], allowEmpty: false }) : ''}
          ${!['ganho', 'perdido'].includes(s.kind) ? field({ name: 'rot_days', label: 'Considerar parado após (dias sem atividade)', type: 'number', min: 1, step: '1', value: s.rot_days }) : ''}
          ${field({ name: 'playbook', label: 'Roteiro da etapa (o que o especialista deve fazer aqui)', type: 'textarea', rows: 4, value: s.playbook, full: true })}
          ${s.id && !['ganho', 'perdido'].includes(s.kind) ? field({ name: 'active', label: 'Ativa', type: 'checkbox', value: s.active }) : ''}</div>`,
        async onSubmit(d) {
          await post('/api/etapas', { ...d, id: s.id });
          await refreshMeta();
          toast('Etapa salva.');
          return true;
        },
      });
    on(box, 'click', '[data-act=stage-new]', async () => (await form()) && redraw());
    on(box, 'click', '[data-stage]', async (e, b) => (await form(stages.find((s) => s.id === Number(b.dataset.stage)))) && redraw());
  },

  async listas(box, redraw) {
    const lists = Object.entries(state.meta.list_labels);
    render(box, html`<p class="hint">Listas usadas nos cadastros, oportunidades e integrações. Itens desativados deixam de aparecer para seleção, mas os registros existentes são preservados.</p>
      <div class="cols">${lists.map(([k, l]) => optionListCard(k, l, k === 'resultado_ligacao' ? 'Marque como "efetivo" os resultados que indicam conversa com o lead. Eles definem a taxa de contato.' : k === 'motivo_perda' ? 'Obrigatório ao mover uma oportunidade para "Perdido".' : ''))}</div>`);
    bindOptionList(box, redraw);
  },

  async campos(box, redraw) {
    const cfg = structuredClone(state.meta.settings.field_config || {});
    const STD = {
      contact_pf: { label: 'Pessoa física', fields: { doc: 'CPF', rg: 'RG', birth_date: 'Data de nascimento', sex: 'Sexo', marital_status: 'Estado civil', property_regime: 'Regime de bens', spouse: 'Dados do cônjuge', birthplace: 'Naturalidade', nationality: 'Nacionalidade', mother_name: 'Nome da mãe', profession: 'Profissão', income_range: 'Renda mensal', net_worth_range: 'Patrimônio', phone1: 'Telefone 1', phone2: 'Telefone 2', whatsapp: 'WhatsApp', email: 'E-mail', address: 'Endereço completo', city: 'Cidade', state: 'UF', origin: 'Origem', temperature: 'Temperatura', pref_channel: 'Canal preferido', owner_id: 'Responsável' } },
      contact_pj: { label: 'Pessoa jurídica', fields: { legal_name: 'Razão social', trade_name: 'Nome fantasia', doc: 'CNPJ', state_registration: 'Inscrição estadual', opening_date: 'Data de abertura', main_activity: 'Atividade / CNAE', revenue_range: 'Faturamento', segment: 'Segmento', company_size: 'Porte', website: 'Site', legal_rep: 'Representante legal', phone1: 'Telefone 1', phone2: 'Telefone 2', whatsapp: 'WhatsApp', email: 'E-mail', address: 'Endereço completo', city: 'Cidade', state: 'UF', origin: 'Origem', temperature: 'Temperatura', company_contact: 'Contato da empresa' } },
    };
    const DEF_REC = { contact_pf: ['phone1', 'email', 'city', 'state', 'origin', 'pref_channel', 'temperature'], contact_pj: ['phone1', 'email', 'legal_name', 'doc', 'city', 'state', 'origin', 'company_contact', 'temperature'] };
    const DEF_SALE = {
      contact_pf: ['doc', 'rg', 'phone1', 'email', 'birthplace', 'nationality', 'sex', 'marital_status', 'birth_date', 'mother_name', 'profession', 'income_range', 'property_regime', 'spouse', 'address'],
      contact_pj: ['legal_name', 'doc', 'phone1', 'email', 'opening_date', 'main_activity', 'revenue_range', 'legal_rep', 'address'],
    };
    const isRec = (e, f) => (cfg[e]?.[f]?.recommended ?? DEF_REC[e].includes(f)) && cfg[e]?.[f]?.visible !== false;
    const isVis = (e, f) => cfg[e]?.[f]?.visible !== false;
    const isSale = (e, f) => DEF_SALE[e].includes(f) && cfg[e]?.[f]?.sale_required !== false;
    const NO_HIDE = ['phone1', 'origin', 'owner_id', 'company_contact', 'address', 'spouse', 'legal_rep'];
    const custom = state.meta.custom_fields;
    render(box, html`<form class="card" id="fcfg"><h3>Campos padrão do cadastro</h3>
        <p class="hint">Oculte campos que não são necessários para a operação (minimização de dados), defina quais aparecem como "recomendados" para completar depois e quais são obrigatórios para concluir a venda (ficha de pré-venda). O nome é sempre obrigatório.</p>
        <div class="cols">${Object.entries(STD).map(([e, g]) => html`<div><h4>${g.label}</h4><table class="compact"><thead><tr><th>Campo</th><th>Exibir</th><th>Recomendado</th><th>Obrigatório na venda</th></tr></thead><tbody>
          ${Object.entries(g.fields).map(([f, l]) => html`<tr><td>${l}</td><td><input type="checkbox" name="${e}.${f}.visible" ${isVis(e, f) ? 'checked' : ''} ${NO_HIDE.includes(f) ? 'disabled' : ''}></td><td><input type="checkbox" name="${e}.${f}.recommended" ${isRec(e, f) ? 'checked' : ''} ${['address', 'spouse', 'legal_rep'].includes(f) ? 'disabled' : ''}></td>
            <td>${DEF_SALE[e].includes(f) ? html`<input type="checkbox" name="${e}.${f}.sale_required" ${isSale(e, f) ? 'checked' : ''}>` : '—'}</td></tr>`)}
        </tbody></table></div>`)}</div>
        <button class="btn primary" type="submit">Salvar configuração</button></form>
      <section class="card"><div class="section-head"><h3>Campos adicionais</h3><button class="btn" data-act="cf-new">+ Novo campo</button></div>
        <p class="hint">Campos comerciais ou cadastrais extras, exibidos nos formulários de cadastro e de oportunidade.</p>
        ${table([
          { label: 'Rótulo', key: 'label' },
          { label: 'Onde', render: (f) => (f.entity === 'contact' ? 'Cadastro' : 'Oportunidade') },
          { label: 'Tipo', key: 'type' },
          { label: 'Opções', render: (f) => (f.options || []).join(', ') || '—' },
          { label: '', render: (f) => html`<button class="btn small" data-cf="${f.id}">Editar</button>` },
        ], custom, { emptyMsg: 'Nenhum campo adicional.' })}</section>`);
    $('#fcfg', box).addEventListener('submit', async (e) => {
      e.preventDefault();
      const out = {};
      for (const [ent, g] of Object.entries(STD)) {
        out[ent] = {};
        for (const f of Object.keys(g.fields)) {
          const vis = e.target.elements[`${ent}.${f}.visible`];
          const rec = e.target.elements[`${ent}.${f}.recommended`];
          const sale = e.target.elements[`${ent}.${f}.sale_required`];
          out[ent][f] = { visible: vis.disabled ? true : vis.checked, recommended: rec.disabled ? false : rec.checked, ...(sale ? { sale_required: sale.checked } : {}) };
        }
      }
      try {
        await patch('/api/configuracoes', { field_config: out });
        await refreshMeta();
        toast('Configuração de campos salva.');
      } catch (ex) {
        toastError(ex);
      }
    });
    const cfForm = (f = {}) =>
      modal({
        title: f.id ? 'Editar campo' : 'Novo campo adicional',
        body: html`<div class="grid">
          ${field({ name: 'label', label: 'Rótulo', value: f.label, required: true })}
          ${f.id ? '' : field({ name: 'entity', label: 'Exibir em', type: 'select', options: [{ value: 'contact', label: 'Cadastro (PF/PJ)' }, { value: 'opportunity', label: 'Oportunidade' }], allowEmpty: false })}
          ${field({ name: 'type', label: 'Tipo', type: 'select', options: [{ value: 'text', label: 'Texto' }, { value: 'textarea', label: 'Texto longo' }, { value: 'number', label: 'Número' }, { value: 'date', label: 'Data' }, { value: 'select', label: 'Lista de opções' }, { value: 'boolean', label: 'Sim/Não' }], value: f.type || 'text', allowEmpty: false })}
          ${field({ name: 'options', label: 'Opções (uma por linha, para "Lista de opções")', type: 'textarea', value: (f.options || []).join('\n'), full: true })}
          ${f.id ? field({ name: 'active', label: 'Ativo', type: 'checkbox', value: true }) : ''}
        </div>`,
        async onSubmit(d) {
          await post('/api/campos', { ...d, id: f.id, entity: f.entity || d.entity });
          await refreshMeta();
          toast('Campo salvo.');
          return true;
        },
      });
    on(box, 'click', '[data-act=cf-new]', async () => (await cfForm()) && redraw());
    on(box, 'click', '[data-cf]', async (e, b) => (await cfForm(custom.find((x) => x.id === Number(b.dataset.cf)))) && redraw());
  },

  async integracoes(box, redraw) {
    const list = await get('/api/integracoes');
    const base = location.origin;
    const endpoints = {
      discadora: [['POST', `${base}/api/integracoes/discadora/eventos`]],
      simulador: [['GET', `${base}/api/integracoes/simulador/contexto?token=…`], ['POST', `${base}/api/integracoes/simulador/simulacoes`]],
      api_leads: [['POST', `${base}/api/integracoes/leads`]],
      whatsapp: [['POST', `${base}/api/integracoes/whatsapp/mensagens`]],
      meta_ads: [],
    };
    render(box, html`<div class="alert">Nenhuma integração é considerada conectada sem validação: o status "Ativa" só pode ser marcado após o recebimento de ao menos um evento real processado com sucesso. Detalhes técnicos em <code>docs/INTEGRACOES.md</code>.</div>
      ${list.map((i) => html`<section class="card integ" data-key="${i.key}">
        <div class="section-head"><h3>${i.name}</h3>${statusIntegration(i.effective_status, i.effective_status_label)}</div>
        <p>${i.description}</p>
        <div class="kv">
          <div><span>Status configurado</span>${i.status_label}</div>
          <div><span>Último evento</span>${fmtDateTime(i.last_event_at)}</div>
          <div><span>Eventos</span>${i.stats.total || 0} (${i.stats.ok || 0} ok · ${i.stats.err || 0} erro · ${i.stats.unlinked || 0} sem vínculo · ${i.stats.dup || 0} duplicados)</div>
          <div><span>Validada</span>${i.validated_at ? `${fmtDateTime(i.validated_at)} por ${i.validated_by_name}` : 'não'}</div>
          ${i.last_error ? html`<div class="full"><span>Último erro</span><span class="warn-text">${i.last_error} (${fmtDateTime(i.last_error_at)})</span></div>` : ''}
          ${endpoints[i.key].length ? html`<div class="full"><span>Endpoints do CRM</span>${endpoints[i.key].map(([m, u]) => html`<code>${m} ${u}</code><br>`)}</div>` : ''}
          <div><span>Token de acesso</span>${i.has_token ? `configurado (${i.token_hint})` : 'não gerado'}</div>
        </div>
        ${can.admin() ? html`<div class="inline-actions">
          ${i.key !== 'meta_ads' ? html`<button class="btn small" data-int-token="${i.key}">${i.has_token ? 'Gerar novo token' : 'Gerar token'}</button>` : ''}
          <button class="btn small" data-int-config="${i.key}">Configurar</button>
          <button class="btn small ghost" data-int-logs="${i.key}">Registros</button>
          ${i.key === 'discadora' ? html`<button class="btn small ghost" data-int-preview>Testar mapeamento</button>` : ''}
        </div>` : ''}
      </section>`)}`);
    const byKey = Object.fromEntries(list.map((i) => [i.key, i]));
    on(box, 'click', '[data-int-token]', async (e, b) => {
      const key = b.dataset.intToken;
      if (byKey[key].has_token && !(await modal({ title: 'Gerar novo token', body: html`<p>O token atual deixará de funcionar imediatamente. Continuar?</p>`, submitLabel: 'Gerar', danger: true, onSubmit: () => true }))) return;
      try {
        const r = await post(`/api/integracoes/${key}/token`);
        await modal({ title: 'Token gerado', body: html`<p>Copie e guarde este token agora; ele não será exibido novamente. Envie-o no cabeçalho <code>Authorization: Bearer &lt;token&gt;</code>.</p><pre class="code selectable">${r.token}</pre>` });
        redraw();
      } catch (ex) {
        toastError(ex);
      }
    });
    on(box, 'click', '[data-int-logs]', async (e, b) => {
      const logs = await get(`/api/integracoes/${b.dataset.intLogs}/logs`, { limit: 100 });
      modal({
        title: `Registros — ${byKey[b.dataset.intLogs].name}`,
        wide: true,
        body: table([
          { label: 'Data', render: (l) => fmtDateTime(l.created_at) },
          { label: 'Evento', key: 'event_type' },
          { label: 'ID externo', render: (l) => l.external_id || '—' },
          { label: 'Status', render: (l) => badge(l.status, { sucesso: 'ok', erro: 'danger', sem_vinculo: 'warn', duplicado: 'muted' }[l.status] || '') },
          { label: 'Mensagem', render: (l) => l.message || '—' },
        ], logs, { emptyMsg: 'Nenhum registro.' }),
      });
    });
    on(box, 'click', '[data-int-preview]', () =>
      modal({
        title: 'Testar mapeamento da discadora (não grava nada)',
        wide: true,
        body: html`${field({ name: 'payload', label: 'Cole um evento de exemplo (JSON) enviado pela discadora', type: 'textarea', rows: 8, full: true, value: JSON.stringify({ id_chamada: 'abc-123', id_lead: 'C-000001', telefone: '11912345678', inicio: new Date().toISOString(), duracao_segundos: 95, agente: 'ramal-201', resultado: 'atendida' }, null, 2) })}<div class="preview-out"></div>`,
        submitLabel: 'Testar',
        async onSubmit(d, form) {
          let payload;
          try {
            payload = JSON.parse(d.payload);
          } catch {
            throw new Error('JSON inválido.');
          }
          const r = await post('/api/discadora/previa', payload);
          render($('.preview-out', form), html`<h4>Resultado do mapeamento</h4><pre class="code">${JSON.stringify(r, null, 2)}</pre>`);
          return false;
        },
      }),
    );
    on(box, 'click', '[data-int-config]', async (e, b) => {
      const i = byKey[b.dataset.intConfig];
      const cfg = i.config || {};
      const statusItems = Object.entries(state.meta.constants.integration_status).filter(([k]) => k !== 'erro').map(([value, label]) => ({ value, label }));
      const mappingRows = Object.entries(i.default_mapping || {});
      const resultMap = Object.entries(cfg.result_map || {}).map(([k, v]) => `${k}=${v}`).join('\n');
      const ok = await modal({
        title: `Configurar — ${i.name}`,
        wide: true,
        body: html`<div class="grid">
          ${field({ name: 'status', label: 'Status', type: 'select', options: statusItems, value: i.status, allowEmpty: false, help: 'Pendente/Desativada: recusa eventos. Em teste: recebe eventos para validação. Ativa: requer ao menos um evento processado com sucesso.' })}
          ${i.key === 'simulador' ? field({ name: 'base_url', label: 'URL do simulador', type: 'url', value: cfg.base_url, placeholder: 'https://simulador.suaempresa.com.br/nova', help: 'O CRM acrescenta ?crm_token=… com um token temporário por lead.' }) : ''}
          ${i.key === 'discadora' ? field({ name: 'store_recording_url', label: 'Armazenar link da gravação (somente se permitido pela política da empresa)', type: 'checkbox', value: cfg.store_recording_url, full: true }) : ''}
          ${i.key === 'whatsapp' ? field({ name: 'store_message_text', label: 'Armazenar o texto das mensagens no histórico', type: 'checkbox', value: cfg.store_message_text, full: true }) : ''}
          ${i.key === 'api_leads' ? field({ name: 'default_owner_id', label: 'Responsável padrão dos leads recebidos', type: 'select', options: userItems(), value: cfg.default_owner_id, placeholder: 'Sem responsável (gestor distribui)' }) : ''}
          ${field({ name: 'notes', label: 'Anotações (fornecedor, contato técnico, pendências)', type: 'textarea', value: i.notes, full: true })}
        </div>
        ${mappingRows.length ? html`<h4>Mapeamento de campos</h4><p class="hint">Informe o nome (ou caminho, ex.: <code>dados.telefone</code>) do campo no payload enviado pelo sistema externo.</p>
          <table class="compact"><thead><tr><th>Campo do CRM</th><th>Campo no payload</th></tr></thead><tbody>
          ${mappingRows.map(([k, def]) => html`<tr><td>${state.meta.constants.dialer_fields[k] && i.key === 'discadora' ? state.meta.constants.dialer_fields[k] : k}</td><td><input name="map.${k}" value="${i.mapping[k] || ''}" placeholder="${def}"></td></tr>`)}
          </tbody></table>` : ''}
        ${i.key === 'discadora' ? html`${field({ name: 'result_map', label: 'Mapa de resultados (código da discadora = valor do CRM, um por linha)', type: 'textarea', rows: 5, value: resultMap, full: true, help: `Valores do CRM: ${state.meta.options.resultado_ligacao.map((o) => o.value).join(', ')}. Resultados não mapeados ficam como "outro" (com o valor original preservado); ausentes ficam como "nao_informado".` })}` : ''}`,
        async onSubmit(d) {
          const body = { status: d.status, notes: d.notes };
          if ('base_url' in d) body.base_url = d.base_url;
          if ('store_recording_url' in d) body.store_recording_url = d.store_recording_url;
          if ('store_message_text' in d) body.store_message_text = d.store_message_text;
          if ('default_owner_id' in d) body.default_owner_id = d.default_owner_id;
          if (mappingRows.length) {
            body.mapping = {};
            for (const [k] of mappingRows) body.mapping[k] = d[`map.${k}`];
          }
          if ('result_map' in d) {
            body.result_map = {};
            for (const line of d.result_map.split('\n')) {
              const [k, ...v] = line.split('=');
              if (k.trim() && v.join('=').trim()) body.result_map[k.trim()] = v.join('=').trim();
            }
          }
          await patch(`/api/integracoes/${i.key}`, body);
          await refreshMeta();
          toast('Integração atualizada.');
          return true;
        },
      });
      if (ok) redraw();
    });
  },

  async geral(box) {
    const s = state.meta.settings;
    render(box, html`<form class="card" id="gen"><h3>Parâmetros gerais</h3><div class="grid">
      ${field({ name: 'stalled_days', label: 'Dias sem atividade para considerar um lead parado', type: 'number', value: s.stalled_days, min: 1 })}
      ${field({ name: 'simulation_link_hours', label: 'Validade do link do simulador (horas)', type: 'number', value: s.simulation_link_hours, min: 1 })}
      ${field({ name: 'client_link_days', label: 'Validade do link para o cliente atualizar os dados (dias)', type: 'number', value: s.client_link_days, min: 1 })}
      ${field({ name: 'finance_user_id', label: 'Responsável financeiro (recebe os alertas de parcelas em atraso)', type: 'select', options: userItems(), value: s.finance_user_id, placeholder: 'Responsável pelo cliente' })}
      ${field({ name: 'company_name', label: 'Nome da empresa (usado na pesquisa de satisfação)', value: s.company_name })}
      ${field({ name: 'logout_url', label: 'Site da empresa (para onde o usuário vai ao sair do sistema)', type: 'url', value: s.logout_url, placeholder: 'https://www.suaempresa.com.br', help: 'Em branco, o usuário volta para a tela de login.' })}
      ${field({ name: 'postsale_user_id', label: 'Responsável pós-venda padrão dos novos clientes', type: 'select', options: userItems(), value: s.postsale_user_id, placeholder: 'O especialista da venda' })}
      ${field({ name: 'nps_link_days', label: 'Validade do link da pesquisa de satisfação (dias)', type: 'number', value: s.nps_link_days, min: 1 })}
      ${field({ name: 'proposal_simulator_url', label: 'Endereço do simulador de propostas', type: 'url', value: s.proposal_simulator_url, full: true, help: 'O botão "Gerar proposta" abre este endereço com o nome completo e o contato do cliente (parâmetros nome e contato).' })}
      ${field({ name: 'presale_alert_hours', label: 'Alertar pré-venda sem acesso ou sem preenchimento após (horas)', type: 'number', value: s.presale_alert_hours, min: 1, help: 'Cria a tarefa urgente "Revisar pré-venda" para o especialista.' })}
      ${field({ name: 'require_sale_checklist', label: 'Exigir a ficha de pré-venda completa para concluir a venda', type: 'checkbox', value: s.require_sale_checklist, full: true })}
    </div><button class="btn primary" type="submit">Salvar</button></form>
    <form class="card" id="docs"><h3>Documentos obrigatórios para a venda</h3>
      <p class="hint">Marque os tipos de documento exigidos na ficha de pré-venda de cada tipo de pessoa. Os tipos podem ser editados em Listas › Tipos de documento.</p>
      <div class="cols">${['PF', 'PJ'].map((k) => html`<div><h4>${k === 'PF' ? 'Pessoa física' : 'Pessoa jurídica'}</h4>${(state.meta.options.tipo_documento || []).filter((o) => o.active).map((o) => html`<label class="check"><input type="checkbox" name="${k}.${o.value}" ${(s.doc_checklist?.[k] || []).includes(o.value) ? 'checked' : ''}> ${o.label}</label>`)}</div>`)}</div>
      <button class="btn primary" type="submit">Salvar documentos</button></form>
    <section class="card"><h3>Importações recentes</h3><div id="imports"></div><p><a href="#/importar">Nova importação →</a></p></section>`);
    $('#docs', box).addEventListener('submit', async (e) => {
      e.preventDefault();
      const dc = { PF: [], PJ: [] };
      for (const el of e.target.elements) if (el.type === 'checkbox' && el.checked) dc[el.name.split('.')[0]].push(el.name.split('.')[1]);
      try {
        await patch('/api/configuracoes', { doc_checklist: dc });
        await refreshMeta();
        toast('Documentos obrigatórios salvos.');
      } catch (ex) {
        toastError(ex);
      }
    });
    $('#gen', box).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await patch('/api/configuracoes', formData(e.target));
        await refreshMeta();
        toast('Configurações salvas.');
      } catch (ex) {
        toastError(ex);
      }
    });
    const imps = await get('/api/importacoes');
    render($('#imports', box), table([
      { label: 'Data', render: (i) => fmtDateTime(i.created_at) },
      { label: 'Arquivo', render: (i) => i.filename || '—' },
      { label: 'Usuário', render: (i) => i.user_name },
      { label: 'Linhas', key: 'total_rows', cls: 'num' },
      { label: 'Criados', key: 'created_count', cls: 'num' },
      { label: 'Duplicados', key: 'duplicate_count', cls: 'num' },
      { label: 'Erros', key: 'error_count', cls: 'num' },
    ], imps, { emptyMsg: 'Nenhuma importação.' }));
  },

  async auditoria(box) {
    const rows = await get('/api/auditoria');
    render(box, html`<section class="card"><h3>Últimas 300 alterações</h3>${table([
      { label: 'Data', render: (r) => fmtDateTime(r.created_at) },
      { label: 'Usuário', render: (r) => r.user_name || 'Sistema/integração' },
      { label: 'Registro', render: (r) => html`${r.entity}${r.entity_id ? ` #${r.entity_id}` : ''}${r.contact_code ? html`<br><a href="#/leads/${r.contact_id}">${r.contact_code}</a>` : ''}` },
      { label: 'Ação', key: 'action' },
      { label: 'Detalhes', render: (r) => (r.changes ? html`<code class="clip">${JSON.stringify(r.changes)}</code>` : '—') },
    ], rows)}</section>`);
  },
};
