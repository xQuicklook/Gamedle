// Tests für den Duell-Schiedsrichter (src/duel-core.js): Regeln, Zeitablauf, Punkte und dass die Lösung geheim bleibt.
// Ausführen: node --test "tests/*.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const files = ['gamedle-seal.js', 'gamedle-data.js', 'gamedle-content.js', 'gamedle-core.js', 'gamedle-schedule.js', 'duel-core.js', 'duel-history.js'];
const D = vm.runInNewContext(`${files.map(src).join('\n')}\n;({
  GD_BY_ID, GD_DAILY_MODES, GD_NO_COVER, gdDaily, gdShiftDate, gdPool,
  DUEL_ROUND_MS, DUEL_STEP_MS, DUEL_LOCK_MS, DUEL_COUNTDOWN_MS, DUEL_BREAK_MS, DUEL_POINT_ROUNDS, DUEL_HISTORY_MAX,
  duelPoints, duelCreate, duelStart, duelTick, duelGuess, duelForfeit, duelSkipGame, duelView, duelNextEvent,
  duelRecord, duelAddRecord, duelStats, DUEL_MAX_TRIES,
})`, { Intl, Date, Map, Set, TextEncoder, TextDecoder, btoa, atob });

const TODAY = '2026-10-25';
const T0 = 1_000_000; // Startzeit der Tests (beliebig)
const duel = (opts = {}) => D.duelStart(D.duelCreate({ players: ['host', 'gast'], seed: 'test', today: TODAY, ...opts }), T0);
const start = s => s.round.startAt;
// Runde ohne Treffer ablaufen lassen und die nächste starten
const timeout = s => { const end = start(s) + D.DUEL_ROUND_MS; D.duelTick(s, end); D.duelTick(s, end + D.DUEL_BREAK_MS); return s; };
// Spieler pid trifft nach ms in der laufenden Runde, danach startet die nächste
const solve = (s, pid, ms) => {
  const at = start(s) + ms;
  assert.ok(D.duelGuess(s, pid, s.round.n, s.round.gameId, at).correct);
  D.duelTick(s, at + D.DUEL_BREAK_MS);
  return s;
};

test('Duell: Punkte fallen linear von 1.000 auf 100', () => {
  assert.equal(D.duelPoints(0), 1000);
  assert.equal(D.duelPoints(45000), 550);
  assert.equal(D.duelPoints(D.DUEL_ROUND_MS), 100);
  assert.equal(D.duelPoints(-500), 1000);
  assert.equal(D.duelPoints(10 * D.DUEL_ROUND_MS), 100);
});

test('Duell: nie ein Tagesrätsel der nächsten Tage, kein Spiel doppelt, im Punkte-Duell jeder Modus einmal', () => {
  const daily = new Set();
  for (let d = 0; d <= 7; d++) for (const m of D.GD_DAILY_MODES) daily.add(D.gdDaily(m, D.gdShiftDate(TODAY, d)).id);
  for (let i = 0; i < 25; i++) {
    const s = duel({ seed: 'seed' + i });
    while (!s.over) timeout(s);
    assert.equal(s.rounds.length, D.DUEL_POINT_ROUNDS);
    assert.equal(new Set(s.rounds.map(r => r.mode)).size, 5, 'jeder Modus genau einmal');
    assert.equal(new Set(s.rounds.map(r => r.gameId)).size, 5, 'kein Spiel doppelt');
    for (const r of s.rounds) {
      assert.ok(!daily.has(r.gameId), `${r.gameId} ist ein Tagesrätsel der nächsten Tage`);
      assert.ok(D.gdPool(r.mode).some(g => g.id === r.gameId), `${r.gameId} passt nicht zum Modus ${r.mode}`);
    }
  }
});

test('Duell: gleicher Startwert ergibt dieselben Spiele, andere Startwerte andere', () => {
  const games = seed => { const s = duel({ seed }); while (!s.over) timeout(s); return s.rounds.map(r => r.gameId).join(','); };
  assert.equal(games('a'), games('a'));
  assert.ok(['b', 'c', 'd'].some(x => games(x) !== games('a')));
});

