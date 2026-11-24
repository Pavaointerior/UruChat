window.UruSessoes = (function () {
  var M = window.UruModos;
  var listaEl = document.getElementById("lista-sessoes");
  var btnNova = document.getElementById("btn-nova");
  var seloModo = document.getElementById("selo-modo");

  var estado = {
    sessoes: [],
    atualId: null,
    editandoId: null,
    modo: "total",
    onAbrir: null,
    onModoMudou: null
  };

  function tituloAuto(msgs) {
    for (var i = 0; i < msgs.length; i++) {
      if (msgs[i].role === "user" && msgs[i].content) {
        var limpo = msgs[i].content.replace(/\s+/g, " ").trim();
        return limpo.length > 34 ? limpo.slice(0, 34) + "…" : limpo;
      }
    }
    return "Nova conversa";
  }

  function atualizarSelo() {
    M.atualizarSelo(estado.modo, seloModo);
    M.marcarCards(estado.modo);
  }

  async function salvar(obj) {
    obj.modo = M.normalizar(obj.modo);
    estado.sessoes = [obj].concat(estado.sessoes.filter(function (s) { return s.id !== obj.id; }));
    render();
    try {
      await fetch("/api/sessoes/salvar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(obj)
      });
    } catch (e) {}
  }

  async function renomear(id, novoTit) {
    estado.editandoId = null;
    var limpo = String(novoTit || "").trim();
    if (!limpo) return render();
    estado.sessoes.forEach(function (s) {
      if (s.id === id) { s.titulo = limpo; s.manual = true; }
    });
    render();
    try {
      await fetch("/api/sessoes/renomear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: id, titulo: limpo })
      });
    } catch (e) {}
  }

  async function apagar(id) {
    estado.sessoes = estado.sessoes.filter(function (s) { return s.id !== id; });
    if (estado.atualId === id) {
      nova();
    } else {
      render();
    }
    try {
      await fetch("/api/sessoes/apagar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: id })
      });
    } catch (e) {}
  }

  function abrir(id) {
    var s = estado.sessoes.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    estado.atualId = s.id;
    estado.modo = M.normalizar(s.modo);
    atualizarSelo();
    render();
    if (estado.onAbrir) estado.onAbrir(s);
  }

  function nova() {
    estado.atualId = null;
    estado.editandoId = null;
    render();
    if (estado.onAbrir) estado.onAbrir(null);
  }

  function definirModo(novoModo) {
    estado.modo = M.normalizar(novoModo);
    atualizarSelo();
    if (estado.atualId) {
      var s = estado.sessoes.filter(function (x) { return x.id === estado.atualId; })[0];
      if (s) {
        s.modo = estado.modo;
        s.atualizado = Date.now();
        salvar(s);
      }
    }
    if (estado.onModoMudou) estado.onModoMudou(estado.modo);
  }

  function render() {
    if (!listaEl) return;
    listaEl.innerHTML = "";
    if (!estado.sessoes.length) {
      var p = document.createElement("p");
      p.className = "info-linha";
      p.textContent = "Nenhuma conversa ainda.";
      listaEl.appendChild(p);
      return;
    }
    estado.sessoes.forEach(function (s) {
      var row = document.createElement("div");
      row.className = "sessao-item" + (s.id === estado.atualId ? " ativa" : "");

      if (estado.editandoId === s.id) {
        var inp = document.createElement("input");
        inp.type = "text";
        inp.className = "sessao-input";
        inp.value = s.titulo || "";
        inp.addEventListener("keydown", function (e) {
          if (e.key === "Enter") renomear(s.id, inp.value);
          if (e.key === "Escape") { estado.editandoId = null; render(); }
        });
        var ok = document.createElement("button");
        ok.type = "button";
        ok.className = "sessao-btn";
        ok.textContent = "✓";
        ok.onclick = function () { renomear(s.id, inp.value); };
        row.appendChild(inp);
        row.appendChild(ok);
        listaEl.appendChild(row);
        setTimeout(function () { inp.focus(); }, 10);
        return;
      }

      var ab = document.createElement("button");
      ab.type = "button";
      ab.className = "sessao-abrir";
      ab.onclick = function () { abrir(s.id); };

      var tit = document.createElement("span");
      tit.className = "sessao-tit";
      tit.textContent = s.titulo || "Conversa";

      var mod = document.createElement("span");
      mod.className = "sessao-modo";
      mod.textContent = M.rotulo(s.modo);

      ab.appendChild(tit);
      ab.appendChild(mod);

      var ed = document.createElement("button");
      ed.type = "button";
      ed.className = "sessao-btn";
      ed.textContent = "✎";
      ed.title = "Editar nome";
      ed.onclick = function (e) { e.stopPropagation(); estado.editandoId = s.id; render(); };

      var dl = document.createElement("button");
      dl.type = "button";
      dl.className = "sessao-btn";
      dl.textContent = "✕";
      dl.title = "Apagar";
      dl.onclick = function (e) { e.stopPropagation(); apagar(s.id); };

      row.appendChild(ab);
      row.appendChild(ed);
      row.appendChild(dl);
      listaEl.appendChild(row);
    });
  }

  async function carregar(modoInicial, hooks) {
    estado.onAbrir = hooks.onAbrir;
    estado.onModoMudou = hooks.onModoMudou;
    estado.modo = M.normalizar(modoInicial);
    atualizarSelo();
    try {
      var d = await (await fetch("/api/sessoes")).json();
      if (Array.isArray(d.sessoes)) estado.sessoes = d.sessoes;
    } catch (e) {}
    if (estado.sessoes.length) {
      abrir(estado.sessoes[0].id);
    } else {
      nova();
    }
  }

  if (btnNova) btnNova.addEventListener("click", nova);

  return {
    carregar: carregar,
    salvar: salvar,
    definirModo: definirModo,
    tituloAuto: tituloAuto,
    rotuloModo: function (m) { return M.rotulo(m); },
    getAtualId: function () { return estado.atualId; },
    setAtualId: function (id) { estado.atualId = id; },
    getModo: function () { return estado.modo; },
    getSessao: function (id) { return estado.sessoes.filter(function (s) { return s.id === id; })[0] || null; }
  };
})();
