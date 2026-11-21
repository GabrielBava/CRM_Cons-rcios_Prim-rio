'use strict';
/**
 * IA Vero (aba "IA" do painel do lead): ajuda o especialista a entender o lead e decidir o que fazer.
 *
 * Motor interno (sempre disponível): lê tudo o que o CRM sabe do lead — etapa e critérios que faltam, atividades por
 * canal, reuniões, propostas, produtos de cross-sell, diagnóstico, SLA e score — e devolve o próximo passo, o canal e o
 * horário sugeridos, alertas, checklist BANT, perguntas SPIN, respostas a objeções prontas para o WhatsApp e mensagens.
 * Aprende com o uso: a base de conhecimento (objeções, perguntas, dicas e mensagens) é alimentada pela liderança, as
 * respostas recebem 👍/👎 e a taxa de resposta de cada canal na equipe orienta a sugestão de canal.
 *
 * Chat generativo (opcional): com o SDK oficial da Anthropic instalado (npm install @anthropic-ai/sdk), a chave
 * ANTHROPIC_API_KEY e a opção ligada pelo administrador, as perguntas livres são respondidas pelo Claude com o contexto
 * do lead (sem CPF, RG, telefone ou e-mail). Sem isso, o motor interno responde.
 */
const { getSetting, setSetting } = require('../db');
const { loadContact, audit, optionLabel } = require('../core');
const { badRequest, forbidden, notFound, clean: cleanRaw, nowIso, sealSecret, openSecret } = require('../util');
const { ACTIVITY_TYPES } = require('../constants');

const clean = (v) => cleanRaw(v) ?? null;
const DAY = 86400000;
const CHANNELS = {
  ligacao: { label: 'Telefone', verb: 'Ligar' },
  whatsapp: { label: 'WhatsApp', verb: 'Mandar WhatsApp' },
  email: { label: 'E-mail', verb: 'Enviar e-mail' },
  direct: { label: 'Direct (Instagram)', verb: 'Mandar direct' },
  linkedin: { label: 'LinkedIn', verb: 'Mandar DM no LinkedIn' },
};
const daysBetween = (a, b = Date.now()) => Math.floor((b - Date.parse(a)) / DAY);
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—');
const money = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }));
const first = (name) => String(name || '').trim().split(/\s+/)[0] || 'tudo bem';

/* ------------------------- Biblioteca (base interna) ------------------------- */

/** Objeções mais comuns no WhatsApp, com a resposta pronta e a dica de condução. */
const OBJECTIONS = [
  { key: 'caro', title: 'Está caro / a parcela não cabe', match: /caro|parcela.*(alta|pesad)|n[ãa]o cabe|valor alto|pre[çc]o/i,
    response: 'Entendo, {nome}. Antes de falar de valor, me ajuda a entender: qual parcela ficaria confortável para você hoje? Consigo montar um cenário com crédito menor, prazo maior ou com lance embutido para a parcela caber no seu orçamento, sem juros como no financiamento.',
    tip: 'Ancore no objetivo (o que ele quer conquistar) e compare com o custo do financiamento/aluguel. Ofereça 2 cenários, nunca 1.' },
  { key: 'pensar', title: 'Vou pensar', match: /pensar|analisar|ver com calma|depois te falo/i,
    response: 'Claro, {nome}, é uma decisão importante. Para te ajudar a pensar: o que ainda deixa você em dúvida — o valor, o prazo ou o tempo até a contemplação? Assim eu já te mando exatamente o que falta.',
    tip: 'Descubra a objeção real por trás do "vou pensar" e marque um próximo contato com data e hora.' },
  { key: 'conjuge', title: 'Preciso falar com cônjuge/sócio', match: /c[ôo]njuge|esposa|marido|s[óo]cio|fam[ií]lia|decidir junto/i,
    response: 'Faz todo sentido decidir juntos, {nome}. Que tal marcarmos 20 minutos com vocês dois? Eu apresento os cenários e tiro as dúvidas na hora. Qual horário fica melhor para vocês?',
    tip: 'Traga o decisor para a próxima reunião (BANT: Authority). Evite "aguardar retorno".' },
  { key: 'confianca', title: 'Não confio em consórcio', match: /confi|golpe|seguro mesmo|empresa s[ée]ria|medo/i,
    response: 'Sua preocupação é muito válida, {nome}. O consórcio é regulado pelo Banco Central e trabalhamos com administradoras autorizadas. Posso te enviar o registro da administradora e explicar como funciona a garantia do seu dinheiro?',
    tip: 'Use prova social e a regulação do Banco Central. Nunca prometa data de contemplação.' },
  { key: 'demora', title: 'Demora para contemplar', match: /demora|contempla|sorteio|quando (vou|eu) (receber|pegar)/i,
    response: 'Ótima pergunta, {nome}. Além do sorteio, existe o lance (com recurso próprio, FGTS ou embutido) que pode antecipar a contemplação. Posso te mostrar a média de lances do grupo e um plano para você ter mais chances?',
    tip: 'Mostre estratégia de lance realista para o perfil. Não prometa prazo.' },
  { key: 'financiamento', title: 'Prefiro financiamento / já tenho financiamento', match: /financiamento|financiar|banco/i,
    response: 'Entendo, {nome}. Vale comparar os dois: no financiamento você paga juros que podem dobrar o valor do bem; no consórcio paga a taxa de administração, sem juros. Posso montar a comparação lado a lado com os seus números?',
    tip: 'Use a tabela comparativa (custo total). Se ele precisa do bem agora, o financiamento pode ser a resposta — seja honesto.' },
  { key: 'momento', title: 'Agora não é o momento', match: /momento|agora n[ãa]o|mais pra frente|ano que vem|sem tempo/i,
    response: 'Sem problema, {nome}. Justamente por ser um planejamento, quanto antes começar, mais cedo você chega lá. Posso te mandar um cenário com uma parcela menor para começar agora e ajustar depois?',
    tip: 'Se a resposta for firme, mova para Nutrição futura com data de retorno (não para Perdido).' },
  { key: 'mandar', title: 'Me manda por WhatsApp / e-mail', match: /manda (por|no)|envia|me passa/i,
    response: 'Mando sim, {nome}! Para eu te enviar algo que faça sentido de verdade, me responde só duas coisas: qual o seu objetivo (imóvel, carro, investimento) e em quanto tempo quer realizar?',
    tip: 'Use o pedido de material para qualificar (Need e Timing) e já proponha a R1.' },
];

