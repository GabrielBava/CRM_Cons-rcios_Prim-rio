'use strict';
/**
 * Configuração, autenticação e registro (log) das integrações.
 * Nenhuma integração é considerada "ativa" sem validação explícita de um administrador
 * após o recebimento de ao menos um evento processado com sucesso.
 */
const { INTEGRATION_STATUS } = require('../constants');
const { requireAdmin, audit, isAdmin } = require('../core');
const { HttpError, badRequest, notFound, clean, randomToken, sha256, safeEqual, nowIso, getPath } = require('../util');

// Mapeamento padrão: campo do CRM -> nome do campo no payload recebido (aceita caminho "a.b.c")
const DEFAULT_MAPPINGS = {
  discadora: {
    external_call_id: 'id_chamada',
    lead_ref: 'id_lead',
    phone: 'telefone',
    started_at: 'inicio',
    ended_at: 'fim',
    duration_seconds: 'duracao_segundos',
    agent_ref: 'agente',
    technical_status: 'status_tecnico',
    result: 'resultado',
    classification: 'classificacao',
    recording_url: 'gravacao_url',
    direction: 'direcao',
    call_origin: 'origem',
  },
  simulador: {
    token: 'token',
    external_id: 'id_simulacao',
    lead_ref: 'id_lead',
    opportunity_ref: 'id_oportunidade',
    credit_value: 'credito',
    term_months: 'prazo_meses',
    installment: 'parcela',
    payment_modality: 'modalidade_pagamento',
    strategy: 'estrategia',
    view_url: 'link_consulta',
    status: 'status',
    notes: 'observacoes',
    user_ref: 'usuario',
  },
  api_leads: {
    external_id: 'id_lead_plataforma',
    platform: 'plataforma',
    name: 'nome',
    phone: 'telefone',
    email: 'email',
    kind: 'tipo_pessoa',
    company: 'empresa',
    city: 'cidade',
    state: 'estado',
    origin: 'origem',
    campaign_id: 'id_campanha',
    campaign_name: 'nome_campanha',
    adset_id: 'id_conjunto_anuncios',
    ad_id: 'id_anuncio',
    received_at: 'data_recebimento',
    utm_source: 'utm_source',
    utm_medium: 'utm_medium',
    utm_campaign: 'utm_campaign',
    utm_content: 'utm_content',
    utm_term: 'utm_term',
    notes: 'observacoes',
  },
  whatsapp: {
    external_id: 'id_mensagem',
    phone: 'telefone',
    direction: 'direcao',
    occurred_at: 'data',
    message_type: 'tipo',
    text: 'texto',
  },
  meta_ads: {},
};

const DESCRIPTIONS = {
  discadora:
    'Recebe eventos de chamadas por webhook (POST /api/integracoes/discadora/eventos). O fornecedor da discadora ainda não foi definido: configure o mapeamento de campos conforme a documentação dele e valide com eventos reais antes de ativar.',
  simulador:
    'Abre o simulador com um token temporário por lead e recebe a simulação salva (GET /api/integracoes/simulador/contexto e POST /api/integracoes/simulador/simulacoes). Requer a URL do simulador e a implementação desses dois pontos no próprio simulador.',
  meta_ads:
    'Conector direto com a Meta (Lead Ads / webhooks da Graph API) NÃO implementado. Até lá, leads podem chegar pela "API de entrada de leads" por meio de uma ferramenta intermediária, preservando IDs de lead, campanha, conjunto e anúncio.',
  whatsapp:
    'Recebe eventos de mensagens (POST /api/integracoes/whatsapp/mensagens) para registrar no histórico. Não envia mensagens. O provedor (ex.: API oficial do WhatsApp Business ou parceiro) ainda não foi definido.',
  api_leads:
    'Ponto de entrada genérico de leads do próprio CRM (POST /api/integracoes/leads), com deduplicação por ID externo, telefone, e-mail e CPF/CNPJ. Pode ser usado por formulários do site ou ferramentas intermediárias.',
};

function parseConfig(row) {
  try {
    return JSON.parse(row.config || '{}');
  } catch {
    return {};
  }
}

