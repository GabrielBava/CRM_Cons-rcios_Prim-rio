'use strict';
const { RELATIONSHIPS, LEAD_STATUS, CLIENT_STATUS, CONTACT_CHANNELS, DATA_REQUEST_TYPES, ATTEMPT_TYPES } = require('../constants');
const {
  contactScope,
  loadContact,
  assertAssignable,
  requireWrite,
  requireManager,
  requireAdmin,
  audit,
  diff,
  buildUpdate,
  paging,
  isManager,
  optionLabel,
} = require('../core');
const {
  badRequest,
  conflict,
  forbidden,
  clean,
  digits,
  normalizePhone,
  normalizeEmail,
  isValidEmail,
  isValidCPF,
  isValidCNPJ,
  maskDoc,
  toIso,
  toDateOnly,
  uuid,
  nowIso,
} = require('../util');
const { tx, nextCode, getSetting } = require('../db');
const { insertActivity, optouts } = require('./activities');

const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

const CONTACT_FIELDS = [
  'kind', 'relationship', 'lead_status', 'client_status', 'name', 'trade_name', 'legal_name', 'doc', 'state_registration',
  'phone1', 'phone1_norm', 'phone2', 'phone2_norm', 'whatsapp', 'whatsapp_norm', 'email', 'email_norm', 'city', 'state',
  'birth_date', 'profession', 'segment', 'company_size', 'website', 'origin', 'campaign', 'first_contact_at', 'initial_notes',
  'pref_channel', 'pref_time', 'pref_phone', 'pref_frequency', 'contact_restriction', 'pref_updated_at', 'pref_source',
  'owner_id', 'custom',
  'rg', 'birthplace', 'nationality', 'sex', 'marital_status', 'property_regime', 'mother_name', 'income_range', 'net_worth_range',
  'spouse_name', 'spouse_doc', 'spouse_profession', 'spouse_income_range', 'opening_date', 'main_activity', 'revenue_range',
  'temperature', 'referred_by_id', 'nps_score', 'nps_comment', 'nps_at',
];
// Campos preenchidos por listas configuráveis (validados contra a lista)
const LIST_FIELDS = {
  sex: 'sexo', marital_status: 'estado_civil', property_regime: 'regime_bens', income_range: 'faixa_renda',
  net_worth_range: 'faixa_patrimonio', spouse_income_range: 'faixa_renda', revenue_range: 'faixa_faturamento',
  temperature: 'temperatura', segment: 'segmento', company_size: 'porte', origin: 'origem',
};
const AUDITED_FIELDS = CONTACT_FIELDS.filter((f) => !f.endsWith('_norm') && f !== 'pref_updated_at');
const PREF_FIELDS = ['pref_channel', 'pref_time', 'pref_phone', 'pref_frequency', 'contact_restriction'];

const DEFAULT_RECOMMENDED = {
  PF: ['phone1', 'email', 'city', 'state', 'origin', 'pref_channel', 'temperature'],
  PJ: ['phone1', 'email', 'legal_name', 'doc', 'city', 'state', 'origin', 'company_contact', 'temperature'],
};

function recommendedFields(db, kind) {
  const cfg = getSetting(db, 'field_config') || {};
  const entity = cfg[kind === 'PJ' ? 'contact_pj' : 'contact_pf'] || {};
  const list = new Set(DEFAULT_RECOMMENDED[kind]);
  for (const [f, v] of Object.entries(entity)) {
    if (v && v.recommended === true) list.add(f);
    if (v && (v.recommended === false || v.visible === false)) list.delete(f);
  }
  return [...list];
}

function validateCustom(db, entity, custom) {
  if (custom == null) return '{}';
  if (typeof custom !== 'object') throw badRequest('Campos adicionais inválidos.');
  const defs = db.prepare('SELECT * FROM custom_fields WHERE entity = ? AND active = 1').all(entity);
  const out = {};
  for (const d of defs) {
    let v = custom[d.key];
    if (v === undefined || v === null || v === '') continue;
    if (d.type === 'number') {
      v = Number(String(v).replace(',', '.'));
      if (!Number.isFinite(v)) throw badRequest(`Campo "${d.label}" deve ser numérico.`);
    } else if (d.type === 'boolean') v = !!v && v !== 'false' && v !== '0';
    else if (d.type === 'date') v = toDateOnly(v);
    else if (d.type === 'select') {
      const opts = JSON.parse(d.options || '[]');
      if (!opts.includes(v)) throw badRequest(`Valor inválido para "${d.label}".`);
    } else v = String(v).slice(0, 2000);
    out[d.key] = v;
  }
  return JSON.stringify(out);
}

