'use strict';
/**
 * Central de documentos da empresa (como um OneDrive interno), acessível só ao administrador.
 *
 * Pastas padrão (societário, fiscal e tributário, jurídico, licenças e certidões, gestão, RH, financeiro, marca) e
 * subpastas criadas pelo administrador. Cada arquivo guarda número, órgão emissor, emissão e validade (certidões,
 * alvarás, certificado digital): os que vencem em até 30 dias geram alerta no sino. Enviar uma nova versão mantém
 * a anterior no histórico. Todo download fica registrado na auditoria.
 */
const { audit } = require('../core');
const { requireModule } = require('../permissions');
const { tx } = require('../db');
const { badRequest, notFound, clean: cleanRaw, nowIso, toDateOnly } = require('../util');
// Texto limpo ou null (o SQLite não aceita undefined)
const clean = (v) => cleanRaw(v) ?? null;

const FILE_EXT = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', csv: 'text/csv', xml: 'application/xml', zip: 'application/zip', pfx: 'application/x-pkcs12', p12: 'application/x-pkcs12',
};
const MAX_FILE = 20 * 1024 * 1024;
const guard = (user) => requireModule(user, 'documentos');
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

function folderPath(db, id) {
  const path = [];
  let cur = db.prepare('SELECT id, parent_id, name FROM doc_folders WHERE id = ?').get(Number(id));
  for (let guardLoop = 0; cur && guardLoop < 20; guardLoop += 1) {
    path.unshift({ id: cur.id, name: cur.name });
    cur = cur.parent_id ? db.prepare('SELECT id, parent_id, name FROM doc_folders WHERE id = ?').get(cur.parent_id) : null;
  }
  return path;
}

/** Ids da pasta e de todas as subpastas (para contagens e para não mover uma pasta para dentro dela mesma). */
function subtreeIds(db, id) {
  const out = [Number(id)];
  for (let i = 0; i < out.length; i += 1) out.push(...db.prepare('SELECT id FROM doc_folders WHERE parent_id = ?').all(out[i]).map((r) => r.id));
  return out;
}

const DOC_COLS = 'd.id, d.folder_id, d.title, d.description, d.doc_number, d.issuer, d.issue_date, d.expires_at, d.tags, d.filename, d.mime, d.size, d.version, d.previous_id, d.status, d.created_at, d.updated_at, u.name AS uploaded_by_name';
const withExpiry = (d) => ({ ...d, expiry: !d.expires_at ? null : d.expires_at < today() ? 'vencido' : d.expires_at <= addDays(30) ? 'vencendo' : 'ok' });

