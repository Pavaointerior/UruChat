(function () {
  var lista = document.getElementById("mensagens"), campo = document.getElementById("campo");
  var btnEnviar = document.getElementById("btn-enviar"), btnMic = document.getElementById("btn-mic"), barra = document.getElementById("barra-digitar");
  var historico = [], tokens = 0;

  var CURTA_MAX = 3000;
  function ehCurta(papel, texto) {
    var t = String(texto || "").trim();
    return papel !== "user" && t.length > 0 && t.length < CURTA_MAX && t.indexOf("\n") === -1;
  }

  function addRaciocinio(texto) {
    var caixa = document.createElement("details");
    caixa.className = "raciocinio";
    var titulo = document.createElement("summary");
    titulo.textContent = "Raciocínio";
    var corpoR = document.createElement("div");
    corpoR.className = "raciocinio-texto";
    corpoR.textContent = texto || "";
    caixa.appendChild(titulo);
    caixa.appendChild(corpoR);
    lista.appendChild(caixa);
    // Marca rolagem so se o texto passar da altura maxima; tira o fade no fim.
    function medirRolagem() {
      if (corpoR.scrollHeight - corpoR.clientHeight > 4) {
        corpoR.classList.add("tem-overflow");
        corpoR.classList.toggle("no-fim", corpoR.scrollTop + corpoR.clientHeight >= corpoR.scrollHeight - 4);
      } else {
        corpoR.classList.remove("tem-overflow", "no-fim");
      }
    }
    corpoR.addEventListener("scroll", medirRolagem, { passive: true });
    medirRolagem();
    lista.scrollTop = lista.scrollHeight;
    return corpoR;
  }

  function addFala(papel, texto, anexos, curtaForcada) {
    if (papel === "raciocinio") return addRaciocinio(texto);
    var curta = (typeof curtaForcada === "boolean") ? curtaForcada : ehCurta(papel, texto);
    var wrap = document.createElement("div");
    wrap.className = "fala " + (papel === "user" ? "voce" : "agente") + (curta ? " curta" : "");
    var corpo = document.createElement("div");
    corpo.className = "fala-texto";
    corpo.textContent = texto || "";
    // Anexos (imagens/arquivos) aparecem antes do texto, dentro da fala.
    if (window.UruAnexos && anexos && anexos.length) {
      window.UruAnexos.renderizarEm(wrap, anexos);
    }
    wrap.appendChild(corpo);
    // Falas curtas (avisos de progresso) nao ganham botao Copiar.
    if (!curta) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-copiar";
      btn.textContent = "Copiar";
      btn.addEventListener("click", function () {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(corpo.textContent);
        btn.textContent = "Copiado";
        setTimeout(function () { btn.textContent = "Copiar"; }, 1200);
      });
      wrap.appendChild(btn);
    }
    lista.appendChild(wrap); lista.scrollTop = lista.scrollHeight;
    return corpo;
  }

  function carregarSessao(s) {
    if (!retomado) { retomado = true; setTimeout(retomarJob, 50); }
    lista.innerHTML = "";
    if (!s) {
      historico = []; tokens = 0;
      window.UruDireita.limparAcoes();
      window.UruDireita.definir("Nova conversa · " + window.UruSessoes.rotuloModo(window.UruSessoes.getModo()), 0);
      return;
    }
    historico = Array.isArray(s.mensagens) ? s.mensagens.slice() : [];
    tokens = Number(s.tokens || 0) || 0;
    historico.forEach(function (m) {
      if (m.role === "raciocinio") { addRaciocinio(m.content); return; }
      if (m.raciocinio) addRaciocinio(m.raciocinio);
      addFala(m.role, m.content, m.anexos);
    });
    window.UruDireita.limparAcoes();
    window.UruDireita.definir("Modo: " + window.UruSessoes.rotuloModo(window.UruSessoes.getModo()), tokens);
  }

  var DIGITAR_MS = 12;
  function passoDigitacao(len) {
    if (len <= 800) return 1;
    if (len <= 2500) return 2;
    if (len <= 6000) return 4;
    return 8;
  }
  function digitarChars(el, texto) {
    return new Promise(function (resolve) {
      var i = 0, salto = passoDigitacao(texto.length), timer = setInterval(function () {
        if (i < texto.length) {
          i = Math.min(texto.length, i + salto);
          el.textContent = texto.slice(0, i);
          lista.scrollTop = lista.scrollHeight;
        } else { clearInterval(timer); resolve(); }
      }, DIGITAR_MS);
    });
  }

  function ajustar() { campo.style.height = "auto"; campo.style.height = Math.min(campo.scrollHeight, 220) + "px"; }

  var retomado = false, jobAtual = null, acordar = null;
  // Bolhas temporárias usadas enquanto a resposta vai chegando.
  var balaoParcial = null, balaoParcialR = null, parcialUsado = false;

  // O texto parcial chega em blocos de 350ms. Em vez de trocar o conteudo
  // de uma vez (que parece um salto), soltamos poucos caracteres por tique.
  var REVELAR_MS = 32, revelarCheio = "", revelarTimer = null, revelarEspera = null;

  function revelarParar() {
    if (revelarTimer) { clearInterval(revelarTimer); revelarTimer = null; }
    if (revelarEspera) { var r = revelarEspera; revelarEspera = null; r(); }
  }

  function revelarAplicar(txt) {
    if (!balaoParcial) return;
    if (balaoParcial.textContent !== txt) {
      balaoParcial.textContent = txt;
      lista.scrollTop = lista.scrollHeight;
    }
  }

  function revelarPasso() {
    if (!balaoParcial) return revelarParar();
    var mostrado = balaoParcial.textContent || "";
    if (mostrado === revelarCheio) return revelarParar();
    // Se o texto veio diferente (nao e continuacao), aplica direto.
    if (revelarCheio.indexOf(mostrado) !== 0) { revelarAplicar(revelarCheio); return revelarParar(); }
    var atraso = revelarCheio.length - mostrado.length;
    // Ritmo calmo: 1 caractere por tique (~31 cps). Acelera so quando acumula
    // muito texto, para uma resposta longa nao levar minutos para aparecer.
    var passo = 1 + Math.floor(atraso / 60);
    revelarAplicar(revelarCheio.slice(0, mostrado.length + passo));
  }

  function revelarAlvo(txt) {
    revelarCheio = txt || "";
    if (!revelarTimer) revelarTimer = setInterval(revelarPasso, REVELAR_MS);
  }

  // Espera o texto terminar de aparecer antes de trocar a bolha provisoria.
  function revelarDrenar(limiteMs) {
    if (!revelarTimer || !balaoParcial) return Promise.resolve();
    return new Promise(function (res) {
      var pronto = false;
      function fim() { if (!pronto) { pronto = true; res(); } }
      revelarEspera = fim;
      setTimeout(fim, limiteMs || 30000);
    });
  }

  // O item a mostrar e a continuacao do que ja apareceu na bolha provisoria?
  function parcialEhPrefixo(texto) {
    if (!balaoParcial) return false;
    var m = balaoParcial.textContent || "";
    return m.length > 0 && String(texto || "").indexOf(m) === 0;
  }

  function limparParcial() {
    revelarParar();
    revelarCheio = "";
    if (balaoParcial) {
      var w = balaoParcial.parentElement;
      if (w && w.parentNode) w.parentNode.removeChild(w);
      balaoParcial = null;
    }
    if (balaoParcialR) {
      var c = balaoParcialR.closest ? balaoParcialR.closest(".raciocinio") : null;
      if (c && c.parentNode) c.parentNode.removeChild(c);
      balaoParcialR = null;
    }
  }

  function atualizarParcial(raciocinio, texto) {
    if (raciocinio) {
      if (!balaoParcialR) balaoParcialR = addRaciocinio("");
      if (balaoParcialR.textContent !== raciocinio) {
        balaoParcialR.textContent = raciocinio;
        var caixa = balaoParcialR.closest ? balaoParcialR.closest(".raciocinio") : null;
        if (caixa) caixa.open = true;
      }
      parcialUsado = true;
    }
    if (texto) {
      if (!balaoParcial) {
        balaoParcial = addFala("assistant", "", null, true);
        // Bolha provisória: some no fim, então não herda o estilo de fala curta.
        var caixaP = balaoParcial.parentElement;
        if (caixaP) caixaP.classList.remove("curta");
      }
      if (revelarCheio !== texto) revelarAlvo(texto);
      parcialUsado = true;
    }
    if (parcialUsado) lista.scrollTop = lista.scrollHeight;
  }

  function guardarJob(jid, sid) {
    try { localStorage.setItem("uruchat_job", JSON.stringify({ id: jid, sessao: sid })); } catch (e) {}
  }
  function limparJob() {
    try { localStorage.removeItem("uruchat_job"); } catch (e) {}
  }

  async function mostrar(item, sid) {
    if (window.UruSessoes.getAtualId() !== sid) return;
    var texto = item.content || "";
    if (item.role === "raciocinio") {
      var r = addRaciocinio(texto);
      // se veio tambem como campo opcional do item
      return r;
    }
    var papel = item.role === "user" ? "user" : "assistant";
    // Cria a fala ja sabendo se e curta: fonte menor desde o primeiro caractere.
    var alvo = addFala(papel, "", null, ehCurta(papel, texto));
    alvo.textContent = "";
    historico.push({ role: item.role, content: texto });
    if (papel === "user" || !texto || parcialUsado) { alvo.textContent = texto; lista.scrollTop = lista.scrollHeight; }
    else await digitarChars(alvo, texto);
  }

  async function esperarJob(jid, vistos, sid) {
    var vistasAc = 0, falhas = 0, espera = 1500;
    parcialUsado = false;
    while (true) {
      try {
        var r = await fetch("/api/job?id=" + encodeURIComponent(jid) + "&_=" + Date.now(), { cache: "no-store" });
        if (r.status === 404) { limparJob(); jobAtual = null; return { sumiu: true }; }
        var j = await r.json();
        falhas = 0;
        if (vistos === null) vistos = Math.max(0, historico.length - (Number(j.base) || 0));
        var ac = j.acoes || [];
        for (; vistasAc < ac.length; vistasAc++) window.UruDireita.registrarAcao(ac[vistasAc]);
        espera = j.stream ? 350 : 1500;
        atualizarParcial(j.parcial_r || "", j.parcial || "");
        var tx = j.transcricao || [];
        for (; vistos < tx.length; vistos++) {
          // Deixa o que ja chegou terminar de aparecer antes de trocar a bolha.
          // O texto final costuma ser maior que o ultimo parcial: alimenta o
          // revelador com ele para o fim nao aparecer de uma vez so.
          if (parcialEhPrefixo(tx[vistos].content)) {
            revelarAlvo(tx[vistos].content);
            await revelarDrenar();
          }
          limparParcial();
          await mostrar(tx[vistos], sid);
        }
        if (j.estado === "concluido" || j.estado === "erro") {
          limparParcial();
          limparJob(); jobAtual = null;
          return { total: (Number(j.tokens_base) || 0) + (Number(j.tokens) || 0) };
        }
        window.UruDireita.definir(j.estado === "reiniciando" ? "Reiniciando o servidor..." : "Executando...");
      } catch (e) {
        falhas++;
        window.UruDireita.definir("Aguardando o servidor voltar...");
        if (falhas > 160) { jobAtual = null; return { erro: true }; }
      }
      await new Promise(function (res) { acordar = res; setTimeout(res, espera); });
    }
  }

  async function injetar(txt) {
    for (var t = 0; t < 12; t++) {
      try {
        var r = await fetch("/api/job/mensagem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: jobAtual.id, mensagem: txt }) });
        var d = await r.json();
        if (d.ok) { if (acordar) acordar(); return true; }
        return false;
      } catch (e) {
        await new Promise(function (res) { setTimeout(res, 1500); });
      }
    }
    return false;
  }

  async function fecharTarefa(sid, modo, rj) {
    if (rj && rj.total) tokens = rj.total;
    if (window.UruSessoes.getAtualId() !== sid) return;
    var s = window.UruSessoes.getSessao(sid);
    await window.UruSessoes.salvar({ id: sid, modo: modo, titulo: s ? s.titulo : "Nova conversa", manual: Boolean(s && s.manual), atualizado: Date.now(), mensagens: historico.slice(), tokens: tokens });
    window.UruDireita.definir("Concluído · " + window.UruSessoes.rotuloModo(modo), tokens);
  }

  async function retomarJob() {
    var salvo = null;
    try { salvo = JSON.parse(localStorage.getItem("uruchat_job") || "null"); } catch (e) {}
    if (!salvo || !salvo.id) return;
    var sid = window.UruSessoes.getAtualId();
    if (sid !== salvo.sessao) { limparJob(); return; }
    var modo = window.UruSessoes.getModo();
    parcialUsado = false;
    jobAtual = { id: salvo.id, sessao: sid };
    window.UruDireita.definir("Retomando tarefa · " + window.UruSessoes.rotuloModo(modo), tokens);
    var rj = await esperarJob(salvo.id, null, sid);
    await fecharTarefa(sid, modo, rj);
  }

  async function enviar() {
    var txt = campo.value.trim();
    var anexos = (window.UruAnexos ? window.UruAnexos.getPendentes() : []);
    if (!txt && !anexos.length) return;
    if (jobAtual) {
      if (!txt) return;
      campo.value = ""; ajustar();
      if (await injetar(txt)) return;
      campo.value = txt; ajustar();
    }

    campo.value = ""; ajustar();
    var id = window.UruSessoes.getAtualId() || ("s_" + Date.now());
    window.UruSessoes.setAtualId(id);
    var modo = window.UruSessoes.getModo(), anterior = window.UruSessoes.getSessao(id);

    // Texto que representa o usuário no histórico (com marca de anexo).
    var textoHist = txt;
    if (anexos.length) {
      var nomes = anexos.map(function (a) { return a.nome; }).join(", ");
      textoHist = (txt ? txt + "\n" : "") + "📎 Anexo: " + nomes;
    }

    addFala("user", txt, anexos);
    var msgObj = { role: "user", content: textoHist, anexos: anexos.map(function (a) { return { nome: a.nome, tipo: a.tipo, dataUrl: a.dataUrl }; }) };
    historico.push(msgObj);
    if (window.UruAnexos) window.UruAnexos.limpar();

    var tit = (anterior && anterior.manual) ? anterior.titulo : window.UruSessoes.tituloAuto(historico);
    await window.UruSessoes.salvar({ id: id, modo: modo, titulo: tit, manual: Boolean(anterior && anterior.manual), atualizado: Date.now(), mensagens: historico.slice(), tokens: tokens });
    window.UruDireita.limparAcoes();
    window.UruDireita.definir("Executando · " + window.UruSessoes.rotuloModo(modo), tokens);
    try {
      var paraApi = historico.slice(-40).map(function (m) {
        return { role: m.role, content: m.content };
      });
      var ultimaComAnexo = anexos.length ? { imagens: anexos.filter(function (a) { return a.tipo.indexOf("image/") === 0; }).map(function (a) { return { tipo: a.tipo, dataUrl: a.dataUrl }; }) } : null;
      var r;
      try {
        r = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mensagens: paraApi, modo: modo, anexos: ultimaComAnexo, sessao: id, modelo: (window.UruModelos ? window.UruModelos.getAtual() : "") })
        });
      } catch (rede) {
        if (window.UruReconectar) window.UruReconectar.falhou();
        throw rede;
      }
      var dj = await r.json(), rj = null;
      if (dj.job) {
        parcialUsado = false;
        guardarJob(dj.job, id);
        jobAtual = { id: dj.job, sessao: id };
        rj = await esperarJob(dj.job, 0, id);
      } else {
        var erroMsg = dj.erro || "Erro ao iniciar a tarefa.";
        addFala("assistant", erroMsg);
        historico.push({ role: "assistant", content: erroMsg });
      }
      await fecharTarefa(id, modo, rj);
    } catch (e) {
      jobAtual = null;
      addFala("assistant", "Erro: " + e.message);
    }
  }

  campo.addEventListener("input", ajustar);
  campo.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } });
  btnEnviar.addEventListener("click", enviar);
  if (window.UruVoz) window.UruVoz.iniciar(campo, btnMic, barra, ajustar);
  window.UruCentro = { carregarSessao: carregarSessao, getTokens: function () { return tokens; } };
})();
