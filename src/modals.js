/* ───────── Modal-Grundgerüst ───────── */
const modalStack = [];

function openModal({ title, body, foot, width, tabs, autofocus = true }) {
  const close = () => {
    const i = modalStack.indexOf(m);
    if (i >= 0) modalStack.splice(i, 1);
    backdrop.remove();
  };
  const backdrop = h('div.modal-backdrop');
  const box = h('div.modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: width ? { '--modal-w': width + 'px' } : null },
    h('div.modal-head', h('h2', title), h('button.icon-btn', { 'aria-label': 'Schließen', onclick: () => m.close() }, icon('x'))),
    tabs || null,
    h('div.modal-body', body),
    foot ? h('div.modal-foot', foot) : null,
  );
  backdrop.append(box);
  let downOnBackdrop = false;
  backdrop.addEventListener('pointerdown', e => { downOnBackdrop = e.target === backdrop; });
  backdrop.addEventListener('click', e => { if (downOnBackdrop && e.target === backdrop) m.close(); });
  $('#modalRoot').append(backdrop);
  const m = { el: box, body: $('.modal-body', box), close };
  modalStack.push(m);
  // Auf Touch-Geräten nicht fokussieren – sonst springt sofort die Tastatur auf
  if (autofocus && !matchMedia('(pointer: coarse)').matches) {
    setTimeout(() => $('input:not([type=color]):not([type=checkbox]), textarea', box)?.focus({ preventScroll: true }), 30);
  }
  return m;
}
function closeTopModal() {
  const m = modalStack[modalStack.length - 1];
  if (!m) return false;
  m.close();
  return true;
}
function closeAllModals() { while (closeTopModal()) { /* alle schließen */ } }

function confirmDialog(title, text, okLabel = 'OK', danger = false) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (done) return; done = true; m.close(); resolve(v); };
    const m = openModal({
      title, width: 420,
      body: h('p', { style: { margin: 0 } }, text),
      foot: [
        h('button.btn.ghost', { onclick: () => finish(false) }, 'Abbrechen'),
        h('button.btn' + (danger ? '.danger' : '.primary'), { onclick: () => finish(true) }, okLabel),
      ],
    });
    const origClose = m.close;
    m.close = () => { origClose(); if (!done) { done = true; resolve(false); } };
  });
}

function tabbed(tabs, active, onChange) {
  return h('div.modal-tabs', { role: 'tablist' }, tabs.map(([id, label]) =>
    h('button', { role: 'tab', 'aria-selected': String(id === active), onclick: () => onChange(id) }, label)));
}

async function copyText(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } }, text);
    document.body.append(ta); ta.select();
    try { document.execCommand('copy'); toast(msg); } catch { toast('Kopieren nicht möglich'); }
    ta.remove();
  }
}

/* ───────── Menü ───────── */
function toggleMenu() {
  const menu = $('#menu');
  if (!menu.hidden) { menu.hidden = true; return; }
  const isHost = Net.role !== 'guest';
  const item = (ic, label, fn, cls = '') => h('button' + cls, { role: 'menuitem', onclick: () => { menu.hidden = true; fn(); } }, icon(ic), label);
  const theme = Store.get('theme', 'system');
  const themeBtn = (mode, label) => h('button', { 'aria-pressed': String(theme === mode), onclick: e => { e.stopPropagation(); applyTheme(mode); toggleMenu(); toggleMenu(); } }, label);
  menu.replaceChildren(
    item('users', Net.role === 'solo' ? 'Freunde einladen' : 'Raum & Spieler', () => roomModal()),
    item('image', 'Als Bild speichern', () => exportPng()),
    item('link', 'Spieleliste als Link teilen', () => Share.open()),
    item('download', 'Exportieren (JSON)', () => exportJson()),
    ...(isHost ? [item('upload', 'Importieren (JSON)', () => importJson())] : []),
    item('library', 'Gespeicherte Räume', () => roomsModal()),
    h('div.menu-row',
      h('button', { role: 'menuitem', disabled: !Undo.undoStack.length, title: 'Strg + Z', onclick: () => { menu.hidden = true; Undo.undoLast(); } }, icon('rotate'), 'Rückgängig'),
      h('button', { role: 'menuitem', disabled: !Undo.redoStack.length, title: 'Strg + Umschalt + Z', onclick: () => { menu.hidden = true; Undo.redoLast(); } }, 'Wiederholen')),
    item('rotate', 'Meine Liste zurücksetzen', () =>
      confirmDialog('Liste zurücksetzen?', `Alle deine Platzierungen im Bereich „${App.board === 'games' ? 'Spiele' : 'Franchises'}“ werden entfernt.`, 'Zurücksetzen', true)
        .then(ok => ok && App.dispatch({ type: 'ranking/reset', board: App.board })
          && toast('Liste zurückgesetzt', 5000, { label: 'Rückgängig', onClick: () => Undo.undoLast() }))),
    item('edit', 'Hilfe & Tastatur', () => showTips()),
    item('lock', 'Datenschutz & Quellen', () => infoModal()),
    h('hr'),
    h('div.menu-label', 'Darstellung'),
    h('div.theme-row', themeBtn('system', 'System'), themeBtn('light', 'Hell'), themeBtn('dark', 'Dunkel')),
    h('button', {
      role: 'menuitemcheckbox', 'aria-checked': String(document.body.classList.contains('show-titles')),
      onclick: () => {
        const on = !document.body.classList.contains('show-titles');
        document.body.classList.toggle('show-titles', on);
        Store.set('showTitles', on);
        menu.hidden = true;
      },
    }, icon(document.body.classList.contains('show-titles') ? 'check' : 'image'), 'Titel auf Covern anzeigen'),
    h('div.menu-label', 'Kachelgröße'),
    h('div.slider-row', Layout.zoomSlider(), h('span.zoom-value', Math.round(Layout.s.zoom * 100) + ' %')),
    item('layers', 'Layout zurücksetzen', () => { Layout.reset(); toast('Größen zurückgesetzt'); }),
    h('hr'),
    item('logout', Net.role === 'solo' ? 'Zur Startseite' : 'Raum verlassen', () => {
      if (Net.role === 'host') confirmDialog('Raum schließen?', 'Solange du weg bist, können deine Freunde nicht weiter ranken. Du kannst den Raum später über „Fortsetzen“ wieder öffnen.', 'Verlassen', true).then(ok => ok && App.leave());
      else App.leave();
    }, '.danger'),
  );
  menu.hidden = false;
}

