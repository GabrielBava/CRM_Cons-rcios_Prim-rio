# Especificação funcional: CRM de Consórcios Primários

Este documento descreve o que está **implementado** nesta versão e o que ainda depende de definição. Os itens seguem a lista de entrega pedida.

---

## 1. Telas e navegação

O menu lateral vira um menu recolhível no celular. A barra superior tem **busca global** (nome, telefone, e-mail, CPF/CNPJ, código `C-`, `OP-`, `PR-`, `SIM-`, `CT-` ou UID) e o botão **+ Novo lead**.

| Área | Conteúdo |
|---|---|
| **Painel inicial** | Indicadores com definição de cálculo (ⓘ): leads novos, leads sem tentativa, tentativas de ligação, contatos efetivos com taxa, ligações recebidas, reuniões agendadas e realizadas, simulações, propostas, vendas e crédito. Mostra também leads parados por etapa, próximas tarefas e atrasos, e conversão por origem, usuário e produto. Filtros: período, usuário, origem, etapa, produto e status. |
| **Prospects e leads** | Lista com busca e filtros: tipo de registro, status, PF/PJ, responsável, origem, campanha, etapa, produto, sem tentativa, cadastro incompleto e restrição de contato. Mostra a próxima ação de cada lead. Permite cadastro rápido, importação CSV, exportação CSV e lista para a discadora. |
| **Ficha do cadastro** | Cabeçalho com etiquetas (relacionamento, status do lead, status do cliente, "não contatar"), próxima ação em destaque e aviso de campos recomendados pendentes. Abas: Resumo, Cadastro, Contatos da empresa (PJ), Oportunidades, Histórico, Tarefas, Simulações e propostas, Produtos contratados, Origens, Preferências e LGPD, Auditoria. |
| **Funil comercial** | Kanban com arrastar e soltar. No celular e no teclado, usa-se o seletor "Mover para…". Há também visão em lista e filtros por responsável, origem, produto, etapa, prioridade e próxima ação (atrasada, hoje ou sem ação). |
| **Oportunidade** | Dados comerciais, validação da estratégia, histórico de etapas, simulações, propostas, tarefas e atividades. |
| **Agenda e tarefas** | Pendentes, atrasadas, hoje, próximos 7 dias, concluídas e canceladas, com filtro por responsável e tipo. Reuniões são concluídas com um resultado. |
| **Ligações e atividades** | Todas as atividades, com filtros. Gestores e administradores também veem a **fila da discadora** (sem vínculo, com erro, vinculados, descartados) e as **entradas de leads e mensagens**. |
| **Simulações e propostas** | Listas com filtros e detalhe da proposta, com versões, histórico e mudança de status. |
| **Clientes** | Cadastros convertidos e produtos contratados. |
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
- O CRM não armazena dados de pagamento nem documentos.

## 11. Campos e regras que ainda dependem de definição

1. **Discadora:** fornecedor, formato do payload, códigos de resultado, identificação dos agentes e política de guarda das gravações.
2. **Simulador:** URL, implementação dos dois endpoints do lado do simulador, lista oficial de modalidades e estratégias do simulador (hoje são texto livre no retorno) e prazo de validade desejado para o link.
3. **Meta Ads:** conexão direta ou uso de ferramenta intermediária, formulários e campos do Lead Ads, responsável padrão dos leads recebidos.
4. **WhatsApp:** provedor, se o texto das mensagens será armazenado e se haverá envio a partir do CRM (exige regras de consentimento e modelos aprovados).
5. **Produtos:** administradoras, grupos e planos efetivamente comercializados. Taxas e índices hoje são registrados em cada proposta, sem tabela pré-definida.
6. **Critérios comerciais:** critério formal de lead qualificado, resultados que contam como "contato efetivo" (o padrão é Atendida, Contato realizado e Retorno solicitado) e prazo para considerar um lead parado (padrão de 7 dias).
7. **Estrutura da equipe:** equipes, gestores e regra de distribuição de leads sem responsável (hoje a distribuição é manual).
8. **LGPD:** base legal por finalidade, prazo de retenção e rotina de eliminação, encarregado (DPO) e texto de consentimento nos formulários de captação.
9. **Status de contrato e pós-venda:** valores definitivos (hoje: em formalização, ativo, contemplado, quitado, cancelado) e eventuais tarefas automáticas de pós-venda.
10. **Hospedagem:** servidor, HTTPS, backup e política de acesso externo.
