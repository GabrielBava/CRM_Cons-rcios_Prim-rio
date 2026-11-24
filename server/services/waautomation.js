'use strict';
/**
 * Avisos por WhatsApp para o responsável: novo lead no CRM e R1 agendada.
 *
 * O aviso entra numa fila (wa_automation_log) junto com o evento (cadastro, distribuição, agendamento) e é enviado logo
 * depois da requisição (e pelas rotinas, que tentam de novo as falhas), pelo número do WhatsApp Lite escolhido, para o
 * WhatsApp do responsável (Meu perfil › WhatsApp comercial, ou o telefone). Os modelos têm variáveis {{assim}}.
 */
const { getSetting, setSetting } = require('../db');
const { audit, optionLabel } = require('../core');
const { badRequest, forbidden, nowIso } = require('../util');

const TZ = 'America/Sao_Paulo';
const DEFAULT_NEW_LEAD = '🚨 *NOVO LEAD NO CRM!*\n\n*Nome:* {{nome_lead}}\n*Origem:* {{origem}}\n*Campanha:* {{campanha}}';
const DEFAULT_R1 = '📅 *NOVA R1 AGENDADA!*\n\n*Lead:* {{nome_lead}}\n*Data:* {{data_reuniao}}\n*Horário:* {{horario_reuniao}}\n🔗 *Link da Call:* {{link_reuniao}}';
// rev 2: o responsável recebe o aviso mesmo quando ele próprio cadastrou o lead ou agendou a reunião, e a R2 também avisa
const REV = 2;
const DEFAULTS = {
  rev: REV,
  enabled: false,
  instance_id: null,
  skip_self: false,
  new_lead: { enabled: true, template: DEFAULT_NEW_LEAD },
  r1: { enabled: true, r2: true, template: DEFAULT_R1 },
};
const KINDS = { novo_lead: 'Novo lead', r1_agendada: 'R1 agendada', novo_lead_teste: 'Teste · novo lead', r1_agendada_teste: 'Teste · R1 agendada' };
const VARS = {
  novo_lead: [['nome_lead', 'nome do lead'], ['origem', 'origem'], ['campanha', 'campanha'], ['origem_campanha', 'origem · campanha'], ['telefone_lead', 'telefone do lead'], ['responsavel', 'responsável'], ['link_lead', 'link do lead no CRM']],
  r1_agendada: [['nome_lead', 'nome do lead'], ['data_reuniao', 'data'], ['horario_reuniao', 'horário'], ['link_reuniao', 'link da call'], ['tipo_reuniao', 'R1 ou R2'], ['telefone_lead', 'telefone do lead'], ['responsavel', 'responsável'], ['link_lead', 'link do lead no CRM']],
};
const STATUS_LABEL = {
  pendente: 'Na fila', enviando: 'Enviando', enviada: 'Enviada', simulada: 'Enviada (modo de teste)', falhou: 'Falhou', sem_numero: 'Responsável sem WhatsApp no perfil',
  sem_canal: 'Sem número para enviar', ignorado: 'Não enviado: o próprio responsável fez a ação (opção marcada)',
};
const MAX_TRIES = 3;

const isLead = (u) => u.role === 'admin' || u.role === 'gestor';
const digits = (v) => String(v || '').replace(/\D/g, '');

function config(db) {
  const s = { ...(getSetting(db, 'wa_automations') || {}) };
  // Configuração da primeira versão: passa a avisar também o próprio responsável e a R2 (pedido da Vero)
  if ((s.rev || 1) < REV) {
    delete s.skip_self;
    if (s.r1) s.r1 = { ...s.r1, r2: true };
  }
  return {
    ...DEFAULTS,
    ...s,
    rev: REV,
    new_lead: { ...DEFAULTS.new_lead, ...(s.new_lead || {}) },
    r1: { ...DEFAULTS.r1, ...(s.r1 || {}) },
  };
}

/** Número do WhatsApp Lite que envia: o escolhido; senão o número central do agente de IA; senão o primeiro conectado. */
function senderInstance(db, cfg = config(db)) {
  const pick = (id) => (id ? db.prepare('SELECT * FROM wa_instances WHERE id = ?').get(Number(id)) : null);
  return pick(cfg.instance_id)
    || pick(getSetting(db, 'wa_agent')?.instance_id)
    || db.prepare("SELECT * FROM wa_instances WHERE status = 'conectado' ORDER BY id LIMIT 1").get()
    || null;
}

