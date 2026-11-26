# WhatsApp Lite na VPS da Locaweb (1 GB): passo a passo

O WhatsApp Lite funciona como o WhatsApp Web: o celular conecta o CRM como um "aparelho conectado". Quem mantém essa
conexão aberta 24 horas é o **conector** (Evolution API v2.3.8), que roda numa VPS e repassa cada mensagem ao CRM. A
Vercel não mantém conexões abertas, por isso o conector fica fora dela.

O instalador (`instalar-evolution.sh`) faz tudo sozinho: instala o Docker, liga 2 GB de memória de troca, sobe o
conector com HTTPS automático e mostra no fim o **endereço** e a **chave** para colar no CRM. Ele foi ajustado para a
**VPS de 1 GB**: sem Redis, banco enxuto e registros com tamanho limitado. Parado, o conector usa cerca de 270 MB.

> **Quer testar antes de contratar?** Use o kit `teste-no-computador/` (Docker Desktop no seu computador):
> passo a passo em [`teste-no-computador/LEIA-ME.md`](teste-no-computador/LEIA-ME.md).

## Antes de começar

- O **CRM oficial precisa estar na versão com o WhatsApp Lite e o Agente de IA** (publicada na Vercel). No menu
  **Integrações** devem aparecer os cartões "WhatsApp Lite" e "Agente de IA".
- Você vai precisar de acesso a **três lugares**:
  - o painel da **Locaweb**, para contratar a VPS;
  - o painel da **HostGator** (cPanel), onde fica o DNS do domínio `veroconsorciosbr.com.br`;
  - o **CRM oficial**, como administrador.
- O celular do **número central** da Vero precisa estar à mão para ler o QR Code.

## 1. Contratar a VPS na Locaweb

1. Contrate o plano **VPS 1 GB (Linux)**.
2. Na escolha do sistema, selecione **Ubuntu 24.04** (ou 22.04). Não escolha AlmaLinux, Rocky Linux nem CentOS: o
   instalador é para Ubuntu.
3. Quando a VPS ficar pronta, anote **o IP** e **a senha do usuário root**. Eles aparecem no painel da VPS ou no e-mail
   de ativação.
4. Se o painel da VPS tiver **firewall**, deixe liberadas as portas **22** (SSH), **80** e **443**.

## 2. Criar o endereço do conector no DNS (HostGator)

1. Entre no **cPanel** da HostGator e abra o **Editor de Zona** (Zone Editor).
2. No domínio `veroconsorciosbr.com.br`, clique em **+ Registro A** (ou "Gerenciar" › "Adicionar registro").
3. Preencha:
   - **Nome:** `whatsapp`;
   - **Endereço / Registro:** o **IP da VPS**;
   - **TTL:** deixe o padrão.
4. Salve. A propagação costuma levar de alguns minutos a 1 hora. O conector vai ficar em
   **`https://whatsapp.veroconsorciosbr.com.br`**.

## 3. Instalar o conector na VPS

1. **Entre na VPS:**
   - no **Windows**, abra o **PowerShell** (menu Iniciar › digite PowerShell);
   - no **Mac**, abra o **Terminal**;
   - digite `ssh root@IP-DA-VPS`, trocando `IP-DA-VPS` pelo IP anotado;
   - na primeira vez, responda `yes`;
   - digite a senha do root. Ela não aparece enquanto você digita; é normal.
   - Se preferir, use o **console** do painel da Locaweb.
2. **Cole os dois comandos abaixo**, um de cada vez, e aperte Enter:
   ```
   curl -fsSL https://raw.githubusercontent.com/gabrielbava/crm_cons-rcios_prim-rio/HEAD/deploy/whatsapp-lite/instalar-evolution.sh -o instalar.sh
   sudo DOMINIO=whatsapp.veroconsorciosbr.com.br bash instalar.sh
   ```
   **Se não conseguir colar** (o console pelo site da Locaweb às vezes não aceita), digite estes três comandos, mais
   curtos. Atenção ao endereço: é `crm_cons-rcios_prim-rio`, com sublinhado, hífen, sublinhado e hífen.
   ```
   apt install -y git
   git clone https://github.com/gabrielbava/crm_cons-rcios_prim-rio vero
   DOMINIO=whatsapp.veroconsorciosbr.com.br bash vero/deploy/whatsapp-lite/instalar-evolution.sh
   ```
