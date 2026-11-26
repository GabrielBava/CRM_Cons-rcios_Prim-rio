# Agente de IA do WhatsApp no n8n (VPS, 24 horas)

O n8n roda na mesma VPS do conector do WhatsApp (Evolution API), ligado 24 horas. Ele atende os leads do número central com IA (Gemini) e usa a base de conhecimento da Vero. O **CRM continua no comando**: ligar e desligar a IA, Assumir/Devolver a conversa, modo de teste, triagem, agenda da R1 e o envio das mensagens.

```
Lead no WhatsApp
   │
   ▼
Conector (Evolution, na VPS) ──aviso de cada mensagem (rede interna)──▶ n8n (na VPS)
                                                                         │ 1. "CRM - Conversa": registra a mensagem e pergunta se a IA atende
                                                                         ▼
                                                                    CRM (Vercel)
                                                                         │ atende? (IA ligada, número central, modo de teste, Assumir/Devolver)
                                                                         ▼
                                                     n8n: "IA Vero" (Gemini + base de conhecimento + ações do CRM)
                                                                         │ 2. triagem, qualificação, horários, agendar R1, transferir
                                                                         │ 3. "Responder no WhatsApp": o CRM envia pelo conector
                                                                         ▼
                                                                Lead recebe a resposta
```

Arquivos desta pasta:

| Arquivo | Para quê |
|---|---|
| `instalar-n8n.sh` | Instala o n8n na VPS, liga ao conector e ao CRM, cria a sua conta e importa os fluxos. |
| `fluxo-atendimento-whatsapp.json` | Fluxo principal: atendimento dos leads com IA. |
| `fluxo-base-conhecimento-crm.json` | Todo dia às 3h, copia a base de conhecimento do CRM para o n8n. |
| `fluxo-base-conhecimento-drive.json` | (Opcional) Arquivos de uma pasta do Google Drive entram na base. |
| `PROMPT-N8N.md` | Prompt para o construtor de IA do n8n gerar o mesmo fluxo (conta trial, premium ou outra). |

Os fluxos são gerados a partir das ferramentas do agente do CRM (`npm run n8n:fluxos`), então os dois ficam sempre iguais.

---

## 1. Antes de começar

1. **Conector do WhatsApp instalado na VPS** (guia: [`deploy/whatsapp-lite/LEIA-ME.md`](../whatsapp-lite/LEIA-ME.md)) e o número central conectado no CRM pelo QR Code.
2. **VPS com 2 GB de RAM (recomendado).** O n8n usa uns 400 MB. Na VPS de 1 GB funciona com a memória de troca (o instalador cria), mas fica no limite. Na Locaweb, dá para mudar de plano no painel sem reinstalar.
3. **Endereço do n8n no DNS.** Na HostGator (Zona DNS de `veroconsorciosbr.com.br`), crie um registro **A**:
   - Nome: `n8n`
   - Aponta para: o **mesmo IP** da VPS (o mesmo do registro `whatsapp`)
   - TTL: 14400 (ou o padrão)

   Resultado: `n8n.veroconsorciosbr.com.br`. O DNS pode levar de alguns minutos a algumas horas para valer.
4. **Chave do Gemini:** em <https://aistudio.google.com> › **Get API key** › **Create API key**. É a mesma chave que o CRM usa (pode reaproveitar).
5. **CRM publicado com esta versão.** A integração com o n8n precisa estar no ar no CRM oficial (merge do PR na `main`).

## 2. No CRM: ligar o agente no modo n8n e gerar o token

Como administrador, vá em **Integrações › Agente de IA no WhatsApp** e preencha:

1. **Número central atendido pela IA:** o número do WhatsApp Lite.
2. **Provedor de IA:** **Fluxo do n8n na VPS (24 horas)**.
3. **Modelo do Gemini (usado pelo n8n):** por exemplo, `gemini-2.5-flash`. Use **Buscar os modelos da conta** para ver os disponíveis.
4. Clique em **Gerar token** e **copie o token** (começa com `crm_n8n_`). Ele aparece uma vez só; se perder, gere outro.
5. **Modo de teste (recomendado no começo):** coloque o seu celular para só ele ser atendido pela IA.
6. Marque **Ligar o agente de IA** e clique em **Salvar**.

