# HERMES appliance acceptance suite -- RELIABILITY, not performance. RUN ELEVATED.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\HermesLab\hermes\hermes-acceptance.ps1
#
# This certifies that the finished inference appliance RECOVERS from failure on its own and reports
# its state truthfully. It is the last gate before HERMES is "done enough that changes require a
# reason rather than curiosity." Every test states what it did, what it expected, and PASS/FAIL --
# and a test that cannot prove recovery FAILS rather than assuming it (the whole project's rule).
#
# Elevation is required because inference now runs as SYSTEM (HermesOllamaServe/HermesOllamaWatchdog),
# so exercising the kill/recover paths needs to touch SYSTEM processes.
#
# Cold-boot recovery is NOT in here -- it cannot be self-tested in one process. It is a separate
# manual step: reboot, then run verify-durability-after-reboot.ps1. This suite covers everything
# that does not require the machine to actually restart.
[CmdletBinding()]
param([switch]$SkipDisruptive)   # skip the tests that kill the running server (read-only run)

throw 'RETIRED_ACCEPTANCE: legacy watchdog/config suite; use canonical owner, native health, doctrine and current recovery receipts. See HERMES-COMMISSIONED.md.'

$ErrorActionPreference = 'SilentlyContinue'
$here = $PSScriptRoot
$cfg  = Get-Content (Join-Path $here 'hermes-ai.config.json') -Raw | ConvertFrom-Json
$base = "http://$($cfg.host)"
$results = [ordered]@{}

if(-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
  Write-Host 'Must run ELEVATED (recovery tests touch SYSTEM processes). Nothing changed.' -ForegroundColor Red
  exit 2
}

function Test-Case($name, [scriptblock]$body){
  Write-Host ""
  Write-Host "--- $name ---"
  try {
    $r = & $body
    $ok = [bool]$r.ok
    $results[$name] = $ok
    Write-Host ("  [{0}] {1}" -f $(if($ok){'PASS'}else{'FAIL'}), $r.detail) -ForegroundColor $(if($ok){'Green'}else{'Red'})
  } catch {
    $results[$name] = $false
    Write-Host ("  [FAIL] threw: {0}" -f $_.Exception.Message) -ForegroundColor Red
  }
}

function Serving {
  try { $t = Invoke-RestMethod "$base/api/tags" -TimeoutSec 10; return ($t.models.Count -gt 0) } catch { return $false }
}
function LiveEnv {
  # the config actually in force, from the server's own startup dump
  $d = Get-Content "$($cfg.log).err","$($cfg.log)" -EA SilentlyContinue | Select-String 'server config' | Select-Object -Last 1
  if(-not $d){ return @{} }
  $h=@{}; foreach($k in 'OLLAMA_FLASH_ATTENTION','OLLAMA_KV_CACHE_TYPE','OLLAMA_NUM_PARALLEL','CUDA_VISIBLE_DEVICES'){
    if($d.Line -match "$k`:(\S+)"){ $h[$k]=$Matches[1] } }
  return $h
}
function P40Cap { [math]::Round([double]((& nvidia-smi -i 1 --query-gpu=power.limit --format=csv,noheader,nounits))) }
function EccUncorrected { [int]((& nvidia-smi -i 1 --query-gpu=ecc.errors.uncorrected.volatile.total --format=csv,noheader,nounits) 2>$null) }

