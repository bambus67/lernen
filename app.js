/* Klausurtrainer: eine App, viele Klausuren. Inhalte liegen in klausuren/<id>.json (Format siehe CLAUDE.md). */
(function () {
"use strict";
const app = document.getElementById("app");
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let K = null;          // aktuelle Klausur
let INDEX = null;      // Liste aller Klausuren
let S = null;          // Lernstand dieser Klausur (nur dieses Gerät)
let view = "home", param = null;

const has = (key) => {
  if (!K) return false;
  if (key === "zuordnen") return !!(K.zuordnen && K.zuordnen.items && K.zuordnen.items.length);
  return Array.isArray(K[key]) && K[key].length > 0;
};
const topics = () => K.themen || [];
const topicName = (id) => (topics().find((t) => t.id === id) || { name: id === "all" ? "Überblick" : "Alle Themen" }).name;
const inTopic = (t) => !S || S.topic === "all" || t === S.topic || t === "all";

/* ---------- Datum ---------- */
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
function parseDate(d) { if (!d) return null; const p = d.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function daysUntil(d) { const t = parseDate(d); if (!t) return null; const n = new Date(); n.setHours(0, 0, 0, 0); return Math.round((t - n) / 86400000); }
function fmtDate(d) { const t = parseDate(d); if (!t) return ""; return WD[t.getDay()] + ", " + t.getDate() + "." + (t.getMonth() + 1) + "." + t.getFullYear(); }
function countdown(d) {
  const n = daysUntil(d); if (n === null) return "";
  if (n < 0) return "vorbei"; if (n === 0) return "heute"; if (n === 1) return "morgen"; return "in " + n + " Tagen";
}

/* ---------- Speicher ---------- */
function loadState(id) {
  const base = { xp: 0, blitzBest: 0, topic: "all", stats: {}, quellen: {}, klausur: {}, learned: {} };
  try { const raw = localStorage.getItem("kt:" + id); if (raw) return Object.assign(base, JSON.parse(raw)); } catch (e) {}
  // Übernahme aus der ersten Version der Kalter-Krieg-App
  try { if (id === "geschichte-kalter-krieg") { const old = localStorage.getItem("kk-trainer-v1"); if (old) return Object.assign(base, JSON.parse(old)); } } catch (e) {}
  return base;
}
function save() { if (!K || !S) return; try { localStorage.setItem("kt:" + K.id, JSON.stringify(S)); } catch (e) {} }
function addXP(n) { if (!n) return; S.xp += n; save(); const p = $("#xp-pill"); if (p) p.textContent = S.xp + " Punkte"; }
function stat(t, ok) { if (!t || t === "all") return; const s = S.stats[t] || (S.stats[t] = { r: 0, n: 0 }); s.n++; if (ok) s.r++; save(); }

/* ---------- Laden und Routing ---------- */
async function getJSON(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}
async function loadIndex() { if (!INDEX) { try { INDEX = await getJSON("klausuren/index.json"); } catch (e) { INDEX = []; } } return INDEX; }
function parseHash() { return location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent); }
function hashFor(v, p) { return "#/" + K.id + (v === "home" ? "" : "/" + v + (p ? "/" + encodeURIComponent(p) : "")); }
function go(v, p) {
  const h = hashFor(v, p);
  if (location.hash === h) route(); else location.hash = h;
}
async function route() {
  stopBlitz();
  const parts = parseHash();
  if (!parts.length) { K = null; window.scrollTo(0, 0); return renderLanding(); }
  if (SITE_PAGES.includes(parts[0])) { K = null; window.scrollTo(0, 0); return renderSite(parts[0]); }
  const id = parts[0];
  if (!K || K.id !== id) {
    app.innerHTML = '<div class="wrap" style="padding-block:40px"><p class="empty-note">Lade Klausur …</p></div>';
    try { K = await getJSON("klausuren/" + encodeURIComponent(id) + ".json"); }
    catch (e) { K = null; return renderSite("klausuren", "Diese Klausur gibt es nicht (mehr)."); }
    S = loadState(K.id);
    quiz = blitz = zeit = kette = karten = lern = null; qstate = {}; kstate = {};
    const f = K.farben || [];
    document.documentElement.style.setProperty("--ca", f[0] || "var(--signal)");
    document.documentElement.style.setProperty("--cb", f[1] || f[0] || "var(--signal)");
    document.title = K.titel + " · Klausurtrainer";
  }
  view = parts[1] || "home"; param = parts[2] || null;
  if (view === "home" || view === "lernplan") fromPlan = false;
  render(); window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);

/* ---------- Startseite und Übersichtsseiten ---------- */
// "#/" = Startseite mit "Los geht's", "#/klausuren", "#/kalender", "#/updates" = eigene Seiten (diese ids sind für Klausuren gesperrt)
const SITE_PAGES = ["klausuren", "kalender", "updates"];
let UPDATES = null, cal = null;
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const pad2 = (n) => String(n).padStart(2, "0");
function ymd(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
const todayStr = () => ymd(new Date());
function addDays(ds, n) { const d = parseDate(ds); d.setDate(d.getDate() + n); return ymd(d); }
const examTitle = (k) => k.fach + (k.titel && k.titel !== "Thema folgt" ? ", " + k.titel : "");
// für Punkte auf Schwarz die hellere der beiden Fächerfarben
const lum = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); if (!m) return 0; const n = parseInt(m[1], 16); return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255); };
const examColor = (k) => { const f = k.farben || []; if (!f.length) return "var(--muted)"; return f.length > 1 && lum(f[1]) > lum(f[0]) ? f[1] : f[0]; };
async function loadUpdates() { if (!UPDATES) { try { UPDATES = await getJSON("updates.json"); } catch (e) { UPDATES = []; } } return UPDATES; }
const upcoming = (list) => list.filter((k) => (daysUntil(k.datum) ?? 1) >= 0).sort((a, b) => (a.datum || "").localeCompare(b.datum || ""));

function siteShell(active) {
  document.title = active === "start" ? "Klausurtrainer" : TITLES_SITE[active] + " · Klausurtrainer";
  document.body.classList.add("on-home");
  document.documentElement.style.removeProperty("--ca"); document.documentElement.style.removeProperty("--cb");
  return navHTML(active);
}
function navHTML(active) {
  return '<nav class="topnav"><div class="wrap"><a class="brand" href="#/">Klausurtrainer</a><div class="links">' +
    SITE_PAGES.map((p) => '<a href="#/' + p + '"' + (p === active ? ' aria-current="page"' : "") + ">" + TITLES_SITE[p] + "</a>").join("") +
    '</div><a class="btn primary small cta-nav" href="#/klausuren">Los geht\'s →</a></div></nav>';
}
const TITLES_SITE = { klausuren: "Klausuren", kalender: "Kalender", updates: "Updates" };
const siteFoot = '<footer class="foot wrap">Inhalte nach Tafelbildern und Unterrichtsmaterial, aufbereitet mit Claude. Fehler entdeckt? Sag Bescheid.</footer>';

async function renderLanding() {
  const head = siteShell("start");
  const list = await loadIndex();
  const up = upcoming(list), next = up[0];
  app.innerHTML = head +
    '<main class="landing"><section class="hero wrap">' +
    "<h1>Lern für deine<br>nächste Klausur.</h1>" +
    '<p class="sub">Lernkarten, Quiz, Lernpläne und Klausurfragen für unsere Klausuren. Nur mit dem Stoff aus dem Unterricht.</p>' +
    '<div class="cta"><a class="btn primary lg" href="#/klausuren">Los geht\'s →</a><a class="btn lg" href="#/kalender">Zum Kalender</a></div>' +
    '<p class="meta">Kostenlos · ' + list.length + (list.length === 1 ? " Klausur" : " Klausuren") + " · kein Konto nötig · von Dschibrael</p>" +
    '<div class="install" id="install"></div></section>' +
    '<section class="wrap"><div class="device" id="device">' +
    (next ? '<div class="dev-bar"><span>' + esc(examTitle(next)) + "</span><span>Klausur " + countdown(next.datum) + "</span></div>" : "") +
    '<div class="dev-body" id="dev-body"><p class="empty-note">Lade …</p></div></div>' +
    '<p class="dev-note" id="dev-note"></p></section>' +
    '<section class="wrap features">' +
    "<div><h3>Lernplan</h3><p>Sag, wann du Zeit hast. Du bekommst einen Plan bis zur Klausur, Tag für Tag.</p></div>" +
    "<div><h3>Üben wie in der Klausur</h3><p>Quiz, Karteikarten, Ursache-Folge-Ketten, Quellen und Klausurfragen mit Musterlösung.</p></div>" +
    "<div><h3>Bleibt bei dir</h3><p>Kein Konto, kein Tracking. Dein Fortschritt liegt nur auf deinem Gerät.</p></div>" +
    "</section></main>" + siteFoot;
  renderInstall();
  renderPreview(up);
}
async function renderPreview(up) {
  // echte Frage aus der nächsten Klausur, die schon ein Quiz hat
  const body = $("#dev-body"), note = $("#dev-note");
  let ex = null;
  for (const k of up.slice(0, 4)) {
    try { const full = await getJSON("klausuren/" + encodeURIComponent(k.id) + ".json"); if (full.quiz && full.quiz.length) { ex = full; break; } } catch (e) {}
  }
  if (!body) return;
  if (!ex) {
    body.innerHTML = up.length ? '<div class="dev-list">' + up.slice(0, 4).map((k) => '<a href="#/' + encodeURIComponent(k.id) + '"><span>' + esc(examTitle(k)) + "</span><span>" + fmtDate(k.datum) + "</span></a>").join("") + "</div>" : '<p class="empty-note">Gerade steht keine Klausur an.</p>';
    return;
  }
  const bar = $(".dev-bar span", $("#device")); if (bar) bar.textContent = examTitle(ex);
  const q = ex.quiz[Math.floor(Math.random() * ex.quiz.length)];
  const opts = shuffle([q.a].concat(q.falsch));
  const draw = (picked) => {
    body.innerHTML = '<p class="dev-q">' + esc(q.q) + '</p><div class="dev-opts">' + opts.map((o, i) => {
      let cls = ""; if (picked !== null) { if (o === q.a) cls = " right"; else if (i === picked) cls = " wrong"; }
      return '<button type="button" class="dev-opt' + cls + '" data-i="' + i + '"' + (picked !== null ? " disabled" : "") + '><span class="radio"></span><span>' + esc(o) + "</span></button>";
    }).join("") + "</div>" +
      (picked !== null ? '<div class="dev-fb"><b>' + (opts[picked] === q.a ? "Richtig." : "Nicht ganz.") + "</b> " + esc(q.e || "") + '</div><div class="btn-row" style="margin-top:14px"><a class="btn primary small" href="#/' + encodeURIComponent(ex.id) + '">Weiter lernen →</a><button class="btn small" type="button" id="dev-again">Andere Frage</button></div>' : "");
    $$(".dev-opt", body).forEach((b) => (b.onclick = () => draw(+b.dataset.i)));
    const again = $("#dev-again"); if (again) again.onclick = () => renderPreview(up);
  };
  draw(null);
  if (note) note.textContent = "Probier's aus: eine echte Frage aus dem Quiz.";
}

