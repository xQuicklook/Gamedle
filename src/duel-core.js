/* ───────── Gamedar-Duell: Schiedsrichter (ohne Oberfläche und Netz, testbar) ─────────
   Zwei Spieler raten dasselbe Spiel gleichzeitig; wer zuerst trifft, gewinnt die Runde.
   - Punkte-Duell: 5 Runden, jeder Modus genau einmal; ein Treffer bringt 1.000 Punkte, nach 90 s nur noch 100.
   - Best-of (BO3/5/7): Wer zuerst die Mehrheit der Runden gewinnt. Gemischt oder ein fester Modus.
   Der Zustand ist ein schlichtes JSON-Objekt; Zeit (now) und Zufall (seed) kommen von außen. So läuft der
   Schiedsrichter heute im Browser des Erstellers und später unverändert auf einem Server. Die Lösung verlässt
   ihn erst am Rundenende – duelView gibt jedem Spieler nur, was er gerade sehen darf. */

const DUEL_ROUND_MS = 90000;     // Zeit je Runde
const DUEL_STEP_MS = 12000;      // alle 12 s die nächste Hinweis-Stufe
const DUEL_LOCK_MS = 2000;       // Sperre nach einem falschen Tipp
const DUEL_COUNTDOWN_MS = 3000;  // „3 – 2 – 1“ vor jeder Runde
const DUEL_BREAK_MS = 5000;      // Auflösung zwischen den Runden
const DUEL_POINTS = [1000, 100]; // Treffer sofort bzw. in der letzten Sekunde
const DUEL_POINT_ROUNDS = 5;
const DUEL_BEST_OF = [3, 5, 7];
const DUEL_SKIP_DAYS = 7;        // Tagesrätsel von heute und den nächsten 7 Tagen kommen im Duell nicht dran
const DUEL_ALL = 99;             // Hinweis-Stufe „alles aufgedeckt“ (nach Rundenende)
const DUEL_MAX_TRIES = 3;        // so oft wird ein Spiel ersetzt, dessen Bild nicht lädt – danach ohne Bild
const DUEL_TEXT_MODES = ['emoji', 'quote', 'classic']; // Modi ohne Bild

/* Tipps je Modus: [Art, ab Hinweis-Stufe] – anders als im Tagesrätsel nach Zeit, nicht nach Fehlversuchen.
   Emojis, Cover und Szene werden zusätzlich mit jeder Stufe deutlicher (siehe duelClue). */
const DUEL_HINTS = {
  classic: [['letter', 4], ['cover', 6]],
  quote: [['year', 2], ['speaker', 4], ['letter', 6]],
  emoji: [['year', 5], ['letter', 6]],
  cover: [],
  scene: [['year', 6]],
};

function duelPoints(ms) {
  const [max, min] = DUEL_POINTS;
  return Math.round(max - (max - min) * Math.min(1, Math.max(0, ms / DUEL_ROUND_MS)));
}

/* Lösungen der Tagesrätsel (alle Modi) von today bis today + DUEL_SKIP_DAYS */
function duelExcluded(today) {
  const ids = new Set();
  for (let d = 0; d <= DUEL_SKIP_DAYS; d++) for (const m of GD_DAILY_MODES) ids.add(gdDaily(m, gdShiftDate(today, d)).id);
  return [...ids];
}

