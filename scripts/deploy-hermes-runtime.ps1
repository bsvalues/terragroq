<#
.SYNOPSIS
  Deploy the built cockpit to the HERMES runtime, and prove it came back up.

.DESCRIPTION
  This used to be done by hand, and doing it by hand is how the HTTPS proxy and the application were
  deployed from different commits -- which broke sign-in from the owner's phone with no error anyone
  could see. The steps are not complicated; they just have to be the same steps every time, and the
  last one has to be a check rather than an assumption.

  The runtime directory is FLAT: pnpm's symlinked node_modules was resolved into real directories when
  it was first built, because copying symlink farms across Windows hosts does not survive. So the
  dependency tree is left alone unless -WithDependencies is passed. Copying the standalone tree over
  it fails loudly on every package, having already half-applied itself.

  What actually changes between deploys is the compiled application: .next, server.js and the static
  assets. That is what this copies.

.PARAMETER WithDependencies
  Also replace node_modules. Needed only when the lockfile changed; expect it to be slow.

.PARAMETER VerifyOnly
  Run the health checks against whatever is currently deployed and change nothing.

.PARAMETER SkipRollbackCapture
  Skip copying the outgoing build aside. Only for a deploy onto an empty runtime, where there is
  nothing to preserve.
#>
[CmdletBinding()]
param(
  [string]$Source,
  [string]$Runtime = "C:\HermesLab\williamos-runtime-64034e93-flat",
  [string]$TaskName = "WilliamOS Live",
  [string]$HttpsTaskName = "WilliamOS HTTPS",
  [string]$LiveStartTarget = "C:\ProgramData\WilliamOS\start-williamos-live.ps1",
  [int]$Port = 3100,
  [int]$HttpsPort = 3443,
  [switch]$WithDependencies,
  [switch]$VerifyOnly,
  [switch]$SkipRollbackCapture
)

$ErrorActionPreference = "Stop"

# Resolved here rather than as a parameter default: $PSScriptRoot is not populated during parameter
# binding, so the default silently became an empty path.
if (-not $Source) { $Source = Split-Path -Parent $PSScriptRoot }

function Test-Cockpit {
  param([int]$Port, [int]$TimeoutSeconds = 90)
  # Polling rather than sleeping a fixed amount: a cold start is not a fixed cost, and "we waited long
  # enough" is the assumption this function exists to replace.
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/sign-in" -UseBasicParsing -TimeoutSec 10
      if ($response.StatusCode -eq 200) { return $true }
    } catch {
      Start-Sleep -Seconds 3
    }
  }
  return $false
}

# The SHA this artifact was built FROM, read from the standalone bundle being shipped. "development"
# (the committed placeholder) or "unknown" means the build never stamped a real commit -- treated as
# UNPROVEN, never a match. See scripts/write-build-provenance.mjs and the #762 deploy doctrine.
function Get-BuiltSha {
  param([string]$StandaloneRoot)
  $file = Join-Path $StandaloneRoot "lib\generated\build-provenance.json"
  if (-not (Test-Path $file)) { return $null }
  try { return (Get-Content $file -Raw | ConvertFrom-Json).sha } catch { return $null }
}

# The SHA the RUNNING instance reports at /api/health. Liveness (a 200 on /sign-in) is not provenance;
# this is what proves the process is serving the artifact we just built, not a stale one.
function Get-RunningSha {
  param([int]$Port, [int]$TimeoutSeconds = 60)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $health = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 10
      $sha = ($health.Content | ConvertFrom-Json).build.sha
      if ($sha) { return $sha }
      # 200 but no build.sha (an older artifact predating provenance): wait before retrying so this
      # does not hammer /api/health and its database probe in a tight loop for the whole timeout.
      Start-Sleep -Seconds 3
    } catch {
      Start-Sleep -Seconds 3
    }
  }
  return $null
}

function Test-HttpsCockpit {
  param([int]$Port, [int]$TimeoutSeconds = 60)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri "https://192.168.88.9:$Port/api/health" -UseBasicParsing -TimeoutSec 10
      if ($response.StatusCode -eq 200) { return $true }
    } catch {
      Start-Sleep -Seconds 3
    }
  }
  return $false
}

function Stop-ExpectedListener {
  param([int]$ListenerPort, [string]$ExpectedCommandFragment)
  Get-NetTCPConnection -LocalPort $ListenerPort -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)"
      if (-not $process -or $process.CommandLine -notlike "*$ExpectedCommandFragment*") {
        throw "Port $ListenerPort is owned by an unrelated process; refusing to stop it during WilliamOS deploy"
      }
      Stop-Process -Id $process.ProcessId -Force
    }
}

