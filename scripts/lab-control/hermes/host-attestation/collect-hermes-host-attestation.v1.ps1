param(
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [Parameter(Mandatory = $true)][string]$LaunchManifestPath,
  [string]$CollectionId = ([Guid]::NewGuid().ToString('D')),
  [string]$FactIdsCsv = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$collectorVersion = '1.0.0'
$collectionStarted = (Get-Date).ToUniversalTime()
$facts = [System.Collections.Generic.List[object]]::new()
$specialPorts = @(8080, 50080, 50443)
$securityInferenceFactIds = @(
  'inference.dockerContainers', 'inference.gpus', 'inference.guardBaseline', 'inference.ollama',
  'network.firewallAdmissions', 'network.listeners', 'network.specialPortOwners',
  'operations.heartbeats', 'operations.tasks', 'security.firewallProfiles'
)

# This collector deliberately does not self-elevate. The pre-staged launcher owns the sole UAC
# transition, and this process proves that transition happened before inspecting ACL-hidden state.
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'HERMES_ATTESTATION_ELEVATION_REQUIRED: use the pre-staged one-UAC launcher'
}

if (-not [IO.File]::Exists([IO.Path]::GetFullPath($LaunchManifestPath))) {
  throw 'HERMES_ATTESTATION_LAUNCH_MANIFEST_MISSING'
}
$launchManifest = [IO.File]::ReadAllText([IO.Path]::GetFullPath($LaunchManifestPath)) | ConvertFrom-Json
if ($launchManifest.schema -notin @('hermes-host-attestation-launch/1','hermes-host-attestation-launch/2') -or $launchManifest.expectedUacPrompts -ne 1 `
  -or $launchManifest.uacMethod -ne 'Start-Process/RunAs' -or $launchManifest.persistentCredential -ne $false) {
  throw 'HERMES_ATTESTATION_LAUNCH_MANIFEST_INVALID'
}
$targetedMode = $launchManifest.schema -eq 'hermes-host-attestation-launch/2'
$requestedFactIds = if ($targetedMode) { @($launchManifest.requestedFactIds | ForEach-Object { [string]$_ }) } else { @() }
$argumentFactIds = if ($FactIdsCsv) { @($FactIdsCsv -split ',' | Where-Object { $_ } | ForEach-Object { [string]$_.Trim() }) } else { @() }
if ($targetedMode) {
  if ($launchManifest.mode -ne 'SECURITY_INFERENCE' -or $requestedFactIds.Count -ne 10 `
    -or (($requestedFactIds | Sort-Object) -join ',') -cne (($securityInferenceFactIds | Sort-Object) -join ',') `
    -or (($requestedFactIds | Sort-Object) -join ',') -cne (($argumentFactIds | Sort-Object) -join ',')) {
    throw 'HERMES_ATTESTATION_TARGETED_REQUEST_MISMATCH'
  }
} elseif ($argumentFactIds.Count -ne 0) {
  throw 'HERMES_ATTESTATION_TARGETED_REQUEST_WITH_V1_MANIFEST'
}
$selectedFactIds = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($factId in $requestedFactIds) { if (-not $selectedFactIds.Add($factId)) { throw 'HERMES_ATTESTATION_TARGETED_DUPLICATE_FACT' } }
$launchManifestSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $LaunchManifestPath).Hash.ToLowerInvariant()

$resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
$outputParent = [IO.Path]::GetDirectoryName($resolvedOutput)
if (-not $outputParent -or -not [IO.Directory]::Exists($outputParent)) {
  throw 'HERMES_ATTESTATION_OUTPUT_PARENT_MISSING: output directory must be pre-staged'
}
if ([IO.File]::Exists($resolvedOutput)) {
  throw 'HERMES_ATTESTATION_OUTPUT_EXISTS: refusing to overwrite evidence'
}
$manifestParent = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($LaunchManifestPath))
if ($manifestParent -ine $outputParent) { throw 'HERMES_ATTESTATION_OUTPUT_ROOT_MISMATCH' }
$outputRootItem = Get-Item -LiteralPath $outputParent -Force
if ($outputRootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'HERMES_ATTESTATION_OUTPUT_REPARSE_REFUSED' }
$currentPowerShell = (Get-Process -Id $PID).Path
$currentPowerShellSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $currentPowerShell).Hash.ToLowerInvariant()
if ($currentPowerShellSha256 -ne [string]$launchManifest.powershellSha256) { throw 'HERMES_ATTESTATION_POWERSHELL_DIGEST_MISMATCH' }

function Get-Sha256Text([string]$Text) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    return -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)) | ForEach-Object { $_.ToString('x2') })
  } finally {
    $sha.Dispose()
  }
}

function Protect-Text([AllowNull()][string]$Text) {
  if ($null -eq $Text) { return $null }
  $safe = $Text
  $safe = $safe -replace '(?i)(authorization)\s*[:=]\s*[^\r\n;]+', '$1=[REDACTED]'
  $safe = $safe -replace '(?i)(password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie)\s*[:=]\s*["''][^"'']*["'']', '$1=[REDACTED]'
  $safe = $safe -replace '(?i)(--?(?:password|passwd|pwd|secret|token|api[_-]?key|authorization))\s+["''][^"'']*["'']', '$1 [REDACTED]'
  $safe = $safe -replace '(?i)(password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie)\s*[:=]\s*([^\s;"'']+)', '$1=[REDACTED]'
  $safe = $safe -replace '(?i)(--?(?:password|passwd|pwd|secret|token|api[_-]?key|authorization))\s+([^\s;"'']+)', '$1 [REDACTED]'
  $safe = $safe -replace '(?i)(postgres(?:ql)?|mongodb(?:\+srv)?|redis|https?)://([^/@\s:]+):([^/@\s]+)@', '$1://[REDACTED]@'
  $safe = $safe -replace '(?i)-----BEGIN [^-]+PRIVATE KEY-----.*?-----END [^-]+PRIVATE KEY-----', '[REDACTED-PRIVATE-KEY]'
  return $safe
}

function Get-TrustedExecutable([string]$Name) {
  $entry = $launchManifest.nativeExecutables.PSObject.Properties[$Name]
  if (-not $entry -or -not $entry.Value.path -or [string]$entry.Value.sha256 -notmatch '^[a-f0-9]{64}$') {
    throw "HERMES_ATTESTATION_TRUSTED_TOOL_UNBOUND: $Name"
  }
  $path = [IO.Path]::GetFullPath([string]$entry.Value.path)
  if (-not [IO.File]::Exists($path)) { throw "HERMES_ATTESTATION_TRUSTED_TOOL_MISSING: $Name" }
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
  if ($actual -ne [string]$entry.Value.sha256) { throw "HERMES_ATTESTATION_TRUSTED_TOOL_DIGEST_MISMATCH: $Name" }
  $path
}

$dockerExecutable = Get-TrustedExecutable 'docker'
$nvidiaSmiExecutable = Get-TrustedExecutable 'nvidiaSmi'
$tailscaleExecutable = if ($targetedMode) { $null } else { Get-TrustedExecutable 'tailscale' }

function Get-FreshnessBound([string]$Class) {
  switch ($Class) {
    'IDENTITY' { return 31536000 }
    'STATIC' { return 2592000 }
    'CONFIGURATION' { return 86400 }
    'STATE' { return 3600 }
    'VOLATILE' { return 300 }
    default { throw "HERMES_ATTESTATION_BAD_FRESHNESS_CLASS: $Class" }
  }
}

function Add-Fact {
  param(
    [string]$Id,
    [string]$Domain,
    [string]$Source,
    [string]$Probe,
    [string]$FreshnessClass,
    [scriptblock]$Read,
    [string[]]$RedactedFields = @()
  )
  if ($targetedMode -and -not $selectedFactIds.Contains($Id)) { return }
  $observedAt = (Get-Date).ToUniversalTime()
  $truth = 'OBSERVED'
  $probeResult = 'SUCCESS'
  $value = $null
  try {
    $value = & $Read
    if ($value -is [Collections.IDictionary] -and $value.Contains('__truth') -and $value.Contains('__value')) {
      $truth = [string]$value.__truth
      $probeResult = if ($truth -eq 'CONFLICTING') { 'CONTRADICTION_PRESERVED' } elseif ($truth -eq 'UNKNOWN') { 'READ_ONLY_PROBE_FAILED' } else { 'SUCCESS' }
      $value = $value.__value
    }
  } catch {
    $detail = [string]$_.Exception.Message
    if ($detail -match '(?i)access (?:is )?denied|unauthori[sz]ed|privilege.*not held') {
      throw "HERMES_ATTESTATION_ACCESS_AMBIGUOUS: $Id refused; absence was not inferred"
    }
    $truth = 'UNKNOWN'
    $probeResult = 'READ_ONLY_PROBE_FAILED'
    $value = $null
  }
  $bound = Get-FreshnessBound $FreshnessClass
  $facts.Add([ordered]@{
    id = $Id
    domain = $Domain
    truth = $truth
    value = $value
    provenance = [ordered]@{
      source = $Source
      probe = $Probe
      collectorVersion = $collectorVersion
      result = $probeResult
    }
    freshness = [ordered]@{
      class = $FreshnessClass
      boundSeconds = $bound
      observedAt = $observedAt.ToString('o')
      validUntil = $observedAt.AddSeconds($bound).ToString('o')
    }
    redaction = [ordered]@{
      applied = [bool]($RedactedFields.Count -gt 0)
      fields = @($RedactedFields)
    }
  })
}

function Get-SafeProcess([int]$ProcessId) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  $services = @(Get-CimInstance Win32_Service -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue |
    Sort-Object Name | ForEach-Object { [string]$_.Name })
  [ordered]@{
    pid = $ProcessId
    process = if ($process) { [string]$process.Name } else { 'UNKNOWN' }
    exe = if ($process -and $process.ExecutablePath) { Protect-Text ([string]$process.ExecutablePath) } else { 'UNKNOWN' }
    services = if ($services.Count -gt 0) { $services } else { @() }
  }
}

function Get-SafeProcessLineage([int]$ProcessId) {
  $lineage = [System.Collections.Generic.List[object]]::new()
  $seen = [System.Collections.Generic.HashSet[int]]::new()
  $current = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  for ($depth = 0; $current -and $depth -lt 8; $depth++) {
    $parentId = [int]$current.ParentProcessId
    if ($parentId -lt 1 -or -not $seen.Add($parentId)) { break }
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $parentId" -ErrorAction SilentlyContinue
    if (-not $parent) { break }
    $lineage.Add([ordered]@{
      pid = $parentId
      process = Protect-Text ([string]$parent.Name)
      exe = if ($parent.ExecutablePath) { Protect-Text ([string]$parent.ExecutablePath) } else { 'UNKNOWN' }
    })
    $current = $parent
  }
  @($lineage)
}

function Get-DirectoryConsumers([string]$DriveLetter) {
  $root = "$DriveLetter`:"
  if (-not (Test-Path -LiteralPath $root)) { return [ordered]@{ rows = @(); coverageErrors = @(); complete = $true; priorSnapshot = 'UNAVAILABLE' } }
  $coverageErrors = [System.Collections.Generic.List[string]]::new()
  $rows = foreach ($directory in @(Get-ChildItem -LiteralPath "$root\" -Directory -Force -ErrorAction Stop)) {
    $bytes = [int64]0
    $queue = [Collections.Generic.Queue[object]]::new()
    $queue.Enqueue($directory)
    $visited = 0
    while ($queue.Count -gt 0 -and $visited -lt 500) {
      $current = $queue.Dequeue(); $visited++
      try {
        foreach ($file in @(Get-ChildItem -LiteralPath $current.FullName -File -Force -ErrorAction Stop)) { $bytes += [int64]$file.Length }
        foreach ($child in @(Get-ChildItem -LiteralPath $current.FullName -Directory -Force -ErrorAction Stop)) {
          if (-not ($child.Attributes -band [IO.FileAttributes]::ReparsePoint)) { $queue.Enqueue($child) }
        }
      } catch {
        $coverageErrors.Add("$($current.FullName):$($_.Exception.GetType().Name)")
      }
    }
    if ($queue.Count -gt 0) { $coverageErrors.Add("$($directory.FullName):BOUNDED_AT_500_DIRECTORIES") }
    $hint = if ($directory.FullName -match '(?i)docker|container|wsl') { 'CONTAINER_STORAGE' }
      elseif ($directory.FullName -match '(?i)model|ollama|huggingface') { 'MODEL_STORAGE' }
      elseif ($directory.FullName -match '(?i)backup|archive|restore') { 'RECOVERY_STORAGE' }
      elseif ($directory.FullName -match '(?i)repo|source|workspace|codex') { 'DEVELOPMENT_STORAGE' }
      else { 'UNCLASSIFIED' }
    [ordered]@{ path = Protect-Text $directory.FullName; bytes = $bytes; classificationHint = $hint }
  }
  [ordered]@{ rows = @($rows | Sort-Object bytes -Descending | Select-Object -First 12); coverageErrors = @($coverageErrors); complete = [bool]($coverageErrors.Count -eq 0); priorSnapshot = 'UNAVAILABLE' }
}

Add-Fact 'os.identity' 'os' 'Windows registry and CIM' 'Get-ItemProperty CurrentVersion; Get-CimInstance Win32_OperatingSystem' 'CONFIGURATION' {
  $cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
  $os = Get-CimInstance Win32_OperatingSystem
  [ordered]@{
    edition = [string]$cv.EditionID
    productName = [string]$cv.ProductName
    displayVersion = [string]$cv.DisplayVersion
    build = [string]$cv.CurrentBuildNumber
    ubr = [int]$cv.UBR
    architecture = [string]$os.OSArchitecture
  }
}

Add-Fact 'os.updates' 'os' 'Windows servicing inventory' 'Get-HotFix; Get-Service wuauserv' 'CONFIGURATION' {
  $service = Get-Service wuauserv
  $wuHistory = try {
    $sessionType = [type]::GetTypeFromProgID('Microsoft.Update.Session')
    $session = [Activator]::CreateInstance($sessionType)
    $searcher = $session.CreateUpdateSearcher()
    $count = [math]::Min(100, $searcher.GetTotalHistoryCount())
    [ordered]@{ state = 'OBSERVED'; entries = @($searcher.QueryHistory(0, $count) | ForEach-Object { [ordered]@{ title = Protect-Text ([string]$_.Title); operation = [string]$_.Operation; resultCode = [string]$_.ResultCode; date = $_.Date.ToUniversalTime().ToString('o') } }) }
  } catch {
    if ([string]$_.Exception.Message -match '(?i)access (?:is )?denied|unauthori[sz]ed|privilege') { throw }
    [ordered]@{ state = 'UNKNOWN'; entries = $null }
  }
  $servicing = try {
    [ordered]@{ state = 'OBSERVED'; entries = @(Get-WindowsPackage -Online | Where-Object { $_.PackageState -eq 'Installed' } | ForEach-Object { [ordered]@{ name = [string]$_.PackageName; releaseType = [string]$_.ReleaseType; installedAt = if ($_.InstallTime) { $_.InstallTime.ToUniversalTime().ToString('o') } else { $null } } }) }
  } catch {
    if ([string]$_.Exception.Message -match '(?i)access (?:is )?denied|unauthori[sz]ed|privilege') { throw }
    [ordered]@{ state = 'UNKNOWN'; entries = $null }
  }
  [ordered]@{
    updateService = [ordered]@{ status = [string]$service.Status; startType = [string]$service.StartType }
    installedKbs = @(Get-HotFix | Sort-Object InstalledOn -Descending | ForEach-Object {
      [ordered]@{ id = [string]$_.HotFixID; installedOn = if ($_.InstalledOn) { $_.InstalledOn.ToUniversalTime().ToString('o') } else { $null } }
    })
    servicingPackages = $servicing
    updateHistory = $wuHistory
    esu = [ordered]@{ state = 'UNKNOWN'; reason = 'No non-mutating local API proves ESU entitlement independently of licensing state' }
  }
}

Add-Fact 'os.licensing' 'os' 'Windows Software Protection Platform' 'Get-CimInstance SoftwareLicensingProduct (Windows ApplicationID only)' 'CONFIGURATION' {
  $rows = @(Get-CimInstance SoftwareLicensingProduct -Filter "ApplicationID='55c92734-d682-4d71-983e-d6ec3f16059f'" |
    Where-Object { $_.Name -match 'Windows|Extended Security|ESU' } | ForEach-Object {
      [ordered]@{ name = [string]$_.Name; description = [string]$_.Description; status = [int]$_.LicenseStatus; graceMinutes = [int64]$_.GracePeriodRemaining }
    })
  [ordered]@{ windows = @($rows | Where-Object { $_.name -match 'Windows' }); esu = @($rows | Where-Object { $_.name -match 'Extended Security|ESU' -or $_.description -match 'Extended Security|ESU' }) }
}

Add-Fact 'security.bitlocker' 'security' 'Windows BitLocker provider' 'Get-BitLockerVolume (all volumes)' 'STATE' {
  @(Get-BitLockerVolume | ForEach-Object {
    [ordered]@{
      mountPoint = [string]$_.MountPoint
      volumeStatus = [string]$_.VolumeStatus
      protectionStatus = [string]$_.ProtectionStatus
      encryptionMethod = [string]$_.EncryptionMethod
      encryptionPercent = [double]$_.EncryptionPercentage
      lockStatus = [string]$_.LockStatus
      autoUnlockEnabled = if ($null -ne $_.AutoUnlockEnabled) { [bool]$_.AutoUnlockEnabled } else { $null }
      keyProtectorTypes = @($_.KeyProtector | ForEach-Object { [string]$_.KeyProtectorType })
    }
  })
}

Add-Fact 'security.boot' 'security' 'UEFI and TPM providers' 'Confirm-SecureBootUEFI; Get-Tpm' 'CONFIGURATION' {
  $tpm = Get-Tpm
  $bootTruth = 'OBSERVED'
  $secureBoot = try { [bool](Confirm-SecureBootUEFI) } catch {
    if ([string]$_.Exception.Message -match '(?i)access (?:is )?denied|unauthori[sz]ed|privilege') { throw }
    $bootTruth = 'CONFLICTING'
    'UNKNOWN'
  }
  $value = [ordered]@{
    secureBoot = $secureBoot
    tpm = [ordered]@{ present = [bool]$tpm.TpmPresent; ready = [bool]$tpm.TpmReady; enabled = [bool]$tpm.TpmEnabled; activated = [bool]$tpm.TpmActivated }
  }
  if ($bootTruth -eq 'CONFLICTING') { [ordered]@{ __truth = 'CONFLICTING'; __value = $value } } else { $value }
}

Add-Fact 'security.defender' 'security' 'Microsoft Defender local provider' 'Get-MpComputerStatus; Get-MpPreference (path/process exclusions only)' 'STATE' {
  $status = Get-MpComputerStatus
  $preference = Get-MpPreference
  [ordered]@{
    antivirusEnabled = [bool]$status.AntivirusEnabled
    realTimeProtectionEnabled = [bool]$status.RealTimeProtectionEnabled
    behaviorMonitorEnabled = [bool]$status.BehaviorMonitorEnabled
    tamperProtection = if ($null -ne $status.IsTamperProtected) { [bool]$status.IsTamperProtected } else { 'UNKNOWN' }
    signatureLastUpdated = if ($status.AntivirusSignatureLastUpdated) { $status.AntivirusSignatureLastUpdated.ToUniversalTime().ToString('o') } else { $null }
    exclusionPaths = @($preference.ExclusionPath | ForEach-Object { Protect-Text ([string]$_) })
    exclusionProcesses = @($preference.ExclusionProcess | ForEach-Object { Protect-Text ([string]$_) })
  }
} @('defender exclusion values are limited to paths and processes')

Add-Fact 'security.firewallProfiles' 'security' 'Windows Defender Firewall' 'Get-NetFirewallProfile' 'STATE' {
  @(Get-NetFirewallProfile | ForEach-Object {
    [ordered]@{ name = [string]$_.Name; enabled = [bool]$_.Enabled; defaultInbound = [string]$_.DefaultInboundAction; defaultOutbound = [string]$_.DefaultOutboundAction }
  })
}

Add-Fact 'storage.physicalDisks' 'storage' 'Windows Storage Management provider' 'Get-PhysicalDisk; Get-StorageReliabilityCounter' 'STATE' {
  $rows = @(Get-PhysicalDisk | ForEach-Object {
    $disk = $_
    $reliability = $null
    $reliabilityState = 'OBSERVED'
    try { $reliability = $disk | Get-StorageReliabilityCounter -ErrorAction Stop } catch {
      if ([string]$_.Exception.Message -match '(?i)access (?:is )?denied|unauthori[sz]ed|privilege') { throw }
      $reliabilityState = 'UNKNOWN'
    }
    [ordered]@{
      number = [int]$disk.DeviceId
      model = [string]$disk.FriendlyName
      serialSafeId = if ($disk.SerialNumber) { Get-Sha256Text ([string]$disk.SerialNumber).Trim() } else { 'UNKNOWN' }
      firmware = [string]$disk.FirmwareVersion
      capacityBytes = [int64]$disk.Size
      mediaType = [string]$disk.MediaType
      health = [string]$disk.HealthStatus
      operationalStatus = @($disk.OperationalStatus | ForEach-Object { [string]$_ })
      reliabilityState = $reliabilityState
      reliabilityEvidence = if ($reliability -and @($reliability.Wear, $reliability.Temperature, $reliability.PowerOnHours, $reliability.ReadErrorsTotal, $reliability.WriteErrorsTotal | Where-Object { $null -ne $_ }).Count -gt 0) { 'EXPOSED' } else { 'NOT_EXPOSED' }
      wearPercent = if ($reliability -and $null -ne $reliability.Wear) { [double]$reliability.Wear } else { $null }
      temperatureC = if ($reliability -and $null -ne $reliability.Temperature) { [double]$reliability.Temperature } else { $null }
      powerOnHours = if ($reliability -and $null -ne $reliability.PowerOnHours) { [int64]$reliability.PowerOnHours } else { $null }
      readErrors = if ($reliability -and $null -ne $reliability.ReadErrorsTotal) { [int64]$reliability.ReadErrorsTotal } else { $null }
      writeErrors = if ($reliability -and $null -ne $reliability.WriteErrorsTotal) { [int64]$reliability.WriteErrorsTotal } else { $null }
    }
  })
  if ($rows | Where-Object { $_.reliabilityState -ne 'OBSERVED' }) {
    [ordered]@{ __truth = 'CONFLICTING'; __value = $rows }
  } else { $rows }
} @('physical serial numbers are represented only as SHA-256 safe identifiers')

Add-Fact 'storage.volumes' 'storage' 'Windows Storage Management provider' 'Get-Disk; Get-Partition; Get-Volume' 'STATE' {
  $volumes = @(Get-Volume)
  @(Get-Disk | ForEach-Object {
    $disk = $_
    @(Get-Partition -DiskNumber $disk.Number | ForEach-Object {
      $partition = $_
      $volume = $volumes | Where-Object { $_.UniqueId -eq $partition.AccessPaths[0] -or ($partition.DriveLetter -and $_.DriveLetter -eq $partition.DriveLetter) } | Select-Object -First 1
      $size = if ($volume) { [int64]$volume.Size } else { [int64]$partition.Size }
      $free = if ($volume) { [int64]$volume.SizeRemaining } else { $null }
      [ordered]@{
        diskNumber = [int]$disk.Number
        partitionNumber = [int]$partition.PartitionNumber
        driveLetter = if ($partition.DriveLetter) { [string]$partition.DriveLetter } else { $null }
        label = if ($volume) { [string]$volume.FileSystemLabel } else { $null }
        filesystem = if ($volume) { [string]$volume.FileSystem } else { $null }
        capacityBytes = $size
        freeBytes = $free
        usedBytes = if ($null -ne $free) { $size - $free } else { $null }
        freePercent = if ($size -gt 0 -and $null -ne $free) { [math]::Round(($free * 100.0) / $size, 2) } else { $null }
      }
    })
  })
}

Add-Fact 'storage.dockerDisk' 'storage' 'Docker CLI and filesystem metadata' 'docker info; docker system df -v; Get-Item docker_data.vhdx' 'STATE' {
  $rootDir = (& $dockerExecutable info --format '{{json .DockerRootDir}}' 2>$null | ConvertFrom-Json)
  $candidates = @(
    "$env:LOCALAPPDATA\Docker\wsl\disk\docker_data.vhdx",
    "$env:LOCALAPPDATA\Docker\wsl\data\ext4.vhdx"
  )
  $images = @($candidates | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object {
    $item = Get-Item -LiteralPath $_
    [ordered]@{ path = Protect-Text $item.FullName; sizeBytes = [int64]$item.Length; lastWriteAt = $item.LastWriteTimeUtc.ToString('o') }
  })
  [ordered]@{
    dockerRootDir = Protect-Text ([string]$rootDir)
    diskImages = $images
    systemDfVerbose = Protect-Text ((& $dockerExecutable system df -v 2>&1) -join "`n")
  }
} @('credential-shaped text in Docker output is replaced before binding')

Add-Fact 'storage.topConsumers' 'storage' 'NTFS directory metadata' 'Get-ChildItem C:/ D:/ G:/ top-level recursive byte totals' 'STATE' {
  $value = [ordered]@{ C = Get-DirectoryConsumers 'C'; D = Get-DirectoryConsumers 'D'; G = Get-DirectoryConsumers 'G'; growth = 'UNKNOWN_NO_PRIOR_SNAPSHOT' }
  if (@($value.C.coverageErrors).Count + @($value.D.coverageErrors).Count + @($value.G.coverageErrors).Count -gt 0) {
    [ordered]@{ __truth = 'CONFLICTING'; __value = $value }
  } else { $value }
} @('credential-shaped path segments are replaced before binding')

Add-Fact 'storage.growth' 'storage' 'Current collection has no prior bound snapshot' 'Require a digest-bound prior snapshot before making a growth claim' 'STATE' {
  [ordered]@{ __truth = 'UNKNOWN'; __value = $null }
}

Add-Fact 'operations.tasks' 'operations' 'Windows Task Scheduler, including hidden tasks' 'Get-ScheduledTask; Export-ScheduledTask; Get-ScheduledTaskInfo' 'STATE' {
  $match = '(?i)backup|model.?sync|ollama|guard|watch|watchdog|williamos'
  @(Get-ScheduledTask | Where-Object {
    $_.TaskName -match $match -or $_.TaskPath -match $match -or (($_.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join ' ') -match '(?i)Hermes|WilliamOS'
  } | ForEach-Object {
    $task = $_
    $info = Get-ScheduledTaskInfo -TaskName $task.TaskName -TaskPath $task.TaskPath
    $xml = Export-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath
    [ordered]@{
      path = [string]$task.TaskPath
      name = [string]$task.TaskName
      hidden = [bool]$task.Settings.Hidden
      state = [string]$task.State
      principal = [ordered]@{ user = [string]$task.Principal.UserId; runLevel = [string]$task.Principal.RunLevel; logonType = [string]$task.Principal.LogonType }
      triggers = @($task.Triggers | ForEach-Object {
        [ordered]@{ type = $_.CimClass.CimClassName; enabled = [bool]$_.Enabled; startBoundary = [string]$_.StartBoundary; endBoundary = [string]$_.EndBoundary; repetitionInterval = if ($_.Repetition) { [string]$_.Repetition.Interval } else { $null } }
      })
      actions = @($task.Actions | ForEach-Object { [ordered]@{ execute = Protect-Text ([string]$_.Execute); arguments = Protect-Text ([string]$_.Arguments); workingDirectory = Protect-Text ([string]$_.WorkingDirectory) } })
      restart = [ordered]@{ count = [int]$task.Settings.RestartCount; interval = [string]$task.Settings.RestartInterval }
      lastRunAt = if ($info.LastRunTime.Year -gt 1900) { $info.LastRunTime.ToUniversalTime().ToString('o') } else { $null }
      lastResult = [int64]$info.LastTaskResult
      xmlSha256 = Get-Sha256Text $xml
    }
  })
} @('task XML and action fields are scrubbed for credential-shaped values')

Add-Fact 'operations.backups' 'operations' 'Task actions and local backup metadata' 'Get-ScheduledTask backup actions; Get-ChildItem known HERMES backup roots' 'STATE' {
  $archiveVolume = Get-Volume | Where-Object { $_.FileSystemLabel -eq 'HERMES_NVME' } | Select-Object -First 1
  $archiveRoot = if ($archiveVolume -and $archiveVolume.DriveLetter) { "$($archiveVolume.DriveLetter):\" } else { $null }
  $roots = @('C:\HermesLab\backups', 'D:\HermesLab\backups', 'G:\HermesLab\backups', 'G:\backups')
  if ($archiveRoot) { $roots += @((Join-Path $archiveRoot 'lab-backups\hermes-volumes'), (Join-Path $archiveRoot 'lab-backups\crossnode')) }
  $present = @($roots | Where-Object { Test-Path -LiteralPath $_ })
  $latest = @($present | ForEach-Object {
    $root = $_
    $item = Get-ChildItem -LiteralPath $root -File -Recurse -Force | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    [ordered]@{
      root = Protect-Text $root
      latest = if ($item) { [ordered]@{ path = Protect-Text $item.FullName; bytes = [int64]$item.Length; writtenAt = $item.LastWriteTimeUtc.ToString('o') } } else { $null }
    }
  })
  [ordered]@{ inspectedRoots = @($roots | ForEach-Object { Protect-Text $_ }); presentRoots = @($present | ForEach-Object { Protect-Text $_ }); latestArtifacts = $latest }
} @('credential-shaped path segments are replaced before binding')

Add-Fact 'operations.heartbeats' 'operations' 'Process table and HERMES heartbeat files' 'Get-CimInstance Win32_Process; Get-ChildItem heartbeat/health files' 'VOLATILE' {
  $processes = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)ollama|docker|guard|watch|williamos|node|powershell' } | ForEach-Object {
    $created = if ($_.CreationDate -is [DateTime]) { ([DateTime]$_.CreationDate).ToUniversalTime() } elseif ($_.CreationDate) { [Management.ManagementDateTimeConverter]::ToDateTime([string]$_.CreationDate).ToUniversalTime() } else { $null }
    [ordered]@{ pid = [int]$_.ProcessId; name = [string]$_.Name; exe = Protect-Text ([string]$_.ExecutablePath); startedAt = if ($created) { $created.ToString('o') } else { $null } }
  })
  $heartbeatRoot = 'C:\HermesLab\hermes'
  $heartbeats = if (Test-Path -LiteralPath $heartbeatRoot) {
    @(Get-ChildItem -LiteralPath $heartbeatRoot -File -Force | Where-Object { $_.Name -match '(?i)heartbeat|health|watch|guard' } | ForEach-Object {
      [ordered]@{ path = Protect-Text $_.FullName; writtenAt = $_.LastWriteTimeUtc.ToString('o'); bytes = [int64]$_.Length }
    })
  } else { @() }
  [ordered]@{ processes = $processes; heartbeatFiles = $heartbeats }
} @('credential-shaped process paths are replaced before binding')

