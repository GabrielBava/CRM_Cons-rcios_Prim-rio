# Especificação funcional: ERP/CRM de Consórcios Primários

Este documento descreve o que está **implementado** nesta versão e o que ainda depende de definição. Os itens seguem a lista de entrega pedida.

---

## 1. Telas e navegação

O menu lateral vira um menu recolhível no celular. A barra superior tem **busca global** (nome, telefone, e-mail, CPF/CNPJ, código `C-`, `OP-`, `PR-`, `SIM-`, `CT-` ou UID) e o botão **+ Novo lead**.

| Área | Conteúdo |
|---|---|
| **Painel inicial** | Indicadores com definição de cálculo (ⓘ): leads novos, leads sem tentativa, tentativas de ligação, contatos efetivos com taxa, ligações recebidas, reuniões agendadas e realizadas, simulações, propostas, vendas e crédito. Mostra também leads parados por etapa, próximas tarefas e atrasos, e conversão por origem, usuário e produto. Filtros: período, usuário, origem, etapa, produto e status. |
| **Prospects e leads** | Lista com busca e filtros: tipo de registro, status, PF/PJ, responsável, origem, campanha, etapa, produto, sem tentativa, cadastro incompleto e restrição de contato. Mostra a próxima ação de cada lead. Permite cadastro rápido, importação CSV, exportação CSV e lista para a discadora. |
| **Ficha do cadastro** | Cabeçalho com etiquetas (relacionamento, status do lead, status do cliente, "não contatar"), próxima ação em destaque e aviso de campos recomendados pendentes. Abas na ordem da ficha aprovada: Resumo, 1. Cadastro, 2. Origem, 3. Endereço, 4. Negócio, 5. Financeiro, 6. Propostas, 7. Agenda e tarefas, 8. Produtos contratados, 9. Histórico, e ainda Relacionamentos (cônjuge ou sócios e contatos da empresa), Documentos, Pré-venda, Pós-venda, Preferências e LGPD, Auditoria. Detalhes na seção 12. |
| **Funil comercial** | Kanban com arrastar e soltar. No celular e no teclado, usa-se o seletor "Mover para…". Há também visão em lista e filtros por responsável, origem, produto, etapa, prioridade e próxima ação (atrasada, hoje ou sem ação). |
| **Oportunidade** | Dados comerciais, validação da estratégia, histórico de etapas, simulações, propostas, tarefas e atividades. |
| **Agenda e tarefas** | Pendentes, atrasadas, hoje, próximos 7 dias, concluídas e canceladas, com filtro por responsável e tipo. Reuniões são concluídas com um resultado. |
| **Ligações e atividades** | Todas as atividades, com filtros. Gestores e administradores também veem a **fila da discadora** (sem vínculo, com erro, vinculados, descartados) e as **entradas de leads e mensagens**. |
| **Simulações e propostas** | Listas com filtros e detalhe da proposta, com versões, histórico e mudança de status. |
| **Clientes** | Cadastros convertidos e produtos contratados. |
| **Financeiro** | Parcelas e valores que os clientes pagam à administradora: em atraso, a vencer, pagos, negociados e cancelados, com totais e exportação CSV (seção 12). |
| **Produtos e estratégias** | Produtos, estratégias, categorias, modalidades e tipos de contemplação. |
| **Relatórios** | 12 relatórios com "Como é calculado" e exportação CSV. |
| **Configurações e usuários** | Usuários e equipes, etapas do funil, listas, campos (visibilidade, recomendados e campos adicionais), integrações, parâmetros gerais, auditoria e senha. |

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

As etapas iniciais são:

1. Novo prospect
2. Tentativa de contato
3. Contato realizado
4. Lead qualificado
5. Diagnóstico ou reunião agendada
6. Diagnóstico realizado
7. Simulação em elaboração
8. Proposta apresentada
9. Follow-up
10. Em negociação
11. **Venda concluída** (tipo ganho)
12. **Perdido** (tipo perda)
13. **Nutrição futura** (tipo nutrição)

Regras:

