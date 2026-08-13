Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($args.Count -ne 0) { throw 'HERMES_R1B_PROVISION_ARGUMENTS_FORBIDDEN' }
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'HERMES_R1B_PROVISION_WINDOWS_REQUIRED' }

$RepositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$ConfigPath = [IO.Path]::GetFullPath((Join-Path $RepositoryRoot 'config\execution-fabric\hermes-r1b-runtime-provisioning.json'))
$ExpectedConfigSha256 = 'cabccb34a9fec227e1a3bcd04b4cda4c8c9936e6e2d62b9e227afea1e89be7d0'
$ExpectedRuntimeRoot = 'C:\Program Files\WilliamOS\EmbeddingRuntime'
$ExpectedPythonRoot = 'C:\Program Files\WilliamOS\EmbeddingRuntime\Python313'
$ExpectedPythonExecutable = 'C:\Program Files\WilliamOS\EmbeddingRuntime\Python313\python.exe'
$ExpectedGraniteRoot = 'C:\Program Files\WilliamOS\EmbeddingRuntime\models\granite-embedding-311m-multilingual-r2'
$ExpectedClosureManifest = 'C:\Program Files\WilliamOS\EmbeddingRuntime\runtime-closure.json'
$ExpectedStagingRoot = 'C:\ProgramData\WilliamOS\Provisioning\hermes-r1b-runtime-704'
$ExpectedDockerExecutable = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
$ExpectedContainer = 'ollama'
$ExpectedQwenModel = 'qwen3-embedding:4b'
$ExpectedQwenManifestPath = '/root/.ollama/models/manifests/registry.ollama.ai/library/qwen3-embedding/4b'
$ExpectedQwenConfigPath = '/root/.ollama/models/blobs/sha256-2ca34c70bbf2dc85cb69688daf0b423bdc361504ea29d7f5a35c19f739d8ee0d'
$ExpectedQwenWeightsPath = '/root/.ollama/models/blobs/sha256-2b0cf8f17b4c723c27303015383c27ec4bf2d8314bb677d05e920dd70bb0f16b'
$TrustedInstallerSid = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
$SystemSid = 'S-1-5-18'
$AdministratorsSid = 'S-1-5-32-544'
$UsersSid = 'S-1-5-32-545'
$RuntimeCreated = $false
$StagingCreated = $false

function Stop-Closed([string]$Code) { throw "HERMES_R1B_PROVISION_$Code" }

function Assert-ExactKeys($Value, [string[]]$Keys, [string]$Code) {
  $actual = @($Value.PSObject.Properties.Name | Sort-Object)
  $expected = @($Keys | Sort-Object)
  if (($actual -join "`n") -cne ($expected -join "`n")) { Stop-Closed $Code }
}

function Assert-AbsoluteHttpsUrl([string]$Url) {
  [Uri]$uri = $null
  if (-not [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -cne 'https' -or $uri.UserInfo) {
    Stop-Closed 'URL_INVALID'
  }
}

function Get-FileSha256([string]$Path) {
  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
  } finally { $stream.Dispose() }
}

function Get-NormalizedTextSha256([string]$Path) {
  try { $text = [IO.File]::ReadAllText($Path, [Text.UTF8Encoding]::new($false, $true)) } catch { Stop-Closed 'CONFIG_ENCODING_INVALID' }
  $normalized = $text.Replace("`r`n", "`n")
  if ($normalized.Contains("`r")) { Stop-Closed 'CONFIG_LINE_ENDING_INVALID' }
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($normalized)))).Replace('-', '').ToLowerInvariant() }
  finally { $algorithm.Dispose() }
}

function Assert-RegularFile([string]$Path, [UInt64]$Bytes, [string]$Sha256) {
  if (-not [IO.File]::Exists($Path)) { Stop-Closed 'ARTIFACT_MISSING' }
  $item = Get-Item -LiteralPath $Path -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Stop-Closed 'REPARSE_POINT_FORBIDDEN' }
  if ([UInt64]$item.Length -ne $Bytes) { Stop-Closed 'ARTIFACT_SIZE_MISMATCH' }
  if ((Get-FileSha256 $Path) -cne $Sha256) { Stop-Closed 'ARTIFACT_HASH_MISMATCH' }
}

