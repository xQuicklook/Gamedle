/* ───────── Peer-to-Peer (WebRTC über PeerJS) ─────────
   Stern-Topologie: Der Raum-Ersteller (Host) ist die Quelle der Wahrheit.
   Gäste schicken Aktionen, der Host wendet sie an und verteilt sie als nummerierte
   Änderungen („ops“). Den vollständigen Raum gibt es nur beim Beitritt, beim Aufdecken
   und wenn einem Gast eine Änderung fehlt (Lücke in der Nummerierung → „resync“). */
const PEER_PREFIX = 'tierly-room-v1-';
const MAX_ACTION_CHARS = 250000; // eine Aktion inkl. hochgeladenem Bild
const RATE_WINDOW = 5000, RATE_MAX = 80; // höchstens 80 Aktionen pro 5 s und Gast
const NET_ERRORS_RETRY = new Set(['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected']);

const JOIN_HELP = {
  signal: 'Der Vermittlungsserver (PeerJS) ist nicht erreichbar. Prüfe deine Internetverbindung – manchmal blockiert auch eine Firewall oder ein Adblocker „peerjs.com“.',
  host: 'Raum nicht gefunden. Ist der Code richtig und der Host online?',
  webrtc: 'Der Raum wurde gefunden, aber eine direkte Verbindung kam nicht zustande. Häufige Ursache: Mobilfunk- oder Firmennetz. Tipp: anderes WLAN oder einen Handy-Hotspot probieren („Verbindung testen“ hilft bei der Suche).',
  hello: 'Der Host antwortet nicht. Versuch es gleich noch einmal.',
};

