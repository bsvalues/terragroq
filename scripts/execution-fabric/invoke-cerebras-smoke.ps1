# Run only in the interactive HERMES logon session after the sealed revision is deployed.
# The key comes from one exact Windows generic-credential target, is transient in this
# process and its single Node child, and is never a command argument or pipeline value.
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$Model)

$ErrorActionPreference = "Stop"
$credentialHelper = Join-Path $PSScriptRoot "cerebras-credential-manager.ps1"
. $credentialHelper

$secureKey = $null
$keyHandle = [IntPtr]::Zero
$plainKey = $null
$smokeExit = 1
try {
  if (-not [Environment]::UserInteractive) { throw "CEREBRAS_LOCAL_INTERACTION_REQUIRED" }
  $secureKey = Get-CerebrasCredentialSecureString
  $keyHandle = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
  $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyHandle)
  $env:CEREBRAS_API_KEY = $plainKey
  $env:WILLIAMOS_CEREBRAS_ENABLED = "true"
  $script = Join-Path $PSScriptRoot "cerebras-smoke.mjs"
  & "C:\Program Files\nodejs\node.exe" $script --model $Model
  $smokeExit = $LASTEXITCODE
} finally {
  Remove-Item Env:CEREBRAS_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:WILLIAMOS_CEREBRAS_ENABLED -ErrorAction SilentlyContinue
  $plainKey = $null
  if ($keyHandle -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyHandle) }
  if ($null -ne $secureKey) { $secureKey.Dispose() }
}
exit $smokeExit
