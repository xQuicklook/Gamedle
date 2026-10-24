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
const ctx = vm.createContext({
  crypto: globalThis.crypto, TextEncoder, TextDecoder, console, structuredClone, btoa, atob, Blob, Response, CompressionStream, DecompressionStream,
});
const T = vm.runInContext(`${['gamedle-data.js', 'catalog.js', 'presets.js', 'core.js', 'wiki.js'].map(src).join('\n')}\n;({
  initialState, applyAction, visibleState, isBlind, placedCount, groupView, keyHash, itemIndex, adoptRanking, PROTOCOL,
  normalizeAction, opFor, statsFor, franchiseSuggestion, imgAllowed, FULL_SYNC_ACTIONS, placeMany,
  ratedTiers, boardItems, genreKeys, knownGenres, catalogEntry, presetPacks, norm, seriesChoices, seriesFranchise,
  packOf, packItems, encodePack, decodePack, PACK_LINK_MAX,
  CATALOG, CATALOG_EXTRA, CATALOG_SHORT, GD_GAMES, GD_GENRES, GD_PLATFORMS, GD_MODES, PACK_MIN, SMALL_PACK_MIN,
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

test('Genres: kuratiert aus dem Katalog, gleichnamige andere Spiele nicht', () => {
  same(T.knownGenres({ title: 'Tetris', year: 1984 }), ['puz']);
  assert.ok(T.knownGenres({ title: 'Hollow Knight', year: 2017 }));
  assert.equal(T.knownGenres({ title: 'Hollow Knight', year: 2031 }), null, 'anderes Jahr → anderes Spiel');
});

/* ───────── Spielekatalog & Pakete ───────── */

test('Katalog: Gamedle-Spiele plus Tierly-Extras, eindeutig und mit bekannten Kürzeln', () => {
  assert.equal(T.CATALOG.length, T.GD_GAMES.length + T.CATALOG_EXTRA.length);
  const wikis = new Set(), names = new Set();
  for (const g of T.CATALOG) {
    assert.ok(!wikis.has(g.wiki), `${g.title}: Artikel doppelt`);
    assert.ok(!names.has(T.norm(g.name)), `${g.title}: Name doppelt`);
    wikis.add(g.wiki); names.add(T.norm(g.name));
    assert.ok(g.year >= 1970 && g.year <= 2030, `${g.title}: Jahr`);
    for (const k of g.genres) assert.ok(T.GD_GENRES[k], `${g.title}: Genre ${k}`);
    for (const k of g.plats) assert.ok(T.GD_PLATFORMS[k], `${g.title}: Plattform ${k}`);
    for (const k of g.modes) assert.ok(T.GD_MODES[k], `${g.title}: Spielmodus ${k}`);
  }
  // Ein Extra, das inzwischen in den Gamedle-Daten steht, muss aus CATALOG_EXTRA raus
  for (const g of T.CATALOG.filter(x => !x.gamedle)) {
    assert.ok(!T.GD_GAMES.some(r => T.norm(r[0]) === T.norm(g.title) || (r[10] || r[0]) === g.wiki), `${g.title} steht doppelt`);
  }
});

test('Katalog: Tierly-Kurznamen sind Alternativnamen und führen zum richtigen Spiel', () => {
  for (const [title, short] of Object.entries(T.CATALOG_SHORT)) {
    const g = T.CATALOG.find(x => x.title === title);
    assert.ok(g, `${title}: nicht im Katalog`);
    assert.ok(g.aliases.includes(short), `${short}: kein Alternativname von ${title}`);
    assert.equal(T.catalogEntry({ title: short, year: g.year }), g);
  }
  // Räume mit älteren Vorlagen-Titeln werden erkannt (über Artikel oder Namen)
  assert.equal(T.catalogEntry({ title: 'Zelda: Ocarina of Time', year: 1998 })?.title, 'The Legend of Zelda: Ocarina of Time');
  assert.equal(T.catalogEntry({ title: 'Doom', year: 2016 }), null, 'Doom 2016 ist nicht Doom 1993');
});

test('Pakete: nur ausreichend große, eindeutige IDs, Reihen ab 5 Spielen', () => {
  const packs = T.presetPacks();
  assert.equal(new Set(packs.map(p => p.id)).size, packs.length);
  for (const p of packs) assert.ok(p.games.length >= (p.min || T.PACK_MIN), p.name);
  assert.ok(packs.filter(p => p.id.startsWith('series:')).every(p => p.min === T.SMALL_PACK_MIN));
  assert.equal(packs.find(p => p.id === 'all').games.length, T.CATALOG.length);
  for (const id of ['rpg', 'shooter', 'nintendo', 'coop']) assert.ok(packs.some(p => p.id === id), `Paket ${id} fehlt`);
  const mario = packs.find(p => p.id === 'series:Super Mario');
  assert.ok(mario && mario.games.every(g => g.series === 'Super Mario'));
  // Jedes Jahrzehnt-Paket deckt genau seine Jahre ab
  const decades = packs.filter(p => /^\d0$/.test(p.id));
  assert.equal(decades.reduce((n, p) => n + p.games.length, 0), T.CATALOG.length);
});

/* ───────── Reihe laden ───────── */

test('Reihe laden: Ausschuss fliegt raus, Ableger & Neuauflagen sind nicht vorausgewählt', () => {
  const g = (title, year, links, ...types) => ({ title, year, date: year ? `${year}-03-03` : '', links, types: types.length ? types : ['video game'], wiki: title, genres: [] });
  const list = T.seriesChoices([
    g('The Legend of Zelda: Breath of the Wild', 2017, 52),
    g('The Legend of Zelda', 1986, 46),
    g('Heroes of Hyrule', null, 1, 'cancelled video game'),
    g('Zelda Tomorrow', 2031, 20),
    { ...g('Zelda Later This Year', 2026, 20), date: '2026-11-19' },
    g('Real Escape Game', 2017, 1, 'escape room'),
    g('The Legend of Zelda: Ocarina of Time 3D', 2011, 15),
    g('The Legend of Zelda: Twilight Princess HD', 2016, 9),
    g('Super Mario 3D World', 2013, 36),
    g('Need for Speed: Most Wanted - Terminal Velocity', 2013, 8, 'downloadable content'),
    g('The Legend of Zelda: Collector\'s Edition', 2003, 11, 'video game compilation'),
    g('BS The Legend of Zelda', 1995, 3),
  ], '2026-10-24');
  same(list.map(x => x.title), [
    'The Legend of Zelda', 'BS The Legend of Zelda', 'The Legend of Zelda: Collector\'s Edition', 'The Legend of Zelda: Ocarina of Time 3D',
    'Need for Speed: Most Wanted - Terminal Velocity', 'Super Mario 3D World', 'The Legend of Zelda: Twilight Princess HD', 'The Legend of Zelda: Breath of the Wild',
  ], 'nach Jahr, ohne Abgesagtes, Zukünftiges und Escape-Rooms');
  const hint = t => list.find(x => x.title === t);
  assert.equal(hint('The Legend of Zelda: Ocarina of Time 3D').hint, 'Neuauflage');
  assert.equal(hint('The Legend of Zelda: Twilight Princess HD').hint, 'Neuauflage');
  assert.equal(hint('Super Mario 3D World').pick, true, '„3D“ mitten im Titel ist keine Neuauflage');
  assert.equal(hint('Need for Speed: Most Wanted - Terminal Velocity').hint, 'Zusatzinhalt');
  assert.equal(hint("The Legend of Zelda: Collector's Edition").hint, 'Sammlung');
  assert.equal(hint('BS The Legend of Zelda').hint, 'wenig bekannt');
  assert.equal(hint('The Legend of Zelda').pick, true);
  const multi = T.seriesChoices([g('Link and Zelda', 1995, 20, 'video game', 'Wikimedia article covering multiple topics'), g('Satellaview games from The Legend of Zelda series', 1995, 20)], '2026-10-24');
  assert.ok(multi.every(x => x.hint === 'Sammlung'), 'Sammelartikel');
});

test('Reihe laden: Franchise-Name wie im Katalog, sonst wie im Raum, sonst der Reihenname', () => {
  const sonic = [{ wiki: 'Sonic the Hedgehog (1991 video game)', title: 'Sonic the Hedgehog', year: 1991 }, { wiki: 'Sonic Mania', title: 'Sonic Mania', year: 2017 }];
  assert.equal(T.seriesFranchise('Sonic the Hedgehog', sonic, []), 'Sonic', 'Katalog nennt die Reihe „Sonic“');
  assert.equal(T.seriesFranchise('Anno', [{ wiki: 'Anno 1602', title: 'Anno 1602', year: 1998 }], []), 'Anno');
  assert.equal(T.seriesFranchise('The Sims video game series', [], ['The Sims']), 'The Sims', 'Name aus dem Raum, Zusatz entfernt');
});

/* ───────── Spieleliste als Link ───────── */

test('Paket-Link: Spiele kommen unverändert an, leere Felder werden gespart', async () => {
  const s = room();
  const items = s.order.map(id => s.items[id]);
  const pack = T.packOf(items, 'Meine Liste');
  same(pack.g[0], ['Doom', 1993, 'Doom (1993 video game)'], 'ohne leere Reihe am Ende');
  same(pack.g[2], ['Hollow Knight: Silksong', 2025, '', 'Hollow Knight']);
  const code = await T.encodePack(pack);
  assert.match(code, /^1[A-Za-z0-9_-]+$/, 'komprimiert, nur URL-sichere Zeichen');
  const back = await T.decodePack(code);
  assert.equal(back.n, 'Meine Liste');
  same(T.packItems(back).map(it => [it.title, it.year, it.wiki, it.franchise]), items.map(it => [it.title, it.year, it.wiki, it.franchise]));
  // Der ganze Katalog passt in einen handlichen Link
  const big = await T.encodePack(T.packOf(T.CATALOG.map(g => ({ title: g.name, year: g.year, wiki: g.wiki, franchise: g.series })), 'Alles'));
  assert.ok(big.length < 20000, `Katalog-Link zu lang: ${big.length}`);
});

test('Paket-Link: kaputte oder fremde Links werden abgelehnt, Inhalte begrenzt', async () => {
  assert.equal(await T.decodePack('1abc'), null, 'abgeschnitten');
  assert.equal(await T.decodePack(''), null);
  assert.equal(T.packItems({ v: 2, g: [] }), null, 'unbekannte Version');
  assert.equal(T.packItems(null), null);
  const many = T.packItems({ v: 1, g: [...Array(T.PACK_LINK_MAX + 50)].map((_, i) => ['Spiel ' + i, 2000]) });
  assert.equal(many.length, T.PACK_LINK_MAX);
  same(T.packItems({ v: 1, g: [['', 2000], 'kaputt', ['x'.repeat(200), 'abc', 42]] }).map(it => [it.title.length, it.year, it.wiki]), [[90, null, '42']]);
  // Unkomprimierte Links (ältere Browser) gehen auch
  const plain = '0' + Buffer.from(JSON.stringify({ v: 1, n: 'A', g: [['Tetris', 1984]] })).toString('base64url');
  same(T.packItems(await T.decodePack(plain)).map(it => it.title), ['Tetris']);
});

test('Bildquellen: Wikipedia und Uploads erlaubt, fremde Links nur nach Freigabe', () => {
  const s = room();
  assert.equal(T.imgAllowed(s, 'https://upload.wikimedia.org/wikipedia/en/a/b.jpg'), true);
  assert.equal(T.imgAllowed(s, 'data:image/jpeg;base64,AAAA'), true);
  assert.equal(T.imgAllowed(s, 'https://tracker.example/x.png'), false);
  T.applyAction(s, { type: 'settings', safeImages: false }, HOST);
  assert.equal(T.imgAllowed(s, 'https://tracker.example/x.png'), true);
});
