/* ───────── Statistik-Ansicht ───────── */
function statsPanel(board) {
  const s = App.state;
  const st = statsFor(s, board);
  const tierBadge = ti => {
    const t = s.tiers[clamp(Math.round(ti), 0, s.tiers.length - 1)];
    return h('span.tier-badge', { style: { background: t.color } }, t.name);
  };
  const smallTile = it => h('div.stat-tile', makeTile(it, { readonly: true }));
  const card = (title, sub, ...body) => h('section.stat-card', h('h3', title), sub ? h('p.help', sub) : null, ...body);
  const empty = text => h('p.help', text);

  if (st.players.length < 2) {
    return h('div.empty-board', h('h3', 'Noch zu wenig Daten'), h('p', 'Die Statistik erscheint, sobald mindestens zwei Spieler etwas platziert haben.'));
  }

  return h('div.stats-grid',
    card('Geschmackszwillinge', 'Wie oft landen eure gemeinsamen Spiele in derselben Stufe?',
      st.pairs.length ? h('div.stat-list', st.pairs.slice(0, 6).map(p => h('div.pair-row',
        h('div.pair-avatars', avatar(p.a, board), avatar(p.b, board)),
        h('div.pair-text', h('strong', `${p.a.name} & ${p.b.name}`), h('span.muted', `${p.common} gemeinsam`)),
        h('div.pair-bar', h('div.progress' + (p.match >= 75 ? '.ok' : ''), h('i', { style: { width: p.match + '%' } })), h('span', p.match + ' %'))))) : empty('Noch keine gemeinsamen Wertungen.')),

    card('Am umstrittensten', 'Hier gehen die Meinungen am weitesten auseinander.',
      st.controversial.length ? h('div.stat-list', st.controversial.map(c => h('div.item-row',
        smallTile(c.item),
        h('div.item-votes', h('strong', c.item.title), h('div.vote-chips', c.votes.map(v => {
          const p = s.players[v.pid];
          return h('span.vote-chip', { title: p?.name }, h('i', { style: { background: p?.color || '#888' } }), tierBadge(v.ti));
        })))))) : empty('Bisher seid ihr euch erstaunlich einig.')),

    card('Völlig einig', 'Gleiche Stufe bei allen, die es bewertet haben.',
      st.consensus.length ? h('div.stat-list', st.consensus.map(c => h('div.item-row',
        smallTile(c.item),
        h('div.item-votes', h('strong', c.item.title), h('span.muted', `${c.votes.length} Stimmen · `), tierBadge(c.mean))))) : empty('Noch kein einstimmiges Urteil.')),

    card('Ausreißer', 'Wo jemand am stärksten vom Rest abweicht.',
      st.outliers.length ? h('div.stat-list', st.outliers.map(o => h('div.item-row',
        smallTile(o.item),
        h('div.item-votes',
          h('strong', `${o.player.name} ${o.delta > 0 ? 'liebt' : 'mag kaum'} ${o.item.title}`),
          h('span.muted', 'selbst '), tierBadge(o.mine), h('span.muted', ' – die anderen im Schnitt '), tierBadge(o.others))))) : empty('Keine großen Ausreißer.')),

    board === 'games' ? card('Lieblings-Jahrzehnt', 'Das Jahrzehnt mit der besten Durchschnitts-Stufe (ab 2 Spielen).',
      st.decades.length ? h('div.stat-list', st.decades.map(d => h('div.pair-row',
        avatar(d.player, board),
        h('div.pair-text', h('strong', d.player.name), h('span.muted', `${d.n} Spiele`)),
        h('div.decade', h('strong', `${String(d.decade).slice(2)}er`), tierBadge(d.avg))))) : empty('Noch zu wenige Spiele mit Jahr.')) : null,
  );
}
