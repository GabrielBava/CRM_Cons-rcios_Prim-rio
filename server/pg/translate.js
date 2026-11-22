'use strict';
/**
 * Tradução do SQL escrito para o SQLite para o Postgres (Supabase), na hora da execução e com cache.
 *
 *  - ? → $1, $2… (fora de textos entre aspas); "$n IS [NOT] NULL" ganha ::text (o Postgres precisa do tipo);
 *  - INSERT OR IGNORE → INSERT … ON CONFLICT DO NOTHING;
 *  - julianday(x), date(x[, 'localtime']), strftime(fmt, x[, 'localtime']) → EXTRACT/to_char com as mesmas saídas;
 *  - GROUP_CONCAT → string_agg; instr → strpos; IFNULL → COALESCE; rowid → ctid;
 *  - MAX/MIN com 2+ argumentos → GREATEST/LEAST; SUM/AVG de condição → SUM(CASE WHEN … THEN 1 ELSE 0 END);
 *  - ROUND(x, n) → round(x::numeric, n); CAST(… AS REAL) → double precision;
 *  - x COLLATE NOCASE → lower(x); LIKE → ILIKE (no SQLite o LIKE já ignora maiúsculas).
 */

const TZ = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
})();

/** Troca textos entre aspas simples por marcadores (\u0001n\u0001) para não serem alterados. */
function protect(sql) {
  const lits = [];
  let out = '';
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) break;
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") j += 2;
          else break;
        } else j++;
      }
      lits.push(sql.slice(i, j + 1));
      out += `\u0001${lits.length - 1}\u0001`;
      i = j;
    } else if (ch === '-' && sql[i + 1] === '-') {
      // Comentário: sai do SQL (um "?" dentro dele não é parâmetro)
      const end = sql.indexOf('\n', i);
      const stop = end < 0 ? sql.length : end;
      out += ' ';
      i = stop - 1;
    } else out += ch;
  }
  return { text: out, lits };
}
const restore = (text, lits) => text.replace(/\u0001(\d+)\u0001/g, (_, n) => lits[Number(n)]);
const litValue = (arg, lits) => {
  const m = String(arg).trim().match(/^\u0001(\d+)\u0001$/);
  return m ? lits[Number(m[1])].slice(1, -1).replace(/''/g, "'") : null;
};

