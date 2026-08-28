param(
  [Parameter(Mandatory = $true)][string]$OutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'HERMES_OWNERSHIP_UAC_BOUNDARY_REQUIRED: staging must begin non-elevated'
}

function Get-Sha256Text([string]$Text) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)) | ForEach-Object { $_.ToString('x2') }) }
  finally { $sha.Dispose() }
}

function New-WriteLease([string]$Path) {
  [IO.FileStream]::new($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::Read)
}

function Write-LeasedUtf8([IO.FileStream]$Stream, [string]$Text) {
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes($Text)
  $Stream.Position = 0
  $Stream.SetLength(0)
  $Stream.Write($bytes, 0, $bytes.Length)
  $Stream.Flush($true)
  $Stream.Position = 0
}

function Open-ReadLease([string]$Path) {
  [IO.FileStream]::new([IO.Path]::GetFullPath($Path), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
}

function Get-LeasedSha256([IO.FileStream]$Stream) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $Stream.Position = 0
    return -join ($sha.ComputeHash($Stream) | ForEach-Object { $_.ToString('x2') })
  } finally { $Stream.Position = 0; $sha.Dispose() }
}

function Get-HostIdentity {
  $machineGuid = [string](Get-ItemPropertyValue -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid -ErrorAction Stop)
  [ordered]@{
    computerName = [Environment]::MachineName
    machineGuidSha256 = Get-Sha256Text $machineGuid
  }
}

