'use strict';
/**
 * Cadastros do administrador: administradoras (contatos, portal, repasse e comissão) e planos de consórcio
 * (taxas, prazo, lances, adesão, reajuste e faixa de crédito com incremento).
 */
const { requireAdmin, audit, optionLabel } = require('../core');
const { badRequest, notFound, clean, toNumber, digits, isValidCNPJ, normalizeEmail, isValidEmail, nowIso, sealSecret, openSecret } = require('../util');
const { nextCode } = require('../db');

/* ------------------------- Tabelas de parcelas (repasse e comissão) ------------------------- */

/**
 * Tabela de pagamento em parcelas, em % do crédito vendido. Ex.: comissão de 0,6% paga em 4 vezes:
 * [{ n: 1, month_offset: 0, pct: 0.3, release_after_days: 7 }, { n: 2, month_offset: 1, pct: 0.1 }, …]
 * release_after_days: a parcela só é liberada se a cota não for cancelada nesse prazo (ex.: 7 dias do direito de arrependimento).
 */
function normalizeSchedule(v, label) {
  let arr = v;
  if (typeof v === 'string') {
    try {
      arr = JSON.parse(v || '[]');
    } catch {
      throw badRequest(`Tabela de ${label} inválida.`);
    }
  }
  if (!Array.isArray(arr)) throw badRequest(`Tabela de ${label} inválida.`);
  const out = arr
    .filter((r) => r && (r.pct !== '' && r.pct != null))
    .map((r, i) => {
      const pct = toNumber(r.pct);
      const off = r.month_offset === '' || r.month_offset == null ? i : Number(r.month_offset);
      const rel = r.release_after_days === '' || r.release_after_days == null ? 0 : Number(r.release_after_days);
      if (pct == null || pct < 0 || pct > 100) throw badRequest(`Percentual inválido na parcela ${i + 1} da tabela de ${label}.`);
      if (!Number.isInteger(off) || off < 0 || off > 120) throw badRequest(`Mês inválido na parcela ${i + 1} da tabela de ${label}.`);
      if (!Number.isInteger(rel) || rel < 0 || rel > 365) throw badRequest(`Carência inválida na parcela ${i + 1} da tabela de ${label}.`);
      return { n: i + 1, month_offset: off, pct, release_after_days: rel };
    });
  return out;
}
const scheduleTotal = (s) => Math.round(s.reduce((t, r) => t + r.pct, 0) * 10000) / 10000;
const parseJson = (v, fb) => {
  try {
    return typeof v === 'string' ? JSON.parse(v) : v ?? fb;
  } catch {
    return fb;
  }
};

/* ------------------------- Administradoras ------------------------- */

const ADM_TEXT = ['name', 'website', 'portal_url', 'portal_login', 'direct_name', 'direct_phone', 'commercial_name', 'commercial_phone',
  'manager_name', 'manager_phone', 'payout_method', 'payout_policy', 'notes'];

function decorateAdm(a) {
  const commission = parseJson(a.commission_schedule, []);
  const payout = parseJson(a.payout_schedule, []);
  // A senha do portal nunca sai na listagem: só a indicação de que existe (leitura sob demanda, auditada)
  const { portal_password_enc: enc, ...rest } = a;
  return {
    ...rest,
    portal_password_set: !!enc,
    commission_schedule: commission,
    payout_schedule: payout,
    chargeback_policy: { estornar_pagas: true, ate_dias: 365, ...parseJson(a.chargeback_policy, {}) },
    commission_total: scheduleTotal(commission),
    payout_total: scheduleTotal(payout),
  };
}

function listAdministrators(db, user) {
  const rows = db
    .prepare(`SELECT a.*, (SELECT COUNT(*) FROM products p WHERE p.administrator_id = a.id AND p.active = 1) AS plans,
      (SELECT COUNT(*) FROM sales s WHERE s.administrator_id = a.id AND s.status = 'confirmada') AS sales
      FROM administrators a ORDER BY a.active DESC, a.name`)
    .all()
    .map(decorateAdm);
  if (user.role === 'admin') return rows;
  // Demais perfis veem só o nome (para escolher o plano); contatos, portal e políticas são do administrador
  return rows.map(({ id, code, name, active }) => ({ id, code, name, active }));
}

