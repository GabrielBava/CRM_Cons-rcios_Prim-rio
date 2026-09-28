/*
 * Adaptadores para executar o servidor do CRM dentro do navegador (versão de teste).
 * Substituem os módulos do Node usados pelo servidor: Buffer, node:crypto e node:sqlite (via sql.js).
 * ATENÇÃO: a derivação de senha aqui é simplificada e serve apenas para a versão de teste.
 */
/* eslint-disable no-bitwise */
(function (g) {
  'use strict';

  /* ---------------- SHA-256 síncrono ---------------- */
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  function sha256(bytes) {
    const len = bytes.length;
    const total = (((len + 9) >> 6) + 1) << 6;
    const m = new Uint8Array(total);
    m.set(bytes);
    m[len] = 0x80;
    const bits = len * 8;
    const dv = new DataView(m.buffer);
    dv.setUint32(total - 4, bits >>> 0);
    dv.setUint32(total - 8, Math.floor(bits / 0x100000000));
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const W = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
        const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, h0, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & h0);
        const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        h = h0;
        h0 = f;
        f = e;
        e = (d + t1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += h0; H[7] += h;
    }
    const out = new Uint8Array(32);
    const ov = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]);
    return out;
  }

  /* ---------------- Buffer mínimo ---------------- */
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const toBin = (u8) => {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return s;
  };
  class Buffer extends Uint8Array {
    static from(v, encoding) {
      if (typeof v === 'string') {
        if (encoding === 'base64' || encoding === 'base64url') {
          let s = v.replace(/-/g, '+').replace(/_/g, '/');
          while (s.length % 4) s += '=';
          const bin = atob(s);
          const b = new Buffer(bin.length);
          for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
          return b;
        }
        if (encoding === 'hex') {
          const b = new Buffer(v.length / 2);
          for (let i = 0; i < b.length; i++) b[i] = parseInt(v.substr(i * 2, 2), 16);
          return b;
        }
        const u = enc.encode(v);
        const b = new Buffer(u.length);
        b.set(u);
        return b;
      }
      const b = new Buffer(v.length);
      b.set(v);
      return b;
    }
    static concat(list) {
      const total = list.reduce((a, x) => a + x.length, 0);
      const b = new Buffer(total);
      let o = 0;
      for (const x of list) {
        b.set(x, o);
        o += x.length;
      }
      return b;
    }
    static isBuffer(x) {
      return x instanceof Buffer;
    }
    toString(encoding = 'utf8') {
      if (encoding === 'base64') return btoa(toBin(this));
      if (encoding === 'base64url') return btoa(toBin(this)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      if (encoding === 'hex') return Array.from(this, (x) => x.toString(16).padStart(2, '0')).join('');
      return dec.decode(this);
    }
  }

  /* ---------------- node:crypto (subconjunto usado pelo servidor) ---------------- */
  const webCrypto = g.crypto;
  const cryptoShim = {
    randomBytes(n) {
      const b = new Buffer(n);
      webCrypto.getRandomValues(b);
      return b;
    },
    randomUUID() {
      if (webCrypto.randomUUID) return webCrypto.randomUUID();
      const b = cryptoShim.randomBytes(16);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = b.toString('hex');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    },
    createHash() {
      let data = new Uint8Array(0);
      const api = {
        update(v) {
          const add = typeof v === 'string' ? enc.encode(v) : v;
          const n = new Uint8Array(data.length + add.length);
          n.set(data);
          n.set(add, data.length);
          data = n;
          return api;
        },
        digest(encoding) {
          const out = Buffer.from(sha256(data));
          return encoding ? out.toString(encoding) : out;
        },
      };
      return api;
    },
    // Derivação simplificada (SHA-256 iterado), apenas para a versão de teste no navegador
    scryptSync(password, salt, keylen) {
      const s = typeof salt === 'string' ? enc.encode(salt) : salt;
      let h = sha256(Buffer.concat([Buffer.from(String(password)), s]));
      for (let i = 0; i < 2000; i++) h = sha256(Buffer.concat([h, s]));
      const out = new Buffer(keylen);
      for (let i = 0, block = h; i < keylen; i += 32) {
        out.set(block.subarray(0, Math.min(32, keylen - i)), i);
        block = sha256(Buffer.concat([block, s]));
      }
      return out;
    },
    timingSafeEqual(a, b) {
      if (a.length !== b.length) throw new Error('Tamanhos diferentes');
      let r = 0;
      for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
      return r === 0;
    },
  };

  /* ---------------- node:sqlite sobre sql.js ---------------- */
  const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
  function bindParams(params) {
    if (params.length === 1 && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0]) && !(params[0] instanceof Uint8Array)) {
      const o = {};
      for (const [k, v] of Object.entries(params[0])) o[/^[:$@]/.test(k) ? k : `:${k}`] = norm(v);
      return o;
    }
    return params.map(norm);
  }
  class SqlJsAdapter {
    constructor(sqlDb) {
      this.db = sqlDb;
    }
    exec(sql) {
      this.db.exec(sql);
    }
    prepare(sql) {
      const self = this;
      const rows = (params) => {
        const st = self.db.prepare(sql);
        try {
          st.bind(bindParams(params));
          const out = [];
          while (st.step()) out.push(st.getAsObject());
          return out;
        } finally {
          st.free();
        }
      };
      return {
        all: (...p) => rows(p),
        get: (...p) => rows(p)[0],
        run: (...p) => {
          self.db.run(sql, bindParams(p));
          const changes = self.db.getRowsModified();
          const r = self.db.exec('SELECT last_insert_rowid()');
          return { changes, lastInsertRowid: r.length ? r[0].values[0][0] : 0 };
        },
      };
    }
    /** Exporta o banco (o sql.js reabre a conexão, então as PRAGMAs são reaplicadas). */
    export() {
      const bytes = this.db.export();
      this.db.exec('PRAGMA foreign_keys = ON;');
      return bytes;
    }
  }

  g.process = g.process || { env: {} };
  g.CRMShims = {
    Buffer,
    SqlJsAdapter,
    builtins: {
      'node:crypto': cryptoShim,
      'node:sqlite': {
        DatabaseSync: class {
          constructor() {
            throw new Error('Use o adaptador sql.js na versão de navegador.');
          }
        },
      },
      'node:fs': { mkdirSync() {}, readFile() {} },
      'node:path': {
        join: (...p) => p.join('/'),
        dirname: (p) => p.split('/').slice(0, -1).join('/'),
        normalize: (p) => p,
        extname: (p) => (p.match(/\.[^./]+$/) || [''])[0],
      },
    },
  };
})(globalThis);
