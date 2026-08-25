Set-StrictMode -Version Latest

# ---------------------------------------------------------------------------------------------
# RESOLUTION, AND WHY IT LIVES HERE
#
# Everything below this banner answers one question -- "where is the thing I am about to write to
# or talk to?" -- and every one of them REFUSES rather than falling back. That is the whole lesson
# of 2026-08-24/25: `crossnode-sync.ps1` wrote `F:\lab-backups\...` and talked to `bs@192.168.88.5`,
# and by 2026-08-25 neither of those named the thing it was written for. `F:` had become `G:` when
# the NVMe was re-lettered, and ATLAS's DHCP lease had moved to `192.168.88.8` while `192.168.88.5`
# was left to whatever picked it up next.
#
# A written-down location does not fail when the thing moves. It silently starts naming something
# else -- and `New-Item -Force` would have built a whole archive tree on a USB stick, reported
# success, and protected nothing. That is the exact failure mode the 2026-08-18 backup recovery
# existed to end, so these resolve from live truth and throw when live truth cannot answer.
#
# They are in the library, not in the script, so their refusals can be exercised against temporary
# directories on any machine. A guard with no negative test is a guard nobody has seen refuse.
# ---------------------------------------------------------------------------------------------

function Resolve-ArchiveRoot {
    <#
      The archive destination is resolved by VOLUME LABEL, never by drive letter -- the same repair
      `backup-volumes.ps1` took on 2026-08-24. A letter is an assignment the OS hands out; a label
      travels with the disk. `HERMES_NVME` is the 931 GB NVMe that already holds every backup this
      script has ever written, under both of its letters.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        # Injected only so the two refusals below can be tested without a disk that matches. The
        # default is the live truth this exists to read.
        [scriptblock]$VolumeProvider = { Get-Volume -ErrorAction Stop }
    )

    $candidates = @(& $VolumeProvider | Where-Object { $_.FileSystemLabel -eq $Label -and $_.DriveLetter })
    if ($candidates.Count -eq 0) {
        throw "ARCHIVE_VOLUME_ABSENT no mounted volume is labelled '$Label'. The archive disk is not attached, or its label changed. Nothing was copied in either direction."
    }
    if ($candidates.Count -gt 1) {
        $letters = (@($candidates | ForEach-Object { $_.DriveLetter }) -join ', ')
        throw "ARCHIVE_VOLUME_AMBIGUOUS $($candidates.Count) volumes are labelled '$Label' ($letters). Refusing to guess which one holds the archive."
    }
    "$($candidates[0].DriveLetter):"
}

function Resolve-FabricNode {
    <#
      A node's address comes out of the fabric registry, which is the one place in this lab that is
      allowed to know it. `sync-models-to-forge.ps1` reads the same file for the same reason after
      #1006; that script does not dot-source this library, so the duplication stands for now and is
      recorded as a finding -- unifying it is a second lane's reservation, not this one's.

      Node-general rather than atlas-only because `lab-health.ps1` needs ATLAS and AEGIS from the
      same file, and a health check that resolves one node and hard-codes the other would still be
      carrying the fault this repair exists to remove.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Fabric,
        [Parameter(Mandatory = $true)][string]$Node
    )

    $nodes = Join-Path $Fabric 'nodes.json'
    if (-not (Test-Path -LiteralPath $nodes -PathType Leaf)) {
        throw "FABRIC_REGISTRY_UNREADABLE $nodes does not exist, so $Node's address cannot be resolved. Refusing rather than falling back to a written-down address that may now name another machine."
    }
    # Windows PowerShell 5.1's `Set-Content -Encoding UTF8` writes a BOM that `ConvertFrom-Json`
    # rejects outright, and this registry is maintained by PowerShell tooling. A reader that only
    # works on the files it wrote itself is not a reader.
    $text = Get-Content -LiteralPath $nodes -Raw
    if ($text.Length -gt 0 -and [int][char]$text[0] -eq 0xFEFF) { $text = $text.Substring(1) }
    $registry = $null
    try {
        $registry = $text | ConvertFrom-Json
    } catch {
        throw "FABRIC_REGISTRY_UNREADABLE $nodes is not parseable JSON, so $Node's address cannot be resolved."
    }
    # Read through PSObject.Properties rather than dotting straight in. `Set-StrictMode -Version
    # Latest` is on for every caller of this library, and under it a missing property raises a
    # PropertyNotFound error instead of returning $null -- which would replace the typed refusal
    # below with an opaque StrictMode failure at exactly the moment an operator needs to be told
    # that the registry is incomplete.
    $entry = $null
    if ($registry) { $entry = $registry.PSObject.Properties[$Node] }
    $value = $null
    if ($entry) { $value = $entry.Value }
    $hostProperty = $null
    $userProperty = $null
    if ($value) {
        $hostProperty = $value.PSObject.Properties['host']
        $userProperty = $value.PSObject.Properties['user']
    }
    $nodeHost = if ($hostProperty) { [string]$hostProperty.Value } else { '' }
    $nodeUser = if ($userProperty) { [string]$userProperty.Value } else { '' }
    if ([string]::IsNullOrWhiteSpace($nodeHost) -or [string]::IsNullOrWhiteSpace($nodeUser)) {
        throw "FABRIC_REGISTRY_INCOMPLETE $nodes carries no $Node entry with both host and user, so $Node cannot be addressed. Refusing rather than guessing."
    }
    [pscustomobject][ordered]@{
        Node     = $Node
        User     = $nodeUser
        Host     = $nodeHost
        Endpoint = "$nodeUser@$nodeHost"
    }
}

