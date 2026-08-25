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
#
# THREE THINGS THAT CLAIM DEPENDS ON. Review found the first missing; executing the failure it
# described on this host found the third, which is the one that made the other two moot:
#
#   OWNERSHIP IS THE PORT, NOT THE NAME. The server and the runner children it spawns are all
#   `ollama.exe`, and on this host runner children outlive their parent. A guard that refused on the
#   name alone turned a dead server with a surviving runner into three failed retries and a task
#   whose terminal state said "refused" while the API was simply down. See section 1.
#
#   THERMAL PROTECTION HERE IS A START GUARD ONLY. Section 3b refuses to begin inference on a card
#   that is already hot or whose temperature cannot be read. Once `ollama serve` is running, nothing
#   in this file reads temperature again -- no duration bound, no unload, no cutoff. That limit is
#   stated where the check is, so nobody reads a preflight as an envelope.
#
#   AND THE TASK MUST ACTUALLY END WHEN THE SERVER DOES. Waiting on end-of-stream instead of on
#   process exit kept this task in state `Running` after `ollama serve` had died, because a
#   surviving runner child held the output pipe open. Section 5 waits on the process.

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
# The temperature at or above which this service refuses to START. MIG-13's cooldown baseline on
# this card in this chassis is 68 C, its soak aborted at 85 C, and the hardware slows itself at
# 92 C. 80 C therefore means "materially hotter than idle", i.e. still carrying heat from work that
# has just stopped -- which is precisely when starting more work is the wrong move.
$ThermalStartCeilingC = 80
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
# Ollama writes its structured log to stderr; stdout carries the little it prints directly. They are
# separate files because `Start-Process` cannot redirect both streams to one, and conflating them
# was never the point -- keeping them out of the lifecycle log was.
$ServeOutLog = Join-Path $LogRoot 'hermes-ollama-serve.out.log'

New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
function Write-Log([string]$Level, [string]$Message) {
    $line = "{0} {1} {2}" -f (Get-Date).ToUniversalTime().ToString('o'), $Level, $Message
    Add-Content -Path $LogFile -Value $line
    Write-Output $line
}

Write-Log INFO "startup exe=$OllamaExe models=$ModelsDir listen=$Listen gpu=$P40Uuid runner=$LlmLibrary"

# --- 1. One owner -- and the difference between an owner and the wreckage of one. ---------------
# THE PORT IS THE OWNERSHIP TEST, NOT THE PROCESS NAME. `ollama.exe` is both the server and the
# runner child it spawns per loaded model -- this host's own acceptance capture records
# `ollama.exe serve` pid 10788 and `ollama.exe runner --model ...` pid 9736 ppid 10788 -- and on
# this machine runner children are observed to SURVIVE their parent: MIG-09 found three of them
# still holding P40 VRAM after the compat proof's parent was killed, and cleared them by hand
# before the first start.
#
# A name-only guard therefore inverts this file's central claim. If `ollama serve` dies while a
# runner survives, all three of the task's configured retries exit here, the API stays down, and
# the task's terminal state reports a refusal rather than an outage -- a health signal that is
# exactly wrong. So: refuse to a real owner, RECLAIM the wreckage of a dead one, and never confuse
# the two.
$listener = @(Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue)
if ($listener.Count -gt 0) {
    $owning = ($listener.OwningProcess | Sort-Object -Unique) -join ','
    Write-Log FATAL "refusing to start: port 11434 already has a listener (owning pids $owning)"
    exit 1
}

# Command line and parentage, which Get-Process does not carry and which are the whole difference.
$ollama = @(Get-CimInstance Win32_Process -Filter "Name LIKE 'ollama%'" -ErrorAction SilentlyContinue)
# A process whose command line cannot be read counts as a SERVER. Unreadable is not harmless, and
# this guard fails closed in the direction of refusing rather than of killing.
$servers = @($ollama | Where-Object { -not $_.CommandLine -or $_.CommandLine -notmatch '(?i)\brunner\b' })
$runners = @($ollama | Where-Object { $_.CommandLine -match '(?i)\brunner\b' })

if ($servers.Count -gt 0) {
    foreach ($s in $servers) {
        Write-Log FATAL "refusing to start: an ollama server process is alive (pid $($s.ProcessId) ppid $($s.ParentProcessId) path $($s.ExecutablePath))"
    }
    exit 1
}

