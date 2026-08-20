# #858 item 4 -- prove the cockpit works from a GENUINELY off-LAN network. RUNS ON OMEN, ELEVATED.
#
# Designed to be launched DETACHED (as a scheduled task) rather than driven over a live remote
# session. The whole point of this run is to remove the lab LAN, and a driving session that arrived
# over the very path being tested would die mid-run and leave the adapter disabled. Everything is
# written to a log the caller polls instead.
#
# SAFETY. Three independent layers, because this deliberately severs the machine's network:
#   1. try/finally restores the Ethernet adapter on every exit path, including a thrown assertion.
#   2. a failsafe scheduled task re-enables the adapter unconditionally after -FailsafeMinutes, in
#      case this process is killed outright and the finally never runs.
#   3. the replacement path is proven to hold an address BEFORE Ethernet is touched, so a dead
#      hotspot fails the run while the machine is still connected rather than stranding it.
[CmdletBinding()]
param(
    [string] $Ssid            = 'iPhone',      # saved profile name for the phone hotspot
    [int]    $WaitMinutes     = 15,            # how long to wait for the hotspot to appear
    [int]    $FailsafeMinutes = 25,            # backstop re-enable of Ethernet
    [string] $EthernetAlias   = 'Ethernet',
    [string] $WifiAlias       = 'Wi-Fi',
    [string] $LanPeerAddress  = '192.168.88.9',
    [string] $LogPath         = 'C:\ProgramData\WilliamOS\offlan-acceptance.log'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$failsafeTask = 'WilliamOS offlan acceptance failsafe'
$tailscale = 'C:\Program Files\Tailscale\tailscale.exe'
$transcript = [Collections.Generic.List[string]]::new()

function Note {
    param([string] $Message)
    $transcript.Add(('{0:HH:mm:ss}  {1}' -f [datetime]::Now, $Message))
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogPath) | Out-Null
    Set-Content -LiteralPath $LogPath -Value $transcript
}

function Invoke-NativeText {
    # Windows PowerShell 5.1 converts a native command's STDERR into an ErrorRecord, and with
    # $ErrorActionPreference = 'Stop' that becomes TERMINATING. `tailscale netcheck` writes routine
    # notices to stderr ("portmap: monitor: gateway and self IP changed"), which killed the first
    # run of this script instantly. The cmdlet-level 'Stop' is worth keeping, so native calls are
    # isolated here instead of weakening it globally.
    # $script: is load-bearing. A scriptblock parameter executes in its DEFINITION scope -- the
    # caller's -- not this function's, so a plain local assignment here changes nothing the command
    # can see. That silent no-op is easy to mistake for a working guard.
    param([scriptblock] $Command)
    $previous = $script:ErrorActionPreference
    $script:ErrorActionPreference = 'Continue'
    try { return @(& $Command 2>&1 | ForEach-Object { $_.ToString() }) }
    finally { $script:ErrorActionPreference = $previous }
}

function Test-PeerReachable {
    # Test-Connection takes -ComputerName on Windows PowerShell 5.1 and -TargetName on PowerShell 7.
    # A scheduled task may launch either host, and guessing wrong throws a parameter-binding error
    # in the middle of a run that has already severed the network. .NET's ping is identical on both.
    # Attempts, not a duplicated call. A single dropped packet must not be reported as "the LAN is
    # gone" -- that is the assertion the whole run rests on, so it gets retried rather than trusted
    # on one sample.
    param([string] $Address, [int] $TimeoutMs = 2000, [int] $Attempts = 2)
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try { if (((New-Object Net.NetworkInformation.Ping).Send($Address, $TimeoutMs)).Status -eq 'Success') { return $true } }
        catch { }
    }
    return $false
}

function Get-PublicEndpoint {
    # Tailscale's own STUN result, deliberately: it reports the address the machine actually egresses
    # from without sending anything to a third-party "what is my IP" service.
    $line = @(Invoke-NativeText { & $tailscale netcheck } | Select-String 'IPv4: yes,') | Select-Object -First 1
    if (-not $line) { return '' }
    return ($line.ToString() -replace '.*IPv4: yes,\s*', '').Trim()
}