function Get-ConfinedPath([string]$Root, [string]$RelativePath) {
  if ([IO.Path]::IsPathRooted($RelativePath) -or $RelativePath -match '(^|[\\/])\.\.([\\/]|$)') { Stop-Closed 'PATH_ESCAPE' }
  $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
  $candidate = [IO.Path]::GetFullPath((Join-Path $Root $RelativePath.Replace('/', '\')))
  if (-not $candidate.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) { Stop-Closed 'PATH_ESCAPE' }
  return $candidate
}

function Save-VerifiedArtifact($Artifact, [string]$Destination) {
  Assert-ExactKeys $Artifact @('filename', 'url', 'bytes', 'sha256') 'ARTIFACT_FIELDS_INVALID'
  Assert-AbsoluteHttpsUrl ([string]$Artifact.url)
  if ([string]$Artifact.sha256 -cnotmatch '^[a-f0-9]{64}$' -or [UInt64]$Artifact.bytes -lt 1) { Stop-Closed 'ARTIFACT_IDENTITY_INVALID' }
  $parent = [IO.Path]::GetDirectoryName($Destination)
  [IO.Directory]::CreateDirectory($parent) | Out-Null
  Invoke-WebRequest -UseBasicParsing -Uri ([string]$Artifact.url) -OutFile $Destination -MaximumRedirection 8
  Assert-RegularFile $Destination ([UInt64]$Artifact.bytes) ([string]$Artifact.sha256)
}

function Invoke-Fixed([string]$Executable, [string[]]$Arguments, [string]$Code) {
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) { Stop-Closed $Code }
}

function Get-DockerLine([string[]]$Arguments, [string]$Code) {
  $lines = @(& $ExpectedDockerExecutable @Arguments)
  if ($LASTEXITCODE -ne 0 -or $lines.Count -ne 1) { Stop-Closed $Code }
  return ([string]$lines[0]).Trim()
}

function Assert-QwenAcquisition($Config, [string]$StagingRoot) {
  Assert-ExactKeys $Config @('action_id', 'separate_reviewed_action', 'model', 'container', 'pull_command', 'registry_manifest', 'registry_manifest_path', 'manifest_payload_sha256', 'config', 'weights') 'QWEN_FIELDS_INVALID'
  Assert-ExactKeys $Config.registry_manifest @('filename', 'url', 'bytes', 'sha256') 'QWEN_REGISTRY_MANIFEST_FIELDS_INVALID'
  Assert-ExactKeys $Config.config @('digest', 'path', 'bytes', 'sha256') 'QWEN_CONFIG_FIELDS_INVALID'
  Assert-ExactKeys $Config.weights @('digest', 'path', 'bytes', 'sha256') 'QWEN_WEIGHTS_FIELDS_INVALID'
  $pull = @($Config.pull_command | ForEach-Object { [string]$_ })
  if ($Config.action_id -cne 'owner-decision-704-qwen-reviewed-acquisition' -or
    $Config.separate_reviewed_action -ne $true -or
    $Config.model -cne $ExpectedQwenModel -or
    $Config.container -cne $ExpectedContainer -or
    ($pull -join "`n") -cne (@('exec', 'ollama', 'ollama', 'pull', 'qwen3-embedding:4b') -join "`n") -or
    $Config.registry_manifest.filename -cne 'qwen3-embedding-4b.registry-manifest.json' -or
    $Config.registry_manifest.url -cne 'https://registry.ollama.ai/v2/library/qwen3-embedding/manifests/4b' -or
    [UInt64]$Config.registry_manifest.bytes -ne 531 -or
    $Config.registry_manifest.sha256 -cne 'df5bd2e3c74cd8d069d21dc038f1b359fcdc9458fce1c99bd43c9eb1518ff907' -or
    $Config.registry_manifest_path -cne $ExpectedQwenManifestPath -or
    $Config.manifest_payload_sha256 -cne 'df5bd2e3c74cd8d069d21dc038f1b359fcdc9458fce1c99bd43c9eb1518ff907' -or
    $Config.config.digest -cne 'sha256:2ca34c70bbf2dc85cb69688daf0b423bdc361504ea29d7f5a35c19f739d8ee0d' -or
    $Config.config.path -cne $ExpectedQwenConfigPath -or
    [UInt64]$Config.config.bytes -ne 265 -or
    $Config.config.sha256 -cne '2ca34c70bbf2dc85cb69688daf0b423bdc361504ea29d7f5a35c19f739d8ee0d' -or
    $Config.weights.digest -cne 'sha256:2b0cf8f17b4c723c27303015383c27ec4bf2d8314bb677d05e920dd70bb0f16b' -or
    $Config.weights.path -cne $ExpectedQwenWeightsPath -or
    [UInt64]$Config.weights.bytes -ne 2496703776 -or
    $Config.weights.sha256 -cne '2b0cf8f17b4c723c27303015383c27ec4bf2d8314bb677d05e920dd70bb0f16b') { Stop-Closed 'QWEN_IDENTITY_INVALID' }

  # The reviewed registry body is verified before the separate Qwen mutation phase begins.
  $reviewedManifestPath = Get-ConfinedPath $StagingRoot ([string]$Config.registry_manifest.filename)
  Save-VerifiedArtifact $Config.registry_manifest $reviewedManifestPath
  try { $reviewedManifest = [IO.File]::ReadAllText($reviewedManifestPath, [Text.UTF8Encoding]::new($false, $true)) | ConvertFrom-Json } catch { Stop-Closed 'QWEN_REVIEWED_MANIFEST_INVALID' }
  if ([string]$reviewedManifest.config.digest -cne [string]$Config.config.digest -or [UInt64]$reviewedManifest.config.size -ne [UInt64]$Config.config.bytes) { Stop-Closed 'QWEN_REVIEWED_CONFIG_MISMATCH' }
  $reviewedModelLayers = @($reviewedManifest.layers | Where-Object { $_.mediaType -ceq 'application/vnd.ollama.image.model' })
  if ($reviewedModelLayers.Count -ne 1 -or [string]$reviewedModelLayers[0].digest -cne [string]$Config.weights.digest -or [UInt64]$reviewedModelLayers[0].size -ne [UInt64]$Config.weights.bytes) { Stop-Closed 'QWEN_REVIEWED_MODEL_MISMATCH' }

  # Qwen acquisition is deliberately distinct from the Python/Granite provisioning phase.
  Invoke-Fixed $ExpectedDockerExecutable $pull 'QWEN_PULL_FAILED'
  $manifestSize = Get-DockerLine @('exec', $ExpectedContainer, 'stat', '-c', '%s', $ExpectedQwenManifestPath) 'QWEN_MANIFEST_SIZE_FAILED'
  if ($manifestSize -cne '531') { Stop-Closed 'QWEN_MANIFEST_SIZE_MISMATCH' }
  $manifestHash = Get-DockerLine @('exec', $ExpectedContainer, 'sha256sum', $ExpectedQwenManifestPath) 'QWEN_MANIFEST_HASH_FAILED'
  if ($manifestHash -cnotmatch '^df5bd2e3c74cd8d069d21dc038f1b359fcdc9458fce1c99bd43c9eb1518ff907\s+') { Stop-Closed 'QWEN_MANIFEST_HASH_MISMATCH' }
  $manifestText = @(& $ExpectedDockerExecutable exec $ExpectedContainer cat $ExpectedQwenManifestPath) -join "`n"
  if ($LASTEXITCODE -ne 0) { Stop-Closed 'QWEN_MANIFEST_READ_FAILED' }
  try { $manifest = $manifestText | ConvertFrom-Json } catch { Stop-Closed 'QWEN_MANIFEST_INVALID' }
  if ([string]$manifest.config.digest -cne [string]$Config.config.digest -or [UInt64]$manifest.config.size -ne [UInt64]$Config.config.bytes) { Stop-Closed 'QWEN_LOCAL_CONFIG_MISMATCH' }
  $modelLayers = @($manifest.layers | Where-Object { $_.mediaType -ceq 'application/vnd.ollama.image.model' })
  if ($modelLayers.Count -ne 1 -or [string]$modelLayers[0].digest -cne [string]$Config.weights.digest -or [UInt64]$modelLayers[0].size -ne [UInt64]$Config.weights.bytes) { Stop-Closed 'QWEN_MODEL_LAYER_MISMATCH' }
  $configSize = Get-DockerLine @('exec', $ExpectedContainer, 'stat', '-c', '%s', $ExpectedQwenConfigPath) 'QWEN_CONFIG_SIZE_FAILED'
  if ($configSize -cne '265') { Stop-Closed 'QWEN_CONFIG_SIZE_MISMATCH' }
  $configHash = Get-DockerLine @('exec', $ExpectedContainer, 'sha256sum', $ExpectedQwenConfigPath) 'QWEN_CONFIG_HASH_FAILED'
  if ($configHash -cnotmatch '^2ca34c70bbf2dc85cb69688daf0b423bdc361504ea29d7f5a35c19f739d8ee0d\s+') { Stop-Closed 'QWEN_CONFIG_HASH_MISMATCH' }
  $weightsSize = Get-DockerLine @('exec', $ExpectedContainer, 'stat', '-c', '%s', $ExpectedQwenWeightsPath) 'QWEN_WEIGHTS_SIZE_FAILED'
  if ($weightsSize -cne '2496703776') { Stop-Closed 'QWEN_WEIGHTS_SIZE_MISMATCH' }
  $weightsHash = Get-DockerLine @('exec', $ExpectedContainer, 'sha256sum', $ExpectedQwenWeightsPath) 'QWEN_WEIGHTS_HASH_FAILED'
  if ($weightsHash -cnotmatch '^2b0cf8f17b4c723c27303015383c27ec4bf2d8314bb677d05e920dd70bb0f16b\s+') { Stop-Closed 'QWEN_WEIGHTS_HASH_MISMATCH' }
}

function Write-RuntimeClosure {
  $entries = @(
    Get-ChildItem -LiteralPath $ExpectedRuntimeRoot -File -Recurse -Force |
      Where-Object { -not [StringComparer]::OrdinalIgnoreCase.Equals($_.FullName, $ExpectedClosureManifest) } |
      ForEach-Object {
        $relative = $_.FullName.Substring($ExpectedRuntimeRoot.Length + 1)
        [ordered]@{ path = $relative; sha256 = Get-FileSha256 $_.FullName; size_bytes = [UInt64]$_.Length }
      } |
      Sort-Object -Property path -CaseSensitive
  )
  if ($entries.Count -lt 10 -or @($entries | Where-Object { $_.path -ceq 'Python313\python.exe' }).Count -ne 1) { Stop-Closed 'CLOSURE_FILE_SET_INVALID' }
  $closure = [ordered]@{
    root = $ExpectedRuntimeRoot
    schema_version = '1.0-williamos-embedding-runtime-closure'
    entries = $entries
  }
  [IO.File]::WriteAllText($ExpectedClosureManifest, ($closure | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
}

function Seal-RuntimeAcl {
  $icacls = 'C:\Windows\System32\icacls.exe'
  Invoke-Fixed $icacls @($ExpectedRuntimeRoot, '/inheritance:r', '/grant:r', "*$SystemSid`:(OI)(CI)(F)", "*$TrustedInstallerSid`:(OI)(CI)(F)", "*$UsersSid`:(OI)(CI)(RX)", "*$AdministratorsSid`:(OI)(CI)(RX)", '/Q') 'ACL_ROOT_FAILED'
  Invoke-Fixed $icacls @("$ExpectedRuntimeRoot\*", '/reset', '/T', '/Q') 'ACL_DESCENDANT_RESET_FAILED'
  Invoke-Fixed $icacls @($ExpectedRuntimeRoot, '/setowner', "*$TrustedInstallerSid", '/T', '/Q') 'ACL_OWNER_FAILED'
  foreach ($item in @(Get-Item -LiteralPath $ExpectedRuntimeRoot -Force) + @(Get-ChildItem -LiteralPath $ExpectedRuntimeRoot -Force -Recurse)) {
    $acl = Get-Acl -LiteralPath $item.FullName
    $ownerSid = ([Security.Principal.NTAccount]$acl.Owner).Translate([Security.Principal.SecurityIdentifier]).Value
    if ($ownerSid -cne $TrustedInstallerSid) { Stop-Closed 'ACL_OWNER_MISMATCH' }
    $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object AccessControlType -eq Allow)
    foreach ($sid in @($SystemSid, $TrustedInstallerSid)) {
      if (@($rules | Where-Object { $_.IdentityReference.Value -ceq $sid -and ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl }).Count -lt 1) { Stop-Closed 'ACL_FULL_CONTROL_MISMATCH' }
    }
    $writeRights = [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
    foreach ($sid in @($UsersSid, $AdministratorsSid)) {
      $principalRules = @($rules | Where-Object { $_.IdentityReference.Value -ceq $sid })
      if ($principalRules.Count -lt 1 -or @($principalRules | Where-Object { ($_.FileSystemRights -band $writeRights) -ne 0 }).Count -ne 0) { Stop-Closed 'ACL_READ_EXECUTE_MISMATCH' }
    }
  }
}

try {
  $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Stop-Closed 'ELEVATION_REQUIRED' }
  if (-not [IO.File]::Exists($ConfigPath)) { Stop-Closed 'CONFIG_MISSING' }
  if ((Get-NormalizedTextSha256 $ConfigPath) -cne $ExpectedConfigSha256) { Stop-Closed 'CONFIG_HASH_MISMATCH' }
  try { $config = [IO.File]::ReadAllText($ConfigPath, [Text.UTF8Encoding]::new($false, $true)) | ConvertFrom-Json } catch { Stop-Closed 'CONFIG_INVALID' }
  Assert-ExactKeys $config @('schema_version', 'package_id', 'authority', 'paths', 'python', 'wheelhouse', 'granite', 'qwen', 'sealing') 'CONFIG_FIELDS_INVALID'
  Assert-ExactKeys $config.paths @('runtime_root', 'python_root', 'python_executable', 'granite_root', 'closure_manifest', 'staging_root', 'docker_executable') 'PATH_FIELDS_INVALID'
  if ($config.schema_version -cne '1.0-hermes-r1b-runtime-provisioning' -or
    $config.package_id -cne 'hermes-r1b-runtime-owner-decision-704' -or
    $config.authority.owner_decision -ne 704 -or
    $config.authority.target_machine -cne 'HERMES' -or
    $config.paths.runtime_root -cne $ExpectedRuntimeRoot -or
    $config.paths.python_root -cne $ExpectedPythonRoot -or
    $config.paths.python_executable -cne $ExpectedPythonExecutable -or
    $config.paths.granite_root -cne $ExpectedGraniteRoot -or
    $config.paths.closure_manifest -cne $ExpectedClosureManifest -or
    $config.paths.staging_root -cne $ExpectedStagingRoot -or
    $config.paths.docker_executable -cne $ExpectedDockerExecutable) { Stop-Closed 'CONFIG_IDENTITY_INVALID' }
  if ([IO.Directory]::Exists($ExpectedRuntimeRoot) -or [IO.File]::Exists($ExpectedRuntimeRoot)) { Stop-Closed 'RUNTIME_ROOT_ALREADY_EXISTS' }
  if ([IO.Directory]::Exists($ExpectedStagingRoot) -or [IO.File]::Exists($ExpectedStagingRoot)) { Stop-Closed 'STAGING_ROOT_ALREADY_EXISTS' }
  if (-not [IO.File]::Exists($ExpectedDockerExecutable)) { Stop-Closed 'DOCKER_EXECUTABLE_MISSING' }

  [IO.Directory]::CreateDirectory($ExpectedStagingRoot) | Out-Null
  $StagingCreated = $true
  $installerPath = Join-Path $ExpectedStagingRoot ([string]$config.python.installer.filename)
  Save-VerifiedArtifact $config.python.installer $installerPath
  $wheelhouseRoot = Join-Path $ExpectedStagingRoot 'wheelhouse'
  [IO.Directory]::CreateDirectory($wheelhouseRoot) | Out-Null
  if (@($config.wheelhouse.artifacts).Count -ne 6 -or
    $config.wheelhouse.install_mode -cne 'offline-no-index-no-deps' -or
    $config.wheelhouse.tokenizers_usage -cne 'local-native-binding-only' -or
    $config.wheelhouse.normal_dependency_resolution -ne $false) { Stop-Closed 'WHEELHOUSE_POLICY_INVALID' }
  $wheelPaths = [Collections.Generic.List[string]]::new()
  foreach ($wheel in @($config.wheelhouse.artifacts)) {
    Assert-ExactKeys $wheel @('name', 'version', 'filename', 'url', 'bytes', 'sha256') 'WHEEL_FIELDS_INVALID'
    $destination = Get-ConfinedPath $wheelhouseRoot ([string]$wheel.filename)
    Save-VerifiedArtifact ([pscustomobject]@{ filename = $wheel.filename; url = $wheel.url; bytes = $wheel.bytes; sha256 = $wheel.sha256 }) $destination
    $wheelPaths.Add($destination)
  }

  [IO.Directory]::CreateDirectory($ExpectedRuntimeRoot) | Out-Null
  $RuntimeCreated = $true
  $installArguments = @('/quiet', 'InstallAllUsers=1', "TargetDir=$ExpectedPythonRoot", 'PrependPath=0', 'AppendPath=0', 'Include_launcher=0', 'AssociateFiles=0', 'Shortcuts=0', 'Include_pip=1', 'Include_test=0', 'Include_doc=0', 'Include_tcltk=0')
  Invoke-Fixed $installerPath $installArguments 'PYTHON_INSTALL_FAILED'
  if (-not [IO.File]::Exists($ExpectedPythonExecutable)) { Stop-Closed 'PYTHON_EXECUTABLE_MISSING' }
  $env:PIP_CONFIG_FILE = 'NUL'
  $env:PIP_NO_INDEX = '1'
  $env:PYTHONNOUSERSITE = '1'
  Invoke-Fixed $ExpectedPythonExecutable (@('-I', '-m', 'pip', 'install', '--no-index', '--no-deps') + @($wheelPaths)) 'WHEEL_INSTALL_FAILED'
  Invoke-Fixed $ExpectedPythonExecutable @('-I', '-m', 'pip', 'uninstall', '--yes', 'pip') 'PIP_REMOVAL_FAILED'
  $validation = @'
import importlib.metadata as m
import flatbuffers, numpy, onnxruntime, packaging, tokenizers
from google import protobuf
expected = {"flatbuffers":"25.12.19","numpy":"2.5.2","onnxruntime":"1.28.0","packaging":"26.3","protobuf":"7.35.1","tokenizers":"0.22.2"}
installed = {d.metadata["Name"].lower().replace("_", "-"): d.version for d in m.distributions()}
if installed != expected: raise SystemExit(71)
'@
  Invoke-Fixed $ExpectedPythonExecutable @('-I', '-c', $validation) 'RUNTIME_IMPORT_OR_DISTRIBUTION_SET_FAILED'

  if (@($config.granite.files).Count -ne 9 -or
    [UInt64]$config.granite.total_bytes -ne 347965120 -or
    $config.granite.revision -cne '44399559930365213510b1ee2eb15ded83374f0e' -or
    $config.granite.licensing.tokenizer_derivation -cne 'Gemma 3' -or
    $config.granite.licensing.tokenizer_terms_apply -ne $true) { Stop-Closed 'GRANITE_IDENTITY_INVALID' }
  [UInt64]$graniteBytes = 0
  foreach ($file in @($config.granite.files)) {
    Assert-ExactKeys $file @('path', 'url', 'bytes', 'sha256') 'GRANITE_FILE_FIELDS_INVALID'
    $destination = Get-ConfinedPath $ExpectedGraniteRoot ([string]$file.path)
    Save-VerifiedArtifact ([pscustomobject]@{ filename = [IO.Path]::GetFileName([string]$file.path); url = $file.url; bytes = $file.bytes; sha256 = $file.sha256 }) $destination
    $graniteBytes += [UInt64]$file.bytes
  }
  if ($graniteBytes -ne 347965120) { Stop-Closed 'GRANITE_TOTAL_SIZE_MISMATCH' }

  Assert-QwenAcquisition $config.qwen $ExpectedStagingRoot
  Write-RuntimeClosure
  Seal-RuntimeAcl
  Remove-Item -LiteralPath $ExpectedStagingRoot -Recurse -Force
  $StagingCreated = $false
  [Console]::Out.WriteLine('{"schema_version":"1.0-hermes-r1b-provisioning-receipt","status":"PROVISIONED_AND_SEALED","owner_decision":704,"qwen_action":"VERIFIED","external_provider_used":false}')
} catch {
  $failure = [string]$_.Exception.Message
  if ($StagingCreated -and [IO.Directory]::Exists($ExpectedStagingRoot)) { try { Remove-Item -LiteralPath $ExpectedStagingRoot -Recurse -Force } catch { } }
  if ($RuntimeCreated -and [IO.Directory]::Exists($ExpectedRuntimeRoot)) { try { Remove-Item -LiteralPath $ExpectedRuntimeRoot -Recurse -Force } catch { } }
  if ($failure -cnotmatch '^HERMES_R1B_PROVISION_[A-Z0-9_]+$') { $failure = 'HERMES_R1B_PROVISION_INTERNAL_ERROR' }
  [Console]::Error.WriteLine($failure)
  exit 2
}
