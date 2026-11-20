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
| CRM | <http://localhost:3000/> | `admin@demo.local` · senha `demo12345` |
| Landing page | <http://localhost:3000/lp/> | pública |
| Simulador | <http://localhost:3000/simulador/> | aberto pelo CRM |

Outros usuários da demonstração (mesma senha): `gestora@demo.local` (líder), `consultor1@demo.local` e
`consultor2@demo.local` (especialistas, participam da roleta), `leitura@demo.local` (somente leitura) e
`novo@demo.local` (especialista recém-contratado: troca a senha no primeiro acesso e segue a trilha de integração).

Na primeira execução o banco `data/local.db` é criado com dados fictícios. Para recomeçar do zero, pare o servidor
(Ctrl+C) e apague `data/local.db` (e `data/local.db.key`). Para começar sem dados de demonstração e criar o seu
administrador: `LOCAL_VAZIO=1 npm run local` (Windows: `set LOCAL_VAZIO=1` antes).

Use dois navegadores (ou uma janela anônima) para ver ao mesmo tempo o administrador e um especialista.

## 1.1 Testar numa máquina virtual (opcional)

Use uma máquina virtual (VM) para testar num computador "limpo", sem mexer no seu, ou para deixar o sistema no ar
para outras pessoas. A pasta já traz o instalador `deploy/instalar-ubuntu.sh` (Node.js, serviço que sobe sozinho,
dados de demonstração e, com domínio, HTTPS automático) e o `Vagrantfile` (VM local com um comando).

**Opção A — VM no seu computador, automática (VirtualBox + Vagrant)**

