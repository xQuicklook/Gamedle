/* ───────── Cover & Metadaten über Wikipedia / Wikidata ─────────
   Kein API-Key, kein Server: beide APIs erlauben Abfragen direkt aus dem Browser (CORS).
   Wikipedia liefert Cover (Infobox-Bild), Titel und Jahr, Wikidata Spielreihe (P179) und Genres (P136). */
const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const WIKI_PAGE_PROPS = {
  prop: 'pageimages|description|pageprops',
  piprop: 'thumbnail', pithumbsize: '330', pilicense: 'any', // Cover sind meist "non-free" → any
  ppprop: 'wikibase_item',
};

const parseYear = s => { const m = String(s || '').match(/\b(19[5-9]\d|20[0-4]\d)\b/); return m ? +m[1] : null; };
const stripDisambig = t => t.replace(/\s*\([^)]*\)\s*$/, '');

const Wiki = {
  cache: new Map(),

  async api(params, lang = 'en') {
    const base = lang === 'en' ? WIKI_API : `https://${lang}.wikipedia.org/w/api.php`;
    const url = base + '?' + new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });
    const res = await fetch(url);
    if (!res.ok) throw new Error('Wikipedia antwortet nicht (' + res.status + ')');
    return res.json();
  },

  info(p) {
    const desc = p.description || '';
    return {
      wiki: p.title,
      title: stripDisambig(p.title),
      img: (p.thumbnail?.source || '').replace(/\?utm_[^#]*$/, ''),
      desc,
      year: parseYear(desc) || parseYear((p.title.match(/\(([^)]*)\)\s*$/) || [])[1]),
      qid: p.pageprops?.wikibase_item || '',
      missing: !!p.missing || !!p.invalid,
      series: /\b(series|franchise|same term)\b/i.test(desc),
    };
  },

  /* Freitext-Suche, nur Artikel mit „Infobox video game“ */
  async search(q, limit = 8) {
    q = str(q, 80);
    if (!q) return [];
    const key = limit + ':' + norm(q);
    if (this.cache.has(key)) return this.cache.get(key);
    const data = await this.api({
      action: 'query', generator: 'search', gsrnamespace: '0', gsrlimit: String(limit),
      gsrsearch: `${q.replace(/"/g, '')} hastemplate:"Infobox video game"`,
      ...WIKI_PAGE_PROPS,
    });
    const list = (data.query?.pages || []).sort((a, b) => a.index - b.index).map(p => this.info(p)).filter(x => !x.series);
    // Wenig gefunden? Dann auch auf der deutschen Wikipedia suchen (deutsche Titel, deutsche Spiele)
    if (list.length < 4) {
      try {
        for (const r of await this.searchDe(q, 6)) {
          if (!list.some(x => (r.wiki && x.wiki === r.wiki) || (r.qid && x.qid === r.qid))) list.push(r);
        }
      } catch (e) { console.warn(e); }
    }
    this.cache.set(key, list);
    return list;
  },

  /* Deutsche Wikipedia: Treffer über den Sprachlink mit dem englischen Artikel verknüpfen –
     nur dort gibt es die Cover (die deutsche Wikipedia zeigt keine Cover-Bilder). */
  async searchDe(q, limit = 6) {
    const data = await this.api({
      action: 'query', generator: 'search', gsrnamespace: '0', gsrlimit: String(limit),
      gsrsearch: `${q.replace(/"/g, '')} hastemplate:"Infobox Computer- und Videospiel"`,
      prop: 'langlinks|description|pageprops', lllang: 'en', ppprop: 'wikibase_item',
    }, 'de');
    const pages = (data.query?.pages || []).sort((a, b) => a.index - b.index);
    const en = await this.byTitles(pages.map(p => p.langlinks?.[0]?.title).filter(Boolean));
    return pages.map(p => {
      const info = en.get(p.langlinks?.[0]?.title);
      return {
        wiki: info?.wiki || '', title: stripDisambig(p.title), img: info?.img || '', desc: p.description || '',
        year: parseYear(p.description) || info?.year || null, qid: p.pageprops?.wikibase_item || info?.qid || '',
        missing: false, series: false, lang: 'de',
      };
    });
  },

  /* Exakte Artikeltitel (inkl. Weiterleitungen), 50 pro Anfrage → Map(angefragter Titel → info) */
  async byTitles(titles) {
    const out = new Map();
    const uniq = [...new Set(titles.filter(Boolean))];
    for (let i = 0; i < uniq.length; i += 50) {
      const chunk = uniq.slice(i, i + 50);
      const data = await this.api({ action: 'query', titles: chunk.join('|'), redirects: '1', ...WIKI_PAGE_PROPS });
      const q = data.query || {};
      const step = new Map([...(q.normalized || []), ...(q.redirects || [])].map(r => [r.from, r.to]));
      const pages = new Map((q.pages || []).map(p => [p.title, this.info(p)]));
      for (const t of chunk) {
        let cur = t;
        for (let n = 0; n < 4 && step.has(cur); n++) cur = step.get(cur);
        const info = pages.get(cur);
        if (info && !info.missing) out.set(t, info);
      }
    }
    return out;
  },

  /* Bestes Wikipedia-Spiel zu einem Titel (+ optionalem Jahr) – für Spiele ohne bekannten Artikel */
  async match(title, year) {
    const clean = title.replace(/\((remake|remaster(ed)?|\d{4})\)/ig, ' ').replace(/\s+/g, ' ').trim();
    const list = await this.search(clean, 5);
    const nt = norm(clean);
    let best = null, bestScore = 0;
    for (const c of list) {
      const ct = norm(c.title);
      let score = 0;
      if (ct === nt) score += 3; else if (ct.includes(nt) || nt.includes(ct)) score += 1;
      if (year && c.year === year) score += 3;
      else if (year && c.year && Math.abs(c.year - year) <= 1) score += 1;
      else if (year && c.year) score -= 3; // anderes Spiel gleichen Namens (Remake, Reboot …)
      if (score > bestScore) { best = c; bestScore = score; }
    }
    return bestScore >= 3 || (!year && bestScore >= 1) ? best : null;
  },

  /* Spielreihe(n), frühestes Erscheinungsjahr und Genres (englische Namen) über Wikidata
     → Map(qid → {series: [], year, genres: []}). UNION statt OPTIONAL: sonst vervielfachen sich die Zeilen. */
  async details(qids) {
    const ids = [...new Set(qids.filter(q => /^Q\d+$/.test(q)))];
    const out = new Map(ids.map(q => [q, { series: [], year: null, genres: [] }]));
    for (let i = 0; i < ids.length; i += 50) {
      const query = `SELECT ?item ?seriesLabel ?date ?genreLabel WHERE {
        VALUES ?item { ${ids.slice(i, i + 50).map(q => 'wd:' + q).join(' ')} }
        { ?item wdt:P179 ?series. } UNION { ?item wdt:P577 ?date. } UNION { ?item wdt:P136 ?genre. }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul,de". }
      }`;
      const res = await fetch(WIKIDATA_SPARQL + '?format=json&query=' + encodeURIComponent(query));
      if (!res.ok) throw new Error('Wikidata antwortet nicht (' + res.status + ')');
      const json = await res.json();
      for (const b of json.results?.bindings || []) {
        const d = out.get(b.item.value.split('/').pop());
        if (!d) continue;
        const label = b.seriesLabel?.value;
        if (label && !/^Q\d+$/.test(label) && !d.series.includes(label)) d.series.push(label);
        const y = parseYear(b.date?.value);
        if (y && (!d.year || y < d.year)) d.year = y;
        const genre = b.genreLabel?.value;
        if (genre && !/^Q\d+$/.test(genre) && !d.genres.includes(genre)) d.genres.push(genre);
      }
    }
    return out;
  },
};