async function renderSite(page, msg) {
  const head = siteShell(page);
  const [list, ups] = await Promise.all([loadIndex(), loadUpdates()]);
  let body = "";
  if (page === "klausuren") {
    const up = upcoming(list);
    const old = list.filter((k) => (daysUntil(k.datum) ?? 1) < 0).sort((a, b) => (b.datum || "").localeCompare(a.datum || ""));
    body = '<header class="page-head"><h1>Anstehende Klausuren</h1><p>Wähl eine Klausur zum Lernen oder lass dir einen Lernplan machen.</p></header>' +
      (msg ? '<p class="fb bad"><b>' + esc(msg) + "</b>Hier sind alle verfügbaren Klausuren.</p>" : "") +
      (up.length ? '<div class="exams">' + up.map((k, i) => examCard(k, false, i === 0)).join("") + "</div>" : '<div class="empty-big">Gerade steht keine Klausur an.</div>') +
      (old.length ? '<header class="page-head sub-head"><h2>Archiv</h2><p>Zum Wiederholen vor dem Abi.</p></header><div class="exams">' + old.map((k) => examCard(k, true, false)).join("") + "</div>" : "");
  } else if (page === "kalender") {
    body = '<header class="page-head"><h1>Kalender</h1><p>Alle Klausurtermine. Tipp auf einen Termin, um die Klausur zu öffnen.</p></header><div id="cal"></div>';
  } else {
    const known = new Set(list.map((k) => k.id));
    const news = (ups || []).slice().sort((a, b) => (b.datum || "").localeCompare(a.datum || "")).slice(0, 5);
    body = '<header class="page-head"><h1>Updates</h1><p>Was zuletzt neu dazugekommen ist.</p></header>' +
      (news.length ? '<ul class="updates">' + news.map((u) => '<li><span class="ud">' + fmtDate(u.datum) + '</span><span class="ut">' + esc(u.text) + "</span>" +
        (u.klausur && known.has(u.klausur) ? '<a href="#/' + encodeURIComponent(u.klausur) + '">Öffnen →</a>' : "") + "</li>").join("") + "</ul>" : '<p class="empty-note">Noch keine Updates.</p>');
  }
  app.innerHTML = head + '<main class="wrap site">' + body + "</main>" + siteFoot;
  if (page === "kalender") { if (!cal) { const n = new Date(); cal = { y: n.getFullYear(), m: n.getMonth() }; } renderCal(); }
}
function examCard(k, isOld, isNext) {
  const d = daysUntil(k.datum), id = encodeURIComponent(k.id);
  const cd = d === null || d < 0 ? "" : '<span class="cd">' + (d === 0 ? "<b>Heute</b>" : d === 1 ? "<b>Morgen</b>" : "<b>" + d + "</b> Tage") + "</span>";
  return '<article class="exam' + (isOld ? " old" : "") + (isNext ? " next" : "") + '">' +
    '<div class="exam-top"><span class="kicker"><i class="dot" style="background:' + esc(examColor(k)) + '"></i>' + esc(k.fach) + (k.kurs ? " · " + esc(k.kurs) : "") + "</span>" + (isNext ? '<span class="next-tag">Als Nächstes</span>' : "") + "</div>" +
    "<h3>" + esc(k.titel) + "</h3>" +
    (k.beschreibung ? "<p>" + esc(k.beschreibung) + "</p>" : "") +
    (k.datum ? '<div class="when-row"><span class="when' + (d !== null && d >= 0 && d <= 3 ? " soon" : "") + '">' + fmtDate(k.datum) + "</span>" + cd + "</div>" : "") +
    '<div class="exam-actions"><a class="btn small primary" href="#/' + id + '">Lernen</a><a class="btn small" href="#/' + id + '/lernplan">Lernplan</a></div>' +
    "</article>";
}

/* ---------- Kalender ---------- */
function renderCal() {
  const el = $("#cal"); if (!el) return;
  const list = INDEX || [];
  const y = cal.y, m = cal.m, t = todayStr();
  const startOff = (new Date(y, m, 1).getDay() + 6) % 7, nd = new Date(y, m + 1, 0).getDate();
  const byDay = {};
  list.forEach((k) => { if (k.datum) (byDay[k.datum] = byDay[k.datum] || []).push(k); });
  let cells = "";
  for (let i = 0; i < startOff; i++) cells += '<div class="cday pad"></div>';
  for (let d = 1; d <= nd; d++) {
    const ds = y + "-" + pad2(m + 1) + "-" + pad2(d), ex = byDay[ds] || [];
    const cls = "cday" + (ds === t ? " today" : "") + (ds < t ? " past" : "") + (ex.length ? " has" : "");
    const inner = '<span class="dn">' + d + "</span>" + ex.map((k) => '<span class="cev" style="--c:' + esc(examColor(k)) + '">' + esc(k.fach) + "</span>").join("");
    cells += ex.length
      ? '<a class="' + cls + '" href="#/' + encodeURIComponent(ex[0].id) + '" title="' + esc(ex.map(examTitle).join(" / ")) + '">' + inner + "</a>"
      : '<div class="' + cls + '">' + inner + "</div>";
  }
  const pre = y + "-" + pad2(m + 1) + "-";
  const inMonth = list.filter((k) => k.datum && k.datum.startsWith(pre)).sort((a, b) => a.datum.localeCompare(b.datum));
  const n = new Date(), isNow = n.getFullYear() === y && n.getMonth() === m;
  el.innerHTML =
    '<div class="cal-head"><button class="btn small" type="button" data-cal="-1" aria-label="Voriger Monat">‹</button>' +
    "<h3>" + MONTHS[m] + " " + y + "</h3>" +
    '<button class="btn small" type="button" data-cal="1" aria-label="Nächster Monat">›</button>' +
    '<button class="btn small" type="button" data-cal="0"' + (isNow ? " disabled" : "") + ">Heute</button></div>" +
    '<div class="cal-grid">' + ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((w) => '<div class="wd">' + w + "</div>").join("") + cells + "</div>" +
    '<div class="cal-list">' + (inMonth.length ? inMonth.map((k) =>
      '<div class="cal-row' + (k.datum < t ? " past" : "") + '"><a class="cal-what" href="#/' + encodeURIComponent(k.id) + '"><span class="dot" style="background:' + esc(examColor(k)) + '"></span><span><b>' + fmtDate(k.datum) + "</b> " + esc(examTitle(k)) + "</span></a>" +
      '<button class="btn small" type="button" data-ics="' + esc(k.id) + '">In meinen Kalender</button></div>').join("")
      : '<p class="empty-note">In diesem Monat steht keine Klausur an.</p>') + "</div>";
  $$("[data-cal]", el).forEach((b) => (b.onclick = () => {
    const s = +b.dataset.cal;
    if (s === 0) { const d = new Date(); cal = { y: d.getFullYear(), m: d.getMonth() }; }
    else { const d = new Date(cal.y, cal.m + s, 1); cal = { y: d.getFullYear(), m: d.getMonth() }; }
    renderCal();
  }));
  $$("[data-ics]", el).forEach((b) => (b.onclick = () => downloadICS(list.find((k) => k.id === b.dataset.ics))));
}
function downloadICS(k) {
  if (!k || !k.datum) return;
  const icsEsc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const url = location.href.split("#")[0] + "#/" + encodeURIComponent(k.id);
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Klausurtrainer//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT", "UID:" + k.id + "@klausurtrainer", "DTSTAMP:" + now,
    "DTSTART;VALUE=DATE:" + k.datum.replace(/-/g, ""), "DTEND;VALUE=DATE:" + addDays(k.datum, 1).replace(/-/g, ""),
    "SUMMARY:" + icsEsc("Klausur: " + examTitle(k)), "DESCRIPTION:" + icsEsc("Lernen: " + url), "URL:" + url, "TRANSP:TRANSPARENT",
    "END:VEVENT", "END:VCALENDAR", ""
  ].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  a.download = "klausur-" + k.id + ".ics";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

/* ---------- Als App installieren ---------- */
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; renderInstall(); });
function renderInstall() {
  const el = $("#install"); if (!el) return;
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  if (standalone) return;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (deferredPrompt) {
    el.innerHTML = '<button class="btn signal" id="inst" type="button">Als App auf dem Handy installieren</button>';
    el.classList.add("show");
    $("#inst").onclick = async () => { deferredPrompt.prompt(); try { await deferredPrompt.userChoice; } catch (e) {} deferredPrompt = null; el.classList.remove("show"); };
  } else if (ios) {
    el.innerHTML = '<p class="lede" style="color:var(--band-fg)">Tipp: In Safari auf <b>Teilen</b> und dann <b>Zum Home-Bildschirm</b> tippen, dann hast du den Trainer wie eine App.</p>';
    el.classList.add("show");
  }
}

/* ---------- Seiten einer Klausur ---------- */
const TITLES = { lernplan: "Lernplan", lernen: "Lernen", quiz: "Quiz", blitz: "Zuordnen", zeit: "Zeitstrahl", kette: "Ursache → Folge", karten: "Karteikarten", quellen: "Quellen", quelle: "Quellen", klausur: "Klausurfragen" };
function render() {
  document.body.classList.toggle("on-home", view === "home");
  if (view === "home" || !TITLES[view]) { view = "home"; return renderHome(); }
  app.innerHTML =
    '<div class="topbar"><div class="wrap">' +
    '<button class="back" id="back" type="button">← ' + (fromPlan ? "Lernplan" : view === "quelle" ? "Alle Quellen" : "Übersicht") + "</button>" +
    '<div class="mtitle">' + (view === "blitz" && K.zuordnen ? esc(K.zuordnen.titel || "Zuordnen") : TITLES[view]) + "</div>" +
    '<span class="pill" id="xp-pill">' + S.xp + " Punkte</span></div></div>" +
    '<main class="stage" id="stage"></main>';
  $("#back").onclick = () => (fromPlan ? go("lernplan") : view === "quelle" ? go("quellen") : go("home"));
  ({ lernplan: renderPlan, lernen: renderLernen, quiz: renderQuiz, blitz: renderBlitz, zeit: renderZeit, kette: renderKette, karten: renderKarten, quellen: renderQuellen, quelle: renderQuelle, klausur: renderKlausur })[view]();
}
const stage = () => $("#stage");

