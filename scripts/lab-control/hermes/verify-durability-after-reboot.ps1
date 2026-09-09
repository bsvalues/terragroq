# Post-reboot proof that the 150 W golden configuration is DURABLE.
# Run this after a reboot WITHOUT starting anything by hand. Exit 0 = all three proofs pass.
#
# The three claims under test, none of which may be assumed:
#   1. Ollama came back BY ITSELF        -- and with the measured config, not just any config.
#   2. The P40 is back at 150 W          -- the cap does not survive a reboot on its own.
#   3. The API is alive and has models   -- a port that answers is not a working model store.
#
# Nothing here starts, fixes, or nudges anything. If a proof fails it must fail visibly, because
# the entire point of this run is to find out whether the machine carries the configuration or
# whether a person was still carrying it.
[CmdletBinding()]
param()

throw 'RETIRED_ACCEPTANCE: legacy watchdog/config suite; use canonical owner, native health, doctrine and current recovery receipts. See HERMES-COMMISSIONED.md.'

$ErrorActionPreference = 'SilentlyContinue'
$pass = [ordered]@{}
function Show($k,$ok,$msg){ $pass[$k]=$ok; "{0}  {1,-26} {2}" -f $(if($ok){'[PASS]'}else{'[FAIL]'}),$k,$msg }

$boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
$up   = ((Get-Date) - $boot).TotalMinutes
""
"="*74
"  HERMES DURABILITY VERIFICATION  -  {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm')
"  last boot {0}  ({1:N0} min ago)" -f $boot,$up
"="*74
if($up -gt 180){ "  NOTE: uptime is {0:N0} min. This proves nothing about a reboot unless the machine" -f $up
                 "        actually rebooted since the configuration was installed." }
""

# ---- 1. Ollama came back on its own -------------------------------------------------
$proc = Get-CimInstance Win32_Process -Filter "Name='ollama.exe'"
if(-not $proc){
  Show 'ollama-process' $false 'no ollama.exe running'
} else {
  $startedAfterBoot = $proc.CreationDate -gt $boot
  $ageMin = ($proc.CreationDate - $boot).TotalMinutes
  Show 'ollama-process' $true ("pid {0}, started {1:N1} min after boot" -f $proc.ProcessId,$ageMin)
  if(-not $startedAfterBoot){ "        (started BEFORE this boot -- stale process object?)" }
}

# The config actually in force, taken from the server's own startup env dump rather than from
# the file we hoped it read.
$cfg = Get-Content (Join-Path $PSScriptRoot 'hermes-ai.config.json') -Raw | ConvertFrom-Json
$dump = Get-Content "$($cfg.log).err","$($cfg.log)" -EA SilentlyContinue | Select-String 'server config' | Select-Object -Last 1
if($dump){
  $fa  = if($dump.Line -match 'OLLAMA_FLASH_ATTENTION:(\w+)'){ $Matches[1] } else { '?' }
  $kv  = if($dump.Line -match 'OLLAMA_KV_CACHE_TYPE:(\S*)'){ $Matches[1] } else { '?' }
  $par = if($dump.Line -match 'OLLAMA_NUM_PARALLEL:(\d+)'){ $Matches[1] } else { '?' }
  $gpu = if($dump.Line -match 'CUDA_VISIBLE_DEVICES:(\S+)'){ $Matches[1] } else { '?' }
  $ok  = ($fa -eq 'true') -and ($kv -eq 'f16') -and ($par -eq '1') -and ($gpu -eq $cfg.gpu_uuid)
  Show 'ollama-golden-config' $ok ("fa=$fa kv=$kv parallel=$par gpu-pinned=" + $(if($gpu -eq $cfg.gpu_uuid){'yes'}else{'NO'}))
} else {
  Show 'ollama-golden-config' $false 'no server config dump found in the serve log'
}

