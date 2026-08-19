# Cockpit reachability over the WilliamOS overlay -- RUNS ON HERMES. Idempotent; safe to re-run.
#
# WHY THIS EXISTS AT ALL
# scripts/hermes-https-proxy.mjs binds HERMES_HTTPS_HOST = 192.168.88.9, a hardcoded LAN address, so
# the cockpit listener answers on the LAN interface only and the overlay address cannot reach it.
# Changing that constant is a control-plane code change owned by a different lane, so reachability is
# solved outside the application instead.
#
# WHY A TCP RELAY AND NOT A REVERSE PROXY OR TUNNEL
# portproxy forwards TCP and nothing else. The TLS handshake -- including the client certificate that
# carries OMEN's device identity -- is negotiated end to end between the client and
# hermes-https-proxy. Nothing here terminates, decrypts, or inspects TLS, so socket.authorized and the
# x-williamos-device-cert header behave exactly as they do on the LAN.
#
# This is precisely why cloudflared must NOT be substituted here: it terminates TLS at the provider,
# which would silently destroy the device-identity proof while every health check still returned 200.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$overlayAddress = '100.97.194.84'   # HERMES on the overlay
$lanAddress     = '192.168.88.9'    # where hermes-https-proxy actually binds
$port           = 3443
$ruleName       = 'WilliamOS cockpit over Tailscale'

# netsh writes to the registry and returns 0 for "already absent", so delete-then-add is the
# idempotent form. Errors are swallowed only on the delete.
netsh interface portproxy delete v4tov4 listenaddress=$overlayAddress listenport=$port 2>&1 | Out-Null
netsh interface portproxy add v4tov4 `
    listenaddress=$overlayAddress listenport=$port `
    connectaddress=$lanAddress connectport=$port 2>&1 | Out-Null

# Inbound allow scoped to the overlay address AND the Private profile. The Tailscale adapter is
# Private; the Ethernet adapter is Public, so this does not open 3443 to the LAN, to a hotel network,
# or to anything else. Both conditions matter -- either one alone is wider than intended.
Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort $port -Profile Private -LocalAddress $overlayAddress | Out-Null

# --- verify rather than assume ---
# Match the address AND the port. Matching the address alone would pass on any entry that happens to
# share it -- a relay pointing at the wrong port would verify clean, which is the exact false green
# this script exists to prevent. netsh prints "listenAddress listenPort connectAddress connectPort".
$relayPattern = "^\s*$([regex]::Escape($overlayAddress))\s+$port\s+$([regex]::Escape($lanAddress))\s+$port\s*$"
$relay = @(netsh interface portproxy show v4tov4) -match $relayPattern
if (-not $relay) { throw "RELAY_MISSING: no portproxy entry ${overlayAddress}:$port -> ${lanAddress}:$port" }

$rule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if (-not $rule -or -not $rule.Enabled) { throw "FIREWALL_RULE_MISSING: '$ruleName' absent or disabled" }

# portproxy depends on iphlpsvc. If that service is not set to start automatically the relay is
# silently gone after the next reboot -- exactly the class of failure this lab has already been bitten
# by, where the mechanism reports success and protects nothing.
$iphlp = Get-Service iphlpsvc
if ($iphlp.StartType -ne 'Automatic') { throw "IPHLPSVC_NOT_AUTOMATIC: portproxy will not survive reboot (StartType=$($iphlp.StartType))" }

$tailscale = Get-Service Tailscale -ErrorAction SilentlyContinue
if (-not $tailscale -or $tailscale.StartType -ne 'Automatic') { throw 'TAILSCALE_NOT_AUTOMATIC: overlay will not come back after reboot' }

'RELAY_CONFIGURED overlay={0}:{1} -> {2}:{1} profile=Private iphlpsvc=Automatic tailscale=Automatic' -f $overlayAddress, $port, $lanAddress
