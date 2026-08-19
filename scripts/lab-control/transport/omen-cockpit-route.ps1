# Point the cockpit hostname at the overlay -- RUNS ON OMEN, ELEVATED. Idempotent; safe to re-run.
#
# The cockpit is always reached as https://williamos.lan:3443. Only where that NAME RESOLVES changes.
# The certificate's SANs cover williamos.lan, so TLS hostname validation succeeds normally and the
# certificate is never bypassed.
#
# Do NOT "fix" a connection problem by browsing the raw 100.x address and clicking through the
# resulting warning. That trades the device-identity guarantee for convenience and would make the
# cockpit indistinguishable from an impostor on a hostile network -- which is the exact network this
# path exists to survive.
#
# TRADEOFF, recorded deliberately: once the name resolves to the overlay, the cockpit is reached over
# the overlay even at home. That is correct for travel, but it means that if Tailscale is down the
# cockpit is unreachable from a desk three feet from HERMES. Pass -Restore to put the LAN address back.
[CmdletBinding()]
param(
    [switch] $Restore   # revert williamos.lan to the LAN address
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$hostsFile      = "$env:SystemRoot\System32\drivers\etc\hosts"
$overlayAddress = '100.97.194.84'
$lanAddress     = '192.168.88.9'
$hostName       = 'williamos.lan'
$target         = if ($Restore) { $lanAddress } else { $overlayAddress }

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    # Windows silently truncates or refuses this write without elevation; failing loudly beats
    # writing nothing and reporting success.
    throw 'NOT_ELEVATED: editing the hosts file requires an elevated session'
}

# Drop every existing mapping for the name before adding one, so repeat runs cannot accumulate
# conflicting entries (Windows resolves the FIRST match, so a stale line silently wins).
#
# Parsed rather than pattern-matched, because a substring match on the name is wrong in three
# separate ways: it deletes comments that merely mention the name, it deletes unrelated records for
# names that CONTAIN it (foo.williamos.lan), and a leading-position-only regex misses the name when
# it appears as a second or later alias. A hosts line is "<address> <name> [alias...]" with an
# optional trailing comment, so the names are compared as whole tokens and only the matching name is
# removed -- the line survives if it still carries other names.
$kept = foreach ($line in @(Get-Content -LiteralPath $hostsFile)) {
    $withoutComment, $comment = ($line -split '#', 2)
    $tokens = @($withoutComment -split '\s+' | Where-Object { $_ })
    if ($tokens.Count -lt 2) { $line; continue }          # comment-only or blank: keep verbatim
    $names = @($tokens[1..($tokens.Count - 1)] | Where-Object { $_ -ne $hostName })
    if ($names.Count -eq $tokens.Count - 1) { $line; continue }   # name not present: keep verbatim
    # @(...) around the address, or PowerShell nests the name array and renders it System.Object[].
    if ($names.Count -gt 0) { ((@($tokens[0]) + $names) -join ' ') + $(if ($comment) { " #$comment" }) }
    # otherwise the record existed only for this name -- drop it
}
Set-Content -LiteralPath $hostsFile -Value (@($kept) + "$target $hostName")
ipconfig /flushdns | Out-Null

$resolved = (Resolve-DnsName -Name $hostName -Type A -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress } | Select-Object -First 1).IPAddress
if ($resolved -ne $target) { throw "ROUTE_NOT_APPLIED: $hostName resolves to '$resolved', expected '$target'" }

'ROUTE_APPLIED {0} -> {1}{2}' -f $hostName, $target, $(if ($Restore) { ' (LAN restored)' } else { ' (overlay)' })