function getIntegration(db, key) {
  const row = db.prepare('SELECT * FROM integrations WHERE key = ?').get(key);
  if (!row) throw notFound('Integração não encontrada.');
  const config = parseConfig(row);
  return { ...row, config, mapping: { ...DEFAULT_MAPPINGS[key], ...(config.mapping || {}) } };
}

function listIntegrations(db, user) {
  return db
    .prepare('SELECT i.*, u.name AS validated_by_name FROM integrations i LEFT JOIN users u ON u.id = i.validated_by ORDER BY i.rowid')
    .all()
    .map((r) => {
      const config = parseConfig(r);
      const stats = db
        .prepare(
          `SELECT SUM(status = 'sucesso') AS ok, SUM(status = 'erro') AS err, SUM(status = 'sem_vinculo') AS unlinked, SUM(status = 'duplicado') AS dup, COUNT(*) AS total
           FROM integration_logs WHERE integration = ?`,
        )
        .get(r.key);
      const last = db.prepare("SELECT status FROM integration_logs WHERE integration = ? AND status IN ('sucesso','erro','sem_vinculo','duplicado') ORDER BY id DESC LIMIT 1").get(r.key);
      // Status exibido: uma integração habilitada cujo último evento falhou aparece "com erro"
      const effective = ['ativa', 'em_teste'].includes(r.status) && last?.status === 'erro' ? 'erro' : r.status;
      const base = {
        key: r.key,
        name: r.name,
        status: r.status,
        status_label: INTEGRATION_STATUS[r.status],
        effective_status: effective,
        effective_status_label: INTEGRATION_STATUS[effective],
        description: DESCRIPTIONS[r.key],
        last_event_at: r.last_event_at,
        last_error: r.last_error,
        last_error_at: r.last_error_at,
        validated_at: r.validated_at,
        validated_by_name: r.validated_by_name,
        has_token: !!r.token_hash,
        token_hint: r.token_hint,
        stats,
        base_url_configured: !!config.base_url,
      };
      if (isAdmin(user)) {
        base.config = config;
        base.mapping = { ...DEFAULT_MAPPINGS[r.key], ...(config.mapping || {}) };
        base.default_mapping = DEFAULT_MAPPINGS[r.key];
        base.notes = r.notes;
      }
      return base;
    });
}

function updateIntegration(db, user, key, data) {
  requireAdmin(user);
  const cur = getIntegration(db, key);
  const config = { ...cur.config };
  if (data.mapping !== undefined) {
    if (typeof data.mapping !== 'object' || !data.mapping) throw badRequest('Mapeamento inválido.');
    const allowed = Object.keys(DEFAULT_MAPPINGS[key] || {});
    const m = {};
    for (const [k, v] of Object.entries(data.mapping)) {
      if (!allowed.includes(k)) continue;
      const path = clean(v);
      if (path) m[k] = path;
    }
    config.mapping = m;
  }
  if (data.result_map !== undefined) {
    if (typeof data.result_map !== 'object' || !data.result_map) throw badRequest('Mapa de resultados inválido.');
    config.result_map = data.result_map;
  }
  if (data.base_url !== undefined) {
    const url = clean(data.base_url);
    if (url) {
      let u;
      try {
        u = new URL(url);
      } catch {
        throw badRequest('URL do simulador inválida.');
      }
      if (!['https:', 'http:'].includes(u.protocol)) throw badRequest('A URL deve usar http ou https.');
    }
    config.base_url = url;
  }
  for (const f of ['store_recording_url', 'store_message_text', 'auto_create_unknown']) {
    if (data[f] !== undefined) config[f] = !!data[f];
  }
  if (data.default_owner_id !== undefined) config.default_owner_id = data.default_owner_id ? Number(data.default_owner_id) : null;
  let status = cur.status;
  let validatedBy = cur.validated_by;
  let validatedAt = cur.validated_at;
  if (data.status !== undefined && data.status !== cur.status) {
    if (!INTEGRATION_STATUS[data.status]) throw badRequest('Status inválido.');
    if (key === 'meta_ads' && ['em_teste', 'ativa'].includes(data.status)) {
      throw badRequest('O conector direto com a Meta ainda não foi implementado. Use a API de entrada de leads.');
    }
    if (data.status === 'ativa') {
      const ok = db.prepare("SELECT COUNT(*) AS n FROM integration_logs WHERE integration = ? AND status = 'sucesso'").get(key).n;
      if (!ok) throw badRequest('Para marcar como ativa é preciso ter recebido e processado com sucesso ao menos um evento real (valide em modo "em teste").');
      if (key === 'simulador' && !config.base_url) throw badRequest('Informe a URL do simulador.');
      validatedBy = user.id;
      validatedAt = nowIso();
    }
    if (['em_teste'].includes(data.status) && key !== 'simulador' && !cur.token_hash) {
      throw badRequest('Gere o token de acesso antes de habilitar o recebimento de eventos.');
    }
    if (data.status === 'em_teste' && key === 'simulador' && (!config.base_url || !cur.token_hash)) {
      throw badRequest('Informe a URL do simulador e gere o token de acesso antes de habilitar os testes.');
    }
    status = data.status;
    if (status !== 'ativa') {
      validatedBy = null;
      validatedAt = null;
    }
  }
  db.prepare('UPDATE integrations SET config = ?, status = ?, notes = COALESCE(?, notes), validated_by = ?, validated_at = ?, updated_at = ? WHERE key = ?').run(
    JSON.stringify(config),
    status,
    data.notes !== undefined ? clean(data.notes) ?? '' : null,
    validatedBy,
    validatedAt,
    nowIso(),
    key,
  );
  audit(db, user, 'integration', null, 'configurada', { integracao: key, status: [cur.status, status], campos: Object.keys(data) });
}

