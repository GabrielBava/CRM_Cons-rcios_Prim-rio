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
| WhatsApp Lite (QR Code) | **Número do próprio especialista (Business ou pessoal) lido por QR Code** num servidor compatível com a Evolution API v2 (seção 18). Precisa do servidor configurado pelo administrador; sem ele, há o modo de teste. |
| Instagram, LinkedIn, Google Ads, LinkedIn Ads | Aparecem na tela Integrações como **Em breve**. |
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

## 11. IA Vero: motor interno e IA generativa opcional (Gemini ou Claude)

Tela: aba **IA Vero** do painel do lead. Configuração: **Configurações › Integrações › IA Vero** (administrador).

- **Motor interno (padrão):** regras da plataforma sobre os dados do CRM (etapa, atividades, qualificação, reuniões, propostas, produtos e diagnóstico) e a Base da IA Vero. Sem custo e sem enviar dados para fora.
- **IA generativa (opcional):** responde as perguntas livres do chat com o provedor escolhido em Configurações › Integrações › IA generativa: **Google Gemini** (padrão; modelo `gemini-3.8-flash`, trocável) ou **Anthropic Claude** (`claude-opus-5-5`, `claude-sonnet-5-5` ou `claude-haiku-5-5`), com os dados do lead como contexto (resumo, etapa, próximo passo, alertas, canal, BANT, itens em aberto e oportunidades; sem CPF). A troca de provedor vale na hora. Chaves: `GEMINI_API_KEY` (ou `GOOGLE_API_KEY`) e `ANTHROPIC_API_KEY` no ambiente, ou salvas cifradas pela tela. O Claude usa a biblioteca oficial (`@anthropic-ai/sdk`, já nas dependências) com o fallback de modelo do lado da Anthropic (`server-side-fallback-2026-07-01`, `fallbacks: "default"`; não vai para o Haiku, que não tem). O Gemini usa a API REST oficial (`https://generativelanguage.googleapis.com/v1/models/{modelo}:generateContent`, chave no cabeçalho `x-goog-api-key`), no mesmo formato da biblioteca oficial do Google (`@google/genai`). Recusa, limite de uso (no plano gratuito do Gemini há limite por minuto e por dia), chave inválida ou falha de rede: a resposta sai do motor interno, com o aviso.
- **Plano gratuito do Gemini e LGPD:** no plano gratuito, os termos do Google permitem usar as entradas e saídas da API para melhorar os produtos dele, com possível revisão humana. Para conversas com dados de clientes, prefira o plano pago do Gemini (ativando a cobrança no Google AI Studio) ou o Claude.
- **Conversas:** cada "Nova conversa" do chat é uma conversa própria (`thread`). `POST /api/ia/leads/:id/conversa` `{ message, thread? }` devolve a resposta e o `thread`; `GET /api/ia/leads/:id/conversa` lista as conversas (primeira pergunta e data) e, com `?thread=`, traz as mensagens. Na IA generativa, só a conversa atual vai como histórico.
- **Modelos do Gemini:** `GET /api/ia/modelos-gemini` lista ao vivo os modelos de texto da conta (botão "Buscar os modelos da conta").
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

**Diagnóstico Vero v1 (ponte própria).** A versão 1.0.0 do projeto `vero-diagnostico` já sai na marca e com a ponte dentro do app (`<meta name="vero-diagnostico" content="ponte-crm-1">`): com `?crm=<id>` ela usa `GET/PUT /api/diagnosticos/<id>/dados` e envia `{ data, resumo }`. O `resumo` (versão 1: `nota {valor, maximo}`, `estrela [{id, nome, pct, status}]`, `oportunidades [...]`, `precificacao {valor, pixTotal, cartaoTotal, parcelas, cartaoParcela, condicao, validadeDias}`, além de perfil, fluxo, patrimônio e reserva) vira a precificação e o resultado do CRM (Nota e Estrela Vero e Matriz de oportunidades; a Bússola não vem nesse resumo). Versão desconhecida é ignorada. `node scripts/build-tools.js --diag html/Diagnostico-Vero.html` só copia o arquivo e acrescenta a trava (sem `?crm`, não abre solto; ligado ao CRM, esconde Novo cliente, Carregar exemplo, Importar/Exportar, Duplicar e Excluir).

### 12.1 Simulador de consórcio ligado ao cliente

