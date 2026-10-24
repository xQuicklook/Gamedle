/* ───────── Spiele verwalten ───────── */
const field = (label, input, cls = '') => h('label.field' + (cls ? '.' + cls : ''), h('span', label), input);
const franchiseNames = () => [...new Set(Object.values(App.state.items).map(it => it.franchise).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
const libItems = () => App.state.order.map(id => App.state.items[id]).filter(Boolean);
const inRoom = r => !!itemIndex(App.state).duplicateOf(r);

function parseImport(text) {
  return text.split(/\r?\n/).map(line => {
    const parts = line.split(/\s*[;|\t]\s*/).map(p => p.trim()).filter(Boolean);
    if (!parts.length) return null;
    const [title, ...rest] = parts;
    const year = rest.find(p => /^\d{4}$/.test(p));
    const franchise = rest.find(p => p !== year) || '';
    return { title, year, franchise };
  }).filter(Boolean);
}

/* Cover für frisch hinzugefügte Spiele im Hintergrund nachladen */
async function coversFor(ids, onProgress) {
  const items = ids.map(id => App.state.items[id]).filter(it => it && !it.img);
  if (!items.length) return 0;
  try {
    const patches = await fetchMissingCovers(items, onProgress);
    if (patches.length) App.dispatch({ type: 'items/patch', patches });
    return patches.length;
  } catch (e) {
    console.warn(e);
    toast('Cover konnten nicht geladen werden – bist du online?');
    return 0;
  }
}

/* Genres für Spiele ohne Genre nachtragen (kuratiert, sonst Wikidata) */
async function genresFor(ids, onProgress) {
  const items = ids.map(id => App.state.items[id]).filter(it => it && !it.genres?.length);
  if (!items.length) return 0;
  try {
    const patches = await fetchMissingGenres(items, onProgress);
    if (patches.length) App.dispatch({ type: 'items/patch', patches });
    return patches.length;
  } catch (e) {
    console.warn(e);
    toast('Genres konnten nicht geladen werden – bist du online?');
    return 0;
  }
}

/* Aus dem Genre-Filter heraus: alle fehlenden Genres der Bibliothek laden */
async function loadMissingGenres() {
  const ids = libItems().filter(it => !it.genres?.length).map(it => it.id);
  const t = toast(`Lade Genres für ${ids.length} Spiele …`, 60000);
  const n = await genresFor(ids);
  t.remove();
  toast(n ? `${n} Spiele mit Genre ergänzt${n < ids.length ? ` – ${ids.length - n} ohne Treffer (per „Bearbeiten“ von Hand setzen)` : ''}` : 'Keine Genres gefunden', 5000);
}

/* Genre-Auswahl (bis zu 4) – aufklappbar, damit die vielen Genres nicht das ganze Formular füllen */
function genrePicker(initial = []) {
  const sel = new Set(initial);
  const summary = h('summary');
  const chips = h('div.genre-picks');
  const draw = () => {
    summary.replaceChildren(h('span', 'Genres'), h('span.muted', sel.size ? [...sel].map(genreName).join(', ') : 'keine'));
    chips.replaceChildren(...Object.keys(GD_GENRES).sort((a, b) => genreName(a).localeCompare(genreName(b), 'de')).map(k => h('button.chip', {
      type: 'button', 'aria-pressed': String(sel.has(k)), disabled: !sel.has(k) && sel.size >= 4,
      onclick: () => { if (!sel.delete(k)) sel.add(k); draw(); },
    }, genreName(k))));
  };
  draw();
  return { el: h('details.genre-box.full', summary, chips), value: () => [...sel] };
}

function warnUnsafeImg() {
  toast('Dieser Bild-Link wird nicht angezeigt: Im Raum sind nur Wikipedia-Bilder und Uploads erlaubt (Host-Einstellung). Lade das Bild stattdessen hoch.', 7000);
}

/* Datei-Auswahl für eigene Cover */
function pickImage(onData) {
  const input = h('input', { type: 'file', accept: 'image/*' });
  input.onchange = () => imageToThumb(input.files[0]).then(onData).catch(e => toast(e.message));
  input.click();
}

function libraryModal(tab = null, query = '') {
  tab = tab || (query || App.state.order.length ? 'add' : 'packs');
  const content = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
  const mkTabs = () => tabbed([
    ['add', 'Suchen'], ['packs', 'Pakete'], ['import', 'Liste'], ['list', `Bibliothek (${App.state.order.length})`],
  ], tab, t => { tab = t; refresh(); });
  let tabsEl = mkTabs();
  const refreshTabs = () => { const n = mkTabs(); tabsEl.replaceWith(n); tabsEl = n; };
  const refresh = () => { refreshTabs(); draw(); };

  const sections = {
    /* Online-Suche (Wikipedia) – der Standardweg, um Spiele hinzuzufügen */
    add() {
      const input = h('input', { type: 'search', value: query, placeholder: 'Spiel suchen, z. B. Outer Wilds', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Spiel suchen' });
      const results = h('div.results');
      let seq = 0, timer = 0, current = [];

      const row = r => {
        const has = inRoom(r);
        const btn = h('button.btn.sm' + (has ? '.added' : '.primary'), {
          disabled: has,
          onclick: () => {
            if (App.dispatch({ type: 'items/add', items: [{ title: r.title, year: r.year, franchise: r.franchise, img: r.img, wiki: r.wiki, genres: r.genres }] })) {
              toast(`„${r.title}“ hinzugefügt`);
              refreshTabs();
              btn.replaceWith(row(r).lastChild);
            }
          },
        }, has ? [icon('check'), 'Drin'] : [icon('plus'), 'Hinzufügen']);
        return h('div.result',
          makeTile({ id: 'search', title: r.title, img: r.img, franchise: r.franchise, year: r.year }, {}),
          h('div.result-meta', h('strong', r.title), h('span', [r.year, r.franchise === undefined ? '…' : r.franchise].filter(Boolean).join(' · ') || ' ')),
          btn);
      };
      const show = list => {
        current = list;
        results.replaceChildren(...list.map(row));
        if (!list.length) results.append(h('p.help', 'Nichts gefunden. Probier den englischen Originaltitel – oder füge das Spiel unten manuell hinzu.'));
      };
      const run = async () => {
        const q = input.value.trim();
        const my = ++seq;
        if (q.length < 2) { results.replaceChildren(); return; }
        results.replaceChildren(h('div.skeleton'), h('div.skeleton'), h('div.skeleton'));
        try {
          const list = await Wiki.search(q, 8);
          if (my !== seq) return;
          show(list); // sofort anzeigen, Reihe/Jahr von Wikidata kommen gleich nach
          if (list.some(r => r.franchise === undefined)) {
            await enrichResults(list);
            if (my === seq) show(list);
          }
        } catch (e) {
          if (my !== seq) return;
          console.warn(e);
          results.replaceChildren(h('p.help', 'Wikipedia ist gerade nicht erreichbar. Du kannst das Spiel unten manuell hinzufügen.'));
        }
      };
      input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 350); });
      input.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        clearTimeout(timer);
        const first = current.find(r => !inRoom(r));
        if (first && results.firstChild) $$('.result .btn.primary', results)[0]?.click();
        else run();
      });
      if (query) run();

      return [
        h('div.search-big', icon('search'), input),
        results,
        h('p.credit', 'Cover, Jahr und Reihe kommen automatisch von Wikipedia & Wikidata.'),
        manualForm(),
      ];
    },

    packs() {
      // Schon im Raum? Über den Katalog – so zählen auch ältere Titel wie „Zelda: Ocarina of Time“
      const have = new Set(libItems().map(catalogEntry).filter(Boolean));
      const packs = presetPacks();
      const pack = p => {
        const fresh = p.games.filter(g => !have.has(g));
        const btn = h('button.btn.sm' + (fresh.length ? '.primary' : ''), {
          disabled: !fresh.length,
          onclick: async () => {
            btn.disabled = true;
            btn.textContent = 'Lade Cover …';
            let found = new Map();
            try { found = await Wiki.byTitles(fresh.map(g => g.wiki)); }
            catch (e) { console.warn(e); toast('Cover nicht erreichbar – Spiele werden ohne Cover hinzugefügt.'); }
            const before = App.state.order.length;
            App.dispatch({
              type: 'items/add',
              items: fresh.map(g => {
                const info = found.get(g.wiki);
                return { title: g.name, year: g.year, franchise: g.series, wiki: info?.wiki || g.wiki, img: info?.img || '', genres: g.genres };
              }),
            });
            const n = App.state.order.length - before;
            toast(n ? `${n} Spiele hinzugefügt` : 'Alle Spiele waren schon vorhanden.');
            refresh();
          },
        }, fresh.length ? (fresh.length === p.games.length ? 'Hinzufügen' : `+ ${fresh.length} neue`) : 'Schon drin');
        return h('div.pack', h('div.pack-info', h('strong', p.name), h('span', `${p.desc} · ${p.games.length} Spiele`)), btn);
      };
      return [
        h('p.help', `Pakete aus unserem Katalog mit ${CATALOG.length} bekannten Spielen – inklusive Cover, Genre und Reihe. Pakete lassen sich kombinieren, vorhandene Spiele werden übersprungen.`),
        ...[...new Set(packs.map(p => p.group))].map(group => h('section.pack-group',
          h('h4', group), h('div.pack-grid', packs.filter(p => p.group === group).map(pack)))),
      ];
    },

    import() {
      const ta = h('textarea', { rows: 9, placeholder: 'Outer Wilds\nHollow Knight; 2017\nHollow Knight: Silksong; 2025; Hollow Knight' });
      const btn = h('button.btn.primary', {
        onclick: async () => {
          const items = parseImport(ta.value);
          if (!items.length) { toast('Nichts zum Importieren gefunden.'); return; }
          const before = new Set(App.state.order);
          App.dispatch({ type: 'items/add', items });
          const added = App.state.order.filter(id => !before.has(id));
          if (!added.length) { toast('Alle Spiele waren schon vorhanden.'); return; }
          ta.value = '';
          refreshTabs();
          btn.disabled = true;
          const n = await coversFor(added, (d, t) => { btn.textContent = `Suche Cover … ${d}/${t}`; });
          btn.textContent = 'Suche Genres …';
          await genresFor(added); // nach den Covern: dann ist der Wikipedia-Artikel bekannt
          toast(`${added.length} Spiele importiert, ${n} mit Cover`);
          btn.disabled = false;
          btn.replaceChildren(icon('upload'), 'Importieren');
        },
      }, icon('upload'), 'Importieren');
      return [
        h('p.help', 'Ganze Liste auf einmal: ein Spiel pro Zeile, optional ', h('code', 'Titel; Jahr; Franchise'), '. Cover und Genres werden danach automatisch gesucht.'),
        ta, h('div', btn),
      ];
    },

    list() {
      const q = h('input', { type: 'search', placeholder: 'Bibliothek durchsuchen …' });
      const list = h('div.lib-list');
      const missing = libItems().filter(it => !it.img);
      const bar = h('div.progress', { hidden: true }, h('i'));
      const coverBtn = missing.length ? h('button.btn.sm', {
        onclick: async () => {
          coverBtn.disabled = true;
          bar.hidden = false;
          const n = await coversFor(missing.map(it => it.id), (d, t) => {
            bar.firstChild.style.width = Math.round((d / t) * 100) + '%';
            coverBtn.textContent = `Suche Cover … ${d}/${t}`;
          });
          toast(n ? `${n} Cover gefunden${n < missing.length ? `, ${missing.length - n} ohne Treffer` : ''}` : 'Keine weiteren Cover gefunden');
          draw();
        },
      }, icon('image'), `Fehlende Cover laden (${missing.length})`) : null;
      const noGenre = libItems().filter(it => !it.genres?.length);
      const genreBtn = noGenre.length ? h('button.btn.sm', {
        onclick: async () => {
          genreBtn.disabled = true;
          genreBtn.textContent = 'Suche Genres …';
          const n = await genresFor(noGenre.map(it => it.id), (d, t) => { genreBtn.textContent = `Suche Genres … ${d}/${t}`; });
          toast(n ? `${n} Genres ergänzt${n < noGenre.length ? `, ${noGenre.length - n} ohne Treffer` : ''}` : 'Keine weiteren Genres gefunden');
          draw();
        },
      }, icon('layers'), `Fehlende Genres laden (${noGenre.length})`) : null;

      const fill = () => {
        const nq = norm(q.value);
        const items = libItems()
          .filter(it => !nq || norm(it.title).includes(nq) || norm(it.franchise).includes(nq) || (it.genres || []).some(g => norm(genreName(g)).includes(nq)))
          .sort((a, b) => (a.year || 9999) - (b.year || 9999) || a.title.localeCompare(b.title, 'de'));
        list.replaceChildren(...items.map(it => h('div.lib-item',
          makeTile(it, {}),
          h('div.lib-meta', h('strong', it.title), h('span', [it.year, it.franchise, (it.genres || []).map(genreName).join(', ')].filter(Boolean).join(' · ') || '–')),
          h('div', { style: { display: 'flex' } },
            h('button.icon-btn.sm', { title: 'Bearbeiten', 'aria-label': 'Bearbeiten', onclick: () => editItemModal(it.id, fill) }, icon('edit')),
            h('button.icon-btn.sm', {
              title: 'Entfernen', 'aria-label': 'Entfernen',
              onclick: () => {
                App.dispatch({ type: 'items/remove', ids: [it.id] });
                toast(`„${it.title}“ entfernt`, 5000, { label: 'Rückgängig', onClick: () => { Undo.undoLast(); fill(); refreshTabs(); } });
                fill(); refreshTabs();
              },
            }, icon('trash'))))));
        if (!items.length) list.append(h('p.help', App.state.order.length ? 'Keine Treffer.' : 'Die Bibliothek ist noch leer.'));
      };
      q.addEventListener('input', fill);
      fill();
      return [
        h('div.lib-toolbar', q, coverBtn, genreBtn), bar, list,
        App.state.order.length ? h('div', h('button.btn.sm.danger', {
          onclick: () => confirmDialog('Alle Spiele entfernen?', 'Die Bibliothek und sämtliche Platzierungen aller Spieler werden geleert.', 'Alles entfernen', true)
            .then(ok => { if (ok) { App.dispatch({ type: 'items/clear' }); refresh(); } }),
        }, icon('trash'), 'Alle entfernen')) : null,
      ];
    },
  };

  /* Manuell – für Spiele ohne Wikipedia-Artikel; Cover per Link, Datei oder Einfügen */
  function manualForm() {
    const wrap = h('div.manual');
    const open = () => {
      let upload = '';
      const title = h('input', { placeholder: 'Titel', maxlength: 90, required: true, value: $('input[type=search]', content)?.value || '' });
      const fr = h('input', { placeholder: 'optional', list: 'frList', maxlength: 60 });
      const year = h('input', { type: 'number', placeholder: 'Jahr', min: 1950, max: 2100, inputmode: 'numeric' });
      const img = h('input', { type: 'url', placeholder: 'https://… (optional)', onchange: e => { if (safeUrl(e.target.value) && !imgAllowed(App.state, safeUrl(e.target.value))) warnUnsafeImg(); } });
      const upBtn = h('button.btn.sm', { type: 'button', onclick: () => pickImage(d => { upload = d; upBtn.replaceChildren(icon('check'), 'Bild gewählt'); }) }, icon('upload'), 'Bild hochladen');
      let genres = genrePicker();
      const form = h('form.form-grid', {
        onsubmit: e => {
          e.preventDefault();
          const name = title.value.trim();
          const id = upload ? uid(10) : '';
          const ok = App.dispatch({
            type: 'items/add',
            items: [{ title: name, year: year.value, franchise: fr.value, img: id ? 'asset:' + id : img.value, genres: genres.value() }],
            assets: id ? { [id]: upload } : undefined,
          });
          if (!ok) { toast(name ? `„${name}“ ist schon in der Liste.` : 'Bitte einen Titel eingeben.'); return; }
          toast(`„${name}“ hinzugefügt`);
          title.value = ''; year.value = ''; img.value = ''; upload = '';
          const fresh = genrePicker();
          genres.el.replaceWith(fresh.el);
          genres = fresh;
          upBtn.replaceChildren(icon('upload'), 'Bild hochladen');
          title.focus();
          refreshTabs();
        },
      },
      field('Titel', title, 'full'), field('Franchise / Reihe', fr), field('Jahr', year),
      genres.el,
      field('Cover-Link', img, 'full'), h('div.full', upBtn),
      h('datalist#frList', franchiseNames().map(n => h('option', { value: n }))),
      h('button.btn.primary.full', { type: 'submit' }, icon('plus'), 'Hinzufügen'));
      wrap.replaceChildren(h('strong', 'Manuell hinzufügen'), form);
      title.focus();
    };
    wrap.append(h('p.help', 'Nicht gefunden? ', h('button.linkish', { type: 'button', onclick: open }, 'Spiel manuell hinzufügen')));
    return wrap;
  }

  const draw = () => {
    content.replaceChildren(...(App.canEditConfig()
      ? sections[tab]().filter(k => k != null && k !== false) // sonst stünde „null“ als Text da
      : [h('p.help', 'Der Host hat das Bearbeiten gesperrt – du kannst die Spiele nur ranken.')]));
  };
  draw();
  openModal({ title: 'Spiele hinzufügen & verwalten', tabs: tabsEl, body: content, width: 600 });
}

