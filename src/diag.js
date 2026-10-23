/* ───────── Verbindungstest ─────────
   Prüft die drei Dinge, an denen ein Beitritt scheitern kann:
   Internet/Signal-Server (PeerJS), direkte Verbindungen (STUN) und Relay (TURN). */
const ICE_FALLBACK = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
  ],
};

function testSignal(timeout = 8000) {
  return new Promise(resolve => {
    let done = false;
    const finish = (ok, info) => { if (done) return; done = true; try { peer.destroy(); } catch { /* egal */ } resolve({ ok, info }); };
    const peer = new Peer({ debug: 0 });
    peer.on('open', () => finish(true));
    peer.on('error', err => finish(false, err.type));
    setTimeout(() => finish(false, 'timeout'), timeout);
  });
}

async function testIce(timeout = 7000) {
  const cfg = window.peerjs?.util?.defaultConfig || ICE_FALLBACK;
  const pc = new RTCPeerConnection(cfg);
  const types = new Set();
  pc.createDataChannel('probe');
  const gathered = new Promise(resolve => {
    pc.onicecandidate = e => {
      if (!e.candidate) { resolve(); return; }
      const m = / typ (\w+)/.exec(e.candidate.candidate);
      types.add(e.candidate.type || m?.[1]);
    };
    setTimeout(resolve, timeout);
  });
  await pc.setLocalDescription(await pc.createOffer());
  await gathered;
  pc.close();
  return { stun: types.has('srflx') || types.has('prflx'), turn: types.has('relay') };
}

function diagModal() {
  const list = h('div.diag-list');
  const summary = h('p.help');
  const row = (label, state, info = '') => h('div.diag-row',
    h('span.diag-state.' + state, state === 'ok' ? '✓' : state === 'fail' ? '✕' : state === 'warn' ? '!' : '…'),
    h('div', h('strong', label), info ? h('div.muted', { style: { fontSize: '12.5px' } }, info) : null));

  const run = async () => {
    rerun.disabled = true;
    const res = { online: navigator.onLine, signal: null, ice: null };
    const draw = () => list.replaceChildren(
      row('Internet', res.online ? 'ok' : 'fail', res.online ? '' : 'Dieses Gerät ist offline.'),
      row('Vermittlungsserver (PeerJS)', res.signal == null ? 'wait' : res.signal.ok ? 'ok' : 'fail',
        res.signal && !res.signal.ok ? `Nicht erreichbar (${res.signal.info}).` : 'Nötig, damit ihr euch über den Raum-Code findet.'),
      row('Direkte Verbindung (STUN)', res.ice == null ? 'wait' : res.ice.stun ? 'ok' : 'fail',
        'Klappt meistens im Heim-WLAN; Mobilfunk- und Firmennetze blockieren das oft.'),
      row('Umweg über Relay (TURN)', res.ice == null ? 'wait' : res.ice.turn ? 'ok' : 'warn',
        'Rettungsanker, wenn direkte Verbindungen blockiert sind (kostenloser PeerJS-Relay).'),
    );
    summary.textContent = 'Teste …';
    draw();
    [res.signal, res.ice] = await Promise.all([
      testSignal(),
      testIce().catch(() => ({ stun: false, turn: false })),
    ]);
    draw();
    summary.textContent = !res.online || !res.signal.ok ? JOIN_HELP.signal
      : res.ice.stun ? 'Alles bereit – Verbindungen sollten klappen. Hakt es trotzdem, liegt es meist am Netz der Gegenseite: Lass deine Freunde den Test ebenfalls machen.'
        : res.ice.turn ? 'Direkte Verbindungen sind hier blockiert, der Umweg über das Relay funktioniert aber. Es kann etwas langsamer sein.'
          : 'Dein Netz blockiert direkte Verbindungen und das Relay. Probiere ein anderes WLAN oder einen Handy-Hotspot.';
    rerun.disabled = false;
  };
  const rerun = h('button.btn', { onclick: run }, icon('rotate'), 'Erneut testen');
  openModal({ title: 'Verbindung testen', width: 480, body: [list, summary], foot: [rerun], autofocus: false });
  run();
}
