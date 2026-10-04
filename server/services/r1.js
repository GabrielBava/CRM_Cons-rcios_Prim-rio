'use strict';
/**
 * Transcrição da R1 anexada ao negócio: o texto (ou a planilha) é lido e os campos da qualificação identificados
 * completam só o que ainda está vazio. Base para o agente de IA que fará a leitura da transcrição: ele pode gerar
 * o mesmo formato (uma linha "Campo: valor" por item, ou uma planilha com as colunas Campo e Valor).
 *
 * Formatos aceitos:
 *  - linhas "Campo: valor" (ou "Campo = valor"), em qualquer ordem, no meio do texto da reunião;
 *  - tabela com as colunas Campo e Valor (CSV/planilha), uma linha por campo;
 *  - tabela com um campo por coluna (cabeçalho na 1ª linha, valores na 2ª).
 * O campo pode vir pela chave (ex.: credit_value) ou pela descrição (ex.: "Crédito desejado").
 */
const { badRequest, clean, nowIso, parseCSV } = require('../util');
const { tx } = require('../db');
const { audit } = require('../core');

// [chave, descrição, tipo, lista de opções, sinônimos]
const R1_FIELDS = [
  ['objective_type', 'Objetivo', 'list', 'objetivo', ['objetivo do cliente', 'objetivo principal']],
  ['credit_purpose_type', 'Finalidade do crédito', 'list', 'finalidade_credito', ['finalidade']],
  ['housing_purpose', 'Moradia: morar ou investir', 'list', 'finalidade_moradia', ['finalidade da moradia', 'morar ou investir', 'uso do imovel']],
  ['credit_category', 'Categoria de interesse', 'list', 'categoria_credito', ['categoria', 'tipo de bem', 'bem']],
  ['product_type', 'Tipo de produto', 'list', 'tipo_produto', []],
  ['credit_value', 'Crédito desejado', 'money', null, ['valor do credito', 'credito', 'valor da carta', 'valor do bem']],
  ['credit_purpose', 'Detalhe da finalidade', 'text', null, ['detalhe', 'descricao do bem']],
  ['urgency', 'Prioridade: quando quer o crédito', 'list', 'urgencia', ['prazo', 'prazo desejado', 'prioridade', 'urgencia', 'quando quer o credito']],
  ['contemplation_type', 'Contemplação de interesse', 'list', 'tipo_contemplacao', ['tipo de contemplacao']],
  ['term_months', 'Prazo do plano (meses)', 'int', null, ['prazo do plano', 'prazo em meses']],
  ['installment_min', 'Parcela ideal', 'money', null, ['parcela confortavel', 'parcela desejada']],
  ['installment_max', 'Parcela máxima', 'money', null, ['parcela limite', 'teto da parcela']],
  ['financial_moment', 'Momento financeiro', 'list', 'momento_financeiro', []],
  ['employment_type', 'Fonte de renda', 'list', 'tipo_contratacao', ['renda', 'tipo de renda', 'tipo de contratacao']],
  ['has_bid_resources', 'Terá recurso próprio para lance?', 'yesno', null, ['recurso para lance', 'tem lance', 'possui lance', 'recurso proprio para lance']],
  ['bid_own_resources', 'Valor disponível para lance', 'money', null, ['valor do lance', 'lance', 'quanto tem de lance']],
  ['bid_source', 'Origem do lance', 'list', 'origem_lance', ['lance reserva ou fgts', 'de onde vem o lance', 'origem do recurso do lance']],
  ['has_fgts', 'Possui FGTS?', 'list', 'possui_fgts', ['fgts', 'tem fgts']],
  ['fgts_available', 'FGTS disponível', 'money', null, ['valor do fgts', 'saldo do fgts']],
  ['embedded_bid_interest', 'Interesse em lance embutido', 'embedded', null, ['lance embutido']],
  ['quotas', 'Quantidade de cotas', 'int', null, ['cotas', 'numero de cotas']],
  ['has_property', 'Possui imóvel?', 'yesno', null, ['tem imovel', 'possui imovel', 'imovel proprio']],
  ['property_type', 'Tipo do imóvel', 'list', 'tipo_imovel', ['tipo de imovel']],
  ['property_value', 'Valor do imóvel', 'money', null, ['valor do imovel atual']],
  ['property_free_liens', 'Imóvel livre de ônus?', 'yesno', null, ['livre de onus', 'imovel quitado']],
  ['pays_rent', 'Paga aluguel hoje?', 'yesno', null, ['paga aluguel', 'mora de aluguel', 'aluguel']],
  ['rent_value', 'Valor do aluguel', 'money', null, ['quanto paga de aluguel']],
  ['decision_maker', 'Fator decisor', 'list', 'decisor', ['decisor', 'quem decide']],
  ['decision_notes', 'Quem mais participa da decisão', 'text', null, ['participantes da decisao']],
  ['had_consortium', 'Já teve consórcio?', 'yesno', null, ['ja teve consorcio', 'experiencia com consorcio']],
  ['existing_consortium_admin', 'Administradora do consórcio anterior', 'text', null, ['administradora anterior', 'administradora']],
  ['existing_consortium_value', 'Crédito do consórcio anterior', 'money', null, ['credito contratado', 'credito do consorcio']],
  ['has_financing', 'Possui financiamento hoje?', 'yesno', null, ['tem financiamento', 'financiamento']],
  ['existing_financing_balance', 'Financiamento: saldo devedor', 'money', null, ['saldo devedor']],
  ['existing_financing_cet', 'Financiamento: CET (% a.a.)', 'pct', null, ['cet']],
  ['existing_financing_bank', 'Financiamento: banco', 'text', null, ['banco do financiamento']],
  ['objective', 'Observações da R1', 'text', null, ['observacoes', 'resumo', 'resumo da r1']],
];

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[?:*]/g, '').replace(/\s+/g, ' ').trim();

