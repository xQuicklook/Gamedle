/* ───────── Gamedar-Duell: eigene Historie (nur in diesem Browser) ─────────
   Ein Eintrag je beendetem Duell; daraus die Bilanz gegen jeden Gegner, Punkte im Monat und eine kleine
   Bestenliste der Punkte-Duelle (du und alle, gegen die du gespielt hast). Eine gemeinsame Rangliste für alle
   gibt es erst mit einem Server – die Einträge sind so gebaut, dass sie sich dann übertragen lassen. */
const DUEL_HISTORY_MAX = 200;

/* Eintrag aus der letzten Ansicht eines beendeten Duells (me/opp: { id, name, color }) */
function duelRecord(view, me, opp, at) {
  const o = view.over;
  return {
    at, kind: view.kind, bestOf: view.bestOf, mode: view.mode,
    opp: { id: opp.id, name: opp.name, color: opp.color },
    score: [o.score[me.id] ?? 0, o.score[opp.id] ?? 0],
    result: !o.winner ? 'draw' : o.winner === me.id ? 'win' : 'loss',
    reason: o.reason,
    rounds: view.rounds.map(r => ({ mode: r.mode, gameId: r.gameId, won: r.winner ? r.winner === me.id : null, ms: r.ms, points: r.points })),
  };
}

/* Neuester Eintrag zuerst, höchstens DUEL_HISTORY_MAX */
const duelAddRecord = (history, entry) => [entry, ...history].slice(0, DUEL_HISTORY_MAX);

/* Monat (JJJJ-MM) nach deutscher Zeit – wie das Tagesrätsel */
const duelMonth = at => gdToday(new Date(at)).slice(0, 7);

/* Kennzahlen aus der Historie (neuester Eintrag zuerst); me: aktueller Spieler für die Bestenliste */
function duelStats(history, me, now = Date.now()) {
  const month = duelMonth(now);
  const s = { duels: history.length, wins: 0, losses: 0, draws: 0, monthPoints: 0, bestPoints: 0, opponents: [], best: [] };
  const opps = new Map();
  const best = new Map();
  // Name und Farbe vom neuesten Eintrag, Punkte vom besten
  const top = (p, points, at) => {
    const b = best.get(p.id);
    if (!b) best.set(p.id, { id: p.id, name: p.name, color: p.color, points, at });
    else if (points > b.points) Object.assign(b, { points, at });
  };
  for (const e of history) {
    const key = e.result === 'win' ? 'wins' : e.result === 'loss' ? 'losses' : 'draws';
    s[key]++;
    if (!opps.has(e.opp.id)) opps.set(e.opp.id, { ...e.opp, wins: 0, losses: 0, draws: 0, last: e.at });
    opps.get(e.opp.id)[key]++;
    if (e.kind === 'points') {
      if (duelMonth(e.at) === month) s.monthPoints += e.score[0];
      s.bestPoints = Math.max(s.bestPoints, e.score[0]);
      top(me, e.score[0], e.at);
      top(e.opp, e.score[1], e.at);
    }
  }
  s.opponents = [...opps.values()].sort((a, b) => b.last - a.last);
  s.best = [...best.values()].sort((a, b) => b.points - a.points || a.at - b.at).slice(0, 10);
  return s;
}
