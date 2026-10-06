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
const treasury = require('./services/treasury');

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
  // Especialista recém-contratado: senha provisória (troca obrigatória no 1º acesso) e trilha de integração
  const novo = mkUser('Especialista Novo (integração)', 'novo@demo.local', 'consultor', team, null, null);
  db.prepare('UPDATE users SET must_change_password = 1, onboarding = ? WHERE id = ?').run(JSON.stringify({ active: true, started_at: now, steps: {} }), novo.id);
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
    name: 'Administradora Alfa (fictícia)', website: 'alfa.exemplo.com.br', portal_url: 'portal.alfa.exemplo.com.br', portal_login: 'corretora.demo', portal_password: 'senha-ficticia-123',
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
  catalog.savePlan(db, admin, { id: pServico, name: 'Serviços 40', plan_code: 'BT-SRV-40', administrator_id: beta, category: 'servico', admin_fee_pct: 20, reserve_fund_pct: 3, term_months: 40, readjustment_index: 'pre6', credit_min: 15000, credit_max: 30000 });
  const pBeta = catalog.savePlan(db, admin, { name: 'Imóvel Beta 180', plan_code: 'BT-IMV-180', administrator_id: beta, category: 'imovel', admin_fee_pct: 17, reserve_fund_pct: 1.5, term_months: 180, fixed_bid: true, fixed_bid_pct: 30, readjustment_index: 'ipca', credit_min: 150000, credit_max: 400000, credit_step: 50000,
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
          housing_purpose: rnd(['morar', 'investir', 'morar'], i), pays_rent: i % 3 ? 'sim' : 'nao', rent_value: i % 3 ? 2200 + i * 50 : undefined,
          has_property: i % 4 === 1 ? 'sim' : 'nao', property_type: i % 4 === 1 ? rnd(['apartamento', 'casa', 'terreno'], i) : undefined,
          property_value: i % 4 === 1 ? 420000 + i * 10000 : undefined, property_free_liens: i % 4 === 1 ? (i % 8 === 1 ? 'sim' : 'nao') : undefined,
          ...(rnd(['sim', 'nao', 'nao_sabe'], i) === 'sim' ? { bid_own_resources: 30000 + i * 2500, bid_source: rnd(['reserva', 'fgts', 'reserva_fgts'], i) } : {}),
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
          // O cliente confirma os 4 últimos dígitos do celular antes de ver e enviar dados
          const c0 = db.prepare('SELECT whatsapp, phone1 FROM contacts WHERE id = ?').get(id);
          const { key } = record.publicVerify(db, link.token, { digits: String(c0.whatsapp || c0.phone1).replace(/\D/g, '').slice(-4) });
          record.publicForm(db, link.token, key);
          record.publicUpload(db, link.token, { key, doc_type: 'identificacao', filename: 'documento-identidade.png', mime: 'image/png', content_base64: SAMPLE_DOC });
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
    distribution.saveRoleta(db, admin, { mode: 'sequencial', auto: true, first_contact_hours: 1, participants: [{ user_id: c1.id, active: true, weight: 1 }, { user_id: c2.id, active: true, weight: 1 }] });

    // Metas do mês: especialistas e equipe
    const month = dateAgo(0).slice(0, 7);
    goals.saveGoals(db, admin, { month, items: [{ scope: 'user', user_id: c1.id, target_credit: 800000, target_sales: 4 }, { scope: 'user', user_id: c2.id, target_credit: 600000, target_sales: 3 }, { scope: 'team', team_id: team, target_credit: 1500000, target_sales: 7 }] });
  });
  setSetting(db, 'require_sale_checklist', checklistSetting !== false);
  // Pós-venda: parcela ajustada no reajuste e uma cota contemplada por lance fidelidade (cliente escolheu o faturamento)
  const kc = db.prepare('SELECT id, credit_value, installment_value FROM contracts WHERE sale_id IS NOT NULL ORDER BY id LIMIT 1').get();
  if (kc && kc.credit_value) {
    const r2 = (v) => Math.round(v * 100) / 100;
    require('./services/clients').updateContract(db, admin, kc.id, {
      installment_value: kc.installment_value ? r2(kc.installment_value * 1.045) : undefined, available_credit: r2(kc.credit_value * 1.045),
      contemplated_at: dateAgo(1), contemplation_type: 'lance_fidelidade', bid_value: r2(kc.credit_value * 0.2),
      contemplation_credit: r2(kc.credit_value * 1.045), net_to_pay: r2(kc.credit_value * 0.9), client_choice: 'faturamento',
    });
  }
  seedTreasuryDemo(db, { admin, gestor, c1, PDF });
  seedPeopleDemo(db, { admin, gestor, c1, c2, team, PDF });
  seedDocumentsDemo(db, { admin, PDF });
  finance.overdueSweep(db);
  sales.presaleSweep(db);
  sales.commissionSweep(db);
}

