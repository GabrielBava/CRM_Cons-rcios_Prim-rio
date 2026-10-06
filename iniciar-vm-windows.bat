@echo off
REM Vero Consorcios - cria e liga a maquina virtual de teste (VirtualBox + Vagrant)
REM Basta dar dois cliques: o atalho entra sozinho na pasta certa (onde esta o Vagrantfile).
cd /d "%~dp0"
if not exist "Vagrantfile" (
  echo Nao encontrei o arquivo Vagrantfile nesta pasta: %~dp0
  echo Descompacte o vero-consorcios-local.zip de novo e rode este atalho de dentro da pasta vero-consorcios.
  pause
  exit /b 1
)
where vagrant >nul 2>nul
if errorlevel 1 (
  echo Vagrant nao encontrado. Instale em https://developer.hashicorp.com/vagrant/install e reinicie o computador.
  pause
  exit /b 1
)
if not exist "%VBOX_MSI_INSTALL_PATH%VBoxManage.exe" if not exist "%ProgramFiles%\Oracle\VirtualBox\VBoxManage.exe" (
  echo VirtualBox nao encontrado. Instale em https://www.virtualbox.org/wiki/Downloads
  pause
  exit /b 1
)
echo Criando e ligando a maquina virtual (na primeira vez leva de 5 a 10 minutos)...
vagrant up
if errorlevel 1 (
  echo.
  echo Algo deu errado. Copie as mensagens acima e envie para analise.
  pause
  exit /b 1
)
start "" http://localhost:8080/lp/
echo.
echo Pronto! CRM: http://localhost:8080/   LP: http://localhost:8080/lp/   Simulador: http://localhost:8080/simulador/
echo Login: admin@demo.local / demo12345
echo Para desligar a maquina virtual: vagrant halt (nesta pasta) ou desligue pelo VirtualBox.
pause
