param(
    [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$containerName = "williamos-omen-app-proof"

if ($Help) {
    Write-Output "USAGE: .\scripts\local\williamos-omen-stop.ps1 [-Help]"
    Write-Output "PURPOSE: Stop and remove only the OMEN WilliamOS app proof container."
    Write-Output "TARGET: williamos-omen-app-proof"
    Write-Output "SAFETY: does not touch williamos-postgres-proof, TerraFusion, services, schedules, or LAN exposure"
    exit 0
}

function Get-ContainerLine {
    param([string]$Name)

    return docker ps -a --filter "name=^/$Name$" --format "{{.Names}}|{{.Status}}|{{.Ports}}" 2>$null
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

Write-Output "WILLIAMOS_OMEN_STOP"
Write-Output "MANUAL_ONLY: true"
Write-Output "TARGET_CONTAINER: $containerName"

$existingContainer = Get-ContainerLine -Name $containerName
if ([string]::IsNullOrWhiteSpace($existingContainer)) {
    Write-Output "APP_CONTAINER: missing"
    Write-Output "NO_ACTION_REQUIRED: true"
} else {
    Write-Output "APP_CONTAINER_BEFORE: $existingContainer"
    docker stop $containerName | Out-Null
    docker rm $containerName | Out-Null
    Write-Output "APP_CONTAINER_REMOVED: true"
}

Write-Output "POSTGRES_PROOF_TOUCHED: false"
Write-Output "TERRAFUSION_TOUCHED: false"
Write-Output "PORT_3100: $(Get-PortStatus -Port 3100)"
Write-Output "PORT_3101: $(Get-PortStatus -Port 3101)"
Write-Output "SAFETY: stop/remove app proof only / no service / no schedule / no LAN exposure"
