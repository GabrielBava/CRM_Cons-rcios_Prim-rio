#!/usr/bin/env bash
# Conector do WhatsApp Lite (Evolution API v2.3.8) para o CRM Vero Consórcios, numa VPS Linux Ubuntu ou Debian.
# Cabe numa VPS de 1 GB (ex.: Locaweb "VPS 1 GB"): sem Redis, com memória de troca (swap) e registros limitados.
#
# Na VPS, como root (copie e cole as duas linhas):
#   curl -fsSL https://raw.githubusercontent.com/gabrielbava/crm_cons-rcios_prim-rio/HEAD/deploy/whatsapp-lite/instalar-evolution.sh -o instalar.sh
#   sudo DOMINIO=whatsapp.veroconsorciosbr.com.br bash instalar.sh
#
# DOMINIO: subdomínio com registro A apontando para o IP da VPS (o HTTPS automático depende disso).
# Rodar de novo atualiza a configuração e mantém a chave, as senhas e o WhatsApp conectado.
# No fim, mostra o endereço e a chave para colar no CRM (Integrações › WhatsApp Lite › Servidor do WhatsApp Lite).
# Com o n8n instalado (deploy/n8n/instalar-n8n.sh), mantém o n8n, o aviso do conector para ele e o endereço do n8n.
set -euo pipefail

PASTA="${VERO_PASTA:-/opt/vero-whatsapp}"
DOMINIO="${DOMINIO:-}"

