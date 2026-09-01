<#
.SYNOPSIS
  Run one WilliamOS Cockpit native action under the pinned GNU build environment.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet("test", "dev", "build")][string]$Action,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$NativeArguments
)

$ErrorActionPreference = "Stop"
$cockpitRoot = Split-Path -Parent $PSScriptRoot
$mingwBin = "C:\msys64\mingw64\bin"
if (-not (Test-Path -LiteralPath (Join-Path $mingwBin "dlltool.exe") -PathType Leaf)) {
  throw "The pinned GNU native build requires $mingwBin\dlltool.exe"
}

# Rust invokes dlltool while compiling Windows import libraries, before this package's build.rs can
# run. The PATH therefore belongs at the command boundary, inherited by cargo and every dependency.
$env:PATH = "$mingwBin;$env:PATH"

$manifest = Join-Path $cockpitRoot "src-tauri\Cargo.toml"
# Staging reads the exact loader from Cargo's lockfile-pinned registry source. A fresh checkout has no
# registry source yet, so populate it before staging instead of requiring an undocumented manual
# prerequisite. `--locked` makes the fetch fail rather than resolve a different crate graph.
& cargo fetch --manifest-path $manifest --locked
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "stage-webview2-loader.ps1") -CockpitRoot $cockpitRoot
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($Action -eq "test") {
  & cargo test --manifest-path $manifest --locked @NativeArguments
} else {
  if ($Action -eq "build" -and (-not $NativeArguments -or $NativeArguments.Count -eq 0)) {
    $NativeArguments = @("--bundles", "msi,nsis")
  }
  & pnpm exec tauri $Action @NativeArguments
}
exit $LASTEXITCODE
