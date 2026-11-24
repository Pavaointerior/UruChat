(function () {
  var raiz = document.documentElement;
  var modal = document.getElementById("modal-cfg");
  var btnTema = document.getElementById("btn-tema");
  var inUrl = document.getElementById("cfg-url");
  var selMod = document.getElementById("cfg-modelo");
  var inChv = document.getElementById("cfg-chave");
  var stApi = document.getElementById("cfg-status");
  var selPens = document.getElementById("cfg-pensamento");
  var selEsf = document.getElementById("cfg-esforco");
  var selMax = document.getElementById("cfg-max-tokens");
  var selStream = document.getElementById("cfg-stream");
  var rngFonte = document.getElementById("rng-fonte");
  var rngEspaco = document.getElementById("rng-espaco");
  var lblFonte = document.getElementById("lbl-fonte");
  var lblEspaco = document.getElementById("lbl-espaco");
  var btnSalvarApi = document.getElementById("salvar-api");

  var pref = { modo: window.UruModos.PADRAO, tema: "escuro", fonte_px: 15, espaco_em: 2.8 };
  var apiCarregada = false;

  function aplicarTela() {
    raiz.dataset.tema = pref.tema;
    raiz.style.setProperty("--fonte-px", pref.fonte_px + "px");
    raiz.style.setProperty("--espaco-em", pref.espaco_em + "em");
    if (btnTema) btnTema.textContent = pref.tema === "escuro" ? "☀️" : "🌙";
    if (rngFonte) rngFonte.value = String(pref.fonte_px);
    if (rngEspaco) rngEspaco.value = String(pref.espaco_em);
    if (lblFonte) lblFonte.textContent = pref.fonte_px + "px";
    if (lblEspaco) lblEspaco.textContent = pref.espaco_em + "em";
  }

  async function salvarPref() {
    aplicarTela();
    try {
      await fetch("/api/preferencias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pref)
      });
    } catch (e) {}
  }

  function trocarAba(nome) {
    document.querySelectorAll(".aba-btn").forEach(function (b) {
      b.classList.toggle("ativa", b.dataset.aba === nome);
    });
    ["modos", "api", "tela"].forEach(function (k) {
      var p = document.getElementById("painel-" + k);
      if (p) p.hidden = (k !== nome);
    });
  }

  // O select de modelos é montado a partir do catálogo (fonte única: UruModelos).
  function preencherModelos(atual) {
    if (!selMod || !window.UruModelos) return;
    var lista = window.UruModelos.getLista();
    selMod.innerHTML = "";
    if (!lista.length) {
      var so = document.createElement("option");
      so.value = atual || "";
      so.textContent = atual || "Nenhum modelo disponível";
      selMod.appendChild(so);
      return;
    }
    lista.forEach(function (info) {
      var op = document.createElement("option");
      op.value = info.id;
      var extra = window.UruModelos.descrever(info);
      op.textContent = window.UruModelos.apelido(info.id) + (extra ? " — " + extra : "");
      selMod.appendChild(op);
    });
    var alvo = atual || window.UruModelos.getAtual();
    if (alvo) selMod.value = alvo;
    if (!selMod.value && selMod.options.length) selMod.selectedIndex = 0;
  }

  // Esforço só faz sentido com raciocínio ligado.
  function ajustarEsforco() {
    if (!selPens || !selEsf) return;
    var ligado = selPens.value === "1";
    selEsf.disabled = !ligado;
    selEsf.parentElement && selEsf.parentElement.classList.toggle("desativado", !ligado);
  }

  async function abrirModal() {
    if (!modal) return;
    modal.hidden = false;
    trocarAba("modos");
    try {
      var d = await (await fetch("/api/config")).json();
      if (inUrl && !apiCarregada) inUrl.value = d.url || "https://api.deepseek.com/v1";
      if (inChv) inChv.value = "";
      if (stApi) stApi.textContent = d.tem_chave ? "(chave salva)" : "(sem chave)";
      if (selPens) selPens.value = d.pensamento ? "1" : "0";
      if (selEsf && d.esforco) selEsf.value = d.esforco;
      if (selMax) selMax.value = String(Number(d.max_tokens) || 0);
      if (selStream) selStream.value = d.stream === false ? "0" : "1";
      ajustarEsforco();
      var modelo = d.modelo || "";
      preencherModelos(modelo);
      // Se o catálogo ainda não chegou, recarrega e repinta quando chegar.
      if (!window.UruModelos || !window.UruModelos.getLista().length) {
        if (window.UruModelos) await window.UruModelos.carregar();
        preencherModelos(modelo);
      }
      apiCarregada = true;
    } catch (e) {}
  }

  if (btnTema) {
    btnTema.addEventListener("click", function () {
      pref.tema = pref.tema === "escuro" ? "claro" : "escuro";
      salvarPref();
    });
  }

  ["btn-ajustes-topo", "btn-cfg-esq"].forEach(function (id) {
    var b = document.getElementById(id);
    if (b) b.addEventListener("click", abrirModal);
  });

  var fechar = document.getElementById("fechar-modal");
  if (fechar) fechar.addEventListener("click", function () { modal.hidden = true; });
  if (modal) modal.addEventListener("click", function (e) { if (e.target === modal) modal.hidden = true; });

  document.querySelectorAll(".aba-btn").forEach(function (b) {
    b.addEventListener("click", function () { trocarAba(b.dataset.aba); });
  });

  document.querySelectorAll(".modo-card").forEach(function (card) {
    card.addEventListener("click", function () {
      document.querySelectorAll(".modo-card").forEach(function (c) { c.classList.remove("ativa"); });
      card.classList.add("ativa");
      pref.modo = window.UruModos.normalizar(card.dataset.modo);
      window.UruSessoes.definirModo(pref.modo);
      salvarPref();
    });
  });

  if (selPens) selPens.addEventListener("change", ajustarEsforco);

  if (btnSalvarApi) {
    btnSalvarApi.addEventListener("click", async function () {
      if (stApi) stApi.textContent = "(salvando...)";
      var corpo = {
        url: inUrl ? inUrl.value.trim() : "",
        modelo: selMod ? selMod.value : "",
        pensamento: selPens ? selPens.value === "1" : true,
        esforco: selEsf ? selEsf.value : "high",
        max_tokens: selMax ? Number(selMax.value) : 8192,
        stream: selStream ? selStream.value === "1" : true
      };
      if (inChv && inChv.value.trim()) corpo.chave = inChv.value.trim();
      try {
        var r = await fetch("/api/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corpo)
        });
        if (r.ok) {
          var d = await r.json();
          // Repassa a escolha para o estado global, que atualiza a barra de digitação.
          if (window.UruModelos && d.modelo && d.modelo !== window.UruModelos.getAtual()) {
            await window.UruModelos.carregar();
            if (window.UruDireita) {
              window.UruDireita.definir("Modelo: " + window.UruModelos.apelido(d.modelo), window.UruCentro ? window.UruCentro.getTokens() : undefined);
            }
          }
          modal.hidden = true;
        } else if (stApi) {
          var erro = "";
          try { erro = (await r.json()).erro || ""; } catch (e) {}
          stApi.textContent = erro ? "(" + erro + ")" : "(erro)";
        }
      } catch (e) {
        if (stApi) stApi.textContent = "(falha)";
      }
    });
  }

  if (rngFonte) rngFonte.addEventListener("input", function () { pref.fonte_px = Number(rngFonte.value); salvarPref(); });
  if (rngEspaco) rngEspaco.addEventListener("input", function () { pref.espaco_em = Number(rngEspaco.value); salvarPref(); });

  var btnReset = document.getElementById("reset-tela");
  if (btnReset) btnReset.addEventListener("click", function () { pref.fonte_px = 15; pref.espaco_em = 2.8; salvarPref(); });

  var btnConcluir = document.getElementById("concluir-tela");
  if (btnConcluir) btnConcluir.addEventListener("click", function () { modal.hidden = true; });

  (async function init() {
    try {
      var p = await (await fetch("/api/preferencias")).json();
      pref = Object.assign(pref, p || {});
      pref.modo = window.UruModos.normalizar(pref.modo);
    } catch (e) {}
    aplicarTela();
    window.UruSessoes.carregar(pref.modo, {
      onAbrir: function (s) { window.UruCentro.carregarSessao(s); },
      onModoMudou: function (m) {
        pref.modo = m;
        salvarPref();
        window.UruDireita.definir("Modo: " + window.UruSessoes.rotuloModo(m), window.UruCentro.getTokens());
      }
    });
  })();
})();
