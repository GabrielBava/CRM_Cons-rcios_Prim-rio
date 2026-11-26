# Prompt para o construtor de IA do n8n (AI Workflow Builder)

Use este prompt para o n8n montar o fluxo de atendimento do WhatsApp sozinho, em qualquer conta: a trial de agora, a premium de depois ou outra. O mesmo prompt gera o mesmo fluxo.

> **Caminho mais garantido:** importe o arquivo pronto `fluxo-atendimento-whatsapp.json` (**Create › Import from file**). Na VPS, o instalador já importa e publica tudo sozinho. O construtor de IA pode variar um detalhe ou outro; use a lista de conferência no fim deste arquivo.

## Como usar

1. No n8n, crie um fluxo vazio (**Create workflow**).
2. Abra o construtor de IA (ícone de estrelinhas ou **Build with AI**).
3. Copie **todo** o bloco abaixo, cole e envie.
4. Quando o n8n terminar:
   1. Crie as credenciais (item 2 do prompt).
   2. Troque o endereço do CRM no nó **Configuração**.
   3. Confira com a lista de conferência.

## Prompt (copie tudo)

```text
Crie um fluxo chamado "Vero - Atendimento no WhatsApp (IA)" para atender leads de consórcio no WhatsApp com IA.
Um CRM próprio decide quando a IA atende e envia as respostas. Use exatamente estes nós, nomes e ligações:

1. Webhook "WhatsApp (conector)": método POST, caminho (path) "vero-whatsapp", responder imediatamente (Respond: Immediately).
   Recebe o aviso da Evolution API (WhatsApp), com o corpo {event, instance, data}.

2. Credenciais (crie as referências; eu preencho os valores):
   - "CRM Vero (token do n8n)": tipo Header Auth, nome do cabeçalho Authorization, valor "Bearer <token>".
   - "Google Gemini (Vero)": tipo Google Gemini (PaLM) API.
   - "Postgres da VPS (base de conhecimento)": tipo Postgres.

3. Set "Configuração": campo crm_url (texto) = "https://SEU-CRM.com.br", mantendo os demais campos (Include Other Input Fields).

4. IF "É mensagem?": continua só se {{ $json.body.event }} for igual a "messages.upsert". A saída falsa fica sem ligação.

5. HTTP Request "CRM - Conversa": POST para {{ $json.crm_url }}/api/integracoes/n8n/mensagem.
   - Autenticação: Generic Credential Type, Header Auth, credencial "CRM Vero (token do n8n)".
   - Corpo JSON: {{ JSON.stringify({ event: $json.body.event, instance: $json.body.instance, data: $json.body.data }) }}.
   - Tempo limite (timeout): 60000 ms. Ligue Retry On Fail com 3 tentativas e 3000 ms entre elas.
   - O CRM responde {atender, motivo, conversa_id, turno, sistema, mensagem, modelo_gemini, urls: {acao, responder}}.

6. IF "IA atende?": continua só se {{ $json.atender }} for verdadeiro (boolean true). A saída falsa fica sem ligação.

7. AI Agent "IA Vero":
   - Prompt definido abaixo (Define below): {{ $json.mensagem }}.
   - System Message: {{ $json.sistema }}.
   - Max Iterations: 10.
   - Em Settings, On Error: "Continue (using error output)".
   - Sem memória: o histórico da conversa já vem do CRM dentro de "sistema".

8. Google Gemini Chat Model "Gemini", ligado como Chat Model do "IA Vero".
   - Modelo: {{ $('CRM - Conversa').item.json.modelo_gemini || 'models/gemini-2.5-flash' }}.
   - Temperatura: 0.4.
   - Credencial "Google Gemini (Vero)".

9. Postgres PGVector Store "base_de_conhecimento", modo "Retrieve Documents (As Tool for AI Agent)", ligado como Tool do "IA Vero".
   - Tabela: vero_conhecimento. Limite: 4. Incluir metadados.
   - Credencial "Postgres da VPS (base de conhecimento)".
   - Descrição: "Busca na base de conhecimento da Vero (materiais sobre consórcio, planejamento, objeções, perguntas frequentes e trechos de conversas da equipe). Use antes de responder dúvidas sobre consórcio. Escreva a pergunta do cliente como consulta."
   - Ligue nele um Embeddings Google Gemini "Embeddings Gemini" (modelo models/gemini-embedding-001, credencial "Google Gemini (Vero)").

10. Seis HTTP Request Tool, ligados como Tool do "IA Vero".
   - O nome de cada nó é exatamente o nome da ferramenta abaixo.
   - Todos: POST, credencial "CRM Vero (token do n8n)" (Generic Credential Type, Header Auth), timeout 40000 ms.
   - URL: {{ $('CRM - Conversa').item.json.urls.acao }}/<nome da ferramenta>.
   - Corpo JSON:
     {{ JSON.stringify({ conversa_id: $('CRM - Conversa').item.json.conversa_id, turno: $('CRM - Conversa').item.json.turno, dados: { ...cada campo com $fromAI('campo', 'descrição', 'string') } }) }}.
   - Campos opcionais com valor padrão vazio: $fromAI('campo', 'descrição', 'string', '').
   - A descrição de cada ferramenta (Tool Description) é o texto depois do nome:
   - **salvar_triagem**: Registra no CRM as respostas da triagem do lead assim que o cliente responder (pode enviar só os campos já respondidos; chame de novo quando tiver mais). As 6 perguntas: interesse, dor/necessidade, impacto (prazo), decisor, faixa de investimento mensal e faixa de renda.
     - `interesse` (texto, opcional): O lead tem interesse real em seguir? Valores: sim, nao.
     - `dor` (texto, opcional): Existe uma dor ou necessidade clara? Valores: sim, nao.
     - `dor_descricao` (texto, opcional): Resumo curto da necessidade, nas palavras do cliente (ex.: "comprar o primeiro apartamento").
     - `impacto` (texto, opcional): Quando quer resolver: imediato = Imediato (até 30 dias); curto = Curto prazo (até 3 meses); medio = Médio prazo (3 a 12 meses); longo = Longo prazo (mais de 12 meses). Valores: imediato, curto, medio, longo.
     - `decisor` (texto, opcional): É quem decide: sim = Sim, decide sozinho; compartilhado = Decide com outra pessoa; nao = Não é o decisor. Valores: sim, compartilhado, nao.
     - `faixa_investimento` (texto, opcional): Quanto consegue investir por mês: ate_500 = Até R$ 500 por mês; 500_1000 = R$ 500 a R$ 1.000 por mês; 1000_2000 = R$ 1.000 a R$ 2.000 por mês; 2000_5000 = R$ 2.000 a R$ 5.000 por mês; acima_5000 = Acima de R$ 5.000 por mês. Valores: ate_500, 500_1000, 1000_2000, 2000_5000, acima_5000.
     - `faixa_renda` (texto, opcional): Renda mensal: ate_3k = Até R$ 3.000; 3k_6k = R$ 3.001 a R$ 6.000; 6k_10k = R$ 6.001 a R$ 10.000; 10k_20k = R$ 10.001 a R$ 20.000; 20k_40k = R$ 20.001 a R$ 40.000; acima_40k = Acima de R$ 40.000. Valores: ate_3k, 3k_6k, 6k_10k, 10k_20k, 20k_40k, acima_40k.
   - **salvar_qualificacao**: Registra detalhes da qualificação que o cliente contar espontaneamente (objetivo, valor do crédito, categoria, prazo, parcela, FGTS, lance). Só preenche campos vazios.
     - `objetivo` (texto, opcional): Objetivo: aquisicao = Aquisição; alavancagem = Alavancagem patrimonial; investimento = Investimento. Valores: aquisicao, alavancagem, investimento.
     - `categoria` (texto, opcional): Categoria: imovel = Imóvel; veiculo = Veículo; servico = Serviço; outra = Outra. Valores: imovel, veiculo, servico, outra.
     - `valor_credito` (número, opcional): Valor do crédito/bem desejado, em reais.
     - `prazo` (texto, opcional): Quando quer o crédito: curto = Curto prazo (até 3 meses); medio = Médio prazo (até 12 meses); longo = Longo prazo (24 meses ou mais). Valores: curto, medio, longo.
     - `parcela_maxima` (número, opcional): Parcela máxima mensal que cabe no orçamento, em reais.
     - `possui_fgts` (texto, opcional): FGTS: sim = Sim; nao = Não; nao_sabe = Não sabe. Valores: sim, nao, nao_sabe.
     - `recurso_para_lance` (texto, opcional): Tem recurso próprio para dar lance? Valores: sim, nao, nao_sabe.
     - `observacoes` (texto, opcional): Informações úteis para o especialista (até 300 caracteres).
   - **horarios_r1**: Lista horários livres para a reunião de apresentação (R1) com o especialista. Use só depois da triagem concluída e com fit. Ofereça 2 ou 3 opções ao cliente.
     - sem campos (o corpo leva só conversa_id e turno)
   - **agendar_r1**: Agenda a R1 no horário que o cliente escolheu (precisa ser um dos horários devolvidos por horarios_r1). Use só com a triagem concluída, interesse "sim" e fit.
     - `inicio` (texto, obrigatório): Início no formato ISO exatamente como veio em horarios_r1.
     - `email` (texto, opcional): E-mail do cliente para o convite (opcional).
   - **transferir_especialista**: Passa a conversa para um especialista humano (a IA para de responder). Use quando o cliente pedir uma pessoa, reclamar, já for cliente, perguntar valores, taxas, propostas, contratos ou algo que você não sabe, ou quando a conversa sair do objetivo.
     - `motivo` (texto, obrigatório): motivo.
   - **encerrar_sem_fit**: Registra que o lead não tem fit agora (ex.: sem interesse, sem capacidade de investimento, prazo muito distante) e passa para o especialista decidir (nutrição ou perdido). Despeça-se com cordialidade.
     - `motivo` (texto, obrigatório): motivo.

11. HTTP Request "Responder no WhatsApp", ligado na saída de sucesso do "IA Vero".
   - POST para {{ $('CRM - Conversa').item.json.urls.responder }}, credencial "CRM Vero (token do n8n)".
   - Corpo JSON: {{ JSON.stringify({ conversa_id: $('CRM - Conversa').item.json.conversa_id, turno: $('CRM - Conversa').item.json.turno, texto: $json.output }) }}.
   - Retry On Fail: 3 tentativas.

12. HTTP Request "Avisar falha ao CRM", ligado na saída de erro do "IA Vero".
   - POST para a mesma URL de "Responder no WhatsApp", com a mesma credencial.
   - Corpo JSON: {{ JSON.stringify({ conversa_id: $('CRM - Conversa').item.json.conversa_id, turno: $('CRM - Conversa').item.json.turno, erro: String($json.error?.message || $json.error || 'falha na IA') }) }}.

Não envie mensagens direto pela Evolution API: quem envia é o CRM, pelo "Responder no WhatsApp". Não crie memória de chat.
```

