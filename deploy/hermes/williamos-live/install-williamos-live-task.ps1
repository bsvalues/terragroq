<#
.SYNOPSIS
  Declare the WilliamOS cockpit scheduled tasks: what starts the cockpit, and what keeps it alive.

.DESCRIPTION
  WHY THIS EXISTS. The cockpit task had no declaration anywhere. `Register-ScheduledTask` appears for
  it in no repository -- it was created once during commissioning and only described afterwards in a
  report. So its shape was whatever that one command happened to produce, and nothing could repair it:
  a logon-only trigger with no restart meant one failed boot was permanent until a human logged in,
  and the cockpit was measured down for three days because of exactly that. A service whose recovery
  behaviour is not declared cannot be fixed, only restarted by hand.

  WHAT IT DECLARES, AND WHY EACH PART.
    - Logon trigger, preserved: the cockpit must still come up when the operator logs in.
    - A recurring trigger every 15 minutes, indefinitely: the recovery path. A cockpit that died
      for any reason is retried without anyone logging in, which is the specific failure that cost
      three days.
    - RestartCount/RestartInterval: a boot that fails outright is retried promptly, not in 15 minutes.
    - StartWhenAvailable: a missed schedule is run when the machine is next up, not skipped.
    - Unlimited execution time: this task supervises a server; capping its wall time would kill a
      healthy cockpit.
    - Idle stop disabled and battery stops disabled: this is the same defect class that killed the
      Hello Lab tasks on this node, which shipped with PowerShell's default StopOnIdleEnd and were
      reaped idle mid-operation. A served process must not be stopped because the node looks idle.
    - MultipleInstances IgnoreNew: the task runs a supervisor that owns the port, so a second
      instance must never race it. A hung instance is NOT solved here -- that needs the separate
      liveness watchdog -- and this setting is deliberately not weakened to pretend otherwise.
    - RunLevel Limited, LogonType Interactive: closing this gate would defeat the #1223 provenance
      check, which refuses a door its own identity can rewrite. An elevated task would be refused at
      every boot; the cockpit runs unelevated by design.

  IDEMPOTENT AND REVERSIBLE. Existing task XML and ACL evidence is exported before any change, and
  re-running this converges rather than accumulating. It does not start the tasks unless -Start is
  given, so a caller can declare first and start deliberately.
#>
[CmdletBinding()]
param(
  [string[]]$TaskName = @("WilliamOS Live", "WilliamOS HTTPS", "WilliamOS Cockpit Watchdog"),
  [string]$LogRoot = "C:\ProgramData\WilliamOS\logs",
  [string]$BackupRoot = "C:\ProgramData\WilliamOS\backups",
  [int]$HealthIntervalMinutes = 15,
  [switch]$Start,
  [switch]$WhatIfOnly
)

$ErrorActionPreference = "Stop"

# The action each task runs. These are the launchers already installed on this node; this script
# declares how they are scheduled, and does not install or modify their contents.
$actions = @{
  "WilliamOS Live" = @{
    Script = "C:\ProgramData\WilliamOS\start-williamos-live.ps1"
    Reason = "cockpit server and its supervising HTTPS proxy upstream"
  }
  "WilliamOS HTTPS" = @{
    Script = "C:\ProgramData\WilliamOS\start-williamos-https.ps1"
    Reason = "owner-facing TLS listener on 3443"
  }
  # The watchdog is declared here, beside what it watches, so it survives a reinstall for the same
  # reason the launcher does. It runs more often than the recovery trigger because its job is to
  # notice, and a probe every 15 minutes would leave 15 minutes of unobserved outage.
  "WilliamOS Cockpit Watchdog" = @{
    Script = "C:\ProgramData\WilliamOS\watchdog-williamos-cockpit.ps1"
    Reason = "liveness probe: records an outage, and clears a hung instance its own trigger cannot"
    IntervalMinutes = 5
    InstallFrom = "watchdog-williamos-cockpit.ps1"
    # A watchdog that can hang is a watchdog that has silently died -- the exact defect it exists
    # to catch. Unset, this setting is PT0S (unlimited): one blocked probe was observed running
    # 159 minutes having used 1s of CPU while MultipleInstances=IgnoreNew silently discarded every
    # trigger behind it -- Running, doing nothing, for three hours, its liveness log gone quiet.
    # The limit must be shorter than IntervalMinutes so a hung instance dies before the next tick.
    ExecTimeLimitMinutes = 4
  }
}

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$null = New-Item -ItemType Directory -Path $BackupRoot -Force
$null = New-Item -ItemType Directory -Path $LogRoot -Force

$powershell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
if (-not (Test-Path -LiteralPath $powershell)) { throw "powershell.exe not found at $powershell" }

