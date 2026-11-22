'use strict';
/**
 * Operação comercial depois do aceite da proposta:
 *   Pré-venda (link de cadastro → conferência → termo de adesão → contrato → boleto)
 *   → Venda (aguardando pagamento → confirmada com comprovante)
 *   → Comissões do especialista (parcelas previstas, liberadas e pagas)
 *   → Cancelamentos (com estorno das comissões e indicador por especialista).
 */
const { loadContact, visibleOwnerIds, audit, paging, isManager, requireManager, requireAdmin, optionLabel } = require('../core');
const { badRequest, notFound, forbidden, clean, toNumber, toDateOnly, nowIso } = require('../util');
const { tx, nextCode, getSetting } = require('../db');
const { insertActivity } = require('./activities');

const round2 = (v) => Math.round(v * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);
const monthOf = (d) => String(d).slice(0, 7);
function addMonths(dateStr, n) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Próximo dia útil (seg–sex) às hh:mm, a partir de agora. */
function nextBusinessDay(hh = 10, mm = 0) {
  const d = new Date(Date.now() + 86400000);
  while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

function addTask(db, row) {
  const now = nowIso();
  const r = db
    .prepare(`INSERT INTO tasks (contact_id, opportunity_id, type, title, notes, due_at, assigned_to, priority, pre_sale_id, sale_id, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(row.contact_id, row.opportunity_id ?? null, row.type, row.title, row.notes ?? null, row.due_at, row.assigned_to ?? null, row.priority || 'normal', row.pre_sale_id ?? null, row.sale_id ?? null, row.created_by ?? null, now, now);
  return Number(r.lastInsertRowid);
}

/** Escopo por responsável (especialista: os próprios; líder: a equipe; administrador: todos). */
function ownerScope(db, user, col) {
  const ids = visibleOwnerIds(db, user);
  if (ids === null) return { sql: '1=1', params: [] };
  return { sql: `${col} IN (${ids.map(() => '?').join(',')})`, params: ids };
}
function assertOwnerVisible(db, user, ownerId) {
  const ids = visibleOwnerIds(db, user);
  if (ids !== null && !ids.includes(ownerId)) throw notFound('Registro não encontrado ou fora do seu escopo.');
}

/* =========================================================================
   PRÉ-VENDA
   ========================================================================= */

/*
 * Fluxo da pré-venda (padrão do mercado de consórcio, como nas administradoras do tipo HS Consórcios):
 * link → acesso → ficha concluída → conferência → termo de adesão (cotas com grupo, cota e contrato)
 * → contrato assinado → pagamento (Pix ou boleto) → comprovante anexado. O comprovante leva para Vendas.
 * A ordem contrato/pagamento é configurável (presale_payment_first) e fica gravada em cada pré-venda.
 */
const HEAD_STEPS = [
  ['link_gerado', 'Link gerado'],
  ['acessado', 'Acessado pelo cliente'],
  ['preenchido', 'Concluído pelo cliente'],
  ['conferido', 'Conferido pela equipe'],
  ['termo_adesao', 'Termo de adesão gerado'],
];
const CONTRACT_STEP = ['contrato_assinado', 'Contrato assinado'];
const PAYMENT_STEPS = [['pagamento_enviado', 'Pagamento enviado (Pix ou boleto)'], ['pagamento_comprovado', 'Comprovante de pagamento anexado']];
const DONE_STEP = ['concluida', 'Concluída: venda aguardando a alocação da cota'];
const stepsFor = (order) => [...HEAD_STEPS, ...(order === 'pagamento' ? [...PAYMENT_STEPS, CONTRACT_STEP] : [CONTRACT_STEP, ...PAYMENT_STEPS]), DONE_STEP];
const PRESALE_STEPS = stepsFor('contrato');
const PRESALE_STATUS = Object.fromEntries([...stepsFor('contrato'), ['cancelada', 'Cancelada'], ['contrato_enviado', 'Contrato enviado'], ['boleto_emitido', 'Boleto emitido']]);
const orderOf = (db, ps) => ps?.step_order || (getSetting(db, 'presale_payment_first') === true ? 'pagamento' : 'contrato');
const stepIndex = (s, order = 'contrato') => stepsFor(order).findIndex(([k]) => k === s);
const PAYMENT_METHODS = { pix: 'Pix', boleto: 'Boleto' };

/** Primeira venda do cliente: ainda não tem venda confirmada nem produto contratado. */
function isFirstSale(db, contactId) {
  return !db.prepare("SELECT 1 FROM sales WHERE contact_id = ? AND status = 'confirmada' LIMIT 1").get(contactId) && !db.prepare('SELECT 1 FROM contracts WHERE contact_id = ? LIMIT 1').get(contactId);
}

/**
 * Abre a pré-venda (chamada no aceite da proposta ou manualmente).
 * Na primeira venda do cliente gera o link de cadastro; nas seguintes, a equipe apenas confere os dados.
 */
function openPreSale(db, user, { proposal_id, opportunity_id }) {
  let p = null;
  if (proposal_id) {
    p = db.prepare('SELECT * FROM proposals WHERE id = ?').get(Number(proposal_id));
    if (!p) throw notFound('Proposta não encontrada.');
  }
  const oppId = p ? p.opportunity_id : Number(opportunity_id);
  const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId);
  if (!opp) throw notFound('Negócio não encontrado.');
  const contact = loadContact(db, user, opp.contact_id, { write: true });
  const open = db.prepare("SELECT * FROM pre_sales WHERE opportunity_id = ? AND status NOT IN ('cancelada','concluida') ORDER BY id DESC LIMIT 1").get(opp.id);
  if (open) {
    if (p && open.proposal_id !== p.id) db.prepare('UPDATE pre_sales SET proposal_id = ?, credit_value = COALESCE(?, credit_value), term_months = COALESCE(?, term_months), installment_value = COALESCE(?, installment_value), updated_at = ? WHERE id = ?').run(p.id, p.credit_value, p.term_months, p.initial_installment, nowIso(), open.id);
    return { id: open.id, code: open.code, existing: true };
  }
  const first = isFirstSale(db, contact.id);
  const now = nowIso();
  let linkId = null;
  if (first) {
    const record = require('./record');
    const active = record.activeClientLink(db, contact.id);
    if (active) linkId = active.id;
    else if (contact.active !== 0) {
      record.createClientLink(db, user, contact.id);
      linkId = record.activeClientLink(db, contact.id)?.id ?? null;
    }
  }
  const code = nextCode(db, 'pre_sale', 'PV');
  const status = first ? 'link_gerado' : 'preenchido';
  const r = db
    .prepare(`INSERT INTO pre_sales (code, contact_id, opportunity_id, proposal_id, plan_id, first_sale, client_link_id, status, credit_value, term_months, installment_value,
      completed_at, owner_id, created_by, created_at, updated_at, step_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(code, contact.id, opp.id, p?.id ?? null, p?.product_id ?? opp.product_id ?? null, first ? 1 : 0, linkId, status, p?.credit_value ?? opp.credit_value ?? null,
      p?.term_months ?? opp.term_months ?? null, p?.initial_installment ?? null, first ? null : now, opp.owner_id ?? user.id, user.id, now, now, orderOf(db, null));
  const id = Number(r.lastInsertRowid);
  insertActivity(db, {
    contact_id: contact.id,
    opportunity_id: opp.id,
    type: 'cadastro',
    notes: first
      ? `Pré-venda ${code} aberta: link de cadastro gerado para o cliente preencher os dados da adesão.`
      : `Pré-venda ${code} aberta: cliente com venda anterior, dados já cadastrados (conferir e atualizar se necessário).`,
    user_id: user.id,
  });
  addTask(db, {
    contact_id: contact.id,
    opportunity_id: opp.id,
    type: 'pre_venda',
    title: first ? `Enviar o link de cadastro (${code}) ao cliente` : `Conferir os dados do cliente (${code})`,
    notes: first ? 'Envie por WhatsApp ou e-mail na tela Pré-venda. O cliente preenche os dados e envia os documentos.' : 'Cliente já possui cadastro. Confira dados e documentos antes do termo de adesão.',
    due_at: new Date(Date.now() + 2 * 3600000).toISOString(),
    assigned_to: opp.owner_id ?? user.id,
    pre_sale_id: id,
    created_by: user.id,
  });
  audit(db, user, 'pre_sale', id, 'aberta', { code, primeira_venda: first }, contact.id);
  return { id, code, first_sale: first };
}

const PRESALE_SELECT = `SELECT ps.*, c.name AS contact_name, c.code AS contact_code, c.email AS contact_email, c.whatsapp AS contact_whatsapp, c.phone1 AS contact_phone,
  c.kind AS contact_kind, o.code AS opportunity_code, pr.code AS proposal_code, p.name AS plan_name, a.name AS administrator_name, u.name AS owner_name,
  l.token AS link_token, l.expires_at AS link_expires_at, l.revoked_at AS link_revoked_at, l.access_count AS link_access_count, s.code AS sale_code, s.status AS sale_status
  FROM pre_sales ps JOIN contacts c ON c.id = ps.contact_id LEFT JOIN opportunities o ON o.id = ps.opportunity_id LEFT JOIN proposals pr ON pr.id = ps.proposal_id
  LEFT JOIN products p ON p.id = ps.plan_id LEFT JOIN administrators a ON a.id = p.administrator_id LEFT JOIN users u ON u.id = ps.owner_id
  LEFT JOIN client_links l ON l.id = ps.client_link_id LEFT JOIN sales s ON s.id = ps.sale_id`;

function decoratePreSale(db, r, alertHours) {
  const ref = r.status === 'link_gerado' ? r.sent_at || r.created_at : r.status === 'acessado' ? r.accessed_at : null;
  r.stale = !!ref && Date.now() - Date.parse(ref) > alertHours * 3600000;
  r.status_label = PRESALE_STATUS[r.status] || r.status;
  r.step_order = orderOf(db, r);
  r.step = stepIndex(r.status, r.step_order);
  r.steps = stepsFor(r.step_order);
  if (r.link_revoked_at || (r.link_expires_at && Date.parse(r.link_expires_at) < Date.now())) r.link_token = null;
  return r;
}

function listPreSales(db, user, q = {}) {
  const sc = ownerScope(db, user, 'ps.owner_id');
  const where = [sc.sql];
  const params = [...sc.params];
  if (q.status === 'ativas') where.push("ps.status NOT IN ('concluida','cancelada')");
  else if (q.status) {
    where.push('ps.status = ?');
    params.push(q.status);
  }
  if (q.owner_id) {
    where.push('ps.owner_id = ?');
    params.push(Number(q.owner_id));
  }
  if (q.contact_id) {
    where.push('ps.contact_id = ?');
    params.push(Number(q.contact_id));
  }
  if (q.q) {
    where.push('(c.name LIKE ? OR ps.code = ? OR c.code = ?)');
    params.push(`%${q.q}%`, String(q.q).toUpperCase(), String(q.q).toUpperCase());
  }
  const alertHours = Number(getSetting(db, 'presale_alert_hours')) || 24;
  const rows = db.prepare(`${PRESALE_SELECT} WHERE ${where.join(' AND ')} ORDER BY ps.status IN ('concluida','cancelada'), ps.updated_at DESC LIMIT 500`).all(...params).map((r) => decoratePreSale(db, r, alertHours));
  const all = db.prepare(`SELECT ps.status, ps.sent_at, ps.accessed_at, ps.created_at, ps.step_order FROM pre_sales ps WHERE ${sc.sql}`).all(...sc.params).map((r) => decoratePreSale(db, r, alertHours));
  const count = (f) => all.filter(f).length;
  const summary = {
    geradas: all.length,
    enviadas: count((r) => r.sent_at || r.step >= 1),
    acessadas: count((r) => r.step >= 1),
    concluidas_cliente: count((r) => r.step >= 2),
    em_andamento: count((r) => r.step >= 3 && r.status !== 'concluida'),
    aguardando_pagamento: count((r) => ['termo_adesao', 'contrato_assinado', 'pagamento_enviado'].includes(r.status)),
    convertidas: count((r) => r.status === 'concluida'),
    paradas: count((r) => r.stale),
  };
  return { rows, summary, steps: stepsFor(orderOf(db, null)) };
}

function loadPreSale(db, user, id, write = false) {
  const ps = db.prepare('SELECT * FROM pre_sales WHERE id = ?').get(Number(id));
  if (!ps) throw notFound('Pré-venda não encontrada.');
  loadContact(db, user, ps.contact_id, { write });
  return ps;
}

function getPreSale(db, user, id) {
  const ps = loadPreSale(db, user, id);
  const alertHours = Number(getSetting(db, 'presale_alert_hours')) || 24;
  const row = decoratePreSale(db, db.prepare(`${PRESALE_SELECT} WHERE ps.id = ?`).get(ps.id), alertHours);
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(ps.contact_id);
  row.checklist = require('./record').saleChecklist(db, contact);
  row.quotas = quotasOf(db, { pre_sale_id: ps.id });
  if (!row.quotas.length && ps.proposal_id) row.suggested_quotas = suggestedQuotas(db, ps);
  row.payment_attachment = ps.payment_attachment_id ? db.prepare('SELECT id, filename, size, created_at FROM attachments WHERE id = ?').get(ps.payment_attachment_id) : null;
  row.proof_by_name = ps.proof_by ? db.prepare('SELECT name FROM users WHERE id = ?').get(ps.proof_by)?.name : null;
  row.history = db.prepare("SELECT a.action, a.changes, a.created_at, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.entity = 'pre_sale' AND a.entity_id = ? ORDER BY a.id").all(ps.id)
    .map((h) => ({ ...h, changes: h.changes ? JSON.parse(h.changes) : null }));
  return row;
}

/** Mensagem e links para enviar o cadastro ao cliente (WhatsApp ou e-mail), no modelo da Vero. */
function presaleMessage(db, ps, url) {
  const mailer = require('./mailer');
  const owner = ps.owner_id ? db.prepare('SELECT name, whatsapp, phone FROM users WHERE id = ?').get(ps.owner_id) : null;
  const text = mailer.fichaWhatsapp(db, { name: ps.contact_name, url, consultant: owner?.name });
  const email = mailer.fichaEmail(db, { name: ps.contact_name, url, consultant: owner?.name, consultantPhone: owner?.whatsapp || owner?.phone });
  const phone = String(ps.contact_whatsapp || ps.contact_phone || '').replace(/\D/g, '');
  return {
    text,
    whatsapp_url: phone ? `https://wa.me/${phone.length <= 11 ? `55${phone}` : phone}?text=${encodeURIComponent(text)}` : null,
    email_url: ps.contact_email ? `mailto:${ps.contact_email}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.text)}` : null,
    email_to: ps.contact_email || null,
    email_subject: email.subject,
    email_configured: require('./mailer').smtpStatus(db, { role: 'consultor' }).configured,
  };
}

/** Envia a ficha por e-mail (SMTP da empresa, remetente noreply@veroconsorciosbr.com.br) ou devolve o e-mail pronto. */
async function sendFichaEmail(db, user, contactId, url, { preSaleId = null, logoUrl = null } = {}) {
  const c = loadContact(db, user, contactId, { write: true });
  if (!c.email) throw badRequest('Cadastre o e-mail do cliente para enviar a ficha por e-mail.');
  const mailer = require('./mailer');
  const owner = c.owner_id ? db.prepare('SELECT name, whatsapp, phone FROM users WHERE id = ?').get(c.owner_id) : null;
  const mail = mailer.fichaEmail(db, { name: c.name, url, consultant: owner?.name || user.name, consultantPhone: owner?.whatsapp || owner?.phone, logoUrl });
  const r = await mailer.sendMail(db, { to: c.email, ...mail });
  if (r.sent) {
    insertActivity(db, { contact_id: c.id, type: 'cadastro', notes: `Ficha de adesão enviada por e-mail para ${c.email} (remetente ${r.from}).`, user_id: user.id });
    audit(db, user, 'contact', c.id, 'ficha_enviada_email', { para: c.email, de: r.from }, c.id);
    if (preSaleId) markSent(db, user, preSaleId, { via: 'email' });
  }
  return { ...r, to: c.email, subject: mail.subject, html: mail.html, text: mail.text, mailto: `mailto:${c.email}?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.text)}` };
}

function markSent(db, user, id, data) {
  const ps = loadPreSale(db, user, id, true);
  const via = ['whatsapp', 'email', 'copiado'].includes(data.via) ? data.via : 'copiado';
  const now = nowIso();
  db.prepare('UPDATE pre_sales SET sent_via = ?, sent_at = COALESCE(sent_at, ?), updated_at = ? WHERE id = ?').run(via, now, now, ps.id);
  // A tarefa "Enviar o link de cadastro" é concluída automaticamente
  db.prepare("UPDATE tasks SET status = 'concluida', completed_at = ?, completed_by = ?, updated_at = ? WHERE pre_sale_id = ? AND status = 'pendente' AND title LIKE 'Enviar o link de cadastro%'").run(now, user.id, now, ps.id);
  insertActivity(db, { contact_id: ps.contact_id, opportunity_id: ps.opportunity_id, type: via === 'email' ? 'email_enviado' : via === 'whatsapp' ? 'mensagem_enviada' : 'observacao', notes: `Link de cadastro da pré-venda ${ps.code} enviado ao cliente (${via === 'email' ? 'e-mail' : via === 'whatsapp' ? 'WhatsApp' : 'link copiado'}).`, user_id: user.id, source: 'manual' });
  audit(db, user, 'pre_sale', ps.id, 'enviada', { via }, ps.contact_id);
  // A tarefa de envio é concluída automaticamente
  db.prepare("UPDATE tasks SET status = 'concluida', completed_at = ?, completed_by = ?, updated_at = ? WHERE pre_sale_id = ? AND status = 'pendente' AND title LIKE 'Enviar o link%'").run(now, user.id, now, ps.id);
}

/** Atualizações vindas da página do cliente: primeiro acesso e conclusão do cadastro. */
function onClientLink(db, linkId, event) {
  const ps = db.prepare("SELECT * FROM pre_sales WHERE client_link_id = ? AND status NOT IN ('cancelada','concluida') ORDER BY id DESC LIMIT 1").get(linkId);
  if (!ps) return;
  const now = nowIso();
  if (event === 'access' && ps.status === 'link_gerado') {
    db.prepare("UPDATE pre_sales SET status = 'acessado', accessed_at = ?, updated_at = ? WHERE id = ?").run(now, now, ps.id);
    audit(db, null, 'pre_sale', ps.id, 'acessada_pelo_cliente', null, ps.contact_id);
    const c = db.prepare('SELECT name FROM contacts WHERE id = ?').get(ps.contact_id);
    require('./notifications').notify(db, ps.owner_id, { kind: 'prevenda', title: `${c?.name || 'O cliente'} abriu o link da ficha cadastral`, body: `Pré-venda ${ps.code}. Acompanhe e ajude no preenchimento se precisar.`, link: '#/prevenda' });
  }
  if (event === 'complete' && stepIndex(ps.status) < 2) {
    db.prepare("UPDATE pre_sales SET status = 'preenchido', accessed_at = COALESCE(accessed_at, ?), completed_at = ?, updated_at = ? WHERE id = ?").run(now, now, now, ps.id);
    audit(db, null, 'pre_sale', ps.id, 'concluida_pelo_cliente', null, ps.contact_id);
    const c = db.prepare('SELECT name FROM contacts WHERE id = ?').get(ps.contact_id);
    require('./notifications').notify(db, ps.owner_id, { kind: 'prevenda', level: 'ok', title: `${c?.name || 'O cliente'} concluiu a ficha cadastral`, body: `Pré-venda ${ps.code}: confira os dados e os documentos para seguir com o termo de adesão.`, link: '#/prevenda' });
    addTask(db, { contact_id: ps.contact_id, opportunity_id: ps.opportunity_id, type: 'pre_venda', title: `Conferir o cadastro enviado pelo cliente (${ps.code})`, notes: 'Valide os documentos enviados e confira os dados antes do termo de adesão.', due_at: new Date(Date.now() + 4 * 3600000).toISOString(), assigned_to: ps.owner_id, pre_sale_id: ps.id, priority: 'alta' });
  }
}

/* ------------------------- Cotas (grupo, cota e contrato) ------------------------- */

function quotasOf(db, { pre_sale_id, sale_id }) {
  const where = pre_sale_id ? 'q.pre_sale_id = ?' : 'q.sale_id = ?';
  return db.prepare(`SELECT q.*, u.name AS allocated_by_name, k.code AS contract_code FROM pre_sale_quotas q LEFT JOIN users u ON u.id = q.allocated_by
    LEFT JOIN contracts k ON k.id = q.contract_id WHERE ${where} ORDER BY q.position, q.id`).all(pre_sale_id || sale_id);
}

/** Divisão sugerida a partir da proposta (ex.: 4 cotas de R$ 250 mil); sem divisão, uma cota com o crédito total. */
function suggestedQuotas(db, ps) {
  const p = ps.proposal_id ? db.prepare('SELECT credit_value, quotas, quota_values FROM proposals WHERE id = ?').get(ps.proposal_id) : null;
  let values = [];
  try {
    values = p?.quota_values ? JSON.parse(p.quota_values) : [];
  } catch {
    values = [];
  }
  const credit = ps.credit_value ?? p?.credit_value;
  if (!values.length && credit) {
    const n = p?.quotas && p.quotas > 1 ? p.quotas : 1;
    values = Array.from({ length: n }, () => round2(credit / n));
  }
  return values.map((v, i) => ({ position: i + 1, credit_value: v, group_code: null, quota_code: null, contract_number: null }));
}

/** Valida a lista de cotas: crédito de cada uma e, quando exigido, grupo, cota e nº de contrato. */
function normalizeQuotas(db, list, { plan, requireIds }) {
  if (!Array.isArray(list) || !list.length) throw badRequest('Informe pelo menos uma cota (grupo, cota, nº do contrato e crédito).');
  if (list.length > 50) throw badRequest('Máximo de 50 cotas por pré-venda.');
  const out = list.map((q, i) => {
    const credit = toNumber(q.credit_value);
    if (!credit || credit <= 0) throw badRequest(`Informe o crédito da ${i + 1}ª cota.`);
    if (plan) {
      const err = require('./catalog').creditError(plan, credit);
      if (err) throw badRequest(`${i + 1}ª cota: ${err}`);
    }
    const row = { position: i + 1, credit_value: credit, group_code: clean(q.group_code), quota_code: clean(q.quota_code), contract_number: clean(q.contract_number) };
    if (requireIds && (!row.group_code || !row.quota_code || !row.contract_number)) throw badRequest(`Informe o grupo, a cota e o nº do contrato da ${i + 1}ª cota.`);
    return row;
  });
  const keys = out.filter((q) => q.group_code && q.quota_code).map((q) => `${q.group_code}/${q.quota_code}`);
  if (new Set(keys).size !== keys.length) throw badRequest('Há cotas repetidas (mesmo grupo e cota).');
  return out;
}

function replaceQuotas(db, preSaleId, saleId, quotas) {
  const now = nowIso();
  db.prepare('DELETE FROM pre_sale_quotas WHERE pre_sale_id = ? AND contract_id IS NULL').run(preSaleId);
  const ins = db.prepare('INSERT INTO pre_sale_quotas (pre_sale_id, sale_id, position, credit_value, group_code, quota_code, contract_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const q of quotas) ins.run(preSaleId, saleId ?? null, q.position, q.credit_value, q.group_code ?? null, q.quota_code ?? null, q.contract_number ?? null, now, now);
}

/**
 * Avança a pré-venda uma etapa por vez, com os dados de cada etapa:
 * conferido (ficha completa) → termo_adesao (plano, nº da proposta de adesão e as cotas com grupo, cota e contrato)
 * → contrato_assinado (data) → pagamento_enviado (Pix ou boleto, valor e vencimento) → pagamento_comprovado (comprovante).
 * A última etapa conclui a pré-venda e cria a venda, que aguarda a confirmação da alocação da cota.
 */
function advancePreSale(db, user, id, data) {
  const ps = loadPreSale(db, user, id, true);
  const order = orderOf(db, ps);
  const steps = stepsFor(order);
  const to = data.step;
  const iTo = stepIndex(to, order);
  if (iTo < 3 || iTo >= steps.length - 1) throw badRequest('Etapa inválida para avanço manual.');
  if (['cancelada', 'concluida'].includes(ps.status)) throw badRequest('Esta pré-venda está encerrada.');
  const iFrom = stepIndex(ps.status, order);
  if (iTo !== iFrom + 1 && !(iTo === 3 && iFrom < 3)) {
    throw badRequest(`Siga a sequência: a próxima etapa é "${steps[Math.min(Math.max(iFrom, 2) + 1, steps.length - 2)][1]}".`);
  }
  const now = nowIso();
  const upd = { status: to, updated_at: now, step_order: order };
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(ps.contact_id);
  let quotas = null;
  let attId = null;
  if (to === 'conferido') {
    const check = require('./record').saleChecklist(db, contact);
    if (!check.complete && getSetting(db, 'require_sale_checklist') !== false) {
      throw badRequest(`Para conferir a pré-venda, a ficha precisa estar completa. Faltam: ${check.missing.map((m) => m.label).join('; ')}.`, { missing: check.missing });
    }
    upd.reviewed_at = now;
  }
  if (to === 'termo_adesao') {
    const planId = Number(data.plan_id || ps.plan_id);
    const plan = planId ? db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(planId) : null;
    if (!plan) throw badRequest('Selecione o plano da adesão.');
    const list = Array.isArray(data.quotas) && data.quotas.length ? data.quotas : null;
    if (!list) throw badRequest('Informe as cotas do termo de adesão: grupo, cota, nº do contrato e crédito de cada uma.');
    quotas = normalizeQuotas(db, list, { plan, requireIds: true });
    const total = round2(quotas.reduce((t, q) => t + q.credit_value, 0));
    const informed = toNumber(data.credit_value);
    if (informed && Math.abs(informed - total) > 1) throw badRequest(`A soma das cotas (R$ ${total.toLocaleString('pt-BR')}) é diferente do crédito total informado (R$ ${informed.toLocaleString('pt-BR')}).`);
    upd.plan_id = plan.id;
    upd.credit_value = total;
    upd.term_months = toNumber(data.term_months ?? ps.term_months ?? plan.term_months);
    upd.installment_value = toNumber(data.installment_value ?? ps.installment_value);
    upd.adhesion_number = clean(data.adhesion_number) ?? ps.adhesion_number;
    upd.adhesion_at = toDateOnly(data.adhesion_at) || today();
  }
  if (to === 'contrato_assinado') {
    upd.contract_signed_at = toDateOnly(data.date) || today();
    if (upd.contract_signed_at > today()) throw badRequest('A data da assinatura não pode ser futura.');
    upd.signed_via = ['digital', 'fisica'].includes(data.signed_via) ? data.signed_via : 'digital';
  }
  if (to === 'pagamento_enviado') {
    upd.payment_method = data.payment_method;
    if (!PAYMENT_METHODS[upd.payment_method]) throw badRequest('Informe a forma de pagamento: Pix ou boleto.');
    upd.boleto_value = toNumber(data.boleto_value ?? data.payment_value);
    upd.boleto_due = toDateOnly(data.boleto_due ?? data.payment_due) || (upd.payment_method === 'pix' ? today() : null);
    if (!upd.boleto_value || upd.boleto_value <= 0) throw badRequest('Informe o valor do pagamento (1ª parcela).');
    if (!upd.boleto_due) throw badRequest('Informe o vencimento do boleto.');
    upd.payment_sent_at = now;
    if (upd.payment_method === 'boleto') upd.boleto_issued_at = now;
  }
  if (to === 'pagamento_comprovado') {
    const paymentDate = toDateOnly(data.payment_date);
    if (!paymentDate) throw badRequest('Informe a data do pagamento.');
    if (paymentDate > today()) throw badRequest('A data do pagamento não pode ser futura.');
    if (!data.content_base64 || !data.filename) throw badRequest('Anexe o comprovante de pagamento.');
    upd.payment_date = paymentDate;
    upd.proof_by = user.id;
    upd.proof_at = now;
  }
  const isLast = iTo === steps.length - 2;
  return tx(db, () => {
    if (to === 'pagamento_comprovado') {
      attId = require('./record').insertAttachment(db, ps.contact_id, { doc_type: 'comprovante_pagamento', filename: data.filename, mime: data.mime, content_base64: data.content_base64, notes: `Comprovante de pagamento da pré-venda ${ps.code}`, opportunity_ids: ps.opportunity_id ? [ps.opportunity_id] : [] }, { userId: user.id });
      upd.payment_attachment_id = attId;
    }
    const keys = Object.keys(upd);
    db.prepare(`UPDATE pre_sales SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => upd[k] ?? null), ps.id);
    if (quotas) replaceQuotas(db, ps.id, null, quotas);
    let sale = null;
    if (isLast) sale = concludePreSale(db, user, ps.id);
    const label = PRESALE_STATUS[to];
    const extraNote = to === 'termo_adesao' ? ` ${quotas.length} cota(s): ${quotas.map((q) => `grupo ${q.group_code}, cota ${q.quota_code}, contrato ${q.contract_number}`).join('; ')}.`
      : to === 'pagamento_enviado' ? ` ${PAYMENT_METHODS[upd.payment_method]} de R$ ${upd.boleto_value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.` : '';
    insertActivity(db, { contact_id: ps.contact_id, opportunity_id: ps.opportunity_id, type: 'cadastro', notes: `Pré-venda ${ps.code}: ${label}.${extraNote}${sale ? ` Venda ${sale.code} registrada: aguardando a confirmação da alocação da cota pela administradora.` : ''}`, user_id: user.id });
    audit(db, user, 'pre_sale', ps.id, to, { ...Object.fromEntries(Object.entries(upd).filter(([k]) => !['status', 'updated_at', 'step_order'].includes(k))), ...(quotas ? { cotas: quotas } : {}) }, ps.contact_id);
    db.prepare("UPDATE tasks SET status = 'concluida', completed_at = ?, completed_by = ?, updated_at = ? WHERE pre_sale_id = ? AND status = 'pendente' AND priority = 'urgente'").run(now, user.id, now, ps.id);
    // Conferida a ficha, as tarefas de envio do link e de conferência deixam de fazer sentido
    if (to === 'conferido') db.prepare("UPDATE tasks SET status = 'concluida', completed_at = ?, completed_by = ?, updated_at = ? WHERE pre_sale_id = ? AND status = 'pendente' AND type = 'pre_venda'").run(now, user.id, now, ps.id);
    if (to === 'pagamento_enviado' && !isLast) {
      addTask(db, { contact_id: ps.contact_id, opportunity_id: ps.opportunity_id, type: 'pre_venda', title: `Anexar o comprovante de pagamento (${ps.code})`, notes: `${PAYMENT_METHODS[upd.payment_method]} com vencimento em ${upd.boleto_due.split('-').reverse().join('/')}. Com o comprovante anexado, a venda vai para Vendas.`, due_at: `${upd.boleto_due}T18:00:00.000Z`, assigned_to: ps.owner_id, pre_sale_id: ps.id, created_by: user.id });
    }
    if (to === 'pagamento_comprovado') db.prepare("UPDATE tasks SET status = 'concluida', completed_at = ?, completed_by = ?, updated_at = ? WHERE pre_sale_id = ? AND status = 'pendente' AND title LIKE 'Anexar o comprovante%'").run(now, user.id, now, ps.id);
    return { ok: true, sale };
  });
}

/** Edita as cotas (grupo, cota, contrato) antes da conclusão da pré-venda. */
function savePreSaleQuotas(db, user, id, data) {
  const ps = loadPreSale(db, user, id, true);
  if (['cancelada', 'concluida'].includes(ps.status)) throw badRequest('Pré-venda encerrada: ajuste as cotas na venda.');
  if (stepIndex(ps.status, orderOf(db, ps)) < stepIndex('termo_adesao')) throw badRequest('As cotas são informadas no termo de adesão.');
  const plan = ps.plan_id ? db.prepare('SELECT * FROM products WHERE id = ?').get(ps.plan_id) : null;
  const quotas = normalizeQuotas(db, data.quotas, { plan, requireIds: true });
  tx(db, () => {
    replaceQuotas(db, ps.id, null, quotas);
    db.prepare('UPDATE pre_sales SET credit_value = ?, updated_at = ? WHERE id = ?').run(round2(quotas.reduce((t, q) => t + q.credit_value, 0)), nowIso(), ps.id);
    audit(db, user, 'pre_sale', ps.id, 'cotas_alteradas', { cotas: quotas }, ps.contact_id);
  });
  return { ok: true };
}

/**
 * Pré-venda concluída (contrato assinado e comprovante anexado): nasce a venda, aguardando a confirmação da alocação
 * da(s) cota(s) pela administradora. Quem acompanha a alocação no portal da administradora é o especialista.
 */
function concludePreSale(db, user, preSaleId) {
  const ps = db.prepare('SELECT * FROM pre_sales WHERE id = ?').get(preSaleId);
  const now = nowIso();
  db.prepare("UPDATE pre_sales SET status = 'concluida', updated_at = ? WHERE id = ?").run(now, ps.id);
  let sale;
  const legacy = ps.sale_id ? db.prepare('SELECT * FROM sales WHERE id = ?').get(ps.sale_id) : null;
  if (legacy && legacy.status === 'aguardando_pagamento') {
    db.prepare(`UPDATE sales SET status = 'aguardando_alocacao', payment_date = ?, payment_attachment_id = ?, payment_method = ?, formalization_by = ?, boleto_value = ?, boleto_due = ?, updated_at = ? WHERE id = ?`)
      .run(ps.payment_date, ps.payment_attachment_id, ps.payment_method, ps.proof_by, ps.boleto_value, ps.boleto_due, now, legacy.id);
    sale = { id: legacy.id, code: legacy.code };
  } else sale = createSale(db, user, ps);
  db.prepare('UPDATE pre_sales SET sale_id = ? WHERE id = ?').run(sale.id, ps.id);
  db.prepare('UPDATE pre_sale_quotas SET sale_id = ?, updated_at = ? WHERE pre_sale_id = ?').run(sale.id, now, ps.id);
  const n = db.prepare('SELECT COUNT(*) AS n FROM pre_sale_quotas WHERE sale_id = ?').get(sale.id).n;
  db.prepare('UPDATE sales SET quotas_count = ? WHERE id = ?').run(n, sale.id);
  db.prepare("UPDATE tasks SET status = 'concluida', completed_at = ?, completed_by = ?, updated_at = ? WHERE pre_sale_id = ? AND status = 'pendente'").run(now, user.id, now, ps.id);
  const days = Number(getSetting(db, 'formalization_sla_days')) || 5;
  addTask(db, {
    contact_id: ps.contact_id, opportunity_id: ps.opportunity_id, type: 'venda', priority: 'alta', sale_id: sale.id, created_by: user.id, assigned_to: ps.owner_id,
    title: `Acompanhar a alocação da(s) cota(s) na administradora (venda ${sale.code})`,
    notes: `Confira no portal da administradora se ${n > 1 ? `as ${n} cotas foram alocadas` : 'a cota foi alocada'} para o cliente e registre em Vendas › Informar alocação. Prazo para o bônus de formalização: ${days} dia(s) após o pagamento.`,
    due_at: new Date(Date.now() + Math.min(days, 2) * 86400000).toISOString(),
  });
  const notifs = require('./notifications');
  const cName = db.prepare('SELECT name FROM contacts WHERE id = ?').get(ps.contact_id)?.name;
  notifs.notify(db, notifs.managersOf(db, ps.owner_id), { kind: 'venda', title: `Venda ${sale.code} aguardando a alocação: ${cName}`, body: 'Pagamento comprovado. Confirme a venda quando a administradora alocar a cota.', link: '#/vendas', exclude: user.id });
  return sale;
}

function cancelPreSale(db, user, id, data) {
  const ps = loadPreSale(db, user, id, true);
  if (['cancelada', 'concluida'].includes(ps.status)) throw badRequest('Esta pré-venda já está encerrada.');
  const reason = clean(data.reason);
  if (!reason) throw badRequest('Informe o motivo do cancelamento da pré-venda.');
  const now = nowIso();
  tx(db, () => {
    db.prepare("UPDATE pre_sales SET status = 'cancelada', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?").run(now, reason, now, ps.id);
    db.prepare("UPDATE tasks SET status = 'cancelada', updated_at = ? WHERE pre_sale_id = ? AND status = 'pendente'").run(now, ps.id);
    if (ps.sale_id) db.prepare("UPDATE sales SET status = 'cancelada', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ? AND status = 'aguardando_pagamento'").run(now, reason, now, ps.sale_id);
    insertActivity(db, { contact_id: ps.contact_id, opportunity_id: ps.opportunity_id, type: 'cadastro', notes: `Pré-venda ${ps.code} cancelada: ${reason}`, user_id: user.id });
    audit(db, user, 'pre_sale', ps.id, 'cancelada', { motivo: reason }, ps.contact_id);
  });
}

/** Alerta de pré-venda parada: link não acessado ou cadastro não concluído no prazo → tarefa urgente. */
function presaleSweep(db) {
  const hours = Number(getSetting(db, 'presale_alert_hours')) || 24;
  const limit = new Date(Date.now() - hours * 3600000).toISOString();
  const rows = db.prepare(`SELECT * FROM pre_sales WHERE (status = 'link_gerado' AND COALESCE(sent_at, created_at) < ?) OR (status = 'acessado' AND accessed_at < ?)`).all(limit, limit);
  let n = 0;
  for (const ps of rows) {
    if (ps.alert_status === ps.status) continue;
    const title = ps.status === 'link_gerado' ? `URGENTE: revisar pré-venda ${ps.code} (cliente não acessou o link)` : `URGENTE: revisar pré-venda ${ps.code} (cliente acessou e não concluiu)`;
    tx(db, () => {
      addTask(db, { contact_id: ps.contact_id, opportunity_id: ps.opportunity_id, type: 'pre_venda', title, notes: `Mais de ${hours} horas sem avanço. Entre em contato com o cliente e ajude no preenchimento.`, due_at: nowIso(), assigned_to: ps.owner_id, priority: 'urgente', pre_sale_id: ps.id });
      require('./notifications').notify(db, ps.owner_id, { kind: 'prevenda_parada', level: 'danger', title: `Pré-venda ${ps.code} parada há mais de ${hours} h`, body: ps.status === 'link_gerado' ? 'O cliente ainda não acessou o link.' : 'O cliente acessou e não concluiu o cadastro.', link: '#/prevenda' });
      db.prepare('UPDATE pre_sales SET alert_status = ? WHERE id = ?').run(ps.status, ps.id);
    });
    n++;
  }
  return n;
}

/** Venda sem alocação confirmada depois do prazo (dias após o pagamento): avisa o especialista e o líder uma vez. */
function allocationSweep(db) {
  const sla = Number(getSetting(db, 'formalization_sla_days')) || 5;
  const limit = addDays(today(), -sla);
  const rows = db.prepare("SELECT * FROM sales WHERE status = 'aguardando_alocacao' AND payment_date IS NOT NULL AND payment_date < ? AND alert_sent_at IS NULL").all(limit);
  const notifs = require('./notifications');
  for (const s of rows) {
    tx(db, () => {
      notifs.notify(db, [s.seller_id, ...notifs.managersOf(db, s.seller_id)], { kind: 'venda', level: 'warn', title: `Venda ${s.code} sem alocação há mais de ${sla} dias`, body: 'Confira no portal da administradora e informe a alocação da cota.', link: '#/vendas' });
      db.prepare('UPDATE sales SET alert_sent_at = ? WHERE id = ?').run(nowIso(), s.id);
    });
  }
  return rows.length;
}

/* =========================================================================
   VENDAS
   ========================================================================= */

function createSale(db, user, ps) {
  const plan = ps.plan_id ? db.prepare('SELECT * FROM products WHERE id = ?').get(ps.plan_id) : null;
  const opp = ps.opportunity_id ? db.prepare('SELECT owner_id, credit_category FROM opportunities WHERE id = ?').get(ps.opportunity_id) : null;
  const now = nowIso();
  const code = nextCode(db, 'sale', 'VD');
  const r = db
    .prepare(`INSERT INTO sales (code, contact_id, opportunity_id, proposal_id, pre_sale_id, plan_id, administrator_id, seller_id, category, credit_value, term_months, installment_value,
      adhesion_number, adhesion_date, boleto_value, boleto_due, status, payment_date, payment_attachment_id, payment_method, formalization_by, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'aguardando_alocacao', ?, ?, ?, ?, ?, ?, ?)`)
    .run(code, ps.contact_id, ps.opportunity_id ?? null, ps.proposal_id ?? null, ps.id, plan?.id ?? null, plan?.administrator_id ?? null, ps.owner_id ?? opp?.owner_id ?? user.id,
      plan?.category ?? opp?.credit_category ?? null, ps.credit_value, ps.term_months ?? null, ps.installment_value ?? null, ps.adhesion_number ?? null, ps.adhesion_at ?? null,
      ps.boleto_value ?? null, ps.boleto_due ?? null, ps.payment_date ?? null, ps.payment_attachment_id ?? null, ps.payment_method ?? null, ps.proof_by ?? user.id, user.id, now, now);
  const id = Number(r.lastInsertRowid);
  audit(db, user, 'sale', id, 'registrada', { code, credito: ps.credit_value, pagamento: ps.payment_date }, ps.contact_id);
  return { id, code };
}

const SALE_SELECT = `SELECT s.*, c.name AS contact_name, c.code AS contact_code, o.code AS opportunity_code, p.name AS plan_name, a.name AS administrator_name,
  u.name AS seller_name, ps.code AS pre_sale_code, k.code AS contract_code, pr.code AS proposal_code, cf.name AS confirmed_by_name,
  cn.code AS cancellation_code, cn.reason AS cancellation_reason, ac.name AS allocation_checked_by_name, fb.name AS formalization_by_name
  FROM sales s JOIN contacts c ON c.id = s.contact_id LEFT JOIN opportunities o ON o.id = s.opportunity_id LEFT JOIN products p ON p.id = s.plan_id
  LEFT JOIN administrators a ON a.id = s.administrator_id LEFT JOIN users u ON u.id = s.seller_id LEFT JOIN pre_sales ps ON ps.id = s.pre_sale_id
  LEFT JOIN contracts k ON k.id = s.contract_id LEFT JOIN proposals pr ON pr.id = s.proposal_id LEFT JOIN users cf ON cf.id = s.confirmed_by
  LEFT JOIN cancellations cn ON cn.sale_id = s.id LEFT JOIN users ac ON ac.id = s.allocation_checked_by LEFT JOIN users fb ON fb.id = s.formalization_by`;

const PENDING = ['aguardando_alocacao', 'aguardando_pagamento'];
const daysBetween = (a, b) => Math.floor((Date.parse(String(b).slice(0, 10)) - Date.parse(String(a).slice(0, 10))) / 86400000);

/**
 * Formalização feita pelo especialista: ele anexou o comprovante e informou a alocação dentro do prazo (dias após o pagamento).
 * Base do bônus de formalização e do indicador em Vendas.
 */
function formalization(db, s) {
  const sla = Number(getSetting(db, 'formalization_sla_days')) || 5;
  const byProof = !!s.formalization_by && s.formalization_by === s.seller_id;
  const byAllocation = !!s.allocation_checked_by && s.allocation_checked_by === s.seller_id;
  const days = s.payment_date && s.allocation_checked_at ? daysBetween(s.payment_date, s.allocation_checked_at) : null;
  const onTime = days != null && days <= sla;
  return { sla_days: sla, proof_by_seller: byProof, allocation_by_seller: byAllocation, days_to_allocation: days, on_time: onTime, by_seller: byProof && byAllocation && onTime };
}

function listSales(db, user, q = {}) {
  const sc = ownerScope(db, user, 's.seller_id');
  const where = [sc.sql];
  const params = [...sc.params];
  if (q.status === 'aguardando_alocacao') where.push(`s.status IN (${PENDING.map(() => '?').join(',')})`), params.push(...PENDING);
  else if (q.status) {
    where.push('s.status = ?');
    params.push(q.status);
  }
  if (q.seller_id) {
    where.push('s.seller_id = ?');
    params.push(Number(q.seller_id));
  }
  if (q.month) {
    where.push("substr(COALESCE(s.payment_date, s.created_at), 1, 7) = ?");
    params.push(q.month);
  }
  if (q.q) {
    where.push('(c.name LIKE ? OR s.code = ? OR c.code = ? OR EXISTS (SELECT 1 FROM pre_sale_quotas qq WHERE qq.sale_id = s.id AND (qq.contract_number = ? OR qq.group_code || \'/\' || qq.quota_code = ?)))');
    params.push(`%${q.q}%`, String(q.q).toUpperCase(), String(q.q).toUpperCase(), String(q.q), String(q.q));
  }
  const rows = db.prepare(`${SALE_SELECT} WHERE ${where.join(' AND ')} ORDER BY s.status IN ('aguardando_alocacao','aguardando_pagamento') DESC, s.created_at DESC LIMIT 500`).all(...params)
    .map((s) => ({ ...s, quotas: quotasOf(db, { sale_id: s.id }), formalization: formalization(db, s) }));
  const month = today().slice(0, 7);
  const base = db.prepare(`SELECT s.* FROM sales s WHERE ${sc.sql}`).all(...sc.params);
  const confirmedMonth = base.filter((s) => s.status === 'confirmada' && s.confirmed_at && monthOf(s.confirmed_at) === month);
  const sla = Number(getSetting(db, 'formalization_sla_days')) || 5;
  const pending = base.filter((s) => PENDING.includes(s.status));
  const done = base.filter((s) => s.status === 'confirmada' && s.allocation_checked_at);
  const summary = {
    aguardando: pending.length,
    aguardando_valor: pending.reduce((t, s) => t + s.credit_value, 0),
    alocacao_atrasada: pending.filter((s) => s.payment_date && daysBetween(s.payment_date, today()) > sla).length,
    confirmadas_mes: confirmedMonth.length,
    credito_mes: confirmedMonth.reduce((t, s) => t + s.credit_value, 0),
    canceladas_mes: base.filter((s) => s.status === 'cancelada' && s.cancelled_at && monthOf(s.cancelled_at) === month).length,
    formalizacao_especialista: done.length ? Math.round((done.filter((s) => formalization(db, s).by_seller).length / done.length) * 100) : null,
    sla_dias: sla,
  };
  return { rows, summary };
}

function loadSale(db, user, id) {
  const s = db.prepare('SELECT * FROM sales WHERE id = ?').get(Number(id));
  if (!s) throw notFound('Venda não encontrada.');
  loadContact(db, user, s.contact_id);
  return s;
}

function getSale(db, user, id) {
  const s = loadSale(db, user, id);
  const row = db.prepare(`${SALE_SELECT} WHERE s.id = ?`).get(s.id);
  row.quotas = quotasOf(db, { sale_id: s.id });
  row.contracts = db.prepare('SELECT id, code, group_code, quota_code, contract_number, credit_value, status FROM contracts WHERE sale_id = ? ORDER BY id').all(s.id);
  row.formalization = formalization(db, s);
  row.bonus_pct = Number(getSetting(db, 'formalization_bonus_pct')) || 0;
  row.commissions = db.prepare('SELECT ce.*, u.name AS user_name FROM commission_entries ce LEFT JOIN users u ON u.id = ce.user_id WHERE ce.sale_id = ? ORDER BY ce.competence, ce.id').all(s.id);
  row.cancellation = db.prepare('SELECT cn.*, u.name AS responsible_name FROM cancellations cn LEFT JOIN users u ON u.id = cn.responsible_id WHERE cn.sale_id = ?').get(s.id) || null;
  row.payment_attachment = s.payment_attachment_id ? db.prepare('SELECT id, filename, size, created_at FROM attachments WHERE id = ?').get(s.payment_attachment_id) : null;
  row.history = db.prepare("SELECT a.action, a.changes, a.created_at, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.entity = 'sale' AND a.entity_id = ? ORDER BY a.id").all(s.id)
    .map((h) => ({ ...h, changes: h.changes ? JSON.parse(h.changes) : null }));
  return row;
}

/** Venda antiga (aguardando pagamento): o comprovante leva para "aguardando alocação". */
function registerPayment(db, user, s, data) {
  const paymentDate = toDateOnly(data.payment_date);
  if (!paymentDate) throw badRequest('Informe a data do pagamento.');
  if (paymentDate > today()) throw badRequest('A data do pagamento não pode ser futura.');
  if (!data.content_base64 || !data.filename) throw badRequest('Anexe o comprovante de pagamento.');
  const now = nowIso();
  const attId = require('./record').insertAttachment(db, s.contact_id, { doc_type: 'comprovante_pagamento', filename: data.filename, mime: data.mime, content_base64: data.content_base64, notes: `Comprovante da venda ${s.code}`, opportunity_ids: s.opportunity_id ? [s.opportunity_id] : [] }, { userId: user.id });
  db.prepare("UPDATE sales SET status = 'aguardando_alocacao', payment_date = ?, payment_attachment_id = ?, payment_method = COALESCE(?, payment_method, 'boleto'), formalization_by = ?, updated_at = ? WHERE id = ?")
    .run(paymentDate, attId, data.payment_method || null, user.id, now, s.id);
  if (s.pre_sale_id) db.prepare("UPDATE pre_sales SET status = 'concluida', payment_date = ?, payment_attachment_id = ?, proof_by = ?, proof_at = ?, updated_at = ? WHERE id = ?").run(paymentDate, attId, user.id, now, now, s.pre_sale_id);
  if (!db.prepare('SELECT 1 FROM pre_sale_quotas WHERE sale_id = ?').get(s.id) && s.pre_sale_id) {
    db.prepare('INSERT INTO pre_sale_quotas (pre_sale_id, sale_id, position, credit_value, group_code, quota_code, contract_number, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)')
      .run(s.pre_sale_id, s.id, s.credit_value, clean(data.group_code) ?? s.group_code ?? null, clean(data.quota_code) ?? s.quota_code ?? null, s.adhesion_number ?? null, now, now);
  }
  audit(db, user, 'sale', s.id, 'pagamento_comprovado', { pagamento: paymentDate }, s.contact_id);
  return db.prepare('SELECT * FROM sales WHERE id = ?').get(s.id);
}

function applyQuotaUpdates(db, user, s, list, { markAllocated, allocatedOn }) {
  const cur = quotasOf(db, { sale_id: s.id });
  if (!Array.isArray(list) || !list.length) return cur;
  const now = nowIso();
  for (const q of list) {
    const row = cur.find((c) => c.id === Number(q.id));
    if (!row) throw badRequest('Cota não pertence a esta venda.');
    const g = clean(q.group_code) ?? row.group_code;
    const k = clean(q.quota_code) ?? row.quota_code;
    const n = clean(q.contract_number) ?? row.contract_number;
    const allocated = markAllocated && (q.allocated === true || q.allocated === 'on' || q.allocated === 'true' || q.allocated === 1);
    db.prepare('UPDATE pre_sale_quotas SET group_code = ?, quota_code = ?, contract_number = ?, allocated_on = COALESCE(?, allocated_on), allocated_by = COALESCE(?, allocated_by), updated_at = ? WHERE id = ?')
      .run(g, k, n, allocated ? allocatedOn : null, allocated ? user.id : null, now, row.id);
  }
  return quotasOf(db, { sale_id: s.id });
}

/**
 * O especialista informa a alocação: conferiu no portal da administradora que a(s) cota(s) está(ão) alocada(s) para o cliente,
 * com grupo, cota e nº do contrato. Fica registrado quem informou e quando (base do bônus de formalização).
 */
function registerAllocation(db, user, id, data) {
  const s = loadSale(db, user, id);
  loadContact(db, user, s.contact_id, { write: true });
  if (!PENDING.includes(s.status)) throw badRequest('Esta venda não está aguardando a alocação.');
  if (s.status === 'aguardando_pagamento') throw badRequest('Anexe primeiro o comprovante de pagamento.');
  const on = toDateOnly(data.allocated_on) || today();
  if (on > today()) throw badRequest('A data da alocação não pode ser futura.');
  return tx(db, () => {
    const quotas = applyQuotaUpdates(db, user, s, data.quotas, { markAllocated: true, allocatedOn: on });
    const missing = quotas.filter((q) => !q.group_code || !q.quota_code || !q.contract_number);
    if (missing.length) throw badRequest('Informe grupo, cota e nº do contrato de todas as cotas.');
    const all = quotas.every((q) => q.allocated_on);
    const now = nowIso();
    if (all) db.prepare('UPDATE sales SET allocation_checked_at = COALESCE(allocation_checked_at, ?), allocation_checked_by = COALESCE(allocation_checked_by, ?), allocation_notes = COALESCE(?, allocation_notes), updated_at = ? WHERE id = ?').run(on, user.id, clean(data.notes) ?? null, now, s.id);
    audit(db, user, 'sale', s.id, 'alocacao_informada', { cotas: quotas.map((q) => ({ grupo: q.group_code, cota: q.quota_code, contrato: q.contract_number, alocada_em: q.allocated_on })) }, s.contact_id);
    insertActivity(db, { contact_id: s.contact_id, opportunity_id: s.opportunity_id, type: 'cadastro', notes: `Venda ${s.code}: alocação ${all ? 'informada' : 'parcial'} (${quotas.filter((q) => q.allocated_on).length} de ${quotas.length} cota(s) alocadas na administradora).`, user_id: user.id });
    if (all) {
      db.prepare("UPDATE tasks SET status = 'concluida', completed_at = ?, completed_by = ?, updated_at = ? WHERE sale_id = ? AND status = 'pendente' AND title LIKE 'Acompanhar a alocação%'").run(now, user.id, now, s.id);
      const notifs = require('./notifications');
      notifs.notify(db, notifs.managersOf(db, s.seller_id), { kind: 'venda', level: 'ok', title: `Venda ${s.code}: cotas alocadas`, body: 'O especialista informou a alocação. Confira e confirme a venda.', link: '#/vendas', exclude: user.id });
    }
    return { ok: true, all_allocated: all };
  });
}

/**
 * Confirmação da venda pelo time (líder ou administrador), depois da alocação da cota pela administradora.
 * Cada cota vira um produto contratado do cliente (todos com o mesmo ID de venda), o negócio vai para "Venda",
 * as comissões são geradas e começa o pós-venda.
 */
const addMonthsDate = (d, n) => {
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  t.setUTCDate(Math.min(day, new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()));
  return t.toISOString().slice(0, 10);
};
function confirmSale(db, user, id, data) {
  let s = loadSale(db, user, id);
  loadContact(db, user, s.contact_id, { write: true });
  if (!PENDING.includes(s.status)) throw badRequest('Esta venda não está aguardando confirmação.');
  if (!isManager(user)) throw forbidden('A confirmação da venda é feita pelo time (líder de equipe ou administrador), depois da alocação da cota pela administradora.');
  const record = require('./record');
  return tx(db, () => {
    if (s.status === 'aguardando_pagamento') s = registerPayment(db, user, s, data);
    const allocatedOn = toDateOnly(data.allocated_on) || today();
    if (allocatedOn > today()) throw badRequest('A data da alocação não pode ser futura.');
    const quotas = applyQuotaUpdates(db, user, s, data.quotas, { markAllocated: true, allocatedOn });
    if (!quotas.length) throw badRequest('Venda sem cotas registradas.');
    const missing = quotas.filter((q) => !q.group_code || !q.quota_code || !q.contract_number);
    if (missing.length) throw badRequest('Para confirmar, informe grupo, cota e nº do contrato de todas as cotas.');
    const now = nowIso();
    const plan = s.plan_id ? db.prepare('SELECT * FROM products WHERE id = ?').get(s.plan_id) : null;
    const { createContractRow } = require('./clients');
    const contracts = [];
    for (const q of quotas) {
      const k = createContractRow(db, user, {
        contact_id: s.contact_id, opportunity_id: s.opportunity_id, product_id: s.plan_id, category: s.category, administrator: plan?.administrator,
        group_code: q.group_code, quota_code: q.quota_code, credit_value: q.credit_value, term_months: s.term_months,
        installment_value: s.installment_value && s.credit_value ? round2((s.installment_value * q.credit_value) / s.credit_value) : null, contract_number: q.contract_number,
        // Contratação = data da venda (pagamento da 1ª parcela); adesão = alocação da cota na administradora; reajuste anual a partir da adesão
        contracted_at: s.payment_date || s.adhesion_date || String(s.created_at).slice(0, 10), adhesion_date: allocatedOn,
        next_readjustment_date: addMonthsDate(allocatedOn, 12),
        first_due_date: s.payment_date, seller_id: s.seller_id, status: 'ativo', quotas: 1,
      });
      db.prepare('UPDATE contracts SET sale_id = ?, proposal_id = COALESCE(proposal_id, ?) WHERE id = ?').run(s.id, s.proposal_id ?? null, k.id);
      db.prepare('UPDATE pre_sale_quotas SET contract_id = ?, allocated_on = COALESCE(allocated_on, ?), allocated_by = COALESCE(allocated_by, ?), updated_at = ? WHERE id = ?').run(k.id, allocatedOn, user.id, now, q.id);
      contracts.push(k);
    }
    db.prepare(`UPDATE sales SET status = 'confirmada', confirmed_at = ?, confirmed_by = ?, contract_id = ?, allocated_on = ?, quotas_count = ?,
      allocation_checked_at = COALESCE(allocation_checked_at, ?), allocation_checked_by = COALESCE(allocation_checked_by, ?),
      group_code = ?, quota_code = ?, updated_at = ? WHERE id = ?`)
      .run(now, user.id, contracts[0].id, allocatedOn, quotas.length, allocatedOn, user.id, quotas[0].group_code, quotas[0].quota_code, now, s.id);
    // Negócio vai para "Venda" (única forma de chegar a essa etapa)
    if (s.opportunity_id) {
      const won = db.prepare("SELECT id FROM pipeline_stages WHERE kind = 'ganho' AND active = 1 LIMIT 1").get();
      const opp = db.prepare('SELECT stage_id FROM opportunities WHERE id = ?').get(s.opportunity_id);
      if (won && opp && opp.stage_id !== won.id) require('./opportunities').moveStage(db, user, s.opportunity_id, { stage_id: won.id, reason: `Venda ${s.code} confirmada` }, { fromSale: true });
    } else {
      db.prepare("UPDATE contacts SET relationship = 'cliente', client_status = 'ativo', lead_status = 'convertido', converted_at = COALESCE(converted_at, ?) WHERE id = ?").run(now, s.contact_id);
    }
    // Preferências de comunicação informadas na confirmação
    const prefs = {};
    if (clean(data.pref_channel)) prefs.pref_channel = clean(data.pref_channel);
    if (clean(data.pref_time)) prefs.pref_time = clean(data.pref_time);
    if (Object.keys(prefs).length) {
      db.prepare(`UPDATE contacts SET ${Object.keys(prefs).map((k) => `${k} = ?`).join(', ')}, pref_updated_at = ?, pref_source = ? WHERE id = ?`).run(...Object.values(prefs), now, 'Informado na confirmação da venda', s.contact_id);
    }
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(s.id);
    const comm = generateCommissions(db, sale);
    const bonus = formalizationBonus(db, sale);
    // Pós-venda: responsável (padrão da empresa ou o especialista da venda) e início da linha do tempo D+N
    const postsaleDefault = getSetting(db, 'postsale_user_id');
    db.prepare('UPDATE contacts SET postsale_owner_id = COALESCE(postsale_owner_id, ?), postsale_started_at = COALESCE(postsale_started_at, ?) WHERE id = ?').run(postsaleDefault || s.seller_id || null, now, s.contact_id);
    record.markPostSale(db, user.id, s.contact_id, 'primeira_parcela', `Comprovante de pagamento anexado na venda ${s.code} (${(s.payment_date || '').split('-').reverse().join('/')}).`);
    if (Object.keys(prefs).length) record.markPostSale(db, user.id, s.contact_id, 'preferencias_contato', `Informadas na confirmação da venda ${s.code}.`);
    db.prepare("UPDATE tasks SET status = 'concluida', completed_at = ?, completed_by = ?, updated_at = ? WHERE sale_id = ? AND status = 'pendente'").run(now, user.id, now, s.id);
    require('./postsale').syncTimeline(db, s.contact_id, user.id);
    insertActivity(db, { contact_id: s.contact_id, opportunity_id: s.opportunity_id, type: 'cadastro', notes: `Venda ${s.code} confirmada: ${quotas.length} cota(s) alocada(s) na administradora (${contracts.map((k) => k.code).join(', ')}). Pós-venda iniciado.${comm.count ? ` ${comm.count} parcela(s) de comissão prevista(s).` : ' Sem tabela de comissão cadastrada para o plano/administradora.'}${bonus ? ` Bônus de formalização: R$ ${bonus.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.` : ''}`, user_id: user.id });
    audit(db, user, 'sale', s.id, 'confirmada', { alocacao: allocatedOn, contratos: contracts.map((k) => k.code), comissoes: comm.count, bonus }, s.contact_id);
    const cName = db.prepare('SELECT name FROM contacts WHERE id = ?').get(s.contact_id)?.name;
    const notifs = require('./notifications');
    notifs.notify(db, [s.seller_id, ...notifs.managersOf(db, s.seller_id)], { kind: 'venda', level: 'ok', title: `Venda ${s.code} confirmada: ${cName}`, body: `${quotas.length} cota(s), crédito de R$ ${Number(s.credit_value || 0).toLocaleString('pt-BR')}. Pós-venda iniciado.`, link: '#/vendas', exclude: user.id });
    return { ok: true, contracts, contract: contracts[0], commissions: comm.count, bonus };
  });
}

function cancelPendingSale(db, user, id, data) {
  const s = loadSale(db, user, id);
  loadContact(db, user, s.contact_id, { write: true });
  if (!PENDING.includes(s.status)) throw badRequest('Para vendas confirmadas, registre o cancelamento em Comissões e cancelamentos.');
  const reason = clean(data.reason);
  if (!reason) throw badRequest('Informe o motivo.');
  const now = nowIso();
  tx(db, () => {
    db.prepare("UPDATE sales SET status = 'cancelada', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?").run(now, reason, now, s.id);
    if (s.pre_sale_id) db.prepare("UPDATE pre_sales SET status = 'cancelada', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?").run(now, reason, now, s.pre_sale_id);
    db.prepare("UPDATE tasks SET status = 'cancelada', updated_at = ? WHERE sale_id = ? AND status = 'pendente'").run(now, s.id);
    insertActivity(db, { contact_id: s.contact_id, opportunity_id: s.opportunity_id, type: 'cadastro', notes: `Venda ${s.code} cancelada antes da confirmação: ${reason}`, user_id: user.id });
    audit(db, user, 'sale', s.id, 'cancelada_antes_da_confirmacao', { motivo: reason }, s.contact_id);
  });
}

/* =========================================================================
   COMISSÕES
   ========================================================================= */

/** Gera as parcelas de comissão do especialista conforme a tabela do plano (ou da administradora). */
function generateCommissions(db, sale) {
  const { commissionScheduleFor } = require('./catalog');
  const { schedule } = commissionScheduleFor(db, sale.plan_id, sale.administrator_id);
  const now = nowIso();
  const t = today();
  let count = 0;
  for (const item of schedule) {
    const competence = monthOf(addMonths(sale.payment_date, item.month_offset || 0));
    // Liberada após a carência (ex.: 7 dias sem cancelamento) e nunca antes do mês de competência da parcela
    const afterGrace = addDays(sale.payment_date, item.release_after_days || 0);
    const releaseOn = afterGrace > `${competence}-01` ? afterGrace : `${competence}-01`;
    const amount = round2((sale.credit_value * item.pct) / 100);
    db.prepare(`INSERT INTO commission_entries (sale_id, user_id, kind, installment_no, competence, base_value, pct, amount, status, release_on, created_at, updated_at)
      VALUES (?, ?, 'comissao', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(sale.id, sale.seller_id, item.n, competence, sale.credit_value, item.pct, amount, releaseOn <= t ? 'liberada' : 'prevista', releaseOn, now, now);
    count++;
  }
  return { count };
}

/**
 * Bônus de formalização: quando o próprio especialista anexou o comprovante e informou a alocação no prazo,
 * recebe um bônus (% do crédito, configurável; 0 = desligado), liberado junto com a 1ª parcela da comissão.
 */
function formalizationBonus(db, sale) {
  const pct = Number(getSetting(db, 'formalization_bonus_pct')) || 0;
  if (pct <= 0 || !formalization(db, sale).by_seller) return 0;
  const amount = round2((sale.credit_value * pct) / 100);
  const now = nowIso();
  const releaseOn = addDays(today(), 7);
  db.prepare(`INSERT INTO commission_entries (sale_id, user_id, kind, competence, base_value, pct, amount, status, release_on, notes, created_at, updated_at)
    VALUES (?, ?, 'bonus', ?, ?, ?, ?, 'prevista', ?, ?, ?, ?)`).run(sale.id, sale.seller_id, today().slice(0, 7), sale.credit_value, pct, amount, releaseOn, `Bônus de formalização da venda ${sale.code}`, now, now);
  return amount;
}

/** Libera as parcelas cuja carência (ex.: 7 dias sem cancelamento) já passou. */
function commissionSweep(db) {
  const due = db.prepare("SELECT user_id, COUNT(*) AS n, SUM(amount) AS total FROM commission_entries WHERE status = 'prevista' AND release_on <= ? GROUP BY user_id").all(today());
  const changes = db.prepare("UPDATE commission_entries SET status = 'liberada', updated_at = ? WHERE status = 'prevista' AND release_on <= ?").run(nowIso(), today()).changes;
  for (const d of due) {
    require('./notifications').notify(db, d.user_id, { kind: 'comissao', level: 'ok', title: `Comissão liberada: R$ ${round2(d.total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, body: `${d.n} parcela(s) passaram da carência e estão liberadas para pagamento.`, link: '#/comissoes' });
  }
  return changes;
}

function commissionScope(db, user, alias = 'ce') {
  return ownerScope(db, user, `${alias}.user_id`);
}

function listCommissions(db, user, q = {}) {
  const sc = commissionScope(db, user);
  const where = [sc.sql];
  const params = [...sc.params];
  if (q.competence) {
    where.push('ce.competence = ?');
    params.push(q.competence);
  }
  if (q.user_id) {
    where.push('ce.user_id = ?');
    params.push(Number(q.user_id));
  }
  if (q.status) {
    where.push('ce.status = ?');
    params.push(q.status);
  }
  const rows = db
    .prepare(`SELECT ce.*, u.name AS user_name, s.code AS sale_code, s.credit_value AS sale_credit, s.status AS sale_status, c.name AS contact_name, c.id AS contact_id,
      a.name AS administrator_name, p.name AS plan_name, cn.code AS cancellation_code
      FROM commission_entries ce JOIN sales s ON s.id = ce.sale_id JOIN contacts c ON c.id = s.contact_id LEFT JOIN users u ON u.id = ce.user_id
      LEFT JOIN administrators a ON a.id = s.administrator_id LEFT JOIN products p ON p.id = s.plan_id LEFT JOIN cancellations cn ON cn.id = ce.cancellation_id
      WHERE ${where.join(' AND ')} ORDER BY ce.competence DESC, u.name, ce.id LIMIT 2000`)
    .all(...params);
  return { rows, summary: commissionSummary(db, user, q.user_id ? Number(q.user_id) : null) };
}

/** Resumo do mês: a receber (previstas + liberadas), pagas, estornos e previsão dos próximos 3 meses. */
function commissionSummary(db, user, userId = null) {
  const sc = commissionScope(db, user);
  const extra = userId ? ' AND ce.user_id = ?' : '';
  const params = [...sc.params, ...(userId ? [userId] : [])];
  const month = today().slice(0, 7);
  const next3 = [1, 2, 3].map((i) => monthOf(addMonths(`${month}-01`, i)));
  const sum = (cond, p = []) => db.prepare(`SELECT COALESCE(SUM(ce.amount), 0) AS v FROM commission_entries ce WHERE ${sc.sql}${extra} AND ${cond}`).get(...params, ...p).v;
  return {
    month,
    a_receber_mes: round2(sum("ce.competence = ? AND ce.status IN ('prevista','liberada')", [month])),
    liberado_mes: round2(sum("ce.competence = ? AND ce.status = 'liberada'", [month])),
    pago_mes: round2(sum("ce.competence = ? AND ce.status = 'paga'", [month])),
    estornos_mes: round2(sum("ce.competence = ? AND ce.kind = 'estorno' AND ce.status <> 'cancelada'", [month])),
    previsto_3_meses: round2(sum(`ce.competence IN (${next3.map(() => '?').join(',')}) AND ce.status IN ('prevista','liberada')`, next3)),
  };
}

function payCommissions(db, user, data) {
  requireAdmin(user);
  const ids = (Array.isArray(data.ids) ? data.ids : []).map(Number).filter(Boolean);
  if (!ids.length) throw badRequest('Selecione as comissões a pagar.');
  const now = nowIso();
  const rows = db.prepare(`SELECT * FROM commission_entries WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const invalid = rows.filter((r) => r.status !== 'liberada');
  if (invalid.length) throw badRequest('Somente parcelas liberadas podem ser pagas (as previstas ainda estão na carência).');
  tx(db, () => {
    db.prepare(`UPDATE commission_entries SET status = 'paga', paid_at = ?, paid_by = ?, updated_at = ? WHERE id IN (${ids.map(() => '?').join(',')})`).run(now, user.id, now, ...ids);
    audit(db, user, 'commission', null, 'pagas', { quantidade: ids.length, total: round2(rows.reduce((t, r) => t + r.amount, 0)) });
  });
  return { paid: ids.length };
}

/* =========================================================================
   CANCELAMENTOS
   ========================================================================= */

/**
 * Registra o cancelamento de uma cota vendida. Parcelas futuras de comissão são canceladas e, conforme a política
 * da administradora, as já pagas geram estorno (dedução) para o especialista responsável indicado.
 */
function registerCancellation(db, user, saleId, data) {
  requireManager(user);
  const s = loadSale(db, user, saleId);
  if (s.status !== 'confirmada') throw badRequest('Só é possível registrar cancelamento de vendas confirmadas.');
  const reason = clean(data.reason);
  const description = clean(data.description);
  if (!reason) throw badRequest('Informe o motivo do cancelamento.');
  if (!db.prepare("SELECT 1 FROM options WHERE list = 'motivo_cancelamento' AND value = ?").get(reason)) throw badRequest('Motivo de cancelamento inválido.');
  if (!description || description.length < 10) throw badRequest('Descreva o motivo concreto do cancelamento (mínimo de 10 caracteres).');
  const on = toDateOnly(data.cancelled_on) || today();
  const responsible = data.responsible_id ? Number(data.responsible_id) : s.seller_id;
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(responsible)) throw badRequest('Especialista responsável inválido.');
  const days = Math.max(0, Math.round((Date.parse(on) - Date.parse(s.payment_date)) / 86400000));
  const { chargebackPolicy } = require('./catalog');
  const policy = chargebackPolicy(db, s.administrator_id);
  const now = nowIso();
  return tx(db, () => {
    const code = nextCode(db, 'cancellation', 'CN');
    const r = db.prepare(`INSERT INTO cancellations (code, sale_id, contact_id, seller_id, responsible_id, cancelled_on, days_after_sale, within_7_days, reason, description, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(code, s.id, s.contact_id, s.seller_id, responsible, on, days, days <= 7 ? 1 : 0, reason, description, user.id, now);
    const cid = Number(r.lastInsertRowid);
    db.prepare(`UPDATE commission_entries SET status = 'cancelada', cancellation_id = ?, updated_at = ? WHERE sale_id = ? AND kind IN ('comissao','bonus') AND status IN ('prevista','liberada')`).run(cid, now, s.id);
    let chargeback = 0;
    if (policy.estornar_pagas && days <= policy.ate_dias) {
      const paid = db.prepare("SELECT * FROM commission_entries WHERE sale_id = ? AND kind IN ('comissao','bonus') AND status = 'paga'").all(s.id);
      chargeback = round2(paid.reduce((t, e) => t + e.amount, 0));
      if (chargeback > 0) {
        db.prepare(`INSERT INTO commission_entries (sale_id, user_id, kind, competence, base_value, amount, status, release_on, cancellation_id, notes, created_at, updated_at)
          VALUES (?, ?, 'estorno', ?, ?, ?, 'liberada', ?, ?, ?, ?, ?)`).run(s.id, responsible, today().slice(0, 7), s.credit_value, -chargeback, today(), cid, `Estorno do cancelamento ${code}`, now, now);
      }
    }
    db.prepare('UPDATE cancellations SET chargeback_total = ? WHERE id = ?').run(chargeback, cid);
    db.prepare("UPDATE sales SET status = 'cancelada', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?").run(now, reason, now, s.id);
    // Tarefas da venda (onboarding, confirmação) deixam de valer
    db.prepare("UPDATE tasks SET status = 'cancelada', notes = COALESCE(notes, '') || ?, updated_at = ? WHERE sale_id = ? AND status = 'pendente'").run(`\n[Venda cancelada: ${code}]`, now, s.id);
    db.prepare("UPDATE contracts SET status = 'cancelado', updated_at = ? WHERE sale_id = ? OR id = ?").run(now, s.id, s.contract_id ?? -1);
    require('./postsale').syncTimeline(db, s.contact_id, user.id);
    insertActivity(db, { contact_id: s.contact_id, opportunity_id: s.opportunity_id, type: 'cadastro', notes: `Cancelamento ${code} da venda ${s.code}: ${optionLabel(db, 'motivo_cancelamento', reason)} — ${description}${chargeback ? ` Estorno de comissão: R$ ${chargeback.toFixed(2).replace('.', ',')}.` : ''}`, user_id: user.id });
    audit(db, user, 'sale', s.id, 'cancelada', { cancelamento: code, motivo: reason, dias_apos_venda: days, estorno: chargeback, responsavel: responsible }, s.contact_id);
    require('./notifications').notify(db, [responsible, s.seller_id], { kind: 'cancelamento', level: 'danger', title: `Cancelamento ${code} da venda ${s.code}`, body: `${optionLabel(db, 'motivo_cancelamento', reason)}.${chargeback ? ` Estorno de R$ ${chargeback.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.` : ''}`, link: '#/comissoes?aba=cancelamentos', exclude: user.id });
    return { id: cid, code, chargeback };
  });
}

function listCancellations(db, user, q = {}) {
  const sc = ownerScope(db, user, 'cn.responsible_id');
  const where = [sc.sql];
  const params = [...sc.params];
  if (q.from) {
    where.push('cn.cancelled_on >= ?');
    params.push(q.from.slice(0, 10));
  }
  if (q.to) {
    where.push('cn.cancelled_on <= ?');
    params.push(q.to.slice(0, 10));
  }
  return db
    .prepare(`SELECT cn.*, s.code AS sale_code, s.credit_value, s.payment_date, c.name AS contact_name, us.name AS seller_name, ur.name AS responsible_name, a.name AS administrator_name
      FROM cancellations cn JOIN sales s ON s.id = cn.sale_id JOIN contacts c ON c.id = cn.contact_id LEFT JOIN users us ON us.id = cn.seller_id
      LEFT JOIN users ur ON ur.id = cn.responsible_id LEFT JOIN administrators a ON a.id = s.administrator_id WHERE ${where.join(' AND ')} ORDER BY cn.cancelled_on DESC`)
    .all(...params);
}

/**
 * Indicador de cancelamento por especialista (últimos 12 meses por padrão): evita vendas "empurradas".
 * Taxa = cancelamentos ÷ vendas confirmadas no período. Alerta a partir de 10%.
 */
function cancellationIndicators(db, user, q = {}) {
  const from = (q.from || addMonths(today(), -12)).slice(0, 10);
  const to = (q.to || today()).slice(0, 10);
  const ids = visibleOwnerIds(db, user);
  const users = db.prepare("SELECT id, name, role, active FROM users WHERE role IN ('consultor','gestor') OR id IN (SELECT DISTINCT seller_id FROM sales) ORDER BY name").all()
    .filter((u) => ids === null || ids.includes(u.id));
  return {
    from,
    to,
    rows: users.map((u) => {
      const sales = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(credit_value), 0) AS v FROM sales WHERE seller_id = ? AND status IN ('confirmada','cancelada') AND payment_date BETWEEN ? AND ?").get(u.id, from, to);
      const canc = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(within_7_days), 0) AS n7, COALESCE(SUM(chargeback_total), 0) AS cb FROM cancellations WHERE seller_id = ? AND cancelled_on BETWEEN ? AND ?').get(u.id, from, to);
      const rate = sales.n ? Math.round((canc.n / sales.n) * 1000) / 10 : null;
      return { user_id: u.id, name: u.name, active: u.active, vendas: sales.n, credito: sales.v, cancelamentos: canc.n, cancelamentos_7_dias: canc.n7, estornos: round2(canc.cb), taxa: rate, alerta: rate != null && rate >= 10 };
    }).filter((r) => r.vendas || r.cancelamentos || r.active),
  };
}

module.exports = {
  PRESALE_STEPS, PRESALE_STATUS, stepsFor, PAYMENT_METHODS, isFirstSale, openPreSale, listPreSales, getPreSale, presaleMessage, markSent, onClientLink, advancePreSale, sendFichaEmail,
  savePreSaleQuotas, cancelPreSale, presaleSweep, listSales, getSale, registerAllocation, confirmSale, cancelPendingSale, allocationSweep, quotasOf, generateCommissions, commissionSweep, listCommissions, commissionSummary, payCommissions,
  registerCancellation, listCancellations, cancellationIndicators, addTask, nextBusinessDay, addMonths, addDays, ownerScope, assertOwnerVisible, round2,
};
