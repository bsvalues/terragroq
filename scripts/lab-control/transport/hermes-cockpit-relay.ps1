# Retire the obsolete HERMES cockpit portproxy -- RUNS ON HERMES, elevated.
#
# The repository-owned HTTPS proxy now binds the LAN and Tailscale addresses directly. A retained
# portproxy on the overlay address collides with that listener and can prevent an otherwise healthy
# deployment from starting. This script removes only the exact historical relay; any different
# target on the same endpoint fails closed. The narrow existing firewall rule is preserved.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$overlayAddress = '100.97.194.84'
$lanAddress     = '192.168.88.9'
$port           = 3443
$ruleName       = 'WilliamOS cockpit over Tailscale'

$tailscale = @(Get-CimInstance Win32_Service -Filter "Name='Tailscale'" -ErrorAction SilentlyContinue)
if ($tailscale.Count -ne 1 -or $tailscale[0].StartMode -ne 'Auto') {
    throw 'TAILSCALE_NOT_AUTOMATIC: the HERMES Tailscale service must start automatically before the legacy relay is retired'
}
if ($tailscale[0].State -ne 'Running') {
    throw 'TAILSCALE_NOT_RUNNING: the HERMES Tailscale service must be running before the legacy relay is retired'
}

$rows = @(netsh interface portproxy show v4tov4 2>&1 | ForEach-Object { $_.ToString() })
$listenPattern = "^\s*$([regex]::Escape($overlayAddress))\s+$port\s+(\S+)\s+(\d+)\s*$"
$matches = @($rows | Select-String -Pattern $listenPattern)
if ($matches.Count -gt 1) { throw "RELAY_AMBIGUOUS: multiple records claim ${overlayAddress}:$port" }
if ($matches.Count -eq 1) {
    $targetAddress = $matches[0].Matches[0].Groups[1].Value
    $targetPort = [int]$matches[0].Matches[0].Groups[2].Value
    if ($targetAddress -ne $lanAddress -or $targetPort -ne $port) {
        throw "RELAY_FOREIGN: ${overlayAddress}:$port targets ${targetAddress}:$targetPort; refusing to remove it"
    }
    netsh interface portproxy delete v4tov4 listenaddress=$overlayAddress listenport=$port 2>&1 | Out-Null
}

$remaining = @(netsh interface portproxy show v4tov4 2>&1 | ForEach-Object { $_.ToString() }) -match $listenPattern
if ($remaining) { throw "RELAY_RETIREMENT_FAILED: ${overlayAddress}:$port is still reserved by portproxy" }

$rule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if (-not $rule -or -not $rule.Enabled) { throw "FIREWALL_RULE_MISSING: '$ruleName' absent or disabled" }
$portFilter = $rule | Get-NetFirewallPortFilter
$addressFilter = $rule | Get-NetFirewallAddressFilter
if ($rule.Profile -notmatch 'Private' -or $portFilter.Protocol -ne 'TCP' -or [string]$portFilter.LocalPort -ne [string]$port `
    -or [string]$addressFilter.LocalAddress -ne $overlayAddress) {
    throw "FIREWALL_RULE_WIDE: '$ruleName' does not remain scoped to ${overlayAddress}:$port on Private TCP"
}

'LEGACY_RELAY_RETIRED direct-listener={0}:{1} firewall=preserved' -f $overlayAddress, $port
