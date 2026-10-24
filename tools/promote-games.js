// Holt bekannte Spiele aus dem Katalog (CATALOG_EXTRA) nach Gamedle.
//
// 1. Entwurf:  node tools/promote-games.js 100
//    Wählt die bekanntesten Tierly-Spiele (Zahl der Wikipedia-Sprachversionen) und ergänzt die
//    Rätsel-Angaben: Entwickler/Publisher aus der Wikipedia-Infobox, Herkunftsland aus Wikidata,
//    Genres/Plattformen/Reihe/Spielmodi aus dem Katalog. Perspektive ist geschätzt (PRÜFEN!).
//    → tools/out/promote-draft.js zum Prüfen und Korrigieren
// 2. Übernahme: node tools/promote-games.js --apply tools/out/promote-draft.js
//    Hängt die Zeilen an GD_GAMES an, nimmt die Spiele aus CATALOG_EXTRA und trägt Kurznamen
//    (CATALOG_SHORT) sowie Spiele ohne Cover (GD_NO_COVER) ein.
// 3. Danach: node tools/verify-gamedle.js · node tools/gamedle-schedule.js · Tests
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { sparql, fetchPages, infobox, years, norm } = require('./lib-wikipedia');

const SRC = path.join(__dirname, '..', 'src');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
const load = () => vm.runInNewContext(`${read('gamedle-data.js')}\n${read('catalog.js')}\n;({ CATALOG, GD_GAMES, CATALOG_SHORT })`, { norm });
const q = s => (typeof s === 'number' ? String(s) : s.includes("'") ? JSON.stringify(s) : `'${s}'`);
// Wikidata-Länder (deutsche Bezeichnung) → Schreibweise in den Gamedle-Daten
const COUNTRY = { 'Vereinigte Staaten': 'USA', 'Vereinigtes Königreich': 'Großbritannien', 'Volksrepublik China': 'China', 'Republik China': 'Taiwan' };

// Erster Eintrag einer Infobox-Liste, ohne Regionen-/Plattform-Vorsätze und Klammern
const firstEntry = txt => String(txt || '')
  .split(/\s*[;|]\s*|\s{2,}/)
  .map(s => s.replace(/^(NA|EU|PAL|JP|WW|AU|KOR|Microsoft Windows|Windows|PlayStation \d|Xbox[\w ]*|Nintendo Switch|iOS|Android)\s*:?\s*/i, '').replace(/\s*\([^)]*\)\s*$/, '').trim())
  .find(s => s && !/^(NA|EU|PAL|JP|WW|AU)$/i.test(s)) || '';

const guessPersp = g => (g.genres.includes('fps') ? 'ego' : g.genres.some(x => ['plat', 'mv', 'fig', 'arc', 'shm'].includes(x)) ? 'side'
  : g.genres.some(x => ['str', 'sim', 'moba', 'card', 'puz'].includes(x)) ? 'top' : 'third');

async function draft(count) {
  const C = load();
  const extras = C.CATALOG.filter(g => !g.gamedle);
  console.log(`Lade Wikipedia-Artikel für ${extras.length} Katalog-Spiele …`);
  const pages = await fetchPages(extras.map(g => g.wiki));
  const qid = new Map(extras.map(g => [g.wiki, pages.get(g.wiki)?.pageprops?.wikibase_item]).filter(([, x]) => x));
  const ids = [...new Set(qid.values())];
  const wd = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const rows = await sparql(`SELECT ?item ?links (GROUP_CONCAT(DISTINCT ?countryLabel; separator="|") AS ?countries) WHERE {
      VALUES ?item { ${ids.slice(i, i + 50).map(x => 'wd:' + x).join(' ')} }
      ?item wikibase:sitelinks ?links.
      OPTIONAL { ?item wdt:P495 ?country. ?country rdfs:label ?countryLabel. FILTER(LANG(?countryLabel) = "de") }
    } GROUP BY ?item ?links`);
    for (const r of rows) wd.set(r.item.value.split('/').pop(), { links: +r.links.value, countries: r.countries.value.split('|').filter(Boolean) });
  }
  const ranked = extras.map(g => ({ g, info: wd.get(qid.get(g.wiki)) || { links: 0, countries: [] } }))
    .sort((a, b) => b.info.links - a.info.links).slice(0, count)
    .sort((a, b) => a.g.year - b.g.year || a.g.name.localeCompare(b.g.name));

  const lines = [], noCover = [];
  for (const { g, info } of ranked) {
    const p = pages.get(g.wiki);
    const box = infobox(p?.revisions?.[0]?.slots?.main?.content || '') || {};
    const title = g.name; // Anzeigename im Katalog (deutsche Kurznamen später als CATALOG_SHORT)
    const country = COUNTRY[info.countries[0]] || info.countries[0] || '';
    const check = ['Perspektive'];
    const dev = firstEntry(box.developer), pub = firstEntry(box.publisher);
    if (!dev) check.push('Entwickler');
    if (!pub) check.push('Publisher');
    if (!country) check.push('Land');
    if (info.countries.length > 1) check.push(`Land (${info.countries.join('/')})`);
    const ys = years(box.released || box.release);
    if (ys.length && Math.min(...ys) !== g.year) check.push(`Jahr laut Infobox ${Math.min(...ys)}`);
    if (!p?.thumbnail) noCover.push(title);
    const row = [title, g.year, g.genres.join(','), g.plats.join(','), dev || 'PRÜFEN', pub || 'PRÜFEN', g.series, guessPersp(g), g.modes.join(','), country || 'PRÜFEN',
      g.wiki === title ? '' : g.wiki, g.aliases.join('|')];
    while (row.length > 10 && !row[row.length - 1]) row.pop();
    lines.push(`  [${row.map(q).join(', ')}], // ${info.links} · PRÜFEN: ${check.join(', ')}`);
  }
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  const file = path.join(__dirname, 'out', 'promote-draft.js');
  fs.writeFileSync(file, `// Entwurf von tools/promote-games.js (${new Date().toISOString().slice(0, 10)}) – prüfen, korrigieren, dann:
// node tools/promote-games.js --apply tools/out/promote-draft.js
// Format wie GD_GAMES: [Titel, Jahr, Genres, Plattformen zum Start, Entwickler, Publisher, Reihe, Perspektive, Modi, Land, Artikel, Alternativnamen]
module.exports = {
  rows: [
${lines.join('\n')}
  ],
  // Ohne Cover in der Wikipedia → nicht im Cover-Modus
  noCover: ${JSON.stringify(noCover)},
};
`);
  console.log(`${ranked.length} Entwürfe → ${path.relative(process.cwd(), file)} (${noCover.length} ohne Cover)`);
}

