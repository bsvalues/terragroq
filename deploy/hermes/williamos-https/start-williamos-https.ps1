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