function renderHome() {
  const n = (arr, f) => (arr || []).filter(f).length;
  const done = Object.keys(S.quellen).length;
  const learnedCount = (K.lernen || []).filter((l) => S.learned[l.t]).length;
  const chips = topics().length ? [{ id: "all", name: "Alle Themen" }].concat(topics())
    .map((t) => '<button class="chip" type="button" data-topic="' + esc(t.id) + '" aria-pressed="' + (S.topic === t.id) + '">' + esc(t.name) + "</button>").join("") : "";
  const card = (id, cls, kicker, title, text, left, right) =>
    '<button class="mode ' + cls + '" type="button" data-go="' + id + '"><span class="kicker">' + kicker + "</span><h3>" + title + "</h3><p>" + text + '</p><span class="meta"><span>' + left + "</span><span>" + right + "</span></span></button>";
  const train = [];
  if (planReady()) { const pi = planCardInfo(); train.push(card("lernplan", "plan", "Dein Fahrplan bis zur Klausur", "Lernplan", S.plan ? "Deine Aufgaben für heute und die nächsten Tage. Jede Aufgabe führt direkt in den passenden Modus." : "Sag, an welchen Tagen und wie lange du lernst, und du bekommst einen Plan bis zur Klausur.", pi[0], pi[1])); }
  if (has("lernen")) train.push(card("lernen", "learn", "Erst verstehen", "Lernen", "Alle Inhalte als Lernkarten zum Durchblättern, ohne Punkte und ohne Druck. Danach direkt testen.", K.lernen.length + " Themen", learnedCount + " gelesen"));
  if (has("quellen")) train.push(card("quellen", "train", "Quellenarbeit", "Quellen-Training", "Quellenauszüge mit Einordnungsfragen, Klausuraufgaben und Erwartungshorizont zum Abhaken.", n(K.quellen, (q) => inTopic(q.t)) + " Quellen", done + " bearbeitet"));
  if (has("klausur")) train.push(card("klausur", "train", "Offene Fragen", "Klausurfragen", "Mögliche Aufgaben mit Operatoren. Erst selbst antworten, dann mit der Musterlösung vergleichen.", n(K.klausur, (q) => inTopic(q.t)) + " Fragen", "mit Musterlösung"));
  const games = [];
  if (has("quiz")) games.push(["quiz", "Wissen", "Quiz", "Zehn Fragen mit Erklärung nach jeder Antwort.", n(K.quiz, (q) => inTopic(q.t)) + " Fragen im Pool", "+10 pro Treffer"]);
  if (has("zuordnen")) games.push(["blitz", "Tempo", esc(K.zuordnen.titel || "Zuordnen"), "60 Sekunden: Begriffe so schnell wie möglich der richtigen Seite zuordnen.", "Fehler kosten 3 s", "Rekord " + S.blitzBest]);
  if (has("zeitstrahl")) games.push(["zeit", "Reihenfolge", "Zeitstrahl", "Fünf Ereignisse in die richtige Reihenfolge bringen. Die Jahre siehst du erst danach.", K.zeitstrahl.length + " Ereignisse", "+4 pro Platz"]);
  if (has("ketten")) games.push(["kette", "Zusammenhänge", "Ursache und Folge", "Ursache-Folge-Ketten in die richtige Reihenfolge bringen.", n(K.ketten, (k) => inTopic(k.t)) + " Ketten", "+4 pro Glied"]);
  if (has("karten")) games.push(["karten", "Begriffe und Personen", "Karteikarten", "Umdrehen, prüfen, aussortieren, bis alle sitzen.", n(K.karten, (k) => inTopic(k.t)) + " Karten", "+2 pro Karte"]);
  // Raster: 3 pro Reihe, eine angefangene Reihe wird auf ganze Breite verteilt
  const rem = games.length % 3;
  const gamesHTML = games.map((g, i) => {
    let cls = "";
    if (rem === 2 && i >= games.length - 2) cls = "wide";
    if (rem === 1 && i === games.length - 1) cls = "full";
    return card(g[0], cls, g[1], g[2], g[3], g[4], g[5]);
  }).join("");
  const stats = '<div class="stats"><div><b>' + S.xp + "</b><span>Lernpunkte</span></div>" +
    (has("zuordnen") ? "<div><b>" + S.blitzBest + "</b><span>Zuordnen-Rekord</span></div>" : "") +
    (has("quellen") ? "<div><b>" + done + "/" + K.quellen.length + "</b><span>Quellen bearbeitet</span></div>" : "") + "</div>";
  app.innerHTML = navHTML("klausuren") +
    '<header class="band"><div class="wrap">' +
    '<div><a class="back" href="#/klausuren" style="color:var(--band-muted);text-decoration:none;font-weight:500;font-size:.9rem">← Alle Klausuren</a></div>' +
    '<div class="kicker">' + esc(K.fach) + (K.kurs ? " · " + esc(K.kurs) : "") + "</div>" +
    '<h1 class="title">' + esc(K.titel) + (K.datum ? "<span>Klausur " + fmtDate(K.datum) + " · " + countdown(K.datum) + "</span>" : "") + "</h1>" +
    (K.beschreibung ? '<p class="lede">' + esc(K.beschreibung) + "</p>" : "") + (train.length || games.length ? stats : "") +
    '</div><div class="curtain" aria-hidden="true"><i></i><i></i></div></header>' +
    '<div class="wrap home">' +
    (chips ? '<section><div class="sec-head"><h2>Thema</h2><p>Filtert alle Modi auf ein Thema.</p></div><div class="chips">' + chips + "</div></section>" : "") +
    (!train.length && !games.length ? '<section><div class="empty-big">Für diese Klausur gibt es noch keinen Lernstoff. Er kommt dazu, sobald das Material aus dem Unterricht da ist.</div></section>' : "") +
    (train.length ? '<section><div class="sec-head"><h2>Lernen und Klausurtraining</h2><p>Erst verstehen, dann so üben, wie es in der Klausur drankommt.</p></div><div class="grid-train">' + train.join("") + "</div></section>" : "") +
    (games.length ? '<section><div class="sec-head"><h2>Spielmodi</h2><p>Zum Wiederholen zwischendurch.</p></div><div class="games">' + gamesHTML + "</div></section>" : "") +
    (topics().length ? '<section class="duo"><div class="panel"><h3>Dein Stand</h3>' + progressHTML() + '</div><div class="panel"><h3>Gespeichert</h3><p class="hint" style="margin:0">Dein Fortschritt liegt nur in diesem Browser auf diesem Gerät. Niemand sonst sieht ihn.</p><div class="btn-row"><button class="btn small" id="reset" type="button">Fortschritt zurücksetzen</button></div><p class="hint" id="reset-q" hidden>Wirklich alles für diese Klausur löschen? <button class="btn small" id="reset-yes" type="button">Ja, löschen</button></p></div></section>' : "") +
    "</div>";
  $$("[data-topic]").forEach((b) => (b.onclick = () => { S.topic = b.dataset.topic; save(); const y = window.scrollY; renderHome(); window.scrollTo(0, y); }));
  $$("[data-go]").forEach((b) => (b.onclick = () => start(b.dataset.go)));
  const wb = $("#weak-btn"); if (wb) wb.onclick = () => { S.topic = wb.dataset.t; save(); start("quiz"); };
  const rs = $("#reset"); if (rs) rs.onclick = () => { $("#reset-q").hidden = false; };
  const ry = $("#reset-yes"); if (ry) ry.onclick = () => { try { localStorage.removeItem("kt:" + K.id); localStorage.removeItem("kk-trainer-v1"); } catch (e) {} S = loadState(K.id); renderHome(); };
}
function progressHTML() {
  let weakest = null;
  const rows = topics().map((t) => {
    const s = S.stats[t.id];
    if (!s || !s.n) return '<div class="barrow"><span>' + esc(t.name) + '</span><span class="track"></span><span class="pct">–</span></div>';
    const p = Math.round((s.r / s.n) * 100);
    if (s.n >= 3 && (!weakest || p < weakest.p)) weakest = { t: t, p: p };
    const c = p < 50 ? "low" : p < 75 ? "mid" : "high";
    return '<div class="barrow"><span>' + esc(t.name) + '</span><span class="track"><i class="' + c + '" style="width:' + p + '%"></i></span><span class="pct">' + p + " %</span></div>";
  }).join("");
  const any = topics().some((t) => S.stats[t.id] && S.stats[t.id].n);
  let foot = any ? "" : '<p class="hint">Trefferquote aus Quiz und Quellenfragen. Spiel eine Runde, dann füllt sich das.</p>';
  if (weakest && weakest.p < 80 && has("quiz")) foot = '<p class="hint">Am meisten Luft nach oben: <b>' + esc(weakest.t.name) + '</b>.</p><div class="btn-row"><button class="btn small" id="weak-btn" type="button" data-t="' + esc(weakest.t.id) + '">Quiz zu ' + esc(weakest.t.name) + "</button></div>";
  return '<div class="bars">' + rows + "</div>" + foot;
}
function start(mode) {
  if (mode === "lernplan") planForm = null;
  if (mode === "lernen") lern = null;
  if (mode === "quiz") { newQuiz(); }
  if (mode === "blitz") blitz = { state: "intro" };
  if (mode === "zeit") { zeit = null; newZeit(); }
  if (mode === "kette") kette = null;
  if (mode === "karten") karten = null;
  go(mode);
}

