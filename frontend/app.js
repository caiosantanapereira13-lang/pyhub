/* PyHub — frontend. Fala com a API do Flask (mesma origem). */
"use strict";
var $ = function (i) { return document.getElementById(i) };

/* ---------------- estado ---------------- */
var items = [], me = null, st = { tab: "todos", q: "", open: -1, sort: "" };

/* ---------------- utilidades ---------------- */
function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] }) }

function api(path, opt) {
  opt = opt || {};
  opt.method = opt.method || "GET";
  opt.headers = { "Content-Type": "application/json" };
  opt.credentials = "same-origin";
  return fetch(path, opt).then(function (r) {
    return r.json().then(function (j) { return { ok: r.ok, st: r.status, j: j } },
      function () { return { ok: r.ok, st: r.status, j: {} } });
  });
}

function refreshMe() {
  return api("/api/me").then(function (r) {
    me = r.j && r.j.user ? r.j : null;
    paint();
  }, function () { paint(); });
}

function toast(t) {
  var el = $("toast"); el.textContent = t; el.classList.add("on");
  clearTimeout(toast.t); toast.t = setTimeout(function () { el.classList.remove("on") }, 2600);
}

function find(id) { id = +id; return items.filter(function (x) { return x.id === id })[0] }

/* ---------------- renderização da lista ---------------- */
var tabs = [["todos", "Tudo"], ["erro", "Erros"], ["pergunta", "Perguntas"], ["tutorial", "Tutoriais"]];

function render() {
  $("tabs").innerHTML = tabs.map(function (x) {
    return '<button class="tab" data-t="' + x[0] + '" aria-pressed="' + (st.tab === x[0]) + '">' + x[1] +
      ' <span class="n">' + items.filter(function (i) { return x[0] === "todos" || i.t === x[0] }).length + '</span></button>';
  }).join("") + '<button class="tab srt" data-s="1">' + (st.sort === "v" ? "Mais votadas" : "Recentes") + ' ⇅</button>';
  var q = st.q.toLowerCase();
  var vis = items.filter(function (it) {
    return (st.tab === "todos" || it.t === st.tab) &&
      (!q || (it.ti + " " + it.tags.join(" ")).toLowerCase().indexOf(q) > -1);
  });
  if (st.sort === "v") vis = vis.slice().sort(function (a, b) { return b.v - a.v });
  var h = vis.map(function (it) {
    var o = st.open === it.id;
    var code = it.c ? '<div class="cb"><div class="cbh"><button data-cp>Copiar</button><button data-ed>Abrir no editor</button></div><pre><code>' + hi(it.c) + '</code></pre></div>' : "";
    var body = it.p
      ? '<p>' + esc(it.p) + '</p>' + code
      : '<p>Ninguém respondeu ainda. Seja o primeiro a ajudar.</p>' + code;
    return '<article class="card t-' + it.t + '"><button data-i="' + it.id + '" aria-expanded="' + o + '">' +
      '<div class="vote">' + it.v + '<small>votos</small></div><div><h2 class="ti">' + esc(it.ti) + '</h2><div class="meta"><span class="kind">' + it.t + '</span>' +
      it.tags.map(function (t) { return '<span class="tag">' + esc(t) + '</span>' }).join("") +
      '<span>' + it.a + ' respostas</span>' + (it.s ? '<span class="ok">✓ resolvido</span>' : '<span>sem solução ainda</span>') +
      '<span>' + (it.by ? 'por ' + esc(it.by) + ', ' : '') + 'há ' + it.when + '</span></div></div></button>' +
      (o ? '<div class="ans">' + body + extra(it) + '</div>' : '') + '</article>';
  }).join("");
  $("list").innerHTML = h || '<div class="empty">Nenhum resultado para esse erro.<br><br><button class="up" data-askbtn>Perguntar com o código do editor</button></div>';
}

