# Gamedle – Spiele erraten & ranken

Zwei Module in einer Seite, ohne Server und ohne Konto:

- **Gamedle** – das tägliche Spiele-Rätsel (wie Loldle/Wordle) mit fünf Tagesmodi: Klassik (Eigenschaften vergleichen), Zitat, Emoji, Cover (verpixelt) und Szene (Bildausschnitt, der herauszoomt) – dazu Endlos zum Üben. Unter jedem Rätsel steht die Lösung von gestern.
- **Tierly** – Tier-Listen für Spiele und Franchises, gemeinsam mit Freunden direkt von Browser zu Browser (WebRTC). Mehrere Spiele lassen sich auf einmal einsortieren (Strg-/Umschalt-Klick oder „Mehrere“), die Spieleliste lässt sich nach Jahrzehnt und Genre filtern. Stufen mit „Nicht werten“ (z. B. „Nicht gespielt“) zählen nicht fürs Gruppenergebnis und die Statistik.

**Live:** https://xquicklook.github.io/Gamedle/

## Benutzen

- **Als Link (empfohlen):** https://xquicklook.github.io/Gamedle/ – Tierly-Einladungen sehen aus wie `…/Gamedle/#ABC123`.
- **Als Datei:** `gamedle.html` im Browser öffnen (enthält beide Module).

## Bauen & Testen

```bash
powershell -ExecutionPolicy Bypass -File build.ps1
```

```bash
node --test "tests/*.test.js"
```

`build.ps1` setzt `src/*` und `vendor/peerjs.min.js` zu einer einzigen Datei zusammen (`gamedle.html` und `docs/index.html`).

Gamedle-Daten gegen die Wikipedia-Infoboxen prüfen – inklusive Zitate (müssen wörtlich auf ihrer Wikiquote-Seite stehen) und Szenen-Bilder (braucht Internet):

```bash
node tools/verify-gamedle.js
```

## Neue Spiele für Gamedle

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

### Inhalte für Zitat, Emoji und Szene

Liegen in `src/gamedle-content.js` (Schlüssel ist die Spiel-ID). Ein Spiel taucht in einem Modus nur auf, wenn es dort einen Eintrag hat:

- **Emoji:** genau fünf Emojis, vom vagen zum deutlichen Hinweis. Nur Emojis bis Unicode 12 und keine Flaggen (Windows 10 zeigt sonst Kästchen bzw. Buchstaben).
- **Zitat:** `[Text in Originalsprache, Sprecher, Wikiquote-Seite]` – das Zitat muss wörtlich auf der Seite stehen und darf den Titel nicht verraten (prüfen Test und `verify-gamedle.js`).
- **Szene:** Dateiname eines Bildes aus dem Wikipedia-Artikel (echte Spielszene, kein Titel/Logo im Bild), optional mit Ausschnitt-Mittelpunkt in Prozent.

Danach wie oben `node tools/gamedle-schedule.js` – neue Einträge werden an den Plan des Modus angehängt.

Das Vorschaubild für Link-Vorschauen (`assets/og.png`) erzeugt `tools/make-og.ps1`.

## Veröffentlichen (GitHub Pages)

Bei jedem Push auf `main` testet und baut eine GitHub Action (`.github/workflows/pages.yml`) das Projekt und veröffentlicht erst dann – schlägt ein Test fehl, bleibt die alte Version online. Nach einer Änderung:

```bash
powershell -ExecutionPolicy Bypass -File build.ps1
```

```bash
git add -A
```

```bash
git commit -m "Gamedle aktualisiert"
```

```bash
git push
```

Nach ein bis zwei Minuten ist die neue Version online.

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `src/hub.js` | Übersicht & Navigation (`#/`, `#/gamedle`, `#/tierly`, Raum-Codes) |
| `src/gamedle-data.js` | Kuratierte Spieldaten (≈200 Spiele, geprüft gegen Wikipedia) |
| `src/gamedle-content.js` | Emojis, Zitate (geprüft gegen Wikiquote) und Szenen-Bilder |
| `src/gamedle-core.js` | Tagesrätsel, Vergleich, Suche, Teilen, Statistik |
| `src/gamedle.js` | Gamedle-Oberfläche (Klassik, Zitat, Emoji, Cover, Szene, Endlos) |
| `src/core.js` | Tierly: Zustand, Aktionen (Reducer), Auswertung, Statistik |
| `src/net.js` | Tierly: P2P, Spieler-Schlüssel, Delta-Sync, Verbindungsdiagnose |
| `src/migration.js` | Tierly: automatische Raum-Übernahme |
| `src/app.js` | Tierly: App-Ablauf, Rendering, Tastatur |
| `src/wiki.js` | Cover, Jahr, Reihe und Genres über Wikipedia/Wikidata (Genres zuerst aus den Gamedle-Daten) |
| `tests/` | Tests für Tierly- und Gamedle-Logik |
| `tools/verify-gamedle.js` | Datenprüfung gegen Wikipedia |

PeerJS 1.5.4 (MIT-Lizenz) liegt unter `vendor/`. Cover- und Szenen-Bilder stammen aus der englischsprachigen Wikipedia bzw. Wikimedia Commons, die Rechte liegen bei den Publishern. Zitate sind kurze Auszüge aus den Spielen, belegt über Wikiquote.
