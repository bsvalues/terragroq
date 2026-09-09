# One-pane lab health: Hermes local checks + Atlas over SSH. Exit 0=ok, 1=warn, 2=fail.
param(
  [string]$OllamaBaseUrl = 'http://127.0.0.1:11434',
  [string]$CanonicalOwnerStatePath = 'C:\ProgramData\Hermes\inference\current-owner.json',
  [string]$OutputRoot = 'C:\HermesLab\hermes',
  [switch]$LocalOnly
)
$ErrorActionPreference = "SilentlyContinue"
$script:overall = "ok"; $script:problems = @()
function Bump($sev){ if($sev -eq "fail"){$script:overall="fail"; return}; if($sev -eq "warn" -and $script:overall -ne "fail"){$script:overall="warn"} }
function P($sev,$msg){ if($sev -ne "ok"){ $script:problems += $msg } }
function Write-HealthResult([string]$Overall, [object[]]$Problems, [object]$HermesDomain){
  New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
  $currentPath = Join-Path $OutputRoot 'lab-health.json'
  $previousOverall = $null
  try { $previousOverall = [string](Get-Content -LiteralPath $currentPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop).overall } catch {}
  $obj = [ordered]@{
    schema='hermes-native-health/1'
    timestamp=(Get-Date -Format o)
    overall=$Overall
    problems=@($Problems)
    domains=[ordered]@{ hermes=$HermesDomain }
  }
  $obj | ConvertTo-Json -Depth 8 -Compress | Out-File $currentPath -Encoding utf8
  $obj | ConvertTo-Json -Depth 8 -Compress | Add-Content (Join-Path $OutputRoot 'health-history.jsonl')
  if($Overall -ne $previousOverall -and ($null -ne $previousOverall -or $Overall -ne 'ok')){
    $severity = if($Overall -eq 'fail'){'FAIL'}elseif($Overall -eq 'warn'){'WARN'}else{'RECOVERY'}
    $message = if($Overall -eq 'ok'){"Native HERMES health recovered from $previousOverall"}else{($Problems -join '; ')}
    $alertPath = Join-Path $OutputRoot 'alerts.log'
    $alertWriter = Join-Path $PSScriptRoot 'send-hermes-alert.ps1'
    if(Test-Path -LiteralPath $alertWriter -PathType Leaf){
      & $alertWriter -Severity $severity -Message $message -AlertPath $alertPath | Out-Null
    } else {
      $fallback = "Native HERMES health changed to $Overall"
      ("{0} [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'),$severity,$fallback) | Add-Content $alertPath
    }
  }
}

Write-Host ("="*64)
Write-Host ("  LAB HEALTH  -  {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'))
Write-Host ("="*64)

# ---------------- RESOLUTION ----------------
# WHAT THIS SECTION IS FOR: on 2026-08-25 this script was reporting on three things that had all
# moved out from under it, and reporting confidently.
#
#   * It read free space on F:. That letter stopped existing when the NVMe was re-lettered G:, and
#     the absent-volume branch below substituted 0 GB -- so it printed "F: free : 0.0 GB [WARN]",
#     which reads as "the disk is full" rather than "there is no such disk". A health check that
#     mistakes an absent disk for a full one is worse than one that says nothing.
#   * It pinged and ssh'd 192.168.88.5 for ATLAS. ATLAS's DHCP lease moved to 192.168.88.8 on the
#     2026-08-25 power cycle, so this reported "ATLAS UNREACHABLE [FAIL]" every ten minutes about
#     an ATLAS that was up the whole time -- and that FAIL is the whole of HermesLabHealth's
#     lastResult=2. A monitor that cries wolf at a healthy node trains its reader to ignore it.
#   * It hard-coded AEGIS at 192.168.88.6 under a comment claiming that value came from the
#     canonical registry. It did, once, in 2026-08-18. A copy of a registry is not a registry.
#
# All three are now resolved from live truth, and a resolution that cannot answer is reported as
# FAIL rather than silently defaulted -- the same "resolve, then refuse" rule crossnode-sync.ps1
# and backup-volumes.ps1 follow. `Resolve-*` live in crossnode-sync-lib.ps1 so there is one owner.
$labLib = Join-Path $PSScriptRoot 'crossnode-sync-lib.ps1'
if(-not (Test-Path -LiteralPath $labLib -PathType Leaf)){
  Write-Host "  RESOLUTION: $labLib is missing, so nothing in this lab can be located.   [FAIL]"
  Write-Host ("  OVERALL: FAIL")
  exit 2
}
. $labLib
# The library asserts StrictMode for its own callers. This script predates it and deliberately
# reads properties off health JSON that a degraded node may not send, so its looser contract is
# restored here on purpose rather than left to collide.
Set-StrictMode -Off
$ErrorActionPreference = "SilentlyContinue"

$fabricRoot = "$env:USERPROFILE\.williamos\fabric"
$archiveVolumeLabel = "HERMES_NVME"
function Resolve-OrReport($what, [scriptblock]$action){
  try { & $action } catch {
    $msg = "$what unresolved: $($_.Exception.Message)"
    Bump "fail"; P "fail" $msg
    Write-Host ("  {0}   [FAIL]" -f $msg)
    $null
  }
}
$archiveRoot = Resolve-OrReport "archive volume '$archiveVolumeLabel'" { Resolve-ArchiveRoot -Label $archiveVolumeLabel }
$atlasNode = $null; $aegisNode = $null; $fabricSsh = $null
if(-not $LocalOnly){
  $atlasNode = Resolve-OrReport "atlas address" { Resolve-FabricNode -Fabric $fabricRoot -Node 'atlas' }
  $aegisNode = Resolve-OrReport "aegis address" { Resolve-FabricNode -Fabric $fabricRoot -Node 'aegis' }
  $fabricSsh = Resolve-OrReport "fabric ssh identity" { Resolve-FabricSshIdentity -Fabric $fabricRoot }
}
# Every remote probe below uses the fabric identity, not the calling account's ~/.ssh. That
# known_hosts pins 192.168.88.5 and has never seen 192.168.88.8: resolving the new address while
# keeping the old identity would turn "unreachable" into "Host key verification failed" and change
# nothing an operator sees. Measured on HERMES 2026-08-25, exit 255 either way.
#
# THERE IS DELIBERATELY NO FALLBACK OPTION LIST. If the identity does not resolve, the remote
# probes DO NOT RUN. A default of BatchMode+ConnectTimeout is not neutral: it hands the probe
# back to whatever keys and known_hosts the account running this task happens to hold, which is
# exactly the ambient transport this repair removed. That would contact lab nodes under
# credentials nobody resolved, and print a node status underneath a resolution that had already
# failed -- which reads as an answer. Refusing the probe is the honest output, and the FAIL is
# already recorded by Resolve-OrReport above.
$sshOpts = $null
if($fabricSsh){ $sshOpts = @($fabricSsh.SshOptions) }

# ---------------- HERMES ----------------
Write-Host "`n----- HERMES (AI / runtime) -----"
$cFree=[math]::Round((Get-Volume C).SizeRemaining/1GB,1)
$s= if($cFree -lt 10){"fail"}elseif($cFree -lt 25){"warn"}else{"ok"}; Bump $s; P $s "Hermes C: $cFree GB"; "  C: free : {0,7} GB   [{1}]" -f $cFree,$s.ToUpper()
# The archive volume is reported under the letter it currently holds, and an absent archive disk
# is a FAIL that says so -- not a 0 GB reading that looks like a full one. Nothing is backed up
# anywhere on this machine while this line is red.
if($archiveRoot){
  $av=Get-Volume -DriveLetter $archiveRoot.TrimEnd(':') -ErrorAction SilentlyContinue
  $aFree= if($av){[math]::Round($av.SizeRemaining/1GB,1)}else{0}
  $s= if($aFree -lt 10){"warn"}else{"ok"}; Bump $s; P $s "Hermes archive $archiveRoot $aFree GB"; "  {0} free: {1,6} GB   [{2}]  (label {3})" -f $archiveRoot,$aFree,$s.ToUpper(),$archiveVolumeLabel
} else {
  "  archive : NOT RESOLVED   [FAIL]  (no volume labelled {0})" -f $archiveVolumeLabel
}

$vhdx="C:\Users\bs\AppData\Local\Docker\wsl\disk\docker_data.vhdx"; $vhdxGB= if(Test-Path $vhdx){[math]::Round((Get-Item $vhdx).Length/1GB,1)}else{"?"}
$job=Start-Job{docker version --format "{{.Server.Version}}"}; $sv=$null; if(Wait-Job $job -Timeout 12){$sv=(Receive-Job $job)}; Remove-Job $job -Force
if($sv){ "  Docker  : up (v{0}), vhdx {1} GB   [OK]" -f ($sv.Trim()),$vhdxGB } else { "  Docker  : NOT RESPONDING   [FAIL]"; Bump "fail"; P "fail" "Hermes docker down" }

$os=Get-CimInstance Win32_OperatingSystem; $ramPct=[math]::Round($os.FreePhysicalMemory*100/$os.TotalVisibleMemorySize)
$s= if($ramPct -lt 8){"warn"}else{"ok"}; Bump $s; P $s "Hermes RAM ${ramPct}%"; "  RAM     : {0,3}% free ({1} GB total)   [{2}]" -f $ramPct,[math]::Round($os.TotalVisibleMemorySize/1MB),$s.ToUpper()
$cpu=(Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average; "  CPU     : {0}% load" -f $cpu

# The P40 envelope is owned by p40-guard.ps1. This monitor consumes that state rather than carrying
# a second set of thermal and power thresholds.
$guard = Join-Path $PSScriptRoot 'p40-guard.ps1'
if(Test-Path -LiteralPath $guard){
  $null = & $guard -Quiet 2>&1; $grc = $LASTEXITCODE
  $gj = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'p40-guard.json') -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
  $gs = switch($grc){ 2 {'fail'} 1 {'warn'} default {'ok'} }
  Bump $gs
  if($gj){
    "  P40     : {0}C @ {1} load | cap {2}W (target {3}W) | {4} | chassis ~{5}C   [{6}]" -f `
      $gj.temp_c,$gj.load_class,$gj.power_limit_w,$gj.power_limit_target_w,$gj.driver_model,$gj.chassis_proxy_c,$gs.ToUpper()
    foreach($pr in $gj.problems){ P $gs $pr }
  } else { "  P40     : guard produced no state   [WARN]"; Bump "warn"; P "warn" "p40-guard produced no state" }
} else { "  P40     : p40-guard.ps1 MISSING -- inference GPU unmonitored   [FAIL]"; Bump "fail"; P "fail" "p40-guard.ps1 missing" }

$g = nvidia-smi --query-gpu=name,temperature.gpu,memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits 2>$null
if($g){ foreach($line in $g){ $p=$line -split ',\s*'; if($p[0] -match '3050'){ $gt=[int]$p[1]; $s= if($gt -gt 85){"warn"}else{"ok"}; Bump $s; "  GPU     : {0} | {1}C | {2}/{3} MB | {4}% util   [{5}]" -f $p[0],$p[1],$p[2],$p[3],$p[4],$s.ToUpper() } } } else { "  GPU     : nvidia-smi n/a" }

# Compute services (this is what Hermes is FOR). A healthy endpoint is necessary but not sufficient:
# the protected owner receipt proves it belongs to the canonical SYSTEM task, not a hand-started copy.
$owner = $null
try { $owner = Get-Content -LiteralPath $CanonicalOwnerStatePath -Raw | ConvertFrom-Json -ErrorAction Stop } catch {}
$ownerAgeSeconds = $null
if($owner){ try { $ownerAgeSeconds = ((Get-Date).ToUniversalTime() - ([datetime]$owner.observedAt).ToUniversalTime()).TotalSeconds } catch {} }
$listenerPid = $null
$ollamaListeners = @()
foreach($line in @(netstat -ano -p tcp 2>$null)){
  if($line -match '^\s*TCP\s+(\S+):11434\s+\S+\s+LISTENING\s+(\d+)\s*$'){
    $ollamaListeners += [pscustomobject]@{ Address=$Matches[1]; Pid=[int]$Matches[2] }
  }
}
$loopbackListenerExact = $ollamaListeners.Count -eq 1 -and $ollamaListeners[0].Address -eq '127.0.0.1'
if($loopbackListenerExact){ $listenerPid = $ollamaListeners[0].Pid }
$ownerExact = $owner -and
  [string]$owner.schema -eq 'hermes-ollama-owner-state/1' -and
  [string]$owner.owner -eq 'WilliamOS-HERMES-Ollama' -and
  [string]$owner.state -eq 'SERVING' -and
  [string]$owner.listen -eq '127.0.0.1:11434' -and
  [string]$owner.executable -eq 'D:\HermesServices\ollama\v0.9.2\ollama.exe' -and
  [string]$owner.models -eq 'G:\HermesData\ollama\models' -and  # WO-HERMES-APPL-006B: serving store is G:; D: is verified rollback
  [string]$owner.gpuUuid -eq 'GPU-4f7d4396-9304-d12f-7e9b-7f04d1236fc2' -and
  [int]$owner.powerCapWatts -eq 150 -and
  $null -ne $ownerAgeSeconds -and $ownerAgeSeconds -ge -60 -and $ownerAgeSeconds -le 120 -and
  $loopbackListenerExact -and $null -ne $listenerPid -and [int]$owner.pid -eq $listenerPid
if(-not $ownerExact){
  "  Ollama  : canonical owner receipt missing, stale, or inconsistent   [FAIL]"
  Bump 'fail'; P 'fail' 'Ollama canonical owner unproven'
}
$ollamaState = 'DOWN'
try{
  $tags = Invoke-RestMethod "$OllamaBaseUrl/api/tags" -TimeoutSec 10
  $ollamaState = if($tags.models -and $tags.models.Count -gt 0){ "OK:" + $tags.models.Count } else { 'EMPTY_CATALOGUE' }
}catch{}
if($ollamaState -like 'OK:*' -and $ownerExact){ "  Ollama  : canonical owner serving, {0} models   [OK]" -f $ollamaState.Split(':')[1] }
elseif($ollamaState -eq 'EMPTY_CATALOGUE'){ "  Ollama  : responding but knows NO models -- model store lost   [FAIL]"; Bump 'fail'; P 'fail' 'Ollama empty catalogue' }
else { "  Ollama  : endpoint unavailable or ownership unproven   [FAIL]"; Bump 'fail'; P 'fail' 'Ollama canonical endpoint down' }
try { $r=Invoke-WebRequest http://localhost:3000/health -TimeoutSec 6 -UseBasicParsing; "  OpenWebUI: HTTP $($r.StatusCode)   [OK]" } catch { "  OpenWebUI: not responding   [WARN]"; Bump "warn"; P "warn" "Open WebUI down" }

foreach($t in @(@("Backup","HermesVolumeBackup"),@("X-sync","HermesCrossNodeBackupSync"),@("Model-sync","HermesModelForgeSync"))){
  $i=Get-ScheduledTaskInfo -TaskName $t[1]
  if($i){
    $res=$i.LastTaskResult
    if($res -eq 267011){ "  {0,-7} : scheduled, not yet run   [OK]" -f $t[0] }   # 0x41303 = never run
    else {
      $age=[math]::Round(((Get-Date)-$i.LastRunTime).TotalHours,1)
      $bad = ($res -ne 0 -and $res -ne 267009) -or $age -gt 26
      $s= if($bad){"warn"}else{"ok"}; Bump $s; P $s "$($t[0]) task"
      "  {0,-7} : last {1}h ago, result {2}   [{3}]" -f $t[0],$age,$res,$s.ToUpper() }
  }
  else { "  {0,-7} : task MISSING   [WARN]" -f $t[0]; Bump "warn"; P "warn" "$($t[0]) task missing" }
}

$hermesDomain = [ordered]@{ overall=$script:overall; problems=@($script:problems) }
if($LocalOnly){
  Write-HealthResult -Overall $script:overall -Problems $script:problems -HermesDomain $hermesDomain
  switch($script:overall){ 'fail'{exit 2}; 'warn'{exit 1}; default{exit 0} }
}

# ---------------- ATLAS ----------------
Write-Host "`n----- ATLAS (services) -----"
if(-not $atlasNode){ "  ADDRESS UNRESOLVED   [FAIL]" }
elseif(-not (Test-Connection $atlasNode.Host -Count 1 -Quiet)){ "  UNREACHABLE (ping {0})   [FAIL]" -f $atlasNode.Host; Bump "fail"; P "fail" "Atlas unreachable at $($atlasNode.Host)" }
elseif(-not $sshOpts){ "  Address : {0}" -f $atlasNode.Endpoint; "  PROBE SKIPPED - no resolved fabric identity   [FAIL]" }
else {
  "  Address : {0}" -f $atlasNode.Endpoint
  $ajson = ssh @sshOpts $atlasNode.Endpoint "/home/bs/health-atlas.sh"
  $a=$null; try { $a=($ajson -join "`n") | ConvertFrom-Json } catch {}
  if($a){
    $s=$a.status; Bump $s; P $s "Atlas $($a.issues)"
    "  Status  : {0}" -f $a.status.ToUpper()
    "  Root fs : {0} GB free ({1}% used)" -f $a.root_avail_gb,$a.root_use_pct
    "  Docker  : {0} | {1}" -f $a.docker_active,$a.docker_disk
    foreach($svc in @(@("postgres",$a.postgres),@("redis",$a.redis),@("mongo",$a.mongo))){ if($svc[1] -ne "running"){ Bump "warn"; P "warn" "Atlas $($svc[0]) $($svc[1])" } }
    "  State   : postgres={0} redis={1} mongo={2}" -f $a.postgres,$a.redis,$a.mongo
    $fp = if($a.forge_primary){$a.forge_primary}else{"unknown"}
    if($fp -ne "mounted"){ Bump "fail"; P "fail" "FORGE_PRIMARY $fp" }
    "  Forge   : PRIMARY={0} | sources {1}" -f $fp,$a.forge_drives
    "  CPU     : load {0} / {1} cores | {2}C" -f $a.load1,$a.cores,$a.cpu_temp_c
    "  RAM     : {0}% free ({1} GB total)" -f $a.ram_avail_pct,[math]::Round($a.ram_total_mb/1024)
    "  SMART   : {0}" -f $a.smart
    "  Backup  : {0}h old" -f $a.backup_age_hours
    if($a.issues -ne "none"){ "  Issues  : {0}" -f $a.issues }
  } else { "  health check unparseable   [WARN]"; Bump "warn"; P "warn" "Atlas health parse" }
}

# ---------------- AEGIS ----------------
Write-Host "`n----- AEGIS (CPU/CI/backup node) -----"
# Read from nodes.json on every run rather than copied out of it once. The old literal happened to
# still be right; ATLAS's did not, and there is no way to tell which is which by looking.
if(-not $aegisNode){ "  ADDRESS UNRESOLVED   [FAIL]" }
elseif(-not (Test-Connection $aegisNode.Host -Count 1 -Quiet)){ "  UNREACHABLE (ping {0})   [FAIL]" -f $aegisNode.Host; Bump "fail"; P "fail" "Aegis unreachable at $($aegisNode.Host)" }
elseif(-not $sshOpts){ "  Address : {0}" -f $aegisNode.Endpoint; "  PROBE SKIPPED - no resolved fabric identity   [FAIL]" }
else {
  "  Address : {0}" -f $aegisNode.Endpoint
  $gjson = ssh @sshOpts $aegisNode.Endpoint "/home/bs/health-aegis.sh"
  $g=$null; try { $g=($gjson -join "`n") | ConvertFrom-Json } catch {}
  if($g){
    $s=$g.status; Bump $s; P $s "Aegis $($g.issues)"
    "  Status  : {0}" -f $g.status.ToUpper()
    "  NVMe    : {0} GB free ({1}% used)" -f $g.root_avail_gb,$g.root_use_pct
    "  Docker  : {0} | {1} | portainer_agent={2}" -f $g.docker_active,$g.docker_disk,$g.portainer_agent
    "  CPU     : load {0} / {1} cores | {2}C" -f $g.load1,$g.cores,$g.cpu_temp_c
    "  RAM     : {0}% free ({1} GB total)" -f $g.ram_avail_pct,[math]::Round($g.ram_total_mb/1024)
    "  SMART   : {0}" -f $g.smart
    "  NIC     : {0}" -f $g.nic
    "  Storage : {0}" -f $g.storage_role
    if($g.compute_capability_health){ "  Compute : {0}" -f $g.compute_capability_health }
    if($g.backup_capability_health){
      if($g.backup_capability_health -eq "READY"){ "  Backup  : READY | last {0} | restore {1} | {2}h" -f $g.backup.last_backup,$g.backup.last_restore_verify,$g.backup.age_hours }
      else { "  Backup  : {0} | reason {1} | last {2} | restore {3} | {4}h" -f $g.backup_capability_health,$g.backup_reason,$g.backup.last_backup,$g.backup.last_restore_verify,$g.backup.age_hours }
    }
    if($g.issues -ne "none"){ "  Issues  : {0}" -f $g.issues }
  } else { "  health check unparseable   [WARN]"; Bump "warn"; P "warn" "Aegis health parse" }
}

Write-Host "`n$("="*64)"
Write-Host ("  OVERALL: {0}" -f $script:overall.ToUpper())
if($script:problems.Count){ Write-Host ("  Attention: {0}" -f ($script:problems -join "; ")) }
Write-Host ("="*64)

Write-HealthResult -Overall $script:overall -Problems $script:problems -HermesDomain $hermesDomain
switch($script:overall){ "fail"{exit 2}; "warn"{exit 1}; default{exit 0} }
