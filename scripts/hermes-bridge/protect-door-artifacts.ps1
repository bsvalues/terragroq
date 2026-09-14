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
#
# SCOPE -- WHAT IS DELIBERATELY *NOT* HARDENED, AND WHY:
#   The install root `C:\ProgramData\WilliamOS` must stay writable, because both
#   launchers write stdout/stderr/boot logs into `C:\ProgramData\WilliamOS\logs`
#   (start-williamos-live.ps1 $LogRoot L69/L92-94; start-williamos-https.ps1
#   $LogRoot L14/L21-22). Hardening the install root propagates read-only down
#   into `logs`, the door identity can then no longer CREATE its log files
#   (reproduced: "Access to the path '...\logs\.new-...' is denied"), and both
#   launchers fail before serving traffic. `rollback`, `backups`, `tls` and
#   `trust` likewise stay untouched except for the specific targets named below.
#
#   The governed deploy already locks down `$gateTargetDir` and `$trustRootDir`
#   (deploy-hermes-runtime.ps1 L804-817) but only *verifies* the two launcher
#   files; this helper closes that gap by hardening the launcher files too.
#
# WHAT IT GRANTS: SYSTEM and Administrators FullControl (sanctioned repairs),
# BUILTIN\Users ReadAndExecute. The door runs RunLevel=Limited, so its token
# carries no Administrators Allow ACE -- Users read-only is therefore exactly
# "can execute the door, cannot rewrite its anchors".
#
# It does NOT change the verifier's semantics, bypass it, or disable it.
# ==============================================================================

function Protect-WilliamOSDoorArtifact {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Path,
    # ContainerInherit|ObjectInherit on a DIRECTORY so a file later dropped inside it
    # cannot come back loose; None on files so protection never reaches siblings.
    [switch]$Directory
  )
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  $acl = Get-Acl -LiteralPath $Path
  # Stop inheriting first, so parent ACEs cannot flow back in, then rebuild explicitly.
  $acl.SetAccessRuleProtection($true, $false)
  @($acl.Access) | ForEach-Object { $null = $acl.RemoveAccessRule($_) }
  $inherit = if ($Directory) { 'ContainerInherit, ObjectInherit' } else { 'None' }
  foreach ($grant in @(
      @{ Id = 'NT AUTHORITY\SYSTEM';    Rights = 'FullControl' },
      @{ Id = 'BUILTIN\Administrators'; Rights = 'FullControl' },
      @{ Id = 'BUILTIN\Users';          Rights = 'ReadAndExecute' }
    )) {
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
        $grant.Id, $grant.Rights, $inherit, 'None', 'Allow')))
  }
  Set-Acl -LiteralPath $Path -AclObject $acl
  # Anything under ProgramData\WilliamOS also needs a trusted (administrator) owner.
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
  It hardens the four anchors the gate probes, the two launcher files the door
  executes, the gate directory and the trust ring root -- so a subsequent boot
  does not fail closed on a newly-inherited writable ACE -- while leaving the
  install root and its mutable subtrees (logs in particular) writable.
#>
function Protect-WilliamOSDoor {
  [CmdletBinding()]
  param([string]$InstallRoot = "C:\ProgramData\WilliamOS")

  $gateDir    = Join-Path $InstallRoot "scripts\hermes-bridge"
  $trustDir   = Join-Path $InstallRoot "trust"

  $anchors = @(
    (Join-Path $gateDir "verify-door-provenance.mjs"),
    (Join-Path $gateDir "attest-deployment.mjs"),
    (Join-Path $gateDir "deployment-attestation-keys.json"),
    (Join-Path $gateDir "integrations.json"),
    (Join-Path $trustDir "deployment-attestation-key.json")
  )
  $launchers = @(
    (Join-Path $InstallRoot "start-williamos-live.ps1"),
    (Join-Path $InstallRoot "start-williamos-https.ps1")
  )

  $protected = @()
  foreach ($f in ($anchors + $launchers)) {
    if (Protect-WilliamOSDoorArtifact -Path $f) { $protected += $f }
  }
  foreach ($d in @($gateDir, $trustDir)) {
    if (Protect-WilliamOSDoorArtifact -Path $d -Directory) { $protected += $d }
  }
  # Emit ONLY the path list: a second pipeline object here would be captured alongside the array by
  # any caller that assigns the result, and the array would silently become object[] instead of a list.
  Write-Verbose ("DOOR_ARTIFACTS_PROTECTED " + $protected.Count + " paths")
  return $protected
}