function extra(it) {
  return '<div class="act"><button class="up" aria-pressed="' + (it.my ? "true" : "false") + '" data-v="' + it.id + '">▲ Útil · ' + it.v + '</button></div>' +
    (it.ans || []).map(function (a) { return '<div class="ua"><b>' + esc(a.by) + '</b>' + esc(a.text) + '</div>' }).join("") +
    '<textarea class="at" id="at-' + it.id + '" rows="3" placeholder="Escreva uma resposta…" aria-label="Sua resposta"></textarea>' +
    '<button class="up" data-send="' + it.id + '">Responder</button>';
}

$("tabs").addEventListener("click", function (e) {
  var t = e.target.closest("[data-t]");
  if (t) { st.tab = t.dataset.t; st.open = -1; render() }
  else if (e.target.closest("[data-s]")) { st.sort = st.sort === "v" ? "" : "v"; render() }
});

$("list").addEventListener("click", function (e) {
  var b = e.target.closest("[data-i]");
  if (b) { var i = +b.dataset.i; st.open = st.open === i ? -1 : i; render() }
});

$("q").addEventListener("input", function (e) { st.q = e.target.value; st.open = -1; render(); syncChips() });

/* ---------------- realce de sintaxe ---------------- */
var RX = /(#.*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|\b(def|class|import|from|return|if|elif|else|for|while|in|not|and|or|is|None|True|False|try|except|finally|with|as|lambda|pass|break|continue|raise|yield)\b|\b(print|len|range|int|str|float|list|dict|input|open)\b|\b(\d+(?:\.\d+)?)\b/g;
function hi(s) {
  var o = "", last = 0, m; RX.lastIndex = 0;
  while ((m = RX.exec(s))) {
    o += esc(s.slice(last, m.index));
    var c = m[1] ? "#6f829d" : m[2] ? "#7bd88f" : m[3] ? "#ffd43b" : m[4] ? "#7cb7ff" : "#ff9e64";
    o += '<span style="color:' + c + '">' + esc(m[0]) + '</span>';
    last = RX.lastIndex;
  }
  return o + esc(s.slice(last));
}

/* ---------------- editor ---------------- */
var ta = $("ta"), hl = $("hl"), gut = $("gut");
var EX = 'def saudacao(nome):\n    return f"Olá, {nome}!"\n\n# chame a função\nprint(saudacao("PyHub"))';

function upd() {
  var v = ta.value;
  try { localStorage.setItem("pyhub-code", v) } catch (e) { }
  hl.innerHTML = hi(v) + (v.slice(-1) === "\n" ? " " : "");
  var n = v.split("\n").length, g = "1";
  for (var i = 2; i <= n; i++) g += "\n" + i;
  gut.textContent = g;
}
ta.addEventListener("input", upd);
ta.addEventListener("keydown", function (e) {
  if (e.key === "Tab") { e.preventDefault(); ins("    ", ta.selectionStart, ta.selectionEnd) }
  else if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    var s = ta.selectionStart, b = ta.value.slice(0, s), ln = b.slice(b.lastIndexOf("\n") + 1), ind = ln.match(/^\s*/)[0];
    if (/:\s*$/.test(ln)) ind += "    ";
    ins("\n" + ind, s, ta.selectionEnd);
  }
});
$("ex").addEventListener("change", function () {
  var k = this.value; this.value = "";
  if (EXS[k]) { ta.value = EXS[k]; upd(); $("xp").hidden = true; outEl.className = "out"; outEl.textContent = "" }
});
$("cl").addEventListener("click", function () { ta.value = ""; upd(); ta.focus() });
$("cp").addEventListener("click", function () {
  var b = this;
  try { navigator.clipboard.writeText(ta.value) } catch (e) { ta.select(); document.execCommand("copy") }
  b.textContent = "Copiado"; setTimeout(function () { b.textContent = "Copiar" }, 1500);
});

