'use strict';
/**
 * Relatórios por perfil, exportação em Excel e conexão com ferramentas de BI.
 *
 * Quem vê o quê:
 *  - Especialista: "Meu desempenho" (as próprias vendas e comissões). Sem dados de leads ou clientes e sem
 *    exportação: os números ficam na tela, para não sair informação da operação.
 *  - Líder de equipe: relatórios comerciais da equipe (com exportação) e o próprio desempenho.
 *  - RH (módulo Colaboradores): quadro de pessoas, cadastro, remuneração e benefícios, contratos e movimentação.
 *  - Administrador: tudo, inclusive vendas gerais, fluxo de caixa, contas a pagar e a receber, saldos e excedente de
 *    caixa e resultado por categoria; exporta cada relatório ou o pacote completo em Excel.
 *  - BI (Power BI, Looker Studio, Excel): bases de dados em JSON ou CSV pelo endereço /api/bi/<base>, com o token da
 *    integração "Conexão BI" (Configurações › Integrações). Dados pessoais sensíveis (CPF, RG, conta bancária) não saem.
 */
const reports = require('./reports');
const { hasModule } = require('../permissions');
const { badRequest, forbidden, toIso } = require('../util');
const { getSetting } = require('../db');

const col = (key, label, type = 'text') => ({ key, label, type });
const r2 = (v) => Math.round(Number(v || 0) * 100) / 100;
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const day = (iso) => String(iso).slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const todayStr = () => new Date().toISOString().slice(0, 10);

function period(q) {
  const to = q.to ? toIso(q.to) : new Date().toISOString();
  const from = q.from ? toIso(q.from) : new Date(Date.parse(to) - 30 * 86400000).toISOString();
  return { from, to, dFrom: day(from), dTo: day(to) };
}

/* ------------------------- Catálogo por perfil ------------------------- */

const isAdmin = (u) => u.role === 'admin';
const sells = (u) => ['consultor', 'gestor'].includes(u.role);
const commercial = (u) => ['admin', 'gestor'].includes(u.role) && hasModule(u, 'relatorios');
const rh = (u) => hasModule(u, 'colaboradores');

const NEW_REPORTS = {
  minhas_vendas: { title: 'Minhas vendas', group: 'Meu desempenho', can: sells },
  minhas_comissoes: { title: 'Minhas comissões', group: 'Meu desempenho', can: sells },
  vendas_geral: { title: 'Vendas: volume por mês, administradora e especialista', group: 'Vendas e operação', can: isAdmin },
  vendas_categoria: { title: 'Vendas por categoria e administradora', group: 'Vendas e operação', can: isAdmin },
  fin_fluxo_caixa: { title: 'Fluxo de caixa (realizado e previsto)', group: 'Financeiro', can: isAdmin },
  fin_saldos: { title: 'Saldos, projeção e excedente de caixa', group: 'Financeiro', can: isAdmin },
  fin_pagar: { title: 'Contas a pagar no período', group: 'Financeiro', can: isAdmin },
  fin_receber: { title: 'Contas a receber no período', group: 'Financeiro', can: isAdmin },
  fin_resultado: { title: 'Resultado por categoria (receitas x despesas)', group: 'Financeiro', can: isAdmin },
  rh_quadro: { title: 'Quadro de colaboradores', group: 'Pessoas (RH)', can: rh },
  rh_colaboradores: { title: 'Cadastro de colaboradores', group: 'Pessoas (RH)', can: rh },
  rh_remuneracao: { title: 'Remuneração, benefícios e custo', group: 'Pessoas (RH)', can: rh },
  rh_contratos: { title: 'Contratos e vigências', group: 'Pessoas (RH)', can: rh },
  rh_movimentacao: { title: 'Admissões, desligamentos e turnover', group: 'Pessoas (RH)', can: rh },
  rh_aniversariantes: { title: 'Aniversariantes e tempo de casa', group: 'Pessoas (RH)', can: rh },
};
const GROUP_ORDER = ['Meu desempenho', 'Comercial', 'Vendas e operação', 'Financeiro', 'Pessoas (RH)'];

/** Especialista não exporta (nem CSV nem Excel); os demais exportam o que conseguem ver. */
const canExport = (user) => user.role !== 'consultor' && user.role !== 'leitura';

function catalog(user) {
  const out = [];
  for (const [key, r] of Object.entries(NEW_REPORTS)) if (r.can(user)) out.push({ key, title: r.title, group: r.group });
  if (commercial(user)) for (const [key, title] of Object.entries(reports.REPORTS)) out.push({ key, title, group: 'Comercial' });
  out.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  return { reports: out, export: canExport(user), package: isAdmin(user) };
}

function allowed(user, key) {
  if (NEW_REPORTS[key]) return NEW_REPORTS[key].can(user);
  if (reports.REPORTS[key]) return commercial(user);
  return false;
}

/** Executa um relatório respeitando o perfil (o especialista recebe a mesma resposta, sem poder exportar). */
function run(db, user, key, q = {}) {
  if (!NEW_REPORTS[key] && !reports.REPORTS[key]) throw badRequest('Relatório inválido.');
  if (!allowed(user, key)) throw forbidden('Este relatório não está disponível para o seu perfil.');
  const r = NEW_REPORTS[key] ? build(db, user, key, q) : reports.report(db, user, key, q);
  return { ...r, group: NEW_REPORTS[key]?.group || 'Comercial', exportable: canExport(user) };
}

function requireExport(user) {
  if (!canExport(user)) throw forbidden('A exportação de relatórios não está disponível para o seu perfil. Os números ficam disponíveis na tela.');
}

/* ------------------------- Relatórios ------------------------- */

