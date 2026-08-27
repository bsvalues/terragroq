<#
.SYNOPSIS
  Run one resident continuation cycle from a PINNED, clean source revision, against a fabric-resolved
  authority database.

.DESCRIPTION
  THE OWNERSHIP POINT. The `WilliamOS Continuation` scheduled task was hand-made and ran

      cmd.exe /c node --no-warnings --env-file=<runtime>\.env.local scripts\runtime-operator\resident-kernel-cli.mjs

  with a working directory of `C:\Users\bs\terragroq-review`. Nothing in the repository described how
  the one autonomous runner on this node starts, which is the same defect #1021 closed for the
  cockpit. It is declared here now; the copy on the node is installed FROM this file.

  THE FIRST DEFECT IT CLOSES -- DEPLOYMENT DRIFT. That working directory is an ambient, mutable
  checkout. Measured on HERMES 2026-08-26: it sat on branch `wo/0030-owner-gate-policy` carrying
  uncommitted work, and its `scripts/runtime-operator/williamos-adapters.mjs` differed from
  `origin/main` by 406 insertions and 691 deletions. Its `linkGrant` required both a non-null
  `authorityGrantId` AND a same-namespace grant, where current main links a grant by scope -- so the
  runner reported an empty queue that main would not have reported. The autonomous cycle was
  executing code nobody reviewed and nobody could name. A cycle whose source is unknown produces
  evidence about nothing.

  So the source is a DEPLOYMENT FACT, passed in and proven: a git work tree, at the expected commit,
  clean. Any drift refuses the run rather than producing authoritative-looking output from
  unreviewed code.

  THE SECOND DEFECT -- THE STALE ADDRESS. `--env-file` handed the kernel `.env.local` verbatim, and
  that file still carries `192.168.88.5`. ATLAS's lease moved to `.8` on 2026-08-25, so every cycle
  since failed with `connect ETIMEDOUT` inside `loadWorkOrders`. The cockpit was given the fabric
  resolver for exactly this; the resident cycle never was. This is that caller.

  WHY NOT WRITE THE NEW ADDRESS HERE. Because that is the defect, not the repair -- correct the day
  it is typed and silently wrong at the next lease change, which is how this class has now recurred
  five times (`CONT-EXPV2-HARDCODED-ADDRESS-CLASS`). The host is resolved from canonical fabric state
  on every run, and only the host: role, password, port, database and query pass through
  byte-for-byte.

  NO FAIL-OPEN. Unresolvable authority, a dirty source, or a source at the wrong commit all refuse.
  A resident cycle that ran anyway would lease work, mint worktrees and dispatch a provider on a
  premise nobody established -- and the previous failure proves how long that goes unnoticed: 158 KB
  of an opaque token, every five minutes, for days.

  The resolved connection string is passed to the child in memory. It is never written to a file,
  never logged, and never echoed.
#>
[CmdletBinding()]
param(
  # The pinned source revision the cycle executes. No defaults: a default would reintroduce exactly
  # the ambient-checkout assumption this exists to remove.
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$ExpectedCommit,
  # Supplies the credential; only its host is replaced.
  [Parameter(Mandatory = $true)][string]$EnvFile,
  [string]$LogRoot = "C:\ProgramData\WilliamOS\logs",
  [string]$FabricRoot
)

$ErrorActionPreference = "Stop"

$node = "C:\Program Files\nodejs\node.exe"

New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
$bootLog = Join-Path $LogRoot "williamos-continuation.boot.log"

function Write-Boot {
  param([string]$Message)
  "$([DateTimeOffset]::UtcNow.ToString('o')) $Message" | Out-File -FilePath $bootLog -Append -Encoding utf8
}

function Deny-Cycle {
  param([string]$Code, [string]$Explanation)
  Write-Boot "CYCLE_REFUSED $Code"
  Write-Error "Refusing to run the resident cycle: $Explanation"
  exit 1
}

function Invoke-GitProbe {
  param([string]$Directory, [string[]]$GitArgs)
  # PowerShell 5.1 wraps ANY native stderr in a NativeCommandError, which under `Stop` terminates the
  # script even when the command succeeded. The exit code is the verdict.
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $output = & git -C $Directory @GitArgs 2>$null
    return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = ("$output").Trim() }
  } finally {
    $ErrorActionPreference = $previous
  }
}

# ---- the source is pinned, clean, and proven ---------------------------------------------------

