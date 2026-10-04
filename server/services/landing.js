'use strict';
/**
 * Leads da landing page Vero Consórcios (POST /api/publico/lp/leads, sem login).
 *
 * A LP envia dois tipos de formulário (CONFIG.leadEndpoint):
 *  - Simulador ("LP Simulador"): categoria Imóvel ou Veículo → objetivo AQUISIÇÃO; Investimento → objetivo ALAVANCAGEM;
 *  - Mecanismo de Alavancagem Financeira (tipo "alavancagem_financeira") → objetivo ALAVANCAGEM, plano de imóvel.
 *
 * Cada lead vira cadastro + negócio na etapa "Tentativa de contato" (origem landing page), com a qualificação que a LP
 * coletou (crédito, parcela, prazo, quando pretende iniciar), as preferências de contato e o aceite da LGPD; a roleta
 * distribui na hora. Se o telefone ou o e-mail já existem, nada é duplicado: o cadastro recebe a nova origem e o
 * negócio aberto é completado (só campos vazios), ou um negócio novo é aberto.
 */
const { badRequest, HttpError, clean, nowIso, normalizePhone, normalizeEmail } = require('../util');
const { tx } = require('../db');
const { createContact, findDuplicates, insertOrigin } = require('./contacts');
const { insertActivity } = require('./activities');

const SYSTEM_USER = { id: null, role: 'admin', name: 'Landing page' };
const BRL = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }));
const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/* ------------------------- Proteção do formulário público ------------------------- */

const hits = new Map(); // ip → [timestamps]
function rateLimit(ip, max = 8, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) throw new HttpError(429, 'Muitos envios em pouco tempo. Tente de novo em alguns minutos.');
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
}

/* ------------------------- Interpretação do envio da LP ------------------------- */

const PREF_CHANNEL = { whatsapp: 'whatsapp', ligacao: 'ligacao', telefone: 'ligacao' };
const URGENCY = { 'de imediato': 'curto', imediato: 'curto', '1 a 3 meses': 'curto', '6 a 12 meses': 'medio', 'apenas pesquisando': null };

/** Converte o JSON da LP nos campos do CRM (cadastro, negócio e anotações). */
function interpret(body) {
  const isLeverage = body.tipo === 'alavancagem_financeira' || /alavancagem/i.test(String(body.origem || ''));
  const cat = norm(body.categoria);
  const category = isLeverage ? 'imovel' : cat.startsWith('imov') ? 'imovel' : cat.startsWith('veic') ? 'veiculo' : cat.startsWith('invest') ? 'investimento' : null;
  const objective = isLeverage || category === 'investimento' ? 'alavancagem' : 'aquisicao';
  const credit = num(body.credito);
  const installment = num(body.parcela);
  const term = Number.parseInt(body.prazo, 10) || (isLeverage ? 220 : null);
  const opp = {
    objective_type: objective,
    credit_value: credit,
    term_months: term > 0 && term <= 400 ? term : null,
    credit_category: category === 'imovel' || category === 'veiculo' ? category : category === 'investimento' ? 'imovel' : null,
    credit_purpose_type: objective === 'alavancagem' ? 'patrimonio' : null,
    strategy: objective === 'alavancagem' ? 'alavancagem' : null,
  };
  // Simulação pela parcela: é o valor que o cliente quer pagar por mês (capacidade)
  if (!isLeverage && body.modo === 'parcela' && installment) {
    opp.installment_min = installment;
    opp.installment_max = installment;
  }
  if (isLeverage && body.inicio) opp.urgency = URGENCY[norm(body.inicio)] ?? null;
  const s = body.simulacao || {};
  const lines = isLeverage
    ? [
      'Lead da LP — Mecanismo de Alavancagem Financeira (objetivo: alavancagem).',
      `Crédito escolhido: ${BRL(credit)} · Quando pretende iniciar: ${clean(body.inicio) || '—'}.`,
      s.credito_simulado != null ? `Simulação mostrada: crédito ${BRL(s.credito_simulado)}, repetir o ciclo: ${s.repetir_ciclo ? 'sim' : 'não'}, investimento inicial mensal ${BRL(s.investimento_inicial_mensal)}, patrimônio projetado em 10 anos ${BRL(s.patrimonio_projetado_10_anos)}.` : '',
    ]
    : [
      `Lead da LP — Simulador (${clean(body.categoria) || 'categoria não informada'}; objetivo: ${objective === 'alavancagem' ? 'alavancagem' : 'aquisição'}).`,
      `Simulou pelo ${body.modo === 'parcela' ? 'valor da parcela' : 'valor do crédito'}: crédito ${BRL(credit)}, parcela ${BRL(installment)}${term ? `, prazo ${term} meses` : ''}.`,
    ];
  lines.push(`Preferência de contato: ${clean(body.preferencia_contato) || '—'}${body.melhor_horario ? `, ${clean(body.melhor_horario).toLowerCase()}` : ''}.`);
  return {
    form: isLeverage ? 'alavancagem' : 'simulador',
    contact: {
      name: clean(body.nome),
      phone: clean(body.celular || body.telefone),
      email: clean(body.email),
      pref_channel: PREF_CHANNEL[norm(body.preferencia_contato)] || null,
      pref_time: clean(body.melhor_horario) || null,
    },
    opp,
    notes: lines.filter(Boolean).join('\n'),
    campaign: isLeverage ? 'LP · Mecanismo de Alavancagem' : `LP · Simulador ${clean(body.categoria) || ''}`.trim(),
  };
}

