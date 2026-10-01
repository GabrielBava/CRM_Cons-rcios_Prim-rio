# Especificação funcional: ERP/CRM de Consórcios Primários

Este documento descreve o que está **implementado** nesta versão e o que ainda depende de definição. Os itens seguem a lista de entrega pedida.

---

## 1. Telas e navegação

O menu lateral vira um menu recolhível no celular. A barra superior tem **busca global** (nome, telefone, e-mail, CPF/CNPJ, código `C-`, `OP-`, `PR-`, `SIM-`, `CT-` ou UID), o botão **+ Novo lead** e, no canto direito, o **sino de notificações** e o **menu do usuário** (foto, nome e cargo; Meu cadastro, Alterar senha e Sair). Detalhes na seção 14.

O menu lateral segue a estrutura de ERP do consórcio, com 17 itens. Os itens 14 a 17 ficam no grupo **Administração**. Cada usuário vê apenas os itens liberados para ele (seção 9).

| Item do menu | Conteúdo |
|---|---|
| **1. Painel inicial** | Leads recebidos, propostas em andamento (com o potencial ponderado pela chance de fechamento), vendas no mês, comissões a receber no mês, meta do mês (quanto falta e o ritmo por dia útil), agenda de hoje, funil por etapa, propostas que pedem atenção, ranking, aniversariantes e treinamentos pendentes. Traz também **ações sugeridas para hoje** (urgentes, leads sem contato, propostas com alta chance, pré-vendas paradas, vendas aguardando pagamento). O administrador e o líder podem ver por especialista. |
| **2. Prospects e leads** | Fila (administrador e líder) dos cadastros recebidos ainda sem especialista, por canal, com tempo de espera. Distribuição manual, pela **roleta** ou redistribuição (seção 13). |
| **3. CRM** | Funil em 10 etapas com regras de passagem (seção 3), lista de leads e prospects, ligações e atividades, importação. Cartões com nome, ID do cadastro, origem e valor das propostas; ordenação; ações em massa; painel lateral de consulta (seção 14). A ficha do cadastro e a página do negócio ficam aqui. |
| **4. Agenda e tarefas** | Visões **Hoje** (atrasadas, manhã, tarde, amanhã), **Semana** (calendário), **Urgentes** e **Lista completa**; filtros rápidos por R1, follow-up de proposta, revisar proposta, pré-venda, ligações e pós-venda; prioridade (normal, alta, urgente); indicadores do dia e rotina sugerida. |
| **5. Simulador** | Abre o simulador para uma simulação rápida (modo simulação). **Não emite proposta**: propostas nascem no item 6, a partir do cadastro do cliente. |
| **6. Propostas** | **Esteira de propostas** (Gerada, Enviada, D0, D+1, D+2, D+3, D+5, D+10, Aceitas e **Recusadas** com o motivo) e **Panorama geral** (cliente, valor, categoria, data, chance de fechamento, próximo follow-up e alertas). Seção 13. |
| **7. Clientes** | Código, nome, situação (ativo/inativo), contato, responsável pós-venda, especialista da venda, quantidade de cartas, crédito contratado, próxima ação e última atividade. Filtros: busca, situação, PF/PJ, responsável pós-venda, especialista e categoria (só imóvel, só veículo, só serviço ou mais de uma). O especialista vê só os seus; o administrador vê todos. Aba de produtos contratados e financeiro dos clientes. |
| **8. Metas** | Metas mensais de crédito e de número de vendas por especialista e por equipe, com realizado, quanto falta e ritmo por dia útil. |
| **9. Pré-venda** | Do aceite da proposta até o boleto: link de cadastro, acompanhamento (gerada, enviada, acessada, concluída), alertas de pré-venda parada e etapas da adesão. |
| **10. Vendas** | Vendas com ID único (`VD-`), aguardando pagamento até a confirmação com comprovante. |
| **11. Pós-venda** | Depois do pagamento: checklist de cada cliente, satisfação (NPS) com alertas, histórico e motivos de insatisfação, e estratégias de lance com histórico (seção 14). |
| **12. Comissões e cancelamentos** | Comissões do mês (o especialista vê só as suas), cancelamentos com motivo e responsável, e o índice de cancelamento por especialista. |
| **13. Treinamentos** | Materiais em PDF, vídeo, link ou texto por tema, com questionário e acompanhamento da equipe. |
| **14. Administradoras** | Somente administrador: identificação, contatos, portal, política de repasse e tabela de comissão. |
| **15. Planos** | Condições de cada plano por administradora e faixa de crédito com incremento. |
| **16. Relatórios** | Relatórios com "Como é calculado" e exportação CSV. |
| **17. Usuários** | Usuários, equipes com líder, perfis e liberação de telas por usuário. |
| Configurações | Etapas e regras do funil, listas, campos, integrações, parâmetros gerais (inclusive o site para onde o usuário vai ao sair e o responsável pós-venda padrão) e auditoria. |

## 2. Campos de cada cadastro

**Campos básicos (cadastro rápido).** Só o **nome** é obrigatório:

- ID único automático: código `C-000001` e UID;
- data e hora de criação;
- nome;
- tipo PF/PJ;
- telefone principal e secundário;
- e-mail;
- cidade e UF;
- empresa ou nome fantasia;
- CPF/CNPJ (opcional, com validação dos dígitos);
- responsável;
- origem;
- campanha;
- data do primeiro contato;
- observações iniciais;
- dados de campanha digital (plataforma, ID do lead, da campanha, do conjunto e do anúncio, data de recebimento e UTMs).

Os campos **recomendados** aparecem destacados. Um aviso lista o que falta completar.

**Pessoa física:**

- nome completo;
- CPF;
- data de nascimento;
- e-mail, telefone e WhatsApp;
- cidade e UF;
- profissão ou atividade;
- preferências (canal, melhor horário, telefone preferencial, frequência, restrição, data e origem da preferência);
- consentimentos e oposições;
- observações.

