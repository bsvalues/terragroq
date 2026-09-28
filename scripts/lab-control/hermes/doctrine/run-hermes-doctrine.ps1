# run-hermes-doctrine.ps1 — standing doctrine pipeline (WO-HERMES-APPL-004 / #1034)
# observe -> normalize -> evaluate -> write C:\ProgramData\Hermes\doctrine\current-result.json
# Runs as SYSTEM via the HermesDoctrineCheck scheduled task. Read-only on the host;
# writes only into the doctrine evidence directory. Never mutates declared doctrine.
[CmdletBinding()] param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$HermesDir   = 'C:\HermesLab\hermes'
$DoctrineDir = 'C:\ProgramData\Hermes\doctrine'
$ObsPath     = Join-Path $DoctrineDir 'observation.raw.json'
$NormPath    = Join-Path $DoctrineDir 'observation.normalized.json'
$ResultPath  = Join-Path $DoctrineDir 'current-result.json'
$DoctrineJson= Join-Path $DoctrineDir 'doctrine.json'
$NodeExe     = 'C:\Users\bs\AppData\Local\hermes\node\node.exe'  # resolved path; SYSTEM task has no user PATH

New-Item -ItemType Directory -Force -Path $DoctrineDir | Out-Null

# 1. Observe (privileged collector emits one raw JSON envelope on stdout)
$raw = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass `
  -File (Join-Path $HermesDir 'doctrine\collect-hermes-doctrine-observation.ps1') 2>$null
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) {
  Write-Output "DOCTRINE_OBSERVE_FAILED rc=$LASTEXITCODE"; exit 1
}
[IO.File]::WriteAllText($ObsPath, ($raw -join "`n"), [Text.UTF8Encoding]::new($false))

# 2. Normalize raw -> observation schema (node ESM)
$normScript = @"
import { readFile, writeFile } from 'node:fs/promises'
import { normalizeHermesRawObservation } from 'file:///C:/HermesLab/hermes/doctrine/normalize-hermes-observation.mjs'
const raw = JSON.parse(await readFile('$($ObsPath -replace '\\','/')', 'utf8'))
const obs = normalizeHermesRawObservation(raw)
await writeFile('$($NormPath -replace '\\','/')', JSON.stringify(obs))
"@
$normScript | & $NodeExe --input-type=module - 2>$null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $NormPath)) {
  Write-Output "DOCTRINE_NORMALIZE_FAILED rc=$LASTEXITCODE"; exit 1
}

# 3. Evaluate against declared doctrine (if one is declared yet)
if (Test-Path $DoctrineJson) {
  $evalOut = & $NodeExe (Join-Path $HermesDir 'doctrine\evaluate-hermes-doctrine.mjs') $DoctrineJson $NormPath 2>$null
  $evalRc = $LASTEXITCODE
  if (-not [string]::IsNullOrWhiteSpace($evalOut)) {
    [IO.File]::WriteAllText($ResultPath, ($evalOut -join "`n"), [Text.UTF8Encoding]::new($false))
  }
  Write-Output "DOCTRINE_EVALUATED rc=$evalRc"
  exit 0
}

# 4. No declared doctrine yet -> record UNKNOWN so the console reads truthfully
$unknown = [ordered]@{
  schema = 'hermes-doctrine-result/1'
  status = 'UNKNOWN'
  code = 'DOCTRINE_NOT_DECLARED'
  evaluatedAt = (Get-Date).ToUniversalTime().ToString('o')
  observation = [ordered]@{ path = $NormPath; present = $true }
}
[IO.File]::WriteAllText($ResultPath, ($unknown | ConvertTo-Json -Depth 8 -Compress), [Text.UTF8Encoding]::new($false))
Write-Output "DOCTRINE_NOT_DECLARED -> UNKNOWN recorded"
exit 0
