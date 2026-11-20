# DEV ONLY: local development helper. Not shipped in the npm package.
# For a real install use DSH Plugins > Add plugin (plugin_manager install_bundle),
# which performs dependency, bundle, compatibility and build-approval steps.
#
# Install dsh-topic-split into a DSH profile (idempotent).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1 -Profile web
#
param(
  [string]$Profile = 'web'
)

$ErrorActionPreference = 'Stop'

$pkgRoot = Split-Path $PSScriptRoot -Parent
$pkgJson = Join-Path $pkgRoot 'package.json'
$helper = Join-Path $PSScriptRoot 'profile-manifest.mjs'
if (-not (Test-Path $pkgJson)) { throw "plugin package not found: $pkgJson" }
if (-not (Test-Path $helper)) { throw "manifest helper not found: $helper" }

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profileDir = Join-Path $dshHome "profiles\$Profile"
$manifest = Join-Path $profileDir 'package.json'
if (-not (Test-Path $manifest)) { throw "profile manifest not found: $manifest" }

$nodeModules = Join-Path $profileDir 'node_modules'
$link = Join-Path $nodeModules 'dsh-topic-split'
$backup = "$manifest.bak." + (Get-Date -Format 'yyyyMMdd-HHmmss')

Write-Host "[1/4] backup -> $backup"
Copy-Item $manifest $backup -Force

try {
  Write-Host "[2/4] link -> $link"
  if (-not (Test-Path $nodeModules)) { New-Item -ItemType Directory -Path $nodeModules -Force | Out-Null }
  if (Test-Path $link) {
    $item = Get-Item $link -Force
    if ($item.LinkType -eq 'Junction') {
      cmd /c rmdir "$link" | Out-Null
    } else {
      Remove-Item $link -Recurse -Force
    }
  }
  cmd /c mklink /J "$link" "$pkgRoot" | Out-Null
  if (-not (Test-Path $link)) { throw 'junction creation failed' }

  Write-Host "[3/4] register in package.json"
  & node $helper add $manifest $pkgRoot
  if ($LASTEXITCODE -ne 0) { throw 'register failed' }
  & node $helper check $manifest | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'self-check failed: registration incomplete' }

  Write-Host "[4/4] done"
  Write-Host ""
  Write-Host "Restart dsh web to activate."
  Write-Host "Uninstall: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/uninstall.ps1 -Profile $Profile"
}
catch {
  Write-Warning "install failed: $_"
  Write-Host "rolling back manifest..."
  Copy-Item $backup $manifest -Force
  if (Test-Path $link) { cmd /c rmdir "$link" 2>$null }
  throw
}
