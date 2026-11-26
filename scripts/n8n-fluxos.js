#!/usr/bin/env node
'use strict';
/**
 * Gera os fluxos do n8n do agente de IA do WhatsApp (deploy/n8n/*.json), a partir das ferramentas do próprio agente do
 * CRM (server/services/waagent.js), para os dois ficarem sempre iguais. Rode depois de mudar as ferramentas:
 *   npm run n8n:fluxos
 *
 * - fluxo-atendimento-whatsapp.json: o conector avisa o n8n de cada mensagem; o n8n pergunta ao CRM se a IA atende,
 *   roda a IA (Gemini) com a base de conhecimento e as ações do CRM e devolve a resposta para o CRM enviar.
 * - fluxo-base-conhecimento-crm.json: todo dia, copia a base de conhecimento do CRM para a base do n8n (pgvector).
 * - fluxo-base-conhecimento-drive.json: arquivos de uma pasta do Google Drive (materiais, transcrições) entram na base.
 *
 * O endereço do CRM fica no nó "Configuração" (o instalador da VPS troca sozinho). As credenciais têm IDs fixos para o
 * instalador criá-las junto: CRM Vero (token do n8n), Google Gemini e o Postgres da VPS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT = path.join(__dirname, '..', 'deploy', 'n8n');
const CRM_PLACEHOLDER = 'https://SEU-CRM.com.br';
const TABLE = 'vero_conhecimento';
const CRED = {
  crm: { id: 'VeroCrmToken0001', name: 'CRM Vero (token do n8n)', type: 'httpHeaderAuth' },
  gemini: { id: 'VeroGemini000001', name: 'Google Gemini (Vero)', type: 'googlePalmApi' },
  pg: { id: 'VeroPostgres0001', name: 'Postgres da VPS (base de conhecimento)', type: 'postgres' },
  drive: { id: 'VeroGDrive000001', name: 'Google Drive (Vero)', type: 'googleDriveOAuth2Api' },
};
const cred = (k) => ({ [CRED[k].type]: { id: CRED[k].id, name: CRED[k].name } });

// Banco temporário só para ler as ferramentas e as listas de opções padrão do CRM
const tmp = path.join(os.tmpdir(), `vero-n8n-${process.pid}.db`);
process.env.CRM_CONFIG = process.env.CRM_CONFIG || '/nao/existe.env';
const { openDb, initDb } = require('../server/db');
const db = openDb(tmp);
initDb(db);
const tools = require('../server/services/waagent').tools(db);
db.close?.();
for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) fs.rmSync(f, { force: true });

/* ------------------------- utilidades ------------------------- */

let seq = 0;
const uid = (tag) => {
  // IDs estáveis (o arquivo só muda quando o fluxo muda)
  const h = require('crypto').createHash('sha1').update(`${tag}:${++seq}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
// Descrição com ponto final antes da lista de valores
const dot = (t) => (/[.!?)]$/.test(String(t).trim()) && !/\)$/.test(String(t).trim()) ? String(t).trim() : `${String(t).trim()}.`);
const q = (s) => `'${String(s).replace(/[\\'`]/g, '').replace(/\s+/g, ' ').trim()}'`;
const conv = (f) => `$('CRM - Conversa').item.json.${f}`;
const flow = (name, nodes, connections, extra = {}) => ({
  name, nodes, connections, active: false, pinData: {},
  settings: { executionOrder: 'v1', saveDataSuccessExecution: 'all', saveManualExecutions: true, callerPolicy: 'workflowsFromSameOwner', timezone: 'America/Sao_Paulo', ...extra.settings },
  ...(extra.id ? { id: extra.id } : {}),
  meta: { templateCredsSetupCompleted: false, vero: 'Gerado por scripts/n8n-fluxos.js (CRM Vero Consórcios)' },
  tags: [],
});
const note = (name, content, position, size = [420, 260], color = 6) => ({
  parameters: { content, height: size[1], width: size[0], color }, id: uid(name), name, type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position,
});
const setNode = (name, position, assignments, includeOther = true) => ({
  parameters: {
    assignments: { assignments: assignments.map(([n, v, type = 'string']) => ({ id: uid(n), name: n, value: v, type })) },
    includeOtherFields: includeOther, options: {},
  },
  id: uid(name), name, type: 'n8n-nodes-base.set', typeVersion: 3.4, position,
});
const ifNode = (name, position, left, operator, right) => ({
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: uid(name), leftValue: left, rightValue: right ?? '', operator }],
      combinator: 'and',
    },
    looseTypeValidation: true, options: {},
  },
  id: uid(name), name, type: 'n8n-nodes-base.if', typeVersion: 2.2, position,
});
const http = (name, position, url, jsonBody, extra = {}) => ({
  parameters: {
    method: extra.method || 'POST', url,
    authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
    ...(jsonBody ? { sendBody: true, specifyBody: 'json', jsonBody } : {}),
    options: { timeout: extra.timeout || 30000 },
  },
  id: uid(name), name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position,
  credentials: cred('crm'),
  ...(extra.retry ? { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000 } : {}),
  ...(extra.node || {}),
});
const geminiEmbeddings = (name, position) => ({
  parameters: { modelName: 'models/gemini-embedding-001' }, id: uid(name), name, type: '@n8n/n8n-nodes-langchain.embeddingsGoogleGemini', typeVersion: 1, position, credentials: cred('gemini'),
});