/** Perguntas SPIN por etapa (Situação, Problema, Implicação, Necessidade de solução). */
const SPIN = {
  inicio: [
    ['Situação', 'Hoje você mora de aluguel ou já tem imóvel próprio? Como está sua organização financeira?'],
    ['Problema', 'O que te impediu até agora de realizar esse objetivo?'],
    ['Implicação', 'Se continuar adiando, o que isso representa para você e sua família daqui a 5 anos?'],
    ['Necessidade', 'Se existisse um caminho sem juros, com parcela que cabe no bolso, faria sentido conhecer?'],
  ],
  reuniao: [
    ['Situação', 'Qual a sua renda familiar e quanto consegue reservar por mês sem apertar?'],
    ['Problema', 'Quanto você já pagou de aluguel/juros nos últimos anos?'],
    ['Implicação', 'Quanto desse dinheiro poderia ter virado patrimônio?'],
    ['Necessidade', 'Se a gente montar uma estratégia de lance para antecipar, você teria interesse em seguir hoje?'],
  ],
  fechamento: [
    ['Situação', 'Ficou alguma dúvida sobre a proposta que te enviei?'],
    ['Problema', 'O que falta para você se sentir seguro em seguir?'],
    ['Implicação', 'Esperar o próximo reajuste muda o valor da carta — faz sentido garantir as condições de agora?'],
    ['Necessidade', 'Posso já reservar a sua cota e te enviar a ficha de adesão?'],
  ],
};

/* ------------------------- Contexto do lead ------------------------- */

function leadData(db, user, contactId) {
  const c = loadContact(db, user, contactId);
  const opps = require('./opportunities');
  const oppRow = db.prepare("SELECT id FROM opportunities WHERE contact_id = ? ORDER BY status = 'aberta' DESC, id DESC LIMIT 1").get(c.id);
  const o = oppRow ? opps.getOpportunity(db, user, oppRow.id) : null;
  const acts = db.prepare('SELECT type, channel, result, occurred_at, notes FROM activities WHERE contact_id = ? ORDER BY occurred_at DESC LIMIT 300').all(c.id);
  const tasks = db.prepare("SELECT id, type, title, due_at, meeting_kind FROM tasks WHERE contact_id = ? AND status = 'pendente' ORDER BY due_at").all(c.id);
  const proposals = db.prepare("SELECT code, status, credit_value, area, created_at, last_response FROM proposals WHERE contact_id = ? AND status <> 'substituida' ORDER BY created_at DESC").all(c.id);
  const products = require('./leadproducts').listProducts(db, user, c.id);
  const diag = db.prepare('SELECT status, summary, updated_at FROM diagnostics WHERE contact_id = ? ORDER BY id DESC LIMIT 1').get(c.id);
  const meetings = db.prepare("SELECT title, meeting_kind, outcome, notes, completed_at, due_at FROM tasks WHERE contact_id = ? AND type = 'reuniao' AND status = 'concluida' ORDER BY COALESCE(completed_at, due_at) DESC LIMIT 10").all(c.id);
  return { c, o, acts, tasks, proposals, products, diag, meetings };
}

/** Estatística por canal deste lead e taxa de resposta da equipe nos últimos 90 dias (aprendizado com o uso). */
function channelStats(db, acts) {
  const per = {};
  for (const a of acts) {
    const def = ACTIVITY_TYPES[a.type];
    if (!def || def.system) continue;
    const ch = a.channel || def.channel;
    if (!CHANNELS[ch]) continue;
    const s = (per[ch] ||= { out: 0, in: 0, last_out: null, last_in: null });
    if (def.outbound) {
      s.out++;
      s.last_out ||= a.occurred_at;
    } else {
      s.in++;
      s.last_in ||= a.occurred_at;
    }
  }
  const since = new Date(Date.now() - 90 * DAY).toISOString();
  const team = {};
  for (const r of db.prepare("SELECT type, channel FROM activities WHERE occurred_at >= ? AND source IN ('manual','whatsapp','discadora')").all(since)) {
    const def = ACTIVITY_TYPES[r.type];
    if (!def || def.system) continue;
    const ch = r.channel || def.channel;
    if (!CHANNELS[ch]) continue;
    const t = (team[ch] ||= { out: 0, in: 0 });
    if (def.outbound) t.out++;
    else t.in++;
  }
  for (const t of Object.values(team)) t.rate = t.out ? Math.min(1, t.in / t.out) : null;
  return { per, team };
}

