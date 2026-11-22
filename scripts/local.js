'use strict';
/**
 * Ambiente local completo: CRM + simulador + landing page no mesmo servidor.
 *
 *   npm run local            (ou os atalhos iniciar-windows.bat / iniciar-mac-linux.sh)
 *
 * Na primeira execução cria o banco data/local.db com os dados fictícios de demonstração
 * (usuários admin@demo.local, gestora@demo.local, consultor1@demo.local… — senha demo12345, ou DEMO_PASSWORD).
 * Para começar com o banco vazio (criando o seu administrador), use LOCAL_VAZIO=1.
 */
const path = require('node:path');
const fs = require('node:fs');

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Node.js ${process.versions.node} encontrado. Instale o Node.js 22.13 ou superior (https://nodejs.org) e rode de novo.`);
  process.exit(1);
}

const root = path.join(__dirname, '..');
const fromConfig = require('../server/env').loadConfigEnv();
if (fromConfig.length) console.log(`Configuração lida de config.env: ${fromConfig.join(', ')}`);
process.env.CRM_DB = process.env.CRM_DB || path.join(root, 'data', 'local.db');
process.env.PORT = process.env.PORT || '3000';
const password = process.env.DEMO_PASSWORD || 'demo12345';
const fresh = !fs.existsSync(process.env.CRM_DB);

if (fresh && process.env.LOCAL_VAZIO !== '1') {
  const { openDb } = require('../server/db');
  const { seedDemo } = require('../server/demo');
  const db = openDb(process.env.CRM_DB);
  seedDemo(db, password);
  db.close();
  console.log(`Banco de demonstração criado em ${path.relative(root, process.env.CRM_DB)} (senha dos usuários: ${password}).`);
}

require('../server/index.js');
const url = `http://localhost:${process.env.PORT}`;
setTimeout(() => {
  console.log(`
  CRM ................ ${url}/            (admin@demo.local · ${password})
  Landing page ....... ${url}/lp/
  Simulador .......... ${url}/simulador/
  Roteiro de testes .. TESTE-LOCAL.md

  Para parar: Ctrl+C. Os dados ficam em ${path.relative(root, process.env.CRM_DB)} (apague o arquivo para recomeçar).
`);
}, 300);
