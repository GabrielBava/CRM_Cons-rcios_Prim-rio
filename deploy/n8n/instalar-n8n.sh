#!/usr/bin/env bash
# n8n (agente de IA do WhatsApp) na mesma VPS do conector do WhatsApp Lite, ligado ao CRM Vero Consórcios.
# Fica no ar 24 horas: o conector avisa o n8n de cada mensagem, o n8n pergunta ao CRM se a IA atende, responde com o
# Gemini e a base de conhecimento, e o CRM envia a resposta. Ligar/desligar a IA continua no CRM.
#
# Antes: o conector instalado (deploy/whatsapp-lite/instalar-evolution.sh), um registro A no DNS para o n8n
# (ex.: n8n.veroconsorciosbr.com.br apontando para o IP da VPS) e, no CRM, o token do n8n
# (Integrações › Agente de IA no WhatsApp › Provedor "Fluxo do n8n na VPS" › Gerar token).
#
# Na VPS, como root (copie e cole as duas linhas):
#   curl -fsSL https://raw.githubusercontent.com/gabrielbava/crm_cons-rcios_prim-rio/HEAD/deploy/n8n/instalar-n8n.sh -o instalar-n8n.sh
#   sudo bash instalar-n8n.sh
#
# O instalador pergunta o que precisa (ou use variáveis): N8N_DOMINIO, CRM_URL, CRM_TOKEN, GEMINI_KEY e N8N_EMAIL.
# Rodar de novo atualiza a configuração e mantém o n8n, a conta, os fluxos e as credenciais. Para trocar o token ou a
# chave, informe o novo valor; para reimportar os fluxos originais (apaga as mudanças feitas neles), use REIMPORTAR=1.
set -euo pipefail

PASTA="${VERO_PASTA:-/opt/vero-whatsapp}"
REF="${VERO_REF:-HEAD}"
RAW="https://raw.githubusercontent.com/gabrielbava/crm_cons-rcios_prim-rio/$REF"
N8N_IMAGEM="n8nio/n8n:2.49.6"
PG_IMAGEM="pgvector/pgvector:pg17"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLUXOS="fluxo-atendimento-whatsapp.json fluxo-base-conhecimento-crm.json fluxo-base-conhecimento-drive.json fluxo-retomar-conversas.json"

