# Gamedar – Spiele erraten & ranken

Zwei Module in einer Seite, ohne Server und ohne Konto:

- **Gamedar** – das tägliche Spiele-Rätsel (wie Loldle/Wordle) mit fünf Tagesmodi: Klassik (Eigenschaften vergleichen), Zitat, Emoji, Cover (verpixelt) und Szene (Bildausschnitt, der herauszoomt) – dazu Endlos zum Üben. Unter jedem Rätsel steht die Lösung von gestern. Im **Duell** raten zwei Spieler gleichzeitig dasselbe Spiel: als Punkte-Duell (5 Runden, je schneller, desto mehr Punkte) oder Best-of 3/5/7; Bilanz gegen Freunde und eine kleine Bestenliste bleiben im eigenen Browser.
- **Tiercrew** – Tier-Listen für Spiele und Franchises, gemeinsam mit Freunden direkt von Browser zu Browser (WebRTC). Mehrere Spiele lassen sich auf einmal einsortieren (Strg-/Umschalt-Klick oder „Mehrere“), die Spieleliste lässt sich nach Jahrzehnt und Genre filtern. Unter „Reihe“ lädt man eine ganze Spielereihe von Wikidata (Ableger und Neuauflagen sind abwählbar). Die Spiele eines Raums lassen sich als Link teilen (`#/paket/…`, komprimiert im Link – kein Server); wer ihn öffnet, kann sie in seinen eigenen Raum übernehmen. Stufen mit „Nicht werten“ (z. B. „Nicht gespielt“) zählen nicht fürs Gruppenergebnis und die Statistik.

**Live:** https://xquicklook.github.io/Gamedle/

> **Frühere Namen:** Gamedar hieß bis Oktober 2026 „Gamedle“, Tiercrew „Tierly“. Intern (Dateinamen, Code, Speicherschlüssel `tierly.*`/`gd.*`, PeerJS-Präfix, Repository und Adresse) bleiben die alten Namen – so bleiben Statistiken, Räume und geteilte Links gültig. Die alten Adressen `#/gamedle…` und `#/tierly` leiten auf `#/gamedar…` bzw. `#/tiercrew` um.

## Benutzen

- **Als Link (empfohlen):** https://xquicklook.github.io/Gamedle/ – Tiercrew-Einladungen sehen aus wie `…/Gamedle/#ABC123`, Duell-Einladungen wie `…/Gamedle/#/gamedar/duell/ABC123`. Für ein Duell braucht es zwei Geräte oder zwei verschiedene Browser (im selben Browser gilt man als derselbe Spieler).
- **Als Datei:** `gamedar.html` im Browser öffnen (enthält beide Module).

## Bauen & Testen

```bash
powershell -ExecutionPolicy Bypass -File build.ps1
```

```bash
node --test "tests/*.test.js"
```

