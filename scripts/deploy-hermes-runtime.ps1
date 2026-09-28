<#
.SYNOPSIS
  Deploy the built cockpit to the HERMES runtime, and prove it came back up.

.DESCRIPTION
  This used to be done by hand, and doing it by hand is how the HTTPS proxy and the application were
  deployed from different commits -- which broke sign-in from the owner's phone with no error anyone
  could see. The steps are not complicated; they just have to be the same steps every time, and the
  last one has to be a check rather than an assumption.

  The runtime dependency tree is left alone unless -WithDependencies is passed. In that mode pnpm
  first materializes a portable, hoisted production graph from the exact lockfile in a disposable
  same-volume stage. The stopped runtime then receives that already-proven tree by an atomic rename.
  Robocopy must not flatten pnpm's links: doing so changes Node's resolution ancestry and hides
  transitive packages.

  What actually changes between deploys is the compiled application: .next, server.js and the static
  assets. That is what this copies.

.PARAMETER WithDependencies
  Replace production node_modules from an exact, prevalidated lockfile stage. Needed only when the
  lockfile changed.

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
  [string]$HttpsStartTarget = "C:\ProgramData\WilliamOS\start-williamos-https.ps1",
  [int]$Port = 3100,
  [int]$HttpsPort = 3443,
  [switch]$WithDependencies,
  [switch]$VerifyOnly,
  [switch]$SkipRollbackCapture
)

$ErrorActionPreference = "Stop"
$HermesLanAddress = "192.168.88.9"
$HermesOverlayAddress = "100.97.194.84"
$CanonicalHostname = "williamos.lan"
$HostsPath = Join-Path $env:SystemRoot "System32\drivers\etc\hosts"

# These are product identity, not deployment knobs. The HTTPS proxy's host allow-list, forwarded
# origin, device-auth boundary, native Cockpit capability, and HERMES certificates all name this
# exact 3100/3443 pair. Accepting different values here previously changed only the probes and
# rollback command while the proxy kept serving 3443 -> 3100. Refuse that split-brain state before
# verification, task control, rollback capture, or file mutation.
if ($Port -ne 3100 -or $HttpsPort -ne 3443) {
  throw "WilliamOS HERMES uses the canonical HTTP/HTTPS ports 3100/3443; port overrides are not supported"
}

# Resolved here rather than as a parameter default: $PSScriptRoot is not populated during parameter
# binding, so the default silently became an empty path.
if (-not $Source) { $Source = Split-Path -Parent $PSScriptRoot }

function Test-Cockpit {
  param([int]$Port, [int]$TimeoutSeconds = 300)
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
  param([int]$Port, [int]$TimeoutSeconds = 60, [switch]$CanonicalOverlay)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      if ($CanonicalOverlay) {
        $curl = "$env:SystemRoot\System32\curl.exe"
        & $curl --fail --silent --show-error --ssl-revoke-best-effort --max-time 10 `
          --resolve "williamos.lan:${Port}:$HermesOverlayAddress" "https://williamos.lan:$Port/api/health" | Out-Null
        if ($LASTEXITCODE -eq 0) { return $true }
      } else {
        $response = Invoke-WebRequest -Uri "https://${HermesLanAddress}:$Port/api/health" -UseBasicParsing -TimeoutSec 10
        if ($response.StatusCode -eq 200) { return $true }
      }
    } catch {
    }
    Start-Sleep -Seconds 3
  }
  return $false
}

function Get-LegacyCockpitRelayState {
  $rows = @(netsh interface portproxy show v4tov4 2>&1 | ForEach-Object { $_.ToString() })
  $listenPattern = "^\s*$([regex]::Escape($HermesOverlayAddress))\s+$HttpsPort\s+(\S+)\s+(\d+)\s*$"
  $matches = @($rows | Select-String -Pattern $listenPattern)
  if ($matches.Count -gt 1) { throw "Multiple legacy relay records claim ${HermesOverlayAddress}:$HttpsPort" }
  if ($matches.Count -eq 0) { return [pscustomobject]@{ wasPresent = $false } }
  $targetAddress = $matches[0].Matches[0].Groups[1].Value
  $targetPort = [int]$matches[0].Matches[0].Groups[2].Value
  if ($targetAddress -ne $HermesLanAddress -or $targetPort -ne $HttpsPort) {
    throw "${HermesOverlayAddress}:$HttpsPort is reserved by an unrelated portproxy target ${targetAddress}:$targetPort"
  }
  return [pscustomobject]@{ wasPresent = $true }
}

function Remove-LegacyCockpitRelay {
  netsh interface portproxy delete v4tov4 listenaddress=$HermesOverlayAddress listenport=$HttpsPort 2>&1 | Out-Null
  $state = Get-LegacyCockpitRelayState
  if ($state.wasPresent) { throw "Legacy cockpit relay still owns ${HermesOverlayAddress}:$HttpsPort after deletion" }
  Write-Output "retired exact legacy cockpit relay ${HermesOverlayAddress}:$HttpsPort -> ${HermesLanAddress}:$HttpsPort"
}

function Test-ProxySupportsNativeOverlay {
  param([string]$ProxyPath)
  if (-not (Test-Path -LiteralPath $ProxyPath -PathType Leaf)) { return $false }
  $proxyText = Get-Content -LiteralPath $ProxyPath -Raw
  return [bool]($proxyText -match 'startListener\(HERMES_HTTPS_OVERLAY_HOST,\s*\{\s*required:\s*false\s*\}\)')
}

function Assert-OverlayFirewallRule {
  $ruleName = "WilliamOS cockpit over Tailscale"
  $rules = @(Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)
  if ($rules.Count -ne 1) { throw "The exact HERMES overlay firewall rule '$ruleName' is missing or ambiguous" }
  $rule = $rules[0]
  $portFilters = @($rule | Get-NetFirewallPortFilter)
  $addressFilters = @($rule | Get-NetFirewallAddressFilter)
  if ([string]$rule.Enabled -ne "True" -or [string]$rule.Direction -ne "Inbound" -or [string]$rule.Action -ne "Allow" `
    -or [string]$rule.Profile -ne "Private" -or $portFilters.Count -ne 1 -or $addressFilters.Count -ne 1 `
    -or [string]$portFilters[0].Protocol -notin @("TCP", "6") `
    -or [string]$portFilters[0].LocalPort -ne [string]$HttpsPort `
    -or @($addressFilters[0].LocalAddress).Count -ne 1 `
    -or [string]@($addressFilters[0].LocalAddress)[0] -ne $HermesOverlayAddress) {
    throw "The HERMES overlay firewall rule '$ruleName' is not exactly scoped to inbound Private TCP ${HermesOverlayAddress}:$HttpsPort"
  }
}