if ($VerifyOnly) {
  if (-not (Test-Cockpit -Port $Port)) {
    Write-Error "unhealthy: /sign-in did not answer 200 on port $Port"
    exit 1
  }
  if (-not (Test-HttpsCockpit -Port $HttpsPort)) {
    Write-Error "unhealthy: the canonical HTTPS origin did not answer on port $HttpsPort"
    exit 1
  }
  $runningSha = Get-RunningSha -Port $Port
  $looseSha = Get-BuiltSha -StandaloneRoot $Runtime
  if (-not $runningSha -or $runningSha -ne $looseSha) {
    Write-Error "provenance mismatch: running '$runningSha', loose runtime '$looseSha'"
    exit 1
  }
  Write-Output "healthy: HTTP $Port and HTTPS $HttpsPort answer; running and loose provenance agree at $runningSha"
  exit 0
}

$standalone = Join-Path $Source ".next\standalone"
if (-not (Test-Path (Join-Path $standalone "server.js"))) {
  throw "No standalone build at $standalone. Run 'pnpm build' first."
}

# The restore command is operator-facing, executable rollback evidence. Values must be serialized as
# PowerShell data, not interpolated into double-quoted source where `$` and backticks are evaluated.
# Single-quoted literals preserve every Windows path metacharacter; apostrophes double inside them.
function ConvertTo-PowerShellLiteral {
  param([string]$Value)
  if ($Value -match "[`r`n`0]") { throw "Cannot render a multiline or NUL-containing rollback argument" }
  return "'" + $Value.Replace("'", "''") + "'"
}
$liveStartSource = Join-Path $Source "deploy\hermes\williamos-live\start-williamos-live.ps1"
if (-not (Test-Path -LiteralPath $liveStartSource -PathType Leaf)) {
  throw "Missing repository-owned WilliamOS Live start script: $liveStartSource"
}
# `-SkipRollbackCapture` is for an empty installation. The task launcher lives outside `$Runtime`,
# so an empty runtime can still have an older hand-placed launcher. Overwriting that file without a
# manifest would make the flag silently destructive. Refuse before stopping either task or changing
# any bytes; a caller with an existing launcher must take the normal captured-rollback path.
if ($SkipRollbackCapture -and (Test-Path -LiteralPath $LiveStartTarget -PathType Leaf)) {
  throw "SkipRollbackCapture cannot overwrite the existing WilliamOS Live start definition at '$LiveStartTarget'. Run without -SkipRollbackCapture so the external launcher is captured and restorable."
}

# Fresh-build provenance (#762 deploy doctrine): the artifact must carry a real commit SHA. A
# placeholder/unknown SHA means the build never stamped HEAD -- refuse rather than ship an artifact we
# cannot tie to a commit. The equality against the running instance is checked after start, below.
$builtSha = Get-BuiltSha -StandaloneRoot $standalone
if (-not $builtSha -or $builtSha -eq "development" -or $builtSha -eq "unknown") {
  throw "The standalone at $standalone carries no real build SHA (got '$builtSha'). Rebuild with 'pnpm build' from a clean tree so provenance is stamped; a deploy that cannot prove its commit is not allowed."
}
if ($builtSha -like "*-dirty") {
  Write-Warning "The build SHA is $builtSha -- built over uncommitted changes. Proceeding, but the running commit will not exactly match any pushed commit."
}

# Provenance is about the CURRENT commit, not merely a self-consistent artifact. Comparing the built
# stamp only against the running instance compares the artifact to itself: build commit A, let the
# repo advance to B without rebuilding, and both the stamp and the running SHA still read A, so a
# stale build would pass. So independently resolve what HEAD *should* be and require the stamp to
# match it, here, before the copy (Codex P1).
$builtBase = $builtSha -replace '-dirty$', ''
$expectedSha = $null
try { $expectedSha = (& git -C $Source rev-parse HEAD 2>$null).Trim() } catch { $expectedSha = $null }
if ($expectedSha) {
  if ($builtBase -ne $expectedSha) {
    throw "STALE BUILD: the standalone was built from $builtSha but $Source is now at $expectedSha. Rebuild from HEAD ('pnpm build') before deploying -- a deploy must serve the current commit, not a self-consistent old one."
  }
} else {
  Write-Warning "Could not resolve HEAD in $Source to independently verify the build commit; proceeding on the artifact stamp and the running-instance check alone."
}