3. Espere de 3 a 10 minutos. No fim aparece um quadro com:
   ```
   Endereço do servidor:  https://whatsapp.veroconsorciosbr.com.br
   Chave global (apikey): (uma chave longa)
   ```
   - **Copie a chave.** Para ver de novo depois, entre na VPS e rode `vero-whatsapp dados`.
   - **Se aparecer "ainda não respondeu":** quase sempre o DNS ainda não propagou. Espere uns minutos; o HTTPS sai
     sozinho e não precisa rodar de novo. Para conferir, abra `https://whatsapp.veroconsorciosbr.com.br` no navegador:
     deve aparecer uma mensagem da Evolution API.

## 4. Ligar o conector no CRM oficial

1. No CRM, como **administrador**, abra **Integrações › WhatsApp Lite** e depois **Servidor do WhatsApp Lite
   (administrador)**.
2. Preencha os campos:
   - **Endereço do servidor:** `https://whatsapp.veroconsorciosbr.com.br`;
   - **Chave global (apikey):** a chave do passo 3;
   - **Endereço do CRM para o webhook:** deixe **em branco**;
   - **Modo de teste:** **desmarque**.
3. Clique em **Salvar**. O CRM confere o conector na hora:
   - **"conector respondendo e chave aceita"**: tudo certo;
   - **"recusou a chave"**: confira a chave (`vero-whatsapp dados` na VPS);
   - **"certificado HTTPS"** ou **"não foi possível falar"**: o DNS ainda não propagou ou a instalação não terminou.
     Espere uns minutos e salve de novo.

## 5. Conectar o número central (QR Code)

1. No CRM, abra **Comunicação › WhatsApp** e clique em **Conectar meu WhatsApp**. Dê um nome, por exemplo
   "Central Vero".
2. No celular do número central, abra o WhatsApp › **Aparelhos conectados** › **Conectar um aparelho** e aponte para o
   QR Code da tela.
3. Em alguns segundos aparece **"WhatsApp conectado"**. No celular, o CRM aparece como **"Vero CRM"** nos aparelhos
   conectados.

Cada especialista pode conectar o próprio WhatsApp do mesmo jeito. Na VPS de 1 GB, o número central e alguns números
de especialistas cabem bem; se forem muitos números, suba o plano para 2 GB no painel da Locaweb.

## 6. Ligar o agente de IA no número central

1. Crie a chave gratuita do Gemini em **aistudio.google.com** › **Get API key** › **Create API key**.
2. No CRM, abra **Integrações › Agente de IA** e preencha:
   - **Provedor:** Google Gemini, e cole a chave;
   - **Número central atendido pela IA:** o número conectado no passo 5;
   - **Especialista padrão para leads novos:** quem recebe o lead e a R1 quando a roleta não indicar ninguém.
3. **Primeiro teste, sem risco:** em **"Modo de teste: atender só estes números"**, coloque o seu número pessoal.
   Marque **Ligar o agente de IA** e **Salvar**.
4. Do seu celular pessoal, mande uma mensagem para o número central e acompanhe:
   - a conversa em **Comunicação › WhatsApp**;
   - o lead no **Pipeline**;
   - as **Últimas ações** do agente.
5. **Para valer:** quando estiver tudo certo, **apague os números do modo de teste** e salve. A partir daí, a IA atende
   todos os leads que escreverem para o número central.

> **IA no n8n, 24 horas na VPS (opcional):** para a IA rodar num fluxo do n8n, com base de conhecimento (CRM, transcrições
> das R1 e Google Drive), siga [`deploy/n8n/LEIA-ME.md`](../n8n/LEIA-ME.md). O instalador do n8n usa este mesmo conector.
> No CRM, o ligar e desligar continua igual.

## Começar do zero (zerar a VPS)

1. **Painel da Locaweb:** na VPS, use a opção de **reinstalar o sistema operacional** e escolha **Ubuntu 24.04**.
   Tudo o que estava na VPS é apagado. Anote a **nova senha do root**, se o painel ou o e-mail trouxer uma.
2. **No PowerShell do seu computador**, antes de entrar de novo, apague a "identidade" antiga da VPS, trocando pelo
   IP dela. Sem isso, o `ssh` recusa a conexão com o aviso "REMOTE HOST IDENTIFICATION HAS CHANGED":
   ```
   ssh-keygen -R IP-DA-VPS
   ```
