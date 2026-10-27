/* ───────── Gamedle: Spiellogik (ohne Oberfläche, testbar) ─────────
   Das Tagesspiel ergibt sich allein aus dem Datum (deutsche Zeit) – alle bekommen
   dasselbe Rätsel, ganz ohne Server. */
const GD_LAUNCH = '2026-10-24'; // Gamedar #1
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

/* Tagesrätsel-Modi (jeder mit eigenem Spielplan); „endless“ ist Übung mit dem Klassik-Pool */
const GD_DAILY_MODES = ['classic', 'quote', 'emoji', 'cover', 'scene'];

/* Bild-Stufen: Cover werden schärfer, Szenen zoomen heraus (Tagesrätsel: je Fehlversuch, Duell: nach Zeit) */
const GD_COVER_LEVELS = [7, 11, 16, 24, 36, 56]; // Pixelbreite pro Stufe, danach scharf
const GD_SCENE_ZOOM = [3.4, 2.6, 2, 1.6, 1.3];   // Vergrößerung pro Stufe, danach das ganze Bild

/* Welche Spiele ein Modus kennt: Zitat, Emoji und Szene nur, wo es Inhalte gibt (gamedle-content.js) */
function gdPool(mode) {
  if (mode === 'cover') return GD.filter(g => !GD_NO_COVER.has(g.title));
  if (mode === 'quote') return GD.filter(g => GD_QUOTES[g.id]);
  if (mode === 'emoji') return GD.filter(g => GD_EMOJI_HINTS[g.id]);
  if (mode === 'scene') return GD.filter(g => GD_SCENES[g.id]);
  return GD;
}

/* Fester Spielplan (src/gamedle-schedule.js): Tag n bekommt den n-ten Eintrag.
   Neue Spiele werden nur angehängt – so ändern sich laufende Rätsel nie. */
function gdDaily(mode, date) {
  const order = GD_SCHEDULE[GD_DAILY_MODES.includes(mode) ? mode : 'classic'];
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
  { key: 'country', label: 'Land', fmt: v => v.replace('Großbritannien', 'Groß­britannien') }, // weiches Trennzeichen für schmale Zellen
  { key: 'year', label: 'Jahr' },
];

/* Firmen: gleicher Konzern unter anderem (älterem) Namen zählt als richtig,
   Studios derselben Familie (z. B. Rockstar North / San Diego) als teilweise richtig. */
const gdCompany = name => GD_COMPANY[name] || name;
const gdFamily = name => GD_FAMILY[name] || null;

function gdCompare(guess, answer) {
  return GD_COLUMNS.map(col => {
    const a = answer[col.key], g = guess[col.key];
    let state, note = '';
    if (col.key === 'year') {
      state = g === a ? 'ok' : a > g ? 'up' : 'down';
      return { key: col.key, label: col.label, state, near: state !== 'ok' && Math.abs(a - g) <= 3, text: String(g) };
    }
    if (col.set) {
      const same = g.length === a.length && g.every(x => a.includes(x));
      state = same ? 'ok' : g.some(x => a.includes(x)) ? 'partial' : 'no';
    } else if (col.key === 'dev' || col.key === 'pub') {
      if (g === a) state = 'ok';
      else if (gdCompany(g) === gdCompany(a)) { state = 'ok'; note = 'Gleiches Unternehmen unter anderem Namen'; }
      else if (gdFamily(g) && gdFamily(g) === gdFamily(a)) { state = 'partial'; note = `Gleiche Studio-Familie (${gdFamily(g)})`; }
      else state = 'no';
    } else state = g === a ? 'ok' : 'no';
    return { key: col.key, label: col.label, state, note, text: col.fmt ? col.fmt(g) : g };
  });
}

/* Tipp „Anfangsbuchstabe“ – führende Artikel überspringen (The Legend of Zelda → L) */
function gdHintLetter(title) {
  const m = title.match(/^(?:the|a|an|die|der|das)\s+(.)/i);
  return { letter: (m ? m[1] : title[0]).toUpperCase(), skipped: m ? title.split(' ')[0] : '' };
}

/* Inhalt eines Tipps zu einem Spiel – fürs Tagesrätsel und für den Schiedsrichter im Duell.
   Das verschwommene Cover ('cover') ist ein Bild und kommt von der Oberfläche. */
