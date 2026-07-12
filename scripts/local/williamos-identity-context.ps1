[CmdletBinding()]
param([string]$ExpectedUser = $env:USERNAME)

$ErrorActionPreference = "Stop"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$actualUser = ($identity.Name -split '\\')[-1]
$serviceIdentities = @("SYSTEM", "LOCAL SERVICE", "NETWORK SERVICE")

if ($isAdministrator -or $serviceIdentities -contains $actualUser -or $actualUser -ne $ExpectedUser) {
  Write-Output "IDENTITY_CONTEXT=UNEXPECTED"
  exit 2
}
Write-Output "IDENTITY_CONTEXT=EXPECTED_NON_ELEVATED_WINDOWS_USER"