function Resolve-AtlasEndpoint {
    # The cross-node sync only ever talks to ATLAS, so it takes the endpoint string directly.
    param([Parameter(Mandatory = $true)][string]$Fabric)

    (Resolve-FabricNode -Fabric $Fabric -Node 'atlas').Endpoint
}

function Resolve-FabricSshIdentity {
    <#
      WHY THE TRANSPORT MOVED TOO, and this is not scope creep but the other half of the same fault.
      This script used to run bare `ssh -o BatchMode=yes bs@192.168.88.5`, leaning on the calling
      user's `~/.ssh`. That `known_hosts` pins `192.168.88.5` and has never seen `192.168.88.8`, so
      resolving the new address while keeping the old transport only trades one red task for
      another: measured on HERMES 2026-08-25, `ssh bs@192.168.88.8` under the default identity exits
      255 with `Host key verification failed`.

      The fabric identity is the one that actually knows this lab: its `known_hosts` carries the
      pinned ed25519 key that was proven byte-identical across ATLAS's move, and its key is what
      `sync-models-to-forge.ps1` already uses. Resolving `where` from the registry and then
      authenticating against a store that has never heard of that host would be a resolution that
      cannot connect.

      `StrictHostKeyChecking=yes` stays on deliberately. If the registry is ever wrong, the right
      outcome is a refused connection, not a backup handed to a stranger.
    #>
    param([Parameter(Mandatory = $true)][string]$Fabric)

    $key = Join-Path $Fabric 'keys\williamos-fabric'
    $known = Join-Path $Fabric 'known_hosts'
    if (-not (Test-Path -LiteralPath $key -PathType Leaf)) {
        throw "FABRIC_IDENTITY_UNREADABLE $key does not exist, so no authenticated transport to ATLAS can be built. Refusing rather than falling back to whatever identity the calling account happens to hold."
    }
    if (-not (Test-Path -LiteralPath $known -PathType Leaf)) {
        throw "FABRIC_IDENTITY_UNREADABLE $known does not exist, so ATLAS's host key cannot be verified. Refusing rather than accepting an unverified host key for a backup transfer."
    }
    [pscustomobject][ordered]@{
        KeyPath        = $key
        KnownHostsPath = $known
        # Every ssh and scp invocation in the sync prepends exactly these, so no call site can
        # quietly use a different identity from the one that was resolved and refused on.
        #
        # One list, not two, and deliberately no `-n`. `ssh -n` was tried here on the theory that
        # the sync's first remote call was blocking on inherited stdin; it was not -- the same call
        # hung identically with `-n` and runs clean under Task Scheduler either way (XN-03). A flag
        # that fixed nothing measurable does not get shipped on a hunch, and keeping the two option
        # lists separate to hold it would have been carrying scaffolding for a repair that was not
        # one. If a later lane does need `-n`, note before adding it that `scp -n` in OpenSSH 9.x
        # means DRY RUN: it would copy nothing, exit 0, and let this script log success over an
        # empty transfer.
        SshOptions     = @(
            '-i', $key,
            '-o', "UserKnownHostsFile=$known",
            '-o', 'StrictHostKeyChecking=yes',
            '-o', 'BatchMode=yes',
            '-o', 'ConnectTimeout=30'
        )
    }
}

