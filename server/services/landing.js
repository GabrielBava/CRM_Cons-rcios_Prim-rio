'use strict';
/**
 * Leads das landing pages (POST /api/publico/lp/leads, sem login) e o rastreio das campanhas (UTM).
 *
 * Formulários reconhecidos:
 *  - LP Consórcios (geral, index da hospedagem):
 *    · Simulador ("LP Simulador"): Imóvel ou Veículo → objetivo AQUISIÇÃO; Investimento → ALAVANCAGEM;
 *    · Mecanismo de Alavancagem Financeira (tipo "alavancagem_financeira") → ALAVANCAGEM, plano de imóvel.
 *  - LP Planejamento (tipo "planejamento_financeiro"): objetivo, prazo, renda familiar e se consegue guardar todo mês.
 *  - Qualquer LP futura (seguros, investimentos, temas específicos): `area` + `respostas` ({ pergunta: resposta } ou
 *    [{ pergunta, resposta }]); campos que o CRM não conhece também ficam registrados.
 *
 * Cada lead vira cadastro + negócio na etapa "Tentativa de contato", com origem LP e a ÁREA do formulário (consórcio,
 * planejamento, seguros ou investimentos). Tudo o que a pessoa preencheu fica nas observações do cadastro e numa nota
 * "Formulário da LP" (aba Notas do painel do lead); a origem guarda a LP, a página, as UTMs, os identificadores de clique
 * (gclid, fbclid…) e o primeiro e o último toque do script de rastreio (vero-rastreio.js). Telefone ou e-mail já
 * existentes não duplicam o cadastro: entra a nova origem e o negócio aberto da mesma área é completado (ou um novo é
 * aberto). Sem responsável, a roleta distribui na hora.
 */
const { badRequest, forbidden, notFound, HttpError, clean, nowIso, normalizePhone, normalizeEmail } = require('../util');
const { tx, getSetting, setSetting } = require('../db');
const { createContact, findDuplicates, insertOrigin } = require('./contacts');
const { insertActivity } = require('./activities');

const SYSTEM_USER = { id: null, role: 'admin', name: 'Landing page' };
const AREAS = { consorcio: 'Consórcio', planejamento: 'Planejamento financeiro', seguros: 'Seguros', investimentos: 'Investimentos' };
const CLICK_IDS = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'ttclid', 'msclkid', 'li_fat_id', 'utm_id'];
const BRL = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }));
const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const short = (v, n = 300) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, n));

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

/* ------------------------- LPs cadastradas ------------------------- */

const DEFAULT_PAGES = [
  { slug: 'consorcios', nome: 'LP Consórcios (geral)', area: 'consorcio', url: 'https://veroconsorciosbr.com.br/', arquivo: 'index.html' },
  { slug: 'planejamento', nome: 'LP Planejamento', area: 'planejamento', url: 'https://veroconsorciosbr.com.br/lp-planejamento.html', arquivo: 'lp-planejamento.html' },
];
/** Arquivos de LP que o CRM guarda (public/lp) e entrega já configurados com o endereço deste CRM. */
const LP_FILES = { 'index.html': 'consorcios', 'lp-planejamento.html': 'planejamento' };

function lpPages(db) {
  const saved = getSetting(db, 'lp_pages');
  const list = Array.isArray(saved) && saved.length ? saved : DEFAULT_PAGES;
  // As LPs com arquivo no CRM continuam com o arquivo mesmo se a lista salva for antiga
  return list.map((p) => ({ ...p, arquivo: DEFAULT_PAGES.find((d) => d.slug === p.slug)?.arquivo || null }));
}

function saveLpPages(db, user, list) {
  if (user.role !== 'admin') throw forbidden('Só o administrador altera as LPs.');
  if (!Array.isArray(list)) throw badRequest('Envie a lista de LPs.');
  const seen = new Set();
  const out = list.map((p) => {
    const s = slug(p.slug || p.nome);
    if (!s) throw badRequest('Cada LP precisa de um identificador (ex.: seguros-vida).');
    if (seen.has(s)) throw badRequest(`Identificador repetido: ${s}.`);
    seen.add(s);
    if (!AREAS[p.area]) throw badRequest(`Área inválida na LP ${s}.`);
    const url = clean(p.url);
    if (url && !/^https?:\/\/[^\s]+$/i.test(url)) throw badRequest(`Endereço inválido na LP ${s} (use https://…).`);
    return { slug: s, nome: short(p.nome, 80) || s, area: p.area, url: url || '' };
  });
  if (out.length > 50) throw badRequest('Máximo de 50 LPs.');
  setSetting(db, 'lp_pages', out);
  return lpPages(db);
}

