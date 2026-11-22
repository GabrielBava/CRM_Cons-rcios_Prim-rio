'use strict';
/**
 * Calendário 360 (Operacional › Calendário): visão somente leitura de tudo o que o usuário tem para fazer e do que já
 * fez — tarefas, R1 e R2, one-on-ones marcados pelo líder e as atividades registradas (ligações, WhatsApp, e-mail,
 * direct...). Nada é criado por aqui: o calendário só reúne os registros das outras telas.
 *
 * Escopo: o especialista vê o próprio calendário; o líder escolhe uma pessoa da equipe ou a equipe inteira; o
 * administrador, qualquer pessoa, um time ou todos.
 */
const { visibleOwnerIds, assertAssignable } = require('../core');
const { requireModule } = require('../permissions');
const { ACTIVITY_TYPES } = require('../constants');
const { badRequest, forbidden, clean, toIso, nowIso } = require('../util');

const MAX_DAYS = 400;
const isManager = (user) => ['admin', 'gestor'].includes(user.role);

/** Pessoas cujo calendário o usuário pode ver (para o filtro). */
function people(db, user) {
  const ids = visibleOwnerIds(db, user);
  const rows = db.prepare("SELECT id, name, role, team_id, photo, job_title FROM users WHERE active = 1 AND role <> 'leitura' ORDER BY name").all();
  return ids === null ? rows : rows.filter((u) => ids.includes(u.id));
}

/** Resolve os usuários do filtro: pessoa (user_id), time (team_id), "todos" ou o próprio usuário (padrão). */
function scope(db, user, q) {
  const visible = visibleOwnerIds(db, user);
  const can = (id) => visible === null || visible.includes(id);
  if (q.user_id) {
    const id = Number(q.user_id);
    if (!can(id)) throw forbidden('Calendário de outra equipe.');
    const u = db.prepare('SELECT name FROM users WHERE id = ?').get(id);
    return { ids: [id], label: id === user.id ? 'Meu calendário' : `Calendário de ${u?.name || '—'}` };
  }
  if (q.team_id && isManager(user)) {
    const tid = Number(q.team_id);
    if (user.role !== 'admin' && tid !== user.team_id) throw forbidden('Time de outra equipe.');
    const ids = db.prepare('SELECT id FROM users WHERE team_id = ? AND active = 1').all(tid).map((r) => r.id);
    const t = db.prepare('SELECT name FROM teams WHERE id = ?').get(tid);
    return { ids: ids.length ? ids : [-1], label: `Time ${t?.name || ''}`.trim() };
  }
  if (q.todos === '1' && isManager(user)) {
    return visible === null ? { ids: null, label: 'Toda a empresa' } : { ids: visible, label: 'Toda a equipe' };
  }
  return { ids: [user.id], label: 'Meu calendário' };
}

const inList = (col, ids) => (ids === null ? { sql: '1=1', params: [] } : { sql: `${col} IN (${ids.map(() => '?').join(',')})`, params: ids });

/**
 * Eventos do período: tarefas e reuniões (pelo prazo) e atividades registradas (pela data em que ocorreram).
 * q: from, to (ISO), user_id | team_id | todos=1.
 */
