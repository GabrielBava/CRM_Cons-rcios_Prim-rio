'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { openDb, getSetting, setSetting, isPgUrl } = require('./db');
const { HttpError } = require('./util');
const { createRouter } = require('./router');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.webp': 'image/webp' };
const MAX_BODY = 15e6;

/**
 * Versão de teste no Supabase: com CRM_DEMO=1 e DEMO_PASSWORD, um banco sem usuários recebe os dados de demonstração
 * (uma vez só; o bloqueio evita duas instâncias da Vercel fazendo isso juntas).
 */
function seedDemoIfEmpty(db) {
  if (process.env.CRM_DEMO !== '1') return;
  const password = process.env.DEMO_PASSWORD;
  if (!password) {
    console.warn('CRM_DEMO=1 sem DEMO_PASSWORD: os dados de demonstração não foram criados.');
    return;
  }
  const empty = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
  if (!empty()) return;
  if (db.isPostgres) db.queryRaw('SELECT pg_advisory_lock(7203912)');
  try {
    if (empty()) {
      require('./demo').seedDemo(db, password);
      console.log('Dados de demonstração criados (versão de teste).');
    }
  } finally {
    if (db.isPostgres) db.queryRaw('SELECT pg_advisory_unlock(7203912)');
  }
}

/**
 * Endereço do banco Postgres: DATABASE_URL ou, com a integração do Supabase na Vercel, POSTGRES_URL (a porta 6543 do
 * pooler, modo transação, vira 5432, modo sessão, que o CRM precisa). Aspas e espaços colados por engano são removidos.
 */