etapa() { printf '\n==> %s\n' "$*"; }
aviso() { printf 'Aviso: %s\n' "$*"; }
falha() { printf '\nERRO: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || falha "rode como root: sudo bash instalar-n8n.sh"
[ -f "$PASTA/.env" ] && [ -f "$PASTA/docker-compose.yml" ] \
  || falha "o conector do WhatsApp não está instalado em $PASTA. Instale primeiro com deploy/whatsapp-lite/instalar-evolution.sh (guia em deploy/whatsapp-lite/LEIA-ME.md)."
command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 || falha "Docker não encontrado. Rode de novo o instalador do conector."
command -v curl >/dev/null 2>&1 || falha "curl não encontrado (apt-get install -y curl)."
cd "$PASTA"

ler() { grep -m1 "^$1=" "${2:-.env}" 2>/dev/null | cut -d= -f2- || true; }
# ---------------------------------------------------------------- caminho até o CRM (Vercel)
# Algumas redes de VPS (já visto na Locaweb) não alcançam os endereços novos da Vercel: a conexão fica esperando até
# o tempo acabar. A Vercel atende o mesmo site em qualquer endereço dela; se o caminho normal não responde, testa
# outros endereços da Vercel e fixa no conector (e no n8n) o primeiro que responder.
# Usa CRM_URL; define CRM_HOST, CRM_PORTA e CRM_IP_FIXO (vazio quando o caminho normal funciona).
VERCEL_IPS="76.76.21.21 76.76.21.98 216.198.79.1 64.29.17.1"
crm_responde() { # [ip] -> código HTTP de /api/saude (000 = sem conexão)
  local fixo=()
  if [ -n "${1:-}" ]; then fixo=(--resolve "$CRM_HOST:$CRM_PORTA:$1"); fi
  curl -s -o /dev/null -w '%{http_code}' --connect-timeout 8 --max-time 20 "${fixo[@]}" "$CRM_URL/api/saude" 2>/dev/null || true
}
caminho_crm() {
  CRM_HOST="$(printf '%s' "$CRM_URL" | sed -E 's#^https?://##; s#/.*$##; s#:.*$##')"
  CRM_PORTA="$(printf '%s' "$CRM_URL" | sed -nE 's#^https?://[^/:]+:([0-9]+).*#\1#p')"
  if [ -z "$CRM_PORTA" ]; then
    if [[ "$CRM_URL" =~ ^http:// ]]; then CRM_PORTA=80; else CRM_PORTA=443; fi
  fi
  CRM_IP_FIXO=""
  local cod ip
  cod="$(crm_responde)"
  if [ -n "$cod" ] && [ "$cod" != 000 ]; then return 0; fi
  for ip in ${VERO_CRM_IPS:-} $(ler CRM_IP_FIXO crm.env) $VERCEL_IPS; do
    cod="$(crm_responde "$ip")"
    if [ -n "$cod" ] && [ "$cod" != 000 ]; then CRM_IP_FIXO="$ip"; return 0; fi
  done
  return 1
}
guardar_caminho_crm() {
  { echo "# Caminho desta VPS até o CRM. Gerado pelos instaladores; rode o instalador de novo para mudar."
    echo "CRM_URL=$CRM_URL"
    echo "CRM_IP_FIXO=$CRM_IP_FIXO"; } > crm.env
}
diagnostico_crm() {
  local ip r alvo
  echo
  echo "------------------------- copie daqui (não tem senha nem token) -------------------------"
  echo "CRM: $CRM_HOST · DNS: $(getent ahostsv4 "$CRM_HOST" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')"
  r="$(curl -sS -o /dev/null -w '%{http_code} %{remote_ip}' --connect-timeout 8 --max-time 20 "$CRM_URL/api/saude" 2>&1 | tail -1 || true)"
  echo "caminho normal: $r"
  for ip in $VERCEL_IPS; do
    r="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 8 --max-time 20 --resolve "$CRM_HOST:$CRM_PORTA:$ip" "$CRM_URL/api/saude" 2>&1 | tail -1 || true)"
    echo "vercel $ip: $r"
  done
  for alvo in https://github.com https://vercel.com https://www.google.com; do
    r="$(curl -sS -o /dev/null -w '%{http_code} %{remote_ip}' --connect-timeout 8 --max-time 15 "$alvo" 2>&1 | tail -1 || true)"
    echo "$alvo: $r"
  done
  echo "----------------------------------------- até aqui -----------------------------------------"
}
DOMINIO="$(ler DOMINIO)"
SENHA_PG="$(ler POSTGRES_PASSWORD)"
[ -n "$DOMINIO" ] && [ -n "$SENHA_PG" ] || falha "o arquivo $PASTA/.env está incompleto. Rode de novo o instalador do conector."
PRIMEIRA=1
[ -f DADOS-DO-N8N.txt ] && PRIMEIRA=0

# ---------------------------------------------------------------- perguntas
TEM_TERMINAL=0
if [ -r /dev/tty ] && { : < /dev/tty; } 2>/dev/null; then TEM_TERMINAL=1; fi
perguntar() { # variável, pergunta, padrão, secreto(0/1)
  local var="$1" texto="$2" padrao="${3:-}" secreto="${4:-0}" resp=""
  [ -n "${!var:-}" ] && return 0
  if [ "$TEM_TERMINAL" = 1 ]; then
    if [ "$secreto" = 1 ]; then
      read -r -s -p "$texto${padrao:+ [$padrao]}: " resp < /dev/tty; echo
    else
      read -r -p "$texto${padrao:+ [$padrao]}: " resp < /dev/tty
    fi
  fi
  printf -v "$var" '%s' "${resp:-$padrao}"
}

N8N_DOMINIO="${N8N_DOMINIO:-}"
SUGESTAO="$(ler N8N_DOMINIO n8n.env)"
if [ -z "$SUGESTAO" ]; then
  case "$DOMINIO" in localhost) SUGESTAO="n8n.localhost" ;; *.*) SUGESTAO="n8n.${DOMINIO#*.}" ;; esac
fi
echo
echo "Instalação do n8n (agente de IA do WhatsApp) - responda e tecle Enter. Entre colchetes, o valor sugerido."
perguntar N8N_DOMINIO "Endereço do n8n (subdomínio com registro A para esta VPS)" "$SUGESTAO"
perguntar CRM_URL "Endereço do CRM (ex.: https://crm.veroconsorciosbr.com.br)" "$(ler CRM_URL n8n.env)"
if [ "$PRIMEIRA" = 1 ]; then
  perguntar CRM_TOKEN "Token do n8n gerado no CRM (começa com crm_n8n_; não aparece ao digitar)" "" 1
  perguntar GEMINI_KEY "Chave da API do Gemini (Google AI Studio; Enter para colocar depois no n8n)" "" 1
  perguntar N8N_EMAIL "Seu e-mail para entrar no n8n" ""
else
  perguntar CRM_TOKEN "Novo token do n8n (Enter para manter o atual)" "" 1
  perguntar GEMINI_KEY "Nova chave do Gemini (Enter para manter a atual)" "" 1
fi
DRIVE_ANTES="$(ler DRIVE_PASTA n8n.env)"
perguntar DRIVE_PASTA "Link da pasta do Google Drive com a base de conhecimento (Enter para pular)" "$DRIVE_ANTES"

N8N_DOMINIO="$(printf '%s' "$N8N_DOMINIO" | tr '[:upper:]' '[:lower:]' | sed -E 's#^https?://##; s#/.*$##')"
[[ "$N8N_DOMINIO" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || falha "endereço do n8n inválido: $N8N_DOMINIO"
[ "$N8N_DOMINIO" != "$DOMINIO" ] || falha "o n8n precisa de um endereço próprio (ex.: n8n.${DOMINIO#*.}), diferente do conector ($DOMINIO)."
CRM_URL="$(printf '%s' "${CRM_URL:-}" | sed -E 's#/+$##')"
[[ "$CRM_URL" =~ ^https?://[^/[:space:]]+$ ]] || falha "endereço do CRM inválido: '${CRM_URL:-}' (use só o endereço, ex.: https://crm.veroconsorciosbr.com.br)"
[[ "$CRM_URL" =~ ^https:// ]] || aviso "o CRM está sem HTTPS ($CRM_URL). Use https:// no CRM oficial."
CRM_TOKEN="$(printf '%s' "${CRM_TOKEN:-}" | tr -d '[:space:]')"
GEMINI_KEY="$(printf '%s' "${GEMINI_KEY:-}" | tr -d '[:space:]')"
N8N_EMAIL="$(printf '%s' "${N8N_EMAIL:-}" | tr -d '[:space:]')"
if [ "$PRIMEIRA" = 1 ]; then
  [ -n "$CRM_TOKEN" ] || falha "informe o token do n8n (no CRM: Integrações › Agente de IA no WhatsApp › Provedor \"Fluxo do n8n na VPS\" › Gerar token)."
  [[ "$N8N_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || falha "e-mail inválido: '$N8N_EMAIL'"
fi
[ -z "$CRM_TOKEN" ] || [[ "$CRM_TOKEN" =~ ^crm_n8n_[A-Za-z0-9_-]+$ ]] || falha "o token do n8n começa com crm_n8n_ (copie de novo no CRM)."
[ -z "$GEMINI_KEY" ] || [[ "$GEMINI_KEY" =~ ^[A-Za-z0-9_-]{20,}$ ]] || falha "chave do Gemini inválida (copie de novo no Google AI Studio)."
# Pasta do Drive: aceita o link (https://drive.google.com/drive/folders/...) ou só o ID; guarda o link limpo
DRIVE_PASTA="$(printf '%s' "${DRIVE_PASTA:-}" | tr -d '[:space:]')"
if [ -n "$DRIVE_PASTA" ]; then
  ID_PASTA="$(printf '%s' "$DRIVE_PASTA" | sed -nE 's#.*folders/([-A-Za-z0-9_]+).*#\1#p')"
  if [ -z "$ID_PASTA" ] && [[ "$DRIVE_PASTA" =~ ^[-A-Za-z0-9_]{15,}$ ]]; then ID_PASTA="$DRIVE_PASTA"; fi
  [ -n "$ID_PASTA" ] || falha "link da pasta do Drive inválido: abra a pasta no navegador e copie o endereço (https://drive.google.com/drive/folders/...)."
  DRIVE_PASTA="https://drive.google.com/drive/folders/$ID_PASTA"
fi

# ---------------------------------------------------------------- DNS e ligação com o CRM
if [ "$N8N_DOMINIO" != "n8n.localhost" ] && [[ "$N8N_DOMINIO" != *.localhost ]]; then
  IP="$(curl -fsS4 --max-time 8 https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')"
  APONTA="$(getent ahostsv4 "$N8N_DOMINIO" 2>/dev/null | awk 'NR==1 {print $1}' || true)"
  if [ -z "$APONTA" ]; then
    aviso "$N8N_DOMINIO ainda não aponta para nenhum IP. Crie o registro A no DNS para ${IP:-o IP desta VPS}; o HTTPS sai sozinho depois."
  elif [ -n "$IP" ] && [ "$APONTA" != "$IP" ]; then
    aviso "$N8N_DOMINIO aponta para $APONTA, mas esta VPS é $IP. Corrija o registro A; o HTTPS sai sozinho depois."
  fi
fi

etapa "Conferindo o caminho desta VPS até o CRM ($CRM_URL)"
if caminho_crm; then
  if [ -n "$CRM_IP_FIXO" ]; then
    echo "O caminho normal até a Vercel não responde nesta VPS, mas o endereço $CRM_IP_FIXO da Vercel responde."
    echo "O n8n e o conector vão falar com o CRM por ele (isso também faz o conector voltar a avisar o CRM das mensagens)."
  else
    echo "A VPS alcança o CRM."
  fi
  guardar_caminho_crm
else
  diagnostico_crm
  falha "esta VPS não conseguiu falar com o CRM ($CRM_URL) por nenhum caminho. Confira se o endereço abre no navegador e mande o bloco acima para o suporte (ou para quem está configurando)."
fi
FIXO_CRM=()
[ -z "$CRM_IP_FIXO" ] || FIXO_CRM=(--resolve "$CRM_HOST:$CRM_PORTA:$CRM_IP_FIXO")

PROVEDOR=""
if [ -n "$CRM_TOKEN" ]; then
  RESP="$(mktemp)"
  COD="$(curl -sS -o "$RESP" -w '%{http_code}' --max-time 30 "${FIXO_CRM[@]}" -H "Authorization: Bearer $CRM_TOKEN" "$CRM_URL/api/integracoes/n8n/status" 2>"$RESP.err" || true)"
  case "$COD" in
    200)
      PROVEDOR="$(grep -o '"provedor":"[a-z0-9]*"' "$RESP" | head -1 | cut -d'"' -f4 || true)"
      echo "CRM respondeu: ligação e token certos." ;;
    401) rm -f "$RESP" "$RESP.err"; falha "o CRM recusou o token. Gere de novo em Integrações › Agente de IA no WhatsApp e rode o instalador outra vez." ;;
    404) rm -f "$RESP" "$RESP.err"; falha "o CRM em $CRM_URL ainda não tem a integração com o n8n. Publique a versão nova do CRM (ou confira o endereço)." ;;
    000) ERRO="$(tail -1 "$RESP.err" 2>/dev/null)"; rm -f "$RESP" "$RESP.err"
      falha "esta VPS não conseguiu falar com o CRM ($ERRO). Confira o endereço do CRM e se ele abre no navegador; a VPS precisa acessar a internet." ;;
    *) aviso "o CRM respondeu com o código $COD em /api/integracoes/n8n/status. O instalador continua." ;;
  esac
  rm -f "$RESP" "$RESP.err"
fi

# ---------------------------------------------------------------- memória
MEM_MB="$(awk '/^MemTotal/ {print int($2/1024)}' /proc/meminfo)"
SWAP_MB="$(awk '/^SwapTotal/ {print int($2/1024)}' /proc/meminfo)"
if [ "$MEM_MB" -lt 1900 ]; then
  aviso "a VPS tem $MEM_MB MB de RAM. O n8n com o conector funciona, mas o recomendado é o plano de 2 GB."
  if [ "$SWAP_MB" -lt 1500 ] && [ ! -f /swapfile-n8n ]; then
    etapa "Memória de troca extra (1 GB) para o n8n"
    if dd if=/dev/zero of=/swapfile-n8n bs=1M count=1024 status=none && chmod 600 /swapfile-n8n && mkswap /swapfile-n8n >/dev/null && swapon /swapfile-n8n 2>/dev/null; then
      grep -q '^/swapfile-n8n ' /etc/fstab || echo '/swapfile-n8n none swap sw 0 0' >> /etc/fstab
    else
      swapoff /swapfile-n8n 2>/dev/null || true; rm -f /swapfile-n8n
      aviso "esta VPS não permitiu mais memória de troca."
    fi
  fi
fi

# ---------------------------------------------------------------- arquivos
etapa "Configuração do n8n em $PASTA"
CHAVE_N8N="$(ler N8N_ENCRYPTION_KEY n8n.env)"
[ -n "$CHAVE_N8N" ] || CHAVE_N8N="$(openssl rand -hex 32)"
SENHA_IA="$(ler POSTGRES_PASSWORD base-ia.env)"
[ -n "$SENHA_IA" ] || SENHA_IA="$(openssl rand -hex 16)"
umask 077
cat > base-ia.env <<EOF
# Base de conhecimento da IA (Postgres 17 com pgvector). Gerado por instalar-n8n.sh. NÃO publique este arquivo.
POSTGRES_DB=base_ia
POSTGRES_USER=vero
POSTGRES_PASSWORD=$SENHA_IA
TZ=America/Sao_Paulo
EOF
cat > n8n.env <<EOF
# n8n do CRM Vero Consórcios (agente de IA do WhatsApp). Gerado por instalar-n8n.sh; rode o instalador de novo para mudar.
# NÃO publique nem envie este arquivo: ele tem a chave que protege as credenciais do n8n e a senha do banco.
N8N_DOMINIO=$N8N_DOMINIO
CRM_URL=$CRM_URL
DRIVE_PASTA=$DRIVE_PASTA

N8N_HOST=$N8N_DOMINIO
N8N_PROTOCOL=https
N8N_PORT=5678
# Só IPv4 (muitas VPS vêm sem IPv6 na rede do Docker)
N8N_LISTEN_ADDRESS=0.0.0.0
WEBHOOK_URL=https://$N8N_DOMINIO/
N8N_EDITOR_BASE_URL=https://$N8N_DOMINIO/
N8N_PROXY_HOPS=1
N8N_ENCRYPTION_KEY=$CHAVE_N8N
GENERIC_TIMEZONE=America/Sao_Paulo
TZ=America/Sao_Paulo

# Banco do próprio n8n: o interno (SQLite, no volume n8n_data). A base de conhecimento da IA fica no serviço base-ia
# (Postgres 17 com pgvector), separado do banco do conector do WhatsApp.
DB_TYPE=sqlite
DB_SQLITE_POOL_SIZE=2

# Enxuto para VPS pequena: execuções antigas apagadas (14 dias), sem telemetria
EXECUTIONS_DATA_PRUNE=true
EXECUTIONS_DATA_MAX_AGE=336
EXECUTIONS_DATA_PRUNE_MAX_COUNT=10000
N8N_DIAGNOSTICS_ENABLED=false
N8N_PERSONALIZATION_ENABLED=false
N8N_HIRING_BANNER_ENABLED=false
N8N_DEFAULT_BINARY_DATA_MODE=filesystem
NODE_OPTIONS=--max-old-space-size=640
EOF
umask 022

cat > docker-compose.n8n.yml <<EOF
# n8n do CRM Vero Consórcios, junto do conector (docker-compose.yml). Gerado por instalar-n8n.sh.
services:
  # Base de conhecimento da IA: Postgres 17 com pgvector, enxuto (separado do banco do conector)
  base-ia:
    image: $PG_IMAGEM
    restart: always
    env_file: base-ia.env
    command: ["postgres", "-c", "max_connections=20", "-c", "shared_buffers=32MB", "-c", "work_mem=4MB",
              "-c", "maintenance_work_mem=32MB", "-c", "effective_cache_size=128MB"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U vero -d base_ia"]
      interval: 5s
      timeout: 5s
      retries: 30
    volumes:
      - base_ia_data:/var/lib/postgresql/data
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  n8n:
    image: $N8N_IMAGEM
    restart: always
    depends_on:
      base-ia:
        condition: service_healthy
    env_file: n8n.env
    volumes:
      - n8n_data:/home/node/.n8n
    expose:
      - "5678"
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  caddy:
    depends_on:
      - n8n

volumes:
  n8n_data:
  base_ia_data:
EOF

# ---------------------------------------------------------------- programas
etapa "Baixando o n8n e o Postgres com pgvector (alguns minutos na primeira vez)"
baixar() { # imagem, alternativa (outro registro)
  docker image inspect "$1" >/dev/null 2>&1 && return 0
  local t
  for t in 1 2 3; do
    docker pull -q "$1" >/dev/null 2>&1 && return 0
    if [ -n "${2:-}" ] && docker pull -q "$2" >/dev/null 2>&1; then docker tag "$2" "$1"; return 0; fi
    [ "$t" = 3 ] || { echo "O download falhou; tentando de novo em 20 segundos ($t de 3)..."; sleep 20; }
  done
  return 1
}
baixar "$N8N_IMAGEM" "docker.n8n.io/$N8N_IMAGEM" || falha "não foi possível baixar o n8n. Rode o instalador de novo em alguns minutos."
baixar "$PG_IMAGEM" "mirror.gcr.io/$PG_IMAGEM" || falha "não foi possível baixar o Postgres com pgvector. Rode o instalador de novo em alguns minutos."

# ---------------------------------------------------------------- conector + n8n
etapa "Atualizando o conector para avisar o n8n e subindo tudo"
EVO="$AQUI/../whatsapp-lite/instalar-evolution.sh"
if [ ! -f "$EVO" ]; then
  EVO="$(mktemp)"
  curl -fsSL "$RAW/deploy/whatsapp-lite/instalar-evolution.sh" -o "$EVO" || falha "não foi possível baixar o instalador do conector."
fi
VERO_SEM_RESUMO=1 VERO_PASTA="$PASTA" DOMINIO="$DOMINIO" CRM_URL="$CRM_URL" bash "$EVO"
grep -q '^COMPOSE_FILE=docker-compose.yml:docker-compose.n8n.yml' .env || falha "o instalador do conector não ligou o n8n (use a versão mais nova do instalador do conector)."

etapa "Aguardando o n8n iniciar (até 5 minutos)"
no_n8n() { local codigo="$1"; shift; docker compose exec -T n8n node -e "$codigo" "$@"; }
OK_N8N=0
for _ in $(seq 1 60); do
  if no_n8n "fetch('http://127.0.0.1:5678/healthz/readiness').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" >/dev/null 2>&1; then OK_N8N=1; break; fi
  sleep 5
done
[ "$OK_N8N" = 1 ] || falha "o n8n não iniciou. Veja os registros com: vero-whatsapp registros-n8n"
# A tabela da base de conhecimento (as mesmas colunas que o n8n cria) já existe antes do primeiro fluxo rodar
docker compose exec -T -e PGOPTIONS=--client-min-messages=warning base-ia psql -U vero -d base_ia -q \
  -c "CREATE EXTENSION IF NOT EXISTS vector" \
  -c "CREATE TABLE IF NOT EXISTS vero_conhecimento (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, text text, metadata jsonb, embedding vector)" >/dev/null \
  || falha "a base de conhecimento (pgvector) não ativou. Veja: vero-whatsapp situacao"


# ---------------------------------------------------------------- credenciais e fluxos
etapa "Credenciais e fluxos no n8n"
TMP="$PASTA/.n8n-importar"
rm -rf "$TMP"; mkdir -p "$TMP"; chmod 700 "$TMP"
umask 077
{
  echo '['
  printf '{"id":"VeroPostgres0001","name":"Postgres da VPS (base de conhecimento)","type":"postgres","data":{"host":"base-ia","port":5432,"database":"base_ia","user":"vero","password":"%s","ssl":"disable","sshTunnel":false}}' "$SENHA_IA"
  if [ -n "$CRM_TOKEN" ]; then
    printf ',{"id":"VeroCrmToken0001","name":"CRM Vero (token do n8n)","type":"httpHeaderAuth","data":{"name":"Authorization","value":"Bearer %s"}}' "$CRM_TOKEN"
  fi
  if [ -n "$GEMINI_KEY" ] || [ "$PRIMEIRA" = 1 ]; then
    printf ',{"id":"VeroGemini000001","name":"Google Gemini (Vero)","type":"googlePalmApi","data":{"host":"https://generativelanguage.googleapis.com","apiKey":"%s"}}' "${GEMINI_KEY:-COLOQUE-A-CHAVE-DO-GEMINI}"
  fi
  echo ']'
} > "$TMP/credenciais.json"
umask 022

ORIGEM="$AQUI"
for f in $FLUXOS; do
  if [ -f "$ORIGEM/$f" ]; then cp "$ORIGEM/$f" "$TMP/$f"
  else curl -fsSL "$RAW/deploy/n8n/$f" -o "$TMP/$f" || falha "não foi possível baixar o fluxo $f."
  fi
  sed -i "s#https://SEU-CRM.com.br#$CRM_URL#g" "$TMP/$f"
  [ -z "$DRIVE_PASTA" ] || sed -i "s#COLE-AQUI-O-LINK-DA-PASTA-DO-DRIVE#$DRIVE_PASTA#g" "$TMP/$f"
done
chown -R 1000:1000 "$TMP"
docker compose cp "$TMP/." n8n:/tmp/vero-importar/ >/dev/null
docker compose exec -T n8n n8n import:credentials --input=/tmp/vero-importar/credenciais.json >/dev/null 2>&1 || falha "não foi possível criar as credenciais no n8n (vero-whatsapp registros-n8n)."
# Google Drive: credencial em branco, já ligada ao fluxo do Drive (você cola o ID e a chave do cliente OAuth e entra
# com o Google). Só cria se ainda não existe, para não apagar o acesso já autorizado.
if ! docker compose exec -T n8n n8n export:credentials --id=VeroGDrive000001 --output=/tmp/vero-importar/drive-existe.json >/dev/null 2>&1; then
  printf '[{"id":"VeroGDrive000001","name":"Google Drive (Vero)","type":"googleDriveOAuth2Api","data":{"clientId":"","clientSecret":""}}]' > "$TMP/drive.json"
  chown 1000:1000 "$TMP/drive.json"
  docker compose cp "$TMP/drive.json" n8n:/tmp/vero-importar/drive.json >/dev/null 2>&1 \
    && docker compose exec -T n8n n8n import:credentials --input=/tmp/vero-importar/drive.json >/dev/null 2>&1 \
    || aviso "não foi possível criar a credencial do Google Drive; crie no n8n (Google Drive OAuth2 API) se for usar o Drive."
fi

EXISTENTES="$(docker compose exec -T n8n n8n list:workflow 2>/dev/null | cut -d'|' -f1 || true)"
# Atendimento de uma versão antiga (sem o gatilho da retomada): atualiza sozinho, guardando uma cópia antes
ATUALIZAR_ATENDIMENTO=0
if printf '%s\n' "$EXISTENTES" | grep -qx VeroAtendimento1 \
  && ! docker compose exec -T n8n n8n export:workflow --id=VeroAtendimento1 2>/dev/null | grep -q executeWorkflowTrigger; then
  ATUALIZAR_ATENDIMENTO=1
fi
mkdir -p "$PASTA/backup-fluxos"
IMPORTOU=0
for f in $FLUXOS; do
  case "$f" in
    fluxo-atendimento-whatsapp.json) ID=VeroAtendimento1 ;;
    fluxo-base-conhecimento-crm.json) ID=VeroBaseCrm00001 ;;
    fluxo-retomar-conversas.json) ID=VeroRetomar00001 ;;
    *) ID=VeroBaseDrive001 ;;
  esac
  if printf '%s\n' "$EXISTENTES" | grep -qx "$ID"; then
    if [ -z "${REIMPORTAR:-}" ]; then
      if [ "$ID" = VeroBaseDrive001 ] && [ -n "$DRIVE_PASTA" ] && [ "$DRIVE_PASTA" != "$DRIVE_ANTES" ]; then
        # Pasta do Drive nova: o fluxo do Drive é trocado pelo original já com a pasta
        echo "Pasta do Drive nova: atualizando o fluxo do Drive."
      elif [ "$ID" = VeroAtendimento1 ] && [ "$ATUALIZAR_ATENDIMENTO" = 1 ]; then
        echo "Fluxo de atendimento de uma versão antiga: atualizando (retomada de conversas devolvidas e conferência da chave)."
      else
        echo "Fluxo $f já existe no n8n (mantido; REIMPORTAR=1 para trocar pelo original)."
        continue
      fi
    fi
    # Cópia da versão atual antes de trocar (para recuperar mudanças feitas no n8n)
    docker compose exec -T n8n n8n export:workflow --id="$ID" > "$PASTA/backup-fluxos/$ID-$(date +%Y%m%d-%H%M%S).json" 2>/dev/null || true
  fi
  docker compose exec -T n8n n8n import:workflow --input="/tmp/vero-importar/$f" >/dev/null 2>&1 || falha "não foi possível importar o fluxo $f."
  echo "Fluxo importado: $f"
  IMPORTOU=1
done
if [ "$IMPORTOU" = 1 ]; then
  # Publica o atendimento, a base do CRM e a retomada (o do Google Drive fica para depois de conectar a conta Google)
  docker compose exec -T n8n n8n publish:workflow --id=VeroAtendimento1 >/dev/null 2>&1 || aviso "publique o fluxo \"Vero - Atendimento no WhatsApp (IA)\" no n8n."
  docker compose exec -T n8n n8n publish:workflow --id=VeroBaseCrm00001 >/dev/null 2>&1 || aviso "publique o fluxo \"Vero - Base de conhecimento (CRM)\" no n8n."
  docker compose exec -T n8n n8n publish:workflow --id=VeroRetomar00001 >/dev/null 2>&1 || aviso "publique o fluxo \"Vero - Retomar conversas devolvidas\" no n8n."
fi
docker compose exec -T -u root n8n rm -rf /tmp/vero-importar >/dev/null 2>&1 || true
rm -rf "$TMP"
docker compose restart n8n >/dev/null
for _ in $(seq 1 60); do
  no_n8n "fetch('http://127.0.0.1:5678/healthz/readiness').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" >/dev/null 2>&1 && break
  sleep 5
done

# ---------------------------------------------------------------- conta do n8n
SENHA_N8N=""
if [ "$PRIMEIRA" = 1 ]; then
  etapa "Criando a sua conta no n8n"
  SENHA_N8N="Vero$(openssl rand -hex 6)9!"
  R="$(no_n8n "fetch('http://127.0.0.1:5678/rest/owner/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: process.argv[1], firstName: 'Administrador', lastName: 'Vero', password: process.argv[2] }) }).then(async (r) => console.log(r.status, (await r.text()).slice(0, 200))).catch((e) => console.log(0, e.message))" "$N8N_EMAIL" "$SENHA_N8N" 2>/dev/null || true)"
  case "$R" in
    200*) echo "Conta criada: $N8N_EMAIL" ;;
    *already*|*Already*) SENHA_N8N=""; aviso "o n8n já tinha uma conta de dono; use a que você criou." ;;
    *) SENHA_N8N=""; aviso "não foi possível criar a conta agora ($R). No primeiro acesso a https://$N8N_DOMINIO, o n8n pede para criar." ;;
  esac
