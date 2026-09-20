# Run only in an interactive HERMES PowerShell session after the sealed revision is deployed.
# The key is transient in this process and its single Node child; it is never a command argument.
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$Model)

$ErrorActionPreference = "Stop"
$secureKey = $null
$keyHandle = [IntPtr]::Zero
$plainKey = $null
$smokeExit = 1
try {
  if (-not [Environment]::UserInteractive) { throw "CEREBRAS_LOCAL_INTERACTION_REQUIRED" }
  $secureKey = Read-Host -Prompt "Cerebras API key (local, hidden)" -AsSecureString
  if ($null -eq $secureKey -or $secureKey.Length -eq 0) { throw "CEREBRAS_KEY_REQUIRED" }
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
