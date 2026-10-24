/* ───────── Rückgängig / Wiederholen ─────────
   Vor jeder eigenen Aktion wird festgehalten, welche Aktion(en) sie wieder aufheben.
   Rückgängig führt diese Gegen-Aktionen ganz normal aus – sie laufen also auch über
   den Host und kommen bei allen an. */
const UNDO_LABELS = {
  'place': 'Platzierung', 'ranking/reset': 'Liste zurücksetzen', 'ranking/set': 'Liste', 'ranking/merge': 'Franchise-Vorschlag',
  'items/add': 'Hinzufügen', 'items/update': 'Bearbeiten', 'items/remove': 'Entfernen', 'tiers/set': 'Stufen',
};

const Undo = {
  undoStack: [],
  redoStack: [],

  clear() { this.undoStack = []; this.redoStack = []; },

  /* Gegen-Aktionen für eine Aktion, berechnet aus dem aktuellen (Vorher-)Zustand */
  inverse(a) {
    const s = App.state, me = App.me.id;
    const myRows = board => structuredClone(s.rankings[me]?.[board] || {});
    const assetOf = img => (img?.startsWith('asset:') && s.assets?.[img.slice(6)] ? { [img.slice(6)]: s.assets[img.slice(6)] } : {});
    switch (a.type) {
      case 'place': case 'ranking/reset': case 'ranking/set': case 'ranking/merge':
        return [{ type: 'ranking/set', board: a.board, rows: myRows(a.board) }];
      case 'items/add':
        return [{ type: 'items/remove', ids: (a.items || []).map(it => it.id).filter(Boolean) }];
      case 'items/update': {
        const cur = s.items[a.id];
        if (!cur) return null;
        const assets = assetOf(cur.img);
        const id = Object.keys(assets)[0];
        return [{ type: 'items/update', id: a.id, patch: { ...cur }, asset: id ? { id, data: assets[id] } : undefined }];
      }
      case 'items/remove': {
        const items = (a.ids || []).map(id => s.items[id]).filter(Boolean);
        if (!items.length) return null;
        // Spiele zurückholen – und die eigenen Platzierungen gleich mit
        return [
          { type: 'items/add', items: structuredClone(items), assets: Object.assign({}, ...items.map(it => assetOf(it.img))) },
          { type: 'ranking/set', board: 'games', rows: myRows('games') },
        ];
      }
      case 'tiers/set':
        return [
          { type: 'tiers/set', tiers: structuredClone(s.tiers) },
          { type: 'ranking/set', board: 'games', rows: myRows('games') },
          { type: 'ranking/set', board: 'franchises', rows: myRows('franchises') },
        ];
    }
    return null;
  },

  capture(a) {
    if (this.replaying || !UNDO_LABELS[a?.type]) return null;
    const actions = this.inverse(a);
    return actions ? { label: UNDO_LABELS[a.multi ? 'place' : a.type], actions } : null;
  },

  push(entry) {
    if (!entry) return;
    this.undoStack.push(entry);
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
  },

  /* Führt die Aktionen eines Eintrags aus und liefert den Eintrag für die Gegenrichtung */
  replay(entry) {
    this.replaying = true;
    const back = [];
    try {
      for (const a of entry.actions) {
        const inv = this.inverse(normalizeAction(a));
        if (App.dispatch(a) && inv) back.unshift(...inv);
      }
    } finally { this.replaying = false; }
    return { label: entry.label, actions: back };
  },

  undoLast() {
    const e = this.undoStack.pop();
    if (!e) { toast('Nichts zum Rückgängigmachen'); return; }
    this.redoStack.push(this.replay(e));
    toast(`Rückgängig: ${e.label}`, 2600, { label: 'Wiederholen', onClick: () => this.redoLast() });
  },

  redoLast() {
    const e = this.redoStack.pop();
    if (!e) { toast('Nichts zum Wiederholen'); return; }
    this.undoStack.push(this.replay(e));
    toast(`Wiederholt: ${e.label}`);
  },
};
