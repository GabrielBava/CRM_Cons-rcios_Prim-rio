# Integrações: contratos do lado do CRM

Este documento descreve **os pontos de conexão que o CRM expõe**. O CRM não assume nenhum endpoint, credencial ou recurso de plataforma externa. Cada fornecedor (discadora, simulador, provedor de WhatsApp, conector da Meta) precisa ser configurado de acordo com a própria documentação, com o mapeamento de campos ajustado no CRM.

## Status das integrações

| Status | Significado |
|---|---|
| **Integração pendente** | Padrão. Eventos são recusados (HTTP 503). Nenhuma conexão é assumida. |
| **Em teste (não validada)** | Recebe eventos para homologação. Exige token gerado. |
| **Ativa (validada)** | Só pode ser marcada por um administrador depois de pelo menos um evento real processado com sucesso. Registra quem validou e quando. |
| **Com erro** | Aparece automaticamente quando o último evento de uma integração habilitada falhou. |
| **Desativada** | Eventos recusados. |

Situação nesta versão:

| Integração | Situação |
|---|---|
| Discadora | Endpoint implementado. **Fornecedor não definido: integração pendente.** |
| Simulador | Fluxo de link e retorno implementado no CRM. **Depende de implementação no simulador: integração pendente.** Enquanto isso, a simulação pode ser registrada manualmente. |
| Meta Ads (Lead Ads) | **Conector direto não implementado.** Leads podem chegar pela API de entrada de leads por meio de uma ferramenta intermediária. |
| WhatsApp | **API oficial do WhatsApp Business (Cloud API da Meta):** webhook de recebimento e envio de mensagens implementados (seção 10); precisa da conta da Meta conectada (número, token e App Secret). Há também o endpoint genérico de registro de mensagens de outros provedores (seção 4). |
| API de entrada de leads | Implementada (endpoint próprio do CRM). |
| Qualificação pela R1 (transcrição) | Endpoint implementado no CRM. **O modelo que lê a transcrição da reunião ainda não existe: integração futura.** |

## Autenticação

Cada integração tem um token próprio, gerado em **Configurações › Integrações**. O token é exibido uma única vez, e o banco guarda apenas o hash.

```
Authorization: Bearer <token>
```

O cabeçalho alternativo `X-CRM-Token: <token>` também é aceito. Os endpoints de integração não usam a sessão de usuário.

## Mapeamento de campos

Todos os campos recebidos passam por um mapeamento configurável (campo do CRM → nome ou caminho no payload, por exemplo `dados.telefone`). Os valores abaixo são os **padrões**. Campos ausentes ficam vazios e não são inventados.

---

## 1. Discadora: `POST /api/integracoes/discadora/eventos`

Aceita um evento, uma lista de eventos ou `{ "eventos": [...] }`, com no máximo 500 por requisição.

| Campo do CRM | Campo padrão no payload | Observação |
|---|---|---|
| ID da chamada | `id_chamada` | **Obrigatório.** Chave de idempotência. |
| ID do lead no CRM | `id_lead` | Código (`C-000123`) ou UID do cadastro |
| Telefone discado | `telefone` | Usado para localizar o lead quando não há ID |
| Início / término | `inicio` / `fim` | ISO 8601, `DD/MM/AAAA HH:MM` ou timestamp Unix |
| Duração | `duracao_segundos` | Segundos ou `mm:ss`. Se ausente, é calculada a partir de início e fim. |
| Agente | `agente` | Comparado com o "ID do agente na discadora" do usuário ou com o e-mail |
| Status técnico | `status_tecnico` | Guardado como informado |
| Resultado | `resultado` | Convertido pelo **mapa de resultados** |
| Classificação | `classificacao` | Observação livre |
| Gravação | `gravacao_url` | Guardada **somente** se a opção estiver habilitada |
| Direção | `direcao` | `entrada`/`inbound` gera "ligação recebida" |
| Origem | `origem` | Padrão: `discadora` |

**Regras de processamento**

