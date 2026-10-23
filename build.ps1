# Baut src/* zu einer einzigen, teilbaren Datei: tierly.html
# PeerJS (vendor/peerjs.min.js, MIT) wird mit eingebettet – die Datei braucht kein CDN.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$src = Join-Path $root 'src'
$utf8 = New-Object System.Text.UTF8Encoding($false)

$jsFiles = 'presets.js', 'core.js', 'wiki.js', 'net.js', 'migration.js', 'diag.js', 'app.js', 'undo.js', 'dnd.js', 'layout.js', 'rooms.js', 'reveal.js', 'stats.js', 'onboarding.js', 'modals.js', 'editors.js', 'export.js'
$js = "'use strict';`n" + (($jsFiles | ForEach-Object { [IO.File]::ReadAllText((Join-Path $src $_), $utf8) }) -join "`n")
$css = [IO.File]::ReadAllText((Join-Path $src 'styles.css'), $utf8)
$html = [IO.File]::ReadAllText((Join-Path $src 'index.html'), $utf8)
$peer = [IO.File]::ReadAllText((Join-Path $root 'vendor\peerjs.min.js'), $utf8)
if ($peer -match '</script') { throw 'vendor/peerjs.min.js enthält </script> – kann nicht eingebettet werden.' }

# PeerJS zuletzt einsetzen, damit seine Inhalte nie als Platzhalter gelesen werden
$out = $html.Replace('/*@@CSS@@*/', $css).Replace('/*@@JS@@*/', $js).Replace('/*@@PEERJS@@*/', $peer)
[IO.File]::WriteAllText((Join-Path $root 'tierly.html'), $out, $utf8)

# Dieselbe Datei als docs/index.html – GitHub Pages veröffentlicht den Ordner /docs
$site = Join-Path $root 'docs'
New-Item -ItemType Directory -Force $site | Out-Null
[IO.File]::WriteAllText((Join-Path $site 'index.html'), $out, $utf8)
[IO.File]::WriteAllText((Join-Path $site '.nojekyll'), '', $utf8) # Datei unverändert ausliefern
Write-Output ("tierly.html gebaut ({0:N0} KB) – auch als docs/index.html" -f ((Get-Item (Join-Path $root 'tierly.html')).Length / 1KB))
