/* ───────── Gamedle: Oberfläche ─────────
   Tagesmodi: Klassik (Eigenschaften vergleichen), Zitat, Emoji, Cover (verpixelt) und Szene
   (Bildausschnitt) – dazu Endlos zum Üben (zählt nicht). */
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
  duell: { label: 'Duell', title: 'Duell', sub: 'Zu zweit dasselbe Spiel raten – wer zuerst trifft, gewinnt die Runde.' },
};
const gdModeHash = mode => (mode === 'classic' ? '#/gamedar' : '#/gamedar/' + mode);

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
    // Szenen-Adressen verraten oft das Spiel – darum versiegelt gespeichert (ältere Fassung: Klartext, wird verworfen)
    const scenes = Store.get('gd.scenes');
    if (fresh(scenes) && scenes.v) this.scenes = gdUnseal(scenes.v, 'scenes');
    else if (scenes?.map) Store.del('gd.scenes');
    this.sealProgress();
    document.body.classList.toggle('gd-cb', !!Store.get('gd.colorblind'));
  },

  /* Ältere Spielstände enthalten die Lösung des Tages im Klartext → versiegeln */
  sealProgress() {
    const all = Store.get('gd.progress', {});
    let changed = false;
    for (const [date, modes] of Object.entries(all)) {
      for (const [mode, p] of Object.entries(modes)) {
        if (GD_BY_ID.has(p.answer)) { p.answer = gdSeal(p.answer, `${mode}:${date}`); changed = true; }
      }
    }
    if (changed) Store.set('gd.progress', all);
  },

  /* Wird vom Router aufgerufen; code nur beim Duell (Einladungslink #/gamedar/duell/CODE) */
  open(mode = 'classic', code = '') {
    this.mode = [...GD_DAILY_MODES, 'endless', 'duell'].includes(mode) ? mode : 'classic';
    this.date = gdToday();
    if (this.mode === 'duell') Duel.open(code);
    this.renderTabs();
    this.render();
    this.loadCovers();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 1000);
    if (!Store.get('gd.seenHelp')) { Store.set('gd.seenHelp', true); setTimeout(gdHelpModal, 300); }
  },

  close() { clearInterval(this.timer); }, // ein laufendes Duell geht im Hintergrund weiter

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
      Store.set('gd.scenes', { at: Date.now(), v: gdSeal(this.scenes, 'scenes') });
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
    // Die Lösung des Tages mitspeichern (falls sich Daten später ändern) – versiegelt, nicht im Klartext
    p.answer = gdSeal(this.answer().id, `${this.mode}:${this.date}`);
    const all = Store.get('gd.progress', {});
    // Nur die letzten 30 Tage aufheben
    for (const d of Object.keys(all)) if (gdDays(d, this.date) > 30) delete all[d];
    (all[this.date] ||= {})[this.mode] = p;
    Store.set('gd.progress', all);
  },
  /* Lösung eines Tages – wer schon angefangen hat, behält seine (auch wenn sich der Plan ändern sollte) */
  answerOf(mode, date) {
    const stored = Store.get('gd.progress', {})[date]?.[mode]?.answer;
    let id = null;
    try { id = stored && gdUnseal(stored, `${mode}:${date}`); } catch { /* unlesbar → Spielplan */ }
    return GD_BY_ID.get(id) || gdDaily(mode, date);
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
    }, GD_MODE_UI[mode].label, today[mode]?.done ? h('span.gd-done', ' ✓') : null,
    mode === 'duell' && Duel.session ? h('span.gd-live', { title: 'Duell läuft' }, ' ●') : null);
    $('#gdTabs').replaceChildren(...GD_DAILY_MODES.map(tab), tab('endless'), tab('duell'));
    $('#gdTabs [aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  },

  render() {
    this.renderTabs();
    if (this.mode === 'duell') { Duel.render(); return; }
    const main = $('#gdMain');
    const p = this.progress();
    const ans = this.answer();
    const no = gdDayNumber(this.date);
    const wrong = p.guesses.filter(id => id !== ans.id).length;
    const ui = GD_MODE_UI[this.mode];
    const table = this.mode === 'classic' || this.mode === 'endless';

    main.replaceChildren(h('div.gd-wrap',
      h('div.gd-head', h('h2', ui.title), h('p.muted', this.mode === 'endless' ? ui.sub : `Gamedar #${no} · ${ui.sub}`)),
      this.stage(ans, p, wrong),
      p.done ? this.resultCard(ans, p) : this.searchBox(p),
      p.done ? null : this.hintBar(ans, p, wrong),
      this.yesterday(no),
      table ? this.table(ans, p) : this.guessChips(ans, p),
    ));
    this.animateLast = false;
  },

  /* Hinweis des Modus – die Anzeige selbst übernehmen die gd…View-Funktionen unten (auch fürs Duell) */
  stage(ans, p, wrong) {
    const offline = navigator.onLine === false;
    if (this.mode === 'quote') return gdQuoteView(GD_QUOTES[ans.id]?.[0]);
    if (this.mode === 'emoji') {
      const list = (GD_EMOJI_HINTS[ans.id] || '').split(' ');
      return gdEmojiView(list.slice(0, p.done ? list.length : 1 + wrong), list.length, { fresh: this.animateLast && !p.done });
    }
    if (this.mode === 'cover') {
      const src = this.cover(ans);
      return gdCoverView({
        src, step: p.done ? GD_COVER_LEVELS.length : wrong,
        message: !src && (offline || this.coverError) ? 'Die Cover kommen von Wikipedia – die ist gerade nicht erreichbar. Prüf deine Internetverbindung oder spiel solange Klassik.' : '',
      });
    }
    if (this.mode === 'scene') {
      const src = this.scenes[ans.id];
      const down = !src && (offline || this.sceneError);
      if (!src && !down) this.loadScene(ans);
      const [, fx = 50, fy = 50] = GD_SCENES[ans.id] || [];
      return gdSceneView({
        src, step: p.done ? GD_SCENE_ZOOM.length : wrong, focus: [fx, fy],
        message: down ? 'Die Szenen kommen von Wikipedia – die ist gerade nicht erreichbar. Prüf deine Internetverbindung oder spiel solange Klassik.' : '',
      });
    }
    return null;
  },

  searchBox(p) {
    return gdSearchBox({ exclude: new Set(p.guesses), onPick: id => this.guess(id), count: p.guesses.length, cover: g => this.cover(g) });
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
    return h('div.gd-hints', control, hints.slice(0, used).map(([k]) => {
      const kind = kindOf(k);
      return gdHintBox(kind, kind === 'cover' ? this.cover(ans) : gdHintValue(kind, ans));
    }));
  },

  table(ans, p) {
    const rows = [...p.guesses].reverse().map(id => { const game = GD_BY_ID.get(id); return { game, cells: gdCompare(game, ans) }; });
    return gdGuessTable(rows, { animateFirst: this.animateLast, cover: g => this.cover(g) });
  },

  guessChips(ans, p) {
    return gdWrongChips(p.guesses.filter(id => id !== ans.id).reverse().map(id => GD_BY_ID.get(id)));
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
        h('span.gd-result-kicker', this.mode === 'endless' ? 'Richtig!' : `Gamedar #${gdDayNumber(this.date)} gelöst!`),
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

/* ───────── Anzeige-Bausteine ─────────
   Zeigen nur, was sie übergeben bekommen – sie schlagen keine Lösung nach. Das Tagesrätsel füttert sie
   aus den eigenen Daten, das Duell später mit dem, was der Schiedsrichter gerade freigibt. */

function gdQuoteView(text) {
  return h('figure.gd-quote',
    h('span.gd-quote-mark', { 'aria-hidden': 'true' }, '“'),
    h('blockquote', text || '…'));
}

/* Emojis: shown = schon aufgedeckte, der Rest bis total als „?“; fresh blendet das zuletzt aufgedeckte ein */
function gdEmojiView(shown, total, { fresh = false } = {}) {
  return h('div.gd-emoji', { role: 'img', 'aria-label': `${shown.length} von ${total} Emojis aufgedeckt: ${shown.join(' ')}` },
    Array.from({ length: total }, (_, i) => (i < shown.length
      ? h('span.gd-emoji-slot.on' + (fresh && i === shown.length - 1 ? '.new' : ''), shown[i])
      : h('span.gd-emoji-slot', '?'))));
}

/* Bild laden und über draw(img, stage) in die Bühne setzen – bis dahin Lade-, bei Fehler Problemhinweis */
function gdImageStage(cls, src, loading, failText, draw) {
  const stage = h('div.' + cls, h('div.gd-cover-msg.muted', loading));
  if (!src) return stage;
  const img = new Image();
  img.referrerPolicy = 'no-referrer';
  img.onload = () => draw(img, stage);
  img.onerror = () => stage.replaceChildren(h('div.gd-cover-msg', failText));
  img.src = src;
  return stage;
}

/* Cover: step = Zahl der Aufdeckungen (0 = gröbste Stufe, ab GD_COVER_LEVELS.length scharf);
   message ersetzt das Bild (z. B. Wikipedia nicht erreichbar) */
function gdCoverView({ src, step, message = '', failText = 'Das Cover konnte nicht geladen werden. Probier den Klassik-Modus.' }) {
  if (message) return h('div.gd-cover-stage', h('div.gd-cover-msg', message));
  const level = GD_COVER_LEVELS[step] || 0;
  return gdImageStage('gd-cover-stage', src, 'Cover wird geladen …', failText, (img, stage) => stage.replaceChildren(gdPixelate(img, level),
    h('span.gd-cover-level', level ? `Schärfe ${step + 1}/${GD_COVER_LEVELS.length + 1}` : 'Volle Schärfe')));
}

/* Szene: stark vergrößerter Ausschnitt um focus (Prozent), der mit jedem step weiter herauszoomt.
   precut: Das Bild ist schon der fertige Ausschnitt (Duell – der Schiedsrichter gibt nie das ganze Bild heraus) */
function gdSceneView({ src, step, focus = [50, 50], precut = false, message = '', failText = 'Die Szene konnte nicht geladen werden. Probier es gleich noch einmal.' }) {
  if (message) return h('div.gd-scene-stage', h('div.gd-cover-msg', message));
  step = Math.min(step, GD_SCENE_ZOOM.length);
  const zoom = GD_SCENE_ZOOM[step] || 1;
  return gdImageStage('gd-scene-stage', src, 'Szene wird geladen …', failText, (img, stage) => {
    stage.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
    stage.replaceChildren(gdZoom(img, precut ? 1 : zoom, ...focus),
      h('span.gd-cover-level', zoom > 1 ? `Ausschnitt ${step + 1}/${GD_SCENE_ZOOM.length + 1}` : 'Ganzes Bild'));
  });
}

/* Ein aufgedeckter Tipp; value wie von gdHintValue (beim Cover: Adresse des Bildes) */
function gdHintBox(kind, value) {
  if (kind === 'letter') {
    return h('div.gd-hint-box', 'Anfangsbuchstabe: ', h('strong', value.letter), value.skipped ? h('span.muted', ` (ohne „${value.skipped}“)`) : null);
  }
  if (kind === 'year') return h('div.gd-hint-box', 'Erscheinungsjahr: ', h('strong', value));
  if (kind === 'speaker') return h('div.gd-hint-box', 'Gesagt von: ', h('strong', value));
  return h('div.gd-hint-box', 'Verschwommenes Cover:', value ? gdBlurCanvas(value) : h('span.muted', ' (wird geladen …)'));
}

/* Klassik-Tabelle: rows = [{ game, cells }], neuester Tipp zuerst; cells wie von gdCompare */
function gdGuessTable(rows, { animateFirst = false, cover = () => '' } = {}) {
  if (!rows.length) return h('p.gd-empty.muted', 'Noch kein Versuch. Tipp los – jedes Spiel verrät etwas über die Lösung.');
  const head = h('div.gd-row.gd-headrow', h('div.gd-cell.gd-name', 'Spiel'), GD_COLUMNS.map(c => h('div.gd-cell.head', { title: c.title || c.label }, c.label)));
  const body = rows.map(({ game: g, cells }, idx) => {
    const src = cover(g);
    return h('div.gd-row' + (animateFirst && idx === 0 ? '.anim' : ''),
      h('div.gd-cell.gd-name', src ? h('img', { src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null, h('span', g.title)),
      cells.map((c, i) => {
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
  return h('div.gd-table-wrap', h('div.gd-table', { role: 'table', 'aria-label': 'Deine Versuche' }, head, body), h('p.gd-legend.muted',
    h('i.sw.ok', '✓'), 'richtig ', h('i.sw.partial', '~'), 'teilweise ', h('i.sw.no', '✕'), 'falsch · ▲▼ Lösung ist neuer/älter (gelb: höchstens 3 Jahre)'));
}

/* Falsche Tipps der Zusatz-Modi (neueste zuerst) */
function gdWrongChips(games) {
  return games.length ? h('div.gd-chips', games.map(g => h('span.gd-chip', '✕ ', g.title))) : null;
}

/* Suchfeld mit Vorschlägen: exclude = schon geratene IDs, onPick(id) bei Auswahl, count = bisherige Versuche */
function gdSearchBox({ exclude = new Set(), onPick, count = 0, cover = () => '' }) {
  const input = h('input.gd-input', { type: 'search', placeholder: 'Spiel eintippen …', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Spiel raten' });
  const list = h('div.gd-suggest', { role: 'listbox', hidden: true });
  let items = [], active = 0;
  const draw = () => {
    // Kein Treffer: erklären statt stumm bleiben
    const noHit = !items.length && gdNorm(input.value).length >= 2;
    list.hidden = !items.length && !noHit;
    if (noHit) {
      const already = gdSearch(input.value, new Set(), 1)[0];
      list.replaceChildren(h('div.gd-sug-empty', already && exclude.has(already.id)
        ? `„${already.title}“ hast du schon geraten.`
        : `Kein Treffer im Spiele-Pool (${GD.length} bekannte Spiele). Probier den Originaltitel oder eine Abkürzung.`));
      return;
    }
    list.replaceChildren(...items.map((g, i) => {
      const src = cover(g);
      return h('button.gd-sug' + (i === active ? '.active' : ''), { type: 'button', role: 'option', onmousedown: e => e.preventDefault(), onclick: () => pick(g) },
        src ? h('img', { src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span.gd-sug-ph', g.title.slice(0, 1)),
        h('span', h('strong', g.title), h('small', ` ${g.year}`)));
    }));
  };
  const pick = g => { input.value = ''; items = []; draw(); onPick(g.id); setTimeout(() => $('.gd-input')?.focus(), 30); };
  input.addEventListener('input', () => { items = gdSearch(input.value, exclude); active = 0; draw(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && items[active]) { e.preventDefault(); pick(items[active]); }
    else if (e.key === 'Escape') { items = []; draw(); }
  });
  input.addEventListener('blur', () => setTimeout(() => { items = []; draw(); }, 150));
  if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => input.focus({ preventScroll: true }), 50);
  return h('div.gd-search', icon('search'), input, list,
    h('span.gd-count', count ? `${count} ${count === 1 ? 'Versuch' : 'Versuche'}` : ''));
}

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
  // Duelle: nur die Eckdaten – Bilanz und Bestenliste stehen im Duell-Tab
  const duels = Store.get('gd.duels', []);
  const st = duels.length ? duelStats(duels, App.me) : null;
  const duelBlock = st && h('section.gd-stat-block',
    h('h3', 'Duelle'),
    h('div.gd-stat-nums',
      h('div', h('strong', st.duels), h('span', 'Gespielt')),
      h('div', h('strong', st.wins), h('span', 'Siege')),
      h('div', h('strong', st.monthPoints), h('span', 'Punkte im Monat')),
      h('div', h('strong', st.bestPoints || '–'), h('span', 'Bestes Duell'))),
    h('a.linkish', { href: gdModeHash('duell'), onclick: () => closeAllModals() }, 'Bilanz und Bestenliste ansehen →'));
  openModal({ title: 'Deine Statistik', width: 620, autofocus: false, body: h('div.gd-stats', GD_DAILY_MODES.map(block), duelBlock) });
}

function gdHelpModal(section = '') {
  const legend = (cls, text) => h('div.gd-help-row', h('span.gd-cell.' + cls, GD_STATE_ICON[cls]), h('span', text));
  const cb = h('input', {
    type: 'checkbox', checked: !!Store.get('gd.colorblind'),
    onchange: e => { Store.set('gd.colorblind', e.target.checked); document.body.classList.toggle('gd-cb', e.target.checked); m.close(); gdHelpModal(); },
  });
  const cbOn = !!Store.get('gd.colorblind');
  const sub = text => h('h3', { style: { fontSize: '15px' } }, text);
  const [letterAfter, coverAfter] = GD_HINTS.classic.map(x => x[1]);
  const m = openModal({
    title: 'So funktioniert Gamedar', width: 540, autofocus: false,
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
      h('h3#gdHelpDuel', { style: { fontSize: '15px' } }, 'Duell'),
      h('p.help', `Zu zweit gegeneinander: Beide raten gleichzeitig dasselbe Spiel, wer zuerst trifft, gewinnt die Runde. Statt nach Fehlversuchen werden die Hinweise alle ${DUEL_STEP_MS / 1000} Sekunden deutlicher; nach einem falschen Tipp ist das Raten ${DUEL_LOCK_MS / 1000} Sekunden gesperrt.`),
      h('p.help', `Punkte-Duell: ${DUEL_POINT_ROUNDS} Runden, jeder Modus einmal – ein sofortiger Treffer bringt ${DUEL_POINTS[0].toLocaleString('de-DE')} Punkte, nach ${DUEL_ROUND_MS / 1000} Sekunden nur noch ${DUEL_POINTS[1]}. Best-of (${DUEL_BEST_OF.join(', ')} Runden): Wer zuerst die Mehrheit der Runden gewinnt.`),
      h('p.help', 'Erstelle ein Duell und schick deinem Gegner Code oder Link – ihr braucht zwei Geräte oder zwei verschiedene Browser. Die Tagesrätsel der nächsten Tage kommen im Duell nicht dran. Deine Bilanz gegen Freunde wird nur in deinem Browser gespeichert.'),
      h('p.help', `Im Spiele-Pool: ${GD.length} bekannte Spiele von 1980 bis heute. Daten geprüft mit Wikipedia, Zitate mit Wikiquote; Cover und Szenen kommen von Wikipedia.`),
    ],
  });
  if (section === 'duell') setTimeout(() => $('#gdHelpDuel')?.scrollIntoView({ block: 'start' }), 50);
}
