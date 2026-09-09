# P40 guard: assert the commissioned envelope and judge thermal health IN CONTEXT.
# Exit 0=ok, 1=warn, 2=fail. Same convention as lab-health.ps1.
#
# WHY THIS EXISTS
# The 2026-08-25 commissioning proved the P40 is safe and fast AT 150 W. That is a statement about a
# CONFIGURED card, not about the card. The 150 W cap is a runtime property: `nvidia-smi -pl` needs
# elevation and does not survive a reboot or driver reload, persistence mode is Linux-only ([N/A]
# here), and this board's Default Power Limit is 250 W. So the envelope was being carried by whoever
# last typed the command, and a cap that depends on memory is not a cap.
#
# WHY THE THERMAL POLICY IS LOAD-AWARE
# COMMISSIONED 2026-08-26 on the permanent duct: at 150 W this card settles at an EQUILIBRIUM of
# ~68 C (69 C peak), steady P40-minus-chassis delta ~35 C, zero thermal-slowdown, ECC 0/0. So ~68 C
# under HIGH load is normal; degradation is caught by the delta GROWING, not by an absolute number.
#
# A single thermometer threshold cannot express that. Set it at 80 C and it screams every hour the
# box is busy -- and alerts.log already carries days of warnings nobody reads, which is how a monitor
# teaches its reader to ignore it. Set it at 85 C to buy silence and you throw away the genuinely
# alarming case: 82 C at 10% utilisation is NOT normal. It means a fan died, a duct came loose, or
# hot exhaust is recirculating. Same number, opposite meaning, and only the load tells them apart.
#
# So the guard samples a short window, classifies the load, and judges temperature against what that
# load should produce. It also watches the RATE of rise, because a fast climb is a fault signature
# before it is a high number, and compares sustained high-load temperature against the commissioned
# baseline so that a slow airflow regression surfaces as a trend rather than as a sudden alarm.
[CmdletBinding()]
param(
  [int]$PowerLimitW = 150,          # commissioned envelope; see _bench/p40-42k-*.json

  # --- thermal policy, all set from the 2026-08-26 sustained soak, not from a short-run peak ---
  [int]$NormalMaxC        = 71,     # COMMISSIONED 2026-08-26: permanent-duct peak 69 C + 2
  [int]$WarnAnyLoadC      = 85,     # the soak's sustained-abort line
  [int]$WarnLowLoadC      = 80,     # this hot while NOT working is an airflow fault
  [int]$FailC             = 87,     # past the 86 C immediate-abort line
  [int]$EmergencyC        = 89,     # shed workload rather than let it approach 90 C
  [int]$FastRiseAboveC    = 75,     # only judge rate once it is genuinely hot
  [double]$FastRiseCPerMin= 6.0,    # soak's hottest legitimate ramp above 75 C was ~2.3 C/min
  [int]$BaselineEquilibC  = 68,     # COMMISSIONED 2026-08-26: permanent-duct steady equilibrium at 150 W
  [int]$RegressionMarginC = 10,     # LOOSE absolute backstop only -- the delta check is the primary, ambient-immune degradation detector; keep this high so a warm room does not false-alarm

  # Chassis-relative degradation. Absolute temperature alone cannot tell a hot ROOM from a failing
  # COOLING PATH: on a warm day the P40 and the chassis proxy (RTX 3050, same enclosure) rise
  # TOGETHER, so their DELTA stays constant -- that is healthy. A loose duct, dying push fan, or
  # blocked inlet makes the P40 climb while the chassis proxy does NOT, so the delta GROWS. Watching
  # the delta catches a real cooling fault that an absolute threshold would dismiss as "warm day",
  # and it does NOT false-alarm on genuine ambient rise. Baseline delta is set from the final soak.
  # -1 disables the check until a real baseline exists.
  [int]$BaselineDeltaC    = 35,     # COMMISSIONED 2026-08-26: steady HIGH-load (P40 - chassis proxy), last-3 cycles of the permanent-duct soak
  [int]$DeltaMarginC      = 6,      # HIGH-load delta this far above baseline = P40 cooling-path degradation

  # --- load classification ---
  # Classified primarily on POWER DRAW, not utilisation.gpu. Measured 2026-08-26: the card was
  # generating tokens at 1428 MHz / 68.9 W / 49 C while utilisation.gpu averaged 16% over a 10 s
  # window and an instantaneous sample read 86%. During decode the GPU genuinely idles between
  # kernel launches, so utilisation oscillates violently and a short average of it reads LOW on a
  # card that is working hard -- which would have inverted the whole point of this policy, calling
  # a hot working card "hot while idle". Power draw separates the states cleanly: 9.7 W idle vs
  # 68.9 W decoding vs ~150 W prefilling.
  [double]$HighLoadPowerFrac = 0.35,  # >= 35% of the cap (52.5 W at 150 W) is real work
  [double]$LowLoadPowerFrac  = 0.15,  # < 15% of the cap (22.5 W at 150 W) is genuinely idle
  [int]$HighUtilPct = 70,             # secondary signal: a high util average also means HIGH
  [int]$LowUtilPct  = 20,

  [int]$Samples = 12,               # ~30 s: long enough for a trustworthy rate of rise
  [double]$SampleIntervalS = 2.5,
  [switch]$Watch,                   # continuous mode -- the only way EMERGENCY can be a real responder
  [int]$WatchIntervalS = 30,
  [switch]$NoShed,                  # never kill/unload, only report (use when testing the policy)

  # Validation path. The emergency branch must be exercisable WITHOUT cooking the card -- deliberately
  # overheating a P40 to prove the thermometer works is a bad trade. -SimulateTempC overrides the
  # sampled temperature so the full policy (and, if not -NoShed, the real shed action) runs against
  # an injected value. Every record produced this way is stamped simulated=true so an injected
  # reading can never be mistaken for evidence about the hardware.
  [double]$SimulateTempC = 0,

  [int]$HistoryEverySec = 600,      # in -Watch, append history at most this often unless not-ok
  [int]$HistoryMaxMB = 8,
  [switch]$Quiet
)

