$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RuntimeRoot = 'C:\Program Files\WilliamOS\EmbeddingRuntime'
$PythonRoot = 'C:\Program Files\WilliamOS\EmbeddingRuntime\Python313'
$PythonExecutable = 'C:\Program Files\WilliamOS\EmbeddingRuntime\Python313\python.exe'
$SitePackagesRoot = 'C:\Program Files\WilliamOS\EmbeddingRuntime\Python313\Lib\site-packages'
$ModelRoot = 'C:\Program Files\WilliamOS\EmbeddingRuntime\models\granite-embedding-311m-multilingual-r2'
$ClosureManifestPath = 'C:\Program Files\WilliamOS\EmbeddingRuntime\runtime-closure.json'
$ExpectedModelArtifacts = @(
  [ordered]@{ path = 'onnx/model_quint8_avx2.onnx'; sha256 = 'f1fdd44e7e1ac51f12ab7957c7bd092e064d596c288513bf9d326842f669edee'; byte_length = [UInt64]313421909 },
  [ordered]@{ path = 'tokenizer.json'; sha256 = '0087c868b33bad550a78a08d19798cfd7f713cde4f020803b8f51f405503e15f'; byte_length = [UInt64]33384821 },
  [ordered]@{ path = 'tokenizer_config.json'; sha256 = '7947bdf0378520e69ca412b8c4dacd1cffa8aef099f851fdd5c65aa27c6b36a0'; byte_length = [UInt64]1155500 },
  [ordered]@{ path = 'config.json'; sha256 = 'e1e3fc842a8e0537e25d6e4c93879698b92ae96722e8c162bef334b57978a3b0'; byte_length = [UInt64]1191 },
  [ordered]@{ path = 'special_tokens_map.json'; sha256 = 'cb9e60dcf4d8d314315cb3e761fe4c2e664fda8dbf66d7815372b2639e381182'; byte_length = [UInt64]694 },
  [ordered]@{ path = '1_Pooling/config.json'; sha256 = '781299da695e58439d70d491840da22ea0935d1d57d9646eb9725f1f19754e89'; byte_length = [UInt64]313 },
  [ordered]@{ path = 'modules.json'; sha256 = '84e40c8e006c9b1d6c122e02cba9b02458120b5fb0c87b746c41e0207cf642cf'; byte_length = [UInt64]349 },
  [ordered]@{ path = 'config_sentence_transformers.json'; sha256 = 'f09adf93fcf868bb2fc3976a435d810b2ecdffa953d1da091d2a91168abab44b'; byte_length = [UInt64]283 },
  [ordered]@{ path = 'sentence_bert_config.json'; sha256 = '967ef958285e4a7a37d8ff1832473d967edd913b4e48572f31c3d3ea361d5327'; byte_length = [UInt64]60 }
)

