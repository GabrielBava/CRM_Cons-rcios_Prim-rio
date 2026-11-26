'use strict';
/**
 * Agente de IA do WhatsApp (número central da Vero).
 *
 * Quando um lead escreve no número central (WhatsApp Lite conectado por QR Code ou o número oficial), o agente
 * responde sozinho com o Claude (Anthropic): faz a triagem do lead (as 6 perguntas da aba Qualificação), registra as
 * respostas no CRM, avalia o fit e, se houver fit, oferece horários livres da agenda do especialista responsável e
 * agenda a R1. Passa a conversa para o especialista quando o lead pede, quando não sabe responder, quando não há fit
 * ou depois de agendar a R1. O especialista pode assumir a conversa a qualquer momento (a IA para de responder).
 *
 * Funciona sem servidor fixo (Vercel): o trabalho acontece dentro da requisição do webhook. Mensagens seguidas do
 * lead são juntadas (espera curta) e uma trava por conversa evita duas respostas ao mesmo tempo.
 */
const { getSetting, setSetting, tx } = require('../db');
const { audit } = require('../core');
const { badRequest, forbidden, notFound, clean: cleanRaw, nowIso } = require('../util');
const { notify, managersOf } = require('./notifications');

const clean = (v) => cleanRaw(v) ?? null;
const AGENT_USER = { id: null, role: 'admin', name: 'IA Vero (WhatsApp)', modules: null };
const TZ = 'America/Sao_Paulo';
const llm = require('./llm');
const MODELS = llm.CLAUDE_MODELS;
const DEFAULT_FIT = 'Tem fit quem demonstra interesse real, tem uma necessidade clara (imóvel, veículo, serviço, reforma ou organização financeira), pretende começar em até 12 meses e consegue investir pelo menos R$ 500 por mês.';
const DEFAULTS = {
  enabled: false, channel: 'lite', instance_id: null, name: 'Vero', provider: 'gemini', model: 'claude-opus-5-5', gemini_model: llm.GEMINI_DEFAULT, r1_minutes: 45, days: [1, 2, 3, 4, 5],
  start: '09:00', end: '18:00', notice_hours: 2, fit: DEFAULT_FIT, instructions: '',
  // Modo de teste: a IA só atende estes números (vazio = todos que escreverem para o número central)
  test_numbers: '',
  // Especialista que recebe os leads novos quando a distribuição automática não definir ninguém
  default_owner_id: null,
  // Provedor "n8n": a IA roda num fluxo do n8n na VPS e fala com o CRM por um token próprio (só o hash fica salvo)
  n8n_token_hash: null, n8n_token_hint: null,
  // Manda as transcrições das R1 (sem dados pessoais) para a base de conhecimento do n8n
  n8n_transcripts: false,
};
const STATUS_LABEL = { ativa: 'IA atendendo', humano: 'Com o especialista', pausada: 'Especialista assumiu' };
// Mensagem de cortesia quando a IA falha: não conta como resposta (ao devolver, a IA responde o que ficou pendente)
const FALLBACK = 'Obrigada pela mensagem! Um especialista da nossa equipe vai continuar o seu atendimento em instantes.';
const isCourtesy = (m) => m && m.direction === 'out' && !!m.ai && m.body === FALLBACK;

/**
 * Mensagens do lead que ficaram sem resposta de verdade (depois da última resposta da IA ou de uma pessoa, sem contar
 * a mensagem de cortesia). Devolve a última delas e quantas são, ou null.
 */
function pendingInbound(db, convId) {
  const rows = db.prepare('SELECT id, direction, ai, body FROM wa_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 60').all(convId);
  let last = null;
  let count = 0;
  let replyId = 0;
  for (const m of rows) {
    if (m.direction === 'out') {
      if (isCourtesy(m)) continue;
      replyId = m.id;
      break;
    }
    if (!last) last = m.id;
    count++;
  }
  return last ? { last, count, replyId } : null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const debounceMs = () => Math.max(0, Number(process.env.WA_AGENT_DEBOUNCE_MS ?? 6000));
const MAX_TURN_MS = 45000;
const LOCK_MS = 90000;

/* ------------------------- Configuração ------------------------- */

function config(db) {
  const saved = getSetting(db, 'wa_agent');
  const c = { ...DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) };
  c.days = Array.isArray(c.days) && c.days.length ? c.days.map(Number).filter((d) => d >= 0 && d <= 6) : DEFAULTS.days;
  return c;
}

/** O agente está ligado e pronto para responder (chave do provedor escolhido e, no Claude, a biblioteca; no n8n, o token). */
function ready(db) {
  const c = config(db);
  if (!c.enabled) return { ok: false, reason: 'desligado', cfg: c };
  if (c.provider === 'n8n') return c.n8n_token_hash ? { ok: true, cfg: c } : { ok: false, reason: 'sem_token_n8n', cfg: c };
  const av = llm.availability(db, c.provider);
  if (!av.ok) return { ok: false, reason: av.reason, cfg: c };
  return { ok: true, cfg: c };
}
const modelOf = (cfg) => (cfg.provider === 'n8n' ? 'n8n' : llm.providerOf(cfg.provider) === 'claude' ? cfg.model || llm.DEFAULTS.claude : cfg.gemini_model || llm.GEMINI_DEFAULT);

/** A conversa é do número central atendido pelo agente? */
function handlesConversation(db, w) {
  const c = config(db);
  if (!c.enabled || !w) return false;
  if (c.channel === 'oficial') return (w.channel || 'oficial') === 'oficial';
  return w.channel === 'lite' && Number(w.instance_id) === Number(c.instance_id);
}
function handlesInstance(db, instId) {
  const c = config(db);
  return !!(c.enabled && c.channel === 'lite' && Number(c.instance_id) === Number(instId));
}
/** O agente vai mesmo responder (ligado e com a IA pronta): só então dispensa o aviso de "número sem cadastro". */
function answers(db, w) {
  return handlesConversation(db, w) && allowsPeer(db, peerOfConv(w)) && ready(db).ok;
}

