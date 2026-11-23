# Teste do WhatsApp e do agente de IA no seu computador (antes da VPS)

Aqui o seu computador faz o papel da VPS: o "WhatsApp Web" do CRM (o conector) roda nele e funciona **enquanto o
computador estiver ligado e com o teste aberto**. É um CRM de teste, com dados de demonstração e banco próprio: não
mexe no CRM oficial nem no banco de produção.

## Do que você precisa

- **Docker Desktop** (gratuito): https://www.docker.com/products/docker-desktop (no Windows, o instalador pede para
  ativar o WSL 2; aceite e reinicie se pedir). Abra o Docker Desktop e espere aparecer "Engine running".
- **Dois celulares com WhatsApp:**
  - o **número central** que a IA vai atender (no seu teste: **51 98920-3845**), que lê o QR Code;
  - **outro número** para fazer o papel do **lead** (o seu pessoal ou de um colega), que manda as mensagens.
- **Chave do Gemini** (grátis): https://aistudio.google.com › **Get API key** › **Create API key**.

## Passo a passo

1. Descompacte o pacote do CRM e abra a pasta `deploy/whatsapp-lite/teste-no-computador`.
2. Dê dois cliques em **`iniciar-teste-windows.bat`** (no Mac: abra o Terminal nesta pasta e rode
   `./iniciar-teste-mac-linux.sh`). Na primeira vez ele baixa os programas (alguns minutos). No fim, abre o CRM em
   **http://localhost:3000**. Entre com **admin@demo.local** e a senha **demo12345**.
3. **Chave da IA:** menu **Integrações › Agente de IA** › Provedor **Google Gemini** › cole a chave no campo
   "Chave da API do Gemini" › **Salvar**. (Opcional: "Buscar os modelos da conta" para confirmar o modelo.)
4. **Conectar o 51 98920-3845:** menu **Comunicação › WhatsApp** › **Conectar meu WhatsApp**. No celular do
   51 98920-3845: WhatsApp › **Aparelhos conectados** › **Conectar um aparelho** › aponte para o QR Code da tela.
   Em alguns segundos aparece "WhatsApp conectado".
5. **Ligar o agente:** **Integrações › Agente de IA**:
   - **Número central atendido pela IA:** o que você acabou de conectar;
   - **Modo de teste: atender só estes números:** o número do celular que vai fazer o papel de lead (ex.:
     `51 99999-0000`). Assim, se outras pessoas escreverem para o 51 98920-3845 durante o teste, a IA não responde
     para elas e as conversas delas não entram no CRM;
   - **Especialista padrão para leads novos:** por exemplo "Especialista Demo 1" (é na agenda dele que a IA marca a R1);
   - marque **Ligar o agente de IA** e **Salvar**.
6. **Teste:** do celular do "lead", mande para o 51 98920-3845 algo como *"Oi, vi o anúncio de consórcio de
   imóvel"*. A IA responde em alguns segundos, faz a triagem e, se houver fit, oferece horários e agenda a R1.
   Acompanhe em **Comunicação › WhatsApp** (faixa "IA atendendo"), no **Pipeline** (o lead muda de etapa) e em
   **Integrações › Agente de IA › Últimas ações**.
7. **Encerrar:** dois cliques em **`parar-teste-windows.bat`** (Mac: `./parar-teste-mac-linux.sh`). Os dados ficam
   guardados para a próxima vez. Se não for testar mais, no celular do 51 98920-3845 remova o aparelho em
   **Aparelhos conectados**.

## Durante o teste

- **Não responda pelo celular do 51 98920-3845** nas conversas de teste: o CRM entende que uma pessoa assumiu e a IA
  para (de propósito). Para devolver, abra a conversa no CRM e clique em **Devolver para a IA**.
- O celular do número central precisa ficar ligado e com internet.
- Para recomeçar uma conversa do zero, peça ao "lead" para escrever de outro número (ou apague o lead no CRM de teste).
- Plano gratuito do Gemini: há limite de pedidos por minuto e por dia. Se estourar, o lead recebe uma mensagem de
  cortesia e a conversa passa para o especialista.

## Se algo não funcionar

- **"Port is already allocated" / porta 3000 ou 8080 em uso:** feche o CRM local (iniciar-windows.bat) ou outro
  programa que use essas portas e rode de novo.
- **O QR Code não aparece:** o conector leva até 1 minuto para ficar pronto na primeira vez; clique em
  "Gerar outro QR Code". Registros: na pasta do teste, `docker compose logs evolution-api`.
- **A IA não responde:** confira em Integrações › Agente de IA se está "Atendendo", se a chave do Gemini está salva e se
  o número do lead está certo no modo de teste (com DDD). As falhas aparecem em "Últimas ações".
- **Registros do CRM:** `docker compose logs crm`.

## Depois do teste

Com tudo aprovado, o caminho oficial é a VPS (`deploy/whatsapp-lite/LEIA-ME.md`) e o CRM publicado na Vercel. No CRM
oficial você conecta o número central de novo (novo QR Code) e liga o agente sem o modo de teste.
