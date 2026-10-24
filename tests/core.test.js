// Tests für die Kernlogik (Reducer, Duplikate, verdecktes Ranken, Spieler-Schlüssel).
// Ausführen: node --test tests/core.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// presets.js + core.js (+ wiki.js und Gamedle-Daten für die Genres) in eine Sandbox laden
// und die benötigten Funktionen herausreichen
const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const ctx = vm.createContext({ crypto: globalThis.crypto, TextEncoder, console, structuredClone });
const T = vm.runInContext(`${['presets.js', 'core.js', 'wiki.js', 'gamedle-data.js', 'gamedle-core.js'].map(src).join('\n')}\n;({
  initialState, applyAction, visibleState, isBlind, placedCount, groupView, keyHash, itemIndex, adoptRanking, PROTOCOL,
  normalizeAction, opFor, statsFor, franchiseSuggestion, imgAllowed, FULL_SYNC_ACTIONS, placeMany,
  ratedTiers, boardItems, genreKeys, knownGenres, GAME_PRESET, GD_GENRES,
})`, ctx);
const clone = o => JSON.parse(JSON.stringify(o));

const HOST = 'host1', GUEST = 'guest1', OTHER = 'guest2';
// Objekte aus der Sandbox haben andere Prototypen – daher per JSON vergleichen
const same = (a, b, msg) => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);

function room() {
  const s = T.initialState(HOST);
  for (const id of [HOST, GUEST, OTHER]) s.players[id] = { id, name: id, color: '#7c6cff', online: true };
  T.applyAction(s, { type: 'items/add', items: [
    { id: 'doom93', title: 'Doom', year: 1993, wiki: 'Doom (1993 video game)' },
    { id: 'hk', title: 'Hollow Knight', year: 2017, wiki: 'Hollow Knight', franchise: 'Hollow Knight' },
    { id: 'silk', title: 'Hollow Knight: Silksong', year: 2025, franchise: 'Hollow Knight' },
  ] }, HOST);
  return s;
}
const place = (s, actor, itemId, tierIdx, board = 'games') =>
  T.applyAction(s, { type: 'place', board, itemId, tierId: s.tiers[tierIdx].id }, actor);

test('gleichnamiges Spiel mit anderem Wikipedia-Artikel wird hinzugefügt und bekommt das Jahr', () => {
  const s = room();
  assert.equal(T.applyAction(s, { type: 'items/add', items: [{ id: 'doom16', title: 'Doom', year: 2016, wiki: 'Doom (2016 video game)' }] }, HOST), true);
  assert.equal(s.items.doom16.title, 'Doom (2016)');
});

test('Mehrfachauswahl: placeMany sortiert alle in Auswahl-Reihenfolge ein und nimmt sie woanders heraus', () => {
  const s = room();
  place(s, HOST, 'doom93', 0);
  place(s, HOST, 'hk', 1);
  const [s1, s2] = s.tiers.map(t => t.id);
  // silk + doom93 vor hk in Stufe 2; doom93 verschwindet dabei aus Stufe 1
  const rows = T.placeMany(s.rankings[HOST].games, ['silk', 'doom93'], s2, 0);
  same(rows[s1], []);
  same(rows[s2], ['silk', 'doom93', 'hk']);
  assert.equal(T.applyAction(s, { type: 'ranking/set', board: 'games', rows, multi: true }, HOST), true);
  same(s.rankings[HOST].games[s2], ['silk', 'doom93', 'hk']);
  // Zurück in die Liste
  const back = T.placeMany(s.rankings[HOST].games, ['silk', 'hk'], null);
  same(back[s2], ['doom93']);
});

test('gleicher Artikel oder gleicher Titel ohne Artikel gilt als Duplikat', () => {
  const s = room();
  assert.equal(T.applyAction(s, { type: 'items/add', items: [{ title: 'DOOM', year: 1993, wiki: 'Doom (1993 video game)' }] }, HOST), false);
  assert.equal(T.applyAction(s, { type: 'items/add', items: [{ title: 'hollow knight' }] }, HOST), false);
  // Manuell, anderes Jahr → eigenes Spiel
  assert.equal(T.applyAction(s, { type: 'items/add', items: [{ id: 'hk2', title: 'Hollow Knight', year: 2030 }] }, HOST), true);
  assert.equal(s.items.hk2.title, 'Hollow Knight (2030)');
});

