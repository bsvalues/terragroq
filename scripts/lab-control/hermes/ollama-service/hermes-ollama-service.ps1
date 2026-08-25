# HERMES canonical Ollama service — startup path.
#
# This is the ONE owner of Ollama on HERMES. The `ollama` service stanza in
# C:\HermesLab\hermes\docker-compose.yml is superseded by this file and must stay removed: two
# runtimes competing for port 11434 and one model store is the failure #997 was commissioned to end,
# not a redundancy worth keeping.
#
# Why native Windows rather than the container that used to hold this job: the P40 runs in TCC mode,
# TCC devices have no WDDM presence, and WSL2 reaches GPUs only through the WDDM stack. NVML
# enumerates every adapter before answering any query, so nvidia-container-cli's prestart hook fails
# for EVERY card on this host -- the RTX 3050 included -- before it ever reads a device selector.
# Native Windows has no such layer and addresses the P40 directly.
#
# Run by Task Scheduler at startup as SYSTEM. `ollama serve` is executed in the FOREGROUND, so the
# task stays in state Running for exactly as long as inference is actually available, and the task
# state is therefore a truthful health signal rather than a record that something was once launched.

# NOT 'Stop'. Windows PowerShell 5.1 turns a native command's stderr into a TERMINATING error under
# 'Stop', and `ollama serve` writes its entire structured log to stderr -- so the service died on its
# first log line, exit 1, with a service log that ended mid-startup and looked like a crash in
# Ollama. Every check below is explicit and exits on its own terms instead.
$ErrorActionPreference = 'Continue'

# --- Pinned configuration. Nothing here resolves "latest" at runtime. ---------------------------
# start-hermes.ps1 runs `docker compose pull` before `up -d`, which silently replaced the running
# image identity on every documented start. A service that re-resolved its own version at boot would
# reintroduce exactly that defect in a new place, so the version is a literal path.
$OllamaExe = 'D:\HermesServices\ollama\v0.9.2\ollama.exe'
$ModelsDir = 'D:\HermesData\ollama\models'
$Listen = '127.0.0.1:11434'
$P40Uuid = 'GPU-4f7d4396-9304-d12f-7e9b-7f04d1236fc2'
$PowerCapWatts = 150
$Smi = 'C:\Windows\System32\nvidia-smi.exe'

# v0.9.2 is the newest published Ollama whose CUDA runner this host's driver can load, and cuda_v11
# is the reason. Every release ships a cuda_v12 runner built against cudart 12.8; driver 560.94 tops
# out at CUDA 12.6 and fails the module load with "the provided PTX was compiled with an unsupported
# toolchain" -- observed on v0.32.15, which discovered the P40 correctly and then died at warmup.
# v0.6.0-v0.9.2 also ship a cuda_v11 runner (cudart 11.3), which loads here and supports Pascal
# sm_61 natively. Left to itself Ollama prefers v12 on a 12.6 driver, so the runner is forced.
# Raising the host GPU driver would lift this pin; that is a host-wide change and an owner decision.
$LlmLibrary = 'cuda_v11'

$LogRoot = 'C:\ProgramData\WilliamOS\logs'
$LogFile = Join-Path $LogRoot 'hermes-ollama-service.log'
# Ollama's own output goes to its own file. Interleaving a chatty inference log into the lifecycle
# log makes the one question this file exists to answer -- did the cap apply, did the service start
# -- unreadable at exactly the moment someone needs it.
$ServeLog = Join-Path $LogRoot 'hermes-ollama-serve.log'

New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
function Write-Log([string]$Level, [string]$Message) {
    $line = "{0} {1} {2}" -f (Get-Date).ToUniversalTime().ToString('o'), $Level, $Message
    Add-Content -Path $LogFile -Value $line
    Write-Output $line
}

Write-Log INFO "startup exe=$OllamaExe models=$ModelsDir listen=$Listen gpu=$P40Uuid runner=$LlmLibrary"