/* ------------------------- ferramentas do agente (iguais às do CRM) ------------------------- */

function toolNode(t, position) {
  const props = t.input_schema?.properties || {};
  const required = t.input_schema?.required || [];
  const fields = Object.entries(props).map(([k, p]) => {
    const desc = `${dot(p.description || k)}${p.enum ? ` Valores aceitos: ${p.enum.join(', ')}.` : ''}${required.includes(k) ? '' : ' Deixe vazio se o cliente ainda não respondeu.'}`;
    const type = p.type === 'number' ? 'number' : 'string';
    const def = required.includes(k) ? '' : type === 'number' ? ', 0' : ", ''";
    return `${k}: $fromAI(${q(k)}, ${q(desc)}, ${q(type)}${def})`;
  });
  const body = `={{ JSON.stringify({ conversa_id: ${conv('conversa_id')}, turno: ${conv('turno')}${fields.length ? `, dados: { ${fields.join(', ')} }` : ''} }) }}`;
  return {
    parameters: {
      toolDescription: t.description,
      method: 'POST',
      url: `={{ ${conv('urls.acao')} }}/${t.name}`,
      authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendBody: true, specifyBody: 'json', jsonBody: body,
      options: { timeout: 40000 },
    },
    id: uid(t.name), name: t.name, type: 'n8n-nodes-base.httpRequestTool', typeVersion: 4.2, position, credentials: cred('crm'),
  };
}

/* ------------------------- 1) Atendimento no WhatsApp ------------------------- */

