# Klausurtrainer: Anleitung für Claude

Statische Lern-Webseite (GitHub Pages) für Dschibraels Klausuren und seine Klasse. Kein Build-Schritt, kein Framework: `index.html` + `style.css` + `app.js` laden die Inhalte zur Laufzeit aus `klausuren/`.

## Neue Klausur hinzufügen (der normale Ablauf)

1. Dschibrael schickt Themenliste, Tafelbilder, Präsentationen.
2. **Nur Stoff aus diesem Material verwenden.** Was aus eigenem Wissen ergänzt wird (weil er es ausdrücklich will), im Text kennzeichnen. Der Lehrer will Zusammenhänge, keine Jahreszahlen, falls nicht anders gesagt.
3. Neue Datei `klausuren/<fach>-<thema>.json` im Format unten anlegen (id = Dateiname ohne `.json`, nur a–z, 0–9, `-`).
4. Eintrag in `klausuren/index.json` ergänzen (id, fach, titel, kurs, datum, beschreibung, farben).
5. **Eintrag in `updates.json` ergänzen** (immer, bei jeder neuen oder deutlich erweiterten Klausur): `{ "datum": "YYYY-MM-DD", "text": "Kalter Krieg ist online", "klausur": "<id>" }`. `klausur` ist optional und wird zum Link. Die Startseite zeigt die neuesten fünf.
6. Prüfen: `node tools/check.js` (validiert alle Klausur-Dateien und `updates.json`), dann committen und pushen. GitHub Pages aktualisiert in 1–2 Minuten.

Steht nur der Termin fest, reicht eine Datei mit den Metadaten. Die Klausurseite zeigt dann „noch kein Lernstoff“. Kommt das Material, wird dieselbe Datei gefüllt (id nicht ändern, damit geteilte Links weiter gehen) und `titel`/`beschreibung` in Datei und `index.json` angepasst.

Alte Klausuren bleiben drin, sie landen automatisch im Archiv, sobald ihr Datum vorbei ist.

## Format einer Klausur-Datei

Alle Abschnitte außer den Metadaten sind optional. Ein Modus erscheint nur, wenn sein Abschnitt Inhalt hat. Spielmodi sind nur Quiz, Ursache-Folge-Ketten und Karteikarten (Zuordnen und Zeitstrahl wurden auf Wunsch entfernt; alte Dateien dürfen `zuordnen`/`zeitstrahl` noch enthalten, sie werden ignoriert, für neue Klausuren nicht mehr anlegen).

```jsonc
{
  "id": "geschichte-kalter-krieg",
  "fach": "Geschichte",
  "titel": "Kalter Krieg",
  "kurs": "Q13",
  "datum": "2026-10-22",                 // Klausurtermin, YYYY-MM-DD
  "beschreibung": "Ein Satz für den Kopf der Seite.",
  "farben": ["#1D4F9D", "#AE2A1F"],       // zwei Akzentfarben (Streifen, Zuordnen-Knöpfe), weißer Text muss darauf lesbar sein

  "themen": [{ "id": "korea", "name": "Koreakrieg" }],   // Filter-Chips; jedes Element unten verweist mit "t" auf eine Themen-id ("all" = themenübergreifend)

  "lernen": [                             // Lernmodus: Karten zum Durchblättern
    { "t": "korea", "name": "Koreakrieg", "cards": [
      { "h": "Merksatz", "p": ["Ein Satz."], "big": true },          // big = hervorgehobene Merksatz-Karte
      { "h": "Ursachen", "p": ["Punkt 1", "Punkt 2"], "tag": "optionale Fußzeile" }
    ] }
  ],
  "quiz": [{ "t": "korea", "q": "Frage?", "a": "richtige Antwort", "falsch": ["f1", "f2", "f3"], "e": "Erklärung" }],
  "ketten": [{ "t": "korea", "titel": "Koreakrieg", "merk": "Merksatz nach dem Prüfen", "schritte": ["Ursache", "…", "Folge"] }],
  "karten": [{ "begriff": "DMZ", "erklaerung": "…", "t": "korea", "typ": "begriff" }],   // typ: "begriff" | "person"
  "quellen": [{
    "id": "truman50", "t": "korea", "titel": "…", "autor": "…", "datum": "27. Juni 1950", "art": "Erklärung", "adressat": "…",
    "kontext": "Hintergrund", "text": ["Absatz 1", "Absatz 2"], "hinweis": "Gekürzt, eigene Übersetzung.",
    "mc": [{ "q": "…", "a": "richtig", "falsch": ["…", "…", "…"] }],
    "aufgaben": [{ "op": "Erläutern", "q": "Aufgabe", "eh": ["Erwartungshorizont-Punkt", "…"] }]
  }],
  "klausur": [{ "t": "korea", "op": "Beurteilen", "q": "Aufgabe", "punkte": ["Musterlösung-Punkt", "…"] }],
  "operatoren": [{ "name": "Erläutern", "afb": "II", "text": "Was verlangt wird." }]
}
```