function Assert-SafeArchiveName {
    param([Parameter(Mandatory = $true)][string]$Name)

    if ([string]::IsNullOrWhiteSpace($Name) -or
        $Name.Contains('/') -or
        $Name.Contains('\') -or
        $Name.Contains('..')) {
        throw "MANIFEST_MISMATCH invalid archive name"
    }
}

function ConvertTo-ValidatedArchiveManifest {
    param([Parameter(Mandatory = $true)][object[]]$Manifest)

    $byName = @{}
    foreach ($record in $Manifest) {
        $name = [string]$record.name
        Assert-SafeArchiveName -Name $name

        [long]$size = 0
        if (-not [long]::TryParse([string]$record.size, [ref]$size) -or $size -le 0) {
            throw "MANIFEST_MISMATCH invalid archive size"
        }

        $sha256 = ([string]$record.sha256).ToLowerInvariant()
        if ($sha256 -notmatch '^[0-9a-f]{64}$') {
            throw "MANIFEST_MISMATCH invalid archive hash"
        }
        if ($byName.ContainsKey($name)) {
            throw "MANIFEST_MISMATCH duplicate archive name"
        }

        $byName.Add($name, [pscustomobject][ordered]@{
            name = $name
            size = $size
            sha256 = $sha256
        })
    }

    [string[]]$names = @($byName.Keys)
    [Array]::Sort($names, [StringComparer]::Ordinal)
    foreach ($name in $names) {
        $byName[$name]
    }
}

function ConvertTo-ShellSafePosixCommand {
    param([Parameter(Mandatory = $true)][string]$Script)

    $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Script))
    "printf %s $payload | base64 -d | sh"
}

function Invoke-CheckedNative {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$ArgumentList
    )

    $callerErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $captured = @(& $FilePath @ArgumentList 2>&1)
        $nativeExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $callerErrorActionPreference
    }
    if ($nativeExitCode -ne 0) {
        throw "NATIVE_COMMAND_FAILED exit=$nativeExitCode command=$([IO.Path]::GetFileName($FilePath))"
    }
    foreach ($line in $captured) {
        if ($line -isnot [Management.Automation.ErrorRecord]) {
            [string]$line
        }
    }
}

function Get-LocalArchiveManifest {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        # The Atlas nightly set is no longer tarballs -- it is .dump / .archive.gz / .rdb / SHA256SUMS
        # in a per-run directory. Defaulted so the Hermes->Atlas direction keeps its old behaviour.
        [string]$Filter = '*.tar.gz'
    )

    $records = foreach ($file in @(Get-ChildItem -LiteralPath $Root -File -Filter $Filter)) {
        [pscustomobject][ordered]@{
            name = $file.Name
            size = [long]$file.Length
            sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash.ToLowerInvariant()
        }
    }
    ConvertTo-ValidatedArchiveManifest -Manifest @($records)
}

function ConvertFrom-ArchiveManifestLines {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Lines)

    $records = foreach ($line in $Lines) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $parts = $line -split '\|', 3
        if ($parts.Count -ne 3) {
            throw "MANIFEST_MISMATCH invalid manifest line"
        }
        [pscustomobject][ordered]@{
            name = $parts[0]
            size = $parts[1]
            sha256 = $parts[2]
        }
    }
    ConvertTo-ValidatedArchiveManifest -Manifest @($records)
}

function Assert-ArchiveManifestMatch {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Expected,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Actual,
        [Parameter(Mandatory = $true)][string]$Direction
    )

    $expectedManifest = @(ConvertTo-ValidatedArchiveManifest -Manifest $Expected)
    $actualManifest = @(ConvertTo-ValidatedArchiveManifest -Manifest $Actual)
    if ($expectedManifest.Count -le 0) {
        throw "MANIFEST_MISMATCH direction=$Direction empty source"
    }

    $actualByName = @{}
    foreach ($record in $actualManifest) {
        $actualByName.Add($record.name, $record)
    }

    foreach ($record in $expectedManifest) {
        if (-not $actualByName.ContainsKey($record.name)) {
            throw "MANIFEST_MISMATCH direction=$Direction missing archive"
        }
        $destinationRecord = $actualByName[$record.name]
        if ($destinationRecord.size -ne $record.size -or $destinationRecord.sha256 -ne $record.sha256) {
            throw "MANIFEST_MISMATCH direction=$Direction archive differs"
        }
    }

    $canonicalLines = @($expectedManifest | ForEach-Object {
        '{0}|{1}|{2}' -f $_.name, $_.size, $_.sha256
    })
    $canonicalBytes = [Text.Encoding]::UTF8.GetBytes([string]::Join("`n", $canonicalLines))
    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
        $hashBytes = $hasher.ComputeHash($canonicalBytes)
    } finally {
        $hasher.Dispose()
    }
    ([BitConverter]::ToString($hashBytes)).Replace('-', '').ToLowerInvariant()
}

function Assert-CrossNodeRunId {
    param([Parameter(Mandatory = $true)][string]$RunId)

    if ($RunId -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') {
        throw 'MANIFEST_MISMATCH invalid run id'
    }
}

