// Gemeinsame Helfer der Gamedle-Werkzeuge: Wikipedia-API und Infobox-Auswertung.
const API = 'https://en.wikipedia.org/w/api.php';
// Wikimedia verlangt einen User-Agent mit Kontaktmöglichkeit – sonst gibt es schnell HTTP 429
const UA = { 'User-Agent': 'Gamedle-data-tools/1.0 (https://github.com/xQuicklook/Gamedle; data curation)' };

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function request(base, params, tries = 4) {
  const res = await fetch(base + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params }), { headers: UA, signal: AbortSignal.timeout(30000) });
  // Zu viele Anfragen in kurzer Zeit → kurz warten und erneut versuchen
  if (res.status === 429 && tries > 1) {
    await new Promise(r => setTimeout(r, (5 - tries) * 4000));
    return request(base, params, tries - 1);
  }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}
const api = params => request(API, params);
const quoteApi = params => request('https://en.wikiquote.org/w/api.php', params);

/* Wikiquote-Seiten (Wikitext) laden → Map(Titel → Text) */
async function fetchQuotePages(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 20) {
    const chunk = titles.slice(i, i + 20);
    const data = await quoteApi({ action: 'query', titles: chunk.join('|'), redirects: '1', prop: 'revisions', rvprop: 'content', rvslots: 'main' });
    const step = new Map([...(data.query.normalized || []), ...(data.query.redirects || [])].map(r => [r.from, r.to]));
    for (const t of chunk) {
      let cur = t;
      for (let n = 0; n < 4 && step.has(cur); n++) cur = step.get(cur);
      const p = data.query.pages.find(x => x.title === cur);
      if (p?.revisions) out.set(t, p.revisions[0].slots.main.content);
    }
  }
  return out;
}

/* Wikitext → reiner, vergleichbarer Text (für die Zitat-Prüfung) */
const flatText = s => norm(String(s || '')
  .replace(/<ref[\s\S]*?<\/ref>|<ref[^>]*\/>|<!--[\s\S]*?-->/g, ' ')
  .replace(/\{\{(?:small caps|smallcaps|sc|small|nowrap|quote)\|([^{}]*)\}\}/gi, ' $1 ') // Text-Vorlagen auspacken
  .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
  .replace(/\{\{[^{}]*\}\}/g, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/'{2,}/g, '')
  .replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...'));

/* Seiten samt Wikitext und Cover laden (20 pro Anfrage) → Map(angefragter Titel → Seite) */
async function fetchPages(titles) {
  const pages = new Map();
  for (let i = 0; i < titles.length; i += 20) {
    const chunk = titles.slice(i, i + 20);
    const data = await api({ action: 'query', titles: chunk.join('|'), redirects: '1', prop: 'revisions|pageimages|pageprops', rvprop: 'content', rvslots: 'main', piprop: 'thumbnail', pithumbsize: '330', pilicense: 'any', ppprop: 'wikibase_item' });
    const step = new Map([...(data.query.normalized || []), ...(data.query.redirects || [])].map(r => [r.from, r.to]));
    const byTitle = new Map(data.query.pages.map(p => [p.title, p]));
    for (const t of chunk) {
      let cur = t;
      for (let n = 0; n < 4 && step.has(cur); n++) cur = step.get(cur);
      pages.set(t, byTitle.get(cur));
    }
  }
  return pages;
}

/* Wikitext → lesbarer Text: Links, Listen-Vorlagen, Refs und Kommentare entfernen */
function clean(v) {
  return v
    .replace(/<ref[^>]*\/>/g, ' ').replace(/<ref[\s\S]*?<\/ref>/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\{\{(?:nowrap|vgrelease|video game release|plainlist|flatlist|ubl|unbulleted list|collapsible list)\s*\|?/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ; ').replace(/'''?/g, '').replace(/[{}*]/g, ' ').replace(/\s+/g, ' ').trim();
}

function infobox(text) {
  const start = text.search(/\{\{\s*Infobox video game/i);
  if (start < 0) return null;
  let depth = 0, i = start;
  for (; i < text.length; i++) {
    if (text.startsWith('{{', i)) { depth++; i++; } else if (text.startsWith('}}', i)) { depth--; i++; if (!depth) break; }
  }
  const body = text.slice(start, i + 1); // inkl. schließendem „}}“, sonst fehlt das letzte Feld
  const fields = {};
  for (const m of body.matchAll(/\n\s*\|\s*([a-z_]+)\s*=([\s\S]*?)(?=\n\s*\|\s*[a-z_]+\s*=|\}\}\s*$)/gi)) fields[m[1].toLowerCase()] = clean(m[2]);
  return fields;
}

const FAMILY = [
  ['pc', /windows|ms dos|dos|pc|mac|linux|apple ii|amiga|commodore|atari st|steam|zx spectrum|msx|fm towns/],
  ['ps', /playstation|ps[ 2-5]|psp|vita/],
  ['xb', /xbox/],
  ['nin', /nintendo|wii|switch|game boy|\bnes\b|\bsnes\b|gamecube|n64|3ds|\bds\b|famicom/], // \b: sonst wäre „Genesis“ Nintendo
  ['mob', /ios|android|mobile|iphone|ipad/],
  ['sega', /sega|genesis|mega drive|saturn|dreamcast|game gear|master system|mega cd/],
  ['arc', /arcade/],
];
const families = txt => FAMILY.filter(([, re]) => re.test(norm(txt))).map(([k]) => k);

const years = txt => [...String(txt || '').matchAll(/\b(19[5-9]\d|20[0-4]\d)\b/g)].map(m => +m[1]);

/* SPARQL-Abfrage an Wikidata (mit User-Agent und Wiederholung bei 429) */
async function sparql(query, tries = 4) {
  const res = await fetch('https://query.wikidata.org/sparql?query=' + encodeURIComponent(query), {
    headers: { ...UA, Accept: 'application/sparql-results+json' }, signal: AbortSignal.timeout(90000),
  });
  if ((res.status === 429 || res.status >= 500) && tries > 1) {
    await new Promise(r => setTimeout(r, (5 - tries) * 5000));
    return sparql(query, tries - 1);
  }
  if (!res.ok) throw new Error('Wikidata: HTTP ' + res.status);
  return (await res.json()).results.bindings;
}

module.exports = { api, quoteApi, sparql, fetchPages, fetchQuotePages, flatText, clean, infobox, families, years, norm };
