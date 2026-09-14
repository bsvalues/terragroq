<#
.SYNOPSIS
  Restore one rollback captured by deploy-hermes-runtime.ps1 and prove both WilliamOS listeners.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$RollbackRoot,
  [string]$Runtime = "C:\HermesLab\williamos-runtime-64034e93-flat",
  [string]$TaskName = "WilliamOS Live",
  [string]$HttpsTaskName = "WilliamOS HTTPS",
  [string]$LiveStartTarget = "C:\ProgramData\WilliamOS\start-williamos-live.ps1",
  [string]$ReceiptTarget = "C:\ProgramData\WilliamOS\scripts\hermes-bridge\deployment-attestation.json",
  [string]$HttpsStartTarget = "C:\ProgramData\WilliamOS\start-williamos-https.ps1",
  [int]$Port = 3100,
  [int]$HttpsPort = 3443
)

$ErrorActionPreference = "Stop"
# #1223 R4: rollback re-attests the restored bytes under the admin-only trust key; an unprivileged
# run cannot read it — and must not be able to mint attestations anyway. Elevation is required.
$restoreIdentity = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $restoreIdentity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "#1223: restoring the door runtime must run ELEVATED (it re-attests and re-seals the restored generation)."
}
$HermesLanAddress = "192.168.88.9"
$HermesOverlayAddress = "100.97.194.84"

# The deployed HERMES proxy and its authenticated origin are one canonical 3443 -> 3100 boundary.
# Refuse misleading probe/listener overrides before validating or mutating a rollback.
if ($Port -ne 3100 -or $HttpsPort -ne 3443) {
  throw "WilliamOS HERMES uses the canonical HTTP/HTTPS ports 3100/3443; port overrides are not supported"
}

