$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($args.Count -ne 0) { throw 'HERMES_EMBEDDING_COLLECTOR_ARGUMENT_WALL' }

$docker = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
$nvidiaSmi = 'C:\WINDOWS\system32\nvidia-smi.exe'
$pythonRuntimeRoot = 'C:\Program Files\WilliamOS\EmbeddingRuntime'
$pythonRuntimeClosureManifest = 'C:\Program Files\WilliamOS\EmbeddingRuntime\runtime-closure.json'
$python = 'C:\Program Files\WilliamOS\EmbeddingRuntime\Python313\python.exe'
$powershell = 'C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe'
$node = 'C:\Program Files\nodejs\node.exe'
$git = 'C:\Program Files\Git\cmd\git.exe'
$container = 'ollama'
$model = [Environment]::GetEnvironmentVariable('WILLIAMOS_EMBEDDING_MODEL_ID')

if ($model -notmatch '^[a-z0-9][a-z0-9._-]{0,63}:[a-z0-9][a-z0-9._-]{0,63}$') {
  throw 'HERMES_EMBEDDING_COLLECTOR_MODEL_ID_WALL'
}
foreach ($fixedExecutable in @($docker, $nvidiaSmi, $python, $powershell, $node, $git)) {
  if (-not (Test-Path -LiteralPath $fixedExecutable -PathType Leaf)) {
    throw 'HERMES_EMBEDDING_COLLECTOR_EXECUTABLE_WALL'
  }
}

function Get-Sha256([byte[]]$Bytes) {
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return -join ($algorithm.ComputeHash($Bytes) | ForEach-Object { $_.ToString('x2') }) }
  finally { $algorithm.Dispose() }
}

