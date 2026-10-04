#!/usr/bin/env bash
# Vero Consórcios — CRM, simulador e landing page na sua máquina
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js não encontrado. Instale o Node.js 22 LTS ou superior em https://nodejs.org e rode de novo."
  exit 1
fi
( sleep 2; (command -v open >/dev/null && open http://127.0.0.1:3000/lp/) || (command -v xdg-open >/dev/null && xdg-open http://127.0.0.1:3000/lp/) ) >/dev/null 2>&1 &
exec node --disable-warning=ExperimentalWarning scripts/local.js
