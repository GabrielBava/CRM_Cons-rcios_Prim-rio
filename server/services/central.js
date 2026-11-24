'use strict';
/**
 * Central de agendas e tarefas do especialista: tudo o que ele precisa fazer numa fila só, por ordem de urgência
 * (atrasadas primeiro, da mais estourada para a menos; depois as próximas, da mais próxima para a mais distante).
 *
 * Junta:
 *  - as tarefas pendentes (ligações e retornos, follow-up de proposta, pré-venda, documentação…);
 *  - o que as reuniões pedem: confirmar a R1/R2 com o cliente, registrar o resultado da reunião que já passou,
 *    o follow-up depois da reunião realizada e a remarcação de quem não compareceu;
 *  - as conversas do WhatsApp esperando resposta do especialista.
 * Cada item traz a mensagem pronta para o WhatsApp e as ações que o concluem (enviar, ligar, registrar).
 */
const { visibleOwnerIds, loadContact } = require('../core');
const { getSetting } = require('../db');
const { badRequest, forbidden, clean, nowIso } = require('../util');

const TZ = 'America/Sao_Paulo';
const H = 3600 * 1000;
const CATS = {
  whatsapp: 'Retorno de WhatsApp',
  confirmacao: 'Confirmação de R1/R2',
  resultado: 'Resultado da reunião',
  follow_reuniao: 'Follow-up de reunião',
  follow_proposta: 'Follow-up de proposta',
  ligacao: 'Ligações pendentes',
  reuniao: 'Reuniões',
  tarefa: 'Outras tarefas',
};
const CALL_TYPES = ['primeiro_contato', 'ligar', 'retorno', 'follow_up'];
const PROPOSAL_TYPES = ['follow_up_proposta', 'enviar_proposta'];
const CONTACT_ACTS = ['ligacao_realizada', 'tentativa_sem_atendimento', 'mensagem_enviada', 'mensagem_recebida', 'email_enviado', 'direct_enviado', 'linkedin_enviado'];
const isLead = (u) => u.role === 'admin' || u.role === 'gestor';
const first = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const digits = (v) => String(v || '').replace(/\D/g, '');

/** Quem entra na fila: o próprio usuário; o líder pode ver um especialista do time ou a equipe toda. */
function scopeOwners(db, user, q) {
  const vis = visibleOwnerIds(db, user);
  if (q.assigned_to === 'todos') {
    if (!isLead(user)) throw forbidden('Só a liderança vê a fila da equipe.');
    return vis;
  }
  const id = q.assigned_to ? Number(q.assigned_to) : user.id;
  if (vis && !vis.includes(id)) throw forbidden('Esse especialista não é do seu time.');
  return [id];
}
const inList = (col, ids) => (ids === null ? { sql: '1=1', params: [] } : { sql: `${col} IN (${ids.map(() => '?').join(',') || 'NULL'})`, params: ids });

function dayText(iso, now = new Date()) {
  const d = new Date(iso);
  const key = (x) => x.toLocaleDateString('pt-BR', { timeZone: TZ });
  if (key(d) === key(now)) return 'hoje';
  if (key(d) === key(new Date(now.getTime() + 24 * H))) return 'amanhã';
  if (key(d) === key(new Date(now.getTime() - 24 * H))) return 'ontem';
  return d.toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'long', day: '2-digit', month: '2-digit' }).replace(/^(\S+)/, 'na $1').replace(/^na (sábado|domingo)/, 'no $1');
}
const hm = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

/** Endereço público do CRM para os links (proposta). */
const publicBase = (db, req) => require('./meetings').publicUrl(db, req);

function proposalText(db, user, t, req) {
  if (!t.proposal_id) return null;
  try {
    const tp = require('./proposals').whatsappTemplates(db, user, t.proposal_id);
    const step = tp.steps.find((s) => s.step === String(t.cadence_step || '').toUpperCase()) || tp.steps.find((s) => s.step === tp.current) || tp.steps[0];
    const url = tp.link?.token ? `${publicBase(db, req)}/#/proposta/${tp.link.token}` : null;
    return url ? step.text.replace(/\{link\}/g, url) : step.text.replace(/\s*[^.!?\n]*\{link\}[^.!?\n]*[.!?]?/g, '').trim();
  } catch {
    return null;
  }
}

