'use strict';
/**
 * Comunicação › WhatsApp da empresa, pela API oficial do WhatsApp Business (Cloud API da Meta).
 *
 * - Recebimento: a Meta chama o webhook /api/whatsapp/webhook (GET para verificar o token; POST com as mensagens e os
 *   status de entrega). Com o "App Secret" configurado, a assinatura X-Hub-Signature-256 é conferida.
 * - Cada número vira uma conversa, ligada ao cadastro pelo telefone (ou vinculada à mão) e atribuída ao responsável
 *   pelo cliente. Mensagens recebidas e enviadas entram no histórico do lead como atividade de WhatsApp.
 * - Envio: texto livre só dentro da janela de 24 horas desde a última mensagem do cliente (regra da Meta); fora dela,
 *   a conversa recomeça com um modelo (template) aprovado no Gerenciador do WhatsApp.
 * - Modo de teste: sem a conta conectada, o administrador pode ligar o "modo de teste" (mensagens ficam só no CRM).
 *
 * Credenciais: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN e WHATSAPP_APP_SECRET no config.env
 * (ou em Configurações › Integrações, guardadas cifradas).
 */
const crypto = require('node:crypto');
const { audit, loadContact } = require('../core');
const { requireModule } = require('../permissions');
const { tx, getSetting, setSetting } = require('../db');
const { badRequest, forbidden, notFound, HttpError, clean: cleanRaw, nowIso, digits, normalizePhone, sealSecret, openSecret, randomToken } = require('../util');
const { insertActivity, contactBlockReason } = require('./activities');
const { notify } = require('./notifications');

const clean = (v) => cleanRaw(v) ?? null;
const WINDOW_MS = 24 * 3600 * 1000;
const guard = (user) => requireModule(user, 'whatsapp');

/* ------------------------- Configuração ------------------------- */

function waConfig(db) {
  const token = process.env.WHATSAPP_TOKEN || openSecret(getSetting(db, 'whatsapp_token_enc')) || '';
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || getSetting(db, 'whatsapp_phone_number_id') || '';
  const configured = !!(token && phoneId);
  return {
    token, phoneId, configured,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || getSetting(db, 'whatsapp_verify_token') || '',
    appSecret: process.env.WHATSAPP_APP_SECRET || openSecret(getSetting(db, 'whatsapp_app_secret_enc')) || '',
    version: process.env.WHATSAPP_API_VERSION || 'v21.0',
    fromEnv: !!process.env.WHATSAPP_TOKEN,
    sandbox: !configured && getSetting(db, 'whatsapp_sandbox') === true,
    template: { name: getSetting(db, 'whatsapp_template_name') || '', language: getSetting(db, 'whatsapp_template_lang') || 'pt_BR' },
    displayNumber: getSetting(db, 'whatsapp_display_number') || '',
  };
}

function status(db, user, req) {
  guard(user);
  // O token de verificação do webhook nasce na primeira vez que o administrador abre a configuração
  if (user.role === 'admin' && !waConfig(db).verifyToken) setSetting(db, 'whatsapp_verify_token', `vero-${randomToken(12)}`);
  const c = waConfig(db);
  const base = require('./meetings').publicUrl(db, req);
  return {
    configured: c.configured, sandbox: c.sandbox, from_env: c.fromEnv, display_number: c.displayNumber, template: c.template,
    ...(user.role === 'admin' ? {
      phone_number_id: c.phoneId, verify_token: c.verifyToken, has_app_secret: !!c.appSecret, webhook_url: `${base}/api/whatsapp/webhook`, api_version: c.version,
    } : {}),
  };
}