/* ---------- Lernmodus ---------- */
let lern = null;
function renderLernen() {
  if (!lern) { let ti = K.lernen.findIndex((l) => l.t === S.topic); if (ti < 0) ti = 0; lern = { ti: ti, ci: 0, done: false }; }
  const L = K.lernen[lern.ti];
  const terms = (K.karten || []).filter((k) => k.t === L.t);
  const total = L.cards.length + (terms.length ? 1 : 0);
  const picker = '<div class="picker">' + K.lernen.map((l, i) => '<button class="chip" type="button" data-l="' + i + '" aria-pressed="' + (i === lern.ti) + '">' + esc(l.name) + (S.learned[l.t] ? " ✓" : "") + "</button>").join("") + "</div>";
  let main;
  if (lern.done) {
    const nextL = K.lernen[(lern.ti + 1) % K.lernen.length];
    const ki = (K.ketten || []).findIndex((k) => k.t === L.t);
    main = '<div class="result lcard"><div class="kicker">' + esc(L.name) + '</div><div class="big">Gelesen</div><p>Jetzt prüfen, ob es sitzt. Was du gerade gelesen hast, bleibt besser hängen, wenn du es direkt abrufst.</p><div class="btn-row">' +
      (L.t !== "all" && has("quiz") ? '<button class="btn signal" type="button" data-then="quiz">Quiz zu ' + esc(L.name) + "</button>" : "") +
      (L.t !== "all" && has("karten") && terms.length ? '<button class="btn" type="button" data-then="karten">Karteikarten</button>' : "") +
      (ki >= 0 ? '<button class="btn" type="button" data-then="kette">Kette ordnen</button>' : "") +
      '</div><div class="btn-row" style="margin-top:8px">' + (K.lernen.length > 1 ? '<button class="btn primary" type="button" id="nextTopic">Weiter mit ' + esc(nextL.name) + "</button>" : "") + '<button class="btn" type="button" id="reread">Nochmal lesen</button></div></div>';
  } else if (lern.ci < L.cards.length) {
    const c = L.cards[lern.ci];
    main = '<article class="lcard' + (c.big ? " big" : "") + '" id="lcard"><div class="kicker">' + esc(L.name) + " · Karte " + (lern.ci + 1) + " von " + total + "</div><h2>" + esc(c.h) + "</h2>" +
      (c.big ? '<p class="lmerk">' + esc(c.p[0]) + "</p>" : "<ul>" + c.p.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>") +
      (c.tag ? '<p class="ltag">' + esc(c.tag) + "</p>" : "") + "</article>";
  } else {
    main = '<article class="lcard" id="lcard"><div class="kicker">' + esc(L.name) + " · Karte " + total + " von " + total + '</div><h2>Begriffe und Personen</h2><dl class="terms">' + terms.map((k) => "<dt>" + esc(k.begriff) + "</dt><dd>" + esc(k.erklaerung) + "</dd>").join("") + "</dl></article>";
  }
  let nav = "";
  if (!lern.done) {
    const dots = '<div class="dots" aria-hidden="true">' + Array.from({ length: total }, (_, i) => '<i class="' + (i === lern.ci ? "on" : i < lern.ci ? "seen" : "") + '"></i>').join("") + "</div>";
    nav = '<div class="lnav"><button class="btn" id="prev" type="button"' + (lern.ci === 0 ? " disabled" : "") + '>← Zurück</button>' + dots + '<button class="btn primary" id="nextl" type="button">' + (lern.ci === total - 1 ? "Fertig" : "Weiter →") + "</button></div>" +
      '<p class="keys">Pfeiltasten zum Blättern, auf dem Handy wischen</p>';
  }
  stage().innerHTML = (K.lernen.length > 1 ? '<div class="col-h">Thema</div>' + picker : "") + main + nav;
  $$("[data-l]", stage()).forEach((b) => (b.onclick = () => { lern = { ti: +b.dataset.l, ci: 0, done: false }; renderLernen(); }));
  const p = $("#prev"); if (p) p.onclick = () => lernStep(-1);
  const nx = $("#nextl"); if (nx) nx.onclick = () => lernStep(1);
  const nt = $("#nextTopic"); if (nt) nt.onclick = () => { lern = { ti: (lern.ti + 1) % K.lernen.length, ci: 0, done: false }; renderLernen(); window.scrollTo(0, 0); };
  const rr = $("#reread"); if (rr) rr.onclick = () => { lern.ci = 0; lern.done = false; renderLernen(); };
  $$("[data-then]", stage()).forEach((b) => (b.onclick = () => {
    const m = b.dataset.then;
    if (L.t !== "all") { S.topic = L.t; save(); }
    if (m === "kette") { kette = null; newKette((K.ketten || []).findIndex((k) => k.t === L.t)); go("kette"); return; }
    start(m);
  }));
  const card = $("#lcard");
  if (card) {
    let x0 = null;
    card.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    card.addEventListener("touchend", (e) => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 50) lernStep(dx < 0 ? 1 : -1); });
  }
}
function lernStep(d) {
  if (!lern || lern.done) return;
  const L = K.lernen[lern.ti];
  const total = L.cards.length + ((K.karten || []).some((k) => k.t === L.t) ? 1 : 0);
  const ni = lern.ci + d;
  if (ni < 0) return;
  if (ni >= total) { lern.done = true; if (!S.learned[L.t]) { S.learned[L.t] = true; save(); addXP(5); } }
  else lern.ci = ni;
  renderLernen();
}

/* ---------- Quiz ---------- */
let quiz = null;
function newQuiz() {
  const pool = K.quiz.filter((q) => inTopic(q.t));
  quiz = { items: shuffle(pool).slice(0, 10).map((q) => ({ t: q.t, q: q.q, c: q.a, o: shuffle([q.a].concat(q.falsch)), e: q.e || "" })), i: 0, right: 0, picked: null, missed: [] };
}
function renderQuiz() {
  if (!quiz) newQuiz();
  const it = quiz.items[quiz.i];
  if (!it) return renderQuizEnd();
  const answered = quiz.picked !== null;
  const opts = it.o.map((o, k) => {
    let cls = "";
    if (answered) { if (o === it.c) cls = "right"; else if (k === quiz.picked) cls = "wrong"; }
    return '<button class="opt ' + cls + '" type="button" data-k="' + k + '"' + (answered ? " disabled" : "") + '><span class="key">' + (k + 1) + "</span><span>" + esc(o) + "</span></button>";
  }).join("");
  const ok = answered && it.o[quiz.picked] === it.c;
  stage().innerHTML =
    '<div class="progress"><i style="width:' + (quiz.i / quiz.items.length) * 100 + '%"></i></div>' +
    '<div class="qmeta"><span class="tag">' + esc(topicName(it.t)) + "</span><span>Frage " + (quiz.i + 1) + " von " + quiz.items.length + "</span></div>" +
    '<h2 class="q">' + esc(it.q) + '</h2><div class="opts">' + opts + "</div>" +
    (answered ? '<div class="fb ' + (ok ? "ok" : "bad") + '"><b>' + (ok ? "Richtig." : "Nicht ganz.") + "</b>" + esc(it.e) + '</div><div class="btn-row"><button class="btn primary" id="next" type="button">' + (quiz.i + 1 < quiz.items.length ? "Weiter" : "Auswertung") + "</button></div>" : "");
  $$(".opt", stage()).forEach((b) => (b.onclick = () => pickQuiz(+b.dataset.k)));
  const nx = $("#next"); if (nx) { nx.onclick = () => { quiz.i++; quiz.picked = null; renderQuiz(); }; nx.focus(); }
}
function pickQuiz(k) {
  if (quiz.picked !== null) return;
  const it = quiz.items[quiz.i];
  quiz.picked = k;
  const ok = it.o[k] === it.c;
  stat(it.t, ok);
  if (ok) { quiz.right++; addXP(10); } else quiz.missed.push(it);
  renderQuiz();
}
function renderQuizEnd() {
  const n = quiz.items.length;
  const verdict = quiz.right === n ? "Fehlerfrei." : quiz.right >= n * 0.7 ? "Sitzt schon gut." : "Da geht noch was.";
  stage().innerHTML =
    '<div class="result"><div class="kicker">' + esc(topicName(S.topic)) + '</div><div class="big">' + quiz.right + " / " + n + "</div><p><b>" + verdict + "</b> " + quiz.right * 10 + " Lernpunkte für diese Runde.</p>" +
    (quiz.missed.length ? '<h3 class="step-h">Nochmal anschauen</h3><ul class="review">' + quiz.missed.map((m) => "<li><b>" + esc(m.q) + '</b><span class="ans">' + esc(m.c) + "</span><br>" + esc(m.e) + "</li>").join("") + "</ul>" : "") +
    '<div class="btn-row"><button class="btn primary" id="again" type="button">Neue Runde</button><button class="btn" id="home" type="button">Zur Übersicht</button></div></div>';
  $("#again").onclick = () => { newQuiz(); renderQuiz(); window.scrollTo(0, 0); };
  $("#home").onclick = () => go("home");
}

/* ---------- Zuordnen (Blitzrunde) ---------- */
let blitz = null, blitzTimer = null;
function stopBlitz() { if (blitzTimer) { clearInterval(blitzTimer); blitzTimer = null; } }
function renderBlitz() {
  const Z = K.zuordnen;
  if (!blitz) blitz = { state: "intro" };
  if (blitz.state === "intro") {
    stage().innerHTML =
      '<div class="intro"><div class="kicker">60 Sekunden</div><h2 class="q" style="margin:0">' + esc(Z.frage || "Welche Seite?") + "</h2>" +
      "<p>Ordne die Begriffe so schnell wie möglich " + esc(Z.a.label) + " oder " + esc(Z.b.label) + " zu. Jede richtige Antwort ist ein Punkt, jeder Fehler kostet drei Sekunden.</p>" +
      '<p class="hint">Am Laptop: Pfeiltaste links = ' + esc(Z.a.label) + ", rechts = " + esc(Z.b.label) + ".</p>" +
      '<div class="btn-row"><button class="btn signal" id="go" type="button">Start</button></div>' +
      (S.blitzBest ? '<p class="hint">Dein Rekord: ' + S.blitzBest + " Punkte</p>" : "") + "</div>";
    $("#go").onclick = runBlitz;
    return;
  }
  if (blitz.state === "run") {
    stage().innerHTML =
      '<div class="blitz-head"><div><div class="kicker">Zeit</div><div class="blitz-time" id="bl-time">60.0</div></div><div class="blitz-score"><div class="kicker">Punkte</div><b id="bl-score">' + blitz.score + "</b></div></div>" +
      '<div class="progress" style="margin:12px 0 0"><i id="bl-bar" style="width:100%"></i></div>' +
      '<div class="blitz-card" id="bl-card" aria-live="polite"></div>' +
      '<div class="sides"><button class="side w" type="button" data-s="a">' + esc(Z.a.label) + "<small>" + esc(Z.a.sub || "") + '</small></button><button class="side o" type="button" data-s="b">' + esc(Z.b.label) + "<small>" + esc(Z.b.sub || "") + "</small></button></div>" +
      '<p class="keys">← ' + esc(Z.a.label) + " · " + esc(Z.b.label) + " →</p>";
    $$(".side").forEach((b) => (b.onclick = () => answerBlitz(b.dataset.s)));
    showBlitzCard();
    return;
  }
  const uniq = [];
  blitz.wrong.forEach((w) => { if (!uniq.some((u) => u[0] === w[0])) uniq.push(w); });
  stage().innerHTML =
    '<div class="result"><div class="kicker">Zeit abgelaufen</div><div class="big">' + blitz.score + "</div><p>" + (blitz.newBest ? "<b>Neuer Rekord.</b> " : "Rekord: " + S.blitzBest + ". ") + blitz.score * 2 + " Lernpunkte.</p>" +
    (uniq.length ? '<h3 class="step-h">Verwechselt</h3><ul class="review">' + uniq.map((w) => "<li><b>" + esc(w[0]) + '</b><span class="ans">gehört zu ' + esc(w[1] === "a" ? Z.a.label : Z.b.label) + "</span></li>").join("") + "</ul>" : "") +
    '<div class="btn-row"><button class="btn signal" id="again" type="button">Nochmal</button><button class="btn" id="home" type="button">Zur Übersicht</button></div></div>';
  $("#again").onclick = runBlitz; $("#home").onclick = () => go("home");
}
function runBlitz() {
  stopBlitz();
  blitz = { state: "run", deck: shuffle(K.zuordnen.items), i: 0, score: 0, wrong: [], end: Date.now() + 60000 };
  renderBlitz();
  blitzTimer = setInterval(tickBlitz, 100);
}
function tickBlitz() {
  const left = blitz.end - Date.now();
  if (left <= 0) return finishBlitz();
  const t = $("#bl-time"); if (t) t.textContent = (left / 1000).toFixed(1);
  const b = $("#bl-bar"); if (b) b.style.width = Math.max(0, left / 600) + "%";
}
function showBlitzCard() { const c = $("#bl-card"); if (c) c.textContent = blitz.deck[blitz.i][0]; }
function answerBlitz(side) {
  if (!blitz || blitz.state !== "run") return;
  const cur = blitz.deck[blitz.i];
  const ok = side === cur[1];
  if (ok) blitz.score++; else { blitz.wrong.push(cur); blitz.end -= 3000; }
  blitz.i++;
  if (blitz.i >= blitz.deck.length) { blitz.deck = shuffle(K.zuordnen.items); blitz.i = 0; }
  const sc = $("#bl-score"); if (sc) sc.textContent = blitz.score;
  const card = $("#bl-card");
  if (card) { card.classList.remove("ok", "bad"); void card.offsetWidth; card.classList.add(ok ? "ok" : "bad"); setTimeout(() => card.classList.remove("ok", "bad"), 220); }
  showBlitzCard(); tickBlitz();
}
function finishBlitz() {
  stopBlitz();
  blitz.state = "end";
  blitz.newBest = blitz.score > S.blitzBest;
  if (blitz.newBest) { S.blitzBest = blitz.score; save(); }
  addXP(blitz.score * 2);
  renderBlitz();
}

