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
  const ORDER = ['lead', 'tentativa', 'qualificado', 'r1', 'r2', 'negociacao'];
  // Etapa alvo de cada cadastro (índice % 10): 0 prospect, 1 lead, 2 tentativa, 3 qualificação, 4 R1, 5 R2, 6 negociação (proposta), 7 aceite/pré-venda, 8 pré-venda com link, 9 venda
  const TARGET = ['prospect', 'lead', 'tentativa', 'qualificado', 'r1', 'r2', 'negociacao', 'aceite', 'prevenda', 'venda'];
  const AREAS = ['consorcio', 'consorcio', 'planejamento', 'consorcio', 'seguros', 'consorcio', 'investimentos', 'consorcio'];
  const meet = (owner, contactId, opp, kind, dueAt, extra = {}) => {
    const id = tasks.createTask(db, owner, { contact_id: contactId, opportunity_id: opp.id, type: 'reuniao', title: `[${kind.toUpperCase()}] ${db.prepare('SELECT name FROM contacts WHERE id = ?').get(contactId).name} | Vero Consórcios`, due_at: dueAt, priority: 'alta' });
    db.prepare('UPDATE tasks SET meeting_kind = ?, ends_at = ?, meeting_url = ?, confirmed_at = ?, rescheduled_from = ? WHERE id = ?')
      .run(kind, new Date(Date.parse(dueAt) + (kind === 'r2' ? 60 : 30) * 60000).toISOString(), extra.url ?? 'https://meet.google.com/abc-defg-hij', extra.confirmed ? dueAt : null, extra.from ?? null, id);
    return id;
  };
  const rnd = (arr, i) => arr[i % arr.length];
  const ids = [];
  // Imagem fictícia usada como documento enviado pelo cliente
  const SAMPLE_DOC = 'iVBORw0KGgoAAAANSUhEUgAAAPAAAACWCAIAAABvmpKCAAABsUlEQVR42u3cMQ5AQBRF0VmMPVmxRKVUqZR6orQDiQhexknOCrjVz8uUpu2gGsUnQNAgaBA0CBpBg6BB0CBoEDSCBkGDoEHQIGgEDYIGQYOgQdAIGgQNggZBg6ARNAgaPgl63XaohqARNAgaBA2CRtAgaBA0CBoEjaBB0CBoEDQIGkGf6YcRXiNoBC1oBA2ChrCgwdmOUNO8BBI0ghY0gkbQgkbQgkbQgkbQgha0oBG0oBF0YtDWBTXJDNo4CUELGkELWtCCRtDBQePK4WyHoAWNoAWNoP1XQQsaQQsaQQsaQQsaQSNoQSNoe2hsOQSNoAWNoAUtaEEjaFcOXDkEjaAFjaARtKARtKARtKARtKARNIIWNIIWNIK25cDbdoJG0IIWtKARtKARtPehceUQNIJG0IJG0IJG0IJG0IIWtKARtKARtKARtKARtC2HLYdxEoIWNFwiaAQtaH4bNCQTNIIGQYOgQdAIGgQNggZBg6ARtC0H96YUgkbQgkbQgkbQgha0KwcIGgQNgkbQIGgQNAgaBI2gQdBgywEea0TQgkbQvjKCBu9Dg6ARNAgaBA3POgC0qxx3509tawAAAABJRU5ErkJggg==';
  const PDF = Buffer.from('%PDF-1.4 comprovante de pagamento ficticio').toString('base64');

  /** Avança o negócio etapa por etapa, cumprindo os critérios de entrada de cada uma (como o especialista faria). */
  function advance(owner, contactId, opp, key, i) {
    const upto = ORDER.indexOf(key);
    let r1Task = null;
    let r2Task = null;
    for (let k = 1; k <= upto; k++) {
      const st = ORDER[k];
      const when = ago(12 - k * 2 + (i % 2), 9 + k);
      const future = new Date(Date.now() + ((i % 3) + 1) * DAY / 2).toISOString();
      if (st === 'tentativa') {
        activities.createActivity(db, owner, { contact_id: contactId, opportunity_id: opp.id, type: 'tentativa_sem_atendimento', result: 'nao_atendida', occurred_at: when });
        if (i % 3 === 1) activities.createActivity(db, owner, { contact_id: contactId, opportunity_id: opp.id, type: 'direct_enviado', notes: 'Direct pelo Instagram depois do anúncio.', occurred_at: when });
      }
      if (st === 'qualificado') {
        activities.createActivity(db, owner, { contact_id: contactId, opportunity_id: opp.id, type: 'ligacao_realizada', result: 'atendida', duration: 240 + i * 11, notes: 'Conversa sobre objetivo, prazo e parcela possível.', occurred_at: when });
        // Triagem (6 perguntas) e qualificação preenchida (o lead passa de Tentativa para Qualificação)
        opps.saveTriage(db, owner, opp.id, { interesse: 'sim', dor: 'sim', dor_descricao: rnd(['Paga aluguel e quer a casa própria', 'Quer trocar o carro sem financiamento', 'Quer investir em imóvel'], i), impacto: rnd(['curto', 'medio', 'imediato'], i), decisor: rnd(['sim', 'compartilhado'], i), faixa_investimento: rnd(['1000_2000', '2000_5000', '500_1000'], i), faixa_renda: rnd(['6k_10k', '10k_20k', '20k_40k'], i) });
        opps.concludeQualification(db, owner, opp.id, { fields: {
          objective_type: i % 3 ? 'aquisicao' : 'investimento', urgency: rnd(['curto', 'medio', 'longo'], i), installment_max: 1500 + i * 50, term_months: 200,
          strategy: rnd(['aquisicao', 'planejamento', 'formacao_patrimonial'], i), product_type: 'primario', employment_type: rnd(['clt', 'pj', 'empresario'], i), has_fgts: i % 2 ? 'sim' : 'nao',
          credit_purpose_type: rnd(['moradia', 'imovel_investimento', 'terreno_construcao'], i), installment_min: 1200 + i * 40, has_bid_resources: rnd(['sim', 'nao', 'nao_sabe'], i), credit_category: 'imovel',
          housing_purpose: rnd(['morar', 'investir', 'morar'], i), pays_rent: i % 3 ? 'sim' : 'nao', rent_value: i % 3 ? 2200 + i * 50 : undefined,
          has_property: i % 4 === 1 ? 'sim' : 'nao', property_type: i % 4 === 1 ? rnd(['apartamento', 'casa', 'terreno'], i) : undefined,
          property_value: i % 4 === 1 ? 420000 + i * 10000 : undefined, property_free_liens: i % 4 === 1 ? (i % 8 === 1 ? 'sim' : 'nao') : undefined,
          ...(rnd(['sim', 'nao', 'nao_sabe'], i) === 'sim' ? { bid_own_resources: 30000 + i * 2500, bid_source: rnd(['reserva', 'fgts', 'reserva_fgts'], i) } : {}),
        } });
      }
      if (st === 'r1') {
        const last = upto === k;
        if (last && i === 4) {
          // R1 com no-show (NS no cartão): o cliente faltou e a reunião ainda não foi remarcada
          r1Task = meet(owner, contactId, opp, 'r1', ago(1, 14));
        } else if (last && i === 14) {
          // R1 remarcada (R no cartão): a primeira ficou como remarcada e a nova está marcada, com presença confirmada
          const first = meet(owner, contactId, opp, 'r1', ago(2, 15));
          tasks.updateTask(db, owner, first, { action: 'concluir', outcome: 'remarcada', notes: 'Cliente pediu para mudar o horário.' });
          r1Task = meet(owner, contactId, opp, 'r1', future, { from: first, confirmed: true });
        } else r1Task = meet(owner, contactId, opp, 'r1', last ? future : when, { confirmed: last && i % 2 === 0 });
      }
      if (st === 'r2') {
        tasks.updateTask(db, owner, r1Task, { action: 'concluir', outcome: 'realizada', notes: 'Cliente quer imóvel para morar em até 3 anos; tem FGTS.' });
        opps.updateOpportunity(db, owner, opp.id, { decision_maker: rnd(['sozinho', 'conjuge'], i), financial_moment: rnd(['organizado_reserva', 'organizado_sem_reserva', 'apertado'], i), had_consortium: i % 4 === 0 ? 'sim' : 'nao', existing_consortium_admin: i % 4 === 0 ? 'Administradora anterior' : null, existing_consortium_value: i % 4 === 0 ? 120000 : null, has_financing: 'nao', decision_notes: i % 2 ? 'Decide com a esposa.' : null });
        r2Task = meet(owner, contactId, opp, 'r2', upto === k ? future : when);
      }
      let proposal = null;
      if (st === 'negociacao') {
        tasks.updateTask(db, owner, r2Task, { action: 'concluir', outcome: 'realizada', notes: 'Proposta apresentada na R2; cliente vai avaliar com a família.' });
        const s = sims.createManual(db, owner, { contact_id: contactId, opportunity_id: opp.id, credit_value: 200000 + (i % 3) * 50000, term_months: 200, installment: 1400 + i * 10, strategy: 'aquisicao', payment_modality: 'parcela_integral' });
        const credit = 200000 + (i % 3) * 50000;
        const split = i % 2 === 1 ? { quota_split_strategy: 'grupos_diferentes', quota_values: [credit / 2, credit / 2], quota_split_notes: 'Duas cotas em grupos diferentes para dobrar as chances de contemplação por lance.' } : { quota_split_strategy: 'unica', quota_values: [credit] };
        proposal = proposals.createProposal(db, owner, { opportunity_id: opp.id, simulation_id: s.id, product_id: plans[i % plans.length], category: 'imovel', admin_fee_pct: 18, reserve_fund_pct: 2, readjustment_index: 'incc', readjustment_rate: 5.5, bid_deduction: 'parcela', contemplation_month: 12, valid_until: new Date(Date.now() + 15 * DAY).toISOString().slice(0, 10), status: 'apresentada', ...split });
      }
      opps.moveStage(db, owner, opp.id, { stage_id: stageId[st] });
      if (proposal) opp.proposal_id = proposal.id;
    }
    // R1 com no-show: registrado depois de entrar na coluna R1 (o cartão mostra NS)
    if (key === 'r1' && i === 4 && r1Task) tasks.updateTask(db, owner, r1Task, { action: 'concluir', outcome: 'nao_compareceu', notes: 'Cliente não entrou na reunião.' });
    // Próxima ação do negócio
    if (upto < 5) opps.updateOpportunity(db, owner, opp.id, { next_action: upto < 2 ? 'Nova tentativa de contato' : upto < 3 ? 'Agendar R1' : upto < 4 ? 'Confirmar a R1 com o cliente' : 'Preparar a R2 (proposta)', next_action_at: new Date(Date.now() + ((i % 4) - 1) * DAY).toISOString() });
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
          campaign: i % 3 === 0 ? rnd(['Imóvel sem juros', 'Planejamento 2027', 'Seguro de vida familiar'], i) : null,
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
      if (AREAS[i % AREAS.length] !== 'consorcio' && !['aceite', 'prevenda', 'venda'].includes(target)) opps.updateOpportunity(db, owner, opp.id, { business_area: AREAS[i % AREAS.length] });
      if (target === 'prospect') {
        if (i === 10) activities.createActivity(db, owner, { contact_id: id, type: 'tentativa_sem_atendimento', result: 'caixa_postal', occurred_at: ago(1) });
      } else {
        advance(owner, id, opp, ORDER.includes(target) ? target : 'negociacao', i);
      }
      // Respostas dos clientes às propostas (probabilidade de fechamento)
      if (target === 'negociacao' && opp.proposal_id) proposals.registerResponse(db, owner, opp.proposal_id, { response: i === 6 ? 'duvidas' : 'sem_resposta' });
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
        opps.moveStage(db, owner, opp.id, { stage_id: stageId.perdido, lost_reason: 'empresa', lost_notes: 'Optou por financiamento bancário.' });
        contacts.updateContact(db, admin, id, { active: false, inactive_reason: 'Optou por financiamento bancário.' });
      }
      if (i === 5 || i === 15) {
        // Propostas recusadas com o motivo (base para o trabalho de recuperação)
        const pr = proposals.createProposal(db, owner, { opportunity_id: opp.id, product_id: pImovel, category: 'imovel', credit_value: i === 5 ? 250000 : 180000, valid_until: new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10), status: 'apresentada' });
        proposals.changeStatus(db, owner, pr.id, i === 5
          ? { status: 'recusada', refusal_reason: 'nao_e_momento', refusal_notes: 'Quer primeiro quitar o carro; pediu para falar em 2 meses.', retake_at: new Date(Date.now() + 60 * DAY).toISOString().slice(0, 10) }
          : { status: 'recusada', refusal_reason: 'financiamento', refusal_notes: 'Banco liberou financiamento com entrada menor.' });
      }
      if (i === 12) opps.moveStage(db, owner, opp.id, { stage_id: stageId.nutricao, pause_reason: 'Vai decidir depois do bônus do fim do ano.', return_at: new Date(Date.now() + 60 * DAY).toISOString().slice(0, 10) });
      if (i === 12) contacts.updateContact(db, admin, id, { referred_by_id: ids[9] });
    });

    // Funil de perdidos: leads perdidos em etapas diferentes, cada um com o motivo (MP); o último segue aberto na R2
    [['Otávio Nogueira', 'tentativa', 'sem_contato', '6 tentativas sem resposta em 10 dias.'], ['Priscila Duarte', 'qualificado', 'preco', 'Achou a parcela alta para o momento.'],
      ['Renato Siqueira', 'r1', 'momento', 'Vai esperar a venda do carro.'], ['Simone Castro', 'r2', 'decisor', 'O sócio não aprovou o investimento.'], ['Ulisses Prado', 'qualificado', 'perfil', 'Busca crédito imediato (perfil de financiamento).'],
      ['Tiago Monteiro', 'r2', null, null]]
      .forEach(([name, upto, reason, notes], k) => {
        const owner = k % 2 ? c2 : c1;
        const { id } = contacts.createContact(db, owner, { kind: 'PF', name, relationship: 'lead', phone1: `(11) 96666-20${k}0`, email: `${name.split(' ')[0].toLowerCase()}.perdido@example.com`, origin: rnd(origins, k + 3), owner_id: owner.id, credit_value: 180000 + k * 40000 }, { skipDuplicateCheck: true });
        const opp = db.prepare('SELECT * FROM opportunities WHERE contact_id = ?').get(id);
        advance(owner, id, opp, upto, 20 + k);
        if (!reason) return; // R2 agendada, ainda sem proposta (aberto)
        opps.moveStage(db, owner, opp.id, { stage_id: stageId.perdido, lost_reason: reason, lost_notes: notes });
        db.prepare('UPDATE opportunities SET closed_at = ? WHERE id = ?').run(ago(k * 4 + 1, 16), opp.id);
      });

    // Produtos (cross-sell e up-sell) mapeados nos leads e um diagnóstico financeiro concluído
    const leadProducts = require('./services/leadproducts');
    const prodOwner = (cid) => db.prepare('SELECT u.* FROM contacts c JOIN users u ON u.id = c.owner_id WHERE c.id = ?').get(cid) || admin;
    [[3, 'seguros', 'vida_familia', 'Proteção da renda: dois filhos pequenos e a parcela do consórcio.', 500000, null, 'potencial'],
      [3, 'investimentos', 'reserva_emergencia', 'Tem a reserva parada na poupança.', null, '50k_200k', 'potencial'],
      [4, 'planejamento', 'aposentadoria', 'Quer se aposentar aos 55 anos.', null, null, 'em_andamento'],
      [5, 'consorcio', 'veiculo', 'Trocar o carro da família em 2 anos.', 120000, null, 'potencial'],
      [6, 'investimentos', 'migracao_carteira', 'Carteira de R$ 350 mil no banco, sem acompanhamento.', 350000, '200k_500k', 'em_andamento'],
      [6, 'seguros', 'residencial_empresarial', 'Seguro da loja vence em março.', 3200, null, 'potencial']]
      .forEach(([i, area, sub, desc, value, range, status]) => {
        if (!ids[i]) return;
        leadProducts.saveProduct(db, prodOwner(ids[i]), { contact_id: ids[i], area, sub_type: sub, description: desc, value, value_range: range, status });
      });
    if (ids[4]) {
      const diagnostics = require('./services/diagnostics');
      const dOwner = prodOwner(ids[4]);
      const d = diagnostics.start(db, dOwner, { contact_id: ids[4] });
      diagnostics.saveFromTool(db, dOwner, d.id, { data: {
        id: `crm-${d.id}`, versaoDados: 10, coletaFinalizada: true, atualizadoEm: ago(1), cadastro: { nome: db.prepare('SELECT name FROM contacts WHERE id = ?').get(ids[4]).name },
        objetivos: [{ titulo: 'Reserva de emergência de 6 meses' }, { titulo: 'Imóvel para morar em 3 anos' }, { titulo: 'Aposentadoria aos 55' }],
        plano: [{ titulo: 'Montar a reserva com 15% da renda', prazo: 'curto' }, { titulo: 'Consórcio de imóvel com lance planejado', prazo: 'médio' }, { titulo: 'Seguro de vida para proteger a renda', prazo: 'curto' }, { titulo: 'Previdência privada (PGBL)', prazo: 'longo' }],
        dependentes: [{ nome: 'Filho' }], imoveis: [], moveis: [{ tipo: 'Carro' }], financiamentos: [], emprestimos: [], cartoes: [{ banco: 'Cartão' }],
        recomendacoes: [{ nome: 'Paulo Mendes', contato: '(11) 98888-1201' }, { nome: 'Carla Nunes', contato: 'carla.nunes@example.com' }],
      }, precificacao: { valor: 4800, pix_total: 4560, cartao_total: 5172.38, parcelas: 10, parcela: 517.24, condicao: 'pix' },
      resultado: {
        estrela: { nota: 58, pilares: [['organizacao', 'Organização', 72, 'ok'], ['comportamento', 'Comportamento', 64, 'atencao'], ['protecao', 'Proteção', 31, 'critico'], ['reserva', 'Reserva', 45, 'atencao'],
          ['dividas', 'Dívidas', 80, 'ok'], ['futuro', 'Futuro', 38, 'critico'], ['patrimonio', 'Patrimônio', 66, 'atencao'], ['legado', 'Legado', 50, 'atencao']].map(([id, nome, pct, status]) => ({ id, nome, pct, status })) },
        matriz: [
          { titulo: 'Seguro de vida', area: 'Proteção', produto: 'Seguro', prioridade: 'Alta', prazo: 'Curto', potencial: 9, detalhe: 'Seguro de vida com capital de R$ 620 mil para proteger a renda da família.' },
          { titulo: 'Consórcio de imóvel', area: 'Patrimônio', produto: 'Consórcio', prioridade: 'Alta', prazo: 'Médio', potencial: 8, detalhe: 'Carta de R$ 450 mil com lance planejado para o imóvel em 3 anos, sem juros.' },
          { titulo: 'Reserva de emergência', area: 'Reserva', produto: 'Investimento', prioridade: 'Média', prazo: 'Curto', potencial: 6, detalhe: 'Completar 6 meses de despesas em liquidez diária.' },
          { titulo: 'Plano de independência financeira', area: 'Futuro', produto: 'Investimento', prioridade: 'Média', prazo: 'Longo', potencial: 5, detalhe: 'Investir R$ 1.800/mês para a aposentadoria aos 55 anos.' },
          { titulo: 'Previdência (PGBL)', area: 'Fiscal/Tributário', produto: 'Previdência', prioridade: 'Baixa', prazo: 'Médio', potencial: 4, detalhe: 'Usar o PGBL para deduzir até 12% da renda no IR.' },
        ],
        bussola: { nota: 54, norte: { id: 'protecao', nome: 'Liberdade financeira', status: 'critico', resumo: 'Sem seguro de vida e com reserva de 2 meses.', acao: 'Contratar o seguro de vida e completar a reserva' },
          dimensoes: [{ id: 'organizacao', nome: 'Organização', nota: 70, status: 'ok', resumo: 'Sobra de 18% da renda.' }, { id: 'patrimonio', nome: 'Patrimônio', nota: 58, status: 'atencao', resumo: 'Imóvel próprio em 3 anos.' },
            { id: 'liberdade', nome: 'Liberdade financeira', nota: 34, status: 'critico', resumo: 'Proteção e reserva abaixo do necessário.' }, { id: 'ativos', nome: 'Gestão de ativos', nota: 52, status: 'atencao', resumo: 'R$ 48 mil em reserva e investimentos.' }] },
      } });
      diagnostics.generateProposal(db, dOwner, d.id, { model: 'implementacao' });
    }
    // Arquivos do lead (aba Arquivos): extrato da carteira para avaliar a migração
    if (ids[6]) {
      record.uploadAttachment(db, prodOwner(ids[6]), ids[6], { filename: 'extrato-carteira-outubro.pdf', content_base64: PDF, doc_type: 'extrato', description: 'Extrato da carteira de investimentos — outubro', purpose: 'Avaliar a migração da carteira para a assessoria', notes: 'Enviado pelo cliente por e-mail.' });
    }
    // Leads das LPs (consórcio e planejamento) com UTM: aparecem em Ferramentas › LPs e rastreio
    const landing = require('./services/landing');
    const lpLeads = [
      { nome: 'Otávio Mendes', email: 'otavio.lp@exemplo.com', celular: '51991110001', categoria: 'Imóvel', modo: 'credito', credito: 350000, parcela: 2100, prazo: 200, preferencia_contato: 'WhatsApp', melhor_horario: 'Tarde', aceite_privacidade: true, aceite_notificacoes: true, origem: 'LP Simulador', pagina: 'https://veroconsorciosbr.com.br/', utm: { utm_source: 'meta', utm_medium: 'pago_social', utm_campaign: 'consorcio_imovel_2026-11', utm_content: 'video-casa-15s', fbclid: 'demo-fb-1' }, rastreio: { lp: 'consorcios', area: 'consorcio', visitas: 1 } },
      { tipo: 'alavancagem_financeira', nome: 'Helena Prado', email: 'helena.lp@exemplo.com', telefone: '51991110002', credito: 800000, inicio: '1 a 3 meses', preferencia_contato: 'Ligação', melhor_horario: 'Manhã', aceite_privacidade: true, origem: 'LP Mecanismo de Alavancagem', pagina: 'https://veroconsorciosbr.com.br/', utm: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'consorcio_alavancagem_2026-11', utm_term: 'investir-com-consorcio', gclid: 'demo-g-1' } },
      { tipo: 'planejamento_financeiro', nome: 'Caio Ribas', email: 'caio.lp@exemplo.com', celular: '51991110003', objetivo: 'Sair das dívidas', prazo: 'Até 6 meses', renda_familiar: 'De R$ 7.000 a R$ 10.000', consegue_guardar: 'Não', preferencia_contato: 'WhatsApp', melhor_horario: 'Noite', aceite_privacidade: true, aceite_contato: true, origem: 'LP Planejamento · topo', pagina: 'https://veroconsorciosbr.com.br/lp-planejamento.html', utm: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'planejamento_dividas_2026-11', utm_term: 'sair-das-dividas' } },
      { tipo: 'planejamento_financeiro', nome: 'Lívia Torres', email: 'livia.lp@exemplo.com', celular: '51991110004', objetivo: 'Começar a investir', prazo: '1 a 3 anos', renda_familiar: 'Acima de R$ 15.000', consegue_guardar: 'Sim', preferencia_contato: 'WhatsApp', melhor_horario: 'Manhã', aceite_privacidade: true, aceite_contato: true, origem: 'LP Planejamento · popup_jornada', pagina: 'https://veroconsorciosbr.com.br/lp-planejamento.html', rastreio: { lp: 'planejamento', area: 'planejamento', ultimo_toque: { canal: { fonte: 'instagram', meio: 'social' } }, primeiro_toque: { canal: { fonte: 'instagram', meio: 'social' } } } },
    ];
    for (const b of lpLeads) landing.receive(db, b, { ip: 'demo' });
    // Base da IA Vero: itens cadastrados pela liderança
    const assistant = require('./services/assistant');
    assistant.saveKnowledge(db, gestor, { kind: 'objecao', title: 'Vou falar com meu sócio', content: 'Faz todo sentido, {nome}. Que tal marcarmos 20 minutos com vocês dois? Assim eu explico direto para ele e vocês decidem juntos, sem telefone sem fio.' });
    assistant.saveKnowledge(db, gestor, { kind: 'dica', title: 'Confirmação da R1', content: 'Confirme a R1 na véspera pelo WhatsApp e no dia com 1 hora de antecedência: reduz o no-show pela metade.' });
    assistant.saveKnowledge(db, gestor, { kind: 'mensagem', title: 'Retomar depois do no-show', content: 'Oi, {nome}! Senti sua falta na nossa conversa. Imprevistos acontecem: posso te mandar dois horários para remarcarmos?', stage_key: 'r1' });

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
  seedCommsDemo(db, { admin, gestor, c1, c2, PDF, ids });
  finance.overdueSweep(db);
  sales.presaleSweep(db);
  sales.commissionSweep(db);
  seedProposalLinksDemo(db, { admin });
  // Ingresso no CRM antes do primeiro contato (as atividades do demo são retroativas)
  for (const c of db.prepare('SELECT id, created_at, first_contact_at FROM contacts WHERE first_contact_at IS NOT NULL AND first_contact_at < created_at').all()) {
    db.prepare('UPDATE contacts SET created_at = ? WHERE id = ?').run(new Date(Date.parse(c.first_contact_at) - (12 + ((c.id * 17) % 90)) * 60000).toISOString(), c.id);
  }
  // Atribuição no cadastro (o primeiro contato vem depois) e tempo típico em cada etapa (as movimentações do demo
  // acontecem no mesmo instante): base para o TMR e o tempo médio por etapa do BI e dos relatórios
  db.prepare('UPDATE contacts SET assigned_at = created_at WHERE assigned_at IS NOT NULL AND first_contact_at IS NOT NULL AND assigned_at > first_contact_at').run();
  // Ganhos e perdidos espalhados pela última semana (gráfico de 7 dias do painel inicial)
  for (const o of db.prepare("SELECT id, status FROM opportunities WHERE status IN ('ganha','perdida') ORDER BY id").all()) {
    const back = o.status === 'ganha' ? (o.id * 3) % 5 : (o.id * 5) % 7;
    db.prepare('UPDATE opportunities SET closed_at = ? WHERE id = ?').run(new Date(Date.now() - back * DAY - ((o.id * 7) % 5) * 3600000).toISOString(), o.id);
  }
  // O negócio nasce com o cadastro (ciclo de vendas = da entrada do lead ao ganho)
  db.prepare('UPDATE opportunities SET created_at = (SELECT c.created_at FROM contacts c WHERE c.id = opportunities.contact_id) WHERE created_at > (SELECT c.created_at FROM contacts c WHERE c.id = opportunities.contact_id)').run();
  const typical = { prospect: 0.2, lead: 0.15, tentativa: 1.2, qualificado: 1.8, r1: 3.5, r2: 4, negociacao: 6.5 };
  for (const h of db.prepare('SELECT h.id, s.key FROM stage_history h JOIN pipeline_stages s ON s.id = h.from_stage_id').all()) {
    db.prepare('UPDATE stage_history SET seconds_in_previous = ? WHERE id = ?').run(Math.round(((typical[h.key] ?? 1) * DAY * (0.7 + ((h.id * 37) % 60) / 100)) / 1000), h.id);
  }
}

