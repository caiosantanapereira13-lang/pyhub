/* PyHub — painel admin (frontend/admin.js) */
var $ = function (i) { return document.getElementById(i) };

function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] }) }

function tbl(el, head, rows) {
  if (!rows.length) { el.innerHTML = '<tr><td class="mu">Nada ainda.</td></tr>'; return }
  el.innerHTML = '<tr>' + head.map(function (h) { return '<th class="wh">' + h + '</th>' }).join('') + '</tr>' +
    rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>' }).join('') + '</tr>' }).join('');
}

function load(k) {
  $("e").textContent = "";
  return fetch("/api/admin/stats", { method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: k }) })
  .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j } }) })
  .then(function (r) {
    if (!r.ok) { $("e").textContent = r.j.error || "Não foi possível carregar."; return }
    $("data").hidden = false; $("rf").hidden = false;
    var c = r.j.counts;
    $("cards").innerHTML = [["Usuários", c.users], ["Perguntas", c.questions], ["Respostas", c.answers], ["Votos", c.votes]]
      .map(function (x) { return '<div class="card"><b>' + x[1] + '</b><span>' + x[0] + '</span></div>' }).join("");
    tbl($("tq"), ["Título", "Tipo", "Autor", "Votos", "Quando"], r.j.questions.map(function (q) {
      return ['<b>' + esc(q.title) + '</b>', '<span class="k">' + esc(q.kind) + '</span>', esc(q.by), q.votes, q.when] }));
    tbl($("tu"), ["Usuário", "E-mail", "Entrou"], r.j.users.map(function (u) {
      return ['<b>' + esc(u.username) + '</b>', esc(u.email), u.when] }));
    tbl($("ta"), ["Autor", "Em", "Resposta", "Quando"], r.j.answers.map(function (a) {
      return ['<b>' + esc(a.by) + '</b>', esc(a.title), esc(a.text), a.when] }));
    tbl($("tv"), ["Usuário", "Votou em", "Quando"], r.j.votes.map(function (v) {
      return ['<b>' + esc(v.by) + '</b>', esc(v.title), v.when] }));
  }, function () { $("e").textContent = "Sem conexão com o servidor." });
}

$("go").addEventListener("click", function () { load($("key").value) });
$("rf").addEventListener("click", function () { load($("key").value) });
$("key").addEventListener("keydown", function (e) { if (e.key === "Enter") load(this.value) });