function rotateToken(db, user, key) {
  requireAdmin(user);
  getIntegration(db, key);
  const token = `crm_${key}_${randomToken(24)}`;
  db.prepare('UPDATE integrations SET token_hash = ?, token_hint = ?, updated_at = ? WHERE key = ?').run(sha256(token), `…${token.slice(-4)}`, nowIso(), key);
  audit(db, user, 'integration', null, 'token_gerado', { integracao: key });
  return token;
}

/** Autentica chamadas de sistemas externos (token por integração, nunca sessão de usuário). */
function authenticate(db, key, req) {
  const integ = getIntegration(db, key);
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : String(req.headers['x-crm-token'] || '');
  if (!token || !integ.token_hash || !safeEqual(sha256(token), integ.token_hash)) {
    throw new HttpError(401, 'Token de integração inválido.');
  }
  if (['pendente', 'desativada'].includes(integ.status)) {
    throw new HttpError(503, `Integração "${integ.name}" está ${INTEGRATION_STATUS[integ.status].toLowerCase()}. Habilite-a em Configurações > Integrações.`);
  }
  return integ;
}

function logEvent(db, key, eventType, externalId, status, message, payload) {
  const now = nowIso();
  db.prepare('INSERT INTO integration_logs (integration, event_type, external_id, status, message, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    key,
    eventType,
    externalId ?? null,
    status,
    message ?? null,
    payload == null ? null : typeof payload === 'string' ? payload.slice(0, 20000) : JSON.stringify(payload).slice(0, 20000),
    now,
  );
  if (status === 'erro') {
    db.prepare('UPDATE integrations SET last_event_at = ?, last_error = ?, last_error_at = ? WHERE key = ?').run(now, message ?? null, now, key);
  } else {
    db.prepare('UPDATE integrations SET last_event_at = ? WHERE key = ?').run(now, key);
  }
}

function listLogs(db, user, key, q = {}) {
  requireAdmin(user);
  const limit = Math.min(Number(q.limit) || 100, 500);
  return db
    .prepare(`SELECT * FROM integration_logs WHERE integration = ? ${q.status ? 'AND status = ?' : ''} ORDER BY id DESC LIMIT ?`)
    .all(...[key, ...(q.status ? [q.status] : []), limit]);
}

/** Aplica o mapeamento campo CRM -> caminho no payload. */
function mapPayload(payload, mapping) {
  const out = {};
  for (const [crmField, path] of Object.entries(mapping)) {
    const v = getPath(payload, path);
    if (v !== undefined && v !== null && v !== '') out[crmField] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

module.exports = {
  DEFAULT_MAPPINGS,
  getIntegration,
  listIntegrations,
  updateIntegration,
  rotateToken,
  authenticate,
  logEvent,
  listLogs,
  mapPayload,
};