/* ───────── Spiel bearbeiten (inkl. Cover wählen) ───────── */
function editItemModal(id, after) {
  const it = App.state.items[id];
  if (!it) return;
  let img = it.img, wiki = it.wiki, upload = '';

  const title = h('input', { value: it.title, maxlength: 90 });
  const fr = h('input', { value: it.franchise, list: 'frListEdit', maxlength: 60, placeholder: 'optional' });
  const year = h('input', { type: 'number', value: it.year || '', min: 1950, max: 2100, inputmode: 'numeric' });
  const url = h('input', { type: 'url', value: /^https?:/.test(img) ? img : '', placeholder: 'https://…' });
  const genres = genrePicker(it.genres || []);
  const preview = h('div');
  const picks = h('div.cover-picks');

  const drawPreview = () => preview.replaceChildren(makeTile({ id: 'preview', title: title.value || it.title, year: +year.value || null, franchise: fr.value, img: upload || img }, {}));
  const setImg = (v, w = '') => { img = v; wiki = w; upload = ''; url.value = /^https?:/.test(v) ? v : ''; drawPreview(); };
  url.addEventListener('change', () => {
    const v = safeUrl(url.value);
    setImg(v, '');
    if (v && !imgAllowed(App.state, v)) warnUnsafeImg();
  });
  title.addEventListener('input', drawPreview);
  drawPreview();

  const searchBtn = h('button.btn.sm', {
    type: 'button',
    onclick: async () => {
      searchBtn.disabled = true;
      picks.replaceChildren(h('span.muted', 'Suche …'));
      try {
        const list = (await Wiki.search(title.value || it.title, 10)).filter(r => r.img);
        picks.replaceChildren(...list.map(r => h('button', {
          type: 'button', title: [r.title, r.year].filter(Boolean).join(' · '),
          onclick: () => { setImg(r.img, r.wiki); if (!year.value && r.year) year.value = r.year; drawPreview(); },
        }, makeTile({ id: 'pick', title: r.title, img: r.img }, {}))));
        if (!list.length) picks.replaceChildren(h('span.muted', 'Keine Cover gefunden.'));
      } catch { picks.replaceChildren(h('span.muted', 'Wikipedia nicht erreichbar.')); }
      searchBtn.disabled = false;
    },
  }, icon('search'), 'Cover suchen');

  const onPaste = e => {
    const file = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    imageToThumb(file).then(d => { upload = d; drawPreview(); toast('Bild eingefügt'); }).catch(err => toast(err.message));
  };

  const m = openModal({
    title: 'Spiel bearbeiten', width: 520,
    body: [
      h('div.cover-edit', preview, h('div.cover-actions',
        h('div.row',
          searchBtn,
          h('button.btn.sm', { type: 'button', onclick: () => pickImage(d => { upload = d; drawPreview(); }) }, icon('upload'), 'Hochladen'),
          h('button.btn.sm.ghost', { type: 'button', onclick: () => setImg('', '') }, 'Entfernen')),
        picks,
        h('p.help', 'Tipp: Ein Bild aus der Zwischenablage kannst du hier einfach mit Strg+V einfügen.'))),
      h('div.form-grid',
        field('Titel', title, 'full'), field('Franchise / Reihe', fr), field('Jahr', year), genres.el, field('Cover-Link', url, 'full'),
        h('datalist#frListEdit', franchiseNames().map(n => h('option', { value: n })))),
    ],
    foot: [
      h('button.btn.danger', { style: { marginRight: 'auto' }, onclick: () => { App.dispatch({ type: 'items/remove', ids: [id] }); m.close(); after?.(); toast('Entfernt'); } }, icon('trash'), 'Löschen'),
      h('button.btn.ghost', { onclick: () => m.close() }, 'Abbrechen'),
      h('button.btn.primary', {
        onclick: () => {
          if (!title.value.trim()) { title.focus(); return; }
          const patch = { title: title.value, franchise: fr.value, year: year.value, img, wiki, genres: genres.value() };
          const asset = upload ? { id: uid(10), data: upload } : undefined;
          App.dispatch({ type: 'items/update', id, patch, asset });
          if (asset && App.state.items[id]?.img !== 'asset:' + asset.id) toast('Bild nicht gespeichert: Der Raum hat das Limit für eigene Bilder erreicht (120 Bilder bzw. 4 MB).', 6000);
          m.close(); after?.();
        },
      }, 'Speichern'),
    ],
  });
  m.el.addEventListener('paste', onPaste);
}

