# Verify that the obsolete HERMES cockpit portproxy is retired -- RUNS ON HERMES, elevated.
#
# The repository-owned HTTPS proxy now binds the LAN and Tailscale addresses directly. A retained
# portproxy on the overlay address collides with that listener and can prevent an otherwise healthy
# deployment from starting. This script audits the endpoint and direct listener, but deliberately
# refuses to perform the migration itself: deploy-hermes-runtime.ps1 owns rollback capture and safe
# retirement. Any different target on the same endpoint fails closed. The firewall is preserved.
[CmdletBinding()]
param(
    [string]$Runtime = 'C:\HermesLab\williamos-runtime-64034e93-flat'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$overlayAddress = '100.97.194.84'
$lanAddress     = '192.168.88.9'
$port           = 3443
$ruleName       = 'WilliamOS cockpit over Tailscale'
$proxyPath      = [IO.Path]::GetFullPath((Join-Path $Runtime 'scripts\hermes-https-proxy.mjs')).TrimEnd('\')

function Test-ExpectedDirectOverlayListener {
    $listeners = @(Get-NetTCPConnection -LocalAddress $overlayAddress -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
    $ownerProcessIds = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($ownerProcessIds.Count -ne 1) { return $false }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($ownerProcessIds[0])" -ErrorAction SilentlyContinue
    if (-not $process -or -not $process.CommandLine) { return $false }
    $tokens = @([regex]::Matches($process.CommandLine, '(?:"([^"]*)"|''([^'']*)''|(\S+))') | ForEach-Object {
        @($_.Groups[1].Value, $_.Groups[2].Value, $_.Groups[3].Value) |
            Where-Object { $_ } | Select-Object -First 1
    })
    if ($tokens.Count -lt 2 -or [IO.Path]::GetFileName($tokens[0]) -ine 'node.exe') { return $false }
    try { return [IO.Path]::GetFullPath($tokens[1]).TrimEnd('\') -ieq $proxyPath } catch { return $false }
}

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
    throw 'RELAY_MIGRATION_REQUIRES_DEPLOYMENT: use deploy-hermes-runtime.ps1 so the exact relay is captured for rollback before retirement'
}

$remaining = @(netsh interface portproxy show v4tov4 2>&1 | ForEach-Object { $_.ToString() }) -match $listenPattern
if ($remaining) { throw "RELAY_RETIREMENT_FAILED: ${overlayAddress}:$port is still reserved by portproxy" }
if (-not (Test-ExpectedDirectOverlayListener)) {
    throw "DIRECT_LISTENER_NOT_PROVEN: the exact deployed WilliamOS proxy does not own ${overlayAddress}:$port"
}

$rule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if (-not $rule -or [string]$rule.Enabled -ne 'True') { throw "FIREWALL_RULE_MISSING: '$ruleName' absent or disabled" }
$portFilter = $rule | Get-NetFirewallPortFilter
$addressFilter = $rule | Get-NetFirewallAddressFilter
if ($rule.Profile -notmatch 'Private' -or $portFilter.Protocol -ne 'TCP' -or [string]$portFilter.LocalPort -ne [string]$port `
    -or [string]$addressFilter.LocalAddress -ne $overlayAddress) {
    throw "FIREWALL_RULE_WIDE: '$ruleName' does not remain scoped to ${overlayAddress}:$port on Private TCP"
}

'LEGACY_RELAY_RETIRED direct-listener={0}:{1} proxy={2} firewall=preserved' -f $overlayAddress, $port, $proxyPath