$listenerSnapshot = $null
$listenerSnapshotTruth = 'PENDING'
Add-Fact 'network.listeners' 'network' 'Windows TCP/UDP tables and process/service correlation' 'Get-NetTCPConnection; Get-NetUDPEndpoint; Get-CimInstance Win32_Process/Win32_Service' 'VOLATILE' {
  $tcp = @(Get-NetTCPConnection -State Listen | ForEach-Object {
    $owner = Get-SafeProcess ([int]$_.OwningProcess)
    [ordered]@{ protocol = 'TCP'; address = [string]$_.LocalAddress; port = [int]$_.LocalPort; pid = $owner.pid; process = $owner.process; exe = $owner.exe; services = @($owner.services) }
  })
  $udp = @(Get-NetUDPEndpoint | ForEach-Object {
    $owner = Get-SafeProcess ([int]$_.OwningProcess)
    [ordered]@{ protocol = 'UDP'; address = [string]$_.LocalAddress; port = [int]$_.LocalPort; pid = $owner.pid; process = $owner.process; exe = $owner.exe; services = @($owner.services) }
  })
  $script:listenerSnapshot = @($tcp + $udp)
  $script:listenerSnapshotTruth = 'OBSERVED'
  $script:listenerSnapshot
} @('credential-shaped executable paths are replaced before binding')

