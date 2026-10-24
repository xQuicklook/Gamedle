// Schlägt neue Spiele für den Spielekatalog vor – die bekanntesten Spiele auf Wikidata
// (gemessen an der Zahl der Wikipedia-Sprachversionen), die noch nicht im Katalog stehen.
// Ausführen: node tools/catalog-candidates.js [Anzahl, Standard 450]
//
// Ausgabe: tools/out/catalog-candidates.js – Daten für die Prüfseite tools/catalog-review.html.
// Vorab-Entscheidungen (Ausschuss, korrigierte Felder) stehen in tools/catalog-curation.json
// und werden bei jedem Lauf wieder angewendet.
// Danach:  1. tools/catalog-review.html im Browser öffnen, prüfen, „Exportieren“
//          2. node tools/catalog-apply.js <exportierte Datei>
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { api, sparql, norm } = require('./lib-wikipedia');

const LIMIT = +process.argv[2] || 450;
const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out');

// Katalog + Genre-Abbildung (src/wiki.js) aus dem App-Code laden
const src = f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
const str = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const C = vm.runInNewContext(`${['gamedle-data.js', 'catalog.js', 'wiki.js'].map(src).join('\n')}
;({ CATALOG, catalogEntry, genreKeys, pickSeries, GD_GENRES, GD_PLATFORMS, GD_MODES })`, { norm, str, console });
const curation = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog-curation.json'), 'utf8'));

// Wikidata-Plattformen (englische Namen) → Plattform-Kürzel des Katalogs
const PLATFORMS = [
  ['pc', /windows|ms-dos|\bdos\b|macos|mac os|linux|amiga|commodore|atari st|zx spectrum|msx|apple ii|amstrad|personal computer|fm towns|pc-98/],
  ['ps', /playstation/],
  ['xb', /xbox/],
  ['nin', /nintendo|\bwii\b|wii u|game boy|\bnes\b|\bsnes\b|famicom|gamecube|virtual boy/],
  ['mob', /\bios\b|android|ipados|windows phone|j2me|symbian/],
  ['sega', /sega|genesis|mega drive|saturn|dreamcast|game gear|master system/],
  ['arc', /arcade/],
];
const platKeys = labels => [...new Set(labels.flatMap(l => PLATFORMS.filter(([, re]) => re.test(l.toLowerCase())).map(([k]) => k)))];
const modeKeys = labels => [...new Set(labels.map(l => l.toLowerCase()).flatMap(l => [
  /single-player/.test(l) && 'e', /multiplayer|multi-player/.test(l) && 'm', /co-?op|cooperative/.test(l) && 'k',
].filter(Boolean)))];
// Wikidata-Typen, die auf Ausschuss hindeuten (Erweiterung, Sammlung, Neuauflage …)
const SUSPECT = /expansion|downloadable content|dlc|compilation|remaster|remake|port|mod\b|add-on|episode|edition|bundle/i;

const qidOf = uri => uri.split('/').pop();
const articleOf = uri => decodeURIComponent(uri.split('/wiki/')[1]).replace(/_/g, ' ');
const stripDisambig = t => t.replace(/\s*\([^)]*\)\s*$/, '');

