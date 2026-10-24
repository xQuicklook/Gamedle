// Pflegt den festen Rätsel-Spielplan (src/gamedle-schedule.js).
// Ausführen nach dem Hinzufügen neuer Spiele oder Inhalte: node tools/gamedle-schedule.js
//
// Regeln: Bestehende Einträge werden NIE umsortiert – neue Spiele kommen gemischt ans Ende.
// So bleiben vergangene und kommende Rätsel stabil, egal wie der Spiele-Pool wächst.
// Spiele dürfen nicht gelöscht werden (nur korrigiert), sonst bricht der Plan.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const src = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const file = path.join(root, 'src', 'gamedle-schedule.js');
const ctx = { Intl, Date, Map, Set };
const { GD, GD_DAILY_MODES, gdPool, gdRng, gdHash, gdDayNumber, gdToday } = vm.runInNewContext(
  `${src('gamedle-data.js')}\n${src('gamedle-content.js')}\nconst GD_SCHEDULE = null;\n${src('gamedle-core.js')}\n;({ GD, GD_DAILY_MODES, gdPool, gdRng, gdHash, gdDayNumber, gdToday })`, ctx);

const existing = fs.existsSync(file)
  ? vm.runInNewContext(`${fs.readFileSync(file, 'utf8')}\n;GD_SCHEDULE`)
  : {};

const shuffle = (ids, seed) => {
  const out = [...ids].sort();
  const rnd = gdRng(gdHash(seed));
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
};

const known = new Set(GD.map(g => g.id));
const day = gdDayNumber(gdToday());
const result = {};
for (const mode of GD_DAILY_MODES) {
  const pool = gdPool(mode).map(g => g.id);
  const plan = existing[mode] || [];
  const missing = plan.filter(id => !known.has(id) || !pool.includes(id));
  if (missing.length) throw new Error(`${mode}: Spiele fehlen in den Daten oder Inhalten (nie löschen!): ${missing.join(', ')}`);
  const fresh = pool.filter(id => !plan.includes(id));
  // Erstanlage: dieselbe Mischung wie die bisherige Berechnung → laufende Rätsel bleiben gleich
  const add = shuffle(fresh, plan.length ? `gamedle:${mode}:${plan.length}` : `gamedle:${mode}`);
  result[mode] = [...plan, ...add];
  if (add.length) {
    const pos = (day - 1) % Math.max(1, plan.length);
    console.log(`${mode}: ${add.length} neue Spiele angehängt (ab Tag ${plan.length + 1}).` +
      (plan.length && day > plan.length ? ` Achtung: Der erste Durchlauf ist schon vorbei (heute Tag ${day}, Position ${pos + 1}) – spätere Tage verschieben sich.` : ''));
  } else console.log(`${mode}: keine neuen Spiele.`);
}

const lines = ids => ids.map((id, i) => `    '${id}', // ${i + 1}`).join('\n');
fs.writeFileSync(file, `/* ───────── Gamedle: fester Rätsel-Spielplan ─────────
   Tag n (Gamedle #n) bekommt je Modus den n-ten Eintrag; danach beginnt der Plan von vorn.
   NICHT von Hand umsortieren – neue Spiele hängt tools/gamedle-schedule.js ans Ende. */
const GD_SCHEDULE = {
${GD_DAILY_MODES.map(mode => `  ${mode}: [\n${lines(result[mode])}\n  ],`).join('\n')}
};
`);
console.log(`Gespeichert: ${path.relative(root, file)} (${GD_DAILY_MODES.map(m => `${result[m].length} ${m}`).join(', ')})`);
