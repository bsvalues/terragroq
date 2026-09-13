<#
.SYNOPSIS
  Run the HERMES WilliamOS HTTPS proxy as the scheduled task's direct child.

.DESCRIPTION
  The previous launcher used Start-Process -Wait. Task Scheduler could terminate that PowerShell
  wrapper while the detached Node child kept port 3443 alive, leaving the task Ready with
  0xC000013A while an unsupervised proxy continued serving. Direct invocation keeps Node in the
  task's process tree so task state and product state cannot silently diverge.
#>
[CmdletBinding()]
param(
  [string]$AppRoot = "C:\HermesLab\williamos-runtime-64034e93-flat",
  [string]$LogRoot = "C:\ProgramData\WilliamOS\logs"
)

$ErrorActionPreference = "Stop"
$node = "C:\Program Files\nodejs\node.exe"
$proxy = Join-Path $AppRoot "scripts\hermes-https-proxy.mjs"
$stdoutLog = Join-Path $LogRoot "williamos-https.stdout.log"
$stderrLog = Join-Path $LogRoot "williamos-https.stderr.log"

foreach ($required in @($node, $proxy)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "Refusing to start WilliamOS HTTPS: required file is missing: $required"
  }
}

# THE DOOR PROVENANCE GATE (#1223) — the proxy listener is part of the door: refusing only the
# cockpit task would leave "robocopy + restart :3443" as a live bypass. Same gate, same ledger,
# same fail-closed contract as start-williamos-live.ps1; a tree whose built provenance is not an
# authorized integrated lab-main revision cannot become the HTTPS surface either.
$appRootResolved = (Resolve-Path -LiteralPath $AppRoot).ProviderPath.TrimEnd('\')
$provenanceGate = Join-Path $appRootResolved "scripts\hermes-bridge\verify-door-provenance.mjs"
if (-not (Test-Path -LiteralPath $provenanceGate -PathType Leaf)) {
  throw "Refusing to start WilliamOS HTTPS: the deployed bundle does not carry scripts/hermes-bridge/verify-door-provenance.mjs (#1223 fail-closed)."
}
$gatePreviousPreference = $ErrorActionPreference
try {
  # Native stderr is not an error here; the exit code is the verdict. (PS 5.1 traps, twice now.)
  $ErrorActionPreference = "Continue"
  $gateOutput = & $node $provenanceGate --app-root="$appRootResolved" 2>&1
  $gateExit = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $gatePreviousPreference
}
$gateSummary = [string]::Join(" ", (@($gateOutput) | ForEach-Object { [string]$_ }))
if ($gateExit -ne 0) {
  throw "Refusing to start WilliamOS HTTPS: $gateSummary"
}

New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
Set-Location -LiteralPath $AppRoot

# Invoke Node directly. Do not replace this with Start-Process: that was the orphaning defect.
$previousPreference = $ErrorActionPreference
$proxyExit = 1
try {
  $ErrorActionPreference = "Continue"
  & $node $proxy 1>> $stdoutLog 2>> $stderrLog
  $nodeInvocationSucceeded = $?
  $nodeExit = $LASTEXITCODE
  if ($nodeInvocationSucceeded) {
    $proxyExit = if ($null -eq $nodeExit) { 0 } else { $nodeExit }
  } elseif ($null -ne $nodeExit -and $nodeExit -ne 0) {
    $proxyExit = $nodeExit
  }
} finally {
  $ErrorActionPreference = $previousPreference
}

exit $proxyExit
