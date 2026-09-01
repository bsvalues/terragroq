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
  [switch]$VerifyOnly,
  [string]$RestoreFrom
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

function ConvertTo-PowerShellLiteral {
  param([string]$Value)
  return "'{0}'" -f $Value.Replace("'", "''")
}

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

function Get-TaskFileArgument {
  param([string]$Arguments)
  if (-not $Arguments) { return $null }
  $matches = [regex]::Matches($Arguments, '(?i)(?:^|\s)-File\s+(?:"([^"]+)"|''([^'']+)''|(\S+))(?=\s|$)')
  if ($matches.Count -ne 1) { return $null }
  return @($matches[0].Groups[1].Value, $matches[0].Groups[2].Value, $matches[0].Groups[3].Value) |
    Where-Object { $_ } | Select-Object -First 1
}

function Test-CommandLineHasExactPath {
  param([string]$CommandLine, [string]$ExpectedPath)
  if (-not $CommandLine) { return $false }
  $normalizedExpected = [IO.Path]::GetFullPath($ExpectedPath).TrimEnd('\')
  $tokens = @([regex]::Matches($CommandLine, '(?:"([^"]*)"|''([^'']*)''|(\S+))') | ForEach-Object {
    @($_.Groups[1].Value, $_.Groups[2].Value, $_.Groups[3].Value) |
      Where-Object { $_ } | Select-Object -First 1
  })
  if ($tokens.Count -lt 2 -or [IO.Path]::GetFileName($tokens[0]) -ine "node.exe") { return $false }
  try {
    return [IO.Path]::GetFullPath($tokens[1]).TrimEnd('\') -ieq $normalizedExpected
  } catch {
    return $false
  }
}

function Assert-InstalledSupervisor {
  foreach ($required in @($launcherTarget, $proxyTarget)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Missing installed WilliamOS HTTPS file: $required" }
  }
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  $actions = @($task.Actions)
  $taskFile = if ($actions.Count -eq 1) { Get-TaskFileArgument -Arguments $actions[0].Arguments } else { $null }
  $expectedLauncher = [IO.Path]::GetFullPath($launcherTarget).TrimEnd('\')
  $actualLauncher = if ($taskFile) { [IO.Path]::GetFullPath($taskFile).TrimEnd('\') } else { $null }
  if ($actions.Count -ne 1 -or [IO.Path]::GetFileName($actions[0].Execute) -ine "powershell.exe" -or $actualLauncher -ine $expectedLauncher) {
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

if ($RestoreFrom) {
  $resolvedInstallRoot = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
  $resolvedRollbackRoot = [IO.Path]::GetFullPath($RestoreFrom).TrimEnd('\')
  $rollbackParent = [IO.Path]::GetFullPath((Join-Path $resolvedInstallRoot "rollback")).TrimEnd('\') + '\'
  if (-not $resolvedRollbackRoot.StartsWith($rollbackParent, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing HTTPS supervisor restore outside $rollbackParent"
  }

  $statePath = Join-Path $resolvedRollbackRoot "task-state.json"
  if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
    throw "HTTPS supervisor rollback state is missing: $statePath"
  }
  $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  foreach ($property in @("taskWasPresent", "taskWasRunning", "launcherWasPresent")) {
    if ($state.psobject.Properties.Name -notcontains $property -or $state.$property -isnot [bool]) {
      throw "HTTPS supervisor rollback state has no valid $property boolean"
    }
  }

  $taskBackup = Join-Path $resolvedRollbackRoot "task.xml"
  $launcherBackup = Join-Path $resolvedRollbackRoot "start-williamos-https.ps1"
  if ($state.taskWasPresent -and -not (Test-Path -LiteralPath $taskBackup -PathType Leaf)) {
    throw "HTTPS supervisor rollback requires the captured task XML: $taskBackup"
  }
  if ($state.launcherWasPresent -and -not (Test-Path -LiteralPath $launcherBackup -PathType Leaf)) {
    throw "HTTPS supervisor rollback requires the captured launcher: $launcherBackup"
  }

  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Get-NetTCPConnection -LocalPort $HttpsPort -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)"
      if (-not $process -or -not (Test-CommandLineHasExactPath -CommandLine $process.CommandLine -ExpectedPath $proxyTarget)) {
        throw "Port $HttpsPort is owned by an unrelated process $($process.ProcessId); refusing to stop it"
      }
      Stop-Process -Id $process.ProcessId -Force
    }

  if ($state.launcherWasPresent) {
    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $launcherTarget) -Force
    Copy-Item -LiteralPath $launcherBackup -Destination $launcherTarget -Force
  } else {
    Remove-Item -LiteralPath $launcherTarget -Force -ErrorAction SilentlyContinue
  }

  if ($state.taskWasPresent) {
    Register-ScheduledTask -TaskName $TaskName -Xml (Get-Content -LiteralPath $taskBackup -Raw) -Force | Out-Null
    if ($state.taskWasRunning) {
      Start-ScheduledTask -TaskName $TaskName
    }
  } else {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  }

  $restoredTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (($null -ne $restoredTask) -ne $state.taskWasPresent) {
    throw "HTTPS supervisor task presence did not return to its captured state"
  }
  if ((Test-Path -LiteralPath $launcherTarget -PathType Leaf) -ne $state.launcherWasPresent) {
    throw "HTTPS supervisor launcher presence did not return to its captured state"
  }
  if ($state.taskWasRunning) {
    $deadline = (Get-Date).AddSeconds(15)
    do {
      $restoredTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
      if ($restoredTask.State -eq "Running") { break }
      Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    if ($restoredTask.State -ne "Running") {
      throw "The restored $TaskName did not return to its captured Running state"
    }
  }

  Write-Output "restored HTTPS supervisor state from $resolvedRollbackRoot"
  exit 0
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
$oldLauncherWasPresent = Test-Path -LiteralPath $launcherTarget -PathType Leaf
if ($oldTask) {
  Export-ScheduledTask -TaskName $TaskName | Out-File -LiteralPath (Join-Path $backupRoot "task.xml") -Encoding unicode
}
[ordered]@{
  taskWasPresent = $null -ne $oldTask
  taskWasRunning = $oldTaskWasRunning
  launcherWasPresent = $oldLauncherWasPresent
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
      if (-not $process -or -not (Test-CommandLineHasExactPath -CommandLine $process.CommandLine -ExpectedPath $proxyTarget)) {
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
      if ($process -and (Test-CommandLineHasExactPath -CommandLine $process.CommandLine -ExpectedPath $proxyTarget)) {
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

$scriptLiteral = ConvertTo-PowerShellLiteral $PSCommandPath
$installRootLiteral = ConvertTo-PowerShellLiteral $InstallRoot
$taskNameLiteral = ConvertTo-PowerShellLiteral $TaskName
$httpsPortLiteral = ConvertTo-PowerShellLiteral ([string]$HttpsPort)
$backupRootLiteral = ConvertTo-PowerShellLiteral $backupRoot
Write-Output "installed and verified; rollback: powershell -NoProfile -ExecutionPolicy Bypass -File $scriptLiteral -InstallRoot $installRootLiteral -TaskName $taskNameLiteral -HttpsPort $httpsPortLiteral -RestoreFrom $backupRootLiteral"
