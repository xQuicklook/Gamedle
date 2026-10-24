/* ───────── Helfer ───────── */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const clone = o => JSON.parse(JSON.stringify(o));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function uid(len = 10) {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map(b => abc[b % abc.length]).join('');
}
function roomCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map(b => abc[b % abc.length]).join('');
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const str = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
function safeUrl(u) {
  u = str(u, 600);
  return /^https?:\/\/\S+$/i.test(u) ? u : '';
}
// Cover: http(s)-URL oder Verweis auf ein hochgeladenes Bild im Raum ("asset:<id>")
const safeImg = u => (/^asset:[a-z0-9]{6,16}$/.test(u || '') ? u : safeUrl(u));
const ASSET_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

/* DOM-Builder: h('div.cls#id', {attr}, ...kinder) */
function h(tag, attrs, ...kids) {
  const [, name = 'div', rest = ''] = tag.match(/^([a-z0-9-]*)(.*)$/i);
  const el = document.createElement(name || 'div');
  rest.replace(/([.#])([\w-]+)/g, (_, t, v) => (t === '.' ? el.classList.add(v) : (el.id = v)));
  // Erstes Argument ist Inhalt statt Attributen? (auch 0 – sonst ginge die Zahl verloren)
  if (attrs != null && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

/* Kleine Icon-Sammlung (Lucide-Stil, 24er Raster) */
const ICONS = {
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  left: 'm15 18-6-6 6-6',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  x: 'M18 6 6 18M6 6l12 12',
  check: 'M20 6 9 17l-5-5',
  checks: 'M18 6 7 17l-5-5M22 10l-7.5 7.5L13 16',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  more: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  layers: 'm12 2 10 5-10 5L2 7zM2 17l10 5 10-5M2 12l10 5 10-5',
  library: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  up: 'm18 15-6-6-6 6',
  down: 'm6 9 6 6 6-6',
  edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  image: 'M3 3h18v18H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21',
  rotate: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  crown: 'm2 4 3 12h14l3-12-6 7-4-7-4 7zM5 20h14',
  wifi: 'M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
};
function icon(name, cls = '') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', ('svg ' + cls).trim());
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICONS[name] || '');
  svg.append(p);
  return svg;
}

/* ───────── Version ─────────
   PROTOCOL steigt, wenn sich das Netzwerkprotokoll inkompatibel ändert –
   ältere Dateien werden dann beim Beitritt mit einem Hinweis abgewiesen. */
const APP_VERSION = '3.2';
const PROTOCOL = 3; // 3: Änderungen werden einzeln (als „ops“) verteilt statt als ganzer Raum

/* ───────── Speicher ───────── */
const Store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem('tierly.' + key); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  /* true = gespeichert, false = Speicher voll oder gesperrt */
  set(key, val) {
    try { localStorage.setItem('tierly.' + key, JSON.stringify(val)); return true; } catch { return false; }
  },
  del(key) { try { localStorage.removeItem('tierly.' + key); } catch { /* egal */ } },
  keys(prefix = '') {
    try { return Object.keys(localStorage).filter(k => k.startsWith('tierly.' + prefix)).map(k => k.slice(7)); }
    catch { return []; }
  },
  bytes(key) { try { return (localStorage.getItem('tierly.' + key) || '').length * 2; } catch { return 0; } },
};

/* Spieler-Schlüssel: nur der Hash steht im (für alle sichtbaren) Raum-Zustand */
async function keyHash(key) {
  if (typeof key !== 'string' || key.length < 16) return null;
  const data = new TextEncoder().encode('tierly:' + key);
  if (crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  }
  // Fallback ohne WebCrypto (unsicherer Kontext): einfacher, aber stabiler Hash
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (const x of data) { a = Math.imul(a ^ x, 16777619); b = Math.imul(b ^ x, 2246822519); }
  return 'w' + (a >>> 0).toString(16) + (b >>> 0).toString(16);
}

/* ───────── Zustand ───────── */
const BOARDS = ['games', 'franchises'];

function makeTiers(presetId = 'classic') {
  const p = TIER_PRESETS.find(t => t.id === presetId) || TIER_PRESETS[0];
  return p.tiers.map(([name, color]) => ({ id: uid(6), name, color }));
}

function initialState(hostId) {
  return {
    v: 1,
    tiers: makeTiers(),
    items: {},
    order: [],
    rankings: {},
    players: {},
    assets: {},
    settings: { hostOnlyEdit: false, blind: true, safeImages: true }, // neue Räume: verdeckt ranken
    reveal: { games: false, franchises: false },
    rev: 0, // zählt jede verteilte Änderung – so merken Gäste, wenn ihnen etwas fehlt
    hostId,
  };
}

/* Bildquellen: standardmäßig nur Wikipedia/Wikimedia und hochgeladene Bilder.
   Beliebige Links würden bei allen Mitspielern Anfragen an fremde Server auslösen. */
const SAFE_IMG_RE = /^https:\/\/([a-z0-9-]+\.)*(wikimedia|wikipedia)\.org\//i;
function imgAllowed(state, src) {
  if (!src) return false;
  if (src.startsWith('data:image/')) return true;
  return state?.settings?.safeImages === false || SAFE_IMG_RE.test(src);
}

/* ── Verdecktes Ranken ── */
const isBlind = (state, board) => !!state?.settings?.blind && !state.reveal?.[board];

function placedCount(state, pid, board) {
  const own = Object.values(state.rankings[pid]?.[board] || {}).reduce((n, ids) => n + ids.length, 0);
  // Verdeckte Listen anderer kommen leer an – dann zählt der Fortschritt, den der Host mitschickt
  return own || state.progress?.[pid]?.[board] || 0;
}

/* Was ein Gast zu sehen bekommt: solange verdeckt, nur die eigene Liste
   plus Fortschritt der anderen (Anzahl platziert, Fertig-Status). */
function visibleState(state, pid) {
  if (!state.settings?.blind || BOARDS.every(b => !isBlind(state, b))) return state;
  const rankings = {}, progress = {};
  for (const [p, r] of Object.entries(state.rankings)) {
    progress[p] = { games: placedCount(state, p, 'games'), franchises: placedCount(state, p, 'franchises') };
    if (p === pid) { rankings[p] = r; continue; }
    rankings[p] = {
      games: isBlind(state, 'games') ? {} : r.games,
      franchises: isBlind(state, 'franchises') ? {} : r.franchises,
      ready: r.ready,
    };
  }
  return { ...state, rankings, progress };
}

/* Hochgeladenes Cover eines Items als anzeigbare Quelle */
function coverSrc(img, state = App.state) {
  if (!img) return '';
  if (img.startsWith('asset:')) return state?.assets?.[img.slice(6)] || '';
  return imgAllowed(state, img) ? img : '';
}

function addAsset(state, id, data) {
  id = str(id, 16);
  if (!/^[a-z0-9]{6,16}$/.test(id) || typeof data !== 'string' || data.length > 80000 || !ASSET_RE.test(data)) return false;
  if (!state.assets) state.assets = {};
  // Obergrenzen pro Raum: 120 eigene Bilder, zusammen höchstens ca. 4 MB
  const list = Object.entries(state.assets).filter(([k]) => k !== id);
  if (list.length >= MAX_ASSETS || list.reduce((n, [, d]) => n + d.length, 0) + data.length > MAX_ASSET_CHARS) return false;
  state.assets[id] = data;
  return true;
}
const MAX_ASSETS = 120, MAX_ASSET_CHARS = 4000000;

/* Nicht mehr verwendete hochgeladene Bilder entfernen */
function gcAssets(state) {
  const used = new Set(Object.values(state.items).map(it => it.img).filter(i => i?.startsWith('asset:')).map(i => i.slice(6)));
  for (const id in state.assets) if (!used.has(id)) delete state.assets[id];
}

function emptyRanking() {
  return { games: {}, franchises: {}, ready: { games: false, franchises: false } };
}

function ensureRanking(state, pid) {
  if (!state.rankings[pid]) state.rankings[pid] = emptyRanking();
  return state.rankings[pid];
}

/* Übernimmt eine vom Spieler mitgebrachte Liste (nur gültige Stufen, nur Text-IDs) */
function adoptRanking(state, pid, raw) {
  const r = ensureRanking(state, pid);
  const tierIds = new Set(state.tiers.map(t => t.id));
  for (const b of BOARDS) {
    for (const [tid, ids] of Object.entries(raw?.[b] || {})) {
      if (!tierIds.has(tid) || !Array.isArray(ids)) continue;
      r[b][tid] = ids.filter(x => typeof x === 'string' && x.length <= 80).slice(0, 1000);
    }
  }
}

/* Franchises werden aus den Spielen abgeleitet – nur Reihen mit ≥ 2 Spielen. */
function franchiseKey(name) { return 'fr:' + norm(name).replace(/ /g, '-'); }

function franchiseList(state) {
  const map = new Map();
  for (const id of state.order) {
    const it = state.items[id];
    if (!it || !it.franchise) continue;
    const key = franchiseKey(it.franchise);
    if (!map.has(key)) map.set(key, { id: key, title: it.franchise, games: [] });
    map.get(key).games.push(it);
  }
  return [...map.values()]
    .filter(f => f.games.length >= 2)
    .map(f => {
      const years = f.games.map(g => g.year).filter(Boolean);
      // Mosaik aus bis zu 4 Covern der Reihe, chronologisch
      const imgs = [...f.games].sort((a, b) => (a.year || 9999) - (b.year || 9999)).map(g => g.img).filter(Boolean).slice(0, 4);
      const genres = [...new Set(f.games.flatMap(g => g.genres || []))]; // für den Genre-Filter: alle Genres der Reihe
      return { ...f, imgs, genres, count: f.games.length, year: years.length ? Math.min(...years) : null, yearTo: years.length ? Math.max(...years) : null };
    });
}

function boardItems(state, board) {
  if (board === 'franchises') return franchiseList(state);
  return state.order.map(id => state.items[id]).filter(Boolean);
}

function sanitizeItem(raw) {
  const title = str(raw.title, 90);
  if (!title) return null;
  const y = parseInt(raw.year, 10);
  // Genres als Kürzel (z. B. "aa", "rpg" – Namen in GD_GENRES), höchstens 4
  const genres = [...new Set((Array.isArray(raw.genres) ? raw.genres : []).filter(g => typeof g === 'string' && /^[a-z]{2,4}$/.test(g)))].slice(0, 4);
  return {
    id: str(raw.id, 24) || uid(),
    title,
    year: y >= 1950 && y <= 2100 ? y : null,
    franchise: str(raw.franchise, 60),
    img: safeImg(raw.img),
    wiki: str(raw.wiki, 200), // Wikipedia-Artikel, aus dem das Cover stammt
    ...(genres.length ? { genres } : {}),
  };
}

/* Duplikat-Erkennung: Haben beide Spiele einen Wikipedia-Artikel, entscheidet nur der Artikel
   (Doom 1993 ≠ Doom 2016). Sonst gilt gleicher Titel + gleiches (oder fehlendes) Jahr als Duplikat. */
function itemIndex(state) {
  const list = Object.values(state.items).map(it => ({ it, t: norm(it.title) }));
  const titles = new Set(list.map(x => x.t));
  return {
    duplicateOf(c) {
      const t = norm(c.title);
      for (const { it, t: et } of list) {
        if (c.wiki && it.wiki) { if (c.wiki === it.wiki) return it; continue; }
        if (et === t && (!it.year || !c.year || it.year === c.year)) return it;
      }
      return null;
    },
    uniqueTitle(c) {
      if (!titles.has(norm(c.title))) return c.title;
      const base = c.year && !c.title.includes(String(c.year)) ? `${c.title} (${c.year})` : c.title;
      let title = base;
      for (let n = 2; titles.has(norm(title)); n++) title = `${base} (${n})`;
      return title;
    },
    add(it) { list.push({ it, t: norm(it.title) }); titles.add(norm(it.title)); },
  };
}

function removeFromRanking(rk, itemId) {
  for (const tierId in rk) {
    const i = rk[tierId].indexOf(itemId);
    if (i >= 0) rk[tierId].splice(i, 1);
  }
}

const CONFIG_ACTIONS = new Set(['items/add', 'items/update', 'items/patch', 'items/remove', 'items/clear', 'tiers/set', 'assets/add']);
const RANKING_ACTIONS = new Set(['place', 'ranking/reset', 'ranking/set', 'ranking/merge']);
// Diese Aktionen werden nicht einzeln verteilt, sondern lösen einen vollständigen Abgleich aus
const FULL_SYNC_ACTIONS = new Set(['state/replace', 'reveal', 'settings', 'player/remove']);

/* Aktionen müssen bei Host und Gästen exakt gleich wirken → fehlende IDs vorher vergeben */
function normalizeAction(a) {
  if (!a || typeof a !== 'object') return a;
  if (a.type === 'items/add') return { ...a, items: (a.items || []).map(it => ({ ...it, id: str(it?.id, 24) || uid() })) };
  if (a.type === 'tiers/set') return { ...a, tiers: (a.tiers || []).map(t => ({ ...t, id: str(t?.id, 12) || uid(6) })) };
  return a;
}

/* Was ein bestimmter Gast von einer Aktion erfährt: Solange verdeckt, werden fremde
   Ranking-Aktionen durch einen reinen Fortschritts-Zähler ersetzt. */
function opFor(state, op, pid) {
  const a = op.a;
  if (RANKING_ACTIONS.has(a.type) && op.by !== pid && isBlind(state, a.board)) {
    return { rev: op.rev, by: state.hostId, a: { type: 'progress/set', pid: op.by, board: a.board, n: placedCount(state, op.by, a.board) } };
  }
  return op;
}

const roundBetter = x => Math.ceil(x - 0.5); // x,5 → bessere Stufe („im Zweifel für das Spiel“)

function cleanRows(state, raw, board) {
  const tierIds = new Set(state.tiers.map(t => t.id));
  const rows = {};
  const seen = new Set();
  for (const [tid, ids] of Object.entries(raw || {})) {
    if (!tierIds.has(tid) || !Array.isArray(ids)) continue;
    rows[tid] = ids.filter(x => typeof x === 'string' && x.length <= 80 && !seen.has(x) && seen.add(x)).slice(0, 1000);
  }
  return rows;
}

/* Mehrfachauswahl: mehrere Einträge auf einmal einsortieren (in der Reihenfolge der Auswahl).
   Liefert neue Reihen für „ranking/set“; tierId null = zurück in die Liste. */
function placeMany(rows, ids, tierId, index) {
  const move = new Set(ids);
  const out = {};
  for (const [tid, list] of Object.entries(rows || {})) out[tid] = list.filter(id => !move.has(id));
  if (tierId) {
    const list = out[tierId] ||= [];
    list.splice(Number.isInteger(index) ? clamp(index, 0, list.length) : list.length, 0, ...ids);
  }
  return out;
}

/* Reducer: wendet eine Aktion auf den Zustand an (mutiert ihn).
   actor = Spieler-ID, die die Aktion ausgelöst hat. Gibt false zurück, wenn abgelehnt. */
function applyAction(state, a, actor) {
  if (!a || typeof a !== 'object') return false;
  if (!state.assets) state.assets = {};
  if (CONFIG_ACTIONS.has(a.type) && state.settings.hostOnlyEdit && actor !== state.hostId) return false;

  switch (a.type) {
    case 'assets/add':
      return addAsset(state, a.id, a.data);
    case 'items/patch': {
      // Mehrere Items auf einmal ergänzen (z. B. Cover-Suche für die ganze Bibliothek)
      let n = 0;
      for (const p of (a.patches || []).slice(0, 500)) {
        const cur = state.items[p?.id];
        if (!cur) continue;
        const next = sanitizeItem({ ...cur, ...p, id: cur.id, title: p.title || cur.title });
        if (next) { state.items[cur.id] = next; n++; }
      }
      gcAssets(state);
      return n > 0;
    }
    case 'items/add': {
      for (const [id, data] of Object.entries(a.assets || {}).slice(0, 20)) addAsset(state, id, data);
      const index = itemIndex(state);
      let added = 0;
      for (const raw of (a.items || []).slice(0, 500)) {
        const it = sanitizeItem(raw);
        if (!it || state.items[it.id] || index.duplicateOf(it)) continue;
        // Gleicher Name, aber anderes Spiel (z. B. Doom 1993 vs. 2016) → Jahr anhängen
        it.title = index.uniqueTitle(it);
        state.items[it.id] = it;
        state.order.push(it.id);
        index.add(it);
        added++;
      }
      return added > 0;
    }
    case 'items/update': {
      const cur = state.items[a.id];
      if (!cur) return false;
      const patch = { ...a.patch };
      // Hochgeladenes Bild kommt in derselben Aktion mit – so kann es nicht zwischendurch weggeräumt werden
      if (a.asset && addAsset(state, a.asset.id, a.asset.data)) patch.img = 'asset:' + a.asset.id;
      const next = sanitizeItem({ ...cur, ...patch, id: cur.id });
      if (!next) return false;
      state.items[a.id] = next;
      gcAssets(state);
      return true;
    }
    case 'items/remove': {
      for (const id of a.ids || []) {
        if (!state.items[id]) continue;
        delete state.items[id];
        state.order = state.order.filter(x => x !== id);
        for (const pid in state.rankings) removeFromRanking(state.rankings[pid].games, id);
      }
      gcAssets(state);
      return true;
    }
    case 'items/clear': {
      state.items = {};
      state.order = [];
      state.assets = {};
      for (const pid in state.rankings) { state.rankings[pid].games = {}; state.rankings[pid].franchises = {}; }
      return true;
    }
    case 'tiers/set': {
      const tiers = (a.tiers || []).slice(0, 20).map(t => ({
        id: str(t.id, 12) || uid(6),
        name: str(t.name, 24) || '?',
        color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : '#888888',
        ...(t.unrated ? { unrated: true } : {}), // „Nicht werten“: zählt nicht für Gruppenergebnis & Statistik
      }));
      if (!tiers.length) return false;
      if (tiers.every(t => t.unrated)) tiers.forEach(t => delete t.unrated); // mindestens eine Stufe muss werten
      const keep = new Set(tiers.map(t => t.id));
      for (const pid in state.rankings) {
        for (const b of BOARDS) {
          const rk = state.rankings[pid][b];
          for (const tid in rk) if (!keep.has(tid)) delete rk[tid];
        }
      }
      state.tiers = tiers;
      return true;
    }
    case 'place': {
      if (!BOARDS.includes(a.board)) return false;
      const rk = ensureRanking(state, actor)[a.board];
      removeFromRanking(rk, a.itemId);
      if (a.tierId && state.tiers.some(t => t.id === a.tierId)) {
        const list = rk[a.tierId] || (rk[a.tierId] = []);
        const idx = Number.isInteger(a.index) ? clamp(a.index, 0, list.length) : list.length;
        list.splice(idx, 0, a.itemId);
      }
      state.rankings[actor].ready[a.board] = false;
      return true;
    }
    case 'ranking/reset': {
      if (!BOARDS.includes(a.board)) return false;
      const r = ensureRanking(state, actor);
      r[a.board] = {};
      r.ready[a.board] = false;
      return true;
    }
    case 'ranking/set': {
      // Ganze eigene Liste ersetzen (Rückgängig/Wiederholen)
      if (!BOARDS.includes(a.board)) return false;
      const r = ensureRanking(state, actor);
      r[a.board] = cleanRows(state, a.rows, a.board);
      r.ready[a.board] = false;
      return true;
    }
    case 'ranking/merge': {
      // Noch nicht platzierte Einträge hinten an die Stufen anhängen (z. B. Franchise-Vorschlag)
      if (!BOARDS.includes(a.board)) return false;
      const r = ensureRanking(state, actor);
      const placed = new Set(Object.values(r[a.board]).flat());
      let n = 0;
      for (const [tid, ids] of Object.entries(cleanRows(state, a.rows, a.board))) {
        for (const id of ids) {
          if (placed.has(id)) continue;
          (r[a.board][tid] ||= []).push(id);
          placed.add(id);
          n++;
        }
      }
      if (n) r.ready[a.board] = false;
      return n > 0;
    }
    case 'progress/set': {
      // Nur vom Host: Fortschritt eines verdeckten Mitspielers
      if (actor !== state.hostId || !BOARDS.includes(a.board)) return false;
      state.progress ||= {};
      state.progress[a.pid] = { games: 0, franchises: 0, ...state.progress[a.pid], [a.board]: Math.max(0, +a.n || 0) };
      return true;
    }
    case 'ready': {
      if (!BOARDS.includes(a.board)) return false;
      ensureRanking(state, actor).ready[a.board] = !!a.value;
      return true;
    }
    case 'player/update': {
      const p = state.players[actor];
      if (!p) return false;
      if (a.name) p.name = str(a.name, 20);
      if (/^#[0-9a-f]{6}$/i.test(a.color || '')) p.color = a.color;
      return true;
    }
    case 'player/remove': {
      // Host entfernt einen (offline) Spieler samt Rankings
      if (actor !== state.hostId || a.pid === state.hostId || state.players[a.pid]?.online) return false;
      delete state.players[a.pid];
      delete state.rankings[a.pid];
      return true;
    }
    case 'settings': {
      if (actor !== state.hostId) return false;
      // Nur die übergebenen Schalter ändern
      if ('hostOnlyEdit' in a) state.settings.hostOnlyEdit = !!a.hostOnlyEdit;
      if ('safeImages' in a) state.settings.safeImages = !!a.safeImages;
      if ('blind' in a) {
        state.settings.blind = !!a.blind;
        if (a.blind) state.reveal = { games: false, franchises: false }; // Einschalten = (wieder) verdecken
      }
      return true;
    }
    case 'reveal': {
      // Host deckt auf (value: true) oder verdeckt für eine neue Runde wieder (value: false)
      if (actor !== state.hostId || !BOARDS.includes(a.board)) return false;
      state.reveal = { games: false, franchises: false, ...state.reveal, [a.board]: !!a.value };
      if (!a.value) for (const r of Object.values(state.rankings)) r.ready[a.board] = false;
      return true;
    }
    case 'state/replace': {
      if (actor !== state.hostId) return false;
      const d = a.data || {};
      const fresh = initialState(state.hostId);
      applyAction(fresh, { type: 'tiers/set', tiers: d.tiers || makeTiers() }, state.hostId);
      for (const [id, data] of Object.entries(d.assets || {})) applyAction(fresh, { type: 'assets/add', id, data }, state.hostId);
      const items = (d.order || Object.keys(d.items || {})).map(id => d.items?.[id]).filter(Boolean);
      applyAction(fresh, { type: 'items/add', items }, state.hostId);
      for (const [pid, r] of Object.entries(d.rankings || {})) {
        const p = d.players?.[pid];
        if (!p) continue;
        fresh.players[pid] = { id: pid, name: str(p.name, 20) || 'Spieler', color: p.color || PLAYER_COLORS[0], online: false };
        const rk = ensureRanking(fresh, pid);
        for (const b of BOARDS) for (const t of fresh.tiers) {
          const ids = (r?.[b]?.[t.id] || []).filter(x => typeof x === 'string');
          if (ids.length) rk[b][t.id] = ids;
        }
      }
      for (const pid in state.players) if (state.players[pid].online) fresh.players[pid] = state.players[pid];
      fresh.settings = state.settings;
      Object.keys(state).forEach(k => delete state[k]);
      Object.assign(state, fresh);
      return true;
    }
  }
  return false;
}

/* Liefert {tierId: [Items]} + unplatzierte Items für die Liste eines Spielers. */
function personalView(state, board, pid) {
  const items = boardItems(state, board);
  const byId = new Map(items.map(it => [it.id, it]));
  const rk = state.rankings[pid]?.[board] || {};
  const placed = new Set();
  const rows = state.tiers.map(t => ({
    tier: t,
    items: (rk[t.id] || []).filter(id => byId.has(id) && !placed.has(id) && placed.add(id)).map(id => byId.get(id)),
  }));
  return { rows, pool: items.filter(it => !placed.has(it.id)) };
}

/* Stufen, die in die Wertung eingehen. „Nicht werten“ (z. B. „Nicht gespielt“) zählt weder
   fürs Gruppenergebnis noch für die Statistik – die Indizes (ti) beziehen sich auf diese Liste. */
function ratedTiers(state) {
  const list = state.tiers.filter(t => !t.unrated);
  return list.length ? list : state.tiers;
}

/* Gruppenergebnis: Durchschnitt aller Platzierungen (Tier-Index + Position innerhalb des Tiers). */
function groupView(state, board, opts = {}) {
  const items = boardItems(state, board);
  const byId = new Map(items.map(it => [it.id, it]));
  const rated = ratedTiers(state);
  const tierIdx = new Map(rated.map((t, i) => [t.id, i]));
  const unrated = new Set(state.tiers.filter(t => !tierIdx.has(t.id)).map(t => t.id));
  const votes = new Map();
  const skipped = new Map(); // Platzierungen in Stufen ohne Wertung: id → [{pid, tid}]
  let lists = 0;

  for (const [pid, r] of Object.entries(state.rankings)) {
    if (!state.players[pid]) continue;
    const rk = r[board] || {};
    let any = false;
    for (const [tid, ids] of Object.entries(rk)) {
      const ti = tierIdx.get(tid);
      if (ti == null && !unrated.has(tid)) continue;
      ids.forEach((id, pos) => {
        if (!byId.has(id)) return;
        any = true;
        const map = ti == null ? skipped : votes;
        if (!map.has(id)) map.set(id, []);
        map.get(id).push(ti == null ? { pid, tid } : { pid, ti, pos: ids.length > 1 ? pos / (ids.length - 1) : 0.5 });
      });
    }
    if (any) lists++;
  }

  const rows = state.tiers.map(t => ({ tier: t, items: [] }));
  const rowOf = new Map(rows.map(r => [r.tier.id, r]));
  const pool = [], few = [];
  const median = arr => { const s = [...arr].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  for (const it of items) {
    const v = votes.get(it.id);
    if (!v) {
      // Nur in Stufen ohne Wertung gelandet → in der, die die meisten gewählt haben
      const sk = skipped.get(it.id);
      if (!sk) { pool.push(it); continue; }
      const n = new Map();
      for (const x of sk) n.set(x.tid, (n.get(x.tid) || 0) + 1);
      const tid = [...n].sort((a, b) => b[1] - a[1])[0][0];
      rowOf.get(tid).items.push({ ...it, _votes: sk, _unrated: true });
      continue;
    }
    if (v.length < (opts.minVotes || 1)) { few.push({ ...it, _votes: v }); continue; }
    const tis = v.map(x => x.ti);
    const mean = tis.reduce((s, x) => s + x, 0) / v.length;
    const center = opts.method === 'median' ? median(tis) : mean;
    const fine = v.reduce((s, x) => s + x.ti + x.pos * 0.98, 0) / v.length;
    const spread = Math.max(...tis) - Math.min(...tis);
    rowOf.get(rated[clamp(roundBetter(center), 0, rated.length - 1)].id).items.push({ ...it, _score: fine, _mean: mean, _center: center, _spread: spread, _votes: v });
  }
  const byRank = (a, b) => a._center - b._center || a._score - b._score || b._votes.length - a._votes.length;
  const byCount = (a, b) => b._votes.length - a._votes.length || a.title.localeCompare(b.title, 'de');
  rows.forEach(r => r.items.sort(r.items[0]?._unrated ? byCount : byRank));
  return { rows, pool, few, votes, skipped, lists };
}

/* ───────── Statistik ───────── */
function statsFor(state, board) {
  const { votes } = groupView(state, board);
  const n = Math.max(1, ratedTiers(state).length - 1);
  const items = new Map(boardItems(state, board).map(it => [it.id, it]));
  const players = Object.values(state.players).filter(p => [...votes.values()].some(v => v.some(x => x.pid === p.id)));
  const tierOf = (pid, id) => votes.get(id)?.find(x => x.pid === pid)?.ti;

  // Geschmacks-Übereinstimmung je Paar: 100 % = immer dieselbe Stufe
  const pairs = [];
  for (let i = 0; i < players.length; i++) for (let j = i + 1; j < players.length; j++) {
    const a = players[i], b = players[j];
    let diff = 0, common = 0;
    for (const id of votes.keys()) {
      const ta = tierOf(a.id, id), tb = tierOf(b.id, id);
      if (ta == null || tb == null) continue;
      diff += Math.abs(ta - tb);
      common++;
    }
    if (common) pairs.push({ a, b, common, match: Math.round((1 - diff / common / n) * 100) });
  }
  pairs.sort((x, y) => y.match - x.match || y.common - x.common);

  // Umstritten (größte Spanne) und einig (alle gleich, mind. 3 Stimmen)
  const scored = [...votes.entries()].filter(([id, v]) => items.has(id) && v.length >= 2).map(([id, v]) => {
    const tis = v.map(x => x.ti);
    const mean = tis.reduce((s, x) => s + x, 0) / tis.length;
    const sd = Math.sqrt(tis.reduce((s, x) => s + (x - mean) ** 2, 0) / tis.length);
    return { item: items.get(id), votes: v, spread: Math.max(...tis) - Math.min(...tis), sd, mean };
  });
  const controversial = scored.filter(x => x.spread >= 2).sort((a, b) => b.sd - a.sd || b.votes.length - a.votes.length).slice(0, 6);
  const consensus = scored.filter(x => x.spread === 0 && x.votes.length >= Math.min(3, players.length)).sort((a, b) => a.mean - b.mean || b.votes.length - a.votes.length).slice(0, 6);

  // Ausreißer: wo weicht jemand am stärksten vom Rest ab?
  const outliers = players.map(p => {
    let best = null;
    for (const s of scored) {
      const mine = s.votes.find(x => x.pid === p.id);
      if (!mine || s.votes.length < 2) continue;
      const others = s.votes.filter(x => x.pid !== p.id);
      const avg = others.reduce((t, x) => t + x.ti, 0) / others.length;
      const delta = avg - mine.ti; // > 0: mag es mehr als die anderen
      if (!best || Math.abs(delta) > Math.abs(best.delta)) best = { item: s.item, delta, mine: mine.ti, others: avg };
    }
    return best && Math.abs(best.delta) >= 1 ? { player: p, ...best } : null;
  }).filter(Boolean);

  // Lieblings-Jahrzehnt (nur Spiele): bester Durchschnitt mit mind. 2 Wertungen
  const decades = board !== 'games' ? [] : players.map(p => {
    const by = new Map();
    for (const [id, v] of votes) {
      const it = items.get(id), mine = v.find(x => x.pid === p.id);
      if (!it?.year || !mine) continue;
      const d = Math.floor(it.year / 10) * 10;
      const e = by.get(d) || { sum: 0, n: 0 };
      e.sum += mine.ti; e.n++;
      by.set(d, e);
    }
    const best = [...by.entries()].filter(([, e]) => e.n >= 2).map(([d, e]) => ({ decade: d, avg: e.sum / e.n, n: e.n })).sort((a, b) => a.avg - b.avg)[0];
    return best ? { player: p, ...best } : null;
  }).filter(Boolean);

  return { players, pairs, controversial, consensus, outliers, decades };
}

/* Franchise-Vorschlag aus den eigenen Spiele-Rankings: Schnitt der Stufen je Reihe */
function franchiseSuggestion(state, pid) {
  const rated = ratedTiers(state); // Spiele in „Nicht werten“-Stufen fließen nicht ein
  const tierIdx = new Map(rated.map((t, i) => [t.id, i]));
  const myGames = new Map();
  for (const [tid, ids] of Object.entries(state.rankings[pid]?.games || {})) ids.forEach(id => myGames.set(id, tierIdx.get(tid)));
  const placed = new Set(Object.values(state.rankings[pid]?.franchises || {}).flat());
  const rows = {}, list = [];
  for (const f of franchiseList(state)) {
    if (placed.has(f.id)) continue;
    const tis = f.games.map(g => myGames.get(g.id)).filter(t => t != null);
    if (!tis.length) continue;
    list.push({ id: f.id, avg: tis.reduce((s, x) => s + x, 0) / tis.length });
  }
  list.sort((a, b) => a.avg - b.avg);
  for (const { id, avg } of list) (rows[rated[clamp(roundBetter(avg), 0, rated.length - 1)].id] ||= []).push(id);
  return { rows, count: list.length };
}