function suggestChannel(c, stats) {
  const opt = (() => {
    try {
      return JSON.parse(c.optouts || '[]');
    } catch {
      return [];
    }
  })();
  const allowed = Object.keys(CHANNELS).filter((ch) => !opt.includes('todos') && !opt.includes(ch)).filter((ch) => {
    if (ch === 'ligacao' || ch === 'whatsapp') return !!(c.phone1 || c.whatsapp);
    if (ch === 'email') return !!c.email;
    return true;
  });
  if (!allowed.length) return { channel: null, reason: 'O cadastro pediu para não receber contatos ou não tem telefone/e-mail. Atualize o cadastro antes de tentar.' };
  const answered = Object.entries(stats.per).filter(([ch, s]) => s.in > 0 && allowed.includes(ch)).sort((a, b) => (a[1].last_in < b[1].last_in ? 1 : -1));
  if (answered.length) return { channel: answered[0][0], reason: `O lead já respondeu por ${CHANNELS[answered[0][0]].label} (última vez em ${fmtDate(answered[0][1].last_in)}). Continue no canal em que ele responde.` };
  const calls = stats.per.ligacao?.out || 0;
  const origin = String(c.origin || '');
  if (/instagram|facebook|meta/.test(origin) && allowed.includes('direct') && !(stats.per.direct?.out)) return { channel: allowed.includes('whatsapp') ? 'whatsapp' : 'direct', reason: 'Lead de rede social: aborde por mensagem (WhatsApp ou direct) citando o anúncio que ele viu.' };
  if (/linkedin/.test(origin) && allowed.includes('linkedin')) return { channel: 'linkedin', reason: 'Lead do LinkedIn: comece pela DM, com uma mensagem curta e profissional.' };
  if (calls >= 3 && allowed.includes('whatsapp')) return { channel: 'whatsapp', reason: `Já foram ${calls} ligações sem resposta: troque para WhatsApp com uma mensagem curta e uma pergunta fácil de responder.` };
  if (!calls && allowed.includes('ligacao')) return { channel: 'ligacao', reason: 'Primeira abordagem: ligue (contato por voz converte mais) e, se não atender, mande WhatsApp em seguida.' };
  const best = allowed.map((ch) => [ch, stats.team[ch]?.rate ?? 0]).sort((a, b) => b[1] - a[1])[0];
  return { channel: best[0], reason: best[1] ? `Na equipe, ${CHANNELS[best[0]].label} é o canal com mais respostas nos últimos 90 dias (${Math.round(best[1] * 100)}%).` : `Tente por ${CHANNELS[best[0]].label}.` };
}

function bestHour(acts) {
  const hours = acts.filter((a) => !ACTIVITY_TYPES[a.type]?.outbound && !ACTIVITY_TYPES[a.type]?.system && /recebid|realizada/.test(a.type))
    .map((a) => Number(new Date(a.occurred_at).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false })));
  if (!hours.length) return 'Sem histórico de resposta: tente entre 9h e 11h ou entre 17h e 19h.';
  const count = {};
  hours.forEach((h) => (count[h] = (count[h] || 0) + 1));
  const h = Number(Object.entries(count).sort((a, b) => b[1] - a[1])[0][0]);
  return `O lead costuma responder por volta das ${String(h).padStart(2, '0')}h.`;
}

/* ------------------------- Insights ------------------------- */