Write-Host ("="*70)
Write-Host ("  HERMES ACCEPTANCE SUITE  -  {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'))
Write-Host ("="*70)

$eccStart = EccUncorrected

# 1. Baseline: serving with the golden config, P40 selected, cap enforced, ECC clean.
Test-Case 'baseline: golden config live' {
  $env = LiveEnv
  $ok = (Serving) -and ($env.OLLAMA_FLASH_ATTENTION -eq 'true') -and ($env.OLLAMA_KV_CACHE_TYPE -eq 'f16') `
        -and ($env.OLLAMA_NUM_PARALLEL -eq '1') -and ($env.CUDA_VISIBLE_DEVICES -eq $cfg.gpu_uuid) -and ((P40Cap) -eq 150)
  @{ ok=$ok; detail="serving=$(Serving) fa=$($env.OLLAMA_FLASH_ATTENTION) kv=$($env.OLLAMA_KV_CACHE_TYPE) parallel=$($env.OLLAMA_NUM_PARALLEL) p40-pinned=$([bool]($env.CUDA_VISIBLE_DEVICES -eq $cfg.gpu_uuid)) cap=$(P40Cap)W" }
}

# 2. P40 is the selected accelerator (not the 3050, not CPU).
Test-Case 'P40 is the inference accelerator' {
  # Resolve the P40 by UUID -> index (never hard-code -i 1). WARM the model first so the MEASURED
  # inference is compute, not a cold weight-load (the load window is low-util and would understate
  # the peak). Then run a longer generation and poll the P40 until the job finishes.
  $idx = $null
  foreach($r in (& nvidia-smi --query-gpu=index,uuid --format=csv,noheader,nounits 2>$null)){
    $f = $r -split ',\s*'; if($f[1].Trim() -eq $cfg.gpu_uuid){ $idx = [int]$f[0].Trim() }
  }
  Invoke-RestMethod "$base/api/generate" -Method Post -TimeoutSec 120 -ContentType 'application/json' `
    -Body (@{model='williamos-qwen3-4b:64k';prompt='warm up';stream=$false;options=@{num_ctx=4096;num_predict=8}} | ConvertTo-Json) | Out-Null
  $job = Start-Job {
    param($h) Invoke-RestMethod "http://$h/api/chat" -Method Post -TimeoutSec 180 -ContentType 'application/json' `
      -Body (@{model='williamos-qwen3-4b:64k';messages=@(@{role='user';content='Write a detailed 400-word essay about soil survey methodology.'});stream=$false;options=@{num_ctx=4096;num_predict=400}} | ConvertTo-Json)
  } -ArgumentList $cfg.host
  $peak = 0
  for($i=0; $i -lt 90; $i++){
    $u = [int]((& nvidia-smi -i $idx --query-gpu=utilization.gpu --format=csv,noheader,nounits))
    if($u -gt $peak){ $peak = $u }
    if($job.State -ne 'Running'){ Start-Sleep -Milliseconds 400; $u=[int]((& nvidia-smi -i $idx --query-gpu=utilization.gpu --format=csv,noheader,nounits)); if($u -gt $peak){$peak=$u}; break }
    Start-Sleep -Milliseconds 400
  }
  $ans = Receive-Job $job; Wait-Job $job -Timeout 30 | Out-Null; Remove-Job $job -Force
  @{ ok=($peak -ge 50 -and [bool]$ans); detail="P40 (idx $idx) utilisation peaked $peak% on a real generation (expected >=50%)" }
}

# 3. Model unload / reload.
Test-Case 'model unload + reload' {
  Invoke-RestMethod "$base/api/generate" -Method Post -TimeoutSec 30 -ContentType 'application/json' -Body (@{model='williamos-qwen3-4b:64k';keep_alive=0}|ConvertTo-Json) | Out-Null
  Start-Sleep -Seconds 3
  $unloaded = ((Invoke-RestMethod "$base/api/ps" -TimeoutSec 10).models.Count -eq 0)
  $r = Invoke-RestMethod "$base/api/generate" -Method Post -TimeoutSec 120 -ContentType 'application/json' -Body (@{model='williamos-qwen3-4b:64k';prompt='hi';stream=$false;options=@{num_predict=8}}|ConvertTo-Json)
  @{ ok=($unloaded -and $r.response); detail="unloaded=$unloaded, reloaded+answered=$([bool]$r.response)" }
}

# 4. Short inference after idle (keep-alive path).
Test-Case 'short inference responds' {
  $t0=Get-Date
  $r = Invoke-RestMethod "$base/api/generate" -Method Post -TimeoutSec 60 -ContentType 'application/json' -Body (@{model='williamos-qwen3-4b:64k';prompt='Say OK.';stream=$false;options=@{num_predict=8}}|ConvertTo-Json)
  @{ ok=[bool]$r.response; detail="responded in $([math]::Round(((Get-Date)-$t0).TotalSeconds,1))s" }
}

# 5. Watchdog heartbeat is fresh.
Test-Case 'watchdog heartbeat fresh' {
  $bf = Join-Path $here 'p40-watch.heartbeat'
  if(-not (Test-Path $bf)){ return @{ ok=$false; detail='no heartbeat file' } }
  $age = ((Get-Date).ToUniversalTime() - [datetimeoffset]::Parse((Get-Content $bf -Raw|ConvertFrom-Json).ts).UtcDateTime).TotalSeconds
  @{ ok=($age -lt 120); detail="heartbeat $([math]::Round($age))s old (expected <120)" }
}

# 6. Deliberately-failed health is surfaced TRUTHFULLY (injected, no heat).
Test-Case 'failed condition surfaced truthfully' {
  # The guard reports via Write-Host (information stream), which `2>&1` does NOT capture -- so capture
  # everything to a file with `*>`. Do NOT read p40-guard.json here: the running SYSTEM watcher also
  # writes that file every 30 s, so it would race and could show the watcher's normal state instead
  # of this injected emergency. Exit code + captured output are the reliable, race-free signals.
  $tmp = Join-Path $env:TEMP ("p40guard-inject-{0}.txt" -f $PID)
  & (Join-Path $here 'p40-guard.ps1') -Samples 3 -SampleIntervalS 1 -SimulateTempC 90 -NoShed *> $tmp
  $rc = $LASTEXITCODE
  $out = Get-Content $tmp -Raw -EA SilentlyContinue
  Remove-Item $tmp -Force -EA SilentlyContinue
  $said = [bool]($out -match 'EMERGENCY')
  @{ ok=($rc -eq 2 -and $said); detail="injected 90C -> guard exit=$rc (2=fail surfaced), EMERGENCY in output=$said" }
}

if(-not $SkipDisruptive){
  # 7. Kill the Ollama server -> the watchdog restarts it with the golden config.
  Test-Case 'kill server -> autonomous recovery' {
    Get-Process ollama -EA SilentlyContinue | ForEach-Object { & taskkill /PID $_.Id /T /F 2>&1 | Out-Null }
    Start-Sleep -Seconds 4
    $down = -not (Serving)
    & (Join-Path $here 'ollama-watchdog.ps1') -Quiet | Out-Null   # simulate the 5-min watchdog firing now
    $deadline=(Get-Date).AddSeconds(90); while((Get-Date) -lt $deadline -and -not (Serving)){ Start-Sleep -Seconds 3 }
    $env = LiveEnv
    $ok = (Serving) -and ($env.OLLAMA_FLASH_ATTENTION -eq 'true') -and ($env.OLLAMA_KV_CACHE_TYPE -eq 'f16') -and ($env.OLLAMA_NUM_PARALLEL -eq '1')
    @{ ok=($down -and $ok); detail="server went down=$down, watchdog restored serving=$(Serving) with fa=$($env.OLLAMA_FLASH_ATTENTION) kv=$($env.OLLAMA_KV_CACHE_TYPE) parallel=$($env.OLLAMA_NUM_PARALLEL)" }
  }
}

# 8. Supporting containers up (Docker/proxy plane).
Test-Case 'docker service plane up' {
  $names = & docker ps --format '{{.Names}}' 2>$null
  $want = 'postgres','redis','open-webui','portainer'
  $missing = $want | Where-Object { $names -notcontains $_ }
  @{ ok=($missing.Count -eq 0); detail="running: $($names -join ', ')$(if($missing){' | MISSING: '+($missing -join ', ')})" }
}

# 9. Power cap enforced at 150 W now (post all the disruption).
Test-Case 'P40 cap at 150 W' { @{ ok=((P40Cap) -eq 150); detail="cap $(P40Cap)W" } }

# 10. ECC stayed clean across the whole suite.
Test-Case 'ECC clean across suite' {
  $d = (EccUncorrected) - $eccStart
  @{ ok=($d -eq 0); detail="uncorrected ECC delta across suite: $d" }
}

Write-Host ""
Write-Host ("-"*70)
$fail = ($results.GetEnumerator() | Where-Object { -not $_.Value }).Name
$pass = ($results.GetEnumerator() | Where-Object { $_.Value }).Count
Write-Host ("  RESULT: {0}/{1} passed" -f $pass, $results.Count)
if($fail){ Write-Host ("  FAILED: {0}" -f ($fail -join ', ')) -ForegroundColor Red }
Write-Host ""
Write-Host "  Not covered here (separate manual step): COLD BOOT recovery ->"
Write-Host "    reboot, then: powershell -NoProfile -File $here\verify-durability-after-reboot.ps1"

[ordered]@{ ts=(Get-Date).ToUniversalTime().ToString('o'); passed=$pass; total=$results.Count; failures=$fail } |
  ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $here 'hermes-acceptance.json')

if($fail){ exit 1 } else { exit 0 }
