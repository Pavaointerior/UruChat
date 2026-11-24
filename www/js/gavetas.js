(function () {
  var esq = document.getElementById("painel-esq"), dir = document.getElementById("painel-dir");
  var btnEsq = document.getElementById("btn-rec-esq"), btnDir = document.getElementById("btn-rec-dir");
  if (btnEsq && esq) btnEsq.addEventListener("click", function () { esq.classList.toggle("recolhida"); });
  if (btnDir && dir) btnDir.addEventListener("click", function () { dir.classList.toggle("recolhida"); });
})();