function New-CrossNodeSyncReceipt {
    param(
        [Parameter(Mandatory = $true)][string]$RunId,
        [Parameter(Mandatory = $true)][datetime]$StartedAt,
        [Parameter(Mandatory = $true)][datetime]$CompletedAt,
        [Parameter(Mandatory = $true)][object[]]$Directions
    )

    Assert-CrossNodeRunId -RunId $RunId
    if ($CompletedAt.ToUniversalTime() -lt $StartedAt.ToUniversalTime()) {
        throw 'MANIFEST_MISMATCH receipt timestamps out of order'
    }
    if ($Directions.Count -ne 2) {
        throw 'MANIFEST_MISMATCH receipt requires two directions'
    }

    $allowedDirections = @{
        ATLAS_TO_HERMES = @('atlas', 'hermes')
        HERMES_TO_ATLAS = @('hermes', 'atlas')
    }
    $requiredDirectionOrder = @('ATLAS_TO_HERMES', 'HERMES_TO_ATLAS')
    $seenDirections = @{}
    $validatedDirections = for ($index = 0; $index -lt $Directions.Count; $index++) {
        $direction = $Directions[$index]
        $directionName = [string]$direction.direction
        if (-not $allowedDirections.ContainsKey($directionName) -or $seenDirections.ContainsKey($directionName)) {
            throw 'MANIFEST_MISMATCH invalid receipt direction'
        }
        if ($directionName -cne $requiredDirectionOrder[$index]) {
            throw 'MANIFEST_MISMATCH invalid receipt direction order'
        }
        if ([string]$direction.run_id -cne $RunId) {
            throw 'MANIFEST_MISMATCH direction run id mismatch'
        }
        $expectedHosts = $allowedDirections[$directionName]
        if ([string]$direction.source -cne $expectedHosts[0] -or
            [string]$direction.destination -cne $expectedHosts[1]) {
            throw 'MANIFEST_MISMATCH invalid receipt hosts'
        }

        [long]$fileCount = 0
        if (-not [long]::TryParse([string]$direction.file_count, [ref]$fileCount) -or $fileCount -le 0) {
            throw 'MANIFEST_MISMATCH invalid receipt file count'
        }
        $manifestSha256 = ([string]$direction.manifest_sha256).ToLowerInvariant()
        if ($manifestSha256 -notmatch '^[0-9a-f]{64}$') {
            throw 'MANIFEST_MISMATCH invalid receipt manifest hash'
        }
        if ([string]$direction.verification -cne 'SHA256_PASS') {
            throw 'MANIFEST_MISMATCH invalid direction verification'
        }

        $seenDirections.Add($directionName, $true)
        [pscustomobject][ordered]@{
            run_id = $RunId
            direction = $directionName
            source = $expectedHosts[0]
            destination = $expectedHosts[1]
            file_count = $fileCount
            manifest_sha256 = $manifestSha256
            verification = 'SHA256_PASS'
        }
    }

    $startedUtc = $StartedAt.ToUniversalTime()
    $receipt = [pscustomobject][ordered]@{
        schema_version = 1
        task_name = 'HermesCrossNodeBackupSync'
        run_id = $RunId
        started_at = $startedUtc.ToString('o')
        completed_at = $CompletedAt.ToUniversalTime().ToString('o')
        result = 'SUCCESS'
        verification = 'SHA256_PASS'
        directions = @($validatedDirections)
    }
    $receipt | ConvertTo-Json -Depth 4
}

function New-CrossNodeSyncTaskEvidence {
    param(
        [Parameter(Mandatory = $true)][string]$RunId,
        [Parameter(Mandatory = $true)][datetime]$StartedAt,
        [Parameter(Mandatory = $true)][datetime]$ReceiptCompletedAt,
        [Parameter(Mandatory = $true)][datetime]$CompletedAt,
        [Parameter(Mandatory = $true)][string]$AtlasReceiptSha256
    )

    Assert-CrossNodeRunId -RunId $RunId
    $startedUtc = $StartedAt.ToUniversalTime()
    $receiptCompletedUtc = $ReceiptCompletedAt.ToUniversalTime()
    $completedUtc = $CompletedAt.ToUniversalTime()
    if ($receiptCompletedUtc -lt $startedUtc -or $completedUtc -lt $receiptCompletedUtc) {
        throw 'MANIFEST_MISMATCH task evidence timestamps out of order'
    }
    $receiptHash = $AtlasReceiptSha256.ToLowerInvariant()
    if ($receiptHash -notmatch '^[0-9a-f]{64}$') {
        throw 'MANIFEST_MISMATCH invalid Atlas receipt hash'
    }

    [pscustomobject][ordered]@{
        schema_version = 1
        task_name = 'HermesCrossNodeBackupSync'
        run_id = $RunId
        started_at = $startedUtc.ToString('o')
        receipt_completed_at = $receiptCompletedUtc.ToString('o')
        completed_at = $completedUtc.ToString('o')
        state = 'COMPLETED'
        result = 'SUCCESS'
        verification = 'SHA256_PASS'
        atlas_receipt_sha256 = $receiptHash
    } | ConvertTo-Json -Depth 3
}

