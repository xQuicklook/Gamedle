// Prüft die gebaute Seite: keine Rätsel-Inhalte und keine Spielplan-Lösungen im Klartext, Code in eigenem
// Gültigkeitsbereich (siehe src/gamedle-seal.js). build.ps1 ruft das nach jedem Bauen auf – schlägt es fehl,
// wird nichts veröffentlicht.  Aufruf: node tools/check-bundle.js [gamedar.html]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const file = path.resolve(root, process.argv[2] || 'gamedar.html');
const html = fs.readFileSync(file, 'utf8');
const src = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const ctx = () => ({ Intl, Date, Map, Set, TextEncoder, TextDecoder, btoa, atob });

const C = vm.runInNewContext(`${src('gamedle-content.js')}\n;({ GD_QUOTES, GD_EMOJI_HINTS, GD_SCENES })`, ctx());
const plan = vm.runInNewContext(`${src('gamedle-seal.js')}\n${src('gamedle-schedule.js')}\n;GD_SCHEDULE`, ctx());

const problems = [];
for (const [id, [quote]] of Object.entries(C.GD_QUOTES)) if (html.includes(quote.slice(0, 16))) problems.push(`Zitat von ${id}`);
for (const [id, emoji] of Object.entries(C.GD_EMOJI_HINTS)) if (html.includes(emoji)) problems.push(`Emojis von ${id}`);
for (const [id, [scene]] of Object.entries(C.GD_SCENES)) if (html.includes(scene)) problems.push(`Szene von ${id}`);
// Spiel-IDs als Zeichenkette, wie sie früher im Spielplan standen – außer sie kommen ohnehin als Wort im Code
// vor (z. B. 'pong' als Nachricht der Verbindung); das verrät keine Lösung
const code = [...fs.readdirSync(path.join(root, 'src')).filter(f => f.endsWith('.js') && !/^gamedle-(content|schedule)\.js$/.test(f)).map(src),
  fs.readFileSync(path.join(root, 'vendor', 'peerjs.min.js'), 'utf8')].join('\n');
const quoted = (text, id) => text.includes(`'${id}'`) || text.includes(`"${id}"`);
for (const id of new Set(Object.values(plan).flat())) if (quoted(html, id) && !quoted(code, id)) problems.push(`Spielplan-ID ${id}`);
if (!/<script>\s*\(\(\) => \{\s*'use strict';/.test(html)) problems.push('Code liegt nicht in eigenem Gültigkeitsbereich');

if (problems.length) {
  console.error(`${path.relative(root, file)}: ${problems.length} Lösungen im Klartext – ${problems.slice(0, 8).join(', ')}${problems.length > 8 ? ' …' : ''}`);
  process.exit(1);
}
console.log(`${path.relative(root, file)}: keine Lösungen im Klartext`);
