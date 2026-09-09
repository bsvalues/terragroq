<#
  HermesMorningReport - daily deep-dive scan + progress report for the HERMES lab.

  Doctrine (mirrors the HERMES_APPLIANCE_V1 acceptance gates):
   - READ-ONLY. This script never changes machine state.
   - INV-4: a dead/unreadable source resolves to UNKNOWN, never to green.
   - Always writes a complete report even if individual probes fail, plus a
     heartbeat proving it ran (so "report missing" is itself detectable).
   - Facts that need elevation are reported as NEEDS-ELEVATION, never guessed.

  Output: G:\HermesReports\hermes-morning-YYYYMMDD.md  (+ hermes-morning-latest.md)
  Heartbeat: G:\HermesReports\morning-report.heartbeat
#>

$ErrorActionPreference = 'Continue'
$HermesDir   = 'C:\HermesLab\hermes'
$ReportDir   = 'G:\HermesReports'
$HealthStateRoot = 'C:\ProgramData\Hermes\health'
$P40StateRoot = 'C:\ProgramData\Hermes\p40'
$Heartbeat   = Join-Path $ReportDir 'morning-report.heartbeat'
$ClaudeExe   = 'C:\Users\bs\.local\bin\claude.exe'
$EnableAnalystBrief = $false     # OFF: headless claude can't refresh OAuth in a scheduled context.
                                 # The deterministic report is complete + authoritative. Flip to $true
                                 # only once a durable headless auth (API key) is configured.
$AnalystTimeoutSec  = 180
$now = Get-Date

# --- problem accumulator (severity: FAIL > DEGRADED > UNKNOWN > ok) --------
$problems = New-Object System.Collections.Generic.List[object]
function Add-Problem([string]$sev, [string]$msg) { $problems.Add([pscustomobject]@{ Sev = $sev; Msg = $msg }) }
function Safe([scriptblock]$b, $fallback = $null) { try { & $b } catch { $fallback } }
function AgeMin($path) { try { [math]::Round(((Get-Date) - (Get-Item $path).LastWriteTime).TotalMinutes, 1) } catch { $null } }

$L = New-Object System.Collections.Generic.List[string]   # report lines
function W([string]$s='') { $L.Add($s) }

# ===========================================================================
# SECTION 1 - Bulletproof-four progress (tracks WO #1031/#1032/#1033 live)
# ===========================================================================
$prog = New-Object System.Collections.Generic.List[string]

# 1a. Backups fresh + off-host  (WO #1031 / REC-1)
$bkNewest = $null; $crossNewest = $null
$bkProbe = Safe { Get-ChildItem 'G:\lab-backups\hermes-volumes' -Filter 'hermes-recovery-proof-*.tar.gz' -File -ErrorAction Stop |
  Where-Object { $_.Name -match '^hermes-recovery-proof-\d{8}_\d{6}\.tar\.gz$' } }
$crossProbe = Safe { Get-ChildItem 'G:\lab-backups\crossnode\atlas' -Directory -ErrorAction Stop |
  Where-Object { $_.Name -match '^\d{8}_\d{6}$' -and @(Get-ChildItem -LiteralPath $_.FullName -File -Recurse -ErrorAction Stop).Count -gt 0 } }
if ($bkProbe) { $bkNewest = ($bkProbe | Measure-Object LastWriteTime -Maximum).Maximum }
if ($crossProbe) { $crossNewest = ($crossProbe | Measure-Object LastWriteTime -Maximum).Maximum }
if ($bkNewest) {
  $bkAgeH = [math]::Round(($now - $bkNewest).TotalHours, 1)
  $prog.Add("- **Backups (local):** newest set $bkAgeH h old ($($bkNewest.ToString('yyyy-MM-dd HH:mm')))")
  if ($bkAgeH -gt 48) { Add-Problem 'FAIL' "Local backup chain stale: newest set is $bkAgeH h old (>48h)" }
  elseif ($bkAgeH -gt 26) { Add-Problem 'DEGRADED' "Local backup slightly stale: $bkAgeH h" }
} else { $prog.Add("- **Backups (local):** UNKNOWN - G:\lab-backups\hermes-volumes unreadable/empty"); Add-Problem 'UNKNOWN' 'Local backup freshness unreadable' }
if ($crossNewest) {
  $cxAgeH = [math]::Round(($now - $crossNewest).TotalHours, 1)
  $offhost = if ($cxAgeH -le 48) { 'YES' } else { "STALE ($cxAgeH h)" }
  $prog.Add("- **Off-host copy (Atlas):** $offhost - newest $($crossNewest.ToString('yyyy-MM-dd HH:mm'))")
  if ($cxAgeH -gt 48) { Add-Problem 'FAIL' "Off-host (Atlas) backup stale: $cxAgeH h - DR copy not current" }
} else { $prog.Add("- **Off-host copy (Atlas):** NONE VISIBLE - no cross-node DR copy readable"); Add-Problem 'FAIL' 'No current off-host DR copy (single-chassis risk)' }