test('itemIndex erkennt Duplikate auch für Suchtreffer', () => {
  const s = room();
  const idx = T.itemIndex(s);
  assert.ok(idx.duplicateOf({ title: 'Doom', wiki: 'Doom (1993 video game)' }));
  assert.equal(idx.duplicateOf({ title: 'Doom', year: 2016, wiki: 'Doom (2016 video game)' }), null);
});

test('settings ändert nur die übergebenen Schalter', () => {
  const s = room();
  T.applyAction(s, { type: 'settings', hostOnlyEdit: true }, HOST);
  T.applyAction(s, { type: 'settings', blind: false }, HOST);
  assert.equal(s.settings.hostOnlyEdit, true);
  assert.equal(s.settings.blind, false);
  assert.equal(T.applyAction(s, { type: 'settings', blind: true }, GUEST), false, 'Gäste dürfen das nicht');
});

test('neue Räume sind verdeckt; Gäste sehen nur die eigene Liste plus Fortschritt', () => {
  const s = room();
  assert.equal(T.isBlind(s, 'games'), true);
  place(s, GUEST, 'hk', 0);
  place(s, OTHER, 'hk', 2);
  place(s, OTHER, 'doom93', 1);

  const v = T.visibleState(s, GUEST);
  assert.equal(Object.values(v.rankings[GUEST].games).flat().length, 1, 'eigene Liste vollständig');
  same(v.rankings[OTHER].games, {}, 'fremde Liste leer');
  assert.equal(v.progress[OTHER].games, 2, 'Fortschritt sichtbar');
  assert.equal(T.placedCount(v, OTHER, 'games'), 2);
  assert.ok(Object.values(s.rankings[OTHER].games).flat().length === 2, 'Host-Zustand bleibt unverändert');
});

test('nur der Host deckt auf; danach bekommen Gäste alles; neue Runde setzt Fertig zurück', () => {
  const s = room();
  place(s, OTHER, 'hk', 2);
  T.applyAction(s, { type: 'ready', board: 'games', value: true }, OTHER);
  assert.equal(T.applyAction(s, { type: 'reveal', board: 'games', value: true }, GUEST), false);
  assert.equal(T.applyAction(s, { type: 'reveal', board: 'games', value: true }, HOST), true);

  const v = T.visibleState(s, GUEST);
  assert.equal(Object.values(v.rankings[OTHER].games).flat().length, 1);
  assert.equal(T.isBlind(s, 'franchises'), true, 'Franchises bleiben verdeckt');

  T.applyAction(s, { type: 'reveal', board: 'games', value: false }, HOST);
  assert.equal(s.rankings[OTHER].ready.games, false);
  same(T.visibleState(s, GUEST).rankings[OTHER].games, {});
});

test('verdeckt ausgeschaltet → Gäste sehen den vollen Zustand', () => {
  const s = room();
  T.applyAction(s, { type: 'settings', blind: false }, HOST);
  assert.equal(T.visibleState(s, GUEST), s);
});

test('Gruppenergebnis zählt alle Listen', () => {
  const s = room();
  place(s, HOST, 'hk', 0);
  place(s, GUEST, 'hk', 0);
  const g = T.groupView(s, 'games');
  assert.equal(g.lists, 2);
  assert.equal(g.rows[0].items[0].id, 'hk');
});

test('mitgebrachte Liste wird nur mit gültigen Stufen übernommen', () => {
  const s = room();
  const tid = s.tiers[1].id;
  T.adoptRanking(s, 'newbie', { games: { [tid]: ['hk', 42, 'doom93'], fake: ['silk'] } });
  same(s.rankings.newbie.games, { [tid]: ['hk', 'doom93'] });
});

test('Spieler-Schlüssel: gleicher Schlüssel → gleicher Hash, zu kurz → abgelehnt', async () => {
  const a = await T.keyHash('abcdefghijklmnopqrstuvwx');
  assert.equal(a, await T.keyHash('abcdefghijklmnopqrstuvwx'));
  assert.notEqual(a, await T.keyHash('abcdefghijklmnopqrstuvwy'));
  assert.equal(await T.keyHash('kurz'), null);
  assert.equal(await T.keyHash(undefined), null);
});

/* ───────── Delta-Sync (ops) ───────── */

