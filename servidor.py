import os, threading, time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import gerar_total, espelhar

RAIZ = os.path.dirname(os.path.abspath(__file__))
WWW = os.path.join(RAIZ, "www")
PORTA = 5000

class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=WWW, **k)
    def do_GET(self):
        if self.path == "/api/ping":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
            return
        super().do_GET()
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def log_message(self, *a):
        pass

def vigiar():
    ultima = None
    while True:
        try:
            a = gerar_total.assinatura()
            if a != ultima:
                gerar_total.gerar()
                espelhar.espelhar()
                ultima = a
        except Exception:
            pass
        time.sleep(2)

threading.Thread(target=vigiar, daemon=True).start()
ThreadingHTTPServer(("127.0.0.1", PORTA), H).serve_forever()
