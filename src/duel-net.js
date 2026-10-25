/* ───────── Gamedar-Duell: Verbindung ─────────
   Der Ersteller („Host“) führt den Schiedsrichter (duel-core.js) in seinem Browser, der Gast ist per PeerJS
   verbunden – wie bei Tiercrew, nur zu zweit. Beide Seiten bekommen dasselbe: Ansichten (duelView) mit der
   Uhrzeit des Hosts und fertig vorbereitete Bilder. Ein späterer Server kann den Platz des Hosts einnehmen,
   ohne dass sich an Schiedsrichter oder Oberfläche etwas ändert.

   Gast → Host:  hello {v, player} · guess {n, id} · pong {at} · leave · rematch
   Host → Gast:  welcome {v, host, settings} · view {now, rtt, view} · media {key, src} · ping {at}
                 result {n, id, why} (abgewiesener Tipp) · reject {reason} · rematch · leave

   Faire Zeitmessung: Der Gast sieht alles eine halbe Laufzeit später, und sein Tipp ist noch einmal eine halbe
   Laufzeit unterwegs – darum zählt ein Tipp des Gasts um die volle Laufzeit (höchstens DUEL_MAX_LAG) früher. */
const DUEL_PROTOCOL = 1;
const DUEL_PEER_PREFIX = 'gamedar-duel-v1-';
const DUEL_TICK_MS = 1000;   // Sicherheitsnetz – eigentlich weckt der Wecker den Host genau zum nächsten Ereignis
const DUEL_PING_MS = 2000;   // Laufzeitmessung
const DUEL_GRACE_MS = 15000; // so lange darf die Verbindung weg sein, danach gilt das Duell als aufgegeben
const DUEL_MAX_LAG = 300;    // höchstens so viel Laufzeit wird einem Tipp gutgeschrieben

