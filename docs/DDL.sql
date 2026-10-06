-- =====================================================================
-- Vero Consórcios (ERP/CRM) — DDL completo do banco (SQLite)
-- Gerado por scripts/ddl.js a partir de um banco novo, com todas as migrações aplicadas.
-- 62 tabelas · 176 chaves estrangeiras declaradas · 43 índices
--
-- Observações
--  - O SQLite verifica as chaves estrangeiras na gravação (PRAGMA foreign_keys = ON), não na criação:
--    as tabelas podem ser criadas em qualquer ordem. Aqui estão agrupadas por módulo.
--  - Datas e horas: texto ISO 8601 (AAAA-MM-DD ou AAAA-MM-DDTHH:MM:SS.sssZ). Valores: REAL em reais.
--  - Listas configuráveis (origem, etapa, categoria…) guardam o código; o rótulo fica em options(list, value).
--  - Relacionamentos sem FOREIGN KEY declarada estão listados no fim deste arquivo.
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- Acesso, configuração e auditoria
-- ---------------------------------------------------------------------

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
  last_login_at TEXT,
  modules TEXT NOT NULL DEFAULT '{}',
  phone TEXT,
  whatsapp TEXT,
  job_title TEXT,
  birth_date TEXT,
  photo TEXT,
  bio TEXT,
  specialties TEXT NOT NULL DEFAULT '[]',
  pix_key TEXT,
  professional_reg TEXT,
  password_changed_at TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  onboarding TEXT NOT NULL DEFAULT '{}',
  google_refresh_token_enc TEXT,
  google_email TEXT,
  google_connected_at TEXT
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  leader_id INTEGER REFERENCES users(id)
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

CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

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
CREATE INDEX IF NOT EXISTS idx_audit_contact ON audit_log(contact_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);

-- ---------------------------------------------------------------------
-- Cadastros (prospects, leads e clientes)
-- ---------------------------------------------------------------------

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
  whatsapp TEXT,
  whatsapp_norm TEXT,
  email TEXT,
  email_norm TEXT,
  city TEXT,
  state TEXT,
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
  anonymized_at TEXT,
  rg TEXT,
  birthplace TEXT,
  nationality TEXT,
  sex TEXT,
  marital_status TEXT,
  property_regime TEXT,
  mother_name TEXT,
  income_range TEXT,
  net_worth_range TEXT,
  spouse_name TEXT,
  spouse_doc TEXT,
  spouse_profession TEXT,
  spouse_income_range TEXT,
  opening_date TEXT,
  main_activity TEXT,
  revenue_range TEXT,
  temperature TEXT,
  referred_by_id INTEGER REFERENCES contacts(id),
  nps_score INTEGER,
  nps_comment TEXT,
  nps_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  inactive_reason TEXT,
  inactivated_at TEXT,
  assigned_at TEXT,
  assigned_by INTEGER REFERENCES users(id),
  postsale_owner_id INTEGER REFERENCES users(id),
  postsale_started_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_contacts_doc ON contacts(doc);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email_norm);
CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone1 ON contacts(phone1_norm);
CREATE INDEX IF NOT EXISTS idx_contacts_phone2 ON contacts(phone2_norm);
CREATE INDEX IF NOT EXISTS idx_contacts_whats ON contacts(whatsapp_norm);

CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  type TEXT NOT NULL DEFAULT 'residencial',
  is_primary INTEGER NOT NULL DEFAULT 0,
  cep TEXT,
  street TEXT,
  number TEXT,
  complement TEXT,
  district TEXT,
  city TEXT,
  state TEXT,
  ibge TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_addr_contact ON addresses(contact_id);

