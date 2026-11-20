'use strict';
/**
 * Comunicação interna:
 * - Inbox: chat entre colaboradores (conversa direta ou em grupo), com anexos e contagem de não lidas;
 * - Tickets: chamados internos (ex.: "arte para a campanha X" para o marketing) com responsável, prazo e anexos.
 *   Fluxo: aberto → em andamento → devolvido (volta ao solicitante para ajuste ou informação) → concluído;
 *   o solicitante pode responder um devolvido, reabrir um concluído ou cancelar. Tudo fica no histórico do ticket.
 */
const { audit } = require('../core');
const { requireModule } = require('../permissions');
const { tx, nextCode } = require('../db');
const { badRequest, forbidden, notFound, clean: cleanRaw, nowIso, toDateOnly } = require('../util');
const { notify } = require('./notifications');

const clean = (v) => cleanRaw(v) ?? null;

/* ------------------------- Arquivos (anexos do chat e dos tickets) ------------------------- */

const FILE_EXT = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', csv: 'text/csv', zip: 'application/zip', mp4: 'video/mp4', mp3: 'audio/mpeg', psd: 'image/vnd.adobe.photoshop', ai: 'application/postscript',
};
const MAX_FILE = 15 * 1024 * 1024;

function readFile(f) {
  const filename = clean(f?.filename);
  if (!filename) return null;
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (!FILE_EXT[ext]) throw badRequest(`Tipo de arquivo não permitido (.${ext}).`);
  const content = Buffer.from(String(f.content_base64 || '').replace(/^data:[^,]*,/, ''), 'base64');
  if (!content.length) throw badRequest('Arquivo vazio.');
  if (content.length > MAX_FILE) throw badRequest('Arquivo maior que 15 MB.');
  return { filename: filename.slice(0, 200), mime: FILE_EXT[ext], size: content.length, content };
}

const userName = (db, id) => db.prepare('SELECT name FROM users WHERE id = ?').get(id)?.name || '—';
const activeUser = (db, id) => db.prepare('SELECT id, name FROM users WHERE id = ? AND active = 1').get(Number(id));

/* ------------------------- Inbox (chat interno) ------------------------- */

const guardChat = (user) => requireModule(user, 'inbox');

function member(db, user, convId) {
  const c = db.prepare('SELECT * FROM chat_conversations WHERE id = ?').get(Number(convId));
  if (!c) throw notFound('Conversa não encontrada.');
  const m = db.prepare('SELECT * FROM chat_members WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL').get(c.id, user.id);
  if (!m) throw forbidden('Você não participa desta conversa.');
  return { c, m };
}

/** Colaboradores ativos (para iniciar uma conversa ou montar um grupo). */
function directory(db, user) {
  const { hasModule } = require('../permissions');
  if (!hasModule(user, 'inbox') && !hasModule(user, 'tickets')) guardChat(user);
  return db.prepare("SELECT u.id, u.name, u.photo, u.job_title, u.role, t.name AS team_name FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.active = 1 AND u.id <> ? ORDER BY u.name").all(user.id);
}

