"""UruChat - servidor local.

Organização do arquivo, de cima para baixo:
  1. Caminhos e constantes
  2. Utilidades de arquivo (JSON, backup, sessões)
  3. Catálogo de modelos da API
  4. Ferramentas do agente (árvore, arquivos, comandos, web)
  5. Conversa com a API (montagem do corpo, erros, repetição)
  6. Tarefas em segundo plano (jobs)
  7. Servidor HTTP
  8. Inicialização
"""

import os, re, html, threading, time, json, shutil, subprocess, urllib.request, urllib.parse, urllib.error
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

# ---------------------------------------------------------------------------
# 1. Caminhos e constantes
# ---------------------------------------------------------------------------

RAIZ = os.path.dirname(os.path.abspath(__file__))
HOME = os.path.expanduser("~")
WWW = os.path.join(RAIZ, "www")
DADOS = os.path.join(RAIZ, "dados")
CFG_PATH = os.path.join(DADOS, "config.json")
SESSOES_PATH = os.path.join(DADOS, "sessoes.json")
PREF_PATH = os.path.join(DADOS, "preferencias.json")
JOBS_DIR = os.path.join(DADOS, "jobs")
BK_DIR = os.path.join(DADOS, "backups")

PORTA = 5000
TEMPO_CMD = 30
TEMPO_API = 120
MAX_PASSOS = 50
TENTATIVAS_API = 4

BLOQUEADOS = {".git", "node_modules", "__pycache__", "android", "dados"}
IGNORAR_TOTAL = {".git", "node_modules", "__pycache__"}
PROIBIDOS_CMD = ("rm -rf /", "mkfs", ":(){", "dd if=")

MSG_RETOMADA = (
    "O servidor foi reiniciado e já está respondendo. O comando pendente foi "
    "interrompido pelo reinício; se era um reinício do servidor, ele foi concluído."
)

NOTA_CHAT = (
    " PENSE E RESPONDA SEMPRE EM PORTUGUÊS DO BRASIL. Todo o seu raciocínio interno, "
    "cadeia de pensamento e blocos de reasoning devem ser escritos em português. Nunca "
    "pense em inglês. Todo texto que você produzir — raciocínio, respostas, mensagens de "
    "status e comentários de código — deve estar em português do Brasil. Converse de forma "
    "natural e curta: antes de usar ferramentas, diga em uma frase o que vai fazer. O "
    "usuário pode enviar novas mensagens enquanto você trabalha; elas chegam como mensagens "
    "de usuário no meio da tarefa. Leve-as em conta e responda a elas."
)

PROMPTS = {
    "total": (
        "Modo ACESSO TOTAL no Termux (HOME: " + HOME + "). Pode listar_arvore, ler_arquivo, "
        "escrever_arquivo, apagar_arquivo, executar_comando, pesquisar_web e ler_pagina em "
        "qualquer pasta do Termux (exceto .git, node_modules, __pycache__ e dados/config.json). "
        "Para reiniciar o servidor após alterar servidor.py, use executar_comando com "
        "'reiniciar_servidor'." + NOTA_CHAT
    ),
    "medio": (
        "Modo MÉDIO em ~/UruChat. Somente leitura (listar_arvore, ler_arquivo) e web "
        "(pesquisar_web, ler_pagina). Não altere, apague ou execute comandos." + NOTA_CHAT
    ),
    "minimo": (
        "Modo MÍNIMO em ~/UruChat. Conversa e pesquisa na web (pesquisar_web, ler_pagina), "
        "sem acesso a arquivos locais ou comandos." + NOTA_CHAT
    ),
}

# ---------------------------------------------------------------------------
# 2. Utilidades de arquivo
# ---------------------------------------------------------------------------