1. Sem ID da chamada, o evento é guardado com erro (não há como evitar duplicidade) e pode ser reprocessado depois que o mapeamento for corrigido.
2. Se o ID da chamada já foi processado, o evento é marcado como `duplicado` e **não gera nova atividade**. Um índice único no banco garante isso.
3. Vínculo: primeiro pelo ID do lead. Se não houver, pelo telefone (telefones do cadastro e dos contatos da empresa). Se houver zero ou mais de um cadastro correspondente, o evento vai para a **fila sem vínculo**, em **Ligações e atividades › Eventos da discadora**, para vínculo manual.
4. Resultado: sem informação, fica `nao_informado`. Um código que não está no mapa vira `outro`, e o valor original é preservado. O CRM nunca presume sucesso.
5. Resultados de não atendimento geram "Tentativa sem atendimento". Os demais geram "Ligação realizada".
6. Cadastros com oposição a ligações recebem o registro com um alerta, e a lista exportada para a discadora (**Prospects e leads › Lista para discadora**) já exclui esses cadastros.
7. Eventos com erro ou sem vínculo podem ser **reprocessados** ou **descartados** (com motivo). Todos ficam em **Registros**.

**Mapa de resultados** (configurável, um por linha): `CODIGO_DA_DISCADORA=valor_do_crm`. Os valores do CRM são os itens da lista "Resultados de ligação".

Resposta: `{ "resultados": [ { "status": "vinculado|duplicado|sem_vinculo|erro", "event_id": 1, "activity_id": 10 } ] }`

O botão **Testar mapeamento** simula o processamento de um payload sem gravar nada.

---

## 2. Simulador

### Fluxo

1. Na tela do lead ou da oportunidade, o consultor clica em **"Criar simulação para este lead"**. Enquanto a integração estiver pendente, o botão fica desativado com a etiqueta "Integração pendente".
2. O CRM gera um **token aleatório de 256 bits**, válido por *N* horas (padrão 24, configurável), vinculado a **um único** lead e, opcionalmente, a uma oportunidade. O banco guarda apenas o hash, a origem (tela), o usuário e o horário de criação.
3. O CRM abre `URL_DO_SIMULADOR?crm_token=<token>`. **Nenhum dado pessoal vai na URL.**
4. O simulador consulta os dados de pré-preenchimento:

```
GET /api/integracoes/simulador/contexto?token=<crm_token>
Authorization: Bearer <token da integração>
```

```json
{
  "id_lead": "uuid", "codigo_lead": "C-000123",
  "id_oportunidade": "uuid", "codigo_oportunidade": "OP-000045",
  "tipo_pessoa": "PF", "nome": "…", "empresa": null, "telefone": "…", "email": "…",
  "consultor": { "nome": "…", "email": "…" },
  "interesse": { "categoria": "imovel", "credito": 300000, "prazo_meses": 200, "modalidade_pagamento": null, "estrategia": null },
  "expira_em": "2026-09-28T12:00:00.000Z"
}
```

A resposta não inclui CPF nem CNPJ.

5. Ao salvar ou enviar a simulação, o simulador devolve:

```
POST /api/integracoes/simulador/simulacoes
Authorization: Bearer <token da integração>
```

| Campo padrão | Uso |
|---|---|
| `token` | **Obrigatório.** O `crm_token` recebido |
| `id_simulacao` | **Obrigatório.** ID da simulação no simulador (usado para versionar) |
| `id_lead` / `id_oportunidade` | Opcionais. Se informados, **precisam coincidir** com o token, senão a resposta é 409. |
| `credito`, `prazo_meses`, `parcela` | Valores simulados |
| `modalidade_pagamento`, `estrategia` | Texto |
| `link_consulta` | URL (http/https) para consultar a simulação |
| `status` | `em_elaboracao`, `salva`, `enviada`, `cancelada` |
| `observacoes`, `usuario` (e-mail) | Opcionais |

**Validações:** o token precisa ser válido, não expirado e não revogado. Uma simulação existente de outro lead é recusada. O mesmo `id_simulacao` gera **nova versão**, e a versão anterior fica guardada no histórico. Um reenvio idêntico não cria versão.

Resposta: `{ "id_simulacao_crm": "SIM-000010", "versao": 2, "lead": "C-000123" }`

Enquanto o simulador não estiver integrado, use **"Registrar simulação manual"**.

---

## 3. API de entrada de leads: `POST /api/integracoes/leads`

Serve para formulários do site, ferramentas intermediárias e, no futuro, um conector da Meta. Aceita um lead, uma lista ou `{ "leads": [...] }`.

Campos padrão: `id_lead_plataforma`, `plataforma` (ex.: `meta_ads`), `nome`, `telefone`, `email`, `tipo_pessoa` (`PF`/`PJ`), `empresa`, `cidade`, `estado`, `origem` (valor da lista de origens), `id_campanha`, `nome_campanha`, `id_conjunto_anuncios`, `id_anuncio`, `data_recebimento`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `observacoes`.