# ---- 2. The P40 is back at 150 W ----------------------------------------------------
$row = (& nvidia-smi --query-gpu=uuid,power.limit,power.default_limit,temperature.gpu,driver_model.current --format=csv,noheader,nounits |
        Where-Object { $_ -like "$($cfg.gpu_uuid)*" })
if(-not $row){
  Show 'p40-power-cap' $false 'P40 not found by UUID'
} else {
  $f = $row -split ',\s*'
  $lim = [math]::Round([double]$f[1])
  Show 'p40-power-cap' ($lim -eq 150) ("cap {0} W (default {1} W), {2} C, {3}" -f $lim,[math]::Round([double]$f[2]),$f[3],$f[4])
}

# ---- 3. The API is alive with a real catalogue --------------------------------------
try {
  $tags = Invoke-RestMethod "http://$($cfg.host)/api/tags" -TimeoutSec 15
  Show 'api-catalogue' ($tags.models.Count -gt 0) ("{0} models" -f $tags.models.Count)
} catch {
  Show 'api-catalogue' $false "unreachable: $($_.Exception.Message.Split([char]10)[0])"
}

# ---- 4. one REAL inference must actually light up the P40 ---------------------------
# A serving API and a pinned-config line prove the server INTENDS to use the P40. They do not prove
# the card actually runs the work -- a broken CUDA context, a driver fault, or a silent CPU fallback
# would all still answer /api/tags. So drive a real generation and confirm the P40 (by UUID -> index)
# spikes in utilisation. This is the difference between "Ollama exists" and "the accelerator works".
try {
  $p40idx = $null
  foreach($r in (& nvidia-smi --query-gpu=index,uuid --format=csv,noheader,nounits 2>$null)){
    $f = $r -split ',\s*'; if($f[1].Trim() -eq $cfg.gpu_uuid){ $p40idx = [int]$f[0].Trim() }
  }
  $job = Start-Job {
    param($h) Invoke-RestMethod "http://$h/api/chat" -Method Post -TimeoutSec 120 -ContentType 'application/json' `
      -Body (@{ model='williamos-qwen3-4b:64k'; messages=@(@{role='user';content='Write three sentences about soil surveys.'}); stream=$false; options=@{num_ctx=4096; num_predict=220} } | ConvertTo-Json)
  } -ArgumentList $cfg.host
  $peak = 0
  for($i=0; $i -lt 25; $i++){
    $u = [int]((& nvidia-smi -i $p40idx --query-gpu=utilization.gpu --format=csv,noheader,nounits))
    if($u -gt $peak){ $peak = $u }
    if($job.State -ne 'Running'){ break }
    Start-Sleep -Milliseconds 400
  }
  Wait-Job $job -Timeout 60 | Out-Null; $ans = Receive-Job $job; Remove-Job $job -Force
  Show 'p40-active-under-inference' ($peak -ge 50 -and [bool]$ans) ("P40 (idx $p40idx) utilisation peaked $peak% on a real generation (expected >=50%)")
} catch {
  Show 'p40-active-under-inference' $false "inference probe failed: $($_.Exception.Message.Split([char]10)[0])"
}

# ---- supervision heartbeat ----------------------------------------------------------
$bf = Join-Path $PSScriptRoot 'ollama-watchdog.heartbeat'
if(Test-Path $bf){
  $age = ((Get-Date).ToUniversalTime() - ([datetime](Get-Content $bf -Raw | ConvertFrom-Json).ts).ToUniversalTime()).TotalMinutes
  Show 'watchdog-heartbeat' ($age -le 20) ("{0:N0} min old" -f $age)
} else { Show 'watchdog-heartbeat' $false 'no heartbeat file' }

""
"-"*74
$failed = ($pass.GetEnumerator() | Where-Object { -not $_.Value }).Name
if($failed){ "  RESULT: FAIL -- " + ($failed -join ', '); "" ; exit 2 }
"  RESULT: PASS -- the 150 W golden configuration survived a reboot unaided."
""
exit 0
