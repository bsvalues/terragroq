$ErrorActionPreference = 'Continue'
# #997 RESUME — there are TWO Ollama model stores on this machine, and the lane may not choose
# between them by authority. D:\HermesData\ollama is what the owning compose file points at.
# G:\HermesData\ollama was created at 2026-08-18T20:42:33Z — the same second the hand-made
# container was created with a bind to "F:/HermesData/ollama". This probe establishes what each
# store actually contains, whether one is a subset of the other, and whether the drive now
# lettered G: is the drive that was then lettered F:.
function Show-Store($root, $tag) {
    Write-Output "=== $tag root=$root ==="
    if (-not (Test-Path $root)) { Write-Output "${tag}_ABSENT"; return }
    Get-ChildItem $root -Force -ErrorAction SilentlyContinue | Select-Object Name, Mode, LastWriteTimeUtc | Format-Table -AutoSize | Out-String -Width 140
    $man = Join-Path $root 'models\manifests'
    if (Test-Path $man) {
        Get-ChildItem $man -Recurse -File | ForEach-Object {
            "${tag}_manifest=" + $_.FullName.Substring($man.Length + 1) + " bytes=" + $_.Length + " mtime=" + $_.LastWriteTimeUtc.ToString('o')
        }
    } else { Write-Output "${tag}_NO_MANIFESTS" }
    $blobs = Join-Path $root 'models\blobs'
    if (Test-Path $blobs) {
        $b = Get-ChildItem $blobs -File
        $m = $b | Measure-Object -Sum Length
        Write-Output "${tag}_blobs_count=$($m.Count) ${tag}_blobs_bytes=$($m.Sum)"
        $b | Sort-Object Name | ForEach-Object { "${tag}_blob=" + $_.Name + " bytes=" + $_.Length + " mtime=" + $_.LastWriteTimeUtc.ToString('o') }
    } else { Write-Output "${tag}_NO_BLOBS" }
}
Show-Store 'D:\HermesData\ollama' 'D'
Show-Store 'G:\HermesData\ollama' 'G'
Write-Output '--- CONTAINER-LABELS-JSON ---'
foreach ($c in @('ollama', 'open-webui', 'postgres', 'redis', 'portainer', 'williamos-hermes-inference-proxy')) {
    $lbl = & docker inspect $c --format '{{json .Config.Labels}}' 2>&1
    Write-Output "LABELS $c => $lbl"
}
Write-Output '--- INFERENCE-PROXY ---'
& docker inspect williamos-hermes-inference-proxy --format '{{.State.Status}}|{{.State.ExitCode}}|{{.State.Error}}|{{.State.FinishedAt}}' 2>&1
& docker inspect williamos-hermes-inference-proxy --format '{{json .HostConfig.Binds}}|{{json .HostConfig.PortBindings}}|{{json .Config.Env}}' 2>&1
Write-Output '--- PROXY-LOGS-TAIL ---'
& docker logs --tail 25 williamos-hermes-inference-proxy 2>&1
Write-Output '--- CONFIG-REFERENCES-TO-DRIVE ---'
# Anything on this machine that names an Ollama store path, so the lane learns which letter the
# rest of the system believes in rather than guessing from one file.
$roots = @('C:\HermesLab', 'C:\WilliamOS', 'C:\Users\bs\.williamos')
foreach ($r in $roots) {
    if (-not (Test-Path $r)) { Write-Output "SEARCH_ROOT_ABSENT $r"; continue }
    Get-ChildItem $r -Recurse -File -Include *.yml, *.yaml, *.json, *.ps1, *.env, *.md -ErrorAction SilentlyContinue |
        Where-Object { $_.Length -lt 400000 } |
        Select-String -Pattern 'HermesData' -SimpleMatch -ErrorAction SilentlyContinue |
        Select-Object -First 60 |
        ForEach-Object { "REF " + $_.Path + ":" + $_.LineNumber + " :: " + ($_.Line.Trim()) }
}
Write-Output '--- NVME-LETTER-HISTORY ---'
# Which physical volume does each letter point at now, and what does the registry remember for the
# letters around it? A store that moved letters is not a store that vanished.
$md = Get-ItemProperty 'HKLM:\SYSTEM\MountedDevices' -ErrorAction SilentlyContinue
foreach ($letter in @('D:', 'E:', 'F:', 'G:', 'H:', 'I:', 'J:')) {
    $key = "\DosDevices\$letter"
    if ($md.PSObject.Properties.Name -contains $key) {
        $bytes = $md.$key
        $ascii = (($bytes | Where-Object { $_ -ge 32 -and $_ -lt 127 } | ForEach-Object { [char]$_ }) -join '')
        Write-Output "$letter => $ascii"
    } else { Write-Output "$letter => <not recorded>" }
}
Write-Output '--- G-PARTITION-IDENTITY ---'
$gp = Get-Partition -DriveLetter G -ErrorAction SilentlyContinue
if ($gp) {
    $gd = Get-Disk -Number $gp.DiskNumber
    Write-Output "G_disk=$($gd.Number) model=$($gd.FriendlyName) serial=$($gd.SerialNumber) bus=$($gd.BusType) guid=$($gp.Guid)"
} else { Write-Output 'G_PARTITION_ABSENT' }
Write-Output '--- PULL-LOG-D ---'
if (Test-Path 'D:\HermesData\ollama\pull.log') { Get-Content 'D:\HermesData\ollama\pull.log' -Tail 30 } else { Write-Output 'NO_PULL_LOG_D' }
Write-Output '--- RC ---'
