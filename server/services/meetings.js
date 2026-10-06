'use strict';
/**
 * Agendamento da R1 (reunião de diagnóstico) e integração com o Google Agenda do especialista.
 *
 * O mesmo agendamento é usado no funil (Lead qualificado → R1), no painel lateral, na ficha do cliente e na Agenda:
 *  - o cliente é obrigatório (o e-mail dele recebe o convite);
 *  - horário em passos de 15 minutos, 30 minutos de duração por padrão;
 *  - título "[R1] Nome do cliente | Vero Consórcios";
 *  - com o Google Agenda conectado: o evento é criado na agenda do especialista com link do Google Meet e o
 *    Google envia o convite ao cliente; o link da reunião fica salvo no CRM.
 *  - sem o Google conectado: a tarefa é criada no CRM e o especialista abre o evento já preenchido no Google Agenda.
 *
 * Conexão (OAuth 2.0 por usuário): o administrador informa o ID e a chave do cliente OAuth do Google Cloud
 * (ou as variáveis GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET); cada especialista conecta a própria agenda em Meu cadastro.
 */
const { loadContact, audit } = require('../core');
const { HttpError, badRequest, clean, nowIso, normalizeEmail, sealSecret, openSecret, randomToken } = require('../util');
const { tx, getSetting } = require('../db');

const MEET_SCOPE = 'https://www.googleapis.com/auth/meetings.space.readonly';
// Agenda (criar o evento com Meet e convidar o cliente) e leitura das reuniões do Meet (presença na R1)
const SCOPES = ['https://www.googleapis.com/auth/calendar.events', MEET_SCOPE, 'openid', 'email'];
const TZ = 'America/Sao_Paulo';

/* ------------------------- Configuração do Google ------------------------- */

function googleConfig(db) {
  const id = process.env.GOOGLE_CLIENT_ID || getSetting(db, 'google_client_id') || '';
  const secret = process.env.GOOGLE_CLIENT_SECRET || openSecret(getSetting(db, 'google_client_secret_enc')) || '';
  return { clientId: id, clientSecret: secret, configured: !!(id && secret), fromEnv: !!process.env.GOOGLE_CLIENT_ID };
}

/** Endereço público do CRM (para o retorno do Google): configuração, variável PUBLIC_URL ou o endereço da requisição. */
function publicUrl(db, req) {
  const set = process.env.PUBLIC_URL || getSetting(db, 'public_url');
  if (set) return String(set).replace(/\/+$/, '');
  const h = req?.headers || {};
  const proto = String(h['x-forwarded-proto'] || '').split(',')[0] || (req?.socket?.encrypted ? 'https' : 'http');
  return `${proto}://${h['x-forwarded-host'] || h.host || 'localhost'}`;
}
const redirectUri = (db, req) => `${publicUrl(db, req)}/api/google/retorno`;

function saveGoogleConfig(db, user, data) {
  if (user.role !== 'admin') throw new HttpError(403, 'Apenas o administrador configura o Google Agenda.');
  const id = clean(data.client_id);
  if (id && !/\.apps\.googleusercontent\.com$/.test(id)) throw badRequest('O ID do cliente OAuth termina em ".apps.googleusercontent.com".');
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  up.run('google_client_id', JSON.stringify(id || ''));
  if (data.client_secret) up.run('google_client_secret_enc', JSON.stringify(sealSecret(String(data.client_secret).trim())));
  if (data.client_secret === '' && !id) up.run('google_client_secret_enc', JSON.stringify(null));
  if (data.public_url !== undefined) {
    const u = clean(data.public_url);
    if (u && !/^https?:\/\/[^\s/]+/.test(u)) throw badRequest('Endereço público inválido (ex.: https://crm.veroconsorcios.com.br).');
    up.run('public_url', JSON.stringify(u ? u.replace(/\/+$/, '') : ''));
  }
  audit(db, user, 'settings', null, 'google_agenda_configurado', { client_id: id ? 'informado' : 'removido' });
}

function googleStatus(db, user, req) {
  const cfg = googleConfig(db);
  const u = db.prepare('SELECT google_email, google_connected_at, google_scopes FROM users WHERE id = ?').get(user.id) || {};
  const meetAccess = !!u.google_connected_at && String(u.google_scopes || '').includes(MEET_SCOPE);
  return {
    configured: cfg.configured,
    from_env: cfg.fromEnv,
    client_id: user.role === 'admin' ? cfg.clientId : undefined,
    has_secret: user.role === 'admin' ? !!cfg.clientSecret : undefined,
    redirect_uri: redirectUri(db, req),
    public_url: getSetting(db, 'public_url') || '',
    connected: !!u.google_connected_at,
    google_email: u.google_email || null,
    connected_at: u.google_connected_at || null,
    // Conexões antigas (só agenda) precisam ser refeitas para liberar a presença automática pelo Meet
    meet_access: meetAccess,
    needs_reconnect: !!u.google_connected_at && !meetAccess,
  };
}

