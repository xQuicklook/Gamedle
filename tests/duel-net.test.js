// Tests für die Duell-Verbindung (src/duel-net.js): Host und Gast über eine nachgebaute Leitung mit Laufzeit –
// ohne PeerJS, damit Ablauf, Zeitausgleich und Geheimhaltung prüfbar sind. Ausführen: node --test "tests/*.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const files = ['gamedle-seal.js', 'gamedle-data.js', 'gamedle-content.js', 'gamedle-core.js', 'gamedle-schedule.js', 'duel-core.js', 'duel-net.js'];
const D = vm.runInNewContext(`${files.map(src).join('\n')}\n;({
  GD_BY_ID, gdPool, DUEL_ROUND_MS, DUEL_STEP_MS, DUEL_GRACE_MS, DUEL_BREAK_MS, DUEL_MAX_LAG,
  duelRoom, duelClient, duelGuess,
})`, { Intl, Date, Map, Set, TextEncoder, TextDecoder, btoa, atob });

const TODAY = '2026-10-25';
const T0 = 5_000_000;
const HOST = { id: 'host', name: 'Hanna', color: '#7c6cff' };
const GAST = { id: 'gast', name: 'Gus', color: '#f87171' };
const flush = () => new Promise(r => setImmediate(r));

/* Host und Gast, verbunden über eine Leitung mit Laufzeit rtt; alle Nachrichten an den Gast werden mitgeschrieben */
function link({ settings = { kind: 'bestof', bestOf: 3, mode: 'classic' }, rtt = 80, media = null } = {}) {
  let t = T0;
  const queue = [];
  const toGuest = [];
  const now = () => t;
  const room = D.duelRoom({ settings, host: HOST, today: TODAY, now, seed: () => 'netz', media });
  const client = D.duelClient({ me: GAST, now });
  const later = fn => queue.push({ at: t + rtt / 2, fn });
  room.send = msg => { const copy = JSON.parse(JSON.stringify(msg)); toGuest.push(copy); later(() => client.receive(copy, t)); };
  client.send = msg => {
    const copy = JSON.parse(JSON.stringify(msg));
    later(() => {
      // Das Begrüßen übernimmt sonst die PeerJS-Schicht
      if (copy.t === 'hello') { const reason = room.admit(copy); if (reason) client.receive({ t: 'reject', reason }, t); else room.connected(t); }
      else room.receive(copy, t);
    });
  };
  /* Zeit vorspulen: Nachrichten zustellen, alle 100 ms tickt der Host */
  const advance = async ms => {
    const end = t + ms;
    while (t < end) {
      const step = Math.min(end, Math.floor(t / 100) * 100 + 100);
      for (let i = queue.findIndex(q => q.at <= step); i >= 0; i = queue.findIndex(q => q.at <= step)) {
        const [q] = queue.splice(i, 1);
        t = Math.max(t, q.at);
        q.fn();
      }
      t = step;
      room.tick(t);
      await flush();
    }
  };
  return { room, client, toGuest, advance, now };
}

const join = async l => { l.client.hello(); await l.advance(200); };

test('Verbindung: Gast tritt bei und bekommt Gegner und Ansichten', async () => {
  const l = link();
  await join(l);
  assert.equal(l.client.host.name, 'Hanna');
  assert.equal(l.room.guest.name, 'Gus');
  assert.equal(l.client.current().phase, 'lobby');
  l.room.start();
  await l.advance(100);
  assert.equal(l.client.current().phase, 'countdown');
  await l.advance(3000);
  assert.equal(l.client.current().phase, 'play');
  assert.equal(l.client.current().n, 1);
});

