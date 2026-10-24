// Prüft die Gamedle-Daten gegen die Infoboxen der englischen Wikipedia.
// Ausführen: node tools/verify-gamedle.js   (braucht Internet)
// Meldet Abweichungen bei Jahr, Entwickler, Publisher und Plattformen, fehlende Cover,
// Zitate, die nicht (mehr) auf ihrer Wikiquote-Seite stehen, und fehlende Szenen-Bilder.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { api, fetchPages, fetchQuotePages, flatText, infobox, families, years, norm } = require('./lib-wikipedia');

const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const { GD_GAMES, GD_QUOTES, GD_SCENES } = vm.runInNewContext(`${src('gamedle-data.js')}\n${src('gamedle-content.js')}\n;({ GD_GAMES, GD_QUOTES, GD_SCENES })`);

// Bewusst so gelassen (geläufiger Name statt internem Team) – nicht erneut melden
const ACCEPTED = new Set([
  'Silent Hill|Entwickler', 'Shadow of the Colossus|Entwickler', 'Persona 5|Entwickler', 'Sea of Thieves|Publisher',
  'Minecraft|kein Cover', 'Undertale|kein Cover', 'Fortnite|kein Cover',
]);

(async () => {
  const rows = GD_GAMES.map(g => ({ title: g[0], year: g[1], plats: g[3].split(','), dev: g[4], pub: g[5], wiki: g[10] || g[0] }));
  const pages = await fetchPages(rows.map(r => r.wiki));

  const issues = [];
  for (const r of rows) {
    const p = pages.get(r.wiki);
    if (!p || p.missing) { issues.push([r.title, 'Artikel fehlt', r.wiki]); continue; }
    if (!p.thumbnail) issues.push([r.title, 'kein Cover', '']);
    const box = infobox(p.revisions?.[0]?.slots?.main?.content || '');
    if (!box) { issues.push([r.title, 'keine Infobox', '']); continue; }
    const ys = years(box.released || box.release);
    if (ys.length && Math.min(...ys) !== r.year) issues.push([r.title, 'Jahr', `${r.year} ↔ ${Math.min(...ys)}`]);
    for (const [key, ours] of [['developer', r.dev], ['publisher', r.pub]]) {
      const theirs = norm(box[key]);
      const tokens = norm(ours).split(' ').filter(w => w.length > 2 && !['games', 'studio', 'studios', 'entertainment', 'interactive', 'software'].includes(w));
      if (theirs && tokens.length && !tokens.some(w => theirs.includes(w))) issues.push([r.title, key === 'developer' ? 'Entwickler' : 'Publisher', `${ours} ↔ ${box[key].slice(0, 90)}`]);
    }
    const fam = new Set(families(box.platforms || box.platform || ''));
    const extra = r.plats.filter(x => !fam.has(x));
    if (fam.size && extra.length) issues.push([r.title, 'Plattform', `${r.plats.join(',')} ↔ ${[...fam].join(',')} (${(box.platforms || '').slice(0, 70)})`]);
  }

  // Zitate: Stehen sie wörtlich auf der angegebenen Wikiquote-Seite?
  const titleOf = Object.fromEntries(GD_GAMES.map(g => [norm(g[0]).replace(/ /g, '-'), g[0]]));
  const nameOf = id => titleOf[id] || id;
  const quotePages = await fetchQuotePages([...new Set(Object.values(GD_QUOTES).map(q => q[2]))]);
  for (const [id, [text, , page]] of Object.entries(GD_QUOTES)) {
    const wiki = quotePages.get(page);
    if (!wiki) issues.push([nameOf(id), 'Zitat-Quelle fehlt', page]);
    else if (!flatText(wiki).includes(flatText(text))) issues.push([nameOf(id), 'Zitat nicht auf Wikiquote', `„${text.slice(0, 70)}“ (${page})`]);
  }

  // Szenen: Gibt es die Bilddateien noch?
  const files = Object.entries(GD_SCENES).map(([id, s]) => [id, 'File:' + s[0]]);
  for (let i = 0; i < files.length; i += 50) {
    const chunk = files.slice(i, i + 50);
    const data = await api({ action: 'query', titles: chunk.map(f => f[1]).join('|'), prop: 'imageinfo', iiprop: 'size' });
    const step = new Map((data.query.normalized || []).map(r => [r.from, r.to]));
    for (const [id, f] of chunk) {
      const p = data.query.pages.find(x => x.title === (step.get(f) || f));
      if (!p?.imageinfo) issues.push([nameOf(id), 'Szene fehlt', f]);
    }
  }

  const open = issues.filter(([t, k]) => !ACCEPTED.has(`${t}|${k}`));
  console.log(`${rows.length} Spiele geprüft, ${open.length} offene Hinweise (${issues.length - open.length} bewusst akzeptiert):\n`);
  for (const [t, k, d] of open) console.log(`- ${t} · ${k}: ${d}`);
  process.exitCode = open.length ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