// Simuliert Host + einen Gast: Der Host wendet Aktionen an und verteilt sie als ops,
// der Gast wendet die für ihn gefilterten ops auf seinen Stand an.
// steps(host) liefert die Aktionen – so können sie die Stufen-IDs des Hosts benutzen.
function simulate(steps, viewer) {
  const host = room();
  let guest = clone(T.visibleState(host, viewer));
  for (const [raw, by] of steps(host)) {
    const a = T.normalizeAction(typeof raw === 'function' ? raw(host) : raw);
    if (!T.applyAction(host, a, by)) continue;
    host.rev = (host.rev || 0) + 1;
    if (T.FULL_SYNC_ACTIONS.has(a.type)) { guest = clone(T.visibleState(host, viewer)); continue; }
    const op = clone(T.opFor(host, { rev: host.rev, a, by }, viewer));
    T.applyAction(guest, op.a, op.by);
    guest.rev = op.rev;
  }
  return { host, guest };
}
const placeA = (item, tierIdx, board = 'games') => h => ({ type: 'place', board, itemId: item, tierId: h.tiers[tierIdx].id });

test('normalizeAction vergibt fehlende IDs, damit alle dasselbe Ergebnis bekommen', () => {
  const a = T.normalizeAction({ type: 'items/add', items: [{ title: 'Celeste' }] });
  assert.ok(a.items[0].id);
  const t = T.normalizeAction({ type: 'tiers/set', tiers: [{ name: 'Top' }] });
  assert.ok(t.tiers[0].id);
});

test('ops: offener Raum – Gast endet exakt beim Host-Stand', () => {
  const { host, guest } = simulate(() => [
    [{ type: 'settings', blind: false }, HOST],
    [placeA('hk', 0), GUEST],
    [placeA('doom93', 2), OTHER],
    [{ type: 'items/add', items: [{ title: 'Celeste', year: 2018 }] }, OTHER],
    [{ type: 'tiers/set', tiers: [{ name: 'Top', color: '#ff0000' }, { name: 'Flop', color: '#0000ff' }] }, HOST],
    [placeA('silk', 1), OTHER],
    [{ type: 'items/remove', ids: ['doom93'] }, HOST],
    [placeA('hk', 1), GUEST],
  ], GUEST);
  const strip = s => ({ items: s.items, order: s.order, tiers: s.tiers, rankings: s.rankings, rev: s.rev });
  same(strip(guest), strip(host));
});

test('ops: verdeckt – Gast sieht fremde Züge nur als Zähler', () => {
  const { host, guest } = simulate(() => [
    [placeA('hk', 0), OTHER],
    [placeA('doom93', 1), OTHER],
    [placeA('silk', 2), GUEST],
  ], GUEST);
  assert.equal(Object.values(guest.rankings[OTHER]?.games || {}).flat().length, 0, 'keine fremden Platzierungen beim Gast');
  assert.equal(guest.progress[OTHER].games, 2);
  assert.equal(T.placedCount(guest, OTHER, 'games'), T.placedCount(host, OTHER, 'games'));
  same(guest.rankings[GUEST].games, host.rankings[GUEST].games, 'eigene Liste identisch');
});
test('ops: Aufdecken schickt den vollen Stand', () => {
  const s = room();
  const tid = s.tiers[0].id;
  const host = s;
  T.applyAction(host, { type: 'place', board: 'games', itemId: 'hk', tierId: tid }, OTHER);
  assert.ok(T.FULL_SYNC_ACTIONS.has('reveal'));
  T.applyAction(host, { type: 'reveal', board: 'games', value: true }, HOST);
  same(T.visibleState(host, GUEST).rankings[OTHER].games, { [tid]: ['hk'] });
});

test('progress/set nur vom Host', () => {
  const s = room();
  assert.equal(T.applyAction(s, { type: 'progress/set', pid: OTHER, board: 'games', n: 5 }, GUEST), false);
  assert.equal(T.applyAction(s, { type: 'progress/set', pid: OTHER, board: 'games', n: 5 }, HOST), true);
  assert.equal(s.progress[OTHER].games, 5);
});

/* ───────── Rückgängig-Bausteine ───────── */

test('ranking/set ersetzt und ranking/merge ergänzt die eigene Liste', () => {
  const s = room();
  const [a, b] = s.tiers;
  T.applyAction(s, { type: 'ranking/set', board: 'games', rows: { [a.id]: ['hk', 'hk', 'doom93'], unknown: ['silk'] } }, GUEST);
  same(s.rankings[GUEST].games, { [a.id]: ['hk', 'doom93'] });
  assert.equal(T.applyAction(s, { type: 'ranking/merge', board: 'games', rows: { [b.id]: ['hk', 'silk'] } }, GUEST), true);
  same(s.rankings[GUEST].games, { [a.id]: ['hk', 'doom93'], [b.id]: ['silk'] });
  assert.equal(T.applyAction(s, { type: 'ranking/merge', board: 'games', rows: { [b.id]: ['hk'] } }, GUEST), false, 'nichts Neues');
});

