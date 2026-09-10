# Privileged HERMES observer: reads approved Windows/Docker facts and emits one raw JSON envelope.
# It does not classify, compare, repair, write evidence, or choose doctrine.
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$checkpoint = 'BOOTSTRAP'
$exitCodes = @{
    BOOTSTRAP = 231
    HOST_IDENTITY = 232
    SERVICES = 233
    TASKS = 234
    NETWORK_AND_PROCESSES = 235
    DOCKER = 236
    SERIALIZE = 237
    UNKNOWN = 251
}

function Get-Sha256Text {
    param([Parameter(Mandatory = $true)][string]$Text)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
        ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

try {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'OBSERVER_REQUIRES_ADMINISTRATOR'
    }

    $checkpoint = 'HOST_IDENTITY'
    $uuid = [string](Get-CimInstance Win32_ComputerSystemProduct -ErrorAction Stop).UUID
    if ([string]::IsNullOrWhiteSpace($uuid)) { throw 'HOST_UUID_MISSING' }
    $hostIdentitySha256 = Get-Sha256Text -Text $uuid.Trim().ToLowerInvariant()

    $checkpoint = 'SERVICES'
    $services = @(
        Get-CimInstance Win32_Service -ErrorAction Stop |
            ForEach-Object {
                [ordered]@{
                    name = [string]$_.Name
                    displayName = [string]$_.DisplayName
                    startMode = [string]$_.StartMode
                    state = [string]$_.State
                    startName = [string]$_.StartName
                    pathName = [string]$_.PathName
                }
            }
    )

    $checkpoint = 'TASKS'
    $tasks = @(
        Get-ScheduledTask -ErrorAction Stop |
            ForEach-Object {
                $path = '{0}{1}' -f ([string]$_.TaskPath), ([string]$_.TaskName)
                $xml = Export-ScheduledTask -TaskName $_.TaskName -TaskPath $_.TaskPath -ErrorAction Stop
                [ordered]@{
                    path = $path
                    xmlBase64 = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes([string]$xml))
                }
            }
    )

    $checkpoint = 'NETWORK_AND_PROCESSES'
    $tcpListeners = @(
        Get-NetTCPConnection -State Listen -ErrorAction Stop |
            ForEach-Object {
                [ordered]@{
                    protocol = 'tcp'
                    localAddress = [string]$_.LocalAddress
                    localPort = [int]$_.LocalPort
                    owningProcess = [int]$_.OwningProcess
                }
            }
    )
    $udpEndpoints = @(
        Get-NetUDPEndpoint -ErrorAction Stop |
            ForEach-Object {
                [ordered]@{
                    protocol = 'udp'
                    localAddress = [string]$_.LocalAddress
                    localPort = [int]$_.LocalPort
                    owningProcess = [int]$_.OwningProcess
                }
            }
    )
    $processes = @(
        Get-CimInstance Win32_Process -ErrorAction Stop |
            ForEach-Object {
                $owner = 'UNKNOWN'
                $ownerEvidenceState = 'UNKNOWN'
                if ([int]$_.ProcessId -in @(0, 4)) {
                    $owner = 'NT AUTHORITY\SYSTEM'
                    $ownerEvidenceState = 'OBSERVED_BY_WINDOWS_PROCESS_CLASS'
                } else {
                    try {
                        $ownerResult = Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction Stop
                        if ([int]$ownerResult.ReturnValue -eq 0 -and -not [string]::IsNullOrWhiteSpace([string]$ownerResult.User)) {
                            $owner = if ([string]::IsNullOrWhiteSpace([string]$ownerResult.Domain)) {
                                [string]$ownerResult.User
                            } else {
                                '{0}\{1}' -f ([string]$ownerResult.Domain), ([string]$ownerResult.User)
                            }
                            $ownerEvidenceState = 'OBSERVED'
                        }
                    } catch {
                        $ownerEvidenceState = 'READ_ONLY_PROBE_FAILED'
                    }
                }
                [ordered]@{
                    processId = [int]$_.ProcessId
                    parentProcessId = [int]$_.ParentProcessId
                    name = [string]$_.Name
                    executablePath = [string]$_.ExecutablePath
                    commandLine = [string]$_.CommandLine
                    creationDate = if ($_.CreationDate) { ([datetime]$_.CreationDate).ToUniversalTime().ToString('o') } else { $null }
                    owner = $owner
                    ownerEvidenceState = $ownerEvidenceState
                }
            }
    )

    $checkpoint = 'DOCKER'
    $containerIds = @(& docker.exe ps -aq --no-trunc)
    if ($LASTEXITCODE -ne 0) { throw "DOCKER_PS_FAILED exit=$LASTEXITCODE" }
    $dockerResidents = @()
    if ($containerIds.Count -gt 0) {
        $dockerJson = (& docker.exe inspect @containerIds) -join "`n"
        if ($LASTEXITCODE -ne 0) { throw "DOCKER_INSPECT_FAILED exit=$LASTEXITCODE" }
        $dockerResidents = @($dockerJson | ConvertFrom-Json -ErrorAction Stop)
    }

    $checkpoint = 'SERIALIZE'
    $envelope = [ordered]@{
        schema = 'hermes-host-raw-observation/1'
        observedAt = [DateTime]::UtcNow.ToString('o')
        hostIdentitySha256 = $hostIdentitySha256
        raw = [ordered]@{
            services = $services
            scheduledTaskXml = $tasks
            tcpListeners = $tcpListeners
            udpEndpoints = $udpEndpoints
            processes = $processes
            dockerInspect = $dockerResidents
        }
    }
    [Console]::Out.WriteLine(($envelope | ConvertTo-Json -Depth 100 -Compress))
    exit 0
} catch {
    $safeType = $_.Exception.GetType().FullName
    $safeMessage = ([string]$_.Exception.Message) -replace '[\r\n]+', ' '
    [Console]::Error.WriteLine("HERMES_DOCTRINE_OBSERVER_FAILED checkpoint=$checkpoint type=$safeType message=$safeMessage")
    if ($exitCodes.ContainsKey($checkpoint)) { exit $exitCodes[$checkpoint] }
    exit $exitCodes.UNKNOWN
}
