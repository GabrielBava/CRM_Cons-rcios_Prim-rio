'use strict';
/**
 * Integrações › WhatsApp Lite (QR Code).
 *
 * Cada número conectado é uma "instância" num servidor de WhatsApp compatível com a Evolution API v2 (o mesmo tipo de
 * servidor do EvoGo): o especialista dá um nome, o CRM cria a instância no servidor e mostra o QR Code; lido pelo
 * celular, o número (Business ou pessoal) fica conectado. As mensagens chegam pelo webhook da instância e as conversas
 * aparecem em Comunicação › WhatsApp, ligadas ao lead pelo telefone, junto com as do número oficial (API da Meta).
 *
 * Acesso dos membros por instância: Sem acesso, Só ver ou Ver e enviar (e "Acesso para todos"). O dono da instância, o
 * líder e o administrador veem e enviam. Por padrão a instância só registra conversas com números que já estão no CRM
 * (protege as conversas pessoais de quem conecta o próprio número); o dono pode liberar todas.
 *
 * Servidor: EVOLUTION_API_URL e EVOLUTION_API_KEY no config.env ou em Integrações › WhatsApp Lite (chave cifrada).
 * Sem servidor, o administrador pode ligar o modo de teste: o QR é ilustrativo, a conexão é simulada e as mensagens
 * ficam só no CRM.
 */
const { getSetting, setSetting, tx } = require('../db');
const { audit } = require('../core');
const { requireModule } = require('../permissions');
const { badRequest, forbidden, notFound, HttpError, clean: cleanRaw, nowIso, digits, sealSecret, openSecret, randomToken } = require('../util');

