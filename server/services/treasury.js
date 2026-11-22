'use strict';
/**
 * Financeiro da empresa: contas a pagar e a receber, cadastros (categorias, centros de custo, parceiros,
 * contas bancárias e formas de pagamento) e a visão geral do caixa (só o administrador).
 *
 * Cada lançamento é um TÍTULO (despesa ou receita) com uma ou mais OCORRÊNCIAS (parcelas):
 *   - pontual: uma ocorrência;
 *   - parcelada: N parcelas mensais (valores iguais ou informados um a um);
 *   - recorrente / assinatura: ocorrências mensais ou anuais geradas até o fim (ou 12 meses à frente,
 *     renovadas pela rotina diária); a assinatura tem data de renovação e alerta 15 dias antes.
 * Ocorrência em aberto com vencimento passado é "atrasada": o responsável e o administrador são avisados
 * e o responsável informa o motivo.
 */
const { badRequest, notFound, forbidden, clean, toNumber, toDateOnly, nowIso } = require('../util');
const { tx, nextCode } = require('../db');
const { audit } = require('../core');
const perms = require('../permissions');

const round2 = (v) => Math.round(v * 100) / 100;
const today = () => {
  const d = new Date(Date.now() - 3 * 3600000); // Brasília
  return d.toISOString().slice(0, 10);
};
const KINDS = { pontual: 'Pontual (spot)', parcelada: 'Parcelada', recorrente: 'Recorrente', assinatura: 'Assinatura' };
const PERIODS = { mensal: 1, anual: 12 };
const DIRECTIONS = { pagar: 'Conta a pagar', receber: 'Conta a receber' };
const MAX_FILE = 8 * 1024 * 1024;
const FILE_EXT = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', gif: 'image/gif', xml: 'application/xml', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv', txt: 'text/plain' };

/** Soma meses a uma data AAAA-MM-DD mantendo o dia (ou o último dia do mês). */
function addMonths(date, n, day = null) {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day || d, last));
  return target.toISOString().slice(0, 10);
}
const addDays = (date, n) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/* ------------------------- Acesso ------------------------- */

const hasFinance = (user) => perms.hasModule(user, 'financeiro');
function requireFinance(user) {
  if (!hasFinance(user)) throw forbidden('Seu usuário não tem acesso ao módulo Financeiro. Fale com o administrador.');
}
function requireAdminFin(user) {
  if (user.role !== 'admin') throw forbidden('A visão geral do financeiro é exclusiva do administrador.');
}
/** Quem tem o módulo vê tudo; quem não tem vê só os lançamentos em que é o responsável. */
function scopeSql(user) {
  return hasFinance(user) ? { sql: '1=1', params: [] } : { sql: 't.responsible_id = ?', params: [user.id] };
}
function loadTitle(db, user, id, { write = false } = {}) {
  const t = db.prepare('SELECT * FROM fin_titles WHERE id = ?').get(Number(id));
  if (!t) throw notFound('Lançamento não encontrado.');
  if (!hasFinance(user) && t.responsible_id !== user.id) throw notFound('Lançamento não encontrado.');
  if (write && !hasFinance(user) && t.responsible_id !== user.id) throw forbidden('Sem permissão para alterar este lançamento.');
  return t;
}
const admins = (db) => db.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1").all().map((u) => u.id);
const notify = (...a) => require('./notifications').notify(...a);

/* ------------------------- Cadastros ------------------------- */

const CATALOG = {
  categorias: { table: 'fin_categories', fields: ['direction', 'group_name', 'name', 'position'], required: ['name', 'direction'] },
  centros: { table: 'fin_cost_centers', fields: ['name', 'description'], required: ['name'] },
  parceiros: { table: 'fin_partners', fields: ['name', 'kind', 'doc', 'email', 'phone', 'notes', 'administrator_id', 'default_category_id'], required: ['name'] },
  contas: { table: 'fin_accounts', fields: ['name', 'bank', 'agency', 'number', 'pix_key', 'type', 'opening_balance', 'opening_date'], required: ['name'] },
  formas: { table: 'fin_payment_methods', fields: ['name', 'position'], required: ['name'] },
};

function catalogs(db, user, { all = false } = {}) {
  const act = all ? '' : ' WHERE active = 1';
  return {
    categorias: db.prepare(`SELECT * FROM fin_categories${act} ORDER BY direction, position, name`).all(),
    centros: db.prepare(`SELECT * FROM fin_cost_centers${act} ORDER BY name`).all(),
    parceiros: db.prepare(`SELECT p.*, a.name AS administrator_name FROM fin_partners p LEFT JOIN administrators a ON a.id = p.administrator_id${all ? '' : ' WHERE p.active = 1'} ORDER BY p.name`).all(),
    contas: db.prepare(`SELECT * FROM fin_accounts${act} ORDER BY type = 'caixa', id`).all(),
    formas: db.prepare(`SELECT * FROM fin_payment_methods${act} ORDER BY position, name`).all(),
    administradoras: db.prepare('SELECT id, name FROM administrators WHERE active = 1 ORDER BY name').all(),
    usuarios: db.prepare('SELECT id, name FROM users WHERE active = 1 ORDER BY name').all(),
    kinds: KINDS,
    can_edit: hasFinance(user),
    is_admin: user.role === 'admin',
  };
}

function saveCatalog(db, user, type, data) {
  requireFinance(user);
  const def = CATALOG[type];
  if (!def) throw badRequest('Cadastro inválido.');
  const row = {};
  for (const f of def.fields) {
    if (data[f] === undefined) continue;
    row[f] = ['opening_balance'].includes(f) ? toNumber(data[f]) ?? 0 : ['position', 'administrator_id', 'default_category_id'].includes(f) ? (data[f] === '' || data[f] == null ? null : Number(data[f])) : f === 'opening_date' ? toDateOnly(data[f]) : clean(data[f]);
  }
  if (data.active !== undefined) row.active = data.active === false || data.active === 'false' || data.active === 0 ? 0 : 1;
  if (row.direction && !DIRECTIONS[row.direction]) throw badRequest('Use "pagar" ou "receber" na categoria.');
  if (row.kind && !['fornecedor', 'pagador', 'ambos'].includes(row.kind)) throw badRequest('Tipo de parceiro inválido.');
  if (row.type && !['corrente', 'poupanca', 'pagamento', 'investimento', 'caixa'].includes(row.type)) throw badRequest('Tipo de conta inválido.');
  const id = data.id ? Number(data.id) : null;
  if (!id) for (const f of def.required) if (!row[f]) throw badRequest('Preencha o nome.');
  if (id && row.name === null) throw badRequest('O nome não pode ficar em branco.');
  return tx(db, () => {
    let rid = id;
    if (id) {
      const cur = db.prepare(`SELECT id FROM ${def.table} WHERE id = ?`).get(id);
      if (!cur) throw notFound('Cadastro não encontrado.');
      const keys = Object.keys(row);
      if (keys.length) db.prepare(`UPDATE ${def.table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => row[k]), id);
    } else {
      const full = { ...row, created_at: nowIso() };
      const cols = Object.keys(full);
      rid = Number(db.prepare(`INSERT INTO ${def.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => full[c] ?? null)).lastInsertRowid);
    }
    audit(db, user, `fin_${type}`, rid, id ? 'alterado' : 'criado', row);
    return { id: rid };
  });
}