def ler_json(caminho, padrao):
    if os.path.exists(caminho):
        try:
            with open(caminho, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return json.loads(json.dumps(padrao))


def gravar_json(caminho, obj):
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    tmp = caminho + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    os.replace(tmp, caminho)


def norm_modo(m):
    v = str(m or "").strip().lower()
    if v in ("medio", "medium", "apps"):
        return "medio"
    if v in ("minimo", "musica", "conversa"):
        return "minimo"
    return "total"


def caminho_seguro(rel, modo="total"):
    """Resolve um caminho respeitando os limites do modo ativo."""
    raw = os.path.expanduser(str(rel or "").strip())
    if modo == "total":
        alvo = os.path.realpath(raw if raw else HOME)
        if alvo == os.path.realpath(CFG_PATH):
            return None, "Acesso a config.json bloqueado."
        if any(parte in IGNORAR_TOTAL for parte in alvo.split(os.sep)):
            return None, "Pasta ignorada (.git, node_modules, __pycache__)."
        return alvo, None
    base = os.path.realpath(RAIZ)
    alvo = os.path.realpath(os.path.join(RAIZ, raw or "."))
    if alvo != base and not alvo.startswith(base + os.sep):
        return None, "Fora de ~/UruChat."
    rel_p = os.path.relpath(alvo, base)
    if rel_p != "." and any(p in BLOQUEADOS for p in rel_p.split(os.sep)):
        return None, "Pasta bloqueada."
    return alvo, None


def fazer_backup(destino):
    if os.path.isfile(destino):
        os.makedirs(BK_DIR, exist_ok=True)
        nome = os.path.relpath(destino, RAIZ).replace(os.sep, "__") + ".%d.bak" % int(time.time())
        shutil.copy2(destino, os.path.join(BK_DIR, nome))


def ler_sessoes():
    lista = ler_json(SESSOES_PATH, {"sessoes": []}).get("sessoes", [])
    for s in lista:
        s["modo"] = norm_modo(s.get("modo"))
    lista.sort(key=lambda x: x.get("atualizado", 0), reverse=True)
    return lista


def gravar_sessoes(lista):
    lista.sort(key=lambda x: x.get("atualizado", 0), reverse=True)
    gravar_json(SESSOES_PATH, {"sessoes": lista})


# ---------------------------------------------------------------------------
# 3. Catálogo de modelos da API
# ---------------------------------------------------------------------------

# Usado quando a API não responde (offline ou sem chave).
MODELOS_LOCAIS = [
    {
        "id": "deepseek-flash",
        "nome": "DeepSeek-V4.1-Flash",
        "contexto": 1048576,
        "max_saida": 393216,
        "visao": True,
        "esforcos": ["low", "high", "max"],
        "esforco_padrao": "high",
    },
    {
        "id": "deepseek-v4-pro",
        "nome": "DeepSeek-V4-Pro",
        "contexto": 1048576,
        "max_saida": 393216,
        "visao": False,
        "esforcos": ["low", "high", "max"],
        "esforco_padrao": "high",
    },
]

MODELO_PADRAO = "deepseek-flash"

# Nomes antigos ou abreviados aceitos e o modelo atual equivalente.
ALIASES_MODELO = {
    "deepseek-chat": "deepseek-flash",
    "deepseek-reasoner": "deepseek-flash",
    "deepseek-v3": "deepseek-flash",
    "deepseek-v4-flash": "deepseek-flash",
    "deepseek-v4-flash-vision-exp": "deepseek-flash",
    "flash": "deepseek-flash",
    "chat": "deepseek-flash",
    "reasoner": "deepseek-flash",
    "deepseek-v4-pro": "deepseek-v4-pro",
    "deepseek-pro": "deepseek-v4-pro",
    "pro": "deepseek-v4-pro",
}

CFG_PADRAO = {
    "url": "https://api.deepseek.com/v1",
    "modelo": MODELO_PADRAO,
    "chave": "",
    "pensamento": True,
    "esforco": "high",
    "max_tokens": 8192,
    "stream": True,
    "usuario_id": "uruchat",
}

ESFORCOS_VALIDOS = ("low", "high", "max")

_CATALOGO = {"itens": [], "quando": 0.0, "origem": "local"}
_LOCK_CATALOGO = threading.Lock()


def ler_cfg():
    """Lê o config.json aplicando migrações de modelo e valores padrão."""
    cfg = ler_json(CFG_PATH, CFG_PADRAO)
    modelo = str(cfg.get("modelo") or "").strip().lower()
    cfg["modelo"] = ALIASES_MODELO.get(modelo, modelo or MODELO_PADRAO)
    cfg["url"] = str(cfg.get("url") or CFG_PADRAO["url"]).strip().rstrip("/")
    cfg["chave"] = str(cfg.get("chave") or "").strip()
    cfg["pensamento"] = bool(cfg.get("pensamento", True))
    esforco = str(cfg.get("esforco") or CFG_PADRAO["esforco"]).strip().lower()
    cfg["esforco"] = esforco if esforco in ESFORCOS_VALIDOS else CFG_PADRAO["esforco"]
    try:
        cfg["max_tokens"] = max(0, int(cfg.get("max_tokens", CFG_PADRAO["max_tokens"])))
    except Exception:
        cfg["max_tokens"] = CFG_PADRAO["max_tokens"]
    cfg["stream"] = bool(cfg.get("stream", CFG_PADRAO["stream"]))
    cfg["usuario_id"] = str(cfg.get("usuario_id") or CFG_PADRAO["usuario_id"]).strip()
    return cfg


def normalizar_modelo(nome, catalogo=None):
    """Devolve (id_do_modelo, erro). Aceita aliases antigos."""
    bruto = str(nome or "").strip().lower()
    if not bruto:
        return MODELO_PADRAO, None
    alvo = ALIASES_MODELO.get(bruto, bruto)
    ids = [m["id"] for m in (catalogo or _CATALOGO["itens"] or MODELOS_LOCAIS)]
    if alvo in ids:
        return alvo, None
    return None, "Modelo desconhecido: %s. Disponíveis: %s." % (bruto, ", ".join(ids))


def modelo_info(nome):
    alvo, _ = normalizar_modelo(nome)
    itens = _CATALOGO["itens"] or MODELOS_LOCAIS
    for m in itens:
        if m["id"] == alvo:
            return m
    return MODELOS_LOCAIS[0]


def modelo_suporta_visao(nome):
    return bool(modelo_info(nome).get("visao"))


def baixar_catalogo(cfg=None):
    """Consulta /v1/models na API. Em falha, mantém a lista local."""
    cfg = cfg or ler_cfg()
    if not cfg["chave"]:
        return MODELOS_LOCAIS, "local"
    alvo = cfg["url"] if cfg["url"].endswith("/models") else cfg["url"] + "/models"
    try:
        req = urllib.request.Request(alvo, headers={"Authorization": "Bearer " + cfg["chave"]})
        dados = json.loads(urllib.request.urlopen(req, timeout=20).read().decode("utf-8"))
        itens = []
        for m in dados.get("data") or []:
            esforco = m.get("effort") or {}
            modalidades = m.get("input_modalities") or ["text"]
            itens.append({
                "id": m.get("id"),
                "nome": m.get("name") or m.get("id"),
                "contexto": int(m.get("context_window") or 0),
                "max_saida": int(m.get("max_output_tokens") or 0),
                "visao": "image" in modalidades,
                "esforcos": esforco.get("supported_levels") or list(ESFORCOS_VALIDOS),
                "esforco_padrao": esforco.get("default_level") or "high",
            })
        if itens:
            return itens, "api"
    except Exception:
        pass
    return MODELOS_LOCAIS, "local"


def catalogo_modelos(forcar=False):
    with _LOCK_CATALOGO:
        agora = time.time()
        if not forcar and _CATALOGO["itens"] and agora - _CATALOGO["quando"] < 300:
            return _CATALOGO["itens"], _CATALOGO["origem"]
        itens, origem = baixar_catalogo()
        _CATALOGO.update({"itens": itens, "quando": agora, "origem": origem})
        return itens, origem


# ---------------------------------------------------------------------------
# 4. Ferramentas do agente
# ---------------------------------------------------------------------------

TOOLS_DEF = {
    "listar_arvore": {"type": "function", "function": {"name": "listar_arvore", "description": "Lista arquivos dentro de ~/UruChat.", "parameters": {"type": "object", "properties": {"subpasta": {"type": "string"}}}}},
    "ler_arquivo": {"type": "function", "function": {"name": "ler_arquivo", "description": "Lê arquivo de texto em ~/UruChat.", "parameters": {"type": "object", "properties": {"caminho": {"type": "string"}}, "required": ["caminho"]}}},
    "escrever_arquivo": {"type": "function", "function": {"name": "escrever_arquivo", "description": "Cria ou sobrescreve arquivo em ~/UruChat com backup.", "parameters": {"type": "object", "properties": {"caminho": {"type": "string"}, "conteudo": {"type": "string"}}, "required": ["caminho", "conteudo"]}}},
    "apagar_arquivo": {"type": "function", "function": {"name": "apagar_arquivo", "description": "Apaga arquivo em ~/UruChat com backup.", "parameters": {"type": "object", "properties": {"caminho": {"type": "string"}}, "required": ["caminho"]}}},
    "executar_comando": {"type": "function", "function": {"name": "executar_comando", "description": "Executa comando no Termux dentro de ~/UruChat (ou 'reiniciar_servidor' para desligar e ligar o servidor).", "parameters": {"type": "object", "properties": {"comando": {"type": "string"}}, "required": ["comando"]}}},
    "pesquisar_web": {"type": "function", "function": {"name": "pesquisar_web", "description": "Pesquisa na web.", "parameters": {"type": "object", "properties": {"consulta": {"type": "string"}}, "required": ["consulta"]}}},
    "ler_pagina": {"type": "function", "function": {"name": "ler_pagina", "description": "Extrai texto de URL http/https.", "parameters": {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}}},
}

TOOLS_MODO = {
    "total": [TOOLS_DEF[k] for k in ("listar_arvore", "ler_arquivo", "escrever_arquivo", "apagar_arquivo", "executar_comando", "pesquisar_web", "ler_pagina")],
    "medio": [TOOLS_DEF[k] for k in ("listar_arvore", "ler_arquivo", "pesquisar_web", "ler_pagina")],
    "minimo": [TOOLS_DEF[k] for k in ("pesquisar_web", "ler_pagina")],
}


def rodar_comando_seguro(cmd):
    c = str(cmd or "").strip()
    if not c:
        return {"erro": "Comando vazio."}
    if any(p in c for p in PROIBIDOS_CMD):
        return {"erro": "Comando bloqueado por segurança."}
    if c == "reiniciar_servidor":
        script = "bash ~/UruChat/uruchat.sh reiniciar-detached"
        subprocess.Popen(["bash", "-c", script], cwd=RAIZ, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        return {"ok": True, "mensagem": "Reinício do servidor agendado em 1 segundo."}
    try:
        os.makedirs(DADOS, exist_ok=True)
        saida = os.path.join(DADOS, "saida_%d.txt" % int(time.time() * 1000))
        try:
            with open(saida, "wb") as f:
                p = subprocess.run(["bash", "-c", c], cwd=RAIZ, stdin=subprocess.DEVNULL, stdout=f, stderr=subprocess.STDOUT, timeout=TEMPO_CMD, start_new_session=True)
            with open(saida, encoding="utf-8", errors="replace") as f:
                txt = f.read()
        finally:
            try:
                os.remove(saida)
            except Exception:
                pass
        return {"returncode": p.returncode, "stdout": txt[-8000:], "stderr": ""}
    except Exception as e:
        return {"erro": str(e)}


def busca_web(q):
    url = "https://html.duckduckgo.com/html/?" + urllib.parse.urlencode({"q": q})
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    bruto = urllib.request.urlopen(req, timeout=20).read().decode("utf-8", errors="replace")
    links = re.findall(r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>', bruto, flags=re.S)
    snips = re.findall(r'class="result__snippet"[^>]*>(.*?)</(?:a|div)>', bruto, flags=re.S)
    itens = []
    for i, (href, tit) in enumerate(links[:6]):
        u = html.unescape(href)
        if "uddg=" in u:
            u = urllib.parse.parse_qs(urllib.parse.urlparse(u).query).get("uddg", [u])[0]
        res = html.unescape(re.sub(r"<[^>]+>", "", snips[i])).strip() if i < len(snips) else ""
        itens.append({"titulo": html.unescape(re.sub(r"<[^>]+>", "", tit)).strip(), "url": u, "resumo": res})
    return {"resultados": itens}


def rodar_tool(nome, args, modo):
    if nome not in {t["function"]["name"] for t in TOOLS_MODO.get(modo, [])}:
        return {"erro": "Ferramenta não permitida neste modo."}

    if nome == "listar_arvore":
        alvo, err = caminho_seguro(args.get("subpasta", ""), modo)
        if err:
            return {"erro": err}
        lista = []
        for p, dirs, files in os.walk(alvo):
            dirs[:] = [d for d in sorted(dirs) if d not in (IGNORAR_TOTAL if modo == "total" else BLOQUEADOS)]
            for n in sorted(files):
                lista.append(os.path.join(p, n))
                if len(lista) >= 600:
                    return {"arquivos": lista, "truncado": True}
        return {"arquivos": lista}

    if nome == "ler_arquivo":
        alvo, err = caminho_seguro(args.get("caminho", ""), modo)
        if err:
            return {"erro": err}
        if not os.path.isfile(alvo):
            return {"erro": "Arquivo inexistente."}
        if os.path.getsize(alvo) > 300000:
            return {"erro": "Arquivo > 300 KB."}
        with open(alvo, encoding="utf-8", errors="replace") as f:
            return {"caminho": alvo, "conteudo": f.read()}

    if nome == "escrever_arquivo":
        alvo, err = caminho_seguro(str(args.get("caminho") or "").strip(), modo)
        if err:
            return {"erro": err}
        fazer_backup(alvo)
        os.makedirs(os.path.dirname(alvo), exist_ok=True)
        with open(alvo, "w", encoding="utf-8") as f:
            f.write(str(args.get("conteudo", "")))
        return {"ok": True, "arquivo": alvo}

    if nome == "apagar_arquivo":
        alvo, err = caminho_seguro(str(args.get("caminho") or "").strip(), modo)
        if err:
            return {"erro": err}
        if not os.path.isfile(alvo):
            return {"erro": "Arquivo inexistente."}
        fazer_backup(alvo)
        os.remove(alvo)
        return {"ok": True}

    if nome == "executar_comando":
        return rodar_comando_seguro(args.get("comando", ""))

    if nome == "pesquisar_web":
        try:
            return busca_web(str(args.get("consulta") or ""))
        except Exception as e:
            return {"erro": str(e)}

    if nome == "ler_pagina":
        u = str(args.get("url") or "")
        if not u.startswith(("http://", "https://")):
            return {"erro": "URL inválida."}
        try:
            req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
            bruto = urllib.request.urlopen(req, timeout=20).read().decode("utf-8", errors="replace")
            txt = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", bruto, flags=re.S | re.I)
            txt = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", txt))).strip()
            return {"conteudo": txt[:12000]}
        except Exception as e:
            return {"erro": str(e)}

    return {"erro": "Ferramenta desconhecida."}


# ---------------------------------------------------------------------------
# 5. Conversa com a API
# ---------------------------------------------------------------------------

ROLES_API = ("system", "user", "assistant", "tool")


def mensagens_para_api(msgs, pensamento):
    """Converte o histórico interno no formato aceito pela API.

    O histórico interno carrega itens com role "raciocinio" (usados só para
    exibição) e campos extras como "anexos". Esta é a única fronteira onde
    esses itens são descartados e onde o `reasoning_content` é garantido.
    """
    saida = []
    for m in msgs or []:
        if not isinstance(m, dict):
            continue
        papel = str(m.get("role") or "").strip()
        if papel not in ROLES_API:
            continue
        conteudo = m.get("content")
        item = {"role": papel}
        if isinstance(conteudo, list):
            item["content"] = conteudo
        else:
            item["content"] = "" if conteudo is None else str(conteudo)
        if papel == "assistant":
            calls = m.get("tool_calls")
            if calls:
                item["tool_calls"] = calls
            if pensamento:
                item["reasoning_content"] = str(m.get("reasoning_content") or "")
        if papel == "tool":
            item["tool_call_id"] = str(m.get("tool_call_id") or "")
        saida.append(item)
    return saida


def mensagem_de_erro(codigo, corpo):
    detalhe = corpo[:300] if isinstance(corpo, str) else str(corpo)[:300]
    traducoes = {
        401: "Chave da API inválida ou expirada. Confira em Configurações > API.",
        402: "Saldo insuficiente na conta da DeepSeek.",
        429: "Limite de requisições atingido. Tente novamente em instantes.",
        500: "O serviço da DeepSeek apresentou erro interno.",
        502: "O serviço da DeepSeek está indisponível no momento.",
        503: "O serviço da DeepSeek está sobrecarregado. Tente novamente.",
        504: "O serviço da DeepSeek não respondeu a tempo.",
    }
    if codigo == 400 and "reasoning_content" in detalhe:
        return "Falha no histórico de raciocínio: a API exige o reasoning_content dos turnos anteriores."
    base = traducoes.get(codigo) or "Erro HTTP %s da API." % codigo
    return "%s (%s)" % (base, detalhe) if detalhe else base


def pedir_api(url, corpo, chave):
    dados = json.dumps(corpo).encode("utf-8")
    ultimo = None
    for tentativa in range(TENTATIVAS_API):
        try:
            req = urllib.request.Request(url, data=dados, method="POST", headers={"Content-Type": "application/json", "Authorization": "Bearer " + chave})
            return json.loads(urllib.request.urlopen(req, timeout=TEMPO_API).read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            texto = e.read()[:300].decode("utf-8", errors="replace")
            if e.code in (429, 500, 502, 503, 504) and tentativa < TENTATIVAS_API - 1:
                ultimo = mensagem_de_erro(e.code, texto)
                time.sleep(2 ** (tentativa + 1))
                continue
            raise Exception(mensagem_de_erro(e.code, texto))
        except Exception as e:
            ultimo = e
            if tentativa < TENTATIVAS_API - 1:
                time.sleep(2 ** (tentativa + 1))
    raise ultimo if isinstance(ultimo, Exception) else Exception(str(ultimo))


def pedir_api_stream(url, corpo, chave, ao_delta=None):
    """Lê o SSE da API e remonta a resposta no mesmo formato do modo normal.

    Cada fragmento recebido é repassado a `ao_delta(texto, raciocinio)` para a
    interface mostrar o andamento. As chamadas de ferramenta chegam picotadas
    e são remontadas pelo índice informado em cada fragmento.
    """
    dados = json.dumps(corpo).encode("utf-8")
    req = urllib.request.Request(url, data=dados, method="POST", headers={
        "Content-Type": "application/json",
        "Authorization": "Bearer " + chave,
        "Accept": "text/event-stream",
    })
    try:
        resposta = urllib.request.urlopen(req, timeout=TEMPO_API)
    except urllib.error.HTTPError as e:
        texto = e.read()[:300].decode("utf-8", errors="replace")
        raise Exception(mensagem_de_erro(e.code, texto))

    conteudo, raciocinio, uso, motivo = "", "", {}, ""
    calls = {}
    ultimo_aviso = 0.0
    try:
        with resposta:
            for cru in resposta:
                linha = cru.decode("utf-8", errors="replace").strip()
                if not linha or not linha.startswith("data:"):
                    continue
                carga = linha[5:].strip()
                if carga == "[DONE]":
                    break
                try:
                    evento = json.loads(carga)
                except Exception:
                    continue
                if evento.get("usage"):
                    uso = evento["usage"]
                escolhas = evento.get("choices") or []
                if not escolhas:
                    continue
                escolha = escolhas[0] or {}
                delta = escolha.get("delta") or {}
                motivo = escolha.get("finish_reason") or motivo
                pedaco = delta.get("content") or ""
                pensado = delta.get("reasoning_content") or ""
                if pedaco:
                    conteudo += pedaco
                if pensado:
                    raciocinio += pensado
                for tc in delta.get("tool_calls") or []:
                    i = int(tc.get("index") or 0)
                    alvo = calls.setdefault(i, {"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
                    if tc.get("id"):
                        alvo["id"] = tc["id"]
                    fn = tc.get("function") or {}
                    if fn.get("name"):
                        alvo["function"]["name"] += fn["name"]
                    if fn.get("arguments"):
                        alvo["function"]["arguments"] += fn["arguments"]
                if ao_delta and (pedaco or pensado):
                    # Avisa a interface no máximo ~7 vezes por segundo.
                    agora = time.time()
                    if agora - ultimo_aviso >= 0.15:
                        ultimo_aviso = agora
                        ao_delta(conteudo, raciocinio)
    except Exception:
        # Falha no meio do fluxo: o que já veio é preservado pelo chamador.
        raise

    mensagem = {"role": "assistant", "content": conteudo}
    if raciocinio:
        mensagem["reasoning_content"] = raciocinio
    if calls:
        mensagem["tool_calls"] = [calls[i] for i in sorted(calls)]
    return {"choices": [{"message": mensagem, "finish_reason": motivo}], "usage": uso or {}}


def montar_corpo(job, cfg):
    usar_stream = bool(cfg.get("stream"))
    corpo = {"model": job["modelo"], "messages": mensagens_para_api(job["msgs"], cfg["pensamento"]), "stream": usar_stream}
    if usar_stream:
        corpo["stream_options"] = {"include_usage": True}
    tools = TOOLS_MODO.get(job["modo"], [])
    if tools:
        corpo["tools"] = tools
        corpo["tool_choice"] = "auto"
    if cfg["pensamento"]:
        corpo["thinking"] = {"type": "enabled"}
        corpo["reasoning_effort"] = cfg["esforco"]
    else:
        corpo["thinking"] = {"type": "disabled"}
    if cfg["max_tokens"] > 0:
        corpo["max_tokens"] = cfg["max_tokens"]
    if cfg["usuario_id"]:
        corpo["user_id"] = cfg["usuario_id"]
    return corpo


def chamar_api(job, ao_delta=None):
    cfg = ler_cfg()
    if not cfg["chave"]:
        raise Exception("Chave da API não configurada em Configurações > API.")
    base = cfg["url"]
    alvo = base if base.endswith("/chat/completions") else base + "/chat/completions"
    corpo = montar_corpo(job, cfg)
    job["stream"] = bool(corpo.get("stream"))
    if not corpo.get("stream"):
        return pedir_api(alvo, corpo, cfg["chave"])

    try:
        return pedir_api_stream(alvo, corpo, cfg["chave"], ao_delta)
    except Exception as e:
        # Se nada foi entregue ainda, refaz sem streaming em vez de falhar.
        with LOCK_JOBS:
            parcial = job.get("parcial") or job.get("parcial_r")
        if parcial:
            raise
        corpo["stream"] = False
        corpo.pop("stream_options", None)
        job["stream"] = False
        job.setdefault("acoes", []).append("streaming indisponível: usei o modo normal")
        salvar_job(job)
        return pedir_api(alvo, corpo, cfg["chave"])


# ---------------------------------------------------------------------------
# 6. Tarefas em segundo plano (jobs)
# ---------------------------------------------------------------------------

JOBS_VIVOS = {}
LOCK_JOBS = threading.RLock()


def caminho_job(jid):
    return os.path.join(JOBS_DIR, re.sub(r"[^A-Za-z0-9_]", "", str(jid)) + ".json")


def salvar_job(job):
    with LOCK_JOBS:
        os.makedirs(JOBS_DIR, exist_ok=True)
        p = caminho_job(job["id"])
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(job, f, ensure_ascii=False)
        os.replace(tmp, p)


def ler_job(jid):
    try:
        with open(caminho_job(jid), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def novo_job(jid, sessao, modo, modelo, msgs, base, tokens_base):
    return {
        "id": jid, "sessao": sessao, "estado": "rodando", "modo": modo, "modelo": modelo,
        "msgs": msgs, "vistas": [], "acoes": [], "tokens": 0, "cache_hit": 0,
        "cache_miss": 0, "texto": "", "passo": 0, "base": base,
        "tokens_base": tokens_base, "transcricao": [], "fila": [],
    }


def tool_pendentes(msgs):
    feitos = {m.get("tool_call_id") for m in msgs if m.get("role") == "tool"}
    for m in reversed(msgs):
        if m.get("role") == "assistant" and m.get("tool_calls"):
            return [tc for tc in m["tool_calls"] if tc.get("id") not in feitos]
    return []


def sincronizar_sessao(job):
    sid = job.get("sessao")
    if not sid:
        return
    with LOCK_JOBS:
        lista = ler_sessoes()
        for s in lista:
            if s.get("id") == sid:
                base = int(job.get("base") or 0)
                s["mensagens"] = (s.get("mensagens") or [])[:base] + list(job.get("transcricao") or [])
                s["tokens"] = int(job.get("tokens_base") or 0) + int(job.get("tokens") or 0)
                s["atualizado"] = int(time.time() * 1000)
                gravar_sessoes(lista)
                return


def registrar_tx(job, papel, texto, raciocinio=None):
    with LOCK_JOBS:
        item = {"role": papel, "content": texto}
        if raciocinio:
            item["raciocinio"] = raciocinio
        job["transcricao"].append(item)
        salvar_job(job)
    sincronizar_sessao(job)


def drenar_fila(job):
    with LOCK_JOBS:
        if not job["fila"]:
            return
        for t in job["fila"]:
            job["msgs"].append({"role": "user", "content": t})
        job["fila"] = []
        salvar_job(job)


def enfileirar_mensagem(jid, txt):
    txt = str(txt or "").strip()
    if not txt:
        return False
    with LOCK_JOBS:
        job = JOBS_VIVOS.get(jid)
        if not job or job.get("estado") not in ("rodando", "reiniciando"):
            return False
        job["fila"].append(txt)
        job["transcricao"].append({"role": "user", "content": txt})
        salvar_job(job)
    sincronizar_sessao(job)
    return True


def acumular_uso(job, res):
    uso = res.get("usage") or {}
    job["tokens"] += int(uso.get("total_tokens") or 0)
    job["cache_hit"] += int(uso.get("prompt_cache_hit_tokens") or 0)
    job["cache_miss"] += int(uso.get("prompt_cache_miss_tokens") or 0)


def rodar_job(job, resumido=False):
    for k, v in (("transcricao", []), ("fila", []), ("base", 0), ("tokens_base", 0), ("cache_hit", 0), ("cache_miss", 0), ("parcial", ""), ("parcial_r", "")):
        job.setdefault(k, v)
    try:
        if resumido:
            pend = tool_pendentes(job["msgs"])
            for tc in pend:
                job["msgs"].append({"role": "tool", "tool_call_id": tc.get("id", ""), "content": json.dumps({"ok": True, "mensagem": MSG_RETOMADA}, ensure_ascii=False)})
            if pend:
                job["acoes"].append("servidor reiniciado")
            job["estado"] = "rodando"
            salvar_job(job)

        def ao_delta(texto, pensado):
            """Publica o andamento. Grava em disco no máximo a cada 2 segundos."""
            with LOCK_JOBS:
                job["parcial"] = texto
                job["parcial_r"] = pensado
                agora = time.time()
                if agora - job.get("salvo_em", 0.0) >= 2:
                    job["salvo_em"] = agora
                    salvar_job(job)

        while job["passo"] < MAX_PASSOS:
            drenar_fila(job)
            job["passo"] += 1
            res = chamar_api(job, ao_delta)
            with LOCK_JOBS:
                job["parcial"] = ""
                job["parcial_r"] = ""
            acumular_uso(job, res)
            msg = (res.get("choices") or [{}])[0].get("message") or {}
            calls = msg.get("tool_calls") or []
            raciocinio = (msg.get("reasoning_content") or "").strip()
            if raciocinio:
                registrar_tx(job, "raciocinio", raciocinio)

            if not calls:
                texto = msg.get("content") or ("Concluído." if not raciocinio else "(sem resposta final)")
                registrar_tx(job, "assistant", texto)
                with LOCK_JOBS:
                    pendente = bool(job["fila"])
                    if not pendente:
                        job["texto"] = texto
                        job["estado"] = "concluido"
                if pendente:
                    item = {"role": "assistant", "content": texto}
                    if raciocinio:
                        item["reasoning_content"] = raciocinio
                    job["msgs"].append(item)
                    salvar_job(job)
                    continue
                salvar_job(job)
                return

            fala = (msg.get("content") or "").strip()
            if fala:
                registrar_tx(job, "assistant", fala)
            item = {"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls}
            # O raciocínio precisa voltar à API nos turnos seguintes (mesmo vazio).
            item["reasoning_content"] = raciocinio
            job["msgs"].append(item)
            salvar_job(job)

            for tc in calls:
                fn = tc.get("function") or {}
                nome, raw_args = fn.get("name", ""), fn.get("arguments") or "{}"
                if [nome, raw_args] in job["vistas"]:
                    out = {"erro": "Chamada repetida."}
                else:
                    job["vistas"].append([nome, raw_args])
                    job["acoes"].append(nome)
                    try:
                        args_obj = json.loads(raw_args)
                    except Exception:
                        args_obj = {}
                    reinicio = nome == "executar_comando" and str(args_obj.get("comando") or "").strip() == "reiniciar_servidor"
                    if reinicio:
                        job["estado"] = "reiniciando"
                    salvar_job(job)
                    out = rodar_tool(nome, args_obj, job["modo"])
                    if reinicio:
                        time.sleep(60)
                        out = {"erro": "O servidor não reiniciou em 60 segundos."}
                        job["estado"] = "rodando"
                job["msgs"].append({"role": "tool", "tool_call_id": tc.get("id", ""), "content": json.dumps(out, ensure_ascii=False)})
                salvar_job(job)

        texto = "Limite de passos atingido sem resposta final."
        registrar_tx(job, "assistant", texto)
        job["texto"] = texto
        job["estado"] = "concluido"
        salvar_job(job)
    except Exception as e:
        texto = str(e) if str(e).startswith(("Chave", "Modelo", "Saldo", "Limite", "O serviço", "Erro HTTP", "Falha no histórico")) else "Erro: " + str(e)
        try:
            registrar_tx(job, "assistant", texto)
        except Exception:
            pass
        job["texto"] = texto
        job["estado"] = "erro"
        salvar_job(job)


def iniciar_job(job, resumido=False):
    for k, v in (("transcricao", []), ("fila", []), ("base", 0), ("tokens_base", 0), ("cache_hit", 0), ("cache_miss", 0), ("parcial", ""), ("parcial_r", "")):
        job.setdefault(k, v)
    JOBS_VIVOS[job["id"]] = job
    threading.Thread(target=rodar_job, args=(job, resumido), daemon=True).start()


def retomar_jobs():
    if not os.path.isdir(JOBS_DIR):
        return
    agora = time.time()
    for n in os.listdir(JOBS_DIR):
        if not n.endswith(".json"):
            continue
        p = os.path.join(JOBS_DIR, n)
        try:
            with open(p, encoding="utf-8") as f:
                j = json.load(f)
        except Exception:
            continue
        if j.get("estado") in ("rodando", "reiniciando"):
            iniciar_job(j, True)
        elif agora - os.path.getmtime(p) > 86400:
            try:
                os.remove(p)
            except Exception:
                pass


# ---------------------------------------------------------------------------
# 7. Servidor HTTP
# ---------------------------------------------------------------------------

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=WWW, **k)

    def _json(self, status, obj):
        b = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _corpo(self):
        tamanho = int(self.headers.get("Content-Length", 0) or 0)
        if not tamanho:
            return {}
        try:
            return json.loads(self.rfile.read(tamanho).decode("utf-8"))
        except Exception:
            return {}

    def _preparar_imagens(self, msgs, imagens):
        """Anexa as imagens à última mensagem do usuário."""
        for k in range(len(msgs) - 1, -1, -1):
            if msgs[k].get("role") != "user":
                continue
            partes = [{"type": "text", "text": msgs[k].get("content") or ""}]
            for im in imagens:
                du = im.get("dataUrl") or ""
                if du:
                    partes.append({"type": "image_url", "image_url": {"url": du}})
            msgs[k] = {"role": "user", "content": partes}
            return

    # -- GET ---------------------------------------------------------------
    def do_GET(self):
        rota = self.path.split("?", 1)[0]

        if rota == "/api/ping":
            return self._json(200, {"ok": True})

        if rota == "/api/job":
            jid = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("id", [""])[0]
            with LOCK_JOBS:
                j = JOBS_VIVOS.get(jid) or ler_job(jid)
                if not j:
                    return self._json(404, {"erro": "Tarefa não encontrada."})
                resp = {
                    "estado": j.get("estado"), "acoes": list(j.get("acoes", [])),
                    "texto": j.get("texto", ""), "tokens": j.get("tokens", 0),
                    "tokens_base": j.get("tokens_base", 0), "base": j.get("base", 0),
                    "cache_hit": j.get("cache_hit", 0), "cache_miss": j.get("cache_miss", 0),
                    "modelo": j.get("modelo"), "transcricao": list(j.get("transcricao", [])),
                    "parcial": j.get("parcial", ""), "parcial_r": j.get("parcial_r", ""),
                    "stream": bool(j.get("stream")),
                }
            return self._json(200, resp)

        if rota == "/api/sessoes":
            return self._json(200, {"sessoes": ler_sessoes()})

        if rota == "/api/preferencias":
            pref = ler_json(PREF_PATH, {"modo": "total", "tema": "escuro", "fonte_px": 15, "espaco_em": 2.8})
            pref["modo"] = norm_modo(pref.get("modo"))
            return self._json(200, pref)

        if rota == "/api/config":
            cfg = ler_cfg()
            return self._json(200, {
                "url": cfg["url"], "modelo": cfg["modelo"],
                "tem_chave": bool(cfg["chave"]), "pensamento": cfg["pensamento"],
                "esforco": cfg["esforco"], "max_tokens": cfg["max_tokens"],
                "stream": cfg["stream"],
            })

        if rota == "/api/modelos":
            itens, origem = catalogo_modelos()
            cfg = ler_cfg()
            atual, _ = normalizar_modelo(cfg["modelo"], itens)
            return self._json(200, {"modelos": itens, "atual": atual or MODELO_PADRAO, "origem": origem})

        return super().do_GET()

    # -- POST --------------------------------------------------------------
    def do_POST(self):
        rota = self.path.split("?", 1)[0]
        dados = self._corpo()

        if rota == "/api/preferencias":
            atual = ler_json(PREF_PATH, {"modo": "total", "tema": "escuro", "fonte_px": 15, "espaco_em": 2.8})
            if "modo" in dados:
                atual["modo"] = norm_modo(dados["modo"])
            if dados.get("tema") in ("escuro", "claro"):
                atual["tema"] = dados["tema"]
            if "fonte_px" in dados:
                atual["fonte_px"] = min(24, max(12, int(dados["fonte_px"])))
            if "espaco_em" in dados:
                atual["espaco_em"] = min(4.5, max(1.0, float(dados["espaco_em"])))
            gravar_json(PREF_PATH, atual)
            return self._json(200, atual)

        if rota == "/api/sessoes/salvar":
            sid = str(dados.get("id") or "").strip()
            if not sid:
                return self._json(400, {"erro": "ID inválido."})
            nova = {
                "id": sid,
                "modo": norm_modo(dados.get("modo")),
                "titulo": str(dados.get("titulo") or "Nova conversa").strip()[:80] or "Nova conversa",
                "manual": bool(dados.get("manual")),
                "atualizado": int(dados.get("atualizado") or time.time() * 1000),
                "mensagens": dados.get("mensagens") if isinstance(dados.get("mensagens"), list) else [],
                "tokens": int(dados.get("tokens") or 0),
            }
            gravar_sessoes([s for s in ler_sessoes() if s.get("id") != sid] + [nova])
            return self._json(200, {"ok": True})

        if rota == "/api/sessoes/renomear":
            sid = str(dados.get("id") or "").strip()
            tit = str(dados.get("titulo") or "").strip()[:80]
            lista = ler_sessoes()
            for s in lista:
                if s.get("id") == sid and tit:
                    s["titulo"] = tit
                    s["manual"] = True
            gravar_sessoes(lista)
            return self._json(200, {"ok": True})

        if rota == "/api/sessoes/apagar":
            sid = str(dados.get("id") or "").strip()
            gravar_sessoes([s for s in ler_sessoes() if s.get("id") != sid])
            return self._json(200, {"ok": True})

        if rota == "/api/config":
            atual = ler_cfg()
            if str(dados.get("url") or "").strip():
                atual["url"] = str(dados["url"]).strip().rstrip("/")
            if str(dados.get("modelo") or "").strip():
                itens, _ = catalogo_modelos()
                modelo, erro = normalizar_modelo(dados["modelo"], itens)
                if erro:
                    return self._json(400, {"erro": erro})
                atual["modelo"] = modelo
            if str(dados.get("chave") or "").strip():
                atual["chave"] = str(dados["chave"]).strip()
                catalogo_modelos(forcar=True)
            if "pensamento" in dados:
                atual["pensamento"] = bool(dados["pensamento"])
            if str(dados.get("esforco") or "").strip().lower() in ESFORCOS_VALIDOS:
                atual["esforco"] = str(dados["esforco"]).strip().lower()
            if "max_tokens" in dados:
                try:
                    atual["max_tokens"] = max(0, int(dados["max_tokens"]))
                except Exception:
                    return self._json(400, {"erro": "max_tokens inválido."})
            if "stream" in dados:
                atual["stream"] = bool(dados["stream"])
            gravar_json(CFG_PATH, atual)
            return self._json(200, {"ok": True, "modelo": atual["modelo"], "pensamento": atual["pensamento"], "esforco": atual["esforco"], "max_tokens": atual["max_tokens"], "stream": atual["stream"]})

        if rota == "/api/job/mensagem":
            ok = enfileirar_mensagem(str(dados.get("id") or ""), dados.get("mensagem"))
            return self._json(200, {"ok": ok})

        if rota == "/api/chat":
            return self._iniciar_conversa(dados)

        return self._json(404, {"erro": "Rota não encontrada."})

    def _iniciar_conversa(self, dados):
        cfg = ler_cfg()
        if not cfg["chave"]:
            return self._json(400, {"erro": "Chave da API não configurada em Configurações > API."})

        modo = norm_modo(dados.get("modo"))
        pedido = str(dados.get("modelo") or "").strip()
        if pedido:
            modelo, erro = normalizar_modelo(pedido)
            if erro:
                return self._json(400, {"erro": erro})
        else:
            modelo, erro = normalizar_modelo(cfg["modelo"])
            if erro:
                return self._json(400, {"erro": erro})

        anexos = dados.get("anexos") or {}
        imagens = [im for im in (anexos.get("imagens") or []) if isinstance(im, dict)] if isinstance(anexos, dict) else []
        if imagens and not modelo_suporta_visao(modelo):
            return self._json(400, {"erro": "O modelo %s não lê imagens. Escolha o DeepSeek-V4.1-Flash para enviar fotos." % modelo})

        msgs = list(dados.get("mensagens") or [])
        if imagens:
            self._preparar_imagens(msgs, imagens)

        sessoes = [x for x in ler_sessoes() if x.get("id") == str(dados.get("sessao") or "")]
        base_sess = len(sessoes[0].get("mensagens") or []) if sessoes else 0
        tok_sess = int(sessoes[0].get("tokens") or 0) if sessoes else 0

        jid = "j_%d" % int(time.time() * 1000)
        job = novo_job(
            jid, str(dados.get("sessao") or ""), modo, modelo,
            [{"role": "system", "content": PROMPTS[modo]}] + msgs,
            base_sess, tok_sess,
        )
        salvar_job(job)
        iniciar_job(job)
        return self._json(200, {"job": jid, "modelo": modelo})

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


# ---------------------------------------------------------------------------
# 8. Inicialização
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    catalogo_modelos()
    retomar_jobs()
    ThreadingHTTPServer(("127.0.0.1", PORTA), Handler).serve_forever()
