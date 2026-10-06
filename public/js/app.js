// Estrutura da aplicação: autenticação, navegação, busca global e roteamento.
import { get, post, setUnauthorizedHandler } from './api.js';
import { html, render, state, $, $$, on, toastError, relBadge, can, fresh, avatar, relTime } from './ui.js';
import { quickCreateContact } from './forms.js';
import * as dashboard from './views/dashboard.js';
import * as leads from './views/leads.js';
import * as contact from './views/contact.js';
import * as pipeline from './views/pipeline.js';
import * as agenda from './views/agenda.js';
import * as activities from './views/activities.js';
import * as sales from './views/sales.js';
import * as clients from './views/clients.js';
import * as reports from './views/reports.js';
import * as settings from './views/settings.js';
import * as importer from './views/import.js';
import * as financeView from './views/finance.js';
import * as publicForm from './views/public-form.js';
import * as distribution from './views/distribution.js';
import * as simulator from './views/simulator.js';
import * as proposalsView from './views/proposals.js';
import * as goals from './views/goals.js';
import * as presales from './views/presales.js';
import * as salesView from './views/salesview.js';
import * as commissions from './views/commissions.js';
import * as trainings from './views/trainings.js';
import * as administrators from './views/administrators.js';
import * as plans from './views/plans.js';
import * as users from './views/users.js';
import * as profileView from './views/profile.js';
import * as postsaleView from './views/postsale.js';
import * as treasuryView from './views/treasury.js';
import * as onboardingView from './views/onboarding.js';
import { icon } from './icons.js';

// Menu lateral: [rota, rótulo, tela, módulo de permissão, grupo]
const NAV = [
  ['painel', 'Painel inicial', dashboard, 'painel'],
  ['entrada', 'Prospects e leads', distribution, 'distribuicao'],
  ['funil', 'CRM', pipeline, 'crm'],
  ['agenda', 'Agenda e tarefas', agenda, 'agenda'],
  ['simulador', 'Simulador', simulator, 'simulador'],
  ['propostas', 'Propostas', proposalsView, 'propostas'],
  ['clientes', 'Clientes', clients, 'clientes'],
  ['metas', 'Metas', goals, 'metas'],
  ['prevenda', 'Pré-venda', presales, 'prevenda'],
  ['vendas', 'Vendas', salesView, 'vendas'],
  ['posvenda', 'Pós-venda', postsaleView, 'posvenda'],
  ['comissoes', 'Comissões e cancelamentos', commissions, 'comissoes'],
  ['treinamentos', 'Treinamentos', trainings, 'treinamentos'],
  ['administradoras', 'Administradoras', administrators, 'administradoras', 'admin'],
  ['planos', 'Planos', plans, 'planos', 'admin'],
  ['relatorios', 'Relatórios', reports, 'relatorios', 'admin'],
  ['usuarios', 'Usuários', users, 'usuarios', 'admin'],
  ['configuracoes', 'Configurações', settings, 'configuracoes', 'admin'],
];
// Rotas secundárias: [tela, módulo, item do menu destacado]
const EXTRA = {
  oportunidades: [pipeline, 'crm', 'funil'],
  leads: [leads, 'crm', 'funil'],
  atividades: [activities, 'crm', 'funil'],
  importar: [importer, 'crm', 'funil'],
  simulacoes: [sales, 'propostas', 'propostas'],
  'parcelas-clientes': [financeView, 'clientes', 'clientes'],
  financeiro: [treasuryView, 'financeiro', 'financeiro'],
  produtos: [plans, 'planos', 'planos'],
  'meu-cadastro': [profileView, null, null],
  integracao: [onboardingView, null, 'painel'],
};
// Ícone de cada item do menu (manual de identidade, Iconografia)
const NAV_ICON = { painel: 'painel', entrada: 'leads', funil: 'crm', agenda: 'agenda', simulador: 'simulador', propostas: 'propostas', clientes: 'clientes', metas: 'metas', prevenda: 'prevenda', vendas: 'vendas', posvenda: 'posvenda', comissoes: 'comissoes', treinamentos: 'treinamentos', administradoras: 'administradoras', planos: 'planos', relatorios: 'relatorios', usuarios: 'usuarios', configuracoes: 'configuracoes' };
const navLink = ([k, label]) => html`<a href="#/${k}" data-nav="${k}">${icon(NAV_ICON[k])}<span>${label}</span></a>`;
const allowed = (mod) => (state.user?.modules || []).includes(mod);
// Financeiro da empresa: grupo próprio no menu. Quem não tem o módulo, mas é responsável por lançamentos, vê só pagar/receber.
const finAccess = () => allowed('financeiro') || !!state.user?.fin_responsible;
function finNav() {
  if (!finAccess()) return '';
  const full = allowed('financeiro');
  const links = [
    ...(full && state.user.role === 'admin' ? [['financeiro', 'Visão geral', 'financeiro']] : []),
    ['financeiro/pagar', 'Contas a pagar', 'saida'],
    ['financeiro/receber', 'Contas a receber', 'entrada'],
    ...(full ? [['financeiro/cadastros', 'Cadastros', 'cadastros']] : []),
  ];
  return html`<div class="nav-group">Financeiro</div>${links.map(([k, label, ic]) => html`<a href="#/${k}" data-nav="${k}">${icon(ic)}<span>${label}</span></a>`)}`;
}

