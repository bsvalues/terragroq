[CmdletBinding()]
param(
  [string]$OutputPath = 'C:\ProgramData\Hermes\status\current.json',
  # HermesLabHealth repeats hourly; allow 15 minutes for scheduling and probe completion.
  [ValidateRange(1,86400)][int]$NativeHealthMaxAgeSeconds = 4500,
  [string]$NativeHealthPath = 'C:\ProgramData\Hermes\health\lab-health.json',
  [string]$NativeAlertsPath = 'C:\ProgramData\Hermes\health\alerts.log',
  [string]$CanonicalOwnerStatePath = 'C:\ProgramData\Hermes\inference\current-owner.json',
  [string]$RecoveryRoot = 'G:\lab-backups\hermes-volumes',
  [string]$DoctrineResultPath = 'C:\ProgramData\Hermes\doctrine\current-result.json',
  [string]$RestoreReceiptPath = 'G:\lab-backups\hermes-volumes\hermes-latest-restore-receipt.json',
  [string]$DockerSettingsPath = 'C:\Users\bs\AppData\Roaming\Docker\settings-store.json',
  [string]$LegacyDockerVhdxPath = '',
  [string]$DockerDataPath = 'G:\DockerDesktopWSL\disk\docker_data.vhdx',
  [string]$GoldenModel = 'williamos-qwen3-4b:64k'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Fact([string]$Label, [string]$Value) { [ordered]@{ label = $Label; value = $Value } }
function Domain([string]$State, [string]$Headline, [object[]]$Facts) {
  [ordered]@{ state = $State; headline = $Headline; facts = @($Facts) }
}
function Read-Json([string]$Path, [string[]]$Required = @()) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  try {
    $value = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    if($null -eq $value -or $value -isnot [pscustomobject]){ return $null }
    foreach($field in $Required){
      $current = $value
      foreach($part in $field.Split('.')){
        if($null -eq $current -or -not $current.PSObject.Properties[$part]){ return $null }
        $current = $current.$part
      }
      if($null -eq $current){ return $null }
    }
    return $value
  } catch { return $null }
}
function Get-TaskFact([string]$Name) {
  try {
    $info = Get-ScheduledTaskInfo -TaskName $Name -ErrorAction Stop
    [ordered]@{ name = $Name; result = [int]$info.LastTaskResult; lastRun = $info.LastRunTime.ToUniversalTime() }
  } catch { [ordered]@{ name = $Name; result = $null; lastRun = $null } }
}
function Get-DriveFact([string]$Letter) {
  try {
    $volume = Get-Volume -DriveLetter $Letter -ErrorAction Stop
    [ordered]@{ letter = $Letter; label = [string]$volume.FileSystemLabel; freeGb = [math]::Round($volume.SizeRemaining / 1GB, 1); sizeGb = [math]::Round($volume.Size / 1GB, 1) }
  } catch { [ordered]@{ letter = $Letter; label = ''; freeGb = $null; sizeGb = $null } }
}

$observedAt = [DateTime]::UtcNow
# No appliance-scoped authenticated transaction/decision projection is installed.
# The WilliamOS outcome queue is a separate authority source; never infer an empty queue here.
$ownerActions = @()
$domains = [ordered]@{}

# Appliance health is owned by the native monitor. The Console presents that state; it does not
# create a second overall-health oracle.
$nativeHealth = Read-Json $NativeHealthPath @('timestamp','domains.hermes.overall','domains.hermes.problems')
$nativeHermes = if($nativeHealth -and $nativeHealth.domains){$nativeHealth.domains.hermes}else{$null}
$nativeOverall = if($nativeHermes){[string]$nativeHermes.overall}else{'unknown'}
[object[]]$nativeProblems = if($nativeHermes){@($nativeHermes.problems)}else{@('Native HERMES health unavailable')}
$nativeProblemCount = @($nativeProblems | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }).Count
$nativeState = switch($nativeOverall){ 'ok'{'HEALTHY'} 'warn'{'DEGRADED'} 'fail'{'CRITICAL'} default{'UNKNOWN'} }
$domains.appliance = Domain $nativeState ($(if($nativeState -eq 'HEALTHY'){'Native HERMES health is green'}else{'Native HERMES health requires attention'})) @(
  Fact 'Native monitor' $(if($nativeHealth){"$nativeOverall | $nativeProblemCount findings"}else{'Unavailable'})
  Fact 'Source' 'lab-health.json | authoritative'
)

