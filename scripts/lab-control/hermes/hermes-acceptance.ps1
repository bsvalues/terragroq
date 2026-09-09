# Current HERMES Appliance V1 acceptance. Read-only except for its sealed result file.
[CmdletBinding()]
param(
  [switch]$RequirePostDeploymentReboot,
  [string]$ConsoleUri = 'http://127.0.0.1:3210/api/status',
  [string]$ProtectedReleaseRoot = 'C:\ProgramData\Hermes\release-rollback',
  [string]$OutputPath = 'C:\ProgramData\Hermes\status\acceptance.json',
  [string]$GoldenModel = 'williamos-qwen3-4b:64k'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$observedAt = [DateTime]::UtcNow
$checks = New-Object System.Collections.Generic.List[object]

function Add-Check([string]$Name,[bool]$Pass,[string]$Detail) {
  $checks.Add([pscustomobject][ordered]@{name=$Name;status=$(if($Pass){'PASS'}else{'FAIL'});detail=$Detail})
}
function Read-Json([string]$Path) {
  try { Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop } catch { $null }
}
function Has-Properties([object]$Value,[string[]]$Names) {
  if($null -eq $Value -or $Value -isnot [pscustomobject]){return $false}
  foreach($name in $Names){if($null -eq $Value.PSObject.Properties[$name]){return $false}}
  return $true
}

$status = $null
try { $status = Invoke-RestMethod -Uri $ConsoleUri -TimeoutSec 15 -ErrorAction Stop } catch {}
$statusValid = (Has-Properties $status @('schema','observedAt','domains')) -and [string]$status.schema -eq 'hermes-console-status/1'
Add-Check 'console-contract' $statusValid $(if($statusValid){'live Console returned hermes-console-status/1'}else{'live Console status unavailable or malformed'})

$statusFresh = $false
if($statusValid){
  try {
    $statusAge=($observedAt-([datetime]$status.observedAt).ToUniversalTime()).TotalSeconds
    $statusFresh=$statusAge -ge -60 -and $statusAge -le 300
    Add-Check 'console-freshness' $statusFresh ("status age {0:N0}s" -f $statusAge)
  } catch { Add-Check 'console-freshness' $false 'status observedAt is invalid' }
} else { Add-Check 'console-freshness' $false 'no valid status packet' }

foreach($domain in @('appliance','inference','protection','storage','security','doctrine','workbench')){
  $state = if($statusValid -and $status.domains -and $status.domains.PSObject.Properties[$domain]){[string]$status.domains.$domain.state}else{'MISSING'}
  Add-Check "domain-$domain" ($state -eq 'HEALTHY') "state=$state"
}

$owner=Read-Json 'C:\ProgramData\Hermes\inference\current-owner.json'
$ownerValid=Has-Properties $owner @('owner','state','listen','models','gpuUuid','powerCapWatts','observedAt','pid')
$boot=$null
try{$boot=(Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).LastBootUpTime.ToUniversalTime()}catch{}
$ownerFresh=$false
$ownerAfterBoot=$false
if($ownerValid){
  try{$ownerAge=($observedAt-([datetime]$owner.observedAt).ToUniversalTime()).TotalSeconds;$ownerFresh=$ownerAge -ge -60 -and $ownerAge -le 120}catch{}
  try{
    $process=Get-CimInstance Win32_Process -Filter "ProcessId=$($owner.pid)" -ErrorAction Stop
    $ownerAfterBoot=$boot -and $process -and $process.CreationDate.ToUniversalTime() -gt $boot
  }catch{}
}
$ownerExact=$ownerValid -and [string]$owner.owner -eq 'WilliamOS-HERMES-Ollama' -and [string]$owner.state -eq 'SERVING' -and [string]$owner.listen -eq '127.0.0.1:11434' -and [string]$owner.models -eq 'G:\HermesData\ollama\models' -and [string]$owner.gpuUuid -eq 'GPU-4f7d4396-9304-d12f-7e9b-7f04d1236fc2' -and [int]$owner.powerCapWatts -eq 150 -and $ownerFresh
Add-Check 'canonical-inference-owner' ([bool]$ownerExact) $(if($ownerExact){"pid=$($owner.pid) models=G: cap=150W"}else{'canonical owner receipt is missing, stale, or inconsistent'})
Add-Check 'owner-after-boot' ([bool]$ownerAfterBoot) $(if($ownerAfterBoot){'serving process was created after current boot'}else{'serving process did not prove autonomous current-boot start'})

$inferencePass=$false
$inferenceDetail='generation did not complete'
try{
  $payload=@{model=$GoldenModel;prompt='Reply with exactly OK.';stream=$false;options=@{num_predict=8;num_ctx=4096}}|ConvertTo-Json -Depth 5 -Compress
  $reply=Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/generate' -Method Post -ContentType 'application/json' -Body $payload -TimeoutSec 120 -ErrorAction Stop
  $inferencePass=-not [string]::IsNullOrWhiteSpace([string]$reply.response)
  $inferenceDetail="model=$GoldenModel responsePresent=$inferencePass"
}catch{$inferenceDetail=$_.Exception.GetType().Name}
Add-Check 'golden-model-generation' $inferencePass $inferenceDetail

$p40LoadPass=$false
$p40LoadDetail='P40 load proof did not run'
$loadJob=$null
try{
  $p40Uuid='GPU-4f7d4396-9304-d12f-7e9b-7f04d1236fc2'
  $p40Index=$null
  foreach($row in @(& nvidia-smi.exe --query-gpu=index,uuid --format=csv,noheader,nounits 2>$null)){
    $parts=@($row -split ',\s*')
    if($parts.Count -ge 2 -and $parts[1].Trim() -eq $p40Uuid){$p40Index=[int]$parts[0].Trim();break}
  }
  if($null -eq $p40Index){throw 'P40_UUID_NOT_FOUND'}
  $loadBody=@{model=$GoldenModel;prompt='Write a detailed explanation of resilient appliance recovery testing.';stream=$false;options=@{num_predict=256;num_ctx=4096}}|ConvertTo-Json -Depth 5 -Compress
  $loadJob=Start-Job -ScriptBlock { param($Body) Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/generate' -Method Post -ContentType 'application/json' -Body $Body -TimeoutSec 180 -ErrorAction Stop } -ArgumentList $loadBody
  $peak=0
  for($sample=0;$sample -lt 360 -and $loadJob.State -eq 'Running';$sample++){
    $raw=(& nvidia-smi.exe -i $p40Index --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>$null)
    if($LASTEXITCODE -eq 0 -and [string]$raw -match '^\s*(\d+)'){$value=[int]$Matches[1];if($value -gt $peak){$peak=$value}}
    Start-Sleep -Milliseconds 500
  }
  Wait-Job -Job $loadJob -Timeout 10|Out-Null
  $loadReply=Receive-Job -Job $loadJob -ErrorAction Stop
  $p40LoadPass=$loadJob.State -eq 'Completed' -and $peak -ge 20 -and -not [string]::IsNullOrWhiteSpace([string]$loadReply.response)
  $p40LoadDetail="uuid=$p40Uuid peakUtilization=$peak% responsePresent=$(-not [string]::IsNullOrWhiteSpace([string]$loadReply.response))"
}catch{$p40LoadDetail=$_.Exception.Message}
finally{if($loadJob){Remove-Job -Job $loadJob -Force -ErrorAction SilentlyContinue}}
Add-Check 'p40-active-under-generation' $p40LoadPass $p40LoadDetail

$dockerConfigured=$false
try{
  $settings=Read-Json 'C:\Users\bs\AppData\Roaming\Docker\settings-store.json'
  $dockerConfigured=$settings -and [string]$settings.CustomWslDistroDir -eq 'G:\DockerDesktopWSL' -and (Test-Path -LiteralPath 'G:\DockerDesktopWSL\disk\docker_data.vhdx' -PathType Leaf) -and -not (Test-Path -LiteralPath 'C:\Users\bs\AppData\Local\Docker\wsl\disk\docker_data.vhdx' -PathType Leaf)
}catch{}
Add-Check 'docker-on-g' ([bool]$dockerConfigured) $(if($dockerConfigured){'G:\DockerDesktopWSL is active; legacy C: VHDX absent'}else{'Docker G: placement not proven'})

$requiredVolumes=@('hermes_pgdata','hermes_redisdata','hermes_webuidata','hermes_portainerdata')
$volumeNames=@(& docker volume ls --format '{{.Name}}' 2>$null)
$volumeExit=$LASTEXITCODE
$missingVolumes=@($requiredVolumes|Where-Object{$volumeNames -notcontains $_})
Add-Check 'docker-volume-preservation' ($volumeExit -eq 0 -and $missingVolumes.Count -eq 0) $(if($volumeExit -eq 0){"missing=$($missingVolumes -join ',')"}else{"docker volume ls exit=$volumeExit"})

$ntfyUser=[Environment]::GetEnvironmentVariable('HERMES_NTFY_TOPIC','User')
$ntfyMachine=[Environment]::GetEnvironmentVariable('HERMES_NTFY_TOPIC','Machine')
$nativeOnly=[string]::IsNullOrWhiteSpace($ntfyUser) -and [string]::IsNullOrWhiteSpace($ntfyMachine)
Add-Check 'native-only-alerting' $nativeOnly $(if($nativeOnly){'external ntfy transport is inactive'}else{'HERMES_NTFY_TOPIC remains configured'})
Add-Check 'native-alert-path' (Test-Path -LiteralPath 'C:\ProgramData\Hermes\health\alerts.log' -PathType Leaf) 'C:\ProgramData\Hermes\health\alerts.log'

$release=$null
$releaseDirectory=$null
if(Test-Path -LiteralPath $ProtectedReleaseRoot -PathType Container){
  foreach($candidate in Get-ChildItem -LiteralPath $ProtectedReleaseRoot -Directory -ErrorAction SilentlyContinue|Sort-Object Name -Descending){
    $receipt=Read-Json (Join-Path $candidate.FullName 'release.json')
    if((Has-Properties $receipt @('status','commit','completedAt')) -and [string]$receipt.status -eq 'DEPLOYED'){$release=$receipt;$releaseDirectory=$candidate.FullName;break}
  }
}
$releaseValid=(Has-Properties $release @('schema','commit','completedAt','files','tasks')) -and [string]$release.schema -eq 'hermes-appliance-release/2' -and [string]$release.commit -match '^[0-9a-f]{40}$'
Add-Check 'protected-deployment-receipt' ([bool]$releaseValid) $(if($releaseValid){"commit=$($release.commit) completed=$($release.completedAt)"}else{'no protected DEPLOYED release receipt'})
$runtimeIntegrity=$false
$runtimeDetail='protected runtime receipt unavailable'
if($releaseValid){
  try{
    $runtimeRoot='C:\ProgramData\Hermes\runtime'
    $runtimeFiles=@($release.files|Where-Object{[IO.Path]::GetFullPath([string]$_.target).StartsWith($runtimeRoot+'\',[StringComparison]::OrdinalIgnoreCase)})
    $taskRecords=@($release.tasks)
    $expectedTaskNames=@('HermesLabHealth','HermesP40Guard','HermesP40Watch','HermesDoctrineCheck','WilliamOS-HERMES-Ollama')
    $actualTaskNames=@($taskRecords|ForEach-Object{[string]$_.name}|Sort-Object)
    $sortedExpectedTaskNames=@($expectedTaskNames|Sort-Object)
    if($runtimeFiles.Count -lt 1 -or $taskRecords.Count -ne $expectedTaskNames.Count -or ($actualTaskNames -join '|') -ne ($sortedExpectedTaskNames -join '|')){throw 'RUNTIME_RECEIPT_INCOMPLETE'}
    foreach($file in $runtimeFiles){
      if([string]$file.sha256 -notmatch '^[a-fA-F0-9]{64}$' -or -not (Test-Path -LiteralPath ([string]$file.target) -PathType Leaf) -or (Get-FileHash -LiteralPath ([string]$file.target) -Algorithm SHA256).Hash -ine [string]$file.sha256){throw 'RUNTIME_FILE_HASH_MISMATCH'}
    }
    $releasePrefix=[IO.Path]::GetFullPath($releaseDirectory).TrimEnd('\')+'\'
    foreach($taskRecord in $taskRecords){
      $xmlPath=[IO.Path]::GetFullPath([string]$taskRecord.deployedXml)
      if(-not $xmlPath.StartsWith($releasePrefix,[StringComparison]::OrdinalIgnoreCase) -or [string]$taskRecord.deployedXmlSha256 -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $xmlPath -Algorithm SHA256).Hash -ine [string]$taskRecord.deployedXmlSha256){throw 'RUNTIME_TASK_XML_INVALID'}
      [xml]$taskXml=Get-Content -LiteralPath $xmlPath -Raw -ErrorAction Stop
      $arguments=[string]$taskXml.Task.Actions.Exec.Arguments
      if($arguments -inotmatch [regex]::Escape([string]$taskRecord.runtimePath)){throw 'RUNTIME_TASK_NOT_BOUND'}
    }
    $runtimeIntegrity=$true;$runtimeDetail="$($runtimeFiles.Count) protected files | $($taskRecords.Count) SYSTEM task bindings"
  }catch{$runtimeDetail=$_.Exception.Message}
}
Add-Check 'protected-runtime-integrity' $runtimeIntegrity $runtimeDetail
if($RequirePostDeploymentReboot){
  $rebootAfterDeploy=$false
  if($releaseValid -and $boot){try{$rebootAfterDeploy=$boot -gt ([datetime]$release.completedAt).ToUniversalTime()}catch{}}
  Add-Check 'post-deployment-reboot' $rebootAfterDeploy $(if($rebootAfterDeploy){"boot=$($boot.ToString('o'))"}else{'current boot does not postdate the deployed release'})
}

$checkArray=@($checks.GetEnumerator())
$failures=@($checkArray|Where-Object status -eq 'FAIL')
$accepted=$failures.Count -eq 0
$result=[ordered]@{
  schema='hermes-appliance-acceptance/1';observedAt=$observedAt.ToString('o')
  result=$(if($accepted){'HERMES_APPLIANCE_V1_ACCEPTED'}else{'HERMES_APPLIANCE_V1_NOT_ACCEPTED'})
  requirePostDeploymentReboot=[bool]$RequirePostDeploymentReboot
  checks=$checkArray;failureCount=$failures.Count
}
try{
  $parent=Split-Path -Parent $OutputPath
  if($parent -and -not (Test-Path -LiteralPath $parent -PathType Container)){New-Item -ItemType Directory -Path $parent -Force|Out-Null}
  [IO.File]::WriteAllText($OutputPath,(($result|ConvertTo-Json -Depth 8 -Compress)+"`n"),[Text.UTF8Encoding]::new($false))
}catch{Write-Warning "Acceptance result could not be persisted: $($_.Exception.Message)"}
$result|ConvertTo-Json -Depth 8
Write-Output "RESULT: $($result.result)"
if($accepted){exit 0}else{exit 2}
