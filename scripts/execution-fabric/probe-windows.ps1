param(
  [Parameter(Mandatory = $true)][string]$NodeId,
  [string]$OutputPath = ""
)

$ErrorActionPreference = 'Stop'
$observed = (Get-Date).ToUniversalTime().ToString('o')
$warnings = [System.Collections.Generic.List[string]]::new()
$hostname = [Environment]::MachineName
$canonicalNodeIds = @{
  'OMEN' = 'omen'
  'HERMES' = 'hermes-node'
  'HERMES-NODE' = 'hermes-node'
}
$canonicalNodeId = $canonicalNodeIds[$hostname.ToUpperInvariant()]
if (-not $canonicalNodeId -or $NodeId -ne $canonicalNodeId) {
  throw "PROBE_NODE_IDENTITY_WALL hostname=$hostname requested=$NodeId canonical=$canonicalNodeId"
}

function Invoke-Safely([scriptblock]$Block, $Fallback = $null, [string]$Warning = '') {
  try { & $Block } catch { if ($Warning) { $warnings.Add("$Warning`: $($_.Exception.Message)") }; $Fallback }
}

function Convert-MemoryType($code) {
  $map = @{20='DDR';21='DDR2';24='DDR3';26='DDR4';34='DDR5'}
  if ($map.ContainsKey([int]$code)) { return $map[[int]$code] }
  return $null
}

$systemProduct = Get-CimInstance Win32_ComputerSystemProduct
$machineId = ([string]$systemProduct.UUID).Trim().ToLowerInvariant()
if (-not $machineId) { throw 'PROBE_MACHINE_ID_UNAVAILABLE' }
$sha256 = [Security.Cryptography.SHA256]::Create()
try {
  $machineIdHash = -join ($sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($machineId)) | ForEach-Object { $_.ToString('x2') })
} finally {
  $sha256.Dispose()
}

function Convert-PositiveInt64($Value) {
  if ($null -eq $Value) { return $null }
  try {
    $converted = [int64]$Value
    if ($converted -gt 0) { return $converted }
  } catch {}
  return $null
}

function Convert-NonBlankString($Value) {
  if ($null -eq $Value) { return $null }
  $converted = ([string]$Value).Trim()
  if ($converted) { return $converted }
  return $null
}
$os = Get-CimInstance Win32_OperatingSystem
$cpus = @(Get-CimInstance Win32_Processor | ForEach-Object {
  [ordered]@{
    id = "cpu$($_.DeviceID -replace '\D','')"
    socket = $_.SocketDesignation
    manufacturer = ($_.Manufacturer | ForEach-Object Trim)
    model = ($_.Name | ForEach-Object Trim)
    cores = [int]$_.NumberOfCores
    threads = [int]$_.NumberOfLogicalProcessors
    max_mhz = if ($_.MaxClockSpeed) { [double]$_.MaxClockSpeed } else { $null }
    numa_node = $null
  }
})

$dimms = @(Get-CimInstance Win32_PhysicalMemory | Where-Object { $_.Capacity -gt 0 } | ForEach-Object {
  [ordered]@{
    locator = [string]$_.DeviceLocator
    bank = [string]$_.BankLabel
    capacity_bytes = [int64]$_.Capacity
    memory_type = Convert-MemoryType $_.SMBIOSMemoryType
    form_factor = [string]$_.FormFactor
    ecc = if ($_.TotalWidth -and $_.DataWidth) { [bool]([int]$_.TotalWidth -gt [int]$_.DataWidth) } else { $null }
    registered = $null
    configured_mhz = if ($_.ConfiguredClockSpeed) { [double]$_.ConfiguredClockSpeed } else { $null }
    rated_mhz = if ($_.Speed) { [double]$_.Speed } else { $null }
    manufacturer = if ($_.Manufacturer) { $_.Manufacturer.Trim() } else { $null }
    part_number = if ($_.PartNumber) { $_.PartNumber.Trim() } else { $null }
    serial = if ($_.SerialNumber) { $_.SerialNumber.Trim() } else { $null }
  }
})