# The runtime's .env.local is the one file here that cannot be rebuilt, and the standalone output
# ships a .env.local of its own -- the repository's. Copying the standalone tree wholesale therefore
# replaces the runtime's configuration with the developer's: a different DATABASE_URL, a different
# BETTER_AUTH_SECRET, and no device identity for the phone's mTLS. The application still answers 200
# on /sign-in while doing it, so nothing looks wrong. This is not hypothetical; it happened.
$envPath = Join-Path $Runtime ".env.local"
$envGuard = $null
if (Test-Path $envPath) { $envGuard = (Get-FileHash $envPath -Algorithm SHA256).Hash }

# ROLLBACK CAPTURE, before anything is overwritten. `robocopy /MIR` below is destructive and this
# script used to say, accurately, that "the previous build is not automatically restored" -- which
# left the only recovery from a bad deploy as "rebuild the previous commit", requiring the previous
# commit to still be known and buildable. The three things the deploy replaces are copied aside
# first, so recovery is a copy back.
#
# Deliberately NOT node_modules or .env.local: neither is touched unless -WithDependencies is passed,
# and .env.local is guarded by hash below.
if (-not $SkipRollbackCapture) {
  $rollbackRoot = "$Runtime.rollback-$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))"
  $null = New-Item -ItemType Directory -Path $rollbackRoot -Force
  $rollbackFiles = @("server.js", "package.json", "lib\generated\build-provenance.json", "scripts\hermes-https-proxy.mjs")
  $liveStartBackup = "external\start-williamos-live.ps1"
  $liveStartWasPresent = Test-Path -LiteralPath $LiveStartTarget -PathType Leaf
  $rollbackManifest = [ordered]@{
    version = 2
    nextPresent = (Test-Path -LiteralPath (Join-Path $Runtime ".next") -PathType Container)
    files = @()
    liveStart = [ordered]@{ target = $LiveStartTarget; backupPath = $liveStartBackup; wasPresent = $liveStartWasPresent }
  }
  if ($rollbackManifest.nextPresent) {
    $null = robocopy (Join-Path $Runtime ".next") (Join-Path $rollbackRoot ".next") /MIR /NFL /NDL /NJH /NJS /NP
    if ($LASTEXITCODE -ge 8) { throw "rollback capture failed copying .next (exit $LASTEXITCODE)" }
  }
  foreach ($file in $rollbackFiles) {
    $existing = Join-Path $Runtime $file
    $wasPresent = Test-Path -LiteralPath $existing -PathType Leaf
    $rollbackManifest.files += [ordered]@{ path = $file; wasPresent = $wasPresent }
    if ($wasPresent) {
      $rollbackFile = Join-Path $rollbackRoot $file
      $null = New-Item -ItemType Directory -Path (Split-Path -Parent $rollbackFile) -Force
      Copy-Item -LiteralPath $existing -Destination $rollbackFile -Force
    }
  }
  if ($liveStartWasPresent) {
    $liveStartRollbackFile = Join-Path $rollbackRoot $liveStartBackup
    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $liveStartRollbackFile) -Force
    Copy-Item -LiteralPath $LiveStartTarget -Destination $liveStartRollbackFile -Force
  }
  $rollbackManifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $rollbackRoot "rollback-manifest.json") -Encoding utf8
  # Recorded rather than assumed: a rollback directory nobody can name is not a rollback.
  Write-Output "rollback captured: $rollbackRoot"
  $restoreScriptLiteral = ConvertTo-PowerShellLiteral (Join-Path $Source "scripts\restore-hermes-runtime.ps1")
  $rollbackRootLiteral = ConvertTo-PowerShellLiteral $rollbackRoot
  $runtimeLiteral = ConvertTo-PowerShellLiteral $Runtime
  $taskNameLiteral = ConvertTo-PowerShellLiteral $TaskName
  $httpsTaskNameLiteral = ConvertTo-PowerShellLiteral $HttpsTaskName
  $liveStartTargetLiteral = ConvertTo-PowerShellLiteral $LiveStartTarget
  Write-Output "to restore: powershell -NoProfile -ExecutionPolicy Bypass -File $restoreScriptLiteral -RollbackRoot $rollbackRootLiteral -Runtime $runtimeLiteral -TaskName $taskNameLiteral -HttpsTaskName $httpsTaskNameLiteral -LiveStartTarget $liveStartTargetLiteral"
}