function saveAdministrator(db, user, data) {
  requireAdmin(user);
  const o = {};
  for (const f of ADM_TEXT) if (data[f] !== undefined) o[f] = clean(data[f]);
  if (!o.name && !data.id) throw badRequest('Informe o nome da administradora.');
  if (data.cnpj !== undefined) {
    const d = digits(data.cnpj);
    if (d && !isValidCNPJ(d)) throw badRequest('CNPJ inválido.');
    o.cnpj = d || null;
  }
  for (const f of ['direct_email', 'commercial_email', 'manager_email']) {
    if (data[f] !== undefined) {
      const e = normalizeEmail(data[f]);
      if (e && !isValidEmail(e)) throw badRequest('E-mail inválido.');
      o[f] = e;
    }
  }
  for (const f of ['website', 'portal_url']) {
    if (o[f] && !/^https?:\/\//i.test(o[f])) o[f] = `https://${o[f]}`;
  }
  if (data.payout_day !== undefined) {
    const n = data.payout_day === '' || data.payout_day == null ? null : Number(data.payout_day);
    if (n != null && (!Number.isInteger(n) || n < 1 || n > 31)) throw badRequest('Dia do repasse deve estar entre 1 e 31.');
    o.payout_day = n;
  }
  if (data.commission_schedule !== undefined) o.commission_schedule = JSON.stringify(normalizeSchedule(data.commission_schedule, 'comissão'));
  if (data.payout_schedule !== undefined) o.payout_schedule = JSON.stringify(normalizeSchedule(data.payout_schedule, 'repasse'));
  if (data.chargeback_policy !== undefined) {
    const cp = parseJson(data.chargeback_policy, {});
    const dias = cp.ate_dias === '' || cp.ate_dias == null ? 365 : Number(cp.ate_dias);
    if (!Number.isInteger(dias) || dias < 0 || dias > 3650) throw badRequest('Prazo de estorno inválido.');
    o.chargeback_policy = JSON.stringify({ estornar_pagas: cp.estornar_pagas !== false && cp.estornar_pagas !== 'false', ate_dias: dias });
  }
  if (data.active !== undefined) o.active = data.active ? 1 : 0;
  const now = nowIso();
  // Senha do portal: cifrada no banco; em branco mantém a atual, "remover" apaga
  const newPassword = data.portal_password != null && String(data.portal_password) !== '' ? String(data.portal_password) : null;
  if (newPassword) {
    if (newPassword.length > 200) throw badRequest('Senha do portal muito longa.');
    o.portal_password_enc = sealSecret(newPassword);
    o.portal_password_updated_at = now;
    o.portal_password_updated_by = user.id;
  } else if (data.portal_password_clear === true || data.portal_password_clear === 'true') {
    o.portal_password_enc = null;
    o.portal_password_updated_at = now;
    o.portal_password_updated_by = user.id;
  }
  if (data.id) {
    const a = db.prepare('SELECT * FROM administrators WHERE id = ?').get(Number(data.id));
    if (!a) throw notFound('Administradora não encontrada.');
    const keys = Object.keys(o);
    if (keys.length) db.prepare(`UPDATE administrators SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => o[k] ?? null), now, a.id);
    // Planos continuam mostrando o nome atualizado
    if (o.name) db.prepare('UPDATE products SET administrator = ? WHERE administrator_id = ?').run(o.name, a.id);
    audit(db, user, 'administrator', a.id, 'alterada', { campos: keys.map((k) => (k === 'portal_password_enc' ? 'senha do portal' : k)).filter((k) => !k.startsWith('portal_password_updated')) });
    return a.id;
  }
  const row = { ...o, code: nextCode(db, 'administrator', 'ADM'), created_at: now, updated_at: now };
  const cols = Object.keys(row);
  const r = db.prepare(`INSERT INTO administrators (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c] ?? null));
  audit(db, user, 'administrator', Number(r.lastInsertRowid), 'criada', { nome: o.name });
  return Number(r.lastInsertRowid);
}

/** Mostra a senha do portal (só o administrador; cada consulta fica na auditoria). */
function revealPortalPassword(db, user, id) {
  requireAdmin(user);
  const a = db.prepare('SELECT id, name, portal_password_enc FROM administrators WHERE id = ?').get(Number(id));
  if (!a) throw notFound('Administradora não encontrada.');
  if (!a.portal_password_enc) throw badRequest('Nenhuma senha cadastrada para esta administradora.');
  const password = openSecret(a.portal_password_enc);
  if (password == null) throw badRequest('Não foi possível abrir a senha: a chave de cifragem do servidor mudou. Cadastre a senha novamente.');
  audit(db, user, 'administrator', a.id, 'senha_portal_consultada', {});
  return { password };
}

/* ------------------------- Planos ------------------------- */

const INDEXES = { pre5: 'Pré-fixado 5% a.a.', pre6: 'Pré-fixado 6% a.a.', ipca: 'IPCA', incc: 'INCC', inpc: 'INPC', outro: 'Outro índice' };

function decoratePlan(p) {
  return { ...p, commission_schedule: p.commission_schedule ? parseJson(p.commission_schedule, null) : null, index_label: p.readjustment_index === 'outro' ? p.readjustment_other || 'Outro índice' : INDEXES[p.readjustment_index] || null };
}

function listPlans(db, q = {}) {
  const where = ['1=1'];
  const params = [];
  if (q.administrator_id) {
    where.push('p.administrator_id = ?');
    params.push(Number(q.administrator_id));
  }
  if (q.active === '1') where.push('p.active = 1');
  if (q.active === '0') where.push('p.active = 0');
  return db
    .prepare(`SELECT p.*, a.name AS administrator_name, a.code AS administrator_code FROM products p LEFT JOIN administrators a ON a.id = p.administrator_id
      WHERE ${where.join(' AND ')} ORDER BY p.active DESC, a.name, p.name`)
    .all(...params)
    .map(decoratePlan);
}

const pct = (v, label) => {
  const n = toNumber(v);
  if (n != null && (n < 0 || n > 100)) throw badRequest(`${label}: informe um percentual entre 0 e 100.`);
  return n;
};

function savePlan(db, user, data) {
  requireAdmin(user);
  const o = {};
  for (const f of ['name', 'plan_code', 'description', 'notes', 'readjustment_other', 'term_options']) if (data[f] !== undefined) o[f] = clean(data[f]);
  if (!data.id && !o.name) throw badRequest('Informe o nome do plano.');
  if (data.category !== undefined) {
    o.category = clean(data.category);
    if (o.category && !db.prepare("SELECT 1 FROM options WHERE list = 'categoria_credito' AND value = ?").get(o.category)) throw badRequest('Categoria inválida.');
  }
  if (data.administrator_id !== undefined) {
    o.administrator_id = data.administrator_id ? Number(data.administrator_id) : null;
    const a = o.administrator_id && db.prepare('SELECT name FROM administrators WHERE id = ?').get(o.administrator_id);
    if (o.administrator_id && !a) throw badRequest('Administradora inválida.');
    o.administrator = a ? a.name : null;
  }
  if (data.admin_fee_pct !== undefined) o.admin_fee_pct = pct(data.admin_fee_pct, 'Taxa de administração');
  if (data.reserve_fund_pct !== undefined) o.reserve_fund_pct = pct(data.reserve_fund_pct, 'Fundo de reserva');
  if (data.insurance_pct !== undefined) o.insurance_pct = pct(data.insurance_pct, 'Seguro');
  if (data.term_months !== undefined) {
    const n = toNumber(data.term_months);
    if (n != null && (!Number.isInteger(n) || n < 1 || n > 420)) throw badRequest('Prazo deve ser um número inteiro de meses (até 420).');
    o.term_months = n;
  }
  if (o.term_options) {
    const opts = o.term_options.split(/[;, ]+/).filter(Boolean).map(Number);
    if (opts.some((n) => !Number.isInteger(n) || n < 1 || n > 420)) throw badRequest('Prazos disponíveis: informe meses separados por vírgula (ex.: 180, 200, 220).');
    o.term_options = opts.join(', ');
  }
  for (const [flag, field, label] of [['embedded_bid', 'embedded_bid_pct', 'Lance embutido'], ['fixed_bid', 'fixed_bid_pct', 'Lance fixo'], ['adhesion', 'adhesion_pct', 'Adesão']]) {
    if (data[flag] !== undefined) o[flag] = data[flag] && data[flag] !== 'false' ? 1 : 0;
    if (data[field] !== undefined) o[field] = pct(data[field], label);
    if (o[flag] === 1 && (o[field] ?? data[field]) == null) throw badRequest(`${label}: informe o percentual.`);
    if (o[flag] === 0) o[field] = null;
  }
  if (data.adhesion_months !== undefined) {
    const n = toNumber(data.adhesion_months);
    if (n != null && (!Number.isInteger(n) || n < 1 || n > 120)) throw badRequest('Diluição da adesão: informe o número de meses.');
    o.adhesion_months = o.adhesion === 0 ? null : n;
  }
  if (data.readjustment_index !== undefined) {
    o.readjustment_index = clean(data.readjustment_index);
    if (o.readjustment_index && !INDEXES[o.readjustment_index]) throw badRequest('Índice de reajuste inválido.');
  }
  for (const f of ['credit_min', 'credit_max', 'credit_step']) {
    if (data[f] !== undefined) {
      o[f] = toNumber(data[f]);
      if (o[f] != null && o[f] <= 0) throw badRequest('Valores de crédito devem ser maiores que zero.');
    }
  }
  const min = o.credit_min ?? null;
  const max = o.credit_max ?? null;
  if (min != null && max != null && min > max) throw badRequest('O crédito mínimo não pode ser maior que o máximo.');
  if (o.credit_step != null && min != null && max != null && Math.round((max - min) * 100) % Math.round(o.credit_step * 100) !== 0) {
    throw badRequest('O intervalo entre crédito mínimo e máximo precisa ser múltiplo do incremento.');
  }
  if (data.commission_schedule !== undefined) {
    const sch = data.commission_schedule === null || data.commission_schedule === '' ? [] : normalizeSchedule(data.commission_schedule, 'comissão');
    o.commission_schedule = sch.length ? JSON.stringify(sch) : null;
  }
  if (data.active !== undefined) o.active = data.active ? 1 : 0;
  const now = nowIso();
  // Senha do portal: cifrada no banco; em branco mantém a atual, "remover" apaga
  const newPassword = data.portal_password != null && String(data.portal_password) !== '' ? String(data.portal_password) : null;
  if (newPassword) {
    if (newPassword.length > 200) throw badRequest('Senha do portal muito longa.');
    o.portal_password_enc = sealSecret(newPassword);
    o.portal_password_updated_at = now;
    o.portal_password_updated_by = user.id;
  } else if (data.portal_password_clear === true || data.portal_password_clear === 'true') {
    o.portal_password_enc = null;
    o.portal_password_updated_at = now;
    o.portal_password_updated_by = user.id;
  }
  // Código do plano: identifica o plano na proposta e no simulador (único por administradora)
  if (o.plan_code) {
    const admId = o.administrator_id !== undefined ? o.administrator_id : db.prepare('SELECT administrator_id FROM products WHERE id = ?').get(Number(data.id) || 0)?.administrator_id;
    const dup = db.prepare('SELECT id, plan_code FROM products WHERE plan_code = ? COLLATE NOCASE AND COALESCE(administrator_id, 0) = COALESCE(?, 0) AND id <> ?').get(o.plan_code, admId ?? null, Number(data.id) || 0);
    if (dup) throw badRequest(`Já existe um plano com o código ${dup.plan_code} nesta administradora.`);
  }
  if (data.id) {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(data.id));
    if (!p) throw notFound('Plano não encontrado.');
    const keys = Object.keys(o);
    if (keys.length) db.prepare(`UPDATE products SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => o[k] ?? null), now, p.id);
    audit(db, user, 'product', p.id, 'alterado', { campos: keys });
    return p.id;
  }
  const row = { ...o, created_at: now, updated_at: now };
  const cols = Object.keys(row);
  const r = db.prepare(`INSERT INTO products (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c] ?? null));
  audit(db, user, 'product', Number(r.lastInsertRowid), 'criado', { nome: o.name });
  return Number(r.lastInsertRowid);
}

