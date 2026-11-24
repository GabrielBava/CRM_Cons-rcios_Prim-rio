'use strict';
/**
 * IA generativa do CRM: um só ponto para falar com o Claude (Anthropic) ou com o Gemini (Google).
 *
 * - O provedor e o modelo são escolhidos na tela e podem ser trocados a qualquer momento (cada recurso guarda o seu:
 *   a IA Vero do painel do lead e o agente de IA do WhatsApp).
 * - Chaves: ANTHROPIC_API_KEY / GEMINI_API_KEY (ou GOOGLE_API_KEY) no ambiente, ou salvas cifradas pela tela.
 * - Claude pela biblioteca oficial (@anthropic-ai/sdk); Gemini pela API REST oficial (generativelanguage.googleapis.com),
 *   no mesmo formato da biblioteca oficial do Google: chave no cabeçalho x-goog-api-key, resultado das funções com
 *   papel "user" e o conteúdo do modelo devolvido sem alterações (preserva as "thought signatures").
 */
const { getSetting } = require('../db');
const { openSecret } = require('../util');

const PROVIDERS = { gemini: 'Google Gemini', claude: 'Anthropic Claude' };
const CLAUDE_MODELS = [
  ['claude-opus-5-5', 'Claude Opus 5.5 (melhor qualidade)'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (equilíbrio entre qualidade e custo)'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5 (mais barato e rápido)'],
];
const GEMINI_DEFAULT = 'gemini-3.8-flash';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1';
const DEFAULTS = { provider: 'gemini', claude: 'claude-opus-5-5', gemini: GEMINI_DEFAULT };

class LlmError extends Error {
  constructor(message, { status = 0, kind = 'other', provider } = {}) {
    super(message);
    this.status = status;
    this.kind = kind; // rate_limit | auth | other
    this.provider = provider;
  }
}

/* ------------------------- Chaves e disponibilidade ------------------------- */

function keys(db) {
  return {
    claude: process.env.ANTHROPIC_API_KEY || openSecret(getSetting(db, 'ai_api_key_enc')) || '',
    gemini: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || openSecret(getSetting(db, 'ai_gemini_key_enc')) || '',
    claude_env: !!process.env.ANTHROPIC_API_KEY,
    gemini_env: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
  };
}

let clientFactory = null;
/** Testes: cliente falso da Anthropic. */
function setClientFactory(fn) {
  clientFactory = fn;
}
let geminiFetch = null;
/** Testes: fetch falso para a API do Gemini. */
function setGeminiFetch(fn) {
  geminiFetch = fn;
}
function anthropicSdk() {
  if (clientFactory) return null;
  try {
    const mod = require('@anthropic-ai/sdk');
    return mod.default || mod;
  } catch {
    return null;
  }
}
const providerOf = (p) => (p === 'claude' ? 'claude' : 'gemini');

/** O provedor está pronto para responder? (chave e, no Claude, a biblioteca) */
function availability(db, provider) {
  const p = providerOf(provider);
  const k = keys(db);
  if (p === 'claude') {
    if (!k.claude) return { ok: false, reason: 'sem_chave' };
    if (!clientFactory && !anthropicSdk()) return { ok: false, reason: 'sem_biblioteca' };
    return { ok: true };
  }
  return k.gemini ? { ok: true } : { ok: false, reason: 'sem_chave' };
}

/** Situação dos dois provedores, para as telas (nunca devolve a chave). */
function providersStatus(db) {
  const k = keys(db);
  return {
    claude: { name: PROVIDERS.claude, has_key: !!k.claude, from_env: k.claude_env, sdk: !!(clientFactory || anthropicSdk()), models: CLAUDE_MODELS.map(([value, label]) => ({ value, label })) },
    gemini: { name: PROVIDERS.gemini, has_key: !!k.gemini, from_env: k.gemini_env, default_model: GEMINI_DEFAULT, free_tier_note: 'No plano gratuito do Gemini, o Google pode usar as conversas para melhorar os produtos dele (e pessoas podem revisá-las). Para dados de clientes, prefira o plano pago ou o Claude.' },
  };
}

/* ------------------------- Execução (com ou sem ferramentas) ------------------------- */

/**
 * Conversa com o modelo, com ferramentas opcionais (o modelo pode chamar várias antes de responder).
 * messages: [{ role: 'user' | 'assistant', content: string }] (começando por 'user').
 * tools: [{ name, description, input_schema }]; onTool(name, input) devolve um objeto (vai de volta ao modelo).
 * Retorno: { text, usage: { in, out }, stop: 'ok' | 'recusa' | 'limite_passos' }.
 */
async function run(db, opts) {
  const provider = providerOf(opts.provider);
  const k = keys(db);
  if (provider === 'claude') return runClaude({ ...opts, key: k.claude });
  return runGemini({ ...opts, key: k.gemini });
}