`ferramentas/simulador-consorcio.html?crm=<id do cadastro>` (Ferramentas › Consórcio escolhendo o cliente, "Gerar simulação" na aba Propostas do lead ou o botão "Simulador de consórcio" no painel lateral). A ponte do CRM (script `vero-crm`, acrescentado por `node scripts/build-tools.js --sim Simulador_Consorcio_Vero.html`) busca `GET /api/simulador/cliente/<id>` (sessão do CRM; só quem enxerga o lead) → `{ id, codigo, nome, telefone, email, consultor }`, mostra no canto "Simulação para <cliente>" e, depois da senha da equipe, preenche os campos de nome, telefone/WhatsApp e e-mail do cliente que estiverem vazios (também os que aparecem em etapas seguintes; campos do consultor, plano, grupo e valores não são tocados; o que o especialista digitar não é sobrescrito). Sem `?crm`, o simulador funciona sozinho. "Gerar simulação" também registra a data, a hora e quem gerou.

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
  - **Projeto de teste:** `vero-crm-teste` (organização Vero Consórcios, região São Paulo), com o schema `crm_teste` carregado a partir de `supabase/crm_teste.sql` (dados de demonstração). Como recarregar: `supabase/LEIA-ME.md`.
  - Para o CRM rodar de fato sobre o Supabase (por exemplo, na Vercel), a camada de dados precisa ser migrada do SQLite para o Postgres: é outra etapa.

## 17. Vercel + Supabase (CRM sem servidor fixo, banco Postgres)

- **Como funciona:** com `DATABASE_URL` (Postgres do Supabase), o CRM grava tudo no Supabase, no schema `crm` (configurável em `CRM_PG_SCHEMA`); sem ela, continua no SQLite (`CRM_DB`). O mesmo código roda nos dois: o SQL do CRM é traduzido para o Postgres na hora (`server/pg/translate.js`) e um cliente Postgres próprio, sem dependências (`server/pg/protocol.js`, TLS + SCRAM), atende pela mesma interface síncrona (`server/pg/index.js` + `worker.js`).
- **Schema:** `server/pg/schema.sql`, gerado de `server/db.js` por `npm run pg:schema` (rode depois de mudar tabelas). Na primeira requisição de cada versão, o CRM aplica o schema (idempotente: cria o que falta, não apaga nada) e os valores iniciais, com bloqueio para duas instâncias não fazerem isso juntas.
- **Vercel:** `api/index.js` recebe todas as rotas `/api/*` (`vercel.json › rewrites`); `public/` é servido direto pela Vercel com os mesmos cabeçalhos de segurança do servidor; região `gru1` (São Paulo, perto do Supabase `sa-east-1`).
- **Rotinas periódicas** (distribuição da fila, temperaturas, propostas vencidas, financeiro, presença na R1): sem processo fixo, rodam no primeiro acesso à API depois do prazo (5, 15 e 60 minutos; a última execução fica no banco) e uma vez por dia pelo agendamento da Vercel (`/api/cron`, protegido por `CRON_SECRET`).
- **Variáveis na Vercel:** `DATABASE_URL` (obrigatória: Supabase › **Connect** › **Session pooler**, porta 5432 — a conexão direta é só IPv6 e o pooler de transação não guarda o schema da sessão), `CRM_SECRET_KEY` (sem ela, uma chave é criada e guardada no banco), `PUBLIC_URL=https://crm.veroconsorciosbr.com.br`, `CRON_SECRET`, as do Google e do SMTP do `config.env`, e para a **versão de teste** `CRM_DEMO=1` + `DEMO_PASSWORD` (banco vazio recebe os dados de demonstração na primeira requisição).
- **Limites da Vercel:** requisições e respostas de até 4,5 MB (anexos de até ~3 MB, por causa da codificação em base64); a primeira requisição depois de um tempo parado é mais lenta (a função "acorda" e conecta no banco); a verificação de presença da R1 pelo Meet roda quando o CRM está em uso.
- **Testes no Postgres:** `TEST_DATABASE_URL=postgresql://… npm run test:pg` roda a suíte inteira num schema limpo (apaga o schema `crm` desse banco: use um banco de teste).

## 18. Tela Integrações e WhatsApp Lite (QR Code)

### 18.1 Tela Integrações (menu Integrações)

Cartões por categoria, com a situação de cada conexão e o botão Conectar/Gerenciar (`GET /api/integracoes/painel`):

| Categoria | Integrações | Quem vê |
|---|---|---|
| Mensageria | WhatsApp Lite, WhatsApp Business (API oficial), Instagram (em breve), LinkedIn (em breve) | WhatsApp Lite, Instagram e LinkedIn: todos (cada usuário conecta o seu). API oficial: líder e administrador |
| Voz | Discadora | Líder e administrador |
| Marketing | Meta Ads, Google Ads (em breve), LinkedIn Ads (em breve) | Líder e administrador |
| Produtividade | Google Agenda | Todos (cada usuário conecta a sua) |
| Sistema | E-mail (SMTP), IA generativa, API de leads, Conexão BI | Líder e administrador |

- **Especialista e leitura** veem só as integrações de uso pessoal (marcadas "Usuário"). **Líder e administrador** veem todas.
- Credenciais da empresa (Meta, discadora, SMTP, IA, BI) continuam só com o administrador, em Configurações › Integrações; o líder vê a situação.

