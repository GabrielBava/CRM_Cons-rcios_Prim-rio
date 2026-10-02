'use strict';
/**
 * Dados FICTÍCIOS de demonstração: usuários e equipe com líder, administradoras e planos, leads em todas as etapas
 * do funil (respeitando as regras de passagem), propostas na esteira de follow-up, pré-vendas, vendas com comissões,
 * um cancelamento, metas, treinamentos e a roleta de distribuição. Usado por `npm run demo` e pela versão de teste.
 */
const { tx, getSetting, setSetting } = require('./db');
const { hashPassword, nowIso } = require('./util');
const contacts = require('./services/contacts');
const opps = require('./services/opportunities');
const activities = require('./services/activities');
const tasks = require('./services/tasks');
const sims = require('./services/simulations');
const proposals = require('./services/proposals');
const record = require('./services/record');
const finance = require('./services/finance');
const catalog = require('./services/catalog');
const sales = require('./services/sales');
const goals = require('./services/goals');
const trainings = require('./services/trainings');
const distribution = require('./services/distribution');

const DEMO_USERS = ['admin@demo.local', 'gestora@demo.local', 'consultor1@demo.local', 'consultor2@demo.local', 'leitura@demo.local'];

const DAY = 86400000;
const ago = (d, h = 10) => {
  const x = new Date(Date.now() - d * DAY);
  x.setUTCHours(h + 3, 0, 0, 0);
  return x.toISOString();
};
const dateAgo = (d) => new Date(Date.now() - 3 * 3600000 - d * DAY).toISOString().slice(0, 10);

