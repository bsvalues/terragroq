[CmdletBinding()]
param(
  [switch]$Once,
  [ValidateRange(5, 3600)][int]$PollSeconds = 60,
  [ValidateRange(5, 300)][int]$MaxRetrySeconds = 300,
  [string]$Root = "$env:USERPROFILE\.williamos\runtime-operator",
  [string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Import-Module "$PSScriptRoot\..\..\runtime-operator\native\WilliamOS.RuntimeOperator.psm1" -Force
$Root = Initialize-WilliamOSRuntimeRoot $Root

if ((Get-WilliamOSActivation $Root) -ne "enabled") {
  Write-WilliamOSAudit $Root "disabled_start" @{ state = "READY" }
  Write-Output "NATIVE_RUNTIME_STATUS=DISABLED"
  exit 0
}

$readiness = & "$PSScriptRoot\williamos-auth-readiness.ps1" | ConvertFrom-Json
if (-not $readiness.ready) { throw "RUNTIME_READINESS_WALL" }

$lock = Enter-WilliamOSHostLock $Root
try {
  $retry = 5
  $kernel = Join-Path $RepositoryPath "scripts\runtime-operator\operational-kernel-cli.mjs"
  $registry = Join-Path $RepositoryPath "runtime-operator\native\authority-registry.json"
  do {
    try {
      $output = & node $kernel --root $Root --repository $RepositoryPath --registry $registry
      if ($LASTEXITCODE -eq 2) { throw "OWNER_AUTHORITY_WALL" }
      if ($LASTEXITCODE -ne 0) { throw "OPERATIONAL_KERNEL_PROCESS_WALL" }
      Write-WilliamOSAudit $Root "kernel_cycle" @{ state = "OBSERVED" }
      Write-Output $output
      $retry = 5
      if (-not $Once) { Start-Sleep -Seconds $PollSeconds }
    } catch {
      if ($_.Exception.Message -eq "OWNER_AUTHORITY_WALL") {
        Write-WilliamOSAudit $Root "owner_authority_wall" @{ state = "BLOCKED" }
        throw
      }
      Write-WilliamOSAudit $Root "cycle_recoverable_failure" @{ state = "FAILED_RECOVERABLE"; category = $_.Exception.GetType().Name }
      if ($Once) { throw }
      Start-Sleep -Seconds $retry
      $retry = [Math]::Min($retry * 2, $MaxRetrySeconds)
    }
  } while (-not $Once -and (Get-WilliamOSActivation $Root) -eq "enabled")
} finally {
  Exit-WilliamOSHostLock $lock
}
