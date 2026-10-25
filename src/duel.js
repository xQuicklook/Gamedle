/* ───────── Gamedar-Duell: Oberfläche ─────────
   Bildschirme: Lobby (Profil, Variante, erstellen/beitreten) → Warten (Code teilen) → Bereit (beide da)
   → Runde (Countdown, Raten, Auflösung) → Ergebnis (Revanche). Die Daten kommen aus der Sitzung
   (duel-net.js): current() liefert die Ansicht, image(key) die vorbereiteten Bilder.
   Teile der Seite werden nur neu gezeichnet, wenn sich ihr Inhalt ändert – so bleibt die Eingabe im Suchfeld
   erhalten. Uhr, Countdown und Sperre laufen in einer eigenen Schleife (tickLive). */

const DUEL_MODE_LABEL = { mixed: 'Gemischt', classic: 'Klassik', quote: 'Zitat', emoji: 'Emoji', cover: 'Cover', scene: 'Szene' };
const DUEL_WHY = {
  locked: 'Kurz gesperrt – nach einem Fehlversuch 2 Sekunden warten.',
  dup: 'Das Spiel hast du schon geraten.',
  over: 'Die Runde ist schon entschieden.',
  early: 'Die Runde hat noch nicht begonnen.',
  invalid: 'Unbekanntes Spiel.',
};
const DUEL_REASON = { points: 'nach Punkten', time: 'bei Punktgleichstand schneller getroffen', limit: 'nach der Höchstzahl an Runden', forfeit: 'durch Aufgabe' };
const duelSeconds = ms => (ms / 1000).toFixed(1).replace('.', ',') + ' s';
const duelClock = ms => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const duelDate = at => new Date(at).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', timeZone: GD_TZ });

