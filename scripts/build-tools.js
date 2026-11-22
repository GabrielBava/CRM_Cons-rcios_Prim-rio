#!/usr/bin/env node
'use strict';
/**
 * Gera as ferramentas HTML da Vero (Ferramentas › Planejamento financeiro e › Consórcio) a partir dos arquivos originais:
 *
 *   node scripts/build-tools.js --diag <Diagnostico.html> --sim <Simulador.html>
 *   node scripts/build-tools.js --atualizar-ponte   (só reaplica a ponte com o CRM no diagnóstico já gerado)
 *
 * Saída (servida pelo CRM):
 *   public/ferramentas/diagnostico-financeiro.html  — marca Vero Planejamento + ponte com o CRM (?crm=<id>)
 *   public/ferramentas/simulador-consorcio.html     — marca Vero Consórcios (tela de acesso e conteúdo após a senha)
 *
 * Diagnóstico: troca cores (dourado → aço/azul da Vero), fonte (Poppins), logos, textos de marca, endereços e as páginas
 * institucionais (scripts/tools-assets). A ponte com o CRM busca os dados do cliente, abre o cliente direto e devolve o
 * diagnóstico ao CRM a cada alteração (salvamento automático).
 * Simulador: o conteúdo é cifrado (AES-GCM) e só existe depois da senha; a tela de acesso é refeita na marca Vero e o
 * conteúdo decifrado recebe as mesmas trocas (cores, fonte, logos e textos) antes de ser exibido.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'ferramentas');
const ASSETS = path.join(__dirname, 'tools-assets');
const IMG = path.join(ROOT, 'public', 'img');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
};
const dataUri = (file, mime) => `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
const SITE = 'veroconsorciosbr.com.br';

/** Troca exata (todas as ocorrências); avisa quando o trecho não foi encontrado (versão diferente do arquivo). */
function swap(s, from, to, { optional = false } = {}) {
  if (!s.includes(from)) {
    if (!optional) console.warn(`  aviso: trecho não encontrado: ${from.slice(0, 70)}`);
    return s;
  }
  return s.split(from).join(to);
}
function swapRe(s, re, to) {
  return s.replace(re, to);
}

/* ------------------------- Paleta Vero ------------------------- */

