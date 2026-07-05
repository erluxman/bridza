# Bridza terminal installer (Windows).
#   irm https://bridza.erluxman.dev/install.ps1 | iex
#
# Pulls the latest GitHub Release, downloads the NSIS installer for x64, and
# runs it. Per-user install (no admin needed).
$ErrorActionPreference = "Stop"
$Repo = "erluxman/bridza"

function Say($m) { Write-Host "▸ $m" -ForegroundColor Cyan }

Say "Querying the latest Bridza release…"
$rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ "User-Agent" = "bridza-install" }

$asset = $rel.assets | Where-Object { $_.name -match "win.*\.exe$" } | Select-Object -First 1
if (-not $asset) { throw "No Windows .exe asset found in the latest release ($($rel.tag_name))." }

$out = Join-Path $env:TEMP $asset.name
Say "Downloading $($asset.name)…"
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $out -UseBasicParsing

Say "Running the installer…"
# /S = silent NSIS install (per-user, as configured in electron-builder.yml).
Start-Process -FilePath $out -ArgumentList "/S" -Wait

Write-Host "✓ Bridza installed. Find it in the Start menu." -ForegroundColor Green