$firewallSnapshot = $null
Add-Fact 'network.firewallAdmissions' 'network' 'Windows Defender Firewall rule/filter providers' 'Get-NetFirewallRule and associated application/address/port filters' 'STATE' {
  $rows = foreach ($rule in @(Get-NetFirewallRule -PolicyStore ActiveStore -Enabled True -Direction Inbound -Action Allow)) {
    $ports = @($rule | Get-NetFirewallPortFilter)
    $addresses = @($rule | Get-NetFirewallAddressFilter)
    $apps = @($rule | Get-NetFirewallApplicationFilter)
    $services = @($rule | Get-NetFirewallServiceFilter)
    foreach ($port in $ports) {
      $localPort = [string]$port.LocalPort
      $localPortIsExact = $localPort -match '^\d+$'
      $protocol = switch ([string]$port.Protocol) { '6' { 'TCP' } '17' { 'UDP' } default { ([string]$port.Protocol).ToUpperInvariant() } }
      $externalListeners = @($listenerSnapshot | Where-Object { $_.address -notin @('127.0.0.1','::1') })
      $admittedListeners = @($externalListeners | Where-Object {
        ($protocol -eq 'ANY' -or $_.protocol -eq $protocol) -and
        ($localPort -eq 'Any' -or (-not $localPortIsExact) -or $_.port -eq [int]$localPort)
      })
      $activeSurface = $admittedListeners.Count -gt 0
      foreach ($address in $addresses) {
        $remote = @($address.RemoteAddress | ForEach-Object { [string]$_ })
        $app = [string]($apps | Select-Object -First 1).Program
        $service = [string]($services | Select-Object -First 1).Service
        [ordered]@{
          rule = [string]$rule.DisplayName
          profiles = [string]$rule.Profile
          protocol = $protocol
          localPort = $localPort
          localAddress = @($address.LocalAddress | ForEach-Object { [string]$_ })
          remoteAddress = $remote
          program = Protect-Text $app
          service = $service
          activeListenerCount = $admittedListeners.Count
          publicAnyScope = [bool]($activeSurface -and [string]$rule.Profile -match 'Public|Any' -and ($remote -contains 'Any' -or $remote -contains '*'))
          unresolvedProgram = [bool]($activeSurface -and ($app -eq 'Any' -or -not $app) -and ($service -eq 'Any' -or -not $service))
        }
      }
    }
  }
  $script:firewallSnapshot = @($rows)
  $script:firewallSnapshot
} @('credential-shaped program paths are replaced before binding')

