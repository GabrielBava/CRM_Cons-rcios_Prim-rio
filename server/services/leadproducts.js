'use strict';
/**
 * Produtos do lead: potencial de cross-sell e up-sell nas quatro áreas da Vero.
 *  - Consórcio (upsell ou outro grupo): imóvel, veículo, pesados, serviços — valor de crédito.
 *  - Planejamento financeiro: fluxo de caixa, dívidas, sucessório/tributário, aposentadoria — potencial.
 *  - Seguros (proteção): vida/família, automóvel/frota, residencial/empresarial, saúde — valor potencial.
 *  - Investimentos (captação): reserva de emergência, migração de carteira, aporte único, previdência — faixa de captação.
 * Cada item tem descrição, valor, observação e situação (potencial, em andamento, convertido, descartado).
 */
const { audit, loadContact } = require('../core');
const { badRequest, notFound, clean: cleanRaw, toNumber, nowIso } = require('../util');

const clean = (v) => cleanRaw(v) ?? null;

const PRODUCT_AREAS = {
  consorcio: {
    label: 'Consórcio', hint: 'Upsell ou cross-sell de outro grupo', valueLabel: 'Valor de crédito', descLabel: 'Segmento e o que o cliente pensa',
    subs: { imovel: 'Imóvel', veiculo: 'Veículo', pesados: 'Pesados', servicos: 'Serviços' },
  },
  planejamento: {
    label: 'Planejamento financeiro', hint: 'Organização e planejamento da vida financeira', valueLabel: 'Potencial (R$)', descLabel: 'Para que quer o planejamento / oportunidade',
    subs: { fluxo_caixa: 'Organização de fluxo de caixa', dividas: 'Gestão de dívidas', sucessorio_tributario: 'Planejamento sucessório/tributário', aposentadoria: 'Planejamento de aposentadoria' },
  },
  seguros: {
    label: 'Seguros', hint: 'Proteção', valueLabel: 'Valor potencial (capital ou prêmio)', descLabel: 'O que precisa proteger',
    subs: { vida_familia: 'Vida / Família (sucessão e proteção de renda)', auto_frota: 'Automóvel / Frota', residencial_empresarial: 'Residencial / Empresarial', saude: 'Seguro Saúde' },
  },
  investimentos: {
    label: 'Investimentos', hint: 'Captação', valueLabel: 'Valor estimado (R$)', descLabel: 'O que pensa em fazer',
    subs: { reserva_emergencia: 'Reserva de emergência', migracao_carteira: 'Migração de carteira (outro banco)', aporte_unico: 'Aporte único (venda de bem/herança)', previdencia: 'Previdência Privada' },
    ranges: { ate_50k: 'Até R$ 50 mil', '50k_200k': 'R$ 50 mil a R$ 200 mil', '200k_500k': 'R$ 200 mil a R$ 500 mil', '500k_1m': 'R$ 500 mil a R$ 1 milhão', acima_1m: 'Acima de R$ 1 milhão' },
  },
};
const STATUS = { potencial: 'Potencial', em_andamento: 'Em andamento', convertido: 'Convertido', descartado: 'Descartado' };
/** Valor de referência de cada faixa (para somar o potencial quando só a faixa foi informada). */
const RANGE_MID = { ate_50k: 25000, '50k_200k': 125000, '200k_500k': 350000, '500k_1m': 750000, acima_1m: 1000000 };

