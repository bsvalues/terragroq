[CmdletBinding()]
param()
try {
    Import-Module (Join-Path $PSScriptRoot 'LabControl.psm1') -Force -ErrorAction Stop
    Invoke-LabBackups
    if ($global:LAB_CONTROL_EXIT_CODE -notin @(0, 2)) { throw 'Module returned no recognized exit code.' }
    exit $global:LAB_CONTROL_EXIT_CODE
} catch {
    [Console]::Error.WriteLine("LAB_CONTROL_FAILED: $($_.Exception.Message)")
    exit 2
}