Add-Fact 'network.addressing' 'network' 'Windows network configuration and Tailscale local status' 'Get-NetIPConfiguration; Get-NetIPInterface; tailscale status --json' 'STATE' {
  $interfaces = @(Get-NetIPConfiguration | ForEach-Object {
    $ipif = Get-NetIPInterface -InterfaceIndex $_.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1
    $cim = Get-CimInstance Win32_NetworkAdapterConfiguration -Filter "InterfaceIndex=$($_.InterfaceIndex)" -ErrorAction SilentlyContinue | Select-Object -First 1
    [ordered]@{
      alias = [string]$_.InterfaceAlias
      addresses = @($_.IPv4Address | ForEach-Object { [string]$_.IPAddress })
      gateway = @($_.IPv4DefaultGateway | ForEach-Object { [string]$_.NextHop })
      dhcp = if ($ipif) { [string]$ipif.Dhcp } else { 'UNKNOWN' }
      dhcpServer = if ($cim -and $cim.DHCPServer) { [string]$cim.DHCPServer } else { 'UNKNOWN' }
      dhcpLeaseExpiresAt = if ($cim -and $cim.DHCPLeaseExpires) { ([DateTime]$cim.DHCPLeaseExpires).ToUniversalTime().ToString('o') } else { $null }
      macSafeId = if ($cim -and $cim.MACAddress) { Get-Sha256Text ([string]$cim.MACAddress) } else { 'UNKNOWN' }
      connectionProfile = if ($_.NetProfile) { [string]$_.NetProfile.NetworkCategory } else { 'UNKNOWN' }
    }
  })
  $tailStatus = if ($tailscaleExecutable) {
    $parsed = ((& $tailscaleExecutable status --json 2>&1) -join "`n") | ConvertFrom-Json
    [ordered]@{ backendState = [string]$parsed.BackendState; selfAddresses = @($parsed.Self.TailscaleIPs | ForEach-Object { [string]$_ }) }
  } else { [ordered]@{ backendState = 'UNKNOWN'; selfAddresses = @() } }
  [ordered]@{
    interfaces = $interfaces
    tailscaleStatus = $tailStatus
    stableReservation = [ordered]@{ state = 'UNKNOWN'; reason = 'DHCP client state does not prove a router reservation' }
  }
} @('credential-shaped Tailscale output is replaced before binding')