### 18.2 WhatsApp Lite: como funciona

- **Igual ao WhatsApp Web:** em **Comunicação › WhatsApp**, o usuário clica em **Conectar meu WhatsApp** (ou no ícone de QR Code no topo da lista) e o QR Code aparece na própria tela. No celular (Business ou pessoal): **Aparelhos conectados › Conectar um aparelho** e lê o código. A tela se atualiza sozinha quando conecta, e as conversas com os clientes passam a aparecer na lista. "Gerar outro QR Code" renova o código da mesma conexão. Também dá para conectar por Integrações › WhatsApp Lite › Nova instância.
- **Por que existe o conector:** o WhatsApp Web só recebe mensagens enquanto a aba está aberta. No CRM, quem fica "com a aba aberta" 24 horas é o conector (servidor compatível com a Evolution API, seção 18.4): ele mantém o aparelho conectado e repassa cada mensagem ao CRM, mesmo com o computador do especialista desligado. A Vercel não mantém conexões abertas entre uma requisição e outra, por isso o conector roda fora dela.
- As conversas vão para **Comunicação › WhatsApp**, junto com as do número oficial, com o canal e a instância indicados.
- **Privacidade (padrão):** só entram as conversas com números que já estão no CRM (lead ou cliente). Mensagens de amigos e família do número pessoal são ignoradas. O dono pode trocar para "Registrar todas as conversas" no menu ⋯ da instância.
- Grupos, listas de transmissão e canais são ignorados.

### 18.3 Acesso dos membros

| Nível | O que faz |
|---|---|
| Sem acesso | Não vê as conversas do número |
| Só ver | Lê as conversas (não responde e não abre o cadastro de lead de outro especialista) |
| Ver e enviar | Lê e responde pelo número |

- O **dono** da instância, o **líder** e o **administrador** têm sempre acesso completo e são os únicos que mudam o acesso, desconectam ou excluem.
- "Acesso para todos" define um nível mínimo para a equipe inteira; o nível individual mais alto prevalece.
- Abrir a conversa zera as não lidas só para quem atende (o responsável). O líder acompanhando não apaga o aviso do especialista. Uma resposta dada pelo celular também marca a conversa como vista.

### 18.4 Servidor (Evolution API v2)

O WhatsApp Lite usa um servidor compatível com a **Evolution API v2** (Baileys), hospedado pela Vero numa VPS ou contratado. O CRM não assume nenhum fornecedor.

- **Atenção ao "EvoGo":** o Evolution Go é outro produto (em Go), com outras rotas e outro formato de webhook; não é compatível com o CRM. Use a **Evolution API v2**.
- **Instalador para VPS (Locaweb ou outra, Ubuntu 22.04/24.04, a partir de 1 GB de RAM):** `deploy/whatsapp-lite/instalar-evolution.sh`, autocontido. Ele instala o Docker, cria 2 GB de swap quando a RAM é menor que 2 GB e gera em `/opt/vero-whatsapp` o Docker Compose: Evolution API **v2.3.8** com cache local (sem Redis), Postgres enxuto e Caddy com HTTPS automático, além dos registros com tamanho limitado. Parado, o conjunto usa cerca de 270 MB. Também instala o atalho `vero-whatsapp` (situacao, registros, reiniciar, dados). Rodar de novo mantém a chave, as senhas e os números conectados. Passo a passo completo (Locaweb, DNS na HostGator, CRM, QR Code e agente) em `deploy/whatsapp-lite/LEIA-ME.md`. A versão fica fixa: a partir da 2.4, a Evolution API exige ativação de licença.

