# Vero Consórcios — instalação local e roteiro de testes

CRM, simulador e landing page rodando juntos na sua máquina, como seria no ar: o visitante se cadastra na LP, o lead
cai no CRM e é distribuído pela roleta; o especialista gera a proposta no simulador e ela volta para o CRM.

## 1. Instalar

1. Instale o **Node.js 22 LTS ou superior** em <https://nodejs.org> (botão "LTS"). Não há outra dependência.
2. Descompacte o arquivo `vero-consorcios-local.zip` numa pasta (ex.: `Documentos/vero-consorcios`).
3. Inicie:
   - **Windows:** dois cliques em `iniciar-windows.bat`;
   - **Mac ou Linux:** no Terminal, dentro da pasta, rode `./iniciar-mac-linux.sh`;
   - ou, em qualquer sistema: `npm run local`.
4. O navegador abre a landing page. Os endereços:

| O quê | Endereço | Acesso |
|---|---|---|
| CRM | <http://127.0.0.1:3000/> | `admin@demo.local` · senha `demo12345` |
| Landing page | <http://127.0.0.1:3000/lp/> | pública |
| Simulador | <http://127.0.0.1:3000/simulador/> | aberto pelo CRM |

Outros usuários da demonstração (mesma senha): `gestora@demo.local` (líder), `consultor1@demo.local` e
`consultor2@demo.local` (especialistas, participam da roleta), `leitura@demo.local` (somente leitura) e
`novo@demo.local` (especialista recém-contratado: troca a senha no primeiro acesso e segue a trilha de integração).

Na primeira execução o banco `data/local.db` é criado com dados fictícios. Para recomeçar do zero, pare o servidor
(Ctrl+C) e apague `data/local.db` (e `data/local.db.key`). Para começar sem dados de demonstração e criar o seu
administrador: `LOCAL_VAZIO=1 npm run local` (Windows: `set LOCAL_VAZIO=1` antes).

Use dois navegadores (ou uma janela anônima) para ver ao mesmo tempo o administrador e um especialista.

## 2. Roteiro de testes

### A. Landing page → CRM (simulador da LP)

1. Abra <http://127.0.0.1:3000/lp/>, escolha **Imóvel** (ou Veículo), ajuste o valor e clique **Simular agora**.
2. Preencha nome e sobrenome, e-mail, celular, preferência de contato e horário; marque os dois aceites; envie.
3. No CRM (`admin@demo.local`), abra **CRM**: o card aparece em **Tentativa de contato**, já com um especialista.
   - Origem: **Landing page**; campanha "LP · Simulador Imóvel" (ou a `utm_campaign` do link).
   - Negócio com **objetivo Aquisição**, categoria, crédito (e parcela, se simulou pela parcela) e a temperatura.
   - Preferência de contato e horário na ficha (2. Origem); anotação com o resumo da simulação.
4. Entre como o especialista escolhido (`consultor1` ou `consultor2`): ele recebe a notificação "Novo lead para você" e
   a tarefa **Primeiro contato** na agenda, com prazo de 1 hora.
5. Repita escolhendo **Investimento**: o negócio entra com **objetivo Alavancagem**.

### B. Landing page → CRM (Mecanismo de Alavancagem Financeira)

1. Na LP, vá até **Soluções › Mecanismo de Alavancagem**, ajuste o crédito e clique **Montar estratégia de alavancagem**.
2. Preencha os dados, "quando pretende iniciar", contato e horário; aceite e envie.
3. No CRM: lead em **Tentativa de contato**, **objetivo Alavancagem**, categoria imóvel, prazo pela resposta
   ("De imediato" ou "1 a 3 meses" = curto; "6 a 12 meses" = médio) e a simulação mostrada na anotação.
4. Envie de novo com o **mesmo telefone ou e-mail**: o cadastro **não é duplicado** (recebe a nova origem). Se o
   objetivo for diferente do negócio aberto, um **segundo negócio** é criado para o mesmo cliente.

### C. Distribuição (roleta)

- A roleta distribui **na hora** em que o lead chega (participantes em **Prospects e leads › Roleta**).
- Desative todos os participantes e envie um lead pela LP: ele fica na **fila** e administradores e líderes recebem
  aviso. Reative um especialista: em até **15 minutos** a rotina distribui a fila sozinha (ou distribua manualmente).
- Leads sem contato no prazo aparecem em **Prospects e leads** para redistribuição.

### D. Qualificação, temperatura e R1

1. Abra o negócio, **Editar qualificação**: complete objetivo, prazo, parcela e lance; a temperatura muda
   (quente: prazo curto + valor + lance ou parcela).
2. **Anexar transcrição da R1**: use um .txt com linhas "Descrição: valor" (ex.: `Crédito desejado: R$ 300.000,00`,
   `Prazo desejado: curto`, `Origem do lance: FGTS`) ou o modelo em Excel; confira e aplique.

### E. Proposta: CRM → simulador → CRM

1. Com o negócio aberto, clique **Gerar proposta** (cadastro ou negócio). O simulador abre com o nome e o WhatsApp do
   cliente e a proposta **PR-…** é criada no CRM como rascunho.