Add-Fact 'network.specialPortOwners' 'network' 'Bound listener snapshot' 'Correlate ports 8080/50080/50443 to PID/service/executable' 'VOLATILE' {
  if ($listenerSnapshotTruth -ne 'OBSERVED') { return [ordered]@{ __truth = 'UNKNOWN'; __value = $null } }
  @($specialPorts | ForEach-Object {
    $port = $_
    $matches = @($listenerSnapshot | Where-Object { $_.port -eq $port })
    if ($matches.Count -eq 0) {
      [ordered]@{ port = $port; owner = 'ABSENT'; listeners = @() }
    } elseif ($matches | Where-Object { $_.process -eq 'UNKNOWN' -or $_.exe -eq 'UNKNOWN' }) {
      [ordered]@{ port = $port; owner = 'UNKNOWN'; listeners = $matches }
    } else {
      [ordered]@{ port = $port; owner = (($matches | ForEach-Object { "$($_.process):$($_.pid)" }) -join ','); listeners = $matches }
    }
  })
}

Add-Fact 'inference.gpus' 'inference' 'NVIDIA management interface' 'nvidia-smi query UUID/name/compute-mode/driver-model/power/temp/ECC' 'VOLATILE' {
  $computeApps = @(& $nvidiaSmiExecutable --query-compute-apps=gpu_uuid,pid,process_name,used_gpu_memory --format=csv,noheader,nounits 2>$null | ForEach-Object {
    $parts = $_ -split ',\s*'
    $computePid = if ($parts[1] -match '^\d+$') { [int]$parts[1] } else { $null }
    [ordered]@{ gpuUuid = [string]$parts[0]; pid = $computePid; process = Protect-Text ([string]$parts[2]); usedMemoryMiB = if ($parts[3] -match '^\d+') { [int64]$parts[3] } else { $null }; lineage = if ($computePid) { @(Get-SafeProcessLineage $computePid) } else { @() } }
  })
  @(& $nvidiaSmiExecutable --query-gpu=uuid,name,compute_mode,driver_version,driver_model.current,driver_model.pending,power.limit,power.default_limit,power.max_limit,temperature.gpu,ecc.mode.current,ecc.mode.pending,ecc.errors.corrected.volatile.total,ecc.errors.uncorrected.volatile.total,ecc.errors.corrected.aggregate.total,ecc.errors.uncorrected.aggregate.total --format=csv,noheader,nounits | ForEach-Object {
    $parts = $_ -split ',\s*'
    $name = [string]$parts[1]
    [ordered]@{
      uuid = [string]$parts[0]
      name = $name
      computeMode = [string]$parts[2]
      driver = [string]$parts[3]
      driverModelCurrent = [string]$parts[4]
      driverModelPending = [string]$parts[5]
      powerLimitW = if ($parts[6] -match '^\d') { [double]$parts[6] } else { $null }
      defaultPowerLimitW = if ($parts[7] -match '^\d') { [double]$parts[7] } else { $null }
      maxPowerLimitW = if ($parts[8] -match '^\d') { [double]$parts[8] } else { $null }
      temperatureC = if ($parts[9] -match '^\d') { [double]$parts[9] } else { $null }
      eccModeCurrent = [string]$parts[10]
      eccModePending = [string]$parts[11]
      correctedVolatileEcc = if ($parts[12] -match '^\d') { [int64]$parts[12] } else { $null }
      uncorrectedVolatileEcc = if ($parts[13] -match '^\d') { [int64]$parts[13] } else { $null }
      correctedAggregateEcc = if ($parts[14] -match '^\d') { [int64]$parts[14] } else { $null }
      uncorrectedAggregateEcc = if ($parts[15] -match '^\d') { [int64]$parts[15] } else { $null }
      role = if ([string]$parts[0] -eq 'GPU-4f7d4396-9304-d12f-7e9b-7f04d1236fc2') { 'FROZEN_LONG_CONTEXT_INFERENCE' } elseif ([string]$parts[0] -eq 'GPU-6d9ae165-7272-a38c-06b1-7276869e980f') { 'DISPLAY_CHASSIS_PROXY' } else { 'UNDECLARED' }
      computeApps = @($computeApps | Where-Object { $_.gpuUuid -eq [string]$parts[0] })
    }
  })
}