$gpuRows = @()
$nvidia = Get-Command nvidia-smi -ErrorAction SilentlyContinue
if ($nvidia) {
  $gpuRows = Invoke-Safely {
    @(& nvidia-smi --query-gpu=uuid,name,pci.bus_id,memory.total,driver_version,temperature.gpu,utilization.gpu --format=csv,noheader,nounits | ForEach-Object {
      $p = $_ -split ',\s*'
      [ordered]@{
        id = "gpu-$($p[0])"
        vendor = 'NVIDIA'
        model = $p[1]
        pci_bus_id = $p[2]
        uuid = $p[0]
        vram_bytes = [int64]([double]$p[3] * 1MB)
        driver_version = $p[4]
        cuda_version = $null
        compute_capability = $null
        temperature_c = if ($p[5] -match '^\d') { [double]$p[5] } else { $null }
        utilization_percent = if ($p[6] -match '^\d') { [double]$p[6] } else { $null }
      }
    })
  } @() 'nvidia-smi failed'
}
if (-not $gpuRows -or $gpuRows.Count -eq 0) {
  $gpuRows = @(Get-CimInstance Win32_VideoController | ForEach-Object {
    [ordered]@{
      id = [string]$_.PNPDeviceID
      vendor = if ($_.AdapterCompatibility) { $_.AdapterCompatibility } else { 'unknown' }
      model = [string]$_.Name
      pci_bus_id = $null
      uuid = $null
      vram_bytes = if ($_.AdapterRAM) { [int64]$_.AdapterRAM } else { $null }
      driver_version = [string]$_.DriverVersion
      cuda_version = $null
      compute_capability = $null
      temperature_c = $null
      utilization_percent = $null
    }
  })
  if ($gpuRows.Count -gt 0) {
    $warnings.Add('GPU inventory used Win32_VideoController fallback; AdapterRAM may understate VRAM above 4 GiB')
  }
}

$diskRows = Invoke-Safely { @(Get-Disk -ErrorAction Stop | ForEach-Object {
  $disk = $_
  $capacity = Convert-PositiveInt64 $disk.Size
  if ($null -eq $capacity) { $warnings.Add("disk $($disk.Number) reported non-positive capacity; retained as unknown and unschedulable") }
  $fs = @()
  try {
    $fs = @(Get-Partition -DiskNumber $disk.Number -ErrorAction Stop | ForEach-Object {
      $part = $_
      $vol = $part | Get-Volume -ErrorAction SilentlyContinue
      $partitionSize = Convert-PositiveInt64 $part.Size
      if ($null -eq $partitionSize) {
        $warnings.Add("disk $($disk.Number) partition $($part.PartitionNumber) reported non-positive size; relationship omitted")
      } else {
        [ordered]@{
          partition = [string]$part.PartitionNumber
          drive_letter = if ($part.DriveLetter) { [string]$part.DriveLetter } else { $null }
          filesystem = if ($vol) { [string]$vol.FileSystem } else { $null }
          label = if ($vol) { [string]$vol.FileSystemLabel } else { $null }
          size_bytes = $partitionSize
        }
      }
    })
  } catch { $warnings.Add("disk $($disk.Number) filesystem enumeration failed: $($_.Exception.Message)") }
  [ordered]@{
    id = "disk-$($disk.Number)"
    model = [string]$disk.FriendlyName
    serial = Convert-NonBlankString $disk.SerialNumber
    capacity_bytes = $capacity
    transport = [string]$disk.BusType
    rotational = $null
    smart_overall = [string]$disk.HealthStatus
    power_on_hours = $null
    reallocated = $null
    pending = $null
    uncorrectable = $null
    filesystems = $fs
  }
}) } @() 'Storage module disk enumeration unavailable'
if (-not $diskRows -or $diskRows.Count -eq 0) {
  $diskRows = @(Get-CimInstance Win32_DiskDrive | ForEach-Object {
    $capacity = Convert-PositiveInt64 $_.Size
    if ($null -eq $capacity) { $warnings.Add("disk $($_.Index) reported non-positive capacity; retained as unknown and unschedulable") }
    [ordered]@{
      id = "disk-$($_.Index)"
      model = if ($_.Model) { [string]$_.Model } else { [string]$_.Caption }
      serial = Convert-NonBlankString $_.SerialNumber
      capacity_bytes = $capacity
      transport = if ($_.InterfaceType) { [string]$_.InterfaceType } else { $null }
      rotational = $null
      smart_overall = if ($_.Status) { [string]$_.Status } else { $null }
      power_on_hours = $null
      reallocated = $null
      pending = $null
      uncorrectable = $null
      filesystems = @()
    }
  })
  if ($diskRows.Count -gt 0) {
    $warnings.Add('Disk inventory used Win32_DiskDrive fallback; partition/filesystem relationships are unavailable')
  }
}