function events(db, user, q = {}) {
  requireModule(user, 'calendario');
  const from = toIso(q.from);
  const to = toIso(q.to);
  if (!from || !to || to <= from) throw badRequest('Informe o período (início e fim).');
  if (Date.parse(to) - Date.parse(from) > MAX_DAYS * 86400000) throw badRequest(`O período pode ter no máximo ${MAX_DAYS} dias.`);
  const sc = scope(db, user, q);
  const now = nowIso();
  const out = [];

  // Tarefas, R1/R2 e one-on-ones (o one-on-one aparece para o líder que marcou e para o liderado)
  const ta = inList('t.assigned_to', sc.ids);
  const tc = inList('t.created_by', sc.ids);
  const tasks = db.prepare(`SELECT t.id, t.type, t.title, t.notes, t.due_at, t.ends_at, t.status, t.outcome, t.priority, t.meeting_url, t.meeting_kind, t.confirmed_at,
      t.contact_id, t.created_by, t.assigned_to, c.name AS contact_name, u.name AS assigned_name, cb.name AS creator_name
    FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id LEFT JOIN users u ON u.id = t.assigned_to LEFT JOIN users cb ON cb.id = t.created_by
    WHERE t.status <> 'cancelada' AND t.due_at >= ? AND t.due_at < ? AND (${ta.sql} OR (t.type = 'one_on_one' AND ${tc.sql}))
    ORDER BY t.due_at`).all(from, to, ...ta.params, ...tc.params);
  for (const t of tasks) {
    const kind = t.type === 'reuniao' ? (t.meeting_kind === 'r2' ? 'r2' : 'r1') : t.type === 'one_on_one' ? 'one_on_one' : 'tarefa';
    const state = t.status === 'pendente' ? 'pendente' : t.outcome === 'nao_compareceu' ? 'no_show' : t.outcome === 'remarcada' ? 'remarcada' : 'concluida';
    out.push({
      id: `t${t.id}`, ref_id: t.id, kind, type: t.type, title: t.title, start: t.due_at, end: t.ends_at || null, state,
      overdue: t.status === 'pendente' && t.due_at < now, priority: t.priority, notes: t.notes, contact_id: t.contact_id, contact_name: t.contact_name,
      user_id: t.assigned_to, user_name: t.assigned_name, created_by_name: t.type === 'one_on_one' ? t.creator_name : null,
      meeting_url: t.status === 'pendente' ? t.meeting_url : null, confirmed: !!t.confirmed_at,
    });
  }

  // Atividades registradas (o que foi feito): ligações, mensagens, e-mails, direct, conversas e notas
  const manual = Object.entries(ACTIVITY_TYPES).filter(([, v]) => !v.system).map(([k]) => k);
  const au = inList('a.user_id', sc.ids);
  const acts = db.prepare(`SELECT a.id, a.type, a.channel, a.result, a.notes, a.occurred_at, a.duration_seconds, a.contact_id, a.user_id, c.name AS contact_name, u.name AS user_name
    FROM activities a LEFT JOIN contacts c ON c.id = a.contact_id LEFT JOIN users u ON u.id = a.user_id
    WHERE a.occurred_at >= ? AND a.occurred_at < ? AND a.type IN (${manual.map(() => '?').join(',')}) AND ${au.sql}
    ORDER BY a.occurred_at`).all(from, to, ...manual, ...au.params);
  for (const a of acts) {
    const def = ACTIVITY_TYPES[a.type] || {};
    out.push({
      id: `a${a.id}`, ref_id: a.id, kind: 'atividade', type: a.type, title: def.label || a.type, start: a.occurred_at, end: null, state: 'feita',
      channel: a.channel || def.channel || null, result: a.result, notes: a.notes, duration_seconds: a.duration_seconds,
      contact_id: a.contact_id, contact_name: a.contact_name, user_id: a.user_id, user_name: a.user_name,
    });
  }
  out.sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : 0));
  const n = (f) => out.filter(f).length;
  return {
    from, to, scope: sc.label,
    totals: {
      r1: n((e) => e.kind === 'r1'), r2: n((e) => e.kind === 'r2'), one_on_one: n((e) => e.kind === 'one_on_one'),
      tarefas: n((e) => e.kind === 'tarefa'), pendentes: n((e) => e.state === 'pendente'), atrasadas: n((e) => e.overdue),
      atividades: n((e) => e.kind === 'atividade'), no_show: n((e) => e.state === 'no_show'),
    },
    events: out,
    people: people(db, user).map((u) => ({ id: u.id, name: u.name, team_id: u.team_id })),
    teams: isManager(user) ? db.prepare(`SELECT id, name FROM teams ${user.role === 'admin' ? '' : 'WHERE id = ?'} ORDER BY name`).all(...(user.role === 'admin' ? [] : [user.team_id ?? -1])) : [],
  };
}

/* ------------------------- One-on-one (líder → liderado) ------------------------- */

/**
 * O líder (ou o administrador) marca o one-on-one com alguém da equipe: vira uma tarefa do tipo one_on_one para o
 * liderado, com início e fim, e aparece no calendário dos dois.
 */
function scheduleOneOnOne(db, user, data = {}) {
  requireModule(user, 'time');
  if (!isManager(user)) throw forbidden('Apenas o líder de equipe ou o administrador marca one-on-one.');
  const member = Number(data.user_id);
  if (!member || member === user.id) throw badRequest('Escolha a pessoa da equipe.');
  assertAssignable(db, user, member);
  const start = toIso(data.start_at);
  const end = toIso(data.end_at);
  if (!start) throw badRequest('Informe a data e o horário do one-on-one.');
  if (!end || end <= start) throw badRequest('O término precisa ser depois do início.');
  const m = db.prepare('SELECT name FROM users WHERE id = ?').get(member);
  const id = require('./tasks').createTask(db, user, {
    type: 'one_on_one', title: clean(data.title) || `One-on-one: ${user.name} e ${m.name}`, due_at: start, notes: clean(data.agenda), assigned_to: member, priority: 'alta',
  });
  db.prepare('UPDATE tasks SET ends_at = ?, meeting_url = ? WHERE id = ?').run(end, /^https:\/\/\S+$/.test(String(data.meeting_url || '')) ? data.meeting_url : null, id);
  return { id };
}

/** One-on-ones da equipe (próximos e dos últimos 30 dias). */
function listOneOnOnes(db, user) {
  requireModule(user, 'time');
  if (!isManager(user)) throw forbidden('Apenas o líder de equipe ou o administrador.');
  const ids = visibleOwnerIds(db, user);
  const f = inList('t.assigned_to', ids);
  return db.prepare(`SELECT t.id, t.title, t.notes, t.due_at, t.ends_at, t.status, t.outcome, t.meeting_url, t.assigned_to, u.name AS member_name, u.photo AS member_photo, cb.name AS leader_name
    FROM tasks t JOIN users u ON u.id = t.assigned_to LEFT JOIN users cb ON cb.id = t.created_by
    WHERE t.type = 'one_on_one' AND t.status <> 'cancelada' AND t.due_at >= ? AND (${f.sql} OR t.created_by = ?)
    ORDER BY t.status = 'pendente' DESC, t.due_at`).all(new Date(Date.now() - 30 * 86400000).toISOString(), ...f.params, user.id);
}

module.exports = { events, scheduleOneOnOne, listOneOnOnes };