const app = document.getElementById('app');

/** Versão de teste: ao abrir a página do cliente na mesma aba, mostra um atalho de volta ao CRM. */
function previewBackLink(show) {
  document.getElementById('pv-back')?.remove();
  if (!show || !window.CRM_PREVIEW) return;
  document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove());
  const a = document.createElement('a');
  a.id = 'pv-back';
  a.href = '#/painel';
  a.textContent = '← Voltar ao CRM (versão de teste)';
  document.body.appendChild(a);
}

async function boot() {
  stopNotifications();
  previewBackLink(/^#\/(ficha|nps)\//.test(location.hash));
  // Link enviado ao cliente: página pública, sem login
  const pub = location.hash.match(/^#\/ficha\/([A-Za-z0-9_-]+)/);
  if (pub) return publicForm.show(app, pub[1]);
  // Pesquisa de satisfação enviada ao cliente: página pública, sem login
  const nps = location.hash.match(/^#\/nps\/([A-Za-z0-9_-]+)/);
  if (nps) return publicForm.showNps(app, nps[1]);
  setUnauthorizedHandler(() => showLogin('Sua sessão expirou. Entre novamente.'));
  try {
    const s = await get('/api/setup');
    if (s.needs_setup) return showSetup();
    state.meta = await get('/api/meta');
    state.user = state.meta.user;
    // Senha provisória: primeiro a troca obrigatória
    if (state.user.must_change_password) {
      return onboardingView.firstPasswordScreen(app, {
        onDone: () => {
          location.hash = '#/painel';
          boot();
        },
        onLogout: async () => {
          await post('/api/logout').catch(() => {});
          showLogin();
        },
      });
    }
    shell();
    route();
  } catch (e) {
    if (e.status === 401) showLogin();
    else render(app, html`<div class="auth"><div class="card"><h1>Erro</h1><p>${e.message}</p></div></div>`);
  }
}

function showSetup() {
  render(app, html`<div class="auth"><form class="card" id="setup">
    <div class="auth-brand"><span class="brand-logo" role="img" aria-label="Vero Consórcios"></span></div><h1>Primeiro acesso</h1><p class="muted">Crie o usuário administrador.</p>
    <label>Nome<input name="name" required autocomplete="name"></label>
    <label>E-mail<input name="email" type="email" required autocomplete="email"></label>
    <label>Senha (mín. 8 caracteres)<input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
    <div class="modal-error" hidden></div>
    <button class="btn primary" type="submit">Criar administrador</button></form></div>`);
  $('#setup').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await post('/api/setup', { name: f.name.value, email: f.email.value, password: f.password.value });
      boot();
    } catch (err) {
      const b = f.querySelector('.modal-error');
      b.hidden = false;
      b.textContent = err.message;
    }
  });
}