CREATE TABLE IF NOT EXISTS company_contacts (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES contacts(id),
  name TEXT NOT NULL,
  role TEXT,
  email TEXT,
  email_norm TEXT,
  phone TEXT,
  phone_norm TEXT,
  whatsapp TEXT,
  whatsapp_norm TEXT,
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
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  other_params TEXT,
  source_ref TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_origins_contact ON contact_origins(contact_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_origin_platform_lead ON contact_origins(platform, platform_lead_id) WHERE platform_lead_id IS NOT NULL;

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

CREATE TABLE IF NOT EXISTS client_links (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  submissions INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT,
  token TEXT,
  first_used_at TEXT,
  access_count INTEGER NOT NULL DEFAULT 0,
  revoked_by INTEGER,
  revoke_reason TEXT,
  verify_hash TEXT,
  verify_expires_at TEXT,
  verify_fails INTEGER NOT NULL DEFAULT 0,
  verify_locked_until TEXT,
  verified_at TEXT
);

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

CREATE TABLE IF NOT EXISTS attachment_opportunities (
  attachment_id INTEGER NOT NULL REFERENCES attachments(id),
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id),
  PRIMARY KEY (attachment_id, opportunity_id)
);

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

-- ---------------------------------------------------------------------
-- Funil, atividades e distribuição
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'aberta' CHECK (kind IN ('aberta','ganho','perdido','nutricao')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  key TEXT,
  playbook TEXT,
  rot_days INTEGER,
  training_id INTEGER
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
  updated_at TEXT NOT NULL,
  objective_type TEXT,
  product_type TEXT,
  credit_purpose TEXT,
  financial_moment TEXT,
  employment_type TEXT,
  has_fgts TEXT,
  decision_maker TEXT,
  existing_products TEXT,
  existing_consortium_value REAL,
  existing_consortium_admin TEXT,
  existing_financing_balance REAL,
  existing_financing_cet REAL,
  existing_financing_bank TEXT,
  credit_purpose_type TEXT,
  has_bid_resources TEXT,
  had_consortium TEXT,
  has_financing TEXT,
  decision_notes TEXT,
  housing_purpose TEXT,
  bid_source TEXT,
  has_property TEXT,
  property_type TEXT,
  property_value REAL,
  property_free_liens TEXT,
  pays_rent TEXT,
  rent_value REAL,
  temperature TEXT,
  temperature_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_opp_contact ON opportunities(contact_id);
CREATE INDEX IF NOT EXISTS idx_opp_owner ON opportunities(owner_id);
CREATE INDEX IF NOT EXISTS idx_opp_stage ON opportunities(stage_id);

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
  completed_by INTEGER REFERENCES users(id),
  priority TEXT NOT NULL DEFAULT 'normal',
  proposal_id INTEGER REFERENCES proposals(id),
  cadence_step TEXT,
  pre_sale_id INTEGER,
  sale_id INTEGER,
  ends_at TEXT,
  attendee_email TEXT,
  meeting_url TEXT,
  google_event_id TEXT,
  calendar_status TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(status, due_at);

CREATE TABLE IF NOT EXISTS distribution_log (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  from_user INTEGER REFERENCES users(id),
  to_user INTEGER NOT NULL REFERENCES users(id),
  method TEXT NOT NULL,
  by_user INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

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

-- ---------------------------------------------------------------------
-- Catálogo: administradoras e planos
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS administrators (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  cnpj TEXT,
  website TEXT,
  portal_url TEXT,
  portal_login TEXT,
  direct_name TEXT,
  direct_phone TEXT,
  direct_email TEXT,
  commercial_name TEXT,
  commercial_phone TEXT,
  commercial_email TEXT,
  manager_name TEXT,
  manager_phone TEXT,
  manager_email TEXT,
  payout_day INTEGER,
  payout_method TEXT,
  payout_policy TEXT,
  payout_schedule TEXT NOT NULL DEFAULT '[]',
  commission_schedule TEXT NOT NULL DEFAULT '[]',
  chargeback_policy TEXT NOT NULL DEFAULT '{}',
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  portal_password_enc TEXT,
  portal_password_updated_at TEXT,
  portal_password_updated_by INTEGER
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  administrator TEXT,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  administrator_id INTEGER REFERENCES administrators(id),
  plan_code TEXT,
  admin_fee_pct REAL,
  reserve_fund_pct REAL,
  term_months INTEGER,
  term_options TEXT,
  embedded_bid INTEGER NOT NULL DEFAULT 0,
  embedded_bid_pct REAL,
  fixed_bid INTEGER NOT NULL DEFAULT 0,
  fixed_bid_pct REAL,
  adhesion INTEGER NOT NULL DEFAULT 0,
  adhesion_pct REAL,
  adhesion_months INTEGER,
  insurance_pct REAL,
  readjustment_index TEXT,
  readjustment_other TEXT,
  credit_min REAL,
  credit_max REAL,
  credit_step REAL,
  commission_schedule TEXT,
  notes TEXT
);

-- ---------------------------------------------------------------------
-- Simulações e propostas
-- ---------------------------------------------------------------------

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
  updated_at TEXT NOT NULL,
  simulator_token_hash TEXT,
  simulator_token_expires_at TEXT,
  generated_at TEXT,
  pdf_attachment_id INTEGER REFERENCES attachments(id),
  accepted_at TEXT,
  accepted_channel TEXT,
  accepted_by INTEGER REFERENCES users(id),
  refusal_reason TEXT,
  category TEXT,
  sent_channel TEXT,
  last_response_at TEXT,
  last_response TEXT,
  refusal_notes TEXT,
  refused_at TEXT,
  retake_at TEXT,
  has_adhesion INTEGER,
  adhesion_pct REAL,
  adhesion_months INTEGER,
  reducer_pct REAL,
  readjustment_rate REAL,
  bid_deduction TEXT,
  contemplation_month INTEGER,
  embedded_bid_pct REAL,
  quotas INTEGER,
  quota_split_strategy TEXT,
  quota_values TEXT,
  quota_split_notes TEXT,
  administrator_id INTEGER REFERENCES administrators(id),
  plan_other INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_prop_opp ON proposals(opportunity_id);

-- ---------------------------------------------------------------------
-- Pré-venda, vendas, cancelamentos e comissões
-- ---------------------------------------------------------------------

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
  sent_via TEXT,
  sent_at TEXT,
  accessed_at TEXT,
  completed_at TEXT,
  reviewed_at TEXT,
  credit_value REAL,
  term_months INTEGER,
  installment_value REAL,
  adhesion_number TEXT,
  adhesion_at TEXT,
  contract_sent_at TEXT,
  contract_signed_at TEXT,
  boleto_value REAL,
  boleto_due TEXT,
  boleto_issued_at TEXT,
  sale_id INTEGER,
  alert_status TEXT,
  cancelled_at TEXT,
  cancel_reason TEXT,
  notes TEXT,
  owner_id INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payment_method TEXT,
  payment_sent_at TEXT,
  payment_date TEXT,
  payment_attachment_id INTEGER,
  proof_by INTEGER,
  proof_at TEXT,
  signed_via TEXT,
  step_order TEXT
);
CREATE INDEX IF NOT EXISTS idx_presale_contact ON pre_sales(contact_id);

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
  group_code TEXT,
  quota_code TEXT,
  adhesion_number TEXT,
  adhesion_date TEXT,
  boleto_value REAL,
  boleto_due TEXT,
  status TEXT NOT NULL DEFAULT 'aguardando_alocacao' CHECK (status IN ('aguardando_pagamento','aguardando_alocacao','confirmada','cancelada')),
  payment_date TEXT,
  payment_attachment_id INTEGER REFERENCES attachments(id),
  confirmed_at TEXT,
  confirmed_by INTEGER REFERENCES users(id),
  contract_id INTEGER REFERENCES contracts(id),
  cancelled_at TEXT,
  cancel_reason TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payment_method TEXT,
  allocation_checked_at TEXT,
  allocation_checked_by INTEGER,
  allocated_on TEXT,
  formalization_by INTEGER,
  quotas_count INTEGER,
  allocation_notes TEXT,
  alert_sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sales_seller ON sales(seller_id, status);

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
  paid_at TEXT,
  paid_by INTEGER REFERENCES users(id),
  cancellation_id INTEGER REFERENCES cancellations(id),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comm_user ON commission_entries(user_id, competence);

-- ---------------------------------------------------------------------
-- Produtos contratados e pós-venda
-- ---------------------------------------------------------------------

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
  updated_at TEXT NOT NULL,
  sale_id INTEGER,
  contract_number TEXT,
  installment_value REAL,
  due_day INTEGER,
  first_due_date TEXT,
  contemplated_at TEXT,
  contemplation_type TEXT,
  bid_value REAL,
  acquired_asset TEXT,
  seller_id INTEGER REFERENCES users(id),
  sale_value REAL,
  installment_initial REAL,
  adhesion_date TEXT,
  next_readjustment_date TEXT,
  available_credit REAL,
  contemplation_credit REAL,
  net_to_pay REAL,
  client_choice TEXT
);

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
  skipped INTEGER NOT NULL DEFAULT 0,
  alerted_at TEXT,
  UNIQUE (contact_id, contract_id, item)
);

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
  cancel_reason TEXT,
  dissatisfaction_reason TEXT,
  treated_at TEXT,
  treated_by INTEGER REFERENCES users(id),
  treatment_notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_nps_contact ON nps_surveys(contact_id);

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

