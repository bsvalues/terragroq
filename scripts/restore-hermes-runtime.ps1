<#
.SYNOPSIS
  Restore one rollback captured by deploy-hermes-runtime.ps1 and prove both WilliamOS listeners.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$RollbackRoot,
  [string]$Runtime = "C:\HermesLab\williamos-runtime-64034e93-flat",
  [string]$TaskName = "WilliamOS Live",
  [string]$HttpsTaskName = "WilliamOS HTTPS",
  [int]$Port = 3100,
  [int]$HttpsPort = 3443
)

$ErrorActionPreference = "Stop"

function Stop-ExpectedListener {
  param([int]$ListenerPort, [string]$ExpectedCommandFragment)
  Get-NetTCPConnection -LocalPort $ListenerPort -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)"
      if (-not $process -or $process.CommandLine -notlike "*$ExpectedCommandFragment*") {
        throw "Port $ListenerPort is owned by an unrelated process; refusing to stop it during WilliamOS rollback"
      }
      Stop-Process -Id $process.ProcessId -Force
    }
}

if (-not (Test-Path -LiteralPath $RollbackRoot -PathType Container)) {
  throw "Rollback directory does not exist: $RollbackRoot"
}
if (-not (Test-Path -LiteralPath (Join-Path $RollbackRoot ".next") -PathType Container)) {
  throw "Rollback is incomplete: $RollbackRoot\.next is missing"
}

Stop-ScheduledTask -TaskName $HttpsTaskName -ErrorAction SilentlyContinue
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Stop-ExpectedListener -ListenerPort $Port -ExpectedCommandFragment "server.js"
Stop-ExpectedListener -ListenerPort $HttpsPort -ExpectedCommandFragment "hermes-https-proxy.mjs"
Start-Sleep -Seconds 2

$null = robocopy (Join-Path $RollbackRoot ".next") (Join-Path $Runtime ".next") /MIR /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw "rollback failed copying .next (exit $LASTEXITCODE)" }

foreach ($file in @("server.js", "package.json", "lib\generated\build-provenance.json", "scripts\hermes-https-proxy.mjs")) {
  $source = Join-Path $RollbackRoot $file
  if (-not (Test-Path -LiteralPath $source)) { throw "Rollback is incomplete: $source is missing" }
  $target = Join-Path $Runtime $file
  $null = New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force
  Copy-Item -LiteralPath $source -Destination $target -Force
}

Start-ScheduledTask -TaskName $TaskName
$deadline = (Get-Date).AddSeconds(90)
do {
  try {
    $health = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 10
    if ($health.StatusCode -eq 200) { break }
  } catch {}
  Start-Sleep -Seconds 3
} while ((Get-Date) -lt $deadline)
if (-not $health -or $health.StatusCode -ne 200) { throw "Restored WilliamOS did not become healthy on port $Port" }

Start-ScheduledTask -TaskName $HttpsTaskName
$deadline = (Get-Date).AddSeconds(60)
do {
  try {
    $httpsHealth = Invoke-WebRequest -Uri "https://192.168.88.9:$HttpsPort/api/health" -UseBasicParsing -TimeoutSec 10
    if ($httpsHealth.StatusCode -eq 200) { break }
  } catch {}
  Start-Sleep -Seconds 3
} while ((Get-Date) -lt $deadline)
if (-not $httpsHealth -or $httpsHealth.StatusCode -ne 200) { throw "Restored WilliamOS HTTPS origin did not become healthy on port $HttpsPort" }

Write-Output "restored and verified: $RollbackRoot"
