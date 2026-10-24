// Tests für die Gamedle-Logik (Daten, Tagesrätsel, Vergleich, Suche, Teilen, Statistik).
// Ausführen: node --test "tests/*.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const G = vm.runInNewContext(`${src('gamedle-data.js')}\n${src('gamedle-core.js')}\n${src('gamedle-schedule.js')}\n;({
  GD, GD_BY_ID, GD_GENRES, GD_PLATFORMS, GD_PERSP, GD_MODES, GD_NO_COVER, GD_LAUNCH, GD_SCHEDULE,
  gdToday, gdDayNumber, gdShiftDate, gdMsUntilNext, gdDaily, gdPool, gdCompare, gdSearch, gdShareText, gdRecordWin, gdCurrentStreak, gdHintLetter,
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
  for (const mode of ['classic', 'cover']) {
    const plan = G.GD_SCHEDULE[mode];
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

test('Tipp-Buchstabe überspringt Artikel', () => {
  assert.equal(G.gdHintLetter('The Legend of Zelda').letter, 'L');
  assert.equal(G.gdHintLetter('The Legend of Zelda').skipped, 'The');
  assert.equal(G.gdHintLetter('Doom').letter, 'D');
  assert.equal(G.gdHintLetter('Theme Hospital').letter, 'T');
});
