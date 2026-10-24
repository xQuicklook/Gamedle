/* ───────── Drag & Drop (Maus + Touch via Pointer Events) ─────────
   Maus: ziehen ab 5 px Bewegung. Touch: kurz gedrückt halten (Long-Press), dann ziehen –
   so bleibt normales Scrollen möglich. Ein einfacher Tap wählt eine Kachel aus (Tap-to-place). */
const Drag = {
  start: null,     // Pointer gedrückt, Drag noch nicht begonnen
  active: null,    // laufender Drag
  lastDrop: 0,
  scrollRaf: 0,
};

function initDrag() {
  document.addEventListener('pointerdown', dragDown);
  document.addEventListener('pointermove', dragMove, { passive: false });
  document.addEventListener('pointerup', dragUp);
  document.addEventListener('pointercancel', dragCancel);
  // Während eines Touch-Drags darf die Seite nicht scrollen
  document.addEventListener('touchmove', e => { if (Drag.active) e.preventDefault(); }, { passive: false });
  document.addEventListener('contextmenu', e => { if (e.target.closest('.tile:not(.readonly)') && Drag.start) e.preventDefault(); });
}

function dragDown(e) {
  if (e.button !== 0 || Drag.active) return;
  const tile = e.target.closest('.tile');
  if (!tile || tile.classList.contains('readonly') || !tile.closest('#board, #poolBody') || App.view !== 'me') return;
  const touch = e.pointerType !== 'mouse';
  const additive = e.ctrlKey || e.metaKey || e.shiftKey; // Strg/Umschalt-Klick: zur Auswahl hinzufügen
  const s = Drag.start = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, id: tile.dataset.id, tile, pid: e.pointerId, touch, additive, timer: 0 };
  if (touch) s.timer = setTimeout(() => { if (Drag.start === s) dragBegin(s.lx, s.ly); }, 240);
  else e.preventDefault(); // keine Textauswahl
}

function dragMove(e) {
  if (Drag.active) {
    if (e.pointerId !== Drag.active.pid) return;
    e.preventDefault();
    dragTo(e.clientX, e.clientY);
    return;
  }
  const s = Drag.start;
  if (!s || e.pointerId !== s.pid) return;
  s.lx = e.clientX; s.ly = e.clientY;
  const dist = Math.hypot(e.clientX - s.x, e.clientY - s.y);
  if (s.touch) { if (dist > 10) dragReset(); } // Nutzer scrollt
  else if (dist > 5) dragBegin(e.clientX, e.clientY);
}

function dragUp(e) {
  if (Drag.active) { if (e.pointerId === Drag.active.pid) dragDrop(); return; }
  const s = Drag.start;
  if (!s || e.pointerId !== s.pid) return;
  dragReset();
  tapTile(s.id, s.tile, s.additive);
}

function dragCancel(e) {
  if (Drag.active && e.pointerId === Drag.active.pid) dragFinish(null);
  else dragReset();
}

function dragReset() {
  if (Drag.start) clearTimeout(Drag.start.timer);
  Drag.start = null;
}

function dragBegin(x, y) {
  const s = Drag.start;
  dragReset();
  if (!s || !s.tile.isConnected) return;
  // Gehört die Kachel zu einer Mehrfachauswahl, wandert die ganze Auswahl mit
  const ids = App.sel.length > 1 && App.sel.includes(s.id) ? [...App.sel] : [s.id];
  const r = s.tile.getBoundingClientRect();
  const ghost = s.tile.cloneNode(true);
  ghost.classList.add('ghost');
  ghost.classList.remove('selected');
  if (ids.length > 1) { ghost.classList.add('stack'); ghost.append(h('span.ghost-count', ids.length)); }
  Object.assign(ghost.style, { width: r.width + 'px', height: r.height + 'px', left: r.left + 'px', top: r.top + 'px' });
  document.body.append(ghost);
  for (const id of ids) $$(`#board .tile[data-id="${CSS.escape(id)}"], #poolBody .tile[data-id="${CSS.escape(id)}"]`).forEach(t => t.classList.add('dragging-src'));
  document.body.classList.add('is-dragging');
  if (s.touch && navigator.vibrate) navigator.vibrate(12);
  if (ids.length === 1 && App.sel.length) { App.sel = []; App.updateSelection(false); }

  Drag.active = {
    id: s.id, ids, src: s.tile, pid: s.pid, ghost,
    offX: x - r.left, offY: y - r.top, x, y,
    placeholder: h('div.tile-placeholder'),
    target: null,
  };
  dragTo(x, y);
  Drag.scrollRaf = requestAnimationFrame(autoScroll);
}

