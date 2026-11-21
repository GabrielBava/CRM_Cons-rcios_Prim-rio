'use strict';
/**
 * Recomendações (indicações) do lead: aba Recomendações do painel lateral.
 *  - Linhas com nome, telefone, WhatsApp, e-mail e quem recomendou (5 ou mais).
 *  - Vindas do diagnóstico financeiro (Vero Planejamento): as indicações do cliente entram automaticamente, com
 *    "quem recomendou" = o nome do cliente.
 *  - "+" cadastra a indicação como lead no pipeline do usuário (cadastro com a indicação); a linha fica verde com o
 *    lead criado, o novo lead guarda quem indicou e o responsável é avisado.
 */
const { audit, loadContact } = require('../core');
const { insertActivity } = require('./activities');
const { badRequest, notFound, conflict, clean: cleanRaw, nowIso, normalizeEmail, normalizePhone, isValidEmail } = require('../util');

const clean = (v) => cleanRaw(v) ?? null;
const MAX_ROWS = 30;

function rowsOf(db, contactId) {
  return db.prepare(`SELECT r.*, l.code AS lead_code, l.name AS lead_name, u.name AS registered_by_name
    FROM referrals r LEFT JOIN contacts l ON l.id = r.lead_contact_id LEFT JOIN users u ON u.id = r.registered_by
    WHERE r.contact_id = ? AND r.removed_at IS NULL ORDER BY r.position, r.id`).all(contactId);
}

/** Separa "contato" livre do diagnóstico em telefone ou e-mail. */
function splitContact(v) {
  const s = String(v || '').trim();
  if (!s) return {};
  if (/@/.test(s)) return { email: s };
  return { phone: s, whatsapp: s };
}

/** Indicações do diagnóstico financeiro mais recente que ainda não estão na lista. */
function importFromDiagnostic(db, user, c) {
  const d = db.prepare('SELECT data FROM diagnostics WHERE contact_id = ? AND data IS NOT NULL ORDER BY id DESC LIMIT 1').get(c.id);
  if (!d) return 0;
  let data;
  try {
    data = JSON.parse(d.data);
  } catch {
    return 0;
  }
  const items = (Array.isArray(data.recomendacoes) ? data.recomendacoes : []).filter((x) => x && (x.nome || x.name));
  if (!items.length) return 0;
  // Inclui as removidas: o que o usuário apagou da lista não volta na próxima abertura
  const known = new Set(db.prepare('SELECT name FROM referrals WHERE contact_id = ?').all(c.id).map((r) => String(r.name || '').trim().toLowerCase()));
  let pos = rowsOf(db, c.id).length;
  let n = 0;
  const now = nowIso();
  for (const x of items) {
    const name = clean(x.nome || x.name);
    if (!name || known.has(name.toLowerCase())) continue;
    const ct = splitContact(x.contato);
    db.prepare(`INSERT INTO referrals (contact_id, name, phone, whatsapp, email, recommended_by, source, position, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'diagnostico', ?, ?, ?, ?)`)
      .run(c.id, name, clean(x.telefone) || ct.phone || null, clean(x.whatsapp) || ct.whatsapp || null, clean(x.email) || ct.email || null,
        clean(x.quemRecomendou || x.quem_recomendou) || c.name, pos++, user.id, now, now);
    known.add(name.toLowerCase());
    n++;
  }
  return n;
}

function listReferrals(db, user, contactId) {
  const c = loadContact(db, user, contactId);
  const imported = importFromDiagnostic(db, user, c);
  const rows = rowsOf(db, c.id);
  return { rows, imported, registered: rows.filter((r) => r.lead_contact_id).length, contact: { id: c.id, name: c.name } };
}

function validRow(r) {
  const out = {
    name: clean(r.name), phone: clean(r.phone), whatsapp: clean(r.whatsapp), email: clean(r.email), recommended_by: clean(r.recommended_by), notes: clean(r.notes),
  };
  if (out.email && !isValidEmail(normalizeEmail(out.email) || '')) throw badRequest(`E-mail inválido na recomendação "${out.name || out.email}".`);
  for (const f of ['phone', 'whatsapp']) if (out[f] && !normalizePhone(out[f])) throw badRequest(`Telefone inválido na recomendação "${out.name || out[f]}".`);
  return out;
}

/**
 * Salva a lista (linhas com id são atualizadas, sem id são criadas). Linhas vazias são ignoradas; linhas removidas da
 * lista são apagadas, exceto as que já viraram lead.
 */
