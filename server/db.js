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

// Prioridade do crédito (quando o lead quer o crédito): curto = 3 meses, médio = 12 meses, longo = 24 meses
const URGENCIA = [
  ['curto', 'Curto prazo (até 3 meses)'],
  ['medio', 'Médio prazo (até 12 meses)'],
  ['longo', 'Longo prazo (24 meses ou mais)'],
];
// Finalidade do crédito (bloco Necessidade da qualificação)
const FINALIDADES = [
  ['moradia', 'Casa própria (moradia)'],
  ['imovel_investimento', 'Imóvel para investimento ou renda'],
  ['terreno_construcao', 'Terreno ou construção'],
  ['reforma', 'Reforma'],
  ['quitar_financiamento', 'Quitar ou trocar um financiamento'],
  ['veiculo_uso', 'Veículo para uso pessoal'],
  ['veiculo_trabalho', 'Veículo para trabalho'],
  ['empresa', 'Bens ou expansão da empresa'],
  ['servicos', 'Serviços (estudo, viagem, saúde, festa)'],
  ['patrimonio', 'Formação de patrimônio ou aposentadoria'],
  ['outra', 'Outra'],
];

const POS_VENDA_ITEMS = [
  ['primeira_parcela', 'Confirmar a 1ª parcela paga'],
  ['onboarding', 'Onboarding do cliente'],
  ['acesso_cliente', 'Acesso do cliente ao aplicativo e à cota'],
  ['recebimento_boletos', 'Como vai receber o boleto'],
  ['estrategia_lance', 'Cadastro da estratégia de lance'],
  ['preferencias_contato', 'Preferências de contato'],
  ['nps', 'Pesquisa de satisfação (NPS)'],
  ['indicacao', 'Pedido de indicações'],
];

// Motivos de recusa de proposta usados no mercado de consórcio (base para o trabalho de recuperação/closer)
const MOTIVOS_RECUSA = [
  ['nao_e_momento', 'Não é o momento (adiou a decisão)', { recuperavel: true }],
  ['parcela_alta', 'Parcela acima do esperado', { recuperavel: true }],
  ['prazo', 'Prazo não atende', { recuperavel: true }],
  ['credito', 'Crédito não atende', { recuperavel: true }],
  ['taxa_adm', 'Taxa de administração alta', { recuperavel: true }],
  ['contemplacao', 'Insegurança com o prazo de contemplação', { recuperavel: true }],
  ['financiamento', 'Preferiu financiamento'],
  ['concorrente', 'Escolheu outra administradora ou empresa'],
  ['decisor', 'Cônjuge ou sócio (decisor) não aprovou', { recuperavel: true }],
  ['renda', 'Renda ou crédito insuficiente'],
  ['sem_retorno', 'Parou de responder', { recuperavel: true }],
  ['desistiu', 'Desistiu da compra'],
  ['outro', 'Outro motivo'],
];

