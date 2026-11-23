# Conector do WhatsApp Lite na VPS (Locaweb ou outra)

O WhatsApp Lite funciona como o WhatsApp Web: o celular conecta o CRM como um "aparelho conectado". Quem mantém essa
conexão aberta 24 horas é o **conector** (Evolution API v2), que roda numa VPS e repassa cada mensagem ao CRM. A Vercel
não mantém conexões abertas, por isso o conector fica fora dela.

> **Quer testar antes de contratar?** Use o kit `teste-no-computador/` (Docker Desktop no seu computador):
> passo a passo em [`teste-no-computador/LEIA-ME.md`](teste-no-computador/LEIA-ME.md).

## O que contratar

- **VPS Linux Ubuntu 22.04 ou 24.04**, com **2 GB de RAM** e 1 ou 2 vCPUs. Na Locaweb, o plano "VPS 2 GB" atende.
- Um **subdomínio** para o conector, por exemplo `whatsapp.veroconsorciosbr.com.br`.

## Passo a passo

1. **DNS** (onde o domínio está, hoje na HostGator): crie o registro **A** `whatsapp` apontando para o **IP da VPS**.
   Espere propagar (de minutos a algumas horas).
2. **Portas:** no painel da VPS, deixe liberadas as portas **22** (SSH), **80** e **443**.
3. **Acesse a VPS por SSH** (dados de acesso no painel da Locaweb):
   ```
   ssh root@IP-DA-VPS
   ```
4. **Copie esta pasta para a VPS** (ou baixe o repositório) e entre nela:
   ```
   git clone https://github.com/GabrielBava/CRM_Cons-rcios_Prim-rio.git
   cd CRM_Cons-rcios_Prim-rio/deploy/whatsapp-lite
   ```
5. **Rode o instalador:**
   ```
   sudo DOMINIO=whatsapp.veroconsorciosbr.com.br bash instalar-evolution.sh
   ```
   Ele instala o Docker, cria o `.env` com chave e senhas aleatórias, sobe a Evolution API (versão estável **v2.3.8**),
   o banco, o cache e o HTTPS automático, e no fim mostra o **endereço** e a **chave**.
6. **No CRM** (administrador): **Integrações › WhatsApp Lite › Servidor do WhatsApp Lite**: cole o endereço
   (`https://whatsapp.veroconsorciosbr.com.br`) e a chave, salve e desmarque o modo de teste.
   Outra forma: variáveis `EVOLUTION_API_URL` e `EVOLUTION_API_KEY` na Vercel (e publicar de novo).
7. **Conectar o número central:** em **Comunicação › WhatsApp › Conectar meu WhatsApp**, leia o QR Code com o celular
   do número central da Vero (Aparelhos conectados › Conectar um aparelho).
8. **Agente de IA:** em **Integrações › Agente de IA**, escolha o número central, ligue o agente e salve. A chave da
   Anthropic fica em Configurações › Integrações › IA generativa (ou `ANTHROPIC_API_KEY` na Vercel).

## Manutenção

- Situação: `docker compose ps` · registros: `docker compose logs -f evolution-api`
- Reiniciar: `docker compose restart`
- Atualizar: troque a versão da imagem em `docker-compose.yml` e rode `docker compose pull && docker compose up -d`.
  A partir da versão 2.4 da Evolution API, o fornecedor passou a exigir a ativação de uma licença: confira antes de
  atualizar.
- O `.env` guarda a chave do conector e a senha do banco: não publique nem envie esse arquivo.

## Cuidados

- O WhatsApp Lite não é a API oficial do WhatsApp: use para conversas com leads, não para disparos em massa (o WhatsApp
  pode bloquear números que enviam muitas mensagens para quem não as espera).
- O celular do número central precisa ficar ligado e com internet de vez em quando (o WhatsApp desconecta aparelhos
  vinculados depois de cerca de 14 dias sem o celular principal ficar on-line).