const duelText = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/* Spieler aus einer Nachricht – nur geprüfte, kurze Felder */
function duelPlayer(p) {
  const id = duelText(p?.id, 24);
  if (!id) return null;
  return { id, name: duelText(p.name, 20) || 'Gast', color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#8b8f9c' };
}

/* Was sich an einer Ansicht geändert hat – ohne die Zeitangaben, die duelAge selbst nachrechnet */
function duelViewKey(view) {
  const { startsIn, timeLeft, worth, nextIn, me, ...rest } = view;
  return JSON.stringify({ ...rest, me: me && { ...me, lockedFor: undefined } });
}

/* Schlüssel eines vorbereiteten Bildes zu einer Ansicht (Runde und Ersatz-Versuch, damit sich ein ersetztes
   Spiel nie mit dem neuen mischt); Stufen jenseits der letzten zeigen dasselbe (scharfe bzw. ganze) Bild */
function duelMediaKey(view, kind, step) {
  const last = kind === 'cover' ? GD_COVER_LEVELS.length : kind === 'scene' ? GD_SCENE_ZOOM.length : 0;
  return `${view.n}.${view.attempt}:${kind}:${Math.min(step, last)}`;
}

/* Bilder zu einer Ansicht: [{ key, kind, step, deliver }] – deliver: false heißt nur vorbereiten
   (Startbild im Countdown, nächste Stufe, Unschärfe-Tipp im Klassik-Modus) */
function duelMediaJobs(view, round) {
  const jobs = [];
  const add = (kind, step, deliver) => jobs.push({ key: duelMediaKey(view, kind, step), kind, step, deliver });
  if (view.phase === 'countdown' && (round.mode === 'cover' || round.mode === 'scene')) add(round.mode, 0, false);
  const image = view.clue?.image;
  if (image) {
    add(image.kind, image.step, true);
    if (image.step < DUEL_ALL) add(image.kind, image.step + 1, false);
  }
  if (view.clue?.hints.some(x => x.kind === 'cover')) add('blur', 0, true);
  else if (view.phase === 'play' && round.mode === 'classic' && !GD_NO_COVER.has(GD_BY_ID.get(round.gameId).title)) add('blur', 0, false);
  return jobs;
}

/* ── Host: Schiedsrichter, Uhr und Nachrichten an den Gast ──
   Ohne Netz und Oberfläche testbar: send (an den Gast), onView/onMedia (eigene Anzeige), onGuest (Gast da/weg),
   onRematch (Gast möchte Revanche) setzt der Aufrufer; media(job, game) bereitet ein Bild vor (Daten-URL). */
function duelRoom({ settings, host, today, now = () => Date.now(), seed = () => String(Math.random()).slice(2), media = null }) {
  const room = {
    settings, host, guest: null, state: null,
    online: false, lostAt: null, rtt: 0,
    send() {}, onView() {}, onMedia() {}, onGuest() {}, onRematch() {},
    wake() {},                                 // wake(Zeitpunkt): Wecker für das nächste Ereignis stellen
    keys: { local: '', remote: '' },          // zuletzt gezeigte bzw. verschickte Ansicht
    shown: { local: new Set(), remote: new Set() },
    images: new Map(),                         // Bild-Schlüssel → Promise<Daten-URL | null>
    round: 0,

    /* Gast prüfen und aufnehmen (auch nach einem Abbruch) – Rückgabe: Ablehnungsgrund oder null */
    admit(msg) {
      if (Number(msg?.v) !== DUEL_PROTOCOL) return 'version';
      const p = duelPlayer(msg.player);
      if (!p) return 'invalid';
      if (p.id === host.id) return 'self';
      if (room.guest && room.guest.id !== p.id) return 'full';
      room.guest = p;
      room.state ||= duelCreate({ ...settings, players: [host.id, p.id], seed: seed(), today });
      return null;
    },

    /* Die Verbindung zum aufgenommenen Gast steht – alles Nötige (neu) schicken */
    connected(at = now()) {
      room.online = true;
      room.lostAt = null;
      room.keys.remote = '';
      room.shown.remote.clear();
      room.send({ t: 'welcome', v: DUEL_PROTOCOL, host, settings });
      room.onGuest(room.guest, true);
      room.tick(at);
    },

    lost(at = now()) {
      if (!room.online) return;
      room.online = false;
      room.lostAt = at;
      room.onGuest(room.guest, false);
    },

    start(at = now()) {
      if (!room.state || !room.guest) return;
      duelStart(room.state, at);
      room.tick(at);
    },

    /* Revanche: neues Duell mit denselben Einstellungen, sofort mit Countdown */
    rematch(at = now()) {
      if (!room.guest) return;
      room.state = duelStart(duelCreate({ ...settings, players: [host.id, room.guest.id], seed: seed(), today }), at);
      room.images.clear();
      room.shown.local.clear();
      room.shown.remote.clear();
      room.send({ t: 'rematch' });
      room.tick(at);
    },

    /* Tipp des Hosts */
    guess(n, id, at = now()) {
      if (!room.state) return { ok: false, why: 'invalid' };
      const r = duelGuess(room.state, host.id, n, id, at);
      room.tick(at);
      return r;
    },

    /* Nachricht vom Gast; at = Eingangszeit */
    receive(msg, at = now()) {
      if (!msg || typeof msg !== 'object' || !room.guest) return;
      if (msg.t === 'pong') {
        const sample = at - Number(msg.at);
        if (sample >= 0 && sample < 10000) room.rtt = room.rtt ? Math.round(room.rtt * 0.7 + sample * 0.3) : sample;
      } else if (msg.t === 'guess' && room.state) {
        const id = duelText(msg.id, 80);
        const r = duelGuess(room.state, room.guest.id, Number(msg.n), id, at - Math.min(room.rtt, DUEL_MAX_LAG));
        if (!r.ok) room.send({ t: 'result', n: Number(msg.n), id, why: r.why });
        room.tick(at);
      } else if (msg.t === 'leave') room.leave(room.guest.id, at);
      else if (msg.t === 'rematch') room.onRematch(room.guest);
    },

    ping(at = now()) {
      if (room.online) room.send({ t: 'ping', at });
    },

    /* pid verlässt das Duell und verliert – vor der ersten Runde gibt es kein Ergebnis */
    leave(pid = host.id, at = now()) {
      if (room.state?.round) duelForfeit(room.state, pid, at);
      room.tick(at);
      if (pid === host.id) room.send({ t: 'leave' });
    },

    tick(at = now()) {
      const s = room.state;
      if (!s) return;
      if (!room.online && room.lostAt != null && at - room.lostAt >= DUEL_GRACE_MS && s.round && !s.over) duelForfeit(s, room.guest.id, at);
      duelTick(s, at);
      // Neue Runde: Bilder der alten nicht mehr aufheben
      if (s.round && s.round.n !== room.round) {
        room.round = s.round.n;
        for (const key of room.images.keys()) if (!key.startsWith(room.round + '.')) room.images.delete(key);
      }
      room.deliver(at, host.id, 'local');
      if (room.online) room.deliver(at, room.guest.id, 'remote');
      // Nächstes Ereignis: Rundenstart, Hinweis-Stufe, Rundenende, nächste Runde – oder Ende der Gnadenfrist
      const grace = !room.online && room.lostAt != null && !s.over ? room.lostAt + DUEL_GRACE_MS : null;
      const next = [duelNextEvent(s, at), grace].filter(x => x != null);
      if (next.length) room.wake(Math.min(...next));
    },

    deliver(at, pid, to) {
      const s = room.state;
      const view = duelView(s, pid, at);
      const key = duelViewKey(view);
      if (key !== room.keys[to]) {
        room.keys[to] = key;
        if (to === 'local') room.onView(view, at);
        else room.send({ t: 'view', now: at, rtt: room.rtt, view });
      }
      if (s.round && media) for (const job of duelMediaJobs(view, s.round)) room.image(job, s.round, to);
    },

    /* Bild einmal je Schlüssel vorbereiten und – falls gefragt – zustellen, sobald es fertig ist */
    image(job, round, to) {
      if (!room.images.has(job.key)) {
        const ready = Promise.resolve().then(() => media(job, GD_BY_ID.get(round.gameId))).catch(() => null);
        room.images.set(job.key, ready);
        // Lädt das Startbild der laufenden Runde nicht, kommt ein anderes Spiel dran (Countdown von vorn)
        if (job.kind !== 'blur' && job.step === 0) ready.then(src => {
          const r = room.state?.round;
          if (!src && r && r.gameId === round.gameId && !r.endedAt && !room.state.over) { duelSkipGame(room.state, now()); room.tick(); }
        });
      }
      if (!job.deliver || room.shown[to].has(job.key)) return;
      room.shown[to].add(job.key);
      room.images.get(job.key).then(src => {
        if (!src) return;
        if (to === 'local') room.onMedia(job.key, src);
        else if (room.online) room.send({ t: 'media', key: job.key, src });
        else room.shown.remote.delete(job.key);
      });
    },
  };
  return room;
}

/* ── Gast: Ansichten und Bilder vom Host empfangen, Tipps schicken (ebenfalls ohne Netz testbar) ── */
function duelClient({ me, now = () => Date.now() }) {
  const c = {
    me, host: null, settings: null, view: null, viewAt: 0, offset: 0, media: new Map(),
    send() {}, onWelcome() {}, onView() {}, onMedia() {}, onResult() {}, onReject() {}, onRematch() {}, onLeave() {},

    hello() { c.send({ t: 'hello', v: DUEL_PROTOCOL, player: me }); },

    receive(msg, at = now()) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'ping') c.send({ t: 'pong', at: msg.at });
      else if (msg.t === 'welcome') {
        c.host = duelPlayer(msg.host);
        c.settings = msg.settings;
        c.onWelcome(c.host, c.settings);
      } else if (msg.t === 'view' && msg.view) {
        // Uhr des Hosts schätzen: Die Nachricht war eine halbe Laufzeit unterwegs
        c.offset = Number(msg.now) + (Number(msg.rtt) || 0) / 2 - at;
        if (msg.view.n !== c.view?.n) for (const key of c.media.keys()) if (!key.startsWith(msg.view.n + '.')) c.media.delete(key);
        c.view = msg.view;
        c.viewAt = Number(msg.now);
        c.onView(c.current(at));
      } else if (msg.t === 'media') {
        // Nur fertige Bilder als Daten-URL – nie eine fremde Adresse laden
        if (typeof msg.key !== 'string' || !/^data:image\/(png|jpeg);base64,/.test(msg.src)) return;
        c.media.set(msg.key, msg.src);
        c.onMedia(msg.key, msg.src);
      } else if (msg.t === 'result') c.onResult(msg);
      else if (msg.t === 'reject') c.onReject(msg.reason);
      else if (msg.t === 'rematch') { c.media.clear(); c.onRematch(); }
      else if (msg.t === 'leave') c.onLeave();
    },

    /* Ansicht jetzt – zwischen zwei Nachrichten läuft die Uhr lokal weiter */
    current(at = now()) { return c.view && duelAge(c.view, at + c.offset - c.viewAt); },
    guess(id) { if (c.view?.phase === 'play') c.send({ t: 'guess', n: c.view.n, id }); },
    rematch() { c.send({ t: 'rematch' }); },
    leave() { c.send({ t: 'leave' }); },
  };
  return c;
}