test('Duell: Die Lösung bleibt geheim, bis die Runde endet', () => {
  for (const mode of D.GD_DAILY_MODES) {
    for (let i = 0; i < 8; i++) {
      const s = duel({ kind: 'bestof', bestOf: 7, mode, seed: `${mode}${i}` });
      const { gameId } = s.round;
      const title = D.GD_BY_ID.get(gameId).title;
      // Countdown, jede Hinweis-Stufe und ein falscher Tipp
      const other = D.gdPool(mode).find(g => g.id !== gameId).id;
      D.duelGuess(s, 'gast', 1, other, start(s) + 500);
      for (const t of [T0, start(s), ...Array.from({ length: 8 }, (_, k) => start(s) + k * D.DUEL_STEP_MS + 1)]) {
        for (const pid of ['host', 'gast']) {
          const json = JSON.stringify(D.duelView(s, pid, Math.min(t, start(s) + D.DUEL_ROUND_MS - 1)));
          assert.ok(!json.includes(gameId), `${mode}: ID der Lösung sichtbar`);
          assert.ok(!json.includes(`"${title}"`), `${mode}: Titel der Lösung sichtbar`);
        }
      }
      assert.equal(D.duelView(s, 'host', T0).clue, null, 'im Countdown noch kein Hinweis');
      timeout(s);
      // Nach dem Ablauf (vor der nächsten Runde) gibt es die Auflösung – geprüft an der beendeten Runde
      assert.equal(s.rounds[0].gameId, gameId);
    }
  }
  const s = duel();
  D.duelGuess(s, 'host', 1, s.round.gameId, start(s) + 5000);
  const v = D.duelView(s, 'gast', start(s) + 6000);
  assert.equal(v.phase, 'break');
  assert.equal(v.answer, s.round.gameId, 'nach Rundenende wird aufgelöst');
  assert.equal(v.last.winner, 'host');
});

test('Duell: Hinweise kommen nach Zeit (alle 12 s eine Stufe)', () => {
  const at = (s, ms, pid = 'gast') => D.duelView(s, pid, start(s) + ms).clue;
  const kinds = clue => clue.hints.map(x => x.kind).join(',');

  const emoji = duel({ kind: 'bestof', mode: 'emoji' });
  assert.equal(at(emoji, 0).emoji.shown.length, 1);
  assert.equal(at(emoji, 11999).emoji.shown.length, 1);
  assert.equal(at(emoji, 12000).emoji.shown.length, 2);
  assert.equal(at(emoji, 48000).emoji.shown.length, 5);
  assert.equal(at(emoji, 48000).emoji.total, 5);
  assert.equal(kinds(at(emoji, 59999)), '');
  assert.equal(kinds(at(emoji, 60000)), 'year');
  assert.equal(kinds(at(emoji, 72000)), 'year,letter');

  const quote = duel({ kind: 'bestof', mode: 'quote' });
  assert.ok(at(quote, 0).quote.length > 5);
  assert.equal(kinds(at(quote, 23999)), '');
  assert.equal(kinds(at(quote, 24000)), 'year');
  assert.equal(kinds(at(quote, 48000)), 'year,speaker');
  assert.equal(kinds(at(quote, 72000)), 'year,speaker,letter');
  const answer = D.GD_BY_ID.get(quote.round.gameId);
  assert.equal(at(quote, 24000).hints[0].value, answer.year);

  const cover = duel({ kind: 'bestof', mode: 'cover' });
  assert.equal(at(cover, 30000).image.kind, 'cover');
  assert.equal(at(cover, 30000).image.step, 2);
  assert.equal(at(cover, 85000).image.step, 7);

  const scene = duel({ kind: 'bestof', mode: 'scene' });
  assert.equal(at(scene, 0).image.kind, 'scene');
  assert.equal(at(scene, 0).image.focus.length, 2);
  assert.equal(kinds(at(scene, 72000)), 'year');

  const classic = duel({ kind: 'bestof', mode: 'classic' });
  assert.equal(kinds(at(classic, 47999)), '');
  assert.equal(kinds(at(classic, 48000)), 'letter');
  const noCover = D.GD_NO_COVER.has(D.GD_BY_ID.get(classic.round.gameId).title);
  assert.equal(kinds(at(classic, 72000)), noCover ? 'letter,year' : 'letter,cover');
});

