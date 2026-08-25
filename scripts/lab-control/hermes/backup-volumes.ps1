# Snapshot all named Docker volumes to the lab archive volume as tar.gz. Re-runnable (timestamped).
#
# THE DESTINATION IS RESOLVED BY VOLUME LABEL, NOT BY DRIVE LETTER, and that is the whole repair.
# This script wrote to `F:\lab-backups\hermes-volumes` and worked until 2026-08-23. On 2026-08-24 the
# task began failing, because the NVMe that carried `F:` is now lettered `G:` -- the same class of
# fault as the 2026-08-18 LAN move, where a hard-coded address outlived the thing it addressed. A
# letter is an assignment; a label travels with the disk. `HERMES_NVME` is the label on the 931 GB
# NVMe that already holds the archive history this script produced.
#
# A letter is also worse than merely fragile: had `F:` been reassigned to a USB stick, `New-Item
# -Force` would have cheerfully created a fresh archive tree on it and every run would have reported
# success while protecting nothing -- which is exactly the failure the 2026-08-18 backup recovery
# existed to end. Resolving the label refuses instead.
[CmdletBinding()]
param(
  # Resolve and print the destination, then stop. Nothing is created, no container runs.
  # This is what lets the resolution be proven on real hardware without touching Docker.
  [switch]$ResolveOnly,
  # Overridable ONLY so the refusal can be exercised. A guard with no negative test is a guard
  # nobody has seen refuse, and the 2026-08-18 recovery was full of those.
  [string]$ArchiveVolumeLabel = "HERMES_NVME"
)

$ErrorActionPreference = "Stop"

function Resolve-ArchiveRoot {
  param([string]$Label)
  $candidates = @(Get-Volume -ErrorAction Stop | Where-Object { $_.FileSystemLabel -eq $Label -and $_.DriveLetter })
  if ($candidates.Count -eq 0) {
    throw "ARCHIVE_VOLUME_ABSENT: no mounted volume is labelled '$Label'. The archive disk is not attached, or its label changed. Nothing was backed up."
  }
  if ($candidates.Count -gt 1) {
    $letters = ($candidates | ForEach-Object { $_.DriveLetter }) -join ", "
    throw "ARCHIVE_VOLUME_AMBIGUOUS: $($candidates.Count) volumes are labelled '$Label' ($letters). Refusing to guess which one holds the archive."
  }
  return "$($candidates[0].DriveLetter):"
}

$archiveRoot = Resolve-ArchiveRoot -Label $ArchiveVolumeLabel
$backupDir = Join-Path $archiveRoot "lab-backups\hermes-volumes"
# Docker takes a forward-slash path for the bind mount; derived from the same resolved root so the
# two can never disagree.
$backupMount = $backupDir -replace '\\', '/'

if ($ResolveOnly) {
  [pscustomobject]@{
    archiveVolumeLabel = $ArchiveVolumeLabel
    archiveRoot        = $archiveRoot
    backupDir          = $backupDir
    backupMount        = $backupMount
    backupDirExists    = (Test-Path $backupDir)
  } | ConvertTo-Json -Compress
  exit 0
}

$ErrorActionPreference = "Continue"
New-Item -ItemType Directory -Force $backupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$vols = @(
  "hermes_pgdata","hermes_redisdata",
  "terrafusion_final_build_20250615_051930_mongo_data",
  "terrafusion_final_build_20250615_051930_postgres_data",
  "terrafusion_final_build_20250615_051930_redis_data"
)
Write-Host "Backing up $($vols.Count) volumes to $backupDir (stamp $stamp)"
$failed = @()
foreach ($v in $vols) {
  $out = "$v-$stamp.tar.gz"
  Write-Host ">> $v"
  docker run --rm -v "${v}:/data:ro" -v "${backupMount}:/backup" alpine sh -c "tar czf /backup/$out -C /data ." 2>&1 | Out-Null
  $f = Join-Path $backupDir $out
  if (Test-Path $f) { Write-Host ("   OK - {0} MB" -f [int]((Get-Item $f).Length/1MB)) } else { Write-Host "   FAILED"; $failed += $v }
}
Write-Host "`n=== backups now in $backupDir ==="
Get-ChildItem $backupDir -File -EA SilentlyContinue | Sort-Object LastWriteTime -Descending |
  Select-Object @{n='MB';e={[int]($_.Length/1MB)}}, Name | Format-Table -Auto | Out-String
# Retention: delete backups older than 14 days so the archive volume doesn't fill up.
$cutoff = (Get-Date).AddDays(-14)
$old = Get-ChildItem $backupDir -Filter *.tar.gz -EA SilentlyContinue | Where-Object { $_.LastWriteTime -lt $cutoff }
if ($old) { $old | Remove-Item -Force -EA SilentlyContinue; Write-Host "pruned $($old.Count) backup(s) older than 14 days" }

Write-Host "NOTE: live-DB tar snapshots are fine for empty/idle DBs; for production Postgres data use pg_dump."

# A task result of 0 used to mean "the script reached the end", not "the volumes are archived": every
# volume could fail and Task Scheduler would still record success. `HermesVolumeBackup` reporting 0
# while writing nothing is the documented shape of the 2026-08-18 failure, and it is repaired here
# rather than left for the next reader to rediscover.
if ($failed.Count -gt 0) {
  Write-Host "BACKUP_FAILED missing=$($failed -join ',')"
  exit 1
}
Write-Host "BACKUP_DONE"
exit 0
