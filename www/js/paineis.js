// paineis: abrir/fechar lateral e painel, abas e prévia
(function () {
  var corpo = document.body;
  var estreita = window.matchMedia("(max-width: 900px)");

  function marcar(lado, ligado) {
    corpo.classList.toggle(lado + "-aberta", ligado);
    document.getElementById("btn-" + lado).setAttribute("aria-pressed", ligado ? "true" : "false");
  }
  function alternar(lado) {
    var ligado = !corpo.classList.contains(lado + "-aberta");
    marcar(lado, ligado);
    if (estreita.matches) {
      if (ligado) marcar(lado === "esq" ? "dir" : "esq", false);
    } else {
      try { localStorage.setItem("uruchat_" + lado, ligado ? "1" : "0"); } catch (e) {}
    }
  }
  function iniciar() {
    if (estreita.matches) { marcar("esq", false); marcar("dir", false); return; }
    ["esq", "dir"].forEach(function (lado) {
      var v = null;
      try { v = localStorage.getItem("uruchat_" + lado); } catch (e) {}
      marcar(lado, v !== "0");
    });
  }
  document.getElementById("btn-esq").addEventListener("click", function () { alternar("esq"); });
  document.getElementById("btn-dir").addEventListener("click", function () { alternar("dir"); });
  estreita.addEventListener("change", iniciar);
  iniciar();

  // abas do painel
  var abas = document.querySelectorAll(".aba");
  abas.forEach(function (b) {
    b.addEventListener("click", function () {
      abas.forEach(function (x) { x.classList.toggle("ativa", x === b); });
      document.querySelectorAll(".conteudo").forEach(function (c) {
        c.classList.toggle("ativo", c.id === "aba-" + b.dataset.aba);
      });
    });
  });

  // prévia: endereço (outra página do tablet) ou código colado
  var moldura = document.getElementById("moldura");
  var campoUrl = document.getElementById("campo-url");
  var campoCodigo = document.getElementById("campo-codigo");

  function novaMoldura(sandbox) {
    var f = document.createElement("iframe");
    f.id = "moldura"; f.className = "moldura"; f.setAttribute("sandbox", sandbox);
    moldura.replaceWith(f); moldura = f; return f;
  }
  function modo(m) {
    var end = m === "endereco";
    document.getElementById("linha-endereco").hidden = !end;
    campoCodigo.hidden = end;
    document.getElementById("linha-mostrar").hidden = end;
  }
  function irEndereco() {
    var u = campoUrl.value.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = "http://" + u;
    novaMoldura("allow-scripts allow-forms allow-same-origin").src = u;
  }
  document.getElementById("modo-endereco").addEventListener("click", function () { modo("endereco"); });
  document.getElementById("modo-codigo").addEventListener("click", function () { modo("codigo"); });
  document.getElementById("btn-ir").addEventListener("click", irEndereco);
  campoUrl.addEventListener("keydown", function (e) { if (e.key === "Enter") irEndereco(); });
  document.getElementById("btn-mostrar").addEventListener("click", function () {
    novaMoldura("allow-scripts allow-forms").srcdoc = campoCodigo.value;
  });
})();
