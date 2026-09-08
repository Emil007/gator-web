# Serve the player from the repo root so /roms/ is available locally.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$port = 8765
if ($args.Count -ge 1) { $port = [int]$args[0] }

Write-Host "gator player  http://127.0.0.1:$port/player/"
Write-Host "ROMs (if present) served from /roms/ - never commit them."
Write-Host "Press Ctrl+C to stop."

python -m http.server $port
