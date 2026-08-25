$ErrorActionPreference = 'Continue'
# #997 RESUME — compose-vs-live reconciliation, run only AFTER storage truth was established.
# The question this answers is not "what does the compose file say" (that was read pre-reboot) but
# "is the owning definition still the same bytes after the interruption, and what did the live
# container's F: bind actually resolve to". A bind to a host path Windows does not have does not
# fail loudly on Docker Desktop — it is translated into the WSL VM — so the model library may have
# been invisible to the service without anything reporting an error.
Write-Output '--- G-HERMESDATA ---'
if (Test-Path 'G:\HermesData') {
    Get-ChildItem 'G:\HermesData' -Force -ErrorAction SilentlyContinue | Select-Object Name, Mode, LastWriteTimeUtc | Format-Table -AutoSize | Out-String -Width 160
    Write-Output "G_ollama_present=$(Test-Path 'G:\HermesData\ollama')"
    if (Test-Path 'G:\HermesData\ollama\models\blobs') {
        $m = Get-ChildItem 'G:\HermesData\ollama\models\blobs' -File | Measure-Object -Sum Length
        Write-Output "G_blobs_count=$($m.Count) G_blobs_bytes=$($m.Sum)"
    } else { Write-Output 'G_NO_BLOBS' }
} else { Write-Output 'G_HERMESDATA_ABSENT' }
Write-Output '--- COMPOSE-DIGEST ---'
$compose = 'C:\HermesLab\hermes\docker-compose.yml'
if (Test-Path $compose) {
    Write-Output "compose_sha256=$((Get-FileHash $compose -Algorithm SHA256).Hash.ToLower())"
    Write-Output "compose_mtime_utc=$((Get-Item $compose).LastWriteTimeUtc.ToString('o'))"
    Write-Output '--- COMPOSE-BODY ---'
    Get-Content $compose -Raw
} else { Write-Output 'COMPOSE_ABSENT' }
Write-Output '--- COMPOSE-ENV ---'
if (Test-Path 'C:\HermesLab\hermes\.env') {
    (Get-Content 'C:\HermesLab\hermes\.env') | ForEach-Object { if ($_ -match 'PASSWORD|SECRET|KEY|TOKEN') { ($_ -replace '=.*', '=<redacted>') } else { $_ } }
} else { Write-Output 'ENV_ABSENT' }
Write-Output '--- LIVE-CONTAINERS ---'
& docker ps -a --format '{{.Names}}|{{.Status}}|{{.Ports}}|{{.Image}}' 2>&1
Write-Output '--- OLLAMA-STATE-NOW ---'
& docker inspect ollama --format '{{.State.Status}}|{{.State.ExitCode}}|{{.State.StartedAt}}|{{.State.FinishedAt}}|{{.RestartCount}}' 2>&1
Write-Output '--- OLLAMA-BIND-NOW ---'
& docker inspect ollama --format '{{json .HostConfig.Binds}}|{{json .HostConfig.PortBindings}}|{{json .HostConfig.DeviceRequests}}' 2>&1
Write-Output '--- COMPOSE-LABELS ---'
foreach ($c in @('ollama', 'open-webui', 'postgres', 'redis', 'portainer', 'williamos-hermes-inference-proxy')) {
    $lbl = & docker inspect $c --format '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.project.config_files"}}|{{index .Config.Labels "com.docker.compose.service"}}' 2>&1
    Write-Output "$c => $lbl"
}
Write-Output '--- OPEN-WEBUI-CONTRACT ---'
& docker inspect open-webui --format '{{json .Config.Env}}' 2>&1
Write-Output '--- F-BIND-RESOLUTION-IN-VM ---'
# Where did "F:/HermesData/ollama" actually land? Docker Desktop maps host drives under
# /run/desktop/mnt/host/<letter> inside the docker-desktop distro. If f/ exists there and is empty,
# the service that ran for six days had an empty model store and nothing said so.
$tmp = [System.IO.Path]::GetTempFileName()
$p = Start-Process -FilePath 'wsl.exe' -ArgumentList @('-d', 'docker-desktop', 'sh', '-c', 'echo "== host mounts =="; ls -1 /run/desktop/mnt/host 2>&1; echo "== f =="; ls -la /run/desktop/mnt/host/f 2>&1; echo "== f/HermesData/ollama =="; ls -la /run/desktop/mnt/host/f/HermesData/ollama 2>&1; echo "== d/HermesData/ollama =="; ls -la /run/desktop/mnt/host/d/HermesData/ollama 2>&1') -NoNewWindow -Wait -PassThru -RedirectStandardOutput "$tmp.o" -RedirectStandardError "$tmp.e"
Write-Output "EXIT=$($p.ExitCode)"
(Get-Content "$tmp.o" -ErrorAction SilentlyContinue) -join "`n"
(Get-Content "$tmp.e" -ErrorAction SilentlyContinue) -join "`n"
Remove-Item "$tmp*" -ErrorAction SilentlyContinue
Write-Output '--- PORT-11434-LISTENERS ---'
(Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress, LocalPort, OwningProcess | Format-Table -AutoSize | Out-String -Width 120)
Write-Output '--- STAGING-DIGESTS ---'
foreach ($f in @('lib\fabric\audit.mjs', 'lib\fabric\broker.mjs', 'lib\fabric\run-baseline.mjs', 'scripts\execution-fabric\probe-windows.ps1', 'config\execution-fabric\registry.seed.json')) {
    $full = Join-Path 'C:\Users\bs\p40-commissioning' $f
    if (Test-Path $full) { Write-Output ("{0}  {1}" -f (Get-FileHash $full -Algorithm SHA256).Hash.ToLower(), $f) } else { Write-Output "MISSING $f" }
}
Write-Output '--- RC ---'
