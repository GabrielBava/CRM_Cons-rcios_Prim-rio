'use strict';
/**
 * Painel e relatórios. Cada indicador traz sua definição (numerador, denominador e período)
 * para que nenhuma taxa seja exibida sem critério explícito.
 */
const { CALL_ATTEMPT_TYPES, ATTEMPT_TYPES } = require('../constants');
const { contactScope, visibleOwnerIds } = require('../core');
const { toIso, badRequest } = require('../util');
const { getSetting } = require('../db');

function period(q) {
  const to = q.to ? toIso(q.to) : new Date().toISOString();
  const from = q.from ? toIso(q.from) : new Date(Date.parse(to) - 30 * 86400000).toISOString();
  return { from, to };
}

const IN = (arr) => arr.map(() => '?').join(',');

function effectiveResults(db) {
  return db
    .prepare("SELECT value, flags FROM options WHERE list = 'resultado_ligacao'")
    .all()
    .filter((r) => JSON.parse(r.flags || '{}').efetivo)
    .map((r) => r.value);
}

/** Monta filtros aplicados sobre contatos (c) e, opcionalmente, oportunidades (o) e atividades (a). */
function filters(db, user, q, subject) {
  const s = contactScope(db, user, 'c');
  const where = ['c.merged_into_id IS NULL', s.sql];
  const params = [...s.params];
  if (q.origin) {
    where.push('c.origin = ?');
    params.push(q.origin);
  }
  const oppCond = [];
  const oppParams = [];
  if (q.product_id) {
    oppCond.push('xo.product_id = ?');
    oppParams.push(Number(q.product_id));
  }
  if (q.stage_id) {
    oppCond.push('xo.stage_id = ?');
    oppParams.push(Number(q.stage_id));
  }
  if (q.status) {
    oppCond.push('xo.status = ?');
    oppParams.push(q.status);
  }
  if (subject === 'opp') {
    if (q.owner_id) {
      where.push('o.owner_id = ?');
      params.push(Number(q.owner_id));
    }
    if (oppCond.length) {
      where.push(oppCond.map((x) => x.replace('xo.', 'o.')).join(' AND '));
      params.push(...oppParams);
    }
  } else {
    if (q.owner_id) {
      const col = { contact: 'c.owner_id', activity: 'a.user_id', task: 't.assigned_to', sim: 's.user_id', proposal: 'pr.owner_id', contract: 'k.owner_id' }[subject];
      where.push(`${col} = ?`);
      params.push(Number(q.owner_id));
    }
    if (oppCond.length) {
      where.push(`EXISTS (SELECT 1 FROM opportunities xo WHERE xo.contact_id = c.id AND ${oppCond.join(' AND ')})`);
      params.push(...oppParams);
    }
  }
  return { where: where.join(' AND '), params };
}

const pct = (num, den) => (den ? Math.round((num / den) * 1000) / 10 : null);

/* ------------------------- Painel ------------------------- */