function atendimento() {
  seq = 0;
  const nodes = [
    note('Leia-me', `## Atendimento de leads no WhatsApp (CRM Vero)
1. O conector do WhatsApp (Evolution) avisa este fluxo de cada mensagem (webhook global, rede interna da VPS).
2. **CRM - Conversa** registra a mensagem no CRM e diz se a IA atende: agente ligado, número central, modo de teste, Assumir/Devolver.
3. **IA Vero** responde com o Gemini, a **base_de_conhecimento** e as ações do CRM (triagem, qualificação, R1, transferência).
4. **Responder no WhatsApp** manda o texto para o CRM enviar (fica registrado como mensagem da IA).

Endereço do CRM: nó **Configuração**. Token: credencial **${CRED.crm.name}** (Integrações › Agente de IA no WhatsApp › n8n).`, [-420, -380], [560, 300], 4),
    {
      parameters: { httpMethod: 'POST', path: 'vero-whatsapp', responseMode: 'onReceived', options: {} },
      id: uid('webhook'), name: 'WhatsApp (conector)', type: 'n8n-nodes-base.webhook', typeVersion: 2.1, position: [-400, 0], webhookId: 'b8f1e7a2-5c34-4d0e-9a61-7e2f0c9d4a11',
    },
    setNode('Configuração', [-180, 0], [['crm_url', CRM_PLACEHOLDER]]),
    ifNode('É mensagem?', [40, 0], '={{ $json.body.event }}', { type: 'string', operation: 'equals' }, 'messages.upsert'),
    http('CRM - Conversa', [260, -20], '={{ $json.crm_url.replace(/\\/+$/, "") }}/api/integracoes/n8n/mensagem',
      '={{ JSON.stringify({ event: $json.body.event, instance: $json.body.instance, data: $json.body.data }) }}', { timeout: 60000, retry: true }),
    ifNode('IA atende?', [480, -20], '={{ $json.atender }}', { type: 'boolean', operation: 'true', singleValue: true }),
    {
      parameters: {
        promptType: 'define', text: '={{ $json.mensagem }}',
        options: { systemMessage: '={{ $json.sistema }}', maxIterations: 10 },
      },
      id: uid('agent'), name: 'IA Vero', type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 3.1, position: [760, -40], onError: 'continueErrorOutput',
    },
    {
      parameters: { modelName: `={{ ${conv('modelo_gemini')} || 'models/gemini-2.5-flash' }}`, options: { temperature: 0.4 } },
      id: uid('gemini'), name: 'Gemini', type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', typeVersion: 1.2, position: [480, 320], credentials: cred('gemini'),
    },
    {
      parameters: {
        mode: 'retrieve-as-tool',
        toolDescription: 'Busca na base de conhecimento da Vero (materiais sobre consórcio, planejamento, objeções, perguntas frequentes e trechos de conversas da equipe). Use antes de responder dúvidas sobre consórcio. Escreva a pergunta do cliente como consulta.',
        tableName: TABLE, topK: 4, includeDocumentMetadata: true, options: {},
      },
      id: uid('kb'), name: 'base_de_conhecimento', type: '@n8n/n8n-nodes-langchain.vectorStorePGVector', typeVersion: 1.3, position: [660, 320], credentials: cred('pg'),
    },
    geminiEmbeddings('Embeddings Gemini', [700, 540]),
    ...tools.map((t, i) => toolNode(t, [1000 + (i % 3) * 190, 320 + Math.floor(i / 3) * 220])),
    http('Responder no WhatsApp', [1220, -60], `={{ ${conv('urls.responder')} }}`,
      `={{ JSON.stringify({ conversa_id: ${conv('conversa_id')}, turno: ${conv('turno')}, texto: $json.output }) }}`, { retry: true }),
    http('Avisar falha ao CRM', [1220, 120], `={{ ${conv('urls.responder')} }}`,
      `={{ JSON.stringify({ conversa_id: ${conv('conversa_id')}, turno: ${conv('turno')}, erro: String($json.error?.message || $json.error || 'falha na IA') }) }}`),
  ];
  const connections = {
    'WhatsApp (conector)': { main: [[{ node: 'Configuração', type: 'main', index: 0 }]] },
    'Configuração': { main: [[{ node: 'É mensagem?', type: 'main', index: 0 }]] },
    'É mensagem?': { main: [[{ node: 'CRM - Conversa', type: 'main', index: 0 }], []] },
    'CRM - Conversa': { main: [[{ node: 'IA atende?', type: 'main', index: 0 }]] },
    'IA atende?': { main: [[{ node: 'IA Vero', type: 'main', index: 0 }], []] },
    'IA Vero': { main: [[{ node: 'Responder no WhatsApp', type: 'main', index: 0 }], [{ node: 'Avisar falha ao CRM', type: 'main', index: 0 }]] },
    Gemini: { ai_languageModel: [[{ node: 'IA Vero', type: 'ai_languageModel', index: 0 }]] },
    base_de_conhecimento: { ai_tool: [[{ node: 'IA Vero', type: 'ai_tool', index: 0 }]] },
    'Embeddings Gemini': { ai_embedding: [[{ node: 'base_de_conhecimento', type: 'ai_embedding', index: 0 }]] },
  };
  for (const t of tools) connections[t.name] = { ai_tool: [[{ node: 'IA Vero', type: 'ai_tool', index: 0 }]] };
  return flow('Vero - Atendimento no WhatsApp (IA)', nodes, connections, { id: 'VeroAtendimento1' });
}

/* ------------------------- 2) Base de conhecimento do CRM ------------------------- */

