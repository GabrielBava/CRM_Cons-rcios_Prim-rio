'use strict';
/**
 * Treinamentos: materiais em PDF, vídeo, link ou texto, organizados por tema, com obrigatoriedade por perfil,
 * prazo, questionário de verificação (nota mínima) e acompanhamento de acesso e conclusão por usuário.
 */
const { requireAdmin, audit, ROLES } = require('../core');
const { badRequest, notFound, clean, nowIso } = require('../util');
const { tx } = require('../db');

const MAX_FILE = 15 * 1024 * 1024;
const parse = (v, fb) => {
  try {
    return JSON.parse(v || '');
  } catch {
    return fb;
  }
};

function normalizeQuiz(v) {
  const arr = typeof v === 'string' ? parse(v, []) : v;
  if (!Array.isArray(arr)) throw badRequest('Questionário inválido.');
  return arr
    .filter((q) => q && String(q.question || '').trim())
    .map((q, i) => {
      const options = (Array.isArray(q.options) ? q.options : []).map((o) => String(o || '').trim()).filter(Boolean);
      const correct = Number(q.correct);
      if (options.length < 2) throw badRequest(`Pergunta ${i + 1}: informe ao menos duas alternativas.`);
      if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) throw badRequest(`Pergunta ${i + 1}: marque a alternativa correta.`);
      return { question: String(q.question).trim(), options, correct };
    });
}

const LIST_COLS = 't.id, t.title, t.category, t.description, t.kind, t.video_url, t.file_name, t.file_size, t.required_roles, t.due_days, t.pass_score, t.duration_min, t.position, t.active, t.created_at, t.updated_at, t.quiz';

function decorate(t, progress, user) {
  const quiz = parse(t.quiz, []);
  const required = parse(t.required_roles, []);
  const p = progress || {};
  const due = t.due_days && required.includes(user.role) ? new Date(Date.parse(t.created_at) + t.due_days * 86400000).toISOString() : null;
  const { quiz: _q, ...rest } = t;
  return {
    ...rest,
    required_roles: required,
    required: required.includes(user.role),
    questions: quiz.length,
    progress: { opened_at: p.first_opened_at || null, last_opened_at: p.last_opened_at || null, open_count: p.open_count || 0, completed_at: p.completed_at || null, quiz_score: p.quiz_score ?? null, attempts: p.attempts || 0 },
    status: p.completed_at ? 'concluido' : p.first_opened_at ? 'em_andamento' : 'nao_iniciado',
    due_at: due,
    overdue: !!(due && !p.completed_at && Date.parse(due) < Date.now()),
  };
}

function listTrainings(db, user) {
  const rows = db.prepare(`SELECT ${LIST_COLS} FROM trainings t WHERE ${user.role === 'admin' ? '1=1' : 't.active = 1'} ORDER BY t.category, t.position, t.title`).all();
  const prog = db.prepare('SELECT * FROM training_progress WHERE user_id = ?').all(user.id);
  const items = rows.map((t) => decorate(t, prog.find((p) => p.training_id === t.id), user));
  const req = items.filter((t) => t.required && t.active);
  return {
    items,
    summary: {
      total: items.filter((t) => t.active).length,
      concluidos: items.filter((t) => t.active && t.status === 'concluido').length,
      obrigatorios: req.length,
      obrigatorios_pendentes: req.filter((t) => t.status !== 'concluido').length,
      atrasados: req.filter((t) => t.overdue).length,
    },
  };
}

function getTraining(db, user, id) {
  const t = db.prepare(`SELECT ${LIST_COLS}, t.content FROM trainings t WHERE t.id = ?`).get(Number(id));
  if (!t || (!t.active && user.role !== 'admin')) throw notFound('Treinamento não encontrado.');
  const now = nowIso();
  // Registra o acesso
  db.prepare(`INSERT INTO training_progress (training_id, user_id, first_opened_at, last_opened_at, open_count) VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(training_id, user_id) DO UPDATE SET last_opened_at = excluded.last_opened_at, open_count = open_count + 1`).run(t.id, user.id, now, now);
  const prog = db.prepare('SELECT * FROM training_progress WHERE training_id = ? AND user_id = ?').get(t.id, user.id);
  const out = decorate(t, prog, user);
  out.content = t.content;
  // As respostas corretas não vão para quem está fazendo o treinamento
  out.quiz = parse(t.quiz, []).map((q) => (user.role === 'admin' ? q : { question: q.question, options: q.options }));
  return out;
}

function getFile(db, user, id) {
  const t = db.prepare('SELECT id, active, file, file_name, file_mime FROM trainings WHERE id = ?').get(Number(id));
  if (!t || !t.file || (!t.active && user.role !== 'admin')) throw notFound('Arquivo não encontrado.');
  return t;
}

/** Conclui o treinamento. Com questionário, exige a nota mínima. */
function complete(db, user, id, data) {
  const t = db.prepare('SELECT * FROM trainings WHERE id = ? AND active = 1').get(Number(id));
  if (!t) throw notFound('Treinamento não encontrado.');
  const quiz = parse(t.quiz, []);
  const now = nowIso();
  let score = null;
  if (quiz.length) {
    const answers = Array.isArray(data.answers) ? data.answers : [];
    const right = quiz.filter((q, i) => Number(answers[i]) === q.correct).length;
    score = Math.round((right / quiz.length) * 100);
  }
  db.prepare(`INSERT INTO training_progress (training_id, user_id, first_opened_at, last_opened_at, open_count, attempts) VALUES (?, ?, ?, ?, 1, 0)
    ON CONFLICT(training_id, user_id) DO NOTHING`).run(t.id, user.id, now, now);
  db.prepare('UPDATE training_progress SET attempts = attempts + ?, quiz_score = COALESCE(?, quiz_score) WHERE training_id = ? AND user_id = ?').run(quiz.length ? 1 : 0, score, t.id, user.id);
  const passed = score == null || score >= t.pass_score;
  if (passed) db.prepare('UPDATE training_progress SET completed_at = COALESCE(completed_at, ?) WHERE training_id = ? AND user_id = ?').run(now, t.id, user.id);
  audit(db, user, 'training', t.id, passed ? 'concluido' : 'reprovado_no_questionario', { nota: score });
  return { passed, score, pass_score: t.pass_score };
}

