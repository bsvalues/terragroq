[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$SourceRoot,
  [Parameter(Mandatory=$true)][string]$ExpectedCommit,
  [string]$EvidenceRoot = 'G:\lab-backups\hermes-appliance-releases',
  [switch]$PlanOnly
)
# Bounded appliance file rollout. No WilliamOS application, firewall, doctrine baseline,
# Docker volume, credential, model or scheduled-task definition is replaced.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$SourceRoot = [IO.Path]::GetFullPath($SourceRoot)
$head = (& git -C $SourceRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $head -ne $ExpectedCommit) { throw 'APPLIANCE_SOURCE_REVISION_MISMATCH' }
$dirty = & git -C $SourceRoot status --porcelain --untracked-files=no
if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'APPLIANCE_SOURCE_DIRTY' }
$relativeFiles = @(
 'README.md','SERVICE-MAP.md','hermes/HERMES-COMMISSIONED.md',
 'hermes/backup-volumes.ps1','hermes/crossnode-sync.ps1','hermes/crossnode-sync-lib.ps1',
 'hermes/verify-offhost-restore.ps1','hermes/docker-compose.yml','hermes/lab-health.ps1',
 'hermes/p40-guard.ps1','hermes/install-p40-watch.ps1','hermes/start-hermes.ps1',
 'hermes/hermes-placement-readiness.ps1','hermes/hermes-acceptance.ps1',
 'hermes/verify-durability-after-reboot.ps1','hermes/sync-models-to-forge.ps1',
 'hermes/test-crossnode-sync-receipt.ps1','hermes/morning-report.ps1',
 'hermes/terrafusion-report.ps1','hermes/send-hermes-alert.ps1',
 'hermes/ollama-service/hermes-ollama-service.ps1',
 'hermes/ollama-service/install-hermes-ollama-service.ps1',
 'hermes/doctrine/collect-hermes-doctrine-observation.ps1',
 'hermes/doctrine/evaluate-hermes-doctrine.mjs','hermes/doctrine/mint-hermes-doctrine.mjs',
 'hermes/doctrine/normalize-hermes-observation.mjs','hermes/doctrine/run-hermes-doctrine.ps1',
 'hermes/console/server.mjs','hermes/console/collect-hermes-console-status.ps1',
 'hermes/console/lib/status-contract.mjs','hermes/console/public/app.js',
 'hermes/console/public/index.html','hermes/console/public/styles.css','hermes/console/README.md',
 'hermes/deploy-hermes-appliance.ps1'
)
$plan = @()
$inferenceChanged = $false
$ownerRestartAttempted = $false
foreach ($relative in $relativeFiles) {
  $source = Join-Path $SourceRoot ('scripts/lab-control/' + $relative)
  & git -C $SourceRoot ls-files --error-unmatch -- ('scripts/lab-control/' + $relative) | Out-Null
  if($LASTEXITCODE -ne 0) {throw "UNTRACKED_SOURCE $relative"}
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "MISSING_SOURCE $relative" }
  $targets = @(Join-Path 'C:\HermesLab' $relative)
  if ($relative.StartsWith('hermes/console/')) {
    $targets += Join-Path 'C:\ProgramData\Hermes\console' $relative.Substring('hermes/console/'.Length)
  }
  foreach ($target in $targets) {
    $parent = Split-Path -Parent $target
    while ($parent) {
      if ((Test-Path -LiteralPath $parent) -and ((Get-Item -LiteralPath $parent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "REPARSE_TARGET $parent" }
      $parent = Split-Path -Parent $parent
    }
    if ((Test-Path -LiteralPath $target) -and ((Get-Item -LiteralPath $target -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "REPARSE_TARGET $target" }
    $plan += [pscustomobject]@{ source=$source; target=$target; sha256=(Get-FileHash -LiteralPath $source).Hash; existed=(Test-Path -LiteralPath $target) }
    if($relative -eq 'hermes/ollama-service/hermes-ollama-service.ps1') {
      $inferenceChanged = -not (Test-Path -LiteralPath $target) -or (Get-FileHash -LiteralPath $source).Hash -ne (Get-FileHash -LiteralPath $target).Hash
    }
  }
}
if ($PlanOnly) { $plan | Select-Object target,sha256 | ConvertTo-Json; return }
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'APPLIANCE_DEPLOY_REQUIRES_WINDOWS_ELEVATION' }
$release = Join-Path $EvidenceRoot ((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '-' + $head.Substring(0,12))
New-Item -ItemType Directory -Path $release -Force | Out-Null
$receipt = [ordered]@{schema='hermes-appliance-release/1';commit=$head;startedAt=[DateTime]::UtcNow.ToString('o');status='STARTED';files=$plan}
$receiptPath = Join-Path $release 'release.json'
function Save-Receipt { $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptPath -Encoding UTF8 }
function Restart-InferenceOwner {
  $owner=Get-Content -LiteralPath 'C:\ProgramData\Hermes\inference\current-owner.json' -Raw | ConvertFrom-Json
  if($owner.owner -ne 'WilliamOS-HERMES-Ollama' -or $owner.executable -ne 'D:\HermesServices\ollama\v0.9.2\ollama.exe') {throw 'UNEXPECTED_INFERENCE_OWNER'}
  $serving=Get-CimInstance Win32_Process -Filter "ProcessId=$($owner.pid)"
  if($serving -and $serving.ExecutablePath -ne $owner.executable) {throw 'INFERENCE_PID_REUSED'}
  Stop-ScheduledTask -TaskName 'WilliamOS-HERMES-Ollama'
  if($serving) {
    $remaining=Get-CimInstance Win32_Process -Filter "ProcessId=$($owner.pid)"
    if($remaining -and $remaining.ExecutablePath -eq $owner.executable) {Stop-Process -Id $remaining.ProcessId -Force}
  }
  Start-ScheduledTask -TaskName 'WilliamOS-HERMES-Ollama'
  for($i=0;$i -lt 60;$i++) {
    try {
      $fresh=Get-Content -LiteralPath 'C:\ProgramData\Hermes\inference\current-owner.json' -Raw | ConvertFrom-Json
      $tags=Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3
      if($fresh.state -eq 'SERVING' -and $fresh.pid -ne $owner.pid -and $tags.models.Count -ge 1 -and ([DateTime]::UtcNow-([datetime]$fresh.observedAt).ToUniversalTime()).TotalSeconds -lt 120) {return}
    } catch {}
    Start-Sleep -Seconds 1
  }
  throw 'INFERENCE_RESTART_FAILED'
}
Save-Receipt
$index=0
foreach ($entry in $plan) {
  $entry | Add-Member -NotePropertyName backup -NotePropertyValue (Join-Path $release ("$index.before"))
  if ($entry.existed) { Copy-Item -LiteralPath $entry.target -Destination $entry.backup; if ((Get-FileHash $entry.target).Hash -ne (Get-FileHash $entry.backup).Hash) { throw 'ROLLBACK_COPY_MISMATCH' } }
  $index++
}
Save-Receipt
$consoleTask = Get-ScheduledTask -TaskName 'HermesConsole'
$collectorTask = Get-ScheduledTask -TaskName 'HermesConsoleStatus'
if ($consoleTask.Actions.WorkingDirectory -ne 'C:\ProgramData\Hermes\console') { throw 'UNEXPECTED_CONSOLE_TASK' }
try {
  Stop-ScheduledTask -TaskName 'HermesConsole'
  Stop-ScheduledTask -TaskName 'HermesConsoleStatus'
  foreach ($entry in $plan) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $entry.target) -Force | Out-Null
    Copy-Item -LiteralPath $entry.source -Destination $entry.target -Force
    if ((Get-FileHash -LiteralPath $entry.target).Hash -ne $entry.sha256) { throw "INSTALLED_HASH_MISMATCH $($entry.target)" }
  }
  if($inferenceChanged) {$ownerRestartAttempted=$true;Restart-InferenceOwner}
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\ProgramData\Hermes\console\collect-hermes-console-status.ps1' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'COLLECTOR_FAILED' }
  Start-ScheduledTask -TaskName 'HermesConsole'
  $ready=$false
  for($i=0;$i -lt 15;$i++) {
    try { $status=Invoke-RestMethod 'http://127.0.0.1:3210/api/status' -TimeoutSec 3; if($status.schema -eq 'hermes-console-status/1' -and $status.authorityState -eq 'UNAVAILABLE') {$ready=$true;break} } catch {}
    Start-Sleep -Seconds 1
  }
  if(-not $ready) {throw 'CONSOLE_RESTART_FAILED'}
  Start-ScheduledTask -TaskName 'HermesConsoleStatus'
  Start-ScheduledTask -TaskName 'HermesDoctrineCheck'
  $receipt.status='DEPLOYED';$receipt.completedAt=[DateTime]::UtcNow.ToString('o');Save-Receipt
  Write-Output "APPLIANCE_DEPLOYED commit=$head files=$($plan.Count) receipt=$receiptPath"
} catch {
  $failure=$_.Exception.Message
  $rollbackErrors=@()
  Stop-ScheduledTask -TaskName 'HermesConsole' -ErrorAction SilentlyContinue
  foreach($entry in $plan) {
    try {
      if($entry.existed) {Copy-Item -LiteralPath $entry.backup -Destination $entry.target -Force}
      elseif(Test-Path -LiteralPath $entry.target -PathType Leaf) {Remove-Item -LiteralPath $entry.target -Force}
    } catch {$rollbackErrors += $_.Exception.Message}
  }
  if($ownerRestartAttempted) {try {Restart-InferenceOwner} catch {$rollbackErrors += $_.Exception.Message}}
  foreach($task in @('HermesConsole','HermesConsoleStatus')) {try {Start-ScheduledTask -TaskName $task} catch {$rollbackErrors += $_.Exception.Message}}
  $receipt.status=if($rollbackErrors.Count){'ROLLBACK_INCOMPLETE'}else{'ROLLED_BACK'}
  $receipt.failure=$failure;$receipt.rollbackErrors=$rollbackErrors;Save-Receipt
  throw "APPLIANCE_DEPLOY_$($receipt.status) $failure"
}