`build.ps1` setzt `src/*` und `vendor/peerjs.min.js` zu einer einzigen Datei zusammen (`gamedar.html` und `docs/index.html`). Dafür braucht es Node.js: Die Rätsel-Inhalte werden dabei versiegelt (siehe [Lösungen verschleiern](#lösungen-verschleiern)), und `tools/check-bundle.js` prüft danach, dass keine Lösung im Klartext in der Seite steht – sonst bricht der Build ab und nichts wird veröffentlicht.

Lokal ansehen: `node tools/serve.js`, dann http://localhost:5180/.

Gamedar-Daten gegen die Wikipedia-Infoboxen prüfen – inklusive Zitate (müssen wörtlich auf ihrer Wikiquote-Seite stehen) und Szenen-Bilder (braucht Internet):

```bash
node tools/verify-gamedle.js
```

## Spielekatalog

Beide Module nutzen einen gemeinsamen Katalog (`src/catalog.js`):

- **Gamedar-Spiele** (`src/gamedle-data.js`) – vollständig gegen Wikipedia geprüft. Sie sind zugleich Tiercrew-Startspiele.
- **Nur für Tiercrew** (`CATALOG_EXTRA` in `src/catalog.js`) – Basisdaten genügen (Jahr, Genres, Plattform, Reihe, Spielmodi). Sobald ein Spiel mit allen Rätsel-Angaben geprüft ist, zieht es nach `gamedle-data.js` um (der Test meldet doppelte Einträge).
- **Kurznamen** (`CATALOG_SHORT`) – kürzere bzw. deutsche Namen für Tiercrew, z. B. „Zelda: Ocarina of Time“. Jeder Kurzname muss ein Alternativname des Spiels sein.

Die Tiercrew-Pakete (`src/presets.js`) sind Filter über den Katalog – nach Jahrzehnt, Genre, Plattform, Spielweise und Reihe. Ein neues Spiel landet so automatisch in allen passenden Paketen; Pakete unter 12 Spielen (Jahrzehnte und Reihen: unter 5) bleiben ausgeblendet, bis der Katalog groß genug ist.

### Katalog erweitern

1. Vorschläge holen – die bekanntesten Spiele auf Wikidata (gemessen an der Zahl der Wikipedia-Sprachversionen), die noch fehlen:

   ```bash
   node tools/catalog-candidates.js 380
   ```

   Vorab-Entscheidungen (Ausschuss mit Begründung, korrigierte Felder) stehen in `tools/catalog-curation.json` und werden bei jedem Lauf wieder angewendet.

2. `tools/catalog-review.html` im Browser öffnen (Doppelklick genügt), jedes Spiel prüfen und übernehmen oder verwerfen – Tasten <kbd>J</kbd>/<kbd>K</kbd>, <kbd>A</kbd>, <kbd>X</kbd>. Der Stand bleibt im Browser gespeichert, am Ende „Exportieren“.

3. Die exportierte Datei übernehmen, dann testen und bauen:

   ```bash
   node tools/catalog-apply.js katalog-entscheidungen.json
   ```

Plattformen meinen wie bei Gamedar die Plattformen *zum Start* – sie entscheiden über die Exklusiv-Pakete (Nintendo, PlayStation …).

### Katalog-Spiele nach Gamedar holen

Bekannte Tiercrew-Spiele bekommen die vollen Rätsel-Angaben und ziehen nach `gamedle-data.js` um:

```bash
node tools/promote-games.js 100
```

Das schreibt Entwürfe nach `tools/out/promote-draft.js` (Entwickler/Publisher aus der Infobox, Land aus Wikidata, Perspektive geschätzt) – jede Zeile prüfen und korrigieren, dann:

```bash
node tools/promote-games.js --apply tools/out/promote-draft.js
```

Danach wie bei neuen Spielen `node tools/verify-gamedle.js` und `node tools/gamedle-schedule.js` – die Spiele werden ans Ende des Spielplans gehängt, bestehende Tage bleiben gleich.

## Neue Spiele für Gamedar

1. Entwürfe aus Wikipedia erzeugen lassen (mit `PRÜFEN` markierte Felder von Hand kontrollieren – vor allem die Plattform *bei Erstveröffentlichung* und die Perspektive):

   ```bash
   node tools/add-games.js "Tunic" "Inside" "Titanfall 2"
   ```

2. Die Zeilen in `src/gamedle-data.js` einfügen und prüfen:

   ```bash
   node tools/verify-gamedle.js
   ```

3. Die neuen Spiele an den festen Rätsel-Spielplan anhängen (bestehende Tage bleiben unverändert):

   ```bash
   node tools/gamedle-schedule.js
   ```

Spiele nie löschen oder umbenennen (die ID entsteht aus dem Titel) – nur Daten korrigieren. Fehlt der Schritt 3, schlägt der Test fehl und nichts wird veröffentlicht.

Der Spielplan ist versiegelt. Im Klartext ansehen (verrät die kommenden Lösungen!):

```bash
node tools/gamedle-schedule.js --show quote
```

### Inhalte für Zitat, Emoji und Szene

Liegen in `src/gamedle-content.js` (Schlüssel ist die Spiel-ID). Ein Spiel taucht in einem Modus nur auf, wenn es dort einen Eintrag hat:

- **Emoji:** genau fünf Emojis, vom vagen zum deutlichen Hinweis. Nur Emojis bis Unicode 12 und keine Flaggen (Windows 10 zeigt sonst Kästchen bzw. Buchstaben).
- **Zitat:** `[Text in Originalsprache, Sprecher, Wikiquote-Seite]` – das Zitat muss wörtlich auf der Seite stehen und darf den Titel nicht verraten (prüfen Test und `verify-gamedle.js`).
- **Szene:** Dateiname eines Bildes aus dem Wikipedia-Artikel (echte Spielszene, kein Titel/Logo im Bild), optional mit Ausschnitt-Mittelpunkt in Prozent.

Danach wie oben `node tools/gamedle-schedule.js` – neue Einträge werden an den Plan des Modus angehängt.

### Lösungen verschleiern

Damit niemand kommende Lösungen im Quelltext nachliest oder per Strg+F den angezeigten Hinweis findet (`src/gamedle-seal.js`):

- **Spielplan:** liegt auch im Repository nur versiegelt vor; `tools/gamedle-schedule.js` pflegt ihn. Die Tests prüfen Fingerabdrücke statt Lösungen.
- **Zitate, Emojis, Szenen:** bleiben in `src/gamedle-content.js` lesbar und werden beim Bauen versiegelt (`tools/seal-content.js`).
- **Seite:** Der ganze Code läuft in einem eigenen Gültigkeitsbereich – nichts davon ist über die Browser-Konsole abrufbar.
- **Browser-Speicher:** Die Lösung eines angefangenen Rätsels und die Szenen-Adressen werden versiegelt gespeichert.

Das ist Verschleierung, kein echtes Geheimnis: Wer den Code liest und ausführt, kommt an alles heran, und Bildadressen sind in den Entwicklerwerkzeugen sichtbar. Das geht nur mit einem Server.

Das Vorschaubild für Link-Vorschauen (`assets/og.png`) erzeugt `tools/make-og.ps1`.

## Duell

Zwei Spieler, ein Spiel je Runde, wer zuerst trifft, gewinnt. Ohne eigenen Server – aber so gebaut, dass später einer den Schiedsrichter übernehmen kann:

- **Schiedsrichter** (`src/duel-core.js`): wählt Modus und Spiel (nie ein Tagesrätsel von heute bis in 7 Tagen, nie doppelt), gibt die Hinweise nach Zeit frei (alle 12 s eine Stufe), prüft Tipps (2 s Sperre nach Fehltipp) und vergibt Punkte bzw. Rundensiege. Reiner JSON-Zustand, Zeit und Zufall kommen von außen – deshalb gründlich testbar und auf einem Server unverändert lauffähig.
- **Verbindung** (`src/duel-net.js`): Der Browser des Erstellers führt den Schiedsrichter, der Gast ist per PeerJS verbunden (eigenes Präfix `gamedar-duel-v1-`). Beide bekommen Ansichten (`duelView`) – die Lösung erst nach Rundenende. Bilder schickt der Ersteller als fertige Stufe (verpixeltes Cover, Szenen-Ausschnitt), nie die Adresse. Tipps des Gasts werden um die gemessene Laufzeit (höchstens 300 ms) früher gewertet; nach einem Abbruch bleiben 15 s zum Wiederverbinden.
- **Oberfläche** (`src/duel.js`) und **Historie** (`src/duel-history.js`): Lobby, Runde, Auflösung, Ergebnis, Revanche; Bilanz gegen Freunde und Bestenliste nur im eigenen Browser.

Was bleibt: Der Ersteller könnte mit Entwicklerwerkzeugen die Lösung sehen, und eine Rangliste für alle braucht einen Server. Beides löst später ein Server, der den Platz des Erstellers einnimmt.

### Duell lokal testen

```bash
node tools/serve.js
```

Dann http://localhost:5180/ und http://127.0.0.1:5180/ öffnen – zwei Adressen haben getrennten Speicher und sind damit zwei Spieler (im selben Browser unter derselben Adresse gilt man als derselbe Spieler).

Um eine Runde gezielt zu gewinnen, gibt es eine Debug-Kopie, in der alles über die Browser-Konsole erreichbar ist (landet in `tools/out`, nicht im Git):

```bash
node tools/make-debug.js
```

Sie liegt dann unter `…:5180/tools/out/gamedar-debug.html`; beim Ersteller verrät `Duel.session.room.state.round.gameId` die Lösung der laufenden Runde.

## Veröffentlichen (GitHub Pages)

Bei jedem Push auf `main` testet und baut eine GitHub Action (`.github/workflows/pages.yml`) das Projekt und veröffentlicht erst dann – schlägt ein Test fehl, bleibt die alte Version online. Nach einer Änderung:

```bash
powershell -ExecutionPolicy Bypass -File build.ps1
```

```bash
git add -A
```

```bash
git commit -m "Gamedar aktualisiert"
```

```bash
git push
```

Nach ein bis zwei Minuten ist die neue Version online.

Zusätzlich prüft jeden Montag eine zweite Action (`.github/workflows/media-check.yml`), ob Cover, Szenen-Bilder und Zitate auf Wikipedia/Wikiquote noch da sind (`node tools/verify-gamedle.js --media`). Fehlt etwas, schlägt sie fehl und GitHub schickt eine Mail – dann das betroffene Bild bzw. Zitat in `src/gamedle-content.js` ersetzen.

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `src/hub.js` | Übersicht & Navigation (`#/`, `#/gamedar`, `#/tiercrew`, Raum-Codes; alte Adressen leiten um) |
| `src/catalog.js` | Gemeinsamer Spielekatalog (Gamedar-Spiele + Tiercrew-Extras, Kurznamen) |
| `src/presets.js` | Tiercrew-Pakete (Filter über den Katalog) und Stufen-Vorlagen |
| `src/gamedle-data.js` | Kuratierte Spieldaten (≈300 Spiele, geprüft gegen Wikipedia) |
| `src/gamedle-content.js` | Emojis, Zitate (geprüft gegen Wikiquote) und Szenen-Bilder |
| `src/gamedle-seal.js` | Versiegeln von Spielplan und Rätsel-Inhalten |
| `src/gamedle-core.js` | Tagesrätsel, Vergleich, Suche, Teilen, Statistik |
| `src/duel-core.js` | Gamedar-Duell: Schiedsrichter (Spielauswahl, Hinweise nach Zeit, Tipps, Punkte, Best-of) – ohne Oberfläche und Netz, später auch auf einem Server lauffähig |
| `src/duel-net.js` | Gamedar-Duell: Verbindung (PeerJS), Host führt den Schiedsrichter, Laufzeitausgleich, Wiederverbinden, Bilder nur als fertige Stufe |
| `src/gamedle.js` | Gamedar-Oberfläche (Klassik, Zitat, Emoji, Cover, Szene, Endlos) |
| `src/duel-history.js` | Gamedar-Duell: eigene Historie (nur im Browser) – Bilanz je Gegner, Punkte im Monat, Bestenliste der Punkte-Duelle |
| `src/duel.js` | Gamedar-Duell: Oberfläche (Lobby mit Historie, Warten, Runde mit Uhr, Auflösung, Ergebnis, Revanche) unter `#/gamedar/duell[/CODE]` |
| `src/core.js` | Tiercrew: Zustand, Aktionen (Reducer), Auswertung, Statistik |
| `src/net.js` | Tiercrew: P2P, Spieler-Schlüssel, Delta-Sync, Verbindungsdiagnose |
| `src/migration.js` | Tiercrew: automatische Raum-Übernahme |
| `src/app.js` | Tiercrew: App-Ablauf, Rendering, Tastatur |
| `src/wiki.js` | Cover, Jahr, Reihe und Genres über Wikipedia/Wikidata (Genres zuerst aus den Gamedar-Daten) |
| `tests/` | Tests für Tiercrew-, Gamedar- und Duell-Logik |
| `tools/verify-gamedle.js` | Datenprüfung gegen Wikipedia |
| `tools/gamedle-schedule.js`, `seal-content.js` | Spielplan pflegen (versiegelt), Inhalte beim Bauen versiegeln |
| `tools/check-bundle.js` | Prüft die gebaute Seite auf Lösungen im Klartext (Teil von `build.ps1`) |
| `tools/serve.js`, `make-debug.js` | Lokaler Webserver; Debug-Kopie fürs Testen des Duells |
| `tools/catalog-candidates.js`, `catalog-review.html`, `catalog-apply.js` | Katalog erweitern: Vorschläge, Prüfseite, Übernahme |
| `tools/promote-games.js` | Katalog-Spiele mit vollen Rätsel-Angaben nach Gamedar holen |

PeerJS 1.5.4 (MIT-Lizenz) liegt unter `vendor/`. Cover- und Szenen-Bilder stammen aus der englischsprachigen Wikipedia bzw. Wikimedia Commons, die Rechte liegen bei den Publishern. Zitate sind kurze Auszüge aus den Spielen, belegt über Wikiquote.
