// Übernimmt die auf der Prüfseite (tools/catalog-review.html) übernommenen Spiele in den Katalog.
// Ausführen: node tools/catalog-apply.js <katalog-entscheidungen.json>
//
// Neue Spiele landen in CATALOG_EXTRA (src/catalog.js), nach Jahr sortiert. Spiele, die schon im
// Katalog stehen (gleicher Wikipedia-Artikel), werden übersprungen – die Datei lässt sich also
// gefahrlos mehrfach anwenden. Danach: Tests laufen lassen und bauen.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { norm } = require('./lib-wikipedia');

const file = process.argv[2];
if (!file) { console.log('Aufruf: node tools/catalog-apply.js <katalog-entscheidungen.json>'); process.exit(1); }
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
if (data.app !== 'tierly-catalog-review') { console.error('Keine Export-Datei der Prüfseite.'); process.exit(1); }

const SRC = path.join(__dirname, '..', 'src');
const catalogFile = path.join(SRC, 'catalog.js');
const code = fs.readFileSync(catalogFile, 'utf8');
const C = vm.runInNewContext(`${fs.readFileSync(path.join(SRC, 'gamedle-data.js'), 'utf8')}\n${code}\n;({ CATALOG, CATALOG_EXTRA, GD_GENRES, GD_PLATFORMS, GD_MODES })`, { norm });

const known = new Set(C.CATALOG.map(g => g.wiki));
const names = new Set(C.CATALOG.map(g => norm(g.name)));
const rows = [...C.CATALOG_EXTRA];
const problems = [];
let added = 0;
for (const g of data.accepted || []) {
  if (known.has(g.wiki)) continue;
  const name = String(g.name || g.title).trim();
  const bad = [
    !(g.year >= 1970 && g.year <= 2030) && 'Jahr',
    !g.plats?.length && 'Plattform',
    !g.modes?.length && 'Spielmodus',
    g.genres?.some(k => !C.GD_GENRES[k]) && 'Genre',
    g.plats?.some(k => !C.GD_PLATFORMS[k]) && 'Plattform',
    g.modes?.some(k => !C.GD_MODES[k]) && 'Spielmodus',
    names.has(norm(name)) && 'Name schon vergeben (Jahr anhängen?)',
  ].filter(Boolean);
  if (bad.length) { problems.push(`${name}: ${bad.join(', ')}`); continue; }
  // Der Wikipedia-Titel bleibt als Alternativname auffindbar, wenn der Anzeigename abweicht
  const aliases = [...new Set([g.title, ...(g.aliases || [])].map(s => String(s).trim()).filter(s => s && norm(s) !== norm(name)))];
  rows.push([name, g.year, (g.genres || []).join(','), g.plats.join(','), g.series || '', g.modes.join(','), g.wiki === name ? '' : g.wiki, aliases.join('|')]);
  known.add(g.wiki); names.add(norm(name));
  added++;
}

// Zeilen im Stil der Datendateien: einfache Anführungszeichen, leere Felder am Ende weglassen
const q = s => (typeof s === 'number' ? String(s) : s.includes("'") ? JSON.stringify(s) : `'${s}'`);
const line = r => {
  const cells = [...r];
  while (cells.length > 6 && !cells[cells.length - 1]) cells.pop();
  return `  [${cells.map(q).join(', ')}],`;
};
rows.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0], 'de'));
const block = `const CATALOG_EXTRA = [\n${rows.map(line).join('\n')}\n];`;
const next = code.replace(/const CATALOG_EXTRA = \[[\s\S]*?\n\];/, block);
if (next === code && added) throw new Error('CATALOG_EXTRA nicht gefunden');
fs.writeFileSync(catalogFile, next);

console.log(`${added} Spiele hinzugefügt – der Katalog hat jetzt ${C.CATALOG.length + added} Spiele.`);
if (problems.length) console.log(`\nNicht übernommen (bitte auf der Prüfseite korrigieren und neu exportieren):\n- ${problems.join('\n- ')}`);
console.log('\nWeiter: node --test "tests/*.test.js" und powershell -ExecutionPolicy Bypass -File build.ps1');
