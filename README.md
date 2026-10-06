# Vero Consórcios: ERP/CRM de consórcios primários

ERP/CRM para a venda de consórcios contratados do zero, do primeiro contato ao pós-venda. No topo à direita ficam o sino de notificações e o menu do usuário (foto, Meu cadastro, Alterar senha e Sair). O menu lateral tem 17 itens e o grupo Financeiro:

1. Painel inicial
2. Prospects e leads (distribuição com roleta)
3. CRM (funil com regras de passagem e a coluna R1 bolo, qualificação em 5 blocos, ordenação, ações em massa e painel lateral com Agendar R1, troca de responsável e informações de negócio editáveis)
4. Agenda e tarefas (Agendar R1 com Google Agenda, Google Meet e convite ao cliente; modelo da R1 com os dados do especialista)
5. Simulador
6. Propostas (esteira de propostas D0–D10, características do plano com adesão, divisão das cotas, aceitas e recusadas com motivo)
7. Clientes
8. Metas
9. Pré-venda (link da ficha cadastral, termo de adesão com grupo, cota e contrato de cada cota, contrato, pagamento por Pix ou boleto e comprovante)
10. Vendas (aguardando a alocação da cota; o especialista informa a alocação e o time confirma)
11. Pós-venda (funil de farm com linha do tempo D+N e alertas, satisfação NPS e estratégias de lance com histórico)
12. Comissões e cancelamentos
13. Treinamentos (inclui a trilha de integração do especialista: marca Vero, kit WhatsApp Business/LinkedIn e treinamento de consórcios)
14. Administradoras
15. Planos
16. Relatórios
17. Usuários (perfis e liberação de telas por usuário)

**Financeiro** (caixa da empresa): Visão geral (só o administrador), Contas a pagar (pontual, parcelada, recorrente ou assinatura, com comprovante, responsável e motivo do atraso), Contas a receber (instituição pagadora, motivo, conta de entrada e rateio por competência) e Cadastros (categorias prontas, centros de custo, parceiros, contas bancárias e formas de pagamento).

A ficha do cliente tem 9 blocos, com documentos validados, financeiro, pós-venda e pesquisa NPS por link. As integrações com discadora, simulador, Meta Ads, WhatsApp e agenda externa estão preparadas ou marcadas como pendentes até serem validadas.

- **Especificação funcional (telas, funil, permissões e módulo ERP):** [`docs/ESPECIFICACAO.md`](docs/ESPECIFICACAO.md)
- **Contratos de integração (discadora, simulador, leads, WhatsApp):** [`docs/INTEGRACOES.md`](docs/INTEGRACOES.md)
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
- **Agendar R1:** o mesmo pop-up no funil (Lead qualificado → R1), no painel lateral, na ficha e na Agenda: cliente e e-mail, horários de 15 em 15 minutos, 30 minutos por padrão, título "[R1] Cliente | Vero Consórcios". Com o Google Agenda conectado, o clique em "Agendar R1" já cria o evento na agenda do especialista com Google Meet, envia o convite ao cliente, salva o link na R1 e libera o modelo da R1 para baixar. O cliente recebe também a confirmação por e-mail (remetente `noreply@`). O pop-up oferece "Conectar Google Agenda" a quem ainda não conectou.
- **R1 feita (presença pelo Google Meet):** a cada 5 minutos o CRM confere a sala do Meet das R1 em andamento (API do Google Meet). Conta como "R1 feita" quando há pelo menos 2 participantes e ao menos um é de fora da empresa (o cliente); o especialista sozinho, ou só pessoas da empresa, não conta. A reunião é concluída como realizada no horário em que o cliente entrou, e o especialista é avisado. Botão "Verificar presença" para conferir na hora.
- **Modelo da R1:** o modelo oficial da Vero (13 seções com notas do apresentador), preenchido com nome, foto, WhatsApp, e-mail, cargo e apresentação do especialista e o nome do cliente; abre ou baixa (HTML) pela reunião. O administrador troca o modelo em Configurações › Modelo da R1 (campos `{{...}}`).
- **Planos:** a proposta e o simulador usam só as administradoras e os planos ativos (pelo código), mais a opção "Outros" com condições livres.
- **Ficha do cliente:** abre só com os 4 últimos dígitos do celular; campos obrigatórios vazios ficam em vermelho sem perder o que foi digitado; documentos obrigatórios: identificação e comprovante de endereço (foto ou PDF). Envio por WhatsApp (modelo) ou por e-mail visual (SMTP, remetente `noreply@veroconsorciosbr.com.br`).

