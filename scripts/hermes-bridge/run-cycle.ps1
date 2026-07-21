param(
    [string]$Workspace = "C:\Users\bsval\william-os-devops"
)

$ErrorActionPreference = "Stop"
$root = Join-Path $HOME ".williamos\hermes-bridge"
$activationPath = Join-Path $root "control\activation"
$logDir = Join-Path $root "logs"

if (-not (Test-Path -LiteralPath $activationPath)) { exit 0 }
if ((Get-Content -LiteralPath $activationPath -Raw).Trim() -ne "enabled") { exit 0 }

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir ("cycle-{0}.log" -f (Get-Date -Format "yyyyMMdd"))

Push-Location $Workspace
try {
    & node --env-file=.env.local scripts/hermes-bridge/cli.mjs cycle *>> $logPath
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