/* ------------------------- Interpretação do envio ------------------------- */

const PREF_CHANNEL = { whatsapp: 'whatsapp', ligacao: 'ligacao', telefone: 'ligacao', 'e-mail': 'email', email: 'email' };
const URGENCY = { 'de imediato': 'curto', imediato: 'curto', '1 a 3 meses': 'curto', '6 a 12 meses': 'medio', 'apenas pesquisando': null };
// Campos de controle (não são respostas do formulário)
const KNOWN = new Set(['tipo', 'formulario', 'area', 'lp', 'nome', 'email', 'celular', 'telefone', 'whatsapp', 'preferencia_contato', 'melhor_horario',
  'aceite_privacidade', 'aceite_notificacoes', 'aceite_contato', 'origem', 'pagina', 'data', 'utm', 'rastreio', 'website', 'respostas',
  'categoria', 'modo', 'credito', 'parcela', 'prazo', 'inicio', 'simulacao', 'objetivo', 'renda_familiar', 'consegue_guardar']);
const humanize = (k) => {
  const t = String(k).replace(/[_-]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const valueText = (v) => (Array.isArray(v) ? v.map(valueText).join(', ') : v && typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${humanize(k)}: ${valueText(x)}`).join('; ') : typeof v === 'boolean' ? (v ? 'sim' : 'não') : short(v, 500));

/** Respostas genéricas: { pergunta: resposta } ou [{ pergunta, resposta }] + campos não reconhecidos. */
function genericAnswers(body) {
  const out = [];
  const r = body.respostas;
  if (Array.isArray(r)) for (const x of r.slice(0, 40)) x && (x.pergunta || x.campo) && out.push([short(x.pergunta || x.campo, 160), valueText(x.resposta ?? x.valor)]);
  else if (r && typeof r === 'object') for (const [k, v] of Object.entries(r).slice(0, 40)) out.push([short(humanize(k), 160), valueText(v)]);
  for (const [k, v] of Object.entries(body).slice(0, 60)) {
    if (KNOWN.has(k) || v == null || v === '' || /^aceite_/.test(k)) continue;
    out.push([short(humanize(k), 160), valueText(v)]);
  }
  return out.filter(([, v]) => v !== '');
}

/** Qual formulário é, de qual LP e de qual área. */
function identify(db, body) {
  const tipo = norm(body.tipo || body.formulario);
  const origem = norm(body.origem);
  const rastreio = body.rastreio && typeof body.rastreio === 'object' ? body.rastreio : {};
  let form;
  if (tipo === 'alavancagem_financeira' || /alavancagem/.test(origem)) form = 'alavancagem';
  else if (tipo === 'planejamento_financeiro' || (!tipo && /planejamento/.test(origem))) form = 'planejamento';
  else if (tipo) form = slug(tipo);
  else if (body.categoria || body.modo || body.credito) form = 'simulador';
  else form = 'contato';
  const pages = lpPages(db);
  let lp = slug(body.lp || rastreio.lp);
  if (!lp) {
    if (form === 'planejamento') lp = 'planejamento';
    else if (form === 'simulador' || form === 'alavancagem') lp = 'consorcios';
    else {
      // Pelo endereço da página: a LP cadastrada com o mesmo endereço, ou o nome do arquivo
      const page = clean(body.pagina) || '';
      const hit = pages.find((p) => p.url && page.split(/[?#]/)[0].replace(/\/$/, '') === p.url.split(/[?#]/)[0].replace(/\/$/, ''));
      lp = hit ? hit.slug : slug((page.split(/[?#]/)[0].split('/').pop() || '').replace(/\.html?$/i, '')) || 'lp';
    }
  }
  const page = pages.find((p) => p.slug === lp);
  let area;
  if (form === 'simulador' || form === 'alavancagem') area = 'consorcio';
  else if (form === 'planejamento') area = 'planejamento';
  else area = AREAS[body.area] ? body.area : AREAS[rastreio.area] ? rastreio.area : page?.area || 'consorcio';
  // Posição do formulário na página (ex.: "LP Planejamento · popup_jornada")
  const where = clean(String(body.origem || '').split('·')[1]);
  return { form, lp, lpName: page?.nome || `LP ${humanize(lp)}`, area, where };
}

const FORM_LABEL = { simulador: 'Simulador', alavancagem: 'Mecanismo de Alavancagem', planejamento: 'Diagnóstico financeiro', contato: 'Contato' };
const whereText = (w) => (!w ? '' : w === 'topo' ? 'formulário do topo' : /^popup_/.test(w) ? `pop-up do botão "${w.replace(/^popup_/, '').replace(/_/g, ' ')}"` : w);

/** Converte o JSON da LP nos campos do CRM (cadastro, negócio e anotações). */
function interpret(body, id = { form: body.tipo === 'alavancagem_financeira' ? 'alavancagem' : 'simulador', area: 'consorcio' }) {
  const lines = [];
  const opp = {};
  let campaign;
  if (id.form === 'simulador' || id.form === 'alavancagem') {
    const isLeverage = id.form === 'alavancagem';
    const cat = norm(body.categoria);
    const category = isLeverage ? 'imovel' : cat.startsWith('imov') ? 'imovel' : cat.startsWith('veic') ? 'veiculo' : cat.startsWith('invest') ? 'investimento' : null;
    const objective = isLeverage || category === 'investimento' ? 'alavancagem' : 'aquisicao';
    const credit = num(body.credito);
    const installment = num(body.parcela);
    const term = Number.parseInt(body.prazo, 10) || (isLeverage ? 220 : null);
    Object.assign(opp, {
      objective_type: objective,
      credit_value: credit,
      term_months: term > 0 && term <= 400 ? term : null,
      credit_category: category === 'imovel' || category === 'veiculo' ? category : category === 'investimento' ? 'imovel' : null,
      credit_purpose_type: objective === 'alavancagem' ? 'patrimonio' : null,
      strategy: objective === 'alavancagem' ? 'alavancagem' : null,
    });
    // Simulação pela parcela: é o valor que o cliente quer pagar por mês (capacidade)
    if (!isLeverage && body.modo === 'parcela' && installment) {
      opp.installment_min = installment;
      opp.installment_max = installment;
    }
    if (isLeverage && body.inicio) opp.urgency = URGENCY[norm(body.inicio)] ?? null;
    const s = body.simulacao || {};
    if (isLeverage) {
      lines.push('Lead da LP — Mecanismo de Alavancagem Financeira (objetivo: alavancagem).');
      lines.push(`Crédito escolhido: ${BRL(credit)} · Quando pretende iniciar: ${clean(body.inicio) || '—'}.`);
      if (s.credito_simulado != null) lines.push(`Simulação mostrada: crédito ${BRL(s.credito_simulado)}, repetir o ciclo: ${s.repetir_ciclo ? 'sim' : 'não'}, investimento inicial mensal ${BRL(s.investimento_inicial_mensal)}, patrimônio projetado em 10 anos ${BRL(s.patrimonio_projetado_10_anos)}.`);
      campaign = 'LP · Mecanismo de Alavancagem';
    } else {
      lines.push(`Lead da LP — Simulador (${clean(body.categoria) || 'categoria não informada'}; objetivo: ${objective === 'alavancagem' ? 'alavancagem' : 'aquisição'}).`);
      lines.push(`Simulou pelo ${body.modo === 'parcela' ? 'valor da parcela' : 'valor do crédito'}: crédito ${BRL(credit)}, parcela ${BRL(installment)}${term ? `, prazo ${term} meses` : ''}.`);
      campaign = `LP · Simulador ${clean(body.categoria) || ''}`.trim();
    }
  } else if (id.form === 'planejamento') {
    lines.push(`Lead da LP Planejamento — diagnóstico financeiro${id.where ? ` (${whereText(id.where)})` : ''}.`);
    lines.push(`Objetivo financeiro: ${clean(body.objetivo) || '—'}.`);
    lines.push(`Prazo para alcançar: ${clean(body.prazo) || '—'}.`);
    lines.push(`Renda familiar mensal: ${clean(body.renda_familiar) || '—'}.`);
    lines.push(`Consegue guardar ou investir todo mês: ${clean(body.consegue_guardar) || '—'}.`);
    campaign = 'LP · Planejamento financeiro';
  } else {
    lines.push(`Lead da ${id.lpName || 'LP'} — ${AREAS[id.area]}${id.form !== 'contato' ? ` · formulário "${humanize(id.form)}"` : ''}${id.where ? ` (${whereText(id.where)})` : ''}.`);
    campaign = `${id.lpName || 'LP'} · ${AREAS[id.area]}`;
  }
  // Respostas que o CRM não interpreta (LPs futuras e campos novos): ficam registradas como vieram
  const extra = genericAnswers(body);
  if (extra.length) lines.push(...extra.map(([k, v]) => `${k}: ${v}.`.replace(/\.\.$/, '.')));
  lines.push(`Preferência de contato: ${clean(body.preferencia_contato) || '—'}${body.melhor_horario ? `, ${clean(body.melhor_horario).toLowerCase()}` : ''}.`);
  return {
    form: id.form,
    contact: {
      name: clean(body.nome),
      phone: clean(body.celular || body.telefone || body.whatsapp),
      email: clean(body.email),
      pref_channel: PREF_CHANNEL[norm(body.preferencia_contato)] || null,
      pref_time: clean(body.melhor_horario) || null,
    },
    opp,
    notes: lines.filter(Boolean).join('\n'),
    campaign,
  };
}

/** UTMs (do envio ou do último toque) + identificadores de clique + primeiro e último toque. */
function tracking(body) {
  const pick = (o) => (o && typeof o === 'object' ? o : {});
  const r = pick(body.rastreio);
  const last = pick(r.ultimo_toque);
  const first = pick(r.primeiro_toque);
  const utm = { ...pick(pick(last).utm), ...pick(body.utm) };
  const get = (k) => short(utm[k], 200) || null;
  const clicks = Object.fromEntries(CLICK_IDS.map((k) => [k, short(utm[k] ?? pick(last.utm)[k], 300)]).filter(([, v]) => v));
  const canal = pick(last.canal).fonte ? last.canal : pick(r.canal).fonte ? r.canal : null;
  const touch = (t) => (t && (t.utm || t.canal || t.pagina) ? { utm: pick(t.utm), canal: t.canal || null, pagina: short(t.pagina, 500), referrer: short(t.referrer, 500), data: short(t.data, 40) } : null);
  return {
    utm_source: get('utm_source'), utm_medium: get('utm_medium'), utm_campaign: get('utm_campaign'), utm_content: get('utm_content'), utm_term: get('utm_term'),
    clicks,
    canal: canal ? { fonte: short(canal.fonte, 80), meio: short(canal.meio, 80) } : null,
    pagina: short(body.pagina || r.pagina, 500) || null,
    referrer: short(r.referrer || first.referrer, 500) || null,
    primeiro_toque: touch(first),
    ultimo_toque: touch(last),
    visitas: Number.isInteger(r.visitas) ? r.visitas : null,
    dispositivo: short(r.dispositivo, 20) || null,
  };
}

function trackingText(t) {
  const utm = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].filter((k) => t[k]).map((k) => `${k.replace('utm_', '')}: ${t[k]}`);
  const lines = [];
  if (utm.length) lines.push(`UTM — ${utm.join(' · ')}.`);
  else if (t.canal) lines.push(`Sem UTM — canal identificado: ${t.canal.fonte}${t.canal.meio ? ` / ${t.canal.meio}` : ''}.`);
  const ft = t.primeiro_toque;
  if (ft && (ft.utm?.utm_source || ft.canal) && JSON.stringify(ft.utm) !== JSON.stringify(t.ultimo_toque?.utm || {})) {
    lines.push(`Primeiro contato com a Vero: ${ft.utm?.utm_source ? `${ft.utm.utm_source}${ft.utm.utm_medium ? ` / ${ft.utm.utm_medium}` : ''}${ft.utm.utm_campaign ? ` · ${ft.utm.utm_campaign}` : ''}` : `${ft.canal.fonte}${ft.canal.meio ? ` / ${ft.canal.meio}` : ''}`}${Date.parse(ft.data) ? ` em ${new Date(Date.parse(ft.data) - 3 * 3600000).toISOString().slice(0, 10).split('-').reverse().join('/')}` : ''}.`);
  }
  const ids = Object.keys(t.clicks);
  if (ids.length) lines.push(`Clique de anúncio: ${ids.join(', ')}.`);
  if (t.pagina) lines.push(`Página: ${t.pagina}`);
  return lines.join('\n');
}

/* ------------------------- Entrada ------------------------- */

function receive(db, body, { ip } = {}) {
  rateLimit(ip || 'local');
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Envio inválido.');
  // Armadilha para robôs (campo escondido "website"): finge sucesso e não grava
  if (clean(body.website)) return { ok: true };
  if (body.aceite_privacidade !== true && body.aceite_privacidade !== 'true') throw badRequest('É preciso aceitar a Política de Privacidade.');
  const id = identify(db, body);
  const lp = interpret(body, id);
  const phoneNorm = lp.contact.phone ? normalizePhone(lp.contact.phone) : null;
  const email = normalizeEmail(lp.contact.email);
  if (!lp.contact.name || lp.contact.name.length < 3) throw badRequest('Informe o nome.');
  if (!phoneNorm && !email) throw badRequest('Informe um telefone ou e-mail válido.');
  const t = tracking(body);
  const formLabel = FORM_LABEL[id.form] || humanize(id.form);
  const originDetails = {
    origin: 'landing_page',
    campaign_name: t.utm_campaign || lp.campaign,
    platform: 'landing_page',
    received_at: nowIso(),
    utm_source: t.utm_source, utm_medium: t.utm_medium, utm_campaign: t.utm_campaign, utm_content: t.utm_content, utm_term: t.utm_term,
    other_params: { lp: id.lp, formulario: id.form, area: id.area, posicao: id.where || null, pagina: t.pagina, referrer: t.referrer, canal: t.canal, ...t.clicks, primeiro_toque: t.primeiro_toque, ultimo_toque: t.ultimo_toque, visitas: t.visitas, dispositivo: t.dispositivo },
    source_ref: `lp:${id.lp}:${id.form}`,
  };
  const accepted = body.aceite_notificacoes === true || body.aceite_notificacoes === 'true' || body.aceite_contato === true || body.aceite_contato === 'true';
  const consent = `Aceitou a Política de Privacidade${accepted ? ' e o contato da Vero por WhatsApp, e-mail e SMS' : ''}.`;
  const formText = [lp.notes, consent, trackingText(t)].filter(Boolean).join('\n');
  const { fillQualification, createOpportunityRow } = require('./opportunities');

  const dups = findDuplicates(db, { phones: [phoneNorm].filter(Boolean), email });
  const result = tx(db, () => {
    let contactId;
    let created = false;
    if (dups.length >= 1) {
      // Cadastro existente (o mais antigo): nova origem + anotação, sem duplicar
      contactId = dups[0].id;
      insertOrigin(db, SYSTEM_USER, contactId, originDetails);
    } else {
      const r = createContact(db, SYSTEM_USER, {
        kind: 'PF', name: lp.contact.name, phone1: lp.contact.phone, whatsapp: lp.contact.pref_channel === 'whatsapp' ? lp.contact.phone : undefined,
        email: lp.contact.email, origin: 'landing_page', campaign: originDetails.campaign_name, relationship: 'lead', owner_id: null,
        pref_channel: lp.contact.pref_channel, pref_time: lp.contact.pref_time, pref_source: id.lpName, initial_notes: formText,
        business_area: id.area, origin_details: originDetails, create_opportunity: true,
      }, { system: true, skipDuplicateCheck: true, source: 'landing_page', sourceLabel: `${id.lpName} · ${formLabel}` });
      contactId = r.id;
      created = true;
    }
    // Negócio aberto da mesma área (no consórcio, com o mesmo objetivo ou sem objetivo); senão, abre um novo nessa área
    const objective = lp.opp.objective_type || null;
    let opp = db.prepare(`SELECT id FROM opportunities WHERE contact_id = ? AND status = 'aberta' AND COALESCE(business_area, 'consorcio') = ?
      AND (? IS NULL OR objective_type IS NULL OR objective_type = ?) ORDER BY id DESC LIMIT 1`).get(contactId, id.area, objective, objective);
    if (!opp) {
      const tentativa = db.prepare("SELECT id FROM pipeline_stages WHERE key = 'tentativa' AND active = 1 AND kind = 'aberta'").get();
      const owner = db.prepare('SELECT owner_id FROM contacts WHERE id = ?').get(contactId)?.owner_id ?? null;
      opp = createOpportunityRow(db, SYSTEM_USER, { contact_id: contactId, owner_id: owner, stage_id: tentativa?.id, business_area: id.area });
    }
    const fields = Object.fromEntries(Object.entries(lp.opp).filter(([, v]) => v != null && v !== ''));
    // A estratégia "alavancagem" só entra se existir na lista de estratégias
    if (fields.strategy && !db.prepare("SELECT 1 FROM options WHERE list = 'estrategia' AND value = ?").get(fields.strategy)) delete fields.strategy;
    const filled = Object.keys(fields).length ? fillQualification(db, SYSTEM_USER, opp.id, { source: 'landing_page', fields }).filled : [];
    // Nota com tudo o que a pessoa preencheu (aba Notas do painel do lead e Histórico)
    insertActivity(db, {
      contact_id: contactId, opportunity_id: opp.id, type: 'cadastro', source: 'landing_page', ref_type: 'lp_form',
      notes: `Formulário da ${id.lpName} · ${formLabel} · ${AREAS[id.area]}${created ? '' : ' (cadastro já existente: nenhuma duplicata criada)'}\n${formText}`,
    });
    return { contactId, oppId: opp.id, created, filled };
  });
  // Sem responsável: a roleta distribui na hora (a rotina de 15 minutos cobre o que ficar na fila)
  const owner = db.prepare('SELECT owner_id FROM contacts WHERE id = ?').get(result.contactId)?.owner_id;
  if (!owner) require('./distribution').autoDistribute(db, result.contactId);
  const c = db.prepare('SELECT code, owner_id FROM contacts WHERE id = ?').get(result.contactId);
  return { ok: true, status: result.created ? 'criado' : 'existente', codigo: c.code, lp: id.lp, formulario: id.form, area: id.area, objetivo: lp.opp.objective_type || null, distribuido: !!c.owner_id };
}

/* ------------------------- Tela "LPs e rastreio" ------------------------- */

const guard = (user) => {
  if (!['admin', 'gestor'].includes(user.role)) throw forbidden('As LPs e o rastreio são do líder e do administrador.');
};

/** Padrão de UTM da Vero (o gerador de links da tela usa estas listas). */
const UTM_STANDARD = {
  fontes: [['google', 'Google (Ads ou busca)'], ['meta', 'Meta (Facebook e Instagram Ads)'], ['instagram', 'Instagram (perfil, bio, stories)'], ['facebook', 'Facebook (página e grupos)'],
    ['youtube', 'YouTube'], ['tiktok', 'TikTok'], ['linkedin', 'LinkedIn'], ['whatsapp', 'WhatsApp'], ['email', 'E-mail'], ['sms', 'SMS'], ['parceiro', 'Parceiro'], ['indicacao', 'Indicação'], ['evento', 'Evento'], ['offline', 'Material impresso (QR code)']],
  midias: [['cpc', 'Anúncio pago por clique (busca)'], ['pago_social', 'Anúncio pago em rede social'], ['display', 'Display / remarketing'], ['video', 'Vídeo pago'], ['organico', 'Orgânico (post, bio, perfil)'],
    ['email', 'E-mail marketing'], ['mensagem', 'Mensagem (WhatsApp, SMS, direct)'], ['referencia', 'Site parceiro / indicação'], ['qrcode', 'QR code']],
};

function overview(db, user, { origin } = {}) {
  guard(user);
  const base = (process.env.PUBLIC_URL || getSetting(db, 'public_url') || origin || '').replace(/\/+$/, '');
  return { pages: lpPages(db), areas: AREAS, padrao: UTM_STANDARD, crm_url: base, endpoint: `${base}/api/publico/lp/leads`, script: `${base}/lp/vero-rastreio.js`, can_edit: user.role === 'admin' };
}

/** Leads das LPs no período, agrupados por LP, formulário, área, fonte, mídia, campanha ou conteúdo. */
function performance(db, user, q = {}) {
  guard(user);
  const days = Math.min(Math.max(Number.parseInt(q.dias, 10) || 30, 1), 365);
  const by = ['lp', 'formulario', 'area', 'fonte', 'midia', 'campanha', 'conteudo'].includes(q.por) ? q.por : 'lp';
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { visibleOwnerIds } = require('../core');
  const ids = visibleOwnerIds(db, user);
  const rows = db.prepare(`SELECT co.contact_id, co.source_ref, co.utm_source, co.utm_medium, co.utm_campaign, co.utm_content, co.other_params, c.owner_id,
      EXISTS (SELECT 1 FROM opportunities x WHERE x.contact_id = c.id AND x.status = 'ganha') AS ganho,
      EXISTS (SELECT 1 FROM tasks t WHERE t.contact_id = c.id AND t.type = 'reuniao' AND COALESCE(t.meeting_kind, 'r1') = 'r1') AS r1
    FROM contact_origins co JOIN contacts c ON c.id = co.contact_id
    WHERE co.source_ref LIKE 'lp:%' AND c.merged_into_id IS NULL AND COALESCE(co.received_at, co.created_at) >= ?`).all(since);
  const pages = lpPages(db);
  const groups = new Map();
  for (const r of rows) {
    if (ids !== null && r.owner_id != null && !ids.includes(r.owner_id)) continue;
    let extra = {};
    try {
      extra = r.other_params ? JSON.parse(r.other_params) : {};
    } catch {
      extra = {};
    }
    const parts = String(r.source_ref).split(':');
    const lpSlug = parts.length >= 3 ? parts[1] : 'consorcios';
    const form = parts.length >= 3 ? parts[2] : parts[1];
    const canal = extra.canal || {};
    const key = {
      lp: pages.find((p) => p.slug === lpSlug)?.nome || `LP ${lpSlug}`,
      formulario: FORM_LABEL[form] || humanize(form || 'contato'),
      area: AREAS[extra.area] || (lpSlug === 'planejamento' ? AREAS.planejamento : AREAS.consorcio),
      fonte: r.utm_source || (canal.fonte ? `${canal.fonte} (sem UTM)` : '(sem UTM)'),
      midia: r.utm_medium || (canal.meio ? `${canal.meio} (sem UTM)` : '(sem UTM)'),
      campanha: r.utm_campaign || '(sem campanha)',
      conteudo: r.utm_content || '(sem conteúdo)',
    }[by];
    const g = groups.get(key) || { chave: key, entradas: 0, cadastros: new Set(), r1: new Set(), ganhos: new Set() };
    g.entradas++;
    g.cadastros.add(r.contact_id);
    if (r.r1) g.r1.add(r.contact_id);
    if (r.ganho) g.ganhos.add(r.contact_id);
    groups.set(key, g);
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
  const out = [...groups.values()].map((g) => ({ chave: g.chave, entradas: g.entradas, cadastros: g.cadastros.size, com_r1: g.r1.size, ganhos: g.ganhos.size, taxa_r1: pct(g.r1.size, g.cadastros.size), conversao: pct(g.ganhos.size, g.cadastros.size) }))
    .sort((a, b) => b.entradas - a.entradas || a.chave.localeCompare(b.chave));
  const total = out.reduce((t, x) => ({ entradas: t.entradas + x.entradas }), { entradas: 0 });
  return { dias: days, por: by, rows: out, total };
}

/**
 * Arquivo da LP já configurado com o endereço deste CRM (para subir na hospedagem). As LPs do CRM ficam em public/lp com
 * o endereço vazio (enviam para o próprio CRM quando abertas em /lp/); aqui o endereço é preenchido.
 */
function configureHtml(html, crmUrl) {
  const url = String(crmUrl || '').replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s"'<>]+$/.test(url)) throw badRequest('Endereço do CRM inválido: defina PUBLIC_URL (ex.: https://crm.veroconsorciosbr.com.br).');
  if (!/window\.VERO_LP=\{crm:"[^"]*"/.test(html)) throw badRequest('O arquivo não tem a configuração da Vero (rode scripts/preparar-lp.js).');
  return html.replace(/window\.VERO_LP=\{crm:"[^"]*"/, `window.VERO_LP={crm:${JSON.stringify(url)}`);
}

function lpFile(db, user, slugParam, { origin } = {}) {
  guard(user);
  const page = lpPages(db).find((p) => p.slug === slugParam);
  if (!page?.arquivo) throw notFound('Esta LP não tem arquivo guardado no CRM.');
  // fs e path só aqui: a versão de teste no navegador não tem os arquivos das LPs
  const fs = require('node:fs');
  const file = require('node:path').join(__dirname, '..', '..', 'public', 'lp', page.arquivo);
  if (!fs.existsSync || !fs.existsSync(file)) throw notFound('Arquivo da LP não encontrado no servidor.');
  const base = process.env.PUBLIC_URL || getSetting(db, 'public_url') || origin;
  return { filename: page.arquivo, html: configureHtml(fs.readFileSync(file, 'utf8'), base) };
}

module.exports = { receive, interpret, identify, tracking, lpPages, saveLpPages, overview, performance, lpFile, configureHtml, LP_FILES, AREAS, UTM_STANDARD };