/* ---------------- interpretador (Skulpt) ---------------- */
var SK = ["https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt.min.js", "https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt-stdlib.js"], skp = null;
function ld(u) { return new Promise(function (ok, no) { var s = document.createElement("script"); s.src = u; s.onload = ok; s.onerror = function () { no() }; document.head.appendChild(s) }) }
function loadSk() {
  if (window.Sk && Sk.builtinFiles) return Promise.resolve();
  if (!skp) skp = ld(SK[0]).then(function () { return ld(SK[1]) }).catch(function () { skp = null; throw { load: 1 } });
  return skp;
}
function bread(x) { if (!Sk.builtinFiles || Sk.builtinFiles["files"][x] === undefined) throw "File not found: '" + x + "'"; return Sk.builtinFiles["files"][x] }

var outEl = $("out"), rb = $("rn"), t0 = 0;
function run() {
  t0 = performance.now(); $("rt").textContent = "executando…"; $("xp").hidden = true; outEl.className = "out"; outEl.textContent = "Carregando o interpretador…"; rb.disabled = true;
  loadSk().then(function () {
    outEl.textContent = "";
    Sk.configure({ output: put, read: bread, __future__: Sk.python3, execLimit: 10000, inputfun: ask });
    return Sk.misceval.asyncToPromise(function () { return Sk.importMainWithBody("<stdin>", false, ta.value, true) });
  }).then(function () {
    if (!outEl.textContent) outEl.textContent = "(programa terminou sem imprimir nada)";
  }, function (err) {
    outEl.className = "out err";
    var m = err && err.load ? "Não consegui carregar o interpretador Python. Verifique a conexão e tente de novo." : String(err);
    outEl.textContent += (outEl.textContent ? "\n" : "") + m; explain(m);
  }).then(function () { rb.disabled = false; $("rt").textContent = ((performance.now() - t0) / 1000).toFixed(2) + " s"; if (chk) { chk = false; verify() } });
}
rb.addEventListener("click", run);
function put(t) { outEl.appendChild(document.createTextNode(t)); outEl.scrollTop = outEl.scrollHeight }
function ask(p) {
  return new Promise(function (res) {
    if (p) put(p);
    var i = document.createElement("input"); i.className = "inp";
    i.setAttribute("aria-label", "Digite e pressione Enter"); i.setAttribute("autocomplete", "off");
    outEl.appendChild(i); i.focus();
    i.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); var v = i.value; i.remove(); put(v + "\n"); res(v) } });
  });
}

/* ---------------- pares de caracteres ---------------- */
var PR = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'" };
ta.addEventListener("beforeinput", function (e) {
  var s = ta.selectionStart, en = ta.selectionEnd, v = ta.value, ch = e.data;
  if (e.inputType === "insertText" && ch && ch.length === 1) {
    if (")]}\"'".indexOf(ch) > -1 && s === en && v.charAt(en) === ch) { e.preventDefault(); ta.setSelectionRange(s + 1, s + 1); return }
    if (PR[ch]) {
      var pv = v.charAt(s - 1);
      if ((ch === '"' || ch === "'") && /\w/.test(pv) && !/[fFrRbBuU]/.test(pv)) return;
      e.preventDefault();
      if (s !== en) { ins(ch + v.slice(s, en) + PR[ch], s, en); ta.setSelectionRange(s + 1, en + 1) }
      else { ins(ch + PR[ch], s, en); ta.setSelectionRange(s + 1, s + 1) }
      upd();
    }
  } else if (e.inputType === "deleteContentBackward" && s === en && s > 0 && PR[v.charAt(s - 1)] && PR[v.charAt(s - 1)] === v.charAt(s)) {
    e.preventDefault(); ta.setSelectionRange(s - 1, s + 1);
    if (!document.execCommand("delete")) ta.setRangeText("", s - 1, s + 1, "end");
    upd();
  }
});
ta.addEventListener("keydown", function (e) { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); run() } });

var sv0 = null; try { sv0 = localStorage.getItem("pyhub-code") } catch (e) { }
ta.value = sv0 === null ? EX : sv0; upd();

function ins(t, s, e) {
  ta.setSelectionRange(s, e);
  var ok = false;
  try { ok = document.execCommand("insertText", false, t) } catch (x) { }
  if (!ok) ta.setRangeText(t, s, e, "end");
  upd();
}

