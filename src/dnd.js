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
  const s = Drag.start = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, id: tile.dataset.id, tile, pid: e.pointerId, touch, timer: 0 };
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
  tapTile(s.id, s.tile);
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
  const r = s.tile.getBoundingClientRect();
  const ghost = s.tile.cloneNode(true);
  ghost.classList.add('ghost');
  ghost.classList.remove('selected');
  Object.assign(ghost.style, { width: r.width + 'px', height: r.height + 'px', left: r.left + 'px', top: r.top + 'px' });
  document.body.append(ghost);
  s.tile.classList.add('dragging-src');
  document.body.classList.add('is-dragging');
  if (s.touch && navigator.vibrate) navigator.vibrate(12);
  if (App.selected) { App.selected = null; $$('.tile.selected').forEach(t => t.classList.remove('selected')); document.body.classList.remove('selecting'); }

  Drag.active = {
    id: s.id, src: s.tile, pid: s.pid, ghost,
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
    const tiles = [...box.children].filter(c => c.classList.contains('tile') && c !== d.src);
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
  d.src.classList.remove('dragging-src');
  document.body.classList.remove('is-dragging');
  $$('.drop-hover').forEach(n => n.classList.remove('drop-hover'));
  Drag.active = null;
  Drag.lastDrop = Date.now();

  if (target) {
    const fromPool = !!d.src.closest('#poolBody');
    if (!(target.tierId === null && fromPool)) {
      App.dispatch({ type: 'place', board: App.board, itemId: d.id, tierId: target.tierId, index: target.index });
      return;
    }
  }
  if (App.renderPending) App.render();
}

/* Tap-to-place: erst auswählen, dann Ziel antippen */
function tapTile(id, tile) {
  Drag.lastDrop = Date.now(); // das click-Event dieser Geste nicht als Ziel-Tap werten
  const inTier = tile.closest('.tier');
  if (App.selected && App.selected !== id && inTier) {
    const box = inTier.querySelector('.tier-items');
    const ids = [...box.querySelectorAll('.tile')].map(t => t.dataset.id).filter(x => x !== App.selected);
    const itemId = App.selected;
    App.selected = null;
    App.dispatch({ type: 'place', board: App.board, itemId, tierId: inTier.dataset.tier, index: ids.indexOf(id) });
  } else {
    App.selected = App.selected === id ? null : id;
    App.updateSelection(); // kein Neuaufbau, damit das folgende click-Event die Kachel trifft
  }
}
