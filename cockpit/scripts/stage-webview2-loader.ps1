<#
.SYNOPSIS
  Stage the x64 WebView2Loader.dll shipped by the exact lockfile-pinned webview2-com-sys crate.

.DESCRIPTION
  GNU Windows executables need WebView2Loader.dll beside the application. Tauri validates bundle
  resources during its build script, including during cargo test, so the resource must exist before
  either command starts. This script discovers only webview2-com-sys 0.38.2 (the Cargo.lock version),
  refuses differing candidate bytes, and places the x64 DLL at the path declared by tauri.conf.json.
#>
[CmdletBinding()]
param(
  [string]$CockpitRoot,
  [ValidateSet("release", "debug")][string]$TargetProfile = "release"
)

$ErrorActionPreference = "Stop"
if (-not $CockpitRoot) { $CockpitRoot = Split-Path -Parent $PSScriptRoot }

function Get-Sha256 {
  param([Parameter(Mandatory = $true)][string]$Path)
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "") }
    finally { $sha256.Dispose() }
  } finally {
    $stream.Dispose()
  }
}
$cargoHome = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $env:USERPROFILE ".cargo" }
$registrySource = Join-Path $cargoHome "registry\src"
if (-not (Test-Path -LiteralPath $registrySource -PathType Container)) {
  throw "Cargo registry source directory is missing: $registrySource. Run cargo fetch --locked first."
}

$candidates = @(Get-ChildItem -LiteralPath $registrySource -Directory |
  ForEach-Object { Join-Path $_.FullName "webview2-com-sys-0.38.2\x64\WebView2Loader.dll" } |
  Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
if ($candidates.Count -eq 0) {
  throw "The lockfile-pinned webview2-com-sys 0.38.2 x64 loader is absent. Run cargo fetch --locked first."
}

$hashes = @($candidates | ForEach-Object { Get-Sha256 -Path $_ } | Sort-Object -Unique)
if ($hashes.Count -ne 1) {
  throw "Multiple webview2-com-sys 0.38.2 loader candidates have different bytes; refusing an ambiguous native build."
}

$target = Join-Path $CockpitRoot "src-tauri\target\$TargetProfile\WebView2Loader.dll"
$null = New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force
Copy-Item -LiteralPath $candidates[0] -Destination $target -Force

$stagedHash = Get-Sha256 -Path $target
if ($stagedHash -ne $hashes[0]) { throw "Staged WebView2Loader.dll hash differs from its locked crate source" }
Write-Output "staged $TargetProfile WebView2Loader.dll sha256=$stagedHash"
