'use strict';
/**
 * Blocos complementares da ficha do lead/cliente: endereços (com busca por CEP), sócios e representantes,
 * anexos, checklist obrigatório para a venda, link para o cliente atualizar os próprios dados e pós-venda.
 */
const { loadContact, audit, requireManager, isManager, optionLabel } = require('../core');
const { HttpError, badRequest, notFound, clean, digits, isValidCPF, normalizeEmail, isValidEmail, normalizePhone, randomToken, sha256, toDateOnly, nowIso } = require('../util');
const { tx, getSetting } = require('../db');
const { insertActivity } = require('./activities');

const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
const assertList = (db, list, value, label) => {
  if (value && !db.prepare('SELECT 1 FROM options WHERE list = ? AND value = ?').get(list, value)) throw badRequest(`Valor inválido para ${label}.`);
};

/* ------------------------- Endereços ------------------------- */

function normalizeCep(v) {
  const d = digits(v);
  if (!d) return null;
  if (d.length !== 8) throw badRequest('CEP deve ter 8 dígitos.');
  return d;
}

/** Consulta o CEP no ViaCEP (serviço público e gratuito). */
async function lookupCep(cep) {
  const d = normalizeCep(cep);
  if (!d) throw badRequest('Informe o CEP.');
  let data;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(`https://viacep.com.br/ws/${d}/json/`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } catch {
    throw new HttpError(502, 'Não foi possível consultar o CEP agora. Preencha o endereço manualmente.');
  }
  if (data.erro) throw notFound('CEP não encontrado. Confira os números ou preencha manualmente.');
  return { cep: d, street: data.logradouro || '', district: data.bairro || '', city: data.localidade || '', state: data.uf || '', ibge: data.ibge || '', complement: data.complemento || '' };
}

function syncPrimaryCity(db, contactId) {
  const a = db.prepare('SELECT city, state FROM addresses WHERE contact_id = ? ORDER BY is_primary DESC, id LIMIT 1').get(contactId);
  if (a && (a.city || a.state)) db.prepare('UPDATE contacts SET city = COALESCE(?, city), state = COALESCE(?, state) WHERE id = ?').run(a.city || null, a.state || null, contactId);
}

function normalizeAddress(db, data) {
  const o = {};
  if (data.type !== undefined) {
    o.type = clean(data.type) || 'residencial';
    assertList(db, 'tipo_endereco', o.type, 'tipo de endereço');
  }
  if (data.cep !== undefined) o.cep = normalizeCep(data.cep);
  for (const f of ['street', 'number', 'complement', 'district', 'city', 'ibge', 'notes']) if (data[f] !== undefined) o[f] = clean(data[f]);
  if (data.state !== undefined) {
    const st = clean(data.state);
    if (st && !UFS.includes(st.toUpperCase())) throw badRequest('Estado (UF) inválido.');
    o.state = st ? st.toUpperCase() : null;
  }
  if (data.is_primary !== undefined) o.is_primary = data.is_primary ? 1 : 0;
  return o;
}

function saveAddress(db, user, contactId, data, { system = false } = {}) {
  const c = system ? db.prepare('SELECT * FROM contacts WHERE id = ?').get(Number(contactId)) : loadContact(db, user, contactId, { write: true });
  const o = normalizeAddress(db, data);
  const now = nowIso();
  return tx(db, () => {
    const count = db.prepare('SELECT COUNT(*) AS n FROM addresses WHERE contact_id = ?').get(c.id).n;
    if (!data.id && count === 0) o.is_primary = 1;
    if (o.is_primary) db.prepare('UPDATE addresses SET is_primary = 0 WHERE contact_id = ?').run(c.id);
    let id;
    if (data.id) {
      const a = db.prepare('SELECT * FROM addresses WHERE id = ? AND contact_id = ?').get(Number(data.id), c.id);
      if (!a) throw notFound('Endereço não encontrado.');
      const keys = Object.keys(o);
      if (keys.length) db.prepare(`UPDATE addresses SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => o[k] ?? null), now, a.id);
      id = a.id;
      audit(db, system ? null : user, 'address', id, 'alterado', o, c.id);
    } else {
      const row = { type: 'residencial', ...o, contact_id: c.id, created_by: system ? null : user.id, created_at: now, updated_at: now };
      const cols = Object.keys(row);
      id = Number(db.prepare(`INSERT INTO addresses (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((k) => row[k] ?? null)).lastInsertRowid);
      audit(db, system ? null : user, 'address', id, 'criado', o, c.id);
    }
    syncPrimaryCity(db, c.id);
    return id;
  });
}

function deleteAddress(db, user, id) {
  const a = db.prepare('SELECT * FROM addresses WHERE id = ?').get(Number(id));
  if (!a) throw notFound('Endereço não encontrado.');
  loadContact(db, user, a.contact_id, { write: true });
  tx(db, () => {
    db.prepare('DELETE FROM addresses WHERE id = ?').run(a.id);
    if (a.is_primary) {
      const next = db.prepare('SELECT id FROM addresses WHERE contact_id = ? ORDER BY id LIMIT 1').get(a.contact_id);
      if (next) db.prepare('UPDATE addresses SET is_primary = 1 WHERE id = ?').run(next.id);
    }
    audit(db, user, 'address', a.id, 'removido', { cep: a.cep, logradouro: a.street }, a.contact_id);
  });
}

/* ------------------------- Sócios e representantes (PJ) ------------------------- */

