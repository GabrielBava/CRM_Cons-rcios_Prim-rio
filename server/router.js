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
const record = require('./services/record');
const finance = require('./services/finance');
const core = require('./core');

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

  /* ---------- Ficha: endereços, sócios, anexos, pré-venda, link do cliente, pós-venda ---------- */
  add('GET', '/api/cep/:cep', ({ params }) => record.lookupCep(params.cep));
  add('POST', '/api/cadastros/:id/enderecos', ({ user, params, body }) => ({ id: record.saveAddress(db, user, params.id, body) }));
  add('POST', '/api/enderecos/:id/remover', ({ user, params }) => (record.deleteAddress(db, user, params.id), { ok: true }));
  add('POST', '/api/cadastros/:id/socios', ({ user, params, body }) => ({ id: record.savePartner(db, user, params.id, body) }));
  add('POST', '/api/cadastros/:id/anexos', ({ user, params, body }) => ({ id: record.uploadAttachment(db, user, params.id, body) }), { bodyLimit: 12e6 });
  add('GET', '/api/anexos/:id', ({ user, params, res }) => {
    const a = record.getAttachment(db, user, params.id);
    return sendBinary(res, a.filename, a.mime, a.content);
  });
  add('PATCH', '/api/anexos/:id', ({ user, params, body }) => (record.reviewAttachment(db, user, params.id, body), { ok: true }));
  add('GET', '/api/cadastros/:id/checklist-venda', ({ user, params }) => record.saleChecklist(db, core.loadContact(db, user, params.id)));
  add('POST', '/api/cadastros/:id/link-cliente', ({ user, params }) => record.createClientLink(db, user, params.id));
  add('POST', '/api/cadastros/:id/link-cliente/revogar', ({ user, params, body }) => ({ revogados: record.revokeClientLinks(db, user, params.id, body) }));
  add('GET', '/api/cadastros/:id/link-cliente', ({ user, params }) => {
    const c = core.loadContact(db, user, params.id);
    return { active: record.activeClientLink(db, c.id), history: record.clientLinkHistory(db, c.id) };
  });
  add('POST', '/api/cadastros/:id/nps', ({ user, params, body }) => record.createNps(db, user, params.id, body));
  add('POST', '/api/nps/:id/cancelar', ({ user, params, body }) => (record.cancelNps(db, user, params.id, body), { ok: true }));
  add('POST', '/api/contratos/:id/estrategia-lance', ({ user, params, body }) => (record.saveBidStrategy(db, user, params.id, body), { ok: true }));
  add('POST', '/api/cadastros/:id/simulacao-rapida', ({ user, params, body }) => sims.registerQuick(db, user, { ...body, contact_id: params.id }));
  add('POST', '/api/cadastros/:id/simulador-proposta', ({ user, params, body }) => record.proposalSimulatorLink(db, user, params.id, body));
  add('GET', '/api/publico/nps', ({ query }) => record.publicNpsForm(db, query.token), { public: true });
  add('POST', '/api/publico/nps', ({ body }) => record.publicNpsSubmit(db, body.token, body), { public: true });
  add('POST', '/api/cadastros/:id/pos-venda', ({ user, params, body }) => (record.togglePostSale(db, user, params.id, body), { ok: true }));
  add('GET', '/api/publico/ficha', ({ query }) => record.publicForm(db, query.token), { public: true });
  add('GET', '/api/publico/cep/:cep', ({ params, query }) => record.publicCep(db, query.token, params.cep), { public: true });
  add('POST', '/api/publico/ficha', ({ body }) => record.publicSubmit(db, body.token, body), { public: true });
  add('POST', '/api/publico/ficha/anexo', ({ body }) => record.publicUpload(db, body.token, body), { public: true, bodyLimit: 12e6 });

  /* ---------- Financeiro ---------- */
  add('GET', '/api/financeiro', ({ user, query }) => finance.listEntries(db, user, query));
  add('POST', '/api/financeiro', ({ user, body }) => finance.createEntry(db, user, body));
  add('PATCH', '/api/financeiro/:id', ({ user, params, body }) => (finance.updateEntry(db, user, params.id, body), { ok: true }));
  add('POST', '/api/financeiro/pendencias', ({ user, body }) => ({ id: finance.saveIssue(db, user, body) }));
  add('GET', '/api/cadastros/:id/financeiro', ({ user, params }) => finance.contactFinance(db, user, params.id));
  add('POST', '/api/contratos/:id/gerar-parcelas', ({ user, params, body }) => finance.generateInstallments(db, user, params.id, body));

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

  function sendBinary(res, filename, mime, content) {
    res.writeHead(200, {
      'Content-Type': mime || 'application/octet-stream',
      // Nome ASCII para compatibilidade e nome original codificado (RFC 5987)
      'Content-Disposition': `attachment; filename="${String(filename).normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '_') || 'arquivo'}"; filename*=UTF-8''${encodeURIComponent(String(filename))}`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
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
    try {
      finance.overdueSweep(db);
    } catch (e) {
      console.error('Falha ao verificar atrasos:', e.message);
    }
  }

  return { dispatch, sweep };
}

module.exports = { createRouter };