function validate(data, partial = false) {
  const out = {};
  if (!partial || data.area !== undefined) {
    if (!PRODUCT_AREAS[data.area]) throw badRequest('Escolha a área do produto.');
    out.area = data.area;
  }
  const area = PRODUCT_AREAS[out.area || data._area];
  if (data.sub_type !== undefined) {
    out.sub_type = clean(data.sub_type);
    if (out.sub_type && area && !area.subs[out.sub_type]) throw badRequest('Oportunidade inválida para a área.');
  }
  if (data.description !== undefined) out.description = clean(data.description);
  if (data.notes !== undefined) out.notes = clean(data.notes);
  if (data.value !== undefined) {
    out.value = toNumber(data.value);
    if (out.value != null && out.value < 0) throw badRequest('O valor não pode ser negativo.');
  }
  if (data.value_range !== undefined) {
    out.value_range = clean(data.value_range);
    if (out.value_range && !(area?.ranges || {})[out.value_range]) throw badRequest('Faixa de captação inválida.');
  }
  if (data.status !== undefined) {
    if (!STATUS[data.status]) throw badRequest('Situação inválida.');
    out.status = data.status;
  }
  return out;
}

const potential = (p) => (p.status === 'descartado' ? 0 : p.value || RANGE_MID[p.value_range] || 0);

function listProducts(db, user, contactId) {
  const c = loadContact(db, user, contactId);
  const rows = db.prepare('SELECT p.*, u.name AS created_by_name FROM lead_products p LEFT JOIN users u ON u.id = p.created_by WHERE p.contact_id = ? ORDER BY p.status = \'descartado\', p.created_at DESC').all(c.id);
  const totals = Object.fromEntries(Object.keys(PRODUCT_AREAS).map((a) => {
    const list = rows.filter((r) => r.area === a && r.status !== 'descartado');
    return [a, { count: list.length, potential: list.reduce((t, r) => t + potential(r), 0) }];
  }));
  return { rows, totals, potential: Object.values(totals).reduce((t, x) => t + x.potential, 0), areas: PRODUCT_AREAS, status: STATUS };
}

function saveProduct(db, user, data = {}) {
  const now = nowIso();
  if (data.id) {
    const p = db.prepare('SELECT * FROM lead_products WHERE id = ?').get(Number(data.id));
    if (!p) throw notFound('Produto não encontrado.');
    loadContact(db, user, p.contact_id, { write: true });
    const v = validate({ ...data, _area: p.area }, true);
    delete v.area;
    if (!Object.keys(v).length) return { id: p.id };
    const cols = Object.keys(v);
    db.prepare(`UPDATE lead_products SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...cols.map((k) => v[k]), now, p.id);
    audit(db, user, 'lead_product', p.id, 'alterado', v, p.contact_id);
    return { id: p.id };
  }
  const c = loadContact(db, user, data.contact_id, { write: true });
  const v = validate(data);
  if (!v.sub_type) throw badRequest('Escolha a oportunidade (ex.: imóvel, reserva de emergência).');
  const opp = data.opportunity_id ? db.prepare('SELECT id FROM opportunities WHERE id = ? AND contact_id = ?').get(Number(data.opportunity_id), c.id) : null;
  const id = Number(db.prepare(`INSERT INTO lead_products (contact_id, opportunity_id, area, sub_type, description, value, value_range, notes, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(c.id, opp?.id ?? null, v.area, v.sub_type, v.description ?? null, v.value ?? null, v.value_range ?? null, v.notes ?? null, v.status || 'potencial', user.id, now, now).lastInsertRowid);
  audit(db, user, 'lead_product', id, 'criado', { area: PRODUCT_AREAS[v.area].label, oportunidade: PRODUCT_AREAS[v.area].subs[v.sub_type] }, c.id);
  return { id };
}

function deleteProduct(db, user, id) {
  const p = db.prepare('SELECT * FROM lead_products WHERE id = ?').get(Number(id));
  if (!p) throw notFound('Produto não encontrado.');
  loadContact(db, user, p.contact_id, { write: true });
  db.prepare('DELETE FROM lead_products WHERE id = ?').run(p.id);
  audit(db, user, 'lead_product', p.id, 'excluido', { area: p.area }, p.contact_id);
  return { ok: true };
}

module.exports = { PRODUCT_AREAS, listProducts, saveProduct, deleteProduct, potential };
