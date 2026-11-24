'use strict';
/**
 * Diagnóstico financeiro (Ferramentas › Planejamento financeiro e aba Diagnóstico do lead).
 *
 * A ferramenta (public/ferramentas/diagnostico-financeiro.html) abre com ?crm=<id>: busca os dados do cliente no CRM,
 * preenche o cadastro do diagnóstico e, a cada alteração, devolve o diagnóstico para cá. Assim o diagnóstico fica
 * guardado no CRM (abre de qualquer computador) e a aba do lead mostra o resumo e o link do diagnóstico completo.
 */
const { audit, loadContact } = require('../core');
const { badRequest, notFound, nowIso } = require('../util');
const { tx } = require('../db');

const MAX_DATA = 4 * 1024 * 1024;
const TOOL_PATH = 'ferramentas/diagnostico-financeiro.html';
const toolUrl = (id) => `${TOOL_PATH}?crm=${id}#/clientes/crm-${id}`;

const titleOf = (x) => (x && typeof x === 'object' ? x.titulo || x.acao || x.nome || x.descricao || x.tipo || x.area || null : null);
const list = (v) => (Array.isArray(v) ? v : []);
const filled = (o) => (o && typeof o === 'object' ? Object.values(o).filter((v) => v !== '' && v != null && !(Array.isArray(v) && !v.length)).length : 0);

/**
 * Resumo para a aba do lead: situação da coleta, objetivos, plano de ação e recomendações. A "Estrela Vero" (nota por
 * pilar) e a matriz de oportunidades entram quando a ferramenta passar a enviar esses números.
 */
function summarize(d) {
  if (!d || typeof d !== 'object') return null;
  const plano = list(d.plano).map((p) => ({ titulo: titleOf(p) || 'Ação', area: p.area || null, prazo: p.prazo || p.quando || null })).slice(0, 12);
  return {
    coleta_finalizada: !!d.coletaFinalizada,
    recomendacoes_finalizadas: !!d.recomendacoesFinalizadas,
    objetivos: list(d.objetivos).map((o) => titleOf(o)).filter(Boolean).slice(0, 10),
    plano,
    recomendacoes: list(d.recomendacoes).length,
    dependentes: list(d.dependentes).length,
    patrimonio_itens: list(d.imoveis).length + list(d.moveis).length,
    dividas_itens: list(d.financiamentos).length + list(d.emprestimos).length + list(d.cartoes).length,
    consorcios: list(d.consorcios).length,
    campos_cadastro: filled(d.cadastro),
    estrela: d.estrela && typeof d.estrela === 'object' ? d.estrela : null,
    atualizado_em: d.atualizadoEm || null,
  };
}

