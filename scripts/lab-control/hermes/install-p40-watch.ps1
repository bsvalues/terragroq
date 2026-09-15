# Install the continuous P40 thermal watcher as a SYSTEM startup task. RUN ELEVATED.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\HermesLab\hermes\install-p40-watch.ps1
#
# WHY A SECOND, CONTINUOUS TASK
# HermesP40Guard runs hourly. That is fine for asserting the power cap and for spotting a slow
# airflow regression, but it cannot protect the card during a fast thermal event: a fan that stops
# at 09:05 is discovered at 10:00, by which time the event is over one way or the other. The
# EMERGENCY band is meaningless on an hourly sampler. This task is what makes it real.
#
# The hourly task is deliberately KEPT as an independent backstop. If the watcher dies and its
# restart also fails, the hourly pass still asserts the cap and still records history, so the two
# failure modes are not correlated.
#
# Self-healing: Task Scheduler restarts the watcher if the process exits, because a safety layer
# that silently stops being there is worse than one that was never installed.
[CmdletBinding()]
param(
  [switch]$Uninstall,
  [int]$IntervalS = 30,
  [string]$GuardPath = 'C:\ProgramData\Hermes\runtime\p40-guard.ps1',
  [string]$StateRoot = 'C:\ProgramData\Hermes\p40'
)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$TaskName = 'HermesP40Watch'

if(-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
  Write-Host 'Must run ELEVATED. Nothing changed.' -ForegroundColor Red; exit 2
}

if($Uninstall){
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -match 'p40-guard\.ps1.*-Watch' } |
    ForEach-Object { & taskkill /PID $_.ProcessId /T /F 2>&1 | Out-Null }
  Write-Host "removed $TaskName"
  exit 0
}

$guard = $GuardPath
if(-not (Test-Path -LiteralPath $guard -PathType Leaf)){ throw "missing $guard" }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"{0}`" -Watch -WatchIntervalS {1} -Quiet -StateRoot `"{2}`"" -f $guard,$IntervalS,$StateRoot)

# ExecutionTimeLimit Zero: this task IS the watcher, it is meant to run forever.
# RestartCount/Interval: if it dies, bring it back rather than losing the safety layer silently.
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
  -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1)

$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $action `
  -Trigger (New-ScheduledTaskTrigger -AtStartup) -Principal $principal -Settings $settings `
  -Description "Continuous load-aware P40 thermal watcher (${IntervalS}s); sheds workload at the EMERGENCY band" `
  -Force | Out-Null

# Read the registration back rather than trusting that it returned without error -- and note that an
# unelevated session will NOT be able to see this task afterwards (its ACL excludes non-admins),
# which is why verification is done here, in the context that can actually look.
$got = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if(-not $got){ Write-Host "  $TaskName did NOT register." -ForegroundColor Red; exit 2 }
Write-Host ("  {0} : registered (AtStartup, SYSTEM, every {1}s, restart-on-failure)" -f $TaskName,$IntervalS)

$beat = Join-Path $StateRoot 'p40-watch.heartbeat'
if(Test-Path $beat){ Remove-Item $beat -Force }

Start-ScheduledTask -TaskName $TaskName
Write-Host '  started; waiting for the first heartbeat...'
$deadline = (Get-Date).AddSeconds(120)
while((Get-Date) -lt $deadline){
  if(Test-Path $beat){
    $j = Get-Content $beat -Raw | ConvertFrom-Json
    Write-Host ("  HEARTBEAT: {0}  {1}C @ {2} load, cap {3} W, overall {4}" -f `
      $j.ts,$j.temp_c,$j.load_class,$j.power_limit_w,$j.overall.ToUpper())
    Write-Host ''
    Write-Host 'Installed and confirmed live.'
    Write-Host 'Verify any time from an UNELEVATED shell with the heartbeat, not the task list:'
    Write-Host "  Get-Content $beat"
    exit 0
  }
  Start-Sleep -Seconds 2
}
Write-Host '  no heartbeat within 120s -- the watcher registered but is not publishing state.' -ForegroundColor Red
exit 2