function insights(db, user, contactId) {
  const { c, o, acts, tasks, proposals, products, diag, meetings } = leadData(db, user, contactId);
  const stats = channelStats(db, acts);
  const canal = suggestChannel(c, stats);
  const name = first(c.name);
  const m = o?.meetings || {};
  const stage = o?.stage_key || null;
  const alerts = [];
  const contactActs = acts.filter((a) => !ACTIVITY_TYPES[a.type]?.system && a.type !== 'observacao');
  const firstContact = c.first_contact_at;
  const r1Deadline = firstContact ? new Date(Date.parse(firstContact) + 3 * DAY).toISOString() : null;
  if (o?.sla?.level === 'estourado') alerts.push({ level: 'danger', text: `SLA estourado: ${o.sla.text}.` });
  if (o && o.status === 'aberta' && !o.next_action) alerts.push({ level: 'warn', text: 'Sem próxima ação definida: deixe a próxima atividade agendada.' });
  if (r1Deadline && !m.r1 && ['lead', 'tentativa', 'qualificado'].includes(stage)) {
    const left = Math.ceil((Date.parse(r1Deadline) - Date.now()) / DAY);
    alerts.push({ level: left < 0 ? 'danger' : 'warn', text: left < 0 ? `Prazo da R1 vencido há ${-left} dia(s) (3 dias após o primeiro contato).` : `Faltam ${left} dia(s) para o prazo de agendar a R1.` });
  }
  if (m.r1?.state === 'no_show') alerts.push({ level: 'warn', text: 'O cliente faltou à R1 (NS): remarque ainda hoje.' });
  if (proposals.some((p) => p.status === 'apresentada' && daysBetween(p.created_at) > 3 && !p.last_response)) alerts.push({ level: 'warn', text: 'Proposta enviada há mais de 3 dias sem resposta: faça o follow-up.' });

  // Próximo passo por etapa
  let next;
  const attempts = contactActs.filter((a) => ACTIVITY_TYPES[a.type]?.outbound).length;
  if (!o || o.status !== 'aberta') next = o?.status === 'perdida' ? 'Lead perdido: avalie reativar em 60–90 dias com uma nova abordagem (Nutrição futura).' : o?.status === 'pausada' ? 'Em nutrição: retome na data combinada com conteúdo de valor, sem pressão.' : 'Sem negócio aberto: crie uma oportunidade se houver interesse.';
  else if (stage === 'prospect') next = 'Faça a primeira abordagem e confirme o interesse para virar lead.';
  else if (stage === 'lead') next = `Faça a primeira tentativa de contato hoje (${CHANNELS[canal.channel]?.verb || 'contato'}). Ao registrar, o lead vai para Tentativa de contato.`;
  else if (stage === 'tentativa') next = attempts < 3 ? `Nova tentativa por outro canal (${CHANNELS[canal.channel]?.label || '—'}). Quando conseguir falar, preencha e conclua a qualificação.` : attempts < 6 ? 'Cadência: mais 2 tentativas em 48h alternando ligação e WhatsApp. Ao conseguir contato, conclua a qualificação.' : 'Já foram 6+ tentativas sem resposta: última mensagem de "posso encerrar seu atendimento?" e, sem retorno, dê como perdido (MP9 Sem contato).';
  else if (stage === 'qualificado') next = `Agende a R1${r1Deadline ? ` até ${fmtDate(r1Deadline)}` : ''} (clique em Ganho). Sem agenda possível, registre o motivo de perda (MP).`;
  else if (stage === 'r1') next = m.r1?.state === 'no_show' ? 'Remarque a R1 com o cliente.' : m.r1?.state === 'realizada' ? 'R1 feita: agende a R2 para apresentar a proposta.' : 'Confirme a presença na véspera (D-1) e prepare o modelo da R1.';
  else if (stage === 'r2') next = proposals.length ? 'Proposta gerada: conduza a R2 e avance para Negociação.' : 'Gere a proposta (consórcio, seguros, planejamento ou investimentos): é ela que libera a Negociação.';
  else if (stage === 'negociacao') next = 'Follow-up da proposta: trate as objeções e proponha o fechamento com data.';
  else next = 'Acompanhe o pós-venda.';

  const bant = [
    { key: 'B', label: 'Budget (orçamento)', ok: !!(o?.credit_value || o?.installment_max), value: o?.installment_max ? `parcela até ${money(o.installment_max)}` : o?.credit_value ? `crédito ${money(o.credit_value)}` : null, ask: 'Quanto você consegue investir por mês sem apertar o orçamento?' },
    { key: 'A', label: 'Authority (decisor)', ok: !!o?.decision_maker, value: o?.decision_maker ? optionLabel(db, 'decisor', o.decision_maker) || o.decision_maker : null, ask: 'Além de você, mais alguém participa dessa decisão?' },
    { key: 'N', label: 'Need (necessidade)', ok: !!(o?.objective_type || o?.credit_purpose_type), value: o?.objective_type ? optionLabel(db, 'objetivo', o.objective_type) || o.objective_type : null, ask: 'O que você quer conquistar com isso e por que agora?' },
    { key: 'T', label: 'Timing (prazo)', ok: !!o?.urgency, value: o?.urgency ? optionLabel(db, 'urgencia', o.urgency) || o.urgency : null, ask: 'Em quanto tempo você gostaria de estar com isso resolvido?' },
  ];
  const spinSet = ['r1', 'r2'].includes(stage) ? SPIN.reuniao : stage === 'negociacao' ? SPIN.fechamento : SPIN.inicio;
  const kb = db.prepare('SELECT * FROM ai_knowledge WHERE active = 1 AND (stage_key IS NULL OR stage_key = ?) ORDER BY likes - dislikes DESC, id DESC').all(stage || '');
  const objections = [
    ...kb.filter((k) => k.kind === 'objecao').map((k) => ({ key: `kb${k.id}`, kb_id: k.id, title: k.title, response: k.content.replace(/\{nome\}/g, name), tip: 'Da base de conhecimento da equipe.', likes: k.likes })),
    ...OBJECTIONS.map((x) => ({ key: x.key, title: x.title, response: x.response.replace(/\{nome\}/g, name), tip: x.tip })),
  ];
  const questions = [...spinSet.map(([k, q]) => ({ kind: k, text: q })), ...kb.filter((k) => k.kind === 'pergunta').map((k) => ({ kind: 'Equipe', text: k.content, kb_id: k.id }))];
  const spec = db.prepare('SELECT name FROM users WHERE id = ?').get(o?.owner_id || c.owner_id || user.id)?.name || user.name;
  const msgs = [
    { title: 'Primeira abordagem', text: `Olá, ${name}! Aqui é ${first(spec)}, da ${getSetting(db, 'company_name') || 'Vero'}. Vi seu interesse em ${o?.credit_category ? `${String(optionLabel(db, 'categoria_credito', o.credit_category) || o.credit_category).toLowerCase()}` : 'planejar sua conquista'} e queria te ajudar a montar o melhor caminho. Podemos falar 5 minutinhos hoje?` },
    { title: 'Agendar a R1', text: `${name}, que tal uma conversa de 30 minutos por vídeo para eu entender seu objetivo e te mostrar os cenários? Tenho horário amanhã às 10h ou às 15h. Qual fica melhor?` },
    { title: 'Follow-up da proposta', text: `Oi, ${name}! Conseguiu olhar a proposta? Se quiser, ajusto o valor da parcela ou o prazo para ficar do jeito certo para você.` },
    ...kb.filter((k) => k.kind === 'mensagem').map((k) => ({ title: k.title, text: k.content.replace(/\{nome\}/g, name), kb_id: k.id })),
  ];
  const tips = kb.filter((k) => k.kind === 'dica').map((k) => ({ title: k.title, text: k.content, kb_id: k.id }));
  // Cross-sell: o que já foi mapeado e o que sugerir
  const areas = products.totals;
  const cross = [];
  if (!areas.seguros.count && (o?.credit_category === 'imovel' || o?.business_area === 'consorcio')) cross.push('Seguro de vida / proteção de renda para garantir as parcelas e a família.');
  if (!areas.planejamento.count && (!diag || diag.status !== 'concluido')) cross.push('Diagnóstico financeiro (Planejamento): mapeia dívidas, reserva e aposentadoria e abre novas oportunidades.');
  if (!areas.investimentos.count && o?.has_bid_resources === 'sim') cross.push('Investimentos: o recurso reservado para o lance pode render até a contemplação.');
  // Score e como subir
  const missing = [];
  if (!o?.objective_type) missing.push('objetivo (+10)');
  if (!o?.credit_value) missing.push('valor estimado (+10)');
  if (!o?.urgency) missing.push('prioridade/prazo (+10)');
  if (!attempts) missing.push('tentativa de contato (+10)');
  if (!m.r1) missing.push('R1 agendada (+10)');
  const openItems = [
    ...tasks.map((t) => `${t.type === 'reuniao' ? (t.meeting_kind || 'r1').toUpperCase() : 'Tarefa'}: ${t.title} (${fmtDate(t.due_at)})`),
    ...proposals.filter((p) => ['rascunho', 'apresentada', 'em_analise'].includes(p.status)).map((p) => `Proposta ${p.code} (${p.status}) ${money(p.credit_value)}`),
  ];
  // O que foi combinado: anotações das reuniões concluídas e das conversas/atividades com observação (mais recentes primeiro)
  const OUTCOME = { realizada: 'realizada', nao_compareceu: 'não compareceu', remarcada: 'remarcada', cancelada: 'cancelada' };
  const agreed = [
    ...meetings.filter((t) => t.notes).map((t) => ({ at: t.completed_at || t.due_at, text: `${(t.meeting_kind || 'r1').toUpperCase()} ${OUTCOME[t.outcome] || ''}: ${String(t.notes).replace(/\s*Link da reunião: \S+/g, '').trim()}` })),
    ...acts.filter((a) => a.notes && !ACTIVITY_TYPES[a.type]?.system && !/^Contato que gerou o agendamento/.test(a.notes)).map((a) => ({ at: a.occurred_at, text: `${ACTIVITY_TYPES[a.type]?.label || a.type}: ${a.notes}` })),
  ].filter((x) => x.text && !/: $/.test(x.text)).sort((x, y) => (x.at < y.at ? 1 : -1)).slice(0, 8);
  // Fontes que a IA consultou para este lead
  const qualFilled = o ? ['objective_type', 'credit_purpose_type', 'credit_category', 'credit_value', 'urgency', 'installment_min', 'installment_max', 'financial_moment', 'has_bid_resources', 'decision_maker', 'had_consortium'].filter((f) => o[f] != null && o[f] !== '').length : 0;
  const kbCount = db.prepare('SELECT COUNT(*) AS n FROM ai_knowledge WHERE active = 1').get().n;
  const sources = [
    { key: 'cadastro', label: 'Cadastro do lead', n: 1 },
    { key: 'negocio', label: 'Negócio e etapa do funil', n: o ? 1 : 0 },
    { key: 'atividades', label: 'Atividades', n: contactActs.length },
    { key: 'qualificacao', label: 'Qualificação', n: qualFilled },
    { key: 'reunioes', label: 'Reuniões (R1/R2)', n: meetings.length + tasks.filter((t) => t.type === 'reuniao').length },
    { key: 'propostas', label: 'Propostas', n: proposals.length },
    { key: 'produtos', label: 'Produtos mapeados', n: products.rows.length },
    { key: 'diagnostico', label: 'Diagnóstico financeiro', n: diag ? 1 : 0 },
    { key: 'base', label: 'Base da IA Vero', n: kbCount },
  ].filter((x) => x.n > 0);
  const resumo = `${c.name} (${c.kind}, ${c.code}) · ${o ? `${o.stage_name}, ${o.days_in_stage} dia(s) na etapa` : 'sem negócio aberto'} · origem ${c.origin || '—'} · ${contactActs.length} atividade(s), ${attempts} tentativa(s) · temperatura ${o?.temperature || c.temperature || '—'} · score ${o?.score ?? '—'}.`;
  return {
    contact: { id: c.id, name: c.name, first_name: name },
    stage: o ? { key: o.stage_key, name: o.stage_name, days: o.days_in_stage, status: o.status } : null,
    resumo, next, alerts, canal: { ...canal, label: CHANNELS[canal.channel]?.label || null, hour: bestHour(acts) },
    channels: Object.fromEntries(Object.entries(stats.per).map(([k, v]) => [k, { ...v, label: CHANNELS[k].label }])),
    team_rates: Object.fromEntries(Object.entries(stats.team).map(([k, v]) => [k, v.rate])),
    bant, questions, objections, messages: msgs, tips, cross_sell: cross, open_items: openItems,
    score: { value: o?.score ?? null, missing },
    products: { potential: products.potential, totals: products.totals },
    diagnostic: diag ? { status: diag.status, updated_at: diag.updated_at } : null,
    r1_deadline: r1Deadline,
    agreed, sources,
  };
}

