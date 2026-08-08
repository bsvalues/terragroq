[CmdletBinding()]
param()
Import-Module (Join-Path $PSScriptRoot 'LabControl.psm1') -Force
Invoke-LabHermes
exit $global:LAB_CONTROL_EXIT_CODE
