'use strict';
const { TASK_TYPES, MEETING_OUTCOMES, TASK_PRIORITIES } = require('../constants');
const { loadContact, visibleOwnerIds, childScope, assertAssignable, audit, requireWrite, paging } = require('../core');
const { badRequest, notFound, clean, toIso, nowIso } = require('../util');
const { tx } = require('../db');
const { insertActivity } = require('./activities');

function createTask(db, user, data) {
  requireWrite(user);
  const type = data.type || 'retorno';
  if (!TASK_TYPES[type]) throw badRequest('Tipo de tarefa inválido.');
  const title = clean(data.title) || TASK_TYPES[type];
  const due = toIso(data.due_at);
  if (!due) throw badRequest('Informe data e hora da tarefa.');
  let contactId = null;
  let oppId = null;
  if (data.opportunity_id) {
    const o = db.prepare('SELECT id, contact_id FROM opportunities WHERE id = ?').get(Number(data.opportunity_id));
    if (!o) throw badRequest('Oportunidade inválida.');
    oppId = o.id;
    contactId = o.contact_id;
  }
  if (data.contact_id) {
    if (contactId && Number(data.contact_id) !== contactId) throw badRequest('Oportunidade não pertence ao cadastro informado.');
    contactId = Number(data.contact_id);
  }
  if (contactId) loadContact(db, user, contactId, { write: true });
  const assigned = data.assigned_to ? Number(data.assigned_to) : user.id;
  assertAssignable(db, user, assigned);
  const priority = data.priority || 'normal';
  if (!TASK_PRIORITIES[priority]) throw badRequest('Prioridade inválida.');
  return tx(db, () => {
    const now = nowIso();
    const r = db
      .prepare(
        `INSERT INTO tasks (contact_id, opportunity_id, type, title, notes, due_at, assigned_to, priority, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(contactId, oppId, type, title, clean(data.notes) ?? null, due, assigned, priority, user.id, now, now);
    const id = Number(r.lastInsertRowid);
    if (contactId) {
      insertActivity(db, {
        contact_id: contactId,
        opportunity_id: oppId,
        type: type === 'reuniao' ? 'reuniao_agendada' : 'tarefa',
        notes: `${type === 'reuniao' ? 'Reunião agendada' : 'Tarefa criada'}: ${title} — ${new Date(due).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
        user_id: user.id,
        ref_type: 'task',
        ref_id: id,
      });
      if (oppId && data.set_next_action !== false) {
        db.prepare('UPDATE opportunities SET next_action = ?, next_action_at = ?, updated_at = ? WHERE id = ?').run(title, due, now, oppId);
      }
    }
    audit(db, user, 'task', id, 'criada', { titulo: title, tipo: type, prazo: due }, contactId);
    return id;
  });
}

function loadTask(db, user, id) {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(id));
  if (!t) throw notFound('Tarefa não encontrada.');
  if (t.contact_id) loadContact(db, user, t.contact_id);
  else {
    const ids = visibleOwnerIds(db, user);
    if (ids && !ids.includes(t.assigned_to)) throw notFound('Tarefa não encontrada.');
  }
  return t;
}