/** Normaliza e valida os campos recebidos. Retorna apenas campos presentes em data. */
function normalizeInput(db, data, kind) {
  const o = {};
  const set = (k, v) => {
    if (v !== undefined) o[k] = v;
  };
  if (data.kind !== undefined) {
    if (!['PF', 'PJ'].includes(data.kind)) throw badRequest('Tipo de cadastro deve ser PF ou PJ.');
    o.kind = data.kind;
  }
  const k = o.kind || kind;
  for (const f of ['name', 'trade_name', 'legal_name', 'state_registration', 'city', 'profession', 'segment', 'company_size',
    'website', 'origin', 'campaign', 'initial_notes', 'pref_channel', 'pref_time', 'pref_phone', 'pref_frequency', 'contact_restriction',
    'rg', 'birthplace', 'nationality', 'mother_name', 'spouse_name', 'spouse_profession', 'main_activity', 'nps_comment',
    'sex', 'marital_status', 'property_regime', 'income_range', 'net_worth_range', 'spouse_income_range', 'revenue_range', 'temperature']) {
    set(f, clean(data[f]));
  }
  for (const [f, list] of Object.entries(LIST_FIELDS)) {
    if (o[f] && !db.prepare('SELECT 1 FROM options WHERE list = ? AND value = ?').get(list, o[f])) {
      throw badRequest(`Valor inválido para o campo ${f}.`);
    }
  }
  if (data.spouse_doc !== undefined) {
    const d = digits(data.spouse_doc);
    if (d && !isValidCPF(d)) throw badRequest('CPF do cônjuge inválido.');
    o.spouse_doc = d || null;
  }
  set('opening_date', toDateOnly(data.opening_date));
  if (data.nps_score !== undefined) {
    const n = data.nps_score === '' || data.nps_score === null ? null : Number(data.nps_score);
    if (n != null && (!Number.isInteger(n) || n < 0 || n > 10)) throw badRequest('A nota NPS deve ser um número inteiro de 0 a 10.');
    o.nps_score = n;
    if (n != null) o.nps_at = nowIso();
  }
  if (data.referred_by_id !== undefined) {
    o.referred_by_id = data.referred_by_id ? Number(data.referred_by_id) : null;
    if (o.referred_by_id && !db.prepare('SELECT 1 FROM contacts WHERE id = ? AND merged_into_id IS NULL').get(o.referred_by_id)) {
      throw badRequest('Cadastro indicado não encontrado.');
    }
  }
  if (o.name !== undefined && !o.name) throw badRequest('Informe o nome completo ou nome de contato.');
  if (data.state !== undefined) {
    const st = clean(data.state);
    if (st && !UFS.includes(st.toUpperCase())) throw badRequest('Estado (UF) inválido.');
    o.state = st ? st.toUpperCase() : null;
  }
  for (const f of ['phone1', 'phone2', 'whatsapp']) {
    if (data[f] !== undefined) {
      const raw = clean(data[f]);
      const norm = raw ? normalizePhone(raw) : null;
      if (raw && !norm) throw badRequest(`Telefone inválido: "${raw}". Inclua o DDD.`);
      o[f] = raw;
      o[`${f}_norm`] = norm;
    }
  }
  if (data.email !== undefined) {
    const e = normalizeEmail(data.email);
    if (e && !isValidEmail(e)) throw badRequest(`E-mail inválido: "${data.email}".`);
    o.email = e;
    o.email_norm = e;
  }
  if (data.doc !== undefined) {
    const d = digits(data.doc);
    if (d) {
      if (k === 'PF' && !isValidCPF(d)) throw badRequest('CPF inválido. Verifique os dígitos.');
      if (k === 'PJ' && !isValidCNPJ(d)) throw badRequest('CNPJ inválido. Verifique os dígitos.');
    }
    o.doc = d || null;
  }
  set('birth_date', toDateOnly(data.birth_date));
  set('first_contact_at', toIso(data.first_contact_at));
  if (data.relationship !== undefined) {
    if (!RELATIONSHIPS[data.relationship]) throw badRequest('Tipo de relacionamento inválido.');
    o.relationship = data.relationship;
  }
  if (data.lead_status !== undefined) {
    if (!LEAD_STATUS[data.lead_status]) throw badRequest('Status do lead inválido.');
    o.lead_status = data.lead_status;
  }
  if (data.client_status !== undefined) {
    const cs = clean(data.client_status);
    if (cs && !CLIENT_STATUS[cs]) throw badRequest('Status do cliente inválido.');
    o.client_status = cs;
  }
  if (data.owner_id !== undefined) o.owner_id = data.owner_id === '' || data.owner_id === null ? null : Number(data.owner_id);
  if (data.custom !== undefined) o.custom = validateCustom(db, 'contact', data.custom);
  return o;
}

/* ------------------------- Duplicidade ------------------------- */

function findDuplicates(db, { phones = [], email, doc }, excludeId) {
  const found = new Map();
  const add = (row, reason) => {
    if (!row || row.id === excludeId) return;
    const cur = found.get(row.id) || { ...row, reasons: [] };
    if (!cur.reasons.includes(reason)) cur.reasons.push(reason);
    found.set(row.id, cur);
  };
  const base = `SELECT c.id, c.code, c.name, c.kind, c.owner_id, c.relationship, u.name AS owner_name
                FROM contacts c LEFT JOIN users u ON u.id = c.owner_id WHERE c.merged_into_id IS NULL AND c.anonymized_at IS NULL`;
  for (const p of phones.filter(Boolean)) {
    db.prepare(`${base} AND (c.phone1_norm = ? OR c.phone2_norm = ? OR c.whatsapp_norm = ?)`).all(p, p, p).forEach((r) => add(r, 'telefone'));
    db.prepare(
      `${base} AND c.id IN (SELECT company_id FROM company_contacts WHERE active = 1 AND (phone_norm = ? OR whatsapp_norm = ?))`,
    )
      .all(p, p)
      .forEach((r) => add(r, 'telefone de contato da empresa'));
  }
  if (email) {
    db.prepare(`${base} AND c.email_norm = ?`).all(email).forEach((r) => add(r, 'e-mail'));
    db.prepare(`${base} AND c.id IN (SELECT company_id FROM company_contacts WHERE active = 1 AND email_norm = ?)`)
      .all(email)
      .forEach((r) => add(r, 'e-mail de contato da empresa'));
  }
  if (doc) db.prepare(`${base} AND c.doc = ?`).all(doc).forEach((r) => add(r, doc.length === 14 ? 'CNPJ' : 'CPF'));
  return [...found.values()];
}

/** Remove dados de registros fora do escopo do usuário, preservando o alerta. */
function sanitizeDuplicates(db, user, dups) {
  const s = contactScope(db, user, 'c');
  return dups.map((d) => {
    const visible = !!db.prepare(`SELECT 1 FROM contacts c WHERE c.id = ? AND ${s.sql}`).get(d.id, ...s.params);
    return visible
      ? { id: d.id, code: d.code, name: d.name, kind: d.kind, owner_name: d.owner_name, reasons: d.reasons, visible: true }
      : { code: d.code, owner_name: d.owner_name || 'sem responsável', reasons: d.reasons, visible: false };
  });
}

function checkDuplicates(db, user, data, excludeId) {
  const phones = ['phone1', 'phone2', 'whatsapp', 'contact_phone'].map((f) => (data[f] ? normalizePhone(data[f]) : null));
  const email = normalizeEmail(data.email);
  const docD = digits(data.doc) || null;
  const extraEmail = normalizeEmail(data.contact_email);
  let dups = findDuplicates(db, { phones, email, doc: docD }, excludeId);
  if (extraEmail) {
    const more = findDuplicates(db, { email: extraEmail }, excludeId);
    for (const m of more) if (!dups.find((d) => d.id === m.id)) dups.push(m);
  }
  return sanitizeDuplicates(db, user, dups);
}