function Get-PeerPath {
    $peer = @((Invoke-NativeText { & $tailscale status --json }) -join "`n" | ConvertFrom-Json |
        ForEach-Object { $_.Peer.PSObject.Properties.Value } |
        Where-Object { $_.HostName -eq 'hermes' }) | Select-Object -First 1
    if (-not $peer) { return [pscustomobject]@{ CurAddr = ''; Relay = '' } }
    return [pscustomobject]@{ CurAddr = "$($peer.CurAddr)"; Relay = "$($peer.Relay)" }
}

$ethernetDisabled = $false
try {
    Note "START ssid='$Ssid' ethernet='$EthernetAlias' wifi='$WifiAlias'"
    $lanEndpoint = Get-PublicEndpoint
    Note "baseline public endpoint (on LAN): $lanEndpoint"

    # Unplugging the cable is the simplest way to be off the LAN, needs no elevation, and is what
    # actually produced the first passing run. If the adapter is already down there is nothing to
    # sever and nothing to restore, so the whole privileged path -- failsafe task, Disable-NetAdapter,
    # Enable-NetAdapter -- is skipped. Arming a failsafe to re-enable an adapter this script never
    # disabled would be theatre, and it would fight a cable the operator deliberately pulled.
    $ethernetState = (Get-NetAdapter -Name $EthernetAlias -ErrorAction SilentlyContinue).Status
    $mustSeverLan = $ethernetState -eq 'Up'
    Note "'$EthernetAlias' is '$ethernetState' -> $(if ($mustSeverLan) { 'this script will disable it' } else { 'already off the LAN; no adapter changes needed' })"

    if ($mustSeverLan) {
        # --- failsafe armed BEFORE anything is severed ---
        $restoreCommand = "Enable-NetAdapter -Name '$EthernetAlias' -Confirm:`$false"
        Register-ScheduledTask -TaskName $failsafeTask -Force `
            -Action (New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -Command `"$restoreCommand`"") `
            -Trigger (New-ScheduledTaskTrigger -Once -At ([datetime]::Now.AddMinutes($FailsafeMinutes))) `
            -Principal (New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest) | Out-Null
        Note "failsafe armed: '$EthernetAlias' re-enables unconditionally at +$FailsafeMinutes min"
    }

    # --- 1. wait for the hotspot, then join it (skipped if a replacement link is already up) ---
    $deadline = [datetime]::Now.AddMinutes($WaitMinutes)
    $visible = $false
    do {
        $visible = [bool](@(Invoke-NativeText { netsh wlan show networks }) -match [regex]::Escape($Ssid))
        if ($visible) { break }
        Note "waiting for '$Ssid' to broadcast... (until $($deadline.ToString('HH:mm:ss')))"
        Start-Sleep -Seconds 15
    } while ([datetime]::Now -lt $deadline)
    if (-not $visible) { throw "HOTSPOT_NOT_FOUND: '$Ssid' never appeared within $WaitMinutes minutes; is Personal Hotspot switched on?" }
    Note "'$Ssid' is broadcasting"

    Invoke-NativeText { netsh wlan connect name="$Ssid" } | Out-Null
    $wifiDeadline = [datetime]::Now.AddSeconds(90)
    $wifiIp = $null
    do {
        Start-Sleep -Seconds 5
        # 169.254.* is APIPA -- an adapter that came up without DHCP. Treating it as success would
        # sever the LAN in favour of a link that cannot route anywhere.
        $wifiIp = @(Get-NetIPAddress -InterfaceAlias $WifiAlias -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.IPAddress -notlike '169.254.*' }) | Select-Object -First 1
    } while (-not $wifiIp -and [datetime]::Now -lt $wifiDeadline)
    if (-not $wifiIp) { throw "HOTSPOT_NO_ADDRESS: joined '$Ssid' but no routable IPv4 was assigned" }
    Note "joined '$Ssid' -> $($wifiIp.IPAddress)"

    # --- 2. sever the LAN, only now that the replacement path holds an address ---
    if ($mustSeverLan) {
        Disable-NetAdapter -Name $EthernetAlias -Confirm:$false
        $ethernetDisabled = $true
        Note "DISABLED '$EthernetAlias' -- the lab LAN is gone"
        Start-Sleep -Seconds 20   # let Tailscale notice the interface change and re-path
    }

    # --- 3. prove the machine really is off the LAN ---
    # Three independent checks. A single one is too easy to satisfy accidentally, and a green
    # overlay result while the LAN is still reachable would prove only that the machine has a
    # network -- not that it left one.
    # A physically unplugged adapter KEEPS its 0.0.0.0/0 entry in the routing table -- observed
    # directly: Ethernet showed 'Disconnected' while still listing a default route via 192.168.88.1.
    # So the route table alone cannot answer "am I off the LAN"; the adapter's link state has to be
    # consulted too, and reachability below is the assertion that actually decides it.
    $liveRoutes = @(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
        ForEach-Object { Get-NetAdapter -InterfaceIndex $_.ifIndex -ErrorAction SilentlyContinue } |
        Where-Object { $_.Status -eq 'Up' })
    $routeVia = ($liveRoutes | ForEach-Object { $_.Name }) -join ','
    Note "default route via LIVE adapters: $routeVia"
    if ($routeVia -match [regex]::Escape($EthernetAlias)) { throw "STILL_ON_LAN: '$EthernetAlias' is up and still carries a default route" }

    $lanReachable = Test-PeerReachable -Address $LanPeerAddress -Attempts 3
    Note "lab LAN peer $LanPeerAddress reachable: $lanReachable  (MUST be False)"
    if ($lanReachable) { throw "STILL_ON_LAN: $LanPeerAddress still answers on the local network" }

    $cellEndpoint = Get-PublicEndpoint
    Note "public endpoint now: $cellEndpoint  (was $lanEndpoint)"

    $path = Get-PeerPath
    Note "tailscale path to hermes: curAddr='$($path.CurAddr)' relay='$($path.Relay)'"
    if ($path.CurAddr -like "$LanPeerAddress*") { throw "STILL_LAN_PATH: tailscale is still using the direct LAN endpoint $($path.CurAddr)" }
    # An empty CurAddr means no direct connection, which is the relayed case and exactly what an
    # off-LAN run should look like -- but only if a relay is actually assigned. Empty on BOTH fields
    # is not evidence of anything, and "not the LAN endpoint" would otherwise pass trivially on it.
    if (-not $path.CurAddr -and -not $path.Relay) { throw "PATH_INCONCLUSIVE: tailscale reports neither a direct address nor a relay for hermes" }

    # --- 4. the actual acceptance: cockpit + device certificate, off-LAN ---
    Note 'running verify-cockpit-transport.ps1 -OffLan'
    $verifier = Join-Path $PSScriptRoot 'verify-cockpit-transport.ps1'
    $output = Invoke-NativeText { & $verifier -OffLan }
    $verifierExit = $LASTEXITCODE
    foreach ($line in $output) { Note "  | $line" }
    if ($verifierExit -ne 0) { throw "TRANSPORT_VERIFY_FAILED off-LAN (exit $verifierExit)" }

    Note "RESULT: OFFLAN_ACCEPTANCE_PASS path='$($path.CurAddr)' relay='$($path.Relay)' publicEndpoint='$cellEndpoint'"
}
catch {
    Note "RESULT: OFFLAN_ACCEPTANCE_FAIL $($_.Exception.Message)"
}
finally {
    if ($ethernetDisabled) {
        Enable-NetAdapter -Name $EthernetAlias -Confirm:$false -ErrorAction SilentlyContinue
        $restoreDeadline = [datetime]::Now.AddSeconds(90)
        $lanBack = $false
        do {
            Start-Sleep -Seconds 5
            $lanBack = Test-PeerReachable -Address $LanPeerAddress
        } while (-not $lanBack -and [datetime]::Now -lt $restoreDeadline)
        Note "restored '$EthernetAlias'; lab LAN peer reachable again: $lanBack"
    }
    Unregister-ScheduledTask -TaskName $failsafeTask -Confirm:$false -ErrorAction SilentlyContinue
    Note 'failsafe disarmed; run complete'
}