- **Configuração (administrador):** Integrações › WhatsApp Lite › *Servidor do WhatsApp Lite*: endereço (`https://…`) e chave global (`apikey`), guardada cifrada no banco. Ou no ambiente: `EVOLUTION_API_URL` e `EVOLUTION_API_KEY` (têm prioridade sobre a tela). Ao salvar um endereço ou uma chave novos, o CRM confere o conector na hora (`GET /instance/fetchInstances`) e avisa se ele não respondeu, se o certificado HTTPS ainda não saiu ou se a chave foi recusada. A configuração é salva de qualquer jeito.
- **Webhook:** o CRM cadastra sozinho, ao criar a instância, `https://SEU-CRM/api/whatsapp/lite/webhook/<token da instância>` com os eventos `QRCODE_UPDATED`, `CONNECTION_UPDATE`, `MESSAGES_UPSERT` e `MESSAGES_UPDATE`. O endereço precisa ser HTTPS público (`PUBLIC_URL`). Cada instância tem um token próprio; token desconhecido recebe 401.
- **Chamadas usadas:** `POST /instance/create`, `POST /webhook/set/{instância}`, `GET /instance/connect/{instância}` (QR Code), `GET /instance/connectionState/{instância}`, `GET /instance/fetchInstances`, `DELETE /instance/logout/{instância}`, `DELETE /instance/delete/{instância}`, `POST /message/sendText`, `POST /message/sendMedia`, `POST /message/sendWhatsAppAudio` e `POST /chat/getBase64FromMediaMessage` (para baixar foto, áudio ou documento recebido).
- **Mensagens que não entram:** um número conectado com "Só conversas com cadastros do CRM" ignora quem ainda não está no CRM (exceto no número central com o agente de IA ligado). Cada mensagem ignorada é contada na instância, com o motivo e o número, e a linha da instância avisa "N mensagens recebidas não entraram no CRM".
- **Endereçamento novo do WhatsApp (LID):** a mensagem pode chegar com um identificador (`…@lid`) no lugar do número. O número vem em `remoteJidAlt`/`senderPn` quando o WhatsApp manda; o CRM guarda o LID na conversa (`wa_conversations.lid`) sempre que ele vem junto com o número e reconhece pelo LID as mensagens que chegam só com ele. LID nunca visto, sem número, fica contado como mensagem que não entrou.
- **Busca de mensagens no conector (sem depender do aviso):** ao listar as conversas e ao mostrar uma conversa do WhatsApp Lite (a tela consulta a conversa aberta a cada 5 segundos), o CRM busca no conector, no máximo a cada 6 segundos por número (`WA_LITE_SYNC_MS`), as mensagens desde a última busca, com 3 minutos de folga (`POST /chat/findMessages/{instância}` com `where.messageTimestamp.gte/lte`), e os status de entrega e leitura (`MessageUpdate`). É o mesmo caminho do envio, então as respostas aparecem mesmo quando o aviso do conector (webhook) não chega ao CRM. Mensagens já registradas não se repetem e a mesma mensagem que não entra é contada uma vez. O agente de IA e as notificações na hora continuam dependendo do aviso.
- **Conferir recebimento** (menu da instância, para quem gerencia o número): confere se o número está conectado, recadastra no conector o endereço de aviso (webhook) se estiver diferente do esperado ou sem os eventos, testa se o CRM responde pelo próprio endereço público (o mesmo que o conector usa; resposta 401/403 indica proteção por login na Vercel: defina `PUBLIC_URL`), busca as mensagens no conector na hora e aponta quando o último aviso é mais antigo que a última mensagem do conector (aviso não está chegando), mostra o último aviso do conector e as mensagens que não entraram, com a opção de registrar todas as conversas. **Reconectar** também recadastra o endereço de aviso. O endereço do conector colado por engano no campo "Endereço do CRM para o webhook" é recusado (e ignorado, se já estava salvo).
- **Diagnóstico na VPS:** `deploy/whatsapp-lite/diagnostico.sh` (ou `vero-whatsapp diagnostico`) mostra os números no conector, o webhook e o teste dele, as últimas mensagens (número, LID com ou sem número) e os erros recentes, sem a chave nem os números completos.
- **Modo de teste:** sem servidor configurado, o administrador pode ligar o modo de teste: o QR Code é ilustrativo e o botão **Simular leitura** conecta a instância; as mensagens ficam só no CRM.

### 18.5 Guia WhatsApp (Comunicação › WhatsApp)

- **Lista:** filtros **Todas**, **Não lidas** e **Minhas** (do responsável que está vendo), busca por nome, número e texto das mensagens, filtro por canal/número. Cada conversa mostra a foto/iniciais, as não lidas, as **iniciais do responsável** (ex.: GB) e a **etapa do lead no pipeline** (Lead, Tentativa de contato, Qualificação, R1, R2, Negociação…), identificada pelo número do contato.
- **Topo da conversa:** nome, número, etapa no pipeline, responsável e o canal (WhatsApp oficial ou WhatsApp Lite · nome da instância).
- **Mensagens:** separadores por dia, eventos do negócio ("Negócio criado em…", mudanças de etapa), confirmações de envio/entrega/leitura, foto, vídeo, áudio e documento.
- **Envio:** texto com emoji, anexos (foto, vídeo, documento) com legenda, gravação de áudio pelo microfone e modelos aprovados (número oficial). Limite de **3 MB por arquivo** (`WA_MAX_FILE_MB`), por causa do limite de 4,5 MB por requisição da Vercel. No número oficial, áudio precisa ser OGG ou MP3 (a gravação do navegador em WebM não é aceita pela Meta).
- **Ver:** painel ao lado com o lead (etapa, responsável, crédito, próxima ação), a **IA Vero** (perguntas sobre a conversa e o lead, com "Usar como resposta") e o **Histórico**. Botões para **converter a conversa**: Agendar reunião (R1/R2), Gerar proposta e Fechamento.
- **Pipeline:** o cartão do lead com conversa no WhatsApp mostra o ícone do WhatsApp (com as não lidas); clicar abre a conversa.