const SIM_INDEX = { pre5: 'pre5', pre6: 'pre6', ipca: 'IPCA', incc: 'INCC', inpc: 'INPC', outro: 'outro' };
/**
 * Planos para o simulador de propostas: só administradoras e planos ativos (guia Planos). O simulador mostra as
 * administradoras do CRM e, em cada uma, os planos pelo código + a opção "Outros" (condições livres).
 */
function simulatorPlans(db) {
  const adms = db.prepare('SELECT id, name, code FROM administrators WHERE active = 1 ORDER BY name').all();
  const plans = db.prepare(`SELECT p.*, a.name AS adm_name FROM products p JOIN administrators a ON a.id = p.administrator_id
    WHERE p.active = 1 AND a.active = 1 ORDER BY a.name, p.plan_code, p.name`).all();
  return {
    administradoras: adms.map((a) => ({ id: a.id, nome: a.name, codigo: a.code })),
    planos: plans.map((p) => ({
      id: String(p.id), codigo: p.plan_code || null, administradora: p.adm_name, administradora_id: p.administrator_id,
      nome: [p.plan_code, p.name].filter(Boolean).join(' · '), categoria: p.category, creditoMinimo: p.credit_min, creditoMaximo: p.credit_max,
      incremento: p.credit_step, prazo: p.term_months, prazos: p.term_options, taxaAdm: p.admin_fee_pct, fundoReserva: p.reserve_fund_pct,
      seguro: p.insurance_pct, embutidoPct: p.embedded_bid ? p.embedded_bid_pct : null, fixoPct: p.fixed_bid ? p.fixed_bid_pct : null,
      adesao: !!p.adhesion, adesaoPct: p.adhesion ? p.adhesion_pct : null, adesaoMeses: p.adhesion ? p.adhesion_months : null,
      indice: SIM_INDEX[p.readjustment_index] || null,
    })),
  };
}