/* ---------------- conta (API) ---------------- */
var dlg = $("dlg"), mode = "login";
function paint() {
  $("acc").textContent = me ? "Sair" : "Entrar";
  $("who").hidden = !me;
  if (me) { $("who").textContent = me.user + " · " + me.points + " pts"; $("who").dataset.i = me.user.charAt(0).toUpperCase() }
}
function msg(t) { $("fm").textContent = t }
function setMode(m) {
  mode = m; var su = m === "signup";
  $("sl").setAttribute("aria-pressed", !su); $("ss").setAttribute("aria-pressed", su);
  $("dt").textContent = su ? "Criar conta" : "Entrar";
  $("fs").textContent = su ? "Criar conta" : "Entrar";
  $("lu").hidden = !su;
  $("fp").setAttribute("autocomplete", su ? "new-password" : "current-password");
  msg("");
}
$("acc").addEventListener("click", function () {
  if (me) {
    api("/api/auth/logout", { method: "POST", body: "{}" }).then(function () { me = null; paint(); toast("Você saiu da conta.") });
  } else { setMode("login"); dlg.showModal(); $("fe").focus() }
});
$("sl").addEventListener("click", function () { setMode("login") });
$("ss").addEventListener("click", function () { setMode("signup") });
$("dx").addEventListener("click", function () { dlg.close() });
dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close() });

$("af").addEventListener("submit", function (e) {
  e.preventDefault();
  var em = $("fe").value.trim().toLowerCase(), pw = $("fp").value, us = $("fu").value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return msg("Digite um e-mail válido, como nome@email.com.");
  if (mode === "signup") {
    if (!/^[A-Za-z0-9_]{3,20}$/.test(us)) return msg("O nome de usuário precisa ter de 3 a 20 letras, números ou _.");
    if (pw.length < 8) return msg("A senha precisa ter pelo menos 8 caracteres.");
  } else if (!pw) return msg("Digite sua senha.");
  var path = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
  var body = mode === "signup" ? { username: us, email: em, password: pw } : { email: em, password: pw };
  api(path, { method: "POST", body: JSON.stringify(body) }).then(function (r) {
    if (!r.ok) return msg(r.j.error || "Não foi possível agora. Tente de novo.");
    return refreshMe().then(function () {
      dlg.close(); $("af").reset(); msg("");
      toast("Bem-vindo, " + me.user + "!");
    });
  }, function () { msg("Sem conexão com o servidor. Tente de novo.") });
});

/* ---------------- explicar erros ---------------- */
var EXS = { ola: 'print("Olá, PyHub!")', loop: 'for i in range(1, 6):\n    print("Linha", i)', funcao: 'def dobro(n):\n    return n * 2\n\nprint(dobro(21))', lista: 'frutas = ["maçã", "uva", "pera"]\nfrutas.append("manga")\nfor f in frutas:\n    print(f.upper())', input: 'nome = input("Seu nome: ")\nprint(f"Oi, {nome}!")', erro: 'idade = 15\nprint("Tenho " + idade + " anos")' };
var XP = { NameError: "Você usou um nome que ainda não existe. Confira se digitou igual (maiúsculas contam) e se criou a variável antes de usar.", SyntaxError: "O Python não entendeu como o código foi escrito. Procure parênteses, aspas ou dois-pontos faltando perto da linha indicada.", IndentationError: "A indentação (os espaços no começo da linha) está errada. Use 4 espaços e mantenha o mesmo tanto dentro do mesmo bloco.", TypeError: "Você misturou tipos que não combinam, como somar texto com número. Converta com str() ou int(), ou use f-string.", ZeroDivisionError: "Não dá pra dividir por zero. Confira o valor do divisor antes da conta.", IndexError: "Você pediu uma posição que não existe na lista. A contagem começa em 0 e o último item é len(lista) - 1.", KeyError: "Essa chave não existe no dicionário. Confira o nome ou use dicionario.get('chave').", ValueError: "O valor tem o tipo certo, mas o conteúdo não serve. Por exemplo, int('abc') não vira número.", AttributeError: "Esse objeto não tem esse método ou atributo. Confira o nome e o tipo da variável.", ImportError: "Esse módulo não foi encontrado. O editor roda só o básico do Python, sem bibliotecas externas." };
XP.ParseError = XP.SyntaxError; XP.ModuleNotFoundError = XP.ImportError;
XP.TimeLimitError = "O código passou do tempo limite (10 segundos). Confira se não há um loop infinito, como while True sem break.";
XP.RecursionError = "A função chamou a si mesma sem parar. Confira se ela tem uma condição de parada.";
XP.RangeError = XP.RecursionError;
function explain(m) {
  var t = (m.match(/(\w+Error)/) || [])[1], l = m.match(/line (\d+)/);
  if (t && XP[t]) { $("xp").textContent = "O que isso significa: " + XP[t] + (l ? " Veja a linha " + l[1] + "." : ""); $("xp").hidden = false }
}

