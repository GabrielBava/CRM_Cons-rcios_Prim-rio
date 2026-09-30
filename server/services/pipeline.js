'use strict';
/**
 * Regras de passagem do funil (modelo semelhante ao Pipedrive: critérios de entrada por etapa).
 * - A passagem é sequencial: para avançar, o negócio vai para a próxima etapa, sem pular.
 * - Cada etapa tem critérios de entrada verificados no servidor (configuráveis em Configurações › Funil).
 * - Voltar etapas é permitido com justificativa. Nutrição e Perdido podem ser usados a qualquer momento, com motivo.
 * - "Venda" só é alcançada pela confirmação do pagamento na tela de Vendas.
 */
const { ATTEMPT_TYPES } = require('../constants');
const { getSetting } = require('../db');

const RULES = {
  contato_valido: {
    label: 'Telefone, WhatsApp ou e-mail cadastrado',
    hint: 'Complete o contato na aba Cadastro.',
    check: (db, o, c) => !!(c.phone1 || c.phone2 || c.whatsapp || c.email),
  },
  origem: {
    label: 'Origem do lead informada',
    hint: 'Informe a origem na aba Origem.',
    check: (db, o, c) => !!c.origin,
  },
  tentativa_registrada: {
    label: 'Ao menos uma tentativa de contato registrada',
    hint: 'Registre a ligação ou a mensagem em "Registrar atividade".',
    check: (db, o, c) => !!db.prepare(`SELECT 1 FROM activities WHERE contact_id = ? AND type IN (${ATTEMPT_TYPES.map(() => '?').join(',')}) LIMIT 1`).get(c.id, ...ATTEMPT_TYPES),
  },
  contato_efetivo: {
    label: 'Conversa efetiva com o lead registrada',
    hint: 'Registre uma ligação atendida, mensagem recebida ou conversa.',
    check: (db, o, c) => {
      const efetivos = db.prepare("SELECT value, flags FROM options WHERE list = 'resultado_ligacao'").all().filter((r) => JSON.parse(r.flags || '{}').efetivo).map((r) => r.value);
      const types = ['ligacao_recebida', 'mensagem_recebida', 'email_recebido', 'conversa_presencial', 'conversa_video', 'reuniao_realizada'];
      const byType = db.prepare(`SELECT 1 FROM activities WHERE contact_id = ? AND type IN (${types.map(() => '?').join(',')}) LIMIT 1`).get(c.id, ...types);
      const byResult = efetivos.length && db.prepare(`SELECT 1 FROM activities WHERE contact_id = ? AND result IN (${efetivos.map(() => '?').join(',')}) LIMIT 1`).get(c.id, ...efetivos);
      return !!(byType || byResult);
    },
  },
  qualificacao: {
    label: 'Qualificação: objetivo, crédito desejado, parcela possível e prazo',
    hint: 'Preencha a qualificação em "4. Negócio".',
    check: (db, o) => !!(o.objective_type && o.credit_value && o.installment_max && o.urgency),
  },
  r1_agendada: {
    label: 'R1 agendada (tarefa de reunião)',
    hint: 'Agende a R1 em "Nova tarefa" › Reunião (R1).',
    check: (db, o, c) => !!db.prepare("SELECT 1 FROM tasks WHERE contact_id = ? AND type = 'reuniao' AND status <> 'cancelada' LIMIT 1").get(c.id),
  },
  r1_realizada: {
    label: 'R1 realizada',
    hint: 'Conclua a tarefa da R1 com o resultado "Realizada".',
    check: (db, o, c) =>
      !!(db.prepare("SELECT 1 FROM tasks WHERE contact_id = ? AND type = 'reuniao' AND status = 'concluida' AND outcome = 'realizada' LIMIT 1").get(c.id) ||
        db.prepare("SELECT 1 FROM activities WHERE contact_id = ? AND type = 'reuniao_realizada' LIMIT 1").get(c.id)),
  },
  dados_r1: {
    label: 'Dados da R1: quem decide, momento financeiro e produtos que já possui',
    hint: 'Complete em "4. Negócio" › Editar qualificação.',
    check: (db, o) => !!(o.decision_maker && o.financial_moment && o.existing_products),
  },
  proposta_apresentada: {
    label: 'Proposta registrada e enviada ao cliente',
    hint: 'Em Propostas, registre a proposta e marque como "Enviada ao cliente".',
    check: (db, o) => !!db.prepare("SELECT 1 FROM proposals WHERE opportunity_id = ? AND status IN ('apresentada','em_analise','aprovada') LIMIT 1").get(o.id),
  },
  venda_confirmada: {
    label: 'Venda com pagamento confirmado',
    hint: 'A etapa Venda é preenchida automaticamente quando o pagamento é confirmado em Vendas.',
    check: (db, o) => !!db.prepare("SELECT 1 FROM sales WHERE opportunity_id = ? AND status = 'confirmada' LIMIT 1").get(o.id),
  },
};