function showLogin(msg) {
  stopNotifications();
  state.meta = null;
  render(app, html`<div class="auth"><form class="card" id="login">
    <div class="auth-brand"><span class="brand-logo" role="img" aria-label="Vero Consórcios"></span></div><h1>Entrar</h1>${msg ? html`<p class="warn-text">${msg}</p>` : html`<p class="muted">Use seu e-mail e senha de acesso.</p>`}
    <label>E-mail<input name="email" type="email" required autocomplete="username"></label>
    <label>Senha<input name="password" type="password" required autocomplete="current-password"></label>
    <div class="modal-error" hidden></div>
    <button class="btn primary" type="submit">Entrar</button></form></div>`);
  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await post('/api/login', { email: f.email.value, password: f.password.value });
      boot();
    } catch (err) {
      const b = f.querySelector('.modal-error');
      b.hidden = false;
      b.textContent = err.message;
    }
  });
}

function userBox() {
  const u = state.user;
  return html`<button class="user-btn" data-act="usermenu" aria-haspopup="menu" aria-expanded="false" aria-label="Menu do usuário">
      ${avatar(u, 32)}<span class="user-id"><strong>${u.name}</strong><small>${u.job_title || u.role_label}</small></span><span class="caret">${icon('abaixo', 16)}</span></button>
    <div class="user-dropdown" role="menu" hidden>
      <div class="ud-head">${avatar(u, 44)}<div><strong>${u.name}</strong><small>${u.email}</small><small>${u.role_label}</small></div></div>
      <a href="#/meu-cadastro" role="menuitem" data-close-menu>${icon('clientes', 16)}Meu cadastro</a>
      <button type="button" role="menuitem" data-act="password">${icon('senha', 16)}Alterar senha</button>
      <hr>
      <button type="button" role="menuitem" data-act="logout" class="danger-text">${icon('sair', 16)}Sair</button>
    </div>`;
}

const BELL = icon('sino', 18);

/* ---------- Tema claro/escuro (preferência do usuário neste navegador) ---------- */
const effectiveTheme = () => document.documentElement.getAttribute('data-theme') || (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
function themeToggle() {
  const t = effectiveTheme();
  return html`<div class="theme-toggle" role="group" aria-label="Tema">
    <button type="button" data-theme-set="light" aria-pressed="${t === 'light'}">${icon('sol', 14)}<span>Claro</span></button>
    <button type="button" data-theme-set="dark" aria-pressed="${t === 'dark'}">${icon('lua', 14)}<span>Escuro</span></button></div>`;
}

function shell() {
  render(app, html`
    <aside class="sidebar" id="sidebar">
      <a class="brand" href="#/painel" aria-label="Vero Consórcios — painel inicial"><span class="brand-logo" role="img" aria-label="Vero Consórcios"></span></a>
      <nav>${NAV.filter(([, , , m, g]) => allowed(m) && g !== 'admin').map(navLink)}
        ${finNav()}
        ${NAV.some(([, , , m, g]) => g === 'admin' && allowed(m)) ? html`<div class="nav-group">Administração</div>${NAV.filter(([, , , m, g]) => g === 'admin' && allowed(m)).map(navLink)}` : ''}</nav>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="icon-btn menu-btn" data-act="menu" aria-label="Abrir menu">${icon('menu', 20)}</button>
        <div class="search">
          ${icon('buscar', 16)}<input type="search" id="gsearch" placeholder="Buscar por nome, telefone, e-mail, CPF/CNPJ ou ID (C-000001, OP-…)" autocomplete="off" aria-label="Busca global" aria-keyshortcuts="Control+K"><kbd class="kbd">Ctrl K</kbd>
          <div class="search-results" hidden></div>
        </div>
        ${can.write() ? html`<button class="btn primary" data-act="new-lead">${icon('adicionar', 16)}<span>Novo lead</span></button>` : ''}
        <div class="top-right">
          ${themeToggle()}
          <div class="notif">
            <button class="icon-btn bell" data-act="notif" aria-haspopup="true" aria-expanded="false" aria-label="Notificações">${BELL}<span class="notif-badge" hidden></span></button>
            <div class="notif-panel" hidden></div>
          </div>
          <div class="usermenu" id="userbox">${userBox()}</div>
        </div>
      </header>
      <main id="view" tabindex="-1"></main>
    </div>`);
  const closeMenus = (except) => {
    for (const [btn, panel] of [['[data-act=usermenu]', '.user-dropdown'], ['[data-act=notif]', '.notif-panel']]) {
      if (panel === except) continue;
      const p = $(panel, app);
      if (p) p.hidden = true;
      $(btn, app)?.setAttribute('aria-expanded', 'false');
    }
  };
  on(app, 'click', '[data-act=usermenu]', (e, b) => {
    const p = $('.user-dropdown', app);
    closeMenus('.user-dropdown');
    p.hidden = !p.hidden;
    b.setAttribute('aria-expanded', String(!p.hidden));
  });
  on(app, 'click', '[data-act=notif]', (e, b) => {
    const p = $('.notif-panel', app);
    closeMenus('.notif-panel');
    p.hidden = !p.hidden;
    b.setAttribute('aria-expanded', String(!p.hidden));
    if (!p.hidden) loadNotifications(true);
  });
  on(app, 'click', '[data-close-menu]', () => closeMenus());
  // Ouvintes globais só uma vez (o shell é recriado a cada login)
  if (!window.__crmMenus) {
    window.__crmMenus = true;
    // Ctrl+K (ou Cmd+K) leva para a busca global
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        const g = document.getElementById('gsearch');
        if (g) {
          e.preventDefault();
          g.focus();
          g.select();
        }
      }
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.usermenu') && !e.target.closest('.notif')) closeMenusGlobal();
    });
    document.addEventListener('keydown', (e) => e.key === 'Escape' && closeMenusGlobal());
  }
  on(app, 'click', '[data-act=password]', () => {
    closeMenus();
    profileView.changePasswordDialog();
  });
  on(app, 'click', '[data-act=logout]', async () => {
    const url = state.meta?.settings?.logout_url;
    stopNotifications();
    await post('/api/logout').catch(() => {});
    if (url) location.href = url;
    else showLogin();
  });
  on(app, 'click', '[data-theme-set]', (e, b) => {
    const t = b.dataset.themeSet;
    document.documentElement.setAttribute('data-theme', t);
    try {
      localStorage.setItem('crm-theme', t);
    } catch {}
    $$('[data-theme-set]', app).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });
  on(app, 'click', '[data-act=menu]', () => $('#sidebar').classList.toggle('open'));
  on(app, 'click', '[data-nav], .brand', () => $('#sidebar').classList.remove('open'));
  on(app, 'click', '[data-act=new-lead]', () => quickCreateContact());
  on(app, 'click', '[data-act=notif-all]', async () => {
    await post('/api/notificacoes/lidas', { all: true }).catch(toastError);
    loadNotifications(true);
  });
  on(app, 'click', '[data-notif]', (e, a) => {
    post('/api/notificacoes/lidas', { ids: [Number(a.dataset.notif)] }).then(() => loadNotifications(false)).catch(() => {});
    closeMenus();
  });
  setupSearch();
  startNotifications();
}