function saveReferrals(db, user, contactId, data = {}) {
  const c = loadContact(db, user, contactId, { write: true });
  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (rows.length > MAX_ROWS) throw badRequest(`Até ${MAX_ROWS} recomendações por lead.`);
  const now = nowIso();
  const keep = new Set();
  let pos = 0;
  for (const r of rows) {
    const v = validRow(r);
    if (!v.name && !v.phone && !v.whatsapp && !v.email) continue;
    if (!v.name) throw badRequest('Informe o nome de cada recomendação.');
    if (r.id) {
      const old = db.prepare('SELECT id FROM referrals WHERE id = ? AND contact_id = ? AND removed_at IS NULL').get(Number(r.id), c.id);
      if (!old) throw notFound('Recomendação não encontrada.');
      db.prepare('UPDATE referrals SET name = ?, phone = ?, whatsapp = ?, email = ?, recommended_by = ?, notes = ?, position = ?, updated_at = ? WHERE id = ?')
        .run(v.name, v.phone, v.whatsapp, v.email, v.recommended_by || c.name, v.notes, pos++, now, old.id);
      keep.add(old.id);
    } else {
      const id = Number(db.prepare(`INSERT INTO referrals (contact_id, name, phone, whatsapp, email, recommended_by, notes, source, position, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?)`).run(c.id, v.name, v.phone, v.whatsapp, v.email, v.recommended_by || c.name, v.notes, pos++, user.id, now, now).lastInsertRowid);
      keep.add(id);
    }
  }
  for (const r of db.prepare('SELECT id, lead_contact_id, source FROM referrals WHERE contact_id = ? AND removed_at IS NULL').all(c.id)) {
    if (keep.has(r.id) || r.lead_contact_id) continue;
    // As vindas do diagnóstico ficam marcadas como removidas (para não serem importadas de novo)
    if (r.source === 'diagnostico') db.prepare('UPDATE referrals SET removed_at = ?, updated_at = ? WHERE id = ?').run(now, now, r.id);
    else db.prepare('DELETE FROM referrals WHERE id = ?').run(r.id);
  }
  audit(db, user, 'contact', c.id, 'recomendacoes_salvas', { quantidade: keep.size }, c.id);
  return listReferrals(db, user, c.id);
}

/**
 * Depois do cadastro do lead indicado: liga a recomendação ao novo lead, guarda quem indicou e avisa o responsável.
 * Chamado pelo cadastro de contato quando vem com referral_id.
 */
function markRegistered(db, user, referralId, newContactId, note) {
  const r = db.prepare('SELECT * FROM referrals WHERE id = ? AND removed_at IS NULL').get(Number(referralId));
  if (!r) return null;
  if (r.lead_contact_id) throw conflict('Esta indicação já foi cadastrada no CRM.');
  const origin = db.prepare('SELECT id, name, code, owner_id FROM contacts WHERE id = ?').get(r.contact_id);
  const lead = db.prepare('SELECT id, name, owner_id FROM contacts WHERE id = ?').get(newContactId);
  const now = nowIso();
  db.prepare('UPDATE referrals SET lead_contact_id = ?, registered_at = ?, registered_by = ?, updated_at = ? WHERE id = ?').run(newContactId, now, user.id, now, r.id);
  db.prepare('UPDATE contacts SET referred_by_id = COALESCE(referred_by_id, ?) WHERE id = ?').run(origin.id, newContactId);
  insertActivity(db, { contact_id: newContactId, type: 'observacao', notes: `Indicação de ${origin.name} (${origin.code})${r.recommended_by && r.recommended_by !== origin.name ? ` · recomendado por ${r.recommended_by}` : ''}.${note ? ` ${note}` : ''}`, user_id: user.id });
  insertActivity(db, { contact_id: origin.id, type: 'observacao', notes: `Indicação cadastrada no CRM: ${lead.name}.`, user_id: user.id });
  const notify = require('./notifications');
  const to = new Set([lead.owner_id, origin.owner_id].filter(Boolean));
  for (const uid of to) {
    try {
      notify.notify(db, uid, { kind: 'indicacao', title: `Nova indicação: ${lead.name}`, body: `Indicado por ${origin.name}.`, link: `#/leads/${newContactId}`, level: 'info' });
    } catch {
      /* aviso não impede o cadastro */
    }
  }
  audit(db, user, 'contact', origin.id, 'indicacao_cadastrada', { lead: lead.name }, origin.id);
  return { id: r.id, lead_contact_id: newContactId };
}

module.exports = { listReferrals, saveReferrals, markRegistered, importFromDiagnostic };
