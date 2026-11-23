import os
RAIZ = os.path.dirname(os.path.abspath(__file__))
IGNORAR = {".git", "node_modules", "android", "dados", "__pycache__"}
SAIDA = "CODIGO_TOTAL.txt"

def arquivos():
    lista = []
    for pasta, dirs, nomes in os.walk(RAIZ):
        dirs[:] = sorted(d for d in dirs if d not in IGNORAR)
        for n in sorted(nomes):
            if n == SAIDA:
                continue
            lista.append(os.path.relpath(os.path.join(pasta, n), RAIZ))
    return lista

def assinatura():
    return [(f, os.path.getmtime(os.path.join(RAIZ, f))) for f in arquivos()]

def gerar():
    fs = arquivos()
    partes = ["# UruChat - código total\n\n## Árvore\n"]
    partes += ["- " + f + "\n" for f in fs]
    for f in fs:
        try:
            with open(os.path.join(RAIZ, f), encoding="utf-8") as a:
                c = a.read()
        except Exception:
            continue
        partes.append("\n\n===== " + f + " =====\n" + c)
    novo = "".join(partes)
    caminho = os.path.join(RAIZ, SAIDA)
    antigo = ""
    if os.path.exists(caminho):
        with open(caminho, encoding="utf-8") as a:
            antigo = a.read()
    if novo != antigo:
        with open(caminho, "w", encoding="utf-8") as a:
            a.write(novo)
        return True
    return False

if __name__ == "__main__":
    print("código total atualizado" if gerar() else "sem mudanças")
