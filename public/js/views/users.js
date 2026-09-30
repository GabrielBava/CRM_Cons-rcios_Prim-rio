// 16. Usuários: perfis (Administrador, Líder de equipe, Especialista, Somente leitura), equipes com líder
// e liberação de módulos por usuário (incluir ou retirar telas além do padrão do perfil).
import { get, post } from '../api.js';
import { html, render, raw, $, $$, on, fresh, table, badge, field, modal, toast, fmtDateTime, subnav, state } from '../ui.js';
import { refreshMeta } from './settings.js';

export async function show(view, { params = {} } = {}) {
  const tab = ['equipes', 'permissoes'].includes(params.aba) ? params.aba : 'usuarios';
  render(view, html`<div class="page">
    <div class="page-head"><div><h1>Usuários</h1><p class="muted">O perfil define quais registros o usuário enxerga; os módulos definem quais telas ele acessa. Tudo é verificado no servidor.</p></div></div>
    ${subnav([['#/usuarios', 'Usuários', 'usuarios'], ['#/usuarios?aba=equipes', 'Equipes e líderes', 'equipes'], ['#/usuarios?aba=permissoes', 'Perfis e permissões', 'permissoes']], tab)}
    <div id="tab"></div></div>`);
  const box = fresh($('#tab', view));
  const [users, teams, matrix] = await Promise.all([get('/api/usuarios'), get('/api/equipes'), get('/api/permissoes')]);
  const ctx = { users, teams, matrix, reload: () => show(view, { params }) };
  if (tab === 'equipes') return teamsTab(box, ctx);
  if (tab === 'permissoes') return matrixTab(box, ctx);
  return usersTab(box, ctx);
}

const roleLabel = (k) => state.meta.roles[k] || k;
const roleBadge = (k) => badge(roleLabel(k), { admin: 'danger', gestor: 'warn', consultor: 'ok', leitura: 'muted' }[k]);

function usersTab(box, { users, teams, matrix, reload }) {
  const mods = matrix.modules;
  render(box, html`<section class="card">
    <div class="section-head"><h3>Usuários</h3><button class="btn primary" data-act="new">+ Novo usuário</button></div>
    ${table(
      [
        { label: 'Nome', render: (u) => html`<strong>${u.name}</strong>${u.active ? '' : html` ${badge('Inativo', 'muted')}`}<br><small>${u.email}${u.phone ? ` · ${u.phone}` : ''}</small>` },
        { label: 'Perfil', render: (u) => roleBadge(u.role) },
        { label: 'Equipe', render: (u) => html`${u.team_name || '—'}${teams.some((t) => t.leader_id === u.id) ? html` ${badge('Líder', 'warn')}` : ''}` },
        {
          label: 'Módulos',
          render: (u) => html`${u.effective_modules.length} de ${mods.length}
            ${u.modules.add.length ? html`<br><small class="ok-text">+ ${u.modules.add.map((k) => mods.find((m) => m.key === k)?.label).join(', ')}</small>` : ''}
            ${u.modules.remove.length ? html`<br><small class="warn-text">− ${u.modules.remove.map((k) => mods.find((m) => m.key === k)?.label).join(', ')}</small>` : ''}`,
        },
        { label: 'Último acesso', render: (u) => fmtDateTime(u.last_login_at) },
        { label: '', render: (u) => html`<button class="btn small" data-edit="${u.id}">Editar</button>` },
      ],
      users,
    )}</section>`);
  on(box, 'click', '[data-act=new]', async () => (await userForm({}, { teams, matrix })) && reload());
  on(box, 'click', '[data-edit]', async (e, b) => (await userForm(users.find((u) => u.id === Number(b.dataset.edit)), { teams, matrix })) && reload());
}

