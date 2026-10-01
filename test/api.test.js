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
    const u = await call('admin', 'POST', '/api/usuarios', { name, email, role, team_id, password: 'senha1234', dialer_agent_ref: email === 'c1@t.com' ? 'ramal-1' : undefined });
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
/** Fluxo completo de venda: pré-venda → conferência → termo de adesão → contrato → boleto → pagamento confirmado. */
async function sellViaFlow(who, oppId, credit = 200000, extra = {}) {
  const plan = await ensurePlan();
  const ps = await call(who, 'POST', '/api/pre-vendas', { opportunity_id: oppId });
  assert.equal(ps.status, 200, JSON.stringify(ps.data));
  let sale = null;
  for (const [step, body] of [['conferido', {}], ['termo_adesao', { plan_id: plan.id, credit_value: credit }], ['contrato_enviado', {}], ['contrato_assinado', {}], ['boleto_emitido', { boleto_value: 1500, boleto_due: todayStr() }]]) {
    const r = await call(who, 'POST', `/api/pre-vendas/${ps.data.id}/avancar`, { step, ...body });
    assert.equal(r.status, 200, `${step}: ${JSON.stringify(r.data)}`);
    if (r.data.sale) sale = r.data.sale;
  }
  const c = await call(who, 'POST', `/api/vendas/${sale.id}/confirmar`, { payment_date: extra.payment_date || todayStr(), filename: 'comprovante.pdf', mime: 'application/pdf', content_base64: PDF, group_code: extra.group_code, quota_code: extra.quota_code, pref_channel: 'whatsapp' });
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
  for (const key of Object.keys(list)) {
    const r = await call('gestor', 'GET', `/api/relatorios/${key}`);
    assert.equal(r.status, 200, key);
    assert.ok(r.data.definition.length > 0, key);
    const csv = await call('gestor', 'GET', `/api/relatorios/${key}/csv`);
    assert.equal(csv.status, 200, key);
  }
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
  const form = await call(null, 'GET', `/api/publico/ficha?token=${encodeURIComponent(tok)}`);
  assert.equal(form.status, 200);
  assert.equal(form.data.values.name, 'Cliente Link');
  assert.ok(form.data.values.initial_notes === undefined, 'só campos externos');
  const sub = await call(null, 'POST', '/api/publico/ficha', { token: tok, values: { rg: '998877', mother_name: 'Mãe do Cliente', owner_id: 1 }, address: { cep: '20040020', street: 'Av. Rio Branco', number: '10', district: 'Centro', city: 'Rio de Janeiro', state: 'RJ' } });
  assert.equal(sub.status, 200, JSON.stringify(sub.data));
  const up = await call(null, 'POST', '/api/publico/ficha/anexo', { token: tok, doc_type: 'identificacao', filename: 'rg.pdf', content_base64: PDF });
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
  await call(null, 'GET', `/api/publico/ficha?token=${encodeURIComponent(l.data.token)}`);
  await call(null, 'GET', `/api/publico/ficha?token=${encodeURIComponent(l.data.token)}`);
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
  await call(null, 'POST', '/api/publico/ficha/anexo', { token: l.data.token, doc_type: 'identificacao', filename: 'rg.pdf', content_base64: PDF });
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
  const again = await call(null, 'POST', '/api/publico/ficha/anexo', { token: l.data.token, doc_type: 'identificacao', filename: 'rg2.pdf', content_base64: PDF });
  assert.equal(again.status, 200);
  const newest = (await call('c1', 'GET', `/api/cadastros/${id}`)).data.attachments.find((a) => a.filename === 'rg2.pdf');
  assert.equal((await call('c1', 'PATCH', `/api/anexos/${newest.id}`, { status: 'aprovado' })).status, 200);
  d = (await call('c1', 'GET', `/api/cadastros/${id}`)).data;
  assert.equal(d.sale_checklist.items.find((i) => i.key === 'doc:identificacao').ok, true);
  // vencido não conta
  await call('c1', 'POST', `/api/cadastros/${id}/anexos`, { doc_type: 'comprovante_renda', filename: 'renda.pdf', content_base64: PDF, valid_until: '2020-01-01' });
  d = (await call('c1', 'GET', `/api/cadastros/${id}`)).data;
  assert.equal(d.sale_checklist.items.find((i) => i.key === 'doc:comprovante_renda').status, 'vencido');
});