function savePartner(db, user, contactId, data) {
  const c = loadContact(db, user, contactId, { write: true });
  if (c.kind !== 'PJ') throw badRequest('Sócios e representantes só se aplicam a pessoa jurídica.');
  const name = clean(data.name);
  if (!name) throw badRequest('Informe o nome.');
  const doc = digits(data.doc) || null;
  if (doc && !isValidCPF(doc)) throw badRequest('CPF inválido.');
  const relation = clean(data.relation) || 'socio';
  assertList(db, 'relacao_socio', relation, 'vínculo');
  const email = normalizeEmail(data.email);
  if (email && !isValidEmail(email)) throw badRequest('E-mail inválido.');
  const phone = clean(data.phone);
  if (phone && !normalizePhone(phone)) throw badRequest('Telefone inválido.');
  let share = data.share_pct === '' || data.share_pct == null ? null : Number(String(data.share_pct).replace(',', '.'));
  if (share != null && (!Number.isFinite(share) || share < 0 || share > 100)) throw badRequest('Participação deve estar entre 0 e 100%.');
  const row = { name, doc, relation, share_pct: share, email, phone: phone || null, is_legal_rep: data.is_legal_rep ? 1 : 0, active: data.active === false ? 0 : 1 };
  const now = nowIso();
  if (data.id) {
    const p = db.prepare('SELECT * FROM partners WHERE id = ? AND contact_id = ?').get(Number(data.id), c.id);
    if (!p) throw notFound('Registro não encontrado.');
    const keys = Object.keys(row);
    db.prepare(`UPDATE partners SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => row[k]), now, p.id);
    audit(db, user, 'partner', p.id, 'alterado', { nome: name }, c.id);
    return p.id;
  }
  const r = db
    .prepare('INSERT INTO partners (contact_id, name, doc, relation, share_pct, email, phone, is_legal_rep, active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(c.id, name, doc, relation, share, email, row.phone, row.is_legal_rep, row.active, user.id, now, now);
  audit(db, user, 'partner', Number(r.lastInsertRowid), 'criado', { nome: name }, c.id);
  return Number(r.lastInsertRowid);
}

/* ------------------------- Anexos ------------------------- */

const MAX_FILE = 8 * 1024 * 1024;
const ALLOWED_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'gif', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'odt', 'ods'];
const MIME_BY_EXT = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', txt: 'text/plain', csv: 'text/csv' };

/** Normaliza a lista de vendas (negócios) às quais o anexo se aplica; todas precisam ser do mesmo cadastro. */
function attachmentOpps(db, contactId, v) {
  if (v === undefined || v === null || v === '') return [];
  const ids = [...new Set((Array.isArray(v) ? v : String(v).split(',')).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  for (const id of ids) {
    if (!db.prepare('SELECT 1 FROM opportunities WHERE id = ? AND contact_id = ?').get(id, contactId)) throw badRequest('A venda vinculada ao anexo não pertence a este cadastro.');
  }
  return ids;
}

function setAttachmentOpps(db, attachmentId, ids) {
  db.prepare('DELETE FROM attachment_opportunities WHERE attachment_id = ?').run(attachmentId);
  const ins = db.prepare('INSERT OR IGNORE INTO attachment_opportunities (attachment_id, opportunity_id) VALUES (?, ?)');
  for (const id of ids) ins.run(attachmentId, id);
}

/**
 * Grava o arquivo. Enviado pela equipe: já entra aprovado. Enviado pelo cliente (link): entra como "recebido"
 * e aguarda a validação do vendedor.
 */
function insertAttachment(db, contactId, data, { userId = null, source = 'equipe' } = {}) {
  const filename = clean(data.filename);
  if (!filename) throw badRequest('Informe o arquivo.');
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) throw badRequest(`Tipo de arquivo não permitido (.${ext}). Envie PDF, imagem ou documento de escritório.`);
  const b64 = String(data.content_base64 || '').replace(/^data:[^,]*,/, '');
  if (!b64) throw badRequest('Arquivo vazio.');
  const content = Buffer.from(b64, 'base64');
  if (!content.length) throw badRequest('Arquivo vazio.');
  if (content.length > MAX_FILE) throw badRequest('Arquivo maior que 8 MB.');
  const docType = clean(data.doc_type) || 'outro';
  assertList(db, 'tipo_documento', docType, 'tipo de documento');
  const refs = {};
  for (const [f, table] of [['proposal_id', 'proposals'], ['contract_id', 'contracts'], ['finance_entry_id', 'finance_entries']]) {
    if (data[f]) {
      const ok = db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND contact_id = ?`).get(Number(data[f]), contactId);
      if (!ok) throw badRequest('Vínculo do anexo não pertence a este cadastro.');
      refs[f] = Number(data[f]);
    }
  }
  const opps = attachmentOpps(db, contactId, data.opportunity_ids);
  const team = source === 'equipe';
  const now = nowIso();
  const r = db
    .prepare(
      `INSERT INTO attachments (contact_id, proposal_id, contract_id, finance_entry_id, doc_type, filename, mime, size, content, status, valid_until, notes, source, uploaded_by, reviewed_by, reviewed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(contactId, refs.proposal_id ?? null, refs.contract_id ?? null, refs.finance_entry_id ?? null, docType, filename.slice(0, 200),
      MIME_BY_EXT[ext] || clean(data.mime) || 'application/octet-stream', content.length, content, team ? 'aprovado' : 'recebido',
      toDateOnly(data.valid_until) ?? null, clean(data.notes) ?? null, source, userId, team ? userId : null, team ? now : null, now);
  const id = Number(r.lastInsertRowid);
  setAttachmentOpps(db, id, opps);
  return id;
}

function uploadAttachment(db, user, contactId, data) {
  const c = loadContact(db, user, contactId, { write: true });
  if (c.anonymized_at) throw badRequest('Cadastro anonimizado.');
  return tx(db, () => {
    const id = insertAttachment(db, c.id, data, { userId: user.id });
    insertActivity(db, { contact_id: c.id, type: 'cadastro', notes: `Arquivo anexado: ${clean(data.filename)} (${optionLabel(db, 'tipo_documento', clean(data.doc_type) || 'outro')}).`, user_id: user.id, ref_type: 'attachment', ref_id: id });
    audit(db, user, 'attachment', id, 'anexado', { arquivo: clean(data.filename), tipo: clean(data.doc_type) || 'outro' }, c.id);
    return id;
  });
}

const ATTACH_META = 'id, contact_id, proposal_id, contract_id, finance_entry_id, doc_type, filename, mime, size, status, valid_until, notes, source, uploaded_by, reviewed_by, reviewed_at, created_at';

function listAttachments(db, contactId) {
  return db
    .prepare(`SELECT ${ATTACH_META.split(', ').map((c) => `a.${c}`).join(', ')}, u.name AS uploaded_by_name, r.name AS reviewed_by_name,
        (SELECT GROUP_CONCAT(opportunity_id) FROM attachment_opportunities ao WHERE ao.attachment_id = a.id) AS opp_ids
      FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by LEFT JOIN users r ON r.id = a.reviewed_by
      WHERE a.contact_id = ? AND a.status <> 'removido' ORDER BY a.created_at DESC`)
    .all(contactId)
    .map(({ opp_ids, ...a }) => ({ ...a, opportunity_ids: opp_ids ? String(opp_ids).split(',').map(Number) : [] }));
}

function getAttachment(db, user, id) {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(Number(id));
  if (!a || a.status === 'removido') throw notFound('Arquivo não encontrado.');
  loadContact(db, user, a.contact_id);
  audit(db, user, 'attachment', a.id, 'baixado', { arquivo: a.filename }, a.contact_id);
  return a;
}

function reviewAttachment(db, user, id, data) {
  const a = db.prepare(`SELECT ${ATTACH_META} FROM attachments WHERE id = ?`).get(Number(id));
  if (!a || a.status === 'removido') throw notFound('Arquivo não encontrado.');
  loadContact(db, user, a.contact_id, { write: true });
  const upd = {};
  if (data.status !== undefined) {
    if (!['pendente', 'recebido', 'aprovado', 'recusado', 'removido'].includes(data.status)) throw badRequest('Situação inválida.');
    if (data.status === 'removido' && !isManager(user)) throw badRequest('Apenas líderes de equipe e administradores removem arquivos.');
    upd.status = data.status;
    if (data.status === 'recusado' && !clean(data.notes)) throw badRequest('Informe o motivo da reprovação.');
    if (['aprovado', 'recusado'].includes(data.status)) {
      upd.reviewed_by = user.id;
      upd.reviewed_at = nowIso();
    }
  }
  if (data.doc_type !== undefined) {
    assertList(db, 'tipo_documento', data.doc_type, 'tipo de documento');
    upd.doc_type = data.doc_type;
  }
  if (data.valid_until !== undefined) upd.valid_until = toDateOnly(data.valid_until);
  if (data.notes !== undefined) upd.notes = clean(data.notes);
  const opps = data.opportunity_ids !== undefined ? attachmentOpps(db, a.contact_id, data.opportunity_ids) : null;
  const keys = Object.keys(upd);
  if (!keys.length && !opps) return;
  tx(db, () => {
    if (opps) setAttachmentOpps(db, a.id, opps);
    if (!keys.length) return;
    db.prepare(`UPDATE attachments SET ${keys.map((k) => `${k} = ?`).join(', ')}${upd.status === 'removido' ? ", content = X''" : ''} WHERE id = ?`).run(...keys.map((k) => upd[k] ?? null), a.id);
    audit(db, user, 'attachment', a.id, upd.status ? `situacao_${upd.status}` : 'alterado', { arquivo: a.filename, ...upd }, a.contact_id);
    if (a.source === 'cliente' && ['aprovado', 'recusado'].includes(upd.status)) {
      insertActivity(db, {
        contact_id: a.contact_id,
        type: 'cadastro',
        notes: `Documento enviado pelo cliente ${upd.status === 'aprovado' ? 'aprovado' : `reprovado${upd.notes ? ` (${upd.notes})` : ''}`}: ${a.filename}.`,
        user_id: user.id,
        ref_type: 'attachment',
        ref_id: a.id,
      });
    }
  });
}

/* ------------------------- Checklist obrigatório para a venda ------------------------- */

const SALE_FIELDS = {
  PF: [['name', 'Nome completo'], ['doc', 'CPF'], ['rg', 'RG'], ['phone1', 'Telefone 1'], ['email', 'E-mail'], ['birthplace', 'Naturalidade'],
    ['nationality', 'Nacionalidade'], ['sex', 'Sexo'], ['marital_status', 'Estado civil'], ['birth_date', 'Data de nascimento'],
    ['mother_name', 'Nome da mãe'], ['profession', 'Profissão'], ['income_range', 'Renda mensal']],
  PJ: [['legal_name', 'Razão social'], ['doc', 'CNPJ'], ['phone1', 'Telefone 1'], ['email', 'E-mail'], ['opening_date', 'Data de abertura'],
    ['main_activity', 'Atividade / CNAE'], ['revenue_range', 'Faturamento anual']],
};

function saleChecklist(db, contact) {
  const cfg = (getSetting(db, 'field_config') || {})[contact.kind === 'PJ' ? 'contact_pj' : 'contact_pf'] || {};
  const on = (f) => cfg[f]?.sale_required !== false && cfg[f]?.visible !== false;
  const items = [];
  const add = (key, label, group, ok, tab) => items.push({ key, label, group, ok: !!ok, tab });
  for (const [f, label] of SALE_FIELDS[contact.kind]) if (on(f)) add(f, label, 'Cadastro', contact[f], 'cadastro');
  if (contact.kind === 'PF') {
    const ms = contact.marital_status && db.prepare("SELECT flags FROM options WHERE list = 'estado_civil' AND value = ?").get(contact.marital_status);
    if (ms && JSON.parse(ms.flags || '{}').conjuge) {
      if (on('property_regime')) add('property_regime', 'Regime de bens', 'Cadastro', contact.property_regime, 'cadastro');
      if (on('spouse')) add('spouse', 'Dados do cônjuge (nome e CPF)', 'Relacionamentos', contact.spouse_name && contact.spouse_doc, 'relacionamentos');
    }
  } else if (on('legal_rep')) {
    const rep = db.prepare('SELECT 1 FROM partners WHERE contact_id = ? AND active = 1 AND is_legal_rep = 1').get(contact.id);
    add('legal_rep', 'Representante legal cadastrado', 'Relacionamentos', rep, 'relacionamentos');
  }
  if (on('address')) {
    const a = db.prepare('SELECT * FROM addresses WHERE contact_id = ? ORDER BY is_primary DESC, id LIMIT 1').get(contact.id);
    add('address', 'Endereço completo (CEP, logradouro, número, bairro, cidade, UF)', 'Endereço', a && a.cep && a.street && a.number && a.district && a.city && a.state, 'endereco');
  }
  const docs = (getSetting(db, 'doc_checklist') || {})[contact.kind] || [];
  const today = new Date().toISOString().slice(0, 10);
  for (const t of docs) {
    const rows = db.prepare("SELECT status, valid_until FROM attachments WHERE contact_id = ? AND doc_type = ? AND status IN ('recebido','aprovado','recusado') ORDER BY created_at DESC").all(contact.id, t);
    const valid = rows.find((r) => r.status === 'aprovado' && (!r.valid_until || r.valid_until >= today));
    let status = 'pendente';
    if (valid) status = 'aprovado';
    else if (rows.some((r) => r.status === 'recebido')) status = 'recebido';
    else if (rows.some((r) => r.status === 'aprovado')) status = 'vencido';
    else if (rows.length) status = 'recusado';
    items.push({ key: `doc:${t}`, label: optionLabel(db, 'tipo_documento', t), group: 'Documentos', ok: !!valid, tab: 'documentos', status, doc_type: t });
  }
  const missing = items.filter((i) => !i.ok);
  return { items, missing, complete: missing.length === 0 };
}

/* ------------------------- Link para o cliente atualizar os dados ------------------------- */

const EXTERNAL_FIELDS = {
  PF: ['name', 'doc', 'rg', 'phone1', 'phone2', 'whatsapp', 'email', 'birthplace', 'nationality', 'sex', 'marital_status', 'property_regime',
    'birth_date', 'mother_name', 'profession', 'income_range', 'spouse_name', 'spouse_doc', 'spouse_profession', 'spouse_income_range'],
  PJ: ['legal_name', 'trade_name', 'doc', 'state_registration', 'phone1', 'phone2', 'whatsapp', 'email', 'opening_date', 'main_activity', 'revenue_range', 'website'],
};
const PUBLIC_LISTS = ['sexo', 'estado_civil', 'regime_bens', 'faixa_renda', 'faixa_faturamento', 'tipo_documento', 'tipo_endereco', 'relacao_socio'];

/*
 * Só existe um link ativo por cadastro. Enquanto ele vale, o token fica guardado para a equipe poder copiá-lo de novo;
 * ao revogar ou expirar, o token é apagado e sobra apenas o hash (histórico de acessos).
 */
const LINK_COLS = `l.id, l.token, l.created_at, l.expires_at, l.first_used_at, l.last_used_at, l.access_count, l.submissions, l.revoked_at, l.revoke_reason,
  u.name AS created_by_name, r.name AS revoked_by_name`;

function clearExpiredTokens(db, contactId) {
  db.prepare('UPDATE client_links SET token = NULL WHERE contact_id = ? AND token IS NOT NULL AND expires_at <= ?').run(contactId, nowIso());
}

function activeClientLink(db, contactId) {
  clearExpiredTokens(db, contactId);
  return db
    .prepare(`SELECT ${LINK_COLS} FROM client_links l LEFT JOIN users u ON u.id = l.created_by LEFT JOIN users r ON r.id = l.revoked_by
      WHERE l.contact_id = ? AND l.revoked_at IS NULL AND l.expires_at > ? ORDER BY l.id DESC LIMIT 1`)
    .get(contactId, nowIso()) || null;
}

function clientLinkHistory(db, contactId) {
  const now = nowIso();
  return db
    .prepare(`SELECT ${LINK_COLS} FROM client_links l LEFT JOIN users u ON u.id = l.created_by LEFT JOIN users r ON r.id = l.revoked_by
      WHERE l.contact_id = ? ORDER BY l.id DESC LIMIT 20`)
    .all(contactId)
    .map(({ token, ...l }) => ({ ...l, status: l.revoked_at ? 'revogado' : l.expires_at <= now ? 'expirado' : 'ativo' }));
}

function createClientLink(db, user, contactId) {
  const c = loadContact(db, user, contactId, { write: true });
  if (c.anonymized_at) throw badRequest('Cadastro anonimizado.');
  if (c.active === 0) throw badRequest('Cadastro inativo: reative o cadastro para gerar o link.');
  if (activeClientLink(db, c.id)) throw new HttpError(409, 'Já existe um link de cadastro ativo. Copie o link atual ou revogue-o para gerar outro.');
  const days = Number(getSetting(db, 'client_link_days')) || 7;
  const token = randomToken(32);
  const expires = new Date(Date.now() + days * 86400000).toISOString();
  db.prepare('INSERT INTO client_links (token_hash, token, contact_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(sha256(token), token, c.id, user.id, nowIso(), expires);
  insertActivity(db, { contact_id: c.id, type: 'cadastro', notes: `Link de cadastro para o cliente gerado por ${user.name} (válido até ${new Date(expires).toLocaleDateString('pt-BR')}).`, user_id: user.id });
  audit(db, user, 'client_link', null, 'criado', { expira_em: expires }, c.id);
  return { token, expires_at: expires };
}

function revokeClientLinks(db, user, contactId, data = {}) {
  const c = loadContact(db, user, contactId, { write: true });
  const reason = clean(data.reason) || null;
  const n = db.prepare('UPDATE client_links SET revoked_at = ?, revoked_by = ?, revoke_reason = ?, token = NULL WHERE contact_id = ? AND revoked_at IS NULL').run(nowIso(), user.id, reason, c.id).changes;
  if (n) insertActivity(db, { contact_id: c.id, type: 'cadastro', notes: `Link de cadastro revogado por ${user.name}${reason ? `: ${reason}` : ''}.`, user_id: user.id });
  audit(db, user, 'client_link', null, 'revogados', { quantidade: n, motivo: reason }, c.id);
  return n;
}

function resolveClientLink(db, token) {
  if (!token || typeof token !== 'string') throw new HttpError(401, 'Link inválido.');
  const link = db.prepare('SELECT * FROM client_links WHERE token_hash = ?').get(sha256(token));
  if (!link || link.revoked_at) throw new HttpError(401, 'Este link não é mais válido. Peça um novo ao seu consultor.');
  if (Date.parse(link.expires_at) < Date.now()) throw new HttpError(401, 'Este link expirou. Peça um novo ao seu consultor.');
  const c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(link.contact_id);
  if (!c || c.anonymized_at || c.merged_into_id || c.active === 0) throw new HttpError(410, 'Cadastro indisponível. Fale com seu consultor.');
  return { link, contact: c };
}

function publicForm(db, token) {
  const { link, contact } = resolveClientLink(db, token);
  const now = nowIso();
  // Conta como novo acesso só depois de 30 minutos sem atividade (recarregar a página não infla a contagem)
  const newVisit = !link.last_used_at || Date.parse(now) - Date.parse(link.last_used_at) > 30 * 60000;
  db.prepare('UPDATE client_links SET last_used_at = ?, first_used_at = COALESCE(first_used_at, ?), access_count = access_count + ? WHERE id = ?').run(now, now, newVisit ? 1 : 0, link.id);
  if (!link.first_used_at) insertActivity(db, { contact_id: contact.id, type: 'cadastro', notes: 'O cliente abriu o link de cadastro pela primeira vez.', source: 'cliente' });
  require('./sales').onClientLink(db, link.id, 'access');
  const values = {};
  for (const f of EXTERNAL_FIELDS[contact.kind]) values[f] = contact[f] ?? null;
  const address = db.prepare('SELECT cep, street, number, complement, district, city, state, notes FROM addresses WHERE contact_id = ? ORDER BY is_primary DESC, id LIMIT 1').get(contact.id) || null;
  const options = {};
  for (const l of PUBLIC_LISTS) options[l] = db.prepare('SELECT value, label, flags FROM options WHERE list = ? AND active = 1 ORDER BY position').all(l).map((o) => ({ ...o, flags: JSON.parse(o.flags || '{}') }));
  const check = saleChecklist(db, contact);
  const owner = contact.owner_id ? db.prepare('SELECT name FROM users WHERE id = ?').get(contact.owner_id) : null;
  return {
    kind: contact.kind,
    code: contact.code,
    values,
    address,
    partners: contact.kind === 'PJ' ? db.prepare('SELECT name, relation, is_legal_rep FROM partners WHERE contact_id = ? AND active = 1').all(contact.id) : [],
    documents: check.items.filter((i) => i.group === 'Documentos').map((i) => ({ type: i.key.slice(4), label: i.label, status: i.status })),
    options,
    consultant: owner?.name || null,
    company: getSetting(db, 'company_name') || '',
    completed: !!db.prepare("SELECT 1 FROM pre_sales WHERE client_link_id = ? AND completed_at IS NOT NULL").get(link.id),
    expires_at: link.expires_at,
  };
}

function notifyOwner(db, contact, text) {
  const exists = db.prepare("SELECT 1 FROM tasks WHERE contact_id = ? AND status = 'pendente' AND title = ?").get(contact.id, text);
  if (exists) return;
  const now = nowIso();
  db.prepare("INSERT INTO tasks (contact_id, type, title, due_at, assigned_to, created_at, updated_at) VALUES (?, 'outra', ?, ?, ?, ?, ?)").run(
    contact.id, text, new Date(Date.now() + 86400000).toISOString(), contact.owner_id, now, now,
  );
}

function publicSubmit(db, token, body) {
  const { link, contact } = resolveClientLink(db, token);
  const { updateContact } = require('./contacts');
  const system = { id: null, role: 'admin', name: 'Cliente (link)' };
  const data = {};
  for (const f of EXTERNAL_FIELDS[contact.kind]) if (body.values && body.values[f] !== undefined) data[f] = body.values[f];
  if (contact.kind === 'PJ' && data.legal_name) data.name = contact.name; // o nome de exibição continua o mesmo
  return tx(db, () => {
    let changed = false;
    try {
      changed = updateContact(db, system, contact.id, data).changed;
    } catch (e) {
      if (e.status === 409) throw new HttpError(409, 'Algum dado informado (CPF/CNPJ, telefone ou e-mail) já consta em outro cadastro. Fale com seu consultor.');
      throw e;
    }
    if (body.address && typeof body.address === 'object') {
      const cur = db.prepare('SELECT id FROM addresses WHERE contact_id = ? ORDER BY is_primary DESC, id LIMIT 1').get(contact.id);
      const a = {};
      for (const f of ['cep', 'street', 'number', 'complement', 'district', 'city', 'state', 'notes']) if (body.address[f] !== undefined) a[f] = body.address[f];
      if (Object.values(a).some((v) => clean(v))) {
        saveAddress(db, system, contact.id, cur ? { ...a, id: cur.id } : { ...a, is_primary: true }, { system: true });
        changed = true;
      }
    }
    db.prepare('UPDATE client_links SET submissions = submissions + 1, last_used_at = ? WHERE id = ?').run(nowIso(), link.id);
    if (changed) {
      insertActivity(db, { contact_id: contact.id, type: 'cadastro', notes: 'O cliente atualizou os próprios dados pelo link.', source: 'cliente' });
      notifyOwner(db, contact, 'Conferir dados atualizados pelo cliente');
    }
    return { ok: true, changed };
  });
}

function publicUpload(db, token, body) {
  const { contact } = resolveClientLink(db, token);
  return tx(db, () => {
    const id = insertAttachment(db, contact.id, { ...body, proposal_id: undefined, contract_id: undefined, finance_entry_id: undefined }, { source: 'cliente' });
    insertActivity(db, { contact_id: contact.id, type: 'cadastro', notes: `O cliente enviou um arquivo pelo link: ${clean(body.filename)} (${optionLabel(db, 'tipo_documento', clean(body.doc_type) || 'outro')}).`, source: 'cliente', ref_type: 'attachment', ref_id: id });
    audit(db, null, 'attachment', id, 'enviado_pelo_cliente', { arquivo: clean(body.filename) }, contact.id);
    notifyOwner(db, contact, 'Conferir documentos enviados pelo cliente');
    require('./notifications').notify(db, contact.owner_id, { kind: 'documento', title: `${contact.name} enviou um documento pelo link`, body: `${optionLabel(db, 'tipo_documento', body.doc_type) || 'Documento'}: confira e aprove ou reprove.`, link: `#/leads/${contact.id}/documentos`, dedupe: true });
    return { ok: true };
  });
}

