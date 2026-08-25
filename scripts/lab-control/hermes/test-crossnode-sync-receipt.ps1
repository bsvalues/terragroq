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

    # --- Resolution: where the archive is, and where ATLAS is ---------------------------------
    # These are the guards the 2026-08-25 repair added, and the reason they are unit-testable at
    # all is that they take their inputs as parameters. Every one is exercised in its REFUSING
    # direction here; the accepting direction needs real hardware and a real registry, so it is
    # proven by live control on HERMES instead. No .ps1 in this repository runs in CI.
    $fabricProbe = Join-Path $root 'fabric'
    New-Item -ItemType Directory -Path $fabricProbe | Out-Null

    Assert-ThrowsLike { Resolve-FabricNode -Fabric $fabricProbe -Node 'atlas' } `
        'FABRIC_REGISTRY_UNREADABLE*nodes.json does not exist*' 'absent registry refuses'

    $nodesProbe = Join-Path $fabricProbe 'nodes.json'
    [IO.File]::WriteAllText($nodesProbe, '{ not json')
    Assert-ThrowsLike { Resolve-FabricNode -Fabric $fabricProbe -Node 'atlas' } `
        'FABRIC_REGISTRY_UNREADABLE*not parseable JSON*' 'unparseable registry refuses'

    [IO.File]::WriteAllText($nodesProbe, '{"aegis":{"host":"192.168.88.6","user":"bs"}}')
    Assert-ThrowsLike { Resolve-FabricNode -Fabric $fabricProbe -Node 'atlas' } `
        'FABRIC_REGISTRY_INCOMPLETE*no atlas entry*' 'registry without the asked-for node refuses'

    # A node entry carrying a host but no user must refuse rather than invent one. Under
    # Set-StrictMode -Version Latest a missing property raises PropertyNotFound, which would
    # replace this typed refusal with an opaque failure -- so this test is really about the
    # PSObject.Properties read in Resolve-FabricNode, not only about the message.
    [IO.File]::WriteAllText($nodesProbe, '{"atlas":{"host":"192.168.88.8"}}')
    Assert-ThrowsLike { Resolve-FabricNode -Fabric $fabricProbe -Node 'atlas' } `
        'FABRIC_REGISTRY_INCOMPLETE*both host and user*' 'node entry without a user refuses'

    # A BOM is what Windows PowerShell 5.1 writes by default, and ConvertFrom-Json rejects it. The
    # registry is maintained by PowerShell tooling, so a reader that chokes on a BOM is a reader
    # that fails on the exact file it will actually meet.
    [IO.File]::WriteAllText($nodesProbe, '{"atlas":{"host":"192.168.88.8","user":"bs"}}', (New-Object Text.UTF8Encoding $true))
    Assert-Equal 'bs@192.168.88.8' (Resolve-AtlasEndpoint -Fabric $fabricProbe) 'BOM-prefixed registry still resolves'
    $resolvedNode = Resolve-FabricNode -Fabric $fabricProbe -Node 'atlas'
    Assert-Equal '192.168.88.8' $resolvedNode.Host 'resolved node exposes bare host for ping'
    Assert-Equal 'bs' $resolvedNode.User 'resolved node exposes user'

    # The transport identity is resolved and refused separately from the address, because on
    # 2026-08-25 the address was the half everyone noticed and the identity was the half that would
    # still have failed: the default known_hosts pins the OLD address and has never seen the new one.
    Assert-ThrowsLike { Resolve-FabricSshIdentity -Fabric $fabricProbe } `
        'FABRIC_IDENTITY_UNREADABLE*williamos-fabric does not exist*' 'absent fabric key refuses'
    New-Item -ItemType Directory -Path (Join-Path $fabricProbe 'keys') | Out-Null
    [IO.File]::WriteAllText((Join-Path $fabricProbe 'keys\williamos-fabric'), 'not-a-real-key')
    Assert-ThrowsLike { Resolve-FabricSshIdentity -Fabric $fabricProbe } `
        'FABRIC_IDENTITY_UNREADABLE*known_hosts does not exist*' 'absent known_hosts refuses'
    [IO.File]::WriteAllText((Join-Path $fabricProbe 'known_hosts'), '# empty')
    $identity = Resolve-FabricSshIdentity -Fabric $fabricProbe
    # StrictHostKeyChecking must stay yes. If the registry is ever wrong, the right outcome is a
    # refused connection, not a backup handed to whatever now holds that address.
    Assert-Equal $true ($identity.SshOptions -contains 'StrictHostKeyChecking=yes') 'identity pins strict host key checking'
    Assert-Equal $true ($identity.SshOptions -contains 'BatchMode=yes') 'identity stays non-interactive'
    Assert-Equal $true ($identity.SshOptions -contains $identity.KeyPath) 'identity names its own key'
    # Naming the key is not using it. Without IdentitiesOnly=yes, OpenSSH still offers every
    # agent identity the calling account holds, so the resolved identity is not necessarily the
    # one that authenticates -- and on an account with several keys the server can exhaust
    # MaxAuthTries before reaching this one. Asserted because it is invisible when it works.
    Assert-Equal $true ($identity.SshOptions -contains 'IdentitiesOnly=yes') 'identity is the only one offered'
    # `scp -n` is DRY RUN in OpenSSH 9.x: it would copy nothing, exit 0, and let the sync log
    # success over an empty transfer. One option list serves both ssh and scp here, so this asserts
    # the flag can never reach scp by way of a later edit to the shared list. See XN-03.
    Assert-Equal $false ($identity.SshOptions -contains '-n') 'no -n on the shared ssh/scp option list'

    # The archive root is resolved by LABEL. The volume provider is injected so both refusals can
    # run on a machine that has no such disk -- which is the whole point: the accepting path was
    # what F: used to be, and it is exactly the path that stopped being true without saying so.
    $oneVolume = { @([pscustomobject]@{ FileSystemLabel = 'HERMES_NVME'; DriveLetter = 'G' }) }
    Assert-Equal 'G:' (Resolve-ArchiveRoot -Label 'HERMES_NVME' -VolumeProvider $oneVolume) 'single labelled volume resolves to its current letter'
    Assert-ThrowsLike { Resolve-ArchiveRoot -Label 'NO_SUCH_LABEL_XYZ' -VolumeProvider $oneVolume } `
        "ARCHIVE_VOLUME_ABSENT*no mounted volume is labelled 'NO_SUCH_LABEL_XYZ'*" 'absent archive volume refuses'
    $twoVolumes = {
        @(
            [pscustomobject]@{ FileSystemLabel = 'HERMES_NVME'; DriveLetter = 'G' },
            [pscustomobject]@{ FileSystemLabel = 'HERMES_NVME'; DriveLetter = 'H' }
        )
    }
    Assert-ThrowsLike { Resolve-ArchiveRoot -Label 'HERMES_NVME' -VolumeProvider $twoVolumes } `
        'ARCHIVE_VOLUME_AMBIGUOUS*2 volumes are labelled*' 'duplicate labels refuse rather than guess'
    # An unlettered volume carrying the label is not addressable, so it must not satisfy the lookup.
    $unlettered = { @([pscustomobject]@{ FileSystemLabel = 'HERMES_NVME'; DriveLetter = $null }) }
    Assert-ThrowsLike { Resolve-ArchiveRoot -Label 'HERMES_NVME' -VolumeProvider $unlettered } `
        'ARCHIVE_VOLUME_ABSENT*' 'unlettered labelled volume does not satisfy the lookup'

    $target = Join-Path $root 'crossnode-sync-receipt.json'
    Write-AtomicUtf8File -Path $target -Content $receipt
    Assert-Equal $receipt ([IO.File]::ReadAllText($target)) 'atomic content'
    if (Get-ChildItem $root -Filter '*.tmp' -Recurse) { throw 'temporary file leaked' }
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force
}
Write-Output 'PRODUCER_TESTS_PASS'
