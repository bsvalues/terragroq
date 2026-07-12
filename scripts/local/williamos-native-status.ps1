$ErrorActionPreference = "Stop"
Import-Module "$PSScriptRoot\..\..\runtime-operator\native\WilliamOS.RuntimeOperator.psm1" -Force
$root = Initialize-WilliamOSRuntimeRoot
$checkpoint = Read-WilliamOSCheckpoint $root
[ordered]@{
  activation = Get-WilliamOSActivation $root
  supervisorLock = Test-Path -LiteralPath (Join-Path $root "locks\supervisor.lock.json") -PathType Leaf
  checkpointState = $(if ($checkpoint) { $checkpoint.state } else { $null })
} | ConvertTo-Json -Compress