# 1b. Native alert path. External transports are intentionally outside Appliance V1.
$nativeAlertPath = Join-Path $HealthStateRoot 'alerts.log'
$prog.Add("- **Native alerts:** $(if(Test-Path -LiteralPath $nativeAlertPath -PathType Leaf){'ACTIVE - persistent alerts.log'}else{'READY - created on first warning/failure'})")

# 1c. Golden stack still on the 13-yr-old 840  (STOR-2)
# WO-HERMES-APPL-006B: the SERVING store location is the truth, not whether a path exists.
# D: is intentionally kept as the verified rollback copy, so path-existence on D: is not drift.
$ownerState = Safe { Get-Content 'C:\ProgramData\Hermes\inference\current-owner.json' -Raw | ConvertFrom-Json } $null
$gStore = Safe { Test-Path 'G:\HermesData\ollama\models' } $false
if ($ownerState -and [string]$ownerState.models -like 'G:\*' -and [string]$ownerState.state -eq 'SERVING') {
  $prog.Add("- **Model store off the 840:** YES - serving from G: ($($ownerState.modelCount) models). D: retained as verified rollback")
} elseif ($ownerState) {
  $prog.Add("- **Model store off the 840:** NOT YET - live store is $($ownerState.models) (state $($ownerState.state)). G: store present: $gStore"); Add-Problem 'DEGRADED' 'Golden model store not yet serving from G:'
} else {
  $prog.Add("- **Model store off the 840:** UNKNOWN - owner state unreadable. G: store present: $gStore"); Add-Problem 'DEGRADED' 'Cannot read ollama owner state for model-store truth'
}

# 1d. SSH key-only  (ING-2)
$sshpw = Safe {
  $cfg = Get-Content 'C:\ProgramData\ssh\sshd_config' -ErrorAction Stop
  if ($cfg | Where-Object { $_ -match '^\s*PasswordAuthentication\s+no' }) { 'key-only' } else { 'PASSWORD ENABLED' }
} 'UNKNOWN'
$prog.Add("- **SSH auth:** $sshpw")
if ($sshpw -eq 'PASSWORD ENABLED') { Add-Problem 'DEGRADED' 'sshd still accepts password authentication' }
elseif ($sshpw -eq 'UNKNOWN') { Add-Problem 'UNKNOWN' 'sshd_config unreadable' }

# 1e. Sensitive services LAN-exposed  (ING-1)
$exposed = Safe {
  Get-NetTCPConnection -State Listen -ErrorAction Stop |
    Where-Object { $_.LocalPort -in 5433,6379,9000,8080 -and $_.LocalAddress -in '0.0.0.0','::' } |
    Select-Object -ExpandProperty LocalPort -Unique
}
$ex = @($exposed)
if ($ex.Count -gt 0) { $prog.Add("- **Perimeter:** $($ex.Count) sensitive port(s) on 0.0.0.0 -> $($ex -join ', ')"); Add-Problem 'DEGRADED' "Sensitive services still LAN-exposed: $($ex -join ', ')" }
else { $prog.Add("- **Perimeter:** no sensitive DB/admin ports on 0.0.0.0") }

# ===========================================================================
# SECTION 2 - Vitals
# ===========================================================================
$vitals = New-Object System.Collections.Generic.List[string]

