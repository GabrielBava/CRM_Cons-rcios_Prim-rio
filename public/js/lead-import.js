// Modelo em Excel para importar uma base de leads: colunas obrigatórias (fundo escuro) e opcionais (fundo claro),
// uma linha de exemplo e a aba "Instruções" com a descrição de cada coluna e as origens aceitas.
import { opts } from './ui.js';
import { buildXlsx, downloadBlob } from './xlsx.js';

// [cabeçalho, obrigatória, descrição, exemplo]
export const LEAD_COLUMNS = [
  ['Nome', 'Sim', 'Nome completo (pessoa física) ou nome do contato (empresa).', 'Maria Souza'],
  ['Telefone', 'Sim, ou o e-mail', 'Celular com DDD. Informe o telefone, o e-mail ou os dois.', '(11) 91234-5678'],
  ['E-mail', 'Sim, ou o telefone', 'E-mail do lead.', 'maria.souza@email.com'],
  ['WhatsApp', 'Não', 'Quando for diferente do telefone.', ''],
  ['Telefone 2', 'Não', 'Telefone secundário.', ''],
  ['Tipo', 'Não', 'PF ou PJ (padrão: PF; CNPJ informado vira PJ).', 'PF'],
  ['CPF/CNPJ', 'Não', 'Só se a base trouxer; é usado para evitar duplicidade.', ''],
  ['Empresa', 'Não', 'Nome fantasia (pessoa jurídica).', ''],
  ['Cidade', 'Não', 'Cidade.', 'São Paulo'],
  ['UF', 'Não', 'Sigla do estado.', 'SP'],
  ['Profissão', 'Não', 'Profissão ou atividade.', 'Engenheira'],
  ['Origem', 'Não', 'Canal de origem (lista abaixo). Formulários (Meta Ads, Instagram, Facebook, LinkedIn, landing page) já entram em "Tentativa de contato".', 'Meta Ads'],
  ['Campanha', 'Não', 'Nome da campanha ou ação.', 'Imóvel outubro'],
  ['Crédito desejado', 'Não', 'Valor do crédito, em reais.', 'R$ 300.000,00'],
  ['Observações', 'Não', 'Observações iniciais do lead.', 'Quer imóvel na zona sul'],
  ['E-mail do responsável', 'Não', 'E-mail do especialista no CRM. Em branco: o responsável escolhido na importação (ou a roleta).', ''],
  ['ID do lead', 'Não', 'ID do lead na plataforma (Meta, LinkedIn…): impede reimportar o mesmo lead.', ''],
  ['Data de recebimento', 'Não', 'Data em que o lead chegou.', ''],
];

export function downloadLeadTemplate() {
  const headers = LEAD_COLUMNS.map((c) => c[0]);
  const required = new Set(LEAD_COLUMNS.filter((c) => c[1] !== 'Não').map((c) => c[0]));
  const origins = opts('origem').map((o) => o.label);
  const blob = buildXlsx([
    {
      name: 'Leads',
      // Só o cabeçalho: os exemplos ficam na aba Instruções (evita importar a linha de exemplo por engano)
      rows: [headers],
      widths: LEAD_COLUMNS.map((c) => Math.max(14, c[0].length + 6)),
      // Cabeçalho: obrigatórias em fundo escuro, opcionais em fundo claro
      styles: (r, c) => (r === 0 ? (required.has(headers[c]) ? 1 : 2) : 0),
    },
    {
      name: 'Instruções',
      rows: [
        ['Coluna', 'Obrigatória?', 'Descrição', 'Exemplo'],
        ...LEAD_COLUMNS,
        [],
        ['Regras da importação'],
        ['1. Antes de importar, o CRM lê as colunas e valida cada linha (nome, telefone ou e-mail, crédito).'],
        ['2. Leads que já existem no CRM (mesmo telefone, e-mail, CPF/CNPJ ou ID do lead) ou repetidos no arquivo são removidos: só os cadastros novos viram cards no funil.'],
        ['3. Preencha a aba Leads a partir da linha 2, sem mudar os nomes das colunas. Máximo de 5.000 linhas por arquivo.'],
        [],
        ['Origens aceitas'],
        ...origins.map((o) => [o]),
      ],
      widths: [24, 18, 90, 26],
      styles: (r) => (r === 0 ? 1 : r === LEAD_COLUMNS.length + 2 || r === LEAD_COLUMNS.length + 7 ? 3 : 0),
    },
  ]);
  downloadBlob(blob, 'modelo-importacao-leads.xlsx');
}