/* ---------------- votos e respostas (API) ---------------- */
$("list").addEventListener("click", function (e) {
  var bv = e.target.closest("[data-v]"), bs = e.target.closest("[data-send]");
  if (!bv && !bs) return;
  if (!me) { setMode("login"); dlg.showModal(); msg("Entre ou crie uma conta para participar."); return }
  if (bv) {
    api("/api/questions/" + bv.dataset.v + "/vote", { method: "POST", body: "{}" }).then(function (r) {
      if (!r.ok) { toast(r.j.error || "Não foi possível votar."); return }
      var it = find(bv.dataset.v);
      if (it) { it.my = r.j.my; it.v = r.j.v }
      render(); paint(); refreshMe(); toast("Voto atualizado");
    });
  } else {
    var id = bs.dataset.send, ar = $("at-" + id), t = ar.value.trim();
    if (t.length < 5) { ar.placeholder = "Escreva pelo menos 5 caracteres."; ar.focus(); return }
    api("/api/questions/" + id + "/answers", { method: "POST", body: JSON.stringify({ text: t }) }).then(function (r) {
      if (!r.ok) { toast(r.j.error || "Não foi possível enviar."); return }
      var it = find(id);
      if (it) { it.ans.push(r.j.answer); it.a = r.j.a }
      render(); paint(); refreshMe(); toast("Resposta enviada! +10 pontos");
    });
  }
});

/* ---------------- perguntar (API) ---------------- */
var qd = $("qd");
$("pq").addEventListener("click", function () {
  if (!me) { setMode("login"); dlg.showModal(); msg("Entre ou crie uma conta para perguntar."); return }
  if (!ta.value.trim()) { outEl.className = "out err"; outEl.textContent = "Escreva um código no editor antes de perguntar."; return }
  $("qc").innerHTML = hi(ta.value); $("qm").textContent = ""; qd.showModal(); $("qti").focus();
});
$("qx").addEventListener("click", function () { qd.close() });
qd.addEventListener("click", function (e) { if (e.target === qd) qd.close() });
$("qf").addEventListener("submit", function (e) {
  e.preventDefault();
  var ti = $("qti").value.trim();
  if (ti.length < 10) { $("qm").textContent = "O título precisa ter pelo menos 10 caracteres."; return }
  api("/api/questions", { method: "POST", body: JSON.stringify({ title: ti, tags: $("qtg").value, code: ta.value }) }).then(function (r) {
    if (!r.ok) { $("qm").textContent = r.j.error || "Não foi possível publicar."; return }
    items.unshift(r.j.item); paint(); refreshMe();
    st.tab = "todos"; st.q = ""; $("q").value = ""; st.open = r.j.item.id; render(); syncChips();
    $("qf").reset(); qd.close(); toast("Pergunta publicada! +5 pontos");
    $("list").scrollIntoView({ behavior: "smooth" });
  });
});

/* ---------------- placeholder rotativo, chips, atalhos ---------------- */
var PH = ["Cole aqui o seu erro, ex: KeyError", "ModuleNotFoundError: No module named…", "IndentationError: unexpected indent", "TypeError: can only concatenate str…"], pi = 0;
if (!matchMedia("(prefers-reduced-motion: reduce)").matches) setInterval(function () {
  var q = $("q");
  if (document.activeElement !== q && !q.value) { pi = (pi + 1) % PH.length; q.placeholder = PH[pi] }
}, 2800);

