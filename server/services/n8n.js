'use strict';
/**
 * Agente de IA no n8n (fluxo que roda 24 horas na VPS, ao lado do conector do WhatsApp).
 *
 * O conector avisa o n8n de cada mensagem (webhook global, na rede interna da VPS). O n8n repassa a mensagem ao CRM
 * (POST /api/integracoes/n8n/mensagem), que registra a conversa e decide se a IA atende, com as mesmas regras do agente
 * do CRM: agente ligado, número central, modo de teste, conversa com o especialista (Assumir/Devolver) e conversa que a
 * equipe já atendia. Quando atende, o CRM devolve o roteiro da IA (instruções, dados do lead, histórico e a mensagem
 * nova) e uma trava da conversa ("turno"). O n8n roda o modelo de IA com a base de conhecimento, chama as ações do CRM
 * (triagem, qualificação, horários e agendamento da R1, transferência) e manda a resposta para o CRM enviar pelo
 * WhatsApp (POST /api/integracoes/n8n/responder). Assim a mensagem da IA fica registrada como da IA, e uma pessoa que
 * responde pelo CRM ou pelo celular continua parando a IA.
 *
 * O acesso é por um token próprio (Integrações › Agente de IA › n8n), guardado só como hash.
 */
const { getSetting, setSetting, tx } = require('../db');
const { audit } = require('../core');
const { HttpError, badRequest, forbidden, randomToken, sha256, safeEqual, nowIso, clean: cleanRaw } = require('../util');

const clean = (v) => cleanRaw(v) ?? null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Trava da conversa enquanto o n8n pensa e responde (o modelo, as ações e o envio)
const TURN_MS = 180000;
// Quanto a mensagem nova espera a resposta anterior terminar (a função da Vercel tem 60 s)
const waitLockMs = () => Math.max(0, Number(process.env.N8N_WAIT_LOCK_MS ?? 35000));
const agent = () => require('./waagent');

/* ------------------------- Token ------------------------- */

function authenticate(db, req) {
  const cfg = agent().config(db);
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : String(req.headers['x-crm-token'] || '');
  if (!cfg.n8n_token_hash || !token || !safeEqual(sha256(token), cfg.n8n_token_hash)) {
    throw new HttpError(401, 'Token do n8n inválido. Gere o token em Integrações › Agente de IA no WhatsApp › n8n e use no cabeçalho Authorization: Bearer <token>.');
  }
  setSetting(db, 'n8n_last_call', { at: nowIso(), path: String(req.url || '').split('?')[0].slice(0, 80) });
  return cfg;
}

function rotateToken(db, user) {
  if (user.role !== 'admin') throw forbidden('Só o administrador gera o token do n8n.');
  const token = `crm_n8n_${randomToken(24)}`;
  const c = agent().config(db);
  setSetting(db, 'wa_agent', { ...c, n8n_token_hash: sha256(token), n8n_token_hint: `…${token.slice(-4)}` });
  audit(db, user, 'integration', null, 'token_gerado', { integracao: 'n8n' });
  return { token, hint: `…${token.slice(-4)}` };
}

/** Situação da ligação com o n8n, para a tela do agente (nunca devolve o token). */
function info(db, req) {
  const c = agent().config(db);
  const base = require('./meetings').publicUrl(db, req);
  const last = getSetting(db, 'n8n_last_call');
  return {
    has_token: !!c.n8n_token_hash, hint: c.n8n_token_hint || null, transcripts: !!c.n8n_transcripts,
    crm_url: base, last_call_at: last?.at || null, last_call_path: last?.path || null,
  };
}

/* ------------------------- Mensagem recebida (vinda do n8n) ------------------------- */

const conv = (db, id) => db.prepare('SELECT * FROM wa_conversations WHERE id = ?').get(id);

/**
 * O n8n repassa o aviso do conector (o mesmo corpo do webhook da Evolution). O CRM registra a mensagem (sem duplicar
 * a que já chegou pelo aviso do próprio CRM ou pela busca no conector) e responde se a IA deve atender.
 */