function Stop-Closed([string]$Code) { throw "HERMES_GRANITE_R2_COLLECTOR_$Code" }
function Get-Sha256([byte[]]$Bytes) {
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($algorithm.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() } finally { $algorithm.Dispose() }
}
function Get-FileSha256([string]$Path) {
  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() } finally { $algorithm.Dispose() }
  } finally { $stream.Dispose() }
}
function Assert-RegularPath([string]$Path, [bool]$Leaf) {
  if (-not (Test-Path -LiteralPath $Path -PathType $(if ($Leaf) { 'Leaf' } else { 'Container' }))) { Stop-Closed 'PATH_MISSING' }
  $item = Get-Item -LiteralPath $Path -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Stop-Closed 'REPARSE_POINT_WALL' }
}
function Get-RelativeSlashPath([string]$Root, [string]$Path) {
  $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
  $pathFull = [IO.Path]::GetFullPath($Path)
  if (-not $pathFull.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) { Stop-Closed 'PATH_ESCAPE' }
  return $pathFull.Substring($rootFull.Length).Replace('\', '/')
}
function ConvertTo-CanonicalNode($Value) {
  if ($null -eq $Value -or $Value -is [string] -or $Value -is [bool] -or $Value -is [ValueType]) { return $Value }
  if ($Value -is [Collections.IDictionary] -or $Value -is [Management.Automation.PSCustomObject]) {
    $ordered = [ordered]@{}
    foreach ($property in @($Value.PSObject.Properties.Name | Sort-Object -CaseSensitive)) { $ordered[$property] = ConvertTo-CanonicalNode $Value.$property }
    return $ordered
  }
  if ($Value -is [Collections.IEnumerable]) { return @($Value | ForEach-Object { ConvertTo-CanonicalNode $_ }) }
  Stop-Closed 'MANIFEST_VALUE_INVALID'
}
function Get-CanonicalJsonSha256($Value) {
  $json = (ConvertTo-CanonicalNode $Value) | ConvertTo-Json -Compress -Depth 20
  return Get-Sha256 ([Text.Encoding]::UTF8.GetBytes($json))
}
function Read-Manifest([string]$Path) {
  Assert-RegularPath $Path $true
  try { return [IO.File]::ReadAllText($Path, [Text.UTF8Encoding]::new($false, $true)) | ConvertFrom-Json } catch { Stop-Closed 'MANIFEST_INVALID' }
}
function Assert-ExactKeys($Value, [string[]]$Keys) {
  $actual = @($Value.PSObject.Properties.Name | Sort-Object)
  $expected = @($Keys | Sort-Object)
  if (($actual -join "`n") -cne ($expected -join "`n")) { Stop-Closed 'MANIFEST_FIELDS_INVALID' }
}
function Assert-ManifestFiles($Entries, [string]$Root, [string[]]$ExpectedPaths, [string]$Code, [string]$SizeKey = 'byte_length', [string]$ExcludedFile = '') {
  $entriesArray = @($Entries)
  if ($entriesArray.Count -ne $ExpectedPaths.Count) { Stop-Closed $Code }
  $actualFiles = @(Get-ChildItem -LiteralPath $Root -File -Recurse -Force | Where-Object { -not $ExcludedFile -or -not [StringComparer]::OrdinalIgnoreCase.Equals($_.FullName, $ExcludedFile) } | ForEach-Object { Get-RelativeSlashPath $Root $_.FullName } | Sort-Object -CaseSensitive)
  if (($actualFiles -join "`n") -cne (@($ExpectedPaths | Sort-Object -CaseSensitive) -join "`n")) { Stop-Closed $Code }
  $observed = [Collections.Generic.List[object]]::new()
  for ($index = 0; $index -lt $ExpectedPaths.Count; $index += 1) {
    $entry = $entriesArray[$index]
    Assert-ExactKeys $entry @('path', 'sha256', $SizeKey)
    [UInt64]$entrySize = $entry.$SizeKey
    if ([string]$entry.path -cne $ExpectedPaths[$index] -or [string]$entry.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $entrySize -lt 1) { Stop-Closed $Code }
    $file = [IO.Path]::GetFullPath((Join-Path $Root ([string]$entry.path).Replace('/', '\')))
    Assert-RegularPath $file $true
    $info = [IO.FileInfo]::new($file)
    if ([UInt64]$info.Length -ne $entrySize -or (Get-FileSha256 $file) -cne [string]$entry.sha256) { Stop-Closed $Code }
    $observed.Add([ordered]@{ path = [string]$entry.path; sha256 = [string]$entry.sha256; byte_length = $entrySize })
  }
  return @($observed)
}
function Assert-RuntimeAcl([string]$Path) {
  $systemSid = 'S-1-5-18'; $trustedInstallerSid = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'; $usersSid = 'S-1-5-32-545'; $administratorsSid = 'S-1-5-32-544'
  $acl = Get-Acl -LiteralPath $Path
  $ownerSid = ([Security.Principal.NTAccount]$acl.Owner).Translate([Security.Principal.SecurityIdentifier]).Value
  if ($ownerSid -cne $trustedInstallerSid) { Stop-Closed 'ACL_OWNER_WALL' }
  $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object AccessControlType -eq Allow)
  $writeRights = [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
  foreach ($sid in @($systemSid, $trustedInstallerSid)) {
    if (@($rules | Where-Object { $_.IdentityReference.Value -ceq $sid -and ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl }).Count -lt 1) { Stop-Closed 'ACL_MACHINE_WALL' }
  }
  foreach ($sid in @($usersSid, $administratorsSid)) {
    $principalRules = @($rules | Where-Object { $_.IdentityReference.Value -ceq $sid })
    if ($principalRules.Count -lt 1 -or @($principalRules | Where-Object { ($_.FileSystemRights -band $writeRights) -ne 0 }).Count -ne 0) { Stop-Closed 'ACL_WRITE_WALL' }
  }
  foreach ($rule in $rules) { if (@($systemSid, $trustedInstallerSid) -cnotcontains $rule.IdentityReference.Value -and ($rule.FileSystemRights -band $writeRights) -ne 0) { Stop-Closed 'ACL_WRITE_WALL' } }
  return $acl
}

if ($args.Count -ne 0) { Stop-Closed 'ARGUMENTS_FORBIDDEN' }
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { Stop-Closed 'WINDOWS_REQUIRED' }
foreach ($directory in @($RuntimeRoot, $PythonRoot, $SitePackagesRoot, $ModelRoot)) { Assert-RegularPath $directory $false }
foreach ($file in @($PythonExecutable, $ClosureManifestPath)) { Assert-RegularPath $file $true }

$systemProduct = Get-CimInstance Win32_ComputerSystemProduct
$computer = Get-CimInstance Win32_ComputerSystem
$operatingSystem = Get-CimInstance Win32_OperatingSystem
$machineId = ([string]$systemProduct.UUID).Trim().ToLowerInvariant()
if (-not $machineId) { Stop-Closed 'MACHINE_ID_WALL' }
$machineIdSha256 = Get-Sha256 ([Text.Encoding]::UTF8.GetBytes($machineId))

$runtimeAcl = Assert-RuntimeAcl $RuntimeRoot
$runtimeOwner = [string]$runtimeAcl.Owner
if (-not $runtimeOwner) { Stop-Closed 'OWNER_WALL' }
$runtimeSddl = $runtimeAcl.Sddl
if (-not $runtimeSddl) { Stop-Closed 'ACL_WALL' }
$runtimeAclSha256 = Get-Sha256 ([Text.Encoding]::UTF8.GetBytes($runtimeSddl))
foreach ($child in Get-ChildItem -LiteralPath $RuntimeRoot -Force -Recurse) { [void](Assert-RuntimeAcl $child.FullName) }

$closureBytes = [IO.File]::ReadAllBytes($ClosureManifestPath)
$closure = Read-Manifest $ClosureManifestPath
Assert-ExactKeys $closure @('root', 'schema_version', 'entries')
if ((@($closure.PSObject.Properties.Name | Sort-Object) -join ',') -cne 'entries,root,schema_version') { Stop-Closed 'CLOSURE_IDENTITY_WALL' }
if ($closure.schema_version -cne '1.0-williamos-embedding-runtime-closure' -or $closure.root -cne $RuntimeRoot) { Stop-Closed 'CLOSURE_IDENTITY_WALL' }
$closurePaths = @($closure.entries | ForEach-Object { [string]$_.path })
if ($closurePaths.Count -lt 10 -or @($closurePaths | Where-Object { $_ -ceq 'Python313\python.exe' }).Count -ne 1) { Stop-Closed 'CLOSURE_FILE_SET_WALL' }
$closureFiles = Assert-ManifestFiles $closure.entries $RuntimeRoot $closurePaths 'CLOSURE_DRIFT_WALL' 'size_bytes' $ClosureManifestPath
$pythonEntry = @($closureFiles | Where-Object path -CEQ 'Python313\python.exe')
if ($pythonEntry.Count -ne 1) { Stop-Closed 'PYTHON_BINDING_WALL' }
$pythonSha256 = Get-FileSha256 $PythonExecutable
if ($pythonSha256 -cne $pythonEntry[0].sha256) { Stop-Closed 'PYTHON_DIGEST_WALL' }
$closureManifestSha256 = Get-Sha256 $closureBytes

$expectedModelPaths = @($ExpectedModelArtifacts | ForEach-Object { [string]$_.path })
$modelArtifacts = Assert-ManifestFiles $ExpectedModelArtifacts $ModelRoot $expectedModelPaths 'MODEL_DRIFT_WALL'
$modelManifest = [ordered]@{ schema_version = '1.0-granite-r2-model-artifact-manifest'; model_id = 'ibm-granite/granite-embedding-311m-multilingual-r2'; revision = '44399559930365213510b1ee2eb15ded83374f0e'; dimension = 768; backend = 'local-python-onnx-cls-v1'; artifacts = $modelArtifacts }
$modelManifestSha256 = Get-CanonicalJsonSha256 $modelManifest

$cpuThreads = [int]$computer.NumberOfLogicalProcessors
$memoryTotal = [UInt64]$computer.TotalPhysicalMemory
$memoryAvailable = [UInt64]$operatingSystem.FreePhysicalMemory * 1024
if ($cpuThreads -lt 1 -or $memoryTotal -lt 1 -or $memoryAvailable -lt 1) { Stop-Closed 'RESOURCE_WALL' }
$inventory = [ordered]@{ node_id = 'hermes-node'; machine_id_sha256 = $machineIdSha256; cpu_threads = $cpuThreads; memory_total_bytes = $memoryTotal; python_sha256 = $pythonSha256; closure_manifest_sha256 = $closureManifestSha256; closure_file_count = $closureFiles.Count; runtime_owner = $runtimeOwner; runtime_acl_sha256 = $runtimeAclSha256; model_manifest_sha256 = $modelManifestSha256 }
$observedAt = [DateTime]::UtcNow
[ordered]@{
  schema_version = '1.0-resident-hermes-granite-r2-runtime-observation'
  collector_id = 'reviewed-resident-hermes-granite-r2-collector'
  node_id = 'hermes-node'
  machine_id_sha256 = $machineIdSha256
  inventory_snapshot_sha256 = Get-CanonicalJsonSha256 $inventory
  python_sha256 = $pythonSha256
  closure_manifest_sha256 = $closureManifestSha256
  closure_file_count = $closureFiles.Count
  runtime_owner = $runtimeOwner
  runtime_acl_sha256 = $runtimeAclSha256
  model_manifest_sha256 = $modelManifestSha256
  model_artifacts = $modelArtifacts
  resources = [ordered]@{ cpu_threads = $cpuThreads; memory_total_bytes = $memoryTotal; memory_available_bytes = $memoryAvailable }
  observed_at = $observedAt.ToString('o')
  expires_at = $observedAt.AddMinutes(5).ToString('o')
} | ConvertTo-Json -Compress -Depth 12