var CH = ["KeyError", "IndentationError", "TypeError", "ModuleNotFoundError", "venv", "csv"];
$("chips").innerHTML = CH.map(function (c) { return '<button class="chip" data-c="' + c + '" aria-pressed="false">' + c + '</button>' }).join("");
function syncChips() {
  Array.prototype.forEach.call($("chips").children, function (b) {
    b.setAttribute("aria-pressed", String(st.q.toLowerCase() === b.dataset.c.toLowerCase()));
  });
}
$("chips").addEventListener("click", function (e) {
  var b = e.target.closest("[data-c]");
  if (!b) return;
  st.q = st.q === b.dataset.c ? "" : b.dataset.c; $("q").value = st.q; st.open = -1; render(); syncChips();
});
document.addEventListener("keydown", function (e) {
  if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $("q").focus() }
});

/* ---------------- perfil (API) ---------------- */
var LV = [["Iniciante", 0], ["Pythonista", 20], ["Mestre", 100]];
function BD(q, a, c, p) {
  return [["Primeira pergunta", q > 0], ["Primeira resposta", a > 0], ["Ajudante (3 respostas)", a > 2], ["Desafio vencido", c > 0], ["Pythonista", p >= 20]]
    .map(function (b) { return '<span' + (b[1] ? ' class="on"' : '') + '>' + b[0] + '</span>' }).join("");
}
$("list").addEventListener("click", function (e) { if (e.target.closest("[data-askbtn]")) $("pq").click() });

$("who").addEventListener("click", function () {
  if (!me) return;
  api("/api/me").then(function (r) {
    if (!(r.j && r.j.user)) return;
    me = r.j; paint();
    var p = me.points, i = p >= 100 ? 2 : p >= 20 ? 1 : 0, nx = LV[i + 1], lo = LV[i][1];
    var pc = nx ? Math.round((p - lo) / (nx[1] - lo) * 100) : 100;
    $("pb").innerHTML =
      '<div class="pf"><div class="av">' + esc(me.user.charAt(0).toUpperCase()) + '</div><div><strong>' + esc(me.user) + '</strong><span>' + LV[i][0] + ' · ' + p + ' pts</span></div></div>' +
      '<div class="bar2" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pc + '"><i style="width:' + pc + '%"></i></div>' +
      '<p class="note">' + (nx ? 'Faltam ' + (nx[1] - p) + ' pontos para ' + nx[0] + '.' : 'Você chegou ao nível máximo!') + '</p>' +
      '<ul class="st"><li><b>' + me.questions + '</b>perguntas</li><li><b>' + me.answers + '</b>respostas</li><li><b>' + me.challenges + '</b>desafios</li></ul>' +
      '<div class="bd">' + BD(me.questions, me.answers, me.challenges, p) + '</div>';
    $("pd").showModal();
  });
});
$("px").addEventListener("click", function () { $("pd").close() });
$("pd").addEventListener("click", function (e) { if (e.target === $("pd")) $("pd").close() });

/* ---------------- terminal animado ---------------- */
var TB = ['Traceback (most recent call last):', '  File "main.py", line 3, in <module>', "KeyError: 'nome'", '✓ resolvido por 3 pessoas no PyHub'], TC = ["d", "", "e", "g"];
(function () {
  var tb = document.querySelector(".tb");
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  tb.textContent = "";
  var li = 0, ci = 0, sp;
  function step() {
    if (li >= TB.length) return;
    if (ci === 0) { sp = document.createElement("span"); sp.className = TC[li]; tb.appendChild(sp) }
    sp.textContent = TB[li].slice(0, ++ci);
    if (ci >= TB[li].length) {
      if (li < TB.length - 1) tb.appendChild(document.createTextNode("\n"));
      li++; ci = 0; setTimeout(step, li === 3 ? 450 : 160);
    } else setTimeout(step, li === 3 ? 28 : 20);
  }
  setTimeout(step, 600);
})();

