'use strict';
const C = require('../constants');
const { ROLES, requireAdmin, requireManager, audit, isAdmin, visibleOwnerIds } = require('../core');
const { badRequest, notFound, conflict, clean, normalizeEmail, isValidEmail, hashPassword, nowIso } = require('../util');
const { getSetting, setSetting } = require('../db');
const { simulatorAvailability } = require('./simulations');

/* ------------------------- Usuários e equipes ------------------------- */

function listUsers(db, user) {
  const rows = db
    .prepare('SELECT u.id, u.name, u.email, u.role, u.team_id, u.active, u.dialer_agent_ref, u.created_at, u.last_login_at, t.name AS team_name FROM users u LEFT JOIN teams t ON t.id = u.team_id ORDER BY u.active DESC, u.name')
    .all();
  if (isAdmin(user)) return rows;
  const ids = visibleOwnerIds(db, user);
  return rows.filter((r) => ids === null || ids.includes(r.id)).map(({ id, name, role, team_name, active }) => ({ id, name, role, team_name, active }));
}

function validatePassword(p) {
  if (!p || String(p).length < 8) throw badRequest('A senha deve ter pelo menos 8 caracteres.');
}

function saveUser(db, user, data) {
  requireAdmin(user);
  const name = clean(data.name);
  const email = normalizeEmail(data.email);
  if (!name) throw badRequest('Informe o nome.');
  if (!email || !isValidEmail(email)) throw badRequest('E-mail inválido.');
  if (!ROLES[data.role]) throw badRequest('Perfil inválido.');
  const teamId = data.team_id ? Number(data.team_id) : null;
  if (teamId && !db.prepare('SELECT 1 FROM teams WHERE id = ?').get(teamId)) throw badRequest('Equipe inválida.');
  const agent = clean(data.dialer_agent_ref);
  const now = nowIso();
  const dupe = db.prepare('SELECT id FROM users WHERE email = ? AND id <> ?').get(email, Number(data.id) || 0);
  if (dupe) throw conflict('Já existe um usuário com este e-mail.');
  if (data.id) {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(data.id));
    if (!u) throw notFound();
    const active = data.active === undefined ? u.active : data.active ? 1 : 0;
    if (u.id === user.id && (data.role !== 'admin' || !active)) throw badRequest('Você não pode remover seu próprio acesso de administrador.');
    if (u.role === 'admin' && (data.role !== 'admin' || !active)) {
      const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get().n;
      if (admins <= 1) throw badRequest('É necessário manter ao menos um administrador ativo.');
    }
    db.prepare('UPDATE users SET name = ?, email = ?, role = ?, team_id = ?, dialer_agent_ref = ?, active = ?, updated_at = ? WHERE id = ?').run(name, email, data.role, teamId, agent ?? null, active, now, u.id);
    if (data.password) {
      validatePassword(data.password);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(data.password), u.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    }
    if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    audit(db, user, 'user', u.id, 'alterado', { perfil: [u.role, data.role], ativo: [u.active, active], senha_alterada: !!data.password });
    return u.id;
  }
  validatePassword(data.password);
  const r = db
    .prepare('INSERT INTO users (name, email, password_hash, role, team_id, dialer_agent_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(name, email, hashPassword(data.password), data.role, teamId, agent ?? null, now, now);
  audit(db, user, 'user', Number(r.lastInsertRowid), 'criado', { email, perfil: data.role });
  return Number(r.lastInsertRowid);
}

function listTeams(db) {
  return db.prepare('SELECT t.*, (SELECT COUNT(*) FROM users u WHERE u.team_id = t.id) AS members FROM teams t ORDER BY name').all();
}

function saveTeam(db, user, data) {
  requireAdmin(user);
  const name = clean(data.name);
  if (!name) throw badRequest('Informe o nome da equipe.');
  if (data.id) {
    db.prepare('UPDATE teams SET name = ? WHERE id = ?').run(name, Number(data.id));
    return Number(data.id);
  }
  const r = db.prepare('INSERT INTO teams (name, created_at) VALUES (?, ?)').run(name, nowIso());
  audit(db, user, 'team', Number(r.lastInsertRowid), 'criada', { name });
  return Number(r.lastInsertRowid);
}

/* ------------------------- Listas configuráveis ------------------------- */

const LIST_LABELS = {
  origem: 'Origens do lead',
  categoria_credito: 'Categorias de crédito',
  estrategia: 'Estratégias',
  tipo_contemplacao: 'Tipos de contemplação',
  modalidade_pagamento: 'Modalidades de pagamento',
  urgencia: 'Urgência / horizonte de compra',
  motivo_perda: 'Motivos de perda',
  resultado_ligacao: 'Resultados de ligação',
  canal: 'Canais de atividade',
  frequencia_contato: 'Frequência de contato',
  status_contrato: 'Status de contrato',
  indice_reajuste: 'Índices de reajuste',
  segmento: 'Segmentos (PJ)',
  porte: 'Porte (PJ)',
};
// Valores usados por regras do sistema não podem ser removidos
const PROTECTED = { resultado_ligacao: ['nao_informado', 'outro'], origem: ['importacao', 'outra'] };

