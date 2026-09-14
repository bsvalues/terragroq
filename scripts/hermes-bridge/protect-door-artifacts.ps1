# ==============================================================================
# #1223 door-artifact hardening, shared by the install/deploy paths.
#
# WHY: the provenance gate refuses to boot the door when the identity running it
# can rewrite a trust anchor (verify-door-provenance.mjs -> GATE_TAMPERABLE /
# TRUST_RING_TAMPERABLE / ANCHOR_TAMPERABLE). The check has two halves
# (attest-deployment.mjs:isWritableByThisIdentity):
#     1. the anchor FILE must refuse a write-open, and
#     2. its PARENT DIRECTORY must refuse entry creation
# because a read-only file inside a writable directory can simply be replaced --
# and, as measured on the live host, a directory whose PARENT still grants write
# can be RENAMED AWAY and replaced wholesale. That is why the gate directory's
# parent (`scripts`) is protected here too, not just the gate directory.
#
# OWNERSHIP IS HALF THE INVARIANT: an owner keeps implicit WRITE_DAC even when the
# ACL grants it nothing, so it can rewrite the ACL at leisure and a mask probe is
# blind to it (attest-deployment.mjs:255-261 documents exactly this). A run that
# cannot establish trusted ownership has NOT protected the artifact, so this
# helper THROWS rather than warning -- a fail-open here would report success while
# leaving the gate to refuse at boot, or leaving an artifact the door owns.
#
# SCOPE -- WHAT IS DELIBERATELY *NOT* HARDENED, AND WHY:
#   The install root `C:\ProgramData\WilliamOS` keeps its INHERITED write ACE,
#   because both launchers write stdout/stderr/boot logs into
#   `C:\ProgramData\WilliamOS\logs` (start-williamos-live.ps1 $LogRoot L69/L92-94;
#   start-williamos-https.ps1 $LogRoot L14/L21-22). Hardening the install root
#   propagates read-only down into `logs`, the door identity can then no longer
#   CREATE its log files (reproduced: "Access to the path '...\logs\.new-...' is
#   denied"), and both launchers fail before serving traffic. `rollback`,
#   `backups` and `tls` likewise stay untouched. The root's OWNER is corrected
#   without touching its DACL, so the door cannot re-ACL the root while `logs`
#   stays writable.
#
#   The trust ring root is hardened SYSTEM/Administrators ONLY, with no Users ACE,
#   mirroring the deploy's own posture for `$trustRootDir`
#   (deploy-hermes-runtime.ps1 L804). It holds the attestation PRIVATE key;
#   granting Users read there would widen a trust root the deploy deliberately
#   keeps closed. The door needs only the PUBLIC ring
#   (`scripts\hermes-bridge\deployment-attestation-keys.json`), which stays
#   Users-readable.
#
# WHAT IT GRANTS: SYSTEM and Administrators FullControl (sanctioned repairs),
# plus BUILTIN\Users ReadAndExecute on the gate artifacts only. The door runs
# RunLevel=Limited, so its token carries no Administrators Allow ACE -- Users
# read-only is therefore exactly "can execute the door, cannot rewrite its
# anchors".
#
# It does NOT change the verifier's semantics, bypass it, or disable it.
# ==============================================================================

# Administrators and SYSTEM, by SID. A localized system renders these names
# differently, so the owner check compares SIDs, never display-name substrings.
$script:WILLIAMOS_TRUSTED_OWNER_SIDS = @('S-1-5-32-544', 'S-1-5-18')

function Get-WilliamOSTrustedOwnerSid {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Path)
  $acl = Get-Acl -LiteralPath $Path
  try {
    return (New-Object System.Security.Principal.NTAccount($acl.Owner)).Translate(
      [System.Security.Principal.SecurityIdentifier]).Value
  } catch { return $null }
}

function Protect-WilliamOSDoorArtifact {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Path,
    # ContainerInherit|ObjectInherit on a DIRECTORY so a file later dropped inside it
    # cannot come back loose; None on files so protection never reaches siblings.
    [switch]$Directory,
    # SYSTEM + Administrators only, no Users ACE -- for the trust root, which holds
    # key material the door identity must not read.
    [switch]$AdminOnly
  )
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  $acl = Get-Acl -LiteralPath $Path
  # Stop inheriting first, so parent ACEs cannot flow back in, then rebuild explicitly.
  $acl.SetAccessRuleProtection($true, $false)
  @($acl.Access) | ForEach-Object { $null = $acl.RemoveAccessRule($_) }
  $inherit = if ($Directory) { 'ContainerInherit, ObjectInherit' } else { 'None' }
  $grants = @(
    @{ Id = 'NT AUTHORITY\SYSTEM';    Rights = 'FullControl' },
    @{ Id = 'BUILTIN\Administrators'; Rights = 'FullControl' }
  )
  if (-not $AdminOnly) { $grants += @{ Id = 'BUILTIN\Users'; Rights = 'ReadAndExecute' } }
  foreach ($grant in $grants) {
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
        $grant.Id, $grant.Rights, $inherit, 'None', 'Allow')))
  }
  Set-Acl -LiteralPath $Path -AclObject $acl

  # Ownership is the other half of the invariant, so this is NOT best-effort: an
  # owner can always rewrite its own ACL, and the mask probe cannot see that.
  $ownerSid = Get-WilliamOSTrustedOwnerSid -Path $Path
  if ($script:WILLIAMOS_TRUSTED_OWNER_SIDS -notcontains $ownerSid) {
    $cur = Get-Acl -LiteralPath $Path
    $cur.SetOwner([System.Security.Principal.NTAccount]'BUILTIN\Administrators')
    Set-Acl -LiteralPath $Path -AclObject $cur   # throws if not elevated: intended (fail-closed)
    $ownerSid = Get-WilliamOSTrustedOwnerSid -Path $Path
    if ($script:WILLIAMOS_TRUSTED_OWNER_SIDS -notcontains $ownerSid) {
      throw "DOOR_ARTIFACT_OWNER_NOT_TRUSTED $Path owner=$ownerSid -- an untrusted owner keeps implicit WRITE_DAC, so the artifact is still rewritable by the identity running the door."
    }
  }
  return $true
}

