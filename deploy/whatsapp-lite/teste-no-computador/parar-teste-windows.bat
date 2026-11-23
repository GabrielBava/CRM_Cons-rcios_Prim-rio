@echo off
REM Para o teste (os dados ficam guardados para a proxima vez)
cd /d "%~dp0"
docker compose down
echo Teste encerrado. No celular, remova o aparelho em WhatsApp > Aparelhos conectados se nao for testar de novo.
pause