function saveTraining(db, user, data) {
  requireAdmin(user);
  const o = {};
  for (const f of ['title', 'category', 'description', 'content', 'video_url']) if (data[f] !== undefined) o[f] = clean(data[f]);
  if (!data.id && !o.title) throw badRequest('Informe o título do treinamento.');
  if (data.kind !== undefined) {
    if (!['pdf', 'video', 'texto', 'link'].includes(data.kind)) throw badRequest('Tipo de material inválido.');
    o.kind = data.kind;
  }
  if (o.category && !db.prepare("SELECT 1 FROM options WHERE list = 'categoria_treinamento' AND value = ?").get(o.category)) throw badRequest('Tema inválido.');
  if (o.video_url && !/^https?:\/\//i.test(o.video_url)) throw badRequest('Link do vídeo inválido (use http:// ou https://).');
  if (data.required_roles !== undefined) {
    const roles = (Array.isArray(data.required_roles) ? data.required_roles : []).filter((r) => ROLES[r]);
    o.required_roles = JSON.stringify(roles);
  }
  for (const f of ['due_days', 'duration_min', 'pass_score', 'position']) {
    if (data[f] !== undefined) {
      const n = data[f] === '' || data[f] == null ? null : Number(data[f]);
      if (n != null && (!Number.isInteger(n) || n < 0)) throw badRequest('Valores numéricos inválidos.');
      o[f] = f === 'pass_score' ? Math.min(100, n ?? 70) : f === 'position' ? n ?? 0 : n;
    }
  }
  if (data.quiz !== undefined) o.quiz = JSON.stringify(normalizeQuiz(data.quiz));
  if (data.active !== undefined) o.active = data.active ? 1 : 0;
  if (data.content_base64) {
    const name = clean(data.file_name) || 'material.pdf';
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (!['pdf', 'png', 'jpg', 'jpeg', 'pptx', 'docx'].includes(ext)) throw badRequest('Envie o material em PDF (ou imagem/apresentação).');
    const buf = Buffer.from(String(data.content_base64).replace(/^data:[^,]*,/, ''), 'base64');
    if (!buf.length) throw badRequest('Arquivo vazio.');
    if (buf.length > MAX_FILE) throw badRequest('Arquivo maior que 15 MB.');
    Object.assign(o, { file: buf, file_name: name.slice(0, 200), file_mime: ext === 'pdf' ? 'application/pdf' : clean(data.file_mime) || 'application/octet-stream', file_size: buf.length });
  }
  const now = nowIso();
  if (data.id) {
    const t = db.prepare('SELECT id FROM trainings WHERE id = ?').get(Number(data.id));
    if (!t) throw notFound();
    const keys = Object.keys(o);
    if (keys.length) db.prepare(`UPDATE trainings SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => o[k] ?? null), now, t.id);
    audit(db, user, 'training', t.id, 'alterado', { campos: keys.filter((k) => k !== 'file') });
    return t.id;
  }
  const row = { kind: 'texto', required_roles: '[]', quiz: '[]', ...o, created_by: user.id, created_at: now, updated_at: now };
  const cols = Object.keys(row);
  const r = db.prepare(`INSERT INTO trainings (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c] ?? null));
  audit(db, user, 'training', Number(r.lastInsertRowid), 'criado', { titulo: o.title });
  return Number(r.lastInsertRowid);
}

/** Acompanhamento (administrador): situação de cada usuário em cada treinamento. */
function tracking(db, user) {
  requireAdmin(user);
  const trainings = db.prepare('SELECT id, title, category, required_roles, due_days, created_at FROM trainings WHERE active = 1 ORDER BY category, position, title').all();
  const users = db.prepare("SELECT id, name, role FROM users WHERE active = 1 AND role <> 'admin' ORDER BY name").all();
  const prog = db.prepare('SELECT * FROM training_progress').all();
  return {
    trainings: trainings.map((t) => ({ id: t.id, title: t.title, category: t.category, required_roles: parse(t.required_roles, []) })),
    users: users.map((u) => {
      const cells = trainings.map((t) => {
        const p = prog.find((x) => x.training_id === t.id && x.user_id === u.id);
        const req = parse(t.required_roles, []).includes(u.role);
        return { training_id: t.id, required: req, status: p?.completed_at ? 'concluido' : p?.first_opened_at ? 'em_andamento' : 'nao_iniciado', score: p?.quiz_score ?? null, last_opened_at: p?.last_opened_at || null };
      });
      const req = cells.filter((c) => c.required);
      return { id: u.id, name: u.name, role: u.role, cells, done: cells.filter((c) => c.status === 'concluido').length, required: req.length, required_done: req.filter((c) => c.status === 'concluido').length };
    }),
  };
}

/** Treinamentos obrigatórios pendentes do usuário (painel inicial). */
function pendingFor(db, user) {
  return listTrainings(db, user).items.filter((t) => t.active && t.required && t.status !== 'concluido').map((t) => ({ id: t.id, title: t.title, overdue: t.overdue, due_at: t.due_at }));
}

module.exports = { listTrainings, getTraining, getFile, complete, saveTraining, tracking, pendingFor };
