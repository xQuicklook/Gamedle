# Baut src/* zu einer einzigen, teilbaren Datei: gamedle.html (Gamedle + Tierly)
# PeerJS (vendor/peerjs.min.js, MIT) wird mit eingebettet – die Datei braucht kein CDN.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$src = Join-Path $root 'src'
$utf8 = New-Object System.Text.UTF8Encoding($false)

$jsFiles = @(
  # Tierly
  'presets.js', 'core.js', 'wiki.js', 'net.js', 'migration.js', 'diag.js', 'app.js', 'undo.js', 'dnd.js', 'layout.js',
  'rooms.js', 'reveal.js', 'stats.js', 'onboarding.js', 'modals.js', 'editors.js', 'export.js',
  # Gamedle + Übersicht (startet die Navigation, muss zuletzt kommen)
  'gamedle-data.js', 'gamedle-core.js', 'gamedle.js', 'hub.js'
)
$cssFiles = 'styles.css', 'gamedle.css'
$js = "'use strict';`n" + (($jsFiles | ForEach-Object { [IO.File]::ReadAllText((Join-Path $src $_), $utf8) }) -join "`n")
$css = ($cssFiles | ForEach-Object { [IO.File]::ReadAllText((Join-Path $src $_), $utf8) }) -join "`n"
$html = [IO.File]::ReadAllText((Join-Path $src 'index.html'), $utf8)
$peer = [IO.File]::ReadAllText((Join-Path (Join-Path $root 'vendor') 'peerjs.min.js'), $utf8)
if ($peer -match '</script') { throw 'vendor/peerjs.min.js enthält </script> – kann nicht eingebettet werden.' }

# PeerJS zuletzt einsetzen, damit seine Inhalte nie als Platzhalter gelesen werden
$out = $html.Replace('/*@@CSS@@*/', $css).Replace('/*@@JS@@*/', $js).Replace('/*@@PEERJS@@*/', $peer)
[IO.File]::WriteAllText((Join-Path $root 'gamedle.html'), $out, $utf8)

# Dieselbe Datei als docs/index.html – GitHub Pages veröffentlicht den Ordner /docs
$site = Join-Path $root 'docs'
New-Item -ItemType Directory -Force $site | Out-Null
[IO.File]::WriteAllText((Join-Path $site 'index.html'), $out, $utf8)
[IO.File]::WriteAllText((Join-Path $site '.nojekyll'), '', $utf8) # Datei unverändert ausliefern
Write-Output ("gamedle.html gebaut ({0:N0} KB) – auch als docs/index.html" -f ((Get-Item (Join-Path $root 'gamedle.html')).Length / 1KB))