const loader = (name, position, mode) => ({
  parameters: {
    ...(mode === 'binary' ? { dataType: 'binary', binaryMode: 'allInputData', loader: 'auto' } : { dataType: 'json', jsonMode: 'expressionData', jsonData: '={{ $json.texto }}' }),
    textSplittingMode: 'custom',
    options: {
      metadata: {
        metadataValues: mode === 'binary'
          ? [['fonte', 'drive'], ['documento', '={{ $json.documento }}'], ['titulo', '={{ $json.nome }}'], ['modificado', '={{ $json.modificado }}'], ['tipo', 'arquivo']]
            .map(([n, v]) => ({ name: n, value: v }))
          : [['fonte', '={{ $json.fonte }}'], ['documento', '={{ $json.id }}'], ['titulo', '={{ $json.titulo }}'], ['tipo', '={{ $json.tipo }}']].map(([n, v]) => ({ name: n, value: v })),
      },
    },
  },
  id: uid(name), name, type: '@n8n/n8n-nodes-langchain.documentDefaultDataLoader', typeVersion: 1.1, position,
});
const splitter = (name, position) => ({
  parameters: { chunkSize: 1500, chunkOverlap: 150, options: {} }, id: uid(name), name, type: '@n8n/n8n-nodes-langchain.textSplitterRecursiveCharacterTextSplitter', typeVersion: 1, position,
});
const insert = (name, position) => ({
  parameters: { mode: 'insert', tableName: TABLE, embeddingBatchSize: 50, options: {} },
  id: uid(name), name, type: '@n8n/n8n-nodes-langchain.vectorStorePGVector', typeVersion: 1.3, position, credentials: cred('pg'),
});
const pgQuery = (name, position, query) => ({
  parameters: { operation: 'executeQuery', query, options: {} }, id: uid(name), name, type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position, credentials: cred('pg'), alwaysOutputData: true,
});
const deleteWhere = (cond) => `DO $$ BEGIN IF to_regclass('public.${TABLE}') IS NOT NULL THEN DELETE FROM ${TABLE} WHERE ${cond}; END IF; END $$;`;

