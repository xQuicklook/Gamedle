/* ───────── Gamedle: Oberfläche ─────────
   Modi: Klassik (Eigenschaften vergleichen), Cover (verpixeltes Cover), Endlos (Übung, zählt nicht). */
const GD_COVER_LEVELS = [7, 11, 16, 24, 36, 56]; // Pixelbreite pro Stufe, danach scharf
const GD_HINT_LETTER = 4, GD_HINT_COVER = 8;     // Tipps nach so vielen Fehlversuchen
const GD_URL = () => location.href.split('#')[0];

const Gamedle = {
  mode: 'classic',
  date: null,
  covers: {},          // Wikipedia-Artikel → Cover-URL
  endless: null,       // { answer, guesses }
  animateLast: false,
  timer: null,

  init() {
    $('#gdBack').append(icon('left'));
    $('#gdStatsBtn').append(icon('chart'));
    $('#gdHelpBtn').append(icon('edit'));
    $('#gdStatsBtn').onclick = () => gdStatsModal();
    $('#gdHelpBtn').onclick = () => gdHelpModal();
    $('#hubInfo').onclick = () => infoModal();
    const cached = Store.get('gd.covers');
    if (cached && Date.now() - cached.at < 7 * 86400000) this.covers = cached.map;
  },

  /* Wird vom Router aufgerufen */
  open(mode = 'classic') {
    this.mode = ['classic', 'cover', 'endless'].includes(mode) ? mode : 'classic';
    this.date = gdToday();
    this.renderTabs();
    this.render();
    this.loadCovers();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 1000);
    if (!Store.get('gd.seenHelp')) { Store.set('gd.seenHelp', true); setTimeout(gdHelpModal, 300); }
  },

  close() { clearInterval(this.timer); },

  tick() {
    if (gdToday() !== this.date) { this.date = gdToday(); this.render(); return; } // neuer Tag → neues Rätsel
    const el = $('#gdCountdown');
    if (el) el.textContent = gdFmtDuration(gdMsUntilNext());
  },

  /* Alle Cover auf einmal (4 Anfragen), eine Woche zwischengespeichert */
  async loadCovers() {
    if (Object.keys(this.covers).length >= GD.length - GD_NO_COVER.size) return;
    try {
      const found = await Wiki.byTitles(GD.map(g => g.wiki));
      for (const [w, info] of found) if (info.img) this.covers[w] = info.img;
      Store.set('gd.covers', { at: Date.now(), map: this.covers });
      if (!$('#gamedle').hidden) this.render();
    } catch (e) { console.warn('Cover nicht geladen', e); }
  },

  cover(g) { return this.covers[g.wiki] || ''; },

  /* ── Fortschritt ── */
  progress() {
    if (this.mode === 'endless') {
      if (!this.endless) this.newEndless();
      return this.endless;
    }
    const all = Store.get('gd.progress', {});
    return all[this.date]?.[this.mode] || { guesses: [], done: false, hints: 0 };
  },
  save(p) {
    if (this.mode === 'endless') { this.endless = p; return; }
    const all = Store.get('gd.progress', {});
    // Nur die letzten 30 Tage aufheben
    for (const d of Object.keys(all)) if (gdDays(d, this.date) > 30) delete all[d];
    (all[this.date] ||= {})[this.mode] = p;
    Store.set('gd.progress', all);
  },
  answer() {
    if (this.mode === 'endless') {
      if (!this.endless) this.newEndless();
      return GD_BY_ID.get(this.endless.answer);
    }
    return gdDaily(this.mode, this.date);
  },
  newEndless() {
    const pool = gdPool('classic');
    this.endless = { answer: pool[Math.floor(Math.random() * pool.length)].id, guesses: [], done: false, hints: 0 };
  },

  guess(id) {
    const p = this.progress();
    if (p.done || p.guesses.includes(id)) return;
    p.guesses.push(id);
    const ans = this.answer();
    if (id === ans.id) {
      p.done = true;
      if (this.mode !== 'endless') {
        const stats = gdRecordWin(Store.get('gd.stats', {}), this.mode, this.date, p.guesses.length);
        Store.set('gd.stats', stats);
      }
    }
    this.save(p);
    this.animateLast = true;
    this.render();
    if (p.done) setTimeout(() => gdCelebrate(), this.mode === 'classic' || this.mode === 'endless' ? 1300 : 200);
  },

  /* ── Rendering ── */
  renderTabs() {
    const today = Store.get('gd.progress', {})[gdToday()] || {};
    const tab = (mode, label) => h('button.tab', {
      role: 'tab', 'aria-selected': String(this.mode === mode),
      onclick: () => { location.hash = mode === 'classic' ? '#/gamedle' : '#/gamedle/' + mode; },
    }, label, today[mode]?.done ? h('span.gd-done', ' ✓') : null);
    $('#gdTabs').replaceChildren(tab('classic', 'Klassik'), tab('cover', 'Cover'), tab('endless', 'Endlos'));
  },

  render() {
    this.renderTabs();
    const main = $('#gdMain');
    const p = this.progress();
    const ans = this.answer();
    const no = gdDayNumber(this.date);
    const wrong = p.guesses.filter(id => id !== ans.id).length;
    const titles = {
      classic: ['Welches Spiel suchen wir heute?', `Gamedle #${no} · Jeder Tipp verrät, welche Eigenschaften passen.`],
      cover: ['Welches Spiel versteckt sich hinter dem Cover?', `Gamedle #${no} · Mit jedem Fehlversuch wird das Bild schärfer.`],
      endless: ['Endlos-Modus', 'Zum Üben – zählt nicht für die Statistik.'],
    }[this.mode];

    main.replaceChildren(h('div.gd-wrap',
      h('div.gd-head', h('h2', titles[0]), h('p.muted', titles[1])),
      this.mode === 'cover' ? this.coverStage(ans, p) : null,
      p.done ? this.resultCard(ans, p) : this.searchBox(p),
      !p.done && this.mode !== 'cover' ? this.hintBar(ans, p, wrong) : null,
      this.mode === 'cover' ? this.coverGuesses(ans, p) : this.table(ans, p),
      this.mode !== 'endless' && no > 1 ? h('p.gd-yesterday.muted', 'Gestern gesucht: ', h('strong', gdDaily(this.mode, gdShiftDate(this.date, -1)).title)) : null,
    ));
    this.animateLast = false;
  },

  searchBox(p) {
    const input = h('input.gd-input', { type: 'search', placeholder: 'Spiel eintippen …', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Spiel raten' });
    const list = h('div.gd-suggest', { role: 'listbox', hidden: true });
    let items = [], active = 0;
    const draw = () => {
      list.hidden = !items.length;
      list.replaceChildren(...items.map((g, i) => {
        const src = this.cover(g);
        return h('button.gd-sug' + (i === active ? '.active' : ''), { type: 'button', role: 'option', onmousedown: e => e.preventDefault(), onclick: () => pick(g) },
          src ? h('img', { src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span.gd-sug-ph', g.title.slice(0, 1)),
          h('span', h('strong', g.title), h('small', ` ${g.year}`)));
      }));
    };
    const pick = g => { input.value = ''; items = []; draw(); this.guess(g.id); setTimeout(() => $('.gd-input')?.focus(), 30); };
    input.addEventListener('input', () => { items = gdSearch(input.value, new Set(p.guesses)); active = 0; draw(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); draw(); e.preventDefault(); }
      else if (e.key === 'Enter' && items[active]) { e.preventDefault(); pick(items[active]); }
      else if (e.key === 'Escape') { items = []; draw(); }
    });
    input.addEventListener('blur', () => setTimeout(() => { items = []; draw(); }, 150));
    if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => input.focus({ preventScroll: true }), 50);
    return h('div.gd-search', icon('search'), input, list,
      h('span.gd-count', p.guesses.length ? `${p.guesses.length} ${p.guesses.length === 1 ? 'Versuch' : 'Versuche'}` : ''));
  },

  hintBar(ans, p, wrong) {
    const hint = (n, label, show) => {
      if (wrong < n) return h('span.gd-hint.gd-hint-locked', icon('lock'), `${label} in ${n - wrong}`);
      return p.hints >= show
        ? null
        : h('button.gd-hint', { onclick: () => { p.hints = show; this.save(p); this.render(); } }, '💡 ', label);
    };
    const shown = [];
    if (p.hints >= 1) shown.push(h('div.gd-hint-box', 'Anfangsbuchstabe: ', h('strong', ans.title.slice(0, 1))));
    if (p.hints >= 2) {
      const src = this.cover(ans);
      shown.push(h('div.gd-hint-box', 'Verschwommenes Cover:', src ? h('img.gd-blur', { src, alt: '', referrerpolicy: 'no-referrer' }) : h('span.muted', ' (wird geladen …)')));
    }
    return h('div.gd-hints', hint(GD_HINT_LETTER, 'Tipp: Anfangsbuchstabe', 1), p.hints >= 1 ? hint(GD_HINT_COVER, 'Tipp: Cover', 2) : null, ...shown);
  },

  table(ans, p) {
    if (!p.guesses.length) return h('p.gd-empty.muted', 'Noch kein Versuch. Tipp los – jedes Spiel verrät etwas über die Lösung.');
    const head = h('div.gd-row.gd-headrow', h('div.gd-cell.gd-name', 'Spiel'), GD_COLUMNS.map(c => h('div.gd-cell.head', { title: c.title || c.label }, c.label)));
    const rows = [...p.guesses].reverse().map((id, idx) => {
      const g = GD_BY_ID.get(id);
      const anim = this.animateLast && idx === 0;
      const src = this.cover(g);
      return h('div.gd-row' + (anim ? '.anim' : ''),
        h('div.gd-cell.gd-name', src ? h('img', { src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null, h('span', g.title)),
        gdCompare(g, ans).map((c, i) => h(`div.gd-cell.${c.state}${c.near ? '.near' : ''}`, { style: { '--i': i } },
          h('span', c.text), c.state === 'up' ? h('i.gd-arrow', '▲') : c.state === 'down' ? h('i.gd-arrow', '▼') : null)));
    });
    return h('div.gd-table-wrap', h('div.gd-table', head, rows), h('p.gd-legend.muted',
      h('i.sw.ok'), 'richtig ', h('i.sw.partial'), 'teilweise ', h('i.sw.no'), 'falsch · ▲▼ Lösung ist neuer/älter (gelb: höchstens 3 Jahre)'));
  },

  coverStage(ans, p) {
    const wrong = p.guesses.filter(id => id !== ans.id).length;
    const level = p.done ? 0 : GD_COVER_LEVELS[wrong] || 0;
    const stage = h('div.gd-cover-stage', h('div.gd-cover-msg.muted', 'Cover wird geladen …'));
    const src = this.cover(ans);
    if (src) {
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.onload = () => stage.replaceChildren(gdPixelate(img, level), h('span.gd-cover-level', level ? `Schärfe ${GD_COVER_LEVELS.indexOf(level) + 1}/${GD_COVER_LEVELS.length + 1}` : 'Volle Schärfe'));
      img.onerror = () => stage.replaceChildren(h('div.gd-cover-msg', 'Das Cover konnte nicht geladen werden. Probier den Klassik-Modus.'));
      img.src = src;
    } else if (navigator.onLine === false) stage.replaceChildren(h('div.gd-cover-msg', 'Für den Cover-Modus brauchst du eine Internetverbindung.'));
    return stage;
  },

  coverGuesses(ans, p) {
    const wrong = p.guesses.filter(id => id !== ans.id);
    return wrong.length ? h('div.gd-chips', wrong.reverse().map(id => h('span.gd-chip', '✕ ', GD_BY_ID.get(id).title))) : null;
  },

  resultCard(ans, p) {
    const n = p.guesses.length;
    const src = this.cover(ans);
    const other = this.mode === 'classic' ? 'cover' : 'classic';
    const otherDone = Store.get('gd.progress', {})[this.date]?.[other]?.done;
    return h('div.gd-result',
      src ? h('img.gd-result-cover', { src, alt: '', referrerpolicy: 'no-referrer' }) : null,
      h('div.gd-result-body',
        h('span.gd-result-kicker', this.mode === 'endless' ? 'Richtig!' : `Gamedle #${gdDayNumber(this.date)} gelöst!`),
        h('h3', ans.title),
        h('p.muted', `${ans.year} · ${ans.dev} · ${n} ${n === 1 ? 'Versuch' : 'Versuche'}`),
        h('div.gd-result-actions',
          this.mode === 'endless'
            ? h('button.btn.primary', { onclick: () => { this.newEndless(); this.render(); } }, 'Nächstes Spiel')
            : h('button.btn.primary', { onclick: () => gdShare(gdShareText(this.mode, this.date, p.guesses, GD_URL())) }, icon('upload'), 'Ergebnis teilen'),
          this.mode !== 'endless' && !otherDone
            ? h('a.btn', { href: other === 'cover' ? '#/gamedle/cover' : '#/gamedle' }, other === 'cover' ? 'Weiter zum Cover-Rätsel' : 'Weiter zum Klassik-Rätsel')
            : null),
        this.mode !== 'endless' ? h('p.gd-next.muted', 'Nächstes Rätsel in ', h('strong#gdCountdown', gdFmtDuration(gdMsUntilNext()))) : null));
  },
};

/* Bild verpixeln: klein zeichnen, groß ohne Glättung anzeigen */
function gdPixelate(img, level) {
  const c = document.createElement('canvas');
  const ratio = img.naturalHeight / img.naturalWidth || 1.4;
  if (!level) { c.width = img.naturalWidth; c.height = img.naturalHeight; }
  else { c.width = level; c.height = Math.max(1, Math.round(level * ratio)); }
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = !level;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  c.className = 'gd-cover-canvas' + (level ? ' pixel' : '');
  c.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
  return c;
}

function gdFmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(x => String(x).padStart(2, '0')).join(':');
}

async function gdShare(text) {
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ text }); return; } catch { /* abgebrochen → Zwischenablage */ }
  }
  copyText(text, 'Ergebnis kopiert – einfach einfügen!');
}