## Qualitätsregeln für Inhalte

- Quiz: genau eine eindeutig richtige Antwort, Distraktoren plausibel, Erklärung in ein bis zwei Sätzen.
- Quellen: nur Texte, deren Wortlaut gesichert ist. Eigene Übersetzungen als solche kennzeichnen, unsichere als „sinngemäß“. Keine erfundenen Zitate.
- Sprache: Deutsch, klar, Schülerniveau Oberstufe. Keine Gedankenstriche als Satzzeichen.
- Ketten: 5–7 Glieder, jedes Glied folgt eindeutig aus dem vorherigen.

## Startseite und Lernplan

- Seiten: `#/` Startseite (großer Satz, „Los geht's“, „Powered by Dschibrael“, echte Quizfrage aus der nächsten Klausur mit Quiz als Vorschau), `#/klausuren` (Karten mit Countdown, Buttons „Lernen“/„Lernplan“, Archiv), `#/kalender` (Monatsansicht aus `klausuren/index.json`, „In meinen Kalender“ erzeugt eine .ics-Datei), `#/updates` (neueste fünf aus `updates.json`). Diese drei Namen dürfen keine Klausur-id sein. Die Leiste oben verlinkt die Seiten. Die Handy-App startet direkt bei `#/klausuren`.
- Lernplan (`#/<id>/lernplan`): erscheint, sobald die Klausur `themen` und Lernkarten oder Quiz hat. Phase 1 pro Thema Lernkarten + Quiz, Phase 2 gemischte Wiederholung (Quiz gemischt, Karteikarten, Ketten, Quellen mit je 20 Minuten), letzter Tag roter Faden (Lernkarten-Eintrag mit `"t": "all"`) + Klausurfragen. Minuten pro Aufgabe stehen in `PLAN_MIN` in `app.js`. Plan und Haken liegen in `kt:<id>` (`plan`, `planDone`).
- Design: an tmua.io angelehnt, aber schwarz. Weiße Schrift, Grautöne, Schrift Inter, runde Knöpfe, viel Abstand. Keine grünen Deko-Akzente; Grün/Rot nur für richtig/falsch und Warnungen. Fächerfarben (`farben`) nur auf Streifen und Punkten der jeweiligen Klausur.

## Technik

- Fortschritt liegt in `localStorage` unter `kt:<id>`, pro Gerät. Kein Server, keine Konten.
- Routing per Hash: `#/` Startseite, `#/klausuren` | `#/kalender` | `#/updates` Unterseiten, `#/<id>` Klausur, `#/<id>/<modus>[/<quelle-id>]`.
- `sw.js` macht die Seite offline nutzbar (Netz zuerst, Cache als Rückfall). Bei Änderungen an `sw.js` den Cache-Namen hochzählen.
- Lokal testen: `python3 -m http.server` im Repo-Ordner, dann http://localhost:8000 (fetch geht nicht über file://).