**Pessoa jurídica:**

- razão social e nome fantasia;
- CNPJ;
- inscrição estadual;
- segmento;
- porte ou faixa;
- cidade e UF;
- site;
- **contatos vinculados** (nome, cargo, e-mail, telefone, WhatsApp, principal, preferências, oposições, observações), cada um com histórico próprio e sempre ligado à empresa.

**Configurável:** o administrador pode ocultar campos padrão desnecessários (minimização de dados), definir quais são recomendados e criar **campos adicionais** (texto, número, data, lista, sim/não) para cadastros e oportunidades.

**Estados separados:**

- relacionamento: `prospect`, `lead`, `cliente`;
- status do lead: `novo`, `em contato`, `qualificado`, `desqualificado`, `em nutrição`, `convertido`;
- status do cliente: `ativo`, `inativo`;
- status da oportunidade: `aberta`, `ganha`, `perdida`, `pausada`;
- status da proposta e status da simulação têm seus próprios valores.

## 3. Etapas do funil e regras de movimentação

O funil tem 10 etapas, nesta ordem:

1. **Prospect**: contato ainda sem interesse demonstrado
2. **Lead**: demonstrou interesse (um lead já entra aqui)
3. **Tentativa de contato**
4. **Lead qualificado**
5. **R1**: reunião de diagnóstico agendada
6. **Negociação**
7. **Follow-up**: proposta enviada
8. **Venda** (tipo ganho)
9. **Nutrição futura** (tipo nutrição)
10. **Perdido** (tipo perda)

**Regras de passagem (modelo Pipedrive).** O negócio só entra numa etapa quando cumpre os critérios dela, verificados no servidor:

| Etapa | Critérios padrão para entrar |
|---|---|
| Lead | Telefone, WhatsApp ou e-mail cadastrado; origem informada |
| Tentativa de contato | Ao menos uma tentativa de contato registrada |
| Lead qualificado | Conversa efetiva registrada; qualificação (objetivo, crédito, parcela possível e prazo) |
| R1 | R1 agendada (tarefa de reunião) |
| Negociação | R1 realizada; dados da R1 (quem decide, momento financeiro, produtos que já possui) |
| Follow-up | Proposta registrada e enviada ao cliente |
| Venda | Venda com pagamento confirmado |

- A passagem é **sequencial**: não é possível pular etapas. O administrador pode forçar, com justificativa, e a passagem fica registrada na auditoria como "etapa forçada".
- **Venda** só é alcançada pela confirmação do pagamento em Vendas (aceite → pré-venda → boleto → pagamento). Não se arrasta um negócio para Venda.
- Voltar etapas é permitido, com motivo.
- **Perdido** exige motivo (lista configurável). **Nutrição futura** exige o motivo e a data para retomar o contato, e cria a tarefa de retorno.
- A página do negócio mostra o cartão **"Para avançar para…"** com os critérios cumpridos e pendentes e o roteiro (playbook) da etapa.
- Em Configurações › Etapas do funil, o administrador marca os critérios de cada etapa, liga ou desliga a passagem sequencial, e define o roteiro e os dias para considerar o negócio parado em cada etapa.
- Cada movimentação grava a etapa anterior, a nova etapa, o usuário, a data, o tempo na etapa anterior e o motivo.
- A venda transforma o cadastro em **cliente** sem perder histórico.

## 4. Estrutura dos registros e vínculos

```
Usuário ──┬─< Cadastro (PF/PJ) ──< Contato da empresa (PJ)
Equipe ───┘        │
                   ├─< Origem (campanha, IDs da plataforma, UTM)   — várias entradas, sem duplicar o cadastro
                   ├─< Consentimento/oposição (histórico) ; Solicitação do titular (LGPD)
                   ├─< Atividade (linha do tempo) ─ opcional: oportunidade, contato da empresa, evento da discadora
                   ├─< Tarefa ─ opcional: oportunidade
                   ├─< Oportunidade ──< Histórico de etapas
                   │        ├─< Simulação ──< Versões ; Link do simulador (token)
                   │        └─< Proposta (v1 → v2 → …, cadeia por "versão anterior")
                   └─< Produto contratado (contrato) ─ opcional: oportunidade, proposta
Auditoria: toda criação ou alteração relevante (quem, quando, antes → depois)
```

- Todos os registros têm ID interno e **código legível** (`C-`, `OP-`, `SIM-`, `PR-`, `CT-`). Cadastros e oportunidades também têm **UID** para integrações.
- Todo registro guarda criador, responsável, data de criação e data da última alteração.
- Um cliente pode ter várias oportunidades, propostas e produtos. Um contrato novo **nunca** sobrescreve um anterior.
- Observações são **acrescentadas** à linha do tempo, e o histórico não é apagado.

## 5. Registro manual e automático de ligações

**Manual (disponível agora).** Botão "Registrar atividade":

- tipos: ligação realizada, tentativa sem atendimento, ligação recebida, mensagem enviada ou recebida, e-mail enviado ou recebido, conversa presencial ou por vídeo, reunião realizada, observação;
- data e hora;
- resultado (lista configurável);
- duração (mm:ss);
- canal;
- oportunidade e contato da empresa;
- observação;
- próxima ação e data de retorno (esta cria uma tarefa).

O registro manual segue estas regras:

- Atividades registram fatos passados. Ações futuras são tarefas.
- Contatos ativos (ligação, mensagem ou e-mail enviados) são **recusados** quando o cadastro ou o contato da empresa tem oposição ao canal.
- A primeira tentativa muda o lead de "novo" para "em contato" e registra a data do primeiro contato. O primeiro contato efetivo muda o relacionamento de prospect para lead.

