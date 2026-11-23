// ajustes: tema claro/escuro (chave, endereço da API e modelo entram aqui depois)
(function () {
  var raiz = document.documentElement;
  var btn = document.getElementById("btn-tema");
  function mostrar() { btn.textContent = raiz.dataset.tema === "escuro" ? "☀️" : "🌙"; }
  btn.addEventListener("click", function () {
    var novo = raiz.dataset.tema === "escuro" ? "claro" : "escuro";
    raiz.dataset.tema = novo;
    try { localStorage.setItem("uruchat_tema", novo); } catch (e) {}
    mostrar();
  });
  mostrar();
})();