## Depois de gerar

1. **Credenciais:**
   - **CRM Vero (token do n8n)**: Header Auth, nome `Authorization`, valor `Bearer crm_n8n_...`. Gere o token no CRM: Integrações › Agente de IA no WhatsApp › Provedor "Fluxo do n8n na VPS" › Gerar token.
   - **Google Gemini (Vero)**: a chave do Google AI Studio.
   - **Postgres da VPS (base de conhecimento)**: na VPS, host `base-ia`, banco `base_ia`, usuário `vero` e a senha do arquivo `/opt/vero-whatsapp/base-ia.env`. O instalador já cria essa credencial.
2. **Endereço do CRM** no nó **Configuração** (ex.: `https://crm.veroconsorciosbr.com.br`).
3. **Publish.**

## Lista de conferência

- [ ] O webhook tem o path `vero-whatsapp`, POST e responde na hora.
- [ ] **CRM - Conversa** chama `/api/integracoes/n8n/mensagem` com o token, e **IA atende?** testa `atender`.
- [ ] Prompt do **IA Vero** = `{{ $json.mensagem }}`, System Message = `{{ $json.sistema }}` e On Error = saída de erro.
- [ ] O **IA Vero** tem as ferramentas `salvar_triagem`, `salvar_qualificacao`, `horarios_r1`, `agendar_r1`, `transferir_especialista`, `encerrar_sem_fit` e `base_de_conhecimento`, com esses nomes exatos.
- [ ] Cada ferramenta manda `conversa_id` e `turno` do nó **CRM - Conversa**.
- [ ] A saída de sucesso vai para **Responder no WhatsApp** (texto = `$json.output`), e a de erro para **Avisar falha ao CRM**.
- [ ] Nada envia mensagem direto pela Evolution API.

## Os outros dois fluxos

Os dois são simples. Importe os arquivos prontos:
- `fluxo-base-conhecimento-crm.json`: todo dia às 3h, `GET /api/integracoes/n8n/conhecimento`, apaga a cópia anterior do CRM e grava na tabela `vero_conhecimento` com os Embeddings Gemini.
- `fluxo-base-conhecimento-drive.json`: a cada hora, os arquivos de uma pasta do Google Drive entram na mesma tabela (novos e alterados entram; os que saem da pasta saem da base).

Arquivo gerado por `npm run n8n:fluxos` a partir das ferramentas do agente do CRM.
