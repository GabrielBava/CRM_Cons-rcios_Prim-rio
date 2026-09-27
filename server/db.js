'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { nowIso } = require('./util');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','gestor','consultor','leitura')),
  team_id INTEGER REFERENCES teams(id),
  dialer_agent_ref TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

-- Listas configuráveis (origens, estratégias, motivos de perda, resultados de ligação etc.)
CREATE TABLE IF NOT EXISTS options (
  id INTEGER PRIMARY KEY,
  list TEXT NOT NULL,
  value TEXT NOT NULL,
  label TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  flags TEXT NOT NULL DEFAULT '{}',
  UNIQUE (list, value)
);

-- Campos adicionais configuráveis por entidade
CREATE TABLE IF NOT EXISTS custom_fields (
  id INTEGER PRIMARY KEY,
  entity TEXT NOT NULL CHECK (entity IN ('contact','opportunity')),
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text','number','date','select','boolean','textarea')),
  options TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (entity, key)
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  administrator TEXT,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'aberta' CHECK (kind IN ('aberta','ganho','perdido','nutricao')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- Pessoa física ou jurídica (prospect, lead ou cliente)
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  uid TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('PF','PJ')),
  relationship TEXT NOT NULL DEFAULT 'prospect' CHECK (relationship IN ('prospect','lead','cliente')),
  lead_status TEXT NOT NULL DEFAULT 'novo',
  client_status TEXT,
  name TEXT NOT NULL,
  trade_name TEXT,
  legal_name TEXT,
  doc TEXT,
  state_registration TEXT,
  phone1 TEXT, phone1_norm TEXT,
  phone2 TEXT, phone2_norm TEXT,
  whatsapp TEXT, whatsapp_norm TEXT,
  email TEXT, email_norm TEXT,
  city TEXT, state TEXT,
  birth_date TEXT,
  profession TEXT,
  segment TEXT,
  company_size TEXT,
  website TEXT,
  origin TEXT,
  campaign TEXT,
  first_contact_at TEXT,
  initial_notes TEXT,
  pref_channel TEXT,
  pref_time TEXT,
  pref_phone TEXT,
  pref_frequency TEXT,
  contact_restriction TEXT,
  pref_updated_at TEXT,
  pref_source TEXT,
  optouts TEXT NOT NULL DEFAULT '[]',
  custom TEXT NOT NULL DEFAULT '{}',
  owner_id INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  converted_at TEXT,
  merged_into_id INTEGER REFERENCES contacts(id),
  anonymized_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_contacts_phone1 ON contacts(phone1_norm);
CREATE INDEX IF NOT EXISTS idx_contacts_phone2 ON contacts(phone2_norm);
CREATE INDEX IF NOT EXISTS idx_contacts_whats ON contacts(whatsapp_norm);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email_norm);
CREATE INDEX IF NOT EXISTS idx_contacts_doc ON contacts(doc);
CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_id);

