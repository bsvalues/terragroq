<#
  deploy-resident-candidate.ps1 — the missing actuator (RESIDENT_RUNTIME_DEPLOYMENT_PATH_MISSING).

  The resident supervisor runs cli.mjs from a fixed workspace and does NOT self-update. The
  williamos-live / continuation start scripts rigorously PROVE the workspace is a git work tree at
  the expected commit and refuse on drift, but nothing ever fetches a candidate SHA INTO that
  workspace. So a published candidate could never reach the resident runtime. This is that fetch,
  governed: it places an EXACT SHA into the supervisor workspace and proves it, or refuses.

  It does NOT start or register the supervisor and it does NOT touch W1 truth or the queue. It only
  makes the resident workspace be exactly $Sha. Registering/starting the supervisor under the trusted
  campaign context (install-supervisor.ps1) and letting the loop run autonomously is the separate
  runtime_control step that follows.

  Run from a control node with git access to the remote and the right to write the workspace. This
  is a one-time governed bootstrap: WilliamOS cannot yet upgrade its own orchestrator, so an external
  runtime_control actor performs the code placement; from there execution is autonomous.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Sha,
  [string]$Workspace = "C:\Users\bsval\william-os-devops",
  [string]$Remote = "git@github.com:bsvalues/terragroq.git"
)

$ErrorActionPreference = "Stop"

function Fail([string]$code, [string]$detail) {
  Write-Error "DEPLOY_REFUSED $code : $detail"
  exit 1
}

if ($Sha -notmatch '^[0-9a-f]{40}$') {
  Fail "SHA_NOT_FULL" "Deploy requires a full 40-char commit SHA, got '$Sha'. No branch tips, no abbreviations."
}

# 1. Ensure the workspace is a git work tree of the intended repository.
$gitDir = Join-Path $Workspace ".git"
if (-not (Test-Path $Workspace) -or -not (Test-Path $gitDir)) {
  Write-Output "CLONE: $Remote -> $Workspace"
  git clone $Remote $Workspace
  if ($LASTEXITCODE -ne 0) { Fail "CLONE_FAILED" "git clone $Remote into $Workspace failed." }
}

$origin = (git -C $Workspace remote get-url origin 2>$null)
if (-not $origin) { Fail "NO_ORIGIN" "$Workspace has no origin remote." }

# 2. Fetch and check out the EXACT SHA, detached. Never a branch tip.
git -C $Workspace fetch origin $Sha 2>&1 | Select-Object -Last 2
if ($LASTEXITCODE -ne 0) {
  # Fall back to fetching the branch, then the commit must be reachable.
  git -C $Workspace fetch origin 2>&1 | Select-Object -Last 2
}
git -C $Workspace cat-file -e "$Sha^{commit}" 2>$null
if ($LASTEXITCODE -ne 0) { Fail "SHA_UNREACHABLE" "Commit $Sha is not reachable in $Workspace after fetch." }

git -C $Workspace checkout --detach $Sha 2>&1 | Select-Object -Last 1
if ($LASTEXITCODE -ne 0) { Fail "CHECKOUT_FAILED" "git checkout --detach $Sha failed in $Workspace." }

# 3. PROVE the deployed SHA. This is the guarantee VERIFY step 2 (resident executor is exactly $Sha)
#    is built on.
$head = (git -C $Workspace rev-parse HEAD 2>$null)
if ($head -ne $Sha) { Fail "SHA_DRIFT" "Deployed HEAD is '$head', expected '$Sha'." }

$dirty = (git -C $Workspace status --porcelain 2>$null)
if ($dirty) { Fail "WORKSPACE_DIRTY" "Workspace has uncommitted changes; refusing to deploy an unclean candidate." }

# 4. The seam that makes the resident executor projection-aware must actually be present at this SHA.
$seam = Join-Path $Workspace "scripts\hermes-bridge\dependency-execution-seam.mjs"
if (-not (Test-Path $seam)) { Fail "SEAM_ABSENT" "The graph->runtime seam is not present at $Sha; this candidate cannot run projections." }

# 5. Dependencies. Frozen lockfile so the deployed runtime matches the candidate exactly.
Write-Output "INSTALL: pnpm install --frozen-lockfile"
Push-Location $Workspace
try {
  pnpm install --frozen-lockfile 2>&1 | Select-Object -Last 3
  if ($LASTEXITCODE -ne 0) { Fail "DEPS_FAILED" "pnpm install --frozen-lockfile failed in $Workspace." }
} finally {
  Pop-Location
}

Write-Output "DEPLOYED_OK: workspace $Workspace is exactly $Sha (seam present, deps installed)."
Write-Output "NEXT: register/start the supervisor under its trusted campaign context (install-supervisor.ps1); then the loop runs #25 autonomously."