function central(db, user, q = {}, req = null) {
  const owners = scopeOwners(db, user, q);
  const days = Math.min(Math.max(Number(q.dias) || 7, 1), 31);
  const now = new Date();
  const nowIs = now.toISOString();
  const horizon = new Date(now.getTime() + days * 24 * H).toISOString();
  const company = getSetting(db, 'company_name') || 'Vero Consórcios';
  const items = [];
  const push = (it) => items.push({ ...it, category_label: CATS[it.category], overdue: new Date(it.due_at) < now });
  const sp = (name) => first(name) || first(user.name);
  const hi = (c, esp) => `Olá, ${first(c.contact_name) || 'tudo bem'}! Aqui é ${sp(esp)}, da ${company}.`;
  const phoneOf = (r) => digits(r.contact_whatsapp || r.contact_phone1 || r.contact_phone2) || null;

  // 1) Tarefas pendentes (reuniões à parte)
  const own = inList('t.assigned_to', owners);
  const tasks = db.prepare(`SELECT t.*, c.name AS contact_name, c.whatsapp AS contact_whatsapp, c.phone1 AS contact_phone1, c.phone2 AS contact_phone2, c.optouts AS contact_optouts,
      u.name AS assigned_name, s.name AS stage_name
    FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id LEFT JOIN users u ON u.id = t.assigned_to
    LEFT JOIN opportunities o ON o.id = t.opportunity_id LEFT JOIN pipeline_stages s ON s.id = o.stage_id
    WHERE t.status = 'pendente' AND t.due_at <= ? AND ${own.sql} ORDER BY t.due_at`).all(horizon, ...own.params);
  for (const t of tasks) {
    const base = {
      task_id: t.id, contact_id: t.contact_id, contact_name: t.contact_name, phone: phoneOf(t), opportunity_id: t.opportunity_id, stage_name: t.stage_name,
      assigned_to: t.assigned_to, assigned_name: t.assigned_name, priority: t.priority || 'normal', notes: t.notes || null, task_type: t.type,
      optouts: JSON.parse(t.contact_optouts || '[]'),
    };
    if (t.type === 'reuniao') {
      const K = (t.meeting_kind || 'r1').toUpperCase();
      const end = t.ends_at || new Date(Date.parse(t.due_at) + H).toISOString();
      const meeting = { id: t.id, kind: t.meeting_kind || 'r1', at: t.due_at, ends_at: t.ends_at, url: t.meeting_url || null, confirmed_at: t.confirmed_at || null, confirm_requested_at: t.confirm_requested_at || null };
      if (end < nowIs) {
        push({ ...base, key: `resultado:${t.id}`, category: 'resultado', title: `Registrar o resultado da ${K}`, detail: `${K} de ${dayText(t.due_at, now)} às ${hm(t.due_at)}: o cliente compareceu?`, due_at: end, meeting });
      } else if (!t.confirmed_at) {
        const asked = !!t.confirm_requested_at;
        push({
          ...base, key: `confirmacao:${t.id}`, category: 'confirmacao', meeting, waiting: asked,
          title: asked ? `Aguardando o cliente confirmar a ${K}` : `Confirmar a ${K} com o cliente`,
          detail: `${K} ${dayText(t.due_at, now)} às ${hm(t.due_at)}${asked ? ` · mensagem enviada ${dayText(t.confirm_requested_at, now)} às ${hm(t.confirm_requested_at)}` : ''}`,
          // Confirmar até 24 h antes; depois de pedir, volta à fila 2 h antes da reunião
          due_at: new Date(Date.parse(t.due_at) - (asked ? 2 : 24) * H).toISOString(),
          wa_text: `${hi(t, t.assigned_name)} Passando para confirmar a nossa reunião ${dayText(t.due_at, now)} às ${hm(t.due_at)}.${t.meeting_url ? ` O link para entrar é: ${t.meeting_url}` : ''} Posso confirmar a sua presença?`,
        });
      } else {
        push({
          ...base, key: `reuniao:${t.id}`, category: 'reuniao', meeting, title: `${K} confirmada: ${t.contact_name || t.title}`, detail: `${dayText(t.due_at, now)} às ${hm(t.due_at)}${t.meeting_url ? ' · com link da call' : ''}`,
          due_at: t.due_at,
          wa_text: `${hi(t, t.assigned_name)} Lembrando da nossa reunião ${dayText(t.due_at, now)} às ${hm(t.due_at)}.${t.meeting_url ? ` O link para entrar é: ${t.meeting_url}` : ''} Até já!`,
        });
      }
      continue;
    }
    const cat = PROPOSAL_TYPES.includes(t.type) ? 'follow_proposta' : CALL_TYPES.includes(t.type) ? 'ligacao' : 'tarefa';
    const wa = cat === 'follow_proposta'
      ? proposalText(db, user, t, req) || `${hi(t, t.assigned_name)} Conseguiu ver a proposta que te enviei? Fico à disposição para tirar qualquer dúvida.`
      : cat === 'ligacao' ? `${hi(t, t.assigned_name)} Tentei falar com você por telefone. Qual o melhor horário para conversarmos?` : `${hi(t, t.assigned_name)}`;
    push({ ...base, key: `task:${t.id}`, category: cat, title: t.title, detail: t.cadence_step ? `Régua da proposta · ${t.cadence_step}` : null, due_at: t.due_at, wa_text: t.contact_id ? wa : null, task: { id: t.id, type: t.type, title: t.title, due_at: t.due_at, source_activity_id: t.source_activity_id, opportunity_id: t.opportunity_id, status: t.status, priority: t.priority } });
  }

  // 2) Depois da reunião: follow-up da realizada e remarcação de quem não compareceu (até 10 dias), enquanto não houve contato
  const since = new Date(now.getTime() - 10 * 24 * H).toISOString();
  const done = db.prepare(`SELECT t.*, c.name AS contact_name, c.whatsapp AS contact_whatsapp, c.phone1 AS contact_phone1, c.phone2 AS contact_phone2, c.optouts AS contact_optouts,
      u.name AS assigned_name, s.name AS stage_name, o.status AS opp_status
    FROM tasks t JOIN contacts c ON c.id = t.contact_id LEFT JOIN users u ON u.id = t.assigned_to
    LEFT JOIN opportunities o ON o.id = t.opportunity_id LEFT JOIN pipeline_stages s ON s.id = o.stage_id
    WHERE t.type = 'reuniao' AND t.status = 'concluida' AND t.outcome IN ('realizada','nao_compareceu') AND t.due_at >= ? AND ${own.sql}
      AND COALESCE(o.status, 'aberta') = 'aberta'
      AND NOT EXISTS (SELECT 1 FROM tasks n WHERE n.contact_id = t.contact_id AND n.id <> t.id AND (n.status = 'pendente' OR (n.type = 'reuniao' AND n.due_at > t.due_at)))
      AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.contact_id = t.contact_id AND a.occurred_at > COALESCE(t.ends_at, t.due_at) AND a.type IN (${CONTACT_ACTS.map(() => '?').join(',')}))
    ORDER BY t.due_at`).all(since, ...own.params, ...CONTACT_ACTS);
  for (const t of done) {
    const K = (t.meeting_kind || 'r1').toUpperCase();
    const ns = t.outcome === 'nao_compareceu';
    const end = t.ends_at || t.due_at;
    push({
      key: `follow:${t.id}`, category: 'follow_reuniao', contact_id: t.contact_id, contact_name: t.contact_name, phone: phoneOf(t), opportunity_id: t.opportunity_id, stage_name: t.stage_name,
      assigned_to: t.assigned_to, assigned_name: t.assigned_name, priority: ns ? 'alta' : 'normal', optouts: JSON.parse(t.contact_optouts || '[]'),
      meeting: { id: t.id, kind: t.meeting_kind || 'r1', at: t.due_at, ends_at: t.ends_at, url: t.meeting_url || null, outcome: t.outcome },
      no_show: ns,
      title: ns ? `Remarcar a ${K}: o cliente não compareceu` : `Follow-up da ${K} realizada`,
      detail: `${K} de ${dayText(t.due_at, now)} às ${hm(t.due_at)} · sem contato desde então`,
      due_at: ns ? end : new Date(Date.parse(end) + 24 * H).toISOString(),
      wa_text: ns
        ? `${hi(t, t.assigned_name)} Senti sua falta na nossa reunião ${dayText(t.due_at, now)} às ${hm(t.due_at)}. Vamos remarcar? Me diga o melhor dia e horário para você.`
        : `${hi(t, t.assigned_name)} Obrigado pela nossa conversa ${dayText(t.due_at, now)}. Ficou alguma dúvida? Sigo à disposição para os próximos passos.`,
    });
  }

  // 3) WhatsApp esperando resposta (a IA não está atendendo e ninguém respondeu depois da última mensagem do cliente;
  //    respondida = mensagem enviada depois, pelo horário ou pela ordem de chegada, já que os relógios podem diferir)
  const ownW = inList('w.assigned_to', owners);
  const convs = db.prepare(`SELECT w.id, w.contact_id, w.profile_name, w.peer, w.wa_id, w.channel, w.unread, w.last_inbound_at, w.assigned_to,
      c.name AS contact_name, u.name AS assigned_name, i.name AS instance_name,
      (SELECT m.body FROM wa_messages m WHERE m.conversation_id = w.id AND m.direction = 'in' ORDER BY m.id DESC LIMIT 1) AS last_in
    FROM wa_conversations w LEFT JOIN contacts c ON c.id = w.contact_id LEFT JOIN users u ON u.id = w.assigned_to LEFT JOIN wa_instances i ON i.id = w.instance_id
    WHERE COALESCE(w.status, 'aberta') = 'aberta' AND w.last_inbound_at IS NOT NULL AND w.last_inbound_at >= ?
      AND COALESCE(w.ai_status, '') <> 'ativa' AND ${ownW.sql}
      AND NOT EXISTS (SELECT 1 FROM wa_messages m WHERE m.conversation_id = w.id AND m.direction = 'out'
        AND (m.created_at >= w.last_inbound_at OR m.id > COALESCE((SELECT MAX(x.id) FROM wa_messages x WHERE x.conversation_id = w.id AND x.direction = 'in'), 0)))
    ORDER BY w.last_inbound_at`).all(new Date(now.getTime() - 14 * 24 * H).toISOString(), ...ownW.params);
  for (const w of convs) {
    const who = w.contact_name || w.profile_name || w.peer || w.wa_id;
    push({
      key: `wa:${w.id}`, category: 'whatsapp', conversation_id: w.id, contact_id: w.contact_id, contact_name: who, phone: digits(w.peer || w.wa_id) || null,
      assigned_to: w.assigned_to, assigned_name: w.assigned_name, priority: 'alta', unread: w.unread || 0,
      title: `Responder ${who} no WhatsApp`, detail: w.last_in ? `"${String(w.last_in).slice(0, 140)}"` : null,
      channel_label: w.channel === 'lite' ? `WhatsApp Lite${w.instance_name ? ` · ${w.instance_name}` : ''}` : 'WhatsApp oficial',
      // Retorno do WhatsApp: até 10 minutos depois da mensagem do cliente
      due_at: new Date(Date.parse(w.last_inbound_at) + 10 * 60 * 1000).toISOString(),
    });
  }

  // Atrasadas primeiro (da mais estourada para a menos), depois as próximas; aguardando o cliente vai para o fim do dia
  items.sort((a, b) => (a.overdue === b.overdue ? Date.parse(a.due_at) - Date.parse(b.due_at) : a.overdue ? -1 : 1));
  const todayKey = now.toLocaleDateString('pt-BR', { timeZone: TZ });
  const counts = Object.fromEntries(Object.keys(CATS).map((k) => [k, items.filter((i) => i.category === k).length]));
  return {
    now: nowIs, days, owners: owners === null ? 'todos' : owners,
    categories: Object.entries(CATS).map(([key, label]) => ({ key, label, count: counts[key] })),
    kpis: {
      total: items.length,
      atrasadas: items.filter((i) => i.overdue).length,
      hoje: items.filter((i) => !i.overdue && new Date(i.due_at).toLocaleDateString('pt-BR', { timeZone: TZ }) === todayKey).length,
      whatsapp: counts.whatsapp,
      confirmar: items.filter((i) => i.category === 'confirmacao' && !i.waiting).length,
    },
    items,
  };
}