/** Pasta (ou a raiz): subpastas com contagem, arquivos ativos, caminho e alertas de validade. */
function browse(db, user, q = {}) {
  guard(user);
  const folderId = q.pasta ? Number(q.pasta) : null;
  if (folderId && !db.prepare('SELECT 1 FROM doc_folders WHERE id = ?').get(folderId)) throw notFound('Pasta não encontrada.');
  const folders = db.prepare(`SELECT * FROM doc_folders WHERE ${folderId ? 'parent_id = ?' : 'parent_id IS NULL'} ORDER BY position, name`).all(...(folderId ? [folderId] : []))
    .map((f) => {
      const ids = subtreeIds(db, f.id);
      const c = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes, SUM(expires_at IS NOT NULL AND expires_at <= ?) AS alerts FROM company_documents WHERE status = 'ativo' AND folder_id IN (${ids.map(() => '?').join(',')})`).get(addDays(30), ...ids);
      return { ...f, files: c.n, bytes: c.bytes, alerts: c.alerts || 0, subfolders: ids.length - 1 };
    });
  let docs = [];
  if (q.q) {
    const like = `%${String(q.q).trim()}%`;
    docs = db.prepare(`SELECT ${DOC_COLS}, f.name AS folder_name FROM company_documents d JOIN doc_folders f ON f.id = d.folder_id LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.status = 'ativo' AND (d.title LIKE ? OR d.filename LIKE ? OR d.doc_number LIKE ? OR d.tags LIKE ? OR d.issuer LIKE ? OR d.description LIKE ?) ORDER BY d.title LIMIT 200`).all(like, like, like, like, like, like);
  } else if (folderId) {
    docs = db.prepare(`SELECT ${DOC_COLS} FROM company_documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.folder_id = ? AND d.status = 'ativo' ORDER BY d.title`).all(folderId);
  }
  const alerts = db.prepare(`SELECT ${DOC_COLS}, f.name AS folder_name FROM company_documents d JOIN doc_folders f ON f.id = d.folder_id LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.status = 'ativo' AND d.expires_at IS NOT NULL AND d.expires_at <= ? ORDER BY d.expires_at`).all(addDays(30));
  const totals = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM company_documents WHERE status = 'ativo'").get();
  return {
    folder: folderId ? db.prepare('SELECT * FROM doc_folders WHERE id = ?').get(folderId) : null,
    path: folderId ? folderPath(db, folderId) : [],
    folders,
    documents: docs.map(withExpiry),
    alerts: alerts.map(withExpiry),
    totals,
    all_folders: db.prepare('SELECT id, parent_id, name FROM doc_folders ORDER BY parent_id IS NOT NULL, position, name').all().map((f) => ({ id: f.id, name: folderPath(db, f.id).map((p) => p.name).join(' › ') })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
  };
}

function saveFolder(db, user, data) {
  guard(user);
  const name = clean(data.name);
  if (!name) throw badRequest('Informe o nome da pasta.');
  const parent = data.parent_id ? Number(data.parent_id) : null;
  if (parent && !db.prepare('SELECT 1 FROM doc_folders WHERE id = ?').get(parent)) throw badRequest('Pasta de destino inválida.');
  const now = nowIso();
  if (data.id) {
    const f = db.prepare('SELECT * FROM doc_folders WHERE id = ?').get(Number(data.id));
    if (!f) throw notFound('Pasta não encontrada.');
    if (parent && subtreeIds(db, f.id).includes(parent)) throw badRequest('Não é possível mover a pasta para dentro dela mesma.');
    if (f.system && parent !== f.parent_id) throw badRequest('As pastas principais não podem ser movidas (crie subpastas dentro delas).');
    if (db.prepare('SELECT 1 FROM doc_folders WHERE name = ? AND COALESCE(parent_id, 0) = ? AND id != ?').get(name, parent || 0, f.id)) throw badRequest('Já existe uma pasta com este nome aqui.');
    db.prepare('UPDATE doc_folders SET name = ?, description = ?, parent_id = ?, updated_at = ? WHERE id = ?').run(name, clean(data.description), parent, now, f.id);
    audit(db, user, 'doc_folder', f.id, 'alterada', { nome: name });
    return { id: f.id };
  }
  if (db.prepare('SELECT 1 FROM doc_folders WHERE name = ? AND COALESCE(parent_id, 0) = ?').get(name, parent || 0)) throw badRequest('Já existe uma pasta com este nome aqui.');
  const pos = db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM doc_folders WHERE ${parent ? 'parent_id = ?' : 'parent_id IS NULL'}`).get(...(parent ? [parent] : [])).p;
  const id = Number(db.prepare('INSERT INTO doc_folders (parent_id, name, description, position, system, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)').run(parent, name, clean(data.description), pos, user.id, now, now).lastInsertRowid);
  audit(db, user, 'doc_folder', id, 'criada', { nome: name });
  return { id };
}

function deleteFolder(db, user, id) {
  guard(user);
  const f = db.prepare('SELECT * FROM doc_folders WHERE id = ?').get(Number(id));
  if (!f) throw notFound('Pasta não encontrada.');
  if (f.system) throw badRequest('As pastas principais não podem ser excluídas.');
  if (db.prepare('SELECT 1 FROM doc_folders WHERE parent_id = ?').get(f.id) || db.prepare("SELECT 1 FROM company_documents WHERE folder_id = ? AND status != 'substituido'").get(f.id)) throw badRequest('Esvazie a pasta (arquivos e subpastas) antes de excluir.');
  db.prepare('DELETE FROM company_documents WHERE folder_id = ?').run(f.id);
  db.prepare('DELETE FROM doc_folders WHERE id = ?').run(f.id);
  audit(db, user, 'doc_folder', f.id, 'excluida', { nome: f.name });
  return { ok: true };
}

function readFile(data, required = true) {
  const filename = clean(data.filename);
  if (!filename) {
    if (required) throw badRequest('Escolha o arquivo.');
    return null;
  }
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (!FILE_EXT[ext]) throw badRequest(`Tipo de arquivo não permitido (.${ext}).`);
  const content = Buffer.from(String(data.content_base64 || '').replace(/^data:[^,]*,/, ''), 'base64');
  if (!content.length) throw badRequest('Arquivo vazio.');
  if (content.length > MAX_FILE) throw badRequest('Arquivo maior que 20 MB.');
  return { filename: filename.slice(0, 200), mime: FILE_EXT[ext], size: content.length, content };
}

const meta = (data) => ({
  title: clean(data.title), description: clean(data.description), doc_number: clean(data.doc_number), issuer: clean(data.issuer),
  issue_date: data.issue_date ? toDateOnly(data.issue_date) : null, expires_at: data.expires_at ? toDateOnly(data.expires_at) : null, tags: clean(data.tags),
});

/**
 * Envia um arquivo (novo documento) ou uma nova versão (data.replace_id): a versão anterior fica no histórico.
 * Sem replace_id e sem arquivo, atualiza só os dados (título, validade, pasta...).
 */
function saveDocument(db, user, data) {
  guard(user);
  const now = nowIso();
  const m = meta(data);
  if (m.issue_date && m.expires_at && m.expires_at < m.issue_date) throw badRequest('A validade é anterior à data de emissão.');
  if (data.id) {
    const d = db.prepare('SELECT * FROM company_documents WHERE id = ?').get(Number(data.id));
    if (!d || d.status !== 'ativo') throw notFound('Documento não encontrado.');
    const folder = data.folder_id ? Number(data.folder_id) : d.folder_id;
    if (!db.prepare('SELECT 1 FROM doc_folders WHERE id = ?').get(folder)) throw badRequest('Pasta inválida.');
    const file = readFile(data, false);
    if (file) {
      // Nova versão: a atual vira histórico (substituída) e a nova herda os dados
      return tx(db, () => {
        db.prepare("UPDATE company_documents SET status = 'substituido', updated_at = ? WHERE id = ?").run(now, d.id);
        const id = insertDoc(db, user, { ...d, ...Object.fromEntries(Object.entries(m).filter(([, v]) => v != null)), title: m.title || d.title, folder_id: folder, version: d.version + 1, previous_id: d.id }, file, now);
        audit(db, user, 'document', id, 'nova_versao', { titulo: m.title || d.title, versao: d.version + 1 });
        return { id, version: d.version + 1 };
      });
    }
    const title = m.title || d.title;
    db.prepare('UPDATE company_documents SET folder_id = ?, title = ?, description = ?, doc_number = ?, issuer = ?, issue_date = ?, expires_at = ?, tags = ?, expiry_alerted_at = CASE WHEN ? IS NOT expires_at THEN NULL ELSE expiry_alerted_at END, updated_at = ? WHERE id = ?')
      .run(folder, title, m.description, m.doc_number, m.issuer, m.issue_date, m.expires_at, m.tags, m.expires_at, now, d.id);
    audit(db, user, 'document', d.id, 'alterado', { titulo: title, pasta: folder !== d.folder_id ? folder : undefined });
    return { id: d.id, version: d.version };
  }
  const folder = Number(data.folder_id);
  if (!folder || !db.prepare('SELECT 1 FROM doc_folders WHERE id = ?').get(folder)) throw badRequest('Escolha a pasta do documento.');
  const file = readFile(data);
  const id = insertDoc(db, user, { ...m, title: m.title || file.filename.replace(/\.[^.]+$/, ''), folder_id: folder, version: 1, previous_id: null }, file, now);
  audit(db, user, 'document', id, 'enviado', { titulo: m.title || file.filename, pasta: folder });
  return { id, version: 1 };
}

function insertDoc(db, user, d, file, now) {
  return Number(db.prepare(`INSERT INTO company_documents (folder_id, title, description, doc_number, issuer, issue_date, expires_at, tags, filename, mime, size, content, version, previous_id, status, uploaded_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ativo', ?, ?, ?)`).run(d.folder_id, d.title, d.description ?? null, d.doc_number ?? null, d.issuer ?? null, d.issue_date ?? null, d.expires_at ?? null, d.tags ?? null,
    file.filename, file.mime, file.size, file.content, d.version, d.previous_id ?? null, user.id, now, now).lastInsertRowid);
}

/** Detalhe do documento com o histórico de versões. */
function getDocument(db, user, id) {
  guard(user);
  const d = db.prepare(`SELECT ${DOC_COLS} FROM company_documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.id = ?`).get(Number(id));
  if (!d) throw notFound('Documento não encontrado.');
  const versions = [];
  let prev = d.previous_id;
  for (let i = 0; prev && i < 50; i += 1) {
    const v = db.prepare(`SELECT ${DOC_COLS} FROM company_documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.id = ?`).get(prev);
    if (!v) break;
    versions.push(v);
    prev = v.previous_id;
  }
  return { ...withExpiry(d), path: folderPath(db, d.folder_id), versions };
}

function download(db, user, id) {
  guard(user);
  const d = db.prepare('SELECT * FROM company_documents WHERE id = ?').get(Number(id));
  if (!d) throw notFound('Documento não encontrado.');
  audit(db, user, 'document', d.id, 'baixado', { titulo: d.title, versao: d.version });
  return d;
}

/** Arquiva (some da pasta, fica no banco) ou exclui de vez com todas as versões anteriores. */
function removeDocument(db, user, id, { permanent = false } = {}) {
  guard(user);
  const d = db.prepare('SELECT * FROM company_documents WHERE id = ?').get(Number(id));
  if (!d) throw notFound('Documento não encontrado.');
  if (!permanent) {
    db.prepare("UPDATE company_documents SET status = 'arquivado', updated_at = ? WHERE id = ?").run(nowIso(), d.id);
    audit(db, user, 'document', d.id, 'arquivado', { titulo: d.title });
    return { ok: true };
  }
  tx(db, () => {
    let cur = d;
    for (let i = 0; cur && i < 50; i += 1) {
      db.prepare('DELETE FROM company_documents WHERE id = ?').run(cur.id);
      cur = cur.previous_id ? db.prepare('SELECT * FROM company_documents WHERE id = ?').get(cur.previous_id) : null;
    }
  });
  audit(db, user, 'document', d.id, 'excluido', { titulo: d.title });
  return { ok: true };
}

/** Rotina diária: avisa o administrador dos documentos vencidos ou que vencem em até 30 dias (uma vez por documento). */
function expirySweep(db) {
  const rows = db.prepare("SELECT d.id, d.title, d.expires_at, f.name AS folder FROM company_documents d JOIN doc_folders f ON f.id = d.folder_id WHERE d.status = 'ativo' AND d.expires_at IS NOT NULL AND d.expires_at <= ? AND d.expiry_alerted_at IS NULL").all(addDays(30));
  if (!rows.length) return 0;
  const admins = db.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1").all().map((u) => u.id);
  for (const r of rows) {
    const late = r.expires_at < today();
    require('./notifications').notify(db, admins, { kind: 'documento_validade', level: late ? 'danger' : 'warn', title: `${late ? 'Documento vencido' : 'Documento vencendo'}: ${r.title}`, body: `${r.folder} · validade ${r.expires_at.split('-').reverse().join('/')}. Envie a versão atualizada na Central de documentos.`, link: '#/documentos' });
    db.prepare('UPDATE company_documents SET expiry_alerted_at = ? WHERE id = ?').run(nowIso(), r.id);
  }
  return rows.length;
}

module.exports = { browse, saveFolder, deleteFolder, saveDocument, getDocument, download, removeDocument, expirySweep };
