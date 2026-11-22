'use strict';
/**
 * Banco Postgres (Supabase) com a mesma interface que o CRM usa do node:sqlite:
 *   db.prepare(sql).get(...)/all(...)/run(...) e db.exec(sql).
 * O SQL do CRM é traduzido na hora (server/pg/translate.js) e roda no Postgres por uma ponte síncrona (worker +
 * Atomics.wait). Valores voltam como no SQLite: números como number, verdadeiro/falso como 1/0, bytea como Buffer.
 */
const path = require('node:path');
const { Worker, MessageChannel, receiveMessageOnPort } = require('node:worker_threads');
const { translate } = require('./translate');

const PARSE = {
  16: (v) => (v === 't' ? 1 : 0),
  20: Number,
  21: Number,
  23: Number,
  26: Number,
  700: Number,
  701: Number,
  1700: Number,
  17: (v) => Buffer.from(v.slice(2), 'hex'),
};

function toParam(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'string') return v;
  if (v instanceof Uint8Array) return `\\x${Buffer.from(v).toString('hex')}`;
  throw new TypeError('Valor de parâmetro não suportado pelo banco.');
}

/** Erro do Postgres com a mesma mensagem que o CRM espera do SQLite (ex.: "UNIQUE constraint failed"). */
function toError(e) {
  const prefix = { 23505: 'UNIQUE constraint failed', 23503: 'FOREIGN KEY constraint failed', 23502: 'NOT NULL constraint failed', 23514: 'CHECK constraint failed' }[e.code];
  const err = new Error(prefix ? `${prefix}: ${e.constraint || e.table || ''} (${e.message})` : e.message);
  err.code = e.code;
  err.detail = e.detail;
  return err;
}

function openPg(url, { schema = process.env.CRM_PG_SCHEMA || 'crm', timeoutMs = Number(process.env.CRM_PG_TIMEOUT_MS) || 60000 } = {}) {
  if (!/^[a-z_][a-z0-9_]{0,40}$/.test(schema)) throw new Error('CRM_PG_SCHEMA inválido.');
  const sab = new SharedArrayBuffer(4);
  const flag = new Int32Array(sab);
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(path.join(__dirname, 'worker.js'), { workerData: { port: port2, flag: sab, url, schema }, transferList: [port2] });
  worker.unref();
  port1.unref();
  let inTx = false;
  let closed = false;

  function call(m) {
    if (closed) throw new Error('Banco de dados fechado.');
    Atomics.store(flag, 0, 0);
    port1.postMessage({ ...m, inTx });
    const w = Atomics.wait(flag, 0, 0, timeoutMs);
    if (w === 'timed-out') throw new Error('O banco de dados não respondeu a tempo.');
    const r = receiveMessageOnPort(port1);
    if (!r) throw new Error('Sem resposta do banco de dados.');
    if (r.message.error) throw toError(r.message.error);
    const res = r.message.result;
    if (res) inTx = res.txStatus !== 'I';
    return res;
  }

  const rowsOf = (res) => {
    const f = res.fields;
    return res.rows.map((row) => {
      const o = Object.create(null);
      for (let i = 0; i < f.length; i++) {
        const v = row[i];
        const p = PARSE[f[i].typeOid];
        o[f[i].name] = v === null ? null : p ? p(v) : v;
      }
      return o;
    });
  };

  // Tabelas com coluna "id": o INSERT devolve o id (lastInsertRowid do SQLite)
  let idTables = null;
  const loadIdTables = () => {
    const res = call({ op: 'query', sql: "SELECT table_name FROM information_schema.columns WHERE table_schema = $1 AND column_name = 'id'", params: [schema] });
    idTables = new Set(res.rows.map((r) => r[0]));
  };

  const db = {
    isPostgres: true,
    schema,
    prepare(sql) {
      const tr = translate(sql);
      const insert = /^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+"?([\w]+)"?/i.exec(sql);
      const exec = (params, wantId) => {
        if (params.length === 1 && params[0] && typeof params[0] === 'object' && !(params[0] instanceof Uint8Array) && !Array.isArray(params[0])) {
          throw new TypeError('Parâmetros nomeados não são suportados no Postgres.');
        }
        let text = tr.sql;
        if (wantId) text = `${text.replace(/\s*;\s*$/, '')} RETURNING id`;
        try {
          return call({ op: 'query', sql: text, params: params.map(toParam) });
        } catch (e) {
          if (process.env.CRM_PG_DEBUG) console.error(`[pg] ${e.message}\n  SQLite: ${sql.replace(/\s+/g, ' ').slice(0, 400)}\n  PG: ${text.replace(/\s+/g, ' ').slice(0, 400)}`);
          throw e;
        }
      };
      return {
        get: (...p) => rowsOf(exec(p))[0],
        all: (...p) => rowsOf(exec(p)),
        run: (...p) => {
          if (insert && !idTables) loadIdTables();
          const wantId = !!insert && idTables.has(insert[1]) && !/\bRETURNING\b/i.test(tr.sql);
          const res = exec(p, wantId);
          const last = wantId && res.rows.length ? Number(res.rows[res.rows.length - 1][0]) : 0;
          return { changes: res.rowCount, lastInsertRowid: last };
        },
      };
    },
    exec(sql) {
      // PRAGMA não existe no Postgres (chaves estrangeiras e WAL já são o padrão)
      const clean = String(sql).replace(/^\s*PRAGMA[^;]*;?/gim, '').trim();
      if (!clean) return;
      call({ op: 'exec', sql: translate(clean).sql });
    },
    /** Script já em SQL do Postgres (schema), sem tradução. */
    execRaw(sql) {
      call({ op: 'exec', sql });
    },
    queryRaw(sql, params = []) {
      return rowsOf(call({ op: 'query', sql, params: params.map(toParam) }));
    },
    refreshTables: () => loadIdTables(),
    close() {
      if (closed) return;
      try {
        call({ op: 'close' });
      } finally {
        closed = true;
        worker.terminate();
      }
    },
  };
  return db;
}

module.exports = { openPg };