function Ensure-OverlayFirewallRule {
  $ruleName = "WilliamOS cockpit over Tailscale"
  $rules = @(Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)
  if ($rules.Count -gt 1) { throw "The exact HERMES overlay firewall rule '$ruleName' is ambiguous" }
  if ($rules.Count -eq 0) {
    $null = New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Enabled True `
      -Profile Private -Protocol TCP -LocalAddress $HermesOverlayAddress -LocalPort $HttpsPort
  } else {
    $rule = $rules[0]
    $portFilters = @($rule | Get-NetFirewallPortFilter)
    $addressFilters = @($rule | Get-NetFirewallAddressFilter)
    if ([string]$rule.Direction -ne "Inbound" -or [string]$rule.Action -ne "Allow" `
      -or [string]$rule.Profile -ne "Private" -or $portFilters.Count -ne 1 -or $addressFilters.Count -ne 1 `
      -or [string]$portFilters[0].Protocol -notin @("TCP", "6") `
      -or [string]$portFilters[0].LocalPort -ne [string]$HttpsPort `
      -or @($addressFilters[0].LocalAddress).Count -ne 1 `
      -or [string]@($addressFilters[0].LocalAddress)[0] -ne $HermesOverlayAddress) {
      throw "The existing HERMES overlay firewall rule '$ruleName' is not the exact rule WilliamOS is allowed to manage"
    }
    if ([string]$rule.Enabled -ne "True") { $null = $rule | Set-NetFirewallRule -Enabled True }
  }
  Assert-OverlayFirewallRule
}

function Get-CanonicalHostnameMappings {
  if (-not (Test-Path -LiteralPath $HostsPath -PathType Leaf)) { return @() }
  return @(Get-Content -LiteralPath $HostsPath | ForEach-Object {
    $fields = @(($_ -replace '#.*$', '').Trim() -split '\s+' | Where-Object { $_ })
    if ($fields.Count -ge 2 -and @($fields[1..($fields.Count - 1)] | Where-Object { $_ -ieq $CanonicalHostname }).Count -gt 0) {
      $fields[0]
    }
  })
}

function Assert-CanonicalHostname {
  $mappings = @(Get-CanonicalHostnameMappings)
  if ($mappings.Count -ne 1 -or $mappings[0] -ne $HermesLanAddress) {
    throw "The HERMES hosts file must map exactly one '$CanonicalHostname' entry to $HermesLanAddress"
  }
}

function Ensure-CanonicalHostname {
  $mappings = @(Get-CanonicalHostnameMappings)
  if ($mappings.Count -gt 0 -and ($mappings.Count -ne 1 -or $mappings[0] -ne $HermesLanAddress)) {
    throw "The HERMES hosts file contains a conflicting or ambiguous '$CanonicalHostname' mapping; refusing to replace it"
  }
  if ($mappings.Count -eq 0) {
    Add-Content -LiteralPath $HostsPath -Value "$HermesLanAddress $CanonicalHostname # WilliamOS canonical HERMES origin"
  }
  Assert-CanonicalHostname
}

function Assert-TailscaleServiceReady {
  $tailscale = @(Get-CimInstance Win32_Service -Filter "Name='Tailscale'" -ErrorAction SilentlyContinue)
  if ($tailscale.Count -ne 1 -or $tailscale[0].StartMode -ne "Auto") {
    throw "The HERMES Tailscale service must be configured for automatic start before WilliamOS deployment"
  }
  if ($tailscale[0].State -ne "Running") {
    throw "The HERMES Tailscale service must be running before WilliamOS deployment"
  }
}