# Inference: canonical owner receipt, catalogue, exact golden model, loopback listener, and P40.
$models = @()
$ollamaError = $null
try {
  $tags = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 12 -ErrorAction Stop
  $models = @($tags.models | ForEach-Object { [string]$_.name })
} catch { $ollamaError = $_.Exception.GetType().Name }
$owner = Read-Json $CanonicalOwnerStatePath @('schema','owner','state','listen','observedAt','pid','executable','models','gpuUuid','powerCapWatts')
$ownerAgeSeconds = if($owner){try{($observedAt - ([datetime]$owner.observedAt).ToUniversalTime()).TotalSeconds}catch{$null}}else{$null}
$listenerPid = $null
$ollamaListeners = @()
foreach($line in @(netstat -ano -p tcp 2>$null)){
  if($line -match '^\s*TCP\s+(\S+):11434\s+\S+\s+LISTENING\s+(\d+)\s*$'){
    $ollamaListeners += [pscustomobject]@{ Address=$Matches[1]; Pid=[int]$Matches[2] }
  }
}
$loopbackListenerExact = $ollamaListeners.Count -eq 1 -and $ollamaListeners[0].Address -eq '127.0.0.1'
if($loopbackListenerExact){ $listenerPid = $ollamaListeners[0].Pid }
$ownerExact = $owner -and [string]$owner.schema -eq 'hermes-ollama-owner-state/1' -and [string]$owner.owner -eq 'WilliamOS-HERMES-Ollama' -and [string]$owner.state -eq 'SERVING' -and [string]$owner.listen -eq '127.0.0.1:11434' -and $null -ne $ownerAgeSeconds -and $ownerAgeSeconds -ge -60 -and $ownerAgeSeconds -le 120 -and $loopbackListenerExact -and $null -ne $listenerPid -and [string]$owner.pid -eq [string]$listenerPid -and [string]$owner.executable -eq 'D:\HermesServices\ollama\v0.9.2\ollama.exe' -and [string]$owner.models -eq 'G:\HermesData\ollama\models' -and [string]$owner.gpuUuid -eq 'GPU-4f7d4396-9304-d12f-7e9b-7f04d1236fc2' -and [string]$owner.powerCapWatts -eq '150'
$p40 = $null
try {
  $rows = @(& nvidia-smi.exe --query-gpu=name,uuid,driver_model.current,temperature.gpu,power.limit,memory.used,memory.total,ecc.errors.corrected.volatile.total,ecc.errors.uncorrected.volatile.total,ecc.errors.corrected.aggregate.total,ecc.errors.uncorrected.aggregate.total --format=csv,noheader,nounits 2>$null)
  foreach ($row in $rows) {
    $parts = @($row -split ',\s*')
    if ($parts.Count -ge 11 -and $parts[0] -match 'Tesla P40') {
      $p40 = [ordered]@{ name=$parts[0]; uuid=$parts[1]; driverModel=$parts[2]; tempC=$parts[3]; powerLimitW=$parts[4]; memoryUsedMb=$parts[5]; memoryTotalMb=$parts[6]; correctedVolatile=$parts[7]; uncorrectedVolatile=$parts[8]; correctedAggregate=$parts[9]; uncorrectedAggregate=$parts[10] }
    }
  }
} catch {}
$goldenPresent = $models -contains $GoldenModel
$p40CountersPresent = $null -ne $p40 -and [string]$p40.correctedVolatile -match '^\d+$' -and [string]$p40.uncorrectedVolatile -match '^\d+$' -and [string]$p40.correctedAggregate -match '^\d+$' -and [string]$p40.uncorrectedAggregate -match '^\d+$'
$p40Healthy = $null -ne $p40 -and $p40CountersPresent -and $p40.driverModel -eq 'TCC' -and [double]$p40.powerLimitW -ge 149 -and [double]$p40.powerLimitW -le 151 -and [int]$p40.uncorrectedVolatile -eq 0 -and [int]$p40.uncorrectedAggregate -eq 0
$inferenceState = if ($ollamaError -or -not $ownerExact -or -not $goldenPresent -or -not $p40Healthy) { 'CRITICAL' } else { 'HEALTHY' }
$domains.inference = Domain $inferenceState ($(if($inferenceState -eq 'HEALTHY'){'P40 inference is serving correctly'}else{'Inference proof is not green'})) @(
  Fact 'Ollama' $(if($ollamaError){"Unavailable ($ollamaError)"}else{"Serving $($models.Count) models"})
  Fact 'Golden model' $(if($goldenPresent){$GoldenModel}else{'Missing'})
  Fact 'Owner' $(if($ownerExact){'WilliamOS-HERMES-Ollama | fresh'}else{'Canonical owner unproven'})
  Fact 'Listener' $(if($listenerPid){"Loopback-only 127.0.0.1:11434 | pid $listenerPid"}else{'Missing'})
  Fact 'P40' $(if($p40){"$($p40.tempC) C | $($p40.powerLimitW) W cap | $($p40.driverModel)"}else{'Unavailable'})
  Fact 'P40 ECC telemetry' $(if($p40CountersPresent){"present | corrected counters informational | uncorrected $($p40.uncorrectedVolatile)/$($p40.uncorrectedAggregate)"}else{'Missing or malformed'})
)