**Deduplicação**

- Mesmo `plataforma` + `id_lead_plataforma`: `duplicado`, nada é criado.
- Telefone ou e-mail de um cadastro existente: `existente`. O cadastro recebe **um novo registro de origem** e uma anotação no histórico, sem criar duplicata.
- Correspondência com mais de um cadastro: `sem_vinculo`, para revisão em **Ligações e atividades › Entradas**.
- Sem correspondência: `criado`, com relacionamento "lead" e o responsável padrão configurado. Sem responsável padrão, **a roleta distribui na hora** (sem esperar a rotina de 15 minutos).
- Leads de formulário (origens Meta Ads, Instagram, Facebook, LinkedIn, TikTok, landing page e site, configuráveis em `auto_tentativa_origins`) chegam com nome e contato e entram direto na etapa **Tentativa de contato**, com a tarefa de primeiro contato para o especialista.

## 4. WhatsApp (outros provedores): `POST /api/integracoes/whatsapp/mensagens`

Endpoint genérico para **registrar no histórico** mensagens vindas de um provedor intermediário. Para conversar pelo número oficial da empresa dentro do CRM, use a integração direta com a API oficial (seção 10).

Campos padrão: `id_mensagem` (obrigatório, usado para idempotência), `telefone`, `direcao` (`entrada`/`saida`), `data`, `tipo`, `texto`.

O texto só é guardado se a opção "Armazenar o texto das mensagens" estiver ativa. Caso contrário, o histórico registra `[conteúdo da mensagem não armazenado]`. Mensagens sem cadastro correspondente vão para a fila de entradas.

## 5. Meta Ads

O conector direto (webhooks da Graph API, verificação do app e busca do lead) **não foi implementado** e não pode ser marcado como "em teste" ou "ativo". Os campos para os IDs de lead, campanha, conjunto de anúncios e anúncio, e para as UTMs, já existem no cadastro (aba **Origens**), na importação CSV e na API de entrada de leads.

## 6. Qualificação pela R1: `POST /api/oportunidades/:id/qualificacao`

Base para o futuro modelo de R1: depois da reunião, um processo lê a transcrição, extrai as respostas da qualificação e envia ao CRM. **Só os campos vazios são preenchidos**; o que o especialista já preencheu fica como está. A chamada usa a sessão de um usuário com acesso ao negócio.

```json
{
  "source": "r1_transcricao",
  "fields": {
    "objective_type": "aquisicao",
    "credit_purpose_type": "moradia",
    "credit_value": 400000,
    "urgency": "medio",
    "installment_min": 2500,
    "installment_max": 3200,
    "has_bid_resources": "sim",
    "bid_own_resources": 50000,
    "has_fgts": "sim",
    "decision_maker": "conjuge",
    "decision_notes": "Decide com a esposa, Ana.",
    "had_consortium": "sim",
    "existing_consortium_admin": "Administradora X",
    "existing_consortium_value": 120000
  }
}
```

Resposta: `filled` (campos preenchidos agora), `ignored` (já tinham valor ou não são aceitos) e `qualification` (`filled` de `total` campos essenciais e o que ainda falta). Os valores das listas seguem os códigos de Configurações › Listas (objetivo, finalidade do crédito, urgência, decisor etc.). O preenchimento fica no histórico do negócio e na auditoria.

Campos novos aceitos: `housing_purpose` (morar/investir), `bid_source` (reserva, fgts, reserva_fgts, venda_bem, outro), `has_property`, `property_type` (apartamento, casa, terreno…), `property_value`, `property_free_liens`, `pays_rent` e `rent_value`.

**Arquivo da transcrição (tela do negócio).** `POST /api/oportunidades/:id/transcricoes` recebe `{ filename, text }` (o navegador converte .docx e .xlsx em texto), guarda a transcrição e devolve os campos identificados (`items`: chave, descrição, valor lido, valor entendido, se vai preencher). `POST /api/oportunidades/:id/transcricoes/:tid/aplicar` completa os campos vazios. Formatos lidos:

- linhas "Descrição: valor" no texto (ex.: `Crédito desejado: R$ 300.000,00`, `Prazo desejado: curto`, `Origem do lance: FGTS`);
- planilha com as colunas **Campo** (chave ou descrição) e **Valor** — o modelo sai em `GET /api/r1/campos` e no botão "Modelo da transcrição";
- planilha com um campo por coluna (cabeçalho na 1ª linha, valores na 2ª).