/* ------------------------- OAuth ------------------------- */

const states = new Map(); // state → { userId, expires }

function connectUrl(db, user, req, opts = {}) {
  const cfg = googleConfig(db);
  if (!cfg.configured) throw badRequest('O Google Agenda ainda não foi configurado pelo administrador (Configurações › Integrações).');
  const state = randomToken(18);
  states.set(state, { userId: user.id, expires: Date.now() + 10 * 60 * 1000, popup: !!opts.popup });
  for (const [k, v] of states) if (v.expires < Date.now()) states.delete(k);
  const q = new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: redirectUri(db, req), response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` };
}

async function tokenRequest(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(502, `O Google recusou a autorização (${d.error_description || d.error || r.status}).`);
  return d;
}

const idTokenClaims = (t) => {
  try {
    return JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString('utf8')) || {};
  } catch {
    return {};
  }
};

/** Retorno do Google (navegador do usuário): troca o código pelo token de atualização e volta para Meu cadastro. */
async function oauthCallback(db, req, res, query) {
  const st = states.get(String(query.state || ''));
  // Conexão aberta pelo pop-up "Agendar R1": a guia do Google se fecha sozinha e o pop-up segue o agendamento
  const back = (status) => {
    res.writeHead(302, { Location: `/#/meu-cadastro?google=${status}${st?.popup ? '&fechar=1' : ''}` });
    res.end();
  };
  states.delete(String(query.state || ''));
  if (!st || st.expires < Date.now()) return back('expirado');
  if (query.error || !query.code) return back('cancelado');
  const cfg = googleConfig(db);
  try {
    const t = await tokenRequest({ code: query.code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: redirectUri(db, req), grant_type: 'authorization_code' });
    if (!t.refresh_token) return back('sem_permissao');
    const claims = idTokenClaims(t.id_token);
    const email = claims.email || null;
    db.prepare('UPDATE users SET google_refresh_token_enc = ?, google_email = ?, google_sub = ?, google_scopes = ?, google_connected_at = ?, updated_at = ? WHERE id = ?')
      .run(sealSecret(t.refresh_token), email, claims.sub || null, String(t.scope || SCOPES.join(' ')), nowIso(), nowIso(), st.userId);
    audit(db, { id: st.userId }, 'user', st.userId, 'google_agenda_conectado', { conta: email });
    accessCache.set(st.userId, { token: t.access_token, expires: Date.now() + (Number(t.expires_in) || 3000) * 1000 - 60000 });
    return back('ok');
  } catch (e) {
    console.error('Google OAuth:', e.message);
    return back('erro');
  }
}

function disconnect(db, user) {
  db.prepare('UPDATE users SET google_refresh_token_enc = NULL, google_email = NULL, google_sub = NULL, google_scopes = NULL, google_connected_at = NULL, updated_at = ? WHERE id = ?').run(nowIso(), user.id);
  accessCache.delete(user.id);
  audit(db, user, 'user', user.id, 'google_agenda_desconectado', null);
}

const accessCache = new Map(); // userId → { token, expires }

async function accessToken(db, userId) {
  const c = accessCache.get(userId);
  if (c && c.expires > Date.now()) return c.token;
  const u = db.prepare('SELECT google_refresh_token_enc FROM users WHERE id = ?').get(userId);
  const refresh = openSecret(u?.google_refresh_token_enc);
  if (!refresh) return null;
  const cfg = googleConfig(db);
  if (!cfg.configured) return null;
  const t = await tokenRequest({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: refresh, grant_type: 'refresh_token' });
  accessCache.set(userId, { token: t.access_token, expires: Date.now() + (Number(t.expires_in) || 3000) * 1000 - 60000 });
  return t.access_token;
}