function Stop-ExpectedListener {
  param([int]$ListenerPort, [string]$ExpectedCommandPath)
  $expectedPath = [IO.Path]::GetFullPath($ExpectedCommandPath).TrimEnd('\')
  $ownerProcessIds = @(Get-NetTCPConnection -LocalPort $ListenerPort -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($ownerProcessId in $ownerProcessIds) {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerProcessId"
      $pathMatched = $false
      if ($process -and $process.CommandLine) {
        $tokens = @([regex]::Matches($process.CommandLine, '(?:"([^"]*)"|''([^'']*)''|(\S+))') | ForEach-Object {
          @($_.Groups[1].Value, $_.Groups[2].Value, $_.Groups[3].Value) |
            Where-Object { $_ } | Select-Object -First 1
        })
        if ($tokens.Count -ge 2 -and [IO.Path]::GetFileName($tokens[0]) -ieq "node.exe") {
          try {
            $pathMatched = [IO.Path]::GetFullPath($tokens[1]).TrimEnd('\') -ieq $expectedPath
          } catch { }
        }
      }
      if (-not $pathMatched) {
        throw "Port $ListenerPort is owned by an unrelated process; refusing to stop it during WilliamOS deploy"
      }
      Stop-Process -Id $process.ProcessId -Force
  }
}

function Assert-LiveTaskUsesLauncher {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  $actions = @($task.Actions)
  if ($actions.Count -ne 1 -or [IO.Path]::GetFileName($actions[0].Execute) -ine "powershell.exe" -or -not $actions[0].Arguments) {
    throw "$TaskName does not invoke the selected Live launcher '$LiveStartTarget'; refusing a deploy that would install unused boot semantics"
  }
  $fileArguments = [regex]::Matches($actions[0].Arguments, '(?i)(?:^|\s)-File\s+(?:"([^"]+)"|''([^'']+)''|(\S+))(?=\s|$)')
  if ($fileArguments.Count -ne 1) {
    throw "$TaskName does not invoke the selected Live launcher '$LiveStartTarget'; refusing a deploy that would install unused boot semantics"
  }
  $selectedArgument = @($fileArguments[0].Groups[1].Value, $fileArguments[0].Groups[2].Value, $fileArguments[0].Groups[3].Value) |
    Where-Object { $_ } | Select-Object -First 1
  $expectedLauncher = [IO.Path]::GetFullPath($LiveStartTarget).TrimEnd('\')
  $actualLauncher = [IO.Path]::GetFullPath($selectedArgument).TrimEnd('\')
  if ($actualLauncher -ine $expectedLauncher) {
    throw "$TaskName does not invoke the selected Live launcher '$LiveStartTarget'; refusing a deploy that would install unused boot semantics"
  }
}

function Assert-LiveLauncherWritable {
  # Prove the external launcher can actually be replaced before stopping either production task.
  # Membership in Administrators is insufficient under UAC: a medium-integrity token reports the
  # group as deny-only and can read this file but cannot overwrite it. Discovering that after the
  # tasks are stopped creates an avoidable outage without changing a single deployed byte.
  if (Test-Path -LiteralPath $LiveStartTarget -PathType Leaf) {
    $stream = $null
    try {
      $stream = [IO.File]::Open($LiveStartTarget, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite)
    } catch {
      throw "The WilliamOS Live launcher '$LiveStartTarget' is not writable by this process. Run the deployment from an elevated administrator shell; refusing before stopping production."
    } finally {
      if ($stream) { $stream.Dispose() }
    }
    return
  }

  $parent = Split-Path -Parent $LiveStartTarget
  if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
    throw "The WilliamOS Live launcher directory '$parent' does not exist. Create it with the required administrator ownership before deploying; refusing before stopping production."
  }
  $probe = Join-Path $parent (".williamos-deploy-write-probe-{0}.tmp" -f [guid]::NewGuid().ToString("N"))
  $stream = $null
  try {
    $stream = [IO.File]::Open($probe, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None, 1, [IO.FileOptions]::DeleteOnClose)
  } catch {
    throw "The WilliamOS Live launcher directory '$parent' is not writable by this process. Run the deployment from an elevated administrator shell; refusing before stopping production."
  } finally {
    if ($stream) { $stream.Dispose() }
    Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
  }
}

# Validate the external task binding before verification, rollback capture, task control, or file
# mutation. A custom target is supported only when the supervised task actually invokes it.
Assert-LiveTaskUsesLauncher
Assert-TailscaleServiceReady
if ($VerifyOnly) {
  Assert-CanonicalHostname
  Assert-OverlayFirewallRule
}

if ($VerifyOnly) {
  if (-not (Test-Cockpit -Port $Port)) {
    Write-Error "unhealthy: /sign-in did not answer 200 on port $Port"
    exit 1
  }
  if (-not (Test-HttpsCockpit -Port $HttpsPort)) {
    Write-Error "unhealthy: the HERMES LAN HTTPS listener did not answer on port $HttpsPort"
    exit 1
  }
  if (-not (Test-HttpsCockpit -Port $HttpsPort -CanonicalOverlay)) {
    Write-Error "unhealthy: the canonical williamos.lan origin did not answer over the HERMES overlay"
    exit 1
  }
  $runningSha = Get-RunningSha -Port $Port
  $looseSha = Get-BuiltSha -StandaloneRoot $Runtime
  if (-not $runningSha -or $runningSha -ne $looseSha) {
    Write-Error "provenance mismatch: running '$runningSha', loose runtime '$looseSha'"
    exit 1
  }
  Write-Output "healthy on HERMES: HTTP $Port, LAN HTTPS $HttpsPort, canonical overlay listener, and exact firewall rule; running and loose provenance agree at $runningSha"
  Write-Output "remote acceptance remains separate: run scripts/lab-control/transport/verify-cockpit-transport.ps1 on OMEN"
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
# #1223 R2: the provenance gate + attester are boot-critical trust code. They install BESIDE the
# launchers under ProgramData (administrator-gated, outside the robocopy target) — never inside
# the runtime tree they exist to distrust, where a runtime-writer could substitute them. Refuse
# before touching production if the source lacks them.
$gateScriptNames = @("verify-door-provenance.mjs", "attest-deployment.mjs")
$gateSourceDir = Join-Path $Source "scripts\hermes-bridge"
$gateTargetDir = Join-Path (Split-Path -Parent $LiveStartTarget) "scripts\hermes-bridge"
# #1223 R3: the trust root holds the attestation PRIVATE key and is readable only by
# SYSTEM/Administrators; the ring (public keys) and the gate code live in the gate directory under
# Users:RX. The runtime identity can read the public material but cannot rewrite any of it, so a
# filesystem writer cannot substitute the judge, the keys, or the receipt that admits it.
$trustRootDir = Join-Path (Split-Path -Parent $LiveStartTarget) "trust"
$trustKeyTarget = Join-Path $trustRootDir "deployment-attestation-key.json"
$trustKeyLegacy = Join-Path $env:USERPROFILE ".williamos\deployment-attestation-key.json"
$ringTarget = Join-Path $gateTargetDir "deployment-attestation-keys.json"
$receiptTarget = Join-Path $gateTargetDir "deployment-attestation.json"
$nodeExe = "C:\Program Files\nodejs\node.exe"
foreach ($g in $gateScriptNames) {
  $gs = Join-Path $gateSourceDir $g
  if (-not (Test-Path $gs)) { throw "Missing door trust script in the source tree: $gs" }
}
$httpsStartSource = Join-Path $Source "deploy\hermes\williamos-https\start-williamos-https.ps1"
if (-not (Test-Path -LiteralPath $httpsStartSource -PathType Leaf)) {
  throw "Missing repository-owned WilliamOS HTTPS start script: $httpsStartSource"
}
# `-SkipRollbackCapture` is for an empty installation. The task launcher lives outside `$Runtime`,
# so an empty runtime can still have an older hand-placed launcher. Overwriting that file without a
# manifest would make the flag silently destructive. Refuse before stopping either task or changing
# any bytes; a caller with an existing launcher must take the normal captured-rollback path.
if ($SkipRollbackCapture -and (Test-Path -LiteralPath $LiveStartTarget -PathType Leaf)) {
  throw "SkipRollbackCapture cannot overwrite the existing WilliamOS Live start definition at '$LiveStartTarget'. Run without -SkipRollbackCapture so the external launcher is captured and restorable."
}
Assert-LiveLauncherWritable
$legacyRelayState = Get-LegacyCockpitRelayState
if ($SkipRollbackCapture -and $legacyRelayState.wasPresent) {
  throw "SkipRollbackCapture cannot retire the existing cockpit relay without a rollback record"
}
$outgoingProxyPath = Join-Path $Runtime "scripts\hermes-https-proxy.mjs"
$outgoingProxySupportsNativeOverlay = Test-ProxySupportsNativeOverlay -ProxyPath $outgoingProxyPath
$rollbackOverlayMode = if ($outgoingProxySupportsNativeOverlay) {
  "direct"
} elseif ($legacyRelayState.wasPresent) {
  "legacy-relay"
} else {
  # The outgoing runtime predates the direct overlay listener and no relay currently survives. A
  # rollback must add the exact TLS-pass-through relay or it would restore local bytes while silently
  # removing the canonical owner route.
  "compatibility-relay"
}

# Fresh-build provenance (#762 deploy doctrine): the artifact must carry a real commit SHA. A
# placeholder/unknown SHA means the build never stamped HEAD -- refuse rather than ship an artifact we
# cannot tie to a commit. The equality against the running instance is checked after start, below.
$builtSha = Get-BuiltSha -StandaloneRoot $standalone
if (-not $builtSha -or $builtSha -eq "development" -or $builtSha -eq "unknown") {
  throw "The standalone at $standalone carries no real build SHA (got '$builtSha'). Rebuild with 'pnpm build' from a clean tree so provenance is stamped; a deploy that cannot prove its commit is not allowed."
}
if ($builtSha -like "*-dirty") {
  # A dirty stamp is undeliverable, not merely untidy: `attest-deployment.mjs attest --sha=…` (below)
  # requires a clean 40-hex revision and rejects "<sha>-dirty", so this deploy can never attest.
  # Refuse HERE, where nothing has been mutated, instead of warning and proceeding -- proceeding
  # reaches that rejection only after Stop-ScheduledTask, which turns a precondition that is free to
  # check into a service outage. Rebuild from a clean tree:
  #   git -C <source> status --porcelain   # must be empty
  #   pnpm build
  throw "The standalone at $standalone was built over uncommitted changes (SHA '$builtSha'). The deployment attestation requires a clean 40-hex revision and rejects a '-dirty' stamp, so this deploy can never complete. Rebuild from a clean tree ('pnpm build') first. Refusing now, before any service is stopped."
}

# Server-loaded loose trees beyond lib\fabric. The runtime loads three more trees at REQUEST time
# (not boot): the dispatch seam imports `components/operator/multi-agent-capability-registry.ts`
# and the operator scripts by file path under process.cwd(), the capability surface route does the
# same, and the elastic-compute config lives under config\execution-fabric. Before this block,
# deploys shipped none of them -- a freshly deployed door could serve a route whose imports were
# absent until some agent hand-copied the trees (measured 2026-09-12: the first seam deploy needed
# exactly that manual step, and /api/environment/capability would 503 without it). Hand-listing is
# the same maintenance trap lib\fabric's note above describes, so whole trees are mirrored.
# Census-verified 2026-09-12: each target tree currently equals its source exactly (zero
# runtime-only files), so /MIR cannot destroy runtime-only content; the guard below keeps that
# true for future generations instead of trusting it.
$looseTreeSyncs = @(
  "scripts\execution-fabric",
  "scripts\multi-agent-operator",
  "components\operator",
  "config\execution-fabric"
)
# Initialized here so Phase A's self-vouch guard (below) can reference it; the real value is set
# at capture time. When Phase A runs, capture has not happened yet, so this is $null and the
# exclusion is a no-op -- exactly right, since the current run's capture cannot exist to vouch.
$rollbackRoot = $null
# Two-phase by review findings (PRs 1228/1229): validating AFTER .next was already replaced left
# the door stopped and half-updated on refusal. Phase A (here: before the scheduled tasks stop,
# before rollback capture, before ANY copy) decides every tree with read-only checks; Phase B
# (after capture, where /MIR is safe) is the only mutation loop. A refusal at this point changes
# nothing on the running system at all.
#
# The guard protects only what the rollback cannot: files NO governed generation ever shipped.
# A target file missing from this source generation is EITHER ordinary lane churn (a tracked
# file later removed or renamed in the lane: the previous deploy's rollback capture names it,
# and /MIR dropping it is correct behavior, restorable from that capture) OR genuinely
# ungoverned content (placed by hand outside any governed deploy -- refuse). Each extra file is
# therefore judged against the union of the recent prior-generation rollback captures of THIS
# tree. Unknown history fails closed: extras with no prior capture to vouch for them refuse.
$looseTreeHistoryDepth = 24
$syncActions = @()
foreach ($tree in $looseTreeSyncs) {
  $treeSource = Join-Path $Source $tree
  if (-not (Test-Path -LiteralPath $treeSource -PathType Container)) {
    # Required, not optional: every listed tree is imported at REQUEST time by a served
    # route or the dispatch seam. A silently skipped tree means a fresh runtime boots
    # without files the surface imports (the health gates never exercise those routes, so
    # it would pass every check serving a broken product), or leaves stale bytes of the
    # previous generation on an existing one. Refuse instead - pre-mutation by placement.
    # (Review P2, PR 1229.)
    throw "loose-tree $tree is required at request time but absent from $Source; refusing to deploy. Restore the tree in the build source (full checkout) and rebuild."
  }
  $treeTarget = Join-Path $Runtime $tree
  if (Test-Path -LiteralPath $treeTarget -PathType Container) {
    $targetFull = (Resolve-Path -LiteralPath $treeTarget).Path
    $runtimeFiles = @(Get-ChildItem -LiteralPath $treeTarget -Recurse -File -Force |
      ForEach-Object { $_.FullName.Substring($targetFull.Length) })
    $sourceFull = (Resolve-Path -LiteralPath $treeSource).Path
    $sourceFiles = @(Get-ChildItem -LiteralPath $treeSource -Recurse -File -Force |
      ForEach-Object { $_.FullName.Substring($sourceFull.Length) })
    $extra = @($runtimeFiles | Where-Object { $sourceFiles -notcontains $_ })
    if ($extra.Count -gt 0) {
      $historyPaths = @()
      $rootsParent = [IO.Path]::GetDirectoryName($Runtime)
      $rootsName = [IO.Path]::GetFileName($Runtime)
      $roots = @(Get-ChildItem -LiteralPath $rootsParent -Directory -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "$rootsName.rollback-*" } |
        # The CURRENT run's capture is a copy of the present runtime, not a governed generation:
        # without this exclusion every runtime-only file self-vouches (it appears in its own
        # capture) and the guard could never fire on a normal deploy. Only genuinely prior
        # generations may authorize a removal. (Review P1, PR 1229.)
        Where-Object { (-not $rollbackRoot) -or ($_.FullName -ne [IO.Path]::GetFullPath($rollbackRoot)) } |
        Sort-Object Name -Descending | Select-Object -First $looseTreeHistoryDepth)
      foreach ($root in $roots) {
        $mf = Join-Path $root.FullName "rollback-manifest.json"
        if (-not (Test-Path -LiteralPath $mf -PathType Leaf)) { continue }
        try { $manifest = Get-Content -LiteralPath $mf -Raw | ConvertFrom-Json } catch { continue }
        $dirs = @($manifest.directories | Where-Object { [string]$_.path -eq $tree })
        if ($dirs.Count -ne 1 -or -not [bool]$dirs[0].wasPresent) { continue }
        $cap = Join-Path $root.FullName $tree
        if (-not (Test-Path -LiteralPath $cap -PathType Container)) { continue }
        $capFull = (Resolve-Path -LiteralPath $cap).Path
        $historyPaths += @(Get-ChildItem -LiteralPath $cap -Recurse -File -Force |
          ForEach-Object { $_.FullName.Substring($capFull.Length) })
      }
      $ungoverned = @($extra | Where-Object { $historyPaths -notcontains $_ })
      if ($ungoverned.Count -gt 0) {
        throw "loose-tree $tree has $($ungoverned.Count) files that no governed generation shipped (e.g. $($ungoverned[0])); refusing to mirror a tree containing ungoverned content. Reconcile them into the lane first."
      }
      Write-Output "loose-tree ${tree}: $($extra.Count) prior-generation file(s) removed from the lane will drop from the runtime (rollback captures vouch for them)"
    }
  }
  $syncActions += ,@{ source = $treeSource; target = $treeTarget; tree = $tree }
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
$lockSource = Join-Path $Source "pnpm-lock.yaml"
$runtimeLock = Join-Path $Runtime "pnpm-lock.yaml"
if (-not (Test-Path -LiteralPath $lockSource -PathType Leaf)) {
  throw "Missing production lockfile: $lockSource"
}

function Get-PhysicalVolumeIdentity {
  param([Parameter(Mandatory = $true)][string]$Path)
  $resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
  $volumes = @(Get-Volume -FilePath $resolved -ErrorAction Stop)
  if ($volumes.Count -ne 1 -or -not $volumes[0].UniqueId) {
    throw "Cannot prove the physical volume identity for '$resolved'"
  }
  return [string]$volumes[0].UniqueId
}
if (-not $WithDependencies) {
  if (-not (Test-Path -LiteralPath $runtimeLock -PathType Leaf)) {
    throw "The runtime has no pnpm-lock.yaml. Refusing to copy a new package manifest over an unproven dependency graph; rerun with -WithDependencies."
  }
  $sourceLockHash = (Get-FileHash -LiteralPath $lockSource -Algorithm SHA256).Hash
  $runtimeLockHash = (Get-FileHash -LiteralPath $runtimeLock -Algorithm SHA256).Hash
  if ($sourceLockHash -ne $runtimeLockHash) {
    throw "The source and runtime lockfiles differ. Refusing to pair the new package manifest with the old dependency graph; rerun with -WithDependencies."
  }
}
if ($WithDependencies -and $SkipRollbackCapture -and (Test-Path -LiteralPath (Join-Path $Runtime "node_modules") -PathType Container)) {
  throw "SkipRollbackCapture is only valid for an empty runtime; existing node_modules must be captured before replacement."
}

# Build and prove the replacement dependency tree before touching production. The stage shares the
# runtime's parent volume so both the outgoing and incoming trees can be renamed without flattening
# pnpm links or exposing a half-installed graph. Hoisted mode deliberately produces a link-free tree.
$dependencyStageRoot = $null
$stagedModules = $null
if ($WithDependencies) {
  $dependencyStageRoot = Join-Path (Split-Path -Parent $Runtime) (".williamos-dependencies-{0}" -f [guid]::NewGuid().ToString("N"))
  $null = New-Item -ItemType Directory -Path $dependencyStageRoot
  Copy-Item -LiteralPath (Join-Path $standalone "package.json") -Destination (Join-Path $dependencyStageRoot "package.json")
  Copy-Item -LiteralPath $lockSource -Destination (Join-Path $dependencyStageRoot "pnpm-lock.yaml")
  $pnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
  if (-not $pnpm) { $pnpm = Get-Command pnpm -ErrorAction Stop }
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & $pnpm.Source --dir $dependencyStageRoot install --prod --offline --ignore-workspace --frozen-lockfile --config.node-linker=hoisted
    $installExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($installExit -ne 0) {
    Remove-Item -LiteralPath $dependencyStageRoot -Recurse -Force -ErrorAction SilentlyContinue
    throw "pnpm failed to stage the locked production dependency tree (exit $installExit)"
  }
  $stagedModules = Join-Path $dependencyStageRoot "node_modules"
  $stagedLinks = @(Get-ChildItem -LiteralPath $stagedModules -Force -Recurse -Attributes ReparsePoint -ErrorAction SilentlyContinue)
  if ($stagedLinks.Count -ne 0) {
    Remove-Item -LiteralPath $dependencyStageRoot -Recurse -Force -ErrorAction SilentlyContinue
    throw "The staged dependency tree contains reparse points and is not portable"
  }
  if ((Get-PhysicalVolumeIdentity -Path $dependencyStageRoot) -ne (Get-PhysicalVolumeIdentity -Path $Runtime)) {
    Remove-Item -LiteralPath $dependencyStageRoot -Recurse -Force -ErrorAction SilentlyContinue
    throw "The dependency stage and runtime are on different physical volumes; refusing a non-atomic dependency replacement"
  }
}

# ROLLBACK CAPTURE, before anything is overwritten. `robocopy /MIR` below is destructive and this
# script used to say, accurately, that "the previous build is not automatically restored" -- which
# left the only recovery from a bad deploy as "rebuild the previous commit", requiring the previous
# commit to still be known and buildable. Every runtime path this script can mutate is copied aside
# first, so recovery is a copy back. `.env.local` is excluded because deployment never writes it and
# its hash is guarded below. node_modules is recorded in the manifest but moved only after the
# supervised processes stop, preserving the exact outgoing graph at its original relative identity.
$rollbackRoot = $null
if (-not $SkipRollbackCapture) {
  $rollbackRoot = "$Runtime.rollback-$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))"
  $null = New-Item -ItemType Directory -Path $rollbackRoot -Force
  $rollbackFiles = @(
    "server.js",
    "package.json",
    "pnpm-lock.yaml",
    "lib\generated\build-provenance.json",
    "lib\generated\deployment-manifest.json",
    "scripts\hermes-https-proxy.mjs",
    "scripts\fabric\resolve-authority-registry-url.mjs"
  )
  $rollbackDirectories = @(".next", "public", "lib\fabric", "scripts\execution-fabric", "scripts\multi-agent-operator", "components\operator", "config\execution-fabric")
  if ($WithDependencies) { $rollbackDirectories += "node_modules" }
  $liveStartBackup = "external\start-williamos-live.ps1"
  $liveStartWasPresent = Test-Path -LiteralPath $LiveStartTarget -PathType Leaf
  $httpsStartBackup = "external\start-williamos-https.ps1"
  $httpsStartWasPresent = Test-Path -LiteralPath $HttpsStartTarget -PathType Leaf
  $trustDirBackup = "external\scripts-hermes-bridge"
  $trustDirWasPresent = Test-Path -LiteralPath $gateTargetDir -PathType Container
  $rollbackManifest = [ordered]@{
    version = 8
    withDependencies = [bool]$WithDependencies
    directories = @()
    files = @()
    liveStart = [ordered]@{ target = $LiveStartTarget; backupPath = $liveStartBackup; wasPresent = $liveStartWasPresent }
    httpsStart = [ordered]@{ target = $HttpsStartTarget; backupPath = $httpsStartBackup; wasPresent = $httpsStartWasPresent }
    trustDir = [ordered]@{ target = $gateTargetDir; backupPath = $trustDirBackup; wasPresent = $trustDirWasPresent }
    legacyRelay = [ordered]@{ wasPresent = [bool]$legacyRelayState.wasPresent; listenAddress = $HermesOverlayAddress; listenPort = $HttpsPort; connectAddress = $HermesLanAddress; connectPort = $HttpsPort }
    overlayRestoreMode = $rollbackOverlayMode
  }
  foreach ($directory in $rollbackDirectories) {
    $existing = Join-Path $Runtime $directory
    $wasPresent = Test-Path -LiteralPath $existing -PathType Container
    $rollbackManifest.directories += [ordered]@{ path = $directory; wasPresent = $wasPresent }
    if ($wasPresent -and $directory -ne "node_modules") {
      $rollbackDirectory = Join-Path $rollbackRoot $directory
      $null = robocopy $existing $rollbackDirectory /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP
      if ($LASTEXITCODE -ge 8) { throw "rollback capture failed copying $directory (exit $LASTEXITCODE)" }
    }
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
  if ($httpsStartWasPresent) {
    $httpsStartRollbackFile = Join-Path $rollbackRoot $httpsStartBackup
    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $httpsStartRollbackFile) -Force
    Copy-Item -LiteralPath $HttpsStartTarget -Destination $httpsStartRollbackFile -Force
  }
  if ($trustDirWasPresent) {
    $null = robocopy $gateTargetDir (Join-Path $rollbackRoot $trustDirBackup) /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP
    if ($LASTEXITCODE -ge 8) { throw "rollback capture of the trusted gate directory failed (exit $LASTEXITCODE)" }
  }
  $rollbackManifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $rollbackRoot "rollback-manifest.json") -Encoding utf8
  # Recorded rather than assumed: a rollback directory nobody can name is not a rollback.
  Write-Output "rollback captured: $rollbackRoot"
  $restoreScriptLiteral = ConvertTo-PowerShellLiteral (Join-Path $Source "scripts\restore-hermes-runtime.ps1")
  $rollbackRootLiteral = ConvertTo-PowerShellLiteral $rollbackRoot
  $runtimeLiteral = ConvertTo-PowerShellLiteral $Runtime
  $taskNameLiteral = ConvertTo-PowerShellLiteral $TaskName
  $httpsTaskNameLiteral = ConvertTo-PowerShellLiteral $HttpsTaskName
  $liveStartTargetLiteral = ConvertTo-PowerShellLiteral $LiveStartTarget
  $portLiteral = ConvertTo-PowerShellLiteral ([string]$Port)
  $httpsPortLiteral = ConvertTo-PowerShellLiteral ([string]$HttpsPort)
  Write-Output "to restore: powershell -NoProfile -ExecutionPolicy Bypass -File $restoreScriptLiteral -RollbackRoot $rollbackRootLiteral -Runtime $runtimeLiteral -TaskName $taskNameLiteral -HttpsTaskName $httpsTaskNameLiteral -LiveStartTarget $liveStartTargetLiteral -HttpsStartTarget $HttpsStartTarget -Port $portLiteral -HttpsPort $httpsPortLiteral"
}

if ($WithDependencies -and $rollbackRoot -and (Get-PhysicalVolumeIdentity -Path $rollbackRoot) -ne (Get-PhysicalVolumeIdentity -Path $Runtime)) {
  Remove-Item -LiteralPath $dependencyStageRoot -Recurse -Force -ErrorAction SilentlyContinue
  throw "The rollback capture and runtime are on different physical volumes; refusing a dependency transfer that cannot be renamed exactly"
}

# Stop the supervised task AND anything still holding the port. Stop-ScheduledTask returns before the
# child process has exited, and a half-stopped server keeps its file handles, so the copy below would
# silently fail on exactly the files that matter.
Ensure-CanonicalHostname
Ensure-OverlayFirewallRule
Stop-ScheduledTask -TaskName $HttpsTaskName -ErrorAction SilentlyContinue
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
if ($legacyRelayState.wasPresent) { Remove-LegacyCockpitRelay }
Stop-ExpectedListener -ListenerPort $Port -ExpectedCommandPath (Join-Path $Runtime "server.js")
Stop-ExpectedListener -ListenerPort $HttpsPort -ExpectedCommandPath (Join-Path $Runtime "scripts\hermes-https-proxy.mjs")
Start-Sleep -Seconds 2

if ($WithDependencies) {
  $runtimeModules = Join-Path $Runtime "node_modules"
  $rollbackModules = if ($rollbackRoot) { Join-Path $rollbackRoot "node_modules" } else { $null }
  if (Test-Path -LiteralPath $runtimeModules -PathType Container) {
    Move-Item -LiteralPath $runtimeModules -Destination $rollbackModules
  }
  try {
    Move-Item -LiteralPath $stagedModules -Destination $runtimeModules
  } catch {
    if ($rollbackModules -and (Test-Path -LiteralPath $rollbackModules -PathType Container) -and -not (Test-Path -LiteralPath $runtimeModules)) {
      Move-Item -LiteralPath $rollbackModules -Destination $runtimeModules
    }
    throw
  }
  Remove-Item -LiteralPath $dependencyStageRoot -Recurse -Force -ErrorAction SilentlyContinue
}

# The task action points at ProgramData, so deploying only the bundle leaves boot semantics on an
# older hand-placed generation. Install the repository-owned definition before restart; the exact
# displaced bytes are part of the rollback manifest above.
$null = New-Item -ItemType Directory -Path (Split-Path -Parent $LiveStartTarget) -Force
Copy-Item -LiteralPath $liveStartSource -Destination $LiveStartTarget -Force
# #1223 R2: install the gate + attester INTO the trusted directory beside the launchers (validated
# early beside $liveStartSource). The gate refuses to run from anywhere else.
$null = New-Item -ItemType Directory -Path $gateTargetDir -Force
foreach ($g in $gateScriptNames) {
  Copy-Item -LiteralPath (Join-Path $gateSourceDir $g) -Destination (Join-Path $gateTargetDir $g) -Force
}

# #1223 R3 — trust-root installation (requires an elevated deployment; refuses rather than install a
# forgeable anchor). Ordered so a failure leaves the previous generation's anchor intact.
if (-not (Test-Path $trustRootDir)) { $null = New-Item -ItemType Directory -Path $trustRootDir -Force }
if (-not (Test-Path $trustKeyTarget)) {
  if (Test-Path $trustKeyLegacy) {
    Copy-Item -LiteralPath $trustKeyLegacy -Destination $trustKeyTarget -Force
    Write-Output "migrated the deployment attestation key into the protected trust root"
  } else {
    throw "No deployment attestation key at $trustKeyTarget (and no legacy copy at $trustKeyLegacy). Mint one before deploying: the door refuses to start without a signed artifact attestation (#1223)."
  }
}
# Validate the protected copy BEFORE deleting anything: the removals below are irreversible, so a
# truncated or malformed trust key must fail the deploy here, not strand it with no key at all.
$trustKeyRecord = $null
try { $trustKeyRecord = Get-Content -Raw -LiteralPath $trustKeyTarget | ConvertFrom-Json } catch { $trustKeyRecord = $null }
if (-not $trustKeyRecord -or -not $trustKeyRecord.keyId -or -not $trustKeyRecord.privateKeyBase64) {
  throw "The protected trust key at $trustKeyTarget is missing keyId/privateKeyBase64; refusing to remove the legacy copy."
}
# Once the protected copy exists the home copy stops being authoritative: it is readable by the
# runtime identity, so leaving it would re-open forged-manifest attacks.
$legacyTrustRemovals = @()
if (Test-Path $trustKeyLegacy) {
  Remove-Item -LiteralPath $trustKeyLegacy -Force
  $legacyTrustRemovals += $trustKeyLegacy
}
$legacySecretPath = Join-Path $env:USERPROFILE ".williamos\deployment-seal-secret.bin"
if (Test-Path $legacySecretPath) {
  Remove-Item -LiteralPath $legacySecretPath -Force
  $legacyTrustRemovals += $legacySecretPath
}
# Pre-R3 ring left in a USER-WRITABLE ProgramData path: inert on current code (the ring now lives
# beside the gate) but it is pollutable decoy trust material — remove it.
$legacyProgramDataRing = Join-Path (Split-Path -Parent $LiveStartTarget) "deployment-attestation-keys.json"
if (Test-Path -LiteralPath $legacyProgramDataRing -PathType Leaf) {
  Remove-Item -LiteralPath $legacyProgramDataRing -Force
  $legacyTrustRemovals += $legacyProgramDataRing
}
# pre-R4 receipt at the user-writable ProgramData root: superseded by the copy locked inside the
# gate directory; leave nothing writable behind.
$legacyReceipt = Join-Path (Split-Path -Parent $LiveStartTarget) "deployment-attestation.json"
if ((Test-Path -LiteralPath $legacyReceipt -PathType Leaf) -and ($legacyReceipt -ne $receiptTarget)) {
  Remove-Item -LiteralPath $legacyReceipt -Force
  $legacyTrustRemovals += $legacyReceipt
}
if ($legacyTrustRemovals.Count -gt 0) {
  Write-Output ("removed legacy trust material readable by the runtime identity: " + ($legacyTrustRemovals -join "; "))
}

# #1223 R5: install the admission ledger COPY inside the locked gate directory. The home-dir
# original (~\.williamos\integrations.json) is written by integrate-lab-main.mjs but is fully
# writable by the door's own identity, so it can never be the boot-time authority; the gate reads
# ONLY this copy. Rollback capture of the gate directory covers this file from the NEXT deploy on.
$ledgerSource = Join-Path $env:USERPROFILE ".williamos\integrations.json"
if (-not (Test-Path $ledgerSource -PathType Leaf)) { throw "No integration ledger at $ledgerSource; the gate would refuse every boot (LEDGER_UNREADABLE)." }
Copy-Item -LiteralPath $ledgerSource -Destination (Join-Path $gateTargetDir "integrations.json") -Force
Write-Output "installed the admission ledger copy into the trusted gate directory"

# Publish the public ring beside the gate, derived from the private key so the two cannot desync.
& $nodeExe -e "const c=require('crypto'),f=require('fs');const r=JSON.parse(f.readFileSync(process.argv[1],'utf8'));const pub=c.createPublicKey(c.createPrivateKey({key:Buffer.from(r.privateKeyBase64,'base64'),format:'der',type:'pkcs8'})).export({format:'der',type:'spki'}).toString('base64');f.writeFileSync(process.argv[2],JSON.stringify({[r.keyId]:pub},null,2)+'\n')" $trustKeyTarget $ringTarget
if ($LASTEXITCODE -ne 0) { throw "Failed to derive the deployment attestation trust ring (exit $LASTEXITCODE)." }

# ACLs: the runtime identity may read the anchors but never rewrite them. ProgramData's inherited
# Users:(WD,AD,WEA) is exactly what would make these forgeable, so it is removed explicitly.
$null = icacls $trustRootDir /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "BUILTIN\Administrators:(OI)(CI)F" 2>&1
if ($LASTEXITCODE -ne 0) { throw "Failed to lock down $trustRootDir (exit $LASTEXITCODE)." }
$null = icacls $gateTargetDir /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "BUILTIN\Administrators:(OI)(CI)F" "BUILTIN\Users:(OI)(CI)RX" 2>&1
if ($LASTEXITCODE -ne 0) { throw "Failed to lock down $gateTargetDir (exit $LASTEXITCODE)." }
foreach ($anchor in @($trustKeyTarget, $ringTarget)) {
  $null = icacls $anchor /inheritance:r /grant:r "SYSTEM:F" "BUILTIN\Administrators:F" "BUILTIN\Users:R" 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Failed to lock down $anchor (exit $LASTEXITCODE)." }
}
# #1223 R5: ownership, not just the mask. A file CREATED by a non-admin identity is owned by it,
# and an OWNER keeps implicit WRITE_DAC even when the ACL grants it nothing — so it can rewrite
# the ACL at leisure. Round-4 review proved an anchor the attacker owns and then /deny-s against
# itself passes every mask probe. The elevated deploy hands every trust object to
# BUILTIN\Administrators; the door identity cannot take ownership back without elevation.
foreach ($anchor in @($trustRootDir, $gateTargetDir, $trustKeyTarget, $ringTarget, (Join-Path $gateTargetDir "integrations.json"), (Join-Path $gateTargetDir "verify-door-provenance.mjs"), (Join-Path $gateTargetDir "attest-deployment.mjs"), $LiveStartTarget, $HttpsStartTarget)) {
  $null = icacls $anchor /setowner "BUILTIN\\Administrators" 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Failed to set owner BUILTIN\Administrators on anchor $anchor (exit $LASTEXITCODE) - the deploy must run elevated for the trust anchors to mean anything." }
}
# #1223: the HTTPS listener is part of the door; the repository-owned, gate-wired launcher is
# installed the same way with the same rollback coverage, so a deploy cannot leave :3443 booting a
# gateless generation.
Copy-Item -LiteralPath $httpsStartSource -Destination $HttpsStartTarget -Force

# #1223: a refresh must not leave the door unable to boot. Copy-Item re-inherits the parent's ACEs,
# which makes the launcher and the provenance gate writable by the identity that runs the door, and
# the next boot then fails closed. Re-apply the immutability invariant here, in the same deploy.
$doorProtectionScript = Join-Path $PSScriptRoot "hermes-bridge\protect-door-artifacts.ps1"
if (Test-Path -LiteralPath $doorProtectionScript) {
  . $doorProtectionScript
  Protect-WilliamOSDoor -InstallRoot (Split-Path -Parent $LiveStartTarget)
} else {
  throw "Refusing to complete the deploy: door-artifact protection script is absent at $doorProtectionScript. Without it this refresh would leave the door unable to boot (#1223)."
}

# robocopy /MIR on .next, because stale route chunks from a previous build are still served: Next
# resolves them by name, and a file nobody overwrote is a file that still answers.
$null = robocopy (Join-Path $standalone ".next") (Join-Path $Runtime ".next") /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP
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

# #1223 R3: the gate is deliberately NOT copied into the runtime. The installed launchers resolve it
# beside themselves (ProgramData, Users:RX), which is what makes it a trust anchor rather than a file
# the robocopy path can substitute; a runtime copy would be dead weight and a decoy a reader could
# mistake for the authority. The ProgramData install happens with the launchers above.

# Static assets and public/ live outside the standalone tree by design.
$null = robocopy (Join-Path $Source ".next\static") (Join-Path $Runtime ".next\static") /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw "robocopy failed copying .next\static (exit $LASTEXITCODE)" }
if (Test-Path (Join-Path $Source "public")) {
  $null = robocopy (Join-Path $Source "public") (Join-Path $Runtime "public") /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed copying public (exit $LASTEXITCODE)" }
} elseif (Test-Path -LiteralPath (Join-Path $Runtime "public") -PathType Container) {
  # The target was captured in the rollback manifest above. A generation with no public tree must not
  # keep serving the previous generation's assets.
  Remove-Item -LiteralPath (Join-Path $Runtime "public") -Recurse -Force
}

if ($WithDependencies) {
  Copy-Item -LiteralPath $lockSource -Destination (Join-Path $Runtime "pnpm-lock.yaml") -Force
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
# Only JavaScript modules belong in the production boot closure. Remove the outgoing generation's
# modules after rollback capture, then copy the source closure recursively so deleted/relocated
# modules cannot survive as runnable stale bytes. Non-module runtime files are left untouched.
Get-ChildItem -LiteralPath $fabricTarget -Filter "*.mjs" -File -Recurse -ErrorAction SilentlyContinue |
  Remove-Item -Force
$null = robocopy $fabricSource $fabricTarget "*.mjs" /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw "robocopy failed copying lib\fabric boot tooling (exit $LASTEXITCODE)" }

# Phase B: only now does this loop mutate, after every computable refusal above.
foreach ($action in $syncActions) {
  $null = New-Item -ItemType Directory -Path $action.target -Force
  $null = robocopy $action.source $action.target /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed copying loose tree $($action.tree) (exit $LASTEXITCODE)" }
  Write-Output "loose-tree synced: $($action.tree)"
}

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

# #1223 R4: the anchor chain only means something if it is owned by admins, not by the identity
# being audited. An unaugmented non-elevated run would create anchors OWNED by that identity,
# which can re-grant itself write access (implicit WRITE_DAC) — so the gate refuses this whole
# pipeline, rather than fail silently.
$deployIdentity = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $deployIdentity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "#1223: the door provenance deploy must run ELEVATED: it installs administrator-owned trust anchors that the door's own identity must not be able to rewrite. Run from an elevated PowerShell."
}
if (-not (Test-Path -LiteralPath (Join-Path $trustRootDir "deployment-attestation-key.json"))) {
  Write-Output "trust key absent: minting a new deployment attestation key under $trustRootDir"
}

# Prove the configuration survived the copy rather than assuming it did.
if ($envGuard) {
  $envNow = if (Test-Path $envPath) { (Get-FileHash $envPath -Algorithm SHA256).Hash } else { $null }
  if ($envNow -ne $envGuard) {
    throw "The deploy modified $envPath. Nothing here should touch it; restore it from the runtime backup before starting, or the cockpit will come up pointed at the wrong database."
  }
}

# #1223 R2: attest the STAGED bytes (signed manifest) and seal an external receipt BEFORE any task
# starts. The gate refuses boot without one, so a deploy that cannot attest fails here — loudly,
# before production stops — rather than at the first restart after the copy.
$stagedProvenance = Get-Content -Raw -LiteralPath (Join-Path $Runtime "lib\generated\build-provenance.json") | ConvertFrom-Json
if (-not $stagedProvenance.sha) { throw "Deployed build-provenance.json carries no sha; refusing to attest an anonymous artifact." }
& $nodeExe (Join-Path $gateTargetDir "attest-deployment.mjs") attest --app-root="$Runtime" --sha="$($stagedProvenance.sha)" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "deployment attestation FAILED (exit $LASTEXITCODE): the staged runtime cannot be proven bootable. Check the admin-only trust key under the trust root (C:\ProgramData\WilliamOS\trust) and the published ring beside the gate under the gate directory." }
& $nodeExe (Join-Path $gateTargetDir "attest-deployment.mjs") seal --app-root="$Runtime" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "external seal receipt FAILED (exit $LASTEXITCODE): refusing to start a door whose bytes are attested only inside themselves." }
# The receipt must not be rewritable by the identity running the door, or it becomes a rollback
# lever: seal it down before the task starts.
$null = icacls $receiptTarget /inheritance:r /grant:r "SYSTEM:F" "BUILTIN\Administrators:F" "BUILTIN\Users:R" 2>&1
if ($LASTEXITCODE -ne 0) { throw "Failed to lock down the seal receipt (exit $LASTEXITCODE)." }
$null = icacls $receiptTarget /setowner "BUILTIN\\Administrators" 2>&1
if ($LASTEXITCODE -ne 0) { throw "Failed to set owner BUILTIN\Administrators on the seal receipt (exit $LASTEXITCODE)." }
# Final anchor audit: every boot-time trust input must be BOTH unwritable AND administrator-owned
# (the gate re-checks at boot; failing HERE names a mis-install at deploy time instead).
foreach ($anchor in @((Join-Path $gateTargetDir "verify-door-provenance.mjs"), (Join-Path $gateTargetDir "attest-deployment.mjs"), $ringTarget, (Join-Path $gateTargetDir "integrations.json"), $receiptTarget, $trustKeyTarget)) {
  $owner = (Get-Acl -LiteralPath $anchor).Owner
  if ($owner -notin @("BUILTIN\Administrators", "NT AUTHORITY\SYSTEM")) { throw "Trust anchor $anchor is owned by $owner, not an administrator principal - an owner can always rewrite its own ACL; refusing to start a door on forgeable anchors (#1223)." }
}
Write-Output "deployment attested and sealed (manifest + external receipt); anchors administrator-owned"