const clean = (v) => cleanRaw(v) ?? null;
const LEVELS = ['nenhum', 'ver', 'enviar'];
const RANK = { nenhum: 0, ver: 1, enviar: 2 };
const LEVEL_LABEL = { nenhum: 'Sem acesso', ver: 'Só ver', enviar: 'Ver e enviar' };
const ROLE_LABEL = { admin: 'Administrador', gestor: 'Líder', consultor: 'Especialista', leitura: 'Leitura' };
const EVENTS = ['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'MESSAGES_UPDATE'];
/** Arquivo enviado pelo CRM: até 3 MB (o corpo da requisição na Vercel vai até 4,5 MB com o base64). */
const MAX_FILE = Number(process.env.WA_MAX_FILE_MB || 3) * 1024 * 1024;
/** Mídia recebida guardada no CRM (cache para o histórico). */
const MAX_STORE = 16 * 1024 * 1024;
const guard = (user) => requireModule(user, 'whatsapp');
const isLead = (user) => user.role === 'admin' || user.role === 'gestor';

/* ------------------------- Configuração ------------------------- */

function liteConfig(db) {
  const url = String(process.env.EVOLUTION_API_URL || getSetting(db, 'walite_url') || '').trim().replace(/\/+$/, '');
  const key = process.env.EVOLUTION_API_KEY || openSecret(getSetting(db, 'walite_key_enc')) || '';
  const configured = !!(url && key);
  return { url, key, configured, fromEnv: !!process.env.EVOLUTION_API_URL, sandbox: !configured && getSetting(db, 'walite_sandbox') === true };
}

/**
 * Endereço do CRM que o conector usa para avisar as mensagens (webhook). Padrão: o endereço público do CRM. No teste
 * no computador (CRM e conector no Docker), o conector enxerga o CRM por outro nome (ex.: http://crm:3000).
 */
function webhookBase(db, req) {
  const set = String(process.env.EVOLUTION_WEBHOOK_BASE || getSetting(db, 'walite_webhook_base') || '').trim().replace(/\/+$/, '');
  return set || require('./meetings').publicUrl(db, req);
}

function saveConfig(db, user, data = {}) {
  if (user.role !== 'admin') throw forbidden('Só o administrador configura o servidor do WhatsApp Lite.');
  if (data.webhook_base !== undefined) {
    const b = clean(data.webhook_base);
    if (b && !/^https?:\/\/[^\s/]+(:\d+)?\/?$/i.test(b)) throw badRequest('Endereço do CRM para o webhook inválido (ex.: https://crm.seudominio.com.br).');
    setSetting(db, 'walite_webhook_base', b ? b.replace(/\/+$/, '') : '');
  }
  if (data.url !== undefined) {
    const url = clean(data.url);
    if (url && !/^https?:\/\/[^\s]+$/i.test(url)) throw badRequest('Endereço do servidor inválido (use https://…).');
    setSetting(db, 'walite_url', url ? url.replace(/\/+$/, '') : '');
  }
  if (data.key !== undefined && data.key !== '') setSetting(db, 'walite_key_enc', data.key ? sealSecret(String(data.key).trim()) : '');
  if (data.clear_key) setSetting(db, 'walite_key_enc', '');
  if (data.sandbox !== undefined) setSetting(db, 'walite_sandbox', !!data.sandbox);
  audit(db, user, 'integration', null, 'whatsapp_lite_config', { url: !!data.url, sandbox: data.sandbox });
  return { ok: true };
}

/* ------------------------- Servidor (Evolution API v2) ------------------------- */

async function evo(cfg, method, path, body) {
  let res;
  try {
    res = await fetch(`${cfg.url}${path}`, {
      method,
      headers: { apikey: cfg.key, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(25000),
    });
  } catch (e) {
    throw new HttpError(502, `Não foi possível falar com o conector do WhatsApp Lite (${e.cause?.code || e.message}). Confira se ele está ligado: no teste no computador, o conector leva até 1 minuto para ficar pronto depois de iniciar.`);
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  if (!res.ok) {
    const msg = data?.response?.message || data?.message || data?.error || `erro ${res.status}`;
    throw new HttpError(502, `O servidor do WhatsApp Lite recusou: ${Array.isArray(msg) ? msg.join('; ') : String(msg)}`);
  }
  return data;
}

const jidNumber = (jid) => {
  const s = String(jid || '');
  return /@(s\.whatsapp\.net|c\.us)$/.test(s) || /^\d+$/.test(s) ? digits(s.split('@')[0].split(':')[0]) : null;
};

/* ------------------------- Instâncias e acesso ------------------------- */

const instRow = (db, id) => db.prepare('SELECT * FROM wa_instances WHERE id = ?').get(Number(id));

/** Nível de acesso do usuário à instância. */
function accessOf(db, user, inst) {
  if (!inst) return 'nenhum';
  if (isLead(user) || inst.owner_id === user.id) return 'enviar';
  const row = db.prepare('SELECT level FROM wa_instance_access WHERE instance_id = ? AND user_id = ?').get(inst.id, user.id);
  const own = row ? row.level : 'nenhum';
  return RANK[inst.access_all] > RANK[own] ? inst.access_all : own;
}

/**
 * Acesso a uma conversa do Lite: o da instância; no número central do agente de IA, quem recebeu a conversa
 * (responsável pela conversa ou pelo lead) também lê e responde.
 */
function convAccess(db, user, w, inst) {
  const base = accessOf(db, user, inst);
  if (base === 'enviar' || !w || !inst) return base;
  const central = require('./waagent').config(db).instance_id;
  if (Number(central) !== Number(inst.id)) return base;
  const owner = w.contact_id ? db.prepare('SELECT owner_id FROM contacts WHERE id = ?').get(w.contact_id)?.owner_id : null;
  return w.assigned_to === user.id || owner === user.id ? 'enviar' : base;
}

/** Instâncias cujas conversas o usuário vê (Só ver ou Ver e enviar). */
function visibleInstanceIds(db, user) {
  if (isLead(user)) return db.prepare('SELECT id FROM wa_instances').all().map((r) => r.id);
  return db.prepare(`SELECT i.id FROM wa_instances i LEFT JOIN wa_instance_access a ON a.instance_id = i.id AND a.user_id = ?
    WHERE i.owner_id = ? OR i.access_all IN ('ver','enviar') OR a.level IN ('ver','enviar')`).all(user.id, user.id).map((r) => r.id);
}

const canManage = (user, inst) => isLead(user) || inst.owner_id === user.id;
function loadInstance(db, user, id, { manage = false } = {}) {
  guard(user);
  const inst = instRow(db, id);
  if (!inst || accessOf(db, user, inst) === 'nenhum') throw notFound('Instância não encontrada.');
  if (manage && !canManage(user, inst)) throw forbidden('Só o dono da instância, o líder ou o administrador alteram esta conexão.');
  return inst;
}

const initials = (name) => String(name || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
const fmtPhone = (d) => {
  const m = String(d || '').match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : d ? `+${d}` : null;
};

function view(db, user, inst) {
  const owner = db.prepare('SELECT name FROM users WHERE id = ?').get(inst.owner_id);
  const members = db.prepare("SELECT COUNT(*) AS n FROM wa_instance_access WHERE instance_id = ? AND level <> 'nenhum'").get(inst.id).n;
  const convs = db.prepare('SELECT COUNT(*) AS n, SUM(unread) AS u FROM wa_conversations WHERE instance_id = ?').get(inst.id);
  return {
    id: inst.id, name: inst.name, initials: initials(inst.name), status: inst.status, phone: inst.phone, phone_label: fmtPhone(inst.phone), profile_name: inst.profile_name,
    owner_id: inst.owner_id, owner_name: owner?.name || null, access_all: inst.access_all, access_all_label: LEVEL_LABEL[inst.access_all], only_known: !!inst.only_known,
    members_with_access: members, conversations: convs.n || 0, unread: convs.u || 0, connected_at: inst.connected_at, created_at: inst.created_at,
    my_access: accessOf(db, user, inst), can_manage: canManage(user, inst),
  };
}

function overview(db, user, req) {
  guard(user);
  const cfg = liteConfig(db);
  const ids = visibleInstanceIds(db, user);
  const instances = ids.length ? db.prepare(`SELECT * FROM wa_instances WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY status = 'conectado' DESC, name`).all(...ids).map((i) => view(db, user, i)) : [];
  return {
    configured: cfg.configured, sandbox: cfg.sandbox, can_create: cfg.configured || cfg.sandbox,
    connected: instances.filter((i) => i.status === 'conectado').length, instances,
    ...(user.role === 'admin' ? { url: cfg.url, has_key: !!cfg.key, from_env: cfg.fromEnv, webhook_base: `${webhookBase(db, req)}/api/whatsapp/lite/webhook/`, webhook_base_custom: String(process.env.EVOLUTION_WEBHOOK_BASE || getSetting(db, 'walite_webhook_base') || '') || null } : {}),
  };
}

/** QR ilustrativo do modo de teste (não conecta nada). */
function sandboxQr(seed) {
  const n = 25;
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => ((h = (h * 1103515245 + 12345) >>> 0) / 4294967296);
  const finder = (x, y) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  let cells = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (finder(x, y)) continue;
      if (rnd() > 0.52) cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    }
  }
  const box = (x, y) => `<rect x="${x}" y="${y}" width="7" height="7" fill="#000"/><rect x="${x + 1}" y="${y + 1}" width="5" height="5" fill="#fff"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" fill="#000"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><g fill="#000">${cells}</g>${box(0, 0)}${box(n - 7, 0)}${box(0, n - 7)}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const qrOf = (data) => {
  const b = data?.base64 || data?.qrcode?.base64 || data?.qrcode || null;
  if (!b || typeof b !== 'string') return null;
  return b.startsWith('data:') ? b : `data:image/png;base64,${b}`;
};

async function createInstance(db, user, req, data = {}) {
  guard(user);
  if (user.role === 'leitura') throw forbidden('Perfil de leitura não conecta números.');
  const cfg = liteConfig(db);
  if (!cfg.configured && !cfg.sandbox) throw badRequest('O servidor do WhatsApp Lite ainda não foi configurado. O administrador configura em Integrações › WhatsApp Lite.');
  const name = clean(data.name);
  if (!name) throw badRequest('Dê um nome para a instância (ex.: Meu WhatsApp, Time SDR).');
  if (name.length > 60) throw badRequest('Nome muito longo (até 60 caracteres).');
  const now = nowIso();
  const key = `vero-${randomToken(9).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  const token = randomToken(24);
  const id = Number(db.prepare("INSERT INTO wa_instances (name, instance_key, owner_id, only_known, webhook_token, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'aguardando', ?, ?)")
    .run(name, key, user.id, data.only_known === false ? 0 : 1, token, now, now).lastInsertRowid);
  let qr = null;
  try {
    if (cfg.configured) {
      const url = `${webhookBase(db, req)}/api/whatsapp/lite/webhook/${token}`;
      const webhook = { enabled: true, url, byEvents: false, base64: false, events: EVENTS };
      const r = await evo(cfg, 'POST', '/instance/create', { instanceName: key, integration: 'WHATSAPP-BAILEYS', qrcode: true, groupsIgnore: true, rejectCall: false, alwaysOnline: false, readMessages: false, readStatus: false, syncFullHistory: false, webhook });
      // Versões anteriores da v2 ignoram o webhook na criação: confirma pela rota própria
      await evo(cfg, 'POST', `/webhook/set/${key}`, { webhook }).catch(() => null);
      qr = qrOf(r?.qrcode) || qrOf(await evo(cfg, 'GET', `/instance/connect/${key}`).catch(() => null));
    } else qr = sandboxQr(key);
  } catch (e) {
    db.prepare('DELETE FROM wa_instances WHERE id = ?').run(id);
    throw e;
  }
  db.prepare('UPDATE wa_instances SET qr = ?, qr_at = ? WHERE id = ?').run(qr, nowIso(), id);
  audit(db, user, 'whatsapp_lite', id, 'instancia_criada', { name });
  return { ...view(db, user, instRow(db, id)), qr, sandbox: !cfg.configured };
}

/** Situação da conexão e o QR Code atual (o navegador consulta a cada poucos segundos durante o pareamento). */
async function instanceStatus(db, user, id, { refresh = false } = {}) {
  let inst = loadInstance(db, user, id);
  const cfg = liteConfig(db);
  if (cfg.configured && (refresh || inst.status !== 'conectado')) {
    const st = await evo(cfg, 'GET', `/instance/connectionState/${inst.instance_key}`).catch(() => null);
    const state = st?.instance?.state || st?.state || null;
    if (state === 'open') await markConnected(db, cfg, inst);
    else if (state && inst.status === 'conectado') db.prepare("UPDATE wa_instances SET status = 'desconectado', updated_at = ? WHERE id = ?").run(nowIso(), inst.id);
    inst = instRow(db, inst.id);
  }
  return { ...view(db, user, inst), qr: inst.status === 'conectado' ? null : inst.qr, sandbox: !cfg.configured };
}

async function markConnected(db, cfg, inst, info = {}) {
  let phone = jidNumber(info.wuid || info.ownerJid) || inst.phone;
  let profile = info.profileName || inst.profile_name;
  if (cfg?.configured && !info.wuid) {
    const list = await evo(cfg, 'GET', `/instance/fetchInstances?instanceName=${encodeURIComponent(inst.instance_key)}`).catch(() => null);
    const it = Array.isArray(list) ? list[0] : list;
    phone = jidNumber(it?.ownerJid || it?.instance?.owner || it?.owner) || phone;
    profile = it?.profileName || it?.instance?.profileName || profile;
  }
  const now = nowIso();
  db.prepare("UPDATE wa_instances SET status = 'conectado', phone = ?, profile_name = ?, qr = NULL, connected_at = COALESCE(connected_at, ?), updated_at = ? WHERE id = ?").run(phone || null, profile || null, now, now, inst.id);
}

/** Novo QR Code para (re)conectar o número. */
async function reconnect(db, user, id) {
  const inst = loadInstance(db, user, id, { manage: true });
  const cfg = liteConfig(db);
  let qr;
  if (cfg.configured) {
    const r = await evo(cfg, 'GET', `/instance/connect/${inst.instance_key}`);
    if (r?.instance?.state === 'open') {
      await markConnected(db, cfg, inst);
      return instanceStatus(db, user, inst.id);
    }
    qr = qrOf(r);
  } else qr = sandboxQr(`${inst.instance_key}${Date.now()}`);
  db.prepare("UPDATE wa_instances SET qr = ?, qr_at = ?, status = CASE WHEN status = 'conectado' THEN status ELSE 'aguardando' END, updated_at = ? WHERE id = ?").run(qr, nowIso(), nowIso(), inst.id);
  return instanceStatus(db, user, inst.id);
}

/** Modo de teste: simula a leitura do QR Code. */
function simulateConnect(db, user, id, data = {}) {
  const inst = loadInstance(db, user, id, { manage: true });
  if (liteConfig(db).configured) throw badRequest('Com o servidor configurado, conecte lendo o QR Code no celular.');
  const phone = digits(data.phone) || `55519${String(9e7 + Math.floor(Math.random() * 9e7)).slice(0, 8)}`;
  db.prepare("UPDATE wa_instances SET status = 'conectado', phone = ?, profile_name = ?, qr = NULL, connected_at = ?, updated_at = ? WHERE id = ?")
    .run(phone.length <= 11 ? `55${phone}` : phone, inst.name, nowIso(), nowIso(), inst.id);
  return instanceStatus(db, user, inst.id);
}

async function disconnect(db, user, id) {
  const inst = loadInstance(db, user, id, { manage: true });
  const cfg = liteConfig(db);
  if (cfg.configured) await evo(cfg, 'DELETE', `/instance/logout/${inst.instance_key}`).catch((e) => { if (!/404|not found|não/i.test(e.message)) throw e; });
  db.prepare("UPDATE wa_instances SET status = 'desconectado', qr = NULL, updated_at = ? WHERE id = ?").run(nowIso(), inst.id);
  audit(db, user, 'whatsapp_lite', inst.id, 'instancia_desconectada', null);
  return instanceStatus(db, user, inst.id);
}

async function removeInstance(db, user, id) {
  const inst = loadInstance(db, user, id, { manage: true });
  const cfg = liteConfig(db);
  if (cfg.configured) await evo(cfg, 'DELETE', `/instance/delete/${inst.instance_key}`).catch((e) => { if (!/404|not found|não/i.test(e.message)) throw e; });
  tx(db, () => {
    // As conversas ficam no CRM (histórico do lead), sem a instância
    db.prepare('UPDATE wa_conversations SET instance_id = NULL WHERE instance_id = ?').run(inst.id);
    db.prepare('DELETE FROM wa_instance_access WHERE instance_id = ?').run(inst.id);
    db.prepare('DELETE FROM wa_instances WHERE id = ?').run(inst.id);
  });
  audit(db, user, 'whatsapp_lite', inst.id, 'instancia_excluida', { name: inst.name });
  return { ok: true };
}

function updateInstance(db, user, id, data = {}) {
  const inst = loadInstance(db, user, id, { manage: true });
  const sets = [];
  const params = [];
  if (data.name !== undefined) {
    const name = clean(data.name);
    if (!name || name.length > 60) throw badRequest('Nome inválido (até 60 caracteres).');
    sets.push('name = ?');
    params.push(name);
  }
  if (data.access_all !== undefined) {
    if (!LEVELS.includes(data.access_all)) throw badRequest('Acesso inválido.');
    sets.push('access_all = ?');
    params.push(data.access_all);
  }
  if (data.only_known !== undefined) {
    sets.push('only_known = ?');
    params.push(data.only_known ? 1 : 0);
  }
  if (sets.length) db.prepare(`UPDATE wa_instances SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...params, nowIso(), inst.id);
  audit(db, user, 'whatsapp_lite', inst.id, 'instancia_alterada', { campos: Object.keys(data) });
  return view(db, user, instRow(db, inst.id));
}

/** Acesso dos membros: todos os usuários ativos com o nível de cada um. */
function members(db, user, id) {
  const inst = loadInstance(db, user, id);
  const rows = db.prepare(`SELECT u.id, u.name, u.email, u.role, u.photo IS NOT NULL AS has_photo, a.level FROM users u LEFT JOIN wa_instance_access a ON a.instance_id = ? AND a.user_id = u.id
    WHERE u.active = 1 ORDER BY u.id = ? DESC, u.name`).all(inst.id, inst.owner_id);
  return {
    instance: view(db, user, inst),
    members: rows.map((m) => {
      const owner = m.id === inst.owner_id;
      const implicit = owner || m.role === 'admin' || m.role === 'gestor';
      const own = m.level || 'nenhum';
      return {
        id: m.id, name: m.name, email: m.email, initials: initials(m.name), role: m.role, role_label: owner ? 'Proprietário' : ROLE_LABEL[m.role] || m.role,
        level: implicit ? 'enviar' : RANK[inst.access_all] > RANK[own] ? inst.access_all : own, own_level: own, fixed: implicit,
      };
    }),
    levels: LEVELS.map((k) => ({ key: k, label: LEVEL_LABEL[k] })),
  };
}

function setMemberAccess(db, user, id, data = {}) {
  const inst = loadInstance(db, user, id, { manage: true });
  const uid = Number(data.user_id);
  const level = String(data.level || '');
  if (!LEVELS.includes(level)) throw badRequest('Acesso inválido.');
  const target = db.prepare('SELECT id, role FROM users WHERE id = ? AND active = 1').get(uid);
  if (!target) throw notFound('Usuário não encontrado.');
  if (uid === inst.owner_id) throw badRequest('O dono da instância tem acesso completo.');
  db.prepare('INSERT INTO wa_instance_access (instance_id, user_id, level, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (instance_id, user_id) DO UPDATE SET level = excluded.level, updated_at = excluded.updated_at')
    .run(inst.id, uid, level, nowIso());
  audit(db, user, 'whatsapp_lite', inst.id, 'acesso_alterado', { user_id: uid, level });
  return members(db, user, inst.id);
}

/* ------------------------- Envio ------------------------- */

const MEDIA_TYPE = (mime) => (/^image\//.test(mime) ? 'image' : /^video\//.test(mime) ? 'video' : /^audio\//.test(mime) ? 'audio' : 'document');

/** Arquivo vindo do navegador: { name, mime, data (base64) } → Buffer validado. */
function readAttachment(a) {
  if (!a || typeof a !== 'object') return null;
  const b64 = String(a.data || '').replace(/^data:[^,]*,/, '');
  if (!b64) throw badRequest('Arquivo vazio.');
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) throw badRequest('Arquivo vazio.');
  if (buf.length > MAX_FILE) throw badRequest(`Arquivo grande demais (até ${Math.round(MAX_FILE / 1024 / 1024)} MB).`);
  const mime = String(a.mime || 'application/octet-stream').toLowerCase().slice(0, 100);
  const name = (clean(a.name) || `arquivo.${mime.split('/')[1]?.split(';')[0] || 'bin'}`).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
  return { buf, mime, name, b64: buf.toString('base64') };
}

function storeMedia(db, { mime, name, buf }) {
  return Number(db.prepare('INSERT INTO wa_media (mime, filename, size, data, created_at) VALUES (?, ?, ?, ?, ?)').run(mime, name || null, buf.length, buf, nowIso()).lastInsertRowid);
}

/**
 * Envia pela instância da conversa: texto (data.body), arquivo (data.attachment: foto, vídeo ou documento, com legenda
 * em data.body) ou áudio gravado (data.attachment + data.voice). Sem janela de 24 horas (não é a API oficial).
 */
async function send(db, user, w, data = {}) {
  const inst = w.instance_id ? instRow(db, w.instance_id) : null;
  if (!inst) throw badRequest('Esta conversa não está mais ligada a um número conectado.');
  if (convAccess(db, user, w, inst) !== 'enviar') throw forbidden('Seu acesso a este número é "Só ver". Peça ao dono da instância o acesso "Ver e enviar".');
  const cfg = liteConfig(db);
  if (!cfg.configured && !cfg.sandbox) throw badRequest('O servidor do WhatsApp Lite não está configurado.');
  if (cfg.configured && inst.status !== 'conectado') throw badRequest(`O número "${inst.name}" está desconectado. Reconecte em Integrações › WhatsApp Lite.`);
  const body = clean(data.body);
  const file = readAttachment(data.attachment);
  if (!body && !file) throw badRequest('Escreva a mensagem ou anexe um arquivo.');
  if (body && body.length > 4096) throw badRequest('Mensagem muito longa (máximo de 4.096 caracteres).');
  const kind = file ? (data.voice ? 'audio' : MEDIA_TYPE(file.mime)) : 'text';
  const text = body || (file ? (kind === 'audio' ? 'Áudio' : file.name) : '');
  const now = nowIso();
  const mediaId = file ? storeMedia(db, file) : null;
  const msgId = Number(db.prepare("INSERT INTO wa_messages (conversation_id, direction, kind, body, media_mime, filename, media_store_id, duration, status, user_id, created_at) VALUES (?, 'out', ?, ?, ?, ?, ?, ?, 'pendente', ?, ?)")
    .run(w.id, kind, text, file?.mime || null, file ? file.name : null, mediaId, Number(data.duration) || null, user.id, now).lastInsertRowid);
  let wamid = null;
  try {
    if (cfg.configured) {
      const number = w.peer;
      let r;
      if (!file) r = await evo(cfg, 'POST', `/message/sendText/${inst.instance_key}`, { number, text: body });
      else if (kind === 'audio') r = await evo(cfg, 'POST', `/message/sendWhatsAppAudio/${inst.instance_key}`, { number, audio: file.b64 });
      else r = await evo(cfg, 'POST', `/message/sendMedia/${inst.instance_key}`, { number, mediatype: kind === 'video' ? 'video' : kind === 'image' ? 'image' : 'document', mimetype: file.mime, caption: body || undefined, media: file.b64, fileName: file.name });
      wamid = r?.key?.id || r?.id || null;
    } else wamid = `sandbox.${randomToken(10)}`;
  } catch (e) {
    db.prepare("UPDATE wa_messages SET status = 'falhou', error = ?, status_at = ? WHERE id = ?").run(e.message, nowIso(), msgId);
    throw e;
  }
  const { insertActivity } = require('./activities');
  tx(db, () => {
    db.prepare('UPDATE wa_messages SET wamid = ?, status = ?, status_at = ? WHERE id = ?').run(wamid, cfg.configured ? 'enviada' : 'simulada', nowIso(), msgId);
    db.prepare("UPDATE wa_conversations SET last_message_at = ?, status = 'aberta', assigned_to = COALESCE(assigned_to, ?) WHERE id = ?").run(now, user.id, w.id);
    if (w.contact_id) {
      insertActivity(db, { contact_id: w.contact_id, type: 'mensagem_enviada', channel: 'whatsapp', direction: 'saida', notes: kind === 'text' ? text : `[${kind === 'audio' ? 'Áudio' : kind === 'image' ? 'Foto' : kind === 'video' ? 'Vídeo' : 'Documento'}] ${body || file?.name || ''}`.trim(), occurred_at: now, source: 'whatsapp', external_id: wamid, user_id: user.id, created_by: user.id, ref_type: 'wa_message', ref_id: msgId });
    }
  });
  return msgId;
}

/** Arquivo de uma mensagem do Lite: o guardado no CRM ou, para os recebidos, buscado no servidor (e guardado). */
async function mediaFor(db, m) {
  if (m.media_store_id) {
    const f = db.prepare('SELECT mime, filename, data FROM wa_media WHERE id = ?').get(m.media_store_id);
    if (f) return { mime: f.mime, filename: f.filename, content: Buffer.from(f.data) };
  }
  const conv = db.prepare('SELECT instance_id FROM wa_conversations WHERE id = ?').get(m.conversation_id);
  const inst = conv?.instance_id ? instRow(db, conv.instance_id) : null;
  const cfg = liteConfig(db);
  if (!inst || !cfg.configured || !m.media_id) throw notFound('Arquivo não disponível.');
  const r = await evo(cfg, 'POST', `/chat/getBase64FromMediaMessage/${inst.instance_key}`, { message: { key: { id: m.media_id } }, convertToMp4: false });
  if (!r?.base64) throw new HttpError(502, 'O servidor do WhatsApp Lite não devolveu o arquivo.');
  const buf = Buffer.from(String(r.base64).replace(/^data:[^,]*,/, ''), 'base64');
  const mime = r.mimetype || m.media_mime || 'application/octet-stream';
  const filename = r.fileName || m.filename || `whatsapp-${m.id}.${mime.split('/')[1]?.split(';')[0] || 'bin'}`;
  if (buf.length <= MAX_STORE) {
    const sid = storeMedia(db, { mime, name: filename, buf });
    db.prepare('UPDATE wa_messages SET media_store_id = ? WHERE id = ?').run(sid, m.id);
  }
  return { mime, filename, content: buf };
}

/* ------------------------- Webhook do servidor ------------------------- */

const STATUS_MAP = { SERVER_ACK: 'enviada', DELIVERY_ACK: 'entregue', READ: 'lida', PLAYED: 'lida', ERROR: 'falhou', 3: 'entregue', 4: 'lida', 5: 'lida' };
const ORDER = { pendente: 0, simulada: 1, enviada: 1, entregue: 2, lida: 3, falhou: 4 };

/** Conteúdo de uma mensagem do WhatsApp (formato Baileys/Evolution). */
function parseMessage(d) {
  const m = d.message || {};
  const inner = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || m.documentWithCaptionMessage?.message || m;
  const type = Object.keys(inner).find((k) => /Message$|^conversation$/.test(k) && k !== 'messageContextInfo' && k !== 'senderKeyDistributionMessage') || d.messageType || 'unknown';
  const p = inner[type] || {};
  switch (type) {
    case 'conversation': return { kind: 'text', text: String(inner.conversation || '') };
    case 'extendedTextMessage': return { kind: 'text', text: String(p.text || '') };
    case 'imageMessage': return { kind: 'image', text: p.caption || 'Foto', mime: p.mimetype, media: true };
    case 'videoMessage': return { kind: 'video', text: p.caption || 'Vídeo', mime: p.mimetype, media: true };
    case 'audioMessage': return { kind: 'audio', text: 'Áudio', mime: p.mimetype, media: true, seconds: Number(p.seconds) || null };
    case 'documentMessage': return { kind: 'document', text: p.caption || p.fileName || 'Documento', mime: p.mimetype, filename: p.fileName, media: true };
    case 'stickerMessage': return { kind: 'sticker', text: 'Figurinha', mime: p.mimetype || 'image/webp', media: true };
    case 'reactionMessage': return p.text ? { kind: 'reaction', text: `Reagiu com ${p.text}` } : null;
    case 'locationMessage': return { kind: 'location', text: `Localização: ${p.degreesLatitude}, ${p.degreesLongitude}${p.name ? ` (${p.name})` : ''}` };
    case 'contactMessage': return { kind: 'contact', text: `Contato: ${p.displayName || ''}`.trim() };
    case 'protocolMessage': case 'senderKeyDistributionMessage': return null;
    default: return { kind: 'text', text: `[${type}]` };
  }
}

/** Número do cliente na mensagem (com o novo endereçamento "@lid", o número vem em senderPn/remoteJidAlt). */
function peerOf(key = {}) {
  const jid = String(key.remoteJid || '');
  if (/@g\.us$|@broadcast$|@newsletter$/.test(jid)) return null;
  if (/@lid$/.test(jid)) return jidNumber(key.senderPn || key.remoteJidAlt || key.participantPn);
  return jidNumber(jid);
}

function receiveWebhook(db, token, body = {}) {
  const inst = token ? db.prepare('SELECT * FROM wa_instances WHERE webhook_token = ?').get(String(token)) : null;
  if (!inst) throw new HttpError(401, 'Webhook de instância desconhecida.');
  const ev = String(body.event || '').toLowerCase().replace(/_/g, '.');
  const items = Array.isArray(body.data) ? body.data : body.data?.messages && Array.isArray(body.data.messages) ? body.data.messages : [body.data || {}];
  const out = { evento: ev, mensagens: 0, status: 0 };
  db.prepare('UPDATE wa_instances SET last_event_at = ? WHERE id = ?').run(nowIso(), inst.id);
  if (ev === 'qrcode.updated') {
    const qr = qrOf(body.data?.qrcode || body.data);
    if (qr) db.prepare("UPDATE wa_instances SET qr = ?, qr_at = ?, status = CASE WHEN status = 'conectado' THEN status ELSE 'aguardando' END WHERE id = ?").run(qr, nowIso(), inst.id);
  } else if (ev === 'connection.update') {
    const d = body.data || {};
    if (d.state === 'open') {
      const phone = jidNumber(d.wuid || body.sender) || inst.phone;
      const now = nowIso();
      db.prepare("UPDATE wa_instances SET status = 'conectado', phone = ?, profile_name = COALESCE(?, profile_name), qr = NULL, connected_at = COALESCE(connected_at, ?), updated_at = ? WHERE id = ?").run(phone || null, d.profileName || null, now, now, inst.id);
    } else if (d.state === 'close') db.prepare("UPDATE wa_instances SET status = 'desconectado', updated_at = ? WHERE id = ?").run(nowIso(), inst.id);
  } else if (ev === 'messages.upsert') {
    const jobs = [];
    for (const d of items) {
      const r = inbound(db, inst, d);
      if (!r) continue;
      out.mensagens++;
      if (!r.fromMe) jobs.push(r);
    }
    // Número central com o agente de IA: responde antes de devolver o webhook
    return require('./whatsapp').runAgent(db, jobs, out);
  } else if (ev === 'messages.update') {
    for (const d of items) {
      const id = d.keyId || d.key?.id || d.messageId;
      const st = STATUS_MAP[d.status] || STATUS_MAP[d.update?.status];
      const row = id && st && db.prepare('SELECT id, status FROM wa_messages WHERE wamid = ?').get(String(id));
      if (!row || (ORDER[st] ?? 0) < (ORDER[row.status] ?? 0)) continue;
      db.prepare('UPDATE wa_messages SET status = ?, status_at = ? WHERE id = ?').run(st, nowIso(), row.id);
      out.status++;
    }
  }
  return out;
}

/** Mensagem do WhatsApp Lite (recebida do cliente ou enviada pelo celular) → conversa do CRM. */
function inbound(db, inst, d) {
  const key = d.key || {};
  const wamid = clean(key.id);
  const peer = peerOf(key);
  if (!wamid || !peer) return false;
  if (db.prepare('SELECT 1 FROM wa_messages WHERE wamid = ?').get(wamid)) return false;
  const parsed = parseMessage(d);
  if (!parsed) return false;
  const wa = require('./whatsapp');
  const contact = wa.findContactByWa(db, peer);
  // Por padrão, só conversas com quem já está no CRM (o número pode ser pessoal)
  const cands = wa.waCandidates(peer);
  let conv = db.prepare(`SELECT * FROM wa_conversations WHERE channel = 'lite' AND instance_id = ? AND peer IN (${cands.map(() => '?').join(',')}) ORDER BY id LIMIT 1`).get(inst.id, ...cands);
  const agent = require('./waagent');
  if (!conv && !contact && inst.only_known && !(agent.handlesInstance(db, inst.id) && agent.allowsPeer(db, peer))) return false;
  const fromMe = !!key.fromMe;
  // Eco de uma mensagem que o próprio CRM acabou de enviar (o servidor às vezes avisa antes de responder o envio):
  // só registra o ID na mensagem que já está no CRM, sem duplicar e sem contar como resposta de uma pessoa
  if (fromMe && conv) {
    const recent = new Date(Date.now() - 120000).toISOString();
    const pend = db.prepare("SELECT id FROM wa_messages WHERE conversation_id = ? AND direction = 'out' AND wamid IS NULL AND created_at >= ? AND (body = ? OR kind <> 'text') ORDER BY id DESC LIMIT 1")
      .get(conv.id, recent, parsed.text);
    if (pend) {
      db.prepare('UPDATE wa_messages SET wamid = ? WHERE id = ?').run(wamid, pend.id);
      return false;
    }
  }
  const ts = Number(d.messageTimestamp);
  const at = ts ? new Date((ts > 1e12 ? ts : ts * 1000)).toISOString() : nowIso();
  const { insertActivity } = require('./activities');
  const { notify, managersOf } = require('./notifications');
  return tx(db, () => {
    if (!conv) {
      const id = Number(db.prepare("INSERT INTO wa_conversations (wa_id, channel, instance_id, peer, contact_id, profile_name, assigned_to, created_at) VALUES (?, 'lite', ?, ?, ?, ?, ?, ?)")
        .run(`lite:${inst.id}:${peer}`, inst.id, peer, contact?.id ?? null, fromMe ? null : clean(d.pushName), contact?.owner_id ?? inst.owner_id, at).lastInsertRowid);
      conv = db.prepare('SELECT * FROM wa_conversations WHERE id = ?').get(id);
    }
    let storeId = null;
    const b64 = d.message?.base64;
    if (parsed.media && b64) {
      const buf = Buffer.from(String(b64).replace(/^data:[^,]*,/, ''), 'base64');
      if (buf.length && buf.length <= MAX_STORE) storeId = storeMedia(db, { mime: parsed.mime || 'application/octet-stream', name: parsed.filename, buf });
    }
    const msgId = Number(db.prepare('INSERT INTO wa_messages (conversation_id, wamid, direction, kind, body, media_id, media_mime, filename, media_store_id, duration, status, created_at, status_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(conv.id, wamid, fromMe ? 'out' : 'in', parsed.kind, parsed.text, parsed.media ? wamid : null, parsed.mime || null, parsed.filename || null, storeId, parsed.seconds || null, fromMe ? 'enviada' : 'recebida', at, at).lastInsertRowid);
    // Resposta dada pelo celular: a conversa foi vista
    if (fromMe) db.prepare("UPDATE wa_conversations SET last_message_at = ?, unread = 0, status = 'aberta', contact_id = COALESCE(contact_id, ?) WHERE id = ?").run(at, contact?.id ?? null, conv.id);
    else {
      db.prepare("UPDATE wa_conversations SET last_message_at = ?, last_inbound_at = ?, unread = unread + 1, status = 'aberta', profile_name = COALESCE(?, profile_name), contact_id = COALESCE(contact_id, ?), assigned_to = COALESCE(assigned_to, ?) WHERE id = ?")
        .run(at, at, clean(d.pushName), contact?.id ?? null, contact?.owner_id ?? inst.owner_id, conv.id);
    }
    // Resposta dada pelo celular numa conversa que a IA atendia: a IA para
    if (fromMe) agent.humanReplied(db, conv, 'Resposta pelo celular');
    const contactId = conv.contact_id || contact?.id;
    if (contactId) {
      insertActivity(db, { contact_id: contactId, type: fromMe ? 'mensagem_enviada' : 'mensagem_recebida', channel: 'whatsapp', direction: fromMe ? 'saida' : 'entrada', notes: parsed.text, occurred_at: at, source: 'whatsapp', external_id: wamid, user_id: null, ref_type: 'wa_message', ref_id: msgId });
    }
    if (!fromMe) {
      const target = conv.assigned_to || contact?.owner_id || inst.owner_id;
      const who = contact?.name || clean(d.pushName) || fmtPhone(peer);
      if (target) notify(db, target, { kind: 'whatsapp', title: `WhatsApp de ${who}`, body: String(parsed.text).slice(0, 160), link: `#/comunicacao/whatsapp/${conv.id}`, dedupe: true });
      else if (!agent.answers(db, conv)) notify(db, managersOf(db, null), { kind: 'whatsapp', level: 'warn', title: `WhatsApp de número sem cadastro: ${who}`, link: `#/comunicacao/whatsapp/${conv.id}`, dedupe: true });
    }
    return { conv: conv.id, msg: msgId, fromMe };
  });
}

/** Conversa pelo WhatsApp Lite com um cliente do CRM (escolhendo o número conectado). */
function startConversation(db, user, contact, instanceId) {
  const inst = loadInstance(db, user, instanceId);
  if (accessOf(db, user, inst) !== 'enviar') throw forbidden('Seu acesso a este número é "Só ver".');
  const wa = require('./whatsapp');
  const peer = wa.toWaId(contact.whatsapp || contact.phone1 || contact.phone2);
  if (!peer) throw badRequest('O cadastro não tem WhatsApp ou celular válido.');
  const cands = wa.waCandidates(peer);
  const existing = db.prepare(`SELECT id FROM wa_conversations WHERE channel = 'lite' AND instance_id = ? AND (peer IN (${cands.map(() => '?').join(',')}) OR contact_id = ?) ORDER BY id LIMIT 1`).get(inst.id, ...cands, contact.id);
  if (existing) return { id: existing.id };
  const id = Number(db.prepare("INSERT INTO wa_conversations (wa_id, channel, instance_id, peer, contact_id, profile_name, assigned_to, created_at) VALUES (?, 'lite', ?, ?, ?, ?, ?, ?)")
    .run(`lite:${inst.id}:${peer}`, inst.id, peer, contact.id, contact.name, contact.owner_id || user.id, nowIso()).lastInsertRowid);
  return { id };
}

module.exports = {
  liteConfig, saveConfig, overview, createInstance, instanceStatus, reconnect, simulateConnect, disconnect, removeInstance, updateInstance,
  members, setMemberAccess, accessOf, convAccess, visibleInstanceIds, send, mediaFor, receiveWebhook, startConversation, parseMessage, initials, LEVEL_LABEL, MAX_FILE,
};
