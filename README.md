# Gamedle – Spiele erraten & ranken

Zwei Module in einer Seite, ohne Server und ohne Konto:

- **Gamedle** – das tägliche Spiele-Rätsel (wie Loldle/Wordle): Klassik (Eigenschaften vergleichen), Cover (verpixeltes Cover) und Endlos zum Üben.
- **Tierly** – Tier-Listen für Spiele und Franchises, gemeinsam mit Freunden direkt von Browser zu Browser (WebRTC).

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

Gamedle-Daten gegen die Wikipedia-Infoboxen prüfen (braucht Internet):

```bash
node tools/verify-gamedle.js
```

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
| `src/gamedle-core.js` | Tagesrätsel, Vergleich, Suche, Teilen, Statistik |
| `src/gamedle.js` | Gamedle-Oberfläche (Klassik, Cover, Endlos) |
| `src/core.js` | Tierly: Zustand, Aktionen (Reducer), Auswertung, Statistik |
| `src/net.js` | Tierly: P2P, Spieler-Schlüssel, Delta-Sync, Verbindungsdiagnose |
| `src/migration.js` | Tierly: automatische Raum-Übernahme |
| `src/app.js` | Tierly: App-Ablauf, Rendering, Tastatur |
| `src/wiki.js` | Cover, Jahr und Reihe über Wikipedia/Wikidata |
| `tests/` | Tests für Tierly- und Gamedle-Logik |
| `tools/verify-gamedle.js` | Datenprüfung gegen Wikipedia |

PeerJS 1.5.4 (MIT-Lizenz) liegt unter `vendor/`. Cover-Bilder stammen aus der englischsprachigen Wikipedia, die Rechte liegen bei den Publishern.