**Automático (discadora).** Recebido por webhook, com mapeamento configurável e ID externo para idempotência. O lead é vinculado pelo ID ou pelo telefone. Eventos sem vínculo entram em uma fila de conferência, com vínculo manual, reprocessamento e descarte. Os erros ficam registrados. O resultado nunca é presumido. A origem aparece como "via discadora". Detalhes em [`INTEGRACOES.md`](INTEGRACOES.md).

## 6. Fluxo do simulador

1. "Criar simulação para este lead" gera um token temporário de uso restrito a um único lead e abre `URL?crm_token=…`.
2. O simulador consulta o contexto de pré-preenchimento (nome, telefone, e-mail, tipo de pessoa, IDs do lead e da oportunidade, interesse). **O contexto não inclui CPF nem CNPJ.**
3. O consultor completa o plano no simulador.
4. O simulador envia o resultado. O CRM valida o token e o vínculo com o lead e a oportunidade.
5. O CRM grava a simulação:
   - código e ID externo;
   - data;
   - lead e oportunidade;
   - usuário;
   - crédito, prazo e parcela;
   - modalidade e estratégia;
   - link de consulta;
   - status;
   - **versão** (as anteriores ficam no histórico).
6. A simulação aparece na linha do tempo e permite "Gerar proposta", com os dados pré-preenchidos.

Enquanto o simulador não estiver integrado, o botão aparece desativado com a etiqueta "Integração pendente", e o consultor pode **registrar a simulação manualmente**.

## 7. Relatórios e indicadores

Todos os relatórios aceitam filtros de período, usuário, origem, etapa, produto e status. Cada relatório exibe a própria definição e pode ser exportado em CSV.

| Relatório | Definição resumida |
|---|---|
| Leads por origem | Cadastros criados no período por origem. Conversão = cadastros com venda ÷ leads do grupo. |
| Leads por campanha | Entradas de origem no período por campanha e plataforma. Conversão = cadastros com venda ÷ cadastros distintos. |
| Ligações e tentativas | Por dia: tentativas, efetivas, sem atendimento, recebidas, via discadora ou manual, duração média. Também traz uma tabela por resultado. |
| Taxa de contato | Por tentativa = efetivas ÷ tentativas. Por lead = leads com contato efetivo ÷ leads tentados. Os resultados "efetivos" são configuráveis. |
| Reuniões | Agendadas (criadas no período), com data no período, realizadas, não comparecimento, remarcadas, canceladas. Comparecimento = realizadas ÷ (realizadas + não compareceu). |
| Simulações e propostas | Por mês: simulações (manuais ou do simulador), propostas (1ª versão), novas versões, apresentadas, aprovadas, recusadas, expiradas. |
| Conversão entre etapas | Coorte de oportunidades criadas no período. "Atingiu" = chegou à etapa ou a uma posterior. Conversão para a próxima etapa e conversão acumulada. |
| Vendas concluídas | Oportunidades ganhas no período, com crédito e contratos. |
| Motivos de perda | Perdas no período por motivo, com participação e crédito perdido. |
| Tempo médio por etapa | Média do tempo na etapa, considerando as saídas no período, mais a idade atual das oportunidades em cada etapa. |
| Pendências | Oportunidades sem próxima ação, com ação vencida ou paradas, e tarefas atrasadas por responsável. |
| Resultado por usuário | Leads novos, tentativas, efetivas, taxa, reuniões realizadas, simulações, propostas, vendas, crédito, conversão da coorte. |

Os relatórios mostram dados pessoais apenas quando necessário (nome e código). Telefone e e-mail não aparecem nos relatórios.

## 8. Integrações implementadas e pendentes

| Integração | Implementado no CRM | Pendente |
|---|---|---|
| Discadora | Webhook, token, mapeamento de campos e resultados, idempotência, fila sem vínculo, reprocessamento, testador de mapeamento, lista exportável | Escolha do fornecedor, mapeamento real, validação com eventos reais |
| Simulador | Link com token temporário, endpoint de contexto, endpoint de retorno com validação e versionamento, registro manual | Implementar no simulador a leitura do `crm_token`, a chamada de contexto e o envio do resultado. Configurar a URL. |
| Meta Ads | Campos de origem (IDs e UTMs), importação CSV, API de entrada de leads com deduplicação | Conector direto (app Meta, webhooks, Graph API) ou ferramenta intermediária |
| WhatsApp | Endpoint de registro de mensagens com idempotência e vínculo por telefone | Provedor. **Envio** de mensagens não faz parte desta versão. |
| Agenda externa (Google Agenda / Outlook) | Cadastro da integração com status "pendente" | Sincronização das reuniões e tarefas |
| Pesquisa de NPS por link | Link para o cliente responder, histórico, cancelamento justificado e tarefa para detratores | — |
| Simulador de propostas | "Gerar proposta" abre o simulador com nome e contato do cliente (endereço configurável em Configurações › Geral) | Retorno automático da proposta gerada para o CRM; valores da simulação no CRM |
| Consulta de CEP (ViaCEP) | Busca do endereço pelo CEP na ficha e na página do cliente. Se a consulta falhar, o endereço é preenchido manualmente. | — |
| Importação/exportação | CSV (`;` ou `,`) com mapeamento, prévia, deduplicação e erros por linha. Exportação CSV compatível com Excel. | Leitura direta de `.xlsx` (hoje é preciso salvar como CSV) |

## 9. Permissões

As permissões são verificadas **no servidor** em todas as consultas e alterações, não apenas escondendo botões. O modelo segue os ERPs de mercado:

- o **perfil** define quais registros o usuário enxerga (escopo de dados);
- os **módulos** definem quais telas ele acessa. Cada perfil tem um conjunto padrão, e o administrador pode **incluir ou retirar telas** de um usuário específico em Usuários, sem mudar o escopo de dados. Usuários e Configurações são sempre exclusivos do administrador.

