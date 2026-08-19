# Prove the cockpit is reachable over the overlay WITHOUT weakening its authentication -- RUNS ON OMEN.
# Read-only: issues requests, changes no configuration. Exits non-zero on any failed assertion.
#
# The control case is the point of this script. Two green checks that the cockpit answers over the
# overlay would ALSO be green if the relay had quietly stripped client-certificate authentication and
# started handing sessions to anybody who connected. Proving the reachability without proving the
# refusal is how a transport change silently becomes an authentication bypass.
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
foreach ($case in @(
    @{ Name = 'LAN + device certificate';     Address = $lanAddress;     Cert = $true  },
    @{ Name = 'overlay + device certificate'; Address = $overlayAddress; Cert = $true  }
)) {
    $result = Invoke-CockpitProbe -Address $case.Address -WithCertificate:$case.Cert
    $ok = $result.Status -eq '303' -and $result.Location -eq '/' -and $result.HasCookie
    if (-not $ok) {
        $detail = if ($result.Error) { $result.Error } else { "got '$($result.Status)' -> '$($result.Location)' cookie=$($result.HasCookie)" }
        $failures += "$($case.Name): expected 303 -> / with session cookie, $detail"
    }
    '  {0,-32} {1,-4} {2} cookie={3}' -f $case.Name, $(if ($result.Status) { $result.Status } else { '---' }), $(if ($result.Location) { $result.Location } else { $result.Error }), $result.HasCookie
}

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
    $failures | ForEach-Object { Write-Error $_ }
    exit 1
}
'OFFSITE_TRANSPORT_VERIFIED cert=' + $deviceCert.Thumbprint.Substring(0, 12) + ' expires=' + $deviceCert.NotAfter.ToString('yyyy-MM-dd')
