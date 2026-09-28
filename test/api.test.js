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

test('funil: perda exige motivo, venda converte em cliente e mantém histórico', async () => {
  const c = await call('c1', 'POST', '/api/cadastros', { name: 'Cliente Funil', phone1: '31 98888-7777' });
  const detail = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data;
  const opp = detail.opportunities[0];
  const meta = (await call('c1', 'GET', '/api/meta')).data;
  const lost = meta.stages.find((s) => s.kind === 'perdido');
  const won = meta.stages.find((s) => s.kind === 'ganho');
  const r1 = await call('c1', 'POST', `/api/oportunidades/${opp.id}/etapa`, { stage_id: lost.id });
  assert.equal(r1.status, 400);
  // Venda bloqueada enquanto a ficha de pré-venda estiver incompleta
  const blocked = await call('c1', 'POST', `/api/oportunidades/${opp.id}/etapa`, { stage_id: won.id });
  assert.equal(blocked.status, 400);
  assert.ok(blocked.data.details.missing.some((m) => m.key === 'doc:identificacao'));
  await completeForSale(c.data.id);
  const r2 = await call('c1', 'POST', `/api/oportunidades/${opp.id}/etapa`, { stage_id: won.id, contract: { administrator: 'Adm X', credit_value: 100000 } });
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  const after = (await call('c1', 'GET', `/api/cadastros/${c.data.id}`)).data;
  assert.equal(after.relationship, 'cliente');
  assert.equal(after.lead_status, 'convertido');
  assert.equal(after.contracts.length, 1);
  const o = (await call('c1', 'GET', `/api/oportunidades/${opp.id}`)).data;
  assert.equal(o.status, 'ganha');
  assert.equal(o.stage_history.length, 2);
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
  assert.equal(d.client_link.access_count, 2);
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
  const won = (await call('c1', 'GET', '/api/meta')).data.stages.find((s) => s.kind === 'ganho');
  const mv = await call('c1', 'POST', `/api/oportunidades/${d.opportunities[0].id}/etapa`, { stage_id: won.id, contract: { administrator: 'Adm X', group_code: 'G1', quota_code: '10', credit_value: 200000 } });
  assert.equal(mv.status, 200, JSON.stringify(mv.data));
  d = (await call('c1', 'GET', `/api/cadastros/${id}`)).data;
  assert.deepEqual(d.post_sale.map((p) => p.item), ['primeira_parcela', 'onboarding', 'estrategia_lance', 'recebimento_boletos', 'indicacao']);
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