/* ---------------- desafio do dia (API) ---------------- */
var CHS = [
  { id: "c1", t: "Imprima a soma dos números de 1 a 10.", s: "# some de 1 a 10 e imprima o resultado\n", e: "55" },
  { id: "c2", t: "Imprima os números pares de 1 a 10, um por linha.", s: "# use um for com range\n", e: "2\n4\n6\n8\n10" },
  { id: "c3", t: "Imprima uma lista com os quadrados de 1 a 5.", s: "# dica: [n * n for n in range(1, 6)]\n", e: "[1, 4, 9, 16, 25]" },
  { id: "c4", t: "Imprima a palavra PyHub ao contrário.", s: 'palavra = "PyHub"\n# dica: palavra[::-1]\n', e: "buHyP" },
  { id: "c5", t: "Imprima o fatorial de 5 (5 x 4 x 3 x 2 x 1).", s: "# use um for ou um while\n", e: "120" }
];
function CHD() { return CHS[Math.floor(Date.now() / 864e5) % CHS.length] }
var chk = false;
$("chl").innerHTML = '<div><strong>★ Desafio do dia</strong><span>' + esc(CHD().t) + '</span></div><div class="chb"><button id="chload">Carregar no editor</button><button class="go" id="chv">Verificar</button></div>';
$("chload").addEventListener("click", function () { ta.value = CHD().s; upd(); $("xp").hidden = true; outEl.className = "out"; outEl.textContent = ""; ta.focus(); toast("Desafio carregado") });
$("chv").addEventListener("click", function () { chk = true; run() });

function chOk(c, got) {
  return c.e.split("\n").filter(function (l) { return l.trim() })
    .every(function (l) { return got.indexOf(l.trim()) > -1 });
}

function verify() {
  var c = CHD(), got = outEl.textContent.trim();
  if (!chOk(c, got)) { toast("Ainda não. Confira a saída e tente de novo."); return }
  if (!me) { toast("Certo! Entre na conta pra ganhar pontos."); return }
  api("/api/challenges", { method: "POST", body: JSON.stringify({ id: c.id, output: got }) }).then(function (r) {
    if (r.j.me) { me = r.j.me; paint() }
    toast(r.j.already ? "Certo! Você já ganhou os pontos deste desafio." : "Correto! +15 pontos");
  });
}

/* ---------------- copiar / abrir no editor ---------------- */
$("list").addEventListener("click", function (e) {
  var c = e.target.closest("[data-cp]"), o = e.target.closest("[data-ed]");
  if (!c && !o) return;
  var code = (c || o).closest(".cb").querySelector("code").textContent;
  if (c) {
    try {
      navigator.clipboard.writeText(code).then(function () { toast("Código copiado") }, function () { toast("Não consegui copiar") });
    } catch (er) { toast("Não consegui copiar") }
  } else {
    ta.value = code; upd(); $("xp").hidden = true; outEl.className = "out"; outEl.textContent = "";
    document.querySelector(".edw").scrollIntoView({ behavior: "smooth" }); toast("Código aberto no editor");
  }
});

/* ---------------- tema ---------------- */
var root = document.documentElement;
try { var sv = localStorage.getItem("pyhub-theme"); if (sv) root.dataset.theme = sv } catch (e) { }
$("theme").textContent = root.dataset.theme === "dark" ? "☀" : "☾";
$("theme").addEventListener("click", function () {
  var n = root.dataset.theme === "dark" ? "light" : "dark";
  root.dataset.theme = n; this.textContent = n === "dark" ? "☀" : "☾";
  try { localStorage.setItem("pyhub-theme", n) } catch (e) { }
});

/* ---------------- inicialização ---------------- */
$("list").classList.add("enter");
setTimeout(function () { $("list").classList.remove("enter") }, 1400);
render();
refreshMe();
api("/api/questions").then(function (r) {
  if (r.ok && r.j.items) items = r.j.items;
  render();
});
