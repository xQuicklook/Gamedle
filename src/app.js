/* ───────── App: Lebenszyklus, Dispatch & Rendering ───────── */
const App = {
  me: null,
  state: null,
  board: 'games',
  view: 'me',            // 'me' | 'group' | Spieler-ID
  selected: null,        // Tap-to-place Auswahl
  filter: { q: '', decade: null, sort: 'year' },
  renderQueued: false,
  renderPending: false,
  persistTimer: null,

  init() {
    this.me = Store.get('me') || {};
    if (!this.me.id) this.me.id = uid(12);
    if (!this.me.color) this.me.color = PLAYER_COLORS[hashStr(this.me.id) % PLAYER_COLORS.length];
    if (!this.me.key) this.me.key = uid(24); // geheimer Spieler-Schlüssel, verlässt nie dieses Gerät im Klartext
    this.me.name = this.me.name || '';
    Store.set('me', this.me);
    keyHash(this.me.key).then(hash => {
      this.myKeyHash = hash;
      const self = this.state?.players?.[this.me.id];
      if (self && Net.role !== 'guest') self.keyHash = hash;
    });
    Rooms.cleanup();
    applyTheme(Store.get('theme', 'system'));
    document.body.classList.toggle('show-titles', !!Store.get('showTitles', false));
    const ui = Store.get('ui', {});
    if (BOARDS.includes(ui.board)) this.board = ui.board;
    if (ui.sort) this.filter.sort = ui.sort;
    this.groupOpts = { method: 'mean', minVotes: 1, ...Store.get('groupOpts', {}) };

    this.wireNet();
    this.initLanding();
    this.wireApp();
    Layout.init();
    initDrag();
  },

  /* ── Startseite ── */
  initLanding() {
    const name = $('#nameInput');
    name.value = this.me.name;
    name.addEventListener('input', () => { this.me.name = name.value.trim(); Store.set('me', this.me); });

    const pick = $('#colorPick');
    const drawColors = () => {
      pick.replaceChildren(...PLAYER_COLORS.map(c => h('button.color-dot', {
        type: 'button', role: 'radio', 'aria-checked': String(c === this.me.color), 'aria-label': 'Farbe ' + c,
        style: { background: c },
        onclick: () => { this.me.color = c; Store.set('me', this.me); drawColors(); },
      })));
    };
    drawColors();

    const code = $('#codeInput');
    const fromHash = (location.hash.match(/^#([A-Z0-9]{6})$/i) || [])[1];
    if (fromHash) code.value = fromHash.toUpperCase();
    code.addEventListener('input', () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

    $('#createBtn').onclick = () => this.requireName() && this.startHost(roomCode(), true);
    $('#soloBtn').onclick = () => this.requireName() && this.startSolo();
    $('#joinForm').onsubmit = e => {
      e.preventDefault();
      const c = code.value.trim().toUpperCase();
      if (c.length !== 6) { code.focus(); toast('Der Raum-Code hat 6 Zeichen.'); return; }
      if (this.requireName()) this.startGuest(c);
    };
    this.drawResume();
    (this.me.name && fromHash ? code : name).focus();

    // Neu geladen, während man in einem Raum war → direkt wieder hinein
    const last = Store.get('last');
    if (fromHash && this.me.name && last?.code === fromHash.toUpperCase()) {
      if (last.role === 'host') this.startHost(last.code, false);
      else this.startGuest(last.code);
    }
  },

  drawResume() {
    const box = $('#resumeBox');
    const last = Store.get('last');
    box.replaceChildren();
    $('#appVersion').textContent = 'Tierly ' + APP_VERSION;
    const saved = Rooms.list().length;
    const link = $('#roomsLink');
    link.hidden = !saved;
    link.textContent = `Gespeicherte Räume verwalten (${saved})`;
    link.onclick = () => roomsModal();
    $('#diagLink').onclick = () => diagModal();
    $('#infoLink').onclick = () => infoModal();
    if (!last?.code) return;
    const label = last.code === 'SOLO' ? 'Deine Solo-Liste' : `Raum ${last.code} (${last.role === 'host' ? 'Host' : 'Gast'})`;
    box.append(
      h('span', 'Zuletzt: ', h('strong', label)),
      h('button.btn.sm.primary', {
        type: 'button',
        onclick: () => {
          if (!this.requireName()) return;
          if (last.code === 'SOLO') this.startSolo();
          else if (last.role === 'host') this.startHost(last.code, false);
          else this.startGuest(last.code);
        },
      }, 'Fortsetzen'),
    );
  },

  requireName() {
    const input = $('#nameInput');
    if (input.value.trim()) return true;
    input.focus();
    input.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 260 });
    toast('Gib zuerst deinen Namen ein.');
    return false;
  },

  registerSelf() {
    const s = this.state;
    s.hostId = this.me.id;
    for (const p of Object.values(s.players)) p.online = false;
    s.players[this.me.id] = {
      id: this.me.id, name: this.me.name, color: this.me.color, online: true, keyHash: this.myKeyHash,
      joinedAt: s.players[this.me.id]?.joinedAt || Date.now(),
    };
    ensureRanking(s, this.me.id);
  },

  startSolo() {
    Net.leave();
    this.state = Store.get('room.SOLO') || initialState(this.me.id);
    this.registerSelf();
    Store.set('last', { code: 'SOLO', role: 'host' });
    this.enterApp();
  },

  startHost(code, fresh) {
    if (!Net.available()) { toast('PeerJS konnte nicht geladen werden – bist du online?'); return; }
    this.state = (!fresh && Store.get('room.' + code)) || this.state || initialState(this.me.id);
    if (fresh && this.state.hostId !== this.me.id) this.state = initialState(this.me.id);
    this.registerSelf();
    Net.host(code, { resume: !fresh });
    Store.set('last', { code, role: 'host' });
    this.persist(true);
    this.enterApp();
    if (fresh) setTimeout(() => roomModal(), 250);
  },

  startGuest(code, { fallbackHost = false } = {}) {
    if (!Net.available()) { toast('PeerJS konnte nicht geladen werden – bist du online?'); return; }
    this.fallbackHost = fallbackHost ? code : null; // findet sich kein Host, selbst wieder Host werden
    const btn = $('#joinForm button');
    btn.disabled = true;
    btn.textContent = 'Verbinde …';
    if (!fallbackHost) this.state = null;
    Net.join(code);
  },

  goOnline() {
    // Solo-Liste in einen echten Raum umwandeln
    const code = roomCode();
    Store.set('room.' + code, this.state);
    this.startHost(code, false);
    setTimeout(() => roomModal(), 250);
  },

  takeOver(auto = false) {
    // Host ist weg → als neuer Host mit dem letzten bekannten Stand weitermachen
    Migration.cancel();
    const code = Net.code;
    this.state.hostId = this.me.id;
    Store.set('room.' + code, this.state);
    this.startHost(code, false);
    toast(auto ? 'Der Host ist weg – du hast den Raum automatisch übernommen.' : 'Du bist jetzt Host dieses Raums.', 5000);
  },

  leave() {
    Net.leave();
    Migration.cancel();
    finishReveal(false);
    TileCache.clear();
    Undo.clear();
    $('#board').replaceChildren();
    $('#poolBody')._sig = null;
    this.state = null;
    this.selected = null;
    this.view = 'me';
    closeAllModals();
    $('#app').hidden = true;
    $('#landing').hidden = false;
    const btn = $('#joinForm button');
    btn.disabled = false;
    btn.textContent = 'Beitreten';
    this.drawResume();
    history.replaceState(null, '', location.pathname + location.search + '#/tierly');
  },

  enterApp() {
    $('#landing').hidden = true;
    $('#app').hidden = false;
    if (Net.code && /^https?:/.test(location.protocol)) history.replaceState(null, '', '#' + Net.code);
    Layout.refresh(); // gespeicherte Breite erst jetzt begrenzen – vorher war die App unsichtbar
    this.render();
    if (!Store.get('onboarded')) setTimeout(showTips, 400);
  },

  /* ── Netzwerk-Hooks ── */
  wireNet() {
    Net.on.status = () => {
      Migration.check();
      if (this.state) { this.renderTopbar(); this.renderHint(); }
    };
    Net.on.error = msg => toast(msg, 5000);
    Net.on.joinFailed = (msg, stage) => {
      // Raum lief beim Fortsetzen woanders – doch kein Host da? Dann wieder selbst hosten.
      if (this.fallbackHost && (stage === 'host' || stage === 'hello')) {
        const code = this.fallbackHost;
        this.fallbackHost = null;
        this.startHost(code, false);
        return;
      }
      this.fallbackHost = null;
      toast(msg, 9000, stage === 'signal' || stage === 'webrtc' ? { label: 'Verbindung testen', onClick: () => diagModal() } : null);
      if (!$('#app').hidden) this.leave();
      const btn = $('#joinForm button');
      btn.disabled = false;
      btn.textContent = 'Beitreten';
    };
    Net.on.hostOverload = (pid, why) => {
      const name = this.state?.players[pid]?.name || 'Ein Gast';
      toast(why === 'big' ? `Eine zu große Änderung von ${name} wurde verworfen.` : `${name} schickt sehr viele Änderungen – einige wurden verworfen.`, 5000);
    };
    Net.on.idTaken = code => {
      toast('Der Raum läuft gerade bei jemand anderem – du trittst als Gast bei.', 5000);
      this.startGuest(code, { fallbackHost: true });
    };
    Net.on.joined = () => {
      this.fallbackHost = null;
      Store.set('last', { code: Net.code, role: 'guest' });
      this.enterApp();
      toast('Verbunden mit Raum ' + Net.code);
    };
    Net.on.state = s => {
      const prev = this.state;
      this.state = s;
      this.persist();
      // Gerade aufgedeckt? Dann die Enthüllung abspielen (nicht beim ersten Beitritt)
      const revealed = prev && BOARDS.find(b => prev.settings?.blind && !prev.reveal?.[b] && s.reveal?.[b]);
      if (revealed) playReveal(revealed);
      else this.scheduleRender();
    };
    Net.on.rejected = reason => {
      const msg = reason === 'outdated'
        ? 'Deine Tierly-Datei ist veraltet. Hol dir die aktuelle Datei vom Host und versuch es nochmal.'
        : 'Beitritt abgelehnt: Diese Spieler-Identität gehört zu einem anderen Gerät.';
      Net.on.joinFailed(msg);
    };
    Net.on.hostOutdated = app => toast(`Der Host nutzt eine ältere Tierly-Version${app ? ' (' + app + ')' : ''} – manche Funktionen fehlen.`, 6000);
    Net.on.hostReject = (name, reason) => toast(reason === 'outdated'
      ? `${name} hat eine veraltete Tierly-Datei – bitte die aktuelle Datei schicken.`
      : `Beitritt von „${name}“ abgelehnt (fremde Spieler-Identität).`, 6000);
    Net.on.hostJoin = p => {
      const s = this.state;
      const known = s.players[p.id];
      s.players[p.id] = {
        id: p.id, name: p.name, color: /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : PLAYER_COLORS[1],
        online: true, keyHash: p.keyHash || known?.keyHash,
        joinedAt: known?.joinedAt || Date.now(), // Reihenfolge für die automatische Übernahme
      };
      ensureRanking(s, p.id);
      // Kennt der Host (z. B. nach einer Raum-Übernahme) die Liste nicht, nimmt er die des Spielers
      if (p.ranking && !hasRanking(s, p.id, 'games') && !hasRanking(s, p.id, 'franchises')) adoptRanking(s, p.id, p.ranking);
      if (!known?.online) toast(`${p.name} ist ${known ? 'zurück' : 'beigetreten'}`);
      this.afterHostChange(true);
    };
    Net.on.hostLeave = pid => {
      const p = this.state.players[pid];
      if (!p) return;
      p.online = false;
      toast(`${p.name} hat den Raum verlassen`);
      this.afterHostChange(true);
    };
    Net.on.hostAction = (raw, pid) => {
      const a = normalizeAction(raw);
      // Abgelehnte Aktionen trotzdem bestätigen, damit der Gast seine Vorschau zurücknimmt
      if (applyAction(this.state, a, pid)) Net.commit(a, pid);
      else Net.ackOnly(pid);
      this.afterHostChange();
    };
  },

  afterHostChange(full = false) {
    if (full) Net.fullBroadcast();
    this.persist();
    this.scheduleRender();
    checkAllReady();
  },

  /* ── Aktionen ── */
  canEditConfig() {
    return !this.state.settings.hostOnlyEdit || this.state.hostId === this.me.id;
  },

  dispatch(action) {
    if (CONFIG_ACTIONS.has(action.type) && !this.canEditConfig()) {
      toast('Nur der Host kann Spiele und Stufen bearbeiten.');
      return false;
    }
    action = normalizeAction(action);
    const undo = Undo.capture(action); // Vorher-Zustand für Strg+Z merken
    if (!applyAction(this.state, action, this.me.id)) return false;
    Undo.push(undo);
    if (Net.role === 'guest') Net.send(action);
    else Net.commit(action, this.me.id);
    this.persist();
    if (action.type === 'reveal' && action.value) playReveal(action.board);
    else this.scheduleRender();
    if (Net.role === 'host') checkAllReady();
    return true;
  },

  persist(now = false) {
    clearTimeout(this.persistTimer);
    const run = () => {
      if (!this.state) return;
      if (Rooms.save(currentRoomKey(), this.state)) {
        if (this.storageFull) { this.storageFull = false; this.renderHint(); }
      } else warnStorageFull();
    };
    if (now) run(); else this.persistTimer = setTimeout(run, 300);
  },

  scheduleRender() {
    if (Drag.active || Reveal.running) { this.renderPending = true; return; }
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => { this.renderQueued = false; this.render(); });
  },

  /* ── Rendering ── */
  render() {
    if (!this.state || $('#app').hidden) return;
    this.renderPending = false;
    if (!['me', 'group', 'stats'].includes(this.view) && !this.state.players[this.view]) this.view = 'me';
    document.body.classList.toggle('selecting', !!this.selected);
    this.renderTopbar();
    this.renderToolbar();
    this.renderHint();
    this.renderBoard();
    this.renderPool();
    TileCache.sweep();
    // Tastatur: Fokus bleibt auf der zuletzt bewegten Kachel
    if (this.focusId) {
      $(`#app .tile[data-id="${CSS.escape(this.focusId)}"]`)?.focus();
      this.focusId = null;
    }
  },

  sortedPlayers() {
    const s = this.state;
    return Object.values(s.players).sort((a, b) =>
      (b.id === this.me.id) - (a.id === this.me.id) || (b.online - a.online) || a.name.localeCompare(b.name));
  },

  renderTopbar() {
    $$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.board === this.board)));
    const chip = $('#roomChip');
    const st = Net.role === 'solo' ? '' : Net.status;
    chip.replaceChildren(
      h('span.status-dot.' + (st || 'idle')),
      Net.role === 'solo' ? h('span', h('span.room-chip-label', 'Solo · '), 'Einladen') : h('span', Net.code),
    );
    chip.title = Net.role === 'solo' ? 'Raum öffnen und Freunde einladen'
      : { online: 'Verbunden', connecting: 'Verbinde …', offline: 'Offline' }[Net.status] + ' – Raum & Spieler';
    if (!$('#menuBtn').firstChild) $('#menuBtn').append(icon('more'));

    const stack = $('#playerStack');
    stack.replaceChildren(...(Net.role === 'solo' ? [] : this.sortedPlayers().slice(0, 6).map(p => avatar(p, this.board))));
    stack.onclick = () => roomModal();
  },

  /* Verdeckter Modus für das aktuelle Board aktiv? (Solo: nie) */
  hidden(board = this.board) {
    return Net.role !== 'solo' && isBlind(this.state, board);
  },

  renderToolbar() {
    const s = this.state;
    const locked = this.hidden();
    const others = this.sortedPlayers().filter(p => p.id !== this.me.id && (locked || placedCount(s, p.id, this.board) > 0));
    const seg = $('#viewSeg');
    const lock = () => (locked ? icon('lock', 'lock-ico') : null);
    const btn = (view, ...kids) => h('button', { role: 'tab', 'aria-selected': String(this.view === view), onclick: () => this.setView(view) }, ...kids);
    seg.replaceChildren(
      btn('me', 'Meine Liste'),
      btn('group', locked ? lock() : icon('users'), 'Gruppe'),
      Net.role === 'solo' ? null : btn('stats', locked ? lock() : icon('chart'), 'Statistik'),
      ...others.map(p => btn(p.id, h('span.mini-dot', { style: { background: p.color } }), p.name, lock())),
    );
    seg.hidden = Net.role === 'solo' && !others.length;

    $('#tiersBtn').replaceChildren(icon('layers'), h('span', 'Stufen'));
    $('#libraryBtn').replaceChildren(icon('plus'), h('span', 'Spiele', h('span.btn-text-long', ' hinzufügen')));
    const ready = !!s.rankings[this.me.id]?.ready?.[this.board];
    const rb = $('#readyBtn');
    rb.hidden = Net.role === 'solo';
    rb.classList.toggle('done', ready);
    rb.classList.toggle('primary', !ready);
    rb.replaceChildren(icon('check'), h('span', ready ? 'Fertig' : 'Fertig melden'));
  },

  updateSelection(withHint = true) {
    document.body.classList.toggle('selecting', !!this.selected);
    $$('#app .tile.selected').forEach(t => t.classList.remove('selected'));
    if (this.selected) $$(`#app .tile[data-id="${CSS.escape(this.selected)}"]`).forEach(t => t.classList.add('selected'));
    if (withHint) this.renderHint();
  },

  setView(view) {
    this.view = view;
    this.selected = null;
    this.render();
    $('#boardWrap').scrollTop = 0;
  },

  renderHint() {
    const el = $('#viewHint');
    const s = this.state;
    el.replaceChildren();
    if (this.storageFull) {
      el.append(icon('download'), h('span', { style: { flex: 1 } }, h('strong', 'Speicher voll'), ' – Änderungen werden in diesem Browser nicht mehr gesichert.'),
        h('button.btn.sm', { onclick: () => roomsModal() }, 'Aufräumen'),
        h('button.btn.sm', { onclick: () => exportJson() }, 'Sichern'));
    } else if (Net.role === 'guest' && Net.status !== 'online') {
      const next = Migration.successor;
      const text = !next ? 'Verbindung zum Host unterbrochen – versuche es weiter …'
        : next.id === this.me.id ? `Host nicht erreichbar – du übernimmst den Raum in ${Migration.secondsLeft()} s automatisch.`
          : `Host nicht erreichbar – ${next.name} übernimmt den Raum in ${Migration.secondsLeft()} s automatisch.`;
      el.append(icon('wifi'), h('span', { style: { flex: 1 } }, text),
        h('button.btn.sm', { onclick: () => confirmDialog('Raum jetzt übernehmen?', 'Du wirst neuer Host mit dem zuletzt bekannten Stand. Die anderen verbinden sich automatisch mit dir.', 'Übernehmen').then(ok => ok && this.takeOver()) }, 'Jetzt übernehmen'));
    } else if (this.selected && this.view === 'me') {
      const it = boardItems(s, this.board).find(x => x.id === this.selected);
      el.append(h('span', { style: { flex: 1 } }, h('strong', `„${it?.title || ''}“`), ' ausgewählt – tippe auf eine Stufe oder ein Spiel, um es dort einzusortieren.'),
        h('button.btn.sm', { onclick: () => { this.selected = null; this.render(); } }, 'Abbrechen'));
    } else if (this.view !== 'me' && this.hidden()) {
      // Sperrbildschirm erklärt sich selbst
    } else if (this.view === 'group') {
      const { lists, few } = this.viewData();
      const o = this.groupOpts;
      const setOpt = patch => { this.groupOpts = { ...o, ...patch }; Store.set('groupOpts', this.groupOpts); this.render(); };
      const maxVotes = Math.max(1, lists);
      el.append(icon('users'),
        h('span', { style: { flex: 1 } }, `Gruppenergebnis aus ${lists} ${lists === 1 ? 'Liste' : 'Listen'}`, few.length ? ` · ${few.length} mit zu wenigen Stimmen in der Liste` : ''),
        h('div.seg.mini', ['mean', 'median'].map(m => h('button', { 'aria-selected': String(o.method === m), title: m === 'mean' ? 'Durchschnitt aller Stufen' : 'Mittlere Wertung – robust gegen Ausreißer', onclick: () => setOpt({ method: m }) }, m === 'mean' ? 'Ø' : 'Median'))),
        h('select.mini', { 'aria-label': 'Mindestens so viele Stimmen', title: 'Spiele mit weniger Stimmen erscheinen in der Liste statt im Ergebnis', onchange: e => setOpt({ minVotes: +e.target.value }) },
          Array.from({ length: maxVotes }, (_, i) => h('option', { value: i + 1, selected: (o.minVotes || 1) === i + 1 }, `ab ${i + 1} ${i ? 'Stimmen' : 'Stimme'}`))));
      if (s.settings?.blind && Net.role === 'host') {
        el.append(h('button.btn.sm', { title: 'Wieder verdecken und Fertig-Status zurücksetzen', onclick: () => newRound(this.board) }, icon('rotate'), 'Neue Runde'));
      }
    } else if (this.view === 'stats') {
      el.append(icon('chart'), h('span', 'Wer tickt wie? Tippe auf eine Kachel für die Einzelwertungen.'));
    } else if (this.view !== 'me') {
      el.append(h('span', `Du siehst die Liste von `, h('strong', s.players[this.view]?.name || ''), ' (nur ansehen).'));
    } else if (this.board === 'franchises' && franchiseSuggestion(s, this.me.id).count) {
      const sug = franchiseSuggestion(s, this.me.id);
      el.append(icon('layers'), h('span', { style: { flex: 1 } }, `${sug.count} ${sug.count === 1 ? 'Franchise kann' : 'Franchises können'} aus deinen Spiele-Rankings vorgeschlagen werden (Schnitt der Stufen je Reihe).`),
        h('button.btn.sm.primary', {
          onclick: () => {
            if (this.dispatch({ type: 'ranking/merge', board: 'franchises', rows: sug.rows })) {
              toast(`${sug.count} Franchises einsortiert`, 5000, { label: 'Rückgängig', onClick: () => Undo.undoLast() });
            }
          },
        }, 'Vorschlag übernehmen'));
    } else if (this.view === 'me' && this.hidden()) {
      const st = readyStats(this.board);
      el.append(icon('lock'), h('span', { style: { flex: 1 } }, h('strong', 'Verdeckt: '),
        `Niemand sieht deine Liste, bis aufgedeckt wird. ${st.ready} von ${st.total} fertig.`));
    } else if (this.board === 'franchises' && boardItems(s, 'franchises').length && !hasRanking(s, this.me.id, 'franchises')) {
      el.append(icon('layers'), h('span', 'Franchises entstehen automatisch aus Spielen derselben Reihe (ab 2 Spielen). Ranke hier die Reihen als Ganzes.'));
    }
  },

  viewData() {
    const s = this.state;
    if (this.view === 'group' || this.view === 'stats') return groupView(s, this.board, this.groupOpts);
    return personalView(s, this.board, this.view === 'me' ? this.me.id : this.view);
  },

  renderBoard() {
    const board = $('#board');
    const s = this.state;
    const all = boardItems(s, this.board);
    const readonly = this.view !== 'me';
    board.classList.toggle('readonly', readonly);

    if (readonly && this.hidden()) { board.replaceChildren(lockedPanel(this.board)); return; }
    if (this.view === 'stats') { board.replaceChildren(statsPanel(this.board)); return; }

    if (!all.length) {
      board.replaceChildren(this.board === 'games'
        ? h('div.empty-board',
          h('h3', 'Noch keine Spiele im Raum'),
          h('p', 'Starte mit einer Vorlage aus den letzten Jahrzehnten oder füge eigene Spiele hinzu.'),
          h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' } },
            h('button.btn.primary', { onclick: () => libraryModal('packs') }, icon('library'), 'Vorlage laden'),
            h('button.btn', { onclick: () => libraryModal('add') }, icon('plus'), 'Spiel hinzufügen')))
        : h('div.empty-board',
          h('h3', 'Noch keine Franchises'),
          h('p', 'Sobald mindestens zwei Spiele mit demselben Franchise in der Liste sind, erscheint die Reihe hier automatisch.'),
          h('button.btn', { onclick: () => libraryModal('list') }, icon('edit'), 'Franchises bei Spielen eintragen')));
      return;
    }

    // Nur Reihen neu bauen, die sich geändert haben – Kacheln werden wiederverwendet
    const { rows } = this.viewData();
    const group = this.view === 'group';
    const old = new Map([...board.children].filter(el => el.classList.contains('tier')).map(el => [el.dataset.tier, el]));
    board.replaceChildren(...rows.map(({ tier, items }) => {
      const sig = [tier.name, tier.color, readonly, group, ...items.map(it => tileKey(it, { readonly, group }))].join('¦');
      const prev = old.get(tier.id);
      if (prev && prev._sig === sig) { items.forEach(it => TileCache.touch(it, { readonly, group })); return prev; }
      const row = h('div.tier', { 'data-tier': tier.id },
        h('div.tier-label' + (tier.name.length > 3 ? '.long' : ''), { style: { background: tier.color } }, tier.name),
        h('div.tier-items', { 'data-tier': tier.id }, items.map(it => TileCache.get(it, { readonly, group }))));
      row._sig = sig;
      return row;
    }));
    this.updateSelection(false);
  },

  renderPool() {
    const s = this.state;
    const readonly = this.view !== 'me';
    if (readonly && this.hidden()) {
      $('#poolBody')._sig = null;
      $('#poolTitle').textContent = 'Verdeckt';
      $('#poolCount').textContent = '–';
      $('#poolChips').replaceChildren();
      $('#poolBody').replaceChildren(h('div.pool-empty', 'Hier gibt es erst nach dem Aufdecken etwas zu sehen.',
        h('div', h('button.btn.sm', { onclick: () => this.setView('me') }, 'Zurück zu meiner Liste'))));
      return;
    }
    const data = this.viewData();
    const groupLike = this.view === 'group' || this.view === 'stats';
    const pool = groupLike ? [...data.pool, ...(data.few || [])] : data.pool;
    const all = boardItems(s, this.board);
    const isGames = this.board === 'games';

    $('#poolTitle').textContent = this.view === 'me' ? 'Unplatziert'
      : groupLike ? (data.few?.length ? 'Zu selten oder nicht platziert' : 'Von niemandem platziert')
        : `Bei ${s.players[this.view]?.name || '?'} offen`;
    $('#poolCount').textContent = pool.length;
    $('#poolSearch').placeholder = isGames ? 'Spiele suchen …' : 'Franchises suchen …';
    $('#poolSort').value = this.filter.sort;
    $('#poolSort').querySelector('[value="franchise"]').hidden = !isGames;

    // Jahrzehnt-Filter
    const decades = isGames ? [...new Set(all.map(it => it.year && Math.floor(it.year / 10) * 10).filter(Boolean))].sort() : [];
    if (!decades.includes(this.filter.decade)) this.filter.decade = null;
    const chip = (val, label) => h('button.chip', {
      'aria-pressed': String(this.filter.decade === val),
      onclick: () => { this.filter.decade = val; this.renderPool(); },
    }, label);
    $('#poolChips').replaceChildren(...(decades.length > 1 ? [chip(null, 'Alle'), ...decades.map(d => chip(d, `${String(d).slice(2)}er`))] : []));

    // Filtern & sortieren
    const q = norm(this.filter.q);
    let list = pool.filter(it =>
      (!q || norm(it.title).includes(q) || norm(it.franchise).includes(q)) &&
      (!this.filter.decade || (it.year >= this.filter.decade && it.year < this.filter.decade + 10)));
    const byTitle = (a, b) => a.title.localeCompare(b.title, 'de');
    const sorters = {
      year: (a, b) => (a.year || 9999) - (b.year || 9999) || byTitle(a, b),
      title: byTitle,
      franchise: (a, b) => (a.franchise || '\uffff').localeCompare(b.franchise || '\uffff', 'de') || (a.year || 0) - (b.year || 0),
    };
    list.sort(sorters[isGames ? this.filter.sort : this.filter.sort === 'franchise' ? 'title' : this.filter.sort] || byTitle);

    // Suchbegriff ohne Treffer? Direkt online suchen und hinzufügen
    const q2 = this.filter.q.trim();
    const quick = isGames && !readonly && q2 && this.canEditConfig()
      ? h('button.tile-add', { type: 'button', title: `„${q2}“ auf Wikipedia suchen und hinzufügen`, onclick: () => libraryModal('add', q2) }, icon('plus'), `„${q2}“ hinzufügen`)
      : null;

    const body = $('#poolBody');
    // Unverändert? Dann nichts neu bauen (spart bei großen Bibliotheken viel Arbeit)
    const sig = [this.view, this.board, all.length, pool.length, readonly, q2, ...list.map(it => tileKey(it, { readonly }))].join('¦');
    if (body._sig === sig) { list.forEach(it => TileCache.touch(it, { readonly })); return; }
    body._sig = sig;
    if (!all.length) {
      body.replaceChildren(h('div.pool-empty', isGames ? 'Noch keine Spiele.' : 'Noch keine Franchises.',
        isGames ? h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' } },
          h('button.btn.sm.primary', { onclick: () => libraryModal('add') }, icon('plus'), 'Spiel suchen'),
          h('button.btn.sm', { onclick: () => libraryModal('packs') }, 'Vorlage laden')) : null));
    } else if (!pool.length && !quick) {
      body.replaceChildren(h('div.pool-empty', readonly ? 'Hier ist alles platziert.' : 'Alles platziert – stark! Markiere deine Liste als fertig oder schau dir das Gruppenergebnis an.'));
    } else if (!list.length) {
      body.replaceChildren(h('div.pool-empty', 'Keine Treffer in deiner Auswahl.', quick ? h('div', { style: { display: 'flex', justifyContent: 'center', marginTop: '10px' } }, quick) : null));
    } else {
      body.replaceChildren(...list.map(it => TileCache.get(it, { readonly })), ...(quick ? [quick] : []));
    }
  },

  /* ── Statische Event-Verdrahtung ── */
  wireApp() {
    $$('.tab').forEach(t => t.addEventListener('click', () => {
      this.board = t.dataset.board;
      this.selected = null;
      Store.set('ui', { board: this.board, sort: this.filter.sort });
      this.render();
    }));
    $('#roomChip').onclick = () => roomModal();
    $('#tiersBtn').onclick = () => tiersModal();
    $('#libraryBtn').onclick = () => libraryModal();
    $('#readyBtn').onclick = () => {
      const cur = !!this.state.rankings[this.me.id]?.ready?.[this.board];
      this.dispatch({ type: 'ready', board: this.board, value: !cur });
      if (!cur) toast('Als fertig markiert');
    };
    $('#menuBtn').onclick = e => { e.stopPropagation(); toggleMenu(); };
    $('#poolSearch').addEventListener('input', e => { this.filter.q = e.target.value; this.renderPool(); });
    $('#poolSort').addEventListener('change', e => {
      this.filter.sort = e.target.value;
      Store.set('ui', { board: this.board, sort: this.filter.sort });
      this.renderPool();
    });
    // Klicks: Details in Nur-Lese-Ansichten, Tap-to-place in der eigenen Liste
    $('#app').addEventListener('click', e => {
      // Nur das eine click-Event direkt nach einem Tap/Drop schlucken
      if (Date.now() - Drag.lastDrop < 400) { Drag.lastDrop = 0; return; }
      if (e.target.closest('button')) return;
      const tile = e.target.closest('.tile');
      if (tile && tile.classList.contains('readonly')) { itemModal(tile.dataset.id); return; }
      if (!this.selected || this.view !== 'me' || tile) return;
      const tier = e.target.closest('.tier');
      if (tier) { this.dispatch({ type: 'place', board: this.board, itemId: this.selected, tierId: tier.dataset.tier }); this.selected = null; this.render(); return; }
      if (e.target.closest('#poolBody')) { this.dispatch({ type: 'place', board: this.board, itemId: this.selected, tierId: null }); this.selected = null; this.render(); }
    });

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (closeTopModal()) return;
      if (!$('#menu').hidden) { $('#menu').hidden = true; return; }
      if (this.selected) { this.selected = null; this.render(); }
    });
    // Strg+Z / Strg+Umschalt+Z (bzw. Strg+Y) – nicht, während man in einem Feld tippt
    document.addEventListener('keydown', e => {
      if (!(e.ctrlKey || e.metaKey) || $('#app').hidden || modalStack.length) return;
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); Undo.undoLast(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); Undo.redoLast(); }
    });
    $('#app').addEventListener('keydown', e => this.onTileKey(e));
    document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) $('#menu').hidden = true; });
    window.addEventListener('beforeunload', () => this.persist(true));
  },

  /* Tastatur auf einer Kachel: 1–9 Stufe, 0/Entf zurück, Pfeile verschieben, Enter auswählen/Details */
  onTileKey(e) {
    const tile = e.target instanceof Element && e.target.closest('.tile');
    if (!tile || e.ctrlKey || e.metaKey || e.altKey || !tile.closest('#board, #poolBody')) return;
    const id = tile.dataset.id;
    if (tile.classList.contains('readonly')) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); itemModal(id); }
      return;
    }
    const s = this.state;
    const tiers = s.tiers;
    const rk = s.rankings[this.me.id]?.[this.board] || {};
    const cur = tiers.findIndex(t => (rk[t.id] || []).includes(id)); // -1 = noch in der Liste
    const list = cur >= 0 ? rk[tiers[cur].id] : [];
    const pos = list.indexOf(id);
    const siblings = [...tile.parentElement.querySelectorAll('.tile')];
    const neighbour = siblings[siblings.indexOf(tile) + 1] || siblings[siblings.indexOf(tile) - 1];
    let target = null;

    if (/^[1-9]$/.test(e.key) && +e.key <= tiers.length) target = { tierId: tiers[+e.key - 1].id };
    else if (['0', 'Backspace', 'Delete'].includes(e.key) && cur >= 0) target = { tierId: null };
    else if (e.key === 'ArrowUp' && cur > 0) target = { tierId: tiers[cur - 1].id, index: pos };
    else if (e.key === 'ArrowDown' && cur >= 0 && cur < tiers.length - 1) target = { tierId: tiers[cur + 1].id, index: pos };
    else if (e.key === 'ArrowLeft' && cur >= 0 && pos > 0) target = { tierId: tiers[cur].id, index: pos - 1 };
    else if (e.key === 'ArrowRight' && cur >= 0 && pos < list.length - 1) target = { tierId: tiers[cur].id, index: pos + 1 };
    else if (cur < 0 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      // In der Liste: Pfeile wandern nur zwischen den Kacheln
      e.preventDefault();
      siblings[siblings.indexOf(tile) + (e.key === 'ArrowRight' ? 1 : -1)]?.focus();
      return;
    } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tapTile(id, tile); return; }
    if (!target) return;
    e.preventDefault();
    // Aus der Liste platziert → gleich die nächste Kachel der Liste fokussieren (schnelles Durchranken)
    this.focusId = cur < 0 && target.tierId ? neighbour?.dataset.id || id : id;
    this.dispatch({ type: 'place', board: this.board, itemId: id, tierId: target.tierId, index: target.index });
  },
};