function Invoke-CrossNodeEvidencePublication {
    param(
        [Parameter(Mandatory = $true)][string]$Receipt,
        [Parameter(Mandatory = $true)][scriptblock]$PublishAtlasReceipt,
        [Parameter(Mandatory = $true)][scriptblock]$CreateHermesTaskEvidence,
        [Parameter(Mandatory = $true)][scriptblock]$WriteHermesTaskEvidence,
        [Parameter(Mandatory = $true)][scriptblock]$CleanupAtlasTemporary
    )

    $stage = 'ATLAS_RECEIPT_PUBLISH'
    try {
        & $PublishAtlasReceipt $Receipt
        $stage = 'HERMES_TASK_EVIDENCE'
        $taskEvidence = & $CreateHermesTaskEvidence
        & $WriteHermesTaskEvidence $taskEvidence
    } catch {
        $originalMessage = [string]$_.Exception.Message
        try {
            & $CleanupAtlasTemporary | Out-Null
        } catch {
            # Best-effort cleanup must not mask the original publication failure.
        }
        if ($originalMessage -match '^(NATIVE_COMMAND_FAILED|MANIFEST_MISMATCH|RECEIPT_PERSIST_FAILED)(?:\s+(.*))?$') {
            $failureCode = $matches[1]
            $failureDetail = $matches[2]
            if ([string]::IsNullOrWhiteSpace($failureDetail)) {
                throw "$failureCode stage=$stage"
            }
            throw "$failureCode stage=$stage $failureDetail"
        }
        throw "RECEIPT_PERSIST_FAILED stage=$stage"
    }
}

function Format-CrossNodeSyncFailure {
    param(
        [Parameter(Mandatory = $true)][string]$ExceptionMessage,
        [Parameter(Mandatory = $true)]
        [ValidateSet('NATIVE_COMMAND_FAILED', 'MANIFEST_MISMATCH', 'RECEIPT_PERSIST_FAILED')]
        [string]$DefaultCode
    )

    $code = $DefaultCode
    if ($ExceptionMessage -match '^(NATIVE_COMMAND_FAILED|MANIFEST_MISMATCH|RECEIPT_PERSIST_FAILED)(?:\s|$)') {
        $code = $matches[1]
    }
    $stage = $null
    if ($ExceptionMessage -match '(?:^|\s)stage=(ATLAS_RECEIPT_PUBLISH|HERMES_TASK_EVIDENCE)(?:\s|$)') {
        $stage = $matches[1]
    }

    $message = "CROSSNODE_SYNC_FAILED code=$code"
    if ($stage) {
        $message += " stage=$stage"
    }
    $message
}

function Write-AtomicUtf8File {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Content
    )

    $targetPath = [IO.Path]::GetFullPath($Path)
    $directory = [IO.Path]::GetDirectoryName($targetPath)
    $temporaryPath = Join-Path $directory ('.' + [IO.Path]::GetFileName($targetPath) + '.' + [guid]::NewGuid().ToString('N') + '.tmp')
    try {
        [IO.File]::WriteAllText($temporaryPath, $Content, [Text.UTF8Encoding]::new($false))
        if ([IO.File]::Exists($targetPath)) {
            # File.Replace requires a real backup path: Windows PowerShell coerces a $null
            # third argument to "" which Replace rejects as "path is not of a legal form".
            $backupPath = Join-Path $directory ('.' + [IO.Path]::GetFileName($targetPath) + '.' + [guid]::NewGuid().ToString('N') + '.bak.tmp')
            try {
                [IO.File]::Replace($temporaryPath, $targetPath, $backupPath)
            } finally {
                if ([IO.File]::Exists($backupPath)) { [IO.File]::Delete($backupPath) }
            }
        } else {
            [IO.File]::Move($temporaryPath, $targetPath)
        }
        $temporaryPath = $null
    } finally {
        if ($temporaryPath -and [IO.File]::Exists($temporaryPath)) {
            [IO.File]::Delete($temporaryPath)
        }
    }
}