# #1223 R6 (BLOCKING B6-2): the scheduled-task DEFINITION is part of the boot path. The R5 audit
# found "WilliamOS Live" owned by the door identity with Users:(I)(F), so that identity could rewrite
# the action and repoint the scheduled restart at its own script — a route the gate never sees. Lock
# both definitions to SYSTEM/Administrators and hand ownership to Administrators (elevated).
foreach ($taskName in @($TaskName, $HttpsTaskName)) {
  $taskXml = Join-Path -Path $env:windir -ChildPath "System32\Tasks\$taskName"
  if (-not (Test-Path -LiteralPath $taskXml)) { throw "Task definition not found for $taskName at $taskXml" }
  $null = icacls $taskXml /inheritance:r /grant:r "SYSTEM:(F)" "BUILTIN\Administrators:(F)" "BUILTIN\Users:(R)" 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Failed to lock the task definition ACL for $taskName (icacls exit $LASTEXITCODE)" }
  $null = icacls $taskXml /setowner "BUILTIN\Administrators" 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Failed to set the owner of task definition $taskName (icacls exit $LASTEXITCODE; elevation is required)" }
  $taskOwner = (Get-Acl -LiteralPath $taskXml).Owner
  if ($taskOwner -ne "BUILTIN\Administrators") { throw "Task definition $taskName is owned by $taskOwner after setowner; refusing to start the door on a rewritable boot route (#1223)" }
  Write-Host "BOOT_ROUTE_LOCKED $taskName owner=$taskOwner"
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
  Write-Error "The application is live on loopback, but the HERMES LAN HTTPS listener did not answer on port $HttpsPort. Treating the deploy as failed."
  exit 1
}
if (-not (Test-HttpsCockpit -Port $HttpsPort -CanonicalOverlay)) {
  Write-Error "The LAN listener is live, but the canonical williamos.lan origin did not answer over the HERMES overlay. Treating the deploy as failed."
  exit 1
}

Assert-OverlayFirewallRule
Write-Output "deployed and HERMES-local verified: running $runningSha, loose provenance agrees, HTTP $Port, LAN HTTPS $HttpsPort, canonical overlay listener, and exact firewall rule healthy"
Write-Output "remote acceptance remains separate: run scripts/lab-control/transport/verify-cockpit-transport.ps1 on OMEN"
