'use strict';
/**
 * Perfis e permissões por módulo (modelo usado pelos ERPs de mercado):
 * - o PERFIL define o escopo de dados (administrador: tudo; líder de equipe: a equipe; especialista: os próprios);
 * - os MÓDULOS definem quais telas o usuário acessa. Cada perfil tem um conjunto padrão e o administrador
 *   pode incluir ou retirar módulos de um usuário específico, sem mudar o escopo de dados.
 * A verificação acontece no servidor; o menu da interface apenas reflete o resultado.
 */
const { forbidden } = require('./util');

const MODULES = [
  { key: 'painel', label: 'Painel inicial', group: 'Comercial' },
  { key: 'distribuicao', label: 'Prospects e leads (distribuição)', group: 'Comercial' },
  { key: 'crm', label: 'CRM (funil, leads e atividades)', group: 'Comercial' },
  { key: 'agenda', label: 'Agenda e tarefas', group: 'Comercial' },
  { key: 'simulador', label: 'Simulador', group: 'Comercial' },
  { key: 'propostas', label: 'Propostas', group: 'Comercial' },
  { key: 'clientes', label: 'Clientes', group: 'Comercial' },
  { key: 'metas', label: 'Metas', group: 'Comercial' },
  { key: 'prevenda', label: 'Pré-venda', group: 'Operação' },
  { key: 'vendas', label: 'Vendas', group: 'Operação' },
  { key: 'posvenda', label: 'Pós-venda (checklist, NPS e lances)', group: 'Operação' },
  { key: 'comissoes', label: 'Comissões e cancelamentos', group: 'Operação' },
  { key: 'treinamentos', label: 'Treinamentos', group: 'Operação' },
  { key: 'administradoras', label: 'Administradoras', group: 'Administração' },
  { key: 'planos', label: 'Planos', group: 'Administração' },
  { key: 'relatorios', label: 'Relatórios', group: 'Administração' },
  { key: 'usuarios', label: 'Usuários e permissões', group: 'Administração' },
  { key: 'configuracoes', label: 'Configurações', group: 'Administração' },
];
const MODULE_KEYS = MODULES.map((m) => m.key);

const COMMERCIAL = ['painel', 'crm', 'agenda', 'simulador', 'propostas', 'clientes', 'metas', 'prevenda', 'vendas', 'posvenda', 'comissoes', 'treinamentos'];

/** Módulos padrão de cada perfil. */
const ROLE_MODULES = {
  admin: MODULE_KEYS,
  gestor: [...COMMERCIAL, 'distribuicao', 'relatorios'],
  consultor: COMMERCIAL,
  leitura: ['painel', 'crm', 'clientes', 'propostas', 'posvenda', 'treinamentos'],
};

/** Módulos que só o administrador acessa, mesmo que sejam incluídos manualmente para outro perfil. */
const ADMIN_ONLY = ['usuarios', 'configuracoes'];

/** Descrição do escopo de dados de cada perfil (exibida na matriz de permissões). */
const ROLE_SCOPE = {
  admin: 'Todos os registros e todas as funções, sem restrição.',
  gestor: 'Registros da própria equipe e leads ainda sem responsável. Distribui leads dentro da equipe e acompanha metas, comissões e cancelamentos do time.',
  consultor: 'Somente os próprios leads, clientes, propostas, vendas e comissões.',
  leitura: 'Consulta os registros da equipe, sem editar nem exportar dados pessoais.',
};

function parseOverrides(raw) {
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {};
    return { add: Array.isArray(o.add) ? o.add.filter((k) => MODULE_KEYS.includes(k)) : [], remove: Array.isArray(o.remove) ? o.remove.filter((k) => MODULE_KEYS.includes(k)) : [] };
  } catch {
    return { add: [], remove: [] };
  }
}

/** Módulos efetivos do usuário: padrão do perfil + inclusões − retiradas. */
function userModules(user) {
  if (user.role === 'admin') return [...MODULE_KEYS];
  const o = parseOverrides(user.modules);
  const set = new Set(ROLE_MODULES[user.role] || []);
  o.add.forEach((k) => !ADMIN_ONLY.includes(k) && set.add(k));
  o.remove.forEach((k) => set.delete(k));
  return MODULE_KEYS.filter((k) => set.has(k));
}

const hasModule = (user, key) => userModules(user).includes(key);

function requireModule(user, key) {
  if (!hasModule(user, key)) {
    const m = MODULES.find((x) => x.key === key);
    throw forbidden(`Seu usuário não tem acesso ao módulo "${m ? m.label : key}". Fale com o administrador.`);
  }
}

module.exports = { MODULES, MODULE_KEYS, ROLE_MODULES, ROLE_SCOPE, ADMIN_ONLY, parseOverrides, userModules, hasModule, requireModule };
