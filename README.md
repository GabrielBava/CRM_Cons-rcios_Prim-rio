# Vero Consórcios: ERP/CRM de consórcios primários

Plataforma de gestão da empresa inteira (consórcio, planejamento financeiro, seguros e investimentos), do primeiro contato ao pós-venda. No topo à direita ficam o sino de notificações e o menu do usuário (foto, Meu cadastro, Alterar senha e Sair). O menu lateral pode ser **recolhido** pelo botão no canto superior esquerdo (fica só o símbolo da Vero e os ícones) e é organizado em grupos:

- **Painel inicial**
- **Operacional:** Pipeline, Calendário (panorama 360 somente leitura: R1, R2, one-on-ones, tarefas e atividades por dia, semana, mês ou período), Agendas e tarefas, Propostas e Pré-venda
- **Comunicação:** Inbox (chat interno entre colaboradores, conversas diretas e grupos, com anexos), Tickets (chamados internos com responsável, prazo e anexos: aberto → em andamento → devolvido → concluído) e WhatsApp no jeito do WhatsApp (número oficial da empresa pela API do WhatsApp Business e **WhatsApp Lite**: o número de cada especialista, Business ou pessoal, conectado por QR Code; filtros Todas/Não lidas/Minhas, iniciais do responsável, etapa do lead no pipeline, anexos, áudio, emoji e painel Ver com IA Vero e conversão em reunião, proposta ou fechamento; ícone do WhatsApp no cartão do pipeline)
- **Ferramentas:** um só item com Simulador, Modelo da R1, Kit do especialista, Manual da marca, Importar leads e modelo da transcrição da R1
- **Gestão de vendas:** Clientes, Vendas, Pós-venda, Metas, Comissões e cancelamentos e Relatórios
- **Gestão do time** (líder de equipe para cima): Organograma do time, Dashboard squad, One-on-ones (o líder marca e aparece no calendário dos dois) e Distribuição de leads
- **Treinamentos**
- **Financeiro** (administrador)
- **Administração** (administrador): Administradoras, Planos, Colaboradores, Central de documentos, Usuários e Configurações

**Pipeline** (o mesmo para todas as áreas): 0 Prospect · 1 Lead · 2 Tentativa de contato · 3 Qualificação · 4 R1 · 5 R2 · 6 Negociação · 7 Venda, com Nutrição futura e Perdido arquivados (aparecem ao marcar "Mostrar arquivados" ou como áreas para soltar o cartão ao arrastar). O cartão mostra área responsável, origem e campanha, valor estimado, temperatura com PF/PJ, SLA da atividade, score (0–100), próxima ação e as marcas das reuniões: **NS** (amarelo, o cliente não compareceu), **R** (azul, remarcada), data da R1/R2 e "R2 não agendada". O painel do lead (clique no nome) traz **Ganho** (agendar a R1 = ganho do pré-vendas; abre o pop-up e completa a qualificação que faltar) e **Perdido** (só com ao menos uma atividade; motivos MP1 a MP9), o bloco **R1/R2** com Concluir, Remarcar, Não compareceu e Confirmar presença, e as abas Detalhes, Atividades (Telefone, WhatsApp, E-mail, Direct), Qualificação, Tarefas, Agendas, Notas, Propostas e Histórico.

**Financeiro** (caixa da empresa): Visão geral (só o administrador), Contas a pagar (pontual, parcelada, recorrente ou assinatura, com comprovante, responsável e motivo do atraso), Contas a receber (instituição pagadora, motivo, conta de entrada e rateio por competência) e Cadastros (categorias prontas, centros de custo, parceiros, contas bancárias e formas de pagamento).

A ficha do cliente tem 9 blocos, com documentos validados, financeiro, pós-venda e pesquisa NPS por link. As integrações com discadora, simulador, Meta Ads, WhatsApp e agenda externa estão preparadas ou marcadas como pendentes até serem validadas.

