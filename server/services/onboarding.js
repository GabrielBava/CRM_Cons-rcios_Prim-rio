'use strict';
/**
 * Trilha de integração (onboarding) do novo especialista.
 *
 * Ao ser cadastrado pelo administrador, o usuário recebe uma senha provisória e, no primeiro acesso, é obrigado a
 * trocá-la antes de usar a plataforma. O especialista segue então a trilha no Painel inicial:
 *   1. Trocar a senha de acesso (automático)
 *   2. Completar Meu cadastro: foto, WhatsApp e cargo (automático) — usados no modelo da R1
 *   3. Conhecer a Vero: posicionamento, como queremos ser vistos, cores e tipografia
 *   4. Kit do especialista: documento com a configuração do WhatsApp Business e do LinkedIn (capa com o logo da Vero)
 *   5. Treinamento de consórcios: liberado em Treinamentos depois das etapas anteriores (trilha "consorcios")
 */
const { audit } = require('../core');
const { HttpError, badRequest, nowIso } = require('../util');

const STEPS = [
  ['senha', 'Trocar a senha de acesso', 'Por segurança, a senha provisória precisa ser trocada no primeiro acesso.'],
  ['perfil', 'Completar Meu cadastro', 'Foto, WhatsApp comercial e cargo: aparecem no modelo da R1 e nas propostas.'],
  ['marca', 'Conhecer a Vero', 'Posicionamento, como a Vero quer ser vista, cores e tipografia.'],
  ['configuracao', 'Kit do especialista', 'Documento com a configuração do WhatsApp Business e do LinkedIn (capa com o logo da Vero).'],
  ['consorcios', 'Treinamento de consórcios', 'Cultura, o que é consórcio, metodologia de reuniões, modelo da R1, agendamento e follow-up.'],
];
const MANUAL = new Set(['marca', 'configuracao']);
/** Trilha de treinamentos liberada na etapa 5 (campo trainings.track). */
const TRACK = 'consorcios';

const parse = (v) => {
  try {
    return JSON.parse(v || '{}') || {};
  } catch {
    return {};
  }
};

function trackTrainings(db) {
  return db.prepare("SELECT id, title FROM trainings WHERE track = ? AND active = 1 ORDER BY position, id").all(TRACK);
}

/** Situação da trilha do usuário. */
function status(db, user) {
  const u = db.prepare('SELECT id, name, role, photo, whatsapp, job_title, must_change_password, password_changed_at, onboarding FROM users WHERE id = ?').get(user.id);
  const ob = parse(u.onboarding);
  const trainings = trackTrainings(db);
  const done = new Set(db.prepare(`SELECT training_id FROM training_progress WHERE user_id = ? AND completed_at IS NOT NULL`).all(u.id).map((r) => r.training_id));
  const auto = {
    senha: u.must_change_password ? null : ob.steps?.senha || u.password_changed_at || ob.started_at || null,
    perfil: u.photo && u.whatsapp && u.job_title ? ob.steps?.perfil || 'ok' : null,
    consorcios: trainings.length && trainings.every((t) => done.has(t.id)) ? ob.steps?.consorcios || 'ok' : null,
  };
  let blocked = false;
  const steps = STEPS.map(([key, title, hint]) => {
    const doneAt = key in auto ? auto[key] : ob.steps?.[key] || null;
    const locked = blocked;
    if (!doneAt) blocked = true;
    return { key, title, hint, done: !!doneAt, done_at: doneAt && doneAt !== 'ok' ? doneAt : null, locked, manual: MANUAL.has(key) };
  });
  const unlocked = !ob.active || steps.slice(0, 4).every((s) => s.done);
  return {
    active: !!ob.active,
    must_change_password: !!u.must_change_password,
    steps,
    done: steps.filter((s) => s.done).length,
    total: steps.length,
    complete: steps.every((s) => s.done),
    trainings_unlocked: unlocked,
    trainings: trainings.map((t) => ({ ...t, completed: done.has(t.id) })),
  };
}

function save(db, userId, ob) {
  db.prepare('UPDATE users SET onboarding = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(ob), nowIso(), userId);
}

/** Conclui uma etapa manual (marca, kit). As etapas seguem a ordem da trilha. */
function completeStep(db, user, key) {
  if (!MANUAL.has(key)) throw badRequest('Esta etapa é concluída automaticamente.');
  const st = status(db, user);
  const step = st.steps.find((s) => s.key === key);
  if (step.locked) throw badRequest('Conclua as etapas anteriores da trilha primeiro.');
  const u = db.prepare('SELECT onboarding FROM users WHERE id = ?').get(user.id);
  const ob = parse(u.onboarding);
  ob.steps = { ...(ob.steps || {}), [key]: ob.steps?.[key] || nowIso() };
  save(db, user.id, ob);
  audit(db, user, 'user', user.id, 'integracao_etapa', { etapa: key });
  const after = status(db, user);
  if (after.trainings_unlocked && !st.trainings_unlocked && after.active) {
    require('./notifications').notify(db, user.id, { kind: 'treinamento', title: 'Treinamento de consórcios liberado', body: 'Acesse em Treinamentos e conclua a trilha do especialista Vero.', link: '#/treinamentos' });
  }
  return after;
}

/** Ao concluir um treinamento: fecha a trilha quando todos os da etapa 5 estiverem concluídos e avisa a liderança. */
function afterTrainingComplete(db, user) {
  const u = db.prepare('SELECT onboarding, team_id FROM users WHERE id = ?').get(user.id);
  const ob = parse(u.onboarding);
  if (!ob.active || ob.completed_at) return;
  const st = status(db, user);
  if (!st.complete) return;
  ob.completed_at = nowIso();
  ob.steps = { ...(ob.steps || {}), consorcios: ob.completed_at };
  save(db, user.id, ob);
  const leaders = db.prepare("SELECT id FROM users WHERE active = 1 AND (role = 'admin' OR (role = 'gestor' AND (team_id = ? OR ? IS NULL)))").all(u.team_id ?? null, u.team_id ?? null).map((r) => r.id);
  require('./notifications').notify(db, leaders, { kind: 'treinamento', title: `${user.name} concluiu a integração`, body: 'Senha, cadastro, marca Vero, kit do especialista e treinamento de consórcios concluídos.', link: '#/treinamentos' });
}

/** Treinamentos da trilha ficam ocultos para quem ainda não liberou a etapa 5. */
function hiddenTrainingIds(db, user) {
  const st = status(db, user);
  if (st.trainings_unlocked) return new Set();
  return new Set(trackTrainings(db).map((t) => t.id));
}

/** Rotas liberadas enquanto o usuário não troca a senha provisória. */
const PASSWORD_PENDING_OK = new Set(['GET /api/meta', 'GET /api/me', 'POST /api/me/senha', 'POST /api/logout', 'GET /api/perfil', 'GET /api/integracao', 'GET /api/notificacoes']);
function assertPasswordChanged(user, method, path) {
  if (!user?.must_change_password) return;
  if (PASSWORD_PENDING_OK.has(`${method} ${path}`)) return;
  throw new HttpError(403, 'Troque a senha provisória para continuar.', { code: 'troca_senha' });
}

module.exports = { STEPS, TRACK, status, completeStep, afterTrainingComplete, hiddenTrainingIds, assertPasswordChanged };