/**
 * O cliente conclui o cadastro: dados obrigatórios preenchidos e documentos enviados (a validação dos documentos
 * continua com a equipe). Atualiza a pré-venda para "Concluído pelo cliente".
 */
function publicComplete(db, token) {
  const { link, contact } = resolveClientLink(db, token);
  const check = saleChecklist(db, contact);
  const missing = check.items.filter((i) => (i.group === 'Documentos' ? !['recebido', 'aprovado'].includes(i.status) : !i.ok));
  if (missing.length) throw badRequest(`Ainda falta: ${missing.map((m) => m.label).join('; ')}.`, { missing });
  return tx(db, () => {
    db.prepare('UPDATE client_links SET submissions = submissions + 1, last_used_at = ? WHERE id = ?').run(nowIso(), link.id);
    insertActivity(db, { contact_id: contact.id, type: 'cadastro', notes: 'O cliente concluiu o cadastro pelo link e enviou os documentos para conferência.', source: 'cliente' });
    require('./sales').onClientLink(db, link.id, 'complete');
    return { ok: true };
  });
}

async function publicCep(db, token, cep) {
  resolveClientLink(db, token);
  return lookupCep(cep);
}

/* ------------------------- Pós-venda ------------------------- */

function postSaleItems(db, contactId) {
  const items = db.prepare("SELECT value, label FROM options WHERE list = 'etapa_pos_venda' AND active = 1 ORDER BY position").all();
  const done = db.prepare('SELECT p.*, u.name AS done_by_name FROM post_sale_items p LEFT JOIN users u ON u.id = p.done_by WHERE p.contact_id = ? AND p.contract_id IS NULL').all(contactId);
  return items.map((i) => {
    const d = done.find((x) => x.item === i.value);
    return { item: i.value, label: i.label, done_at: d?.done_at || null, done_by_name: d?.done_by_name || null, notes: d?.notes || null };
  });
}