function duelShuffle(list, seed) {
  const out = [...list];
  const rnd = gdRng(gdHash(seed));
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/* Neues Duell. kind: 'points' | 'bestof'; mode: 'mixed' oder ein Modus (das Punkte-Duell ist immer gemischt).
   players: die beiden Spieler-IDs (Ersteller zuerst); today: Datum für den Ausschluss der Tagesrätsel */
function duelCreate({ kind = 'points', bestOf = 3, mode = 'mixed', players, seed, today }) {
  const points = kind === 'points';
  if (players?.length !== 2 || players[0] === players[1]) throw new Error('Ein Duell braucht zwei verschiedene Spieler.');
  return {
    v: 1,
    kind: points ? 'points' : 'bestof',
    bestOf: points ? null : DUEL_BEST_OF.includes(bestOf) ? bestOf : 3,
    mode: !points && GD_DAILY_MODES.includes(mode) ? mode : 'mixed',
    players: [...players],
    seed: String(seed),
    excluded: duelExcluded(today),
    skipped: [],   // Spiele, deren Bild nicht geladen werden konnte
    rounds: [],    // abgeschlossene Runden: { n, mode, gameId, winner, ms, points }
    round: null,   // aktuelle Runde
    over: null,    // Ergebnis, sobald entschieden
  };
}

/* Modus und Spiel für Runde n – zufällig, aber durch seed festgelegt; nie ein Tagesrätsel, nie doppelt.
   force: Modus vorgeben (Ersatz ohne Bild). Ist ein Pool erschöpft, geht es mit Klassik weiter statt abzubrechen. */
function duelPick(s, n, force = null) {
  let mode = force || (s.mode !== 'mixed' ? s.mode : duelShuffle(GD_DAILY_MODES, `${s.seed}:modes`)[(n - 1) % GD_DAILY_MODES.length]);
  const used = new Set([...s.excluded, ...s.skipped, ...s.rounds.map(r => r.gameId)]);
  let pool = gdPool(mode).filter(g => !used.has(g.id));
  if (!pool.length) { mode = 'classic'; pool = gdPool('classic').filter(g => !used.has(g.id)); }
  if (!pool.length) pool = gdPool('classic');
  const rnd = gdRng(gdHash(`${s.seed}:${n}:${s.skipped.length}`));
  return { mode, gameId: pool[Math.floor(rnd() * pool.length)].id };
}

function duelStartRound(s, now, { mode = null, tries = 0 } = {}) {
  const n = s.rounds.length + 1;
  s.round = {
    n, ...duelPick(s, n, mode), tries, startAt: now + DUEL_COUNTDOWN_MS, endedAt: null,
    guesses: Object.fromEntries(s.players.map(p => [p, []])), lockUntil: {},
  };
  return s;
}

/* Erste Runde starten (sobald beide da sind) */
function duelStart(s, now) {
  return s.round || s.over ? s : duelStartRound(s, now);
}

/* Das Spiel der Runde taugt nicht (z. B. Bild lädt nicht) → anderes Spiel, Countdown von vorn.
   Nach DUEL_MAX_TRIES Fehlschlägen (Wikipedia nicht erreichbar?) läuft die Runde ohne Bild:
   als Emoji, Zitat oder Klassik – bevorzugt ein Modus, der im Duell noch nicht dran war. */
function duelSkipGame(s, now) {
  const r = s.round;
  if (!r || r.endedAt || s.over) return s;
  s.skipped.push(r.gameId);
  const tries = (r.tries || 0) + 1;
  if (tries < DUEL_MAX_TRIES) return duelStartRound(s, now, { mode: r.mode, tries });
  const played = new Set(s.rounds.map(x => x.mode));
  const text = DUEL_TEXT_MODES.find(m => !played.has(m)) || DUEL_TEXT_MODES[0];
  return duelStartRound(s, now, { mode: text, tries });
}

function duelScore(s) {
  const score = Object.fromEntries(s.players.map(p => [p, 0]));
  for (const r of s.rounds) if (r.winner) score[r.winner] += s.kind === 'points' ? r.points : 1;
  return score;
}

/* Ergebnis, sobald das Duell entschieden ist: { winner (null = unentschieden), score, reason } – sonst null */
function duelOutcome(s) {
  const score = duelScore(s);
  const [a, b] = s.players;
  const lead = score[a] === score[b] ? null : score[a] > score[b] ? a : b;
  if (s.kind === 'points') {
    if (s.rounds.length < DUEL_POINT_ROUNDS) return null;
    if (lead) return { winner: lead, score, reason: 'points' };
    // Gleich viele Punkte: wer insgesamt schneller getroffen hat
    const time = p => s.rounds.filter(r => r.winner === p).reduce((t, r) => t + r.ms, 0);
    const faster = time(a) === time(b) ? null : time(a) < time(b) ? a : b;
    return { winner: faster, score, reason: faster ? 'time' : 'draw' };
  }
  const target = Math.ceil(s.bestOf / 2);
  const winner = s.players.find(p => score[p] >= target);
  if (winner) return { winner, score, reason: 'majority' };
  if (s.rounds.length >= 2 * s.bestOf) return { winner: lead, score, reason: lead ? 'limit' : 'draw' };
  return null;
}

function duelEndRound(s, at, winner) {
  const r = s.round;
  r.endedAt = at;
  const ms = winner ? at - r.startAt : null;
  s.rounds.push({ n: r.n, mode: r.mode, gameId: r.gameId, winner, ms, points: winner && s.kind === 'points' ? duelPoints(ms) : 0 });
  s.over = duelOutcome(s);
}

/* Nächster Zeitpunkt, an dem sich die Ansicht von selbst ändert (Rundenstart, neue Hinweis-Stufe, Rundenende,
   nächste Runde) – der Host stellt seinen Wecker genau darauf, statt ständig nachzusehen. null = nichts geplant */
function duelNextEvent(s, now) {
  const r = s.round;
  if (!r || s.over) return null;
  if (r.endedAt) return r.endedAt + DUEL_BREAK_MS;
  if (now < r.startAt) return r.startAt;
  const next = r.startAt + (Math.floor((now - r.startAt) / DUEL_STEP_MS) + 1) * DUEL_STEP_MS;
  return Math.min(next, r.startAt + DUEL_ROUND_MS);
}

/* Zeit fortschreiben: Die Runde läuft ab, nach der Auflösung beginnt die nächste */
function duelTick(s, now) {
  const r = s.round;
  if (!r || s.over) return s;
  if (!r.endedAt && now >= r.startAt + DUEL_ROUND_MS) duelEndRound(s, r.startAt + DUEL_ROUND_MS, null);
  else if (r.endedAt && now >= r.endedAt + DUEL_BREAK_MS) duelStartRound(s, now);
  return s;
}

/* Tipp eines Spielers für Runde n; at = Eingangszeit beim Schiedsrichter (beim Gast um die halbe
   Laufzeit der Verbindung bereinigt). Antwort: { ok: true, correct } oder { ok: false, why } */
function duelGuess(s, pid, n, gameId, at) {
  duelTick(s, at);
  const r = s.round;
  if (!r || !s.players.includes(pid) || !GD_BY_ID.has(gameId)) return { ok: false, why: 'invalid' };
  if (s.over || r.endedAt || r.n !== n) return { ok: false, why: 'over' };
  if (at < r.startAt) return { ok: false, why: 'early' };
  if (at < (r.lockUntil[pid] || 0)) return { ok: false, why: 'locked' };
  if (r.guesses[pid].includes(gameId)) return { ok: false, why: 'dup' };
  r.guesses[pid].push(gameId);
  if (gameId === r.gameId) { duelEndRound(s, at, pid); return { ok: true, correct: true }; }
  r.lockUntil[pid] = at + DUEL_LOCK_MS;
  return { ok: true, correct: false };
}

/* Spieler gibt auf (oder kommt nicht zurück): Der andere gewinnt, die laufende Runde zählt nicht */
function duelForfeit(s, pid, now) {
  if (s.over || !s.players.includes(pid)) return s;
  if (s.round && !s.round.endedAt) s.round.endedAt = now;
  s.over = { winner: s.players.find(p => p !== pid), score: duelScore(s), reason: 'forfeit' };
  return s;
}

/* Hinweis zur Stufe step (0 = Rundenbeginn). Bilder nur als Beschreibung (Art, Stufe, Ausschnitt) –
   das Bild selbst bereitet der Ersteller vor, damit nie die Adresse (und damit oft der Name) weitergeht. */
function duelClue(mode, answer, step) {
  const clue = { step, hints: [] };
  if (mode === 'quote') clue.quote = GD_QUOTES[answer.id][0];
  if (mode === 'emoji') {
    const list = GD_EMOJI_HINTS[answer.id].split(' ');
    clue.emoji = { shown: list.slice(0, 1 + step), total: list.length };
  }
  if (mode === 'cover') clue.image = { kind: 'cover', step };
  if (mode === 'scene') {
    const [, fx = 50, fy = 50] = GD_SCENES[answer.id];
    clue.image = { kind: 'scene', step, focus: [fx, fy] };
  }
  for (const [kind, from] of DUEL_HINTS[mode]) {
    if (step < from) continue;
    // Ohne Cover (Minecraft, Undertale …) gibt es wie im Tagesrätsel das Jahr
    const k = kind === 'cover' && GD_NO_COVER.has(answer.title) ? 'year' : kind;
    clue.hints.push({ kind: k, value: gdHintValue(k, answer) });
  }
  return clue;
}

/* Die Ansicht ms später – so läuft die Uhr zwischen zwei Nachrichten des Schiedsrichters weiter.
   Neue Hinweis-Stufen und Phasen kommen nicht hierüber, sondern mit der nächsten Ansicht. */
function duelAge(view, ms) {
  if (!view?.phase || view.phase === 'lobby' || ms <= 0) return view;
  const v = { ...view, startsIn: Math.max(0, view.startsIn - ms) };
  if (view.phase === 'play') {
    v.timeLeft = Math.max(0, view.timeLeft - ms);
    if (view.worth != null) v.worth = duelPoints(DUEL_ROUND_MS - v.timeLeft);
  }
  if (view.nextIn != null) v.nextIn = Math.max(0, view.nextIn - ms);
  if (view.me) v.me = { ...view.me, lockedFor: Math.max(0, view.me.lockedFor - ms) };
  return v;
}

/* Was Spieler pid jetzt sehen darf. Die Lösung (answer) gibt es erst nach Rundenende. */
function duelView(s, pid, now) {
  const r = s.round;
  const opp = s.players.find(p => p !== pid);
  const view = {
    kind: s.kind, bestOf: s.bestOf, mode: s.mode,
    total: s.kind === 'points' ? DUEL_POINT_ROUNDS : s.bestOf,
    score: duelScore(s), over: s.over,
  };
  if (!r) return { ...view, phase: 'lobby' };
  const answer = GD_BY_ID.get(r.gameId);
  const phase = s.over ? 'over' : r.endedAt ? 'break' : now < r.startAt ? 'countdown' : 'play';
  const elapsed = Math.min(Math.max(0, (r.endedAt ?? now) - r.startAt), DUEL_ROUND_MS);
  const ended = phase === 'break' || phase === 'over';
  Object.assign(view, {
    phase, n: r.n, roundMode: r.mode,
    attempt: s.skipped.length, // ändert sich, wenn ein Spiel ersetzt wurde (Bild lud nicht) – Countdown von vorn
    startsIn: Math.max(0, r.startAt - now),
    timeLeft: DUEL_ROUND_MS - elapsed,
    worth: s.kind === 'points' && phase === 'play' ? duelPoints(elapsed) : null,
    nextIn: phase === 'break' ? Math.max(0, r.endedAt + DUEL_BREAK_MS - now) : null,
    clue: phase === 'countdown' ? null : duelClue(r.mode, answer, ended ? DUEL_ALL : Math.floor(elapsed / DUEL_STEP_MS)),
    me: {
      guesses: [...r.guesses[pid]],
      lockedFor: ended ? 0 : Math.max(0, (r.lockUntil[pid] || 0) - now),
      // Klassik: Rückmeldung je eigenem Tipp (wie die Tabelle im Tagesrätsel)
      rows: r.mode === 'classic' ? r.guesses[pid].map(id => ({ id, cells: gdCompare(GD_BY_ID.get(id), answer) })) : null,
    },
    opp: { attempts: r.guesses[opp].length },
    rounds: s.rounds.map(x => ({ ...x })), // nur abgeschlossene Runden – deren Lösung ist kein Geheimnis mehr
  });
  if (ended) {
    view.answer = r.gameId;
    view.last = s.rounds.find(x => x.n === r.n) || null;
  }
  return view;
}
