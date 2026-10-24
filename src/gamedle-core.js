/* ───────── Gamedle: Spiellogik (ohne Oberfläche, testbar) ─────────
   Das Tagesspiel ergibt sich allein aus dem Datum (deutsche Zeit) – alle bekommen
   dasselbe Rätsel, ganz ohne Server. */
const GD_LAUNCH = '2026-10-24'; // Gamedle #1
const GD_TZ = 'Europe/Berlin';

const gdSlug = t => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const GD = GD_GAMES.map(([title, year, genres, plats, dev, pub, series, persp, modes, country, wiki = '', aliases = '']) => ({
  id: gdSlug(title), title, year,
  genres: genres.split(','), plats: plats.split(','), dev, pub, series, persp,
  modes: modes.split(','), country, wiki: wiki || title,
  aliases: aliases ? aliases.split('|') : [],
}));
const GD_BY_ID = new Map(GD.map(g => [g.id, g]));

/* ── Datum & Tagesspiel ── */
function gdToday(now = new Date()) {
  // 'en-CA' liefert JJJJ-MM-TT
  return new Intl.DateTimeFormat('en-CA', { timeZone: GD_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
const gdDays = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const gdDayNumber = date => gdDays(GD_LAUNCH, date) + 1;
function gdShiftDate(date, delta) {
  const d = new Date(Date.parse(date + 'T00:00:00Z') + delta * 86400000);
  return d.toISOString().slice(0, 10);
}

/* Millisekunden bis zum nächsten Rätsel (Mitternacht deutscher Zeit) */
function gdMsUntilNext(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: GD_TZ, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(now).filter(p => p.type !== 'literal').map(p => [p.type, +p.value]));
  const passed = ((parts.hour % 24) * 3600 + parts.minute * 60 + parts.second) * 1000 + now.getMilliseconds();
  return 86400000 - passed;
}

function gdRng(seed) { // mulberry32
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gdHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const gdPool = mode => (mode === 'cover' ? GD.filter(g => !GD_NO_COVER.has(g.title)) : GD);

/* Feste, gemischte Reihenfolge je Modus – Tag n bekommt den n-ten Eintrag */
const gdOrders = new Map();
function gdDaily(mode, date) {
  if (!gdOrders.has(mode)) {
    const ids = gdPool(mode).map(g => g.id).sort();
    const rnd = gdRng(gdHash('gamedle:' + mode));
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    gdOrders.set(mode, ids);
  }
  const order = gdOrders.get(mode);
  const n = gdDayNumber(date) - 1;
  return GD_BY_ID.get(order[((n % order.length) + order.length) % order.length]);
}

/* ── Vergleich eines Tipps mit der Lösung ── */
const GD_COLUMNS = [
  { key: 'genres', label: 'Genre', set: true, fmt: v => v.map(x => GD_GENRES[x]).join(', ') },
  { key: 'plats', label: 'Plattform', title: 'Plattformen bei Erstveröffentlichung', set: true, fmt: v => v.map(x => GD_PLATFORMS[x]).join(', ') },
  { key: 'dev', label: 'Entwickler' },
  { key: 'pub', label: 'Publisher' },
  { key: 'series', label: 'Reihe', fmt: v => v || 'Keine' },
  { key: 'persp', label: 'Perspektive', fmt: v => GD_PERSP[v] },
  { key: 'modes', label: 'Spielmodus', set: true, fmt: v => v.map(x => GD_MODES[x]).join(', ') },
  { key: 'country', label: 'Land' },
  { key: 'year', label: 'Jahr' },
];

function gdCompare(guess, answer) {
  return GD_COLUMNS.map(col => {
    const a = answer[col.key], g = guess[col.key];
    let state;
    if (col.key === 'year') {
      state = g === a ? 'ok' : a > g ? 'up' : 'down';
      return { key: col.key, state, near: state !== 'ok' && Math.abs(a - g) <= 3, text: String(g) };
    }
    if (col.set) {
      const same = g.length === a.length && g.every(x => a.includes(x));
      state = same ? 'ok' : g.some(x => a.includes(x)) ? 'partial' : 'no';
    } else state = g === a ? 'ok' : 'no';
    return { key: col.key, state, text: col.fmt ? col.fmt(g) : g };
  });
}

/* ── Suche (Titel & Alternativnamen) ── */
const gdNorm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
function gdSearch(q, exclude = new Set(), limit = 8) {
  const nq = gdNorm(q);
  if (!nq) return [];
  const scored = [];
  for (const g of GD) {
    if (exclude.has(g.id)) continue;
    const names = [g.title, ...g.aliases].map(gdNorm);
    let score = 0;
    for (const n of names) {
      if (n === nq) score = Math.max(score, 4);
      else if (n.startsWith(nq)) score = Math.max(score, 3);
      else if (n.split(' ').some(w => w.startsWith(nq))) score = Math.max(score, 2);
      else if (n.includes(nq)) score = Math.max(score, 1);
    }
    if (score) scored.push([score, g]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].title.localeCompare(b[1].title)).slice(0, limit).map(x => x[1]);
}

/* ── Teilen (Wordle-Stil) ── */
const GD_EMOJI = { ok: '🟩', partial: '🟨', no: '🟥', up: '⬆️', down: '⬇️' };
function gdShareText(mode, date, guesses, url) {
  const no = gdDayNumber(date);
  const n = guesses.length;
  if (mode === 'cover') {
    const marks = guesses.map((id, i) => (i === n - 1 ? '🟩' : '🟥')).join('');
    return `Gamedle #${no} · Cover 🖼️\nGelöst mit ${n} ${n === 1 ? 'Versuch' : 'Versuchen'}\n${marks}\n${url}`;
  }
  const answer = gdDaily('classic', date);
  const rows = guesses.slice(-6).map(id => gdCompare(GD_BY_ID.get(id), answer).map(c => GD_EMOJI[c.state]).join(''));
  const more = n > 6 ? `… und ${n - 6} weitere Versuche davor\n` : '';
  return `Gamedle #${no} · Klassik 🎮\nGelöst mit ${n} ${n === 1 ? 'Versuch' : 'Versuchen'}\n${more}${rows.join('\n')}\n${url}`;
}

/* ── Statistik ── */
function gdRecordWin(stats, mode, date, tries) {
  const s = stats[mode] ||= { won: 0, streak: 0, best: 0, lastWin: null, dist: {}, total: 0 };
  if (s.lastWin === date) return stats; // schon gezählt
  s.streak = s.lastWin === gdShiftDate(date, -1) ? s.streak + 1 : 1;
  s.best = Math.max(s.best, s.streak);
  s.won++;
  s.total += tries;
  s.lastWin = date;
  const bucket = tries >= 10 ? '10+' : String(tries);
  s.dist[bucket] = (s.dist[bucket] || 0) + 1;
  return stats;
}

/* Serie verfällt, wenn gestern nicht gelöst wurde */
function gdCurrentStreak(stats, mode, today) {
  const s = stats[mode];
  if (!s?.lastWin) return 0;
  return s.lastWin === today || s.lastWin === gdShiftDate(today, -1) ? s.streak : 0;
}