2. No simulador, ajuste administradora, plano, crédito e prazo; clique **Gerar proposta (PDF)** e depois
   **Gerar proposta** na prévia.
3. O PDF é baixado **e enviado ao CRM**: a proposta recebe crédito, prazo, parcela inicial, taxas e adesão; o PDF fica
   em **Documentos** do cliente; o especialista é notificado.
4. No CRM, marque a proposta como **apresentada**: começa a esteira de follow-up (D0 a D10).
5. Pelo menu **Simulador** o simulador abre no **modo simulação**: "Gerar proposta" fica inativo.

### F. Link de cadastro do cliente e pré-venda

1. Na ficha, **Link cadastro** gera o link para o cliente completar os dados (abra-o numa janela anônima).
2. Marque a proposta como **aceita**: abre a pré-venda (link, conferência, termo de adesão com as cotas, contrato,
   pagamento e comprovante). Com o comprovante, a venda vai para **Vendas** aguardando a alocação; o líder confirma
   e o cliente entra no pós-venda (linha do tempo D+N), com as comissões geradas.

### G. Novo especialista (primeiro acesso e integração)

1. Entre como `novo@demo.local` (senha `demo12345`): a plataforma pede a troca da senha provisória antes de tudo.
2. No Painel inicial aparece "Sua integração na Vero": complete Meu cadastro (foto, WhatsApp e cargo), leia "Conheça a Vero"
   (posicionamento, cores e tipografia) e o "Kit do especialista" (WhatsApp Business, LinkedIn e a capa com o logo da Vero).
3. Concluídas as etapas, o treinamento de consórcios (7 módulos) aparece em Treinamentos; ao terminar, a liderança é avisada.
4. Para criar um especialista de verdade: Usuários › Novo usuário (senha provisória e trilha marcadas por padrão).

### H. R1: agendamento, Google Agenda e modelo

1. No CRM, arraste um card de **Lead qualificado** para **R1**: abre o pop-up "Agendar R1" (cliente, e-mail, data, início e
   término de 15 em 15 minutos, 30 minutos por padrão, título "[R1] Cliente / Vero Consórcios").
2. Sem o Google conectado, clique em "Abrir no Google Agenda" (evento já preenchido) e cole o link do Meet.
   Com o Google configurado (Configurações › Integrações) e conectado (Meu cadastro), o evento sai com Meet e convite.
3. "Abrir modelo da R1": o roteiro da reunião com seu nome, foto e contato. O administrador troca o modelo em
   Configurações › Modelo da R1.
4. Cliente faltou? Mova de **R1** para **R1 bolo** (justificativa opcional) e use "Agendar R1" para remarcar.
5. No painel lateral (clique no nome do card): botão **Agendar R1**, engrenagem para **trocar o responsável** (com motivo)
   e **Editar** nas informações de negócio.

### I. Planos, proposta e nova versão

1. Planos: cada plano tem código (ex.: HS-IMV-200) e chave Ativo/Inativo; só os ativos aparecem na proposta e no simulador.
2. Gerar proposta: no simulador escolha a administradora e o plano (taxa e fundo seguem o plano) ou "Outros" (condições livres).
3. Na proposta, **Criar nova versão**: o simulador abre com as condições anteriores e o botão **Atualizar proposta**; o PDF
   e os novos valores entram na mesma proposta como versão 2.

### J. Ficha do cliente (link)

1. Abra o link da ficha numa janela anônima: aparece "Olá, Nome Sobrenome" e o pedido dos 4 últimos dígitos do celular.
2. Deixe um campo obrigatório vazio e clique em Salvar: ele fica em vermelho e o que foi digitado continua lá.
3. Documentos obrigatórios: identificação e comprovante de endereço, em foto ou PDF.
4. Na pré-venda, "Enviar por e-mail" mostra o e-mail visual (sem SMTP) ou envia de `admin@veroconsorciosbr.com.br`
   (SMTP em Configurações › Integrações › E-mail).

### K. Demais módulos

Painel inicial (funil visual e ranking), Agenda, Metas, Comissões, Pós-venda (NPS e estratégia de lance),
Financeiro (contas a pagar e a receber), Administradoras (senha do portal), Relatórios, Usuários e Configurações.

## 3. Para colocar no ar (oficial)

- **CRM:** um servidor com Node.js 22+, atrás de HTTPS (Nginx, Caddy ou o balanceador da nuvem), com
  `HOST=0.0.0.0`, `CRM_DB` num disco com backup e `CRM_SECRET_KEY` definida (ver README).
- **Landing page:** pode ficar no próprio CRM (`/lp/`) ou no seu domínio. Em outro domínio, troque em
  `public/lp/index.html` o `leadEndpoint` para `https://SEU-CRM/api/publico/lp/leads` e limite os sites que podem
  enviar leads com a variável `LP_ALLOWED_ORIGINS=https://seudominio.com.br` (o padrão `*` aceita qualquer site).
- **Simulador:** servido pelo CRM (`/simulador/`), no mesmo endereço, para devolver as propostas ao CRM.
- O endpoint da LP tem limite de envios por IP, exige o aceite da Política de Privacidade e não duplica cadastros.
