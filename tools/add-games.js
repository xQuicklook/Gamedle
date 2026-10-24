// Erstellt Entwürfe für neue Gamedle-Spiele aus Wikipedia/Wikidata.
// Ausführen: node tools/add-games.js "Outer Wilds" "Tunic" "Inside"
//
// Ausgabe: fertige Datenzeilen für src/gamedle-data.js. Felder, die sich nicht sicher
// ableiten lassen (Plattform bei Erstveröffentlichung, Perspektive …), sind mit PRÜFEN markiert.
// Danach:  1. Zeilen prüfen und in gamedle-data.js einfügen
//          2. node tools/verify-gamedle.js
//          3. node tools/gamedle-schedule.js   (hängt die neuen Spiele an den Spielplan an)
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { api, fetchPages, infobox, families, years, norm } = require('./lib-wikipedia');

const titles = process.argv.slice(2);
if (!titles.length) { console.log('Aufruf: node tools/add-games.js "Titel 1" "Titel 2" …'); process.exit(1); }

const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'gamedle-data.js'), 'utf8');
const { GD_GAMES } = vm.runInNewContext(`${code}\n;({ GD_GAMES })`);
const known = new Set(GD_GAMES.flatMap(g => [norm(g[0]), norm(g[10] || g[0])]));

// Wikipedia-Genres → Gamedle-Genres (Reihenfolge = Priorität)
const GENRES = [
  [/soulslike|souls like/, 'sou'], [/metroidvania/, 'mv'], [/roguelike|roguelite/, 'rog'], [/battle royale/, 'br'],
  [/mmorpg|massively multiplayer/, 'mmo'], [/moba|multiplayer online battle arena/, 'moba'], [/survival horror|horror/, 'hor'],
  [/first person shooter/, 'fps'], [/third person shooter/, 'tps'], [/action role playing|action rpg/, 'arpg'],
  [/role playing/, 'rpg'], [/action adventure/, 'aa'], [/hack and slash/, 'hns'], [/stealth/, 'stl'], [/platform/, 'plat'],
  [/puzzle/, 'puz'], [/racing|kart/, 'rac'], [/fighting/, 'fig'], [/sports|football|soccer|basketball|skateboarding/, 'spo'],
  [/real time strategy|strategy|tactics|4x/, 'str'], [/simulation|sim\b|life sim|farming/, 'sim'], [/sandbox|survival/, 'sbx'],
  [/party/, 'par'], [/card|deck building/, 'card'], [/shoot em up|rail shooter/, 'shm'], [/adventure/, 'adv'],
];
// Wikidata-Länder (deutsche Bezeichnung) → Schreibweise in den Gamedle-Daten
const COUNTRY = { 'Vereinigte Staaten': 'USA', 'Vereinigtes Königreich': 'Großbritannien', 'Volksrepublik China': 'China' };

const firstEntry = txt => String(txt || '')
  .split(/\s*[;|]\s*|\s{2,}/)
  .map(s => s.replace(/^(NA|EU|PAL|JP|WW|AU|KOR|Microsoft Windows|Windows|PlayStation \d|Xbox[\w ]*|Nintendo Switch)\s*:?\s*/i, '').replace(/\s*\([^)]*\)\s*$/, '').trim())
  .find(s => s && !/^(NA|EU|PAL|JP|WW|AU)$/i.test(s)) || '';

async function search(title) {
  const data = await api({ action: 'query', list: 'search', srsearch: `${title} hastemplate:"Infobox video game"`, srlimit: '1', srnamespace: '0' });
  return data.query.search[0]?.title || null;
}

async function wikidata(qids) {
  const ids = qids.filter(Boolean);
  if (!ids.length) return new Map();
  const q = `SELECT ?item ?countryLabel WHERE { VALUES ?item { ${ids.map(x => 'wd:' + x).join(' ')} } OPTIONAL { ?item wdt:P495 ?country. } SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en". } }`;
  const res = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), { headers: { 'User-Agent': 'Gamedle-data-tools/1.0' } });
  const json = await res.json();
  return new Map(json.results.bindings.map(b => [b.item.value.split('/').pop(), b.countryLabel?.value]));
}

const q = s => (s.includes("'") ? JSON.stringify(s) : `'${s}'`);

(async () => {
  const found = [];
  for (const t of titles) {
    const article = await search(t);
    if (!article) { console.log(`// ✕ „${t}“: kein Wikipedia-Artikel mit Spiele-Infobox gefunden`); continue; }
    if (known.has(norm(article)) || known.has(norm(t))) { console.log(`// – „${t}“ ist schon in den Daten (${article})`); continue; }
    found.push({ input: t, article });
  }
  const pages = await fetchPages(found.map(f => f.article));
  const countries = await wikidata(found.map(f => pages.get(f.article)?.pageprops?.wikibase_item));

  for (const f of found) {
    const p = pages.get(f.article);
    const box = infobox(p?.revisions?.[0]?.slots?.main?.content || '') || {};
    const title = p.title.replace(/\s*\([^)]*\)\s*$/, '');
    const g = norm(box.genre);
    const genres = [...new Set(GENRES.filter(([re]) => re.test(g)).map(([, k]) => k))].slice(0, 2);
    const m = norm(box.modes);
    const modes = [/single player/.test(m) && 'e', /multiplayer|multi player|online/.test(m) && 'm', /co op|cooperative/.test(m) && 'k'].filter(Boolean);
    const ys = years(box.released || box.release);
    const country = countries.get(p.pageprops?.wikibase_item);
    const persp = genres.includes('fps') ? 'ego' : genres.includes('mv') || genres.includes('plat') ? 'side' : 'third';
    const check = ['Plattform (nur Erstveröffentlichung!)', 'Perspektive'];
    if (!genres.length) check.push('Genre');
    if (!modes.length) check.push('Spielmodus');
    if (!country) check.push('Land');
    const row = [
      q(title), Math.min(...ys) || '????', q(genres.join(',') || 'PRÜFEN'), q(families(box.platforms || box.platform || '').join(',') || 'PRÜFEN'),
      q(firstEntry(box.developer) || 'PRÜFEN'), q(firstEntry(box.publisher) || 'PRÜFEN'), q(firstEntry(box.series)),
      q(persp), q(modes.join(',') || 'e'), q(COUNTRY[country] || country || 'PRÜFEN'), q(p.title === title ? '' : p.title),
    ];
    console.log(`  [${row.join(', ')}], // PRÜFEN: ${check.join(', ')}${p.thumbnail ? '' : ' · KEIN COVER → in GD_NO_COVER eintragen'}`);
  }
  console.log('\nNächste Schritte: Zeilen prüfen und in src/gamedle-data.js einfügen → node tools/verify-gamedle.js → node tools/gamedle-schedule.js');
})().catch(e => { console.error(e); process.exit(1); });