function saveConfig(db, user, data = {}) {
  if (user.role !== 'admin') throw forbidden('Apenas o administrador conecta o WhatsApp da empresa.');
  if (data.phone_number_id !== undefined) {
    const id = digits(data.phone_number_id);
    if (data.phone_number_id && !id) throw badRequest('O "Phone number ID" tem só números (Meta for Developers › WhatsApp › Configuração da API).');
    setSetting(db, 'whatsapp_phone_number_id', id || '');
  }
  if (data.token) setSetting(db, 'whatsapp_token_enc', sealSecret(String(data.token).trim()));
  if (data.token === '' && data.remove_token) setSetting(db, 'whatsapp_token_enc', null);
  if (data.app_secret) setSetting(db, 'whatsapp_app_secret_enc', sealSecret(String(data.app_secret).trim()));
  if (data.verify_token !== undefined || !getSetting(db, 'whatsapp_verify_token')) setSetting(db, 'whatsapp_verify_token', clean(data.verify_token) || getSetting(db, 'whatsapp_verify_token') || `vero-${randomToken(12)}`);
  if (data.display_number !== undefined) setSetting(db, 'whatsapp_display_number', clean(data.display_number) || '');
  if (data.template_name !== undefined) {
    const n = clean(data.template_name);
    if (n && !/^[a-z0-9_]+$/.test(n)) throw badRequest('Nome do modelo: letras minúsculas, números e _ (como aparece no Gerenciador do WhatsApp).');
    setSetting(db, 'whatsapp_template_name', n || '');
  }
  if (data.template_lang !== undefined) setSetting(db, 'whatsapp_template_lang', clean(data.template_lang) || 'pt_BR');
  if (data.sandbox !== undefined) setSetting(db, 'whatsapp_sandbox', data.sandbox === true || data.sandbox === 'true' || data.sandbox === 'on');
  audit(db, user, 'settings', null, 'whatsapp_configurado', { phone_number_id: getSetting(db, 'whatsapp_phone_number_id') ? 'informado' : 'vazio', modo_teste: getSetting(db, 'whatsapp_sandbox') });
  return { ok: true };
}

/* ------------------------- Escopo e consultas ------------------------- */

/** Fragmento SQL das conversas visíveis: administrador, todas; líder, as da equipe e as sem responsável; especialista, as suas. */
function scopeSql(db, user) {
  if (user.role === 'admin') return { sql: '1=1', params: [] };
  if (user.role === 'gestor' && user.team_id) {
    return { sql: '(w.assigned_to IS NULL OR w.assigned_to IN (SELECT id FROM users WHERE team_id = ?) OR c.owner_id IN (SELECT id FROM users WHERE team_id = ?))', params: [user.team_id, user.team_id] };
  }
  return { sql: '(w.assigned_to = ? OR c.owner_id = ?)', params: [user.id, user.id] };
}

const CONV_SELECT = `SELECT w.*, c.name AS contact_name, c.code AS contact_code, c.owner_id AS contact_owner_id, u.name AS assigned_name,
  (SELECT m.body FROM wa_messages m WHERE m.conversation_id = w.id ORDER BY m.id DESC LIMIT 1) AS last_body,
  (SELECT m.direction FROM wa_messages m WHERE m.conversation_id = w.id ORDER BY m.id DESC LIMIT 1) AS last_direction
  FROM wa_conversations w LEFT JOIN contacts c ON c.id = w.contact_id LEFT JOIN users u ON u.id = w.assigned_to`;

const fmtWa = (wa) => {
  const d = String(wa || '');
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : `+${d}`;
};
const decorate = (w) => ({
  ...w, phone: fmtWa(w.wa_id), name: w.contact_name || w.profile_name || fmtWa(w.wa_id),
  window_open: !!w.last_inbound_at && Date.now() - Date.parse(w.last_inbound_at) < WINDOW_MS,
  window_ends_at: w.last_inbound_at ? new Date(Date.parse(w.last_inbound_at) + WINDOW_MS).toISOString() : null,
});

function loadConv(db, user, id) {
  const sc = scopeSql(db, user);
  const w = db.prepare(`${CONV_SELECT} WHERE w.id = ? AND ${sc.sql}`).get(Number(id), ...sc.params);
  if (!w) {
    if (db.prepare('SELECT 1 FROM wa_conversations WHERE id = ?').get(Number(id))) throw forbidden('Conversa de outro responsável.');
    throw notFound('Conversa não encontrada.');
  }
  return w;
}

