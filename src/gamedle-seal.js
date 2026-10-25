/* ───────── Gamedar: Lösungen verschleiern ─────────
   Spielplan und Rätsel-Inhalte (Zitat, Emoji, Szene) stehen nicht im Klartext in der Seite – so
   lassen sich kommende Lösungen weder im Quelltext nachlesen noch per Suche finden. Das ist
   Verschleierung, kein Geheimnis: Wer den Code ausführt, kommt an alles heran; ohne Server geht es
   nicht anders. Der Spielplan liegt auch im Repository nur versiegelt vor (tools/gamedle-schedule.js),
   die Inhalte werden erst beim Bauen versiegelt (tools/seal-content.js). */
const GD_SEAL_KEY = 'gamedar/1';

/* XOR mit einem Zahlenstrom (xorshift32) aus Schlüssel und Salz – Hin- und Rückweg sind gleich */
function gdSealBytes(bytes, salt) {
  let x = 0x811c9dc5;
  for (const ch of GD_SEAL_KEY + ':' + salt) x = Math.imul(x ^ ch.codePointAt(0), 0x01000193);
  x = x || 1;
  return bytes.map(b => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return b ^ (x & 255); });
}

/* Beliebiger JSON-Wert → Base64-Text; das Salz (z. B. der Name) lässt gleiche Werte verschieden aussehen */
function gdSeal(value, salt = '') {
  const bytes = gdSealBytes(new TextEncoder().encode(JSON.stringify(value)), salt);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function gdUnseal(code, salt = '') {
  const bytes = Uint8Array.from(atob(code), c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(gdSealBytes(bytes, salt)));
}

/* { schlüssel: versiegelt } → { schlüssel: Wert }, jeweils mit dem Schlüssel als Salz */
const gdUnsealAll = sealed => Object.fromEntries(Object.entries(sealed).map(([k, v]) => [k, gdUnseal(v, k)]));