function fieldIndex() {
  const idx = new Map();
  for (const [key, label, , , syn] of R1_FIELDS) {
    for (const n of [key, label, ...syn]) if (!idx.has(norm(n))) idx.set(norm(n), key);
  }
  return idx;
}
const defOf = (key) => R1_FIELDS.find((f) => f[0] === key);

/** Interpreta "R$ 250.000,00", "250 mil", "1,2 milhão", "250000". */
function parseMoney(raw) {
  let t = norm(raw).replace(/r\$/g, '').trim();
  let mult = 1;
  if (/\b(mi|milhao|milhoes|mm)\b/.test(t)) mult = 1e6;
  else if (/\b(mil|k)\b/.test(t)) mult = 1e3;
  const m = t.match(/-?\d[\d.,]*/);
  if (!m) return null;
  let n = m[0];
  if (n.includes(',')) n = n.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(n)) n = n.replace(/\./g, '');
  const v = Number(n) * mult;
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

function convert(db, key, raw) {
  const [, , type, list] = defOf(key);
  const r = clean(String(raw ?? ''));
  if (!r) return null;
  const n = norm(r);
  if (type === 'money') return parseMoney(r);
  if (type === 'int') {
    const m = n.match(/\d+/);
    return m ? Number(m[0]) : null;
  }
  if (type === 'pct') {
    const m = n.match(/\d+([.,]\d+)?/);
    return m ? Number(m[0].replace(',', '.')) : null;
  }
  if (type === 'yesno') {
    if (/^(sim|s|yes|tem|possui|x|verdadeiro|true)\b/.test(n)) return 'sim';
    if (/^(nao|n|no|nunca|falso|false)\b/.test(n)) return 'nao';
    if (/nao sabe|talvez|avaliar/.test(n)) return 'nao_sabe';
    return null;
  }
  if (type === 'embedded') {
    if (/nao se aplica|nao permitido/.test(n)) return 'nao_se_aplica';
    if (/avaliar|talvez/.test(n)) return 'avaliar';
    if (/^(sim|s)\b/.test(n)) return 'sim';
    if (/^(nao|n)\b/.test(n)) return 'nao';
    return null;
  }
  if (type === 'list') {
    const opts = db.prepare('SELECT value, label FROM options WHERE list = ? AND active = 1').all(list);
    const exact = opts.find((o) => norm(o.value) === n || norm(o.label) === n);
    if (exact) return exact.value;
    // Correspondência parcial: "curto" → "Curto prazo (até 3 meses)", "apartamento 2 quartos" → "Apartamento"
    const part = opts.find((o) => norm(o.label).startsWith(n) || n.startsWith(norm(o.label)) || n.includes(norm(o.value).replace(/_/g, ' ')));
    if (part) return part.value;
    if (list === 'urgencia') {
      const months = Number((n.match(/(\d+)\s*(mes|meses)/) || [])[1]);
      if (months) return months <= 3 ? 'curto' : months <= 12 ? 'medio' : 'longo';
    }
    return null;
  }
  return r.slice(0, 500);
}