function closeMenusGlobal() {
  for (const [btn, panel] of [['[data-act=usermenu]', '.user-dropdown'], ['[data-act=notif]', '.notif-panel']]) {
    const p = $(panel, app);
    if (p) p.hidden = true;
    $(btn, app)?.setAttribute('aria-expanded', 'false');
  }
}

/* ---------- Notificações (sino) ---------- */
let notifTimer = null;
let notifLast = 0;
async function loadNotifications(renderPanel) {
  if (!state.user || !$('.notif-badge', app)) return;
  notifLast = Date.now();
  let d;
  try {
    d = await get('/api/notificacoes', { limit: 30 });
  } catch {
    return;
  }
  const badge = $('.notif-badge', app);
  badge.hidden = !d.unread;
  badge.textContent = d.unread > 99 ? '99+' : String(d.unread);
  $('[data-act=notif]', app)?.setAttribute('aria-label', d.unread ? `Notificações: ${d.unread} não lida(s)` : 'Notificações');
  const panel = $('.notif-panel', app);
  if (!renderPanel && panel.hidden) return;
  render(panel, html`<div class="np-head"><strong>Notificações</strong>${d.unread ? html`<button type="button" class="link-btn" data-act="notif-all">Marcar todas como lidas</button>` : ''}</div>
    <div class="np-list">${d.rows.length
      ? d.rows.map((n) => html`<a href="${n.link || '#/painel'}" class="np-item lvl-${n.level} ${n.read_at ? '' : 'unread'}" data-notif="${n.id}">
          <span class="np-dot" aria-hidden="true"></span><span class="np-text"><strong>${n.title}</strong>${n.body ? html`<small>${n.body}</small>` : ''}<small class="muted">${relTime(n.created_at)}</small></span></a>`)
      : html`<div class="empty small">Nenhuma notificação por enquanto.</div>`}</div>`);
}
function startNotifications() {
  stopNotifications();
  loadNotifications(false);
  notifTimer = setInterval(() => loadNotifications(false), 60000);
}
function stopNotifications() {
  if (notifTimer) clearInterval(notifTimer);
  notifTimer = null;
}