function databaseUrl(env = process.env) {
  const clean = (v) => String(v).trim().replace(/^(["'])(.*)\1$/, '$2').trim();
  if (env.DATABASE_URL && clean(env.DATABASE_URL)) return clean(env.DATABASE_URL);
  const alt = env.POSTGRES_URL || env.SUPABASE_DB_URL;
  if (alt && clean(alt)) return clean(alt).replace(/(\.pooler\.supabase\.com):6543\b/i, '$1:5432');
  return null;
}

// Rotinas periódicas: [nome no router, intervalo]
const ROUTINES = [['sweep', 60 * 60 * 1000], ['queueSweep', 15 * 60 * 1000], ['meetSweep', 5 * 60 * 1000]];

/**
 * serverless (Vercel): sem processo fixo, as rotinas periódicas rodam quando vencem, no primeiro acesso à API depois do
 * prazo (e pelo /api/cron da Vercel). Fora da Vercel, rodam por timer como antes.
 */
function createApp({ dbFile = databaseUrl() || process.env.CRM_DB || path.join(__dirname, '..', 'data', 'crm.db'), serverless = !!process.env.VERCEL } = {}) {
  // Na Vercel não há disco para o SQLite: sem o endereço do Postgres, explica o que falta em vez de tentar criar data/
  if (process.env.VERCEL && !isPgUrl(dbFile)) {
    const env = process.env.VERCEL_ENV === 'preview' ? 'Preview' : process.env.VERCEL_ENV === 'production' ? 'Production' : process.env.VERCEL_ENV || '?';
    const bad = process.env.DATABASE_URL ? ' (a DATABASE_URL existe, mas não começa com postgresql://)' : '';
    throw new Error(`a variável DATABASE_URL não está nesta publicação (ambiente ${env} da Vercel)${bad}. Em Settings › Environment Variables, cadastre DATABASE_URL marcando Production e Preview e faça Redeploy do último deploy.`);
  }
  const db = openDb(dbFile);
  seedDemoIfEmpty(db);
  const router = createRouter(db);

  /** Roda as rotinas vencidas (ou todas, com force); a data da última execução fica no banco, comum às instâncias. */
  async function dueRoutines(force = false) {
    const ran = [];
    for (const [name, every] of ROUTINES) {
      const key = `rotina_${name}`;
      const last = Number(getSetting(db, key)) || 0;
      if (!force && Date.now() - last < every) continue;
      setSetting(db, key, Date.now());
      await router[name]();
      ran.push(name);
    }
    return ran;
  }

  function readBody(req, limit) {
    // Na Vercel o corpo pode já ter sido lido pela plataforma (req.body)
    if (req.readableEnded && req.body !== undefined) {
      const b = req.body;
      return Promise.resolve(Buffer.isBuffer(b) ? b.toString('utf8') : typeof b === 'string' ? b : b == null ? '' : JSON.stringify(b));
    }
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) {
          reject(new HttpError(413, 'Conteúdo muito grande.'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw);
      });
      req.on('error', reject);
    });
  }

  function securityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // O CRM (crm.veroconsorciosbr.com.br) não aparece em buscadores; as LPs oficiais ficam no site da Vero
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; frame-src 'self' blob: https://www.youtube-nocookie.com https://player.vimeo.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
  }

  // Landing page e simulador: páginas independentes com script embutido (sem acesso à sessão do CRM)
  const SITE_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://www.googletagmanager.com https://connect.facebook.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https:; frame-src https://www.youtube-nocookie.com https://www.youtube.com https://player.vimeo.com; frame-ancestors 'self'; base-uri 'none'; form-action 'self'";

  // Ferramentas (diagnóstico financeiro e simulador de consórcio): HTML com script embutido, mesma origem do CRM (a ponte
  // do diagnóstico lê e grava pelo /api com a sessão). O diagnóstico pode chamar a IA da Anthropic com a chave do usuário.
  const TOOLS_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://api.anthropic.com; worker-src 'self' blob:; frame-ancestors 'self'; base-uri 'none'; form-action 'self'";

  function serveStatic(req, res, pathname) {
    if (pathname === '/lp' || pathname === '/simulador') {
      res.writeHead(301, { Location: `${pathname}/` });
      return res.end();
    }
    if (/^\/(lp|simulador)\//.test(pathname)) res.setHeader('Content-Security-Policy', SITE_CSP);
    if (/^\/ferramentas\//.test(pathname)) {
      res.setHeader('Content-Security-Policy', TOOLS_CSP);
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    }
    let p = pathname === '/' ? '/index.html' : pathname.endsWith('/') ? `${pathname}index.html` : pathname;
    const file = path.normalize(path.join(PUBLIC_DIR, p));
    if (!file.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end();
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Não encontrado');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  }

  async function handle(req, res) {
    securityHeaders(res);
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405);
        return res.end();
      }
      return serveStatic(req, res, url.pathname);
    }
    // Verificação da publicação: confirma que o servidor do CRM está no ar e que o banco responde (sem login)
    if (url.pathname === '/api/saude') {
      let banco = 'ok';
      try {
        db.prepare('SELECT 1 AS ok').get();
      } catch (e) {
        banco = `erro: ${e.message}`;
      }
      const sha = process.env.VERCEL_GIT_COMMIT_SHA;
      res.writeHead(banco === 'ok' ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ ok: banco === 'ok', banco, tipo: db.isPostgres ? 'postgres' : 'sqlite', versao: sha ? sha.slice(0, 7) : null }));
    }
    // Agendamento da Vercel (vercel.json › crons): roda todas as rotinas; protegido por CRON_SECRET
    if (url.pathname === '/api/cron') {
      const ok = process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
      res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json; charset=utf-8' });
      if (!ok) return res.end(JSON.stringify({ error: 'Não autorizado.' }));
      return res.end(JSON.stringify({ ok: true, rotinas: await dueRoutines(true) }));
    }
    try {
      req.rawBody = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req, MAX_BODY) : '';
    } catch (e) {
      res.writeHead(e.status || 400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: e.message }));
    }
    if (serverless) {
      try {
        await dueRoutines();
      } catch (e) {
        console.error('Falha nas rotinas periódicas:', e.message);
      }
    }
    return router.dispatch(req, res);
  }

  const server = http.createServer((req, res) => {
    handle(req, res);
  });

  // Rotinas periódicas (servidor fixo): manutenção a cada hora, fila de leads (roleta) a cada 15 minutos e presença na
  // R1 pelo Google Meet a cada 5 minutos
  if (!serverless) {
    router.sweep();
    const timers = ROUTINES.map(([name, every]) => {
      const t = setInterval(router[name], every);
      t.unref();
      return t;
    });
    server.on('close', () => timers.forEach(clearInterval));
  }

  return { server, db, handle, dueRoutines };
}

module.exports = { databaseUrl, createApp };