/** Número no formato do WhatsApp (55 + DDD + número), aceitando +55, 0 + DDD e espaços. */
function waNumber(v) {
  let d = digits(v).replace(/^0+/, '');
  if (d.length > 11 && d.startsWith('55')) return d.length <= 13 ? d : null;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return null;
}
/** WhatsApp do usuário: o WhatsApp comercial de Meu perfil; sem ele, o telefone. */
function userNumber(db, userId) {
  const u = db.prepare('SELECT whatsapp, phone FROM users WHERE id = ?').get(Number(userId));
  return waNumber(u?.whatsapp) || waNumber(u?.phone);
}
/** Mesmo número (com e sem o nono dígito). */
const sameNumber = (a, b) => {
  const c = require('./whatsapp').waCandidates(digits(a));
  return !!b && c.includes(digits(b));
};

const fill = (template, vars) => String(template || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k) => (vars[k.toLowerCase()] ?? m));

function crmLink(db, contactId) {
  const base = String(process.env.PUBLIC_URL || getSetting(db, 'public_url') || '').replace(/\/+$/, '');
  return base ? `${base}/#/leads/${contactId}` : `#/leads/${contactId}`;
}

function leadVars(db, contactId) {
  const c = db.prepare('SELECT c.*, u.name AS owner_name FROM contacts c LEFT JOIN users u ON u.id = c.owner_id WHERE c.id = ?').get(Number(contactId));
  if (!c) return null;
  const campaign = db.prepare('SELECT COALESCE(campaign_name, utm_campaign) AS n FROM contact_origins WHERE contact_id = ? AND COALESCE(campaign_name, utm_campaign) IS NOT NULL ORDER BY id DESC LIMIT 1').get(c.id)?.n || c.campaign || '';
  const origin = optionLabel(db, 'origem', c.origin) || c.origin || 'Não informada';
  const phone = digits(c.whatsapp || c.phone1 || c.phone2);
  const local = phone.length > 11 && phone.startsWith('55') ? phone.slice(2) : phone;
  return {
    nome_lead: c.name,
    origem: origin,
    campanha: campaign || 'Sem campanha',
    origem_campanha: campaign ? `${origin} · ${campaign}` : origin,
    telefone_lead: local.length === 11 ? `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}` : local.length === 10 ? `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}` : (phone || 'Sem telefone'),
    responsavel: c.owner_name || 'Sem responsável',
    link_lead: crmLink(db, c.id),
  };
}

function meetingVars(db, taskId) {
  const t = db.prepare('SELECT t.*, u.name AS assigned_name FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to WHERE t.id = ?').get(Number(taskId));
  if (!t) return null;
  const at = new Date(t.due_at);
  const end = t.ends_at ? new Date(t.ends_at) : null;
  const hm = (d) => d.toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  return {
    ...(t.contact_id ? leadVars(db, t.contact_id) : {}),
    data_reuniao: at.toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'long', day: '2-digit', month: '2-digit' }).replace(/^./, (x) => x.toUpperCase()),
    horario_reuniao: end ? `${hm(at)} às ${hm(end)}` : hm(at),
    link_reuniao: t.meeting_url || 'a definir (sem link de videochamada)',
    tipo_reuniao: (t.meeting_kind || 'r1').toUpperCase(),
    responsavel: t.assigned_name || 'Sem responsável',
  };
}

/**
 * Coloca o aviso na fila (chamado dentro do evento, sem rede). Não avisa quando o próprio responsável fez a ação
 * (opção), não repete o mesmo aviso para a mesma pessoa e registra quando falta o WhatsApp do responsável.
 */