async function runClaude({ key, model, system, context, messages, tools = [], onTool, maxSteps = 6, deadline, effort = 'low', maxTokens = 2000 }) {
  const Anthropic = anthropicSdk();
  const client = clientFactory ? clientFactory({ key }) : new Anthropic({ apiKey: key });
  const m = model || DEFAULTS.claude;
  const sys = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }, ...(context ? [{ type: 'text', text: context }] : [])];
  const msgs = messages.map((x) => ({ role: x.role, content: x.content }));
  const usage = { in: 0, out: 0 };
  for (let i = 0; i < maxSteps; i++) {
    if (deadline && Date.now() > deadline) throw new LlmError('tempo esgotado', { provider: 'claude' });
    let res;
    try {
      res = await client.beta.messages.create({
        model: m,
        max_tokens: maxTokens,
        // Modelo reserva do lado da Anthropic (o Haiku não tem: o parâmetro não vai para ele)
        ...(/haiku/.test(m) ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }),
        output_config: { effort },
        system: sys,
        ...(tools.length ? { tools } : {}),
        messages: msgs,
      });
    } catch (e) {
      const A = Anthropic;
      const kind = A && e instanceof A.RateLimitError ? 'rate_limit' : A && e instanceof A.AuthenticationError ? 'auth' : 'other';
      throw new LlmError(e.message, { status: e.status || 0, kind, provider: 'claude' });
    }
    usage.in += (res.usage?.input_tokens || 0) + (res.usage?.cache_read_input_tokens || 0) + (res.usage?.cache_creation_input_tokens || 0);
    usage.out += res.usage?.output_tokens || 0;
    if (res.stop_reason === 'refusal') return { text: '', usage, stop: 'recusa' };
    const content = res.content || [];
    const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    const uses = content.filter((b) => b.type === 'tool_use');
    if (res.stop_reason === 'tool_use' && uses.length && onTool) {
      msgs.push({ role: 'assistant', content });
      const results = [];
      for (const u of uses) {
        const out = await onTool(u.name, u.input || {});
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out), ...(out && out.erro ? { is_error: true } : {}) });
      }
      msgs.push({ role: 'user', content: results });
      continue;
    }
    return { text, usage, stop: 'ok' };
  }
  return { text: '', usage, stop: 'limite_passos' };
}

const BLOCKED = ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION'];

async function geminiRequest(key, path, { method = 'GET', body } = {}) {
  const f = geminiFetch || fetch;
  let res;
  try {
    res = await f(`${GEMINI_BASE}/${path}`, {
      method,
      headers: { 'x-goog-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(40000),
    });
  } catch (e) {
    throw new LlmError(`Gemini indisponível: ${e.message}`, { provider: 'gemini' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const st = data?.error?.status || '';
    const kind = res.status === 429 || st === 'RESOURCE_EXHAUSTED' ? 'rate_limit'
      : res.status === 401 || res.status === 403 || st === 'PERMISSION_DENIED' || st === 'UNAUTHENTICATED' || /API key/i.test(data?.error?.message || '') ? 'auth' : 'other';
    throw new LlmError(data?.error?.message || `Gemini: HTTP ${res.status}`, { status: res.status, kind, provider: 'gemini' });
  }
  return data;
}

async function runGemini({ key, model, system, context, messages, tools = [], onTool, maxSteps = 6, deadline, maxTokens = 2048 }) {
  const m = String(model || DEFAULTS.gemini).replace(/^models\//, '');
  const contents = messages.map((x) => ({ role: x.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(x.content) }] }));
  const decls = tools.map((t) => {
    const props = t.input_schema?.properties || {};
    return { name: t.name, description: t.description, ...(Object.keys(props).length ? { parametersJsonSchema: t.input_schema } : {}) };
  });
  const usage = { in: 0, out: 0 };
  for (let i = 0; i < maxSteps; i++) {
    if (deadline && Date.now() > deadline) throw new LlmError('tempo esgotado', { provider: 'gemini' });
    const data = await geminiRequest(key, `models/${encodeURIComponent(m)}:generateContent`, {
      method: 'POST',
      body: {
        systemInstruction: { parts: [{ text: system }, ...(context ? [{ text: context }] : [])] },
        contents,
        ...(decls.length ? { tools: [{ functionDeclarations: decls }] } : {}),
        generationConfig: { maxOutputTokens: maxTokens },
      },
    });
    const um = data.usageMetadata || {};
    usage.in += um.promptTokenCount || 0;
    usage.out += (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0);
    if (data.promptFeedback?.blockReason) return { text: '', usage, stop: 'recusa' };
    const cand = data.candidates?.[0];
    if (!cand) return { text: '', usage, stop: 'recusa' };
    if (BLOCKED.includes(cand.finishReason)) return { text: '', usage, stop: 'recusa' };
    const parts = cand.content?.parts || [];
    const calls = parts.filter((p) => p.functionCall);
    const text = parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('').trim();
    if (calls.length && onTool) {
      // O conteúdo do modelo volta exatamente como veio (com as assinaturas de raciocínio)
      contents.push({ ...cand.content, role: cand.content.role || 'model' });
      const responses = [];
      for (const p of calls) {
        const out = await onTool(p.functionCall.name, p.functionCall.args || {});
        responses.push({ functionResponse: { name: p.functionCall.name, response: out && typeof out === 'object' && !Array.isArray(out) ? out : { output: out }, ...(p.functionCall.id ? { id: p.functionCall.id } : {}) } });
      }
      contents.push({ role: 'user', parts: responses });
      continue;
    }
    return { text, usage, stop: 'ok' };
  }
  return { text: '', usage, stop: 'limite_passos' };
}

/** Modelos de texto disponíveis na conta do Gemini (para escolher na tela). */
async function listGeminiModels(db) {
  const key = keys(db).gemini;
  if (!key) return [];
  const out = [];
  let token = '';
  for (let page = 0; page < 5; page++) {
    const data = await geminiRequest(key, `models?pageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`);
    for (const mm of data.models || []) {
      const id = String(mm.name || '').replace(/^models\//, '');
      if (!(mm.supportedGenerationMethods || []).includes('generateContent')) continue;
      if (/image|tts|audio|live|embedding|veo|imagen|lyria|robotics|computer/i.test(id)) continue;
      out.push({ value: id, label: mm.displayName ? `${mm.displayName} (${id})` : id });
    }
    token = data.nextPageToken;
    if (!token) break;
  }
  return out;
}

module.exports = {
  PROVIDERS, CLAUDE_MODELS, GEMINI_DEFAULT, DEFAULTS, LlmError,
  keys, availability, providersStatus, run, listGeminiModels, setClientFactory, setGeminiFetch, providerOf,
};
