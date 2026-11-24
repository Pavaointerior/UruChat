window.UruDireita = (function () {
  var elStatus = document.getElementById("dir-status");
  var elAcoes = document.getElementById("dir-acoes");
  var elTokens = document.getElementById("dir-tokens");
  var acoes = [];

  function limparAcoes() {
    acoes = [];
    if (elAcoes) elAcoes.textContent = "";
  }

  function registrarAcao(nome) {
    if (!nome) return;
    acoes.push(nome);
    if (elAcoes) elAcoes.textContent = acoes.slice(-5).join("\n");
  }

  function definir(statusTexto, tokens) {
    if (elStatus && statusTexto) elStatus.textContent = statusTexto;
    if (elTokens && tokens !== undefined) elTokens.textContent = Number(tokens || 0) + " nesta conversa";
  }

  return { limparAcoes: limparAcoes, registrarAcao: registrarAcao, definir: definir };
})();