/* ───────── Bausteine ───────── */
function hasRanking(state, pid, board) {
  const rk = state.rankings[pid]?.[board];
  return !!rk && Object.values(rk).some(list => list.length);
}

function initials(title) {
  const words = title.split(/[\s:\-–.&]+/).filter(w => w && !/^(the|of|a|der|die|das|and|und)$/i.test(w));
  const roman = words.find((w, i) => i > 0 && /^([IVX]+|\d+)$/.test(w));
  const base = words.filter(w => !/^\(?\d{4}\)?$/.test(w)).slice(0, 2).map(w => w[0]).join('');
  return (roman && base.length < 3 ? base.slice(0, 2) + roman : base).toUpperCase().slice(0, 5);
}

// Kuratierte Farbtöne (keine matschigen Gelbgrün-Töne); Spiele einer Reihe teilen sich die Farbe
const TILE_HUES = [0, 14, 28, 152, 168, 188, 204, 222, 240, 258, 276, 294, 316, 336];
function tileHue(item) {
  return TILE_HUES[hashStr(norm(item.franchise || item.title)) % TILE_HUES.length];
}
function tileBackground(item) {
  const hue = tileHue(item);
  return `linear-gradient(135deg, hsl(${hue} 64% 52%), hsl(${(hue + 28) % 360} 58% 24%))`;
}

