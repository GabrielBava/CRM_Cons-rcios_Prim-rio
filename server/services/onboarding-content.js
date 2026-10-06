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
    content: `## O funil Vero
- **Prospect / Lead → Tentativa de contato:** cadência de ligações e WhatsApp até falar com o lead.
- **Lead qualificado:** conversa feita, com **objetivo, categoria, crédito desejado e prazo** (curto, médio ou longo).
- **R1 (reunião de diagnóstico):** 30 minutos por videochamada, sempre agendada pelo CRM.
- **R1 bolo:** o cliente agendou e não compareceu. Entenda o motivo e reagende.
- **Negociação:** proposta montada no simulador com base na R1.
- **Follow-up:** proposta enviada; esteira D0 a D10 até a decisão.

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
      { question: 'O que é exigido para mover o lead para "Lead qualificado"?', options: ['Só o telefone', 'Objetivo, categoria, crédito desejado e prazo'], correct: 1 },
      { question: 'O cliente não compareceu à R1. Para onde vai o negócio?', options: ['Perdido', 'R1 bolo'], correct: 1 },
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
- O título segue o padrão **[R1] Nome do cliente / Vero Consórcios**.
- Deixe marcada a videoconferência: o CRM gera o Meet, salva o link e envia o convite.
- Ao arrastar o card de **Lead qualificado** para **R1**, o mesmo pop-up abre e o negócio muda de etapa ao salvar.

## Depois de agendar
- Confirme com o cliente pelo botão **Confirmar pelo WhatsApp** (mensagem pronta com data, horário e link).
- Para remarcar ou cancelar, edite a tarefa da R1: o Google Agenda acompanha e avisa o cliente.`,
    quiz: [
      { question: 'Qual é a duração padrão da R1?', options: ['15 minutos', '30 minutos', '1 hora'], correct: 1 },
    ],
  },
  {
    title: '7. Follow-up de propostas: esteira D0 a D+10',
    category: 'processo_comercial',
    duration_min: 15,
    description: 'Cadência de follow-up depois da apresentação da proposta e modelos de mensagem.',
    content: `## A esteira
Ao marcar a proposta como **apresentada**, o CRM cria as tarefas de follow-up na sua agenda: D0, D+1, D+2, D+3, D+5 e D+10. Cada tarefa traz o roteiro do contato.

## Modelos de mensagem
- **D0 · confirmar recebimento:** "Oi, {nome}! Conseguiu abrir a proposta? Qual foi a primeira impressão? Ficou alguma dúvida sobre parcela, prazo ou lance?"
- **D+1 · reforçar o objetivo:** "Bom dia, {nome}! Lembrando o que você quer conquistar: {objetivo}. A estratégia da proposta foi montada para isso. Posso explicar algum ponto?"
- **D+2 · cenários de lance:** "{nome}, separei os cenários de contemplação do grupo (sorteio, lance embutido, lance livre e FGTS). Quer que eu te mostre em 10 minutos?"
- **D+3 · fechamento:** "{nome}, faz sentido seguirmos? O próximo passo é o cadastro para a adesão, e a próxima assembleia é dia X."
- **D+5 · reforço de valor:** "{nome}, comparei com o financiamento e com o aluguel que você paga hoje. Posso te mandar os números?"
- **D+10 · decisão:** "{nome}, o projeto continua de pé? Se preferir, ajusto a proposta ou retomamos mais para frente."

## Registre tudo
Cada retorno do cliente deve ser registrado na proposta (**Registrar retorno**): isso atualiza a probabilidade de fechamento e os relatórios.`,
    quiz: [
      { question: 'Quando a esteira de follow-up começa?', options: ['Quando a proposta é marcada como apresentada', 'Quando o lead entra no funil'], correct: 0 },
    ],
  },
];

module.exports = { TRAININGS };
