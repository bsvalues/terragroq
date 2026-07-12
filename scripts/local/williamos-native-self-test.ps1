[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Import-Module "$PSScriptRoot\..\..\runtime-operator\native\WilliamOS.RuntimeOperator.psm1" -Force
Import-Module "$PSScriptRoot\..\..\runtime-operator\native\WilliamOS.RuntimeExecution.psm1" -Force
$root = Join-Path $env:TEMP ("williamos-native-self-test-" + [guid]::NewGuid())
$passed = 0

function Assert-Equal($Actual, $Expected, [string]$Name) {
  if ($Actual -cne $Expected) { throw "SELF_TEST_FAILED: $Name" }
  $script:passed++
}

try {
  Initialize-WilliamOSRuntimeRoot $root | Out-Null
  Assert-Equal (Get-WilliamOSActivation $root) "disabled" "missing activation fails closed"
  Set-WilliamOSDisabled $root
  Assert-Equal (Get-WilliamOSActivation $root) "disabled" "explicit disabled"

  $lock = Enter-WilliamOSHostLock $root
  try { Enter-WilliamOSHostLock $root | Out-Null; throw "SELF_TEST_FAILED: duplicate lock" } catch { if ($_.Exception.Message -ne "ACTIVE_SUPERVISOR_LOCK") { throw }; $passed++ }
  Exit-WilliamOSHostLock $lock
  [IO.File]::WriteAllText((Join-Path $root "locks\supervisor.lock.json"), '{"pid":999999,"startTicks":1}', [Text.UTF8Encoding]::new($false))
  $stale = Enter-WilliamOSHostLock $root; Exit-WilliamOSHostLock $stale; $passed++

  $states = @("READY", "LEASED", "PATCH_PREPARED", "VALIDATING", "PR_OPEN", "REVIEW_REMEDIATION", "MERGE_READY", "COMPLETED", "BLOCKED", "FAILED_RECOVERABLE", "FAILED_TERMINAL")
  foreach ($state in $states) {
    Write-WilliamOSCheckpoint $root @{repository='bsvalues/terragroq';goal='G';loop='L';workOrder='WO-SELF-TEST';state=$state;baseSha=('a'*40);branch=$null;pr=$null;attempt=0} | Out-Null
    Assert-Equal (Read-WilliamOSCheckpoint $root).state $state "checkpoint $state"
    Set-WilliamOSDisabled $root
  }

  [IO.File]::WriteAllText((Join-Path $root "state\checkpoint.json"), '{malformed', [Text.UTF8Encoding]::new($false))
  try { Read-WilliamOSCheckpoint $root | Out-Null; throw "SELF_TEST_FAILED: corrupt checkpoint" } catch { if ($_.Exception.Message -ne "CORRUPT_CHECKPOINT_WALL") { throw }; $passed++ }
  if (-not (Get-ChildItem (Join-Path $root "state") -Filter 'checkpoint.json.corrupt.*')) { throw "SELF_TEST_FAILED: corrupt evidence preservation" }; $passed++

  Assert-Equal (Get-WilliamOSRetryDecision "authentication" 0) "NO_RETRY_TERMINAL" "auth no retry"
  Assert-Equal (Get-WilliamOSRetryDecision "network" 2 2) "NO_RETRY_EXHAUSTED" "retry exhaustion"
  $budgetPath = "$PSScriptRoot\..\..\runtime-operator\native\budgets.json"
  Assert-Equal (Test-WilliamOSBudget $budgetPath @{cyclesHour=4}) "BUDGET_EXHAUSTED_CYCLESHOUR" "budget exhaustion"
  $key = Get-WilliamOSIdempotencyKey "bsvalues/terragroq" "WO-SELF-TEST" ('a'*40)
  Assert-Equal $key (Get-WilliamOSIdempotencyKey "bsvalues/terragroq" "WO-SELF-TEST" ('a'*40)) "idempotency"
  Write-WilliamOSAudit $root "self_test" @{state="COMPLETED"; checks=$passed}
  Write-Output "NATIVE_SELF_TEST=PASS CHECKS=$passed"
} finally {
  if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