(async () => {
  console.log('Lade die bekanntesten Spiele von Wikidata …');
  const top = await sparql(`SELECT ?item ?article ?links WHERE {
    ?item wdt:P31 wd:Q7889; wikibase:sitelinks ?links.
    FILTER(?links >= 15)
    ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>.
  } ORDER BY DESC(?links) LIMIT ${LIMIT + 700}`);

  const inCatalog = new Set(C.CATALOG.map(g => g.wiki));
  const cands = [];
  const seen = new Set();
  for (const b of top) {
    const qid = qidOf(b.item.value), wiki = articleOf(b.article.value);
    if (seen.has(qid) || inCatalog.has(wiki)) continue;
    seen.add(qid);
    cands.push({ qid, wiki, links: +b.links.value });
  }
  console.log(`${cands.length} Spiele noch nicht im Katalog – lade Details …`);

  // Details je 50 Spiele: Datum (mit Plattform), Plattformen, Genres, Reihe, Spielmodi, Typ, deutscher Name
  const det = new Map(cands.map(c => [c.qid, { dates: [], plats: [], genres: [], series: [], modes: [], types: [], de: '' }]));
  for (let i = 0; i < cands.length; i += 50) {
    const chunk = cands.slice(i, i + 50);
    const rows = await sparql(`SELECT ?item ?date ?datePlatLabel ?platLabel ?genreLabel ?seriesLabel ?modeLabel ?typeLabel ?de WHERE {
      VALUES ?item { ${chunk.map(c => 'wd:' + c.qid).join(' ')} }
      { ?item p:P577 ?ds. ?ds ps:P577 ?date. OPTIONAL { ?ds pq:P400 ?datePlat. } }
      UNION { ?item wdt:P400 ?plat. } UNION { ?item wdt:P136 ?genre. } UNION { ?item wdt:P179 ?series. }
      UNION { ?item wdt:P404 ?mode. } UNION { ?item wdt:P31 ?type. }
      UNION { ?item rdfs:label ?de. FILTER(LANG(?de) = "de") }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
    }`);
    for (const r of rows) {
      const d = det.get(qidOf(r.item.value));
      if (r.date) d.dates.push({ year: +r.date.value.slice(0, 4), plat: r.datePlatLabel?.value || '' });
      const add = (list, v) => { if (v && !/^Q\d+$/.test(v) && !list.includes(v)) list.push(v); };
      add(d.plats, r.platLabel?.value); add(d.genres, r.genreLabel?.value); add(d.series, r.seriesLabel?.value);
      add(d.modes, r.modeLabel?.value); add(d.types, r.typeLabel?.value);
      if (r.de) d.de = r.de.value;
    }
    process.stdout.write(`\r${Math.min(i + 50, cands.length)}/${cands.length}`);
  }
  console.log();

  // Cover und Kurzbeschreibung aus der englischen Wikipedia (für die Prüfseite). Ist der Artikel nur
  // eine Weiterleitung (z. B. „Pokémon Yellow“ → „Pokémon Red, Blue, and Yellow“), zählt das Ziel.
  const pages = new Map(), target = new Map();
  for (let i = 0; i < cands.length; i += 50) {
    const chunk = cands.slice(i, i + 50);
    const data = await api({ action: 'query', titles: chunk.map(c => c.wiki).join('|'), redirects: '1', prop: 'pageimages|description', piprop: 'thumbnail', pithumbsize: '200', pilicense: 'any' });
    for (const r of data.query.redirects || []) target.set(r.from, r.to);
    for (const p of data.query.pages) pages.set(p.title, p);
  }

  const series = [...new Set(C.CATALOG.map(g => g.series).filter(Boolean))];
  const out = [];
  const taken = new Set(inCatalog);
  for (const c of cands) {
    if (target.has(c.wiki)) c.wiki = target.get(c.wiki);
    if (taken.has(c.wiki)) continue; // Artikel gehört schon zu einem Katalog-Spiel (oder einem anderen Vorschlag)
    taken.add(c.wiki);
    const d = det.get(c.qid);
    const valid = d.dates.filter(x => x.year >= 1970 && x.year <= new Date().getFullYear());
    const year = valid.length ? Math.min(...valid.map(x => x.year)) : null;
    const title = stripDisambig(c.wiki);
    if (year && C.catalogEntry({ title, year })) continue; // gleicher Titel + Jahr: steht schon (unter altem Artikelnamen) im Katalog
    // Plattformen zum Start: aus den Datumsangaben des ersten Jahres. Fehlt dort bei einer Angabe
    // die Plattform, zählen alle – lieber ein Spiel zu wenig in einem Exklusiv-Paket als eins zu viel.
    const first = valid.filter(x => x.year === year);
    const firstPlats = first.length && first.every(x => x.plat) ? first.map(x => x.plat) : [];
    const hint = [];
    if (!year) hint.push('kein Erscheinungsjahr (unveröffentlicht?)');
    if (!firstPlats.length) hint.push('Plattformen zum Start unsicher');
    const odd = d.types.filter(t => SUSPECT.test(t) && !/^video game$/i.test(t));
    if (odd.length) hint.push('Typ: ' + odd.join(', '));
    const page = pages.get(c.wiki);
    const g = {
      qid: c.qid, wiki: c.wiki, links: c.links, title, name: title, year,
      genres: C.genreKeys(d.genres), plats: platKeys(firstPlats.length ? firstPlats : d.plats), modes: modeKeys(d.modes),
      series: d.series.length ? C.pickSeries(d.series, title, series) : '',
      aliases: d.de && norm(d.de) !== norm(title) ? [d.de] : [],
      img: (page?.thumbnail?.source || '').replace(/\?utm_[^#]*$/, ''), desc: page?.description || '',
      raw: { genres: d.genres, plats: d.plats, firstPlats, modes: d.modes, series: d.series, types: d.types },
      hint,
    };
    if (!g.modes.length) g.modes = ['e'];
    // Vorab-Entscheidungen: Ausschuss markieren, Felder korrigieren
    if (curation.skip[c.qid]) { g.skip = curation.skip[c.qid]; }
    if (curation.fix[c.qid]) { g.fixed = Object.keys(curation.fix[c.qid]); Object.assign(g, curation.fix[c.qid]); }
    out.push(g);
  }

  const keep = out.filter(g => !g.skip);
  const list = [...keep.slice(0, LIMIT), ...out.filter(g => g.skip)];
  fs.mkdirSync(OUT, { recursive: true });
  const vocab = { genres: C.GD_GENRES, plats: C.GD_PLATFORMS, modes: C.GD_MODES, series };
  fs.writeFileSync(path.join(OUT, 'catalog-candidates.js'),
    `// Erzeugt von tools/catalog-candidates.js am ${new Date().toISOString().slice(0, 10)}\n` +
    `window.CATALOG_VOCAB = ${JSON.stringify(vocab)};\nwindow.CATALOG_CANDIDATES = ${JSON.stringify(list, null, 1)};\n`);
  console.log(`${keep.slice(0, LIMIT).length} Vorschläge (+ ${list.length - Math.min(keep.length, LIMIT)} vorab aussortiert) → tools/out/catalog-candidates.js`);
  console.log('Weiter: tools/catalog-review.html im Browser öffnen.');
})().catch(e => { console.error(e); process.exit(1); });