function Stop-ExpectedListener {
  param([int]$ListenerPort, [string]$ExpectedCommandPath)
  $expectedPath = [IO.Path]::GetFullPath($ExpectedCommandPath).TrimEnd('\')
  $ownerProcessIds = @(Get-NetTCPConnection -LocalPort $ListenerPort -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($ownerProcessId in $ownerProcessIds) {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerProcessId"
      $pathMatched = $false
      if ($process -and $process.CommandLine) {
        $tokens = @([regex]::Matches($process.CommandLine, '(?:"([^"]*)"|''([^'']*)''|(\S+))') | ForEach-Object {
          @($_.Groups[1].Value, $_.Groups[2].Value, $_.Groups[3].Value) |
            Where-Object { $_ } | Select-Object -First 1
        })
        if ($tokens.Count -ge 2 -and [IO.Path]::GetFileName($tokens[0]) -ieq "node.exe") {
          try {
            $pathMatched = [IO.Path]::GetFullPath($tokens[1]).TrimEnd('\') -ieq $expectedPath
          } catch { }
        }
      }
      if (-not $pathMatched) {
        throw "Port $ListenerPort is owned by an unrelated process; refusing to stop it during WilliamOS rollback"
      }
      Stop-Process -Id $process.ProcessId -Force
  }
}

function Get-CurrentLegacyRelayState {
  $rows = @(netsh interface portproxy show v4tov4 2>&1 | ForEach-Object { $_.ToString() })
  $pattern = "^\s*$([regex]::Escape($HermesOverlayAddress))\s+$HttpsPort\s+(\S+)\s+(\d+)\s*$"
  $matches = @($rows | Select-String -Pattern $pattern)
  if ($matches.Count -gt 1) { throw "Multiple portproxy records claim ${HermesOverlayAddress}:$HttpsPort; refusing rollback before stopping production" }
  if ($matches.Count -eq 0) { return [pscustomobject]@{ wasPresent = $false } }
  $targetAddress = $matches[0].Matches[0].Groups[1].Value
  $targetPort = [int]$matches[0].Matches[0].Groups[2].Value
  if ($targetAddress -ne $HermesLanAddress -or $targetPort -ne $HttpsPort) {
    throw "${HermesOverlayAddress}:$HttpsPort is owned by an unrelated portproxy target ${targetAddress}:$targetPort; refusing rollback before stopping production"
  }
  return [pscustomobject]@{ wasPresent = $true }
}

function Remove-CurrentLegacyRelay {
  netsh interface portproxy delete v4tov4 listenaddress=$HermesOverlayAddress listenport=$HttpsPort 2>&1 | Out-Null
  if ((Get-CurrentLegacyRelayState).wasPresent) {
    throw "The exact current legacy cockpit relay still owns ${HermesOverlayAddress}:$HttpsPort after deletion"
  }
}

if (-not (Test-Path -LiteralPath $RollbackRoot -PathType Container)) {
  throw "Rollback directory does not exist: $RollbackRoot"
}

function Assert-LauncherMutationAccess {
  param([string]$TargetPath, [bool]$WillBePresent)

  if (Test-Path -LiteralPath $TargetPath -PathType Leaf) {
    if ($WillBePresent) {
      $stream = $null
      try {
        $stream = [IO.File]::Open($TargetPath, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite)
      } catch {
        throw "The WilliamOS Live launcher '$TargetPath' cannot be replaced by this process. Run rollback from an elevated administrator shell; refusing before stopping production."
      } finally {
        if ($stream) { $stream.Dispose() }
      }
      return
    }

    if (-not ("WilliamOS.LauncherAccessNative" -as [type])) {
      Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
namespace WilliamOS {
  public static class LauncherAccessNative {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern SafeFileHandle CreateFile(
      string fileName, uint desiredAccess, uint shareMode, IntPtr securityAttributes,
      uint creationDisposition, uint flagsAndAttributes, IntPtr templateFile);
  }
}
"@
    }
    $deleteAccess = [uint32]0x00010000
    $shareReadWriteDelete = [uint32]0x00000007
    $openExisting = [uint32]3
    $handle = [WilliamOS.LauncherAccessNative]::CreateFile(
      $TargetPath, $deleteAccess, $shareReadWriteDelete, [IntPtr]::Zero,
      $openExisting, 0, [IntPtr]::Zero)
    if ($handle.IsInvalid) {
      $nativeError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      $handle.Dispose()
      throw "The WilliamOS Live launcher '$TargetPath' cannot be removed by this process (Win32 $nativeError). Run rollback from an elevated administrator shell; refusing before stopping production."
    }
    $handle.Dispose()
    return
  }

  if (-not $WillBePresent) { return }
  $parent = Split-Path -Parent $TargetPath
  if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
    throw "The WilliamOS Live launcher directory '$parent' does not exist. Create it with administrator ownership before rollback; refusing before stopping production."
  }
  $probe = Join-Path $parent (".williamos-rollback-write-probe-{0}.tmp" -f [guid]::NewGuid().ToString("N"))
  $stream = $null
  try {
    $stream = [IO.File]::Open($probe, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None, 1, [IO.FileOptions]::DeleteOnClose)
  } catch {
    throw "The WilliamOS Live launcher directory '$parent' is not writable by this process. Run rollback from an elevated administrator shell; refusing before stopping production."
  } finally {
    if ($stream) { $stream.Dispose() }
    Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
  }
}
$manifestPath = Join-Path $RollbackRoot "rollback-manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "Rollback is incomplete: $manifestPath is missing"
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$manifestVersion = [int]$manifest.version
if (($manifestVersion -ne 6 -and $manifestVersion -ne 7 -and $manifestVersion -ne 8) -or $null -eq $manifest.withDependencies -or $null -eq $manifest.directories -or $null -eq $manifest.files -or $null -eq $manifest.liveStart) {
  throw "Rollback manifest is invalid: $manifestPath"
}
if ($null -eq $manifest.legacyRelay -or $null -eq $manifest.legacyRelay.wasPresent `
  -or [string]$manifest.legacyRelay.listenAddress -ne $HermesOverlayAddress `
  -or [int]$manifest.legacyRelay.listenPort -ne $HttpsPort `
  -or [string]$manifest.legacyRelay.connectAddress -ne $HermesLanAddress `
  -or [int]$manifest.legacyRelay.connectPort -ne $HttpsPort) {
  throw "Rollback manifest does not name the exact legacy cockpit relay boundary"
}
$overlayRestoreMode = [string]$manifest.overlayRestoreMode
if ($overlayRestoreMode -notin @("direct", "legacy-relay", "compatibility-relay")) {
  throw "Rollback manifest does not name a supported overlay restore mode"
}
$rollbackProxyPath = Join-Path $RollbackRoot "scripts\hermes-https-proxy.mjs"
$rollbackProxyText = if (Test-Path -LiteralPath $rollbackProxyPath -PathType Leaf) {
  Get-Content -LiteralPath $rollbackProxyPath -Raw
} else { "" }
$rollbackProxySupportsNativeOverlay = [bool]($rollbackProxyText -match 'startListener\(HERMES_HTTPS_OVERLAY_HOST,\s*\{\s*required:\s*false\s*\}\)')
if (($overlayRestoreMode -eq "direct" -and -not $rollbackProxySupportsNativeOverlay) `
  -or ($overlayRestoreMode -eq "legacy-relay" -and -not [bool]$manifest.legacyRelay.wasPresent) `
  -or ($overlayRestoreMode -eq "compatibility-relay" -and ([bool]$manifest.legacyRelay.wasPresent -or $rollbackProxySupportsNativeOverlay))) {
  throw "Rollback manifest overlay mode contradicts the captured proxy and relay state"
}

function Get-PhysicalVolumeIdentity {
  param([Parameter(Mandatory = $true)][string]$Path)
  $resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
  $volumes = @(Get-Volume -FilePath $resolved -ErrorAction Stop)
  if ($volumes.Count -ne 1 -or -not $volumes[0].UniqueId) {
    throw "Cannot prove the physical volume identity for '$resolved'"
  }
  return [string]$volumes[0].UniqueId
}
$expectedRollbackFiles = @(
  "server.js",
  "package.json",
  "lib\generated\build-provenance.json",
  "scripts\hermes-https-proxy.mjs",
  "scripts\fabric\resolve-authority-registry-url.mjs"
)
if ($manifestVersion -ge 4) { $expectedRollbackFiles += "pnpm-lock.yaml" }
# v8 captures the signed deployment manifest so the restored generation's provenance, manifest and
# receipt are one consistent set again — without it the gate would deny the rolled-back door.
if ($manifestVersion -ge 8) { $expectedRollbackFiles += "lib\generated\deployment-manifest.json" }
$manifestPaths = @($manifest.files | ForEach-Object { [string]$_.path })
if (@(Compare-Object -ReferenceObject $expectedRollbackFiles -DifferenceObject $manifestPaths).Count -ne 0) {
  throw "Rollback manifest does not name the exact runtime file set"
}
# v7 added the four request-time loose trees (deploy now /MIRs them). The directory-set check is
# version-gated exactly like the v4 node_modules/pnpm-lock carve-outs: a v6 manifest from before
# that change stays restorable (today's captures included — an un-gated seven-tree check would
# reject them), and a v7 manifest must name the exact seven-tree set.
$expectedRollbackDirectories = @(".next", "public", "lib\fabric")
if ($manifestVersion -ge 7) {
  $expectedRollbackDirectories += @("scripts\execution-fabric", "scripts\multi-agent-operator",
    "components\operator", "config\execution-fabric")
}
if ([bool]$manifest.withDependencies) { $expectedRollbackDirectories += "node_modules" }
$manifestDirectoryPaths = @($manifest.directories | ForEach-Object { [string]$_.path })
if (@(Compare-Object -ReferenceObject $expectedRollbackDirectories -DifferenceObject $manifestDirectoryPaths).Count -ne 0) {
  throw "Rollback manifest does not name the exact runtime directory set"
}
foreach ($entry in $manifest.directories) {
  if (-not $entry.path -or $null -eq $entry.wasPresent) { throw "Rollback manifest has an invalid directory entry" }
  if ($entry.wasPresent -and -not (Test-Path -LiteralPath (Join-Path $RollbackRoot $entry.path) -PathType Container)) {
    throw "Rollback is incomplete: $(Join-Path $RollbackRoot $entry.path) is missing"
  }
}
foreach ($entry in $manifest.files) {
  if (-not $entry.path -or $null -eq $entry.wasPresent) { throw "Rollback manifest has an invalid file entry" }
  if ($entry.wasPresent -and -not (Test-Path -LiteralPath (Join-Path $RollbackRoot $entry.path) -PathType Leaf)) {
    throw "Rollback is incomplete: $(Join-Path $RollbackRoot $entry.path) is missing"
  }
}
$expectedLiveStartBackup = "external\start-williamos-live.ps1"
if (([string]$manifest.liveStart.target -ne $LiveStartTarget) -or ([string]$manifest.liveStart.backupPath -ne $expectedLiveStartBackup) -or ($null -eq $manifest.liveStart.wasPresent)) {
  throw "Rollback manifest does not name the exact WilliamOS Live start definition"
}
$liveStartRollbackFile = Join-Path $RollbackRoot $expectedLiveStartBackup
if ($manifest.liveStart.wasPresent -and -not (Test-Path -LiteralPath $liveStartRollbackFile -PathType Leaf)) {
  throw "Rollback is incomplete: $liveStartRollbackFile is missing"
}
Assert-LauncherMutationAccess -TargetPath $LiveStartTarget -WillBePresent ([bool]$manifest.liveStart.wasPresent)
# #1223: deploys at/after the provenance gate capture the HTTPS launcher too; when the capture
# names it, restoring must replace it, or rollback silently reinstalls a gateless :3443 boot.
$httpsStartWasCaptured = ($null -ne $manifest.httpsStart)
if ($httpsStartWasCaptured) {
  $expectedHttpsStartBackup = "external\start-williamos-https.ps1"
  if (([string]$manifest.httpsStart.target -ne $HttpsStartTarget) -or ([string]$manifest.httpsStart.backupPath -ne $expectedHttpsStartBackup) -or ($null -eq $manifest.httpsStart.wasPresent)) {
    throw "Rollback manifest does not name the exact WilliamOS HTTPS start definition"
  }
  $httpsStartRollbackFile = Join-Path $RollbackRoot $expectedHttpsStartBackup
  if ($manifest.httpsStart.wasPresent -and -not (Test-Path -LiteralPath $httpsStartRollbackFile -PathType Leaf)) {
    throw "Rollback is incomplete: $httpsStartRollbackFile is missing"
  }
  Assert-LauncherMutationAccess -TargetPath $HttpsStartTarget -WillBePresent ([bool]$manifest.httpsStart.wasPresent)
}
# #1223 R2: deploys with the provenance gate capture the trusted gate directory; roll it back
# alongside the launchers. Captures without the member (pre-gate v7) restore as before.
$trustDirCaptured = ($null -ne $manifest.trustDir)
if ($trustDirCaptured) {
  $expectedTrustDirBackup = "external\scripts-hermes-bridge"
  if (([string]$manifest.trustDir.backupPath -ne $expectedTrustDirBackup) -or ($null -eq $manifest.trustDir.wasPresent)) {
    throw "Rollback manifest trustDir record is malformed"
  }
}
$currentLegacyRelay = Get-CurrentLegacyRelayState

$v4ModuleEntry = @()
if ($manifestVersion -ge 4 -and [bool]$manifest.withDependencies) {
  $v4ModuleEntry = @($manifest.directories | Where-Object { $_.path -eq "node_modules" })
  if ($v4ModuleEntry.Count -ne 1) { throw "Rollback manifest has no unique node_modules transfer record" }
  if ([bool]$v4ModuleEntry[0].wasPresent) {
    $rollbackModules = Join-Path $RollbackRoot "node_modules"
    if ((Get-PhysicalVolumeIdentity -Path $rollbackModules) -ne (Get-PhysicalVolumeIdentity -Path $Runtime)) {
      throw "The rollback dependency tree and runtime are on different physical volumes; refusing to remove or replace the running graph"
    }
  }
}

Stop-ScheduledTask -TaskName $HttpsTaskName -ErrorAction SilentlyContinue
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
if ($currentLegacyRelay.wasPresent) { Remove-CurrentLegacyRelay }
Stop-ExpectedListener -ListenerPort $Port -ExpectedCommandPath (Join-Path $Runtime "server.js")
Stop-ExpectedListener -ListenerPort $HttpsPort -ExpectedCommandPath (Join-Path $Runtime "scripts\hermes-https-proxy.mjs")
Start-Sleep -Seconds 2

foreach ($entry in $manifest.directories) {
  if ($manifestVersion -ge 4 -and $entry.path -eq "node_modules") { continue }
  $source = Join-Path $RollbackRoot $entry.path
  $target = Join-Path $Runtime $entry.path
  if ($entry.wasPresent) {
    $null = robocopy $source $target /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP
    if ($LASTEXITCODE -ge 8) { throw "rollback failed copying $($entry.path) (exit $LASTEXITCODE)" }
  } elseif (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
  }
}

foreach ($entry in $manifest.files) {
  $source = Join-Path $RollbackRoot $entry.path
  $target = Join-Path $Runtime $entry.path
  if ($entry.wasPresent) {
    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force
    Copy-Item -LiteralPath $source -Destination $target -Force
  } elseif (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Force
  }
}
if ($manifestVersion -ge 4 -and [bool]$manifest.withDependencies) {
  $runtimeModules = Join-Path $Runtime "node_modules"
  $heldModules = Join-Path (Split-Path -Parent $Runtime) (".williamos-rollback-current-{0}" -f [guid]::NewGuid().ToString("N"))
  if (Test-Path -LiteralPath $runtimeModules -PathType Container) {
    Move-Item -LiteralPath $runtimeModules -Destination $heldModules
  }
  try {
    if ([bool]$v4ModuleEntry[0].wasPresent) {
      Move-Item -LiteralPath (Join-Path $RollbackRoot "node_modules") -Destination $runtimeModules
    }
  } catch {
    if ((Test-Path -LiteralPath $heldModules -PathType Container) -and -not (Test-Path -LiteralPath $runtimeModules)) {
      Move-Item -LiteralPath $heldModules -Destination $runtimeModules
    }
    throw
  }
  if (Test-Path -LiteralPath $heldModules -PathType Container) {
    Remove-Item -LiteralPath $heldModules -Recurse -Force
  }
}
if ($manifest.liveStart.wasPresent) {
  $null = New-Item -ItemType Directory -Path (Split-Path -Parent $LiveStartTarget) -Force
  Copy-Item -LiteralPath $liveStartRollbackFile -Destination $LiveStartTarget -Force
} elseif (Test-Path -LiteralPath $LiveStartTarget -PathType Leaf) {
  Remove-Item -LiteralPath $LiveStartTarget -Force
}
if ($httpsStartWasCaptured) {
  if ($manifest.httpsStart.wasPresent) {
    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $HttpsStartTarget) -Force
    Copy-Item -LiteralPath $httpsStartRollbackFile -Destination $HttpsStartTarget -Force
  } elseif (Test-Path -LiteralPath $HttpsStartTarget -PathType Leaf) {
    Remove-Item -LiteralPath $HttpsStartTarget -Force
  }
}
if ($trustDirCaptured) {
  $trustDirTarget = [string]$manifest.trustDir.target
  $trustDirRollback = Join-Path $RollbackRoot "external\scripts-hermes-bridge"
  if ($manifest.trustDir.wasPresent) {
    if (-not (Test-Path -LiteralPath $trustDirRollback -PathType Container)) {
      throw "Rollback is incomplete: $trustDirRollback is missing"
    }
    $null = robocopy $trustDirRollback $trustDirTarget /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP
    if ($LASTEXITCODE -ge 8) { throw "rollback of the trusted gate directory failed (exit $LASTEXITCODE)" }
  } elseif (Test-Path -LiteralPath $trustDirTarget -PathType Container) {
    Remove-Item -LiteralPath $trustDirTarget -Recurse -Force
  }
}

# #1223 R4: a rollback must leave a door that can BOOT. The restored bytes differ from whatever
# generation last ran, so re-attest the restored tree and re-seal the receipt with the same trust
# key BEFORE starting; otherwise the gate denies its own rolled-back door (MAJOR finding).
$gateRestoreDir = if ($trustDirCaptured -and $manifest.trustDir.wasPresent) {
  [string]$manifest.trustDir.target
} else {
  Join-Path (Split-Path -Parent $LiveStartTarget) "scripts\hermes-bridge"
}
if (Test-Path -LiteralPath (Join-Path $gateRestoreDir "attest-deployment.mjs") -PathType Leaf) {
  $attestCli = Join-Path $gateRestoreDir "attest-deployment.mjs"
  $restoredProvenance = Get-Content -Raw -LiteralPath (Join-Path $Runtime "lib\generated\build-provenance.json") | ConvertFrom-Json
  if (-not $restoredProvenance.sha) { throw "Restored build-provenance.json carries no sha; refusing to attest an anonymous artifact." }
  $nodeExe = "C:\Program Files\nodejs\node.exe"
  & $nodeExe $attestCli attest --app-root="$Runtime" --sha="$($restoredProvenance.sha)" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "post-rollback attestation FAILED (exit $LASTEXITCODE): the restored runtime cannot be proven bootable." }
  & $nodeExe $attestCli seal --app-root="$Runtime" --target="$ReceiptTarget" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "post-rollback seal FAILED (exit $LASTEXITCODE): refusing to start a door attested only inside itself." }
  $null = icacls $ReceiptTarget /inheritance:r /grant:r "SYSTEM:F" "BUILTIN\Administrators:F" "BUILTIN\Users:R" 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Failed to lock down the seal receipt (exit $LASTEXITCODE)." }
  # R5: robocopy re-created these files with the restore runner as owner; a non-admin owner keeps
  # implicit WRITE_DAC and can rewrite the ACL, so re-hand the anchors to BUILTIN\Administrators
  # and refuse to start the door when that did not work (restore must run elevated too).
  foreach ($anchor in @($ReceiptTarget, (Join-Path $gateRestoreDir "verify-door-provenance.mjs"), (Join-Path $gateRestoreDir "attest-deployment.mjs"), (Join-Path $gateRestoreDir "deployment-attestation-keys.json"), (Join-Path $gateRestoreDir "integrations.json"))) {
    if (Test-Path -LiteralPath $anchor -PathType Leaf) {
      $null = icacls $anchor /setowner "BUILTIN\\Administrators" 2>&1
      if ($LASTEXITCODE -ne 0) { throw "Failed to set owner BUILTIN\Administrators on restored anchor $anchor (exit $LASTEXITCODE); refusing to boot a door on attacker-reclaimable anchors." }
    }
  }
  Write-Output "restored generation re-attested and sealed"
}

