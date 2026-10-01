'use strict';
/**
 * Monta a versão de teste que roda inteira no navegador (sem servidor):
 *   npm install && npm run build:preview   → gera dist/preview/
 *
 * Empacota os módulos do servidor (router, serviços, banco) em um único script,
 * com adaptadores para Buffer, node:crypto e node:sqlite (sql.js). A interface é a mesma de public/.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'preview');
const SQLJS = path.join(ROOT, 'node_modules', 'sql.js', 'dist', 'sql-asm-memory-growth.js');

if (!fs.existsSync(SQLJS)) {
  console.error('sql.js não encontrado. Rode "npm install" antes de "npm run build:preview".');
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'js', 'views'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'vendor'), { recursive: true });

/* ---------- empacota o servidor ---------- */
const serverFiles = [
  ...fs.readdirSync(path.join(ROOT, 'server')).filter((f) => f.endsWith('.js') && !['app.js', 'index.js'].includes(f)).map((f) => `server/${f}`),
  ...fs.readdirSync(path.join(ROOT, 'server', 'services')).filter((f) => f.endsWith('.js')).map((f) => `server/services/${f}`),
];
let bundle = `${fs.readFileSync(path.join(ROOT, 'preview', 'shims.js'), 'utf8')}\n`;
bundle += `(function () {
  'use strict';
  const defs = {};
  const cache = {};
  const { Buffer, builtins } = window.CRMShims;
  function resolve(from, spec) {
    const parts = from.split('/').slice(0, -1);
    for (const seg of spec.split('/')) {
      if (seg === '.' || seg === '') continue;
      if (seg === '..') parts.pop();
      else parts.push(seg);
    }
    let p = parts.join('/');
    if (!p.endsWith('.js')) p += '.js';
    return p;
  }
  function load(id) {
    if (cache[id]) return cache[id].exports;
    if (!defs[id]) throw new Error('Módulo não encontrado: ' + id);
    const module = { exports: {} };
    cache[id] = module;
    defs[id](module, module.exports, (spec) => (builtins[spec] ? builtins[spec] : load(resolve(id, spec))), Buffer, window.process);
    return module.exports;
  }
`;
for (const f of serverFiles) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  bundle += `  defs[${JSON.stringify(f)}] = function (module, exports, require, Buffer, process) {\n${src}\n};\n`;
}
bundle += `  window.CRMBackend = { require: load };\n})();\n`;
fs.writeFileSync(path.join(OUT, 'js', 'backend.js'), bundle);
fs.copyFileSync(path.join(ROOT, 'preview', 'boot.js'), path.join(OUT, 'js', 'preview-boot.js'));
fs.copyFileSync(SQLJS, path.join(OUT, 'vendor', 'sql-asm.js'));

/* ---------- interface ---------- */
for (const dir of ['js', 'js/views']) {
  for (const f of fs.readdirSync(path.join(ROOT, 'public', dir))) {
    if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'public', dir, f), path.join(OUT, dir, f));
  }
}
// Identidade visual: tokens + estilos da aplicação + componentes da marca, na mesma ordem do index.html
const css = ['tokens.css', 'app.css', 'brand.css'].map((f) => fs.readFileSync(path.join(ROOT, 'public', 'css', f), 'utf8')).join('\n');
const previewCss = fs.readFileSync(path.join(ROOT, 'preview', 'preview.css'), 'utf8');
const page = `<title>CRM Consórcios</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=Manrope:wght@500;600;700&display=swap">
<script src="js/theme.js"></script>
<style>
${css}
${previewCss}
</style>
<div id="app"><div class="auth"><div class="card">Carregando o CRM…</div></div></div>
<script src="vendor/sql-asm.js"></script>
<script src="js/backend.js"></script>
<script src="js/preview-boot.js"></script>
<script type="module" src="js/app.js"></script>
`;
fs.writeFileSync(path.join(OUT, 'index.html'), page);

const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f !== 'index.html') files.push(path.relative(OUT, p));
  }
})(OUT);
fs.writeFileSync(path.join(OUT, 'files.json'), JSON.stringify(files, null, 2));
console.log(`Versão de teste gerada em ${path.relative(ROOT, OUT)} (${files.length + 1} arquivos).`);