function listConversations(db, user, q = {}) {
  guard(user);
  const sc = scopeSql(db, user);
  const where = [sc.sql];
  const params = [...sc.params];
  if (q.filtro === 'minhas') {
    where.push('w.assigned_to = ?');
    params.push(user.id);
  } else if (q.filtro === 'nao_lidas') where.push('w.unread > 0');
  else if (q.filtro === 'sem_responsavel') where.push('w.assigned_to IS NULL');
  else if (q.filtro === 'sem_cadastro') where.push('w.contact_id IS NULL');
  if (q.q) {
    const like = `%${String(q.q).trim()}%`;
    where.push('(c.name LIKE ? OR w.profile_name LIKE ? OR w.wa_id LIKE ?)');
    params.push(like, like, `%${digits(q.q) || '#'}%`);
  }
  return db.prepare(`${CONV_SELECT} WHERE ${where.join(' AND ')} ORDER BY COALESCE(w.last_message_at, w.created_at) DESC LIMIT 200`).all(...params).map(decorate);
}

function unreadCount(db, user) {
  const sc = scopeSql(db, user);
  return db.prepare(`SELECT COUNT(*) AS n FROM wa_conversations w LEFT JOIN contacts c ON c.id = w.contact_id WHERE w.unread > 0 AND ${sc.sql}`).get(...sc.params).n;
}

/** Conversa com as mensagens (as 100 mais recentes ou as novas depois de after_id). Abrir zera as não lidas. */
function getConversation(db, user, id, q = {}) {
  guard(user);
  const w = loadConv(db, user, id);
  const after = Number(q.after_id) || 0;
  const rows = after
    ? db.prepare('SELECT m.*, u.name AS user_name FROM wa_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ? AND m.id > ? ORDER BY m.id').all(w.id, after)
    : db.prepare('SELECT m.*, u.name AS user_name FROM wa_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ? ORDER BY m.id DESC LIMIT 100').all(w.id).reverse();
  if (w.unread) db.prepare('UPDATE wa_conversations SET unread = 0 WHERE id = ?').run(w.id);
  // Status atualizados (entregue/lida) das últimas enviadas, para o polling
  const statuses = after ? db.prepare("SELECT id, status, error FROM wa_messages WHERE conversation_id = ? AND direction = 'out' ORDER BY id DESC LIMIT 30").all(w.id) : [];
  const cfg = waConfig(db);
  return { conversation: decorate({ ...w, unread: 0 }), messages: rows, statuses, config: { configured: cfg.configured, sandbox: cfg.sandbox, template: cfg.template } };
}

/* ------------------------- Vínculo com o cadastro ------------------------- */

/** Números possíveis para o mesmo celular (o WhatsApp às vezes envia sem o nono dígito). */
function phoneCandidates(waId) {
  const n = normalizePhone(waId);
  if (!n) return [];
  const out = [n];
  if (n.length === 10 && /[6-9]/.test(n[2])) out.push(`${n.slice(0, 2)}9${n.slice(2)}`);
  if (n.length === 11 && n[2] === '9') out.push(`${n.slice(0, 2)}${n.slice(3)}`);
  return out;
}
function findContactByWa(db, waId) {
  const cands = phoneCandidates(waId);
  if (!cands.length) return null;
  const ph = cands.map(() => '?').join(',');
  return db.prepare(`SELECT id, owner_id, name, optouts FROM contacts WHERE merged_into_id IS NULL AND (whatsapp_norm IN (${ph}) OR phone1_norm IN (${ph}) OR phone2_norm IN (${ph})) ORDER BY active DESC, id LIMIT 1`).get(...cands, ...cands, ...cands) || null;
}
/** IDs do WhatsApp equivalentes (celular brasileiro com e sem o nono dígito). */
function waCandidates(waId) {
  const d = digits(waId);
  const out = [d];
  if (/^55\d{10}$/.test(d) && /[6-9]/.test(d[4])) out.push(`${d.slice(0, 4)}9${d.slice(4)}`);
  if (/^55\d{2}9\d{8}$/.test(d)) out.push(`${d.slice(0, 4)}${d.slice(5)}`);
  return out;
}
/** Número no formato do WhatsApp (55 + DDD + número). */
const toWaId = (phone) => {
  const n = normalizePhone(phone);
  return n ? (n.length <= 11 ? `55${n}` : n) : null;
};

