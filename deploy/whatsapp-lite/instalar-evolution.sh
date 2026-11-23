#!/usr/bin/env bash
# Instala o conector do WhatsApp Lite (Evolution API v2) numa VPS Ubuntu (ex.: VPS da Locaweb), com HTTPS automático.
#
# Uso (na VPS, como root, dentro desta pasta):
#   sudo DOMINIO=whatsapp.veroconsorciosbr.com.br bash instalar-evolution.sh
#
# Antes: no DNS do domínio, crie o registro A "whatsapp" apontando para o IP da VPS (o HTTPS só sai depois disso).
# No fim, o script mostra o endereço e a chave para colar no CRM (Integrações › WhatsApp Lite › Servidor).
set -euo pipefail

DOMINIO="${DOMINIO:-}"
PASTA="$(cd "$(dirname "$0")" && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Rode como root: sudo DOMINIO=whatsapp.seudominio.com.br bash instalar-evolution.sh" >&2
  exit 1
fi
if [ -z "$DOMINIO" ]; then
  echo "Informe o domínio do conector: sudo DOMINIO=whatsapp.seudominio.com.br bash instalar-evolution.sh" >&2
  exit 1
fi

echo "==> Docker"
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y ca-certificates curl
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || { echo "O Docker Compose não ficou disponível. Instale o plugin docker-compose e rode de novo." >&2; exit 1; }

echo "==> Firewall (se o UFW estiver ativo: libera SSH, HTTP e HTTPS)"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
fi

cd "$PASTA"
if [ -f .env ]; then
  echo "==> Mantendo o .env existente (chave e senhas atuais)"
  sed -i "s|^DOMINIO=.*|DOMINIO=$DOMINIO|; s|^SERVER_URL=.*|SERVER_URL=https://$DOMINIO|" .env
else
  echo "==> Criando o .env com chave e senha aleatórias"
  CHAVE="$(openssl rand -hex 24)"
  SENHA="$(openssl rand -hex 16)"
  sed -e "s|^DOMINIO=.*|DOMINIO=$DOMINIO|" \
      -e "s|^SERVER_URL=.*|SERVER_URL=https://$DOMINIO|" \
      -e "s|^AUTHENTICATION_API_KEY=.*|AUTHENTICATION_API_KEY=$CHAVE|" \
      -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$SENHA|" \
      -e "s|^DATABASE_CONNECTION_URI=.*|DATABASE_CONNECTION_URI=postgresql://evolution:$SENHA@postgres:5432/evolution?schema=evolution_api|" \
      env.exemplo > .env
  chmod 600 .env
fi

echo "==> Subindo o conector (a primeira vez baixa as imagens e leva alguns minutos)"
docker compose pull
docker compose up -d

echo "==> Aguardando o conector responder em https://$DOMINIO"
OK=0
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "https://$DOMINIO/" 2>/dev/null; then OK=1; break; fi
  sleep 5
done

CHAVE_ATUAL="$(grep '^AUTHENTICATION_API_KEY=' .env | cut -d= -f2-)"
echo
if [ "$OK" = 1 ]; then
  echo "Conector do WhatsApp Lite no ar."
else
  echo "O conector subiu, mas https://$DOMINIO ainda não respondeu. Confira se o registro A do DNS já aponta para este servidor"
  echo "e se as portas 80 e 443 estão liberadas no painel da VPS. Situação: docker compose ps · registros: docker compose logs -f"
fi
echo
echo "No CRM (administrador): Integrações › WhatsApp Lite › Servidor do WhatsApp Lite"
echo "  Endereço do servidor: https://$DOMINIO"
echo "  Chave global (apikey): $CHAVE_ATUAL"
echo
echo "Guarde a chave em local seguro. Para atualizar a Evolution: edite a versão em docker-compose.yml e rode"
echo "  docker compose pull && docker compose up -d"
