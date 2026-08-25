# Cross-node backup sync (runs on Hermes). Copies each node's local backups to the OTHER node.
# Non-destructive: never deletes source backups, never touches containers. 14-day retention on copies.
#
# ---------------------------------------------------------------------------------------------
# WHERE THIS SCRIPT WAS POINTING, AND WHY BOTH ENDS OF IT WERE WRONG AT ONCE
#
# On 2026-08-24 HermesCrossNodeBackupSync began failing with lastResult=1 and it has failed every
# night since. This script named its destination F:\lab-backups\crossnode and named its peer
# bs@192.168.88.5, and by 2026-08-25 neither of those named the thing it was written for:
#
#   * F: STOPPED EXISTING. The 931 GB NVMe that carried it is lettered G: now -- Get-Volume
#     -DriveLetter F returns nothing on HERMES. The archive itself never moved: every backup this
#     script has ever written is sitting at G:\lab-backups\crossnode, under the disk's new letter.
#   * ATLAS STOPPED BEING AT .5. Its DHCP lease moved to 192.168.88.8 on the 2026-08-25 power
#     cycle, and 192.168.88.5 is now held by another device entirely. Measured the same day:
#     192.168.88.5 does not answer ping from HERMES at all.
#
# Failing loudly was the mercy in this. The dangerous shape is the other one: New-Item -Force
# would have cheerfully built a fresh, empty archive tree on whatever F: became -- a USB stick,
# say -- and every run after that would have reported success while protecting nothing. That is
# precisely the failure the 2026-08-18 backup recovery existed to end, and it is why the repair
# below is "resolve, then refuse", never "resolve, then fall back".
#
# So nothing here is written down any more:
#
#   * The archive is resolved by the VOLUME LABEL HERMES_NVME, the way backup-volumes.ps1 has
#     since 2026-08-24. A letter is an assignment; a label travels with the disk.
#   * ATLAS is resolved from the fabric registry nodes.json, the way sync-models-to-forge.ps1
#     has since #1006. That file is the one place in this lab allowed to know where a node is.
#   * The SSH IDENTITY is resolved with it -- and this is the half that is easy to miss. The old
#     code leaned on the calling account's ~/.ssh, whose known_hosts pins 192.168.88.5 and has
#     never seen 192.168.88.8. Repairing only the address would have swapped a red task for a red
#     task: measured on HERMES 2026-08-25, ssh bs@192.168.88.8 under the default identity exits
#     255 with "Host key verification failed". The fabric known_hosts carries the pinned ed25519
#     key that was proven byte-identical across ATLAS's move, so that is the store this now uses,
#     with StrictHostKeyChecking=yes left on: if the registry is ever wrong, a refused connection
#     is the right outcome, not a backup handed to a stranger.
#
# What did NOT change: the direction of travel, the freshness guard, the manifest cross-check, the
# 14-day retention, and the receipt/evidence publication sequence. This is a repair to where the
# script points, not to what it does.
#
# NO .ps1 IN THIS REPOSITORY RUNS IN CI -- .github/workflows/ci.yml runs vitest over
# tests/**/*.test.{ts,tsx} and nothing else. The pure parts of the repair are covered by
# test-crossnode-sync-receipt.ps1, and the parts that touch real hardware are covered by live
# controls run on HERMES and recorded in the lane's evidence. Those runs ARE the test suite here.
# ---------------------------------------------------------------------------------------------
[CmdletBinding()]
param(
    # Resolve the archive volume, the ATLAS endpoint and the transport identity, print them, then
    # stop. No ssh, no scp, no directory created, nothing written on either side. This is what lets
    # the resolution be proven on real hardware separately from a transfer that moves 200 MB.
    [switch]$ResolveOnly,
    # Overridable ONLY so the refusals can be exercised. A guard with no negative test is a guard
    # nobody has seen refuse, and the 2026-08-18 recovery was full of those.
    [string]$ArchiveVolumeLabel = 'HERMES_NVME',
    [string]$FabricRoot = "$env:USERPROFILE\.williamos\fabric"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\crossnode-sync-lib.ps1"

# --- Preflight resolution -------------------------------------------------------------------
# Deliberately OUTSIDE the main try/catch, and deliberately not routed through
# Format-CrossNodeSyncFailure. That formatter exists to sanitize native stderr down to a code,
# which is right for a failure mid-transfer and wrong here: these messages are ours, they say which
# thing could not be resolved and what to do about it, and throwing that detail away would leave an
# operator with code=NATIVE_COMMAND_FAILED and no idea that a disk was simply not plugged in.
# Nothing has been created or contacted at this point, so there is nothing to unwind either.
try {
    $archiveRoot = Resolve-ArchiveRoot -Label $ArchiveVolumeLabel
    $atlas = Resolve-AtlasEndpoint -Fabric $FabricRoot
    $fabricIdentity = Resolve-FabricSshIdentity -Fabric $FabricRoot
} catch {
    $resolutionMessage = [string]$_.Exception.Message
    $resolutionCode = 'RESOLUTION_REFUSED'
    if ($resolutionMessage -match '^(ARCHIVE_VOLUME_ABSENT|ARCHIVE_VOLUME_AMBIGUOUS|FABRIC_REGISTRY_UNREADABLE|FABRIC_REGISTRY_INCOMPLETE|FABRIC_IDENTITY_UNREADABLE)(?:\s|$)') {
        $resolutionCode = $matches[1]
    }
    Write-Error "CROSSNODE_SYNC_FAILED code=$resolutionCode stage=PREFLIGHT_RESOLUTION $resolutionMessage"
    exit 1
}
$sshOptions = @($fabricIdentity.SshOptions)

$crossnodeRoot = Join-Path $archiveRoot 'lab-backups\crossnode'
$atlasToHermes = Join-Path $crossnodeRoot 'atlas'
$atlasNightlyRoot = '/forge/backups/nightly'
$staleSourceHours = 36
$hermesSource = Join-Path $archiveRoot 'lab-backups\hermes-volumes'
$hermesTaskEvidencePath = Join-Path $crossnodeRoot 'crossnode-sync-task-evidence.json'
$atlasReceiptPath = '/home/bs/from-hermes/crossnode-sync-receipt.json'
$startedAt = [datetime]::UtcNow
$runId = [guid]::NewGuid().ToString('D').ToLowerInvariant()
$failureCode = 'NATIVE_COMMAND_FAILED'
$hermesReceiptTransportPath = Join-Path $crossnodeRoot ".crossnode-sync-receipt.$runId.transport.tmp"
$atlasReceiptTemporaryPath = "$atlasReceiptPath.$runId.tmp"

if ($ResolveOnly) {
    # $hermesSource is reported but not required to exist: the Hermes->Atlas leg legitimately has
    # nothing to send on a machine that has not run backup-volumes.ps1 yet, and this switch is a
    # report of what was resolved, not a second set of guards.
    [pscustomobject][ordered]@{
        archiveVolumeLabel     = $ArchiveVolumeLabel
        archiveRoot            = $archiveRoot
        crossnodeRoot          = $crossnodeRoot
        atlasToHermes          = $atlasToHermes
        atlasToHermesExists    = (Test-Path -LiteralPath $atlasToHermes)
        hermesSource           = $hermesSource
        hermesSourceExists     = (Test-Path -LiteralPath $hermesSource)
        hermesSourceArchives   = @(Get-ChildItem -LiteralPath $hermesSource -File -Filter '*.tar.gz' -ErrorAction SilentlyContinue).Count
        hermesTaskEvidencePath = $hermesTaskEvidencePath
        fabricRoot             = $FabricRoot
        atlas                  = $atlas
        atlasNightlyRoot       = $atlasNightlyRoot
        sshKeyPath             = $fabricIdentity.KeyPath
        knownHostsPath         = $fabricIdentity.KnownHostsPath
    } | ConvertTo-Json -Compress
    exit 0
}
try {
    New-Item -ItemType Directory -Force -Path $atlasToHermes | Out-Null

    # --- Atlas verified nightly -> Hermes ---
    # Atlas no longer writes a flat /home/bs/backups/*.tar.gz set of live-volume tars; it writes
    # verified logical dumps to /forge/backups/nightly/<stamp>/. Continuing to copy the old flat
    # directory would still report success while replicating a set nothing writes any more -- the
    # precise failure this system exists to catch.
    $stampLines = @(Invoke-CheckedNative -FilePath 'ssh' -ArgumentList (@($sshOptions) + @(
        $atlas,
        (ConvertTo-ShellSafePosixCommand -Script ("ls -1 " + $atlasNightlyRoot + " 2>/dev/null"))
    )))
    $stamp = @($stampLines | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ -match '^\d{8}_\d{6}$' } | Sort-Object)[-1]
    if (-not $stamp) { throw 'MANIFEST_MISMATCH no Atlas nightly run directory found' }

    # A stale source must fail. Replicating last week's backup every night and reporting success is
    # indistinguishable from working, right up until the day it is needed.
    # Atlas names its run directories in UTC. Parsing them as local time made every stamp look up to
    # a timezone-offset into the FUTURE, so the staleness comparison could never trip -- a negative
    # test caught this returning success with the freshness window set to zero hours. Parse as UTC and
    # compare against UtcNow, or the guard is decoration.
    $stampTime = [datetime]::MinValue
    $utcStyles = [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal
    if (-not [datetime]::TryParseExact($stamp, 'yyyyMMdd_HHmmss', [Globalization.CultureInfo]::InvariantCulture, $utcStyles, [ref]$stampTime)) {
        throw "MANIFEST_MISMATCH unparseable Atlas nightly stamp=$stamp"
    }
    $nowUtc = [datetime]::UtcNow
    if ($stampTime -lt $nowUtc.AddHours(-$staleSourceHours)) {
        throw "MANIFEST_MISMATCH stale Atlas nightly source stamp=$stamp ageHours=$([int]($nowUtc - $stampTime).TotalHours) windowHours=$staleSourceHours"
    }
    # A stamp ahead of now is not fresher-than-fresh, it is a clock or naming fault, and it would let a
    # frozen source pass forever. Small skew is tolerated; a future-dated run is refused.
    if ($stampTime -gt $nowUtc.AddMinutes(10)) {
        throw "MANIFEST_MISMATCH Atlas nightly stamp is in the future stamp=$stamp nowUtc=$($nowUtc.ToString('yyyyMMdd_HHmmss'))"
    }

    $atlasRunDestination = Join-Path $atlasToHermes $stamp
    New-Item -ItemType Directory -Force -Path $atlasRunDestination | Out-Null
    Invoke-CheckedNative -FilePath 'scp' -ArgumentList (@($sshOptions) + @(
        '-r',
        "${atlas}:$atlasNightlyRoot/$stamp/.",
        $atlasRunDestination
    )) | Out-Null

    # Retention now spans run directories rather than loose files.
    Get-ChildItem -LiteralPath $atlasToHermes -Directory |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
        Remove-Item -Recurse -Force

    # --- Hermes backups -> Atlas ---
    Invoke-CheckedNative -FilePath 'ssh' -ArgumentList (@($sshOptions) + @(
        $atlas, 'mkdir -p /home/bs/from-hermes'
    )) | Out-Null
    foreach ($archive in @(Get-ChildItem -LiteralPath $hermesSource -File -Filter '*.tar.gz')) {
        Invoke-CheckedNative -FilePath 'scp' -ArgumentList (@($sshOptions) + @(
            $archive.FullName,
            "${atlas}:/home/bs/from-hermes/"
        )) | Out-Null
    }
    Invoke-CheckedNative -FilePath 'ssh' -ArgumentList (@($sshOptions) + @(
        $atlas,
        "find /home/bs/from-hermes -name '*.tar.gz' -mtime +14 -delete"
    )) | Out-Null

    $failureCode = 'MANIFEST_MISMATCH'
    $atlasSourceManifestScript = 'for f in ' + $atlasNightlyRoot + '/' + $stamp + '/*; do [ -f "$f" ] || continue; n=${f##*/}; s=$(stat -c %s -- "$f") || exit 1; h=$(sha256sum -- "$f") || exit 1; h=${h%% *}; printf "%s|%s|%s\n" "$n" "$s" "$h"; done'
    $atlasDestinationManifestScript = 'for f in /home/bs/from-hermes/*.tar.gz; do [ -f "$f" ] || continue; n=${f##*/}; s=$(stat -c %s -- "$f") || exit 1; h=$(sha256sum -- "$f") || exit 1; h=${h%% *}; printf "%s|%s|%s\n" "$n" "$s" "$h"; done'
    $atlasSourceManifestCommand = ConvertTo-ShellSafePosixCommand -Script $atlasSourceManifestScript
    $atlasDestinationManifestCommand = ConvertTo-ShellSafePosixCommand -Script $atlasDestinationManifestScript

    $atlasSourceLines = @(Invoke-CheckedNative -FilePath 'ssh' -ArgumentList (@($sshOptions) + @(
        $atlas, $atlasSourceManifestCommand
    )))
    $atlasDestinationLines = @(Invoke-CheckedNative -FilePath 'ssh' -ArgumentList (@($sshOptions) + @(
        $atlas, $atlasDestinationManifestCommand
    )))

    $atlasSourceManifest = @(ConvertFrom-ArchiveManifestLines -Lines $atlasSourceLines)
    $atlasOnHermesManifest = @(Get-LocalArchiveManifest -Root $atlasRunDestination -Filter '*')
    $hermesSourceManifest = @(Get-LocalArchiveManifest -Root $hermesSource)
    $hermesOnAtlasManifest = @(ConvertFrom-ArchiveManifestLines -Lines $atlasDestinationLines)

    $atlasToHermesHash = Assert-ArchiveManifestMatch -Expected $atlasSourceManifest -Actual $atlasOnHermesManifest -Direction 'ATLAS_TO_HERMES'
    $hermesToAtlasHash = Assert-ArchiveManifestMatch -Expected $hermesSourceManifest -Actual $hermesOnAtlasManifest -Direction 'HERMES_TO_ATLAS'

    $directions = @(
        [pscustomobject][ordered]@{
            run_id = $runId
            direction = 'ATLAS_TO_HERMES'
            source = 'atlas'
            destination = 'hermes'
            file_count = $atlasSourceManifest.Count
            manifest_sha256 = $atlasToHermesHash
            verification = 'SHA256_PASS'
        },
        [pscustomobject][ordered]@{
            run_id = $runId
            direction = 'HERMES_TO_ATLAS'
            source = 'hermes'
            destination = 'atlas'
            file_count = $hermesSourceManifest.Count
            manifest_sha256 = $hermesToAtlasHash
            verification = 'SHA256_PASS'
        }
    )
    $receiptCompletedAt = [datetime]::UtcNow
    $receipt = New-CrossNodeSyncReceipt -RunId $runId -StartedAt $startedAt -CompletedAt $receiptCompletedAt -Directions $directions

    $failureCode = 'RECEIPT_PERSIST_FAILED'
    $publicationState = [pscustomobject]@{ atlas_receipt_sha256 = $null }
    $publishAtlasReceipt = {
        param([string]$Content)

        Write-AtomicUtf8File -Path $hermesReceiptTransportPath -Content $Content
        $publicationState.atlas_receipt_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $hermesReceiptTransportPath).Hash.ToLowerInvariant()
        Invoke-CheckedNative -FilePath 'scp' -ArgumentList (@($sshOptions) + @(
            $hermesReceiptTransportPath,
            "${atlas}:$atlasReceiptTemporaryPath"
        )) | Out-Null
        $remoteHashLines = @(Invoke-CheckedNative -FilePath 'ssh' -ArgumentList (@($sshOptions) + @(
            $atlas,
            "sha256sum -- $atlasReceiptTemporaryPath"
        )))
        if ($remoteHashLines.Count -ne 1) {
            throw 'RECEIPT_PERSIST_FAILED invalid Atlas receipt hash output'
        }
        $remoteHash = ($remoteHashLines[0] -split '\s+', 2)[0].ToLowerInvariant()
        if ($remoteHash -notmatch '^[0-9a-f]{64}$' -or $remoteHash -cne $publicationState.atlas_receipt_sha256) {
            throw 'RECEIPT_PERSIST_FAILED Atlas receipt hash mismatch'
        }
        Invoke-CheckedNative -FilePath 'ssh' -ArgumentList (@($sshOptions) + @(
            $atlas,
            "sync -f -- $atlasReceiptTemporaryPath && mv -f -- $atlasReceiptTemporaryPath $atlasReceiptPath"
        )) | Out-Null
    }
    $createHermesTaskEvidence = {
        New-CrossNodeSyncTaskEvidence -RunId $runId -StartedAt $startedAt -ReceiptCompletedAt $receiptCompletedAt -CompletedAt ([datetime]::UtcNow) -AtlasReceiptSha256 $publicationState.atlas_receipt_sha256
    }
    $writeHermesTaskEvidence = {
        param([string]$Content)
        Write-AtomicUtf8File -Path $hermesTaskEvidencePath -Content $Content
    }
    $cleanupAtlasTemporary = {
        Invoke-CheckedNative -FilePath 'ssh' -ArgumentList (@($sshOptions) + @(
            $atlas,
            "rm -f -- $atlasReceiptTemporaryPath"
        )) | Out-Null
    }
    Invoke-CrossNodeEvidencePublication -Receipt $receipt -PublishAtlasReceipt $publishAtlasReceipt -CreateHermesTaskEvidence $createHermesTaskEvidence -WriteHermesTaskEvidence $writeHermesTaskEvidence -CleanupAtlasTemporary $cleanupAtlasTemporary
    Remove-Item -LiteralPath $hermesReceiptTransportPath -Force -ErrorAction SilentlyContinue

    # The success line reports the paths that were actually resolved and written, rather than
    # restating literals. The old line named F:\lab-backups\... and would have kept naming it long
    # after the letter changed -- a success message that lies about where the evidence is costs the
    # next reader the same hour this repair cost.
    Write-Output "CROSSNODE_SYNC_SUCCESS atlas=$atlas receipt=$atlasReceiptPath evidence=$hermesTaskEvidencePath"
    exit 0
} catch {
    if (Test-Path -LiteralPath $hermesReceiptTransportPath) {
        Remove-Item -LiteralPath $hermesReceiptTransportPath -Force -ErrorAction SilentlyContinue
    }
    $failureMessage = Format-CrossNodeSyncFailure -ExceptionMessage $_.Exception.Message -DefaultCode $failureCode
    Write-Error $failureMessage
    exit 1
}