function dragTo(x, y) {
  const d = Drag.active;
  d.x = x; d.y = y;
  d.ghost.style.left = x - d.offX + 'px';
  d.ghost.style.top = y - d.offY + 'px';

  const el = document.elementFromPoint(x, y);
  const tier = el?.closest('.tier');
  const pool = el?.closest('#pool');
  $$('.drop-hover').forEach(n => n !== tier && n !== $('#poolBody') && n.classList.remove('drop-hover'));

  if (tier) {
    const box = tier.querySelector('.tier-items');
    const tiles = [...box.children].filter(c => c.classList.contains('tile') && !d.ids.includes(c.dataset.id));
    const before = tiles.find(t => {
      const r = t.getBoundingClientRect();
      return y < r.top || (y <= r.bottom && x < r.left + r.width / 2);
    }) || null;
    if (d.placeholder.parentNode !== box || d.placeholder.nextElementSibling !== before) box.insertBefore(d.placeholder, before);
    tier.classList.add('drop-hover');
    $('#poolBody').classList.remove('drop-hover');
    d.target = { tierId: tier.dataset.tier, index: before ? tiles.indexOf(before) : tiles.length };
  } else if (pool) {
    d.placeholder.remove();
    $('#poolBody').classList.add('drop-hover');
    d.target = { tierId: null };
  } else if (!el?.closest('#board')) {
    // Außerhalb jeder Zone: Drop bricht ab. (Lücken zwischen Reihen behalten das letzte Ziel.)
    d.placeholder.remove();
    $('#poolBody').classList.remove('drop-hover');
    d.target = null;
  }
}

function autoScroll() {
  const d = Drag.active;
  if (!d) return;
  const wrap = $('#boardWrap');
  const r = wrap.getBoundingClientRect();
  const pool = $('#pool');
  const sheet = getComputedStyle(pool).position === 'fixed';
  const bottom = sheet ? Math.min(r.bottom, pool.getBoundingClientRect().top) : r.bottom;
  const edge = 70;
  let dy = 0;
  if (d.y < r.top + edge && d.y > r.top - 40) dy = -Math.ceil((r.top + edge - d.y) / 4);
  else if (d.y > bottom - edge && d.y < bottom + (sheet ? 0 : 40) && d.x < r.right) dy = Math.ceil((d.y - (bottom - edge)) / 4);
  if (dy) { wrap.scrollTop += dy; dragTo(d.x, d.y); }
  Drag.scrollRaf = requestAnimationFrame(autoScroll);
}

function dragDrop() {
  dragFinish(Drag.active.target);
}

function dragFinish(target) {
  const d = Drag.active;
  if (!d) return;
  cancelAnimationFrame(Drag.scrollRaf);
  d.ghost.remove();
  d.placeholder.remove();
  $$('.dragging-src').forEach(t => t.classList.remove('dragging-src'));
  document.body.classList.remove('is-dragging');
  $$('.drop-hover').forEach(n => n.classList.remove('drop-hover'));
  Drag.active = null;
  Drag.lastDrop = Date.now();

  if (target) {
    const placed = new Set(Object.values(App.state.rankings[App.me.id]?.[App.board] || {}).flat());
    const fromPool = d.ids.every(id => !placed.has(id));
    if (!(target.tierId === null && fromPool)) {
      if (d.ids.length > 1) { App.sel = d.ids; App.placeSelection(target.tierId, target.index); }
      else App.dispatch({ type: 'place', board: App.board, itemId: d.id, tierId: target.tierId, index: target.index });
      return;
    }
  }
  if (App.renderPending) App.render();
}

/* Tap-to-place: erst auswählen, dann Ziel antippen. additive (Strg/Umschalt-Klick oder
   Mehrfachauswahl-Modus) nimmt die Kachel zur Auswahl hinzu bzw. wieder heraus. */
function tapTile(id, tile, additive = false) {
  Drag.lastDrop = Date.now(); // das click-Event dieser Geste nicht als Ziel-Tap werten
  const inTier = tile.closest('.tier');
  if (additive || App.multi) {
    App.toggleSelect(id);
  } else if (App.sel.length && !App.sel.includes(id) && inTier) {
    const box = inTier.querySelector('.tier-items');
    const ids = [...box.querySelectorAll('.tile')].map(t => t.dataset.id).filter(x => !App.sel.includes(x));
    App.placeSelection(inTier.dataset.tier, ids.indexOf(id));
  } else {
    App.sel = App.sel.length === 1 && App.sel[0] === id ? [] : [id];
    App.updateSelection(); // kein Neuaufbau, damit das folgende click-Event die Kachel trifft
  }
}