| Perfil | Escopo de dados | Telas padrão |
|---|---|---|
| Administrador | Todos os registros e todas as funções | Todas |
| Líder de equipe | Registros da própria equipe e leads sem responsável; distribui leads na equipe; acompanha metas, comissões e cancelamentos do time; registra cancelamentos | Comerciais + Prospects e leads + Relatórios |
| Especialista | Só os próprios leads, clientes, propostas, vendas e comissões | Painel, CRM, Agenda, Simulador, Propostas, Clientes, Metas, Pré-venda, Vendas, Pós-venda, Comissões, Treinamentos |
| Somente leitura | Consulta os registros da equipe, sem editar nem exportar dados pessoais | Painel, CRM, Clientes, Propostas, Pós-venda, Treinamentos |

**Exportação em CSV** é exclusiva do administrador (verificada no servidor). A lista para a discadora continua disponível para líderes e especialistas. Transferir negócios entre responsáveis é permitido ao administrador e ao líder (dentro da equipe).

A aba **Perfis e permissões** (Usuários) mostra essa matriz. Um líder sem equipe vê apenas os próprios registros. Quando um especialista tenta cadastrar alguém que já pertence a outro responsável, ele recebe o alerta de duplicidade **sem ver os dados** do cadastro.

## 10. Segurança e prevenção de duplicidade

**Duplicidade**

- Antes de criar ou alterar um cadastro, o CRM verifica telefone (normalizado, com ou sem +55), e-mail, CPF e CNPJ, inclusive nos contatos das empresas.
- Havendo coincidência, o usuário pode abrir o cadastro existente ou confirmar "Criar mesmo assim". A confirmação fica registrada na auditoria.
- A **mesclagem** (gestor ou administrador) move atividades, oportunidades, propostas, simulações, origens, consentimentos, tarefas e contratos. Ela completa os campos vazios do cadastro de destino e soma as oposições a contato. O cadastro de origem fica marcado como mesclado.
- Nas integrações, a idempotência usa o ID externo, com índices únicos no banco: chamada da discadora, lead da plataforma, mensagem do WhatsApp e simulação.

**Segurança**

- Senhas armazenadas com scrypt.
- Sessão em cookie HttpOnly e SameSite=Lax, com renovação e expiração.
- Bloqueio temporário após 5 tentativas de login.
- Proteção CSRF por cabeçalho próprio.
- CSP restritiva, `X-Frame-Options: DENY` e `Referrer-Policy: no-referrer`.
- Tokens de integração guardados apenas como hash.
- Token do simulador aleatório, temporário, restrito a um lead, armazenado como hash e revogado na anonimização.

**Privacidade (LGPD)**

- Campos desnecessários podem ser ocultados.
- CPF e CNPJ são mascarados em listas e buscas.
- Preferências e consentimentos ficam registrados com data e origem.
- A oposição bloqueia contatos ativos e retira o cadastro da lista da discadora.
- Solicitações do titular (acesso, correção, oposição, eliminação, portabilidade) são registradas com resolução.
- A **anonimização** (administrador, com motivo) remove dados pessoais e preserva os indicadores.
- O link da gravação e o texto das mensagens só são guardados se a opção estiver habilitada.
- Exportações ficam registradas na auditoria.
- O CRM não armazena dados de cartão ou conta bancária. Os documentos enviados (identificação, comprovantes, contrato social) ficam no banco, com acesso restrito ao escopo do usuário, e o conteúdo é apagado quando o documento é removido ou o cadastro é anonimizado.
- O link para o cliente e o link da pesquisa são aleatórios, temporários e guardados como hash. Enquanto estão ativos, o endereço também fica disponível para a equipe copiar; ele é apagado quando o link é revogado, expira, é respondido (pesquisa) ou o cadastro é inativado. O link de cadastro só permite alterar os campos externos (cadastro, endereço e documentos).

## 11. Campos e regras que ainda dependem de definição

1. **Discadora:** fornecedor, formato do payload, códigos de resultado, identificação dos agentes e política de guarda das gravações.
2. **Simulador:** URL, implementação dos dois endpoints do lado do simulador, lista oficial de modalidades e estratégias do simulador (hoje são texto livre no retorno) e prazo de validade desejado para o link.
3. **Meta Ads:** conexão direta ou uso de ferramenta intermediária, formulários e campos do Lead Ads, responsável padrão dos leads recebidos.
4. **WhatsApp:** provedor, se o texto das mensagens será armazenado e se haverá envio a partir do CRM (exige regras de consentimento e modelos aprovados).
5. **Administradoras e planos:** cadastrar as administradoras, planos e tabelas de comissão reais (a demonstração usa dados fictícios).
6. **Critérios comerciais:** critério formal de lead qualificado, resultados que contam como "contato efetivo" (o padrão é Atendida, Contato realizado e Retorno solicitado) e prazo para considerar um lead parado (padrão de 7 dias).
7. **Estrutura da equipe:** equipes, líderes, participantes e pesos da roleta, e se a roleta automática deve ser ligada para os leads recebidos pelas integrações.
8. **LGPD:** base legal por finalidade, prazo de retenção e rotina de eliminação, encarregado (DPO) e texto de consentimento nos formulários de captação.
9. **Status de contrato e pós-venda:** valores definitivos (hoje: em formalização, ativo, contemplado, quitado, cancelado). As etapas do checklist de pós-venda podem ser ajustadas em Configurações › Listas.
11. **Agenda externa:** escolha entre Google Agenda e Outlook.
12. **Simulador:** retorno automático da proposta para o CRM (hoje a proposta é criada no CRM ao clicar em "Nova proposta" e os valores são registrados manualmente) e bloqueio da emissão de proposta no modo simulação do lado do simulador.
13. **E-mail automático (SMTP):** o link da pré-venda é enviado pelo WhatsApp ou pelo programa de e-mail do especialista; o envio direto pelo CRM depende de configurar um serviço de envio.
14. **Boleto e assinatura:** emissão do boleto e assinatura do contrato continuam nos sistemas da administradora; o CRM registra as datas e o comprovante.
10. **Hospedagem:** servidor, HTTPS, backup e política de acesso externo.