function listConversations(db, user) {
  guardChat(user);
  const rows = db.prepare(`SELECT c.*, m.last_read_id,
      (SELECT COUNT(*) FROM chat_messages x WHERE x.conversation_id = c.id AND x.id > m.last_read_id AND COALESCE(x.user_id, 0) <> ?) AS unread,
      (SELECT x.id FROM chat_messages x WHERE x.conversation_id = c.id ORDER BY x.id DESC LIMIT 1) AS last_id
    FROM chat_conversations c JOIN chat_members m ON m.conversation_id = c.id AND m.user_id = ? AND m.left_at IS NULL
    ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`).all(user.id, user.id);
  const last = db.prepare('SELECT x.body, x.filename, x.user_id, x.created_at, u.name AS user_name FROM chat_messages x LEFT JOIN users u ON u.id = x.user_id WHERE x.id = ?');
  const members = db.prepare('SELECT u.id, u.name, u.photo, u.job_title FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ? AND m.left_at IS NULL ORDER BY u.name');
  return rows.map((c) => {
    const ms = members.all(c.id);
    const other = c.kind === 'direta' ? ms.find((u) => u.id !== user.id) : null;
    const l = c.last_id ? last.get(c.last_id) : null;
    return {
      id: c.id, kind: c.kind, title: c.kind === 'direta' ? other?.name || 'Conversa' : c.title, photo: other?.photo || null, subtitle: other?.job_title || (c.kind === 'grupo' ? `${ms.length} participantes` : ''),
      members: ms, unread: c.unread, last_message_at: c.last_message_at || c.created_at, created_by: c.created_by,
      last: l ? { body: l.body || (l.filename ? `📎 ${l.filename}` : ''), user_name: l.user_id === user.id ? 'Você' : l.user_name, at: l.created_at } : null,
    };
  });
}

/** Abre (ou cria) a conversa direta com outro colaborador. */
function openDirect(db, user, otherId) {
  guardChat(user);
  const o = activeUser(db, otherId);
  if (!o || o.id === user.id) throw badRequest('Escolha um colaborador ativo.');
  const key = [user.id, o.id].sort((a, b) => a - b).join(':');
  const found = db.prepare('SELECT id FROM chat_conversations WHERE direct_key = ?').get(key);
  if (found) {
    db.prepare('UPDATE chat_members SET left_at = NULL WHERE conversation_id = ? AND user_id = ?').run(found.id, user.id);
    return { id: found.id };
  }
  return tx(db, () => {
    const now = nowIso();
    const id = Number(db.prepare("INSERT INTO chat_conversations (kind, direct_key, created_by, created_at) VALUES ('direta', ?, ?, ?)").run(key, user.id, now).lastInsertRowid);
    const ins = db.prepare('INSERT INTO chat_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)');
    ins.run(id, user.id, now);
    ins.run(id, o.id, now);
    return { id };
  });
}

/** Cria um grupo (ex.: "Time Centro", "Marketing + Comercial"). */
function createGroup(db, user, data = {}) {
  guardChat(user);
  const title = clean(data.title);
  if (!title) throw badRequest('Dê um nome ao grupo.');
  const ids = [...new Set((Array.isArray(data.member_ids) ? data.member_ids : []).map(Number).filter((id) => id && id !== user.id))];
  if (!ids.length) throw badRequest('Escolha ao menos uma pessoa para o grupo.');
  for (const id of ids) if (!activeUser(db, id)) throw badRequest('Participante inválido ou inativo.');
  return tx(db, () => {
    const now = nowIso();
    const id = Number(db.prepare("INSERT INTO chat_conversations (kind, title, created_by, created_at, last_message_at) VALUES ('grupo', ?, ?, ?, ?)").run(title.slice(0, 80), user.id, now, now).lastInsertRowid);
    const ins = db.prepare('INSERT INTO chat_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)');
    [user.id, ...ids].forEach((u) => ins.run(id, u, now));
    systemMessage(db, id, `${user.name} criou o grupo "${title}".`);
    return { id };
  });
}

function systemMessage(db, convId, text) {
  const now = nowIso();
  db.prepare('INSERT INTO chat_messages (conversation_id, user_id, body, system, created_at) VALUES (?, NULL, ?, 1, ?)').run(convId, text, now);
  db.prepare('UPDATE chat_conversations SET last_message_at = ? WHERE id = ?').run(now, convId);
}