3. Siga de novo a partir do passo 3 (Instalar o conector na VPS). O registro A no DNS continua valendo, porque o IP
   da VPS não muda ao reinstalar.
4. **Se o WhatsApp já estava conectado,** a conexão se perde. No celular, remova o aparelho "Vero CRM" em
   **Aparelhos conectados** e, no CRM, gere um novo QR Code para o número.

## Manutenção (na VPS)

| Comando | Para quê |
|---|---|
| `vero-whatsapp situacao` | Mostra se os serviços estão de pé e a memória usada |
| `vero-whatsapp registros` | Mostra os registros do conector ao vivo (Ctrl+C para sair) |
| `vero-whatsapp reiniciar` | Reinicia o conector (o WhatsApp continua conectado) |
| `vero-whatsapp dados` | Mostra o endereço e a chave para o CRM (e o login do n8n, se instalado) |
| `vero-whatsapp registros-n8n` | Registros do n8n ao vivo, se instalado (Ctrl+C para sair) |
| `vero-whatsapp diagnostico` | Confere números, webhook do CRM, últimas mensagens e erros (sem mostrar a chave nem os números completos) |

- **Reiniciar a VPS:** o conector volta sozinho.
- **Mudar algo ou corrigir o domínio:** rode `sudo DOMINIO=... bash instalar.sh` de novo. A chave, as senhas e os
  números conectados são mantidos. Com o n8n instalado, ele também é mantido (e o aviso do conector para ele).
- **Versão fixa:** a versão do conector é a **v2.3.8**. A partir da 2.4, a Evolution API passou a exigir a ativação
  de uma licença; confira isso antes de atualizar.
- **Arquivos:** ficam em `/opt/vero-whatsapp`. O `.env` guarda a chave do conector e a senha do banco: não publique
  nem envie esse arquivo.

## Se o CRM envia, mas não recebe as respostas

O envio vai do CRM para o conector; o recebimento é o caminho de volta: o conector avisa o CRM (webhook) a cada
mensagem.

**Primeiro, no CRM:** Integrações › WhatsApp Lite › no número, menu **⋯** › **Conferir recebimento**. O CRM confere a
conexão, corrige o endereço de aviso no conector, testa se recebe e mostra as mensagens que não entraram e por quê.
O caso mais comum é o número estar em **"Só conversas com cadastros do CRM"**: mensagens de leads novos (números que
ainda não estão no CRM) não entram. Para o número central, use **Registrar todas as conversas**.

**Se ainda não resolver**, rode o diagnóstico na VPS:
```
curl -fsSL https://raw.githubusercontent.com/gabrielbava/crm_cons-rcios_prim-rio/HEAD/deploy/whatsapp-lite/diagnostico.sh -o diagnostico.sh
bash diagnostico.sh
```
- **"Teste do CRM: 200 · OK"** e as respostas aparecem como **RECEBIDA**: o caminho está certo; confira o filtro da
  conversa no CRM e se o número do lead no cadastro é o mesmo do WhatsApp.
- **"o CRM não reconhece este número"**: o número foi apagado ou recriado no CRM. Desconecte e conecte de novo pelo CRM.
- **"Webhook: NÃO CADASTRADO"** ou **"FALHOU"**: o conector não está conseguindo avisar o CRM; mande o print.
- **"LID SEM número"**: o WhatsApp mandou a resposta sem o número de quem escreveu (endereçamento novo); mande o print.
- **Nenhuma RECEBIDA**: as respostas nem chegaram ao conector; desconecte e conecte o número de novo.

## Cuidados

- **Senha do root:** use uma senha forte, porque a VPS fica exposta na internet. Para trocar, entre na VPS e rode
  `passwd`.
- **Não é a API oficial:** o WhatsApp Lite não é a API oficial do WhatsApp. Use para conversas com leads, não para
  disparos em massa; o WhatsApp pode bloquear números que mandam muitas mensagens para quem não as espera.
- **Celular do número central:** precisa ficar ligado e com internet de vez em quando. O WhatsApp desconecta
  aparelhos vinculados depois de cerca de 14 dias sem o celular principal ficar on-line.
- **Se o número for desconectado:** em **Comunicação › WhatsApp**, gere um novo QR Code para o número e leia de novo.
