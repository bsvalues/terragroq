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
  if ($candidate -and (Test-Path -LiteralPath (Join-Path $candidate "dlltool.exe") -PathType Leaf)) {
    $mingwBin = (Resolve-Path -LiteralPath $candidate).Path
    break
  }
}
if (-not $mingwBin) {
  $checked = ($mingwCandidates | Where-Object { $_ } | Select-Object -Unique) -join ", "
  throw "The pinned GNU native build requires an x64 MinGW dlltool.exe. Checked: $checked"
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