$ipConfigs = Invoke-Safely { @(Get-NetIPConfiguration -ErrorAction Stop) } @() 'NetTCPIP configuration unavailable'
$netRows = Invoke-Safely { @(Get-NetAdapter -ErrorAction Stop | ForEach-Object {
  $a = $_
  $cfg = $ipConfigs | Where-Object InterfaceIndex -eq $a.ifIndex | Select-Object -First 1
  $addresses = @()
  if ($cfg) {
    $addresses += @($cfg.IPv4Address | ForEach-Object IPAddress)
    $addresses += @($cfg.IPv6Address | ForEach-Object IPAddress)
  }
  [ordered]@{
    id = "nic-$($a.ifIndex)"
    name = [string]$a.Name
    mac = [string]$a.MacAddress
    state = if ($a.Status -eq 'Up') { 'up' } elseif ($a.Status -eq 'Disabled' -or $a.Status -eq 'Disconnected') { 'down' } else { 'unknown' }
    speed_mbps = if ($a.LinkSpeed -match '([0-9.]+)\s*Gbps') { [double]$Matches[1] * 1000 } elseif ($a.LinkSpeed -match '([0-9.]+)\s*Mbps') { [double]$Matches[1] } else { $null }
    duplex = $null
    addresses = $addresses
    default_route = if ($cfg -and $cfg.IPv4DefaultGateway) { $true } else { $false }
  }
}) } @() 'NetAdapter enumeration unavailable'
if (-not $netRows -or $netRows.Count -eq 0) {
  $defaultRoutes = @(Get-CimInstance Win32_IP4RouteTable -ErrorAction SilentlyContinue | Where-Object Destination -eq '0.0.0.0')
  $netRows = @(Get-CimInstance Win32_NetworkAdapterConfiguration -Filter 'IPEnabled = TRUE' | ForEach-Object {
    $adapter = Get-CimInstance Win32_NetworkAdapter -Filter "Index = $($_.Index)" -ErrorAction SilentlyContinue
    [ordered]@{
      id = "nic-$($_.Index)"
      name = if ($adapter.NetConnectionID) { [string]$adapter.NetConnectionID } else { [string]$_.Description }
      mac = if ($_.MACAddress) { [string]$_.MACAddress } else { $null }
      state = if ($adapter.NetEnabled) { 'up' } else { 'unknown' }
      speed_mbps = if ($adapter.Speed) { [double]$adapter.Speed / 1000000 } else { $null }
      duplex = $null
      addresses = @($_.IPAddress)
      default_route = [bool]($defaultRoutes | Where-Object InterfaceIndex -eq $_.InterfaceIndex)
    }
  })
  if ($netRows.Count -gt 0) {
    $warnings.Add('Network inventory used CIM fallback; duplex and some route/link details may be unavailable')
  }
}

$runtimes = [System.Collections.Generic.List[object]]::new()
$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($docker) {
  $dv = Invoke-Safely { (& docker version --format '{{.Server.Version}}' 2>$null).Trim() } $null 'docker version failed'
  $runtimes.Add([ordered]@{id='docker';kind='docker';version=$dv;state=if($dv){'running'}else{'unavailable'};endpoint=$null;details=@{}})
}
$wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
if ($wsl) {
  $wslProcesses = @(Get-Process -Name wsl,wslhost,wslservice -ErrorAction SilentlyContinue)
  $runtimes.Add([ordered]@{
    id = 'wsl'
    kind = 'wsl'
    version = $null
    state = if ($wslProcesses.Count -gt 0) { 'running' } else { 'unknown' }
    endpoint = $null
    details = @{observation='process-state only; wsl.exe status is not invoked because it can block'}
  })
}
$ssh = Get-Service sshd -ErrorAction SilentlyContinue
if ($ssh) { $runtimes.Add([ordered]@{id='ssh';kind='ssh';version=$null;state=if($ssh.Status -eq 'Running'){'running'}else{'stopped'};endpoint=$null;details=@{start_type=[string]$ssh.StartType}}) }
$ollama = Invoke-Safely { Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 } $null
if ($ollama) { $runtimes.Add([ordered]@{id='ollama';kind='ollama';version=$null;state='healthy';endpoint='http://127.0.0.1:11434';details=@{models=@($ollama.models | ForEach-Object name)}}) }

$result = [ordered]@{
  schema_version = '0.1-node-probe'
  node = [ordered]@{
    id = $canonicalNodeId
    hostname = $hostname
    identity = [ordered]@{
      hostname = $hostname
      machine_id_sha256 = $machineIdHash
      source = 'windows-cim-system-uuid-sha256'
    }
    observed_at = $observed
    os = [ordered]@{family='windows';caption=$os.Caption;version=$os.Version;build=$os.BuildNumber}
    cpus = @($cpus)
    dimms = @($dimms)
    gpus = @($gpuRows)
    disks = @($diskRows)
    network = @($netRows)
    runtimes = @($runtimes)
    warnings = @($warnings)
  }
  evidence = [ordered]@{
    observed_at = $observed
    probe = 'scripts/execution-fabric/probe-windows.ps1'
    probe_version = '0.1'
    confidence = 'observed'
  }
}

$json = ConvertTo-Json -InputObject $result -Depth 12
if ($OutputPath) {
  $resolvedOutputPath = [System.IO.Path]::GetFullPath((Join-Path (Get-Location).ProviderPath $OutputPath))
  $parent = Split-Path -Parent $resolvedOutputPath
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  [System.IO.File]::WriteAllText($resolvedOutputPath, $json, [System.Text.UTF8Encoding]::new($false))
}
$json