const SALE_DATE = "substr(COALESCE(s.payment_date, s.confirmed_at, s.created_at), 1, 10)";
const MONTH = (expr) => `substr(${expr}, 1, 7)`;
const monthLabel = (m) => {
  const [y, mo] = String(m).split('-');
  return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(mo) - 1]}/${y}`;
};

function build(db, user, key, q) {
  const p = period(q);
  const base = { key, title: NEW_REPORTS[key].title, period: { from: p.from, to: p.to } };
  switch (key) {
    case 'minhas_vendas': {
      const months = db.prepare(`SELECT ${MONTH(SALE_DATE)} AS mes, COUNT(*) AS vendas, SUM(s.credit_value) AS credito, AVG(s.credit_value) AS ticket
        FROM sales s WHERE s.seller_id = ? AND s.status != 'cancelada' AND ${SALE_DATE} BETWEEN ? AND ? GROUP BY mes ORDER BY mes`).all(user.id, p.dFrom, p.dTo)
        .map((r) => ({ ...r, mes: monthLabel(r.mes), credito: r2(r.credito), ticket: r2(r.ticket) }));
      const list = db.prepare(`SELECT s.code AS venda, ${SALE_DATE} AS data, a.name AS administradora, s.category AS categoria, s.credit_value AS credito, s.term_months AS prazo,
          CASE s.status WHEN 'confirmada' THEN 'Confirmada' WHEN 'aguardando_alocacao' THEN 'Aguardando alocação' WHEN 'aguardando_pagamento' THEN 'Aguardando pagamento' ELSE 'Cancelada' END AS situacao
        FROM sales s LEFT JOIN administrators a ON a.id = s.administrator_id WHERE s.seller_id = ? AND ${SALE_DATE} BETWEEN ? AND ? ORDER BY data DESC`).all(user.id, p.dFrom, p.dTo)
        .map((r) => ({ ...r, categoria: catLabel(db, r.categoria) }));
      const tot = months.reduce((t, r) => ({ vendas: t.vendas + r.vendas, credito: t.credito + r.credito }), { vendas: 0, credito: 0 });
      return {
        ...base,
        definition: ['Somente as suas vendas: data da venda = pagamento da 1ª parcela (ou a confirmação).', 'Vendas canceladas não entram no total do mês; aparecem na lista com a situação.', 'Sem dados de clientes ou leads. A exportação não está disponível para o perfil de especialista.'],
        columns: [col('mes', 'Mês'), col('vendas', 'Vendas', 'int'), col('credito', 'Crédito vendido', 'money'), col('ticket', 'Ticket médio', 'money')],
        rows: months,
        totals: { mes: 'Total', vendas: tot.vendas, credito: r2(tot.credito), ticket: tot.vendas ? r2(tot.credito / tot.vendas) : null },
        extra: { title: 'Vendas do período', columns: [col('venda', 'Venda'), col('data', 'Data', 'date'), col('administradora', 'Administradora'), col('categoria', 'Categoria'), col('credito', 'Crédito', 'money'), col('prazo', 'Prazo (meses)', 'int'), col('situacao', 'Situação')], rows: list },
      };
    }
    case 'minhas_comissoes': {
      const rows = db.prepare(`SELECT competence AS competencia,
          SUM(CASE WHEN kind != 'estorno' AND status = 'prevista' THEN amount ELSE 0 END) AS prevista,
          SUM(CASE WHEN kind != 'estorno' AND status = 'liberada' THEN amount ELSE 0 END) AS liberada,
          SUM(CASE WHEN kind != 'estorno' AND status = 'paga' THEN amount ELSE 0 END) AS paga,
          SUM(CASE WHEN kind = 'estorno' AND status != 'cancelada' THEN amount ELSE 0 END) AS estornos
        FROM commission_entries WHERE user_id = ? AND competence BETWEEN ? AND ? GROUP BY competence ORDER BY competence`).all(user.id, p.dFrom.slice(0, 7), p.dTo.slice(0, 7))
        .map((r) => ({ ...r, competencia: monthLabel(r.competencia), prevista: r2(r.prevista), liberada: r2(r.liberada), paga: r2(r.paga), estornos: r2(r.estornos), liquido: r2(r.prevista + r.liberada + r.paga + r.estornos) }));
      const sum = (k) => r2(rows.reduce((t, r) => t + r[k], 0));
      return {
        ...base,
        definition: ['Somente as suas comissões, por mês de competência.', 'Prevista: aguardando a carência; liberada: pode ser paga; paga: já recebida. Estornos aparecem negativos.', 'A exportação não está disponível para o perfil de especialista.'],
        columns: [col('competencia', 'Competência'), col('prevista', 'Prevista', 'money'), col('liberada', 'Liberada', 'money'), col('paga', 'Paga', 'money'), col('estornos', 'Estornos', 'money'), col('liquido', 'Líquido', 'money')],
        rows,
        totals: { competencia: 'Total', prevista: sum('prevista'), liberada: sum('liberada'), paga: sum('paga'), estornos: sum('estornos'), liquido: sum('liquido') },
      };
    }
    case 'vendas_geral': {
      const rows = db.prepare(`SELECT ${MONTH(SALE_DATE)} AS mes, COUNT(*) AS vendas, SUM(s.credit_value) AS credito, AVG(s.credit_value) AS ticket, COUNT(DISTINCT s.seller_id) AS especialistas
        FROM sales s WHERE s.status != 'cancelada' AND ${SALE_DATE} BETWEEN ? AND ? GROUP BY mes ORDER BY mes`).all(p.dFrom, p.dTo);
      const canc = Object.fromEntries(db.prepare(`SELECT substr(cancelled_at, 1, 7) AS mes, COUNT(*) AS n, SUM(credit_value) AS v FROM sales WHERE status = 'cancelada' AND substr(cancelled_at, 1, 10) BETWEEN ? AND ? GROUP BY mes`).all(p.dFrom, p.dTo).map((r) => [r.mes, r]));
      const out = rows.map((r) => ({ mes: monthLabel(r.mes), vendas: r.vendas, credito: r2(r.credito), ticket: r2(r.ticket), especialistas: r.especialistas, cancelamentos: canc[r.mes]?.n || 0, credito_cancelado: r2(canc[r.mes]?.v) }));
      const bySeller = db.prepare(`SELECT u.name AS especialista, COUNT(*) AS vendas, SUM(s.credit_value) AS credito FROM sales s LEFT JOIN users u ON u.id = s.seller_id WHERE s.status != 'cancelada' AND ${SALE_DATE} BETWEEN ? AND ? GROUP BY s.seller_id ORDER BY credito DESC`).all(p.dFrom, p.dTo).map((r) => ({ ...r, credito: r2(r.credito) }));
      const tot = out.reduce((t, r) => ({ vendas: t.vendas + r.vendas, credito: t.credito + r.credito, cancelamentos: t.cancelamentos + r.cancelamentos, credito_cancelado: t.credito_cancelado + r.credito_cancelado }), { vendas: 0, credito: 0, cancelamentos: 0, credito_cancelado: 0 });
      return {
        ...base,
        definition: ['Vendas não canceladas com data da venda (pagamento da 1ª parcela ou confirmação) no período, por mês.', 'Cancelamentos: vendas canceladas no período (pela data do cancelamento).', 'Ticket médio = crédito vendido ÷ número de vendas.'],
        columns: [col('mes', 'Mês'), col('vendas', 'Vendas', 'int'), col('credito', 'Crédito vendido', 'money'), col('ticket', 'Ticket médio', 'money'), col('especialistas', 'Especialistas com venda', 'int'), col('cancelamentos', 'Cancelamentos', 'int'), col('credito_cancelado', 'Crédito cancelado', 'money')],
        rows: out,
        totals: { mes: 'Total', vendas: tot.vendas, credito: r2(tot.credito), ticket: tot.vendas ? r2(tot.credito / tot.vendas) : null, cancelamentos: tot.cancelamentos, credito_cancelado: r2(tot.credito_cancelado) },
        extra: { title: 'Por especialista', columns: [col('especialista', 'Especialista'), col('vendas', 'Vendas', 'int'), col('credito', 'Crédito', 'money')], rows: bySeller },
      };
    }
    case 'vendas_categoria': {
      const rows = db.prepare(`SELECT COALESCE(a.name, 'Sem administradora') AS administradora, s.category AS categoria, COUNT(*) AS vendas, SUM(s.credit_value) AS credito, AVG(s.term_months) AS prazo_medio
        FROM sales s LEFT JOIN administrators a ON a.id = s.administrator_id WHERE s.status != 'cancelada' AND ${SALE_DATE} BETWEEN ? AND ? GROUP BY s.administrator_id, s.category ORDER BY credito DESC`).all(p.dFrom, p.dTo)
        .map((r) => ({ ...r, categoria: catLabel(db, r.categoria), credito: r2(r.credito), prazo_medio: r.prazo_medio ? Math.round(r.prazo_medio) : null }));
      const total = rows.reduce((t, r) => t + r.credito, 0);
      rows.forEach((r) => (r.participacao = pct(r.credito, total)));
      return {
        ...base,
        definition: ['Vendas não canceladas do período agrupadas por administradora e categoria.', 'Participação = crédito do grupo ÷ crédito total vendido no período.'],
        columns: [col('administradora', 'Administradora'), col('categoria', 'Categoria'), col('vendas', 'Vendas', 'int'), col('credito', 'Crédito', 'money'), col('participacao', 'Participação', 'pct'), col('prazo_medio', 'Prazo médio (meses)', 'int')],
        rows,
        totals: { administradora: 'Total', vendas: rows.reduce((t, r) => t + r.vendas, 0), credito: r2(total) },
      };
    }
    case 'fin_fluxo_caixa': {
      const span = (Date.parse(p.dTo) - Date.parse(p.dFrom)) / 86400000;
      const bucket = span <= 62 ? 'day' : 'month';
      const key = (expr) => (bucket === 'day' ? `substr(${expr}, 1, 10)` : `substr(${expr}, 1, 7)`);
      const real = db.prepare(`SELECT ${key('i.paid_at')} AS k, SUM(CASE WHEN t.direction = 'receber' THEN i.paid_amount ELSE 0 END) AS entradas, SUM(CASE WHEN t.direction = 'pagar' THEN i.paid_amount ELSE 0 END) AS saidas
        FROM fin_installments i JOIN fin_titles t ON t.id = i.title_id WHERE i.status = 'pago' AND i.paid_at BETWEEN ? AND ? GROUP BY k`).all(p.dFrom, p.dTo);
      const prev = db.prepare(`SELECT ${key('i.due_date')} AS k, SUM(CASE WHEN t.direction = 'receber' THEN i.amount ELSE 0 END) AS a_receber, SUM(CASE WHEN t.direction = 'pagar' THEN i.amount ELSE 0 END) AS a_pagar
        FROM fin_installments i JOIN fin_titles t ON t.id = i.title_id WHERE i.status = 'aberto' AND i.due_date BETWEEN ? AND ? GROUP BY k`).all(p.dFrom, p.dTo);
      const keys = [...new Set([...real.map((r) => r.k), ...prev.map((r) => r.k)])].sort();
      const opening = openingBalance(db, addDays(p.dFrom, -1));
      let acc = opening;
      const rows = keys.map((k) => {
        const a = real.find((r) => r.k === k) || {};
        const b = prev.find((r) => r.k === k) || {};
        const saldo = r2((a.entradas || 0) - (a.saidas || 0));
        acc = r2(acc + saldo);
        return { periodo: bucket === 'day' ? k : monthLabel(k), entradas: r2(a.entradas), saidas: r2(a.saidas), saldo, acumulado: acc, a_receber: r2(b.a_receber), a_pagar: r2(b.a_pagar), projetado: r2((b.a_receber || 0) - (b.a_pagar || 0)) };
      });
      const sum = (k) => r2(rows.reduce((t, r) => t + r[k], 0));
      return {
        ...base,
        definition: [`Realizado: parcelas pagas/recebidas no período, pela data do pagamento (${bucket === 'day' ? 'por dia' : 'por mês'}).`, `Acumulado: saldo das contas no início do período (${fmtMoney(opening)}) + entradas − saídas.`, 'Previsto: parcelas em aberto com vencimento no período (a receber − a pagar).'],
        columns: [col('periodo', bucket === 'day' ? 'Dia' : 'Mês', bucket === 'day' ? 'date' : 'text'), col('entradas', 'Entradas', 'money'), col('saidas', 'Saídas', 'money'), col('saldo', 'Saldo do período', 'money'), col('acumulado', 'Saldo acumulado', 'money'), col('a_receber', 'A receber (aberto)', 'money'), col('a_pagar', 'A pagar (aberto)', 'money'), col('projetado', 'Saldo previsto', 'money')],
        rows,
        totals: { periodo: 'Total', entradas: sum('entradas'), saidas: sum('saidas'), saldo: sum('saldo'), a_receber: sum('a_receber'), a_pagar: sum('a_pagar'), projetado: sum('projetado') },
      };
    }
    case 'fin_saldos': {
      const reserve = Number(getSetting(db, 'cash_reserve_min')) || 0;
      const d = todayStr();
      const accounts = require('./treasury').accountBalances(db, d);
      const open = (dir, days) => db.prepare("SELECT COALESCE(SUM(i.amount), 0) AS v FROM fin_installments i JOIN fin_titles t ON t.id = i.title_id WHERE t.direction = ? AND i.status = 'aberto' AND i.due_date <= ?").get(dir, addDays(d, days)).v;
      const late = (dir) => db.prepare("SELECT COALESCE(SUM(i.amount), 0) AS v FROM fin_installments i JOIN fin_titles t ON t.id = i.title_id WHERE t.direction = ? AND i.status = 'aberto' AND i.due_date < ?").get(dir, d).v;
      const saldo = r2(accounts.reduce((t, a) => t + a.saldo, 0));
      const rows = accounts.map((a) => ({ conta: a.name, tipo: a.type, saldo: a.saldo }));
      const horizons = [30, 60, 90].map((n) => {
        const rec = r2(open('receber', n));
        const pag = r2(open('pagar', n));
        const proj = r2(saldo + rec - pag);
        return { horizonte: `Próximos ${n} dias`, saldo_atual: saldo, a_receber: rec, a_pagar: pag, saldo_projetado: proj, reserva: reserve, excedente: r2(proj - reserve) };
      });
      return {
        ...base,
        title: NEW_REPORTS[key].title,
        definition: [`Saldo atual por conta: saldo inicial + recebimentos − pagamentos até hoje (${d.split('-').reverse().join('/')}).`, 'Projeção: saldo atual + a receber − a pagar com vencimento até o fim do horizonte (inclui o que está em atraso).', `Excedente de caixa = saldo projetado − reserva mínima (${fmtMoney(reserve)}, em Configurações). Valor positivo pode ser aplicado; negativo indica necessidade de caixa.`, `Em atraso hoje: a receber ${fmtMoney(late('receber'))} · a pagar ${fmtMoney(late('pagar'))}.`],
        columns: [col('horizonte', 'Horizonte'), col('saldo_atual', 'Saldo atual', 'money'), col('a_receber', 'A receber', 'money'), col('a_pagar', 'A pagar', 'money'), col('saldo_projetado', 'Saldo projetado', 'money'), col('reserva', 'Reserva mínima', 'money'), col('excedente', 'Excedente (+) / falta (−)', 'money')],
        rows: horizons,
        extra: { title: 'Saldo atual por conta', columns: [col('conta', 'Conta'), col('tipo', 'Tipo'), col('saldo', 'Saldo', 'money')], rows },
      };
    }
    case 'fin_pagar':
    case 'fin_receber': {
      const dir = key === 'fin_pagar' ? 'pagar' : 'receber';
      const d = todayStr();
      const rows = db.prepare(`SELECT COALESCE(c.name, 'Sem categoria') AS categoria, COALESCE(cc.name, '—') AS centro_custo, COUNT(*) AS parcelas,
          SUM(i.amount) AS previsto, SUM(CASE WHEN i.status = 'pago' THEN i.paid_amount ELSE 0 END) AS realizado,
          SUM(CASE WHEN i.status = 'aberto' THEN i.amount ELSE 0 END) AS em_aberto, SUM(CASE WHEN i.status = 'aberto' AND i.due_date < ? THEN i.amount ELSE 0 END) AS vencido
        FROM fin_installments i JOIN fin_titles t ON t.id = i.title_id LEFT JOIN fin_categories c ON c.id = t.category_id LEFT JOIN fin_cost_centers cc ON cc.id = t.cost_center_id
        WHERE t.direction = ? AND i.status != 'cancelado' AND i.due_date BETWEEN ? AND ? GROUP BY t.category_id, t.cost_center_id ORDER BY previsto DESC`).all(d, dir, p.dFrom, p.dTo)
        .map((r) => ({ ...r, previsto: r2(r.previsto), realizado: r2(r.realizado), em_aberto: r2(r.em_aberto), vencido: r2(r.vencido) }));
      const items = db.prepare(`SELECT t.code AS titulo, t.description AS descricao, COALESCE(fp.name, '—') AS ${dir === 'pagar' ? 'fornecedor' : 'pagador'}, i.number AS parcela, i.due_date AS vencimento, i.amount AS valor,
          CASE WHEN i.status = 'pago' THEN 'Pago' WHEN i.due_date < ? THEN 'Vencido' ELSE 'Em aberto' END AS situacao, i.paid_at AS pago_em
        FROM fin_installments i JOIN fin_titles t ON t.id = i.title_id LEFT JOIN fin_partners fp ON fp.id = t.partner_id
        WHERE t.direction = ? AND i.status != 'cancelado' AND i.due_date BETWEEN ? AND ? ORDER BY i.due_date, t.code`).all(d, dir, p.dFrom, p.dTo);
      const sum = (k) => r2(rows.reduce((t, r) => t + r[k], 0));
      return {
        ...base,
        definition: [`Parcelas ${dir === 'pagar' ? 'a pagar' : 'a receber'} com vencimento no período (canceladas não entram), por categoria e centro de custo.`, `Realizado: valor efetivamente ${dir === 'pagar' ? 'pago' : 'recebido'}. Em aberto: ainda não baixado. Vencido: em aberto com vencimento anterior a hoje.`],
        columns: [col('categoria', 'Categoria'), col('centro_custo', 'Centro de custo'), col('parcelas', 'Parcelas', 'int'), col('previsto', 'Previsto', 'money'), col('realizado', dir === 'pagar' ? 'Pago' : 'Recebido', 'money'), col('em_aberto', 'Em aberto', 'money'), col('vencido', 'Vencido', 'money')],
        rows,
        totals: { categoria: 'Total', parcelas: rows.reduce((t, r) => t + r.parcelas, 0), previsto: sum('previsto'), realizado: sum('realizado'), em_aberto: sum('em_aberto'), vencido: sum('vencido') },
        extra: { title: 'Parcelas do período', columns: [col('titulo', 'Título'), col('descricao', 'Descrição'), col(dir === 'pagar' ? 'fornecedor' : 'pagador', dir === 'pagar' ? 'Fornecedor' : 'Pagador'), col('parcela', 'Parcela', 'int'), col('vencimento', 'Vencimento', 'date'), col('valor', 'Valor', 'money'), col('situacao', 'Situação'), col('pago_em', dir === 'pagar' ? 'Pago em' : 'Recebido em', 'date')], rows: items },
      };
    }
    case 'fin_resultado': {
      const rows = db.prepare(`SELECT t.direction AS tipo, COALESCE(c.group_name, '') AS grupo, COALESCE(c.name, 'Sem categoria') AS categoria, SUM(i.paid_amount) AS valor, COUNT(*) AS lancamentos
        FROM fin_installments i JOIN fin_titles t ON t.id = i.title_id LEFT JOIN fin_categories c ON c.id = t.category_id
        WHERE i.status = 'pago' AND i.paid_at BETWEEN ? AND ? GROUP BY t.direction, t.category_id ORDER BY t.direction DESC, valor DESC`).all(p.dFrom, p.dTo)
        .map((r) => ({ ...r, tipo: r.tipo === 'receber' ? 'Receita' : 'Despesa', valor: r2(r.tipo === 'receber' ? r.valor : -r.valor) }));
      const rec = r2(rows.filter((r) => r.valor > 0).reduce((t, r) => t + r.valor, 0));
      const desp = r2(rows.filter((r) => r.valor < 0).reduce((t, r) => t + r.valor, 0));
      rows.forEach((r) => (r.participacao = pct(Math.abs(r.valor), r.valor > 0 ? rec : Math.abs(desp))));
      return {
        ...base,
        definition: ['Regime de caixa: valores efetivamente recebidos (receitas) e pagos (despesas, negativos) no período, por categoria.', `Resultado do período = receitas (${fmtMoney(rec)}) + despesas (${fmtMoney(desp)}) = ${fmtMoney(r2(rec + desp))}.`, 'Participação: peso da categoria dentro das receitas ou das despesas.'],
        columns: [col('tipo', 'Tipo'), col('grupo', 'Grupo'), col('categoria', 'Categoria'), col('lancamentos', 'Lançamentos', 'int'), col('valor', 'Valor', 'money'), col('participacao', 'Participação', 'pct')],
        rows,
        totals: { tipo: 'Resultado', valor: r2(rec + desp) },
      };
    }
    default:
      return buildRh(db, key, q, p, base);
  }
}

const EMP_STATUS = { ativo: 'Ativo', ferias: 'Férias', afastado: 'Afastado', desligado: 'Desligado' };
const CONTRACTS = { clt: 'CLT', pj: 'PJ', estagio: 'Estágio', prestador: 'Prestador de serviços', socio: 'Sócio' };
const PAY = { fixa: 'Fixa', variavel: 'Variável', hibrida: 'Fixa + variável' };
const monthsBetween = (a, b) => {
  if (!a) return null;
  const x = new Date(`${a}T12:00:00Z`);
  const y = new Date(`${b}T12:00:00Z`);
  return Math.max(0, (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + y.getUTCMonth() - x.getUTCMonth() - (y.getUTCDate() < x.getUTCDate() ? 1 : 0));
};
const EMP_SQL = `SELECT e.*, t.name AS team_name, l.full_name AS leader_name, cc.name AS cost_center_name FROM employees e LEFT JOIN teams t ON t.id = e.team_id
  LEFT JOIN employees l ON l.id = e.leader_id LEFT JOIN fin_cost_centers cc ON cc.id = e.cost_center_id`;

function buildRh(db, key, q, p, base) {
  const d = todayStr();
  const { monthlyCost } = require('./people');
  switch (key) {
    case 'rh_quadro': {
      const all = db.prepare(EMP_SQL).all().filter((e) => e.status !== 'desligado');
      const group = (f) => Object.entries(all.reduce((m, e) => ((m[f(e)] = (m[f(e)] || 0) + 1), m), {})).map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n);
      const rows = [
        ...group((e) => EMP_STATUS[e.status]).map((r) => ({ dimensao: 'Situação', valor: r.k, colaboradores: r.n })),
        ...group((e) => CONTRACTS[e.contract_type]).map((r) => ({ dimensao: 'Modelo contratual', valor: r.k, colaboradores: r.n })),
        ...group((e) => e.team_name || 'Sem time').map((r) => ({ dimensao: 'Time', valor: r.k, colaboradores: r.n })),
        ...group((e) => e.cost_center_name || 'Sem centro de custo').map((r) => ({ dimensao: 'Centro de custo', valor: r.k, colaboradores: r.n })),
        ...group((e) => e.work_regime ? { presencial: 'Presencial', hibrido: 'Híbrido', remoto: 'Remoto' }[e.work_regime] : 'Não informado').map((r) => ({ dimensao: 'Regime de trabalho', valor: r.k, colaboradores: r.n })),
      ].map((r) => ({ ...r, percentual: pct(r.colaboradores, all.length) }));
      return { ...base, definition: [`Situação atual (independe do período): ${all.length} colaborador(es) não desligados.`, 'Percentual sobre o total de colaboradores não desligados.'], columns: [col('dimensao', 'Dimensão'), col('valor', 'Grupo'), col('colaboradores', 'Colaboradores', 'int'), col('percentual', 'Percentual', 'pct')], rows };
    }
    case 'rh_colaboradores': {
      const status = q.status && EMP_STATUS[q.status] ? q.status : null;
      const rows = db.prepare(`${EMP_SQL} ${status ? 'WHERE e.status = ?' : ''} ORDER BY e.full_name`).all(...(status ? [status] : []))
        .map((e) => ({ codigo: e.code, nome: e.full_name, cargo: e.job_title, funcao: e.job_function, time: e.team_name, lider: e.leader_name, centro_custo: e.cost_center_name, contrato: CONTRACTS[e.contract_type], regime: { presencial: 'Presencial', hibrido: 'Híbrido', remoto: 'Remoto' }[e.work_regime] || '', email_corporativo: e.corporate_email, telefone: e.phone, admissao: e.admission_date, situacao: EMP_STATUS[e.status], desligamento: e.termination_date, tempo_casa: monthsBetween(e.admission_date, e.termination_date || d) }));
      return { ...base, definition: ['Cadastro atual dos colaboradores (todas as situações). Tempo de casa em meses, da entrada até hoje ou até o desligamento.', 'Dados sensíveis (CPF, RG, dados bancários e salário) ficam só no cadastro do colaborador.'], columns: [col('codigo', 'Código'), col('nome', 'Nome'), col('cargo', 'Cargo'), col('funcao', 'Função'), col('time', 'Time'), col('lider', 'Líder direto'), col('centro_custo', 'Centro de custo'), col('contrato', 'Contrato'), col('regime', 'Regime'), col('email_corporativo', 'E-mail corporativo'), col('telefone', 'Telefone'), col('admissao', 'Entrada', 'date'), col('situacao', 'Situação'), col('desligamento', 'Desligamento', 'date'), col('tempo_casa', 'Tempo de casa (meses)', 'int')], rows };
    }
    case 'rh_remuneracao': {
      const ben = db.prepare('SELECT * FROM employee_benefits WHERE employee_id = ?');
      const rows = db.prepare(`${EMP_SQL} WHERE e.status != 'desligado' ORDER BY e.full_name`).all().map((e) => {
        const c = monthlyCost(e, ben.all(e.id));
        return { nome: e.full_name, cargo: e.job_title, centro_custo: e.cost_center_name || 'Sem centro de custo', contrato: CONTRACTS[e.contract_type], modelo: PAY[e.pay_model], fixo: c.fixed, variavel: c.variable, beneficios: c.benefits, descontos: c.discounts, liquido_estimado: c.net_estimate, custo_total: c.total_cost };
      });
      const sum = (k) => r2(rows.reduce((t, r) => t + r[k], 0));
      const byCc = Object.values(rows.reduce((m, r) => {
        const x = (m[r.centro_custo] ||= { centro_custo: r.centro_custo, colaboradores: 0, custo_total: 0 });
        x.colaboradores += 1;
        x.custo_total = r2(x.custo_total + r.custo_total);
        return m;
      }, {}));
      return {
        ...base,
        definition: ['Situação atual dos colaboradores não desligados (valores mensais).', 'Variável: valor de referência (meta) informado no cadastro. Benefícios: custo da empresa com os benefícios ativos.', 'Descontos: itens ativos (percentuais calculados sobre o fixo). Líquido estimado = fixo + variável − descontos. Custo total = fixo + variável + benefícios (sem encargos).'],
        columns: [col('nome', 'Colaborador'), col('cargo', 'Cargo'), col('centro_custo', 'Centro de custo'), col('contrato', 'Contrato'), col('modelo', 'Remuneração'), col('fixo', 'Fixo', 'money'), col('variavel', 'Variável (ref.)', 'money'), col('beneficios', 'Benefícios', 'money'), col('descontos', 'Descontos', 'money'), col('liquido_estimado', 'Líquido estimado', 'money'), col('custo_total', 'Custo total', 'money')],
        rows,
        totals: { nome: 'Total', fixo: sum('fixo'), variavel: sum('variavel'), beneficios: sum('beneficios'), descontos: sum('descontos'), liquido_estimado: sum('liquido_estimado'), custo_total: sum('custo_total') },
        extra: { title: 'Custo por centro de custo', columns: [col('centro_custo', 'Centro de custo'), col('colaboradores', 'Colaboradores', 'int'), col('custo_total', 'Custo mensal', 'money')], rows: byCc },
      };
    }
    case 'rh_contratos': {
      const rows = db.prepare(`SELECT c.*, e.full_name, e.code FROM employee_contracts c JOIN employees e ON e.id = c.employee_id ORDER BY c.status = 'vigente' DESC, c.end_date IS NULL, c.end_date`).all().map((c) => {
        const days = c.status === 'vigente' && c.end_date ? Math.round((Date.parse(`${c.end_date}T12:00:00Z`) - Date.parse(`${d}T12:00:00Z`)) / 86400000) : null;
        return { colaborador: `${c.full_name} (${c.code})`, contrato: c.title, modelo: CONTRACTS[c.contract_type] || '', inicio: c.start_date, termino: c.end_date, situacao: c.status === 'vigente' ? (days != null && days < 0 ? 'Vencido' : 'Vigente') : c.status === 'encerrado' ? 'Encerrado' : 'Rascunho', dias_para_vencer: days, valor_mensal: c.monthly_value, arquivo: c.filename ? 'Sim' : 'Não' };
      });
      return { ...base, definition: ['Todos os contratos dos colaboradores, vigentes primeiro (os que vencem antes aparecem no topo).', 'Dias para vencer: até o término da vigência (negativo = vencido). Contratos sem término são por prazo indeterminado.'], columns: [col('colaborador', 'Colaborador'), col('contrato', 'Contrato'), col('modelo', 'Modelo'), col('inicio', 'Início', 'date'), col('termino', 'Término', 'date'), col('situacao', 'Situação'), col('dias_para_vencer', 'Dias para vencer', 'int'), col('valor_mensal', 'Valor mensal', 'money'), col('arquivo', 'Arquivo anexo')], rows };
    }
    case 'rh_movimentacao': {
      const adm = db.prepare(`${EMP_SQL} WHERE e.admission_date BETWEEN ? AND ? ORDER BY e.admission_date`).all(p.dFrom, p.dTo);
      const des = db.prepare(`${EMP_SQL} WHERE e.termination_date BETWEEN ? AND ? ORDER BY e.termination_date`).all(p.dFrom, p.dTo);
      const headStart = db.prepare("SELECT COUNT(*) AS n FROM employees WHERE COALESCE(admission_date, '0000') <= ? AND (termination_date IS NULL OR termination_date >= ?)").get(p.dFrom, p.dFrom).n;
      const headEnd = db.prepare("SELECT COUNT(*) AS n FROM employees WHERE COALESCE(admission_date, '0000') <= ? AND (termination_date IS NULL OR termination_date > ?)").get(p.dTo, p.dTo).n;
      const avg = (headStart + headEnd) / 2;
      const rows = [
        ...adm.map((e) => ({ movimento: 'Admissão', data: e.admission_date, colaborador: e.full_name, cargo: e.job_title, contrato: CONTRACTS[e.contract_type], motivo: '' })),
        ...des.map((e) => ({ movimento: 'Desligamento', data: e.termination_date, colaborador: e.full_name, cargo: e.job_title, contrato: CONTRACTS[e.contract_type], motivo: e.termination_reason || '' })),
      ].sort((a, b) => String(a.data).localeCompare(String(b.data)));
      return {
        ...base,
        definition: [`Admissões: ${adm.length}. Desligamentos: ${des.length}. Quadro no início: ${headStart}; no fim: ${headEnd}.`, `Turnover do período = ((admissões + desligamentos) ÷ 2) ÷ quadro médio = ${avg ? `${pct((adm.length + des.length) / 2, avg)}%` : '—'}.`],
        columns: [col('movimento', 'Movimento'), col('data', 'Data', 'date'), col('colaborador', 'Colaborador'), col('cargo', 'Cargo'), col('contrato', 'Contrato'), col('motivo', 'Motivo')],
        rows,
      };
    }
    case 'rh_aniversariantes': {
      const months = new Set();
      for (let x = p.dFrom.slice(0, 7); x <= p.dTo.slice(0, 7) && months.size < 12; ) {
        months.add(x.slice(5, 7));
        const [y, m] = x.split('-').map(Number);
        x = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`;
      }
      const rows = db.prepare(`${EMP_SQL} WHERE e.status != 'desligado'`).all().flatMap((e) => {
        const out = [];
        if (e.birth_date && months.has(e.birth_date.slice(5, 7))) out.push({ tipo: 'Aniversário', dia: e.birth_date.slice(8, 10) + '/' + e.birth_date.slice(5, 7), colaborador: e.full_name, time: e.team_name, detalhe: '' });
        if (e.admission_date && months.has(e.admission_date.slice(5, 7)) && e.admission_date.slice(0, 4) < d.slice(0, 4)) out.push({ tipo: 'Tempo de casa', dia: e.admission_date.slice(8, 10) + '/' + e.admission_date.slice(5, 7), colaborador: e.full_name, time: e.team_name, detalhe: `${Number(d.slice(0, 4)) - Number(e.admission_date.slice(0, 4))} ano(s) de empresa` });
        return out;
      }).sort((a, b) => a.dia.split('/').reverse().join('').localeCompare(b.dia.split('/').reverse().join('')));
      return { ...base, definition: ['Aniversários e aniversários de empresa nos meses do período (colaboradores não desligados).'], columns: [col('tipo', 'Data comemorativa'), col('dia', 'Dia'), col('colaborador', 'Colaborador'), col('time', 'Time'), col('detalhe', 'Detalhe')], rows };
    }
    default:
      throw badRequest('Relatório inválido.');
  }
}

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
function catLabel(db, v) {
  if (!v) return 'Não informada';
  return db.prepare("SELECT label FROM options WHERE list = 'categoria_credito' AND value = ?").get(v)?.label || v;
}
/** Saldo de todas as contas ativas no fim do dia informado. */
function openingBalance(db, until) {
  return r2(require('./treasury').accountBalances(db, until).reduce((t, a) => t + a.saldo, 0));
}