async function message(db, req, body = {}) {
  authenticate(db, req);
  const ev = String(body.event || '').toLowerCase().replace(/_/g, '.');
  if (ev !== 'messages.upsert') return { atender: false, motivo: 'evento_ignorado' };
  const inst = db.prepare('SELECT * FROM wa_instances WHERE instance_key = ?').get(String(body.instance || ''));
  if (!inst) return { atender: false, motivo: 'numero_desconhecido' };
  db.prepare('UPDATE wa_instances SET last_event_at = ? WHERE id = ?').run(nowIso(), inst.id);
  const items = Array.isArray(body.data) ? body.data : Array.isArray(body.data?.messages) ? body.data.messages : [body.data || {}];
  const walite = require('./walite');
  let job = null;
  let registered = 0;
  for (const d of items) {
    let r = walite.ingest(db, inst, d);
    if (r) registered++;
    else {
      const wamid = clean(d?.key?.id);
      const m = wamid && db.prepare('SELECT id, conversation_id, direction FROM wa_messages WHERE wamid = ?').get(wamid);
      r = m ? { conv: m.conversation_id, msg: m.id, fromMe: m.direction === 'out' } : null;
    }
    if (r && !r.fromMe) job = r;
  }
  // Sem mensagem do lead: enviada pela equipe (celular ou CRM) ou que não entra no CRM (grupo, número fora do modo de teste)
  if (!job) return { atender: false, motivo: registered ? 'mensagem_da_equipe' : 'mensagem_ignorada', registradas: registered };
  return startTurn(db, req, job.conv, job.msg, registered);
}

async function startTurn(db, req, convId, msgId, registered) {
  const ag = agent();
  const no = (motivo) => ({ atender: false, motivo, conversa_id: convId, registradas: registered });
  let w = conv(db, convId);
  const gate = ag.gate(db, w);
  if (gate) return no(gate);
  if (ag.config(db).provider !== 'n8n') return no('agente_do_crm');
  // Junta mensagens seguidas: só quem recebeu a última responde
  const wait = ag.debounceMs();
  if (wait) await sleep(wait);
  if (db.prepare("SELECT 1 FROM wa_messages WHERE conversation_id = ? AND direction = 'in' AND id > ?").get(convId, msgId)) return no('nova_mensagem');
  // Trava da conversa: uma resposta por vez (a anterior termina e esta segue)
  const t0 = Date.now();
  while (!ag.lock(db, convId, TURN_MS)) {
    if (Date.now() - t0 > waitLockMs()) return no('ocupada');
    await sleep(1000);
  }
  let keep = false;
  try {
    w = conv(db, convId);
    if (w.ai_status === 'humano' || w.ai_status === 'pausada') return no('com_especialista');
    const last = db.prepare("SELECT MAX(id) AS id FROM wa_messages WHERE conversation_id = ? AND direction = 'in'").get(convId).id;
    if (!last || (w.ai_seen_id && w.ai_seen_id >= last)) return no('ja_respondida');
    db.prepare('UPDATE wa_conversations SET ai_seen_id = ? WHERE id = ?').run(last, convId);
    w = tx(db, () => ag.ensureLead(db, w));
    if (!w.ai_status) ag.setStatus(db, w.id, 'ativa', 'Atendimento iniciado pela IA (n8n)');
    const c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(w.contact_id);
    const block = require('./activities').contactBlockReason(c, 'whatsapp');
    if (block) {
      ag.setStatus(db, w.id, 'humano', block);
      return no('bloqueado');
    }
    const cfg = ag.config(db);
    const ctx = ag.leadContext(db, w);
    const { historico, mensagem } = transcript(db, w);
    if (!mensagem) return no('sem_mensagem');
    const turno = conv(db, w.id).ai_lock_at;
    const base = require('./meetings').publicUrl(db, req);
    keep = true;
    return {
      atender: true, conversa_id: w.id, turno, registradas: registered,
      assistente: cfg.name,
      // Modelo do Gemini escolhido no CRM (o nó Gemini do fluxo usa este valor)
      modelo_gemini: `models/${cfg.gemini_model || require('./llm').GEMINI_DEFAULT}`,
      sistema: `${ag.systemPrompt(db, cfg, { n8n: true })}\n\nDados do lead no CRM (atualizados agora):\n${JSON.stringify(ctx.data)}${historico ? `\n\nConversa até aqui (a mais antiga primeiro):\n${historico}` : ''}`,
      mensagem, lead: { nome: c.name, codigo: c.code, telefone: w.peer || w.wa_id || null },
      urls: { acao: `${base}/api/integracoes/n8n/acao`, responder: `${base}/api/integracoes/n8n/responder` },
    };
  } finally {
    if (!keep) db.prepare('UPDATE wa_conversations SET ai_lock_at = NULL WHERE id = ?').run(convId);
  }
}

const KIND_TEXT = { image: '[o cliente enviou uma foto]', audio: '[o cliente enviou um áudio]', video: '[o cliente enviou um vídeo]', document: '[o cliente enviou um documento]', sticker: '[figurinha]' };

