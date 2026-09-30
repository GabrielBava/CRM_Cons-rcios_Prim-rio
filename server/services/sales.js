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

const PRESALE_STEPS = [
  ['link_gerado', 'Link gerado'],
  ['acessado', 'Acessado pelo cliente'],
  ['preenchido', 'Concluído pelo cliente'],
  ['conferido', 'Conferido pela equipe'],
  ['termo_adesao', 'Termo de adesão'],
  ['contrato_enviado', 'Contrato enviado'],
  ['contrato_assinado', 'Contrato assinado'],
  ['boleto_emitido', 'Boleto emitido (venda aguardando pagamento)'],
  ['concluida', 'Venda confirmada'],
];
const PRESALE_STATUS = Object.fromEntries([...PRESALE_STEPS, ['cancelada', 'Cancelada']]);
const stepIndex = (s) => PRESALE_STEPS.findIndex(([k]) => k === s);

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
      completed_at, owner_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(code, contact.id, opp.id, p?.id ?? null, p?.product_id ?? opp.product_id ?? null, first ? 1 : 0, linkId, status, p?.credit_value ?? opp.credit_value ?? null,
      p?.term_months ?? opp.term_months ?? null, p?.initial_installment ?? null, first ? null : now, opp.owner_id ?? user.id, user.id, now, now);
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
  r.step = stepIndex(r.status);
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
  const all = db.prepare(`SELECT ps.status, ps.sent_at, ps.accessed_at, ps.created_at FROM pre_sales ps WHERE ${sc.sql}`).all(...sc.params).map((r) => decoratePreSale(db, r, alertHours));
  const count = (f) => all.filter(f).length;
  const summary = {
    geradas: all.length,
    enviadas: count((r) => r.sent_at || stepIndex(r.status) >= 1),
    acessadas: count((r) => stepIndex(r.status) >= 1),
    concluidas_cliente: count((r) => stepIndex(r.status) >= 2),
    em_andamento: count((r) => stepIndex(r.status) >= 3 && stepIndex(r.status) <= 7),
    convertidas: count((r) => r.status === 'concluida'),
    paradas: count((r) => r.stale),
  };
  return { rows, summary, steps: PRESALE_STEPS };
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
  row.steps = PRESALE_STEPS;
  row.history = db.prepare("SELECT a.action, a.changes, a.created_at, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.entity = 'pre_sale' AND a.entity_id = ? ORDER BY a.id").all(ps.id)
    .map((h) => ({ ...h, changes: h.changes ? JSON.parse(h.changes) : null }));
  return row;
}

/** Mensagem e links para enviar o cadastro ao cliente (WhatsApp ou e-mail). */
function presaleMessage(db, ps, url) {
  const company = getSetting(db, 'company_name') || 'nossa equipe';
  const first = String(ps.contact_name || '').split(/\s+/)[0] || '';
  const text =
    `Olá, ${first}! Para darmos sequência à sua adesão ao consórcio, preencha o seu cadastro neste link seguro:\n${url}\n\n` +
    'Leva cerca de 10 minutos. Tenha em mãos: documento de identificação, comprovante de endereço e comprovante de renda. ' +
    `Seus dados são usados apenas para formalizar a adesão junto à administradora, conforme a LGPD. Qualquer dúvida, fale comigo. — ${company}`;
  const phone = String(ps.contact_whatsapp || ps.contact_phone || '').replace(/\D/g, '');
  return {
    text,
    whatsapp_url: phone ? `https://wa.me/${phone.length <= 11 ? `55${phone}` : phone}?text=${encodeURIComponent(text)}` : null,
    email_url: ps.contact_email ? `mailto:${ps.contact_email}?subject=${encodeURIComponent(getSetting(db, 'presale_email_subject') || 'Seu cadastro para a adesão ao consórcio')}&body=${encodeURIComponent(text)}` : null,
  };
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
  }
  if (event === 'complete' && stepIndex(ps.status) < 2) {
    db.prepare("UPDATE pre_sales SET status = 'preenchido', accessed_at = COALESCE(accessed_at, ?), completed_at = ?, updated_at = ? WHERE id = ?").run(now, now, now, ps.id);
    audit(db, null, 'pre_sale', ps.id, 'concluida_pelo_cliente', null, ps.contact_id);
    addTask(db, { contact_id: ps.contact_id, opportunity_id: ps.opportunity_id, type: 'pre_venda', title: `Conferir o cadastro enviado pelo cliente (${ps.code})`, notes: 'Valide os documentos enviados e confira os dados antes do termo de adesão.', due_at: new Date(Date.now() + 4 * 3600000).toISOString(), assigned_to: ps.owner_id, pre_sale_id: ps.id, priority: 'alta' });
  }
}