/* ------------------------- Chat ------------------------- */

/** Atalhos do chat (botões abaixo do orbe). */
const QUICK = [
  { key: 'objecoes', label: 'Objeções', icon: 'escudo', prompt: 'Objeções' },
  { key: 'proximo', label: 'Próximo passo', icon: 'bandeira', prompt: 'Qual o próximo passo?' },
  { key: 'combinado', label: 'O que foi combinado', icon: 'lista', prompt: 'O que foi combinado com o cliente?' },
  { key: 'mensagem', label: 'Mensagem pronta', icon: 'caneta', prompt: 'Mensagem pronta para o WhatsApp' },
];
const SUGGESTIONS = [
  'Como seguir o próximo follow-up?', 'Em que etapa está e o que falta para avançar?', 'O que ele tem em aberto?', 'Quais oportunidades de cross-sell?',
  'Qual canal e horário tentar?', 'Perguntas SPIN para a próxima conversa', 'Checklist BANT', 'Objeção: está caro', 'Objeção: vou pensar', 'Como subir o score?',
];

/** Resposta do motor interno: identifica a intenção da pergunta e monta a resposta com os dados do lead. */
function internalAnswer(ins, question) {
  const q = String(question || '').toLowerCase();
  const lines = [];
  const objection = OBJECTIONS.find((x) => x.match.test(q));
  if (/combinad|acordad|ficou (de|certo)|o que (ele|ela|o cliente) (disse|falou)/.test(q)) {
    lines.push('**O que foi combinado**');
    if (ins.agreed.length) lines.push(...ins.agreed.map((x) => `- ${x.text}`));
    else lines.push('- Ainda não há anotações de reunião ou de conversa com o cliente. Registre o que foi combinado ao concluir a R1/R2 ou em Atividades.');
    if (ins.open_items.length) lines.push('', 'Em aberto:', ...ins.open_items.map((x) => `- ${x}`));
  } else if (/mensagem|texto pronto|whats.*pront|o que (mando|escrevo)/.test(q) && !objection) {
    const st = ins.stage?.key;
    const pick = ['negociacao', 'r2'].includes(st) ? 2 : ['qualificado', 'tentativa'].includes(st) ? 1 : 0;
    const msgs = [ins.messages[pick], ...ins.messages.filter((m, i) => i !== pick)].filter(Boolean).slice(0, 3);
    lines.push('**Mensagem pronta (WhatsApp)**', '', `> ${msgs[0].text}`);
    if (msgs.length > 1) lines.push('', 'Outras opções:', ...msgs.slice(1).map((m) => `- ${m.title}: ${m.text}`));
  } else if (/obje/.test(q) && !objection) {
    lines.push('**Objeções mais comuns e como responder**');
    for (const o of ins.objections.slice(0, 5)) lines.push(`- **${o.title}** — ${o.response}`);
    lines.push('', 'Pergunte por uma específica (ex.: "Objeção: vou pensar") para ver a dica de condução.');
  } else if (/obje|caro|pensar|c[ôo]njuge|esposa|marido|confi|demora|contempla|financiamento|momento|manda/.test(q) && objection) {
    const o = ins.objections.find((x) => x.key === objection.key) || objection;
    lines.push(`**Objeção: ${o.title}**`, '', `Resposta sugerida (WhatsApp):`, `> ${o.response}`, '', `Dica: ${o.tip}`);
  } else if (/canal|hor[áa]rio|ligar|whats|contato|tentar/.test(q)) {
    lines.push(`**Canal sugerido: ${ins.canal.label || '—'}**`, ins.canal.reason, '', ins.canal.hour);
    const ch = Object.values(ins.channels).map((c) => `${c.label}: ${c.out} enviada(s), ${c.in} resposta(s)`);
    if (ch.length) lines.push('', 'Histórico deste lead:', ...ch.map((x) => `- ${x}`));
  } else if (/spin|pergunt/.test(q)) {
    lines.push('**Perguntas para a próxima conversa (SPIN)**', ...ins.questions.map((x) => `- ${x.kind}: ${x.text}`));
  } else if (/bant|qualifica/.test(q)) {
    lines.push('**Checklist BANT**', ...ins.bant.map((b) => `- ${b.ok ? '✅' : '⬜'} ${b.label}${b.value ? `: ${b.value}` : ''}${b.ok ? '' : ` — pergunte: "${b.ask}"`}`));
  } else if (/score|potencial|temperatura|quente/.test(q)) {
    lines.push(`**Score: ${ins.score.value ?? '—'} de 100**`, ins.score.missing.length ? `Para subir: ${ins.score.missing.join(', ')}.` : 'O lead já tem as informações principais: foque em avançar a etapa.');
  } else if (/cross|upsell|up-sell|oportunidad|produto/.test(q)) {
    lines.push(`**Oportunidades**`, `Potencial mapeado: ${money(ins.products.potential)}.`);
    lines.push(...(ins.cross_sell.length ? ins.cross_sell.map((x) => `- ${x}`) : ['- Nenhuma sugestão nova: registre em Produtos o que identificar na conversa.']));
  } else if (/aberto|pendente|tarefa|agenda/.test(q)) {
    lines.push('**Em aberto**', ...(ins.open_items.length ? ins.open_items.map((x) => `- ${x}`) : ['- Nada pendente. Defina a próxima ação.']));
  } else if (/etapa|fase|falta|avan[çc]/.test(q)) {
    lines.push(`**Etapa: ${ins.stage?.name || '—'}**${ins.stage ? ` (${ins.stage.days} dia(s))` : ''}`, `Próximo passo: ${ins.next}`);
  } else if (/follow|pr[óo]ximo|fazer|seguir|conduzir/.test(q)) {
    lines.push(`**Próximo passo**`, ins.next, '', `Canal: ${ins.canal.label || '—'} — ${ins.canal.reason}`);
    const msg = ins.messages[0];
    if (msg) lines.push('', `Mensagem pronta:`, `> ${msg.text}`);
  } else {
    lines.push(`**Resumo do lead**`, ins.resumo, '', `Próximo passo: ${ins.next}`);
    if (ins.alerts.length) lines.push('', 'Atenção:', ...ins.alerts.map((a) => `- ${a.text}`));
  }
  return lines.join('\n');
}

