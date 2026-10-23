/* ───────── Automatische Raum-Übernahme ─────────
   Ist der Host länger weg, übernimmt der dienstälteste Gast (frühestes „joinedAt“).
   Fehlt der auch, kommt nach jeweils 8 s der Nächste dran. Die übrigen Gäste versuchen
   ohnehin ständig, sich mit dem Raum-Code zu verbinden – und landen so beim neuen Host. */
const MIGRATION_DELAY = 12000; // Host-Neuladen dauert meist nur 2–4 s
const MIGRATION_STEP = 8000;

const Migration = {
  timer: null, tick: null, deadline: 0, successor: null,

  candidates() {
    const s = App.state;
    return Object.values(s.players)
      .filter(p => p.online && p.id !== s.hostId)
      .sort((a, b) => (a.joinedAt || 9e15) - (b.joinedAt || 9e15) || a.id.localeCompare(b.id));
  },

  check() {
    if (Net.role !== 'guest' || !Net.everConnected || !App.state || Net.status === 'online') { this.cancel(); return; }
    if (this.timer) return;
    const list = this.candidates();
    const idx = list.findIndex(p => p.id === App.me.id);
    if (!list.length) return;
    this.successor = list[0];
    this.deadline = Date.now() + MIGRATION_DELAY;
    if (idx >= 0) {
      const wait = MIGRATION_DELAY + idx * MIGRATION_STEP;
      this.timer = setTimeout(() => {
        this.timer = null;
        if (Net.role === 'guest' && Net.status !== 'online') App.takeOver(true);
      }, wait);
    } else this.timer = -1; // nicht auf der Liste (z. B. offline markiert) – nur anzeigen
    this.tick = setInterval(() => {
      // Ist der Vorgänger nicht eingesprungen, rückt der Nächste in der Anzeige nach
      if (Date.now() > this.deadline) {
        const pos = list.indexOf(this.successor);
        if (list[pos + 1]) { this.successor = list[pos + 1]; this.deadline += MIGRATION_STEP; }
      }
      App.renderHint();
    }, 1000);
  },

  cancel() {
    if (this.timer > 0) clearTimeout(this.timer);
    clearInterval(this.tick);
    this.timer = null;
    this.tick = null;
    this.successor = null;
  },

  secondsLeft() { return Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000)); },
};