const DEFAULT_OPTIONS = {
  origem: [
    ['indicacao', 'Indicação'],
    ['meta_ads', 'Meta Ads'],
    ['instagram', 'Instagram'],
    ['whatsapp', 'WhatsApp'],
    ['ligacao_ativa', 'Ligação ativa'],
    ['discadora', 'Discadora'],
    ['facebook', 'Facebook'],
    ['linkedin', 'LinkedIn'],
    ['tiktok', 'TikTok'],
    ['landing_page', 'Landing page'],
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
    ['lance_fidelidade', 'Lance fidelidade'],
    ['lance_retido', 'Lance retido'],
  ],
  modalidade_pagamento: [
    ['parcela_integral', 'Parcela integral'],
    ['parcela_reduzida', 'Parcela reduzida'],
    ['outra', 'Outra'],
  ],
  urgencia: URGENCIA,
  finalidade_credito: FINALIDADES,
  divisao_cotas: [
    ['unica', 'Cota única'],
    ['iguais', 'Cotas iguais (mesmo valor e grupo)'],
    ['grupos_diferentes', 'Cotas em grupos diferentes (mais chances de contemplação)'],
    ['valores_diferentes', 'Cotas de valores diferentes (escalonadas)'],
    ['prazos_diferentes', 'Cotas com prazos diferentes'],
    ['outra', 'Outra lógica'],
  ],
  sexo: [
    ['feminino', 'Feminino'],
    ['masculino', 'Masculino'],
    ['nao_informado', 'Prefiro não informar'],
  ],
  estado_civil: [
    ['solteiro', 'Solteiro(a)'],
    ['casado', 'Casado(a)', { conjuge: true }],
    ['uniao_estavel', 'União estável', { conjuge: true }],
    ['divorciado', 'Divorciado(a)'],
    ['separado', 'Separado(a)'],
    ['viuvo', 'Viúvo(a)'],
  ],
  regime_bens: [
    ['comunhao_parcial', 'Comunhão parcial de bens'],
    ['comunhao_universal', 'Comunhão universal de bens'],
    ['separacao_total', 'Separação total de bens'],
    ['participacao_final', 'Participação final nos aquestos'],
  ],
  faixa_renda: [
    ['ate_3k', 'Até R$ 3.000'],
    ['3k_6k', 'R$ 3.001 a R$ 6.000'],
    ['6k_10k', 'R$ 6.001 a R$ 10.000'],
    ['10k_20k', 'R$ 10.001 a R$ 20.000'],
    ['20k_40k', 'R$ 20.001 a R$ 40.000'],
    ['acima_40k', 'Acima de R$ 40.000'],
  ],
  faixa_patrimonio: [
    ['ate_100k', 'Até R$ 100 mil'],
    ['100k_500k', 'R$ 100 mil a R$ 500 mil'],
    ['500k_1m', 'R$ 500 mil a R$ 1 milhão'],
    ['1m_5m', 'R$ 1 milhão a R$ 5 milhões'],
    ['acima_5m', 'Acima de R$ 5 milhões'],
  ],
  faixa_faturamento: [
    ['ate_360k', 'Até R$ 360 mil/ano'],
    ['360k_4_8m', 'R$ 360 mil a R$ 4,8 milhões/ano'],
    ['4_8m_30m', 'R$ 4,8 milhões a R$ 30 milhões/ano'],
    ['acima_30m', 'Acima de R$ 30 milhões/ano'],
  ],
  finalidade_moradia: [
    ['morar', 'Para morar'],
    ['investir', 'Para investir (renda ou valorização)'],
  ],
  tipo_imovel: [
    ['apartamento', 'Apartamento'],
    ['casa', 'Casa'],
    ['casa_condominio', 'Casa em condomínio'],
    ['terreno', 'Terreno'],
    ['sala_comercial', 'Sala ou loja comercial'],
    ['galpao', 'Galpão'],
    ['rural', 'Imóvel rural'],
    ['outro', 'Outro'],
  ],
  origem_lance: [
    ['reserva', 'Reserva financeira (recurso próprio)'],
    ['fgts', 'FGTS'],
    ['reserva_fgts', 'Reserva e FGTS'],
    ['venda_bem', 'Venda de um bem'],
    ['outro', 'Outro'],
  ],
  escolha_contemplacao: [
    ['faturamento', 'Faturamento (usar o crédito na compra do bem)'],
    ['venda', 'Venda da carta contemplada'],
  ],
  temperatura: [
    ['frio', 'Frio'],
    ['morno', 'Morno'],
    ['quente', 'Quente'],
  ],
  objetivo: [
    ['aquisicao', 'Aquisição'],
    ['alavancagem', 'Alavancagem patrimonial'],
    ['investimento', 'Investimento'],
  ],
  tipo_produto: [
    ['primario', 'Primário (cota nova)'],
    ['contemplada', 'Carta contemplada'],
  ],
  momento_financeiro: [
    ['organizado_reserva', 'Organizado, com reserva'],
    ['organizado_sem_reserva', 'Organizado, sem reserva'],
    ['apertado', 'Orçamento apertado'],
    ['endividado', 'Endividado'],
  ],
  tipo_contratacao: [
    ['clt', 'CLT'],
    ['pj', 'PJ'],
    ['autonomo', 'Autônomo / profissional liberal'],
    ['servidor', 'Servidor público'],
    ['empresario', 'Empresário'],
    ['aposentado', 'Aposentado / pensionista'],
    ['outro', 'Outro'],
  ],
  possui_fgts: [
    ['sim', 'Sim'],
    ['nao', 'Não'],
    ['nao_sabe', 'Não sabe'],
  ],
  decisor: [
    ['sozinho', 'Decide sozinho'],
    ['conjuge', 'Com cônjuge'],
    ['socio', 'Com sócio'],
    ['familia', 'Com a família'],
    ['outro', 'Outro'],
  ],
  possui_produto: [
    ['nenhum', 'Não possui'],
    ['consorcio', 'Consórcio'],
    ['financiamento', 'Financiamento'],
    ['ambos', 'Consórcio e financiamento'],
  ],
  tipo_endereco: [
    ['residencial', 'Residencial'],
    ['comercial', 'Comercial'],
    ['correspondencia', 'Correspondência'],
  ],
  tipo_documento: [
    ['identificacao', 'Documento de identificação', { pf: true }],
    ['comprovante_endereco', 'Comprovante de endereço', { pf: true, pj: true }],
    ['comprovante_renda', 'Comprovante de renda', { pf: true }],
    ['comprovante_estado_civil', 'Comprovante de estado civil', { pf: true }],
    ['contrato_social', 'Contrato social e última alteração', { pj: true }],
    ['cartao_cnpj', 'Cartão CNPJ', { pj: true }],
    ['faturamento', 'Faturamento dos últimos 12 meses', { pj: true }],
    ['doc_representante', 'Documento do representante legal', { pj: true }],
    ['proposta', 'Proposta'],
    ['comprovante_pagamento', 'Comprovante de pagamento'],
    ['outro', 'Outro'],
  ],
  relacao_socio: [
    ['socio', 'Sócio'],
    ['representante', 'Representante legal'],
    ['administrador', 'Administrador'],
  ],
  canal_aceite: [
    ['whatsapp', 'WhatsApp'],
    ['email', 'E-mail'],
    ['telefone', 'Telefone'],
    ['presencial', 'Presencial'],
    ['assinatura_digital', 'Assinatura digital'],
  ],
  motivo_recusa_proposta: MOTIVOS_RECUSA,
  // Motivos de insatisfação na pesquisa de satisfação (NPS) do pós-venda
  motivo_insatisfacao: [
    ['atendimento', 'Atendimento do especialista'],
    ['demora', 'Demora para responder'],
    ['informacao', 'Falta de informação (assembleias, lances, contemplação)'],
    ['expectativa_contemplacao', 'Expectativa de contemplação não atendida'],
    ['boleto_cobranca', 'Boleto ou cobrança'],
    ['valor_parcela', 'Valor da parcela ou reajuste'],
    ['administradora', 'Atendimento ou portal da administradora'],
    ['outro', 'Outro motivo'],
  ],
  tipo_lancamento: [
    ['parcela', 'Parcela'],
    ['adesao', 'Taxa de adesão / 1ª parcela'],
    ['lance', 'Lance'],
    ['transferencia', 'Taxa de transferência'],
    ['outro', 'Outro'],
  ],
  forma_pagamento: [
    ['boleto', 'Boleto'],
    ['pix', 'PIX'],
    ['cartao', 'Cartão'],
    ['debito', 'Débito em conta'],
    ['outro', 'Outro'],
  ],
  etapa_pos_venda: POS_VENDA_ITEMS,
  motivo_cancelamento: [
    ['arrependimento_7_dias', 'Arrependimento no prazo de 7 dias'],
    ['dificuldade_financeira', 'Dificuldade financeira'],
    ['expectativa_contemplacao', 'Expectativa de contemplação não atendida'],
    ['venda_mal_explicada', 'Produto mal explicado na venda'],
    ['insatisfacao_atendimento', 'Insatisfação com o atendimento'],
    ['optou_outro_produto', 'Optou por outro produto'],
    ['inadimplencia', 'Exclusão por inadimplência'],
    ['outro', 'Outro motivo'],
  ],
  categoria_treinamento: [
    ['fundamentos', 'Fundamentos do consórcio'],
    ['lances', 'Lances e contemplação'],
    ['fgts', 'Uso do FGTS'],
    ['calculos', 'Cálculos financeiros'],
    ['processo_comercial', 'Processo comercial (funil)'],
    ['administradoras', 'Administradoras e planos'],
    ['compliance', 'Compliance e LGPD'],
    ['ferramentas', 'Ferramentas (CRM e simulador)'],
  ],
  resposta_proposta: [
    ['positiva', 'Positiva: quer avançar', { score: 20 }],
    ['duvidas', 'Tem dúvidas / pediu ajuste', { score: 5 }],
    ['sem_resposta', 'Sem resposta', { score: -5 }],
    ['negativa', 'Negativa: não vai seguir agora', { score: -25 }],
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

/*
 * Funil de vendas (esteira do especialista). A chave identifica a etapa nas regras de passagem;
 * o nome pode ser ajustado em Configurações › Funil. [nome, tipo, chave, dias até ficar "parado", objetivo da etapa]
 */
const DEFAULT_STAGES = [
  ['Prospect', 'aberta', 'prospect', 3, 'Contato ainda não demonstrou interesse. Objetivo: validar os dados de contato e a origem.'],
  ['Lead', 'aberta', 'lead', 1, 'Demonstrou interesse. Objetivo: fazer o primeiro contato o quanto antes (idealmente em até 1 hora).'],
  ['Tentativa de contato', 'aberta', 'tentativa', 3, 'Cadência de tentativas por ligação e WhatsApp até conseguir falar com o lead.'],
  ['Lead qualificado', 'aberta', 'qualificado', 5, 'Conversa realizada. Objetivo: entender objetivo, crédito, parcela possível e prazo, e agendar a R1.'],
  ['R1', 'aberta', 'r1', 7, 'Reunião de diagnóstico (R1). Objetivo: apresentar o consórcio, validar a estratégia e o decisor.'],
  ['R1 bolo', 'aberta', 'r1_bolo', 3, 'O cliente agendou a R1 e não compareceu. Objetivo: entender o motivo e reagendar a reunião (Agendar R1).'],
  ['Negociação', 'aberta', 'negociacao', 5, 'Montar e apresentar a proposta no simulador com base na R1.'],
  ['Follow-up', 'aberta', 'follow_up', 10, 'Proposta enviada. Seguir a esteira de follow-up (D0 a D10) até o aceite ou a decisão.'],
  ['Venda', 'ganho', 'venda', null, 'Venda confirmada com o pagamento da primeira parcela. Entra automaticamente pela tela de Vendas.'],
  ['Nutrição futura', 'nutricao', 'nutricao', null, 'Sem momento agora. Registrar o motivo e a data para retomar o contato.'],
  ['Perdido', 'perdido', 'perdido', null, 'Negócio encerrado. O motivo da perda alimenta os relatórios.'],
];
// Etapas da versão anterior do funil → nova chave (usado na migração de bancos existentes)
const OLD_STAGE_MAP = {
  'Novo prospect': 'prospect', 'Tentativa de contato': 'tentativa', 'Contato realizado': 'tentativa', 'Lead qualificado': 'qualificado',
  'Diagnóstico ou reunião agendada': 'r1', 'Diagnóstico realizado': 'r1', 'Simulação em elaboração': 'negociacao',
  'Proposta apresentada': 'follow_up', 'Follow-up': 'follow_up', 'Em negociação': 'negociacao', 'Venda concluída': 'venda',
  Perdido: 'perdido', 'Nutrição futura': 'nutricao',
};

/** Converte o funil antigo (13 etapas) no novo (10 etapas), movendo as oportunidades. Idempotente. */
function migrateStages(db, now) {
  const withKey = db.prepare('SELECT COUNT(*) AS n FROM pipeline_stages WHERE key IS NOT NULL').get().n;
  if (withKey) return;
  const rows = db.prepare('SELECT * FROM pipeline_stages ORDER BY position, id').all();
  const byKey = {};
  for (const r of rows) {
    const k = OLD_STAGE_MAP[r.name];
    if (!k) continue;
    if (!byKey[k]) byKey[k] = r.id;
    else {
      // Etapa antiga que foi incorporada a outra: move as oportunidades e desativa
      db.prepare('UPDATE opportunities SET stage_id = ? WHERE stage_id = ?').run(byKey[k], r.id);
      db.prepare('UPDATE pipeline_stages SET active = 0, position = ? WHERE id = ?').run(900 + r.id, r.id);
    }
  }
  DEFAULT_STAGES.forEach(([name, kind, key, rot, playbook], i) => {
    if (byKey[key]) {
      db.prepare('UPDATE pipeline_stages SET name = ?, kind = ?, key = ?, rot_days = ?, playbook = ?, position = ?, active = 1 WHERE id = ?').run(name, kind, key, rot, playbook, i, byKey[key]);
    } else {
      db.prepare('INSERT INTO pipeline_stages (name, position, kind, key, rot_days, playbook, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(name, i, kind, key, rot, playbook, now);
    }
  });
  // Etapas personalizadas (fora do mapa) ficam ativas, antes de "Venda"
  const custom = db.prepare('SELECT id FROM pipeline_stages WHERE key IS NULL AND active = 1 ORDER BY position').all();
  custom.forEach((c, i) => db.prepare('UPDATE pipeline_stages SET position = ? WHERE id = ?').run(6.5 + i / 100, c.id));
  const all = db.prepare('SELECT id FROM pipeline_stages WHERE active = 1 ORDER BY position').all();
  all.forEach((r, i) => db.prepare('UPDATE pipeline_stages SET position = ? WHERE id = ?').run(i, r.id));
}

const DEFAULT_INTEGRATIONS = [
  ['discadora', 'Discadora'],
  ['simulador', 'Simulador de consórcio'],
  ['meta_ads', 'Meta Ads (Lead Ads)'],
  ['whatsapp', 'WhatsApp'],
  ['api_leads', 'API de entrada de leads (site, formulários, conectores)'],
  ['agenda_externa', 'Google Agenda / Outlook'],
  ['bi', 'Conexão BI (Power BI, Looker Studio, Excel)'],
];

/** Pastas padrão da Central de documentos (estrutura de documentos de um ERP). */
const DOC_FOLDERS = [
  ['Societário e institucional', 'Contrato social e alterações, cartão CNPJ, atas, procurações, quadro societário.'],
  ['Fiscal e tributário', 'Inscrições estadual e municipal, certidões negativas, guias, declarações e apurações.'],
  ['Jurídico e contratos', 'Contratos com administradoras, parceiros, fornecedores e clientes; processos e notificações.'],
  ['Licenças, registros e certidões', 'Alvará, registros em órgãos de classe, certificado digital, marcas (INPI).'],
  ['Gestão e organizacional', 'Planejamento, políticas internas, organograma, processos e manuais.'],
  ['Pessoas e RH', 'Modelos de contrato, políticas de RH, convenção coletiva, documentos trabalhistas da empresa.'],
  ['Financeiro e bancário', 'Contas bancárias, contratos bancários, seguros, empréstimos e garantias.'],
  ['Marca e comunicação', 'Manual da marca, logos, apresentações institucionais e materiais oficiais.'],
];

const DEFAULT_SETTINGS = {
  // Endereço do site para onde o usuário vai ao sair do sistema (vazio: volta para a tela de login)
  logout_url: '',
  // Responsável pós-venda padrão dos novos clientes (vazio: o especialista da venda)
  postsale_user_id: null,
  stalled_days: 7,
  simulation_link_hours: 24,
  field_config: {},
  require_sale_checklist: true,
  client_link_days: 7,
  finance_user_id: null,
  company_name: 'Vero Consórcios',
  nps_link_days: 15,
  // Regras do funil: passagem sequencial e critérios de entrada por etapa (ver server/services/pipeline.js)
  funnel_sequential: true,
  stage_rules: null,
  presale_alert_hours: 24,
  // Ordem da pré-venda depois do termo de adesão: false = contrato assinado antes do pagamento (padrão do mercado)
  presale_payment_first: false,
  // Bônus de formalização (% do crédito) para o especialista que anexa o comprovante e confirma a alocação no prazo (0 = desligado)
  formalization_bonus_pct: 0,
  formalization_sla_days: 5,
  // Indicações só são pedidas para clientes com NPS a partir desta nota (promotores = 9)
  postsale_referral_min_nps: 9,
  // Linha do tempo do pós-venda: D+N (dias corridos a partir da confirmação da venda) de cada etapa
  postsale_days: { primeira_parcela: 0, onboarding: 1, acesso_cliente: 5, recebimento_boletos: 7, estrategia_lance: 10, preferencias_contato: 15, nps: 30, indicacao: 35 },
  roleta: { mode: 'sequencial', auto: true, participants: [], last_user_id: null, first_contact_hours: 1 },
  // Leads de formulário (Meta Ads, Instagram, Facebook, LinkedIn, TikTok, landing page e site) entram direto em "Tentativa de contato"
  auto_tentativa_origins: ['meta_ads', 'instagram', 'facebook', 'linkedin', 'tiktok', 'landing_page', 'site'],
  presale_email_subject: 'Seu cadastro para a adesão ao consórcio',
  // Simulador usado para gerar propostas (o CRM envia nome e contato do cliente no endereço)
  // Padrão: o simulador servido pelo próprio CRM (public/simulador); a versão de teste on-line usa o artefato
  proposal_simulator_url: '/simulador/index.html',
  // Landing page: origens que podem enviar leads de outro domínio (vazio = só o próprio CRM; "*" = qualquer site)
  lp_allowed_origins: ['*'],
  // Google Agenda (OAuth do Google Cloud): ID do cliente, chave cifrada e endereço público do CRM para o retorno
  google_client_id: '',
  google_client_secret_enc: null,
  public_url: '',
  // R1: título do evento ({cliente}, {empresa}) e duração padrão em minutos
  r1_title_template: '[R1] {cliente} | {empresa}',
  r1_duration_min: 30,
  // Domínio da empresa: quem entra no Meet com conta deste domínio não conta como cliente na presença da R1
  internal_domain: 'veroconsorciosbr.com.br',
  // Reserva mínima de caixa (relatório de saldos: o que passar disso é excedente de caixa)
  cash_reserve_min: 0,
  // Presença automática da R1 pelo Google Meet (precisa da permissão do Meet na conexão do especialista)
  r1_auto_attendance: true,
  // Documentos obrigatórios da ficha: identificação e comprovante de endereço (foto ou PDF)
  doc_checklist: {
    PF: ['identificacao', 'comprovante_endereco'],
    PJ: ['doc_representante', 'comprovante_endereco'],
  },
  // E-mail (SMTP) para enviar a ficha ao cliente; remetente padrão noreply@veroconsorciosbr.com.br
  smtp: null,
};

function seedDefaults(db) {
  const now = nowIso();
  // Cada lista é semeada quando ainda não tem itens (inclui listas novas em bancos já existentes)
  const ins = db.prepare('INSERT INTO options (list, value, label, position, flags) VALUES (?, ?, ?, ?, ?)');
  for (const [list, items] of Object.entries(DEFAULT_OPTIONS)) {
    if (db.prepare('SELECT COUNT(*) AS n FROM options WHERE list = ?').get(list).n > 0) continue;
    items.forEach(([value, label, flags], i) => ins.run(list, value, label, i, JSON.stringify(flags || {})));
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM pipeline_stages').get().n === 0) {
    const ins = db.prepare('INSERT INTO pipeline_stages (name, position, kind, key, rot_days, playbook, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    DEFAULT_STAGES.forEach(([name, kind, key, rot, playbook], i) => ins.run(name, i, kind, key, rot, playbook, now));
  } else migrateStages(db, now);
  const insInt = db.prepare('INSERT OR IGNORE INTO integrations (key, name, updated_at) VALUES (?, ?, ?)');
  for (const [key, name] of DEFAULT_INTEGRATIONS) insInt.run(key, name, now);
  const insSet = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSet.run(k, JSON.stringify(v));
  // Checklist do pós-venda revisado: desativa as etapas antigas (o histórico é mantido) e inclui as novas
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'migr_pos_venda_v2'").get()) {
    const old = ['boas_vindas', 'assembleias', 'contemplacao'];
    db.prepare(`UPDATE options SET active = 0 WHERE list = 'etapa_pos_venda' AND value IN (${old.map(() => '?').join(',')})`).run(...old);
    POS_VENDA_ITEMS.forEach(([value, label], i) => {
      const cur = db.prepare("SELECT id FROM options WHERE list = 'etapa_pos_venda' AND value = ?").get(value);
      if (cur) db.prepare('UPDATE options SET label = ?, position = ?, active = 1 WHERE id = ?').run(label, i, cur.id);
      else ins.run('etapa_pos_venda', value, label, i, '{}');
    });
    db.prepare("INSERT INTO settings (key, value) VALUES ('migr_pos_venda_v2', 'true')").run();
  }
  // Inclui itens novos em listas já existentes (sem alterar os que o administrador editou)
  const addMissing = (list, items) => {
    const has = new Set(db.prepare('SELECT value FROM options WHERE list = ?').all(list).map((r) => r.value));
    let pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM options WHERE list = ?').get(list).p;
    for (const [value, label, flags] of items) if (!has.has(value)) ins.run(list, value, label, pos++, JSON.stringify(flags || {}));
  };
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'migr_listas_v3'").get()) {
    addMissing('motivo_recusa_proposta', MOTIVOS_RECUSA);
    for (const [value, , flags] of MOTIVOS_RECUSA) if (flags) db.prepare("UPDATE options SET flags = ? WHERE list = 'motivo_recusa_proposta' AND value = ? AND flags = '{}'").run(JSON.stringify(flags), value);
    if (!db.prepare("SELECT 1 FROM options WHERE list = 'etapa_pos_venda' AND value = 'preferencias_contato'").get()) {
      const ind = db.prepare("SELECT position FROM options WHERE list = 'etapa_pos_venda' AND value = 'indicacao'").get();
      if (ind) db.prepare("UPDATE options SET position = position + 1 WHERE list = 'etapa_pos_venda' AND position >= ?").run(ind.position);
      ins.run('etapa_pos_venda', 'preferencias_contato', 'Preferências de contato', ind ? ind.position : 99, '{}');
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('migr_listas_v3', 'true')").run();
  }
  // Qualificação em blocos: prioridade do crédito em 3/12/24 meses e experiência com consórcio separada de financiamento
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'migr_qualificacao_v4'").get()) {
    const OLD_URG = { curto: 'Curto prazo (até 12 meses)', medio: 'Médio prazo (1 a 3 anos)', longo: 'Longo prazo (acima de 3 anos)' };
    for (const [value, label] of URGENCIA) db.prepare("UPDATE options SET label = ? WHERE list = 'urgencia' AND value = ? AND label = ?").run(label, value, OLD_URG[value]);
    db.exec(`UPDATE opportunities SET had_consortium = CASE WHEN existing_products IN ('consorcio','ambos') THEN 'sim' ELSE 'nao' END,
      has_financing = CASE WHEN existing_products IN ('financiamento','ambos') THEN 'sim' ELSE 'nao' END
      WHERE existing_products IS NOT NULL AND had_consortium IS NULL`);
    db.exec("UPDATE opportunities SET has_bid_resources = 'sim' WHERE has_bid_resources IS NULL AND bid_own_resources > 0");
    db.prepare("INSERT INTO settings (key, value) VALUES ('migr_qualificacao_v4', 'true')").run();
  }
  // Pós-venda em funil (farm): nova ordem, acesso do cliente e NPS como etapas; pré-venda com várias cotas
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'migr_fluxo_venda_v4'").get()) {
    POS_VENDA_ITEMS.forEach(([value, label], i) => {
      const cur = db.prepare("SELECT id FROM options WHERE list = 'etapa_pos_venda' AND value = ?").get(value);
      if (cur) db.prepare('UPDATE options SET label = ?, position = ?, active = 1 WHERE id = ?').run(label, i, cur.id);
      else ins.run('etapa_pos_venda', value, label, i, '{}');
    });
    db.prepare(`UPDATE options SET position = position + 100 WHERE list = 'etapa_pos_venda' AND value NOT IN (${POS_VENDA_ITEMS.map(() => '?').join(',')})`).run(...POS_VENDA_ITEMS.map(([v]) => v));
    // Etapas antigas da pré-venda: "contrato enviado" fica dentro do termo; "boleto emitido" vira "pagamento enviado"
    db.exec("UPDATE pre_sales SET status = 'termo_adesao' WHERE status = 'contrato_enviado'");
    db.exec("UPDATE pre_sales SET status = 'pagamento_enviado', payment_method = 'boleto', payment_sent_at = COALESCE(boleto_issued_at, updated_at) WHERE status = 'boleto_emitido'");
    // Cada pré-venda com termo de adesão passa a ter a sua cota (a venda antiga tinha uma cota só)
    const nowTs = now;
    for (const ps of db.prepare("SELECT ps.*, s.group_code AS s_group, s.quota_code AS s_quota FROM pre_sales ps LEFT JOIN sales s ON s.id = ps.sale_id WHERE ps.status IN ('termo_adesao','contrato_assinado','pagamento_enviado','pagamento_comprovado','concluida') AND ps.credit_value IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pre_sale_quotas q WHERE q.pre_sale_id = ps.id)").all()) {
      db.prepare('INSERT INTO pre_sale_quotas (pre_sale_id, sale_id, position, credit_value, group_code, quota_code, contract_number, contract_id, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?, (SELECT contract_id FROM sales WHERE id = ?), ?, ?)')
        .run(ps.id, ps.sale_id ?? null, ps.credit_value, ps.s_group ?? null, ps.s_quota ?? null, ps.adhesion_number ?? null, ps.sale_id ?? null, nowTs, nowTs);
    }
    db.exec('UPDATE contracts SET sale_id = (SELECT s.id FROM sales s WHERE s.contract_id = contracts.id) WHERE sale_id IS NULL');
    db.exec("UPDATE contacts SET postsale_started_at = (SELECT MIN(s.confirmed_at) FROM sales s WHERE s.contact_id = contacts.id AND s.status = 'confirmada') WHERE postsale_started_at IS NULL");
    db.prepare("INSERT INTO settings (key, value) VALUES ('migr_fluxo_venda_v4', 'true')").run();
  }
  seedTreasury(db, now);
  // v5: novas origens de formulário, tipos de contemplação e roleta automática (entrada imediata + rotina a cada 15 minutos)
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'migr_v5_leads'").get()) {
    const addOpt = (list, items) => {
      let pos = db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM options WHERE list = ?').get(list).p;
      for (const [value, label] of items) {
        if (!db.prepare('SELECT 1 FROM options WHERE list = ? AND value = ?').get(list, value)) db.prepare("INSERT INTO options (list, value, label, position, flags) VALUES (?, ?, ?, ?, '{}')").run(list, value, label, ++pos);
      }
    };
    addOpt('origem', [['facebook', 'Facebook'], ['linkedin', 'LinkedIn'], ['tiktok', 'TikTok'], ['landing_page', 'Landing page']]);
    addOpt('tipo_contemplacao', [['lance_fidelidade', 'Lance fidelidade'], ['lance_retido', 'Lance retido']]);
    const r = db.prepare("SELECT value FROM settings WHERE key = 'roleta'").get();
    if (r) {
      const cfg = JSON.parse(r.value || '{}');
      db.prepare("UPDATE settings SET value = ? WHERE key = 'roleta'").run(JSON.stringify({ ...cfg, auto: true }));
    }
    db.exec('UPDATE contracts SET installment_initial = installment_value WHERE installment_initial IS NULL AND installment_value IS NOT NULL');
    db.exec("UPDATE contracts SET adhesion_date = (SELECT s.allocated_on FROM sales s WHERE s.id = contracts.sale_id) WHERE adhesion_date IS NULL AND sale_id IS NOT NULL");
    db.prepare("INSERT INTO settings (key, value) VALUES ('migr_v5_leads', 'true')").run();
  }
  // v6: objetivo "alavancagem" (landing page: Investimento e Mecanismo de Alavancagem)
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'migr_v6_lp'").get()) {
    if (!db.prepare("SELECT 1 FROM options WHERE list = 'objetivo' AND value = 'alavancagem'").get()) {
      const pos = db.prepare("SELECT COALESCE(MAX(position), -1) AS p FROM options WHERE list = 'objetivo'").get().p + 1;
      db.prepare("INSERT INTO options (list, value, label, position, flags) VALUES ('objetivo', 'alavancagem', 'Alavancagem patrimonial', ?, '{}')").run(pos);
    }
    // Simulador agora servido pelo próprio CRM (public/simulador): troca o endereço antigo do artefato
    db.prepare("UPDATE settings SET value = ? WHERE key = 'proposal_simulator_url' AND value = ?").run(JSON.stringify('/simulador/index.html'), JSON.stringify('https://claude.ai/artifact/Fk7ApKUi2U4BqAfvzfGgpd'));
    db.prepare("INSERT INTO settings (key, value) VALUES ('migr_v6_lp', 'true')").run();
  }
  // v7: coluna "R1 bolo" (entre R1 e Negociação) e regras de passagem revisadas
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'migr_v7_funil'").get()) {
    const r1 = db.prepare("SELECT * FROM pipeline_stages WHERE key = 'r1'").get();
    if (r1 && !db.prepare("SELECT 1 FROM pipeline_stages WHERE key = 'r1_bolo'").get()) {
      const [name, kind, key, rot, playbook] = DEFAULT_STAGES.find((x) => x[2] === 'r1_bolo');
      db.prepare('UPDATE pipeline_stages SET position = position + 1 WHERE position > ?').run(r1.position);
      db.prepare('INSERT INTO pipeline_stages (name, position, kind, key, rot_days, playbook, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(name, r1.position + 1, kind, key, rot, playbook, now);
    }
    // Regras personalizadas: Tentativa de contato sem restrição; Lead qualificado com objetivo, categoria, crédito e prazo
    const rules = getSetting(db, 'stage_rules');
    if (rules && typeof rules === 'object') {
      rules.tentativa = [];
      rules.qualificado = ['qualificacao'];
      rules.r1_bolo = [];
      db.prepare("UPDATE settings SET value = ? WHERE key = 'stage_rules'").run(JSON.stringify(rules));
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('migr_v7_funil', 'true')").run();
  }
  // v8: trilha de integração do especialista (temas novos e treinamento de consórcios)
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'migr_v8_trilha'").get()) {
    for (const [value, label] of [['cultura', 'Cultura e marca Vero'], ['metodologia', 'Metodologia de reuniões (R1)']]) {
      if (!db.prepare("SELECT 1 FROM options WHERE list = 'categoria_treinamento' AND value = ?").get(value)) {
        const pos = db.prepare("SELECT COALESCE(MAX(position), -1) AS p FROM options WHERE list = 'categoria_treinamento'").get().p + 1;
        db.prepare("INSERT INTO options (list, value, label, position, flags) VALUES ('categoria_treinamento', ?, ?, ?, '{}')").run(value, label, pos);
      }
    }
    if (!db.prepare("SELECT 1 FROM trainings WHERE track = 'consorcios'").get()) {
      const { TRAININGS } = require('./services/onboarding-content');
      const ins = db.prepare("INSERT INTO trainings (title, category, description, kind, content, required_roles, due_days, quiz, pass_score, duration_min, position, active, track, created_at, updated_at) VALUES (?, ?, ?, 'texto', ?, '[\"consultor\"]', 30, ?, 70, ?, ?, 1, 'consorcios', ?, ?)");
      TRAININGS.forEach((t, i) => ins.run(t.title, t.category, t.description, t.content, JSON.stringify(t.quiz || []), t.duration_min, i, now, now));
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('migr_v8_trilha', 'true')").run();
  }
  // v9: documentos obrigatórios só identificação e comprovante de endereço (quando a lista ainda era a padrão anterior)
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'migr_v9_docs'").get()) {
    const cur = getSetting(db, 'doc_checklist');
    const OLD = { PF: ['identificacao', 'comprovante_endereco', 'comprovante_renda', 'comprovante_estado_civil'], PJ: ['contrato_social', 'cartao_cnpj', 'comprovante_endereco', 'faturamento', 'doc_representante'] };
    if (cur && JSON.stringify(cur.PF) === JSON.stringify(OLD.PF)) {
      const next = { ...cur, PF: DEFAULT_SETTINGS.doc_checklist.PF };
      if (JSON.stringify(cur.PJ) === JSON.stringify(OLD.PJ)) next.PJ = DEFAULT_SETTINGS.doc_checklist.PJ;
      db.prepare("UPDATE settings SET value = ? WHERE key = 'doc_checklist'").run(JSON.stringify(next));
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('migr_v9_docs', 'true')").run();
  }
  // v10: título da R1 com barra reta ("[R1] Cliente | Vero Consórcios") e remetente noreply@ nos e-mails automáticos
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'migr_v10_r1'").get()) {
    db.prepare("UPDATE settings SET value = ? WHERE key = 'r1_title_template' AND value = ?").run(JSON.stringify('[R1] {cliente} | {empresa}'), JSON.stringify('[R1] {cliente} / {empresa}'));
    const smtp = getSetting(db, 'smtp');
    if (smtp && smtp.from_email === 'admin@veroconsorciosbr.com.br') db.prepare("UPDATE settings SET value = ? WHERE key = 'smtp'").run(JSON.stringify({ ...smtp, from_email: 'noreply@veroconsorciosbr.com.br' }));
    db.prepare("INSERT INTO settings (key, value) VALUES ('migr_v10_r1', 'true')").run();
  }
  // Central de documentos: pastas padrão (o administrador cria subpastas dentro delas)
  if (db.prepare('SELECT COUNT(*) AS n FROM doc_folders').get().n === 0) {
    const ins = db.prepare('INSERT INTO doc_folders (name, description, position, system, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)');
    DOC_FOLDERS.forEach(([n, d], i) => ins.run(n, d, i, now, now));
  }
  // Nome oficial da empresa: Vero Consórcios (só preenche quando ainda não foi definido)
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'migr_marca_vero'").get()) {
    db.prepare("UPDATE settings SET value = ? WHERE key = 'company_name' AND value IN (?, 'null')").run(JSON.stringify('Vero Consórcios'), JSON.stringify(''));
    db.prepare("INSERT INTO settings (key, value) VALUES ('migr_marca_vero', 'true')").run();
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM products').get().n === 0) {
    const ins = db.prepare(
      'INSERT INTO products (name, category, administrator, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    ins.run('Consórcio de imóvel', 'imovel', null, 'Produto genérico — ajuste administradora e condições.', now, now);
    ins.run('Consórcio de veículo', 'veiculo', null, 'Produto genérico — ajuste administradora e condições.', now, now);
    ins.run('Consórcio de serviços', 'servico', null, 'Produto genérico — ajuste administradora e condições.', now, now);
  }
}