/** Números do modo de teste, normalizados (com e sem o nono dígito). */
function testNumbers(cfg) {
  const wa = require('./whatsapp');
  return String(cfg.test_numbers || '').split(/[\n,;]+/).map((x) => wa.toWaId(x)).filter(Boolean).flatMap((x) => wa.waCandidates(x));
}
/** O agente pode atender este número? (fora do modo de teste, qualquer um) */
function allowsPeer(db, peer) {
  const list = testNumbers(config(db));
  if (!list.length) return true;
  const wa = require('./whatsapp');
  return wa.waCandidates(String(peer || '').replace(/\D/g, '')).some((x) => list.includes(x));
}
const peerOfConv = (w) => (w?.channel === 'lite' ? w.peer : w?.wa_id);

const isLead = (u) => u.role === 'admin' || u.role === 'gestor';

function view(db, user, req) {
  if (!isLead(user)) throw forbidden('O agente de IA é configurado pela liderança.');
  const c = config(db);
  const { n8n_token_hash: _hash, ...pub } = c;
  const r = ready(db);
  const prov = llm.providersStatus(db);
  const instances = db.prepare("SELECT id, name, phone, status FROM wa_instances ORDER BY status = 'conectado' DESC, name").all();
  const wa = require('./whatsapp');
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const count = (action) => db.prepare('SELECT COUNT(DISTINCT conversation_id) AS n FROM wa_agent_log WHERE action = ? AND created_at >= ?').get(action, since).n;
  const tokens = db.prepare('SELECT COALESCE(SUM(tokens_in), 0) AS i, COALESCE(SUM(tokens_out), 0) AS o FROM wa_agent_log WHERE created_at >= ?').get(since);
  const recent = db.prepare(`SELECT l.action, l.detail, l.created_at, l.conversation_id, c.name AS contact_name FROM wa_agent_log l LEFT JOIN contacts c ON c.id = l.contact_id
    WHERE l.action IN ('qualificou','agendou_r1','transferiu','sem_fit','erro','novo_lead') ORDER BY l.id DESC LIMIT 12`).all();
  return {
    config: pub,
    ready: r.ok, reason: r.ok ? null : r.reason,
    llm: { provider: c.provider === 'n8n' ? 'n8n' : llm.providerOf(c.provider), model: modelOf(c), has_key: c.provider === 'n8n' ? true : prov[llm.providerOf(c.provider)].has_key, sdk: prov.claude.sdk },
    n8n: require('./n8n').info(db, req),
    providers: { claude: { has_key: prov.claude.has_key, from_env: prov.claude.from_env, sdk: prov.claude.sdk }, gemini: { has_key: prov.gemini.has_key, from_env: prov.gemini.from_env, note: prov.gemini.free_tier_note } },
    can_edit: user.role === 'admin',
    official: (() => {
      const o = wa.waConfig(db);
      return { configured: !!o.configured, sandbox: !!o.sandbox };
    })(),
    instances: instances.map((i) => ({ ...i, label: `${i.name}${i.phone ? ` · +${i.phone}` : ''}${i.status === 'conectado' ? '' : ' (desconectado)'}` })),
    models: MODELS.map(([value, label]) => ({ value, label })),
    users: db.prepare("SELECT id, name, role FROM users WHERE active = 1 AND role IN ('consultor','gestor','admin') ORDER BY role = 'consultor' DESC, name").all(),
    test_mode: testNumbers(c).length > 0,
    // Falhas da IA nas últimas 24 h: o lead recebeu a mensagem de cortesia e a conversa foi para o especialista
    last_error: (() => {
      const since24 = new Date(Date.now() - 86400000).toISOString();
      const e = db.prepare("SELECT detail, created_at FROM wa_agent_log WHERE action = 'erro' AND created_at >= ? ORDER BY id DESC LIMIT 1").get(since24);
      return e ? { ...e, count: db.prepare("SELECT COUNT(*) AS n FROM wa_agent_log WHERE action = 'erro' AND created_at >= ?").get(since24).n } : null;
    })(),
    stats: {
      atendidas: db.prepare('SELECT COUNT(DISTINCT conversation_id) AS n FROM wa_agent_log WHERE created_at >= ?').get(since).n,
      novos_leads: count('novo_lead'), qualificados: count('qualificou'), r1_agendadas: count('agendou_r1'), transferidas: count('transferiu'), sem_fit: count('sem_fit'),
      ativas: db.prepare("SELECT COUNT(*) AS n FROM wa_conversations WHERE ai_status = 'ativa'").get().n,
      tokens_in: tokens.i, tokens_out: tokens.o,
    },
    recent,
  };
}