/**
 * Financeiro da empresa: contas, parceiros, despesas (recorrentes, assinaturas, parcelada e pontuais) e receitas
 * das administradoras (com rateio por competência), com atrasos com e sem motivo e baixas com e sem comprovante.
 */
function seedTreasuryDemo(db, { admin, gestor, c1, PDF }) {
  const today = dateAgo(0);
  const one = (sql, ...a) => db.prepare(sql).get(...a)?.id;
  const cat = (dir, name) => one('SELECT id FROM fin_categories WHERE direction = ? AND name = ?', dir, name);
  const cc = (name) => one('SELECT id FROM fin_cost_centers WHERE name = ?', name);
  const pm = (name) => one('SELECT id FROM fin_payment_methods WHERE name = ?', name);
  const mDay = (offset, day) => treasury.addMonths(`${today.slice(0, 7)}-01`, offset, day);
  const proof = (name) => ({ filename: `comprovante-${name}.pdf`, mime: 'application/pdf', content_base64: PDF });
  tx(db, () => {
    const opening = mDay(-7, 1);
    const main = one("SELECT id FROM fin_accounts WHERE name = 'Conta principal'");
    const cash = one("SELECT id FROM fin_accounts WHERE type = 'caixa'");
    treasury.saveCatalog(db, admin, 'contas', { id: main, bank: 'Banco Exemplo S.A.', agency: '0001', number: '12345-6', pix_key: 'financeiro@vero.example', opening_balance: 85000, opening_date: opening });
    treasury.saveCatalog(db, admin, 'contas', { id: cash, opening_balance: 800, opening_date: opening });
    const rec = treasury.saveCatalog(db, admin, 'contas', { name: 'Conta de recebimentos', bank: 'Banco Digital Exemplo', agency: '0001', number: '98765-4', type: 'pagamento', opening_balance: 15000, opening_date: opening }).id;
    treasury.saveCatalog(db, admin, 'formas', { id: pm('Pix'), active: true });
    const partner = (name, kind, extra = {}) => treasury.saveCatalog(db, admin, 'parceiros', { name, kind, ...extra }).id;
    const P = {
      imob: partner('Imobiliária Paulista Ltda', 'fornecedor', { doc: '12.345.678/0001-90', email: 'locacao@imobpaulista.example', notes: 'Aluguel da sala comercial (contrato de 30 meses).' }),
      crm: partner('Nuvem CRM Software', 'fornecedor', { email: 'cobranca@nuvemcrm.example' }),
      sim: partner('SimulaCon Tecnologia', 'fornecedor', { email: 'financeiro@simulacon.example' }),
      midia: partner('Agência Pixel Mídia', 'fornecedor', { doc: '23.456.789/0001-01', notes: 'Gestão de tráfego pago (Meta e Google Ads).' }),
      cont: partner('Contábil Exata', 'fornecedor', { phone: '(11) 3333-4444' }),
      info: partner('InfoStore Equipamentos', 'fornecedor'),
      brindes: partner('Brindes & Cia', 'fornecedor'),
    };
    const adms = db.prepare('SELECT id, name FROM administrators WHERE active = 1 ORDER BY id LIMIT 3').all();
    const payer = adms.map((a) => partner(a.name, 'pagador', { administrator_id: a.id, notes: 'Comissões pagas por nota fiscal, até o dia 20.' }));
    const parceiroImob = partner('Imobiliária Parceira Horizonte', 'ambos', { notes: 'Indica clientes e recebe/paga intermediação.' });

    const title = (data) => treasury.createTitle(db, admin, { account_id: main, responsible_id: gestor.id, ...data }).id;
    const items = (id) => db.prepare('SELECT * FROM fin_installments WHERE title_id = ? ORDER BY number').all(id);
    /** Baixa as ocorrências vencidas (até "until"), com comprovante, exceto as indicadas. */
    const payPast = (id, { until = today, skip = [], noProof = [], extra = 0 } = {}) => {
      for (const i of items(id)) {
        if (i.status !== 'aberto' || i.due_date > until || skip.includes(i.number)) continue;
        const paid = i.due_date < today ? i.due_date : today;
        treasury.settle(db, admin, i.id, { paid_at: paid, paid_amount: i.amount + extra, ...(noProof.includes(i.number) ? {} : proof(`${id}-${i.number}`)) });
      }
    };

    // Despesas recorrentes do dia a dia
    const rent = title({ direction: 'pagar', kind: 'recorrente', description: 'Aluguel da sala comercial', partner_id: P.imob, category_id: cat('pagar', 'Aluguel e condomínio'), cost_center_id: cc('Administrativo'), payment_method_id: pm('Boleto'), installment_value: 6500, periodicity: 'mensal', first_due: mDay(-3, 5), end_date: mDay(26, 5), invoice_number: 'Contrato 2026/014' });
    const lastRent = items(rent).filter((i) => i.due_date < today).pop()?.number;
    payPast(rent, { noProof: [lastRent] });
    const salaries = title({ direction: 'pagar', kind: 'recorrente', description: 'Salários e encargos da equipe interna', category_id: cat('pagar', 'Salários e pró-labore'), cost_center_id: cc('Operação e pós-venda'), payment_method_id: pm('TED'), installment_value: 16500, periodicity: 'mensal', first_due: mDay(-3, 5), responsible_id: admin.id });
    payPast(salaries);
    const ads = title({ direction: 'pagar', kind: 'recorrente', description: 'Tráfego pago: campanhas de geração de leads', partner_id: P.midia, category_id: cat('pagar', 'Tráfego pago (Meta e Google Ads)'), cost_center_id: cc('Marketing'), payment_method_id: pm('Boleto'), installment_value: 9000, periodicity: 'mensal', first_due: mDay(-3, 15) });
    payPast(ads);
    const acc = title({ direction: 'pagar', kind: 'recorrente', description: 'Honorários da contabilidade', partner_id: P.cont, category_id: cat('pagar', 'Contabilidade'), cost_center_id: cc('Administrativo'), payment_method_id: pm('Boleto'), installment_value: 1800, periodicity: 'mensal', first_due: treasury.addMonths(today, -3, Number(dateAgo(4).slice(8, 10))) });
    const accLate = items(acc).filter((i) => i.due_date < today).pop();
    payPast(acc, { skip: [accLate.number] });
    treasury.lateReason(db, gestor, accLate.id, { reason: 'O boleto veio com a data de vencimento errada; pedimos um novo boleto à contabilidade, que deve chegar até amanhã.' });
    treasury.addNote(db, gestor, acc, { text: 'Contabilidade confirmou o envio de um novo boleto, sem juros.' });
    const tax = title({ direction: 'pagar', kind: 'recorrente', description: 'Simples Nacional (DAS)', category_id: cat('pagar', 'Impostos (Simples, ISS)'), cost_center_id: cc('Administrativo'), payment_method_id: pm('Boleto'), installment_value: 3400, periodicity: 'mensal', first_due: mDay(-3, 20), responsible_id: admin.id });
    payPast(tax);

    // Assinaturas: CRM mensal (renova em breve) e simulador anual
    const crm = title({ direction: 'pagar', kind: 'assinatura', description: 'CRM e discadora (licenças da equipe)', partner_id: P.crm, category_id: cat('pagar', 'Software e assinaturas (CRM, discadora, simulador)'), cost_center_id: cc('Tecnologia'), payment_method_id: pm('Boleto'), installment_value: 890, periodicity: 'mensal', first_due: treasury.addMonths(today, -11, 10), renewal_date: dateAgo(-12), auto_renew: 1 });
    payPast(crm);
    const sim = title({ direction: 'pagar', kind: 'assinatura', description: 'Plataforma de simulação (plano anual)', partner_id: P.sim, category_id: cat('pagar', 'Software e assinaturas (CRM, discadora, simulador)'), cost_center_id: cc('Comercial'), payment_method_id: pm('TED'), installment_value: 4800, periodicity: 'anual', first_due: treasury.addMonths(today, -2, 12), auto_renew: 0 });
    payPast(sim);

    // Compra parcelada e despesas pontuais
    const nb = title({ direction: 'pagar', kind: 'parcelada', description: 'Notebooks para a equipe (4 unidades)', partner_id: P.info, category_id: cat('pagar', 'Equipamentos e informática'), cost_center_id: cc('Tecnologia'), payment_method_id: pm('Boleto'), installments: 6, total_value: 18000, first_due: mDay(-2, 8), invoice_number: '55.120' });
    payPast(nb);
    title({ direction: 'pagar', kind: 'pontual', description: 'Brindes para o evento de clientes', partner_id: P.brindes, category_id: cat('pagar', 'Eventos e brindes'), cost_center_id: cc('Comercial'), payment_method_id: pm('Pix'), total_value: 2350, first_due: dateAgo(3), responsible_id: c1.id, note: 'Canecas e cadernos com a marca para o evento de clientes.' });
    title({ direction: 'pagar', kind: 'pontual', description: 'Curso de certificação dos novos especialistas', category_id: cat('pagar', 'Certificações e cursos'), cost_center_id: cc('Comercial'), payment_method_id: pm('Boleto'), total_value: 1200, first_due: dateAgo(-9) });
    const coffee = title({ direction: 'pagar', kind: 'pontual', description: 'Café e copa do escritório', category_id: cat('pagar', 'Material de escritório'), cost_center_id: cc('Administrativo'), payment_method_id: pm('Dinheiro'), total_value: 380, first_due: dateAgo(6), account_id: cash });
    payPast(coffee, { noProof: [1] });

    // Receitas: comissões das administradoras (uma nota de 100 mil rateada em 4 meses de competência)
    const big = treasury.createTitle(db, admin, { direction: 'receber', kind: 'pontual', description: `Comissões de vendas — ${adms[0]?.name || 'administradora'}`, partner_id: payer[0], category_id: cat('receber', 'Comissão de venda (administradora)'), cost_center_id: cc('Comercial'), payment_method_id: pm('TED'), account_id: rec, responsible_id: admin.id, total_value: 100000, first_due: dateAgo(2), invoice_number: '1.204', invoice_date: dateAgo(8) }).id;
    treasury.saveAllocations(db, admin, big, { allocations: [{ competence: mDay(0, 1).slice(0, 7), amount: 40000 }, { competence: mDay(-1, 1).slice(0, 7), amount: 30000 }, { competence: mDay(-2, 1).slice(0, 7), amount: 20000 }, { competence: mDay(-3, 1).slice(0, 7), amount: 10000, notes: 'Vendas do início do trimestre' }] });
    payPast(big);
    if (payer[1]) {
      const recur = treasury.createTitle(db, admin, { direction: 'receber', kind: 'recorrente', description: `Comissão recorrente das parcelas — ${adms[1].name}`, partner_id: payer[1], category_id: cat('receber', 'Comissão recorrente (parcelas)'), cost_center_id: cc('Comercial'), payment_method_id: pm('TED'), account_id: main, responsible_id: admin.id, installment_value: 24000, periodicity: 'mensal', first_due: mDay(-3, 20) }).id;
      payPast(recur);
    }
    const monthly = treasury.createTitle(db, admin, { direction: 'receber', kind: 'recorrente', description: `Comissões de vendas do mês — ${adms[0]?.name || 'administradora'}`, partner_id: payer[0], category_id: cat('receber', 'Comissão de venda (administradora)'), cost_center_id: cc('Comercial'), payment_method_id: pm('TED'), account_id: main, responsible_id: admin.id, installment_value: 18000, periodicity: 'mensal', first_due: mDay(-3, 10), notes: 'Valor de referência: a nota de cada mês é ajustada na baixa.' }).id;
    payPast(monthly);
    const third = payer[2] || payer[0];
    const parc = treasury.createTitle(db, admin, { direction: 'receber', kind: 'parcelada', description: `Comissão parcelada do grupo imobiliário — ${(adms[2] || adms[0])?.name || ''}`, partner_id: third, category_id: cat('receber', 'Comissão de venda (administradora)'), cost_center_id: cc('Comercial'), payment_method_id: pm('TED'), account_id: rec, responsible_id: gestor.id, installments: 3, total_value: 45000, first_due: mDay(-1, 25), invoice_number: '1.188' }).id;
    payPast(parc);
    const prize = treasury.createTitle(db, admin, { direction: 'receber', kind: 'pontual', description: 'Prêmio por meta do trimestre', partner_id: payer[0], category_id: cat('receber', 'Prêmio por meta'), cost_center_id: cc('Comercial'), payment_method_id: pm('TED'), account_id: rec, responsible_id: gestor.id, total_value: 8000, first_due: dateAgo(6) }).id;
    treasury.lateReason(db, gestor, items(prize)[0].id, { reason: 'A administradora pediu uma nova nota fiscal com o CNPJ da filial; nota reemitida e enviada ontem.' });
    treasury.createTitle(db, admin, { direction: 'receber', kind: 'pontual', description: 'Bonificação da campanha comercial do mês', partner_id: payer[0], category_id: cat('receber', 'Bonificação ou campanha da administradora'), cost_center_id: cc('Comercial'), payment_method_id: pm('TED'), account_id: rec, responsible_id: admin.id, total_value: 15000, first_due: dateAgo(-12) });
    treasury.createTitle(db, admin, { direction: 'receber', kind: 'pontual', description: 'Intermediação de carta contemplada', partner_id: parceiroImob, category_id: cat('receber', 'Intermediação'), cost_center_id: cc('Comercial'), payment_method_id: pm('Pix'), account_id: main, responsible_id: c1.id, total_value: 6000, first_due: dateAgo(-35) });
  });
  treasury.sweep(db);
}