## 19. Agente de IA no WhatsApp (atendimento e qualificação no número central)

Tela: **Integrações › Agente de IA** (o administrador configura; o líder vê a situação e os números). Na conversa: faixa **IA atendendo** com o botão **Assumir conversa** / **Devolver para a IA**.

- **Onde atende:** só no **número central** da Vero: um número do WhatsApp Lite (conectado por QR Code no conector) ou o número oficial. Os números pessoais dos especialistas não são atendidos pela IA. Ao ligar o agente num número Lite, ele passa a registrar todas as conversas (não só as de quem já está no CRM), porque recebe leads novos.
- **Fluxo:** o lead escreve → número desconhecido vira **lead** (origem WhatsApp, nome do perfil do WhatsApp) e entra na distribuição → a IA responde, apresenta-se como assistente virtual e faz a **triagem** (as 6 perguntas da aba Qualificação: interesse, dor/necessidade, impacto/prazo, decisor, faixa de investimento, faixa de renda), registrando cada resposta no CRM (triagem completa com interesse leva o negócio para **Qualificação**) → com **fit** (critério configurável), oferece horários livres da agenda do especialista responsável e **agenda a R1** (com Google Meet e convite por e-mail quando configurados; o negócio vai para a coluna R1) → passa a conversa para o especialista e o avisa.
- **Passagem para uma pessoa:** quando o lead pede, reclama, já é cliente, pergunta valores, taxas, propostas ou contratos, envia algo que a IA não avalia, não tem fit, depois da R1 agendada, ou se a IA ficar indisponível (nesse caso o lead recebe uma mensagem de cortesia). Se alguém da equipe responder pelo CRM ou pelo celular, a IA para na hora. O especialista pode **Assumir** ou **Devolver para a IA** a qualquer momento.
- **Regras fixas:** não promete data de contemplação nem garante aprovação, rentabilidade ou taxa; não informa valores de parcela ou de proposta; não pede CPF, documentos, senhas ou cartão; diz que é uma IA se perguntarem; respeita quem pede para não receber mensagens e a oposição a contato por WhatsApp do cadastro.
- **Configuração:** número central, nome da assistente, provedor e modelo (Gemini: `gemini-3.8-flash` padrão; Claude: `claude-opus-5-5`, `claude-sonnet-5-5` ou `claude-haiku-5-5`), duração da R1, dias e horários para a R1, antecedência mínima, critério de fit e orientações extras. A Base da IA Vero (perguntas, objeções e mensagens) entra no conhecimento do agente.
- **Provedor:** **Google Gemini** (padrão, com plano gratuito) ou **Anthropic Claude**, escolhido na tela do agente e trocável a qualquer momento (cada um com o seu modelo). As chaves são as mesmas da IA generativa (seção 11) e podem ser informadas na própria tela do agente. No Gemini, as ferramentas vão como `functionDeclarations` (parâmetros em `parametersJsonSchema`), o resultado de cada ferramenta volta como `functionResponse` com papel `user` e o conteúdo do modelo é devolvido sem alterações (preserva as assinaturas de raciocínio). Limite do plano gratuito atingido: o lead recebe a mensagem de cortesia e a conversa passa para o especialista com o motivo "Limite de uso da IA atingido".
- **Funcionamento técnico:** o agente roda dentro da requisição do webhook (a Vercel não executa nada depois da resposta). Mensagens seguidas do lead são juntadas (espera de `WA_AGENT_DEBOUNCE_MS`, padrão 6 s) e uma trava por conversa impede duas respostas ao mesmo tempo. Chamada à IA (Gemini ou Claude) com ferramentas (`salvar_triagem`, `salvar_qualificacao`, `horarios_r1`, `agendar_r1`, `transferir_especialista`, `encerrar_sem_fit`), cache do prompt do sistema e fallback de modelo do lado da Anthropic.
- **Registro e custos:** cada ação fica em `wa_agent_log` (novo lead, triagem, R1 agendada, transferência, sem fit, erro) com os tokens usados. A tela mostra os números dos últimos 30 dias e, no Claude, uma estimativa do custo. Ordem de grandeza por lead qualificado (cerca de 10 mensagens): US$ 0,40 no Opus 5.5, US$ 0,20 no Sonnet 5.5, menos de US$ 0,02 no Haiku 5.5; no plano gratuito do Gemini, sem cobrança dentro dos limites.
- **Rotas:** `GET|PUT /api/whatsapp/agente` (configuração e números), `POST /api/whatsapp/conversas/:id/ia` `{ acao: "assumir" | "devolver" }`.
- **Modo de teste:** campo "Modo de teste: atender só estes números" (um por linha). Com a lista preenchida, a IA só responde a esses números, e conversas de outras pessoas com o número central não entram no CRM (útil para testar com um número pessoal). Vazio: a IA atende todos que escreverem para o número central.
- **Especialista padrão para leads novos:** quando a roleta não define ninguém, o lead criado pela IA fica com esse especialista (e a R1 é marcada na agenda dele).
- **Teste no computador antes da VPS:** `deploy/whatsapp-lite/teste-no-computador/` sobe no Docker Desktop o CRM de teste (dados de demonstração, banco próprio, sem ler o `config.env`), o conector Evolution API v2.3.8, o Postgres e o Redis, só em `localhost`. O conector avisa o CRM em `http://crm.vero.test:3000` (`EVOLUTION_WEBHOOK_BASE`). Passo a passo em `deploy/whatsapp-lite/teste-no-computador/LEIA-ME.md`.
- **Endereço do CRM para o webhook:** `EVOLUTION_WEBHOOK_BASE` (ou o campo na tela do servidor do WhatsApp Lite) troca o endereço que o conector usa para avisar as mensagens; padrão: o endereço público do CRM.
- **Acesso:** as conversas do número central que passaram para um especialista (responsável pela conversa ou pelo lead) aparecem para ele, que pode responder mesmo sem acesso ao número.


