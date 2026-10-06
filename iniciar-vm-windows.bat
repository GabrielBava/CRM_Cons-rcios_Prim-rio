@echo off
REM Vero Consorcios - cria e liga a maquina virtual de teste (VirtualBox + Vagrant)
REM Basta dar dois cliques: o atalho entra sozinho na pasta certa (onde esta o Vagrantfile).
REM Sem blocos entre parenteses de proposito: pastas como "vero-consorcios-local (1)" quebrariam o script.

REM Reabre dentro de um cmd /k: a janela nunca fecha sozinha e qualquer erro fica visivel.
if /i "%~1"=="/manter" goto inicio
cmd /k ""%~f0" /manter"
exit /b

:inicio
title Vero Consorcios - maquina virtual de teste
cd /d "%~dp0"
echo Pasta: %CD%
echo.

if exist "Vagrantfile" goto tem_vagrantfile
echo [ERRO] Nao encontrei o arquivo Vagrantfile nesta pasta.
echo Descompacte o zip antes - botao direito no arquivo, Extrair tudo - e rode este atalho
echo de dentro da pasta vero-consorcios. Nao rode o atalho com o zip ainda aberto.
goto falhou
:tem_vagrantfile

where vagrant >nul 2>nul
if not errorlevel 1 goto tem_vagrant
echo [ERRO] Vagrant nao encontrado.
echo Instale em https://developer.hashicorp.com/vagrant/install e reinicie o computador.
goto falhou
:tem_vagrant

if exist "%VBOX_MSI_INSTALL_PATH%VBoxManage.exe" goto tem_virtualbox
if exist "%ProgramFiles%\Oracle\VirtualBox\VBoxManage.exe" goto tem_virtualbox
echo [ERRO] VirtualBox nao encontrado.
echo Instale em https://www.virtualbox.org/wiki/Downloads e rode este atalho de novo.
goto falhou
:tem_virtualbox

echo Criando e ligando a maquina virtual. Na primeira vez leva de 5 a 10 minutos...
echo.
call vagrant up
if errorlevel 1 goto falhou_vagrant

start "" http://localhost:8080/lp/
echo.
echo ============================================================
echo  Pronto! A maquina virtual esta ligada.
echo  CRM .......... http://localhost:8080/
echo  Landing page . http://localhost:8080/lp/
echo  Simulador .... http://localhost:8080/simulador/
echo  Login ........ admin@demo.local / demo12345
echo ============================================================
echo  Para desligar: digite  vagrant halt  aqui e tecle Enter.
echo  Pode fechar esta janela: a maquina continua ligada ate o vagrant halt.
echo.
goto :eof

:falhou_vagrant
echo.
echo [ERRO] O Vagrant nao conseguiu ligar a maquina virtual.
echo Se a mensagem citar VT-x, AMD-V ou virtualizacao: ative a virtualizacao na BIOS do computador.
echo Caso contrario, copie as mensagens acima e envie para analise.
:falhou
echo.
echo Depois de corrigir, rode este atalho de novo. Esta janela pode ser fechada.
echo.