# Disks
foreach ($d in 'C','D','G') {
  $v = Safe { Get-Volume -DriveLetter $d -ErrorAction Stop }
  if ($v) {
    $freeGB = [math]::Round($v.SizeRemaining/1GB,1); $sizeGB = [math]::Round($v.Size/1GB,1)
    $pct = if ($v.Size) { [math]::Round(100*$v.SizeRemaining/$v.Size,1) } else { 0 }
    $vitals.Add("- **${d}:** $freeGB GB free of $sizeGB GB ($pct`%)")
    if ($d -eq 'C' -and $pct -lt 8)  { Add-Problem 'FAIL' "C: critically full ($pct% free)" }
    elseif ($d -eq 'C' -and $pct -lt 15) { Add-Problem 'DEGRADED' "C: low on space ($pct% free)" }
  } else { $vitals.Add("- **${d}:** UNKNOWN"); Add-Problem 'UNKNOWN' "Volume ${d}: unreadable" }
}

# P40 - prefer the guard's own fresh telemetry, fall back to nvidia-smi
$p40 = $null; $capOK = $null
$p40json = Safe { Get-Content (Join-Path $P40StateRoot 'p40-watch.heartbeat') -Raw -ErrorAction Stop | ConvertFrom-Json }
$p40age = AgeMin (Join-Path $P40StateRoot 'p40-watch.heartbeat')
if ($p40json -and $p40age -ne $null -and $p40age -le 10) {
  $temp = Safe { [double]$p40json.temp_c }; $cap = Safe { [int]$p40json.power_limit_w }; $load = $p40json.load_class; $delta = $p40json.p40_chassis_delta_c
  $vitals.Add("- **Tesla P40:** ${temp}C (chassis delta ${delta}C), cap ${cap}W, load $load, thermal-slowdown $($p40json.thermal_slowdown) (guard telemetry, $p40age min old)")
  if ($null -eq $cap -or $null -eq $temp) { Add-Problem 'UNKNOWN' 'P40 guard telemetry malformed'; $capOK=$null }
  elseif ($cap -ne 150) { Add-Problem 'FAIL' "P40 power cap is ${cap}W, doctrine is 150W"; $capOK=$false } else { $capOK=$true }
  if ($null -ne $temp -and $temp -ge 87) { Add-Problem 'FAIL' "P40 hot: ${temp}C" }
} else {
  $smi = Safe { & nvidia-smi --query-gpu=name,temperature.gpu,power.limit,ecc.errors.uncorrected.volatile.total --format=csv,noheader,nounits 2>$null }
  if ($smi) { $vitals.Add("- **GPU (nvidia-smi):** $smi"); Add-Problem 'DEGRADED' 'P40 guard heartbeat stale - used nvidia-smi fallback' }
  else { $vitals.Add("- **Tesla P40:** UNKNOWN - guard heartbeat stale and nvidia-smi unavailable"); Add-Problem 'UNKNOWN' 'P40 state unreadable' }
}