test('Duell: Tipps – zu früh, Sperre, doppelt, falsch, richtig', () => {
  const s = duel({ kind: 'bestof', mode: 'classic' });
  const { gameId } = s.round;
  const [w1, w2] = D.gdPool('classic').filter(g => g.id !== gameId).map(g => g.id);
  assert.equal(D.duelGuess(s, 'host', 1, w1, T0 + 100).why, 'early', 'vor dem Start');
  assert.deepEqual({ ...D.duelGuess(s, 'host', 1, w1, start(s) + 1000) }, { ok: true, correct: false });
  const v = D.duelView(s, 'host', start(s) + 1500);
  assert.equal(v.me.rows.length, 1, 'Klassik: Rückmeldung zum Tipp');
  assert.equal(v.me.rows[0].cells.length, 9);
  assert.equal(v.me.lockedFor, 1500);
  assert.equal(D.duelView(s, 'gast', start(s) + 1500).opp.attempts, 1, 'der Gegner sieht nur die Zahl der Versuche');
  assert.equal(D.duelGuess(s, 'host', 1, w2, start(s) + 2999).why, 'locked');
  assert.equal(D.duelGuess(s, 'host', 1, w1, start(s) + 3500).why, 'dup');
  assert.equal(D.duelGuess(s, 'host', 1, 'gibt-es-nicht', start(s) + 3500).why, 'invalid');
  assert.equal(D.duelGuess(s, 'host', 2, w2, start(s) + 3500).why, 'over', 'Tipp für eine andere Runde');
  assert.equal(D.duelGuess(s, 'gast', 1, gameId, start(s) + 10000).correct, true);
  assert.equal(D.duelGuess(s, 'host', 1, gameId, start(s) + 10001).why, 'over', 'zu spät – Runde schon gewonnen');
  const after = D.duelView(s, 'host', start(s) + 11000);
  assert.equal(after.last.winner, 'gast');
  assert.equal(after.last.ms, 10000);
  assert.equal(after.score.gast, 1);
  assert.equal(after.nextIn, D.DUEL_BREAK_MS - 1000);
  D.duelTick(s, start(s) + 10000 + D.DUEL_BREAK_MS);
  assert.equal(s.round.n, 2, 'nach der Pause beginnt die nächste Runde');
  assert.notEqual(s.round.gameId, gameId);
  assert.equal(D.duelView(s, 'host', s.round.startAt - 1000).phase, 'countdown');
});

test('Duell: Zeitablauf – im Punkte-Duell 0 Punkte, im Best-of zählt die Runde nicht', () => {
  const p = timeout(duel());
  assert.deepEqual({ ...p.rounds[0], gameId: null, mode: null }, { n: 1, mode: null, gameId: null, winner: null, ms: null, points: 0 });
  const b = duel({ kind: 'bestof', bestOf: 3 });
  timeout(b);
  assert.deepEqual({ ...D.duelView(b, 'host', start(b)).score }, { host: 0, gast: 0 });
  assert.equal(b.round.n, 2);
  assert.equal(b.over, null);
});

test('Duell: Best-of endet bei Mehrheit – oder nach der doppelten Rundenzahl', () => {
  const b3 = duel({ kind: 'bestof', bestOf: 3 });
  solve(b3, 'host', 5000);
  assert.equal(b3.over, null);
  solve(b3, 'host', 5000);
  assert.equal(b3.over.winner, 'host');
  assert.equal(b3.over.reason, 'majority');

  const b5 = duel({ kind: 'bestof', bestOf: 5 });
  solve(b5, 'host', 1000); solve(b5, 'gast', 1000); solve(b5, 'host', 1000); solve(b5, 'gast', 1000);
  assert.equal(b5.over, null, '2:2 im BO5 geht weiter');
  solve(b5, 'gast', 1000);
  assert.equal(b5.over.winner, 'gast');

  const limit = duel({ kind: 'bestof', bestOf: 3 });
  while (!limit.over) timeout(limit);
  assert.equal(limit.rounds.length, 6);
  assert.equal(limit.over.winner, null);
  assert.equal(limit.over.reason, 'draw');
});

