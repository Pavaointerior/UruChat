// Auto-recuperação do UruChat.
// Quando o servidor cai/é reiniciado, a página mostra um aviso e tenta
// reconectar sozinha. Assim que o servidor volta, recarrega automaticamente.
// NÃO interfere na conversa normal: só age quando detecta queda.
window.UruReconectar = (function () {
  var INTERVALO_MS = 2000;      // tenta a cada 2s
  var PACIENTE_MS = 60000;      // continua tentando por até ~60s
  var perdido = false;
  var timer = null;
  var inicio = 0;
  var banner = null;

  function criarBanner() {
    if (banner) return banner;
    banner = document.createElement("div");
    banner.id = "aviso-reconexao";
    banner.style.cssText = [
      "position:fixed", "left:0", "right:0", "top:0",
      "z-index:99999", "padding:8px 12px",
      "font:0.8rem/1.2 system-ui,sans-serif",
      "text-align:center", "background:#c0392b", "color:#fff",
      "box-shadow:0 1px 4px rgba(0,0,0,.4)"
    ].join(";");
    banner.textContent = "Conexão perdida. Reconectando...";
    document.body.appendChild(banner);
    return banner;
  }

  function mostrarAviso(txt, cor) {
    var b = criarBanner();
    b.textContent = txt;
    if (cor) b.style.background = cor;
    b.style.display = "block";
  }

  function esconderAviso() {
    if (banner) banner.style.display = "none";
  }

  // Verifica se o servidor responde. Usa fetch com no-store para não pegar cache.
  function servidorVivo() {
    return fetch("/api/ping?_=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.ok; })
      .catch(function () { return false; });
  }

  function loop() {
    if (!perdido) return;
    servidorVivo().then(function (ok) {
      if (ok) {
        // Voltou! Recarrega a página para restaurar tudo.
        mostrarAviso("Conectado! Recarregando...", "#27ae60");
        clearTimeout(timer);
        setTimeout(function () { location.reload(); }, 400);
        return;
      }
      if (Date.now() - inicio > PACIENTE_MS) {
        mostrarAviso("Servidor não voltou. Atualize a página manualmente.", "#c0392b");
        return; // para de tentar, evita loop infinito
      }
      timer = setTimeout(loop, INTERVALO_MS);
    });
  }

  function iniciarVigia() {
    if (perdido) return;
    perdido = true;
    inicio = Date.now();
    mostrarAviso("Conexão perdida. Reconectando...", "#c0392b");
    timer = setTimeout(loop, INTERVALO_MS);
  }

  // Permite que o centro.js avise quando uma requisição falhar por rede.
  function falhou() { iniciarVigia(); }

  // Vigia leve: detecta se a aba volta a ficar visível e o servidor sumiu.
  window.addEventListener("online", function () {
    if (perdido) { clearTimeout(timer); loop(); }
  });

  return { falhou: falhou };
})();