/** Cadastros iniciais do Financeiro: categorias usuais do mercado de consórcios, centros de custo, contas e formas de pagamento. */
const FIN_PAY_CATEGORIES = [
  ['Pessoal', ['Salários e pró-labore', 'Comissões de especialistas e parceiros', 'Encargos e benefícios', 'Profissionais terceirizados (PJ)']],
  ['Estrutura', ['Aluguel e condomínio', 'Energia, água e internet', 'Telefonia', 'Material de escritório', 'Limpeza e manutenção']],
  ['Tecnologia', ['Software e assinaturas (CRM, discadora, simulador)', 'Equipamentos e informática']],
  ['Marketing e vendas', ['Tráfego pago (Meta e Google Ads)', 'Marketing e conteúdo', 'Compra de leads', 'Eventos e brindes']],
  ['Impostos e financeiro', ['Impostos (Simples, ISS)', 'Tarifas bancárias', 'Contabilidade', 'Juros e multas']],
  ['Jurídico e regulatório', ['Jurídico', 'Certificações e cursos', 'Associações de classe']],
  ['Outros', ['Viagens e deslocamento', 'Outras despesas']],
];
const FIN_REC_CATEGORIES = [
  ['Administradoras', ['Comissão de venda (administradora)', 'Comissão recorrente (parcelas)', 'Bonificação ou campanha da administradora', 'Prêmio por meta']],
  ['Serviços', ['Intermediação', 'Venda de carta contemplada', 'Consultoria']],
  ['Outros', ['Reembolsos', 'Rendimentos financeiros', 'Outras receitas']],
];
function seedTreasury(db, now) {
  if (db.prepare('SELECT COUNT(*) AS n FROM fin_categories').get().n === 0) {
    const ins = db.prepare('INSERT INTO fin_categories (direction, group_name, name, position, created_at) VALUES (?, ?, ?, ?, ?)');
    let pos = 0;
    for (const [dir, list] of [['pagar', FIN_PAY_CATEGORIES], ['receber', FIN_REC_CATEGORIES]]) for (const [g, names] of list) for (const n of names) ins.run(dir, g, n, pos++, now);
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM fin_cost_centers').get().n === 0) {
    const ins = db.prepare('INSERT INTO fin_cost_centers (name, description, created_at) VALUES (?, ?, ?)');
    for (const [n, d] of [['Comercial', 'Especialistas, comissões e ferramentas de venda'], ['Marketing', 'Tráfego pago, conteúdo e geração de leads'], ['Administrativo', 'Estrutura, contabilidade e jurídico'], ['Operação e pós-venda', 'Formalização, pós-venda e atendimento'], ['Tecnologia', 'Sistemas e equipamentos'], ['Diretoria', 'Pró-labore e despesas da diretoria']]) ins.run(n, d, now);
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM fin_payment_methods').get().n === 0) {
    const ins = db.prepare('INSERT INTO fin_payment_methods (name, active, position, created_at) VALUES (?, ?, ?, ?)');
    [['Boleto', 1], ['TED', 1], ['Dinheiro', 1], ['Pix', 0], ['Cartão de crédito', 0], ['Débito automático', 0]].forEach(([n, a], i) => ins.run(n, a, i, now));
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM fin_accounts').get().n === 0) {
    const ins = db.prepare('INSERT INTO fin_accounts (name, bank, type, opening_balance, created_at) VALUES (?, ?, ?, 0, ?)');
    ins.run('Conta principal', 'Banco a definir', 'corrente', now);
    ins.run('Caixa (dinheiro)', null, 'caixa', now);
  }
}