let clientFactory = null;
/** Testes: injeta um cliente falso da Anthropic. */
function setClientFactory(fn) {
  clientFactory = fn;
}
function sdk() {
  try {
    const mod = require('@anthropic-ai/sdk');
    return mod.default || mod;
  } catch {
    return null;
  }
}
function llmConfig(db) {
  const key = process.env.ANTHROPIC_API_KEY || openSecret(getSetting(db, 'ai_api_key_enc')) || '';
  const Anthropic = clientFactory ? null : sdk();
  return { enabled: getSetting(db, 'ai_llm_enabled') === true, key, sdk: !!(clientFactory || Anthropic), Anthropic, model: getSetting(db, 'ai_model') || 'claude-opus-5-5' };
}

const SYSTEM_PROMPT = `Você é a IA Vero, assistente comercial interna da plataforma da Vero (consórcio, planejamento financeiro, seguros e investimentos).
Ajude o especialista a conduzir o lead: próximo passo, canal, perguntas (SPIN), qualificação (BANT), objeções e mensagens para WhatsApp.
Regras: responda em português do Brasil, curto e prático (até 8 linhas ou uma lista curta); use só os dados do contexto do lead; quando faltar dado, diga o que perguntar ao cliente; nunca prometa data de contemplação, rentabilidade ou aprovação; mensagens de WhatsApp em tom cordial, sem jargão, com uma pergunta no final.
Fluxo do pipeline: Prospect → Lead → Tentativa de contato (exige atividade) → Qualificação (exige qualificação concluída) → R1 (agendada) → R2 (agendada) → Negociação (exige proposta) → Venda. Perdido exige motivo MP1–MP9.`;

