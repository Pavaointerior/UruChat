cd ~/UruChat || exit 1
mkdir -p dados
rodando() { [ -f dados/pid ] && kill -0 "$(cat dados/pid)" 2>/dev/null; }

# Espera o servidor responder HTTP. $1 = segundos máximos.
esperar_subir() {
  local max="${1:-15}" i=0
  while [ "$i" -lt "$max" ]; do
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/api/ping 2>/dev/null | grep -q 200; then
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  return 1
}

# Sobe o servidor em background e grava o PID.
subir() {
  nohup python servidor.py > dados/log.txt 2>&1 &
  echo $! > dados/pid
  if esperar_subir 15; then
    echo "UruChat ligado: http://localhost:5000"
    return 0
  else
    echo "UruChat iniciou, mas ainda não respondeu. Veja dados/log.txt"
    return 1
  fi
}

# Derruba o servidor e espera o processo realmente terminar.
derrubar() {
  if rodando; then
    local pid; pid="$(cat dados/pid)"
    kill "$pid" 2>/dev/null
    # Espera até ~10s o processo morrer.
    local i=0
    while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 20 ]; do sleep 0.5; i=$((i + 1)); done
    # Se ainda estiver vivo, força.
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
    rm -f dados/pid
    return 0
  fi
  rm -f dados/pid
  return 1
}

# Reinicia de forma DESACOPLADA: dispara stop->start numa sessão/serviço
# separado (setsid + nohup), de modo que o 'kill' do servidor NÃO atinja
# o shell/processo que chamou este comando. Retorna imediatamente; o
# restart continua sozinho e grava o progresso em dados/restart.log.
# Útil quando o shell que chama é filho do servidor.py (senão ele morre junto).
reiniciar_detached() {
  rm -f dados/restart.done
  # 'sleep 1' garante que o próprio disparo termine e se desprenda antes do kill.
  setsid nohup bash -c '
    sleep 1
    echo "[detached] $(date) iniciando restart" >> dados/restart.log
    if [ -f dados/pid ]; then
      p=$(cat dados/pid); kill "$p" 2>/dev/null
      i=0; while kill -0 "$p" 2>/dev/null && [ "$i" -lt 20 ]; do sleep 0.5; i=$((i+1)); done
      kill -0 "$p" 2>/dev/null && kill -9 "$p" 2>/dev/null
      rm -f dados/pid
      echo "[detached] servidor parado" >> dados/restart.log
    fi
    nohup python servidor.py > dados/log.txt 2>&1 &
    echo $! > dados/pid
    ok=0
    i=0; while [ "$i" -lt 20 ]; do
      if curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/api/ping 2>/dev/null | grep -q 200; then ok=1; break; fi
      sleep 1; i=$((i+1))
    done
    if [ "$ok" = "1" ]; then echo "[detached] $(date) OK: servidor respondeu 200" >> dados/restart.log
    else echo "[detached] $(date) FALHOU: servidor não respondeu" >> dados/restart.log; fi
    echo "$ok" > dados/restart.done
  ' > /dev/null 2>&1 < /dev/null &
  disown 2>/dev/null
  echo "Restart desacoplado disparado. O servidor vai reiniciar sozinho em ~2s."
  echo "Acompanhe em dados/restart.log (ou a página se recarrega sozinha)."
}

case "$1" in
  ligar)
    if rodando; then echo "UruChat já está ligado: http://localhost:5000"; else subir; fi ;;
  desligar)
    if derrubar; then echo "UruChat desligado"; else echo "UruChat não estava ligado"; fi ;;
  reiniciar)
    echo "Reiniciando UruChat..."
    if derrubar; then echo "Servidor parado."; else echo "Não estava ligado; iniciando."; fi
    sleep 1
    subir ;;
  reiniciar-detached|detached)
    reiniciar_detached ;;
  status)
    if rodando && curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/api/ping 2>/dev/null | grep -q 200; then
      echo "UruChat LIGADO (PID $(cat dados/pid)): http://localhost:5000"
    else
      echo "UruChat DESLIGADO ou sem resposta."
    fi
    if [ -f dados/restart.done ]; then echo "último restart detached: $(cat dados/restart.done) (1=ok, 0=falhou)"; fi ;;
  total)
    python gerar_total.py ;;
  git)
    shift
    [ -d .git ] || { git init -q -b main; }
    git remote get-url origin >/dev/null 2>&1 || git remote add origin https://github.com/Pavaointerior/UruChat.git
    python gerar_total.py
    git add -A
    git commit -q -m "${*:-atualização}"
    git push -u origin main ;;
  espelhar)
    python gerar_total.py; python espelhar.py ;;
  *)
    echo "uso: uruchat ligar | desligar | reiniciar | reiniciar-detached | status | total | espelhar | git [mensagem]" ;;
esac
