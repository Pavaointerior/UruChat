// seletor_modelos: lista recolhível de modelos dentro da barra de digitação.
// Apenas interface; o estado fica em window.UruModelos.
(function () {
  var raiz = document.getElementById("seletor-modelo");
  var btn = document.getElementById("seletor-btn");
  var lista = document.getElementById("seletor-lista");
  var rotulo = document.getElementById("seletor-rotulo");
  if (!raiz || !btn || !lista || !rotulo || !window.UruModelos) return;

  var M = window.UruModelos;

  function aberto() { return !lista.hidden; }

  function fechar() {
    lista.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    raiz.classList.remove("aberto");
  }

  function abrir() {
    lista.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    raiz.classList.add("aberto");
  }

  function alternar() { aberto() ? fechar() : abrir(); }

  function marcarAtual() {
    rotulo.textContent = M.apelido(M.getAtual());
    raiz.classList.toggle("sem-visao", !M.suportaVisao(M.getAtual()));
  }

  function escolher(id) {
    fechar();
    if (id === M.getAtual()) return;
    M.definir(id).then(function (ok) {
      if (ok && window.UruDireita) {
        window.UruDireita.definir("Modelo: " + M.apelido(id), window.UruCentro ? window.UruCentro.getTokens() : undefined);
      }
    });
  }

  function render(estado) {
    marcarAtual();
    lista.innerHTML = "";
    var modelos = estado.lista || [];
    if (!modelos.length) {
      var vazio = document.createElement("li");
      vazio.className = "seletor-vazio";
      vazio.textContent = "Nenhum modelo disponível.";
      lista.appendChild(vazio);
      return;
    }
    modelos.forEach(function (info) {
      var item = document.createElement("li");
      item.className = "seletor-item" + (info.id === estado.atual ? " ativo" : "");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", info.id === estado.atual ? "true" : "false");

      var titulo = document.createElement("span");
      titulo.className = "seletor-item-nome";
      titulo.textContent = M.apelido(info.id);

      var detalhe = document.createElement("span");
      detalhe.className = "seletor-item-info";
      detalhe.textContent = M.descrever(info);

      item.appendChild(titulo);
      item.appendChild(detalhe);
      item.addEventListener("click", function () { escolher(info.id); });
      lista.appendChild(item);
    });
  }

  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    alternar();
  });

  document.addEventListener("click", function (e) {
    if (aberto() && !raiz.contains(e.target)) fechar();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && aberto()) {
      fechar();
      btn.focus();
    }
  });

  M.assinar(render);
})();
