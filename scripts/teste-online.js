'use strict';
/**
 * Teste online do CRM Vero (Vercel + Supabase + LPs na HostGator).
 *   DEMO_PASSWORD=<senha da demonstração> npm run teste:online   (CRM=<outro endereço> para testar outra publicação)
 * Confere servidor, banco, tela, LPs da HostGator, login, CORS e cria (ou reaproveita) 2 leads de teste: "Teste Online Consórcio" e "Teste Online Planejamento".
 */
const BASE = (process.env.CRM || 'https://crm.veroconsorciosbr.com.br').replace(/\/+$/, '');
const SITE = 'https://veroconsorciosbr.com.br';
const results = [];
const mark = (name, pass, info = '') => {
  results.push({ name, pass, info });
  console.log(`${pass ? 'OK   ' : 'FALHA'} ${name}${info ? ` — ${info}` : ''}`);
  return pass;
};

async function req(method, url, { body, headers = {}, cookie } = {}) {
  const h = { ...headers };
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  try {
    const r = await fetch(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(90000) });
    const text = await r.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {}
    return { status: r.status, headers: r.headers, data, text };
  } catch (e) {
    return { status: 0, headers: new Headers(), data: null, text: '', error: e.cause?.code || e.cause?.message || e.message };
  }
}
const why = (r) => r.error || r.headers.get('x-vercel-error') || r.data?.error || `HTTP ${r.status}`;

async function main() {
  // 1. Servidor e banco
  const s = await req('GET', `${BASE}/api/saude`);
  const apiOk = mark('Servidor do CRM e banco (/api/saude)', s.status === 200 && s.data?.ok === true && s.data?.tipo === 'postgres',
    s.status === 200 ? JSON.stringify(s.data) : why(s));

  // 2. Tela do CRM
  const home = await req('GET', `${BASE}/`);
  const app = await req('GET', `${BASE}/js/app.js`);
  mark('Tela do CRM (index.html e js/app.js)', home.status === 200 && /src="\/js\/app\.js"/.test(home.text) && app.status === 200,
    `index ${home.status || home.error}, app.js ${app.status || app.error}${home.headers.get('server') ? `, servidor ${home.headers.get('server')}` : ''}`);

  // 3. LPs na HostGator apontando para o CRM
  for (const [nome, path] of [['LP Consórcio (index)', '/'], ['LP Planejamento', '/lp-planejamento.html']]) {
    const lp = await req('GET', `${SITE}${path}?v=${Date.now()}`);
    const cfg = (/window\.VERO_LP=\{crm:"([^"]*)"/.exec(lp.text) || [])[1];
    mark(`${nome} no ar e configurada`, lp.status === 200 && cfg === BASE,
      lp.status !== 200 ? why(lp) : cfg == null ? 'arquivo antigo (sem VERO_LP: não envia leads)' : `envia para "${cfg}"`);
  }

  if (!apiOk) {
    console.log('\nServidor/banco fora do ar: os testes de login e de leads ficam para depois.');
    return;
  }

  // 4. Login de demonstração
  let cookie = null;
  if (process.env.DEMO_PASSWORD) {
    const l = await req('POST', `${BASE}/api/login`, { body: { email: 'admin@demo.local', password: process.env.DEMO_PASSWORD }, headers: { 'X-Requested-With': 'crm' } });
    cookie = (l.headers.get('set-cookie') || '').split(';')[0] || null;
    mark('Login admin@demo.local', l.status === 200 && !!cookie, l.status === 200 ? '' : why(l));
  }

  // 5. CORS da LP (pré-verificação do navegador)
  const pre = await req('OPTIONS', `${BASE}/api/publico/lp/leads`, { headers: { Origin: SITE, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  const acao = pre.headers.get('access-control-allow-origin');
  mark('LP pode enviar ao CRM (CORS)', pre.status === 204 && (acao === '*' || acao === SITE), `HTTP ${pre.status || pre.error}, allow-origin ${acao || 'ausente'}`);

  // 6. Leads de teste no formato que as LPs enviam
  const leads = [
    ['consorcio', {
      nome: 'Teste Online Consórcio', email: 'teste.online.consorcio@exemplo.com.br', celular: '11900007001', categoria: 'Imóvel', modo: 'credito', credito: 300000, prazo: 200,
      preferencia_contato: 'WhatsApp', melhor_horario: 'Manhã', aceite_privacidade: true, origem: 'LP Consórcios · teste online', pagina: `${SITE}/?utm_source=teste`,
      utm: { utm_source: 'teste', utm_medium: 'validacao', utm_campaign: 'teste_online_2026-11' }, rastreio: { lp: 'consorcios', area: 'consorcio', visitas: 1 },
    }],
    ['planejamento', {
      tipo: 'planejamento_financeiro', nome: 'Teste Online Planejamento', email: 'teste.online.planejamento@exemplo.com.br', celular: '11900007002', preferencia_contato: 'WhatsApp', melhor_horario: 'Noite',
      objetivo: 'Organizar as finanças', prazo: 'Até 6 meses', renda_familiar: 'De R$ 7.000 a R$ 10.000', consegue_guardar: 'Não', aceite_privacidade: true, aceite_contato: true,
      origem: 'LP Planejamento · teste online', pagina: `${SITE}/lp-planejamento.html?utm_source=teste`,
      utm: { utm_source: 'teste', utm_medium: 'validacao', utm_campaign: 'teste_online_2026-11' }, rastreio: { lp: 'planejamento', area: 'planejamento', visitas: 1 },
    }],
  ];
  for (const [area, body] of leads) {
    const r = await req('POST', `${BASE}/api/publico/lp/leads`, { body, headers: { Origin: SITE } });
    const pass = mark(`Lead de teste pela LP (${area})`, r.status === 200 && ['criado', 'existente'].includes(r.data?.status),
      r.status === 200 ? `${r.data.status}, código ${r.data.codigo}, área ${r.data.area}` : why(r));
    if (!pass || !cookie) continue;
    const list = await req('GET', `${BASE}/api/cadastros?q=${encodeURIComponent(r.data.codigo)}`, { cookie, headers: { 'X-Requested-With': 'crm' } });
    const row = (list.data?.rows || list.data || [])[0];
    const det = row ? await req('GET', `${BASE}/api/cadastros/${row.id}`, { cookie, headers: { 'X-Requested-With': 'crm' } }) : null;
    const c = det?.data || {};
    const opp = (c.opportunities || []).find((o) => o.business_area === area) || (c.opportunities || [])[0] || {};
    mark(`Lead (${area}) no CRM com origem LP e área`, c.origin === 'landing_page' && opp.business_area === area,
      `origem ${c.origin}, área ${opp.business_area}, etapa ${opp.stage_name}, responsável ${c.owner_name || c.owner_id || '—'}`);
  }
}

main().then(() => {
  const bad = results.filter((r) => !r.pass);
  console.log(`\n${results.length - bad.length}/${results.length} verificações OK`);
  process.exitCode = bad.length ? 1 : 0;
});
