'use strict';
const crypto = require('node:crypto');

const nowIso = () => new Date().toISOString();

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
const badRequest = (msg, details) => new HttpError(400, msg, details);
const forbidden = (msg = 'Você não tem permissão para esta ação.') => new HttpError(403, msg);
const notFound = (msg = 'Registro não encontrado.') => new HttpError(404, msg);
const conflict = (msg, details) => new HttpError(409, msg, details);

const digits = (v) => (v == null ? '' : String(v).replace(/\D+/g, ''));

/**
 * Normaliza telefone brasileiro para a forma nacional (DDD + número), só dígitos.
 * Remove DDI 55 e zeros de prefixo de operadora. Retorna null quando não há dígitos suficientes.
 */
function normalizePhone(v) {
  let d = digits(v);
  if (!d) return null;
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  while (d.length > 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 12 && d.startsWith('0')) d = d.slice(1);
  if (d.length < 8) return null;
  return d;
}

const normalizeEmail = (v) => {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  return s || null;
};

const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

function isValidCPF(v) {
  const d = digits(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (let t = 9; t < 11; t++) {
    let s = 0;
    for (let i = 0; i < t; i++) s += Number(d[i]) * (t + 1 - i);
    const r = ((s * 10) % 11) % 10;
    if (r !== Number(d[t])) return false;
  }
  return true;
}

function isValidCNPJ(v) {
  const d = digits(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (len) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let s = 0;
    for (let i = 0; i < len; i++) s += Number(d[i]) * w[i];
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

function maskDoc(doc) {
  const d = digits(doc);
  if (!d) return null;
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  if (d.length === 14) return `**.${d.slice(2, 5)}.***/${d.slice(8, 12)}-**`;
  return '***';
}

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const uuid = () => crypto.randomUUID();

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, saltB64, hashB64] = stored.split('$');
  const expected = Buffer.from(hashB64, 'base64');
  const got = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, got);
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Segredos guardados no banco (ex.: senha do portal da administradora): AES-256-GCM com a chave CRM_SECRET_KEY
 * (o servidor cria o arquivo <banco>.key quando a variável não é informada).
 */
function secretKey() {
  if (!secretKey.k) {
    const raw = process.env.CRM_SECRET_KEY;
    secretKey.k = raw ? crypto.createHash('sha256').update(String(raw)).digest() : crypto.randomBytes(32);
  }
  return secretKey.k;
}
function sealSecret(text) {
  if (text == null || text === '') return null;
  // Versão de teste no navegador (sem AES síncrono): só codifica, nunca use com senhas reais
  if (typeof crypto.createCipheriv !== 'function') return `p0:${Buffer.from(String(text)).toString('base64')}`;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `g1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}
function openSecret(blob) {
  if (!blob) return null;
  const [v, a, b, c] = String(blob).split(':');
  if (v === 'p0') return Buffer.from(a, 'base64').toString('utf8');
  if (v !== 'g1' || typeof crypto.createDecipheriv !== 'function') return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(a, 'base64'));
    d.setAuthTag(Buffer.from(b, 'base64'));
    return Buffer.concat([d.update(Buffer.from(c, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Converte valores vazios em null e remove espaços. */
function clean(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === 'string') {
    const s = v.trim();
    return s === '' ? null : s;
  }
  return v;
}

function toNumber(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/[R$\s%]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n)) throw badRequest(`Valor numérico inválido: "${v}".`);
  return n;
}

function toIso(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw badRequest(`Data inválida: "${v}".`);
  return d.toISOString();
}

function toDateOnly(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  throw badRequest(`Data inválida: "${v}". Use AAAA-MM-DD ou DD/MM/AAAA.`);
}

const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' || v === 'sim' ? 1 : 0);

/** Lê valor em caminho "a.b.c" (aceita índices numéricos). */
function getPath(obj, path) {
  if (!path) return undefined;
  return String(path)
    .split('.')
    .reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

/* ---------------- CSV ---------------- */
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const count = (ch) => (firstLine.match(new RegExp(`\\${ch}`, 'g')) || []).length;
  const delim = [';', ',', '\t'].sort((a, b) => count(b) - count(a))[0];
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  if (!nonEmpty.length) return { headers: [], rows: [], delimiter: delim };
  const headers = nonEmpty[0].map((h) => String(h).trim());
  return { headers, rows: nonEmpty.slice(1), delimiter: delim };
}

function toCSV(columns, rows) {
  const esc = (v) => {
    if (v == null) return '';
    let s = String(v);
    // Evita injeção de fórmulas ao abrir no Excel
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label)).join(';');
  const body = rows.map((r) => columns.map((c) => esc(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(';'));
  return '﻿' + [head, ...body].join('\r\n');
}

module.exports = {
  nowIso,
  sealSecret,
  openSecret,
  HttpError,
  badRequest,
  forbidden,
  notFound,
  conflict,
  digits,
  normalizePhone,
  normalizeEmail,
  isValidEmail,
  isValidCPF,
  isValidCNPJ,
  maskDoc,
  randomToken,
  sha256,
  uuid,
  hashPassword,
  verifyPassword,
  safeEqual,
  clean,
  toNumber,
  toIso,
  toDateOnly,
  bool,
  getPath,
  parseCSV,
  toCSV,
};
