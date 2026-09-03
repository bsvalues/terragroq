<#
.SYNOPSIS
  Run one WilliamOS Cockpit native action under the pinned GNU build environment.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet("stage", "test", "dev", "build")][string]$Action,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$NativeArguments
)

$ErrorActionPreference = "Stop"
$cockpitRoot = Split-Path -Parent $PSScriptRoot
$pinnedToolchain = "1.88.0-x86_64-pc-windows-gnu"

# rust-toolchain.toml intentionally contains only the valid version channel. The host tuple is an
# installed toolchain selection, not valid TOML channel syntax, so activate it explicitly at this
# command boundary and let Tauri's child cargo processes inherit the exact same compiler.
$rustup = Get-Command rustup.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $rustup -or -not $rustup.Source) {
  throw "The pinned Cockpit native build requires rustup.exe."
}
& $rustup.Source toolchain install $pinnedToolchain --profile minimal
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$env:RUSTUP_TOOLCHAIN = $pinnedToolchain
$rustcIdentity = (& rustc -vV) -join "`n"
if ($LASTEXITCODE -ne 0 -or $rustcIdentity -notmatch "(?m)^host: x86_64-pc-windows-gnu$") {
  throw "The active Rust compiler is not the pinned x86_64-pc-windows-gnu host toolchain."
}

# The County package is built both on workstation installations that use MSYS2's conventional path
# and on GitHub's Windows image, where the same x64 MinGW tools are exposed from C:\mingw64\bin.
# Accept an explicit source-pinned override first, then the two known layouts, then the current PATH.
$mingwCandidates = [System.Collections.Generic.List[string]]::new()
if ($env:WILLIAMOS_MINGW_BIN) {
  $mingwCandidates.Add($env:WILLIAMOS_MINGW_BIN.Trim())
}
$mingwCandidates.Add("C:\msys64\mingw64\bin")
$mingwCandidates.Add("C:\mingw64\bin")
$discoveredDlltool = Get-Command dlltool.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if ($discoveredDlltool -and $discoveredDlltool.Source) {
  $mingwCandidates.Add((Split-Path -Parent $discoveredDlltool.Source))
}

$mingwBin = $null
foreach ($candidate in $mingwCandidates) {
  $hasDlltool = $candidate -and (Test-Path -LiteralPath (Join-Path $candidate "dlltool.exe") -PathType Leaf)
  $hasCompiler = $candidate -and (Test-Path -LiteralPath (Join-Path $candidate "gcc.exe") -PathType Leaf)
  if ($hasDlltool -and $hasCompiler) {
    $mingwBin = (Resolve-Path -LiteralPath $candidate).Path
    break
  }
}
if (-not $mingwBin) {
  $checked = ($mingwCandidates | Where-Object { $_ } | Select-Object -Unique) -join ", "
  throw "The pinned GNU native build requires x64 MinGW gcc.exe and dlltool.exe. Checked: $checked"
}

# Rust invokes the MinGW linker and dlltool while compiling Windows binaries, before this package's
# build.rs can run. PATH therefore belongs at the command boundary, inherited by cargo and every
# dependency.
$env:PATH = "$mingwBin;$env:PATH"

$manifest = Join-Path $cockpitRoot "src-tauri\Cargo.toml"
# Staging reads the exact loader from Cargo's lockfile-pinned registry source. A fresh checkout has no
# registry source yet, so populate it before staging instead of requiring an undocumented manual
# prerequisite. `--locked` makes the fetch fail rather than resolve a different crate graph.
& cargo fetch --manifest-path $manifest --locked
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$targetProfiles = if ($Action -eq "dev") { @("release", "debug") } else { @("release") }
foreach ($targetProfile in $targetProfiles) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "stage-webview2-loader.ps1") -CockpitRoot $cockpitRoot -TargetProfile $targetProfile
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if ($Action -eq "stage") { exit 0 }

if ($Action -eq "test") {
  & cargo test --manifest-path $manifest --locked @NativeArguments
} else {
  $deploymentProfile = if ($env:WILLIAMOS_COCKPIT_PROFILE) {
    $env:WILLIAMOS_COCKPIT_PROFILE.Trim()
  } else {
    "hermes-anchor"
  }
  if ($deploymentProfile -notin @("hermes-anchor", "county-development")) {
    throw "Unsupported WILLIAMOS_COCKPIT_PROFILE: $deploymentProfile"
  }

  if ($Action -eq "build" -and (-not $NativeArguments -or $NativeArguments.Count -eq 0)) {
    $NativeArguments = if ($deploymentProfile -eq "county-development") {
      @("--bundles", "nsis")
    } else {
      @("--bundles", "msi,nsis")
    }
  }

  if ($deploymentProfile -eq "county-development") {
    $countyConfig = Join-Path $cockpitRoot "src-tauri\tauri.county-development.conf.json"
    if (-not (Test-Path -LiteralPath $countyConfig -PathType Leaf)) {
      throw "County Development Tauri config is missing: $countyConfig"
    }
    $NativeArguments = @("--config", $countyConfig) + @($NativeArguments)
  }

  & pnpm exec tauri $Action @NativeArguments
}
exit $LASTEXITCODE