/* ---------- Reihenfolge-Spiele ---------- */
function orderHTML(st, labels) {
  const pool = st.items.filter((x) => st.placed.indexOf(x.id) < 0);
  const slots = st.items.map((_, i) => {
    const id = st.placed[i];
    if (!id) return '<li><div class="empty">Platz ' + (i + 1) + "</div></li>";
    const it = st.items.find((x) => x.id === id);
    let cls = "";
    if (st.checked) cls = st.correct[i] === id ? "right" : "wrong";
    return '<li><button class="item ' + cls + '" type="button" data-rm="' + id + '"' + (st.checked ? " disabled" : "") + ">" + (st.checked && it.year ? '<span class="yr">' + esc(it.year) + "</span>" : "") + esc(it.text) + "</button></li>";
  }).join("");
  return '<div class="order"><div><div class="col-h">' + labels[0] + '</div><div class="pool">' +
    (pool.length ? pool.map((x) => '<button class="item" type="button" data-add="' + x.id + '">' + esc(x.text) + "</button>").join("") : '<p class="empty-note">Alles eingeordnet.</p>') +
    '</div></div><div><div class="col-h">' + labels[1] + '</div><ol class="seq">' + slots + "</ol></div></div>";
}
function bindOrder(st, rerender) {
  $$("[data-add]", stage()).forEach((b) => (b.onclick = () => { st.placed.push(b.dataset.add); rerender(); }));
  $$("[data-rm]", stage()).forEach((b) => (b.onclick = () => { if (st.checked) return; st.placed = st.placed.filter((x) => x !== b.dataset.rm); rerender(); }));
}

let zeit = null;
function newZeit() {
  const picks = [], used = {};
  shuffle(K.zeitstrahl).forEach((e) => { if (picks.length < 5 && !used[e.jahr]) { used[e.jahr] = 1; picks.push(e); } });
  const items = picks.map((e, i) => ({ id: "z" + i, text: e.text, year: e.jahr, t: e.t }));
  zeit = { round: zeit ? zeit.round + 1 : 1, total: zeit ? zeit.total : 0, items: items, placed: [], checked: false, correct: items.slice().sort((a, b) => a.year - b.year).map((x) => x.id) };
}
function renderZeit() {
  if (!zeit) newZeit();
  const z = zeit, n = z.items.length;
  let after = "";
  if (z.checked) {
    const hits = z.placed.filter((id, i) => z.correct[i] === id).length;
    after = '<div class="fb ' + (hits === n ? "ok" : "bad") + '"><b>' + hits + " von " + n + " an der richtigen Stelle.</b>" + (hits === n ? "Perfekt, +5 Bonus." : "Richtige Reihenfolge:") + "</div>" +
      (hits === n ? "" : '<div class="solution"><ol>' + z.correct.map((id) => { const it = z.items.find((x) => x.id === id); return '<li><span class="yr">' + esc(it.year) + "</span>" + esc(it.text) + "</li>"; }).join("") + "</ol></div>") +
      '<div class="btn-row"><button class="btn primary" id="nextz" type="button">Nächste Runde</button><button class="btn" id="home" type="button">Zur Übersicht</button></div>';
  }
  stage().innerHTML =
    '<div class="qmeta"><span class="tag">Runde ' + z.round + "</span><span>" + z.total + " Punkte in dieser Sitzung</span></div>" +
    '<h2 class="q">Bring die Ereignisse in die richtige Reihenfolge, vom frühesten zum spätesten.</h2>' +
    '<p class="hint" style="margin-top:-8px">Antippen zum Einordnen, nochmal antippen zum Zurücklegen.</p>' +
    orderHTML(z, ["Ereignisse", "Deine Reihenfolge"]) +
    (z.checked ? after : '<div class="btn-row"><button class="btn primary" id="check" type="button"' + (z.placed.length < n ? " disabled" : "") + ">Prüfen</button></div>");
  bindOrder(z, renderZeit);
  const ch = $("#check"); if (ch) ch.onclick = () => {
    z.checked = true;
    const hits = z.placed.filter((id, i) => z.correct[i] === id).length;
    const pts = hits * 4 + (hits === n ? 5 : 0);
    z.total += pts; addXP(pts); renderZeit();
  };
  const nz = $("#nextz"); if (nz) nz.onclick = () => { newZeit(); renderZeit(); window.scrollTo(0, 0); };
  const h = $("#home"); if (h) h.onclick = () => go("home");
}

let kette = null;
function newKette(idx) {
  const k = K.ketten[idx];
  const items = k.schritte.map((s, i) => ({ id: "k" + i, text: s }));
  kette = { idx: idx, items: shuffle(items), placed: [], checked: false, correct: items.map((x) => x.id) };
}
function renderKette() {
  const list = K.ketten.map((k, i) => ({ k: k, i: i })).filter((o) => inTopic(o.k.t));
  if (!list.length) { stage().innerHTML = '<p class="empty-note">Zu diesem Thema gibt es keine Kette.</p>'; return; }
  if (!kette || !list.some((o) => o.i === kette.idx)) newKette(list[0].i);
  const k = K.ketten[kette.idx], st = kette;
  const picker = '<div class="picker">' + list.map((o) => '<button class="chip" type="button" data-k="' + o.i + '" aria-pressed="' + (o.i === st.idx) + '">' + esc(o.k.titel) + "</button>").join("") + "</div>";
  let after = "";
  if (st.checked) {
    const hits = st.placed.filter((id, i) => st.correct[i] === id).length;
    const all = hits === st.items.length;
    after = '<div class="fb ' + (all ? "ok" : "bad") + '"><b>' + (all ? "Kette stimmt." : hits + " von " + st.items.length + " Gliedern richtig.") + "</b>" + esc(k.merk || "") + "</div>" +
      (all ? "" : '<div class="solution"><div class="eh-head">So hängt es zusammen</div><ol class="chain">' + k.schritte.map((s) => "<li>" + esc(s) + "</li>").join("") + "</ol></div>") +
      '<div class="btn-row"><button class="btn primary" id="retry" type="button">Nochmal mischen</button>' + (list.length > 1 ? '<button class="btn" id="nextk" type="button">Nächste Kette</button>' : "") + "</div>";
  }
  stage().innerHTML =
    (list.length > 1 ? '<div class="col-h">Kette wählen</div>' + picker : "") +
    '<h2 class="q">' + esc(k.titel) + ": Was führt wozu?</h2>" +
    '<p class="hint" style="margin-top:-8px">Ordne die Glieder von der Ursache bis zur Folge.</p>' +
    orderHTML(st, ["Glieder", "Ursache → Folge"]) +
    (st.checked ? after : '<div class="btn-row"><button class="btn primary" id="check" type="button"' + (st.placed.length < st.items.length ? " disabled" : "") + ">Prüfen</button></div>");
  bindOrder(st, renderKette);
  $$(".picker [data-k]", stage()).forEach((b) => (b.onclick = () => { newKette(+b.dataset.k); renderKette(); }));
  const ch = $("#check"); if (ch) ch.onclick = () => {
    st.checked = true;
    const hits = st.placed.filter((id, i) => st.correct[i] === id).length;
    addXP(hits * 4 + (hits === st.items.length ? 10 : 0));
    renderKette();
  };
  const r = $("#retry"); if (r) r.onclick = () => { newKette(st.idx); renderKette(); };
  const nk = $("#nextk"); if (nk) nk.onclick = () => { const pos = list.findIndex((o) => o.i === st.idx); newKette(list[(pos + 1) % list.length].i); renderKette(); window.scrollTo(0, 0); };
}