fi

# ---------------------------------------------------------------- conferência
etapa "Conferindo"
AVISO_OK=0
if no_n8n "fetch('http://127.0.0.1:5678/webhook/vero-whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'diagnostico' }) }).then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" >/dev/null 2>&1; then
  AVISO_OK=1
  echo "Fluxo de atendimento ligado: o conector já avisa o n8n de cada mensagem."
else
  aviso "o fluxo de atendimento não respondeu. Abra o n8n e publique \"Vero - Atendimento no WhatsApp (IA)\"."
fi
INSEGURO=""
[[ "$N8N_DOMINIO" == *localhost ]] && INSEGURO="-k"
HTTPS_OK=0
for _ in $(seq 1 36); do
  if curl -fsS -o /dev/null --max-time 8 $INSEGURO --resolve "$N8N_DOMINIO:443:127.0.0.1" "https://$N8N_DOMINIO/healthz" 2>/dev/null; then HTTPS_OK=1; break; fi
  sleep 5
done
FECHADO="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 $INSEGURO --resolve "$N8N_DOMINIO:443:127.0.0.1" -X POST "https://$N8N_DOMINIO/webhook/vero-whatsapp" 2>/dev/null || true)"
[ "$HTTPS_OK" = 0 ] || [ "$FECHADO" = 403 ] || aviso "o endereço do aviso do conector respondeu $FECHADO de fora (esperado 403)."

