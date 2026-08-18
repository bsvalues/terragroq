# Snapshot all named Docker volumes to F:\lab-backups\hermes-volumes as tar.gz. Re-runnable (timestamped).
$ErrorActionPreference = "Continue"
$backupDir = "F:\lab-backups\hermes-volumes"
New-Item -ItemType Directory -Force $backupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$vols = @(
  "hermes_pgdata","hermes_redisdata",
  "terrafusion_final_build_20250615_051930_mongo_data",
  "terrafusion_final_build_20250615_051930_postgres_data",
  "terrafusion_final_build_20250615_051930_redis_data"
)
Write-Host "Backing up $($vols.Count) volumes to $backupDir (stamp $stamp)"
foreach ($v in $vols) {
  $out = "$v-$stamp.tar.gz"
  Write-Host ">> $v"
  docker run --rm -v "${v}:/data:ro" -v "F:/lab-backups/hermes-volumes:/backup" alpine sh -c "tar czf /backup/$out -C /data ." 2>&1 | Out-Null
  $f = Join-Path $backupDir $out
  if (Test-Path $f) { Write-Host ("   OK - {0} MB" -f [int]((Get-Item $f).Length/1MB)) } else { Write-Host "   FAILED" }
}
Write-Host "`n=== backups now in $backupDir ==="
Get-ChildItem $backupDir -File -EA SilentlyContinue | Sort-Object LastWriteTime -Descending |
  Select-Object @{n='MB';e={[int]($_.Length/1MB)}}, Name | Format-Table -Auto | Out-String
# Retention: delete backups older than 14 days so D: doesn't fill up
$cutoff = (Get-Date).AddDays(-14)
$old = Get-ChildItem $backupDir -Filter *.tar.gz -EA SilentlyContinue | Where-Object { $_.LastWriteTime -lt $cutoff }
if ($old) { $old | Remove-Item -Force -EA SilentlyContinue; Write-Host "pruned $($old.Count) backup(s) older than 14 days" }

Write-Host "NOTE: live-DB tar snapshots are fine for empty/idle DBs; for production Postgres data use pg_dump."
Write-Host "BACKUP_DONE"