/* Cover-Bilder: lazy geladen; schlägt eins fehl, bleibt die Farbkachel sichtbar */
function coverImgs(srcs) {
  if (!srcs.length) return null;
  const onerror = e => {
    const box = e.target.parentNode;
    e.target.remove();
    if (box && !box.children.length) { box.closest('.tile')?.classList.remove('has-img'); box.remove(); }
  };
  return h('div.tile-cover.n' + Math.min(srcs.length, 4), srcs.slice(0, 4).map(src =>
    h('img', { src, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false', referrerpolicy: 'no-referrer', onerror })));
}

/* Kachel-Cache: unveränderte Kacheln werden wiederverwendet statt neu gebaut (Cover laden nicht neu) */
function tileKey(it, { readonly = false, group = false } = {}) {
  const isFr = it.id.startsWith('fr:');
  return [
    it.id, readonly ? 1 : 0, group ? 1 : 0, it.title, it.year, it.franchise, it.count,
    (isFr ? it.imgs || [] : [it.img]).join(','), App.state?.settings?.safeImages === false ? 'a' : 's',
    group && it._votes ? it._votes.map(v => v.pid + (App.state.players[v.pid]?.color || '')).join('.') : '',
  ].join('|');
}
const TileCache = {
  map: new Map(),
  used: new Set(),
  get(it, opts) {
    const k = tileKey(it, opts);
    this.used.add(k);
    let el = this.map.get(k);
    if (!el) { el = makeTile(it, opts); this.map.set(k, el); }
    el.classList.toggle('selected', App.selected === it.id);
    return el;
  },
  touch(it, opts) { this.used.add(tileKey(it, opts)); },
  sweep() {
    for (const k of this.map.keys()) if (!this.used.has(k)) this.map.delete(k);
    this.used.clear();
  },
  clear() { this.map.clear(); this.used.clear(); },
};

function makeTile(item, { readonly = false, group = false } = {}) {
  const isFr = item.id.startsWith('fr:');
  const meta = isFr ? `${item.count} Spiele` : item.year || '';
  const srcs = (isFr ? item.imgs || [] : [item.img]).map(i => coverSrc(i)).filter(Boolean);
  const mono = initials(item.title);
  const el = h('div.tile', {
    'data-id': item.id,
    tabindex: '0', // per Tastatur erreichbar (1–9 platzieren, Pfeile verschieben)
    title: [item.title, isFr ? `${item.count} Spiele` : item.year, !isFr && item.franchise].filter(Boolean).join(' · '),
  },
  h('div.tile-mono' + (mono.length > 3 ? '.long' : ''), mono),
  coverImgs(srcs),
  meta ? h('span.tile-year', meta) : null,
  h('div.tile-title', item.title),
  );
  el.style.setProperty('--tile-bg', tileBackground(item));
  if (srcs.length) el.classList.add('has-img');
  if (isFr) el.classList.add('fr');
  if (readonly) el.classList.add('readonly');
  if (App.selected === item.id) el.classList.add('selected');
  if (group && item._votes) {
    el.append(h('div.tile-votes', item._votes.slice(0, 6).map(v => h('i', { style: { background: App.state.players[v.pid]?.color || '#888' } }))));
  }
  return el;
}

function avatar(p, board) {
  const ready = App.state.rankings[p.id]?.ready?.[board];
  return h('span.avatar' + (p.online ? '' : '.away'), {
    style: { background: p.color },
    title: `${p.name}${p.id === App.me.id ? ' (du)' : ''}${p.online ? '' : ' – offline'}${ready ? ' – fertig' : ''}`,
  }, (p.name || '?').slice(0, 1).toUpperCase(), ready ? h('span.ready-badge') : null);
}

/* Kurze Meldung, optional mit Knopf (z. B. „Rückgängig“) */
function toast(msg, ms = 2600, action = null) {
  const close = () => { t.classList.add('out'); setTimeout(() => t.remove(), 250); };
  const t = h('div.toast' + (action ? '.has-action' : ''), h('span', msg),
    action ? h('button.toast-btn', { onclick: () => { close(); action.onClick(); } }, action.label) : null);
  $('#toastRoot').append(t);
  setTimeout(close, action ? Math.max(ms, 5000) : ms);
  return t;
}

function applyTheme(mode) {
  if (mode === 'light' || mode === 'dark') document.documentElement.dataset.theme = mode;
  else delete document.documentElement.dataset.theme;
  Store.set('theme', mode);
}