Deixe a janela aberta: o quadro do n8n mostra **Último contato do n8n**, que muda quando a VPS conversa com o CRM.

## 3. Na VPS: instalar o n8n (um comando)

No Windows, abra o **PowerShell** e entre na VPS (como no guia do conector):

```
ssh root@IP-DA-VPS
```

Depois copie e cole as duas linhas:

```
curl -fsSL https://raw.githubusercontent.com/gabrielbava/crm_cons-rcios_prim-rio/HEAD/deploy/n8n/instalar-n8n.sh -o instalar-n8n.sh
sudo bash instalar-n8n.sh
```

O instalador pergunta:

| Pergunta | O que responder |
|---|---|
| Endereço do n8n | Enter para aceitar `n8n.veroconsorciosbr.com.br` |
| Endereço do CRM | `https://crm.veroconsorciosbr.com.br` (o endereço que você usa para entrar no CRM) |
| Token do n8n | cole o token do passo 2 (não aparece ao colar; é normal) e tecle Enter |
| Chave da API do Gemini | cole a chave (ou Enter para colocar depois no n8n) |
| Seu e-mail para entrar no n8n | o e-mail do seu login no n8n |

Para colar no PowerShell, clique com o **botão direito** do mouse.

O que ele faz sozinho:
- confere se a VPS fala com o CRM e se o token está certo;
- sobe o n8n e a base de conhecimento (Postgres com pgvector, separado do banco do WhatsApp);
- liga o aviso do conector para o n8n (pela rede interna da VPS);
- cria o HTTPS de `n8n.veroconsorciosbr.com.br`;
- cria as credenciais e a sua conta no n8n;
- importa e publica os fluxos.

No fim, ele mostra o endereço, o seu e-mail e a **senha inicial**. Para ver de novo: `vero-whatsapp dados`.

> Se o caminho normal até a Vercel não responder (já aconteceu na Locaweb: a conexão fica esperando), o instalador testa
> outros endereços da própria Vercel e fixa o que responder, no n8n e no conector. Ele avisa:
> "o endereço ... da Vercel responde". Isso também faz o conector voltar a avisar o CRM das respostas dos leads.
> Se aparecer "esta VPS não conseguiu falar com o CRM ... por nenhum caminho", confira o endereço do CRM no navegador
> e mande o bloco "copie daqui" que o instalador mostra (não tem senha nem token).
> Se aparecer "o CRM recusou o token", gere outro token no CRM e rode de novo.

## 4. Primeiro acesso ao n8n

1. Abra `https://n8n.veroconsorciosbr.com.br` e entre com o e-mail e a senha inicial.
2. Troque a senha: avatar (canto inferior esquerdo) › **Settings › Personal**.
3. Em **Overview** aparecem os três fluxos:
   - **Vero - Atendimento no WhatsApp (IA)**: publicado (Published).
   - **Vero - Base de conhecimento (CRM)**: publicado.
   - **Vero - Base de conhecimento (Google Drive)**: opcional (passo 6).
4. Em **Credentials** ficam:
   - **CRM Vero (token do n8n)**: o token do CRM.
   - **Google Gemini (Vero)**: a chave do Gemini. Se não informou no instalador, abra e cole a chave em **API Key**.
   - **Postgres da VPS (base de conhecimento)**: já configurada.
5. Abra **Vero - Base de conhecimento (CRM)** e clique em **Execute workflow** para preencher a base na hora. Depois ele roda sozinho todo dia às 3h.

## 5. Testar

1. Do celular que está no **modo de teste**, mande "Oi, quero saber do consórcio" para o número central.
2. No CRM, em **Comunicação › WhatsApp**, a conversa aparece com a resposta da IA (selo IA).
3. No n8n, no fluxo de atendimento, a aba **Executions** mostra cada mensagem: verde é sucesso.
   - Quando a IA não deve atender (IA desligada, conversa com o especialista, número fora do modo de teste), a execução para em **IA atende?**. Isso é normal.
