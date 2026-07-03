param(
    [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$containerName = "williamos-omen-app-proof"
$imageName = "williamos-app-proof:omen"
$envFile = "C:\Users\bsval\williamos-local-runtime\app-container.env"
$internalPort = 3000
$preferredPort = 3100
$fallbackPort = 3101

if ($Help) {
    Write-Output "USAGE: .\scripts\local\williamos-omen-start.ps1 [-Help]"
    Write-Output "PURPOSE: Manually start the OMEN WilliamOS app proof container."
    Write-Output "BINDING: 127.0.0.1:3100 -> 3000, fallback 127.0.0.1:3101 -> 3000."
    Write-Output "REQUIRES: existing williamos-app-proof:omen image and operator-local app-container.env."
    Write-Output "SAFETY: operator-triggered / no service / no schedule / no LAN exposure / no secrets printed"
    exit 0
}

function Test-PortClear {
    param([int]$Port)

    $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return -not $listeners
}

function Get-ContainerStatus {
    param([string]$Name)

    return docker ps -a --filter "name=^/$Name$" --format "{{.Names}}|{{.Status}}|{{.Ports}}" 2>$null
}

Write-Output "WILLIAMOS_OMEN_START"
Write-Output "MANUAL_ONLY: true"
Write-Output "LOCALHOST_ONLY: true"

if (-not (Test-Path -LiteralPath $envFile)) {
    Write-Error "Missing operator-local env file. Expected path exists only; contents are never printed: $envFile"
}

$existingContainer = Get-ContainerStatus -Name $containerName
if (-not [string]::IsNullOrWhiteSpace($existingContainer)) {
    Write-Error "Container already exists: $existingContainer. Run .\scripts\local\williamos-omen-stop.ps1 before starting again."
}

$imageId = docker image inspect $imageName --format "{{.Id}}" 2>$null
if ([string]::IsNullOrWhiteSpace($imageId)) {
    Write-Error "Missing local image '$imageName'. Build it first with: docker build -f Dockerfile.local-app-proof -t williamos-app-proof:omen ."
}

$hostPort = $null
if (Test-PortClear -Port $preferredPort) {
    $hostPort = $preferredPort
} elseif (Test-PortClear -Port $fallbackPort) {
    $hostPort = $fallbackPort
} else {
    Write-Error "Ports $preferredPort and $fallbackPort are both unavailable. Stop; do not use host port 3000 or 0.0.0.0."
}

$binding = "127.0.0.1:$hostPort`:$internalPort"
Write-Output "PORT_BINDING: $binding"

$containerId = docker run -d --name $containerName --env-file $envFile -p $binding $imageName
Write-Output "CONTAINER_STARTED: $containerName"
Write-Output "CONTAINER_ID: $containerId"
Write-Output "EXPECTED_URL: http://127.0.0.1:$hostPort"
Write-Output "SAFETY: operator-triggered / localhost-only / no service / no schedule / no LAN exposure"
