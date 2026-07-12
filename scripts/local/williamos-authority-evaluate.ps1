[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$EnvelopePath,
  [Parameter(Mandatory)][ValidateSet("lease", "patch", "push", "pr", "merge")][string]$Stage,
  [string]$ExpectedBaseSha
)

$ErrorActionPreference = "Stop"
$envelope = Get-Content -Raw -LiteralPath $EnvelopePath | ConvertFrom-Json
if ($envelope.repository -ne "bsvalues/terragroq") { throw "AUTHORITY_REPOSITORY_WALL" }
if ($envelope.riskClass -notin @("R0", "R1")) { throw "AUTHORITY_RISK_WALL" }
if ($envelope.workOrderId -notmatch '^WO-[A-Z0-9-]+$') { throw "AUTHORITY_REGISTRATION_WALL" }
if (-not $envelope.dependenciesReady) { throw "AUTHORITY_DEPENDENCY_WALL" }
if ($ExpectedBaseSha -and $envelope.baseSha -ne $ExpectedBaseSha) { throw "AUTHORITY_STALE_BASE_WALL" }
if ($envelope.ownerGateRequired -or $envelope.protectedScope) { throw "AUTHORITY_OWNER_GATE_WALL" }
$activationPath = "$env:USERPROFILE\.williamos\runtime-operator\control\activation"
if (-not (Test-Path -LiteralPath $activationPath -PathType Leaf)) { throw "AUTHORITY_ACTIVATION_WALL" }
$activation = Get-Content -Raw -LiteralPath $activationPath
if ($activation -cne "enabled") { throw "AUTHORITY_ACTIVATION_WALL" }
Write-Output "AUTHORITY_STATUS=PASS STAGE=$Stage"
