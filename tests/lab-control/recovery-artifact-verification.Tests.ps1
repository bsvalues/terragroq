# Behavioral tests for Assert-ManifestRecoveryArtifacts.
#
# Why this exists: verify-offhost-restore.ps1 publishes an off-host restore PASS. It downloaded and
# hashed only the proof and appliance-config archives while the manifest it consumed also recorded the
# PostgreSQL / Redis / Open WebUI / Portainer volume archives, so a generation whose replica volumes
# were missing or corrupt still produced a PASS receipt. The invariant below is what makes that receipt
# honest, and it is exercised here without a live replica because the remote digest lookup is injected.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $repoRoot 'scripts\lab-control\hermes\crossnode-sync-lib.ps1')

function New-TestArtifact {
    param([string]$Root, [string]$Name, [string]$Body = 'payload')

    $path = Join-Path $Root $Name
    [IO.File]::WriteAllText($path, $Body, [Text.UTF8Encoding]::new($false))
    $item = Get-Item -LiteralPath $path
    return [pscustomobject][ordered]@{
        role   = 'docker-volume:test'
        name   = $Name
        bytes  = [int64]$item.Length
        sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
    }
}

function Get-ThrownCode {
    param([scriptblock]$Body)
    try { & $Body | Out-Null; return '' } catch { return $_.Exception.Message }
}

