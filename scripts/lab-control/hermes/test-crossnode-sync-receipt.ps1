Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\crossnode-sync-lib.ps1"

function Assert-Equal($Expected, $Actual, [string]$Message) {
    if ($Expected -ne $Actual) { throw "$Message expected=$Expected actual=$Actual" }
}
function Assert-Throws([scriptblock]$Action, [string]$Message) {
    try { & $Action; throw "Expected throw: $Message" } catch {
        if ($_.Exception.Message -eq "Expected throw: $Message") { throw }
    }
}
function Assert-ThrowsLike([scriptblock]$Action, [string]$Pattern, [string]$Message) {
    try { & $Action; throw "Expected throw: $Message" } catch {
        if ($_.Exception.Message -eq "Expected throw: $Message") { throw }
        if ($_.Exception.Message -notlike $Pattern) {
            throw "$Message expected-pattern=$Pattern actual=$($_.Exception.Message)"
        }
    }
}

$root = Join-Path ([IO.Path]::GetTempPath()) ("crossnode-receipt-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $root | Out-Null
try {
    $posixPayload = 'printf "%s|%s|%s\n" "$n" "$s" "$h"'
    $expectedPayloadBase64 = 'cHJpbnRmICIlc3wlc3wlc1xuIiAiJG4iICIkcyIgIiRoIg=='
    $shellSafeCommand = ConvertTo-ShellSafePosixCommand -Script $posixPayload
    Assert-Equal "printf %s $expectedPayloadBase64 | base64 -d | sh" $shellSafeCommand 'shell-safe command shape'
    $observedPayloadBase64 = ($shellSafeCommand -split ' ')[2]
    $decodedPayload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($observedPayloadBase64))
    Assert-Equal $posixPayload $decodedPayload 'shell-safe command exact payload'
    Assert-ThrowsLike {
        Invoke-CheckedNative -FilePath 'cmd.exe' -ArgumentList @('/d', '/c', 'echo RAW_NATIVE_STDERR 1>&2 & exit /b 9')
    } 'NATIVE_COMMAND_FAILED exit=9 command=cmd.exe' 'native stderr is captured and sanitized'
    Assert-Equal 'Stop' $ErrorActionPreference 'native invocation restores caller error preference'

    $source = Join-Path $root 'source'
    $dest = Join-Path $root 'dest'
    New-Item -ItemType Directory -Path $source,$dest | Out-Null
    [IO.File]::WriteAllText((Join-Path $source 'one.tar.gz'),'one')
    Copy-Item (Join-Path $source 'one.tar.gz') $dest
    $expected = Get-LocalArchiveManifest -Root $source
    $actual = Get-LocalArchiveManifest -Root $dest
    $manifestHash = Assert-ArchiveManifestMatch -Expected $expected -Actual $actual -Direction 'ATLAS_TO_HERMES'
    Assert-Equal 64 $manifestHash.Length 'manifest hash length'

    [IO.File]::WriteAllText((Join-Path $dest 'one.tar.gz'),'changed')
    Assert-Throws { Assert-ArchiveManifestMatch -Expected $expected -Actual (Get-LocalArchiveManifest -Root $dest) -Direction 'ATLAS_TO_HERMES' } 'hash mismatch fails'
    Assert-Throws { Assert-ArchiveManifestMatch -Expected @() -Actual @() -Direction 'ATLAS_TO_HERMES' } 'empty source fails'

    $runId = '11111111-2222-3333-4444-555555555555'
    $startedAt = [datetime]'2026-08-08T11:00:00Z'
    $receiptCompletedAt = [datetime]'2026-08-08T11:00:25Z'
    $directions = @(
        [pscustomobject]@{ run_id=$runId; direction='ATLAS_TO_HERMES'; source='atlas'; destination='hermes'; file_count=3; manifest_sha256=('a' * 64); verification='SHA256_PASS' },
        [pscustomobject]@{ run_id=$runId; direction='HERMES_TO_ATLAS'; source='hermes'; destination='atlas'; file_count=5; manifest_sha256=('b' * 64); verification='SHA256_PASS' }
    )
    $receipt = New-CrossNodeSyncReceipt -RunId $runId -StartedAt $startedAt -CompletedAt $receiptCompletedAt -Directions $directions
    $parsed = $receipt | ConvertFrom-Json
    Assert-Equal 'SUCCESS' $parsed.result 'receipt result'
    Assert-Equal 'SHA256_PASS' $parsed.verification 'receipt verification'
    Assert-Equal 2 $parsed.directions.Count 'direction count'
    Assert-Equal $runId $parsed.run_id 'receipt run id'
    Assert-Equal $runId $parsed.directions[0].run_id 'atlas direction run id'
    Assert-Equal $runId $parsed.directions[1].run_id 'hermes direction run id'
    Assert-Equal '2026-08-08T11:00:00.0000000Z' ([datetime]$parsed.started_at).ToUniversalTime().ToString('o') 'receipt started binding'
    Assert-Throws {
        New-CrossNodeSyncReceipt -RunId $runId -StartedAt $startedAt -CompletedAt $receiptCompletedAt -Directions @($directions[0])
    } 'one direction fails'
    $mismatchedDirections = @(
        $directions[0],
        [pscustomobject]@{ run_id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'; direction='HERMES_TO_ATLAS'; source='hermes'; destination='atlas'; file_count=5; manifest_sha256=('b' * 64); verification='SHA256_PASS' }
    )
    Assert-Throws {
        New-CrossNodeSyncReceipt -RunId $runId -StartedAt $startedAt -CompletedAt $receiptCompletedAt -Directions $mismatchedDirections
    } 'mismatched direction run id fails'

    $taskCompletedAt = [datetime]'2026-08-08T11:00:26Z'
    $taskEvidence = New-CrossNodeSyncTaskEvidence -RunId $runId -StartedAt $startedAt -ReceiptCompletedAt $receiptCompletedAt -CompletedAt $taskCompletedAt -AtlasReceiptSha256 ('c' * 64)
    $parsedEvidence = $taskEvidence | ConvertFrom-Json
    Assert-Equal $runId $parsedEvidence.run_id 'task evidence run id'
    Assert-Equal ([datetime]$parsed.started_at).ToUniversalTime() ([datetime]$parsedEvidence.started_at).ToUniversalTime() 'task evidence started binding'
    Assert-Equal ([datetime]$parsed.completed_at).ToUniversalTime() ([datetime]$parsedEvidence.receipt_completed_at).ToUniversalTime() 'task evidence receipt completion binding'
    Assert-Equal 'COMPLETED' $parsedEvidence.state 'task evidence state'
    Assert-Equal 'SUCCESS' $parsedEvidence.result 'task evidence result'
    Assert-Equal 'SHA256_PASS' $parsedEvidence.verification 'task evidence verification'

    $atlasPublishCalls = [pscustomobject]@{ publish=0; create=0; evidence=0; cleanup=0 }
    Assert-ThrowsLike {
        Invoke-CrossNodeEvidencePublication -Receipt $receipt `
            -PublishAtlasReceipt { param($Content) $atlasPublishCalls.publish++; throw 'simulated Atlas publish failure' } `
            -CreateHermesTaskEvidence { $atlasPublishCalls.create++; $taskEvidence } `
            -WriteHermesTaskEvidence { param($Content) $atlasPublishCalls.evidence++ } `
            -CleanupAtlasTemporary { $atlasPublishCalls.cleanup++ }
    } 'RECEIPT_PERSIST_FAILED stage=ATLAS_RECEIPT_PUBLISH*' 'Atlas publish failure is terminal'
    Assert-Equal 1 $atlasPublishCalls.publish 'Atlas publish attempted once'
    Assert-Equal 0 $atlasPublishCalls.create 'task evidence not created after Atlas publish failure'
    Assert-Equal 0 $atlasPublishCalls.evidence 'task evidence skipped after Atlas publish failure'
    Assert-Equal 1 $atlasPublishCalls.cleanup 'Atlas temporary cleanup attempted'

    $atlasCanonical = Join-Path $root 'atlas-canonical.json'
    $hermesEvidence = Join-Path $root 'hermes-task-evidence.json'
    [IO.File]::WriteAllText($hermesEvidence, 'prior-task-evidence')
    $postPublishCalls = [pscustomobject]@{ cleanup=0 }
    Assert-ThrowsLike {
        Invoke-CrossNodeEvidencePublication -Receipt $receipt `
            -PublishAtlasReceipt { param($Content) Write-AtomicUtf8File -Path $atlasCanonical -Content $Content } `
            -CreateHermesTaskEvidence { $taskEvidence } `
            -WriteHermesTaskEvidence { param($Content) throw 'simulated death before Hermes evidence' } `
            -CleanupAtlasTemporary { $postPublishCalls.cleanup++ }
    } 'RECEIPT_PERSIST_FAILED stage=HERMES_TASK_EVIDENCE*' 'post-publication failure is terminal'
    Assert-Equal $receipt ([IO.File]::ReadAllText($atlasCanonical)) 'Atlas receipt may exist after post-publication failure'
    Assert-Equal 'prior-task-evidence' ([IO.File]::ReadAllText($hermesEvidence)) 'prior Hermes task evidence remains'
    Assert-Equal 1 $postPublishCalls.cleanup 'post-publication cleanup attempted'

    Assert-ThrowsLike {
        Invoke-CrossNodeEvidencePublication -Receipt $receipt `
            -PublishAtlasReceipt { param($Content) throw 'simulated Atlas publish failure' } `
            -CreateHermesTaskEvidence { throw 'must not run' } `
            -WriteHermesTaskEvidence { param($Content) throw 'must not run' } `
            -CleanupAtlasTemporary { throw 'simulated cleanup failure' }
    } 'RECEIPT_PERSIST_FAILED stage=ATLAS_RECEIPT_PUBLISH*' 'cleanup failure does not mask publication failure'

    $nativeClassificationCalls = [pscustomobject]@{ create=0; evidence=0; cleanup=0 }
    Assert-ThrowsLike {
        Invoke-CrossNodeEvidencePublication -Receipt $receipt `
            -PublishAtlasReceipt { param($Content) Invoke-CheckedNative -FilePath 'cmd.exe' -ArgumentList @('/d', '/c', 'exit /b 9') } `
            -CreateHermesTaskEvidence { $nativeClassificationCalls.create++; $taskEvidence } `
            -WriteHermesTaskEvidence { param($Content) $nativeClassificationCalls.evidence++ } `
            -CleanupAtlasTemporary { $nativeClassificationCalls.cleanup++ }
    } 'NATIVE_COMMAND_FAILED stage=ATLAS_RECEIPT_PUBLISH exit=9 command=cmd.exe' 'checked native classification survives publication cleanup'
    Assert-Equal 0 $nativeClassificationCalls.create 'native failure skips task evidence creation'
    Assert-Equal 0 $nativeClassificationCalls.evidence 'native failure skips task evidence write'
    Assert-Equal 1 $nativeClassificationCalls.cleanup 'native failure attempts cleanup'

    $manifestClassificationCalls = [pscustomobject]@{ evidence=0; cleanup=0 }
    Assert-ThrowsLike {
        Invoke-CrossNodeEvidencePublication -Receipt $receipt `
            -PublishAtlasReceipt { param($Content) } `
            -CreateHermesTaskEvidence {
                New-CrossNodeSyncTaskEvidence -RunId $runId -StartedAt $startedAt -ReceiptCompletedAt $receiptCompletedAt -CompletedAt ([datetime]'2026-08-08T10:59:59Z') -AtlasReceiptSha256 ('c' * 64)
            } `
            -WriteHermesTaskEvidence { param($Content) $manifestClassificationCalls.evidence++ } `
            -CleanupAtlasTemporary { $manifestClassificationCalls.cleanup++ }
    } 'MANIFEST_MISMATCH stage=HERMES_TASK_EVIDENCE task evidence timestamps out of order' 'task evidence validation classification survives cleanup'
    Assert-Equal 0 $manifestClassificationCalls.evidence 'manifest mismatch skips task evidence write'
    Assert-Equal 1 $manifestClassificationCalls.cleanup 'manifest mismatch attempts cleanup'
    Assert-Equal 'CROSSNODE_SYNC_FAILED code=NATIVE_COMMAND_FAILED stage=ATLAS_RECEIPT_PUBLISH' `
        (Format-CrossNodeSyncFailure -ExceptionMessage 'NATIVE_COMMAND_FAILED stage=ATLAS_RECEIPT_PUBLISH exit=9 command=cmd.exe' -DefaultCode 'RECEIPT_PERSIST_FAILED') `
        'native publication stage is recorded without native detail'
    Assert-Equal 'CROSSNODE_SYNC_FAILED code=MANIFEST_MISMATCH stage=HERMES_TASK_EVIDENCE' `
        (Format-CrossNodeSyncFailure -ExceptionMessage 'MANIFEST_MISMATCH stage=HERMES_TASK_EVIDENCE task evidence timestamps out of order' -DefaultCode 'RECEIPT_PERSIST_FAILED') `
        'manifest publication stage is recorded without validation detail'

    $target = Join-Path $root 'crossnode-sync-receipt.json'
    Write-AtomicUtf8File -Path $target -Content $receipt
    Assert-Equal $receipt ([IO.File]::ReadAllText($target)) 'atomic content'
    if (Get-ChildItem $root -Filter '*.tmp' -Recurse) { throw 'temporary file leaked' }
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force
}
Write-Output 'PRODUCER_TESTS_PASS'
