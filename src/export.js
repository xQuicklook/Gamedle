/* ───────── Export / Import ───────── */
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const fileStamp = () => new Date().toISOString().slice(0, 10);

function exportJson(s = App.state, code = Net.code) {
  if (!s) return;
  const players = Object.fromEntries(Object.values(s.players || {}).map(p => [p.id, { id: p.id, name: p.name, color: p.color }]));
  const data = { app: 'tierly', v: 1, version: APP_VERSION, exportedAt: new Date().toISOString(), tiers: s.tiers, items: s.items, order: s.order, rankings: s.rankings, players, assets: s.assets || {} };
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `tierly-${(code || 'solo').toLowerCase()}-${fileStamp()}.json`);
}

function importJson() {
  const input = h('input', { type: 'file', accept: '.json,application/json' });
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch { toast('Die Datei ist kein gültiges JSON.'); return; }
    if (data?.app !== 'tierly' || !data.items) { toast('Das ist keine Tierly-Exportdatei.'); return; }
    const ok = await confirmDialog('Raum ersetzen?', `Spiele, Stufen und Platzierungen werden durch den Inhalt von „${file.name}“ ersetzt.`, 'Importieren', true);
    if (ok && App.dispatch({ type: 'state/replace', data })) toast('Import abgeschlossen');
  };
  input.click();
}

/* ───────── Als Bild speichern (Canvas, ohne externe Bibliothek) ───────── */
const imgCache = new Map();
function loadImg(src) {
  if (!imgCache.has(src)) {
    imgCache.set(src, new Promise(resolve => {
      const im = new Image();
      im.crossOrigin = 'anonymous'; // Wikimedia erlaubt CORS – sonst wäre das Canvas „verunreinigt“
      im.referrerPolicy = 'no-referrer';
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null);
      setTimeout(() => resolve(null), 8000);
      im.src = src;
    }));
  }
  return imgCache.get(src);
}