etapa() { printf '\n==> %s\n' "$*"; }
aviso() { printf 'Aviso: %s\n' "$*"; }
falha() { printf '\nERRO: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || falha "rode como root: sudo DOMINIO=whatsapp.seudominio.com.br bash instalar.sh"
command -v apt-get >/dev/null 2>&1 || falha "este instalador é para Ubuntu ou Debian. No painel da VPS, reinstale com Ubuntu 24.04 (ou 22.04) e rode de novo."

if [ -z "$DOMINIO" ] && [ -f "$PASTA/.env" ]; then
  DOMINIO="$(grep -m1 '^DOMINIO=' "$PASTA/.env" | cut -d= -f2- || true)"
fi
[ -n "$DOMINIO" ] || falha "informe o subdomínio do conector: sudo DOMINIO=whatsapp.veroconsorciosbr.com.br bash instalar.sh"

export DEBIAN_FRONTEND=noninteractive
# VPS recém-ligada: o Ubuntu costuma estar instalando atualizações automáticas; espera elas terminarem
esperar_apt() {
  command -v fuser >/dev/null 2>&1 || return 0
  local avisou=0
  for _ in $(seq 1 120); do
    fuser /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock >/dev/null 2>&1 || return 0
    [ "$avisou" = 1 ] || { echo "O Ubuntu está instalando atualizações automáticas; aguardando terminar (até 10 minutos)..."; avisou=1; }
    sleep 5
  done
}
APT_OPCOES=(-y -qq -o DPkg::Lock::Timeout=600)

etapa "Pacotes básicos (1 a 2 minutos; a tela fica parada, é normal)"
esperar_apt
apt-get update "${APT_OPCOES[@]}" >/dev/null
apt-get install "${APT_OPCOES[@]}" ca-certificates curl openssl >/dev/null

# ---------------------------------------------------------------- endereço do conector
eh_ip() { [[ "$1" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; }
IP="$(curl -fsS4 --max-time 8 https://api.ipify.org 2>/dev/null || true)"
eh_ip "$IP" || IP="$(curl -fsS4 --max-time 8 https://ifconfig.me 2>/dev/null || true)"
eh_ip "$IP" || IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
eh_ip "$IP" || IP=""

DOMINIO="$(printf '%s' "$DOMINIO" | tr '[:upper:]' '[:lower:]' | sed -E 's#^https?://##; s#/.*$##')"
[[ "$DOMINIO" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || falha "domínio inválido: $DOMINIO"

if [ "$DOMINIO" != "localhost" ]; then
  APONTA="$(getent ahostsv4 "$DOMINIO" 2>/dev/null | awk 'NR==1 {print $1}' || true)"
  if [ -z "$APONTA" ]; then
    aviso "$DOMINIO ainda não aponta para nenhum IP. Crie o registro A no DNS apontando para ${IP:-o IP desta VPS}."
    aviso "O instalador continua; o HTTPS sai sozinho quando o DNS propagar."
  elif [ -n "$IP" ] && [ "$APONTA" != "$IP" ]; then
    aviso "$DOMINIO aponta para $APONTA, mas esta VPS é $IP. Corrija o registro A no DNS; o HTTPS sai sozinho depois."
  fi
fi

# ---------------------------------------------------------------- memória de troca (VPS com pouca RAM)
MEM_MB="$(awk '/^MemTotal/ {print int($2/1024)}' /proc/meminfo)"
SWAP_MB="$(awk '/^SwapTotal/ {print int($2/1024)}' /proc/meminfo)"
if [ "$MEM_MB" -lt 1900 ] && [ "$SWAP_MB" -lt 1000 ]; then
  etapa "Memória de troca (swap) de 2 GB: a VPS tem $MEM_MB MB de RAM"
  CRIADO=0
  if [ ! -f /swapfile ]; then
    if dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none && chmod 600 /swapfile && mkswap /swapfile >/dev/null; then
      CRIADO=1
    else
      rm -f /swapfile
    fi
  fi
  if [ -f /swapfile ] && swapon /swapfile 2>/dev/null; then
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    sysctl -qw vm.swappiness=10 || true
    echo 'vm.swappiness=10' > /etc/sysctl.d/99-vero-whatsapp.conf
  else
    aviso "esta VPS não permitiu ligar o swap. O conector funciona, mas com pouca folga de memória."
    [ "$CRIADO" = 1 ] && rm -f /swapfile
  fi
fi

LIVRE_GB="$(df -Pk / | awk 'NR==2 {print int($4/1024/1024)}')"
[ "$LIVRE_GB" -ge 4 ] || aviso "só $LIVRE_GB GB livres no disco; o conector precisa de uns 3 GB."

# ---------------------------------------------------------------- Docker
# Docker dos pacotes do próprio Ubuntu (vêm do espelho da hospedagem, mais confiável que o site do Docker, que já deu
# tempo esgotado na VPS da Locaweb). O site do Docker (get.docker.com) fica para sistemas sem esses pacotes.
docker_do_ubuntu() {
  rm -f /etc/apt/sources.list.d/docker.list /etc/apt/keyrings/docker.asc
  esperar_apt
  apt-get update "${APT_OPCOES[@]}" >/dev/null 2>&1 || true
  apt-get install "${APT_OPCOES[@]}" docker.io >/dev/null || return 1
  apt-get install "${APT_OPCOES[@]}" docker-compose-v2 >/dev/null 2>&1 || apt-get install "${APT_OPCOES[@]}" docker-compose-plugin >/dev/null 2>&1 || true
}
if ! command -v docker >/dev/null 2>&1; then
  etapa "Instalando o Docker (3 a 5 minutos; a tela fica parada, é normal)"
  esperar_apt
  if apt-cache show docker-compose-v2 >/dev/null 2>&1 && docker_do_ubuntu; then
    :
  elif curl -fsSL --max-time 60 https://get.docker.com -o /tmp/instalar-docker.sh && sh /tmp/instalar-docker.sh >/dev/null 2>&1; then
    :
  else
    falha "não foi possível instalar o Docker. Rode o instalador de novo em alguns minutos."
  fi
  rm -f /tmp/instalar-docker.sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true
if ! docker compose version >/dev/null 2>&1; then
  esperar_apt
  apt-get install "${APT_OPCOES[@]}" docker-compose-plugin >/dev/null 2>&1 \
    || apt-get install "${APT_OPCOES[@]}" docker-compose-v2 >/dev/null 2>&1 || true
fi
docker compose version >/dev/null 2>&1 || falha "o Docker Compose não ficou disponível nesta VPS."
docker info >/dev/null 2>&1 || falha "o Docker não iniciou nesta VPS. Confira se o plano é uma VPS com virtualização KVM (o Docker não roda em alguns tipos de VPS)."

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  etapa "Firewall: liberando SSH, HTTP e HTTPS"
  ufw allow OpenSSH >/dev/null || ufw allow 22/tcp >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
fi

# ---------------------------------------------------------------- arquivos do conector
etapa "Configuração em $PASTA"
mkdir -p "$PASTA"
cd "$PASTA"
ler() { grep -m1 "^$1=" "${2:-.env}" 2>/dev/null | cut -d= -f2- || true; }
CHAVE="$(ler AUTHENTICATION_API_KEY)"
SENHA="$(ler POSTGRES_PASSWORD)"
[ -n "$CHAVE" ] || CHAVE="$(openssl rand -hex 24)"
[ -n "$SENHA" ] || SENHA="$(openssl rand -hex 16)"

# n8n na mesma VPS (instalar-n8n.sh): o conector avisa o n8n de cada mensagem pela rede interna
N8N_DOMINIO=""
if [ -f n8n.env ] && [ -f docker-compose.n8n.yml ]; then
  N8N_DOMINIO="$(ler N8N_DOMINIO n8n.env)"
fi
if [ -n "$N8N_DOMINIO" ]; then
  AVISO_GLOBAL="# n8n nesta VPS (instalar-n8n.sh): o conector avisa o n8n de cada mensagem pela rede interna da VPS.
# O aviso de cada número para o CRM continua (status de entrega, conexão e QR Code).
COMPOSE_FILE=docker-compose.yml:docker-compose.n8n.yml
WEBHOOK_GLOBAL_ENABLED=true
WEBHOOK_GLOBAL_URL=http://n8n:5678/webhook/vero-whatsapp
WEBHOOK_GLOBAL_WEBHOOK_BY_EVENTS=false
WEBHOOK_EVENTS_MESSAGES_UPSERT=true"
  for ev in APPLICATION_STARTUP QRCODE_UPDATED MESSAGES_SET MESSAGES_EDITED MESSAGES_UPDATE MESSAGES_DELETE SEND_MESSAGE SEND_MESSAGE_UPDATE \
    CONTACTS_SET CONTACTS_UPSERT CONTACTS_UPDATE PRESENCE_UPDATE CHATS_SET CHATS_UPSERT CHATS_UPDATE CHATS_DELETE GROUPS_UPSERT GROUPS_UPDATE \
    GROUP_PARTICIPANTS_UPDATE CONNECTION_UPDATE REMOVE_INSTANCE LOGOUT_INSTANCE LABELS_EDIT LABELS_ASSOCIATION CALL TYPEBOT_START TYPEBOT_CHANGE_STATUS ERRORS; do
    AVISO_GLOBAL="$AVISO_GLOBAL
WEBHOOK_EVENTS_$ev=false"
  done
  AVISO_GLOBAL="$AVISO_GLOBAL
# O aviso para o CRM vai antes do aviso para o n8n: tentativas curtas para o n8n não ficar esperando
WEBHOOK_REQUEST_TIMEOUT_MS=8000
WEBHOOK_RETRY_MAX_ATTEMPTS=2
WEBHOOK_RETRY_INITIAL_DELAY_SECONDS=1
WEBHOOK_RETRY_MAX_DELAY_SECONDS=4"
else
  AVISO_GLOBAL="# O CRM cadastra o webhook de cada número sozinho: sem webhook global
WEBHOOK_GLOBAL_ENABLED=false"
fi

umask 077
cat > .env <<EOF
# Conector do WhatsApp Lite (Evolution API v2) do CRM Vero Consórcios. Gerado por instalar-evolution.sh.
# NÃO publique nem envie este arquivo: ele tem a chave do conector e a senha do banco.
# Para mudar algo, rode o instalador de novo (a chave e a senha são mantidas).
DOMINIO=$DOMINIO
TZ=America/Sao_Paulo

SERVER_NAME=evolution
SERVER_TYPE=http
SERVER_PORT=8080
SERVER_URL=https://$DOMINIO

# Chave global: a mesma que vai no CRM (Integrações › WhatsApp Lite › Servidor do WhatsApp Lite)
AUTHENTICATION_API_KEY=$CHAVE
AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true

POSTGRES_PASSWORD=$SENHA
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://evolution:$SENHA@postgres:5432/evolution?schema=evolution_api
DATABASE_CONNECTION_CLIENT_NAME=evolution_exchange
DATABASE_SAVE_DATA_INSTANCE=true
DATABASE_SAVE_DATA_NEW_MESSAGE=true
DATABASE_SAVE_MESSAGE_UPDATE=true
DATABASE_SAVE_DATA_CONTACTS=true
DATABASE_SAVE_DATA_CHATS=true
DATABASE_SAVE_DATA_LABELS=false
DATABASE_SAVE_DATA_HISTORIC=false

# Sem Redis (economiza memória na VPS de 1 GB): cache na memória do próprio conector
CACHE_REDIS_ENABLED=false
CACHE_LOCAL_ENABLED=true

# Nome que aparece no celular em "Aparelhos conectados"
CONFIG_SESSION_PHONE_CLIENT=Vero CRM
CONFIG_SESSION_PHONE_NAME=Chrome
QRCODE_LIMIT=30
DEL_INSTANCE=false

$AVISO_GLOBAL

CORS_ORIGIN=*
CORS_METHODS=GET,POST,PUT,DELETE
CORS_CREDENTIALS=true
LOG_LEVEL=ERROR,WARN,INFO
LOG_COLOR=false
LOG_BAILEYS=error
TELEMETRY_ENABLED=false
EOF
umask 022

cat > docker-compose.yml <<'EOF'
# Conector do WhatsApp Lite do CRM Vero Consórcios. Gerado por instalar-evolution.sh (rode o instalador de novo em vez
# de editar). Ajustado para VPS de 1 GB: Evolution API + Postgres enxuto + Caddy (HTTPS automático), sem Redis.
name: vero-whatsapp

x-registros: &registros
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"

services:
  evolution-api:
    # Versão fixa: a partir da 2.4, a Evolution API passou a exigir ativação de licença
    image: evoapicloud/evolution-api:v2.3.8
    restart: always
    depends_on:
      postgres:
        condition: service_healthy
    env_file: .env
    volumes:
      - evolution_instances:/evolution/instances
    expose:
      - "8080"
    logging: *registros

  postgres:
    image: postgres:15
    restart: always
    environment:
      POSTGRES_DB: evolution
      POSTGRES_USER: evolution
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      TZ: America/Sao_Paulo
    command: ["postgres", "-c", "max_connections=50", "-c", "shared_buffers=48MB", "-c", "work_mem=2MB",
              "-c", "maintenance_work_mem=32MB", "-c", "effective_cache_size=192MB"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U evolution -d evolution"]
      interval: 5s
      timeout: 5s
      retries: 30
    volumes:
      - postgres_data:/var/lib/postgresql/data
    logging: *registros

  caddy:
    image: caddy:2
    restart: always
    depends_on:
      - evolution-api
    ports:
      - "80:80"
      - "443:443"
    environment:
      DOMINIO: ${DOMINIO}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    logging: *registros

volumes:
  evolution_instances:
  postgres_data:
  caddy_data:
  caddy_config:
EOF

cat > Caddyfile <<'EOF'
# HTTPS automático (Let's Encrypt) no endereço do conector, encaminhando para a Evolution API
{$DOMINIO} {
	encode gzip
	reverse_proxy evolution-api:8080
}
EOF
if [ -n "$N8N_DOMINIO" ]; then
  cat >> Caddyfile <<EOF

# n8n (agente de IA do WhatsApp). O aviso do conector chega pela rede interna: de fora, esse endereço fica fechado.
$N8N_DOMINIO {
	encode gzip
	@aviso_do_conector path /webhook/vero-whatsapp* /webhook-test/vero-whatsapp*
	respond @aviso_do_conector "Somente o conector desta VPS usa este endereço." 403
	reverse_proxy n8n:5678
}
EOF
fi

cat > /usr/local/bin/vero-whatsapp <<EOF
#!/usr/bin/env bash
# Atalhos do conector do WhatsApp Lite (CRM Vero Consórcios)
cd "$PASTA" || exit 1
case "\${1:-situacao}" in
  situacao|status) docker compose ps; echo; free -m ;;
  registros|logs) docker compose logs --tail=200 -f evolution-api ;;
  registros-n8n|logs-n8n) docker compose logs --tail=200 -f n8n ;;
  reiniciar) docker compose restart ;;
  dados) cat DADOS-DO-CONECTOR.txt; if [ -f DADOS-DO-N8N.txt ]; then echo; cat DADOS-DO-N8N.txt; fi ;;
  diagnostico)
    curl -fsSL https://raw.githubusercontent.com/gabrielbava/crm_cons-rcios_prim-rio/HEAD/deploy/whatsapp-lite/diagnostico.sh -o /tmp/vero-diagnostico.sh \
      && bash /tmp/vero-diagnostico.sh ;;
  *) echo "Uso: vero-whatsapp situacao | registros | registros-n8n | reiniciar | dados | diagnostico" ;;
