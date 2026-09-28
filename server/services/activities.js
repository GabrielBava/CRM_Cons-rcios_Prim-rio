'use strict';
const { ACTIVITY_TYPES, ATTEMPT_TYPES, CONTACT_CHANNELS } = require('../constants');
const { loadContact, childScope, audit, paging } = require('../core');
const { badRequest, conflict, clean, toIso, nowIso } = require('../util');
const { tx } = require('../db');

function parseDuration(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Math.max(0, Math.round(v));
  const s = String(v).trim();
  const m = s.match(/^(?:(\d+):)?(\d+):(\d{1,2})$/);
  if (m) return (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]);
  const n = Number(s.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw badRequest(`Duração inválida: "${v}". Use segundos ou mm:ss.`);
  return Math.round(n);
}

function optouts(row) {
  try {
    return JSON.parse(row.optouts || '[]');
  } catch {
    return [];
  }
}

/** Retorna o motivo do bloqueio ou null quando o contato por este canal é permitido. */
function contactBlockReason(contact, channel, companyContact) {
  const check = (row, who) => {
    const o = optouts(row);
    if (o.includes('todos')) return `${who} solicitou não receber nenhum contato.`;
    if (channel && o.includes(channel)) return `${who} registrou oposição a contatos por ${CONTACT_CHANNELS[channel] || channel}.`;
    return null;
  };
  return check(contact, 'Este cadastro') || (companyContact ? check(companyContact, 'Este contato da empresa') : null);
}

function isEffective(db, type, result) {
  const t = ACTIVITY_TYPES[type];
  if (!t) return false;
  if (t.call) {
    if (!result) return type === 'ligacao_recebida';
    const o = db.prepare("SELECT flags FROM options WHERE list = 'resultado_ligacao' AND value = ?").get(result);
    return !!(o && JSON.parse(o.flags || '{}').efetivo);
  }
  return ['conversa_presencial', 'conversa_video', 'reuniao_realizada', 'mensagem_recebida', 'email_recebido'].includes(type);
}

/** Inserção de baixo nível, usada por regras do sistema e integrações. */
function insertActivity(db, row) {
  const now = nowIso();
  const r = db
    .prepare(
      `INSERT INTO activities (contact_id, company_contact_id, opportunity_id, type, channel, direction, result, duration_seconds,
        notes, next_action, return_at, occurred_at, source, external_id, call_event_id, ref_type, ref_id, user_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.contact_id,
      row.company_contact_id ?? null,
      row.opportunity_id ?? null,
      row.type,
      row.channel ?? ACTIVITY_TYPES[row.type]?.channel ?? null,
      row.direction ?? null,
      row.result ?? null,
      row.duration_seconds ?? null,
      row.notes ?? null,
      row.next_action ?? null,
      row.return_at ?? null,
      row.occurred_at || now,
      row.source || 'sistema',
      row.external_id ?? null,
      row.call_event_id ?? null,
      row.ref_type ?? null,
      row.ref_id ?? null,
      row.user_id ?? null,
      row.created_by ?? row.user_id ?? null,
      now,
    );
  const id = Number(r.lastInsertRowid);
  afterActivity(db, { ...row, id });
  return id;
}

/** Efeitos de uma atividade sobre o cadastro e as oportunidades. */
function afterActivity(db, a) {
  const t = ACTIVITY_TYPES[a.type];
  if (!t || t.system) return;
  const when = a.occurred_at || nowIso();
  const c = db.prepare('SELECT id, lead_status, relationship, first_contact_at FROM contacts WHERE id = ?').get(a.contact_id);
  if (!c) return;
  const effective = isEffective(db, a.type, a.result);
  if (ATTEMPT_TYPES.includes(a.type) || effective) {
    if (!c.first_contact_at) db.prepare('UPDATE contacts SET first_contact_at = ? WHERE id = ?').run(when, c.id);
    if (c.lead_status === 'novo') db.prepare("UPDATE contacts SET lead_status = 'em_contato' WHERE id = ?").run(c.id);
  }
  if (effective && c.relationship === 'prospect') {
    db.prepare("UPDATE contacts SET relationship = 'lead' WHERE id = ?").run(c.id);
  }
  if (a.opportunity_id) {
    db.prepare('UPDATE opportunities SET last_activity_at = MAX(COALESCE(last_activity_at, ?), ?) WHERE id = ?').run(when, when, a.opportunity_id);
  } else {
    db.prepare(
      "UPDATE opportunities SET last_activity_at = MAX(COALESCE(last_activity_at, ?), ?) WHERE contact_id = ? AND status IN ('aberta','pausada')",
    ).run(when, when, c.id);
  }
}

function createActivity(db, user, data) {
  const type = clean(data.type);
  const def = ACTIVITY_TYPES[type];
  if (!def) throw badRequest('Tipo de atividade inválido.');
  if (def.system) throw badRequest('Este tipo de atividade é registrado automaticamente pelo sistema.');
  const contact = loadContact(db, user, data.contact_id, { write: true });
  let companyContact = null;
  if (data.company_contact_id) {
    companyContact = db
      .prepare('SELECT * FROM company_contacts WHERE id = ? AND company_id = ?')
      .get(Number(data.company_contact_id), contact.id);
    if (!companyContact) throw badRequest('Contato da empresa não pertence a este cadastro.');
  }
  if (data.opportunity_id) {
    const o = db.prepare('SELECT id FROM opportunities WHERE id = ? AND contact_id = ?').get(Number(data.opportunity_id), contact.id);
    if (!o) throw badRequest('Oportunidade não pertence a este cadastro.');
  }
  const channel = clean(data.channel) || def.channel || null;
  if (def.outbound) {
    const reason = contactBlockReason(contact, channel, companyContact);
    if (reason) throw conflict(`${reason} A atividade não foi registrada.`);
  }
  const result = clean(data.result);
  if (def.call && result) {
    const ok = db.prepare("SELECT 1 FROM options WHERE list = 'resultado_ligacao' AND value = ?").get(result);
    if (!ok) throw badRequest('Resultado de ligação inválido.');
  }
  const occurred = toIso(data.occurred_at) || nowIso();
  if (new Date(occurred).getTime() > Date.now() + 5 * 60 * 1000) {
    throw badRequest('Atividades registram fatos já ocorridos. Para ações futuras, crie uma tarefa.');
  }
  const returnAt = toIso(data.return_at);
  const nextAction = clean(data.next_action);

  return tx(db, () => {
    const id = insertActivity(db, {
      contact_id: contact.id,
      company_contact_id: companyContact?.id,
      opportunity_id: data.opportunity_id ? Number(data.opportunity_id) : null,
      type,
      channel,
      direction: def.outbound ? 'saida' : def.call || type.endsWith('recebida') || type.endsWith('recebido') ? 'entrada' : null,
      result,
      duration_seconds: parseDuration(data.duration),
      notes: clean(data.notes),
      next_action: nextAction,
      return_at: returnAt,
      occurred_at: occurred,
      source: 'manual',
      user_id: user.id,
      created_by: user.id,
    });
    if (returnAt || nextAction) {
      const due = returnAt || new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      const now = nowIso();
      const tr = db
        .prepare(
          `INSERT INTO tasks (contact_id, opportunity_id, type, title, notes, due_at, assigned_to, created_by, created_at, updated_at)
           VALUES (?, ?, 'retorno', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(contact.id, data.opportunity_id ? Number(data.opportunity_id) : null, nextAction || 'Retorno ao contato', `Criada a partir da atividade #${id}`, due, user.id, user.id, now, now);
      if (data.opportunity_id) {
        db.prepare('UPDATE opportunities SET next_action = ?, next_action_at = ?, updated_at = ? WHERE id = ?').run(
          nextAction || 'Retorno ao contato',
          due,
          now,
          Number(data.opportunity_id),
        );
      }
      audit(db, user, 'task', Number(tr.lastInsertRowid), 'criada', { origem: `atividade #${id}` }, contact.id);
    }
    return id;
  });
}