/** Colaboradores fictícios: sócio-diretor, líder (CLT), especialistas (CLT e PJ), estagiária e um desligado. */
function seedPeopleDemo(db, { admin, gestor, c1, c2, team, PDF }) {
  const people = require('./services/people');
  const cc = (n) => db.prepare('SELECT id FROM fin_cost_centers WHERE name = ?').get(n)?.id ?? null;
  const save = (d) => people.saveEmployee(db, admin, d).id;
  const dir = save({ full_name: 'Administrador Demo', user_id: admin.id, cpf: '111.444.777-35', birth_date: '1985-04-12', phone: '(51) 98912-1113', corporate_email: 'admin@demo.local', job_title: 'Diretor comercial', job_function: 'Gestão da empresa e das parcerias', cost_center_id: cc('Diretoria'), admission_date: '2021-02-01', contract_type: 'socio', partner_share_pct: 100, pay_model: 'fixa', base_salary: 12000, pay_day: 5, work_regime: 'hibrido', city: 'Porto Alegre', state: 'RS' });
  const lider = save({ full_name: 'Gestora Demo (líder)', user_id: gestor.id, cpf: '295.379.955-93', birth_date: '1990-' + dateAgo(-5).slice(5), phone: '(11) 90000-0002', personal_email: 'gestora.pessoal@example.com', corporate_email: 'gestora@demo.local', job_title: 'Líder de equipe comercial', job_function: 'Gestão do time e distribuição de leads', team_id: team, leader_id: dir, cost_center_id: cc('Comercial'), admission_date: '2022-03-14', contract_type: 'clt', pis: '123.45678.91-0', ctps: '1234567', ctps_series: '001', work_schedule: 'Segunda a sexta, 9h às 18h', weekly_hours: 44, daily_hours: 8, break_minutes: 60, time_tracking: 'Ponto eletrônico', pay_model: 'hibrida', base_salary: 6500, variable_description: '0,1% sobre o crédito vendido pela equipe + bônus por meta trimestral', variable_target: 2500, pay_day: 5, work_regime: 'presencial', emergency_name: 'Paulo Souza', emergency_relation: 'Cônjuge', emergency_phone: '(11) 97777-0000', bank_name: 'Banco do Brasil', bank_agency: '1234', bank_account: '56789-0', bank_account_type: 'Corrente', pix_key: 'gestora@demo.local' });
  const e1 = save({ full_name: 'Especialista Demo 1', user_id: c1.id, cpf: '153.509.460-56', birth_date: '1996-08-21', phone: '(11) 90000-0003', corporate_email: 'consultor1@demo.local', job_title: 'Especialista em consórcio imobiliário', job_function: 'Atendimento consultivo e vendas', team_id: team, leader_id: lider, cost_center_id: cc('Comercial'), admission_date: dateAgo(400), contract_type: 'clt', work_schedule: 'Segunda a sexta, 9h às 18h', weekly_hours: 44, daily_hours: 8, break_minutes: 60, time_tracking: 'Aplicativo', pay_model: 'hibrida', base_salary: 3200, variable_description: '0,6% sobre o crédito vendido, em parcelas conforme a tabela da administradora', variable_target: 3500, pay_day: 5, work_regime: 'hibrido' });
  const e2 = save({ full_name: 'Especialista Demo 2', user_id: c2.id, cpf: '714.602.380-01', birth_date: '1993-11-02', phone: '(11) 90000-0004', corporate_email: 'consultor2@demo.local', job_title: 'Especialista em consórcio de veículos', job_function: 'Vendas consultivas', team_id: team, leader_id: lider, cost_center_id: cc('Comercial'), admission_date: dateAgo(220), contract_type: 'pj', pj_company_name: 'Demo 2 Consultoria Ltda', pj_trade_name: 'Demo 2 Consultoria', pj_cnpj: '11.222.333/0001-81', pj_tax_regime: 'Simples Nacional', pay_model: 'variavel', variable_description: '0,7% sobre o crédito vendido (nota fiscal mensal)', variable_target: 5000, pay_day: 10, work_regime: 'remoto' });
  const est = save({ full_name: 'Júlia Estagiária', cpf: '483.157.200-40', birth_date: '2003-' + dateAgo(-12).slice(5), phone: '(51) 99111-2222', personal_email: 'julia.estagio@example.com', corporate_email: 'julia@veroconsorciosbr.com.br', job_title: 'Estagiária de pós-venda', job_function: 'Apoio na formalização e no pós-venda', leader_id: lider, cost_center_id: cc('Operação e pós-venda'), admission_date: dateAgo(90), contract_type: 'estagio', internship_institution: 'UFRGS', internship_course: 'Administração', internship_supervisor: 'Gestora Demo (líder)', work_schedule: 'Segunda a sexta, 13h às 19h', weekly_hours: 30, daily_hours: 6, time_tracking: 'Aplicativo', pay_model: 'fixa', base_salary: 1500, pay_day: 5, work_regime: 'presencial' });
  const old = save({ full_name: 'Rafael Ex-especialista', cpf: '862.410.950-72', job_title: 'Especialista em consórcios', team_id: team, leader_id: lider, cost_center_id: cc('Comercial'), admission_date: dateAgo(500), contract_type: 'clt', pay_model: 'hibrida', base_salary: 3000, variable_description: '0,6% sobre vendas', variable_target: 2000 });
  people.saveEmployee(db, admin, { id: old, status: 'desligado', termination_date: dateAgo(40), termination_type: 'pedido', termination_reason: 'Mudança de cidade' });
  const ben = (id, kind, type, extra = {}) => people.saveBenefit(db, admin, id, { kind, type, ...extra });
  for (const id of [lider, e1, est]) {
    ben(id, 'beneficio', 'vale_refeicao', { amount: id === est ? 400 : 800, description: 'Cartão refeição' });
    ben(id, 'beneficio', 'vale_transporte', { amount: 250 });
    ben(id, 'desconto', 'desconto_vt', { value_type: 'percentual', amount: id === est ? 0 : 6, description: 'Até 6% do salário-base' });
  }
  for (const id of [lider, e1]) {
    ben(id, 'beneficio', 'plano_saude', { amount: 520, company_cost: 520, description: 'Plano de saúde enfermaria' });
    ben(id, 'beneficio', 'seguro_vida', { amount: 35 });
    ben(id, 'desconto', 'inss', { value_type: 'percentual', amount: 9, description: 'Alíquota efetiva estimada' });
    ben(id, 'desconto', 'coparticipacao', { amount: 40 });
  }
  ben(e2, 'beneficio', 'ajuda_custo', { amount: 300, description: 'Internet e celular' });
  const ctr = (id, title, start, end, extra = {}) => people.saveContract(db, admin, id, { title, start_date: start, end_date: end, filename: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`, content_base64: PDF, ...extra });
  ctr(lider, 'Contrato de trabalho CLT', '2022-03-14', null);
  ctr(e1, 'Contrato de trabalho CLT', dateAgo(400), null);
  ctr(e2, 'Contrato de prestação de serviços (PJ)', dateAgo(220), dateAgo(-20), { monthly_value: 5000, notes: 'Renovação anual; reajuste pelo IPCA.' });
  ctr(est, 'Termo de compromisso de estágio', dateAgo(90), dateAgo(-275), { notes: 'Seguro de acidentes pessoais contratado.' });
  ctr(dir, 'Contrato social – cláusula de pró-labore', '2021-02-01', null, { contract_type: 'socio' });
  people.uploadFile(db, admin, e1, { category: 'identificacao', title: 'CNH digital', filename: 'cnh.pdf', content_base64: PDF });
  people.uploadFile(db, admin, e2, { category: 'cnpj', title: 'Cartão CNPJ da PJ', filename: 'cartao-cnpj.pdf', content_base64: PDF });
  people.saveEmployee(db, admin, { id: e1, status: 'ferias', status_since: dateAgo(3), status_until: dateAgo(-12), status_reason: 'Férias do 1º período aquisitivo' });
}

/** Central de documentos: alguns arquivos fictícios nas pastas padrão (um com a validade vencendo). */
function seedDocumentsDemo(db, { admin, PDF }) {
  const documents = require('./services/documents');
  const folder = (re) => db.prepare('SELECT id, name FROM doc_folders WHERE parent_id IS NULL').all().find((f) => re.test(f.name))?.id;
  const sub = (parent, name) => documents.saveFolder(db, admin, { name, parent_id: parent }).id;
  const up = (folder_id, title, extra = {}) => documents.saveDocument(db, admin, { folder_id, title, filename: `${title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}.pdf`, content_base64: PDF, ...extra });
  const soc = folder(/Societ/);
  up(soc, 'Cartão CNPJ', { doc_number: '12.345.678/0001-90', issuer: 'Receita Federal', issue_date: dateAgo(60), tags: 'cnpj, cadastro' });
  up(soc, 'Contrato social – 2ª alteração', { issuer: 'Junta Comercial do RS', issue_date: '2024-05-10', tags: 'contrato social, societário' });
  const fisc = folder(/Fiscal/);
  const cert = sub(fisc, 'Certidões negativas');
  up(cert, 'CND Federal (Receita e PGFN)', { issuer: 'Receita Federal', issue_date: dateAgo(170), expires_at: dateAgo(-10), tags: 'certidão' });
  up(cert, 'CND Estadual', { issuer: 'SEFAZ-RS', issue_date: dateAgo(30), expires_at: dateAgo(-60), tags: 'certidão' });
  up(fisc, 'Inscrição municipal', { doc_number: '987654-3', issuer: 'Prefeitura de Porto Alegre', tags: 'inscrição' });
  const jur = folder(/Jur/);
  up(jur, 'Contrato de parceria com administradora', { issue_date: '2025-01-20', expires_at: dateAgo(-300), tags: 'contrato, parceria' });
  const lic = folder(/Licen/);
  up(lic, 'Alvará de funcionamento', { issuer: 'Prefeitura de Porto Alegre', issue_date: dateAgo(340), expires_at: dateAgo(5), tags: 'alvará' });
  up(lic, 'Certificado digital e-CNPJ A1', { issuer: 'Certificadora', expires_at: dateAgo(-200), tags: 'certificado digital' });
  up(folder(/Marca/), 'Manual da marca Vero Consórcios', { tags: 'marca, identidade visual' });
  documents.expirySweep(db);
}

module.exports = { seedDemo, DEMO_USERS };
