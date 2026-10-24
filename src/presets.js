/* ───────── Vorlagen-Pakete ─────────
   Pakete sind Filter über den Spielekatalog (catalog.js): Ein neues Spiel im Katalog landet
   automatisch in allen passenden Paketen. Zu kleine Pakete (unter PACK_MIN Spielen) bleiben
   ausgeblendet und erscheinen von selbst, sobald der Katalog wächst. */
const hasGenre = (g, ...keys) => keys.some(k => g.genres.includes(k));
const onlyOn = (g, plat) => g.plats.length === 1 && g.plats[0] === plat; // zum Start nur auf dieser Plattform
const PACK_MIN = 12, SMALL_PACK_MIN = 5; // klein: Jahrzehnte und Reihen dürfen kürzer sein

const PRESET_PACKS = [
  { group: 'Jahrzehnte', id: 'all', name: 'Alle Spiele', desc: 'Der komplette Katalog – von Pong bis heute', filter: () => true },
  { group: 'Jahrzehnte', id: '80', name: '1970er & 80er', desc: 'Spielhalle, NES & frühe Heimcomputer', filter: g => g.year < 1990, min: SMALL_PACK_MIN },
  { group: 'Jahrzehnte', id: '90', name: '1990er', desc: '16-Bit, PlayStation & N64', filter: g => g.year >= 1990 && g.year < 2000, min: SMALL_PACK_MIN },
  { group: 'Jahrzehnte', id: '00', name: '2000er', desc: 'PS2, GameCube, Xbox & PC-Hochzeit', filter: g => g.year >= 2000 && g.year < 2010, min: SMALL_PACK_MIN },
  { group: 'Jahrzehnte', id: '10', name: '2010er', desc: 'Open Worlds, Souls & Indies', filter: g => g.year >= 2010 && g.year < 2020, min: SMALL_PACK_MIN },
  { group: 'Jahrzehnte', id: '20', name: '2020er', desc: 'Die aktuelle Generation', filter: g => g.year >= 2020, min: SMALL_PACK_MIN },

  { group: 'Genres', id: 'rpg', name: 'Rollenspiele', desc: 'Klassisch, Action-RPG & Online', filter: g => hasGenre(g, 'rpg', 'arpg', 'mmo') },
  { group: 'Genres', id: 'aa', name: 'Action-Adventure', desc: 'Zelda, Uncharted, Arkham & Co.', filter: g => hasGenre(g, 'aa') },
  { group: 'Genres', id: 'shooter', name: 'Shooter', desc: 'Ego, Third-Person & Battle Royale', filter: g => hasGenre(g, 'fps', 'tps', 'br', 'shm') },
  { group: 'Genres', id: 'plat', name: 'Jump ’n’ Run & Metroidvania', desc: 'Hüpfen, springen, erkunden', filter: g => hasGenre(g, 'plat', 'mv') },
  { group: 'Genres', id: 'fun', name: 'Rennen, Kampf & Party', desc: 'Rennspiele, Prügler, Sport, Party- & Musikspiele', filter: g => hasGenre(g, 'rac', 'fig', 'spo', 'par', 'rhy') },
  { group: 'Genres', id: 'strategy', name: 'Strategie & Simulation', desc: 'Echtzeit, Runden, Aufbau & Sandbox', filter: g => hasGenre(g, 'str', 'sim', 'sbx', 'moba', 'card') },
  { group: 'Genres', id: 'horror', name: 'Horror & Survival', desc: 'Für den Gruselabend', filter: g => hasGenre(g, 'hor', 'surv') },
  { group: 'Genres', id: 'souls', name: 'Soulslikes & Hack ’n’ Slay', desc: 'Schwer, schnell, gnadenlos', filter: g => hasGenre(g, 'sou', 'hns') },
  { group: 'Genres', id: 'stealth', name: 'Stealth', desc: 'Schleichen statt kämpfen', filter: g => hasGenre(g, 'stl') },
  { group: 'Genres', id: 'adventure', name: 'Adventures & Puzzles', desc: 'Rätseln, erkunden, nachdenken', filter: g => hasGenre(g, 'adv', 'puz') },

  { group: 'Plattformen', id: 'nintendo', name: 'Nintendo', desc: 'Zum Start nur auf Nintendo-Konsolen', filter: g => onlyOn(g, 'nin') },
  { group: 'Plattformen', id: 'playstation', name: 'PlayStation-Exklusives', desc: 'Zum Start nur auf PlayStation', filter: g => onlyOn(g, 'ps') },
  { group: 'Plattformen', id: 'xbox', name: 'Xbox-Exklusives', desc: 'Zum Start nur auf Xbox', filter: g => onlyOn(g, 'xb') },
  { group: 'Plattformen', id: 'pc', name: 'PC-Klassiker', desc: 'Zum Start nur auf dem PC', filter: g => onlyOn(g, 'pc') },
  { group: 'Plattformen', id: 'retro', name: 'Arcade & Sega', desc: 'Spielhalle, Master System & Mega Drive', filter: g => g.plats.includes('arc') || g.plats.includes('sega') },
  { group: 'Plattformen', id: 'mobile', name: 'Handy-Spiele', desc: 'Zum Start nur auf dem Smartphone', filter: g => onlyOn(g, 'mob') },

  { group: 'Spielweise', id: 'coop', name: 'Koop-Spiele', desc: 'Gemeinsam spielbar – lokal oder online', filter: g => g.modes.includes('k') },
];

/* Alle anzeigbaren Pakete samt Spielen; jede Reihe mit mindestens 5 Spielen bekommt ein eigenes Paket */
function presetPacks() {
  const series = new Map();
  for (const g of CATALOG) if (g.series) series.set(g.series, (series.get(g.series) || 0) + 1);
  const seriesPacks = [...series].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de')).map(([s]) => ({
    group: 'Reihen', id: 'series:' + s, name: s, desc: 'Die Teile der Reihe im Katalog', filter: g => g.series === s, min: SMALL_PACK_MIN,
  }));
  return [...PRESET_PACKS, ...seriesPacks]
    .map(p => ({ ...p, games: CATALOG.filter(p.filter) }))
    .filter(p => p.games.length >= (p.min || PACK_MIN));
}

const TIER_PRESETS = [
  { id: 'classic', name: 'S – F', tiers: [['S', '#f87171'], ['A', '#fb923c'], ['B', '#facc15'], ['C', '#4ade80'], ['D', '#38bdf8'], ['F', '#a78bfa']] },
  { id: 'words', name: 'Meisterwerk … Finger weg', tiers: [['Meisterwerk', '#f87171'], ['Großartig', '#fb923c'], ['Gut', '#facc15'], ['Okay', '#4ade80'], ['Schwach', '#38bdf8'], ['Finger weg', '#a78bfa']] },
  { id: 'short', name: 'S – C (kompakt)', tiers: [['S', '#f87171'], ['A', '#facc15'], ['B', '#4ade80'], ['C', '#38bdf8']] },
  { id: 'numbers', name: '1 – 5 Sterne', tiers: [['★★★★★', '#f87171'], ['★★★★', '#fb923c'], ['★★★', '#facc15'], ['★★', '#4ade80'], ['★', '#38bdf8']] },
];

const PLAYER_COLORS = ['#7c6cff', '#f87171', '#fb923c', '#facc15', '#4ade80', '#2dd4bf', '#38bdf8', '#e879f9'];