# Protection: generation, task results, and an actual restore receipt for that generation.
$receipt = Read-Json $RestoreReceiptPath @('schema','generation','status','verifiedAt')
$latestProof = Get-ChildItem -LiteralPath $RecoveryRoot -Filter 'hermes-recovery-proof-*.tar.gz' -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^hermes-recovery-proof-\d{8}_\d{6}\.tar\.gz$' } | Sort-Object Name -Descending | Select-Object -First 1
$generation = if($latestProof){$latestProof.Name -replace '^hermes-recovery-proof-|\.tar\.gz$',''}else{$null}
$backupTask = Get-TaskFact 'HermesVolumeBackup'
$syncTask = Get-TaskFact 'HermesCrossNodeBackupSync'
$modelSyncTask = Get-TaskFact 'HermesModelForgeSync'
$proofAgeHours = if($latestProof){ [math]::Round(($observedAt - $latestProof.LastWriteTimeUtc).TotalHours, 1) }else{ $null }
$restoreAge = if($receipt -and $receipt.PSObject.Properties['verifiedAt']){try{($observedAt - ([datetime]$receipt.verifiedAt).ToUniversalTime()).TotalHours}catch{$null}}else{$null}
$restoreCurrent = $null -ne $restoreAge -and $restoreAge -ge (-1.0/60) -and $restoreAge -le 36 -and $receipt -and [string]$receipt.schema -eq 'hermes-offhost-restore-receipt/1' -and [string]$receipt.generation -eq $generation -and [string]$receipt.status -eq 'PASS'
$protectionHealthy = $generation -and $proofAgeHours -le 36 -and $backupTask.result -eq 0 -and $syncTask.result -eq 0 -and $modelSyncTask.result -eq 0 -and $restoreCurrent
$domains.protection = Domain ($(if($protectionHealthy){'HEALTHY'}else{'DEGRADED'})) ($(if($protectionHealthy){'Off-host recovery is proven'}else{'Recovery proof needs attention'})) @(
  Fact 'Generation' $(if($generation){$generation}else{'Missing'})
  Fact 'Local proof age' $(if($null -ne $proofAgeHours){"$proofAgeHours hours"}else{'Unknown'})
  Fact 'Restore observed' $(if($receipt -and $receipt.PSObject.Properties['verifiedAt']){[string]$receipt.verifiedAt}else{'Unavailable'})
  Fact 'Restore freshness' $(if($null -ne $restoreAge -and $restoreAge -ge (-1.0/60) -and $restoreAge -le 36){'FRESH'}else{'STALE / UNAVAILABLE'})
  Fact 'Backup task' $(if($null -eq $backupTask.result){'Unreadable'}else{"Result $($backupTask.result)"})
  Fact 'Cross-node task' $(if($null -eq $syncTask.result){'Unreadable'}else{"Result $($syncTask.result)"})
  Fact 'Model replica task' $(if($null -eq $modelSyncTask.result){'Unreadable'}else{"Result $($modelSyncTask.result)"})
  Fact 'Off-host restore' $(if($restoreCurrent){'Verified matching generation'}elseif($receipt){"Older verified generation: $($receipt.generation) | $($receipt.status)"}else{'No current receipt'})
)

