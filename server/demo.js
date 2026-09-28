'use strict';
/**
 * Dados FICTÍCIOS de demonstração (usuários, leads, atividades, oportunidades, simulações,
 * propostas e contratos). Usado pelo script `npm run demo` e pela versão de teste no navegador.
 */
const { tx } = require('./db');
const { hashPassword, nowIso } = require('./util');
const contacts = require('./services/contacts');
const opps = require('./services/opportunities');
const activities = require('./services/activities');
const tasks = require('./services/tasks');
const sims = require('./services/simulations');
const proposals = require('./services/proposals');
const record = require('./services/record');
const finance = require('./services/finance');

const DEMO_USERS = ['admin@demo.local', 'gestora@demo.local', 'consultor1@demo.local', 'consultor2@demo.local', 'leitura@demo.local'];

/** Popula um banco vazio. Lança erro se já houver cadastros. */
function seedDemo(db, password) {
  if (db.prepare('SELECT COUNT(*) AS n FROM contacts').get().n > 0) {
    throw new Error('O banco já possui cadastros. Use um banco vazio.');
  }
  const now = nowIso();
  const team = Number(db.prepare('INSERT INTO teams (name, created_at) VALUES (?, ?)').run('Equipe Centro', now).lastInsertRowid);
  const mkUser = (name, email, role, teamId, agent) => {
    const ex = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (ex) return db.prepare('SELECT * FROM users WHERE id = ?').get(ex.id);
    const id = Number(
      db.prepare('INSERT INTO users (name, email, password_hash, role, team_id, dialer_agent_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(name, email, hashPassword(password), role, teamId, agent, now, now).lastInsertRowid,
    );
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  };
  const admin = mkUser('Administrador Demo', 'admin@demo.local', 'admin', null, null);
  const gestor = mkUser('Gestora Demo', 'gestora@demo.local', 'gestor', team, null);
  const c1 = mkUser('Consultor Demo 1', 'consultor1@demo.local', 'consultor', team, 'ramal-201');
  const c2 = mkUser('Consultora Demo 2', 'consultor2@demo.local', 'consultor', team, 'ramal-202');
  mkUser('Leitura Demo', 'leitura@demo.local', 'leitura', team, null);

  const names = [
    'Ana Paula Ribeiro', 'Bruno Carvalho', 'Carla Mendes', 'Diego Almeida', 'Eduarda Lima', 'Felipe Rocha', 'Gabriela Nunes', 'Henrique Dias',
    'Isabela Martins', 'João Pedro Costa', 'Karina Lopes', 'Lucas Ferreira', 'Mariana Teixeira', 'Nicolas Barbosa', 'Olívia Cardoso', 'Paulo Henrique Souza',
    'Rafaela Gomes', 'Sérgio Pereira', 'Tatiane Araújo', 'Vinícius Moreira',
  ];
  const origins = ['indicacao', 'meta_ads', 'instagram', 'whatsapp', 'ligacao_ativa', 'site', 'evento', 'parceiro'];
  const stages = db.prepare("SELECT * FROM pipeline_stages WHERE kind = 'aberta' ORDER BY position").all();
  const won = db.prepare("SELECT * FROM pipeline_stages WHERE kind = 'ganho'").get();
  const lost = db.prepare("SELECT * FROM pipeline_stages WHERE kind = 'perdido'").get();
  const products = db.prepare('SELECT * FROM products').all();
  const rnd = (arr, i) => arr[i % arr.length];

  tx(db, () => {
    names.forEach((name, i) => {
      const owner = i % 2 ? c1 : c2;
      const phone = `(11) 9${String(80000000 + i * 1379).slice(0, 4)}-${String(1000 + i * 37).slice(-4)}`;
      const { id } = contacts.createContact(
        db,
        admin,
        {
          kind: 'PF',
          name,
          phone1: phone,
          email: `${name.split(' ')[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}.demo${i}@example.com`,
          city: rnd(['São Paulo', 'Campinas', 'Santos', 'Sorocaba'], i),
          state: 'SP',
          origin: rnd(origins, i),
          campaign: i % 3 === 0 ? 'Campanha demonstração' : null,
          owner_id: owner.id,
          product_id: rnd(products, i).id,
          credit_value: 80000 + (i % 5) * 60000,
          origin_details: i % 3 === 0 ? { platform: 'meta_ads', platform_lead_id: `demo-${i}`, campaign_id: 'demo-cmp-1', adset_id: 'demo-set-1', ad_id: `demo-ad-${i % 2}` } : {},
        },
        { skipDuplicateCheck: true },
      );
      const opp = db.prepare('SELECT * FROM opportunities WHERE contact_id = ?').get(id);
      if (i % 4 !== 3) {
        activities.createActivity(db, owner, { contact_id: id, type: 'tentativa_sem_atendimento', result: 'nao_atendida', occurred_at: new Date(Date.now() - (6 - (i % 5)) * 86400000).toISOString() });
      }
      if (i % 4 < 2) {
        activities.createActivity(db, owner, { contact_id: id, opportunity_id: opp.id, type: 'ligacao_realizada', result: 'atendida', duration: 240 + i * 11, notes: 'Conversa inicial sobre objetivo e prazo.', occurred_at: new Date(Date.now() - (3 - (i % 3)) * 86400000).toISOString() });
      }
      const target = i % 10;
      if (target > 0 && target < 9) {
        opps.moveStage(db, owner, opp.id, { stage_id: stages[Math.min(target, stages.length - 1)].id });
        opps.updateOpportunity(db, owner, opp.id, { term_months: 180, installment_max: 1500 + i * 50, strategy: rnd(['aquisicao', 'planejamento', 'formacao_patrimonial'], i),
        objective_type: i % 3 ? 'aquisicao' : 'investimento', product_type: i % 4 ? 'primario' : 'contemplada', urgency: rnd(['curto', 'medio', 'longo'], i),
        financial_moment: rnd(['organizado_reserva', 'organizado_sem_reserva', 'apertado'], i), employment_type: rnd(['clt', 'pj', 'empresario'], i),
        has_fgts: i % 2 ? 'sim' : 'nao', decision_maker: rnd(['sozinho', 'conjuge'], i), existing_products: 'nenhum', next_action: 'Retornar com simulação', next_action_at: new Date(Date.now() + ((i % 4) - 1) * 86400000).toISOString() });
      }
      if (target >= 6 && target < 9) {
        const s = sims.createManual(db, owner, { contact_id: id, opportunity_id: opp.id, credit_value: 200000, term_months: 180, installment: 1400 + i * 10, strategy: 'aquisicao', payment_modality: 'parcela_integral' });
        if (target >= 7) proposals.createProposal(db, owner, { opportunity_id: opp.id, simulation_id: s.id, admin_fee_pct: 15, reserve_fund_pct: 2, readjustment_index: 'incc', valid_until: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10), status: 'apresentada' });
      }
      if (target === 9) {
        contacts.updateContact(db, admin, id, { rg: `${12345670 + i}`, birthplace: 'São Paulo/SP', nationality: 'Brasileira', sex: i % 2 ? 'masculino' : 'feminino', marital_status: 'solteiro', mother_name: 'Nome fictício da mãe', profession: 'Analista', income_range: '6k_10k', birth_date: '1988-05-10' });
      record.saveAddress(db, admin, id, { cep: '01001000', street: 'Praça da Sé', number: `${100 + i}`, district: 'Sé', city: 'São Paulo', state: 'SP', is_primary: true });
      const r = opps.moveStage(db, owner, opp.id, { stage_id: won.id, contract: { administrator: 'Administradora (preencher)', group_code: `G${100 + i}`, quota_code: `${i}`, contract_number: `CTR-DEMO-${i}`, installment_value: 1450, due_day: 10, contracted_at: new Date(Date.now() - 95 * 86400000).toISOString().slice(0, 10) } }, { skipChecklist: true });
      if (r.contract) {
        const first = new Date(Date.now() - 80 * 86400000);
        finance.generateInstallments(db, admin, r.contract.id, { first_due_date: first.toISOString().slice(0, 10), count: 12 });
        const entries = db.prepare("SELECT id FROM finance_entries WHERE contract_id = ? ORDER BY installment_number").all(r.contract.id);
        entries.slice(0, i % 3 === 0 ? 1 : 2).forEach((e) => finance.updateEntry(db, admin, e.id, { action: 'pagar', payment_method: 'boleto' }));
      }
      }
      if (i === 10 || i === 15) opps.moveStage(db, owner, opp.id, { stage_id: lost.id, lost_reason: 'optou_financiamento' });
      if (i % 5 === 1) tasks.createTask(db, owner, { contact_id: id, opportunity_id: opp.id, type: 'reuniao', title: 'Diagnóstico financeiro', due_at: new Date(Date.now() + (i % 3) * 86400000 + 3600000).toISOString() });
    });
  });
  finance.overdueSweep(db);
}

module.exports = { seedDemo, DEMO_USERS };
