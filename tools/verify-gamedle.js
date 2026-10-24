// Prüft die Gamedle-Daten gegen die Infoboxen der englischen Wikipedia.
// Ausführen: node tools/verify-gamedle.js   (braucht Internet)
// Meldet Abweichungen bei Jahr, Entwickler, Publisher und Plattformen sowie fehlende Cover.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'gamedle-data.js'), 'utf8');
const { GD_GAMES } = vm.runInNewContext(`${code}\n;({ GD_GAMES })`);

const API = 'https://en.wikipedia.org/w/api.php';
const UA = { 'User-Agent': 'Gamedle-data-check/1.0 (private hobby project)' };
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function api(params) {
  const res = await fetch(API + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params }), { headers: UA });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/* Wikitext → lesbarer Text: Links, Vorlagen-Listen, Refs und Kommentare entfernen */
function clean(v) {
  return v
    .replace(/<ref[^>]*\/>/g, ' ').replace(/<ref[\s\S]*?<\/ref>/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\{\{(?:nowrap|vgrelease|video game release|plainlist|flatlist|ubl|unbulleted list|collapsible list)\s*\|?/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ; ').replace(/[{}*]/g, ' ').replace(/\s+/g, ' ').trim();
}

function infobox(text) {
  const start = text.search(/\{\{\s*Infobox video game/i);
  if (start < 0) return null;
  // Ende der Infobox über die Klammertiefe finden
  let depth = 0, i = start;
  for (; i < text.length; i++) {
    if (text.startsWith('{{', i)) { depth++; i++; } else if (text.startsWith('}}', i)) { depth--; i++; if (!depth) break; }
  }
  const body = text.slice(start, i);
  const fields = {};
  for (const m of body.matchAll(/\n\s*\|\s*([a-z_]+)\s*=([\s\S]*?)(?=\n\s*\|\s*[a-z_]+\s*=|\}\}\s*$)/gi)) fields[m[1].toLowerCase()] = clean(m[2]);
  return fields;
}

const FAMILY = [
  ['pc', /windows|ms dos|dos|pc|mac|linux|apple ii|amiga|commodore|atari st|steam|zx spectrum|msx|fm towns/],
  ['ps', /playstation|ps[ 2-5]|psp|vita/],
  ['xb', /xbox/],
  ['nin', /nintendo|wii|switch|game boy|nes|snes|gamecube|n64|3ds|\bds\b|famicom/],
  ['mob', /ios|android|mobile|iphone|ipad/],
  ['sega', /sega|genesis|mega drive|saturn|dreamcast|game gear|master system|mega cd/],
  ['arc', /arcade/],
];
const families = txt => new Set(FAMILY.filter(([, re]) => re.test(norm(txt))).map(([k]) => k));

(async () => {
  const rows = GD_GAMES.map(g => ({ title: g[0], year: g[1], plats: g[3].split(','), dev: g[4], pub: g[5], wiki: g[10] || g[0] }));
  const pages = new Map();
  for (let i = 0; i < rows.length; i += 20) {
    const chunk = rows.slice(i, i + 20).map(r => r.wiki);
    const data = await api({ action: 'query', titles: chunk.join('|'), redirects: '1', prop: 'revisions|pageimages', rvprop: 'content', rvslots: 'main', piprop: 'thumbnail', pithumbsize: '330', pilicense: 'any' });
    const step = new Map([...(data.query.normalized || []), ...(data.query.redirects || [])].map(r => [r.from, r.to]));
    const byTitle = new Map(data.query.pages.map(p => [p.title, p]));
    for (const t of chunk) {
      let cur = t;
      for (let n = 0; n < 4 && step.has(cur); n++) cur = step.get(cur);
      pages.set(t, byTitle.get(cur));
    }
  }

  const issues = [];
  for (const r of rows) {
    const p = pages.get(r.wiki);
    if (!p || p.missing) { issues.push([r.title, 'Artikel fehlt', r.wiki]); continue; }
    if (!p.thumbnail) issues.push([r.title, 'kein Cover', '']);
    const box = infobox(p.revisions?.[0]?.slots?.main?.content || '');
    if (!box) { issues.push([r.title, 'keine Infobox', '']); continue; }
    const years = [...(box.released || box.release || '').matchAll(/\b(19[5-9]\d|20[0-4]\d)\b/g)].map(m => +m[1]);
    if (years.length && Math.min(...years) !== r.year) issues.push([r.title, 'Jahr', `${r.year} ↔ ${Math.min(...years)}`]);
    for (const [key, ours] of [['developer', r.dev], ['publisher', r.pub]]) {
      const theirs = norm(box[key]);
      const tokens = norm(ours).split(' ').filter(w => w.length > 2 && !['games', 'studio', 'studios', 'entertainment', 'interactive', 'software'].includes(w));
      if (theirs && tokens.length && !tokens.some(w => theirs.includes(w))) issues.push([r.title, key === 'developer' ? 'Entwickler' : 'Publisher', `${ours} ↔ ${box[key].slice(0, 90)}`]);
    }
    const fam = families(box.platforms || box.platform || '');
    const extra = r.plats.filter(x => !fam.has(x));
    if (fam.size && extra.length) issues.push([r.title, 'Plattform', `${r.plats.join(',')} ↔ ${[...fam].join(',')} (${(box.platforms || '').slice(0, 70)})`]);
  }

  // Bewusst so gelassen (geläufiger Name statt internem Team) – nicht erneut melden
  const ACCEPTED = new Set([
    'Silent Hill|Entwickler', 'Shadow of the Colossus|Entwickler', 'Persona 5|Entwickler', 'Sea of Thieves|Publisher',
    'Minecraft|kein Cover', 'Undertale|kein Cover', 'Fortnite|kein Cover',
  ]);
  const open = issues.filter(([t, k]) => !ACCEPTED.has(`${t}|${k}`));
  console.log(`${rows.length} Spiele geprüft, ${open.length} offene Hinweise (${issues.length - open.length} bewusst akzeptiert):\n`);
  for (const [t, k, d] of open) console.log(`- ${t} · ${k}: ${d}`);
  process.exitCode = open.length ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
