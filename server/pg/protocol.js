'use strict';
/**
 * Cliente Postgres mínimo (protocolo 3.0 do Postgres), sem dependências: TLS (sslmode), autenticação SCRAM-SHA-256,
 * MD5 ou senha simples, consultas com parâmetros (protocolo estendido, valores em texto) e scripts com vários comandos
 * (protocolo simples). Usado pelo worker da ponte síncrona (server/pg/worker.js) para falar com o Supabase.
 */
const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');

/** postgres://usuario:senha@host:porta/banco?sslmode=require */
function parseUrl(url) {
  const u = new URL(url);
  const q = u.searchParams;
  return {
    host: decodeURIComponent(u.hostname),
    port: Number(u.port) || 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres',
    sslmode: q.get('sslmode') || (/^(localhost|127\.0\.0\.1|\/)/.test(u.hostname) ? 'disable' : 'require'),
  };
}

class PgError extends Error {
  constructor(fields) {
    super(fields.M || 'Erro no Postgres');
    this.code = fields.C;
    this.detail = fields.D;
    this.constraint = fields.n;
    this.table = fields.t;
    this.severity = fields.S;
  }
}

const int32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
};
const cstr = (s) => Buffer.concat([Buffer.from(String(s), 'utf8'), Buffer.from([0])]);
const msg = (type, body) => Buffer.concat([Buffer.from(type), int32(body.length + 4), body]);

function parseFields(buf) {
  const out = {};
  let i = 0;
  while (i < buf.length && buf[i] !== 0) {
    const key = String.fromCharCode(buf[i]);
    const end = buf.indexOf(0, i + 1);
    out[key] = buf.toString('utf8', i + 1, end);
    i = end + 1;
  }
  return out;
}

class PgConnection {
  constructor(url) {
    this.cfg = parseUrl(url);
    this.socket = null;
    this.buf = Buffer.alloc(0);
    this.waiters = [];
    this.closed = true;
    this.txStatus = 'I';
  }