4. Teste a triagem: "Quero comprar meu primeiro apartamento, tenho interesse, decido sozinho, consigo investir uns R$ 1.500 por mês e ganho uns R$ 12 mil". A IA registra a triagem no negócio, oferece horários e agenda a R1.
5. Funcionou? Apague o modo de teste no CRM e salve. A partir daí, a IA atende todos os leads do número central.

## 6. Base de conhecimento: a "memória" de consórcio da IA

A IA consulta a ferramenta **base_de_conhecimento** antes de responder dúvidas. Ela guarda trechos com busca por significado (pgvector), no Postgres da VPS. O conteúdo vem de três lugares.

**a) A base da IA do CRM** (perguntas, objeções, dicas, mensagens, o critério de fit e as orientações do agente): é copiada todo dia às 3h pelo fluxo **Vero - Base de conhecimento (CRM)**. Para atualizar, cadastre no CRM e rode o fluxo.

**b) Transcrições das R1 (ligações e reuniões já feitas):** no CRM, em **Integrações › Agente de IA no WhatsApp**, marque **Mandar as transcrições das R1 para a base de conhecimento do n8n**.
- Vão as transcrições anexadas aos negócios, sem nome, telefone, e-mail e CPF do cliente.
- A IA aprende como a equipe explica e contorna objeções, sem citar dados de outros clientes.

**c) Google Drive (opcional):** materiais, roteiros e transcrições de ligações em PDF, Word, Google Docs, TXT ou CSV.

1. No Google Cloud Console (o mesmo projeto do Google Agenda do CRM, ou um novo):
   1. Ative a **Google Drive API**.
   2. Em **Credenciais › Criar credenciais › ID do cliente OAuth** (tipo **Aplicativo da Web**), adicione o URI de redirecionamento: `https://n8n.veroconsorciosbr.com.br/rest/oauth2-credential/callback`.
2. No n8n:
   1. Em **Credentials › Add credential › Google Drive OAuth2 API**, cole o ID e a chave secreta do cliente.
   2. Clique em **Sign in with Google** e salve com o nome **Google Drive (Vero)**.
3. Crie no Drive uma pasta, por exemplo **Vero - Base IA**, e coloque os arquivos nela.
4. Abra o fluxo **Vero - Base de conhecimento (Google Drive)**:
   1. Nos dois gatilhos (**Arquivo novo na pasta** e **Arquivo alterado na pasta**), escolha a credencial e a pasta.
   2. No nó **Baixar arquivo**, escolha a credencial.
   3. Clique em **Publish**.

A cada hora, o fluxo confere a pasta. Arquivo alterado troca a versão anterior na base.

> Não coloque na pasta dados pessoais de clientes (CPF, telefone, valores de contratos): a IA pode usar o conteúdo nas respostas.

## 7. Ligar, desligar e assumir (igual ao agente do CRM)

| Quero... | Onde |
|---|---|
| Desligar a IA para todos | CRM › Integrações › Agente de IA no WhatsApp › desmarcar **Ligar o agente de IA** |
| Que a IA atenda só alguns números | mesmo lugar, **Modo de teste** |
| Assumir uma conversa | na conversa do CRM, **Assumir conversa** (a IA para) |
| Devolver para a IA | na conversa, **Devolver para a IA** |
| Voltar para a IA do próprio CRM (sem n8n) | Provedor de IA: Gemini ou Claude |

Quando alguém da equipe responde pelo CRM ou pelo celular, a IA para naquela conversa. A IA também passa a conversa para o especialista quando agenda a R1, quando o lead pede uma pessoa, quando não há fit ou quando o modelo falha (o lead recebe uma mensagem de cortesia).

## 8. Trocar o modelo de IA

- **Outro modelo do Gemini:** troque no CRM (**Modelo do Gemini**). O n8n usa esse valor na hora.
- **Outro provedor** (Claude, OpenAI etc.):
  1. No fluxo de atendimento, apague o nó **Gemini**.
  2. Ligue o modelo novo em **Chat Model** do nó **IA Vero**.
  3. A base de conhecimento continua com os **Embeddings Gemini**. Se trocar também os embeddings, rode de novo os fluxos de base de conhecimento.

## 9. Conta do n8n: trial, premium e VPS

