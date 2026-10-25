/* ───────── Verbindungstest ─────────
   Prüft die Dinge, an denen ein Beitritt scheitern kann: Internet, Vermittlungsserver (PeerJS),
   ob der Browser direkte Verbindungen (WebRTC) überhaupt zulässt und ob er seine öffentliche Adresse (STUN) erfährt.
   Einen Umweg über ein Relay (TURN) gibt es nicht – den kostenlosen von PeerJS gibt es nicht mehr. */

function testSignal(timeout = 8000) {
  return new Promise(resolve => {
    let done = false;
    const finish = (ok, info) => { if (done) return; done = true; try { peer.destroy(); } catch { /* egal */ } resolve({ ok, info }); };
    const peer = new Peer(PEER_OPTIONS);
    peer.on('open', () => finish(true));
    peer.on('error', err => finish(false, err.type));
    setTimeout(() => finish(false, 'timeout'), timeout);
  });
}

/* Lässt dieser Browser direkte Verbindungen zu?
   'ok' – öffentliche Adresse gefunden · 'local' – nur lokale Adressen: Firewall, VPN, Virenschutz oder ein Filter blocken nach außen
   'blocked' – gar keine Adressen: Browser-Einstellung oder Erweiterung · 'off' – Browser ohne WebRTC */
async function testIce(timeout = 7000) {
  if (typeof RTCPeerConnection !== 'function') return 'off';
  const pc = new RTCPeerConnection(PEER_OPTIONS.config);
  const types = new Set();
  pc.createDataChannel('probe');
  const gathered = new Promise(resolve => {
    pc.onicecandidate = e => {
      if (!e.candidate?.candidate) { resolve(); return; } // fertig (Firefox meldet das mit leerem Kandidaten)
      types.add(e.candidate.type || / typ (\w+)/.exec(e.candidate.candidate)?.[1]);
      if (types.has('srflx')) resolve(); // öffentliche Adresse da – mehr braucht der Test nicht
    };
    setTimeout(resolve, timeout);
  });
  await pc.setLocalDescription(await pc.createOffer());
  await gathered;
  pc.close();
  return types.has('srflx') ? 'ok' : types.size ? 'local' : 'blocked';
}

/* Ergebnis zwei Minuten merken: Beitreten und Raum öffnen stoßen den Test nebenher an,
   damit eine Fehlermeldung ohne Wartezeit sagen kann, woran es liegt */
let iceCheck = null; // { at, result, promise }
function checkIce(fresh = false) {
  if (fresh || !iceCheck || Date.now() - iceCheck.at > 120000) {
    const c = { at: Date.now(), result: null };
    c.promise = testIce().catch(() => 'off').then(r => (c.result = r));
    iceCheck = c;
  }
  return iceCheck.promise;
}

/* Hilfe, wenn die direkte Verbindung scheitert: Liegt es am eigenen Browser, am eigenen Netz – oder an der Gegenseite? */
function webrtcHelp() {
  const r = iceCheck?.result;
  return r === 'blocked' || r === 'off' ? JOIN_HELP.browser : r === 'local' ? JOIN_HELP.network : r === 'ok' ? JOIN_HELP.other : JOIN_HELP.webrtc;
}

/* Für den Ersteller eines Raums/Duells: Hinweis, falls Mitspieler gar nicht beitreten könnten ('' = alles gut oder noch offen) */
function hostIceWarning() {
  const r = iceCheck?.result;
  if (!r || r === 'ok') return '';
  return 'Mitspieler können dir wahrscheinlich nicht beitreten. ' + (r === 'local' ? JOIN_HELP.network : JOIN_HELP.browser);
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
    const browserOk = () => res.ice === 'ok' || res.ice === 'local';
    const draw = () => list.replaceChildren(
      row('Internet', res.online ? 'ok' : 'fail', res.online ? '' : 'Dieses Gerät ist offline.'),
      row('Vermittlungsserver (PeerJS)', res.signal == null ? 'wait' : res.signal.ok ? 'ok' : 'fail',
        res.signal && !res.signal.ok ? `Nicht erreichbar (${res.signal.info}).` : 'Nötig, damit ihr euch über den Raum-Code findet.'),
      row('Browser erlaubt Direktverbindungen (WebRTC)', res.ice == null ? 'wait' : browserOk() ? 'ok' : 'fail',
        res.ice == null || browserOk() ? 'VPN- und Datenschutz-Erweiterungen oder Browser-Einstellungen schalten das manchmal ab.'
          : res.ice === 'off' ? 'Dieser Browser kann kein WebRTC.' : 'Blockiert – meist durch eine VPN- oder Datenschutz-Erweiterung oder eine Browser-Einstellung.'),
      row('Öffentliche Adresse (STUN)', res.ice == null ? 'wait' : res.ice === 'ok' ? 'ok' : 'fail',
        res.ice === 'local' ? 'Keine Antwort – meist blockiert ein VPN, ein Virenschutz, eine Firewall oder ein Netzwerkfilter.'
          : 'Damit dich die Gegenseite direkt erreicht.'),
    );
    summary.textContent = 'Teste …';
    draw();
    [res.signal, res.ice] = await Promise.all([testSignal(), checkIce(true)]);
    draw();
    summary.textContent = !res.online || !res.signal.ok ? JOIN_HELP.signal
      : res.ice === 'ok' ? 'Bei dir ist alles bereit. Hakt es trotzdem, liegt es meist an der Gegenseite: Lass deine Mitspieler den Test ebenfalls machen.'
        : res.ice === 'local' ? JOIN_HELP.network : JOIN_HELP.browser;
    rerun.disabled = false;
  };
  const rerun = h('button.btn', { onclick: run }, icon('rotate'), 'Erneut testen');
  openModal({ title: 'Verbindung testen', width: 480, body: [list, summary], foot: [rerun], autofocus: false });
  run();
}