umask 077
{
  echo "n8n do CRM Vero Consórcios"
  echo "Endereço: https://$N8N_DOMINIO"
  [ -n "$N8N_EMAIL" ] && echo "Login: $N8N_EMAIL"
  [ -n "$SENHA_N8N" ] && echo "Senha inicial: $SENHA_N8N (troque no n8n: Configurações › Pessoal)"
  echo "CRM: $CRM_URL"
} > DADOS-DO-N8N.tmp
if [ "$PRIMEIRA" = 0 ] && [ -f DADOS-DO-N8N.txt ]; then
  grep -E '^(Login|Senha inicial):' DADOS-DO-N8N.txt >> DADOS-DO-N8N.tmp 2>/dev/null || true
  awk '!seen[$0]++' DADOS-DO-N8N.tmp > DADOS-DO-N8N.txt
  rm -f DADOS-DO-N8N.tmp
else
  mv DADOS-DO-N8N.tmp DADOS-DO-N8N.txt
fi
umask 022

echo
echo "=================================================================================="
if [ "$HTTPS_OK" = 1 ] && [ "$AVISO_OK" = 1 ]; then
  echo " n8n no ar em https://$N8N_DOMINIO, ligado ao conector e ao CRM."
else
  echo " O n8n subiu, mas falta conferir o que está nos avisos acima."
  [ "$HTTPS_OK" = 1 ] || echo " - https://$N8N_DOMINIO ainda não respondeu: confira o registro A do DNS (o HTTPS sai sozinho depois)."
