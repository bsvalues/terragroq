param(
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [ValidateSet('FULL','SECURITY_INFERENCE')][string]$Mode = 'FULL'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'HERMES_ATTESTATION_UAC_BOUNDARY_REQUIRED: staging must begin non-elevated'
}

$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
if (-not [IO.Directory]::Exists($outputRoot)) { throw 'HERMES_ATTESTATION_OUTPUT_PARENT_MISSING' }
$outputItem = Get-Item -LiteralPath $outputRoot -Force
if ($outputItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'HERMES_ATTESTATION_OUTPUT_REPARSE_REFUSED' }
if (@(Get-ChildItem -LiteralPath $outputRoot -Force).Count -ne 0) { throw 'HERMES_ATTESTATION_OUTPUT_NOT_DEDICATED: pre-staged directory must be empty' }
$collector = Join-Path $PSScriptRoot 'collect-hermes-host-attestation.v1.ps1'
$binder = Join-Path $PSScriptRoot 'bind-hermes-host-attestation.v1.mjs'
$node = [IO.Path]::GetFullPath((Get-Command node -ErrorAction Stop).Source)
$powershell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not [IO.File]::Exists($powershell)) { throw 'HERMES_ATTESTATION_WINDOWS_POWERSHELL_MISSING' }
$nativeExecutables = [ordered]@{
  docker = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
  nvidiaSmi = (Join-Path $env:WINDIR 'System32\nvidia-smi.exe')
}
if ($Mode -eq 'FULL') { $nativeExecutables['tailscale'] = 'C:\Program Files\Tailscale\tailscale.exe' }
foreach ($toolPath in $nativeExecutables.Values) {
  if (-not [IO.File]::Exists($toolPath)) { throw "HERMES_ATTESTATION_TRUSTED_TOOL_MISSING: $toolPath" }
}

$nonce = [Guid]::NewGuid().ToString('D')
$requestedFactIds = if ($Mode -eq 'SECURITY_INFERENCE') { @(
  'network.listeners', 'network.specialPortOwners', 'network.firewallAdmissions', 'security.firewallProfiles',
  'inference.gpus', 'inference.ollama', 'inference.dockerContainers', 'inference.guardBaseline',
  'operations.tasks', 'operations.heartbeats'
) } else { @() }
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$base = "hermes-host-attestation-$stamp-$nonce"
$rawPath = Join-Path $outputRoot "$base.source.json"
$manifestPath = Join-Path $outputRoot "$base.launch.json"
$receiptPath = Join-Path $outputRoot "$base.launch-receipt.json"
$boundPath = Join-Path $outputRoot "$base.json"
foreach ($target in @($rawPath, $manifestPath, $receiptPath, $boundPath)) {
  if ([IO.File]::Exists($target)) { throw "HERMES_ATTESTATION_OUTPUT_EXISTS: $target" }
}

function Get-Sha256Text([string]$Text) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)) | ForEach-Object { $_.ToString('x2') }) }
  finally { $sha.Dispose() }
}

function Write-NewUtf8([string]$Path, [string]$Text) {
  $stream = [IO.FileStream]::new($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($Text)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
  } finally { $stream.Dispose() }
}

function Open-ReadLease([string]$Path) {
  # FileShare.Read deliberately excludes Write/Delete. Keeping these handles alive pins the exact
  # bytes from hashing through their final use, closing swap-after-hash and rename races.
  [IO.FileStream]::new([IO.Path]::GetFullPath($Path), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
}

function Get-LeasedSha256([IO.FileStream]$Stream) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $Stream.Position = 0
    return -join ($sha.ComputeHash($Stream) | ForEach-Object { $_.ToString('x2') })
  } finally {
    $Stream.Position = 0
    $sha.Dispose()
  }
}