-- Contatos vinculados a uma pessoa jurídica
CREATE TABLE IF NOT EXISTS company_contacts (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES contacts(id),
  name TEXT NOT NULL,
  role TEXT,
  email TEXT, email_norm TEXT,
  phone TEXT, phone_norm TEXT,
  whatsapp TEXT, whatsapp_norm TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  pref_channel TEXT,
  pref_time TEXT,
  optouts TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cc_company ON company_contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_cc_phone ON company_contacts(phone_norm);

-- Histórico de origens (um contato pode chegar mais de uma vez por canais diferentes)
CREATE TABLE IF NOT EXISTS contact_origins (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  origin TEXT,
  campaign_name TEXT,
  platform TEXT,
  platform_lead_id TEXT,
  campaign_id TEXT,
  adset_id TEXT,
  ad_id TEXT,
  received_at TEXT,
  utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT, utm_term TEXT,
  other_params TEXT,
  source_ref TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_origin_platform_lead ON contact_origins(platform, platform_lead_id) WHERE platform_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_origins_contact ON contact_origins(contact_id);

-- Consentimentos e oposições a contato (histórico; o estado atual fica em contacts.optouts)
CREATE TABLE IF NOT EXISTS consents (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  company_contact_id INTEGER REFERENCES company_contacts(id),
  channel TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('consentimento','oposicao')),
  source TEXT,
  notes TEXT,
  recorded_at TEXT NOT NULL,
  recorded_by INTEGER REFERENCES users(id)
);

-- Solicitações do titular (LGPD)
CREATE TABLE IF NOT EXISTS data_requests (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'aberta',
  details TEXT,
  resolution TEXT,
  requested_at TEXT NOT NULL,
  resolved_at TEXT,
  created_by INTEGER REFERENCES users(id),
  resolved_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  uid TEXT NOT NULL UNIQUE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  company_contact_id INTEGER REFERENCES company_contacts(id),
  title TEXT,
  product_id INTEGER REFERENCES products(id),
  stage_id INTEGER NOT NULL REFERENCES pipeline_stages(id),
  status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','ganha','perdida','pausada')),
  priority TEXT NOT NULL DEFAULT 'media',
  credit_category TEXT,
  credit_value REAL,
  term_months INTEGER,
  installment_min REAL,
  installment_max REAL,
  quotas INTEGER,
  payment_modality TEXT,
  strategy TEXT,
  strategy_validated_by INTEGER REFERENCES users(id),
  strategy_validated_at TEXT,
  contemplation_type TEXT,
  bid_own_resources REAL,
  fgts_available REAL,
  embedded_bid_interest TEXT,
  urgency TEXT,
  objective TEXT,
  qualification_criteria TEXT,
  next_action TEXT,
  next_action_at TEXT,
  lost_reason TEXT,
  lost_notes TEXT,
  pause_reason TEXT,
  custom TEXT NOT NULL DEFAULT '{}',
  stage_entered_at TEXT NOT NULL,
  last_activity_at TEXT,
  closed_at TEXT,
  owner_id INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_opp_contact ON opportunities(contact_id);
CREATE INDEX IF NOT EXISTS idx_opp_stage ON opportunities(stage_id);
CREATE INDEX IF NOT EXISTS idx_opp_owner ON opportunities(owner_id);

CREATE TABLE IF NOT EXISTS stage_history (
  id INTEGER PRIMARY KEY,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id),
  from_stage_id INTEGER REFERENCES pipeline_stages(id),
  to_stage_id INTEGER NOT NULL REFERENCES pipeline_stages(id),
  from_stage_name TEXT,
  to_stage_name TEXT NOT NULL,
  seconds_in_previous INTEGER,
  reason TEXT,
  user_id INTEGER REFERENCES users(id),
  moved_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sh_opp ON stage_history(opportunity_id);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  company_contact_id INTEGER REFERENCES company_contacts(id),
  opportunity_id INTEGER REFERENCES opportunities(id),
  type TEXT NOT NULL,
  channel TEXT,
  direction TEXT,
  result TEXT,
  duration_seconds INTEGER,
  notes TEXT,
  next_action TEXT,
  return_at TEXT,
  occurred_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT,
  call_event_id INTEGER,
  ref_type TEXT,
  ref_id INTEGER,
  user_id INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_act_contact ON activities(contact_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_act_type ON activities(type, occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_act_external ON activities(source, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER REFERENCES contacts(id),
  opportunity_id INTEGER REFERENCES opportunities(id),
  type TEXT NOT NULL DEFAULT 'retorno',
  title TEXT NOT NULL,
  notes TEXT,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','concluida','cancelada')),
  outcome TEXT,
  assigned_to INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  completed_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(status, due_at);

-- Eventos recebidos da discadora (bruto + processamento)
CREATE TABLE IF NOT EXISTS call_events (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'discadora',
  external_call_id TEXT,
  lead_ref TEXT,
  contact_id INTEGER REFERENCES contacts(id),
  phone TEXT,
  phone_norm TEXT,
  started_at TEXT,
  ended_at TEXT,
  duration_seconds INTEGER,
  agent_ref TEXT,
  user_id INTEGER REFERENCES users(id),
  technical_status TEXT,
  result TEXT,
  result_raw TEXT,
  classification TEXT,
  recording_url TEXT,
  call_origin TEXT,
  raw_payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('vinculado','sem_vinculo','erro','descartado')),
  error_message TEXT,
  candidates TEXT,
  activity_id INTEGER REFERENCES activities(id),
  attempts INTEGER NOT NULL DEFAULT 1,
  received_at TEXT NOT NULL,
  processed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_call_external ON call_events(provider, external_call_id) WHERE external_call_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_call_status ON call_events(status);

CREATE TABLE IF NOT EXISTS simulation_links (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  opportunity_id INTEGER REFERENCES opportunities(id),
  created_by INTEGER REFERENCES users(id),
  origin_screen TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  first_used_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS simulations (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  opportunity_id INTEGER REFERENCES opportunities(id),
  link_id INTEGER REFERENCES simulation_links(id),
  external_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  credit_value REAL,
  term_months INTEGER,
  installment REAL,
  payment_modality TEXT,
  strategy TEXT,
  view_url TEXT,
  status TEXT NOT NULL DEFAULT 'salva',
  version INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  raw_payload TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sim_external ON simulations(source, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS simulation_versions (
  id INTEGER PRIMARY KEY,
  simulation_id INTEGER NOT NULL REFERENCES simulations(id),
  version INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id),
  simulation_id INTEGER REFERENCES simulations(id),
  version INTEGER NOT NULL DEFAULT 1,
  previous_id INTEGER REFERENCES proposals(id),
  product_id INTEGER REFERENCES products(id),
  credit_value REAL,
  term_months INTEGER,
  initial_installment REAL,
  payment_modality TEXT,
  admin_fee_pct REAL,
  reserve_fund_pct REAL,
  insurance_pct REAL,
  other_costs TEXT,
  readjustment_index TEXT,
  readjustment_assumptions TEXT,
  strategy TEXT,
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','apresentada','em_analise','aprovada','recusada','expirada','substituida')),
  link_url TEXT,
  valid_until TEXT,
  notes TEXT,
  presented_at TEXT,
  owner_id INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prop_opp ON proposals(opportunity_id);

-- Produtos contratados pelo cliente (cada contratação é um registro novo)
CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  opportunity_id INTEGER REFERENCES opportunities(id),
  proposal_id INTEGER REFERENCES proposals(id),
  product_id INTEGER REFERENCES products(id),
  category TEXT,
  administrator TEXT,
  group_code TEXT,
  quota_code TEXT,
  credit_value REAL,
  term_months INTEGER,
  contracted_at TEXT,
  quotas INTEGER,
  status TEXT,
  payment_modality TEXT,
  strategy TEXT,
  notes TEXT,
  owner_id INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  contact_id INTEGER,
  action TEXT NOT NULL,
  changes TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_contact ON audit_log(contact_id);

CREATE TABLE IF NOT EXISTS integrations (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','em_teste','ativa','erro','desativada')),
  config TEXT NOT NULL DEFAULT '{}',
  token_hash TEXT,
  token_hint TEXT,
  last_event_at TEXT,
  last_error TEXT,
  last_error_at TEXT,
  validated_by INTEGER REFERENCES users(id),
  validated_at TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_logs (
  id INTEGER PRIMARY KEY,
  integration TEXT NOT NULL,
  event_type TEXT NOT NULL,
  external_id TEXT,
  status TEXT NOT NULL,
  message TEXT,
  payload TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intlog ON integration_logs(integration, created_at);

-- Eventos genéricos de integração recebidos (leads e mensagens) para deduplicação e reprocessamento
CREATE TABLE IF NOT EXISTS inbound_events (
  id INTEGER PRIMARY KEY,
  integration TEXT NOT NULL,
  external_id TEXT,
  payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processado','sem_vinculo','erro','duplicado')),
  contact_id INTEGER REFERENCES contacts(id),
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  received_at TEXT NOT NULL,
  processed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inbound ON inbound_events(integration, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY,
  filename TEXT,
  origin TEXT,
  campaign TEXT,
  mapping TEXT,
  total_rows INTEGER,
  created_count INTEGER,
  duplicate_count INTEGER,
  error_count INTEGER,
  errors TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
`;

const DEFAULT_OPTIONS = {
  origem: [
    ['indicacao', 'Indicação'],
    ['meta_ads', 'Meta Ads'],
    ['instagram', 'Instagram'],
    ['whatsapp', 'WhatsApp'],
    ['ligacao_ativa', 'Ligação ativa'],
    ['discadora', 'Discadora'],
    ['site', 'Site ou formulário'],
    ['evento', 'Evento'],
    ['prospeccao_propria', 'Prospecção própria'],
    ['parceiro', 'Parceiro'],
    ['importacao', 'Importação de planilha'],
    ['outra', 'Outra origem'],
  ],
  categoria_credito: [
    ['imovel', 'Imóvel'],
    ['veiculo', 'Veículo'],
    ['servico', 'Serviço'],
    ['outra', 'Outra'],
  ],
  estrategia: [
    ['aquisicao', 'Aquisição'],
    ['planejamento', 'Planejamento'],
    ['formacao_patrimonial', 'Formação patrimonial'],
    ['alavancagem', 'Alavancagem'],
    ['promocao', 'Promoção'],
    ['outra', 'Outra'],
  ],
  tipo_contemplacao: [
    ['sorteio', 'Sorteio'],
    ['lance_fixo', 'Lance fixo'],
    ['lance_livre', 'Lance livre'],
    ['combinacao', 'Combinação'],
  ],
  modalidade_pagamento: [
    ['parcela_integral', 'Parcela integral'],
    ['parcela_reduzida', 'Parcela reduzida'],
    ['outra', 'Outra'],
  ],
  urgencia: [
    ['imediata', 'Imediata (até 3 meses)'],
    ['curto', 'Curto prazo (3 a 12 meses)'],
    ['medio', 'Médio prazo (1 a 3 anos)'],
    ['longo', 'Longo prazo (mais de 3 anos)'],
    ['indefinido', 'Sem prazo definido'],
  ],
  motivo_perda: [
    ['sem_interesse', 'Sem interesse'],
    ['sem_contato', 'Não foi possível contato'],
    ['preco_parcela', 'Parcela acima do esperado'],
    ['optou_financiamento', 'Optou por financiamento'],
    ['optou_concorrente', 'Fechou com outra empresa'],
    ['sem_perfil', 'Sem perfil / não qualificado'],
    ['adiou_decisao', 'Adiou a decisão'],
    ['dados_invalidos', 'Dados de contato inválidos'],
    ['outro', 'Outro motivo'],
  ],
  resultado_ligacao: [
    ['atendida', 'Atendida', { efetivo: true }],
    ['nao_atendida', 'Não atendida'],
    ['ocupado', 'Ocupado'],
    ['caixa_postal', 'Caixa postal'],
    ['numero_invalido', 'Número inválido'],
    ['interrompida', 'Chamada interrompida'],
    ['retorno_solicitado', 'Retorno solicitado', { efetivo: true }],
    ['contato_realizado', 'Contato realizado', { efetivo: true }],
    ['nao_informado', 'Não informado pela discadora'],
    ['outro', 'Outro resultado'],
  ],
  canal: [
    ['ligacao', 'Ligação'],
    ['whatsapp', 'WhatsApp'],
    ['email', 'E-mail'],
    ['presencial', 'Presencial'],
    ['video', 'Vídeo'],
    ['sms', 'SMS'],
    ['outro', 'Outro'],
  ],
  frequencia_contato: [
    ['semanal', 'Até 1 vez por semana'],
    ['quinzenal', 'Quinzenal'],
    ['mensal', 'Mensal'],
    ['sob_demanda', 'Somente quando solicitar'],
  ],
  status_contrato: [
    ['em_formalizacao', 'Em formalização'],
    ['ativo', 'Ativo'],
    ['contemplado', 'Contemplado'],
    ['quitado', 'Quitado'],
    ['cancelado', 'Cancelado'],
  ],
  indice_reajuste: [
    ['incc', 'INCC'],
    ['ipca', 'IPCA'],
    ['igpm', 'IGP-M'],
    ['preco_bem', 'Variação do preço do bem'],
    ['outro', 'Outro'],
  ],
  segmento: [
    ['comercio', 'Comércio'],
    ['industria', 'Indústria'],
    ['servicos', 'Serviços'],
    ['agro', 'Agronegócio'],
    ['outro', 'Outro'],
  ],
  porte: [
    ['mei', 'MEI'],
    ['me', 'Microempresa'],
    ['epp', 'Empresa de pequeno porte'],
    ['medio', 'Médio porte'],
    ['grande', 'Grande porte'],
  ],
};

const DEFAULT_STAGES = [
  ['Novo prospect', 'aberta'],
  ['Tentativa de contato', 'aberta'],
  ['Contato realizado', 'aberta'],
  ['Lead qualificado', 'aberta'],
  ['Diagnóstico ou reunião agendada', 'aberta'],
  ['Diagnóstico realizado', 'aberta'],
  ['Simulação em elaboração', 'aberta'],
  ['Proposta apresentada', 'aberta'],
  ['Follow-up', 'aberta'],
  ['Em negociação', 'aberta'],
  ['Venda concluída', 'ganho'],
  ['Perdido', 'perdido'],
  ['Nutrição futura', 'nutricao'],
];

const DEFAULT_INTEGRATIONS = [
  ['discadora', 'Discadora'],
  ['simulador', 'Simulador de consórcio'],
  ['meta_ads', 'Meta Ads (Lead Ads)'],
  ['whatsapp', 'WhatsApp'],
  ['api_leads', 'API de entrada de leads (site, formulários, conectores)'],
];

const DEFAULT_SETTINGS = {
  stalled_days: 7,
  simulation_link_hours: 24,
  field_config: {},
};

function seedDefaults(db) {
  const now = nowIso();
  const hasOptions = db.prepare('SELECT COUNT(*) AS n FROM options').get().n > 0;
  if (!hasOptions) {
    const ins = db.prepare('INSERT INTO options (list, value, label, position, flags) VALUES (?, ?, ?, ?, ?)');
    for (const [list, items] of Object.entries(DEFAULT_OPTIONS)) {
      items.forEach(([value, label, flags], i) => ins.run(list, value, label, i, JSON.stringify(flags || {})));
    }
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM pipeline_stages').get().n === 0) {
    const ins = db.prepare('INSERT INTO pipeline_stages (name, position, kind, created_at) VALUES (?, ?, ?, ?)');
    DEFAULT_STAGES.forEach(([name, kind], i) => ins.run(name, i, kind, now));
  }
  const insInt = db.prepare('INSERT OR IGNORE INTO integrations (key, name, updated_at) VALUES (?, ?, ?)');
  for (const [key, name] of DEFAULT_INTEGRATIONS) insInt.run(key, name, now);
  const insSet = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSet.run(k, JSON.stringify(v));
  if (db.prepare('SELECT COUNT(*) AS n FROM products').get().n === 0) {
    const ins = db.prepare(
      'INSERT INTO products (name, category, administrator, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    ins.run('Consórcio de imóvel', 'imovel', null, 'Produto genérico — ajuste administradora e condições.', now, now);
    ins.run('Consórcio de veículo', 'veiculo', null, 'Produto genérico — ajuste administradora e condições.', now, now);
    ins.run('Consórcio de serviços', 'servico', null, 'Produto genérico — ajuste administradora e condições.', now, now);
  }
}

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  seedDefaults(db);
  return db;
}

/** Executa fn dentro de uma transação (aninhamento via SAVEPOINT). */
let depth = 0;
function tx(db, fn) {
  const sp = `sp${depth}`;
  db.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${sp}`);
  depth++;
  try {
    const r = fn();
    depth--;
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return r;
  } catch (e) {
    depth--;
    db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw e;
  }
}

function nextCode(db, name, prefix) {
  db.prepare('INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1').run(name);
  const n = db.prepare('SELECT value FROM counters WHERE name = ?').get(name).value;
  return `${prefix}-${String(n).padStart(6, '0')}`;
}

function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return DEFAULT_SETTINGS[key];
  return JSON.parse(row.value);
}
function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value),
  );
}

module.exports = { openDb, tx, nextCode, getSetting, setSetting, DEFAULT_SETTINGS };