/* ───────── Auswertung ───────── */

test('Gleichstand landet in der besseren Stufe; Median und Mindeststimmen', () => {
  const s = room();
  place(s, HOST, 'hk', 0); place(s, GUEST, 'hk', 1);                       // Ø 0,5 → S
  place(s, HOST, 'doom93', 0); place(s, GUEST, 'doom93', 0); place(s, OTHER, 'doom93', 5); // Ø 1,67 → A, Median 0 → S
  place(s, OTHER, 'silk', 2);                                               // nur 1 Stimme
  const mean = T.groupView(s, 'games');
  assert.ok(mean.rows[0].items.some(i => i.id === 'hk'));
  assert.ok(mean.rows[2].items.some(i => i.id === 'doom93'));
  const med = T.groupView(s, 'games', { method: 'median', minVotes: 2 });
  assert.ok(med.rows[0].items.some(i => i.id === 'doom93'));
  assert.ok(med.few.some(i => i.id === 'silk'), 'zu wenige Stimmen');
});

test('Statistik: Übereinstimmung, Streit und Einigkeit', () => {
  const s = room();
  place(s, HOST, 'hk', 0); place(s, GUEST, 'hk', 0); place(s, OTHER, 'hk', 0);
  place(s, HOST, 'doom93', 0); place(s, GUEST, 'doom93', 0); place(s, OTHER, 'doom93', 5);
  const st = T.statsFor(s, 'games');
  const hg = st.pairs.find(p => [p.a.id, p.b.id].sort().join() === [GUEST, HOST].sort().join());
  assert.equal(hg.match, 100);
  assert.equal(st.controversial[0].item.id, 'doom93');
  assert.equal(st.consensus[0].item.id, 'hk');
  assert.equal(st.outliers.find(o => o.player.id === OTHER)?.item.id, 'doom93');
});

test('Franchise-Vorschlag aus den eigenen Spiele-Rankings', () => {
  const s = room();
  place(s, GUEST, 'hk', 0); place(s, GUEST, 'silk', 1); // Ø 0,5 → S
  const sug = T.franchiseSuggestion(s, GUEST);
  assert.equal(sug.count, 1);
  same(sug.rows, { [s.tiers[0].id]: ['fr:hollow-knight'] });
});

/* ───────── Stufen ohne Wertung ───────── */

// Letzte Stufe (F) als „Nicht werten“ markieren
function unratedRoom() {
  const s = room();
  T.applyAction(s, { type: 'tiers/set', tiers: s.tiers.map((t, i) => (i === s.tiers.length - 1 ? { ...t, unrated: true } : t)) }, HOST);
  return s;
}

test('tiers/set übernimmt „Nicht werten“, aber nie für alle Stufen', () => {
  const s = unratedRoom();
  assert.equal(s.tiers[5].unrated, true);
  assert.equal(T.ratedTiers(s).length, 5);
  T.applyAction(s, { type: 'tiers/set', tiers: s.tiers.map(t => ({ ...t, unrated: true })) }, HOST);
  assert.ok(s.tiers.every(t => !t.unrated), 'mindestens eine Stufe muss werten');
});

test('Gruppenergebnis: Stufen ohne Wertung ziehen den Schnitt nicht herunter', () => {
  const s = unratedRoom();
  const skip = s.tiers[5];
  place(s, HOST, 'hk', 0); place(s, GUEST, 'hk', 0); place(s, OTHER, 'hk', 5); // S, S, Nicht gespielt
  place(s, HOST, 'doom93', 5); place(s, GUEST, 'doom93', 5);                  // nur „Nicht gespielt“
  const g = T.groupView(s, 'games', { minVotes: 2 });
  assert.equal(g.rows[0].items[0].id, 'hk');
  assert.equal(g.votes.get('hk').length, 2, 'nur zwei echte Wertungen');
  assert.equal(g.rows[0].items[0]._spread, 0);
  // Nur ohne Wertung platziert → steht in der Stufe ohne Wertung, nicht bei „zu wenige Stimmen“
  const row = g.rows.find(r => r.tier.id === skip.id);
  same(row.items.map(i => i.id), ['doom93']);
  assert.ok(!g.few.some(i => i.id === 'doom93'));
  assert.equal(g.skipped.get('doom93').length, 2);
  assert.equal(g.lists, 3);
});