/** Cria (ou atualiza) o evento na agenda principal do especialista, com Google Meet e convite ao cliente. */
async function upsertGoogleEvent(db, userId, ev, existingId) {
  const token = await accessToken(db, userId);
  if (!token) return null;
  const body = {
    summary: ev.title,
    description: ev.description,
    start: { dateTime: ev.start, timeZone: TZ },
    end: { dateTime: ev.end, timeZone: TZ },
    attendees: [...(ev.email ? [{ email: ev.email, displayName: ev.name }] : []), ...(ev.extraAttendees || [])],
    reminders: { useDefault: true },
  };
  if (ev.video && !existingId) body.conferenceData = { createRequest: { requestId: randomToken(12), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  const base = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
  const url = `${base}${existingId ? `/${encodeURIComponent(existingId)}` : ''}?conferenceDataVersion=1&sendUpdates=${ev.email || ev.extraAttendees?.length ? 'all' : 'none'}`;
  const r = await fetch(url, { method: existingId ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(502, `O Google Agenda recusou o evento: ${d.error?.message || r.status}.`);
  const meet = d.hangoutLink || d.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri || null;
  return { id: d.id, meet, html_link: d.htmlLink || null };
}

/* ------------------------- Agendamento da R1 ------------------------- */

const pad = (n) => String(n).padStart(2, '0');
/** Data no formato do Google Agenda (AAAAMMDDTHHMMSSZ, em UTC). */
const gcalDate = (iso) => {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
};
/** Evento já preenchido para abrir no Google Agenda (quando a integração não está conectada). */
function calendarTemplateLink(ev) {
  const q = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates: `${gcalDate(ev.start)}/${gcalDate(ev.end)}`, details: ev.description || '', ctz: TZ });
  if (ev.email) q.set('add', ev.email);
  if (ev.video) q.set('vcon', 'meet');
  return `https://calendar.google.com/calendar/render?${q}`;
}

function r1Title(db, contactName) {
  const tpl = getSetting(db, 'r1_title_template') || '[R1] {cliente} | {empresa}';
  return tpl.replace('{cliente}', contactName).replace('{empresa}', getSetting(db, 'company_name') || 'Vero Consórcios');
}

/** Dados para o pop-up: cliente, e-mail, negócio aberto, título sugerido e situação do Google. */
function r1Context(db, user, contactId, req) {
  const c = loadContact(db, user, contactId);
  const opps = db.prepare("SELECT o.id, o.code, s.name AS stage_name, s.key AS stage_key FROM opportunities o JOIN pipeline_stages s ON s.id = o.stage_id WHERE o.contact_id = ? AND o.status IN ('aberta','pausada') ORDER BY o.id DESC").all(c.id);
  const pending = db.prepare("SELECT id, title, due_at, ends_at, meeting_url FROM tasks WHERE contact_id = ? AND type = 'reuniao' AND status = 'pendente' ORDER BY due_at").all(c.id);
  const g = googleStatus(db, user, req);
  return {
    contact: { id: c.id, code: c.code, name: c.name, email: c.email || null, phone: c.whatsapp || c.phone1 || null },
    opportunities: opps,
    pending,
    title: r1Title(db, c.name),
    duration_min: Number(getSetting(db, 'r1_duration_min')) || 30,
    google: { configured: g.configured, connected: g.connected, email: g.google_email, meet_access: g.meet_access, needs_reconnect: g.needs_reconnect },
  };
}

/**
 * Agenda a R1: tarefa "Reunião (R1)" no CRM + evento no Google Agenda (quando conectado).
 * data: contact_id, opportunity_id?, start_at, end_at (ISO), email?, title?, notes?, video (bool), move_to_r1 (bool)
 */
async function scheduleR1(db, user, data, req) {
  const c = loadContact(db, user, data.contact_id, { write: true });
  const start = new Date(data.start_at);
  const end = new Date(data.end_at);
  if (Number.isNaN(start.getTime())) throw badRequest('Informe a data e o horário de início da R1.');
  if (Number.isNaN(end.getTime()) || end <= start) throw badRequest('O horário de término precisa ser depois do início.');
  if (end - start > 4 * 3600 * 1000) throw badRequest('A reunião pode ter no máximo 4 horas.');
  if (start.getTime() < Date.now() - 5 * 60 * 1000) throw badRequest('Escolha um horário futuro para a R1.');
  let email = null;
  if (data.email) {
    email = normalizeEmail(data.email);
    if (!email) throw badRequest('E-mail do cliente inválido.');
  } else email = c.email ? normalizeEmail(c.email) : null;
  const video = data.video !== false && data.video !== 'false';
  const title = clean(data.title) || r1Title(db, c.name);
  let oppId = data.opportunity_id ? Number(data.opportunity_id) : null;
  if (oppId && !db.prepare('SELECT 1 FROM opportunities WHERE id = ? AND contact_id = ?').get(oppId, c.id)) throw badRequest('Negócio inválido para este cliente.');
  if (!oppId) oppId = db.prepare("SELECT id FROM opportunities WHERE contact_id = ? AND status = 'aberta' ORDER BY id DESC LIMIT 1").get(c.id)?.id ?? null;
  const tasks = require('./tasks');
  const company = getSetting(db, 'company_name') || 'Vero Consórcios';
  const description = [
    `Reunião de diagnóstico (R1) com ${company}.`,
    `Especialista: ${db.prepare('SELECT name FROM users WHERE id = ?').get(c.owner_id || user.id)?.name || user.name}.`,
    clean(data.notes) || null,
  ].filter(Boolean).join('\n');
  const taskId = tx(db, () => {
    // E-mail informado no agendamento completa o cadastro (o e-mail é o canal do convite)
    if (email && !c.email) {
      db.prepare('UPDATE contacts SET email = ?, updated_at = ? WHERE id = ?').run(email, nowIso(), c.id);
      audit(db, user, 'contact', c.id, 'alterado', { email: [null, email] }, c.id);
    }
    // A R1 é do responsável pelo cliente (o líder pode agendar em nome do especialista)
    const assignedTo = data.assigned_to || c.owner_id || user.id;
    const id = tasks.createTask(db, user, { contact_id: c.id, opportunity_id: oppId, type: 'reuniao', title, due_at: start.toISOString(), notes: clean(data.notes), priority: 'alta', assigned_to: assignedTo });
    db.prepare('UPDATE tasks SET ends_at = ?, attendee_email = ? WHERE id = ?').run(end.toISOString(), email, id);
    return id;
  });
  const ev = { title, description, start: start.toISOString(), end: end.toISOString(), email, name: c.name, video };
  const assignee = db.prepare('SELECT assigned_to FROM tasks WHERE id = ?').get(taskId).assigned_to || user.id;
  const result = { task_id: taskId, title, start_at: ev.start, end_at: ev.end, email, google: { synced: false }, calendar_link: calendarTemplateLink(ev) };
  try {
    // Agenda do especialista responsável; se ele ainda não conectou o Google, vale a agenda de quem agenda (com o especialista convidado)
    let owner = assignee;
    let g = await upsertGoogleEvent(db, assignee, ev);
    if (!g && assignee !== user.id) {
      const sp = db.prepare('SELECT email FROM users WHERE id = ?').get(assignee);
      g = await upsertGoogleEvent(db, user.id, { ...ev, extraAttendees: sp?.email ? [{ email: sp.email }] : [] });
      owner = user.id;
    }
    if (g) {
      db.prepare("UPDATE tasks SET google_event_id = ?, meeting_url = ?, calendar_status = 'google', calendar_owner_id = ?, attendance_status = ? WHERE id = ?")
        .run(g.id, g.meet, owner, g.meet ? 'aguardando' : null, taskId);
      result.google = { synced: true, event_link: g.html_link, invited: !!email, calendar: owner === assignee ? 'especialista' : 'agendador' };
      result.meeting_url = g.meet;
      if (g.meet) {
        db.prepare('UPDATE tasks SET notes = TRIM(COALESCE(notes, \'\') || ?) WHERE id = ?').run(`\nLink da reunião: ${g.meet}`, taskId);
      }
    } else result.google = { synced: false, reason: googleConfig(db).configured ? 'nao_conectado' : 'nao_configurado' };
  } catch (e) {
    result.google = { synced: false, reason: 'erro', error: e.message };
  }
  // Confirmação por e-mail para o cliente (remetente noreply@), com o link do Meet
  result.confirmation = email ? await sendR1Confirmation(db, taskId, { logoUrl: data.logo_url }) : { sent: false, reason: 'sem_email' };
  // Lead qualificado (ou R1 bolo) → R1: move o negócio junto com o agendamento
  if (oppId && data.move_to_r1) {
    const o = db.prepare('SELECT o.*, s.key AS stage_key FROM opportunities o JOIN pipeline_stages s ON s.id = o.stage_id WHERE o.id = ?').get(oppId);
    const r1 = db.prepare("SELECT id FROM pipeline_stages WHERE key = 'r1' AND active = 1").get();
    if (r1 && o.status === 'aberta' && o.stage_key !== 'r1') {
      try {
        require('./opportunities').moveStage(db, user, oppId, { stage_id: r1.id, reason: `R1 agendada para ${start.toLocaleString('pt-BR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' })}` });
        result.moved = true;
      } catch (e) {
        result.moved = false;
        result.move_error = e.message;
      }
    }
  }
  return result;
}

/** Logo para e-mails: só endereços públicos (um "localhost" não abre na caixa de entrada do cliente). */
const publicLogo = (u) => (/^https?:\/\/[^\s"']+$/.test(String(u || '')) && !/^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(u) ? u : null);

/** E-mail "Reunião confirmada" para o cliente. Sem o convite do Google, vai junto o arquivo .ics. */
async function sendR1Confirmation(db, taskId, { logoUrl } = {}) {
  if (getSetting(db, 'r1_confirmation_email') === false) return { sent: false, reason: 'desativado' };
  const t = db.prepare('SELECT t.*, c.name AS contact_name FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id WHERE t.id = ?').get(Number(taskId));
  if (!t?.attendee_email) return { sent: false, reason: 'sem_email' };
  const mailer = require('./mailer');
  const sp = db.prepare('SELECT name, email, phone, whatsapp FROM users WHERE id = ?').get(t.assigned_to || t.created_by) || {};
  const end = t.ends_at || new Date(Date.parse(t.due_at) + 30 * 60000).toISOString();
  const msg = mailer.r1Email(db, {
    name: t.contact_name, title: t.title, start: t.due_at, end, meetUrl: t.meeting_url, consultant: sp.name,
    consultantPhone: fmtPhone(sp.whatsapp || sp.phone), consultantEmail: sp.email, logoUrl: publicLogo(logoUrl),
    calendarLink: t.calendar_status === 'google' ? null : calendarTemplateLink({ title: t.title, start: t.due_at, end, description: t.meeting_url ? `Google Meet: ${t.meeting_url}` : '', video: false }),
  });
  const attachments = t.calendar_status === 'google' ? [] : [{
    filename: 'reuniao.ics', mime: 'text/calendar; charset=utf-8; method=REQUEST',
    content: mailer.icsInvite({ uid: `r1-${t.id}@vero-crm`, title: t.title, description: t.meeting_url ? `Google Meet: ${t.meeting_url}` : t.title, start: t.due_at, end, url: t.meeting_url, organizerName: sp.name, organizerEmail: mailer.smtpConfig(db).from_email, attendeeEmail: t.attendee_email }),
  }];
  try {
    const r = await mailer.sendMail(db, { to: t.attendee_email, ...msg, attachments });
    if (r.sent) db.prepare('UPDATE tasks SET confirmation_sent_at = ? WHERE id = ?').run(r.at, t.id);
    return { sent: !!r.sent, reason: r.reason, error: r.error, from: r.from, to: t.attendee_email };
  } catch (e) {
    return { sent: false, reason: 'erro', error: e.message };
  }
}

/* ------------------------- Presença na R1 pelo Google Meet ------------------------- */
// Regra: a R1 conta como feita quando há pelo menos 2 participantes na sala e pelo menos um é de fora da empresa
// (o cliente). O especialista sozinho, ou só pessoas da empresa, não conta. O horário da R1 feita é o momento em que
// o cliente e alguém da empresa estavam juntos na reunião.

const meetCode = (url) => (String(url || '').match(/meet\.google\.com\/([a-z]{3,4}-[a-z]{4}-[a-z]{3,4})/i) || [])[1]?.toLowerCase() || null;
const normName = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

async function googleGet(token, url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(502, `O Google Meet não respondeu (${d.error?.message || r.status}).`);
  return d;
}

/** Participantes de todas as sessões da sala (pelo código do Meet). */
async function meetParticipants(token, code) {
  const recs = await googleGet(token, `https://meet.googleapis.com/v2/conferenceRecords?filter=${encodeURIComponent(`space.meeting_code = "${code}"`)}`);
  const out = [];
  for (const rec of recs.conferenceRecords || []) {
    let page = '';
    do {
      const d = await googleGet(token, `https://meet.googleapis.com/v2/${rec.name}/participants?pageSize=100${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`);
      out.push(...(d.participants || []));
      page = d.nextPageToken || '';
    } while (page);
  }
  return out;
}

/**
 * Da empresa: conta Google conectada por um usuário do CRM, nome igual ao de um usuário do CRM, ou e-mail do domínio
 * da empresa (quando o Google informa). De fora: convidado sem conta, telefone ou outra conta Google (o cliente).
 */
function classifyParticipants(db, list) {
  const users = db.prepare('SELECT name, google_sub FROM users').all();
  const subs = new Set(users.filter((u) => u.google_sub).map((u) => `users/${u.google_sub}`));
  const names = new Set(users.map((u) => normName(u.name)).filter(Boolean));
  const domain = String(getSetting(db, 'internal_domain') || '').toLowerCase().replace(/^@/, '');
  const seen = new Map();
  for (const p of list) {
    const su = p.signedinUser;
    const name = su?.displayName || p.anonymousUser?.displayName || p.phoneUser?.displayName || 'Participante';
    const email = String(p.email || su?.email || '').toLowerCase();
    const internal = !!((su && subs.has(su.user)) || names.has(normName(name)) || (domain && email.endsWith(`@${domain}`)));
    const key = su?.user || `${p.anonymousUser ? 'anon' : p.phoneUser ? 'tel' : 'p'}:${normName(name)}`;
    const prev = seen.get(key);
    const joined = p.earliestStartTime || null;
    if (!prev) seen.set(key, { name, kind: su ? 'conta_google' : p.anonymousUser ? 'convidado' : p.phoneUser ? 'telefone' : 'outro', internal, joined_at: joined, left_at: p.latestEndTime || null });
    else if (joined && (!prev.joined_at || joined < prev.joined_at)) prev.joined_at = joined;
  }
  return [...seen.values()];
}

function decideAttendance(parts) {
  const ext = parts.filter((p) => !p.internal);
  if (parts.length < 2 || !ext.length) return { status: 'aguardando' };
  const first = (arr) => arr.map((p) => p.joined_at).filter(Boolean).sort()[0] || null;
  const fe = first(ext);
  const fi = first(parts.filter((p) => p.internal));
  return { status: 'r1_feita', at: [fe, fi].filter(Boolean).sort().pop() || nowIso() };
}

/** Conclui a reunião como "Realizada" (R1 feita), no horário em que o cliente entrou. */
function markR1Done(db, t, at, parts) {
  const { insertActivity } = require('./activities');
  const when = new Date(at).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const ext = parts.filter((p) => !p.internal).map((p) => p.name).join(', ');
  tx(db, () => {
    const now = nowIso();
    db.prepare("UPDATE tasks SET status = 'concluida', outcome = 'realizada', completed_at = ?, attendance_status = 'r1_feita', attended_at = ?, attendance_checked_at = ?, attendance_detail = ?, updated_at = ? WHERE id = ? AND status = 'pendente'")
      .run(at, at, now, JSON.stringify({ participants: parts }), now, t.id);
    if (t.contact_id) {
      insertActivity(db, {
        contact_id: t.contact_id, opportunity_id: t.opportunity_id, type: 'reuniao_realizada', occurred_at: at, user_id: t.assigned_to,
        source: 'google_meet', ref_type: 'task', ref_id: t.id,
        notes: `R1 feita (Google Meet): ${t.title}. Cliente na sala às ${when}${ext ? ` — ${ext}` : ''}.`,
      });
      if (t.opportunity_id) {
        const next = db.prepare("SELECT title, due_at FROM tasks WHERE opportunity_id = ? AND status = 'pendente' ORDER BY due_at LIMIT 1").get(t.opportunity_id);
        db.prepare('UPDATE opportunities SET next_action = ?, next_action_at = ?, updated_at = ? WHERE id = ?').run(next?.title ?? null, next?.due_at ?? null, now, t.opportunity_id);
      }
    }
    audit(db, null, 'task', t.id, 'r1_feita_meet', { horario: at, participantes: parts.length }, t.contact_id);
  });
  if (t.assigned_to) {
    require('./notifications').notify(db, [t.assigned_to], { kind: 'r1_feita', title: `R1 feita: ${t.title}`, body: `O cliente entrou no Google Meet às ${when}. A reunião foi registrada como realizada.`, link: t.contact_id ? `#/leads/${t.contact_id}` : '#/agenda' });
  }
}

/**
 * Confere a presença na sala do Meet da reunião (usa a conta Google de quem criou o evento).
 * Resultado: r1_feita, aguardando ou sem_cliente (a reunião acabou há mais de 2 horas e o cliente não entrou).
 */
async function checkAttendance(db, taskId, user = null) {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(taskId));
  if (!t || t.type !== 'reuniao') throw badRequest('Reunião não encontrada.');
  if (user && t.contact_id) loadContact(db, user, t.contact_id);
  const code = meetCode(t.meeting_url);
  if (!code) return { status: t.attendance_status || null, reason: 'sem_meet', message: 'Esta reunião não tem link do Google Meet.' };
  if (t.status !== 'pendente') return { status: t.attendance_status || null, reason: 'encerrada', message: 'A reunião já foi encerrada.' };
  const owner = t.calendar_owner_id || t.assigned_to || t.created_by;
  const u = db.prepare('SELECT google_scopes, google_connected_at FROM users WHERE id = ?').get(owner) || {};
  if (!u.google_connected_at) return { status: t.attendance_status || null, reason: 'nao_conectado', message: 'A agenda Google de quem criou a reunião não está conectada.' };
  if (!String(u.google_scopes || '').includes(MEET_SCOPE)) return { status: t.attendance_status || null, reason: 'sem_permissao_meet', message: 'Reconecte o Google em Meu cadastro para liberar a presença automática pelo Meet.' };
  const token = await accessToken(db, owner);
  if (!token) return { status: t.attendance_status || null, reason: 'nao_conectado', message: 'Não foi possível acessar a conta Google.' };
  const parts = classifyParticipants(db, await meetParticipants(token, code));
  const d = decideAttendance(parts);
  if (d.status === 'r1_feita') {
    markR1Done(db, t, d.at, parts);
    return { status: 'r1_feita', attended_at: d.at, participants: parts };
  }
  const endMs = Date.parse(t.ends_at || t.due_at) || Date.parse(t.due_at);
  const status = Date.now() > endMs + 2 * 3600 * 1000 ? 'sem_cliente' : 'aguardando';
  db.prepare('UPDATE tasks SET attendance_status = ?, attendance_checked_at = ?, attendance_detail = ? WHERE id = ?').run(status, nowIso(), JSON.stringify({ participants: parts }), t.id);
  if (status === 'sem_cliente' && t.attendance_status !== 'sem_cliente' && t.assigned_to) {
    require('./notifications').notify(db, [t.assigned_to], { kind: 'r1_sem_cliente', level: 'warn', title: `Cliente não entrou na R1: ${t.title}`, body: 'Nenhum participante de fora da empresa entrou no Google Meet. Registre o resultado da reunião (não compareceu ou remarcada).', link: t.contact_id ? `#/leads/${t.contact_id}` : '#/agenda' });
  }
  return { status, participants: parts };
}

/** Rotina (a cada 5 minutos): confere as R1 com Meet que já começaram e ainda aguardam o cliente. */
async function attendanceSweep(db) {
  if (getSetting(db, 'r1_auto_attendance') === false || !googleConfig(db).configured) return 0;
  const now = Date.now();
  const rows = db.prepare("SELECT id FROM tasks WHERE type = 'reuniao' AND status = 'pendente' AND meeting_url LIKE 'https://meet.google.com/%' AND COALESCE(attendance_status, 'aguardando') = 'aguardando' AND due_at <= ? AND due_at >= ? ORDER BY due_at")
    .all(new Date(now + 5 * 60000).toISOString(), new Date(now - 12 * 3600000).toISOString());
  let done = 0;
  for (const r of rows) {
    try {
      if ((await checkAttendance(db, r.id)).status === 'r1_feita') done += 1;
    } catch (e) {
      console.error(`Presença da R1 (tarefa ${r.id}):`, e.message);
    }
  }
  return done;
}

/** Link da reunião informado manualmente (ex.: Meet criado pelo próprio Google Agenda). */
function setMeetingUrl(db, user, taskId, data) {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(taskId));
  if (!t || t.type !== 'reuniao') throw badRequest('Reunião não encontrada.');
  if (t.contact_id) loadContact(db, user, t.contact_id, { write: true });
  const url = clean(data.meeting_url);
  if (url && !/^https:\/\/\S+$/.test(url)) throw badRequest('Informe o link completo da reunião (https://…).');
  db.prepare("UPDATE tasks SET meeting_url = ?, calendar_status = COALESCE(calendar_status, 'link'), updated_at = ? WHERE id = ?").run(url, nowIso(), t.id);
  audit(db, user, 'task', t.id, 'link_reuniao', { link: url }, t.contact_id);
  return { meeting_url: url };
}

/**
 * Depois de reagendar ou cancelar a tarefa da R1 no CRM, leva a alteração para o Google Agenda
 * (o Google avisa o cliente). Falhas não desfazem a alteração no CRM.
 */
async function syncTaskToGoogle(db, taskId) {
  const t = db.prepare('SELECT t.*, c.name AS contact_name FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id WHERE t.id = ?').get(Number(taskId));
  if (!t?.google_event_id) return null;
  const owner = t.assigned_to || t.created_by;
  try {
    if (t.status === 'cancelada') {
      const token = await accessToken(db, owner);
      if (!token) return null;
      await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(t.google_event_id)}?sendUpdates=all`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      db.prepare("UPDATE tasks SET calendar_status = 'cancelado' WHERE id = ?").run(t.id);
      return { synced: true };
    }
    if (t.status !== 'pendente') return null;
    const end = t.ends_at && Date.parse(t.ends_at) > Date.parse(t.due_at) ? t.ends_at : new Date(Date.parse(t.due_at) + 30 * 60000).toISOString();
    await upsertGoogleEvent(db, owner, { title: t.title, description: t.notes || '', start: t.due_at, end, email: t.attendee_email, name: t.contact_name }, t.google_event_id);
    return { synced: true };
  } catch (e) {
    console.error('Google Agenda (sincronização da tarefa):', e.message);
    return { synced: false, error: e.message };
  }
}

/* ------------------------- Modelo da R1 (HTML) ------------------------- */

const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
/** Foto do especialista ou, sem foto, as iniciais num círculo (SVG). */
function photoOrInitials(u) {
  if (u.photo && /^data:image\/(jpeg|png|webp);base64,/.test(u.photo)) return u.photo;
  const ini = String(u.name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#415A77"/><text x="100" y="122" font-family="Arial" font-size="72" fill="#E0E1DD" text-anchor="middle">${escHtml(ini)}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
const fmtPhone = (v) => {
  const d = String(v || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return v || '';
};

function r1TemplateHtml(db) {
  const custom = getSetting(db, 'r1_template_html');
  return custom || require('./r1-template').TEMPLATE;
}

/**
 * Monta o modelo da R1 para uma reunião (task_id), negócio (opportunity_id) ou cadastro (contact_id), com os dados do
 * especialista responsável pela reunião (foto, nome, contato) e do cliente.
 */
function renderR1Model(db, user, q) {
  let task = null;
  let contactId = q.contact_id ? Number(q.contact_id) : null;
  if (q.task_id) {
    task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(q.task_id));
    if (!task) throw new HttpError(404, 'Reunião não encontrada.');
    contactId = task.contact_id;
  } else if (q.opportunity_id) {
    contactId = db.prepare('SELECT contact_id FROM opportunities WHERE id = ?').get(Number(q.opportunity_id))?.contact_id ?? null;
  }
  const c = contactId ? loadContact(db, user, contactId) : null;
  if (!task && c) task = db.prepare("SELECT * FROM tasks WHERE contact_id = ? AND type = 'reuniao' AND status = 'pendente' ORDER BY due_at LIMIT 1").get(c.id) || null;
  const specialistId = task?.assigned_to || c?.owner_id || user.id;
  const u = db.prepare('SELECT id, name, email, job_title, phone, whatsapp, photo, bio, professional_reg FROM users WHERE id = ?').get(specialistId) || user;
  const wa = String(u.whatsapp || u.phone || '').replace(/\D/g, '');
  const when = task ? new Date(task.due_at) : null;
  const opt = { timeZone: TZ };
  const company = getSetting(db, 'company_name') || 'Vero Consórcios';
  const logo = /^https?:\/\/[^\s"']+$/.test(String(q.logo || '')) ? q.logo : '/img/vero-logo-dark.webp';
  const values = {
    especialista_nome: u.name,
    especialista_primeiro_nome: String(u.name || '').split(' ')[0],
    especialista_cargo: u.job_title || `Especialista em consórcios · ${company}`,
    especialista_telefone: fmtPhone(u.phone || u.whatsapp),
    especialista_whatsapp: fmtPhone(u.whatsapp || u.phone),
    especialista_whatsapp_link: wa ? `https://wa.me/${wa.length <= 11 ? `55${wa}` : wa}` : '#',
    especialista_email: u.email,
    especialista_foto: photoOrInitials(u),
    especialista_apresentacao: u.bio || `Planejador financeiro e especialista em consórcio na ${company}.`,
    especialista_registro: u.professional_reg || '',
    cliente_nome: c?.name || 'Cliente',
    cliente_primeiro_nome: String(c?.name || 'Cliente').split(' ')[0],
    data_reuniao: when ? when.toLocaleDateString('pt-BR', opt) : '—',
    hora_reuniao: when ? `${when.toLocaleTimeString('pt-BR', { ...opt, hour: '2-digit', minute: '2-digit' })}${task.ends_at ? ` às ${new Date(task.ends_at).toLocaleTimeString('pt-BR', { ...opt, hour: '2-digit', minute: '2-digit' })}` : ''}` : '—',
    link_reuniao: task?.meeting_url || '',
    empresa: company,
    logo,
  };
  const html = r1TemplateHtml(db).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => (k in values ? escHtml(values[k]) : m));
  return { html, specialist: u.name, contact: c?.name || null };
}

/** Rota GET /api/r1/modelo: devolve a página (ou { html } para a versão de teste no navegador). */
function serveR1Model(db, user, res, q) {
  const r = renderR1Model(db, user, q);
  if (q.formato === 'json') return r;
  if (q.baixar) {
    // Download do modelo já preenchido (arquivo HTML que abre em qualquer navegador, inclusive sem internet)
    const name = `R1 - ${r.contact || 'Cliente'}.html`;
    res.setHeader('Content-Disposition', `attachment; filename="${name.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  }
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; frame-ancestors 'none'; base-uri 'none'");
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(r.html);
  return undefined;
}

/** Modelo personalizado (administrador): HTML com os campos {{...}}; vazio volta ao modelo padrão. */
function r1ModelConfig(db, user) {
  const { FIELDS, TEMPLATE } = require('./r1-template');
  const custom = getSetting(db, 'r1_template_html');
  return { custom: !!custom, fields: FIELDS.map(([key, label]) => ({ key: `{{${key}}}`, label })), size: (custom || TEMPLATE).length, ...(user.role === 'admin' ? { template: custom || TEMPLATE } : {}) };
}
function saveR1ModelConfig(db, user, data) {
  if (user.role !== 'admin') throw new HttpError(403, 'Apenas o administrador altera o modelo da R1.');
  const htmlText = data.html == null ? '' : String(data.html);
  if (htmlText && !/<html[\s>]/i.test(htmlText)) throw badRequest('Envie um arquivo HTML completo (com a tag <html>).');
  if (htmlText.length > 3e6) throw badRequest('Modelo muito grande (máximo de 3 MB). Use imagens externas ou menores.');
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('r1_template_html', JSON.stringify(htmlText || null));
  audit(db, user, 'settings', null, htmlText ? 'modelo_r1_alterado' : 'modelo_r1_padrao', { tamanho: htmlText.length });
  return r1ModelConfig(db, user);
}

module.exports = {
  renderR1Model, serveR1Model, r1ModelConfig, saveR1ModelConfig,
  syncTaskToGoogle,
  googleConfig, googleStatus, saveGoogleConfig, connectUrl, oauthCallback, disconnect, r1Context, scheduleR1, setMeetingUrl,
  calendarTemplateLink, r1Title, upsertGoogleEvent, publicUrl,
  sendR1Confirmation, checkAttendance, attendanceSweep, classifyParticipants, decideAttendance, meetCode, MEET_SCOPE,
};
