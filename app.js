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
  const base = { topic: "all", stats: {}, quellen: {}, klausur: {}, learned: {} };
  try {
    const raw = localStorage.getItem("kt:" + id);
    if (raw) {
      const st = Object.assign(base, JSON.parse(raw));
      // Aufgaben aus Modi, die es nicht mehr gibt (Zuordnen, Zeitstrahl), aus alten Plänen entfernen
      if (st.plan && st.plan.days) st.plan.days.forEach((d) => (d.tasks = d.tasks.filter((x) => TITLES[x.mode])));
      return st;
    }
  } catch (e) {}
  // Übernahme aus der ersten Version der Kalter-Krieg-App
  try { if (id === "geschichte-kalter-krieg") { const old = localStorage.getItem("kk-trainer-v1"); if (old) return Object.assign(base, JSON.parse(old)); } } catch (e) {}
  return base;
}
function save() { if (!K || !S) return; try { localStorage.setItem("kt:" + K.id, JSON.stringify(S)); } catch (e) {} }
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
  stopProbeTimer();
  const parts = parseHash();
  if (!parts.length) { K = null; window.scrollTo(0, 0); return renderLanding(); }
  if (SITE_PAGES.includes(parts[0])) { K = null; window.scrollTo(0, 0); return renderSite(parts[0]); }
  const id = parts[0];
  if (!K || K.id !== id) {
    app.innerHTML = '<div class="wrap" style="padding-block:40px"><p class="empty-note">Lade Klausur …</p></div>';
    try { K = await getJSON("klausuren/" + encodeURIComponent(id) + ".json"); }
    catch (e) { K = null; return renderSite("klausuren", "Diese Klausur gibt es nicht (mehr)."); }
    S = loadState(K.id);
    quiz = kette = karten = lern = null; qstate = {}; kstate = {};
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
const SITE_PAGES = ["klausuren", "probeklausur", "kalender", "updates"];
let UPDATES = null, cal = null;
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const pad2 = (n) => String(n).padStart(2, "0");
function ymd(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
const todayStr = () => ymd(new Date());
function addDays(ds, n) { const d = parseDate(ds); d.setDate(d.getDate() + n); return ymd(d); }
const examTitle = (k) => k.fach + (k.titel && k.titel !== "Thema folgt" ? ", " + k.titel : "");
// für Farbpunkte auf Schwarz die hellere der beiden Fächerfarben
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
const TITLES_SITE = { klausuren: "Klausuren", probeklausur: "Probeklausur", kalender: "Kalender", updates: "Updates" };
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
    '<p class="meta">Powered by Discipline</p>' +
    '<div class="install" id="install"></div></section>' +
    '<section class="wrap"><div class="device" id="device">' +
    (next ? '<div class="dev-bar"><span>' + esc(examTitle(next)) + "</span><span>Klausur " + countdown(next.datum) + "</span></div>" : "") +
    '<div class="dev-body" id="dev-body"><p class="empty-note">Lade …</p></div></div></section>' +
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
  const body = $("#dev-body");
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
  } else if (page === "probeklausur") {
    // nur Klausuren mit Quellen; dafür müssen die Klausurdateien geladen werden
    const full = await Promise.all(list.map((k) => getJSON("klausuren/" + encodeURIComponent(k.id) + ".json").catch(() => null)));
    const withSrc = list.filter((k, i) => full[i] && (full[i].quellen || []).length).sort((a, b) => (a.datum || "").localeCompare(b.datum || ""));
    body = '<header class="page-head"><h1>Probeklausur</h1><p>Wähl das Fach. Du bekommst eine komplette Klausur mit Quelle, Aufgaben und Timer.</p></header>' +
      (withSrc.length ? '<div class="exams">' + withSrc.map((k) => {
        const st = loadState(k.id), h = st.probeHist || [], d = daysUntil(k.datum);
        const status = st.probe && st.probe.state === "run" ? "Läuft gerade" : st.probe && st.probe.state === "korrektur" ? "Korrektur offen" : h.length ? h.length + (h.length === 1 ? " geschrieben" : " geschrieben") + ", zuletzt ≈ " + h[h.length - 1].np + " Punkte" : "Noch keine geschrieben";
        return '<article class="exam"><div class="exam-top"><span class="kicker"><i class="dot" style="background:' + esc(examColor(k)) + '"></i>' + esc(k.fach) + (k.kurs ? " · " + esc(k.kurs) : "") + "</span></div><h3>" + esc(k.titel) + "</h3><p>" + esc(status) + "</p>" +
          (k.datum ? '<div class="when-row"><span class="when">' + fmtDate(k.datum) + "</span>" + (d !== null && d >= 0 ? '<span class="cd">' + countdown(k.datum) + "</span>" : "") + "</div>" : "") +
          '<div class="exam-actions"><a class="btn small primary" href="#/' + encodeURIComponent(k.id) + '/probe">' + (st.probe && st.probe.state !== "fertig" ? "Weiterschreiben" : "Probeklausur starten") + "</a></div></article>";
      }).join("") + "</div>" : '<div class="empty-big">Gerade hat keine Klausur Quellen.</div>') +
      '<p class="hint" style="margin-top:28px">Probeklausuren gibt es für Klausuren mit Quellen. Weitere Fächer kommen dazu, sobald es Material gibt.</p>';
  } else if (page === "kalender") {
    body = '<header class="page-head"><h1>Kalender</h1><p>Alle Klausurtermine. Tipp auf einen Termin, um die Klausur zu öffnen.</p></header><div id="cal"></div>';
  } else {
    const known = new Set(list.map((k) => k.id));
    // neueste zuerst; bei gleichem Datum der später eingetragene
    const news = (ups || []).map((u, i) => Object.assign({ i: i }, u)).sort((a, b) => (b.datum || "").localeCompare(a.datum || "") || b.i - a.i).slice(0, 5);
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
const TITLES = { lernplan: "Lernplan", lernen: "Lernen", quiz: "Quiz", kette: "Ursache → Folge", karten: "Karteikarten", quellen: "Quellen", quelle: "Quellen", klausur: "Klausurfragen", probe: "Probeklausur" };
function render() {
  document.body.classList.toggle("on-home", view === "home");
  if (view === "home" || !TITLES[view]) { view = "home"; return renderHome(); }
  app.innerHTML =
    '<div class="topbar"><div class="wrap">' +
    '<button class="back" id="back" type="button">← ' + (fromPlan ? "Lernplan" : view === "quelle" ? "Alle Quellen" : "Übersicht") + "</button>" +
    '<div class="mtitle">' + TITLES[view] + "</div>" +
    '<span id="tb-right"></span></div></div>' +
    '<main class="stage" id="stage"></main>';
  $("#back").onclick = () => (fromPlan ? go("lernplan") : view === "quelle" ? go("quellen") : go("home"));
  ({ lernplan: renderPlan, lernen: renderLernen, quiz: renderQuiz, kette: renderKette, karten: renderKarten, quellen: renderQuellen, quelle: renderQuelle, klausur: renderKlausur, probe: renderProbe })[view]();
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
  if (has("lernen")) train.push(card("lernen", "learn", "Erst verstehen", "Lernen", "Alle Inhalte als Lernkarten zum Durchblättern, ohne Druck. Danach direkt testen.", K.lernen.length + " Themen", learnedCount + " gelesen"));
  if (has("quellen")) train.push(card("quellen", "train", "Quellenarbeit", "Quellen-Training", "Quellenauszüge mit Einordnungsfragen, Klausuraufgaben und Erwartungshorizont zum Abhaken.", n(K.quellen, (q) => inTopic(q.t)) + " Quellen", done + " bearbeitet"));
  const probeCard = has("quellen") ? (() => { const pi = probeCardInfo(); return card("probe", "probe", "Wie in der echten Klausur", "Probeklausur", "Quelle, Aufgaben mit Operatoren und Timer auf einem Klausurblatt. Danach selbst korrigieren und eine grobe Note bekommen.", pi[0], pi[1]); })() : "";
  if (has("klausur")) train.push(card("klausur", "train", "Offene Fragen", "Klausurfragen", "Mögliche Aufgaben mit Operatoren. Erst selbst antworten, dann mit der Musterlösung vergleichen.", n(K.klausur, (q) => inTopic(q.t)) + " Fragen", "mit Musterlösung"));
  const games = [];
  if (has("quiz")) games.push(["quiz", "Wissen", "Quiz", "Zehn Fragen mit Erklärung nach jeder Antwort.", n(K.quiz, (q) => inTopic(q.t)) + " Fragen im Pool", "10 pro Runde"]);
  if (has("ketten")) games.push(["kette", "Zusammenhänge", "Ursache und Folge", "Ursache-Folge-Ketten in die richtige Reihenfolge bringen.", n(K.ketten, (k) => inTopic(k.t)) + " Ketten", "mit Merksatz"]);
  if (has("karten")) games.push(["karten", "Begriffe und Personen", "Karteikarten", "Umdrehen, prüfen, aussortieren, bis alle sitzen.", n(K.karten, (k) => inTopic(k.t)) + " Karten", "bis alle sitzen"]);
  // Raster: 3 pro Reihe, eine angefangene Reihe wird auf ganze Breite verteilt
  const rem = games.length % 3;
  const gamesHTML = games.map((g, i) => {
    let cls = "";
    if (rem === 2 && i >= games.length - 2) cls = "wide";
    if (rem === 1 && i === games.length - 1) cls = "full";
    return card(g[0], cls, g[1], g[2], g[3], g[4], g[5]);
  }).join("");
  const stats = '<div class="stats">' +
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
    (train.length ? '<section><div class="sec-head"><h2>Lernen und Klausurtraining</h2><p>Erst verstehen, dann so üben, wie es in der Klausur drankommt.</p></div><div class="grid-train">' + train.join("") + probeCard + "</div></section>" : "") +
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
  if (ni >= total) { lern.done = true; if (!S.learned[L.t]) { S.learned[L.t] = true; save(); } }
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
  if (ok) { quiz.right++; } else quiz.missed.push(it);
  renderQuiz();
}
function renderQuizEnd() {
  const n = quiz.items.length;
  const verdict = quiz.right === n ? "Fehlerfrei." : quiz.right >= n * 0.7 ? "Sitzt schon gut." : "Da geht noch was.";
  stage().innerHTML =
    '<div class="result"><div class="kicker">' + esc(topicName(S.topic)) + '</div><div class="big">' + quiz.right + " / " + n + "</div><p><b>" + verdict + "</b></p>" +
    (quiz.missed.length ? '<h3 class="step-h">Nochmal anschauen</h3><ul class="review">' + quiz.missed.map((m) => "<li><b>" + esc(m.q) + '</b><span class="ans">' + esc(m.c) + "</span><br>" + esc(m.e) + "</li>").join("") + "</ul>" : "") +
    '<div class="btn-row"><button class="btn primary" id="again" type="button">Neue Runde</button><button class="btn" id="home" type="button">Zur Übersicht</button></div></div>';
  $("#again").onclick = () => { newQuiz(); renderQuiz(); window.scrollTo(0, 0); };
  $("#home").onclick = () => go("home");
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
  const kn = $("#known"); if (kn) kn.onclick = () => { kt.deck.shift(); kt.known++; kt.flipped = false; renderKarten(); };
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
    stat(q.t, ok);
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
    r.tasks[i] = count; save();
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
    S.klausur[i] = count; save();
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
const PLAN_MIN = { lernen: 15, quiz: 10, karten: 10, kette: 10, quelle: 20, klausur: 20 };
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
  if (has("quellen")) {
    const qs = K.quellen.slice().sort((a, b) => (S.quellen[a.id] ? 1 : 0) - (S.quellen[b.id] ? 1 : 0)); let i = 0;
    pool.push({ min: PLAN_MIN.quelle, next: () => { const q = qs[i++ % qs.length]; return { mode: "quelle", t: q.t, q: q.id, label: "Quelle: " + q.titel }; } });
  }
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
    // ein Thema (Lernkarten + Quiz) bleibt am selben Tag, wenn es in die Tageszeit passt;
    // auch bei viel Zeit verteilen sich die Themen auf mindestens die erste Hälfte der Tage
    const maxThemes = Math.ceil(units.length / Math.ceil(before.length / 2));
    const themesOn = (d) => new Set(d.tasks.map((x) => x.t)).size;
    const place = (tasks) => {
      const need = tasks.reduce((a, x) => a + x.min, 0);
      const d = before[di], isNew = !d.tasks.some((x) => x.t === tasks[0].t);
      if (usedMin(d) > 0 && (usedMin(d) + need > min || (isNew && themesOn(d) >= maxThemes))) di++;
      if (di >= before.length) return false;
      tasks.forEach((x) => before[di].tasks.push(Object.assign({}, x, { phase: 1 })));
      return true;
    };
    for (const u of units) {
      const need = u.tasks.reduce((a, x) => a + x.min, 0);
      const ok = need <= min ? place(u.tasks) : u.tasks.every((x) => place([x]));
      if (!ok) { fits = false; break; }
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
    '<div class="kicker">Klausur ' + fmtDate(K.datum) + " · " + countdown(K.datum) + '</div><div class="plan-top"><h2 class="q" style="margin:6px 0 0">Dein Lernplan</h2>' +
    '<button class="btn small" id="replan" type="button">Plan neu erstellen</button></div>' +
    '<p class="hint" style="margin-top:8px">' + nDone + " von " + all.length + " Aufgaben erledigt · " + esc(wdText) + ", ca. " + P.min + " Minuten pro Tag</p>" +
    '<div class="progress" style="margin-top:12px"><i style="width:' + (all.length ? Math.round((nDone / all.length) * 100) : 0) + '%"></i></div>' +
    (P.exam !== K.datum ? '<div class="fb bad"><b>Der Klausurtermin hat sich geändert.</b>Erstell den Plan neu, damit er wieder passt.</div>' : "") +
    (P.warn ? '<div class="fb bad warn"><b>Es wird knapp.</b>' + esc(P.warn) + "</div>" : "") +
    todayHTML +
    (future.length ? '<div class="step-h">Als Nächstes</div>' + future.map((d) => '<section class="pday">' + dayHead(d) + d.tasks.map((x) => row(x)).join("") + "</section>").join("") : "") +
    (past.length ? "<details><summary>Vergangene Tage (" + past.length + ")</summary>" + past.map((d) => '<section class="pday">' + dayHead(d) + d.tasks.map((x) => row(x)).join("") + "</section>").join("") + "</details>" : "") +
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
    '<label class="own-min">oder eigene Zeit: <input type="number" id="ownmin" min="5" max="600" step="5" inputmode="numeric" placeholder="z. B. 90" value="' + ([15, 30, 45, 60].includes(f.min) ? "" : f.min) + '"> Minuten</label>' +
    (f.err ? '<div class="fb bad"><b>So geht es nicht.</b>' + esc(f.err) + "</div>" : "") +
    '<div class="btn-row"><button class="btn signal" id="mkplan" type="button">' + (S.plan ? "Neuen Plan erstellen" : "Plan erstellen") + "</button>" + (S.plan ? '<button class="btn" id="cancel" type="button">Abbrechen</button>' : "") + "</div>" +
    (S.plan ? '<p class="hint">Der neue Plan ersetzt den alten, die Haken fangen wieder bei null an.</p>' : "");
  $$("[data-wd]", el).forEach((b) => (b.onclick = () => { f.wd[+b.dataset.wd] = !f.wd[+b.dataset.wd]; f.err = ""; renderPlanForm(); }));
  $$("[data-min]", el).forEach((b) => (b.onclick = () => { f.min = +b.dataset.min; f.err = ""; renderPlanForm(); }));
  // freie Eingabe: nicht neu zeichnen, sonst springt der Cursor raus
  $("#ownmin").oninput = () => { if ($("#ownmin").value !== "") $$("[data-min]", el).forEach((b) => b.setAttribute("aria-pressed", "false")); };
  $("#mkplan").onclick = () => {
    if (!f.wd.some(Boolean)) { f.err = "Wähl mindestens einen Wochentag aus."; return renderPlanForm(); }
    const own = $("#ownmin").value.trim();
    if (own !== "") {
      const v = Math.round(Number(own));
      if (!(v >= 5 && v <= 600)) { f.err = "Gib bei der eigenen Zeit eine Zahl zwischen 5 und 600 Minuten ein."; return renderPlanForm(); }
      f.min = v;
    }
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

/* ---------- Probeklausur ---------- */
// Teil A: 1 Quelle mit allen Aufgaben, oder ein Quellenpaar desselben Themas (M2 nur mit seiner Vergleichsaufgabe).
// Teil B: 1 bis 2 Fragen zu einem anderen Thema plus eine Frage zum Pflichtthema (K.probe.pflicht), falls die Quellen es nicht schon abdecken.
// Umfang 65 bis 85 Minuten, geschätzt nach Anforderungsbereich.
const AFB_COST = { "I": { min: 10, be: 6 }, "I–II": { min: 10, be: 8 }, "II": { min: 15, be: 10 }, "III": { min: 20, be: 14 } };
const PROBE_READ = 5, PROBE_RANGE = [65, 85];
let probeTimer = null, probeSaveT = null, probeConfirm = false;
function stopProbeTimer() { if (probeTimer) { clearInterval(probeTimer); probeTimer = null; } }
function opInfo(op) {
  const o = (K.operatoren || []).find((x) => x.name.split("/").map((s) => s.trim()).includes(op));
  const afb = o ? o.afb : "II";
  return Object.assign({ afb: afb }, AFB_COST[afb] || AFB_COST.II);
}
function probeCandidates() {
  const pflicht = K.probe && K.probe.pflicht;
  const ohne = new Set((K.probe && K.probe.ohne) || []);   // Themen, die nur angeschnitten werden
  const srcs = K.quellen.filter((q) => (q.aufgaben || []).length && !ohne.has(q.t));
  const qs = (K.klausur || []).map((k, i) => ({ k: k, i: i })).filter((o) => !ohne.has(o.k.t));
  const teilA = [];
  // Vergleichsaufgaben beziehen sich auf eine zweite Quelle, deshalb nur im Quellenpaar
  srcs.forEach((q) => teilA.push({ t: q.t, mats: [q.id], tasks: q.aufgaben.map((a, j) => ({ src: q.id, j: j, op: a.op })).filter((x) => x.op !== "Vergleichen") }));
  srcs.forEach((b) => {
    const vj = b.aufgaben.findIndex((a) => a.op === "Vergleichen");
    if (vj < 0) return;
    srcs.filter((a) => a !== b && a.t === b.t).forEach((a) => teilA.push({ t: a.t, mats: [a.id, b.id], tasks: a.aufgaben.map((x, j) => ({ src: a.id, j: j, op: x.op })).filter((x) => x.op !== "Vergleichen").concat([{ src: b.id, j: vj }]) }));
  });
  const out = [];
  teilA.forEach((A) => {
    const srcTexts = new Set(A.tasks.map((x) => K.quellen.find((q) => q.id === x.src).aufgaben[x.j].q));
    const free = (o) => !srcTexts.has(o.k.q);
    const pf = pflicht && A.t !== pflicht ? qs.filter((o) => o.k.t === pflicht && free(o)) : [];
    const themes = [...new Set(qs.map((o) => o.k.t))].filter((t) => t !== A.t && t !== pflicht && t !== "all");
    themes.forEach((t) => {
      const tq = qs.filter((o) => o.k.t === t && free(o));
      const sets = tq.map((o) => [o]);
      if (pf.length) sets.push([]);
      for (let x = 0; x < tq.length; x++) for (let y = x + 1; y < tq.length; y++) sets.push([tq[x], tq[y]]);
      sets.forEach((set) => {
        const variants = pf.length ? pf.map((p) => [p].concat(set)) : [set];
        variants.forEach((B) => { if (B.length) out.push({ A: A, B: B, theme: t }); });
      });
    });
  });
  return out.map((c) => {
    const tasks = c.A.tasks.map((x) => { const a = K.quellen.find((q) => q.id === x.src).aufgaben[x.j]; return Object.assign({ kind: "src", src: x.src, op: a.op, q: a.q, eh: a.eh }, opInfo(a.op)); })
      .concat(c.B.map((o) => Object.assign({ kind: "frage", t: o.k.t, op: o.k.op, q: o.k.q, eh: o.k.punkte }, opInfo(o.k.op))));
    const min = tasks.reduce((s, x) => s + x.min, 0) + c.A.mats.length * PROBE_READ;
    return { mats: c.A.mats, tasks: tasks, min: min, theme: c.theme };
  }).filter((c) => c.min >= PROBE_RANGE[0] && c.min <= PROBE_RANGE[1]);
}
function newProbe(dauer) {
  let cands = probeCandidates();
  if (!cands.length) return null;
  // erst zufällig 1 oder 2 Quellen, dann eine Variante; Umfang nah an 75 Minuten leicht bevorzugt
  const groups = [1, 2].map((n) => cands.filter((c) => c.mats.length === n)).filter((g) => g.length);
  cands = groups[Math.floor(Math.random() * groups.length)];
  const w = cands.map((c) => 1 / (1 + Math.abs(c.min - 75) / 10));
  let r = Math.random() * w.reduce((a, b) => a + b, 0), pick = cands[0];
  for (let i = 0; i < cands.length; i++) { r -= w[i]; if (r <= 0) { pick = cands[i]; break; } }
  return { state: "run", dauer: dauer, start: Date.now(), mats: pick.mats, tasks: pick.tasks, min: pick.min, answers: {}, checks: {} };
}
const probeMax = (P) => P.tasks.reduce((s, x) => s + x.be, 0);
function probeScore(P) {
  return P.tasks.map((x, i) => { const c = P.checks[i] || {}; const n = x.eh.filter((_, j) => c[j]).length; return Math.round((x.be * n / x.eh.length) * 2) / 2; });
}
function notenpunkte(pct) {
  // üblicher Abi-Schlüssel; die Lehrkraft kann einen anderen verwenden
  const t = [[95, 15], [90, 14], [85, 13], [80, 12], [75, 11], [70, 10], [65, 9], [60, 8], [55, 7], [50, 6], [45, 5], [40, 4], [33, 3], [27, 2], [20, 1]];
  for (const [p, np] of t) if (pct >= p) return np;
  return 0;
}
const npNote = (np) => (np >= 13 ? 1 : np >= 10 ? 2 : np >= 7 ? 3 : np >= 4 ? 4 : np >= 1 ? 5 : 6);
const fmtClock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ":" + pad2(s % 60); };
function probeSave() { clearTimeout(probeSaveT); probeSaveT = setTimeout(save, 300); }
const firstWordBold = (q) => esc(q).replace(/^(\S+)/, "<b>$1</b>");

function renderProbe() {
  stopProbeTimer();
  const tb = $("#tb-right"); if (tb) tb.innerHTML = "";
  const el = stage();
  if (!has("quellen")) { el.innerHTML = '<div class="empty-big">Für diese Klausur gibt es noch keine Quellen. Eine Probeklausur kommt, sobald das Material da ist.</div>'; return; }
  const P = S.probe;
  if (!P) return renderProbeStart();
  if (P.state === "run") return renderProbeRun();
  if (P.state === "korrektur") return renderProbeKorrektur();
  return renderProbeResult();
}
let probeDauer = 90;
function renderProbeStart(err) {
  const el = stage();
  const hist = S.probeHist || [];
  const pfName = K.probe && K.probe.pflicht ? topicName(K.probe.pflicht) : "";
  el.innerHTML =
    '<div class="kicker">' + esc(K.fach) + " · " + esc(K.titel) + '</div><h2 class="q" style="margin-top:6px">Probeklausur</h2>' +
    '<p class="hint" style="margin-top:-8px">Eine komplette Klausur: 1 bis 2 Quellen mit Aufgaben, dazu Fragen zu einem Thema' + (pfName ? " und zu „" + esc(pfName) + "“" : "") + '. Umfang etwa 75 Minuten. Jedes Mal neu zusammengestellt.</p>' +
    '<div class="step-h">Bearbeitungszeit</div><div class="seg" role="group">' +
    [60, 75, 90, 120].map((m) => '<button type="button" data-pd="' + m + '" aria-pressed="' + (probeDauer === m) + '">' + m + " Min.</button>").join("") + "</div>" +
    '<label class="own-min">oder eigene Zeit: <input type="number" id="pdown" min="10" max="300" step="5" inputmode="numeric" placeholder="z. B. 100" value="' + ([60, 75, 90, 120].includes(probeDauer) ? "" : probeDauer) + '"> Minuten</label>' +
    (err ? '<div class="fb bad"><b>So geht es nicht.</b>' + esc(err) + "</div>" : "") +
    '<div class="btn-row"><button class="btn primary" id="pstart" type="button">Probeklausur starten</button></div>' +
    '<p class="hint">Der Timer läuft weiter, auch wenn du das Fenster schließt. Deine Antworten werden auf diesem Gerät zwischengespeichert.</p>' +
    probeHistHTML(hist);
  $$("[data-pd]", el).forEach((b) => (b.onclick = () => { probeDauer = +b.dataset.pd; renderProbeStart(); }));
  $("#pdown").oninput = () => { if ($("#pdown").value !== "") $$("[data-pd]", el).forEach((b) => b.setAttribute("aria-pressed", "false")); };
  $("#pstart").onclick = () => {
    const own = $("#pdown").value.trim();
    if (own !== "") { const v = Math.round(Number(own)); if (!(v >= 10 && v <= 300)) return renderProbeStart("Gib bei der eigenen Zeit eine Zahl zwischen 10 und 300 Minuten ein."); probeDauer = v; }
    const P = newProbe(probeDauer);
    if (!P) return renderProbeStart("Aus den Quellen und Fragen dieser Klausur lässt sich keine Probeklausur mit 65 bis 85 Minuten bauen.");
    S.probe = P; probeConfirm = false; save(); renderProbe(); window.scrollTo(0, 0);
  };
}
function probeHistHTML(hist) {
  if (!hist.length) return "";
  return '<div class="step-h">Verlauf</div><div class="phist">' + hist.slice().reverse().slice(0, 10).map((h) =>
    '<div class="phrow"><span class="ph-d">' + fmtDate(h.datum) + '</span><span class="ph-t">' + esc(h.titel) + '</span><span class="ph-s">' + String(h.be).replace(".", ",") + " / " + h.max + ' BE</span><span class="ph-np"><b>≈ ' + h.np + "</b> P.</span></div>").join("") + "</div>";
}
function sheetHead(P) {
  return '<header class="sheet-head"><div class="sh-row"><b>Probeklausur ' + esc(K.fach) + "</b><span>" + esc(K.kurs || "") + "</span></div>" +
    '<div class="sh-row"><span>Thema: ' + esc(K.titel) + "</span><span>" + fmtDate(ymd(new Date(P.start))) + "</span></div>" +
    '<div class="sh-row"><span>Bearbeitungszeit: ' + P.dauer + " Minuten</span><span>" + probeMax(P) + " BE</span></div>" +
    '<div class="sh-row sh-small"><span>Hilfsmittel: keine</span><span>Umfang ca. ' + P.min + " Minuten</span></div></header>";
}
function sheetMats(P) {
  return P.mats.map((id, i) => {
    const q = K.quellen.find((x) => x.id === id);
    return '<section class="sheet-mat"><h3>M' + (i + 1) + "</h3>" +
      '<p class="sm-title">' + esc(q.titel) + "</p>" +
      '<p class="sm-meta">' + esc(q.autor) + " · " + esc(q.art) + " · " + esc(q.datum) + (q.adressat ? "<br>Adressat: " + esc(q.adressat) : "") + "</p>" +
      (q.kontext ? '<p class="sm-ctx">' + esc(q.kontext) + "</p>" : "") +
      '<div class="sm-text">' + q.text.map((t) => "<p>" + esc(t) + "</p>").join("") + "</div>" +
      (q.hinweis ? '<p class="sm-note">' + esc(q.hinweis) + "</p>" : "") + "</section>";
  }).join("");
}
function taskHead(P, x, i) {
  const ref = x.kind === "src" && P.mats.length > 1 ? " <span class=\"st-ref\">(M" + (P.mats.indexOf(x.src) + 1) + ")</span>" : "";
  return '<div class="st-h"><span class="st-nr">' + (i + 1) + '</span><span class="st-q">' + firstWordBold(x.q) + ref + '<span class="st-op">' + esc(x.op) + " · AFB " + esc(x.afb) + '</span></span><span class="st-be">' + x.be + " BE</span></div>";
}
function renderProbeRun() {
  const P = S.probe, el = stage();
  const partB = P.tasks.findIndex((x) => x.kind === "frage");
  el.innerHTML = '<div class="pwarn" id="pwarn" hidden></div><article class="sheet">' + sheetHead(P) + sheetMats(P) +
    '<section class="sheet-tasks"><h3>Aufgaben</h3>' + P.tasks.map((x, i) =>
      (i === partB && partB > 0 ? '<h4 class="st-part">Teil B: ohne Material</h4>' : "") +
      '<div class="stask">' + taskHead(P, x, i) + '<textarea class="st-ans" data-pa="' + i + '" placeholder="Deine Antwort">' + esc(P.answers[i] || "") + "</textarea></div>").join("") +
    "</section></article>" +
    '<div class="btn-row" id="psubmit-row">' + (probeConfirm
      ? '<p class="hint" style="margin:0;flex-basis:100%">Wirklich abgeben? Danach kannst du nichts mehr ändern.</p><button class="btn primary" id="pyes" type="button">Ja, abgeben</button><button class="btn" id="pno" type="button">Weiterschreiben</button>'
      : '<button class="btn primary" id="psubmit" type="button">Abgeben</button><button class="btn" id="pcancel" type="button">Probeklausur abbrechen</button>') + "</div>";
  $$("[data-pa]", el).forEach((t) => (t.oninput = () => { P.answers[t.dataset.pa] = t.value; probeSave(); }));
  const sb = $("#psubmit"); if (sb) sb.onclick = () => { probeConfirm = true; keepScroll(renderProbeRun); };
  const no = $("#pno"); if (no) no.onclick = () => { probeConfirm = false; keepScroll(renderProbeRun); };
  const yes = $("#pyes"); if (yes) yes.onclick = () => { stopProbeTimer(); P.state = "korrektur"; P.end = Date.now(); probeConfirm = false; save(); renderProbe(); window.scrollTo(0, 0); };
  const cc = $("#pcancel"); if (cc) cc.onclick = () => { if (confirm("Probeklausur abbrechen? Deine Antworten werden gelöscht.")) { stopProbeTimer(); S.probe = null; save(); renderProbe(); } };
  const tick = () => {
    const rem = P.start + P.dauer * 60000 - Date.now();
    const t = $("#ptimer"), w = $("#pwarn"); if (!t) return stopProbeTimer();
    t.textContent = rem > 0 ? fmtClock(rem) : "0:00";
    t.classList.toggle("warn", rem <= 600000 && rem > 0); t.classList.toggle("over", rem <= 0);
    if (rem <= 0) { w.hidden = false; w.className = "pwarn over"; w.innerHTML = "<b>Die Zeit ist um.</b> Schreib deinen Satz zu Ende und gib ab."; }
    else if (rem <= 600000) { w.hidden = false; w.className = "pwarn"; w.innerHTML = "<b>Noch " + Math.ceil(rem / 60000) + " Minuten.</b> Zeit, zum Ende zu kommen."; }
  };
  $("#tb-right").innerHTML = '<span class="pill ptimer" id="ptimer" aria-live="off"></span>';
  tick(); probeTimer = setInterval(tick, 1000);
}
function renderProbeKorrektur() {
  const P = S.probe, el = stage();
  const pts = probeScore(P), max = probeMax(P), sum = pts.reduce((a, b) => a + b, 0);
  const used = Math.round(((P.end || Date.now()) - P.start) / 60000);
  el.innerHTML = '<div class="kicker">Abgegeben nach ' + used + " von " + P.dauer + ' Minuten</div><h2 class="q" style="margin-top:6px">Selbstkorrektur</h2>' +
    '<p class="hint" style="margin-top:-8px">Vergleich deine Antworten mit dem Erwartungshorizont und hak ab, was wirklich drin ist. Sei streng mit dir, sonst bringt die Schätzung nichts.</p>' +
    P.tasks.map((x, i) => {
      const c = P.checks[i] || {};
      return '<div class="task ktask">' + taskHead(P, x, i) +
        '<div class="k-ans">' + (P.answers[i] && P.answers[i].trim() ? esc(P.answers[i]) : '<span class="hint">Keine Antwort</span>') + "</div>" +
        '<div class="eh-head">Erwartungshorizont</div><ul class="eh">' + x.eh.map((p, j) => '<li><label><input type="checkbox" data-pk="' + i + '" data-j="' + j + '"' + (c[j] ? " checked" : "") + "><span>" + esc(p) + "</span></label></li>").join("") + "</ul>" +
        '<span class="awarded">' + String(pts[i]).replace(".", ",") + " von " + x.be + " BE</span></div>";
    }).join("") +
    '<div class="psum"><span>Zusammen</span><b>' + String(sum).replace(".", ",") + " / " + max + ' BE</b></div>' +
    '<div class="btn-row"><button class="btn primary" id="peval" type="button">Auswerten</button></div>';
  $$("[data-pk]", el).forEach((cb) => (cb.onchange = () => { const i = cb.dataset.pk; (P.checks[i] = P.checks[i] || {})[cb.dataset.j] = cb.checked; save(); keepScroll(renderProbeKorrektur); }));
  $("#peval").onclick = () => {
    const s2 = probeScore(P).reduce((a, b) => a + b, 0), pct = (s2 / max) * 100, np = notenpunkte(pct);
    P.result = { be: s2, max: max, pct: pct, np: np };
    P.state = "fertig";
    (S.probeHist = S.probeHist || []).push({ datum: todayStr(), titel: P.mats.map((id) => K.quellen.find((q) => q.id === id).titel).join(" / "), be: s2, max: max, np: np, dauer: P.dauer, used: used });
    if (S.probeHist.length > 30) S.probeHist = S.probeHist.slice(-30);
    save(); renderProbe(); window.scrollTo(0, 0);
  };
}
function renderProbeResult() {
  const P = S.probe, R = P.result, el = stage();
  const pts = probeScore(P);
  el.innerHTML = '<div class="result"><div class="kicker">Probeklausur ausgewertet</div>' +
    '<div class="big">≈ ' + R.np + ' <span class="big-sub">Punkte</span></div>' +
    "<p><b>" + String(R.be).replace(".", ",") + " von " + R.max + " BE (" + Math.round(R.pct) + " %), das entspricht etwa Note " + npNote(R.np) + ".</b></p>" +
    '<div class="fb warn"><b>Nur eine Selbsteinschätzung.</b>Du hast deine Antworten selbst mit dem Erwartungshorizont verglichen. In der echten Klausur zählen auch Aufbau, Sprache, Belege und Tiefe der Argumentation, und deine Lehrkraft kann einen anderen Notenschlüssel verwenden. Die Zahl ist ein grober Anhaltspunkt, keine Note.</div>' +
    '<div class="pbreak">' + P.tasks.map((x, i) => '<div><span>' + (i + 1) + ". " + esc(x.op) + '</span><span>' + String(pts[i]).replace(".", ",") + " / " + x.be + " BE</span></div>").join("") + "</div>" +
    '<div class="btn-row"><button class="btn primary" id="pnew" type="button">Neue Probeklausur</button><button class="btn" id="pback" type="button">Korrektur ansehen</button></div></div>' +
    probeHistHTML(S.probeHist || []);
  $("#pnew").onclick = () => { S.probe = null; save(); renderProbe(); window.scrollTo(0, 0); };
  $("#pback").onclick = () => { P.state = "korrektur"; save(); renderProbe(); };
}
function probeCardInfo() {
  const P = S.probe, h = S.probeHist || [];
  if (P && P.state === "run") { const rem = P.start + P.dauer * 60000 - Date.now(); return [rem > 0 ? "Läuft: noch " + Math.ceil(rem / 60000) + " Min." : "Zeit ist um, jetzt abgeben", "Weiter →"]; }
  if (P && P.state === "korrektur") return ["Abgegeben, Korrektur offen", "Weiter →"];
  return [h.length ? "Zuletzt: ≈ " + h[h.length - 1].np + " Punkte" : "Noch keine geschrieben", "ca. 75 Min."];
}

/* ---------- Tastatur ---------- */
document.addEventListener("keydown", (e) => {
  const tag = (e.target && e.target.tagName) || "";
  if (tag === "TEXTAREA" || tag === "INPUT" || !K) return;
  if (view === "lernen" && lern && !lern.done) {
    if (e.key === "ArrowLeft") { e.preventDefault(); lernStep(-1); }
    if (e.key === "ArrowRight") { e.preventDefault(); lernStep(1); }
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