esac
EOF
chmod 755 /usr/local/bin/vero-whatsapp

# ---------------------------------------------------------------- subir
etapa "Baixando e subindo o conector (a primeira vez leva alguns minutos)"
# Se o Docker Hub não responder, usa o espelho do Google (mirror.gcr.io), que tem as mesmas imagens
usar_espelho() {
  [ -f /etc/docker/daemon.json ] && grep -q registry-mirrors /etc/docker/daemon.json && return 0
  [ -s /etc/docker/daemon.json ] && return 1
  mkdir -p /etc/docker
  echo '{ "registry-mirrors": ["https://mirror.gcr.io"] }' > /etc/docker/daemon.json
  systemctl restart docker && sleep 3
}
BAIXOU=0
for tentativa in 1 2 3; do
  if docker compose pull -q; then BAIXOU=1; break; fi
  if [ "$tentativa" != 3 ]; then
    echo "O download falhou; tentando de novo em 20 segundos ($tentativa de 3)..."
    [ "$tentativa" = 2 ] && usar_espelho && echo "Usando o espelho do Google para baixar os programas."
    sleep 20
  fi
done
imagens_locais() {
  local img
  for img in $(docker compose config --images 2>/dev/null); do docker image inspect "$img" >/dev/null 2>&1 || return 1; done
}
if [ "$BAIXOU" != 1 ]; then
  imagens_locais || falha "não foi possível baixar os programas do conector. Rode o instalador de novo em alguns minutos."
  aviso "não deu para baixar atualizações agora; usando os programas que já estão nesta VPS."