function save(db, user, data = {}, req) {
  if (user.role !== 'admin') throw forbidden('Só o administrador liga e configura o agente de IA.');
  const c = config(db);
  const next = { ...c };
  if (data.enabled !== undefined) next.enabled = !!data.enabled;
  if (data.channel !== undefined) {
    if (!['lite', 'oficial'].includes(data.channel)) throw badRequest('Canal inválido.');
    next.channel = data.channel;
  }
  if (data.instance_id !== undefined) next.instance_id = data.instance_id ? Number(data.instance_id) : null;
  if (data.name !== undefined) next.name = String(clean(data.name) || 'Vero').slice(0, 40);
  if (data.provider !== undefined) {
    if (!['gemini', 'claude', 'n8n'].includes(data.provider)) throw badRequest('Provedor de IA inválido: use gemini, claude ou n8n.');
    next.provider = data.provider;
  }
  if (data.model !== undefined) {
    if (!MODELS.some(([m]) => m === data.model)) throw badRequest('Modelo inválido.');
    next.model = data.model;
  }
  if (data.gemini_model !== undefined) {
    const m = String(data.gemini_model || '').trim().replace(/^models\//, '');
    if (!/^gemini-[a-z0-9.-]+$/i.test(m)) throw badRequest('Modelo do Gemini inválido (ex.: gemini-3.8-flash).');
    next.gemini_model = m;
  }
  // Chaves (as mesmas da IA generativa): podem ser informadas aqui também
  if (data.gemini_api_key || data.api_key) {
    require('./assistant').saveConfig(db, user, { ...(data.gemini_api_key ? { gemini_api_key: data.gemini_api_key } : {}), ...(data.api_key ? { api_key: data.api_key } : {}) });
  }
  if (data.r1_minutes !== undefined) {
    const m = Number(data.r1_minutes);
    if (![30, 45, 60, 90].includes(m)) throw badRequest('Duração da R1: 30, 45, 60 ou 90 minutos.');
    next.r1_minutes = m;
  }
  if (data.days !== undefined) {
    const d = (Array.isArray(data.days) ? data.days : []).map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6);
    if (!d.length) throw badRequest('Escolha ao menos um dia da semana para a R1.');
    next.days = [...new Set(d)].sort();
  }
  for (const k of ['start', 'end']) {
    if (data[k] !== undefined) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(data[k]))) throw badRequest('Horário inválido (use HH:MM).');
      next[k] = String(data[k]);
    }
  }
  if (next.start >= next.end) throw badRequest('O horário final precisa ser depois do inicial.');
  if (data.notice_hours !== undefined) next.notice_hours = Math.min(72, Math.max(0, Number(data.notice_hours) || 0));
  if (data.fit !== undefined) next.fit = String(clean(data.fit) || DEFAULT_FIT).slice(0, 1500);
  if (data.instructions !== undefined) next.instructions = String(clean(data.instructions) || '').slice(0, 3000);
  if (data.test_numbers !== undefined) {
    next.test_numbers = String(clean(data.test_numbers) || '').slice(0, 500);
    if (next.test_numbers && !testNumbers(next).length) throw badRequest('Números do modo de teste inválidos (ex.: 51 99999-0000).');
  }
  if (data.n8n_transcripts !== undefined) next.n8n_transcripts = !!data.n8n_transcripts;
  if (data.default_owner_id !== undefined) {
    const id = data.default_owner_id ? Number(data.default_owner_id) : null;
    if (id && !db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1 AND role IN ('consultor','gestor','admin')").get(id)) throw badRequest('Especialista padrão inválido.');
    next.default_owner_id = id;
  }
  if (next.enabled) {
    if (next.channel === 'lite') {
      const inst = next.instance_id && db.prepare('SELECT * FROM wa_instances WHERE id = ?').get(next.instance_id);
      if (!inst) throw badRequest('Escolha o número central (WhatsApp Lite) que o agente vai atender.');
      // O número central recebe leads novos: registra todas as conversas, não só as de quem já está no CRM.
      // No modo de teste (número pessoal), só os números da lista entram além dos cadastros do CRM.
      db.prepare('UPDATE wa_instances SET only_known = ?, updated_at = ? WHERE id = ?').run(testNumbers(next).length ? 1 : 0, nowIso(), inst.id);
    }
  }
  setSetting(db, 'wa_agent', next);
  audit(db, user, 'integration', null, 'agente_ia_whatsapp', { ligado: next.enabled, canal: next.channel, provedor: next.provider, modelo: modelOf(next) });
  return view(db, user, req);
}

/* ------------------------- Controle por conversa ------------------------- */

function setStatus(db, convId, status, reason) {
  db.prepare('UPDATE wa_conversations SET ai_status = ?, ai_reason = ?, ai_updated_at = ? WHERE id = ?').run(status, reason || null, nowIso(), convId);
}

/** Especialista assume a conversa (a IA para) ou devolve para a IA. */
async function control(db, user, convId, data = {}) {
  const wa = require('./whatsapp');
  const w = wa.loadConvForAgent(db, user, convId);
  const action = String(data.acao || data.action || '');
  if (action === 'assumir') {
    setStatus(db, w.id, 'pausada', `Assumida por ${user.name}`);
    db.prepare('UPDATE wa_conversations SET ai_resume_at = NULL WHERE id = ?').run(w.id);
    log(db, w, 'assumida', user.name);
    if (!w.assigned_to && user.id) db.prepare('UPDATE wa_conversations SET assigned_to = ? WHERE id = ?').run(user.id, w.id);
    return { ai_status: 'pausada' };
  }
  if (action !== 'devolver') throw badRequest('Ação inválida: use "assumir" ou "devolver".');
  if (!handlesConversation(db, w)) throw badRequest('Esta conversa não é do número atendido pelo agente de IA.');
  setStatus(db, w.id, 'ativa', `Devolvida à IA por ${user.name}`);
  log(db, w, 'devolvida', user.name);
  // Mensagens do lead sem resposta: a IA lê o histórico e responde agora (no n8n, na próxima volta, em até 1 minuto)
  const pend = pendingInbound(db, w.id);
  if (!pend) return { ai_status: 'ativa', retomada: null };
  db.prepare('UPDATE wa_conversations SET ai_seen_id = ? WHERE id = ?').run(pend.replyId || null, w.id);
  const r = ready(db);
  if (r.ok && r.cfg.provider === 'n8n') {
    db.prepare('UPDATE wa_conversations SET ai_resume_at = ? WHERE id = ?').run(nowIso(), w.id);
    return { ai_status: 'ativa', retomada: 'n8n', pendentes: pend.count };
  }
  if (!r.ok) return { ai_status: 'ativa', retomada: null, motivo: r.reason };
  const out = await onInbound(db, w.id, pend.last, { now: true }).catch((e) => ({ erro: e.message }));
  return { ai_status: db.prepare('SELECT ai_status FROM wa_conversations WHERE id = ?').get(w.id).ai_status, retomada: 'crm', pendentes: pend.count, respondeu: !!out?.reply };
}

/** Mensagem enviada por uma pessoa (pelo CRM ou pelo celular) numa conversa que a IA atendia: a IA para. */
function humanReplied(db, w, who) {
  if (w && w.ai_status === 'ativa') {
    setStatus(db, w.id, 'pausada', `${who || 'Especialista'} respondeu`);
    log(db, w, 'assumida', who || 'Especialista respondeu');
  }
}

