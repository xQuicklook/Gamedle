/* ───────── Gamedle: Oberfläche ─────────
   Tagesmodi: Klassik (Eigenschaften vergleichen), Zitat, Emoji, Cover (verpixelt) und Szene
   (Bildausschnitt) – dazu Endlos zum Üben (zählt nicht). */
const GD_COVER_LEVELS = [7, 11, 16, 24, 36, 56]; // Pixelbreite pro Stufe, danach scharf
const GD_SCENE_ZOOM = [3.4, 2.6, 2, 1.6, 1.3];   // Vergrößerung pro Stufe, danach das ganze Bild
const GD_URL = () => location.href.split('#')[0];
const GD_ISSUES = 'https://github.com/xQuicklook/Gamedle/issues/new';
const GD_STATE_LABEL = { ok: 'richtig', partial: 'teilweise richtig', no: 'falsch', up: 'Lösung ist neuer', down: 'Lösung ist älter' };
const GD_STATE_ICON = { ok: '✓', partial: '~', no: '✕', up: '▲', down: '▼' };

const GD_MODE_UI = {
  classic: { label: 'Klassik', title: 'Welches Spiel suchen wir heute?', sub: 'Jeder Tipp verrät, welche Eigenschaften passen.' },
  quote: { label: 'Zitat', title: 'Aus welchem Spiel stammt dieses Zitat?', sub: 'Zitat in Originalsprache – nach Fehlversuchen gibt es Tipps.' },
  emoji: { label: 'Emoji', title: 'Welches Spiel beschreiben diese Emojis?', sub: 'Mit jedem Fehlversuch kommt ein Emoji dazu.' },
  cover: { label: 'Cover', title: 'Welches Spiel versteckt sich hinter dem Cover?', sub: 'Mit jedem Fehlversuch wird das Bild schärfer.' },
  scene: { label: 'Szene', title: 'Aus welchem Spiel stammt diese Szene?', sub: 'Mit jedem Fehlversuch zoomt das Bild weiter heraus.' },
  endless: { label: 'Endlos', title: 'Endlos-Modus', sub: 'Zum Üben – zählt nicht für die Statistik.' },
};
const gdModeHash = mode => (mode === 'classic' ? '#/gamedle' : '#/gamedle/' + mode);

/* Tipps je Modus: [Art, freigeschaltet nach so vielen Fehlversuchen].
   Cover und Szene brauchen keine – dort wird das Bild von selbst deutlicher. */
const GD_HINTS = {
  classic: [['letter', 4], ['cover', 8]],
  quote: [['year', 3], ['speaker', 6], ['letter', 9]],
  emoji: [['year', 5], ['letter', 8]],
  endless: [['letter', 4], ['cover', 8]],
};

