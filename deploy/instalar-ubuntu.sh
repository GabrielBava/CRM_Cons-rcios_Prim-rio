#!/usr/bin/env bash
# Vero Consórcios — instalação em servidor ou máquina virtual Ubuntu 22.04/24.04 (CRM + simulador + landing page).
#
# Uso (dentro da pasta do sistema, como root ou com sudo):
#   sudo bash deploy/instalar-ubuntu.sh                     # teste: dados de demonstração, acesso pela porta 3000
#   sudo DOMINIO=crm.seudominio.com.br bash deploy/instalar-ubuntu.sh   # com HTTPS automático (Caddy + Let's Encrypt)
#
# Variáveis opcionais:
#   DOMINIO=crm.exemplo.com.br   publica com HTTPS (o DNS do domínio precisa apontar para o IP desta máquina)
#   DEMO=0                       não cria os dados de demonstração (o primeiro acesso cria o administrador)
#   DEMO_PASSWORD=...            senha dos usuários de demonstração (padrão demo12345)
#   PORTA=3000                   porta interna do CRM
set -euo pipefail

APP_DIR=/opt/vero-consorcios
DATA_DIR=/var/lib/vero-consorcios
ENV_FILE=/etc/vero-consorcios.env
PORTA="${PORTA:-3000}"
DEMO="${DEMO:-1}"
DEMO_PASSWORD="${DEMO_PASSWORD:-demo12345}"
DOMINIO="${DOMINIO:-}"
ORIGEM="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$(id -u)" -ne 0 ]; then echo "Rode com sudo: sudo bash deploy/instalar-ubuntu.sh"; exit 1; fi
echo "==> Vero Consórcios: instalando a partir de $ORIGEM"

# 1. Node.js 22 LTS (NodeSource)
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo "==> Instalando Node.js 22 LTS"
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
NODE_BIN="$(command -v node)"
"$NODE_BIN" -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22||(a===22&&b<13)) { console.error("Node.js 22.13 ou superior é necessário: "+process.versions.node); process.exit(1); }'

# 2. Usuário do serviço e arquivos
id vero >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin vero
mkdir -p "$APP_DIR" "$DATA_DIR"
if [ "$ORIGEM" != "$APP_DIR" ]; then
  echo "==> Copiando o sistema para $APP_DIR"
  rm -rf "${APP_DIR:?}"/*
  tar -C "$ORIGEM" --exclude=./node_modules --exclude=./data --exclude=./.git --exclude=./dist -cf - . | tar -C "$APP_DIR" -xf -
fi
chown -R root:root "$APP_DIR"
chmod -R a+rX "$APP_DIR"   # o serviço (usuário vero) lê todos os arquivos do sistema
chown -R vero:vero "$DATA_DIR"
chmod 750 "$DATA_DIR"

# 3. Configuração (chave de cifragem gerada uma única vez)
if [ ! -f "$ENV_FILE" ]; then
  KEY="$("$NODE_BIN" -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')"
  HOST_BIND=0.0.0.0
  [ -n "$DOMINIO" ] && HOST_BIND=127.0.0.1
  cat > "$ENV_FILE" <<EOF
# Configuração do Vero Consórcios (reinicie o serviço depois de alterar: sudo systemctl restart vero-consorcios)
HOST=$HOST_BIND
PORT=$PORTA
CRM_DB=$DATA_DIR/crm.db
CRM_SECRET_KEY=$KEY
${DOMINIO:+PUBLIC_URL=https://$DOMINIO}
# Google Agenda (R1 com Meet): GOOGLE_CLIENT_ID=... e GOOGLE_CLIENT_SECRET=...
# E-mail da ficha (SMTP): SMTP_HOST=... SMTP_PORT=465 SMTP_SECURITY=tls SMTP_USER=admin@veroconsorciosbr.com.br SMTP_PASSWORD=...
# Landing page em outro domínio: LP_ALLOWED_ORIGINS=https://www.seudominio.com.br
EOF
  chmod 600 "$ENV_FILE"
fi
set -a; . "$ENV_FILE"; set +a

# 4. Dados de demonstração (só num banco novo)
if [ "$DEMO" = "1" ] && [ ! -f "$CRM_DB" ]; then
  echo "==> Criando os dados de demonstração (senha: $DEMO_PASSWORD)"
  ( cd "$APP_DIR" && sudo -u vero env CRM_DB="$CRM_DB" CRM_SECRET_KEY="$CRM_SECRET_KEY" DEMO_PASSWORD="$DEMO_PASSWORD" \
      "$NODE_BIN" --disable-warning=ExperimentalWarning scripts/demo-data.js )
fi

# 5. Serviço (sobe sozinho com a máquina e reinicia se cair)
cat > /etc/systemd/system/vero-consorcios.service <<EOF
[Unit]
Description=Vero Consórcios (CRM, simulador e landing page)
After=network.target

[Service]
Type=simple
User=vero
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN --disable-warning=ExperimentalWarning server/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now vero-consorcios
systemctl restart vero-consorcios

# 6. HTTPS com domínio (Caddy obtém e renova o certificado sozinho)
if [ -n "$DOMINIO" ]; then
  echo "==> Configurando HTTPS para $DOMINIO"
  if ! command -v caddy >/dev/null 2>&1; then
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y && apt-get install -y caddy
  fi
  cat > /etc/caddy/Caddyfile <<EOF
$DOMINIO {
  encode gzip
  reverse_proxy 127.0.0.1:$PORTA
}
EOF
  systemctl restart caddy
fi

# 7. Firewall (se o ufw estiver ativo)
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  if [ -n "$DOMINIO" ]; then ufw allow 80/tcp; ufw allow 443/tcp; else ufw allow "$PORTA"/tcp; fi
fi

sleep 2
IP="$(hostname -I | awk '{print $1}')"
BASE="${DOMINIO:+https://$DOMINIO}"
BASE="${BASE:-http://$IP:$PORTA}"
echo
echo "Pronto! Vero Consórcios em execução."
echo "  CRM ............ $BASE/"
echo "  Landing page ... $BASE/lp/"
echo "  Simulador ...... $BASE/simulador/"
[ "$DEMO" = "1" ] && echo "  Login .......... admin@demo.local / $DEMO_PASSWORD"
echo "  Situação ....... sudo systemctl status vero-consorcios   ·   registros: sudo journalctl -u vero-consorcios -f"
echo "  Configuração ... $ENV_FILE   ·   banco: $DATA_DIR/crm.db (faça backup deste arquivo)"