## 20. Avisos por WhatsApp para o responsável (novo lead e R1 agendada)

Tela: **Integrações › Avisos por WhatsApp** (o administrador configura; o líder vê). Serviço: `server/services/waautomation.js`.

- **Quando:** novo lead para o especialista (cadastro com responsável, landing page, API, agente de IA, e distribuição pela roleta ou manual) e R1 ou R2 agendada na agenda dele. O responsável recebe também quando ele próprio cadastrou o lead ou agendou a reunião; a opção "Não avisar quando o próprio responsável fez a ação" (`skip_self`, desligada por padrão) deixa esses avisos registrados como "Não enviado". O mesmo aviso não se repete para a mesma pessoa. Configurações salvas antes da revisão 2 passam a avisar o próprio responsável e a R2, mantendo os modelos.
- **Para quem:** o responsável, no **WhatsApp comercial** de Meu perfil (sem ele, o telefone), aceito em qualquer formato (+55, 0 + DDD, espaços). A tela mostra **Quem recebe**, com o número usado para cada pessoa. Sem número: o aviso fica registrado como "Responsável sem WhatsApp no perfil". Se o WhatsApp de alguém for o mesmo número que envia os avisos, a tela alerta: o aviso cai na conversa consigo mesmo e o WhatsApp não notifica.
- **Por onde:** o número do WhatsApp Lite escolhido (padrão: o número central do agente de IA ou o primeiro conectado), pela Evolution API (`/message/sendText`). Se o CRM marcou o número como desconectado (o aviso de conexão do conector pode não ter chegado), confere a conexão no conector antes de desistir. Não abre conversa de lead: o eco do aviso que o conector devolve é reconhecido e ignorado. Com o WhatsApp Lite em modo de teste, o envio é registrado como simulado.
- **Modelos:** editáveis, até 1.000 caracteres, com *negrito* do WhatsApp e variáveis {{nome_lead}}, {{origem}}, {{campanha}}, {{origem_campanha}}, {{telefone_lead}}, {{responsavel}}, {{link_lead}} e, na R1, {{data_reuniao}}, {{horario_reuniao}}, {{link_reuniao}} (o Meet, quando houver) e {{tipo_reuniao}}. Modelos padrão: "🚨 *NOVO LEAD NO CRM!*" (nome, origem, campanha) e "📅 *NOVA R1 AGENDADA!*" (lead, data, horário, link da call).
- **Envio:** fila `wa_automation_log`, preenchida na mesma transação do evento e enviada logo depois da requisição (o roteador envia a fila após cada ação que altera dados) e pelas rotinas (fila de leads a cada 15 minutos e a de 5 minutos), que tentam de novo as falhas (até 3 vezes nas últimas 6 horas). Situações: na fila, enviada, enviada (modo de teste), falhou (com o motivo), responsável sem WhatsApp, sem número para enviar.
- **API:** `GET/PUT /api/whatsapp/avisos`, `POST /api/whatsapp/avisos/teste` (envia ao próprio WhatsApp do administrador um exemplo com dados fictícios).


## 21. Agente de IA no n8n (fluxo na VPS, 24 horas)

Provedor **Fluxo do n8n na VPS** na tela do agente (seção 19). A IA roda num fluxo do n8n instalado na mesma VPS do conector (`deploy/n8n/instalar-n8n.sh`, guia em `deploy/n8n/LEIA-ME.md`); o CRM continua decidindo quando a IA atende e enviando as mensagens. Serviço: `server/services/n8n.js`.