function setupSearch() {
  const input = $('#gsearch');
  const box = $('.search-results');
  let timer;
  let seq = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) {
      box.hidden = true;
      return;
    }
    timer = setTimeout(async () => {
      const my = ++seq;
      try {
        const rows = await get('/api/busca', { q });
        if (my !== seq) return;
        const link = (r) =>
          r.kind === 'contact' ? `#/leads/${r.id}` : r.kind === 'opportunity' ? `#/oportunidades/${r.id}` : `#/leads/${r.contact_id}`;
        render(
          box,
          rows.length
            ? html`${rows.map((r) => html`<a href="${link(r)}" class="sr"><strong>${r.title}</strong> ${r.relationship ? relBadge(r.relationship) : ''}<small>${r.code}${r.subtitle ? ` · ${r.subtitle}` : ''}</small></a>`)}`
            : html`<div class="sr muted">Nenhum resultado.</div>`,
        );
        box.hidden = false;
      } catch (e) {
        toastError(e);
      }
    }, 250);
  });
  box.addEventListener('click', () => {
    box.hidden = true;
    input.value = '';
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search')) box.hidden = true;
  });
}

let currentCleanup = null;
async function route() {
  if (/^#\/(ficha|nps)\//.test(location.hash)) return boot();
  previewBackLink(false);
  if (!state.meta) return boot();
  if (!$('#view')) shell();
  const hash = location.hash.replace(/^#\/?/, '') || 'painel';
  const [path, qs] = hash.split('?');
  const parts = path.split('/');
  const key = parts[0];
  const navItem = NAV.find(([k]) => k === key);
  const extra = EXTRA[key];
  const mod = navItem?.[2] || extra?.[0];
  const moduleKey = navItem?.[3] || extra?.[1];
  const isRecord = (key === 'leads' || key === 'clientes') && /^\d+$/.test(parts[1] || '');
  let navKey = navItem ? key : extra?.[2];
  if (key === 'financeiro') navKey = parts[1] ? `financeiro/${parts[1]}` : state.user.role === 'admin' && allowed('financeiro') ? 'financeiro' : 'financeiro/pagar';
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === navKey));
  let view = $('#view');
  if (!view) return;
  view = fresh(view);
  if (currentCleanup) currentCleanup();
  currentCleanup = null;
  if (!mod) {
    render(view, html`<div class="page"><h1>Página não encontrada</h1></div>`);
    return;
  }
  // A ficha do cadastro é acessível a quem tem CRM ou Clientes; as demais telas seguem o módulo liberado ao usuário
  const canOpen = isRecord ? allowed('crm') || allowed('clientes') || allowed('distribuicao') : key === 'financeiro' ? finAccess() : !moduleKey || allowed(moduleKey);
  if (!canOpen) {
    render(view, html`<div class="page"><h1>Acesso não liberado</h1><p class="muted">Seu usuário não tem acesso a esta tela. Fale com o administrador para liberar o módulo em Usuários.</p></div>`);
    return;
  }
  if (Date.now() - notifLast > 15000) loadNotifications(false);
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  render(view, html`<div class="page loading">Carregando…</div>`);
  try {
    // A ficha abre tanto em #/leads/<id> quanto em #/clientes/<id>
    const target = isRecord ? contact : mod;
    currentCleanup = (await target.show(view, { id: parts[1], sub: parts[2], params, key })) || null;
    view.focus({ preventScroll: true });
  } catch (e) {
    render(view, html`<div class="page"><div class="alert danger">${e.message}</div></div>`);
  }
}

window.addEventListener('hashchange', route);
// Permite reiniciar a aplicação sem recarregar a página (usado pela versão de teste no navegador)
window.CRM_BOOT = boot;
window.addEventListener('crm:refresh-meta', async () => {
  state.meta = await get('/api/meta');
  state.user = state.meta.user;
  const box = document.getElementById('userbox');
  if (box) render(box, userBox());
});
boot();