/* ------------------------- Títulos e ocorrências ------------------------- */

function refCheck(db, table, id, label, extra = '') {
  if (id == null) return null;
  const r = db.prepare(`SELECT * FROM ${table} WHERE id = ?${extra}`).get(Number(id));
  if (!r) throw badRequest(`${label} inválido(a).`);
  return r.id;
}

function normalizeTitle(db, data, direction, existing = null) {
  const t = {};
  const str = (f) => data[f] !== undefined && (t[f] = clean(data[f]));
  ['description', 'invoice_number', 'notes'].forEach(str);
  if (data.invoice_date !== undefined) t.invoice_date = toDateOnly(data.invoice_date);
  const ref = (f, table, label, extra) => {
    if (data[f] === undefined) return;
    t[f] = data[f] === '' || data[f] == null ? null : refCheck(db, table, data[f], label, extra);
  };
  ref('partner_id', 'fin_partners', direction === 'receber' ? 'Instituição pagadora' : 'Fornecedor');
  ref('category_id', 'fin_categories', 'Categoria', ` AND direction = '${direction}'`);
  ref('cost_center_id', 'fin_cost_centers', 'Centro de custo');
  ref('payment_method_id', 'fin_payment_methods', 'Forma de pagamento');
  ref('account_id', 'fin_accounts', 'Conta bancária');
  ref('responsible_id', 'users', 'Responsável', ' AND active = 1');
  if (data.auto_renew !== undefined) t.auto_renew = data.auto_renew === false || data.auto_renew === 'false' || data.auto_renew === 0 || data.auto_renew === '0' ? 0 : 1;
  if (data.renewal_date !== undefined) t.renewal_date = toDateOnly(data.renewal_date);
  if (data.end_date !== undefined) t.end_date = toDateOnly(data.end_date);
  if (!existing) {
    if (!t.description) throw badRequest('Descreva o lançamento.');
    if (!KINDS[data.kind]) throw badRequest('Escolha o tipo: pontual, parcelada, recorrente ou assinatura.');
    t.kind = data.kind;
    t.first_due = toDateOnly(data.first_due || data.due_date);
    if (!t.first_due) throw badRequest('Informe o vencimento (primeiro vencimento, se for parcelado ou recorrente).');
  }
  return t;
}

/** Monta as ocorrências de um título novo. */
function buildInstallments(t, data) {
  const out = [];
  if (t.kind === 'pontual') {
    const v = toNumber(data.total_value ?? data.amount);
    if (!(v > 0)) throw badRequest('Informe o valor.');
    t.total_value = round2(v);
    out.push({ number: 1, due_date: t.first_due, amount: t.total_value });
  } else if (t.kind === 'parcelada') {
    let values = Array.isArray(data.values) ? data.values.map(toNumber) : String(data.values || '').split(/[;\n]+/).map((x) => toNumber(x.trim())).filter((x) => x != null);
    const n = Number(data.installments) || values.length;
    if (!Number.isInteger(n) || n < 2 || n > 120) throw badRequest('Informe a quantidade de parcelas (de 2 a 120).');
    if (!values.length) {
      const total = toNumber(data.total_value);
      const each = toNumber(data.installment_value);
      if (each > 0) values = Array(n).fill(round2(each));
      else if (total > 0) {
        const base = Math.floor((total / n) * 100) / 100;
        values = Array(n).fill(base);
        values[n - 1] = round2(total - base * (n - 1));
      } else throw badRequest('Informe o valor total ou o valor de cada parcela.');
    }
    if (values.length !== n) throw badRequest(`Informe ${n} valores de parcela (foram ${values.length}).`);
    if (values.some((v) => !(v > 0))) throw badRequest('Todas as parcelas precisam ter valor.');
    t.installments = n;
    t.total_value = round2(values.reduce((a, b) => a + b, 0));
    t.installment_value = values.every((v) => v === values[0]) ? values[0] : null;
    const day = Number(t.first_due.slice(8, 10));
    values.forEach((v, i) => out.push({ number: i + 1, due_date: addMonths(t.first_due, i, day), amount: round2(v) }));
  } else {
    const v = toNumber(data.installment_value ?? data.total_value ?? data.amount);
    if (!(v > 0)) throw badRequest(t.kind === 'assinatura' ? 'Informe o valor da assinatura.' : 'Informe o valor de cada ocorrência.');
    t.periodicity = PERIODS[data.periodicity] ? data.periodicity : null;
    if (!t.periodicity) throw badRequest('Informe a periodicidade: mensal ou anual.');
    t.installment_value = round2(v);
    t.total_value = null;
    if (t.end_date && t.end_date < t.first_due) throw badRequest('A data de fim não pode ser antes do primeiro vencimento.');
    if (t.kind === 'assinatura' && !t.renewal_date) t.renewal_date = addMonths(t.first_due, PERIODS[t.periodicity] * (t.periodicity === 'anual' ? 1 : 12));
    out.push(...recurring(t, 1, t.first_due));
  }
  return out;
}

/** Ocorrências de um recorrente/assinatura a partir de "from", até o fim, a renovação sem renovação automática ou 12 meses à frente. */
function recurring(t, startNumber, from) {
  const step = PERIODS[t.periodicity];
  const day = Number(t.first_due.slice(8, 10));
  const horizon = addMonths(today(), 12);
  let limit = horizon;
  if (t.end_date && t.end_date < limit) limit = t.end_date;
  if (t.kind === 'assinatura' && !t.auto_renew && t.renewal_date && t.renewal_date < limit) limit = addDays(t.renewal_date, -1);
  const out = [];
  let n = startNumber;
  let due = from;
  while (due <= limit && out.length < 400) {
    out.push({ number: n++, due_date: due, amount: t.installment_value });
    due = addMonths(t.first_due, (n - 1) * step, day);
  }
  return out;
}

