'use strict';
/**
 * Meu cadastro: dados que o próprio usuário mantém (telefone, WhatsApp, cargo, foto, apresentação, especialidades,
 * chave PIX para comissões e registro profissional). E-mail de acesso, perfil e equipe são definidos pelo administrador.
 */
const { ROLES, audit } = require('../core');
const { badRequest, clean, digits, toDateOnly, nowIso } = require('../util');

const MAX_PHOTO = 400 * 1024;

function getProfile(db, user) {
  const u = db
    .prepare(`SELECT u.id, u.name, u.email, u.role, u.team_id, u.phone, u.whatsapp, u.job_title, u.birth_date, u.photo, u.bio, u.specialties,
      u.pix_key, u.professional_reg, u.created_at, u.last_login_at, u.password_changed_at, t.name AS team_name, l.name AS leader_name
      FROM users u LEFT JOIN teams t ON t.id = u.team_id LEFT JOIN users l ON l.id = t.leader_id WHERE u.id = ?`)
    .get(user.id);
  let specialties = [];
  try {
    specialties = JSON.parse(u.specialties || '[]');
  } catch {}
  return {
    ...u,
    specialties,
    role_label: ROLES[u.role],
    active_sessions: db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?').get(user.id, nowIso()).n,
  };
}

const phoneOk = (v) => {
  const d = digits(v);
  return !d || (d.length >= 10 && d.length <= 13);
};

function saveProfile(db, user, data) {
  const o = {};
  if (data.name !== undefined) {
    o.name = clean(data.name);
    if (!o.name || o.name.length < 3) throw badRequest('Informe seu nome completo.');
  }
  for (const f of ['phone', 'whatsapp']) {
    if (data[f] !== undefined) {
      o[f] = clean(data[f]);
      if (!phoneOk(o[f])) throw badRequest(`${f === 'phone' ? 'Telefone' : 'WhatsApp'} inválido: informe DDD e número.`);
    }
  }
  if (data.job_title !== undefined) o.job_title = clean(data.job_title)?.slice(0, 80) ?? null;
  if (data.professional_reg !== undefined) o.professional_reg = clean(data.professional_reg)?.slice(0, 80) ?? null;
  if (data.pix_key !== undefined) o.pix_key = clean(data.pix_key)?.slice(0, 120) ?? null;
  if (data.bio !== undefined) {
    o.bio = clean(data.bio);
    if (o.bio && o.bio.length > 500) throw badRequest('A apresentação pode ter até 500 caracteres.');
  }
  if (data.birth_date !== undefined) {
    o.birth_date = toDateOnly(data.birth_date);
    if (data.birth_date && !o.birth_date) throw badRequest('Data de nascimento inválida.');
    if (o.birth_date && (o.birth_date > nowIso().slice(0, 10) || o.birth_date < '1900-01-01')) throw badRequest('Data de nascimento inválida.');
  }
  if (data.specialties !== undefined) {
    const valid = new Set(db.prepare("SELECT value FROM options WHERE list = 'categoria_credito'").all().map((r) => r.value));
    o.specialties = JSON.stringify((Array.isArray(data.specialties) ? data.specialties : []).filter((v) => valid.has(v)));
  }
  const keys = Object.keys(o);
  if (!keys.length) return;
  db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => o[k] ?? null), nowIso(), user.id);
  audit(db, user, 'user', user.id, 'cadastro_proprio_alterado', { campos: keys });
}

/** Foto do perfil: imagem já reduzida no navegador (JPEG, PNG ou WebP, até 400 KB). Vazio remove a foto. */
function savePhoto(db, user, data) {
  const photo = data.photo;
  if (!photo) {
    db.prepare('UPDATE users SET photo = NULL, updated_at = ? WHERE id = ?').run(nowIso(), user.id);
    audit(db, user, 'user', user.id, 'foto_removida', null);
    return { photo: null };
  }
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(photo));
  if (!m) throw badRequest('Envie a foto em JPG, PNG ou WebP.');
  const size = Math.floor((m[2].length * 3) / 4);
  if (size > MAX_PHOTO) throw badRequest('Foto muito grande. Use uma imagem menor (até 400 KB).');
  db.prepare('UPDATE users SET photo = ?, updated_at = ? WHERE id = ?').run(photo, nowIso(), user.id);
  audit(db, user, 'user', user.id, 'foto_alterada', null);
  return { photo };
}

module.exports = { getProfile, saveProfile, savePhoto };