function log(db, w, action, detail, usage) {
  db.prepare('INSERT INTO wa_agent_log (conversation_id, contact_id, action, detail, tokens_in, tokens_out, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(w.id, w.contact_id || null, action, detail ? String(detail).slice(0, 500) : null, usage?.in || 0, usage?.out || 0, nowIso());
}

/* ------------------------- Disparo ------------------------- */

/**
 * Chamado pelos webhooks depois de gravar uma mensagem recebida. Devolve uma promessa (o webhook espera o agente
 * terminar, porque na Vercel nada roda depois da resposta).
 */
/**
 * A IA pode atender esta conversa agora? Devolve o motivo quando não pode (as mesmas regras para o agente do CRM e
 * para o fluxo do n8n).
 */
function gate(db, w) {
  if (!w) return 'sem_conversa';
  if (!config(db).enabled) return 'ia_desligada';
  if (!handlesConversation(db, w)) return 'fora_do_numero_central';
  if (!allowsPeer(db, peerOfConv(w))) return 'modo_de_teste';
  if (w.ai_status === 'humano' || w.ai_status === 'pausada') return 'com_especialista';
  const r = ready(db);
  if (!r.ok) return r.reason;
  // Conversa que a equipe já atendia antes de ligar o agente: a IA não entra no meio
  if (!w.ai_status && db.prepare("SELECT 1 FROM wa_messages WHERE conversation_id = ? AND direction = 'out' AND ai = 0 LIMIT 1").get(w.id)) return 'equipe_ja_atendia';
  return null;
}

async function onInbound(db, convId, msgId, opts = {}) {
  let w = db.prepare('SELECT * FROM wa_conversations WHERE id = ?').get(convId);
  if (gate(db, w)) return null;
  const r = ready(db);
  // Com o provedor n8n, quem responde é o fluxo do n8n (ele recebe a mensagem pelo conector)
  if (r.cfg.provider === 'n8n') return null;
  // Junta mensagens seguidas: só quem recebeu a última responde (ao retomar uma conversa devolvida, sem esperar)
  const wait = opts.now ? 0 : debounceMs();
  if (wait) await sleep(wait);
  const newer = db.prepare("SELECT 1 FROM wa_messages WHERE conversation_id = ? AND direction = 'in' AND id > ?").get(convId, msgId);
  if (newer) return { skipped: 'nova_mensagem' };
  // Trava da conversa (outra resposta em andamento: espera terminar)
  const t0 = Date.now();
  while (!lock(db, convId)) {
    if (Date.now() - t0 > MAX_TURN_MS) return { skipped: 'ocupada' };
    await sleep(1000);
  }
  try {
    let turns = 0;
    let result = null;
    while (turns < 3) {
      w = db.prepare('SELECT * FROM wa_conversations WHERE id = ?').get(convId);
      if (w.ai_status === 'humano' || w.ai_status === 'pausada') break;
      const last = db.prepare("SELECT MAX(id) AS id FROM wa_messages WHERE conversation_id = ? AND direction = 'in'").get(convId).id;
      if (!last || (w.ai_seen_id && w.ai_seen_id >= last)) break;
      db.prepare('UPDATE wa_conversations SET ai_seen_id = ? WHERE id = ?').run(last, convId);
      result = await runTurn(db, r.cfg, w);
      turns++;
    }
    return result;
  } finally {
    db.prepare('UPDATE wa_conversations SET ai_lock_at = NULL WHERE id = ?').run(convId);
  }
}

function lock(db, convId, ms = LOCK_MS) {
  const now = nowIso();
  const stale = new Date(Date.now() - ms).toISOString();
  return db.prepare('UPDATE wa_conversations SET ai_lock_at = ? WHERE id = ? AND (ai_lock_at IS NULL OR ai_lock_at < ?)').run(now, convId, stale).changes === 1;
}

/* ------------------------- Lead e contexto ------------------------- */

/** Número desconhecido no número central: vira lead (origem WhatsApp) e entra na distribuição. */
function ensureLead(db, w) {
  if (w.contact_id) return w;
  const wa = require('./whatsapp');
  const peer = w.channel === 'lite' ? w.peer : w.wa_id;
  const found = wa.findContactByWa(db, peer);
  let contactId = found?.id;
  if (!contactId) {
    const { createContact } = require('./contacts');
    const r = createContact(db, AGENT_USER, {
      kind: 'PF', name: clean(w.profile_name) || 'Lead do WhatsApp', phone1: peer, whatsapp: peer, origin: 'whatsapp', relationship: 'lead', owner_id: null,
      initial_notes: 'Lead que chamou no WhatsApp central da Vero; atendimento inicial pelo agente de IA.',
      origin_details: { origin: 'whatsapp', platform: 'whatsapp', received_at: nowIso(), source_ref: 'wa_agent' }, create_opportunity: true,
    }, { system: true, skipDuplicateCheck: true, source: 'whatsapp', sourceLabel: 'pelo WhatsApp (agente de IA)' });
    contactId = r.id;
    const to = require('./distribution').autoDistribute(db, contactId);
    const def = config(db).default_owner_id;
    if (!to && def) db.prepare('UPDATE contacts SET owner_id = ? WHERE id = ? AND owner_id IS NULL').run(def, contactId);
    if (!to && def) db.prepare('UPDATE opportunities SET owner_id = ? WHERE contact_id = ? AND owner_id IS NULL').run(def, contactId);
    log(db, { ...w, contact_id: contactId }, 'novo_lead', clean(w.profile_name));
  }
  const owner = db.prepare('SELECT owner_id FROM contacts WHERE id = ?').get(contactId)?.owner_id ?? null;
  db.prepare('UPDATE wa_conversations SET contact_id = ?, assigned_to = COALESCE(assigned_to, ?) WHERE id = ?').run(contactId, owner, w.id);
  return db.prepare('SELECT * FROM wa_conversations WHERE id = ?').get(w.id);
}

function openOpp(db, contactId) {
  let o = db.prepare("SELECT o.*, s.key AS stage_key, s.name AS stage_name FROM opportunities o JOIN pipeline_stages s ON s.id = o.stage_id WHERE o.contact_id = ? AND o.status = 'aberta' ORDER BY o.id DESC LIMIT 1").get(contactId);
  if (!o) {
    const { createOpportunityRow } = require('./opportunities');
    const owner = db.prepare('SELECT owner_id FROM contacts WHERE id = ?').get(contactId)?.owner_id ?? null;
    createOpportunityRow(db, AGENT_USER, { contact_id: contactId, owner_id: owner });
    o = db.prepare("SELECT o.*, s.key AS stage_key, s.name AS stage_name FROM opportunities o JOIN pipeline_stages s ON s.id = o.stage_id WHERE o.contact_id = ? AND o.status = 'aberta' ORDER BY o.id DESC LIMIT 1").get(contactId);
  }
  return o;
}

const optionsOf = (db, list) => db.prepare('SELECT value, label FROM options WHERE list = ? AND active = 1 ORDER BY position, id').all(list);

function leadContext(db, w) {
  const c = db.prepare('SELECT id, code, name, email, owner_id, origin, campaign FROM contacts WHERE id = ?').get(w.contact_id);
  const o = openOpp(db, c.id);
  const ops = require('./opportunities');
  const triage = o ? ops.triageOf(o) : {};
  const owner = c.owner_id ? db.prepare('SELECT name FROM users WHERE id = ?').get(c.owner_id) : null;
  const r1 = db.prepare("SELECT due_at FROM tasks WHERE contact_id = ? AND type = 'reuniao' AND status = 'pendente' AND due_at > ? ORDER BY due_at LIMIT 1").get(c.id, nowIso());
  const qual = {};
  if (o) for (const [f, label] of ops.QUALIFICATION_FIELDS) if (o[f] != null && o[f] !== '') qual[label] = o[f];
  return {
    contact: c, opp: o, owner,
    data: {
      nome: c.name, codigo: c.code, email: c.email || null, origem: c.origin, campanha: c.campaign || null,
      etapa: o?.stage_name || null, especialista_responsavel: owner?.name || 'ainda não definido',
      triagem: triage, triagem_concluida: !!o?.triaged_at, qualificacao: qual,
      faltam_na_triagem: missingTriage(triage),
      r1_agendada: r1 ? fmtSlot(new Date(r1.due_at)) : null,
      proximo_passo: nextStep(triage, !!r1),
      agora: fmtSlot(new Date()),
    },
  };
}

/* Perguntas da triagem, na ordem do roteiro (as mesmas 6 da aba Qualificação) */
const TRIAGE_STEPS = [
  ['interesse', 'interesse em seguir'],
  ['dor', 'necessidade (o que quer conquistar) e o resumo nas palavras do cliente'],
  ['impacto', 'em quanto tempo quer resolver'],
  ['decisor', 'se é quem decide'],
  ['faixa_investimento', 'quanto consegue investir por mês'],
  ['faixa_renda', 'faixa de renda mensal'],
];
const missingTriage = (t = {}) => TRIAGE_STEPS.filter(([k]) => !t[k]).map(([k]) => k);
function nextStep(t = {}, hasR1) {
  if (hasR1) return 'R1 já agendada: confirme os detalhes e encerre com cordialidade.';
  const miss = TRIAGE_STEPS.filter(([k]) => !t[k]);
  if (miss.length) return `Triagem: perguntar ${miss[0][1]} (faltam ${miss.length} de 6).`;
  return t.interesse === 'nao' ? 'Triagem completa sem interesse: encerrar sem fit.' : 'Triagem completa: avaliar o fit e, com fit, oferecer horários da R1 (horarios_r1).';
}

/* ------------------------- Agenda (horários livres da R1) ------------------------- */

const WEEKDAY = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
function spParts(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return p;
}
function fmtSlot(d) {
  const p = spParts(d);
  const wd = new Date(`${p.year}-${p.month}-${p.day}T12:00:00-03:00`).getUTCDay();
  return `${WEEKDAY[wd]}, ${p.day}/${p.month} às ${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}

/** Horários livres para a R1 nos próximos dias úteis configurados, na agenda do especialista. */
function freeSlots(db, cfg, ownerId, max = 8) {
  const out = [];
  const now = Date.now();
  const earliest = now + (Number(cfg.notice_hours) || 0) * 3600000;
  const step = (Number(cfg.r1_minutes) || 45) * 60000;
  const busy = ownerId
    ? db.prepare("SELECT due_at, ends_at FROM tasks WHERE assigned_to = ? AND status = 'pendente' AND due_at IS NOT NULL AND due_at < ? AND (type = 'reuniao' OR ends_at IS NOT NULL)").all(ownerId, new Date(now + 15 * 86400000).toISOString())
      .map((t) => [Date.parse(t.due_at), t.ends_at ? Date.parse(t.ends_at) : Date.parse(t.due_at) + 3600000])
    : [];
  const perDay = {};
  for (let i = 0; i < 14 && out.length < max; i++) {
    const p = spParts(new Date(now + i * 86400000));
    const ymd = `${p.year}-${p.month}-${p.day}`;
    const wd = new Date(`${ymd}T12:00:00-03:00`).getUTCDay();
    if (!cfg.days.includes(wd)) continue;
    let t = Date.parse(`${ymd}T${cfg.start}:00-03:00`);
    const end = Date.parse(`${ymd}T${cfg.end}:00-03:00`);
    for (; t + step <= end && out.length < max; t += step) {
      if (t < earliest) continue;
      if (busy.some(([a, b]) => a < t + step && b > t)) continue;
      // Até 3 opções por dia, para espalhar pela semana
      if ((perDay[ymd] = (perDay[ymd] || 0) + 1) > 3) break;
      out.push({ inicio: new Date(t).toISOString(), rotulo: fmtSlot(new Date(t)) });
    }
  }
  return out;
}

/* ------------------------- Ferramentas do agente ------------------------- */

function tools(db) {
  const en = (list) => optionsOf(db, list).map((o) => o.value);
  const desc = (list) => optionsOf(db, list).map((o) => `${o.value} = ${o.label}`).join('; ');
  return [
    {
      name: 'salvar_triagem',
      description: 'Registra no CRM as respostas da triagem do lead assim que o cliente responder (pode enviar só os campos já respondidos; chame de novo quando tiver mais). As 6 perguntas: interesse, dor/necessidade, impacto (prazo), decisor, faixa de investimento mensal e faixa de renda.',
      input_schema: {
        type: 'object',
        properties: {
          interesse: { type: 'string', enum: ['sim', 'nao'], description: 'O lead tem interesse real em seguir?' },
          dor: { type: 'string', enum: ['sim', 'nao'], description: 'Existe uma dor ou necessidade clara?' },
          dor_descricao: { type: 'string', description: 'Resumo curto da necessidade, nas palavras do cliente (ex.: "comprar o primeiro apartamento").' },
          impacto: { type: 'string', enum: en('triagem_impacto'), description: `Quando quer resolver: ${desc('triagem_impacto')}` },
          decisor: { type: 'string', enum: en('triagem_decisor'), description: `É quem decide: ${desc('triagem_decisor')}` },
          faixa_investimento: { type: 'string', enum: en('faixa_investimento'), description: `Quanto consegue investir por mês: ${desc('faixa_investimento')}` },
          faixa_renda: { type: 'string', enum: en('faixa_renda'), description: `Renda mensal: ${desc('faixa_renda')}` },
        },
      },
    },
    {
      name: 'salvar_qualificacao',
      description: 'Registra detalhes da qualificação que o cliente contar espontaneamente (objetivo, valor do crédito, categoria, prazo, parcela, FGTS, lance). Só preenche campos vazios.',
      input_schema: {
        type: 'object',
        properties: {
          objetivo: { type: 'string', enum: en('objetivo'), description: `Objetivo: ${desc('objetivo')}` },
          categoria: { type: 'string', enum: en('categoria_credito'), description: `Categoria: ${desc('categoria_credito')}` },
          valor_credito: { type: 'number', description: 'Valor do crédito/bem desejado, em reais.' },
          prazo: { type: 'string', enum: en('urgencia'), description: `Quando quer o crédito: ${desc('urgencia')}` },
          parcela_maxima: { type: 'number', description: 'Parcela máxima mensal que cabe no orçamento, em reais.' },
          possui_fgts: { type: 'string', enum: en('possui_fgts'), description: `FGTS: ${desc('possui_fgts')}` },
          recurso_para_lance: { type: 'string', enum: ['sim', 'nao', 'nao_sabe'], description: 'Tem recurso próprio para dar lance?' },
          observacoes: { type: 'string', description: 'Informações úteis para o especialista (até 300 caracteres).' },
        },
      },
    },
    {
      name: 'horarios_r1',
      description: 'Lista horários livres para a reunião de apresentação (R1) com o especialista. Use só depois da triagem concluída e com fit. Ofereça 2 ou 3 opções ao cliente.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'agendar_r1',
      description: 'Agenda a R1 no horário que o cliente escolheu (precisa ser um dos horários devolvidos por horarios_r1). Use só com a triagem concluída, interesse "sim" e fit.',
      input_schema: {
        type: 'object',
        properties: {
          inicio: { type: 'string', description: 'Início no formato ISO exatamente como veio em horarios_r1.' },
          email: { type: 'string', description: 'E-mail do cliente para o convite (opcional).' },
        },
        required: ['inicio'],
      },
    },
    {
      name: 'transferir_especialista',
      description: 'Passa a conversa para um especialista humano (a IA para de responder). Use quando o cliente pedir uma pessoa, reclamar, já for cliente, perguntar valores, taxas, propostas, contratos ou algo que você não sabe, ou quando a conversa sair do objetivo.',
      input_schema: { type: 'object', properties: { motivo: { type: 'string' } }, required: ['motivo'] },
    },
    {
      name: 'encerrar_sem_fit',
      description: 'Registra que o lead não tem fit agora (ex.: sem interesse, sem capacidade de investimento, prazo muito distante) e passa para o especialista decidir (nutrição ou perdido). Despeça-se com cordialidade.',
      input_schema: { type: 'object', properties: { motivo: { type: 'string' } }, required: ['motivo'] },
    },
  ];
}

async function runTool(db, cfg, w, ctx, name, input) {
  const ops = require('./opportunities');
  const o = ctx.opp;
  try {
    if (name === 'salvar_triagem') {
      if (!o) return { erro: 'Lead sem negócio aberto.' };
      const data = {};
      for (const k of ['interesse', 'dor', 'dor_descricao', 'impacto', 'decisor', 'faixa_investimento', 'faixa_renda']) if (input[k] != null && input[k] !== '') data[k] = input[k];
      const r = ops.saveTriage(db, AGENT_USER, o.id, data);
      if (r.done) log(db, w, 'qualificou', `Triagem concluída: interesse ${r.triage.interesse}`);
      return { salvo: true, triagem_concluida: r.done, faltam: r.missing, etapa_atualizada: r.moved || null };
    }
    if (name === 'salvar_qualificacao') {
      if (!o) return { erro: 'Lead sem negócio aberto.' };
      const map = { objetivo: 'objective_type', categoria: 'credit_category', valor_credito: 'credit_value', prazo: 'urgency', parcela_maxima: 'installment_max', possui_fgts: 'has_fgts', recurso_para_lance: 'has_bid_resources' };
      const fields = {};
      for (const [k, f] of Object.entries(map)) if (input[k] != null && input[k] !== '') fields[f] = input[k];
      if (input.observacoes) fields.decision_notes = String(input.observacoes).slice(0, 300);
      const r = ops.fillQualification(db, AGENT_USER, o.id, { source: 'agente de IA no WhatsApp', fields });
      return { salvo: r.filled, ja_preenchidos: r.ignored };
    }
    if (name === 'horarios_r1') {
      const owner = ensureOwner(db, w);
      if (!owner) return { erro: 'Ainda não há especialista para este lead. Transfira a conversa para a equipe.' };
      const slots = freeSlots(db, cfg, owner);
      return slots.length ? { horarios: slots } : { erro: 'Sem horários livres nos próximos dias. Transfira para o especialista combinar.' };
    }
    if (name === 'agendar_r1') {
      const owner = ensureOwner(db, w);
      if (!owner) return { erro: 'Ainda não há especialista para este lead. Transfira a conversa para a equipe.' };
      const slots = freeSlots(db, cfg, owner, 40);
      const pick = slots.find((s) => s.inicio === input.inicio);
      if (!pick) return { erro: 'Horário indisponível. Consulte horarios_r1 de novo e ofereça outras opções.' };
      const start = new Date(pick.inicio);
      const end = new Date(start.getTime() + cfg.r1_minutes * 60000);
      const meetings = require('./meetings');
      const r = await meetings.scheduleR1(db, AGENT_USER, {
        contact_id: w.contact_id, opportunity_id: o?.id, start_at: start.toISOString(), end_at: end.toISOString(), email: clean(input.email) || undefined,
        assigned_to: owner, move_to_r1: true, notes: 'Agendada pelo agente de IA no WhatsApp.',
      }, null);
      const ownerName = db.prepare('SELECT name FROM users WHERE id = ?').get(owner)?.name;
      log(db, w, 'agendou_r1', `${pick.rotulo} com ${ownerName}`);
      notify(db, owner, { kind: 'reuniao', title: `IA Vero agendou uma R1: ${ctx.contact.name}`, body: `${pick.rotulo}. A conversa do WhatsApp passou para você.`, link: `#/comunicacao/whatsapp/${w.id}` });
      ctx.handoff = { status: 'humano', reason: `R1 agendada para ${pick.rotulo}` };
      return { agendado: true, quando: pick.rotulo, especialista: ownerName, link_reuniao: r.meeting_url || null, convite_por_email: !!r.confirmation?.sent };
    }
    if (name === 'transferir_especialista') {
      ctx.handoff = { status: 'humano', reason: clean(input.motivo) || 'Transferida pela IA' };
      log(db, w, 'transferiu', ctx.handoff.reason);
      return { transferido: true };
    }
    if (name === 'encerrar_sem_fit') {
      const motivo = clean(input.motivo) || 'Sem fit no momento';
      ctx.handoff = { status: 'humano', reason: `Sem fit: ${motivo}` };
      log(db, w, 'sem_fit', motivo);
      require('./activities').insertActivity(db, { contact_id: w.contact_id, opportunity_id: o?.id, type: 'observacao', notes: `Agente de IA (WhatsApp): sem fit no momento. ${motivo}`, user_id: null });
      return { registrado: true };
    }
    return { erro: `Ferramenta desconhecida: ${name}` };
  } catch (e) {
    return { erro: e.message };
  }
}