/** Grupo: renomear, incluir ou retirar participantes (quem criou ou o administrador); sair do grupo (qualquer um). */
function updateGroup(db, user, convId, data = {}) {
  guardChat(user);
  const { c } = member(db, user, convId);
  if (c.kind !== 'grupo') throw badRequest('Só grupos podem ser alterados.');
  const now = nowIso();
  if (data.leave) {
    db.prepare('UPDATE chat_members SET left_at = ? WHERE conversation_id = ? AND user_id = ?').run(now, c.id, user.id);
    systemMessage(db, c.id, `${user.name} saiu do grupo.`);
    return { ok: true };
  }
  if (c.created_by !== user.id && user.role !== 'admin') throw forbidden('Só quem criou o grupo altera os participantes.');
  return tx(db, () => {
    const title = clean(data.title);
    if (title && title !== c.title) {
      db.prepare('UPDATE chat_conversations SET title = ? WHERE id = ?').run(title.slice(0, 80), c.id);
      systemMessage(db, c.id, `${user.name} renomeou o grupo para "${title}".`);
    }
    for (const id of (Array.isArray(data.add_ids) ? data.add_ids : []).map(Number)) {
      const u = activeUser(db, id);
      if (!u) continue;
      db.prepare('INSERT INTO chat_members (conversation_id, user_id, joined_at, last_read_id) VALUES (?, ?, ?, 0) ON CONFLICT(conversation_id, user_id) DO UPDATE SET left_at = NULL').run(c.id, u.id, now);
      systemMessage(db, c.id, `${user.name} incluiu ${u.name}.`);
    }
    for (const id of (Array.isArray(data.remove_ids) ? data.remove_ids : []).map(Number)) {
      if (id === user.id) continue;
      if (db.prepare('UPDATE chat_members SET left_at = ? WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL').run(now, c.id, id).changes) systemMessage(db, c.id, `${user.name} retirou ${userName(db, id)}.`);
    }
    return { ok: true };
  });
}

const MSG_COLS = 'x.id, x.conversation_id, x.user_id, x.body, x.filename, x.mime, x.size, x.system, x.created_at, u.name AS user_name, u.photo AS user_photo';

/** Mensagens da conversa (as 60 mais recentes, ou as novas depois de after_id) e marca como lidas. */
function messages(db, user, convId, q = {}) {
  guardChat(user);
  const { c } = member(db, user, convId);
  const after = Number(q.after_id) || 0;
  const before = Number(q.before_id) || 0;
  let rows;
  if (after) rows = db.prepare(`SELECT ${MSG_COLS} FROM chat_messages x LEFT JOIN users u ON u.id = x.user_id WHERE x.conversation_id = ? AND x.id > ? ORDER BY x.id LIMIT 200`).all(c.id, after);
  else {
    rows = db.prepare(`SELECT ${MSG_COLS} FROM chat_messages x LEFT JOIN users u ON u.id = x.user_id WHERE x.conversation_id = ? ${before ? 'AND x.id < ?' : ''} ORDER BY x.id DESC LIMIT 60`).all(...(before ? [c.id, before] : [c.id])).reverse();
  }
  const maxId = rows.length ? rows[rows.length - 1].id : 0;
  if (maxId) db.prepare('UPDATE chat_members SET last_read_id = MAX(last_read_id, ?) WHERE conversation_id = ? AND user_id = ?').run(maxId, c.id, user.id);
  // Até onde cada participante leu (para o "visto" nas conversas diretas)
  const reads = db.prepare('SELECT user_id, last_read_id FROM chat_members WHERE conversation_id = ? AND user_id <> ? AND left_at IS NULL').all(c.id, user.id);
  return { rows: rows.map((r) => ({ ...r, mine: r.user_id === user.id, system: !!r.system })), has_more: !after && rows.length === 60, reads };
}