/* ------------------------- Excel ------------------------- */

const { buildXlsx, reportSheet } = require('../xlsx');

function reportXlsx(db, user, key, q) {
  requireExport(user);
  const r = run(db, user, key, q);
  const sheets = [reportSheet(r, r.title.slice(0, 31))];
  if (r.extra) sheets.push(reportSheet({ ...r.extra, period: r.period }, r.extra.title.slice(0, 31)));
  return { filename: `relatorio-${key}-${new Date().toISOString().slice(0, 10)}.xlsx`, content: buildXlsx(sheets) };
}

/** Pacote completo (administrador): todos os relatórios de um grupo, ou de todos, numa só planilha (uma aba por relatório). */
function packageXlsx(db, user, q) {
  if (user.role !== 'admin') throw forbidden('Somente o administrador exporta o pacote completo.');
  const list = catalog(user).reports.filter((r) => !q.grupo || r.group === q.grupo);
  const sheets = [];
  for (const item of list) {
    const r = run(db, user, item.key, q);
    sheets.push(reportSheet(r, item.title.slice(0, 31)));
  }
  return { filename: `relatorios-${q.grupo ? q.grupo.toLowerCase().replace(/[^a-z]+/g, '-') : 'completo'}-${new Date().toISOString().slice(0, 10)}.xlsx`, content: buildXlsx(sheets) };
}