function saveOption(db, user, data) {
  requireAdmin(user);
  if (!LIST_LABELS[data.list]) throw badRequest('Lista inválida.');
  const label = clean(data.label);
  if (!label) throw badRequest('Informe o rótulo.');
  const flags = typeof data.flags === 'object' && data.flags ? JSON.stringify(data.flags) : '{}';
  if (data.id) {
    const o = db.prepare('SELECT * FROM options WHERE id = ?').get(Number(data.id));
    if (!o) throw notFound();
    const active = data.active === undefined ? o.active : data.active ? 1 : 0;
    if (!active && (PROTECTED[o.list] || []).includes(o.value)) throw badRequest('Este valor é usado por regras do sistema e não pode ser desativado.');
    db.prepare('UPDATE options SET label = ?, active = ?, flags = ?, position = COALESCE(?, position) WHERE id = ?').run(label, active, flags, data.position ?? null, o.id);
    audit(db, user, 'option', o.id, 'alterada', { lista: o.list, valor: o.value, rotulo: [o.label, label], ativo: [o.active, active] });
    return o.id;
  }
  const value =
    clean(data.value) ||
    label
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
  if (db.prepare('SELECT 1 FROM options WHERE list = ? AND value = ?').get(data.list, value)) throw conflict('Já existe um item com este identificador.');
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM options WHERE list = ?').get(data.list).p;
  const r = db.prepare('INSERT INTO options (list, value, label, position, flags) VALUES (?, ?, ?, ?, ?)').run(data.list, value, label, pos, flags);
  audit(db, user, 'option', Number(r.lastInsertRowid), 'criada', { lista: data.list, valor: value });
  return Number(r.lastInsertRowid);
}

/* ------------------------- Produtos ------------------------- */

function listProducts(db) {
  return db
    .prepare(`SELECT p.*, (SELECT COUNT(*) FROM opportunities o WHERE o.product_id = p.id) AS opportunities, (SELECT COUNT(*) FROM contracts k WHERE k.product_id = p.id) AS contracts
      FROM products p ORDER BY p.active DESC, p.name`)
    .all();
}

function saveProduct(db, user, data) {
  requireManager(user);
  const name = clean(data.name);
  if (!name) throw badRequest('Informe o nome do produto.');
  const category = clean(data.category);
  if (category && !db.prepare("SELECT 1 FROM options WHERE list = 'categoria_credito' AND value = ?").get(category)) throw badRequest('Categoria inválida.');
  const now = nowIso();
  if (data.id) {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(data.id));
    if (!p) throw notFound();
    const active = data.active === undefined ? p.active : data.active ? 1 : 0;
    db.prepare('UPDATE products SET name = ?, category = ?, administrator = ?, description = ?, active = ?, updated_at = ? WHERE id = ?').run(
      name, category ?? null, clean(data.administrator) ?? null, clean(data.description) ?? null, active, now, p.id,
    );
    audit(db, user, 'product', p.id, 'alterado', { nome: [p.name, name], ativo: [p.active, active] });
    return p.id;
  }
  const r = db
    .prepare('INSERT INTO products (name, category, administrator, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name, category ?? null, clean(data.administrator) ?? null, clean(data.description) ?? null, now, now);
  audit(db, user, 'product', Number(r.lastInsertRowid), 'criado', { nome: name });
  return Number(r.lastInsertRowid);
}

/* ------------------------- Campos adicionais ------------------------- */

function saveCustomField(db, user, data) {
  requireAdmin(user);
  const label = clean(data.label);
  if (!label) throw badRequest('Informe o rótulo do campo.');
  if (!['contact', 'opportunity'].includes(data.entity)) throw badRequest('Entidade inválida.');
  if (!['text', 'number', 'date', 'select', 'boolean', 'textarea'].includes(data.type)) throw badRequest('Tipo de campo inválido.');
  let options = null;
  if (data.type === 'select') {
    const list = (Array.isArray(data.options) ? data.options : String(data.options || '').split('\n')).map((s) => String(s).trim()).filter(Boolean);
    if (!list.length) throw badRequest('Informe as opções (uma por linha).');
    options = JSON.stringify(list);
  }
  if (data.id) {
    db.prepare('UPDATE custom_fields SET label = ?, type = ?, options = ?, active = ? WHERE id = ?').run(label, data.type, options, data.active === false ? 0 : 1, Number(data.id));
    audit(db, user, 'custom_field', Number(data.id), 'alterado', { rotulo: label });
    return Number(data.id);
  }
  const key = label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (db.prepare('SELECT 1 FROM custom_fields WHERE entity = ? AND key = ?').get(data.entity, key)) throw conflict('Já existe um campo com este nome.');
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM custom_fields WHERE entity = ?').get(data.entity).p;
  const r = db.prepare('INSERT INTO custom_fields (entity, key, label, type, options, position) VALUES (?, ?, ?, ?, ?, ?)').run(data.entity, key, label, data.type, options, pos);
  audit(db, user, 'custom_field', Number(r.lastInsertRowid), 'criado', { entidade: data.entity, rotulo: label });
  return Number(r.lastInsertRowid);
}

