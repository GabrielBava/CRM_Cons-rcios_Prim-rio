'use strict';
/**
 * Treinamento de consórcios da trilha de integração (etapa 5). Texto com formatação simples:
 * "## " título, "- " item de lista, "**negrito**". O administrador pode editar cada um em Treinamentos.
 */
const TRAININGS = [
  {
    title: '1. Cultura Vero: quem somos e como atendemos',
    category: 'cultura',
    duration_min: 15,
    description: 'Propósito, posicionamento e o jeito Vero de atender: consultivo, transparente e com acompanhamento até a contemplação.',
    content: `## Propósito
A Vero Consórcios existe para ajudar pessoas e empresas a conquistar e multiplicar patrimônio com planejamento, sem juros. O nome vem do latim *verus*: verdadeiro. Transparência não é diferencial, é premissa.

## Posicionamento
- **Consultoria, não balcão:** primeiro entendemos o objetivo do cliente; o produto vem depois.
- **Estratégia:** consórcio como ferramenta de aquisição planejada e de alavancagem patrimonial.
- **Acompanhamento:** do diagnóstico (R1) à contemplação e ao uso do crédito.

## Nossos valores no dia a dia
- **Verdade:** nunca prometemos contemplação nem prazo; mostramos números e regras.
- **Clareza:** linguagem simples, sem jargão; o cliente precisa sair da reunião entendendo.
- **Disciplina:** todo lead tem próxima ação; toda R1 é registrada no CRM; todo follow-up acontece no dia.
- **Parceria:** o cliente é acompanhado pelo mesmo especialista e pelo pós-venda.

## O que esperamos do especialista
- Primeiro contato com o lead novo o quanto antes (meta: até 5 minutos em horário comercial).
- Agenda organizada: R1 sempre pelo botão **Agendar R1** do CRM.
- Usar somente o **modelo de R1** oficial e o **simulador** da Vero.
- Registrar cada contato no CRM: o que não está no CRM não aconteceu.`,
    quiz: [
      { question: 'Qual é a primeira etapa do atendimento Vero?', options: ['Apresentar o produto mais vendido', 'Entender o objetivo do cliente', 'Enviar a proposta pelo WhatsApp'], correct: 1 },
      { question: 'Podemos garantir a data de contemplação ao cliente?', options: ['Sim, quando o lance é alto', 'Não, nunca prometemos contemplação nem prazo'], correct: 1 },
    ],
  },
  {
    title: '2. O que é consórcio e como funciona',
    category: 'fundamentos',
    duration_min: 25,
    description: 'Grupos, assembleias, carta de crédito, taxa de administração, fundo de reserva, seguro e reajuste.',
    content: `## Conceito
Consórcio é a união de pessoas (físicas ou jurídicas) em um **grupo** com prazo e crédito definidos, que contribuem mensalmente para um fundo comum. Todo mês, em **assembleia**, o fundo contempla participantes com a **carta de crédito**, por sorteio ou lance, até que todos sejam contemplados. É regulado pelo Banco Central (Lei 11.795/2008) e administrado por uma **administradora** autorizada.

## O que compõe a parcela
- **Fundo comum:** a parte que forma o crédito do grupo.
- **Taxa de administração:** remuneração da administradora, diluída no prazo (não há juros).
- **Fundo de reserva:** proteção do grupo contra inadimplência; o saldo é devolvido no encerramento.
- **Seguro prestamista** (quando houver): quita o saldo em caso de morte ou invalidez.
- **Adesão** (quando houver): antecipação de parte da taxa de administração, diluída nas primeiras parcelas.

## Reajuste
O crédito e as parcelas são corrigidos anualmente por um índice (ex.: **INCC** para imóveis, **IPCA** para veículos e serviços). Isso preserva o poder de compra da carta. As projeções do simulador usam os valores atuais e podem variar.

## Parcela integral x reduzida
- **Integral:** paga 100% da parcela desde o início.
- **Reduzida (fator redutor):** paga um percentual menor até a contemplação; depois, a diferença é diluída nas parcelas restantes.

## Direitos do cliente
- Cancelamento até 7 dias da data de pagamento e até a primeira assembleia (o que ocorrer primeiro) garante o reembolso integral.
- Desistência depois disso: o valor pago (fundo comum) é devolvido quando a cota é contemplada em sorteio ou no encerramento do grupo, conforme contrato.`,
    quiz: [
      { question: 'O que remunera a administradora no consórcio?', options: ['Juros sobre o saldo', 'A taxa de administração', 'O fundo de reserva'], correct: 1 },
      { question: 'Para que serve o reajuste anual do crédito e das parcelas?', options: ['Aumentar o lucro da administradora', 'Preservar o poder de compra da carta de crédito'], correct: 1 },
      { question: 'Na parcela reduzida, o que acontece depois da contemplação?', options: ['A diferença é perdoada', 'A diferença é diluída nas parcelas restantes'], correct: 1 },
    ],
  },
  {
    title: '3. Contemplação: sorteio e lances',
    category: 'lances',
    duration_min: 20,
    description: 'Sorteio, lance livre, fixo, embutido e fidelidade; como montar a estratégia de lance sem prometer resultado.',
    content: `## Formas de contemplação
- **Sorteio:** todo mês, em assembleia; todos os participantes em dia concorrem.
- **Lance livre:** o cliente oferta um percentual com recursos próprios (reserva, FGTS no imóvel, venda de bem); vence o maior percentual.
- **Lance fixo:** percentual definido pelo grupo; havendo mais de um, desempate por sorteio.
- **Lance embutido:** usa parte da própria carta de crédito para compor o lance (o crédito líquido diminui).
- **Lance fidelidade:** quando o plano oferece, vale a partir do mês indicado no quadro do plano. Em caso de inadimplência, a contagem é reiniciada.

## Como montar a estratégia
- Levante na R1 os **recursos para lance**: reserva, FGTS, bem para vender.
- Consulte o histórico de lances do grupo (média e mínimo vencedor) com a administradora.
- Considere **dividir o crédito em cotas** em grupos diferentes para ampliar as chances.
- Registre a estratégia na proposta e no pós-venda (estratégia de lance).

## O que nunca dizer
- "Com esse lance você é contemplado no mês X."
- "É certeza." Use sempre: "pelo histórico do grupo, lances a partir de X% têm sido vencedores; não há garantia".`,
    quiz: [
      { question: 'O lance embutido usa…', options: ['Recursos próprios do cliente', 'Parte do próprio crédito da cota'], correct: 1 },
      { question: 'Se o cliente atrasar parcelas depois de começar a contar o lance fidelidade…', options: ['Nada muda', 'A contagem é reiniciada'], correct: 1 },
    ],
  },
  {
    title: '4. Metodologia de reuniões Vero: R1, apresentação e follow-up',
    category: 'processo_comercial',
    duration_min: 20,
    description: 'Do primeiro contato à proposta: etapas do funil, objetivo de cada reunião e critérios para avançar.',
    content: `## O pipeline Vero (todas as áreas: consórcio, planejamento, seguros e investimentos)
- **0 Prospect · 1 Lead · 2 Tentativa de contato:** cadência de ligações, WhatsApp, e-mail e direct até falar com o lead.
- **3 Qualificação:** conversa feita, com **objetivo, valor estimado e prioridade** (curto, médio ou longo prazo); no consórcio, também a categoria.
- **4 R1 (reunião de diagnóstico):** 30 minutos por videochamada, sempre agendada pelo CRM. Agendar a R1 é o **Ganho** do pré-vendas.
- **5 R2:** apresentação da proposta e da estratégia (a R1 precisa estar concluída).
- **6 Negociação:** R2 realizada; proposta em análise até a decisão.
- **7 Venda:** preenchida sozinha quando o pagamento é confirmado.
- **Arquivados:** Nutrição futura (retomar depois) e Perdido (com o motivo MP1 a MP9).
- **Não compareceu (NS):** o cliente faltou à R1. O cartão fica na coluna R1 com a marca **NS** até você remarcar (marca **R**).

## A R1 em 4 blocos (30 minutos)
- **Conexão (5 min):** apresente-se e a Vero; combine a agenda da conversa.
- **Diagnóstico (12 min):** objetivo, prazo, crédito, parcela confortável, recursos para lance, quem decide.
- **Educação (8 min):** como funciona o consórcio e a contemplação, com transparência.
- **Próximo passo (5 min):** agende a apresentação da proposta antes de encerrar.

## Regras de ouro
- Toda R1 com o **modelo oficial** aberto pelo CRM (nome, foto e contato já preenchidos).
- Ao terminar: conclua a tarefa da R1 com o resultado e preencha a qualificação (ou anexe a transcrição).
- Proposta apresentada em até 48 horas depois da R1.`,
    quiz: [
      { question: 'O que é exigido para mover o lead para "Qualificação"?', options: ['Só o telefone', 'Objetivo, valor estimado e prioridade (e a categoria no consórcio)'], correct: 1 },
      { question: 'O cliente não compareceu à R1. O que acontece com o cartão?', options: ['Vai para Perdido', 'Fica na R1 com a marca NS até ser remarcado'], correct: 1 },
    ],
  },
  {
    title: '5. Modelo da R1: como abrir e conduzir',
    category: 'processo_comercial',
    duration_min: 10,
    description: 'O modelo único de R1 da Vero, com seus dados e os do cliente preenchidos automaticamente.',
    content: `## Onde encontrar
- Depois de agendar a R1, clique em **Abrir modelo da R1** (no aviso de confirmação, na tarefa da reunião, na Agenda ou no painel lateral do lead).
- O modelo abre com o **seu nome, foto, cargo e WhatsApp** (de Meu cadastro) e o **nome do cliente**. Mantenha Meu cadastro sempre completo.

## Como usar na reunião
- Compartilhe a tela no Google Meet e navegue rolando a página (um slide por vez).
- No slide **Diagnóstico**, clique nos campos para anotar as respostas durante a conversa.
- No fim, anote a estratégia sugerida e a data combinada para a apresentação da proposta.
- Para guardar, use Imprimir › Salvar como PDF (um slide por página).

## Importante
Não existe outro modelo de reunião: o modelo é o mesmo para toda a equipe e é atualizado pela Vero. Se tiver sugestões, envie ao seu líder.`,
    quiz: [],
  },
  {
    title: '6. Agendar a R1 no CRM e no Google Agenda',
    category: 'ferramentas',
    duration_min: 10,
    description: 'Pop-up único de agendamento: cliente, e-mail, horário de 30 minutos, Google Meet e convite automático.',
    content: `## Antes de tudo
Em **Meu cadastro › Google Agenda**, conecte a sua agenda (uma única vez). Assim cada R1 entra na sua agenda com link do Google Meet e o cliente recebe o convite por e-mail.

## Passo a passo
- Clique em **Agendar R1** (painel lateral do lead, ficha do cliente, negócio ou Agenda).
- Confira o cliente e o **e-mail** (é por ele que o convite chega; se o cadastro não tiver, informe no pop-up).
- Escolha a data e o horário de início. O término já vem 30 minutos depois; ajuste de 15 em 15 minutos se precisar.
- O título segue o padrão **[R1] Nome do cliente | Vero Consórcios**.
- Deixe marcada a videoconferência: o CRM gera o Meet, salva o link e envia o convite.
- Ao arrastar o card para **R1** (ou clicar em **Ganho** no painel do lead), o mesmo pop-up abre e o negócio muda de etapa ao salvar. Para a **R2**, arraste o card da R1 para a coluna R2.

## Depois de agendar
- Confirme com o cliente pelo botão **Confirmar pelo WhatsApp** (mensagem pronta com data, horário e link).
- Para remarcar ou cancelar, edite a tarefa da R1: o Google Agenda acompanha e avisa o cliente.`,
    quiz: [
      { question: 'Qual é a duração padrão da R1?', options: ['15 minutos', '30 minutos', '1 hora'], correct: 1 },
    ],
  },
  {
    title: '7. Follow-up de propostas: régua Dia 0 a Dia 21',
    category: 'processo_comercial',
    duration_min: 15,
    description: 'Régua de follow-up depois do envio da proposta, link rastreável e modelos de mensagem.',
    content: `## Régua de follow-up

Ao marcar a proposta como **apresentada** (ou ao enviar pelo botão do WhatsApp na guia Propostas), o CRM cria as tarefas da régua na sua agenda: **Dia 0, Dia 2, Dia 5, Dia 9, Dia 14 e Dia 21** (dias corridos; sábado e domingo passam para segunda). Cada tarefa traz o roteiro do contato e um modelo de mensagem.

- **Dia 0 · envio:** envie o link da proposta e confirme se o cliente conseguiu abrir.
- **Dia 2 · dúvidas:** retome o objetivo do cliente e esclareça parcela, prazo e contemplação.
- **Dia 5 · valor:** compare com a alternativa dele (financiamento, aluguel, aplicação).
- **Dia 9 · fechamento:** proponha o próximo passo concreto (cadastro para adesão).
- **Dia 14 · ajuste:** entenda o que trava e ofereça outro crédito, prazo ou parcela.
- **Dia 21 · decisão:** "{nome}, o projeto continua de pé? Se preferir, ajusto a proposta ou retomamos mais para frente."

## Link da proposta

O link on-line mostra a proposta no celular do cliente. Na guia Propostas você vê se ele ainda não abriu (**Aguardando**), quando abriu (**Lido**, com data e hora), quanto tempo ficou e quantas vezes acessou. Se ele clicar em **Quero avançar**, você recebe um aviso e uma tarefa de contato imediato: ligue na hora.

Proposta aceita encerra a régua e abre a pré-venda; recusada pede o motivo (e, se quiser, a data para retomar).`,
    quiz: [
      { question: 'Quando a régua de follow-up começa?', options: ['Quando a proposta é marcada como enviada ao cliente', 'Quando o lead entra no funil'], correct: 0 },
      { question: 'O que fazer quando o cliente clica em "Quero avançar" no link?', options: ['Esperar o próximo passo da régua', 'Ligar na hora: o CRM cria uma tarefa de contato imediato'], correct: 1 },
    ],
  },
];

module.exports = { TRAININGS };