const num = (v, min = 0, max = 100) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.max(min, Math.min(max, Math.round(Number(v)))));
const txt = (v, n = 200) => (v == null ? null : String(v).slice(0, n));
const STATUS = ['critico', 'atencao', 'ok', 'sem-dados'];
/** Resultado calculado pela ferramenta: Nota Vero e Estrela Vero (8 pilares), Matriz de oportunidades e Bússola financeira. */
function cleanResult(x) {
  if (!x || typeof x !== 'object') return null;
  const out = {};
  if (x.estrela && Array.isArray(x.estrela.pilares)) {
    out.estrela = { nota: num(x.estrela.nota), pilares: x.estrela.pilares.slice(0, 12).map((p) => ({ id: txt(p.id, 40), nome: txt(p.nome, 60), pct: num(p.pct), status: STATUS.includes(p.status) ? p.status : null })) };
  }
  if (Array.isArray(x.matriz)) {
    out.matriz = x.matriz.slice(0, 12).map((o) => ({ titulo: txt(o.titulo, 120), area: txt(o.area, 60), produto: txt(o.produto, 60), prioridade: txt(o.prioridade, 20), prazo: txt(o.prazo, 20), potencial: num(o.potencial, -100, 1000), detalhe: txt(o.detalhe, 300) })).filter((o) => o.titulo);
  }
  if (x.bussola && Array.isArray(x.bussola.dimensoes)) {
    const n = x.bussola.norte;
    out.bussola = {
      nota: num(x.bussola.nota),
      norte: n ? { id: txt(n.id, 40), nome: txt(n.nome, 60), status: STATUS.includes(n.status) ? n.status : null, resumo: txt(n.resumo, 200), acao: txt(n.acao, 200) } : null,
      dimensoes: x.bussola.dimensoes.slice(0, 6).map((d) => ({ id: txt(d.id, 40), nome: txt(d.nome, 60), nota: num(d.nota), status: STATUS.includes(d.status) ? d.status : null, resumo: txt(d.resumo, 200) })),
    };
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Resumo enviado pela ferramenta nova (Diagnóstico Vero v1: PUT { data, resumo }, src/lib/resumo-crm.ts) no formato que o
 * CRM já usa: precificação do plano e resultado (Nota e Estrela Vero, Matriz de oportunidades). A Bússola não vem nesse
 * resumo. Versão desconhecida é ignorada.
 */
function fromSummary(r) {
  if (!r || typeof r !== 'object' || Number(r.versao) !== 1) return { pricing: null, result: null };
  const p = r.precificacao && typeof r.precificacao === 'object' ? r.precificacao : null;
  const pricing = p ? { valor: p.valor, pix_total: p.pixTotal, cartao_total: p.cartaoTotal, parcelas: p.parcelas, parcela: p.cartaoParcela, condicao: p.condicao, validade_dias: p.validadeDias } : null;
  const result = {};
  const max = Number(r.nota && r.nota.maximo) || 100;
  if (Array.isArray(r.estrela) && r.estrela.length) {
    const nota = r.nota && r.nota.valor != null && Number.isFinite(Number(r.nota.valor)) ? (Number(r.nota.valor) / max) * 100 : null;
    result.estrela = { nota, pilares: r.estrela.map((x) => ({ id: x && x.id, nome: x && x.nome, pct: x && x.pct, status: x && x.status })) };
  }
  if (Array.isArray(r.oportunidades) && r.oportunidades.length) {
    const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
    result.matriz = r.oportunidades.map((o) => ({ titulo: o && o.titulo, area: o && o.area, produto: o && o.produto, prioridade: o && o.prioridade, prazo: o && o.prazo, potencial: o && o.potencial, detalhe: o && Number(o.valor) > 0 ? `Valor estimado: ${brl(o.valor)}` : null }));
  }
  return { pricing, result: Object.keys(result).length ? result : null };
}

const publicRow = (r) => (r ? { id: r.id, contact_id: r.contact_id, status: r.status, created_at: r.created_at, updated_at: r.updated_at, completed_at: r.completed_at, created_by_name: r.created_by_name, summary: r.summary ? JSON.parse(r.summary) : null, url: toolUrl(r.id) } : null);

function forContact(db, user, contactId) {
  const c = loadContact(db, user, contactId);
  const rows = db.prepare('SELECT d.id, d.contact_id, d.status, d.summary, d.pricing, d.created_at, d.updated_at, d.completed_at, u.name AS created_by_name FROM diagnostics d LEFT JOIN users u ON u.id = d.created_by WHERE d.contact_id = ? ORDER BY d.id DESC').all(c.id);
  const cur = publicRow(rows[0]);
  if (cur) {
    cur.pricing = rows[0].pricing ? JSON.parse(rows[0].pricing) : null;
    cur.proposals = db.prepare("SELECT id, code, status, plan_model, credit_value FROM proposals WHERE diagnostic_id = ? AND status <> 'substituida' ORDER BY id").all(cur.id);
  }
  return { current: cur, history: rows.slice(1).map(publicRow) };
}

/** Abre o diagnóstico do cliente: retoma o que está em andamento ou cria um novo. */
function start(db, user, data = {}) {
  const c = loadContact(db, user, data.contact_id, { write: true });
  // Um diagnóstico por cliente: abre o existente (em andamento ou concluído); não há "refazer"
  const open = db.prepare('SELECT id FROM diagnostics WHERE contact_id = ? ORDER BY id DESC LIMIT 1').get(c.id);
  if (open) return { id: open.id, url: toolUrl(open.id), created: false };
  const opp = data.opportunity_id ? db.prepare('SELECT id FROM opportunities WHERE id = ? AND contact_id = ?').get(Number(data.opportunity_id), c.id) : db.prepare("SELECT id FROM opportunities WHERE contact_id = ? AND status = 'aberta' ORDER BY id DESC LIMIT 1").get(c.id);
  const now = nowIso();
  const id = Number(db.prepare("INSERT INTO diagnostics (contact_id, opportunity_id, status, created_by, created_at, updated_at) VALUES (?, ?, 'em_andamento', ?, ?, ?)").run(c.id, opp?.id ?? null, user.id, now, now).lastInsertRowid);
  audit(db, user, 'diagnostic', id, 'iniciado', null, c.id);
  return { id, url: toolUrl(id), created: true };
}

function load(db, user, id, { write = false } = {}) {
  const d = db.prepare('SELECT * FROM diagnostics WHERE id = ?').get(Number(id));
  if (!d) throw notFound('Diagnóstico não encontrado.');
  const c = loadContact(db, user, d.contact_id, { write });
  return { d, c };
}

/** Dados para a ferramenta: o cadastro do cliente (para preencher) e o diagnóstico salvo. */
function forTool(db, user, id) {
  const { d, c } = load(db, user, id);
  const phone = c.whatsapp || c.phone1 || '';
  return {
    id: d.id, status: d.status, client_id: `crm-${d.id}`,
    prefill: { nome: c.name, email: c.email || '', telefone: phone, nascimento: c.birth_date || '', ocupacao: c.profession || '' },
    contact: { id: c.id, code: c.code, name: c.name },
    consultant: { name: user.name, email: user.email },
    data: d.data ? JSON.parse(d.data) : null,
    crm_url: `#/leads/${c.id}`,
  };
}

/** A ferramenta devolve o diagnóstico (salvamento automático). Coleta finalizada conclui o diagnóstico. */
function saveFromTool(db, user, id, body = {}) {
  const { d } = load(db, user, id, { write: true });
  if (!body.data || typeof body.data !== 'object') throw badRequest('Diagnóstico vazio.');
  const json = JSON.stringify(body.data);
  if (json.length > MAX_DATA) throw badRequest('Diagnóstico grande demais para salvar.');
  const sum = summarize(body.data);
  const now = nowIso();
  const done = sum.coleta_finalizada || sum.recomendacoes_finalizadas;
  const proposals = require('./proposals');
  // Precificação calculada pela ferramenta (valor do plano, à vista e no cartão); sem uma válida, vale a última recebida
  const novo = fromSummary(body.resumo);
  const pricing = proposals.cleanPricing(body.precificacao) || proposals.cleanPricing(novo.pricing) || (d.pricing ? JSON.parse(d.pricing) : null);
  if (pricing) sum.precificacao = pricing;
  // Nota Vero, Estrela Vero, Matriz e Bússola: sem um resultado novo válido, vale o último recebido
  const prev = d.summary ? JSON.parse(d.summary) : {};
  const resultado = cleanResult(body.resultado) || cleanResult(novo.result) || prev.resultado || null;
  if (resultado) sum.resultado = resultado;
  const status = done || d.status === 'concluido' ? 'concluido' : 'em_andamento';
  tx(db, () => {
    db.prepare('UPDATE diagnostics SET data = ?, summary = ?, pricing = ?, updated_at = ?, status = ?, completed_at = ? WHERE id = ?')
      .run(json, JSON.stringify(sum), pricing ? JSON.stringify(pricing) : null, now, status, done ? d.completed_at || now : d.completed_at, d.id);
    if (done && d.status !== 'concluido') {
      audit(db, user, 'diagnostic', d.id, 'concluido', null, d.contact_id);
      const c = db.prepare('SELECT name, owner_id FROM contacts WHERE id = ?').get(d.contact_id);
      if (c?.owner_id) require('./notifications').notify(db, c.owner_id, { kind: 'diagnostico', title: `Diagnóstico concluído: ${c.name}`, body: 'Veja a Nota Vero, a matriz e a bússola no lead e gere a proposta do planejamento.', link: `#/leads/${d.contact_id}/diagnostico` });
    }
  });
  return { ok: true, status };
}

function conclude(db, user, id) {
  const { d } = load(db, user, id, { write: true });
  const now = nowIso();
  db.prepare("UPDATE diagnostics SET status = 'concluido', completed_at = COALESCE(completed_at, ?), updated_at = ? WHERE id = ?").run(now, now, d.id);
  audit(db, user, 'diagnostic', d.id, 'concluido', null, d.contact_id);
  return { ok: true };
}

/** "Gerar proposta" do diagnóstico concluído: modelo (implementação ou plataforma exclusiva) e valor da precificação. */
function generateProposal(db, user, id, body = {}) {
  const { d } = load(db, user, id, { write: true });
  if (d.status !== 'concluido') throw badRequest('Conclua o diagnóstico financeiro para gerar a proposta do planejamento.');
  return require('./proposals').fromDiagnostic(db, user, d, d.pricing ? JSON.parse(d.pricing) : null, { model: body.model, valor: body.valor });
}

module.exports = { forContact, start, forTool, saveFromTool, conclude, generateProposal, summarize, cleanResult, fromSummary, TOOL_PATH };
