'use strict';
/**
 * Popula um banco com DADOS FICTÍCIOS de demonstração. Use apenas em ambiente de teste.
 *
 *   CRM_DB=data/demo.db npm run demo
 *
 * Recusa-se a rodar em um banco que já tenha cadastros.
 */
const path = require('node:path');
const { openDb } = require('../server/db');
const { randomToken } = require('../server/util');
const { seedDemo, DEMO_USERS } = require('../server/demo');

const file = process.env.CRM_DB || path.join(__dirname, '..', 'data', 'crm.db');
const db = openDb(file);
const password = process.env.DEMO_PASSWORD || `demo-${randomToken(6)}`;
try {
  seedDemo(db, password);
} catch (e) {
  console.error(e.message, '(ex.: CRM_DB=data/demo.db)');
  process.exit(1);
}
console.log('Dados fictícios de demonstração criados em', file);
console.log('Usuários (senha para todos):', password);
for (const u of DEMO_USERS) console.log(' -', u);