O futuro agente de IA que ler a transcrição pode gerar qualquer um desses formatos ou chamar diretamente o endpoint `/qualificacao`.

## 7. Google Agenda (R1 com Google Meet)

- **Configuração (administrador):** Configurações › Integrações › Google Agenda, ou as variáveis `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` (no `config.env`). No Google Cloud Console: ativar a **Google Calendar API** e a **Google Meet REST API**, criar um ID do cliente OAuth "Aplicativo da Web" com os URIs de redirecionamento autorizados `https://SEU-CRM/api/google/retorno` (produção, `PUBLIC_URL`), `http://localhost:3000/api/google/retorno` (teste no computador) e `http://localhost:8080/api/google/retorno` (máquina virtual), e os escopos `calendar.events` e `meetings.space.readonly` na tela de consentimento. Enquanto o app estiver em modo "Teste" no Google, inclua o e-mail de cada especialista em "Usuários de teste".
- **Conexão (cada especialista):** Meu cadastro › Google Agenda › Conectar. O CRM guarda só o token de atualização, cifrado (AES-256-GCM).
- **Agendamento:** `POST /api/r1/agendar` cria a tarefa "Reunião (R1)" e o evento na agenda principal do responsável pelo cliente (`events.insert` com `conferenceDataVersion=1` e `sendUpdates=all`): Google Meet, convite ao e-mail do cliente e o link salvo na tarefa. Reagendar ou cancelar a tarefa atualiza (ou exclui) o evento.
- **Agenda do especialista:** o evento vai para a agenda do responsável pelo cliente. Se ele ainda não conectou o Google, vale a agenda de quem está agendando, com o especialista convidado. O pop-up oferece "Conectar Google Agenda" (a autorização abre noutra guia e o pop-up segue o agendamento).
- **Confirmação por e-mail:** além do convite do Google, o cliente recebe "Reunião confirmada" do `noreply@` com data, horário, botão "Entrar na reunião" e o contato do especialista (com o arquivo `.ics` quando o Google não enviou o convite).
- **Presença (R1 feita):** a rotina de 5 minutos (e o botão "Verificar presença", `POST /api/tarefas/:id/presenca`) consulta `conferenceRecords` e `participants` da sala do Meet (filtro `space.meeting_code`). Participante da empresa: conta Google conectada por um usuário do CRM (identificador `sub`), nome igual ao de um usuário do CRM, ou e-mail do domínio interno (`internal_domain`, padrão `veroconsorciosbr.com.br`, quando o Google informa). De fora: convidado sem conta, telefone ou outra conta Google. Regra: pelo menos 2 participantes e ao menos 1 de fora → a reunião é concluída como "Realizada" (R1 feita) no horário em que o cliente e alguém da empresa estavam na sala. Se a reunião acabou há mais de 2 horas sem cliente, fica "Cliente não entrou no Meet" e o especialista é avisado para registrar o resultado. Conexões feitas antes desta versão precisam ser refeitas (Meu cadastro › Reconectar) para liberar a permissão do Meet.
- **Sem integração:** a tarefa é criada no CRM e o especialista abre o evento já preenchido no Google Agenda (`calendar.google.com/calendar/render?action=TEMPLATE…`) e cola o link do Meet na reunião.

## 8. E-mail (SMTP): ficha de adesão e R1 agendada

- **Configuração:** Configurações › Integrações › E-mail, ou no `config.env`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY` (`tls` = 465, `starttls` = 587), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_FROM_NAME`. Remetente padrão `noreply@veroconsorciosbr.com.br` (Titan: `smtp.titan.email`, porta 465, SSL/TLS).
- **R1 agendada:** ao agendar, o cliente recebe a confirmação (data, horário, link do Meet e contato do especialista).
- **Envio:** `POST /api/pre-vendas/:id/enviar-email` ou `POST /api/cadastros/:id/link-cliente/enviar-email`: e-mail em HTML (passo a passo e botão "Acessar minha ficha") com versão em texto. Sem SMTP, a resposta traz o e-mail pronto (`html`, `text`, `mailto`) para o especialista enviar pelo próprio programa.
- **Segurança da ficha:** `POST /api/publico/ficha/verificar` confere os 4 últimos dígitos do celular e devolve uma chave de acesso de 2 horas (cabeçalho `X-Ficha-Key` ou campo `key`). Sem a chave, a ficha mostra só a saudação. Cinco tentativas erradas bloqueiam o link por 15 minutos e avisam o especialista.

