/*
 * Versão de teste no navegador: executa o servidor do CRM localmente (sql.js) e intercepta as
 * chamadas /api/ feitas pela interface. Os dados ficam apenas neste navegador.
 */
(function () {
  'use strict';
  const DEMO_PASSWORD = 'demo12345';
  // v3: menu do usuário, notificações, pós-venda e funil com ações em massa — recarrega a demonstração nova
  const DB_KEY = 'crm-preview-db-v6';
  const COOKIE_KEY = 'crm-preview-session';
  const req = (p) => window.CRMBackend.require(p);
  window.CRM_PREVIEW = true;

  /* ---------- armazenamento (IndexedDB), sempre tolerante a falhas ---------- */
  let idbPromise = null;
  function idb() {
    if (!idbPromise) {
      idbPromise = new Promise((resolve) => {
        try {
          const r = indexedDB.open('crm-preview', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('kv');
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    }
    return idbPromise;
  }
  async function idbGet(key) {
    const d = await idb();
    if (!d) return null;
    return new Promise((resolve) => {
      try {
        const r = d.transaction('kv').objectStore('kv').get(key);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  async function idbSet(key, value) {
    const d = await idb();
    if (!d) return false;
    return new Promise((resolve) => {
      try {
        const t = d.transaction('kv', 'readwrite');
        t.objectStore('kv').put(value, key);
        t.oncomplete = () => resolve(true);
        t.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }
  const ls = {
    get: (k) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        if (v == null) localStorage.removeItem(k);
        else localStorage.setItem(k, v);
      } catch {}
    },
  };

  /* ---------- servidor local ---------- */
  let SQL = null;
  let adapter = null;
  let router = null;
  let cookie = ls.get(COOKIE_KEY);
  let persisted = true;

  function openDatabase(bytes) {
    adapter = new window.CRMShims.SqlJsAdapter(bytes ? new SQL.Database(bytes) : new SQL.Database());
    req('server/db.js').initDb(adapter);
    router = req('server/router.js').createRouter(adapter);
    router.sweep();
  }

  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 250);
  }
  async function saveNow() {
    clearTimeout(saveTimer);
    try {
      persisted = await idbSet(DB_KEY, adapter.export());
    } catch {
      persisted = false;
    }
    updateBanner();
  }

  async function call(method, url, body, extraHeaders = {}) {
    const headers = { 'x-requested-with': 'crm', ...extraHeaders };
    if (cookie) headers.cookie = `crm_sid=${cookie}`;
    const res = {
      status: 200,
      headers: {},
      body: '',
      headersSent: false,
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      writeHead(s, h = {}) {
        this.status = s;
        for (const [k, v] of Object.entries(h)) this.setHeader(k, v);
        this.headersSent = true;
      },
      end(b = '') {
        this.body = b;
        this.headersSent = true;
      },
    };
    await router.dispatch({ method, url, headers, socket: { remoteAddress: 'navegador' }, rawBody: body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body) }, res);
    const sc = res.headers['set-cookie'];
    if (sc) {
      const m = String(sc).match(/crm_sid=([^;]*)/);
      cookie = m && m[1] && !/Max-Age=0\b/.test(sc) ? m[1] : null;
      ls.set(COOKIE_KEY, cookie);
    }
    delete res.headers['set-cookie'];
    if (method !== 'GET' && res.status < 400) scheduleSave();
    return res;
  }

  async function loginAs(email) {
    await call('POST', '/api/logout');
    const r = await call('POST', '/api/login', { email, password: DEMO_PASSWORD });
    return r.status === 200;
  }

  function seedDemo() {
    openDatabase(null);
    req('server/demo.js').seedDemo(adapter, DEMO_PASSWORD);
  }

  const ready = (async () => {
    SQL = await window.initSqlJs({});
    const saved = await idbGet(DB_KEY);
    try {
      openDatabase(saved);
    } catch (e) {
      console.error('Banco salvo inválido; recriando.', e);
      openDatabase(null);
    }
    // Primeira visita: carrega a demonstração e entra como administrador
    if (!saved) {
      seedDemo();
      await loginAs('admin@demo.local');
      await saveNow();
    }
  })();

  /* ---------- intercepta as chamadas /api/ da interface ---------- */
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const path = url.startsWith(location.origin) ? url.slice(location.origin.length) : url;
    if (!path.startsWith('/api/')) return nativeFetch(input, init);
    await ready;
    const headers = {};
    for (const [k, v] of Object.entries(init.headers || {})) headers[k.toLowerCase()] = v;
    delete headers.cookie;
    const r = await call((init.method || 'GET').toUpperCase(), path, init.body ?? null, headers);
    return new Response(r.body, { status: r.status, headers: r.headers });
  };

  /* ---------- barra da versão de teste ---------- */
  const USERS = [
    ['admin@demo.local', 'Administrador'],
    ['gestora@demo.local', 'Líder de equipe'],
    ['consultor1@demo.local', 'Especialista 1'],
    ['consultor2@demo.local', 'Especialista 2'],
    ['leitura@demo.local', 'Leitura'],
  ];
  let bar = null;
  let armed = null;
  function updateBanner() {
    if (!bar) return;
    const st = bar.querySelector('[data-save]');
    if (st) st.textContent = persisted ? 'Salvo neste navegador' : 'Não foi possível salvar: os dados somem ao fechar a página';
    st?.classList.toggle('warn', !persisted);
  }
  async function reboot() {
    if (typeof window.CRM_BOOT === 'function') await window.CRM_BOOT();
    location.hash = '#/painel';
  }
  function mountBanner() {
    bar = document.createElement('div');
    bar.className = 'preview-bar';
    bar.innerHTML = `
      <strong>Versão de teste</strong>
      <span class="pv-muted">Dados fictícios · senha dos usuários de demonstração: <code>${DEMO_PASSWORD}</code> · <span data-save>Salvo neste navegador</span></span>
      <label>Ver como <select data-as>${USERS.map(([e, l]) => `<option value="${e}">${l}</option>`).join('')}</select></label>
      <button type="button" data-act="demo">Restaurar demonstração</button>
      <button type="button" data-act="wipe">Começar do zero</button>`;
    document.body.prepend(bar);
    const syncHeight = () => document.documentElement.style.setProperty('--pv-h', `${bar.offsetHeight}px`);
    syncHeight();
    try {
      new ResizeObserver(syncHeight).observe(bar);
    } catch {}
    const sel = bar.querySelector('[data-as]');
    sel.addEventListener('change', async () => {
      await ready;
      const ok = await loginAs(sel.value);
      if (!ok) showMsg('Esse usuário não existe ou teve a senha alterada. Use "Restaurar demonstração".');
      await reboot();
    });
    bar.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      await ready;
      const act = b.dataset.act;
      if (armed !== act) {
        armed = act;
        bar.querySelectorAll('button[data-act]').forEach((x) => x.classList.toggle('armed', x === b));
        b.dataset.label = b.dataset.label || b.textContent;
        b.textContent = act === 'wipe' ? 'Confirmar: apagar tudo?' : 'Confirmar: substituir dados?';
        setTimeout(() => {
          if (armed === act) {
            armed = null;
            b.textContent = b.dataset.label;
            b.classList.remove('armed');
          }
        }, 4000);
        return;
      }
      armed = null;
      b.textContent = b.dataset.label;
      b.classList.remove('armed');
      cookie = null;
      ls.set(COOKIE_KEY, null);
      if (act === 'demo') {
        seedDemo();
        await loginAs('admin@demo.local');
        sel.value = 'admin@demo.local';
      } else {
        openDatabase(null);
      }
      await saveNow();
      await reboot();
    });
    ready.then(async () => {
      const me = await call('GET', '/api/me');
      if (me.status === 200) {
        const email = JSON.parse(me.body).email;
        if (USERS.some(([e]) => e === email)) sel.value = email;
      }
      updateBanner();
    });
  }
  function showMsg(text) {
    const m = document.createElement('div');
    m.className = 'preview-msg';
    m.textContent = text;
    document.body.appendChild(m);
    setTimeout(() => m.remove(), 5000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountBanner);
  else mountBanner();
})();