function Get-FileSha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Assert-NoReparsePoint([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path)
  $root = [IO.Path]::GetPathRoot($full)
  $current = $root
  foreach ($part in $full.Substring($root.Length).Split([char[]]@('\'), [StringSplitOptions]::RemoveEmptyEntries)) {
    $current = Join-Path $current $part
    if (-not [IO.File]::Exists($current) -and -not [IO.Directory]::Exists($current)) { throw 'HERMES_EMBEDDING_PYTHON_CLOSURE_PATH_WALL' }
    if (([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'HERMES_EMBEDDING_PYTHON_CLOSURE_REPARSE_WALL' }
  }
}

function Assert-RuntimeAcl([string]$Path) {
  $systemSid = 'S-1-5-18'
  $trustedInstallerSid = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
  $usersSid = 'S-1-5-32-545'
  $administratorsSid = 'S-1-5-32-544'
  $acl = Get-Acl -LiteralPath $Path
  $owner = ([Security.Principal.NTAccount]$acl.Owner).Translate([Security.Principal.SecurityIdentifier]).Value
  if ($owner -cne $trustedInstallerSid) { throw 'HERMES_EMBEDDING_PYTHON_CLOSURE_ACL_OWNER_WALL' }
  $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object AccessControlType -eq Allow)
  $writeRights = [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
  foreach ($sid in @($systemSid, $trustedInstallerSid)) {
    if (@($rules | Where-Object { $_.IdentityReference.Value -ceq $sid -and ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl }).Count -lt 1) { throw 'HERMES_EMBEDDING_PYTHON_CLOSURE_ACL_MACHINE_WALL' }
  }
  foreach ($sid in @($usersSid, $administratorsSid)) {
    $principalRules = @($rules | Where-Object { $_.IdentityReference.Value -ceq $sid })
    if ($principalRules.Count -lt 1 -or @($principalRules | Where-Object { ($_.FileSystemRights -band $writeRights) -ne 0 }).Count -ne 0) { throw 'HERMES_EMBEDDING_PYTHON_CLOSURE_ACL_WRITE_WALL' }
  }
  foreach ($rule in $rules) {
    if (@($systemSid, $trustedInstallerSid) -cnotcontains $rule.IdentityReference.Value -and ($rule.FileSystemRights -band $writeRights) -ne 0) { throw 'HERMES_EMBEDDING_PYTHON_CLOSURE_ACL_WRITE_WALL' }
  }
}

function Get-PythonRuntimeClosure {
  if ([IO.Path]::GetFullPath($pythonRuntimeRoot) -cne $pythonRuntimeRoot -or [IO.Path]::GetFullPath($pythonRuntimeClosureManifest) -cne $pythonRuntimeClosureManifest) { throw 'HERMES_EMBEDDING_PYTHON_CLOSURE_ROOT_WALL' }
  Assert-NoReparsePoint $pythonRuntimeRoot
  Assert-NoReparsePoint $pythonRuntimeClosureManifest
  $manifestBytes = [IO.File]::ReadAllBytes($pythonRuntimeClosureManifest)
  try { $manifest = [Text.Encoding]::UTF8.GetString($manifestBytes) | ConvertFrom-Json } catch { throw 'HERMES_EMBEDDING_PYTHON_CLOSURE_MANIFEST_WALL' }
  if ((@($manifest.PSObject.Properties.Name | Sort-Object) -join ',') -cne 'entries,root,schema_version' `
    -or $manifest.schema_version -cne '1.0-williamos-embedding-runtime-closure' `
    -or $manifest.root -cne $pythonRuntimeRoot -or $null -eq $manifest.entries) { throw 'HERMES_EMBEDDING_PYTHON_CLOSURE_MANIFEST_WALL' }
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $expectedFiles = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($entry in @($manifest.entries)) {
    $entryRelativePath = [string]$entry.path
    $entrySegments = $entryRelativePath.Split([char[]]@('\'))
    if ((@($entry.PSObject.Properties.Name | Sort-Object) -join ',') -cne 'path,sha256,size_bytes' `
      -or [string]::IsNullOrWhiteSpace($entryRelativePath) -or [IO.Path]::IsPathRooted($entryRelativePath) -or $entryRelativePath.Contains('/') `
      -or @($entrySegments | Where-Object { [string]::IsNullOrWhiteSpace($_) -or $_ -eq '.' -or $_ -eq '..' -or $_.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0 }).Count -ne 0 `
      -or [string]$entry.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'HERMES_EMBEDDING_PYTHON_CLOSURE_ENTRY_WALL' }
    [UInt64]$size = 0
    if (-not [UInt64]::TryParse([string]$entry.size_bytes, [Globalization.NumberStyles]::None, [Globalization.CultureInfo]::InvariantCulture, [ref]$size)) { throw 'HERMES_EMBEDDING_PYTHON_CLOSURE_ENTRY_WALL' }
    if (-not $seen.Add($entryRelativePath)) { throw 'HERMES_EMBEDDING_PYTHON_CLOSURE_DUPLICATE_WALL' }
    $entryPath = [IO.Path]::GetFullPath((Join-Path $pythonRuntimeRoot $entryRelativePath))
    if (-not $entryPath.StartsWith("$pythonRuntimeRoot\", [StringComparison]::OrdinalIgnoreCase) -or -not [IO.File]::Exists($entryPath)) { throw 'HERMES_EMBEDDING_PYTHON_CLOSURE_PATH_WALL' }
    if (-not $expectedFiles.Add($entryPath)) { throw 'HERMES_EMBEDDING_PYTHON_CLOSURE_DUPLICATE_WALL' }
    Assert-NoReparsePoint $entryPath
    $stream = [IO.File]::Open($entryPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
      if ([UInt64]$stream.Length -ne $size) { throw 'HERMES_EMBEDDING_PYTHON_CLOSURE_SIZE_WALL' }
      $algorithm = [Security.Cryptography.SHA256]::Create()
      try { $actualHash = ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() } finally { $algorithm.Dispose() }
      if ($actualHash -cne [string]$entry.sha256) { throw 'HERMES_EMBEDDING_PYTHON_CLOSURE_HASH_WALL' }
    } finally { $stream.Dispose() }
  }
  if ($seen.Count -lt 1 -or -not $expectedFiles.Contains($python)) { throw 'HERMES_EMBEDDING_PYTHON_CLOSURE_FILE_SET_WALL' }
  $children = @(Get-ChildItem -LiteralPath $pythonRuntimeRoot -Force -Recurse)
  foreach ($child in $children) {
    if (($child.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'HERMES_EMBEDDING_PYTHON_CLOSURE_REPARSE_WALL' }
    Assert-RuntimeAcl $child.FullName
  }
  $actualFiles = @($children | Where-Object { -not $_.PSIsContainer -and -not [StringComparer]::OrdinalIgnoreCase.Equals($_.FullName, $pythonRuntimeClosureManifest) })
  if ($actualFiles.Count -ne $expectedFiles.Count -or @($actualFiles | Where-Object { -not $expectedFiles.Contains($_.FullName) }).Count -ne 0) { throw 'HERMES_EMBEDDING_PYTHON_CLOSURE_FILE_SET_WALL' }
  Assert-RuntimeAcl $pythonRuntimeRoot
  return [ordered]@{ manifest_sha256 = Get-Sha256 $manifestBytes; acl_verified = $true }
}

function Assert-LastExit([string]$Code) {
  if ($LASTEXITCODE -ne 0) { throw $Code }
}

$pythonRuntimeClosure = Get-PythonRuntimeClosure

$self = Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
$parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($self.ParentProcessId)"
if (-not $parent -or $parent.ExecutablePath -ne $node) {
  throw 'HERMES_EMBEDDING_COLLECTOR_PARENT_WALL'
}

$systemProduct = Get-CimInstance Win32_ComputerSystemProduct
$machineId = ([string]$systemProduct.UUID).Trim().ToLowerInvariant()
if (-not $machineId) { throw 'HERMES_EMBEDDING_COLLECTOR_MACHINE_ID_WALL' }
$machineIdSha256 = Get-Sha256 ([Text.Encoding]::UTF8.GetBytes($machineId))

$computer = Get-CimInstance Win32_ComputerSystem
$operatingSystem = Get-CimInstance Win32_OperatingSystem
$cpuThreads = [int64]$computer.NumberOfLogicalProcessors
$memoryTotalBytes = [int64]$computer.TotalPhysicalMemory
$memoryAvailableBytes = [int64]$operatingSystem.FreePhysicalMemory * 1024
if ($cpuThreads -lt 1 -or $memoryTotalBytes -lt 1 -or $memoryAvailableBytes -lt 1) {
  throw 'HERMES_EMBEDDING_COLLECTOR_RESOURCE_WALL'
}

$gpuCsv = @(& $nvidiaSmi --query-gpu=memory.total,memory.free --format=csv,noheader,nounits)
Assert-LastExit 'HERMES_EMBEDDING_COLLECTOR_GPU_WALL'
if ($gpuCsv.Count -ne 1 -or $gpuCsv[0] -notmatch '^\s*(\d+)\s*,\s*(\d+)\s*$') {
  throw 'HERMES_EMBEDDING_COLLECTOR_GPU_SHAPE_WALL'
}
$gpuVramTotalBytes = [int64]$Matches[1] * 1MB
$gpuVramAvailableBytes = [int64]$Matches[2] * 1MB

$containerImage = (@(& $docker inspect -f '{{.Image}}' $container) -join '').Trim()
Assert-LastExit 'HERMES_EMBEDDING_COLLECTOR_CONTAINER_WALL'
if ($containerImage -notmatch '^sha256:([a-f0-9]{64})$') { throw 'HERMES_EMBEDDING_COLLECTOR_IMAGE_DIGEST_WALL' }
$containerImageSha256 = $Matches[1]

$runtimeHash = (@(& $docker exec $container sha256sum /usr/bin/ollama) -join '').Trim()
Assert-LastExit 'HERMES_EMBEDDING_COLLECTOR_RUNTIME_HASH_WALL'
if ($runtimeHash -notmatch '^([a-f0-9]{64})\s+/usr/bin/ollama$') { throw 'HERMES_EMBEDDING_COLLECTOR_RUNTIME_DIGEST_WALL' }
$runtimeExecutableSha256 = $Matches[1]

$version = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:11434/api/version' -TimeoutSec 10
if ([string]$version.version -notmatch '^\d+\.\d+\.\d+$') { throw 'HERMES_EMBEDDING_COLLECTOR_RUNTIME_VERSION_WALL' }

$modelParts = $model.Split(':')
$manifestPath = "/root/.ollama/models/manifests/registry.ollama.ai/library/$($modelParts[0])/$($modelParts[1])"
$manifestText = (@(& $docker exec $container cat $manifestPath) -join "`n").Trim()
Assert-LastExit 'HERMES_EMBEDDING_COLLECTOR_MODEL_MANIFEST_WALL'
$manifest = $manifestText | ConvertFrom-Json
$modelLayers = @($manifest.layers | Where-Object mediaType -eq 'application/vnd.ollama.image.model')
if ($modelLayers.Count -ne 1 -or [string]$modelLayers[0].digest -notmatch '^sha256:([a-f0-9]{64})$') {
  throw 'HERMES_EMBEDDING_COLLECTOR_MODEL_LAYER_WALL'
}
$weightsSha256 = $Matches[1]
$weightsPath = "/root/.ollama/models/blobs/sha256-$weightsSha256"
$weightsHash = (@(& $docker exec $container sha256sum $weightsPath) -join '').Trim()
Assert-LastExit 'HERMES_EMBEDDING_COLLECTOR_WEIGHTS_HASH_WALL'
if ($weightsHash -notmatch "^$weightsSha256\s+") { throw 'HERMES_EMBEDDING_COLLECTOR_WEIGHTS_DIGEST_WALL' }

$tags = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 10
$tagMatches = @($tags.models | Where-Object { $_.model -eq $model -and $_.digest -match '^[a-f0-9]{64}$' })
if ($tagMatches.Count -ne 1) { throw 'HERMES_EMBEDDING_COLLECTOR_MODEL_INVENTORY_WALL' }
$modelManifestHash = (@(& $docker exec $container sha256sum $manifestPath) -join '').Trim()
Assert-LastExit 'HERMES_EMBEDDING_COLLECTOR_MODEL_MANIFEST_HASH_WALL'
if ($modelManifestHash -notmatch '^([a-f0-9]{64})\s+') { throw 'HERMES_EMBEDDING_COLLECTOR_MODEL_MANIFEST_DIGEST_WALL' }
$modelManifestSha256 = $Matches[1]
if ($tagMatches[0].digest -ne $modelManifestSha256) { throw 'HERMES_EMBEDDING_COLLECTOR_MODEL_MANIFEST_DIGEST_WALL' }

$inventory = [ordered]@{
  node_id = 'hermes-node'
  machine_id_sha256 = $machineIdSha256
  cpu_threads = $cpuThreads
  memory_total_bytes = $memoryTotalBytes
  gpu_vram_total_bytes = $gpuVramTotalBytes
  container_image_sha256 = $containerImageSha256
  ollama_executable_sha256 = $runtimeExecutableSha256
  docker_executable_sha256 = Get-FileSha256 $docker
  git_executable_sha256 = Get-FileSha256 $git
  nvidia_smi_executable_sha256 = Get-FileSha256 $nvidiaSmi
  python_executable_sha256 = Get-FileSha256 $python
  python_runtime_closure_manifest_sha256 = $pythonRuntimeClosure.manifest_sha256
  python_runtime_closure_acl_verified = $pythonRuntimeClosure.acl_verified
  node_executable_sha256 = Get-FileSha256 $node
  powershell_executable_sha256 = Get-FileSha256 $powershell
}

$observedAt = (Get-Date).ToUniversalTime()
$result = [ordered]@{
  schema_version = '1.0-resident-hermes-live-embedding-observation'
  collector_id = 'reviewed-resident-hermes-live-collector'
  node_id = 'hermes-node'
  machine_id_sha256 = $machineIdSha256
  model_id = $model
  weights_sha256 = $weightsSha256
  model_manifest_sha256 = $modelManifestSha256
  runtime_id = 'ollama'
  runtime_version = [string]$version.version
  runtime_executable_sha256 = $runtimeExecutableSha256
  container_image_sha256 = $containerImageSha256
  docker_executable_sha256 = $inventory.docker_executable_sha256
  git_executable_sha256 = $inventory.git_executable_sha256
  nvidia_smi_executable_sha256 = $inventory.nvidia_smi_executable_sha256
  python_executable_sha256 = $inventory.python_executable_sha256
  python_runtime_closure_manifest_sha256 = $inventory.python_runtime_closure_manifest_sha256
  python_runtime_closure_acl_verified = $inventory.python_runtime_closure_acl_verified
  node_executable_sha256 = $inventory.node_executable_sha256
  powershell_executable_sha256 = $inventory.powershell_executable_sha256
  inventory = $inventory
  resources = [ordered]@{
    cpu_threads = $cpuThreads
    memory_total_bytes = $memoryTotalBytes
    memory_available_bytes = $memoryAvailableBytes
    gpu_vram_total_bytes = $gpuVramTotalBytes
    gpu_vram_available_bytes = $gpuVramAvailableBytes
  }
  observed_at = $observedAt.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  expires_at = $observedAt.AddMinutes(5).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
}

[Console]::Out.WriteLine(($result | ConvertTo-Json -Depth 10 -Compress))