/**
 * Propostas: carta contemplada gerada e links on-line enviados aos clientes (aguardando, lido com tempo e "quer avançar").
 */
function seedProposalLinksDemo(db, { admin }) {
  const neg = db.prepare("SELECT o.id FROM opportunities o JOIN pipeline_stages s ON s.id = o.stage_id WHERE s.key = 'negociacao' AND o.status = 'aberta' ORDER BY o.id DESC LIMIT 1").get();
  if (neg) {
    proposals.createProposal(db, admin, { opportunity_id: neg.id, area: 'consorcio', consortium_kind: 'contemplada', category: 'imovel', credit_value: 320000, entry_value: 64000, remaining_installments: 132, initial_installment: 2380, description: 'Grupo 4521, cota 118 (contemplada por lance). Transferência em até 15 dias após a aprovação do cadastro.', valid_until: new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10) });
  }
  // Propostas de outras áreas já enviadas há alguns dias (régua em andamento: passos anteriores feitos)
  const negs = db.prepare("SELECT o.id, o.contact_id FROM opportunities o JOIN pipeline_stages s ON s.id = o.stage_id WHERE s.key = 'negociacao' AND o.status = 'aberta' ORDER BY o.id").all();
  [
    { area: 'seguros', description: 'Seguro de vida: capital de R$ 500 mil com cobertura de invalidez e doenças graves. Prêmio mensal de R$ 186.', credit_value: 500000, days: 6 },
    { area: 'investimentos', description: 'Migração da carteira de R$ 350 mil para a assessoria (perfil moderado), com plano de aportes mensais.', credit_value: 350000, days: 11 },
    { area: 'seguros', description: 'Seguro empresarial da loja: incêndio, roubo e responsabilidade civil. Prêmio anual de R$ 3.200.', credit_value: 3200, days: 16 },
  ].forEach((x, k) => {
    const o = negs[k % Math.max(1, negs.length)];
    if (!o) return;
    const pr = proposals.createProposal(db, admin, { opportunity_id: o.id, area: x.area, description: x.description, credit_value: x.credit_value });
    const sent = new Date(Date.now() - x.days * DAY);
    sent.setUTCHours(13, 30, 0, 0);
    db.prepare("UPDATE proposals SET status = 'apresentada', presented_at = ?, sent_channel = 'whatsapp', created_at = ? WHERE id = ?").run(sent.toISOString(), new Date(sent.getTime() - 3600000).toISOString(), pr.id);
    const row = db.prepare('SELECT * FROM proposals WHERE id = ?').get(pr.id);
    proposals.startCadence(db, admin, row, sent.toISOString());
    db.prepare("UPDATE tasks SET status = 'concluida', completed_at = due_at, updated_at = due_at WHERE proposal_id = ? AND status = 'pendente' AND due_at < ?").run(pr.id, new Date(Date.now() - 20 * 3600000).toISOString());
  });
  const rows = db.prepare("SELECT id, presented_at FROM proposals WHERE status IN ('apresentada','em_analise') ORDER BY id").all();
  rows.forEach((p, k) => {
    const link = proposals.ensureLink(db, admin, p.id);
    if (k % 3 === 0) {
      // Enviado, aguardando a leitura
      if (Date.now() - Date.parse(p.presented_at || 0) < 6 * 3600000) db.prepare('UPDATE proposals SET presented_at = ?, created_at = ?, link_created_at = ? WHERE id = ?').run(new Date(Date.now() - 3 * 3600000).toISOString(), new Date(Date.now() - 4 * 3600000).toISOString(), new Date(Date.now() - 3 * 3600000).toISOString(), p.id);
      return;
    }
    const v = proposals.publicOpen(db, link.token, { device: k % 2 ? 'mobile' : 'desktop' });
    proposals.publicEvent(db, link.token, { view: v.view_id, seconds: 100, scroll: 55 + ((k * 13) % 45), sections: ['resumo', 'valores', 'condicoes', 'como_funciona'] });
    proposals.publicEvent(db, link.token, { view: v.view_id, seconds: 40 + k * 25 });
    if (k % 4 === 1) {
      const v2 = proposals.publicOpen(db, link.token, { device: 'mobile' });
      proposals.publicEvent(db, link.token, { view: v2.view_id, seconds: 75, scroll: 100, sections: ['estrategia', 'avancar', 'consultor'] });
    }
    if (k % 3 === 2) proposals.publicAdvance(db, link.token, { note: 'Gostei da proposta! Pode me ligar amanhã de manhã?' });
    // Leitura algumas horas depois do envio (as enviadas agora pela demonstração passam a ter sido enviadas pela manhã)
    let base = Date.parse(p.presented_at || new Date().toISOString());
    if (Date.now() - base < 6 * 3600000) {
      base = Date.now() - (6 + k) * 3600000;
      db.prepare('UPDATE proposals SET presented_at = ?, created_at = ?, generated_at = NULL WHERE id = ?').run(new Date(base).toISOString(), new Date(base - 2 * 3600000).toISOString(), p.id);
      p.presented_at = new Date(base).toISOString();
    }
    const first = new Date(Math.min(Date.now() - 3600000, base + (2 + k) * 3600000)).toISOString();
    db.prepare('UPDATE proposals SET link_first_opened_at = ?, link_created_at = ? WHERE id = ?').run(first, p.presented_at || first, p.id);
    db.prepare('UPDATE proposal_views SET started_at = ?, last_seen_at = ? WHERE proposal_id = ? AND id = (SELECT MIN(id) FROM proposal_views WHERE proposal_id = ?)').run(first, first, p.id, p.id);
  });
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

