[CmdletBinding()]
param([string]$ExpectedUser = "bsval")

$ErrorActionPreference = "Stop"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$actualUser = ($identity.Name -split '\\')[-1]
$serviceIdentity = $identity.Name -match '^(NT AUTHORITY|NT SERVICE)\\' -or $actualUser.EndsWith('$')

if ($isAdministrator -or $serviceIdentity -or $actualUser -cne $ExpectedUser) {
  Write-Output "IDENTITY_CONTEXT=UNEXPECTED"
  exit 2
}
Write-Output "IDENTITY_CONTEXT=EXPECTED_NON_ELEVATED_WINDOWS_USER"
