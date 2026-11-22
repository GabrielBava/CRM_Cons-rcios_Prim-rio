'use strict';
const { requireWrite, assertAssignable, audit, isManager, contactScope } = require('../core');
const { badRequest, forbidden, parseCSV, toCSV, toNumber, normalizePhone, normalizeEmail, digits, clean, nowIso, maskDoc } = require('../util');
const { tx } = require('../db');
const { createContact, normalizeInput, findDuplicates, insertOrigin, listContacts } = require('./contacts');
const { insertActivity, optouts } = require('./activities');
const { listOpportunities } = require('./opportunities');
const { listActivities } = require('./activities');
const { listProposals } = require('./proposals');
const { listSimulations } = require('./simulations');
const { listContracts } = require('./clients');
const {
  RELATIONSHIPS, LEAD_STATUS, CLIENT_STATUS, OPP_STATUS, PROPOSAL_STATUS, ACTIVITY_TYPES, SIMULATION_STATUS, PRIORITIES,
} = require('../constants');

const MAX_ROWS = 5000;

// Campos aceitos na importação e sinônimos usados para sugerir o mapeamento automaticamente
const IMPORT_FIELDS = {
  name: ['nome', 'nome completo', 'name', 'full name', 'full_name', 'contato', 'nome do contato'],
  kind: ['tipo', 'tipo pessoa', 'tipo de pessoa', 'pf/pj'],
  phone1: ['telefone', 'telefone principal', 'celular', 'phone', 'phone_number', 'fone', 'tel'],
  phone2: ['telefone secundario', 'telefone 2', 'telefone2', 'fone 2'],
  whatsapp: ['whatsapp', 'whats'],
  email: ['email', 'e-mail', 'mail'],
  city: ['cidade', 'city', 'municipio'],
  state: ['estado', 'uf', 'state'],
  doc: ['cpf', 'cnpj', 'cpf/cnpj', 'documento'],
  trade_name: ['empresa', 'nome fantasia', 'company', 'company_name'],
  legal_name: ['razao social', 'razão social'],
  contact_name: ['contato principal', 'nome do contato principal'],
  profession: ['profissao', 'profissão', 'atividade', 'job_title'],
  origin: ['origem', 'fonte', 'source'],
  campaign: ['campanha', 'campaign', 'campaign_name', 'nome da campanha'],
  initial_notes: ['observacoes', 'observações', 'obs', 'notas'],
  owner_email: ['responsavel', 'responsável', 'email do responsavel', 'consultor'],
  platform_lead_id: ['id', 'lead_id', 'id do lead', 'id lead'],
  campaign_id: ['campaign_id', 'id da campanha'],
  adset_id: ['adset_id', 'id do conjunto', 'id do conjunto de anuncios'],
  ad_id: ['ad_id', 'id do anuncio', 'id do anúncio'],
  utm_source: ['utm_source'],
  utm_medium: ['utm_medium'],
  utm_campaign: ['utm_campaign'],
  utm_content: ['utm_content'],
  utm_term: ['utm_term'],
  received_at: ['created_time', 'data', 'data de recebimento', 'data de criacao'],
  credit_value: ['credito desejado', 'crédito desejado', 'valor do credito', 'credito', 'crédito', 'valor da carta'],
};

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

function suggestMapping(headers) {
  const mapping = {};
  for (const [field, syns] of Object.entries(IMPORT_FIELDS)) {
    const idx = headers.findIndex((h) => syns.map(norm).includes(norm(h)) || norm(h) === field);
    if (idx >= 0 && !Object.values(mapping).includes(headers[idx])) mapping[field] = headers[idx];
  }
  return mapping;
}

function rowToRecord(headers, row, mapping) {
  const rec = {};
  for (const [field, header] of Object.entries(mapping || {})) {
    if (!header) continue;
    const i = headers.indexOf(header);
    if (i >= 0) rec[field] = row[i] != null ? String(row[i]).trim() : '';
  }
  return rec;
}