const Gamedle = {
  mode: 'classic',
  date: null,
  covers: {},          // Wikipedia-Artikel → Cover-URL
  scenes: {},          // Spiel-ID → Bild-URL (Szene-Modus)
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
    const fresh = c => c && Date.now() - c.at < 7 * 86400000;
    const cached = Store.get('gd.covers');
    if (fresh(cached)) this.covers = cached.map;
    const scenes = Store.get('gd.scenes');
    if (fresh(scenes)) this.scenes = scenes.map;
    document.body.classList.toggle('gd-cb', !!Store.get('gd.colorblind'));
  },

  /* Wird vom Router aufgerufen */
  open(mode = 'classic') {
    this.mode = [...GD_DAILY_MODES, 'endless'].includes(mode) ? mode : 'classic';
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
      this.coverError = false;
    } catch (e) {
      console.warn('Cover nicht geladen', e);
      this.coverError = true; // Cover-Modus und Cover-Tipp zeigen dann einen Hinweis statt „lädt …“
    }
    if (!$('#gamedle').hidden) this.render();
  },

  /* Szene-Bild nur bei Bedarf holen (eine Anfrage), ebenfalls eine Woche zwischengespeichert */
  async loadScene(g) {
    const file = GD_SCENES[g.id]?.[0];
    if (!file || this.scenes[g.id] || this.sceneLoading === g.id) return;
    this.sceneLoading = g.id;
    try {
      const data = await Wiki.api({ action: 'query', titles: 'File:' + file, prop: 'imageinfo', iiprop: 'url', iiurlwidth: '960' });
      const info = data.query?.pages?.[0]?.imageinfo?.[0];
      if (!info) throw new Error('Bild nicht gefunden: ' + file);
      this.scenes[g.id] = (info.thumburl || info.url).replace(/\?utm_[^#]*$/, '');
      Store.set('gd.scenes', { at: Date.now(), map: this.scenes });
      this.sceneError = false;
    } catch (e) {
      console.warn('Szene nicht geladen', e);
      this.sceneError = true;
    }
    this.sceneLoading = null;
    if (this.mode === 'scene' && !$('#gamedle').hidden) this.render();
  },

  cover(g) { return this.covers[g.wiki] || ''; },
  hasCover(g) { return !GD_NO_COVER.has(g.title) && !this.coverError; },

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
    p.answer = this.answer().id; // die Lösung des Tages mitspeichern (falls sich Daten später ändern)
    const all = Store.get('gd.progress', {});
    // Nur die letzten 30 Tage aufheben
    for (const d of Object.keys(all)) if (gdDays(d, this.date) > 30) delete all[d];
    (all[this.date] ||= {})[this.mode] = p;
    Store.set('gd.progress', all);
  },
  /* Lösung eines Tages – wer schon angefangen hat, behält seine (auch wenn sich der Plan ändern sollte) */
  answerOf(mode, date) {
    const stored = Store.get('gd.progress', {})[date]?.[mode]?.answer;
    return (stored && GD_BY_ID.get(stored)) || gdDaily(mode, date);
  },
  answer() {
    if (this.mode === 'endless') {
      if (!this.endless) this.newEndless();
      return GD_BY_ID.get(this.endless.answer);
    }
    return this.answerOf(this.mode, this.date);
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
    const tab = mode => h('button.tab', {
      role: 'tab', 'aria-selected': String(this.mode === mode),
      onclick: () => { location.hash = gdModeHash(mode); },
    }, GD_MODE_UI[mode].label, today[mode]?.done ? h('span.gd-done', ' ✓') : null);
    $('#gdTabs').replaceChildren(...GD_DAILY_MODES.map(tab), tab('endless'));
    $('#gdTabs [aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  },

  render() {
    this.renderTabs();
    const main = $('#gdMain');
    const p = this.progress();
    const ans = this.answer();
    const no = gdDayNumber(this.date);
    const wrong = p.guesses.filter(id => id !== ans.id).length;
    const ui = GD_MODE_UI[this.mode];
    const table = this.mode === 'classic' || this.mode === 'endless';

    main.replaceChildren(h('div.gd-wrap',
      h('div.gd-head', h('h2', ui.title), h('p.muted', this.mode === 'endless' ? ui.sub : `Gamedle #${no} · ${ui.sub}`)),
      this.stage(ans, p, wrong),
      p.done ? this.resultCard(ans, p) : this.searchBox(p),
      p.done ? null : this.hintBar(ans, p, wrong),
      this.yesterday(no),
      table ? this.table(ans, p) : this.guessChips(ans, p),
    ));
    this.animateLast = false;
  },

  stage(ans, p, wrong) {
    if (this.mode === 'quote') return this.quoteStage(ans);
    if (this.mode === 'emoji') return this.emojiStage(ans, p, wrong);
    if (this.mode === 'cover') return this.coverStage(ans, p, wrong);
    if (this.mode === 'scene') return this.sceneStage(ans, p, wrong);
    return null;
  },

  searchBox(p) {
    const input = h('input.gd-input', { type: 'search', placeholder: 'Spiel eintippen …', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Spiel raten' });
    const list = h('div.gd-suggest', { role: 'listbox', hidden: true });
    let items = [], active = 0;
    const draw = () => {
      // Kein Treffer: erklären statt stumm bleiben
      const noHit = !items.length && gdNorm(input.value).length >= 2;
      list.hidden = !items.length && !noHit;
      if (noHit) {
        const already = gdSearch(input.value, new Set(), 1)[0];
        list.replaceChildren(h('div.gd-sug-empty', already && p.guesses.includes(already.id)
          ? `„${already.title}“ hast du schon geraten.`
          : `Kein Treffer im Spiele-Pool (${GD.length} bekannte Spiele). Probier den Originaltitel oder eine Abkürzung.`));
        return;
      }
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

  /* Tipps: immer nur der nächste ist sichtbar (gesperrt oder abrufbar), genutzte bleiben offen */
  hintBar(ans, p, wrong) {
    const hints = GD_HINTS[this.mode] || [];
    if (!hints.length) return null;
    const used = p.hints || 0;
    const next = hints[used];
    // Ohne Cover (Minecraft, Undertale, Fortnite – oder Wikipedia nicht erreichbar) gibt es stattdessen das Jahr
    const kindOf = k => (k === 'cover' && !this.hasCover(ans) ? 'year' : k);
    const label = k => ({ letter: 'Tipp: Anfangsbuchstabe', cover: 'Tipp: Cover', year: 'Tipp: Erscheinungsjahr', speaker: 'Tipp: Wer spricht?' })[kindOf(k)];
    const control = !next ? null
      : wrong < next[1] ? h('span.gd-hint.gd-hint-locked', icon('lock'), `${label(next[0])} in ${next[1] - wrong}`)
        : h('button.gd-hint', { onclick: () => { p.hints = used + 1; this.save(p); this.render(); } }, '💡 ', label(next[0]));
    return h('div.gd-hints', control, hints.slice(0, used).map(([k]) => this.hintBox(kindOf(k), ans)));
  },

  hintBox(kind, ans) {
    if (kind === 'letter') {
      const { letter, skipped } = gdHintLetter(ans.title);
      return h('div.gd-hint-box', 'Anfangsbuchstabe: ', h('strong', letter), skipped ? h('span.muted', ` (ohne „${skipped}“)`) : null);
    }
    if (kind === 'year') return h('div.gd-hint-box', 'Erscheinungsjahr: ', h('strong', ans.year));
    if (kind === 'speaker') return h('div.gd-hint-box', 'Gesagt von: ', h('strong', GD_QUOTES[ans.id]?.[1] || '?'));
    const src = this.cover(ans);
    return h('div.gd-hint-box', 'Verschwommenes Cover:', src ? gdBlurCanvas(src) : h('span.muted', ' (wird geladen …)'));
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
        gdCompare(g, ans).map((c, i) => {
          const state = c.near ? `${GD_STATE_LABEL[c.state]}, höchstens 3 Jahre daneben` : GD_STATE_LABEL[c.state];
          return h(`div.gd-cell.${c.state}${c.near ? '.near' : ''}`, {
            style: { '--i': i }, role: 'cell', 'aria-label': `${c.label}: ${c.text} – ${state}`, title: c.note || state,
          },
          // Symbol zusätzlich zur Farbe (hilft bei Farbschwäche); beim Jahr als deutlicher Pfeil
          c.key === 'year' && c.state !== 'ok'
            ? h('span.gd-year', h('b.gd-arrow', GD_STATE_ICON[c.state]), c.text)
            : h('span', c.text),
          c.key === 'year' && c.state !== 'ok' ? null : h('i.gd-mark', { 'aria-hidden': 'true' }, GD_STATE_ICON[c.state]));
        }));
    });
    return h('div.gd-table-wrap', h('div.gd-table', { role: 'table', 'aria-label': 'Deine Versuche' }, head, rows), h('p.gd-legend.muted',
      h('i.sw.ok', '✓'), 'richtig ', h('i.sw.partial', '~'), 'teilweise ', h('i.sw.no', '✕'), 'falsch · ▲▼ Lösung ist neuer/älter (gelb: höchstens 3 Jahre)'));
  },

  quoteStage(ans) {
    return h('figure.gd-quote',
      h('span.gd-quote-mark', { 'aria-hidden': 'true' }, '“'),
      h('blockquote', GD_QUOTES[ans.id]?.[0] || '…'));
  },

  /* Emojis: zu Beginn eins, jeder Fehlversuch deckt ein weiteres auf */
  emojiStage(ans, p, wrong) {
    const list = (GD_EMOJI_HINTS[ans.id] || '').split(' ');
    const shown = p.done ? list.length : Math.min(list.length, 1 + wrong);
    return h('div.gd-emoji', { role: 'img', 'aria-label': `${shown} von ${list.length} Emojis aufgedeckt: ${list.slice(0, shown).join(' ')}` },
      list.map((e, i) => (i < shown
        ? h('span.gd-emoji-slot.on' + (this.animateLast && !p.done && i === shown - 1 ? '.new' : ''), e)
        : h('span.gd-emoji-slot', '?'))));
  },

  coverStage(ans, p, wrong) {
    const level = p.done ? 0 : GD_COVER_LEVELS[wrong] || 0;
    const stage = h('div.gd-cover-stage', h('div.gd-cover-msg.muted', 'Cover wird geladen …'));
    const src = this.cover(ans);
    if (src) {
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.onload = () => stage.replaceChildren(gdPixelate(img, level), h('span.gd-cover-level', level ? `Schärfe ${GD_COVER_LEVELS.indexOf(level) + 1}/${GD_COVER_LEVELS.length + 1}` : 'Volle Schärfe'));
      img.onerror = () => stage.replaceChildren(h('div.gd-cover-msg', 'Das Cover konnte nicht geladen werden. Probier den Klassik-Modus.'));
      img.src = src;
    } else if (navigator.onLine === false || this.coverError) {
      stage.replaceChildren(h('div.gd-cover-msg', 'Die Cover kommen von Wikipedia – die ist gerade nicht erreichbar. Prüf deine Internetverbindung oder spiel solange Klassik.'));
    }
    return stage;
  },

  /* Szene: stark vergrößerter Ausschnitt, der mit jedem Fehlversuch weiter herauszoomt */
  sceneStage(ans, p, wrong) {
    const step = p.done ? GD_SCENE_ZOOM.length : Math.min(wrong, GD_SCENE_ZOOM.length);
    const zoom = GD_SCENE_ZOOM[step] || 1;
    const [, fx = 50, fy = 50] = GD_SCENES[ans.id] || [];
    const stage = h('div.gd-scene-stage', h('div.gd-cover-msg.muted', 'Szene wird geladen …'));
    const src = this.scenes[ans.id];
    if (src) {
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.onload = () => {
        stage.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
        stage.replaceChildren(gdZoom(img, zoom, fx, fy),
          h('span.gd-cover-level', zoom > 1 ? `Ausschnitt ${step + 1}/${GD_SCENE_ZOOM.length + 1}` : 'Ganzes Bild'));
      };
      img.onerror = () => stage.replaceChildren(h('div.gd-cover-msg', 'Die Szene konnte nicht geladen werden. Probier es gleich noch einmal.'));
      img.src = src;
    } else if (navigator.onLine === false || this.sceneError) {
      stage.replaceChildren(h('div.gd-cover-msg', 'Die Szenen kommen von Wikipedia – die ist gerade nicht erreichbar. Prüf deine Internetverbindung oder spiel solange Klassik.'));
    } else this.loadScene(ans);
    return stage;
  },

  guessChips(ans, p) {
    const wrong = p.guesses.filter(id => id !== ans.id);
    return wrong.length ? h('div.gd-chips', wrong.reverse().map(id => h('span.gd-chip', '✕ ', GD_BY_ID.get(id).title))) : null;
  },

  /* Wie bei Loldle: die Lösung von gestern */
  yesterday(no) {
    if (this.mode === 'endless' || no <= 1) return null;
    const g = this.answerOf(this.mode, gdShiftDate(this.date, -1));
    const src = this.cover(g);
    return h('p.gd-yesterday', src ? h('img', { src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
      h('span', `Gestern (#${no - 1}) gesucht: `, h('strong', g.title)));
  },

  resultCard(ans, p) {
    const n = p.guesses.length;
    const src = this.cover(ans);
    const today = Store.get('gd.progress', {})[this.date] || {};
    // Nächstes noch offenes Tagesrätsel (in der Reihenfolge der Tabs)
    const i = GD_DAILY_MODES.indexOf(this.mode);
    const next = this.mode === 'endless' ? null
      : [...GD_DAILY_MODES.slice(i + 1), ...GD_DAILY_MODES.slice(0, i)].find(m => !today[m]?.done);
    const speaker = this.mode === 'quote' && GD_QUOTES[ans.id]?.[1];
    return h('div.gd-result',
      src ? h('img.gd-result-cover', { src, alt: '', referrerpolicy: 'no-referrer' }) : null,
      h('div.gd-result-body',
        h('span.gd-result-kicker', this.mode === 'endless' ? 'Richtig!' : `Gamedle #${gdDayNumber(this.date)} gelöst!`),
        h('h3', ans.title),
        h('p.muted', `${ans.year} · ${ans.dev} · ${n} ${n === 1 ? 'Versuch' : 'Versuche'}`),
        speaker ? h('p.muted', `Gesagt von ${speaker}`) : null,
        h('div.gd-result-actions',
          this.mode === 'endless'
            ? h('button.btn.primary', { onclick: () => { this.newEndless(); this.render(); } }, 'Nächstes Spiel')
            : h('button.btn.primary', {
              // Der geteilte Link führt direkt in diesen Modus
              onclick: () => gdShare(gdShareText(this.mode, this.date, p.guesses, GD_URL() + gdModeHash(this.mode), { answer: ans, hints: p.hints || 0 })),
            }, icon('upload'), 'Ergebnis teilen'),
          next ? h('a.btn', { href: gdModeHash(next) }, `Weiter: ${GD_MODE_UI[next].label}`) : null),
        this.mode !== 'endless' ? h('p.gd-next.muted', 'Nächstes Rätsel in ', h('strong#gdCountdown', gdFmtDuration(gdMsUntilNext()))) : null,
        h('a.gd-report', { href: gdReportUrl(ans, this.mode), target: '_blank', rel: 'noopener' }, 'Daten zu diesem Spiel falsch? Melden')));
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

/* Bildausschnitt vergrößern – auf der Leinwand landet nur der Ausschnitt */
function gdZoom(img, zoom, fx, fy) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const sw = W / zoom, sh = H / zoom;
  const sx = Math.min(Math.max((fx / 100) * W - sw / 2, 0), W - sw);
  const sy = Math.min(Math.max((fy / 100) * H - sh / 2, 0), H - sh);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
  c.className = 'gd-scene-canvas';
  return c;
}

/* Verschwommenes Cover als Tipp: winzig gezeichnet, groß angezeigt. Anders als ein <img> mit
   CSS-Unschärfe lässt sich so per Rechtsklick nicht das scharfe Original öffnen. */
function gdBlurCanvas(src) {
  const c = h('canvas.gd-blur', { width: 9, height: 12, 'aria-hidden': 'true' });
  const img = new Image();
  img.referrerPolicy = 'no-referrer';
  img.onload = () => c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  img.src = src;
  return c;
}

function gdFmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(x => String(x).padStart(2, '0')).join(':');
}

/* Vorbefülltes GitHub-Issue mit allen Eigenschaften des Spiels (und dem Inhalt des Modus) */
function gdReportUrl(g, mode = 'classic') {
  const props = GD_COLUMNS.map(c => `- ${c.label}: ${c.key === 'year' ? g.year : c.fmt ? c.fmt(g[c.key]).replace(/­/g, '') : g[c.key]}`).join('\n');
  const extra = mode === 'quote' ? `\nZitat: ${GD_QUOTES[g.id]?.[0]} (${GD_QUOTES[g.id]?.[1]})\n`
    : mode === 'emoji' ? `\nEmojis: ${GD_EMOJI_HINTS[g.id]}\n`
      : mode === 'scene' ? `\nSzene: File:${GD_SCENES[g.id]?.[0]}\n` : '';
  const body = `Spiel: ${g.title}\nModus: ${GD_MODE_UI[mode]?.label || mode}\n\nAktuelle Daten:\n${props}\n${extra}\nWas ist falsch und wie wäre es richtig? (gern mit Quelle)\n`;
  return `${GD_ISSUES}?${new URLSearchParams({ title: `Daten: ${g.title}`, body })}`;
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
  const block = mode => {
    const s = stats[mode] || { won: 0, best: 0, total: 0, dist: {} };
    const buckets = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10+'];
    const max = Math.max(1, ...buckets.map(b => s.dist[b] || 0));
    return h('section.gd-stat-block',
      h('h3', GD_MODE_UI[mode].label),
      h('div.gd-stat-nums',
        h('div', h('strong', s.won), h('span', 'Gelöst')),
        h('div', h('strong', gdCurrentStreak(stats, mode, today)), h('span', 'Serie')),
        h('div', h('strong', s.best), h('span', 'Beste Serie')),
        h('div', h('strong', s.won ? (s.total / s.won).toFixed(1).replace('.', ',') : '–'), h('span', 'Ø Versuche'))),
      h('div.gd-dist', buckets.map(b => h('div.gd-dist-row', h('span', b),
        h('div.gd-bar', { style: { width: Math.max(4, ((s.dist[b] || 0) / max) * 100) + '%' } }, String(s.dist[b] || 0))))));
  };
  openModal({ title: 'Deine Statistik', width: 620, autofocus: false, body: h('div.gd-stats', GD_DAILY_MODES.map(block)) });
}

function gdHelpModal() {
  const legend = (cls, text) => h('div.gd-help-row', h('span.gd-cell.' + cls, GD_STATE_ICON[cls]), h('span', text));
  const cb = h('input', {
    type: 'checkbox', checked: !!Store.get('gd.colorblind'),
    onchange: e => { Store.set('gd.colorblind', e.target.checked); document.body.classList.toggle('gd-cb', e.target.checked); m.close(); gdHelpModal(); },
  });
  const cbOn = !!Store.get('gd.colorblind');
  const sub = text => h('h3', { style: { fontSize: '15px' } }, text);
  const [letterAfter, coverAfter] = GD_HINTS.classic.map(x => x[1]);
  const m = openModal({
    title: 'So funktioniert Gamedle', width: 540, autofocus: false,
    body: [
      h('p', `Jeden Tag warten ${GD_DAILY_MODES.length} neue Rätsel – für alle dieselben. Sie wechseln um Mitternacht (deutsche Zeit); darunter siehst du jeweils die Lösung von gestern.`),
      sub('Klassik'),
      h('p.help', 'Tipp ein beliebiges Spiel ein. Für jede Eigenschaft siehst du, wie nah du dran bist:'),
      legend('ok', `${cbOn ? 'Blau' : 'Grün'} ✓ – stimmt genau`),
      legend('partial', `${cbOn ? 'Orange' : 'Gelb'} ~ – teilweise (z. B. eines von mehreren Genres oder Plattformen)`),
      legend('no', `${cbOn ? 'Grau' : 'Rot'} ✕ – passt nicht`),
      h('p.help', '▲ / ▼ beim Jahr: Die Lösung ist neuer bzw. älter; die mittlere Farbe heißt höchstens drei Jahre daneben. „Plattform“ meint die Plattformen bei der Erstveröffentlichung.'),
      h('p.help', 'Entwickler & Publisher: Dasselbe Unternehmen unter anderem Namen zählt als richtig (z. B. Sony Computer Entertainment = Sony Interactive Entertainment), Studios einer Familie als teilweise (z. B. Rockstar North ~ Rockstar San Diego).'),
      h('p.help', `Nach ${letterAfter} Fehlversuchen gibt es den Anfangsbuchstaben als Tipp, nach ${coverAfter} ein verschwommenes Cover (bei Spielen ohne Cover das Erscheinungsjahr).`),
      h('label.switch-row',
        h('span', h('strong', 'Farbenblind-Modus'), h('br'), h('span.help', 'Blau / Orange / Grau statt Grün / Gelb / Rot.')),
        h('span.switch', cb, h('span'))),
      sub('Zitat'),
      h('p.help', 'Ein bekanntes Zitat aus dem Spiel – in der Originalsprache, meist Englisch. Nach Fehlversuchen gibt es nacheinander das Erscheinungsjahr, wer es sagt, und den Anfangsbuchstaben.'),
      sub('Emoji'),
      h('p.help', 'Fünf Emojis beschreiben das Spiel. Zu Beginn siehst du eins, jeder Fehlversuch deckt ein weiteres auf.'),
      sub('Cover'),
      h('p.help', 'Erkenne das Spiel am Cover. Es startet stark verpixelt und wird mit jedem Fehlversuch schärfer.'),
      sub('Szene'),
      h('p.help', 'Ein stark vergrößerter Ausschnitt aus einer Spielszene. Mit jedem Fehlversuch zoomt das Bild weiter heraus.'),
      sub('Endlos'),
      h('p.help', 'Zufällige Spiele im Klassik-Modus zum Üben – zählt nicht für die Statistik.'),
      h('p.help', `Im Spiele-Pool: ${GD.length} bekannte Spiele von 1980 bis heute. Daten geprüft mit Wikipedia, Zitate mit Wikiquote; Cover und Szenen kommen von Wikipedia.`),
    ],
  });
}
