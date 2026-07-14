[CmdletBinding()]
param(
  [switch]$Once,
  [ValidateRange(5, 3600)][int]$PollSeconds = 60,
  [ValidateRange(5, 300)][int]$MaxRetrySeconds = 300,
  [string]$Root = "$env:USERPROFILE\.williamos\runtime-operator",
  [string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$OwnerAuthorityRoot = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Import-Module "$PSScriptRoot\..\..\runtime-operator\native\WilliamOS.RuntimeOperator.psm1" -Force
$Root = Initialize-WilliamOSRuntimeRoot $Root
$registry = Join-Path $RepositoryPath "runtime-operator\native\authority-registry.json"

function Assert-LegacyAdapterQuarantined {
  param(
    [Parameter(Mandatory)][string]$RegistryPath,
    [Parameter(Mandatory)][string]$AuthorityRoot
  )

  $document = Get-Content -LiteralPath $RegistryPath -Raw | ConvertFrom-Json
  $adapter = $document.adapter
  $legacyWorkOrders = @("WO-RUNTIME-KERNEL-PILOT-001", "WO-RUNTIME-KERNEL-CONTINUATION-001")
  $records = @($document.workOrders | Where-Object {
    $_.adapterId -eq "local-nested-codex-exec" -or $_.workOrderId -in $legacyWorkOrders
  })
  $registryQuarantined =
    $null -ne $adapter -and
    $adapter.adapterId -eq "local-nested-codex-exec" -and
    $adapter.state -eq "QUARANTINED_TERMINAL" -and
    $adapter.dispatchAllowed -eq $false -and
    $adapter.retryAllowed -eq $false -and
    $adapter.terminalIssueNumber -eq 357 -and
    $adapter.terminalReason -eq "CODEX_NETWORK_WALL" -and
    $records.Count -eq 2 -and
    (@($records.workOrderId | Sort-Object) -join ",") -eq (@($legacyWorkOrders | Sort-Object) -join ",") -and
    @($records | Where-Object {
      $_.adapterId -ne "local-nested-codex-exec" -or
      $_.authority -ne "REVOKED_TERMINAL" -or
      $_.executionAllowed -ne $false -or
      $_.retryAllowed -ne $false
    }).Count -eq 0

  if (-not $registryQuarantined) { throw "LEGACY_ADAPTER_QUARANTINE_INTEGRITY_WALL" }

  $cli = Join-Path $RepositoryPath "scripts\multi-agent-operator\authority-event-cli.mjs"
  $events = Join-Path $AuthorityRoot "legacy-revocation-events.json"
  $trustedOwners = Join-Path $AuthorityRoot "trusted-owner-keys.json"
  if (-not (Test-Path -LiteralPath $cli -PathType Leaf) -or
      -not (Test-Path -LiteralPath $events -PathType Leaf) -or
      -not (Test-Path -LiteralPath $trustedOwners -PathType Leaf)) {
    throw "OWNER_REVOCATION_EVENT_VERIFIER_WALL"
  }
  $verification = (& node $cli assert-legacy-revocations --registry $RegistryPath --events $events --trusted-owners $trustedOwners 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $verification.StartsWith("OWNER_REVOCATION_ASSERTION=")) {
    throw "OWNER_REVOCATION_EVENT_VERIFIER_WALL"
  }
  $assertion = $verification.Substring("OWNER_REVOCATION_ASSERTION=".Length) | ConvertFrom-Json
  if ($assertion.status -ne "VERIFIED_REVOKED") {
    throw "OWNER_REVOCATION_EVENT_VERIFIER_WALL"
  }

  throw "QUARANTINED_TERMINAL"
}

if ((Get-WilliamOSActivation $Root) -ne "enabled") {
  Write-WilliamOSAudit $Root "disabled_start" @{ state = "READY" }
  Write-Output "NATIVE_RUNTIME_STATUS=DISABLED"
  exit 0
}

if (-not $OwnerAuthorityRoot) { $OwnerAuthorityRoot = Join-Path $Root "authority" }
try {
  Assert-LegacyAdapterQuarantined -RegistryPath $registry -AuthorityRoot $OwnerAuthorityRoot
}
catch {
  $wall = if ($_.Exception.Message -match "[A-Z][A-Z0-9_]+_WALL|QUARANTINED_TERMINAL") { $Matches[0] } else { "OWNER_REVOCATION_EVENT_VERIFIER_WALL" }
  Write-WilliamOSAudit $Root "terminal_quarantine" @{ state = "BLOCKED"; reason = $wall }
  throw $wall
}

$readiness = & "$PSScriptRoot\williamos-auth-readiness.ps1" | ConvertFrom-Json
if (-not $readiness.ready) { throw "RUNTIME_READINESS_WALL" }

$lock = Enter-WilliamOSHostLock $Root
try {
  $retry = 5
  $kernel = Join-Path $RepositoryPath "scripts\runtime-operator\operational-kernel-cli.mjs"
  do {
    try {
      $output = (& node $kernel --root $Root --repository $RepositoryPath --registry $registry 2>&1 | Out-String).Trim()
      $exitCode = $LASTEXITCODE
      $wall = if ($output -match '^[A-Z][A-Z0-9_]+_WALL$') { $output } else { "OPERATIONAL_KERNEL_WALL" }
      if ($exitCode -eq 2) { throw "OWNER_AUTHORITY_WALL" }
      if ($exitCode -eq 3) { throw "OPERATIONAL_KERNEL_RECOVERABLE_WALL:$wall" }
      if ($exitCode -ne 0) { throw "OPERATIONAL_KERNEL_TERMINAL_WALL:$wall" }
      Write-WilliamOSAudit $Root "kernel_cycle" @{ state = "OBSERVED" }
      Write-Output $output
      $retry = 5
      if (-not $Once) { Start-Sleep -Seconds $PollSeconds }
    } catch {
      if ($_.Exception.Message -eq "OWNER_AUTHORITY_WALL") {
        Write-WilliamOSAudit $Root "owner_authority_wall" @{ state = "BLOCKED" }
        throw
      }
      if ($_.Exception.Message -notlike "OPERATIONAL_KERNEL_RECOVERABLE_WALL:*") {
        Write-WilliamOSAudit $Root "kernel_terminal_failure" @{ state = "FAILED_TERMINAL" }
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
