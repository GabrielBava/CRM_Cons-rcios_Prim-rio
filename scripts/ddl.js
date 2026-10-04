'use strict';
/**
 * Gera o DDL completo do banco (docs/DDL.sql) e o mapa de relacionamentos (docs/MODELO_DE_DADOS.md)
 * a partir de um banco novo em memória — inclui as colunas acrescentadas pelas migrações.
 *
 *   node scripts/ddl.js
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { initDb } = require('../server/db');

const db = initDb(new DatabaseSync(':memory:'));

const DOMAINS = [
  ['Acesso, configuração e auditoria', ['users', 'teams', 'sessions', 'settings', 'options', 'counters', 'custom_fields', 'notifications', 'audit_log']],
  ['Cadastros (prospects, leads e clientes)', ['contacts', 'addresses', 'company_contacts', 'partners', 'contact_origins', 'consents', 'data_requests', 'client_links', 'attachments', 'attachment_opportunities', 'imports']],
  ['Funil, atividades e distribuição', ['pipeline_stages', 'opportunities', 'stage_history', 'r1_transcripts', 'activities', 'tasks', 'distribution_log', 'goals']],
  ['Catálogo: administradoras e planos', ['administrators', 'products']],
  ['Simulações e propostas', ['simulations', 'simulation_versions', 'simulation_links', 'proposals']],
  ['Pré-venda, vendas, cancelamentos e comissões', ['pre_sales', 'pre_sale_quotas', 'sales', 'cancellations', 'commission_entries']],
  ['Produtos contratados e pós-venda', ['contracts', 'finance_entries', 'finance_issues', 'post_sale_items', 'nps_surveys', 'bid_strategies', 'bid_strategy_history']],
  ['Treinamentos', ['trainings', 'training_progress']],
  ['Integrações', ['integrations', 'integration_logs', 'inbound_events', 'call_events']],
  ['Financeiro da empresa', ['fin_accounts', 'fin_cost_centers', 'fin_categories', 'fin_partners', 'fin_payment_methods', 'fin_titles', 'fin_installments', 'fin_allocations', 'fin_notes', 'fin_files']],
];

// Relacionamentos usados pela aplicação, mas sem FOREIGN KEY declarada (colunas acrescentadas depois ou polimórficas)
const LOGICAL = [
  ['activities', 'call_event_id', 'call_events', 'id', ''],
  ['activities', 'ref_id', '(ref_type)', 'id', 'polimórfico: ref_type indica a tabela (proposal, contract, finance_entry, sale…)'],
  ['administrators', 'portal_password_updated_by', 'users', 'id', ''],
  ['attachments', 'finance_entry_id', 'finance_entries', 'id', ''],
  ['audit_log', 'entity_id', '(entity)', 'id', 'polimórfico: entity indica a tabela'],
  ['audit_log', 'contact_id', 'contacts', 'id', 'cadastro afetado (para o histórico da ficha)'],
  ['client_links', 'revoked_by', 'users', 'id', ''],
  ['contracts', 'sale_id', 'sales', 'id', 'venda que originou o produto contratado'],
  ['fin_installments', 'file_id', 'fin_files', 'id', 'comprovante da baixa'],
  ['pipeline_stages', 'training_id', 'trainings', 'id', ''],
  ['pre_sales', 'sale_id', 'sales', 'id', ''],
  ['pre_sales', 'payment_attachment_id', 'attachments', 'id', 'comprovante de pagamento'],
  ['pre_sales', 'proof_by', 'users', 'id', ''],
  ['sales', 'allocation_checked_by', 'users', 'id', ''],
  ['sales', 'formalization_by', 'users', 'id', ''],
  ['tasks', 'pre_sale_id', 'pre_sales', 'id', ''],
  ['tasks', 'sale_id', 'sales', 'id', ''],
];

const all = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
const byName = new Map(all.map((t) => [t.name, t]));
const listed = new Set(DOMAINS.flatMap(([, ts]) => ts));
const rest = all.map((t) => t.name).filter((n) => !listed.has(n));
if (rest.length) DOMAINS.push(['Outras', rest]);
const indexes = db.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY tbl_name, name").all();
const fks = (t) => {
  const order = new Map(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => [c.name, c.cid]));
  return db.prepare(`PRAGMA foreign_key_list(${t})`).all().sort((a, b) => order.get(a.from) - order.get(b.from));
};
const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all();
const pretty = (sql) => sql.replace(/^CREATE TABLE "?(\w+)"?/, 'CREATE TABLE IF NOT EXISTS $1').replace(/,\s*(?=[a-z_]+ [A-Z])/g, ',\n  ').replace(/\(\s*\n?\s*(?=id INTEGER)/, '(\n  ').replace(/\s*\n\s*,\s*\n?\s*/g, ',\n  ').replace(/\s*\)$/, '\n)');

