// Debug-Kopie der gebauten Seite ohne den eigenen Gültigkeitsbereich: Alles ist über die Browser-Konsole
// erreichbar (z. B. Duel.session.room.state.round.gameId) – nur zum Testen, landet in tools/out (nicht im Git).
// Aufruf nach build.ps1: node tools/make-debug.js
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'gamedar.html'), 'utf8');
const open = "(() => {\n'use strict';", close = '\n})();';
const a = html.indexOf(open), b = html.lastIndexOf(close);
if (a < 0 || b < 0) throw new Error('Rahmen des Gültigkeitsbereichs nicht gefunden – erst build.ps1 ausführen.');
html = html.slice(0, a) + "'use strict';" + html.slice(a + open.length, b) + html.slice(b + close.length);
fs.mkdirSync(path.join(root, 'tools', 'out'), { recursive: true });
fs.writeFileSync(path.join(root, 'tools', 'out', 'gamedar-debug.html'), html);
console.log('tools/out/gamedar-debug.html geschrieben');
