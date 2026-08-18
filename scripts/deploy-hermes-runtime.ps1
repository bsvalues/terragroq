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
#>
[CmdletBinding()]
param(
  [string]$Source,
  [string]$Runtime = "C:\HermesLab\williamos-runtime-64034e93-flat",
  [string]$TaskName = "WilliamOS Live",
  [int]$Port = 3100,
  [switch]$WithDependencies,
  [switch]$VerifyOnly
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

if ($VerifyOnly) {
  if (Test-Cockpit -Port $Port) { Write-Output "healthy: /sign-in answered 200 on port $Port"; exit 0 }
  Write-Error "unhealthy: /sign-in did not answer 200 on port $Port"
  exit 1
}

$standalone = Join-Path $Source ".next\standalone"
if (-not (Test-Path (Join-Path $standalone "server.js"))) {
  throw "No standalone build at $standalone. Run 'pnpm build' first."
}

# The runtime's .env.local is the one file here that cannot be rebuilt, and the standalone output
# ships a .env.local of its own -- the repository's. Copying the standalone tree wholesale therefore
# replaces the runtime's configuration with the developer's: a different DATABASE_URL, a different
# BETTER_AUTH_SECRET, and no device identity for the phone's mTLS. The application still answers 200
# on /sign-in while doing it, so nothing looks wrong. This is not hypothetical; it happened.
$envPath = Join-Path $Runtime ".env.local"
$envGuard = $null
if (Test-Path $envPath) { $envGuard = (Get-FileHash $envPath -Algorithm SHA256).Hash }

# Stop the supervised task AND anything still holding the port. Stop-ScheduledTask returns before the
# child process has exited, and a half-stopped server keeps its file handles, so the copy below would
# silently fail on exactly the files that matter.
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

# robocopy /MIR on .next, because stale route chunks from a previous build are still served: Next
# resolves them by name, and a file nobody overwrote is a file that still answers.
$null = robocopy (Join-Path $standalone ".next") (Join-Path $Runtime ".next") /MIR /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw "robocopy failed copying .next (exit $LASTEXITCODE)" }

foreach ($file in @("server.js", "package.json")) {
  Copy-Item (Join-Path $standalone $file) (Join-Path $Runtime $file) -Force
}

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
  Write-Error "Deployed, but the cockpit never answered on port $Port. The previous build is not automatically restored -- check the task's own log before retrying."
  exit 1
}

Write-Output "deployed and healthy: /sign-in answered 200 on port $Port"