async function llmAnswer(db, cfg, ins, history, question) {
  const client = clientFactory ? clientFactory(cfg) : new cfg.Anthropic({ apiKey: cfg.key });
  const context = JSON.stringify({ resumo: ins.resumo, etapa: ins.stage, proximo_passo: ins.next, alertas: ins.alerts.map((a) => a.text), canal: ins.canal, bant: ins.bant.map((b) => ({ item: b.label, ok: b.ok, valor: b.value })), em_aberto: ins.open_items, combinado: ins.agreed.map((x) => x.text), oportunidades: ins.cross_sell, score: ins.score, prazo_r1: ins.r1_deadline });
  const response = await client.beta.messages.create({
    model: cfg.model,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }, { type: 'text', text: `Contexto do lead (dados do CRM):\n${context}` }],
    messages: [...history, { role: 'user', content: question }],
  });
  if (response.stop_reason === 'refusal') return null;
  const text = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  return text || null;
}

const threadId = (t) => (/^[a-z0-9-]{4,40}$/i.test(String(t || '')) ? String(t) : null);

async function chat(db, user, contactId, data = {}) {
  const question = clean(data.message);
  if (!question) throw badRequest('Escreva a pergunta.');
  if (question.length > 2000) throw badRequest('Pergunta muito longa.');
  const ins = insights(db, user, contactId);
  const now = nowIso();
  const thread = threadId(data.thread) || `t-${Date.now().toString(36)}`;
  db.prepare("INSERT INTO ai_messages (contact_id, user_id, role, content, thread, created_at) VALUES (?, ?, 'user', ?, ?, ?)").run(ins.contact.id, user.id, question, thread, now);
  const cfg = llmConfig(db);
  let answer = null;
  let engine = 'interna';
  let note = null;
  if (cfg.enabled && cfg.key && cfg.sdk) {
    const history = db.prepare('SELECT role, content FROM ai_messages WHERE contact_id = ? AND user_id = ? AND thread = ? ORDER BY id DESC LIMIT 11').all(ins.contact.id, user.id, thread).reverse().slice(0, -1);
    try {
      answer = await llmAnswer(db, cfg, ins, history, question);
      if (answer) engine = 'claude';
    } catch (e) {
      const A = cfg.Anthropic;
      note = A && e instanceof A.RateLimitError ? 'A IA generativa está com muitas solicitações agora; respondi com o motor interno.'
        : A && e instanceof A.AuthenticationError ? 'Chave da IA generativa inválida (Configurações › Integrações); respondi com o motor interno.'
          : 'A IA generativa não respondeu; respondi com o motor interno.';
    }
  }
  if (!answer) answer = internalAnswer(ins, question);
  const id = Number(db.prepare('INSERT INTO ai_messages (contact_id, user_id, role, content, engine, thread, created_at) VALUES (?, ?, \'assistant\', ?, ?, ?, ?)').run(ins.contact.id, user.id, answer, engine, thread, nowIso()).lastInsertRowid);
  return { id, answer, engine, note, thread };
}

