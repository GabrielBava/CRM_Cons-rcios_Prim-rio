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
  const u = db.prepare('SELECT id, name, email, role, team_id, active, modules, photo, job_title, must_change_password FROM users WHERE id = ?').get(s.user_id);
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

const COMMON_PASSWORDS = new Set(['12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', 'password', 'password1', 'senha123',
  'senha1234', 'senha12345', 'mudar123', 'qwerty123', 'abc12345', 'abcd1234', 'admin123', 'consorcio', 'consorcio1', 'brasil123', 'iloveyou']);

/**
 * Política de senha (boas práticas de mercado): mínimo de 8 caracteres, letras e números, diferente da atual,
 * sem conter o nome ou o e-mail e fora da lista de senhas comuns.
 */
function passwordProblems(pwd, { name = '', email = '' } = {}) {
  const p = String(pwd || '');
  const low = p.toLowerCase();
  const out = [];
  if (p.length < 8) out.push('ter pelo menos 8 caracteres');
  if (p.length > 128) out.push('ter no máximo 128 caracteres');
  if (!/[a-zA-ZÀ-ÿ]/.test(p) || !/\d/.test(p)) out.push('combinar letras e números');
  if (COMMON_PASSWORDS.has(low)) out.push('não ser uma senha comum');
  const local = String(email).split('@')[0].toLowerCase();
  const first = String(name).trim().split(/\s+/)[0]?.toLowerCase() || '';
  if ((local.length >= 4 && low.includes(local)) || (first.length >= 3 && low.includes(first))) out.push('não conter seu nome ou e-mail');
  return out;
}

/**
 * Troca da própria senha: confere a senha atual (com limite de tentativas), valida a nova e a confirmação,
 * e encerra as sessões abertas em outros dispositivos.
 */
function changePassword(db, req, user, body) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  const key = `senha|${u.id}`;
  const f = failures.get(key);
  if (f && f.until && f.until > Date.now()) throw new HttpError(429, 'Muitas tentativas com a senha atual incorreta. Aguarde 15 minutos e tente novamente.');
  if (!verifyPassword(String(body.current || ''), u.password_hash)) {
    const count = (f?.count || 0) + 1;
    failures.set(key, { count, until: count >= 5 ? Date.now() + 15 * 60 * 1000 : null });
    throw badRequest(count >= 5 ? 'Senha atual incorreta. Por segurança, a troca foi bloqueada por 15 minutos.' : `Senha atual incorreta (${count} de 5 tentativas).`);
  }
  failures.delete(key);
  const pwd = String(body.password || '');
  if (body.confirm !== undefined && pwd !== String(body.confirm)) throw badRequest('A confirmação não confere com a nova senha.');
  if (verifyPassword(pwd, u.password_hash)) throw badRequest('A nova senha deve ser diferente da atual.');
  const problems = passwordProblems(pwd, u);
  if (problems.length) throw badRequest(`A nova senha precisa ${problems.join(', ')}.`, { problems });
  const now = nowIso();
  // Senha provisória trocada: libera a plataforma e marca a etapa 1 da trilha de integração
  let ob = {};
  try {
    ob = JSON.parse(u.onboarding || '{}') || {};
  } catch {}
  if (ob.active) ob.steps = { ...(ob.steps || {}), senha: ob.steps?.senha || now };
  db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ?, must_change_password = 0, onboarding = ?, updated_at = ? WHERE id = ?').run(hashPassword(pwd), now, JSON.stringify(ob), now, u.id);
  // Mantém só a sessão atual: quem estiver usando a senha antiga em outro aparelho é desconectado
  const token = req ? parseCookies(req.headers.cookie)[COOKIE] : null;
  const ended = db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(u.id, token ? sha256(token) : '').changes;
  audit(db, user, 'user', u.id, 'senha_alterada', { sessoes_encerradas: ended });
  require('./services/notifications').notify(db, u.id, { kind: 'seguranca', level: 'warn', title: 'Sua senha foi alterada', body: 'Se não foi você, avise o administrador imediatamente.', link: '#/meu-cadastro' });
  return { ok: true, sessions_ended: ended };
}

module.exports = { currentUser, needsSetup, setup, login, logout, changePassword, passwordProblems };