function New-ExpectedOwnershipSecurity([bool]$Directory) {
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $administratorsSid = [Security.Principal.SecurityIdentifier]::new([Security.Principal.WellKnownSidType]::BuiltinAdministratorsSid, $null)
  $systemSid = [Security.Principal.SecurityIdentifier]::new([Security.Principal.WellKnownSidType]::LocalSystemSid, $null)
  $inheritance = if ($Directory) { [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit } else { [Security.AccessControl.InheritanceFlags]::None }
  $security = if ($Directory) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
  $security.SetOwner($administratorsSid)
  $security.SetAccessRuleProtection($true, $false)
  [void]$security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($currentSid, [Security.AccessControl.FileSystemRights]::ReadAndExecute -bor [Security.AccessControl.FileSystemRights]::Synchronize, $inheritance, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
  [void]$security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($administratorsSid, [Security.AccessControl.FileSystemRights]::FullControl, $inheritance, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
  [void]$security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($systemSid, [Security.AccessControl.FileSystemRights]::FullControl, $inheritance, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
  return $security
}

function Test-TrustedElevatedSource([string]$DirectoryPath, [string]$FilePath) {
  if (-not [IO.Directory]::Exists($DirectoryPath) -or -not [IO.File]::Exists($FilePath)) { return $false }
  $directoryItem = Get-Item -LiteralPath $DirectoryPath -Force
  $fileItem = Get-Item -LiteralPath $FilePath -Force
  if (($directoryItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ($fileItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
  $sections = [Security.AccessControl.AccessControlSections]::Owner -bor [Security.AccessControl.AccessControlSections]::Access
  $expectedDirectory = (New-ExpectedOwnershipSecurity $true).GetSecurityDescriptorSddlForm($sections)
  $expectedFile = (New-ExpectedOwnershipSecurity $false).GetSecurityDescriptorSddlForm($sections)
  $actualDirectory = (Get-Acl -LiteralPath $DirectoryPath).GetSecurityDescriptorSddlForm($sections)
  $actualFile = (Get-Acl -LiteralPath $FilePath).GetSecurityDescriptorSddlForm($sections)
  return [bool]($actualDirectory -eq $expectedDirectory -and $actualFile -eq $expectedFile)
}

$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
if (-not [IO.Directory]::Exists($outputRoot)) { throw 'HERMES_OWNERSHIP_OUTPUT_PARENT_MISSING' }
$outputItem = Get-Item -LiteralPath $outputRoot -Force
if (($outputItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'HERMES_OWNERSHIP_OUTPUT_REPARSE_REFUSED' }
if (@(Get-ChildItem -LiteralPath $outputRoot -Force).Count -ne 0) { throw 'HERMES_OWNERSHIP_OUTPUT_NOT_DEDICATED' }

$collector = Join-Path $PSScriptRoot 'diagnose-hermes-ollama-ownership.ps1'
$binder = Join-Path $PSScriptRoot 'bind-hermes-ollama-ownership.v1.mjs'
$stager = $PSCommandPath
$node = 'C:\Program Files\nodejs\node.exe'
$expectedNodeSha256 = '4f4c2bbda03106699e49ef2e7914c03d597c355a99a6b9a1b63dca19fe092c01'
$powershell = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$expectedPowerShellSha256 = '9785001b0dcf755eddb8af294a373c0b87b2498660f724e76c4d53f9c217c7a3'
$docker = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
foreach ($trustedPath in @($collector, $binder, $stager, $node, $powershell, $docker)) {
  if (-not [IO.File]::Exists($trustedPath)) { throw "HERMES_OWNERSHIP_TRUSTED_SOURCE_MISSING: $trustedPath" }
}

$nonce = [Guid]::NewGuid().ToString('D')
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$base = "hermes-ollama-ownership-$stamp-$nonce"
$sourceDirectory = Join-Path $outputRoot "$base.elevated-source"
$sourcePath = Join-Path $sourceDirectory "$base.source.json"
$manifestPath = Join-Path $outputRoot "$base.launch.json"
$receiptPath = Join-Path $outputRoot "$base.launch-receipt.json"
$boundPath = Join-Path $outputRoot "$base.bound.json"

$leases = [Collections.Generic.List[IO.FileStream]]::new()
try {
  $collectorLease = Open-ReadLease $collector; $leases.Add($collectorLease)
  $binderLease = Open-ReadLease $binder; $leases.Add($binderLease)
  $stagerLease = Open-ReadLease $stager; $leases.Add($stagerLease)
  $nodeLease = Open-ReadLease $node; $leases.Add($nodeLease)
  $powershellLease = Open-ReadLease $powershell; $leases.Add($powershellLease)
  $dockerLease = Open-ReadLease $docker; $leases.Add($dockerLease)
  $collectorSha256 = Get-LeasedSha256 $collectorLease
  $binderSha256 = Get-LeasedSha256 $binderLease
  $stagerSha256 = Get-LeasedSha256 $stagerLease
  $nodeSha256 = Get-LeasedSha256 $nodeLease
  if ($nodeSha256 -ne $expectedNodeSha256) { throw 'HERMES_OWNERSHIP_NODE_DIGEST_MISMATCH' }
  $powershellSha256 = Get-LeasedSha256 $powershellLease
  if ($powershellSha256 -ne $expectedPowerShellSha256) { throw 'HERMES_OWNERSHIP_POWERSHELL_DIGEST_MISMATCH' }
  $dockerSha256 = Get-LeasedSha256 $dockerLease
  $hostIdentity = Get-HostIdentity

  $manifest = [ordered]@{
    authority = [ordered]@{ hostMutationAuthorized = $false; readOnly = $true }
    binderSha256 = $binderSha256
    boundPathSha256 = Get-Sha256Text $boundPath
    collectorSha256 = $collectorSha256
    dockerSha256 = $dockerSha256
    expectedUacPrompts = 1
    hostIdentity = $hostIdentity
    nodeSha256 = $nodeSha256
    nonce = $nonce
    persistentCredential = $false
    powershellSha256 = $powershellSha256
    schema = 'hermes-ollama-ownership-launch/1'
    sourcePathSha256 = Get-Sha256Text $sourcePath
    stagedAt = (Get-Date).ToUniversalTime().ToString('o')
    stagerSha256 = $stagerSha256
    uacMethod = 'Start-Process/RunAs'
  }
  $manifestJson = ConvertTo-Json -InputObject $manifest -Compress -Depth 8
  $manifestLease = New-WriteLease $manifestPath; $leases.Add($manifestLease)
  Write-LeasedUtf8 $manifestLease $manifestJson
  $manifestSha256 = Get-LeasedSha256 $manifestLease
  # Occupy and continuously lease every non-elevated output path before UAC so a same-user
  # watcher cannot squat or swap the receipt/bound handoffs.
  $receiptLease = New-WriteLease $receiptPath; $leases.Add($receiptLease)
  $boundLease = New-WriteLease $boundPath; $leases.Add($boundLease)

  $arguments = @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', "`"$collector`"",
    '-OutputPath', "`"$sourcePath`"", '-LaunchManifestPath', "`"$manifestPath`"", '-CollectionId', $nonce
  )
  $startedAt = (Get-Date).ToUniversalTime().ToString('o')
  $priorModulePath = $env:PSModulePath
  $priorPath = $env:PATH
  try {
    $env:PSModulePath = 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules;C:\Program Files\WindowsPowerShell\Modules'
    $env:PATH = 'C:\Windows\System32;C:\Windows\System32\WindowsPowerShell\v1.0;C:\Windows'
    # The only elevation primitive in this stager. There is deliberately no retry loop.
    $elevated = Start-Process -FilePath $powershell -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -WorkingDirectory 'C:\Windows\System32' -Wait -PassThru -ErrorAction Stop
  } finally {
    $env:PSModulePath = $priorModulePath
    $env:PATH = $priorPath
  }
  $completedAt = (Get-Date).ToUniversalTime().ToString('o')
  $sourcePresent = $false
  $sourceLease = $null
  try {
    if ([IO.File]::Exists($sourcePath)) {
      # FileShare.Read denies rename/delete while pathname trust is checked and bytes are hashed.
      $sourceLease = Open-ReadLease $sourcePath
      $sourcePresent = Test-TrustedElevatedSource $sourceDirectory $sourcePath
      if ($sourcePresent) { $leases.Add($sourceLease) }
      else { $sourceLease.Dispose(); $sourceLease = $null }
    }
  } catch {
    if ($null -ne $sourceLease) { $sourceLease.Dispose(); $sourceLease = $null }
    $sourcePresent = $false
  }
  $sourceSha256 = if ($sourceLease) { Get-LeasedSha256 $sourceLease } else { $null }
  $receipt = [ordered]@{
    binderSha256 = $binderSha256
    collectorSha256 = $collectorSha256
    completedAt = $completedAt
    disposition = if ($sourcePresent) { 'COLLECTOR_SOURCE_PRESENT' } else { 'COLLECTOR_DIED_BEFORE_DIAGNOSTIC_SEAL' }
    elevatedProcessId = [int]$elevated.Id
    exitCode = [int]$elevated.ExitCode
    hostIdentity = $hostIdentity
    manifestSha256 = $manifestSha256
    nodeSha256 = $nodeSha256
    nonce = $nonce
    powershellSha256 = $powershellSha256
    schema = 'hermes-ollama-ownership-launch-receipt/1'
    sourcePresent = $sourcePresent
    sourceSha256 = $sourceSha256
    stagerSha256 = $stagerSha256
    startedAt = $startedAt
    uacStartInvocations = 1
  }
  Write-LeasedUtf8 $receiptLease (ConvertTo-Json -InputObject $receipt -Compress -Depth 8)
  [IO.File]::SetAttributes($manifestPath, [IO.File]::GetAttributes($manifestPath) -bor [IO.FileAttributes]::ReadOnly)
  [IO.File]::SetAttributes($receiptPath, [IO.File]::GetAttributes($receiptPath) -bor [IO.FileAttributes]::ReadOnly)

  $priorNodeOptions = $env:NODE_OPTIONS
  $priorNodePath = $env:NODE_PATH
  try {
    $env:NODE_OPTIONS = $null
    $env:NODE_PATH = $null
    $boundLines = @(& $node $binder $sourcePath $manifestPath $receiptPath $boundPath)
    $binderExitCode = $LASTEXITCODE
  } finally {
    $env:NODE_OPTIONS = $priorNodeOptions
    $env:NODE_PATH = $priorNodePath
  }
  if ($binderExitCode -notin @(0, 70) -or $boundLines.Count -ne 1) { throw 'HERMES_OWNERSHIP_BIND_FAILED' }
  try { $boundObject = [string]$boundLines[0] | ConvertFrom-Json -ErrorAction Stop } catch { throw 'HERMES_OWNERSHIP_BOUND_MALFORMED' }
  if (($binderExitCode -eq 0 -and $boundObject.artifact -ne 'HERMES_OLLAMA_OWNERSHIP_OBSERVATION') `
    -or ($binderExitCode -eq 70 -and $boundObject.artifact -ne 'HERMES_OLLAMA_OWNERSHIP_PROBE_FAILURE') `
    -or [string]$boundObject.collectionId -ne $nonce) { throw 'HERMES_OWNERSHIP_BIND_DISPOSITION_MISMATCH' }
  Write-LeasedUtf8 $boundLease ([string]$boundLines[0] + "`n")
  $boundSha256 = Get-LeasedSha256 $boundLease
  [IO.File]::SetAttributes($boundPath, [IO.File]::GetAttributes($boundPath) -bor [IO.FileAttributes]::ReadOnly)
  [ordered]@{ artifact = [string]$boundObject.artifact; boundPath = $boundPath; boundSha256 = $boundSha256; collectionId = $nonce; exitCode = $binderExitCode }
  if ($binderExitCode -eq 70) { exit 70 }
} finally {
  for ($index = $leases.Count - 1; $index -ge 0; $index--) { $leases[$index].Dispose() }
}