function recordToContact(db, rec, defaults) {
  let kind = 'PF';
  const k = norm(rec.kind);
  if (['pj', 'juridica', 'pessoa juridica', 'empresa'].includes(k) || digits(rec.doc).length === 14) kind = 'PJ';
  let origin = defaults.origin || 'importacao';
  if (rec.origin) {
    const found = db.prepare("SELECT value FROM options WHERE list = 'origem' AND (lower(value) = lower(?) OR lower(label) = lower(?))").get(rec.origin, rec.origin);
    origin = found ? found.value : 'outra';
  }
  return {
    kind,
    name: rec.name || rec.trade_name || rec.legal_name,
    trade_name: kind === 'PJ' ? rec.trade_name : undefined,
    legal_name: kind === 'PJ' ? rec.legal_name : undefined,
    phone1: rec.phone1,
    phone2: rec.phone2,
    whatsapp: rec.whatsapp,
    email: rec.email,
    city: rec.city,
    state: rec.state,
    doc: rec.doc,
    profession: rec.profession,
    origin,
    campaign: rec.campaign || defaults.campaign,
    initial_notes: rec.initial_notes,
    contact_name: kind === 'PJ' ? rec.contact_name : undefined,
    credit_value: rec.credit_value || undefined,
  };
}

/** Valida e classifica cada linha (sem gravar). */
function analyze(db, user, body) {
  const text = String(body.csv || '');
  if (!text.trim()) throw badRequest('Arquivo vazio.');
  const { headers, rows } = parseCSV(text);
  if (!headers.length) throw badRequest('Não foi possível identificar o cabeçalho do arquivo.');
  if (rows.length > MAX_ROWS) throw badRequest(`O arquivo tem ${rows.length} linhas. Importe no máximo ${MAX_ROWS} por vez.`);
  const mapping = body.mapping && Object.keys(body.mapping).length ? body.mapping : suggestMapping(headers);
  if (!mapping.name && !mapping.trade_name) throw badRequest('Mapeie ao menos a coluna de nome.');
  const seen = { phone: new Map(), email: new Map(), doc: new Map() };
  const s = contactScope(db, user, 'c');
  const out = rows.map((row, i) => {
    const line = i + 2;
    const rec = rowToRecord(headers, row, mapping);
    const data = recordToContact(db, rec, body);
    const errors = [];
    let normalized = null;
    try {
      normalized = normalizeInput(db, data, data.kind);
      if (!normalized.name) errors.push('Nome ausente.');
      if (!normalized.phone1_norm && !normalized.phone2_norm && !normalized.whatsapp_norm && !normalized.email) errors.push('Informe ao menos um telefone ou e-mail.');
      if (data.credit_value) {
        try {
          data.credit_value = toNumber(data.credit_value);
        } catch {
          errors.push(`Crédito desejado inválido: "${data.credit_value}".`);
        }
      }
    } catch (e) {
      errors.push(e.message);
    }
    if (rec.owner_email) {
      const u = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?) AND active = 1').get(rec.owner_email);
      if (!u) errors.push(`Responsável "${rec.owner_email}" não encontrado.`);
      else data.owner_id = u.id;
    }
    let duplicate = null;
    let duplicateInFile = null;
    if (normalized && !errors.length) {
      const phones = [normalized.phone1_norm, normalized.phone2_norm, normalized.whatsapp_norm].filter(Boolean);
      const keys = [...phones.map((p) => ['phone', p]), ...(normalized.email ? [['email', normalized.email]] : []), ...(normalized.doc ? [['doc', normalized.doc]] : [])];
      for (const [t, v] of keys) {
        if (seen[t].has(v)) duplicateInFile = seen[t].get(v);
      }
      if (!duplicateInFile) for (const [t, v] of keys) seen[t].set(v, line);
      let dups = findDuplicates(db, { phones, email: normalized.email, doc: normalized.doc });
      if (rec.platform_lead_id) {
        const o = db.prepare('SELECT contact_id FROM contact_origins WHERE platform = ? AND platform_lead_id = ?').get(body.platform || 'importacao', rec.platform_lead_id);
        if (o && !dups.find((d) => d.id === o.contact_id)) dups.push(db.prepare('SELECT id, code, name FROM contacts WHERE id = ?').get(o.contact_id));
      }
      if (dups.length) {
        const d = dups[0];
        const visible = !!db.prepare(`SELECT 1 FROM contacts c WHERE c.id = ? AND ${s.sql}`).get(d.id, ...s.params);
        duplicate = { id: visible ? d.id : null, code: d.code, name: visible ? d.name : null, count: dups.length, reasons: d.reasons || ['ID da plataforma'] };
      }
    }
    return { line, rec, data, errors, duplicate, duplicate_in_file: duplicateInFile };
  });
  return { headers, mapping, rows: out };
}

