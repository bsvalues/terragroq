[CmdletBinding()]
param(
  [switch]$Once,
  [ValidateRange(5, 3600)][int]$PollSeconds = 60,
  [ValidateRange(5, 300)][int]$MaxRetrySeconds = 300,
  [string]$Root = "$env:USERPROFILE\.williamos\runtime-operator"
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
  do {
    try {
      Write-WilliamOSCheckpoint $Root @{ repository = "bsvalues/terragroq"; goal = "GOAL-RUNTIME-OPERATOR-LOCAL-IDENTITY-001"; loop = "LOOP-RUNTIME-OPERATOR-LOCAL-IDENTITY-001"; workOrder = $null; state = "READY"; baseSha = $null; branch = $null; pr = $null; attempt = 0 } | Out-Null
      Write-WilliamOSAudit $Root "idle_ready" @{ state = "READY" }
      $retry = 5
      if (-not $Once) { Start-Sleep -Seconds $PollSeconds }
    } catch {
      Write-WilliamOSAudit $Root "cycle_recoverable_failure" @{ state = "FAILED_RECOVERABLE"; category = $_.Exception.GetType().Name }
      if ($Once) { throw }
      Start-Sleep -Seconds $retry
      $retry = [Math]::Min($retry * 2, $MaxRetrySeconds)
    }
  } while (-not $Once -and (Get-WilliamOSActivation $Root) -eq "enabled")
} finally {
  Exit-WilliamOSHostLock $lock
}