/* ───────── Ab hier nur im Browser ───────── */

/* Wecker für den Host: Timer verdeckter Tabs drosselt der Browser (mindestens auf 1 s), ein Worker weckt
   pünktlicher. Ohne Worker (z. B. als Datei geöffnet) übernimmt setTimeout. */
function duelAlarm(onWake) {
  let pending = null, worker = null, timer = null;
  const fire = () => { pending = null; onWake(); };
  try {
    worker = new Worker(URL.createObjectURL(new Blob(['onmessage = e => setTimeout(() => postMessage(0), e.data);'], { type: 'text/javascript' })));
    worker.onmessage = fire;
  } catch { worker = null; }
  return {
    at(time) {
      if (pending != null && pending < Date.now() - 100) pending = null; // verpasster Wecker
      if (pending != null && pending <= time) return; // früherer Wecker steht schon
      pending = time;
      const ms = Math.max(0, time - Date.now()) + 1;
      if (worker) worker.postMessage(ms);
      else { clearTimeout(timer); timer = setTimeout(fire, ms); }
    },
    stop() { worker?.terminate(); clearTimeout(timer); },
  };
}

/* Bildadressen (Wikipedia), je Spiel einmal geholt */
const duelUrls = new Map();
function duelImageUrl(kind, game) {
  const key = (kind === 'scene' ? 'scene:' : 'cover:') + game.id;
  if (!duelUrls.has(key)) {
    duelUrls.set(key, (async () => {
      if (kind !== 'scene') return (await Wiki.byTitles([game.wiki])).get(game.wiki)?.img || null;
      const data = await Wiki.api({ action: 'query', titles: 'File:' + GD_SCENES[game.id][0], prop: 'imageinfo', iiprop: 'url', iiurlwidth: '960' });
      const info = data.query?.pages?.[0]?.imageinfo?.[0];
      return info ? (info.thumburl || info.url).replace(/\?utm_[^#]*$/, '') : null;
    })().catch(() => { duelUrls.delete(key); return null; }));
  }
  return duelUrls.get(key);
}

/* Bild einer Stufe als Daten-URL – nur die Stufe, nie das ganze Bild oder seine Adresse.
   Cover verpixelt (gdPixelate), Szene als Ausschnitt (gdZoom), Unschärfe-Tipp winzig wie gdBlurCanvas. */
async function duelStageImage(job, game) {
  const url = await duelImageUrl(job.kind === 'scene' ? 'scene' : 'cover', game);
  if (!url) return null;
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = 'anonymous'; // Wikimedia erlaubt das – sonst ließe sich die Leinwand nicht auslesen
    i.referrerPolicy = 'no-referrer';
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = url;
  });
  if (job.kind === 'blur') {
    const c = document.createElement('canvas');
    c.width = 9; c.height = 12;
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }
  if (job.kind === 'cover') {
    const level = GD_COVER_LEVELS[job.step] || 0;
    return level ? gdPixelate(img, level).toDataURL('image/png') : gdPixelate(img, 0).toDataURL('image/jpeg', 0.85);
  }
  const [, fx = 50, fy = 50] = GD_SCENES[game.id];
  return gdZoom(img, GD_SCENE_ZOOM[Math.min(job.step, GD_SCENE_ZOOM.length)] || 1, fx, fy).toDataURL('image/jpeg', 0.82);
}

