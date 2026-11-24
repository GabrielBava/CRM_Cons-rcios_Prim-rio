#!/usr/bin/env bash
# Vero Consórcios - teste do WhatsApp Lite e do agente de IA no computador (CRM + conector no Docker)
set -e
cd "$(dirname "$0")"
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker não encontrado. Instale o Docker Desktop (https://www.docker.com/products/docker-desktop) e abra-o."
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "O Docker não está rodando. Abra o Docker Desktop, espere ficar \"Running\" e rode de novo."
  exit 1
fi
echo "Subindo o CRM e o conector do WhatsApp (a primeira vez baixa os programas e leva alguns minutos)..."
docker compose up -d
echo "Aguardando o CRM responder..."
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null http://localhost:3000/api/saude 2>/dev/null; then
    URL="http://localhost:3000/#/comunicacao/whatsapp"
    (command -v open >/dev/null && open "$URL") || (command -v xdg-open >/dev/null && xdg-open "$URL") || true
    echo
    echo "CRM de teste: http://localhost:3000   (admin@demo.local / demo12345)"
    echo "Para encerrar: ./parar-teste-mac-linux.sh"
    exit 0
  fi
  sleep 3
done
echo "O CRM ainda não respondeu. Veja os registros com: docker compose logs crm"
exit 1
