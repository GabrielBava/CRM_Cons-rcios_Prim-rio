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
  ['usuarios', 'Usuários e equipes', true],
  ['funil', 'Etapas do funil', true],
  ['listas', 'Listas', true],
  ['campos', 'Campos', true],
  ['integracoes', 'Integrações', false],
  ['geral', 'Geral', true],
  ['auditoria', 'Auditoria', true],
  ['conta', 'Minha conta', false],
];

export async function show(view, { id }) {
  const tabs = TABS.filter(([, , adminOnly]) => !adminOnly || can.admin());
  let tab = tabs.find(([k]) => k === id)?.[0] || tabs[0][0];
  render(view, html`<div class="page">
    <div class="page-head"><h1>Configurações e usuários</h1></div>
    ${!can.admin() ? html`<p class="hint">Seu perfil (${state.user.role_label}) pode consultar o status das integrações e alterar a própria senha. Demais configurações são exclusivas de administradores.</p>` : ''}
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
  async usuarios(box, redraw) {
    const [users, teams] = await Promise.all([get('/api/usuarios'), get('/api/equipes')]);
    render(box, html`<section class="card">
      <div class="section-head"><h3>Usuários</h3><button class="btn primary" data-act="user-new">+ Novo usuário</button></div>
      <div class="alert">Perfis: <strong>Administrador</strong> acessa tudo; <strong>Gestor</strong> acessa registros da própria equipe (e cadastros sem responsável); <strong>Consultor</strong> acessa apenas os próprios leads e oportunidades; <strong>Leitura</strong> consulta sem editar ou exportar dados pessoais. As permissões são verificadas no servidor.</div>
      ${table(
        [
          { label: 'Nome', render: (u) => html`<strong>${u.name}</strong>${u.active ? '' : html` ${badge('Inativo', 'muted')}`}<br><small>${u.email}</small>` },
          { label: 'Perfil', render: (u) => state.meta.roles[u.role] },
          { label: 'Equipe', render: (u) => u.team_name || '—' },
          { label: 'ID na discadora', render: (u) => u.dialer_agent_ref || '—' },
          { label: 'Último acesso', render: (u) => fmtDateTime(u.last_login_at) },
          { label: '', render: (u) => html`<button class="btn small" data-user="${u.id}">Editar</button>` },
        ],
        users,
      )}</section>
      <section class="card"><div class="section-head"><h3>Equipes</h3><button class="btn" data-act="team-new">+ Nova equipe</button></div>
        ${table([{ label: 'Equipe', key: 'name' }, { label: 'Membros', key: 'members', cls: 'num' }, { label: '', render: (t) => html`<button class="btn small" data-team="${t.id}">Renomear</button>` }], teams, { emptyMsg: 'Nenhuma equipe. Gestores sem equipe veem apenas os próprios registros.' })}
      </section>`);
    const roleItems = Object.entries(state.meta.roles).map(([value, label]) => ({ value, label }));
    const teamItems = teams.map((t) => ({ value: t.id, label: t.name }));
    const userForm = (u = {}) =>
      modal({
        title: u.id ? `Editar ${u.name}` : 'Novo usuário',
        body: html`<div class="grid">
          ${field({ name: 'name', label: 'Nome', value: u.name, required: true })}
          ${field({ name: 'email', label: 'E-mail (login)', type: 'email', value: u.email, required: true })}
          ${field({ name: 'role', label: 'Perfil', type: 'select', options: roleItems, value: u.role || 'consultor', allowEmpty: false })}
          ${field({ name: 'team_id', label: 'Equipe', type: 'select', options: teamItems, value: u.team_id, placeholder: 'Sem equipe' })}
          ${field({ name: 'dialer_agent_ref', label: 'ID do agente na discadora', value: u.dialer_agent_ref, help: 'Usado para atribuir as ligações recebidas da discadora.' })}
          ${field({ name: 'password', label: u.id ? 'Nova senha (deixe vazio para manter)' : 'Senha inicial', type: 'password', required: !u.id, help: 'Mínimo de 8 caracteres.' })}
          ${u.id ? field({ name: 'active', label: 'Usuário ativo', type: 'checkbox', value: u.active }) : ''}
        </div>`,
        async onSubmit(d) {
          await post('/api/usuarios', { ...d, id: u.id });
          toast('Usuário salvo.');
          await refreshMeta();
          return true;
        },
      });
    on(box, 'click', '[data-act=user-new]', async () => (await userForm()) && redraw());
    on(box, 'click', '[data-user]', async (e, b) => (await userForm(users.find((u) => u.id === Number(b.dataset.user)))) && redraw());
    const teamForm = (t = {}) => modal({ title: t.id ? 'Renomear equipe' : 'Nova equipe', body: field({ name: 'name', label: 'Nome', value: t.name, required: true, full: true }), onSubmit: (d) => post('/api/equipes', { ...d, id: t.id }) });
    on(box, 'click', '[data-act=team-new]', async () => (await teamForm()) && redraw());
    on(box, 'click', '[data-team]', async (e, b) => (await teamForm(teams.find((t) => t.id === Number(b.dataset.team)))) && redraw());
  },

  async funil(box, redraw) {
    const stages = await get('/api/etapas');
    const active = stages.filter((s) => s.active);
    const KIND = { aberta: 'Aberta', ganho: 'Venda concluída', perdido: 'Perda', nutricao: 'Nutrição' };
    render(box, html`<section class="card">
      <div class="section-head"><h3>Etapas do funil</h3><button class="btn primary" data-act="stage-new">+ Nova etapa</button></div>
      <p class="hint">Renomeie, reordene ou crie etapas. As etapas de "venda concluída" e "perda" são obrigatórias (a perda exige motivo). Etapas com oportunidades não podem ser desativadas.</p>
      <ol class="stage-admin">${stages.map(
        (s) => html`<li class="${s.active ? '' : 'inactive'}"><span><strong>${s.name}</strong> ${badge(KIND[s.kind])} <small class="muted">${s.opp_count} oportunidade(s)</small>${s.active ? '' : html` ${badge('inativa', 'muted')}`}</span>
          <span>${s.active ? html`<button class="btn small ghost" data-up="${s.id}" ${active[0]?.id === s.id ? 'disabled' : ''}>↑</button><button class="btn small ghost" data-down="${s.id}" ${active[active.length - 1]?.id === s.id ? 'disabled' : ''}>↓</button>` : ''}
          <button class="btn small" data-stage="${s.id}">Editar</button></span></li>`,
      )}</ol></section>`);
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
        body: html`<div class="grid">${field({ name: 'name', label: 'Nome', value: s.name, required: true, full: true })}
          ${!s.id ? field({ name: 'kind', label: 'Tipo', type: 'select', options: [{ value: 'aberta', label: 'Aberta (em andamento)' }, { value: 'nutricao', label: 'Nutrição / pausa' }], allowEmpty: false }) : ''}
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
      contact_pf: { label: 'Pessoa física', fields: { doc: 'CPF', birth_date: 'Data de nascimento', profession: 'Profissão', phone1: 'Telefone principal', phone2: 'Telefone secundário', whatsapp: 'WhatsApp', email: 'E-mail', city: 'Cidade', state: 'UF', origin: 'Origem', campaign: 'Campanha', pref_channel: 'Canal preferido', owner_id: 'Responsável' } },
      contact_pj: { label: 'Pessoa jurídica', fields: { legal_name: 'Razão social', trade_name: 'Nome fantasia', doc: 'CNPJ', state_registration: 'Inscrição estadual', segment: 'Segmento', company_size: 'Porte', website: 'Site', phone1: 'Telefone principal', phone2: 'Telefone secundário', whatsapp: 'WhatsApp', email: 'E-mail', city: 'Cidade', state: 'UF', origin: 'Origem', company_contact: 'Contato da empresa' } },
    };
    const DEF_REC = { contact_pf: ['phone1', 'email', 'city', 'state', 'origin', 'pref_channel'], contact_pj: ['phone1', 'email', 'legal_name', 'doc', 'city', 'state', 'origin', 'company_contact'] };
    const isRec = (e, f) => (cfg[e]?.[f]?.recommended ?? DEF_REC[e].includes(f)) && cfg[e]?.[f]?.visible !== false;
    const isVis = (e, f) => cfg[e]?.[f]?.visible !== false;
    const custom = state.meta.custom_fields;
    render(box, html`<form class="card" id="fcfg"><h3>Campos padrão do cadastro</h3>
        <p class="hint">Oculte campos que não são necessários para a operação (minimização de dados) e defina quais aparecem como "recomendados" para completar depois. O nome é sempre obrigatório.</p>
        <div class="cols">${Object.entries(STD).map(([e, g]) => html`<div><h4>${g.label}</h4><table class="compact"><thead><tr><th>Campo</th><th>Exibir</th><th>Recomendado</th></tr></thead><tbody>
          ${Object.entries(g.fields).map(([f, l]) => html`<tr><td>${l}</td><td><input type="checkbox" name="${e}.${f}.visible" ${isVis(e, f) ? 'checked' : ''} ${['phone1', 'origin', 'owner_id', 'company_contact'].includes(f) ? 'disabled' : ''}></td><td><input type="checkbox" name="${e}.${f}.recommended" ${isRec(e, f) ? 'checked' : ''}></td></tr>`)}
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
          out[ent][f] = { visible: vis.disabled ? true : vis.checked, recommended: rec.checked };
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
    </div><button class="btn primary" type="submit">Salvar</button></form>
    <section class="card"><h3>Importações recentes</h3><div id="imports"></div><p><a href="#/importar">Nova importação →</a></p></section>`);
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

  async conta(box) {
    render(box, html`<form class="card narrow" id="pw"><h3>Alterar minha senha</h3>
      ${field({ name: 'current', label: 'Senha atual', type: 'password', required: true })}
      ${field({ name: 'password', label: 'Nova senha (mín. 8 caracteres)', type: 'password', required: true })}
      <button class="btn primary" type="submit">Alterar senha</button></form>`);
    $('#pw', box).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await post('/api/me/senha', formData(e.target));
        toast('Senha alterada.');
        e.target.reset();
      } catch (ex) {
        toastError(ex);
      }
    });
  },
};