- **Caminho:** o conector avisa o n8n de cada mensagem pelo webhook global (`WEBHOOK_GLOBAL_URL=http://n8n:5678/webhook/vero-whatsapp`, só `MESSAGES_UPSERT`, pela rede interna da VPS; de fora, o Caddy responde 403 nesse caminho). O aviso de cada número para o CRM continua (status, conexão, QR), com tentativas curtas (`WEBHOOK_REQUEST_TIMEOUT_MS=8000`, 2 tentativas) porque a Evolution envia o aviso do número antes do global.
- **Mesmas regras do agente do CRM** (`waagent.gate`): agente ligado, número central, modo de teste, conversa com o especialista (Assumir/Devolver, resposta de uma pessoa pelo CRM ou celular), conversa que a equipe já atendia, oposição a contato. Com o provedor n8n, o agente interno não responde (`onInbound` devolve nada); `ready` exige o token.
- **Token:** gerado em Integrações › Agente de IA no WhatsApp (`POST /api/whatsapp/agente/n8n/token`, só administrador), mostrado uma vez e guardado como hash em `settings.wa_agent.n8n_token_hash`. O n8n manda `Authorization: Bearer crm_n8n_...`. A tela mostra o endereço do CRM, o final do token e o último contato do n8n.
- **API (token do n8n):**
  - `GET /api/integracoes/n8n/status`: conferência (usada pelo instalador): agente ligado, provedor, número central, modo de teste.
  - `POST /api/integracoes/n8n/mensagem` com o corpo do aviso da Evolution (`{event, instance, data}`): registra a mensagem (sem duplicar a que chegou pelo aviso do número ou pela busca no conector; serve também de caminho de recebimento). Junta mensagens seguidas (`WA_AGENT_DEBOUNCE_MS`), pega a trava da conversa (espera até `N8N_WAIT_LOCK_MS`, padrão 35 s; trava de 180 s) e cria o lead se preciso. Resposta: `{atender, motivo, conversa_id, turno, sistema, mensagem, lead, modelo_gemini, urls: {acao, responder}}`. `sistema` = instruções do agente + dados do lead + histórico em texto; `mensagem` = as mensagens do cliente depois da última resposta. Motivos sem atendimento: `evento_ignorado`, `numero_desconhecido`, `mensagem_da_equipe`, `mensagem_ignorada`, `ia_desligada`, `fora_do_numero_central`, `modo_de_teste`, `com_especialista`, `equipe_ja_atendia`, `sem_token_n8n`, `agente_do_crm`, `nova_mensagem`, `ocupada`, `ja_respondida`, `bloqueado`.
  - `POST /api/integracoes/n8n/acao/:acao` `{conversa_id, turno, dados}`: as mesmas ferramentas do agente do CRM (`salvar_triagem`, `salvar_qualificacao`, `horarios_r1`, `agendar_r1`, `transferir_especialista`, `encerrar_sem_fit`). Campos vazios, nulos ou zero ficam de fora. Turno que não é o atual: 409.
  - `POST /api/integracoes/n8n/responder` `{conversa_id, turno, texto | erro, tokens_entrada, tokens_saida}`: o CRM envia pelo conector como mensagem da IA, registra o uso e libera a trava. Com `erro`, manda a mensagem de cortesia e passa ao especialista. Se o especialista assumiu durante o turno, não envia.
  - `GET /api/integracoes/n8n/pendentes` e `POST /api/integracoes/n8n/retomar`: conversas devolvidas à IA (botão "Devolver para a IA") com mensagens do lead sem resposta ficam marcadas (`wa_conversations.ai_resume_at`). O fluxo de retomada confere a cada minuto e chama o atendimento. `/retomar` pega a mais antiga e devolve o mesmo retorno de `/mensagem`, sem espera e com o aviso de retomada no roteiro.
  - `GET /api/integracoes/n8n/conhecimento`: documentos para a base de conhecimento: a base da IA do CRM, o critério de fit, as orientações e, com a opção ligada, as transcrições das R1 (até 200) sem e-mail, telefone, CPF/CNPJ e nome do cliente.
