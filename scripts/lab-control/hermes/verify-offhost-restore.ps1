# Read back the existing ATLAS replica; never restore over live services or data.
[CmdletBinding()]
param(
    [string]$ArchiveVolumeLabel = 'HERMES_NVME',
    [string]$FabricRoot = "$env:USERPROFILE\.williamos\fabric"
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\crossnode-sync-lib.ps1"

function Assert-RelativeRecoveryPath([string]$Name) {
    $clean = $Name -replace '^\./', ''
    if (-not $clean -or $clean -match '(^/|\\|:|[\x00-\x1f]|(^|/)\.\.(/|$))') {
        throw 'UNSAFE_RECOVERY_PATH'
    }
    foreach ($segment in $clean.TrimEnd('/').Split('/')) {
        if (-not $segment -or $segment -eq '.' -or $segment -match '[. ]$|[<>"|?*]' -or $segment -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') {
            throw 'UNSAFE_RECOVERY_PATH'
        }
    }
    return $clean.TrimEnd('/')
}
function Expand-CheckedRecoveryArchive([string]$Archive, [string]$Destination) {
    $names = @(Invoke-CheckedNative -FilePath 'tar.exe' -ArgumentList @('-tzf', $Archive))
    $details = @(Invoke-CheckedNative -FilePath 'tar.exe' -ArgumentList @('-tvzf', $Archive))
    if (-not $names.Count -or $names.Count -ne $details.Count -or $names.Count -gt 10000) { throw 'INVALID_RECOVERY_ARCHIVE' }
    $seen = @{}
    for ($i = 0; $i -lt $names.Count; $i++) {
        if ($names[$i] -eq './' -and $details[$i] -match '^d') { continue }
        $name = Assert-RelativeRecoveryPath $names[$i]
        if ($seen.ContainsKey($name)) { throw 'DUPLICATE_RECOVERY_PATH' }
        $seen[$name] = $true
        # Links, devices and other special members are never legitimate recovery configuration.
        if ($details[$i] -notmatch '^[-d]') { throw 'UNSAFE_RECOVERY_MEMBER_TYPE' }
    }
    $null = New-Item -ItemType Directory -Path $Destination
    Invoke-CheckedNative -FilePath 'tar.exe' -ArgumentList @('-xzf', $Archive, '-C', $Destination) | Out-Null
}
function Assert-Hash([string]$Path, [string]$Expected) {
    if ($Expected -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ine $Expected) { throw 'RESTORE_HASH_MISMATCH' }
}

$archiveRoot = Resolve-ArchiveRoot -Label $ArchiveVolumeLabel
$backupRoot = Join-Path $archiveRoot 'lab-backups\hermes-volumes'
$atlas = Resolve-AtlasEndpoint -Fabric $FabricRoot
$sshOptions = @((Resolve-FabricSshIdentity -Fabric $FabricRoot).SshOptions)
$latest = Get-ChildItem -LiteralPath $backupRoot -File -Filter 'hermes-recovery-proof-*.tar.gz' | Sort-Object Name -Descending | Select-Object -First 1
if (-not $latest -or $latest.Name -notmatch '^hermes-recovery-proof-(\d{8}_\d{6})\.tar\.gz$') { throw 'RECOVERY_GENERATION_ABSENT' }
$generation = $matches[1]
$configName = "hermes-appliance-config-$generation.tar.gz"
$stage = Join-Path $backupRoot ('restore-readback-' + $generation + '-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $stage
$completed = $false
try {
  $hashes = @{}
  foreach ($name in @($latest.Name, $configName)) {
    $localSource = Join-Path $backupRoot $name
    $remote = '/home/bs/from-hermes/' + $name
    $lines = @(Invoke-CheckedNative -FilePath 'ssh' -ArgumentList ($sshOptions + @($atlas, "sha256sum -- $remote")))
    if ($lines.Count -ne 1 -or $lines[0] -notmatch '^([a-fA-F0-9]{64})\s') { throw 'REMOTE_HASH_INVALID' }
    $hashes[$name] = $matches[1].ToLowerInvariant()
    Assert-Hash $localSource $hashes[$name]
    $download = Join-Path $stage $name
    Invoke-CheckedNative -FilePath 'scp' -ArgumentList ($sshOptions + @("${atlas}:$remote", $download)) | Out-Null
    Assert-Hash $download $hashes[$name]
  }
  $proofDir = Join-Path $stage 'proof'
  $configDir = Join-Path $stage 'config'
  Expand-CheckedRecoveryArchive (Join-Path $stage $latest.Name) $proofDir
  $manifest = Get-Content -LiteralPath (Join-Path $proofDir 'recovery-manifest.json') -Raw | ConvertFrom-Json
  if ($manifest.schema -ne 'hermes-recovery-generation/1' -or $manifest.run -ne $generation) { throw 'RECOVERY_GENERATION_MISMATCH' }
  Assert-Hash (Join-Path $proofDir 'recovery-canary.txt') $manifest.canary.sha256
  $configRecords = @($manifest.artifacts | Where-Object { $_.role -eq 'hermes-appliance-config' -and $_.name -eq $configName })
  if ($configRecords.Count -ne 1) { throw 'CONFIG_MANIFEST_INVALID' }
  Assert-Hash (Join-Path $stage $configName) $configRecords[0].sha256
  if ((Get-Item -LiteralPath (Join-Path $stage $configName)).Length -ne $configRecords[0].bytes) { throw 'CONFIG_SIZE_MISMATCH' }
  Expand-CheckedRecoveryArchive (Join-Path $stage $configName) $configDir
  $inventory = Get-Content -LiteralPath (Join-Path $configDir 'recovery-config-inventory.json') -Raw | ConvertFrom-Json
  if ($inventory.schema -ne 'hermes-recovery-config-inventory/1' -or @($inventory.files).Count -eq 0) { throw 'CONFIG_INVENTORY_INVALID' }
  $seen = @{}
  foreach ($file in $inventory.files) {
    $relative = Assert-RelativeRecoveryPath $file.path
    if ($seen.ContainsKey($relative)) { throw 'DUPLICATE_INVENTORY_PATH' }
    $seen[$relative] = $true
    $path = Join-Path $configDir $relative
    Assert-Hash $path $file.sha256
    if ((Get-Item -LiteralPath $path).Length -ne $file.bytes) { throw 'INVENTORY_SIZE_MISMATCH' }
  }
  if (@(Get-ChildItem -LiteralPath $configDir -File -Recurse).Count -ne (@($inventory.files).Count + 1)) { throw 'INVENTORY_FILE_COUNT_MISMATCH' }
  # Refuse to certify an old generation if a backup completed while this readback ran.
  $current = Get-ChildItem -LiteralPath $backupRoot -File -Filter 'hermes-recovery-proof-*.tar.gz' | Sort-Object Name -Descending | Select-Object -First 1
  if ($current.Name -ne $latest.Name) { throw 'RECOVERY_GENERATION_CHANGED_RETRY' }
  $receipt = [ordered]@{
    schema = 'hermes-offhost-restore-receipt/1'; generation = $generation; status = 'PASS'; sourceNode = 'ATLAS'
    verifiedAt = [datetime]::UtcNow.ToString('o'); proofSha256 = $hashes[$latest.Name]; configSha256 = $hashes[$configName]
    canarySha256 = $manifest.canary.sha256; canaryId = $manifest.canary.id; inventoryFileCount = @($inventory.files).Count
    evidencePath = $stage
    verification = [ordered]@{ remoteHashesMatched = $true; proofExtracted = $true; canaryMatched = $true; configExtracted = $true; configInventoryMatched = $true }
  }
  $receiptPath = Join-Path $backupRoot 'hermes-latest-restore-receipt.json'
  $temporary = Join-Path $backupRoot ('.restore-receipt-' + [guid]::NewGuid().ToString('N') + '.tmp')
  [IO.File]::WriteAllText($temporary, ($receipt | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
  if (Test-Path -LiteralPath $receiptPath) {
    # Windows PowerShell 5.1 coerces a null string argument to an empty path.
    # Keep the previous receipt with this readback's evidence instead.
      [IO.File]::Replace($temporary, $receiptPath, (Join-Path $stage 'previous-restore-receipt.json'))
  } else { [IO.File]::Move($temporary, $receiptPath) }
  $completed = $true
  foreach($downloadName in @($latest.Name,$configName)){Remove-Item -LiteralPath (Join-Path $stage $downloadName) -Force -ErrorAction Stop}
  Write-Output "OFFHOST_RESTORE_PASS generation=$generation files=$(@($inventory.files).Count) receipt=$receiptPath"
} finally {
  if(-not $completed -and (Test-Path -LiteralPath $stage -PathType Container)){
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
  }
}