# --- 1. One owner. -----------------------------------------------------------------------------
# If something is already serving 11434 this script must not become a second Ollama. That is the
# precise condition the commissioning acceptance test exists to detect, so refuse rather than race.
$existing = @(Get-Process -Name 'ollama' -ErrorAction SilentlyContinue)
if ($existing.Count -gt 0) {
    Write-Log FATAL "refusing to start: ollama already running (pids $(($existing.Id) -join ','))"
    exit 1
}
if (Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue) {
    Write-Log FATAL 'refusing to start: port 11434 already has a listener'
    exit 1
}

# --- 2. Preconditions. -------------------------------------------------------------------------
foreach ($p in @($OllamaExe, $ModelsDir, $Smi)) {
    if (-not (Test-Path $p)) { Write-Log FATAL "missing required path: $p"; exit 1 }
}

# --- 3. Power envelope, reconciled every boot, fail closed. ------------------------------------
# Persistence mode reads N/A on this Windows host, so `nvidia-smi -pl` has nothing holding it and a
# reboot silently restores the 250 W default -- which is exactly how the owner's earlier cap
# disappeared. A one-shot command is therefore not a commissioning control; reapplying it here, in
# the service's own startup path, is what makes the cap durable. If the cap cannot be applied AND
# read back, inference does not start: an uncapped card running work is the outcome being prevented.
$before = & $Smi --query-gpu=power.limit,power.default_limit,driver_model.current --format=csv,noheader -i $P40Uuid 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Log FATAL "P40 not addressable by UUID ($P40Uuid): $before"
    exit 1
}
Write-Log INFO "P40 before cap: $($before -join ' ')"
if ($before -notmatch 'TCC') {
    Write-Log WARN "P40 driver model is not TCC; commissioning assumed TCC. Continuing, but the assumption changed."
}

$apply = & $Smi -i $P40Uuid -pl $PowerCapWatts 2>&1
Write-Log INFO "apply cap rc=$LASTEXITCODE :: $($apply -join ' ')"
$after = (& $Smi --query-gpu=power.limit --format=csv,noheader,nounits -i $P40Uuid 2>&1 | Select-Object -First 1)
$applied = 0.0
if (-not [double]::TryParse(($after -as [string]).Trim(), [ref]$applied)) {
    Write-Log FATAL "could not read back power limit (got '$after') -- not starting inference"
    exit 1
}
if ([math]::Abs($applied - $PowerCapWatts) -gt 0.5) {
    Write-Log FATAL "power cap verification failed: wanted ${PowerCapWatts}W, read ${applied}W -- not starting inference"
    exit 1
}
Write-Log INFO "power cap verified at ${applied}W"

# The RTX 3050 keeps its display/utility role and its own power policy. This service never touches
# it; it is only read here so the log can show it was left alone.
$rtx = & $Smi --query-gpu=uuid,name,driver_model.current,power.limit --format=csv,noheader -i GPU-6d9ae165-7272-a38c-06b1-7276869e980f 2>&1
Write-Log INFO "RTX 3050 untouched: $($rtx -join ' ')"

# --- 4. Environment. ---------------------------------------------------------------------------
# CUDA_VISIBLE_DEVICES is set by UUID, never by ordinal: ordinals are assigned by enumeration order
# and would silently point at the display card if enumeration ever changed.
$env:CUDA_VISIBLE_DEVICES = $P40Uuid
$env:OLLAMA_HOST = $Listen
$env:OLLAMA_MODELS = $ModelsDir
$env:OLLAMA_LLM_LIBRARY = $LlmLibrary
# Ollama prunes blobs no manifest references when it starts. On first contact with this store it
# removed four such orphans (10,443 bytes; all five models stayed complete). Whatever the merits of
# that, an inference service does not get to delete from the owner's model library as a side effect.
$env:OLLAMA_NOPRUNE = '1'

Write-Log INFO "exec: $OllamaExe serve (output -> $ServeLog)"
"=== serve start $((Get-Date).ToUniversalTime().ToString('o')) ===" | Add-Content -Path $ServeLog

# Invoked directly, not via Start-Process, so ollama.exe is a direct child of this script: Task
# Scheduler kills the task's process tree, and a detached grandchild would survive a stop and become
# the second owner this whole migration exists to prevent.
& $OllamaExe serve *>> $ServeLog
$rc = $LASTEXITCODE

Write-Log WARN "ollama serve exited rc=$rc -- see $ServeLog"
exit $rc