1. Instale o [VirtualBox](https://www.virtualbox.org/wiki/Downloads) e o [Vagrant](https://developer.hashicorp.com/vagrant/install).
2. **Windows:** dois cliques em `iniciar-vm-windows.bat` (dentro da pasta `vero-consorcios`).
   **Mac/Linux:** no terminal, entre na pasta onde está o arquivo `Vagrantfile` (`cd vero-consorcios`) e rode `vagrant up`.
   Na primeira vez ele baixa o Ubuntu 24.04 e instala tudo (cerca de 5 a 10 minutos).
   Se aparecer "A Vagrant environment or target machine is required", o comando foi rodado fora da pasta do `Vagrantfile`.
   Descompacte o zip antes (botão direito › Extrair tudo); o atalho não funciona com o zip ainda aberto.
   A janela do atalho fica aberta no fim (com as mensagens e o endereço); se algo falhar, copie o texto dela.
3. Acesse no navegador do seu computador: <http://localhost:8080/> (CRM), <http://localhost:8080/lp/> e
   <http://localhost:8080/simulador/>. Login: `admin@demo.local` · `demo12345`.
4. `vagrant halt` desliga a VM; `vagrant up` liga de novo; `vagrant destroy` apaga tudo para recomeçar do zero.

**Opção B — VM no VirtualBox, passo a passo (sem Vagrant)**

1. Baixe o Ubuntu Server 24.04 em <https://ubuntu.com/download/server> e crie uma VM no VirtualBox (2 GB de RAM, 20 GB de disco).
2. Em Configurações › Rede › Avançado › Redirecionamento de portas, crie a regra: porta do hospedeiro 8080 → porta do convidado 3000.
3. Instale o Ubuntu (marque "Install OpenSSH server"), copie o zip para a VM (ex.: `scp -P 2222 vero-consorcios-local.zip usuario@localhost:`,
   com mais uma regra 2222 → 22) e, dentro da VM: `unzip vero-consorcios-local.zip && cd vero-consorcios && sudo bash deploy/instalar-ubuntu.sh`.
4. Acesse <http://localhost:8080/> no seu computador.

**Opção C — VM na nuvem, como seria "de verdade" (recomendado para o teste completo)**

Uma VM na internet permite testar o que depende de endereço público: a LP hospedada na HostGator enviando leads, o link da
ficha aberto no celular do cliente, o Google Agenda (o Google exige um endereço de retorno) e o e-mail.

1. Contrate uma VM Ubuntu 24.04 com 1 a 2 GB de RAM (ex.: VPS da HostGator, DigitalOcean, AWS Lightsail ou Google Cloud).
2. No DNS do seu domínio, crie um registro **A** `crm` apontando para o IP da VM (ex.: `crm.veroconsorciosbr.com.br`).
3. Envie o zip para a VM (`scp vero-consorcios-local.zip root@IP-DA-VM:`) e, nela:
   `unzip vero-consorcios-local.zip && cd vero-consorcios && sudo DOMINIO=crm.veroconsorciosbr.com.br bash deploy/instalar-ubuntu.sh`
4. Pronto: <https://crm.veroconsorciosbr.com.br/> com certificado HTTPS automático. Para começar sem dados fictícios, use `DEMO=0`.
5. Google Agenda, SMTP e origens da LP ficam em `/etc/vero-consorcios.env` (exemplos comentados no arquivo) ou nas telas de
   Configurações; depois de alterar o arquivo: `sudo systemctl restart vero-consorcios`.

**Opção D — Windows Sandbox (rápido, Windows 10/11 Pro)**

Ative "Área Restrita do Windows" em Recursos do Windows, abra-a, copie o zip para dentro, instale o Node.js 22 LTS e dê dois
cliques em `iniciar-windows.bat`. Ao fechar a área restrita, tudo é apagado.

## 2. Roteiro de testes

### A. Landing page → CRM (simulador da LP)

1. Abra <http://localhost:3000/lp/>, escolha **Imóvel** (ou Veículo), ajuste o valor e clique **Simular agora**.
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

### H. R1: agendamento, Google Agenda, presença e modelo

1. No Pipeline, arraste um card até **R1** (ou abra o lead e clique em **Ganho**): abre o pop-up "Agendar R1" (cliente,
   e-mail, data, início e término de 15 em 15 minutos, 30 minutos por padrão, título "[R1] Cliente | Vero Consórcios").
   Se faltar a qualificação (objetivo, valor estimado, prioridade e, no consórcio, a categoria), os campos aparecem no pop-up.
2. Com o `config.env` deste pacote, o Google já está configurado: no pop-up clique em **Conectar Google Agenda** (uma vez)
   e depois em **Agendar R1**. O evento entra na sua agenda com o Google Meet, o cliente recebe o convite e a confirmação
   por e-mail (`noreply@`), e o link do Meet fica salvo na R1. Sem o Google, use "Abrir no Google Agenda" e cole o link.
3. **Baixar modelo da R1** (ou Abrir): o modelo oficial da Vero com seu nome, foto, WhatsApp e e-mail e o nome do cliente.
4. **R1 feita:** entre no Meet no horário e peça para alguém de fora da empresa entrar (ex.: um celular sem a sua conta).
   Em até 5 minutos (ou no botão "Verificar presença" da tarefa) a reunião vira "R1 feita" com o horário.
   Só você na sala, ou só colegas da Vero, não conta.
5. Cliente faltou? No bloco **R1** do painel do lead clique em **Não compareceu**: o cartão fica na coluna R1 com a marca
   **NS** (amarela). **Remarcar** abre a nova data e o cartão ganha a marca **R** (azul); o mesmo link do Meet continua valendo.
6. **Concluir** a R1 libera o **Agendar R2** (arraste o card para R2 ou use o bloco R2). Concluir a R2 leva o negócio para Negociação.
7. **Perdido** só aparece liberado depois de registrar uma atividade (Telefone, WhatsApp, E-mail ou Direct) e pede o motivo MP1 a MP9.
8. No painel lateral: engrenagem para **trocar o responsável** (com motivo) e **Editar** no bloco do negócio (área, co-responsável,
   valor estimado e qualificação).

### H3. Calendário e Comunicação

1. **Operacional › Calendário:** veja o seu dia, semana, mês ou um período. Estão ali as R1 e R2, os one-on-ones, as tarefas
   e as atividades registradas. O calendário só mostra: clique num item para ver os detalhes (não dá para agendar por ele).
   Como líder (gestora@demo.local), escolha "Toda a equipe" ou uma pessoa no seletor "Calendário de".
2. **Gestão do time › One-on-ones:** a líder marca o one-on-one com alguém do time; ele aparece no calendário dos dois.
3. **Comunicação › Inbox:** chat interno. "Conversa" fala com uma pessoa; "Grupo" cria um grupo. Anexe arquivos pelo clipe.
   O número vermelho no menu mostra as mensagens não lidas.
4. **Comunicação › Tickets:** "+ Novo ticket" com título, responsável, categoria, prazo, descrição e anexos. O responsável
   começa a atuar, devolve (pedindo o que falta) ou conclui com a entrega; o solicitante responde, reabre ou cancela.
5. **Comunicação › WhatsApp:** na demonstração está em modo de teste (as mensagens ficam só no CRM). Para ligar o número
   oficial, o administrador preenche Configurações › Integrações › WhatsApp da empresa (ou as chaves `WHATSAPP_*` do
   `config.env`) e cadastra o webhook na Meta. No painel do lead, "WhatsApp da empresa" abre a conversa com o cliente.

### H4. Painel do lead, regras do funil, produtos, diagnóstico e IA Vero

1. **Pipeline:** clique no nome de um lead. O painel mostra só a etapa (a troca é no pipeline), **Ganho** (verde) e
   **Perdido** (vermelho), o telefone (clique copia), **WhatsApp da empresa** e **Abrir cadastro completo**.
2. **Detalhes:** ingresso no CRM e primeiro contato (fixos), prazo para agendar a R1 (3 dias após o 1º contato) e a
   previsão de fechamento (altere a data: salva sozinha).
3. **Atividades:** use o bloco "Registrar atividade" (Telefone, WhatsApp, E-mail, Direct, LinkedIn ou Contato); os totais
   por canal ficam no topo. Num lead em "Lead", registrar uma atividade já leva o cartão para "Tentativa de contato".
4. **Regras ao arrastar:** Lead → Tentativa pede o registro da tentativa; Tentativa → Qualificação abre a qualificação com
   "Concluir qualificação"; Qualificação → R1 abre o agendamento da R1; R2 → Negociação pede a proposta (escolha a área:
   consórcio, seguros, planejamento ou investimentos).
5. **Agendas:** contadores (agendadas, realizadas, remarcadas, no-show) e os blocos R1/R2 com Concluir, Não compareceu e Remarcar.
6. **Produtos:** "Adicionar" em cada área (consórcio, planejamento, seguros, investimentos) com a oportunidade, descrição,
   valor (ou faixa de captação) e observação. O topo soma o potencial.
7. **Diagnóstico:** "Realizar diagnóstico financeiro" abre a ferramenta numa nova guia com os dados do cliente; o que for
   preenchido volta ao CRM (a pílula "Vero CRM" no canto mostra "Salvo no CRM"). Também em Ferramentas › Planejamento
   financeiro (escolha o cliente).
8. **IA Vero:** resumo, próximo passo, canal, BANT, SPIN, objeções com resposta para o WhatsApp e o chat com perguntas
   prontas. A liderança cadastra objeções, dicas e mensagens em Ferramentas › Base da IA Vero.
9. **Pipeline › Perdidos** (gestora ou admin): onde cada lead foi perdido e os motivos (MP) por etapa.
10. **Ferramentas:** separadas por área; o Simulador de consórcio abre com a senha da equipe (a do arquivo original).

### H2. Menu lateral e Gestão do time

1. O botão no canto superior esquerdo recolhe o menu (fica só o símbolo da Vero e os ícones); clique de novo para expandir.
2. Entre como **gestora@demo.local** ou admin: **Gestão do time › Organograma do time** (quem lidera quem, com os números do mês)
   e **Dashboard squad** (leads, tentativas, R1 agendadas/feitas, no-show, remarcações, R2, vendas, SLA e motivos de perda).

### I. Planos, proposta e nova versão

1. Planos: cada plano tem código (ex.: HS-IMV-200) e chave Ativo/Inativo; só os ativos aparecem na proposta e no simulador.
2. Gerar proposta: no simulador escolha a administradora e o plano (taxa e fundo seguem o plano) ou "Outros" (condições livres).
3. Na proposta, **Criar nova versão**: o simulador abre com as condições anteriores e o botão **Atualizar proposta**; o PDF
   e os novos valores entram na mesma proposta como versão 2.

### J. Ficha do cliente (link)

1. Abra o link da ficha numa janela anônima: aparece, no centro da tela, "Olá, Nome Sobrenome" e o pedido dos 4 últimos
   dígitos do celular; depois a ficha abre também centralizada.
2. Deixe um campo obrigatório vazio e clique em Salvar: ele fica em vermelho e o que foi digitado continua lá.
3. Documentos obrigatórios: identificação e comprovante de endereço, em foto ou PDF.
4. Na pré-venda, **Enviar para o cliente por e-mail** dispara na hora o e-mail de `noreply@veroconsorciosbr.com.br`
   (SMTP do `config.env`). Sem SMTP, mostra o e-mail pronto para copiar.

### K. Colaboradores, Central de documentos e Relatórios

1. **Colaboradores** (menu Administração): abra "Gestora Demo (líder)" e veja identificação, organização, contrato CLT e
   jornada, remuneração híbrida, benefícios e descontos, contrato anexado e histórico. Em "Editar cadastro", troque o
   modelo para PJ: aparecem razão social e CNPJ e somem os campos de jornada.
2. **Central de documentos**: pastas padrão; "Fiscal e tributário › Certidões negativas" tem uma certidão vencendo e o
   "Alvará" está vencido (alerta no topo e no sino). Abra um documento: baixar, enviar nova versão e ver as anteriores.
3. **Relatórios**: como administrador, veja Financeiro › "Saldos, projeção e excedente de caixa" e exporte em Excel; como
   `consultor1@demo.local`, só aparece "Meu desempenho", sem botão de exportar.
4. **Conexão BI**: Configurações › Integrações › Conexão BI › Gerar token e abra
   `http://localhost:3000/api/bi/vendas?formato=csv&token=SEU_TOKEN` no navegador.

### L. Demais módulos

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