function preview(db, user, body) {
  requireWrite(user);
  const a = analyze(db, user, body);
  return {
    headers: a.headers,
    mapping: a.mapping,
    fields: Object.keys(IMPORT_FIELDS),
    total: a.rows.length,
    valid: a.rows.filter((r) => !r.errors.length && !r.duplicate && !r.duplicate_in_file).length,
    duplicates: a.rows.filter((r) => r.duplicate || r.duplicate_in_file).length,
    errors: a.rows.filter((r) => r.errors.length).length,
    sample: a.rows.slice(0, 50).map((r) => ({
      line: r.line,
      name: r.data.name,
      kind: r.data.kind,
      phone1: r.data.phone1,
      email: r.data.email,
      city: r.data.city,
      state: r.data.state,
      origin: r.data.origin,
      doc: maskDoc(r.data.doc),
      errors: r.errors,
      duplicate: r.duplicate,
      duplicate_in_file: r.duplicate_in_file,
    })),
    row_errors: a.rows.filter((r) => r.errors.length).map((r) => ({ line: r.line, errors: r.errors })),
    // Linhas que já existem no CRM ou se repetem no arquivo: ficam fora da importação (só os cadastros novos sobem para o funil)
    duplicate_rows: a.rows.filter((r) => !r.errors.length && (r.duplicate || r.duplicate_in_file)).slice(0, 2000).map((r) => ({
      line: r.line, name: r.data.name, phone1: r.data.phone1, email: r.data.email,
      reason: r.duplicate_in_file ? `repetido no arquivo (igual à linha ${r.duplicate_in_file})` : `já existe no CRM: ${r.duplicate.code}${r.duplicate.name ? ` — ${r.duplicate.name}` : ' (outro responsável)'} · ${(r.duplicate.reasons || []).join(', ')}`,
    })),
  };
}

