$ErrorActionPreference = 'Continue'
# #997 RESUME — PHYSICAL storage re-enumeration after the SSD was bumped.
# Get-Volume alone cannot answer "does F: exist" — a disk that is present but OFFLINE, or a disk
# that vanished from the bus entirely, both look identical to a volume listing. This probe asks the
# disk/serial/partition layer directly, and asks the event log whether media left the bus.
Write-Output '--- GET-DISK ---'
Get-Disk | Select-Object Number, FriendlyName, SerialNumber, OperationalStatus, HealthStatus, IsOffline, IsReadOnly, PartitionStyle, Size, BusType | Format-Table -AutoSize | Out-String -Width 240
Write-Output '--- GET-PHYSICALDISK ---'
Get-PhysicalDisk | Select-Object DeviceId, FriendlyName, SerialNumber, MediaType, BusType, HealthStatus, OperationalStatus, Size | Format-Table -AutoSize | Out-String -Width 240
Write-Output '--- GET-PARTITION-ALL ---'
Get-Partition | Select-Object DiskNumber, PartitionNumber, DriveLetter, Type, Size, IsHidden, IsSystem | Format-Table -AutoSize | Out-String -Width 240
Write-Output '--- GET-VOLUME-ALL ---'
Get-Volume | Select-Object DriveLetter, FileSystemLabel, FileSystem, DriveType, HealthStatus, OperationalStatus, Size, SizeRemaining, UniqueId | Format-Table -AutoSize | Out-String -Width 280
Write-Output '--- F-PROBE ---'
Write-Output "TestPath_F_root=$(Test-Path 'F:\')"
Write-Output "PSDrive_F=$([bool](Get-PSDrive -Name F -ErrorAction SilentlyContinue))"
Write-Output "Win32LogicalDisk_F=$((Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='F:'" -ErrorAction SilentlyContinue | Measure-Object).Count)"
Write-Output "TestPath_F_ollama=$(Test-Path 'F:\HermesData\ollama')"
Write-Output '--- MOUNTED-DEVICES-DOSDEVICES ---'
# The registry remembers every drive letter this Windows install has ever assigned. If F: was ever
# a real volume on this machine, its letter is recorded here even after the media is gone.
(Get-Item 'HKLM:\SYSTEM\MountedDevices' -ErrorAction SilentlyContinue).GetValueNames() | Where-Object { $_ -like '\DosDevices\*' } | Sort-Object
Write-Output '--- MOUNTED-DEVICES-F-VALUE ---'
$md = Get-ItemProperty 'HKLM:\SYSTEM\MountedDevices' -ErrorAction SilentlyContinue
if ($md.PSObject.Properties.Name -contains '\DosDevices\F:') {
    $bytes = $md.'\DosDevices\F:'
    Write-Output "F_LETTER_RECORDED=true bytes=$($bytes.Length)"
    Write-Output ("F_ASCII=" + (($bytes | Where-Object { $_ -ge 32 -and $_ -lt 127 } | ForEach-Object { [char]$_ }) -join ''))
    Write-Output ("F_HEX=" + (($bytes | ForEach-Object { $_.ToString('x2') }) -join ''))
} else {
    Write-Output 'F_LETTER_RECORDED=false'
}
Write-Output '--- D-VOLUME-IDENTITY ---'
$dp = Get-Partition -DriveLetter D -ErrorAction SilentlyContinue
if ($dp) {
    $dd = Get-Disk -Number $dp.DiskNumber
    Write-Output "D_disk=$($dd.Number) model=$($dd.FriendlyName) serial=$($dd.SerialNumber) bus=$($dd.BusType) guid=$($dp.Guid)"
} else { Write-Output 'D_PARTITION_ABSENT' }
Write-Output '--- D-OLLAMA-STORE ---'
Write-Output "TestPath_D_ollama=$(Test-Path 'D:\HermesData\ollama')"
if (Test-Path 'D:\HermesData\ollama') {
    Get-ChildItem 'D:\HermesData\ollama' -Force | Select-Object Name, Mode, LastWriteTimeUtc | Format-Table -AutoSize | Out-String -Width 160
    if (Test-Path 'D:\HermesData\ollama\models\blobs') {
        $b = Get-ChildItem 'D:\HermesData\ollama\models\blobs' -File
        $m = $b | Measure-Object -Sum Length
        Write-Output "blobs_count=$($m.Count) blobs_bytes=$($m.Sum)"
        Write-Output "blobs_oldest=$(($b | Sort-Object LastWriteTimeUtc | Select-Object -First 1).LastWriteTimeUtc.ToString('o'))"
        Write-Output "blobs_newest=$(($b | Sort-Object LastWriteTimeUtc | Select-Object -Last 1).LastWriteTimeUtc.ToString('o'))"
    } else { Write-Output 'NO_BLOBS_D' }
    if (Test-Path 'D:\HermesData\ollama\models\manifests') {
        Get-ChildItem 'D:\HermesData\ollama\models\manifests' -Recurse -File | ForEach-Object { "manifest=" + $_.FullName.Substring(38) + " mtime=" + $_.LastWriteTimeUtc.ToString('o') }
    } else { Write-Output 'NO_MANIFESTS_D' }
}
Write-Output '--- OTHER-DRIVE-OLLAMA-SEARCH ---'
# If the model library lives anywhere else on this machine, say so rather than assuming.
foreach ($root in @('C:\HermesData', 'G:\HermesData', 'E:\HermesData', 'G:\', 'C:\HermesLab')) {
    if (Test-Path $root) {
        Write-Output "PRESENT $root"
    } else {
        Write-Output "ABSENT  $root"
    }
}
if (Test-Path 'G:\') { Get-ChildItem 'G:\' -Force -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name }
Write-Output '--- DISK-EVENTS-SINCE-BOOT ---'
$boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
Write-Output "LastBootUpTime_UTC=$($boot.ToUniversalTime().ToString('o'))"
Get-WinEvent -FilterHashtable @{LogName = 'System'; StartTime = $boot.AddHours(-3) } -ErrorAction SilentlyContinue |
    Where-Object { $_.ProviderName -match 'disk|storahci|partmgr|Ntfs|volmgr|stornvme|volsnap' } |
    Select-Object -First 40 TimeCreated, ProviderName, Id, LevelDisplayName, @{n = 'Msg'; e = { ($_.Message -replace '\s+', ' ').Substring(0, [Math]::Min(150, $_.Message.Length)) } } |
    Format-Table -AutoSize -Wrap | Out-String -Width 220
Write-Output '--- RC ---'
