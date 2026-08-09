[CmdletBinding()]
param()
Import-Module (Join-Path $PSScriptRoot 'LabControl.psm1') -Force
Invoke-LabContainers
exit $global:LAB_CONTROL_EXIT_CODE
