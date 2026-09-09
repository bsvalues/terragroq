# HERMES-NODE placement-readiness: truthful schedulable AI/compute target evidence.
# READ-ONLY. Does NOT change Ollama/SSH/network. No scheduler activation.
# Emits C:\HermesLab\hermes\hermes-placement.json and prints it.
$ErrorActionPreference = "SilentlyContinue"

# ---- thresholds (explicit) ----
$MIN_FREE_RAM_GB   = 4
$MIN_FREE_DISK_GB  = 20
$GPU_VRAM_HEADROOM_MB = 1024

# ---- CPU / RAM ----
$cpu   = Get-CimInstance Win32_Processor
$cores = ($cpu | Measure-Object -Property NumberOfCores -Sum).Sum
$threads = ($cpu | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum
$loadPct = [math]::Round(($cpu | Measure-Object LoadPercentage -Average).Average)
$os = Get-CimInstance Win32_OperatingSystem
$ramTotalGB = [math]::Round($os.TotalVisibleMemorySize/1MB,1)
$ramFreeGB  = [math]::Round($os.FreePhysicalMemory/1MB,1)

# ---- Disks ----
$cFree = [math]::Round((Get-Volume C).SizeRemaining/1GB,1)
$dv = Get-Volume D; $dFree = if($dv){[math]::Round($dv.SizeRemaining/1GB,1)}else{$null}
$workspaceFree = if($dFree){[math]::Max($cFree,$dFree)}else{$cFree}

# ---- GPUs ----
$gpus = @(); $gpuOk = $false
$raw = nvidia-smi --query-gpu=name,memory.total,memory.free,memory.used,utilization.gpu,temperature.gpu --format=csv,noheader,nounits 2>$null
if($raw){ foreach($line in $raw){ $p = $line -split ',\s*'; if($p.Count -ge 6){
  $gpus += [ordered]@{ name=$p[0]; vram_total_mb=[int]$p[1]; vram_free_mb=[int]$p[2]; vram_used_mb=[int]$p[3]; util_pct=[int]$p[4]; temp_c=[int]$p[5] }
  $gpuOk = $true } } }
$gpuFreeMax = if($gpus.Count){ ($gpus.vram_free_mb | Measure-Object -Maximum).Maximum }else{0}
$gpuTotalMax = if($gpus.Count){ ($gpus.vram_total_mb | Measure-Object -Maximum).Maximum }else{0}

# ---- Docker ----
$dockerVer = docker version --format "{{.Server.Version}}" 2>$null
$dockerUp = [bool]$dockerVer
$running = @(); if($dockerUp){ $running = @(docker ps --format "{{.Names}}" 2>$null) }

# ---- Ollama models ----
# Ollama is a Windows service now (#997), not a container in $running.
$ollamaUp = $false; try{ $null=Invoke-RestMethod http://127.0.0.1:11434/api/version -TimeoutSec 8; $ollamaUp=$true }catch{}
$models = @()
if($ollamaUp){
  # Same NAME / ID / SIZE / MODIFIED shape the parser below already expects, from /api/tags.
  $ol = @()
  try {
    foreach($m in (Invoke-RestMethod http://127.0.0.1:11434/api/tags -TimeoutSec 15).models){
      $ol += ("{0} {1} {2} GB {3}" -f $m.name, $m.digest.Substring(0,12), [math]::Round($m.size/1GB,1), $m.modified_at)
    }
  } catch {}
  foreach($line in $ol){
    if($line -match '^\s*NAME' ){ continue }
    if($line -match '^(?<n>\S+)\s+(?<id>[0-9a-f]+)\s+(?<sz>[\d.]+\s*[KMGT]B)\s+(?<mod>.+?)\s*$'){
      $name=$Matches.n; $mid=$Matches.id; $szTxt=$Matches.sz -replace '\s',''
      $szGB = 0.0
      if($szTxt -match '([\d.]+)GB'){ $szGB=[double]$Matches[1] } elseif($szTxt -match '([\d.]+)MB'){ $szGB=[math]::Round([double]$Matches[1]/1024,2) }
      $params = if($name -match ':(\d+\.?\d*[bB])'){ $Matches[1].ToLower() }else{ "" }
      $quant  = if($name -match '(q\d[_a-z0-9]*)'){ $Matches[1] }else{ "default(~q4)" }
      $vramMB = [int]($szGB*1024)
      $fitsGpu = ($gpuTotalMax -gt 0 -and $vramMB + $GPU_VRAM_HEADROOM_MB -le $gpuTotalMax)
      $prefPath = if($fitsGpu){ "gpu" }else{ "cpu(or partial offload)" }
      $latency = if($szGB -lt 4){"low"}elseif($szGB -lt 8){"medium"}else{"high"}
      $models += [ordered]@{ name=$name; id=$mid; size_gb=$szGB; params=$params; quantization=$quant;
        est_vram_mb=$vramMB; fits_gpu=$fitsGpu; preferred_path=$prefPath; latency_class=$latency; task_class="general-lightweight-llm" }
    }
  }
}

# ---- capability health (independent axes; AI failure must NOT fail the node) ----
$nodeHealth = "OK"
if($cFree -lt 10){ $nodeHealth="FAIL" } elseif($cFree -lt 25 -or $ramFreeGB -lt 2){ $nodeHealth="WARN" }
$computeCap = if($dockerUp){"READY"}else{"DEGRADED"}

$gpuReason="OK"; $gpuCap="READY"
if(-not $gpuOk){ $gpuCap="FAIL_CLOSED"; $gpuReason="NO_GPU_OR_DRIVER" }
elseif($gpuFreeMax -lt $GPU_VRAM_HEADROOM_MB){ $gpuCap="FAIL_CLOSED"; $gpuReason="VRAM_EXHAUSTED" }

$llmReason="OK"; $llmCap="READY"
if(-not $ollamaUp){ $llmCap="FAIL_CLOSED"; $llmReason="OLLAMA_DOWN" }
elseif($models.Count -eq 0){ $llmCap="FAIL_CLOSED"; $llmReason="NO_MODELS" }
elseif($ramFreeGB -lt $MIN_FREE_RAM_GB){ $llmCap="FAIL_CLOSED"; $llmReason="INSUFFICIENT_RAM_HEADROOM" }

# max concurrent AI jobs from VRAM headroom (fallback to RAM if no GPU)
$maxAi = if($gpuTotalMax -gt 0){ [math]::Max(1,[math]::Floor($gpuTotalMax/4096)) } else { [math]::Max(1,[math]::Floor($ramTotalGB/8)) }

$obj = [ordered]@{
  schema="hermes-placement-readiness/1"; canonicalization="jcs-rfc8785/1"; node="hermes-node"; observed_at=(Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"); scheduler="OFF"
  resources=[ordered]@{ cpu_cores=$cores; cpu_threads=$threads; cpu_load_pct=$loadPct;
    ram_total_gb=$ramTotalGB; ram_free_gb=$ramFreeGB; c_free_gb=$cFree; d_free_gb=$dFree; workspace_free_gb=$workspaceFree;
    docker=$(if($dockerUp){"v$dockerVer"}else{"down"}); gpus=$gpus; ollama=$(if($ollamaUp){"running"}else{"down"}); running_workloads=$running }
  node_health=$nodeHealth
  compute_capability_health=$computeCap
  gpu_inference_capability_health=$gpuCap; gpu_reason=$gpuReason
  local_llm_capability_health=$llmCap; local_llm_reason=$llmReason
  limits=[ordered]@{ min_free_ram_gb=$MIN_FREE_RAM_GB; min_free_disk_gb=$MIN_FREE_DISK_GB; gpu_vram_headroom_mb=$GPU_VRAM_HEADROOM_MB;
    max_concurrent_ai_jobs=$maxAi;
    inference_fail_closed_when=@("no GPU/driver","VRAM free < headroom","ollama down","no models","RAM free < min");
    do_not_fail_node_when=@("GPU busy/hot","a single model missing","one AI job saturating VRAM") }
  model_inventory=$models
  workload_classes=[ordered]@{
    ready=@("local-llm-inference","gpu-batch","agent-runtime","model-evaluation")
    pending_or_reject=@("authoritative-state","county-production-writes","pacs-production-writes","memory-heavy-beyond-proven-headroom") }
}
$json = $obj | ConvertTo-Json -Depth 6
$json | Out-File "C:\HermesLab\hermes\hermes-placement.json" -Encoding utf8
$json