- As etapas podem ser renomeadas, criadas (tipo aberta ou nutrição), reordenadas e desativadas. Só é possível desativar uma etapa que não tenha oportunidades. As etapas de ganho e perda são obrigatórias.
- Cada movimentação grava a etapa anterior, a nova etapa, o usuário, a data, o tempo na etapa anterior e o motivo. A movimentação também aparece como atividade "Mudança de etapa".
- **Perdido** exige motivo, escolhido de uma lista configurável, com detalhe opcional.
- **Nutrição** registra o motivo da pausa.
- **Venda concluída** transforma o cadastro em **cliente** (lead "convertido", cliente "ativo") sem perder nenhum histórico e permite registrar o produto contratado no mesmo passo.
- Reabrir uma oportunidade (voltar para uma etapa aberta) limpa a data de fechamento e o motivo de perda. O histórico de etapas guarda o motivo anterior.
- Uma oportunidade nova começa na primeira etapa aberta.
- Lembretes: registrar uma atividade com "data de retorno" cria automaticamente uma tarefa e atualiza a próxima ação da oportunidade.
- Uma oportunidade é considerada "parada" quando fica *N* dias sem atividade. O padrão é 7 dias, configurável.

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
| Pesquisa de NPS por link | Registro manual da nota (0 a 10) e do comentário na aba Pós-venda | Link para o cliente responder a pesquisa com perguntas sobre a empresa |
| Consulta de CEP (ViaCEP) | Busca do endereço pelo CEP na ficha e na página do cliente. Se a consulta falhar, o endereço é preenchido manualmente. | — |
| Importação/exportação | CSV (`;` ou `,`) com mapeamento, prévia, deduplicação e erros por linha. Exportação CSV compatível com Excel. | Leitura direta de `.xlsx` (hoje é preciso salvar como CSV) |

## 9. Permissões

As permissões são verificadas **no servidor** em todas as consultas e alterações, não apenas escondendo botões.

| Perfil | Acesso |
|---|---|
| Administrador | Todos os registros e configurações, usuários, integrações, anonimização |
| Gestor | Registros da própria equipe e cadastros sem responsável. Transfere responsáveis dentro da equipe, mescla cadastros, trata filas de integração, gerencia produtos. |
| Consultor | Apenas os próprios cadastros e oportunidades (ou aqueles em que é responsável pela oportunidade). Não transfere registros. |
| Leitura | Consulta os registros da equipe (ou todos, se não tiver equipe). Não edita e não exporta dados pessoais. |

Um gestor sem equipe vê apenas os próprios registros. Quando um consultor tenta cadastrar alguém que já pertence a outro responsável, ele recebe o alerta de duplicidade **sem ver os dados** do cadastro.

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
- O link para o cliente é aleatório, temporário (padrão de 7 dias), guardado como hash e pode ser revogado. Ele só permite alterar os campos externos (cadastro, endereço e documentos).

## 11. Campos e regras que ainda dependem de definição

1. **Discadora:** fornecedor, formato do payload, códigos de resultado, identificação dos agentes e política de guarda das gravações.
2. **Simulador:** URL, implementação dos dois endpoints do lado do simulador, lista oficial de modalidades e estratégias do simulador (hoje são texto livre no retorno) e prazo de validade desejado para o link.
3. **Meta Ads:** conexão direta ou uso de ferramenta intermediária, formulários e campos do Lead Ads, responsável padrão dos leads recebidos.
4. **WhatsApp:** provedor, se o texto das mensagens será armazenado e se haverá envio a partir do CRM (exige regras de consentimento e modelos aprovados).
5. **Produtos:** administradoras, grupos e planos efetivamente comercializados. Taxas e índices hoje são registrados em cada proposta, sem tabela pré-definida.
6. **Critérios comerciais:** critério formal de lead qualificado, resultados que contam como "contato efetivo" (o padrão é Atendida, Contato realizado e Retorno solicitado) e prazo para considerar um lead parado (padrão de 7 dias).
7. **Estrutura da equipe:** equipes, gestores e regra de distribuição de leads sem responsável (hoje a distribuição é manual).
8. **LGPD:** base legal por finalidade, prazo de retenção e rotina de eliminação, encarregado (DPO) e texto de consentimento nos formulários de captação.
9. **Status de contrato e pós-venda:** valores definitivos (hoje: em formalização, ativo, contemplado, quitado, cancelado). As etapas do checklist de pós-venda podem ser ajustadas em Configurações › Listas.
11. **NPS e agenda externa:** perguntas da pesquisa de NPS e escolha entre Google Agenda e Outlook.
10. **Hospedagem:** servidor, HTTPS, backup e política de acesso externo.

## 12. Módulo ERP: ficha em 9 blocos, financeiro, pré-venda e pós-venda

Implementa a ficha aprovada na página de proposta (`docs/proposta-ficha/index.html`). Os campos marcados como **externos** podem ser atualizados pelo próprio cliente por link. Os **internos** são só da empresa. Sempre que possível, os campos são listas configuráveis (Configurações › Listas) para alimentar indicadores.