/* ------------------------- DDL.sql ------------------------- */
let sql = `-- =====================================================================
-- Vero Consórcios (ERP/CRM) — DDL completo do banco (SQLite)
-- Gerado por scripts/ddl.js a partir de um banco novo, com todas as migrações aplicadas.
-- ${all.length} tabelas · ${all.reduce((n, t) => n + fks(t.name).length, 0)} chaves estrangeiras declaradas · ${indexes.length} índices
--
-- Observações
--  - O SQLite verifica as chaves estrangeiras na gravação (PRAGMA foreign_keys = ON), não na criação:
--    as tabelas podem ser criadas em qualquer ordem. Aqui estão agrupadas por módulo.
--  - Datas e horas: texto ISO 8601 (AAAA-MM-DD ou AAAA-MM-DDTHH:MM:SS.sssZ). Valores: REAL em reais.
--  - Listas configuráveis (origem, etapa, categoria…) guardam o código; o rótulo fica em options(list, value).
--  - Relacionamentos sem FOREIGN KEY declarada estão listados no fim deste arquivo.
-- =====================================================================

PRAGMA foreign_keys = ON;
`;
for (const [title, names] of DOMAINS) {
  sql += `\n-- ---------------------------------------------------------------------\n-- ${title}\n-- ---------------------------------------------------------------------\n`;
  for (const n of names) {
    const t = byName.get(n);
    if (!t) continue;
    sql += `\n${pretty(t.sql)};\n`;
    for (const i of indexes.filter((x) => x.tbl_name === n)) sql += `${i.sql.replace(/^CREATE (UNIQUE )?INDEX /, 'CREATE $1INDEX IF NOT EXISTS ')};\n`;
  }
}
sql += '\n-- ---------------------------------------------------------------------\n-- Relacionamentos lógicos (usados pela aplicação, sem FOREIGN KEY declarada)\n-- ---------------------------------------------------------------------\n';
for (const [t, c, rt, rc, note] of LOGICAL) sql += `-- ${t}.${c} -> ${rt}.${rc}${note ? `   (${note})` : ''}\n`;
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'DDL.sql'), sql);