/** Conversa do WhatsApp para falar com o cadastro: a que já existe (se o usuário pode enviar), o número dele, o central ou o oficial. */
function pickConversation(db, user, c) {
  const wa = require('./whatsapp');
  const lite = require('./walite');
  const inst = (id) => (id ? db.prepare('SELECT * FROM wa_instances WHERE id = ?').get(Number(id)) : null);
  const off = wa.waConfig(db);
  for (const w of db.prepare('SELECT * FROM wa_conversations WHERE contact_id = ? ORDER BY COALESCE(last_message_at, created_at) DESC').all(c.id)) {
    if ((w.channel || 'oficial') === 'lite') {
      const i = inst(w.instance_id);
      if (i && i.status === 'conectado' && lite.convAccess(db, user, w, i) === 'enviar') return w.id;
    } else if (off.configured || off.sandbox) return w.id;
  }
  const candidates = [
    db.prepare("SELECT * FROM wa_instances WHERE owner_id = ? AND status = 'conectado' ORDER BY id LIMIT 1").get(user.id),
    inst(getSetting(db, 'wa_agent')?.instance_id),
    ...db.prepare("SELECT * FROM wa_instances WHERE status = 'conectado' ORDER BY id").all(),
  ].filter(Boolean);
  for (const i of candidates) {
    if (i.status === 'conectado' && lite.accessOf(db, user, i) === 'enviar') return lite.startConversation(db, user, c, i.id).id;
  }
  if (off.configured || off.sandbox) return wa.startConversation(db, user, { contact_id: c.id }).id;
  return null;
}