function baseCrm() {
  seq = 0;
  const nodes = [
    note('Leia-me', `## Base de conhecimento do CRM
Todo dia às 3h (ou em **Executar fluxo**), copia para a base da IA (tabela **${TABLE}** no Postgres da VPS):
- a base da IA do CRM (perguntas, objeções, dicas e mensagens);
- o critério de fit e as orientações do agente;
- as transcrições das R1, se o administrador ligar no CRM (sem nome, telefone, e-mail e CPF).
A cópia anterior do CRM é trocada pela nova (os arquivos do Google Drive ficam).`, [-420, -320], [520, 260], 4),
    { parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 3 * * *' }] } }, id: uid('cron'), name: 'Todo dia às 3h', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [-400, 0] },
    { parameters: {}, id: uid('manual'), name: 'Executar agora', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [-400, 180] },
    setNode('Configuração', [-180, 80], [['crm_url', CRM_PLACEHOLDER]], false),
    http('CRM - Base de conhecimento', [40, 80], '={{ $json.crm_url.replace(/\\/+$/, "") }}/api/integracoes/n8n/conhecimento', null, { method: 'GET', timeout: 60000, retry: true }),
    pgQuery('Apagar a cópia anterior', [260, 80], deleteWhere("metadata->>'fonte' = 'crm'")),
    {
      parameters: { jsCode: "// Um item por documento do CRM\nreturn $('CRM - Base de conhecimento').first().json.documentos.map((d) => ({ json: d }));" },
      id: uid('code'), name: 'Um item por documento', type: 'n8n-nodes-base.code', typeVersion: 2, position: [480, 80],
    },
    insert('Guardar na base', [720, 80]),
    geminiEmbeddings('Embeddings Gemini', [640, 300]),
    loader('Ler documento', [840, 300], 'json'),
    splitter('Dividir em trechos', [920, 500]),
  ];
  const connections = {
    'Todo dia às 3h': { main: [[{ node: 'Configuração', type: 'main', index: 0 }]] },
    'Executar agora': { main: [[{ node: 'Configuração', type: 'main', index: 0 }]] },
    'Configuração': { main: [[{ node: 'CRM - Base de conhecimento', type: 'main', index: 0 }]] },
    'CRM - Base de conhecimento': { main: [[{ node: 'Apagar a cópia anterior', type: 'main', index: 0 }]] },
    'Apagar a cópia anterior': { main: [[{ node: 'Um item por documento', type: 'main', index: 0 }]] },
    'Um item por documento': { main: [[{ node: 'Guardar na base', type: 'main', index: 0 }]] },
    'Embeddings Gemini': { ai_embedding: [[{ node: 'Guardar na base', type: 'ai_embedding', index: 0 }]] },
    'Ler documento': { ai_document: [[{ node: 'Guardar na base', type: 'ai_document', index: 0 }]] },
    'Dividir em trechos': { ai_textSplitter: [[{ node: 'Ler documento', type: 'ai_textSplitter', index: 0 }]] },
  };
  return flow('Vero - Base de conhecimento (CRM)', nodes, connections, { id: 'VeroBaseCrm00001' });
}

/* ------------------------- 3) Base de conhecimento do Google Drive ------------------------- */

function baseDrive() {
  seq = 0;
  const drive = (name, position, parameters, extra = {}) => ({
    parameters, id: uid(name), name, type: 'n8n-nodes-base.googleDrive', typeVersion: 3, position, credentials: cred('drive'), ...extra,
  });
  const code = (name, position, jsCode) => ({ parameters: { jsCode }, id: uid(name), name, type: 'n8n-nodes-base.code', typeVersion: 2, position });
  const nodes = [
    note('Leia-me', `## Base de conhecimento do Google Drive
Os arquivos de uma pasta do Drive entram na base da IA: materiais sobre consórcio, roteiros, perguntas frequentes, transcrições de ligações e reuniões (Google Docs, Planilhas e Apresentações, PDF, Word, TXT, CSV).
1. Credencial **${CRED.drive.name}**: cole o ID e a chave do cliente OAuth do Google e clique em **Sign in with Google**.
2. No nó **Pasta do Drive**, cole o link da pasta.
3. Clique em **Execute** para importar tudo agora e depois em **Publish**.
A cada hora ele confere a pasta: arquivo novo ou alterado entra (a versão anterior sai), e arquivo tirado da pasta sai da base.
Evite dados pessoais de clientes nos arquivos: a IA pode usar o conteúdo nas respostas.`, [-460, -360], [600, 300], 4),
    { parameters: { rule: { interval: [{ field: 'cronExpression', expression: '20 * * * *' }] } }, id: uid('cron'), name: 'A cada hora', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [-440, 0] },
    { parameters: {}, id: uid('manual'), name: 'Importar agora', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [-440, 180] },
    setNode('Pasta do Drive', [-220, 80], [['pasta', 'COLE-AQUI-O-LINK-DA-PASTA-DO-DRIVE']], false),
    drive('Arquivos da pasta', [0, 80], {
      resource: 'fileFolder', operation: 'search', searchMethod: 'query', queryString: '', returnAll: true,
      filter: {
        folderId: { __rl: true, mode: 'id', value: "={{ (String($json.pasta).match(/folders\\/([-\\w]+)/) || [null, String($json.pasta).trim()])[1] }}" },
        whatToSearch: 'files', includeTrashed: false,
      },
      options: { fields: ['*'] },
    }, { alwaysOutputData: true }),
    {
      parameters: { operation: 'executeQuery', query: `SELECT metadata->>'documento' AS documento, max(metadata->>'modificado') AS modificado FROM ${TABLE} WHERE metadata->>'fonte' = 'drive' GROUP BY 1`, options: {} },
      id: uid('base'), name: 'Já na base', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [220, 80], credentials: cred('pg'), alwaysOutputData: true, executeOnce: true,
    },
    code('O que mudou', [440, 80], `// Compara a pasta com a base: arquivo novo ou alterado entra; arquivo que saiu da pasta é apagado da base
const LIDOS = /^(application\\/vnd\\.google-apps\\.(document|spreadsheet|presentation)|application\\/pdf|application\\/vnd\\.openxmlformats-officedocument\\.wordprocessingml\\.document|application\\/epub\\+zip|application\\/json|text\\/.+)$/;
const naBase = new Map($('Já na base').all().filter((i) => i.json.documento).map((i) => [i.json.documento, i.json.modificado]));
const arquivos = $('Arquivos da pasta').all().map((i) => i.json).filter((f) => f.id && LIDOS.test(f.mimeType || ''));
const naPasta = new Set(arquivos.map((f) => 'drive-' + f.id));
const saida = [];
for (const f of arquivos) {
  const documento = 'drive-' + f.id;
  if (naBase.get(documento) !== f.modifiedTime) saida.push({ json: { acao: 'importar', id: f.id, nome: f.name, modificado: f.modifiedTime, documento } });
}
for (const documento of naBase.keys()) if (!naPasta.has(documento)) saida.push({ json: { acao: 'remover', documento } });
return saida;`),
    pgQuery('Apagar versões antigas', [660, 80], `=DELETE FROM ${TABLE} WHERE metadata->>'fonte' = 'drive' AND metadata->>'documento' IN ({{ $('O que mudou').all().map((i) => "'" + String(i.json.documento).replace(/[^A-Za-z0-9_-]/g, '') + "'").join(', ') || "''" }})`),
    code('Arquivos para importar', [880, 80], "return $('O que mudou').all().filter((i) => i.json.acao === 'importar').map((i) => ({ json: i.json }));"),
    drive('Baixar arquivo', [1100, 80], {
      operation: 'download', fileId: { __rl: true, value: '={{ $json.id }}', mode: 'id' },
      options: { googleFileConversion: { conversion: { docsToFormat: 'text/plain', sheetsToFormat: 'text/csv', slidesToFormat: 'application/pdf' } } },
    }, { onError: 'continueErrorOutput' }),
    insert('Guardar na base', [1340, 60]),
    geminiEmbeddings('Embeddings Gemini', [1260, 300]),
    loader('Ler arquivo', [1460, 300], 'binary'),
    splitter('Dividir em trechos', [1540, 500]),
  ];
  // Executa sempre a partir do primeiro item: a consulta à base e a remoção rodam uma vez só
  nodes.find((n) => n.name === 'Apagar versões antigas').executeOnce = true;
  const connections = {
    'A cada hora': { main: [[{ node: 'Pasta do Drive', type: 'main', index: 0 }]] },
    'Importar agora': { main: [[{ node: 'Pasta do Drive', type: 'main', index: 0 }]] },
    'Pasta do Drive': { main: [[{ node: 'Arquivos da pasta', type: 'main', index: 0 }]] },
    'Arquivos da pasta': { main: [[{ node: 'Já na base', type: 'main', index: 0 }]] },
    'Já na base': { main: [[{ node: 'O que mudou', type: 'main', index: 0 }]] },
    'O que mudou': { main: [[{ node: 'Apagar versões antigas', type: 'main', index: 0 }]] },
    'Apagar versões antigas': { main: [[{ node: 'Arquivos para importar', type: 'main', index: 0 }]] },
    'Arquivos para importar': { main: [[{ node: 'Baixar arquivo', type: 'main', index: 0 }]] },
    'Baixar arquivo': { main: [[{ node: 'Guardar na base', type: 'main', index: 0 }], []] },
    'Embeddings Gemini': { ai_embedding: [[{ node: 'Guardar na base', type: 'ai_embedding', index: 0 }]] },
    'Ler arquivo': { ai_document: [[{ node: 'Guardar na base', type: 'ai_document', index: 0 }]] },
    'Dividir em trechos': { ai_textSplitter: [[{ node: 'Ler arquivo', type: 'ai_textSplitter', index: 0 }]] },
  };
  return flow('Vero - Base de conhecimento (Google Drive)', nodes, connections, { id: 'VeroBaseDrive001' });
}

/* ------------------------- gravação ------------------------- */

fs.mkdirSync(OUT, { recursive: true });
const files = {
  'fluxo-atendimento-whatsapp.json': atendimento(),
  'fluxo-base-conhecimento-crm.json': baseCrm(),
  'fluxo-base-conhecimento-drive.json': baseDrive(),
};
for (const [f, wf] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, f), `${JSON.stringify(wf, null, 2)}\n`);
  console.log(`${path.join('deploy', 'n8n', f)}: ${wf.nodes.length} nós`);
}
fs.writeFileSync(path.join(OUT, 'PROMPT-N8N.md'), prompt());
console.log(`deploy/n8n/PROMPT-N8N.md; ferramentas do CRM: ${tools.map((t) => t.name).join(', ')}`);

