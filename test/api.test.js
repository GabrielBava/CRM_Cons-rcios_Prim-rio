'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/app');

let server;
let appDb;
let base;
const sessions = {};

async function call(who, method, url, body, headers = {}) {
  const h = { 'X-Requested-With': 'crm', ...headers };
  if (who && sessions[who]) h.Cookie = sessions[who];
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {}
  const cookie = res.headers.get('set-cookie');
  return { status: res.status, data, cookie };
}
const login = async (who, email, password) => {
  const r = await call(null, 'POST', '/api/login', { email, password });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  sessions[who] = r.cookie.split(';')[0];
};
const integ = (token) => ({ Authorization: `Bearer ${token}` });
/** Ficha do cliente: confirma os 4 últimos dígitos do celular e devolve a chave de acesso. */
async function fichaKey(token, phone) {
  const r = await call(null, 'POST', '/api/publico/ficha/verificar', { token, digits: String(phone).replace(/\D/g, '').slice(-4) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.key;
}

before(async () => {
  ({ server, db: appDb } = createApp({ dbFile: ':memory:' }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await call(null, 'POST', '/api/setup', { name: 'Admin', email: 'admin@t.com', password: 'senha1234' });
  sessions.admin = r.cookie.split(';')[0];
  const team = await call('admin', 'POST', '/api/equipes', { name: 'Equipe A' });
  for (const [name, email, role, team_id] of [
    ['Gestor', 'gestor@t.com', 'gestor', team.data.id],
    ['Cons 1', 'c1@t.com', 'consultor', team.data.id],
    ['Cons 2', 'c2@t.com', 'consultor', null],
    ['Leitor', 'l@t.com', 'leitura', team.data.id],
  ]) {
    const u = await call('admin', 'POST', '/api/usuarios', { name, email, role, team_id, password: 'senha1234', require_password_change: false, onboarding: false, dialer_agent_ref: email === 'c1@t.com' ? 'ramal-1' : undefined });
    assert.equal(u.status, 200, JSON.stringify(u.data));
  }
  await login('gestor', 'gestor@t.com', 'senha1234');
  await login('c1', 'c1@t.com', 'senha1234');
  await login('c2', 'c2@t.com', 'senha1234');
  await login('leitor', 'l@t.com', 'senha1234');
});
after(() => server.close());


const PDF = Buffer.from('%PDF-1.4 teste').toString('base64');
async function completeForSale(id, who = 'c1') {
  const u = await call(who, 'PATCH', `/api/cadastros/${id}`, {
    doc: '529.982.247-25', rg: '123456', email: `venda${id}@x.com`, birthplace: 'Santos/SP', nationality: 'Brasileira', sex: 'feminino',
    marital_status: 'solteiro', birth_date: '1990-01-01', mother_name: 'Mãe Teste', profession: 'Engenheira', income_range: '6k_10k', confirm_duplicate: true,
  });
  assert.equal(u.status, 200, JSON.stringify(u.data));
  const a = await call(who, 'POST', `/api/cadastros/${id}/enderecos`, { cep: '01001-000', street: 'Praça da Sé', number: '1', district: 'Sé', city: 'São Paulo', state: 'SP' });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  for (const t of ['identificacao', 'comprovante_endereco', 'comprovante_renda', 'comprovante_estado_civil']) {
    const r = await call(who, 'POST', `/api/cadastros/${id}/anexos`, { doc_type: t, filename: `${t}.pdf`, content_base64: PDF });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
}


const todayStr = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
let testPlan = null;
/** Administradora com comissão 0,3% (carência de 7 dias) + 0,1% + 0,1% + 0,1% e plano HS de 100 a 300 mil, de 10 em 10 mil. */
async function ensurePlan() {
  if (testPlan) return testPlan;
  const a = await call('admin', 'POST', '/api/administradoras', {
    name: 'Adm Teste',
    commercial_name: 'Comercial',
    commission_schedule: [{ month_offset: 0, pct: 0.3, release_after_days: 7 }, { month_offset: 1, pct: 0.1 }, { month_offset: 2, pct: 0.1 }, { month_offset: 3, pct: 0.1 }],
    chargeback_policy: { estornar_pagas: true, ate_dias: 365 },
  });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  const p = await call('admin', 'POST', '/api/planos', { administrator_id: a.data.id, name: 'HS Imóvel', category: 'imovel', admin_fee_pct: 18, reserve_fund_pct: 2, term_months: 200, credit_min: 100000, credit_max: 300000, credit_step: 10000, adhesion: true, adhesion_pct: 1, adhesion_months: 3, readjustment_index: 'incc' });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  testPlan = { administrator_id: a.data.id, id: p.data.id };
  return testPlan;
}
/**
 * Fluxo completo de venda: pré-venda → conferência → termo de adesão (cotas) → contrato assinado → pagamento enviado
 * → comprovante (cria a venda aguardando alocação) → especialista informa a alocação → líder confirma a venda.
 */
let quotaSeq = 0;
async function sellViaFlow(who, oppId, credit = 200000, extra = {}) {
  const plan = await ensurePlan();
  const ps = await call(who, 'POST', '/api/pre-vendas', { opportunity_id: oppId });
  assert.equal(ps.status, 200, JSON.stringify(ps.data));
  quotaSeq++;
  const quotas = extra.quotas || [{ credit_value: credit, group_code: extra.group_code || `G${quotaSeq}`, quota_code: extra.quota_code || String(100 + quotaSeq), contract_number: `CTR-${quotaSeq}` }];
  let sale = null;
  for (const [step, body] of [
    ['conferido', {}],
    ['termo_adesao', { plan_id: plan.id, credit_value: credit, adhesion_number: `ADE-${quotaSeq}`, quotas }],
    ['contrato_assinado', {}],
    ['pagamento_enviado', { payment_method: 'boleto', boleto_value: 1500, boleto_due: todayStr() }],
    ['pagamento_comprovado', { payment_date: extra.payment_date || todayStr(), filename: 'comprovante.pdf', mime: 'application/pdf', content_base64: PDF }],
  ]) {
    const r = await call(who, 'POST', `/api/pre-vendas/${ps.data.id}/avancar`, { step, ...body });
    assert.equal(r.status, 200, `${step}: ${JSON.stringify(r.data)}`);
    if (r.data.sale) sale = r.data.sale;
  }
  if (extra.stop === 'venda') return { pre_sale: ps.data, sale };
  const s = (await call(who, 'GET', `/api/vendas/${sale.id}`)).data;
  const a = await call(who, 'POST', `/api/vendas/${sale.id}/alocacao`, { quotas: s.quotas.map((q) => ({ id: q.id, allocated: true })) });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  const c = await call(extra.confirmer || 'gestor', 'POST', `/api/vendas/${sale.id}/confirmar`, { pref_channel: 'whatsapp' });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  return { pre_sale: ps.data, sale, confirm: c.data };
}

test('setup só pode ser feito uma vez e rotas exigem sessão', async () => {
  const r = await call(null, 'POST', '/api/setup', { name: 'X', email: 'x@t.com', password: 'senha1234' });
  assert.equal(r.status, 403);
  assert.equal((await call(null, 'GET', '/api/cadastros')).status, 401);
});

test('requisições de sessão sem cabeçalho de segurança são recusadas (CSRF)', async () => {
  const res = await fetch(`${base}/api/cadastros`, { method: 'POST', headers: { Cookie: sessions.c1, 'Content-Type': 'application/json' }, body: '{"name":"x"}' });
  assert.equal(res.status, 403);
});

test('cadastro rápido salva só com nome e detecta duplicidade por telefone/e-mail/CPF', async () => {
  const a = await call('c1', 'POST', '/api/cadastros', { name: 'Lead Sem Dados' });
  assert.equal(a.status, 200);
  const b = await call('c1', 'POST', '/api/cadastros', { name: 'João', phone1: '(11) 91111-2222', email: 'joao@x.com', doc: '529.982.247-25' });
  assert.equal(b.status, 200);
  const dup = await call('c1', 'POST', '/api/cadastros', { name: 'Outro', phone1: '+55 11 91111-2222' });
  assert.equal(dup.status, 409);
  assert.equal(dup.data.details.duplicates[0].code, b.data.code);
  const dupDoc = await call('c1', 'POST', '/api/cadastros', { name: 'Outro', doc: '52998224725' });
  assert.equal(dupDoc.status, 409);
  // outro consultor recebe alerta sem ver os dados do cadastro alheio
  const other = await call('c2', 'POST', '/api/cadastros', { name: 'Outro', email: 'JOAO@x.com' });
  assert.equal(other.status, 409);
  assert.equal(other.data.details.duplicates[0].visible, false);
  assert.equal(other.data.details.duplicates[0].name, undefined);
  const forced = await call('c1', 'POST', '/api/cadastros', { name: 'Homônimo', phone1: '11911112222', confirm_duplicate: true });
  assert.equal(forced.status, 200);
  const bad = await call('c1', 'POST', '/api/cadastros', { name: 'CPF errado', doc: '111.111.111-11' });
  assert.equal(bad.status, 400);
});

test('permissões: consultor vê só os próprios, gestor vê a equipe, leitura não edita', async () => {
  const mine = await call('c2', 'POST', '/api/cadastros', { name: 'Lead do C2', phone1: '21 99999-0000' });
  const list1 = await call('c1', 'GET', '/api/cadastros');
  assert.ok(!list1.data.rows.some((r) => r.id === mine.data.id));
  assert.equal((await call('c1', 'GET', `/api/cadastros/${mine.data.id}`)).status, 404);
  assert.equal((await call('c1', 'PATCH', `/api/cadastros/${mine.data.id}`, { city: 'X' })).status, 404);
  const gl = await call('gestor', 'GET', '/api/cadastros');
  assert.ok(gl.data.rows.some((r) => r.name === 'João'));
  assert.ok(!gl.data.rows.some((r) => r.id === mine.data.id), 'C2 não pertence à equipe do gestor');
  const lr = await call('leitor', 'GET', '/api/cadastros');
  assert.ok(lr.data.rows.length > 0);
  assert.equal((await call('leitor', 'POST', '/api/cadastros', { name: 'x' })).status, 403);
  assert.equal((await call('leitor', 'GET', '/api/exportar/cadastros')).status, 403);
  assert.equal((await call('c1', 'POST', '/api/usuarios', { name: 'x', email: 'y@t.com', role: 'admin', password: '12345678' })).status, 403);
  // consultor não transfere responsável
  const jid = (await call('c1', 'GET', '/api/cadastros?q=Jo%C3%A3o')).data.rows[0].id;
  assert.equal((await call('c1', 'PATCH', `/api/cadastros/${jid}`, { owner_id: 1 })).status, 403);
});

test('funil: perda exige motivo; venda só pelo pagamento confirmado, converte em cliente e mantém histórico', async () => {
  const c = await call('c1', 'POST', '/api/cadastros', { name: 'Cliente Funil', phone1: '31 98888-7777' });
  const detail = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data;
  const opp = detail.opportunities[0];
  const meta = (await call('c1', 'GET', '/api/meta')).data;
  const lost = meta.stages.find((s) => s.kind === 'perdido');
  const won = meta.stages.find((s) => s.kind === 'ganho');
  const r1 = await call('c1', 'POST', `/api/oportunidades/${opp.id}/etapa`, { stage_id: lost.id });
  assert.equal(r1.status, 400);
  // Não se move para "Venda" pelo funil
  const blocked = await call('c1', 'POST', `/api/oportunidades/${opp.id}/etapa`, { stage_id: won.id });
  assert.equal(blocked.status, 400);
  assert.match(blocked.data.error, /pagamento/);
  // Conferência da pré-venda bloqueada enquanto a ficha estiver incompleta
  const ps = await call('c1', 'POST', '/api/pre-vendas', { opportunity_id: opp.id });
  const conf = await call('c1', 'POST', `/api/pre-vendas/${ps.data.id}/avancar`, { step: 'conferido' });
  assert.equal(conf.status, 400);
  assert.ok(conf.data.details.missing.some((m) => m.key === 'doc:identificacao'));
  await completeForSale(c.data.id);
  await sellViaFlow('c1', opp.id, 100000);
  const after = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data;
  assert.equal(after.relationship, 'cliente');
  assert.equal(after.lead_status, 'convertido');
  assert.equal(after.contracts.length, 1);
  const o = (await call('c1', 'GET', `/api/oportunidades/${opp.id}`)).data;
  assert.equal(o.status, 'ganha');
  assert.equal(o.stage_history.at(-1).to_stage_name, won.name);
  const hist = (await call('c1', 'GET', `/api/cadastros/${c.data.id}/historico`)).data.rows;
  assert.ok(hist.some((a) => a.type === 'mudanca_etapa'));
  // segundo contrato não sobrescreve o primeiro
  await call('c1', 'POST', '/api/contratos', { contact_id: c.data.id, credit_value: 50000 });
  assert.equal((await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data.contracts.length, 2);
});

test('oposição a contato bloqueia registro de contato ativo e sai da lista da discadora', async () => {
  const c = await call('c1', 'POST', '/api/cadastros', { name: 'Não Ligue', phone1: '41 97777-6666' });
  const r = await call('c1', 'POST', `/api/cadastros/${c.data.id}/consentimentos`, { channel: 'ligacao', status: 'oposicao', source: 'pedido na ligação' });
  assert.equal(r.status, 200);
  const act = await call('c1', 'POST', '/api/atividades', { contact_id: c.data.id, type: 'ligacao_realizada' });
  assert.equal(act.status, 409);
  const ok = await call('c1', 'POST', '/api/atividades', { contact_id: c.data.id, type: 'ligacao_recebida', result: 'atendida' });
  assert.equal(ok.status, 200);
  const csv = await call('c1', 'GET', '/api/exportar/lista_discadora');
  assert.ok(!String(csv.data).includes('Não Ligue'));
});

test('discadora: pendente recusa, ID externo evita duplicidade, fila sem vínculo e reprocessamento', async () => {
  let r = await call(null, 'POST', '/api/integracoes/discadora/eventos', { id_chamada: '1' }, integ('x'));
  assert.equal(r.status, 401);
  const tok = (await call('admin', 'POST', '/api/integracoes/discadora/token')).data.token;
  r = await call(null, 'POST', '/api/integracoes/discadora/eventos', { id_chamada: '1' }, integ(tok));
  assert.equal(r.status, 503, 'integração pendente não recebe eventos');
  assert.equal((await call('admin', 'PATCH', '/api/integracoes/discadora', { status: 'ativa' })).status, 400, 'não pode ativar sem evento validado');
  await call('admin', 'PATCH', '/api/integracoes/discadora', { status: 'em_teste', result_map: { ANSWER: 'atendida', NOANSWER: 'nao_atendida' } });

  const c = await call('c1', 'POST', '/api/cadastros', { name: 'Discado', phone1: '51 96666-5555' });
  const ev = { id_chamada: 'call-100', telefone: '5551966665555', inicio: '2026-09-01T12:00:00Z', fim: '2026-09-01T12:03:00Z', agente: 'ramal-1', resultado: 'ANSWER' };
  r = await call(null, 'POST', '/api/integracoes/discadora/eventos', ev, integ(tok));
  assert.equal(r.data.resultados[0].status, 'vinculado');
  r = await call(null, 'POST', '/api/integracoes/discadora/eventos', ev, integ(tok));
  assert.equal(r.data.resultados[0].status, 'duplicado');
  const acts = (await call('c1', 'GET', `/api/cadastros/${c.data.id}/historico`)).data.rows.filter((a) => a.source === 'discadora');
  assert.equal(acts.length, 1);
  assert.equal(acts[0].duration_seconds, 180);
  assert.equal(acts[0].result, 'atendida');
  assert.equal(acts[0].user_name, 'Cons 1');

  // sem resultado informado -> não inventa sucesso
  r = await call(null, 'POST', '/api/integracoes/discadora/eventos', { id_chamada: 'call-101', id_lead: c.data.code }, integ(tok));
  assert.equal(r.data.resultados[0].status, 'vinculado');
  const a2 = (await call('c1', 'GET', `/api/cadastros/${c.data.id}/historico`)).data.rows.find((a) => a.external_id === 'call-101');
  assert.equal(a2.result, 'nao_informado');

  // telefone desconhecido -> fila sem vínculo -> vínculo manual
  r = await call(null, 'POST', '/api/integracoes/discadora/eventos', { eventos: [{ id_chamada: 'call-200', telefone: '11900000000', resultado: 'NOANSWER' }, { telefone: 'x' }] }, integ(tok));
  assert.equal(r.data.resultados[0].status, 'sem_vinculo');
  assert.equal(r.data.resultados[1].status, 'erro');
  const q = (await call('gestor', 'GET', '/api/discadora/eventos?status=sem_vinculo')).data;
  assert.equal(q.rows.length, 1);
  assert.equal((await call('c1', 'GET', '/api/discadora/eventos')).status, 403);
  r = await call('gestor', 'POST', `/api/discadora/eventos/${q.rows[0].id}/vincular`, { contact_id: c.data.id });
  assert.equal(r.data.status, 'vinculado');

  // erro de mapeamento -> corrige mapeamento -> reprocessa
  r = await call(null, 'POST', '/api/integracoes/discadora/eventos', { call: { uuid: 'nested-1' }, telefone: '51966665555' }, integ(tok));
  assert.equal(r.data.resultados[0].status, 'erro');
  await call('admin', 'PATCH', '/api/integracoes/discadora', { mapping: { external_call_id: 'call.uuid' } });
  r = await call('gestor', 'POST', `/api/discadora/eventos/${r.data.resultados[0].event_id}/reprocessar`);
  assert.equal(r.data.status, 'vinculado');
  assert.equal((await call('admin', 'PATCH', '/api/integracoes/discadora', { status: 'ativa' })).status, 200);
});

test('simulador: token temporário por lead, contexto sem CPF, vínculo validado e versões', async () => {
  const c = await call('c1', 'POST', '/api/cadastros', { name: 'Simulado', phone1: '61 95555-4444', email: 's@x.com', doc: '529.982.247-25', confirm_duplicate: true });
  const other = await call('c1', 'POST', '/api/cadastros', { name: 'Outro Lead', phone1: '61 95555-1111' });
  assert.equal((await call('c1', 'POST', '/api/simulacoes/link', { contact_id: c.data.id })).status, 409, 'botão desativado enquanto pendente');
  const tok = (await call('admin', 'POST', '/api/integracoes/simulador/token')).data.token;
  await call('admin', 'PATCH', '/api/integracoes/simulador', { base_url: 'https://simulador.exemplo/nova', status: 'em_teste' });
  const link = await call('c1', 'POST', '/api/simulacoes/link', { contact_id: c.data.id });
  assert.equal(link.status, 200);
  const url = new URL(link.data.url);
  const t = url.searchParams.get('crm_token');
  assert.ok(t && !link.data.url.includes('52998224725'));
  const ctx = await call(null, 'GET', `/api/integracoes/simulador/contexto?token=${encodeURIComponent(t)}`, undefined, integ(tok));
  assert.equal(ctx.status, 200);
  assert.equal(ctx.data.nome, 'Simulado');
  assert.ok(!JSON.stringify(ctx.data).includes('52998224725'));
  assert.equal((await call(null, 'GET', `/api/integracoes/simulador/contexto?token=${encodeURIComponent(t)}`)).status, 401, 'exige token da integração');

  const otherUid = (await call('c1', 'GET', `/api/cadastros/${other.data.id}`)).data.uid;
  let r = await call(null, 'POST', '/api/integracoes/simulador/simulacoes', { token: t, id_simulacao: 'S1', id_lead: otherUid, credito: 100000 }, integ(tok));
  assert.equal(r.status, 409, 'não grava em outro lead');
  r = await call(null, 'POST', '/api/integracoes/simulador/simulacoes', { token: t, id_simulacao: 'S1', credito: 100000, prazo_meses: 200, parcela: 700, status: 'salva' }, integ(tok));
  assert.equal(r.status, 200);
  assert.equal(r.data.versao, 1);
  r = await call(null, 'POST', '/api/integracoes/simulador/simulacoes', { token: t, id_simulacao: 'S1', credito: 120000, prazo_meses: 200, parcela: 800 }, integ(tok));
  assert.equal(r.data.versao, 2);
  const d = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data;
  assert.equal(d.simulations.length, 1);
  const s = (await call('c1', 'GET', `/api/simulacoes/${d.simulations[0].id}`)).data;
  assert.equal(s.versions.length, 1);
  assert.equal(s.versions[0].snapshot.credit_value, 100000);
  r = await call(null, 'POST', '/api/integracoes/simulador/simulacoes', { token: 'invalido', id_simulacao: 'S9', credito: 1 }, integ(tok));
  assert.equal(r.status, 401);
});

test('propostas: versões preservadas e condições travadas após apresentação', async () => {
  const c = await call('c1', 'POST', '/api/cadastros', { name: 'Proposta', phone1: '71 94444-3333' });
  const opp = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data.opportunities[0];
  const p1 = await call('c1', 'POST', '/api/propostas', { opportunity_id: opp.id, credit_value: 200000, term_months: 180, admin_fee_pct: 16, status: 'apresentada' });
  assert.equal(p1.status, 200);
  assert.equal((await call('c1', 'PATCH', `/api/propostas/${p1.data.id}`, { credit_value: 1 })).status, 400);
  const p2 = await call('c1', 'POST', `/api/propostas/${p1.data.id}/nova-versao`, { credit_value: 210000 });
  assert.equal(p2.data.version, 2);
  const old = (await call('c1', 'GET', `/api/propostas/${p1.data.id}`)).data;
  assert.equal(old.status, 'substituida');
  assert.equal(old.credit_value, 200000);
  assert.equal(old.versions.length, 2);
  assert.equal((await call('c1', 'POST', `/api/propostas/${p1.data.id}/nova-versao`, {})).status, 400);
});

test('API de leads: ID da plataforma e dados de contato não duplicam cadastros', async () => {
  const tok = (await call('admin', 'POST', '/api/integracoes/api_leads/token')).data.token;
  await call('admin', 'PATCH', '/api/integracoes/api_leads', { status: 'em_teste' });
  const lead = { id_lead_plataforma: 'L-1', plataforma: 'meta_ads', nome: 'Lead Meta', telefone: '81 93333-2222', id_campanha: 'CMP', id_anuncio: 'AD' };
  let r = await call(null, 'POST', '/api/integracoes/leads', lead, integ(tok));
  assert.equal(r.data.resultados[0].status, 'criado');
  r = await call(null, 'POST', '/api/integracoes/leads', lead, integ(tok));
  assert.equal(r.data.resultados[0].status, 'duplicado');
  r = await call(null, 'POST', '/api/integracoes/leads', { ...lead, id_lead_plataforma: 'L-2' }, integ(tok));
  assert.equal(r.data.resultados[0].status, 'existente');
  const list = (await call('admin', 'GET', '/api/cadastros?q=Lead%20Meta')).data.rows;
  assert.equal(list.length, 1);
  const det = (await call('admin', 'GET', `/api/cadastros/${list[0].id}`)).data;
  assert.equal(det.origins.length, 2);
  assert.equal(det.origins[0].campaign_id, 'CMP');
  assert.equal(det.origins[0].adset_id, null);
});

test('importação CSV: prévia, duplicidade no arquivo e no banco, erros por linha', async () => {
  const csv = 'Nome;Telefone;E-mail;UF\nImport A;11 92222-1111;a@imp.com;SP\nImport B;11 92222-1111;b@imp.com;SP\nImport C;123;c@imp.com;XX\nJoão;11 91111-2222;;SP\n';
  const pv = await call('c1', 'POST', '/api/importacao/previa', { csv });
  assert.equal(pv.status, 200);
  assert.equal(pv.data.total, 4);
  assert.equal(pv.data.valid, 1);
  assert.equal(pv.data.duplicates, 2);
  assert.equal(pv.data.errors, 1);
  const r = await call('c1', 'POST', '/api/importacao', { csv, filename: 't.csv' });
  assert.equal(r.data.created, 1);
  assert.equal(r.data.errors.length, 1);
  assert.equal(r.data.errors[0].line, 4);
});

test('mesclagem preserva histórico e oportunidades', async () => {
  const a = await call('gestor', 'POST', '/api/cadastros', { name: 'Merge A', phone1: '91 91111-0000', owner_id: undefined });
  const b = await call('gestor', 'POST', '/api/cadastros', { name: 'Merge B', email: 'mb@x.com' });
  await call('gestor', 'POST', '/api/atividades', { contact_id: b.data.id, type: 'observacao', notes: 'nota B' });
  const r = await call('gestor', 'POST', `/api/cadastros/${a.data.id}/mesclar`, { source_id: b.data.id });
  assert.equal(r.status, 200);
  const d = (await call('gestor', 'GET', `/api/cadastros/${a.data.id}`)).data;
  assert.equal(d.email, 'mb@x.com');
  assert.equal(d.opportunities.length, 2);
  const h = (await call('gestor', 'GET', `/api/cadastros/${a.data.id}/historico`)).data.rows;
  assert.ok(h.some((x) => x.notes === 'nota B'));
  assert.equal((await call('c1', 'POST', `/api/cadastros/${a.data.id}/mesclar`, { source_id: b.data.id })).status, 403);
});

test('painel e todos os relatórios respondem com definições', async () => {
  const d = await call('admin', 'GET', '/api/dashboard');
  assert.equal(d.status, 200);
  assert.ok(d.data.kpis.every((k) => k.def));
  const list = (await call('admin', 'GET', '/api/relatorios')).data;
  assert.ok(list.reports.length >= 25);
  for (const { key } of list.reports) {
    const r = await call('admin', 'GET', `/api/relatorios/${key}`);
    assert.equal(r.status, 200, key);
    assert.ok(r.data.definition.length > 0, key);
    const csv = await call('admin', 'GET', `/api/relatorios/${key}/csv`);
    assert.equal(csv.status, 200, key);
  }
  const gl = (await call('gestor', 'GET', '/api/relatorios')).data;
  for (const { key } of gl.reports.filter((r) => r.group === 'Comercial')) assert.equal((await call('gestor', 'GET', `/api/relatorios/${key}`)).status, 200, key);
  const tc = (await call('admin', 'GET', '/api/relatorios/taxa_contato')).data;
  assert.ok(tc.rows.length >= 1);
});

test('anexos: download respeita o escopo e o tipo de arquivo é validado', async () => {
  const c = await call('c1', 'POST', '/api/cadastros', { name: 'Com Anexo', phone1: '11 95555-0001' });
  const bad = await call('c1', 'POST', `/api/cadastros/${c.data.id}/anexos`, { doc_type: 'outro', filename: 'virus.exe', content_base64: PDF });
  assert.equal(bad.status, 400);
  const ok = await call('c1', 'POST', `/api/cadastros/${c.data.id}/anexos`, { doc_type: 'identificacao', filename: 'rg ção.pdf', content_base64: PDF });
  assert.equal(ok.status, 200);
  const res = await fetch(`${base}/api/anexos/${ok.data.id}`, { headers: { Cookie: sessions.c1 } });
  assert.equal(res.status, 200);
  assert.equal(Buffer.from(await res.arrayBuffer()).toString(), '%PDF-1.4 teste');
  assert.equal((await fetch(`${base}/api/anexos/${ok.data.id}`, { headers: { Cookie: sessions.c2 } })).status, 404);
  const d = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data;
  assert.equal(d.attachments.length, 1);
  assert.equal(d.attachments[0].content, undefined, 'lista não traz o conteúdo do arquivo');
});

test('link do cliente: atualiza dados externos, recebe documentos e pode ser revogado', async () => {
  const c = await call('c1', 'POST', '/api/cadastros', { name: 'Cliente Link', phone1: '11 95555-0002' });
  const l = await call('c1', 'POST', `/api/cadastros/${c.data.id}/link-cliente`);
  assert.equal(l.status, 200);
  const tok = l.data.token;
  // Antes dos 4 dígitos do celular: só a saudação, nenhum dado
  const gate = await call(null, 'GET', `/api/publico/ficha?token=${encodeURIComponent(tok)}`);
  assert.equal(gate.status, 200);
  assert.equal(gate.data.needs_verification, true);
  assert.equal(gate.data.greeting, 'Cliente Link');
  assert.equal(gate.data.values, undefined, 'nenhum dado antes da verificação');
  assert.equal((await call(null, 'POST', '/api/publico/ficha', { token: tok, values: { rg: '1' } })).status, 401, 'não grava sem a verificação');
  const wrong = await call(null, 'POST', '/api/publico/ficha/verificar', { token: tok, digits: '1234' });
  assert.equal(wrong.status, 400);
  assert.match(wrong.data.error, /4 tentativa/);
  const key = await fichaKey(tok, '11 95555-0002');
  const form = await call(null, 'GET', `/api/publico/ficha?token=${encodeURIComponent(tok)}`, undefined, { 'X-Ficha-Key': key });
  assert.equal(form.status, 200);
  assert.equal(form.data.values.name, 'Cliente Link');
  assert.ok(form.data.values.initial_notes === undefined, 'só campos externos');
  assert.ok(form.data.required.fields.includes('doc'));
  assert.deepEqual(form.data.documents.map((x) => x.type), ['identificacao', 'comprovante_endereco'], 'só identificação e comprovante de endereço');
  const sub = await call(null, 'POST', '/api/publico/ficha', { token: tok, key, values: { rg: '998877', mother_name: 'Mãe do Cliente', owner_id: 1 }, address: { cep: '20040020', street: 'Av. Rio Branco', number: '10', district: 'Centro', city: 'Rio de Janeiro', state: 'RJ' } });
  assert.equal(sub.status, 200, JSON.stringify(sub.data));
  const up = await call(null, 'POST', '/api/publico/ficha/anexo', { token: tok, key, doc_type: 'identificacao', filename: 'rg.jpg', mime: 'image/jpeg', content_base64: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]).toString('base64') });
  assert.equal(up.status, 200);
  const d = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data;
  assert.equal(d.rg, '998877');
  assert.equal(d.owner_name, 'Cons 1', 'cliente não altera campos internos');
  assert.equal(d.addresses[0].city, 'Rio de Janeiro');
  assert.equal(d.attachments[0].source, 'cliente');
  assert.ok(d.tasks.some((t) => t.title === 'Conferir dados atualizados pelo cliente'));
  await call('c1', 'POST', `/api/cadastros/${c.data.id}/link-cliente/revogar`);
  assert.equal((await call(null, 'GET', `/api/publico/ficha?token=${encodeURIComponent(tok)}`)).status, 401);
  assert.equal((await call(null, 'GET', '/api/publico/ficha?token=invalido')).status, 401);
});

test('proposta: aceite exige canal e abre a ficha de pré-venda; recusa exige motivo', async () => {
  const c = await call('c1', 'POST', '/api/cadastros', { name: 'Aceite', phone1: '11 95555-0003' });
  const opp = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data.opportunities[0];
  const p = await call('c1', 'POST', '/api/propostas', { opportunity_id: opp.id, credit_value: 100000, status: 'apresentada' });
  assert.equal((await call('c1', 'POST', `/api/propostas/${p.data.id}/status`, { status: 'aprovada' })).status, 400);
  assert.equal((await call('c1', 'POST', `/api/propostas/${p.data.id}/status`, { status: 'aprovada', accepted_channel: 'whatsapp' })).status, 200);
  const d = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data;
  assert.equal(d.proposals[0].accepted_channel, 'whatsapp');
  assert.ok(d.tasks.some((t) => t.type === 'pre_venda'));
  const p2 = await call('c1', 'POST', '/api/propostas', { opportunity_id: opp.id, credit_value: 90000, status: 'apresentada' });
  assert.equal((await call('c1', 'POST', `/api/propostas/${p2.data.id}/status`, { status: 'recusada' })).status, 400);
  assert.equal((await call('c1', 'POST', `/api/propostas/${p2.data.id}/status`, { status: 'recusada', refusal_reason: 'parcela_alta' })).status, 200);
});

test('financeiro: gera parcelas, baixa pagamento, alerta atraso e respeita escopo', async () => {
  const c = await call('c1', 'POST', '/api/cadastros', { name: 'Financeiro', phone1: '11 95555-0004' });
  const k = await call('c1', 'POST', '/api/contratos', { contact_id: c.data.id, credit_value: 200000, installment_value: 1500, due_day: 10, term_months: 12, contract_number: 'ADM-1', sale_value: 0 });
  assert.equal(k.status, 200);
  const past = new Date(Date.now() - 70 * 86400000).toISOString().slice(0, 10);
  const g = await call('c1', 'POST', `/api/contratos/${k.data.id}/gerar-parcelas`, { first_due_date: past });
  assert.equal(g.data.created, 12);
  assert.equal((await call('c1', 'POST', `/api/contratos/${k.data.id}/gerar-parcelas`, { first_due_date: past })).data.created, 0, 'não duplica');
  let fin = (await call('c1', 'GET', `/api/cadastros/${c.data.id}/financeiro`)).data;
  assert.equal(fin.entries.length, 12);
  assert.ok(fin.summary.qtd_atrasado >= 2);
  const first = fin.entries.find((e) => e.installment_number === 1);
  assert.equal((await call('c1', 'PATCH', `/api/financeiro/${first.id}`, { action: 'pagar', payment_method: 'pix' })).status, 200);
  fin = (await call('c1', 'GET', `/api/cadastros/${c.data.id}/financeiro`)).data;
  assert.equal(fin.entries.find((e) => e.id === first.id).display_status, 'pago');
  assert.equal(fin.summary.pago, 1500);
  // alerta de atraso vira tarefa (a rotina roda ao criar o app e periodicamente; aqui chamamos pela rota de rotina interna)
  require('../server/services/finance').overdueSweep(appDb);
  const tasks = (await call('c1', 'GET', `/api/tarefas?contact_id=${c.data.id}&status=pendente`)).data.rows;
  assert.ok(tasks.some((t) => t.type === 'financeiro'));
  assert.equal((await call('c2', 'GET', `/api/cadastros/${c.data.id}/financeiro`)).status, 404);
  assert.equal((await call('c2', 'GET', '/api/financeiro')).data.rows.filter((r) => r.contact_id === c.data.id).length, 0);
  const rep = await call('gestor', 'GET', '/api/relatorios/financeiro?from=2020-01-01T00:00:00Z&to=2030-01-01T00:00:00Z');
  assert.equal(rep.status, 200);
  assert.ok(rep.data.rows.length > 0);
});

test('link de cadastro: um ativo por vez, registra acessos e é revogado ao inativar o cadastro', async () => {
  const c = await call('c1', 'POST', '/api/cadastros', { name: 'Link Único', phone1: '11 95555-0101' });
  const id = c.data.id;
  const l = await call('c1', 'POST', `/api/cadastros/${id}/link-cliente`);
  assert.equal(l.status, 200);
  assert.equal((await call('c1', 'POST', `/api/cadastros/${id}/link-cliente`)).status, 409, 'não gera outro com um ativo');
  const k1 = await fichaKey(l.data.token, '11 95555-0101');
  await call(null, 'GET', `/api/publico/ficha?token=${encodeURIComponent(l.data.token)}`, undefined, { 'X-Ficha-Key': k1 });
  await call(null, 'GET', `/api/publico/ficha?token=${encodeURIComponent(l.data.token)}`, undefined, { 'X-Ficha-Key': k1 });
  let d = (await call('c1', 'GET', `/api/cadastros/${id}`)).data;
  assert.equal(d.client_link.token, l.data.token, 'a equipe pode copiar o link ativo novamente');
  assert.equal(d.client_link.access_count, 1, 'recarregar em seguida não conta novo acesso');
  assert.ok(d.client_link.first_used_at);
  // revogado com o cadastro ativo: pode gerar outro
  await call('c1', 'POST', `/api/cadastros/${id}/link-cliente/revogar`, { reason: 'Enviado ao número errado' });
  const l2 = await call('c1', 'POST', `/api/cadastros/${id}/link-cliente`);
  assert.equal(l2.status, 200);
  // inativar revoga automaticamente e bloqueia novos links
  assert.equal((await call('c1', 'PATCH', `/api/cadastros/${id}`, { active: false, inactive_reason: 'Sem interesse' })).status, 200);
  assert.equal((await call(null, 'GET', `/api/publico/ficha?token=${encodeURIComponent(l2.data.token)}`)).status, 401);
  assert.equal((await call('c1', 'POST', `/api/cadastros/${id}/link-cliente`)).status, 400);
  d = (await call('c1', 'GET', `/api/cadastros/${id}`)).data;
  assert.equal(d.active, 0);
  assert.equal(d.client_link, null);
  assert.equal(d.client_links.length, 2);
  assert.ok(d.client_links.every((x) => x.status === 'revogado' && x.token === undefined));
  const inactive = (await call('c1', 'GET', '/api/cadastros?active=0')).data.rows;
  assert.ok(inactive.some((r) => r.id === id));
  assert.equal((await call('c1', 'PATCH', `/api/cadastros/${id}`, { active: true })).status, 200);
  assert.equal((await call('c1', 'POST', `/api/cadastros/${id}/link-cliente`)).status, 200, 'reativado volta a gerar link');
});

test('documentos: equipe aprova direto, cliente aguarda validação, reprovação exige motivo e anexo vale para várias vendas', async () => {
  const c = await call('c1', 'POST', '/api/cadastros', { name: 'Docs Vendas', phone1: '11 95555-0102' });
  const id = c.data.id;
  const o2 = await call('c1', 'POST', '/api/oportunidades', { contact_id: id, credit_value: 50000 });
  assert.equal(o2.status, 200, JSON.stringify(o2.data));
  let d = (await call('c1', 'GET', `/api/cadastros/${id}`)).data;
  const oppIds = d.opportunities.map((o) => o.id);
  assert.equal(oppIds.length, 2);
  const team = await call('c1', 'POST', `/api/cadastros/${id}/anexos`, { doc_type: 'comprovante_endereco', filename: 'luz.pdf', content_base64: PDF, opportunity_ids: oppIds });
  assert.equal(team.status, 200);
  const other = await call('c2', 'POST', '/api/cadastros', { name: 'Outro Dono', phone1: '11 95555-0103' });
  const foreignOpp = (await call('c2', 'GET', `/api/cadastros/${other.data.id}`)).data.opportunities[0].id;
  assert.equal((await call('c1', 'POST', `/api/cadastros/${id}/anexos`, { doc_type: 'outro', filename: 'x.pdf', content_base64: PDF, opportunity_ids: [foreignOpp] })).status, 400);
  const l = await call('c1', 'POST', `/api/cadastros/${id}/link-cliente`);
  const lk = await fichaKey(l.data.token, d.phone1 || d.whatsapp);
  await call(null, 'POST', '/api/publico/ficha/anexo', { token: l.data.token, key: lk, doc_type: 'identificacao', filename: 'rg.pdf', content_base64: PDF });
  d = (await call('c1', 'GET', `/api/cadastros/${id}`)).data;
  const fromTeam = d.attachments.find((a) => a.id === team.data.id);
  const fromClient = d.attachments.find((a) => a.source === 'cliente');
  assert.equal(fromTeam.status, 'aprovado');
  assert.deepEqual(fromTeam.opportunity_ids.sort(), [...oppIds].sort());
  assert.equal(fromClient.status, 'recebido');
  const idItem = d.sale_checklist.items.find((i) => i.key === 'doc:identificacao');
  assert.equal(idItem.ok, false, 'documento do cliente só conta depois de aprovado');
  assert.equal(idItem.status, 'recebido');
  assert.equal((await call('c1', 'PATCH', `/api/anexos/${fromClient.id}`, { status: 'recusado' })).status, 400);
  assert.equal((await call('c1', 'PATCH', `/api/anexos/${fromClient.id}`, { status: 'recusado', notes: 'Foto ilegível' })).status, 200);
  d = (await call('c1', 'GET', `/api/cadastros/${id}`)).data;
  assert.equal(d.sale_checklist.items.find((i) => i.key === 'doc:identificacao').status, 'recusado');
  const again = await call(null, 'POST', '/api/publico/ficha/anexo', { token: l.data.token, key: lk, doc_type: 'identificacao', filename: 'rg2.pdf', content_base64: PDF });
  assert.equal(again.status, 200);
  const newest = (await call('c1', 'GET', `/api/cadastros/${id}`)).data.attachments.find((a) => a.filename === 'rg2.pdf');
  assert.equal((await call('c1', 'PATCH', `/api/anexos/${newest.id}`, { status: 'aprovado' })).status, 200);
  d = (await call('c1', 'GET', `/api/cadastros/${id}`)).data;
  assert.equal(d.sale_checklist.items.find((i) => i.key === 'doc:identificacao').ok, true);
  // Documentos obrigatórios: só identificação e comprovante de endereço
  assert.deepEqual(d.sale_checklist.items.filter((i) => i.group === 'Documentos').map((i) => i.key), ['doc:identificacao', 'doc:comprovante_endereco']);
  // vencido não conta
  const old = d.attachments.find((a) => a.id === team.data.id);
  assert.equal((await call('c1', 'PATCH', `/api/anexos/${old.id}`, { valid_until: '2020-01-01' })).status, 200);
  d = (await call('c1', 'GET', `/api/cadastros/${id}`)).data;
  assert.equal(d.sale_checklist.items.find((i) => i.key === 'doc:comprovante_endereco').status, 'vencido');
});

test('pós-venda: pesquisa NPS por link com histórico, cancelamento justificado e estratégia de lance', async () => {
  const c = await call('c1', 'POST', '/api/cadastros', { name: 'Cliente Pós', phone1: '11 95555-0104' });
  const id = c.data.id;
  await completeForSale(id);
  let d = (await call('c1', 'GET', `/api/cadastros/${id}`)).data;
  await sellViaFlow('c1', d.opportunities[0].id, 200000, { group_code: 'G1', quota_code: '10' });
  d = (await call('c1', 'GET', `/api/cadastros/${id}`)).data;
  assert.deepEqual(d.post_sale.map((p) => p.item), ['primeira_parcela', 'onboarding', 'acesso_cliente', 'recebimento_boletos', 'estrategia_lance', 'preferencias_contato', 'nps', 'indicacao']);
  const k = d.contracts[0];
  // NPS
  const n1 = await call('c1', 'POST', `/api/cadastros/${id}/nps`, { contract_id: k.id });
  assert.equal(n1.status, 200, JSON.stringify(n1.data));
  assert.equal((await call('c1', 'POST', `/api/cadastros/${id}/nps`, {})).status, 409, 'uma pesquisa pendente por vez');
  assert.equal((await call('c1', 'POST', `/api/nps/${n1.data.id}/cancelar`, {})).status, 400, 'cancelamento exige justificativa');
  assert.equal((await call('c1', 'POST', `/api/nps/${n1.data.id}/cancelar`, { reason: 'Cliente pediu para responder depois' })).status, 200);
  assert.equal((await call(null, 'GET', `/api/publico/nps?token=${n1.data.token}`)).data.status, 'cancelada');
  const n2 = await call('c1', 'POST', `/api/cadastros/${id}/nps`, {});
  const form = await call(null, 'GET', `/api/publico/nps?token=${n2.data.token}`);
  assert.equal(form.status, 200);
  assert.equal(form.data.status, 'pendente');
  assert.ok(form.data.questions.length >= 3);
  assert.equal((await call(null, 'POST', '/api/publico/nps', { token: n2.data.token, score: 11 })).status, 400);
  assert.equal((await call(null, 'POST', '/api/publico/nps', { token: n2.data.token, score: 5, answers: { atendimento: 3 }, comment: 'Demorou' })).status, 200);
  assert.equal((await call(null, 'POST', '/api/publico/nps', { token: n2.data.token, score: 9 })).status, 400, 'não responde duas vezes');
  assert.equal((await call('c1', 'POST', `/api/nps/${n2.data.id}/cancelar`, { reason: 'x' })).status, 400, 'respondida não é cancelada');
  d = (await call('c1', 'GET', `/api/cadastros/${id}`)).data;
  assert.deepEqual(d.nps_surveys.map((n) => n.status), ['respondida', 'cancelada'], 'nada é excluído');
  assert.equal(d.nps_score, 5);
  assert.ok(d.nps_surveys[0].first_access_at);
  assert.ok(d.tasks.some((t) => t.type === 'pos_venda' && /NPS/.test(t.title)), 'detrator gera tarefa');
  // Estratégia de lance
  assert.equal((await call('c1', 'POST', `/api/contratos/${k.id}/estrategia-lance`, { will_bid: true, bid_type: 'livre' })).status, 400, 'livre exige percentual');
  assert.equal((await call('c1', 'POST', `/api/contratos/${k.id}/estrategia-lance`, { will_bid: true, bid_type: 'livre', bid_pct: 30, use_embedded: true, use_fgts: true })).status, 200);
  d = (await call('c1', 'GET', `/api/cadastros/${id}`)).data;
  assert.equal(d.bid_strategies[0].bid_pct, 30);
  assert.equal(d.bid_strategies[0].use_fgts, 1);
  assert.ok(d.post_sale.find((p) => p.item === 'estrategia_lance').done_at, 'marca o item do checklist');
  assert.equal((await call('c2', 'POST', `/api/contratos/${k.id}/estrategia-lance`, { will_bid: false })).status, 404, 'fora do escopo');
});

test('simulação registra data, hora e autor; proposta abre o simulador com nome e contato', async () => {
  const c = await call('c1', 'POST', '/api/cadastros', { name: 'Maria Simulada', phone1: '11 95555-0105', whatsapp: '11 95555-0106' });
  const s = await call('c1', 'POST', `/api/cadastros/${c.data.id}/simulacao-rapida`, {});
  assert.equal(s.status, 200);
  const d = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data;
  assert.equal(d.simulations[0].code, s.data.code);
  assert.equal(d.simulations[0].user_name, 'Cons 1');
  assert.equal(d.simulations[0].credit_value, null);
  const p = await call('c1', 'POST', `/api/cadastros/${c.data.id}/simulador-proposta`, {});
  assert.equal(p.status, 200);
  const u = new URL(p.data.url, 'http://localhost');
  assert.equal(u.searchParams.get('nome'), 'Maria Simulada');
  assert.equal(u.searchParams.get('contato').replace(/\D/g, ''), '11955550106', 'usa o WhatsApp do cliente');
  assert.equal((await call('leitor', 'POST', `/api/cadastros/${c.data.id}/simulador-proposta`, {})).status, 403);
});

const userId = async (email) => (await call('admin', 'GET', '/api/usuarios')).data.find((u) => u.email === email).id;

test('funil: passagem sequencial com critérios de entrada; voltar exige motivo; administrador força com justificativa', async () => {
  const c = await call('c1', 'POST', '/api/cadastros', { name: 'Regras Funil', phone1: '11 94444-1001', origin: 'indicacao', relationship: 'lead' });
  const opp = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data.opportunities[0];
  const stages = (await call('c1', 'GET', '/api/meta')).data.stages;
  const st = (k) => stages.find((s) => s.key === k);
  assert.equal(opp.stage_id, st('lead').id, 'lead com contato entra em "Lead"');
  // Pular etapas não é permitido
  const skip = await call('c1', 'POST', `/api/oportunidades/${opp.id}/etapa`, { stage_id: st('negociacao').id });
  assert.equal(skip.status, 400);
  assert.match(skip.data.error, /pular etapas/);
  // Lead → Tentativa de contato: sem restrição
  const crit = await call('c1', 'GET', `/api/oportunidades/${opp.id}/criterios`);
  assert.equal(crit.data.next_stage.key, 'tentativa');
  assert.equal(crit.data.criteria.length, 0);
  assert.equal((await call('c1', 'POST', `/api/oportunidades/${opp.id}/etapa`, { stage_id: st('tentativa').id })).status, 200);
  // Lead qualificado exige objetivo, categoria de interesse, crédito desejado e prioridade (curto, médio ou longo prazo)
  const q = await call('c1', 'POST', `/api/oportunidades/${opp.id}/etapa`, { stage_id: st('qualificado').id });
  assert.equal(q.status, 400);
  assert.deepEqual(q.data.details.missing.map((m) => m.key), ['qualificacao']);
  assert.match(q.data.details.missing[0].label, /objetivo, categoria de interesse, crédito desejado e prioridade/);
  // Voltar exige motivo
  assert.equal((await call('c1', 'POST', `/api/oportunidades/${opp.id}/etapa`, { stage_id: st('lead').id })).status, 400);
  assert.equal((await call('c1', 'POST', `/api/oportunidades/${opp.id}/etapa`, { stage_id: st('lead').id, reason: 'Registrado por engano' })).status, 200);
  // Especialista não força; administrador força com justificativa (auditado)
  assert.equal((await call('c1', 'POST', `/api/oportunidades/${opp.id}/etapa`, { stage_id: st('r1').id, force: true, reason: 'x' })).status, 400);
  assert.equal((await call('admin', 'POST', `/api/oportunidades/${opp.id}/etapa`, { stage_id: st('r1').id, force: true })).status, 400, 'forçar exige justificativa');
  const f = await call('admin', 'POST', `/api/oportunidades/${opp.id}/etapa`, { stage_id: st('r1').id, force: true, reason: 'Migração de lead antigo com R1 marcada fora do CRM' });
  assert.equal(f.status, 200, JSON.stringify(f.data));
  // Nutrição exige motivo e data de retorno
  assert.equal((await call('c1', 'POST', `/api/oportunidades/${opp.id}/etapa`, { stage_id: st('nutricao').id })).status, 400);
});

test('funil: Prospect vai direto para Tentativa; R1 bolo só a partir da R1; R1 agendada pelo pop-up move o negócio', async () => {
  const stages = (await call('c1', 'GET', '/api/meta')).data.stages;
  const st = (k) => stages.find((s) => s.key === k);
  assert.ok(st('r1_bolo'), 'coluna R1 bolo existe');
  assert.ok(st('r1_bolo').position > st('r1').position && st('r1_bolo').position < st('negociacao').position, 'R1 bolo fica entre R1 e Negociação');
  const c = await call('c1', 'POST', '/api/cadastros', { name: 'Prospect Direto', phone1: '11 94444-1010', origin: 'indicacao', relationship: 'prospect' });
  const opp = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data.opportunities[0];
  assert.equal(opp.stage_id, st('prospect').id);
  assert.equal((await call('c1', 'POST', `/api/oportunidades/${opp.id}/etapa`, { stage_id: st('tentativa').id })).status, 200, 'Prospect → Tentativa sem restrição');
  // R1 bolo só a partir da R1
  const bolo1 = await call('c1', 'POST', `/api/oportunidades/${opp.id}/etapa`, { stage_id: st('r1_bolo').id });
  assert.equal(bolo1.status, 400);
  assert.match(bolo1.data.error, /Só negócios em "R1"/);
  await call('c1', 'PATCH', `/api/oportunidades/${opp.id}`, { objective_type: 'aquisicao', credit_category: 'imovel', credit_value: 300000, urgency: 'curto' });
  assert.equal((await call('c1', 'POST', `/api/oportunidades/${opp.id}/etapa`, { stage_id: st('qualificado').id })).status, 200);
  // Sem R1 agendada não entra em R1
  assert.equal((await call('c1', 'POST', `/api/oportunidades/${opp.id}/etapa`, { stage_id: st('r1').id })).status, 400);
  // Pop-up "Agendar R1": cliente, e-mail, horário (30 min) e move para R1
  const ctx = await call('c1', 'GET', `/api/r1/contexto?contact_id=${c.data.id}`);
  assert.equal(ctx.status, 200, JSON.stringify(ctx.data));
  assert.equal(ctx.data.title, '[R1] Prospect Direto | Vero Consórcios');
  assert.equal(ctx.data.duration_min, 30);
  assert.equal(ctx.data.google.configured, false);
  const start = new Date(Date.now() + 2 * 86400000);
  start.setUTCHours(17, 0, 0, 0);
  const bad = await call('c1', 'POST', '/api/r1/agendar', { contact_id: c.data.id, start_at: start.toISOString(), end_at: start.toISOString() });
  assert.equal(bad.status, 400, 'término depois do início');
  const r = await call('c1', 'POST', '/api/r1/agendar', { contact_id: c.data.id, opportunity_id: opp.id, start_at: start.toISOString(), end_at: new Date(start.getTime() + 30 * 60000).toISOString(), email: 'prospect.direto@exemplo.com', video: true, move_to_r1: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.moved, true);
  assert.equal(r.data.google.synced, false);
  assert.equal(r.data.google.reason, 'nao_configurado');
  assert.match(r.data.calendar_link, /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);
  assert.match(r.data.calendar_link, /add=prospect.direto%40exemplo.com/);
  const after = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data;
  assert.equal(after.email, 'prospect.direto@exemplo.com', 'e-mail informado no agendamento completa o cadastro');
  assert.equal(after.opportunities[0].stage_id, st('r1').id);
  const task = after.tasks.find((t) => t.id === r.data.task_id);
  assert.equal(task.type, 'reuniao');
  assert.equal(Date.parse(task.ends_at) - Date.parse(task.due_at), 30 * 60000);
  // Modelo da R1 em HTML: nome, foto e contato do especialista + nome do cliente
  await call('c1', 'PATCH', '/api/perfil', { whatsapp: '51 98912-1113', job_title: 'Especialista em consórcios' });
  const page = await fetch(`${base}/api/r1/modelo?task_id=${r.data.task_id}`, { headers: { Cookie: sessions.c1 } });
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  const htmlText = await page.text();
  assert.match(htmlText, /Cons 1/);
  assert.match(htmlText, /Prospect Direto/);
  assert.match(htmlText, /\(51\) 98912-1113/);
  assert.match(htmlText, /https:\/\/wa\.me\/5551989121113/);
  assert.match(htmlText, /data:image\/svg\+xml;base64/, 'sem foto: iniciais');
  assert.doesNotMatch(htmlText, /\{\{especialista_/);
  const js = await call('c1', 'GET', `/api/r1/modelo?task_id=${r.data.task_id}&formato=json`);
  assert.equal(js.data.specialist, 'Cons 1');
  // Modelo personalizado pelo administrador
  assert.equal((await call('c1', 'PUT', '/api/r1/modelo-config', { html: '<html>x</html>' })).status, 403);
  assert.equal((await call('admin', 'PUT', '/api/r1/modelo-config', { html: 'sem tag' })).status, 400);
  assert.equal((await call('admin', 'PUT', '/api/r1/modelo-config', { html: '<html><body>{{especialista_nome}} · {{cliente_nome}} <script>alert(1)</script></body></html>' })).status, 200);
  const custom = await call('c1', 'GET', `/api/r1/modelo?task_id=${r.data.task_id}&formato=json`);
  assert.match(custom.data.html, /Cons 1 · Prospect Direto/);
  assert.equal((await call('admin', 'PUT', '/api/r1/modelo-config', { html: '' })).data.custom, false);
  // Link da reunião informado à mão
  assert.equal((await call('c1', 'PATCH', `/api/tarefas/${task.id}/link`, { meeting_url: 'http://x' })).status, 400);
  assert.equal((await call('c1', 'PATCH', `/api/tarefas/${task.id}/link`, { meeting_url: 'https://meet.google.com/abc-defg-hij' })).status, 200);
  // Cliente não compareceu: R1 → R1 bolo (justificativa opcional); de R1 bolo volta para R1 com nova reunião
  assert.equal((await call('c1', 'POST', `/api/oportunidades/${opp.id}/etapa`, { stage_id: st('r1_bolo').id, reason: 'Não entrou na chamada' })).status, 200);
  const back = await call('c1', 'POST', `/api/oportunidades/${opp.id}/etapa`, { stage_id: st('r1').id });
  assert.equal(back.status, 200, 'a R1 pendente (futura) continua valendo');
});

test('Google Agenda: configuração pelo administrador, conexão do especialista e R1 com Google Meet e convite ao cliente', async () => {
  assert.equal((await call('c1', 'PUT', '/api/google/config', { client_id: 'x.apps.googleusercontent.com', client_secret: 's' })).status, 403);
  assert.equal((await call('admin', 'PUT', '/api/google/config', { client_id: 'abc' })).status, 400);
  const cfg = await call('admin', 'PUT', '/api/google/config', { client_id: '123-abc.apps.googleusercontent.com', client_secret: 'segredo', public_url: 'https://crm.vero.test' });
  assert.equal(cfg.status, 200, JSON.stringify(cfg.data));
  assert.equal(cfg.data.configured, true);
  assert.equal(cfg.data.redirect_uri, 'https://crm.vero.test/api/google/retorno');
  const st = await call('c1', 'GET', '/api/google/status');
  assert.equal(st.data.client_id, undefined, 'especialista não vê o ID do cliente OAuth');
  assert.equal(st.data.connected, false);
  const con = await call('c1', 'POST', '/api/google/conectar');
  const authUrl = new URL(con.data.url);
  assert.equal(authUrl.host, 'accounts.google.com');
  assert.match(authUrl.searchParams.get('scope'), /calendar\.events/);
  assert.equal(authUrl.searchParams.get('access_type'), 'offline');
  // Google simulado: troca do código, token de acesso e criação do evento com Meet
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith('https://oauth2.googleapis.com/token')) {
      seen.push(['token', String(opts.body)]);
      const idt = `x.${Buffer.from(JSON.stringify({ email: 'consultor@gmail.com' })).toString('base64url')}.y`;
      return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, id_token: idt }), { status: 200 });
    }
    if (u.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events')) {
      seen.push([opts.method, u, opts.body ? JSON.parse(opts.body) : null]);
      return new Response(JSON.stringify({ id: 'evt1', hangoutLink: 'https://meet.google.com/aaa-bbbb-ccc', htmlLink: 'https://calendar.google.com/event?eid=1' }), { status: 200 });
    }
    return realFetch(url, opts);
  };
  try {
    const cb = await fetch(`${base}/api/google/retorno?code=abc&state=${authUrl.searchParams.get('state')}`, { redirect: 'manual' });
    assert.equal(cb.status, 302);
    assert.equal(cb.headers.get('location'), '/#/meu-cadastro?google=ok');
    const st2 = await call('c1', 'GET', '/api/google/status');
    assert.equal(st2.data.connected, true);
    assert.equal(st2.data.google_email, 'consultor@gmail.com');
    const c = await call('c1', 'POST', '/api/cadastros', { name: 'Cliente Meet', phone1: '11 94444-1020', email: 'cliente.meet@exemplo.com', origin: 'indicacao' });
    const start = new Date(Date.now() + 3 * 86400000);
    start.setUTCHours(17, 15, 0, 0);
    const r = await call('c1', 'POST', '/api/r1/agendar', { contact_id: c.data.id, start_at: start.toISOString(), end_at: new Date(start.getTime() + 45 * 60000).toISOString(), video: true });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.google.synced, true);
    assert.equal(r.data.google.invited, true);
    assert.equal(r.data.meeting_url, 'https://meet.google.com/aaa-bbbb-ccc');
    const [method, url, ev] = seen.find((x) => x[0] === 'POST');
    assert.match(url, /conferenceDataVersion=1&sendUpdates=all/);
    assert.equal(ev.summary, '[R1] Cliente Meet | Vero Consórcios');
    assert.equal(ev.attendees[0].email, 'cliente.meet@exemplo.com');
    assert.equal(ev.conferenceData.createRequest.conferenceSolutionKey.type, 'hangoutsMeet');
    assert.equal(Date.parse(ev.end.dateTime) - Date.parse(ev.start.dateTime), 45 * 60000);
    const task = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data.tasks.find((t) => t.id === r.data.task_id);
    assert.equal(task.meeting_url, 'https://meet.google.com/aaa-bbbb-ccc');
    assert.equal(task.google_event_id, 'evt1');
    // Reagendar no CRM leva a mudança ao Google (mantém a duração)
    const later = new Date(start.getTime() + 86400000).toISOString();
    const up = await call('c1', 'PATCH', `/api/tarefas/${task.id}`, { due_at: later });
    assert.equal(up.data.google.synced, true);
    const patchCall = seen.find((x) => x[0] === 'PATCH');
    assert.match(patchCall[1], /events\/evt1/);
    assert.equal(Date.parse(patchCall[2].end.dateTime) - Date.parse(patchCall[2].start.dateTime), 45 * 60000);
    // Cancelar a R1 remove o evento (e o Google avisa o cliente)
    await call('c1', 'PATCH', `/api/tarefas/${task.id}`, { action: 'cancelar' });
    assert.ok(seen.some((x) => x[0] === 'DELETE' && /sendUpdates=all/.test(x[1])));
    assert.equal((await call('c1', 'POST', '/api/google/desconectar')).status, 200);
    assert.equal((await call('c1', 'GET', '/api/google/status')).data.connected, false);
  } finally {
    globalThis.fetch = realFetch;
    await call('admin', 'PUT', '/api/google/config', { client_id: '', client_secret: '', public_url: '' });
  }
});

/** Servidor SMTP de teste (local): guarda as linhas recebidas em got. */
async function fakeSmtp() {
  const net = require('node:net');
  const got = [];
  const server = net.createServer((sock) => {
    let data = false;
    let buf = '';
    sock.write('220 teste ESMTP\r\n');
    sock.on('data', (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (data) {
          if (line === '.') {
            data = false;
            sock.write('250 OK queued\r\n');
          } else got.push(line);
          continue;
        }
        got.push(line);
        if (/^EHLO/.test(line)) sock.write('250-teste\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (/^AUTH PLAIN/.test(line)) sock.write('235 ok\r\n');
        else if (/^(MAIL|RCPT)/.test(line)) sock.write('250 ok\r\n');
        else if (line === 'DATA') {
          data = true;
          sock.write('354 go\r\n');
        } else if (line === 'QUIT') sock.end('221 bye\r\n');
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { got, port: server.address().port, close: () => server.close() };
}

test('R1 pelo Google Meet: link automático, confirmação por e-mail (noreply@) e "R1 feita" só quando alguém de fora da empresa entra', async () => {
  await call('admin', 'PUT', '/api/google/config', { client_id: '123-abc.apps.googleusercontent.com', client_secret: 'segredo', public_url: 'https://crm.vero.test' });
  const smtp = await fakeSmtp();
  await call('admin', 'PUT', '/api/email/config', { host: '127.0.0.1', port: smtp.port, security: 'none', user: 'noreply@veroconsorciosbr.com.br', password: 'segredo' });
  const con = await call('c1', 'POST', '/api/google/conectar', { popup: true });
  const state = new URL(con.data.url).searchParams.get('state');
  assert.match(new URL(con.data.url).searchParams.get('scope'), /meetings\.space\.readonly/);
  const me = (await call('c1', 'GET', '/api/perfil')).data;
  let room = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith('https://oauth2.googleapis.com/token')) {
      const idt = `x.${Buffer.from(JSON.stringify({ email: 'especialista@gmail.com', sub: '1001' })).toString('base64url')}.y`;
      return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, id_token: idt, scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/meetings.space.readonly openid email' }), { status: 200 });
    }
    if (u.startsWith('https://www.googleapis.com/calendar/v3/')) return new Response(JSON.stringify({ id: 'evt9', hangoutLink: 'https://meet.google.com/xyz-abcd-efg', htmlLink: 'https://calendar.google.com/e' }), { status: 200 });
    if (u.startsWith('https://meet.googleapis.com/v2/conferenceRecords?')) {
      assert.match(decodeURIComponent(u), /space\.meeting_code = "xyz-abcd-efg"/);
      return new Response(JSON.stringify(room.length ? { conferenceRecords: [{ name: 'conferenceRecords/r1' }] } : {}), { status: 200 });
    }
    if (u.startsWith('https://meet.googleapis.com/v2/conferenceRecords/r1/participants')) return new Response(JSON.stringify({ participants: room }), { status: 200 });
    return realFetch(url, opts);
  };
  try {
    const cb = await fetch(`${base}/api/google/retorno?code=abc&state=${state}`, { redirect: 'manual' });
    assert.equal(cb.headers.get('location'), '/#/meu-cadastro?google=ok&fechar=1', 'aberta pelo pop-up: a guia se fecha sozinha');
    const st = (await call('c1', 'GET', '/api/google/status')).data;
    assert.equal(st.meet_access, true);
    assert.equal(st.needs_reconnect, false);
    const c = await call('c1', 'POST', '/api/cadastros', { name: 'Cliente Presença', phone1: '11 94444-7070', email: 'cliente.presenca@exemplo.com', origin: 'indicacao' });
    const start = new Date(Date.now() + 10 * 60000);
    const r = await call('c1', 'POST', '/api/r1/agendar', { contact_id: c.data.id, start_at: start.toISOString(), end_at: new Date(start.getTime() + 30 * 60000).toISOString(), video: true, logo_url: 'https://crm.vero.test/img/vero-logo-dark.png' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.meeting_url, 'https://meet.google.com/xyz-abcd-efg', 'link do Meet salvo na R1 sem segundo passo');
    // Confirmação por e-mail para o cliente, remetente noreply@
    assert.equal(r.data.confirmation.sent, true, JSON.stringify(r.data.confirmation));
    assert.ok(smtp.got.includes('MAIL FROM:<noreply@veroconsorciosbr.com.br>'));
    assert.ok(smtp.got.includes('RCPT TO:<cliente.presenca@exemplo.com>'));
    const mailHtml = Buffer.from(smtp.got.join('\n').split('Content-Type: text/html; charset=utf-8')[1].split('\n\n')[1].split('--vero')[0].replace(/\s/g, ''), 'base64').toString('utf8');
    assert.match(mailHtml, /Entrar na reunião/);
    assert.match(mailHtml, /meet\.google\.com\/xyz-abcd-efg/);
    // Modelo da R1 liberado para baixar
    const dl = await fetch(`${base}/api/r1/modelo?task_id=${r.data.task_id}&baixar=1`, { headers: { Cookie: sessions.c1, 'X-Requested-With': 'crm' } });
    assert.equal(dl.status, 200);
    assert.match(dl.headers.get('content-disposition'), /attachment; filename="R1 - Cliente Presenca\.html"/);
    const page = await dl.text();
    assert.match(page, /Cliente Presença/);
    assert.match(page, new RegExp(me.name));
    assert.ok(!/\{\{\s*especialista_nome\s*\}\}/.test(page));
    const presenca = () => call('c1', 'POST', `/api/tarefas/${r.data.task_id}/presenca`);
    // Ninguém na sala; depois só o especialista; depois o especialista e um colega da empresa: não conta
    assert.equal((await presenca()).data.status, 'aguardando');
    const t0 = new Date(start.getTime() + 60000).toISOString();
    room = [{ signedinUser: { user: 'users/1001', displayName: 'Outro Nome Na Conta' }, earliestStartTime: t0 }];
    assert.equal((await presenca()).data.status, 'aguardando', 'especialista sozinho não conta');
    room.push({ signedinUser: { user: 'users/2002', displayName: 'Administrador Teste' }, earliestStartTime: t0 });
    const adminName = (await call('admin', 'GET', '/api/perfil')).data.name;
    room[1].signedinUser.displayName = adminName;
    const p2 = (await presenca()).data;
    assert.equal(p2.status, 'aguardando', 'só pessoas da empresa não contam');
    assert.ok(p2.participants.every((p) => p.internal));
    // O cliente entra (convidado sem conta Google): R1 feita, no horário em que entrou
    const t1 = new Date(start.getTime() + 4 * 60000).toISOString();
    room.push({ anonymousUser: { displayName: 'Cliente Presença' }, earliestStartTime: t1 });
    room[2].anonymousUser.displayName = 'Cliente (celular)';
    const p3 = (await presenca()).data;
    assert.equal(p3.status, 'r1_feita', JSON.stringify(p3));
    assert.equal(p3.attended_at, t1);
    const rec = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data;
    const task = rec.tasks.find((t) => t.id === r.data.task_id);
    assert.equal(task.status, 'concluida');
    assert.equal(task.outcome, 'realizada');
    assert.equal(task.attendance_status, 'r1_feita');
    assert.equal(task.completed_at, t1);
    assert.ok(rec.activities?.some?.((a) => a.type === 'reuniao_realizada') ?? true);
    // Regra da etapa "R1 realizada" passa a valer para o negócio
    const opp = rec.opportunities[0];
    const chk = await call('c1', 'GET', `/api/oportunidades/${opp.id}`);
    assert.equal(chk.status, 200);
  } finally {
    globalThis.fetch = realFetch;
    smtp.close();
    await call('c1', 'POST', '/api/google/desconectar');
    await call('admin', 'PUT', '/api/google/config', { client_id: '', client_secret: '', public_url: '' });
    await call('admin', 'PUT', '/api/email/config', { host: '', user: '', password: '', clear_password: true });
  }
});

test('presença no Meet: classificação dos participantes e decisão', () => {
  const { DatabaseSync } = require('node:sqlite');
  const m = require('../server/services/meetings');
  assert.equal(m.meetCode('https://meet.google.com/abc-defg-hij?authuser=0'), 'abc-defg-hij');
  assert.equal(m.meetCode('https://zoom.us/j/1'), null);
  const one = [{ name: 'A', internal: true, joined_at: '2026-01-01T10:00:00Z' }];
  assert.equal(m.decideAttendance(one).status, 'aguardando');
  assert.equal(m.decideAttendance([...one, { name: 'B', internal: true, joined_at: '2026-01-01T10:01:00Z' }]).status, 'aguardando');
  const d = m.decideAttendance([{ name: 'A', internal: true, joined_at: '2026-01-01T10:05:00Z' }, { name: 'C', internal: false, joined_at: '2026-01-01T10:02:00Z' }]);
  assert.deepEqual(d, { status: 'r1_feita', at: '2026-01-01T10:05:00Z' }, 'vale o momento em que os dois estavam na sala');
  assert.equal(m.decideAttendance([{ name: 'C', internal: false, joined_at: 'x' }, { name: 'D', internal: false, joined_at: 'y' }]).status, 'r1_feita', 'dois de fora da empresa também contam');
  void DatabaseSync;
});

test('planos e administradoras: faixa de crédito com incremento, comissão em parcelas e visão restrita ao administrador', async () => {
  const plan = await ensurePlan();
  const chk = async (v) => (await call('c1', 'GET', `/api/planos/${plan.id}/verificar-credito?valor=${v}`)).data.error;
  assert.equal(await chk(150000), null);
  assert.match(await chk(155000), /de R\$/);
  assert.match(await chk(350000), /até/);
  assert.equal((await call('admin', 'POST', '/api/planos', { name: 'X', credit_min: 100000, credit_max: 185000, credit_step: 10000 })).status, 400, 'faixa precisa ser múltipla do incremento');
  assert.equal((await call('c1', 'POST', '/api/planos', { name: 'Y' })).status, 403);
  const admView = (await call('admin', 'GET', '/api/administradoras')).data.find((a) => a.id === plan.administrator_id);
  assert.equal(admView.commission_total, 0.6);
  const consView = (await call('c1', 'GET', '/api/administradoras')).data.find((a) => a.id === plan.administrator_id);
  assert.equal(consView.commercial_name, undefined, 'especialista não vê contatos e políticas');
  assert.equal(consView.name, 'Adm Teste');
});

test('venda: comissão em parcelas com carência, cancelamento com motivo concreto, estorno e índice por especialista', async () => {
  const c = await call('c1', 'POST', '/api/cadastros', { name: 'Cliente Comissão', phone1: '11 94444-2002' });
  await completeForSale(c.data.id);
  const opp = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data.opportunities[0];
  // Crédito fora do incremento do plano é recusado no termo de adesão
  const plan = await ensurePlan();
  const ps = await call('c1', 'POST', '/api/pre-vendas', { opportunity_id: opp.id });
  assert.equal((await call('c1', 'POST', `/api/pre-vendas/${ps.data.id}/avancar`, { step: 'conferido' })).status, 200);
  assert.equal((await call('c1', 'POST', `/api/pre-vendas/${ps.data.id}/avancar`, { step: 'contrato_assinado' })).status, 400, 'segue a sequência');
  assert.equal((await call('c1', 'POST', `/api/pre-vendas/${ps.data.id}/avancar`, { step: 'termo_adesao', plan_id: plan.id, quotas: [{ credit_value: 205000, group_code: 'G9', quota_code: '1', contract_number: 'X1' }] })).status, 400, 'crédito fora do incremento');
  assert.equal((await call('c1', 'POST', `/api/pre-vendas/${ps.data.id}/avancar`, { step: 'termo_adesao', plan_id: plan.id, quotas: [{ credit_value: 200000 }] })).status, 400, 'grupo, cota e contrato obrigatórios');
  assert.equal((await call('c1', 'POST', `/api/pre-vendas/${ps.data.id}/avancar`, { step: 'cancelar' })).status, 400);
  await call('c1', 'POST', `/api/pre-vendas/${ps.data.id}/cancelar`, { reason: 'refazer no teste' });
  const { sale } = await sellViaFlow('c1', opp.id, 200000);
  const s = (await call('c1', 'GET', `/api/vendas/${sale.id}`)).data;
  assert.equal(s.status, 'confirmada');
  assert.match(s.code, /^VD-/);
  // Comissões: 0,3% em carência de 7 dias + 3 parcelas de 0,1%
  const comm = (await call('c1', 'GET', '/api/comissoes')).data.rows.filter((r) => r.sale_id === sale.id);
  assert.deepEqual(comm.map((r) => r.amount).sort((a, b) => a - b), [200, 200, 200, 600]);
  const first = comm.find((r) => r.installment_no === 1);
  assert.equal(first.status, 'prevista');
  assert.equal((await call('admin', 'POST', '/api/comissoes/pagar', { ids: [first.id] })).status, 400, 'prevista não é paga');
  assert.equal((await call('c2', 'GET', '/api/comissoes')).data.rows.filter((r) => r.sale_id === sale.id).length, 0, 'outro especialista não vê');
  // Libera a primeira parcela (simula fim da carência) e paga
  appDb.prepare("UPDATE commission_entries SET release_on = '2000-01-01' WHERE id = ?").run(first.id);
  appDb.prepare("UPDATE commission_entries SET status = 'liberada' WHERE id = ?").run(first.id);
  assert.equal((await call('admin', 'POST', '/api/comissoes/pagar', { ids: [first.id] })).status, 200);
  // Cancelamento: especialista não registra; motivo concreto obrigatório
  assert.equal((await call('c1', 'POST', `/api/vendas/${sale.id}/cancelamento`, { reason: 'dificuldade_financeira', description: 'Perdeu o emprego no mês seguinte' })).status, 403);
  assert.equal((await call('gestor', 'POST', `/api/vendas/${sale.id}/cancelamento`, { reason: 'dificuldade_financeira', description: 'curto' })).status, 400);
  const cn = await call('gestor', 'POST', `/api/vendas/${sale.id}/cancelamento`, { reason: 'dificuldade_financeira', description: 'Cliente perdeu o emprego e pediu o cancelamento', responsible_id: await userId('c1@t.com') });
  assert.equal(cn.status, 200, JSON.stringify(cn.data));
  assert.equal(cn.data.chargeback, 600, 'estorna a parcela já paga');
  const after = (await call('c1', 'GET', '/api/comissoes')).data.rows.filter((r) => r.sale_id === sale.id);
  assert.ok(after.filter((r) => r.kind === 'comissao' && r.status !== 'paga').every((r) => r.status === 'cancelada'));
  assert.ok(after.some((r) => r.kind === 'estorno' && r.amount === -600));
  const ind = (await call('gestor', 'GET', '/api/cancelamentos/indicadores')).data.rows.find((r) => r.name === 'Cons 1');
  assert.ok(ind.cancelamentos >= 1 && ind.taxa > 0);
  assert.equal((await call('c1', 'GET', '/api/cancelamentos')).data.length >= 1, true);
});

test('proposta enviada inicia a esteira de follow-up (D0…D10); resposta negativa cria tarefa de revisão; aceite para a esteira', async () => {
  const c = await call('c1', 'POST', '/api/cadastros', { name: 'Cliente Esteira', phone1: '11 94444-3003' });
  const opp = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data.opportunities[0];
  const p = await call('c1', 'POST', '/api/propostas', { opportunity_id: opp.id, credit_value: 150000 });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.equal((await call('c1', 'POST', `/api/propostas/${p.data.id}/status`, { status: 'apresentada', sent_channel: 'whatsapp' })).status, 200);
  let tasks = (await call('c1', 'GET', `/api/tarefas?contact_id=${c.data.id}&status=pendente`)).data.rows.filter((t) => t.type === 'follow_up_proposta');
  assert.ok(tasks.length >= 5, 'D1, D2, D3, D5 e D10 (e D0 se enviada pela manhã)');
  assert.ok(tasks.some((t) => t.cadence_step === 'D10' && t.priority === 'alta'));
  const pan = (await call('c1', 'GET', '/api/propostas-panorama')).data;
  const row = pan.rows.find((r) => r.id === p.data.id);
  assert.ok(row.probability >= 5 && row.probability <= 95);
  assert.ok(row.next_followup);
  assert.equal((await call('c1', 'POST', `/api/propostas/${p.data.id}/resposta`, { response: 'negativa' })).status, 200);
  tasks = (await call('c1', 'GET', `/api/tarefas?contact_id=${c.data.id}&status=pendente`)).data.rows;
  assert.ok(tasks.some((t) => t.type === 'revisar_proposta'));
  assert.equal((await call('c1', 'POST', `/api/propostas/${p.data.id}/status`, { status: 'aprovada', accepted_channel: 'whatsapp' })).status, 200);
  tasks = (await call('c1', 'GET', `/api/tarefas?contact_id=${c.data.id}&status=pendente`)).data.rows;
  assert.equal(tasks.filter((t) => t.type === 'follow_up_proposta').length, 0, 'aceite encerra a esteira');
  assert.ok((await call('c1', 'GET', '/api/pre-vendas')).data.rows.some((r) => r.proposal_id === p.data.id), 'aceite abre a pré-venda');
  // Nova proposta exige cadastro com nome e contato
  const semTel = await call('c1', 'POST', '/api/cadastros', { name: 'Sem Telefone', email: 'semtel@x.com' });
  assert.equal((await call('c1', 'POST', '/api/propostas/iniciar', { contact_id: semTel.data.id })).status, 400);
  const ini = await call('c1', 'POST', '/api/propostas/iniciar', { contact_id: c.data.id });
  assert.equal(ini.status, 200, JSON.stringify(ini.data));
  assert.match(ini.data.url, /nome=/);
});

test('distribuição: fila só para quem tem o módulo, roleta alterna especialistas e cria tarefa de primeiro contato', async () => {
  assert.equal((await call('c1', 'GET', '/api/distribuicao')).status, 403);
  const ids = [await userId('c1@t.com'), await userId('c2@t.com')];
  assert.equal((await call('gestor', 'PATCH', '/api/distribuicao/roleta', { participants: [] })).status, 400, 'só o administrador configura');
  const rr = await call('admin', 'PATCH', '/api/distribuicao/roleta', { mode: 'sequencial', participants: ids.map((user_id) => ({ user_id, active: true, weight: 1 })), first_contact_hours: 1 });
  assert.equal(rr.status, 200, JSON.stringify(rr.data));
  const leads = [];
  for (const n of [1, 2]) leads.push((await call('admin', 'POST', '/api/cadastros', { name: `Sem dono ${n}`, phone1: `11 93333-00${n}0`, owner_id: '' })).data.id);
  const q = (await call('admin', 'GET', '/api/distribuicao')).data;
  assert.ok(leads.every((id) => q.rows.some((r) => r.id === id)));
  const d = await call('admin', 'POST', '/api/distribuicao', { contact_ids: leads, method: 'roleta' });
  assert.equal(d.status, 200, JSON.stringify(d.data));
  assert.deepEqual(d.data.result.map((r) => r.user_id).sort(), ids.slice().sort(), 'um para cada especialista');
  const t = (await call('admin', 'GET', `/api/tarefas?contact_id=${leads[0]}`)).data.rows;
  assert.ok(t.some((x) => x.type === 'primeiro_contato'));
});

test('metas por especialista e equipe; realizado considera vendas confirmadas; só o administrador cadastra', async () => {
  const month = todayStr().slice(0, 7);
  const c1 = await userId('c1@t.com');
  assert.equal((await call('c1', 'POST', '/api/metas', { month, items: [] })).status, 403);
  const r = await call('admin', 'POST', '/api/metas', { month, items: [{ scope: 'user', user_id: c1, target_credit: 1000000, target_sales: 5 }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const b = (await call('c1', 'GET', `/api/metas?month=${month}`)).data;
  const me = b.people.find((p) => p.id === c1);
  assert.equal(me.target_credit, 1000000);
  assert.ok(me.realized_credit >= 200000, 'vendas confirmadas no mês contam');
  assert.equal(me.missing_credit, 1000000 - me.realized_credit);
  assert.equal(b.can_edit, false);
  const home = (await call('c1', 'GET', '/api/inicio')).data;
  assert.equal(home.goal.target_credit, 1000000);
  assert.ok(Array.isArray(home.actions));
});

test('permissões por módulo: perfil define o padrão e o administrador inclui ou retira telas por usuário', async () => {
  const c2 = await userId('c2@t.com');
  const u = (await call('admin', 'GET', '/api/usuarios')).data.find((x) => x.id === c2);
  assert.ok(!u.effective_modules.includes('distribuicao'));
  assert.equal((await call('c2', 'GET', '/api/distribuicao')).status, 403);
  const save = await call('admin', 'POST', '/api/usuarios', { ...u, id: c2, modules: { add: ['distribuicao', 'usuarios'], remove: ['metas'] } });
  assert.equal(save.status, 200, JSON.stringify(save.data));
  const meta = (await call('c2', 'GET', '/api/meta')).data;
  assert.ok(meta.user.modules.includes('distribuicao'));
  assert.ok(!meta.user.modules.includes('metas'));
  assert.ok(!meta.user.modules.includes('usuarios'), 'Usuários é exclusivo do administrador');
  assert.equal((await call('c2', 'GET', '/api/distribuicao')).status, 200);
  assert.equal((await call('c2', 'GET', '/api/permissoes')).status, 403);
  const m = (await call('admin', 'GET', '/api/permissoes')).data;
  assert.equal(m.roles.find((r) => r.key === 'gestor').label, 'Líder de equipe');
  await call('admin', 'POST', '/api/usuarios', { ...u, id: c2, modules: { add: [], remove: [] } });
});

test('treinamentos: material com questionário, nota mínima, obrigatório por perfil e acompanhamento', async () => {
  const t = await call('admin', 'POST', '/api/treinamentos', {
    title: 'Como funciona o lance embutido', category: 'lances', kind: 'texto', content: 'O lance embutido usa parte da carta…', required_roles: ['consultor'], pass_score: 100,
    quiz: [{ question: 'O lance embutido usa…', options: ['recursos próprios', 'parte do crédito'], correct: 1 }],
  });
  assert.equal(t.status, 200, JSON.stringify(t.data));
  assert.equal((await call('c1', 'POST', '/api/treinamentos', { title: 'x' })).status, 403);
  const list = (await call('c1', 'GET', '/api/treinamentos')).data;
  assert.ok(list.summary.obrigatorios_pendentes >= 1);
  const open = (await call('c1', 'GET', `/api/treinamentos/${t.data.id}`)).data;
  assert.equal(open.quiz[0].correct, undefined, 'gabarito não vai para o especialista');
  assert.equal((await call('c1', 'POST', `/api/treinamentos/${t.data.id}/concluir`, { answers: [0] })).data.passed, false);
  assert.equal((await call('c1', 'POST', `/api/treinamentos/${t.data.id}/concluir`, { answers: [1] })).data.passed, true);
  const tr = (await call('admin', 'GET', '/api/treinamentos/acompanhamento')).data;
  const row = tr.users.find((x) => x.name === 'Cons 1');
  assert.equal(row.cells.find((c) => c.training_id === t.data.id).status, 'concluido');
  assert.equal((await call('c1', 'GET', '/api/treinamentos/acompanhamento')).status, 403);
});

test('ficha do cliente: acesso e conclusão pelo link atualizam a pré-venda; conclusão exige ficha completa', async () => {
  const c = await call('c1', 'POST', '/api/cadastros', { name: 'Cliente Link PV', phone1: '11 94444-4004' });
  const opp = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data.opportunities[0];
  const ps = await call('c1', 'POST', '/api/pre-vendas', { opportunity_id: opp.id });
  let d = (await call('c1', 'GET', `/api/pre-vendas/${ps.data.id}`)).data;
  assert.equal(d.status, 'link_gerado');
  const token = d.link_url.split('/ficha/')[1];
  const key = await fichaKey(token, '11 94444-4004');
  assert.equal((await call(null, 'GET', `/api/publico/ficha?token=${token}`, undefined, { 'X-Ficha-Key': key })).status, 200);
  d = (await call('c1', 'GET', `/api/pre-vendas/${ps.data.id}`)).data;
  assert.equal(d.status, 'acessado');
  const inc = await call(null, 'POST', '/api/publico/ficha/concluir', { token, key });
  assert.equal(inc.status, 400, 'ficha incompleta');
  assert.ok(inc.data.details.missing.some((m) => m.key === 'doc'), 'lista os campos que faltam (destacados em vermelho na ficha)');
  await completeForSale(c.data.id);
  assert.equal((await call(null, 'POST', '/api/publico/ficha/concluir', { token, key })).status, 200);
  d = (await call('c1', 'GET', `/api/pre-vendas/${ps.data.id}`)).data;
  assert.equal(d.status, 'preenchido');
});

test('meu cadastro: dados do próprio usuário, foto validada e e-mail mantido pelo administrador', async () => {
  const p = await call('c1', 'GET', '/api/perfil');
  assert.equal(p.status, 200);
  assert.equal(p.data.role_label, 'Especialista');
  const r = await call('c1', 'PATCH', '/api/perfil', { name: 'Cons 1', job_title: 'Especialista imobiliário', phone: '(11) 98888-0000', email: 'hack@x.com', specialties: ['imovel', 'invalida'], bio: 'Ajudo famílias a planejar a casa própria.' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.email, 'c1@t.com', 'e-mail não muda pelo próprio usuário');
  assert.deepEqual(r.data.specialties, ['imovel']);
  assert.equal((await call('c1', 'PATCH', '/api/perfil', { phone: '123' })).status, 400);
  assert.equal((await call('c1', 'POST', '/api/perfil/foto', { photo: 'data:text/html;base64,PHNjcmlwdD4=' })).status, 400);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  assert.equal((await call('c1', 'POST', '/api/perfil/foto', { photo: png })).status, 200);
  const meta = (await call('c1', 'GET', '/api/meta')).data;
  assert.equal(meta.user.photo, png);
  assert.equal(meta.user.job_title, 'Especialista imobiliário');
});

test('alterar senha: confere a atual, exige confirmação e política mínima e encerra as outras sessões', async () => {
  await call('admin', 'POST', '/api/usuarios', { name: 'Senha Teste', email: 'senha@t.com', role: 'consultor', password: 'inicial123' });
  await login('pw1', 'senha@t.com', 'inicial123');
  await login('pw2', 'senha@t.com', 'inicial123');
  assert.equal((await call('pw1', 'POST', '/api/me/senha', { current: 'errada123', password: 'NovaSenha2026', confirm: 'NovaSenha2026' })).status, 400);
  assert.equal((await call('pw1', 'POST', '/api/me/senha', { current: 'inicial123', password: 'NovaSenha2026', confirm: 'Outra2026' })).status, 400, 'confirmação diferente');
  assert.equal((await call('pw1', 'POST', '/api/me/senha', { current: 'inicial123', password: 'somenteletras', confirm: 'somenteletras' })).status, 400, 'precisa de números');
  assert.equal((await call('pw1', 'POST', '/api/me/senha', { current: 'inicial123', password: 'senha2026x', confirm: 'senha2026x' })).status, 400, 'não pode conter o e-mail');
  const ok = await call('pw1', 'POST', '/api/me/senha', { current: 'inicial123', password: 'Casa-Propria-2027', confirm: 'Casa-Propria-2027' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.sessions_ended, 1);
  assert.equal((await call('pw1', 'GET', '/api/me')).status, 200, 'sessão atual continua');
  assert.equal((await call('pw2', 'GET', '/api/me')).status, 401, 'outra sessão encerrada');
  assert.equal((await call(null, 'POST', '/api/login', { email: 'senha@t.com', password: 'inicial123' })).status, 401);
  const n = (await call('pw1', 'GET', '/api/notificacoes')).data;
  assert.ok(n.rows.some((x) => x.kind === 'seguranca'));
});

test('novo especialista: troca obrigatória da senha provisória, trilha de integração e treinamento de consórcios liberado no fim', async () => {
  const cr = await call('admin', 'POST', '/api/usuarios', { name: 'Novo Especialista', email: 'novo.esp@t.com', role: 'consultor', password: 'provisoria1' });
  assert.equal(cr.status, 200, JSON.stringify(cr.data));
  await login('novo', 'novo.esp@t.com', 'provisoria1');
  const meta = (await call('novo', 'GET', '/api/meta')).data;
  assert.equal(meta.user.must_change_password, true);
  const blocked = await call('novo', 'GET', '/api/funil');
  assert.equal(blocked.status, 403, 'plataforma bloqueada até trocar a senha');
  assert.equal(blocked.data.details.code, 'troca_senha');
  let st = (await call('novo', 'GET', '/api/integracao')).data;
  assert.equal(st.active, true);
  assert.equal(st.steps[0].key, 'senha');
  assert.equal(st.steps[0].done, false);
  const ch = await call('novo', 'POST', '/api/me/senha', { current: 'provisoria1', password: 'Vero-Consorcio-2026', confirm: 'Vero-Consorcio-2026' });
  assert.equal(ch.status, 200, JSON.stringify(ch.data));
  assert.equal((await call('novo', 'GET', '/api/funil')).status, 200, 'liberado depois da troca');
  st = (await call('novo', 'GET', '/api/integracao')).data;
  assert.deepEqual(st.steps.map((x) => [x.key, x.done]), [['senha', true], ['perfil', false], ['marca', false], ['configuracao', false], ['consorcios', false]]);
  assert.equal(st.trainings_unlocked, false);
  // Treinamento de consórcios oculto até concluir as etapas 1 a 4
  const before = (await call('novo', 'GET', '/api/treinamentos')).data.items;
  assert.ok(!before.some((t) => t.track === 'consorcios'));
  assert.equal(st.trainings.length, 7);
  assert.equal((await call('novo', 'POST', '/api/integracao/marca/concluir')).status, 400, 'etapas em ordem: falta Meu cadastro');
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await call('novo', 'POST', '/api/perfil/foto', { photo: png });
  await call('novo', 'PATCH', '/api/perfil', { whatsapp: '(51) 98888-7777', job_title: 'Especialista em consórcios' });
  assert.equal((await call('novo', 'POST', '/api/integracao/marca/concluir')).status, 200);
  assert.equal((await call('novo', 'POST', '/api/integracao/senha/concluir')).status, 400, 'etapa automática');
  st = (await call('novo', 'POST', '/api/integracao/configuracao/concluir')).data;
  assert.equal(st.trainings_unlocked, true);
  const after = (await call('novo', 'GET', '/api/treinamentos')).data.items.filter((t) => t.track === 'consorcios');
  assert.equal(after.length, 7);
  assert.ok(after.every((t) => t.required), 'obrigatórios para especialistas');
  // Conclui a trilha: notifica a liderança
  for (const t of after) {
    const full = (await call('novo', 'GET', `/api/treinamentos/${t.id}`)).data;
    const quiz = (await call('admin', 'GET', `/api/treinamentos/${t.id}`)).data.quiz;
    const r = await call('novo', 'POST', `/api/treinamentos/${t.id}/concluir`, { answers: quiz.map((q) => q.correct) });
    assert.equal(r.data.passed, true, full.title);
  }
  st = (await call('novo', 'GET', '/api/integracao')).data;
  assert.equal(st.complete, true);
  const n = (await call('admin', 'GET', '/api/notificacoes')).data.rows;
  assert.ok(n.some((x) => /Novo Especialista concluiu a integração/.test(x.title)));
  // Usuário antigo (sem trilha) vê os treinamentos normalmente
  assert.ok((await call('c1', 'GET', '/api/treinamentos')).data.items.some((t) => t.track === 'consorcios'));
});

test('notificações: lead distribuído avisa o especialista; leitura individual e geral', async () => {
  const c = await call('admin', 'POST', '/api/cadastros', { name: 'Lead Notificado', phone1: '11 94444-5005', owner_id: '' });
  const c1 = await userId('c1@t.com');
  await call('admin', 'POST', '/api/distribuicao', { contact_ids: [c.data.id], method: 'manual', user_id: c1 });
  const n = (await call('c1', 'GET', '/api/notificacoes')).data;
  const item = n.rows.find((x) => x.kind === 'lead_distribuido' && x.link === `#/leads/${c.data.id}`);
  assert.ok(item, 'notificação criada');
  assert.ok(n.unread >= 1);
  await call('c1', 'POST', '/api/notificacoes/lidas', { ids: [item.id] });
  assert.ok((await call('c1', 'GET', '/api/notificacoes')).data.rows.find((x) => x.id === item.id).read_at);
  await call('c1', 'POST', '/api/notificacoes/lidas', { all: true });
  assert.equal((await call('c1', 'GET', '/api/notificacoes')).data.unread, 0);
  assert.equal((await call('c2', 'POST', '/api/notificacoes/lidas', { ids: [item.id] })).data.updated, 0, 'não marca a de outro usuário');
});

test('funil: valor pela proposta, busca por telefone/e-mail, categoria e ações em massa (etapa e responsável)', async () => {
  const a = await call('c1', 'POST', '/api/cadastros', { name: 'Massa Um', phone1: '21 97777-1234', email: 'massa.um@x.com', relationship: 'lead', origin: 'site', credit_category: 'imovel' });
  const b = await call('c1', 'POST', '/api/cadastros', { name: 'Massa Dois', phone1: '21 97777-5678', relationship: 'lead', origin: 'site' });
  const oa = (await call('c1', 'GET', `/api/cadastros/${a.data.id}`)).data.opportunities[0];
  const ob = (await call('c1', 'GET', `/api/cadastros/${b.data.id}`)).data.opportunities[0];
  await call('c1', 'POST', '/api/propostas', { opportunity_id: oa.id, credit_value: 230000 });
  const f = (await call('c1', 'GET', '/api/funil?q=977771234')).data;
  const card = f.stages.flatMap((s) => s.cards).find((x) => x.id === oa.id);
  assert.ok(card, 'busca por telefone');
  assert.equal(card.deal_value, 230000);
  assert.equal(card.deal_value_source, 'proposta');
  assert.ok((await call('c1', 'GET', '/api/funil?q=massa.um@x')).data.stages.some((s) => s.cards.some((x) => x.id === oa.id)), 'busca por e-mail');
  const stages = (await call('c1', 'GET', '/api/meta')).data.stages;
  const st = (k) => stages.find((s) => s.key === k).id;
  const lost = await call('c1', 'POST', '/api/oportunidades/lote', { ids: [oa.id, ob.id], action: 'etapa', stage_id: st('perdido'), lost_reason: 'sem_interesse' });
  assert.equal(lost.status, 200, JSON.stringify(lost.data));
  assert.equal(lost.data.done, 2);
  const skip = await call('c1', 'POST', '/api/oportunidades/lote', { ids: [oa.id], action: 'etapa', stage_id: st('negociacao'), reason: 'teste' });
  assert.equal(skip.data.failed, 1, 'regras do funil valem na ação em massa');
  assert.equal((await call('c1', 'POST', '/api/oportunidades/lote', { ids: [ob.id], action: 'responsavel', owner_id: await userId('gestor@t.com') })).status, 403);
  const c2 = await userId('c2@t.com');
  assert.equal((await call('gestor', 'POST', '/api/oportunidades/lote', { ids: [ob.id], action: 'responsavel', owner_id: c2 })).status, 403, 'fora da equipe do líder');
  const tr = await call('admin', 'POST', '/api/oportunidades/lote', { ids: [ob.id], action: 'responsavel', owner_id: c2, stage_id: st('lead'), reason: 'Redistribuição' });
  assert.equal(tr.status, 200, JSON.stringify(tr.data));
  assert.equal(tr.data.done, 1, JSON.stringify(tr.data));
  const moved = (await call('admin', 'GET', `/api/oportunidades/${ob.id}`)).data;
  assert.equal(moved.owner_id, c2);
  assert.equal(moved.stage_id, st('lead'));
  assert.equal((await call('admin', 'GET', `/api/cadastros/${b.data.id}`)).data.owner_id, c2, 'cadastro acompanha');
  assert.ok((await call('c2', 'GET', '/api/notificacoes')).data.rows.some((x) => x.kind === 'transferencia'));
});

test('exportação CSV só para o administrador; lista da discadora continua liberada', async () => {
  assert.equal((await call('gestor', 'GET', '/api/exportar/oportunidades')).status, 403);
  assert.equal((await call('c1', 'GET', '/api/exportar/propostas')).status, 403);
  assert.equal((await call('admin', 'GET', '/api/exportar/oportunidades')).status, 200);
  assert.equal((await call('c1', 'GET', '/api/exportar/lista_discadora')).status, 200);
});

test('propostas: recusa exige motivo, agenda a retomada e alimenta os motivos de recusa', async () => {
  const c = await call('c1', 'POST', '/api/cadastros', { name: 'Recusa Motivo', phone1: '11 94444-6006' });
  const opp = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data.opportunities[0];
  const p = await call('c1', 'POST', '/api/propostas', { opportunity_id: opp.id, credit_value: 120000, status: 'apresentada' });
  assert.equal((await call('c1', 'POST', `/api/propostas/${p.data.id}/status`, { status: 'recusada' })).status, 400);
  const past = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  assert.equal((await call('c1', 'POST', `/api/propostas/${p.data.id}/status`, { status: 'recusada', refusal_reason: 'nao_e_momento', retake_at: past })).status, 400, 'retomada no futuro');
  const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  assert.equal((await call('c1', 'POST', `/api/propostas/${p.data.id}/status`, { status: 'recusada', refusal_reason: 'nao_e_momento', refusal_notes: 'Volta em um mês', retake_at: future })).status, 200);
  const t = (await call('c1', 'GET', `/api/tarefas?contact_id=${c.data.id}&status=pendente`)).data.rows;
  assert.ok(t.some((x) => x.type === 'retorno' && x.due_at.startsWith(future)));
  const pan = (await call('c1', 'GET', '/api/propostas-panorama?status=recusada')).data;
  const reason = pan.summary.recusas_por_motivo.find((r) => r.reason === 'nao_e_momento');
  assert.ok(reason && reason.count >= 1 && reason.recuperavel);
  assert.equal(pan.rows.find((r) => r.id === p.data.id).refusal_notes, 'Volta em um mês');
});

test('clientes: colunas, responsável pós-venda e filtros por situação, PF/PJ e categoria', async () => {
  const r = (await call('c1', 'GET', '/api/clientes')).data;
  assert.ok(r.rows.length >= 1);
  const row = r.rows[0];
  for (const k of ['code', 'name', 'active', 'postsale_name', 'seller_name', 'cartas', 'credit_total', 'categories', 'next_action', 'last_activity']) assert.ok(k in row, k);
  assert.ok(r.rows.every((x) => x.seller_name === 'Cons 1' || x.postsale_name), 'especialista vê só os próprios');
  const all = (await call('admin', 'GET', '/api/clientes')).data.total;
  assert.ok(all >= r.total);
  assert.ok((await call('admin', 'GET', '/api/clientes?category=so_imovel')).data.rows.every((x) => x.categories.length === 1 && x.categories[0] === 'imovel'));
  assert.ok((await call('admin', 'GET', '/api/clientes?category=ambas')).data.rows.every((x) => x.categories.length > 1));
  assert.equal((await call('admin', 'GET', '/api/clientes?kind=PJ')).data.rows.filter((x) => x.kind !== 'PJ').length, 0);
  assert.equal((await call('admin', 'GET', '/api/clientes?active=0')).data.rows.filter((x) => x.active).length, 0);
});

test('pós-venda: checklist automático, responsável, NPS com motivo e tratativa, estratégia de lance com histórico', async () => {
  const c = await call('c1', 'POST', '/api/cadastros', { name: 'Cliente PosVenda', phone1: '11 94444-7007' });
  await completeForSale(c.data.id);
  const opp = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data.opportunities[0];
  const { sale } = await sellViaFlow('c1', opp.id, 150000);
  let ov = (await call('c1', 'GET', '/api/pos-venda?status=')).data;
  let row = ov.rows.find((x) => x.id === c.data.id);
  assert.ok(row, 'cliente entra no pós-venda após o pagamento');
  assert.ok(row.checklist.find((i) => i.item === 'preferencias_contato').done_at, 'preferências informadas na confirmação');
  assert.equal(row.postsale_name, 'Cons 1', 'padrão: especialista da venda');
  const g = await userId('gestor@t.com');
  assert.equal((await call('c1', 'POST', `/api/pos-venda/${c.data.id}/responsavel`, { user_id: g })).status, 403);
  assert.equal((await call('gestor', 'POST', `/api/pos-venda/${c.data.id}/responsavel`, { user_id: g })).status, 200);
  // NPS detrator com motivo → alerta, tarefa urgente e tratativa
  const n = (await call('c1', 'POST', `/api/cadastros/${c.data.id}/nps`, {})).data;
  assert.equal((await call(null, 'POST', '/api/publico/nps', { token: n.token, score: 3, reason: 'motivo_inexistente' })).status, 400);
  assert.equal((await call(null, 'POST', '/api/publico/nps', { token: n.token, score: 3, reason: 'demora', comment: 'Demoraram a responder' })).status, 200);
  let nb = (await call('c1', 'GET', '/api/pos-venda/nps')).data;
  assert.ok(nb.alerts.some((a) => a.kind === 'detrator' && a.survey_id === n.id));
  assert.ok(nb.summary.motivos.some((m) => m.reason === 'demora'));
  assert.equal((await call('c1', 'POST', `/api/pos-venda/nps/${n.id}/tratativa`, { notes: 'curta' })).status, 400);
  assert.equal((await call('c1', 'POST', `/api/pos-venda/nps/${n.id}/tratativa`, { notes: 'Liguei, pedi desculpas e combinei retorno semanal.' })).status, 200);
  nb = (await call('c1', 'GET', '/api/pos-venda/nps')).data;
  assert.ok(!nb.alerts.some((a) => a.kind === 'detrator' && a.survey_id === n.id));
  assert.ok(nb.rows.find((x) => x.id === n.id).treated_by_name);
  // Estratégia de lance: cada alteração vai para o histórico
  const k = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data.contracts[0];
  await call('c1', 'POST', `/api/contratos/${k.id}/estrategia-lance`, { will_bid: true, bid_type: 'embutido' });
  await call('c1', 'POST', `/api/contratos/${k.id}/estrategia-lance`, { will_bid: true, bid_type: 'livre', bid_pct: 20 });
  const h = (await call('c1', 'GET', `/api/pos-venda/lances/${k.id}/historico`)).data.history;
  assert.equal(h.length, 2);
  assert.equal(h[0].bid_type, 'livre');
  assert.ok(h[0].created_by_name && h[0].created_at);
  const lb = (await call('c1', 'GET', '/api/pos-venda/lances')).data;
  assert.equal(lb.rows.find((x) => x.id === k.id).changes, 2);
  ov = (await call('c1', 'GET', '/api/pos-venda?status=')).data;
  row = ov.rows.find((x) => x.id === c.data.id);
  assert.ok(row.checklist.find((i) => i.item === 'estrategia_lance').done_at);
  assert.equal((await call('c2', 'GET', `/api/pos-venda/lances/${k.id}/historico`)).status, 404, 'fora do escopo');
  assert.ok(sale.id);
});

test('pré-venda com 4 cotas: termo com grupo/cota/contrato, comprovante leva para Vendas, só o time confirma, 4 produtos no mesmo ID de venda', async () => {
  const c = await call('c1', 'POST', '/api/cadastros', { name: 'Cliente Quatro Cotas', phone1: '11 93333-4004' });
  await completeForSale(c.data.id);
  const opp = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data.opportunities[0];
  const quotas = [1, 2, 3, 4].map((i) => ({ credit_value: 250000, group_code: `Q${i}`, quota_code: `${40 + i}`, contract_number: `CT-Q${i}` }));
  // Soma divergente do crédito informado é recusada
  const plan = await ensurePlan();
  const ps0 = await call('c1', 'POST', '/api/pre-vendas', { opportunity_id: opp.id });
  await call('c1', 'POST', `/api/pre-vendas/${ps0.data.id}/avancar`, { step: 'conferido' });
  assert.equal((await call('c1', 'POST', `/api/pre-vendas/${ps0.data.id}/avancar`, { step: 'termo_adesao', plan_id: plan.id, credit_value: 900000, quotas })).status, 400);
  assert.equal((await call('c1', 'POST', `/api/pre-vendas/${ps0.data.id}/avancar`, { step: 'termo_adesao', plan_id: plan.id, credit_value: 1000000, quotas: [...quotas.slice(0, 3), { ...quotas[0] }] })).status, 400, 'cota repetida');
  await call('c1', 'POST', `/api/pre-vendas/${ps0.data.id}/cancelar`, { reason: 'refazer com as 4 cotas' });
  const { sale } = await sellViaFlow('c1', opp.id, 1000000, { quotas, stop: 'venda' });
  let s = (await call('c1', 'GET', `/api/vendas/${sale.id}`)).data;
  assert.equal(s.status, 'aguardando_alocacao', 'comprovante leva para Vendas, aguardando a alocação');
  assert.equal(s.quotas.length, 4);
  assert.equal(s.credit_value, 1000000);
  assert.ok(s.payment_attachment, 'comprovante anexado');
  // Especialista não confirma a venda; o time confirma depois da alocação
  assert.equal((await call('c1', 'POST', `/api/vendas/${sale.id}/confirmar`, {})).status, 403);
  const part = await call('c1', 'POST', `/api/vendas/${sale.id}/alocacao`, { quotas: s.quotas.slice(0, 2).map((q) => ({ id: q.id, allocated: true })) });
  assert.equal(part.data.all_allocated, false, 'alocação parcial');
  const all = await call('c1', 'POST', `/api/vendas/${sale.id}/alocacao`, { quotas: s.quotas.map((q) => ({ id: q.id, allocated: true })) });
  assert.equal(all.data.all_allocated, true);
  const conf = await call('gestor', 'POST', `/api/vendas/${sale.id}/confirmar`, {});
  assert.equal(conf.status, 200, JSON.stringify(conf.data));
  assert.equal(conf.data.contracts.length, 4);
  s = (await call('c1', 'GET', `/api/vendas/${sale.id}`)).data;
  assert.equal(s.status, 'confirmada');
  assert.deepEqual(s.contracts.map((k) => `${k.group_code}/${k.quota_code}/${k.contract_number}`), quotas.map((q) => `${q.group_code}/${q.quota_code}/${q.contract_number}`));
  assert.ok(s.formalization.by_seller, 'especialista anexou o comprovante e informou a alocação no prazo');
  const d = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data;
  assert.equal(d.contracts.filter((k) => k.status !== 'cancelado').length, 4, 'os 4 produtos ficam no cliente');
  assert.equal(d.relationship, 'cliente');
});

test('ordem configurável (pagamento antes do contrato) e bônus de formalização para o especialista no prazo', async () => {
  assert.equal((await call('admin', 'PATCH', '/api/configuracoes', { presale_payment_first: true, formalization_bonus_pct: 0.05, formalization_sla_days: 5 })).status, 200);
  const c = await call('c1', 'POST', '/api/cadastros', { name: 'Cliente Paga Antes', phone1: '11 93333-5005' });
  await completeForSale(c.data.id);
  const opp = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data.opportunities[0];
  const plan = await ensurePlan();
  const ps = await call('c1', 'POST', '/api/pre-vendas', { opportunity_id: opp.id });
  const pv = (await call('c1', 'GET', `/api/pre-vendas/${ps.data.id}`)).data;
  assert.deepEqual(pv.steps.slice(5).map(([k]) => k), ['pagamento_enviado', 'pagamento_comprovado', 'contrato_assinado', 'concluida']);
  const steps = [
    ['conferido', {}],
    ['termo_adesao', { plan_id: plan.id, quotas: [{ credit_value: 200000, group_code: 'P1', quota_code: '7', contract_number: 'CP-1' }] }],
    ['pagamento_enviado', { payment_method: 'pix', boleto_value: 1800 }],
    ['pagamento_comprovado', { payment_date: todayStr(), filename: 'pix.pdf', mime: 'application/pdf', content_base64: PDF }],
  ];
  for (const [step, body] of steps) assert.equal((await call('c1', 'POST', `/api/pre-vendas/${ps.data.id}/avancar`, { step, ...body })).status, 200, step);
  const last = await call('c1', 'POST', `/api/pre-vendas/${ps.data.id}/avancar`, { step: 'contrato_assinado' });
  assert.ok(last.data.sale, 'a última etapa (contrato) conclui a pré-venda');
  const s = (await call('c1', 'GET', `/api/vendas/${last.data.sale.id}`)).data;
  await call('c1', 'POST', `/api/vendas/${s.id}/alocacao`, { quotas: s.quotas.map((q) => ({ id: q.id, allocated: true })) });
  const conf = await call('admin', 'POST', `/api/vendas/${s.id}/confirmar`, {});
  assert.equal(conf.status, 200, JSON.stringify(conf.data));
  assert.equal(conf.data.bonus, 100, '0,05% de R$ 200 mil');
  const comm = (await call('c1', 'GET', '/api/comissoes')).data.rows.filter((r) => r.sale_id === s.id);
  assert.ok(comm.some((r) => r.kind === 'bonus' && r.amount === 100));
  await call('admin', 'PATCH', '/api/configuracoes', { presale_payment_first: false, formalization_bonus_pct: 0 });
});

test('pós-venda em funil: linha do tempo D+N, tarefa da próxima etapa e indicação só para promotor', async () => {
  const mk = async (name, phone) => {
    const c = await call('c1', 'POST', '/api/cadastros', { name, phone1: phone });
    await completeForSale(c.data.id);
    const opp = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data.opportunities[0];
    await sellViaFlow('c1', opp.id, 200000);
    return c.data.id;
  };
  const a = await mk('Cliente Promotor', '11 93333-6006');
  let d = (await call('c1', 'GET', `/api/cadastros/${a}`)).data;
  const byItem = Object.fromEntries(d.post_sale.map((p) => [p.item, p]));
  assert.equal(byItem.primeira_parcela.status, 'feito', '1ª parcela confirmada pelo comprovante');
  assert.equal(byItem.onboarding.days, 1);
  assert.equal(byItem.acesso_cliente.days, 5);
  assert.equal(byItem.indicacao.status, 'aguardando_nps');
  assert.ok(d.tasks.some((t) => t.status === 'pendente' && /Pós-venda \(D\+1\): fazer o onboarding/.test(t.title)), 'tarefa da próxima etapa');
  // Concluir o onboarding cria a tarefa da etapa seguinte
  assert.equal((await call('c1', 'POST', `/api/cadastros/${a}/pos-venda`, { item: 'onboarding', done: true })).status, 200);
  d = (await call('c1', 'GET', `/api/cadastros/${a}`)).data;
  assert.ok(d.tasks.some((t) => t.status === 'pendente' && /D\+5/.test(t.title)));
  assert.ok(!d.tasks.some((t) => t.status === 'pendente' && /onboarding/.test(t.title)));
  // "Não se aplica" exige motivo
  assert.equal((await call('c1', 'POST', `/api/cadastros/${a}/pos-venda`, { item: 'acesso_cliente', skip: true })).status, 400);
  // NPS promotor libera a indicação; detrator dispensa
  const n = await call('c1', 'POST', `/api/cadastros/${a}/nps`, {});
  assert.equal((await call(null, 'POST', '/api/publico/nps', { token: n.data.token, score: 10, answers: { atendimento: 5, clareza: 5, agilidade: 5, confianca: 5 } })).status, 200);
  d = (await call('c1', 'GET', `/api/cadastros/${a}`)).data;
  assert.equal(d.post_sale.find((p) => p.item === 'nps').status, 'feito');
  assert.ok(['pendente', 'atrasado'].includes(d.post_sale.find((p) => p.item === 'indicacao').status));
  const b = await mk('Cliente Detrator', '11 93333-7007');
  const n2 = await call('c1', 'POST', `/api/cadastros/${b}/nps`, {});
  await call(null, 'POST', '/api/publico/nps', { token: n2.data.token, score: 5, reason: 'atendimento', answers: { atendimento: 2, clareza: 3, agilidade: 2, confianca: 2 } });
  d = (await call('c1', 'GET', `/api/cadastros/${b}`)).data;
  const ind = d.post_sale.find((p) => p.item === 'indicacao');
  assert.equal(ind.status, 'nao_se_aplica', 'detrator: indicação não é pedida');
  const ov = (await call('c1', 'GET', '/api/pos-venda')).data;
  const row = ov.rows.find((r) => r.id === a);
  assert.ok(row.sales[0].code.startsWith('VD-'), 'código da venda no pós-venda');
  assert.ok(ov.summary.por_item.some((i) => i.item === 'indicacao'));
});

test('qualificação: preenchimento pela R1 completa só os campos vazios; proposta com divisão de cotas e observação sempre editável', async () => {
  const c = await call('c1', 'POST', '/api/cadastros', { name: 'Lead Qualificação', phone1: '11 93333-8008' });
  const opp = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data.opportunities[0];
  assert.equal((await call('c1', 'PATCH', `/api/oportunidades/${opp.id}`, { credit_value: 300000, urgency: 'curto', had_consortium: 'sim', existing_consortium_admin: 'Adm X', existing_consortium_value: 80000, installment_min: 3000, installment_max: 2000 })).status, 400, 'parcela ideal acima da máxima');
  assert.equal((await call('c1', 'PATCH', `/api/oportunidades/${opp.id}`, { credit_value: 300000, urgency: 'curto', had_consortium: 'sim', existing_consortium_admin: 'Adm X' })).status, 200);
  const r1 = await call('c1', 'POST', `/api/oportunidades/${opp.id}/qualificacao`, { source: 'r1_transcricao', fields: { credit_value: 500000, decision_maker: 'conjuge', installment_min: 2500, installment_max: 3500, credit_purpose_type: 'moradia' } });
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  assert.deepEqual(r1.data.filled.sort(), ['credit_purpose_type', 'decision_maker', 'installment_max', 'installment_min']);
  assert.ok(r1.data.ignored.includes('credit_value'), 'crédito já preenchido fica como está');
  const o = (await call('c1', 'GET', `/api/oportunidades/${opp.id}`)).data;
  assert.equal(o.credit_value, 300000);
  assert.equal(o.existing_products, 'consorcio');
  assert.ok(o.qualification.filled >= 7);
  // Proposta: divisão das cotas precisa somar o crédito
  const plan = await ensurePlan();
  const bad = await call('c1', 'POST', '/api/propostas', { opportunity_id: opp.id, product_id: plan.id, credit_value: 300000, quota_split_strategy: 'iguais', quota_values: '150000; 100000' });
  assert.equal(bad.status, 400);
  const p = await call('c1', 'POST', '/api/propostas', { opportunity_id: opp.id, product_id: plan.id, credit_value: 300000, quota_split_strategy: 'grupos_diferentes', quota_values: '150000; 150000', quota_split_notes: 'Duas cotas em grupos diferentes' });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  let pr = (await call('c1', 'GET', `/api/propostas/${p.data.id}`)).data;
  assert.equal(pr.quotas, 2);
  assert.equal(pr.has_adhesion, 1, 'adesão vem do plano');
  assert.equal(pr.adhesion_pct, 1);
  assert.equal(pr.adhesion_months, 3);
  await call('c1', 'POST', `/api/propostas/${p.data.id}/status`, { status: 'recusada', refusal_reason: 'nao_e_momento' });
  assert.equal((await call('c1', 'PATCH', `/api/propostas/${p.data.id}`, { notes: 'Cliente pediu retorno em março.' })).status, 200, 'observação editável mesmo encerrada');
  assert.equal((await call('c1', 'PATCH', `/api/propostas/${p.data.id}`, { credit_value: 200000 })).status, 400);
  pr = (await call('c1', 'GET', `/api/propostas/${p.data.id}`)).data;
  assert.equal(pr.notes, 'Cliente pediu retorno em março.');
});

test('financeiro: cadastros prontos, despesa parcelada, atraso com motivo, baixa com comprovante e visão geral só do administrador', async () => {
  const cad = (await call('admin', 'GET', '/api/financeiro/cadastros')).data;
  assert.ok(cad.categorias.filter((c) => c.direction === 'pagar').length >= 20, 'categorias de despesa prontas');
  assert.ok(cad.categorias.some((c) => c.direction === 'receber' && /Comissão de venda/.test(c.name)));
  assert.deepEqual(cad.formas.map((f) => f.name), ['Boleto', 'TED', 'Dinheiro']);
  assert.ok(cad.centros.length >= 5 && cad.contas.length >= 1);
  const cat = (dir, re) => cad.categorias.find((c) => c.direction === dir && re.test(c.name)).id;
  const acc = cad.contas[0].id;
  const boleto = cad.formas.find((f) => f.name === 'Boleto').id;
  const c1 = await userId('c1@t.com');
  // Especialista sem o módulo não lança nem vê a visão geral
  assert.equal((await call('c1', 'GET', '/api/financeiro/visao-geral')).status, 403);
  assert.equal((await call('c1', 'POST', '/api/financeiro/titulos', { direction: 'pagar' })).status, 403);
  // Cadastro de parceiro e despesa parcelada
  const forn = await call('admin', 'POST', '/api/financeiro/cadastros/parceiros', { name: 'Imobiliária Centro', kind: 'fornecedor', doc: '12.345.678/0001-90' });
  assert.equal(forn.status, 200, JSON.stringify(forn.data));
  const yesterday = new Date(Date.now() - 27 * 3600000).toISOString().slice(0, 10);
  const parc = await call('admin', 'POST', '/api/financeiro/titulos', { direction: 'pagar', kind: 'parcelada', description: 'Notebooks da equipe', category_id: cat('pagar', /Equipamentos/), cost_center_id: cad.centros[0].id, payment_method_id: boleto, account_id: acc, installments: 3, total_value: 1000, first_due: yesterday, responsible_id: c1 });
  assert.equal(parc.status, 200, JSON.stringify(parc.data));
  assert.equal(parc.data.installments, 3);
  let t = (await call('admin', 'GET', `/api/financeiro/titulos/${parc.data.id}`)).data;
  assert.deepEqual(t.items.map((i) => i.amount), [333.33, 333.33, 333.34], 'a última parcela fecha o total');
  assert.equal(t.items[0].situation, 'atrasado');
  // Rotina avisa o responsável; ele vê o próprio lançamento (sem o módulo), informa o motivo e paga com comprovante
  require('../server/services/treasury').sweep(appDb);
  const nots = (await call('c1', 'GET', '/api/notificacoes')).data;
  assert.ok(nots.rows.some((n) => /atrasado: Notebooks/.test(n.title)));
  const mine = (await call('c1', 'GET', '/api/financeiro/lancamentos?direcao=pagar&status=atrasado')).data;
  assert.equal(mine.rows.length, 1, 'responsável vê só o que é dele');
  const inst = mine.rows[0];
  assert.equal((await call('c1', 'POST', `/api/financeiro/parcelas/${inst.id}/atraso`, { reason: 'ok' })).status, 400);
  assert.equal((await call('c1', 'POST', `/api/financeiro/parcelas/${inst.id}/atraso`, { reason: 'Boleto chegou com a data errada; pedi um novo ao fornecedor.' })).status, 200);
  assert.ok((await call('admin', 'GET', '/api/notificacoes')).data.rows.some((n) => /Motivo do atraso/.test(n.title)));
  // Novo boleto: mudar o vencimento exige explicação
  const next = t.items[1];
  assert.equal((await call('admin', 'PATCH', `/api/financeiro/parcelas/${next.id}`, { due_date: '2030-01-10' })).status, 400);
  assert.equal((await call('admin', 'PATCH', `/api/financeiro/parcelas/${next.id}`, { due_date: '2030-01-10', reason: 'Novo boleto emitido com a data correta' })).status, 200);
  const pay = await call('c1', 'POST', `/api/financeiro/parcelas/${inst.id}/baixa`, { paid_at: yesterday, filename: 'comprovante.pdf', content_base64: PDF });
  assert.equal(pay.status, 200, JSON.stringify(pay.data));
  t = (await call('admin', 'GET', `/api/financeiro/titulos/${parc.data.id}`)).data;
  assert.equal(t.items[0].status, 'pago');
  assert.ok(t.items[0].file_id, 'comprovante anexado');
  assert.ok(t.history.some((n) => n.kind === 'atraso') && t.history.some((n) => n.kind === 'alteracao'), 'histórico de observações');
  assert.equal((await call('admin', 'GET', `/api/financeiro/arquivos/${t.items[0].file_id}`)).status, 200);
  const ov = (await call('admin', 'GET', '/api/financeiro/visao-geral')).data;
  assert.equal(ov.accounts.find((a) => a.id === acc).saidas, 333.33);
  assert.ok(ov.pagar.recentes.some((r) => r.title_id === parc.data.id));
  assert.equal((await call('gestor', 'GET', '/api/financeiro/visao-geral')).status, 403);
});

test('financeiro: assinatura com renovação, recorrente anual e conta a receber com rateio por competência', async () => {
  const cad = (await call('admin', 'GET', '/api/financeiro/cadastros')).data;
  const cat = (dir, re) => cad.categorias.find((c) => c.direction === dir && re.test(c.name)).id;
  const first = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const sub = await call('admin', 'POST', '/api/financeiro/titulos', { direction: 'pagar', kind: 'assinatura', description: 'CRM e discadora', category_id: cat('pagar', /Software/), periodicity: 'mensal', installment_value: 450, first_due: first, auto_renew: true });
  assert.equal(sub.status, 200, JSON.stringify(sub.data));
  assert.equal(sub.data.installments, 12, 'mensal: 12 meses à frente');
  let s = (await call('admin', 'GET', `/api/financeiro/titulos/${sub.data.id}`)).data;
  assert.ok(s.renewal_date > first, 'ciclo de renovação definido');
  // Sem renovação automática: ocorrências param antes da renovação
  assert.equal((await call('admin', 'PATCH', `/api/financeiro/titulos/${sub.data.id}`, { auto_renew: false, renewal_date: new Date(Date.now() + 70 * 86400000).toISOString().slice(0, 10) })).status, 200);
  s = (await call('admin', 'GET', `/api/financeiro/titulos/${sub.data.id}`)).data;
  assert.ok(s.items.filter((i) => i.status === 'aberto').length <= 3);
  const yearly = await call('admin', 'POST', '/api/financeiro/titulos', { direction: 'pagar', kind: 'recorrente', description: 'Anuidade da associação', category_id: cat('pagar', /Associações/), periodicity: 'anual', installment_value: 1200, first_due: first });
  assert.equal(yearly.data.installments, 1);
  // Receita: nota da administradora com rateio por competência
  const adm = await call('admin', 'POST', '/api/financeiro/cadastros/parceiros', { name: 'Administradora XP (pagadora)', kind: 'pagador' });
  const rec = await call('admin', 'POST', '/api/financeiro/titulos', { direction: 'receber', kind: 'pontual', description: 'Nota de comissões', partner_id: adm.data.id, category_id: cat('receber', /Comissão de venda/), total_value: 100000, first_due: first, invoice_number: 'NF-1001', invoice_date: first, account_id: cad.contas[0].id });
  assert.equal(rec.status, 200, JSON.stringify(rec.data));
  const bad = await call('admin', 'POST', `/api/financeiro/titulos/${rec.data.id}/rateio`, { allocations: [{ competence: '2026-10', amount: 40000 }, { competence: '2026-09', amount: 30000 }] });
  assert.equal(bad.status, 400, 'rateio precisa fechar o total');
  const ok = await call('admin', 'POST', `/api/financeiro/titulos/${rec.data.id}/rateio`, { allocations: [{ competence: '2026-10', amount: 40000 }, { competence: '2026-09', amount: 30000 }, { competence: '2026-08', amount: 20000 }, { competence: '2026-07', amount: 10000 }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const comp = (await call('admin', 'GET', '/api/financeiro/competencia?de=2026-07&ate=2026-10')).data;
  assert.deepEqual(comp.months.map((m) => [m.competence, m.total]), [['2026-10', 40000], ['2026-09', 30000], ['2026-08', 20000], ['2026-07', 10000]]);
  // Recebido: entra no saldo da conta
  const item = (await call('admin', 'GET', `/api/financeiro/titulos/${rec.data.id}`)).data.items[0];
  assert.equal((await call('admin', 'POST', `/api/financeiro/parcelas/${item.id}/baixa`, {})).status, 200);
  const ov = (await call('admin', 'GET', '/api/financeiro/visao-geral')).data;
  assert.ok(ov.mes.entradas >= 100000);
  // Cancelamento exige motivo
  assert.equal((await call('admin', 'POST', `/api/financeiro/titulos/${yearly.data.id}/cancelar`, {})).status, 400);
  assert.equal((await call('admin', 'POST', `/api/financeiro/titulos/${yearly.data.id}/cancelar`, { reason: 'Saímos da associação' })).status, 200);
});

test('leads: formulário entra em Tentativa e a roleta distribui na hora; importação valida e remove duplicados', async () => {
  const c1 = await userId('c1@t.com');
  assert.equal((await call('admin', 'PATCH', '/api/distribuicao/roleta', { mode: 'sequencial', auto: true, first_contact_hours: 1, participants: [{ user_id: c1, active: true, weight: 1 }] })).status, 200);
  const n = await call('admin', 'POST', '/api/cadastros', { name: 'Lead da Landing', phone1: '11 96666-0101', email: 'landing@ex.com', origin: 'landing_page', relationship: 'lead', owner_id: '' });
  assert.equal(n.status, 200, JSON.stringify(n.data));
  const c = (await call('admin', 'GET', `/api/cadastros/${n.data.id}`)).data;
  assert.equal(c.owner_id, c1, 'distribuído na entrada, sem esperar a rotina');
  assert.equal(c.opportunities[0].stage_name, 'Tentativa de contato');
  assert.ok(c.tasks?.some?.((t) => t.type === 'primeiro_contato') ?? true);
  // Importação: valida contato e remove duplicados (existente e repetido no arquivo)
  const csv = 'Nome;Telefone;E-mail;Origem;Crédito desejado\nNovo A;11 96666-0201;;Meta Ads;R$ 200.000,00\nRepetido;11 96666-0201;;Site;\nSem contato;;;Site;\nJá existe;11 96666-0101;;Site;';
  const pv = (await call('admin', 'POST', '/api/importacao/previa', { csv, filename: 'base.csv' })).data;
  assert.equal(pv.valid, 1);
  assert.equal(pv.duplicates, 2);
  assert.equal(pv.errors, 1);
  assert.equal(pv.duplicate_rows.length, 2);
  const imp = (await call('admin', 'POST', '/api/importacao', { csv, filename: 'base.csv', owner_id: 'roleta' })).data;
  assert.equal(imp.created, 1);
  assert.equal(imp.distributed, 1);
});

test('negócio: temperatura quente/morno/frio, campos novos e transcrição da R1 completando só os vazios', async () => {
  const n = await call('c1', 'POST', '/api/cadastros', { name: 'Temperatura Teste', phone1: '11 96666-0301', origin: 'indicacao', relationship: 'lead' });
  let o = (await call('c1', 'GET', `/api/cadastros/${n.data.id}`)).data.opportunities[0];
  assert.equal((await call('c1', 'GET', `/api/oportunidades/${o.id}`)).data.temperature, 'frio');
  await call('c1', 'PATCH', `/api/oportunidades/${o.id}`, { objective_type: 'aquisicao', credit_value: 300000, credit_category: 'imovel', housing_purpose: 'morar', has_property: 'sim', property_type: 'apartamento', property_value: 400000, property_free_liens: 'sim', pays_rent: 'nao' });
  let d = (await call('c1', 'GET', `/api/oportunidades/${o.id}`)).data;
  assert.equal(d.temperature, 'morno');
  assert.equal(d.property_type, 'apartamento');
  assert.ok(d.temperature_info.missing.length);
  // Transcrição: identifica os campos e completa só os vazios (crédito já preenchido não muda)
  const t = await call('c1', 'POST', `/api/oportunidades/${o.id}/transcricoes`, { filename: 'r1.txt', text: 'R1\nCrédito desejado: R$ 500.000,00\nPrazo desejado: curto\nParcela máxima: 3.200\nOrigem do lance: FGTS\nFator decisor: com cônjuge' });
  assert.equal(t.status, 200, JSON.stringify(t.data));
  assert.ok(t.data.items.find((i) => i.key === 'credit_value' && !i.will_fill), 'crédito já estava preenchido');
  assert.ok(t.data.items.find((i) => i.key === 'urgency' && i.value === 'curto' && i.will_fill));
  const ap = await call('c1', 'POST', `/api/oportunidades/${o.id}/transcricoes/${t.data.id}/aplicar`);
  assert.ok(ap.data.filled.includes('installment_max'));
  d = (await call('c1', 'GET', `/api/oportunidades/${o.id}`)).data;
  assert.equal(d.credit_value, 300000);
  assert.equal(d.temperature, 'quente', 'prazo curto + valor + parcela');
  assert.equal(d.transcripts.length, 1);
  assert.equal((await call('c1', 'GET', `/api/cadastros/${n.data.id}`)).data.temperature, 'quente', 'cadastro acompanha o negócio');
  // Planilha modelo (Campo | Valor)
  const t2 = await call('c1', 'POST', `/api/oportunidades/${o.id}/transcricoes`, { filename: 'r1.csv', text: 'Campo;Descrição;Valor\npays_rent;Paga aluguel hoje?;sim\nrent_value;Valor do aluguel;2.500,00' });
  assert.deepEqual(t2.data.items.map((i) => [i.key, i.value]), [['pays_rent', 'sim'], ['rent_value', 2500]]);
});

test('administradora: senha do portal cifrada, visível só ao administrador; contrato com parcela inicial/atual e contemplação', async () => {
  const a = await call('admin', 'POST', '/api/administradoras', { name: 'Adm Senha', portal_url: 'portal.ex.com', portal_login: 'user1', portal_password: 'S3nh@!' });
  assert.equal(a.status, 200);
  const raw = appDb.prepare('SELECT portal_password_enc FROM administrators WHERE id = ?').get(a.data.id).portal_password_enc;
  assert.ok(raw && !raw.includes('S3nh@!'), 'guardada cifrada');
  const list = (await call('admin', 'GET', '/api/administradoras')).data;
  assert.ok(list.find((x) => x.id === a.data.id).portal_password_set);
  assert.ok(!JSON.stringify(list).includes('portal_password_enc'));
  assert.equal((await call('admin', 'POST', `/api/administradoras/${a.data.id}/senha`)).data.password, 'S3nh@!');
  assert.equal((await call('gestor', 'POST', `/api/administradoras/${a.data.id}/senha`)).status, 403);
  // Produto contratado
  const n = await call('admin', 'POST', '/api/cadastros', { name: 'Cliente Contrato', phone1: '11 96666-0401', origin: 'indicacao', relationship: 'lead', create_opportunity: false });
  const k = await call('admin', 'POST', '/api/contratos', { contact_id: n.data.id, credit_value: 200000, installment_value: 1100, contract_number: 'CT-77', contracted_at: '2026-09-01', adhesion_date: '2026-09-10', next_readjustment_date: '2027-09-10' });
  assert.equal(k.status, 200, JSON.stringify(k.data));
  let row = appDb.prepare('SELECT * FROM contracts WHERE id = ?').get(k.data.id);
  assert.equal(row.installment_initial, 1100);
  assert.equal(row.available_credit, 200000);
  assert.equal((await call('admin', 'PATCH', `/api/contratos/${k.data.id}`, { installment_value: 1150, contemplated_at: '2026-10-01', contemplation_type: 'lance_retido', contemplation_credit: 205000, net_to_pay: 180000, client_choice: 'venda' })).status, 200);
  row = appDb.prepare('SELECT * FROM contracts WHERE id = ?').get(k.data.id);
  assert.equal(row.installment_initial, 1100);
  assert.equal(row.installment_value, 1150);
  assert.equal(row.client_choice, 'venda');
  assert.equal((await call('admin', 'PATCH', `/api/contratos/${k.data.id}`, { client_choice: 'outra' })).status, 400);
});

test('landing page: simulador (aquisição ou alavancagem) e mecanismo de alavancagem criam lead em Tentativa; proposta do simulador volta ao CRM', async () => {
  const c1 = await userId('c1@t.com');
  await call('admin', 'PATCH', '/api/distribuicao/roleta', { mode: 'sequencial', auto: true, first_contact_hours: 1, participants: [{ user_id: c1, active: true, weight: 1 }] });
  const pub = async (body) => {
    const r = await fetch(`${base}/api/publico/lp/leads`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://lp.exemplo.com' }, body: JSON.stringify(body) });
    return { status: r.status, data: await r.json(), cors: r.headers.get('access-control-allow-origin') };
  };
  const a = await pub({ nome: 'Lia Veículo', email: 'lia.lp@ex.com', celular: '11955551001', categoria: 'Veículo', modo: 'parcela', credito: 100000, parcela: 1500, prazo: 80, preferencia_contato: 'WhatsApp', melhor_horario: 'Manhã', aceite_privacidade: true });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(a.data.objetivo, 'aquisicao');
  assert.equal(a.cors, '*');
  const b = await pub({ nome: 'Ivo Investe', email: 'ivo.lp@ex.com', celular: '11955551002', categoria: 'Investimento', credito: 1000000, aceite_privacidade: true });
  assert.equal(b.data.objetivo, 'alavancagem');
  const m = await pub({ tipo: 'alavancagem_financeira', nome: 'Mel Alavanca', telefone: '11955551003', email: 'mel.lp@ex.com', credito: 500000, inicio: 'De imediato', preferencia_contato: 'Ligação', melhor_horario: 'Noite', aceite_privacidade: true });
  assert.equal(m.data.objetivo, 'alavancagem');
  assert.equal((await pub({ nome: 'Sem Aceite', email: 'sa@ex.com' })).status, 400);
  const found = (await call('admin', 'GET', `/api/cadastros?q=${m.data.codigo}`)).data;
  const mel = (await call('admin', 'GET', `/api/cadastros/${(found.rows || found)[0].id}`)).data;
  assert.equal(mel.owner_id, c1, 'distribuído na hora');
  assert.equal(mel.opportunities[0].stage_name, 'Tentativa de contato');
  assert.equal(mel.opportunities[0].objective_type, 'alavancagem');
  assert.equal(mel.opportunities[0].urgency, 'curto');
  assert.equal(mel.pref_channel, 'ligacao');
  // Mesmo telefone com outro objetivo: sem duplicar o cadastro, abre outro negócio
  const again = await pub({ nome: 'Lia Veículo', email: 'lia.lp@ex.com', celular: '11955551001', categoria: 'Investimento', credito: 800000, aceite_privacidade: true });
  assert.equal(again.data.status, 'existente');
  const lia = (await call('admin', 'GET', `/api/cadastros/${(((await call('admin', 'GET', `/api/cadastros?q=${a.data.codigo}`)).data).rows || [])[0].id}`)).data;
  assert.deepEqual(lia.opportunities.map((o) => o.objective_type).sort(), ['alavancagem', 'aquisicao']);
  // Proposta: o CRM abre o simulador com um token; o simulador devolve valores e PDF
  const st = await call('admin', 'POST', '/api/propostas/iniciar', { contact_id: lia.id });
  assert.equal(st.status, 200, JSON.stringify(st.data));
  const token = new URLSearchParams(new URL(st.data.url, 'http://x').hash.slice(1)).get('crm_token');
  assert.ok(token && !new URL(st.data.url, 'http://x').search.includes('crm_token'), 'token só no #');
  const send = async (b) => { const r = await fetch(`${base}/api/publico/simulador/proposta`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, data: await r.json() }; };
  assert.equal((await send({ token: 'invalido' })).status, 401);
  const ok = await send({ token, credito: 120000, prazo: 80, parcela_inicial: 1780.5, taxa_adm_pct: 15, fundo_reserva_pct: 2, modalidade: 'integral', pdf_nome: 'Proposta.pdf', pdf_base64: Buffer.from('%PDF-1.4 x').toString('base64') });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.ok(ok.data.pdf_anexado);
  const pr = appDb.prepare('SELECT * FROM proposals WHERE code = ?').get(st.data.code);
  assert.equal(pr.credit_value, 120000);
  assert.equal(pr.initial_installment, 1780.5);
  assert.ok(pr.generated_at && pr.pdf_attachment_id);
});

test('planos na proposta: só administradoras e planos ativos (pelo código) ou "Outros"; nova versão abre o simulador e atualiza a mesma proposta (v2)', async () => {
  const plan = await ensurePlan();
  // Código do plano único por administradora
  assert.equal((await call('admin', 'POST', '/api/planos', { id: plan.id, plan_code: 'HS1' })).status, 200);
  const dup = await call('admin', 'POST', '/api/planos', { administrator_id: plan.administrator_id, name: 'Outro HS', plan_code: 'hs1' });
  assert.equal(dup.status, 400);
  assert.match(dup.data.error, /código HS1/);
  const inactive = await call('admin', 'POST', '/api/planos', { administrator_id: plan.administrator_id, name: 'Imóvel 400', plan_code: 'HS2', category: 'imovel', admin_fee_pct: 21, reserve_fund_pct: 1, active: false });
  assert.equal(inactive.status, 200, JSON.stringify(inactive.data));
  assert.equal((await call('admin', 'GET', '/api/planos?active=0')).data.some((p) => p.id === inactive.data.id), true);
  // Simulador: só administradoras e planos ativos
  const sp = (await call('c1', 'GET', '/api/simulador/planos')).data;
  assert.ok(sp.administradoras.some((a) => a.nome === 'Adm Teste'));
  const hs1 = sp.planos.find((p) => p.id === String(plan.id));
  assert.equal(hs1.nome, 'HS1 · HS Imóvel');
  assert.equal(hs1.taxaAdm, 18);
  assert.equal(hs1.indice, 'INCC');
  assert.ok(!sp.planos.some((p) => p.id === String(inactive.data.id)), 'plano inativo fora do simulador');
  // Proposta com plano inativo é recusada; plano de outra administradora também
  const c = await call('c1', 'POST', '/api/cadastros', { name: 'Cliente Planos', phone1: '11 94444-3030', origin: 'indicacao', relationship: 'lead' });
  const opp = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data.opportunities[0];
  const bad = await call('c1', 'POST', '/api/propostas', { opportunity_id: opp.id, product_id: inactive.data.id, credit_value: 200000 });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /inativo/);
  // Plano cadastrado: taxa e fundo de reserva seguem o plano
  const ok = await call('c1', 'POST', '/api/propostas', { opportunity_id: opp.id, administrator_id: plan.administrator_id, product_id: plan.id, credit_value: 200000, admin_fee_pct: 12, reserve_fund_pct: 9 });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  let pr = (await call('c1', 'GET', `/api/propostas/${ok.data.id}`)).data;
  assert.equal(pr.admin_fee_pct, 18);
  assert.equal(pr.reserve_fund_pct, 2);
  assert.equal(pr.administrator_name, 'Adm Teste');
  // "Outros": condições livres, com a administradora
  assert.equal((await call('c1', 'POST', '/api/propostas', { opportunity_id: opp.id, product_id: 'outros', administrator_id: '', credit_value: 150000 })).status, 400);
  const other = await call('c1', 'POST', '/api/propostas', { opportunity_id: opp.id, product_id: 'outros', administrator_id: plan.administrator_id, credit_value: 155000, admin_fee_pct: 20, reserve_fund_pct: 2 });
  assert.equal(other.status, 200, JSON.stringify(other.data));
  pr = (await call('c1', 'GET', `/api/propostas/${other.data.id}`)).data;
  assert.equal(pr.plan_other, 1);
  assert.equal(pr.admin_fee_pct, 20);
  assert.equal(pr.product_id, null);
  // Nova versão: mesmo código com a versão, simulador com as condições e "Atualizar proposta"
  const nv = await call('c1', 'POST', `/api/propostas/${ok.data.id}/nova-versao`, {});
  assert.equal(nv.status, 200, JSON.stringify(nv.data));
  assert.equal(nv.data.version, 2);
  assert.equal(nv.data.code, `${pr.code.replace(/-v\d+$/, '').replace(/.*/, (x) => x)}`.length ? nv.data.code : '');
  const v1 = (await call('c1', 'GET', `/api/propostas/${ok.data.id}`)).data;
  assert.equal(nv.data.code, `${v1.code}-v2`);
  assert.equal(v1.status, 'substituida');
  const u = new URL(nv.data.url, 'http://localhost');
  const q = u.searchParams;
  assert.equal(q.get('acao'), 'atualizar');
  assert.equal(q.get('plano'), String(plan.id));
  assert.equal(q.get('credito'), '200000');
  assert.equal(q.get('taxa_adm'), '18');
  const token = new URLSearchParams(u.hash.slice(1)).get('crm_token');
  assert.ok(token);
  // O simulador devolve os novos valores na mesma proposta (versão 2)
  const r = await fetch(`${base}/api/publico/simulador/proposta`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, plano_id: String(plan.id), administradora: 'Adm Teste', credito: 250000, prazo: 200, parcela_inicial: 1500, taxa_adm_pct: 18, fundo_reserva_pct: 2, pdf_nome: 'v2.pdf', pdf_base64: PDF }) });
  assert.equal(r.status, 200, await r.text());
  const v2 = (await call('c1', 'GET', `/api/propostas/${nv.data.id}`)).data;
  assert.equal(v2.version, 2);
  assert.equal(v2.credit_value, 250000);
  assert.equal(v2.product_id, plan.id);
  assert.ok(v2.pdf_attachment_id);
  assert.ok(Date.parse(v2.created_at) >= Date.parse(v1.created_at));
  // Simulador com "Outros"
  const st = await call('c1', 'POST', '/api/propostas/iniciar', { contact_id: c.data.id });
  const t2 = new URLSearchParams(new URL(st.data.url, 'http://localhost').hash.slice(1)).get('crm_token');
  const r2 = await fetch(`${base}/api/publico/simulador/proposta`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t2, plano_outros: true, administradora: 'Adm Teste', credito: 180000, prazo: 180, taxa_adm_pct: 22, fundo_reserva_pct: 1 }) });
  assert.equal(r2.status, 200, await r2.text());
  const p3 = (await call('c1', 'GET', `/api/propostas/${st.data.id}`)).data;
  assert.equal(p3.plan_other, 1);
  assert.equal(p3.admin_fee_pct, 22);
  assert.equal(p3.administrator_name, 'Adm Teste');
});

test('ficha por e-mail: modelo da Vero enviado pelo SMTP (remetente noreply@veroconsorciosbr.com.br) ou devolvido pronto sem SMTP', async () => {
  const c = await call('c1', 'POST', '/api/cadastros', { name: 'Cliente Email Ficha', phone1: '11 94321-6006', email: 'cliente.ficha@exemplo.com' });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const opp = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data.opportunities[0];
  const ps = await call('c1', 'POST', '/api/pre-vendas', { opportunity_id: opp.id });
  // Sem SMTP: devolve o e-mail pronto (HTML com o passo a passo e o botão) e o link mailto
  const off = await call('c1', 'POST', `/api/pre-vendas/${ps.data.id}/enviar-email`, { base: 'https://crm.vero.test/' });
  assert.equal(off.status, 200, JSON.stringify(off.data));
  assert.equal(off.data.sent, false);
  assert.equal(off.data.reason, 'nao_configurado');
  assert.equal(off.data.from, 'noreply@veroconsorciosbr.com.br');
  assert.match(off.data.html, /Acessar minha ficha/);
  assert.match(off.data.html, /4 últimos dígitos do seu celular/);
  assert.match(off.data.html, /https:\/\/crm\.vero\.test\/#\/ficha\//);
  assert.match(off.data.mailto, /^mailto:cliente\.ficha@exemplo\.com\?subject=/);
  // WhatsApp segue o modelo (4 dígitos e documentos)
  const pv = (await call('c1', 'GET', `/api/pre-vendas/${ps.data.id}?base=https://crm.vero.test/`)).data;
  assert.match(pv.message.text, /4 últimos dígitos do seu celular/);
  assert.match(pv.message.text, /comprovante de endereço/);
  assert.match(pv.message.whatsapp_url, /^https:\/\/wa\.me\/5511943216006\?text=/);
  // SMTP de teste (servidor local)
  const net = require('node:net');
  const got = [];
  const smtp = net.createServer((sock) => {
    let data = false;
    let buf = '';
    sock.write('220 teste ESMTP\r\n');
    sock.on('data', (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (data) {
          if (line === '.') {
            data = false;
            sock.write('250 OK queued\r\n');
          } else got.push(line);
          continue;
        }
        got.push(line);
        if (/^EHLO/.test(line)) sock.write('250-teste\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (/^AUTH PLAIN/.test(line)) sock.write('235 ok\r\n');
        else if (/^(MAIL|RCPT)/.test(line)) sock.write('250 ok\r\n');
        else if (line === 'DATA') {
          data = true;
          sock.write('354 go\r\n');
        } else if (line === 'QUIT') sock.end('221 bye\r\n');
      }
    });
  });
  await new Promise((r) => smtp.listen(0, '127.0.0.1', r));
  try {
    assert.equal((await call('c1', 'PUT', '/api/email/config', { host: '127.0.0.1' })).status, 403);
    const cfg = await call('admin', 'PUT', '/api/email/config', { host: '127.0.0.1', port: smtp.address().port, security: 'none', user: 'noreply@veroconsorciosbr.com.br', password: 'segredo', from_name: 'Vero Consórcios' });
    assert.equal(cfg.status, 200, JSON.stringify(cfg.data));
    assert.equal(cfg.data.configured, true);
    assert.equal(cfg.data.from_email, 'noreply@veroconsorciosbr.com.br');
    const sent = await call('c1', 'POST', `/api/pre-vendas/${ps.data.id}/enviar-email`, { base: 'https://crm.vero.test/' });
    assert.equal(sent.status, 200, JSON.stringify(sent.data));
    assert.equal(sent.data.sent, true, JSON.stringify(sent.data));
    assert.ok(got.includes('MAIL FROM:<noreply@veroconsorciosbr.com.br>'));
    assert.ok(got.includes('RCPT TO:<cliente.ficha@exemplo.com>'));
    assert.ok(got.some((l) => /^Subject: =\?UTF-8\?B\?/.test(l)));
    const html = Buffer.from(got.join('\n').split('Content-Type: text/html; charset=utf-8')[1].split('\n\n')[1].split('--vero')[0].replace(/\s/g, ''), 'base64').toString('utf8');
    assert.match(html, /Acessar minha ficha/);
    const after = (await call('c1', 'GET', `/api/pre-vendas/${ps.data.id}`)).data;
    assert.equal(after.sent_via, 'email');
  } finally {
    smtp.close();
    await call('admin', 'PUT', '/api/email/config', { host: '', user: '', password: '', clear_password: true });
  }
});


/* ------------------------- Colaboradores, Central de documentos, Relatórios por perfil e BI ------------------------- */

const b64 = (text) => Buffer.from(text).toString('base64');

test('colaboradores: cadastro completo por modelo contratual, contratos com anexo, benefícios, situação e acesso só com o módulo', async () => {
  assert.equal((await call('c1', 'GET', '/api/colaboradores')).status, 403, 'especialista não acessa o RH');
  assert.equal((await call('gestor', 'GET', '/api/colaboradores')).status, 403);
  assert.equal((await call('admin', 'POST', '/api/colaboradores', { full_name: 'Ana CPF Errado', cpf: '111.111.111-11' })).status, 400);
  assert.equal((await call('admin', 'POST', '/api/colaboradores', { full_name: 'Bruno PJ', contract_type: 'pj' })).status, 400, 'PJ exige razão social e CNPJ');
  const lider = await call('admin', 'POST', '/api/colaboradores', { full_name: 'Carla Líder', job_title: 'Gerente comercial', contract_type: 'socio', partner_share_pct: 50, pay_model: 'fixa', base_salary: '15000', admission_date: '2021-03-01' });
  assert.equal(lider.status, 200, JSON.stringify(lider.data));
  assert.match(lider.data.code, /^COL-/);
  const e = await call('admin', 'POST', '/api/colaboradores', {
    full_name: 'Daniel Especialista', cpf: '529.982.247-25', rg: '1234567', birth_date: '1995-06-10', phone: '51 99999-0000', personal_email: 'daniel@gmail.com', corporate_email: 'daniel@veroconsorciosbr.com.br',
    cep: '90000-000', street: 'Rua A', number: '10', city: 'Porto Alegre', state: 'RS', emergency_name: 'Maria', emergency_relation: 'Mãe', emergency_phone: '51 98888-0000',
    job_title: 'Especialista em consórcios', job_function: 'Vendas consultivas', leader_id: lider.data.id, admission_date: '2025-01-15',
    contract_type: 'clt', work_schedule: 'Seg a sex, 9h-18h', weekly_hours: 44, daily_hours: 8, break_minutes: 60,
    pay_model: 'hibrida', base_salary: '3000', variable_description: '0,6% do crédito vendido', variable_target: '2000',
  });
  assert.equal(e.status, 200, JSON.stringify(e.data));
  assert.equal((await call('admin', 'POST', '/api/colaboradores', { full_name: 'Duplicado', cpf: '52998224725' })).status, 400, 'CPF único');
  const id = e.data.id;
  assert.equal((await call('admin', 'POST', `/api/colaboradores/${id}/beneficios`, { kind: 'beneficio', type: 'vale_refeicao', amount: 800, company_cost: 800 })).status, 200);
  assert.equal((await call('admin', 'POST', `/api/colaboradores/${id}/beneficios`, { kind: 'beneficio', type: 'plano_saude', description: 'Unimed', amount: 450 })).status, 200);
  assert.equal((await call('admin', 'POST', `/api/colaboradores/${id}/beneficios`, { kind: 'desconto', type: 'desconto_vt', value_type: 'percentual', amount: 6 })).status, 200);
  assert.equal((await call('admin', 'POST', `/api/colaboradores/${id}/beneficios`, { kind: 'desconto', type: 'inexistente' })).status, 400);
  const k = await call('admin', 'POST', `/api/colaboradores/${id}/contratos`, { title: 'Contrato de trabalho CLT', start_date: '2025-01-15', end_date: '2025-04-14', filename: 'contrato.pdf', content_base64: b64('%PDF-1.4 contrato') });
  assert.equal(k.status, 200, JSON.stringify(k.data));
  assert.equal((await call('admin', 'POST', `/api/colaboradores/${id}/contratos`, { title: 'X', start_date: '2025-02-01', end_date: '2025-01-01' })).status, 400, 'término antes do início');
  assert.equal((await call('admin', 'POST', `/api/colaboradores/${id}/arquivos`, { category: 'identificacao', filename: 'rg.exe', content_base64: b64('x') })).status, 400);
  const f = await call('admin', 'POST', `/api/colaboradores/${id}/arquivos`, { category: 'identificacao', filename: 'rg.png', content_base64: b64('png') });
  assert.equal(f.status, 200);
  const d = (await call('admin', 'GET', `/api/colaboradores/${id}`)).data;
  assert.equal(d.leader_name, 'Carla Líder');
  assert.equal(d.cost.fixed, 3000);
  assert.equal(d.cost.variable, 2000);
  assert.equal(d.cost.benefits, 1250);
  assert.equal(d.cost.discounts, 180, '6% do fixo');
  assert.equal(d.cost.total_cost, 6250);
  assert.equal(d.contracts[0].filename, 'contrato.pdf');
  assert.equal(d.files.length, 1);
  const dl = await fetch(`${base}/api/colaboradores-contratos/${k.data.id}/arquivo`, { headers: { Cookie: sessions.admin } });
  assert.equal(dl.status, 200);
  assert.equal(await dl.text(), '%PDF-1.4 contrato');
  // Situação: férias (data de início automática) e desligamento com data obrigatória
  assert.equal((await call('admin', 'PATCH', `/api/colaboradores/${id}`, { status: 'ferias', status_until: '2026-12-20' })).status, 200);
  assert.equal((await call('admin', 'PATCH', `/api/colaboradores/${id}`, { status: 'desligado' })).status, 400);
  assert.equal((await call('admin', 'PATCH', `/api/colaboradores/${id}`, { status: 'desligado', termination_date: '2026-09-30', termination_type: 'pedido', termination_reason: 'Nova oportunidade' })).status, 200);
  assert.equal((await call('admin', 'PATCH', `/api/colaboradores/${id}`, { base_salary: '3500' })).status, 200);
  const h = (await call('admin', 'GET', `/api/colaboradores/${id}`)).data.history;
  assert.ok(h.some((x) => x.kind === 'situacao' && /Desligado/.test(x.text)));
  assert.ok(h.some((x) => x.kind === 'remuneracao' && /3\.500/.test(x.text)));
  const list = (await call('admin', 'GET', '/api/colaboradores')).data;
  assert.ok(!list.rows.some((r) => r.id === id), 'desligado sai da lista padrão');
  assert.ok((await call('admin', 'GET', '/api/colaboradores?todos=1')).data.rows.some((r) => r.id === id));
  // Contrato vencendo gera alerta para quem tem o módulo
  const { contractSweep } = require('../server/services/people');
  await call('admin', 'PATCH', `/api/colaboradores/${id}`, { status: 'ativo', termination_date: '' });
  assert.ok(contractSweep(appDb) >= 1);
});

test('central de documentos: pastas padrão, subpastas, envio com validade, nova versão, alertas e acesso só do administrador', async () => {
  assert.equal((await call('gestor', 'GET', '/api/documentos')).status, 403);
  assert.equal((await call('c1', 'GET', '/api/documentos')).status, 403);
  const root = (await call('admin', 'GET', '/api/documentos')).data;
  assert.equal(root.folders.length, 8);
  const fiscal = root.folders.find((f) => /Fiscal/.test(f.name));
  const sub = await call('admin', 'POST', '/api/documentos/pastas', { name: 'Certidões negativas', parent_id: fiscal.id });
  assert.equal(sub.status, 200);
  assert.equal((await call('admin', 'POST', '/api/documentos/pastas', { name: 'Certidões negativas', parent_id: fiscal.id })).status, 400, 'nome repetido na mesma pasta');
  const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const doc = await call('admin', 'POST', '/api/documentos', { folder_id: sub.data.id, title: 'CND Federal', doc_number: '123', issuer: 'Receita Federal', expires_at: soon, filename: 'cnd.pdf', content_base64: b64('v1') });
  assert.equal(doc.status, 200, JSON.stringify(doc.data));
  assert.equal((await call('admin', 'POST', '/api/documentos', { folder_id: sub.data.id, filename: 'virus.exe', content_base64: b64('x') })).status, 400);
  let view = (await call('admin', 'GET', `/api/documentos?pasta=${sub.data.id}`)).data;
  assert.equal(view.documents[0].expiry, 'vencendo');
  assert.deepEqual(view.path.map((p) => p.name), [fiscal.name, 'Certidões negativas']);
  assert.ok((await call('admin', 'GET', '/api/documentos')).data.alerts.some((a) => a.id === doc.data.id));
  assert.ok((await call('admin', 'GET', '/api/documentos?q=Receita')).data.documents.some((a) => a.id === doc.data.id), 'busca em todas as pastas');
  // Nova versão: a anterior fica no histórico
  const v2 = await call('admin', 'POST', '/api/documentos', { id: doc.data.id, expires_at: '2027-12-31', filename: 'cnd-2.pdf', content_base64: b64('v2') });
  assert.equal(v2.data.version, 2);
  const det = (await call('admin', 'GET', `/api/documentos/${v2.data.id}`)).data;
  assert.equal(det.versions.length, 1);
  assert.equal(det.expiry, 'ok');
  const dl = await fetch(`${base}/api/documentos/${det.versions[0].id}/arquivo`, { headers: { Cookie: sessions.admin } });
  assert.equal(await dl.text(), 'v1');
  view = (await call('admin', 'GET', `/api/documentos?pasta=${sub.data.id}`)).data;
  assert.equal(view.documents.length, 1);
  // Pasta com arquivo não pode ser excluída; pasta principal também não
  const del = (url) => call('admin', 'DELETE', url);
  assert.equal((await del(`/api/documentos/pastas/${sub.data.id}`)).status, 400);
  assert.equal((await del(`/api/documentos/pastas/${fiscal.id}`)).status, 400);
  // Alerta de validade (uma vez por documento)
  const late = await call('admin', 'POST', '/api/documentos', { folder_id: sub.data.id, title: 'Alvará', expires_at: '2020-01-01', filename: 'alvara.pdf', content_base64: b64('a') });
  const { expirySweep } = require('../server/services/documents');
  assert.ok(expirySweep(appDb) >= 1);
  assert.equal(expirySweep(appDb), 0);
  assert.equal((await del(`/api/documentos/${late.data.id}`)).status, 200, 'arquivar');
  assert.equal((await del(`/api/documentos/${v2.data.id}?definitivo=1`)).status, 200);
  assert.equal((await del(`/api/documentos/pastas/${sub.data.id}`)).status, 400, 'ainda tem o arquivado');
  assert.equal((await del(`/api/documentos/${late.data.id}?definitivo=1`)).status, 200);
  assert.equal((await del(`/api/documentos/pastas/${sub.data.id}`)).status, 200);
});

test('relatórios por perfil: especialista só vê as próprias vendas, sem exportar; administrador exporta Excel e o pacote', async () => {
  const cat = (await call('c1', 'GET', '/api/relatorios')).data;
  assert.equal(cat.export, false);
  assert.deepEqual([...new Set(cat.reports.map((r) => r.group))], ['Meu desempenho']);
  assert.equal((await call('c1', 'GET', '/api/relatorios/leads_por_origem')).status, 403, 'sem dados de leads');
  assert.equal((await call('c1', 'GET', '/api/relatorios/fin_saldos')).status, 403);
  const mine = await call('c1', 'GET', '/api/relatorios/minhas_vendas?from=2020-01-01T00:00:00Z&to=2030-01-01T00:00:00Z');
  assert.equal(mine.status, 200);
  assert.equal(mine.data.exportable, false);
  assert.ok(!mine.data.extra.columns.some((c) => /cliente|nome|telefone|email/i.test(c.key)), 'sem dados do cliente');
  assert.equal((await call('c1', 'GET', '/api/relatorios/minhas_vendas/csv')).status, 403);
  assert.equal((await call('c1', 'GET', '/api/relatorios/minhas_vendas/xlsx')).status, 403);
  const g = (await call('gestor', 'GET', '/api/relatorios')).data;
  assert.ok(g.reports.some((r) => r.group === 'Comercial'));
  assert.ok(!g.reports.some((r) => r.group === 'Financeiro' || r.group === 'Pessoas (RH)'));
  const a = (await call('admin', 'GET', '/api/relatorios')).data;
  assert.ok(['Vendas e operação', 'Financeiro', 'Pessoas (RH)', 'Comercial'].every((x) => a.reports.some((r) => r.group === x)));
  const x = await fetch(`${base}/api/relatorios/fin_pagar/xlsx?from=2020-01-01T00:00:00Z&to=2030-01-01T00:00:00Z`, { headers: { Cookie: sessions.admin } });
  assert.equal(x.status, 200);
  assert.match(x.headers.get('content-type'), /spreadsheetml/);
  const buf = Buffer.from(await x.arrayBuffer());
  assert.equal(buf.slice(0, 2).toString(), 'PK');
  const pk = await fetch(`${base}/api/relatorios-pacote.xlsx?grupo=Financeiro`, { headers: { Cookie: sessions.admin } });
  assert.equal(pk.status, 200);
  assert.ok((await pk.arrayBuffer()).byteLength > 1000);
  assert.equal((await fetch(`${base}/api/relatorios-pacote.xlsx`, { headers: { Cookie: sessions.gestor } })).status, 403);
  const saldo = (await call('admin', 'GET', '/api/relatorios/fin_saldos')).data;
  assert.equal(saldo.rows.length, 3, '30, 60 e 90 dias');
  assert.ok('excedente' in saldo.rows[0]);
  const rem = (await call('admin', 'GET', '/api/relatorios/rh_remuneracao')).data;
  assert.ok(rem.rows.some((r) => r.nome === 'Daniel Especialista'));
});

test('conexão BI: bases em JSON e CSV com o token da integração, sem dados pessoais sensíveis', async () => {
  assert.equal((await call(null, 'GET', '/api/bi')).status, 401);
  const t = await call('admin', 'POST', '/api/integracoes/bi/token');
  assert.equal(t.status, 200);
  const h = { Authorization: `Bearer ${t.data.token}` };
  const idx = await call(null, 'GET', '/api/bi', undefined, h);
  assert.equal(idx.status, 200, JSON.stringify(idx.data));
  assert.ok(idx.data.bases.some((b) => b.base === 'vendas'));
  for (const b of idx.data.bases) {
    const r = await call(null, 'GET', `/api/bi/${b.base}`, undefined, h);
    assert.equal(r.status, 200, `${b.base}: ${JSON.stringify(r.data)}`);
  }
  await call('admin', 'POST', '/api/colaboradores', { full_name: 'Elisa BI', cpf: '390.533.447-05', pix_key: 'elisa@pix', personal_email: 'elisa@gmail.com', job_title: 'Analista' });
  const col = (await call(null, 'GET', '/api/bi/colaboradores', undefined, h)).data;
  assert.ok(col.linhas >= 1);
  assert.ok(!Object.keys(col.dados[0]).some((k) => /^(cpf|rg|pix_key|personal_email|corporate_email|phone)$|bank|email|telefone/i.test(k)));
  assert.ok(!JSON.stringify(col.dados).includes('39053344705'));
  const csv = await fetch(`${base}/api/bi/financeiro?formato=csv&token=${encodeURIComponent(t.data.token)}`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.equal((await call(null, 'GET', '/api/bi/inexistente', undefined, h)).status, 400);
  assert.equal((await fetch(`${base}/api/bi/vendas?token=errado`)).status, 401);
});