/** Histórico em texto e as mensagens novas do cliente (as que chegaram depois da última resposta). */
function transcript(db, w) {
  const rows = db.prepare('SELECT m.id, m.direction, m.kind, m.body, m.ai, u.name AS user_name FROM wa_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ? ORDER BY m.id DESC LIMIT 40').all(w.id).reverse();
  const name = agent().config(db).name;
  const textOf = (m) => {
    if (m.direction === 'out') return m.body || '';
    const k = KIND_TEXT[m.kind];
    return k ? `${k}${m.body && !/^(Foto|Áudio|Vídeo|Documento|Figurinha)$/.test(m.body) ? ` ${m.body}` : ''}` : m.body || '';
  };
  let cut = rows.length;
  while (cut > 0 && rows[cut - 1].direction === 'in') cut--;
  const before = rows.slice(0, cut).map((m) => {
    const who = m.direction === 'in' ? 'Cliente' : m.ai ? name : `${m.user_name || 'Especialista'} (especialista)`;
    return `${who}: ${textOf(m)}`;
  }).filter((l) => !/: $/.test(l));
  const pending = rows.slice(cut).map(textOf).filter(Boolean);
  return { historico: before.join('\n'), mensagem: pending.join('\n') };
}

/* ------------------------- Ações e resposta (dentro do turno) ------------------------- */

/** Conversa do turno em andamento (a trava ainda é deste turno). */
function turnConv(db, body) {
  const id = Number(body.conversa_id);
  const w = id && conv(db, id);
  if (!w) throw badRequest('Conversa não encontrada (conversa_id).');
  if (!body.turno || w.ai_lock_at !== String(body.turno)) throw new HttpError(409, 'Este atendimento já terminou ou foi substituído (turno expirado). Não responda ao cliente.');
  return w;
}

function parseInput(body) {
  let d = body.dados;
  if (typeof d === 'string') {
    try {
      d = d.trim() ? JSON.parse(d) : {};
    } catch {
      throw badRequest('O campo "dados" precisa ser um objeto JSON.');
    }
  }
  if (!d || typeof d !== 'object' || Array.isArray(d)) d = {};
  // Também aceita os campos soltos no corpo (ex.: {"motivo": "..."})
  for (const [k, v] of Object.entries(body)) if (!['conversa_id', 'turno', 'dados', 'acao'].includes(k) && d[k] === undefined) d[k] = v;
  // O modelo manda os campos que o cliente não respondeu vazios (ou zero): ficam de fora
  for (const [k, v] of Object.entries(d)) if (v == null || v === '' || v === 0 || v === '0' || (typeof v === 'string' && /^(null|undefined|n\/a)$/i.test(v.trim()))) delete d[k];
  return d;
}

async function action(db, req, name, body = {}) {
  authenticate(db, req);
  const ag = agent();
  const tool = String(name || body.acao || '');
  if (!ag.tools(db).some((t) => t.name === tool)) throw badRequest(`Ação desconhecida: ${tool || '(vazia)'}.`);
  const w = turnConv(db, body);
  if (w.ai_status === 'pausada') return { erro: 'O especialista assumiu a conversa. Encerre sem responder.' };
  const cfg = ag.config(db);
  const ctx = ag.leadContext(db, w);
  const out = await ag.runTool(db, cfg, w, ctx, tool, parseInput(body));
  if (ctx.handoff) ag.applyHandoff(db, w, ctx);
  return out;
}

const FALLBACK = 'Obrigada pela mensagem! Um especialista da nossa equipe vai continuar o seu atendimento em instantes.';

async function reply(db, req, body = {}) {
  authenticate(db, req);
  const ag = agent();
  let w = turnConv(db, body);
  const turno = w.ai_lock_at;
  try {
    let text = String(body.texto ?? body.text ?? '').trim();
    if (body.erro) {
      ag.log(db, w, 'erro', `n8n: ${String(body.erro).slice(0, 300)}`);
      ag.applyHandoff(db, w, { contact: db.prepare('SELECT name FROM contacts WHERE id = ?').get(w.contact_id), handoff: { status: 'humano', reason: 'A IA ficou indisponível (fluxo do n8n)' } });
      if (!text) text = FALLBACK;
    }
    w = conv(db, w.id);
    if (w.ai_status === 'pausada') return { enviado: false, motivo: 'assumida' };
    let sentId = null;
    if (text) {
      try {
        sentId = await ag.sendAsAgent(db, w, text.slice(0, 4000));
      } catch (e) {
        ag.log(db, w, 'erro', `Envio: ${e.message}`);
        ag.applyHandoff(db, w, { contact: db.prepare('SELECT name FROM contacts WHERE id = ?').get(w.contact_id), handoff: { status: 'humano', reason: 'Falha ao enviar a resposta da IA' } });
        return { enviado: false, motivo: 'falha_no_envio', erro: e.message };
      }
    }
    const usage = { in: Number(body.tokens_entrada) || 0, out: Number(body.tokens_saida) || 0 };
    db.prepare('UPDATE wa_conversations SET ai_turns = ai_turns + 1 WHERE id = ?').run(w.id);
    ag.log(db, w, 'respondeu', text ? `[n8n] ${text.slice(0, 190)}` : '[n8n] sem resposta', usage);
    return { enviado: !!sentId, mensagem_id: sentId };
  } finally {
    db.prepare('UPDATE wa_conversations SET ai_lock_at = NULL WHERE id = ? AND ai_lock_at = ?').run(w.id, turno);
  }
}