// Fase do relacionamento em que a atividade ocorreu: pré-venda (antes da 1ª proposta), venda (até a conversão) e pós-venda
const PHASE_SQL = `(CASE WHEN c.converted_at IS NOT NULL AND a.occurred_at >= c.converted_at THEN 'pos_venda'
  WHEN EXISTS (SELECT 1 FROM proposals px WHERE px.contact_id = a.contact_id AND px.created_at <= a.occurred_at) THEN 'venda' ELSE 'pre_venda' END)`;

function listActivities(db, user, q) {
  const where = [];
  const params = [];
  const s = childScope(db, user, 'a');
  where.push(s.sql);
  params.push(...s.params);
  if (q.contact_id) {
    where.push('a.contact_id = ?');
    params.push(Number(q.contact_id));
  }
  if (q.opportunity_id) {
    where.push('a.opportunity_id = ?');
    params.push(Number(q.opportunity_id));
  }
  if (q.company_contact_id) {
    where.push('a.company_contact_id = ?');
    params.push(Number(q.company_contact_id));
  }
  if (q.type) {
    const types = String(q.type).split(',');
    where.push(`a.type IN (${types.map(() => '?').join(',')})`);
    params.push(...types);
  }
  if (q.user_id) {
    where.push('a.user_id = ?');
    params.push(Number(q.user_id));
  }
  if (q.source) {
    where.push('a.source = ?');
    params.push(q.source);
  }
  if (q.result) {
    where.push('a.result = ?');
    params.push(q.result);
  }
  if (q.phase) {
    where.push(`${PHASE_SQL} = ?`);
    params.push(q.phase);
  }
  if (q.from) {
    where.push('a.occurred_at >= ?');
    params.push(toIso(q.from));
  }
  if (q.to) {
    where.push('a.occurred_at <= ?');
    params.push(toIso(q.to));
  }
  const { limit, offset, page } = paging(q);
  const base = `FROM activities a
    JOIN contacts c ON c.id = a.contact_id
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN company_contacts cc ON cc.id = a.company_contact_id
    LEFT JOIN opportunities o ON o.id = a.opportunity_id
    WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) AS n ${base}`).get(...params).n;
  const rows = db
    .prepare(
      `SELECT a.*, ${PHASE_SQL} AS phase, c.name AS contact_name, c.code AS contact_code, u.name AS user_name, cc.name AS company_contact_name, o.code AS opportunity_code
       ${base} ORDER BY a.occurred_at DESC, a.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  return { total, page, limit, rows };
}

module.exports = { createActivity, insertActivity, listActivities, contactBlockReason, isEffective, parseDuration, optouts };