## Colaboradores, Central de documentos e Relatórios

- **Colaboradores (RH):** identificação completa (CPF, RG, nascimento, contatos, e-mail pessoal e corporativo, endereço, contato de emergência), organização (cargo, função, time, líder direto, centro de custo, entrada), situação (ativo, férias, afastado, desligado com data, tipo e motivo), modelo contratual (CLT com PIS/CTPS e jornada; PJ com razão social e CNPJ; estágio; prestador; sócio), contratos com vigência e arquivo anexo, remuneração fixa, variável ou híbrida, benefícios e descontos de mercado, dados bancários, documentos e histórico. Módulo "Colaboradores": padrão só do administrador, pode ser liberado a um usuário de RH.
- **Central de documentos:** só o administrador. Pastas padrão (societário, fiscal e tributário, jurídico, licenças e certidões, gestão, RH, financeiro, marca) e subpastas; cada arquivo com número, órgão emissor, emissão e validade (alerta 30 dias antes), versões anteriores guardadas e downloads auditados.
- **Relatórios por perfil:** o especialista vê só "Meu desempenho" (as próprias vendas e comissões), sem dados de leads e sem exportar. O líder vê os comerciais da equipe. RH (módulo Colaboradores): quadro, cadastro, remuneração e custo, contratos, admissões/desligamentos/turnover e aniversariantes. Administrador: vendas gerais, fluxo de caixa, saldos e excedente de caixa (reserva mínima em Configurações), contas a pagar e a receber e resultado por categoria; exporta em Excel (.xlsx) cada relatório ou o pacote completo.
- **Conexão BI:** Configurações › Integrações › Conexão BI gera o token; `GET /api/bi` lista as bases (vendas, comissões, funil, propostas, financeiro, colaboradores, benefícios, metas e atividades) em JSON ou CSV para Power BI, Looker Studio ou Excel. Detalhes em `docs/INTEGRACOES.md`.

## Configuração local (senhas e chaves)

Senhas e chaves (Google, SMTP) ficam no arquivo `config.env`, na pasta do sistema, fora do Git (`.gitignore`). Modelo em `config.env.exemplo`. O servidor lê o arquivo ao iniciar (`npm start`, `npm run local` e os atalhos) e o instalador do Ubuntu o leva para `/etc/vero-consorcios.env`.

## Produção

- **Instalação em Ubuntu (VM local ou na nuvem):** `sudo DOMINIO=crm.seudominio.com.br bash deploy/instalar-ubuntu.sh` instala o Node.js 22, cria o serviço `vero-consorcios` (systemd), o banco em `/var/lib/vero-consorcios`, a configuração em `/etc/vero-consorcios.env` e o HTTPS (Caddy). Sem `DOMINIO`, responde na porta 3000. Para uma VM local de teste: `vagrant up` (ver `Vagrantfile` e TESTE-LOCAL.md).

- Rode a aplicação atrás de um proxy HTTPS (Nginx, Caddy ou o balanceador da nuvem) com `HOST=0.0.0.0`.
- Faça backup periódico do arquivo definido em `CRM_DB`, junto com os arquivos `-wal` e `-shm` e a chave `<banco>.key` (sem ela, as senhas de portal guardadas não podem ser abertas).
- Tokens de integração são exibidos uma única vez. No banco fica apenas o hash.
- **Google Agenda (R1 com Meet):** defina `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` (ou configure em Configurações › Integrações) e `PUBLIC_URL` com o endereço público do CRM. Cadastre no Google Cloud o URI de retorno `PUBLIC_URL/api/google/retorno`.
- **E-mails automáticos (ficha e R1 agendada):** configure o SMTP em Configurações › Integrações › E-mail ou no `config.env` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`). Remetente padrão: `noreply@veroconsorciosbr.com.br`.
