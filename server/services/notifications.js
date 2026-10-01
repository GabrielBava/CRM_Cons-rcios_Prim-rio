'use strict';
/**
 * Notificações da plataforma (sino no topo da tela). Cada evento relevante gera um aviso para quem precisa agir:
 * lead distribuído, tarefa atribuída, cliente acessou/concluiu a ficha, pré-venda parada, venda confirmada,
 * comissão liberada, cancelamento, pesquisa de satisfação respondida, treinamento obrigatório, senha alterada.
 */
const { nowIso } = require('../util');

const LEVELS = ['info', 'ok', 'warn', 'danger'];

/**
 * Cria a notificação para um ou mais usuários. Usuários inativos e repetidos são ignorados.
 * dedupe: não repete o mesmo aviso (tipo + link) ainda não lido.
 */
function notify(db, userIds, { kind, title, body = null, link = null, level = 'info', exclude = null, dedupe = false }) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean).map(Number))].filter((id) => id !== exclude);
  if (!ids.length || !title) return 0;
  const now = nowIso();
  let n = 0;
  for (const id of ids) {
    if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(id)) continue;
    if (dedupe && db.prepare('SELECT 1 FROM notifications WHERE user_id = ? AND kind = ? AND COALESCE(link, \'\') = ? AND read_at IS NULL').get(id, kind, link || '')) continue;
    db.prepare('INSERT INTO notifications (user_id, kind, level, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, kind, LEVELS.includes(level) ? level : 'info', String(title).slice(0, 200), body ? String(body).slice(0, 500) : null, link, now);
    n++;
  }
  return n;
}

/** Administradores ativos e o líder da equipe do usuário (para avisos de gestão). */
function managersOf(db, userId) {
  const admins = db.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1").all().map((u) => u.id);
  const u = userId ? db.prepare('SELECT team_id FROM users WHERE id = ?').get(userId) : null;
  const leader = u?.team_id ? db.prepare('SELECT leader_id FROM teams WHERE id = ?').get(u.team_id)?.leader_id : null;
  return [...admins, leader].filter(Boolean);
}

function list(db, user, q = {}) {
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 30));
  const rows = db
    .prepare(`SELECT id, kind, level, title, body, link, created_at, read_at FROM notifications WHERE user_id = ? ${q.unread === '1' ? 'AND read_at IS NULL' : ''}
      ORDER BY read_at IS NOT NULL, created_at DESC, id DESC LIMIT ?`)
    .all(user.id, limit);
  const unread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(user.id).n;
  return { rows, unread };
}

function markRead(db, user, data = {}) {
  const now = nowIso();
  if (data.all) return { updated: db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now, user.id).changes };
  const ids = (Array.isArray(data.ids) ? data.ids : []).map(Number).filter(Boolean);
  if (!ids.length) return { updated: 0 };
  return {
    updated: db.prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`).run(now, user.id, ...ids).changes,
  };
}

/** Remove avisos lidos com mais de 90 dias (rotina de manutenção). */
function cleanup(db) {
  return db.prepare('DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at < ?').run(new Date(Date.now() - 90 * 86400000).toISOString()).changes;
}

module.exports = { notify, managersOf, list, markRead, cleanup };