# Storage: the three declared roles. D: now holds legacy rollback material, not the serving model
# store or Docker data, so it has a smaller safety floor than the active C:/G: roles.
$c = Get-DriveFact 'C'; $d = Get-DriveFact 'D'; $g = Get-DriveFact 'G'
$storageState = if($null -eq $c.freeGb -or $null -eq $d.freeGb -or $null -eq $g.freeGb){'CRITICAL'}elseif($c.freeGb -lt 10 -or $d.freeGb -lt 5 -or $g.freeGb -lt 25){'CRITICAL'}elseif($c.freeGb -lt 25 -or $d.freeGb -lt 15 -or $g.freeGb -lt 75){'DEGRADED'}else{'HEALTHY'}
$domains.storage = Domain $storageState ($(if($storageState -eq 'HEALTHY'){'Storage roles have safe headroom'}elseif($storageState -eq 'CRITICAL'){'A storage role is at immediate risk'}else{'System storage needs relief'})) @(
  Fact 'C: system' $(if($null -ne $c.freeGb){"$($c.freeGb) GB free"}else{'Unavailable'})
  Fact 'D: legacy rollback' $(if($null -ne $d.freeGb){"$($d.freeGb) GB free | not serving"}else{'Unavailable'})
  Fact 'G: workbench / replicas' $(if($null -ne $g.freeGb){"$($g.freeGb) GB free | $($g.label)"}else{'Unavailable'})
)

# Security uses the fresh privileged doctrine result when available. The user probe never guesses
# about rules it cannot enumerate; contained service state and firewall profiles are supporting facts.
$profiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore -ErrorAction SilentlyContinue)
$profilesHealthy = $profiles.Count -eq 3 -and @($profiles | Where-Object { -not [bool]$_.Enabled -or [string]$_.DefaultInboundAction -notin @('Block','4') }).Count -eq 0
$containedServices = @(Get-CimInstance Win32_Service -Filter "Name='PEMHTTPD-x64' OR Name='WebManagement'" -ErrorAction SilentlyContinue)
$servicesContained = $containedServices.Count -eq 2 -and @($containedServices | Where-Object { [string]$_.State -ne 'Stopped' -or [string]$_.StartMode -ne 'Disabled' }).Count -eq 0
$doctrine = Read-Json $DoctrineResultPath @('schema','status','code','observedAt','evaluatedAt','freshness.state')
$doctrineAge = if($doctrine){try{($observedAt - ([datetime]$doctrine.evaluatedAt).ToUniversalTime()).TotalSeconds}catch{$null}}else{$null}
$doctrineFresh = $doctrine -and [string]$doctrine.schema -eq 'hermes-doctrine-result/1' -and $null -ne $doctrineAge -and $doctrineAge -ge -60 -and $doctrineAge -le 600 -and $doctrine.freshness.state -eq 'FRESH'
$ingressDrift = @()
$exposureDrift = @()
if($doctrineFresh -and $doctrine.PSObject.Properties['drift'] -and $doctrine.drift -and $doctrine.drift.PSObject.Properties['listeners'] -and $doctrine.drift.listeners){
  foreach($kind in @('changed','missing','unexpected')) {
    if(-not $doctrine.drift.listeners.PSObject.Properties[$kind]){continue}
    foreach($item in @($doctrine.drift.listeners.$kind)){
      $ingressDrift += $item
      if($kind -eq 'changed' -and $item.PSObject.Properties['observed'] -and $item.PSObject.Properties['declared']){
        $declaredAddress=[string]$item.declared.address; $observedAddress=[string]$item.observed.address
        if($declaredAddress -in @('127.0.0.1','::1') -and $observedAddress -in @('0.0.0.0','::')){$exposureDrift += $item}
      } elseif($kind -eq 'unexpected' -and $item.PSObject.Properties['observed'] -and [string]$item.observed.address -in @('0.0.0.0','::')) {
        $exposureDrift += $item
      }
    }
  }
}
# Exact live firewall rules remain the authority for containment. In particular, Windows' stock RDP
# allow rules may not stay broadly enabled when RDP is declared as an OMEN/Tailscale-only recovery path.
$firewallRuleProbeSucceeded = $false
$allFirewallRules = @()
try { $allFirewallRules = @(Get-NetFirewallRule -PolicyStore ActiveStore -ErrorAction Stop); $firewallRuleProbeSucceeded = $true } catch {}
$broadRdpRules = @($allFirewallRules | Where-Object {
  $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' -and $_.DisplayGroup -eq 'Remote Desktop'
})
$containmentRules = @($allFirewallRules | Where-Object {
  $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Group -eq 'WilliamOS HERMES Appliance V1 Security Containment'
})
$ingressCount = @($ingressDrift | Where-Object { $null -ne $_ }).Count
$exposureCount = @($exposureDrift | Where-Object { $null -ne $_ }).Count
$firewallReadable = $profiles.Count -eq 3 -and $firewallRuleProbeSucceeded
$securityState = if(($profiles.Count -gt 0 -and -not $profilesHealthy) -or ($containedServices.Count -gt 0 -and -not $servicesContained) -or $exposureCount -gt 0 -or $broadRdpRules.Count -gt 0){'CRITICAL'}elseif($firewallReadable -and $servicesContained -and $containmentRules.Count -ge 3){'HEALTHY'}else{'UNKNOWN'}
$domains.security = Domain $securityState ($(if($securityState -eq 'HEALTHY'){'Ingress remains contained'}elseif($securityState -eq 'CRITICAL'){'Security containment has drifted'}else{'Exact firewall evidence is unavailable'})) @(
  Fact 'Firewall profiles' $(if($profilesHealthy){'Enabled | inbound block'}else{'Not safely observed'})
  Fact 'Apache / Device Portal' $(if($servicesContained){'Stopped | disabled'}else{'Containment drift'})
  Fact 'Listener evidence' $(if($doctrineFresh){"Fresh | $ingressCount doctrine discrepancies | $exposureCount exposure discrepancies"}else{'Missing or stale'})
  Fact 'Exposure discrepancies' $(if($exposureCount){(@($exposureDrift | ForEach-Object { if($_.PSObject.Properties['key']){[string]$_.key}else{'Unidentified listener exposure'} }) -join '; ')}else{'None in available listener evidence'})
  Fact 'Restricted RDP' $(if(-not $firewallReadable){'Firewall rules unreadable'}elseif($broadRdpRules.Count){"FAILED | $($broadRdpRules.Count) broad Remote Desktop allow rules enabled"}else{'No broad Remote Desktop allow rules'})
  Fact 'Containment rules' $(if($firewallReadable){"$($containmentRules.Count) enabled inbound rules"}else{'Unavailable'})
  Fact 'Listener observed' $(if($doctrine){[string]$doctrine.observedAt}else{'Unavailable'})
  Fact 'Exact firewall rules' $(if($firewallReadable){'Observed from ActiveStore'}else{'Unavailable'})
)