| Bloco | Tipo | Conteúdo |
|---|---|---|
| 1. Cadastro | Externo | PF: nome, CPF, RG, data de nascimento, naturalidade, nacionalidade, sexo, estado civil, regime de bens (casado ou união estável), nome da mãe, profissão, faixa de renda e de patrimônio. PJ: razão social, nome fantasia, CNPJ, IE, data de abertura, atividade, faixa de faturamento e representante legal. Campos com a marca **venda** são exigidos para concluir a venda. |
| 2. Origem | Interno | Origem, campanha, UTMs, **indicado por** (vínculo com outro cadastro, com lista de indicações feitas) e **temperatura** (fria, morna, quente). |
| 3. Endereço | Externo | Vários endereços (residencial, comercial, correspondência, cobrança), um principal. Busca por CEP. |
| 4. Negócio | Interno | Campos da R1: objetivo, tipo de produto (primário ou contemplada, no mesmo funil), finalidade do crédito, prazo, momento financeiro, tipo de contratação, FGTS, **quem decide a compra**, produtos que já possui. Consórcio: valor e administradora. Financiamento: saldo devedor, CET e banco. |
| 5. Financeiro | Interno | Parcelas e demais valores que o cliente paga. Situações: a vencer, pago, negociado, cancelado e **em atraso** (calculado). Geração de parcelas a partir do contrato. Pendências financeiras. |
| 6. Propostas | — | Simulações e propostas com versões. Aprovar exige o **canal e a data do aceite** e cria a tarefa "Completar ficha de pré-venda". Recusar exige o **motivo da recusa** (lista). |
| 7. Agenda e tarefas | Interno | Tarefas e reuniões. Novos tipos: pré-venda e financeiro. Sincronização com agenda externa: **integração pendente**. |
| 8. Produtos contratados | Externo | Contrato: nº na administradora, grupo e cota, valor da parcela, dia de vencimento, primeira parcela, **vendedor** e **valor da venda**, contemplação (data, tipo, lance e bem adquirido). |
| 9. Histórico | — | Linha do tempo com filtro por **fase**: pré-venda (antes da primeira proposta), venda (depois da primeira proposta) e pós-venda (depois da conversão em cliente). |

**Relacionamentos.** PF: dados do cônjuge (nome, CPF, profissão, renda), exibidos quando o estado civil pede. PJ: sócios (nome, CPF, participação, relação) e contatos da empresa.

**Documentos.** Envio de PDF ou imagem (até 8 MB), com situação: pendente, recebido, aprovado, recusado ou removido. A lista exigida para PF e para PJ é definida em Configurações › Geral. Padrão PF: identificação, comprovante de endereço, comprovante de renda e comprovante de estado civil. Padrão PJ: contrato social, cartão CNPJ, comprovante de endereço, faturamento e documento do representante.

**Checklist de venda (pré-venda).** Mover a oportunidade para "Ganho" só é possível com a ficha completa: campos marcados como obrigatórios na venda (Configurações › Campos), endereço principal completo, dados do cônjuge e regime de bens quando aplicável, e documentos exigidos recebidos ou aprovados. O CRM informa exatamente o que falta. A regra pode ser desligada em Configurações › Geral.

**Link para o cliente.** Na ficha, o botão "Link para o cliente" gera um endereço (`#/ficha/<token>`) que o cliente abre sem login para conferir e atualizar cadastro, endereço (com busca por CEP) e documentos. Cada envio fica no histórico com a origem "cliente" e cria a tarefa "Conferir dados atualizados pelo cliente" para o responsável. O link expira no prazo configurado (1 a 60 dias) e pode ser revogado.

**Financeiro.** Quem paga é sempre o cliente, e a empresa acompanha para avisar. Parcelas vencidas e não pagas aparecem em atraso na ficha, no menu Financeiro e no painel ("Parcelas em atraso"). Cada atraso gera uma tarefa do tipo financeiro para o **responsável financeiro** definido em Configurações › Geral (ou para o responsável pelo cliente). A tarefa é concluída automaticamente quando a parcela é paga, negociada ou cancelada. Relatórios: **Financeiro** (previsto, recebido, em atraso e adimplência por mês de vencimento) e **Vendas por vendedor**.

**Pós-venda.** Checklist por cliente com etapas configuráveis (boas-vindas, primeira parcela, acompanhamento das assembleias, contemplação e pedido de indicação) e registro de NPS (nota de 0 a 10 e comentário). O link de NPS para o cliente responder é uma **integração pendente**.

**Itens recusados na aprovação** (não implementados): PEP, evento de origem, página de conversão, responsáveis por fase, checklist de FGTS, transcrição automática da R1 e visões adicionais da agenda.
