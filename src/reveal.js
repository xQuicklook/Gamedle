/* ───────── Verdecktes Ranken & Aufdecken ─────────
   Solange ein Board verdeckt ist, schickt der Host jedem Gast nur dessen eigene Liste
   (siehe visibleState). Die Oberfläche zeigt statt fremder Listen einen Sperrbildschirm
   mit dem Fortschritt aller. Beim Aufdecken läuft eine kurze Enthüllung: Countdown,
   dann erscheinen die Stufen von unten nach oben. */
const Reveal = { running: false, timers: [], overlay: null, notified: {} };

/* Wer ist (online) und wer davon fertig? */
function readyStats(board) {
  const s = App.state;
  const online = Object.values(s.players).filter(p => p.online);
  return { total: online.length, ready: online.filter(p => s.rankings[p.id]?.ready?.[board]).length };
}

/* Host: einmalig Bescheid geben, sobald alle fertig sind */
function checkAllReady() {
  if (Net.role !== 'host' || !App.state) return;
  for (const b of BOARDS) {
    const st = readyStats(b);
    const all = App.hidden(b) && st.total >= 2 && st.ready === st.total;
    if (all && !Reveal.notified[b]) toast(`Alle sind fertig mit den ${b === 'games' ? 'Spielen' : 'Franchises'} – du kannst aufdecken!`, 5000);
    Reveal.notified[b] = all;
  }
}

function lockedPanel(board) {
  const s = App.state;
  const st = readyStats(board);
  const total = boardItems(s, board).length;
  const all = st.total > 0 && st.ready === st.total;
  const hostName = s.players[s.hostId]?.name || 'der Host';
  const meReady = !!s.rankings[App.me.id]?.ready?.[board];

  return h('div.locked',
    h('div.locked-ico', icon('lock')),
    h('h2', 'Verdeckt bis zum Aufdecken'),
    h('p.muted', 'Ihr rankt blind: Niemand sieht die Listen der anderen – auch nicht das Gruppenergebnis –, bis aufgedeckt wird.'),
    h('div.locked-players', App.sortedPlayers().map(p => {
      const n = placedCount(s, p.id, board);
      const ready = !!s.rankings[p.id]?.ready?.[board];
      return h('div.locked-row',
        avatar(p, board),
        h('span.name', p.name, p.id === App.me.id ? h('span.tag', ' (du)') : null),
        h('div.progress' + (ready ? '.ok' : ''), h('i', { style: { width: (total ? Math.round((n / total) * 100) : 0) + '%' } })),
        h('span.count-text', ready ? 'fertig ✓' : `${n}/${total}`));
    })),
    Net.role === 'host'
      ? h('button.btn.lg' + (all ? '.primary.pulse' : ''), { onclick: () => revealNow(board) }, icon('eye'), all ? 'Alle fertig – aufdecken!' : 'Jetzt aufdecken')
      : h('p.help', all ? `Alle sind fertig – ${hostName} kann jetzt aufdecken.` : `Sobald alle fertig sind, deckt ${hostName} auf.`),
    meReady ? null : h('button.btn', { onclick: () => App.dispatch({ type: 'ready', board, value: true }) }, icon('check'), 'Ich bin fertig'),
  );
}

async function revealNow(board) {
  const st = readyStats(board);
  if (st.ready < st.total) {
    const ok = await confirmDialog('Jetzt schon aufdecken?', `Erst ${st.ready} von ${st.total} sind fertig. Trotzdem alle Listen aufdecken?`, 'Aufdecken');
    if (!ok) return;
  }
  App.dispatch({ type: 'reveal', board, value: true });
}

async function newRound(board) {
  const ok = await confirmDialog('Neue Runde starten?', 'Die Listen werden wieder verdeckt und alle müssen erneut „Fertig“ melden. Die Platzierungen bleiben erhalten.', 'Neue Runde');
  if (ok && App.dispatch({ type: 'reveal', board, value: false })) {
    App.setView('me');
    toast('Wieder verdeckt – neue Runde!');
  }
}

/* Die Enthüllung: Countdown, dann Stufe für Stufe von unten nach oben */
function playReveal(board) {
  finishReveal(false);
  App.board = board;
  App.view = 'group';
  App.sel = [];
  $('#menu').hidden = true;
  // Gerade in Gamedle oder auf der Übersicht? Dann nur Bescheid geben statt die Seite zu überdecken
  if ($('#app').hidden) {
    toast('Tiercrew: Die Listen wurden aufgedeckt!', 10000, { label: 'Ansehen', onClick: () => { location.hash = '#/tiercrew'; } });
    return;
  }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || Drag.active) {
    App.render();
    toast('Aufgedeckt!');
    return;
  }
  Reveal.running = true;
  App.render();
  $('#boardWrap').scrollTop = 0;

  const boardEl = $('#board');
  boardEl.classList.add('revealing');
  const rows = [...boardEl.querySelectorAll('.tier')].reverse();
  let t = 2.2; // nach dem Countdown
  rows.forEach((row, i) => {
    const isTop = i === rows.length - 1;
    if (isTop && rows.length > 1) t += 0.6; // kurze Spannungspause vor der besten Stufe
    row.style.setProperty('--d', t + 's');
    if (isTop) row.classList.add('reveal-top');
    const tiles = [...row.querySelectorAll('.tile')];
    const step = Math.min(0.08, 0.9 / Math.max(1, tiles.length));
    tiles.forEach((tile, j) => tile.style.setProperty('--d', (t + 0.25 + j * step).toFixed(2) + 's'));
    t += 0.4 + tiles.length * step;
  });

  const count = h('div.reveal-count', '3');
  const overlay = h('div.reveal-overlay', { onclick: () => finishReveal() },
    h('div.reveal-box',
      h('div.reveal-kicker', board === 'games' ? 'Das Gruppenergebnis' : 'Die Franchise-Wertung'),
      count,
      h('button.btn.sm.ghost', { style: { color: '#fff' }, onclick: e => { e.stopPropagation(); finishReveal(); } }, 'Überspringen')));
  document.body.append(overlay);
  Reveal.overlay = overlay;

  const later = (fn, s) => Reveal.timers.push(setTimeout(fn, s * 1000));
  later(() => { count.textContent = '2'; count.style.animation = 'none'; void count.offsetWidth; count.style.animation = ''; }, 0.7);
  later(() => { count.textContent = '1'; count.style.animation = 'none'; void count.offsetWidth; count.style.animation = ''; }, 1.4);
  later(() => { overlay.classList.add('out'); }, 2.05);
  later(() => { overlay.remove(); }, 2.5);
  later(() => finishReveal(), t + 1.2);
}

function finishReveal(rerender = true) {
  Reveal.timers.forEach(clearTimeout);
  Reveal.timers = [];
  Reveal.overlay?.remove();
  Reveal.overlay = null;
  const wasRunning = Reveal.running;
  Reveal.running = false;
  $('#board')?.classList.remove('revealing');
  if (rerender && wasRunning) App.render();
}

document.addEventListener('keydown', e => { if (e.key === 'Escape' && Reveal.running) finishReveal(); });