/* ───────── Stufen bearbeiten ───────── */
function tiersModal() {
  if (!App.canEditConfig()) { toast('Nur der Host kann die Stufen bearbeiten.'); return; }
  let tiers = clone(App.state.tiers);
  const list = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
  const iconBtn = (ic, label, disabled, fn) => h('button.icon-btn.sm', { title: label, 'aria-label': label, disabled, onclick: fn }, icon(ic));
  const move = (i, j) => { [tiers[i], tiers[j]] = [tiers[j], tiers[i]]; draw(); };

  const lastRated = t => !t.unrated && tiers.filter(x => !x.unrated).length <= 1;
  const draw = () => list.replaceChildren(...tiers.map((t, i) => h('div.tier-edit-row',
    h('input', { type: 'color', value: t.color, 'aria-label': 'Farbe', oninput: e => { t.color = e.target.value; } }),
    h('input', { value: t.name, maxlength: 24, 'aria-label': 'Name der Stufe', oninput: e => { t.name = e.target.value; } }),
    h('label.tier-skip', { title: lastRated(t) ? 'Mindestens eine Stufe muss in die Wertung eingehen.' : 'Spiele in dieser Stufe zählen nicht fürs Gruppenergebnis und die Statistik – z. B. für „Nicht gespielt“.' },
      h('input', { type: 'checkbox', checked: !!t.unrated, disabled: lastRated(t), onchange: e => { t.unrated = e.target.checked; draw(); } }),
      h('span', 'Nicht werten')),
    h('div.row-actions',
      iconBtn('up', 'Nach oben', i === 0, () => move(i, i - 1)),
      iconBtn('down', 'Nach unten', i === tiers.length - 1, () => move(i, i + 1)),
      iconBtn('trash', 'Entfernen', tiers.length <= 1, () => { tiers.splice(i, 1); draw(); })),
  )));
  draw();

  const m = openModal({
    title: 'Stufen bearbeiten', width: 520,
    body: [
      h('div.field', h('span', 'Vorlagen'), h('div.preset-row', TIER_PRESETS.map(p => h('button.btn.sm', {
        onclick: () => { tiers = p.tiers.map(([name, color], i) => ({ id: tiers[i]?.id || uid(6), name, color })); draw(); },
      }, p.name)))),
      list,
      h('div.row', { style: { flexWrap: 'wrap' } },
        h('button.btn.sm', {
          disabled: tiers.length >= 20,
          onclick: () => {
            tiers.push({ id: uid(6), name: 'Neu', color: '#94a3b8' });
            draw();
            list.lastElementChild.querySelector('input:not([type=color])').select();
          },
        }, icon('plus'), 'Stufe hinzufügen'),
        h('button.btn.sm', {
          disabled: tiers.length >= 20,
          title: 'Stufe für Spiele, die du nicht kennst – zählt nicht in der Wertung',
          onclick: () => { tiers.push({ id: uid(6), name: 'Nicht gespielt', color: '#64748b', unrated: true }); draw(); },
        }, icon('plus'), '„Nicht gespielt“')),
      h('p.help', 'Die Stufen gelten für alle im Raum. Spiele in einer gelöschten Stufe wandern zurück in die Auswahl. ',
        'Stufen mit „Nicht werten“ zählen nicht fürs Gruppenergebnis und die Statistik.'),
    ],
    foot: [
      h('button.btn.ghost', { onclick: () => m.close() }, 'Abbrechen'),
      h('button.btn.primary', { onclick: () => { if (App.dispatch({ type: 'tiers/set', tiers })) toast('Stufen gespeichert'); m.close(); } }, 'Speichern'),
    ],
  });
}