function enqueue(db, kind, { contactId = null, taskId = null, userId, byUserId = null } = {}) {
  try {
    const cfg = config(db);
    if (!cfg.enabled || !userId) return null;
    if (kind === 'novo_lead' && !cfg.new_lead.enabled) return null;
    if (kind === 'r1_agendada' && !cfg.r1.enabled) return null;
    let vars;
    if (kind === 'r1_agendada') {
      const t = db.prepare('SELECT meeting_kind FROM tasks WHERE id = ?').get(Number(taskId));
      if (!t || ((t.meeting_kind || 'r1') === 'r2' && !cfg.r1.r2)) return null;
      vars = meetingVars(db, taskId);
    } else vars = leadVars(db, contactId);
    if (!vars) return null;
    const dup = kind === 'r1_agendada'
      ? db.prepare('SELECT 1 FROM wa_automation_log WHERE kind = ? AND task_id = ? AND user_id = ?').get(kind, Number(taskId), Number(userId))
      : db.prepare('SELECT 1 FROM wa_automation_log WHERE kind = ? AND contact_id = ? AND user_id = ?').get(kind, Number(contactId), Number(userId));
    if (dup) return null;
    const body = fill(kind === 'r1_agendada' ? cfg.r1.template : cfg.new_lead.template, vars).trim();
    const phone = userNumber(db, userId);
    // Opção "não avisar quando o próprio responsável fez a ação": fica registrado, para ninguém achar que falhou
    const self = cfg.skip_self && byUserId && Number(byUserId) === Number(userId);
    const status = self ? 'ignorado' : phone ? 'pendente' : 'sem_numero';
    const r = db.prepare('INSERT INTO wa_automation_log (kind, contact_id, task_id, user_id, phone, body, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(kind, contactId ? Number(contactId) : null, taskId ? Number(taskId) : null, Number(userId), phone, body, status, nowIso());
    return Number(r.lastInsertRowid);
  } catch (e) {
    // O aviso nunca impede o cadastro ou o agendamento
    console.error('Aviso por WhatsApp não entrou na fila:', e.message);
    return null;
  }
}

/** Envia os avisos da fila (e tenta de novo, até 3 vezes nas últimas 6 horas, os que falharam). */
async function flush(db, { limit = 10 } = {}) {
  const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const stuck = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const has = db.prepare(`SELECT 1 FROM wa_automation_log WHERE status = 'pendente'
    OR (status = 'falhou' AND attempts < ? AND created_at >= ?) OR (status = 'enviando' AND sent_at < ?) LIMIT 1`).get(MAX_TRIES, since, stuck);
  if (!has) return 0;
  const rows = db.prepare(`SELECT * FROM wa_automation_log WHERE status = 'pendente'
    OR (status = 'falhou' AND attempts < ? AND created_at >= ?) OR (status = 'enviando' AND sent_at < ?) ORDER BY id LIMIT ?`).all(MAX_TRIES, since, stuck, limit);
  const walite = require('./walite');
  const inst = senderInstance(db);
  let sent = 0;
  for (const row of rows) {
    // Uma instância por vez cuida de cada aviso
    const claimed = db.prepare("UPDATE wa_automation_log SET status = 'enviando', attempts = attempts + 1, sent_at = ? WHERE id = ? AND status = ?").run(nowIso(), row.id, row.status).changes;
    if (!claimed) continue;
    try {
      if (!inst) throw Object.assign(new Error('Nenhum número do WhatsApp Lite conectado para enviar os avisos.'), { final: true });
      const r = await walite.sendSystemText(db, inst.id, row.phone, row.body);
      db.prepare('UPDATE wa_automation_log SET status = ?, wamid = ?, error = NULL, sent_at = ? WHERE id = ?').run(r.simulated ? 'simulada' : 'enviada', r.wamid || null, nowIso(), row.id);
      sent++;
    } catch (e) {
      db.prepare('UPDATE wa_automation_log SET status = ?, error = ? WHERE id = ?').run(e.final ? 'sem_canal' : 'falhou', String(e.message).slice(0, 300), row.id);
    }
  }
  return sent;
}

/** Mensagem que o próprio CRM mandou como aviso (o conector devolve como mensagem enviada): não vira conversa de lead. */
function isOwnNotice(db, wamid, peerCands, text) {
  if (wamid && db.prepare('SELECT 1 FROM wa_automation_log WHERE wamid = ?').get(String(wamid))) return true;
  if (!text || !peerCands?.length) return false;
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  return !!db.prepare(`SELECT 1 FROM wa_automation_log WHERE phone IN (${peerCands.map(() => '?').join(',')}) AND body = ? AND created_at >= ? LIMIT 1`).get(...peerCands, String(text).trim(), since);
}

function view(db, user) {
  if (!isLead(user)) throw forbidden('Os avisos por WhatsApp são configurados pela liderança.');
  const cfg = config(db);
  const inst = senderInstance(db, cfg);
  const instances = db.prepare("SELECT id, name, phone, status FROM wa_instances ORDER BY status = 'conectado' DESC, name").all()
    .map((i) => ({ id: i.id, label: `${i.name}${i.phone ? ` · ${i.phone}` : ''}${i.status === 'conectado' ? '' : ' (desconectado)'}`, connected: i.status === 'conectado' }));
  const team = db.prepare("SELECT id, name, role, whatsapp, phone FROM users WHERE active = 1 AND role IN ('consultor','gestor','admin') ORDER BY name").all()
    .map((u) => {
      const number = waNumber(u.whatsapp) || waNumber(u.phone);
      return { id: u.id, name: u.name, number, source: waNumber(u.whatsapp) ? 'WhatsApp comercial' : number ? 'telefone' : null, same_as_sender: !!(number && inst?.phone && sameNumber(number, inst.phone)) };
    });
  const missing = team.filter((u) => !u.number).map((u) => ({ id: u.id, name: u.name }));
  const recent = db.prepare(`SELECT l.id, l.kind, l.status, l.error, l.created_at, l.sent_at, u.name AS user_name, c.name AS contact_name
    FROM wa_automation_log l LEFT JOIN users u ON u.id = l.user_id LEFT JOIN contacts c ON c.id = l.contact_id ORDER BY l.id DESC LIMIT 15`).all()
    .map((r) => ({ ...r, kind_label: KINDS[r.kind] || r.kind, status_label: STATUS_LABEL[r.status] || r.status }));
  return {
    config: cfg, can_edit: user.role === 'admin', instances, sender: inst ? { id: inst.id, name: inst.name, phone: inst.phone, connected: inst.status === 'conectado' } : null,
    recipients: team, users_without_number: missing, recent, vars: VARS, defaults: { new_lead: DEFAULT_NEW_LEAD, r1: DEFAULT_R1 },
  };
}

function save(db, user, data = {}) {
  if (user.role !== 'admin') throw forbidden('Só o administrador configura os avisos por WhatsApp.');
  const c = config(db);
  const next = { ...c, new_lead: { ...c.new_lead }, r1: { ...c.r1 } };
  if (data.enabled !== undefined) next.enabled = !!data.enabled;
  if (data.skip_self !== undefined) next.skip_self = !!data.skip_self;
  if (data.instance_id !== undefined) {
    const id = data.instance_id ? Number(data.instance_id) : null;
    if (id && !db.prepare('SELECT 1 FROM wa_instances WHERE id = ?').get(id)) throw badRequest('Número de envio inválido.');
    next.instance_id = id;
  }
  const tpl = (v, label) => {
    const t = String(v ?? '').trim();
    if (!t) throw badRequest(`Escreva o modelo do aviso de ${label}.`);
    if (t.length > 1000) throw badRequest(`O modelo do aviso de ${label} pode ter até 1.000 caracteres.`);
    return t;
  };
  if (data.new_lead) {
    if (data.new_lead.enabled !== undefined) next.new_lead.enabled = !!data.new_lead.enabled;
    if (data.new_lead.template !== undefined) next.new_lead.template = tpl(data.new_lead.template, 'novo lead');
  }
  if (data.r1) {
    if (data.r1.enabled !== undefined) next.r1.enabled = !!data.r1.enabled;
    if (data.r1.r2 !== undefined) next.r1.r2 = !!data.r1.r2;
    if (data.r1.template !== undefined) next.r1.template = tpl(data.r1.template, 'R1 agendada');
  }
  setSetting(db, 'wa_automations', next);
  audit(db, user, 'integration', null, 'avisos_whatsapp', { enabled: next.enabled, novo_lead: next.new_lead.enabled, r1: next.r1.enabled });
  return view(db, user);
}

/** Envia agora para o WhatsApp de quem está testando um exemplo do aviso (com dados de exemplo). */
async function sendTest(db, user, data = {}) {
  if (user.role !== 'admin') throw forbidden('Só o administrador testa os avisos por WhatsApp.');
  const kind = data.kind === 'r1_agendada' ? 'r1_agendada' : 'novo_lead';
  const cfg = config(db);
  const phone = userNumber(db, user.id);
  if (!phone) throw badRequest('Cadastre o seu WhatsApp em Meu perfil para receber o teste.');
  const inst = senderInstance(db, cfg);
  if (!inst) throw badRequest('Conecte um número no WhatsApp Lite para enviar os avisos.');
  const sample = {
    nome_lead: 'Maria Exemplo', origem: 'Landing page', campanha: 'Consórcio Imóvel', origem_campanha: 'Landing page · Consórcio Imóvel', telefone_lead: '(51) 99999-0000',
    responsavel: user.name, link_lead: crmLink(db, 0), data_reuniao: 'Segunda-feira, 01/12', horario_reuniao: '10:00 às 10:45', link_reuniao: 'https://meet.google.com/abc-defg-hij', tipo_reuniao: 'R1',
  };
  const template = data.template !== undefined ? String(data.template) : kind === 'r1_agendada' ? cfg.r1.template : cfg.new_lead.template;
  const body = fill(template, sample).trim();
  const r = await require('./walite').sendSystemText(db, inst.id, phone, body);
  db.prepare('INSERT INTO wa_automation_log (kind, user_id, phone, body, status, wamid, attempts, created_at, sent_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)')
    .run(`${kind}_teste`, user.id, phone, body, r.simulated ? 'simulada' : 'enviada', r.wamid || null, nowIso(), nowIso());
  return { ok: true, simulated: !!r.simulated, to: phone, body };
}

module.exports = { config, enqueue, flush, isOwnNotice, view, save, sendTest, fill, waNumber, DEFAULT_NEW_LEAD, DEFAULT_R1 };