function togglePostSale(db, user, contactId, data) {
  const c = loadContact(db, user, contactId, { write: true });
  const item = clean(data.item);
  assertList(db, 'etapa_pos_venda', item, 'etapa de pós-venda');
  const done = !!data.done;
  tx(db, () => {
    const cur = db.prepare('SELECT id FROM post_sale_items WHERE contact_id = ? AND contract_id IS NULL AND item = ?').get(c.id, item);
    if (cur) db.prepare('UPDATE post_sale_items SET done_at = ?, done_by = ?, notes = ? WHERE id = ?').run(done ? nowIso() : null, done ? user.id : null, clean(data.notes) ?? null, cur.id);
    else db.prepare('INSERT INTO post_sale_items (contact_id, item, done_at, done_by, notes) VALUES (?, ?, ?, ?, ?)').run(c.id, item, done ? nowIso() : null, done ? user.id : null, clean(data.notes) ?? null);
    if (done) insertActivity(db, { contact_id: c.id, type: 'observacao', notes: `Pós-venda: ${optionLabel(db, 'etapa_pos_venda', item)}.${data.notes ? ` ${clean(data.notes)}` : ''}`, user_id: user.id });
    audit(db, user, 'post_sale', null, done ? 'concluido' : 'reaberto', { item }, c.id);
  });
}