/** Popula um banco vazio. Lança erro se já houver cadastros. */
function seedDemo(db, password) {
  if (db.prepare('SELECT COUNT(*) AS n FROM contacts').get().n > 0) {
    throw new Error('O banco já possui cadastros. Use um banco vazio.');
  }
  const now = nowIso();
  const team = Number(db.prepare('INSERT INTO teams (name, created_at) VALUES (?, ?)').run('Equipe Centro', now).lastInsertRowid);
  const mkUser = (name, email, role, teamId, agent, phone) => {
    const ex = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (ex) return db.prepare('SELECT * FROM users WHERE id = ?').get(ex.id);
    const id = Number(
      db.prepare('INSERT INTO users (name, email, password_hash, role, team_id, dialer_agent_ref, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(name, email, hashPassword(password), role, teamId, agent, phone, now, now).lastInsertRowid,
    );
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  };
  const admin = mkUser('Administrador Demo', 'admin@demo.local', 'admin', null, null, '(11) 90000-0001');
  const gestor = mkUser('Gestora Demo (líder)', 'gestora@demo.local', 'gestor', team, null, '(11) 90000-0002');
  const c1 = mkUser('Especialista Demo 1', 'consultor1@demo.local', 'consultor', team, 'ramal-201', '(11) 90000-0003');
  const c2 = mkUser('Especialista Demo 2', 'consultor2@demo.local', 'consultor', team, 'ramal-202', '(11) 90000-0004');
  mkUser('Leitura Demo', 'leitura@demo.local', 'leitura', team, null, null);
  db.prepare('UPDATE teams SET leader_id = ? WHERE id = ?').run(gestor.id, team);
  // Cargos e dados do "Meu cadastro"
  for (const [u, title, specs] of [[admin, 'Diretor comercial', '[]'], [gestor, 'Líder de equipe comercial', '["imovel","veiculo"]'], [c1, 'Especialista em consórcio imobiliário', '["imovel"]'], [c2, 'Especialista em consórcio de veículos', '["veiculo","servico"]']]) {
    db.prepare('UPDATE users SET job_title = ?, specialties = ?, whatsapp = phone WHERE id = ?').run(title, specs, u.id);
  }
  // A demonstração preenche dados cadastrais parciais; a conferência da pré-venda não exige a ficha completa aqui
  const checklistSetting = getSetting(db, 'require_sale_checklist');
  setSetting(db, 'require_sale_checklist', false);

  /* ---------- Administradoras e planos (fictícios) ---------- */
  const alfa = catalog.saveAdministrator(db, admin, {
    name: 'Administradora Alfa (fictícia)', website: 'alfa.exemplo.com.br', portal_url: 'portal.alfa.exemplo.com.br', portal_login: 'corretora.demo',
    commercial_name: 'Marcos (comercial)', commercial_phone: '(11) 4000-1000', commercial_email: 'comercial@alfa.exemplo.com.br',
    manager_name: 'Juliana (gerente de conta)', manager_phone: '(11) 4000-1001', manager_email: 'juliana@alfa.exemplo.com.br',
    payout_day: 20, payout_method: 'TED para a conta PJ mediante nota fiscal até o dia 15',
    payout_policy: 'Repasse mensal após a quitação da parcela do cliente. Cancelamentos em até 12 meses são estornados.',
    commission_schedule: [{ month_offset: 0, pct: 0.3, release_after_days: 7 }, { month_offset: 1, pct: 0.1 }, { month_offset: 2, pct: 0.1 }, { month_offset: 3, pct: 0.1 }],
    payout_schedule: [{ month_offset: 1, pct: 1.2 }, { month_offset: 2, pct: 0.6 }, { month_offset: 3, pct: 0.6 }],
    chargeback_policy: { estornar_pagas: true, ate_dias: 365 },
  });
  const beta = catalog.saveAdministrator(db, admin, {
    name: 'Administradora Beta (fictícia)', commercial_name: 'Paula (comercial)', commercial_phone: '(11) 4000-2000', payout_day: 10,
    payout_policy: 'Repasse em duas parcelas; sem estorno após 6 meses.',
    commission_schedule: [{ month_offset: 0, pct: 0.4, release_after_days: 7 }, { month_offset: 1, pct: 0.2 }],
    chargeback_policy: { estornar_pagas: true, ate_dias: 180 },
  });
  const [pImovel, pVeiculo, pServico] = db.prepare('SELECT id FROM products ORDER BY id').all().map((p) => p.id);
  catalog.savePlan(db, admin, { id: pImovel, name: 'HS Imóvel 200', plan_code: 'HS-IMV-200', administrator_id: alfa, category: 'imovel', admin_fee_pct: 18, reserve_fund_pct: 2, insurance_pct: 0.038, term_months: 200, term_options: '180, 200, 220', embedded_bid: true, embedded_bid_pct: 30, fixed_bid: true, fixed_bid_pct: 25, adhesion: true, adhesion_pct: 1, adhesion_months: 3, readjustment_index: 'incc', credit_min: 100000, credit_max: 500000, credit_step: 10000, description: 'Imóvel residencial ou comercial.' });
  catalog.savePlan(db, admin, { id: pVeiculo, name: 'Auto 80', plan_code: 'AUT-80', administrator_id: alfa, category: 'veiculo', admin_fee_pct: 14, reserve_fund_pct: 2, term_months: 80, embedded_bid: true, embedded_bid_pct: 25, adhesion: false, readjustment_index: 'ipca', credit_min: 40000, credit_max: 150000, credit_step: 5000 });
  catalog.savePlan(db, admin, { id: pServico, name: 'Serviços 40', administrator_id: beta, category: 'servico', admin_fee_pct: 20, reserve_fund_pct: 3, term_months: 40, readjustment_index: 'pre6', credit_min: 15000, credit_max: 30000 });
  const pBeta = catalog.savePlan(db, admin, { name: 'Imóvel Beta 180', administrator_id: beta, category: 'imovel', admin_fee_pct: 17, reserve_fund_pct: 1.5, term_months: 180, fixed_bid: true, fixed_bid_pct: 30, readjustment_index: 'ipca', credit_min: 150000, credit_max: 400000, credit_step: 50000,
    commission_schedule: [{ month_offset: 0, pct: 0.5, release_after_days: 7 }, { month_offset: 2, pct: 0.3 }] });
  const plans = [pImovel, pVeiculo, pImovel, pBeta];

  /* ---------- Treinamentos ---------- */
  const tr1 = trainings.saveTraining(db, admin, {
    title: 'Como funciona o consórcio', category: 'fundamentos', kind: 'texto', duration_min: 15, required_roles: ['consultor', 'gestor'], due_days: 30, pass_score: 70,
    description: 'Grupo, cota, assembleia, contemplação por sorteio e por lance, taxa de administração e fundo de reserva.',
    content: 'O consórcio reúne pessoas em um grupo que paga parcelas mensais para formar um fundo comum.\nTodo mês, na assembleia, cotas são contempladas por sorteio e por lance.\nA taxa de administração remunera a administradora; o fundo de reserva protege o grupo contra inadimplência.\nNão há juros: o crédito é corrigido por um índice (INCC, IPCA ou pré-fixado).',
    quiz: [
      { question: 'Como as cotas são contempladas?', options: ['Somente por sorteio', 'Por sorteio e por lance', 'Por ordem de entrada'], correct: 1 },
      { question: 'O consórcio cobra juros?', options: ['Sim, como um financiamento', 'Não; há taxa de administração e correção do crédito'], correct: 1 },
    ],
  });
  trainings.saveTraining(db, admin, {
    title: 'Lance livre, fixo e embutido', category: 'lances', kind: 'video', video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', duration_min: 12, required_roles: ['consultor'], due_days: 15, pass_score: 100,
    description: 'Quando usar cada tipo de lance e como explicar ao cliente sem prometer contemplação.',
    quiz: [{ question: 'O lance embutido usa…', options: ['Recursos próprios do cliente', 'Parte do próprio crédito da cota'], correct: 1 }],
  });
  trainings.saveTraining(db, admin, { title: 'Uso do FGTS no consórcio de imóvel', category: 'fgts', kind: 'texto', duration_min: 10, content: 'O FGTS pode ser usado para lance, complemento da carta ou amortização, respeitando as regras do SFH: imóvel residencial urbano, sem outro financiamento ativo no SFH e 3 anos de trabalho sob o regime do FGTS.' });
  trainings.saveTraining(db, admin, { title: 'Consórcio x financiamento: cálculos', category: 'calculos', kind: 'texto', duration_min: 20, content: 'Compare o custo total: no consórcio, taxa de administração + fundo de reserva + correção; no financiamento, juros compostos + seguros + CET. Monte a tabela para o cliente com os dois cenários.' });
  trainings.complete(db, c1, tr1, { answers: [1, 1] });

  /* ---------- Leads e funil ---------- */
  const names = [
    'Ana Paula Ribeiro', 'Bruno Carvalho', 'Carla Mendes', 'Diego Almeida', 'Eduarda Lima', 'Felipe Rocha', 'Gabriela Nunes', 'Henrique Dias',
    'Isabela Martins', 'João Pedro Costa', 'Karina Lopes', 'Lucas Ferreira', 'Mariana Teixeira', 'Nicolas Barbosa', 'Olívia Cardoso', 'Paulo Henrique Souza',
    'Rafaela Gomes', 'Sérgio Pereira', 'Tatiane Araújo', 'Vinícius Moreira',
  ];
  const origins = ['indicacao', 'meta_ads', 'instagram', 'whatsapp', 'ligacao_ativa', 'site', 'evento', 'parceiro'];
  const stageId = Object.fromEntries(db.prepare('SELECT key, id FROM pipeline_stages WHERE key IS NOT NULL').all().map((s) => [s.key, s.id]));
  const ORDER = ['lead', 'tentativa', 'qualificado', 'r1', 'negociacao', 'follow_up'];
  // Etapa alvo de cada cadastro (índice % 10): 0 prospect, 1 lead, 2 tentativa, 3 qualificado, 4 R1, 5 negociação, 6 follow-up, 7 aceite/pré-venda, 8 pré-venda com link, 9 venda
  const TARGET = ['prospect', 'lead', 'tentativa', 'qualificado', 'r1', 'negociacao', 'follow_up', 'aceite', 'prevenda', 'venda'];
  const rnd = (arr, i) => arr[i % arr.length];
  const ids = [];
  // Imagem fictícia usada como documento enviado pelo cliente
  const SAMPLE_DOC = 'iVBORw0KGgoAAAANSUhEUgAAAPAAAACWCAIAAABvmpKCAAABsUlEQVR42u3cMQ5AQBRF0VmMPVmxRKVUqZR6orQDiQhexknOCrjVz8uUpu2gGsUnQNAgaBA0CBpBg6BB0CBoEDSCBkGDoEHQIGgEDYIGQYOgQdAIGgQNggZBg6ARNAgaPgl63XaohqARNAgaBA2CRtAgaBA0CBoEjaBB0CBoEDQIGkGf6YcRXiNoBC1oBA2ChrCgwdmOUNO8BBI0ghY0gkbQgkbQgkbQgkbQgha0oBG0oBF0YtDWBTXJDNo4CUELGkELWtCCRtDBQePK4WyHoAWNoAWNoP1XQQsaQQsaQQsaQQsaQSNoQSNoe2hsOQSNoAWNoAUtaEEjaFcOXDkEjaAFjaARtKARtKARtKARtKARNIIWNIIWNIK25cDbdoJG0IIWtKARtKARtPehceUQNIJG0IJG0IJG0IJG0IIWtKARtKARtKARtKARtC2HLYdxEoIWNFwiaAQtaH4bNCQTNIIGQYOgQdAIGgQNggZBg6ARtC0H96YUgkbQgkbQgkbQgha0KwcIGgQNgkbQIGgQNAgaBI2gQdBgywEea0TQgkbQvjKCBu9Dg6ARNAgaBA3POgC0qxx3509tawAAAABJRU5ErkJggg==';
  const PDF = Buffer.from('%PDF-1.4 comprovante de pagamento ficticio').toString('base64');

  /** Avança o negócio etapa por etapa, cumprindo os critérios de entrada de cada uma (como o especialista faria). */
  function advance(owner, contactId, opp, key, i) {
    const upto = ORDER.indexOf(key);
    let r1Task = null;
    for (let k = 1; k <= upto; k++) {
      const st = ORDER[k];
      const when = ago(12 - k * 2 + (i % 2), 9 + k);
      if (st === 'tentativa') activities.createActivity(db, owner, { contact_id: contactId, opportunity_id: opp.id, type: 'tentativa_sem_atendimento', result: 'nao_atendida', occurred_at: when });
      if (st === 'qualificado') {
        activities.createActivity(db, owner, { contact_id: contactId, opportunity_id: opp.id, type: 'ligacao_realizada', result: 'atendida', duration: 240 + i * 11, notes: 'Conversa sobre objetivo, prazo e parcela possível.', occurred_at: when });
        opps.updateOpportunity(db, owner, opp.id, {
          objective_type: i % 3 ? 'aquisicao' : 'investimento', urgency: rnd(['curto', 'medio', 'longo'], i), installment_max: 1500 + i * 50, term_months: 200,
          strategy: rnd(['aquisicao', 'planejamento', 'formacao_patrimonial'], i), product_type: 'primario', employment_type: rnd(['clt', 'pj', 'empresario'], i), has_fgts: i % 2 ? 'sim' : 'nao',
          credit_purpose_type: rnd(['moradia', 'imovel_investimento', 'terreno_construcao'], i), installment_min: 1200 + i * 40, has_bid_resources: rnd(['sim', 'nao', 'nao_sabe'], i), credit_category: 'imovel',
        });
      }
      if (st === 'r1') {
        const future = upto === k;
        r1Task = tasks.createTask(db, owner, { contact_id: contactId, opportunity_id: opp.id, type: 'reuniao', title: 'R1 — diagnóstico financeiro', due_at: future ? new Date(Date.now() + ((i % 3) + 1) * DAY / 2).toISOString() : when });
      }
      if (st === 'negociacao') {
        tasks.updateTask(db, owner, r1Task, { action: 'concluir', outcome: 'realizada', notes: 'Cliente quer imóvel para morar em até 3 anos; tem FGTS.' });
        opps.updateOpportunity(db, owner, opp.id, { decision_maker: rnd(['sozinho', 'conjuge'], i), financial_moment: rnd(['organizado_reserva', 'organizado_sem_reserva', 'apertado'], i), had_consortium: i % 4 === 0 ? 'sim' : 'nao', existing_consortium_admin: i % 4 === 0 ? 'Administradora anterior' : null, existing_consortium_value: i % 4 === 0 ? 120000 : null, has_financing: 'nao', decision_notes: i % 2 ? 'Decide com a esposa.' : null });
      }
      let proposal = null;
      if (st === 'follow_up') {
        const s = sims.createManual(db, owner, { contact_id: contactId, opportunity_id: opp.id, credit_value: 200000 + (i % 3) * 50000, term_months: 200, installment: 1400 + i * 10, strategy: 'aquisicao', payment_modality: 'parcela_integral' });
        const credit = 200000 + (i % 3) * 50000;
        const split = i % 2 === 1 ? { quota_split_strategy: 'grupos_diferentes', quota_values: [credit / 2, credit / 2], quota_split_notes: 'Duas cotas em grupos diferentes para dobrar as chances de contemplação por lance.' } : { quota_split_strategy: 'unica', quota_values: [credit] };
        proposal = proposals.createProposal(db, owner, { opportunity_id: opp.id, simulation_id: s.id, product_id: plans[i % plans.length], category: 'imovel', admin_fee_pct: 18, reserve_fund_pct: 2, readjustment_index: 'incc', readjustment_rate: 5.5, bid_deduction: 'parcela', contemplation_month: 12, valid_until: new Date(Date.now() + 15 * DAY).toISOString().slice(0, 10), status: 'apresentada', ...split });
      }
      opps.moveStage(db, owner, opp.id, { stage_id: stageId[st] });
      if (proposal) opp.proposal_id = proposal.id;
    }
    // Próxima ação do negócio
    if (upto < 5) opps.updateOpportunity(db, owner, opp.id, { next_action: upto < 2 ? 'Nova tentativa de contato' : upto < 3 ? 'Agendar R1' : 'Preparar a proposta', next_action_at: new Date(Date.now() + ((i % 4) - 1) * DAY).toISOString() });
  }

  function completeRecord(contactId, i) {
    contacts.updateContact(db, admin, contactId, { doc: ['52998224725', '11144477735', '39053344705', '71428793860'][i % 4], rg: `${12345670 + i}`, birthplace: 'São Paulo/SP', nationality: 'Brasileira', sex: i % 2 ? 'masculino' : 'feminino', marital_status: 'solteiro', mother_name: 'Nome fictício da mãe', profession: 'Analista', income_range: '6k_10k', birth_date: '1988-05-10', pref_channel: 'whatsapp', confirm_duplicate: true });
    record.saveAddress(db, admin, contactId, { cep: '01001000', street: 'Praça da Sé', number: `${100 + i}`, district: 'Sé', city: 'São Paulo', state: 'SP', is_primary: true, notes: i === 9 ? 'Portaria 24h: deixar documentos com o zelador.' : null });
  }

  /**
   * Aceite → pré-venda → termo de adesão (cotas) → contrato assinado → pagamento → comprovante (venda aguardando alocação)
   * → alocação informada pelo especialista → venda confirmada pelo time (se confirm).
   */
  function sell(owner, contactId, opp, i, { paidDaysAgo = 3, until = 'pagamento_comprovado', quotas = [200000], confirm = false, allocate = 'all' } = {}) {
    proposals.changeStatus(db, owner, opp.proposal_id, { status: 'aprovada', accepted_channel: 'whatsapp' });
    const ps = db.prepare("SELECT id FROM pre_sales WHERE opportunity_id = ? AND status <> 'cancelada' ORDER BY id DESC").get(opp.id);
    const qs = quotas.map((v, k) => ({ credit_value: v, group_code: `${3000 + i * 7 + k}`, quota_code: `${110 + k * 13 + i}`, contract_number: `${880000 + i * 10 + k}` }));
    const steps = [
      ['conferido', {}],
      ['termo_adesao', { plan_id: pImovel, adhesion_number: `ADE-${7000 + i}`, quotas: qs, installment_value: 1400 + i * 10 }],
      ['contrato_assinado', { date: dateAgo(paidDaysAgo + 1), signed_via: 'digital' }],
      ['pagamento_enviado', { payment_method: i % 2 ? 'boleto' : 'pix', boleto_value: 2100 + i * 10, boleto_due: dateAgo(paidDaysAgo) }],
      ['pagamento_comprovado', { payment_date: dateAgo(paidDaysAgo), filename: 'comprovante-pagamento.pdf', mime: 'application/pdf', content_base64: PDF }],
    ];
    let sale = null;
    for (const [step, data] of steps) {
      const r = sales.advancePreSale(db, owner, ps.id, { step, ...data });
      if (r.sale) sale = r.sale;
      if (step === until) break;
    }
    if (!sale) return { pre_sale: ps.id };
    const sq = sales.quotasOf(db, { sale_id: sale.id });
    if (allocate) sales.registerAllocation(db, owner, sale.id, { allocated_on: dateAgo(Math.max(0, paidDaysAgo - 2)), quotas: (allocate === 'all' ? sq : sq.slice(0, 1)).map((q) => ({ id: q.id, allocated: true })) });
    if (!confirm) return { sale, pre_sale: ps.id };
    const r = sales.confirmSale(db, gestor, sale.id, { allocated_on: dateAgo(Math.max(0, paidDaysAgo - 2)), pref_channel: 'whatsapp', pref_time: 'Manhã, das 9h às 12h' });
    db.prepare('UPDATE contacts SET postsale_started_at = ? WHERE id = ?').run(`${dateAgo(Math.max(0, paidDaysAgo - 2))}T13:00:00.000Z`, contactId);
    require('./services/postsale').syncTimeline(db, contactId, owner.id);
    return { sale, contract: r.contract, contracts: r.contracts, pre_sale: ps.id };
  }

  tx(db, () => {
    names.forEach((name, i) => {
      const owner = i % 2 ? c1 : c2;
      const target = TARGET[i % 10];
      const phone = `(11) 9${String(80000000 + i * 1379).slice(0, 4)}-${String(1000 + i * 37).slice(-4)}`;
      const { id } = contacts.createContact(
        db,
        admin,
        {
          kind: 'PF',
          name,
          relationship: target === 'prospect' ? 'prospect' : 'lead',
          phone1: phone,
          whatsapp: phone,
          email: `${name.split(' ')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}.demo${i}@example.com`,
          city: rnd(['São Paulo', 'Campinas', 'Santos', 'Sorocaba'], i),
          state: 'SP',
          origin: rnd(origins, i),
          campaign: i % 3 === 0 ? 'Campanha demonstração' : null,
          owner_id: owner.id,
          product_id: plans[i % plans.length],
          credit_value: 100000 + (i % 5) * 50000,
          temperature: rnd(['quente', 'morno', 'frio'], i),
          origin_details: i % 3 === 0 ? { platform: 'meta_ads', platform_lead_id: `demo-${i}`, campaign_id: 'demo-cmp-1', adset_id: 'demo-set-1', ad_id: `demo-ad-${i % 2}` } : {},
        },
        { skipDuplicateCheck: true },
      );
      ids.push(id);
      const opp = db.prepare('SELECT * FROM opportunities WHERE contact_id = ?').get(id);
      if (target === 'prospect') {
        if (i === 10) activities.createActivity(db, owner, { contact_id: id, type: 'tentativa_sem_atendimento', result: 'caixa_postal', occurred_at: ago(1) });
      } else {
        advance(owner, id, opp, ORDER.includes(target) ? target : 'follow_up', i);
      }
      // Respostas dos clientes às propostas (probabilidade de fechamento)
      if (target === 'follow_up' && opp.proposal_id) proposals.registerResponse(db, owner, opp.proposal_id, { response: i === 6 ? 'duvidas' : 'sem_resposta' });
      if (target === 'aceite') {
        // Proposta aceita: pré-venda aberta e link enviado ao cliente; i=17 fica sem acesso há 2 dias (alerta de pré-venda parada)
        proposals.registerResponse(db, owner, opp.proposal_id, { response: 'positiva' });
        proposals.changeStatus(db, owner, opp.proposal_id, { status: 'aprovada', accepted_channel: 'whatsapp' });
        const ps = db.prepare('SELECT id FROM pre_sales WHERE opportunity_id = ?').get(opp.id);
        sales.markSent(db, owner, ps.id, { via: 'whatsapp' });
        if (i === 17) db.prepare('UPDATE pre_sales SET created_at = ?, sent_at = ? WHERE id = ?').run(ago(2), ago(2), ps.id);
      }
      if (target === 'prevenda') {
        if (i === 8) {
          // Cliente abriu o link e enviou um documento (aguardando validação)
          proposals.changeStatus(db, owner, opp.proposal_id, { status: 'aprovada', accepted_channel: 'telefone' });
          const ps = db.prepare('SELECT * FROM pre_sales WHERE opportunity_id = ?').get(opp.id);
          const link = db.prepare('SELECT token FROM client_links WHERE id = ?').get(ps.client_link_id);
          sales.markSent(db, owner, ps.id, { via: 'email' });
          record.publicForm(db, link.token);
          record.publicUpload(db, link.token, { doc_type: 'identificacao', filename: 'documento-identidade.png', mime: 'image/png', content_base64: SAMPLE_DOC });
        } else {
          // Comprovante anexado: venda em Vendas aguardando a alocação (1 de 2 cotas já alocada)
          completeRecord(id, i);
          sell(owner, id, opp, i, { quotas: [130000, 120000], paidDaysAgo: 2, allocate: 'first' });
        }
      }
      if (target === 'venda') {
        completeRecord(id, i);
        const r = sell(owner, id, opp, i, { paidDaysAgo: i === 9 ? 20 : 5, quotas: i === 9 ? [150000, 150000] : [200000], confirm: true });
        if (r.contract) {
          finance.generateInstallments(db, admin, r.contract.id, { first_due_date: dateAgo(i === 9 ? 20 : 5), count: 12 });
          const first = db.prepare('SELECT id FROM finance_entries WHERE contract_id = ? ORDER BY installment_number LIMIT 1').get(r.contract.id);
          if (first) finance.updateEntry(db, admin, first.id, { action: 'pagar', payment_method: 'boleto' });
        }
        if (i === 9) {
          record.togglePostSale(db, owner, id, { item: 'onboarding', done: true, notes: 'Boas-vindas por vídeo; explicado o calendário de assembleias.' });
          record.togglePostSale(db, owner, id, { item: 'acesso_cliente', done: true, notes: 'Cliente acessou o aplicativo e viu as duas cotas.' });
          // Histórico de estratégias: primeiro lance embutido; depois da análise do FGTS, lance livre de 25%
          record.saveBidStrategy(db, owner, r.contract.id, { will_bid: true, bid_type: 'embutido', notes: 'Definido no onboarding.' });
          db.prepare('UPDATE bid_strategy_history SET created_at = ? WHERE contract_id = ?').run(ago(15, 11), r.contract.id);
          record.saveBidStrategy(db, owner, r.contract.id, { will_bid: true, bid_type: 'livre', bid_pct: 25, use_embedded: true, use_fgts: true, notes: 'Ofertar a partir da 6ª assembleia.' });
          const n = record.createNps(db, owner, id, { contract_id: r.contract.id });
          record.publicNpsForm(db, n.token);
          record.publicNpsSubmit(db, n.token, { score: 9, answers: { atendimento: 5, clareza: 4, agilidade: 4, confianca: 5 }, comment: 'Atendimento muito atencioso.' });
        } else {
          // Cancelamento dentro dos 7 dias: comissão futura cancelada e índice do especialista atualizado
          sales.registerCancellation(db, gestor, r.sale.id, { cancelled_on: dateAgo(1), reason: 'arrependimento_7_dias', description: 'Cliente desistiu no prazo de arrependimento: decidiu esperar a venda de outro imóvel.', responsible_id: owner.id });
          // Pesquisa de satisfação respondida com nota baixa (detrator sem tratativa: aparece nos alertas do pós-venda)
          const n = record.createNps(db, owner, id, {});
          record.publicNpsForm(db, n.token);
          record.publicNpsSubmit(db, n.token, { score: 4, reason: 'expectativa_contemplacao', answers: { atendimento: 4, clareza: 2, agilidade: 3, confianca: 2 }, comment: 'Entendi que seria contemplado mais rápido.' });
        }
      }
      if (i === 15) {
        opps.moveStage(db, owner, opp.id, { stage_id: stageId.perdido, lost_reason: 'optou_financiamento' });
        contacts.updateContact(db, admin, id, { active: false, inactive_reason: 'Optou por financiamento bancário.' });
      }
      if (i === 5 || i === 15) {
        // Propostas recusadas com o motivo (base para o trabalho de recuperação)
        const pr = proposals.createProposal(db, owner, { opportunity_id: opp.id, product_id: pImovel, category: 'imovel', credit_value: i === 5 ? 250000 : 180000, valid_until: new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10), status: 'apresentada' });
        proposals.changeStatus(db, owner, pr.id, i === 5
          ? { status: 'recusada', refusal_reason: 'nao_e_momento', refusal_notes: 'Quer primeiro quitar o carro; pediu para falar em 2 meses.', retake_at: new Date(Date.now() + 60 * DAY).toISOString().slice(0, 10) }
          : { status: 'recusada', refusal_reason: 'financiamento', refusal_notes: 'Banco liberou financiamento com entrada menor.' });
      }
      if (i === 14) opps.moveStage(db, owner, opp.id, { stage_id: stageId.nutricao, pause_reason: 'Vai decidir depois do bônus do fim do ano.', return_at: new Date(Date.now() + 60 * DAY).toISOString().slice(0, 10) });
      if (i === 12) contacts.updateContact(db, admin, id, { referred_by_id: ids[9] });
    });

    // Prospects e leads recebidos ainda sem especialista (fila de distribuição)
    [['Roberta Farias', 'meta_ads', 'lead', 0.2], ['Samuel Pinto', 'site', 'lead', 3], ['Viviane Rocha', 'instagram', 'lead', 26], ['Wagner Lopes', 'evento', 'prospect', 50]].forEach(([name, origin, rel, hours], k) => {
      const { id } = contacts.createContact(db, admin, { kind: 'PF', name, relationship: rel, phone1: `(11) 97777-10${k}0`, email: `${name.split(' ')[0].toLowerCase()}.fila@example.com`, origin, owner_id: '', credit_value: 150000 + k * 50000 }, { skipDuplicateCheck: true });
      db.prepare('UPDATE contacts SET created_at = ? WHERE id = ?').run(new Date(Date.now() - hours * 3600000).toISOString(), id);
    });
    distribution.saveRoleta(db, admin, { mode: 'sequencial', auto: false, first_contact_hours: 1, participants: [{ user_id: c1.id, active: true, weight: 1 }, { user_id: c2.id, active: true, weight: 1 }] });

    // Metas do mês: especialistas e equipe
    const month = dateAgo(0).slice(0, 7);
    goals.saveGoals(db, admin, { month, items: [{ scope: 'user', user_id: c1.id, target_credit: 800000, target_sales: 4 }, { scope: 'user', user_id: c2.id, target_credit: 600000, target_sales: 3 }, { scope: 'team', team_id: team, target_credit: 1500000, target_sales: 7 }] });
  });
  setSetting(db, 'require_sale_checklist', checklistSetting !== false);
  finance.overdueSweep(db);
  sales.presaleSweep(db);
  sales.commissionSweep(db);
}

module.exports = { seedDemo, DEMO_USERS };