  /** Lê a próxima mensagem do servidor: { type, body }. */
  next() {
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.pump();
    });
  }

  pump() {
    while (this.waiters.length && this.buf.length >= 5) {
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < len + 1) break;
      const type = String.fromCharCode(this.buf[0]);
      const body = this.buf.subarray(5, len + 1);
      this.buf = this.buf.subarray(len + 1);
      this.waiters.shift().resolve({ type, body });
    }
  }

  fail(err) {
    this.closed = true;
    const w = this.waiters.splice(0);
    for (const x of w) x.reject(err);
  }

  attach(socket) {
    this.socket = socket;
    socket.on('data', (d) => {
      this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
      this.pump();
    });
    socket.on('error', (e) => this.fail(e));
    socket.on('close', () => this.fail(new Error('Conexão com o Postgres encerrada.')));
  }

  async connect() {
    const { host, port, sslmode } = this.cfg;
    let socket = await new Promise((resolve, reject) => {
      const s = net.connect({ host, port });
      s.setNoDelay(true);
      s.once('connect', () => resolve(s));
      s.once('error', reject);
    });
    if (sslmode !== 'disable') {
      // SSLRequest: o servidor responde "S" (aceita TLS) ou "N"
      const answer = await new Promise((resolve, reject) => {
        socket.once('data', (d) => resolve(String.fromCharCode(d[0])));
        socket.once('error', reject);
        socket.write(Buffer.concat([int32(8), int32(80877103)]));
      });
      if (answer === 'S') {
        socket = await new Promise((resolve, reject) => {
          const t = tls.connect({ socket, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: sslmode === 'verify-full' || sslmode === 'verify-ca' });
          t.once('secureConnect', () => resolve(t));
          t.once('error', reject);
        });
      } else if (sslmode === 'require' || sslmode.startsWith('verify')) {
        socket.destroy();
        throw new Error('O servidor Postgres não aceitou TLS (sslmode=require).');
      }
    }
    this.attach(socket);
    this.closed = false;
    const params = ['user', this.cfg.user, 'database', this.cfg.database, 'client_encoding', 'UTF8', 'application_name', 'vero-crm'];
    const body = Buffer.concat([int32(196608), ...params.map(cstr), Buffer.from([0])]);
    socket.write(Buffer.concat([int32(body.length + 4), body]));
    await this.authenticate();
  }

  async authenticate() {
    let scram = null;
    for (;;) {
      const m = await this.next();
      if (m.type === 'E') throw new PgError(parseFields(m.body));
      if (m.type === 'R') {
        const code = m.body.readInt32BE(0);
        if (code === 0) continue;
        if (code === 3) this.socket.write(msg('p', cstr(this.cfg.password)));
        else if (code === 5) {
          const salt = m.body.subarray(4, 8);
          const inner = crypto.createHash('md5').update(this.cfg.password + this.cfg.user).digest('hex');
          const outer = crypto.createHash('md5').update(Buffer.concat([Buffer.from(inner), salt])).digest('hex');
          this.socket.write(msg('p', cstr(`md5${outer}`)));
        } else if (code === 10) {
          const mechs = m.body.toString('utf8', 4).split('\0').filter(Boolean);
          if (!mechs.includes('SCRAM-SHA-256')) throw new Error(`Autenticação não suportada: ${mechs.join(', ')}`);
          const nonce = crypto.randomBytes(18).toString('base64');
          scram = { nonce, first: `n=,r=${nonce}` };
          const first = Buffer.from(`n,,${scram.first}`);
          this.socket.write(msg('p', Buffer.concat([cstr('SCRAM-SHA-256'), int32(first.length), first])));
        } else if (code === 11) {
          const server = m.body.toString('utf8', 4);
          const attrs = Object.fromEntries(server.split(',').map((kv) => [kv[0], kv.slice(2)]));
          if (!attrs.r.startsWith(scram.nonce)) throw new Error('SCRAM: nonce inválido.');
          const salted = crypto.pbkdf2Sync(this.cfg.password.normalize('NFKC'), Buffer.from(attrs.s, 'base64'), Number(attrs.i), 32, 'sha256');
          const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
          const clientKey = hmac(salted, 'Client Key');
          const storedKey = crypto.createHash('sha256').update(clientKey).digest();
          const without = `c=biws,r=${attrs.r}`;
          const authMessage = `${scram.first},${server},${without}`;
          const sig = hmac(storedKey, authMessage);
          const proof = Buffer.from(clientKey.map((b, i) => b ^ sig[i]));
          scram.serverSig = hmac(hmac(salted, 'Server Key'), authMessage).toString('base64');
          this.socket.write(msg('p', Buffer.from(`${without},p=${proof.toString('base64')}`)));
        } else if (code === 12) {
          const v = m.body.toString('utf8', 4).split(',').find((x) => x.startsWith('v='));
          if (!v || v.slice(2) !== scram.serverSig) throw new Error('SCRAM: assinatura do servidor inválida.');
        } else throw new Error(`Autenticação do Postgres não suportada (código ${code}).`);
      } else if (m.type === 'Z') {
        this.txStatus = String.fromCharCode(m.body[0]);
        return;
      }
      // S (ParameterStatus), K (BackendKeyData), N (Notice): ignorados
    }
  }

  /** Uma tarefa por vez: o worker só recebe o próximo pedido depois de responder o anterior (ponte síncrona). */
  run(fn) {
    return fn();
  }

  /** Lê as respostas até o ReadyForQuery: { fields, rows, command, rowCount } do último resultado. */
  async collect() {
    let fields = null;
    let rows = [];
    let error = null;
    let command = '';
    let rowCount = 0;
    for (;;) {
      const m = await this.next();
      switch (m.type) {
        case 'T': {
          const n = m.body.readInt16BE(0);
          let i = 2;
          fields = [];
          for (let k = 0; k < n; k++) {
            const end = m.body.indexOf(0, i);
            const name = m.body.toString('utf8', i, end);
            i = end + 1;
            const typeOid = m.body.readInt32BE(i + 6);
            i += 18;
            fields.push({ name, typeOid });
          }
          rows = [];
          break;
        }
        case 'D': {
          const n = m.body.readInt16BE(0);
          let i = 2;
          const row = new Array(n);
          for (let k = 0; k < n; k++) {
            const len = m.body.readInt32BE(i);
            i += 4;
            if (len === -1) row[k] = null;
            else {
              row[k] = m.body.toString('utf8', i, i + len);
              i += len;
            }
          }
          rows.push(row);
          break;
        }
        case 'C': {
          command = m.body.toString('utf8', 0, m.body.length - 1);
          const parts = command.split(' ');
          rowCount = Number(parts[parts.length - 1]) || 0;
          break;
        }
        case 'E':
          error = new PgError(parseFields(m.body));
          break;
        case 'Z':
          this.txStatus = String.fromCharCode(m.body[0]);
          if (error) throw error;
          return { fields: fields || [], rows, command, rowCount };
        case 'I':
          fields = fields || [];
          break;
        default:
          // 1 ParseComplete, 2 BindComplete, n NoData, s PortalSuspended, N Notice, S ParameterStatus
          break;
      }
    }
  }

  /** Consulta com parâmetros ($1, $2…), valores em texto (null = NULL). */
  query(sql, params = []) {
    return this.run(async () => {
      if (this.closed) throw new Error('Conexão com o Postgres encerrada.');
      const bindParams = params.map((v) => {
        if (v === null || v === undefined) return int32(-1);
        const b = Buffer.from(String(v), 'utf8');
        return Buffer.concat([int32(b.length), b]);
      });
      const parse = msg('P', Buffer.concat([cstr(''), cstr(sql), Buffer.from([0, 0])]));
      const pcount = Buffer.alloc(2);
      pcount.writeInt16BE(params.length);
      const bind = msg('B', Buffer.concat([cstr(''), cstr(''), Buffer.from([0, 0]), pcount, ...bindParams, Buffer.from([0, 0])]));
      const describe = msg('D', Buffer.concat([Buffer.from('P'), cstr('')]));
      const execute = msg('E', Buffer.concat([cstr(''), int32(0)]));
      const sync = msg('S', Buffer.alloc(0));
      this.socket.write(Buffer.concat([parse, bind, describe, execute, sync]));
      return this.collect();
    });
  }

  /** Script com vários comandos, sem parâmetros (protocolo simples). */
  simple(sql) {
    return this.run(async () => {
      if (this.closed) throw new Error('Conexão com o Postgres encerrada.');
      this.socket.write(msg('Q', cstr(sql)));
      return this.collect();
    });
  }

  end() {
    if (this.socket && !this.closed) {
      try {
        this.socket.write(msg('X', Buffer.alloc(0)));
      } catch {
        /* já fechada */
      }
      this.socket.end();
    }
    this.closed = true;
  }
}

module.exports = { PgConnection, PgError, parseUrl };
