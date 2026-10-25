/* ───────── Übersicht & Navigation ─────────
   #/            → Übersicht
   #/gamedar     → Gamedar (…/cover, …/endless, …/duell[/CODE])
   #/tiercrew    → Tiercrew
   #/paket/…     → geteilte Spieleliste (siehe Share in export.js)
   #ABC123       → Tiercrew-Einladungslink (Raum-Code) – bleibt wie bisher gültig
   Intern heißen die Module weiter „gamedle“ und „tierly“ (frühere Namen); deren alte
   Adressen #/gamedle… und #/tierly leiten auf die neuen um, damit geteilte Links gültig bleiben. */
const LEGACY_ROUTES = { gamedle: 'gamedar', tierly: 'tiercrew' };

const Router = {
  current: null,

  init() {
    Gamedle.init();
    window.addEventListener('hashchange', () => this.route());
    this.route();
  },

  route() {
    let hash = location.hash;
    const legacy = hash.match(/^#\/(gamedle|tierly)(\/.*)?$/);
    if (legacy) {
      hash = '#/' + LEGACY_ROUTES[legacy[1]] + (legacy[2] || '');
      history.replaceState(null, '', hash);
    }
    if (/^#\/paket\//.test(hash)) {
      // Geteilte Spieleliste: Adresse zurück auf Tiercrew bzw. den offenen Raum, dann anbieten
      history.replaceState(null, '', App.state && Net.code ? '#' + Net.code : '#/tiercrew');
      this.show('tierly');
      Share.receive(hash.slice('#/paket/'.length));
      return;
    }
    if (/^#\/gamedar/.test(hash)) this.show('gamedle', ...hash.split('/').slice(2, 4));
    else if (hash === '#/tiercrew' || /^#[A-Z0-9]{6}$/i.test(hash)) this.show('tierly');
    else this.show('hub');
  },

  show(view, sub, extra) {
    if (this.current === 'gamedle' && view !== 'gamedle') Gamedle.close();
    if (this.current && this.current !== view) closeAllModals(); // z. B. Zurück-Taste bei offenem Fenster
    this.current = view;
    const tierlyActive = !!App.state && !$('#app').hidden;
    $('#hub').hidden = view !== 'hub';
    $('#gamedle').hidden = view !== 'gamedle';
    // Tierly: im Raum bleibt die App sichtbar, sonst die Tierly-Startseite
    $('#landing').hidden = view !== 'tierly' || !!App.state;
    $('#app').hidden = view !== 'tierly' || !App.state;
    if (view === 'tierly' && App.state && !tierlyActive) App.render();
    document.title = { hub: 'Gamedar – Spiele-Rätsel & Tier-Listen', gamedle: 'Gamedar – Spiel des Tages', tierly: 'Tiercrew – Tier-Listen mit Freunden' }[view];
    if (view === 'gamedle') Gamedle.open(sub, extra);
    if (view === 'hub') this.renderHub();
    window.scrollTo(0, 0);
  },

  renderHub() {
    const today = Store.get('gd.progress', {})[gdToday()] || {};
    const total = GD_DAILY_MODES.length;
    const solved = GD_DAILY_MODES.filter(m => today[m]?.done).length;
    $('#hubBadge').textContent = solved === total ? 'Heute alles gelöst ✓' : solved ? `Heute ${solved} von ${total} gelöst` : `#${gdDayNumber(gdToday())} wartet`;
    // Ein offener Tierly-Raum läuft im Hintergrund weiter
    const open = !!App.state;
    $('#hubTierlyBadge').textContent = !open ? '' : Net.role === 'solo' ? 'Solo-Liste offen' : `Raum ${Net.code} offen`;
    $('#hubTierlyCta').textContent = open ? 'Zurück zur Tier-Liste →' : 'Tier-Liste starten →';
  },
};

Router.init();
