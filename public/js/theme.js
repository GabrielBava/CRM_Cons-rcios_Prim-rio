// Aplica o tema (claro/escuro) escolhido pelo usuário antes de desenhar a tela. Sem escolha, segue o sistema.
(function () {
  try {
    var t = localStorage.getItem('crm-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