## 12. Módulo ERP: ficha em 9 blocos, financeiro, pré-venda e pós-venda

Implementa a ficha aprovada na página de proposta (`docs/proposta-ficha/index.html`). Os campos marcados como **externos** podem ser atualizados pelo próprio cliente por link. Os **internos** são só da empresa. Sempre que possível, os campos são listas configuráveis (Configurações › Listas) para alimentar indicadores.

| Bloco | Tipo | Conteúdo |
|---|---|---|
| 1. Cadastro | Externo | PF: nome, CPF, RG, data de nascimento, naturalidade, nacionalidade, sexo, estado civil, regime de bens (casado ou união estável), nome da mãe, profissão, faixa de renda e de patrimônio. PJ: razão social, nome fantasia, CNPJ, IE, data de abertura, atividade, faixa de faturamento e representante legal. Campos com a marca **venda** são exigidos para concluir a venda. |
| 2. Origem | Interno | Origem, campanha, UTMs, **indicado por** (vínculo com outro cadastro, com lista de indicações feitas) e **temperatura** (fria, morna, quente). |
| 3. Endereço | Externo | Vários endereços (residencial, comercial, correspondência, cobrança), um principal, com observação. Ao digitar o CEP o endereço é buscado automaticamente; se não for localizado, o preenchimento é manual. |
| 4. Negócio | Interno | Qualificação da primeira reunião: objetivo, tipo de produto (primário ou contemplada, no mesmo funil), finalidade do crédito, prazo, momento financeiro, tipo de contratação, FGTS, **quem decide a compra**, produtos que já possui. Consórcio: valor e administradora. Financiamento: saldo devedor, CET e banco. |
| 5. Financeiro | Interno | Parcelas e demais valores que o cliente paga. Situações: a vencer, pago, negociado, cancelado e **em atraso** (calculado). Geração de parcelas a partir do contrato. Pendências financeiras. |
| 6. Propostas | — | "Gerar simulação" registra apenas a data, a hora e quem gerou (sem simulação manual). "Gerar proposta" abre o simulador de propostas com o nome completo e o contato do cliente preenchidos; a proposta gerada é registrada com link e anexo. Aprovar exige o **canal e a data do aceite** e abre a **pré-venda** (seção 13). Recusar exige o **motivo da recusa** (lista). |
| 7. Agenda e tarefas | Interno | Tarefas e reuniões. Novos tipos: pré-venda e financeiro. Sincronização com agenda externa: **integração pendente**. |
| 8. Produtos contratados | Externo | Lançados somente na conclusão da venda (não há cadastro avulso na ficha). Lista com categoria (Imóvel, Veículo, Serviço), administradora e grupo/cota. Contrato: nº na administradora, grupo e cota, valor da parcela, dia de vencimento, primeira parcela, **vendedor** e **valor da venda**, contemplação (data, tipo, lance e bem adquirido). |
| 9. Histórico | — | Linha do tempo com filtro por **fase**: pré-venda (antes da primeira proposta), venda (depois da primeira proposta) e pós-venda (depois da conversão em cliente). |

**Cabeçalho da ficha.** Ao lado do nome aparece só PF ou PJ. Abaixo, cartões com ID, tipo (prospect, lead ou cliente), status (ativo ou inativo), responsável, origem, valor em oportunidades em andamento e a marca de indicação. Botões: Registrar atividade, Nova tarefa, Novo negócio, Link cadastro e Gerar proposta. O menu lateral acompanha o tipo do registro (cliente em "Clientes"; prospect e lead em "Prospects e leads"). No resumo, o botão do WhatsApp abre a conversa com o cliente, e o cartão exibido é o de pré-venda (prospect e lead) ou o de pós-venda (cliente).

**Status ativo/inativo.** Inativar pede um motivo opcional, revoga automaticamente o link de cadastro e impede gerar link ou pesquisa até reativar. Para clientes, o status do cliente acompanha esse campo.

**Relacionamentos.** PF: dados do cônjuge (nome, CPF, profissão, renda), exibidos quando o estado civil pede. PJ: sócios (nome, CPF, participação, relação) e contatos da empresa.

**Documentos.** Os obrigatórios são enviados pela própria lista: o formulário pede só o arquivo (obrigatório), a venda vinculada, a validade e a observação. Um anexo pode valer para mais de uma venda (negócio) do cliente. "Anexar arquivo" oferece apenas os tipos que não são obrigatórios, para não haver sobreposição. Arquivos anexados pela equipe entram aprovados; os enviados pelo cliente pelo link ficam "aguardando validação" até o vendedor abrir em "Verificar" e aprovar ou reprovar (com motivo). Só documentos aprovados e dentro da validade contam para a venda. Situações: pendente, aguardando validação, aprovado, reprovado, vencido ou removido. A lista exigida para PF e para PJ é definida em Configurações › Geral. Padrão PF: identificação, comprovante de endereço, comprovante de renda e comprovante de estado civil. Padrão PJ: contrato social, cartão CNPJ, comprovante de endereço, faturamento e documento do representante.

**Checklist de venda (pré-venda).** A pré-venda só pode ser conferida pela equipe (e o cliente só conclui o cadastro pelo link) com a ficha completa: campos marcados como obrigatórios na venda (Configurações › Campos), endereço principal completo, dados do cônjuge e regime de bens quando aplicável, e documentos exigidos recebidos ou aprovados. O CRM informa exatamente o que falta. A regra pode ser desligada em Configurações › Geral.