/* ------------------------- Origens ------------------------- */

function insertOrigin(db, user, contactId, o) {
  const has = ['origin', 'campaign_name', 'platform', 'platform_lead_id', 'campaign_id', 'adset_id', 'ad_id', 'utm_source',
    'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'other_params'].some((k) => clean(o[k]));
  if (!has) return null;
  const r = db
    .prepare(
      `INSERT INTO contact_origins (contact_id, origin, campaign_name, platform, platform_lead_id, campaign_id, adset_id, ad_id,
        received_at, utm_source, utm_medium, utm_campaign, utm_content, utm_term, other_params, source_ref, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      contactId,
      clean(o.origin) ?? null,
      clean(o.campaign_name) ?? null,
      clean(o.platform) ?? null,
      clean(o.platform_lead_id) ?? null,
      clean(o.campaign_id) ?? null,
      clean(o.adset_id) ?? null,
      clean(o.ad_id) ?? null,
      toIso(o.received_at) ?? null,
      clean(o.utm_source) ?? null,
      clean(o.utm_medium) ?? null,
      clean(o.utm_campaign) ?? null,
      clean(o.utm_content) ?? null,
      clean(o.utm_term) ?? null,
      typeof o.other_params === 'object' && o.other_params ? JSON.stringify(o.other_params) : clean(o.other_params) ?? null,
      clean(o.source_ref) ?? null,
      user ? user.id : null,
      nowIso(),
    );
  return Number(r.lastInsertRowid);
}

/* ------------------------- Criação e edição ------------------------- */

function createContact(db, user, data, opts = {}) {
  requireWrite(user);
  const kind = data.kind || 'PF';
  const input = normalizeInput(db, { ...data, kind }, kind);
  if (!input.name) throw badRequest('Informe o nome completo ou nome de contato.');
  let ownerId = data.owner_id === undefined ? user.id : input.owner_id;
  if (user.role === 'consultor') ownerId = user.id;
  if (!opts.system) assertAssignable(db, user, ownerId);
  input.owner_id = ownerId;

  const dups = opts.skipDuplicateCheck ? [] : checkDuplicates(db, user, data);
  if (dups.length && !data.confirm_duplicate) {
    throw conflict('Possível duplicidade: já existe cadastro com os mesmos dados de contato.', { duplicates: dups });
  }
  const originDetails = data.origin_details || {};

  return tx(db, () => {
    const now = nowIso();
    const code = nextCode(db, 'contact', 'C');
    const row = {
      relationship: 'prospect',
      lead_status: 'novo',
      custom: '{}',
      ...input,
      kind,
      code,
      uid: uuid(),
      first_contact_at: input.first_contact_at ?? null,
      created_by: user.id,
      updated_by: user.id,
      created_at: now,
      updated_at: now,
    };
    if (PREF_FIELDS.some((f) => row[f])) {
      row.pref_updated_at = now;
      row.pref_source = clean(data.pref_source) || 'Cadastro inicial';
    }
    const cols = Object.keys(row);
    const r = db.prepare(`INSERT INTO contacts (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(
      ...cols.map((c) => row[c] ?? null),
    );
    const id = Number(r.lastInsertRowid);
    insertOrigin(db, user, id, {
      origin: row.origin,
      campaign_name: row.campaign,
      received_at: now,
      ...originDetails,
      source_ref: opts.sourceRef || originDetails.source_ref,
    });
    if (kind === 'PJ' && clean(data.contact_name)) {
      addCompanyContactRow(db, user, id, {
        name: data.contact_name,
        role: data.contact_role,
        phone: data.contact_phone,
        email: data.contact_email,
        is_primary: true,
      });
    }
    insertActivity(db, {
      contact_id: id,
      type: 'cadastro',
      notes: `Cadastro criado${row.origin ? ` — origem: ${optionLabel(db, 'origem', row.origin)}` : ''}${opts.sourceLabel ? ` (${opts.sourceLabel})` : ''}.`,
      user_id: user.id,
      source: opts.source || 'manual',
    });
    audit(db, user, 'contact', id, 'criado', {
      code,
      ...(dups.length ? { duplicidade_confirmada: dups.map((d) => d.code) } : {}),
    }, id);
    if (data.create_opportunity !== false && data.create_opportunity !== 'false') {
      const { createOpportunityRow } = require('./opportunities');
      createOpportunityRow(db, user, {
        contact_id: id,
        owner_id: ownerId,
        product_id: data.product_id,
        credit_category: data.credit_category,
        credit_value: data.credit_value,
        title: data.opportunity_title,
      });
    }
    return { id, code, duplicates_confirmed: dups };
  });
}

function updateContact(db, user, id, data) {
  const before = loadContact(db, user, id, { write: true });
  if (before.merged_into_id) throw badRequest('Este cadastro foi mesclado e não pode ser editado.');
  if (before.anonymized_at) throw badRequest('Este cadastro foi anonimizado e não pode ser editado.');
  const input = normalizeInput(db, data, data.kind || before.kind);
  if (input.kind && input.kind !== before.kind && before.doc && input.doc === undefined) {
    throw badRequest('Ao alterar o tipo de cadastro, revise o CPF/CNPJ.');
  }
  if (input.owner_id !== undefined && input.owner_id !== before.owner_id) {
    if (!isManager(user)) throw forbidden('Apenas gestores e administradores podem transferir responsáveis.');
    assertAssignable(db, user, input.owner_id);
  }
  const touchesKeys = ['phone1', 'phone2', 'whatsapp', 'email', 'doc'].some((f) => input[f] !== undefined && input[f] !== before[f]);
  if (touchesKeys && !data.confirm_duplicate) {
    const probe = {};
    for (const f of ['phone1', 'phone2', 'whatsapp', 'email', 'doc']) if (input[f] !== undefined && input[f] !== before[f]) probe[f] = input[f];
    const dups = checkDuplicates(db, user, probe, before.id);
    if (dups.length) throw conflict('Possível duplicidade: os novos dados já pertencem a outro cadastro.', { duplicates: dups });
  }
  const now = nowIso();
  const prefChanged = PREF_FIELDS.some((f) => input[f] !== undefined && (input[f] ?? null) !== (before[f] ?? null));
  if (prefChanged) {
    input.pref_updated_at = now;
    input.pref_source = clean(data.pref_source) || `Atualizado por ${user.name}`;
  }
  const changes = diff(before, input, AUDITED_FIELDS);
  if (changes.doc) changes.doc = [maskDoc(changes.doc[0]), maskDoc(changes.doc[1])];
  if (!Object.keys(changes).length) return { id: before.id, changed: false };
  input.updated_at = now;
  input.updated_by = user.id;
  if (input.relationship === 'cliente' && !before.converted_at) input.converted_at = now;
  tx(db, () => {
    const u = buildUpdate('contacts', before.id, input, [...CONTACT_FIELDS, 'updated_at', 'updated_by', 'converted_at']);
    if (u) db.prepare(u.sql).run(...u.params);
    audit(db, user, 'contact', before.id, 'alterado', changes, before.id);
    if (prefChanged) {
      insertActivity(db, {
        contact_id: before.id,
        type: 'preferencia',
        notes: `Preferências de contato atualizadas: ${PREF_FIELDS.filter((f) => changes[f]).map((f) => `${f} = ${changes[f][1] ?? '—'}`).join('; ')}`,
        user_id: user.id,
      });
    }
    if (changes.owner_id) {
      // Oportunidades abertas acompanham a transferência do cadastro
      db.prepare("UPDATE opportunities SET owner_id = ?, updated_at = ? WHERE contact_id = ? AND owner_id IS ? AND status IN ('aberta','pausada')").run(
        input.owner_id,
        now,
        before.id,
        before.owner_id,
      );
    }
  });
  return { id: before.id, changed: true };
}

/* ------------------------- Consulta ------------------------- */

const NEXT_TASK_SQL = `(SELECT t.title || '|' || t.due_at FROM tasks t WHERE t.contact_id = c.id AND t.status = 'pendente' ORDER BY t.due_at LIMIT 1)`;
const NEXT_OPP_SQL = `(SELECT o.next_action || '|' || COALESCE(o.next_action_at,'') FROM opportunities o WHERE o.contact_id = c.id AND o.status = 'aberta' AND o.next_action IS NOT NULL ORDER BY o.next_action_at LIMIT 1)`;

function nextActionFrom(row) {
  const parse = (s) => {
    if (!s) return null;
    const i = s.lastIndexOf('|');
    return { title: s.slice(0, i), due_at: s.slice(i + 1) || null };
  };
  const t = parse(row.next_task);
  const o = parse(row.next_opp);
  delete row.next_task;
  delete row.next_opp;
  if (t && o && o.due_at && t.due_at > o.due_at) return o;
  return t || o;
}

function listContacts(db, user, q) {
  const where = ['c.merged_into_id IS NULL'];
  const params = [];
  const s = contactScope(db, user, 'c');
  where.push(s.sql);
  params.push(...s.params);
  if (q.q) {
    const term = String(q.q).trim();
    const d = digits(term);
    const or = ['c.name LIKE ?', 'c.trade_name LIKE ?', 'c.legal_name LIKE ?', 'c.code = ?', 'c.email_norm LIKE ?'];
    params.push(`%${term}%`, `%${term}%`, `%${term}%`, term.toUpperCase(), `%${term.toLowerCase()}%`);
    if (d.length >= 4) {
      or.push('c.phone1_norm LIKE ?', 'c.phone2_norm LIKE ?', 'c.whatsapp_norm LIKE ?', 'c.doc = ?');
      params.push(`%${d}%`, `%${d}%`, `%${d}%`, d);
    }
    where.push(`(${or.join(' OR ')})`);
  }
  const multi = (field, v) => {
    if (!v) return;
    const vals = String(v).split(',').filter(Boolean);
    if (!vals.length) return;
    where.push(`${field} IN (${vals.map(() => '?').join(',')})`);
    params.push(...vals);
  };
  multi('c.relationship', q.relationship);
  multi('c.lead_status', q.lead_status);
  multi('c.client_status', q.client_status);
  multi('c.kind', q.kind);
  multi('c.origin', q.origin);
  multi('c.temperature', q.temperature);
  if (q.owner_id) {
    if (q.owner_id === 'none') where.push('c.owner_id IS NULL');
    else {
      where.push('c.owner_id = ?');
      params.push(Number(q.owner_id));
    }
  }
  if (q.stage_id) {
    where.push("EXISTS (SELECT 1 FROM opportunities o WHERE o.contact_id = c.id AND o.stage_id = ?)");
    params.push(Number(q.stage_id));
  }
  if (q.product_id) {
    where.push('EXISTS (SELECT 1 FROM opportunities o WHERE o.contact_id = c.id AND o.product_id = ?)');
    params.push(Number(q.product_id));
  }
  if (q.no_attempt === '1') {
    where.push(`NOT EXISTS (SELECT 1 FROM activities a WHERE a.contact_id = c.id AND a.type IN (${ATTEMPT_TYPES.map(() => '?').join(',')}))`);
    params.push(...ATTEMPT_TYPES);
  }
  if (q.do_not_contact === '1') where.push("c.optouts <> '[]'");
  if (q.incomplete === '1') where.push("(c.phone1_norm IS NULL OR c.email_norm IS NULL OR c.city IS NULL)");
  if (q.from) {
    where.push('c.created_at >= ?');
    params.push(toIso(q.from));
  }
  if (q.to) {
    where.push('c.created_at <= ?');
    params.push(toIso(q.to));
  }
  if (q.campaign) {
    where.push('(c.campaign LIKE ? OR EXISTS (SELECT 1 FROM contact_origins co WHERE co.contact_id = c.id AND (co.campaign_name LIKE ? OR co.campaign_id = ?)))');
    params.push(`%${q.campaign}%`, `%${q.campaign}%`, q.campaign);
  }
  const sorts = {
    recentes: 'c.created_at DESC',
    antigos: 'c.created_at ASC',
    nome: 'c.name COLLATE NOCASE ASC',
    atualizados: 'c.updated_at DESC',
  };
  const order = sorts[q.sort] || sorts.recentes;
  const { limit, offset, page } = q.all ? { limit: 100000, offset: 0, page: 1 } : paging(q);
  const base = `FROM contacts c LEFT JOIN users u ON u.id = c.owner_id WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) AS n ${base}`).get(...params).n;
  const rows = db
    .prepare(
      `SELECT c.id, c.code, c.uid, c.kind, c.name, c.trade_name, c.legal_name, c.phone1, c.phone2, c.whatsapp, c.email, c.city, c.state,
        c.relationship, c.lead_status, c.client_status, c.origin, c.campaign, c.owner_id, c.doc, c.optouts, c.created_at, c.updated_at,
        c.first_contact_at, c.anonymized_at, c.temperature, u.name AS owner_name,
        (SELECT MAX(a.occurred_at) FROM activities a WHERE a.contact_id = c.id AND a.type NOT IN ('cadastro','preferencia')) AS last_activity_at,
        ${NEXT_TASK_SQL} AS next_task, ${NEXT_OPP_SQL} AS next_opp
       ${base} ORDER BY ${order} LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  for (const r of rows) {
    r.next_action = nextActionFrom(r);
    r.doc_masked = maskDoc(r.doc);
    delete r.doc;
    r.optouts = JSON.parse(r.optouts || '[]');
  }
  return { total, page, limit, rows };
}

function getContact(db, user, id) {
  const c = loadContact(db, user, id);
  const owner = c.owner_id ? db.prepare('SELECT id, name FROM users WHERE id = ?').get(c.owner_id) : null;
  const creator = c.created_by ? db.prepare('SELECT name FROM users WHERE id = ?').get(c.created_by) : null;
  const updater = c.updated_by ? db.prepare('SELECT name FROM users WHERE id = ?').get(c.updated_by) : null;
  const companyContacts = db.prepare('SELECT * FROM company_contacts WHERE company_id = ? ORDER BY is_primary DESC, active DESC, name').all(c.id);
  companyContacts.forEach((cc) => (cc.optouts = optouts(cc)));
  const origins = db.prepare('SELECT * FROM contact_origins WHERE contact_id = ? ORDER BY created_at').all(c.id);
  const opportunities = db
    .prepare(
      `SELECT o.*, s.name AS stage_name, s.kind AS stage_kind, p.name AS product_name, u.name AS owner_name
       FROM opportunities o JOIN pipeline_stages s ON s.id = o.stage_id LEFT JOIN products p ON p.id = o.product_id
       LEFT JOIN users u ON u.id = o.owner_id WHERE o.contact_id = ? ORDER BY o.created_at DESC`,
    )
    .all(c.id);
  const tasks = db
    .prepare(
      `SELECT t.*, u.name AS assigned_name, o.code AS opportunity_code FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to
       LEFT JOIN opportunities o ON o.id = t.opportunity_id WHERE t.contact_id = ? ORDER BY t.status = 'pendente' DESC, t.due_at`,
    )
    .all(c.id);
  const consents = db
    .prepare(
      `SELECT k.*, u.name AS recorded_by_name, cc.name AS company_contact_name FROM consents k LEFT JOIN users u ON u.id = k.recorded_by
       LEFT JOIN company_contacts cc ON cc.id = k.company_contact_id WHERE k.contact_id = ? ORDER BY k.recorded_at DESC`,
    )
    .all(c.id);
  const dataRequests = db.prepare('SELECT * FROM data_requests WHERE contact_id = ? ORDER BY requested_at DESC').all(c.id);
  const contracts = db
    .prepare('SELECT k.*, p.name AS product_name FROM contracts k LEFT JOIN products p ON p.id = k.product_id WHERE k.contact_id = ? ORDER BY k.created_at DESC')
    .all(c.id);
  const simulations = db
    .prepare('SELECT s.*, o.code AS opportunity_code, u.name AS user_name FROM simulations s LEFT JOIN opportunities o ON o.id = s.opportunity_id LEFT JOIN users u ON u.id = s.user_id WHERE s.contact_id = ? ORDER BY s.created_at DESC')
    .all(c.id);
  const proposals = db
    .prepare('SELECT pr.*, o.code AS opportunity_code, p.name AS product_name FROM proposals pr LEFT JOIN opportunities o ON o.id = pr.opportunity_id LEFT JOIN products p ON p.id = pr.product_id WHERE pr.contact_id = ? ORDER BY pr.created_at DESC')
    .all(c.id);
  const mergedFrom = db.prepare('SELECT id, code, name FROM contacts WHERE merged_into_id = ?').all(c.id);
  const record = require('./record');
  const finance = require('./finance');
  const addresses = db.prepare('SELECT * FROM addresses WHERE contact_id = ? ORDER BY is_primary DESC, id').all(c.id);
  const partners = db.prepare('SELECT * FROM partners WHERE contact_id = ? ORDER BY active DESC, is_legal_rep DESC, name').all(c.id);
  const referredBy = c.referred_by_id ? db.prepare('SELECT id, code, name FROM contacts WHERE id = ?').get(c.referred_by_id) : null;
  const referrals = db.prepare('SELECT id, code, name, relationship, created_at FROM contacts WHERE referred_by_id = ? AND merged_into_id IS NULL ORDER BY created_at DESC').all(c.id);
  const activeLink = db.prepare('SELECT created_at, expires_at, last_used_at, submissions FROM client_links WHERE contact_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1').get(c.id, nowIso());
  const row = db.prepare(`SELECT ${NEXT_TASK_SQL} AS next_task, ${NEXT_OPP_SQL} AS next_opp FROM contacts c WHERE c.id = ?`).get(c.id);
  const recommended = recommendedFields(db, c.kind);
  const missing = recommended.filter((f) => (f === 'company_contact' ? !companyContacts.some((x) => x.active) : !c[f]));
  return {
    ...c,
    optouts: optouts(c),
    custom: JSON.parse(c.custom || '{}'),
    owner_name: owner?.name || null,
    created_by_name: creator?.name || null,
    updated_by_name: updater?.name || null,
    company_contacts: companyContacts,
    origins,
    opportunities,
    tasks,
    consents,
    data_requests: dataRequests,
    contracts,
    simulations,
    proposals,
    merged_from: mergedFrom,
    addresses,
    partners,
    attachments: record.listAttachments(db, c.id),
    sale_checklist: record.saleChecklist(db, c),
    finance_summary: finance.summary(db, c.id),
    post_sale: record.postSaleItems(db, c.id),
    referred_by: referredBy,
    referrals,
    client_link: activeLink || null,
    next_action: nextActionFrom(row),
    recommended_fields: recommended,
    missing_recommended: missing,
  };
}

function globalSearch(db, user, term) {
  term = String(term || '').trim();
  if (term.length < 2) return [];
  const s = contactScope(db, user, 'c');
  const d = digits(term);
  const like = `%${term}%`;
  const out = [];
  const conds = ['c.name LIKE ?', 'c.trade_name LIKE ?', 'c.legal_name LIKE ?', 'c.code = ?', 'c.uid = ?', 'c.email_norm LIKE ?'];
  const p = [like, like, like, term.toUpperCase(), term, `%${term.toLowerCase()}%`];
  if (d.length >= 4) {
    conds.push('c.phone1_norm LIKE ?', 'c.phone2_norm LIKE ?', 'c.whatsapp_norm LIKE ?', 'c.doc = ?');
    p.push(`%${d}%`, `%${d}%`, `%${d}%`, d);
  }
  conds.push('c.id IN (SELECT company_id FROM company_contacts WHERE name LIKE ? OR email_norm LIKE ?' + (d.length >= 4 ? ' OR phone_norm LIKE ?' : '') + ')');
  p.push(like, `%${term.toLowerCase()}%`);
  if (d.length >= 4) p.push(`%${d}%`);
  const contacts = db
    .prepare(
      `SELECT c.id, c.code, c.name, c.kind, c.relationship, c.phone1, c.email, c.doc FROM contacts c
       WHERE c.merged_into_id IS NULL AND ${s.sql} AND (${conds.join(' OR ')}) ORDER BY c.updated_at DESC LIMIT 12`,
    )
    .all(...s.params, ...p);
  for (const c of contacts) {
    out.push({ kind: 'contact', id: c.id, code: c.code, title: c.name, subtitle: [c.phone1, c.email, maskDoc(c.doc)].filter(Boolean).join(' · '), relationship: c.relationship, person: c.kind });
  }
  const up = term.toUpperCase();
  if (/^(OP|PR|SIM|CT)-\d+$/.test(up)) {
    const map = { OP: ['opportunities', 'opportunity'], PR: ['proposals', 'proposal'], SIM: ['simulations', 'simulation'], CT: ['contracts', 'contract'] };
    const [table, kind] = map[up.split('-')[0]];
    const r = db.prepare(`SELECT t.id, t.code, t.contact_id, c.name FROM ${table} t JOIN contacts c ON c.id = t.contact_id WHERE t.code = ? AND ${s.sql}`).get(up, ...s.params);
    if (r) out.unshift({ kind, id: r.id, code: r.code, title: `${r.code} — ${r.name}`, contact_id: r.contact_id });
  }
  return out;
}

/* ------------------------- Contatos da empresa ------------------------- */

function addCompanyContactRow(db, user, companyId, data) {
  const name = clean(data.name);
  if (!name) throw badRequest('Informe o nome do contato.');
  const phone = clean(data.phone);
  const phoneNorm = phone ? normalizePhone(phone) : null;
  if (phone && !phoneNorm) throw badRequest('Telefone do contato inválido.');
  const wa = clean(data.whatsapp);
  const waNorm = wa ? normalizePhone(wa) : null;
  const email = normalizeEmail(data.email);
  if (email && !isValidEmail(email)) throw badRequest('E-mail do contato inválido.');
  const now = nowIso();
  if (data.is_primary) db.prepare('UPDATE company_contacts SET is_primary = 0 WHERE company_id = ?').run(companyId);
  const r = db
    .prepare(
      `INSERT INTO company_contacts (company_id, name, role, email, email_norm, phone, phone_norm, whatsapp, whatsapp_norm, is_primary,
        pref_channel, pref_time, notes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(companyId, name, clean(data.role) ?? null, email, email, phone ?? null, phoneNorm, wa ?? null, waNorm, data.is_primary ? 1 : 0,
      clean(data.pref_channel) ?? null, clean(data.pref_time) ?? null, clean(data.notes) ?? null, user.id, now, now);
  return Number(r.lastInsertRowid);
}

function addCompanyContact(db, user, companyId, data) {
  const c = loadContact(db, user, companyId, { write: true });
  if (c.kind !== 'PJ') throw badRequest('Contatos vinculados só podem ser adicionados a pessoas jurídicas.');
  return tx(db, () => {
    const id = addCompanyContactRow(db, user, c.id, data);
    audit(db, user, 'company_contact', id, 'criado', { nome: clean(data.name) }, c.id);
    return id;
  });
}

function updateCompanyContact(db, user, ccId, data) {
  const cc = db.prepare('SELECT * FROM company_contacts WHERE id = ?').get(Number(ccId));
  if (!cc) throw badRequest('Contato não encontrado.');
  loadContact(db, user, cc.company_id, { write: true });
  const upd = {};
  for (const f of ['name', 'role', 'pref_channel', 'pref_time', 'notes']) if (data[f] !== undefined) upd[f] = clean(data[f]);
  if (upd.name === null) throw badRequest('Informe o nome do contato.');
  for (const [f, nf] of [['phone', 'phone_norm'], ['whatsapp', 'whatsapp_norm']]) {
    if (data[f] !== undefined) {
      const v = clean(data[f]);
      const n = v ? normalizePhone(v) : null;
      if (v && !n) throw badRequest('Telefone inválido.');
      upd[f] = v;
      upd[nf] = n;
    }
  }
  if (data.email !== undefined) {
    const e = normalizeEmail(data.email);
    if (e && !isValidEmail(e)) throw badRequest('E-mail inválido.');
    upd.email = e;
    upd.email_norm = e;
  }
  if (data.active !== undefined) upd.active = data.active ? 1 : 0;
  if (data.is_primary !== undefined) upd.is_primary = data.is_primary ? 1 : 0;
  const changes = diff(cc, upd, ['name', 'role', 'phone', 'whatsapp', 'email', 'pref_channel', 'pref_time', 'notes', 'active', 'is_primary']);
  if (!Object.keys(changes).length) return { changed: false };
  upd.updated_at = nowIso();
  tx(db, () => {
    if (upd.is_primary) db.prepare('UPDATE company_contacts SET is_primary = 0 WHERE company_id = ?').run(cc.company_id);
    const u = buildUpdate('company_contacts', cc.id, upd, Object.keys(upd));
    db.prepare(u.sql).run(...u.params);
    audit(db, user, 'company_contact', cc.id, 'alterado', changes, cc.company_id);
  });
  return { changed: true };
}

/* ------------------------- Consentimentos e LGPD ------------------------- */

function recomputeOptouts(db, contactId, companyContactId) {
  const rows = db
    .prepare(
      `SELECT channel, status FROM consents WHERE contact_id = ? AND company_contact_id IS ? ORDER BY recorded_at, id`,
    )
    .all(contactId, companyContactId ?? null);
  const state = {};
  for (const r of rows) state[r.channel] = r.status;
  const list = Object.entries(state).filter(([, s]) => s === 'oposicao').map(([ch]) => ch);
  if (companyContactId) db.prepare('UPDATE company_contacts SET optouts = ? WHERE id = ?').run(JSON.stringify(list), companyContactId);
  else db.prepare('UPDATE contacts SET optouts = ? WHERE id = ?').run(JSON.stringify(list), contactId);
  return list;
}

function recordConsent(db, user, contactId, data) {
  const c = loadContact(db, user, contactId, { write: true });
  const channel = clean(data.channel);
  if (!CONTACT_CHANNELS[channel]) throw badRequest('Canal inválido.');
  if (!['consentimento', 'oposicao'].includes(data.status)) throw badRequest('Informe se é consentimento ou oposição.');
  let ccId = null;
  if (data.company_contact_id) {
    const cc = db.prepare('SELECT id FROM company_contacts WHERE id = ? AND company_id = ?').get(Number(data.company_contact_id), c.id);
    if (!cc) throw badRequest('Contato da empresa inválido.');
    ccId = cc.id;
  }
  const source = clean(data.source);
  if (!source) throw badRequest('Informe a origem da solicitação (ex.: ligação, WhatsApp, e-mail).');
  return tx(db, () => {
    const now = toIso(data.recorded_at) || nowIso();
    db.prepare('INSERT INTO consents (contact_id, company_contact_id, channel, status, source, notes, recorded_at, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      c.id, ccId, channel, data.status, source, clean(data.notes) ?? null, now, user.id,
    );
    const list = recomputeOptouts(db, c.id, ccId);
    const label = data.status === 'oposicao' ? 'Oposição' : 'Consentimento';
    insertActivity(db, {
      contact_id: c.id,
      company_contact_id: ccId,
      type: 'preferencia',
      notes: `${label} registrado(a) para ${CONTACT_CHANNELS[channel]} — origem: ${source}${data.notes ? `. ${clean(data.notes)}` : ''}`,
      user_id: user.id,
    });
    audit(db, user, 'contact', c.id, `${data.status}_registrada`, { canal: channel, origem: source }, c.id);
    return { optouts: list };
  });
}

function createDataRequest(db, user, contactId, data) {
  const c = loadContact(db, user, contactId, { write: true });
  if (!DATA_REQUEST_TYPES[data.type]) throw badRequest('Tipo de solicitação inválido.');
  const r = db
    .prepare('INSERT INTO data_requests (contact_id, type, details, requested_at, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(c.id, data.type, clean(data.details) ?? null, toIso(data.requested_at) || nowIso(), user.id);
  audit(db, user, 'data_request', Number(r.lastInsertRowid), 'aberta', { tipo: data.type }, c.id);
  return Number(r.lastInsertRowid);
}

function resolveDataRequest(db, user, reqId, data) {
  const r = db.prepare('SELECT * FROM data_requests WHERE id = ?').get(Number(reqId));
  if (!r) throw badRequest('Solicitação não encontrada.');
  loadContact(db, user, r.contact_id, { write: true });
  const status = data.status || 'concluida';
  if (!['aberta', 'em_andamento', 'concluida', 'recusada'].includes(status)) throw badRequest('Status inválido.');
  db.prepare('UPDATE data_requests SET status = ?, resolution = ?, resolved_at = ?, resolved_by = ? WHERE id = ?').run(
    status,
    clean(data.resolution) ?? null,
    ['concluida', 'recusada'].includes(status) ? nowIso() : null,
    ['concluida', 'recusada'].includes(status) ? user.id : null,
    r.id,
  );
  audit(db, user, 'data_request', r.id, status, { resolucao: clean(data.resolution) }, r.contact_id);
}

/** Anonimização (eliminação de dados pessoais preservando indicadores). Somente administrador. */
function anonymizeContact(db, user, id, reason) {
  requireAdmin(user);
  const c = loadContact(db, user, id, { write: true });
  if (c.anonymized_at) throw badRequest('Cadastro já anonimizado.');
  if (!clean(reason)) throw badRequest('Informe o motivo/solicitação que fundamenta a anonimização.');
  tx(db, () => {
    const now = nowIso();
    db.prepare(
      `UPDATE contacts SET name = ?, trade_name = NULL, legal_name = NULL, doc = NULL, state_registration = NULL, phone1 = NULL, phone1_norm = NULL,
        phone2 = NULL, phone2_norm = NULL, whatsapp = NULL, whatsapp_norm = NULL, email = NULL, email_norm = NULL, city = NULL,
        birth_date = NULL, profession = NULL, website = NULL, initial_notes = NULL, pref_phone = NULL, contact_restriction = NULL,
        rg = NULL, birthplace = NULL, mother_name = NULL, spouse_name = NULL, spouse_doc = NULL, spouse_profession = NULL, nps_comment = NULL,
        custom = '{}', optouts = '["todos"]', anonymized_at = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
    ).run(`Titular anonimizado (${c.code})`, now, now, user.id, c.id);
    db.prepare(
      `UPDATE company_contacts SET name = 'Contato anonimizado', email = NULL, email_norm = NULL, phone = NULL, phone_norm = NULL,
        whatsapp = NULL, whatsapp_norm = NULL, notes = NULL, optouts = '["todos"]', active = 0 WHERE company_id = ?`,
    ).run(c.id);
    db.prepare("UPDATE activities SET notes = CASE WHEN notes IS NULL THEN NULL ELSE '[conteúdo removido na anonimização]' END WHERE contact_id = ?").run(c.id);
    db.prepare("UPDATE call_events SET phone = NULL, phone_norm = NULL, raw_payload = '{}', recording_url = NULL WHERE contact_id = ?").run(c.id);
    db.prepare("UPDATE simulations SET raw_payload = NULL WHERE contact_id = ?").run(c.id);
    db.prepare("UPDATE inbound_events SET payload = '{}' WHERE contact_id = ?").run(c.id);
    db.prepare("UPDATE contact_origins SET other_params = NULL WHERE contact_id = ?").run(c.id);
    db.prepare("UPDATE simulation_links SET revoked_at = COALESCE(revoked_at, ?) WHERE contact_id = ?").run(now, c.id);
    db.prepare("UPDATE client_links SET revoked_at = COALESCE(revoked_at, ?) WHERE contact_id = ?").run(now, c.id);
    db.prepare("UPDATE attachments SET content = X'', filename = 'removido', status = 'removido', notes = NULL WHERE contact_id = ?").run(c.id);
    db.prepare("UPDATE addresses SET cep = NULL, street = NULL, number = NULL, complement = NULL, district = NULL WHERE contact_id = ?").run(c.id);
    db.prepare("UPDATE partners SET name = 'Anonimizado', doc = NULL, email = NULL, phone = NULL WHERE contact_id = ?").run(c.id);
    db.prepare("UPDATE tasks SET status = 'cancelada', updated_at = ? WHERE contact_id = ? AND status = 'pendente'").run(now, c.id);
    audit(db, user, 'contact', c.id, 'anonimizado', { motivo: clean(reason) }, c.id);
  });
}

/* ------------------------- Mesclagem ------------------------- */

const REL_RANK = { prospect: 0, lead: 1, cliente: 2 };

function mergeContacts(db, user, targetId, sourceId) {
  requireManager(user);
  const target = loadContact(db, user, targetId, { write: true });
  const source = loadContact(db, user, sourceId, { write: true });
  if (target.id === source.id) throw badRequest('Selecione dois cadastros diferentes.');
  if (target.merged_into_id || source.merged_into_id) throw badRequest('Um dos cadastros já foi mesclado.');
  if (target.kind !== source.kind) throw badRequest('Não é possível mesclar pessoa física com pessoa jurídica.');
  return tx(db, () => {
    const now = nowIso();
    const tables = [
      ['activities', 'contact_id'], ['opportunities', 'contact_id'], ['tasks', 'contact_id'], ['contact_origins', 'contact_id'],
      ['consents', 'contact_id'], ['data_requests', 'contact_id'], ['company_contacts', 'company_id'], ['simulations', 'contact_id'],
      ['simulation_links', 'contact_id'], ['proposals', 'contact_id'], ['contracts', 'contact_id'], ['call_events', 'contact_id'],
      ['inbound_events', 'contact_id'], ['addresses', 'contact_id'], ['partners', 'contact_id'], ['attachments', 'contact_id'],
      ['finance_entries', 'contact_id'], ['finance_issues', 'contact_id'], ['post_sale_items', 'contact_id'], ['client_links', 'contact_id'],
    ];
    const moved = {};
    for (const [t, col] of tables) {
      moved[t] = db.prepare(`UPDATE OR IGNORE ${t} SET ${col} = ? WHERE ${col} = ?`).run(target.id, source.id).changes;
    }
    // Completa campos vazios do destino com dados da origem (nunca sobrescreve)
    const fill = {};
    for (const f of CONTACT_FIELDS) {
      if (['owner_id', 'custom', 'kind', 'relationship', 'lead_status'].includes(f)) continue;
      if ((target[f] == null || target[f] === '') && source[f] != null && source[f] !== '') fill[f] = source[f];
    }
    if (REL_RANK[source.relationship] > REL_RANK[target.relationship]) {
      fill.relationship = source.relationship;
      fill.lead_status = source.lead_status;
    }
    const tc = JSON.parse(target.custom || '{}');
    const sc = JSON.parse(source.custom || '{}');
    fill.custom = JSON.stringify({ ...sc, ...tc });
    // Oposições a contato são somadas (postura conservadora)
    fill.optouts = JSON.stringify([...new Set([...optouts(target), ...optouts(source)])]);
    if (!target.first_contact_at || (source.first_contact_at && source.first_contact_at < target.first_contact_at)) {
      fill.first_contact_at = source.first_contact_at || target.first_contact_at;
    }
    fill.updated_at = now;
    fill.updated_by = user.id;
    const u = buildUpdate('contacts', target.id, fill, Object.keys(fill));
    db.prepare(u.sql).run(...u.params);
    db.prepare('UPDATE contacts SET referred_by_id = ? WHERE referred_by_id = ?').run(target.id, source.id);
    db.prepare('UPDATE contacts SET merged_into_id = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(target.id, now, user.id, source.id);
    insertActivity(db, {
      contact_id: target.id,
      type: 'cadastro',
      notes: `Cadastro ${source.code} (${source.name}) mesclado neste registro. Histórico, oportunidades, propostas e origens preservados.`,
      user_id: user.id,
    });
    audit(db, user, 'contact', target.id, 'mesclado', { origem: source.code, movidos: moved, campos_completados: Object.keys(fill) }, target.id);
    audit(db, user, 'contact', source.id, 'mesclado_em', { destino: target.code }, source.id);
    return { id: target.id, moved };
  });
}

function contactAudit(db, user, id) {
  const c = loadContact(db, user, id);
  return db
    .prepare('SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.contact_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT 500')
    .all(c.id)
    .map((r) => ({ ...r, changes: r.changes ? JSON.parse(r.changes) : null }));
}

module.exports = {
  createContact,
  updateContact,
  listContacts,
  getContact,
  globalSearch,
  checkDuplicates,
  findDuplicates,
  insertOrigin,
  addCompanyContact,
  updateCompanyContact,
  recordConsent,
  createDataRequest,
  resolveDataRequest,
  anonymizeContact,
  mergeContacts,
  contactAudit,
  recommendedFields,
  validateCustom,
  normalizeInput,
  CONTACT_FIELDS,
};