# #1223 R6 (BLOCKING B6-2): the scheduled-task DEFINITION is part of the boot path. The R5 audit
# found "WilliamOS Live" owned by the door identity with Users:(I)(F), so that identity could rewrite
# the action and repoint the scheduled restart at its own script — a route the gate never sees. Lock
# both definitions to SYSTEM/Administrators and hand ownership to Administrators (elevated).
foreach ($taskName in @($TaskName, $HttpsTaskName)) {
  $taskXml = Join-Path -Path $env:windir -ChildPath "System32\Tasks\$taskName"
  if (-not (Test-Path -LiteralPath $taskXml)) { throw "Task definition not found for $taskName at $taskXml" }
  $null = icacls $taskXml /inheritance:r /grant:r "SYSTEM:(F)" "BUILTIN\Administrators:(F)" "BUILTIN\Users:(R)" 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Failed to lock the task definition ACL for $taskName (icacls exit $LASTEXITCODE)" }
  $null = icacls $taskXml /setowner "BUILTIN\Administrators" 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Failed to set the owner of task definition $taskName (icacls exit $LASTEXITCODE; elevation is required)" }
  $taskOwner = (Get-Acl -LiteralPath $taskXml).Owner
  if ($taskOwner -ne "BUILTIN\Administrators") { throw "Task definition $taskName is owned by $taskOwner after setowner; refusing to start the door on a rewritable boot route (#1223)" }
  Write-Host "BOOT_ROUTE_LOCKED $taskName owner=$taskOwner"
}