/* ───────── Datenschutz & Quellen ───────── */
function infoModal() {
  const section = (title, ...kids) => h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, h('h3', { style: { fontSize: '15px' } }, title), ...kids);
  const li = (strong, text) => h('li', h('strong', strong), ' – ', text);
  openModal({
    title: 'Datenschutz & Quellen', width: 560, autofocus: false,
    body: [
      section('Was wo gespeichert wird',
        h('p.help', 'Es gibt kein Konto und keinen eigenen Server. Name, Farbe, Einstellungen, Tiercrew-Räume und Listen, Gamedar-Spielstände und -Statistik sowie deine Duell-Historie (Bilanz gegen Freunde) liegen nur im Speicher deines Browsers (localStorage).'),
        h('p.help', 'Mitspielen geht direkt von Browser zu Browser (WebRTC), nicht über Dritte: Im Tiercrew-Raum teilt ihr eure Listen, im Duell bekommt dein Gegner Name, Farbe und deine Tipps.')),
      section('Welche Dienste angefragt werden',
        h('ul.info-list',
          li('PeerJS-Vermittlungsserver (0.peerjs.com)', 'nur zum Finden der Mitspieler über den Raum- bzw. Duell-Code; der Server sieht dabei deine IP-Adresse. Bei blockierten Direktverbindungen kann zusätzlich der PeerJS-Relay (TURN) genutzt werden.'),
          li('Wikipedia & Wikidata (Wikimedia Foundation)', 'für die Spielesuche, Cover, Szenen, Erscheinungsjahr und Reihe. Bilder werden direkt von upload.wikimedia.org geladen. Im Duell lädt sie der Browser des Erstellers und schickt dem Gegner nur den gerade sichtbaren Ausschnitt.'),
          li('Google STUN-Server', 'hilft beim Aufbau der Direktverbindung (ermittelt die öffentliche Adresse).'))),
      section('Quellen & Lizenzen',
        h('ul.info-list',
          li('Cover- und Szenen-Bilder', 'stammen aus der englischsprachigen Wikipedia bzw. Wikimedia Commons; die Rechte liegen bei den jeweiligen Publishern.'),
          li('Zitate', 'kurze Auszüge aus den Spielen, belegt über Wikiquote.'),
          li('Spieldaten', 'Wikidata (CC0) und Wikipedia.'),
          li('PeerJS 1.5.4', 'MIT-Lizenz, © Michelle Bu und Eric Zhang.'))),
      h('p.help', 'Tiercrew ' + APP_VERSION),
    ],
  });
}