/* ───────── Genres ─────────
   Tierly nutzt dieselben Genre-Kürzel wie Gamedle und der Spielekatalog (Namen in GD_GENRES). */
const genreName = k => GD_GENRES[k] || k;

/* Wikidata-Genres (englisch, sehr fein) → unsere groben Genres */
const GENRE_RULES = [
  ['mmo', /massively multiplayer online role-playing/],
  ['arpg', /action role-playing/],
  ['rpg', /^(?!.*(massively|action role-playing)).*role-playing/],
  ['aa', /action-adventure/],
  ['adv', /(^|[^-])adventure game|point-and-click|visual novel|interactive fiction/],
  ['fps', /first-person shooter/],
  ['tps', /third-person shooter/],
  ['shm', /shoot ?['’]?em up|bullet hell|scrolling shooter/],
  ['hor', /horror/],
  ['surv', /^survival (video )?game/],
  ['str', /strateg|\b4x\b|tower defen[cs]e|real-time tactics|turn-based tactics/],
  ['sim', /simulat|city-building/],
  ['spo', /\bsports?\b|football|soccer|basketball|golf|tennis|hockey|baseball|skateboard|snowboard/],
  ['rac', /racing/],
  ['fig', /fighting game|platform fighter/],
  ['plat', /platform (game|video game)|platformer|puzzle-platform/],
  ['puz', /puzzle/],
  ['sbx', /sandbox/],
  ['br', /battle royale/],
  ['rog', /rogue-?li(ke|te)/],
  ['mv', /metroidvania/],
  ['par', /party (video )?game/],
  ['stl', /stealth/],
  ['hns', /hack and slash|hack ['’]n['’] slash|beat ['’]?em up/],
  ['sou', /souls-?like/],
  ['moba', /multiplayer online battle arena|\bmoba\b/],
  ['card', /card game|deck-?building/],
];
function genreKeys(labels) {
  const out = new Set();
  for (const l of labels) for (const [k, re] of GENRE_RULES) if (re.test(String(l).toLowerCase())) out.add(k);
  return [...out].slice(0, 4);
}

/* Kuratierte Genres ohne Netz – aus dem Spielekatalog (catalog.js) */
function knownGenres(it) {
  const g = catalogEntry(it);
  return g ? [...g.genres] : null;
}

/* Genres für Spiele ohne Genre: erst kuratiert, dann über Wikidata. onProgress(done, total) */
async function fetchMissingGenres(items, onProgress = () => {}) {
  const patches = [], need = [];
  for (const it of items) {
    const g = knownGenres(it);
    if (g) patches.push({ id: it.id, genres: g }); else need.push(it);
  }
  const total = items.length;
  let done = patches.length;
  onProgress(done, total);
  // Wikidata-ID über den Wikipedia-Artikel, ohne Artikel wie bei den Covern über die Suche
  const qidOf = new Map();
  const withWiki = need.filter(it => it.wiki);
  if (withWiki.length) {
    const found = await Wiki.byTitles(withWiki.map(it => it.wiki));
    for (const it of withWiki) if (found.get(it.wiki)?.qid) qidOf.set(it.id, found.get(it.wiki).qid);
  }
  const queue = need.filter(it => !qidOf.has(it.id) && !it.wiki);
  const worker = async () => {
    while (queue.length) {
      const it = queue.shift();
      try {
        const m = await Wiki.match(it.title, it.year);
        if (m?.qid) qidOf.set(it.id, m.qid);
      } catch (e) { console.warn(e); }
      onProgress(++done, total);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const det = await Wiki.details([...qidOf.values()]);
  for (const [id, q] of qidOf) {
    const g = genreKeys(det.get(q)?.genres || []);
    if (g.length) patches.push({ id, genres: g });
  }
  onProgress(total, total);
  return patches;
}

/* Wählt aus den Wikidata-Reihen die passendste – bevorzugt Namen, die es im Raum schon gibt */
function pickSeries(labels, title, existing) {
  const clean = labels.map(l => str(l.replace(/\s*\((video game )?(series|franchise)\)$/i, '').replace(/ (video game )?(series|franchise)$/i, ''), 60)).filter(Boolean);
  if (!clean.length) return '';
  const known = existing.find(e => clean.some(l => norm(l) === norm(e)));
  if (known) return known;
  const nt = norm(title);
  let cands = clean.length > 1 ? clean.filter(l => norm(l) !== nt) : clean;
  if (!cands.length) cands = clean;
  const inTitle = cands.filter(l => nt.includes(norm(l))).sort((a, b) => b.length - a.length);
  return inTitle[0] || cands[0];
}

/* Ergänzt Suchtreffer um Reihe & Jahr (ein SPARQL-Aufruf für alle) */
async function enrichResults(list) {
  let det = new Map();
  try { det = await Wiki.details(list.map(r => r.qid)); } catch (e) { console.warn(e); }
  const existing = App.state ? franchiseNames() : [];
  for (const r of list) {
    const d = det.get(r.qid);
    r.franchise = d ? pickSeries(d.series, r.title, existing) : '';
    r.year = r.year || d?.year || null;
    r.genres = knownGenres(r) || genreKeys(d?.genres || []);
  }
  return list;
}

/* Lädt Cover für vorhandene Spiele ohne Bild. onProgress(done, total) */
async function fetchMissingCovers(items, onProgress = () => {}) {
  const patches = [];
  const withTitle = [], rest = [];
  for (const it of items) {
    const w = it.wiki || catalogEntry(it)?.wiki;
    (w ? withTitle : rest).push([it, w]);
  }
  let done = 0;
  const total = items.length;
  if (withTitle.length) {
    const found = await Wiki.byTitles(withTitle.map(([, w]) => w));
    for (const [it, w] of withTitle) {
      const info = found.get(w);
      if (info?.img) patches.push({ id: it.id, img: info.img, wiki: info.wiki });
      else if (!info) rest.push([it, null]);
      else done++;
    }
    done += patches.length;
    onProgress(done, total);
  }
  // Rest einzeln über die Suche – höchstens 3 Anfragen gleichzeitig
  const queue = rest.map(([it]) => it);
  const worker = async () => {
    while (queue.length) {
      const it = queue.shift();
      try {
        const m = await Wiki.match(it.title, it.year);
        if (m?.img) patches.push({ id: it.id, img: m.img, wiki: m.wiki });
      } catch (e) { console.warn(e); }
      onProgress(++done, total);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return patches;
}

/* Eigenes Bild → kleines JPEG (150×200) als data-URL, damit es per P2P mitgeschickt werden kann */
function imageToThumb(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) { reject(new Error('Keine Bilddatei')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const W = 150, H = 200;
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      const s = Math.max(W / img.width, H / img.height);
      const w = img.width * s, hh = img.height * s;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(img, (W - w) / 2, (H - hh) / 2, w, hh);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht gelesen werden')); };
    img.src = url;
  });
}