## 9. Conexão BI (Power BI, Looker Studio, Excel)

- **Token:** Configurações › Integrações › Conexão BI › Gerar token (exibido uma vez). Envie no cabeçalho `Authorization: Bearer <token>` ou no endereço (`?token=`), para ferramentas que não aceitam cabeçalho.
- **Bases:** `GET /api/bi` lista as bases e os endereços. `GET /api/bi/<base>` devolve `{ base, gerado_em, linhas, dados: [...] }`; `?formato=csv` devolve CSV (separador `;`). Bases: `vendas`, `comissoes`, `funil`, `propostas`, `financeiro` (parcelas a pagar e a receber), `colaboradores`, `beneficios`, `metas`, `atividades`.
- **Privacidade:** clientes aparecem só pelo código; CPF, RG, telefone, e-mail e dados bancários de clientes e colaboradores não saem pela conexão BI. Cada leitura fica nos registros da integração.
- **Power BI:** Obter dados › Web › `https://SEU-CRM/api/bi/vendas?formato=csv&token=…` (ou JSON com o cabeçalho Authorization em "Avançado"). Agende a atualização no Power BI Service.
- **Relatórios em Excel:** cada relatório exporta `.xlsx` (`GET /api/relatorios/:key/xlsx`) e o administrador exporta o pacote completo (`GET /api/relatorios-pacote.xlsx?grupo=`).

## 10. WhatsApp da empresa (API oficial do WhatsApp Business)

Tela: **Comunicação › WhatsApp**. Configuração: **Configurações › Integrações › WhatsApp da empresa** ou no `config.env`.

- **Credenciais (Meta for Developers, app do tipo Empresa com o produto WhatsApp):** `WHATSAPP_PHONE_NUMBER_ID` (WhatsApp › Configuração da API), `WHATSAPP_TOKEN` (token permanente de um Usuário do sistema no Gerenciador de Negócios, com `whatsapp_business_messaging` e `whatsapp_business_management`), `WHATSAPP_APP_SECRET` (Configurações do app › Básico: confere a assinatura `X-Hub-Signature-256` de cada evento), `WHATSAPP_VERIFY_TOKEN` (qualquer texto; o mesmo é informado na Meta) e, se preciso, `WHATSAPP_API_VERSION` (padrão `v21.0`). Pela tela, o token e o App Secret ficam cifrados no banco.
- **Webhook:** `https://SEU-CRM/api/whatsapp/webhook`. `GET` responde o `hub.challenge` quando `hub.verify_token` confere; `POST` recebe `messages` (texto, botão, lista, localização, imagem, documento, áudio e vídeo) e `statuses` (enviada, entregue, lida, falhou). Assine o campo **messages**. O endereço precisa ser HTTPS público (`PUBLIC_URL`).
- **Conversas:** cada número (`wa_id`) vira uma conversa, ligada ao cadastro pelo WhatsApp/telefone (com ou sem o nono dígito) e atribuída ao responsável pelo cliente. Número sem cadastro: aparece em "Sem cadastro" e a gestão é avisada; a conversa pode ser vinculada a um cadastro ou virar lead. Escopo: especialista vê as suas, líder as da equipe, administrador todas.
- **Envio:** `POST /api/whatsapp/conversas/:id/mensagens` com `body` (texto livre, só até 24 horas depois da última mensagem do cliente) ou `template` + `language` + `params` (modelo aprovado no Gerenciador do WhatsApp, obrigatório fora da janela). Respeita a oposição a contato por WhatsApp do cadastro.
- **Histórico:** cada mensagem recebida ou enviada entra no histórico do lead como atividade de WhatsApp (`mensagem_recebida` / `mensagem_enviada`, origem `whatsapp`).
- **Mídia:** `GET /api/whatsapp/midia/:id` baixa a foto, o áudio ou o documento recebido pela API da Meta.
- **Modo de teste:** sem a conta conectada, o administrador pode ligar o modo de teste: as mensagens ficam só no CRM (marcadas "teste"), para treinar a equipe.

## 11. IA Vero: motor interno e IA generativa opcional (Claude)

Tela: aba **IA Vero** do painel do lead. Configuração: **Configurações › Integrações › IA Vero** (administrador).