/* ------------------------- Conexão BI ------------------------- */

/**
 * Bases para BI: uma linha por registro, com códigos e datas em ISO. Sem CPF, RG, telefone, e-mail ou conta
 * bancária de clientes e colaboradores (os clientes aparecem só pelo código).
 */
const BI_DATASETS = {
  vendas: { label: 'Vendas (uma linha por venda/cota)', sql: `SELECT s.id, s.code AS venda, c.code AS cliente_codigo, ${SALE_DATE} AS data_venda, s.status AS situacao, s.cancelled_at AS cancelada_em, a.name AS administradora, p.plan_code AS plano_codigo, p.name AS plano, s.category AS categoria, s.credit_value AS credito, s.term_months AS prazo_meses, s.installment_value AS parcela, u.name AS especialista, t.name AS time, c.origin AS origem_cliente, s.group_code AS grupo, s.created_at AS criada_em FROM sales s JOIN contacts c ON c.id = s.contact_id LEFT JOIN administrators a ON a.id = s.administrator_id LEFT JOIN products p ON p.id = s.plan_id LEFT JOIN users u ON u.id = s.seller_id LEFT JOIN teams t ON t.id = u.team_id ORDER BY s.id` },
  comissoes: { label: 'Comissões por parcela', sql: 'SELECT ce.id, s.code AS venda, u.name AS especialista, ce.kind AS tipo, ce.installment_no AS parcela, ce.competence AS competencia, ce.base_value AS base, ce.pct AS percentual, ce.amount AS valor, ce.status AS situacao, ce.release_on AS libera_em, ce.paid_at AS paga_em FROM commission_entries ce JOIN sales s ON s.id = ce.sale_id LEFT JOIN users u ON u.id = ce.user_id ORDER BY ce.id' },
  funil: { label: 'Negócios do funil (sem dados pessoais)', sql: 'SELECT o.id, o.code AS negocio, c.code AS cliente_codigo, s.name AS etapa, o.status AS situacao, o.credit_category AS categoria, o.credit_value AS credito_desejado, o.objective_type AS objetivo, o.urgency AS prioridade, u.name AS especialista, c.origin AS origem, o.lost_reason AS motivo_perda, o.created_at AS criado_em, o.closed_at AS encerrado_em FROM opportunities o JOIN contacts c ON c.id = o.contact_id LEFT JOIN pipeline_stages s ON s.id = o.stage_id LEFT JOIN users u ON u.id = o.owner_id WHERE c.merged_into_id IS NULL ORDER BY o.id' },
  propostas: { label: 'Propostas', sql: 'SELECT pr.id, pr.code AS proposta, c.code AS cliente_codigo, pr.status AS situacao, pr.credit_value AS credito, pr.term_months AS prazo_meses, pr.initial_installment AS parcela_inicial, pr.category AS categoria, pr.quotas AS cotas, a.name AS administradora, u.name AS especialista, pr.version AS versao, pr.refusal_reason AS motivo_recusa, pr.created_at AS criada_em, pr.accepted_at AS aceita_em FROM proposals pr JOIN contacts c ON c.id = pr.contact_id LEFT JOIN administrators a ON a.id = pr.administrator_id LEFT JOIN users u ON u.id = pr.owner_id ORDER BY pr.id' },
  financeiro: { label: 'Financeiro: parcelas a pagar e a receber', sql: "SELECT i.id, t.code AS titulo, CASE t.direction WHEN 'pagar' THEN 'Pagar' ELSE 'Receber' END AS tipo, t.description AS descricao, t.kind AS modalidade, fp.name AS parceiro, c.group_name AS grupo_categoria, c.name AS categoria, cc.name AS centro_custo, i.number AS parcela, i.due_date AS vencimento, i.amount AS valor, i.status AS situacao, i.paid_at AS pago_em, i.paid_amount AS valor_pago, fa.name AS conta FROM fin_installments i JOIN fin_titles t ON t.id = i.title_id LEFT JOIN fin_partners fp ON fp.id = t.partner_id LEFT JOIN fin_categories c ON c.id = t.category_id LEFT JOIN fin_cost_centers cc ON cc.id = t.cost_center_id LEFT JOIN fin_accounts fa ON fa.id = COALESCE(i.account_id, t.account_id) ORDER BY i.due_date, i.id" },
  colaboradores: { label: 'Colaboradores (sem CPF, RG e dados bancários)', sql: 'SELECT e.id, e.code AS codigo, e.full_name AS nome, e.job_title AS cargo, e.job_function AS funcao, t.name AS time, l.full_name AS lider, cc.name AS centro_custo, e.contract_type AS contrato, e.work_regime AS regime, e.status AS situacao, e.admission_date AS entrada, e.termination_date AS desligamento, e.pay_model AS remuneracao, e.base_salary AS fixo, e.variable_target AS variavel_referencia, e.weekly_hours AS carga_semanal FROM employees e LEFT JOIN teams t ON t.id = e.team_id LEFT JOIN employees l ON l.id = e.leader_id LEFT JOIN fin_cost_centers cc ON cc.id = e.cost_center_id ORDER BY e.id' },
  beneficios: { label: 'Benefícios e descontos dos colaboradores', sql: 'SELECT b.id, e.code AS colaborador_codigo, b.kind AS tipo, b.type AS item, b.description AS descricao, b.value_type AS tipo_valor, b.amount AS valor, b.company_cost AS custo_empresa, b.active AS ativo FROM employee_benefits b JOIN employees e ON e.id = b.employee_id ORDER BY b.id' },
  metas: { label: 'Metas', sql: 'SELECT g.* FROM goals g ORDER BY g.id' },
  atividades: { label: 'Atividades por dia, usuário e tipo', sql: 'SELECT substr(a.occurred_at, 1, 10) AS dia, u.name AS usuario, a.type AS tipo, COUNT(*) AS quantidade FROM activities a LEFT JOIN users u ON u.id = a.user_id GROUP BY dia, a.user_id, a.type ORDER BY dia' },
};

function biIndex(db, baseUrl) {
  return {
    descricao: 'Bases de dados do Vero Consórcios para BI. Envie o token no cabeçalho Authorization: Bearer <token> (ou ?token=). Formato: ?formato=json (padrão) ou ?formato=csv.',
    bases: Object.entries(BI_DATASETS).map(([k, v]) => ({ base: k, descricao: v.label, json: `${baseUrl}/api/bi/${k}`, csv: `${baseUrl}/api/bi/${k}?formato=csv` })),
  };
}

function biDataset(db, name) {
  const ds = BI_DATASETS[name];
  if (!ds) throw badRequest(`Base desconhecida. Disponíveis: ${Object.keys(BI_DATASETS).join(', ')}.`);
  let rows;
  try {
    rows = db.prepare(ds.sql).all();
  } catch (e) {
    throw badRequest(`Não foi possível montar a base "${name}": ${e.message}`);
  }
  return { base: name, gerado_em: new Date().toISOString(), linhas: rows.length, dados: rows.map((r) => ({ ...r })) };
}

module.exports = { catalog, run, reportXlsx, packageXlsx, requireExport, canExport, biIndex, biDataset, BI_DATASETS, NEW_REPORTS };
