<#
.SYNOPSIS
  Watch the WilliamOS cockpit and record, loudly, when it is not serving.

.DESCRIPTION
  WHY THIS EXISTS. The cockpit was measured down for three days and nothing said so. Its launcher now
  records every boot attempt (BOOT_ENTRY) and its tasks carry a repeating trigger, but a repeating
  trigger only helps a task that has actually EXITED -- `MultipleInstances = IgnoreNew` is required
  here (the launcher supervises a served port) and its consequence is that a task left Running while
  serving nothing blocks its own recovery. Nothing inside the task can see that, so something outside
  has to check the port.

  HOW IT DECIDES. This watchdog is deliberately conservative, because a watchdog that acts on a false
  positive is worse than no watchdog: it becomes the outage. Two facts drove this design, both
  measured on this node:
    - The boot is SLOW AND VARIABLE: the provenance gate took 83s on one start and over 300s on
      another, with no file lock involved. A probe that fires during that window sees a healthy boot
      as an outage.
    - `Stop-ScheduledTask` does NOT kill the launcher's child processes. Stopping and restarting
      therefore leaves the previous `verify-door-provenance.mjs` alive while a second one starts,
      which is a state no one wants to create on purpose.

  So: it never stops a Running task. It only ever STARTS a task that is not running, and only after
  the outage has persisted across consecutive probes. Anything else is recorded, not acted on.

  LIVENESS IS A GET ON A SERVICE, NOT A TLS HANDSHAKE. The HTTPS listener presents a certificate for
  `williamos.lan`; probing it as `127.0.0.1` fails validation and would report a healthy cockpit as
  down. The HTTPS port is therefore checked for LISTENING only, and liveness is the upstream HTTP
  surface, which is what actually serves.
#>
[CmdletBinding()]
param(
  [string]$LogRoot = "C:\ProgramData\WilliamOS\logs",
  [int]$HttpPort = 3100,
  [int]$HttpsPort = 3443,
  [int]$FailuresBeforeAction = 3,
  [int]$BootGraceSeconds = 600,
  [int]$HeartbeatEveryRuns = 12,
  [switch]$NoRecover,
  [switch]$WhatIfOnly
)

$ErrorActionPreference = "Continue"

$watchLog = Join-Path $LogRoot "williamos-cockpit-watchdog.log"
$stateFile = Join-Path $LogRoot "williamos-cockpit-watchdog.state"
$null = New-Item -ItemType Directory -Path $LogRoot -Force -ErrorAction SilentlyContinue

function Write-Watch {
  param([string]$Line)
  "$([DateTimeOffset]::UtcNow.ToString('o')) $Line" | Add-Content -LiteralPath $watchLog -Encoding utf8 -ErrorAction SilentlyContinue
}

function Test-Listening {
  param([int]$Port)
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Test-Upstream {
  try {
    $response = Invoke-WebRequest -Uri ("http://127.0.0.1:{0}/" -f $HttpPort) -TimeoutSec 15 -UseBasicParsing -ErrorAction Stop
    return @{ ok = $true; status = [int]$response.StatusCode; error = "" }
  } catch {
    $status = $null
    if ($_.Exception.Response) { try { $status = [int]$_.Exception.Response.StatusCode } catch { } }
    # An HTTP error status still means the service answered. Only a failure to reach it is an outage.
    $reachable = $null -ne $status
    return @{ ok = $reachable; status = $status; error = $_.Exception.Message.Split([char]10)[0] }
  }
}

# A boot in progress is not an outage. The launcher's supervisor is the evidence: if one is younger
# than the grace window, the cockpit is starting, and restarting it would kill a healthy boot.
$supervisorAgeSeconds = $null
$supervisors = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { ([string]$_.CommandLine) -match 'start-williamos-(live|https)\.ps1' })
if ($supervisors.Count -gt 0) {
  $supervisorAgeSeconds = ($supervisors | ForEach-Object { ((Get-Date) - $_.CreationDate).TotalSeconds } | Measure-Object -Minimum).Minimum
}
$booting = ($null -ne $supervisorAgeSeconds) -and ($supervisorAgeSeconds -lt $BootGraceSeconds)

$listeningHttp = Test-Listening -Port $HttpPort
$listeningHttps = Test-Listening -Port $HttpsPort
$upstream = Test-Upstream