Add-Fact 'inference.ollama' 'inference' 'Frozen repository service doctrine, deployed service, live owner/listener, startup evidence, and catalog' 'Compare deployed/repository service scripts; inspect WilliamOS-HERMES-Ollama task and PID-owned loopback listener; read allow-listed server-config/API fields' 'VOLATILE' {
  $servicePath = 'C:\HermesLab\hermes\ollama-service\hermes-ollama-service.ps1'
  $repositoryServicePath = Join-Path (Split-Path $PSScriptRoot -Parent) 'ollama-service\hermes-ollama-service.ps1'
  if (-not (Test-Path -LiteralPath $servicePath -PathType Leaf) -or -not (Test-Path -LiteralPath $repositoryServicePath -PathType Leaf)) {
    return [ordered]@{ __truth = 'UNKNOWN'; __value = $null }
  }
  $serviceText = [IO.File]::ReadAllText($servicePath)
  $repositoryServiceText = [IO.File]::ReadAllText($repositoryServicePath)
  $normalizedServiceText = $serviceText.TrimStart([char]0xFEFF) -replace "`r`n", "`n"
  $normalizedRepositoryServiceText = $repositoryServiceText.TrimStart([char]0xFEFF) -replace "`r`n", "`n"
  $extract = {
    param([string]$Name)
    $match = [regex]::Match($serviceText, "(?m)^`$$Name\s*=\s*'([^']+)'")
    if ($match.Success) { [string]$match.Groups[1].Value } else { 'UNKNOWN' }
  }
  $pinnedExe = & $extract 'OllamaExe'
  $modelsPath = & $extract 'ModelsDir'
  $pinnedBind = & $extract 'Listen'
  $p40Uuid = & $extract 'P40Uuid'
  $llmLibrary = & $extract 'LlmLibrary'
  $listener = @($listenerSnapshot | Where-Object { $_.protocol -eq 'TCP' -and $_.port -eq 11434 -and $_.address -in @('127.0.0.1','::1') }) | Select-Object -First 1
  $process = if ($listener) { Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.pid)" -ErrorAction SilentlyContinue } else { $null }
  $task = Get-ScheduledTask -TaskName 'WilliamOS-HERMES-Ollama' -ErrorAction SilentlyContinue
  $taskAction = if ($task) { @($task.Actions | Select-Object -First 1)[0] } else { $null }
  $liveExe = if ($process -and $process.ExecutablePath) { [string]$process.ExecutablePath } else { 'UNKNOWN' }
  $liveBind = if ($listener) { "$($listener.address):$($listener.port)" } else { 'UNKNOWN' }
  $safeConfig = [ordered]@{
    exe = Protect-Text $pinnedExe
    exeSha256 = if (Test-Path -LiteralPath $pinnedExe -PathType Leaf) { (Get-FileHash -Algorithm SHA256 -LiteralPath $pinnedExe).Hash.ToLowerInvariant() } else { 'UNKNOWN' }
    models = Protect-Text $modelsPath
    host = $pinnedBind
    gpuUuid = $p40Uuid
    environment = [ordered]@{ OLLAMA_LLM_LIBRARY = $llmLibrary; OLLAMA_NOPRUNE = '1' }
    serviceScriptSha256 = Get-Sha256Text $normalizedServiceText
    repositoryDoctrineSha256 = Get-Sha256Text $normalizedRepositoryServiceText
  }
  $serverConfigLine = $null
  $serverConfigEvidenceAt = $null
  $processStartedAt = if ($process -and $process.CreationDate) {
    if ($process.CreationDate -is [DateTime]) { ([DateTime]$process.CreationDate).ToUniversalTime() }
    else { [Management.ManagementDateTimeConverter]::ToDateTime([string]$process.CreationDate).ToUniversalTime() }
  } else { $null }
  foreach ($logPath in @('C:\ProgramData\WilliamOS\logs\hermes-ollama-serve.log','C:\ProgramData\WilliamOS\logs\hermes-ollama-serve.err.log','C:\ProgramData\WilliamOS\logs\hermes-ollama-serve.out.log')) {
    if (Test-Path -LiteralPath $logPath -PathType Leaf) {
      $stream = [IO.FileStream]::new($logPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
      try { $reader = [IO.StreamReader]::new($stream); try { $candidate = @([regex]::Split($reader.ReadToEnd(), '\r?\n') | Where-Object { $_ -match 'server config' }) | Select-Object -Last 1 } finally { $reader.Dispose() } } finally { $stream.Dispose() }
      if ($candidate -and [string]$candidate -match '(?:^|\s)time=([^\s]+)') {
        $candidateAt = [DateTimeOffset]::Parse([string]$Matches[1]).ToUniversalTime()
        if ((-not $processStartedAt -or $candidateAt.UtcDateTime -ge $processStartedAt.AddMinutes(-1)) -and
          (-not $serverConfigEvidenceAt -or $candidateAt -gt [DateTimeOffset]::Parse($serverConfigEvidenceAt))) {
          $serverConfigLine = [string]$candidate
          $serverConfigEvidenceAt = $candidateAt.ToString('o')
        }
      }
    }
  }
  $liveEnvironmentValues = [ordered]@{}
  foreach ($name in @('CUDA_VISIBLE_DEVICES','OLLAMA_LLM_LIBRARY','OLLAMA_NOPRUNE')) {
    if ($serverConfigLine -and $serverConfigLine -match "${name}:(\S+)") { $liveEnvironmentValues[$name] = [string]$Matches[1] }
  }
  $liveEnvironment = if ($liveEnvironmentValues.Count -eq 3) {
    [ordered]@{ state = 'OBSERVED'; values = $liveEnvironmentValues }
  } else {
    [ordered]@{ state = 'UNKNOWN'; reason = 'Latest allow-listed server-config line did not prove all required live fields' }
  }
  $taskArguments = if ($taskAction -and $taskAction.Arguments) { [string]$taskAction.Arguments } else { '' }
  $taskExecute = if ($taskAction -and $taskAction.Execute) { ([string]$taskAction.Execute).Trim() } else { '' }
  $trustedPowerShellActions = @('powershell.exe','C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe','C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe')
  $exactTaskArguments = '(?i)^-NoProfile\s+-NonInteractive\s+-ExecutionPolicy\s+Bypass\s+-File\s+"?C:\\HermesLab\\hermes\\ollama-service\\hermes-ollama-service\.ps1"?$'
  $taskTriggers = if ($task) { @($task.Triggers) } else { @() }
  $hasBootTrigger = @($taskTriggers | Where-Object { [bool]$_.Enabled -and $_.CimClass.CimClassName -eq 'MSFT_TaskBootTrigger' }).Count -eq 1
  $hasRecheckTrigger = @($taskTriggers | Where-Object { [bool]$_.Enabled -and $_.CimClass.CimClassName -eq 'MSFT_TaskTimeTrigger' -and [string]$_.Repetition.Interval -eq 'PT2M' }).Count -eq 1
  $allTaskTriggersActive = @($taskTriggers | Where-Object {
    $endBoundary = [string]$_.EndBoundary
    $endBoundary -and ([DateTimeOffset]::Parse($endBoundary).ToUniversalTime() -lt [DateTimeOffset]::UtcNow)
  }).Count -eq 0
  $taskHealthy = $task -and [string]$task.TaskPath -eq '\' -and [string]$task.State -eq 'Running' -and
    @($task.Actions).Count -eq 1 -and $trustedPowerShellActions -icontains $taskExecute -and $taskArguments.Trim() -match $exactTaskArguments -and
    [string]$task.Principal.UserId -eq 'SYSTEM' -and [string]$task.Principal.RunLevel -eq 'Highest' -and
    $taskTriggers.Count -eq 2 -and $hasBootTrigger -and $hasRecheckTrigger -and $allTaskTriggersActive
  $apiVersion = 'UNKNOWN'
  $models = @()
  $activeModels = @()
  if ($listener) {
    try {
      $versionResponse = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/version' -Method Get -TimeoutSec 5
      $tagsResponse = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -Method Get -TimeoutSec 10
      $processResponse = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/ps' -Method Get -TimeoutSec 10
      $apiVersion = Protect-Text ([string]$versionResponse.version)
      $models = @($tagsResponse.models | ForEach-Object { Protect-Text ([string]$_.name) } | Where-Object { $_ })
      $activeModels = @($processResponse.models | ForEach-Object { [ordered]@{ name = Protect-Text ([string]$_.name); sizeVramBytes = if ($null -ne $_.size_vram) { [int64]$_.size_vram } else { $null }; expiresAt = if ($_.expires_at) { ([DateTimeOffset]$_.expires_at).ToUniversalTime().ToString('o') } else { $null } } })
    } catch {
      $apiVersion = 'UNKNOWN'
      $models = @()
    }
  }
  $agreement = $liveExe -ne 'UNKNOWN' -and $liveExe -ieq $pinnedExe -and $liveBind -eq $pinnedBind -and $taskHealthy
  $value = [ordered]@{
    exe = Protect-Text $liveExe
    pinnedExe = Protect-Text $pinnedExe
    version = $apiVersion
    exeSha256 = if ($liveExe -ne 'UNKNOWN' -and (Test-Path -LiteralPath $liveExe -PathType Leaf)) { (Get-FileHash -Algorithm SHA256 -LiteralPath $liveExe).Hash.ToLowerInvariant() } else { 'UNKNOWN' }
    bind = $liveBind
    pinnedBind = $pinnedBind
    task = if ($task) { [ordered]@{ path = [string]$task.TaskPath; name = [string]$task.TaskName; state = [string]$task.State; execute = Protect-Text ([string]$taskAction.Execute); arguments = Protect-Text $taskArguments; principal = [ordered]@{ user = [string]$task.Principal.UserId; runLevel = [string]$task.Principal.RunLevel; logonType = [string]$task.Principal.LogonType }; triggers = @($task.Triggers | ForEach-Object { [ordered]@{ type = $_.CimClass.CimClassName; enabled = [bool]$_.Enabled; startBoundary = [string]$_.StartBoundary; endBoundary = [string]$_.EndBoundary; repetitionInterval = if ($_.Repetition) { [string]$_.Repetition.Interval } else { $null } } }) } } else { 'UNKNOWN' }
    pid = if ($process) { [int]$process.ProcessId } else { $null }
    safeConfig = $safeConfig
    liveEnvironment = $liveEnvironment
    liveEnvironmentEvidenceAt = $serverConfigEvidenceAt
    configurationAgreement = [bool]$agreement
    models = $models
    activeModels = $activeModels
  }
  if (($liveExe -ne 'UNKNOWN' -and $liveExe -ine $pinnedExe) -or ($liveBind -ne 'UNKNOWN' -and $liveBind -ne $pinnedBind) -or
    $safeConfig.serviceScriptSha256 -ne $safeConfig.repositoryDoctrineSha256) {
    [ordered]@{ __truth = 'CONFLICTING'; __value = $value }
  } else { $value }
} @('only allow-listed non-secret Ollama environment names are collected; values are scrubbed')

Add-Fact 'inference.dockerContainers' 'inference' 'Docker Engine read-only CLI' 'docker ps -a; docker inspect restart policy' 'VOLATILE' {
  @(& $dockerExecutable ps -a --format '{{json .}}' | ForEach-Object {
    $row = $_ | ConvertFrom-Json
    $restart = (& $dockerExecutable inspect --format '{{.HostConfig.RestartPolicy.Name}}' $row.ID 2>$null).Trim()
    [ordered]@{ id = [string]$row.ID; name = [string]$row.Names; image = [string]$row.Image; state = ([string]$row.State).ToLowerInvariant(); status = [string]$row.Status; ports = [string]$row.Ports; restartPolicy = if ($restart) { $restart } else { 'UNKNOWN' } }
  })
}

Add-Fact 'inference.guardBaseline' 'inference' 'Standing P40 guard state' 'Read allow-listed p40-guard.json health and commissioned baseline fields' 'VOLATILE' {
  $guardPath = 'C:\HermesLab\hermes\p40-guard.json'
  if (-not (Test-Path -LiteralPath $guardPath -PathType Leaf)) {
    return [ordered]@{ __truth = 'UNKNOWN'; __value = $null }
  }
  $guardText = [IO.File]::ReadAllText($guardPath)
  $guard = $guardText | ConvertFrom-Json
  $guardObservedAt = [DateTimeOffset]::Parse([string]$guard.ts).ToUniversalTime()
  [ordered]@{
    p40EquilibriumC = [double]$guard.baseline_equilibrium_c
    chassisDeltaC = [double]$guard.baseline_delta_c
    observedP40C = [double]$guard.temp_c
    observedChassisProxyC = [double]$guard.chassis_proxy_c
    observedDeltaC = [double]$guard.p40_chassis_delta_c
    uuid = [string]$guard.uuid
    driverModel = [string]$guard.driver_model
    powerLimitW = [double]$guard.power_limit_w
    overall = [string]$guard.overall
    simulated = [bool]$guard.simulated
    problems = @($guard.problems | ForEach-Object { Protect-Text ([string]$_) })
    observedAt = $guardObservedAt.ToString('o')
    sampleAgeSeconds = [math]::Round(((Get-Date).ToUniversalTime() - $guardObservedAt.UtcDateTime).TotalSeconds, 1)
    sourceSha256 = Get-Sha256Text $guardText
  }
}

Add-Fact 'dr.target' 'recovery' 'Local destination evidence only' 'Require capacity/access/storage-health/independence/read-back evidence without inferring from copied bytes' 'VOLATILE' {
  [ordered]@{ __truth = 'UNKNOWN'; __value = $null }
}

# Re-read only the endpoint tuple set at the end. A listener race is preserved as contradictory
# evidence; it is never flattened into whichever snapshot happened to run last.
if (-not $targetedMode -or $selectedFactIds.Contains('network.listeners')) { try {
  $postListeners = @(
    Get-NetTCPConnection -State Listen | ForEach-Object { "TCP|$($_.LocalAddress)|$($_.LocalPort)|$($_.OwningProcess)" }
    Get-NetUDPEndpoint | ForEach-Object { "UDP|$($_.LocalAddress)|$($_.LocalPort)|$($_.OwningProcess)" }
  ) | Sort-Object
  $preListeners = @($listenerSnapshot | ForEach-Object { "$($_.protocol)|$($_.address)|$($_.port)|$($_.pid)" }) | Sort-Object
  if (($preListeners -join "`n") -cne ($postListeners -join "`n")) {
    $listenerFact = $facts | Where-Object { $_.id -eq 'network.listeners' } | Select-Object -First 1
    $listenerFact['truth'] = 'CONFLICTING'
    $listenerFact['value'] = [ordered]@{ pre = @($listenerSnapshot); postTuples = @($postListeners); raceDetected = $true }
    $listenerFact['provenance']['result'] = 'CONTRADICTION_PRESERVED'
    $ownerFact = $facts | Where-Object { $_.id -eq 'network.specialPortOwners' } | Select-Object -First 1
    $ownerFact['truth'] = 'CONFLICTING'
    $ownerFact['provenance']['result'] = 'CONTRADICTION_PRESERVED'
  }
} catch {
  if ([string]$_.Exception.Message -match '(?i)access (?:is )?denied|unauthori[sz]ed|privilege') {
    throw 'HERMES_ATTESTATION_ACCESS_AMBIGUOUS: listener post-snapshot refused'
  }
  $listenerFact = $facts | Where-Object { $_.id -eq 'network.listeners' } | Select-Object -First 1
  $listenerFact['truth'] = 'CONFLICTING'
  $listenerFact['value'] = [ordered]@{ pre = @($listenerSnapshot); post = $null; raceDetected = 'UNKNOWN_POST_PROBE_FAILED' }
  $listenerFact['provenance']['result'] = 'CONTRADICTION_PRESERVED'
} }

$machineGuid = [string](Get-ItemPropertyValue 'HKLM:\SOFTWARE\Microsoft\Cryptography' 'MachineGuid')
$collectorHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $PSCommandPath).Hash.ToLowerInvariant()
if ($collectorHash -ne [string]$launchManifest.collectorSha256) { throw 'HERMES_ATTESTATION_COLLECTOR_DIGEST_MISMATCH' }
if ((Get-Sha256Text $resolvedOutput) -ne [string]$launchManifest.outputPathSha256) { throw 'HERMES_ATTESTATION_OUTPUT_BINDING_MISMATCH' }
$collectionCompleted = (Get-Date).ToUniversalTime()
$source = [ordered]@{
  schema = if ($targetedMode) { 'hermes-host-attestation-targeted-source/1' } else { 'hermes-host-attestation-source/1' }
  artifact = 'HERMES_HOST_ATTESTATION'
  collector = [ordered]@{ name = 'collect-hermes-host-attestation.v1.ps1'; version = $collectorVersion; sha256 = $collectorHash; readOnly = $true }
  authority = [ordered]@{
    boundary = 'single-prestaged-uac-read-only'
    elevated = $true
    persistentCredential = $false
    hostMutationAuthorized = $false
    launchNonce = [string]$launchManifest.nonce
    launchManifestSha256 = $launchManifestSha256
  }
  collectionId = $CollectionId
  collectedAt = $collectionStarted.ToString('o')
  collectionCompletedAt = $collectionCompleted.ToString('o')
  host = [ordered]@{ hostname = [Environment]::MachineName; machineIdentitySha256 = Get-Sha256Text $machineGuid; isWindows = $true }
}
if ($targetedMode) {
  $source['mode'] = 'SECURITY_INFERENCE'
  $source['requestedFactIds'] = @($requestedFactIds)
}
$source['facts'] = @($facts)

$json = ConvertTo-Json -InputObject $source -Depth 20
$file = [IO.FileStream]::new($resolvedOutput, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
try {
  $writer = [IO.StreamWriter]::new($file, [Text.UTF8Encoding]::new($false))
  try {
    $writer.Write($json)
    $writer.Flush()
    $file.Flush($true)
  } finally {
    $writer.Dispose()
  }
} finally {
  $file.Dispose()
}
