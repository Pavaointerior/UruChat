// modos: fonte única da verdade sobre os modos do agente.
// Expõe window.UruModos; consumido por sessoes.js, centro.js e modal.js.
window.UruModos = (function () {
  var ROTULOS = { total: "Acesso total", medio: "Médio", minimo: "Mínimo" };
  var DESCRICOES = {
    total: "Lê, cria e edita arquivos na árvore permitida (com backup) e pesquisa na internet.",
    medio: "Apenas leitura dos arquivos permitidos e pesquisa na internet, sem alterar código.",
    minimo: "Somente conversa e pesquisa na internet, sem acesso aos arquivos locais."
  };

  // Aliases legados aceitos ao normalizar um modo vindo da API/localStorage.
  var ALIASES = {
    medio: "medio",
    medium: "medio",
    apps: "medio",
    minimo: "minimo",
    musica: "minimo",
    conversa: "minimo"
  };

  var PADRAO = "total";

  function normalizar(m) {
    var v = String(m || "").toLowerCase();
    return ALIASES[v] || PADRAO;
  }

  function rotulo(m) {
    return ROTULOS[normalizar(m)] || ROTULOS[PADRAO];
  }

  function descricao(m) {
    return DESCRICOES[normalizar(m)] || "";
  }

  // Marca como ativo o card de modo correspondente e atualiza o selo do painel.
  function marcarCards(m) {
    var alvo = normalizar(m);
    document.querySelectorAll(".modo-card").forEach(function (card) {
      card.classList.toggle("ativo", card.dataset.modo === alvo);
    });
  }

  function atualizarSelo(m, el) {
    if (el) el.textContent = rotulo(m);
  }

  return {
    PADRAO: PADRAO,
    LISTA: ["total", "medio", "minimo"],
    normalizar: normalizar,
    rotulo: rotulo,
    descricao: descricao,
    marcarCards: marcarCards,
    atualizarSelo: atualizarSelo
  };
})();