/* ---------- Karteikarten ---------- */
let karten = null;
function newKarten(type) {
  const deck = shuffle(K.karten.map((c, i) => i).filter((i) => inTopic(K.karten[i].t) && (type === "all" || K.karten[i].typ === type)));
  karten = { type: type, deck: deck, total: deck.length, known: 0, flipped: false };
}
function renderKarten() {
  if (!karten) newKarten("all");
  const kt = karten;
  const hasPersons = K.karten.some((c) => c.typ === "person");
  const seg = hasPersons ? '<div class="seg" role="group">' + [["all", "Alle"], ["begriff", "Begriffe"], ["person", "Personen"]].map((o) => '<button type="button" data-type="' + o[0] + '" aria-pressed="' + (kt.type === o[0]) + '">' + o[1] + "</button>").join("") + "</div>" : "";
  if (!kt.deck.length) {
    stage().innerHTML = seg + '<div class="result" style="margin-top:18px"><div class="kicker">' + esc(topicName(S.topic)) + '</div><div class="big">' + (kt.total ? "Alle sitzen" : "Keine Karten") + "</div><p>" + (kt.total ? kt.total + " Karten gewusst." : "Für diese Auswahl gibt es keine Karten.") + '</p><div class="btn-row"><button class="btn primary" id="again" type="button">Stapel neu mischen</button><button class="btn" id="home" type="button">Zur Übersicht</button></div></div>';
    bindSeg(); $("#again").onclick = () => { newKarten(kt.type); renderKarten(); }; $("#home").onclick = () => go("home");
    return;
  }
  const c = K.karten[kt.deck[0]];
  stage().innerHTML = seg +
    '<div class="qmeta" style="margin-top:16px"><span class="tag">' + esc(topicName(c.t)) + "</span><span>" + kt.known + " von " + kt.total + " gewusst</span></div>" +
    '<div class="progress" style="margin-top:10px"><i style="width:' + (kt.known / kt.total) * 100 + '%"></i></div>' +
    '<div class="flash' + (kt.flipped ? " flipped" : "") + '"><div class="flash-inner" id="card" role="button" tabindex="0" aria-label="Karte umdrehen">' +
    '<div class="face front"><span class="kicker">' + (c.typ === "person" ? "Person" : "Begriff") + '</span><div class="term">' + esc(c.begriff) + '</div><span class="hint" style="margin:0">Erklär es dir selbst, dann umdrehen.</span></div>' +
    '<div class="face back"><span class="kicker">' + esc(c.begriff) + "</span><p>" + esc(c.erklaerung) + "</p></div></div></div>" +
    (kt.flipped ? '<div class="btn-row"><button class="btn" id="again" type="button">Nochmal</button><button class="btn primary" id="known" type="button">Gewusst</button></div>'
      : '<div class="btn-row"><button class="btn primary" id="flip" type="button">Umdrehen</button></div>') +
    '<p class="keys">Leertaste = umdrehen · 1 = nochmal · 2 = gewusst</p>';
  bindSeg();
  const flip = () => { kt.flipped = !kt.flipped; renderKarten(); };
  $("#card").onclick = flip;
  $("#card").onkeydown = (e) => { if (e.key === "Enter") flip(); };
  const f = $("#flip"); if (f) f.onclick = flip;
  const a = $("#again"); if (a) a.onclick = () => { kt.deck.push(kt.deck.shift()); kt.flipped = false; renderKarten(); };
  const kn = $("#known"); if (kn) kn.onclick = () => { kt.deck.shift(); kt.known++; kt.flipped = false; addXP(2); renderKarten(); };
}
function bindSeg() { $$(".seg [data-type]", stage()).forEach((b) => (b.onclick = () => { newKarten(b.dataset.type); renderKarten(); })); }

/* ---------- Quellen ---------- */
let qstate = {};
function renderQuellen() {
  const list = K.quellen.filter((q) => inTopic(q.t));
  stage().innerHTML =
    '<div class="kicker">' + esc(topicName(S.topic)) + '</div><h2 class="q" style="margin-top:6px">Quellen analysieren wie in der Klausur</h2>' +
    '<p class="hint" style="margin-top:-6px">Jede Quelle hat schnelle Einordnungsfragen und Klausuraufgaben mit Erwartungshorizont.</p>' +
    '<div class="src-list" style="margin-top:16px">' +
    (list.length ? list.map((q) => '<button class="src" type="button" data-id="' + esc(q.id) + '"><h3>' + esc(q.titel) + "</h3><p>" + esc(String(q.autor).split(",")[0]) + " · " + esc(q.art) + " · " + esc(topicName(q.t)) + "</p>" + (S.quellen[q.id] ? '<span class="done">Bearbeitet</span>' : "") + "</button>").join("") : '<p class="empty-note">Zu diesem Thema gibt es keine Quelle.</p>') +
    "</div>";
  $$(".src", stage()).forEach((b) => (b.onclick = () => go("quelle", b.dataset.id)));
}
function renderQuelle() {
  const q = K.quellen.find((x) => x.id === param);
  if (!q) return go("quellen");
  if (!qstate[q.id]) qstate[q.id] = { mc: (q.mc || []).map((m) => ({ o: shuffle([m.a].concat(m.falsch)), p: null })), open: {}, checks: {}, notes: {} };
  const st = qstate[q.id], rec = S.quellen[q.id] || {};
  const mcHTML = (q.mc || []).map((m, i) => {
    const s = st.mc[i];
    return '<div class="mini"><p class="qq">' + (i + 1) + ". " + esc(m.q) + '</p><div class="opts">' + s.o.map((o, k) => {
      let cls = ""; if (s.p !== null) { if (o === m.a) cls = "right"; else if (k === s.p) cls = "wrong"; }
      return '<button class="opt ' + cls + '" type="button" data-mc="' + i + '" data-k="' + k + '"' + (s.p !== null ? " disabled" : "") + '><span class="key">' + "ABCD"[k] + "</span><span>" + esc(o) + "</span></button>";
    }).join("") + "</div></div>";
  }).join("");
  const tasksHTML = (q.aufgaben || []).map((t, i) => {
    const awarded = rec.tasks && rec.tasks[i] !== undefined;
    let eh = "";
    if (st.open[i]) {
      eh = '<div class="eh-head">Erwartungshorizont: Was hast du drin?</div><ul class="eh">' + t.eh.map((p, j) => '<li><label><input type="checkbox" data-t="' + i + '" data-j="' + j + '"' + (st.checks[i + "-" + j] ? " checked" : "") + "><span>" + esc(p) + "</span></label></li>").join("") + "</ul>" +
        (awarded ? '<span class="awarded">Ausgewertet: ' + rec.tasks[i] + " von " + t.eh.length + " Punkten</span>" : '<div><button class="btn small primary" type="button" data-eval="' + i + '">Auswerten</button></div>');
    }
    return '<div class="task"><div><span class="tag op">' + esc(t.op) + '</span></div><p class="qq">' + esc(t.q) + "</p>" +
      '<textarea id="note-' + esc(q.id) + "-" + i + '" data-note="' + i + '" placeholder="Deine Stichpunkte (werden nicht gespeichert)">' + esc(st.notes[i] || "") + "</textarea>" +
      (st.open[i] ? eh : '<div><button class="btn small" type="button" data-open="' + i + '">Erwartungshorizont zeigen</button></div>') + "</div>";
  }).join("");
  const list = K.quellen.filter((x) => inTopic(x.t));
  const pos = list.findIndex((x) => x.id === q.id);
  const next = pos >= 0 && pos + 1 < list.length ? list[pos + 1] : null;
  stage().innerHTML =
    '<div class="kicker">' + esc(topicName(q.t)) + '</div><h2 class="q" style="margin:6px 0 0">' + esc(q.titel) + "</h2>" +
    '<dl class="record"><dt>Verfasser</dt><dd>' + esc(q.autor) + "</dd><dt>Datum</dt><dd>" + esc(q.datum) + "</dd><dt>Quellenart</dt><dd>" + esc(q.art) + "</dd><dt>Adressat</dt><dd>" + esc(q.adressat) + "</dd></dl>" +
    '<div class="doc">' + q.text.map((p) => "<p>" + esc(p) + "</p>").join("") + '<span class="src-note">' + esc(q.hinweis || "") + "</span></div>" +
    (q.kontext ? "<details><summary>Hintergrund zur Quelle</summary><p>" + esc(q.kontext) + "</p></details>" : "") +
    '<p class="hint">Einleitung in der Klausur: Verfasser, Datum, Quellenart, Adressat und Thema in ein bis zwei Sätzen nennen.</p>' +
    (mcHTML ? '<h3 class="step-h">1 · Einordnen</h3><p class="step-sub">Schnellcheck, ob du weißt, wo die Quelle hingehört.</p>' + mcHTML : "") +
    (tasksHTML ? '<h3 class="step-h">2 · Klausuraufgaben</h3><p class="step-sub">Erst selbst Stichpunkte machen, dann mit dem Erwartungshorizont vergleichen und abhaken.</p>' + tasksHTML : "") +
    '<div class="btn-row"><button class="btn" id="tolist" type="button">Alle Quellen</button>' + (next ? '<button class="btn primary" id="nextq" type="button">Nächste Quelle</button>' : "") + "</div>";
  $$("[data-mc]", stage()).forEach((b) => (b.onclick = () => {
    const i = +b.dataset.mc, k = +b.dataset.k, s = st.mc[i];
    if (s.p !== null) return;
    s.p = k; const ok = s.o[k] === q.mc[i].a;
    stat(q.t, ok); if (ok) addXP(10);
    const r = S.quellen[q.id] || (S.quellen[q.id] = { tasks: {} }); r.mc = (r.mc || 0) + (ok ? 1 : 0); save();
    keepScroll(renderQuelle);
  }));
  $$("[data-note]", stage()).forEach((ta) => (ta.oninput = () => { st.notes[ta.dataset.note] = ta.value; }));
  $$("[data-open]", stage()).forEach((b) => (b.onclick = () => { st.open[b.dataset.open] = true; keepScroll(renderQuelle); }));
  $$(".eh input", stage()).forEach((c) => (c.onchange = () => { st.checks[c.dataset.t + "-" + c.dataset.j] = c.checked; }));
  $$("[data-eval]", stage()).forEach((b) => (b.onclick = () => {
    const i = +b.dataset.eval;
    const count = q.aufgaben[i].eh.filter((_, j) => st.checks[i + "-" + j]).length;
    const r = S.quellen[q.id] || (S.quellen[q.id] = { tasks: {} }); if (!r.tasks) r.tasks = {};
    r.tasks[i] = count; save(); addXP(count * 5);
    keepScroll(renderQuelle);
  }));
  $("#tolist").onclick = () => go("quellen");
  const nq = $("#nextq"); if (nq) nq.onclick = () => go("quelle", next.id);
}
function keepScroll(fn) { const y = window.scrollY; fn(); window.scrollTo(0, y); }