test('Duell: Punkte-Duell – Sieger nach Punkten, bei Gleichstand nach Zeit', () => {
  const a = duel();
  solve(a, 'host', 9000); solve(a, 'gast', 30000);
  while (!a.over) timeout(a);
  assert.equal(a.over.winner, 'host');
  assert.equal(a.over.reason, 'points');
  assert.equal(a.over.score.host, 910);
  assert.equal(a.over.score.gast, 700);

  // 10.000 ms und 10.040 ms geben beide 900 Punkte – schneller gewinnt
  const b = duel();
  solve(b, 'gast', 10040); solve(b, 'host', 10000);
  while (!b.over) timeout(b);
  assert.equal(b.over.score.host, b.over.score.gast);
  assert.equal(b.over.winner, 'host');
  assert.equal(b.over.reason, 'time');

  const c = duel();
  while (!c.over) timeout(c);
  assert.equal(c.over.winner, null);
  assert.equal(c.over.reason, 'draw');
});

test('Duell: Aufgabe und Ersatzspiel', () => {
  const s = duel();
  solve(s, 'host', 2000);
  D.duelForfeit(s, 'host', start(s) + 1000);
  assert.equal(s.over.winner, 'gast');
  assert.equal(s.over.reason, 'forfeit');
  assert.equal(s.over.score.host, 980, 'bisherige Punkte bleiben stehen');
  assert.equal(D.duelView(s, 'gast', start(s) + 2000).phase, 'over');

  const k = duel();
  const first = k.round.gameId;
  D.duelSkipGame(k, T0 + 2000);
  assert.notEqual(k.round.gameId, first, 'anderes Spiel');
  assert.equal(k.round.n, 1, 'gleiche Runde');
  assert.equal(k.round.startAt, T0 + 2000 + D.DUEL_COUNTDOWN_MS, 'Countdown von vorn');
  while (!k.over) timeout(k);
  assert.ok(!k.rounds.some(r => r.gameId === first), 'das ausgelassene Spiel kommt nicht wieder');
});

test('Duell: Lädt kein Bild, wird nach wenigen Versuchen ohne Bild gespielt – nie eine Endlosschleife', () => {
  const s = duel({ kind: 'bestof', bestOf: 3, mode: 'cover' });
  const first = s.round.mode;
  assert.equal(first, 'cover');
  for (let i = 1; i < D.DUEL_MAX_TRIES; i++) {
    D.duelSkipGame(s, T0 + i);
    assert.equal(s.round.mode, 'cover', `Versuch ${i + 1}: noch ein Cover`);
  }
  D.duelSkipGame(s, T0 + 10);
  assert.ok(['emoji', 'quote', 'classic'].includes(s.round.mode), `danach ohne Bild (${s.round.mode})`);
  assert.equal(s.skipped.length, D.DUEL_MAX_TRIES);
  // Im Punkte-Duell bevorzugt ein Modus, der noch nicht dran war
  const p = duel();
  while (!['cover', 'scene'].includes(p.round.mode)) solve(p, 'host', 1000);
  const played = new Set(p.rounds.map(r => r.mode));
  for (let i = 0; i < D.DUEL_MAX_TRIES; i++) D.duelSkipGame(p, T0);
  if (!['emoji', 'quote', 'classic'].every(m => played.has(m))) assert.ok(!played.has(p.round.mode), 'noch nicht gespielter Modus');
  // Erschöpfter Pool bricht nicht ab
  const e = duel({ kind: 'bestof', bestOf: 3, mode: 'quote' });
  e.excluded = D.gdPool('quote').map(g => g.id);
  D.duelSkipGame(e, T0);
  assert.equal(e.round.mode, 'classic', 'ohne passende Spiele geht es mit Klassik weiter');
});

test('Duell: nächster Zeitpunkt für den Wecker des Hosts', () => {
  const s = duel();
  assert.equal(D.duelNextEvent(s, T0), start(s), 'Countdown → Rundenstart');
  assert.equal(D.duelNextEvent(s, start(s) + 1), start(s) + D.DUEL_STEP_MS, 'nächste Hinweis-Stufe');
  assert.equal(D.duelNextEvent(s, start(s) + 85000), start(s) + D.DUEL_ROUND_MS, 'Rundenende');
  D.duelGuess(s, 'host', 1, s.round.gameId, start(s) + 5000);
  assert.equal(D.duelNextEvent(s, start(s) + 6000), start(s) + 5000 + D.DUEL_BREAK_MS, 'nach der Auflösung die nächste Runde');
  D.duelForfeit(s, 'gast', start(s) + 6000);
  assert.equal(D.duelNextEvent(s, start(s) + 6000), null, 'Duell vorbei');
});