const Duel = {
  session: null,
  error: '',
  code: '',             // Code im Beitreten-Feld (auch aus dem Einladungslink)
  online: true,         // Gegner verbunden?
  rematchFrom: null,    // Host: Gast möchte eine Revanche
  rematchAsked: false,  // Gast: Revanche angefragt
  notice: '',           // kurze Meldung, z. B. abgewiesener Tipp
  noticeTimer: null,
  screen: '', keys: {}, slots: {}, live: {}, loop: 0,
  guessed: new Set(),   // eigene Tipps der Runde – das Suchfeld schlägt sie nicht mehr vor
  seen: '',             // zuletzt gesehene Runde/Phase (für Konfetti beim eigenen Treffer)
  recorded: false,      // beendetes Duell schon in der Historie?
  rows: 0,

  settings() { return { kind: 'points', bestOf: 3, mode: 'mixed', ...Store.get('gd.duel', {}) }; },
  saveSettings(patch) { Store.set('gd.duel', { ...this.settings(), ...patch }); },
  me() { return { id: App.me.id, name: App.me.name, color: App.me.color }; },

  /* Vom Router: #/gamedar/duell[/CODE] */
  open(code = '') {
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (!code) return;
    if (this.session) {
      if (code !== this.session.code) this.switchTo(code); // eine andere Einladung, während ein Duell läuft
      return;
    }
    this.code = code;
    // Einladung angeklickt und Name schon bekannt → gleich beitreten (auch nach Neuladen: derselbe Spieler darf zurück)
    if (App.me.name) this.join(code);
  },

  async switchTo(code) {
    const back = '#/gamedar/duell' + (this.session.role === 'guest' ? '/' + this.session.code : '');
    const ok = await confirmDialog('Anderem Duell beitreten?',
      `Du bist gerade in einem Duell. Trittst du dem Duell ${code} bei, verlässt du es – ein laufendes Duell zählt dann als verloren.`, 'Beitreten', true);
    if (!ok) { history.replaceState(null, '', back); return; }
    this.session?.leave();
    this.end();
    this.join(code);
  },

  needName() {
    if (App.me.name) return true;
    this.error = 'Gib zuerst deinen Namen ein.';
    this.render();
    $('#duelName')?.focus();
    return false;
  },

  create() {
    if (!this.needName()) return;
    const s = this.settings();
    const settings = s.kind === 'points' ? { kind: 'points' } : { kind: 'bestof', bestOf: s.bestOf, mode: s.mode };
    this.begin(duelHostSession({ settings, me: this.me(), handlers: this.handlers() }));
    checkIce().then(() => this.render()); // Warnhinweis, falls der Gegner gar nicht beitreten könnte
  },

  join(code) {
    if (!this.needName()) return;
    if (!/^[A-Z0-9]{6}$/.test(code)) { this.error = 'Der Code hat sechs Zeichen.'; this.render(); return; }
    this.code = code;
    this.begin(duelGuestSession({ code, me: this.me(), handlers: this.handlers() }));
    history.replaceState(null, '', '#/gamedar/duell/' + code); // Neuladen tritt wieder bei
  },

  begin(session) {
    Object.assign(this, { session, error: '', online: true, rematchFrom: null, rematchAsked: false, notice: '', seen: '', recorded: false });
    this.guessed.clear();
    Gamedle.renderTabs();
    this.render();
  },

  end() {
    this.session?.close();
    this.session = null;
    history.replaceState(null, '', '#/gamedar/duell');
    Gamedle.renderTabs();
  },

  handlers() {
    return {
      change: () => this.changed(),
      opponent: (p, online) => { this.online = online; this.render(); },
      status: state => {
        if (state === 'lost' || state === 'ended') this.online = false;
        if (state === 'online') this.online = true;
        this.render();
      },
      error: text => this.fail(text),
      result: msg => this.rejected(msg.id, msg.why),
      rematch: p => { this.rematchFrom = p; this.render(); },
    };
  },

  /* Verbindungsfehler: Nach Duell-Ende das Ergebnis stehen lassen, sonst zurück in die Lobby */
  fail(text) {
    if (this.session?.current()?.phase === 'over') { this.online = false; this.render(); return; }
    this.end();
    this.error = text;
    this.render();
  },

  changed() {
    const v = this.session?.current();
    if (v && v.phase !== 'over') { this.rematchFrom = null; this.rematchAsked = false; this.recorded = false; }
    if (v?.phase === 'over' && !this.recorded && this.session.opponent) {
      this.recorded = true;
      Store.set('gd.duels', duelAddRecord(Store.get('gd.duels', []), duelRecord(v, this.me(), this.session.opponent, Date.now())));
    }
    // Runde getroffen bzw. Duell gewonnen → Konfetti (einmal, direkt nach der Runde)
    const seen = v ? `${v.n}.${v.attempt}:${v.phase}` : '';
    const won = v?.phase === 'over' ? v.over?.winner : v?.last?.winner;
    if (v && seen !== this.seen && (v.phase === 'break' || v.phase === 'over') && won === this.session.me.id && this.seen.endsWith(':play')) gdCelebrate();
    this.seen = seen;
    this.render();
  },

  say(text) {
    this.notice = text;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => { this.notice = ''; this.render(); }, 2500);
    this.render();
  },

  guess(id) {
    const v = this.session?.current();
    if (v?.phase !== 'play') return;
    if (v.me.lockedFor > 0) { this.say(DUEL_WHY.locked); return; }
    this.guessed.add(id); // sofort aus den Vorschlägen nehmen
    const r = this.session.guess(id); // Host: Antwort sofort, Gast: abgewiesene Tipps kommen als Nachricht
    if (r && !r.ok) this.rejected(id, r.why);
  },

  /* Abgewiesener Tipp: zählt nicht – das Spiel darf (außer bei „schon geraten“) wieder vorgeschlagen werden */
  rejected(id, why) {
    if (why !== 'dup') this.guessed.delete(id);
    this.say(DUEL_WHY[why] || '');
  },

  async leave() {
    const v = this.session?.current();
    const running = v && v.phase !== 'over' && v.phase !== 'lobby';
    if (running && !(await confirmDialog('Duell aufgeben?', 'Wer ein laufendes Duell verlässt, verliert es.', 'Aufgeben', true))) return;
    this.session?.leave();
    this.end();
    this.render();
  },

  rematch() {
    this.session.rematch();
    if (this.session.role === 'guest') this.rematchAsked = true;
    this.rematchFrom = null;
    this.render();
  },

  /* ── Zeichnen ── */
  render() {
    const main = $('#gdMain');
    if (!main || Gamedle.mode !== 'duell' || $('#gamedle').hidden) return;
    const v = this.session?.current() || null;
    const screen = !this.session ? 'lobby' : !v ? 'waiting' : v.phase === 'lobby' ? 'ready' : v.phase === 'over' ? 'over' : 'match';
    const id = screen === 'match' ? `match:${v.n}.${v.attempt}` : screen;
    if (this.screen !== id || !main.querySelector('.duel')) {
      this.screen = id;
      this.keys = {};
      this.live = {};
      this.rows = 0;
      if (screen === 'match') { this.guessed.clear(); v.me.guesses.forEach(g => this.guessed.add(g)); }
      const names = screen === 'match' ? ['bar', 'timer', 'stage', 'hints', 'search', 'status', 'guesses', 'foot'] : ['body'];
      this.slots = Object.fromEntries(names.map(n => [n, h('div.duel-' + n)]));
      // Screenreader: neue Hinweise, Countdown, Auflösung und Meldungen ansagen
      if (screen === 'match') {
        this.slots.stage.setAttribute('aria-live', 'polite');
        this.slots.status.setAttribute('role', 'status');
      } else this.slots.body.setAttribute('aria-live', 'polite');
      main.replaceChildren(h('div.gd-wrap.duel', Object.values(this.slots)));
    }
    if (screen === 'lobby') this.paint('body', [this.error, this.code, this.settings(), Store.get('gd.duels', []).length, Store.get('gd.duels', [])[0]?.at], () => this.lobbyView());
    else if (screen === 'waiting') this.paint('body', [this.session.role, this.session.code, this.error, hostIceWarning()], () => this.waitingView());
    else if (screen === 'ready') this.paint('body', [this.session.opponent, this.online, this.session.client?.settings], () => this.readyView(v));
    else if (screen === 'over') this.paint('body', [v.over, v.rounds, this.online, this.rematchFrom, this.rematchAsked, this.recorded], () => this.overView(v));
    else this.matchView(v);
    this.tickLive();
    if (screen === 'match') this.startLoop(); // nur dort läuft eine Uhr
  },

  /* Teil neu zeichnen, wenn sich sein Inhalt (key) geändert hat */
  paint(slot, key, build) {
    key = JSON.stringify(key);
    if (this.keys[slot] === key) return;
    this.keys[slot] = key;
    this.slots[slot].replaceChildren(...[build()].flat().filter(Boolean));
  },

  head(sub, extra = null) {
    return h('div.gd-head', h('h2', 'Duell'), h('p.muted', sub, extra ? ' ' : null, extra));
  },

  lobbyView() {
    const s = this.settings();
    const name = h('input#duelName', {
      value: App.me.name || '', maxlength: 20, placeholder: 'z. B. Alex', autocomplete: 'nickname',
      oninput: e => { App.me.name = e.target.value.trim(); Store.set('me', App.me); },
    });
    const colors = h('div.color-pick', { role: 'radiogroup', 'aria-label': 'Spielerfarbe' }, PLAYER_COLORS.map(c => h('button.color-dot', {
      type: 'button', role: 'radio', 'aria-checked': String(c === App.me.color), 'aria-label': 'Farbe ' + c, style: { background: c },
      onclick: e => {
        App.me.color = c;
        Store.set('me', App.me);
        colors.querySelectorAll('.color-dot').forEach(d => d.setAttribute('aria-checked', String(d === e.currentTarget)));
      },
    })));
    const kind = (k, title, text) => h('button.duel-kind' + (s.kind === k ? '.on' : ''), {
      type: 'button', 'aria-pressed': String(s.kind === k), onclick: () => { this.saveSettings({ kind: k }); this.render(); },
    }, h('strong', title), h('span', text));
    const code = h('input', {
      value: this.code, maxlength: 6, placeholder: 'CODE', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Duell-Code',
      oninput: e => { this.code = e.target.value.toUpperCase(); },
    });
    return [
      this.head('Zu zweit dasselbe Spiel raten – wer zuerst trifft, gewinnt die Runde.',
        h('button.linkish', { type: 'button', onclick: () => gdHelpModal('duell') }, 'Regeln')),
      h('div.duel-card',
        this.error ? h('p.duel-error', { role: 'alert' }, this.error,
          Object.values(JOIN_HELP).includes(this.error) ? [' ', h('button.linkish', { type: 'button', onclick: () => diagModal() }, 'Verbindung testen')] : null) : null,
        h('label.field', h('span', 'Dein Name'), name),
        h('div.field', h('span', 'Deine Farbe'), colors),
        h('div.duel-kinds',
          kind('points', 'Punkte-Duell', '5 Runden, jeder Modus einmal. Je schneller du triffst, desto mehr Punkte.'),
          kind('bestof', 'Best-of', 'Wer zuerst die Mehrheit der Runden gewinnt.')),
        s.kind === 'bestof' ? h('div.duel-opts',
          h('select', { 'aria-label': 'Anzahl Runden', onchange: e => this.saveSettings({ bestOf: +e.target.value }) },
            DUEL_BEST_OF.map(n => h('option', { value: String(n), selected: n === s.bestOf }, `Best of ${n}`))),
          h('select', { 'aria-label': 'Modus', onchange: e => this.saveSettings({ mode: e.target.value }) },
            Object.entries(DUEL_MODE_LABEL).map(([k, l]) => h('option', { value: k, selected: k === s.mode }, l)))) : null,
        h('button.btn.primary.lg.block', { type: 'button', onclick: () => this.create() }, 'Duell erstellen'),
        h('div.divider', h('span', 'oder einem Duell beitreten')),
        h('form.join-row', { onsubmit: e => { e.preventDefault(); this.join(code.value.trim().toUpperCase()); } },
          code, h('button.btn', { type: 'submit' }, 'Beitreten'))),
      this.historyView(),
    ];
  },

  /* ── Eigene Historie: Kennzahlen, Bilanz gegen Freunde, Bestenliste, letzte Duelle ── */
  historyView() {
    const list = Store.get('gd.duels', []);
    if (!list.length) return null;
    const st = duelStats(list, this.me());
    const tile = (value, label) => h('div', h('strong', String(value)), h('span', label));
    const result = { win: 'Sieg', loss: 'Niederlage', draw: 'Unentschieden' };
    return h('section.duel-history',
      h('h3', 'Deine Duelle'),
      h('div.gd-stat-nums.duel-tiles',
        tile(st.duels, 'Duelle'),
        tile(st.wins, 'Siege'),
        tile(`${Math.round((100 * st.wins) / st.duels)} %`, 'Siegquote'),
        tile(st.monthPoints, 'Punkte im Monat')),
      st.opponents.length ? h('div.duel-list',
        h('h4', 'Bilanz gegen deine Freunde'),
        st.opponents.map(o => h('div.duel-list-row',
          this.chip(o),
          h('strong', `${o.wins} : ${o.losses}`),
          h('span.muted', [o.draws ? `${o.draws}× unentschieden · ` : '', duelDate(o.last)].join(''))))) : null,
      st.best.length ? h('div.duel-list',
        h('h4', 'Bestenliste der Punkte-Duelle'),
        h('p.muted.small', 'Die besten Ergebnisse aus Duellen mit dir. Eine Rangliste für alle gibt es erst mit einem Server.'),
        st.best.map((b, i) => h('div.duel-list-row' + (b.id === App.me.id ? '.me' : ''),
          h('span.duel-rank', `${i + 1}.`), this.chip(b), h('strong', `${b.points} Punkte`), h('span.muted', duelDate(b.at))))) : null,
      h('div.duel-list',
        h('h4', 'Letzte Duelle'),
        list.slice(0, 10).map(e => h('div.duel-list-row.recent',
          h('span.duel-badge.' + e.result, result[e.result]),
          h('span.duel-who', 'gegen ', h('strong', e.opp.name), h('small.muted', e.kind === 'points' ? 'Punkte-Duell' : `Best of ${e.bestOf}`)),
          h('span.duel-end', h('strong', `${e.score[0]} : ${e.score[1]}`), h('small.muted', duelDate(e.at)))))),
      h('button.linkish.duel-quit', { type: 'button', onclick: () => this.clearHistory() }, 'Verlauf löschen'));
  },

  async clearHistory() {
    if (!(await confirmDialog('Verlauf löschen?', 'Alle gespeicherten Duelle und die Bilanz gegen deine Freunde werden aus diesem Browser gelöscht.', 'Löschen', true))) return;
    Store.del('gd.duels');
    this.render();
  },

  settingsText(settings) {
    if (!settings) return '';
    return settings.kind === 'points' ? 'Punkte-Duell · 5 Runden, jeder Modus einmal' : `Best of ${settings.bestOf} · ${DUEL_MODE_LABEL[settings.mode] || 'Gemischt'}`;
  },

  waitingView() {
    const s = this.session;
    if (s.role === 'guest') {
      return [this.head(`Verbinde mit Duell ${s.code} …`),
        h('div.duel-card.center', h('p.muted', 'Gleich geht es los.'), h('button.btn.ghost', { type: 'button', onclick: () => this.leave() }, 'Abbrechen'))];
    }
    const link = `${GD_URL()}#/gamedar/duell/${s.code || ''}`;
    const warning = hostIceWarning();
    return [
      this.head('Warte auf deinen Gegner'),
      h('div.duel-card.center',
        warning ? h('p.duel-error', { role: 'alert' }, warning, ' ', h('button.linkish', { type: 'button', onclick: () => diagModal() }, 'Verbindung testen')) : null,
        h('p.muted', 'Schick ihm diesen Code oder den Link:'),
        h('div.duel-code', s.code || '······'),
        h('div.duel-actions',
          // Am Handy direkt ins Teilen-Menü (WhatsApp, Signal …)
          navigator.share ? h('button.btn.primary', {
            type: 'button', disabled: !s.code,
            onclick: () => navigator.share({ title: 'Gamedar-Duell', text: `Duell bei Gamedar? Code ${s.code}`, url: link }).catch(() => {}),
          }, icon('upload'), 'Einladung teilen') : null,
          h('button.btn', { type: 'button', disabled: !s.code, onclick: () => copyText(s.code, 'Code kopiert') }, icon('copy'), 'Code kopieren'),
          h('button.btn', { type: 'button', disabled: !s.code, onclick: () => copyText(link, 'Einladungslink kopiert') }, icon('link'), 'Link kopieren')),
        h('p.muted.small', this.settingsText(s.room.settings)),
        h('button.btn.ghost', { type: 'button', onclick: () => this.leave() }, 'Abbrechen')),
    ];
  },

  readyView() {
    const s = this.session, opp = s.opponent;
    const settings = s.role === 'host' ? s.room.settings : s.client.settings;
    return [
      this.head(this.settingsText(settings)),
      h('div.duel-card.center',
        h('div.duel-versus', this.chip(s.me), h('span.muted', 'gegen'), this.chip(opp)),
        !this.online ? h('p.duel-error', `Die Verbindung zu ${opp?.name || 'deinem Gegner'} ist unterbrochen …`) : null,
        s.role === 'host'
          ? h('button.btn.primary.lg', { type: 'button', disabled: !this.online, onclick: () => s.start() }, 'Duell starten')
          : h('p.muted', `${opp?.name || 'Dein Gegner'} startet das Duell gleich …`),
        h('button.btn.ghost', { type: 'button', onclick: () => this.leave() }, 'Verlassen')),
    ];
  },

  chip(p) {
    return h('span.duel-chip', this.dot(p), p?.name || '…');
  },

  /* Farbpunkt des Spielers */
  dot(p) {
    return h('span.duel-dot', { style: { background: p?.color || '#8b8f9c' } });
  },

  matchView(v) {
    const s = this.session, me = s.me, opp = s.opponent;
    const player = (p, mine) => h('div.duel-player' + (mine ? '.me' : ''), { style: mine ? { borderColor: p?.color } : null },
      this.dot(p), h('span.duel-name', p?.name || '…'), h('strong.duel-score', String(v.score[p?.id] ?? 0)));
    this.paint('bar', [v.score, v.n, v.roundMode, opp], () => [
      player(me, true),
      h('div.duel-round', h('strong', v.kind === 'points' ? `Runde ${v.n} von ${v.total}` : `Best of ${v.bestOf} · Runde ${v.n}`), h('span.muted', DUEL_MODE_LABEL[v.roundMode])),
      player(opp, false),
    ]);
    this.paint('timer', [v.phase], () => {
      this.live.bar = h('i');
      this.live.track = h('div.duel-track', { role: 'progressbar', 'aria-label': 'Verbleibende Zeit in Sekunden', 'aria-valuemin': '0', 'aria-valuemax': String(DUEL_ROUND_MS / 1000) }, this.live.bar);
      this.live.time = h('span.duel-time', { 'aria-hidden': 'true' });
      this.live.worth = h('span.duel-worth');
      return [this.live.track, h('div.duel-clock', this.live.time, this.live.worth)];
    });
    this.paint('stage', this.stageKey(v), () => this.stageView(v));
    this.paint('hints', [v.phase, v.clue?.hints, this.hintBlur(v)], () => (v.phase === 'play'
      ? h('div.gd-hints', v.clue.hints.map(x => gdHintBox(x.kind, x.kind === 'cover' ? this.hintBlur(v) : x.value))) : null));
    this.paint('search', [v.phase], () => {
      if (v.phase !== 'play') return null;
      const box = gdSearchBox({ exclude: this.guessed, onPick: id => this.guess(id), cover: g => Gamedle.cover(g) });
      this.live.input = box.querySelector('input');
      return box;
    });
    this.paint('status', [v.phase, v.me.guesses.length, v.opp.attempts, this.notice, this.online, opp?.name], () => {
      this.live.lock = h('span.duel-lock', { hidden: true });
      return h('p.duel-status',
        v.phase === 'play' ? `Deine Versuche: ${v.me.guesses.length} · ${opp?.name || 'Gegner'}: ${v.opp.attempts}` : '',
        this.live.lock,
        this.notice ? h('span.duel-notice', this.notice) : null,
        !this.online ? h('span.duel-error', `Verbindung zu ${opp?.name || 'deinem Gegner'} unterbrochen – das Duell wartet bis zu 15 Sekunden.`) : null);
    });
    this.paint('guesses', [v.phase, v.me.guesses, v.answer], () => {
      if (v.roundMode === 'classic' && v.me.rows) {
        const rows = [...v.me.rows].reverse().map(r => ({ game: GD_BY_ID.get(r.id), cells: r.cells }));
        const fresh = rows.length > this.rows;
        this.rows = rows.length;
        return rows.length ? gdGuessTable(rows, { animateFirst: fresh, cover: g => Gamedle.cover(g) }) : null;
      }
      return gdWrongChips(v.me.guesses.filter(id => id !== v.answer).reverse().map(id => GD_BY_ID.get(id)));
    });
    this.paint('foot', [v.phase], () => h('button.linkish.duel-quit', { type: 'button', onclick: () => this.leave() }, 'Duell aufgeben'));
  },

  /* Bild einer Stufe – fehlt das neueste noch, das letzte vorhandene zeigen statt „lädt …“ */
  stageImage(v) {
    const img = v.clue?.image;
    if (!img) return null;
    for (let step = img.step; step >= 0; step--) {
      const src = this.session.image(duelMediaKey(v, img.kind, step));
      if (src) return { src, step: Math.min(step, img.step) };
    }
    return { src: '', step: img.step };
  },

  hintBlur(v) {
    return v.clue?.hints.some(x => x.kind === 'cover') ? this.session.image(duelMediaKey(v, 'blur', 0)) || '' : '';
  },

  stageKey(v) {
    if (v.phase === 'countdown') return ['countdown', v.n, v.attempt];
    if (v.phase === 'break') return ['break', v.n, v.last, this.session.image(duelMediaKey(v, 'cover', DUEL_ALL)) ? 1 : 0];
    const img = this.stageImage(v);
    return ['play', v.roundMode, v.clue?.quote, v.clue?.emoji?.shown.length, img?.step, img?.src.length];
  },

  stageView(v) {
    if (v.phase === 'countdown') {
      this.live.count = h('strong.duel-count');
      return h('div.duel-countdown', h('span.muted', `Runde ${v.n} · ${DUEL_MODE_LABEL[v.roundMode]}`), this.live.count, h('span.muted', 'Mach dich bereit …'));
    }
    if (v.phase === 'break') return this.roundCard(v);
    const c = v.clue;
    if (v.roundMode === 'quote') return gdQuoteView(c.quote);
    if (v.roundMode === 'emoji') return gdEmojiView(c.emoji.shown, c.emoji.total, { fresh: c.emoji.shown.length > 1 });
    const img = this.stageImage(v);
    if (v.roundMode === 'cover') return gdCoverView({ src: img.src, step: img.step, failText: 'Das Bild konnte nicht angezeigt werden.' });
    if (v.roundMode === 'scene') return gdSceneView({ src: img.src, step: img.step, precut: true, failText: 'Das Bild konnte nicht angezeigt werden.' });
    return h('p.gd-empty.muted', 'Klassik: Jeder Tipp verrät dir, welche Eigenschaften passen. Nach 48 s gibt es den Anfangsbuchstaben.');
  },

  /* Auflösung zwischen zwei Runden */
  roundCard(v) {
    const s = this.session, last = v.last, answer = GD_BY_ID.get(v.answer);
    const won = last?.winner === s.me.id;
    const title = !last?.winner ? 'Keiner hat es erraten' : won ? 'Du warst schneller!' : `${s.opponent?.name || 'Dein Gegner'} war schneller`;
    const src = Gamedle.cover(answer) || s.image(duelMediaKey(v, 'cover', DUEL_ALL));
    this.live.next = h('p.gd-next.muted');
    return h('div.gd-result.duel-result' + (won ? '' : '.other'),
      src ? h('img.gd-result-cover', { src, alt: '', referrerpolicy: 'no-referrer' }) : null,
      h('div.gd-result-body',
        h('span.gd-result-kicker', title),
        h('h3', answer.title),
        h('p.muted', `${answer.year} · ${answer.dev}`),
        last?.winner ? h('p', `Getroffen nach ${duelSeconds(last.ms)}${v.kind === 'points' ? ` · +${last.points} Punkte` : ''}`) : null,
        this.live.next));
  },

  overView(v) {
    const s = this.session, me = s.me, opp = s.opponent, o = v.over;
    const title = !o.winner ? 'Unentschieden' : o.winner === me.id ? 'Gewonnen!' : `${opp?.name || 'Dein Gegner'} hat gewonnen`;
    const name = id => (id === me.id ? me.name : id ? opp?.name || 'Gegner' : '–');
    const unit = v.kind === 'points' ? 'Punkte' : 'Runden';
    const h2h = opp && duelStats(Store.get('gd.duels', []), me).opponents.find(x => x.id === opp.id);
    const rematch = s.role === 'host'
      ? h('button.btn.primary', { type: 'button', disabled: !this.online, onclick: () => this.rematch() }, this.rematchFrom ? 'Revanche starten' : 'Revanche')
      : h('button.btn.primary', { type: 'button', disabled: this.rematchAsked || !this.online, onclick: () => this.rematch() }, this.rematchAsked ? 'Revanche angefragt …' : 'Revanche anfragen');
    return [
      h('div.duel-card.center.duel-over' + (o.winner === me.id ? '.won' : ''),
        h('span.gd-result-kicker', 'Duell beendet'),
        h('h2', title),
        DUEL_REASON[o.reason] ? h('p.muted', DUEL_REASON[o.reason]) : null,
        h('div.duel-final', this.chip(me), h('strong', `${o.score[me.id] ?? 0} : ${o.score[opp?.id] ?? 0}`), this.chip(opp)),
        h('p.muted.small', unit),
        h2h ? h('p', `Bilanz gegen ${opp.name}: ${h2h.wins} : ${h2h.losses}${h2h.draws ? ` (${h2h.draws}× unentschieden)` : ''}`) : null,
        this.rematchFrom ? h('p.duel-notice', `${this.rematchFrom.name} möchte eine Revanche.`) : null,
        !this.online ? h('p.muted', `${opp?.name || 'Dein Gegner'} ist nicht mehr verbunden.`) : null,
        h('div.duel-actions', rematch, h('button.btn', { type: 'button', onclick: () => this.leave() }, 'Neues Duell'))),
      v.rounds.length ? h('div.duel-rounds',
        h('div.duel-rounds-row.head', h('span', '#'), h('span', 'Spiel'), h('span', 'Modus'), h('span', 'Gewonnen von'), h('span', 'Zeit'), v.kind === 'points' ? h('span', 'Punkte') : null),
        v.rounds.map(r => h('div.duel-rounds-row' + (r.winner === me.id ? '.mine' : ''),
          h('span', r.n), h('span', GD_BY_ID.get(r.gameId)?.title || r.gameId), h('span', DUEL_MODE_LABEL[r.mode]),
          h('span', name(r.winner)), h('span', r.ms == null ? '–' : duelSeconds(r.ms)), v.kind === 'points' ? h('span', r.points || '–') : null))) : null,
    ];
  },

  /* ── Uhr: Countdown, Zeitbalken, Punkte, Sperre ──
     Nur während einer Runde, höchstens zehnmal pro Sekunde, und es wird nur geschrieben, was sich geändert hat
     (schont den Akku am Handy). Im verdeckten Tab hält der Browser die Schleife ohnehin an. */
  startLoop() {
    if (this.loop || !this.session) return;
    let last = 0;
    const frame = time => {
      if (!this.session || !this.screen.startsWith('match') || Gamedle.mode !== 'duell' || $('#gamedle').hidden) { this.loop = 0; return; }
      if (time - last >= 100) { last = time; this.tickLive(); }
      this.loop = requestAnimationFrame(frame);
    };
    this.loop = requestAnimationFrame(frame);
  },

  tickLive() {
    const v = this.session?.current();
    if (!v?.me) return;
    const L = this.live;
    const set = (el, prop, value) => { if (el && el[prop] !== value) el[prop] = value; };
    set(L.count, 'textContent', String(Math.max(1, Math.ceil(v.startsIn / 1000))));
    if (L.bar) {
      const width = `${((v.timeLeft / DUEL_ROUND_MS) * 100).toFixed(1)}%`;
      if (L.width !== width) { L.width = width; L.bar.style.width = width; } // der Browser schreibt „50%“ statt „50.0%“ zurück
      L.bar.classList.toggle('low', v.timeLeft < 15000);
    }
    if (L.track) {
      const seconds = String(Math.ceil(v.timeLeft / 1000));
      if (L.track.getAttribute('aria-valuenow') !== seconds) L.track.setAttribute('aria-valuenow', seconds);
    }
    set(L.time, 'textContent', v.phase === 'countdown' ? '' : duelClock(v.timeLeft));
    set(L.worth, 'textContent', v.worth != null ? `Treffer jetzt: ${v.worth} Punkte` : '');
    set(L.next, 'textContent', v.nextIn != null ? `Nächste Runde in ${Math.ceil(v.nextIn / 1000)} s` : '');
    const locked = v.phase === 'play' && v.me.lockedFor > 0;
    set(L.lock, 'hidden', !locked);
    set(L.lock, 'textContent', locked ? `Gesperrt: ${duelSeconds(v.me.lockedFor)}` : '');
    set(L.input, 'readOnly', locked);
    L.input?.classList.toggle('locked', locked);
  },
};