test('Verbindung: Die Lösung geht vor Rundenende nie über die Leitung', async () => {
  for (const mode of ['classic', 'quote', 'emoji', 'cover', 'scene']) {
    const l = link({ settings: { kind: 'bestof', bestOf: 3, mode }, media: async job => `data:image/png;base64,${btoa(job.key)}` });
    await join(l);
    l.room.start();
    await l.advance(3200);
    const { gameId } = l.room.state.round;
    const title = D.GD_BY_ID.get(gameId).title;
    const wrong = D.gdPool(mode).find(g => g.id !== gameId).id;
    l.client.guess(wrong);
    await l.advance(80 * 1000);
    const sent = JSON.stringify(l.toGuest);
    assert.ok(!sent.includes(gameId), `${mode}: ID der Lösung verschickt`);
    assert.ok(!sent.includes(`"${title}"`), `${mode}: Titel der Lösung verschickt`);
    if (mode === 'cover' || mode === 'scene') assert.ok(l.toGuest.some(m => m.t === 'media'), `${mode}: Bilder kommen an`);
    await l.advance(10 * 1000);
    assert.equal(l.client.current().answer, gameId, 'nach Ablauf aufgelöst');
  }
});

test('Verbindung: Laufzeit wird gemessen und dem Tipp des Gasts gutgeschrieben', async () => {
  const l = link({ rtt: 80 });
  await join(l);
  for (let i = 0; i < 6; i++) { l.room.ping(); await l.advance(500); }
  assert.ok(Math.abs(l.room.rtt - 80) <= 1, `Laufzeit ${l.room.rtt}`);
  l.room.start();
  await l.advance(3000 + 4960);
  const start = l.room.state.round.startAt;
  // Der Gast tippt 5.000 ms nach dem Start (Host-Zeit); er hat die Runde aber erst ~40 ms später gesehen
  await l.advance(start + 5000 - l.now());
  l.client.guess(l.room.state.round.gameId);
  await l.advance(200);
  const last = l.room.state.rounds[0];
  assert.equal(last.winner, 'gast');
  assert.equal(last.ms, 5000 + 40 - 80, 'Eingang (5.040 ms) minus volle Laufzeit');

  const slow = link({ rtt: 1000 });
  slow.client.hello();
  await slow.advance(1200);
  slow.room.ping();
  await slow.advance(1100);
  assert.equal(slow.room.rtt, 1000);
  slow.room.start();
  await slow.advance(3000 + 9000);
  slow.client.guess(slow.room.state.round.gameId);
  const sentAt = slow.now();
  await slow.advance(1000);
  assert.equal(slow.room.state.rounds[0].ms, sentAt + 500 - D.DUEL_MAX_LAG - slow.room.state.round.startAt, 'höchstens 300 ms gutgeschrieben');
});

test('Verbindung: Die Uhr läuft beim Gast zwischen zwei Nachrichten weiter', async () => {
  const l = link();
  await join(l);
  l.room.start();
  await l.advance(3500);
  const a = l.client.current();
  const b = l.client.current(l.now() + 3000);
  assert.equal(a.timeLeft - b.timeLeft, 3000);
});

test('Verbindung: Abbruch – 15 s Gnadenfrist, Wiederverbinden schickt alles neu, danach gewinnt der Host', async () => {
  const l = link();
  await join(l);
  l.room.start();
  await l.advance(5000);
  l.room.lost(l.now());
  await l.advance(D.DUEL_GRACE_MS - 1000);
  assert.equal(l.room.state.over, null, 'noch in der Frist');
  const before = l.toGuest.length;
  l.client.hello();
  await l.advance(200);
  assert.ok(l.toGuest.slice(before).some(m => m.t === 'welcome') && l.toGuest.slice(before).some(m => m.t === 'view'), 'nach dem Wiederverbinden alles neu');
  l.room.lost(l.now());
  await l.advance(D.DUEL_GRACE_MS + 200);
  assert.equal(l.room.state.over.winner, 'host');
  assert.equal(l.room.state.over.reason, 'forfeit');
});

test('Verbindung: zweiter Gast, falsche Version und eigene ID werden abgewiesen', async () => {
  const l = link();
  await join(l);
  assert.equal(l.room.admit({ t: 'hello', v: 1, player: { id: 'dritter', name: 'X' } }), 'full');
  assert.equal(l.room.admit({ t: 'hello', v: 99, player: GAST }), 'version');
  assert.equal(l.room.admit({ t: 'hello', v: 1, player: HOST }), 'self');
  assert.equal(l.room.admit({ t: 'hello', v: 1, player: { name: 'ohne ID' } }), 'invalid');
  assert.equal(l.room.admit({ t: 'hello', v: 1, player: { ...GAST, name: 'x'.repeat(50) } }), null, 'derselbe Gast darf wieder rein');
  assert.equal(l.room.guest.name.length, 20, 'Name gekürzt');
});