- **Devolver para a IA:** a mensagem de cortesia (falha da IA) não conta como resposta nem entra no histórico. Ao devolver, se houver mensagens do lead sem resposta de verdade, o agente do CRM responde na hora (sem a espera de mensagens seguidas). Com o provedor n8n, a conversa fica marcada para o fluxo de retomada (até 1 minuto). Sem nada pendente, a IA espera a próxima mensagem do lead.
- **Roteiro de qualificação:** o prompt do agente (CRM e n8n) conduz por etapas: abertura, as 6 perguntas da triagem (uma por mensagem, pulando as já respondidas), complemento, e a decisão (R1 com fit, encerrar sem fit). Toda mensagem termina com a próxima pergunta, nunca só com agradecimento. Os dados do lead trazem `faltam_na_triagem` e `proximo_passo`. A tela do agente mostra as falhas da IA das últimas 24 horas (`last_error`), com a causa provável; nelas, o lead recebe só a mensagem de cortesia.
- **Memória fixa (pasta do Drive):** no fluxo de atendimento, o nó "Diretrizes da Vero" remonta o texto de cada arquivo do Drive a partir dos trechos guardados (sem sobreposição; ordem por página e linha; até 15 mil caracteres por arquivo). O texto entra na mensagem de sistema da IA em toda mensagem, em ordem de nome e com até 40 mil caracteres no total: critérios de qualificação, regras, proibições, guardrails e objeções. O agente tenta de novo uma vez (5 s) antes de cair na mensagem de cortesia. Na falha, o nó "Conferir o Gemini" repete um pedido mínimo (`generateContent`, 1 token) ao mesmo modelo, com a mesma credencial, e manda ao CRM o motivo do Google. Exemplos: `PERMISSION_DENIED · SERVICE_DISABLED`, ou "The Gemini API free tier is not available for this project… set up billing". Isso porque o erro do agente vem genérico ("Forbidden - perhaps check your credentials?"). A tela do agente traduz o motivo: plano gratuito indisponível (ativar o faturamento), API desativada no projeto, chave inválida, restrição, limite, região, modelo. O instalador pergunta o link da pasta (`DRIVE_PASTA`) e o põe no fluxo do Drive; trocar a pasta reimporta só esse fluxo.
- **Fluxos** (`deploy/n8n/*.json`, gerados por `npm run n8n:fluxos` a partir das ferramentas do agente):
  - **Atendimento:** webhook → Configuração (`crm_url`) → É mensagem? → CRM - Conversa → IA atende? → agente (Gemini com o modelo do CRM, `base_de_conhecimento` em PGVector e as 6 ações como HTTP Request Tool com `$fromAI`) → Responder no WhatsApp; a saída de erro do agente → Avisar falha ao CRM.
  - **Base do CRM:** todo dia às 3h, troca a cópia do CRM na tabela `vero_conhecimento`.
  - **Google Drive:** a pasta é informada num lugar só (nó "Pasta do Drive", aceita o link ou o ID). A cada hora (ou em "Importar agora") lista a pasta, compara com a base pelo `modifiedTime` guardado nos metadados, apaga as versões antigas e os arquivos que saíram da pasta e importa os novos ou alterados. Google Docs saem como texto, Planilhas como CSV e Apresentações como PDF; imagens, áudios e vídeos ficam de fora. O instalador cria a tabela `vero_conhecimento` e a credencial "Google Drive (Vero)" em branco, já ligada ao fluxo (só se ainda não existir). Testado com um Google Drive simulado: importação inicial, nada a fazer sem mudanças, arquivo alterado, arquivo removido, arquivos de outra pasta e imagem ignorados, e a IA respondendo com o conteúdo do Drive.
  - Prompt para o construtor de IA do n8n: `deploy/n8n/PROMPT-N8N.md`.
- **VPS:** n8n 2.49.6 (banco interno SQLite; o n8n 2.x pede Postgres 17 e o do conector é o 15), base de conhecimento num Postgres 17 com pgvector separado (`base-ia`), `N8N_LISTEN_ADDRESS=0.0.0.0` (VPS sem IPv6 no Docker), execuções guardadas por 14 dias. O instalador do conector reconhece o n8n (`n8n.env` + `docker-compose.n8n.yml`, `COMPOSE_FILE` no `.env`) e o mantém ao rodar de novo. O n8n usa cerca de 400 MB: recomendado VPS de 2 GB.
- **Caminho até o CRM:** algumas redes de VPS (Locaweb) não alcançam os endereços novos da Vercel (64.29.17.x, 216.198.79.x): a conexão fica esperando até o tempo acabar. Os instaladores testam `GET /api/saude`. Se o caminho normal não responde, testam outros endereços da Vercel (76.76.21.21, 76.76.21.98, 216.198.79.1, 64.29.17.1; a Vercel atende o site em qualquer um deles). O primeiro que responder fica fixo em `extra_hosts` do conector e do n8n (`crm.env`, `docker-compose.crm.yml`). Isso também resolve o aviso do conector ao CRM (respostas dos leads). Sem nenhum caminho, o instalador do n8n mostra um bloco de diagnóstico (DNS, cada endereço, GitHub, Vercel e Google) e para. No instalador do conector, o teste é opcional (`CRM_URL=...`).
- **Testes:** `test/api.test.js` (token, mensagem repassada, ações, resposta, ocupada, turno expirado, R1, Assumir/Devolver, falha, modo de teste, base de conhecimento). Teste ponta a ponta feito com os instaladores (conector + n8n) e um Gemini simulado: triagem, horários, R1 agendada, consulta à base, falha do modelo, Assumir/Devolver e mensagens seguidas.