$leases = [System.Collections.Generic.List[IO.FileStream]]::new()
try {
  $collectorLease = Open-ReadLease $collector; $leases.Add($collectorLease)
  $binderLease = Open-ReadLease $binder; $leases.Add($binderLease)
  $nodeLease = Open-ReadLease $node; $leases.Add($nodeLease)
  $powershellLease = Open-ReadLease $powershell; $leases.Add($powershellLease)
  $toolLeases = [ordered]@{}
  $toolEvidence = [ordered]@{}
  foreach ($name in $nativeExecutables.Keys) {
    $lease = Open-ReadLease $nativeExecutables[$name]
    $leases.Add($lease)
    $toolLeases[$name] = $lease
    $toolEvidence[$name] = [ordered]@{ path = [IO.Path]::GetFullPath($nativeExecutables[$name]); sha256 = Get-LeasedSha256 $lease }
  }

  $collectorSha256 = Get-LeasedSha256 $collectorLease
  $binderSha256 = Get-LeasedSha256 $binderLease
  $nodeSha256 = Get-LeasedSha256 $nodeLease
  $powershellSha256 = Get-LeasedSha256 $powershellLease
  # All nested and top-level keys are in lexical order, so the file SHA equals canonical SHA.
  $manifest = [ordered]@{
    binderSha256 = $binderSha256
    collectorSha256 = $collectorSha256
    expectedUacPrompts = 1
  }
  if ($Mode -eq 'SECURITY_INFERENCE') { $manifest['mode'] = $Mode }
  $manifest['nativeExecutables'] = $toolEvidence
  $manifest['nodeSha256'] = $nodeSha256
  $manifest['nonce'] = $nonce
  $manifest['outputPathSha256'] = Get-Sha256Text $rawPath
  $manifest['persistentCredential'] = $false
  $manifest['powershellSha256'] = $powershellSha256
  if ($Mode -eq 'SECURITY_INFERENCE') { $manifest['requestedFactIds'] = @($requestedFactIds | Sort-Object) }
  $manifest['schema'] = if ($Mode -eq 'SECURITY_INFERENCE') { 'hermes-host-attestation-launch/2' } else { 'hermes-host-attestation-launch/1' }
  $manifest['stagedAt'] = (Get-Date).ToUniversalTime().ToString('o')
  $manifest['uacMethod'] = 'Start-Process/RunAs'
  $manifestJson = ConvertTo-Json -InputObject $manifest -Compress
  Write-NewUtf8 $manifestPath $manifestJson
  $manifestLease = Open-ReadLease $manifestPath; $leases.Add($manifestLease)
  $manifestSha256 = Get-LeasedSha256 $manifestLease

  $arguments = @(
    '-NoProfile', '-NonInteractive', '-File', "`"$collector`"",
    '-OutputPath', "`"$rawPath`"",
    '-LaunchManifestPath', "`"$manifestPath`"",
    '-CollectionId', $nonce
  )
  if ($Mode -eq 'SECURITY_INFERENCE') { $arguments += @('-FactIdsCsv', ($requestedFactIds -join ',')) }
  # This is the only elevation primitive. The collector and manifest remain leased read-only until
  # this child exits, and no credential is supplied or retained.
  $priorModulePath = $env:PSModulePath
  $priorPath = $env:PATH
  try {
    $env:PSModulePath = @(
      (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\Modules'),
      (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules')
    ) -join ';'
    $env:PATH = @(
      (Join-Path $env:WINDIR 'System32'),
      (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0'),
      $env:WINDIR
    ) -join ';'
    $elevated = Start-Process -FilePath $powershell -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -WorkingDirectory (Join-Path $env:WINDIR 'System32') -Wait -PassThru
  } finally {
    $env:PSModulePath = $priorModulePath
    $env:PATH = $priorPath
  }
  if ($elevated.ExitCode -ne 0 -or -not [IO.File]::Exists($rawPath)) {
    throw "HERMES_ATTESTATION_ELEVATED_COLLECTOR_FAILED: exit=$($elevated.ExitCode)"
  }

  $sourceLease = Open-ReadLease $rawPath; $leases.Add($sourceLease)
  $sourceSha256 = Get-LeasedSha256 $sourceLease
  $receipt = [ordered]@{
    binderSha256 = $binderSha256
    collectorSha256 = $collectorSha256
    completedAt = (Get-Date).ToUniversalTime().ToString('o')
    elevatedProcessId = [int]$elevated.Id
    exitCode = [int]$elevated.ExitCode
    manifestSha256 = $manifestSha256
    nodeSha256 = $nodeSha256
    nonce = $nonce
    powershellSha256 = $powershellSha256
    schema = 'hermes-host-attestation-launch-receipt/1'
    sourceSha256 = $sourceSha256
    uacStartInvocations = 1
  }
  Write-NewUtf8 $receiptPath (ConvertTo-Json -InputObject $receipt -Compress)
  $receiptLease = Open-ReadLease $receiptPath; $leases.Add($receiptLease)

  & $node $binder $rawPath $manifestPath $receiptPath $boundPath
  if ($LASTEXITCODE -ne 0 -or -not [IO.File]::Exists($boundPath)) { throw 'HERMES_ATTESTATION_BIND_FAILED' }
  $boundPath
} finally {
  for ($index = $leases.Count - 1; $index -ge 0; $index--) { $leases[$index].Dispose() }
}