- **Especificação funcional (telas, funil, permissões e módulo ERP):** [`docs/ESPECIFICACAO.md`](docs/ESPECIFICACAO.md)
- **Contratos de integração (discadora, simulador, leads, WhatsApp):** [`docs/INTEGRACOES.md`](docs/INTEGRACOES.md)
- **Agente de IA no WhatsApp:** no número central, a IA (Google Gemini, padrão e com plano gratuito, ou Anthropic Claude, trocáveis a qualquer momento) atende o lead na hora, faz a triagem, registra no CRM e, com fit, agenda a R1 na agenda do especialista; depois passa a conversa para ele (que pode assumir a qualquer momento). Conector do WhatsApp Lite para VPS (Locaweb ou outra): [`deploy/whatsapp-lite/LEIA-ME.md`](deploy/whatsapp-lite/LEIA-ME.md). Detalhes: [`docs/INTEGRACOES.md`](docs/INTEGRACOES.md#19-agente-de-ia-no-whatsapp-atendimento-e-qualificação-no-número-central)
- **Tela Integrações:** cartões por categoria (Mensageria, Voz, Marketing, Produtividade, Sistema). Especialista vê as de uso pessoal (WhatsApp Lite, Instagram, LinkedIn, Google Agenda); líder e administrador veem todas. WhatsApp Lite com acesso dos membros (Sem acesso, Só ver, Ver e enviar): [`docs/INTEGRACOES.md`](docs/INTEGRACOES.md#18-tela-integrações-e-whatsapp-lite-qr-code)
- **Modelo de dados (DDL completo e relacionamentos):** [`docs/DDL.sql`](docs/DDL.sql) e [`docs/MODELO_DE_DADOS.md`](docs/MODELO_DE_DADOS.md), gerados por `node scripts/ddl.js`

## Identidade visual

A interface segue o manual da marca v1.0 (aplicações e diretrizes, elementos de interface, paleta de cores e tipografia). A aplicação da marca não mudou nenhuma regra de negócio.

- `public/css/tokens.css`: tokens oficiais (paleta, tipografia, raios, espaçamentos, sombras e os temas escuro e claro).
- `public/css/brand.css`: componentes (moldura, menu lateral flutuante, pílulas, cards, indicadores, tabelas, funil, janelas e painel lateral).
- `public/js/icons.js`: ícones de traço no estilo Lucide (24×24, traço 1,7).
- **Tema:** escuro por padrão. Sem escolha do usuário, segue o sistema operacional; o botão Claro/Escuro no topo guarda a escolha no navegador.
- **Fontes:** Poppins nos textos e Manrope no lugar da Famels (fonte comercial) até a licença. Com a licença, copie `Famels-Regular.woff2` e `Famels-Italic.woff2` para `public/fonts/` e acrescente `url("/fonts/Famels-Regular.woff2") format("woff2")` (e o equivalente do itálico) ao `src` das regras `@font-face` em `tokens.css`.
- **Logo:** Vero Consórcios (`public/img`): versão com texto claro no tema escuro e versão com texto escuro no tema claro, trocadas automaticamente com o tema. Aparece no menu lateral, no login, na ficha e na pesquisa abertas pelo cliente; o "V" é o ícone da aba. O nome da empresa (Configurações › Geral) vem como "Vero Consórcios".

## Requisitos

- Node.js **22.13 ou superior**. O projeto usa o SQLite embutido no Node (`node:sqlite`).
- Não há dependências externas, então não é preciso rodar `npm install`.

## Como executar

**Teste local completo (CRM + simulador + landing page):** `npm run local` (ou `iniciar-windows.bat` / `iniciar-mac-linux.sh`). Cria o banco de demonstração na primeira vez e serve o CRM em `/`, a landing page em `/lp/` e o simulador em `/simulador/`. Roteiro passo a passo em [`TESTE-LOCAL.md`](TESTE-LOCAL.md).

```bash
npm start                    # http://localhost:3000
```

No primeiro acesso, a tela pede a criação do usuário **administrador**. Não existe senha padrão.

Variáveis de ambiente:

| Variável | Padrão | Uso |
|---|---|---|
| `PORT` | `3000` | Porta HTTP |
| `HOST` | `127.0.0.1` | Use `0.0.0.0` para expor na rede, atrás de um proxy HTTPS |
| `CRM_DB` | `data/crm.db` | Arquivo do banco SQLite. Faça backup desse arquivo. |
| `CRM_SECRET_KEY` | arquivo `<banco>.key` | Chave que cifra segredos no banco (senha do portal das administradoras). Sem a variável, o servidor cria o arquivo `<banco>.key` na primeira execução. |
| `CRM_SESSION_HOURS` | `12` | Duração da sessão |
| `COOKIE_SECURE` | — | `1` para marcar o cookie como `Secure`. É aplicado automaticamente quando o proxy envia `X-Forwarded-Proto: https`. |

### Dados de demonstração (fictícios)

```bash
CRM_DB=data/demo.db DEMO_PASSWORD=uma-senha npm run demo
CRM_DB=data/demo.db npm start
```

O comando cria os usuários de demonstração:

- `admin@demo.local` (administrador);
- `gestora@demo.local` (líder de equipe);
- `consultor1@demo.local` e `consultor2@demo.local` (especialistas);
- `leitura@demo.local` (somente leitura);
- `novo@demo.local` (especialista recém-contratado: troca a senha provisória no primeiro acesso e segue a trilha de integração).

Também cria dados fictícios:

- 2 administradoras e 4 planos;
- 24 leads em todas as etapas do funil;
- propostas na esteira de follow-up;
- pré-vendas;
- 1 venda confirmada, 1 aguardando pagamento e 1 cancelada;
- comissões, metas e treinamentos;
- financeiro da empresa: 3 contas, fornecedores e pagadores, aluguel, salários, tráfego pago, assinaturas (CRM mensal com renovação próxima e simulador anual), compra parcelada, contas a pagar e a receber atrasadas (com e sem motivo), comissões recebidas e uma nota de R$ 100 mil rateada em 4 meses de competência.

O comando não roda em um banco que já tenha cadastros.

### Versão de teste no navegador (sem servidor)

```bash
npm install                  # instala o sql.js (só para montar a versão de teste)
npm run build:preview        # gera dist/preview/
```

O comando empacota o mesmo servidor, com um SQLite compilado para JavaScript (sql.js), para rodar dentro do navegador. A pasta gerada pode ser publicada como página estática. Os dados ficam só no navegador de quem abre a página. Na primeira visita são carregados dados fictícios, e uma barra no topo permite trocar de usuário e recomeçar do zero. Nessa versão a senha usa uma derivação simplificada e o download de arquivos fica desativado. **Ela serve apenas para testes.**

### Testes

```bash
npm test
```

Os testes automatizados cobrem:

- deduplicação de cadastros;
- permissões por perfil;
- proteção CSRF;
- regras do funil (passagem sequencial, critérios de entrada, voltar com motivo, forçar com justificativa, perda e nutrição);
- venda só pela confirmação do pagamento (pré-venda → termo → contrato → boleto → comprovante) e conversão em cliente;
- comissões em parcelas com carência, pagamento, cancelamento com estorno e índice por especialista;
- planos (faixa de crédito com incremento) e visão restrita das administradoras;
- esteira de follow-up das propostas, resposta do cliente e chance de fechamento;
- distribuição pela roleta e tarefa de primeiro contato;
- metas por especialista e equipe;
- permissões por módulo (incluir e retirar telas por usuário);
- treinamentos com questionário e acompanhamento;
- ficha do cliente pela pré-venda (acesso e conclusão pelo link);
- Meu cadastro (dados e foto do usuário) e troca de senha (senha atual, confirmação, política e encerramento das outras sessões);
- notificações (lead distribuído, transferência, segurança) e leitura;
- funil: valor pela proposta, busca por telefone/e-mail e ações em massa (etapa e responsável);
- exportação CSV exclusiva do administrador;
- recusa de proposta com motivo, retomada agendada e motivos de recusa;
- lista de clientes com responsáveis, cartas, crédito e filtros;
- pós-venda (checklist automático, responsável, NPS com motivo e tratativa, histórico de estratégias de lance);
- bloqueio por oposição a contato;
- idempotência e fila da discadora;
- token e vínculo do simulador;
- versões de propostas;
- API de leads;
- importação CSV;
- mesclagem de cadastros;
- relatórios;
- checklist de venda (bloqueio da conferência da pré-venda com a ficha incompleta);
- documentos (escopo e tipos de arquivo);
- link para o cliente (acesso, atualização, expiração e revogação);
- aceite e recusa de proposta;
- financeiro (geração de parcelas, pagamento, atraso com tarefa, escopo e relatório);
- link de cadastro (um ativo por vez, acessos, revogação ao inativar o cadastro);
- documentos (aprovação automática da equipe, validação dos enviados pelo cliente, vínculo com várias vendas, validade);
- pós-venda (pesquisa NPS por link, cancelamento justificado, estratégia de lance);
- simulação rápida e abertura do simulador de propostas com nome e contato;
- leads de formulário direto em Tentativa de contato com roleta na entrada; importação com validação e remoção de duplicados;
- temperatura quente/morno/frio pela qualificação e transcrição da R1 completando só campos vazios;
- senha do portal da administradora cifrada (só o administrador vê) e produto contratado com parcela inicial/atual e contemplação;
- financeiro da empresa (cadastros prontos, despesa parcelada, atraso com motivo e aviso ao administrador, baixa com comprovante, assinatura com renovação, recorrente anual, rateio por competência e visão geral só do administrador).

## Estrutura

```
server/
  app.js            rotas HTTP, segurança (CSP, CSRF), arquivos estáticos
  db.js             esquema SQLite e valores iniciais configuráveis
  core.js           escopo de acesso por perfil, auditoria
  auth.js           sessões e login
  services/         regras de negócio (cadastros, funil, atividades, tarefas, discadora,
                    simulações, propostas, clientes, entradas de integração, relatórios,
                    importação/exportação, administração, ficha e documentos
                    (record.js), financeiro (finance.js), regras do funil (pipeline.js),
                    administradoras e planos (catalog.js), pré-venda, vendas, comissões e
                    cancelamentos (sales.js), metas (goals.js), distribuição (distribution.js),
                    treinamentos (trainings.js), painel inicial (home.js), pós-venda (postsale.js),
                    notificações (notifications.js), Meu cadastro (profile.js),
                    financeiro da empresa: contas a pagar e a receber (treasury.js))
  permissions.js    perfis e módulos (telas) liberados por usuário
public/             interface web (HTML + CSS + JavaScript em módulos, sem build).
                    A página do cliente (#/ficha/<token>) não exige login.
scripts/demo-data.js
test/api.test.js
docs/
```

## Novo especialista, R1 e ficha do cliente

- **Primeiro acesso:** o usuário criado pelo administrador recebe uma senha provisória; a plataforma só abre depois da troca. Especialistas seguem a trilha do Painel inicial (Meu cadastro, Conheça a Vero, Kit do especialista) e, no fim, o treinamento de consórcios é liberado em Treinamentos.
- **Agendar R1 / R2:** o mesmo pop-up no pipeline (arrastar para R1 ou R2, botão Ganho), no painel lateral, na ficha e na Agenda (a R2 tem 60 minutos por padrão e título "[R2] Cliente | Vero Consórcios"): cliente e e-mail, horários de 15 em 15 minutos, 30 minutos por padrão, título "[R1] Cliente | Vero Consórcios". Com o Google Agenda conectado, o clique em "Agendar R1" já cria o evento na agenda do especialista com Google Meet, envia o convite ao cliente, salva o link na R1 e libera o modelo da R1 para baixar. O cliente recebe também a confirmação por e-mail (remetente `noreply@`). O pop-up oferece "Conectar Google Agenda" a quem ainda não conectou.
- **R1 feita (presença pelo Google Meet):** a cada 5 minutos o CRM confere a sala do Meet das R1 em andamento (API do Google Meet). Conta como "R1 feita" quando há pelo menos 2 participantes e ao menos um é de fora da empresa (o cliente); o especialista sozinho, ou só pessoas da empresa, não conta. A reunião é concluída como realizada no horário em que o cliente entrou, e o especialista é avisado. Botão "Verificar presença" para conferir na hora.
- **Modelo da R1:** o modelo oficial da Vero (13 seções com notas do apresentador), preenchido com nome, foto, WhatsApp, e-mail, cargo e apresentação do especialista e o nome do cliente; abre ou baixa (HTML) pela reunião. O administrador troca o modelo em Configurações › Modelo da R1 (campos `{{...}}`).
- **Planos:** a proposta e o simulador usam só as administradoras e os planos ativos (pelo código), mais a opção "Outros" com condições livres.
- **Ficha do cliente:** abre só com os 4 últimos dígitos do celular; campos obrigatórios vazios ficam em vermelho sem perder o que foi digitado; documentos obrigatórios: identificação e comprovante de endereço (foto ou PDF). Envio por WhatsApp (modelo) ou por e-mail visual (SMTP, remetente `noreply@veroconsorciosbr.com.br`).

## Colaboradores, Central de documentos e Relatórios

- **Colaboradores (RH):** identificação completa (CPF, RG, nascimento, contatos, e-mail pessoal e corporativo, endereço, contato de emergência), organização (cargo, função, time, líder direto, centro de custo, entrada), situação (ativo, férias, afastado, desligado com data, tipo e motivo), modelo contratual (CLT com PIS/CTPS e jornada; PJ com razão social e CNPJ; estágio; prestador; sócio), contratos com vigência e arquivo anexo, remuneração fixa, variável ou híbrida, benefícios e descontos de mercado, dados bancários, documentos e histórico. Módulo "Colaboradores": padrão só do administrador, pode ser liberado a um usuário de RH.
- **Central de documentos:** só o administrador. Pastas padrão (societário, fiscal e tributário, jurídico, licenças e certidões, gestão, RH, financeiro, marca) e subpastas; cada arquivo com número, órgão emissor, emissão e validade (alerta 30 dias antes), versões anteriores guardadas e downloads auditados.
- **Relatórios por perfil:** o especialista vê só "Meu desempenho" (as próprias vendas e comissões), sem dados de leads e sem exportar. O líder vê os comerciais da equipe. RH (módulo Colaboradores): quadro, cadastro, remuneração e custo, contratos, admissões/desligamentos/turnover e aniversariantes. Administrador: vendas gerais, fluxo de caixa, saldos e excedente de caixa (reserva mínima em Configurações), contas a pagar e a receber e resultado por categoria; exporta em Excel (.xlsx) cada relatório ou o pacote completo.
- **Conexão BI:** Configurações › Integrações › Conexão BI gera o token; `GET /api/bi` lista as bases (vendas, comissões, funil, propostas, financeiro, colaboradores, benefícios, metas e atividades) em JSON ou CSV para Power BI, Looker Studio ou Excel. Detalhes em `docs/INTEGRACOES.md`.

## Painel do lead, regras do funil, produtos, diagnóstico e IA Vero

- **Painel do lead:** uma coluna, com Ganho (verde) e Perdido (vermelho), telefone que copia, WhatsApp da empresa e abas IA Vero, Detalhes (ingresso, primeiro contato, prazo da R1 e previsão de fechamento), Atividades (registro por canal e totais), Qualificação (Concluir qualificação), Agendas (R1/R2 e contadores), Produtos, Diagnóstico, Tarefas, Notas, Propostas e Histórico.
- **Regras do funil:** Lead → Tentativa com uma tentativa registrada; Tentativa → Qualificação com a qualificação concluída; Qualificação → R1 com a R1 agendada; R1 → R2 com a R2 agendada; R2 → Negociação com proposta gerada (consórcio, seguros, planejamento ou investimentos). **Pipeline › Perdidos** (líder e administrador) mostra onde e por que (MP) os leads foram perdidos.
- **Produtos (cross-sell/up-sell)**, **Diagnóstico financeiro** (ferramenta da Vero Planejamento ligada ao CRM) e **IA Vero** (motor interno + IA generativa opcional): detalhes em `docs/ESPECIFICACAO.md` §20 e `docs/INTEGRACOES.md` §11–12.
- **Ferramentas por área:** Consórcio só com o **Simulador de consórcio** (abre ligado ao cliente, com nome e contato preenchidos) e Planejamento só com o **Diagnóstico financeiro** (ligado ao lead e salvo no CRM). Arquivos em `public/ferramentas/`, gerados por `node scripts/build-tools.js --diag <Diagnostico-Vero.html> --sim <Simulador_Consorcio_Vero.html>` (as versões Vero v1 são copiadas com a trava e a ponte do CRM). Detalhes em `docs/INTEGRACOES.md` §12.

## Tela responsiva, filtros e painel do lead v5

- **Responsivo:** fonte base fluida (notebook ≈14,5px, Full HD 16px, 2560px 18px), conteúdo sem largura fixa, menu recolhido automaticamente entre 761 e 1279px, tabelas com rolagem própria e pop-ups ajustados à tela.
- **Pipeline:** busca, ordenação e botão **Filtros** numa linha (responsável, área, origem, etapa, próxima ação, prioridade, data de criação de/até e valor mínimo/máximo), com etiquetas removíveis.
- **Painel do lead:** IA Vero em formato de chat (orbe animado, atalhos, histórico de conversas e fontes) com Análise e Resumo; Detalhes em blocos Dados e Negociação; aba **Arquivos**; R2 liberada só depois da R1 concluída. Detalhes em `docs/ESPECIFICACAO.md` §21.

## Painel 360, propostas rastreáveis e BI do time

- **Painel inicial 360:** filtro único de período, 7 indicadores do topo, ganhos/perdidos de 7 dias, calendário de 5 dias, pipeline horizontal com TMA, ranking da squad, meta e insights da IA Vero.
- **Recomendações** no painel do lead (importa as do diagnóstico; o "+" cadastra a indicação no pipeline).
- **Propostas:** Kanban pela régua Dia 0-2-5-9-14-21 e Lista; **link on-line rastreável** para o cliente (Aguardando/Lido/Avançar, tempo e acessos), PDF, modelo de WhatsApp, carta contemplada e proposta do planejamento gerada pelo diagnóstico.
- **BI do time** (líder e administrador) e bloco **Consórcios** no menu. Detalhes em `docs/ESPECIFICACAO.md` §22.

## Diagnóstico pelo lead, triagem e tarefas de aproximação

- **Diagnóstico** só pelo painel do lead (trava na ferramenta avulsa), sem refazer, com resumo (Nota/Estrela Vero, Bússola e Matriz) e proposta do planejamento por modelo (implementação ou Plataforma Exclusiva).
- **Novo lead em blocos** (Dados, Origem, Área, Geral) com alerta de duplicidade que não impede o cadastro.
- **Painel do lead:** atividade com resultado e próxima ação; tarefas de aproximação que só se concluem registrando o que foi feito; **triagem** de 6 perguntas obrigatória para a R1; agendas e propostas reorganizadas; opções da proposta num botão só.
- **Menu:** grupo Ferramentas e Treinamentos (só os dois itens); Gestão do time com Organograma, Dashboard, BI e Distribuição de leads. **BI** com no-show R1/R2, TMA (tempo na etapa) e TME (sem atividade) em horas e receita com planejamento. Detalhes em `docs/ESPECIFICACAO.md` §23.

## LPs ligadas ao CRM e rastreio (UTM)

- **LP Consórcios** (`index.html` da hospedagem) e **LP Planejamento** (`lp-planejamento.html`) enviam cada cadastro ao CRM: origem LP, área do formulário, negócio em Tentativa de contato e todas as respostas na nota "Formulário da LP".
- **Rastreio:** `public/lp/vero-rastreio.js` (primeiro e último toque, UTMs e gclid/fbclid) embutido pelo `scripts/preparar-lp.js`, que também serve para as LPs futuras (seguros, investimentos, temas).
- **Ferramentas › LPs e rastreio:** LPs cadastradas, gerador de links no padrão de UTM da Vero, desempenho por campanha e download das LPs configuradas. Detalhes em `docs/INTEGRACOES.md` §15.

## Domínio e cópia de teste no Supabase

- **Produção em `crm.veroconsorciosbr.com.br`:** registro A `crm` no DNS apontando para o servidor e `sudo DOMINIO=crm.veroconsorciosbr.com.br DEMO=0 bash deploy/instalar-ubuntu.sh` (HTTPS automático). O CRM fica fora dos buscadores (`robots.txt` e `X-Robots-Tag`).
- **Supabase:** `npm run supabase -- --arquivo crm_teste.sql` (para colar no SQL Editor) ou `--enviar` com `SUPABASE_ACCESS_TOKEN` e `SUPABASE_PROJECT_REF`: cópia do banco no schema `crm_teste`, sem senhas, tokens nem sessões. Detalhes em `docs/INTEGRACOES.md` §16.

## Vercel + Supabase

O CRM roda na Vercel com o banco no Supabase (Postgres) sem mudar uma linha: basta `DATABASE_URL` (Session pooler do Supabase). Sem ela, continua no SQLite. Passo a passo em `TESTE-LOCAL.md` (seção 4) e detalhes em `docs/INTEGRACOES.md` §17. Testes no Postgres: `TEST_DATABASE_URL=… npm run test:pg`.

## Configuração local (senhas e chaves)

Senhas e chaves (Google, SMTP) ficam no arquivo `config.env`, na pasta do sistema, fora do Git (`.gitignore`). Modelo em `config.env.exemplo`. O servidor lê o arquivo ao iniciar (`npm start`, `npm run local` e os atalhos) e o instalador do Ubuntu o leva para `/etc/vero-consorcios.env`.

## Produção

- **Instalação em Ubuntu (VM local ou na nuvem):** `sudo DOMINIO=crm.seudominio.com.br bash deploy/instalar-ubuntu.sh` instala o Node.js 22, cria o serviço `vero-consorcios` (systemd), o banco em `/var/lib/vero-consorcios`, a configuração em `/etc/vero-consorcios.env` e o HTTPS (Caddy). Sem `DOMINIO`, responde na porta 3000. Para uma VM local de teste: `vagrant up` (ver `Vagrantfile` e TESTE-LOCAL.md).

- Rode a aplicação atrás de um proxy HTTPS (Nginx, Caddy ou o balanceador da nuvem) com `HOST=0.0.0.0`.
- Faça backup periódico do arquivo definido em `CRM_DB`, junto com os arquivos `-wal` e `-shm` e a chave `<banco>.key` (sem ela, as senhas de portal guardadas não podem ser abertas).
- Tokens de integração são exibidos uma única vez. No banco fica apenas o hash.
- **Google Agenda (R1 com Meet):** defina `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` (ou configure em Configurações › Integrações) e `PUBLIC_URL` com o endereço público do CRM. Cadastre no Google Cloud o URI de retorno `PUBLIC_URL/api/google/retorno`.
- **E-mails automáticos (ficha e R1 agendada):** configure o SMTP em Configurações › Integrações › E-mail ou no `config.env` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`). Remetente padrão: `noreply@veroconsorciosbr.com.br`.
