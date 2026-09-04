<#
.SYNOPSIS
  Start the WilliamOS cockpit on HERMES, with the authority registry's address resolved from the
  fabric registry rather than read out of a file.

.DESCRIPTION
  THE OWNERSHIP POINT. This script previously existed only as a hand-typed file at
  C:\ProgramData\WilliamOS\start-williamos-live.ps1. Nothing in the repository described how the one
  supervised service on this node starts, so nobody could see what it did without logging in and
  reading it -- the same defect #997 fixed for Ollama and #1008 fixed for the authority registry
  container. It is declared here now; the copy on the node is installed FROM this file.

  THE DEFECT IT CLOSES. `.env.local` carried
  `postgresql://williamos:***@192.168.88.5:15432/williamos`. ATLAS's DHCP lease moved to
  192.168.88.8 on 2026-08-25, so the deployed cockpit could not reach the lab's only authority
  oracle -- measured, not inferred: connecting with that exact file gives ECONNREFUSED on .5, and
  the same file with only the host resolved authenticates and reads the registry. The credential was
  never the problem (`CONT-EXPV2-RUNTIME-CREDENTIAL-STALE` was measured against
  C:\HermesLab\williamos-runtime, which serves nothing). The ADDRESS was.

  `lib/fabric/authority-registry-url.mjs` was written to fix exactly this and had no production
  caller -- `CONT-EXPV2-RESOLVER-NOT-WIRED`. This is that caller. The address stops being
  configuration and becomes a lookup, resolved once per start, so a future lease change is survived
  by restarting rather than by editing a file nobody remembers exists.

  WHY NOT JUST WRITE .8 INTO .env.local. Because that is the defect, not the repair: correct on the
  day it is typed and silently wrong the next time the lease moves. It is the same class that broke
  cross-node backups, `known_hosts`, and the authority container's port binding
  (`CONT-EXPV2-HARDCODED-ADDRESS-CLASS`). A literal here would be its fifth occurrence.

  WHAT IS AND IS NOT OVERRIDDEN. Only DATABASE_URL, and within it only the host: the resolver
  carries role, password, port, database and query through byte-for-byte. `.env.local` remains the
  one place the credential lives, and this script never reads, prints or writes it -- the resolved
  string is passed to the child process in memory and the only thing ever logged is the resolver's
  own redacted diagnostic line.

  NO FAIL-OPEN. If resolution fails, the cockpit does NOT start. Starting it anyway would fall back
  to the address in the file, which is the stale value this exists to stop trusting -- and the
  application answers 200 on /sign-in while being unable to reach its database, so the failure would
  look exactly like a healthy service. That is precisely how this went unnoticed for two days.

  THE SECOND DEFECT THIS CLOSES (#1015). The application reads the TerraFusion target workspace as
  `process.env.WILLIAMOS_TERRAFUSION_ROOT`. `.env.local` DECLARED that variable, but
  nothing ever APPLIED it: a Next standalone server does not load `.env.local` into the environment
  of the already-running process for server-side reads, and this launcher exported only NODE_ENV,
  HOSTNAME, PORT and DATABASE_URL. So the fallback won and `process.cwd()` -- the deployed standalone
  bundle -- became "the workspace".

  Measured on the deployed cockpit at build 73ec0713, not inferred. The file explorer listed the
  bundle's own directory (`cockpit/ config/ docs/ lib/ public/ scripts/ server.js package.json
  .env.local`) instead of the governed workspace. And because that bundle is not a git work tree,
  `measureCurrentMain()` could not `git fetch origin main`, `measureLiveWorkContext()` returned null,
  and EVERY governed save was refused with `FAILED_STALE_MAIN` -- while the cockpit answered 200 and
  looked entirely healthy. The same fetch in the intended workspace succeeds in 453ms as the same
  user the service runs as.

  WHY VALIDATION AND NOT A LITERAL. Writing a path in here would be the same class of defect as
  writing .8 into `.env.local`: correct the day it is typed, silently wrong afterwards, and
  undetectable because a wrong workspace still serves files happily. So the value stays a declared
  deployment fact (`.env.local`, overridable by -ProjectRoot) and this script's job is to APPLY it
  and to PROVE it is the governed workspace before the server sees it. The checks are exactly the
  premises the application later depends on: it exists, it is not the deployed bundle, it is the root
  of a git work tree, and it has an origin remote to measure main against. A root that fails any of
  them cannot support a governed save, so booting on it would only reproduce the silent failure.
#>
[CmdletBinding()]
param(
  [string]$AppRoot = "C:\HermesLab\williamos-runtime-64034e93-flat",
  [string]$LogRoot = "C:\ProgramData\WilliamOS\logs",
  [int]$Port = 3100,
  [string]$BindHost = "127.0.0.1",
  [string]$FabricRoot,
  # The TerraFusion workspace the cockpit edits. Declared in .env.local; this legacy-named switch overrides it when a
  # deployment needs to say so explicitly. Never defaulted to a literal here -- see the header.
  [string]$ProjectRoot
)

$ErrorActionPreference = "Stop"

$node = "C:\Program Files\nodejs\node.exe"
$server = Join-Path $AppRoot "server.js"
$envFile = Join-Path $AppRoot ".env.local"
$resolver = Join-Path $AppRoot "scripts\fabric\resolve-authority-registry-url.mjs"

New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
$stdoutLog = Join-Path $LogRoot "williamos-live.stdout.log"
$stderrLog = Join-Path $LogRoot "williamos-live.stderr.log"
$bootLog = Join-Path $LogRoot "williamos-live.boot.log"

function Write-Boot {
  param([string]$Message)
  "$([DateTimeOffset]::UtcNow.ToString('o')) $Message" | Out-File -FilePath $bootLog -Append -Encoding utf8
}

foreach ($required in @($server, $envFile, $resolver)) {
  if (-not (Test-Path -LiteralPath $required)) {
    Write-Boot "BOOT_REFUSED MISSING_FILE $required"
    Write-Error "Refusing to start: $required is missing. The deploy did not place the boot-time resolution tooling, so the authority registry's address cannot be resolved."
    exit 1
  }
}

# ---------------------------------------------------------------------------------------------
# The governed workspace (#1015). Declared -> validated -> exported. Never guessed, never defaulted.
# ---------------------------------------------------------------------------------------------

function Get-DeclaredEnvValue {
  param([string]$File, [string]$Key)
  # Reads ONE key. The file also holds the database credential, so nothing here echoes the file and
  # only the value asked for is ever returned.
  foreach ($line in (Get-Content -LiteralPath $File)) {
    if ($line -match "^\s*$([regex]::Escape($Key))\s*=\s*(.*)$") {
      return $Matches[1].Trim().Trim('"').Trim("'")
    }
  }
  return $null
}

function Invoke-GitProbe {
  param([string]$Directory, [string[]]$GitArgs)
  # PowerShell 5.1 wraps ANY native stderr in a NativeCommandError, which under `Stop` terminates the
  # script even on success -- the same trap documented for the resolver call below.
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $output = & git -C $Directory @GitArgs 2>$null
    return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = ("$output").Trim() }
  } finally {
    $ErrorActionPreference = $previous
  }
}

function Deny-Boot {
  param([string]$Code, [string]$Explanation)
  Write-Boot "BOOT_REFUSED $Code"
  Write-Error "Refusing to start: $Explanation"
  exit 1
}

$declaredRoot = if ($ProjectRoot) { $ProjectRoot } else { Get-DeclaredEnvValue -File $envFile -Key "WILLIAMOS_TERRAFUSION_ROOT" }
$declaredWilliamOsRoot = Get-DeclaredEnvValue -File $envFile -Key "WILLIAMOS_PROJECT_ROOT"
$declaredWilliamOsSpaceIdentity = Get-DeclaredEnvValue -File $envFile -Key "WILLIAMOS_PROJECT_SPACE_IDENTITY"
$declaredWorkspaceAppUrl = Get-DeclaredEnvValue -File $envFile -Key "WILLIAMOS_WORKSPACE_APP_URL"
$declaredTerraFusionSpaceIdentity = Get-DeclaredEnvValue -File $envFile -Key "WILLIAMOS_TERRAFUSION_SPACE_IDENTITY"
$declaredLocalSetupEnabled = Get-DeclaredEnvValue -File $envFile -Key "LOCAL_SETUP_ENABLED"
$localSetupEnabled = if ($declaredLocalSetupEnabled -ieq "true") { "true" } else { "false" }
if (-not $declaredRoot) {
  Deny-Boot "PROJECT_ROOT_UNDECLARED" "no WILLIAMOS_TERRAFUSION_ROOT was declared in $envFile and none was passed as -ProjectRoot. Without it WilliamOS has no declared TerraFusion checkout."
}
if (-not (Test-Path -LiteralPath $declaredRoot -PathType Container)) {
  Deny-Boot "PROJECT_ROOT_MISSING" "the declared workspace '$declaredRoot' does not exist."
}
$resolvedProjectRoot = (Resolve-Path -LiteralPath $declaredRoot).ProviderPath.TrimEnd('\')
$resolvedAppRoot = (Resolve-Path -LiteralPath $AppRoot).ProviderPath.TrimEnd('\')

# The exact defect being closed: the deployed bundle standing in for the workspace.
if ($resolvedProjectRoot -ieq $resolvedAppRoot) {
  Deny-Boot "PROJECT_ROOT_IS_APP_ROOT" "the declared workspace resolves to the deployed bundle ($resolvedAppRoot). That is the #1015 defect itself: the explorer would browse the running server's own directory and no governed save could ever succeed."
}

# A governed save requires a work-context receipt, which requires measuring origin/main, which
# requires a git work tree with an origin remote. Prove all three now rather than discovering it as a
# 409 on the owner's first save.
$topLevel = Invoke-GitProbe -Directory $resolvedProjectRoot -GitArgs @("rev-parse", "--show-toplevel")
if ($topLevel.ExitCode -ne 0 -or -not $topLevel.Output) {
  Deny-Boot "PROJECT_ROOT_NOT_GOVERNED_WORKSPACE" "'$resolvedProjectRoot' is not inside a git work tree, so current origin/main cannot be measured and every governed save would be refused with FAILED_STALE_MAIN."
}
$normalisedTopLevel = ($topLevel.Output -replace '/', '\').TrimEnd('\')
if ($normalisedTopLevel -ine $resolvedProjectRoot) {
  Deny-Boot "PROJECT_ROOT_NOT_WORKTREE_ROOT" "'$resolvedProjectRoot' is not the root of its git work tree (that root is '$normalisedTopLevel'). Serving a subdirectory as the workspace hides the rest of the repository from the explorer."
}
$originRemote = Invoke-GitProbe -Directory $resolvedProjectRoot -GitArgs @("remote", "get-url", "origin")
if ($originRemote.ExitCode -ne 0 -or -not $originRemote.Output) {
  Deny-Boot "PROJECT_ROOT_NO_ORIGIN_REMOTE" "'$resolvedProjectRoot' has no origin remote, so 'git fetch origin main' cannot run and no work-context receipt can be issued."
}
$canonicalTerraFusionRepository = "bsvalues/terrafusion_os_1.0"
$normalizedOrigin = ("$($originRemote.Output)".Trim() -replace '\.git$', '')
if ($normalizedOrigin -match '^git@github\.com:(.+)$') {
  $normalizedOrigin = $Matches[1]
} elseif ($normalizedOrigin -match '^https?://github\.com/(.+)$') {
  $normalizedOrigin = $Matches[1]
} elseif ($normalizedOrigin -match '^ssh://git@github\.com(?:\:22)?/(.+)$') {
  $normalizedOrigin = $Matches[1]
} elseif ($normalizedOrigin -match '^ssh://git@ssh\.github\.com(?::443)?/(.+)$') {
  $normalizedOrigin = $Matches[1]
}
$normalizedOrigin = $normalizedOrigin.Trim('/').ToLowerInvariant()
if ($normalizedOrigin -ne $canonicalTerraFusionRepository) {
  Deny-Boot "PROJECT_ROOT_REPOSITORY_MISMATCH" "the declared workspace origin is not the canonical TerraFusion repository ($canonicalTerraFusionRepository)."
}

Write-Boot "BOOT_PROJECT_ROOT $resolvedProjectRoot"

# -------------------------------------------------------------------------------------------------
# Optional Core Seven secondary mounts. Each declaration is either absent (and therefore simply not
# mounted) or is proven against the server-owned repository identity before Node can observe it.
# The integrated OS 1.0 checkout above remains the required primary workspace and Preview source.
# -------------------------------------------------------------------------------------------------

$secondaryRepositoryDeclarations = @(
  [pscustomobject]@{ Environment = "WILLIAMOS_TERRAFUSION_SOVEREIGN_OS_ROOT"; Repository = "bsvalues/terrafusion-os" },
  [pscustomobject]@{ Environment = "WILLIAMOS_TERRAFUSION_FORGE_ROOT"; Repository = "bsvalues/terrafusion-forge" },
  [pscustomobject]@{ Environment = "WILLIAMOS_TERRAFUSION_ATLAS_ROOT"; Repository = "bsvalues/terrafusion-atlas" },
  [pscustomobject]@{ Environment = "WILLIAMOS_TERRAFUSION_DAIS_ROOT"; Repository = "bsvalues/terrafusion-dais" },
  [pscustomobject]@{ Environment = "WILLIAMOS_TERRAFUSION_DOSSIER_ROOT"; Repository = "bsvalues/terrafusion-dossier" },
  [pscustomobject]@{ Environment = "WILLIAMOS_TERRAFUSION_GPT_ROOT"; Repository = "bsvalues/terrafusion-gpt" }
)
$verifiedSecondaryRepositoryMounts = @()

foreach ($secondary in $secondaryRepositoryDeclarations) {
  # `.env.local` is the deployment declaration boundary for these mounts. Remove any value inherited
  # from the scheduled-task process or machine before consulting that file, otherwise an absent key
  # could leave an unvalidated ambient path visible to Node.
  Remove-Item -Path "Env:$($secondary.Environment)" -ErrorAction SilentlyContinue
  $declaredSecondaryRoot = Get-DeclaredEnvValue -File $envFile -Key $secondary.Environment
  if (-not $declaredSecondaryRoot) {
    # Secondary repositories are optional at boot. WilliamOS reports an absent mount truthfully;
    # inventing a path or refusing the required OS 1.0 workspace would both be incorrect.
    continue
  }

  if (-not (Test-Path -LiteralPath $declaredSecondaryRoot -PathType Container)) {
    Deny-Boot "SECONDARY_ROOT_MISSING key=$($secondary.Environment)" "the configured secondary Core Seven root '$declaredSecondaryRoot' for $($secondary.Environment) does not exist."
  }
  $resolvedSecondaryRoot = (Resolve-Path -LiteralPath $declaredSecondaryRoot).ProviderPath.TrimEnd('\')
  if ($resolvedSecondaryRoot -ieq $resolvedAppRoot) {
    Deny-Boot "SECONDARY_ROOT_IS_APP_ROOT key=$($secondary.Environment)" "the configured secondary Core Seven root for $($secondary.Environment) resolves to the deployed WilliamOS bundle."
  }

  $secondaryTopLevel = Invoke-GitProbe -Directory $resolvedSecondaryRoot -GitArgs @("rev-parse", "--show-toplevel")
  if ($secondaryTopLevel.ExitCode -ne 0 -or -not $secondaryTopLevel.Output) {
    Deny-Boot "SECONDARY_ROOT_NOT_GOVERNED_WORKSPACE key=$($secondary.Environment)" "the configured secondary Core Seven root '$resolvedSecondaryRoot' is not inside a git work tree."
  }
  $normalizedSecondaryTopLevel = ($secondaryTopLevel.Output -replace '/', '\').TrimEnd('\')
  if ($normalizedSecondaryTopLevel -ine $resolvedSecondaryRoot) {
    Deny-Boot "SECONDARY_ROOT_NOT_WORKTREE_ROOT key=$($secondary.Environment)" "the configured secondary Core Seven root '$resolvedSecondaryRoot' is not the exact root of its git work tree (that root is '$normalizedSecondaryTopLevel')."
  }

  $secondaryOriginRemote = Invoke-GitProbe -Directory $resolvedSecondaryRoot -GitArgs @("remote", "get-url", "origin")
  if ($secondaryOriginRemote.ExitCode -ne 0 -or -not $secondaryOriginRemote.Output) {
    Deny-Boot "SECONDARY_ROOT_NO_ORIGIN_REMOTE key=$($secondary.Environment)" "the configured secondary Core Seven root '$resolvedSecondaryRoot' has no origin remote."
  }
  $normalizedSecondaryOrigin = ("$($secondaryOriginRemote.Output)".Trim() -replace '\.git$', '')
  if ($normalizedSecondaryOrigin -match '^git@github\.com:(.+)$') {
    $normalizedSecondaryOrigin = $Matches[1]
  } elseif ($normalizedSecondaryOrigin -match '^https?://github\.com/(.+)$') {
    $normalizedSecondaryOrigin = $Matches[1]
  } elseif ($normalizedSecondaryOrigin -match '^ssh://git@github\.com(?:\:22)?/(.+)$') {
    $normalizedSecondaryOrigin = $Matches[1]
  } elseif ($normalizedSecondaryOrigin -match '^ssh://git@ssh\.github\.com(?::443)?/(.+)$') {
    $normalizedSecondaryOrigin = $Matches[1]
  }
  $normalizedSecondaryOrigin = $normalizedSecondaryOrigin.Trim('/').ToLowerInvariant()
  if ($normalizedSecondaryOrigin -ne $secondary.Repository) {
    Deny-Boot "SECONDARY_ROOT_REPOSITORY_MISMATCH key=$($secondary.Environment)" "the configured secondary Core Seven root for $($secondary.Environment) is not the canonical repository $($secondary.Repository)."
  }

  $verifiedSecondaryRepositoryMounts += [pscustomobject]@{
    Environment = $secondary.Environment
    ResolvedRoot = $resolvedSecondaryRoot
  }
  Write-Boot "BOOT_SECONDARY_ROOT $($secondary.Environment) $resolvedSecondaryRoot"
}

# Resolve. stdout carries the connection string and is captured into a variable -- never a file, never
# a log. stderr carries the resolver's redacted diagnostic, which IS recorded because it names the
# registry fingerprint the answer came from and that is what makes a later boot auditable.
$resolverArgs = @($resolver, $envFile)
if ($FabricRoot) { $resolverArgs += "--fabric-root=$FabricRoot" }

$diagnosticFile = Join-Path $env:TEMP ("williamos-live-resolve-{0}.err" -f [guid]::NewGuid().ToString("N"))

# Two things about this call, both learned the hard way on this exact script.
#
# Native stderr is redirected to a FILE rather than merged with `2>&1`, because merging splices the
# resolver's diagnostic into stdout -- and stdout is the connection string being captured.
#
# And `$ErrorActionPreference` is dropped to Continue around it. Windows PowerShell 5.1 wraps ANY
# output a native command writes to stderr in a NativeCommandError record, whether or not the command
# succeeded; under `Stop` that terminates the script. The resolver writes its (successful) evidence
# line to stderr by design, so with `Stop` in force this refused to boot every single time while the
# resolution underneath it was working perfectly. The exit code is what says whether it worked, so
# that is what is read.
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
  Write-Boot "BOOT_REFUSED AUTHORITY_HOST_UNRESOLVED exit=$resolverExit $diagnostic"
  Write-Error "Refusing to start: the authority registry's address could not be resolved from the fabric registry (exit $resolverExit). $diagnostic"
  exit 1
}

# `& node` returns each stdout line as its own array element. Take the single line the CLI emits.
if ($resolvedUrl -is [array]) { $resolvedUrl = ($resolvedUrl | Where-Object { $_ } | Select-Object -Last 1) }
$resolvedUrl = [string]$resolvedUrl
$resolvedUrl = $resolvedUrl.Trim()

# Assert the shape before handing it to the server. An empty or non-postgres value here would be
# exported as DATABASE_URL and produce a confusing failure deep inside the connection pool.
if ($resolvedUrl -notmatch '^postgres(ql)?://') {
  Write-Boot "BOOT_REFUSED RESOLVED_URL_UNUSABLE $diagnostic"
  Write-Error "Refusing to start: the resolver returned something that is not a postgres connection string."
  exit 1
}

Write-Boot "BOOT_RESOLVED $diagnostic"

Set-Location -LiteralPath $AppRoot
$env:NODE_ENV = "production"
$env:HOSTNAME = $BindHost
$env:PORT = "$Port"
$env:LOCAL_SETUP_ENABLED = $localSetupEnabled
# Next's env loader does not overwrite a variable already present in process.env, so this wins over
# the DATABASE_URL in .env.local. That precedence is the whole mechanism, so the deploy proves it on
# the built artifact rather than citing it.
$env:DATABASE_URL = $resolvedUrl
# Same precedence, same reason: declared in .env.local, but only an already-present process variable
# is actually read by the server, so applying it here is what makes the declaration take effect.
$env:WILLIAMOS_TERRAFUSION_ROOT = $resolvedProjectRoot
if ($declaredTerraFusionSpaceIdentity) {
  $env:WILLIAMOS_TERRAFUSION_SPACE_IDENTITY = $declaredTerraFusionSpaceIdentity
}
# The TerraFusion target and the WilliamOS source checkout have deliberately separate meanings.
# Preserve the source-root declaration for system operations such as the sign-in fix; never alias
# the validated TerraFusion target into this variable.
if ($declaredWilliamOsRoot) {
  $env:WILLIAMOS_PROJECT_ROOT = $declaredWilliamOsRoot
}
if ($declaredWilliamOsSpaceIdentity) {
  $env:WILLIAMOS_PROJECT_SPACE_IDENTITY = $declaredWilliamOsSpaceIdentity
}
# Preview admission remains server-owned and fail-closed. The launcher only carries the explicitly
# declared endpoint into the Node process; without this export, a valid .env.local declaration is
# invisible to the standalone runtime and the real Preview disappears after every supervised restart.
if ($declaredWorkspaceAppUrl) {
  $env:WILLIAMOS_WORKSPACE_APP_URL = $declaredWorkspaceAppUrl
} else {
  Remove-Item -Path "Env:WILLIAMOS_WORKSPACE_APP_URL" -ErrorAction SilentlyContinue
}
foreach ($mount in $verifiedSecondaryRepositoryMounts) {
  Set-Item -Path "Env:$($mount.Environment)" -Value $mount.ResolvedRoot
}

# Keep Node as the scheduled task's direct child. Start-Process detached the server from the task:
# stopping `WilliamOS Live` left port 3100 serving the outgoing process, while the replacement task
# failed with EADDRINUSE. Health then measured the orphan and falsely reported a successful restart.
$previousPreference = $ErrorActionPreference
$serverExit = 1
try {
  $ErrorActionPreference = "Continue"
  & $node $server 1>> $stdoutLog 2>> $stderrLog
  $nodeInvocationSucceeded = $?
  $nodeExit = $LASTEXITCODE
  if ($nodeInvocationSucceeded) {
    $serverExit = if ($null -eq $nodeExit) { 0 } else { $nodeExit }
  } elseif ($null -ne $nodeExit -and $nodeExit -ne 0) {
    $serverExit = $nodeExit
  }
} finally {
  $ErrorActionPreference = $previousPreference
}
exit $serverExit
