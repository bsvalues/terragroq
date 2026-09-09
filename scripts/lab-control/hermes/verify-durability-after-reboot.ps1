# The post-reboot entrypoint intentionally reuses the canonical acceptance suite.
[CmdletBinding()]
param(
  [string]$OutputPath = 'C:\ProgramData\Hermes\status\acceptance.json'
)
$suite=Join-Path $PSScriptRoot 'hermes-acceptance.ps1'
if(-not (Test-Path -LiteralPath $suite -PathType Leaf)){throw 'HERMES_ACCEPTANCE_SUITE_MISSING'}
& $suite -RequirePostDeploymentReboot -OutputPath $OutputPath
exit $LASTEXITCODE
