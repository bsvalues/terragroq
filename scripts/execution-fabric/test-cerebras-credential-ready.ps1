# Secret-free readiness probe for the fixed WilliamOS Cerebras credential bridge.
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$secureKey = $null
try {
  if (-not [Environment]::UserInteractive) { throw "CEREBRAS_LOCAL_INTERACTION_REQUIRED" }
  $credentialHelper = Join-Path $PSScriptRoot "cerebras-credential-manager.ps1"
  . $credentialHelper
  $secureKey = Get-CerebrasCredentialSecureString
  if ($null -eq $secureKey -or $secureKey.Length -lt 1) { throw "CEREBRAS_CREDENTIAL_UNAVAILABLE" }
  [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
  [Console]::Out.Write("READY")
  exit 0
} catch {
  [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
  [Console]::Out.Write("UNAVAILABLE")
  exit 1
} finally {
  if ($null -ne $secureKey) { $secureKey.Dispose() }
}