/** Cores do arquivo original (dourado/creme/marinho) → paleta Vero (azul-noite, marinho, ardósia, aço, névoa). */
const HEX = {
  '141c3b': '0D1B2A', '141b3d': '0D1B2A', 'c7a340': '778DA9', 'c9a23f': '778DA9', '8a6a1f': '415A77', 'e3c77a': 'A9B8CB',
  'e8d39a': 'A9B8CB', 'e8d28c': 'A9B8CB', '232c5c': '1B263B', '293866': '273A52', '20295a': '1B263B', '0d1230': '0D1B2A',
  '080b1f': '08121D', 'f7f4ec': 'F1F3F6', 'efeadf': 'E9EDF2', 'faf8f3': 'F7F8FA', 'fcfaf5': 'FAFBFC', 'ebe8de': 'E6EAF0',
  'e3dfd3': 'DCE2E9', 'eeebe3': 'E9EDF2', 'e7e4dc': 'E3E8EE', 'e6e1d6': 'DDE3EA', 'f7f5e8': 'F1F3F6', 'e0ded4': 'DCE2E9',
  'dcdad0': 'D7DEE6', 'dcd9cf': 'D7DEE6', 'd8d6cc': 'D3DAE3', 'b8892f': '778DA9', 'a67622': '415A77', 'd6ac56': 'A9B8CB',
  'f3d98f': 'E0E1DD', 'a9772a': '778DA9', 'd9b25e': '778DA9', 'b8862f': '415A77', '8f6220': '1B263B', 'ea6a2a': '415A77',
  'eb6834': '778DA9', 'd95926': '778DA9',
};
function recolor(s) {
  return s.replace(/#([0-9a-fA-F]{6})\b/g, (m, h) => (HEX[h.toLowerCase()] ? `#${HEX[h.toLowerCase()]}` : m));
}

/* ------------------------- Diagnóstico financeiro ------------------------- */

function buildDiagnostic(src) {
  let s = fs.readFileSync(src, 'utf8');
  const before = s.length;
  // Cabeçalho: título, descrição, ícone e fonte
  s = swapRe(s, /<title>[^<]*<\/title>/, '<title>Diagnóstico financeiro | Vero Planejamento</title>');
  s = swapRe(s, /<meta name="description" content="[^"]*"/, '<meta name="description" content="Diagnóstico financeiro Vero Planejamento: prioridades, projeções e plano de ação personalizado."');
  s = swapRe(s, /<link rel="icon"[^>]*>/, `<link rel="icon" type="image/png" href="${dataUri(path.join(IMG, 'favicon.png'), 'image/png')}" />`);
  s = swap(s, 'family=Inter:wght@400;500;600;700', 'family=Poppins:wght@300;400;500;600;700');
  s = swap(s, 'font-family:Inter,', 'font-family:Poppins,');
  s = swap(s, 'font:600 16px/1.5 Inter,', 'font:600 16px/1.5 Poppins,');
  s = swap(s, '$v="Inter, ui-sans-serif', '$v="Poppins, ui-sans-serif');

  // Tema (tokens do Tailwind): escuro e claro na paleta Vero
  s = swap(s, '.dark{--background: 9 12 18;--foreground: 236 233 226;--card: 16 20 28;--popover: 20 25 35;--border: 38 45 58;--input: 22 27 37;--muted: 32 38 50;--muted-foreground: 150 156 170;--secondary: 26 31 42;--primary: 214 172 86;--primary-foreground: 22 17 8;',
    '.dark{--background: 8 18 29;--foreground: 224 225 221;--card: 13 27 42;--popover: 18 33 51;--border: 39 58 82;--input: 16 31 48;--muted: 27 38 59;--muted-foreground: 169 184 203;--secondary: 22 36 54;--primary: 169 184 203;--primary-foreground: 13 27 42;');
  s = swap(s, '--gradient-gold: linear-gradient(135deg, #f3d98f 0%, #d6ac56 45%, #a9772a 100%)', '--gradient-gold: linear-gradient(135deg, #E0E1DD 0%, #A9B8CB 45%, #778DA9 100%)');
  s = swap(s, '.light{--background: 247 245 240;--foreground: 24 26 32;--card: 255 255 255;--popover: 255 255 255;--border: 226 222 212;--input: 250 249 246;--muted: 238 235 228;--muted-foreground: 98 102 114;--secondary: 243 240 233;--primary: 166 118 34;--primary-foreground: 22 17 8;',
    '.light{--background: 238 241 245;--foreground: 13 27 42;--card: 255 255 255;--popover: 255 255 255;--border: 214 220 228;--input: 248 249 251;--muted: 230 234 239;--muted-foreground: 65 90 119;--secondary: 236 239 243;--primary: 27 38 59;--primary-foreground: 255 255 255;');
  s = swap(s, '--gradient-gold: linear-gradient(135deg, #d9b25e 0%, #b8862f 50%, #8f6220 100%)', '--gradient-gold: linear-gradient(135deg, #778DA9 0%, #415A77 50%, #1B263B 100%)');
  s = recolor(s);

  // Logos e imagens da marca anterior → Vero Planejamento
  const logoLight = dataUri(path.join(IMG, 'vero-planejamento-light.png'), 'image/png'); // texto escuro (fundo branco)
  const logoDark = dataUri(path.join(IMG, 'vero-planejamento-dark.png'), 'image/png'); // texto claro (fundo escuro)
  s = swapRe(s, /const \$b="data:image\/webp;base64,[A-Za-z0-9+/=]+"/, `const $b="${logoLight}"`);
  s = swapRe(s, /Zde="data:image\/png;base64,[A-Za-z0-9+/=]+"/, `Zde="${logoDark}"`);
  s = swapRe(s, /bpe="data:image\/webp;base64,[A-Za-z0-9+/=]+"/, `bpe="${dataUri(path.join(ASSETS, 'acompanhamento.webp'), 'image/webp')}"`);
  // Apresentação institucional (V1): páginas da Vero no lugar das 18 páginas anteriores
  const pages = fs.readdirSync(ASSETS).filter((f) => /^institucional-\d+\.webp$/.test(f)).sort();
  s = swapRe(s, /\b(uB|dB|pB|fB|mB|hB|vB|gB|xB|AB|yB|bB|jB|wB|NB|PB|OB|CB)="data:image\/webp;base64,[A-Za-z0-9+/=]+"/g, '$1=""');
  // Lista das páginas antigas (com os links da plataforma anterior) sai do arquivo
  const sb = s.search(/\bSB=\[\{arquivo:"pagina-/);
  if (sb >= 0) {
    let i = s.indexOf('[', sb);
    let depth = 0;
    for (; i < s.length; i += 1) {
      if (s[i] === '[') depth += 1;
      else if (s[i] === ']' && (depth -= 1) === 0) break;
    }
    s = `${s.slice(0, sb)}SB=[]${s.slice(i + 1)}`;
  }
  s = swap(s, 'EB={paginas:SB}', `EB={paginas:${JSON.stringify(pages.map((f) => ({ arquivo: f, largura: 1920, altura: 1080, links: [] })))}}`);
  s = swapRe(s, /MB=Object\.assign\(\{"\/src\/assets\/v1\/pagina-01\.webp"[^)]*\}\)/, `MB=${JSON.stringify(Object.fromEntries(pages.map((f) => [`/src/assets/v1/${f}`, dataUri(path.join(ASSETS, f), 'image/webp')])))}`);

  // Logotipo em texto (cabeçalho do app e relatório)
  s = swap(s, 'className:"text-gold text-lg font-black tracking-[0.12em]",children:"LIFE"', 'className:"text-gold text-lg font-black tracking-[0.12em]",children:"VERO"');
  s = swap(s, 'children:"Grupo"}),s.jsx("span",{className:"rel-logo-forte",children:"Life"}),s.jsx("span",{className:"rel-logo-leve",children:"Brasil"})',
    'children:""}),s.jsx("span",{className:"rel-logo-forte",children:"Vero"}),s.jsx("span",{className:"rel-logo-leve",children:"Planejamento"})');
  s = swap(s, "hpe='@page{size:A4 landscape;margin:0}", "hpe='@page{size:A4 landscape;margin:0}.rel-logo-coracao{display:none!important}");
  s = swap(s, 'className:e==="Life"?"font-bold":"font-light"', 'className:e==="Vero"?"font-bold":"font-light"');

  // Consultor padrão (o CRM preenche com o usuário logado) e endereços
  s = swapRe(s, /pz=\{consultor:"[^"]*",empresa:"[^"]*",email:"[^"]*"/, 'pz={consultor:"",empresa:"Vero Planejamento",email:""');
  s = swapRe(s, /emailConsultor:"[^"]*"/, 'emailConsultor:""');
  s = swap(s, '\\n\\n💼 LinkedIn: https://www.linkedin.com/company/grupo-life-brasil', '', { optional: true });
  s = swap(s, '\n\n💼 LinkedIn: https://www.linkedin.com/company/grupo-life-brasil', '', { optional: true });
  s = swap(s, 'https://www.grupolifebrasil.com.br', `https://www.${SITE}`);
  s = swap(s, 'grupolifebrasil.com.br · planejamento@grupolifebrasil.com.br', SITE);
  s = swapRe(s, /[\w.+-]+@grupolifebrasil\.com\.br/g, '');
  s = swap(s, 'grupolifebrasil.com.br', SITE, { optional: true });

  // Textos de marca (do mais específico para o mais geral)
  const TEXT = [
    ['Grupo Life Brasil · Planejamento', 'Vero Planejamento'], ['Apresentação do Grupo Life Brasil', 'Apresentação da Vero Planejamento'],
    ['Apresentar o Grupo Life Brasil', 'Apresentar a Vero Planejamento'], ['do Grupo Life Brasil', 'da Vero Planejamento'], ['Grupo Life Brasil', 'Vero Planejamento'],
    ['Life Financial Planning — metodologia LIFE Brasil de', 'Metodologia Vero Planejamento de'], ['["LFP™",', '["Método Vero",'],
    ['Padrão LFP™ Brasil', 'Padrão Vero'], ['Planejador LFP™', 'Planejador Vero'], ['LFP™', 'Vero'],
    ['LIFE FINANCIAL OPERATING SYSTEM™', 'VERO PLANEJAMENTO FINANCEIRO'], ['slogan:"Financial Operating System™"', 'slogan:"Planejamento financeiro"'],
    ['LIFE Financial Planner™', 'planejador Vero'], ['Life Financial Planning', 'Vero Planejamento'],
    ['Por que LIFE Brasil', 'Por que a Vero'], ['A LIFE Brasil', 'A Vero Planejamento'], ['LIFE Brasil', 'Vero Planejamento'], ['Life Brasil', 'Vero Planejamento'],
    ['Life Planejamento', 'Vero Planejamento'], ['Plataforma LIFE', 'Plataforma Vero'], ['Diagnóstico LIFE', 'Diagnóstico Vero'],
    ['Estrela LIFE', 'Estrela Vero'], ['Nota LIFE', 'Nota Vero'], ['nota LIFE', 'nota Vero'], ['AJUSTE LIFE™', 'AJUSTE VERO'], ['PRINCÍPIO LIFE™', 'PRINCÍPIO VERO'],
    ['IMPLEMENTAÇÃO LIFE™', 'IMPLEMENTAÇÃO VERO'], ['DISCLAIMER LIFE™', 'DISCLAIMER VERO'], ['Implementação LIFE™', 'Implementação Vero'],
    ['Consórcio LIFE™', 'Consórcio Vero'], ['plano LIFE™', 'plano Vero'], ['Investimento e Dashplan', 'Investimento e acompanhamento'],
    ['Dashplan · ferramenta de apoio inclusa', 'Acompanhamento · ferramenta de apoio inclusa'], ['Dashplan: tela Meu Futuro', 'Acompanhamento do plano'],
    ['acesso ao Dashplan', 'acesso ao acompanhamento'], ['Dashplan', 'painel de acompanhamento'],
  ];
  for (const [a, b] of TEXT) s = swap(s, a, b, { optional: true });
  s = s.replace(/LIFE™/g, 'Vero').replace(/\bLIFE\b/g, 'Vero');
  // Chaves do navegador próprias da Vero (não misturam com a ferramenta antiga)
  s = s.replace(/life-diagnostico/g, 'vero-diagnostico').replace(/life-theme/g, 'vero-theme').replace(/backup-diagnostico-life-/g, 'backup-diagnostico-vero-');

  // Ponte com o CRM: o app passa a ser carregado depois que os dados do cliente chegam
  const open = s.indexOf('<script type="module">');
  if (open < 0) throw new Error('Script principal do diagnóstico não encontrado.');
  const close = s.indexOf('</script>', open);
  s = `${s.slice(0, open)}<script type="text/plain" id="vero-app">${exposePricing(s.slice(open + '<script type="module">'.length, close))}</script>\n<script>${BRIDGE}</script>${s.slice(close + '</script>'.length)}`;
  const left = ['Grupo Life', 'grupolifebrasil', 'dashycrm', 'Bavaresco', 'LIFE'].filter((w) => s.includes(w));
  if (left.length) console.warn(`  aviso: ainda aparece no diagnóstico: ${left.join(', ')}`);
  console.log(`  diagnóstico: ${(before / 1e6).toFixed(2)} MB → ${(s.length / 1e6).toFixed(2)} MB`);
  return s;
}

/**
 * Precificação do planejamento: a função do app que calcula o valor do plano (à vista e no cartão) fica disponível para
 * a ponte (window.__veroPrecificacao), que envia o resultado ao CRM junto com o diagnóstico. Assim, diagnóstico concluído
 * e precificado vira a proposta do planejamento em Propostas.
 */
function exposePricing(code) {
  let out = code;
  if (!out.includes('window.__veroPrecificacao')) {
    const m = out.match(/function ([\w$]+)\(e\)\{const t=e\.especificacao\?\?\{\}/);
    if (m) out = `${out}\n;window.__veroPrecificacao=${m[1]};`;
    else console.warn('  aviso: cálculo da precificação não encontrado (a proposta do planejamento não terá o valor do diagnóstico).');
  }
  // Resultado do diagnóstico para o painel do lead: Estrela Vero (8 pilares e Nota Vero), Matriz e Bússola
  if (!out.includes('window.__veroResultado')) {
    const find = (re, nome) => {
      const m = out.match(re);
      if (!m) console.warn(`  aviso: ${nome} não encontrada (não aparece no painel do lead).`);
      return m ? m[1] : 'null';
    };
    const estrela = find(/\{titulo:"Estrela Vero",ok:([\w$]+)\(e\)\.temDados/, 'Estrela Vero');
    const matriz = find(/o=([\w$]+)\(e\),i=[\w$]+\(o\),l=[\w$]+\(o\),c=[\w$]+\(e\.plano\)/, 'Matriz de oportunidades');
    const bussola = find(/,a=([\w$]+)\(e\),n=[\w$]+\(e\.plano\),o=[\w$]+=>t\("plano"/, 'Bússola financeira');
    out = `${out}\n;window.__veroResultado={estrela:${estrela},matriz:${matriz},bussola:${bussola}};`;
  }
  return out;
}

/** Reaplica a ponte e a precificação no diagnóstico já gerado (sem precisar do arquivo original). */
function refreshBridge(file) {
  let s = fs.readFileSync(file, 'utf8');
  const tag = '<script type="text/plain" id="vero-app">';
  const a = s.indexOf(tag);
  if (a < 0) throw new Error('Diagnóstico gerado não encontrado ou em formato antigo.');
  const b = s.indexOf('</script>', a);
  const code = exposePricing(s.slice(a + tag.length, b));
  const c = s.indexOf('<script>', b);
  const d = s.indexOf('</script>', c);
  s = `${s.slice(0, a + tag.length)}${code}</script>\n<script>${BRIDGE}</script>${s.slice(d + '</script>'.length)}`;
  fs.writeFileSync(file, s);
  console.log('  ponte do diagnóstico atualizada.');
}

/**
 * Ponte CRM ↔ diagnóstico (roda antes do app). Com ?crm=<id>: busca o cliente no CRM, grava no armazenamento do navegador
 * que o app lê, abre direto o cliente e, a cada alteração, devolve o diagnóstico ao CRM. Sem ?crm, a ferramenta funciona
 * sozinha (como o arquivo original).
 */
const BRIDGE = `(function () {
  'use strict';
  var LIST = 'vero-diagnostico-v2:clientes', CFG = 'vero-diagnostico:config';
  var id = new URLSearchParams(location.search).get('crm');
  function boot() {
    var code = document.getElementById('vero-app').textContent;
    var el = document.createElement('script');
    el.type = 'module';
    el.src = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    document.head.appendChild(el);
  }
  // Trava: o diagnóstico só é gerado pelo CRM (painel do lead › Diagnóstico); a ferramenta não abre avulsa
  function locked(text, demo) {
    var show = function () {
      var w = document.createElement('div');
      w.style.cssText = 'position:fixed;inset:0;z-index:2147483001;display:grid;place-items:center;background:#0D1B2A;color:#E0E1DD;font:15px/1.5 Poppins,system-ui,sans-serif;padding:24px';
      var b = document.createElement('div');
      b.style.cssText = 'max-width:460px;text-align:center;background:#1B263B;border:1px solid #415A77;border-radius:18px;padding:28px';
      var h = document.createElement('h1');
      h.textContent = 'Diagnóstico financeiro';
      h.style.cssText = 'font-size:20px;margin:0 0 10px';
      var p = document.createElement('p');
      p.textContent = text;
      p.style.margin = '0 0 18px';
      var a = document.createElement('a');
      a.href = '/#/funil';
      a.textContent = 'Ir para o CRM';
      a.style.cssText = 'display:inline-block;background:#E0E1DD;color:#0D1B2A;border-radius:999px;padding:10px 20px;font-weight:600;text-decoration:none';
      b.appendChild(h); b.appendChild(p); b.appendChild(a);
      if (demo) {
        var d = document.createElement('button');
        d.type = 'button';
        d.textContent = 'Ver em modo de demonstração (não salva no CRM)';
        d.style.cssText = 'display:block;margin:14px auto 0;background:none;border:0;color:#A9B8CB;text-decoration:underline;cursor:pointer;font:inherit;font-size:13px';
        d.onclick = function () { w.remove(); boot(); };
        b.appendChild(d);
      }
      w.appendChild(b);
      document.body.appendChild(w);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();
  }
  if (!id || !/^\\d+$/.test(id)) return locked('O diagnóstico é gerado pelo CRM: abra o lead e use a aba Diagnóstico. Assim ele fica ligado ao cliente e salvo no CRM.', false);
  var H = { 'X-Requested-With': 'crm' };
  var api = function (url, opt) {
    opt = opt || {};
    return fetch(url, { method: opt.method || 'GET', credentials: 'same-origin', headers: opt.body ? Object.assign({ 'Content-Type': 'application/json' }, H) : H, body: opt.body ? JSON.stringify(opt.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || ('Erro ' + r.status)); return j; }); });
  };
  var read = function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  var origSet = Storage.prototype.setItem;
  var write = function (k, v) { try { origSet.call(localStorage, k, JSON.stringify(v)); } catch (e) {} };
  var pill;
  function status(text, tone) {
    if (!pill) {
      pill = document.createElement('div');
      pill.setAttribute('role', 'status');
      pill.style.cssText = 'position:fixed;left:14px;bottom:14px;z-index:2147483000;display:flex;gap:10px;align-items:center;padding:8px 14px;border-radius:999px;font:500 12px/1.3 Poppins,system-ui,sans-serif;background:#0D1B2A;color:#E0E1DD;border:1px solid #415A77;box-shadow:0 10px 30px -10px rgba(0,0,0,.5)';
      document.body.appendChild(pill);
    }
    pill.innerHTML = '';
    var a = document.createElement('a');
    a.href = '/#/leads/' + (window.__veroCrm && window.__veroCrm.contact.id || '');
    a.textContent = 'Vero CRM';
    a.style.cssText = 'color:#A9B8CB;font-weight:700;text-decoration:none';
    var t = document.createElement('span');
    t.textContent = text;
    t.style.color = tone === 'erro' ? '#E38A8A' : tone === 'ok' ? '#8CC5A2' : '#E0E1DD';
    pill.appendChild(a);
    pill.appendChild(t);
  }
  api('/api/diagnosticos/' + id + '/dados').then(function (d) {
    window.__veroCrm = d;
    var cid = d.client_id, now = new Date().toISOString();
    var list = read(LIST, null);
    if (!Array.isArray(list)) list = [];
    var local = list.find(function (c) { return c && c.id === cid; });
    var c = d.data && typeof d.data === 'object' ? d.data : (local || { criadoEm: now, atualizadoEm: now, cadastro: {} });
    // O mais recente vence: o que está no navegador (ainda não enviado) ou o que está no CRM
    if (local && d.data && String(local.atualizadoEm || '') > String(d.data.atualizadoEm || '')) c = local;
    c.id = cid;
    c.cadastro = c.cadastro || {};
    Object.keys(d.prefill || {}).forEach(function (k) { if (!c.cadastro[k] && d.prefill[k]) c.cadastro[k] = d.prefill[k]; });
    list = list.filter(function (x) { return x && x.id !== cid; });
    list.unshift(c);
    write(LIST, list);
    var cfg = read(CFG, {}) || {};
    if (d.consultant) {
      if (!cfg.consultor) cfg.consultor = d.consultant.name || '';
      if (!cfg.email) cfg.email = d.consultant.email || '';
    }
    if (!cfg.empresa) cfg.empresa = 'Vero Planejamento';
    write(CFG, cfg);
    if (!location.hash || location.hash === '#/' || location.hash === '#/clientes' || location.hash.indexOf('#/clientes/' + cid) !== 0) location.hash = '#/clientes/' + cid;
    // Precificação do plano (valor, à vista e cartão), quando o consultor já passou pela tela de investimento
    function pricing(c) {
      try {
        var esp = c && c.especificacao;
        if (!esp || typeof window.__veroPrecificacao !== 'function') return null;
        var filled = ['percentual', 'valorManual', 'rendaAnual', 'condicao', 'parcelas', 'descontoPct', 'descontoValor'].some(function (k) { return esp[k] !== undefined && esp[k] !== null && esp[k] !== ''; });
        if (!filled) return null;
        var o = window.__veroPrecificacao(c);
        if (!o || !(o.valor > 0)) return null;
        return { valor: o.valor, pix_total: o.pix && o.pix.total, cartao_total: o.cartao && o.cartao.total, parcelas: o.cartao && o.cartao.parcelas, parcela: o.cartao && o.cartao.parcela, condicao: o.condicao || null, observacoes: o.observacoes || null };
      } catch (e) { return null; }
    }
    // Resultado do diagnóstico para o painel do lead: Nota Vero e Estrela Vero, Matriz de oportunidades e Bússola
    function results(c) {
      try {
        var R = window.__veroResultado;
        if (!R || !c) return null;
        var out = {};
        var est = typeof R.estrela === 'function' ? R.estrela(c) : null;
        if (est && est.temDados) out.estrela = { nota: est.maximo ? Math.round((est.total / est.maximo) * 100) : null, pilares: est.pilares.map(function (p) { return { id: p.id, nome: p.curto || p.nome, pct: p.pct, status: p.status }; }) };
        var mat = typeof R.matriz === 'function' ? R.matriz(c) : null;
        if (mat && mat.length) out.matriz = mat.slice(0, 12).map(function (o) { return { titulo: o.titulo, area: o.area, produto: o.produto, prioridade: o.prioridade, prazo: o.prazo, potencial: o.potencial, detalhe: String(o.oferta || o.detalhe || '').slice(0, 280) }; });
        var bu = typeof R.bussola === 'function' ? R.bussola(c) : null;
        if (bu && bu.temDados) out.bussola = { nota: bu.nota, norte: bu.norte ? { id: bu.norte.id, nome: bu.norte.nome, status: bu.norte.status, resumo: bu.norte.resumo, acao: bu.norte.acoes && bu.norte.acoes[0] ? bu.norte.acoes[0].texto : null } : null, dimensoes: bu.dimensoes.map(function (x) { return { id: x.id, nome: x.nome, nota: x.nota, status: x.status, resumo: x.resumo }; }) };
        return Object.keys(out).length ? out : null;
      } catch (e) { return null; }
    }
    // Só o cliente do CRM: sem lista de clientes, novo cliente, exemplo, duplicar ou excluir
    var home = '#/clientes/' + cid;
    function guard() {
      var h = location.hash || '';
      if (h === '' || h === '#/' || h === '#/clientes' || (/^#\\/clientes\\//.test(h) && h.indexOf(home) !== 0)) location.hash = home;
    }
    window.addEventListener('hashchange', guard);
    var HIDE = /^(Novo cliente|Carregar exemplo|Importar|Exportar backup)$/;
    function hideExtras() {
      var els = document.querySelectorAll('button, a');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var t = (el.textContent || '').trim();
        if (HIDE.test(t) || /^(Duplicar|Excluir)$/.test(el.getAttribute('title') || '')) el.style.display = 'none';
      }
    }
    new MutationObserver(function () { hideExtras(); }).observe(document.documentElement, { childList: true, subtree: true });
    // Salvamento automático: cada gravação do app é devolvida ao CRM (1,5 s depois da última alteração)
    var timer = null, last = '';
    function push() {
      var all = read(LIST, []);
      var mine = Array.isArray(all) ? all.find(function (x) { return x && x.id === cid; }) : null;
      if (!mine) return;
      var json = JSON.stringify(mine);
      if (json === last) return;
      status('Salvando no CRM…');
      api('/api/diagnosticos/' + id + '/dados', { method: 'PUT', body: { data: mine, precificacao: pricing(mine), resultado: results(mine) } })
        .then(function (r) { last = json; status(r.status === 'concluido' ? 'Diagnóstico concluído · salvo no CRM (gere a proposta pela aba Diagnóstico do lead)' : 'Salvo no CRM', 'ok'); })
        .catch(function (e) { status('Não foi possível salvar no CRM: ' + e.message, 'erro'); });
    }
    Storage.prototype.setItem = function (k, v) {
      origSet.call(this, k, v);
      if (this === localStorage && k === LIST) { clearTimeout(timer); timer = setTimeout(push, 1500); }
    };
    window.addEventListener('beforeunload', function () { if (timer) { clearTimeout(timer); push(); } });
    boot();
    document.addEventListener('DOMContentLoaded', function () { status('Cliente ' + (d.contact && d.contact.name || '') + ' · ligado ao CRM', 'ok'); });
    if (document.readyState !== 'loading') status('Cliente ' + (d.contact && d.contact.name || '') + ' · ligado ao CRM', 'ok');
  }).catch(function (e) {
    // Sem acesso ao diagnóstico (sessão expirada ou fora do escopo): não abre; sem o servidor (versão de teste), modo de demonstração
    var offline = /Erro (0|404|405)|Failed to fetch|NetworkError|JSON/i.test(e.message || '');
    locked(offline ? 'Não foi possível falar com o CRM agora. O diagnóstico só é salvo quando aberto pelo lead, com o CRM no ar.' : 'Entre no CRM e abra o diagnóstico pelo lead (aba Diagnóstico). ' + (e.message || ''), offline);
  });
})();`;

/* ------------------------- Simulador de consórcio ------------------------- */

/** Trocas aplicadas ao conteúdo do simulador depois da senha (CSS, HTML e scripts decifrados). */
const SIM_RUNTIME = `function veroMarca(c) {
    var CORES = { 'f05a00': '778DA9', 'cc4800': '415A77', 'ff7a2e': 'A9B8CB', 'b03d00': '1B263B', 'e65100': '415A77', 'ff6a00': '778DA9' };
    var cor = function (t) {
      return String(t)
        .replace(/#([0-9a-fA-F]{6})\\b/g, function (m, h) { var x = CORES[h.toLowerCase()]; return x ? '#' + x : m; })
        .replace(/rgba?\\(\\s*240\\s*,\\s*90\\s*,\\s*0/g, function (m) { return m.replace(/240\\s*,\\s*90\\s*,\\s*0/, '119,141,169'); })
        .replace(/rgba?\\(\\s*204\\s*,\\s*72\\s*,\\s*0/g, function (m) { return m.replace(/204\\s*,\\s*72\\s*,\\s*0/, '65,90,119'); });
    };
    var texto = function (t) {
      return String(t)
        .split(LOGO_ANTIGO_ESCURO).join(LOGO_ESCURO).split(LOGO_ANTIGO_CLARO).join(LOGO_CLARO)
        .replace(/Grupo Life Brasil/g, 'Vero Consórcios').replace(/GRUPO LIFE BRASIL/g, 'VERO CONSÓRCIOS').replace(/Life Brasil/g, 'Vero Consórcios')
        .replace(/GLB - Simulador/g, 'Vero Consórcios · Simulador').replace(/"Klavika",\\s*"Titillium Web"/g, 'Poppins,"Titillium Web"').replace(/'Klavika',\\s*'Titillium Web'/g, "Poppins,'Titillium Web'");
    };
    c.css = cor(texto(c.css)) + VERO_CSS;
    c.corpo = cor(texto(c.corpo));
    c.scripts = (c.scripts || []).map(function (s) { return cor(texto(s)); });
    return c;
  }
  function veroTextos(raiz) {
    var w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT), n;
    while ((n = w.nextNode())) if (/Life Brasil|\\bGLB\\b/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/Grupo Life Brasil|Life Brasil/g, 'Vero Consórcios').replace(/\\bGLB\\b/g, 'Vero');
    document.title = 'Vero Consórcios · Simulador de Consórcio';
  }`;

const SIM_OVERRIDE_CSS = `
:root{--laranja:#778DA9;--botao:#415A77;--destaque:#A9B8CB}
@media (prefers-color-scheme: light){:root{--laranja:#415A77;--botao:#1B263B;--destaque:#1B263B}}
html,body{font-family:Poppins,"Titillium Web","Segoe UI",Roboto,Arial,sans-serif}`;

function buildSimulator(src) {
  let s = fs.readFileSync(src, 'utf8');
  const before = s.length;
  // Logos antigos da tela de acesso (os mesmos podem aparecer no conteúdo cifrado)
  const imgs = [...s.matchAll(/<img class="acesso-logo (escuro|claro)" src="(data:image\/png;base64,[A-Za-z0-9+/=]+)"/g)];
  const oldDark = imgs.find((m) => m[1] === 'escuro')?.[2] || '';
  const oldLight = imgs.find((m) => m[1] === 'claro')?.[2] || '';
  const newDark = dataUri(path.join(IMG, 'vero-logo-dark.webp'), 'image/webp');
  const newLight = dataUri(path.join(IMG, 'vero-logo-light.webp'), 'image/webp');
  s = swapRe(s, /<title>[^<]*<\/title>/, '<title>Vero Consórcios · Simulador de Consórcio</title>');
  s = swapRe(s, /<link rel="icon"[^>]*>/, `<link rel="icon" type="image/png" href="${dataUri(path.join(IMG, 'favicon.png'), 'image/png')}">`);
  s = swap(s, 'family=Titillium+Web:ital,wght@0,300;0,400;0,600;0,700;1,300', 'family=Poppins:wght@300;400;500;600;700&family=Titillium+Web:ital,wght@0,300;0,400;0,600;0,700;1,300');
  // Tela de acesso na paleta Vero
  s = swap(s, ':root{--fundo:#000;--cartao:#111;--texto:#F7F5F2;--suave:#A39E99;--borda:rgba(255,255,255,.14);--laranja:#F05A00;--botao:#CC4800;--destaque:#FF7A2E;--erro:#FF6B6B;color-scheme:dark}',
    ':root{--fundo:#08121D;--cartao:#0D1B2A;--texto:#E0E1DD;--suave:#A9B8CB;--borda:rgba(169,184,203,.18);--laranja:#778DA9;--botao:#415A77;--destaque:#A9B8CB;--erro:#E38A8A;color-scheme:dark}');
  s = swap(s, '@media (prefers-color-scheme: light){:root{--fundo:#ECE9E5;--cartao:#FFF;--texto:#201E1E;--suave:#67615C;--borda:rgba(32,30,30,.14);--destaque:#B03D00;--erro:#B83232;color-scheme:light}}',
    '@media (prefers-color-scheme: light){:root{--fundo:#E0E1DD;--cartao:#FFF;--texto:#0D1B2A;--suave:#415A77;--borda:rgba(13,27,42,.14);--botao:#1B263B;--destaque:#1B263B;--erro:#B83232;color-scheme:light}}');
  s = swap(s, 'font-family:"Klavika","Titillium Web"', 'font-family:Poppins,"Titillium Web"');
  s = swap(s, 'rgba(240,90,0,.14)', 'rgba(119,141,169,.18)');
  s = swap(s, 'rgba(240,90,0,.3)', 'rgba(119,141,169,.35)');
  s = swap(s, '.acesso-logo{width:190px;', '.acesso-logo{width:220px;');
  s = swapRe(s, /<img class="acesso-logo escuro" src="[^"]+" alt="[^"]*">/, `<img class="acesso-logo escuro" src="${newDark}" alt="Vero Consórcios">`);
  s = swapRe(s, /<img class="acesso-logo claro" src="[^"]+" alt="[^"]*">/, `<img class="acesso-logo claro" src="${newLight}" alt="Vero Consórcios">`);
  s = swap(s, 'Uso exclusivo da equipe Grupo Life Brasil.', 'Uso exclusivo da equipe Vero Consórcios.');
  // Conteúdo decifrado: mesmas trocas antes de exibir
  s = swap(s, '  function iniciar(c) {\n', `  var LOGO_ANTIGO_ESCURO = ${JSON.stringify(oldDark)}, LOGO_ANTIGO_CLARO = ${JSON.stringify(oldLight)};
  var LOGO_ESCURO = ${JSON.stringify(newDark)}, LOGO_CLARO = ${JSON.stringify(newLight)};
  var VERO_CSS = ${JSON.stringify(SIM_OVERRIDE_CSS)};
  ${SIM_RUNTIME}
  function iniciar(c) {
    c = veroMarca(c);
`);
  s = swap(s, '      el.remove();\n    });\n  }', '      el.remove();\n    });\n    veroTextos(document.body);\n  }');
  if (!s.includes('veroTextos(document.body)')) throw new Error('Carregador do simulador diferente do esperado.');
  console.log(`  simulador: ${(before / 1e6).toFixed(2)} MB → ${(s.length / 1e6).toFixed(2)} MB`);
  return s;
}

/* ------------------------- execução ------------------------- */

const diag = arg('diag');
const sim = arg('sim');
if (process.argv.includes('--atualizar-ponte')) {
  refreshBridge(path.join(OUT, 'diagnostico-financeiro.html'));
  process.exit(0);
}
if (!diag && !sim) {
  console.log('Uso: node scripts/build-tools.js --diag <Diagnostico.html> --sim <Simulador.html>');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
if (diag) fs.writeFileSync(path.join(OUT, 'diagnostico-financeiro.html'), buildDiagnostic(diag));
if (sim) fs.writeFileSync(path.join(OUT, 'simulador-consorcio.html'), buildSimulator(sim));
console.log('Ferramentas geradas em public/ferramentas/.');
