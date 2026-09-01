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
$manifestPath = Join-Path $RollbackRoot "rollback-manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "Rollback is incomplete: $manifestPath is missing"
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.version -ne 1 -or $null -eq $manifest.nextPresent -or $null -eq $manifest.files) {
  throw "Rollback manifest is invalid: $manifestPath"
}
$expectedRollbackFiles = @("server.js", "package.json", "lib\generated\build-provenance.json", "scripts\hermes-https-proxy.mjs")
$manifestPaths = @($manifest.files | ForEach-Object { [string]$_.path })
if (@(Compare-Object -ReferenceObject $expectedRollbackFiles -DifferenceObject $manifestPaths).Count -ne 0) {
  throw "Rollback manifest does not name the exact runtime file set"
}
if ($manifest.nextPresent -and -not (Test-Path -LiteralPath (Join-Path $RollbackRoot ".next") -PathType Container)) {
  throw "Rollback is incomplete: $RollbackRoot\.next is missing"
}
foreach ($entry in $manifest.files) {
  if (-not $entry.path -or $null -eq $entry.wasPresent) { throw "Rollback manifest has an invalid file entry" }
  if ($entry.wasPresent -and -not (Test-Path -LiteralPath (Join-Path $RollbackRoot $entry.path) -PathType Leaf)) {
    throw "Rollback is incomplete: $(Join-Path $RollbackRoot $entry.path) is missing"
  }
}

Stop-ScheduledTask -TaskName $HttpsTaskName -ErrorAction SilentlyContinue
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Stop-ExpectedListener -ListenerPort $Port -ExpectedCommandFragment "server.js"
Stop-ExpectedListener -ListenerPort $HttpsPort -ExpectedCommandFragment "hermes-https-proxy.mjs"
Start-Sleep -Seconds 2

if ($manifest.nextPresent) {
  $null = robocopy (Join-Path $RollbackRoot ".next") (Join-Path $Runtime ".next") /MIR /NFL /NDL /NJH /NJS /NP
  if ($LASTEXITCODE -ge 8) { throw "rollback failed copying .next (exit $LASTEXITCODE)" }
} elseif (Test-Path -LiteralPath (Join-Path $Runtime ".next")) {
  Remove-Item -LiteralPath (Join-Path $Runtime ".next") -Recurse -Force
}

foreach ($entry in $manifest.files) {
  $source = Join-Path $RollbackRoot $entry.path
  $target = Join-Path $Runtime $entry.path
  if ($entry.wasPresent) {
    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force
    Copy-Item -LiteralPath $source -Destination $target -Force
  } elseif (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Force
  }
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