-- ---------------------------------------------------------------------
-- Treinamentos
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS trainings (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'texto' CHECK (kind IN ('pdf','video','texto','link')),
  content TEXT,
  video_url TEXT,
  file BLOB,
  file_name TEXT,
  file_mime TEXT,
  file_size INTEGER,
  required_roles TEXT NOT NULL DEFAULT '[]',
  due_days INTEGER,
  quiz TEXT NOT NULL DEFAULT '[]',
  pass_score INTEGER NOT NULL DEFAULT 70,
  duration_min INTEGER,
  position INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  track TEXT
);

CREATE TABLE IF NOT EXISTS training_progress (
  training_id INTEGER NOT NULL REFERENCES trainings(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  first_opened_at TEXT,
  last_opened_at TEXT,
  open_count INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  quiz_score INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (training_id, user_id)
);

-- ---------------------------------------------------------------------
-- Integrações
-- ---------------------------------------------------------------------

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
CREATE INDEX IF NOT EXISTS idx_call_status ON call_events(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_call_external ON call_events(provider, external_call_id) WHERE external_call_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- Financeiro da empresa
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fin_accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  bank TEXT,
  agency TEXT,
  number TEXT,
  pix_key TEXT,
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
  doc TEXT,
  email TEXT,
  phone TEXT,
  notes TEXT,
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

-- ---------------------------------------------------------------------
-- Relacionamentos lógicos (usados pela aplicação, sem FOREIGN KEY declarada)
-- ---------------------------------------------------------------------
-- activities.call_event_id -> call_events.id
-- activities.ref_id -> (ref_type).id   (polimórfico: ref_type indica a tabela (proposal, contract, finance_entry, sale…))
-- administrators.portal_password_updated_by -> users.id
-- attachments.finance_entry_id -> finance_entries.id
-- audit_log.entity_id -> (entity).id   (polimórfico: entity indica a tabela)
-- audit_log.contact_id -> contacts.id   (cadastro afetado (para o histórico da ficha))
-- client_links.revoked_by -> users.id
-- contracts.sale_id -> sales.id   (venda que originou o produto contratado)
-- fin_installments.file_id -> fin_files.id   (comprovante da baixa)
-- pipeline_stages.training_id -> trainings.id
-- pre_sales.sale_id -> sales.id
-- pre_sales.payment_attachment_id -> attachments.id   (comprovante de pagamento)
-- pre_sales.proof_by -> users.id
-- sales.allocation_checked_by -> users.id
-- sales.formalization_by -> users.id
-- tasks.pre_sale_id -> pre_sales.id
-- tasks.sale_id -> sales.id
