Set-StrictMode -Version Latest

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