function updateTask(db, user, id, data) {
  requireWrite(user);
  const t = loadTask(db, user, id);
  const now = nowIso();
  if (data.action === 'concluir' || data.action === 'cancelar') {
    if (t.status !== 'pendente') throw badRequest('Esta tarefa já foi encerrada.');
    const status = data.action === 'concluir' ? 'concluida' : 'cancelada';
    let outcome = clean(data.outcome);
    if (t.type === 'reuniao' && status === 'concluida') {
      if (!MEETING_OUTCOMES[outcome]) throw badRequest('Informe o resultado da reunião (realizada, não compareceu, remarcada ou cancelada).');
    }
    return tx(db, () => {
      db.prepare('UPDATE tasks SET status = ?, outcome = ?, completed_at = ?, completed_by = ?, updated_at = ?, notes = COALESCE(?, notes) WHERE id = ?').run(
        status, outcome ?? null, now, user.id, now, clean(data.notes) ?? null, t.id,
      );
      if (t.contact_id) {
        let type = 'tarefa';
        let notes = `Tarefa ${status === 'concluida' ? 'concluída' : 'cancelada'}: ${t.title}${data.notes ? ` — ${clean(data.notes)}` : ''}`;
        if (t.type === 'reuniao' && status === 'concluida') {
          type = outcome === 'realizada' ? 'reuniao_realizada' : 'reuniao_nao_realizada';
          notes = `Reunião ${MEETING_OUTCOMES[outcome].toLowerCase()}: ${t.title}${data.notes ? ` — ${clean(data.notes)}` : ''}`;
        }
        insertActivity(db, {
          contact_id: t.contact_id,
          opportunity_id: t.opportunity_id,
          type,
          notes,
          occurred_at: now,
          user_id: user.id,
          source: 'manual',
          ref_type: 'task',
          ref_id: t.id,
        });
        if (t.opportunity_id) {
          // Atualiza a próxima ação da oportunidade com a próxima tarefa pendente
          const next = db.prepare("SELECT title, due_at FROM tasks WHERE opportunity_id = ? AND status = 'pendente' ORDER BY due_at LIMIT 1").get(t.opportunity_id);
          db.prepare('UPDATE opportunities SET next_action = ?, next_action_at = ?, updated_at = ? WHERE id = ?').run(next?.title ?? null, next?.due_at ?? null, now, t.opportunity_id);
        }
      }
      audit(db, user, 'task', t.id, status, { resultado: outcome }, t.contact_id);
    });
  }
  if (t.status !== 'pendente') throw badRequest('Tarefas encerradas não podem ser editadas.');
  const upd = {};
  if (data.title !== undefined) upd.title = clean(data.title) || t.title;
  if (data.notes !== undefined) upd.notes = clean(data.notes);
  if (data.due_at !== undefined) {
    upd.due_at = toIso(data.due_at);
    if (!upd.due_at) throw badRequest('Data inválida.');
  }
  if (data.assigned_to !== undefined) {
    assertAssignable(db, user, Number(data.assigned_to));
    upd.assigned_to = Number(data.assigned_to);
  }
  if (data.priority !== undefined) {
    if (!TASK_PRIORITIES[data.priority]) throw badRequest('Prioridade inválida.');
    upd.priority = data.priority;
  }
  const keys = Object.keys(upd);
  if (!keys.length) return;
  tx(db, () => {
    db.prepare(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => upd[k]), now, t.id);
    const ch = {};
    for (const k of keys) if (String(t[k]) !== String(upd[k])) ch[k] = [t[k], upd[k]];
    audit(db, user, 'task', t.id, 'alterada', ch, t.contact_id);
    if (t.opportunity_id && upd.due_at) {
      const next = db.prepare("SELECT title, due_at FROM tasks WHERE opportunity_id = ? AND status = 'pendente' ORDER BY due_at LIMIT 1").get(t.opportunity_id);
      db.prepare('UPDATE opportunities SET next_action = ?, next_action_at = ? WHERE id = ?').run(next?.title ?? null, next?.due_at ?? null, t.opportunity_id);
    }
  });
}

function listTasks(db, user, q) {
  const where = [];
  const params = [];
  const s = childScope(db, user, 't');
  const ids = visibleOwnerIds(db, user);
  if (ids === null) where.push('1=1');
  else {
    where.push(`((t.contact_id IS NOT NULL AND ${s.sql}) OR (t.contact_id IS NULL AND t.assigned_to IN (${ids.map(() => '?').join(',')})))`);
    params.push(...s.params, ...ids);
  }
  if (q.status) {
    where.push('t.status = ?');
    params.push(q.status);
  }
  if (q.assigned_to) {
    where.push('t.assigned_to = ?');
    params.push(Number(q.assigned_to));
  }
  if (q.type) {
    const types = String(q.type).split(',');
    where.push(`t.type IN (${types.map(() => '?').join(',')})`);
    params.push(...types);
  }
  if (q.priority) {
    where.push('t.priority = ?');
    params.push(q.priority);
  }
  if (q.contact_id) {
    where.push('t.contact_id = ?');
    params.push(Number(q.contact_id));
  }
  if (q.from) {
    where.push('t.due_at >= ?');
    params.push(toIso(q.from));
  }
  if (q.to) {
    where.push('t.due_at <= ?');
    params.push(toIso(q.to));
  }
  if (q.overdue === '1') where.push("t.status = 'pendente' AND t.due_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  const { limit, offset, page } = paging({ limit: 200, ...q });
  const base = `FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id LEFT JOIN users u ON u.id = t.assigned_to
    LEFT JOIN opportunities o ON o.id = t.opportunity_id WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) AS n ${base}`).get(...params).n;
  const rows = db
    .prepare(
      `SELECT t.*, c.name AS contact_name, c.code AS contact_code, c.optouts AS contact_optouts, u.name AS assigned_name, o.code AS opportunity_code
       ${base} ORDER BY t.status = 'pendente' DESC, ${q.status === 'pendente' ? "t.priority = 'urgente' DESC, " : ''}t.due_at ${q.status && q.status !== 'pendente' ? 'DESC' : 'ASC'} LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  rows.forEach((r) => (r.contact_optouts = JSON.parse(r.contact_optouts || '[]')));
  return { total, page, limit, rows };
}

module.exports = { createTask, updateTask, listTasks };