fi
echo
if [ -n "$SENHA_N8N" ]; then
  echo " Entre no n8n:  https://$N8N_DOMINIO"
  echo "   E-mail: $N8N_EMAIL"
  echo "   Senha inicial: $SENHA_N8N   (troque no primeiro acesso)"
  echo
fi
[ -n "$GEMINI_KEY" ] || [ "$PRIMEIRA" = 0 ] || echo " Falta a chave do Gemini: no n8n, abra Credenciais › \"Google Gemini (Vero)\" e cole a chave (Google AI Studio)."
if [ -n "$PROVEDOR" ] && [ "$PROVEDOR" != "n8n" ]; then
  echo " No CRM, o agente de IA está com o provedor \"$PROVEDOR\": escolha \"Fluxo do n8n na VPS\" e salve"
  echo "   (Integrações › Agente de IA no WhatsApp). Até lá, quem responde é o agente do próprio CRM."
fi
echo " Ligar e desligar a IA, Assumir/Devolver e o modo de teste continuam no CRM."
echo " Base de conhecimento: o fluxo \"Vero - Base de conhecimento (CRM)\" roda todo dia às 3h (ou abra e clique em Executar)."
if [ -n "$DRIVE_PASTA" ]; then
  echo " Google Drive: pasta configurada no fluxo \"Vero - Base de conhecimento (Google Drive)\". Falta conectar a conta Google"
  echo "   (credencial \"Google Drive (Vero)\", guia deploy/n8n/LEIA-ME.md seção 6c) e clicar em Execute e depois em Publish nesse fluxo."
else
  echo " Google Drive (opcional): fluxo \"Vero - Base de conhecimento (Google Drive)\" (guia em deploy/n8n/LEIA-ME.md)."
fi
echo
echo " Para ver estes dados de novo:  vero-whatsapp dados    ·    Registros do n8n:  vero-whatsapp registros-n8n"
echo "=================================================================================="