/** Especialista do lead; sem ele, tenta a distribuição automática. */
function ensureOwner(db, w) {
  let owner = db.prepare('SELECT owner_id FROM contacts WHERE id = ?').get(w.contact_id)?.owner_id ?? null;
  if (!owner) owner = require('./distribution').autoDistribute(db, w.contact_id) || null;
  if (!owner && config(db).default_owner_id) {
    owner = config(db).default_owner_id;
    db.prepare('UPDATE contacts SET owner_id = ? WHERE id = ? AND owner_id IS NULL').run(owner, w.contact_id);
    db.prepare("UPDATE opportunities SET owner_id = ? WHERE contact_id = ? AND owner_id IS NULL AND status = 'aberta'").run(owner, w.contact_id);
  }
  if (owner) db.prepare('UPDATE wa_conversations SET assigned_to = COALESCE(assigned_to, ?) WHERE id = ?').run(owner, w.id);
  return owner;
}

/* ------------------------- Conversa com o Claude ------------------------- */

function systemPrompt(db, cfg, opts = {}) {
  const company = getSetting(db, 'company_name') || 'Vero Consórcios';
  const kb = db.prepare("SELECT kind, title, content FROM ai_knowledge WHERE active = 1 AND kind IN ('pergunta','objecao','mensagem') ORDER BY likes - dislikes DESC, id LIMIT 30").all();
  return `Você é ${cfg.name}, assistente virtual da ${company} no WhatsApp. A ${company} trabalha com consórcio (imóvel, veículo e serviços) e planejamento financeiro.

Seu objetivo é QUALIFICAR o lead sozinha, do começo ao fim, e, havendo fit, AGENDAR a reunião de apresentação (R1) com o especialista. Você conduz a conversa: não espere o cliente puxar assunto.

Como conversar:
- Português do Brasil, tom humano, simpático e profissional; mensagens curtas (até 3 linhas), sem jargão.
- Toda mensagem sua termina com UMA pergunta que leva ao próximo passo do roteiro. Nunca responda só agradecendo, só confirmando o recebimento ou dizendo que alguém vai retornar (isso só ao transferir ou encerrar).
- Se o cliente fizer uma pergunta, responda em uma ou duas frases (use a base de conhecimento) e, na mesma mensagem, volte ao roteiro com a próxima pergunta.
- Se ele responder mais de uma coisa de uma vez, registre tudo e pule as perguntas já respondidas.
- Na primeira resposta, apresente-se como assistente virtual da ${company} e já faça a primeira pergunta. Se perguntarem, diga com honestidade que é uma assistente virtual (IA).
- Texto simples de WhatsApp: sem títulos, tabelas ou markdown (no máximo *negrito* pontual).

Roteiro de qualificação (siga na ordem; "proximo_passo" e "faltam_na_triagem" nos dados do lead mostram onde a conversa está):
Etapa 1. Abertura: apresente-se e pergunte o que o cliente quer conquistar (imóvel, veículo, serviço, reforma, organizar as finanças).
Etapa 2. Triagem, uma pergunta por mensagem, aproveitando o que o cliente já contou:
  1) interesse em seguir; 2) necessidade ou dor (guarde um resumo nas palavras dele); 3) em quanto tempo quer resolver; 4) se é quem decide (ou com quem decide); 5) quanto consegue investir por mês; 6) faixa de renda mensal.
  Registre cada resposta com salvar_triagem assim que o cliente responder (pode mandar só os campos respondidos). Para faixas, ofereça as opções de forma simples (ex.: "até R$ 500, de R$ 500 a R$ 1.000, de R$ 1.000 a R$ 2.000...").
Etapa 3. Complemento (opcional, uma ou duas perguntas leves): valor do bem ou crédito, se tem FGTS, recurso para lance. Registre com salvar_qualificacao.
Etapa 4. Decisão, com a triagem completa:
  - Com fit e interesse: diga que o próximo passo é uma conversa online de cerca de ${cfg.r1_minutes} minutos com o especialista, chame horarios_r1, ofereça 2 ou 3 opções e, com a escolha, agende com agendar_r1 (pergunte o e-mail para o convite). Confirme dia, horário e o nome do especialista.
  - Sem fit: agradeça, deixe a porta aberta e chame encerrar_sem_fit.

Critério de fit: ${cfg.fit || DEFAULT_FIT}

Passe para um especialista com transferir_especialista quando: o cliente pedir uma pessoa; reclamar; já for cliente (pós-venda, boleto, assembleia, contemplação); perguntar valores de parcela, taxas, administradoras, propostas ou contratos; mandar áudio, foto ou documento que você não consegue avaliar; ou quando você não souber responder. Avise que um especialista vai continuar a conversa.

Nunca: prometa data ou garantia de contemplação; garanta aprovação, rentabilidade ou taxa; informe valores de parcela ou de proposta; peça CPF, documentos, senhas ou dados de cartão; invente informações; diga que é humano. Se o cliente pedir para parar de receber mensagens, respeite, agradeça e transfira com o motivo "pediu para não receber mensagens".
${cfg.instructions ? `\nOrientações da ${company}:\n${cfg.instructions}\n` : ''}${opts.n8n ? `\nBase de conhecimento: para dúvidas sobre consórcio, planejamento ou objeções, consulte a ferramenta base_de_conhecimento antes de responder. Ela traz materiais e trechos de conversas da equipe: use o conteúdo para explicar, mas nunca cite nomes, valores, números ou dados de outros clientes. Se não encontrar a resposta, diga que o especialista explica na reunião e siga o roteiro (transfira só se o cliente insistir).\n` : ''}${kb.length ? `\nBase de conhecimento (use para responder dúvidas e objeções; fora disso, transfira):\n${kb.map((k) => `- [${k.kind}] ${k.title}: ${k.content}`).join('\n')}\n` : ''}
Sua resposta final (texto) é enviada ao cliente no WhatsApp exatamente como escrita.`;
}