/**
 * Confere se o valor de crédito é permitido no plano (faixa e incremento).
 * Ex.: HS de R$ 100 mil a R$ 180 mil, de 10 em 10 mil: R$ 125 mil não é permitido.
 */
function creditError(plan, value) {
  if (!plan || value == null) return null;
  const fmt = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  if (plan.credit_min != null && value < plan.credit_min) return `O plano ${plan.name} aceita crédito a partir de ${fmt(plan.credit_min)}.`;
  if (plan.credit_max != null && value > plan.credit_max) return `O plano ${plan.name} aceita crédito até ${fmt(plan.credit_max)}. Acima disso, use outro plano.`;
  if (plan.credit_step) {
    const base = plan.credit_min ?? 0;
    if (Math.round((value - base) * 100) % Math.round(plan.credit_step * 100) !== 0) {
      return `No plano ${plan.name} o crédito vai de ${fmt(plan.credit_step)} em ${fmt(plan.credit_step)}${plan.credit_min != null ? ` a partir de ${fmt(plan.credit_min)}` : ''}.`;
    }
  }
  return null;
}

/** Tabela de comissão aplicável: a do plano, se houver; senão a da administradora. */
function commissionScheduleFor(db, planId, administratorId) {
  const p = planId ? db.prepare('SELECT commission_schedule, administrator_id FROM products WHERE id = ?').get(planId) : null;
  const own = p?.commission_schedule ? parseJson(p.commission_schedule, []) : [];
  if (own.length) return { schedule: own, source: 'plano' };
  const admId = administratorId || p?.administrator_id;
  const a = admId ? db.prepare('SELECT commission_schedule, chargeback_policy FROM administrators WHERE id = ?').get(admId) : null;
  return { schedule: a ? parseJson(a.commission_schedule, []) : [], source: 'administradora' };
}

function chargebackPolicy(db, administratorId) {
  const a = administratorId ? db.prepare('SELECT chargeback_policy FROM administrators WHERE id = ?').get(administratorId) : null;
  return { estornar_pagas: true, ate_dias: 365, ...parseJson(a?.chargeback_policy, {}) };
}

module.exports = {
  simulatorPlans,
  INDEXES, normalizeSchedule, scheduleTotal, listAdministrators, saveAdministrator, listPlans, savePlan, creditError, commissionScheduleFor, chargebackPolicy, decoratePlan, revealPortalPassword,
};
