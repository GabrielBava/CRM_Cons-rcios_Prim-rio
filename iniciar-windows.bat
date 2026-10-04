@echo off
REM Vero Consorcios - CRM, simulador e landing page na sua maquina
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale o Node.js 22 LTS ou superior em https://nodejs.org e rode de novo.
  pause
  exit /b 1
)
start "" http://127.0.0.1:3000/lp/
node --disable-warning=ExperimentalWarning scripts\local.js
pause
