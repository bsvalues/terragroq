$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($args.Count -ne 0) { throw 'HERMES_EMBEDDING_COLLECTOR_ARGUMENT_WALL' }

$docker = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
$nvidiaSmi = 'C:\WINDOWS\system32\nvidia-smi.exe'
$python = 'C:\Python313\python.exe'
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

function Assert-LastExit([string]$Code) {
  if ($LASTEXITCODE -ne 0) { throw $Code }
}

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