/* Kleiner Konfetti-Regen beim Lösen */
function gdCelebrate() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const layer = h('div.gd-confetti', { 'aria-hidden': 'true' });
  const colors = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#38bdf8', '#a78bfa'];
  for (let i = 0; i < 70; i++) {
    layer.append(h('i', { style: {
      left: Math.random() * 100 + 'vw', background: colors[i % colors.length],
      animationDelay: Math.random() * 0.6 + 's', animationDuration: 1.6 + Math.random() * 1.4 + 's',
      transform: `rotate(${Math.random() * 360}deg)`,
    } }));
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 3600);
}

/* ── Dialoge ── */
function gdStatsModal() {
  const stats = Store.get('gd.stats', {});
  const today = gdToday();
  const block = (mode, label) => {
    const s = stats[mode] || { won: 0, best: 0, total: 0, dist: {} };
    const buckets = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10+'];
    const max = Math.max(1, ...buckets.map(b => s.dist[b] || 0));
    return h('section.gd-stat-block',
      h('h3', label),
      h('div.gd-stat-nums',
        h('div', h('strong', s.won), h('span', 'Gelöst')),
        h('div', h('strong', gdCurrentStreak(stats, mode, today)), h('span', 'Serie')),
        h('div', h('strong', s.best), h('span', 'Beste Serie')),
        h('div', h('strong', s.won ? (s.total / s.won).toFixed(1).replace('.', ',') : '–'), h('span', 'Ø Versuche'))),
      h('div.gd-dist', buckets.map(b => h('div.gd-dist-row', h('span', b),
        h('div.gd-bar', { style: { width: Math.max(4, ((s.dist[b] || 0) / max) * 100) + '%' } }, String(s.dist[b] || 0))))));
  };
  openModal({ title: 'Deine Statistik', width: 560, autofocus: false, body: h('div.gd-stats', block('classic', 'Klassik'), block('cover', 'Cover')) });
}