Start-ScheduledTask -TaskName $TaskName
$deadline = (Get-Date).AddSeconds(300)
do {
  try {
    $health = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 10
    if ($health.StatusCode -eq 200) { break }
  } catch {}
  Start-Sleep -Seconds 3
} while ((Get-Date) -lt $deadline)
if (-not $health -or $health.StatusCode -ne 200) { throw "Restored WilliamOS did not become healthy on port $Port" }

Start-ScheduledTask -TaskName $HttpsTaskName
$deadline = (Get-Date).AddSeconds(60)
do {
  try {
    $httpsHealth = Invoke-WebRequest -Uri "https://192.168.88.9:$HttpsPort/api/health" -UseBasicParsing -TimeoutSec 10
    if ($httpsHealth.StatusCode -eq 200) { break }
  } catch {}
  Start-Sleep -Seconds 3
} while ((Get-Date) -lt $deadline)
if (-not $httpsHealth -or $httpsHealth.StatusCode -ne 200) { throw "Restored WilliamOS HTTPS origin did not become healthy on port $HttpsPort" }

if ($overlayRestoreMode -in @("legacy-relay", "compatibility-relay")) {
  netsh interface portproxy add v4tov4 listenaddress=$HermesOverlayAddress listenport=$HttpsPort `
    connectaddress=$HermesLanAddress connectport=$HttpsPort 2>&1 | Out-Null
  $relayPattern = "^\s*$([regex]::Escape($HermesOverlayAddress))\s+$HttpsPort\s+$([regex]::Escape($HermesLanAddress))\s+$HttpsPort\s*$"
  $relay = @(netsh interface portproxy show v4tov4) -match $relayPattern
  if (-not $relay) { throw "Restored runtime is healthy on LAN, but its required overlay relay could not be restored" }
}

$canonicalReady = $false
$deadline = (Get-Date).AddSeconds(60)
do {
  & "$env:SystemRoot\System32\curl.exe" --fail --silent --show-error --ssl-revoke-best-effort --max-time 10 `
    --resolve "williamos.lan:${HttpsPort}:$HermesOverlayAddress" "https://williamos.lan:$HttpsPort/api/health" | Out-Null
  if ($LASTEXITCODE -eq 0) { $canonicalReady = $true; break }
  Start-Sleep -Seconds 3
} while ((Get-Date) -lt $deadline)
if (-not $canonicalReady) { throw "Restored WilliamOS did not answer through the canonical williamos.lan overlay route" }

Write-Output "restored and verified: $RollbackRoot"