function apply(file) {
  const { rows, noCover = [] } = require(path.resolve(file));
  const C = load();
  const gdTitles = new Set(C.GD_GAMES.map(r => norm(r[0])));
  const extra = new Map(C.CATALOG.filter(g => !g.gamedle).map(g => [g.wiki, g]));
  const moved = [], short = {};
  for (const r of rows) {
    if (r.some(x => x === 'PRÜFEN')) throw new Error(`${r[0]}: noch PRÜFEN-Felder`);
    if (gdTitles.has(norm(r[0]))) throw new Error(`${r[0]}: steht schon in den Gamedle-Daten`);
    const wiki = r[10] || r[0];
    const g = extra.get(wiki);
    if (!g) throw new Error(`${r[0]}: nicht in CATALOG_EXTRA (Artikel „${wiki}“)`);
    moved.push(g.wiki);
    // Weicht der Gamedle-Titel vom Tierly-Namen ab (z. B. „Pokémon Crystal“ ↔ „Pokémon Kristall“): Kurzname eintragen
    if (norm(g.name) !== norm(r[0])) {
      short[r[0]] = g.name;
      const aliases = (r[11] || '').split('|').filter(Boolean);
      if (!aliases.some(a => norm(a) === norm(g.name))) r[11] = [...aliases, g.name].join('|');
      while (r.length < 12) r.splice(r.length, 0, '');
    }
  }

  let data = read('gamedle-data.js');
  const block = rows.map(r => {
    const cells = [...r];
    while (cells.length > 10 && !cells[cells.length - 1]) cells.pop();
    return `  [${cells.map(q).join(', ')}],`;
  }).join('\n');
  const end = data.indexOf('\n];', data.indexOf('const GD_GAMES = ['));
  data = `${data.slice(0, end)}\n  // Aus dem Spielekatalog übernommen (tools/promote-games.js), nach Jahr\n${block}${data.slice(end)}`;
  if (noCover.length) data = data.replace(/const GD_NO_COVER = new Set\(\[([^\]]*)\]\);/, (m, list) => `const GD_NO_COVER = new Set([${list}, ${noCover.map(q).join(', ')}]);`);
  fs.writeFileSync(path.join(SRC, 'gamedle-data.js'), data);

  let cat = read('catalog.js');
  const lines = cat.split('\n');
  const keep = lines.filter(l => {
    const m = l.match(/^\s+\[(.*)\],\s*$/);
    if (!m || !cat.includes('const CATALOG_EXTRA')) return true;
    try {
      const row = vm.runInNewContext(`[${m[1]}]`);
      return !(row.length >= 6 && typeof row[1] === 'number' && moved.includes(row[6] || row[0]));
    } catch { return true; }
  });
  cat = keep.join('\n');
  const entries = Object.entries(short);
  if (entries.length) cat = cat.replace(/(const CATALOG_SHORT = \{\n[\s\S]*?)(\n\};)/, (m, head, tail) => `${head}\n${entries.map(([t, n]) => `  ${q(t)}: ${q(n)},`).join('\n')}${tail}`);
  fs.writeFileSync(path.join(SRC, 'catalog.js'), cat);
  console.log(`${moved.length} Spiele nach Gamedle übernommen, ${entries.length} Kurznamen, ${noCover.length} ohne Cover.`);
  console.log('Weiter: node tools/verify-gamedle.js · node tools/gamedle-schedule.js · node --test "tests/*.test.js"');
}

const args = process.argv.slice(2);
if (args[0] === '--apply') apply(args[1]);
else draft(+args[0] || 100).catch(e => { console.error(e); process.exit(1); });
