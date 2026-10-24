/* ───────── Spielekatalog (gemeinsam für Tierly und Gamedle) ─────────
   Kern sind die vollständig geprüften Spiele aus gamedle-data.js – sie sind zugleich
   Tierly-Startspiele. CATALOG_EXTRA ergänzt Spiele nur für Tierly: Basisdaten genügen,
   bis ein Spiel mit allen Rätsel-Angaben geprüft ist und nach gamedle-data.js umzieht.
   Format: [Titel, Jahr, Genres, Plattformen bei Erstveröffentlichung, Reihe, Spielmodi,
            Wikipedia-Artikel (falls abweichend), Alternativnamen] – Kürzel wie in gamedle-data.js */
const CATALOG_EXTRA = [
  ['Tetris', 1984, 'puz', 'pc', 'Tetris', 'e'],
];

/* Kürzerer bzw. deutscher Name für Tierly – muss ein Alternativname sein (Gamedle findet ihn so auch) */
const CATALOG_SHORT = {
  'The Legend of Zelda: A Link to the Past': 'Zelda: A Link to the Past',
  'The Legend of Zelda: Ocarina of Time': 'Zelda: Ocarina of Time',
  "The Legend of Zelda: Majora's Mask": "Zelda: Majora's Mask",
  'The Legend of Zelda: The Wind Waker': 'Zelda: The Wind Waker',
  'The Legend of Zelda: Breath of the Wild': 'Zelda: Breath of the Wild',
  'The Legend of Zelda: Tears of the Kingdom': 'Zelda: Tears of the Kingdom',
  'Warcraft II: Tides of Darkness': 'Warcraft II',
  'Warcraft III: Reign of Chaos': 'Warcraft III',
  'StarCraft II: Wings of Liberty': 'StarCraft II',
  'Pokémon Red & Blue': 'Pokémon Rot & Blau',
  'Pokémon Gold & Silver': 'Pokémon Gold & Silber',
  'Pokémon Sword & Shield': 'Pokémon Schwert & Schild',
  'The Sims': 'Die Sims',
  'Metal Gear Solid 2: Sons of Liberty': 'Metal Gear Solid 2',
  'Metal Gear Solid V: The Phantom Pain': 'Metal Gear Solid V',
  'Grand Theft Auto: Vice City': 'GTA: Vice City',
  'Grand Theft Auto: San Andreas': 'GTA: San Andreas',
  'The Witcher 2: Assassins of Kings': 'The Witcher 2',
  'Death Stranding 2: On the Beach': 'Death Stranding 2',
};

const CATALOG = [
  ...GD_GAMES.map(([title, year, genres, plats, , , series, , modes, , wiki, aliases]) => ({ title, year, genres, plats, series, modes, wiki, aliases, gamedle: true })),
  ...CATALOG_EXTRA.map(([title, year, genres, plats, series, modes, wiki, aliases]) => ({ title, year, genres, plats, series, modes, wiki, aliases, gamedle: false })),
].map(g => ({
  ...g,
  name: CATALOG_SHORT[g.title] || g.title, // Anzeigename in Tierly
  wiki: g.wiki || g.title,
  genres: g.genres.split(','), plats: g.plats.split(','), modes: g.modes.split(','),
  aliases: g.aliases ? g.aliases.split('|') : [],
}));

/* Katalog-Eintrag zu einem Spiel: über den Wikipedia-Artikel, sonst über Titel oder
   Alternativnamen – bei bekanntem Jahr nur, wenn es passt (Doom 1993 ≠ Doom 2016). */
let catalogIndex = null;
function catalogEntry(it) {
  if (!catalogIndex) {
    catalogIndex = { byWiki: new Map(), byTitle: new Map() };
    for (const g of CATALOG) {
      catalogIndex.byWiki.set(g.wiki, g);
      for (const t of [g.title, g.name, ...g.aliases]) if (!catalogIndex.byTitle.has(norm(t))) catalogIndex.byTitle.set(norm(t), g);
    }
  }
  if (it.wiki && catalogIndex.byWiki.has(it.wiki)) return catalogIndex.byWiki.get(it.wiki);
  const g = catalogIndex.byTitle.get(norm(it.title));
  return g && (!it.year || it.year === g.year) ? g : null;
}