/** Divide os argumentos de uma chamada no nível de cima (respeitando parênteses). */
function splitArgs(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/** Reescreve chamadas fn(...) com o callback (mais internas primeiro). */
function rewriteCalls(text, name, cb) {
  const re = new RegExp(`\\b${name}\\s*\\(`, 'gi');
  let guard = 0;
  for (;;) {
    re.lastIndex = 0;
    const found = [];
    let m;
    while ((m = re.exec(text))) found.push(m);
    if (!found.length || guard++ > 200) return text;
    let changed = false;
    // Da última para a primeira: as internas vêm antes no texto reescrito
    for (let k = found.length - 1; k >= 0; k--) {
      const start = found[k].index;
      const open = start + found[k][0].length - 1;
      let depth = 0;
      let end = -1;
      for (let i = open; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end < 0) continue;
      const inner = text.slice(open + 1, end);
      const rep = cb(splitArgs(inner), inner, found[k][0]);
      if (rep != null) {
        text = text.slice(0, start) + rep + text.slice(end + 1);
        changed = true;
        break;
      }
    }
    if (!changed) return text;
  }
}

/** Formato do strftime do SQLite → to_char do Postgres. */
function pgFormat(fmt) {
  let out = '';
  let lit = '';
  const flush = () => {
    if (lit) out += `"${lit}"`;
    lit = '';
  };
  const map = { Y: 'YYYY', m: 'MM', d: 'DD', H: 'HH24', M: 'MI', S: 'SS', f: 'SS.MS', j: 'DDD', w: 'D', s: 'SSSS' };
  for (let i = 0; i < fmt.length; i++) {
    if (fmt[i] === '%' && map[fmt[i + 1]]) {
      flush();
      out += map[fmt[i + 1]];
      i++;
    } else lit += fmt[i];
  }
  flush();
  return out;
}

const tsOf = (arg, lits) => (litValue(arg, lits) === 'now' ? 'now()' : `CAST(NULLIF(${arg}, '') AS timestamptz)`);
const zoneOf = (mods, lits) => (mods.some((x) => litValue(x, lits) === 'localtime') ? TZ : 'UTC');
const BOOLISH = /(<>|!=|<=|>=|=|<|>|\bIS\b|\bIN\s*\(|\bLIKE\b|\bEXISTS\b|\bBETWEEN\b|\bNOT\b|\bAND\b|\bOR\b)/i;
/** Expressão de condição no nível de cima (fora de parênteses)? */
function topLevelBool(arg) {
  if (/^\s*CASE\b/i.test(arg)) return false;
  let depth = 0;
  let flat = '';
  for (const ch of arg) {
    if (ch === '(') {
      depth++;
      if (depth === 1) flat += '(';
      continue;
    }
    if (ch === ')') {
      depth--;
      if (depth === 0) flat += ')';
      continue;
    }
    if (depth === 0) flat += ch;
  }
  // EXISTS(...) e "IN (...)" contam mesmo com parênteses
  return BOOLISH.test(flat);
}

const cache = new Map();

function translate(sql) {
  const hit = cache.get(sql);
  if (hit) return hit;
  // Blob literal X'..' → decode('..', 'hex')
  const { text: t0, lits } = protect(sql.replace(/\b[Xx]'([0-9A-Fa-f]*)'/g, "decode('$1', 'hex')"));
  let t = t0;
  // Parâmetros
  let n = 0;
  t = t.replace(/\?/g, () => `$${++n}`);
  t = t.replace(/(\$\d+)(\s+IS\s+(?:NOT\s+)?NULL\b)/gi, '$1::text$2');
  // "x IS ?" (comparação que aceita NULL) → IS NOT DISTINCT FROM
  t = t.replace(/\bIS\s+NOT\s+(\$\d+)/gi, 'IS DISTINCT FROM $1').replace(/\bIS\s+(\$\d+)/gi, 'IS NOT DISTINCT FROM $1');
  // UPDATE OR IGNORE: no CRM só move registros entre cadastros (sem índice único envolvido)
  t = t.replace(/^\s*UPDATE\s+OR\s+IGNORE\s+/i, 'UPDATE ');
  // INSERT OR IGNORE
  if (/^\s*INSERT\s+OR\s+IGNORE\s+INTO/i.test(t)) {
    t = t.replace(/^\s*INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO').replace(/\s*;?\s*$/, ' ON CONFLICT DO NOTHING');
  }
  // ON CONFLICT … DO UPDATE SET x = x + 1: no Postgres a coluna precisa da tabela (x = tabela.x + 1)
  const up = /ON\s+CONFLICT\s*\([^)]*\)\s*DO\s+UPDATE\s+SET\s+/i.exec(t);
  const table = (/^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+"?(\w+)"?/i.exec(t) || [])[1];
  if (up && table) {
    const start = up.index + up[0].length;
    const tail = /\b(WHERE|RETURNING)\b/i.exec(t.slice(start));
    const end = tail ? start + tail.index : t.length;
    const assigns = splitArgs(t.slice(start, end));
    const targets = assigns.map((a) => a.split('=')[0].trim().replace(/"/g, ''));
    const fixed = assigns.map((a) => {
      const i = a.indexOf('=');
      let rhs = a.slice(i + 1);
      for (const c of targets) rhs = rhs.replace(new RegExp(`(?<![.\\w"$])${c}\\b(?!\\s*\\()`, 'g'), `${table}.${c}`);
      return `${a.slice(0, i)}=${rhs}`;
    });
    t = `${t.slice(0, start)}${fixed.join(', ')} ${t.slice(end)}`;
  }
  t = t.replace(/\bIFNULL\s*\(/gi, 'COALESCE(');
  t = t.replace(/\browid\b/gi, 'ctid');
  t = t.replace(/\bAS\s+REAL\s*\)/gi, 'AS double precision)');
  // Datas
  t = rewriteCalls(t, 'julianday', (a) => `(EXTRACT(EPOCH FROM ${tsOf(a[0], lits)}) / 86400.0 + 2440587.5)`);
  t = rewriteCalls(t, 'strftime', (a) => {
    const fmt = litValue(a[0], lits);
    if (fmt == null) return null;
    return `to_char(${tsOf(a[1], lits)} AT TIME ZONE '${zoneOf(a.slice(2), lits)}', '${pgFormat(fmt)}')`;
  });
  t = rewriteCalls(t, 'date', (a, inner) => (inner.trim() ? `to_char(${tsOf(a[0], lits)} AT TIME ZONE '${zoneOf(a.slice(1), lits)}', 'YYYY-MM-DD')` : null));
  // Agregações e funções
  t = rewriteCalls(t, 'GROUP_CONCAT', (a, inner) => {
    const distinct = /^\s*DISTINCT\s+/i.test(inner);
    const expr = distinct ? splitArgs(inner.replace(/^\s*DISTINCT\s+/i, ''))[0] : a[0];
    const sep = !distinct && a[1] ? a[1] : "','";
    return `string_agg(${distinct ? 'DISTINCT ' : ''}CAST(${expr} AS text), ${sep})`;
  });
  t = rewriteCalls(t, 'instr', (a) => `strpos(${a[0]}, ${a[1]})`);
  t = rewriteCalls(t, 'MAX', (a) => (a.length > 1 ? `GREATEST(${a.join(', ')})` : null));
  t = rewriteCalls(t, 'MIN', (a) => (a.length > 1 ? `LEAST(${a.join(', ')})` : null));
  for (const fn of ['SUM', 'AVG', 'TOTAL']) {
    t = rewriteCalls(t, fn, (a, inner) => (a.length === 1 && !/^\s*DISTINCT\b/i.test(inner) && topLevelBool(inner) && !/^__bool__/.test(inner)
      ? `${fn === 'TOTAL' ? 'SUM' : fn}(__bool__CASE WHEN ${inner} THEN 1 ELSE 0 END)` : null));
  }
  t = t.replace(/__bool__/g, '');
  t = rewriteCalls(t, 'ROUND', (a) => (a.length === 2 && !/^CAST\(.* AS numeric\)$/i.test(a[0]) ? `round__(CAST(${a[0]} AS numeric), ${a[1]})` : null));
  t = t.replace(/round__\(/g, 'round(');
  // Comparação sem diferença de maiúsculas
  t = t.replace(/([\w.]+)\s*=\s*(\$\d+)\s+COLLATE\s+NOCASE/gi, 'lower($1) = lower($2)');
  t = t.replace(/([\w.]+)\s+COLLATE\s+NOCASE/gi, 'lower($1)');
  t = t.replace(/\bNOT\s+LIKE\b/gi, 'NOT ILIKE').replace(/(?<!NOT\s)(?<!I)\bLIKE\b/gi, 'ILIKE');
  const out = { sql: restore(t, lits), params: n };
  cache.set(sql, out);
  return out;
}

module.exports = { translate, pgFormat, TZ };