$doctrineState = if(-not $doctrineFresh){'UNKNOWN'}elseif([string]$doctrine.status -eq 'PASS'){'HEALTHY'}elseif([string]$doctrine.status -eq 'FAIL'){'CRITICAL'}else{'UNKNOWN'}
$domains.doctrine = Domain $doctrineState ($(if($doctrineState -eq 'HEALTHY'){'Declared and observed host state match'}elseif($doctrineState -eq 'CRITICAL'){'Permanent host drift detected'}else{'Standing doctrine is not yet current'})) @(
  Fact 'Result' $(if($doctrine){[string]$doctrine.code}else{'Not installed'})
  Fact 'Freshness' $(if($doctrineFresh){'Within 10 minutes'}else{'Not current'})
)

$legacyDockerBindingAvailable = $true
if([string]::IsNullOrWhiteSpace($LegacyDockerVhdxPath)){
  try {
    $profileRoot = ([IO.FileInfo][IO.Path]::GetFullPath($DockerSettingsPath)).Directory.Parent.Parent.Parent.FullName
    if([string]::IsNullOrWhiteSpace($profileRoot)){throw 'PROFILE_ROOT_UNAVAILABLE'}
    $LegacyDockerVhdxPath = Join-Path $profileRoot 'AppData\Local\Docker\wsl\disk\docker_data.vhdx'
  } catch { $legacyDockerBindingAvailable = $false }
}
$dockerVhdx = if($legacyDockerBindingAvailable){Get-Item -LiteralPath $LegacyDockerVhdxPath -ErrorAction SilentlyContinue}else{$null}
$workbenchOnG = Test-Path -LiteralPath 'G:\Workbench' -PathType Container
$dockerSettings = Read-Json $DockerSettingsPath
$dockerConfigured = $dockerSettings -and $dockerSettings.PSObject.Properties['CustomWslDistroDir'] -and [string]$dockerSettings.CustomWslDistroDir -eq 'G:\DockerDesktopWSL'
$dockerDataPresent = Test-Path -LiteralPath $DockerDataPath -PathType Leaf
$workbenchState = if($legacyDockerBindingAvailable -and $workbenchOnG -and -not $dockerVhdx -and $dockerConfigured -and $dockerDataPresent){'HEALTHY'}else{'DEGRADED'}
$domains.workbench = Domain $workbenchState ($(if($workbenchState -eq 'HEALTHY'){'Disposable work stays off the appliance volumes'}else{'Workbench separation is incomplete'})) @(
  Fact 'G:\Workbench' $(if($workbenchOnG){'Present'}else{'Not established'})
  Fact 'Docker disk' $(if(-not $legacyDockerBindingAvailable){'Legacy profile binding unavailable'}elseif($dockerVhdx){"Still on C: | $([math]::Round($dockerVhdx.Length/1GB,1)) GB"}elseif($dockerConfigured -and $dockerDataPresent){'Configured on G: | VHDX present'}else{'G: Docker data location not proven'})
)

