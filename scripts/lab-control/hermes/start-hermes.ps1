# Brings the Hermes core stack up. Run from anywhere:
#   C:\HermesLab\hermes\start-hermes.ps1
#
# Ollama is NOT part of this stack (#997). It is a Windows service definition -- scheduled task
# WilliamOS-HERMES-Ollama, started at boot, bound to 127.0.0.1:11434, Tesla P40 only. This script
# reports on it but does not own it, so that there is exactly one owner and it is obvious which.
#
# -PullImages is opt-in ON PURPOSE. This script used to run `docker compose pull` unconditionally,
# which silently replaced whatever image identity was actually running with whatever :latest had
# become that day -- image preservation depended on nobody using the documented start path. Pulling
# is now something you ask for.
param([switch]$PullImages)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

# The model store. Owned by the Windows Ollama service; created here only so a fresh machine does
# not fail confusingly.
$modelDir = "G:\HermesData\ollama"
if (-not (Test-Path $modelDir)) {
    New-Item -ItemType Directory -Force -Path $modelDir | Out-Null
    Write-Host "Created $modelDir"
}

# Ensure .env exists.
if (-not (Test-Path ".\.env")) {
    Copy-Item ".\.env.example" ".\.env"
    Write-Warning "Created .env from template. Edit it and set a real POSTGRES_PASSWORD, then re-run."
    exit 1
}

if ($PullImages) {
    Write-Host "Pulling images (this REPLACES the running image identity with :latest)..." -ForegroundColor Yellow
    docker compose pull
    if ($LASTEXITCODE -ne 0) { throw "DOCKER_COMPOSE_PULL_FAILED exit=$LASTEXITCODE" }
} else {
    Write-Host "Using the images already present (pass -PullImages to update them)." -ForegroundColor Cyan
}

Write-Host "Starting stack..." -ForegroundColor Cyan
docker compose up -d
if ($LASTEXITCODE -ne 0) { throw "DOCKER_COMPOSE_UP_FAILED exit=$LASTEXITCODE" }

Write-Host "`nStatus:" -ForegroundColor Green
docker compose ps
if ($LASTEXITCODE -ne 0) { throw "DOCKER_COMPOSE_STATUS_FAILED exit=$LASTEXITCODE" }

Write-Host "`nOllama (Windows service, not a container):" -ForegroundColor Green
$task = Get-ScheduledTask -TaskName "WilliamOS-HERMES-Ollama" -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Warning "  scheduled task WilliamOS-HERMES-Ollama is NOT registered -- open-webui will have no models."
    Write-Host "  install: powershell -File .\ollama-service\install-hermes-ollama-service.ps1"
} else {
    Write-Host "  task state: $($task.State)"
    try {
        $tags = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 5
        Write-Host "  serving $($tags.models.Count) model(s) on 127.0.0.1:11434"
    } catch {
        Write-Warning "  task is registered but 127.0.0.1:11434 did not answer: $($_.Exception.Message)"
        Write-Host "  log: C:\ProgramData\WilliamOS\logs\hermes-ollama-service.log"
    }
}

Write-Host "`nOpen:" -ForegroundColor Green
Write-Host "  Open WebUI : http://localhost:3000"
Write-Host "  Portainer  : http://localhost:9000"
Write-Host "`nPull a model:  D:\HermesServices\ollama\v0.9.2\ollama.exe pull <model>   (OLLAMA_HOST=127.0.0.1:11434)"