- **O n8n da VPS é gratuito (Community Edition) e fica no ar 24 horas.** Ele não depende da conta trial do site do n8n.
- **Usar a conta do site do n8n** (trial agora, premium depois) para montar ou mexer no fluxo:
  - **Importar o arquivo pronto (recomendado):** em **Overview › Create › Import from file**, escolha `fluxo-atendimento-whatsapp.json` (e os outros). Depois crie as credenciais e troque o endereço do CRM no nó **Configuração**.
  - **Gerar com o construtor de IA do n8n:** use o prompt de [`PROMPT-N8N.md`](PROMPT-N8N.md). O resultado pode variar; confira com a lista do próprio arquivo.
- **Levar para outra conta** (ex.: a premium com outro e-mail):
  1. Na conta antiga, abra o fluxo › menu **…** › **Download**.
  2. Na conta nova, **Import from file**.
  3. Crie as credenciais de novo (o arquivo não leva senhas nem chaves).

  Na VPS não precisa fazer nada: o fluxo já está lá.
- **Produção fica na VPS.** O aviso do conector só chega ao n8n da VPS (rede interna); a base de conhecimento também está lá. Um n8n no site do n8n serve para montar e testar. Para ele atender de verdade, o conector teria de avisar um endereço público.

## 10. Manutenção

| Comando (na VPS) | Para quê |
|---|---|
| `vero-whatsapp situacao` | Situação do conector, do n8n e da memória |
| `vero-whatsapp registros-n8n` | Registros do n8n (Ctrl+C para sair) |
| `vero-whatsapp dados` | Endereços, login do n8n e chave do conector |
| `sudo bash instalar-n8n.sh` | Rodar de novo: atualiza a configuração e mantém conta, fluxos e credenciais. Também serve para trocar o token ou a chave (informe o novo valor). |
| `sudo REIMPORTAR=1 bash instalar-n8n.sh` | Troca os fluxos pelos originais (apaga as mudanças feitas neles no n8n) |

**Rodar de novo o instalador do conector** (`instalar-evolution.sh`) mantém o n8n: ele reconhece a instalação do n8n.

## 11. Problemas comuns

| Sintoma | O que fazer |
|---|---|
| A IA não responde e nada aparece em Executions no n8n | O conector não está avisando o n8n. Rode `sudo bash instalar-n8n.sh` de novo; confira `vero-whatsapp situacao` (n8n "Up"). |
| Executions param em **IA atende?** | O CRM disse que a IA não atende. Abra a execução e veja `motivo` no nó **CRM - Conversa**: `ia_desligada`, `modo_de_teste`, `com_especialista`, `equipe_ja_atendia`, `agente_do_crm` (o provedor no CRM não é o n8n), `ocupada` (outra resposta em andamento). |
| Erro 401 em **CRM - Conversa** | Token errado ou trocado. Gere outro no CRM e rode o instalador informando o novo token (ou edite a credencial **CRM Vero (token do n8n)**: valor `Bearer crm_n8n_...`). |
| Erro no nó **Gemini** / o lead recebe "um especialista vai continuar..." | Chave do Gemini inválida ou limite do plano gratuito. Confira a credencial **Google Gemini (Vero)** e o modelo no CRM. |
| "esta VPS não conseguiu falar com o CRM" | O instalador já testa os outros endereços da Vercel. Se nenhum responde, confira o endereço do CRM e mande o bloco "copie daqui". |
| `https://n8n...` não abre | Registro A do DNS (passo 1.3) e portas 80/443 liberadas no painel da VPS. O HTTPS sai sozinho quando o DNS valer. |
| VPS lenta ou o n8n reinicia sozinho | Pouca memória: passe a VPS para 2 GB. |

## 12. Segurança

- O endereço que o conector usa para avisar o n8n (`/webhook/vero-whatsapp`) só funciona dentro da VPS. De fora, ele responde 403.
- O token do n8n fica só como hash no CRM e criptografado no n8n. Os arquivos `n8n.env` e `base-ia.env` na VPS são só do root.
- O CRM confere cada ação da IA com a trava da conversa ("turno"). Uma resposta atrasada ou repetida é recusada e não chega ao lead.
- No plano gratuito do Gemini, o Google pode usar as conversas para melhorar os produtos. Para dados de clientes, prefira o plano pago.