/* ───────── Raum & Spieler ───────── */
function roomModal() {
  const s = App.state;
  let m;
  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });

  const draw = () => {
    body.replaceChildren();
    if (Net.role === 'solo') {
      body.append(
        h('p.help', 'Du rankst gerade allein. Öffne einen Raum, um deine Liste mit Freunden zu teilen – die Verbindung läuft direkt zwischen euren Browsern, ohne Server.'),
        h('button.btn.primary.lg.block', { onclick: () => { m.close(); App.goOnline(); } }, icon('users'), 'Raum öffnen & einladen'),
      );
    } else {
      const link = location.href.split('#')[0] + '#' + Net.code;
      const isFile = location.protocol === 'file:';
      const statusText = { online: 'Online', connecting: 'Verbinde …', offline: 'Offline' }[Net.status];
      body.append(
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' } },
          h('span.status-dot.' + Net.status), h('span.muted', `${statusText} · ${Net.role === 'host' ? 'Du bist Host' : 'Du bist Gast'}`)),
        h('div.room-code-big', Net.code),
        h('div', { style: { display: 'grid', gridTemplateColumns: isFile ? '1fr' : '1fr 1fr', gap: '8px' } },
          h('button.btn', { onclick: () => copyText(Net.code, 'Code kopiert') }, icon('copy'), 'Code kopieren'),
          isFile ? null : h('button.btn', { onclick: () => copyText(link, 'Einladungslink kopiert') }, icon('link'), 'Link kopieren')),
        h('p.help', isFile
          ? 'So laden deine Freunde ein: Schick ihnen diese HTML-Datei und den Code. Sie öffnen die Datei im Browser, geben ihren Namen und den Code ein – fertig. Der Raum bleibt online, solange der Host-Tab offen ist.'
          : 'Schick deinen Freunden den Link oder den Code. Der Raum bleibt online, solange der Host-Tab offen ist.'),
        h('p.help', 'Fällt der Host aus, übernimmt automatisch der dienstälteste Gast. ',
          h('button.linkish', { type: 'button', onclick: () => diagModal() }, 'Verbindung testen')),
      );
    }

    // Spielerliste
    const players = App.sortedPlayers();
    body.append(h('h3', { style: { fontSize: '15px', marginTop: '4px' } }, `Spieler (${players.length})`));
    body.append(h('div', players.map(p => {
      const r = s.rankings[p.id] || {};
      const isHost = p.id === s.hostId;
      return h('div.player-row',
        avatar(p, App.board),
        h('span.name', p.name, p.id === App.me.id ? h('span.tag', ' (du)') : null),
        isHost ? h('span.pill', { title: 'Host' }, icon('crown', ''), '') : null,
        r.ready?.games ? h('span.pill.ok', 'Spiele ✓') : null,
        r.ready?.franchises ? h('span.pill.ok', 'Franchises ✓') : null,
        Net.role === 'solo' ? null : h('span.pill' + (p.online ? '.ok' : ''), p.online ? 'online' : 'offline'),
        Net.role === 'host' && !p.online && !isHost ? h('button.icon-btn.sm', {
          title: 'Spieler entfernen', 'aria-label': `${p.name} entfernen`,
          onclick: () => confirmDialog(`${p.name} entfernen?`, 'Der Spieler und seine Rankings werden aus dem Raum gelöscht.', 'Entfernen', true)
            .then(ok => { if (ok && App.dispatch({ type: 'player/remove', pid: p.id })) draw(); }),
        }, icon('trash')) : null,
      );
    })));

    // Eigenes Profil
    const nameIn = h('input', { value: App.me.name, maxlength: 20, 'aria-label': 'Dein Name' });
    const colors = h('div.color-pick', PLAYER_COLORS.map(c => h('button.color-dot', {
      type: 'button', role: 'radio', 'aria-checked': String(c === App.me.color), style: { background: c },
      onclick: () => { App.me.color = c; saveProfile(); draw(); },
    })));
    const saveProfile = () => {
      const name = nameIn.value.trim();
      if (name) App.me.name = name;
      Store.set('me', App.me);
      App.dispatch({ type: 'player/update', name: App.me.name, color: App.me.color });
    };
    nameIn.addEventListener('change', saveProfile);
    body.append(h('h3', { style: { fontSize: '15px', marginTop: '4px' } }, 'Dein Profil'), nameIn, colors);

    if (Net.role === 'host') {
      const cb = h('input', { type: 'checkbox', checked: !!s.settings.hostOnlyEdit, onchange: e => App.dispatch({ type: 'settings', hostOnlyEdit: e.target.checked }) });
      const blind = h('input', { type: 'checkbox', checked: !!s.settings.blind, onchange: e => { App.dispatch({ type: 'settings', blind: e.target.checked }); draw(); } });
      body.append(
        h('label.switch-row',
          h('span', h('strong', 'Verdeckt ranken'), h('br'), h('span.help', 'Listen der anderen und das Gruppenergebnis bleiben verborgen, bis du aufdeckst.')),
          h('span.switch', blind, h('span'))),
        s.settings.blind ? h('div.lib-list', BOARDS.map(b => {
          const st = readyStats(b);
          const open = !isBlind(s, b);
          return h('div.room-row',
            h('div.lib-meta', h('strong', b === 'games' ? 'Spiele' : 'Franchises'),
              h('span', open ? 'Aufgedeckt' : `Verdeckt · ${st.ready} von ${st.total} fertig`)),
            open
              ? h('button.btn.sm', { onclick: () => { m.close(); newRound(b); } }, icon('rotate'), 'Neue Runde')
              : h('button.btn.sm.primary', { onclick: () => { m.close(); revealNow(b); } }, icon('eye'), 'Aufdecken'));
        })) : '',
        h('label.switch-row',
          h('span', h('strong', 'Nur ich bearbeite Spiele & Stufen'), h('br'), h('span.help', 'Freunde können dann nur noch ranken.')),
          h('span.switch', cb, h('span'))),
        h('label.switch-row',
          h('span', h('strong', 'Bilder nur von Wikipedia & Uploads'), h('br'), h('span.help', 'Schützt vor fremden Bild-Links, die eure IP-Adressen an beliebige Server verraten würden.')),
          h('span.switch', h('input', {
            type: 'checkbox', checked: s.settings.safeImages !== false,
            onchange: e => { App.dispatch({ type: 'settings', safeImages: e.target.checked }); TileCache.clear(); App.render(); },
          }), h('span'))));
    } else if (s.settings?.blind) {
      body.append(h('p.help', icon('lock', 'lock-ico'), ' Verdeckter Modus: Die Listen der anderen siehst du erst, wenn der Host aufdeckt.'));
    }
  };
  draw();
  m = openModal({ title: Net.role === 'solo' ? 'Freunde einladen' : 'Raum & Spieler', body, width: 480, autofocus: false });
}