test('Historie: Eintrag aus einem beendeten Duell – aus Sicht beider Spieler', () => {
  const s = duel();
  solve(s, 'host', 9000); solve(s, 'gast', 30000);
  while (!s.over) timeout(s);
  const view = pid => D.duelView(s, pid, start(s) + D.DUEL_ROUND_MS);
  const host = { id: 'host', name: 'Hanna', color: '#7c6cff' }, gast = { id: 'gast', name: 'Gus', color: '#f87171' };
  const a = D.duelRecord(view('host'), host, gast, 123);
  assert.equal(a.result, 'win');
  assert.deepEqual([...a.score], [910, 700]);
  assert.equal(a.opp.name, 'Gus');
  assert.equal(a.rounds.length, 5);
  assert.deepEqual([...a.rounds.map(r => r.won)], [true, false, null, null, null]);
  const b = D.duelRecord(view('gast'), gast, host, 123);
  assert.equal(b.result, 'loss');
  assert.deepEqual([...b.score], [700, 910]);
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(a))), JSON.stringify(a), 'reines JSON');
});

test('Historie: Bilanz je Gegner, Punkte im Monat und Bestenliste', () => {
  const now = Date.parse('2026-10-25T12:00:00Z');
  const day = 86400000;
  const me = { id: 'ich', name: 'Hanna', color: '#7c6cff' };
  const alex = { id: 'alex', name: 'Alex', color: '#4ade80' }, bea = { id: 'bea', name: 'Bea', color: '#38bdf8' };
  const entry = (opp, kind, result, score, at) => ({ at, kind, bestOf: kind === 'points' ? null : 3, opp, score, result, rounds: [] });
  const history = [
    entry(alex, 'points', 'win', [3200, 2100], now - day),
    entry(alex, 'bestof', 'loss', [1, 2], now - 2 * day),
    entry(bea, 'points', 'draw', [1500, 1500], now - 3 * day),
    entry({ ...alex, name: 'Alexander' }, 'points', 'loss', [900, 3500], Date.parse('2026-09-20T12:00:00Z')),
  ];
  const st = D.duelStats(history, me, now);
  assert.deepEqual([st.duels, st.wins, st.losses, st.draws], [4, 1, 2, 1]);
  assert.equal(st.monthPoints, 4700, 'nur Punkte-Duelle im Oktober');
  assert.equal(st.bestPoints, 3200);
  assert.deepEqual([...st.opponents.map(o => `${o.name} ${o.wins}:${o.losses}:${o.draws}`)], ['Alex 1:2:0', 'Bea 0:0:1'], 'neuester Name, zuletzt gespielte zuerst');
  assert.deepEqual([...st.best.map(b => `${b.name} ${b.points}`)], ['Alex 3500', 'Hanna 3200', 'Bea 1500']);

  let long = [];
  for (let i = 0; i < D.DUEL_HISTORY_MAX + 5; i++) long = D.duelAddRecord(long, entry(bea, 'points', 'win', [i, 0], now + i));
  assert.equal(long.length, D.DUEL_HISTORY_MAX);
  assert.equal(long[0].score[0], D.DUEL_HISTORY_MAX + 4, 'neuester zuerst');
  assert.equal(D.duelStats([], me, now).duels, 0);
});

test('Duell: Der Zustand ist reines JSON (bereit für einen Server)', () => {
  const s = duel({ kind: 'bestof', bestOf: 5, mode: 'quote' });
  D.duelGuess(s, 'gast', 1, D.gdPool('quote').find(g => g.id !== s.round.gameId).id, start(s) + 3000);
  const copy = JSON.parse(JSON.stringify(s));
  assert.equal(JSON.stringify(D.duelView(copy, 'gast', start(s) + 4000)), JSON.stringify(D.duelView(s, 'gast', start(s) + 4000)));
  assert.equal(D.duelGuess(copy, 'host', 1, copy.round.gameId, start(s) + 5000).correct, true);
  assert.throws(() => D.duelCreate({ players: ['a', 'a'], seed: 1, today: TODAY }), /zwei verschiedene/);
});