Describe 'Assert-ManifestRecoveryArtifacts' {
    $root = $null

    BeforeEach {
        $script:root = Join-Path $env:TEMP ('recovery-test-' + [guid]::NewGuid().ToString('N'))
        $null = New-Item -ItemType Directory -Path $script:root
    }
    AfterEach {
        if ($script:root -and (Test-Path -LiteralPath $script:root)) {
            Remove-Item -LiteralPath $script:root -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'verifies every artifact the manifest records, not only the downloaded ones' {
        $a = New-TestArtifact $script:root 'hermes-volumes-postgres-20260910_120000.tar.gz'
        $b = New-TestArtifact $script:root 'hermes-volumes-redis-20260910_120000.tar.gz'
        $c = New-TestArtifact $script:root 'hermes-appliance-config-20260910_120000.tar.gz'
        $manifest = [pscustomobject]@{ artifacts = @($a, $b, $c) }

        # The replica answers with the recorded digest for each path, so all three are provable.
        $byPath = @{}
        foreach ($x in @($a, $b, $c)) { $byPath['/replica/' + $x.name] = $x.sha256 }
        $hasher = { param($p) $byPath[$p] }.GetNewClosure()

        $result = @(Assert-ManifestRecoveryArtifacts -Manifest $manifest -LocalRoot $script:root -RemoteRoot '/replica/' -GetRemoteSha256 $hasher)
        ($result.Count) | Should Be 3
        ($result -contains $a.name) | Should Be $true
        ($result -contains $b.name) | Should Be $true
    }

    It 'refuses a generation whose recorded artifact is absent from the local archive root' {
        $missing = [pscustomobject][ordered]@{ role = 'docker-volume:x'; name = 'absent.tar.gz'; bytes = 7; sha256 = ('a' * 64) }
        $manifest = [pscustomobject]@{ artifacts = @($missing) }
        $hasher = { param($p) ('a' * 64) }

        $code = Get-ThrownCode { Assert-ManifestRecoveryArtifacts -Manifest $manifest -LocalRoot $script:root -RemoteRoot '/replica/' -GetRemoteSha256 $hasher }
        ($code -like 'RECOVERY_ARTIFACT_LOCAL_MISSING*') | Should Be $true
    }

    It 'refuses an artifact whose local bytes do not match the recorded digest' {
        $a = New-TestArtifact $script:root 'tampered.tar.gz'
        $record = [pscustomobject][ordered]@{ role = 'docker-volume:x'; name = $a.name; bytes = $a.bytes; sha256 = ('b' * 64) }
        $manifest = [pscustomobject]@{ artifacts = @($record) }
        $hasher = { param($p) ('b' * 64) }

        $code = Get-ThrownCode { Assert-ManifestRecoveryArtifacts -Manifest $manifest -LocalRoot $script:root -RemoteRoot '/replica/' -GetRemoteSha256 $hasher }
        ($code -like 'RECOVERY_ARTIFACT_LOCAL_HASH_MISMATCH*') | Should Be $true
    }

    It 'refuses a byte count that disagrees with the record' {
        $a = New-TestArtifact $script:root 'resized.tar.gz'
        $record = [pscustomobject][ordered]@{ role = 'docker-volume:x'; name = $a.name; bytes = ($a.bytes + 1); sha256 = $a.sha256 }
        $manifest = [pscustomobject]@{ artifacts = @($record) }
        $hasher = { param($p) $a.sha256 }

        $code = Get-ThrownCode { Assert-ManifestRecoveryArtifacts -Manifest $manifest -LocalRoot $script:root -RemoteRoot '/replica/' -GetRemoteSha256 $hasher }
        ($code -like 'RECOVERY_ARTIFACT_SIZE_MISMATCH*') | Should Be $true
    }

    It 'refuses when the replica digest differs from the manifest' {
        $a = New-TestArtifact $script:root 'drifted.tar.gz'
        $manifest = [pscustomobject]@{ artifacts = @($a) }
        $hasher = { param($p) ('c' * 64) }

        $code = Get-ThrownCode { Assert-ManifestRecoveryArtifacts -Manifest $manifest -LocalRoot $script:root -RemoteRoot '/replica/' -GetRemoteSha256 $hasher }
        ($code -like 'REMOTE_ARTIFACT_HASH_MISMATCH*') | Should Be $true
    }

    It 'refuses a replica answer that is not a digest' {
        $a = New-TestArtifact $script:root 'x.tar.gz'
        $manifest = [pscustomobject]@{ artifacts = @($a) }
        $hasher = { param($p) 'no such file or directory' }

        $code = Get-ThrownCode { Assert-ManifestRecoveryArtifacts -Manifest $manifest -LocalRoot $script:root -RemoteRoot '/replica/' -GetRemoteSha256 $hasher }
        ($code -like 'REMOTE_HASH_INVALID*') | Should Be $true
    }

    It 'refuses a duplicated artifact name' {
        $a = New-TestArtifact $script:root 'dup.tar.gz'
        $manifest = [pscustomobject]@{ artifacts = @($a, $a) }
        $hasher = { param($p) $a.sha256 }

        $code = Get-ThrownCode { Assert-ManifestRecoveryArtifacts -Manifest $manifest -LocalRoot $script:root -RemoteRoot '/replica/' -GetRemoteSha256 $hasher }
        ($code -like 'RECOVERY_MANIFEST_ARTIFACT_DUPLICATE*') | Should Be $true
    }

    It 'refuses a recorded digest that is not a digest' {
        $record = [pscustomobject][ordered]@{ role = 'docker-volume:x'; name = 'bad.tar.gz'; bytes = 1; sha256 = 'not-a-digest' }
        $manifest = [pscustomobject]@{ artifacts = @($record) }
        $hasher = { param($p) ('d' * 64) }

        $code = Get-ThrownCode { Assert-ManifestRecoveryArtifacts -Manifest $manifest -LocalRoot $script:root -RemoteRoot '/replica/' -GetRemoteSha256 $hasher }
        ($code -like 'RECOVERY_MANIFEST_ARTIFACT_HASH_INVALID*') | Should Be $true
    }

    It 'refuses an artifact name that would steer a path' {
        $record = [pscustomobject][ordered]@{ role = 'docker-volume:x'; name = '..\escaped.tar.gz'; bytes = 1; sha256 = ('e' * 64) }
        $manifest = [pscustomobject]@{ artifacts = @($record) }
        $hasher = { param($p) ('e' * 64) }

        $code = Get-ThrownCode { Assert-ManifestRecoveryArtifacts -Manifest $manifest -LocalRoot $script:root -RemoteRoot '/replica/' -GetRemoteSha256 $hasher }
        ($code -like 'UNSAFE_RECOVERY_ARTIFACT_NAME*') | Should Be $true
    }

    It 'refuses an empty manifest rather than certifying nothing' {
        $manifest = [pscustomobject]@{ artifacts = @() }
        $hasher = { param($p) ('f' * 64) }

        $code = Get-ThrownCode { Assert-ManifestRecoveryArtifacts -Manifest $manifest -LocalRoot $script:root -RemoteRoot '/replica/' -GetRemoteSha256 $hasher }
        ($code -like 'RECOVERY_MANIFEST_ARTIFACTS_EMPTY*') | Should Be $true
    }
}