$taskNames = @("WilliamOS Live", "WilliamOS HTTPS")
$taskState = @{}
foreach ($name in $taskNames) {
  $task = Get-ScheduledTask -TaskPath "\" -TaskName $name -ErrorAction SilentlyContinue
  $taskState[$name] = if ($task) { [string]$task.State } else { "ABSENT" }
}
$taskSummary = ($taskState.GetEnumerator() | ForEach-Object { "{0}={1}" -f $_.Key, $_.Value }) -join " "

$healthy = $upstream.ok -and $listeningHttps

$previous = if (Test-Path -LiteralPath $stateFile) { (Get-Content -LiteralPath $stateFile -Raw).Trim() } else { "unknown" }
$consecutiveFailures = 0
if ($previous -match "^down:(\d+)$") { $consecutiveFailures = [int]$Matches[1] }

if ($healthy) {
  $runs = 0
  if ($previous -match "^healthy:(\d+)$") { $runs = [int]$Matches[1] }
  $runs++
  if ($previous -eq "unknown") {
    Write-Watch ("WATCHDOG_STARTED http={0} httpsListening={1} tasks: {2}" -f $upstream.status, $listeningHttps, $taskSummary)
  } elseif ($previous -notmatch "^healthy") {
    Write-Watch ("COCKPIT_RECOVERED http={0} httpsListening={1} tasks: {2} (was {3})" -f $upstream.status, $listeningHttps, $taskSummary, $previous)
  } elseif ($runs -ge $HeartbeatEveryRuns) {
    Write-Watch ("COCKPIT_HEALTHY http={0} tasks: {1}" -f $upstream.status, $taskSummary)
    $runs = 0
  }
  "healthy:$runs" | Set-Content -LiteralPath $stateFile -Encoding utf8 -ErrorAction SilentlyContinue
  Write-Output "cockpit healthy (http=$($upstream.status) httpsListening=$listeningHttps)"
  exit 0
}

$consecutiveFailures++
"down:$consecutiveFailures" | Set-Content -LiteralPath $stateFile -Encoding utf8 -ErrorAction SilentlyContinue

Write-Watch ("COCKPIT_DOWN_STRIKE{0} httpOk={1} httpStatus={2} httpError={3} listeningHttp={4} listeningHttps={5} booting={6} supervisorAgeSec={7} tasks: {8}" -f `
  $consecutiveFailures, $upstream.ok, $upstream.status, $upstream.error, $listeningHttp, $listeningHttps, $booting, $supervisorAgeSeconds, $taskSummary)
Write-Output "COCKPIT_DOWN strike=$consecutiveFailures booting=$booting tasks: $taskSummary"

if ($booting) {
  Write-Watch ("ACTION_SUPPRESSED reason=BOOT_IN_PROGRESS supervisorAgeSec={0} graceSec={1}" -f $supervisorAgeSeconds, $BootGraceSeconds)
  exit 1
}
if ($consecutiveFailures -lt $FailuresBeforeAction) {
  Write-Watch ("ACTION_SUPPRESSED reason=BELOW_THRESHOLD strikes={0} required={1}" -f $consecutiveFailures, $FailuresBeforeAction)
  exit 1
}
if ($NoRecover -or $WhatIfOnly) {
  Write-Watch ("ACTION_SUPPRESSED reason=$(if ($NoRecover) { 'NoRecover' } else { 'WhatIfOnly' })") 
  exit 1
}

# Only ever START a task that has exited. A Running task is never stopped: Stop-ScheduledTask would
# orphan the launcher's child processes, and the scheduler's own trigger is the correct retry path.
foreach ($name in $taskNames) {
  if ($taskState[$name] -eq "Running") {
    Write-Watch ("ACTION_SKIPPED task={0} reason=ALREADY_RUNNING" -f $name)
    continue
  }
  try {
    Start-ScheduledTask -TaskPath "\" -TaskName $name -ErrorAction Stop
    Write-Watch ("RECOVERY_STARTED task={0} afterStrikes={1}" -f $name, $consecutiveFailures)
  } catch {
    Write-Watch ("RECOVERY_START_FAILED task={0} error={1}" -f $name, $_.Exception.Message.Split([char]10)[0])
  }
}

Write-Output "recovery attempted after $consecutiveFailures strikes"
exit 1