# Tierly – Videospiele gemeinsam ranken

Tier-Listen für Spiele und Franchises, gemeinsam mit Freunden – direkt von Browser zu Browser (WebRTC), ohne eigenen Server.

## Benutzen

- **Als Datei:** `tierly.html` im Browser öffnen und an Freunde schicken. Sie öffnen dieselbe Datei und geben den Raum-Code ein.
- **Als Link (empfohlen):** Über GitHub Pages (siehe unten). Dann reicht ein Link wie `https://…/#ABC123`.

## Bauen & Testen

```bash
powershell -ExecutionPolicy Bypass -File build.ps1
```

```bash
node --test tests/core.test.js
```

`build.ps1` setzt `src/*` und `vendor/peerjs.min.js` zu einer einzigen Datei zusammen (`tierly.html` und `docs/index.html`).

## Als Link veröffentlichen (GitHub Pages)

Es wird nur eine statische Datei ausgeliefert – kein Server-Code. Der Raum lebt weiterhin im Browser des Hosts.

GitHub Pages veröffentlicht den Ordner `docs/` aus dem Branch `main`. Nach einer Änderung:

```bash
powershell -ExecutionPolicy Bypass -File build.ps1
```

```bash
git add -A
```

```bash
git commit -m "Tierly aktualisiert"
```

```bash
git push
```

Nach ein bis zwei Minuten ist die neue Version online.

Hinweis: Die Seite ist öffentlich erreichbar. Zugang zu einem Raum hat trotzdem nur, wer den Code kennt – und solange verdeckt gerankt wird, sehen Gäste nur ihre eigene Liste.

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `src/core.js` | Zustand, Aktionen (Reducer), Auswertung, Statistik |
| `src/net.js` | P2P: Beitritt, Spieler-Schlüssel, Delta-Sync (ops), Verbindungsdiagnose |
| `src/migration.js` | Automatische Raum-Übernahme, wenn der Host ausfällt |
| `src/app.js` | App-Ablauf, Rendering, Tastatur |
| `src/wiki.js` | Cover, Jahr und Reihe über Wikipedia/Wikidata |
| `src/reveal.js` | Verdecktes Ranken & Aufdecken |
| `src/undo.js` | Rückgängig/Wiederholen |
| `tests/core.test.js` | Tests für die Kernlogik |

PeerJS 1.5.4 (MIT-Lizenz) liegt unter `vendor/`.