$ErrorActionPreference = 'SilentlyContinue'
$script:overall = 'ok'; $script:problems = @()
function Bump($sev){ if($sev -eq 'fail'){$script:overall='fail'; return}; if($sev -eq 'warn' -and $script:overall -ne 'fail'){$script:overall='warn'} }
function P($sev,$msg){ if($sev -ne 'ok'){ $script:problems += $msg } }
function Say($m){ if(-not $Quiet){ Write-Host $m } }

# The card is identified by UUID, never by index. Index is a function of what else is plugged in;
# this box already has a second GPU, and `-i 1` silently becomes the wrong card the day the 3050 is
# removed or a third card is added.
$P40_UUID = 'GPU-4f7d4396-9304-d12f-7e9b-7f04d1236fc2'

if(-not (Get-Command nvidia-smi -ErrorAction SilentlyContinue)){
  Say '  nvidia-smi not found -- the GPU envelope cannot be asserted.   [FAIL]'; Say '  OVERALL: FAIL'; exit 2
}

$rows = & nvidia-smi --query-gpu=index,uuid,name --format=csv,noheader,nounits 2>$null
$idx = $null; $name = $null
foreach($r in $rows){
  $f = $r -split ',\s*'
  if($f.Count -ge 2 -and $f[1].Trim() -eq $P40_UUID){ $idx = [int]$f[0].Trim(); $name = $f[2] }
}
if($null -eq $idx){
  Say ("  P40 {0} is NOT PRESENT on this host.   [FAIL]" -f $P40_UUID); Say '  OVERALL: FAIL'; exit 2
}

# @() is load-bearing. -split returns a bare String when it yields ONE element, and indexing a String
# gives a [char], so [double](Q 'power.limit')[0] silently evaluated to 49 -- the character code of
# '1' -- instead of 150, and the guard reported "cap 49W" while still saying OK.
function Q($fields){ ,@((& nvidia-smi -i $idx --query-gpu=$fields --format=csv,noheader,nounits 2>$null) -split ',\s*') }

function Get-Window {
  $s = @()
  for($i=0; $i -lt $Samples; $i++){
    $v = Q 'temperature.gpu,utilization.gpu,power.draw,clocks.sm,memory.used'
    if($v.Count -ge 5){
      $s += [pscustomobject]@{
        t    = (Get-Date)
        temp = [double]$v[0]; util = [double]$v[1]
        pw   = [double]$v[2]; sm = [double]$v[3]; vram = [double]$v[4]
      }
    }
    if($i -lt $Samples-1){ Start-Sleep -Milliseconds ([int]($SampleIntervalS*1000)) }
  }
  return $s
}