# Stop the supervised task AND anything still holding the port. Stop-ScheduledTask returns before the
# child process has exited, and a half-stopped server keeps its file handles, so the copy below would
# silently fail on exactly the files that matter.
Stop-ScheduledTask -TaskName $HttpsTaskName -ErrorAction SilentlyContinue
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Stop-ExpectedListener -ListenerPort $Port -ExpectedCommandFragment "server.js"
Stop-ExpectedListener -ListenerPort $HttpsPort -ExpectedCommandFragment "hermes-https-proxy.mjs"
Start-Sleep -Seconds 2

# The task action points at ProgramData, so deploying only the bundle leaves boot semantics on an
# older hand-placed generation. Install the repository-owned definition before restart; the exact
# displaced bytes are part of the rollback manifest above.
$null = New-Item -ItemType Directory -Path (Split-Path -Parent $LiveStartTarget) -Force
Copy-Item -LiteralPath $liveStartSource -Destination $LiveStartTarget -Force

# robocopy /MIR on .next, because stale route chunks from a previous build are still served: Next
# resolves them by name, and a file nobody overwrote is a file that still answers.
$null = robocopy (Join-Path $standalone ".next") (Join-Path $Runtime ".next") /MIR /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw "robocopy failed copying .next (exit $LASTEXITCODE)" }

foreach ($file in @("server.js", "package.json")) {
  Copy-Item (Join-Path $standalone $file) (Join-Path $Runtime $file) -Force
}

# Keep the loose runtime provenance record identical to the compiled health route. Operators and
# rollback tooling inspect this file directly; leaving an older copy beside a newer running bundle
# creates two contradictory answers for the same deployment.
$provenanceRelative = "lib\generated\build-provenance.json"
$provenanceSource = Join-Path $standalone $provenanceRelative
if (-not (Test-Path $provenanceSource)) { throw "Missing standalone build provenance: $provenanceSource" }
$provenanceTarget = Join-Path $Runtime $provenanceRelative
$null = New-Item -ItemType Directory -Path (Split-Path -Parent $provenanceTarget) -Force
Copy-Item $provenanceSource $provenanceTarget -Force

# The HTTPS proxy is part of the exact deployed product, not an independently hand-placed script.
$httpsProxyRelative = "scripts\hermes-https-proxy.mjs"
$httpsProxySource = Join-Path $Source $httpsProxyRelative
if (-not (Test-Path $httpsProxySource)) { throw "Missing HTTPS proxy in the source tree: $httpsProxySource" }
$httpsProxyTarget = Join-Path $Runtime $httpsProxyRelative
$null = New-Item -ItemType Directory -Path (Split-Path -Parent $httpsProxyTarget) -Force
Copy-Item $httpsProxySource $httpsProxyTarget -Force

# Static assets and public/ live outside the standalone tree by design.
$null = robocopy (Join-Path $Source ".next\static") (Join-Path $Runtime ".next\static") /MIR /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw "robocopy failed copying .next\static (exit $LASTEXITCODE)" }
if (Test-Path (Join-Path $Source "public")) {
  $null = robocopy (Join-Path $Source "public") (Join-Path $Runtime "public") /E /NFL /NDL /NJH /NJS /NP
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed copying public (exit $LASTEXITCODE)" }
}

if ($WithDependencies) {
  # /MIR would delete .env.local and anything else living beside it, so this targets node_modules only.
  $null = robocopy (Join-Path $standalone "node_modules") (Join-Path $Runtime "node_modules") /MIR /NFL /NDL /NJH /NJS /NP
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed copying node_modules (exit $LASTEXITCODE)" }
}

# Boot-time resolution tooling. The start script
# (deploy/hermes/williamos-live/start-williamos-live.ps1) resolves ATLAS's address before starting
# the server, and nothing in the standalone output can supply it: measured on this build, Next
# BUNDLES the `lib/fabric/*.mjs` modules into the route chunks rather than tracing them as files, so
# `.next/standalone/lib` contains only `generated/build-provenance.json`. The runtime's existing
# `lib\fabric\*.mjs` are leftovers from an older hand-placement, not something a deploy maintains.
#
# The whole directory is copied rather than the two files the resolver names today. Its import
# closure is registry -> run-baseline -> audit/broker/transport, and hand-listing that is a
# maintenance trap: a new import would not fail here, it would fail at BOOT, on the node, as a
# refusal to start.
$fabricSource = Join-Path $Source "lib\fabric"
$fabricTarget = Join-Path $Runtime "lib\fabric"
$null = New-Item -ItemType Directory -Path $fabricTarget -Force
$null = robocopy $fabricSource $fabricTarget "*.mjs" /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw "robocopy failed copying lib\fabric boot tooling (exit $LASTEXITCODE)" }