- **Motor interno (padrão):** regras da plataforma sobre os dados do CRM (etapa, atividades, qualificação, reuniões, propostas, produtos e diagnóstico) e a Base da IA Vero. Sem custo e sem enviar dados para fora.
- **IA generativa (opcional):** responde as perguntas livres do chat com o modelo `claude-opus-5-5` (Anthropic), com os dados do lead como contexto (resumo, etapa, próximo passo, alertas, canal, BANT, itens em aberto e oportunidades; sem CPF). Requisitos no servidor: a biblioteca oficial (`npm install @anthropic-ai/sdk`) e a chave da API (`ANTHROPIC_API_KEY` no `config.env` ou salva cifrada pela tela). Usa o fallback de modelo do lado do servidor da Anthropic (`server-side-fallback-2026-07-01`, `fallbacks: "default"`): se o modelo principal estiver indisponível, a Anthropic responde com o modelo reserva padrão. Recusa, limite de uso, chave inválida ou falha de rede: a resposta sai do motor interno, com o aviso.
- **Conversas:** cada "Nova conversa" do chat é uma conversa própria (`thread`). `POST /api/ia/leads/:id/conversa` `{ message, thread? }` devolve a resposta e o `thread`; `GET /api/ia/leads/:id/conversa` lista as conversas (primeira pergunta e data) e, com `?thread=`, traz as mensagens. Na IA generativa, só a conversa atual vai como histórico.
- **Rotas:** `GET /api/ia/leads/:id` (insights, com as fontes consultadas e "o que foi combinado"), `GET|POST /api/ia/leads/:id/conversa` (conversas e pergunta), `POST /api/ia/avaliar` (👍/👎 na resposta ou no item da base), `GET|POST|PATCH /api/ia/conhecimento` (base; cadastro pela liderança), `GET /api/ia/status`, `PUT /api/ia/config` (administrador).

## 12. Diagnóstico financeiro (ferramenta da Vero Planejamento)

- **Abrir:** `POST /api/diagnosticos` `{ contact_id, opportunity_id? }` devolve a URL `ferramentas/diagnostico-financeiro.html?crm=<id>#/clientes/crm-<id>` (o lead tem um diagnóstico: a chamada retoma o existente; não há "refazer").
- **Ponte:** a página busca `GET /api/diagnosticos/:id/dados` (cadastro para preencher, consultor e o diagnóstico salvo) e grava o cliente no armazenamento do navegador que a ferramenta lê; cada alteração volta por `PUT /api/diagnosticos/:id/dados` `{ data }` (até 4 MB; coleta ou recomendações finalizadas concluem). `POST /api/diagnosticos/:id/concluir` conclui manualmente. `GET /api/cadastros/:id/diagnostico` traz o atual (com o resumo) e o histórico.
- **Resultado:** cada salvamento envia também `resultado` = `{ estrela: { nota, pilares[] }, matriz: [até 12], bussola: { nota, norte, dimensoes[] } }`, calculado pela própria ferramenta; o CRM guarda o último válido no resumo do diagnóstico e mostra no painel do lead.
- **Trava:** sem `?crm`, a ferramenta mostra "gere pelo painel do lead" (e, quando o CRM não responde — como na versão de teste —, oferece o modo de demonstração, que não salva). Com `?crm`, ficam escondidos Novo cliente, Carregar exemplo, Importar e Exportar backup, e a navegação fica presa ao cliente do CRM. A IA da própria ferramenta (chave informada pelo usuário nas configurações dela) chama `api.anthropic.com` direto do navegador.

## Exportação para discadora

**Prospects e leads › Lista para discadora** gera um CSV com `id_lead;nome;telefone;telefone_2;responsavel`, respeitando os filtros da tela. A lista exclui automaticamente cadastros com oposição a ligações ou a todos os canais, cadastros sem telefone e cadastros anonimizados. O `id_lead` é o que a discadora deve devolver nos eventos.

## 13. Link da proposta para o cliente (página pública rastreável)

- **Endereço:** `https://SEU-CRM/#/proposta/<código>` (o código tem 24 caracteres aleatórios e é criado em Propostas › ícone de link; "Gerar novo link" invalida o anterior). Com `PUBLIC_URL` no `config.env`, o CRM monta o link com esse endereço; sem ele, usa o endereço aberto no navegador.
- **Rotas públicas (sem login):** `GET /api/publico/proposta?token=…&device=mobile|desktop` (dados da página e abertura do acesso; `equipe=1` não registra acesso), `POST /api/publico/proposta/evento` (`token`, `view`, `seconds` até 120 por evento, `scroll` 0–100, `sections`) e `POST /api/publico/proposta/avancar` (`token`, `note` opcional). Todas exigem o cabeçalho `X-Requested-With: crm` nos POST.
- **Dados expostos:** primeiro nome do cliente, código e condições da proposta, nome/cargo/WhatsApp do consultor. Sem CPF, telefone, e-mail ou endereço do cliente. A página pede para não ser indexada (`noindex`).
- **Rotas da equipe:** `GET/POST /api/propostas/:id/link` (situação, acessos, criar/trocar o link) e `GET /api/propostas/:id/whatsapp` (modelos da régua).

