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
  [string]$LiveStartTarget = "C:\ProgramData\WilliamOS\start-williamos-live.ps1",
  [int]$Port = 3100,
  [int]$HttpsPort = 3443
)

$ErrorActionPreference = "Stop"

# The deployed HERMES proxy and its authenticated origin are one canonical 3443 -> 3100 boundary.
# Refuse misleading probe/listener overrides before validating or mutating a rollback.
if ($Port -ne 3100 -or $HttpsPort -ne 3443) {
  throw "WilliamOS HERMES uses the canonical HTTP/HTTPS ports 3100/3443; port overrides are not supported"
}

function Stop-ExpectedListener {
  param([int]$ListenerPort, [string]$ExpectedCommandPath)
  Get-NetTCPConnection -LocalPort $ListenerPort -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)"
      if (-not $process -or -not $process.CommandLine -or $process.CommandLine.IndexOf($ExpectedCommandPath, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
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
if ($manifest.version -ne 3 -or $null -eq $manifest.withDependencies -or $null -eq $manifest.directories -or $null -eq $manifest.files -or $null -eq $manifest.liveStart) {
  throw "Rollback manifest is invalid: $manifestPath"
}
$expectedRollbackFiles = @(
  "server.js",
  "package.json",
  "lib\generated\build-provenance.json",
  "scripts\hermes-https-proxy.mjs",
  "scripts\fabric\resolve-authority-registry-url.mjs"
)
$manifestPaths = @($manifest.files | ForEach-Object { [string]$_.path })
if (@(Compare-Object -ReferenceObject $expectedRollbackFiles -DifferenceObject $manifestPaths).Count -ne 0) {
  throw "Rollback manifest does not name the exact runtime file set"
}
$expectedRollbackDirectories = @(".next", "public", "lib\fabric")
if ([bool]$manifest.withDependencies) { $expectedRollbackDirectories += "node_modules" }
$manifestDirectoryPaths = @($manifest.directories | ForEach-Object { [string]$_.path })
if (@(Compare-Object -ReferenceObject $expectedRollbackDirectories -DifferenceObject $manifestDirectoryPaths).Count -ne 0) {
  throw "Rollback manifest does not name the exact runtime directory set"
}
foreach ($entry in $manifest.directories) {
  if (-not $entry.path -or $null -eq $entry.wasPresent) { throw "Rollback manifest has an invalid directory entry" }
  if ($entry.wasPresent -and -not (Test-Path -LiteralPath (Join-Path $RollbackRoot $entry.path) -PathType Container)) {
    throw "Rollback is incomplete: $(Join-Path $RollbackRoot $entry.path) is missing"
  }
}
foreach ($entry in $manifest.files) {
  if (-not $entry.path -or $null -eq $entry.wasPresent) { throw "Rollback manifest has an invalid file entry" }
  if ($entry.wasPresent -and -not (Test-Path -LiteralPath (Join-Path $RollbackRoot $entry.path) -PathType Leaf)) {
    throw "Rollback is incomplete: $(Join-Path $RollbackRoot $entry.path) is missing"
  }
}
$expectedLiveStartBackup = "external\start-williamos-live.ps1"
if (([string]$manifest.liveStart.target -ne $LiveStartTarget) -or ([string]$manifest.liveStart.backupPath -ne $expectedLiveStartBackup) -or ($null -eq $manifest.liveStart.wasPresent)) {
  throw "Rollback manifest does not name the exact WilliamOS Live start definition"
}
$liveStartRollbackFile = Join-Path $RollbackRoot $expectedLiveStartBackup
if ($manifest.liveStart.wasPresent -and -not (Test-Path -LiteralPath $liveStartRollbackFile -PathType Leaf)) {
  throw "Rollback is incomplete: $liveStartRollbackFile is missing"
}

Stop-ScheduledTask -TaskName $HttpsTaskName -ErrorAction SilentlyContinue
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Stop-ExpectedListener -ListenerPort $Port -ExpectedCommandPath (Join-Path $Runtime "server.js")
Stop-ExpectedListener -ListenerPort $HttpsPort -ExpectedCommandPath (Join-Path $Runtime "scripts\hermes-https-proxy.mjs")
Start-Sleep -Seconds 2

foreach ($entry in $manifest.directories) {
  $source = Join-Path $RollbackRoot $entry.path
  $target = Join-Path $Runtime $entry.path
  if ($entry.wasPresent) {
    $null = robocopy $source $target /MIR /NFL /NDL /NJH /NJS /NP
    if ($LASTEXITCODE -ge 8) { throw "rollback failed copying $($entry.path) (exit $LASTEXITCODE)" }
  } elseif (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
  }
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
if ($manifest.liveStart.wasPresent) {
  $null = New-Item -ItemType Directory -Path (Split-Path -Parent $LiveStartTarget) -Force
  Copy-Item -LiteralPath $liveStartRollbackFile -Destination $LiveStartTarget -Force
} elseif (Test-Path -LiteralPath $LiveStartTarget -PathType Leaf) {
  Remove-Item -LiteralPath $LiveStartTarget -Force
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
