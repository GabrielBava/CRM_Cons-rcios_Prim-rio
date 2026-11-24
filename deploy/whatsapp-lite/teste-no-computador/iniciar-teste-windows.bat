@echo off
REM Vero Consorcios - teste do WhatsApp Lite e do agente de IA no computador (CRM + conector no Docker)
cd /d "%~dp0"
where docker >nul 2>nul
if errorlevel 1 (
  echo Docker nao encontrado. Instale o Docker Desktop em https://www.docker.com/products/docker-desktop
  echo e abra o Docker Desktop antes de rodar este atalho.
  pause
  exit /b 1
)
docker info >nul 2>nul
if errorlevel 1 (
  echo O Docker Desktop nao esta aberto. Abra o Docker Desktop, espere ficar "Running" e rode de novo.
  pause
  exit /b 1
)
echo Subindo o CRM e o conector do WhatsApp (a primeira vez baixa os programas e leva alguns minutos)...
docker compose up -d
if errorlevel 1 (
  echo Nao foi possivel subir. Veja a mensagem acima.
  pause
  exit /b 1
)
echo Aguardando o CRM responder...
for /l %%i in (1,1,60) do (
  powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:3000/api/saude) | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul && goto pronto
  timeout /t 3 >nul
)
echo O CRM ainda nao respondeu. Veja os registros com: docker compose logs crm
pause
exit /b 1
:pronto
start "" "http://localhost:3000/#/comunicacao/whatsapp"
echo.
echo CRM de teste: http://localhost:3000   (admin@demo.local / demo12345)
echo Para encerrar: parar-teste-windows.bat
pause
