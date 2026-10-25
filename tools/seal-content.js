// Versiegelt die Rätsel-Inhalte (src/gamedle-content.js) für die gebaute Seite – siehe src/gamedle-seal.js.
// build.ps1 setzt die Ausgabe anstelle von gamedle-content.js ein; die Quelldatei bleibt lesbar und bearbeitbar.
// Die Ausgabe ist reines ASCII, damit sie unbeschadet durch PowerShell kommt.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const NAMES = ['GD_EMOJI_HINTS', 'GD_QUOTES', 'GD_SCENES'];

function sealContent() {
  const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  const C = vm.runInNewContext(`${src('gamedle-seal.js')}\n${src('gamedle-content.js')}\n;({ gdSeal, ${NAMES.join(', ')} })`,
    { TextEncoder, TextDecoder, btoa, atob });
  return '/* Gamedar: Inhalte der Zusatz-Modi, beim Bauen versiegelt (Quelle: src/gamedle-content.js) */\n' +
    NAMES.map(n => `const ${n} = gdUnseal('${C.gdSeal(C[n], n)}', '${n}');`).join('\n') + '\n';
}

module.exports = { sealContent, NAMES };
if (require.main === module) process.stdout.write(sealContent());
