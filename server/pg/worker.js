'use strict';
/**
 * Worker da ponte síncrona: mantém a conexão com o Postgres e responde um pedido por vez. A thread principal fica
 * esperando (Atomics.wait) até a resposta chegar, o que deixa o CRM usar o Postgres com a mesma interface síncrona do
 * SQLite (prepare().get/all/run e exec).
 */
const { workerData } = require('node:worker_threads');
const { PgConnection } = require('./protocol');

const { port, flag: sab, url, schema } = workerData;
const flag = new Int32Array(sab);
let conn = null;

async function ensure() {
  if (conn && !conn.closed) return conn;
  conn = new PgConnection(url);
  await conn.connect();
  await conn.simple(`SET TIME ZONE 'UTC'; SET search_path TO ${schema}, public, extensions; SET client_min_messages TO warning`);
  return conn;
}

port.on('message', async (m) => {
  let out;
  try {
    if (m.op === 'close') {
      if (conn) conn.end();
      out = { result: null };
    } else {
      let c = await ensure();
      const exec = () => (m.op === 'exec' ? c.simple(m.sql) : c.query(m.sql, m.params));
      let r;
      try {
        r = await exec();
      } catch (e) {
        // Conexão encerrada pelo servidor (inatividade, pausa da função): fora de transação, reconecta e repete
        if (c.closed && !m.inTx) {
          conn = null;
          c = await ensure();
          r = await exec();
        } else throw e;
      }
      out = { result: { fields: r.fields, rows: r.rows, rowCount: r.rowCount, command: r.command, txStatus: c.txStatus } };
    }
  } catch (e) {
    out = { error: { message: e.message, code: e.code, detail: e.detail, constraint: e.constraint, table: e.table } };
  }
  port.postMessage(out);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
});
