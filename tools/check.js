// Prüft alle Klausur-Dateien: node tools/check.js
const fs = require("fs"), path = require("path");
const dir = path.join(__dirname, "..", "klausuren");
let errors = 0;
const err = (f, m) => { errors++; console.log("FEHLER " + f + ": " + m); };
const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json");
for (const e of index) if (!files.includes(e.id + ".json")) err("index.json", "Datei fehlt für " + e.id);
for (const f of files) {
  let K;
  try { K = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch (e) { err(f, "kein gültiges JSON: " + e.message); continue; }
  if (K.id + ".json" !== f) err(f, "id passt nicht zum Dateinamen");
  if (["klausuren", "probeklausur", "kalender", "updates"].includes(K.id)) err(f, "id ist für eine Seite reserviert");
  if (!index.some((e) => e.id === K.id)) err(f, "fehlt in index.json");
  for (const k of ["fach", "titel"]) if (!K[k]) err(f, "Feld fehlt: " + k);
  if (K.datum && !/^\d{4}-\d{2}-\d{2}$/.test(K.datum)) err(f, "datum muss YYYY-MM-DD sein");
  const tids = new Set((K.themen || []).map((t) => t.id).concat(["all"]));
  const checkT = (sec, arr) => (arr || []).forEach((x, i) => { if (x.t !== undefined && !tids.has(x.t)) err(f, sec + "[" + i + "] unbekanntes Thema " + x.t); });
  ["lernen", "quiz", "zeitstrahl", "ketten", "karten", "quellen", "klausur"].forEach((s) => checkT(s, K[s]));
  (K.quiz || []).forEach((q, i) => {
    if (!q.q || !q.a || !Array.isArray(q.falsch) || q.falsch.length < 1) err(f, "quiz[" + i + "] unvollständig");
    if ((q.falsch || []).includes(q.a)) err(f, "quiz[" + i + "] richtige Antwort steht auch bei falsch");
  });
  (K.lernen || []).forEach((l, i) => (l.cards || []).forEach((c, j) => { if (!c.h || !Array.isArray(c.p) || !c.p.length) err(f, "lernen[" + i + "].cards[" + j + "] unvollständig"); }));
  if (K.zuordnen) {
    if (!K.zuordnen.a || !K.zuordnen.b) err(f, "zuordnen braucht a und b");
    (K.zuordnen.items || []).forEach((it, i) => { if (!Array.isArray(it) || !["a", "b"].includes(it[1])) err(f, "zuordnen.items[" + i + "] muss [text, \"a\"|\"b\"] sein"); });
  }
  if (K.zeitstrahl && K.zeitstrahl.length) {
    if (new Set(K.zeitstrahl.map((z) => z.jahr)).size < 5) err(f, "zeitstrahl braucht mindestens 5 verschiedene Jahre");
    K.zeitstrahl.forEach((z, i) => { if (typeof z.jahr !== "number") err(f, "zeitstrahl[" + i + "].jahr muss eine Zahl sein"); });
  }
  (K.ketten || []).forEach((k, i) => { if (!Array.isArray(k.schritte) || k.schritte.length < 3) err(f, "ketten[" + i + "] braucht mindestens 3 Schritte"); });
  (K.karten || []).forEach((k, i) => { if (!k.begriff || !k.erklaerung) err(f, "karten[" + i + "] unvollständig"); });
  const qids = new Set();
  (K.quellen || []).forEach((q, i) => {
    if (!q.id || qids.has(q.id)) err(f, "quellen[" + i + "] id fehlt oder doppelt"); qids.add(q.id);
    if (!Array.isArray(q.text) || !q.text.length) err(f, "quellen[" + i + "] text fehlt");
    (q.mc || []).forEach((m, j) => { if (!m.a || !Array.isArray(m.falsch)) err(f, "quellen[" + i + "].mc[" + j + "] unvollständig"); });
    (q.aufgaben || []).forEach((a, j) => { if (!a.q || !Array.isArray(a.eh)) err(f, "quellen[" + i + "].aufgaben[" + j + "] unvollständig"); });
  });
  if (K.probe && K.probe.pflicht && !tids.has(K.probe.pflicht)) err(f, "probe.pflicht ist kein bekanntes Thema");
  (K.klausur || []).forEach((k, i) => { if (!k.q || !Array.isArray(k.punkte)) err(f, "klausur[" + i + "] unvollständig"); });
  console.log("geprüft: " + f);
}
// Updates auf der Startseite
try {
  const ups = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "updates.json"), "utf8"));
  if (!Array.isArray(ups)) err("updates.json", "muss eine Liste sein");
  else ups.forEach((u, i) => {
    if (!u.datum || !/^\d{4}-\d{2}-\d{2}$/.test(u.datum)) err("updates.json", "[" + i + "] datum muss YYYY-MM-DD sein");
    if (!u.text) err("updates.json", "[" + i + "] text fehlt");
    if (u.klausur && !index.some((e) => e.id === u.klausur)) err("updates.json", "[" + i + "] unbekannte Klausur " + u.klausur);
  });
  console.log("geprüft: updates.json");
} catch (e) { err("updates.json", "fehlt oder kein gültiges JSON: " + e.message); }
console.log(errors ? errors + " Fehler" : "Alles in Ordnung.");
process.exit(errors ? 1 : 0);