const KIND_TEXT = { image: '[o cliente enviou uma foto]', audio: '[o cliente enviou um áudio]', video: '[o cliente enviou um vídeo]', document: '[o cliente enviou um documento]', sticker: '[figurinha]' };

/** Histórico do WhatsApp no formato do Claude (cliente = user; IA e especialistas = assistant). */
function history(db, w) {
  const rows = db.prepare('SELECT m.direction, m.kind, m.body, m.ai, u.name AS user_name FROM wa_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ? ORDER BY m.id DESC LIMIT 40').all(w.id).reverse();
  const msgs = [];
  for (const m of rows) {
    if (isCourtesy(m)) continue;
    const role = m.direction === 'in' ? 'user' : 'assistant';
    let text = m.direction === 'in' ? (KIND_TEXT[m.kind] ? `${KIND_TEXT[m.kind]}${m.body && !/^(Foto|Áudio|Vídeo|Documento|Figurinha)$/.test(m.body) ? ` ${m.body}` : ''}` : m.body) : m.body;
    if (m.direction === 'out' && !m.ai) text = `[mensagem enviada por ${m.user_name || 'um especialista'}] ${text || ''}`;
    if (!text) continue;
    const prev = msgs[msgs.length - 1];
    if (prev && prev.role === role) prev.content += `\n${text}`;
    else msgs.push({ role, content: String(text) });
  }
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return msgs;
}