/* Colunas adicionadas depois da primeira versão (aplicadas também em bancos existentes). */
const ADDED_COLUMNS = {
  contacts: [
    ['rg', 'TEXT'], ['birthplace', 'TEXT'], ['nationality', 'TEXT'], ['sex', 'TEXT'], ['marital_status', 'TEXT'],
    ['property_regime', 'TEXT'], ['mother_name', 'TEXT'], ['income_range', 'TEXT'], ['net_worth_range', 'TEXT'],
    ['spouse_name', 'TEXT'], ['spouse_doc', 'TEXT'], ['spouse_profession', 'TEXT'], ['spouse_income_range', 'TEXT'],
    ['opening_date', 'TEXT'], ['main_activity', 'TEXT'], ['revenue_range', 'TEXT'],
    ['temperature', 'TEXT'], ['referred_by_id', 'INTEGER REFERENCES contacts(id)'],
    ['nps_score', 'INTEGER'], ['nps_comment', 'TEXT'], ['nps_at', 'TEXT'],
    ['active', 'INTEGER NOT NULL DEFAULT 1'], ['inactive_reason', 'TEXT'], ['inactivated_at', 'TEXT'],
    ['assigned_at', 'TEXT'], ['assigned_by', 'INTEGER REFERENCES users(id)'],
    ['postsale_owner_id', 'INTEGER REFERENCES users(id)'], ['postsale_started_at', 'TEXT'],
  ],
  nps_surveys: [['dissatisfaction_reason', 'TEXT'], ['treated_at', 'TEXT'], ['treated_by', 'INTEGER REFERENCES users(id)'], ['treatment_notes', 'TEXT']],
  addresses: [['notes', 'TEXT']],
  users: [
    ['modules', "TEXT NOT NULL DEFAULT '{}'"], ['phone', 'TEXT'], ['whatsapp', 'TEXT'], ['job_title', 'TEXT'], ['birth_date', 'TEXT'],
    ['photo', 'TEXT'], ['bio', 'TEXT'], ['specialties', "TEXT NOT NULL DEFAULT '[]'"], ['pix_key', 'TEXT'], ['professional_reg', 'TEXT'],
    ['password_changed_at', 'TEXT'],
    // Primeiro acesso: troca obrigatória da senha provisória e trilha de integração (onboarding) do especialista
    ['must_change_password', 'INTEGER NOT NULL DEFAULT 0'], ['onboarding', "TEXT NOT NULL DEFAULT '{}'"],
    // Google Agenda do usuário (OAuth): token de atualização cifrado
    ['google_refresh_token_enc', 'TEXT'], ['google_email', 'TEXT'], ['google_connected_at', 'TEXT'],
    // Identificador da conta Google (presença no Meet) e permissões concedidas
    ['google_sub', 'TEXT'], ['google_scopes', 'TEXT'],
  ],
  teams: [['leader_id', 'INTEGER REFERENCES users(id)']],
  pipeline_stages: [['key', 'TEXT'], ['playbook', 'TEXT'], ['rot_days', 'INTEGER'], ['training_id', 'INTEGER']],
  tasks: [
    ['priority', "TEXT NOT NULL DEFAULT 'normal'"], ['proposal_id', 'INTEGER REFERENCES proposals(id)'], ['cadence_step', 'TEXT'], ['pre_sale_id', 'INTEGER'], ['sale_id', 'INTEGER'],
    // Reuniões (R1): término, convidado, link da videoconferência e evento no Google Agenda
    ['ends_at', 'TEXT'], ['attendee_email', 'TEXT'], ['meeting_url', 'TEXT'], ['google_event_id', 'TEXT'], ['calendar_status', 'TEXT'],
    // Presença no Google Meet: aguardando, r1_feita (cliente de fora da empresa entrou) ou sem_cliente; e-mail de confirmação
    ['attendance_status', 'TEXT'], ['attendance_checked_at', 'TEXT'], ['attendance_detail', 'TEXT'], ['attended_at', 'TEXT'],
    ['calendar_owner_id', 'INTEGER REFERENCES users(id)'], ['confirmation_sent_at', 'TEXT'],
  ],
  products: [
    ['administrator_id', 'INTEGER REFERENCES administrators(id)'], ['plan_code', 'TEXT'], ['admin_fee_pct', 'REAL'], ['reserve_fund_pct', 'REAL'],
    ['term_months', 'INTEGER'], ['term_options', 'TEXT'], ['embedded_bid', 'INTEGER NOT NULL DEFAULT 0'], ['embedded_bid_pct', 'REAL'],
    ['fixed_bid', 'INTEGER NOT NULL DEFAULT 0'], ['fixed_bid_pct', 'REAL'], ['adhesion', 'INTEGER NOT NULL DEFAULT 0'], ['adhesion_pct', 'REAL'],
    ['adhesion_months', 'INTEGER'], ['insurance_pct', 'REAL'], ['readjustment_index', 'TEXT'], ['readjustment_other', 'TEXT'],
    ['credit_min', 'REAL'], ['credit_max', 'REAL'], ['credit_step', 'REAL'], ['commission_schedule', 'TEXT'], ['notes', 'TEXT'],
  ],

  client_links: [
    ['token', 'TEXT'], ['first_used_at', 'TEXT'], ['access_count', 'INTEGER NOT NULL DEFAULT 0'], ['revoked_by', 'INTEGER'], ['revoke_reason', 'TEXT'],
    // Ficha protegida pelos 4 últimos dígitos do celular: chave de acesso temporária, tentativas e bloqueio
    ['verify_hash', 'TEXT'], ['verify_expires_at', 'TEXT'], ['verify_fails', 'INTEGER NOT NULL DEFAULT 0'], ['verify_locked_until', 'TEXT'], ['verified_at', 'TEXT'],
  ],
  opportunities: [
    ['objective_type', 'TEXT'], ['product_type', 'TEXT'], ['credit_purpose', 'TEXT'], ['financial_moment', 'TEXT'],
    ['employment_type', 'TEXT'], ['has_fgts', 'TEXT'], ['decision_maker', 'TEXT'], ['existing_products', 'TEXT'],
    ['existing_consortium_value', 'REAL'], ['existing_consortium_admin', 'TEXT'], ['existing_financing_balance', 'REAL'],
    ['existing_financing_cet', 'REAL'], ['existing_financing_bank', 'TEXT'],
    ['credit_purpose_type', 'TEXT'], ['has_bid_resources', 'TEXT'], ['had_consortium', 'TEXT'], ['has_financing', 'TEXT'], ['decision_notes', 'TEXT'],
    ['housing_purpose', 'TEXT'], ['bid_source', 'TEXT'], ['has_property', 'TEXT'], ['property_type', 'TEXT'], ['property_value', 'REAL'],
    ['property_free_liens', 'TEXT'], ['pays_rent', 'TEXT'], ['rent_value', 'REAL'], ['temperature', 'TEXT'], ['temperature_reason', 'TEXT'],
  ],
  proposals: [
    ['simulator_token_hash', 'TEXT'], ['simulator_token_expires_at', 'TEXT'], ['generated_at', 'TEXT'], ['pdf_attachment_id', 'INTEGER REFERENCES attachments(id)'],
    ['accepted_at', 'TEXT'], ['accepted_channel', 'TEXT'], ['accepted_by', 'INTEGER REFERENCES users(id)'], ['refusal_reason', 'TEXT'],
    ['category', 'TEXT'], ['sent_channel', 'TEXT'], ['last_response_at', 'TEXT'], ['last_response', 'TEXT'],
    ['refusal_notes', 'TEXT'], ['refused_at', 'TEXT'], ['retake_at', 'TEXT'],
    ['has_adhesion', 'INTEGER'], ['adhesion_pct', 'REAL'], ['adhesion_months', 'INTEGER'], ['reducer_pct', 'REAL'], ['readjustment_rate', 'REAL'],
    ['bid_deduction', 'TEXT'], ['contemplation_month', 'INTEGER'], ['embedded_bid_pct', 'REAL'], ['quotas', 'INTEGER'],
    ['quota_split_strategy', 'TEXT'], ['quota_values', 'TEXT'], ['quota_split_notes', 'TEXT'],
    // Administradora da proposta e plano "Outros" (condições livres, quando o plano não está cadastrado)
    ['administrator_id', 'INTEGER REFERENCES administrators(id)'], ['plan_other', 'INTEGER NOT NULL DEFAULT 0'],
  ],
  pre_sales: [
    ['payment_method', 'TEXT'], ['payment_sent_at', 'TEXT'], ['payment_date', 'TEXT'], ['payment_attachment_id', 'INTEGER'],
    ['proof_by', 'INTEGER'], ['proof_at', 'TEXT'], ['signed_via', 'TEXT'], ['step_order', 'TEXT'],
  ],
  sales: [
    ['payment_method', 'TEXT'], ['allocation_checked_at', 'TEXT'], ['allocation_checked_by', 'INTEGER'], ['allocated_on', 'TEXT'],
    ['formalization_by', 'INTEGER'], ['quotas_count', 'INTEGER'], ['allocation_notes', 'TEXT'], ['alert_sent_at', 'TEXT'],
  ],
  post_sale_items: [['skipped', 'INTEGER NOT NULL DEFAULT 0'], ['alerted_at', 'TEXT']],
  contracts: [
    ['sale_id', 'INTEGER'],
    ['contract_number', 'TEXT'], ['installment_value', 'REAL'], ['due_day', 'INTEGER'], ['first_due_date', 'TEXT'],
    ['contemplated_at', 'TEXT'], ['contemplation_type', 'TEXT'], ['bid_value', 'REAL'], ['acquired_asset', 'TEXT'],
    ['seller_id', 'INTEGER REFERENCES users(id)'], ['sale_value', 'REAL'],
    ['installment_initial', 'REAL'], ['adhesion_date', 'TEXT'], ['next_readjustment_date', 'TEXT'], ['available_credit', 'REAL'],
    ['contemplation_credit', 'REAL'], ['net_to_pay', 'REAL'], ['client_choice', 'TEXT'],
  ],
  administrators: [['portal_password_enc', 'TEXT'], ['portal_password_updated_at', 'TEXT'], ['portal_password_updated_by', 'INTEGER']],
  // Trilha a que o treinamento pertence (ex.: "consorcios" = etapa 5 da integração do especialista)
  trainings: [['track', 'TEXT']],
};