function sendMessage(db, user, convId, data = {}) {
  guardChat(user);
  const { c } = member(db, user, convId);
  const body = clean(data.body);
  const file = readFile(data.file || (data.filename ? data : null));
  if (!body && !file) throw badRequest('Escreva a mensagem ou anexe um arquivo.');
  if (body && body.length > 4000) throw badRequest('Mensagem muito longa (máximo de 4.000 caracteres).');
  const now = nowIso();
  const id = tx(db, () => {
    const r = db.prepare('INSERT INTO chat_messages (conversation_id, user_id, body, filename, mime, size, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(c.id, user.id, body, file?.filename ?? null, file?.mime ?? null, file?.size ?? null, file?.content ?? null, now);
    db.prepare('UPDATE chat_conversations SET last_message_at = ? WHERE id = ?').run(now, c.id);
    db.prepare('UPDATE chat_members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ?').run(Number(r.lastInsertRowid), c.id, user.id);
    // Quem saiu de uma conversa direta volta a recebê-la quando chega mensagem nova
    if (c.kind === 'direta') db.prepare('UPDATE chat_members SET left_at = NULL WHERE conversation_id = ?').run(c.id);
    return Number(r.lastInsertRowid);
  });
  return db.prepare(`SELECT ${MSG_COLS} FROM chat_messages x LEFT JOIN users u ON u.id = x.user_id WHERE x.id = ?`).get(id);
}

function chatFile(db, user, msgId) {
  guardChat(user);
  const x = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(Number(msgId));
  if (!x || !x.content) throw notFound('Arquivo não encontrado.');
  member(db, user, x.conversation_id);
  return { filename: x.filename, mime: x.mime, content: x.content };
}

/* ------------------------- Tickets (chamados internos) ------------------------- */

const guardTickets = (user) => requireModule(user, 'tickets');
const PRIORITIES = ['baixa', 'normal', 'alta', 'urgente'];
const STATUS_LABEL = { aberto: 'Aberto', em_andamento: 'Em andamento', devolvido: 'Devolvido ao solicitante', concluido: 'Concluído', cancelado: 'Cancelado' };
const EVENT_LABEL = {
  criado: 'abriu o ticket', comentario: 'comentou', iniciado: 'começou a atuar', devolvido: 'devolveu ao solicitante', respondido: 'respondeu e reenviou',
  concluido: 'concluiu', reaberto: 'reabriu', cancelado: 'cancelou', transferido: 'transferiu',
};

function loadTicket(db, user, id) {
  const t = db.prepare(`SELECT t.*, r.name AS requester_name, r.photo AS requester_photo, a.name AS assignee_name, a.photo AS assignee_photo, c.name AS contact_name
    FROM tickets t JOIN users r ON r.id = t.requester_id JOIN users a ON a.id = t.assignee_id LEFT JOIN contacts c ON c.id = t.contact_id WHERE t.id = ?`).get(Number(id));
  if (!t) throw notFound('Ticket não encontrado.');
  if (user.role !== 'admin' && t.requester_id !== user.id && t.assignee_id !== user.id && !leaderOf(db, user, t)) throw forbidden('Ticket de outra pessoa.');
  return t;
}
/** O líder acompanha os tickets do próprio time (como solicitante ou responsável). */
function leaderOf(db, user, t) {
  if (user.role !== 'gestor' || !user.team_id) return false;
  return !!db.prepare('SELECT 1 FROM users WHERE id IN (?, ?) AND team_id = ?').get(t.requester_id, t.assignee_id, user.team_id);
}

function addEvent(db, user, ticketId, kind, body, files = []) {
  const now = nowIso();
  const ev = Number(db.prepare('INSERT INTO ticket_events (ticket_id, user_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?)').run(ticketId, user.id, kind, body, now).lastInsertRowid);
  for (const f of files) {
    db.prepare('INSERT INTO ticket_files (ticket_id, event_id, filename, mime, size, content, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ticketId, ev, f.filename, f.mime, f.size, f.content, user.id, now);
  }
  db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(now, ticketId);
  return ev;
}
const readFiles = (data) => (Array.isArray(data.files) ? data.files : []).slice(0, 10).map(readFile).filter(Boolean);

function createTicket(db, user, data = {}) {
  guardTickets(user);
  const title = clean(data.title);
  const description = clean(data.description);
  if (!title) throw badRequest('Informe o título do ticket.');
  if (!description) throw badRequest('Descreva a demanda.');
  const assignee = activeUser(db, data.assignee_id);
  if (!assignee) throw badRequest('Escolha o responsável pelo ticket.');
  const category = clean(data.category) || 'outro';
  if (!db.prepare("SELECT 1 FROM options WHERE list = 'categoria_ticket' AND value = ? AND active = 1").get(category)) throw badRequest('Categoria inválida.');
  const priority = PRIORITIES.includes(data.priority) ? data.priority : 'normal';
  const due = data.due_date ? toDateOnly(data.due_date) : null;
  if (data.due_date && !due) throw badRequest('Prazo inválido.');
  const files = readFiles(data);
  const contactId = data.contact_id ? Number(data.contact_id) : null;
  if (contactId) require('../core').loadContact(db, user, contactId);
  const out = tx(db, () => {
    const now = nowIso();
    const code = nextCode(db, 'ticket', 'T');
    const id = Number(db.prepare(`INSERT INTO tickets (code, title, description, category, priority, status, requester_id, assignee_id, due_date, contact_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'aberto', ?, ?, ?, ?, ?, ?)`).run(code, title.slice(0, 160), description, category, priority, user.id, assignee.id, due, contactId, now, now).lastInsertRowid);
    addEvent(db, user, id, 'criado', null, files);
    audit(db, user, 'ticket', id, 'criado', { codigo: code, responsavel: assignee.name }, contactId);
    return { id, code };
  });
  if (assignee.id !== user.id) {
    notify(db, assignee.id, { kind: 'ticket', level: priority === 'urgente' ? 'danger' : priority === 'alta' ? 'warn' : 'info', title: `Novo ticket de ${user.name}: ${title}`, body: `${out.code}${due ? ` · prazo ${due.split('-').reverse().join('/')}` : ''}`, link: `#/comunicacao/tickets/${out.id}` });
  }
  return out;
}

function listTickets(db, user, q = {}) {
  guardTickets(user);
  const where = [];
  const params = [];
  const box = q.caixa || 'recebidos';
  if (box === 'recebidos') {
    where.push('t.assignee_id = ?');
    params.push(user.id);
  } else if (box === 'enviados') {
    where.push('t.requester_id = ?');
    params.push(user.id);
  } else if (box === 'todos') {
    if (user.role === 'gestor' && user.team_id) {
      where.push('(t.requester_id IN (SELECT id FROM users WHERE team_id = ?) OR t.assignee_id IN (SELECT id FROM users WHERE team_id = ?))');
      params.push(user.team_id, user.team_id);
    } else if (user.role !== 'admin') throw forbidden('Somente o administrador e o líder veem todos os tickets.');
  }
  if (q.status === 'abertos') where.push("t.status IN ('aberto','em_andamento','devolvido')");
  else if (q.status && STATUS_LABEL[q.status]) {
    where.push('t.status = ?');
    params.push(q.status);
  }
  if (q.categoria) {
    where.push('t.category = ?');
    params.push(q.categoria);
  }
  if (q.q) {
    where.push('(t.title LIKE ? OR t.code LIKE ? OR t.description LIKE ?)');
    const like = `%${String(q.q).trim()}%`;
    params.push(like, like, like);
  }
  const rows = db.prepare(`SELECT t.id, t.code, t.title, t.category, t.priority, t.status, t.due_date, t.created_at, t.updated_at, t.completed_at, t.requester_id, t.assignee_id,
      r.name AS requester_name, a.name AS assignee_name, a.photo AS assignee_photo, r.photo AS requester_photo,
      (SELECT COUNT(*) FROM ticket_files f WHERE f.ticket_id = t.id) AS files, (SELECT COUNT(*) FROM ticket_events e WHERE e.ticket_id = t.id AND e.kind = 'comentario') AS comments
    FROM tickets t JOIN users r ON r.id = t.requester_id JOIN users a ON a.id = t.assignee_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY t.status IN ('concluido','cancelado'), CASE t.priority WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, COALESCE(t.due_date, '9999'), t.updated_at DESC LIMIT 300`).all(...params);
  const today = new Date().toISOString().slice(0, 10);
  return rows.map((t) => ({ ...t, overdue: !!t.due_date && t.due_date < today && !['concluido', 'cancelado'].includes(t.status) }));
}

function getTicket(db, user, id) {
  guardTickets(user);
  const t = loadTicket(db, user, id);
  const events = db.prepare('SELECT e.*, u.name AS user_name, u.photo AS user_photo FROM ticket_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.ticket_id = ? ORDER BY e.id').all(t.id);
  const files = db.prepare('SELECT f.id, f.event_id, f.filename, f.mime, f.size, f.created_at, u.name AS user_name FROM ticket_files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.ticket_id = ? ORDER BY f.id').all(t.id);
  const today = new Date().toISOString().slice(0, 10);
  return {
    ...t,
    overdue: !!t.due_date && t.due_date < today && !['concluido', 'cancelado'].includes(t.status),
    events: events.map((e) => ({ ...e, label: EVENT_LABEL[e.kind] || e.kind, files: files.filter((f) => f.event_id === e.id) })),
    files,
    can: actionsFor(user, t),
  };
}

/** Ações possíveis para o usuário neste ticket (o painel mostra só os botões válidos). */
function actionsFor(user, t) {
  const isAssignee = t.assignee_id === user.id;
  const isRequester = t.requester_id === user.id;
  const admin = user.role === 'admin';
  const open = !['concluido', 'cancelado'].includes(t.status);
  return {
    comentar: open && (isAssignee || isRequester || admin),
    iniciar: isAssignee && t.status === 'aberto',
    devolver: isAssignee && ['aberto', 'em_andamento'].includes(t.status),
    concluir: (isAssignee || admin) && ['aberto', 'em_andamento'].includes(t.status),
    responder: isRequester && t.status === 'devolvido',
    reabrir: (isRequester || admin) && t.status === 'concluido',
    cancelar: (isRequester || admin) && open,
    transferir: (isAssignee || admin) && open,
  };
}

/**
 * Ações do ticket: comentar, iniciar, devolver (exige o que falta), concluir (com a entrega), responder (o solicitante
 * reenvia o devolvido), reabrir, cancelar e transferir (novo responsável). Todas aceitam anexos.
 */
function ticketAction(db, user, id, data = {}) {
  guardTickets(user);
  const t = loadTicket(db, user, id);
  const action = String(data.action || '');
  const can = actionsFor(user, t);
  if (!(action in can)) throw badRequest('Ação inválida.');
  if (!can[action]) throw forbidden('Esta ação não está disponível para você neste momento.');
  const body = clean(data.body);
  const files = readFiles(data);
  const now = nowIso();
  if (['devolver', 'responder', 'reabrir', 'cancelar'].includes(action) && !body) throw badRequest('Escreva o motivo ou o que precisa ser ajustado.');
  if (action === 'comentar' && !body && !files.length) throw badRequest('Escreva o comentário ou anexe um arquivo.');
  let notifyIds = [];
  let title = '';
  tx(db, () => {
    if (action === 'comentar') {
      addEvent(db, user, t.id, 'comentario', body, files);
      notifyIds = [t.requester_id, t.assignee_id];
      title = `${user.name} comentou no ticket ${t.code}`;
    } else if (action === 'iniciar') {
      db.prepare("UPDATE tickets SET status = 'em_andamento', started_at = COALESCE(started_at, ?) WHERE id = ?").run(now, t.id);
      addEvent(db, user, t.id, 'iniciado', body, files);
      notifyIds = [t.requester_id];
      title = `${t.code} em andamento: ${user.name} começou a atuar`;
    } else if (action === 'devolver') {
      db.prepare("UPDATE tickets SET status = 'devolvido' WHERE id = ?").run(t.id);
      addEvent(db, user, t.id, 'devolvido', body, files);
      notifyIds = [t.requester_id];
      title = `${t.code} devolvido por ${user.name}: precisa da sua resposta`;
    } else if (action === 'responder') {
      db.prepare("UPDATE tickets SET status = 'em_andamento' WHERE id = ?").run(t.id);
      addEvent(db, user, t.id, 'respondido', body, files);
      notifyIds = [t.assignee_id];
      title = `${t.code}: ${user.name} respondeu e reenviou`;
    } else if (action === 'concluir') {
      db.prepare("UPDATE tickets SET status = 'concluido', completed_at = ?, resolution = ? WHERE id = ?").run(now, body, t.id);
      addEvent(db, user, t.id, 'concluido', body, files);
      notifyIds = [t.requester_id];
      title = `${t.code} concluído por ${user.name}`;
    } else if (action === 'reabrir') {
      db.prepare("UPDATE tickets SET status = 'aberto', completed_at = NULL WHERE id = ?").run(t.id);
      addEvent(db, user, t.id, 'reaberto', body, files);
      notifyIds = [t.assignee_id];
      title = `${t.code} reaberto por ${user.name}`;
    } else if (action === 'cancelar') {
      db.prepare("UPDATE tickets SET status = 'cancelado' WHERE id = ?").run(t.id);
      addEvent(db, user, t.id, 'cancelado', body, files);
      notifyIds = [t.assignee_id, t.requester_id];
      title = `${t.code} cancelado por ${user.name}`;
    } else if (action === 'transferir') {
      const to = activeUser(db, data.assignee_id);
      if (!to || to.id === t.assignee_id) throw badRequest('Escolha o novo responsável.');
      db.prepare('UPDATE tickets SET assignee_id = ? WHERE id = ?').run(to.id, t.id);
      addEvent(db, user, t.id, 'transferido', `Transferido de ${t.assignee_name} para ${to.name}.${body ? `\n${body}` : ''}`, files);
      notifyIds = [to.id, t.requester_id];
      title = `${t.code} transferido para ${to.name}: ${t.title}`;
    }
    audit(db, user, 'ticket', t.id, action, body ? { texto: body.slice(0, 200) } : null, t.contact_id);
  });
  notify(db, notifyIds, { kind: 'ticket', level: action === 'devolver' ? 'warn' : action === 'concluir' ? 'ok' : 'info', title, body: body ? body.slice(0, 180) : t.title, link: `#/comunicacao/tickets/${t.id}`, exclude: user.id });
  return getTicket(db, user, t.id);
}

function ticketFile(db, user, fileId) {
  guardTickets(user);
  const f = db.prepare('SELECT * FROM ticket_files WHERE id = ?').get(Number(fileId));
  if (!f) throw notFound('Arquivo não encontrado.');
  loadTicket(db, user, f.ticket_id);
  return f;
}

/* ------------------------- Resumo (contadores do menu) ------------------------- */

function summary(db, user) {
  const { hasModule } = require('../permissions');
  const out = { inbox: 0, tickets: 0, whatsapp: 0 };
  if (hasModule(user, 'inbox')) {
    out.inbox = db.prepare(`SELECT COUNT(*) AS n FROM chat_messages x JOIN chat_members m ON m.conversation_id = x.conversation_id AND m.user_id = ? AND m.left_at IS NULL
      WHERE x.id > m.last_read_id AND COALESCE(x.user_id, 0) <> ?`).get(user.id, user.id).n;
  }
  if (hasModule(user, 'tickets')) {
    out.tickets = db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE (assignee_id = ? AND status IN ('aberto','em_andamento')) OR (requester_id = ? AND status = 'devolvido')").get(user.id, user.id).n;
  }
  if (hasModule(user, 'whatsapp')) out.whatsapp = require('./whatsapp').unreadCount(db, user);
  return out;
}

module.exports = {
  directory, listConversations, openDirect, createGroup, updateGroup, messages, sendMessage, chatFile,
  createTicket, listTickets, getTicket, ticketAction, ticketFile, summary, STATUS_LABEL,
};