/** Critérios de entrada padrão de cada etapa. */
const DEFAULT_STAGE_RULES = {
  prospect: [],
  lead: ['contato_valido', 'origem'],
  tentativa: ['tentativa_registrada'],
  qualificado: ['contato_efetivo', 'qualificacao'],
  r1: ['r1_agendada'],
  negociacao: ['r1_realizada', 'dados_r1'],
  follow_up: ['proposta_apresentada'],
  venda: ['venda_confirmada'],
  nutricao: [],
  perdido: [],
};

function stageRules(db) {
  const custom = getSetting(db, 'stage_rules');
  const out = {};
  for (const [k, v] of Object.entries(DEFAULT_STAGE_RULES)) {
    out[k] = Array.isArray(custom?.[k]) ? custom[k].filter((r) => RULES[r]) : v;
  }
  out.venda = ['venda_confirmada'];
  return out;
}

/** Avalia os critérios de uma etapa para o negócio. */
function evaluate(db, opp, contact, stage) {
  const keys = stage?.key ? stageRules(db)[stage.key] || [] : [];
  return keys.map((k) => ({ key: k, label: RULES[k].label, hint: RULES[k].hint, ok: RULES[k].check(db, opp, contact) }));
}

const openStages = (db) => db.prepare("SELECT * FROM pipeline_stages WHERE active = 1 AND kind = 'aberta' ORDER BY position").all();

/** Próxima etapa aberta depois da atual (ou null). */
function nextStage(db, opp) {
  const seq = openStages(db);
  const i = seq.findIndex((s) => s.id === opp.stage_id);
  if (i >= 0 && i < seq.length - 1) return seq[i + 1];
  if (i === seq.length - 1) return db.prepare("SELECT * FROM pipeline_stages WHERE active = 1 AND kind = 'ganho' LIMIT 1").get();
  return null;
}

/**
 * Valida a movimentação. Lança erro com a lista do que falta quando a regra não é atendida.
 * Retorna { forced } quando o administrador força a passagem com justificativa.
 */
function validateMove(db, user, opp, from, to, data = {}, opts = {}) {
  const { badRequest } = require('../util');
  if (opts.fromSale) return {};
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(opp.contact_id);
  if (to.kind === 'ganho') {
    throw badRequest('A etapa "Venda" é preenchida automaticamente quando o pagamento da venda é confirmado na tela de Vendas.');
  }
  if (to.kind === 'perdido' || to.kind === 'nutricao') return {};
  const force = !!data.force && user.role === 'admin';
  if (force && !String(data.reason || '').trim()) throw badRequest('Para forçar a passagem, informe a justificativa.');
  const seq = openStages(db);
  const iTo = seq.findIndex((s) => s.id === to.id);
  const iFrom = from ? seq.findIndex((s) => s.id === from.id) : -1;
  const sequential = getSetting(db, 'funnel_sequential') !== false;
  // Voltar etapas: permitido, com justificativa
  if (iFrom >= 0 && iTo < iFrom) {
    if (!String(data.reason || '').trim()) throw badRequest(`Para voltar o negócio para "${to.name}", informe o motivo.`, { needs_reason: true });
    return {};
  }
  // Etapas a verificar: a de destino e, quando o negócio é retomado (nutrição/perdido) ou pula etapas, as anteriores
  let toCheck = [to];
  if (iFrom >= 0 && iTo > iFrom + 1) {
    if (sequential && !force) {
      throw badRequest(`Não é possível pular etapas. A próxima etapa deste negócio é "${seq[iFrom + 1].name}".`, { next_stage_id: seq[iFrom + 1].id });
    }
    toCheck = seq.slice(iFrom + 1, iTo + 1);
  } else if (iFrom < 0) {
    toCheck = seq.slice(0, iTo + 1);
  }
  const missing = [];
  for (const st of toCheck) for (const r of evaluate(db, opp, contact, st)) if (!r.ok) missing.push({ ...r, stage: st.name });
  if (missing.length && !force) {
    throw badRequest(`Para entrar em "${to.name}", falta: ${missing.map((m) => m.label).join('; ')}.`, { missing, stage: to.name, contact_id: contact.id });
  }
  return { forced: force && missing.length > 0 };
}

module.exports = { RULES, DEFAULT_STAGE_RULES, stageRules, evaluate, nextStage, validateMove, openStages };