function Invoke-Shed($why){
  # Graceful first: ask ollama to unload the model, which releases the P40 without killing the
  # service. Only if the card is still in the emergency band do we take the runner down.
  Say ("  SHEDDING WORKLOAD: {0}" -f $why)
  try {
    $ps = Invoke-RestMethod 'http://127.0.0.1:11434/api/ps' -TimeoutSec 10
    foreach($m in $ps.models){
      Say ("    unloading {0}" -f $m.name)
      $body = @{ model = $m.name; keep_alive = 0 } | ConvertTo-Json
      Invoke-RestMethod 'http://127.0.0.1:11434/api/generate' -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 30 | Out-Null
    }
  } catch { Say "    graceful unload failed: $($_.Exception.Message.Split([char]10)[0])" }
  Start-Sleep -Seconds 10
  $now = [double](Q 'temperature.gpu')[0]
  if($now -ge $EmergencyC){
    Say ("    still {0}C -- stopping the inference runner" -f $now)
    Get-Process ollama -ErrorAction SilentlyContinue | ForEach-Object { & taskkill /PID $_.Id /T /F 2>&1 | Out-Null }
  } else {
    Say ("    released; now {0}C" -f $now)
  }
}

function Get-BaselineTrend {
  # "Materially worse than the commissioned baseline" cannot be seen in a 12 s window -- it is a
  # trend. Use this guard's own history: the median of recent HIGH-load observations.
  $hist = Join-Path $PSScriptRoot 'p40-guard-history.jsonl'
  if(-not (Test-Path -LiteralPath $hist)){ return $null }
  $hot = @()
  Get-Content -LiteralPath $hist -Tail 200 | ForEach-Object {
    try { $j = $_ | ConvertFrom-Json; if($j.load_class -eq 'HIGH' -and $j.temp_c){ $hot += [double]$j.temp_c } } catch {}
  }
  if($hot.Count -lt 5){ return $null }
  $sorted = @($hot | Sort-Object)
  return [math]::Round($sorted[[int]($sorted.Count/2)],1)
}