/** Abre (ou retoma) a conversa com um cliente do CRM pelo WhatsApp dele. */
function startConversation(db, user, data = {}) {
  guard(user);
  const c = loadContact(db, user, data.contact_id, { write: true });
  const waId = toWaId(c.whatsapp || c.phone1 || c.phone2);
  if (!waId) throw badRequest('O cadastro não tem WhatsApp ou celular válido.');
  const cands = waCandidates(waId);
  const existing = db.prepare(`SELECT id FROM wa_conversations WHERE wa_id IN (${cands.map(() => '?').join(',')}) OR contact_id = ? ORDER BY id LIMIT 1`).get(...cands, c.id);
  if (existing) {
    db.prepare('UPDATE wa_conversations SET contact_id = COALESCE(contact_id, ?), assigned_to = COALESCE(assigned_to, ?) WHERE id = ?').run(c.id, c.owner_id || user.id, existing.id);
    return { id: existing.id };
  }
  const id = Number(db.prepare('INSERT INTO wa_conversations (wa_id, contact_id, profile_name, assigned_to, created_at) VALUES (?, ?, ?, ?, ?)').run(waId, c.id, c.name, c.owner_id || user.id, nowIso()).lastInsertRowid);
  return { id };
}

/** Vincula a conversa a um cadastro, troca o responsável ou encerra/reabre. */
function updateConversation(db, user, id, data = {}) {
  guard(user);
  const w = loadConv(db, user, id);
  const sets = [];
  const params = [];
  if (data.contact_id !== undefined) {
    if (data.contact_id) {
      const c = loadContact(db, user, data.contact_id, { write: true });
      sets.push('contact_id = ?');
      params.push(c.id);
      if (!w.assigned_to) {
        sets.push('assigned_to = ?');
        params.push(c.owner_id || user.id);
      }
    } else {
      sets.push('contact_id = NULL');
    }
  }
  if (data.assigned_to !== undefined) {
    if (!['admin', 'gestor'].includes(user.role) && Number(data.assigned_to) !== user.id) throw forbidden('Só o líder ou o administrador transfere conversas.');
    if (data.assigned_to) require('../core').assertAssignable(db, user, Number(data.assigned_to));
    sets.push('assigned_to = ?');
    params.push(data.assigned_to ? Number(data.assigned_to) : null);
    if (data.assigned_to && Number(data.assigned_to) !== user.id) notify(db, Number(data.assigned_to), { kind: 'whatsapp', title: `Conversa de WhatsApp transferida para você: ${w.contact_name || w.profile_name || fmtWa(w.wa_id)}`, link: `#/comunicacao/whatsapp/${w.id}` });
  }
  if (data.status && ['aberta', 'encerrada'].includes(data.status)) {
    sets.push('status = ?');
    params.push(data.status);
  }
  if (sets.length) db.prepare(`UPDATE wa_conversations SET ${sets.join(', ')} WHERE id = ?`).run(...params, w.id);
  audit(db, user, 'whatsapp', w.id, 'conversa_alterada', { campos: Object.keys(data) }, data.contact_id || w.contact_id);
  return getConversation(db, user, w.id);
}

/* ------------------------- Envio ------------------------- */