## 14. Precificação do planejamento (diagnóstico → proposta)

A ponte da ferramenta de diagnóstico envia, junto com cada salvamento, a precificação calculada pela própria ferramenta (`precificacao`: valor, total à vista, total e parcelas no cartão, condição). Com o diagnóstico concluído, `POST /api/diagnosticos/:id/proposta` `{ model: 'implementacao' | 'plataforma', valor? }` gera a proposta de **planejamento** do modelo escolhido (valor da precificação ou o informado; à vista e cartão proporcionais). Gerar de novo antes do envio atualiza a mesma proposta; depois de enviada, recusa (crie nova versão). Para reaplicar a ponte num diagnóstico já gerado: `node scripts/build-tools.js --atualizar-ponte`.

## 15. Landing pages (LPs) e rastreio de campanhas (UTM)

- **LPs atuais:** `public/lp/index.html` (LP Consórcios, a geral — vai como `index.html` da hospedagem) e `public/lp/lp-planejamento.html` (LP Planejamento). O CRM também as serve em `/lp/` e `/lp/lp-planejamento.html`.
- **Envio:** `POST /api/publico/lp/leads` (sem login, CORS conforme `lp_allowed_origins`/`LP_ALLOWED_ORIGINS`, limite de 8 envios por IP a cada 10 minutos, aceite da Política de Privacidade obrigatório, campo-armadilha `website`).
  - Consórcio: simulador (`categoria`, `modo`, `credito`, `parcela`, `prazo`) e Mecanismo de Alavancagem (`tipo: "alavancagem_financeira"`, `credito`, `inicio`, `simulacao`) → área **consórcio**, qualificação preenchida (objetivo, crédito, parcela, prazo, urgência).
  - Planejamento: `tipo: "planejamento_financeiro"`, `objetivo`, `prazo`, `renda_familiar`, `consegue_guardar`, `origem: "LP Planejamento · <posição>"` → área **planejamento**.
  - LPs futuras: `area` (`consorcio`, `planejamento`, `seguros`, `investimentos`), `lp` (identificador cadastrado), `formulario` e `respostas` (`{ "Pergunta": "Resposta" }` ou `[{ pergunta, resposta }]`). Campos que o CRM não conhece também ficam registrados.
  - Comuns: `nome`, `email`, `celular`/`telefone`, `preferencia_contato`, `melhor_horario`, `aceite_privacidade`, `aceite_notificacoes`/`aceite_contato`, `pagina`, `utm` e `rastreio`.
