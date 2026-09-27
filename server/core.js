'use strict';
/**
 * Regras transversais: escopo de acesso por perfil, auditoria e utilidades de consulta.
 * Toda verificação de permissão acontece aqui, no servidor — a interface apenas reflete o resultado.
 */
const { forbidden, notFound, nowIso } = require('./util');

const ROLES = {
  admin: 'Administrador',
  gestor: 'Gestor',
  consultor: 'Consultor',
  leitura: 'Leitura',
};

/**
 * IDs de usuários cujos registros o usuário pode ver.
 * null = sem restrição (todos os registros).
 */
function visibleOwnerIds(db, user) {
  if (user.role === 'admin') return null;
  if (user.role === 'consultor') return [user.id];
  if (!user.team_id) return user.role === 'leitura' ? null : [user.id];
  const ids = db.prepare('SELECT id FROM users WHERE team_id = ?').all(user.team_id).map((r) => r.id);
  if (!ids.includes(user.id)) ids.push(user.id);
  return ids;
}

/** Gestores e perfis de leitura veem também registros ainda sem responsável. */
const seesUnassigned = (user) => user.role !== 'consultor';

/**
 * Fragmento SQL que limita contatos ao escopo do usuário.
 * Um contato é visível quando o responsável está no escopo ou quando alguma
 * oportunidade dele pertence a alguém do escopo.
 */
function contactScope(db, user, alias = 'c') {
  const ids = visibleOwnerIds(db, user);
  if (ids === null) return { sql: '1=1', params: [] };
  const ph = ids.map(() => '?').join(',');
  const unassigned = seesUnassigned(user) ? ` OR ${alias}.owner_id IS NULL` : '';
  return {
    sql: `(${alias}.owner_id IN (${ph})${unassigned} OR EXISTS (SELECT 1 FROM opportunities so WHERE so.contact_id = ${alias}.id AND so.owner_id IN (${ph})))`,
    params: [...ids, ...ids],
  };
}

/** Escopo aplicado a tabelas filhas que possuem contact_id. */
function childScope(db, user, alias) {
  const s = contactScope(db, user, 'sc');
  if (s.sql === '1=1') return s;
  return {
    sql: `EXISTS (SELECT 1 FROM contacts sc WHERE sc.id = ${alias}.contact_id AND ${s.sql})`,
    params: s.params,
  };
}

const canWrite = (user) => user.role !== 'leitura';
const isAdmin = (user) => user.role === 'admin';
const isManager = (user) => user.role === 'admin' || user.role === 'gestor';

function requireWrite(user) {
  if (!canWrite(user)) throw forbidden('Seu perfil é somente leitura.');
}
function requireAdmin(user) {
  if (!isAdmin(user)) throw forbidden('Apenas administradores podem realizar esta ação.');
}
function requireManager(user) {
  if (!isManager(user)) throw forbidden('Apenas gestores e administradores podem realizar esta ação.');
}

/** Carrega um contato verificando o escopo. Contatos mesclados redirecionam para o destino. */
function loadContact(db, user, id, { write = false } = {}) {
  const c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(Number(id));
  if (!c) throw notFound('Cadastro não encontrado.');
  const s = contactScope(db, user, 'c');
  const ok = db.prepare(`SELECT 1 FROM contacts c WHERE c.id = ? AND ${s.sql}`).get(c.id, ...s.params);
  if (!ok) throw notFound('Cadastro não encontrado ou fora do seu escopo de acesso.');
  if (write) requireWrite(user);
  return c;
}

/** Valida se o usuário pode atribuir o registro ao responsável indicado. */
function assertAssignable(db, user, ownerId) {
  if (ownerId == null) {
    if (user.role === 'consultor') throw forbidden('Consultores devem ser responsáveis pelos próprios registros.');
    return;
  }
  const owner = db.prepare('SELECT id, active FROM users WHERE id = ?').get(Number(ownerId));
  if (!owner || !owner.active) throw forbidden('Responsável inválido ou inativo.');
  const ids = visibleOwnerIds(db, user);
  if (user.role === 'consultor' && Number(ownerId) !== user.id) {
    throw forbidden('Consultores não podem transferir registros para outros usuários.');
  }
  if (ids !== null && !ids.includes(Number(ownerId))) throw forbidden('Responsável fora da sua equipe.');
}

function audit(db, user, entity, entityId, action, changes, contactId) {
  db.prepare(
    'INSERT INTO audit_log (entity, entity_id, contact_id, action, changes, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    entity,
    entityId ?? null,
    contactId ?? null,
    action,
    changes ? JSON.stringify(changes) : null,
    user ? user.id : null,
    nowIso(),
  );
}

/** Retorna { campo: [antes, depois] } apenas para campos alterados. */
function diff(before, after, fields) {
  const out = {};
  for (const f of fields) {
    if (!(f in after) || after[f] === undefined) continue;
    const a = before[f] ?? null;
    const b = after[f] ?? null;
    if (String(a) !== String(b)) out[f] = [a, b];
  }
  return out;
}

/** Monta UPDATE parcial com os campos permitidos presentes em data. */
function buildUpdate(table, id, data, allowed) {
  const sets = [];
  const params = [];
  for (const f of allowed) {
    if (data[f] !== undefined) {
      sets.push(`${f} = ?`);
      params.push(data[f]);
    }
  }
  if (!sets.length) return null;
  return { sql: `UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`, params: [...params, id] };
}

function optionLabel(db, list, value) {
  if (value == null) return null;
  const r = db.prepare('SELECT label FROM options WHERE list = ? AND value = ?').get(list, value);
  return r ? r.label : value;
}

function paging(q) {
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 500);
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  return { limit, offset: (page - 1) * limit, page };
}

module.exports = {
  ROLES,
  visibleOwnerIds,
  contactScope,
  childScope,
  canWrite,
  isAdmin,
  isManager,
  requireWrite,
  requireAdmin,
  requireManager,
  loadContact,
  assertAssignable,
  audit,
  diff,
  buildUpdate,
  optionLabel,
  paging,
};
