Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$backupDir = "C:\Users\bsval\williamos-local-runtime\backups"

Write-Output "WILLIAMOS_OMEN_BACKUP_CHECK"
Write-Output "MANUAL_ONLY: true"
Write-Output "SCHEDULE_CREATED: false"
Write-Output "AUTOMATIC_BACKUP_CREATED: false"
Write-Output "BACKUP_DIR: $backupDir"

if (-not (Test-Path -LiteralPath $backupDir)) {
    Write-Output "BACKUP_DIR_PRESENT: false"
    Write-Output "LATEST_BACKUP: none"
    Write-Output "WARNING: No backup directory found. Create an operator-local backup before meaningful local operation."
    Write-Output "SAFETY: no secrets printed / no schedule / no cloud sync"
    exit 0
}

$latest = Get-ChildItem -LiteralPath $backupDir -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

Write-Output "BACKUP_DIR_PRESENT: true"

if (-not $latest) {
    Write-Output "LATEST_BACKUP: none"
    Write-Output "WARNING: Backup directory is present but empty. Take a manual backup before meaningful local operation."
} else {
    Write-Output "LATEST_BACKUP: $($latest.Name)"
    Write-Output "LATEST_BACKUP_TIME: $($latest.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))"
    Write-Output "REMINDER: Confirm this backup is recent enough for the planned operation."
}

Write-Output "DO_NOT_BACK_UP: env files / database URLs / Better Auth secrets / access grant secrets / secret-bearing logs"
Write-Output "SAFETY: no secrets printed / no schedule / no cloud sync"