- **No CRM:** cadastro com origem **LP (landing page)** e campanha = `utm_campaign` (ou o nome da LP); negócio na etapa Tentativa de contato com a **área** do formulário; tudo o que a pessoa preencheu nas **observações do cadastro** e na nota **Formulário da LP** (aba Notas do painel do lead); a origem (`contact_origins`) guarda as UTMs, `source_ref = lp:<lp>:<formulário>` e, em `other_params`, a LP, a página, o referrer, o canal, os identificadores de clique e o primeiro e o último toque. Telefone ou e-mail já cadastrado: não duplica, registra a nova origem e completa (ou abre) o negócio da mesma área. Sem responsável, a roleta distribui na hora.
- **Rastreio (`public/lp/vero-rastreio.js`):** guarda por 90 dias, no navegador, o primeiro e o último toque (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `utm_id`, `gclid`, `gbraid`, `wbraid`, `fbclid`, `ttclid`, `msclkid`, `li_fat_id`, página, referrer e data). Sem UTM, identifica o canal (Google orgânico, Instagram, Facebook, LinkedIn, TikTok, YouTube, WhatsApp, outro site ou direto). Completa todo envio para `/api/publico/lp/leads` com `rastreio`, `utm`, `lp` e `area`. API: `VeroLP.endpoint()`, `VeroLP.enviar(dados)`, `VeroRastreio.utm()`, `VeroRastreio.dados()`.
- **Configuração da LP:** `window.VERO_LP = { crm, lp, area }` no `<head>`. `crm` = endereço do CRM (ex.: `https://crm.veroconsorciosbr.com.br`); vazio só quando a LP é servida pelo próprio CRM em `/lp/`.
- **Preparar uma LP (nova versão ou LP nova):** `node scripts/preparar-lp.js entrada.html saida.html --lp <identificador> --area <área> [--crm https://…]` embute a configuração e o rastreio (sem duplicar ao rodar de novo) e troca o `leadEndpoint:""` da LP pelo endereço do CRM. Sem `leadEndpoint`, use `VeroLP.enviar(...)` no envio do formulário.
- **Tela Ferramentas › LPs e rastreio** (líder e administrador): LPs cadastradas (`GET/PUT /api/lps`), **gerador de link com UTM** no padrão da Vero, **desempenho** (`GET /api/lps/desempenho?dias=30&por=lp|formulario|area|fonte|midia|campanha|conteudo`: entradas, cadastros, com R1, ganhos e conversão) e **Baixar** o arquivo da LP já com o endereço deste CRM (`GET /api/lps/<lp>/arquivo`, usa `PUBLIC_URL`).
- **Padrão de UTM:** minúsculas, sem acento e sem espaço; `utm_campaign = área_tema_aaaa-mm` (ex.: `consorcio_imovel_2026-11`, `planejamento_dividas_2026-11`); `utm_source` (google, meta, instagram, facebook, youtube, tiktok, linkedin, whatsapp, email, sms, parceiro, indicacao, evento, offline); `utm_medium` (cpc, pago_social, display, video, organico, email, mensagem, referencia, qrcode); `utm_content` = criativo; `utm_term` = público ou palavra-chave.

## 16. Domínio do CRM e cópia de teste no Supabase

- **Domínio `crm.veroconsorciosbr.com.br`:** no DNS do domínio, crie o registro **A** `crm` apontando para o IP do servidor e rode `sudo DOMINIO=crm.veroconsorciosbr.com.br DEMO=0 bash deploy/instalar-ubuntu.sh`. O instalador define `PUBLIC_URL`, liga o HTTPS (Caddy, certificado automático) e deixa o CRM só atrás do domínio. Depois: no Google Cloud, cadastre o retorno `https://crm.veroconsorciosbr.com.br/api/google/retorno`; no WhatsApp (Meta), o webhook `https://crm.veroconsorciosbr.com.br/api/whatsapp/webhook`; as LPs já enviam para `https://crm.veroconsorciosbr.com.br/api/publico/lp/leads`. Para aceitar leads só do site da Vero, use `LP_ALLOWED_ORIGINS=https://veroconsorciosbr.com.br,https://www.veroconsorciosbr.com.br`.
- **Fora dos buscadores:** o CRM responde `X-Robots-Tag: noindex, nofollow` e `/robots.txt` com `Disallow: /` (área restrita; as LPs oficiais ficam no site).
- **Cópia de teste no Supabase (`scripts/supabase-sync.js`, `npm run supabase`):** recria o schema `crm_teste` (Postgres) com todas as tabelas do CRM e copia os dados — um retrato do CRM para testes e BI; o CRM continua usando o próprio banco.
  - Arquivo: `CRM_DB=data/crm.db npm run supabase -- --arquivo crm_teste.sql` e cole no **SQL Editor** do Supabase (ou `psql "$URL_DO_BANCO" -f crm_teste.sql`).
  - Direto: `SUPABASE_ACCESS_TOKEN=sbp_… SUPABASE_PROJECT_REF=<ref do projeto> npm run supabase -- --enviar` (token pessoal em supabase.com › Account › Access Tokens; o `ref` está em Project Settings). Também lidos do `config.env`.
  - Opções: `--schema <nome>`, `--sem-dados`, `--sem-anexos`.
  - Segurança: sem a tabela de sessões; senhas, tokens, hashes e chaves cifradas como NULL; configurações com segredo (SMTP, Google) fora; RLS ligado em todas as tabelas, sem políticas, e o schema fora da API pública (anon/authenticated sem acesso). Dados pessoais dos clientes (CPF, telefone) vão junto: use um projeto Supabase só da Vero.
  - Tipos: INTEGER → bigint, REAL → double precision, TEXT → text, BLOB → bytea; `id` vira identity; índices simples e únicos recriados; chaves estrangeiras como `NOT VALID`.
  - Para o CRM rodar de fato sobre o Supabase (por exemplo, na Vercel), a camada de dados precisa ser migrada do SQLite para o Postgres: é outra etapa.