/* PeerJS – Host: Raum öffnen und genau einen Gast annehmen.
   h: open(code), hello(msg) → Ablehnungsgrund | null, connected(at), message(msg, at), lost(at), error(text) */
function duelPeerHost(h) {
  let code = roomCode(), peer = null, conn = null, closed = false, taken = 0;
  const open = () => {
    peer = new Peer(DUEL_PEER_PREFIX + code, { debug: 0 });
    const self = peer;
    peer.on('open', () => h.open(code));
    peer.on('connection', c => {
      c.on('data', msg => {
        const at = Date.now();
        if (msg?.t === 'hello') {
          const reason = h.hello(msg);
          if (reason) { try { c.send({ t: 'reject', reason }); } catch { /* egal */ } setTimeout(() => c.close(), 500); return; }
          if (conn && conn !== c) try { conn.close(); } catch { /* egal */ }
          conn = c;
          h.connected(at);
        } else if (c === conn) h.message(msg, at);
      });
      const drop = () => { if (c === conn) { conn = null; h.lost(Date.now()); } };
      c.on('close', drop);
      c.on('error', drop);
    });
    peer.on('disconnected', () => { if (!closed && !self.destroyed) setTimeout(() => !self.destroyed && self.disconnected && self.reconnect(), 2000); });
    peer.on('error', err => {
      if (closed || self !== peer) return;
      // Code zufällig schon vergeben → neuer Code (noch kennt ihn niemand)
      if (err.type === 'unavailable-id' && ++taken < 5) { self.destroy(); code = roomCode(); open(); }
      else if (NET_ERRORS_RETRY.has(err.type)) setTimeout(() => { if (self.destroyed) open(); else if (self.disconnected) self.reconnect(); }, 3000);
      else h.error(JOIN_HELP.signal);
    });
  };
  open();
  return {
    get code() { return code; },
    send(msg) { try { if (conn?.open) conn.send(msg); } catch (e) { console.warn(e); } },
    close() { closed = true; try { peer?.destroy(); } catch { /* egal */ } },
  };
}