/* ---------- Klausurfragen ---------- */
let kstate = {};
function renderKlausur() {
  const list = K.klausur.map((k, i) => ({ k: k, i: i })).filter((o) => inTopic(o.k.t));
  const ops = has("operatoren") ? '<details><summary>Operatoren: Was wird verlangt?</summary><div class="ops">' + K.operatoren.map((o) => "<div><b>" + esc(o.name) + "</b><span>AFB " + esc(o.afb) + "</span><span>" + esc(o.text) + "</span></div>").join("") + "</div></details>" : "";
  stage().innerHTML =
    '<div class="kicker">' + esc(topicName(S.topic)) + '</div><h2 class="q" style="margin-top:6px">Mögliche Klausurfragen</h2>' +
    '<p class="hint" style="margin-top:-6px">Antwort in Stichpunkten skizzieren, dann die Musterlösung aufdecken und abhaken, was du hattest.</p>' + ops +
    '<div style="margin-top:16px">' + (list.length ? list.map((o) => klausurCard(o.k, o.i)).join("") : '<p class="empty-note">Zu diesem Thema gibt es keine Fragen.</p>') + "</div>";
  const ks = (i) => kstate[i] || (kstate[i] = { checks: {} });
  $$("[data-note]", stage()).forEach((ta) => (ta.oninput = () => { ks(ta.dataset.note).note = ta.value; }));
  $$("[data-open]", stage()).forEach((b) => (b.onclick = () => { ks(b.dataset.open).open = true; keepScroll(renderKlausur); }));
  $$(".eh input", stage()).forEach((c) => (c.onchange = () => { ks(c.dataset.t).checks[c.dataset.j] = c.checked; }));
  $$("[data-eval]", stage()).forEach((b) => (b.onclick = () => {
    const i = +b.dataset.eval, st = ks(i);
    const count = K.klausur[i].punkte.filter((_, j) => st.checks[j]).length;
    S.klausur[i] = count; save(); addXP(count * 5);
    keepScroll(renderKlausur);
  }));
}
function klausurCard(k, i) {
  const st = kstate[i] || { checks: {} };
  const awarded = S.klausur[i] !== undefined;
  let body;
  if (st.open) {
    body = '<div class="eh-head">Musterlösung: Was hast du drin?</div><ul class="eh">' + k.punkte.map((p, j) => '<li><label><input type="checkbox" data-t="' + i + '" data-j="' + j + '"' + (st.checks[j] ? " checked" : "") + "><span>" + esc(p) + "</span></label></li>").join("") + "</ul>" +
      (awarded ? '<span class="awarded">Ausgewertet: ' + S.klausur[i] + " von " + k.punkte.length + " Punkten</span>" : '<div><button class="btn small primary" type="button" data-eval="' + i + '">Auswerten</button></div>');
  } else body = '<div><button class="btn small" type="button" data-open="' + i + '">Musterlösung zeigen</button></div>';
  return '<div class="task"><div style="display:flex;gap:8px;flex-wrap:wrap"><span class="tag op">' + esc(k.op) + '</span><span class="tag">' + esc(topicName(k.t)) + '</span></div><p class="qq">' + esc(k.q) + "</p>" +
    '<textarea id="kn-' + i + '" data-note="' + i + '" placeholder="Deine Stichpunkte (werden nicht gespeichert)">' + esc(st.note || "") + "</textarea>" + body + "</div>";
}