const Net = {
  role: 'solo',          // 'solo' | 'host' | 'guest'
  code: null,
  status: 'offline',     // 'offline' | 'connecting' | 'online'
  stage: '',             // Gast: 'signal' → 'host' → 'webrtc' → 'hello' → 'online'
  peer: null,
  conns: new Map(),      // Host: peerId -> { conn, pid, assetSig }
  lastSeq: {},           // Host: pid -> letzte verarbeitete Sequenznummer
  ops: [],               // Host: noch nicht verschickte Änderungen
  ackPids: new Set(),    // Host: Gäste, die nur eine Bestätigung brauchen
  hostConn: null,        // Gast: Verbindung zum Host
  confirmed: null,       // Gast: zuletzt vom Host bestätigter Stand
  resyncing: false,
  seq: 0,
  pending: [],           // Gast: noch nicht bestätigte eigene Aktionen
  everConnected: false,
  timers: new Set(),
  flushTimer: null,
  on: {
    status() {}, state() {}, error() {}, joined() {}, joinFailed() {}, rejected() {}, hostOutdated() {},
    hostJoin() {}, hostLeave() {}, hostAction() {}, hostReject() {}, idTaken() {}, hostOverload() {},
  },

  later(fn, ms) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
  },

  setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    this.on.status(s);
  },

  available() { return typeof window.Peer === 'function'; },

  reset() {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    clearTimeout(this.flushTimer);
    for (const { conn } of this.conns.values()) try { conn.close(); } catch { /* egal */ }
    this.conns.clear();
    if (this.hostConn) try { this.hostConn.close(); } catch { /* egal */ }
    this.hostConn = null;
    if (this.peer) try { this.peer.destroy(); } catch { /* egal */ }
    this.peer = null;
    this.lastSeq = {};
    this.ops = [];
    this.ackPids.clear();
    this.pending = [];
    this.confirmed = null;
    this.resyncing = false;
    this.everConnected = false;
    this.stage = '';
  },

  leave() {
    this.reset();
    this.role = 'solo';
    this.code = null;
    this.setStatus('offline');
  },

  /* ── Host ── */
  host(code, { resume = false } = {}) {
    this.reset();
    this.role = 'host';
    this.code = code;
    this.setStatus('connecting');
    let idTaken = 0;

    const open = () => {
      const peer = new Peer(PEER_PREFIX + code, { debug: 0 });
      this.peer = peer;
      peer.on('open', () => { if (this.peer === peer) { idTaken = 0; this.setStatus('online'); } });
      peer.on('connection', conn => this.accept(conn));
      peer.on('disconnected', () => {
        if (this.peer !== peer || peer.destroyed) return;
        this.setStatus('connecting');
        this.later(() => { if (!peer.destroyed && peer.disconnected) peer.reconnect(); }, 2000);
      });
      peer.on('error', err => {
        if (this.peer !== peer) return;
        if (err.type === 'unavailable-id') {
          peer.destroy();
          // Beim Fortsetzen: Hat inzwischen jemand anderes den Raum übernommen? → als Gast beitreten
          if (resume && ++idTaken >= 3) { this.on.idTaken(code); return; }
          if (!resume && ++idTaken > 10) { this.setStatus('offline'); this.on.error('Dieser Raum-Code ist gerade von jemand anderem belegt.'); return; }
          this.setStatus('connecting');
          this.later(open, 3000); // z. B. nach Neuladen noch kurz beim Signal-Server registriert
        } else if (NET_ERRORS_RETRY.has(err.type)) {
          this.setStatus('connecting');
          this.later(() => {
            if (this.peer !== peer) return;
            if (peer.destroyed) open();
            else if (peer.disconnected) peer.reconnect();
          }, 3000);
        }
      });
    };
    open();
  },

  accept(conn) {
    conn._ready = false; // erst nach geprüftem hello
    conn._queue = [];
    conn.on('data', msg => this.hostReceive(conn, msg));
    const drop = () => this.dropConn(conn);
    conn.on('close', drop);
    conn.on('error', drop);
  },

  hostReceive(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') { this.hostHello(conn, msg); return; }
    // Nachrichten, die vor der Prüfung des hello eintreffen, kurz zurückhalten
    if (!conn._ready) { if (conn._queue.length < 500) conn._queue.push(msg); return; }
    const e = this.conns.get(conn.peer);
    if (!e || e.conn !== conn) return;
    if (msg.t === 'act') {
      const seq = Number(msg.seq) || 0;
      if (seq <= (this.lastSeq[e.pid] || 0)) return;
      this.lastSeq[e.pid] = seq;
      // Schutz vor Überlast: zu große oder zu viele Aktionen in kurzer Zeit werden verworfen
      const now = Date.now();
      if (!e.rate || now - e.rate.t > RATE_WINDOW) e.rate = { t: now, n: 0 };
      const tooMany = ++e.rate.n > RATE_MAX;
      const tooBig = JSON.stringify(msg.a ?? null).length > MAX_ACTION_CHARS;
      if (tooMany || tooBig) {
        this.ackOnly(e.pid);
        if (!e.warned || now - e.warned > 10000) { e.warned = now; this.on.hostOverload(e.pid, tooBig ? 'big' : 'many'); }
        return;
      }
      this.on.hostAction(msg.a, e.pid);
    } else if (msg.t === 'resync') {
      this.sendState(conn);
    }
  },

  /* Beitritt prüfen: Version und Spieler-Schlüssel (verhindert, dass jemand eine fremde Liste übernimmt) */
  async hostHello(conn, msg) {
    const p = msg.player || {};
    const pid = str(p.id, 24);
    const name = str(p.name, 20) || 'Gast';
    if (!pid) return;
    const reject = reason => {
      try { conn.send({ t: 'reject', reason, app: APP_VERSION }); } catch { /* egal */ }
      setTimeout(() => { try { conn.close(); } catch { /* egal */ } }, 500);
      this.on.hostReject(name, reason);
    };
    if ((Number(msg.v) || 1) < PROTOCOL) return reject('outdated');
    if (pid === App.me.id) return reject('identity');
    const hash = await keyHash(msg.key);
    const known = App.state.players[pid]?.keyHash;
    if (!hash || (known && known !== hash)) return reject('identity');

    for (const [peerId, e] of this.conns) {
      if (e.pid === pid && e.conn !== conn) { try { e.conn.close(); } catch { /* egal */ } this.conns.delete(peerId); }
    }
    this.conns.set(conn.peer, { conn, pid });
    this.on.hostJoin({ id: pid, name, color: p.color, keyHash: hash, ranking: msg.ranking }); // verteilt den vollen Stand
    conn._ready = true;
    const queued = conn._queue;
    conn._queue = [];
    queued.forEach(m => this.hostReceive(conn, m));
  },

  dropConn(conn) {
    const e = this.conns.get(conn.peer);
    if (!e || e.conn !== conn) return;
    this.conns.delete(conn.peer);
    if (![...this.conns.values()].some(x => x.pid === e.pid)) this.on.hostLeave(e.pid);
  },

  sendState(conn) {
    const e = this.conns.get(conn.peer);
    if (!e || !conn.open) return;
    // Verdeckt: jeder Gast bekommt nur seine eigene Liste (plus Fortschritt der anderen)
    const s = visibleState(App.state, e.pid);
    // Hochgeladene Bilder nur mitschicken, wenn sie sich für diese Verbindung geändert haben
    const sig = Object.keys(s.assets || {}).sort().join(',');
    const payload = e.assetSig === sig ? { ...s, assets: null } : s;
    e.assetSig = sig;
    try { conn.send({ t: 'state', s: payload, acks: this.lastSeq, proto: PROTOCOL, app: APP_VERSION }); } catch (err) { console.warn(err); }
  },

  /* Vollständiger Stand an alle (Beitritt, Aufdecken, Import …) */
  fullBroadcast() {
    if (this.role !== 'host') return;
    clearTimeout(this.flushTimer);
    this.ops = [];
    this.ackPids.clear();
    for (const { conn } of this.conns.values()) this.sendState(conn);
  },

  /* Host hat eine Aktion übernommen → nummerieren und (gebündelt) verteilen */
  commit(a, by) {
    if (this.role !== 'host') return;
    App.state.rev = (App.state.rev || 0) + 1;
    if (FULL_SYNC_ACTIONS.has(a.type)) { this.fullBroadcast(); return; }
    this.ops.push({ rev: App.state.rev, a, by });
    this.scheduleFlush();
  },

  ackOnly(pid) {
    this.ackPids.add(pid);
    this.scheduleFlush();
  },

  scheduleFlush() {
    clearTimeout(this.flushTimer);
    // Hintergrund-Tabs drosseln Timer stark – dort sofort senden
    if (document.hidden) this.flush();
    else this.flushTimer = setTimeout(() => this.flush(), 30);
  },

  flush() {
    const ops = this.ops;
    this.ops = [];
    for (const e of this.conns.values()) {
      if (!e.conn.open || (!ops.length && !this.ackPids.has(e.pid))) continue;
      const mine = ops.map(op => opFor(App.state, op, e.pid));
      try { e.conn.send({ t: 'ops', ops: mine, acks: this.lastSeq }); } catch (err) { console.warn(err); }
    }
    this.ackPids.clear();
  },

  /* ── Gast ── */
  join(code) {
    this.reset();
    this.role = 'guest';
    this.code = code;
    this.stage = 'signal';
    this.setStatus('connecting');

    const peer = new Peer({ debug: 0 });
    this.peer = peer;
    peer.on('open', () => { this.stage = 'host'; this.connectToHost(); });
    peer.on('disconnected', () => {
      if (this.peer !== peer || peer.destroyed) return;
      this.later(() => { if (!peer.destroyed && peer.disconnected) peer.reconnect(); }, 2000);
    });
    peer.on('error', err => {
      if (this.peer !== peer) return;
      if (err.type === 'peer-unavailable') {
        if (!this.everConnected) this.fail('host');
        else this.retryHost();
      } else if (NET_ERRORS_RETRY.has(err.type)) {
        this.setStatus('connecting');
        this.later(() => {
          if (this.peer !== peer) return;
          if (peer.destroyed) this.join(code);
          else if (peer.disconnected) peer.reconnect();
          else this.retryHost();
        }, 3000);
      }
    });
    // Signal-Server antwortet gar nicht?
    this.later(() => { if (this.peer === peer && this.stage === 'signal' && !this.everConnected) this.fail('signal'); }, 12000);
  },

  fail(stage) {
    this.leave();
    this.on.joinFailed(JOIN_HELP[stage] || JOIN_HELP.host, stage);
  },

  connectToHost() {
    if (this.role !== 'guest' || !this.peer || this.peer.destroyed) return;
    if (this.hostConn) try { this.hostConn.close(); } catch { /* egal */ }
    const conn = this.peer.connect(PEER_PREFIX + this.code, { reliable: true });
    this.hostConn = conn;
    if (!this.everConnected) this.stage = 'webrtc';
    // Scheitert der Verbindungsaufbau (ICE), gleich mit Hinweis abbrechen statt zu warten
    conn.peerConnection?.addEventListener?.('iceconnectionstatechange', () => {
      if (conn.peerConnection.iceConnectionState === 'failed' && this.hostConn === conn && !this.everConnected) this.fail('webrtc');
    });
    this.later(() => {
      if (this.hostConn === conn && !conn.open) {
        try { conn.close(); } catch { /* egal */ }
        if (!this.everConnected) this.fail('webrtc');
        else this.retryHost();
      }
    }, 15000);
    conn.on('open', () => {
      if (!this.everConnected) this.stage = 'hello';
      const { id, name, color } = App.me;
      // Eigene Liste mitschicken – falls der Host sie nicht (mehr) hat, z. B. nach einer Übernahme
      const ranking = (App.state || Store.get('cache.' + this.code) || Store.get('room.' + this.code))?.rankings?.[id] || null;
      conn.send({ t: 'hello', v: PROTOCOL, app: APP_VERSION, player: { id, name, color }, key: App.me.key, ranking });
      for (const p of this.pending) conn.send({ t: 'act', seq: p.seq, a: p.action });
      this.later(() => { if (this.hostConn === conn && !this.everConnected) this.fail('hello'); }, 12000);
    });
    conn.on('data', msg => {
      if (this.hostConn !== conn || !msg) return;
      if (msg.t === 'reject') { this.leave(); this.on.rejected(msg.reason, msg.app); return; }
      if (msg.t === 'state' && msg.s) this.onFull(msg);
      else if (msg.t === 'ops' && Array.isArray(msg.ops)) this.onOps(msg);
    });
    conn.on('close', () => { if (this.hostConn === conn && this.role === 'guest') this.retryHost(); });
    conn.on('error', () => { if (this.hostConn === conn && this.role === 'guest') this.retryHost(); });
  },

  onFull(msg) {
    if (!this.everConnected && (Number(msg.proto) || 1) < PROTOCOL) this.on.hostOutdated(msg.app);
    if (msg.s.assets == null) msg.s.assets = this.confirmed?.assets || App.state?.assets || {};
    this.confirmed = msg.s;
    this.resyncing = false;
    this.dropAcked(msg.acks);
    const first = !this.everConnected;
    this.everConnected = true;
    this.stage = 'online';
    this.setStatus('online');
    this.emitLocal();
    if (first) this.on.joined();
  },

  onOps(msg) {
    if (!this.confirmed || this.resyncing) return;
    for (const op of msg.ops) {
      if (op.rev <= (this.confirmed.rev || 0)) continue; // schon bekannt
      if (op.rev !== (this.confirmed.rev || 0) + 1) {
        // Lücke: vollständigen Stand anfordern
        this.resyncing = true;
        try { this.hostConn.send({ t: 'resync' }); } catch { /* egal */ }
        return;
      }
      applyAction(this.confirmed, op.a, op.by);
      this.confirmed.rev = op.rev;
    }
    this.dropAcked(msg.acks);
    this.emitLocal();
  },

  dropAcked(acks) {
    const ack = acks?.[App.me.id] || 0;
    this.pending = this.pending.filter(p => p.seq > ack);
  },

  /* Lokaler Stand = bestätigter Stand + eigene, noch unbestätigte Aktionen */
  emitLocal() {
    // Hochgeladene Bilder nicht mitkopieren (groß, ändern sich selten) – nur die Liste der Verweise
    const { assets, ...rest } = this.confirmed;
    const local = structuredClone(rest);
    local.assets = { ...assets };
    for (const p of this.pending) applyAction(local, p.action, App.me.id);
    this.on.state(local);
  },

  retryHost() {
    if (this.role !== 'guest') return;
    this.setStatus('connecting');
    this.hostConn = null;
    this.later(() => { if (this.role === 'guest' && !this.hostConn) this.connectToHost(); }, 3000);
  },

  /* Aktion an den Host schicken (nur Gast) */
  send(action) {
    this.seq = Math.max(this.seq + 1, Date.now());
    this.pending.push({ seq: this.seq, action });
    if (this.pending.length > 300) this.pending.shift();
    if (this.hostConn?.open) try { this.hostConn.send({ t: 'act', seq: this.seq, a: action }); } catch (e) { console.warn(e); }
  },
};