/* ------------------------- Conferência e base de conhecimento ------------------------- */

/** Conferência da ligação (usada pelo instalador da VPS e pelo n8n). */
function status(db, req) {
  const cfg = authenticate(db, req);
  const ag = agent();
  const r = ag.ready(db);
  const inst = cfg.instance_id ? db.prepare('SELECT name, phone, status FROM wa_instances WHERE id = ?').get(cfg.instance_id) : null;
  return {
    ok: true, crm: getSetting(db, 'company_name') || 'Vero Consórcios', hora: nowIso(),
    agente: {
      ligado: !!cfg.enabled, provedor: cfg.provider, pronto: r.ok, motivo: r.ok ? null : r.reason,
      numero_central: inst ? { nome: inst.name, telefone: inst.phone, conectado: inst.status === 'conectado' } : null,
      modo_de_teste: ag.testNumbersOf(cfg).length > 0,
    },
  };
}

/** Tira dados pessoais do texto (e-mail, telefone, CPF/CNPJ e o nome do cliente). */
function mask(text, names = []) {
  let t = String(text || '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[e-mail]')
    .replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[documento]')
    .replace(/(\+?\d[\d\s().-]{7,}\d)/g, '[número]');
  for (const n of names) {
    for (const part of String(n || '').split(/\s+/).filter((p) => p.length >= 3)) {
      t = t.replace(new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '[cliente]');
    }
  }
  return t;
}

/**
 * Documentos para a base de conhecimento do n8n: a base da IA do CRM (perguntas, objeções, dicas e mensagens), as
 * orientações do agente e, se o administrador ligar, as transcrições das R1 sem os dados pessoais do cliente.
 */
function knowledge(db, req) {
  const cfg = authenticate(db, req);
  const company = getSetting(db, 'company_name') || 'Vero Consórcios';
  const docs = [];
  const KIND = { pergunta: 'Pergunta frequente', objecao: 'Objeção', dica: 'Dica de atendimento', mensagem: 'Mensagem modelo' };
  for (const k of db.prepare('SELECT id, kind, title, content, area, updated_at FROM ai_knowledge WHERE active = 1 ORDER BY id').all()) {
    docs.push({ id: `crm-kb-${k.id}`, fonte: 'crm', tipo: k.kind, titulo: k.title, texto: `${KIND[k.kind] || k.kind}: ${k.title}\n${k.content}`, area: k.area || null, atualizado_em: k.updated_at });
  }
  docs.push({ id: 'crm-fit', fonte: 'crm', tipo: 'regra', titulo: 'Critério de fit', texto: `Critério de fit da ${company} para convidar o lead para a R1: ${cfg.fit}` });
  if (cfg.instructions) docs.push({ id: 'crm-orientacoes', fonte: 'crm', tipo: 'regra', titulo: 'Orientações da empresa', texto: `Orientações da ${company} para o atendimento: ${cfg.instructions}` });
  let transcripts = 0;
  if (cfg.n8n_transcripts) {
    const rows = db.prepare(`SELECT t.id, t.content, t.created_at, c.name AS contact_name, u.name AS user_name FROM r1_transcripts t
      JOIN opportunities o ON o.id = t.opportunity_id JOIN contacts c ON c.id = o.contact_id LEFT JOIN users u ON u.id = t.created_by ORDER BY t.id DESC LIMIT 200`).all();
    for (const t of rows) {
      docs.push({ id: `crm-r1-${t.id}`, fonte: 'crm', tipo: 'transcricao_r1', titulo: `Transcrição de R1 (${String(t.created_at).slice(0, 10)})`, texto: mask(String(t.content).slice(0, 30000), [t.contact_name]), atualizado_em: t.created_at });
      transcripts++;
    }
  }
  return { empresa: company, total: docs.length, transcricoes: transcripts, documentos: docs };
}

module.exports = { authenticate, rotateToken, info, message, action, reply, status, knowledge, mask, transcript, TURN_MS };