/** Depois da ação feita pela Central: conclui a tarefa e marca o pedido de confirmação da reunião. */
function finishAfter(db, user, data, note) {
  if (data.task_id) {
    const t = db.prepare('SELECT id, type, status FROM tasks WHERE id = ?').get(Number(data.task_id));
    if (t && t.status === 'pendente' && t.type !== 'reuniao') require('./tasks').updateTask(db, user, t.id, { action: 'concluir', notes: note });
  }
  if (data.confirm_meeting_id) {
    const t = db.prepare("SELECT id, contact_id FROM tasks WHERE id = ? AND type = 'reuniao' AND status = 'pendente'").get(Number(data.confirm_meeting_id));
    if (t) {
      loadContact(db, user, t.contact_id, { write: true });
      db.prepare('UPDATE tasks SET confirm_requested_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), t.id);
    }
  }
}

/** Envia a mensagem pronta (editada pelo especialista) pelo WhatsApp do CRM e conclui o item. Sem WhatsApp no CRM, devolve o link do WhatsApp. */
async function sendWhatsapp(db, user, data = {}) {
  const text = String(data.body || '').trim();
  if (!text) throw badRequest('Escreva a mensagem.');
  if (text.length > 4000) throw badRequest('Mensagem muito longa.');
  const c = loadContact(db, user, data.contact_id, { write: true });
  const convId = pickConversation(db, user, c);
  if (!convId) {
    const phone = digits(c.whatsapp || c.phone1 || c.phone2);
    if (!phone) throw badRequest('O cadastro não tem WhatsApp ou celular.');
    const to = phone.length <= 11 ? `55${phone}` : phone;
    return { sent: false, fallback_url: `https://wa.me/${to}?text=${encodeURIComponent(text)}` };
  }
  const r = await require('./whatsapp').sendMessage(db, user, convId, { body: text });
  finishAfter(db, user, data, `Feito pela Central: WhatsApp enviado. ${text.slice(0, 160)}`);
  return { sent: true, conversation_id: convId, status: r?.status || null };
}

/** Mensagem mandada pelo WhatsApp do celular (sem WhatsApp no CRM): registra no histórico e conclui o item. */
function registerDone(db, user, data = {}) {
  const c = loadContact(db, user, data.contact_id, { write: true });
  const notes = clean(data.notes) || 'Mensagem enviada pelo WhatsApp do celular.';
  require('./activities').createActivity(db, user, { contact_id: c.id, type: 'mensagem_enviada', channel: 'whatsapp', notes });
  finishAfter(db, user, data, `Feito pela Central: ${notes.slice(0, 160)}`);
  return { ok: true };
}

module.exports = { central, sendWhatsapp, registerDone, pickConversation, CATS };