/**
 * Avança a pré-venda uma etapa por vez, com os dados de cada etapa:
 * conferido (ficha completa) → termo_adesao (plano, crédito, prazo, nº da adesão) → contrato_enviado → contrato_assinado
 * → boleto_emitido (valor e vencimento; cria a venda aguardando pagamento).
 */
function advancePreSale(db, user, id, data) {
  const ps = loadPreSale(db, user, id, true);
  const to = data.step;
  const iTo = stepIndex(to);
  if (iTo < 3 || iTo > 7) throw badRequest('Etapa inválida para avanço manual.');
  if (['cancelada', 'concluida'].includes(ps.status)) throw badRequest('Esta pré-venda está encerrada.');
  const iFrom = stepIndex(ps.status);
  if (iTo !== iFrom + 1 && !(iTo === 3 && iFrom < 3)) {
    throw badRequest(`Siga a sequência: a próxima etapa é "${PRESALE_STEPS[Math.min(iFrom + 1, 7)][1]}".`);
  }
  const now = nowIso();
  const upd = { status: to, updated_at: now };
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(ps.contact_id);
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
    const credit = toNumber(data.credit_value ?? ps.credit_value);
    if (!credit || credit <= 0) throw badRequest('Informe o valor do crédito.');
    const err = require('./catalog').creditError(plan, credit);
    if (err) throw badRequest(err);
    upd.plan_id = plan.id;
    upd.credit_value = credit;
    upd.term_months = toNumber(data.term_months ?? ps.term_months ?? plan.term_months);
    upd.installment_value = toNumber(data.installment_value ?? ps.installment_value);
    upd.adhesion_number = clean(data.adhesion_number) ?? ps.adhesion_number;
    upd.adhesion_at = toDateOnly(data.adhesion_at) || today();
  }
  if (to === 'contrato_enviado') upd.contract_sent_at = toDateOnly(data.date) || today();
  if (to === 'contrato_assinado') upd.contract_signed_at = toDateOnly(data.date) || today();
  if (to === 'boleto_emitido') {
    upd.boleto_value = toNumber(data.boleto_value);
    upd.boleto_due = toDateOnly(data.boleto_due);
    if (!upd.boleto_value || !upd.boleto_due) throw badRequest('Informe o valor e o vencimento do boleto.');
    upd.boleto_issued_at = now;
  }
  return tx(db, () => {
    const keys = Object.keys(upd);
    db.prepare(`UPDATE pre_sales SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => upd[k] ?? null), ps.id);
    let sale = null;
    if (to === 'boleto_emitido') {
      const cur = { ...ps, ...upd };
      sale = createSale(db, user, cur);
      db.prepare('UPDATE pre_sales SET sale_id = ? WHERE id = ?').run(sale.id, ps.id);
    }
    insertActivity(db, { contact_id: ps.contact_id, opportunity_id: ps.opportunity_id, type: 'cadastro', notes: `Pré-venda ${ps.code}: ${PRESALE_STATUS[to]}.${sale ? ` Venda ${sale.code} registrada, aguardando o pagamento.` : ''}`, user_id: user.id });
    audit(db, user, 'pre_sale', ps.id, to, Object.fromEntries(Object.entries(upd).filter(([k]) => !['status', 'updated_at'].includes(k))), ps.contact_id);
    db.prepare("UPDATE tasks SET status = 'concluida', completed_at = ?, completed_by = ?, updated_at = ? WHERE pre_sale_id = ? AND status = 'pendente' AND priority = 'urgente'").run(now, user.id, now, ps.id);
    return { ok: true, sale };
  });
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
      db.prepare('UPDATE pre_sales SET alert_status = ? WHERE id = ?').run(ps.status, ps.id);
    });
    n++;
  }
  return n;
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
      adhesion_number, adhesion_date, boleto_value, boleto_due, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'aguardando_pagamento', ?, ?, ?)`)
    .run(code, ps.contact_id, ps.opportunity_id ?? null, ps.proposal_id ?? null, ps.id, plan?.id ?? null, plan?.administrator_id ?? null, ps.owner_id ?? opp?.owner_id ?? user.id,
      plan?.category ?? opp?.credit_category ?? null, ps.credit_value, ps.term_months ?? null, ps.installment_value ?? null, ps.adhesion_number ?? null, ps.adhesion_at ?? null,
      ps.boleto_value ?? null, ps.boleto_due ?? null, user.id, now, now);
  const id = Number(r.lastInsertRowid);
  addTask(db, { contact_id: ps.contact_id, opportunity_id: ps.opportunity_id, type: 'venda', title: `Confirmar pagamento da venda ${code}`, notes: `Boleto com vencimento em ${ps.boleto_due ? ps.boleto_due.split('-').reverse().join('/') : '—'}. Anexe o comprovante em Vendas para confirmar.`, due_at: ps.boleto_due ? `${ps.boleto_due}T15:00:00.000Z` : nextBusinessDay(), assigned_to: ps.owner_id, sale_id: id, created_by: user.id });
  audit(db, user, 'sale', id, 'registrada', { code, credito: ps.credit_value }, ps.contact_id);
  return { id, code };
}

const SALE_SELECT = `SELECT s.*, c.name AS contact_name, c.code AS contact_code, o.code AS opportunity_code, p.name AS plan_name, a.name AS administrator_name,
  u.name AS seller_name, ps.code AS pre_sale_code, k.code AS contract_code, pr.code AS proposal_code, cf.name AS confirmed_by_name,
  cn.code AS cancellation_code, cn.reason AS cancellation_reason
  FROM sales s JOIN contacts c ON c.id = s.contact_id LEFT JOIN opportunities o ON o.id = s.opportunity_id LEFT JOIN products p ON p.id = s.plan_id
  LEFT JOIN administrators a ON a.id = s.administrator_id LEFT JOIN users u ON u.id = s.seller_id LEFT JOIN pre_sales ps ON ps.id = s.pre_sale_id
  LEFT JOIN contracts k ON k.id = s.contract_id LEFT JOIN proposals pr ON pr.id = s.proposal_id LEFT JOIN users cf ON cf.id = s.confirmed_by
  LEFT JOIN cancellations cn ON cn.sale_id = s.id`;

function listSales(db, user, q = {}) {
  const sc = ownerScope(db, user, 's.seller_id');
  const where = [sc.sql];
  const params = [...sc.params];
  if (q.status) {
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
    where.push('(c.name LIKE ? OR s.code = ? OR c.code = ?)');
    params.push(`%${q.q}%`, String(q.q).toUpperCase(), String(q.q).toUpperCase());
  }
  const rows = db.prepare(`${SALE_SELECT} WHERE ${where.join(' AND ')} ORDER BY s.status = 'aguardando_pagamento' DESC, s.created_at DESC LIMIT 500`).all(...params);
  const month = today().slice(0, 7);
  const base = db.prepare(`SELECT s.status, s.credit_value, s.payment_date, s.cancelled_at FROM sales s WHERE ${sc.sql}`).all(...sc.params);
  const summary = {
    aguardando: base.filter((s) => s.status === 'aguardando_pagamento').length,
    aguardando_valor: base.filter((s) => s.status === 'aguardando_pagamento').reduce((t, s) => t + s.credit_value, 0),
    confirmadas_mes: base.filter((s) => s.status !== 'aguardando_pagamento' && s.payment_date && monthOf(s.payment_date) === month).length,
    credito_mes: base.filter((s) => s.status !== 'aguardando_pagamento' && s.payment_date && monthOf(s.payment_date) === month).reduce((t, s) => t + s.credit_value, 0),
    canceladas_mes: base.filter((s) => s.status === 'cancelada' && s.cancelled_at && monthOf(s.cancelled_at) === month).length,
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
  row.commissions = db.prepare('SELECT ce.*, u.name AS user_name FROM commission_entries ce LEFT JOIN users u ON u.id = ce.user_id WHERE ce.sale_id = ? ORDER BY ce.competence, ce.id').all(s.id);
  row.cancellation = db.prepare('SELECT cn.*, u.name AS responsible_name FROM cancellations cn LEFT JOIN users u ON u.id = cn.responsible_id WHERE cn.sale_id = ?').get(s.id) || null;
  row.payment_attachment = s.payment_attachment_id ? db.prepare('SELECT id, filename, size, created_at FROM attachments WHERE id = ?').get(s.payment_attachment_id) : null;
  row.history = db.prepare("SELECT a.action, a.changes, a.created_at, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.entity = 'sale' AND a.entity_id = ? ORDER BY a.id").all(s.id)
    .map((h) => ({ ...h, changes: h.changes ? JSON.parse(h.changes) : null }));
  return row;
}

/**
 * Confirma o pagamento: exige o comprovante. Registra o produto contratado no cliente, leva o negócio para "Venda",
 * gera as comissões e cria a tarefa de onboarding.
 */
function confirmSale(db, user, id, data) {
  const s = loadSale(db, user, id);
  loadContact(db, user, s.contact_id, { write: true });
  if (s.status !== 'aguardando_pagamento') throw badRequest('Esta venda não está aguardando pagamento.');
  const paymentDate = toDateOnly(data.payment_date);
  if (!paymentDate) throw badRequest('Informe a data do pagamento.');
  if (paymentDate > today()) throw badRequest('A data do pagamento não pode ser futura.');
  if (!data.content_base64 || !data.filename) throw badRequest('Anexe o comprovante de pagamento para confirmar a venda.');
  const record = require('./record');
  const now = nowIso();
  return tx(db, () => {
    const attId = record.insertAttachment(db, s.contact_id, { doc_type: 'comprovante_pagamento', filename: data.filename, mime: data.mime, content_base64: data.content_base64, notes: `Comprovante da venda ${s.code}`, opportunity_ids: s.opportunity_id ? [s.opportunity_id] : [] }, { userId: user.id });
    const plan = s.plan_id ? db.prepare('SELECT * FROM products WHERE id = ?').get(s.plan_id) : null;
    const { createContractRow } = require('./clients');
    const contract = createContractRow(db, user, {
      contact_id: s.contact_id,
      opportunity_id: s.opportunity_id,
      product_id: s.plan_id,
      category: s.category,
      administrator: plan?.administrator,
      group_code: clean(data.group_code) ?? s.group_code,
      quota_code: clean(data.quota_code) ?? s.quota_code,
      credit_value: s.credit_value,
      term_months: s.term_months,
      installment_value: s.installment_value,
      contract_number: s.adhesion_number,
      contracted_at: s.adhesion_date || paymentDate,
      first_due_date: paymentDate,
      seller_id: s.seller_id,
      status: 'ativo',
    });
    db.prepare(`UPDATE sales SET status = 'confirmada', payment_date = ?, payment_attachment_id = ?, confirmed_at = ?, confirmed_by = ?, contract_id = ?,
      group_code = COALESCE(?, group_code), quota_code = COALESCE(?, quota_code), updated_at = ? WHERE id = ?`)
      .run(paymentDate, attId, now, user.id, contract.id, clean(data.group_code) ?? null, clean(data.quota_code) ?? null, now, s.id);
    if (s.pre_sale_id) db.prepare("UPDATE pre_sales SET status = 'concluida', updated_at = ? WHERE id = ?").run(now, s.pre_sale_id);
    // Negócio vai para "Venda" (única forma de chegar a essa etapa)
    if (s.opportunity_id) {
      const won = db.prepare("SELECT id FROM pipeline_stages WHERE kind = 'ganho' AND active = 1 LIMIT 1").get();
      const opp = db.prepare('SELECT stage_id FROM opportunities WHERE id = ?').get(s.opportunity_id);
      if (won && opp && opp.stage_id !== won.id) require('./opportunities').moveStage(db, user, s.opportunity_id, { stage_id: won.id, reason: `Venda ${s.code} confirmada` }, { fromSale: true });
    } else {
      db.prepare("UPDATE contacts SET relationship = 'cliente', client_status = 'ativo', lead_status = 'convertido', converted_at = COALESCE(converted_at, ?) WHERE id = ?").run(now, s.contact_id);
    }
    // Preferências de comunicação informadas no onboarding
    const prefs = {};
    if (clean(data.pref_channel)) prefs.pref_channel = clean(data.pref_channel);
    if (clean(data.pref_time)) prefs.pref_time = clean(data.pref_time);
    if (Object.keys(prefs).length) {
      db.prepare(`UPDATE contacts SET ${Object.keys(prefs).map((k) => `${k} = ?`).join(', ')}, pref_updated_at = ?, pref_source = ? WHERE id = ?`).run(...Object.values(prefs), now, 'Informado na confirmação da venda', s.contact_id);
    }
    const comm = generateCommissions(db, { ...s, payment_date: paymentDate });
    db.prepare("UPDATE tasks SET status = 'concluida', completed_at = ?, completed_by = ?, updated_at = ? WHERE sale_id = ? AND status = 'pendente'").run(now, user.id, now, s.id);
    addTask(db, {
      contact_id: s.contact_id,
      opportunity_id: s.opportunity_id,
      type: 'onboarding',
      title: `Onboarding do cliente (venda ${s.code})`,
      notes: 'Boas-vindas: explique como funciona o acompanhamento (assembleias, lances, boletos e contemplação), confirme o canal e o melhor horário de contato e registre a estratégia de lance no Pós-venda.',
      due_at: nextBusinessDay(10, 0),
      assigned_to: s.seller_id,
      priority: 'alta',
      sale_id: s.id,
      created_by: user.id,
    });
    insertActivity(db, { contact_id: s.contact_id, opportunity_id: s.opportunity_id, type: 'cadastro', notes: `Venda ${s.code} confirmada: pagamento em ${paymentDate.split('-').reverse().join('/')}. Produto contratado ${contract.code} registrado.${comm.count ? ` ${comm.count} parcela(s) de comissão prevista(s).` : ' Sem tabela de comissão cadastrada para o plano/administradora.'}`, user_id: user.id });
    audit(db, user, 'sale', s.id, 'confirmada', { pagamento: paymentDate, contrato: contract.code, comissoes: comm.count }, s.contact_id);
    return { ok: true, contract, commissions: comm.count };
  });
}

function cancelPendingSale(db, user, id, data) {
  const s = loadSale(db, user, id);
  loadContact(db, user, s.contact_id, { write: true });
  if (s.status !== 'aguardando_pagamento') throw badRequest('Para vendas confirmadas, registre o cancelamento em Comissões e cancelamentos.');
  const reason = clean(data.reason);
  if (!reason) throw badRequest('Informe o motivo.');
  const now = nowIso();
  tx(db, () => {
    db.prepare("UPDATE sales SET status = 'cancelada', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?").run(now, reason, now, s.id);
    if (s.pre_sale_id) db.prepare("UPDATE pre_sales SET status = 'cancelada', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?").run(now, reason, now, s.pre_sale_id);
    db.prepare("UPDATE tasks SET status = 'cancelada', updated_at = ? WHERE sale_id = ? AND status = 'pendente'").run(now, s.id);
    insertActivity(db, { contact_id: s.contact_id, opportunity_id: s.opportunity_id, type: 'cadastro', notes: `Venda ${s.code} cancelada antes do pagamento: ${reason}`, user_id: user.id });
    audit(db, user, 'sale', s.id, 'cancelada_antes_do_pagamento', { motivo: reason }, s.contact_id);
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

/** Libera as parcelas cuja carência (ex.: 7 dias sem cancelamento) já passou. */
function commissionSweep(db) {
  return db.prepare("UPDATE commission_entries SET status = 'liberada', updated_at = ? WHERE status = 'prevista' AND release_on <= ?").run(nowIso(), today()).changes;
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
    db.prepare(`UPDATE commission_entries SET status = 'cancelada', cancellation_id = ?, updated_at = ? WHERE sale_id = ? AND kind = 'comissao' AND status IN ('prevista','liberada')`).run(cid, now, s.id);
    let chargeback = 0;
    if (policy.estornar_pagas && days <= policy.ate_dias) {
      const paid = db.prepare("SELECT * FROM commission_entries WHERE sale_id = ? AND kind = 'comissao' AND status = 'paga'").all(s.id);
      chargeback = round2(paid.reduce((t, e) => t + e.amount, 0));
      if (chargeback > 0) {
        db.prepare(`INSERT INTO commission_entries (sale_id, user_id, kind, competence, base_value, amount, status, release_on, cancellation_id, notes, created_at, updated_at)
          VALUES (?, ?, 'estorno', ?, ?, ?, 'liberada', ?, ?, ?, ?, ?)`).run(s.id, responsible, today().slice(0, 7), s.credit_value, -chargeback, today(), cid, `Estorno do cancelamento ${code}`, now, now);
      }
    }
    db.prepare('UPDATE cancellations SET chargeback_total = ? WHERE id = ?').run(chargeback, cid);
    db.prepare("UPDATE sales SET status = 'cancelada', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?").run(now, reason, now, s.id);
    if (s.contract_id) db.prepare("UPDATE contracts SET status = 'cancelado', updated_at = ? WHERE id = ?").run(now, s.contract_id);
    insertActivity(db, { contact_id: s.contact_id, opportunity_id: s.opportunity_id, type: 'cadastro', notes: `Cancelamento ${code} da venda ${s.code}: ${optionLabel(db, 'motivo_cancelamento', reason)} — ${description}${chargeback ? ` Estorno de comissão: R$ ${chargeback.toFixed(2).replace('.', ',')}.` : ''}`, user_id: user.id });
    audit(db, user, 'sale', s.id, 'cancelada', { cancelamento: code, motivo: reason, dias_apos_venda: days, estorno: chargeback, responsavel: responsible }, s.contact_id);
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
  PRESALE_STEPS, PRESALE_STATUS, isFirstSale, openPreSale, listPreSales, getPreSale, presaleMessage, markSent, onClientLink, advancePreSale, cancelPreSale, presaleSweep,
  listSales, getSale, confirmSale, cancelPendingSale, generateCommissions, commissionSweep, listCommissions, commissionSummary, payCommissions,
  registerCancellation, listCancellations, cancellationIndicators, addTask, nextBusinessDay, addMonths, addDays, ownerScope, assertOwnerVisible, round2,
};
