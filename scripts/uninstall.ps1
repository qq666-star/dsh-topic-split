# DEV ONLY: local development helper. Not shipped in the npm package.
# For a real uninstall use DSH Plugins > Remove.
#
# Uninstall dsh-topic-split from a DSH profile (idempotent).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/uninstall.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/uninstall.ps1 -Profile web
#
param(
  [string]$Profile = 'web'
)

$ErrorActionPreference = 'Stop'

$helper = Join-Path $PSScriptRoot 'profile-manifest.mjs'
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profileDir = Join-Path $dshHome "profiles\$Profile"
$manifest = Join-Path $profileDir 'package.json'
if (-not (Test-Path $manifest)) { throw "profile manifest not found: $manifest" }

$backup = "$manifest.bak." + (Get-Date -Format 'yyyyMMdd-HHmmss')
Copy-Item $manifest $backup -Force
Write-Host "[1/3] backup -> $backup"

$link = Join-Path $profileDir 'node_modules\dsh-topic-split'
Write-Host "[2/3] remove link -> $link"
if (Test-Path $link) {
  $item = Get-Item $link -Force
  if ($item.LinkType -eq 'Junction') {
    cmd /c rmdir "$link" | Out-Null
  } else {
    Remove-Item $link -Recurse -Force
  }
} else {
  Write-Host "  link not present, skip"
}

Write-Host "[3/3] remove registration from package.json"
& node $helper remove $manifest
if ($LASTEXITCODE -ne 0) { throw 'remove failed' }

Write-Host ""
Write-Host "Done. Restart dsh web; the plugin will no longer load."
Write-Host "Rollback: Copy-Item '$backup' '$manifest' -Force"