**Pré-venda.** Tela com o percentual da ficha, as pendências agrupadas (cadastro, relacionamentos, endereço, documentos) e o atalho para completar cada item.

**Link para o cliente.** Só existe um link ativo por cadastro: enquanto ele vale, o botão "Link cadastro" mostra o link para copiar (sem gerar outro). Depois de revogado, com o cadastro ativo, é possível gerar um novo. A ficha mostra quando o link foi gerado e por quem, o primeiro e o último acesso do cliente, a quantidade de acessos e de envios, e o histórico de links. Na ficha, o botão "Link cadastro" gera um endereço (`#/ficha/<token>`) que o cliente abre sem login para conferir e atualizar cadastro, endereço (com busca por CEP) e documentos. Cada envio fica no histórico com a origem "cliente" e cria a tarefa "Conferir dados atualizados pelo cliente" para o responsável. O link expira no prazo configurado (1 a 60 dias) e pode ser revogado.

**Financeiro.** Quem paga é sempre o cliente, e a empresa acompanha para avisar. Parcelas vencidas e não pagas aparecem em atraso na ficha, no menu Financeiro e no painel ("Parcelas em atraso"). Cada atraso gera uma tarefa do tipo financeiro para o **responsável financeiro** definido em Configurações › Geral (ou para o responsável pelo cliente). A tarefa é concluída automaticamente quando a parcela é paga, negociada ou cancelada. Relatórios: **Financeiro** (previsto, recebido, em atraso e adimplência por mês de vencimento) e **Vendas por vendedor**.

**Pós-venda.** Checklist por cliente com etapas configuráveis: 1ª parcela confirmada, onboarding, cadastro de estratégia de lance (marcado automaticamente ao salvar a estratégia), cadastro de recebimento de boletos e pedido de indicação.

**Pesquisa de satisfação (NPS) por link.** A equipe gera o link (`#/nps/<token>`, validade configurável) e o cliente responde, sem login, a nota de 0 a 10 e quatro avaliações de 1 a 5 (atendimento, clareza, agilidade e confiança), com comentário opcional. O histórico mostra cada pesquisa com a data de geração, quem gerou, o acesso do cliente, a situação (aguardando resposta, respondida, expirada ou cancelada) e as respostas. Só existe uma pesquisa pendente por vez. Pesquisas nunca são excluídas: são canceladas com justificativa obrigatória. Notas de 0 a 6 criam uma tarefa de pós-venda para o responsável.

**Estratégia de lance por produto.** Para cada produto contratado (com categoria, administradora, grupo/cota e crédito): se vai ofertar lance e o tipo (embutido, fixo ou livre). No lance livre, informa-se o percentual e se usará o lance embutido e o FGTS.

**Itens recusados na aprovação** (não implementados): PEP, evento de origem, página de conversão, responsáveis por fase, checklist de FGTS, transcrição automática da R1 e visões adicionais da agenda.

## 13. Módulo ERP: prospects, propostas, pré-venda, vendas, comissões, metas e treinamentos

**Prospects e leads (distribuição).** Cadastros recebidos sem especialista (integrações, importação ou cadastro do administrador) entram na fila, com canal, tempo de espera e totais das últimas 24 horas e 7 dias. O administrador ou o líder distribui manualmente, pela **roleta** ou redistribui. A roleta tem dois modos: sequencial com peso (1 a 5) ou para quem tem a menor carteira. Pode filtrar participantes por canal e ser automática para os leads recebidos pelas integrações. Cada distribuição cria a tarefa "Primeiro contato" com prazo configurável (padrão de 1 hora; recomendação de mercado: primeiro contato em até 5 minutos) e fica no histórico.

**Propostas.** Toda proposta nasce do cadastro do cliente (ID), que precisa ter nome e telefone ou WhatsApp. "Nova proposta" cria o registro e abre o simulador já com o nome e o contato. Ao marcar a proposta como **enviada ao cliente**, o CRM cria a **esteira de follow-up** em dias úteis (horário de Brasília):

| Passo | Quando | Objetivo |
|---|---|---|
| D0 | Fim do mesmo dia (só se enviada até 13h) | Confirmar o recebimento e tirar dúvidas |
| D+1 | 10h | Tirar dúvidas e reforçar o objetivo |
| D+2 | 10h | Cenários (lance, prazo, parcela) |
| D+3 | 10h | Prova social e urgência real |
| D+5 | 10h | Nova condição ou ajuste |
| D+10 | 10h, prioridade alta | Decisão: fechar, nova versão, nutrição ou perdido |

A resposta do cliente (positiva, dúvidas, sem resposta, negativa) é registrada; a negativa cria a tarefa "Revisar proposta". A **recusa** exige o motivo (lista de mercado: não é o momento, parcela, prazo, crédito, taxa de administração, insegurança com a contemplação, preferiu financiamento, concorrente, decisor não aprovou, renda, parou de responder, desistiu, outro), com detalhe opcional e data para **retomar o contato** (gera a tarefa). Os motivos marcados como recuperáveis e o resumo "Motivos de recusa" formam a base para um trabalho de recuperação (closer). A **chance de fechamento** (5 a 95%) considera temperatura do lead, R1 realizada, decisor definido, parcela dentro da capacidade, resposta do cliente, follow-ups em dia e tempo sem decisão, e gera a classificação alta, média ou baixa e o **potencial ponderado**. Alertas: follow-up atrasado, validade vencendo ou vencida, e mais de 10 dias sem decisão. Aceite, recusa ou expiração encerram a esteira. O aceite abre a pré-venda.