/* PeerJS – Gast: mit dem Raum code verbinden, bei Abbruch DUEL_GRACE_MS lang neu versuchen.
   h: open(), message(msg, at), lost(at), fail(text) */
function duelPeerGuest(code, h) {
  let conn = null, ever = false, closed = false, lostAt = null, retry = null;
  const peer = new Peer({ debug: 0 });
  const fail = text => { if (closed) return; closed = true; try { peer.destroy(); } catch { /* egal */ } h.fail(text); };
  const lost = () => {
    if (closed || retry) return;
    lostAt ??= Date.now();
    h.lost(lostAt);
    if (Date.now() - lostAt >= DUEL_GRACE_MS) { fail('Die Verbindung zum Gegner ist abgebrochen.'); return; }
    retry = setTimeout(() => { retry = null; connect(); }, 3000);
  };
  const connect = () => {
    if (closed) return;
    const c = peer.connect(DUEL_PEER_PREFIX + code, { reliable: true });
    conn = c;
    c.on('open', () => { ever = true; lostAt = null; h.open(); });
    c.on('data', msg => { if (c === conn) h.message(msg, Date.now()); });
    c.on('close', () => { if (c === conn) lost(); });
    c.on('error', () => { if (c === conn) lost(); });
    setTimeout(() => { if (c === conn && !c.open) { if (ever) lost(); else fail(JOIN_HELP.webrtc); } }, 15000);
  };
  peer.on('open', () => { if (!conn?.open) connect(); }); // auch nach erneuter Anmeldung beim Vermittlungsserver
  peer.on('error', err => {
    if (err.type === 'peer-unavailable') { if (ever) lost(); else fail('Duell nicht gefunden. Ist der Code richtig und der Gegner noch auf der Seite?'); }
    else if (NET_ERRORS_RETRY.has(err.type)) { if (ever) lost(); else setTimeout(() => !closed && peer.disconnected && peer.reconnect(), 3000); }
    else fail(JOIN_HELP.signal);
  });
  setTimeout(() => { if (!ever && !conn) fail(JOIN_HELP.signal); }, 12000);
  return {
    send(msg) { try { if (conn?.open) conn.send(msg); } catch (e) { console.warn(e); } },
    close() { closed = true; clearTimeout(retry); try { peer.destroy(); } catch { /* egal */ } },
  };
}