<#
.SYNOPSIS
  Re-apply the #1223 immutability invariant to the door artifacts after a refresh.

.DESCRIPTION
  Call this AFTER any copy that lands a door artifact under ProgramData\WilliamOS,
  including ROLLBACK and RESTORE paths -- a restored copy re-inherits the parent's
  ACEs just as a fresh install does.

  It hardens, with no inheritance escaping the named paths:
    - the four anchors the gate probes, and the trust ring key;
    - both launcher FILES the scheduled task executes;
    - the gate directory, its parent `scripts`, and the trust ring root,
      so no protected entry can be renamed away or replaced from an unprotected
      parent;
  and corrects the install root's OWNER while leaving its DACL (and therefore the
  writable `logs` subtree) intact.

  Throws if any artifact cannot be given trusted ownership -- see the header note.
#>
function Protect-WilliamOSDoor {
  [CmdletBinding()]
  param(
    [string]$InstallRoot = "C:\ProgramData\WilliamOS",
    # Reject an install root that would drag the mutable log subtree, or an
    # ancestor of it, into the hardened set: that is the documented outage this
    # helper exists to avoid (see the header).
    [switch]$SkipRootOwnerCheck
  )

  $gateDir   = Join-Path $InstallRoot "scripts\hermes-bridge"
  $scriptsDir = Join-Path $InstallRoot "scripts"
  $trustDir  = Join-Path $InstallRoot "trust"

  if (-not $SkipRootOwnerCheck) {
    $logsDir = Join-Path $InstallRoot "logs"
    foreach ($guarded in @($logsDir)) {
      if ($gateDir.StartsWith($guarded, [StringComparison]::OrdinalIgnoreCase) -or
          $trustDir.StartsWith($guarded, [StringComparison]::OrdinalIgnoreCase)) {
        throw "DOOR_ARTIFACT_ROOT_OVERLAPS_LOGS refusing to harden '$InstallRoot' because a protected path sits under the mutable log subtree."
      }
    }
    # The install root's DACL stays as-is (logs must remain writable); only the
    # owner is corrected, because an owner can re-ACL the root at will.
    if (Test-Path -LiteralPath $InstallRoot) {
      $rootOwner = Get-WilliamOSTrustedOwnerSid -Path $InstallRoot
      if ($script:WILLIAMOS_TRUSTED_OWNER_SIDS -notcontains $rootOwner) {
        $racl = Get-Acl -LiteralPath $InstallRoot
        $racl.SetOwner([System.Security.Principal.NTAccount]'BUILTIN\Administrators')
        Set-Acl -LiteralPath $InstallRoot -AclObject $racl
        $rootOwner = Get-WilliamOSTrustedOwnerSid -Path $InstallRoot
        if ($script:WILLIAMOS_TRUSTED_OWNER_SIDS -notcontains $rootOwner) {
          throw "DOOR_INSTALL_ROOT_OWNER_NOT_TRUSTED $InstallRoot owner=$rootOwner -- the door identity could re-ACL the root and then rewrite every artifact beneath it."
        }
      }
    }
  }

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
  # The trust ring key is key material: SYSTEM/Administrators only, no Users ACE.
  if (Protect-WilliamOSDoorArtifact -Path (Join-Path $trustDir "deployment-attestation-key.json") -AdminOnly) {
    $protected += (Join-Path $trustDir "deployment-attestation-key.json")
  }
  # Directories: the gate dir and its PARENT (so the gate dir cannot be renamed
  # away or replaced), Users-readable because the door executes from them. The
  # trust root is Admin-only.
  foreach ($d in @($gateDir, $scriptsDir)) {
    if (Protect-WilliamOSDoorArtifact -Path $d -Directory) { $protected += $d }
  }
  if (Protect-WilliamOSDoorArtifact -Path $trustDir -Directory -AdminOnly) { $protected += $trustDir }

  # Emit ONLY the path list: a second pipeline object here would be captured alongside the array by
  # any caller that assigns the result, and the array would silently become object[] instead of a list.
  Write-Verbose ("DOOR_ARTIFACTS_PROTECTED " + $protected.Count + " paths")
  return $protected
}
