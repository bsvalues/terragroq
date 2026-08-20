# Prove the cockpit is reachable over the overlay WITHOUT weakening its authentication -- RUNS ON OMEN.
# Read-only: issues requests, changes no configuration. Exits non-zero on any failed assertion.
#
# The control case is the point of this script. Two green checks that the cockpit answers over the
# overlay would ALSO be green if the relay had quietly stripped client-certificate authentication and
# started handing sessions to anybody who connected. Proving the reachability without proving the
# refusal is how a transport change silently becomes an authentication bypass.
[CmdletBinding()]
param(
    # Off the lab LAN, the direct LAN address MUST be unreachable. Asserting that -- rather than
    # skipping the case -- is what makes an off-LAN run mean something: a green overlay result while
    # the LAN is still reachable proves only that the machine has a network, not that it left one.
    [switch] $OffLan
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$lanAddress     = '192.168.88.9'
$overlayAddress = '100.97.194.84'
$endpoint       = 'https://williamos.lan:3443/api/device-cert/session'
# Windows' own curl, deliberately: it uses the Windows certificate store for both the client
# certificate and trust. The Git Bash build carries its own CA bundle and cannot see either, which
# looks exactly like a trust failure and is not one.
$curl           = "$env:SystemRoot\System32\curl.exe"

$deviceCert = @(Get-ChildItem Cert:\CurrentUser\My |
    Where-Object { $_.Subject -match 'CN=omen' -and $_.Subject -match 'WilliamOS Operator' -and $_.HasPrivateKey } |
    Sort-Object NotAfter -Descending) | Select-Object -First 1
if (-not $deviceCert) { throw 'DEVICE_CERT_MISSING: no WilliamOS Operator certificate for this device in CurrentUser\My' }
if ($deviceCert.NotAfter -lt [datetime]::Now.AddDays(30)) {
    Write-Warning "DEVICE_CERT_EXPIRING: valid only until $($deviceCert.NotAfter)"
}
$certRef = "CurrentUser\MY\$($deviceCert.Thumbprint)"

function Invoke-CockpitProbe {
    param([string] $Address, [switch] $WithCertificate)
    # --ssl-revoke-best-effort: this CA publishes no CRL/OCSP endpoint, so strict Schannel revocation
    # checking fails with CRYPT_E_NO_REVOCATION_CHECK. That is stricter-than-a-browser behaviour, NOT
    # a trust failure and NOT a bad certificate. Two separate investigations have already misread it
    # as one; do not remove this flag and re-learn it a third time.
    $arguments = @('-sS', '-o', 'NUL', '-D', '-', '--max-time', '30', '--ssl-revoke-best-effort',
                   '--resolve', "williamos.lan:3443:$Address", $endpoint)
    if ($WithCertificate) { $arguments = @('--cert', $certRef) + $arguments }
    $response = @(& $curl @arguments 2>&1 | ForEach-Object { $_.ToString() })

    # A request that fails outright produces no HTTP status line at all. Reaching into .Matches
    # unguarded turns that into a confusing property-not-found exception several lines away from the
    # real problem, so every field is resolved defensively and an unreachable endpoint reports as a
    # plain missing status instead.
    function Get-FirstCapture {
        param([string[]] $Lines, [string] $Pattern)
        $match = @($Lines | Select-String -Pattern $Pattern) | Select-Object -First 1
        if (-not $match) { return '' }
        return $match.Matches[0].Groups[1].Value.Trim()
    }

    [pscustomobject]@{
        Status    = Get-FirstCapture -Lines $response -Pattern '^HTTP/\S+\s+(\d{3})'
        Location  = Get-FirstCapture -Lines $response -Pattern '^location:\s*(.+)$'
        HasCookie = [bool](@($response | Select-String -Pattern '^set-cookie:\s*__Secure-better-auth\.session_token=').Count)
        Error     = Get-FirstCapture -Lines $response -Pattern '^(curl: .+)$'
    }
}

$failures = @()

# The LAN case flips meaning depending on where the machine is. On the LAN it must succeed; off the
# LAN it must fail, and a success there means the machine never actually left the network.
$lan = Invoke-CockpitProbe -Address $lanAddress -WithCertificate
# ANY completed HTTP response proves the LAN host answered -- 500, 404, an unexpected redirect, all
# of them mean the machine is still on that network. Treating only the happy-path 303 as "reachable"
# would let a LAN host in a degraded state read as absent and pass an off-LAN run that never left the
# LAN, which is a false PASS on the one assertion that makes this whole run meaningful. Reachability
# and success are separate questions and are now asked separately.
$lanReachable = [bool]$lan.Status
if ($OffLan) {
    if ($lanReachable) { $failures += "NOT ACTUALLY OFF-LAN: the direct LAN address $lanAddress still answers, so this run proves nothing about off-site access" }
} elseif (-not ($lan.Status -eq '303' -and $lan.Location -eq '/' -and $lan.HasCookie)) {
    $detail = if ($lan.Error) { $lan.Error } else { "got '$($lan.Status)' -> '$($lan.Location)' cookie=$($lan.HasCookie)" }
    $failures += "LAN + device certificate: expected 303 -> / with session cookie, $detail"
}
'  {0,-32} {1,-4} {2}' -f $(if ($OffLan) { 'LAN direct (must be UNREACHABLE)' } else { 'LAN + device certificate' }),
    $(if ($lan.Status) { $lan.Status } else { '---' }),
    $(if ($lan.Status) { "$($lan.Location) cookie=$($lan.HasCookie)" } else { $lan.Error })

$overlay = Invoke-CockpitProbe -Address $overlayAddress -WithCertificate
if (-not ($overlay.Status -eq '303' -and $overlay.Location -eq '/' -and $overlay.HasCookie)) {
    $detail = if ($overlay.Error) { $overlay.Error } else { "got '$($overlay.Status)' -> '$($overlay.Location)' cookie=$($overlay.HasCookie)" }
    $failures += "overlay + device certificate: expected 303 -> / with session cookie, $detail"
}
'  {0,-32} {1,-4} {2} cookie={3}' -f 'overlay + device certificate', $(if ($overlay.Status) { $overlay.Status } else { '---' }), $(if ($overlay.Location) { $overlay.Location } else { $overlay.Error }), $overlay.HasCookie

# CONTROL: same overlay path, no client certificate. This MUST be refused a session.
$control = Invoke-CockpitProbe -Address $overlayAddress
if ($control.Error -or -not $control.Status) {
    # Unreachable is not the same finding as bypassed. Reporting a connection failure as a security
    # breach would cry wolf; reporting it as a pass would be worse.
    $failures += "CONTROL INCONCLUSIVE: the control request did not complete ($($control.Error)); refusal was neither proven nor disproven"
} elseif ($control.Location -ne '/sign-in' -or $control.HasCookie) {
    $failures += "CONTROL BREACH: overlay without a device certificate returned '$($control.Location)' cookie=$($control.HasCookie); the relay is handing out sessions without device identity"
}
'  {0,-32} {1,-4} {2} cookie={3}' -f 'overlay, NO cert (control)', $(if ($control.Status) { $control.Status } else { '---' }), $(if ($control.Location) { $control.Location } else { $control.Error }), $control.HasCookie

if ($failures.Count -gt 0) {
    # Deliberately NOT Write-Error. This script sets $ErrorActionPreference = 'Stop', under which
    # Write-Error THROWS -- so the script died on its own failure report and never reached the exit
    # below. It still exited non-zero (unhandled exceptions do), which is exactly why the defect
    # survived a negative test: the exit code looked right for the wrong reason, and any caller
    # capturing output got an exception instead of the findings.
    foreach ($failure in $failures) { [Console]::Error.WriteLine("FAIL: $failure") }
    exit 1
}
$(if ($OffLan) { 'OFFSITE_TRANSPORT_VERIFIED_OFF_LAN cert=' } else { 'OFFSITE_TRANSPORT_VERIFIED cert=' }) + $deviceCert.Thumbprint.Substring(0, 12) + ' expires=' + $deviceCert.NotAfter.ToString('yyyy-MM-dd')