fi
docker compose up -d --remove-orphans
# O Caddy só lê o Caddyfile ao iniciar: recarrega para valer o endereço novo (conector ou n8n)
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 \
  || docker compose restart caddy >/dev/null 2>&1 || true

etapa "Aguardando o conector e o certificado HTTPS de https://$DOMINIO (até 5 minutos)"
INSEGURO=""
[ "$DOMINIO" = "localhost" ] && INSEGURO="-k"
OK=0
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null --max-time 8 $INSEGURO --resolve "$DOMINIO:443:127.0.0.1" "https://$DOMINIO/" 2>/dev/null; then OK=1; break; fi
  sleep 5
done
CHAVE_OK=0
if [ "$OK" = 1 ] && curl -fsS -o /dev/null --max-time 15 $INSEGURO --resolve "$DOMINIO:443:127.0.0.1" -H "apikey: $CHAVE" "https://$DOMINIO/instance/fetchInstances" 2>/dev/null; then
  CHAVE_OK=1
fi

umask 077
cat > DADOS-DO-CONECTOR.txt <<EOF
Conector do WhatsApp Lite - dados para o CRM (Integrações › WhatsApp Lite › Servidor do WhatsApp Lite)
Endereço do servidor: https://$DOMINIO
Chave global (apikey): $CHAVE
EOF
umask 022

