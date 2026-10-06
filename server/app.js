'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('./db');
const { HttpError } = require('./util');
const { createRouter } = require('./router');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.webp': 'image/webp' };
const MAX_BODY = 15e6;

function createApp({ dbFile = process.env.CRM_DB || path.join(__dirname, '..', 'data', 'crm.db') } = {}) {
  const db = openDb(dbFile);
  const router = createRouter(db);
  function readBody(req, limit) {
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
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; frame-src 'self' blob: https://www.youtube-nocookie.com https://player.vimeo.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
  }

  // Landing page e simulador: páginas independentes com script embutido (sem acesso à sessão do CRM)
  const SITE_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://www.googletagmanager.com https://connect.facebook.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https:; frame-src https://www.youtube-nocookie.com https://www.youtube.com https://player.vimeo.com; frame-ancestors 'self'; base-uri 'none'; form-action 'self'";

  function serveStatic(req, res, pathname) {
    if (pathname === '/lp' || pathname === '/simulador') {
      res.writeHead(301, { Location: `${pathname}/` });
      return res.end();
    }
    if (/^\/(lp|simulador)\//.test(pathname)) res.setHeader('Content-Security-Policy', SITE_CSP);
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
    try {
      req.rawBody = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req, MAX_BODY) : '';
    } catch (e) {
      res.writeHead(e.status || 400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: e.message }));
    }
    return router.dispatch(req, res);
  }

  const server = http.createServer((req, res) => {
    handle(req, res);
  });

  // Rotinas periódicas: manutenção a cada hora e distribuição da fila de leads (roleta) a cada 15 minutos
  router.sweep();
  const timer = setInterval(router.sweep, 60 * 60 * 1000);
  timer.unref();
  const queueTimer = setInterval(router.queueSweep, 15 * 60 * 1000);
  queueTimer.unref();
  // Presença na R1 pelo Google Meet: a cada 5 minutos
  const meetTimer = setInterval(router.meetSweep, 5 * 60 * 1000);
  meetTimer.unref();
  server.on('close', () => {
    clearInterval(timer);
    clearInterval(queueTimer);
    clearInterval(meetTimer);
  });

  return { server, db };
}

module.exports = { createApp };
