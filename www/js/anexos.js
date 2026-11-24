// Módulo de anexos do UruChat.
// Expõe window.UruAnexos com:
//   getPendentes() -> array de anexos { nome, tipo, dataUrl }
//   limpar()       -> esvazia a fila de anexos
//   montarConteudo(texto, anexos) -> monta content multimodal p/ API
//   renderizarEm(falaEl, anexos)  -> insere previews de imagem/arquivo na fala
window.UruAnexos = (function () {
  var MAX_BYTES = 8 * 1024 * 1024; // 8 MB por arquivo
  var pendentes = [];
  var btn, input, preview;

  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }

  function lerArquivo(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error("Falha ao ler " + file.name)); };
      fr.readAsDataURL(file);
    });
  }

  async function adicionar(file) {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      alert("Arquivo grande demais (máx. 8 MB): " + file.name);
      return;
    }
    try {
      var dataUrl = await lerArquivo(file);
      pendentes.push({ nome: file.name, tipo: file.type || "application/octet-stream", dataUrl: dataUrl });
      renderPreview();
    } catch (e) {
      alert(e.message);
    }
  }

  function renderPreview() {
    if (!preview) return;
    preview.innerHTML = "";
    if (!pendentes.length) { preview.hidden = true; return; }
    preview.hidden = false;
    pendentes.forEach(function (a, idx) {
      var item = el("div", "anexo-item");
      if (a.tipo.indexOf("image/") === 0) {
        var img = el("img");
        img.src = a.dataUrl;
        img.alt = a.nome;
        item.appendChild(img);
      } else {
        item.appendChild(el("span", "anexo-icone", "📄"));
      }
      item.appendChild(el("span", "anexo-nome", a.nome));
      var rm = el("button", "anexo-remover", "✕");
      rm.type = "button";
      rm.title = "Remover anexo";
      rm.addEventListener("click", function () {
        pendentes.splice(idx, 1);
        renderPreview();
      });
      item.appendChild(rm);
      preview.appendChild(item);
    });
  }

  function getPendentes() { return pendentes.slice(); }

  function limpar() { pendentes = []; renderPreview(); }

  // Monta o "content" no formato multimodal (texto + imagens em base64).
  // Retorna { texto, imagens: [dataUrl,...] } para o centro.js decidir o envio.
  function coletar(anexos) {
    var texto = arguments[1] || "";
    var imagens = [], arquivos = [];
    (anexos || []).forEach(function (a) {
      if (a.tipo.indexOf("image/") === 0) imagens.push({ nome: a.nome, dataUrl: a.dataUrl });
      else arquivos.push({ nome: a.nome, tipo: a.tipo });
    });
    return { texto: texto, imagens: imagens, arquivos: arquivos };
  }

  // Desenha os anexos dentro de um elemento de fala (.fala).
  function renderizarEm(falaEl, anexos) {
    if (!falaEl || !anexos || !anexos.length) return;
    anexos.forEach(function (a) {
      if (a.tipo && a.tipo.indexOf("image/") === 0 && a.dataUrl) {
        var img = el("img", "fala-imagem");
        img.src = a.dataUrl;
        img.alt = a.nome || "imagem";
        falaEl.appendChild(img);
      } else if (a.nome) {
        var chip = el("span", "fala-arquivo", "📄 " + a.nome);
        falaEl.appendChild(chip);
      }
    });
  }

  function iniciar() {
    btn = document.getElementById("btn-anexar");
    input = document.getElementById("inp-anexo");
    preview = document.getElementById("preview-anexo");
    if (!btn || !input) return;

    btn.addEventListener("click", function () { input.click(); });

    input.addEventListener("change", function () {
      var arquivos = Array.prototype.slice.call(input.files || []);
      input.value = "";
      (async function () {
        for (var i = 0; i < arquivos.length; i++) await adicionar(arquivos[i]);
      })();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }

  return {
    getPendentes: getPendentes,
    limpar: limpar,
    coletar: coletar,
    renderizarEm: renderizarEm,
    renderPreview: renderPreview
  };
})();