# ollama liveness + loaded model + loopback bind
$oll = Safe { Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 8 -ErrorAction Stop }
if ($oll) {
  $nmodels = @($oll.models).Count
  $ps = Safe { Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/ps' -TimeoutSec 8 -ErrorAction Stop }
  $loaded = if ($ps -and @($ps.models).Count) { ($ps.models | ForEach-Object { $_.name }) -join ', ' } else { 'none loaded (idle)' }
  $vitals.Add("- **ollama:** UP on 127.0.0.1:11434, $nmodels models, loaded: $loaded")
} else { $vitals.Add("- **ollama:** DOWN - 127.0.0.1:11434 not answering /api/tags"); Add-Problem 'FAIL' 'ollama inference endpoint not responding' }
$bind = Safe { Get-NetTCPConnection -State Listen -LocalPort 11434 -ErrorAction Stop | Select-Object -ExpandProperty LocalAddress -Unique }
if ($bind) { $bad = @($bind) | Where-Object { $_ -notin '127.0.0.1','::1' }
  if ($bad) { Add-Problem 'FAIL' "ollama bound to non-loopback: $($bad -join ', ') - security doctrine breach" } }

# Heartbeat freshness (supervision alive?)
foreach ($hb in @(
  @{ n='ollama-owner';    f='..\..\ProgramData\Hermes\inference\current-owner.json'; max=20 },
  @{ n='p40-watch';       p=(Join-Path $P40StateRoot 'p40-watch.heartbeat'); max=10 },
  @{ n='lab-health';      p=(Join-Path $HealthStateRoot 'lab-health.json');  max=90 })) {
  if ($hb.n -eq 'ollama-owner') {
    $ownerState = Safe { Get-Content 'C:\ProgramData\Hermes\inference\current-owner.json' -Raw -ErrorAction Stop | ConvertFrom-Json }
    if (-not $ownerState) { $vitals.Add("- **ollama-owner state:** MISSING"); Add-Problem 'FAIL' 'ollama owner-state missing - supervision may be down' }
    else {
      $ownerAge = Safe { [math]::Round(((Get-Date) - [datetime]$ownerState.observedAt).TotalMinutes, 1) }
      if($null -eq $ownerAge){$vitals.Add('- **ollama-owner state:** MALFORMED');Add-Problem 'UNKNOWN' 'ollama owner-state timestamp invalid';continue}
      $ownerServing = ($ownerState.state -eq 'SERVING') -and (Safe { (Invoke-WebRequest -Uri 'http://127.0.0.1:11434/' -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } $false)
      if ($ownerAge -gt $hb.max -or -not $ownerServing) { $vitals.Add("- **ollama-owner state:** STALE/NOT-SERVING (state=$($ownerState.state), observed $ownerAge min ago)"); Add-Problem 'FAIL' "ollama owner-state stale or not serving ($ownerAge min, state=$($ownerState.state))" }
      else { $vitals.Add("- **ollama-owner state:** SERVING, fresh ($ownerAge min, $($ownerState.modelCount) models)" ) }
    }
    continue
  }
  $age = AgeMin $hb.p
  if ($age -eq $null) { $vitals.Add("- **$($hb.n) heartbeat:** MISSING"); Add-Problem 'FAIL' "$($hb.n) heartbeat missing" }
  elseif ($age -gt $hb.max) { $vitals.Add("- **$($hb.n) heartbeat:** STALE ($age min, expected <$($hb.max))"); Add-Problem 'FAIL' "$($hb.n) heartbeat stale ($age min) - supervision may be down" }
  else { $vitals.Add("- **$($hb.n) heartbeat:** fresh ($age min)") }
}

# lab-health.json standing verdict + problems
$lh = Safe { Get-Content (Join-Path $HealthStateRoot 'lab-health.json') -Raw -ErrorAction Stop | ConvertFrom-Json }
if ($lh) {
  $vitals.Add("- **lab-health verdict:** $($lh.overall)")
  if ($lh.problems) { foreach ($p in $lh.problems) { $vitals.Add("    - standing: $p"); if ($lh.overall -eq 'fail') { Add-Problem 'FAIL' "lab-health: $p" } else { Add-Problem 'DEGRADED' "lab-health: $p" } } }
} else { $vitals.Add("- **lab-health verdict:** UNKNOWN"); Add-Problem 'UNKNOWN' 'lab-health.json unreadable' }

# ===========================================================================
# VERDICT (INV-4: unknown never renders as green)
# ===========================================================================
$hasFail = ($problems | Where-Object Sev -eq 'FAIL').Count -gt 0
$hasDeg  = ($problems | Where-Object Sev -eq 'DEGRADED').Count -gt 0
$hasUnk  = ($problems | Where-Object Sev -eq 'UNKNOWN').Count -gt 0
$verdict = if ($hasFail) { 'FAILED' } elseif ($hasDeg -or $hasUnk) { 'DEGRADED' } else { 'HEALTHY' }
$badge = @{ HEALTHY='HEALTHY'; DEGRADED='DEGRADED'; FAILED='FAILED' }[$verdict]

$fails = @($problems | Where-Object Sev -eq 'FAIL' | ForEach-Object { $_.Msg })
$degs  = @($problems | Where-Object Sev -in 'DEGRADED','UNKNOWN' | ForEach-Object { "$($_.Sev): $($_.Msg)" })

# ===========================================================================
# ASSEMBLE REPORT
# ===========================================================================
$stamp = $now.ToString('dddd, yyyy-MM-dd HH:mm')
W "# HERMES Morning Report - $badge"
W ""
W "**$stamp**  |  scan: read-only, on-box  |  $($fails.Count) failing, $($degs.Count) to watch"
W ""
if ($fails.Count) { W "## Does William need to act?  YES"; W ""; foreach ($f in $fails) { W "- **$f**" } }
elseif ($degs.Count) { W "## Does William need to act?  Not urgent - $($degs.Count) item(s) to watch" }
else { W "## Does William need to act?  No - everything green and all sources read" }
W ""
W "## Bulletproof-four progress"
$prog | ForEach-Object { W $_ }
W ""
W "## Vitals"
$vitals | ForEach-Object { W $_ }
W ""
if ($degs.Count) { W "## Watch list"; foreach ($d in $degs) { W "- $d" }; W "" }
W "## Blind spots (need an elevated read - reported UNKNOWN, never guessed)"
W "- SMART wear / power-on-hours on the Samsung 840 & 860 (smartctl not installed)"
W "- BitLocker status, Defender tamper/exclusions"
W "- Full firewall rule set with program paths; identity of SYSTEM listeners :50080/:50443"
W "- SYSTEM task definitions (WilliamOS-HERMES-Ollama/P40Guard/P40Watch) and OLLAMA_MODELS target"
W "- Real ESU enrollment/expiry (slmgr /dlv)"
W ""

# --- best-effort analyst brief (Claude) ------------------------------------
$brief = $null
if ($EnableAnalystBrief -and (Test-Path $ClaudeExe)) {
  $reportSoFar = ($L -join "`n")
  $prompt = @"
You are the HERMES lab morning analyst. Below is today's deterministic scan of the HERMES appliance. In 4-7 sentences, give the owner a plain-language brief: what changed or matters most today, what to do first, and whether the HERMES_APPLIANCE_V1 program is moving forward or regressing. Be direct. Do NOT use any tools; reply with prose only.

$reportSoFar
"@
  $brief = Safe {
    $job = Start-Job -ScriptBlock { param($exe,$p) & $exe -p $p 2>$null } -ArgumentList $ClaudeExe, $prompt
    if (Wait-Job $job -Timeout $AnalystTimeoutSec) { $out = Receive-Job $job } else { $out = $null }
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    $txt = if ($out) { ($out | Out-String).Trim() } else { $null }
    # never let an auth/error string masquerade as a brief
    if ($txt -and $txt -notmatch '(?i)(failed to authenticate|oauth|session expired|error:|usage limit|not logged in)') { $txt } else { $null }
  }
}
W "## Analyst brief"
if ($brief) { W $brief } else { W "_(analyst brief unavailable this run - deterministic report above is complete and authoritative)_" }
W ""
W "---"
W "_HermesMorningReport - read-only - next run tomorrow 07:30. Report: $ReportDir . Heartbeat: morning-report.heartbeat._"

# ===========================================================================
# WRITE OUTPUTS
# ===========================================================================
Safe { if (-not (Test-Path $ReportDir)) { New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null } }
$dated  = Join-Path $ReportDir ("hermes-morning-" + $now.ToString('yyyyMMdd') + ".md")
$latest = Join-Path $ReportDir 'hermes-morning-latest.md'
$text = ($L -join "`r`n")
Safe { Set-Content -Path $dated  -Value $text -Encoding UTF8 }
Safe { Set-Content -Path $latest -Value $text -Encoding UTF8 }

# Heartbeat proves the report ran (its own INV-4)
$hb = [pscustomobject]@{ ts = $now.ToString('o'); verdict = $verdict; fails = $fails.Count; watch = $degs.Count; report = $dated } | ConvertTo-Json -Compress
Safe { Set-Content -Path $Heartbeat -Value $hb -Encoding UTF8 }

Write-Output "HERMES morning report: $verdict ($($fails.Count) failing, $($degs.Count) watch) -> $dated"
