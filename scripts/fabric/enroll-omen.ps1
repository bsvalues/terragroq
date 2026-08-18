# Enroll OMEN into the WilliamOS fabric management plane.
#
# The plane has been stuck at three of four nodes because OMEN accepts nothing inbound: SSH, WinRM,
# RDP and Docker are all closed, and its SMB ports deny the control node because the lab is a
# workgroup with no shared identity. There is therefore no credential-less path in, and the assistant
# must never use the owner's Windows password -- so this one step has to be applied locally, once,
# from OMEN itself. It is written to be run by OMEN's own agent, not by the owner.
#
# "Cockpit only" means OMEN is not an autonomous worker by default. It does NOT mean unmanaged: a
# node the plane cannot see is a node whose state the system is blind to, which is exactly how the
# canonical WilliamOS state ended up stranded there.
#
# What this grants is narrow: one service key, key-only SSH, reachable only from the control node.
# It installs no agent, opens nothing to the wider network, and starts no worker.
#
# -ReportOnly re-emits section 5's summary without applying anything. The first real run proved why
# that is needed: the script died at the restart, having already applied every change, so the node
# was enrolled and the summary -- the only artefact anyone could check -- did not exist. A summary
# you can only obtain by re-running the mutations is not evidence, it is a side effect.
param([switch]$ReportOnly)

$ErrorActionPreference = "Stop"

# The dedicated fabric SERVICE identity -- not the owner's key, not anyone's personal key.
$FabricKey  = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMl9PTRpV9ZefxZZZPWxOfgrxywQPLA4+CKGu1EXmuyZ williamos-fabric@hermes"
$ControlIp  = "192.168.88.9"   # HERMES, the only address allowed to connect
$RuleName   = "WilliamOS Fabric SSH (HERMES only)"

function Require-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this in an elevated PowerShell on OMEN (installing a Windows capability and a firewall rule both require it)."
  }
}

function Restart-SshdWithDependents {
  # Recent Windows OpenSSH installs `SshdBroker`, which DEPENDS ON sshd. A plain `Restart-Service
  # sshd` therefore aborts with "Cannot stop service 'OpenSSH SSH Server (sshd)' because it has
  # dependent services" -- and because $ErrorActionPreference is Stop, that killed the script one
  # line before its summary. Every Windows node will hit this, so it belongs here and not in a
  # runbook.
  #
  # -Force stops the dependents but does NOT start them again, which would leave the broker down and
  # the node subtly degraded. Names are captured first because the service objects go stale across
  # the restart.
  $dependents = @(@(Get-Service sshd).DependentServices | Where-Object { $_.Status -eq "Running" } | ForEach-Object { $_.Name })
  Restart-Service sshd -Force
  foreach ($name in $dependents) {
    if ((Get-Service $name -ErrorAction SilentlyContinue).Status -ne "Running") { Start-Service $name }
  }
  return $dependents
}

Require-Admin

$config    = "C:\ProgramData\ssh\sshd_config"
$adminKeys = "C:\ProgramData\ssh\administrators_authorized_keys"
$userKeys  = Join-Path $env:USERPROFILE ".ssh\authorized_keys"
$isAdminUser = (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$target = if ($isAdminUser) { $adminKeys } else { $userKeys }

if (-not $ReportOnly) {
  # 1. OpenSSH server -----------------------------------------------------------------------------
  if (-not (Get-WindowsCapability -Online -Name OpenSSH.Server* | Where-Object State -eq "Installed")) {
    Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 | Out-Null
  }
  Set-Service -Name sshd -StartupType Automatic
  Start-Service sshd

  # 2. Key-only authentication --------------------------------------------------------------------
  # Passwords are disabled deliberately: the point of the plane is that machines authenticate with
  # machine identities, so no human credential is ever required or transmitted for routine management.
  $text = Get-Content $config -Raw
  $text = $text -replace "(?m)^#?\s*PasswordAuthentication\s+.*$", "PasswordAuthentication no"
  $text = $text -replace "(?m)^#?\s*PubkeyAuthentication\s+.*$", "PubkeyAuthentication yes"
  Set-Content $config -Value $text -Encoding UTF8

  # 3. Trust the fabric key -----------------------------------------------------------------------
  # Windows OpenSSH reads ADMINISTRATORS_authorized_keys for members of the Administrators group and
  # ignores the per-user file for them, which is the usual reason a correct key still gets rejected.
  New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
  if (-not (Test-Path $target)) { New-Item -ItemType File -Path $target | Out-Null }
  if (-not (Select-String -Path $target -SimpleMatch "williamos-fabric@hermes" -Quiet)) {
    Add-Content -Path $target -Value $FabricKey
  }
  if ($target -eq $adminKeys) {
    # sshd refuses this file unless only SYSTEM and Administrators can write it.
    icacls $adminKeys /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F" | Out-Null
  }

  # 4. Firewall: the control node only -------------------------------------------------------------
  Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Protocol TCP -LocalPort 22 `
    -RemoteAddress $ControlIp -Action Allow -Profile Any | Out-Null
  # The capability install adds a permissive any-source rule; it is disabled so port 22 is not exposed
  # to the whole network as a side effect of enrolling.
  Get-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -ErrorAction SilentlyContinue | Disable-NetFirewallRule

  Restart-SshdWithDependents | Out-Null
}

# 5. Report --------------------------------------------------------------------------------------
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like "192.168.88.*" } | Select-Object -First 1).IPAddress
[pscustomobject]@{
  sshd          = (Get-Service sshd).Status
  startup       = (Get-Service sshd).StartType
  dependents    = @(@(Get-Service sshd).DependentServices | ForEach-Object { "$($_.Name)=$($_.Status)" })
  keyFile       = $target
  keyInstalled  = [bool](Select-String -Path $target -SimpleMatch "williamos-fabric@hermes" -Quiet)
  passwordAuth  = (Select-String -Path $config -Pattern "^PasswordAuthentication no" -Quiet)
  firewallScope = $ControlIp
  firewallRule  = (Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | ForEach-Object { $_.Enabled.ToString() })
  anySourceRule = (Get-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -ErrorAction SilentlyContinue | ForEach-Object { $_.Enabled.ToString() })
  address       = $ip
  reportOnly    = [bool]$ReportOnly
  hostKey       = (Get-Content "C:\ProgramData\ssh\ssh_host_ed25519_key.pub" -Raw).Trim()
} | ConvertTo-Json