foreach ($name in $TaskName) {
  $spec = $actions[$name]
  if (-not $spec) { throw "No declared action for task '$name'. Declare it here rather than registering an undeclared task." }

  # Install the declared script when the declaration carries one. A declaration nothing installs is
  # documentation (#1010), and the watchdog is declared here specifically so it survives a reinstall
  # rather than existing only on the node.
  if ($spec.InstallFrom) {
    $sourceScript = Join-Path $PSScriptRoot $spec.InstallFrom
    if (-not (Test-Path -LiteralPath $sourceScript)) { throw "Declared script source is absent beside this installer: $sourceScript" }
    $previousTarget = if (Test-Path -LiteralPath $spec.Script) { "$($spec.Script).previous-$stamp" } else { $null }
    if ($previousTarget) { Copy-Item -LiteralPath $spec.Script -Destination $previousTarget -Force }
    Copy-Item -LiteralPath $sourceScript -Destination $spec.Script -Force
    Write-Output ("installed {0} -> {1}" -f $spec.InstallFrom, $spec.Script)
  }

  if (-not (Test-Path -LiteralPath $spec.Script)) { throw "Declared launcher is absent for '$name': $($spec.Script)" }

  # Evidence first: the exact prior declaration, so this is reversible without guessing.
  $existing = Get-ScheduledTask -TaskPath "\" -TaskName $name -ErrorAction SilentlyContinue
  if ($existing) {
    $evidence = Join-Path $BackupRoot ("task-{0}-{1}.xml" -f ($name -replace "[^A-Za-z0-9]+", "-"), $stamp)
    Export-ScheduledTask -TaskPath "\" -TaskName $name | Set-Content -LiteralPath $evidence -Encoding utf8
    Write-Output "prior declaration exported: $evidence"
  } else {
    Write-Output "task '$name' is not currently registered; it will be created"
  }

  $action = New-ScheduledTaskAction -Execute $powershell `
    -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"{0}`"" -f $spec.Script)

  # Both triggers: the login path the operator already relies on, and the recovery path that did not
  # exist. Repetition is the whole point -- without it a dead cockpit waits for a human.
  $interval = if ($spec.IntervalMinutes) { [int]$spec.IntervalMinutes } else { $HealthIntervalMinutes }
  $triggers = @(
    (New-ScheduledTaskTrigger -AtLogOn),
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) `
      -RepetitionInterval (New-TimeSpan -Minutes $interval) `
      -RepetitionDuration (New-TimeSpan -Days 3650))
  )

  # Unlimited by default: the launcher supervises a served port and must not be killed on a timer,
  # so the limit is opt-in per declaration rather than a blanket setting for every task.
  $execLimit = if ($spec.ExecTimeLimitMinutes) { New-TimeSpan -Minutes ([int]$spec.ExecTimeLimitMinutes) } else { [TimeSpan]::Zero }

  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit $execLimit `
    -MultipleInstances IgnoreNew
  # Set through the nested object: the idle setting lives on IdleSettings, not on Settings, and a
  # top-level assignment silently does nothing.
  $settings.IdleSettings.StopOnIdleEnd = $false

  # Reuse the identity the task is already proven to run under. Constructing one from the ambient
  # environment is wrong here: a remote/ssh session does not necessarily carry USERDOMAIN/USERNAME,
  # and the scheduler rejects an unresolvable name outright.
  if ($existing -and $existing.Principal -and $existing.Principal.UserId) {
    $userId = $existing.Principal.UserId
  } else {
    $userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  }
  $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

  if ($WhatIfOnly) {
    Write-Output ("WOULD DECLARE '{0}': action={1} triggers={2} restart=3x1m idle-stop=false runLevel=Limited" -f $name, $spec.Script, $triggers.Count)
    continue
  }

  Register-ScheduledTask -TaskPath "\" -TaskName $name -Action $action -Trigger $triggers `
    -Settings $settings -Principal $principal -Force | Out-Null
  Write-Output ("declared '{0}' -> {1} ({2})" -f $name, $spec.Script, $spec.Reason)
}

# Read the declaration back rather than trusting the registration call.
Write-Output "--- verification (read back from the scheduler) ---"
foreach ($name in $TaskName) {
  $task = Get-ScheduledTask -TaskPath "\" -TaskName $name -ErrorAction SilentlyContinue
  if (-not $task) { Write-Output ("  {0}: ABSENT" -f $name); continue }
  $triggerKinds = ($task.Triggers | ForEach-Object { $_.CimClass.CimClassName -replace "MSFT_Task", "" }) -join ","
  $repeat = ($task.Triggers | Where-Object { $_.Repetition -and $_.Repetition.Interval } | ForEach-Object { $_.Repetition.Interval }) -join ","
  Write-Output ("  {0}: triggers={1} repetition={2} restartCount={3} restartInterval={4} idleStop={5} multi={6} runLevel={7} logonType={8} execLimit={9}" -f `
    $name, $triggerKinds, $repeat, $task.Settings.RestartCount, $task.Settings.RestartInterval, `
    $task.Settings.IdleSettings.StopOnIdleEnd, $task.Settings.MultipleInstances, `
    $task.Principal.RunLevel, $task.Principal.LogonType, $task.Settings.ExecutionTimeLimit)
}

if ($Start) {
  foreach ($name in $TaskName) {
    try { Start-ScheduledTask -TaskPath "\" -TaskName $name; Write-Output "started $name" }
    catch { Write-Output "start failed for ${name}: $($_.Exception.Message)" }
  }
}