test('Verbindung: Bilder – nur Daten-URLs der aktuellen Stufe; lädt das Startbild nicht, kommt ein anderes Spiel', async () => {
  let failFirst = true;
  const asked = [];
  const media = async (job, game) => {
    asked.push(job.key);
    if (failFirst && job.step === 0 && job.kind === 'cover') { failFirst = false; return null; }
    return `data:image/png;base64,${btoa(job.key + game.id)}`;
  };
  const l = link({ settings: { kind: 'bestof', bestOf: 3, mode: 'cover' }, media });
  await join(l);
  l.room.start();
  const first = l.room.state.round.gameId;
  await l.advance(500);
  assert.notEqual(l.room.state.round.gameId, first, 'Startbild fehlt → anderes Spiel');
  assert.equal(l.client.current().attempt, 1);
  await l.advance(3000);
  const keys = () => l.toGuest.filter(m => m.t === 'media').map(m => m.key);
  assert.deepEqual(keys(), ['1.1:cover:0']);
  assert.ok(asked.includes('1.1:cover:1'), 'nächste Stufe schon vorbereitet');
  await l.advance(D.DUEL_STEP_MS);
  assert.deepEqual(keys(), ['1.1:cover:0', '1.1:cover:1']);
  assert.ok(l.client.media.has('1.1:cover:1'));
  // Fremde Adressen nimmt der Gast nicht an
  l.client.receive({ t: 'media', key: 'x', src: 'https://example.org/spion.png' });
  assert.ok(!l.client.media.has('x'));
});

test('Verbindung: Der Host stellt seinen Wecker genau auf das nächste Ereignis', async () => {
  const l = link();
  const wakes = [];
  l.room.wake = t => wakes.push(t);
  await join(l);
  l.room.start();
  const start = l.room.state.round.startAt;
  assert.equal(wakes.at(-1), start, 'Rundenstart');
  await l.advance(start - l.now() + 50);
  assert.equal(wakes.at(-1), start + D.DUEL_STEP_MS, 'nächste Hinweis-Stufe');
  l.room.lost(l.now());
  l.room.tick();
  assert.equal(wakes.at(-1), Math.min(start + D.DUEL_STEP_MS, l.now() + D.DUEL_GRACE_MS), 'Gnadenfrist zählt mit');
});

test('Verbindung: Ist Wikipedia nicht erreichbar, bleibt es bei wenigen Versuchen und die Runde läuft ohne Bild', async () => {
  const asked = [];
  const l = link({ settings: { kind: 'bestof', bestOf: 3, mode: 'scene' }, media: async job => { asked.push(job.key); return null; } });
  await join(l);
  l.room.start();
  await l.advance(5000);
  assert.ok(asked.length <= 6, `nur wenige Bildanfragen (${asked.length})`);
  assert.ok(['emoji', 'quote', 'classic'].includes(l.room.state.round.mode), `Runde ohne Bild (${l.room.state.round.mode})`);
  await l.advance(3000);
  assert.equal(l.client.current().phase, 'play', 'das Duell geht weiter');
});

test('Verbindung: Revanche und Verlassen', async () => {
  const l = link();
  await join(l);
  l.room.start();
  await l.advance(4000);
  l.room.rematch();
  await l.advance(200);
  assert.ok(l.toGuest.some(m => m.t === 'rematch'));
  assert.equal(l.client.current().phase, 'countdown');
  await l.advance(3000);
  l.room.leave('host');
  await l.advance(200);
  assert.equal(l.client.current().phase, 'over');
  assert.equal(l.client.current().over.winner, 'gast', 'wer geht, verliert');
  assert.equal(l.toGuest.at(-1).t, 'leave');
});
