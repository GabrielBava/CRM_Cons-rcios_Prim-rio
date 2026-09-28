// Estrutura da aplicação: autenticação, navegação, busca global e roteamento.
import { get, post, setUnauthorizedHandler } from './api.js';
import { html, render, state, $, on, toastError, relBadge, can, fresh } from './ui.js';
import { quickCreateContact } from './forms.js';
import * as dashboard from './views/dashboard.js';
import * as leads from './views/leads.js';
import * as contact from './views/contact.js';
import * as pipeline from './views/pipeline.js';
import * as agenda from './views/agenda.js';
import * as activities from './views/activities.js';
import * as sales from './views/sales.js';
import * as clients from './views/clients.js';
import * as products from './views/products.js';
import * as reports from './views/reports.js';
import * as settings from './views/settings.js';
import * as importer from './views/import.js';
import * as financeView from './views/finance.js';
import * as publicForm from './views/public-form.js';

const NAV = [
  ['painel', 'Painel inicial', dashboard],
  ['leads', 'Prospects e leads', leads],
  ['funil', 'Funil comercial', pipeline],
  ['agenda', 'Agenda e tarefas', agenda],
  ['atividades', 'Ligações e atividades', activities],
  ['simulacoes', 'Simulações e propostas', sales],
  ['clientes', 'Clientes', clients],
  ['financeiro', 'Financeiro', financeView],
  ['produtos', 'Produtos e estratégias', products],
  ['relatorios', 'Relatórios', reports],
  ['configuracoes', 'Configurações e usuários', settings],
];
const EXTRA = { oportunidades: pipeline, importar: importer };

const app = document.getElementById('app');

async function boot() {
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
    shell();
    route();
  } catch (e) {
    if (e.status === 401) showLogin();
    else render(app, html`<div class="auth"><div class="card"><h1>Erro</h1><p>${e.message}</p></div></div>`);
  }
}

function showSetup() {
  render(app, html`<div class="auth"><form class="card" id="setup">
    <h1>CRM de Consórcios</h1><p>Primeiro acesso: crie o usuário administrador.</p>
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
  state.meta = null;
  render(app, html`<div class="auth"><form class="card" id="login">
    <h1>CRM de Consórcios</h1>${msg ? html`<p class="warn-text">${msg}</p>` : html`<p>Entre com seu usuário.</p>`}
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

function shell() {
  render(app, html`
    <aside class="sidebar" id="sidebar">
      <div class="brand">CRM Consórcios</div>
      <nav>${NAV.map(([k, label]) => html`<a href="#/${k}" data-nav="${k}">${label}</a>`)}</nav>
      <div class="me">
        <div><strong>${state.user.name}</strong><small>${state.user.role_label}</small></div>
        <button class="btn small ghost" data-act="logout">Sair</button>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="icon menu-btn" data-act="menu" aria-label="Abrir menu">☰</button>
        <div class="search">
          <input type="search" id="gsearch" placeholder="Buscar por nome, telefone, e-mail, CPF/CNPJ ou ID (C-000001, OP-…)" autocomplete="off" aria-label="Busca global">
          <div class="search-results" hidden></div>
        </div>
        ${can.write() ? html`<button class="btn primary" data-act="new-lead">+ Novo lead</button>` : ''}
      </header>
      <main id="view" tabindex="-1"></main>
    </div>`);
  on(app, 'click', '[data-act=logout]', async () => {
    await post('/api/logout');
    showLogin();
  });
  on(app, 'click', '[data-act=menu]', () => $('#sidebar').classList.toggle('open'));
  on(app, 'click', '[data-nav]', () => $('#sidebar').classList.remove('open'));
  on(app, 'click', '[data-act=new-lead]', () => quickCreateContact());
  setupSearch();
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
  if (!state.meta) return;
  const hash = location.hash.replace(/^#\/?/, '') || 'painel';
  const [path, qs] = hash.split('?');
  const parts = path.split('/');
  const key = parts[0];
  const mod = NAV.find(([k]) => k === key)?.[2] || EXTRA[key];
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === key || (key === 'oportunidades' && a.dataset.nav === 'funil')));
  let view = $('#view');
  if (!view) return;
  view = fresh(view);
  if (currentCleanup) currentCleanup();
  currentCleanup = null;
  if (!mod) {
    render(view, html`<div class="page"><h1>Página não encontrada</h1></div>`);
    return;
  }
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  render(view, html`<div class="page loading">Carregando…</div>`);
  try {
    // A ficha abre tanto em #/leads/<id> quanto em #/clientes/<id>
    const target = (key === 'leads' || key === 'clientes') && /^\d+$/.test(parts[1] || '') ? contact : mod;
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
});
boot();
