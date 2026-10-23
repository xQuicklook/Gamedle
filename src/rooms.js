/* ───────── Gespeicherte Räume & Speicherplatz ─────────
   Host-Räume liegen unter "room.<CODE>" (Solo: "room.SOLO"), Gast-Kopien unter "cache.<CODE>".
   Ein kleiner Index merkt sich, wann ein Eintrag zuletzt benutzt wurde. */
const CACHE_MAX_AGE = 30 * 24 * 3600 * 1000; // Gast-Kopien nach 30 Tagen ohne Nutzung löschen
const STORAGE_BUDGET = 5 * 1024 * 1024;      // typisches localStorage-Limit (Richtwert)

const Rooms = {
  index() { return Store.get('index', {}); },

  touch(key) {
    const idx = this.index();
    idx[key] = Date.now();
    Store.set('index', idx);
  },

  forget(key) {
    Store.del(key);
    const idx = this.index();
    delete idx[key];
    Store.set('index', idx);
    // „Zuletzt“ nur vergessen, wenn genau dieser Eintrag gemeint war (Host → room., Gast → cache.)
    const last = Store.get('last');
    if (last && (last.role === 'guest' ? 'cache.' : 'room.') + last.code === key) Store.del('last');
  },

  /* Speichert einen Raum; ist der Speicher voll, werden zuerst alte Gast-Kopien geopfert */
  save(key, state) {
    if (Store.set(key, state)) { this.touch(key); return true; }
    const idx = this.index();
    const caches = Store.keys('cache.').filter(k => k !== key).sort((a, b) => (idx[a] || 0) - (idx[b] || 0));
    for (const k of caches) {
      this.forget(k);
      if (Store.set(key, state)) { this.touch(key); return true; }
    }
    return false;
  },

  cleanup() {
    const idx = this.index();
    const now = Date.now();
    for (const k of Store.keys('cache.')) {
      if (!idx[k]) { idx[k] = now; continue; } // unbekannt → ab jetzt zählen
      if (now - idx[k] > CACHE_MAX_AGE) { Store.del(k); delete idx[k]; }
    }
    for (const k of Object.keys(idx)) if (!Store.keys(k).includes(k)) delete idx[k];
    Store.set('index', idx);
  },

  list() {
    const idx = this.index();
    return [...Store.keys('room.'), ...Store.keys('cache.')].map(key => {
      const [kind, code] = key.split('.');
      const s = Store.get(key) || {};
      return {
        key, code, solo: code === 'SOLO', guest: kind === 'cache',
        at: idx[key] || 0, bytes: Store.bytes(key),
        games: (s.order || []).length, players: Object.keys(s.players || {}).length,
      };
    }).sort((a, b) => b.at - a.at);
  },

  usedBytes() { return Store.keys('').reduce((n, k) => n + Store.bytes(k), 0); },
};

const fmtBytes = b => (b >= 1024 * 1024 ? (b / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
const fmtDate = t => (t ? new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'unbekannt');
const currentRoomKey = () => (App.state ? (Net.role === 'guest' ? 'cache.' + Net.code : 'room.' + (Net.code || 'SOLO')) : null);

/* Übersicht: öffnen, sichern, löschen */
function roomsModal() {
  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
  const inApp = !$('#app').hidden;

  const draw = () => {
    const rooms = Rooms.list();
    const used = Rooms.usedBytes();
    const pct = Math.min(100, Math.round((used / STORAGE_BUDGET) * 100));
    body.replaceChildren(
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px' } },
          h('span.muted', 'Speicher in diesem Browser'), h('strong', `${fmtBytes(used)} von ca. ${fmtBytes(STORAGE_BUDGET)}`)),
        h('div.progress' + (pct > 85 ? '.warn' : ''), h('i', { style: { width: pct + '%' } }))),
      rooms.length ? h('div.lib-list', rooms.map(r => {
        const isCurrent = r.key === currentRoomKey();
        const label = r.solo ? 'Solo-Liste' : `Raum ${r.code}`;
        const tag = r.solo ? '' : r.guest ? 'Gast-Kopie' : 'Host';
        return h('div.room-row',
          h('div.lib-meta',
            h('strong', label, tag ? h('span.pill', { style: { marginLeft: '8px' } }, tag) : null, isCurrent ? h('span.pill.ok', { style: { marginLeft: '6px' } }, 'geöffnet') : null),
            h('span', `${r.games} Spiele · ${r.players} Spieler · zuletzt ${fmtDate(r.at)} · ${fmtBytes(r.bytes)}`)),
          h('div', { style: { display: 'flex', gap: '2px' } },
            !inApp ? h('button.btn.sm', { onclick: () => { m.close(); openSavedRoom(r); } }, 'Öffnen') : null,
            h('button.icon-btn.sm', { title: 'Als Datei sichern', 'aria-label': 'Als Datei sichern', onclick: () => exportJson(Store.get(r.key), r.code) }, icon('download')),
            h('button.icon-btn.sm', {
              title: isCurrent ? 'Der geöffnete Raum kann nicht gelöscht werden' : 'Löschen', 'aria-label': 'Löschen', disabled: isCurrent,
              onclick: () => confirmDialog(`${label} löschen?`,
                r.guest ? 'Das ist nur deine lokale Kopie – der Raum beim Host bleibt erhalten.' : 'Spiele, Stufen und alle Rankings dieses Raums werden aus diesem Browser gelöscht. Tipp: vorher als Datei sichern.',
                'Löschen', true).then(ok => { if (ok) { Rooms.forget(r.key); draw(); App.drawResume?.(); } }),
            }, icon('trash'))));
      })) : h('p.help', 'Noch keine gespeicherten Räume.'),
      h('p.help', 'Host-Räume bleiben, bis du sie löschst. Gast-Kopien werden nach 30 Tagen ohne Nutzung automatisch entfernt. Wird der Speicher knapp, räumt Tierly zuerst alte Gast-Kopien weg.'),
    );
  };
  draw();
  const m = openModal({ title: 'Gespeicherte Räume', body, width: 560, autofocus: false });
}

function openSavedRoom(r) {
  if (!App.requireName()) return;
  if (r.solo) App.startSolo();
  else if (r.guest) App.startGuest(r.code);
  else App.startHost(r.code, false);
}

/* Warnung, wenn nicht mehr gespeichert werden kann (höchstens einmal pro Minute) */
let storageWarnedAt = 0;
function warnStorageFull() {
  App.storageFull = true;
  App.renderHint();
  if (Date.now() - storageWarnedAt < 60000) return;
  storageWarnedAt = Date.now();
  toast('Speicher voll – Änderungen werden nicht mehr gesichert!', 6000);
}