/* ── Sitzungen: Host und Gast mit derselben Schnittstelle für die Oberfläche ──
   current() → Ansicht jetzt · image(key) → Daten-URL · guess(id) · leave() · rematch() · close()
   handlers: change(), opponent(player, online), status(state, code?), error(text), rematch(player) */
function duelHostSession({ settings, me, handlers }) {
  const room = duelRoom({ settings, host: me, today: gdToday(), seed: () => uid(12), media: duelStageImage });
  const images = new Map();
  let view = null, viewAt = 0;
  room.onView = (v, at) => { view = v; viewAt = at; handlers.change(); };
  room.onMedia = (key, src) => { images.set(key, src); handlers.change(); };
  room.onGuest = (p, online) => handlers.opponent(p, online);
  room.onRematch = p => handlers.rematch?.(p);
  const net = duelPeerHost({
    open: code => handlers.status('open', code),
    hello: msg => room.admit(msg),
    connected: at => room.connected(at),
    message: (msg, at) => room.receive(msg, at),
    lost: at => room.lost(at),
    error: text => handlers.error(text),
  });
  room.send = msg => net.send(msg);
  const alarm = duelAlarm(() => room.tick());
  room.wake = at => alarm.at(at);
  const timers = [setInterval(() => room.tick(), DUEL_TICK_MS), setInterval(() => room.ping(), DUEL_PING_MS)];
  return {
    role: 'host', me, room,
    get code() { return net.code; },
    get opponent() { return room.guest; },
    current: () => view && duelAge(view, Date.now() - viewAt),
    image: key => images.get(key),
    guess: id => (view ? room.guess(view.n, id) : null),
    start: () => room.start(),
    rematch: () => room.rematch(),
    leave: () => room.leave(me.id),
    close() { timers.forEach(clearInterval); alarm.stop(); setTimeout(() => net.close(), 300); },
  };
}

function duelGuestSession({ code, me, handlers }) {
  const client = duelClient({ me });
  client.onWelcome = host => handlers.opponent(host, true);
  client.onView = () => handlers.change();
  client.onMedia = () => handlers.change();
  client.onResult = msg => handlers.result?.(msg);
  client.onReject = reason => handlers.error({
    full: 'In diesem Duell sind schon zwei Spieler.',
    self: 'Das ist dein eigenes Duell – öffne die Einladung auf einem anderen Gerät oder Browser.',
    version: 'Ihr nutzt unterschiedliche Versionen. Ladet beide die Seite neu.',
  }[reason] || 'Beitritt abgelehnt.');
  client.onRematch = () => handlers.change();
  // Der Gegner hat das Duell verlassen (das Ergebnis kam mit der letzten Ansicht) – kein Wiederverbinden nötig
  client.onLeave = () => { net.close(); handlers.status('ended'); handlers.change(); };
  const net = duelPeerGuest(code, {
    open: () => { handlers.status('online'); client.hello(); },
    message: (msg, at) => client.receive(msg, at),
    lost: () => handlers.status('lost'),
    fail: text => handlers.error(text),
  });
  client.send = msg => net.send(msg);
  return {
    role: 'guest', me, code, client,
    get opponent() { return client.host; },
    current: () => client.current(),
    image: key => client.media.get(key),
    guess: id => client.guess(id),
    start() {},
    rematch: () => client.rematch(),
    leave: () => client.leave(),
    close() { setTimeout(() => net.close(), 300); },
  };
}
