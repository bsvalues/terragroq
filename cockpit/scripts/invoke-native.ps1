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

# tauri-winres compiles the native icon/version resource through embed-resource, which launches a
# bare "windres" from PATH on the GNU target. The MinGW directory selected above ships gcc and
# dlltool but not always windres (GitHub's Windows image splits the two), so resolve windres from
# the known MinGW layouts independently and add its directory to PATH for cargo and every build
# script. Fail fast with the exact missing tool instead of the embed-resource NotAttempted panic.
$windresCandidates = [System.Collections.Generic.List[string]]::new()
$windresCandidates.Add($mingwBin)
$windresCandidates.Add("C:\msys64\mingw64\bin")
$windresCandidates.Add("C:\mingw64\bin")
$discoveredWindres = Get-Command windres.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if ($discoveredWindres -and $discoveredWindres.Source) {
  $windresCandidates.Add((Split-Path -Parent $discoveredWindres.Source))
}
$windresBin = $null
foreach ($candidate in $windresCandidates | Where-Object { $_ } | Select-Object -Unique) {
  if (Test-Path -LiteralPath (Join-Path $candidate "windres.exe") -PathType Leaf) {
    $windresBin = (Resolve-Path -LiteralPath $candidate).Path
    break
  }
}
if (-not $windresBin) {
  $checkedWindres = ($windresCandidates | Where-Object { $_ } | Select-Object -Unique) -join ", "
  throw "The pinned GNU native build requires windres.exe for resource compilation. Checked: $checkedWindres"
}
if ($windresBin -ne $mingwBin) {
  $env:PATH = "$windresBin;$env:PATH"
}

# Ground-truth diagnostics for the embed-resource windres spawn failures on GitHub's Windows image:
# embed-resource launches a bare "windres" through std::process, which only succeeds when PATH
# search finds a runnable windres.exe. Report exactly what was resolved and whether each spawn
# surface can start it, then continue — the cargo build below carries the final verdict.
Write-Host "WINDRES_DIAG resolved=$windresBin mingw=$mingwBin"
where.exe windres 2>&1 | ForEach-Object { Write-Host "WINDRES_DIAG where: $_" }
try {
  $size = (Get-Item -LiteralPath (Join-Path $windresBin "windres.exe")).Length
  Write-Host "WINDRES_DIAG file-size: $size"
} catch {
  Write-Host "WINDRES_DIAG file-size: MISSING $_"
}
foreach ($name in @("windres", "windres.exe")) {
  try {
    $probe = Start-Process -FilePath $name -ArgumentList "--version" -NoNewWindow -Wait -PassThru `
      -RedirectStandardOutput "$env:TEMP\windres-diag-out.txt" -RedirectStandardError "$env:TEMP\windres-diag-err.txt"
    $head = (Get-Content "$env:TEMP\windres-diag-out.txt" -TotalCount 1 -ErrorAction SilentlyContinue) -join ""
    Write-Host "WINDRES_DIAG ps-spawn $name exit=$($probe.ExitCode) head=$head"
  } catch {
    Write-Host "WINDRES_DIAG ps-spawn $name failed: $_"
  }
}
Set-Content -LiteralPath "$env:TEMP\windres-diag-spawn.rs" -Value @'
use std::process::{Command, Stdio};
fn main() {
    for name in ["windres", "windres.exe"] {
        let r = Command::new(name)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map(|mut c| c.kill());
        match r {
            Ok(()) => println!("WINDRES_DIAG rust-spawn-ok {name}"),
            Err(e) => println!("WINDRES_DIAG rust-spawn-fail {name}: {e} os={:?}", e.raw_os_error()),
        }
    }
}
'@
& rustc "$env:TEMP\windres-diag-spawn.rs" -o "$env:TEMP\windres-diag-spawn.exe" 2>$null
if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath "$env:TEMP\windres-diag-spawn.exe" -PathType Leaf)) {
  & "$env:TEMP\windres-diag-spawn.exe"
} else {
  Write-Host "WINDRES_DIAG rust-spawn: compile failed ($LASTEXITCODE)"
}

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
