<#
.SYNOPSIS
  Install and verify the repository-owned WilliamOS HTTPS launcher and scheduled task on HERMES.

.DESCRIPTION
  Captures the outgoing task XML and launcher before changing either. The task remains an
  interactive, limited task for the current HERMES owner account, matching the existing product
  boundary; this repair changes supervision, not privileges or network policy.
#>
[CmdletBinding()]
param(
  [string]$Source,
  [string]$InstallRoot = "C:\ProgramData\WilliamOS",
  [string]$TaskName = "WilliamOS HTTPS",
  [int]$HttpsPort = 3443,
  [switch]$VerifyOnly
)

$ErrorActionPreference = "Stop"
if ($HttpsPort -ne 3443) {
  throw "WilliamOS HERMES uses the canonical HTTPS port 3443; port overrides are not supported"
}
if (-not $Source) { $Source = Split-Path -Parent $PSScriptRoot }

$launcherSource = Join-Path $Source "deploy\hermes\williamos-https\start-williamos-https.ps1"
$launcherTarget = Join-Path $InstallRoot "start-williamos-https.ps1"
$appRoot = "C:\HermesLab\williamos-runtime-64034e93-flat"
$proxyTarget = Join-Path $appRoot "scripts\hermes-https-proxy.mjs"
$healthUri = "https://192.168.88.9:$HttpsPort/api/health"

function Wait-HttpsHealthy {
  param([int]$TimeoutSeconds = 60)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $healthUri -UseBasicParsing -TimeoutSec 10
      if ($response.StatusCode -eq 200) { return $true }
    } catch {
      Start-Sleep -Seconds 3
    }
  }
  return $false
}

function Assert-InstalledSupervisor {
  foreach ($required in @($launcherTarget, $proxyTarget)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Missing installed WilliamOS HTTPS file: $required" }
  }
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  if ($task.Actions.Execute -ne "powershell.exe" -or $task.Actions.Arguments -notlike "*$launcherTarget*") {
    throw "The $TaskName action does not invoke the repository-owned launcher at $launcherTarget"
  }
  if ($task.Principal.RunLevel -ne "Limited") { throw "$TaskName unexpectedly has elevated privileges" }
  if (-not $task.Settings.StartWhenAvailable) { throw "$TaskName is not configured to start when available" }
  if ($task.State -ne "Running") { throw "$TaskName is $($task.State), not Running" }
  if (-not (Wait-HttpsHealthy)) { throw "$healthUri did not become healthy" }
  Write-Output "verified: $TaskName is Running and $healthUri answers 200"
}

function Assert-SupervisedLifecycle {
  Stop-ScheduledTask -TaskName $TaskName
  $deadline = (Get-Date).AddSeconds(15)
  do {
    $listener = Get-NetTCPConnection -LocalPort $HttpsPort -State Listen -ErrorAction SilentlyContinue
    if (-not $listener) { break }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  if ($listener) {
    throw "$TaskName stopped but port $HttpsPort remained open; the proxy is still orphaning from its supervisor"
  }
  Start-ScheduledTask -TaskName $TaskName
  Assert-InstalledSupervisor
  Write-Output "verified lifecycle: stopping the task closes port $HttpsPort and restarting restores health"
}

if ($VerifyOnly) {
  Assert-InstalledSupervisor
  exit 0
}

foreach ($required in @($launcherSource, $proxyTarget)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Refusing install: required file is missing: $required" }
}

$backupRoot = Join-Path $InstallRoot ("rollback\https-supervisor-{0}" -f [DateTime]::UtcNow.ToString("yyyyMMddTHHmmssZ"))
$null = New-Item -ItemType Directory -Path $backupRoot -Force
$oldTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$oldTaskWasRunning = $null -ne $oldTask -and $oldTask.State -eq "Running"
if ($oldTask) {
  Export-ScheduledTask -TaskName $TaskName | Out-File -LiteralPath (Join-Path $backupRoot "task.xml") -Encoding unicode
}
[ordered]@{
  taskWasPresent = $null -ne $oldTask
  taskWasRunning = $oldTaskWasRunning
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backupRoot "task-state.json") -Encoding utf8
if (Test-Path -LiteralPath $launcherTarget) {
  Copy-Item -LiteralPath $launcherTarget -Destination (Join-Path $backupRoot "start-williamos-https.ps1") -Force
}
Write-Output "rollback captured: $backupRoot"

try {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Get-NetTCPConnection -LocalPort $HttpsPort -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)"
      if ($process.CommandLine -notlike "*$proxyTarget*") {
        throw "Port $HttpsPort is owned by an unrelated process $($process.ProcessId); refusing to stop it"
      }
      Stop-Process -Id $process.ProcessId -Force
    }

  $null = New-Item -ItemType Directory -Path $InstallRoot -Force
  Copy-Item -LiteralPath $launcherSource -Destination $launcherTarget -Force

  $userId = "$env:USERDOMAIN\$env:USERNAME"
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$launcherTarget`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
  $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  Assert-InstalledSupervisor
  Assert-SupervisedLifecycle
} catch {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Get-NetTCPConnection -LocalPort $HttpsPort -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)"
      if ($process -and $process.CommandLine -like "*$proxyTarget*") {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
      }
    }
  if (Test-Path -LiteralPath (Join-Path $backupRoot "start-williamos-https.ps1")) {
    Copy-Item -LiteralPath (Join-Path $backupRoot "start-williamos-https.ps1") -Destination $launcherTarget -Force
  } elseif (Test-Path -LiteralPath $launcherTarget) {
    Remove-Item -LiteralPath $launcherTarget -Force
  }
  if (Test-Path -LiteralPath (Join-Path $backupRoot "task.xml")) {
    Register-ScheduledTask -TaskName $TaskName -Xml (Get-Content -LiteralPath (Join-Path $backupRoot "task.xml") -Raw) -Force | Out-Null
    if ($oldTaskWasRunning) { Start-ScheduledTask -TaskName $TaskName }
  } else {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  }
  throw
}

Write-Output "installed and verified; rollback: restore task.xml and start-williamos-https.ps1 from $backupRoot"
