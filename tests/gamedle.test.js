// Tests für die Gamedle-Logik (Daten, Tagesrätsel, Vergleich, Suche, Teilen, Statistik).
// Ausführen: node --test "tests/*.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const G = vm.runInNewContext(`${src('gamedle-data.js')}\n${src('gamedle-content.js')}\n${src('gamedle-core.js')}\n${src('gamedle-schedule.js')}\n;({
  GD, GD_BY_ID, GD_GENRES, GD_PLATFORMS, GD_PERSP, GD_MODES, GD_NO_COVER, GD_LAUNCH, GD_SCHEDULE, GD_DAILY_MODES,
  GD_QUOTES, GD_EMOJI_HINTS, GD_SCENES,
  gdToday, gdDayNumber, gdShiftDate, gdMsUntilNext, gdDaily, gdPool, gdCompare, gdSearch, gdNorm, gdShareText, gdRecordWin, gdCurrentStreak, gdHintLetter,
})`, { Intl, Date, Map, Set });

test('Daten: eindeutige IDs und nur bekannte Kategorien', () => {
  const ids = G.GD.map(g => g.id);
  assert.equal(new Set(ids).size, ids.length, 'IDs eindeutig');
  assert.ok(G.GD.length >= 190, `genug Spiele (${G.GD.length})`);
  for (const g of G.GD) {
    for (const x of g.genres) assert.ok(G.GD_GENRES[x], `${g.title}: Genre ${x}`);
    for (const x of g.plats) assert.ok(G.GD_PLATFORMS[x], `${g.title}: Plattform ${x}`);
    for (const x of g.modes) assert.ok(G.GD_MODES[x], `${g.title}: Modus ${x}`);
    assert.ok(G.GD_PERSP[g.persp], `${g.title}: Perspektive ${g.persp}`);
    assert.ok(g.year >= 1970 && g.year <= 2030, `${g.title}: Jahr`);
    assert.ok(g.dev && g.pub && g.country, `${g.title}: Pflichtfelder`);
  }
  for (const t of G.GD_NO_COVER) assert.ok(G.GD.some(g => g.title === t), `${t} existiert`);
});

test('Datum: Tageswechsel um Mitternacht deutscher Zeit (auch bei Zeitumstellung)', () => {
  assert.equal(G.gdToday(new Date('2026-10-24T21:59:00Z')), '2026-10-24'); // 23:59 MESZ
  assert.equal(G.gdToday(new Date('2026-10-24T22:00:00Z')), '2026-10-25'); // 00:00 MESZ
  assert.equal(G.gdToday(new Date('2026-12-31T22:59:00Z')), '2026-12-31'); // 23:59 MEZ
  assert.equal(G.gdToday(new Date('2026-12-31T23:00:00Z')), '2027-01-01');
  assert.equal(G.gdDayNumber(G.GD_LAUNCH), 1);
  assert.equal(G.gdDayNumber('2026-11-03'), 11);
  assert.equal(G.gdShiftDate('2026-03-01', -1), '2026-02-28');
  assert.equal(G.gdMsUntilNext(new Date('2026-10-24T21:59:00Z')), 60000);
});

test('Tagesrätsel: für alle gleich, je Modus verschieden, kein Wiederholen innerhalb eines Durchlaufs', () => {
  const a = G.gdDaily('classic', '2026-10-30');
  assert.equal(G.gdDaily('classic', '2026-10-30').id, a.id);
  const pool = G.gdPool('classic');
  const seen = new Set();
  for (let i = 0; i < pool.length; i++) seen.add(G.gdDaily('classic', G.gdShiftDate(G.GD_LAUNCH, i)).id);
  assert.equal(seen.size, pool.length, 'jedes Spiel genau einmal pro Durchlauf');
  const same = Array.from({ length: 30 }, (_, i) => G.gdShiftDate(G.GD_LAUNCH, i))
    .filter(d => G.gdDaily('classic', d).id === G.gdDaily('cover', d).id).length;
  assert.ok(same <= 2, 'Klassik und Cover meist verschieden');
  for (let i = 0; i < 60; i++) assert.ok(!G.GD_NO_COVER.has(G.gdDaily('cover', G.gdShiftDate(G.GD_LAUNCH, i)).title), 'Cover-Modus nur mit Cover');
});

test('Vergleich: Farben und Jahres-Pfeile', () => {
  const doom = G.GD_BY_ID.get('doom'), doom16 = G.GD_BY_ID.get('doom-2016');
  const cells = Object.fromEntries(G.gdCompare(doom, doom16).map(c => [c.key, c]));
  assert.equal(cells.dev.state, 'ok');
  assert.equal(cells.series.state, 'ok');
  assert.equal(cells.genres.state, 'ok');
  assert.equal(cells.plats.state, 'partial');      // PC ⊂ PC, PS, Xbox
  assert.equal(cells.pub.state, 'no');
  assert.equal(cells.year.state, 'up');            // Lösung ist neuer
  assert.ok(G.gdCompare(doom16, doom16).every(c => c.state === 'ok'));
});

test('Suche findet Titel, Teilwörter und deutsche Alternativnamen', () => {
  assert.equal(G.gdSearch('gta 5')[0].id, 'grand-theft-auto-v');
  assert.equal(G.gdSearch('die sims')[0].id, 'the-sims');
  assert.ok(G.gdSearch('zelda').length >= 6);
  assert.equal(G.gdSearch('pokemon rot')[0].id, 'pokemon-red-blue');
  assert.ok(!G.gdSearch('zelda', new Set(['the-legend-of-zelda'])).some(g => g.id === 'the-legend-of-zelda'), 'bereits Geratenes ausgeblendet');
});

test('Teilen: Wordle-artiger Text', () => {
  const date = '2026-10-24';
  const answer = G.gdDaily('classic', date);
  const other = G.GD.find(g => g.id !== answer.id);
  const txt = G.gdShareText('classic', date, [other.id, answer.id], 'https://example.org/#/gamedle', { hints: 1 });
  const lines = txt.split('\n');
  assert.equal(lines[0], 'Gamedle #1 · Klassik 🎮');
  assert.equal(lines[1], 'Gelöst mit 2 Versuchen · 💡 1 Tipp');
  assert.equal(lines[3], '🟩'.repeat(9));
  assert.equal(lines.at(-1), 'https://example.org/#/gamedle');
});

test('Statistik: Serie zählt nur aufeinanderfolgende Tage', () => {
  const s = {};
  G.gdRecordWin(s, 'classic', '2026-10-24', 3);
  G.gdRecordWin(s, 'classic', '2026-10-25', 5);
  G.gdRecordWin(s, 'classic', '2026-10-25', 5); // doppelt zählt nicht
  assert.equal(s.classic.streak, 2);
  assert.equal(s.classic.won, 2);
  G.gdRecordWin(s, 'classic', '2026-10-28', 12);
  assert.equal(s.classic.streak, 1);
  assert.equal(s.classic.best, 2);
  assert.equal(s.classic.dist['10+'], 1);
  assert.equal(G.gdCurrentStreak(s, 'classic', '2026-10-29'), 1);
  assert.equal(G.gdCurrentStreak(s, 'classic', '2026-10-31'), 0);
});

test('Spielplan ist festgeschrieben: bekannte Antworten bleiben, jedes Spiel genau einmal', () => {
  // Stichproben aus dem veröffentlichten Plan – ändert sich hier etwas, wurde der Plan versehentlich umsortiert
  const golden = [
    ['2026-10-24', 'super-mario-galaxy', 'dark-souls-iii'],
    ['2026-10-25', 'fifa-23', 'tony-hawk-s-pro-skater'],
    ['2026-10-26', 'clair-obscur-expedition-33', 'mass-effect'],
    ['2026-11-23', 'halo-combat-evolved', 'final-fantasy-vii-rebirth'],
    ['2027-02-01', 'hogwarts-legacy', 'mario-kart-64'],
  ];
  for (const [d, classic, cover] of golden) {
    assert.equal(G.gdDaily('classic', d).id, classic, `Klassik ${d}`);
    assert.equal(G.gdDaily('cover', d).id, cover, `Cover ${d}`);
  }
  const goldenExtra = [
    ['2026-10-24', 'super-mario-64', 'diablo-ii', 'persona-4'],
    ['2026-10-25', 'super-mario-bros', 'gran-turismo', 'super-mario-odyssey'],
    ['2027-02-01', 'uncharted-drake-s-fortune', 'mega-man-2', 'kingdom-come-deliverance'],
  ];
  for (const [d, quote, emoji, scene] of goldenExtra) {
    assert.equal(G.gdDaily('quote', d).id, quote, `Zitat ${d}`);
    assert.equal(G.gdDaily('emoji', d).id, emoji, `Emoji ${d}`);
    assert.equal(G.gdDaily('scene', d).id, scene, `Szene ${d}`);
  }
  for (const mode of G.GD_DAILY_MODES) {
    const plan = G.GD_SCHEDULE[mode];
    assert.ok(plan, `${mode}: Plan fehlt – tools/gamedle-schedule.js ausführen`);
    assert.equal(new Set(plan).size, plan.length, `${mode}: keine Doppelten`);
    const pool = G.gdPool(mode).map(g => g.id);
    assert.equal(plan.length, pool.length, `${mode}: alle Spiele im Plan – nach neuen Spielen tools/gamedle-schedule.js ausführen`);
    for (const id of plan) assert.ok(G.GD_BY_ID.has(id), `${mode}: ${id} existiert`);
  }
});

test('Firmen: Umbenennung zählt als richtig, Studio-Familie als teilweise', () => {
  const cells = (a, b) => Object.fromEntries(G.gdCompare(G.GD_BY_ID.get(a), G.GD_BY_ID.get(b)).map(c => [c.key, c]));
  const tlou = cells('the-last-of-us', 'the-last-of-us-part-ii');
  assert.equal(tlou.pub.state, 'ok', 'Sony Computer Entertainment = Sony Interactive Entertainment');
  assert.ok(tlou.pub.note);
  assert.equal(cells('grand-theft-auto-v', 'red-dead-redemption').dev.state, 'partial', 'Rockstar North ~ Rockstar San Diego');
  assert.equal(cells('grand-theft-auto-iii', 'grand-theft-auto-v').dev.state, 'ok', 'DMA Design = Rockstar North');
  assert.equal(cells('diablo', 'warcraft-iii-reign-of-chaos').dev.state, 'partial', 'Blizzard North ~ Blizzard Entertainment');
  assert.equal(cells('halo-3', 'gran-turismo').pub.state, 'no');
});

test('Zusatz-Modi: Inhalte gehören zu bekannten Spielen und verraten den Titel nicht', () => {
  const ids = new Set(G.GD.map(g => g.id));
  // Wörter aus Titel und Reihe, die im Zitat nichts zu suchen haben (kurze Füllwörter ausgenommen)
  const giveaway = g => [...new Set([g.title, g.series, ...g.aliases].filter(Boolean).flatMap(t => G.gdNorm(t).split(' ')))]
    .filter(w => w.length >= 4 && !['legend', 'world', 'game', 'with', 'from', 'that', 'this', 'part', 'remake', 'wild', 'among', 'hearts', 'dead', 'black', 'great', 'king', 'kingdom', 'fire', 'time', 'souls', 'lord', 'space', 'city', 'life', 'last'].includes(w));
  for (const [id, q] of Object.entries(G.GD_QUOTES)) {
    assert.ok(ids.has(id), `Zitat: unbekanntes Spiel ${id}`);
    assert.ok(Array.isArray(q) && q[0]?.length >= 8 && q[0].length <= 220 && q[1], `Zitat ${id}: Text und Sprecher`);
    const words = new Set(G.gdNorm(q[0]).split(' '));
    for (const w of giveaway(G.GD_BY_ID.get(id))) assert.ok(!words.has(w), `Zitat ${id} verrät „${w}“`);
  }
  for (const [id, e] of Object.entries(G.GD_EMOJI_HINTS)) {
    assert.ok(ids.has(id), `Emoji: unbekanntes Spiel ${id}`);
    assert.equal(e.split(' ').length, 5, `Emoji ${id}: genau fünf`);
    assert.ok(!/[\u{1F1E6}-\u{1F1FF}]/u.test(e), `Emoji ${id}: keine Flaggen (Windows zeigt nur Buchstaben)`);
  }
  for (const [id, s] of Object.entries(G.GD_SCENES)) {
    assert.ok(ids.has(id), `Szene: unbekanntes Spiel ${id}`);
    assert.ok(/\.(png|jpe?g|gif|webp)$/i.test(s[0]), `Szene ${id}: Bilddatei`);
    if (s.length > 1) assert.ok(s[1] >= 0 && s[1] <= 100 && s[2] >= 0 && s[2] <= 100, `Szene ${id}: Ausschnitt in Prozent`);
  }
  assert.ok(G.gdPool('quote').length >= 60, 'genug Zitate');
  assert.ok(G.gdPool('emoji').length >= 190, 'Emojis für fast alle Spiele');
  assert.ok(G.gdPool('scene').length >= 150, 'genug Szenen');
});

test('Teilen in den Zusatz-Modi: nur Fehlversuche und Treffer', () => {
  const date = '2026-10-24';
  const answer = G.gdDaily('emoji', date);
  const other = G.GD.find(g => g.id !== answer.id);
  const txt = G.gdShareText('emoji', date, [other.id, answer.id], 'https://example.org/#/gamedle/emoji');
  assert.equal(txt.split('\n')[0], 'Gamedle #1 · Emoji 😀');
  assert.equal(txt.split('\n')[2], '🟥🟩');
});

test('Tipp-Buchstabe überspringt Artikel', () => {
  assert.equal(G.gdHintLetter('The Legend of Zelda').letter, 'L');
  assert.equal(G.gdHintLetter('The Legend of Zelda').skipped, 'The');
  assert.equal(G.gdHintLetter('Doom').letter, 'D');
  assert.equal(G.gdHintLetter('Theme Hospital').letter, 'T');
});