function gdHelpModal() {
  const legend = (cls, text) => h('div.gd-help-row', h('span.gd-cell.' + cls, ' '), h('span', text));
  openModal({
    title: 'So funktioniert Gamedle', width: 520, autofocus: false,
    body: [
      h('p', 'Jeden Tag wartet ein neues Spiel – für alle dasselbe. Das Rätsel wechselt um Mitternacht (deutsche Zeit).'),
      h('h3', { style: { fontSize: '15px' } }, 'Klassik'),
      h('p.help', 'Tipp ein beliebiges Spiel ein. Für jede Eigenschaft siehst du, wie nah du dran bist:'),
      legend('ok', 'Grün – stimmt genau'),
      legend('partial', 'Gelb – teilweise (z. B. eines von mehreren Genres oder Plattformen)'),
      legend('no', 'Rot – passt nicht'),
      h('p.help', '▲ / ▼ beim Jahr: Die Lösung ist neuer bzw. älter. Gelb heißt: höchstens drei Jahre daneben. „Plattform“ meint die Plattformen bei der Erstveröffentlichung.'),
      h('p.help', `Nach ${GD_HINT_LETTER} Fehlversuchen gibt es den Anfangsbuchstaben als Tipp, nach ${GD_HINT_COVER} ein verschwommenes Cover.`),
      h('h3', { style: { fontSize: '15px' } }, 'Cover'),
      h('p.help', 'Erkenne das Spiel am Cover. Es startet stark verpixelt und wird mit jedem Fehlversuch schärfer.'),
      h('h3', { style: { fontSize: '15px' } }, 'Endlos'),
      h('p.help', 'Zufällige Spiele zum Üben – zählt nicht für die Statistik.'),
      h('p.help', `Im Spiele-Pool: ${GD.length} bekannte Spiele von 1980 bis heute. Daten geprüft mit Wikipedia, Cover über Wikipedia.`),
    ],
  });
}
