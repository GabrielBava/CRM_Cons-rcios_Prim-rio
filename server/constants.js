'use strict';
/**
 * Listas fixas usadas pelas regras de negócio. Listas editáveis ficam na tabela "options".
 */

// attempt = conta como tentativa de contato; outbound = comunicação iniciada pela empresa
const ACTIVITY_TYPES = {
  ligacao_realizada: { label: 'Ligação realizada', channel: 'ligacao', outbound: true, attempt: true, call: true },
  tentativa_sem_atendimento: { label: 'Tentativa sem atendimento', channel: 'ligacao', outbound: true, attempt: true, call: true },
  ligacao_recebida: { label: 'Ligação recebida', channel: 'ligacao', call: true },
  mensagem_enviada: { label: 'Mensagem enviada', channel: 'whatsapp', outbound: true, attempt: true },
  mensagem_recebida: { label: 'Mensagem recebida', channel: 'whatsapp' },
  email_enviado: { label: 'E-mail enviado', channel: 'email', outbound: true, attempt: true },
  email_recebido: { label: 'E-mail recebido', channel: 'email' },
  direct_enviado: { label: 'Direct enviado (Instagram)', channel: 'direct', outbound: true, attempt: true },
  direct_recebido: { label: 'Direct recebido (Instagram)', channel: 'direct' },
  linkedin_enviado: { label: 'DM enviada (LinkedIn)', channel: 'linkedin', outbound: true, attempt: true },
  linkedin_recebido: { label: 'DM recebida (LinkedIn)', channel: 'linkedin' },
  conversa_presencial: { label: 'Conversa presencial', channel: 'presencial' },
  conversa_video: { label: 'Conversa por vídeo', channel: 'video' },
  reuniao_agendada: { label: 'Reunião agendada', system: true },
  reuniao_realizada: { label: 'Reunião realizada' },
  reuniao_nao_realizada: { label: 'Reunião não realizada', system: true },
  observacao: { label: 'Observação' },
  tarefa: { label: 'Tarefa', system: true },
  mudanca_etapa: { label: 'Mudança de etapa', system: true },
  simulacao: { label: 'Simulação', system: true },
  proposta: { label: 'Proposta', system: true },
  cadastro: { label: 'Cadastro', system: true },
  preferencia: { label: 'Preferência de contato', system: true },
  financeiro: { label: 'Financeiro', system: true },
  pos_venda: { label: 'Pós-venda', system: true },
};

const CALL_ATTEMPT_TYPES = ['ligacao_realizada', 'tentativa_sem_atendimento'];
const OUTBOUND_TYPES = Object.entries(ACTIVITY_TYPES)
  .filter(([, v]) => v.outbound)
  .map(([k]) => k);
const ATTEMPT_TYPES = Object.entries(ACTIVITY_TYPES)
  .filter(([, v]) => v.attempt)
  .map(([k]) => k);

// Resultados de ligação que indicam que não houve conversa
const NO_ANSWER_RESULTS = ['nao_atendida', 'ocupado', 'caixa_postal', 'numero_invalido', 'interrompida'];

const RELATIONSHIPS = { prospect: 'Prospect', lead: 'Lead', cliente: 'Cliente' };
const LEAD_STATUS = {
  novo: 'Novo',
  em_contato: 'Em contato',
  qualificado: 'Qualificado',
  desqualificado: 'Desqualificado',
  nutricao: 'Em nutrição',
  convertido: 'Convertido em cliente',
};
const CLIENT_STATUS = { ativo: 'Ativo', inativo: 'Inativo' };
const OPP_STATUS = { aberta: 'Aberta', ganha: 'Ganha', perdida: 'Perdida', pausada: 'Pausada (nutrição)' };
const PRIORITIES = { baixa: 'Baixa', media: 'Média', alta: 'Alta' };
const PROPOSAL_STATUS = {
  rascunho: 'Gerada (não enviada)',
  apresentada: 'Enviada ao cliente',
  em_analise: 'Em análise pelo cliente',
  aprovada: 'Aceita',
  recusada: 'Recusada',
  expirada: 'Expirada',
  substituida: 'Substituída',
};
const SIMULATION_STATUS = {
  em_elaboracao: 'Em elaboração',
  salva: 'Salva',
  enviada: 'Enviada ao cliente',
  cancelada: 'Cancelada',
};
const TASK_TYPES = {
  primeiro_contato: 'Primeiro contato',
  ligar: 'Ligar',
  retorno: 'Retorno',
  reuniao: 'Reunião (R1/R2)',
  one_on_one: 'One-on-one (1:1 com o líder)',
  follow_up: 'Follow-up',
  follow_up_proposta: 'Follow-up de proposta',
  revisar_proposta: 'Revisar proposta',
  enviar_proposta: 'Enviar proposta',
  pre_venda: 'Pré-venda',
  documentacao: 'Documentação',
  venda: 'Venda',
  onboarding: 'Onboarding do cliente',
  financeiro: 'Financeiro',
  pos_venda: 'Pós-venda',
  outra: 'Outra',
};
const TASK_PRIORITIES = { normal: 'Normal', alta: 'Alta', urgente: 'Urgente' };

/*
 * Régua de follow-up da proposta (dias corridos a partir do envio; sábado e domingo passam para segunda):
 * Dia 0, Dia 2, Dia 5, Dia 9, Dia 14 e Dia 21. Cada passo traz o roteiro da ligação e o modelo de mensagem do WhatsApp
 * ({nome}, {consultor}, {link}, {proposta} e {valor} são trocados pelos dados da proposta).
 */
