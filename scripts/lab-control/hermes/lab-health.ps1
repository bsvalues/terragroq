# One-pane lab health: Hermes local checks + Atlas over SSH. Exit 0=ok, 1=warn, 2=fail.
$ErrorActionPreference = "SilentlyContinue"
$script:overall = "ok"; $script:problems = @()
function Bump($sev){ if($sev -eq "fail"){$script:overall="fail"; return}; if($sev -eq "warn" -and $script:overall -ne "fail"){$script:overall="warn"} }
function P($sev,$msg){ if($sev -ne "ok"){ $script:problems += $msg } }

Write-Host ("="*64)
Write-Host ("  LAB HEALTH  -  {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'))
Write-Host ("="*64)

# ---------------- HERMES ----------------
Write-Host "`n----- HERMES (AI / runtime) -----"
$cFree=[math]::Round((Get-Volume C).SizeRemaining/1GB,1)
$fv=Get-Volume F -ErrorAction SilentlyContinue; $fFree= if($fv){[math]::Round($fv.SizeRemaining/1GB,1)}else{0}
$s= if($cFree -lt 10){"fail"}elseif($cFree -lt 25){"warn"}else{"ok"}; Bump $s; P $s "Hermes C: $cFree GB"; "  C: free : {0,7} GB   [{1}]" -f $cFree,$s.ToUpper()
$s= if($fFree -lt 10){"warn"}else{"ok"}; Bump $s; P $s "Hermes F: $fFree GB"; "  F: free : {0,7} GB   [{1}]" -f $fFree,$s.ToUpper()

$vhdx="C:\Users\bs\AppData\Local\Docker\wsl\disk\docker_data.vhdx"; $vhdxGB= if(Test-Path $vhdx){[math]::Round((Get-Item $vhdx).Length/1GB,1)}else{"?"}
$job=Start-Job{docker version --format "{{.Server.Version}}"}; $sv=$null; if(Wait-Job $job -Timeout 12){$sv=(Receive-Job $job)}; Remove-Job $job -Force
if($sv){ "  Docker  : up (v{0}), vhdx {1} GB   [OK]" -f ($sv.Trim()),$vhdxGB } else { "  Docker  : NOT RESPONDING   [FAIL]"; Bump "fail"; P "fail" "Hermes docker down" }

$os=Get-CimInstance Win32_OperatingSystem; $ramPct=[math]::Round($os.FreePhysicalMemory*100/$os.TotalVisibleMemorySize)
$s= if($ramPct -lt 8){"warn"}else{"ok"}; Bump $s; P $s "Hermes RAM ${ramPct}%"; "  RAM     : {0,3}% free ({1} GB total)   [{2}]" -f $ramPct,[math]::Round($os.TotalVisibleMemorySize/1MB),$s.ToUpper()
$cpu=(Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average; "  CPU     : {0}% load" -f $cpu

$g = nvidia-smi --query-gpu=name,temperature.gpu,memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits 2>$null
if($g){ foreach($line in $g){ $p=$line -split ',\s*'; if($p[0] -match '3050'){ $gt=[int]$p[1]; $s= if($gt -gt 85){"warn"}else{"ok"}; Bump $s; "  GPU     : {0} | {1}C | {2}/{3} MB | {4}% util   [{5}]" -f $p[0],$p[1],$p[2],$p[3],$p[4],$s.ToUpper() } } } else { "  GPU     : nvidia-smi n/a" }

# Compute services (this is what Hermes is FOR)
if(docker ps --filter name=ollama --filter status=running -q 2>$null){ "  Ollama  : running   [OK]" } else { "  Ollama  : DOWN   [FAIL]"; Bump "fail"; P "fail" "Ollama down" }
try { $r=Invoke-WebRequest http://localhost:3000/health -TimeoutSec 6 -UseBasicParsing; "  OpenWebUI: HTTP $($r.StatusCode)   [OK]" } catch { "  OpenWebUI: not responding   [WARN]"; Bump "warn"; P "warn" "Open WebUI down" }

foreach($t in @(@("Backup","HermesVolumeBackup"),@("X-sync","HermesCrossNodeBackupSync"))){
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

# ---------------- ATLAS ----------------
Write-Host "`n----- ATLAS (services) -----"
if(-not (Test-Connection 192.168.88.5 -Count 1 -Quiet)){ "  UNREACHABLE (ping)   [FAIL]"; Bump "fail"; P "fail" "Atlas unreachable" }
else {
  $ajson = ssh -o BatchMode=yes -o ConnectTimeout=8 bs@192.168.88.5 "/home/bs/health-atlas.sh"
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
$aegisIp = "192.168.88.6"   # canonical fabric registry (nodes.json), live-probed 2026-08-18
if(-not (Test-Connection $aegisIp -Count 1 -Quiet)){ "  UNREACHABLE (ping)   [FAIL]"; Bump "fail"; P "fail" "Aegis unreachable" }
else {
  $gjson = ssh -o BatchMode=yes -o ConnectTimeout=8 bs@$aegisIp "/home/bs/health-aegis.sh"
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

# machine-readable combined status
$obj = [ordered]@{ timestamp=(Get-Date -Format o); overall=$script:overall; problems=$script:problems }
$obj | ConvertTo-Json -Compress | Out-File "C:\HermesLab\hermes\lab-health.json" -Encoding utf8
$obj | ConvertTo-Json -Compress | Add-Content "C:\HermesLab\hermes\health-history.jsonl"

# ALERT on failure/warn (things that actually matter). Persistent alert log; ntfy push if a topic is configured.
if($script:overall -ne "ok"){
  $line = "{0} [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $script:overall.ToUpper(), ($script:problems -join '; ')
  $line | Add-Content "C:\HermesLab\hermes\alerts.log"
  $ntfy = "$env:HERMES_NTFY_TOPIC"   # set this env var to a ntfy.sh topic to get phone push alerts
  if($ntfy){ try { Invoke-RestMethod -Uri "https://ntfy.sh/$ntfy" -Method Post -Body "LAB $($script:overall.ToUpper()): $($script:problems -join '; ')" -Headers @{Title="Lab needs attention"; Priority="high"} -TimeoutSec 10 } catch {} }
}
switch($script:overall){ "fail"{exit 2}; "warn"{exit 1}; default{exit 0} }