/* ───────── Detailansicht einer Kachel ───────── */
function itemModal(id) {
  const s = App.state;
  const board = App.board;
  const item = boardItems(s, board).find(x => x.id === id);
  if (!item) return;
  const { votes, skipped } = groupView(s, board);
  const v = votes.get(id) || [];
  const sk = skipped.get(id) || [];
  const rated = ratedTiers(s);
  const tierOf = ti => rated[ti];
  const isFr = board === 'franchises';

  const meta = isFr
    ? `${item.count} Spiele · ${item.year}${item.yearTo !== item.year ? '–' + item.yearTo : ''}`
    : [item.year, item.franchise].filter(Boolean).join(' · ');
  const genres = (item.genres || []).map(genreName).join(', ');

  const body = [
    h('div.item-hero', makeTile(item, {}), h('div', h('h3', item.title), h('div.muted', meta), genres ? h('div.muted', genres) : null)),
  ];

  if (v.length) {
    const mean = v.reduce((a, x) => a + x.ti, 0) / v.length;
    const avgTier = tierOf(clamp(Math.round(mean), 0, rated.length - 1));
    const spread = Math.max(...v.map(x => x.ti)) - Math.min(...v.map(x => x.ti));
    body.push(h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
      h('span.muted', 'Gruppe:'), h('span.tier-badge', { style: { background: avgTier.color } }, avgTier.name),
      h('span.muted', `aus ${v.length} ${v.length === 1 ? 'Wertung' : 'Wertungen'}`),
      spread >= 3 ? h('span.pill', 'Umstritten') : spread === 0 && v.length > 1 ? h('span.pill.ok', 'Einig') : null));
  } else if (sk.length) {
    body.push(h('p.help', 'Bisher nur in Stufen ohne Wertung – zählt nicht fürs Gruppenergebnis.'));
  }

  const rows = App.sortedPlayers().map(p => {
    const vote = v.find(x => x.pid === p.id);
    const t = vote ? tierOf(vote.ti) : s.tiers.find(x => x.id === sk.find(y => y.pid === p.id)?.tid);
    return h('div.vote-row', avatar(p, board), h('span.name', p.name),
      t ? h('span.tier-badge' + (t.unrated ? '.unrated' : ''), { style: { backgroundColor: t.color }, title: t.unrated ? 'Zählt nicht in der Wertung' : null }, t.name) : h('span.muted', '–'));
  });
  body.push(h('div.vote-list', rows));

  if (isFr) {
    body.push(h('h3', { style: { fontSize: '15px' } }, 'Enthaltene Spiele'),
      h('div.lib-list', [...item.games].sort((a, b) => (a.year || 0) - (b.year || 0)).map(g =>
        h('div.lib-item', makeTile(g, {}), h('div.lib-meta', h('strong', g.title), h('span', g.year || '')), h('span')))));
  }

  const foot = !isFr && App.canEditConfig()
    ? [h('button.btn', { onclick: () => { m.close(); editItemModal(id); } }, icon('edit'), 'Bearbeiten')]
    : null;
  const m = openModal({ title: isFr ? 'Franchise' : 'Spiel', body, foot, width: 440 });
}