# Chamado pelo instalador do n8n: ele mostra o resumo dele
if [ -n "${VERO_SEM_RESUMO:-}" ]; then
  if [ "$OK" = 1 ] && [ "$CHAVE_OK" = 1 ]; then echo "Conector do WhatsApp no ar em https://$DOMINIO."; else aviso "https://$DOMINIO ainda não respondeu (confira o DNS e as portas 80 e 443)."; fi
  exit 0
fi

echo
echo "=================================================================================="
if [ "$OK" = 1 ] && [ "$CHAVE_OK" = 1 ]; then
  echo " Conector do WhatsApp Lite no ar."
else
  echo " O conector subiu, mas https://$DOMINIO ainda não respondeu."
  echo " - Confira se o registro A do DNS aponta para ${IP:-o IP desta VPS} e se as portas 80 e 443 estão liberadas"
  echo "   no painel da VPS. O HTTPS sai sozinho quando isso estiver certo (não precisa rodar de novo)."
  echo " - Situação: vero-whatsapp situacao   ·   Registros: vero-whatsapp registros"
fi
echo
echo " No CRM (administrador): Integrações › WhatsApp Lite › Servidor do WhatsApp Lite"
echo "   Endereço do servidor:  https://$DOMINIO"
echo "   Chave global (apikey): $CHAVE"
echo
echo " Esses dados ficam guardados nesta VPS: para ver de novo, rode  vero-whatsapp dados"
echo " Guarde a chave em local seguro e não a envie para ninguém."
echo "=================================================================================="
