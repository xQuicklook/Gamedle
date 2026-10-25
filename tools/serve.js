// Kleiner Webserver fürs lokale Testen: liefert das Projekt aus, „/“ ist gamedar.html.
// Aufruf: node tools/serve.js [Port]   (Standard 5180)
// Duell zu zweit auf einem Rechner: einmal http://localhost:PORT/ und einmal http://127.0.0.1:PORT/ öffnen –
// zwei Adressen bedeuten getrennten Speicher und damit zwei Spieler.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const port = Number(process.argv[2]) || 5180;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(root, url === '/' ? 'gamedar.html' : url);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('nicht gefunden'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, () => console.log(`http://localhost:${port}/  ·  http://127.0.0.1:${port}/`));