async function graph(cfg, path, payload) {
  let res;
  try {
    res = await fetch(`https://graph.facebook.com/${cfg.version}/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    throw new HttpError(502, `Não foi possível falar com o WhatsApp (Meta): ${e.cause?.code || e.message}. Tente de novo em instantes.`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `WhatsApp recusou o envio: ${data?.error?.error_user_msg || data?.error?.message || `erro ${res.status}`}`);
  return data;
}

/**
 * Envia uma mensagem: texto (data.body) dentro da janela de 24 horas, ou o modelo aprovado (data.template = nome,
 * data.language) para iniciar ou retomar a conversa.
 */
async function sendMessage(db, user, convId, data = {}) {
  guard(user);
  const w = loadConv(db, user, convId);
  const cfg = waConfig(db);
  if (!cfg.configured && !cfg.sandbox) throw badRequest('O WhatsApp da empresa ainda não está conectado. O administrador conecta em Configurações › Integrações › WhatsApp.');
  if (w.contact_id) {
    const c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(w.contact_id);
    const block = contactBlockReason(c, 'whatsapp');
    if (block) throw badRequest(`${block} A mensagem não foi enviada.`);
  }
  const body = clean(data.body);
  const tplName = clean(data.template);
  const open = !!w.last_inbound_at && Date.now() - Date.parse(w.last_inbound_at) < WINDOW_MS;
  let payload;
  let kind;
  let text;
  if (tplName) {
    if (!/^[a-z0-9_]+$/.test(tplName)) throw badRequest('Modelo inválido.');
    const lang = clean(data.language) || cfg.template.language || 'pt_BR';
    const params = (Array.isArray(data.params) ? data.params : []).map((p) => clean(p)).filter(Boolean).slice(0, 10);
    payload = { messaging_product: 'whatsapp', to: w.wa_id, type: 'template', template: { name: tplName, language: { code: lang }, ...(params.length ? { components: [{ type: 'body', parameters: params.map((t) => ({ type: 'text', text: t })) }] } : {}) } };
    kind = 'template';
    text = `Modelo "${tplName}"${params.length ? `: ${params.join(' · ')}` : ''}`;
  } else {
    if (!body) throw badRequest('Escreva a mensagem.');
    if (body.length > 4096) throw badRequest('Mensagem muito longa (máximo de 4.096 caracteres).');
    if (!open) throw badRequest('Fora da janela de 24 horas: o cliente não escreveu nas últimas 24 horas. Envie o modelo aprovado para retomar a conversa.', { needs_template: true });
    payload = { messaging_product: 'whatsapp', recipient_type: 'individual', to: w.wa_id, type: 'text', text: { preview_url: true, body } };
    kind = 'text';
    text = body;
  }
  const now = nowIso();
  const id = Number(db.prepare("INSERT INTO wa_messages (conversation_id, direction, kind, body, status, user_id, created_at) VALUES (?, 'out', ?, ?, 'pendente', ?, ?)").run(w.id, kind, text, user.id, now).lastInsertRowid);
  let wamid = null;
  try {
    if (cfg.configured) {
      const r = await graph(cfg, `${cfg.phoneId}/messages`, payload);
      wamid = r?.messages?.[0]?.id || null;
    } else wamid = `sandbox.${randomToken(10)}`;
  } catch (e) {
    db.prepare("UPDATE wa_messages SET status = 'falhou', error = ?, status_at = ? WHERE id = ?").run(e.message, nowIso(), id);
    throw e;
  }
  tx(db, () => {
    db.prepare('UPDATE wa_messages SET wamid = ?, status = ?, status_at = ? WHERE id = ?').run(wamid, cfg.configured ? 'enviada' : 'simulada', nowIso(), id);
    db.prepare("UPDATE wa_conversations SET last_message_at = ?, status = 'aberta', assigned_to = COALESCE(assigned_to, ?) WHERE id = ?").run(now, user.id, w.id);
    if (w.contact_id) {
      insertActivity(db, { contact_id: w.contact_id, type: 'mensagem_enviada', channel: 'whatsapp', direction: 'saida', notes: text, occurred_at: now, source: 'whatsapp', external_id: wamid, user_id: user.id, created_by: user.id, ref_type: 'wa_message', ref_id: id });
    }
  });
  return db.prepare('SELECT m.*, u.name AS user_name FROM wa_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ?').get(id);
}

/* ------------------------- Webhook da Meta ------------------------- */

/** GET do webhook: a Meta confere o token de verificação e espera o "challenge" de volta. */
function verifyWebhook(db, query, res) {
  const cfg = waConfig(db);
  const ok = query['hub.mode'] === 'subscribe' && cfg.verifyToken && query['hub.verify_token'] === cfg.verifyToken;
  res.writeHead(ok ? 200 : 403, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(ok ? String(query['hub.challenge'] || '') : 'Token de verificação inválido.');
}

function checkSignature(cfg, req) {
  if (!cfg.appSecret) return;
  const sig = String(req.headers['x-hub-signature-256'] || '');
  const expected = `sha256=${crypto.createHmac('sha256', cfg.appSecret).update(req.rawBody == null ? '' : req.rawBody).digest('hex')}`;
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(401, 'Assinatura do webhook inválida.');
}

const ORDER = { pendente: 0, simulada: 1, enviada: 1, entregue: 2, lida: 3, falhou: 4 };
const STATUS_MAP = { sent: 'enviada', delivered: 'entregue', read: 'lida', failed: 'falhou' };

/** POST do webhook: mensagens recebidas e status (enviada, entregue, lida, falhou) das enviadas. */
function receiveWebhook(db, req, body = {}) {
  const cfg = waConfig(db);
  checkSignature(cfg, req);
  const out = { mensagens: 0, status: 0 };
  for (const entry of Array.isArray(body.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      const v = change?.value || {};
      const names = Object.fromEntries((v.contacts || []).map((c) => [String(c.wa_id), c.profile?.name || null]));
      for (const m of v.messages || []) if (inbound(db, m, names[String(m.from)])) out.mensagens++;
      for (const s of v.statuses || []) {
        const st = STATUS_MAP[s.status];
        const row = st && db.prepare('SELECT id, status FROM wa_messages WHERE wamid = ?').get(String(s.id));
        if (!row || (ORDER[st] ?? 0) < (ORDER[row.status] ?? 0)) continue;
        const err = st === 'failed' || st === 'falhou' ? (s.errors?.[0]?.title || s.errors?.[0]?.message || 'Falha no envio') : null;
        db.prepare('UPDATE wa_messages SET status = ?, error = COALESCE(?, error), status_at = ? WHERE id = ?').run(st, err, nowIso(), row.id);
        out.status++;
      }
    }
  }
  return out;
}

function inbound(db, m, profileName) {
  const waId = digits(m.from);
  const wamid = clean(m.id);
  if (!waId || !wamid) return false;
  if (db.prepare('SELECT 1 FROM wa_messages WHERE wamid = ?').get(wamid)) return false;
  const type = String(m.type || 'text');
  const part = m[type] || {};
  const text = m.text?.body || part.caption || m.button?.text || m.interactive?.button_reply?.title || m.interactive?.list_reply?.title
    || (type === 'location' ? `Localização: ${part.latitude}, ${part.longitude}` : null) || (type === 'document' ? part.filename : null) || `[${type}]`;
  const at = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : nowIso();
  // Mesma pessoa com ou sem o nono dígito: reaproveita a conversa (e passa a usar o ID que a Meta informou)
  const cands = waCandidates(waId);
  let conv = db.prepare(`SELECT * FROM wa_conversations WHERE wa_id IN (${cands.map(() => '?').join(',')}) ORDER BY wa_id = ? DESC LIMIT 1`).get(...cands, waId);
  let contact = conv?.contact_id ? db.prepare('SELECT id, owner_id, name FROM contacts WHERE id = ?').get(conv.contact_id) : findContactByWa(db, waId);
  if (!conv && contact) conv = db.prepare('SELECT * FROM wa_conversations WHERE contact_id = ? ORDER BY id LIMIT 1').get(contact.id) || null;
  if (!contact && conv?.contact_id) contact = db.prepare('SELECT id, owner_id, name FROM contacts WHERE id = ?').get(conv.contact_id);
  return tx(db, () => {
    if (conv && conv.wa_id !== waId && !db.prepare('SELECT 1 FROM wa_conversations WHERE wa_id = ?').get(waId)) {
      db.prepare('UPDATE wa_conversations SET wa_id = ? WHERE id = ?').run(waId, conv.id);
    }
    if (!conv) {
      const id = Number(db.prepare('INSERT INTO wa_conversations (wa_id, contact_id, profile_name, assigned_to, created_at) VALUES (?, ?, ?, ?, ?)').run(waId, contact?.id ?? null, profileName || null, contact?.owner_id ?? null, at).lastInsertRowid);
      conv = db.prepare('SELECT * FROM wa_conversations WHERE id = ?').get(id);
    }
    const msgId = Number(db.prepare("INSERT INTO wa_messages (conversation_id, wamid, direction, kind, body, media_id, media_mime, filename, status, created_at, status_at) VALUES (?, ?, 'in', ?, ?, ?, ?, ?, 'recebida', ?, ?)")
      .run(conv.id, wamid, type, text, part.id || null, part.mime_type || null, part.filename || null, at, at).lastInsertRowid);
    db.prepare("UPDATE wa_conversations SET last_message_at = ?, last_inbound_at = ?, unread = unread + 1, status = 'aberta', profile_name = COALESCE(?, profile_name), contact_id = COALESCE(contact_id, ?), assigned_to = COALESCE(assigned_to, ?) WHERE id = ?")
      .run(at, at, profileName || null, contact?.id ?? null, contact?.owner_id ?? null, conv.id);
    if (contact) {
      insertActivity(db, { contact_id: contact.id, type: 'mensagem_recebida', channel: 'whatsapp', direction: 'entrada', notes: text, occurred_at: at, source: 'whatsapp', external_id: wamid, user_id: null, ref_type: 'wa_message', ref_id: msgId });
    }
    const target = conv.assigned_to || contact?.owner_id;
    const who = contact?.name || profileName || fmtWa(waId);
    if (target) notify(db, target, { kind: 'whatsapp', title: `WhatsApp de ${who}`, body: text.slice(0, 160), link: `#/comunicacao/whatsapp/${conv.id}`, dedupe: true });
    else notify(db, require('./notifications').managersOf(db, null), { kind: 'whatsapp', level: 'warn', title: `WhatsApp de número sem cadastro: ${who}`, body: 'Vincule a conversa a um cadastro ou crie o lead.', link: `#/comunicacao/whatsapp/${conv.id}`, dedupe: true });
    return true;
  });
}

