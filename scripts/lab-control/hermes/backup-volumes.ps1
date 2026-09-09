# Snapshot HERMES local state to the labelled archive volume.
#
# This remains the canonical HERMES local backup producer. It now emits two kinds of artifacts in
# the SAME directory consumed by crossnode-sync.ps1:
#   1. the existing Docker-volume archives; and
#   2. one bounded appliance/config archive plus a cryptographically described recovery-proof archive.
#
# crossnode-sync.ps1 already copies every *.tar.gz in this directory off HERMES and verifies the
# source/destination manifest. Keeping the recovery generation here means we strengthen the existing
# chain instead of inventing a second backup framework.
[CmdletBinding()]
param(
  [switch]$ResolveOnly,
  [string]$ArchiveVolumeLabel = "HERMES_NVME",
  [string]$HermesLabRoot = "C:\HermesLab"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-ArchiveRoot {
  param([string]$Label)
  $candidates = @(Get-Volume -ErrorAction Stop | Where-Object { $_.FileSystemLabel -eq $Label -and $_.DriveLetter })
  if ($candidates.Count -eq 0) {
    throw "ARCHIVE_VOLUME_ABSENT: no mounted volume is labelled '$Label'. Nothing was backed up."
  }
  if ($candidates.Count -gt 1) {
    $letters = ($candidates | ForEach-Object { $_.DriveLetter }) -join ", "
    throw "ARCHIVE_VOLUME_AMBIGUOUS: $($candidates.Count) volumes are labelled '$Label' ($letters). Refusing to guess."
  }
  return "$($candidates[0].DriveLetter):"
}

function Get-ArtifactRecord {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Role
  )
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "RECOVERY_ARTIFACT_MISSING role=$Role path=$Path"
  }
  $item = Get-Item -LiteralPath $Path -ErrorAction Stop
  if ($item.Length -le 0) {
    throw "RECOVERY_ARTIFACT_EMPTY role=$Role path=$Path"
  }
  [pscustomobject][ordered]@{
    role = $Role
    name = $item.Name
    bytes = [int64]$item.Length
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $item.FullName).Hash.ToLowerInvariant()
  }
}

function Invoke-CheckedTar {
  param([string[]]$Arguments)
  & tar @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "RECOVERY_TAR_FAILED exit=$LASTEXITCODE"
  }
}

function Copy-RecoveryFile {
  param(
    [Parameter(Mandatory=$true)][string]$RelativePath,
    [Parameter(Mandatory=$true)][string]$SourceRoot,
    [Parameter(Mandatory=$true)][string]$StageRoot,
    [switch]$Optional
  )
  if (($RelativePath -match '(^|[\\/])\.env($|\.)' -and $RelativePath -notmatch '(?i)\.env\.example$') -or $RelativePath -match '(?i)(\.log$|\.bak(?:[-.]|$)|heartbeat$)') {
    throw "RECOVERY_ALLOWLIST_UNSAFE path=$RelativePath"
  }
  $source = Join-Path $SourceRoot $RelativePath
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    if ($Optional) { return $null }
    throw "RECOVERY_REQUIRED_CONFIG_MISSING path=$RelativePath"
  }
  $item = Get-Item -LiteralPath $source -Force -ErrorAction Stop
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "RECOVERY_CONFIG_REPARSE_POINT path=$RelativePath"
  }
  if ($item.Length -gt 4MB) {
    throw "RECOVERY_CONFIG_OVERSIZE path=$RelativePath bytes=$($item.Length)"
  }
  $destination = Join-Path $StageRoot $RelativePath
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination -Force
  [pscustomobject][ordered]@{
    path = ($RelativePath -replace '\\', '/')
    bytes = [int64]$item.Length
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash.ToLowerInvariant()
  }
}