/** Lê o texto e devolve os campos identificados. */
function parseTranscript(db, text) {
  const idx = fieldIndex();
  const found = [];
  const add = (label, raw) => {
    const key = idx.get(norm(label));
    if (!key || found.some((f) => f.key === key)) return;
    const value = convert(db, key, raw);
    const [, flabel, type, list] = defOf(key);
    found.push({ key, label: flabel, type, list, raw: String(raw ?? '').trim().slice(0, 300), value, ok: value != null && value !== '' });
  };
  const body = String(text || '').replace(/^﻿/, '');
  const firstLine = body.split(/\r?\n/, 1)[0] || '';
  const looksTable = /[;\t,]/.test(firstLine) && !/:\s/.test(firstLine);
  if (looksTable) {
    const { headers, rows } = parseCSV(body);
    const h = headers.map(norm);
    const ci = h.findIndex((x) => ['campo', 'chave', 'field', 'campo do crm', 'pergunta'].includes(x));
    const vi = h.findIndex((x) => ['valor', 'resposta', 'value', 'conteudo'].includes(x));
    if (ci >= 0 && vi >= 0) {
      const di = h.findIndex((x) => ['descricao', 'descricao do campo', 'label'].includes(x));
      for (const r of rows) {
        add(r[ci], r[vi]);
        if (di >= 0 && r[di]) add(r[di], r[vi]);
      }
    } else if (rows.length) {
      headers.forEach((hd, i) => add(hd, rows[0][i]));
    }
  }
  if (!found.length || !looksTable) {
    for (const line of body.split(/\r?\n/)) {
      const m = line.match(/^\s*[-•*]?\s*([^:=]{2,70})\s*[:=]\s*(.+)$/);
      if (m) add(m[1], m[2]);
    }
  }
  const fields = Object.fromEntries(found.filter((f) => f.ok).map((f) => [f.key, f.value]));
  return { found, fields };
}

/** Anexa a transcrição ao negócio e mostra o que seria preenchido (não altera a qualificação). */
function attachTranscript(db, user, oppId, data) {
  const { loadOpp } = require('./opportunities');
  const o = loadOpp(db, user, oppId, { write: true });
  const text = String(data.text || '');
  if (!text.trim()) throw badRequest('O arquivo da transcrição está vazio ou não pôde ser lido.');
  if (text.length > 2e6) throw badRequest('Transcrição muito grande (limite de 2 milhões de caracteres).');
  const parsed = parseTranscript(db, text);
  const id = tx(db, () => {
    const r = db.prepare('INSERT INTO r1_transcripts (opportunity_id, filename, content, fields, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(o.id, clean(data.filename)?.slice(0, 200) ?? null, text, JSON.stringify(parsed.fields), user.id, nowIso());
    audit(db, user, 'opportunity', o.id, 'transcricao_r1_anexada', { arquivo: clean(data.filename), campos: Object.keys(parsed.fields).length }, o.contact_id);
    return Number(r.lastInsertRowid);
  });
  const isEmpty = (v) => v == null || v === '';
  const items = parsed.found.map((f) => ({ ...f, current: o[f.key] ?? null, will_fill: f.ok && isEmpty(o[f.key]) }));
  return { id, items, fill_count: items.filter((i) => i.will_fill).length };
}

/** Aplica os campos identificados (só os vazios) — usa a mesma regra do endpoint de qualificação. */
function applyTranscript(db, user, oppId, transcriptId) {
  const { fillQualification } = require('./opportunities');
  const t = db.prepare('SELECT * FROM r1_transcripts WHERE id = ? AND opportunity_id = ?').get(Number(transcriptId), Number(oppId));
  if (!t) throw badRequest('Transcrição não encontrada neste negócio.');
  const r = fillQualification(db, user, oppId, { source: 'r1_transcricao', fields: JSON.parse(t.fields || '{}') });
  db.prepare('UPDATE r1_transcripts SET applied = ? WHERE id = ?').run(JSON.stringify(r.filled), t.id);
  return r;
}

function getTranscript(db, user, oppId, transcriptId) {
  const { loadOpp } = require('./opportunities');
  loadOpp(db, user, oppId);
  const t = db.prepare('SELECT t.*, u.name AS user_name FROM r1_transcripts t LEFT JOIN users u ON u.id = t.created_by WHERE t.id = ? AND t.opportunity_id = ?').get(Number(transcriptId), Number(oppId));
  if (!t) throw badRequest('Transcrição não encontrada.');
  return { ...t, fields: JSON.parse(t.fields || '{}'), applied: JSON.parse(t.applied || '[]') };
}

/** Campos do modelo (para a planilha "Campo | Descrição | Tipo | Opções | Valor"). */
function templateFields(db) {
  const TYPE = { list: 'lista', money: 'valor em R$', int: 'número', pct: 'percentual', yesno: 'sim ou não', embedded: 'sim, não, avaliar ou não se aplica', text: 'texto' };
  return R1_FIELDS.map(([key, label, type, list]) => ({
    key, label, type: TYPE[type] || type,
    options: list ? db.prepare('SELECT label FROM options WHERE list = ? AND active = 1 ORDER BY position').all(list).map((o) => o.label).join(' | ') : type === 'yesno' ? 'Sim | Não' : '',
  }));
}

module.exports = { R1_FIELDS, parseTranscript, attachTranscript, applyTranscript, getTranscript, templateFields, parseMoney };