const EXTRA_SCHEMA = `
CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  type TEXT NOT NULL DEFAULT 'residencial',
  is_primary INTEGER NOT NULL DEFAULT 0,
  cep TEXT, street TEXT, number TEXT, complement TEXT, district TEXT, city TEXT, state TEXT, ibge TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_addr_contact ON addresses(contact_id);

CREATE TABLE IF NOT EXISTS partners (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  name TEXT NOT NULL,
  doc TEXT,
  relation TEXT NOT NULL DEFAULT 'socio',
  share_pct REAL,
  email TEXT,
  phone TEXT,
  is_legal_rep INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_partners_contact ON partners(contact_id);

-- Arquivos anexados (documentos, propostas, comprovantes). O conteúdo fica no próprio banco.
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  proposal_id INTEGER REFERENCES proposals(id),
  contract_id INTEGER REFERENCES contracts(id),
  finance_entry_id INTEGER,
  doc_type TEXT NOT NULL DEFAULT 'outro',
  filename TEXT NOT NULL,
  mime TEXT,
  size INTEGER NOT NULL,
  content BLOB NOT NULL,
  status TEXT NOT NULL DEFAULT 'recebido' CHECK (status IN ('pendente','recebido','aprovado','recusado','removido')),
  valid_until TEXT,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'equipe',
  uploaded_by INTEGER REFERENCES users(id),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attach_contact ON attachments(contact_id);

-- Links para o cliente atualizar os próprios dados (blocos externos)
CREATE TABLE IF NOT EXISTS client_links (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  submissions INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT
);

-- Financeiro do cliente: parcelas e demais valores a acompanhar
CREATE TABLE IF NOT EXISTS finance_entries (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  contract_id INTEGER REFERENCES contracts(id),
  type TEXT NOT NULL DEFAULT 'parcela',
  installment_number INTEGER,
  description TEXT,
  due_date TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'a_vencer' CHECK (status IN ('a_vencer','pago','negociado','cancelado')),
  paid_at TEXT,
  paid_amount REAL,
  payment_method TEXT,
  notes TEXT,
  alert_task_id INTEGER REFERENCES tasks(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fin_contact ON finance_entries(contact_id);
CREATE INDEX IF NOT EXISTS idx_fin_due ON finance_entries(status, due_date);

CREATE TABLE IF NOT EXISTS finance_issues (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  contract_id INTEGER REFERENCES contracts(id),
  description TEXT NOT NULL,
  amount REAL,
  agreement TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','em_negociacao','resolvida')),
  opened_at TEXT NOT NULL,
  resolved_at TEXT,
  created_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS post_sale_items (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  contract_id INTEGER REFERENCES contracts(id),
  item TEXT NOT NULL,
  done_at TEXT,
  done_by INTEGER REFERENCES users(id),
  notes TEXT,
  UNIQUE (contact_id, contract_id, item)
);

-- Um anexo pode servir a mais de uma venda (negócio) do mesmo cliente
CREATE TABLE IF NOT EXISTS attachment_opportunities (
  attachment_id INTEGER NOT NULL REFERENCES attachments(id),
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id),
  PRIMARY KEY (attachment_id, opportunity_id)
);

-- Pesquisas de satisfação (NPS) enviadas por link. Nunca são excluídas, apenas canceladas com justificativa.
CREATE TABLE IF NOT EXISTS nps_surveys (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  contract_id INTEGER REFERENCES contracts(id),
  token_hash TEXT NOT NULL UNIQUE,
  token TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  first_access_at TEXT,
  last_access_at TEXT,
  answered_at TEXT,
  score INTEGER,
  answers TEXT,
  comment TEXT,
  cancelled_at TEXT,
  cancelled_by INTEGER REFERENCES users(id),
  cancel_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_nps_contact ON nps_surveys(contact_id);

-- Administradoras parceiras (visão do administrador): contatos, acesso ao portal e políticas de repasse e comissão
CREATE TABLE IF NOT EXISTS administrators (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  cnpj TEXT,
  website TEXT,
  portal_url TEXT,
  portal_login TEXT,
  direct_name TEXT, direct_phone TEXT, direct_email TEXT,
  commercial_name TEXT, commercial_phone TEXT, commercial_email TEXT,
  manager_name TEXT, manager_phone TEXT, manager_email TEXT,
  payout_day INTEGER,
  payout_method TEXT,
  payout_policy TEXT,
  payout_schedule TEXT NOT NULL DEFAULT '[]',
  commission_schedule TEXT NOT NULL DEFAULT '[]',
  chargeback_policy TEXT NOT NULL DEFAULT '{}',
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Pré-vendas: do aceite da proposta até o boleto (vira venda aguardando pagamento)
CREATE TABLE IF NOT EXISTS pre_sales (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  opportunity_id INTEGER REFERENCES opportunities(id),
  proposal_id INTEGER REFERENCES proposals(id),
  plan_id INTEGER REFERENCES products(id),
  first_sale INTEGER NOT NULL DEFAULT 1,
  client_link_id INTEGER REFERENCES client_links(id),
  status TEXT NOT NULL DEFAULT 'link_gerado',
  sent_via TEXT, sent_at TEXT, accessed_at TEXT, completed_at TEXT, reviewed_at TEXT,
  credit_value REAL, term_months INTEGER, installment_value REAL,
  adhesion_number TEXT, adhesion_at TEXT, contract_sent_at TEXT, contract_signed_at TEXT,
  boleto_value REAL, boleto_due TEXT, boleto_issued_at TEXT,
  sale_id INTEGER, alert_status TEXT,
  cancelled_at TEXT, cancel_reason TEXT,
  notes TEXT,
  owner_id INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_presale_contact ON pre_sales(contact_id);

-- Cotas da pré-venda: uma proposta pode virar várias cotas (ex.: 4 × R$ 250 mil), cada uma com grupo, cota e nº de contrato.
-- Na confirmação da venda cada cota vira um produto contratado do cliente, todos ligados ao mesmo ID de venda.
CREATE TABLE IF NOT EXISTS pre_sale_quotas (
  id INTEGER PRIMARY KEY,
  pre_sale_id INTEGER NOT NULL REFERENCES pre_sales(id),
  sale_id INTEGER REFERENCES sales(id),
  position INTEGER NOT NULL DEFAULT 1,
  credit_value REAL NOT NULL,
  group_code TEXT,
  quota_code TEXT,
  contract_number TEXT,
  allocated_on TEXT,
  allocated_by INTEGER REFERENCES users(id),
  contract_id INTEGER REFERENCES contracts(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_psq_presale ON pre_sale_quotas(pre_sale_id);

-- Vendas: nascem com o comprovante de pagamento (aguardando a alocação da cota) → confirmada pelo time ou cancelada
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  opportunity_id INTEGER REFERENCES opportunities(id),
  proposal_id INTEGER REFERENCES proposals(id),
  pre_sale_id INTEGER REFERENCES pre_sales(id),
  plan_id INTEGER REFERENCES products(id),
  administrator_id INTEGER REFERENCES administrators(id),
  seller_id INTEGER REFERENCES users(id),
  category TEXT,
  credit_value REAL NOT NULL,
  term_months INTEGER,
  installment_value REAL,
  group_code TEXT, quota_code TEXT, adhesion_number TEXT, adhesion_date TEXT,
  boleto_value REAL, boleto_due TEXT,
  status TEXT NOT NULL DEFAULT 'aguardando_alocacao' CHECK (status IN ('aguardando_pagamento','aguardando_alocacao','confirmada','cancelada')),
  payment_date TEXT, payment_attachment_id INTEGER REFERENCES attachments(id),
  confirmed_at TEXT, confirmed_by INTEGER REFERENCES users(id),
  contract_id INTEGER REFERENCES contracts(id),
  cancelled_at TEXT, cancel_reason TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_seller ON sales(seller_id, status);

-- Cancelamentos de cotas vendidas (base do indicador de cancelamento e dos estornos de comissão)
CREATE TABLE IF NOT EXISTS cancellations (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  sale_id INTEGER NOT NULL UNIQUE REFERENCES sales(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  seller_id INTEGER REFERENCES users(id),
  responsible_id INTEGER REFERENCES users(id),
  cancelled_on TEXT NOT NULL,
  days_after_sale INTEGER,
  within_7_days INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  description TEXT NOT NULL,
  chargeback_total REAL NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

-- Comissões do especialista (parcelas previstas, liberadas, pagas) e estornos
CREATE TABLE IF NOT EXISTS commission_entries (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'comissao' CHECK (kind IN ('comissao','estorno','bonus')),
  installment_no INTEGER,
  competence TEXT NOT NULL,
  base_value REAL,
  pct REAL,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'prevista' CHECK (status IN ('prevista','liberada','paga','cancelada')),
  release_on TEXT,
  paid_at TEXT, paid_by INTEGER REFERENCES users(id),
  cancellation_id INTEGER REFERENCES cancellations(id),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comm_user ON commission_entries(user_id, competence);

-- Metas mensais por especialista ou equipe (cadastradas pelo administrador)
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY,
  month TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('user','team')),
  user_id INTEGER REFERENCES users(id),
  team_id INTEGER REFERENCES teams(id),
  target_credit REAL,
  target_sales INTEGER,
  created_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_goal ON goals(month, scope, COALESCE(user_id, 0), COALESCE(team_id, 0));

-- Distribuição de prospects e leads (manual, roleta e automática)
CREATE TABLE IF NOT EXISTS distribution_log (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  from_user INTEGER REFERENCES users(id),
  to_user INTEGER NOT NULL REFERENCES users(id),
  method TEXT NOT NULL,
  by_user INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

-- Treinamentos (PDF, vídeo ou texto) e acompanhamento por usuário
CREATE TABLE IF NOT EXISTS trainings (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'texto' CHECK (kind IN ('pdf','video','texto','link')),
  content TEXT,
  video_url TEXT,
  file BLOB, file_name TEXT, file_mime TEXT, file_size INTEGER,
  required_roles TEXT NOT NULL DEFAULT '[]',
  due_days INTEGER,
  quiz TEXT NOT NULL DEFAULT '[]',
  pass_score INTEGER NOT NULL DEFAULT 70,
  duration_min INTEGER,
  position INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS training_progress (
  training_id INTEGER NOT NULL REFERENCES trainings(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  first_opened_at TEXT, last_opened_at TEXT, open_count INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT, quiz_score INTEGER, attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (training_id, user_id)
);

-- Estratégia de lance por produto contratado
CREATE TABLE IF NOT EXISTS bid_strategies (
  id INTEGER PRIMARY KEY,
  contract_id INTEGER NOT NULL UNIQUE REFERENCES contracts(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  will_bid INTEGER NOT NULL DEFAULT 0,
  bid_type TEXT,
  bid_pct REAL,
  use_embedded INTEGER NOT NULL DEFAULT 0,
  use_fgts INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL
);

-- Histórico das estratégias de lance (cada alteração gera um registro com quem cadastrou, data e hora)
CREATE TABLE IF NOT EXISTS bid_strategy_history (
  id INTEGER PRIMARY KEY,
  contract_id INTEGER NOT NULL REFERENCES contracts(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  will_bid INTEGER NOT NULL DEFAULT 0,
  bid_type TEXT,
  bid_pct REAL,
  use_embedded INTEGER NOT NULL DEFAULT 0,
  use_fgts INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bid_hist_contract ON bid_strategy_history(contract_id, created_at);

-- =====================================================================
-- Financeiro da empresa (contas a pagar e a receber). Não confundir com finance_entries,
-- que são as parcelas do cliente junto à administradora.
-- =====================================================================
CREATE TABLE IF NOT EXISTS fin_accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  bank TEXT, agency TEXT, number TEXT, pix_key TEXT,
  type TEXT NOT NULL DEFAULT 'corrente',
  opening_balance REAL NOT NULL DEFAULT 0,
  opening_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fin_cost_centers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fin_categories (
  id INTEGER PRIMARY KEY,
  direction TEXT NOT NULL CHECK (direction IN ('pagar','receber')),
  group_name TEXT,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fin_partners (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'fornecedor' CHECK (kind IN ('fornecedor','pagador','ambos')),
  doc TEXT, email TEXT, phone TEXT, notes TEXT,
  administrator_id INTEGER REFERENCES administrators(id),
  default_category_id INTEGER REFERENCES fin_categories(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fin_payment_methods (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
-- Título: a despesa ou a receita (pontual, parcelada, recorrente ou assinatura). As ocorrências ficam em fin_installments.
CREATE TABLE IF NOT EXISTS fin_titles (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  direction TEXT NOT NULL CHECK (direction IN ('pagar','receber')),
  description TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pontual','parcelada','recorrente','assinatura')),
  partner_id INTEGER REFERENCES fin_partners(id),
  category_id INTEGER REFERENCES fin_categories(id),
  cost_center_id INTEGER REFERENCES fin_cost_centers(id),
  payment_method_id INTEGER REFERENCES fin_payment_methods(id),
  account_id INTEGER REFERENCES fin_accounts(id),
  responsible_id INTEGER REFERENCES users(id),
  total_value REAL,
  installment_value REAL,
  installments INTEGER,
  periodicity TEXT,
  first_due TEXT,
  end_date TEXT,
  renewal_date TEXT,
  auto_renew INTEGER NOT NULL DEFAULT 1,
  invoice_number TEXT,
  invoice_date TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','encerrado','cancelado')),
  cancel_reason TEXT,
  renewal_alerted_at TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fin_titles_dir ON fin_titles(direction, status);
CREATE TABLE IF NOT EXISTS fin_installments (
  id INTEGER PRIMARY KEY,
  title_id INTEGER NOT NULL REFERENCES fin_titles(id),
  number INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','pago','cancelado')),
  paid_at TEXT,
  paid_amount REAL,
  paid_by INTEGER REFERENCES users(id),
  account_id INTEGER REFERENCES fin_accounts(id),
  payment_method_id INTEGER REFERENCES fin_payment_methods(id),
  file_id INTEGER,
  late_reason TEXT,
  late_reason_at TEXT,
  late_reason_by INTEGER REFERENCES users(id),
  alerted_at TEXT,
  reminded_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fin_inst_due ON fin_installments(status, due_date);
CREATE INDEX IF NOT EXISTS idx_fin_inst_title ON fin_installments(title_id);
-- Rateio por competência (ex.: nota de R$ 100 mil = 40 mil de outubro + 30 de setembro + ...). Só informativo.
CREATE TABLE IF NOT EXISTS fin_allocations (
  id INTEGER PRIMARY KEY,
  title_id INTEGER NOT NULL REFERENCES fin_titles(id),
  competence TEXT NOT NULL,
  amount REAL NOT NULL,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS fin_notes (
  id INTEGER PRIMARY KEY,
  title_id INTEGER NOT NULL REFERENCES fin_titles(id),
  installment_id INTEGER REFERENCES fin_installments(id),
  kind TEXT NOT NULL DEFAULT 'observacao',
  text TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fin_files (
  id INTEGER PRIMARY KEY,
  title_id INTEGER NOT NULL REFERENCES fin_titles(id),
  installment_id INTEGER REFERENCES fin_installments(id),
  kind TEXT NOT NULL DEFAULT 'comprovante',
  filename TEXT NOT NULL,
  mime TEXT,
  size INTEGER NOT NULL,
  content BLOB NOT NULL,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

-- Transcrições da R1 anexadas ao negócio (texto extraído do arquivo; os campos identificados completam a qualificação)
CREATE TABLE IF NOT EXISTS r1_transcripts (
  id INTEGER PRIMARY KEY,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id),
  filename TEXT,
  content TEXT NOT NULL,
  fields TEXT,
  applied TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_r1_opp ON r1_transcripts(opportunity_id);

-- Notificações da plataforma (sino no topo)
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at, created_at);

-- Colaboradores (RH): identificação, organização, contrato, jornada, remuneração e dados bancários
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','ferias','afastado','desligado')),
  status_since TEXT, status_until TEXT, status_reason TEXT,
  full_name TEXT NOT NULL, social_name TEXT, cpf TEXT, rg TEXT, rg_issuer TEXT, birth_date TEXT, sex TEXT,
  marital_status TEXT, nationality TEXT, mother_name TEXT, education TEXT, pis TEXT, ctps TEXT, ctps_series TEXT,
  phone TEXT, personal_email TEXT, corporate_email TEXT,
  cep TEXT, street TEXT, number TEXT, complement TEXT, district TEXT, city TEXT, state TEXT,
  emergency_name TEXT, emergency_relation TEXT, emergency_phone TEXT,
  job_title TEXT, job_function TEXT, team_id INTEGER REFERENCES teams(id), leader_id INTEGER REFERENCES employees(id),
  cost_center_id INTEGER REFERENCES fin_cost_centers(id), work_regime TEXT, work_location TEXT,
  admission_date TEXT, probation_end TEXT, termination_date TEXT, termination_type TEXT, termination_reason TEXT,
  contract_type TEXT NOT NULL DEFAULT 'clt' CHECK (contract_type IN ('clt','pj','estagio','prestador','socio')),
  pj_company_name TEXT, pj_trade_name TEXT, pj_cnpj TEXT, pj_municipal_reg TEXT, pj_tax_regime TEXT,
  internship_institution TEXT, internship_course TEXT, internship_supervisor TEXT,
  partner_share_pct REAL,
  work_schedule TEXT, weekly_hours REAL, daily_hours REAL, break_minutes INTEGER, time_tracking TEXT,
  pay_model TEXT NOT NULL DEFAULT 'fixa' CHECK (pay_model IN ('fixa','variavel','hibrida')),
  base_salary REAL, variable_description TEXT, variable_target REAL, variable_cap REAL, pay_day INTEGER,
  bank_name TEXT, bank_agency TEXT, bank_account TEXT, bank_account_type TEXT, pix_key TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);

-- Contratos do colaborador (CLT, PJ, estágio, aditivos): vigência e arquivo anexo
CREATE TABLE IF NOT EXISTS employee_contracts (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  contract_type TEXT,
  title TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  ended_at TEXT,
  status TEXT NOT NULL DEFAULT 'vigente' CHECK (status IN ('vigente','encerrado','rascunho')),
  monthly_value REAL,
  notes TEXT,
  filename TEXT, mime TEXT, size INTEGER, content BLOB,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_emp_contracts ON employee_contracts(employee_id);

-- Benefícios (VR, VA, plano de saúde...) e descontos (INSS, IRRF, VT...) do colaborador
CREATE TABLE IF NOT EXISTS employee_benefits (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  kind TEXT NOT NULL CHECK (kind IN ('beneficio','desconto')),
  type TEXT NOT NULL,
  description TEXT,
  value_type TEXT NOT NULL DEFAULT 'valor' CHECK (value_type IN ('valor','percentual')),
  amount REAL,
  company_cost REAL,
  start_date TEXT, end_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_emp_benefits ON employee_benefits(employee_id);

-- Documentos pessoais do colaborador (RG, CPF, comprovantes, ASO, certificados)
CREATE TABLE IF NOT EXISTS employee_files (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  category TEXT NOT NULL DEFAULT 'outro',
  title TEXT,
  filename TEXT NOT NULL, mime TEXT, size INTEGER NOT NULL, content BLOB NOT NULL,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_emp_files ON employee_files(employee_id);

-- Histórico do colaborador: situação, cargo e remuneração
CREATE TABLE IF NOT EXISTS employee_history (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_emp_history ON employee_history(employee_id, created_at);

-- Central de documentos da empresa (somente administrador): pastas e arquivos com versões
CREATE TABLE IF NOT EXISTS doc_folders (
  id INTEGER PRIMARY KEY,
  parent_id INTEGER REFERENCES doc_folders(id),
  name TEXT NOT NULL,
  description TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  system INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS company_documents (
  id INTEGER PRIMARY KEY,
  folder_id INTEGER NOT NULL REFERENCES doc_folders(id),
  title TEXT NOT NULL,
  description TEXT,
  doc_number TEXT,
  issuer TEXT,
  issue_date TEXT,
  expires_at TEXT,
  tags TEXT,
  filename TEXT NOT NULL, mime TEXT, size INTEGER NOT NULL, content BLOB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  previous_id INTEGER REFERENCES company_documents(id),
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','substituido','arquivado')),
  expiry_alerted_at TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_company_docs ON company_documents(folder_id, status);
`;