# No listener and no server: every runner still here is an orphan of a dead one. Reclaim only the
# ones that came from THIS service's pinned binary -- a runner from another install is a foreign
# owner, and killing a process this service did not start is not reclamation.
if ($runners.Count -gt 0) {
    $foreign = @($runners | Where-Object { $_.ExecutablePath -ne $OllamaExe })
    if ($foreign.Count -gt 0) {
        foreach ($f in $foreign) {
            Write-Log FATAL "refusing to start: an ollama runner from a different install is alive (pid $($f.ProcessId) path $($f.ExecutablePath)); this service does not kill processes it did not start"
        }
        exit 1
    }
    foreach ($r in $runners) {
        Write-Log WARN "reclaiming orphaned runner pid=$($r.ProcessId) ppid=$($r.ParentProcessId) :: $($r.CommandLine)"
        Stop-Process -Id $r.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 4
    $left = @(Get-CimInstance Win32_Process -Filter "Name LIKE 'ollama%'" -ErrorAction SilentlyContinue)
    if ($left.Count -gt 0) {
        Write-Log FATAL "refusing to start: $($left.Count) ollama process(es) survived reclamation (pids $(($left.ProcessId) -join ','))"
        exit 1
    }
    Write-Log INFO "reclaimed $($runners.Count) orphaned runner(s); the P40 VRAM they held returns with them"
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

# --- 3b. Thermal preflight, fail closed -- AND WHAT IT DELIBERATELY IS NOT. ---------------------
# MIG-13 measured this card going 68 C -> 85 C in 59 seconds at this exact cap, plateau=False. The
# abort that stopped that soak lived in the BENCH HARNESS. It was never in this file.
#
# What is added here is a START guard, on the same fail-closed discipline as the power cap above and
# for the same reason: the service refuses to begin inference on a card that is already hot, and
# refuses outright if the temperature cannot be read.
#
# WHAT IT IS NOT, stated here rather than left to be inferred: this is NOT a runtime thermal guard.
# Once `ollama serve` is running, NOTHING IN THIS SERVICE READS TEMPERATURE AGAIN. There is no
# duration bound, no unload path and no cutoff. Between sustained load and thermal slowdown there is
# the card's own hardware throttle at 92 C, the 150 W cap reapplied above, and the admission rule
# SUSTAINED = NOT_ADMITTED -- which is a rule about what may be sent to this service, not a mechanism
# that stops it arriving. The named precondition for closing that gap is the chassis airflow
# qualification, not a power number and not a retry.
$temp = (& $Smi --query-gpu=temperature.gpu --format=csv,noheader,nounits -i $P40Uuid 2>&1 | Select-Object -First 1)
$tempC = 0.0
if (-not [double]::TryParse(($temp -as [string]).Trim(), [ref]$tempC)) {
    Write-Log FATAL "could not read P40 temperature (got '$temp') -- not starting inference"
    exit 1
}
if ($tempC -ge $ThermalStartCeilingC) {
    Write-Log FATAL "P40 is at ${tempC}C, at or above the ${ThermalStartCeilingC}C start ceiling -- not starting inference. Let it cool; if this recurs, the chassis airflow qualification is the fix."
    exit 1
}
Write-Log INFO "P40 thermal preflight ${tempC}C (start ceiling ${ThermalStartCeilingC}C; there is NO runtime thermal guard -- see the note above this check)"

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

# --- 5. Serve, and WAIT ON THE PROCESS rather than on end-of-stream. ----------------------------
#
# The obvious form was `& $OllamaExe serve *>> $ServeLog`, and this host demonstrated why it is
# worse than it looks. PowerShell reads a native command's output through a PIPE; `ollama serve`'s
# runner children inherit the write end of that pipe; and a runner that outlives its parent
# therefore holds the pipe open indefinitely. The call never returns.
#
# Observed directly on HERMES while remediating the one-owner guard: with `ollama serve` killed and
# exactly one runner surviving, this task sat in state `Running` -- for minutes, with no listener on
# 11434 and no server process anywhere. That is the precise inverse of the claim at the top of this
# file, and it is strictly worse than the failure review predicted: Task Scheduler's three
# configured retries never even begin, because from its point of view the task never failed. The
# one-owner reclamation below cannot help a restart that is never attempted.
#
# `-NoNewWindow` keeps ollama.exe a child in this task's process tree -- nothing is detached, so a
# Task Scheduler stop still takes it down, which was the reason `Start-Process` was avoided
# originally. Redirection targets real files instead of pipes, and `Wait-Process` returns on PROCESS
# EXIT, so a surviving runner can no longer mask a dead server.
#
# `Start-Process` truncates its redirect targets, so the previous logs are rotated rather than lost.
foreach ($f in @($ServeLog, $ServeOutLog)) {
    if (Test-Path $f) {
        $rotated = "{0}.{1}" -f $f, (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
        Move-Item -LiteralPath $f -Destination $rotated -Force
        Write-Log INFO "rotated previous serve log to $rotated"
    }
}

Write-Log INFO "exec: $OllamaExe serve (stderr -> $ServeLog, stdout -> $ServeOutLog)"
$serve = Start-Process -FilePath $OllamaExe -ArgumentList 'serve' -NoNewWindow -PassThru `
    -RedirectStandardOutput $ServeOutLog -RedirectStandardError $ServeLog
Write-Log INFO "ollama serve started pid=$($serve.Id) as a child of this task (pid $PID)"

# `.Handle` is touched deliberately: it caches the process handle in this object, and without it
# `ExitCode` reads back as $null once the process is gone -- which the first live test of this file
# produced, and which `exit $null` turns into exit 0.
$null = $serve.Handle
$serve.WaitForExit()
$rc = $serve.ExitCode
if ($null -eq $rc) { $rc = 1 }

# A SERVER THAT STOPS IS AN OUTAGE, WHATEVER CODE IT STOPPED WITH. This task's contract is that it
# runs for exactly as long as inference is available, so reaching this line at all is a failure --
# and reporting 0 here would tell Task Scheduler the task completed successfully, which withholds
# the very restart policy (RestartCount 3) the one-owner reclamation above exists to serve. Measured
# rather than reasoned about: the first live run of this section exited 0, LastTaskResult 0, and no
# retry was attempted.
if ($rc -eq 0) {
    Write-Log WARN "ollama serve exited rc=0 -- a server that stops on its own is still an outage for this task; reporting 1 so the restart policy applies"
    $rc = 1
}

Write-Log WARN "ollama serve exited rc=$rc -- see $ServeLog"
exit $rc