/* ---------- Lernplan ---------- */
// Geschätzte Minuten pro Aufgabe. Phase 1: jedes Thema mit Lernkarten + Quiz, Phase 2: gemischte Wiederholung, letzter Tag: roter Faden + Klausurfragen.
const PLAN_MIN = { lernen: 15, quiz: 10, karten: 10, kette: 10, blitz: 5, zeit: 5, quelle: 15, klausur: 20 };
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
let planForm = null, fromPlan = false;
const fadenLabel = (l) => "Roter Faden lesen" + (/roter faden/i.test(l.name) ? "" : ": " + l.name);
const planReady = () => topics().length > 0 && (has("lernen") || has("quiz"));
function planUnits() {
  return topics().map((t) => {
    const tasks = [];
    if ((K.lernen || []).some((l) => l.t === t.id)) tasks.push({ mode: "lernen", t: t.id, label: "Lernkarten: " + t.name, min: PLAN_MIN.lernen });
    if ((K.quiz || []).some((q) => q.t === t.id)) tasks.push({ mode: "quiz", t: t.id, label: "Quiz: " + t.name, min: PLAN_MIN.quiz });
    return { t: t, tasks: tasks };
  }).filter((u) => u.tasks.length);
}
function reviewPool() {
  const pool = [];
  if (has("quiz")) pool.push({ min: PLAN_MIN.quiz, next: () => ({ mode: "quiz", t: "all", label: "Quiz gemischt, alle Themen" }) });
  if (has("karten")) pool.push({ min: PLAN_MIN.karten, next: () => ({ mode: "karten", t: "all", label: "Karteikarten: alle Begriffe" }) });
  const ks = (K.ketten || []).map((k, i) => ({ k: k, i: i })).filter((o) => o.k.t !== "all");
  if (ks.length) { let i = 0; pool.push({ min: PLAN_MIN.kette, next: () => { const o = ks[i++ % ks.length]; return { mode: "kette", t: o.k.t, k: o.i, label: "Kette ordnen: " + o.k.titel }; } }); }
  if (has("zuordnen")) pool.push({ min: PLAN_MIN.blitz, next: () => ({ mode: "blitz", t: "all", label: (K.zuordnen.titel || "Zuordnen") + " (60 Sekunden)" }) });
  if (has("quellen")) {
    const qs = K.quellen.slice().sort((a, b) => (S.quellen[a.id] ? 1 : 0) - (S.quellen[b.id] ? 1 : 0)); let i = 0;
    pool.push({ min: PLAN_MIN.quelle, next: () => { const q = qs[i++ % qs.length]; return { mode: "quelle", t: q.t, q: q.id, label: "Quelle: " + q.titel }; } });
  }
  if (has("zeitstrahl")) pool.push({ min: PLAN_MIN.zeit, next: () => ({ mode: "zeit", t: "all", label: "Zeitstrahl" }) });
  return pool;
}
const usedMin = (day) => day.tasks.reduce((s, x) => s + x.min, 0);
function fillDay(day, cap, pool, st) {
  // jede Art höchstens einmal pro Tag, der Startpunkt wandert, damit die Tage abwechseln
  let used = usedMin(day), placed = 0;
  for (let j = 0; j < pool.length; j++) {
    const it = pool[(st.p + j) % pool.length];
    if (used + it.min > cap && !(used === 0 && placed === 0)) continue;
    day.tasks.push(Object.assign(it.next(), { min: it.min, phase: 2 })); used += it.min; placed++;
  }
  st.p += 1;
}
function weakTopics() {
  return topics().map((t) => ({ t: t, s: S.stats[t.id] })).filter((o) => o.s && o.s.n >= 3)
    .map((o) => ({ name: o.t.name, p: o.s.r / o.s.n })).filter((o) => o.p < 0.75).sort((a, b) => a.p - b.p).slice(0, 2).map((o) => o.name);
}
function buildPlan(wd, min) {
  const t0 = todayStr(), days = [];
  for (let d = t0; d < K.datum; d = addDays(d, 1)) if (wd[parseDate(d).getDay()]) days.push({ date: d, tasks: [] });
  const plan = { created: t0, exam: K.datum, wd: wd, min: min, warn: "", days: days };
  if (!days.length) return plan;
  const last = days[days.length - 1], before = days.slice(0, -1);
  const units = planUnits(), flat = [].concat.apply([], units.map((u) => u.tasks));
  const faden = (K.lernen || []).find((l) => l.t === "all");
  const weak = weakTopics();
  const prio = weak.length ? " Bisher am schwächsten: " + weak.join(" und ") + ", die zuerst wiederholen." : "";
  if (!before.length) {
    // nur noch ein Lerntag: nur das Wichtigste
    if (faden) last.tasks.push({ mode: "lernen", t: "all", label: fadenLabel(faden), min: PLAN_MIN.lernen, phase: 3 });
    if (has("quiz")) last.tasks.push({ mode: "quiz", t: "all", label: "Quiz gemischt, alle Themen", min: PLAN_MIN.quiz, phase: 3 });
    if (has("klausur")) last.tasks.push({ mode: "klausur", t: "all", label: "Klausurfragen durchgehen", min: PLAN_MIN.klausur, phase: 3 });
    plan.warn = "Bis zur Klausur bleibt dir nur noch ein Lerntag. Alle Themen einzeln schaffst du nicht mehr. Priorität: erst der rote Faden, damit du die Zusammenhänge hast, dann ein gemischtes Quiz, dann die Klausurfragen." + prio;
  } else {
    let di = 0, fits = true;
    for (const task of flat) {
      if (usedMin(before[di]) > 0 && usedMin(before[di]) + task.min > min) di++;
      if (di >= before.length) { fits = false; break; }
      before[di].tasks.push(Object.assign({}, task, { phase: 1 }));
    }
    if (fits) {
      const pool = reviewPool(), st = { p: 0 };
      before.forEach((d) => fillDay(d, min, pool, st));
    } else {
      // zu wenig Tage: mehrere Themen pro Tag zusammenfassen
      before.forEach((d) => (d.tasks = []));
      const per = Math.ceil(units.length / before.length);
      units.forEach((u, i) => u.tasks.forEach((x) => before[Math.floor(i / per)].tasks.push(Object.assign({}, x, { phase: 1, note: x.mode === "quiz" ? "wichtig" : "zur Not überfliegen" }))));
      const perDay = Math.round(Math.max.apply(null, before.map(usedMin)) / 5) * 5;
      plan.warn = "Für " + units.length + " Themen hast du vor dem letzten Tag nur " + before.length + (before.length === 1 ? " Lerntag" : " Lerntage") + ". Deshalb sind mehrere Themen pro Tag zusammengefasst, das sind bis zu " + perDay + " Minuten am Tag statt " + min + ". " +
        "Priorität: Mach auf jeden Fall die Quizze und am letzten Tag den roten Faden mit den Klausurfragen. Die Lernkarten kannst du überfliegen, wenn die Zeit nicht reicht." + prio + " Mehr Lerntage oder mehr Zeit pro Tag machen den Plan entspannter.";
    }
    if (faden) last.tasks.push({ mode: "lernen", t: "all", label: fadenLabel(faden), min: PLAN_MIN.lernen, phase: 3 });
    else if (has("quiz")) last.tasks.push({ mode: "quiz", t: "all", label: "Quiz gemischt, alle Themen", min: PLAN_MIN.quiz, phase: 3 });
    if (has("klausur")) last.tasks.push({ mode: "klausur", t: "all", label: "Klausurfragen durchgehen", min: PLAN_MIN.klausur, phase: 3 });
  }
  days.forEach((d) => d.tasks.forEach((x, j) => (x.id = d.date + ":" + j)));
  return plan;
}
function planTasks() { return S.plan ? [].concat.apply([], S.plan.days.map((d) => d.tasks.map((x) => Object.assign({ date: d.date }, x)))) : []; }
function planToday() {
  const t = todayStr(), done = S.planDone || {};
  const all = planTasks();
  return { all: all, today: all.filter((x) => x.date === t), overdue: all.filter((x) => x.date < t && !done[x.id]) };
}
function runTask(id) {
  const x = planTasks().find((o) => o.id === id); if (!x) return;
  S.topic = x.t || "all"; save(); fromPlan = true;
  if (x.mode === "quelle") return go("quelle", x.q);
  if (x.mode === "kette") { kette = null; newKette(x.k); return go("kette"); }
  start(x.mode);
}
function renderPlan() {
  const el = stage();
  if (!planReady()) { el.innerHTML = '<div class="empty-big">Für diese Klausur gibt es noch keinen Lernstoff. Sobald er da ist, kannst du dir hier einen Lernplan bis zur Klausur erstellen.</div>'; return; }
  const dl = daysUntil(K.datum);
  if (dl === null) { el.innerHTML = '<p class="empty-note">Für diese Klausur ist kein Termin eingetragen, deshalb gibt es keinen Lernplan.</p>'; return; }
  if (dl < 0) { el.innerHTML = '<div class="empty-big">Die Klausur ist vorbei. Zum Wiederholen kannst du alle Modi weiter nutzen.</div>'; return; }
  if (dl === 0) { el.innerHTML = '<div class="result"><div class="kicker">' + esc(K.fach) + '</div><div class="big">Heute ist die Klausur</div><p>Kein neuer Stoff mehr. Wenn du noch Zeit hast, lies einmal den roten Faden. Viel Erfolg!</p></div>'; return; }
  if (!S.plan || planForm) return renderPlanForm();
  const P = S.plan, done = S.planDone || (S.planDone = {}), t = todayStr();
  const { all, today, overdue } = planToday();
  const nDone = all.filter((x) => done[x.id]).length;
  const row = (x, from) => '<div class="ptask' + (done[x.id] ? " done" : "") + '"><label class="pcheck"><input type="checkbox" data-pt="' + esc(x.id) + '"' + (done[x.id] ? " checked" : "") + ' aria-label="Erledigt"></label>' +
    '<button class="plink" type="button" data-run="' + esc(x.id) + '"><span class="pl">' + esc(x.label) + '</span><span class="pm">' +
    (from ? '<span class="late">nachgerutscht von ' + fmtDate(from) + "</span> · " : "") + "ca. " + x.min + " Min." + (x.note ? " · " + esc(x.note) : "") + '</span></button><span class="pgo" aria-hidden="true">→</span></div>';
  const dayHead = (d, extra) => "<h3>" + (extra || fmtDate(d.date)) + (d.date === P.days[P.days.length - 1].date ? ' <em class="lastday">Letzter Tag</em>' : "") + "<span>ca. " + usedMin(d) + " Min.</span></h3>";
  const wdText = WD_ORDER.filter((i) => P.wd[i]).length === 7 ? "jeden Tag" : WD_ORDER.filter((i) => P.wd[i]).map((i) => WD[i]).join(", ");
  const todayDay = P.days.find((d) => d.date === t);
  const nextDay = P.days.find((d) => d.date > t);
  const future = P.days.filter((d) => d.date > t), past = P.days.filter((d) => d.date < t);
  const extraMin = overdue.reduce((s, x) => s + x.min, 0);
  let todayHTML = '<section class="pday today">' + (todayDay ? dayHead(todayDay, "Heute · " + fmtDate(t)) : "<h3>Heute · " + fmtDate(t) + "</h3>");
  if (!todayDay && !overdue.length) todayHTML += '<p class="hint" style="margin:0">Heute ist kein Lerntag.' + (nextDay ? " Weiter geht's am " + fmtDate(nextDay.date) + "." : "") + "</p>";
  if (!todayDay && overdue.length) todayHTML += '<p class="hint" style="margin:0 0 8px">Heute ist eigentlich kein Lerntag, aber es ist noch etwas offen.</p>';
  todayHTML += overdue.map((x) => row(x, x.date)).join("") + (todayDay ? today.map((x) => row(x)).join("") : "");
  if (overdue.length) todayHTML += '<p class="hint">' + overdue.length + (overdue.length === 1 ? " Aufgabe ist" : " Aufgaben sind") + " von vorher nachgerutscht, heute also etwa " + extraMin + " Minuten mehr als geplant.</p>";
  if (todayDay && today.every((x) => done[x.id]) && !overdue.length) todayHTML += '<p class="fb ok"><b>Für heute alles erledigt.</b>Stark. Morgen geht\'s weiter.</p>';
  todayHTML += "</section>";
  el.innerHTML =
    '<div class="kicker">Klausur ' + fmtDate(K.datum) + " · " + countdown(K.datum) + '</div><h2 class="q" style="margin-top:6px">Dein Lernplan</h2>' +
    '<p class="hint" style="margin-top:-8px">' + nDone + " von " + all.length + " Aufgaben erledigt · " + esc(wdText) + ", ca. " + P.min + " Minuten pro Tag</p>" +
    '<div class="progress" style="margin-top:12px"><i style="width:' + (all.length ? Math.round((nDone / all.length) * 100) : 0) + '%"></i></div>' +
    (P.exam !== K.datum ? '<div class="fb bad"><b>Der Klausurtermin hat sich geändert.</b>Erstell den Plan neu, damit er wieder passt.</div>' : "") +
    (P.warn ? '<div class="fb bad warn"><b>Es wird knapp.</b>' + esc(P.warn) + "</div>" : "") +
    todayHTML +
    (future.length ? '<div class="step-h">Als Nächstes</div>' + future.map((d) => '<section class="pday">' + dayHead(d) + d.tasks.map((x) => row(x)).join("") + "</section>").join("") : "") +
    (past.length ? "<details><summary>Vergangene Tage (" + past.length + ")</summary>" + past.map((d) => '<section class="pday">' + dayHead(d) + d.tasks.map((x) => row(x)).join("") + "</section>").join("") + "</details>" : "") +
    '<div class="btn-row"><button class="btn" id="replan" type="button">Plan neu erstellen</button></div>' +
    '<p class="hint">Tipp auf eine Aufgabe, dann landest du direkt im passenden Modus und Thema. Abhaken musst du selbst, der Plan liegt nur auf diesem Gerät.</p>';
  $$("[data-pt]", el).forEach((c) => (c.onchange = () => { if (c.checked) done[c.dataset.pt] = true; else delete done[c.dataset.pt]; save(); keepScroll(renderPlan); }));
  $$("[data-run]", el).forEach((b) => (b.onclick = () => runTask(b.dataset.run)));
  $("#replan").onclick = () => { planForm = { wd: P.wd.slice(), min: P.min }; renderPlan(); window.scrollTo(0, 0); };
}
function renderPlanForm() {
  const f = planForm || (planForm = { wd: [true, true, true, true, true, true, true], min: 30 });
  const el = stage();
  el.innerHTML =
    '<div class="kicker">Klausur ' + fmtDate(K.datum) + " · " + countdown(K.datum) + '</div><h2 class="q" style="margin-top:6px">Lernplan erstellen</h2>' +
    '<p class="hint" style="margin-top:-8px">Der Plan läuft von heute bis zum Tag vor der Klausur. Erst kommt jedes Thema einmal dran, dann gemischte Wiederholung, am letzten Tag der rote Faden und die Klausurfragen.</p>' +
    '<div class="step-h">An welchen Tagen lernst du?</div><div class="chips">' +
    WD_ORDER.map((i) => '<button class="chip" type="button" data-wd="' + i + '" aria-pressed="' + !!f.wd[i] + '">' + WD[i] + "</button>").join("") + "</div>" +
    '<div class="step-h">Wie viel Zeit pro Tag?</div><div class="seg" role="group">' +
    [15, 30, 45, 60].map((m) => '<button type="button" data-min="' + m + '" aria-pressed="' + (f.min === m) + '">' + m + " Min.</button>").join("") + "</div>" +
    (f.err ? '<div class="fb bad"><b>So geht es nicht.</b>' + esc(f.err) + "</div>" : "") +
    '<div class="btn-row"><button class="btn signal" id="mkplan" type="button">' + (S.plan ? "Neuen Plan erstellen" : "Plan erstellen") + "</button>" + (S.plan ? '<button class="btn" id="cancel" type="button">Abbrechen</button>' : "") + "</div>" +
    (S.plan ? '<p class="hint">Der neue Plan ersetzt den alten, die Haken fangen wieder bei null an.</p>' : "");
  $$("[data-wd]", el).forEach((b) => (b.onclick = () => { f.wd[+b.dataset.wd] = !f.wd[+b.dataset.wd]; f.err = ""; renderPlanForm(); }));
  $$("[data-min]", el).forEach((b) => (b.onclick = () => { f.min = +b.dataset.min; renderPlanForm(); }));
  $("#mkplan").onclick = () => {
    if (!f.wd.some(Boolean)) { f.err = "Wähl mindestens einen Wochentag aus."; return renderPlanForm(); }
    const p = buildPlan(f.wd, f.min);
    if (!p.days.length) { f.err = "Bis zur Klausur liegt keiner deiner Lerntage mehr. Wähl mehr Wochentage aus."; return renderPlanForm(); }
    S.plan = p; S.planDone = {}; planForm = null; save(); renderPlan(); window.scrollTo(0, 0);
  };
  const c = $("#cancel"); if (c) c.onclick = () => { planForm = null; renderPlan(); };
}
function planCardInfo() {
  if (!S.plan) return ["Noch kein Plan", "in 1 Minute erstellt"];
  const { today, overdue } = planToday(), done = S.planDone || {};
  const open = today.filter((x) => !done[x.id]).length + overdue.length;
  return [open ? "Heute: " + open + " offen" : today.length ? "Heute erledigt ✓" : "Heute frei", planTasks().filter((x) => done[x.id]).length + " von " + planTasks().length + " erledigt"];
}

/* ---------- Tastatur ---------- */
document.addEventListener("keydown", (e) => {
  const tag = (e.target && e.target.tagName) || "";
  if (tag === "TEXTAREA" || tag === "INPUT" || !K) return;
  if (view === "lernen" && lern && !lern.done) {
    if (e.key === "ArrowLeft") { e.preventDefault(); lernStep(-1); }
    if (e.key === "ArrowRight") { e.preventDefault(); lernStep(1); }
  } else if (view === "blitz" && blitz && blitz.state === "run") {
    if (e.key === "ArrowLeft") { e.preventDefault(); answerBlitz("a"); }
    if (e.key === "ArrowRight") { e.preventDefault(); answerBlitz("b"); }
  } else if (view === "quiz" && quiz) {
    if (quiz.picked === null && /^[1-4]$/.test(e.key)) pickQuiz(+e.key - 1);
  } else if (view === "karten" && karten && karten.deck.length) {
    if (e.key === " ") { e.preventDefault(); karten.flipped = !karten.flipped; renderKarten(); }
    else if (karten.flipped && e.key === "1") { const a = $("#again"); if (a) a.click(); }
    else if (karten.flipped && e.key === "2") { const k = $("#known"); if (k) k.click(); }
  }
});

if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
}
route();
})();