/** Checkboxes de módulos: marcados conforme o padrão do perfil mais as inclusões/retiradas do usuário. */
function moduleBoxes(matrix, role, overrides = { add: [], remove: [] }) {
  const def = matrix.roles.find((r) => r.key === role)?.modules || [];
  const groups = [...new Set(matrix.modules.map((m) => m.group))];
  return html`${groups.map((g) => html`<div class="mod-group"><strong>${g}</strong>${matrix.modules.filter((m) => m.group === g).map((m) => {
    const locked = role === 'admin' || (matrix.admin_only.includes(m.key) && role !== 'admin');
    const checked = role === 'admin' || (!locked && (overrides.add.includes(m.key) || (def.includes(m.key) && !overrides.remove.includes(m.key))));
    const changed = !locked && checked !== def.includes(m.key);
    return html`<label class="check ${changed ? 'changed' : ''}"><input type="checkbox" data-mod="${m.key}" data-default="${def.includes(m.key) ? 1 : 0}" ${checked ? raw('checked') : ''} ${locked ? raw('disabled') : ''}> ${m.label}${changed ? html` <small>(${checked ? 'incluído' : 'retirado'})</small>` : ''}</label>`;
  })}</div>`)}`;
}

function userForm(u, { teams, matrix }) {
  const roleItems = matrix.roles.map((r) => ({ value: r.key, label: r.label }));
  const teamItems = teams.map((t) => ({ value: t.id, label: t.name }));
  const role0 = u.role || 'consultor';
  return modal({
    title: u.id ? `Editar ${u.name}` : 'Novo usuário',
    wide: true,
    body: html`<div class="grid">
        ${field({ name: 'name', label: 'Nome', value: u.name, required: true })}
        ${field({ name: 'email', label: 'E-mail (login)', type: 'email', value: u.email, required: true })}
        ${field({ name: 'phone', label: 'Telefone / WhatsApp', type: 'tel', value: u.phone })}
        ${field({ name: 'role', label: 'Perfil', type: 'select', options: roleItems, value: role0, allowEmpty: false })}
        ${field({ name: 'team_id', label: 'Equipe', type: 'select', options: teamItems, value: u.team_id, placeholder: 'Sem equipe' })}
        ${field({ name: 'dialer_agent_ref', label: 'ID do agente na discadora', value: u.dialer_agent_ref })}
        ${field({ name: 'password', label: u.id ? 'Nova senha (deixe vazio para manter)' : 'Senha inicial', type: 'password', required: !u.id, help: 'Mínimo de 8 caracteres.' })}
        ${u.id ? field({ name: 'active', label: 'Usuário ativo', type: 'checkbox', value: u.active }) : ''}
      </div>
      <p class="hint" data-scope>${matrix.roles.find((r) => r.key === role0)?.scope}</p>
      <h4>Telas liberadas</h4>
      <p class="hint">Marque ou desmarque para incluir ou retirar telas deste usuário. O padrão do perfil muda automaticamente ao trocar o perfil.</p>
      <div class="mod-boxes" data-mods>${moduleBoxes(matrix, role0, u.modules)}</div>`,
    onMount(form) {
      form.role.addEventListener('change', () => {
        render($('[data-mods]', form), moduleBoxes(matrix, form.role.value));
        $('[data-scope]', form).textContent = matrix.roles.find((r) => r.key === form.role.value)?.scope || '';
      });
    },
    async onSubmit(d, form) {
      const boxes = $$('[data-mod]:not(:disabled)', form);
      const modules = {
        add: boxes.filter((c) => c.checked && c.dataset.default === '0').map((c) => c.dataset.mod),
        remove: boxes.filter((c) => !c.checked && c.dataset.default === '1').map((c) => c.dataset.mod),
      };
      await post('/api/usuarios', { ...d, id: u.id, modules });
      toast('Usuário salvo.');
      await refreshMeta();
      return true;
    },
  });
}