/** Baixa a mídia recebida (foto, áudio, documento) pela API da Meta. */
async function media(db, user, msgId) {
  guard(user);
  const m = db.prepare('SELECT * FROM wa_messages WHERE id = ?').get(Number(msgId));
  if (!m || !m.media_id) throw notFound('Arquivo não encontrado.');
  loadConv(db, user, m.conversation_id);
  const cfg = waConfig(db);
  if (!cfg.configured) throw badRequest('WhatsApp da empresa não conectado.');
  const meta = await fetch(`https://graph.facebook.com/${cfg.version}/${m.media_id}`, { headers: { Authorization: `Bearer ${cfg.token}` } }).then((r) => r.json());
  if (!meta?.url) throw new HttpError(502, 'A Meta não devolveu o arquivo (pode ter expirado).');
  const bin = await fetch(meta.url, { headers: { Authorization: `Bearer ${cfg.token}` } });
  if (!bin.ok) throw new HttpError(502, 'Não foi possível baixar o arquivo do WhatsApp.');
  const ext = String(meta.mime_type || m.media_mime || '').split('/')[1]?.split(';')[0] || 'bin';
  return { filename: m.filename || `whatsapp-${m.id}.${ext}`, mime: meta.mime_type || m.media_mime || 'application/octet-stream', content: Buffer.from(await bin.arrayBuffer()) };
}

module.exports = { waConfig, status, saveConfig, listConversations, unreadCount, getConversation, startConversation, updateConversation, sendMessage, verifyWebhook, receiveWebhook, media, findContactByWa, toWaId };