/* ------------------------- Entrada ------------------------- */

function receive(db, body, { ip } = {}) {
  rateLimit(ip || 'local');
  if (!body || typeof body !== 'object') throw badRequest('Envio inválido.');
  // Armadilha para robôs (campo escondido "website"): finge sucesso e não grava
  if (clean(body.website)) return { ok: true };
  if (body.aceite_privacidade !== true && body.aceite_privacidade !== 'true') throw badRequest('É preciso aceitar a Política de Privacidade.');
  const lp = interpret(body);
  const phoneNorm = lp.contact.phone ? normalizePhone(lp.contact.phone) : null;
  const email = normalizeEmail(lp.contact.email);
  if (!lp.contact.name || lp.contact.name.length < 3) throw badRequest('Informe o nome.');
  if (!phoneNorm && !email) throw badRequest('Informe um telefone ou e-mail válido.');
  const utm = body.utm && typeof body.utm === 'object' ? body.utm : {};
  const originDetails = {
    origin: 'landing_page',
    campaign_name: clean(utm.utm_campaign) || lp.campaign,
    platform: 'landing_page',
    received_at: nowIso(),
    utm_source: clean(utm.utm_source), utm_medium: clean(utm.utm_medium), utm_campaign: clean(utm.utm_campaign),
    utm_content: clean(utm.utm_content), utm_term: clean(utm.utm_term),
    source_ref: `lp:${lp.form}`,
  };
  const { fillQualification, createOpportunityRow } = require('./opportunities');
  const consent = () => (body.aceite_notificacoes === true || body.aceite_notificacoes === 'true' ? ' Aceitou receber o resultado e notificações por WhatsApp, e-mail e SMS.' : '');

  const dups = findDuplicates(db, { phones: [phoneNorm].filter(Boolean), email });
  const result = tx(db, () => {
    let contactId;
    let created = false;
    if (dups.length >= 1) {
      // Cadastro existente (o mais antigo): nova origem + anotação, sem duplicar
      contactId = dups[0].id;
      insertOrigin(db, SYSTEM_USER, contactId, originDetails);
      insertActivity(db, { contact_id: contactId, type: 'cadastro', notes: `Novo envio pela landing page (${lp.form === 'alavancagem' ? 'Mecanismo de Alavancagem' : 'Simulador'}). Cadastro já existente: nenhuma duplicata criada.\n${lp.notes}${consent()}`, source: 'landing_page' });
    } else {
      const r = createContact(db, SYSTEM_USER, {
        kind: 'PF', name: lp.contact.name, phone1: lp.contact.phone, whatsapp: lp.contact.pref_channel === 'whatsapp' ? lp.contact.phone : undefined,
        email: lp.contact.email, origin: 'landing_page', campaign: originDetails.campaign_name, relationship: 'lead', owner_id: null,
        pref_channel: lp.contact.pref_channel, pref_time: lp.contact.pref_time, pref_source: 'Landing page', initial_notes: lp.notes + consent(),
        origin_details: originDetails, create_opportunity: true,
      }, { system: true, skipDuplicateCheck: true, source: 'landing_page', sourceLabel: `landing page · ${lp.form === 'alavancagem' ? 'Mecanismo de Alavancagem' : 'Simulador'}` });
      contactId = r.id;
      created = true;
    }
    // Negócio: completa o aberto (só campos vazios) ou abre um novo
    // Negócio aberto com o mesmo objetivo (ou sem objetivo ainda); objetivo diferente (ex.: já comprava um imóvel e agora quer alavancagem) abre outro negócio
    let opp = db.prepare("SELECT id, objective_type FROM opportunities WHERE contact_id = ? AND status = 'aberta' AND (objective_type IS NULL OR objective_type = ?) ORDER BY id DESC LIMIT 1").get(contactId, lp.opp.objective_type);
    if (!opp) {
      const tentativa = db.prepare("SELECT id FROM pipeline_stages WHERE key = 'tentativa' AND active = 1 AND kind = 'aberta'").get();
      const owner = db.prepare('SELECT owner_id FROM contacts WHERE id = ?').get(contactId)?.owner_id ?? null;
      opp = createOpportunityRow(db, SYSTEM_USER, { contact_id: contactId, owner_id: owner, stage_id: tentativa?.id });
    }
    const fields = Object.fromEntries(Object.entries(lp.opp).filter(([, v]) => v != null && v !== ''));
    // A estratégia "alavancagem" só entra se existir na lista de estratégias
    if (fields.strategy && !db.prepare("SELECT 1 FROM options WHERE list = 'estrategia' AND value = ?").get(fields.strategy)) delete fields.strategy;
    const filled = fillQualification(db, SYSTEM_USER, opp.id, { source: 'landing_page', fields }).filled;
    return { contactId, oppId: opp.id, created, filled };
  });
  // Sem responsável: a roleta distribui na hora (a rotina de 15 minutos cobre o que ficar na fila)
  const owner = db.prepare('SELECT owner_id FROM contacts WHERE id = ?').get(result.contactId)?.owner_id;
  if (!owner) require('./distribution').autoDistribute(db, result.contactId);
  const c = db.prepare('SELECT code, owner_id FROM contacts WHERE id = ?').get(result.contactId);
  return { ok: true, status: result.created ? 'criado' : 'existente', codigo: c.code, objetivo: lp.opp.objective_type, distribuido: !!c.owner_id };
}

module.exports = { receive, interpret };