/* ------------------------- MODELO_DE_DADOS.md ------------------------- */
const action = (f) => [f.on_delete !== 'NO ACTION' ? `ON DELETE ${f.on_delete}` : '', f.on_update !== 'NO ACTION' ? `ON UPDATE ${f.on_update}` : ''].filter(Boolean).join(' ');
let md = `# Modelo de dados

Gerado por \`scripts/ddl.js\` (rode \`node scripts/ddl.js\` depois de mudar o esquema). O DDL completo está em [\`DDL.sql\`](DDL.sql).

**${all.length} tabelas**, **${all.reduce((n, t) => n + fks(t.name).length, 0)} chaves estrangeiras** declaradas e **${LOGICAL.length} relacionamentos lógicos** (sem FOREIGN KEY no banco, garantidos pela aplicação).

## Visão geral do fluxo comercial

\`\`\`mermaid
erDiagram
  users ||--o{ contacts : "responsável"
  teams ||--o{ users : "equipe"
  contacts ||--o{ opportunities : "negócios"
  pipeline_stages ||--o{ opportunities : "etapa"
  opportunities ||--o{ stage_history : "histórico"
  opportunities ||--o{ r1_transcripts : "transcrições R1"
  contacts ||--o{ activities : "atividades"
  contacts ||--o{ tasks : "tarefas"
  opportunities ||--o{ simulations : "simulações"
  opportunities ||--o{ proposals : "propostas"
  products ||--o{ proposals : "plano"
  administrators ||--o{ products : "planos"
  proposals ||--o| pre_sales : "aceite"
  pre_sales ||--o{ pre_sale_quotas : "cotas"
  pre_sales ||--o| sales : "comprovante"
  sales ||--o{ contracts : "cotas alocadas"
  sales ||--o{ commission_entries : "comissões"
  sales ||--o| cancellations : "cancelamento"
  contacts ||--o{ contracts : "produtos contratados"
  contracts ||--o{ finance_entries : "parcelas do cliente"
  contracts ||--o| bid_strategies : "estratégia de lance"
  contacts ||--o{ post_sale_items : "pós-venda"
  contacts ||--o{ nps_surveys : "NPS"
\`\`\`

## Visão geral do financeiro da empresa

\`\`\`mermaid
erDiagram
  fin_titles ||--o{ fin_installments : "ocorrências"
  fin_titles ||--o{ fin_allocations : "rateio por competência"
  fin_titles ||--o{ fin_notes : "observações"
  fin_titles ||--o{ fin_files : "arquivos"
  fin_partners ||--o{ fin_titles : "fornecedor / pagador"
  fin_categories ||--o{ fin_titles : "categoria"
  fin_cost_centers ||--o{ fin_titles : "centro de custo"
  fin_accounts ||--o{ fin_installments : "conta da baixa"
  fin_payment_methods ||--o{ fin_installments : "forma de pagamento"
  administrators ||--o{ fin_partners : "administradora"
  users ||--o{ fin_titles : "responsável"
\`\`\`

## Chaves estrangeiras por tabela
`;
for (const [title, names] of DOMAINS) {
  md += `\n### ${title}\n\n| Tabela | Coluna | Referência | Regra |\n|---|---|---|---|\n`;
  for (const n of names) {
    if (!byName.has(n)) continue;
    const f = fks(n);
    if (!f.length) md += `| \`${n}\` | — | — | sem chave estrangeira |\n`;
    for (const x of f) md += `| \`${n}\` | \`${x.from}\` | \`${x.table}(${x.to || 'id'})\` | ${action(x) || '—'} |\n`;
  }
}
md += `\n## Relacionamentos lógicos (sem FOREIGN KEY declarada)\n\nColunas acrescentadas por migração (o SQLite não permite incluir chave estrangeira em coluna existente) ou polimórficas. A aplicação valida esses vínculos.\n\n| Tabela | Coluna | Referência | Observação |\n|---|---|---|---|\n`;
for (const [t, c, rt, rc, note] of LOGICAL) md += `| \`${t}\` | \`${c}\` | \`${rt}(${rc})\` | ${note || '—'} |\n`;
md += `\n## Colunas por tabela\n`;
for (const [title, names] of DOMAINS) {
  md += `\n### ${title}\n`;
  for (const n of names) {
    if (!byName.has(n)) continue;
    const f = fks(n);
    md += `\n**\`${n}\`** — ${cols(n).map((c) => `\`${c.name}\`${c.pk ? ' (PK)' : ''}${f.find((x) => x.from === c.name) ? ' (FK)' : ''}`).join(', ')}\n`;
  }
}
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'MODELO_DE_DADOS.md'), md);
console.log(`docs/DDL.sql e docs/MODELO_DE_DADOS.md gerados: ${all.length} tabelas, ${indexes.length} índices.`);
