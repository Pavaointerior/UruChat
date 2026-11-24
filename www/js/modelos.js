// modelos: fonte única da verdade sobre os modelos da API.
// Expõe window.UruModelos; consumido por seletor_modelos.js, centro.js e modal.js.
window.UruModelos = (function () {
  var estado = { lista: [], atual: "", origem: "local", carregado: false };
  var inscritos = [];

  function notificar() {
    inscritos.forEach(function (fn) {
      try { fn(estado); } catch (e) {}
    });
  }

  function assinar(fn) {
    if (typeof fn === "function") inscritos.push(fn);
    if (estado.carregado) fn(estado);
  }

  function getLista() { return estado.lista.slice(); }
  function getAtual() { return estado.atual; }

  function getInfo(id) {
    var alvo = id || estado.atual;
    for (var i = 0; i < estado.lista.length; i++) {
      if (estado.lista[i].id === alvo) return estado.lista[i];
    }
    return null;
  }

  // Nome curto para a barra: "DeepSeek-V4.1-Flash" -> "V4.1-Flash".
  function apelido(id) {
    var info = getInfo(id);
    var nome = info ? info.nome : String(id || "");
    return nome.replace(/^DeepSeek-?/i, "") || nome;
  }

  function suportaVisao(id) {
    var info = getInfo(id);
    return Boolean(info && info.visao);
  }

  function descrever(info) {
    var partes = [];
    if (info.visao) partes.push("lê imagens");
    if (info.contexto) partes.push("contexto de " + Math.round(info.contexto / 1024) + "k");
    return partes.join(" · ");
  }

  async function carregar() {
    try {
      var d = await (await fetch("/api/modelos")).json();
      if (Array.isArray(d.modelos)) estado.lista = d.modelos;
      if (d.atual) estado.atual = d.atual;
      estado.origem = d.origem || "local";
      estado.carregado = true;
    } catch (e) {
      estado.carregado = true;
    }
    notificar();
    return estado;
  }

  async function definir(id) {
    if (!id || id === estado.atual) return true;
    try {
      var r = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelo: id })
      });
      var d = await r.json();
      if (!r.ok) return false;
      estado.atual = d.modelo || id;
      notificar();
      return true;
    } catch (e) {
      return false;
    }
  }

  carregar();

  return {
    assinar: assinar,
    carregar: carregar,
    definir: definir,
    getLista: getLista,
    getAtual: getAtual,
    getInfo: getInfo,
    apelido: apelido,
    descrever: descrever,
    suportaVisao: suportaVisao
  };
})();