function dashboard(db, user, q) {
  const { from, to } = period(q);
  const eff = effectiveResults(db);
  const fc = filters(db, user, q, 'contact');
  const fa = filters(db, user, q, 'activity');
  const fo = filters(db, user, q, 'opp');
  const ft = filters(db, user, q, 'task');
  const fp = filters(db, user, q, 'proposal');
  const fs = filters(db, user, q, 'sim');

  const one = (sql, params) => db.prepare(sql).get(...params);

  const leadsNovos = one(`SELECT COUNT(*) AS n FROM contacts c WHERE ${fc.where} AND c.created_at BETWEEN ? AND ?`, [...fc.params, from, to]).n;
  const semTentativa = one(
    `SELECT COUNT(*) AS n FROM contacts c WHERE ${fc.where} AND c.relationship <> 'cliente' AND c.anonymized_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM activities x WHERE x.contact_id = c.id AND x.type IN (${IN(ATTEMPT_TYPES)}))`,
    [...fc.params, ...ATTEMPT_TYPES],
  ).n;
  const calls = one(
    `SELECT COUNT(*) AS tentativas, SUM(a.result IN (${IN(eff.length ? eff : ['-'])})) AS efetivos
     FROM activities a JOIN contacts c ON c.id = a.contact_id WHERE ${fa.where} AND a.type IN (${IN(CALL_ATTEMPT_TYPES)}) AND a.occurred_at BETWEEN ? AND ?`,
    [...(eff.length ? eff : ['-']), ...fa.params, ...CALL_ATTEMPT_TYPES, from, to],
  );
  const recebidas = one(
    `SELECT COUNT(*) AS n FROM activities a JOIN contacts c ON c.id = a.contact_id WHERE ${fa.where} AND a.type = 'ligacao_recebida' AND a.occurred_at BETWEEN ? AND ?`,
    [...fa.params, from, to],
  ).n;
  const reunioes = one(
    `SELECT SUM(t.created_at BETWEEN ? AND ?) AS agendadas, SUM(t.outcome = 'realizada' AND t.due_at BETWEEN ? AND ?) AS realizadas
     FROM tasks t JOIN contacts c ON c.id = t.contact_id WHERE ${ft.where} AND t.type = 'reuniao'`,
    [from, to, from, to, ...ft.params],
  );
  const simulacoes = one(`SELECT COUNT(*) AS n FROM simulations s JOIN contacts c ON c.id = s.contact_id WHERE ${fs.where} AND s.created_at BETWEEN ? AND ?`, [...fs.params, from, to]).n;
  const propostas = one(
    `SELECT COUNT(*) AS n FROM proposals pr JOIN contacts c ON c.id = pr.contact_id WHERE ${fp.where} AND pr.previous_id IS NULL AND pr.created_at BETWEEN ? AND ?`,
    [...fp.params, from, to],
  ).n;
  const vendas = one(
    `SELECT COUNT(*) AS n, COALESCE(SUM(o.credit_value), 0) AS credito FROM opportunities o JOIN contacts c ON c.id = o.contact_id
     WHERE ${fo.where} AND o.status = 'ganha' AND o.closed_at BETWEEN ? AND ?`,
    [...fo.params, from, to],
  );

  const stalledDays = Number(getSetting(db, 'stalled_days')) || 7;
  const limitDate = new Date(Date.now() - stalledDays * 86400000).toISOString();
  const parados = db
    .prepare(
      `SELECT s.id, s.name, s.position,
        (SELECT COUNT(*) FROM opportunities o JOIN contacts c ON c.id = o.contact_id WHERE o.stage_id = s.id AND o.status = 'aberta' AND ${fo.where}) AS total,
        (SELECT COUNT(*) FROM opportunities o JOIN contacts c ON c.id = o.contact_id WHERE o.stage_id = s.id AND o.status = 'aberta' AND ${fo.where}
          AND COALESCE(o.last_activity_at, o.stage_entered_at) < ?) AS parados
       FROM pipeline_stages s WHERE s.active = 1 AND s.kind = 'aberta' ORDER BY s.position`,
    )
    .all(...fo.params, ...fo.params, limitDate);

  const ids = visibleOwnerIds(db, user);
  const taskScope = contactScope(db, user, 'c');
  const proximas = db
    .prepare(
      `SELECT t.id, t.title, t.type, t.due_at, t.contact_id, c.name AS contact_name, c.code AS contact_code, u.name AS assigned_name, t.opportunity_id
       FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.status = 'pendente' AND (${ids === null ? '1=1' : `(t.contact_id IS NOT NULL AND ${taskScope.sql}) OR (t.contact_id IS NULL AND t.assigned_to IN (${IN(ids)}))`})
       ${q.owner_id ? 'AND t.assigned_to = ?' : ''}
       ORDER BY t.due_at LIMIT 12`,
    )
    .all(...(ids === null ? [] : [...taskScope.params, ...ids]), ...(q.owner_id ? [Number(q.owner_id)] : []));
  const atrasadas = db
    .prepare(
      `SELECT COUNT(*) AS n FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id WHERE t.status = 'pendente' AND t.due_at < ?
       AND (${ids === null ? '1=1' : `(t.contact_id IS NOT NULL AND ${taskScope.sql}) OR (t.contact_id IS NULL AND t.assigned_to IN (${IN(ids)}))`})
       ${q.owner_id ? 'AND t.assigned_to = ?' : ''}`,
    )
    .get(new Date().toISOString(), ...(ids === null ? [] : [...taskScope.params, ...ids]), ...(q.owner_id ? [Number(q.owner_id)] : [])).n;

  const conv = (groupExpr, labelJoin) =>
    db
      .prepare(
        `SELECT ${groupExpr} AS chave, ${labelJoin} AS rotulo, COUNT(*) AS oportunidades, SUM(o.status = 'ganha') AS ganhas, SUM(o.status = 'perdida') AS perdidas
         FROM opportunities o JOIN contacts c ON c.id = o.contact_id LEFT JOIN users u ON u.id = o.owner_id LEFT JOIN products p ON p.id = o.product_id
         LEFT JOIN options og ON og.list = 'origem' AND og.value = c.origin
         WHERE ${fo.where} AND o.created_at BETWEEN ? AND ? GROUP BY ${groupExpr} ORDER BY oportunidades DESC`,
      )
      .all(...fo.params, from, to)
      .map((r) => ({ ...r, taxa: pct(r.ganhas, r.oportunidades) }));

  return {
    period: { from, to },
    stalled_days: stalledDays,
    kpis: [
      { key: 'leads_novos', label: 'Leads novos', value: leadsNovos, def: 'Cadastros (prospects, leads ou clientes) criados no período. Filtro de responsável: responsável pelo cadastro.' },
      { key: 'sem_tentativa', label: 'Leads sem tentativa de contato', value: semTentativa, def: 'Situação atual (independe do período): cadastros que não são clientes e não possuem nenhuma ligação, mensagem ou e-mail enviado registrado.', link: '#/leads?no_attempt=1' },
      { key: 'tentativas', label: 'Tentativas de ligação', value: calls.tentativas || 0, def: 'Atividades "Ligação realizada" + "Tentativa sem atendimento" ocorridas no período (manuais e da discadora; eventos duplicados da discadora não são contados). Filtro de responsável: usuário da ligação.' },
      { key: 'efetivos', label: 'Contatos efetivos', value: calls.efetivos || 0, sub: calls.tentativas ? `${pct(calls.efetivos || 0, calls.tentativas)}% das tentativas` : null, def: 'Tentativas de ligação do período cujo resultado está marcado como "efetivo" (padrão: Atendida, Contato realizado, Retorno solicitado). Taxa = efetivos ÷ tentativas do mesmo período.' },
      { key: 'recebidas', label: 'Ligações recebidas', value: recebidas, def: 'Atividades "Ligação recebida" no período.' },
      { key: 'reunioes', label: 'Reuniões agendadas', value: reunioes.agendadas || 0, sub: `${reunioes.realizadas || 0} realizadas`, def: 'Agendadas = reuniões/diagnósticos criados (agendados) no período, para qualquer data. Realizadas = reuniões com data dentro do período concluídas com resultado "Realizada".' },
      { key: 'simulacoes', label: 'Simulações registradas', value: simulacoes, def: 'Simulações criadas no período (manuais ou vindas do simulador). Novas versões da mesma simulação não contam.' },
      { key: 'propostas', label: 'Propostas geradas', value: propostas, def: 'Propostas criadas no período, contando apenas a primeira versão (novas versões não inflam o número).' },
      { key: 'vendas', label: 'Vendas concluídas', value: vendas.n, sub: vendas.credito ? `Crédito: ${vendas.credito.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : null, def: 'Oportunidades movidas para a etapa de venda concluída com data de fechamento no período. Crédito = soma do crédito desejado dessas oportunidades.' },
    ],
    stalled_by_stage: parados,
    stalled_def: `Oportunidades abertas sem atividade registrada há ${stalledDays} dias ou mais (considera a última atividade ou, se não houver, a entrada na etapa). Ajuste o prazo em Configurações.`,
    upcoming_tasks: proximas,
    overdue_tasks: atrasadas,
    conversion: {
      def: 'Coorte: oportunidades criadas no período. Taxa = oportunidades ganhas ÷ oportunidades criadas no período (situação atual dessas oportunidades).',
      by_origin: conv('c.origin', 'COALESCE(og.label, c.origin)'),
      by_user: conv('o.owner_id', 'u.name'),
      by_product: conv('o.product_id', 'p.name'),
    },
  };
}

/* ------------------------- Relatórios ------------------------- */

const REPORTS = {
  leads_por_origem: 'Leads por origem',
  leads_por_campanha: 'Leads por campanha',
  ligacoes: 'Ligações e tentativas por período',
  taxa_contato: 'Taxa de contato',
  reunioes: 'Reuniões marcadas e realizadas',
  simulacoes_propostas: 'Simulações e propostas geradas',
  conversao_etapas: 'Conversão entre etapas',
  vendas: 'Vendas concluídas',
  motivos_perda: 'Motivos de perda',
  tempo_etapa: 'Tempo médio em cada etapa',
  pendencias: 'Atividades pendentes e leads sem retorno',
  resultado_usuario: 'Resultado por usuário',
};

function report(db, user, key, q) {
  if (!REPORTS[key]) throw badRequest('Relatório inválido.');
  const { from, to } = period(q);
  const eff = effectiveResults(db);
  const effIn = eff.length ? eff : ['-'];
  const base = { key, title: REPORTS[key], period: { from, to } };
  const fc = filters(db, user, q, 'contact');
  const fa = filters(db, user, q, 'activity');
  const fo = filters(db, user, q, 'opp');
  const ft = filters(db, user, q, 'task');

  switch (key) {
    case 'leads_por_origem': {
      const rows = db
        .prepare(
          `SELECT COALESCE(og.label, c.origin, 'Sem origem') AS origem, COUNT(*) AS leads,
            SUM(EXISTS (SELECT 1 FROM activities x WHERE x.contact_id = c.id AND x.type IN (${IN(ATTEMPT_TYPES)}))) AS com_tentativa,
            SUM(EXISTS (SELECT 1 FROM opportunities x WHERE x.contact_id = c.id AND x.status = 'ganha')) AS com_venda
           FROM contacts c LEFT JOIN options og ON og.list = 'origem' AND og.value = c.origin
           WHERE ${fc.where} AND c.created_at BETWEEN ? AND ? GROUP BY c.origin ORDER BY leads DESC`,
        )
        .all(...ATTEMPT_TYPES, ...fc.params, from, to)
        .map((r) => ({ ...r, conversao: pct(r.com_venda, r.leads) }));
      return {
        ...base,
        definition: ['Leads = cadastros criados no período, agrupados pela origem principal do cadastro.', 'Com tentativa = cadastros do grupo com ao menos uma ligação/mensagem/e-mail enviado (a qualquer tempo).', 'Conversão (%) = cadastros com venda concluída ÷ leads do grupo.'],
        columns: [col('origem', 'Origem'), col('leads', 'Leads', 'int'), col('com_tentativa', 'Com tentativa', 'int'), col('com_venda', 'Com venda', 'int'), col('conversao', 'Conversão', 'pct')],
        rows,
      };
    }
    case 'leads_por_campanha': {
      const rows = db
        .prepare(
          `SELECT COALESCE(co.campaign_name, co.campaign_id, co.utm_campaign, 'Sem campanha') AS campanha, co.platform AS plataforma,
            COUNT(*) AS entradas, COUNT(DISTINCT co.contact_id) AS cadastros,
            COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM opportunities x WHERE x.contact_id = c.id AND x.status = 'ganha') THEN c.id END) AS com_venda
           FROM contact_origins co JOIN contacts c ON c.id = co.contact_id
           WHERE ${fc.where} AND COALESCE(co.received_at, co.created_at) BETWEEN ? AND ?
           GROUP BY campanha, co.platform ORDER BY entradas DESC`,
        )
        .all(...fc.params, from, to)
        .map((r) => ({ ...r, conversao: pct(r.com_venda, r.cadastros) }));
      return {
        ...base,
        definition: ['Entradas = registros de origem recebidos no período (um mesmo cadastro pode entrar mais de uma vez, sem duplicar o cadastro).', 'Cadastros = cadastros distintos da campanha.', 'Conversão (%) = cadastros com venda concluída ÷ cadastros distintos da campanha.'],
        columns: [col('campanha', 'Campanha'), col('plataforma', 'Plataforma'), col('entradas', 'Entradas', 'int'), col('cadastros', 'Cadastros', 'int'), col('com_venda', 'Com venda', 'int'), col('conversao', 'Conversão', 'pct')],
        rows,
      };
    }
    case 'ligacoes': {
      const rows = db
        .prepare(
          `SELECT date(a.occurred_at, 'localtime') AS dia, SUM(a.type IN (${IN(CALL_ATTEMPT_TYPES)})) AS tentativas,
            SUM(a.type IN (${IN(CALL_ATTEMPT_TYPES)}) AND a.result IN (${IN(effIn)})) AS efetivas,
            SUM(a.type = 'tentativa_sem_atendimento') AS sem_atendimento, SUM(a.type = 'ligacao_recebida') AS recebidas,
            SUM(a.source = 'discadora') AS via_discadora, SUM(a.source = 'manual') AS manuais,
            ROUND(AVG(CASE WHEN a.duration_seconds > 0 THEN a.duration_seconds END)) AS duracao_media_s
           FROM activities a JOIN contacts c ON c.id = a.contact_id
           WHERE ${fa.where} AND a.type IN ('ligacao_realizada','tentativa_sem_atendimento','ligacao_recebida') AND a.occurred_at BETWEEN ? AND ?
           GROUP BY dia ORDER BY dia`,
        )
        .all(...CALL_ATTEMPT_TYPES, ...CALL_ATTEMPT_TYPES, ...effIn, ...fa.params, from, to);
      const byResult = db
        .prepare(
          `SELECT COALESCE(ro.label, a.result, 'Sem resultado') AS resultado, COUNT(*) AS total FROM activities a JOIN contacts c ON c.id = a.contact_id
           LEFT JOIN options ro ON ro.list = 'resultado_ligacao' AND ro.value = a.result
           WHERE ${fa.where} AND a.type IN (${IN(CALL_ATTEMPT_TYPES)}) AND a.occurred_at BETWEEN ? AND ? GROUP BY a.result ORDER BY total DESC`,
        )
        .all(...fa.params, ...CALL_ATTEMPT_TYPES, from, to);
      return {
        ...base,
        definition: ['Tentativas = atividades "Ligação realizada" + "Tentativa sem atendimento" por dia (fuso local).', 'Efetivas = tentativas com resultado marcado como efetivo.', 'Eventos repetidos da discadora (mesmo ID de chamada) são registrados uma única vez.', 'Duração média considera apenas ligações com duração informada maior que zero.'],
        columns: [col('dia', 'Dia', 'date'), col('tentativas', 'Tentativas', 'int'), col('efetivas', 'Efetivas', 'int'), col('sem_atendimento', 'Sem atendimento', 'int'), col('recebidas', 'Recebidas', 'int'), col('via_discadora', 'Via discadora', 'int'), col('manuais', 'Manuais', 'int'), col('duracao_media_s', 'Duração média', 'duration')],
        rows,
        extra: { title: 'Tentativas por resultado', columns: [col('resultado', 'Resultado'), col('total', 'Total', 'int')], rows: byResult },
      };
    }
    case 'taxa_contato': {
      const rows = db
        .prepare(
          `SELECT COALESCE(u.name, 'Sem usuário (discadora não mapeada)') AS usuario, COUNT(*) AS tentativas,
            SUM(a.result IN (${IN(effIn)})) AS efetivas,
            COUNT(DISTINCT a.contact_id) AS leads_tentados,
            COUNT(DISTINCT CASE WHEN a.result IN (${IN(effIn)}) THEN a.contact_id END) AS leads_contatados
           FROM activities a JOIN contacts c ON c.id = a.contact_id LEFT JOIN users u ON u.id = a.user_id
           WHERE ${fa.where} AND a.type IN (${IN(CALL_ATTEMPT_TYPES)}) AND a.occurred_at BETWEEN ? AND ?
           GROUP BY a.user_id ORDER BY tentativas DESC`,
        )
        .all(...effIn, ...effIn, ...fa.params, ...CALL_ATTEMPT_TYPES, from, to)
        .map((r) => ({ ...r, taxa_tentativas: pct(r.efetivas, r.tentativas), taxa_leads: pct(r.leads_contatados, r.leads_tentados) }));
      const tot = rows.reduce((a, r) => ({ tentativas: a.tentativas + r.tentativas, efetivas: a.efetivas + r.efetivas }), { tentativas: 0, efetivas: 0 });
      return {
        ...base,
        definition: [
          'Taxa por tentativa (%) = tentativas com resultado efetivo ÷ total de tentativas de ligação, no período.',
          'Taxa por lead (%) = leads com ao menos uma tentativa efetiva ÷ leads com ao menos uma tentativa, no período.',
          `Resultados considerados efetivos: ${eff.join(', ') || 'nenhum configurado'} (ajustável em Configurações > Listas).`,
        ],
        columns: [col('usuario', 'Usuário'), col('tentativas', 'Tentativas', 'int'), col('efetivas', 'Efetivas', 'int'), col('taxa_tentativas', 'Taxa por tentativa', 'pct'), col('leads_tentados', 'Leads tentados', 'int'), col('leads_contatados', 'Leads contatados', 'int'), col('taxa_leads', 'Taxa por lead', 'pct')],
        rows,
        totals: { usuario: 'Total', tentativas: tot.tentativas, efetivas: tot.efetivas, taxa_tentativas: pct(tot.efetivas, tot.tentativas) },
      };
    }
    case 'reunioes': {
      const rows = db
        .prepare(
          `SELECT COALESCE(u.name, '—') AS usuario, SUM(t.created_at BETWEEN $f AND $t) AS agendadas, SUM(t.due_at BETWEEN $f AND $t) AS marcadas_periodo,
            SUM(t.outcome = 'realizada' AND t.due_at BETWEEN $f AND $t) AS realizadas,
            SUM(t.outcome = 'nao_compareceu' AND t.due_at BETWEEN $f AND $t) AS nao_compareceu, SUM(t.outcome = 'remarcada' AND t.due_at BETWEEN $f AND $t) AS remarcadas,
            SUM((t.status = 'cancelada' OR t.outcome = 'cancelada') AND t.due_at BETWEEN $f AND $t) AS canceladas,
            SUM(t.status = 'pendente' AND t.due_at BETWEEN $f AND $t) AS pendentes
           FROM tasks t JOIN contacts c ON c.id = t.contact_id LEFT JOIN users u ON u.id = t.assigned_to
           WHERE ${ft.where} AND t.type = 'reuniao' AND (t.created_at BETWEEN $f AND $t OR t.due_at BETWEEN $f AND $t) GROUP BY t.assigned_to ORDER BY agendadas DESC`
            // from/to vêm de toIso() (sempre ISO 8601 gerado por Date), por isso podem ser embutidos com segurança
            .replace(/\$f/g, `'${from}'`).replace(/\$t/g, `'${to}'`),
        )
        .all(...ft.params)
        .map((r) => ({ ...r, comparecimento: pct(r.realizadas, (r.realizadas || 0) + (r.nao_compareceu || 0)) }));
      return {
        ...base,
        definition: ['Agendadas = tarefas "Reunião / diagnóstico" criadas no período (para qualquer data).', 'Com data no período = reuniões marcadas para acontecer dentro do período; as colunas seguintes detalham o resultado dessas reuniões.', 'Comparecimento (%) = realizadas ÷ (realizadas + cliente não compareceu).'],
        columns: [col('usuario', 'Responsável'), col('agendadas', 'Agendadas no período', 'int'), col('marcadas_periodo', 'Com data no período', 'int'), col('realizadas', 'Realizadas', 'int'), col('nao_compareceu', 'Não compareceu', 'int'), col('remarcadas', 'Remarcadas', 'int'), col('canceladas', 'Canceladas', 'int'), col('pendentes', 'Pendentes', 'int'), col('comparecimento', 'Comparecimento', 'pct')],
        rows,
      };
    }
    case 'simulacoes_propostas': {
      const fs = filters(db, user, q, 'sim');
      const fp = filters(db, user, q, 'proposal');
      const sims = db
        .prepare(`SELECT strftime('%Y-%m', s.created_at, 'localtime') AS mes, COUNT(*) AS simulacoes, SUM(s.source = 'simulador') AS via_simulador, SUM(s.source = 'manual') AS manuais
          FROM simulations s JOIN contacts c ON c.id = s.contact_id WHERE ${fs.where} AND s.created_at BETWEEN ? AND ? GROUP BY mes`)
        .all(...fs.params, from, to);
      const props = db
        .prepare(`SELECT strftime('%Y-%m', pr.created_at, 'localtime') AS mes, SUM(pr.previous_id IS NULL) AS propostas, SUM(pr.previous_id IS NOT NULL) AS novas_versoes,
            SUM(pr.presented_at IS NOT NULL) AS apresentadas, SUM(pr.status = 'aprovada') AS aprovadas, SUM(pr.status = 'recusada') AS recusadas, SUM(pr.status = 'expirada') AS expiradas
          FROM proposals pr JOIN contacts c ON c.id = pr.contact_id WHERE ${fp.where} AND pr.created_at BETWEEN ? AND ? GROUP BY mes`)
        .all(...fp.params, from, to);
      const months = [...new Set([...sims.map((r) => r.mes), ...props.map((r) => r.mes)])].sort();
      const rows = months.map((m) => ({ mes: m, ...(sims.find((r) => r.mes === m) || { simulacoes: 0, via_simulador: 0, manuais: 0 }), ...(props.find((r) => r.mes === m) || {}) }));
      rows.forEach((r) => (r.mes = r.mes));
      return {
        ...base,
        definition: ['Simulações criadas no período (novas versões da mesma simulação não contam).', 'Propostas = primeiras versões criadas no período; Novas versões são contadas separadamente.', 'Apresentadas/Aprovadas/Recusadas/Expiradas = situação atual das propostas criadas no período.'],
        columns: [col('mes', 'Mês'), col('simulacoes', 'Simulações', 'int'), col('via_simulador', 'Via simulador', 'int'), col('manuais', 'Manuais', 'int'), col('propostas', 'Propostas', 'int'), col('novas_versoes', 'Novas versões', 'int'), col('apresentadas', 'Apresentadas', 'int'), col('aprovadas', 'Aprovadas', 'int'), col('recusadas', 'Recusadas', 'int'), col('expiradas', 'Expiradas', 'int')],
        rows,
      };
    }
    case 'conversao_etapas': {
      const stages = db.prepare("SELECT id, name, position, kind FROM pipeline_stages WHERE active = 1 AND kind IN ('aberta','ganho') ORDER BY position").all();
      const opps = db
        .prepare(
          `SELECT o.id, MAX(s.position) AS maxpos FROM opportunities o JOIN contacts c ON c.id = o.contact_id
           JOIN stage_history h ON h.opportunity_id = o.id JOIN pipeline_stages s ON s.id = h.to_stage_id AND s.kind IN ('aberta','ganho')
           WHERE ${fo.where} AND o.created_at BETWEEN ? AND ? GROUP BY o.id`,
        )
        .all(...fo.params, from, to);
      const rows = stages.map((s, i) => {
        const reached = opps.filter((o) => o.maxpos >= s.position).length;
        const next = stages[i + 1];
        const reachedNext = next ? opps.filter((o) => o.maxpos >= next.position).length : null;
        return { etapa: s.name, atingiram: reached, seguiram: reachedNext, conversao: next ? pct(reachedNext, reached) : null, acumulada: pct(reached, opps.length) };
      });
      return {
        ...base,
        definition: [
          'Coorte: oportunidades criadas no período.',
          'Atingiram = oportunidades que chegaram à etapa ou a qualquer etapa posterior (pelo histórico de movimentações), inclusive se pularam etapas.',
          'Conversão para a próxima (%) = atingiram a próxima etapa ÷ atingiram esta etapa.',
          'Acumulada (%) = atingiram a etapa ÷ total de oportunidades da coorte. Perdido e Nutrição não entram na sequência.',
        ],
        columns: [col('etapa', 'Etapa'), col('atingiram', 'Atingiram', 'int'), col('seguiram', 'Seguiram p/ próxima', 'int'), col('conversao', 'Conversão p/ próxima', 'pct'), col('acumulada', 'Acumulada', 'pct')],
        rows,
        totals: { etapa: `Total na coorte: ${opps.length}` },
      };
    }
    case 'vendas': {
      const rows = db
        .prepare(
          `SELECT o.code AS oportunidade, c.code AS cadastro, c.name AS cliente, p.name AS produto, u.name AS responsavel, COALESCE(og.label, c.origin) AS origem,
            o.credit_value AS credito, o.closed_at AS data_venda,
            (SELECT COUNT(*) FROM contracts k WHERE k.opportunity_id = o.id) AS contratos
           FROM opportunities o JOIN contacts c ON c.id = o.contact_id LEFT JOIN products p ON p.id = o.product_id LEFT JOIN users u ON u.id = o.owner_id
           LEFT JOIN options og ON og.list = 'origem' AND og.value = c.origin
           WHERE ${fo.where} AND o.status = 'ganha' AND o.closed_at BETWEEN ? AND ? ORDER BY o.closed_at DESC`,
        )
        .all(...fo.params, from, to);
      return {
        ...base,
        definition: ['Oportunidades com status "ganha" cuja data de fechamento está no período.', 'Crédito = crédito desejado registrado na oportunidade (o valor contratado fica no registro de produto contratado).'],
        columns: [col('data_venda', 'Data', 'date'), col('oportunidade', 'Oportunidade'), col('cadastro', 'Cadastro'), col('cliente', 'Cliente'), col('produto', 'Produto'), col('responsavel', 'Responsável'), col('origem', 'Origem'), col('credito', 'Crédito', 'money'), col('contratos', 'Contratos', 'int')],
        rows,
        totals: { data_venda: `${rows.length} vendas`, credito: rows.reduce((a, r) => a + (r.credito || 0), 0) },
      };
    }
    case 'motivos_perda': {
      const rows = db
        .prepare(
          `SELECT COALESCE(ml.label, o.lost_reason, 'Não informado') AS motivo, COUNT(*) AS perdidas, COALESCE(SUM(o.credit_value), 0) AS credito
           FROM opportunities o JOIN contacts c ON c.id = o.contact_id LEFT JOIN options ml ON ml.list = 'motivo_perda' AND ml.value = o.lost_reason
           WHERE ${fo.where} AND o.status = 'perdida' AND o.closed_at BETWEEN ? AND ? GROUP BY o.lost_reason ORDER BY perdidas DESC`,
        )
        .all(...fo.params, from, to);
      const total = rows.reduce((a, r) => a + r.perdidas, 0);
      rows.forEach((r) => (r.participacao = pct(r.perdidas, total)));
      return {
        ...base,
        definition: ['Oportunidades com status "perdida" e data de perda no período, agrupadas pelo motivo obrigatório informado.', 'Participação (%) = perdas do motivo ÷ total de perdas no período.'],
        columns: [col('motivo', 'Motivo'), col('perdidas', 'Perdidas', 'int'), col('participacao', 'Participação', 'pct'), col('credito', 'Crédito perdido', 'money')],
        rows,
      };
    }
    case 'tempo_etapa': {
      const rows = db
        .prepare(
          `SELECT s.name AS etapa, s.position, COUNT(h.id) AS saidas, ROUND(AVG(h.seconds_in_previous) / 86400.0, 1) AS media_dias,
            (SELECT COUNT(*) FROM opportunities o2 JOIN contacts c ON c.id = o2.contact_id WHERE o2.stage_id = s.id AND o2.status IN ('aberta','pausada') AND ${fc.where}) AS atuais,
            (SELECT ROUND(AVG((julianday('now') - julianday(o2.stage_entered_at))), 1) FROM opportunities o2 JOIN contacts c ON c.id = o2.contact_id WHERE o2.stage_id = s.id AND o2.status IN ('aberta','pausada') AND ${fc.where}) AS idade_atual_dias
           FROM pipeline_stages s
           LEFT JOIN stage_history h ON h.from_stage_id = s.id AND h.moved_at BETWEEN ? AND ?
             AND h.opportunity_id IN (SELECT o.id FROM opportunities o JOIN contacts c ON c.id = o.contact_id WHERE ${fo.where})
           WHERE s.active = 1 GROUP BY s.id ORDER BY s.position`,
        )
        .all(...fc.params, ...fc.params, from, to, ...fo.params);
      return {
        ...base,
        definition: ['Tempo médio (dias) = média do tempo que as oportunidades permaneceram na etapa, considerando as saídas da etapa ocorridas no período.', 'Atuais / Idade atual = oportunidades que estão hoje na etapa e há quantos dias, em média, estão nela.'],
        columns: [col('etapa', 'Etapa'), col('saidas', 'Saídas no período', 'int'), col('media_dias', 'Tempo médio (dias)', 'num'), col('atuais', 'Na etapa agora', 'int'), col('idade_atual_dias', 'Idade atual média (dias)', 'num')],
        rows,
      };
    }
    case 'pendencias': {
      const stalledDays = Number(getSetting(db, 'stalled_days')) || 7;
      const limit = new Date(Date.now() - stalledDays * 86400000).toISOString();
      const now = new Date().toISOString();
      const rows = db
        .prepare(
          `SELECT o.code AS oportunidade, c.code AS cadastro, c.name AS nome, s.name AS etapa, u.name AS responsavel,
            COALESCE(o.last_activity_at, o.stage_entered_at) AS ultima_atividade, o.next_action AS proxima_acao, o.next_action_at AS data_proxima_acao,
            (SELECT COUNT(*) FROM tasks t WHERE t.opportunity_id = o.id AND t.status = 'pendente' AND t.due_at < ?) AS tarefas_atrasadas,
            CASE WHEN o.next_action IS NULL THEN 'Sem próxima ação' WHEN o.next_action_at < ? THEN 'Próxima ação vencida' ELSE 'Sem atividade recente' END AS situacao
           FROM opportunities o JOIN contacts c ON c.id = o.contact_id JOIN pipeline_stages s ON s.id = o.stage_id LEFT JOIN users u ON u.id = o.owner_id
           WHERE ${fo.where} AND o.status = 'aberta' AND (COALESCE(o.last_activity_at, o.stage_entered_at) < ? OR o.next_action IS NULL OR o.next_action_at < ?)
           ORDER BY ultima_atividade`,
        )
        .all(now, now, ...fo.params, limit, now);
      const overdue = db
        .prepare(
          `SELECT COALESCE(u.name, '—') AS responsavel, COUNT(*) AS atrasadas FROM tasks t JOIN contacts c ON c.id = t.contact_id LEFT JOIN users u ON u.id = t.assigned_to
           WHERE ${ft.where} AND t.status = 'pendente' AND t.due_at < ? GROUP BY t.assigned_to ORDER BY atrasadas DESC`,
        )
        .all(...ft.params, now);
      return {
        ...base,
        definition: [
          'Situação atual (não depende do período).',
          `Lista oportunidades abertas sem próxima ação, com próxima ação vencida ou sem atividade há ${stalledDays} dias ou mais.`,
          'Dados pessoais exibidos limitados ao nome e código do cadastro.',
        ],
        columns: [col('oportunidade', 'Oportunidade'), col('cadastro', 'Cadastro'), col('nome', 'Nome'), col('etapa', 'Etapa'), col('responsavel', 'Responsável'), col('situacao', 'Situação'), col('ultima_atividade', 'Última atividade', 'datetime'), col('proxima_acao', 'Próxima ação'), col('data_proxima_acao', 'Data', 'datetime'), col('tarefas_atrasadas', 'Tarefas atrasadas', 'int')],
        rows,
        extra: { title: 'Tarefas atrasadas por responsável', columns: [col('responsavel', 'Responsável'), col('atrasadas', 'Atrasadas', 'int')], rows: overdue },
      };
    }
    case 'resultado_usuario': {
      const users = db.prepare('SELECT id, name FROM users WHERE active = 1 ORDER BY name').all();
      const ids = visibleOwnerIds(db, user);
      const list = users.filter((u) => (ids === null || ids.includes(u.id)) && (!q.owner_id || u.id === Number(q.owner_id)));
      const qq = { ...q, owner_id: undefined };
      const c1 = filters(db, user, qq, 'contact');
      const a1 = filters(db, user, qq, 'activity');
      const o1 = filters(db, user, qq, 'opp');
      const t1 = filters(db, user, qq, 'task');
      const s1 = filters(db, user, qq, 'sim');
      const p1 = filters(db, user, qq, 'proposal');
      const rows = list.map((u) => {
        const g = (sql, params) => db.prepare(sql).get(...params);
        const leads = g(`SELECT COUNT(*) AS n FROM contacts c WHERE ${c1.where} AND c.owner_id = ? AND c.created_at BETWEEN ? AND ?`, [...c1.params, u.id, from, to]).n;
        const calls = g(`SELECT COUNT(*) AS t, SUM(a.result IN (${IN(effIn)})) AS e FROM activities a JOIN contacts c ON c.id = a.contact_id WHERE ${a1.where} AND a.user_id = ? AND a.type IN (${IN(CALL_ATTEMPT_TYPES)}) AND a.occurred_at BETWEEN ? AND ?`, [...effIn, ...a1.params, u.id, ...CALL_ATTEMPT_TYPES, from, to]);
        const meet = g(`SELECT SUM(t.outcome = 'realizada') AS n FROM tasks t JOIN contacts c ON c.id = t.contact_id WHERE ${t1.where} AND t.assigned_to = ? AND t.type = 'reuniao' AND t.due_at BETWEEN ? AND ?`, [...t1.params, u.id, from, to]).n || 0;
        const sims = g(`SELECT COUNT(*) AS n FROM simulations s JOIN contacts c ON c.id = s.contact_id WHERE ${s1.where} AND s.user_id = ? AND s.created_at BETWEEN ? AND ?`, [...s1.params, u.id, from, to]).n;
        const props = g(`SELECT COUNT(*) AS n FROM proposals pr JOIN contacts c ON c.id = pr.contact_id WHERE ${p1.where} AND pr.owner_id = ? AND pr.previous_id IS NULL AND pr.created_at BETWEEN ? AND ?`, [...p1.params, u.id, from, to]).n;
        const won = g(`SELECT COUNT(*) AS n, COALESCE(SUM(o.credit_value),0) AS v FROM opportunities o JOIN contacts c ON c.id = o.contact_id WHERE ${o1.where} AND o.owner_id = ? AND o.status = 'ganha' AND o.closed_at BETWEEN ? AND ?`, [...o1.params, u.id, from, to]);
        const cohort = g(`SELECT COUNT(*) AS n, SUM(o.status = 'ganha') AS w FROM opportunities o JOIN contacts c ON c.id = o.contact_id WHERE ${o1.where} AND o.owner_id = ? AND o.created_at BETWEEN ? AND ?`, [...o1.params, u.id, from, to]);
        return {
          usuario: u.name, leads_novos: leads, tentativas: calls.t || 0, efetivas: calls.e || 0, taxa_contato: pct(calls.e || 0, calls.t || 0),
          reunioes_realizadas: meet, simulacoes: sims, propostas: props, vendas: won.n, credito_vendido: won.v, conversao_coorte: pct(cohort.w || 0, cohort.n),
        };
      });
      return {
        ...base,
        definition: [
          'Leads novos = cadastros criados no período sob responsabilidade do usuário.',
          'Tentativas/Efetivas = ligações registradas pelo usuário no período. Taxa de contato = efetivas ÷ tentativas.',
          'Reuniões realizadas = reuniões com data no período concluídas como "Realizada".',
          'Vendas = oportunidades do usuário ganhas no período. Conversão da coorte = ganhas ÷ oportunidades do usuário criadas no período.',
        ],
        columns: [col('usuario', 'Usuário'), col('leads_novos', 'Leads novos', 'int'), col('tentativas', 'Tentativas', 'int'), col('efetivas', 'Efetivas', 'int'), col('taxa_contato', 'Taxa de contato', 'pct'), col('reunioes_realizadas', 'Reuniões realizadas', 'int'), col('simulacoes', 'Simulações', 'int'), col('propostas', 'Propostas', 'int'), col('vendas', 'Vendas', 'int'), col('credito_vendido', 'Crédito vendido', 'money'), col('conversao_coorte', 'Conversão (coorte)', 'pct')],
        rows,
      };
    }
    default:
      throw badRequest('Relatório inválido.');
  }
}

function col(key, label, type = 'text') {
  return { key, label, type };
}

module.exports = { dashboard, report, REPORTS };
