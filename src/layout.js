/* ───────── Layout: Spieleliste skalieren & Kachelgröße ─────────
   Desktop: Trenner zwischen Tierliste und Spieleliste ziehen (Doppelklick = Standard).
   Handy:   Griff der Spieleliste ziehen (antippen = Stufen: zu / halb / groß).
   Überall: Kachelgröße per Regler, Strg + Mausrad oder Tasten + / − / 0. */
const ZOOM_MIN = 0.6, ZOOM_MAX = 1.8, ZOOM_STEP = 0.1;
const POOL_MIN = 220, BOARD_MIN = 320, SHEET_MIN = 64;
const isSheet = () => matchMedia('(max-width: 820px)').matches;

const Layout = {
  s: { zoom: 1, poolW: null, sheetH: null }, // null = Standardgröße aus dem CSS

  init() {
    this.s = { ...this.s, ...Store.get('layout', {}) };
    this.setZoom(this.s.zoom, false);
    this.initSplitter();
    this.initSheet();
    this.initZoomUi();
    this.refresh();
    window.addEventListener('resize', () => this.refresh());

    // Strg/Cmd + Mausrad über Liste oder Tierliste = Kachelgröße (statt Browser-Zoom)
    $('.workspace').addEventListener('wheel', e => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      this.setZoom(this.s.zoom + (e.deltaY < 0 ? 0.05 : -0.05));
    }, { passive: false });

    document.addEventListener('keydown', e => {
      if ($('#app').hidden || modalStack.length || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable], .tile')) return;
      if (e.key === '+') this.setZoom(this.s.zoom + ZOOM_STEP);
      else if (e.key === '-') this.setZoom(this.s.zoom - ZOOM_STEP);
      else if (e.key === '0') this.setZoom(1);
    });
  },

  save() { Store.set('layout', this.s); },

  refresh() { this.applyPool(); this.applySheet(); },

  reset() {
    this.s = { zoom: 1, poolW: null, sheetH: null };
    this.setZoom(1, false);
    this.refresh();
    this.save();
  },

  /* ── Kachelgröße ── */
  setZoom(z, save = true) {
    z = Math.round(clamp(+z || 1, ZOOM_MIN, ZOOM_MAX) * 100) / 100;
    this.s.zoom = z;
    document.documentElement.style.setProperty('--zoom', z);
    $$('input.zoom-range').forEach(r => { r.value = z; });
    $$('.zoom-value').forEach(el => { el.textContent = Math.round(z * 100) + ' %'; });
    if (save) this.save();
  },

  zoomSlider() {
    return h('input.zoom-range', {
      type: 'range', min: ZOOM_MIN, max: ZOOM_MAX, step: 0.05, value: this.s.zoom,
      'aria-label': 'Kachelgröße', title: 'Kachelgröße (auch Strg + Mausrad oder + / −)',
      oninput: e => this.setZoom(e.target.value),
    });
  },

  initZoomUi() {
    $('#zoomCtl').replaceChildren(
      h('button.icon-btn.sm', { type: 'button', title: 'Kacheln kleiner (−)', 'aria-label': 'Kacheln kleiner', onclick: () => this.setZoom(this.s.zoom - ZOOM_STEP) }, icon('minus')),
      this.zoomSlider(),
      h('button.icon-btn.sm', { type: 'button', title: 'Kacheln größer (+)', 'aria-label': 'Kacheln größer', onclick: () => this.setZoom(this.s.zoom + ZOOM_STEP) }, icon('plus')),
    );
  },

  /* ── Breite der Spieleliste (Desktop) ── */
  poolBounds() {
    const w = $('.workspace').clientWidth;
    return [POOL_MIN, Math.max(POOL_MIN, w - BOARD_MIN)];
  },

  applyPool() {
    const ws = $('.workspace'), sp = $('#splitter');
    if (this.s.poolW == null) ws.style.removeProperty('--pool-w');
    else {
      // Solange die App unsichtbar ist, gibt es keine Breite zum Begrenzen
      const w = ws.clientWidth ? clamp(this.s.poolW, ...this.poolBounds()) : this.s.poolW;
      ws.style.setProperty('--pool-w', Math.round(w) + 'px');
    }
    const [lo, hi] = this.poolBounds();
    sp.setAttribute('aria-valuemin', lo);
    sp.setAttribute('aria-valuemax', hi);
    sp.setAttribute('aria-valuenow', Math.round($('#pool').getBoundingClientRect().width));
  },

  initSplitter() {
    const sp = $('#splitter');
    const poolWidth = () => $('#pool').getBoundingClientRect().width;

    sp.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      sp.setPointerCapture(e.pointerId);
      sp.classList.add('active');
      document.body.classList.add('is-resizing');
      const right = $('.workspace').getBoundingClientRect().right;
      const move = ev => { this.s.poolW = right - ev.clientX; this.applyPool(); };
      const up = () => {
        sp.removeEventListener('pointermove', move);
        sp.removeEventListener('pointerup', up);
        sp.removeEventListener('pointercancel', up);
        sp.classList.remove('active');
        document.body.classList.remove('is-resizing');
        this.s.poolW = Math.round(poolWidth());
        this.save();
      };
      sp.addEventListener('pointermove', move);
      sp.addEventListener('pointerup', up);
      sp.addEventListener('pointercancel', up);
    });

    sp.addEventListener('dblclick', () => { this.s.poolW = null; this.applyPool(); this.save(); });

    // Tastatur: ← macht die Spieleliste breiter, → schmaler
    sp.addEventListener('keydown', e => {
      const step = e.shiftKey ? 80 : 24;
      const map = { ArrowLeft: step, ArrowRight: -step };
      if (e.key in map) this.s.poolW = poolWidth() + map[e.key];
      else if (e.key === 'Home') this.s.poolW = this.poolBounds()[1];
      else if (e.key === 'End') this.s.poolW = POOL_MIN;
      else if (e.key === 'Enter') this.s.poolW = null;
      else return;
      e.preventDefault();
      this.applyPool();
      if (this.s.poolW != null) this.s.poolW = Math.round(poolWidth());
      this.save();
    });
  },

  /* ── Höhe der Spieleliste (Handy, Bottom-Sheet) ── */
  applySheet() {
    const ws = $('.workspace'), pool = $('#pool');
    if (this.s.sheetH == null) {
      ws.style.removeProperty('--sheet-h');
      pool.classList.remove('collapsed');
      return;
    }
    const hgt = clamp(this.s.sheetH, SHEET_MIN, Math.round(innerHeight * 0.88));
    ws.style.setProperty('--sheet-h', Math.round(hgt) + 'px');
    pool.classList.toggle('collapsed', hgt <= SHEET_MIN + 24);
  },

  // Antippen: zu → halb → groß → zu
  cycleSheet() {
    const cur = $('#pool').getBoundingClientRect().height;
    const presets = [SHEET_MIN, Math.round(innerHeight * 0.38), Math.round(innerHeight * 0.78)];
    this.s.sheetH = presets.find(p => p > cur + 12) ?? presets[0];
    this.applySheet();
    this.save();
  },

  initSheet() {
    const handle = $('#poolHandle'), pool = $('#pool');
    handle.addEventListener('pointerdown', e => {
      if (!isSheet() || e.button !== 0) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const startY = e.clientY, startH = pool.getBoundingClientRect().height;
      let moved = false;
      pool.classList.add('resizing');
      document.body.classList.add('is-resizing-y');
      const move = ev => {
        const dy = startY - ev.clientY;
        if (Math.abs(dy) > 5) moved = true;
        if (moved) { this.s.sheetH = startH + dy; this.applySheet(); }
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        pool.classList.remove('resizing');
        document.body.classList.remove('is-resizing-y');
        if (moved) { this.s.sheetH = Math.round(pool.getBoundingClientRect().height); this.save(); }
        else this.cycleSheet();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  },
};
