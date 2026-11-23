import os, shutil

RAIZ = os.path.dirname(os.path.abspath(__file__))
DESTINO = "/storage/emulated/0/Download/UruChat"
IGNORAR = {".git", "node_modules", "android", "dados", "__pycache__"}
LIMITE = 5 * 1024 * 1024  # arquivos acima de 5 MB não vão

def origem():
    achados = {}
    for pasta, dirs, nomes in os.walk(RAIZ):
        dirs[:] = [d for d in dirs if d not in IGNORAR]
        for n in nomes:
            p = os.path.join(pasta, n)
            if os.path.getsize(p) <= LIMITE:
                achados[os.path.relpath(p, RAIZ)] = p
    return achados

def espelhar():
    if not os.path.isdir(os.path.dirname(DESTINO)):
        return False
    os.makedirs(DESTINO, exist_ok=True)
    src = origem()
    for rel, p in src.items():
        d = os.path.join(DESTINO, rel)
        os.makedirs(os.path.dirname(d), exist_ok=True)
        if (not os.path.exists(d)
                or os.path.getsize(d) != os.path.getsize(p)
                or os.path.getmtime(d) < os.path.getmtime(p)):
            shutil.copy2(p, d)
    for pasta, dirs, nomes in os.walk(DESTINO, topdown=False):
        for n in nomes:
            d = os.path.join(pasta, n)
            if os.path.relpath(d, DESTINO) not in src:
                os.remove(d)
        for dd in dirs:
            p = os.path.join(pasta, dd)
            if not os.listdir(p):
                os.rmdir(p)
    return True

if __name__ == "__main__":
    print("espelhado em " + DESTINO if espelhar() else "pasta Download não encontrada")
