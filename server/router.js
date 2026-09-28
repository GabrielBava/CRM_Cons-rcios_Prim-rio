'use strict';
/**
 * Roteador da API, independente do servidor HTTP. É usado pelo servidor Node (server/app.js)
 * e pela versão de teste que roda inteira no navegador (preview/).
 */
const { HttpError, toCSV } = require('./util');
const auth = require('./auth');
const contacts = require('./services/contacts');
const opps = require('./services/opportunities');
const activities = require('./services/activities');
const tasks = require('./services/tasks');
const clients = require('./services/clients');
const sims = require('./services/simulations');
const proposals = require('./services/proposals');
const dialer = require('./services/dialer');
const inbound = require('./services/inbound');
const integrations = require('./services/integrations');
const reports = require('./services/reports');
const io = require('./services/importexport');
const admin = require('./services/admin');

function createRouter(db) {
  const routes = [];
  const add = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:([a-z_]+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
    routes.push({ method, re, keys, handler, opts });
  };

  /* ---------- Público / sessão ---------- */
  add('GET', '/api/setup', () => ({ needs_setup: auth.needsSetup(db) }), { public: true });
  add('POST', '/api/setup', ({ req, res, body }) => auth.setup(db, req, res, body), { public: true });
  add('POST', '/api/login', ({ req, res, body }) => auth.login(db, req, res, body), { public: true });
  add('POST', '/api/logout', ({ req, res }) => auth.logout(db, req, res), { public: true });

  /* ---------- Integrações externas (autenticação por token da integração) ---------- */
  add('POST', '/api/integracoes/discadora/eventos', ({ req, body }) => {
    const integ = integrations.authenticate(db, 'discadora', req);
    return { resultados: dialer.ingest(db, integ, body) };
  }, { integration: true });
  add('GET', '/api/integracoes/simulador/contexto', ({ req, query }) => {
    integrations.authenticate(db, 'simulador', req);
    return sims.context(db, query.token);
  }, { integration: true });
  add('POST', '/api/integracoes/simulador/simulacoes', ({ req, body }) => {
    const integ = integrations.authenticate(db, 'simulador', req);
    return sims.receiveFromSimulator(db, integ, body);
  }, { integration: true });
  add('POST', '/api/integracoes/leads', ({ req, body }) => {
    const integ = integrations.authenticate(db, 'api_leads', req);
    return { resultados: inbound.receiveLeads(db, integ, body) };
  }, { integration: true });
  add('POST', '/api/integracoes/whatsapp/mensagens', ({ req, body }) => {
    const integ = integrations.authenticate(db, 'whatsapp', req);
    return { resultados: inbound.receiveMessages(db, integ, body) };
  }, { integration: true });

  /* ---------- Usuário ---------- */
  add('GET', '/api/me', ({ user }) => user);
  add('POST', '/api/me/senha', ({ user, body }) => (auth.changePassword(db, user, body), { ok: true }));
  add('GET', '/api/meta', ({ user }) => admin.meta(db, user));
  add('GET', '/api/busca', ({ user, query }) => contacts.globalSearch(db, user, query.q));
  add('GET', '/api/dashboard', ({ user, query }) => reports.dashboard(db, user, query));

  /* ---------- Cadastros ---------- */
  add('GET', '/api/cadastros', ({ user, query }) => contacts.listContacts(db, user, query));
  add('POST', '/api/cadastros', ({ user, body }) => contacts.createContact(db, user, body));
  add('POST', '/api/cadastros/verificar-duplicidade', ({ user, body }) => ({ duplicates: contacts.checkDuplicates(db, user, body, body.exclude_id ? Number(body.exclude_id) : undefined) }));
  add('GET', '/api/cadastros/:id', ({ user, params }) => contacts.getContact(db, user, params.id));
  add('PATCH', '/api/cadastros/:id', ({ user, params, body }) => contacts.updateContact(db, user, params.id, body));
  add('GET', '/api/cadastros/:id/historico', ({ user, params, query }) => activities.listActivities(db, user, { ...query, contact_id: params.id, limit: query.limit || 300 }));
  add('GET', '/api/cadastros/:id/auditoria', ({ user, params }) => contacts.contactAudit(db, user, params.id));
  add('POST', '/api/cadastros/:id/contatos', ({ user, params, body }) => ({ id: contacts.addCompanyContact(db, user, params.id, body) }));
  add('PATCH', '/api/contatos-empresa/:id', ({ user, params, body }) => contacts.updateCompanyContact(db, user, params.id, body));
  add('POST', '/api/cadastros/:id/consentimentos', ({ user, params, body }) => contacts.recordConsent(db, user, params.id, body));
  add('POST', '/api/cadastros/:id/solicitacoes', ({ user, params, body }) => ({ id: contacts.createDataRequest(db, user, params.id, body) }));
  add('PATCH', '/api/solicitacoes/:id', ({ user, params, body }) => (contacts.resolveDataRequest(db, user, params.id, body), { ok: true }));
  add('POST', '/api/cadastros/:id/anonimizar', ({ user, params, body }) => (contacts.anonymizeContact(db, user, params.id, body.reason), { ok: true }));
  add('POST', '/api/cadastros/:id/mesclar', ({ user, params, body }) => contacts.mergeContacts(db, user, params.id, body.source_id));
  add('POST', '/api/cadastros/:id/origens', ({ user, params, body }) => {
    const c = require('./core').loadContact(db, user, params.id, { write: true });
    const id = contacts.insertOrigin(db, user, c.id, body);
    require('./core').audit(db, user, 'contact', c.id, 'origem_adicionada', body, c.id);
    return { id };
  });

  /* ---------- Oportunidades e funil ---------- */
  add('GET', '/api/funil', ({ user, query }) => opps.board(db, user, query));
  add('GET', '/api/oportunidades', ({ user, query }) => opps.listOpportunities(db, user, query));
  add('POST', '/api/oportunidades', ({ user, body }) => opps.createOpportunity(db, user, body));
  add('GET', '/api/oportunidades/:id', ({ user, params }) => opps.getOpportunity(db, user, params.id));
  add('PATCH', '/api/oportunidades/:id', ({ user, params, body }) => opps.updateOpportunity(db, user, params.id, body));
  add('POST', '/api/oportunidades/:id/etapa', ({ user, params, body }) => opps.moveStage(db, user, params.id, body));
  add('POST', '/api/oportunidades/:id/validar-estrategia', ({ user, params }) => (opps.validateStrategy(db, user, params.id), { ok: true }));

  /* ---------- Atividades e tarefas ---------- */
  add('GET', '/api/atividades', ({ user, query }) => activities.listActivities(db, user, query));
  add('POST', '/api/atividades', ({ user, body }) => ({ id: activities.createActivity(db, user, body) }));
  add('GET', '/api/tarefas', ({ user, query }) => tasks.listTasks(db, user, query));
  add('POST', '/api/tarefas', ({ user, body }) => ({ id: tasks.createTask(db, user, body) }));
  add('PATCH', '/api/tarefas/:id', ({ user, params, body }) => (tasks.updateTask(db, user, params.id, body), { ok: true }));

  /* ---------- Simulações, propostas e contratos ---------- */
  add('GET', '/api/simulacoes', ({ user, query }) => sims.listSimulations(db, user, query));
  add('POST', '/api/simulacoes', ({ user, body }) => sims.createManual(db, user, body));
  add('POST', '/api/simulacoes/link', ({ user, body }) => sims.createLink(db, user, body));
  add('GET', '/api/simulacoes/:id', ({ user, params }) => sims.getSimulation(db, user, params.id));
  add('PATCH', '/api/simulacoes/:id', ({ user, params, body }) => (sims.updateManual(db, user, params.id, body), { ok: true }));
  add('GET', '/api/propostas', ({ user, query }) => proposals.listProposals(db, user, query));
  add('POST', '/api/propostas', ({ user, body }) => proposals.createProposal(db, user, body));
  add('GET', '/api/propostas/:id', ({ user, params }) => proposals.getProposal(db, user, params.id));
  add('PATCH', '/api/propostas/:id', ({ user, params, body }) => (proposals.updateProposal(db, user, params.id, body), { ok: true }));
  add('POST', '/api/propostas/:id/status', ({ user, params, body }) => (proposals.changeStatus(db, user, params.id, body), { ok: true }));
  add('POST', '/api/propostas/:id/nova-versao', ({ user, params, body }) => proposals.newVersion(db, user, params.id, body));
  add('GET', '/api/contratos', ({ user, query }) => clients.listContracts(db, user, query));
  add('POST', '/api/contratos', ({ user, body }) => clients.createContract(db, user, body));
  add('PATCH', '/api/contratos/:id', ({ user, params, body }) => (clients.updateContract(db, user, params.id, body), { ok: true }));

  /* ---------- Filas de integração ---------- */
  add('GET', '/api/discadora/eventos', ({ user, query }) => dialer.listEvents(db, user, query));
  add('POST', '/api/discadora/previa', ({ user, body }) => dialer.preview(db, user, body));
  add('POST', '/api/discadora/eventos/:id/vincular', ({ user, params, body }) => dialer.linkManually(db, user, params.id, body.contact_id, body.company_contact_id));
  add('POST', '/api/discadora/eventos/:id/reprocessar', ({ user, params }) => dialer.reprocess(db, user, params.id));
  add('POST', '/api/discadora/eventos/:id/descartar', ({ user, params, body }) => (dialer.discard(db, user, params.id, body.reason), { ok: true }));
  add('GET', '/api/entradas', ({ user, query }) => inbound.listInbound(db, user, query));
  add('POST', '/api/entradas/:id/reprocessar', ({ user, params, body }) => inbound.reprocessInbound(db, user, params.id, body.contact_id));
  add('POST', '/api/entradas/:id/descartar', ({ user, params, body }) => (inbound.discardInbound(db, user, params.id, body.reason), { ok: true }));

  /* ---------- Relatórios, importação e exportação ---------- */
  add('GET', '/api/relatorios', () => reports.REPORTS);
  add('GET', '/api/relatorios/:key', ({ user, params, query }) => reports.report(db, user, params.key, query));
  add('GET', '/api/relatorios/:key/csv', ({ user, params, query, res }) => {
    const r = reports.report(db, user, params.key, query);
    const csv = toCSV(r.columns, r.totals ? [...r.rows, r.totals] : r.rows);
    return sendFile(res, `relatorio-${params.key}.csv`, csv);
  });
  add('GET', '/api/exportar/:entity', ({ user, params, query, res }) => {
    const { filename, content } = io.exportData(db, user, params.entity, query);
    return sendFile(res, filename, content);
  });
  add('POST', '/api/importacao/previa', ({ user, body }) => io.preview(db, user, body), { bodyLimit: 15e6 });
  add('POST', '/api/importacao', ({ user, body }) => io.commit(db, user, body), { bodyLimit: 15e6 });
  add('GET', '/api/importacoes', ({ user }) => io.listImports(db, user));

  /* ---------- Administração ---------- */
  add('GET', '/api/usuarios', ({ user }) => admin.listUsers(db, user));
  add('POST', '/api/usuarios', ({ user, body }) => ({ id: admin.saveUser(db, user, body) }));
  add('GET', '/api/equipes', () => admin.listTeams(db));
  add('POST', '/api/equipes', ({ user, body }) => ({ id: admin.saveTeam(db, user, body) }));
  add('POST', '/api/opcoes', ({ user, body }) => ({ id: admin.saveOption(db, user, body) }));
  add('GET', '/api/produtos', () => admin.listProducts(db));
  add('POST', '/api/produtos', ({ user, body }) => ({ id: admin.saveProduct(db, user, body) }));
  add('POST', '/api/campos', ({ user, body }) => ({ id: admin.saveCustomField(db, user, body) }));
  add('GET', '/api/etapas', () => opps.listStages(db, true));
  add('POST', '/api/etapas', ({ user, body }) => ({ id: opps.saveStage(db, user, body) }));
  add('POST', '/api/etapas/ordem', ({ user, body }) => (opps.reorderStages(db, user, body.ids), { ok: true }));
  add('PATCH', '/api/configuracoes', ({ user, body }) => (admin.saveSettings(db, user, body), { ok: true }));
  add('GET', '/api/integracoes', ({ user }) => integrations.listIntegrations(db, user));
  add('PATCH', '/api/integracoes/:key', ({ user, params, body }) => (integrations.updateIntegration(db, user, params.key, body), { ok: true }));
  add('POST', '/api/integracoes/:key/token', ({ user, params }) => ({ token: integrations.rotateToken(db, user, params.key) }));
  add('GET', '/api/integracoes/:key/logs', ({ user, params, query }) => integrations.listLogs(db, user, params.key, query));
  add('GET', '/api/auditoria', ({ user, query }) => admin.globalAudit(db, user, query));

  function sendFile(res, filename, content) {
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    });
    res.end(content);
    return undefined;
  }

  function parseBody(req, limit) {
    const raw = req.rawBody == null ? '' : String(req.rawBody);
    if (raw.length > limit) throw new HttpError(413, 'Conteúdo muito grande.');
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      throw new HttpError(400, 'JSON inválido.');
    }
  }

  /**
   * Trata uma requisição da API. req: { method, url, headers, socket, rawBody }.
   * res: objeto com setHeader(), writeHead(), end() e headersSent (compatível com http.ServerResponse).
   */
  async function dispatch(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const json = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    try {
      let route = null;
      let match = null;
      for (const r of routes) {
        if (r.method !== req.method) continue;
        match = url.pathname.match(r.re);
        if (match) {
          route = r;
          break;
        }
      }
      if (!route) {
        const exists = routes.some((r) => r.re.test(url.pathname));
        throw new HttpError(exists ? 405 : 404, exists ? 'Método não permitido.' : 'Rota não encontrada.');
      }
      const params = {};
      route.keys.forEach((k, i) => (params[k] = decodeURIComponent(match[i + 1])));
      const query = Object.fromEntries(url.searchParams.entries());
      let user = null;
      if (!route.opts.public && !route.opts.integration) {
        user = auth.currentUser(db, req);
        if (!user) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
      }
      // Proteção CSRF: requisições de sessão que alteram dados exigem cabeçalho próprio da aplicação
      if (!route.opts.integration && req.method !== 'GET' && req.headers['x-requested-with'] !== 'crm') {
        throw new HttpError(403, 'Requisição recusada (cabeçalho de segurança ausente).');
      }
      const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? parseBody(req, route.opts.bodyLimit || 2e6) : {};
      const result = await route.handler({ req, res, user, params, query, body });
      if (res.headersSent) return;
      json(200, result === undefined ? { ok: true } : result);
    } catch (e) {
      if (res.headersSent) return;
      if (e instanceof HttpError) return json(e.status, { error: e.message, details: e.details });
      if (e && /UNIQUE constraint failed/.test(e.message || '')) return json(409, { error: 'Registro duplicado: já existe um item com esse identificador.' });
      console.error(e);
      json(500, { error: 'Erro interno. A operação não foi concluída.' });
    }
  }

  /** Rotina de manutenção: expiração de propostas vencidas. */
  function sweep() {
    try {
      proposals.expireSweep(db);
    } catch (e) {
      console.error('Falha ao expirar propostas:', e.message);
    }
  }

  return { dispatch, sweep };
}

module.exports = { createRouter };