# Each domain records its underlying evidence time separately from packet collection time.
$sourceTimes = @{
  appliance = $(if($nativeHealth){$nativeHealth.timestamp}else{$null})
  inference = $(if($owner){$owner.observedAt}else{$null})
  protection = $(if($latestProof){$latestProof.LastWriteTimeUtc.ToString('o')}else{$null})
  doctrine = $(if($doctrine){$doctrine.observedAt}else{$null})
  storage = $observedAt.ToString('o'); security = $(if($doctrine){$doctrine.observedAt}else{$observedAt.ToString('o')}); workbench = $observedAt.ToString('o')
}
foreach($name in $domains.Keys){
  $bound = if($name -eq 'appliance'){$NativeHealthMaxAgeSeconds}elseif($name -eq 'protection'){129600}elseif($name -in @('doctrine','security')){600}else{300}
  $stamp = $sourceTimes[$name]
  $age = if($stamp){try{($observedAt - ([datetime]$stamp).ToUniversalTime()).TotalSeconds}catch{$null}}else{$null}
  $fresh = $null -ne $age -and $age -ge -60 -and $age -le $bound
  $domains[$name].facts += @(Fact 'Evidence observed' $(if($stamp){[string]$stamp}else{'Unavailable'}); Fact 'Evidence freshness' $(if($fresh){'FRESH'}else{'STALE / UNAVAILABLE'}))
  if(-not $fresh -and $domains[$name].state -eq 'HEALTHY'){
    $domains[$name].state = 'UNKNOWN'
    $domains[$name].headline = 'Underlying evidence is stale or unavailable'
  }
}

$domainStates = @($domains.Keys | ForEach-Object { [string]$domains[$_].state })
$overall = if($domainStates -contains 'CRITICAL'){'CRITICAL'}elseif($domainStates -contains 'DEGRADED' -or $domainStates -contains 'UNKNOWN'){'DEGRADED'}else{'HEALTHY'}
$alerts = @()
if(Test-Path -LiteralPath $NativeAlertsPath -PathType Leaf){
  foreach($line in @(Get-Content -LiteralPath $NativeAlertsPath -Tail 1000 -ErrorAction SilentlyContinue)){
    if($line -match '^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) \[(WARN|FAIL|RECOVERY)\] (.+)$'){
      try { $alertTime = [datetime]::ParseExact($Matches[1], 'yyyy-MM-dd HH:mm', [Globalization.CultureInfo]::InvariantCulture).ToUniversalTime() } catch { continue }
      if($alertTime -ge $observedAt.AddHours(-48) -and $alertTime -le $observedAt.AddMinutes(1)){
        $alerts += [ordered]@{ observedAt=$alertTime.ToString('o'); severity=$Matches[2]; message=$Matches[3] }
      }
    }
  }
}

$status = [ordered]@{
  schema = 'hermes-console-status/1'
  applianceVersion = 'HERMES_APPLIANCE_V1'
  observedAt = $observedAt.ToString('o')
  overallState = $overall
  alerts = @($alerts)
  ownerActions = @($ownerActions)
  authorityState = 'UNAVAILABLE'
  activeWork = [ordered]@{ state = 'UNAVAILABLE'; headline = 'Active work unavailable: no authenticated appliance transaction source is connected.' }
  domains = $domains
}

$parent = Split-Path -Parent $OutputPath
if(-not (Test-Path -LiteralPath $parent -PathType Container)){ New-Item -ItemType Directory -Path $parent -Force | Out-Null }
$temp = "$OutputPath.$([Guid]::NewGuid().ToString('n')).tmp"
try {
  [IO.File]::WriteAllText($temp,(($status | ConvertTo-Json -Depth 10 -Compress)+"`n"),(New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temp -Destination $OutputPath -Force
} finally { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }

$status | ConvertTo-Json -Depth 10
