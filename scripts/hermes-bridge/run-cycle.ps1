param(
    [string]$Workspace = "C:\Users\bsval\william-os-devops",
    [string]$RuntimeRoot = (Join-Path $HOME ".williamos\hermes-bridge")
)

$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath($RuntimeRoot)
$activationPath = Join-Path $root "control\activation"
$logDir = Join-Path $root "logs"
$cliPath = [IO.Path]::GetFullPath((Join-Path $Workspace "scripts\hermes-bridge\cli.mjs"))
$envPath = [IO.Path]::GetFullPath((Join-Path $Workspace ".env.local"))

if (-not (Test-Path -LiteralPath $activationPath)) { exit 0 }
if ((Get-Content -LiteralPath $activationPath -Raw).Trim() -ne "enabled") { exit 0 }

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir ("cycle-{0}.log" -f (Get-Date -Format "yyyyMMdd"))

Push-Location $Workspace
try {
    $env:WILLIAMOS_HERMES_RUNTIME_ROOT = $root
    & node "--env-file=$envPath" $cliPath cycle *>> $logPath
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