function commit(db, user, body) {
  requireWrite(user);
  const policy = body.duplicate_policy === 'adicionar_origem' ? 'adicionar_origem' : 'ignorar';
  // "roleta": cada cadastro novo entra sem responsável e é distribuído na hora pela roleta
  const byRoleta = body.owner_id === 'roleta' && isManager(user);
  const ownerDefault = byRoleta ? null : body.owner_id ? Number(body.owner_id) : user.id;
  if (ownerDefault) assertAssignable(db, user, ownerDefault);
  const a = analyze(db, user, body);
  const now = nowIso();
  const imp = db
    .prepare('INSERT INTO imports (filename, origin, campaign, mapping, total_rows, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(clean(body.filename) ?? null, body.origin || 'importacao', clean(body.campaign) ?? null, JSON.stringify(a.mapping), a.rows.length, user.id, now);
  const importId = Number(imp.lastInsertRowid);
  const result = { created: 0, duplicates: 0, origins_added: 0, errors: [] };
  for (const r of a.rows) {
    if (r.errors.length) {
      result.errors.push({ line: r.line, message: r.errors.join(' ') });
      continue;
    }
    const originDetails = {
      platform: body.platform || 'importacao',
      platform_lead_id: r.rec.platform_lead_id,
      campaign_id: r.rec.campaign_id,
      adset_id: r.rec.adset_id,
      ad_id: r.rec.ad_id,
      utm_source: r.rec.utm_source,
      utm_medium: r.rec.utm_medium,
      utm_campaign: r.rec.utm_campaign,
      utm_content: r.rec.utm_content,
      utm_term: r.rec.utm_term,
      received_at: r.rec.received_at || null,
      source_ref: `importacao:${importId}`,
    };
    if (r.duplicate || r.duplicate_in_file) {
      result.duplicates++;
      if (policy === 'adicionar_origem' && r.duplicate && r.duplicate.id && r.duplicate.count === 1 && !r.duplicate_in_file) {
        try {
          tx(db, () => {
            insertOrigin(db, user, r.duplicate.id, { origin: r.data.origin, campaign_name: r.data.campaign, ...originDetails });
            insertActivity(db, { contact_id: r.duplicate.id, type: 'cadastro', notes: `Registro reencontrado na importação #${importId} (linha ${r.line}). Nenhuma duplicata criada.`, user_id: user.id, source: 'importacao' });
          });
          result.origins_added++;
        } catch (e) {
          result.errors.push({ line: r.line, message: `Duplicado; não foi possível adicionar a origem: ${e.message}` });
        }
      }
      continue;
    }
    try {
      let owner = r.data.owner_id || ownerDefault;
      if (user.role === 'consultor') owner = user.id;
      if (owner) assertAssignable(db, user, owner);
      const created = createContact(
        db,
        user,
        { ...r.data, owner_id: owner, origin_details: originDetails, create_opportunity: body.create_opportunity !== false },
        { skipDuplicateCheck: true, source: 'importacao', sourceLabel: `importação #${importId}`, sourceRef: `importacao:${importId}` },
      );
      result.created++;
      if (!owner && require('./distribution').autoDistribute(db, created.id)) result.distributed = (result.distributed || 0) + 1;
    } catch (e) {
      result.errors.push({ line: r.line, message: e.message });
    }
  }
  db.prepare('UPDATE imports SET created_count = ?, duplicate_count = ?, error_count = ?, errors = ? WHERE id = ?').run(
    result.created, result.duplicates, result.errors.length, JSON.stringify(result.errors.slice(0, 1000)), importId,
  );
  audit(db, user, 'import', importId, 'executada', { criados: result.created, duplicados: result.duplicates, erros: result.errors.length });
  return { import_id: importId, total: a.rows.length, ...result };
}

function listImports(db, user) {
  const ids = isManager(user) ? null : [user.id];
  return db
    .prepare(`SELECT i.id, i.filename, i.origin, i.campaign, i.total_rows, i.created_count, i.duplicate_count, i.error_count, i.errors, i.created_at, u.name AS user_name
      FROM imports i LEFT JOIN users u ON u.id = i.created_by ${ids ? 'WHERE i.created_by = ?' : ''} ORDER BY i.id DESC LIMIT 50`)
    .all(...(ids || []))
    .map((r) => ({ ...r, errors: JSON.parse(r.errors || '[]') }));
}

/* ------------------------- Exportação ------------------------- */

const fmtDate = (v) => (v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');
const optLabel = (db) => {
  const all = db.prepare('SELECT list, value, label FROM options').all();
  return (list, v) => (v == null ? '' : all.find((o) => o.list === list && o.value === v)?.label || v);
};

function exportData(db, user, entity, q) {
  if (user.role === 'leitura') throw forbidden('Perfis de leitura não exportam dados pessoais. Use os relatórios agregados.');
  // Exportação em CSV é exclusiva do administrador (a lista da discadora segue liberada para líderes e especialistas)
  if (entity !== 'lista_discadora' && user.role !== 'admin') throw forbidden('A exportação em CSV é exclusiva do administrador.');
  const L = optLabel(db);
  const all = { ...q, all: true };
  let columns;
  let rows;
  switch (entity) {
    case 'cadastros': {
      rows = listContacts(db, user, all).rows;
      const full = db.prepare('SELECT id, doc, profession, birth_date FROM contacts WHERE id = ?');
      const includeDoc = q.incluir_documento === '1' && isManager(user);
      columns = [
        { label: 'Código', key: 'code' }, { label: 'Tipo', key: 'kind' }, { label: 'Nome', key: 'name' }, { label: 'Nome fantasia', key: 'trade_name' },
        { label: 'Telefone', key: 'phone1' }, { label: 'Telefone 2', key: 'phone2' }, { label: 'WhatsApp', key: 'whatsapp' }, { label: 'E-mail', key: 'email' },
        { label: 'Cidade', key: 'city' }, { label: 'UF', key: 'state' },
        { label: 'Relacionamento', get: (r) => RELATIONSHIPS[r.relationship] }, { label: 'Status do lead', get: (r) => LEAD_STATUS[r.lead_status] },
        { label: 'Status do cliente', get: (r) => CLIENT_STATUS[r.client_status] || '' }, { label: 'Origem', get: (r) => L('origem', r.origin) },
        { label: 'Campanha', key: 'campaign' }, { label: 'Responsável', key: 'owner_name' }, { label: 'Não contatar por', get: (r) => r.optouts.join(', ') },
        { label: 'Próxima ação', get: (r) => r.next_action?.title || '' }, { label: 'Data próxima ação', get: (r) => fmtDate(r.next_action?.due_at) },
        { label: 'Criado em', get: (r) => fmtDate(r.created_at) }, { label: 'Última atividade', get: (r) => fmtDate(r.last_activity_at) },
      ];
      if (includeDoc) columns.splice(4, 0, { label: 'CPF/CNPJ', get: (r) => full.get(r.id)?.doc || '' });
      break;
    }
    case 'oportunidades':
      rows = listOpportunities(db, user, all).rows;
      columns = [
        { label: 'Código', key: 'code' }, { label: 'Cadastro', key: 'contact_code' }, { label: 'Nome', key: 'contact_name' }, { label: 'Etapa', key: 'stage_name' },
        { label: 'Status', get: (r) => OPP_STATUS[r.status] }, { label: 'Prioridade', get: (r) => PRIORITIES[r.priority] }, { label: 'Produto', key: 'product_name' },
        { label: 'Categoria', get: (r) => L('categoria_credito', r.credit_category) }, { label: 'Crédito desejado', key: 'credit_value' }, { label: 'Prazo (meses)', key: 'term_months' },
        { label: 'Parcela mín.', key: 'installment_min' }, { label: 'Parcela máx.', key: 'installment_max' }, { label: 'Cotas', key: 'quotas' },
        { label: 'Modalidade', get: (r) => L('modalidade_pagamento', r.payment_modality) }, { label: 'Estratégia', get: (r) => L('estrategia', r.strategy) },
        { label: 'Estratégia validada', get: (r) => (r.strategy_validated_at ? 'Sim' : 'Não') }, { label: 'Contemplação', get: (r) => L('tipo_contemplacao', r.contemplation_type) },
        { label: 'Urgência', get: (r) => L('urgencia', r.urgency) }, { label: 'Responsável', key: 'owner_name' }, { label: 'Próxima ação', key: 'next_action' },
        { label: 'Data próxima ação', get: (r) => fmtDate(r.next_action_at) }, { label: 'Motivo de perda', get: (r) => L('motivo_perda', r.lost_reason) },
        { label: 'Dias na etapa', key: 'days_in_stage' }, { label: 'Criada em', get: (r) => fmtDate(r.created_at) }, { label: 'Fechada em', get: (r) => fmtDate(r.closed_at) },
      ];
      break;
    case 'atividades':
      rows = listActivities(db, user, { ...q, limit: 500, page: 1 }).rows;
      for (let p = 2; rows.length === (p - 1) * 500 && p < 200; p++) rows = rows.concat(listActivities(db, user, { ...q, limit: 500, page: p }).rows);
      columns = [
        { label: 'Data', get: (r) => fmtDate(r.occurred_at) }, { label: 'Tipo', get: (r) => ACTIVITY_TYPES[r.type]?.label || r.type }, { label: 'Cadastro', key: 'contact_code' },
        { label: 'Nome', key: 'contact_name' }, { label: 'Oportunidade', key: 'opportunity_code' }, { label: 'Canal', get: (r) => L('canal', r.channel) },
        { label: 'Resultado', get: (r) => L('resultado_ligacao', r.result) }, { label: 'Duração (s)', key: 'duration_seconds' }, { label: 'Usuário', key: 'user_name' },
        { label: 'Origem do registro', key: 'source' }, { label: 'ID externo', key: 'external_id' }, { label: 'Observação', key: 'notes' }, { label: 'Próxima ação', key: 'next_action' },
      ];
      break;
    case 'propostas':
      rows = listProposals(db, user, all).rows;
      columns = [
        { label: 'Código', key: 'code' }, { label: 'Versão', key: 'version' }, { label: 'Cadastro', key: 'contact_code' }, { label: 'Nome', key: 'contact_name' },
        { label: 'Oportunidade', key: 'opportunity_code' }, { label: 'Produto', key: 'product_name' }, { label: 'Crédito', key: 'credit_value' }, { label: 'Prazo', key: 'term_months' },
        { label: 'Parcela inicial', key: 'initial_installment' }, { label: 'Taxa adm. (%)', key: 'admin_fee_pct' }, { label: 'Fundo de reserva (%)', key: 'reserve_fund_pct' },
        { label: 'Seguro (%)', key: 'insurance_pct' }, { label: 'Reajuste', get: (r) => L('indice_reajuste', r.readjustment_index) }, { label: 'Estratégia', get: (r) => L('estrategia', r.strategy) },
        { label: 'Status', get: (r) => PROPOSAL_STATUS[r.status] }, { label: 'Validade', key: 'valid_until' }, { label: 'Responsável', key: 'owner_name' }, { label: 'Criada em', get: (r) => fmtDate(r.created_at) },
      ];
      break;
    case 'simulacoes':
      rows = listSimulations(db, user, all).rows;
      columns = [
        { label: 'Código', key: 'code' }, { label: 'Versão', key: 'version' }, { label: 'Origem', key: 'source' }, { label: 'ID no simulador', key: 'external_id' },
        { label: 'Cadastro', key: 'contact_code' }, { label: 'Nome', key: 'contact_name' }, { label: 'Oportunidade', key: 'opportunity_code' }, { label: 'Crédito', key: 'credit_value' },
        { label: 'Prazo', key: 'term_months' }, { label: 'Parcela', key: 'installment' }, { label: 'Modalidade', get: (r) => L('modalidade_pagamento', r.payment_modality) },
        { label: 'Estratégia', get: (r) => L('estrategia', r.strategy) }, { label: 'Status', get: (r) => SIMULATION_STATUS[r.status] || r.status }, { label: 'Link', key: 'view_url' },
        { label: 'Usuário', key: 'user_name' }, { label: 'Criada em', get: (r) => fmtDate(r.created_at) },
      ];
      break;
    case 'contratos':
      rows = listContracts(db, user, all).rows;
      columns = [
        { label: 'Código', key: 'code' }, { label: 'Cadastro', key: 'contact_code' }, { label: 'Cliente', key: 'contact_name' }, { label: 'Produto', key: 'product_name' },
        { label: 'Categoria', get: (r) => L('categoria_credito', r.category) }, { label: 'Administradora', key: 'administrator' }, { label: 'Grupo', key: 'group_code' },
        { label: 'Cota', key: 'quota_code' }, { label: 'Crédito', key: 'credit_value' }, { label: 'Prazo', key: 'term_months' }, { label: 'Cotas', key: 'quotas' },
        { label: 'Contratação', key: 'contracted_at' }, { label: 'Status', get: (r) => L('status_contrato', r.status) }, { label: 'Modalidade', get: (r) => L('modalidade_pagamento', r.payment_modality) },
        { label: 'Estratégia', get: (r) => L('estrategia', r.strategy) }, { label: 'Proposta', key: 'proposal_code' }, { label: 'Responsável', key: 'owner_name' },
        { label: 'Nº contrato administradora', key: 'contract_number' }, { label: 'Valor da parcela', key: 'installment_value' }, { label: 'Dia de vencimento', key: 'due_day' },
        { label: 'Contemplado em', key: 'contemplated_at' }, { label: 'Vendedor', key: 'seller_name' }, { label: 'Valor de venda (carta)', key: 'sale_value' },
      ];
      break;
    case 'financeiro': {
      const { listEntries, STATUS_LABEL } = require('./finance');
      rows = listEntries(db, user, all).rows;
      columns = [
        { label: 'Código', key: 'code' }, { label: 'Cadastro', key: 'contact_code' }, { label: 'Cliente', key: 'contact_name' }, { label: 'Contrato', key: 'contract_code' },
        { label: 'Nº contrato administradora', key: 'contract_number' }, { label: 'Tipo', get: (r) => L('tipo_lancamento', r.type) }, { label: 'Parcela', key: 'installment_number' },
        { label: 'Vencimento', key: 'due_date' }, { label: 'Valor', key: 'amount' }, { label: 'Situação', get: (r) => STATUS_LABEL[r.display_status] },
        { label: 'Dias em atraso', key: 'days_late' }, { label: 'Pago em', key: 'paid_at' }, { label: 'Valor pago', key: 'paid_amount' },
        { label: 'Forma de pagamento', get: (r) => L('forma_pagamento', r.payment_method) }, { label: 'Responsável', key: 'owner_name' }, { label: 'Observações', key: 'notes' },
      ];
      break;
    }
    case 'lista_discadora': {
      // Lista para campanhas da discadora: exclui quem se opôs a ligações e cadastros sem telefone
      const list = listContacts(db, user, all).rows.filter((r) => !r.optouts.includes('todos') && !r.optouts.includes('ligacao') && (r.phone1 || r.whatsapp) && !r.anonymized_at);
      rows = list;
      columns = [
        { label: 'id_lead', key: 'code' }, { label: 'nome', key: 'name' }, { label: 'telefone', get: (r) => normalizePhone(r.phone1 || r.whatsapp) },
        { label: 'telefone_2', get: (r) => normalizePhone(r.phone2) || '' }, { label: 'responsavel', key: 'owner_name' },
      ];
      break;
    }
    default:
      throw badRequest('Exportação inválida.');
  }
  audit(db, user, 'export', null, 'exportado', { entidade: entity, linhas: rows.length, filtros: q });
  return { filename: `${entity}-${new Date().toISOString().slice(0, 10)}.csv`, content: toCSV(columns, rows) };
}

module.exports = { preview, commit, listImports, exportData, suggestMapping, IMPORT_FIELDS };
