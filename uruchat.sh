cd ~/UruChat || exit 1
mkdir -p dados
rodando() { [ -f dados/pid ] && kill -0 "$(cat dados/pid)" 2>/dev/null; }
case "$1" in
  ligar)
    if rodando; then echo "UruChat já está ligado: http://localhost:5000"; else
      nohup python servidor.py > dados/log.txt 2>&1 &
      echo $! > dados/pid
      sleep 1
      echo "UruChat ligado: http://localhost:5000"
    fi ;;
  desligar)
    if rodando; then kill "$(cat dados/pid)"; rm -f dados/pid; echo "UruChat desligado"; else echo "UruChat não estava ligado"; fi ;;
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
    echo "uso: uruchat ligar | desligar | total | espelhar | git [mensagem]" ;;
esac
