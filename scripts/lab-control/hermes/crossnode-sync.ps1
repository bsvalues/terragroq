# Cross-node backup sync (runs on Hermes). Copies each node's local backups to the OTHER node.
# Non-destructive: never deletes source backups, never touches containers. 14-day retention on copies.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\crossnode-sync-lib.ps1"

$atlas = 'bs@192.168.88.5'
$atlasToHermes = 'F:\lab-backups\crossnode\atlas'
$atlasNightlyRoot = '/forge/backups/nightly'
$staleSourceHours = 36
$hermesSource = 'F:\lab-backups\hermes-volumes'
$hermesTaskEvidencePath = 'F:\lab-backups\crossnode\crossnode-sync-task-evidence.json'
$atlasReceiptPath = '/home/bs/from-hermes/crossnode-sync-receipt.json'
$startedAt = [datetime]::UtcNow
$runId = [guid]::NewGuid().ToString('D').ToLowerInvariant()
$failureCode = 'NATIVE_COMMAND_FAILED'
$hermesReceiptTransportPath = "F:\lab-backups\crossnode\.crossnode-sync-receipt.$runId.transport.tmp"
$atlasReceiptTemporaryPath = "$atlasReceiptPath.$runId.tmp"

try {
    New-Item -ItemType Directory -Force -Path $atlasToHermes | Out-Null

    # --- Atlas verified nightly -> Hermes ---
    # Atlas no longer writes a flat /home/bs/backups/*.tar.gz set of live-volume tars; it writes
    # verified logical dumps to /forge/backups/nightly/<stamp>/. Continuing to copy the old flat
    # directory would still report success while replicating a set nothing writes any more -- the
    # precise failure this system exists to catch.
    $stampLines = @(Invoke-CheckedNative -FilePath 'ssh' -ArgumentList @(
        '-o', 'BatchMode=yes', $atlas,
        (ConvertTo-ShellSafePosixCommand -Script ("ls -1 " + $atlasNightlyRoot + " 2>/dev/null"))
    ))
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
    Invoke-CheckedNative -FilePath 'scp' -ArgumentList @(
        '-o', 'BatchMode=yes', '-r',
        "${atlas}:$atlasNightlyRoot/$stamp/.",
        $atlasRunDestination
    ) | Out-Null

    # Retention now spans run directories rather than loose files.
    Get-ChildItem -LiteralPath $atlasToHermes -Directory |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
        Remove-Item -Recurse -Force

    # --- Hermes backups -> Atlas ---
    Invoke-CheckedNative -FilePath 'ssh' -ArgumentList @(
        '-o', 'BatchMode=yes', $atlas, 'mkdir -p /home/bs/from-hermes'
    ) | Out-Null
    foreach ($archive in @(Get-ChildItem -LiteralPath $hermesSource -File -Filter '*.tar.gz')) {
        Invoke-CheckedNative -FilePath 'scp' -ArgumentList @(
            '-o', 'BatchMode=yes',
            $archive.FullName,
            "${atlas}:/home/bs/from-hermes/"
        ) | Out-Null
    }
    Invoke-CheckedNative -FilePath 'ssh' -ArgumentList @(
        '-o', 'BatchMode=yes', $atlas,
        "find /home/bs/from-hermes -name '*.tar.gz' -mtime +14 -delete"
    ) | Out-Null

    $failureCode = 'MANIFEST_MISMATCH'
    $atlasSourceManifestScript = 'for f in ' + $atlasNightlyRoot + '/' + $stamp + '/*; do [ -f "$f" ] || continue; n=${f##*/}; s=$(stat -c %s -- "$f") || exit 1; h=$(sha256sum -- "$f") || exit 1; h=${h%% *}; printf "%s|%s|%s\n" "$n" "$s" "$h"; done'
    $atlasDestinationManifestScript = 'for f in /home/bs/from-hermes/*.tar.gz; do [ -f "$f" ] || continue; n=${f##*/}; s=$(stat -c %s -- "$f") || exit 1; h=$(sha256sum -- "$f") || exit 1; h=${h%% *}; printf "%s|%s|%s\n" "$n" "$s" "$h"; done'
    $atlasSourceManifestCommand = ConvertTo-ShellSafePosixCommand -Script $atlasSourceManifestScript
    $atlasDestinationManifestCommand = ConvertTo-ShellSafePosixCommand -Script $atlasDestinationManifestScript

    $atlasSourceLines = @(Invoke-CheckedNative -FilePath 'ssh' -ArgumentList @(
        '-o', 'BatchMode=yes', $atlas, $atlasSourceManifestCommand
    ))
    $atlasDestinationLines = @(Invoke-CheckedNative -FilePath 'ssh' -ArgumentList @(
        '-o', 'BatchMode=yes', $atlas, $atlasDestinationManifestCommand
    ))

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
        Invoke-CheckedNative -FilePath 'scp' -ArgumentList @(
            '-o', 'BatchMode=yes',
            $hermesReceiptTransportPath,
            "${atlas}:$atlasReceiptTemporaryPath"
        ) | Out-Null
        $remoteHashLines = @(Invoke-CheckedNative -FilePath 'ssh' -ArgumentList @(
            '-o', 'BatchMode=yes', $atlas,
            "sha256sum -- $atlasReceiptTemporaryPath"
        ))
        if ($remoteHashLines.Count -ne 1) {
            throw 'RECEIPT_PERSIST_FAILED invalid Atlas receipt hash output'
        }
        $remoteHash = ($remoteHashLines[0] -split '\s+', 2)[0].ToLowerInvariant()
        if ($remoteHash -notmatch '^[0-9a-f]{64}$' -or $remoteHash -cne $publicationState.atlas_receipt_sha256) {
            throw 'RECEIPT_PERSIST_FAILED Atlas receipt hash mismatch'
        }
        Invoke-CheckedNative -FilePath 'ssh' -ArgumentList @(
            '-o', 'BatchMode=yes', $atlas,
            "sync -f -- $atlasReceiptTemporaryPath && mv -f -- $atlasReceiptTemporaryPath $atlasReceiptPath"
        ) | Out-Null
    }
    $createHermesTaskEvidence = {
        New-CrossNodeSyncTaskEvidence -RunId $runId -StartedAt $startedAt -ReceiptCompletedAt $receiptCompletedAt -CompletedAt ([datetime]::UtcNow) -AtlasReceiptSha256 $publicationState.atlas_receipt_sha256
    }
    $writeHermesTaskEvidence = {
        param([string]$Content)
        Write-AtomicUtf8File -Path $hermesTaskEvidencePath -Content $Content
    }
    $cleanupAtlasTemporary = {
        Invoke-CheckedNative -FilePath 'ssh' -ArgumentList @(
            '-o', 'BatchMode=yes', $atlas,
            "rm -f -- $atlasReceiptTemporaryPath"
        ) | Out-Null
    }
    Invoke-CrossNodeEvidencePublication -Receipt $receipt -PublishAtlasReceipt $publishAtlasReceipt -CreateHermesTaskEvidence $createHermesTaskEvidence -WriteHermesTaskEvidence $writeHermesTaskEvidence -CleanupAtlasTemporary $cleanupAtlasTemporary
    Remove-Item -LiteralPath $hermesReceiptTransportPath -Force -ErrorAction SilentlyContinue

    Write-Output 'CROSSNODE_SYNC_SUCCESS receipt=/home/bs/from-hermes/crossnode-sync-receipt.json evidence=F:\lab-backups\crossnode\crossnode-sync-task-evidence.json'
    exit 0
} catch {
    if (Test-Path -LiteralPath $hermesReceiptTransportPath) {
        Remove-Item -LiteralPath $hermesReceiptTransportPath -Force -ErrorAction SilentlyContinue
    }
    $failureMessage = Format-CrossNodeSyncFailure -ExceptionMessage $_.Exception.Message -DefaultCode $failureCode
    Write-Error $failureMessage
    exit 1
}
