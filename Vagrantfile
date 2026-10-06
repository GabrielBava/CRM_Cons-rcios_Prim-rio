# Máquina virtual de teste do Vero Consórcios (Ubuntu 24.04 no VirtualBox).
#
#   1. Instale o VirtualBox (virtualbox.org) e o Vagrant (vagrantup.com).
#   2. Nesta pasta, rode:  vagrant up
#   3. Abra no navegador do seu computador:  http://localhost:8080/  (CRM)  ·  /lp/  ·  /simulador/
#
# Outros comandos: vagrant ssh (entrar na VM) · vagrant halt (desligar) · vagrant destroy (apagar a VM e recomeçar)
Vagrant.configure('2') do |config|
  config.vm.box = 'bento/ubuntu-24.04'
  config.vm.hostname = 'vero-consorcios'
  # Porta 3000 da VM aparece como 8080 no seu computador
  config.vm.network 'forwarded_port', guest: 3000, host: 8080, host_ip: '127.0.0.1'
  # Opcional: IP próprio na rede local (para abrir pelo celular na mesma rede Wi-Fi), descomente:
  # config.vm.network 'public_network'
  config.vm.synced_folder '.', '/vagrant'
  config.vm.provider 'virtualbox' do |vb|
    vb.name = 'Vero Consorcios (teste)'
    vb.memory = 2048
    vb.cpus = 2
  end
  config.vm.provision 'shell', inline: 'cd /vagrant && bash deploy/instalar-ubuntu.sh'
end
