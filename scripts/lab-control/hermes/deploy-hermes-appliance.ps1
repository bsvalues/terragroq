[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$SourceRoot,
  [Parameter(Mandatory=$true)][string]$ExpectedCommit,
  [string]$ProtectedRollbackRoot = 'C:\ProgramData\Hermes\release-rollback',
  [string]$ProtectedRuntimeRoot = 'C:\ProgramData\Hermes\runtime',
  [switch]$PlanOnly
)
# Bounded appliance rollout. No WilliamOS application, firewall, doctrine baseline, Docker volume,
# credential or model is replaced. Existing HERMES SYSTEM tasks are rebound to the same scripts in
# the protected runtime projection; their exact prior XML is sealed for rollback.
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
 'hermes/ollama-service/diagnose-hermes-ollama-ownership.ps1',
 'hermes/ollama-service/bind-hermes-ollama-ownership.v1.mjs',
 'hermes/ollama-service/stage-hermes-ollama-ownership.v1.ps1',
 'hermes/host-attestation/collect-hermes-host-attestation.v1.ps1',
 'hermes/host-attestation/bind-hermes-host-attestation.v1.mjs',
 'hermes/host-attestation/stage-hermes-host-attestation.v1.ps1',
 'hermes/doctrine/collect-hermes-doctrine-observation.ps1',
 'hermes/doctrine/evaluate-hermes-doctrine.mjs','hermes/doctrine/mint-hermes-doctrine.mjs',
 'hermes/doctrine/normalize-hermes-observation.mjs','hermes/doctrine/run-hermes-doctrine.ps1',
 'hermes/console/server.mjs','hermes/console/collect-hermes-console-status.ps1',
 'hermes/console/lib/status-contract.mjs','hermes/console/public/app.js',
 'hermes/console/public/index.html','hermes/console/public/styles.css','hermes/console/README.md',
 'hermes/deploy-hermes-appliance.ps1'
)
$privilegedRuntimeFiles = @(
  'hermes/crossnode-sync-lib.ps1','hermes/lab-health.ps1','hermes/p40-guard.ps1',
  'hermes/send-hermes-alert.ps1','hermes/ollama-service/hermes-ollama-service.ps1',
  'hermes/doctrine/collect-hermes-doctrine-observation.ps1',
  'hermes/doctrine/evaluate-hermes-doctrine.mjs','hermes/doctrine/normalize-hermes-observation.mjs',
  'hermes/doctrine/run-hermes-doctrine.ps1'
)
$privilegedTaskScripts = [ordered]@{
  'HermesLabHealth' = 'hermes/lab-health.ps1'
  'HermesP40Guard' = 'hermes/p40-guard.ps1'
  'HermesP40Watch' = 'hermes/p40-guard.ps1'
  'HermesDoctrineCheck' = 'hermes/doctrine/run-hermes-doctrine.ps1'
  'WilliamOS-HERMES-Ollama' = 'hermes/ollama-service/hermes-ollama-service.ps1'
}
$legacyStateImports = @(
  [pscustomobject]@{name='native-alert-history';source='C:\HermesLab\hermes\alerts.log';target='C:\ProgramData\Hermes\health\alerts.log'},
  [pscustomobject]@{name='native-health-history';source='C:\HermesLab\hermes\health-history.jsonl';target='C:\ProgramData\Hermes\health\health-history.jsonl'}
)
$protectedDirectoryState = @(
  [pscustomobject]@{path='C:\ProgramData\Hermes\runtime';existed=$false;sddl=$null},
  [pscustomobject]@{path='C:\ProgramData\Hermes\health';existed=$false;sddl=$null}
)
$plan = @()
$ownerRestartAttempted = $false
$composeChanged = $false
$composeApplyAttempted = $false
$composeImagePins = $null
$composePinnedImages = [ordered]@{}
foreach ($relative in $relativeFiles) {
  $source = Join-Path $SourceRoot ('scripts/lab-control/' + $relative)
  & git -C $SourceRoot ls-files --error-unmatch -- ('scripts/lab-control/' + $relative) | Out-Null
  if($LASTEXITCODE -ne 0) {throw "UNTRACKED_SOURCE $relative"}
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "MISSING_SOURCE $relative" }
  $targets = @(Join-Path 'C:\HermesLab' $relative)
  if ($relative.StartsWith('hermes/console/')) {
    $targets += Join-Path 'C:\ProgramData\Hermes\console' $relative.Substring('hermes/console/'.Length)
  }
  if ($privilegedRuntimeFiles -contains $relative) {
    $targets += Join-Path $ProtectedRuntimeRoot $relative.Substring('hermes/'.Length)
  }
  foreach ($target in $targets) {
    $parent = Split-Path -Parent $target
    while ($parent) {
      if ((Test-Path -LiteralPath $parent) -and ((Get-Item -LiteralPath $parent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "REPARSE_TARGET $parent" }
      $parent = Split-Path -Parent $parent
    }
    if ((Test-Path -LiteralPath $target) -and ((Get-Item -LiteralPath $target -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "REPARSE_TARGET $target" }
    $plan += [pscustomobject]@{ relative=$relative; source=$source; target=$target; sha256=(Get-FileHash -LiteralPath $source).Hash; existed=(Test-Path -LiteralPath $target) }
    if($relative -eq 'hermes/docker-compose.yml') {
      if(-not (Test-Path -LiteralPath $target) -or (Get-FileHash -LiteralPath $source).Hash -ne (Get-FileHash -LiteralPath $target).Hash){$composeChanged=$true}
    }
  }
}
if ($PlanOnly) { $plan | Select-Object target,sha256 | ConvertTo-Json; return }
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'APPLIANCE_DEPLOY_REQUIRES_WINDOWS_ELEVATION' }
$canonicalRollbackRoot = 'C:\ProgramData\Hermes\release-rollback'
$canonicalRuntimeRoot = 'C:\ProgramData\Hermes\runtime'
if([IO.Path]::GetFullPath($ProtectedRollbackRoot).TrimEnd('\') -ine $canonicalRollbackRoot -or [IO.Path]::GetFullPath($ProtectedRuntimeRoot).TrimEnd('\') -ine $canonicalRuntimeRoot){throw 'PROTECTED_ROOT_OVERRIDE_REFUSED'}
$releaseId = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '-' + $head.Substring(0,12)
if((Test-Path -LiteralPath $ProtectedRollbackRoot) -and ((Get-Item -LiteralPath $ProtectedRollbackRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw "REPARSE_RELEASE_ROOT $ProtectedRollbackRoot"}
New-Item -ItemType Directory -Path $ProtectedRollbackRoot -Force | Out-Null
$release = Join-Path $ProtectedRollbackRoot $releaseId
if(Test-Path -LiteralPath $release){throw 'ROLLBACK_RELEASE_ALREADY_EXISTS'}
New-Item -ItemType Directory -Path $release | Out-Null
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
$inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
$propagate = [Security.AccessControl.PropagationFlags]::None
foreach($identity in @('NT AUTHORITY\SYSTEM','BUILTIN\Administrators')) {
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl',$inherit,$propagate,'Allow')))
}
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('BUILTIN\Users','ReadAndExecute',$inherit,$propagate,'Allow')))
Set-Acl -LiteralPath $release -AclObject $acl
$receipt = [ordered]@{schema='hermes-appliance-release/2';commit=$head;startedAt=[DateTime]::UtcNow.ToString('o');status='STARTED';files=$plan;legacyStateImports=@()}
$receiptPath = Join-Path $release 'release.json'
function Save-Receipt {
  $json = $receipt | ConvertTo-Json -Depth 8
  $temporary=Join-Path $release ('.release.'+[guid]::NewGuid().ToString('n')+'.tmp')
  try {
    [IO.File]::WriteAllText($temporary,($json+"`n"),[Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $receiptPath -Force -ErrorAction Stop
  } finally {Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue}
}
function Invoke-Compose([string]$Action) {
  $composePath = 'C:\HermesLab\hermes\docker-compose.yml'
  $composeArguments=@('compose','-f',$composePath)
  if($composeImagePins){$composeArguments+=@('-f',$composeImagePins)}
  if($Action -eq 'validate') { & docker @composeArguments config --quiet }
  elseif($Action -eq 'apply') { & docker @composeArguments up -d }
  else { throw "UNKNOWN_COMPOSE_ACTION $Action" }
  if($LASTEXITCODE -ne 0){throw "DOCKER_COMPOSE_$($Action.ToUpperInvariant())_FAILED exit=$LASTEXITCODE"}
}
function Assert-ComposeImages {
  foreach($service in $composePinnedImages.Keys){
    $containerIds=@(& docker compose -f 'C:\HermesLab\hermes\docker-compose.yml' ps -q $service 2>$null)
    if($LASTEXITCODE -ne 0 -or $containerIds.Count -ne 1){throw "DOCKER_COMPOSE_CONTAINER_CARDINALITY service=$service"}
    $actualImage=[string](& docker inspect --format '{{.Image}}' $containerIds[0] 2>$null)
    if($LASTEXITCODE -ne 0 -or $actualImage.Trim() -ine [string]$composePinnedImages[$service]){throw "DOCKER_COMPOSE_IMAGE_DRIFT service=$service"}
  }
}
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
try {
  $index=0
  foreach ($entry in $plan) {
    # Never install directly from the medium-user-writable worktree. Seal the exact reviewed
    # bytes into the protected release first, verify them there, and use only that sealed copy.
    $entry | Add-Member -NotePropertyName staged -NotePropertyValue (Join-Path $release ("$index.after"))
    Copy-Item -LiteralPath $entry.source -Destination $entry.staged
    if ((Get-FileHash -LiteralPath $entry.staged).Hash -ne $entry.sha256) { throw 'STAGED_SOURCE_HASH_MISMATCH' }
    $entry | Add-Member -NotePropertyName backup -NotePropertyValue (Join-Path $release ("$index.before"))
    if ($entry.existed) {
      Copy-Item -LiteralPath $entry.target -Destination $entry.backup
      $backupHash=(Get-FileHash -LiteralPath $entry.backup).Hash
      if ((Get-FileHash -LiteralPath $entry.target).Hash -ne $backupHash) { throw 'ROLLBACK_COPY_MISMATCH' }
      $entry | Add-Member -NotePropertyName backupSha256 -NotePropertyValue $backupHash
    }
    $index++
  }
  foreach($stateImport in $legacyStateImports){
    if(-not (Test-Path -LiteralPath $stateImport.source -PathType Leaf)){continue}
    if((Get-Item -LiteralPath $stateImport.source -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw "LEGACY_STATE_REPARSE_REFUSED $($stateImport.name)"}
    $stateImport|Add-Member -NotePropertyName staged -NotePropertyValue (Join-Path $release ("legacy-$($stateImport.name).before"))
    Copy-Item -LiteralPath $stateImport.source -Destination $stateImport.staged
    $stateImport|Add-Member -NotePropertyName sha256 -NotePropertyValue ((Get-FileHash -LiteralPath $stateImport.staged -Algorithm SHA256).Hash)
    $stateImport|Add-Member -NotePropertyName targetExisted -NotePropertyValue (Test-Path -LiteralPath $stateImport.target -PathType Leaf)
    $stateImport|Add-Member -NotePropertyName imported -NotePropertyValue $false
    $receipt.legacyStateImports+= [ordered]@{name=$stateImport.name;source=$stateImport.source;target=$stateImport.target;staged=$stateImport.staged;sha256=$stateImport.sha256;historicalTrust='LEGACY_USER_WRITABLE';targetExisted=[bool]$stateImport.targetExisted;imported=$false}
  }
  Save-Receipt
} catch {
  $receipt.status='PRE_MUTATION_FAILED';$receipt.failure=$_.Exception.Message;$receipt.completedAt=[DateTime]::UtcNow.ToString('o');Save-Receipt
  throw
}
$taskPlan=@()
try {
  foreach($taskName in $privilegedTaskScripts.Keys){
    $relative=$privilegedTaskScripts[$taskName]
    $taskMatches=@(Get-ScheduledTask -TaskName $taskName -ErrorAction Stop)
    if($taskMatches.Count -ne 1 -or [string]$taskMatches[0].TaskPath -ne '\'){throw "UNEXPECTED_PRIVILEGED_TASK_IDENTITY $taskName"}
    $task=$taskMatches[0]
    if(@($task.Actions).Count -ne 1){throw "UNEXPECTED_PRIVILEGED_TASK_ACTION_COUNT $taskName"}
    $action=$task.Actions[0]
    if([IO.Path]::GetFileName([string]$action.Execute) -ine 'powershell.exe'){throw "UNEXPECTED_PRIVILEGED_TASK_EXECUTABLE $taskName"}
    $oldPath=Join-Path 'C:\HermesLab' $relative
    $runtimePath=Join-Path $ProtectedRuntimeRoot $relative.Substring('hermes/'.Length)
    $arguments=[string]$action.Arguments
    if($arguments -inotmatch [regex]::Escape($oldPath) -and $arguments -inotmatch [regex]::Escape($runtimePath)){throw "UNEXPECTED_PRIVILEGED_TASK_SCRIPT $taskName"}
    $newArguments=$arguments -ireplace [regex]::Escape($oldPath),$runtimePath
    if($taskName -in @('HermesP40Guard','HermesP40Watch') -and $newArguments -inotmatch '(?i)-StateRoot\s+'){$newArguments += ' -StateRoot "C:\ProgramData\Hermes\p40"'}
    $newAction=if([string]::IsNullOrWhiteSpace([string]$action.WorkingDirectory)){
      New-ScheduledTaskAction -Execute ([string]$action.Execute) -Argument $newArguments
    }else{
      New-ScheduledTaskAction -Execute ([string]$action.Execute) -Argument $newArguments -WorkingDirectory ([string]$action.WorkingDirectory)
    }
    $xml=Export-ScheduledTask -TaskName $taskName -ErrorAction Stop
    $xmlPath=Join-Path $release ("task-$taskName.before.xml")
    [IO.File]::WriteAllText($xmlPath,$xml,[Text.Encoding]::Unicode)
    $taskPlan += [pscustomobject]@{name=$taskName;xmlPath=$xmlPath;newAction=$newAction;runtimePath=$runtimePath}
  }
  $receipt['tasks']=@($taskPlan|ForEach-Object{[ordered]@{name=$_.name;runtimePath=$_.runtimePath;rollbackXml=$_.xmlPath;rollbackXmlSha256=(Get-FileHash -LiteralPath $_.xmlPath).Hash}})
  $consoleMatches=@(Get-ScheduledTask -TaskName 'HermesConsole' -ErrorAction Stop)
  $collectorMatches=@(Get-ScheduledTask -TaskName 'HermesConsoleStatus' -ErrorAction Stop)
  if($consoleMatches.Count -ne 1 -or [string]$consoleMatches[0].TaskPath -ne '\' -or @($consoleMatches[0].Actions).Count -ne 1){throw 'UNEXPECTED_CONSOLE_TASK_IDENTITY'}
  if($collectorMatches.Count -ne 1 -or [string]$collectorMatches[0].TaskPath -ne '\' -or @($collectorMatches[0].Actions).Count -ne 1){throw 'UNEXPECTED_COLLECTOR_TASK_IDENTITY'}
  $consoleAction=$consoleMatches[0].Actions[0]
  $collectorAction=$collectorMatches[0].Actions[0]
  if([IO.Path]::GetFullPath([string]$consoleAction.Execute) -ine 'C:\Program Files\nodejs\node.exe' -or [string]$consoleAction.Arguments -ne 'server.mjs' -or [IO.Path]::GetFullPath([string]$consoleAction.WorkingDirectory).TrimEnd('\') -ine 'C:\ProgramData\Hermes\console'){throw 'UNEXPECTED_CONSOLE_TASK_ACTION'}
  if([IO.Path]::GetFileName([string]$collectorAction.Execute) -ine 'powershell.exe' -or [string]$collectorAction.Arguments -inotmatch '(?i)^-NoProfile\s+-NonInteractive\s+-ExecutionPolicy\s+Bypass\s+-File\s+"?C:\\ProgramData\\Hermes\\console\\collect-hermes-console-status\.ps1"?$'){throw 'UNEXPECTED_COLLECTOR_TASK_ACTION'}
  foreach($directoryState in $protectedDirectoryState){
    $directoryState.existed=Test-Path -LiteralPath $directoryState.path -PathType Container
    if($directoryState.existed){
      if((Get-Item -LiteralPath $directoryState.path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw "REPARSE_PROTECTED_DIRECTORY $($directoryState.path)"}
      $directoryState.sddl=(Get-Acl -LiteralPath $directoryState.path -ErrorAction Stop).Sddl
    }
  }
  if($composeChanged){
    foreach($service in @('postgres','redis','open-webui','portainer')){
      $containerIds=@(& docker compose -f 'C:\HermesLab\hermes\docker-compose.yml' ps -q $service 2>$null)
      if($LASTEXITCODE -ne 0 -or $containerIds.Count -ne 1){throw "DOCKER_COMPOSE_PREIMAGE_CARDINALITY service=$service"}
      $imageId=[string](& docker inspect --format '{{.Image}}' $containerIds[0] 2>$null)
      if($LASTEXITCODE -ne 0 -or $imageId.Trim() -notmatch '^sha256:[a-fA-F0-9]{64}$'){throw "DOCKER_COMPOSE_PREIMAGE_INVALID service=$service"}
      $composePinnedImages[$service]=$imageId.Trim().ToLowerInvariant()
    }
    $composeImagePins=Join-Path $release 'compose-image-pins.json'
    $pinServices=[ordered]@{}
    foreach($service in $composePinnedImages.Keys){$pinServices[$service]=[ordered]@{image=$composePinnedImages[$service]}}
    [IO.File]::WriteAllText($composeImagePins,((([ordered]@{services=$pinServices})|ConvertTo-Json -Depth 5)+"`n"),[Text.UTF8Encoding]::new($false))
    $receipt['composeImagePins']=[ordered]@{path=$composeImagePins;sha256=(Get-FileHash -LiteralPath $composeImagePins -Algorithm SHA256).Hash;services=$composePinnedImages}
  }
  Save-Receipt
} catch {
  $receipt.status='PRE_MUTATION_FAILED';$receipt.failure=$_.Exception.Message;$receipt.completedAt=[DateTime]::UtcNow.ToString('o');Save-Receipt
  throw
}
try {
  Stop-ScheduledTask -TaskName 'HermesConsole'
  Stop-ScheduledTask -TaskName 'HermesConsoleStatus'
  foreach($taskEntry in $taskPlan){Stop-ScheduledTask -TaskName $taskEntry.name -ErrorAction Stop}
  $ownerRestartAttempted=$true
  if((Test-Path -LiteralPath $ProtectedRuntimeRoot) -and ((Get-Item -LiteralPath $ProtectedRuntimeRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw "REPARSE_RUNTIME_ROOT $ProtectedRuntimeRoot"}
  New-Item -ItemType Directory -Path $ProtectedRuntimeRoot -Force | Out-Null
  Set-Acl -LiteralPath $ProtectedRuntimeRoot -AclObject $acl
  $protectedHealthRoot='C:\ProgramData\Hermes\health'
  if((Test-Path -LiteralPath $protectedHealthRoot) -and ((Get-Item -LiteralPath $protectedHealthRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw "REPARSE_HEALTH_ROOT $protectedHealthRoot"}
  New-Item -ItemType Directory -Path $protectedHealthRoot -Force|Out-Null
  Set-Acl -LiteralPath $protectedHealthRoot -AclObject $acl
  foreach ($entry in $plan) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $entry.target) -Force | Out-Null
    if ((Get-FileHash -LiteralPath $entry.staged).Hash -ne $entry.sha256) { throw "STAGED_PAYLOAD_HASH_MISMATCH $($entry.target)" }
    Copy-Item -LiteralPath $entry.staged -Destination $entry.target -Force
    if ((Get-FileHash -LiteralPath $entry.target).Hash -ne $entry.sha256) { throw "INSTALLED_HASH_MISMATCH $($entry.target)" }
  }
  foreach($stateImport in @($legacyStateImports|Where-Object{$_.PSObject.Properties['staged']})){
    if($stateImport.targetExisted){continue}
    if((Get-FileHash -LiteralPath $stateImport.staged -Algorithm SHA256).Hash -ne $stateImport.sha256){throw "LEGACY_STATE_STAGED_HASH_MISMATCH $($stateImport.name)"}
    Copy-Item -LiteralPath $stateImport.staged -Destination $stateImport.target
    if((Get-FileHash -LiteralPath $stateImport.target -Algorithm SHA256).Hash -ne $stateImport.sha256){throw "LEGACY_STATE_IMPORT_HASH_MISMATCH $($stateImport.name)"}
    $stateImport.imported=$true
    $receiptImport=@($receipt.legacyStateImports|Where-Object name -eq $stateImport.name)[0]
    $receiptImport['imported']=$true
  }
  foreach($taskEntry in $taskPlan){Set-ScheduledTask -TaskName $taskEntry.name -Action $taskEntry.newAction -ErrorAction Stop|Out-Null}
  if($composeChanged){
    Invoke-Compose 'validate'
    $composeApplyAttempted=$true
    Invoke-Compose 'apply'
    Assert-ComposeImages
    $running=@(& docker compose -f 'C:\HermesLab\hermes\docker-compose.yml' ps --status running --services)
    if($LASTEXITCODE -ne 0){throw "DOCKER_COMPOSE_VERIFY_FAILED exit=$LASTEXITCODE"}
    $missing=@('postgres','redis','open-webui','portainer' | Where-Object {$running -notcontains $_})
    if($missing.Count){throw "DOCKER_COMPOSE_SERVICES_MISSING $($missing -join ',')"}
  }
  Restart-InferenceOwner
  & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $ProtectedRuntimeRoot 'lab-health.ps1') -LocalOnly | Out-Null
  if($LASTEXITCODE -ne 0){throw "NATIVE_HEALTH_FAILED exit=$LASTEXITCODE"}
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
  foreach($taskName in @('HermesP40Guard','HermesP40Watch','HermesDoctrineCheck','HermesLabHealth')){Start-ScheduledTask -TaskName $taskName}
  foreach($taskEntry in $taskPlan){
    $deployedXmlPath=Join-Path $release ("task-$($taskEntry.name).deployed.xml")
    [IO.File]::WriteAllText($deployedXmlPath,(Export-ScheduledTask -TaskName $taskEntry.name -ErrorAction Stop),[Text.Encoding]::Unicode)
    $taskReceipt=@($receipt.tasks|Where-Object name -eq $taskEntry.name)[0]
    $taskReceipt['deployedXml']=$deployedXmlPath
    $taskReceipt['deployedXmlSha256']=(Get-FileHash -LiteralPath $deployedXmlPath).Hash
  }
  $receipt.status='DEPLOYED';$receipt.completedAt=[DateTime]::UtcNow.ToString('o');Save-Receipt
  Write-Output "APPLIANCE_DEPLOYED commit=$head files=$($plan.Count) receipt=$receiptPath"
} catch {
  $failure=$_.Exception.Message
  $rollbackErrors=@()
  Stop-ScheduledTask -TaskName 'HermesConsole' -ErrorAction SilentlyContinue
  foreach($taskEntry in $taskPlan){Stop-ScheduledTask -TaskName $taskEntry.name -ErrorAction SilentlyContinue}
  foreach($entry in $plan) {
    try {
      if($entry.existed) {
        if((Get-FileHash -LiteralPath $entry.backup).Hash -ne $entry.backupSha256){throw 'ROLLBACK_SOURCE_HASH_MISMATCH'}
        Copy-Item -LiteralPath $entry.backup -Destination $entry.target -Force
      }
      elseif(Test-Path -LiteralPath $entry.target -PathType Leaf) {Remove-Item -LiteralPath $entry.target -Force}
    } catch {$rollbackErrors += $_.Exception.Message}
  }
  foreach($stateImport in @($legacyStateImports|Where-Object{$_.PSObject.Properties['imported'] -and $_.imported})){
    try{if(Test-Path -LiteralPath $stateImport.target -PathType Leaf){Remove-Item -LiteralPath $stateImport.target -Force}}catch{$rollbackErrors += $_.Exception.Message}
  }
  foreach($directoryState in $protectedDirectoryState){
    try{
      if($directoryState.existed){
        $restoreAcl=New-Object Security.AccessControl.DirectorySecurity
        $restoreAcl.SetSecurityDescriptorSddlForm([string]$directoryState.sddl)
        Set-Acl -LiteralPath $directoryState.path -AclObject $restoreAcl -ErrorAction Stop
      }elseif(Test-Path -LiteralPath $directoryState.path -PathType Container){
        $resolved=[IO.Path]::GetFullPath($directoryState.path).TrimEnd('\')
        if($resolved -notin @('C:\ProgramData\Hermes\runtime','C:\ProgramData\Hermes\health')){throw "ROLLBACK_PROTECTED_DIRECTORY_SCOPE_REFUSED $resolved"}
        Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction Stop
      }
    }catch{$rollbackErrors += $_.Exception.Message}
  }
  foreach($taskEntry in $taskPlan){try {Register-ScheduledTask -TaskName $taskEntry.name -Xml (Get-Content -LiteralPath $taskEntry.xmlPath -Raw -ErrorAction Stop) -Force -ErrorAction Stop|Out-Null} catch {$rollbackErrors += $_.Exception.Message}}
  if($composeApplyAttempted){try {Invoke-Compose 'validate';Invoke-Compose 'apply';Assert-ComposeImages} catch {$rollbackErrors += $_.Exception.Message}}
  if($ownerRestartAttempted) {try {Restart-InferenceOwner} catch {$rollbackErrors += $_.Exception.Message}}
  foreach($task in @('HermesConsole','HermesConsoleStatus','HermesP40Guard','HermesP40Watch','HermesDoctrineCheck','HermesLabHealth')) {try {Start-ScheduledTask -TaskName $task} catch {$rollbackErrors += $_.Exception.Message}}
  $receipt.status=if($rollbackErrors.Count){'ROLLBACK_INCOMPLETE'}else{'ROLLED_BACK'}
  $receipt.failure=$failure;$receipt.rollbackErrors=$rollbackErrors;Save-Receipt
  throw "APPLIANCE_DEPLOY_$($receipt.status) $failure"
}
