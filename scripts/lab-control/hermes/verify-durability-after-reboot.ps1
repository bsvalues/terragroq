# The post-reboot entrypoint intentionally reuses the canonical acceptance suite.
[CmdletBinding()]
param(
  [string]$OutputPath = 'C:\ProgramData\Hermes\status\acceptance.json'
)
$suite=Join-Path $PSScriptRoot 'hermes-acceptance.ps1'
if(-not (Test-Path -LiteralPath $suite -PathType Leaf)){throw 'HERMES_ACCEPTANCE_SUITE_MISSING'}
$global:LASTEXITCODE=$null
try { & $suite -RequirePostDeploymentReboot -OutputPath $OutputPath }
catch { Write-Error "HERMES_ACCEPTANCE_SUITE_FAULTED: $($_.Exception.Message)"; exit 2 }
if($null -eq $LASTEXITCODE){Write-Error 'HERMES_ACCEPTANCE_SUITE_NO_VERDICT';exit 2}
exit $LASTEXITCODE