**Pré-venda.** Aberta automaticamente no aceite da proposta (ou manualmente). Na **primeira venda** do cliente, gera o link da **Ficha Cadastral do Participante**, enviado por WhatsApp ou e-mail com uma mensagem pronta. A página do cliente traz instruções passo a passo, o aviso de privacidade (LGPD), a concordância e o botão **Concluir cadastro**, que só funciona com a ficha e os documentos completos. Clientes com venda anterior pulam o link (dados já cadastrados, só conferência).

Etapas: link gerado → acessado pelo cliente → concluído pelo cliente → conferido pela equipe → termo de adesão (plano e crédito, validados pela faixa e incremento do plano) → contrato enviado → contrato assinado → boleto emitido (a venda é registrada e aguarda o pagamento). A tela acompanha geradas, enviadas, acessadas, concluídas e **paradas**: sem acesso ou sem conclusão depois de 24 horas (configurável), o CRM cria a tarefa **urgente** "Revisar pré-venda" para o especialista.

**Vendas.** Cada venda tem um ID único (`VD-000001`) com plano, administradora, cliente, crédito, nº e data da adesão e boleto. Fica **aguardando pagamento** até o especialista anexar o comprovante e confirmar. A confirmação:

- lança o produto contratado na ficha do cliente;
- move o negócio para Venda;
- gera as comissões;
- registra o canal e o horário preferidos do cliente;
- cria a tarefa de **onboarding**.

A venda pode ser cancelada antes do pagamento, com motivo.

**Comissões.** Tabela em parcelas por administradora (o plano pode ter tabela própria), em % do crédito. Exemplo: 0,3% no mês da venda, liberada se a cota não for cancelada em 7 dias, depois 0,1% + 0,1% + 0,1% = 0,6%. Cada parcela fica **prevista** durante a carência e até o mês de competência, depois **liberada**, e o administrador marca como **paga**. O especialista vê só as suas: a receber no mês, liberado, pago, estornos e previsão dos próximos 3 meses.

**Cancelamentos.** Registrados pelo líder ou administrador, com motivo da lista, descrição concreta (mínimo de 10 caracteres) e **especialista responsável**. As parcelas ainda não pagas são canceladas, e as já pagas geram **estorno** para o responsável, conforme a política da administradora (estornar ou não, e até quantos dias após a venda). O **índice de cancelamento** por especialista (cancelamentos ÷ vendas, últimos 12 meses, com os cancelados em até 7 dias) entra em alerta a partir de 10%, para desestimular vendas "empurradas".

**Metas.** O administrador cadastra, por mês, a meta de crédito e de número de vendas por especialista e por equipe (se a meta da equipe ficar em branco, vale a soma das individuais). Pode copiar as metas do mês anterior. O realizado considera as vendas com pagamento confirmado no mês. O painel mostra o progresso, quanto falta e o ritmo necessário por dia útil.

**Treinamentos.** O administrador publica materiais (PDF de até 15 MB, vídeo do YouTube ou Vimeo incorporado, link ou texto) por tema: fundamentos, lances, FGTS, cálculos, processo comercial, administradoras, compliance e LGPD, ferramentas. Cada material pode ser **obrigatório por perfil**, com prazo e questionário com nota mínima (o gabarito não é enviado a quem faz o treinamento). A equipe vê o progresso; o administrador acompanha acessos, conclusões e notas de cada usuário.

**Administradoras.** Somente o administrador vê e edita. Campos:

- ID (`ADM-`), nome, CNPJ e site;
- contatos: direto, comercial e gerente de conta;
- portal: endereço e usuário de acesso. **Senhas não são guardadas**;
- repasse: dia, forma, regras e tabela opcional;
- tabela de comissão do especialista e política de estorno.

Os demais perfis veem só o nome, para escolher o plano.

**Planos.** Por administradora:

- taxa de administração, fundo de reserva, seguro;
- prazo e prazos alternativos;
- lance embutido (base %), lance fixo (%), adesão (% e meses de diluição);
- índice de reajuste: pré-fixado 5% ou 6%, IPCA, INCC, INPC ou outro;
- **faixa de crédito com incremento**. Exemplo: HS de R$ 100 mil a R$ 180 mil de 10 em 10 mil, de 5 em 5 mil, ou valor livre. A faixa é validada na proposta e no termo de adesão;
- tabela de comissão própria (opcional).

## 14. Menu do usuário, notificações, CRM, clientes e pós-venda

**Menu do usuário (topo à direita).** Foto (ou iniciais), nome e cargo. Opções: **Meu cadastro**, **Alterar senha** e **Sair**. Ao sair, o usuário vai para o site da empresa definido em Configurações › Geral (em branco, volta para a tela de login). O bloco de usuário e o botão Sair saíram do canto inferior esquerdo.

**Meu cadastro.** O próprio usuário mantém:

- foto do perfil (recortada e reduzida no navegador);
- nome, telefone, WhatsApp comercial e data de nascimento;
- cargo, registro ou certificação e especialidades (imóvel, veículo, serviço);
- apresentação para os clientes;
- chave PIX para o pagamento das comissões.

E-mail de acesso, perfil e equipe ficam com o administrador. A tela mostra o último acesso, a data da última troca de senha e as sessões ativas.

**Alterar senha.** Senha atual (com botão de olho para mostrar), nova senha e confirmação. Regras verificadas no navegador e no servidor:

- pelo menos 8 caracteres;
- letras e números;
- sem o nome ou o e-mail;
- diferente da atual;
- fora da lista de senhas comuns.

Há também:

- medidor de força da senha;
- limite de 5 tentativas com a senha atual errada (bloqueio de 15 minutos);
- encerramento das sessões abertas em outros aparelhos;
- notificação "Sua senha foi alterada".

**Notificações (sino).** O sino mostra a contagem de não lidas e é atualizado a cada minuto. Cada aviso leva à tela correspondente; há "marcar todas como lidas". Eventos:

- lead distribuído para você;
- leads aguardando distribuição (administradores e líderes);
- negócios transferidos para você;
- tarefa atribuída por outra pessoa;
- cliente abriu ou concluiu a ficha cadastral;
- pré-venda parada;
- documento enviado pelo cliente;
- venda confirmada (especialista e líder);
- comissão liberada;
- cancelamento registrado;
- pesquisa de satisfação respondida;
- treinamento obrigatório publicado;
- senha alterada.

**CRM (funil).**

- **Cartões:** cada cartão mostra o nome, o **ID do cadastro** (o mesmo desde prospect até cliente), a **origem** e o **valor da negociação**. O valor é o da maior proposta ativa; sem proposta, o crédito desejado, identificado como tal.
- **Ordenação:** "Ordenar por" próxima atividade, valor da negociação, data de entrada do lead ou data de criação do negócio, com o botão de seta para crescente ou decrescente. Quem não tem o dado vai para o fim.
- **Mover em massa:** o botão liga a seleção nos cartões (e "selecionar todos" por coluna). Há duas ações:
  - **Mover para etapa:** perda com motivo, nutrição com motivo e data. As regras do funil são validadas cartão a cartão, e os que não puderem ser movidos são listados.
  - **Transferir responsável** (administrador e líder): escolhe o novo responsável e a coluna do funil de destino. Cadastro, negócios abertos e tarefas pendentes passam para ele, que é notificado.
- **Busca:** nome, código (C-…, OP-…), telefone (qualquer parte dos dígitos) ou e-mail.
- **Filtros:** categoria (imóvel, veículo, serviço) no lugar de produto. Para o administrador e o líder, "Funil de" mostra o funil de outro usuário.
- **Painel lateral:** clicar no nome (botão esquerdo) abre o resumo à direita sem sair do funil: contato, origem, responsável, negócio, propostas, tarefas, últimas atividades e "Mover etapa". O botão do meio do mouse (ou Ctrl+clique) abre o cadastro em uma nova guia. O seletor "Mover para" abaixo dos cartões foi removido; a mudança de etapa é feita arrastando o cartão ou pelo painel.

**Pós-venda.** Começa na confirmação do pagamento e fica sempre ligado ao cadastro. O responsável pós-venda é o padrão da empresa (Configurações › Geral) ou o especialista da venda, e pode ser trocado pelo administrador ou líder.

- **Checklist:** 1ª parcela paga, onboarding, cadastro de lance, cadastro do recebimento do boleto, preferências de contato e pedido de indicação. Itens marcados automaticamente:
  - a 1ª parcela, quando o pagamento é baixado no financeiro;
  - a estratégia de lance, ao salvá-la;
  - as preferências, quando informadas na confirmação da venda.

  Indicadores por item pendente e filtros por situação e responsável.
- **Satisfação (NPS):**
  - NPS do período (% promotores − % detratores), taxa de resposta e distribuição.
  - Motivos de insatisfação: o cliente escolhe o motivo principal quando dá nota até 8, e a equipe pode ajustar na tratativa.
  - Médias das avaliações complementares.
  - **Alertas:** detratores sem tratativa, pesquisas sem resposta há mais de 5 dias, pesquisas expiradas e clientes há mais de 30 dias sem pesquisa, com botão para enviar.
  - **Histórico:** todas as pesquisas, com quem enviou, a nota, o comentário e a **tratativa** (o que foi combinado, por quem e quando). Detratores geram tarefa urgente e notificação.
- **Estratégias de lance:** por carta (grupo e cota), a estratégia atual e o **histórico de cada alteração** com quem cadastrou, data e hora. Filtros por situação (com ou sem estratégia) e tipo de lance.

## 15. Identidade visual

Aplicada a partir do manual da marca v1.0 em todas as telas, inclusive a ficha e a pesquisa abertas pelo cliente. Só a aparência mudou: rotas, campos, regras e permissões continuam iguais.

- **Paleta:** azul-noite #0D1B2A, marinho #1B263B, ardósia #415A77, aço #778DA9, névoa #E0E1DD e aço-claro #A9B8CB. Estados com cor e rótulo escrito: sucesso (oportunidade, concluído), atenção (hoje, prazo) e perigo (urgente, atrasado).
- **Temas:** escuro (padrão) e claro com os mesmos nomes de tokens. Sem escolha do usuário, vale o tema do sistema operacional; a escolha feita no botão Claro/Escuro fica salva no navegador.
- **Tipografia:** Famels (substituída pela Manrope até a licença) em títulos e números; Poppins em textos, rótulos e botões. Escala: título 2rem, indicador 1,75rem, texto 0,88rem, rótulos 0,7–0,8rem. Caixa de sentença, sem textos em caixa alta.
- **Forma:** moldura com raio 28, menu lateral flutuante (230 px, raio 20), cards com raio 18, campos com raio 8 e botões, abas, filtros e etiquetas em pílula. Sombras suaves, vidro na moldura e no topo e luzes ambientes no fundo. Cards clicáveis sobem 2 px ao passar o mouse (desligado com "reduzir movimento").
- **Ícones:** traço 1,7 no estilo Lucide: 18 px no menu e 14–16 px em botões e indicadores.
- **Botões:** um botão primário por área (névoa no tema escuro e azul-noite no claro); os demais são pílulas de vidro.
- **Tom de voz:**
  - plural correto ("1 tarefa", "2 tarefas");
  - número em destaque no início das ações sugeridas;
  - valores curtos nos resumos ("R$ 1,4 mi", "R$ 63,6 mil");
  - menu sem numeração.
- **Celular:**
  - a moldura ocupa a tela e o menu abre por cima;
  - os indicadores ficam em duas colunas;
  - tabelas viram cartões ou rolam na horizontal sem estourar a página.