/* ------------------------- prompt para o construtor de IA do n8n ------------------------- */

function prompt() {
  const toolLines = tools.map((t) => {
    const props = Object.entries(t.input_schema?.properties || {});
    const req = t.input_schema?.required || [];
    const fields = props.length
      ? props.map(([k, p]) => `     - \`${k}\` (${p.type === 'number' ? 'número' : 'texto'}${req.includes(k) ? ', obrigatório' : ', opcional'}): ${dot(p.description || k)}${p.enum ? ` Valores: ${p.enum.join(', ')}.` : ''}`).join('\n')
      : '     - sem campos (o corpo leva só conversa_id e turno)';
    return `   - **${t.name}**: ${t.description}\n${fields}`;
  }).join('\n');
  return `# Prompt para o construtor de IA do n8n (AI Workflow Builder)

Use este prompt para o n8n montar o fluxo de atendimento do WhatsApp sozinho, em qualquer conta: a trial de agora, a premium de depois ou outra. O mesmo prompt gera o mesmo fluxo.

> **Caminho mais garantido:** importe o arquivo pronto \`fluxo-atendimento-whatsapp.json\` (**Create › Import from file**). Na VPS, o instalador já importa e publica tudo sozinho. O construtor de IA pode variar um detalhe ou outro; use a lista de conferência no fim deste arquivo.

## Como usar

1. No n8n, crie um fluxo vazio (**Create workflow**).
2. Abra o construtor de IA (ícone de estrelinhas ou **Build with AI**).
3. Copie **todo** o bloco abaixo, cole e envie.
4. Quando o n8n terminar:
   1. Crie as credenciais (item 2 do prompt).
   2. Troque o endereço do CRM no nó **Configuração**.
   3. Confira com a lista de conferência.

## Prompt (copie tudo)

\`\`\`text
Crie um fluxo chamado "Vero - Atendimento no WhatsApp (IA)" para atender leads de consórcio no WhatsApp com IA.
Um CRM próprio decide quando a IA atende e envia as respostas. Use exatamente estes nós, nomes e ligações:

1. Webhook "WhatsApp (conector)": método POST, caminho (path) "vero-whatsapp", responder imediatamente (Respond: Immediately).
   Recebe o aviso da Evolution API (WhatsApp), com o corpo {event, instance, data}.

2. Credenciais (crie as referências; eu preencho os valores):
   - "CRM Vero (token do n8n)": tipo Header Auth, nome do cabeçalho Authorization, valor "Bearer <token>".
   - "Google Gemini (Vero)": tipo Google Gemini (PaLM) API.
   - "Postgres da VPS (base de conhecimento)": tipo Postgres.

3. Set "Configuração": campo crm_url (texto) = "${CRM_PLACEHOLDER}", mantendo os demais campos (Include Other Input Fields).

4. IF "É mensagem?": continua só se {{ $json.body.event }} for igual a "messages.upsert". A saída falsa fica sem ligação.

5. HTTP Request "CRM - Conversa": POST para {{ $json.crm_url }}/api/integracoes/n8n/mensagem.
   - Autenticação: Generic Credential Type, Header Auth, credencial "CRM Vero (token do n8n)".
   - Corpo JSON: {{ JSON.stringify({ event: $json.body.event, instance: $json.body.instance, data: $json.body.data }) }}.
   - Tempo limite (timeout): 60000 ms. Ligue Retry On Fail com 3 tentativas e 3000 ms entre elas.
   - O CRM responde {atender, motivo, conversa_id, turno, sistema, mensagem, modelo_gemini, urls: {acao, responder}}.

6. IF "IA atende?": continua só se {{ $json.atender }} for verdadeiro (boolean true). A saída falsa fica sem ligação.

7. AI Agent "IA Vero":
   - Prompt definido abaixo (Define below): {{ $json.mensagem }}.
   - System Message: {{ $json.sistema }}.
   - Max Iterations: 10.
   - Em Settings, On Error: "Continue (using error output)".
   - Sem memória: o histórico da conversa já vem do CRM dentro de "sistema".

8. Google Gemini Chat Model "Gemini", ligado como Chat Model do "IA Vero".
   - Modelo: {{ $('CRM - Conversa').item.json.modelo_gemini || 'models/gemini-2.5-flash' }}.
   - Temperatura: 0.4.
   - Credencial "Google Gemini (Vero)".

9. Postgres PGVector Store "base_de_conhecimento", modo "Retrieve Documents (As Tool for AI Agent)", ligado como Tool do "IA Vero".
   - Tabela: ${TABLE}. Limite: 4. Incluir metadados.
   - Credencial "Postgres da VPS (base de conhecimento)".
   - Descrição: "Busca na base de conhecimento da Vero (materiais sobre consórcio, planejamento, objeções, perguntas frequentes e trechos de conversas da equipe). Use antes de responder dúvidas sobre consórcio. Escreva a pergunta do cliente como consulta."
   - Ligue nele um Embeddings Google Gemini "Embeddings Gemini" (modelo models/gemini-embedding-001, credencial "Google Gemini (Vero)").

10. Seis HTTP Request Tool, ligados como Tool do "IA Vero".
   - O nome de cada nó é exatamente o nome da ferramenta abaixo.
   - Todos: POST, credencial "CRM Vero (token do n8n)" (Generic Credential Type, Header Auth), timeout 40000 ms.
   - URL: {{ $('CRM - Conversa').item.json.urls.acao }}/<nome da ferramenta>.
   - Corpo JSON:
     {{ JSON.stringify({ conversa_id: $('CRM - Conversa').item.json.conversa_id, turno: $('CRM - Conversa').item.json.turno, dados: { ...cada campo com $fromAI('campo', 'descrição', 'string') } }) }}.
   - Campos opcionais com valor padrão vazio: $fromAI('campo', 'descrição', 'string', '').
   - A descrição de cada ferramenta (Tool Description) é o texto depois do nome:
${toolLines}

11. HTTP Request "Responder no WhatsApp", ligado na saída de sucesso do "IA Vero".
   - POST para {{ $('CRM - Conversa').item.json.urls.responder }}, credencial "CRM Vero (token do n8n)".
   - Corpo JSON: {{ JSON.stringify({ conversa_id: $('CRM - Conversa').item.json.conversa_id, turno: $('CRM - Conversa').item.json.turno, texto: $json.output }) }}.
   - Retry On Fail: 3 tentativas.

12. HTTP Request "Avisar falha ao CRM", ligado na saída de erro do "IA Vero".
   - POST para a mesma URL de "Responder no WhatsApp", com a mesma credencial.
   - Corpo JSON: {{ JSON.stringify({ conversa_id: $('CRM - Conversa').item.json.conversa_id, turno: $('CRM - Conversa').item.json.turno, erro: String($json.error?.message || $json.error || 'falha na IA') }) }}.

Não envie mensagens direto pela Evolution API: quem envia é o CRM, pelo "Responder no WhatsApp". Não crie memória de chat.
\`\`\`

## Depois de gerar

1. **Credenciais:**
   - **CRM Vero (token do n8n)**: Header Auth, nome \`Authorization\`, valor \`Bearer crm_n8n_...\`. Gere o token no CRM: Integrações › Agente de IA no WhatsApp › Provedor "Fluxo do n8n na VPS" › Gerar token.
   - **Google Gemini (Vero)**: a chave do Google AI Studio.
   - **Postgres da VPS (base de conhecimento)**: na VPS, host \`base-ia\`, banco \`base_ia\`, usuário \`vero\` e a senha do arquivo \`/opt/vero-whatsapp/base-ia.env\`. O instalador já cria essa credencial.
2. **Endereço do CRM** no nó **Configuração** (ex.: \`https://crm.veroconsorciosbr.com.br\`).
3. **Publish.**

## Lista de conferência

- [ ] O webhook tem o path \`vero-whatsapp\`, POST e responde na hora.
- [ ] **CRM - Conversa** chama \`/api/integracoes/n8n/mensagem\` com o token, e **IA atende?** testa \`atender\`.
- [ ] Prompt do **IA Vero** = \`{{ $json.mensagem }}\`, System Message = \`{{ $json.sistema }}\` e On Error = saída de erro.
- [ ] O **IA Vero** tem as ferramentas ${tools.map((t) => `\`${t.name}\``).join(', ')} e \`base_de_conhecimento\`, com esses nomes exatos.
- [ ] Cada ferramenta manda \`conversa_id\` e \`turno\` do nó **CRM - Conversa**.
- [ ] A saída de sucesso vai para **Responder no WhatsApp** (texto = \`$json.output\`), e a de erro para **Avisar falha ao CRM**.
- [ ] Nada envia mensagem direto pela Evolution API.

## Os outros dois fluxos

Os dois são simples. Importe os arquivos prontos:
- \`fluxo-base-conhecimento-crm.json\`: todo dia às 3h, \`GET /api/integracoes/n8n/conhecimento\`, apaga a cópia anterior do CRM e grava na tabela \`${TABLE}\` com os Embeddings Gemini.
- \`fluxo-base-conhecimento-drive.json\`: a cada hora, os arquivos de uma pasta do Google Drive entram na mesma tabela (novos e alterados entram; os que saem da pasta saem da base).

Arquivo gerado por \`npm run n8n:fluxos\` a partir das ferramentas do agente do CRM.
`;
}