async function runTurn(db, cfg, w0) {
  const started = Date.now();
  let w = tx(db, () => ensureLead(db, w0));
  if (!w.ai_status) setStatus(db, w.id, 'ativa', 'Atendimento iniciado pela IA');
  // Oposição a contato por WhatsApp: não responde
  const c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(w.contact_id);
  const block = require('./activities').contactBlockReason(c, 'whatsapp');
  if (block) {
    setStatus(db, w.id, 'humano', block);
    return { skipped: 'bloqueado' };
  }
  const ctx = leadContext(db, w);
  const messages = history(db, w);
  if (!messages.length || messages[messages.length - 1].role !== 'user') return { skipped: 'sem_mensagem' };
  let usage = { in: 0, out: 0 };
  let reply = '';
  try {
    const r = await llm.run(db, {
      provider: cfg.provider, model: modelOf(cfg), system: systemPrompt(db, cfg),
      context: `Dados do lead no CRM (atualizados agora):\n${JSON.stringify(ctx.data)}`,
      messages, tools: tools(db), deadline: started + MAX_TURN_MS,
      onTool: async (name, input) => {
        const out = await runTool(db, cfg, w, ctx, name, input || {});
        // Dados do lead mudaram (triagem, etapa): os próximos passos usam o contexto atualizado
        Object.assign(ctx, leadContext(db, db.prepare('SELECT * FROM wa_conversations WHERE id = ?').get(w.id)), { handoff: ctx.handoff });
        return out;
      },
    });
    usage = r.usage;
    if (r.stop === 'recusa') ctx.handoff = { status: 'humano', reason: 'A IA não pôde responder (recusa do modelo)' };
    reply = r.text;
  } catch (e) {
    log(db, w, 'erro', `${llm.PROVIDERS[llm.providerOf(cfg.provider)]}: ${e.message}`, usage);
    ctx.handoff = { status: 'humano', reason: e.kind === 'rate_limit' ? 'Limite de uso da IA atingido (tente mais tarde ou troque o provedor)' : e.kind === 'auth' ? 'Chave da IA inválida' : 'A IA ficou indisponível' };
    reply = FALLBACK;
  }
  w = db.prepare('SELECT * FROM wa_conversations WHERE id = ?').get(w.id);
  if (w.ai_status === 'pausada') return { skipped: 'assumida' };
  let sentId = null;
  if (reply) {
    try {
      sentId = await sendAsAgent(db, w, reply.slice(0, 4000));
    } catch (e) {
      log(db, w, 'erro', `Envio: ${e.message}`);
      ctx.handoff = ctx.handoff || { status: 'humano', reason: 'Falha ao enviar a resposta da IA' };
    }
  }
  db.prepare('UPDATE wa_conversations SET ai_turns = ai_turns + 1 WHERE id = ?').run(w.id);
  log(db, w, 'respondeu', reply ? reply.slice(0, 200) : null, usage);
  if (ctx.handoff) applyHandoff(db, w, ctx);
  return { reply, message_id: sentId, handoff: ctx.handoff || null, usage };
}

