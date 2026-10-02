# ERP/CRM de Consórcios Primários

ERP/CRM para a venda de consórcios contratados do zero, do primeiro contato ao pós-venda. No topo à direita ficam o sino de notificações e o menu do usuário (foto, Meu cadastro, Alterar senha e Sair). O menu lateral tem 17 itens:

1. Painel inicial
2. Prospects e leads (distribuição com roleta)
3. CRM (funil em 10 etapas com regras de passagem, qualificação em 5 blocos, ordenação, ações em massa e painel lateral de consulta)
4. Agenda e tarefas
5. Simulador
6. Propostas (esteira de propostas D0–D10, características do plano com adesão, divisão das cotas, aceitas e recusadas com motivo)
7. Clientes
8. Metas
9. Pré-venda (link da ficha cadastral, termo de adesão com grupo, cota e contrato de cada cota, contrato, pagamento por Pix ou boleto e comprovante)
10. Vendas (aguardando a alocação da cota; o especialista informa a alocação e o time confirma)
11. Pós-venda (funil de farm com linha do tempo D+N e alertas, satisfação NPS e estratégias de lance com histórico)
12. Comissões e cancelamentos
13. Treinamentos
14. Administradoras
15. Planos
16. Relatórios
17. Usuários (perfis e liberação de telas por usuário)

A ficha do cliente tem 9 blocos, com documentos validados, financeiro, pós-venda e pesquisa NPS por link. As integrações com discadora, simulador, Meta Ads, WhatsApp e agenda externa estão preparadas ou marcadas como pendentes até serem validadas.

- **Especificação funcional (telas, funil, permissões e módulo ERP):** [`docs/ESPECIFICACAO.md`](docs/ESPECIFICACAO.md)
- **Contratos de integração (discadora, simulador, leads, WhatsApp):** [`docs/INTEGRACOES.md`](docs/INTEGRACOES.md)

## Identidade visual

A interface segue o manual da marca v1.0 (aplicações e diretrizes, elementos de interface, paleta de cores e tipografia). A aplicação da marca não mudou nenhuma regra de negócio.

- `public/css/tokens.css`: tokens oficiais (paleta, tipografia, raios, espaçamentos, sombras e os temas escuro e claro).
- `public/css/brand.css`: componentes (moldura, menu lateral flutuante, pílulas, cards, indicadores, tabelas, funil, janelas e painel lateral).
- `public/js/icons.js`: ícones de traço no estilo Lucide (24×24, traço 1,7).
- **Tema:** escuro por padrão. Sem escolha do usuário, segue o sistema operacional; o botão Claro/Escuro no topo guarda a escolha no navegador.
- **Fontes:** Poppins nos textos e Manrope no lugar da Famels (fonte comercial) até a licença. Com a licença, copie `Famels-Regular.woff2` e `Famels-Italic.woff2` para `public/fonts/` e acrescente `url("/fonts/Famels-Regular.woff2") format("woff2")` (e o equivalente do itálico) ao `src` das regras `@font-face` em `tokens.css`.
- **Logo:** monograma "CC" provisório na barra lateral, no login e no ícone da aba.

## Requisitos

- Node.js **22.13 ou superior**. O projeto usa o SQLite embutido no Node (`node:sqlite`).
- Não há dependências externas, então não é preciso rodar `npm install`.

## Como executar

```bash
npm start                    # http://127.0.0.1:3000
```

No primeiro acesso, a tela pede a criação do usuário **administrador**. Não existe senha padrão.

Variáveis de ambiente:

| Variável | Padrão | Uso |
|---|---|---|
| `PORT` | `3000` | Porta HTTP |
| `HOST` | `127.0.0.1` | Use `0.0.0.0` para expor na rede, atrás de um proxy HTTPS |
| `CRM_DB` | `data/crm.db` | Arquivo do banco SQLite. Faça backup desse arquivo. |
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
- `leitura@demo.local` (somente leitura).

Também cria dados fictícios:

- 2 administradoras e 4 planos;
- 24 leads em todas as etapas do funil;
- propostas na esteira de follow-up;
- pré-vendas;
- 1 venda confirmada, 1 aguardando pagamento e 1 cancelada;
- comissões, metas e treinamentos.

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
- simulação rápida e abertura do simulador de propostas com nome e contato.

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
                    notificações (notifications.js), Meu cadastro (profile.js))
  permissions.js    perfis e módulos (telas) liberados por usuário
public/             interface web (HTML + CSS + JavaScript em módulos, sem build).
                    A página do cliente (#/ficha/<token>) não exige login.
scripts/demo-data.js
test/api.test.js
docs/
```

## Produção

- Rode a aplicação atrás de um proxy HTTPS (Nginx, Caddy ou o balanceador da nuvem) com `HOST=0.0.0.0`.
- Faça backup periódico do arquivo definido em `CRM_DB`, junto com os arquivos `-wal` e `-shm`.
- Tokens de integração são exibidos uma única vez. No banco fica apenas o hash.
