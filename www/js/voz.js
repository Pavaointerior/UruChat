window.UruVoz = (function () {
  function iniciar(campo, btnMic, barra, onAjustar) {
    var Recon = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recon || !btnMic) return;
    var rec = new Recon();
    rec.lang = "pt-BR";
    rec.interimResults = true;
    var baseFala = "";
    btnMic.addEventListener("click", function () {
      if (btnMic.classList.contains("gravando")) { rec.stop(); return; }
      baseFala = campo.value ? campo.value.trim() + " " : "";
      btnMic.classList.add("gravando");
      if (barra) barra.classList.add("ouvindo");
      try { rec.start(); } catch (e) {}
    });
    rec.addEventListener("result", function (ev) {
      var out = "";
      for (var i = 0; i < ev.results.length; i++) out += ev.results[i][0].transcript;
      campo.value = baseFala + out;
      if (onAjustar) onAjustar();
    });
    rec.addEventListener("end", function () {
      btnMic.classList.remove("gravando");
      if (barra) barra.classList.remove("ouvindo");
    });
  }
  return { iniciar: iniciar };
})();