const PROPOSAL_CADENCE = [
  {
    step: 'D0', days: 0, title: 'Dia 0 · Envio e confirmação de recebimento',
    script: 'Envie o link da proposta e confirme se o cliente conseguiu abrir. Pergunte a primeira impressão e se ficou alguma dúvida sobre valor, parcela ou prazo.',
    whatsapp: 'Olá, {nome}! Tudo bem? Aqui é {consultor}, da Vero. Conforme conversamos, preparei a sua proposta ({proposta}). Você pode ver todos os detalhes neste link: {link}\nQualquer dúvida, é só me chamar por aqui.',
  },
  {
    step: 'D2', days: 2, title: 'Dia 2 · Tirar dúvidas e reforçar o objetivo',
    script: 'Retome o objetivo do cliente (o que ele quer conquistar) e mostre como a proposta chega lá. Esclareça dúvidas sobre parcela, prazo e contemplação.',
    whatsapp: 'Oi, {nome}! Conseguiu dar uma olhada na proposta? Montei pensando no seu objetivo e posso te explicar qualquer ponto em uma ligação rápida. O link continua aqui: {link}',
  },
  {
    step: 'D5', days: 5, title: 'Dia 5 · Reforço de valor',
    script: 'Compare com a alternativa dele (financiamento, aluguel, aplicação). Use um caso real ou depoimento. Ajuste a proposta se necessário.',
    whatsapp: '{nome}, separei uma comparação rápida: com a proposta que te enviei você chega ao seu objetivo pagando bem menos do que em um financiamento. Quer que eu te mostre os números em 10 minutos? {link}',
  },
  {
    step: 'D9', days: 9, title: 'Dia 9 · Contato de fechamento',
    script: 'Pergunte se ele está pronto para seguir. Traga o próximo passo concreto (cadastro para adesão) e a data da próxima assembleia ou do início do plano.',
    whatsapp: 'Oi, {nome}! Passando para saber se podemos dar o próximo passo com a sua proposta. Se estiver tudo certo, eu já te envio o cadastro para adesão. Ficou alguma dúvida? {link}',
  },
  {
    step: 'D14', days: 14, title: 'Dia 14 · Ajuste da proposta',
    script: 'Entenda o que está travando a decisão (valor, momento, decisor). Ofereça um ajuste: outro crédito, prazo, parcela ou estratégia de lance.',
    whatsapp: '{nome}, se algo na proposta não encaixou no seu momento, me conta? Consigo ajustar o valor, o prazo ou a parcela para ficar do seu jeito.',
  },
  {
    step: 'D21', days: 21, title: 'Dia 21 · Última tentativa e decisão',
    script: 'Mensagem de encerramento cordial: pergunte se o projeto continua de pé. Defina: fechar, nova proposta, nutrição futura ou perdido.',
    whatsapp: 'Oi, {nome}! Vou encerrar o acompanhamento desta proposta por aqui. Se o seu projeto ainda estiver de pé, me avise que retomamos de onde paramos, ou preparo uma nova condição. Obrigado pela confiança!',
  },
];
/** Passos da régua antiga (D1, D3, D10) nas colunas da régua atual. */
const PROPOSAL_CADENCE_LEGACY = { D1: 'D2', D3: 'D5', D10: 'D9' };
const MEETING_OUTCOMES = { realizada: 'Realizada', nao_compareceu: 'Não compareceu (no-show)', remarcada: 'Remarcada', cancelada: 'Cancelada' };
const CONTACT_CHANNELS = { todos: 'Todos os canais', ligacao: 'Ligação', whatsapp: 'WhatsApp', email: 'E-mail', sms: 'SMS' };
const DATA_REQUEST_TYPES = {
  acesso: 'Acesso aos dados',
  correcao: 'Correção de dados',
  oposicao: 'Oposição a contato',
  eliminacao: 'Eliminação / anonimização',
  portabilidade: 'Portabilidade',
  outra: 'Outra',
};
const INTEGRATION_STATUS = {
  pendente: 'Integração pendente',
  em_teste: 'Em teste (não validada)',
  ativa: 'Ativa (validada)',
  erro: 'Com erro',
  desativada: 'Desativada',
};

// Campos de mapeamento aceitos para eventos da discadora
const DIALER_FIELDS = {
  external_call_id: 'ID da chamada na discadora (obrigatório)',
  lead_ref: 'ID do lead no CRM (código ou UID)',
  phone: 'Telefone discado',
  started_at: 'Data/hora de início',
  ended_at: 'Data/hora de término',
  duration_seconds: 'Duração (segundos)',
  agent_ref: 'Usuário/agente',
  technical_status: 'Status técnico',
  result: 'Resultado da tentativa',
  classification: 'Observação ou classificação',
  recording_url: 'Link da gravação',
  direction: 'Direção (entrada/saída)',
  call_origin: 'Origem da chamada',
};

module.exports = {
  ACTIVITY_TYPES,
  CALL_ATTEMPT_TYPES,
  OUTBOUND_TYPES,
  ATTEMPT_TYPES,
  NO_ANSWER_RESULTS,
  RELATIONSHIPS,
  LEAD_STATUS,
  CLIENT_STATUS,
  OPP_STATUS,
  PRIORITIES,
  PROPOSAL_STATUS,
  SIMULATION_STATUS,
  TASK_TYPES,
  TASK_PRIORITIES,
  PROPOSAL_CADENCE,
  PROPOSAL_CADENCE_LEGACY,
  MEETING_OUTCOMES,
  CONTACT_CHANNELS,
  DATA_REQUEST_TYPES,
  INTEGRATION_STATUS,
  DIALER_FIELDS,
};