function markPostSale(db, userId, contactId, item, notes) {
  if (!db.prepare("SELECT 1 FROM options WHERE list = 'etapa_pos_venda' AND value = ? AND active = 1").get(item)) return;
  const cur = db.prepare('SELECT id, done_at FROM post_sale_items WHERE contact_id = ? AND contract_id IS NULL AND item = ?').get(contactId, item);
  if (cur?.done_at) return;
  if (cur) db.prepare('UPDATE post_sale_items SET done_at = ?, done_by = ?, notes = ? WHERE id = ?').run(nowIso(), userId, notes, cur.id);
  else db.prepare('INSERT INTO post_sale_items (contact_id, item, done_at, done_by, notes) VALUES (?, ?, ?, ?, ?)').run(contactId, item, nowIso(), userId, notes);
}

/* ------------------------- Pesquisa de satisfação (NPS) por link ------------------------- */

// Perguntas complementares (nota de 1 a 5). A pergunta principal é a nota NPS de 0 a 10.
const NPS_QUESTIONS = [
  ['atendimento', 'Como você avalia o atendimento do seu consultor?'],
  ['clareza', 'As informações sobre o consórcio foram claras na contratação?'],
  ['agilidade', 'Como você avalia a agilidade do processo de contratação?'],
  ['confianca', 'Qual é o seu nível de confiança na empresa para cuidar do seu planejamento?'],
];