function teamsTab(box, { users, teams, reload }) {
  const active = users.filter((u) => u.active);
  render(box, html`<section class="card">
    <div class="section-head"><h3>Equipes</h3><button class="btn primary" data-act="new">+ Nova equipe</button></div>
    <p class="hint">Cada equipe tem um líder (perfil Líder de equipe), que vê os registros, metas, comissões e cancelamentos do time e distribui leads dentro dele.</p>
    ${table(
      [
        { label: 'Equipe', render: (t) => html`<strong>${t.name}</strong>` },
        { label: 'Líder', render: (t) => html`${t.leader_name || html`<span class="warn-text">sem líder</span>`}` },
        { label: 'Especialistas', render: (t) => active.filter((u) => u.team_id === t.id && u.id !== t.leader_id).map((u) => u.name).join(', ') || '—' },
        { label: 'Membros', key: 'members', cls: 'num' },
        { label: '', render: (t) => html`<button class="btn small" data-edit="${t.id}">Editar</button>` },
      ],
      teams,
      { emptyMsg: 'Nenhuma equipe. Líderes sem equipe veem apenas os próprios registros.' },
    )}</section>
    ${active.some((u) => !u.team_id && u.role !== 'admin') ? html`<div class="alert warn">Sem equipe: ${active.filter((u) => !u.team_id && u.role !== 'admin').map((u) => u.name).join(', ')}. Edite o usuário para vinculá-lo a uma equipe.</div>` : ''}`);
  const form = (t = {}) =>
    modal({
      title: t.id ? `Editar ${t.name}` : 'Nova equipe',
      body: html`<div class="grid">${field({ name: 'name', label: 'Nome da equipe', value: t.name, required: true, full: true })}
        ${field({ name: 'leader_id', label: 'Líder', type: 'select', options: active.filter((u) => ['gestor', 'admin'].includes(u.role)).map((u) => ({ value: u.id, label: `${u.name} (${roleLabel(u.role)})` })), value: t.leader_id, placeholder: 'Sem líder', full: true, help: 'Só aparecem usuários com perfil Líder de equipe ou Administrador.' })}</div>`,
      async onSubmit(d) {
        await post('/api/equipes', { ...d, id: t.id });
        toast('Equipe salva.');
        await refreshMeta();
        return true;
      },
    });
  on(box, 'click', '[data-act=new]', async () => (await form()) && reload());
  on(box, 'click', '[data-edit]', async (e, b) => (await form(teams.find((t) => t.id === Number(b.dataset.edit)))) && reload());
}

function matrixTab(box, { matrix, users }) {
  render(box, html`<section class="card">
    <h3>Perfis e acesso padrão</h3>
    <div class="table-wrap"><table class="matrix"><thead><tr><th>Módulo</th>${matrix.roles.map((r) => html`<th class="center">${r.label}</th>`)}</tr></thead>
      <tbody>${matrix.modules.map((m) => html`<tr><td>${m.label}<br><small class="muted">${m.group}${matrix.admin_only.includes(m.key) ? ' · exclusivo do administrador' : ''}</small></td>
        ${matrix.roles.map((r) => html`<td class="center">${r.modules.includes(m.key) ? html`<span class="ok-text" aria-label="liberado">✓</span>` : html`<span class="muted" aria-label="não liberado">—</span>`}</td>`)}</tr>`)}</tbody>
      <tfoot><tr><td><strong>Escopo de dados</strong></td>${matrix.roles.map((r) => html`<td><small>${r.scope}</small></td>`)}</tr>
        <tr><td><strong>Usuários ativos</strong></td>${matrix.roles.map((r) => html`<td class="center">${users.filter((u) => u.active && u.role === r.key).length}</td>`)}</tr></tfoot></table></div>
    <p class="hint">Boas práticas de mercado (controle de acesso por perfil): conceda o mínimo necessário, revise os acessos a cada trimestre e desative o usuário no mesmo dia do desligamento. Todas as alterações ficam na auditoria.</p>
  </section>`);
}
