# CRM de Consórcios Primários

CRM para a venda de consórcios contratados do zero. Cobre o processo do primeiro contato ao pós-venda: prospects, leads, oportunidades, atividades, tarefas, simulações, propostas, clientes e produtos contratados. As integrações com discadora, simulador, Meta Ads e WhatsApp estão preparadas, mas continuam pendentes até serem validadas.

- **Especificação funcional (itens de entrega 1 a 11):** [`docs/ESPECIFICACAO.md`](docs/ESPECIFICACAO.md)
- **Contratos de integração (discadora, simulador, leads, WhatsApp):** [`docs/INTEGRACOES.md`](docs/INTEGRACOES.md)

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

O comando cria os usuários `admin@demo.local`, `gestora@demo.local`, `consultor1@demo.local`, `consultor2@demo.local` e `leitura@demo.local`, além de 20 leads fictícios. Ele não roda em um banco que já tenha cadastros.

### Testes

```bash
npm test
```

Os testes automatizados cobrem:

- deduplicação de cadastros;
- permissões por perfil;
- proteção CSRF;
- regras do funil (motivo de perda e conversão em cliente);
- bloqueio por oposição a contato;
- idempotência e fila da discadora;
- token e vínculo do simulador;
- versões de propostas;
- API de leads;
- importação CSV;
- mesclagem de cadastros;
- relatórios.

## Estrutura

```
server/
  app.js            rotas HTTP, segurança (CSP, CSRF), arquivos estáticos
  db.js             esquema SQLite e valores iniciais configuráveis
  core.js           escopo de acesso por perfil, auditoria
  auth.js           sessões e login
  services/         regras de negócio (cadastros, funil, atividades, tarefas, discadora,
                    simulações, propostas, clientes, entradas de integração, relatórios,
                    importação/exportação, administração)
public/             interface web (HTML + CSS + JavaScript em módulos, sem build)
scripts/demo-data.js
test/api.test.js
docs/
```

## Produção

- Rode a aplicação atrás de um proxy HTTPS (Nginx, Caddy ou o balanceador da nuvem) com `HOST=0.0.0.0`.
- Faça backup periódico do arquivo definido em `CRM_DB`, junto com os arquivos `-wal` e `-shm`.
- Tokens de integração são exibidos uma única vez. No banco fica apenas o hash.