/* ------------------------- Configurações gerais ------------------------- */

function saveSettings(db, user, data) {
  requireAdmin(user);
  if (data.stalled_days !== undefined) {
    const n = Number(data.stalled_days);
    if (!Number.isInteger(n) || n < 1 || n > 365) throw badRequest('Dias para considerar parado: entre 1 e 365.');
    setSetting(db, 'stalled_days', n);
  }
  if (data.simulation_link_hours !== undefined) {
    const n = Number(data.simulation_link_hours);
    if (!Number.isInteger(n) || n < 1 || n > 168) throw badRequest('Validade do link do simulador: entre 1 e 168 horas.');
    setSetting(db, 'simulation_link_hours', n);
  }
  if (data.field_config !== undefined) {
    if (typeof data.field_config !== 'object' || !data.field_config) throw badRequest('Configuração de campos inválida.');
    setSetting(db, 'field_config', data.field_config);
  }
  audit(db, user, 'settings', null, 'alteradas', { campos: Object.keys(data) });
}

function globalAudit(db, user, q) {
  requireAdmin(user);
  const where = ['1=1'];
  const params = [];
  if (q.entity) {
    where.push('a.entity = ?');
    params.push(q.entity);
  }
  if (q.user_id) {
    where.push('a.user_id = ?');
    params.push(Number(q.user_id));
  }
  return db
    .prepare(`SELECT a.*, u.name AS user_name, c.code AS contact_code FROM audit_log a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN contacts c ON c.id = a.contact_id
      WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT 300`)
    .all(...params)
    .map((r) => ({ ...r, changes: r.changes ? JSON.parse(r.changes) : null }));
}

/** Metadados usados pela interface (listas, etapas, produtos, usuários, constantes). */
function meta(db, user) {
  const options = {};
  for (const o of db.prepare('SELECT id, list, value, label, active, position, flags FROM options ORDER BY list, position, id').all()) {
    (options[o.list] ||= []).push({ ...o, flags: JSON.parse(o.flags || '{}') });
  }
  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role, role_label: ROLES[user.role], team_id: user.team_id },
    roles: ROLES,
    options,
    list_labels: LIST_LABELS,
    stages: db.prepare('SELECT * FROM pipeline_stages WHERE active = 1 ORDER BY position').all(),
    products: db.prepare('SELECT id, name, category, administrator, active FROM products ORDER BY active DESC, name').all(),
    users: listUsers(db, user).filter((u) => u.active),
    teams: listTeams(db),
    custom_fields: db.prepare('SELECT * FROM custom_fields WHERE active = 1 ORDER BY entity, position').all().map((f) => ({ ...f, options: f.options ? JSON.parse(f.options) : null })),
    settings: { stalled_days: getSetting(db, 'stalled_days'), simulation_link_hours: getSetting(db, 'simulation_link_hours'), field_config: getSetting(db, 'field_config') || {} },
    simulator: simulatorAvailability(db),
    constants: {
      activity_types: C.ACTIVITY_TYPES,
      relationships: C.RELATIONSHIPS,
      lead_status: C.LEAD_STATUS,
      client_status: C.CLIENT_STATUS,
      opp_status: C.OPP_STATUS,
      priorities: C.PRIORITIES,
      proposal_status: C.PROPOSAL_STATUS,
      simulation_status: C.SIMULATION_STATUS,
      task_types: C.TASK_TYPES,
      meeting_outcomes: C.MEETING_OUTCOMES,
      contact_channels: C.CONTACT_CHANNELS,
      data_request_types: C.DATA_REQUEST_TYPES,
      integration_status: C.INTEGRATION_STATUS,
      dialer_fields: C.DIALER_FIELDS,
    },
  };
}

module.exports = { listUsers, saveUser, listTeams, saveTeam, saveOption, listProducts, saveProduct, saveCustomField, saveSettings, globalAudit, meta, LIST_LABELS };