async function exportPng() {
  if (App.view !== 'me' && App.hidden()) { toast('Das gibt es erst nach dem Aufdecken.'); return; }
  const s = App.state;
  const { rows } = App.viewData();
  const css = getComputedStyle(document.documentElement);
  const col = name => css.getPropertyValue(name).trim();
  const font = (w, px) => `${w} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const showTitles = document.body.classList.contains('show-titles');

  // Cover vorladen
  toast('Bild wird erstellt …', 1500);
  const srcOf = it => (it.id.startsWith('fr:') ? it.imgs || [] : [it.img]).map(i => coverSrc(i)).filter(Boolean).slice(0, 4);
  const covers = new Map();
  await Promise.all(rows.flatMap(r => r.items).map(async it => {
    const imgs = (await Promise.all(srcOf(it).map(loadImg))).filter(Boolean);
    if (imgs.length) covers.set(it.id, imgs);
  }));

  const W = 1200, pad = 28, label = 130, tw = 84, th = 112, gap = 8, headH = 86, footH = 34, scale = 2;
  const cols = Math.floor((W - pad * 2 - label - gap) / (tw + gap));
  const heights = rows.map(r => Math.max(1, Math.ceil(r.items.length / cols)) * (th + gap) + gap);
  const H = headH + heights.reduce((a, b) => a + b + gap, 0) + footH;

  const c = document.createElement('canvas');
  c.width = W * scale;
  c.height = H * scale;
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  const rr = (x, y, w, h2, r) => { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h2, r) : ctx.rect(x, y, w, h2); };

  ctx.fillStyle = col('--bg');
  ctx.fillRect(0, 0, W, H);

  // Kopfzeile
  const boardName = App.board === 'games' ? 'Spiele' : 'Franchises';
  // Aus der Statistik-Ansicht wird das Gruppenergebnis exportiert (viewData liefert dort dieselben Reihen)
  const groupLike = App.view === 'group' || App.view === 'stats';
  const viewName = App.view === 'me' ? `Liste von ${App.me.name}`
    : groupLike ? `Gruppenergebnis (${groupView(s, App.board, App.groupOpts).lists} Listen)`
      : `Liste von ${s.players[App.view]?.name || ''}`;
  ctx.fillStyle = col('--text');
  ctx.font = font(800, 28);
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`Tierly · ${boardName}`, pad, 48);
  ctx.fillStyle = col('--muted');
  ctx.font = font(500, 15);
  ctx.fillText(viewName, pad, 72);

  let y = headH;
  rows.forEach((row, ri) => {
    const rh = heights[ri];
    ctx.fillStyle = col('--bg-elev');
    rr(pad, y, W - pad * 2, rh, 14); ctx.fill();
    ctx.save(); rr(pad, y, W - pad * 2, rh, 14); ctx.clip();
    ctx.fillStyle = row.tier.color;
    ctx.fillRect(pad, y, label, rh);
    ctx.restore();

    // Tier-Name, notfalls verkleinert
    ctx.fillStyle = '#15171c';
    let fs = row.tier.name.length > 3 ? 18 : 30;
    ctx.font = font(800, fs);
    while (ctx.measureText(row.tier.name).width > label - 16 && fs > 10) ctx.font = font(800, --fs);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(row.tier.name, pad + label / 2, y + rh / 2);
    ctx.textAlign = 'left';

    row.items.forEach((it, i) => {
      const cx = pad + label + gap + (i % cols) * (tw + gap);
      const cy = y + gap + Math.floor(i / cols) * (th + gap);
      drawTileCanvas(ctx, it, cx, cy, tw, th, { font, rr, imgs: covers.get(it.id), showTitles });
    });
    y += rh + gap;
  });

  ctx.fillStyle = col('--muted');
  ctx.font = font(500, 12);
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(new Date().toLocaleDateString('de-DE'), pad, H - 14);
  if (covers.size) {
    ctx.textAlign = 'right';
    ctx.fillText('Cover: Wikipedia', W - pad, H - 14);
    ctx.textAlign = 'left';
  }

  c.toBlob(blob => downloadBlob(blob, `tierly-${App.board}-${groupLike ? 'gruppe' : 'liste'}-${fileStamp()}.png`), 'image/png');
}

/* Zeichnet ein Bild wie object-fit: cover in das Rechteck */
function drawCover(ctx, im, x, y, w, h2) {
  const s = Math.max(w / im.width, h2 / im.height);
  const sw = w / s, sh = h2 / s;
  ctx.drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, x, y, w, h2);
}

function drawTileCanvas(ctx, it, x, y, w, h2, { font, rr, imgs, showTitles }) {
  const isFr = it.id.startsWith('fr:');
  ctx.save();
  rr(x, y, w, h2, 9);
  ctx.clip();

  if (imgs?.length) {
    ctx.fillStyle = '#0b0c10';
    ctx.fillRect(x, y, w, h2);
    const n = Math.min(imgs.length, 4), hw = (w - 1) / 2, hh = (h2 - 1) / 2;
    if (n === 1) drawCover(ctx, imgs[0], x, y, w, h2);
    else if (n === 2) { drawCover(ctx, imgs[0], x, y, hw, h2); drawCover(ctx, imgs[1], x + hw + 1, y, hw, h2); }
    else if (n === 3) { drawCover(ctx, imgs[0], x, y, hw, h2); drawCover(ctx, imgs[1], x + hw + 1, y, hw, hh); drawCover(ctx, imgs[2], x + hw + 1, y + hh + 1, hw, hh); }
    else imgs.slice(0, 4).forEach((im, i) => drawCover(ctx, im, x + (i % 2) * (hw + 1), y + Math.floor(i / 2) * (hh + 1), hw, hh));
  } else {
    const hue = tileHue(it);
    const g = ctx.createLinearGradient(x, y, x + w, y + h2);
    g.addColorStop(0, `hsl(${hue} 64% 52%)`);
    g.addColorStop(1, `hsl(${(hue + 28) % 360} 58% 24%)`);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h2);
    const mono = initials(it.title);
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    ctx.font = font(800, Math.round(w * (mono.length > 3 ? 0.26 : 0.36)));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(mono, x + w / 2, y + h2 / 2);
  }

  // Titel & Jahr: bei Farbkacheln und Franchises immer, bei Covern nur mit „Titel anzeigen“
  if (!imgs?.length || isFr || showTitles) {
    const shade = ctx.createLinearGradient(0, y + h2, 0, y);
    shade.addColorStop(0, 'rgba(0,0,0,.8)');
    shade.addColorStop(0.5, 'rgba(0,0,0,.2)');
    shade.addColorStop(0.75, 'rgba(0,0,0,0)');
    ctx.fillStyle = shade;
    ctx.fillRect(x, y, w, h2);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = font(700, 11);
    ctx.fillStyle = '#fff';
    const lines = [];
    let line = '';
    for (const word of it.title.split(' ')) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > w - 10 && line) { lines.push(line); line = word; } else line = test;
    }
    if (line) lines.push(line);
    if (lines.length > 3) { lines.length = 3; lines[2] = lines[2].replace(/.{0,2}$/, '…'); }
    lines.forEach((l, i) => ctx.fillText(l, x + 5, y + h2 - 6 - (lines.length - 1 - i) * 13, w - 10));

    const meta = isFr ? `${it.count} Spiele` : it.year ? String(it.year) : '';
    if (meta) {
      ctx.font = font(700, 9.5);
      const mw = ctx.measureText(meta).width + 10;
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      rr(x + w - mw - 4, y + 4, mw, 15, 6); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(meta, x + w - mw + 1, y + 15);
    }
  }
  ctx.restore();
}

/* ───────── Start ───────── */
App.init();