function insertInstallments(db, titleId, list, t) {
  const now = nowIso();
  const ins = db.prepare('INSERT INTO fin_installments (title_id, number, due_date, amount, account_id, payment_method_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const i of list) ins.run(titleId, i.number, i.due_date, i.amount, t.account_id ?? null, t.payment_method_id ?? null, now, now);
}

function createTitle(db, user, data) {
  requireFinance(user);
  const direction = data.direction;
  if (!DIRECTIONS[direction]) throw badRequest('Informe se é conta a pagar ou a receber.');
  const t = normalizeTitle(db, data, direction);
  if (!t.category_id) throw badRequest(direction === 'pagar' ? 'Escolha a categoria da despesa.' : 'Escolha o motivo (categoria) do recebimento.');
  if (!t.responsible_id) t.responsible_id = user.id;
  const list = buildInstallments(t, data);
  if (!list.length) throw badRequest('Nenhuma ocorrência gerada: confira o vencimento e a data de fim.');
  const now = nowIso();
  return tx(db, () => {
    const code = nextCode(db, direction === 'pagar' ? 'fin_pagar' : 'fin_receber', direction === 'pagar' ? 'CP' : 'CR');
    const row = { ...t, code, direction, status: 'ativo', created_by: user.id, created_at: now, updated_at: now };
    const cols = Object.keys(row);
    const id = Number(db.prepare(`INSERT INTO fin_titles (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c] ?? null)).lastInsertRowid);
    insertInstallments(db, id, list, t);
    if (direction === 'receber' && Array.isArray(data.allocations) && data.allocations.length) saveAllocationsRaw(db, id, data.allocations, t.total_value ?? list.reduce((a, b) => a + b.amount, 0));
    if (clean(data.note)) addNoteRaw(db, id, null, 'observacao', clean(data.note), user.id);
    audit(db, user, 'fin_title', id, 'criado', { code, tipo: t.kind, ocorrencias: list.length });
    if (t.responsible_id !== user.id) notify(db, t.responsible_id, { kind: 'financeiro', title: `Você é o responsável por ${code}: ${t.description}`, body: `${DIRECTIONS[direction]} · ${list.length} ocorrência(s), primeira em ${list[0].due_date.split('-').reverse().join('/')}.`, link: `#/financeiro/${direction}` });
    return { id, code, installments: list.length };
  });
}

function updateTitle(db, user, id, data) {
  const t = loadTitle(db, user, id, { write: true });
  requireFinance(user);
  const o = normalizeTitle(db, data, t.direction, t);
  delete o.kind;
  delete o.first_due;
  if (o.description === null) throw badRequest('A descrição não pode ficar em branco.');
  const keys = Object.keys(o);
  if (!keys.length) return { ok: true };
  tx(db, () => {
    db.prepare(`UPDATE fin_titles SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => o[k]), nowIso(), t.id);
    // Conta e forma padrão valem para as ocorrências ainda em aberto
    if (o.account_id !== undefined) db.prepare("UPDATE fin_installments SET account_id = ? WHERE title_id = ? AND status = 'aberto'").run(o.account_id, t.id);
    if (o.payment_method_id !== undefined) db.prepare("UPDATE fin_installments SET payment_method_id = ? WHERE title_id = ? AND status = 'aberto'").run(o.payment_method_id, t.id);
    // Recorrência: fim ou renovação alterados → remove o que passou do limite e completa o que faltar
    if (['recorrente', 'assinatura'].includes(t.kind) && (o.end_date !== undefined || o.renewal_date !== undefined || o.auto_renew !== undefined)) {
      const cur = { ...t, ...o };
      const last = db.prepare('SELECT MAX(number) AS n, MAX(due_date) AS d FROM fin_installments WHERE title_id = ?').get(t.id);
      const limit = cur.end_date || (cur.kind === 'assinatura' && !cur.auto_renew && cur.renewal_date ? addDays(cur.renewal_date, -1) : null);
      if (limit) db.prepare("UPDATE fin_installments SET status = 'cancelado', notes = COALESCE(notes, 'Fora do período após alteração'), updated_at = ? WHERE title_id = ? AND status = 'aberto' AND due_date > ?").run(nowIso(), t.id, limit);
      extendRecurring(db, cur, last);
    }
    audit(db, user, 'fin_title', t.id, 'alterado', o);
  });
  return { ok: true };
}

function extendRecurring(db, t, last = null) {
  if (t.status !== 'ativo' || !['recorrente', 'assinatura'].includes(t.kind)) return 0;
  const l = last || db.prepare('SELECT MAX(number) AS n, MAX(due_date) AS d FROM fin_installments WHERE title_id = ?').get(t.id);
  const step = PERIODS[t.periodicity];
  const next = l.d ? addMonths(t.first_due, (l.n || 0) * step, Number(t.first_due.slice(8, 10))) : t.first_due;
  const list = recurring(t, (l.n || 0) + 1, next);
  insertInstallments(db, t.id, list, t);
  return list.length;
}

function cancelTitle(db, user, id, data) {
  const t = loadTitle(db, user, id, { write: true });
  requireFinance(user);
  const reason = clean(data.reason);
  if (!reason) throw badRequest('Informe o motivo do cancelamento.');
  if (t.status === 'cancelado') throw badRequest('Lançamento já cancelado.');
  tx(db, () => {
    const now = nowIso();
    const n = db.prepare("UPDATE fin_installments SET status = 'cancelado', updated_at = ? WHERE title_id = ? AND status = 'aberto'").run(now, t.id).changes;
    const paid = db.prepare("SELECT COUNT(*) AS n FROM fin_installments WHERE title_id = ? AND status = 'pago'").get(t.id).n;
    db.prepare('UPDATE fin_titles SET status = ?, cancel_reason = ?, end_date = COALESCE(end_date, ?), updated_at = ? WHERE id = ?').run(paid ? 'encerrado' : 'cancelado', reason, today(), now, t.id);
    addNoteRaw(db, t.id, null, 'cancelamento', `${paid ? 'Encerrado' : 'Cancelado'}: ${reason} (${n} ocorrência(s) em aberto cancelada(s)).`, user.id);
    audit(db, user, 'fin_title', t.id, 'cancelado', { motivo: reason, ocorrencias: n });
  });
  return { ok: true };
}

/* ------------------------- Arquivos, observações e rateio ------------------------- */

function insertFile(db, titleId, installmentId, data, userId, kind = 'comprovante') {
  const filename = clean(data.filename);
  if (!filename) throw badRequest('Escolha o arquivo.');
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (!FILE_EXT[ext]) throw badRequest(`Tipo de arquivo não permitido (.${ext}). Envie PDF, imagem, XML ou planilha.`);
  const content = Buffer.from(String(data.content_base64 || '').replace(/^data:[^,]*,/, ''), 'base64');
  if (!content.length) throw badRequest('Arquivo vazio.');
  if (content.length > MAX_FILE) throw badRequest('Arquivo maior que 8 MB.');
  return Number(db.prepare('INSERT INTO fin_files (title_id, installment_id, kind, filename, mime, size, content, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(titleId, installmentId ?? null, kind, filename.slice(0, 200), FILE_EXT[ext], content.length, content, userId, nowIso()).lastInsertRowid);
}

function uploadFile(db, user, titleId, data) {
  const t = loadTitle(db, user, titleId, { write: true });
  let instId = null;
  if (data.installment_id) {
    const i = db.prepare('SELECT * FROM fin_installments WHERE id = ? AND title_id = ?').get(Number(data.installment_id), t.id);
    if (!i) throw badRequest('Ocorrência não pertence a este lançamento.');
    instId = i.id;
  }
  const kind = ['comprovante', 'boleto', 'nota_fiscal', 'contrato', 'outro'].includes(data.kind) ? data.kind : 'outro';
  return tx(db, () => {
    const fid = insertFile(db, t.id, instId, data, user.id, kind);
    if (instId && kind === 'comprovante') db.prepare('UPDATE fin_installments SET file_id = ?, updated_at = ? WHERE id = ?').run(fid, nowIso(), instId);
    addNoteRaw(db, t.id, instId, 'arquivo', `Arquivo anexado: ${clean(data.filename)}.`, user.id);
    return { id: fid };
  });
}

function getFile(db, user, id) {
  const f = db.prepare('SELECT * FROM fin_files WHERE id = ?').get(Number(id));
  if (!f) throw notFound('Arquivo não encontrado.');
  loadTitle(db, user, f.title_id);
  return f;
}

function addNoteRaw(db, titleId, instId, kind, text, userId) {
  db.prepare('INSERT INTO fin_notes (title_id, installment_id, kind, text, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(titleId, instId ?? null, kind, text, userId ?? null, nowIso());
}

function addNote(db, user, titleId, data) {
  const t = loadTitle(db, user, titleId, { write: true });
  const text = clean(data.text);
  if (!text || text.length < 3) throw badRequest('Escreva a observação.');
  let instId = null;
  if (data.installment_id) instId = db.prepare('SELECT id FROM fin_installments WHERE id = ? AND title_id = ?').get(Number(data.installment_id), t.id)?.id ?? null;
  addNoteRaw(db, t.id, instId, 'observacao', text.slice(0, 2000), user.id);
  return { ok: true };
}

function saveAllocationsRaw(db, titleId, list, total) {
  const rows = (Array.isArray(list) ? list : []).map((a) => ({ competence: String(a.competence || '').slice(0, 7), amount: round2(toNumber(a.amount) || 0), notes: clean(a.notes) ?? null })).filter((a) => a.competence || a.amount);
  for (const a of rows) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(a.competence)) throw badRequest('Informe o mês de competência de cada parte do rateio (ex.: 2026-09).');
    if (!(a.amount > 0)) throw badRequest('Cada parte do rateio precisa ter valor.');
  }
  if (new Set(rows.map((a) => a.competence)).size !== rows.length) throw badRequest('Há meses repetidos no rateio.');
  const sum = round2(rows.reduce((t, a) => t + a.amount, 0));
  if (rows.length && total != null && Math.abs(sum - total) > 0.01) throw badRequest(`A soma do rateio (R$ ${sum.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}) precisa ser igual ao valor total (R$ ${Number(total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}).`);
  db.prepare('DELETE FROM fin_allocations WHERE title_id = ?').run(titleId);
  const ins = db.prepare('INSERT INTO fin_allocations (title_id, competence, amount, notes) VALUES (?, ?, ?, ?)');
  for (const a of rows) ins.run(titleId, a.competence, a.amount, a.notes);
  return rows.length;
}

/** Rateio por competência de uma receita (ex.: nota da administradora referente a vários meses). Não altera o caixa nem meses fechados. */
function saveAllocations(db, user, titleId, data) {
  const t = loadTitle(db, user, titleId, { write: true });
  requireFinance(user);
  if (t.direction !== 'receber') throw badRequest('O rateio por competência é das contas a receber.');
  if (t.kind === 'recorrente' || t.kind === 'assinatura') throw badRequest('Receitas recorrentes já entram na competência de cada vencimento: o rateio vale para notas pontuais ou parceladas.');
  const total = t.total_value ?? db.prepare("SELECT COALESCE(SUM(amount), 0) AS v FROM fin_installments WHERE title_id = ? AND status <> 'cancelado'").get(t.id).v;
  return tx(db, () => {
    const n = saveAllocationsRaw(db, t.id, data.allocations, total);
    addNoteRaw(db, t.id, null, 'rateio', n ? `Rateio por competência: ${data.allocations.map((a) => `${String(a.competence).split('-').reverse().join('/')} R$ ${Number(a.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`).join('; ')}.` : 'Rateio removido.', user.id);
    audit(db, user, 'fin_title', t.id, 'rateio', { partes: n });
    return { ok: true, parts: n };
  });
}

/* ------------------------- Baixa, estorno, edição e atraso ------------------------- */

function loadInstallment(db, user, id, write = true) {
  const i = db.prepare('SELECT * FROM fin_installments WHERE id = ?').get(Number(id));
  if (!i) throw notFound('Ocorrência não encontrada.');
  const t = loadTitle(db, user, i.title_id, { write });
  return { i, t };
}

/** Baixa: pagamento (contas a pagar) ou recebimento (contas a receber), com comprovante. */
function settle(db, user, id, data) {
  const { i, t } = loadInstallment(db, user, id);
  if (i.status !== 'aberto') throw badRequest(i.status === 'pago' ? 'Esta ocorrência já foi baixada.' : 'Ocorrência cancelada.');
  const date = toDateOnly(data.paid_at) || today();
  if (date > today()) throw badRequest('A data do pagamento não pode ser futura.');
  const amount = toNumber(data.paid_amount) ?? i.amount;
  if (!(amount > 0)) throw badRequest('Informe o valor pago.');
  const account = data.account_id ? refCheck(db, 'fin_accounts', data.account_id, 'Conta bancária') : i.account_id ?? t.account_id;
  if (!account) throw badRequest(t.direction === 'pagar' ? 'Informe a conta de onde saiu o pagamento.' : 'Informe a conta em que o valor entrou.');
  const method = data.payment_method_id ? refCheck(db, 'fin_payment_methods', data.payment_method_id, 'Forma de pagamento') : i.payment_method_id ?? t.payment_method_id;
  return tx(db, () => {
    const fid = data.content_base64 ? insertFile(db, t.id, i.id, data, user.id, 'comprovante') : null;
    db.prepare("UPDATE fin_installments SET status = 'pago', paid_at = ?, paid_amount = ?, paid_by = ?, account_id = ?, payment_method_id = ?, file_id = COALESCE(?, file_id), notes = COALESCE(?, notes), updated_at = ? WHERE id = ?")
      .run(date, round2(amount), user.id, account, method ?? null, fid, clean(data.notes) ?? null, nowIso(), i.id);
    const verb = t.direction === 'pagar' ? 'Pago' : 'Recebido';
    addNoteRaw(db, t.id, i.id, 'baixa', `${verb}: ocorrência ${i.number} de R$ ${round2(amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} em ${date.split('-').reverse().join('/')}${fid ? ', com comprovante' : ', sem comprovante'}.${Math.abs(amount - i.amount) > 0.009 ? ` Valor previsto: R$ ${i.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.` : ''}`, user.id);
    if (t.kind === 'pontual' || t.kind === 'parcelada') {
      const open = db.prepare("SELECT COUNT(*) AS n FROM fin_installments WHERE title_id = ? AND status = 'aberto'").get(t.id).n;
      if (!open) db.prepare("UPDATE fin_titles SET status = 'encerrado', updated_at = ? WHERE id = ?").run(nowIso(), t.id);
    }
    audit(db, user, 'fin_installment', i.id, 'baixa', { titulo: t.code, valor: amount, data: date, comprovante: !!fid });
    return { ok: true, file_id: fid };
  });
}

function reopen(db, user, id, data) {
  const { i, t } = loadInstallment(db, user, id);
  requireFinance(user);
  if (i.status !== 'pago') throw badRequest('Só é possível estornar uma ocorrência baixada.');
  const reason = clean(data.reason);
  if (!reason) throw badRequest('Informe o motivo do estorno.');
  tx(db, () => {
    db.prepare("UPDATE fin_installments SET status = 'aberto', paid_at = NULL, paid_amount = NULL, paid_by = NULL, updated_at = ? WHERE id = ?").run(nowIso(), i.id);
    if (t.status === 'encerrado' && !t.cancel_reason) db.prepare("UPDATE fin_titles SET status = 'ativo', updated_at = ? WHERE id = ?").run(nowIso(), t.id);
    addNoteRaw(db, t.id, i.id, 'estorno', `Baixa da ocorrência ${i.number} estornada: ${reason}`, user.id);
    audit(db, user, 'fin_installment', i.id, 'estorno', { motivo: reason });
  });
  return { ok: true };
}

/** Ajusta vencimento ou valor de uma ocorrência em aberto (ex.: novo boleto com outra data) — exige observação. */
function editInstallment(db, user, id, data) {
  const { i, t } = loadInstallment(db, user, id);
  if (i.status !== 'aberto') throw badRequest('Só ocorrências em aberto podem ser alteradas.');
  const due = data.due_date !== undefined ? toDateOnly(data.due_date) : i.due_date;
  const amount = data.amount !== undefined ? toNumber(data.amount) : i.amount;
  if (!due) throw badRequest('Informe o vencimento.');
  if (!(amount > 0)) throw badRequest('Informe o valor.');
  const why = clean(data.reason);
  if ((due !== i.due_date || Math.abs(amount - i.amount) > 0.009) && !why) throw badRequest('Explique a alteração (ex.: novo boleto emitido por erro na data).');
  tx(db, () => {
    db.prepare('UPDATE fin_installments SET due_date = ?, amount = ?, alerted_at = CASE WHEN ? > due_date THEN NULL ELSE alerted_at END, updated_at = ? WHERE id = ?').run(due, round2(amount), due, nowIso(), i.id);
    if (why) addNoteRaw(db, t.id, i.id, 'alteracao', `Ocorrência ${i.number}: ${due !== i.due_date ? `vencimento ${i.due_date.split('-').reverse().join('/')} → ${due.split('-').reverse().join('/')}` : ''}${due !== i.due_date && Math.abs(amount - i.amount) > 0.009 ? '; ' : ''}${Math.abs(amount - i.amount) > 0.009 ? `valor R$ ${i.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} → R$ ${round2(amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : ''}. ${why}`, user.id);
    audit(db, user, 'fin_installment', i.id, 'alterada', { vencimento: due, valor: amount, motivo: why });
  });
  return { ok: true };
}

/** O responsável explica o atraso: fica na ocorrência, no histórico e vai para o administrador. */
function lateReason(db, user, id, data) {
  const { i, t } = loadInstallment(db, user, id);
  const reason = clean(data.reason);
  if (!reason || reason.length < 5) throw badRequest('Explique o motivo do atraso.');
  if (i.status !== 'aberto') throw badRequest('Esta ocorrência não está em aberto.');
  tx(db, () => {
    db.prepare('UPDATE fin_installments SET late_reason = ?, late_reason_at = ?, late_reason_by = ?, updated_at = ? WHERE id = ?').run(reason, nowIso(), user.id, nowIso(), i.id);
    addNoteRaw(db, t.id, i.id, 'atraso', `Motivo do atraso (ocorrência ${i.number}): ${reason}`, user.id);
    notify(db, admins(db), { kind: 'financeiro', level: 'warn', title: `Motivo do atraso: ${t.code} ${t.description}`, body: `${user.name}: ${reason}`, link: `#/financeiro/${t.direction}`, exclude: user.id });
  });
  return { ok: true };
}

/* ------------------------- Listas e detalhe ------------------------- */

const ITEM_SELECT = `SELECT i.*, t.code, t.direction, t.description, t.kind, t.periodicity, t.installments AS total_installments, t.status AS title_status,
  t.responsible_id, t.partner_id, t.category_id, t.cost_center_id, t.invoice_number, t.renewal_date, t.end_date,
  p.name AS partner_name, c.name AS category_name, c.group_name AS category_group, cc.name AS cost_center_name,
  a.name AS account_name, m.name AS method_name, u.name AS responsible_name, pb.name AS paid_by_name,
  (SELECT COUNT(*) FROM fin_notes n WHERE n.title_id = t.id AND n.kind IN ('observacao', 'atraso', 'alteracao')) AS notes_count
  FROM fin_installments i JOIN fin_titles t ON t.id = i.title_id
  LEFT JOIN fin_partners p ON p.id = t.partner_id LEFT JOIN fin_categories c ON c.id = t.category_id LEFT JOIN fin_cost_centers cc ON cc.id = t.cost_center_id
  LEFT JOIN fin_accounts a ON a.id = i.account_id LEFT JOIN fin_payment_methods m ON m.id = i.payment_method_id
  LEFT JOIN users u ON u.id = t.responsible_id LEFT JOIN users pb ON pb.id = i.paid_by`;

const itemStatus = (i, d = today()) => (i.status === 'aberto' && i.due_date < d ? 'atrasado' : i.status);
const decorate = (i) => ({ ...i, situation: itemStatus(i), days_late: itemStatus(i) === 'atrasado' ? Math.round((Date.parse(today()) - Date.parse(i.due_date)) / 86400000) : 0 });

function listItems(db, user, q = {}) {
  const direction = DIRECTIONS[q.direcao] ? q.direcao : 'pagar';
  const sc = scopeSql(user);
  const where = ['t.direction = ?', sc.sql];
  const params = [direction, ...sc.params];
  const d = today();
  const st = q.status || 'pendentes';
  // Padrão: atrasados e o que vence nos próximos 30 dias (recorrentes têm ocorrências geradas 12 meses à frente)
  if (st === 'pendentes') (where.push("i.status = 'aberto' AND i.due_date <= ?"), params.push(addDays(d, 30)));
  else if (st === 'abertos') where.push("i.status = 'aberto'");
  else if (st === 'atrasado') (where.push("i.status = 'aberto' AND i.due_date < ?"), params.push(d));
  else if (st === 'aberto') (where.push("i.status = 'aberto' AND i.due_date >= ?"), params.push(d));
  else if (st === 'pago') where.push("i.status = 'pago'");
  else if (st === 'cancelado') where.push("i.status = 'cancelado'");
  else if (st === 'sem_comprovante') where.push("i.status = 'pago' AND i.file_id IS NULL");
  else where.push("i.status <> 'cancelado'");
  for (const [f, col] of [['categoria', 't.category_id'], ['centro', 't.cost_center_id'], ['parceiro', 't.partner_id'], ['responsavel', 't.responsible_id'], ['conta', 'i.account_id']]) {
    if (q[f]) (where.push(`${col} = ?`), params.push(Number(q[f])));
  }
  if (q.tipo && KINDS[q.tipo]) (where.push('t.kind = ?'), params.push(q.tipo));
  if (q.mes && /^\d{4}-\d{2}$/.test(q.mes)) (where.push(`substr(${st === 'pago' ? 'i.paid_at' : 'i.due_date'}, 1, 7) = ?`), params.push(q.mes));
  if (q.de) (where.push('i.due_date >= ?'), params.push(toDateOnly(q.de)));
  if (q.ate) (where.push('i.due_date <= ?'), params.push(toDateOnly(q.ate)));
  if (q.q) (where.push('(t.description LIKE ? OR t.code = ? OR p.name LIKE ? OR t.invoice_number = ?)'), params.push(`%${q.q}%`, String(q.q).toUpperCase(), `%${q.q}%`, String(q.q)));
  const order = st === 'pago' ? 'i.paid_at DESC, i.id DESC' : 'i.due_date, i.id';
  const rows = db.prepare(`${ITEM_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 1000`).all(...params).map(decorate);
  return { direction, rows, summary: summaryFor(db, user, direction) };
}

function summaryFor(db, user, direction) {
  const sc = scopeSql(user);
  const d = today();
  const month = d.slice(0, 7);
  const one = (cond, p = []) => db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(i.amount), 0) AS v, COALESCE(SUM(i.paid_amount), 0) AS pv FROM fin_installments i JOIN fin_titles t ON t.id = i.title_id WHERE t.direction = ? AND ${sc.sql} AND ${cond}`).get(direction, ...sc.params, ...p);
  const late = one("i.status = 'aberto' AND i.due_date < ?", [d]);
  const week = one("i.status = 'aberto' AND i.due_date BETWEEN ? AND ?", [d, addDays(d, 7)]);
  const open = one("i.status = 'aberto'");
  const untilMonthEnd = one("i.status = 'aberto' AND i.due_date <= ?", [addDays(addMonths(`${month}-01`, 1), -1)]);
  const next30 = one("i.status = 'aberto' AND i.due_date <= ?", [addDays(d, 30)]);
  const monthDue = one("i.status <> 'cancelado' AND substr(i.due_date, 1, 7) = ?", [month]);
  const monthPaid = one("i.status = 'pago' AND substr(i.paid_at, 1, 7) = ?", [month]);
  const noProof = one("i.status = 'pago' AND i.file_id IS NULL");
  const noReason = one("i.status = 'aberto' AND i.due_date < ? AND i.late_reason IS NULL", [d]);
  return {
    aberto: { n: open.n, v: round2(open.v) },
    ate_fim_mes: { n: untilMonthEnd.n, v: round2(untilMonthEnd.v) },
    pendentes_30_dias: { n: next30.n, v: round2(next30.v) },
    atrasado: { n: late.n, v: round2(late.v), sem_motivo: noReason.n },
    proximos_7_dias: { n: week.n, v: round2(week.v) },
    previsto_mes: { n: monthDue.n, v: round2(monthDue.v) },
    realizado_mes: { n: monthPaid.n, v: round2(monthPaid.pv) },
    sem_comprovante: noProof.n,
  };
}

function getTitle(db, user, id) {
  const t = loadTitle(db, user, id);
  const row = db.prepare(`SELECT t.*, p.name AS partner_name, c.name AS category_name, c.group_name AS category_group, cc.name AS cost_center_name, a.name AS account_name,
    m.name AS method_name, u.name AS responsible_name, cb.name AS created_by_name FROM fin_titles t LEFT JOIN fin_partners p ON p.id = t.partner_id
    LEFT JOIN fin_categories c ON c.id = t.category_id LEFT JOIN fin_cost_centers cc ON cc.id = t.cost_center_id LEFT JOIN fin_accounts a ON a.id = t.account_id
    LEFT JOIN fin_payment_methods m ON m.id = t.payment_method_id LEFT JOIN users u ON u.id = t.responsible_id LEFT JOIN users cb ON cb.id = t.created_by WHERE t.id = ?`).get(t.id);
  row.items = db.prepare(`${ITEM_SELECT} WHERE i.title_id = ? ORDER BY i.number`).all(t.id).map(decorate);
  // notes (coluna do título) = observações gerais; history = observações, baixas, atrasos e alterações
  row.history = db.prepare('SELECT n.*, u.name AS user_name, i.number AS installment_number FROM fin_notes n LEFT JOIN users u ON u.id = n.user_id LEFT JOIN fin_installments i ON i.id = n.installment_id WHERE n.title_id = ? ORDER BY n.created_at DESC, n.id DESC').all(t.id);
  row.files = db.prepare('SELECT f.id, f.installment_id, f.kind, f.filename, f.size, f.created_at, u.name AS uploaded_by_name, i.number AS installment_number FROM fin_files f LEFT JOIN users u ON u.id = f.uploaded_by LEFT JOIN fin_installments i ON i.id = f.installment_id WHERE f.title_id = ? ORDER BY f.created_at DESC').all(t.id);
  row.allocations = db.prepare('SELECT * FROM fin_allocations WHERE title_id = ? ORDER BY competence DESC').all(t.id);
  const live = row.items.filter((i) => i.status !== 'cancelado');
  row.totals = { previsto: round2(live.reduce((a, i) => a + i.amount, 0)), realizado: round2(live.filter((i) => i.status === 'pago').reduce((a, i) => a + (i.paid_amount || 0), 0)), em_aberto: round2(live.filter((i) => i.status === 'aberto').reduce((a, i) => a + i.amount, 0)) };
  row.can_manage = hasFinance(user);
  return row;
}

/** Receitas por mês de competência (rateio). Sem rateio, a competência é o mês da nota (ou do vencimento). */
function competence(db, user, q = {}) {
  requireFinance(user);
  const from = /^\d{4}-\d{2}$/.test(q.de || '') ? q.de : addMonths(today(), -11).slice(0, 7);
  const to = /^\d{4}-\d{2}$/.test(q.ate || '') ? q.ate : today().slice(0, 7);
  const titles = db.prepare("SELECT t.id, t.code, t.kind, t.description, t.invoice_number, t.invoice_date, t.total_value, t.first_due, p.name AS partner_name, c.name AS category_name FROM fin_titles t LEFT JOIN fin_partners p ON p.id = t.partner_id LEFT JOIN fin_categories c ON c.id = t.category_id WHERE t.direction = 'receber' AND t.status <> 'cancelado'").all();
  const months = {};
  for (const t of titles) {
    const alloc = db.prepare('SELECT competence, amount FROM fin_allocations WHERE title_id = ?').all(t.id);
    // Sem rateio: a nota inteira no mês de emissão (ou do 1º vencimento); recorrentes, cada ocorrência no mês do vencimento
    const recurringParts = () => db.prepare("SELECT substr(due_date, 1, 7) AS competence, COALESCE(paid_amount, amount) AS amount, 1 AS sem_rateio FROM fin_installments WHERE title_id = ? AND status <> 'cancelado' AND substr(due_date, 1, 7) BETWEEN ? AND ?").all(t.id, from, to);
    const parts = alloc.length ? alloc : t.kind === 'recorrente' || t.kind === 'assinatura' ? recurringParts() : t.total_value ? [{ competence: (t.invoice_date || t.first_due).slice(0, 7), amount: t.total_value, sem_rateio: true }] : [];
    for (const a of parts) {
      if (a.competence < from || a.competence > to) continue;
      const m = (months[a.competence] ||= { competence: a.competence, total: 0, items: [] });
      m.total = round2(m.total + a.amount);
      m.items.push({ title_id: t.id, code: t.code, description: t.description, partner_name: t.partner_name, category_name: t.category_name, invoice_number: t.invoice_number, kind: t.kind, amount: a.amount, sem_rateio: !!a.sem_rateio });
    }
  }
  return { from, to, months: Object.values(months).sort((a, b) => b.competence.localeCompare(a.competence)) };
}

/* ------------------------- Visão geral (administrador) ------------------------- */

function accountBalances(db, until = today()) {
  return db.prepare("SELECT * FROM fin_accounts WHERE active = 1 ORDER BY type = 'caixa', name").all().map((a) => {
    const mov = db.prepare(`SELECT COALESCE(SUM(CASE WHEN t.direction = 'receber' THEN i.paid_amount ELSE 0 END), 0) AS entradas,
      COALESCE(SUM(CASE WHEN t.direction = 'pagar' THEN i.paid_amount ELSE 0 END), 0) AS saidas
      FROM fin_installments i JOIN fin_titles t ON t.id = i.title_id WHERE i.status = 'pago' AND i.account_id = ? AND i.paid_at >= COALESCE(?, '0000') AND i.paid_at <= ?`).get(a.id, a.opening_date, until);
    return { id: a.id, name: a.name, bank: a.bank, type: a.type, opening_balance: a.opening_balance, entradas: round2(mov.entradas), saidas: round2(mov.saidas), saldo: round2(a.opening_balance + mov.entradas - mov.saidas) };
  });
}

function overview(db, user) {
  requireFinance(user);
  requireAdminFin(user);
  const d = today();
  const month = d.slice(0, 7);
  const accounts = accountBalances(db);
  const pagar = summaryFor(db, user, 'pagar');
  const receber = summaryFor(db, user, 'receber');
  const next30 = (dir) => db.prepare("SELECT COALESCE(SUM(i.amount), 0) AS v FROM fin_installments i JOIN fin_titles t ON t.id = i.title_id WHERE t.direction = ? AND i.status = 'aberto' AND i.due_date BETWEEN ? AND ?").get(dir, d, addDays(d, 30)).v;
  const saldo = round2(accounts.reduce((a, c) => a + c.saldo, 0));
  // Últimas 6 competências: entradas e saídas realizadas
  const meses = [];
  for (let k = 5; k >= 0; k--) {
    const m = addMonths(`${month}-01`, -k).slice(0, 7);
    const r = db.prepare(`SELECT COALESCE(SUM(CASE WHEN t.direction = 'receber' THEN i.paid_amount END), 0) AS entradas, COALESCE(SUM(CASE WHEN t.direction = 'pagar' THEN i.paid_amount END), 0) AS saidas
      FROM fin_installments i JOIN fin_titles t ON t.id = i.title_id WHERE i.status = 'pago' AND substr(i.paid_at, 1, 7) = ?`).get(m);
    meses.push({ month: m, entradas: round2(r.entradas), saidas: round2(r.saidas), resultado: round2(r.entradas - r.saidas) });
  }
  const byCategory = db.prepare(`SELECT c.name, c.group_name, COALESCE(SUM(i.paid_amount), 0) AS v FROM fin_installments i JOIN fin_titles t ON t.id = i.title_id LEFT JOIN fin_categories c ON c.id = t.category_id
    WHERE t.direction = 'pagar' AND i.status = 'pago' AND substr(i.paid_at, 1, 7) = ? GROUP BY c.id ORDER BY v DESC LIMIT 6`).all(month);
  const recent = (dir) => db.prepare(`${ITEM_SELECT} WHERE t.direction = ? AND i.status = 'pago' ORDER BY i.paid_at DESC, i.updated_at DESC LIMIT 5`).all(dir).map(decorate);
  const upcoming = (dir) => db.prepare(`${ITEM_SELECT} WHERE t.direction = ? AND i.status = 'aberto' ORDER BY i.due_date LIMIT 6`).all(dir).map(decorate);
  // Alertas
  const alerts = [];
  const lateItems = db.prepare(`${ITEM_SELECT} WHERE i.status = 'aberto' AND i.due_date < ? ORDER BY i.due_date LIMIT 30`).all(d).map(decorate);
  for (const i of lateItems) {
    alerts.push({ level: 'danger', direction: i.direction, title_id: i.title_id, text: `${i.direction === 'pagar' ? 'Conta a pagar atrasada' : 'Recebimento atrasado'} há ${i.days_late} dia(s): ${i.description} (${i.code}${i.total_installments ? `, parcela ${i.number}/${i.total_installments}` : ''}) · R$ ${i.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, reason: i.late_reason || null, responsible: i.responsible_name });
  }
  const today0 = db.prepare(`${ITEM_SELECT} WHERE i.status = 'aberto' AND i.due_date = ? ORDER BY t.direction`).all(d);
  for (const i of today0) alerts.push({ level: 'warn', direction: i.direction, title_id: i.title_id, text: `Vence hoje: ${i.description} (${i.code}) · R$ ${i.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, responsible: i.responsible_name });
  for (const t of db.prepare("SELECT * FROM fin_titles WHERE kind = 'assinatura' AND status = 'ativo' AND renewal_date IS NOT NULL AND renewal_date BETWEEN ? AND ? ORDER BY renewal_date").all(d, addDays(d, 30))) {
    alerts.push({ level: 'info', direction: t.direction, title_id: t.id, text: `Assinatura ${t.auto_renew ? 'renova' : 'termina'} em ${t.renewal_date.split('-').reverse().join('/')}: ${t.description} (${t.code})` });
  }
  if (pagar.sem_comprovante) alerts.push({ level: 'warn', direction: 'pagar', text: `${pagar.sem_comprovante} pagamento(s) sem comprovante anexado`, filter: 'sem_comprovante' });
  if (receber.sem_comprovante) alerts.push({ level: 'muted', direction: 'receber', text: `${receber.sem_comprovante} recebimento(s) sem comprovante anexado`, filter: 'sem_comprovante' });
  const projected = round2(saldo + next30('receber') - next30('pagar'));
  if (projected < 0) alerts.unshift({ level: 'danger', text: `Saldo projetado para 30 dias negativo: R$ ${projected.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` });
  const mesAtual = meses[meses.length - 1];
  return {
    saldo,
    accounts,
    mes: { month, entradas: mesAtual.entradas, saidas: mesAtual.saidas, resultado: mesAtual.resultado, previsto_entradas: receber.previsto_mes.v, previsto_saidas: pagar.previsto_mes.v },
    pagar: { ...pagar, proximos_30_dias: round2(next30('pagar')), recentes: recent('pagar'), proximos: upcoming('pagar') },
    receber: { ...receber, proximos_30_dias: round2(next30('receber')), recentes: recent('receber'), proximos: upcoming('receber') },
    saldo_projetado_30_dias: projected,
    meses,
    despesas_por_categoria: byCategory.map((c) => ({ ...c, v: round2(c.v) })),
    alerts,
  };
}

/** Indica se o usuário tem lançamentos sob sua responsabilidade (mostra o menu mesmo sem o módulo). */
const hasResponsibilities = (db, user) => !!db.prepare("SELECT 1 FROM fin_titles WHERE responsible_id = ? AND status = 'ativo' LIMIT 1").get(user.id);

/* ------------------------- Rotina diária ------------------------- */

/**
 * - Atrasos: avisa o responsável e o administrador uma vez por ocorrência, pedindo o motivo.
 * - Vencimentos em 3 dias: lembra o responsável.
 * - Recorrentes e assinaturas: completa as ocorrências até 12 meses à frente.
 * - Assinaturas: avisa 15 dias antes da renovação; renovação automática avança o ciclo, sem renovação encerra.
 */
function sweep(db) {
  const d = today();
  let n = 0;
  const late = db.prepare(`${ITEM_SELECT} WHERE i.status = 'aberto' AND i.due_date < ? AND i.alerted_at IS NULL AND t.status <> 'cancelado'`).all(d);
  for (const i of late) {
    tx(db, () => {
      const who = [...new Set([i.responsible_id, ...admins(db)].filter(Boolean))];
      notify(db, who, { kind: 'financeiro', level: 'danger', title: `${i.direction === 'pagar' ? 'Conta a pagar' : 'Recebimento'} atrasado: ${i.description}`, body: `${i.code}${i.total_installments ? ` · parcela ${i.number}/${i.total_installments}` : ''} venceu em ${i.due_date.split('-').reverse().join('/')}. Responsável: informe o motivo do atraso.`, link: `#/financeiro/${i.direction}?status=atrasado` });
      db.prepare('UPDATE fin_installments SET alerted_at = ? WHERE id = ?').run(nowIso(), i.id);
    });
    n++;
  }
  const soon = db.prepare(`${ITEM_SELECT} WHERE i.status = 'aberto' AND i.due_date BETWEEN ? AND ? AND i.reminded_at IS NULL AND t.status = 'ativo'`).all(d, addDays(d, 3));
  for (const i of soon) {
    if (i.responsible_id) notify(db, i.responsible_id, { kind: 'financeiro', title: `Vence em ${i.due_date.split('-').reverse().join('/')}: ${i.description}`, body: `${i.code} · R$ ${i.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, link: `#/financeiro/${i.direction}` });
    db.prepare('UPDATE fin_installments SET reminded_at = ? WHERE id = ?').run(nowIso(), i.id);
  }
  for (const t of db.prepare("SELECT * FROM fin_titles WHERE status = 'ativo' AND kind IN ('recorrente','assinatura')").all()) {
    tx(db, () => {
      if (t.kind === 'assinatura' && t.renewal_date) {
        if (t.renewal_date <= addDays(d, 15) && t.renewal_date >= d && !t.renewal_alerted_at) {
          notify(db, [...new Set([t.responsible_id, ...admins(db)].filter(Boolean))], { kind: 'financeiro', level: 'warn', title: `Assinatura ${t.auto_renew ? 'renova' : 'termina'} em ${t.renewal_date.split('-').reverse().join('/')}: ${t.description}`, body: t.auto_renew ? 'Renovação automática: confira se ainda faz sentido manter.' : 'Sem renovação automática: decida se renova.', link: '#/financeiro/pagar' });
          db.prepare('UPDATE fin_titles SET renewal_alerted_at = ? WHERE id = ?').run(nowIso(), t.id);
        }
        if (t.renewal_date < d) {
          if (t.auto_renew) {
            let next = t.renewal_date;
            const step = t.periodicity === 'anual' ? 12 : 12;
            while (next < d) next = addMonths(next, step);
            db.prepare('UPDATE fin_titles SET renewal_date = ?, renewal_alerted_at = NULL, updated_at = ? WHERE id = ?').run(next, nowIso(), t.id);
            addNoteRaw(db, t.id, null, 'renovacao', `Assinatura renovada automaticamente até ${next.split('-').reverse().join('/')}.`, null);
            t.renewal_date = next;
          } else {
            db.prepare("UPDATE fin_titles SET status = 'encerrado', end_date = COALESCE(end_date, ?), updated_at = ? WHERE id = ?").run(t.renewal_date, nowIso(), t.id);
            db.prepare("UPDATE fin_installments SET status = 'cancelado', updated_at = ? WHERE title_id = ? AND status = 'aberto' AND due_date >= ?").run(nowIso(), t.id, t.renewal_date);
            addNoteRaw(db, t.id, null, 'renovacao', 'Assinatura encerrada na data de renovação (sem renovação automática).', null);
            return;
          }
        }
      }
      if (t.end_date && t.end_date < d && !db.prepare("SELECT 1 FROM fin_installments WHERE title_id = ? AND status = 'aberto'").get(t.id)) {
        db.prepare("UPDATE fin_titles SET status = 'encerrado', updated_at = ? WHERE id = ?").run(nowIso(), t.id);
        return;
      }
      extendRecurring(db, t);
    });
  }
  return n;
}

module.exports = {
  KINDS, catalogs, saveCatalog, createTitle, updateTitle, cancelTitle, getTitle, listItems, summaryFor, settle, reopen, editInstallment, lateReason,
  addNote, uploadFile, getFile, saveAllocations, competence, overview, accountBalances, hasResponsibilities, sweep, addMonths,
};
