"""
PyHub — backend (Flask + SQLite)

Serve o frontend (pasta frontend/) e a API usada por ele:
  autenticação por sessão (cookie assinado, HttpOnly, 30 dias),
  perguntas, respostas, votos e desafio do dia — tudo no banco de dados.

Rodar local:  python app.py     →  http://127.0.0.1:5000
Produção:     gunicorn app:app --workers 1 --threads 8
"""
import datetime as dt
import json
import os
import re
import secrets
import sqlite3
import time

from flask import Flask, g, jsonify, request, send_from_directory, session
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import check_password_hash, generate_password_hash

BASE = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.join(BASE, "frontend")
DB_PATH = os.environ.get("PYHUB_DB") or os.path.join(BASE, "pyhub.db")


def _secret_key():
    """Chave que assina os cookies de sessão: vem do ambiente ou é criada 1 vez."""
    env = os.environ.get("SECRET_KEY")
    if env:
        return env
    path = os.path.join(BASE, "secret.key")
    try:
        with open(path, encoding="utf-8") as f:
            key = f.read().strip()
        if key:
            return key
    except OSError:
        pass
    key = secrets.token_hex(32)
    with open(path, "w", encoding="utf-8") as f:
        f.write(key)
    return key


app = Flask(__name__, static_folder=None)
app.config.update(
    SECRET_KEY=_secret_key(),
    SESSION_COOKIE_HTTPONLY=True,      # JavaScript não lê o cookie
    SESSION_COOKIE_SAMESITE="Lax",     # protege contra CSRF básico
    PERMANENT_SESSION_LIFETIME=dt.timedelta(days=30),  # login salva por 30 dias
    MAX_CONTENT_LENGTH=64 * 1024,
)
if os.environ.get("PYHUB_HTTPS") == "1":  # ativar em produção (Render etc.)
    app.config["SESSION_COOKIE_SECURE"] = True  # cookie só via HTTPS

# Em produção (Render/Railway) o IP real chega no cabeçalho X-Forwarded-For.
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)

# ------------------------------------------------------------------ banco

SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email      TEXT NOT NULL UNIQUE,
  pw         TEXT NOT NULL,                -- hash (scrypt/pbkdf2), nunca a senha
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS questions(
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL CHECK(kind IN ('erro','pergunta','tutorial')),
  title        TEXT NOT NULL,
  tags         TEXT NOT NULL DEFAULT '[]',
  body         TEXT NOT NULL DEFAULT '',
  code         TEXT NOT NULL DEFAULT '',
  resolved     INTEGER NOT NULL DEFAULT 0,
  base_votes   INTEGER NOT NULL DEFAULT 0,   -- votos dos conteúdos originais
  base_answers INTEGER NOT NULL DEFAULT 0,
  author_id    INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS answers(
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  author_id   INTEGER NOT NULL REFERENCES users(id),
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS votes(
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  UNIQUE(question_id, user_id)
);
CREATE TABLE IF NOT EXISTS challenge_done(
  user_id      INTEGER NOT NULL REFERENCES users(id),
  challenge_id TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE(user_id, challenge_id)
);
"""

# Conteúdo inicial (o mesmo do protótipo), inserido na primeira execução.
# (tipo, título, tags_json, votos, respostas, resolvido, idade_em_minutos, texto, código)
SEEDS = [
    ("erro", "ModuleNotFoundError: No module named 'requests'", '["pip","venv"]', 42, 6, 1, 120,
     "Quase sempre o pacote foi instalado num Python diferente do que roda o script. "
     "Ative o ambiente virtual e instale de novo com o mesmo interpretador.",
     "python -m pip install requests\npython main.py"),
    ("erro", "IndentationError: unexpected indent", '["sintaxe"]', 35, 4, 1, 300,
     "Você misturou tabs e espaços. Escolha um só (o padrão são 4 espaços) e configure "
     "o editor para converter tabs automaticamente.",
     "def soma(a, b):\n    return a + b   # 4 espaços"),
    ("pergunta", "Qual a diferença entre lista e tupla na prática?", '["iniciante","estruturas"]', 28, 9, 1, 1440,
     "Listas podem mudar depois de criadas, tuplas não. Use tupla para dados fixos, "
     "como coordenadas, e lista quando for adicionar ou remover itens.",
     "ponto = (10, 20)\nnomes = ['Ana']\nnomes.append('Beto')"),
    ("erro", "KeyError ao ler um dicionário vindo de JSON", '["dict","json"]', 19, 3, 0, 1500,
     "", ""),
    ("tutorial", "Como criar seu primeiro ambiente virtual (venv)", '["venv","iniciante"]', 61, 2, 1, 4320,
     "Um venv isola as bibliotecas de cada projeto. Crie, ative e instale só o que o projeto precisa.",
     "python -m venv .venv\nsource .venv/bin/activate\n# Windows: .venv\\Scripts\\activate"),
    ("pergunta", "Como ler um arquivo CSV sem usar pandas?", '["csv","arquivos"]', 14, 5, 1, 5760,
     "O módulo csv já vem com o Python. DictReader devolve cada linha como dicionário.",
     "import csv\nwith open('dados.csv', newline='', encoding='utf-8') as f:\n"
     "    for linha in csv.DictReader(f):\n        print(linha['nome'])"),
    ("erro", 'TypeError: can only concatenate str (not "int") to str', '["tipos","print"]', 51, 7, 1, 7200,
     "Você tentou somar texto com número. Converta com str() ou use f-string.",
     "idade = 15\nprint(f'Tenho {idade} anos')"),
    ("tutorial", "Primeira requisição HTTP com requests", '["api","requests"]', 33, 1, 1, 10080,
     "Faça um GET, confira o status e leia o JSON da resposta.",
     "import requests\nr = requests.get('https://api.github.com')\n"
     "print(r.status_code, r.json()['current_user_url'])"),
]

# Desafio do dia — igual à lista do frontend (validação fica no servidor).
CHS = [
    {"id": "c1", "t": "Imprima a soma dos números de 1 a 10.", "e": "55"},
    {"id": "c2", "t": "Imprima os números pares de 1 a 10, um por linha.", "e": "2\n4\n6\n8\n10"},
    {"id": "c3", "t": "Imprima uma lista com os quadrados de 1 a 5.", "e": "[1, 4, 9, 16, 25]"},
    {"id": "c4", "t": "Imprima a palavra PyHub ao contrário.", "e": "buHyP"},
    {"id": "c5", "t": "Imprima o fatorial de 5 (5 x 4 x 3 x 2 x 1).", "e": "120"},
]

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
USER_RE = re.compile(r"^[A-Za-z0-9_]{3,20}$")
TAG_RE = re.compile(r"^[\w.-]{1,16}$")


def init_db():
    first = not os.path.exists(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    if conn.execute("SELECT COUNT(*) c FROM questions").fetchone()["c"] == 0:
        now = dt.datetime.now(dt.timezone.utc)
        for kind, title, tags, votes, answers, resolved, minutes, body, code in reversed(SEEDS):
            created = (now - dt.timedelta(minutes=minutes)).isoformat(timespec="seconds")
            conn.execute(
                "INSERT INTO questions(kind,title,tags,body,code,resolved,base_votes,base_answers,created_at)"
                " VALUES(?,?,?,?,?,?,?,?,?)",
                (kind, title, tags, body, code, resolved, votes, answers, created))
        conn.commit()
    conn.close()
    if first:
        print("Banco de dados criado em:", DB_PATH)


def db():
    if "db" not in g:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=5000")
        g.db = conn
    return g.db


@app.teardown_appcontext
def _close_db(exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


# ------------------------------------------------------------- utilidades

def _now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def humanize(iso):
    """'há 2 h', '3 d', '1 sem'… a partir do timestamp UTC salvo no banco."""
    try:
        t = dt.datetime.fromisoformat(iso)
    except ValueError:
        return "instantes"
    mins = int((dt.datetime.now(dt.timezone.utc) - t).total_seconds() // 60)
    if mins < 1:
        return "instantes"
    if mins < 60:
        return "%d min" % mins
    hours = mins // 60
    if hours < 24:
        return "%d h" % hours
    days = hours // 24
    if days < 7:
        return "%d d" % days
    if days < 30:
        return "%d sem" % (days // 7)
    if days < 365:
        return "%d m" % (days // 30)
    return "%d a" % (days // 365)


def err(msg, code=400):
    return jsonify(error=msg), code


def js():
    """Corpo JSON da requisição (POSTs precisam de Content-Type: application/json)."""
    if not request.is_json:
        return {}
    return request.get_json(silent=True) or {}


def current_user():
    uid = session.get("uid")
    if not uid:
        return None
    return db().execute("SELECT id,username,email FROM users WHERE id=?", (uid,)).fetchone()


def _stats(uid):
    con = db()
    q = con.execute("SELECT COUNT(*) c FROM questions WHERE author_id=?", (uid,)).fetchone()["c"]
    a = con.execute("SELECT COUNT(*) c FROM answers WHERE author_id=?", (uid,)).fetchone()["c"]
    ch = con.execute("SELECT COUNT(*) c FROM challenge_done WHERE user_id=?", (uid,)).fetchone()["c"]
    return {"points": 5 * q + 10 * a + 15 * ch, "questions": q, "answers": a, "challenges": ch}


def _challenge_ok(output, ch):
    """Ok se cada linha esperada aparecer na saída (aceita texto extra ao redor)."""
    return all(l in output for l in (x.strip() for x in ch["e"].split("\n") if x.strip()))


# Limitação simples de taxa (anti-spam/força-bruta) por IP/usuário, em memória.
_RL = {}


def _limit(key, n, window):
    now = time.time()
    hits = [t for t in _RL.get(key, ()) if now - t < window]
    if len(hits) >= n:
        _RL[key] = hits
        return False
    hits.append(now)
    _RL[key] = hits
    return True


# ----------------------------------------------------------------- API

@app.get("/api/health")
def health():
    return jsonify(ok=True)


@app.post("/api/auth/signup")
def signup():
    if not _limit("auth:%s" % request.remote_addr, 10, 300):
        return err("Muitas tentativas. Aguarde alguns minutos e tente de novo.", 429)
    d = js()
    email = str(d.get("email", "")).strip().lower()
    username = str(d.get("username", "")).strip()
    pw = str(d.get("password", ""))
    if not EMAIL_RE.match(email) or len(email) > 120:
        return err("Digite um e-mail válido, como nome@email.com.")
    if not USER_RE.match(username):
        return err("O nome de usuário precisa ter de 3 a 20 letras, números ou _.")
    if len(pw) < 8:
        return err("A senha precisa ter pelo menos 8 caracteres.")
    if len(pw) > 200:
        return err("Senha longa demais.")
    con = db()
    if con.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
        return err("Esse e-mail já tem conta. Use a aba Entrar.")
    if con.execute("SELECT 1 FROM users WHERE username=? COLLATE NOCASE", (username,)).fetchone():
        return err("Esse nome de usuário já está em uso.")
    cur = con.execute("INSERT INTO users(username,email,pw,created_at) VALUES(?,?,?,?)",
                      (username, email, generate_password_hash(pw), _now()))
    con.commit()
    session.clear()
    session["uid"] = cur.lastrowid
    session.permanent = True
    return jsonify(ok=True)


@app.post("/api/auth/login")
def login():
    if not _limit("auth:%s" % request.remote_addr, 10, 300):
        return err("Muitas tentativas. Aguarde alguns minutos e tente de novo.", 429)
    d = js()
    email = str(d.get("email", "")).strip().lower()
    pw = str(d.get("password", ""))
    row = db().execute("SELECT id,pw,username FROM users WHERE email=?", (email,)).fetchone()
    # Mensagem genérica: não revela se o e-mail existe.
    if not row or not check_password_hash(row["pw"], pw):
        return err("E-mail ou senha incorretos.", 401)
    session.clear()
    session["uid"] = row["id"]
    session.permanent = True
    return jsonify(ok=True)


@app.post("/api/auth/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.get("/api/me")
def me():
    u = current_user()
    if not u:
        return jsonify(user=None)
    out = {"user": u["username"], "email": u["email"]}
    out.update(_stats(u["id"]))
    return jsonify(out)


@app.get("/api/questions")
def list_questions():
    con = db()
    uid = session.get("uid")
    rows = con.execute(
        "SELECT q.id,q.kind,q.title,q.tags,q.body,q.code,q.resolved,q.base_votes,q.base_answers,"
        "q.created_at,u.username AS author FROM questions q LEFT JOIN users u ON u.id=q.author_id "
        "ORDER BY q.created_at DESC, q.id DESC LIMIT 300").fetchall()
    nv = {r["question_id"]: r["c"] for r in
          con.execute("SELECT question_id,COUNT(*) c FROM votes GROUP BY question_id")}
    mine = set()
    if uid:
        mine = {r["question_id"] for r in
                con.execute("SELECT question_id FROM votes WHERE user_id=?", (uid,))}
    ans = {}
    for r in con.execute(
            "SELECT a.question_id,a.text,u.username FROM answers a "
            "JOIN users u ON u.id=a.author_id ORDER BY a.id"):
        ans.setdefault(r["question_id"], []).append({"by": r["username"], "text": r["text"]})
    items = []
    for row in rows:
        items.append({
            "id": row["id"], "t": row["kind"], "ti": row["title"],
            "tags": json.loads(row["tags"]),
            "v": row["base_votes"] + nv.get(row["id"], 0),
            "a": row["base_answers"] + len(ans.get(row["id"], [])),
            "s": bool(row["resolved"]), "when": humanize(row["created_at"]),
            "p": row["body"], "c": row["code"], "by": row["author"],
            "ans": ans.get(row["id"], []), "my": row["id"] in mine,
        })
    return jsonify(items=items)


@app.post("/api/questions")
def create_question():
    u = current_user()
    if not u:
        return err("Entre ou crie uma conta para perguntar.", 401)
    if not _limit("ask:%d" % u["id"], 10, 3600):
        return err("Você já publicou várias perguntas em pouco tempo. Volte mais tarde.", 429)
    d = js()
    title = str(d.get("title", "")).strip()
    if len(title) < 10 or len(title) > 120:
        return err("O título precisa ter de 10 a 120 caracteres.")
    tags = []
    for raw in str(d.get("tags", "")).split(","):
        t = raw.strip().lower()
        if TAG_RE.match(t) and t not in tags and len(tags) < 4:
            tags.append(t)
    if not tags:
        tags = ["python"]
    code = str(d.get("code", ""))[:4000]
    con = db()
    cur = con.execute(
        "INSERT INTO questions(kind,title,tags,body,code,resolved,author_id,created_at)"
        " VALUES('pergunta',?,?,?,?,0,?,?)",
        (title, json.dumps(tags), "", code, u["id"], _now()))
    con.commit()
    return jsonify(item={
        "id": cur.lastrowid, "t": "pergunta", "ti": title, "tags": tags,
        "v": 0, "a": 0, "s": False, "when": "instantes", "p": "", "c": code,
        "by": u["username"], "ans": [], "my": False,
    })


@app.post("/api/questions/<int:qid>/vote")
def vote(qid):
    u = current_user()
    if not u:
        return err("Entre ou crie uma conta para votar.", 401)
    if not _limit("vote:%d" % u["id"], 60, 600):
        return err("Muitos votos em pouco tempo.", 429)
    con = db()
    row = con.execute("SELECT base_votes FROM questions WHERE id=?", (qid,)).fetchone()
    if not row:
        return err("Pergunta não encontrada.", 404)
    if con.execute("SELECT 1 FROM votes WHERE question_id=? AND user_id=?", (qid, u["id"])).fetchone():
        con.execute("DELETE FROM votes WHERE question_id=? AND user_id=?", (qid, u["id"]))
        my = False
    else:
        con.execute("INSERT INTO votes(question_id,user_id,created_at) VALUES(?,?,?)",
                    (qid, u["id"], _now()))
        my = True
    con.commit()
    total = con.execute("SELECT COUNT(*) c FROM votes WHERE question_id=?", (qid,)).fetchone()["c"]
    return jsonify(my=my, v=row["base_votes"] + total)


@app.post("/api/questions/<int:qid>/answers")
def answer(qid):
    u = current_user()
    if not u:
        return err("Entre ou crie uma conta para responder.", 401)
    if not _limit("ans:%d" % u["id"], 30, 600):
        return err("Muitas respostas em pouco tempo. Volte mais tarde.", 429)
    d = js()
    text = str(d.get("text", "")).strip()
    if len(text) < 5:
        return err("Escreva pelo menos 5 caracteres.")
    text = text[:1000]
    con = db()
    row = con.execute("SELECT base_answers FROM questions WHERE id=?", (qid,)).fetchone()
    if not row:
        return err("Pergunta não encontrada.", 404)
    con.execute("INSERT INTO answers(question_id,author_id,text,created_at) VALUES(?,?,?,?)",
                (qid, u["id"], text, _now()))
    con.commit()
    total = con.execute("SELECT COUNT(*) c FROM answers WHERE question_id=?", (qid,)).fetchone()["c"]
    return jsonify(answer={"by": u["username"], "text": text}, a=row["base_answers"] + total)


@app.post("/api/challenges")
def challenge():
    u = current_user()
    if not u:
        return err("Entre na conta para ganhar pontos no desafio.", 401)
    ch = CHS[int(time.time() // 86400) % len(CHS)]  # desafio do dia, pelo fuso UTC
    output = str(js().get("output", "")).strip()
    if not _challenge_ok(output, ch):
        return jsonify(correct=False)
    con = db()
    done = con.execute("SELECT 1 FROM challenge_done WHERE user_id=? AND challenge_id=?",
                       (u["id"], ch["id"])).fetchone()
    already = bool(done)
    if not done:
        con.execute("INSERT INTO challenge_done(user_id,challenge_id,created_at) VALUES(?,?,?)",
                    (u["id"], ch["id"], _now()))
        con.commit()
    out = {"user": u["username"], "email": u["email"]}
    out.update(_stats(u["id"]))
    return jsonify(correct=True, already=already, me=out)


# ------------------------------------------------------------ frontend

@app.get("/")
def home():
    return send_from_directory(FRONTEND, "index.html")


@app.get("/<path:fname>")
def asset(fname):
    return send_from_directory(FRONTEND, fname)


CSP = (
    "default-src 'self'; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src https://fonts.gstatic.com; "
    "script-src 'self' 'unsafe-eval' https://cdn.jsdelivr.net; "
    "connect-src 'self'; img-src 'self' data:; "
    "base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
)


@app.after_request
def security_headers(resp):
    h = resp.headers
    h.setdefault("Content-Security-Policy", CSP)
    h["X-Content-Type-Options"] = "nosniff"
    h["X-Frame-Options"] = "DENY"
    h["Referrer-Policy"] = "strict-origin-when-cross-origin"
    h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if request.path.startswith("/api"):
        h["Cache-Control"] = "no-store"
    return resp


@app.errorhandler(404)
def not_found(e):
    if request.path.startswith("/api"):
        return jsonify(error="Não encontrado."), 404
    return e


init_db()

if __name__ == "__main__":
    debug = os.environ.get("PYHUB_DEBUG") == "1"
    port = int(os.environ.get("PORT", 5000))
    app.run(host="127.0.0.1", port=port, debug=debug)
