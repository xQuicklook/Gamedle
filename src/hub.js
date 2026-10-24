/* ───────── Übersicht & Navigation ─────────
   #/            → Übersicht
   #/gamedle     → Gamedle (…/cover, …/endless)
   #/tierly      → Tierly
   #ABC123       → Tierly-Einladungslink (Raum-Code) – bleibt wie bisher gültig */
const Router = {
  current: null,

  init() {
    Gamedle.init();
    window.addEventListener('hashchange', () => this.route());
    this.route();
  },

  route() {
    const hash = location.hash;
    if (/^#\/gamedle/.test(hash)) this.show('gamedle', hash.split('/')[2]);
    else if (hash === '#/tierly' || /^#[A-Z0-9]{6}$/i.test(hash)) this.show('tierly');
    else this.show('hub');
  },

  show(view, sub) {
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
    document.title = { hub: 'Gamedle – Spiele-Rätsel & Tier-Listen', gamedle: 'Gamedle – Spiel des Tages', tierly: 'Tierly – Game Tierlist' }[view];
    if (view === 'gamedle') Gamedle.open(sub);
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