/**
 * Amplia uma restrição CHECK de uma tabela existente (o SQLite não altera CHECK): recria a tabela com a mesma
 * definição, só trocando o trecho da restrição, e copia os dados.
 */
function relaxCheck(db, table, from, to) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (!row || !row.sql.includes(from)) return;
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name).join(', ');
  const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL").all(table).map((r) => r.sql);
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    db.exec('BEGIN');
    db.exec(row.sql.replace(from, to).replace(/CREATE TABLE (IF NOT EXISTS )?"?\w+"?/, `CREATE TABLE ${table}_v2`));
    db.exec(`INSERT INTO ${table}_v2 (${cols}) SELECT ${cols} FROM ${table}`);
    db.exec(`DROP TABLE ${table}`);
    db.exec(`ALTER TABLE ${table}_v2 RENAME TO ${table}`);
    for (const sql of indexes) db.exec(sql);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

function migrate(db) {
  db.exec(EXTRA_SCHEMA);
  // Venda aguardando a alocação da cota e bônus de formalização (bancos anteriores)
  relaxCheck(db, 'sales', "CHECK (status IN ('aguardando_pagamento','confirmada','cancelada'))", "CHECK (status IN ('aguardando_pagamento','aguardando_alocacao','confirmada','cancelada'))");
  relaxCheck(db, 'commission_entries', "CHECK (kind IN ('comissao','estorno'))", "CHECK (kind IN ('comissao','estorno','bonus'))");
  for (const [table, cols] of Object.entries(ADDED_COLUMNS)) {
    const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [name, type] of cols) {
      if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }
  // Estratégias de lance anteriores ao histórico: registra a situação atual como o primeiro item do histórico
  db.exec(`INSERT INTO bid_strategy_history (contract_id, contact_id, will_bid, bid_type, bid_pct, use_embedded, use_fgts, notes, created_by, created_at)
    SELECT b.contract_id, b.contact_id, b.will_bid, b.bid_type, b.bid_pct, b.use_embedded, b.use_fgts, b.notes, b.updated_by, b.updated_at FROM bid_strategies b
    WHERE NOT EXISTS (SELECT 1 FROM bid_strategy_history h WHERE h.contract_id = b.contract_id)`);
  // Clientes marcados como inativos antes do status Ativo/Inativo do cadastro
  db.exec("UPDATE contacts SET active = 0 WHERE client_status = 'inativo' AND active = 1");
}

/** Cria as tabelas e os valores iniciais (idempotente). Aceita qualquer conexão compatível com DatabaseSync. */
function initDb(db) {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrate(db);
  seedDefaults(db);
  return db;
}

/** Chave que cifra os segredos guardados no banco (ex.: senha do portal da administradora): CRM_SECRET_KEY ou o arquivo <banco>.key. */
function ensureSecretKey(file) {
  if (process.env.CRM_SECRET_KEY || file === ':memory:') return;
  const keyFile = `${file}.key`;
  try {
    if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, require('node:crypto').randomBytes(32).toString('base64'), { mode: 0o600 });
    process.env.CRM_SECRET_KEY = fs.readFileSync(keyFile, 'utf8').trim();
  } catch (e) {
    console.error('Não foi possível ler ou criar a chave de cifragem:', e.message);
  }
}

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  ensureSecretKey(file);
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  return initDb(db);
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

module.exports = { openDb, initDb, tx, nextCode, getSetting, setSetting, DEFAULT_SETTINGS };
