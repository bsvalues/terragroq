# ==============================================================================
# #1223 door-artifact hardening, shared by the install/deploy paths.
#
# WHY: the provenance gate refuses to boot the door when the identity running it
# can rewrite a trust anchor (verify-door-provenance.mjs -> GATE_TAMPERABLE /
# TRUST_RING_TAMPERABLE / ANCHOR_TAMPERABLE). The check has two halves
# (attest-deployment.mjs:isWritableByThisIdentity):
#     1. the anchor FILE must refuse a write-open, and
#     2. its PARENT DIRECTORY must refuse entry creation
# because a read-only file inside a writable directory can simply be replaced.
# A plain Copy-Item -Force re-inherits the parent's loose ACEs, so any refresh
# that does not re-apply this lands the door in the refused state again.
#
# WHAT IT GRANTS: SYSTEM and Administrators FullControl (sanctioned repairs),
# BUILTIN\Users ReadAndExecute. The door runs RunLevel=Limited, so its token does
# not carry Administrators' Allow ACEs -- Users read-only is therefore exactly
# "can execute the door, cannot rewrite its anchors".
# It does NOT change the verifier's semantics, bypass it, or disable it.
# ==============================================================================

function Protect-WilliamOSDoorArtifact {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Path,
    [switch]$Directory
  )
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  $acl = Get-Acl -LiteralPath $Path
  # Stop inheriting first, so parent ACEs cannot flow back in, then rebuild explicitly.
  $acl.SetAccessRuleProtection($true, $false)
  @($acl.Access) | ForEach-Object { $null = $acl.RemoveAccessRule($_) }
  $inherit = if ($Directory) { 'ContainerInherit, ObjectInherit' } else { 'None' }
  foreach ($grant in @(
      @{ Id = 'NT AUTHORITY\SYSTEM';      Rights = 'FullControl' },
      @{ Id = 'BUILTIN\Administrators';   Rights = 'FullControl' },
      @{ Id = 'BUILTIN\Users';            Rights = 'ReadAndExecute' }
    )) {
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
        $grant.Id, $grant.Rights, $inherit, 'None', 'Allow')))
  }
  Set-Acl -LiteralPath $Path -AclObject $acl
  # The gate also requires a trusted (administrator) OWNER for anything under ProgramData\WilliamOS.
  try {
    $cur = Get-Acl -LiteralPath $Path
    if ($cur.Owner -notmatch 'Administrators|S-1-5-32-544|SYSTEM') {
      $cur.SetOwner([System.Security.Principal.NTAccount]'BUILTIN\Administrators')
      Set-Acl -LiteralPath $Path -AclObject $cur
    }
  } catch { Write-Warning "owner not adjusted for $Path : $($_.Exception.Message)" }
  return $true
}

<#
.SYNOPSIS
  Re-apply the #1223 immutability invariant to the door artifacts after a refresh.

.DESCRIPTION
  Call this AFTER any copy that lands a door artifact under ProgramData\WilliamOS.
  It hardens the four anchors the gate probes, the launch scripts the door
  executes, and the directories that contain them, so a subsequent boot does not
  fail closed on a newly-inherited writable ACE.
#>
function Protect-WilliamOSDoor {
  [CmdletBinding()]
  param([string]$InstallRoot = "C:\ProgramData\WilliamOS")

  $gateDir = Join-Path $InstallRoot "scripts\hermes-bridge"
  $anchors = @(
    (Join-Path $gateDir "verify-door-provenance.mjs"),
    (Join-Path $gateDir "attest-deployment.mjs"),
    (Join-Path $gateDir "deployment-attestation-keys.json"),
    (Join-Path $gateDir "integrations.json")
  )
  $launchers = @(
    (Join-Path $InstallRoot "start-williamos-live.ps1"),
    (Join-Path $InstallRoot "start-williamos-https.ps1")
  )
  $protected = @()
  foreach ($f in ($anchors + $launchers)) {
    if (Protect-WilliamOSDoorArtifact -Path $f) { $protected += $f }
  }
  # The containing directories must also refuse entry creation, or a file is substitutable.
  foreach ($d in @($gateDir, $InstallRoot)) {
    if (Protect-WilliamOSDoorArtifact -Path $d -Directory) { $protected += $d }
  }
  Write-Output ("DOOR_ARTIFACTS_PROTECTED " + $protected.Count + " paths")
  return $protected
}