test('Statistik und Franchise-Vorschlag ignorieren Stufen ohne Wertung', () => {
  const s = unratedRoom();
  place(s, HOST, 'hk', 0); place(s, GUEST, 'hk', 0); place(s, OTHER, 'hk', 5);
  place(s, HOST, 'doom93', 4); place(s, GUEST, 'doom93', 4);
  const st = T.statsFor(s, 'games');
  assert.equal(st.controversial.length, 0, '„Nicht gespielt“ ist kein Streit');
  assert.ok(st.players.every(p => p.id !== OTHER), 'wer nur ohne Wertung platziert, zählt nicht mit');
  const hg = st.pairs.find(p => [p.a.id, p.b.id].sort().join() === [GUEST, HOST].sort().join());
  assert.equal(hg.match, 100);

  place(s, GUEST, 'silk', 5); // Hollow Knight: S, Silksong: Nicht gespielt → Reihe bleibt S
  same(T.franchiseSuggestion(s, GUEST).rows, { [s.tiers[0].id]: ['fr:hollow-knight'] });
});

/* ───────── Genres ───────── */

test('Genres: nur gültige Kürzel, höchstens 4; Franchises sammeln die Genres ihrer Spiele', () => {
  const s = room();
  T.applyAction(s, { type: 'items/patch', patches: [
    { id: 'hk', genres: ['mv', 'plat', 'mv', 'BAD', 42, ['aa']] },
    { id: 'silk', genres: ['mv', 'sou', 'aa', 'plat', 'rpg'] },
  ] }, HOST);
  same(s.items.hk.genres, ['mv', 'plat']);
  assert.equal(s.items.silk.genres.length, 4);
  assert.equal('genres' in s.items.doom93, false, 'ohne Genre kein leeres Feld');
  const fr = T.boardItems(s, 'franchises').find(f => f.id === 'fr:hollow-knight');
  same([...fr.genres].sort(), ['aa', 'mv', 'plat', 'sou']);
  // Leere Liste löscht die Genres wieder
  T.applyAction(s, { type: 'items/patch', patches: [{ id: 'hk', genres: [] }] }, HOST);
  assert.equal('genres' in s.items.hk, false);
});

test('Genres: Wikidata-Namen werden auf unsere Genres abgebildet', () => {
  same(T.genreKeys(['action role-playing game', 'Soulslike', 'open world']), ['arpg', 'sou']);
  same(T.genreKeys(['massively multiplayer online role-playing game']), ['mmo']);
  same(T.genreKeys(['role-playing video game', 'tactical role-playing game']), ['rpg']);
  same(T.genreKeys(['action-adventure game']), ['aa']);
  same(T.genreKeys(['point-and-click adventure game']), ['adv']);
  same(T.genreKeys(['survival horror']), ['hor']);
  same(T.genreKeys(['puzzle-platform game']), ['plat', 'puz']);
  same(T.genreKeys(['real-time strategy', 'city-building game']), ['str', 'sim']);
  same(T.genreKeys(['roguelike deck-building game']), ['rog', 'card']);
  for (const k of T.genreKeys(['first-person shooter', 'battle royale game', 'kart racing game', 'fighting game', 'Metroidvania', 'stealth game', 'hack and slash', 'multiplayer online battle arena', 'sandbox game', 'party video game'])) {
    assert.ok(T.GD_GENRES[k], k);
  }
});

test('Genres: alle Vorlagen-Spiele haben kuratierte Genres, gleichnamige andere Spiele nicht', () => {
  for (const g of T.GAME_PRESET) {
    const genres = T.knownGenres({ wiki: g[3] || g[0], title: g[0], year: g[1] });
    assert.ok(genres?.length, `${g[0]}: kein Genre`);
    for (const k of genres) assert.ok(T.GD_GENRES[k], `${g[0]}: Genre ${k}`);
  }
  assert.ok(T.knownGenres({ title: 'Hollow Knight', year: 2017 }));
  assert.equal(T.knownGenres({ title: 'Hollow Knight', year: 2031 }), null, 'anderes Jahr → anderes Spiel');
});

test('Bildquellen: Wikipedia und Uploads erlaubt, fremde Links nur nach Freigabe', () => {
  const s = room();
  assert.equal(T.imgAllowed(s, 'https://upload.wikimedia.org/wikipedia/en/a/b.jpg'), true);
  assert.equal(T.imgAllowed(s, 'data:image/jpeg;base64,AAAA'), true);
  assert.equal(T.imgAllowed(s, 'https://tracker.example/x.png'), false);
  T.applyAction(s, { type: 'settings', safeImages: false }, HOST);
  assert.equal(T.imgAllowed(s, 'https://tracker.example/x.png'), true);
});