/**
 * Conversas do usuário com a IA sobre o lead: a lista (primeira pergunta e data de cada conversa) e as mensagens da
 * conversa pedida (q.thread). Sem q.thread, só a lista: o chat abre numa "Nova conversa".
 */
function history(db, user, contactId, q = {}) {
  const c = loadContact(db, user, contactId);
  const threads = db.prepare(`SELECT COALESCE(thread, 'anterior') AS thread, MIN(created_at) AS started_at, MAX(created_at) AS last_at, COUNT(*) AS n,
      (SELECT content FROM ai_messages m2 WHERE m2.contact_id = m.contact_id AND m2.user_id = m.user_id AND COALESCE(m2.thread, 'anterior') = COALESCE(m.thread, 'anterior') AND m2.role = 'user' ORDER BY m2.id LIMIT 1) AS first
    FROM ai_messages m WHERE contact_id = ? AND user_id = ? GROUP BY COALESCE(thread, 'anterior') ORDER BY last_at DESC LIMIT 30`).all(c.id, user.id);
  const t = q.thread ? String(q.thread) : null;
  const messages = t ? db.prepare("SELECT id, role, content, engine, rating, thread, created_at FROM ai_messages WHERE contact_id = ? AND user_id = ? AND COALESCE(thread, 'anterior') = ? ORDER BY id LIMIT 200").all(c.id, user.id, t) : [];
  return { threads, messages };
}

/** 👍/👎 numa resposta (e, se a sugestão veio da base de conhecimento, no item da base). */
function rate(db, user, data = {}) {
  const r = Number(data.rating) > 0 ? 1 : -1;
  if (data.message_id) {
    const m = db.prepare('SELECT * FROM ai_messages WHERE id = ? AND user_id = ?').get(Number(data.message_id), user.id);
    if (!m) throw notFound('Resposta não encontrada.');
    db.prepare('UPDATE ai_messages SET rating = ? WHERE id = ?').run(r, m.id);
  }
  if (data.kb_id) db.prepare(`UPDATE ai_knowledge SET ${r > 0 ? 'likes = likes + 1' : 'dislikes = dislikes + 1'} WHERE id = ?`).run(Number(data.kb_id));
  return { ok: true };
}

/* ------------------------- Base de conhecimento ------------------------- */

const KINDS = { objecao: 'Objeção', pergunta: 'Pergunta', dica: 'Dica de condução', mensagem: 'Mensagem pronta' };
function listKnowledge(db) {
  return { rows: db.prepare('SELECT k.*, u.name AS created_by_name FROM ai_knowledge k LEFT JOIN users u ON u.id = k.created_by ORDER BY k.active DESC, k.kind, k.likes - k.dislikes DESC, k.id DESC').all(), kinds: KINDS, builtin: { objections: OBJECTIONS.map((o) => ({ title: o.title, response: o.response, tip: o.tip })), spin: SPIN } };
}
function saveKnowledge(db, user, data = {}) {
  if (!['admin', 'gestor'].includes(user.role)) throw forbidden('A base de conhecimento é alimentada pela liderança.');
  const now = nowIso();
  if (data.id) {
    const k = db.prepare('SELECT * FROM ai_knowledge WHERE id = ?').get(Number(data.id));
    if (!k) throw notFound('Item não encontrado.');
    db.prepare('UPDATE ai_knowledge SET title = COALESCE(?, title), content = COALESCE(?, content), stage_key = ?, active = ?, updated_at = ? WHERE id = ?')
      .run(clean(data.title), clean(data.content), clean(data.stage_key), data.active === false || data.active === 0 ? 0 : 1, now, k.id);
    return { id: k.id };
  }
  if (!KINDS[data.kind]) throw badRequest('Tipo inválido.');
  const title = clean(data.title);
  const content = clean(data.content);
  if (!title || !content) throw badRequest('Informe o título e o conteúdo.');
  const id = Number(db.prepare('INSERT INTO ai_knowledge (kind, title, content, stage_key, area, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(data.kind, title, content, clean(data.stage_key), clean(data.area), user.id, now, now).lastInsertRowid);
  audit(db, user, 'ai_knowledge', id, 'criado', { tipo: KINDS[data.kind], titulo: title });
  return { id };
}

/* ------------------------- Configuração ------------------------- */

function status(db, user) {
  const cfg = llmConfig(db);
  return { enabled: cfg.enabled, sdk_installed: cfg.sdk, has_key: !!cfg.key, from_env: !!process.env.ANTHROPIC_API_KEY, model: cfg.model, generative: cfg.enabled && !!cfg.key && cfg.sdk, suggestions: SUGGESTIONS, quick: QUICK, can_configure: user.role === 'admin' };
}
function saveConfig(db, user, data = {}) {
  if (user.role !== 'admin') throw forbidden('Apenas o administrador configura a IA.');
  if (data.api_key) setSetting(db, 'ai_api_key_enc', sealSecret(String(data.api_key).trim()));
  if (data.enabled !== undefined) setSetting(db, 'ai_llm_enabled', data.enabled === true || data.enabled === 'true' || data.enabled === 'on');
  audit(db, user, 'settings', null, 'ia_configurada', { ligada: getSetting(db, 'ai_llm_enabled') });
  return status(db, user);
}

module.exports = { insights, chat, history, rate, listKnowledge, saveKnowledge, status, saveConfig, setClientFactory, internalAnswer, OBJECTIONS };