function gdHintValue(kind, g) {
  if (kind === 'letter') return gdHintLetter(g.title);
  if (kind === 'year') return g.year;
  if (kind === 'speaker') return GD_QUOTES[g.id]?.[1] || '?';
  return null;
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
const GD_SHARE_LABEL = { classic: 'Klassik 🎮', quote: 'Zitat 💬', emoji: 'Emoji 😀', cover: 'Cover 🖼️', scene: 'Szene 🔍' };
function gdShareText(mode, date, guesses, url, { answer = gdDaily(mode, date), hints = 0, gaveUp = false, flame = 0 } = {}) {
  const no = gdDayNumber(date);
  const n = guesses.length;
  const tries = `${n} ${n === 1 ? 'Versuch' : 'Versuchen'}`;
  const solved = `${gaveUp ? `Aufgedeckt nach ${tries} 🏳️` : `Gelöst mit ${tries}`}${hints ? ` · 💡 ${hints} ${hints === 1 ? 'Tipp' : 'Tipps'}` : ''}`;
  const title = `Gamedar #${no} · ${GD_SHARE_LABEL[mode]}${flame >= 2 ? ` · 🔥 ${flame}` : ''}`;
  if (mode !== 'classic') {
    // Ohne Eigenschaften-Vergleich: nur Fehlversuche und Treffer (lange Serien gekürzt)
    const marks = gaveUp ? (n > 12 ? `${'🟥'.repeat(10)} … +${n - 10}` : '🟥'.repeat(n))
      : n > 12 ? `${'🟥'.repeat(10)} … +${n - 11} 🟩` : guesses.map((id, i) => (i === n - 1 ? '🟩' : '🟥')).join('');
    return `${title}\n${solved}\n${marks}\n${url}`;
  }
  const rows = guesses.slice(-6).map(id => gdCompare(GD_BY_ID.get(id), answer).map(c => GD_EMOJI[c.state]).join(''));
  const more = n > 6 ? `… und ${n - 6} weitere Versuche davor\n` : '';
  return `${title}\n${solved}\n${more}${rows.join('\n')}\n${url}`;
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

/* Lösung aufgedeckt: zählt nicht als gelöst, die Serie des Modus endet sofort */
function gdRecordGiveUp(stats, mode, date) {
  const s = stats[mode] ||= { won: 0, streak: 0, best: 0, lastWin: null, dist: {}, total: 0 };
  if (s.lastGiveUp === date) return stats; // schon gezählt
  s.gaveUp = (s.gaveUp || 0) + 1;
  s.lastGiveUp = date;
  s.streak = 0;
  return stats;
}

/* ── 🔥 Tagesserie: Tage in Folge, an denen alle Tagesrätsel gelöst wurden (aufgedeckt zählt nicht) ──
   days = { streak, best, lastDay } */
function gdRecordDay(days, date) {
  if (days.lastDay === date) return days; // schon gezählt
  const streak = days.lastDay === gdShiftDate(date, -1) ? days.streak + 1 : 1;
  return { streak, best: Math.max(days.best || 0, streak), lastDay: date };
}

/* Aktuelle Serie: lebt, solange gestern oder heute alles gelöst wurde */
function gdDayStreak(days, today) {
  return days?.lastDay === today || days?.lastDay === gdShiftDate(today, -1) ? days.streak : 0;
}

/* Ältere Statistik ohne Tagesserie: aus den Serien der einzelnen Modi ableiten.
   Ein Tag war komplett, wenn jeder Modus eine Serie hat, die mindestens bis dorthin zurückreicht. */
function gdDeriveDays(stats, today) {
  const yesterday = gdShiftDate(today, -1);
  const until = day => Math.min(...GD_DAILY_MODES.map(m => {
    const s = stats[m];
    if (!s?.lastWin || !s.streak) return 0;
    if (s.lastWin === day) return s.streak;
    return s.lastWin === today && day === yesterday ? s.streak - 1 : 0; // heute schon gelöst → Serie bis gestern ist eins kürzer
  }));
  const now = until(today), before = until(yesterday);
  if (now) return { streak: now, best: now, lastDay: today };
  if (before) return { streak: before, best: before, lastDay: yesterday };
  return { streak: 0, best: 0, lastDay: null };
}