test('pós-venda: pesquisa NPS por link com histórico, cancelamento justificado e estratégia de lance', async () => {
  const c = await call('c1', 'POST', '/api/cadastros', { name: 'Cliente Pós', phone1: '11 95555-0104' });
  const id = c.data.id;
  await completeForSale(id);
  let d = (await call('c1', 'GET', `/api/cadastros/${id}`)).data;
  await sellViaFlow('c1', d.opportunities[0].id, 200000, { group_code: 'G1', quota_code: '10' });
  d = (await call('c1', 'GET', `/api/cadastros/${id}`)).data;
  assert.deepEqual(d.post_sale.map((p) => p.item), ['primeira_parcela', 'onboarding', 'estrategia_lance', 'recebimento_boletos', 'preferencias_contato', 'indicacao']);
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
  const u = new URL(p.data.url);
  assert.equal(u.searchParams.get('nome'), 'Maria Simulada');
  assert.equal(u.searchParams.get('contato').replace(/\D/g, ''), '11955550106', 'usa o WhatsApp do cliente');
  assert.equal((await call('leitor', 'POST', `/api/cadastros/${c.data.id}/simulador-proposta`, {})).status, 403);
});

const userId = async (email) => (await call('admin', 'GET', '/api/usuarios')).data.find((u) => u.email === email).id;

test('funil: passagem sequencial com critérios de entrada; voltar exige motivo; administrador força com justificativa', async () => {
  const c = await call('c1', 'POST', '/api/cadastros', { name: 'Regras Funil', phone1: '11 94444-1001', origin: 'site', relationship: 'lead' });
  const opp = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data.opportunities[0];
  const stages = (await call('c1', 'GET', '/api/meta')).data.stages;
  const st = (k) => stages.find((s) => s.key === k);
  assert.equal(opp.stage_id, st('lead').id, 'lead com contato entra em "Lead"');
  // Pular etapas não é permitido
  const skip = await call('c1', 'POST', `/api/oportunidades/${opp.id}/etapa`, { stage_id: st('negociacao').id });
  assert.equal(skip.status, 400);
  assert.match(skip.data.error, /pular etapas/);
  // Tentativa de contato exige registro de tentativa
  const t1 = await call('c1', 'POST', `/api/oportunidades/${opp.id}/etapa`, { stage_id: st('tentativa').id });
  assert.equal(t1.status, 400);
  assert.ok(t1.data.details.missing.some((m) => m.key === 'tentativa_registrada'));
  const crit = await call('c1', 'GET', `/api/oportunidades/${opp.id}/criterios`);
  assert.equal(crit.data.next_stage.key, 'tentativa');
  assert.equal(crit.data.criteria[0].ok, false);
  const act = await call('c1', 'POST', '/api/atividades', { contact_id: c.data.id, opportunity_id: opp.id, type: 'ligacao_realizada', result: 'nao_atendida' });
  assert.equal(act.status, 200, JSON.stringify(act.data));
  assert.equal((await call('c1', 'POST', `/api/oportunidades/${opp.id}/etapa`, { stage_id: st('tentativa').id })).status, 200);
  // Qualificado exige conversa efetiva e qualificação
  const q = await call('c1', 'POST', `/api/oportunidades/${opp.id}/etapa`, { stage_id: st('qualificado').id });
  assert.equal(q.status, 400);
  assert.deepEqual(q.data.details.missing.map((m) => m.key).sort(), ['contato_efetivo', 'qualificacao']);
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
  assert.equal((await call('c1', 'POST', `/api/pre-vendas/${ps.data.id}/avancar`, { step: 'contrato_enviado' })).status, 400, 'segue a sequência');
  assert.equal((await call('c1', 'POST', `/api/pre-vendas/${ps.data.id}/avancar`, { step: 'termo_adesao', plan_id: plan.id, credit_value: 205000 })).status, 400);
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
  assert.equal((await call(null, 'GET', `/api/publico/ficha?token=${token}`)).status, 200);
  d = (await call('c1', 'GET', `/api/pre-vendas/${ps.data.id}`)).data;
  assert.equal(d.status, 'acessado');
  assert.equal((await call(null, 'POST', '/api/publico/ficha/concluir', { token })).status, 400, 'ficha incompleta');
  await completeForSale(c.data.id);
  assert.equal((await call(null, 'POST', '/api/publico/ficha/concluir', { token })).status, 200);
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