/** A IA passa a conversa para o especialista (transferência, sem fit, R1 agendada ou falha) e avisa o responsável. */
function applyHandoff(db, w, ctx) {
  setStatus(db, w.id, ctx.handoff.status, ctx.handoff.reason);
  const target = db.prepare('SELECT owner_id FROM contacts WHERE id = ?').get(w.contact_id)?.owner_id;
  const name = ctx.contact?.name || 'lead';
  if (!/^R1 agendada/.test(ctx.handoff.reason)) {
    notify(db, target || managersOf(db, null), { kind: 'whatsapp', level: 'warn', title: `IA Vero passou a conversa para você: ${name}`, body: ctx.handoff.reason, link: `#/comunicacao/whatsapp/${w.id}` });
  }
}

async function sendAsAgent(db, w, text) {
  const wa = require('./whatsapp');
  const m = await wa.sendMessage(db, { ...AGENT_USER, agent: true }, w.id, { body: text });
  db.prepare('UPDATE wa_messages SET ai = 1 WHERE id = ?').run(m.id);
  return m.id;
}

module.exports = {
  config, ready, view, save, control, onInbound, humanReplied, handlesConversation, handlesInstance, answers, allowsPeer, freeSlots, fmtSlot, systemPrompt,
  // Usados pelo fluxo do n8n (server/services/n8n.js)
  gate, lock, debounceMs, ensureLead, setStatus, leadContext, tools, runTool, applyHandoff, sendAsAgent, log, testNumbersOf: testNumbers,
  pendingInbound, isCourtesy, FALLBACK,
  STATUS_LABEL, AGENT_USER, DEFAULT_FIT,
};
