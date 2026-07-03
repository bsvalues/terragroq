Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$backupDir = "C:\Users\bsval\williamos-local-runtime\backups"
$envFile = "C:\Users\bsval\williamos-local-runtime\app-container.env"

function Get-ContainerLine {
    param([string]$Name)

    $line = docker ps -a --filter "name=^/$Name$" --format "{{.Names}}|{{.Status}}|{{.Ports}}" 2>$null
    if ([string]::IsNullOrWhiteSpace($line)) {
        return "missing"
    }

    return $line
}

function Get-PortStatus {
    param([int]$Port)

    $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $listeners) {
        return "clear"
    }

    $bindings = $listeners | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort) pid=$($_.OwningProcess)" }
    return ($bindings -join "; ")
}

function Get-LatestBackupName {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return "none"
    }

    $latest = Get-ChildItem -LiteralPath $Path -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $latest) {
        return "none"
    }

    return "$($latest.Name) ($($latest.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')))"
}

Write-Output "WILLIAMOS_OMEN_STATUS"
Write-Output "MANUAL_ONLY: true"
Write-Output "LOCALHOST_ONLY: true"
Write-Output "POSTGRES_PROOF: $(Get-ContainerLine -Name 'williamos-postgres-proof')"
Write-Output "APP_CONTAINER: $(Get-ContainerLine -Name 'williamos-omen-app-proof')"
Write-Output "TERRAFUSION_REFERENCE_ONLY: do-not-touch"
Write-Output "PORT_3100: $(Get-PortStatus -Port 3100)"
Write-Output "PORT_3101: $(Get-PortStatus -Port 3101)"
Write-Output "PORT_15432: $(Get-PortStatus -Port 15432)"
Write-Output "ENV_FILE_PRESENT: $(Test-Path -LiteralPath $envFile)"
Write-Output "BACKUP_DIR_PRESENT: $(Test-Path -LiteralPath $backupDir)"
Write-Output "LATEST_BACKUP: $(Get-LatestBackupName -Path $backupDir)"
Write-Output "EXPECTED_URL_3100: http://127.0.0.1:3100"
Write-Output "EXPECTED_URL_3101: http://127.0.0.1:3101"
Write-Output "SAFETY: localhost-only / operator-triggered / no persistence / no schedules / no LAN exposure"