$resolverCli = "scripts\fabric\resolve-authority-registry-url.mjs"
$resolverSource = Join-Path $Source $resolverCli
if (-not (Test-Path $resolverSource)) { throw "Missing boot-time resolution tool in the source tree: $resolverSource" }
$resolverTarget = Join-Path $Runtime $resolverCli
$null = New-Item -ItemType Directory -Path (Split-Path -Parent $resolverTarget) -Force
Copy-Item $resolverSource $resolverTarget -Force

# Prove the boot path can actually resolve, here, while the previous build is still restorable --
# rather than finding out when the task starts and the cockpit refuses. `--redact` so the check
# exercises the real resolution and prints a connection string with the password masked.
#
# `$ErrorActionPreference` is dropped to Continue for the call, and stderr goes to a file rather than
# through `2>&1`. Windows PowerShell 5.1 wraps ANY native stderr output in a NativeCommandError, and
# under `Stop` that terminates the deploy -- the resolver writes its SUCCESS evidence to stderr, so
# with `Stop` in force this aborted the deploy every time while the resolution itself was fine. The
# exit code is the verdict.
$resolveDiagnostic = Join-Path $env:TEMP ("williamos-deploy-resolve-{0}.err" -f [guid]::NewGuid().ToString("N"))
$previousPreference = $ErrorActionPreference
try {
  $ErrorActionPreference = "Continue"
  $resolveCheck = & "C:\Program Files\nodejs\node.exe" $resolverTarget (Join-Path $Runtime ".env.local") --redact 2>$resolveDiagnostic
  $resolveExit = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousPreference
  $resolveDetail = if (Test-Path -LiteralPath $resolveDiagnostic) { (Get-Content -LiteralPath $resolveDiagnostic -Raw).Trim() } else { "" }
  Remove-Item -LiteralPath $resolveDiagnostic -Force -ErrorAction SilentlyContinue
}
if ($resolveExit -ne 0) {
  throw "The deployed boot tooling cannot resolve the authority registry's address, so the cockpit would refuse to start: $resolveDetail"
}
Write-Output "boot resolution verified: $resolveCheck"

if (-not (Test-Path (Join-Path $Runtime ".env.local"))) {
  throw "The runtime lost its .env.local. Restore it before starting: the cockpit cannot resolve the owner without WILLIAMOS_OWNER_EMAIL."
}

# Prove the configuration survived the copy rather than assuming it did.
if ($envGuard) {
  $envNow = if (Test-Path $envPath) { (Get-FileHash $envPath -Algorithm SHA256).Hash } else { $null }
  if ($envNow -ne $envGuard) {
    throw "The deploy modified $envPath. Nothing here should touch it; restore it from the runtime backup before starting, or the cockpit will come up pointed at the wrong database."
  }
}

Start-ScheduledTask -TaskName $TaskName

if (-not (Test-Cockpit -Port $Port)) {
  Write-Error "Deployed, but the cockpit never answered on port $Port. The outgoing build was captured above; check the task's own log, then restore it with the printed command before retrying."
  exit 1
}

# Provenance, not just liveness: the running process must report the exact commit we built and
# shipped. A mismatch means the task is serving a stale artifact (the failure this whole doctrine
# exists to catch) -- fail loudly rather than report a green deploy of old code.
$runningSha = Get-RunningSha -Port $Port
if (-not $runningSha) {
  Write-Error "Deployed and live, but /api/health did not report a build SHA on port $Port -- cannot prove the running artifact is the one just built. Treating as a failed deploy."
  exit 1
}
if ($runningSha -ne $builtSha) {
  Write-Error "STALE ARTIFACT: built $builtSha but the running instance reports $runningSha. The task is serving old code. Investigate the copy/restart before trusting this deploy."
  exit 1
}

$deployedLooseSha = Get-BuiltSha -StandaloneRoot $Runtime
if ($deployedLooseSha -ne $builtSha) {
  Write-Error "STALE LOOSE PROVENANCE: built and running $builtSha but $provenanceTarget reports $deployedLooseSha. The runtime is internally contradictory."
  exit 1
}

Start-ScheduledTask -TaskName $HttpsTaskName
if (-not (Test-HttpsCockpit -Port $HttpsPort)) {
  Write-Error "The application is live on loopback, but the supervised HTTPS product origin did not answer on port $HttpsPort. Treating the deploy as failed."
  exit 1
}

Write-Output "deployed and verified: running $runningSha, loose provenance agrees, HTTP $Port and HTTPS $HttpsPort healthy"