function Copy-ProtectedTaskDefinition {
  param(
    [Parameter(Mandatory=$true)][string]$SourcePath,
    [Parameter(Mandatory=$true)][string]$ExpectedSha256,
    [Parameter(Mandatory=$true)][string]$TaskName,
    [Parameter(Mandatory=$true)][string]$StageRoot
  )
  if($TaskName -notmatch '^[A-Za-z0-9-]+$' -or $ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$'){throw 'RECOVERY_TASK_DEFINITION_METADATA_INVALID'}
  if(-not (Test-Path -LiteralPath $SourcePath -PathType Leaf)){throw "RECOVERY_TASK_DEFINITION_MISSING task=$TaskName"}
  $actual=(Get-FileHash -LiteralPath $SourcePath -Algorithm SHA256).Hash
  if($actual -ine $ExpectedSha256){throw "RECOVERY_TASK_DEFINITION_HASH_MISMATCH task=$TaskName"}
  $relative="task-definitions/$TaskName.xml"
  $destination=Join-Path $StageRoot ($relative -replace '/','\')
  New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force|Out-Null
  Copy-Item -LiteralPath $SourcePath -Destination $destination -Force
  $item=Get-Item -LiteralPath $destination -ErrorAction Stop
  [pscustomobject][ordered]@{path=$relative;bytes=[int64]$item.Length;sha256=$actual.ToLowerInvariant()}
}

function Copy-ProtectedRecoveryFile {
  param(
    [Parameter(Mandatory=$true)][string]$SourcePath,
    [Parameter(Mandatory=$true)][string]$RelativePath,
    [Parameter(Mandatory=$true)][string]$StageRoot,
    [switch]$Optional
  )
  if($RelativePath -notmatch '^protected-state/[A-Za-z0-9._/-]+$' -or $RelativePath -match '(?:^|/)\.\.(?:/|$)'){throw 'RECOVERY_PROTECTED_STATE_PATH_INVALID'}
  if(-not (Test-Path -LiteralPath $SourcePath -PathType Leaf)){
    if($Optional){return $null}
    throw "RECOVERY_PROTECTED_STATE_MISSING path=$RelativePath"
  }
  if((Get-Item -LiteralPath $SourcePath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw "RECOVERY_PROTECTED_STATE_REPARSE_REFUSED path=$RelativePath"}
  $destination=Join-Path $StageRoot ($RelativePath -replace '/','\')
  New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force|Out-Null
  Copy-Item -LiteralPath $SourcePath -Destination $destination -Force
  $item=Get-Item -LiteralPath $destination -ErrorAction Stop
  [pscustomobject][ordered]@{path=$RelativePath;bytes=[int64]$item.Length;sha256=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()}
}

$archiveRoot = Resolve-ArchiveRoot -Label $ArchiveVolumeLabel
$backupDir = Join-Path $archiveRoot "lab-backups\hermes-volumes"
$backupMount = $backupDir -replace '\\', '/'

if ($ResolveOnly) {
  [pscustomobject][ordered]@{
    archiveVolumeLabel = $ArchiveVolumeLabel
    archiveRoot        = $archiveRoot
    backupDir          = $backupDir
    backupMount        = $backupMount
    backupDirExists    = (Test-Path -LiteralPath $backupDir)
    hermesLabRoot      = $HermesLabRoot
    hermesLabExists    = (Test-Path -LiteralPath $HermesLabRoot -PathType Container)
  } | ConvertTo-Json -Compress
  exit 0
}

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$observedAt = [DateTimeOffset]::UtcNow.ToString('o')
$created = New-Object System.Collections.Generic.List[object]
$failed = New-Object System.Collections.Generic.List[string]

# Existing named-volume backups. These remain local state snapshots; database restore truth is
# established separately by the recovery target. A successful task may not mean merely "loop ended".
$vols = @(
  "hermes_pgdata","hermes_redisdata","hermes_webuidata","hermes_portainerdata",
  "terrafusion_final_build_20250615_051930_mongo_data",
  "terrafusion_final_build_20250615_051930_postgres_data",
  "terrafusion_final_build_20250615_051930_redis_data"
)
Write-Host "Backing up $($vols.Count) volumes to $backupDir (stamp $stamp)"
foreach ($v in $vols) {
  $out = "$v-$stamp.tar.gz"
  Write-Host ">> $v"
  & docker run --rm -v "${v}:/data:ro" -v "${backupMount}:/backup" alpine sh -c "tar czf /backup/$out -C /data ." 2>&1 | Out-Null
  $dockerExit = $LASTEXITCODE
  $f = Join-Path $backupDir $out
  if ($dockerExit -eq 0 -and (Test-Path -LiteralPath $f -PathType Leaf) -and (Get-Item -LiteralPath $f).Length -gt 0) {
    $created.Add((Get-ArtifactRecord -Path $f -Role "docker-volume:$v"))
    Write-Host ("   OK - {0} MB" -f [int]((Get-Item -LiteralPath $f).Length/1MB))
  } else {
    Write-Host "   FAILED"
    $failed.Add($v)
  }
}

# Tier-A appliance/config generation. The live C:\HermesLab root is intentionally a junk drawer;
# archiving `.` would capture WilliamOS runtime copies, logs, release bundles, and secrets such as
# hermes/.env. Recovery therefore uses a closed HERMES allowlist and records every included byte.
if (-not (Test-Path -LiteralPath $HermesLabRoot -PathType Container)) {
  $failed.Add('hermes-appliance-config')
  Write-Host "HermesLab root missing: $HermesLabRoot"
} else {
  $configArchive = Join-Path $backupDir "hermes-appliance-config-$stamp.tar.gz"
  $configStage = Join-Path $env:TEMP "hermes-appliance-config-$stamp-$([guid]::NewGuid().ToString('N'))"
  try {
    New-Item -ItemType Directory -Force -Path $configStage | Out-Null
    $requiredConfig = @(
      'README.md',
      'SERVICE-MAP.md',
      'hermes/backup-volumes.ps1',
      'hermes/crossnode-sync.ps1',
      'hermes/crossnode-sync-lib.ps1',
      'hermes/verify-offhost-restore.ps1',
      'hermes/docker-compose.yml',
      'hermes/lab-health.ps1',
      'hermes/p40-guard.ps1',
      'hermes/start-hermes.ps1',
      'hermes/deploy-hermes-appliance.ps1',
      'hermes/morning-report.ps1',
      'hermes/send-hermes-alert.ps1',
      'hermes/terrafusion-report.ps1',
      'hermes/verify-durability-after-reboot.ps1'
    )
    $optionalConfig = @(
      'hermes/.env.example',
      'hermes/HERMES-COMMISSIONED.md',
      'hermes/hermes-acceptance.ps1',
      'hermes/hermes-placement.json',
      'hermes/hermes-placement-readiness.ps1',
      'hermes/install-p40-watch.ps1',
      'hermes/sync-models-to-forge.ps1',
      'hermes/test-crossnode-sync-receipt.ps1',
      'aegis/backup-v1.sh'
    )
    $configInventory = New-Object System.Collections.Generic.List[object]
    foreach ($relative in $requiredConfig) {
      $configInventory.Add((Copy-RecoveryFile -RelativePath $relative -SourceRoot $HermesLabRoot -StageRoot $configStage))
    }
    foreach ($relative in $optionalConfig) {
      $record = Copy-RecoveryFile -RelativePath $relative -SourceRoot $HermesLabRoot -StageRoot $configStage -Optional
      if ($null -ne $record) { $configInventory.Add($record) }
    }
    foreach ($recoveryDirectory in @('hermes\ollama-service','hermes\host-attestation','hermes\console','hermes\doctrine')) {
      $recoveryDirectoryRoot = Join-Path $HermesLabRoot $recoveryDirectory
      if (-not (Test-Path -LiteralPath $recoveryDirectoryRoot -PathType Container)) { continue }
      $sourceRootPrefix = [IO.Path]::GetFullPath($HermesLabRoot).TrimEnd('\') + '\'
      foreach ($file in Get-ChildItem -LiteralPath $recoveryDirectoryRoot -File -Recurse -Force | Sort-Object FullName) {
        if ($file.Extension -notin @('.ps1', '.json', '.md', '.mjs', '.js', '.css', '.html')) { continue }
        $fullName = [IO.Path]::GetFullPath($file.FullName)
        if (-not $fullName.StartsWith($sourceRootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
          throw "RECOVERY_CONFIG_PATH_ESCAPE path=$fullName"
        }
        $relative = $fullName.Substring($sourceRootPrefix.Length)
        $configInventory.Add((Copy-RecoveryFile -RelativePath $relative -SourceRoot $HermesLabRoot -StageRoot $configStage))
      }
    }
    $releaseRoot='C:\ProgramData\Hermes\release-rollback'
    $expectedTaskNames=@('HermesLabHealth','HermesP40Guard','HermesP40Watch','HermesDoctrineCheck','WilliamOS-HERMES-Ollama')
    $deployedRelease=$null
    foreach($candidate in @(Get-ChildItem -LiteralPath $releaseRoot -Directory -ErrorAction Stop|Sort-Object Name -Descending)){
      $candidateReceiptPath=Join-Path $candidate.FullName 'release.json'
      try{$candidateReceipt=Get-Content -LiteralPath $candidateReceiptPath -Raw -ErrorAction Stop|ConvertFrom-Json -ErrorAction Stop}catch{throw "RECOVERY_RELEASE_RECEIPT_INVALID release=$($candidate.Name)"}
      if([string]$candidateReceipt.schema -ne 'hermes-appliance-release/2'){continue}
      $candidateStatus=[string]$candidateReceipt.status
      if($candidateStatus -in @('STARTED','ROLLBACK_INCOMPLETE')){throw "RECOVERY_DEPLOYMENT_TRANSACTION_UNRESOLVED release=$($candidate.Name) status=$candidateStatus"}
      if($candidateStatus -eq 'DEPLOYED'){$deployedRelease=[pscustomobject]@{Directory=$candidate;Receipt=$candidateReceipt};break}
      if($candidateStatus -notin @('PRE_MUTATION_FAILED','ROLLED_BACK')){throw "RECOVERY_RELEASE_STATUS_UNKNOWN release=$($candidate.Name) status=$candidateStatus"}
    }
    if($null -eq $deployedRelease){throw 'RECOVERY_DEPLOYED_RELEASE_ABSENT'}
    $releasePrefix=[IO.Path]::GetFullPath($deployedRelease.Directory.FullName).TrimEnd('\')+'\'
    $taskRecords=@($deployedRelease.Receipt.tasks)
    foreach($taskName in $expectedTaskNames){
      $records=@($taskRecords|Where-Object{[string]$_.name -eq $taskName})
      if($records.Count -ne 1){throw "RECOVERY_TASK_DEFINITION_RECORD_INVALID task=$taskName"}
      $definitionPath=[IO.Path]::GetFullPath([string]$records[0].deployedXml)
      if(-not $definitionPath.StartsWith($releasePrefix,[StringComparison]::OrdinalIgnoreCase)){throw "RECOVERY_TASK_DEFINITION_PATH_ESCAPE task=$taskName"}
      $configInventory.Add((Copy-ProtectedTaskDefinition -SourcePath $definitionPath -ExpectedSha256 ([string]$records[0].deployedXmlSha256) -TaskName $taskName -StageRoot $configStage))
    }
    $configInventory.Add((Copy-ProtectedRecoveryFile -SourcePath (Join-Path $deployedRelease.Directory.FullName 'release.json') -RelativePath 'protected-state/deployment/release.json' -StageRoot $configStage))
    $configInventory.Add((Copy-ProtectedRecoveryFile -SourcePath 'C:\ProgramData\Hermes\doctrine\doctrine.json' -RelativePath 'protected-state/doctrine/doctrine.json' -StageRoot $configStage))
    foreach($protectedState in @(
      @{source='C:\ProgramData\Hermes\health\alerts.log';relative='protected-state/health/alerts.log'},
      @{source='C:\ProgramData\Hermes\health\health-history.jsonl';relative='protected-state/health/health-history.jsonl'}
    )){
      $record=Copy-ProtectedRecoveryFile -SourcePath $protectedState.source -RelativePath $protectedState.relative -StageRoot $configStage -Optional
      if($null -ne $record){$configInventory.Add($record)}
    }
    $inventoryPath = Join-Path $configStage 'recovery-config-inventory.json'
    [IO.File]::WriteAllText(
      $inventoryPath,
      (([pscustomobject][ordered]@{
        schema = 'hermes-recovery-config-inventory/1'
        files = @($configInventory | Sort-Object path)
      } | ConvertTo-Json -Depth 8 -Compress) + "`n"),
      (New-Object Text.UTF8Encoding($false))
    )
    Invoke-CheckedTar -Arguments @('-czf', $configArchive, '-C', $configStage, '.')
    $created.Add((Get-ArtifactRecord -Path $configArchive -Role 'hermes-appliance-config'))
    Write-Host "appliance config archive: $configArchive files=$($configInventory.Count)"
  } catch {
    $failed.Add('hermes-appliance-config')
    Write-Host "appliance config FAILED: $($_.Exception.Message)"
  } finally {
    if (Test-Path -LiteralPath $configStage) {
      Remove-Item -LiteralPath $configStage -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

# Deterministic recovery canary + manifest. The canary is generated outside the protected source,
# never dirties the repo, and is packaged with the manifest into another *.tar.gz so the existing
# cross-node transport necessarily carries and hashes it with the generation.
$stage = Join-Path $env:TEMP "hermes-recovery-$stamp-$([guid]::NewGuid().ToString('N'))"
try {
  if ($failed.Count -gt 0) {
    throw "RECOVERY_GENERATION_INCOMPLETE failed=$($failed -join ',')"
  }
  New-Item -ItemType Directory -Force -Path $stage | Out-Null
  $canaryId = [guid]::NewGuid().ToString('D').ToLowerInvariant()
  $canaryPath = Join-Path $stage 'recovery-canary.txt'
  $canaryBody = "HERMES_RECOVERY_CANARY`nrun=$stamp`nid=$canaryId`nobserved_at=$observedAt`n"
  [IO.File]::WriteAllText($canaryPath, $canaryBody, (New-Object Text.UTF8Encoding($false)))
  $canarySha = (Get-FileHash -Algorithm SHA256 -LiteralPath $canaryPath).Hash.ToLowerInvariant()

  $manifestPath = Join-Path $stage 'recovery-manifest.json'
  $manifest = [pscustomobject][ordered]@{
    schema = 'hermes-recovery-generation/1'
    run = $stamp
    observed_at = $observedAt
    archive_volume_label = $ArchiveVolumeLabel
    canary = [pscustomobject][ordered]@{
      id = $canaryId
      sha256 = $canarySha
    }
    artifacts = @($created | Sort-Object role, name)
  }
  [IO.File]::WriteAllText(
    $manifestPath,
    (($manifest | ConvertTo-Json -Depth 8 -Compress) + "`n"),
    (New-Object Text.UTF8Encoding($false))
  )

  # Re-read the manifest before sealing it; never publish a success artifact we cannot parse back.
  $roundTrip = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -ErrorAction Stop
  if ($roundTrip.schema -ne 'hermes-recovery-generation/1' -or $roundTrip.canary.sha256 -ne $canarySha) {
    throw 'RECOVERY_MANIFEST_ROUNDTRIP_FAILED'
  }

  $proofArchive = Join-Path $backupDir "hermes-recovery-proof-$stamp.tar.gz"
  Invoke-CheckedTar -Arguments @('-czf', $proofArchive, '-C', $stage, 'recovery-canary.txt', 'recovery-manifest.json')
  $proofRecord = Get-ArtifactRecord -Path $proofArchive -Role 'hermes-recovery-proof'
  Write-Host "recovery proof archive: $proofArchive sha256=$($proofRecord.sha256) canary=$canaryId"
} catch {
  $failed.Add('hermes-recovery-proof')
  Write-Host "recovery proof FAILED: $($_.Exception.Message)"
} finally {
  if (Test-Path -LiteralPath $stage) {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "`n=== backups now in $backupDir ==="
Get-ChildItem $backupDir -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending |
  Select-Object @{n='MB';e={[int]($_.Length/1MB)}}, Name | Format-Table -Auto | Out-String

# Retention is only applied after the new generation was attempted. Never prune as a substitute for
# creating a good current generation.
$cutoff = (Get-Date).AddDays(-14)
$old = @(Get-ChildItem $backupDir -Filter *.tar.gz -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt $cutoff })
if ($failed.Count -eq 0 -and $old.Count -gt 0) {
  $old | Remove-Item -Force -ErrorAction SilentlyContinue
  Write-Host "pruned $($old.Count) backup(s) older than 14 days"
}

if ($failed.Count -gt 0) {
  Write-Host "BACKUP_FAILED missing=$($failed -join ',')"
  exit 1
}

Write-Host "HERMES_RECOVERY_GENERATION_READY run=$stamp artifacts=$($created.Count + 1)"
Write-Host "BACKUP_DONE"
exit 0