function Invoke-GuardPass {
  $script:overall = 'ok'; $script:problems = @()

  Say ('='*70)
  Say ("  P40 GUARD  -  {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
  Say ('='*70)
  Say ("  Card    : {0}  (index {1} this boot)" -f $name,$idx)

  # ---- driver model: persists across reboot, so checked rather than enforced ----------
  $dm = Q 'driver_model.current,driver_model.pending'
  if($dm[0] -eq 'TCC'){ Say ("  Mode    : TCC (compute-only), pending {0}   [OK]" -f $dm[1]) }
  else { Say ("  Mode    : {0} -- expected TCC   [WARN]" -f $dm[0]); Bump 'warn'; P 'warn' "P40 driver model $($dm[0]) not TCC" }

  # ---- power envelope: assert, do not merely observe ---------------------------------
  $pw = Q 'power.limit,power.default_limit'
  $cur = [math]::Round([double]$pw[0])
  if($cur -eq $PowerLimitW){
    Say ("  Power   : {0} W cap (default {1} W)   [OK]" -f $cur,[math]::Round([double]$pw[1]))
  } else {
    Say ("  Power   : cap is {0} W, commissioned envelope is {1} W -- correcting" -f $cur,$PowerLimitW)
    $out = & nvidia-smi -i $idx -pl $PowerLimitW 2>&1
    $now = [math]::Round([double](Q 'power.limit')[0])
    if($now -eq $PowerLimitW){ Say ("  Power   : corrected to {0} W   [OK]" -f $now) }
    else {
      Say ("  Power   : CANNOT ENFORCE -- still {0} W. nvidia-smi said: {1}   [FAIL]" -f $now,($out -join ' ').Trim())
      Bump 'fail'; P 'fail' "P40 power cap $now W != commissioned $PowerLimitW W and could not be corrected (needs elevation)"
    }
  }

  # ---- sample a window, then judge temperature IN CONTEXT -----------------------------
  $w = Get-Window
  if($w.Count -lt 2){ Say '  Thermal : could not sample the card   [FAIL]'; Bump 'fail'; P 'fail' 'P40 telemetry unreadable'; return }

  $meanUtil = [math]::Round((($w | Measure-Object util -Average).Average),0)
  $meanTemp = [math]::Round((($w | Measure-Object temp -Average).Average),1)
  $maxTemp  = ($w | Measure-Object temp -Maximum).Maximum
  $meanSm   = [math]::Round((($w | Measure-Object sm -Average).Average),0)
  $meanPw   = [math]::Round((($w | Measure-Object pw -Average).Average),1)
  $spanS    = ($w[-1].t - $w[0].t).TotalSeconds
  $spanMin  = $spanS / 60.0

  # Least-squares slope, not first-minus-last. A two-point delta over a short window extrapolates
  # noise into nonsense -- a 3 C dip across 10 s printed as "-18.4 C/min" on a perfectly healthy
  # card. The rate rule is also only allowed to fire when the window is long enough to mean anything.
  $n = $w.Count
  $mt = ($w | Measure-Object temp -Average).Average
  $mx = ($spanS / 2.0)
  $sxy = 0.0; $sxx = 0.0
  for($i=0; $i -lt $n; $i++){
    $x = ($w[$i].t - $w[0].t).TotalSeconds
    $sxy += ($x - $mx) * ($w[$i].temp - $mt)
    $sxx += ($x - $mx) * ($x - $mx)
  }
  $riseRate = if($sxx -gt 0){ [math]::Round((($sxy / $sxx) * 60.0),1) } else { 0 }
  $rateTrustworthy = ($spanS -ge 20)

  # Power-first classification; utilisation only ever promotes, never demotes.
  $highPw = $PowerLimitW * $HighLoadPowerFrac
  $lowPw  = $PowerLimitW * $LowLoadPowerFrac
  $loadClass =
    if($meanPw -ge $highPw -or $meanUtil -ge $HighUtilPct){ 'HIGH' }
    elseif($meanPw -lt $lowPw -and $meanUtil -lt $LowUtilPct){ 'LOW' }
    else { 'MODERATE' }

  $simulated = $false
  if($SimulateTempC -gt 0){
    $simulated = $true
    Say ("  ** SIMULATION: overriding sampled {0}C / peak {1}C with {2}C **" -f $meanTemp,$maxTemp,$SimulateTempC)
    $meanTemp = $SimulateTempC; $maxTemp = $SimulateTempC
  }

  # Ambient proxy. This box exposes no ACPI thermal zone and has no LibreHardwareMonitor, so the
  # RTX 3050 in the same chassis is the closest available stand-in for intake air. It is a PROXY,
  # not a room thermometer -- a USB probe at the intake would make soaks properly comparable.
  $amb = $null; $ambFan = $null
  foreach($r in (& nvidia-smi --query-gpu=uuid,temperature.gpu,fan.speed --format=csv,noheader,nounits 2>$null)){
    $f = $r -split ',\s*'
    if($f[0].Trim() -ne $P40_UUID){ $amb = [double]$f[1]; $ambFan = $f[2] }
  }

  Say ("  Load    : {0}  ({1} W, {2} MHz, util avg {3}%)" -f $loadClass,$meanPw,$meanSm,$meanUtil)
  Say ("  Thermal : mean {0}C  peak {1}C  rate {2} C/min   (chassis proxy {3}C, 3050 fan {4}%)" -f `
        $meanTemp,$maxTemp,$riseRate,$amb,$ambFan)

  # --- EMERGENCY ---------------------------------------------------------------------
  if($maxTemp -ge $EmergencyC){
    Say ("  VERDICT : EMERGENCY -- {0}C >= {1}C   [FAIL]" -f $maxTemp,$EmergencyC)
    Bump 'fail'; P 'fail' "P40 EMERGENCY ${maxTemp}C -- workload shed"
    if(-not $NoShed){ Invoke-Shed ("{0}C >= {1}C" -f $maxTemp,$EmergencyC) } else { Say '  (-NoShed: not acting)' }
  }
  # --- FAIL --------------------------------------------------------------------------
  elseif($meanTemp -ge $FailC){
    Say ("  VERDICT : FAIL -- sustained {0}C >= {1}C   [FAIL]" -f $meanTemp,$FailC)
    Bump 'fail'; P 'fail' "P40 sustained ${meanTemp}C >= ${FailC}C"
    if(-not $NoShed){ Invoke-Shed ("sustained {0}C" -f $meanTemp) } else { Say '  (-NoShed: not acting)' }
  }
  else {
    # --- WARN conditions, each reported for its own reason ---------------------------
    $warned = $false
    if($maxTemp -ge $WarnAnyLoadC){
      Say ("  VERDICT : WARN -- {0}C >= {1}C at any load   [WARN]" -f $maxTemp,$WarnAnyLoadC)
      Bump 'warn'; P 'warn' "P40 ${maxTemp}C >= ${WarnAnyLoadC}C"; $warned = $true
    }
    if($loadClass -ne 'HIGH' -and $maxTemp -ge $WarnLowLoadC){
      # The signature this whole redesign exists for: hot while not working.
      Say ("  VERDICT : WARN -- {0}C at only {1}% utilisation ({2}). Normal only under HIGH load;" -f $maxTemp,$meanUtil,$loadClass)
      Say  "            at this load it suggests a dead fan, a displaced duct, or recirculating exhaust.   [WARN]"
      Bump 'warn'; P 'warn' "P40 ${maxTemp}C at ${meanUtil}% util ($loadClass) -- airflow fault suspected"; $warned = $true
    }
    if($rateTrustworthy -and $maxTemp -ge $FastRiseAboveC -and $riseRate -gt $FastRiseCPerMin){
      Say ("  VERDICT : WARN -- rising {0} C/min above {1}C (soak's hottest legitimate ramp was ~2.3)   [WARN]" -f $riseRate,$FastRiseAboveC)
      Bump 'warn'; P 'warn' "P40 rising ${riseRate} C/min above ${FastRiseAboveC}C"; $warned = $true
    }
    $trend = Get-BaselineTrend
    if($null -ne $trend -and $trend -ge ($BaselineEquilibC + $RegressionMarginC)){
      Say ("  VERDICT : WARN -- recent high-load median {0}C vs commissioned baseline {1}C: airflow regression   [WARN]" -f $trend,$BaselineEquilibC)
      Bump 'warn'; P 'warn' "P40 high-load median ${trend}C vs baseline ${BaselineEquilibC}C"; $warned = $true
    }
    # Chassis-relative degradation -- the smart one. Only meaningful under HIGH load (idle deltas are
    # noise) and only once a real baseline delta has been set from the final soak.
    if($loadClass -eq 'HIGH' -and $BaselineDeltaC -ge 0 -and $null -ne $amb){
      $delta = $maxTemp - $amb
      if($delta -ge ($BaselineDeltaC + $DeltaMarginC)){
        Say ("  VERDICT : WARN -- P40-minus-chassis delta {0}C vs baseline {1}C: the P40 is hot RELATIVE to" -f $delta,$BaselineDeltaC)
        Say  "            the case, so this is a COOLING-PATH fault (loose duct / dying fan / blocked inlet),"
        Say  "            not a warm room. On a warm day the delta would hold.   [WARN]"
        Bump 'warn'; P 'warn' "P40 cooling-path degraded: delta ${delta}C vs baseline ${BaselineDeltaC}C (not ambient)"; $warned = $true
      }
    }
    if(-not $warned){
      if($loadClass -eq 'HIGH'){ Say ("  VERDICT : NORMAL -- {0}C under HIGH load (<= {1}C is the measured envelope)   [OK]" -f $maxTemp,$NormalMaxC) }
      else { Say ("  VERDICT : NORMAL -- {0}C at {1} load   [OK]" -f $maxTemp,$loadClass) }
    }
  }

  # ---- throttle reasons and ECC -------------------------------------------------------
  $thr = & nvidia-smi -i $idx -q -d PERFORMANCE 2>$null
  $hwT = ($thr | Select-String 'HW Thermal Slowdown\s*:\s*(.+?)\s*$').Matches.Groups[1].Value
  $swT = ($thr | Select-String 'SW Thermal Slowdown\s*:\s*(.+?)\s*$').Matches.Groups[1].Value
  $swP = ($thr | Select-String 'SW Power Cap\s*:\s*(.+?)\s*$').Matches.Groups[1].Value
  if($hwT -eq 'Active' -or $swT -eq 'Active'){
    Say ("  Throttle: THERMAL SLOWDOWN ACTIVE (hw={0} sw={1}) -- airflow regression   [FAIL]" -f $hwT,$swT)
    Bump 'fail'; P 'fail' 'P40 thermal slowdown active -- airflow regression'
  } else { Say ("  Throttle: no thermal slowdown; SW power cap {0}   [OK]" -f $swP) }

  $e = Q 'ecc.errors.uncorrected.volatile.total,ecc.errors.corrected.volatile.total,ecc.errors.uncorrected.aggregate.total,ecc.errors.corrected.aggregate.total'
  $eccPresent = $e.Count -ge 4 -and @($e | Where-Object { $_ -notmatch '^\d+$' }).Count -eq 0
  if($eccPresent){
    if([int64]$e[0] -gt 0 -or [int64]$e[2] -gt 0){ Say ("  ECC     : uncorrected volatile={0}, aggregate={1}   [FAIL]" -f $e[0],$e[2]); Bump 'fail'; P 'fail' "P40 uncorrected ECC errors: volatile=$($e[0]) aggregate=$($e[2])" }
    else { Say ("  ECC     : uncorrected 0/0; corrected volatile={0}, aggregate={1}   [OK]" -f $e[1],$e[3]) }
  } else { Say '  ECC     : required counters not reported   [FAIL]'; Bump 'fail'; P 'fail' 'P40 corrected/uncorrected ECC telemetry unavailable' }

  Say ('-'*70)
  Say ("  OVERALL: {0}" -f $script:overall.ToUpper())
  foreach($p in $script:problems){ Say "   - $p" }

  $state = [ordered]@{
    ts = (Get-Date).ToUniversalTime().ToString('o'); overall = $script:overall
    uuid = $P40_UUID; index = $idx; driver_model = $dm[0]
    power_limit_w = [math]::Round([double](Q 'power.limit')[0]); power_limit_target_w = $PowerLimitW
    temp_c = $maxTemp; mean_temp_c = $meanTemp; util_pct = $meanUtil; load_class = $loadClass
    rise_c_per_min = $riseRate; rate_trustworthy = $rateTrustworthy; window_s = [math]::Round($spanS,1); sm_mhz = $meanSm; power_w = $meanPw
    chassis_proxy_c = $amb; chassis_fan_pct = $ambFan
    p40_chassis_delta_c = $(if($null -ne $amb){ $maxTemp - $amb } else { $null })
    baseline_equilibrium_c = $BaselineEquilibC; baseline_delta_c = $BaselineDeltaC
    thermal_slowdown = ($hwT -eq 'Active' -or $swT -eq 'Active')
    ecc_telemetry_present = $eccPresent
    ecc_uncorrected_volatile = $(if($eccPresent){[int64]$e[0]}else{$null})
    ecc_corrected_volatile = $(if($eccPresent){[int64]$e[1]}else{$null})
    ecc_uncorrected_aggregate = $(if($eccPresent){[int64]$e[2]}else{$null})
    ecc_corrected_aggregate = $(if($eccPresent){[int64]$e[3]}else{$null})
    simulated = $simulated
    problems = $script:problems
  }
  $json = $state | ConvertTo-Json -Compress
  # Write-then-rename. The continuous watcher and the hourly backstop both publish this file, and
  # Set-Content is not atomic -- a reader (lab-health) landing mid-write would parse a truncated
  # object and report nonsense about the card. Renaming into place is the cheap fix.
  function Publish($path, $text){
    $tmp = "$path.tmp"
    $text | Set-Content -LiteralPath $tmp -Encoding ASCII
    Move-Item -LiteralPath $tmp -Destination $path -Force
  }
  Publish (Join-Path $PSScriptRoot 'p40-guard.json') $json
  if($Watch){ Publish (Join-Path $PSScriptRoot 'p40-watch.heartbeat') $json }

  # History is throttled in -Watch mode. A 30 s watcher would otherwise append ~2,880 records a day
  # forever, and this host has already lost 117 GB once to a log nobody was rotating. Anything that
  # is not OK is always recorded; healthy samples are kept at a coarse interval.
  $hist = Join-Path $PSScriptRoot 'p40-guard-history.jsonl'
  $writeHist = $true
  if($Watch -and $script:overall -eq 'ok'){
    $writeHist = ($null -eq $script:lastHist) -or (((Get-Date) - $script:lastHist).TotalSeconds -ge $HistoryEverySec)
  }
  if($writeHist){
    if((Test-Path -LiteralPath $hist) -and ((Get-Item -LiteralPath $hist).Length -gt ($HistoryMaxMB*1MB))){
      Move-Item -LiteralPath $hist -Destination "$hist.1" -Force
    }
    $json | Add-Content -LiteralPath $hist
    $script:lastHist = Get-Date
  }
}

if($Watch){
  # An hourly task cannot be a thermal emergency responder -- by the time it next looks, the event
  # is over or the damage is done. This mode is what makes EMERGENCY meaningful.
  Say ("P40 guard watching every {0}s. Ctrl-C to stop." -f $WatchIntervalS)
  while($true){ Invoke-GuardPass; Start-Sleep -Seconds $WatchIntervalS }
}

Invoke-GuardPass
switch($script:overall){ 'fail' { exit 2 } 'warn' { exit 1 } default { exit 0 } }
