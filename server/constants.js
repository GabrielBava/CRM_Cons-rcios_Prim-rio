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
  rascunho: 'Rascunho',
  apresentada: 'Apresentada',
  em_analise: 'Em análise',
  aprovada: 'Aprovada',
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
  retorno: 'Retorno',
  ligar: 'Ligar',
  follow_up: 'Follow-up',
  reuniao: 'Reunião / diagnóstico',
  enviar_proposta: 'Enviar proposta',
  documentacao: 'Documentação',
  outra: 'Outra',
};
const MEETING_OUTCOMES = { realizada: 'Realizada', nao_compareceu: 'Cliente não compareceu', remarcada: 'Remarcada', cancelada: 'Cancelada' };
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
  MEETING_OUTCOMES,
  CONTACT_CHANNELS,
  DATA_REQUEST_TYPES,
  INTEGRATION_STATUS,
  DIALER_FIELDS,
};