/**
 * Comunicação e calendário: one-on-ones marcados pela líder, conversas do Inbox, tickets em várias situações e
 * conversas do WhatsApp da empresa em modo de teste (sem a conta da Meta conectada).
 */
function seedCommsDemo(db, { admin, gestor, c1, c2, PDF, ids }) {
  const calendar = require('./services/calendar');
  const comms = require('./services/comms');
  const wa = require('./services/whatsapp');
  const at = (days, h, m = 0) => {
    const d = new Date(Date.now() + days * DAY);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  // One-on-ones da líder com cada especialista (um já realizado, outros na semana)
  calendar.scheduleOneOnOne(db, gestor, { user_id: c1.id, start_at: at(1, 9), end_at: at(1, 9, 30), agenda: 'Metas do mês, pipeline e R1 da semana.' });
  calendar.scheduleOneOnOne(db, gestor, { user_id: c2.id, start_at: at(2, 10), end_at: at(2, 10, 30), agenda: 'No-show da R1 e plano de remarcação.' });
  const done = calendar.scheduleOneOnOne(db, gestor, { user_id: c1.id, start_at: at(3, 16), end_at: at(3, 16, 45) }).id;
  db.prepare("UPDATE tasks SET due_at = ?, ends_at = ?, status = 'concluida', completed_at = ? WHERE id = ?").run(at(-6, 9), at(-6, 9, 30), at(-6, 9, 30), done);

  // Inbox: conversa direta e grupo do time
  const d1 = comms.openDirect(db, c1, gestor.id).id;
  comms.sendMessage(db, c1, d1, { body: 'Gestora, o cliente da proposta de R$ 250 mil pediu para baixar a parcela. Posso refazer com lance embutido?' });
  comms.sendMessage(db, gestor, d1, { body: 'Pode sim. Mostra os dois cenários e me manda antes de enviar.' });
  comms.sendMessage(db, c1, d1, { body: 'Combinado, segue o rascunho.', file: { filename: 'proposta-rascunho.pdf', content_base64: PDF } });
  const g = comms.createGroup(db, gestor, { title: 'Time Centro', member_ids: [c1.id, c2.id, admin.id] }).id;
  comms.sendMessage(db, gestor, g, { body: 'Bom dia, time! Hoje às 9h alinhamento rápido das R1 da semana.' });
  comms.sendMessage(db, c2, g, { body: 'Fechado. Tenho 3 R1 confirmadas.' });
  const d2 = comms.openDirect(db, admin, c2.id).id;
  comms.sendMessage(db, admin, d2, { body: 'Parabéns pela venda de ontem! 👏' });

  // Tickets: um aberto para o administrador (marketing), um devolvido ao especialista e um concluído
  const due = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
  comms.createTicket(db, c1, { title: 'Arte para campanha "Imóvel sem juros"', description: 'Post 1080x1080 e versão stories com a taxa da campanha e o logo da administradora parceira. Uso no Instagram e no WhatsApp.', assignee_id: admin.id, category: 'marketing', priority: 'alta', due_date: due(3), files: [{ filename: 'briefing-campanha.pdf', content_base64: PDF }] });
  const t2 = comms.createTicket(db, c2, { title: 'Liberar acesso ao portal da administradora', description: 'Preciso do acesso ao portal para acompanhar as assembleias dos meus clientes.', assignee_id: gestor.id, category: 'ti', priority: 'normal', due_date: due(2) }).id;
  comms.ticketAction(db, gestor, t2, { action: 'iniciar' });
  comms.ticketAction(db, gestor, t2, { action: 'devolver', body: 'Me envie o seu CPF e o e-mail que vai usar no portal.' });
  const t3 = comms.createTicket(db, gestor, { title: 'Revisar contrato de parceria', description: 'Conferir as cláusulas de comissão antes da renovação.', assignee_id: admin.id, category: 'juridico', priority: 'normal', due_date: due(-2) }).id;
  comms.ticketAction(db, admin, t3, { action: 'concluir', body: 'Revisado: cláusula 7 ajustada. Versão final anexa.', files: [{ filename: 'contrato-revisado.pdf', content_base64: PDF }] });

  // WhatsApp em modo de teste: conversas recebidas de leads e de um número sem cadastro
  db.prepare("INSERT INTO settings (key, value) VALUES ('whatsapp_sandbox', 'true') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('whatsapp_template_name', '\"retomar_contato\"') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  const ts = (minAgo) => String(Math.floor((Date.now() - minAgo * 60000) / 1000));
  const msg = (from, name, id, text, minAgo) => ({ entry: [{ changes: [{ value: { contacts: [{ wa_id: from, profile: { name } }], messages: [{ from, id, timestamp: ts(minAgo), type: 'text', text: { body: text } }] } }] }] });
  const req = { headers: {}, rawBody: '' };
  const leads = ids.slice(1, 4).map((id) => db.prepare('SELECT id, name, whatsapp, phone1, owner_id FROM contacts WHERE id = ?').get(id));
  const lines = ['Oi! Vi o anúncio do consórcio de imóvel, pode me explicar como funciona?', 'Boa tarde, recebi a proposta. Dá para fazer em 180 meses?', 'Consigo usar o FGTS no lance?'];
  leads.forEach((c, i) => {
    const w = wa.toWaId(c.whatsapp || c.phone1);
    if (!w) return;
    wa.receiveWebhook(db, req, msg(w, c.name.split(' ')[0], `wamid.demo.in${i}`, lines[i], 30 + i * 90));
  });
  if (leads[0]) {
    const conv = db.prepare('SELECT id FROM wa_conversations WHERE contact_id = ?').get(leads[0].id);
    const owner = db.prepare('SELECT * FROM users WHERE id = ?').get(leads[0].owner_id) || c1;
    if (conv) wa.sendMessage(db, { ...owner, modules: null }, conv.id, { body: `Olá, ${leads[0].name.split(' ')[0]}! Claro: no consórcio você paga parcelas sem juros e é contemplado por sorteio ou lance. Posso te ligar em 5 minutos?` }).catch(() => {});
  }
  wa.receiveWebhook(db, req, msg('5511955554321', 'Marcos', 'wamid.demo.unknown', 'Olá, quero saber sobre consórcio de veículo.', 12));
  // Com o conector real (teste no computador ou VPS), os números fictícios do modo de teste ficam de fora
  if (!process.env.EVOLUTION_API_URL) {
    seedLiteDemo(db, { c1, c2 });
    seedAgentDemo(db, { admin, c1 });
  }
}

/**
 * WhatsApp Lite em modo de teste: o Especialista 1 conectou o próprio número (QR Code simulado), a líder acompanha e o
 * Especialista 2 tem "Só ver". As conversas são com leads do pipeline do Especialista 1 (ícone do WhatsApp no card).
 */
function seedLiteDemo(db, { c1, c2 }) {
  const lite = require('./services/walite');
  db.prepare("INSERT INTO settings (key, value) VALUES ('walite_sandbox', 'true') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  const u = (x) => ({ ...x, modules: null });
  // No modo de teste a criação não espera o servidor: a instância já está gravada quando a função retorna
  lite.createInstance(db, u(c1), { headers: {} }, { name: 'Meu WhatsApp' }).catch(() => {});
  const id = db.prepare('SELECT id FROM wa_instances WHERE owner_id = ? ORDER BY id DESC LIMIT 1').get(c1.id)?.id;
  if (!id) return;
  lite.simulateConnect(db, u(c1), id, { phone: '51990000003' });
  lite.setMemberAccess(db, u(c1), id, { user_id: c2.id, level: 'ver' });
  const { webhook_token: token } = db.prepare('SELECT webhook_token FROM wa_instances WHERE id = ?').get(id);
  const wa = require('./services/whatsapp');
  const leads = db.prepare(`SELECT c.id, c.name, c.whatsapp, c.phone1 FROM contacts c
    WHERE c.owner_id = ? AND COALESCE(c.whatsapp, c.phone1) IS NOT NULL
      AND EXISTS (SELECT 1 FROM opportunities o WHERE o.contact_id = c.id AND o.status = 'aberta')
      AND NOT EXISTS (SELECT 1 FROM wa_conversations w WHERE w.contact_id = c.id)
    ORDER BY c.id LIMIT 3`).all(c1.id);
  const at = (minAgo) => Math.floor((Date.now() - minAgo * 60000) / 1000);
  let n = 0;
  const up = (peer, fromMe, text, minAgo, pushName) => {
    lite.receiveWebhook(db, token, { event: 'messages.upsert', data: { key: { remoteJid: `${peer}@s.whatsapp.net`, fromMe, id: `LITE.DEMO.${id}.${++n}` }, pushName, message: { conversation: text }, messageTimestamp: at(minAgo) } });
  };
  const scripts = [
    [[false, 'Oi! Aqui é a {n}. Vocês trabalham com consórcio para reforma?', 26 * 60], [true, 'Oi, {n}! Trabalhamos sim: a carta de crédito pode ser usada em reforma. Qual valor você imagina?', 26 * 60 - 4], [false, 'Uns R$ 80 mil 🙂', 26 * 60 - 9], [true, 'Perfeito! Te mando duas simulações e já deixo uma conversa marcada para amanhã às 10h, pode ser?', 26 * 60 - 11], [false, 'Pode sim, obrigada!', 18]],
    [[true, '{n}, bom dia! Conseguiu ver a proposta que te enviei?', 3 * 60], [false, 'Vi sim. Achei a parcela um pouco alta, dá para ver com lance embutido?', 47]],
    [[false, 'Boa tarde! Meu cunhado indicou vocês, ele foi contemplado no mês passado 👏', 9]],
  ];
  leads.forEach((c, i) => {
    const peer = wa.toWaId(c.whatsapp || c.phone1);
    const first = c.name.split(' ')[0];
    if (peer) for (const [me, text, min] of scripts[i] || []) up(peer, me, text.replace('{n}', first), min, first);
  });
}

/**
 * Agente de IA no número central (demonstração): o número "Central Vero" está ligado ao agente; uma conversa está com a
 * IA em andamento e outra já terminou com a R1 agendada e passou para o especialista. Sem a chave da Anthropic, a tela
 * mostra o que falta configurar.
 */
function seedAgentDemo(db, { admin, c1 }) {
  const lite = require('./services/walite');
  const u = (x) => ({ ...x, modules: null });
  lite.createInstance(db, u(admin), { headers: {} }, { name: 'Central Vero', only_known: false }).catch(() => {});
  const inst = db.prepare("SELECT id FROM wa_instances WHERE name = 'Central Vero' ORDER BY id DESC LIMIT 1").get();
  if (!inst) return;
  lite.simulateConnect(db, u(admin), inst.id, { phone: '5151990001000' });
  db.prepare("INSERT INTO settings (key, value) VALUES ('wa_agent', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify({ enabled: true, channel: 'lite', instance_id: inst.id, name: 'Vero', model: 'claude-opus-5-5', r1_minutes: 45, days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00', notice_hours: 2 }));
  const { createContact } = require('./services/contacts');
  const sys = { id: null, role: 'admin', name: 'IA Vero (WhatsApp)' };
  const minAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
  const mk = (name, phone) => createContact(db, sys, { kind: 'PF', name, phone1: phone, whatsapp: phone, origin: 'whatsapp', relationship: 'lead', owner_id: c1.id, create_opportunity: true,
    origin_details: { origin: 'whatsapp', platform: 'whatsapp', received_at: nowIsoDemo(), source_ref: 'wa_agent' } }, { system: true, skipDuplicateCheck: true, source: 'whatsapp', sourceLabel: 'pelo WhatsApp (agente de IA)' }).id;
  const conv = (contactId, peer, name, status, reason, msgs) => {
    const id = Number(db.prepare("INSERT INTO wa_conversations (wa_id, channel, instance_id, peer, contact_id, profile_name, assigned_to, ai_status, ai_reason, ai_updated_at, last_message_at, last_inbound_at, unread, created_at) VALUES (?, 'lite', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(`lite:${inst.id}:${peer}`, inst.id, peer, contactId, name, c1.id, status, reason, minAgo(msgs[msgs.length - 1][2]), minAgo(msgs[msgs.length - 1][2]), minAgo(msgs.filter((m) => m[0] === 'in').slice(-1)[0][2]), status === 'humano' ? 1 : 0, minAgo(msgs[0][2])).lastInsertRowid);
    const { insertActivity } = require('./services/activities');
    msgs.forEach(([dir, body, ago], i) => {
      const mid = Number(db.prepare("INSERT INTO wa_messages (conversation_id, wamid, direction, kind, body, status, ai, created_at, status_at) VALUES (?, ?, ?, 'text', ?, ?, ?, ?, ?)")
        .run(id, `AGENT.DEMO.${id}.${i}`, dir, body, dir === 'in' ? 'recebida' : 'lida', dir === 'out' ? 1 : 0, minAgo(ago), minAgo(ago)).lastInsertRowid);
      // Cada mensagem entra no histórico do lead (a mensagem enviada conta como tentativa de contato)
      insertActivity(db, { contact_id: contactId, type: dir === 'in' ? 'mensagem_recebida' : 'mensagem_enviada', channel: 'whatsapp', direction: dir === 'in' ? 'entrada' : 'saida', notes: body, occurred_at: minAgo(ago), source: 'whatsapp', external_id: `AGENT.DEMO.${id}.${i}`, user_id: null, ref_type: 'wa_message', ref_id: mid });
    });
    return id;
  };
  const log = (convId, contactId, action, detail, ago) => db.prepare('INSERT INTO wa_agent_log (conversation_id, contact_id, action, detail, tokens_in, tokens_out, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(convId, contactId, action, detail, 4200, 380, minAgo(ago));
  // 1) IA atendendo agora
  const j = mk('Juliana Prado', '51988776655');
  const cj = conv(j, '5551988776655', 'Juliana', 'ativa', 'Atendimento iniciado pela IA', [
    ['in', 'Oi! Vi o anúncio de consórcio para imóvel', 22],
    ['out', 'Olá, Juliana! Sou a Vero, assistente virtual da Vero Consórcios 😊 Me conta: você pensa em comprar, construir ou reformar?', 22],
    ['in', 'Comprar um apartamento, de preferência até o ano que vem', 18],
    ['out', 'Ótimo objetivo! E quanto você conseguiria investir por mês, mais ou menos?', 18],
  ]);
  log(cj, j, 'novo_lead', 'Juliana', 22);
  log(cj, j, 'respondeu', null, 18);
  // 2) Triagem completa, R1 agendada e conversa com o especialista
  const r = mk('Ricardo Souza', '51977665544');
  const cr = conv(r, '5551977665544', 'Ricardo', 'humano', 'R1 agendada', [
    ['in', 'Boa tarde, quero entender o consórcio de carro', 95],
    ['out', 'Boa tarde, Ricardo! Sou a Vero, assistente virtual da Vero Consórcios. Que carro você tem em mente e para quando?', 95],
    ['in', 'Um SUV de uns 150 mil, nos próximos 3 meses. Consigo 2 mil por mês, ganho uns 15 mil e decido sozinho', 90],
    ['out', 'Perfeito, Ricardo! Tenho estes horários para uma conversa online com o nosso especialista: amanhã às 10:00, amanhã às 14:00 ou quinta às 09:00. Qual fica melhor?', 89],
    ['in', 'Amanhã às 10 está ótimo', 85],
    ['out', 'Prontinho! Sua reunião ficou para amanhã às 10:00 com o Especialista Demo 1. Você vai receber o link por aqui. Até lá! 🚗', 84],
    ['in', 'Valeu!', 80],
  ]);
  const ops = require('./services/opportunities');
  const opp = db.prepare("SELECT id FROM opportunities WHERE contact_id = ? AND status = 'aberta'").get(r);
  if (opp) {
    try {
      ops.saveTriage(db, sys, opp.id, { interesse: 'sim', dor: 'sim', dor_descricao: 'trocar de carro por um SUV', impacto: 'curto', decisor: 'sim', faixa_investimento: '1000_2000', faixa_renda: '10k_20k' });
    } catch { /* segue sem triagem */ }
    // Amanhã às 10:00 no horário de Brasília (ou segunda, se amanhã for fim de semana)
    let day = new Date(Date.now() + DAY);
    while ([0, 6].includes(new Date(`${day.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })}T12:00:00-03:00`).getUTCDay())) day = new Date(day.getTime() + DAY);
    const start = new Date(`${day.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })}T10:00:00-03:00`);
    require('./services/meetings').scheduleR1(db, sys, { contact_id: r, opportunity_id: opp.id, start_at: start.toISOString(), end_at: new Date(start.getTime() + 45 * 60000).toISOString(), assigned_to: c1.id, move_to_r1: true, notes: 'Agendada pelo agente de IA no WhatsApp.' }, null).catch(() => {});
  }
  log(cr, r, 'novo_lead', 'Ricardo', 95);
  log(cr, r, 'qualificou', 'Triagem concluída: interesse sim', 90);
  log(cr, r, 'agendou_r1', 'amanhã às 10:00 com Especialista Demo 1', 84);
}
const nowIsoDemo = () => new Date().toISOString();

module.exports = { seedDemo, DEMO_USERS };
