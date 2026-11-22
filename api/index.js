'use strict';
/**
 * Vercel: todas as rotas /api/* chegam aqui (vercel.json › rewrites); os arquivos de public/ são servidos direto pela
 * Vercel. O banco é o Postgres do Supabase (DATABASE_URL). A instância é reaproveitada entre requisições enquanto a
 * função estiver ativa.
 */
const { createApp } = require('../server/app');

let app = null;
let failure = null;

module.exports = async (req, res) => {
  if (!app && !failure) {
    try {
      app = createApp({ serverless: true });
    } catch (e) {
      failure = e;
      console.error('Falha ao iniciar o CRM:', e);
    }
  }
  if (!app) {
    // Tenta de novo na próxima requisição (ex.: banco fora do ar por um instante)
    const msg = failure ? failure.message : 'CRM indisponível.';
    failure = null;
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: `O CRM não conseguiu acessar o banco de dados: ${msg}` }));
  }
  // O vercel.json manda /api/* para esta função com o caminho em __path (caso a plataforma entregue a URL reescrita)
  const u = new URL(req.url, 'http://localhost');
  const original = u.searchParams.get('__path');
  if (original != null) {
    u.searchParams.delete('__path');
    if (u.pathname === '/api/index' || u.pathname === '/api') req.url = `/api/${original}${u.search}`;
    else req.url = `${u.pathname}${u.search}`;
  }
  return app.handle(req, res);
};
