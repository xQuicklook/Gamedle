# Erzeugt das Vorschaubild für Link-Vorschauen (WhatsApp, Discord …): assets/og.png (1200×630)
# Ausführen: powershell -ExecutionPolicy Bypass -File tools/make-og.ps1
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path (Join-Path $root 'assets') 'og.png'
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null

$W = 1200; $H = 630
$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAliasGridFit'

# Hintergrund mit sanftem Verlauf
$rect = New-Object System.Drawing.Rectangle 0, 0, $W, $H
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(255, 22, 20, 40)), ([System.Drawing.Color]::FromArgb(255, 13, 14, 18)), 35
$g.FillRectangle($bg, $rect)

function Fill-Round($g, $color, $x, $y, $w, $h, $r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc($x, $y, 2 * $r, 2 * $r, 180, 90); $p.AddArc($x + $w - 2 * $r, $y, 2 * $r, 2 * $r, 270, 90)
  $p.AddArc($x + $w - 2 * $r, $y + $h - 2 * $r, 2 * $r, 2 * $r, 0, 90); $p.AddArc($x, $y + $h - 2 * $r, 2 * $r, 2 * $r, 90, 90)
  $p.CloseFigure()
  $b = New-Object System.Drawing.SolidBrush $color
  $g.FillPath($b, $p)
}

# Raster wie ein geteiltes Ergebnis (rechts)
$green = [System.Drawing.Color]::FromArgb(255, 47, 191, 113)
$yellow = [System.Drawing.Color]::FromArgb(255, 231, 169, 59)
$red = [System.Drawing.Color]::FromArgb(255, 229, 72, 77)
$rows = @(
  @($red, $red, $yellow, $red, $red, $green),
  @($yellow, $green, $red, $yellow, $green, $red),
  @($green, $green, $yellow, $green, $green, $yellow),
  @($green, $green, $green, $green, $green, $green)
)
$size = 62; $gap = 12; $x0 = 760; $y0 = 150
for ($r = 0; $r -lt $rows.Count; $r++) {
  for ($c = 0; $c -lt 6; $c++) {
    Fill-Round $g $rows[$r][$c] ($x0 + $c * ($size + $gap)) ($y0 + $r * ($size + $gap)) $size $size 12
  }
}

# Logo (vier Felder) und Text links
Fill-Round $g $green 80 120 40 40 9
Fill-Round $g $yellow 128 120 40 40 9
Fill-Round $g $red 80 168 40 40 9
Fill-Round $g $green 128 168 40 40 9

$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 236, 237, 241))
$muted = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 160, 166, 180))
$accent = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 165, 148, 255))
$g.DrawString('Gamedar', (New-Object System.Drawing.Font 'Segoe UI', 96, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)), $white, 70, 236)
$g.DrawString('Errate jeden Tag ein Videospiel', (New-Object System.Drawing.Font 'Segoe UI', 38, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)), $muted, 78, 362)
$g.DrawString('+ Duelle & Tier-Listen mit Freunden', (New-Object System.Drawing.Font 'Segoe UI', 34, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)), $accent, 78, 420)
$g.DrawString('xquicklook.github.io/Gamedle', (New-Object System.Drawing.Font 'Segoe UI', 26, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)), $muted, 78, 540)

$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "Vorschaubild gespeichert: $out ($([math]::Round((Get-Item $out).Length / 1KB)) KB)"
