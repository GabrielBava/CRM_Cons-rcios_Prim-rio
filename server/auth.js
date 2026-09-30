'use strict';
const { HttpError, badRequest, randomToken, sha256, hashPassword, verifyPassword, normalizeEmail, isValidEmail, clean, nowIso } = require('./util');
const { audit } = require('./core');

const SESSION_HOURS = Number(process.env.CRM_SESSION_HOURS) || 12;
const COOKIE = 'crm_sid';
const failures = new Map(); // tentativa de login -> { count, until }

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieHeader(req, value, maxAgeSeconds) {
  const secure = process.env.COOKIE_SECURE === '1' || req.headers['x-forwarded-proto'] === 'https';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

function createSession(db, req, res, userId) {
  const token = randomToken(32);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_HOURS * 3600 * 1000);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now.toISOString());
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(sha256(token), userId, now.toISOString(), expires.toISOString());
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now.toISOString(), userId);
  res.setHeader('Set-Cookie', cookieHeader(req, token, SESSION_HOURS * 3600));
}

function currentUser(db, req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha256(token));
  if (!s || Date.parse(s.expires_at) < Date.now()) return null;
  const u = db.prepare('SELECT id, name, email, role, team_id, active, modules FROM users WHERE id = ?').get(s.user_id);
  if (!u || !u.active) return null;
  // Renovação deslizante da sessão
  const remaining = Date.parse(s.expires_at) - Date.now();
  if (remaining < (SESSION_HOURS - 1) * 3600 * 1000) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString(), s.token_hash);
  }
  return u;
}

function needsSetup(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
}

function setup(db, req, res, body) {
  if (!needsSetup(db)) throw new HttpError(403, 'O administrador inicial já foi criado.');
  const name = clean(body.name);
  const email = normalizeEmail(body.email);
  if (!name) throw badRequest('Informe seu nome.');
  if (!email || !isValidEmail(email)) throw badRequest('E-mail inválido.');
  if (!body.password || String(body.password).length < 8) throw badRequest('A senha deve ter pelo menos 8 caracteres.');
  const now = nowIso();
  const r = db
    .prepare("INSERT INTO users (name, email, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, 'admin', ?, ?)")
    .run(name, email, hashPassword(body.password), now, now);
  const id = Number(r.lastInsertRowid);
  audit(db, { id }, 'user', id, 'administrador_inicial_criado', { email });
  createSession(db, req, res, id);
  return { ok: true };
}

function login(db, req, res, body) {
  const email = normalizeEmail(body.email) || '';
  const key = `${email}|${req.socket.remoteAddress}`;
  const f = failures.get(key);
  if (f && f.until && f.until > Date.now()) {
    throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
  }
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok = u && u.active && verifyPassword(String(body.password || ''), u.password_hash);
  if (!ok) {
    const count = (f?.count || 0) + 1;
    failures.set(key, { count, until: count >= 5 ? Date.now() + 15 * 60 * 1000 : null });
    throw new HttpError(401, 'E-mail ou senha inválidos.');
  }
  failures.delete(key);
  createSession(db, req, res, u.id);
  return { ok: true };
}

function logout(db, req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.setHeader('Set-Cookie', cookieHeader(req, '', 0));
  return { ok: true };
}

function changePassword(db, user, body) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  if (!verifyPassword(String(body.current || ''), u.password_hash)) throw badRequest('Senha atual incorreta.');
  if (!body.password || String(body.password).length < 8) throw badRequest('A nova senha deve ter pelo menos 8 caracteres.');
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hashPassword(body.password), nowIso(), u.id);
  audit(db, user, 'user', u.id, 'senha_alterada', null);
}

module.exports = { currentUser, needsSetup, setup, login, logout, changePassword };