function npsStatus(r, now = nowIso()) {
  if (r.cancelled_at) return 'cancelada';
  if (r.answered_at) return 'respondida';
  if (r.expires_at <= now) return 'expirada';
  return 'pendente';
}

function listNps(db, contactId) {
  const now = nowIso();
  return db
    .prepare(`SELECT n.*, u.name AS created_by_name, x.name AS cancelled_by_name, k.code AS contract_code FROM nps_surveys n
      LEFT JOIN users u ON u.id = n.created_by LEFT JOIN users x ON x.id = n.cancelled_by LEFT JOIN contracts k ON k.id = n.contract_id
      WHERE n.contact_id = ? ORDER BY n.id DESC`)
    .all(contactId)
    .map(({ token_hash, ...r }) => {
      const status = npsStatus(r, now);
      return { ...r, token: status === 'pendente' ? r.token : null, answers: r.answers ? JSON.parse(r.answers) : null, status };
    });
}

function createNps(db, user, contactId, data = {}) {
  const c = loadContact(db, user, contactId, { write: true });
  if (c.anonymized_at) throw badRequest('Cadastro anonimizado.');
  if (c.active === 0) throw badRequest('Cadastro inativo: reative o cadastro para enviar a pesquisa.');
  if (listNps(db, c.id).some((n) => n.status === 'pendente')) throw new HttpError(409, 'Já existe uma pesquisa aguardando resposta. Copie o link atual ou cancele-a (com justificativa) para gerar outra.');
  let contractId = null;
  if (data.contract_id) {
    const k = db.prepare('SELECT id FROM contracts WHERE id = ? AND contact_id = ?').get(Number(data.contract_id), c.id);
    if (!k) throw badRequest('Produto contratado não pertence a este cadastro.');
    contractId = k.id;
  }
  const days = Number(getSetting(db, 'nps_link_days')) || 15;
  const token = randomToken(32);
  const now = nowIso();
  const expires = new Date(Date.now() + days * 86400000).toISOString();
  const { nextCode } = require('../db');
  return tx(db, () => {
    const code = nextCode(db, 'nps', 'NPS');
    const r = db.prepare('INSERT INTO nps_surveys (code, contact_id, contract_id, token_hash, token, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(code, c.id, contractId, sha256(token), token, user.id, now, expires);
    insertActivity(db, { contact_id: c.id, type: 'pos_venda', notes: `Pesquisa de satisfação ${code} gerada por ${user.name} (válida até ${new Date(expires).toLocaleDateString('pt-BR')}).`, user_id: user.id });
    audit(db, user, 'nps', Number(r.lastInsertRowid), 'criada', { code, expira_em: expires }, c.id);
    return { id: Number(r.lastInsertRowid), code, token, expires_at: expires };
  });
}

/** Pesquisas nunca são excluídas: apenas canceladas, sempre com justificativa. */
function cancelNps(db, user, id, data = {}) {
  const n = db.prepare('SELECT * FROM nps_surveys WHERE id = ?').get(Number(id));
  if (!n) throw notFound('Pesquisa não encontrada.');
  loadContact(db, user, n.contact_id, { write: true });
  if (n.answered_at) throw badRequest('Pesquisa já respondida não pode ser cancelada.');
  if (n.cancelled_at) throw badRequest('Pesquisa já cancelada.');
  const reason = clean(data.reason);
  if (!reason) throw badRequest('Informe a justificativa do cancelamento.');
  tx(db, () => {
    db.prepare('UPDATE nps_surveys SET cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, token = NULL WHERE id = ?').run(nowIso(), user.id, reason, n.id);
    insertActivity(db, { contact_id: n.contact_id, type: 'pos_venda', notes: `Pesquisa de satisfação ${n.code} cancelada por ${user.name}: ${reason}`, user_id: user.id });
    audit(db, user, 'nps', n.id, 'cancelada', { motivo: reason }, n.contact_id);
  });
}

function resolveNps(db, token) {
  if (!token || typeof token !== 'string') throw new HttpError(401, 'Link inválido.');
  const n = db.prepare('SELECT * FROM nps_surveys WHERE token_hash = ?').get(sha256(token));
  if (!n) throw new HttpError(401, 'Link inválido.');
  const c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(n.contact_id);
  if (!c || c.anonymized_at || c.merged_into_id) throw new HttpError(410, 'Pesquisa indisponível.');
  return { survey: n, contact: c };
}

function publicNpsForm(db, token) {
  const { survey, contact } = resolveNps(db, token);
  const status = npsStatus(survey);
  if (status === 'pendente') {
    const now = nowIso();
    db.prepare('UPDATE nps_surveys SET first_access_at = COALESCE(first_access_at, ?), last_access_at = ? WHERE id = ?').run(now, now, survey.id);
  }
  const owner = contact.owner_id ? db.prepare('SELECT name FROM users WHERE id = ?').get(contact.owner_id) : null;
  return {
    status,
    company: getSetting(db, 'company_name') || '',
    first_name: String(contact.kind === 'PJ' ? contact.trade_name || contact.name : contact.name).split(/\s+/)[0],
    consultant: owner?.name || null,
    questions: NPS_QUESTIONS.map(([key, label]) => ({ key, label })),
    reasons: db.prepare("SELECT value, label FROM options WHERE list = 'motivo_insatisfacao' AND active = 1 ORDER BY position").all(),
    expires_at: survey.expires_at,
  };
}

function publicNpsSubmit(db, token, body = {}) {
  const { survey, contact } = resolveNps(db, token);
  const status = npsStatus(survey);
  if (status === 'respondida') throw badRequest('Esta pesquisa já foi respondida. Obrigado!');
  if (status !== 'pendente') throw new HttpError(410, status === 'expirada' ? 'Esta pesquisa expirou.' : 'Esta pesquisa foi cancelada.');
  const score = Number(body.score);
  if (body.score === '' || body.score == null || !Number.isInteger(score) || score < 0 || score > 10) throw badRequest('Escolha uma nota de 0 a 10.');
  const answers = {};
  for (const [key] of NPS_QUESTIONS) {
    const v = body.answers?.[key];
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw badRequest('As avaliações complementares vão de 1 a 5.');
    answers[key] = n;
  }
  const comment = clean(body.comment) ? clean(body.comment).slice(0, 2000) : null;
  const reason = clean(body.reason);
  if (reason && !db.prepare("SELECT 1 FROM options WHERE list = 'motivo_insatisfacao' AND value = ?").get(reason)) throw badRequest('Motivo inválido.');
  const now = nowIso();
  const category = score >= 9 ? 'promotor' : score >= 7 ? 'neutro' : 'detrator';
  return tx(db, () => {
    db.prepare('UPDATE nps_surveys SET answered_at = ?, score = ?, answers = ?, comment = ?, dissatisfaction_reason = ?, token = NULL WHERE id = ?').run(now, score, JSON.stringify(answers), comment, score <= 8 ? reason ?? null : null, survey.id);
    db.prepare('UPDATE contacts SET nps_score = ?, nps_comment = ?, nps_at = ? WHERE id = ?').run(score, comment, now, contact.id);
    insertActivity(db, { contact_id: contact.id, type: 'pos_venda', notes: `Pesquisa de satisfação ${survey.code} respondida: nota ${score} (${category}).${comment ? ` Comentário: ${comment}` : ''}`, source: 'cliente' });
    audit(db, null, 'nps', survey.id, 'respondida', { nota: score }, contact.id);
    const responsible = contact.postsale_owner_id || contact.owner_id;
    if (category === 'detrator') {
      const t = nowIso();
      db.prepare("INSERT INTO tasks (contact_id, type, title, due_at, assigned_to, priority, created_at, updated_at) VALUES (?, 'pos_venda', ?, ?, ?, 'urgente', ?, ?)").run(
        contact.id, `Tratar avaliação NPS ${survey.code} (nota ${score})`, new Date(Date.now() + 86400000).toISOString(), responsible, t, t,
      );
    }
    const why = reason ? ` Motivo: ${optionLabel(db, 'motivo_insatisfacao', reason)}.` : '';
    require('./notifications').notify(db, [responsible, contact.owner_id], {
      kind: 'nps',
      level: category === 'detrator' ? 'danger' : category === 'neutro' ? 'warn' : 'ok',
      title: `${contact.name} respondeu a pesquisa de satisfação: nota ${score}`,
      body: category === 'detrator' ? `Cliente insatisfeito (detrator).${why} Trate em até 24 h.` : category === 'neutro' ? `Cliente neutro.${why}` : 'Cliente promotor: bom momento para pedir indicações.',
      link: '#/posvenda?aba=nps',
    });
    return { ok: true };
  });
}

/* ------------------------- Estratégia de lance por produto contratado ------------------------- */

const BID_TYPES = { embutido: 'Embutido', fixo: 'Fixo', livre: 'Livre' };

function bidHistory(db, contractId) {
  return db
    .prepare('SELECT h.*, u.name AS created_by_name FROM bid_strategy_history h LEFT JOIN users u ON u.id = h.created_by WHERE h.contract_id = ? ORDER BY h.created_at DESC, h.id DESC')
    .all(contractId);
}

function listBidStrategies(db, contactId) {
  return db
    .prepare(`SELECT b.*, u.name AS updated_by_name FROM bid_strategies b LEFT JOIN users u ON u.id = b.updated_by WHERE b.contact_id = ?`)
    .all(contactId)
    .map((b) => ({ ...b, history: bidHistory(db, b.contract_id) }));
}

function saveBidStrategy(db, user, contractId, data) {
  const k = db.prepare('SELECT * FROM contracts WHERE id = ?').get(Number(contractId));
  if (!k) throw notFound('Produto contratado não encontrado.');
  const c = loadContact(db, user, k.contact_id, { write: true });
  const willBid = data.will_bid === true || data.will_bid === 'sim' || data.will_bid === '1' || data.will_bid === 1;
  const row = { will_bid: willBid ? 1 : 0, bid_type: null, bid_pct: null, use_embedded: 0, use_fgts: 0, notes: clean(data.notes) ?? null };
  if (willBid) {
    const t = clean(data.bid_type);
    if (!BID_TYPES[t]) throw badRequest('Escolha o tipo de lance: embutido, fixo ou livre.');
    row.bid_type = t;
    if (t === 'livre') {
      const pct = Number(String(data.bid_pct ?? '').replace(',', '.'));
      if (data.bid_pct === '' || data.bid_pct == null || !Number.isFinite(pct) || pct <= 0 || pct > 100) throw badRequest('Informe o percentual do lance livre (entre 0 e 100%).');
      row.bid_pct = pct;
      row.use_embedded = data.use_embedded ? 1 : 0;
      row.use_fgts = data.use_fgts ? 1 : 0;
    }
  }
  const now = nowIso();
  return tx(db, () => {
    const cur = db.prepare('SELECT id FROM bid_strategies WHERE contract_id = ?').get(k.id);
    if (cur) {
      db.prepare('UPDATE bid_strategies SET will_bid = ?, bid_type = ?, bid_pct = ?, use_embedded = ?, use_fgts = ?, notes = ?, updated_by = ?, updated_at = ? WHERE id = ?')
        .run(row.will_bid, row.bid_type, row.bid_pct, row.use_embedded, row.use_fgts, row.notes, user.id, now, cur.id);
    } else {
      db.prepare('INSERT INTO bid_strategies (contract_id, contact_id, will_bid, bid_type, bid_pct, use_embedded, use_fgts, notes, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(k.id, c.id, row.will_bid, row.bid_type, row.bid_pct, row.use_embedded, row.use_fgts, row.notes, user.id, now);
    }
    const desc = !willBid ? 'sem lance' : `lance ${BID_TYPES[row.bid_type].toLowerCase()}${row.bid_type === 'livre' ? ` de ${row.bid_pct}%${row.use_embedded ? ', usando embutido' : ''}${row.use_fgts ? ', usando FGTS' : ''}` : ''}`;
    insertActivity(db, { contact_id: c.id, type: 'pos_venda', notes: `Estratégia de lance do ${k.code}: ${desc}.`, user_id: user.id });
    audit(db, user, 'bid_strategy', k.id, cur ? 'alterada' : 'registrada', row, c.id);
    // Histórico: cada cadastro ou alteração fica registrado com quem fez, data e hora
    db.prepare('INSERT INTO bid_strategy_history (contract_id, contact_id, will_bid, bid_type, bid_pct, use_embedded, use_fgts, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(k.id, c.id, row.will_bid, row.bid_type, row.bid_pct, row.use_embedded, row.use_fgts, row.notes, user.id, now);
    markPostSale(db, user.id, c.id, 'estrategia_lance', `Registrada para ${k.code}.`);
  });
}

/* ------------------------- Proposta: abrir o simulador com os dados do cliente ------------------------- */

function proposalSimulatorLink(db, user, contactId, data = {}) {
  const c = loadContact(db, user, contactId, { write: true });
  if (c.anonymized_at) throw badRequest('Cadastro anonimizado.');
  const base = getSetting(db, 'proposal_simulator_url');
  if (!base) throw new HttpError(409, 'Endereço do simulador de propostas não configurado (Configurações › Geral).');
  const name = c.kind === 'PJ' ? c.legal_name || c.name : c.name;
  const phone = c.whatsapp || c.phone1 || c.phone2 || '';
  const params = new URLSearchParams({ nome: name || '', contato: phone, origem: 'crm', cadastro: c.code, modo: 'proposta' });
  if (data.proposal_code) params.set('proposta', data.proposal_code);
  const url = `${base.split('#')[0]}${base.includes('?') ? '&' : '?'}${params}#${params}`;
  let oppId = null;
  if (data.opportunity_id) {
    const o = db.prepare('SELECT id FROM opportunities WHERE id = ? AND contact_id = ?').get(Number(data.opportunity_id), c.id);
    if (o) oppId = o.id;
  }
  insertActivity(db, { contact_id: c.id, opportunity_id: oppId, type: 'proposta', notes: `Simulador aberto por ${user.name} para gerar proposta.`, user_id: user.id });
  return { url, name, phone };
}

module.exports = {
  lookupCep, saveAddress, deleteAddress, savePartner, uploadAttachment, listAttachments, getAttachment, reviewAttachment,
  saleChecklist, createClientLink, revokeClientLinks, activeClientLink, clientLinkHistory, publicForm, publicSubmit, publicUpload, publicCep, publicComplete, insertAttachment,
  postSaleItems, togglePostSale, markPostSale, bidHistory, BID_TYPES, NPS_QUESTIONS, npsStatus, listNps, createNps, cancelNps, publicNpsForm, publicNpsSubmit, listBidStrategies, saveBidStrategy,
  proposalSimulatorLink, EXTERNAL_FIELDS,
};