if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
  Deny-Cycle "SOURCE_MISSING" "the pinned source '$Source' does not exist."
}
$resolvedSource = (Resolve-Path -LiteralPath $Source).ProviderPath.TrimEnd('\')

$topLevel = Invoke-GitProbe -Directory $resolvedSource -GitArgs @("rev-parse", "--show-toplevel")
if ($topLevel.ExitCode -ne 0 -or -not $topLevel.Output) {
  Deny-Cycle "SOURCE_NOT_A_REPOSITORY" "'$resolvedSource' is not a git work tree, so its revision cannot be proven."
}
if ((($topLevel.Output -replace '/', '\').TrimEnd('\')) -ine $resolvedSource) {
  Deny-Cycle "SOURCE_NOT_WORKTREE_ROOT" "'$resolvedSource' is not the root of its work tree."
}

$head = Invoke-GitProbe -Directory $resolvedSource -GitArgs @("rev-parse", "HEAD")
if ($head.ExitCode -ne 0 -or -not $head.Output) {
  Deny-Cycle "SOURCE_HEAD_UNREADABLE" "HEAD could not be read from '$resolvedSource'."
}
if ($head.Output -ine $ExpectedCommit) {
  Deny-Cycle "SOURCE_REVISION_DRIFT" "the pinned source is at $($head.Output) but $ExpectedCommit was expected. The resident cycle must never execute an unreviewed revision."
}

# Tracked modifications AND untracked files both count: a stray script under scripts/ changes what
# runs just as much as an edited one does.
$status = Invoke-GitProbe -Directory $resolvedSource -GitArgs @("status", "--porcelain")
if ($status.ExitCode -ne 0) {
  Deny-Cycle "SOURCE_STATUS_UNREADABLE" "the working tree state of '$resolvedSource' could not be read."
}
if ($status.Output) {
  $first = (($status.Output -split '\r?\n') | Select-Object -First 3) -join "; "
  Deny-Cycle "SOURCE_DIRTY" "the pinned source has uncommitted changes ($first). A cycle whose source is unknown produces evidence about nothing."
}

$cli = Join-Path $resolvedSource "scripts\runtime-operator\resident-kernel-cli.mjs"
if (-not (Test-Path -LiteralPath $cli)) {
  Deny-Cycle "SOURCE_MISSING_CLI" "'$cli' is missing from the pinned source."
}

Write-Boot "CYCLE_SOURCE_PINNED $resolvedSource@$ExpectedCommit"

# ---- the authority host is resolved, never written down ----------------------------------------

if (-not (Test-Path -LiteralPath $EnvFile)) {
  Deny-Cycle "ENV_FILE_MISSING" "'$EnvFile' is missing, so the authority credential cannot be read."
}
$resolver = Join-Path $resolvedSource "scripts\fabric\resolve-authority-registry-url.mjs"
if (-not (Test-Path -LiteralPath $resolver)) {
  Deny-Cycle "RESOLVER_MISSING" "'$resolver' is missing from the pinned source."
}

$resolverArgs = @($resolver, $EnvFile)
if ($FabricRoot) { $resolverArgs += "--fabric-root=$FabricRoot" }
$diagnosticFile = Join-Path $env:TEMP ("williamos-continuation-resolve-{0}.err" -f [guid]::NewGuid().ToString("N"))

# stdout carries the connection string into a variable -- never a file, never a log. stderr carries
# the resolver's redacted diagnostic, which IS recorded because it names the registry fingerprint the
# answer came from, and that is what makes a later cycle auditable.
$previousPreference = $ErrorActionPreference
try {
  $ErrorActionPreference = "Continue"
  $resolvedUrl = & $node @resolverArgs 2>$diagnosticFile
  $resolverExit = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousPreference
  $diagnostic = if (Test-Path -LiteralPath $diagnosticFile) { (Get-Content -LiteralPath $diagnosticFile -Raw).Trim() } else { "" }
  Remove-Item -LiteralPath $diagnosticFile -Force -ErrorAction SilentlyContinue
}

if ($resolverExit -ne 0 -or -not $resolvedUrl) {
  Deny-Cycle "AUTHORITY_HOST_UNRESOLVED" "the authority registry's address could not be resolved from fabric state (exit $resolverExit). $diagnostic"
}
if ($resolvedUrl -is [array]) { $resolvedUrl = ($resolvedUrl | Where-Object { $_ } | Select-Object -Last 1) }
$resolvedUrl = ([string]$resolvedUrl).Trim()
if ($resolvedUrl -notmatch '^postgres(ql)?://') {
  Deny-Cycle "RESOLVED_URL_UNUSABLE" "the resolver returned something that is not a postgres connection string."
}

Write-Boot "CYCLE_AUTHORITY_RESOLVED $diagnostic"

# ---- run exactly one cycle ----------------------------------------------------------------------

# Deliberately NOT --env-file: passing the file straight through is what let the stale address win.
# The credential comes from that file through the resolver, and only the resolved value reaches the
# child process.
$env:DATABASE_URL = $resolvedUrl
Set-Location -LiteralPath $resolvedSource
& $node --no-warnings $cli
$cycleExit = $LASTEXITCODE
Write-Boot "CYCLE_EXIT $cycleExit"
exit $cycleExit
