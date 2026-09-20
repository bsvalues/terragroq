[CmdletBinding()]
param()

try {
    Import-Module (Join-Path $PSScriptRoot 'LabControl.psm1') -Force -ErrorAction Stop
    $candidate = Get-LabSshConfigCandidate
    [Console]::Out.Write($candidate)
    exit 0
} catch {
    $message = $_.Exception.Message
    if ($message -notmatch '^TOPOLOGY_INVALID:') {
        $message = "TOPOLOGY_INVALID: $message"
    }
    [Console]::Error.WriteLine($message)
    exit 2
}
