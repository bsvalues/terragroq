#requires -Version 7.5

Set-StrictMode -Version Latest

$global:LAB_CONTROL_EXIT_CODE = 0

function ConvertTo-LabEncodedPowerShellCommand {
    param([Parameter(Mandatory)][string]$Command)

    [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Command))
}

function ConvertTo-LabEncodedShellCommand {
    param([Parameter(Mandatory)][string]$Command)

    $normalized = $Command.Replace("`r`n", "`n").Replace("`r", "`n")
    [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($normalized))
}

function Get-LabFailureKind {
    param(
        [string[]]$Lines,
        [Parameter(Mandatory)][int]$ExitCode
    )

    $message = ($Lines -join "`n")
    if ($message -match '(?i)LAB_RELAY_CONFIG_MISMATCH') {
        return 'SSH_RELAY_CONFIG_MISMATCH'
    }
    if ($message -match '(?i)LAB_RELAY_FINGERPRINT_MISMATCH') {
        return 'SSH_HOST_KEY_BLOCKED'
    }
    if ($ExitCode -ne 255) {
        return 'REMOTE_COMMAND_FAILED'
    }
    if ($message -match '(?i)permission denied|publickey|authentication failed') {
        return 'SSH_AUTH_BLOCKED'
    }
    if ($message -match '(?i)connection timed out|operation timed out') {
        return 'SSH_TIMEOUT'
    }
    if ($message -match '(?i)connection refused') {
        return 'SSH_REFUSED'
    }
    if ($message -match '(?i)could not resolve hostname|name or service not known') {
        return 'SSH_NAME_ERROR'
    }
    if ($message -match '(?i)host key verification failed|remote host identification has changed') {
        return 'SSH_HOST_KEY_BLOCKED'
    }
    return 'SSH_UNREACHABLE'
}

function ConvertFrom-LabSshFingerprintLine {
    param([Parameter(Mandatory)][string]$Line)

    if ($Line -cnotmatch '^\s*\d+\s+(?<fingerprint>SHA256:[A-Za-z0-9+/]{43})\s+.*\((?<algorithm>[A-Z0-9-]+)\)\s*$') {
        return $null
    }
    [pscustomobject]@{
        Fingerprint = $Matches.fingerprint
        Algorithm = $Matches.algorithm
    }
}

function Get-LabPinnedKnownHostLines {
    param(
        [Parameter(Mandatory)]$Route,
        [Parameter(Mandatory)][string]$KnownHostsFile
    )

    $keygen = if ($env:LAB_CONTROL_SSH_KEYGEN_EXECUTABLE) {
        $env:LAB_CONTROL_SSH_KEYGEN_EXECUTABLE
    } else {
        'ssh-keygen'
    }
    if (-not $env:LAB_CONTROL_SSH_KEYGEN_EXECUTABLE -and
        -not (Test-Path -LiteralPath $KnownHostsFile -PathType Leaf)) {
        return [pscustomobject]@{ Ok = $false; Lines = @() }
    }
    $lookup = if ([int]$Route.endpoint.port -eq 22) {
        [string]$Route.endpoint.host
    } else {
        "[$($Route.endpoint.host)]:$($Route.endpoint.port)"
    }
    try {
        $keyLines = @(& $keygen -F $lookup -f $KnownHostsFile 2>$null)
        if (@($keyLines | Where-Object {
            $_ -cmatch '^@revoked\s+\S+\s+ssh-ed25519\s+\S+(?:\s.*)?$'
        }).Count -gt 0) {
            return [pscustomobject]@{ Ok = $false; Lines = @() }
        }
        $ed25519KeyLines = @($keyLines | Where-Object {
            $_ -cmatch '^\S+\s+ssh-ed25519\s+\S+(?:\s.*)?$'
        })
        if ($ed25519KeyLines.Count -eq 0) {
            return [pscustomobject]@{ Ok = $false; Lines = @() }
        }
        $pinnedLines = [Collections.Generic.List[string]]::new()
        foreach ($keyLine in $ed25519KeyLines) {
            $fingerprintLines = @($keyLine | & $keygen -lf - -E sha256 2>$null)
            if ($fingerprintLines.Count -ne 1) {
                return [pscustomobject]@{ Ok = $false; Lines = @() }
            }
            $record = ConvertFrom-LabSshFingerprintLine -Line ([string]$fingerprintLines[0])
            if ($null -eq $record -or
                $record.Algorithm -cne 'ED25519' -or
                $record.Fingerprint -cne [string]$Route.hostKeyFingerprint) {
                return [pscustomobject]@{ Ok = $false; Lines = @() }
            }
            $pinnedLines.Add([string]$keyLine)
        }
        [pscustomobject]@{ Ok = $pinnedLines.Count -gt 0; Lines = @($pinnedLines) }
    } catch {
        [pscustomobject]@{ Ok = $false; Lines = @() }
    }
}

function New-LabPinnedKnownHostsFile {
    param([Parameter(Mandatory)][string[]]$Lines)

    $path = Join-Path ([IO.Path]::GetTempPath()) ('williamos-lab-known-hosts-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    if ($path.Contains('%')) {
        throw 'LAB_CONTROL_CONFIGURATION_INVALID: temporary trust paths containing percent expansion syntax are not supported.'
    }
    [IO.File]::WriteAllLines($path, $Lines, [Text.UTF8Encoding]::new($false))
    $path
}

function Get-LabSshWallTimeoutMs {
    $maximum = 30000
    if ([string]::IsNullOrWhiteSpace($env:LAB_CONTROL_SSH_WALL_TIMEOUT_MS)) {
        return $maximum
    }
    $requested = 0
    if (-not [int]::TryParse($env:LAB_CONTROL_SSH_WALL_TIMEOUT_MS, [ref]$requested) -or
        $requested -lt 100 -or $requested -gt $maximum) {
        throw "LAB_CONTROL_CONFIGURATION_INVALID: LAB_CONTROL_SSH_WALL_TIMEOUT_MS must be an integer from 100 through $maximum."
    }
    $requested
}

function Resolve-LabSshExecutable {
    param([Parameter(Mandatory)][string]$Executable)

    if ([IO.Path]::GetExtension($Executable) -ieq '.ps1') {
        $resolvedScript = [IO.Path]::GetFullPath($Executable)
        if (-not (Test-Path -LiteralPath $resolvedScript -PathType Leaf)) {
            throw 'SSH client executable is unavailable.'
        }
        if ($resolvedScript.Contains('%')) {
            throw 'LAB_CONTROL_CONFIGURATION_INVALID: SSH client paths containing percent expansion syntax are not supported.'
        }
        return $resolvedScript
    }
    $application = @(Get-Command -Name $Executable -CommandType Application -ErrorAction Stop | Select-Object -First 1)
    if ($application.Count -ne 1 -or [string]::IsNullOrWhiteSpace($application[0].Source)) {
        throw 'SSH client executable is unavailable.'
    }
    $resolvedApplication = [IO.Path]::GetFullPath($application[0].Source)
    if ($resolvedApplication.Contains('%')) {
        throw 'LAB_CONTROL_CONFIGURATION_INVALID: SSH client paths containing percent expansion syntax are not supported.'
    }
    $resolvedApplication
}

function ConvertTo-LabProxyCommandToken {
    param([Parameter(Mandatory)][string]$Value)

    if ($Value -match '[\x00-\x1f\x7f"]') {
        throw 'TOPOLOGY_INVALID: unsafe value reached the proxy command boundary.'
    }
    if ($Value.Contains('%') -and $Value -cne '%h:%p') {
        throw 'TOPOLOGY_INVALID: percent expansion is forbidden in dynamic proxy command tokens.'
    }
    '"' + $Value + '"'
}

function Invoke-LabBoundedProcess {
    param(
        [Parameter(Mandatory)][string]$Executable,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][int]$TimeoutMs
    )

    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    if ([IO.Path]::GetExtension($Executable) -ieq '.ps1') {
        $startInfo.FileName = [Environment]::ProcessPath
        foreach ($argument in @('-NoLogo', '-NoProfile', '-NonInteractive', '-File', $Executable)) {
            [void]$startInfo.ArgumentList.Add($argument)
        }
    } else {
        $startInfo.FileName = $Executable
    }
    foreach ($argument in $Arguments) {
        [void]$startInfo.ArgumentList.Add($argument)
    }

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) {
            throw 'process start returned false'
        }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutMs)) {
            try { $process.Kill($true) } catch { try { $process.Kill() } catch {} }
            $process.WaitForExit()
            [void]$stdoutTask.GetAwaiter().GetResult()
            [void]$stderrTask.GetAwaiter().GetResult()
            return [pscustomobject]@{ TimedOut = $true; ExitCode = 124; Lines = @() }
        }
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult()
        $lines = @(
            @($stdout, $stderr) |
                ForEach-Object { $_ -split "`r?`n" } |
                Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        )
        [pscustomobject]@{ TimedOut = $false; ExitCode = $process.ExitCode; Lines = $lines }
    } finally {
        $process.Dispose()
    }
}

function Invoke-LabSsh {
    param(
        [Parameter(Mandatory)][string]$Target,
        [Parameter(Mandatory)][string]$RemoteCommand,
        [Parameter(Mandatory)]$Route,
        [Parameter(Mandatory)]$Topology
    )

    if ($Target -cnotmatch '^[a-z][a-z0-9-]{0,31}$') {
        throw 'TOPOLOGY_INVALID: unsafe SSH alias reached the transport boundary.'
    }
    $wallTimeoutMs = Get-LabSshWallTimeoutMs

    $sshSelection = if ($env:LAB_CONTROL_SSH_EXECUTABLE) {
        $env:LAB_CONTROL_SSH_EXECUTABLE
    } else {
        'ssh'
    }
    $ssh = Resolve-LabSshExecutable -Executable $sshSelection
    $proxyExecutableArguments = if ([IO.Path]::GetExtension($ssh) -ieq '.ps1') {
        @([Environment]::ProcessPath, '-NoLogo', '-NoProfile', '-NonInteractive', '-File', $ssh)
    } else {
        @($ssh)
    }
    if ($Route.routeKind -cnotin @('direct', 'proxy-jump') -or
        $Route.identityRef -cne 'OMEN_DEFAULT_ED25519' -or
        $Route.knownHostsRef -cne 'OMEN_USER_KNOWN_HOSTS') {
        throw "TOPOLOGY_INVALID: route $($Route.toNodeId) cannot cross the OMEN SSH boundary."
    }
    $identityFile = Join-Path $HOME '.ssh\id_ed25519'
    $knownHostsFile = Join-Path $HOME '.ssh\known_hosts'
    $trustRoutes = @($Route)
    $jumpRoute = $null
    if ($Route.routeKind -ceq 'proxy-jump') {
        $jumpNodeId = @($Route.viaNodeIds)[0]
        $jumpRoutes = @($Topology.managementRoutes | Where-Object toNodeId -CEQ $jumpNodeId)
        if ($jumpRoutes.Count -ne 1 -or $jumpRoutes[0].routeKind -cne 'direct') {
            throw "TOPOLOGY_INVALID: proxy-jump route for $($Route.toNodeId) has no unique direct jump route."
        }
        $jumpRoute = $jumpRoutes[0]
        $trustRoutes += $jumpRoute
    }

    $pinnedFiles = [Collections.Generic.List[string]]::new()
    $pinnedByTarget = @{}
    try {
        foreach ($trustRoute in $trustRoutes) {
            $verification = Get-LabPinnedKnownHostLines -Route $trustRoute -KnownHostsFile $knownHostsFile
            if (-not $verification.Ok) {
                return [pscustomobject]@{
                    Target = $Target
                    Ok = $false
                    ExitCode = 64
                    FailureKind = 'SSH_HOST_KEY_BLOCKED'
                    Lines = @("Managed ED25519 host-key fingerprint mismatch for $($trustRoute.toNodeId).")
                }
            }
            $pinnedPath = New-LabPinnedKnownHostsFile -Lines $verification.Lines
            $pinnedFiles.Add($pinnedPath)
            $pinnedByTarget[$trustRoute.toNodeId] = $pinnedPath
        }
        $proxyCommand = 'none'
        if ($null -ne $jumpRoute) {
            $jump = $jumpRoute.endpoint
            $jumpKnownHosts = $pinnedByTarget[$jumpRoute.toNodeId]
            $proxyCommandArguments = @($proxyExecutableArguments) + @(
                '-F', 'none', '-n',
                '-o', 'BatchMode=yes',
                '-o', 'IdentitiesOnly=yes',
                '-o', 'IdentityAgent=none',
                '-o', 'IdentityFile=~/.ssh/id_ed25519',
                '-o', "UserKnownHostsFile=$jumpKnownHosts",
                '-o', 'GlobalKnownHostsFile=none',
                '-o', 'KnownHostsCommand=none',
                '-o', 'StrictHostKeyChecking=yes',
                '-o', 'HostKeyAlgorithms=ssh-ed25519',
                '-o', 'CheckHostIP=yes',
                '-o', 'CanonicalizeHostname=no',
                '-o', 'UpdateHostKeys=no',
                '-o', 'PasswordAuthentication=no',
                '-o', 'KbdInteractiveAuthentication=no',
                '-o', 'PreferredAuthentications=publickey',
                '-o', 'ForwardAgent=no',
                '-o', 'PermitLocalCommand=no',
                '-o', 'ClearAllForwardings=yes',
                '-o', 'RequestTTY=no',
                '-o', 'ControlMaster=no',
                '-o', 'ControlPersist=no',
                '-o', 'ControlPath=none',
                '-o', 'VerifyHostKeyDNS=no',
                '-o', 'ConnectTimeout=5',
                '-o', 'ConnectionAttempts=1',
                '-o', 'ServerAliveInterval=3',
                '-o', 'ServerAliveCountMax=1',
                '-o', "Hostname=$($jump.host)",
                '-o', "User=$($jump.user)",
                '-o', "Port=$($jump.port)",
                '-o', "HostKeyAlias=$($jump.host)",
                '-W', '%h:%p', '--', $jumpRoute.sshAlias
            )
            $proxyCommand = @($proxyCommandArguments | ForEach-Object {
                ConvertTo-LabProxyCommandToken -Value ([string]$_)
            }) -join ' '
        }
        $targetKnownHosts = $pinnedByTarget[$Route.toNodeId]
        $arguments = @(
            '-F', 'none',
            '-n',
            '-o', "Hostname=$($Route.endpoint.host)",
            '-o', "User=$($Route.endpoint.user)",
            '-o', "Port=$($Route.endpoint.port)",
            '-o', "ProxyCommand=$proxyCommand",
            '-o', 'BatchMode=yes',
            '-o', 'IdentitiesOnly=yes',
            '-o', 'IdentityAgent=none',
            '-o', "IdentityFile=$identityFile",
            '-o', "UserKnownHostsFile=$targetKnownHosts",
            '-o', 'GlobalKnownHostsFile=none',
            '-o', 'KnownHostsCommand=none',
            '-o', 'StrictHostKeyChecking=yes',
            '-o', 'HostKeyAlgorithms=ssh-ed25519',
            '-o', 'CheckHostIP=yes',
            '-o', 'CanonicalizeHostname=no',
            '-o', 'UpdateHostKeys=no',
            '-o', 'PasswordAuthentication=no',
            '-o', 'KbdInteractiveAuthentication=no',
            '-o', 'PreferredAuthentications=publickey',
            '-o', 'ForwardAgent=no',
            '-o', 'PermitLocalCommand=no',
            '-o', 'ClearAllForwardings=yes',
            '-o', 'RequestTTY=no',
            '-o', 'ControlMaster=no',
            '-o', 'ControlPersist=no',
            '-o', 'ControlPath=none',
            '-o', 'VerifyHostKeyDNS=no',
            '-o', 'ConnectTimeout=5',
            '-o', 'ConnectionAttempts=1',
            '-o', 'ServerAliveInterval=3',
            '-o', 'ServerAliveCountMax=1',
            '--', $Target, $RemoteCommand
        )

        try {
            $execution = Invoke-LabBoundedProcess -Executable $ssh -Arguments $arguments -TimeoutMs $wallTimeoutMs
        } catch {
            return [pscustomobject]@{
                Target = $Target; Ok = $false; ExitCode = 255; FailureKind = 'SSH_UNREACHABLE'; Lines = @('SSH client process could not be started.')
            }
        }
        if ($execution.TimedOut) {
            return [pscustomobject]@{
                Target = $Target; Ok = $false; ExitCode = 124; FailureKind = 'SSH_COMMAND_TIMEOUT'; Lines = @('SSH command exceeded its wall-clock budget.')
            }
        }
        $exitCode = [int]$execution.ExitCode
        [pscustomobject]@{
            Target = $Target
            Ok = $exitCode -eq 0
            ExitCode = $exitCode
            FailureKind = if ($exitCode -eq 0) { $null } else { Get-LabFailureKind -Lines $execution.Lines -ExitCode $exitCode }
            Lines = $execution.Lines
        }
    } finally {
        foreach ($pinnedFile in $pinnedFiles) {
            Remove-Item -LiteralPath $pinnedFile -Force -ErrorAction SilentlyContinue
        }
    }
}

function ConvertFrom-LabKeyValueLines {
    param([string[]]$Lines)

    $result = [ordered]@{}
    foreach ($line in $Lines) {
        if ($line -cmatch '^([a-z][a-z0-9_]{0,63})=(.*)$') {
            $result[$Matches[1]] = $Matches[2].Trim()
        }
    }
    $result
}

function Get-LabRawValue {
    param([System.Collections.IDictionary]$Values, [string]$Key)

    if ($null -ne $Values -and $Values.Contains($Key) -and $null -ne $Values[$Key]) {
        return [string]$Values[$Key]
    }
    ''
}

function Get-LabJsonProperty {
    param([object]$Object, [string]$Name)

    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    $property.Value
}

function ConvertFrom-LabUtcTimestamp {
    param([object]$Value)

    if ($Value -is [datetime]) {
        if ($Value.Kind -ne [DateTimeKind]::Utc) { return $null }
        return $Value.ToUniversalTime()
    }
    $text = [string]$Value
    if ([string]::IsNullOrWhiteSpace($text) -or
        $text -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$') {
        return $null
    }
    $parsed = [datetime]::MinValue
    [string[]]$formats = @("yyyy-MM-dd'T'HH:mm:ss'Z'", "yyyy-MM-dd'T'HH:mm:ss.FFFFFFF'Z'")
    $styles = [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal
    if (-not [datetime]::TryParseExact($text, $formats, [Globalization.CultureInfo]::InvariantCulture, $styles, [ref]$parsed)) {
        return $null
    }
    $parsed.ToUniversalTime()
}

function Get-LabTopologyNowUtc {
    [datetime]::UtcNow
}

function New-LabCrossSyncEvidence {
    param(
        [Parameter(Mandatory)][string]$State,
        [Parameter(Mandatory)][string]$Detail,
        [AllowNull()][object]$CompletedAtUtc
    )

    [pscustomobject]@{
        State = $State
        Detail = $Detail
        CompletedAtUtc = $CompletedAtUtc
    }
}

function Test-LabExactJsonProperties {
    param([object]$Object, [string[]]$Names)

    if ($null -eq $Object -or $Object -is [array]) { return $false }
    $actualNames = @($Object.PSObject.Properties | ForEach-Object { $_.Name })
    if ($actualNames.Count -ne $Names.Count) { return $false }
    foreach ($name in $Names) {
        if ($name -cnotin $actualNames) { return $false }
    }
    $true
}

function Test-LabJsonElementHasUniqueProperties {
    param([Parameter(Mandatory)][System.Text.Json.JsonElement]$Element)

    if ($Element.ValueKind -eq [System.Text.Json.JsonValueKind]::Object) {
        $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        foreach ($property in $Element.EnumerateObject()) {
            if (-not $names.Add($property.Name)) { return $false }
            if (-not (Test-LabJsonElementHasUniqueProperties -Element $property.Value)) { return $false }
        }
    } elseif ($Element.ValueKind -eq [System.Text.Json.JsonValueKind]::Array) {
        foreach ($item in $Element.EnumerateArray()) {
            if (-not (Test-LabJsonElementHasUniqueProperties -Element $item)) { return $false }
        }
    }
    $true
}

function Get-LabTopologyPath {
    if (-not [string]::IsNullOrWhiteSpace($env:LAB_CONTROL_TOPOLOGY_PATH)) {
        return [IO.Path]::GetFullPath($env:LAB_CONTROL_TOPOLOGY_PATH)
    }

    $installed = Join-Path $PSScriptRoot 'lab-management-topology.v1.json'
    if (Test-Path -LiteralPath $installed -PathType Leaf) {
        return [IO.Path]::GetFullPath($installed)
    }

    [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\config\lab-control\lab-management-topology.v1.json'))
}

function Read-LabStrictJsonFile {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "TOPOLOGY_INVALID: file not found: $Path"
    }
    $bytes = [IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -eq 0 -or $bytes.Length -gt 65536) {
        throw 'TOPOLOGY_INVALID: document size must be between 1 and 65536 bytes.'
    }
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        throw 'TOPOLOGY_INVALID: UTF-8 BOM is not permitted.'
    }

    try {
        $utf8 = New-Object Text.UTF8Encoding($false, $true)
        $json = $utf8.GetString($bytes)
        $jsonDocument = [System.Text.Json.JsonDocument]::Parse($json)
        try {
            if (-not (Test-LabJsonElementHasUniqueProperties -Element $jsonDocument.RootElement)) {
                throw 'duplicate JSON property'
            }
        } finally {
            $jsonDocument.Dispose()
        }
        $document = ConvertFrom-Json -InputObject $json -DateKind String -ErrorAction Stop
    } catch {
        throw "TOPOLOGY_INVALID: malformed or ambiguous JSON ($($_.Exception.Message))."
    }
    if ($null -eq $document -or $document -is [array]) {
        throw 'TOPOLOGY_INVALID: root must be an object.'
    }
    if ($json -match '(?i)BEGIN (?:OPENSSH|RSA|EC|DSA) PRIVATE KEY|"(?:password|passphrase|token|secret|privateKey|credential)"\s*:') {
        throw 'TOPOLOGY_INVALID: secret material and secret-like fields are forbidden.'
    }
    [pscustomobject]@{ Document = $document; Json = $json }
}

function Test-LabSafeScalarString {
    param([AllowNull()][object]$Value)

    if ($Value -isnot [string]) { return $false }
    $text = $Value
    -not [string]::IsNullOrWhiteSpace($text) -and $text -notmatch '[\x00-\x1f\x7f%]'
}

function Test-LabStringProperties {
    param(
        [AllowNull()][object]$Object,
        [Parameter(Mandatory)][string[]]$Names
    )

    if ($null -eq $Object -or $Object -is [array]) { return $false }
    foreach ($name in $Names) {
        $property = $Object.PSObject.Properties[$name]
        if ($null -eq $property -or $property.Value -isnot [string]) { return $false }
    }
    $true
}

function Test-LabIpv4ForKind {
    param(
        [Parameter(Mandatory)][string]$Host,
        [Parameter(Mandatory)][string]$Kind
    )

    if ($Host -notmatch '^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$') { return $false }
    $address = $null
    if (-not [Net.IPAddress]::TryParse($Host, [ref]$address) -or $address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
        return $false
    }
    $octets = $address.GetAddressBytes()
    if ($Kind -eq 'tailscale') {
        return $octets[0] -eq 100 -and $octets[1] -ge 64 -and $octets[1] -le 127
    }
    if ($Kind -eq 'lan') {
        return $octets[0] -eq 10 -or
            ($octets[0] -eq 172 -and $octets[1] -ge 16 -and $octets[1] -le 31) -or
            ($octets[0] -eq 192 -and $octets[1] -eq 168)
    }
    $false
}

function Get-LabIdentityContract {
    param([Parameter(Mandatory)][string]$Reference)

    if ($Reference -cne 'williamos-node-identity-v1') {
        throw 'TOPOLOGY_INVALID: unsupported identityContractRef.'
    }
    $candidates = @(
        (Join-Path $PSScriptRoot 'node-identity-contract.json'),
        (Join-Path $PSScriptRoot '..\..\config\execution-fabric\node-identity-contract.json')
    )
    $path = @($candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1)
    if ($path.Count -ne 1) {
        throw 'TOPOLOGY_INVALID: referenced identity contract is unavailable.'
    }
    $strict = Read-LabStrictJsonFile -Path ([IO.Path]::GetFullPath($path[0]))
    if (-not (Test-LabStringProperties $strict.Document @('contract')) -or
        (Get-LabJsonProperty $strict.Document 'contract') -cne 'williamos-node-identity/1' -or
        (Get-LabJsonProperty $strict.Document 'nodes') -is [array] -or
        $null -eq (Get-LabJsonProperty $strict.Document 'nodes')) {
        throw 'TOPOLOGY_INVALID: referenced identity contract version mismatch.'
    }
    $strict.Document
}

function Get-LabTopology {
    param([string]$Path = (Get-LabTopologyPath))

    $strict = Read-LabStrictJsonFile -Path ([IO.Path]::GetFullPath($Path))
    $topology = $strict.Document
    $rootProperties = @('$schema', 'contract', 'identityContractRef', 'controlNodeId', 'nodes', 'managementRoutes')
    if (-not (Test-LabExactJsonProperties -Object $topology -Names $rootProperties) -or
        -not (Test-LabStringProperties -Object $topology -Names @('$schema', 'contract', 'identityContractRef', 'controlNodeId')) -or
        (Get-LabJsonProperty $topology '$schema') -cne './lab-management-topology.v1.schema.json' -or
        $topology.contract -cne 'williamos-lab-management-topology/1' -or
        $topology.controlNodeId -cne 'omen') {
        throw 'TOPOLOGY_INVALID: root contract is not the exact v1 management topology.'
    }

    $identityContract = Get-LabIdentityContract -Reference ([string]$topology.identityContractRef)
    $identityNodes = Get-LabJsonProperty $identityContract 'nodes'
    $expectedNodes = @(
        [pscustomobject]@{ Id = 'omen'; DisplayName = 'OMEN'; Role = 'operator-cockpit'; Probe = 'windows-local' },
        [pscustomobject]@{ Id = 'hermes-node'; DisplayName = 'HERMES'; Role = 'resident-ai-coordinator'; Probe = 'hermes-windows' },
        [pscustomobject]@{ Id = 'atlas'; DisplayName = 'ATLAS'; Role = 'durable-state'; Probe = 'atlas-linux' },
        [pscustomobject]@{ Id = 'aegis'; DisplayName = 'AEGIS'; Role = 'governed-cpu-worker'; Probe = 'linux-generic' },
        [pscustomobject]@{ Id = 'daedalus'; DisplayName = 'DAEDALUS'; Role = 'resident-gpu-worker'; Probe = 'linux-generic' }
    )
    if ($topology.nodes -isnot [array]) {
        throw 'TOPOLOGY_INVALID: nodes must be a JSON array.'
    }
    $nodes = @($topology.nodes)
    if ($nodes.Count -ne $expectedNodes.Count) {
        throw 'TOPOLOGY_INVALID: exact five-node physical roster is required.'
    }
    for ($index = 0; $index -lt $expectedNodes.Count; $index++) {
        $node = $nodes[$index]
        $expected = $expectedNodes[$index]
        if (-not (Test-LabExactJsonProperties $node @('id', 'displayName', 'kind', 'role', 'probeProfile', 'required')) -or
            -not (Test-LabStringProperties $node @('id', 'displayName', 'kind', 'role', 'probeProfile')) -or
            $node.id -cne $expected.Id -or
            $node.displayName -cne $expected.DisplayName -or
            $node.kind -cne 'physical-lab-node' -or
            $node.role -cne $expected.Role -or
            $node.probeProfile -cne $expected.Probe -or
            $node.required -isnot [bool] -or
            -not $node.required -or
            $null -eq $identityNodes.PSObject.Properties[$node.id]) {
            throw "TOPOLOGY_INVALID: invalid node definition at index $index."
        }
    }

    $expectedRoutes = @(
        [pscustomobject]@{
            Id = 'hermes-node'; Kind = 'direct'; Alias = 'hermes'; Host = '100.97.194.84'; Port = 22; User = 'bs'
            AddressKind = 'tailscale'; Via = @(); Identity = 'OMEN_DEFAULT_ED25519'; KnownHosts = 'OMEN_USER_KNOWN_HOSTS'
            Fingerprint = 'SHA256:Iz+tH9Nr8AqGCRWzf2CDFGfii0V72zfvuiSijDBIhF0'
        },
        [pscustomobject]@{
            Id = 'atlas'; Kind = 'proxy-jump'; Alias = 'atlas'; Host = '192.168.88.8'; Port = 22; User = 'bs'
            AddressKind = 'lan'; Via = @('hermes-node'); Identity = 'OMEN_DEFAULT_ED25519'; KnownHosts = 'OMEN_USER_KNOWN_HOSTS'
            Fingerprint = 'SHA256:0QsMN3STmqBsozY2oea4GU32dDIyCKV0jCbWI8n4fYw'
        },
        [pscustomobject]@{
            Id = 'aegis'; Kind = 'resident-relay'; Alias = 'aegis'; Host = '192.168.88.7'; Port = 22; User = 'bs'
            AddressKind = 'lan'; Via = @('hermes-node'); Identity = 'HERMES_MANAGED'; KnownHosts = 'HERMES_MANAGED'
            Fingerprint = 'SHA256:N+YNbMg3nUb0tX7ZYLJfJSt9f0dUOukBUNLyYb1WByo'
        },
        [pscustomobject]@{
            Id = 'daedalus'; Kind = 'resident-relay'; Alias = 'daedalus'; Host = '192.168.88.6'; Port = 2222; User = 'daedalus'
            AddressKind = 'lan'; Via = @('hermes-node'); Identity = 'HERMES_MANAGED'; KnownHosts = 'HERMES_MANAGED'
            Fingerprint = 'SHA256:njnjHfmzEA8Azl5xOcNICR4V3OU7+DvUO4JLHW4AAf4'
        }
    )
    $expectedRemoteIds = @($expectedRoutes.Id)
    if ($topology.managementRoutes -isnot [array]) {
        throw 'TOPOLOGY_INVALID: managementRoutes must be a JSON array.'
    }
    $routes = @($topology.managementRoutes)
    if ($routes.Count -ne $expectedRemoteIds.Count) {
        throw 'TOPOLOGY_INVALID: exactly four OMEN-origin management routes are required.'
    }
    $aliases = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $endpointHosts = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $fingerprints = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $routeByTarget = @{}
    $nowUtc = Get-LabTopologyNowUtc
    for ($index = 0; $index -lt $routes.Count; $index++) {
        $route = $routes[$index]
        $expectedRoute = $expectedRoutes[$index]
        if (-not (Test-LabExactJsonProperties $route @('fromNodeId', 'toNodeId', 'routeKind', 'sshAlias', 'endpoint', 'viaNodeIds', 'identityRef', 'knownHostsRef', 'hostKeyFingerprint', 'evidence')) -or
            -not (Test-LabStringProperties $route @('fromNodeId', 'toNodeId', 'routeKind', 'sshAlias', 'identityRef', 'knownHostsRef', 'hostKeyFingerprint')) -or
            $route.fromNodeId -cne 'omen' -or
            $route.toNodeId -cne $expectedRemoteIds[$index] -or
            $route.sshAlias -cnotmatch '^[a-z][a-z0-9-]{0,31}$' -or
            -not $aliases.Add([string]$route.sshAlias)) {
            throw "TOPOLOGY_INVALID: invalid or duplicate route at index $index."
        }
        $endpoint = $route.endpoint
        if (-not (Test-LabExactJsonProperties $endpoint @('host', 'port', 'user', 'addressKind')) -or
            -not (Test-LabStringProperties $endpoint @('host', 'user', 'addressKind')) -or
            -not (Test-LabSafeScalarString $endpoint.host) -or
            -not (Test-LabSafeScalarString $endpoint.user) -or
            $endpoint.user -cnotmatch '^[A-Za-z0-9._-]+$' -or
            ($endpoint.port -isnot [int] -and $endpoint.port -isnot [long]) -or
            $endpoint.port -lt 1 -or $endpoint.port -gt 65535 -or
            $endpoint.addressKind -cnotin @('lan', 'tailscale') -or
            -not (Test-LabIpv4ForKind -Host ([string]$endpoint.host) -Kind ([string]$endpoint.addressKind))) {
            throw "TOPOLOGY_INVALID: invalid SSH endpoint for $($route.toNodeId)."
        }
        if (-not $endpointHosts.Add([string]$endpoint.host) -or
            $route.identityRef -cnotin @('OMEN_DEFAULT_ED25519', 'HERMES_MANAGED') -or
            $route.knownHostsRef -cnotin @('OMEN_USER_KNOWN_HOSTS', 'HERMES_MANAGED') -or
            $route.hostKeyFingerprint -cnotmatch '^SHA256:[A-Za-z0-9+/]{43}$' -or
            -not $fingerprints.Add([string]$route.hostKeyFingerprint)) {
            throw "TOPOLOGY_INVALID: invalid trust profile for $($route.toNodeId)."
        }
        if ($route.viaNodeIds -isnot [array]) {
            throw "TOPOLOGY_INVALID: viaNodeIds must be a JSON array for $($route.toNodeId)."
        }
        $hops = @($route.viaNodeIds)
        if (@($hops | Where-Object { $_ -isnot [string] }).Count -gt 0 -or
            $hops.Count -gt 3 -or @($hops | Select-Object -Unique).Count -ne $hops.Count -or
            $route.toNodeId -cin $hops -or @($hops | Where-Object { $_ -cnotin @($expectedNodes.Id) }).Count -gt 0) {
            throw "TOPOLOGY_INVALID: invalid management route hops for $($route.toNodeId)."
        }
        $expectedHops = @($expectedRoute.Via)
        if ($route.routeKind -cne $expectedRoute.Kind -or
            $route.sshAlias -cne $expectedRoute.Alias -or
            $endpoint.host -cne $expectedRoute.Host -or
            [long]$endpoint.port -ne [long]$expectedRoute.Port -or
            $endpoint.user -cne $expectedRoute.User -or
            $endpoint.addressKind -cne $expectedRoute.AddressKind -or
            $route.identityRef -cne $expectedRoute.Identity -or
            $route.knownHostsRef -cne $expectedRoute.KnownHosts -or
            $route.hostKeyFingerprint -cne $expectedRoute.Fingerprint -or
            $hops.Count -ne $expectedHops.Count -or
            ($hops.Count -gt 0 -and $hops[0] -cne $expectedHops[0])) {
            throw "TOPOLOGY_INVALID: route $($route.toNodeId) does not match the canonical v1 binding."
        }
        if (($route.routeKind -ceq 'direct' -and $hops.Count -ne 0) -or
            ($route.routeKind -cin @('proxy-jump', 'resident-relay') -and ($hops.Count -ne 1 -or $hops[0] -cne 'hermes-node')) -or
            $route.routeKind -cnotin @('direct', 'proxy-jump', 'resident-relay')) {
            throw "TOPOLOGY_INVALID: route kind and hop chain disagree for $($route.toNodeId)."
        }
        if (($route.routeKind -ceq 'resident-relay') -xor ($route.identityRef -ceq 'HERMES_MANAGED')) {
            throw "TOPOLOGY_INVALID: credential ownership disagrees with route kind for $($route.toNodeId)."
        }
        if (($route.routeKind -ceq 'resident-relay') -xor ($route.knownHostsRef -ceq 'HERMES_MANAGED')) {
            throw "TOPOLOGY_INVALID: host trust ownership disagrees with route kind for $($route.toNodeId)."
        }
        $evidence = $route.evidence
        if (-not (Test-LabExactJsonProperties $evidence @('state', 'observedAt', 'expiresAt')) -or
            -not (Test-LabStringProperties $evidence @('state', 'observedAt', 'expiresAt')) -or
            $evidence.state -cne 'VERIFIED') {
            throw "TOPOLOGY_INVALID: route evidence must be VERIFIED for $($route.toNodeId)."
        }
        $observed = ConvertFrom-LabUtcTimestamp $evidence.observedAt
        $expires = ConvertFrom-LabUtcTimestamp $evidence.expiresAt
        if ($null -eq $observed -or $null -eq $expires -or
            $expires -le $observed -or
            $observed -gt $nowUtc.AddMinutes(5) -or
            $expires -le $nowUtc -or
            ($expires - $observed) -gt [TimeSpan]::FromDays(7)) {
            throw "TOPOLOGY_INVALID: stale, future, or incoherent route evidence for $($route.toNodeId)."
        }
        $routeByTarget[$route.toNodeId] = $route
    }
    foreach ($route in $routes) {
        foreach ($hop in @($route.viaNodeIds)) {
            if ($hop -cne 'omen' -and -not $routeByTarget.ContainsKey($hop)) {
                throw "TOPOLOGY_INVALID: route hop $hop has no OMEN-origin route."
            }
        }
    }
    $topology
}

function Get-LabSshConfigCandidate {
    $topology = Get-LabTopology
    $routes = @($topology.managementRoutes)
    $nodesById = @{}
    foreach ($node in @($topology.nodes)) { $nodesById[$node.id] = $node }
    $routesByTarget = @{}
    foreach ($route in $routes) { $routesByTarget[$route.toNodeId] = $route }

    $lines = [Collections.Generic.List[string]]::new()
    $lines.Add('# WilliamOS lab SSH candidate')
    $lines.Add('# Candidate only: this output does not alter SSH configuration or establish host trust.')
    $lines.Add('# Recorded fingerprints are evidence only; they cannot create known_hosts entries.')
    foreach ($route in $routes) {
        if ($route.routeKind -ceq 'resident-relay') {
            $via = $nodesById[@($route.viaNodeIds)[0]].displayName
            $target = $nodesById[$route.toNodeId].displayName
            $suffix = if ($route.endpoint.port -ne 22) { ", endpoint $($route.endpoint.host):$($route.endpoint.port)" } else { '' }
            $lines.Add('')
            $lines.Add("# RELAY $($route.sshAlias): OMEN -> $via -> $target (HERMES alias $($route.sshAlias)$suffix)")
            $lines.Add("# fingerprint $($route.hostKeyFingerprint); credential and trust remain resident on HERMES")
            continue
        }

        $identityFile = switch ($route.identityRef) {
            'OMEN_DEFAULT_ED25519' { '~/.ssh/id_ed25519' }
            default { throw "TOPOLOGY_INVALID: renderer has no identity mapping for $($route.identityRef)." }
        }
        $knownHostsFile = switch ($route.knownHostsRef) {
            'OMEN_USER_KNOWN_HOSTS' { '~/.ssh/known_hosts' }
            default { throw "TOPOLOGY_INVALID: renderer has no known-hosts mapping for $($route.knownHostsRef)." }
        }
        $lines.Add('')
        $lines.Add("Host $($route.sshAlias)")
        $lines.Add("  HostName $($route.endpoint.host)")
        $lines.Add("  User $($route.endpoint.user)")
        $lines.Add("  Port $($route.endpoint.port)")
        $lines.Add("  IdentityFile $identityFile")
        $lines.Add('  IdentitiesOnly yes')
        $lines.Add('  IdentityAgent none')
        $lines.Add("  UserKnownHostsFile $knownHostsFile")
        $lines.Add('  KnownHostsCommand none')
        $lines.Add('  StrictHostKeyChecking yes')
        $lines.Add('  HostKeyAlgorithms ssh-ed25519')
        $lines.Add('  VerifyHostKeyDNS no')
        $lines.Add('  UpdateHostKeys no')
        $lines.Add('  BatchMode yes')
        $lines.Add('  PasswordAuthentication no')
        $lines.Add('  KbdInteractiveAuthentication no')
        $lines.Add('  PreferredAuthentications publickey')
        $lines.Add('  ForwardAgent no')
        $lines.Add('  PermitLocalCommand no')
        $lines.Add('  ClearAllForwardings yes')
        $lines.Add('  RequestTTY no')
        $lines.Add('  ControlMaster no')
        $lines.Add('  ControlPersist no')
        $lines.Add('  ControlPath none')
        $lines.Add('  ConnectTimeout 5')
        $lines.Add('  ConnectionAttempts 1')
        $lines.Add('  ServerAliveInterval 3')
        $lines.Add('  ServerAliveCountMax 1')
        if ($route.routeKind -ceq 'proxy-jump') {
            $jumpAliases = @($route.viaNodeIds | ForEach-Object { $routesByTarget[$_].sshAlias })
            $lines.Add("  ProxyJump $($jumpAliases -join ',')")
        }
        $lines.Add("  # ExpectedHostKeyFingerprint $($route.hostKeyFingerprint)")
    }
    ($lines -join "`n") + "`n"
}

function ConvertFrom-LabJsonTransport {
    param(
        [Parameter(Mandatory)][string]$Base64,
        [Parameter(Mandatory)][string]$ExpectedHash
    )

    if ($ExpectedHash -cnotmatch '^[0-9a-f]{64}$') {
        return [pscustomobject]@{ Ok = $false; Detail = 'invalid_hash'; Document = $null }
    }
    try {
        $bytes = [Convert]::FromBase64String($Base64)
    } catch {
        return [pscustomobject]@{ Ok = $false; Detail = 'invalid_base64'; Document = $null }
    }
    if ($bytes.Length -eq 0 -or $bytes.Length -gt 65536) {
        return [pscustomobject]@{ Ok = $false; Detail = 'invalid_size'; Document = $null }
    }

    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        $computedHash = [BitConverter]::ToString($sha256.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha256.Dispose()
    }
    if ($computedHash -cne $ExpectedHash) {
        return [pscustomobject]@{ Ok = $false; Detail = 'content_hash_mismatch'; Document = $null }
    }

    try {
        $utf8 = New-Object Text.UTF8Encoding($false, $true)
        $json = $utf8.GetString($bytes)
        $jsonDocument = [System.Text.Json.JsonDocument]::Parse($json)
        try {
            if (-not (Test-LabJsonElementHasUniqueProperties -Element $jsonDocument.RootElement)) {
                return [pscustomobject]@{ Ok = $false; Detail = 'duplicate_property'; Document = $null }
            }
        } finally {
            $jsonDocument.Dispose()
        }
        $document = ConvertFrom-Json -InputObject $json -DateKind String -ErrorAction Stop
    } catch {
        return [pscustomobject]@{ Ok = $false; Detail = 'invalid_json'; Document = $null }
    }
    if ($null -eq $document -or $document -is [array]) {
        return [pscustomobject]@{ Ok = $false; Detail = 'invalid_schema'; Document = $null }
    }
    [pscustomobject]@{ Ok = $true; Detail = 'valid'; Document = $document }
}

function Get-LabCrossSyncEvidence {
    param(
        [Parameter(Mandatory)][System.Collections.IDictionary]$HermesValues,
        [Parameter(Mandatory)][System.Collections.IDictionary]$AtlasValues,
        [Parameter(Mandatory)][datetime]$NowUtc
    )

    $NowUtc = $NowUtc.ToUniversalTime()
    $taskState = (Get-LabRawValue $HermesValues 'cross_sync_task_state').Trim()
    $taskResultText = (Get-LabRawValue $HermesValues 'cross_sync_task_result').Trim()
    $taskLastText = (Get-LabRawValue $HermesValues 'cross_sync_task_last_utc').Trim()
    $taskEvidenceB64 = (Get-LabRawValue $HermesValues 'cross_sync_task_evidence_b64').Trim()
    $taskEvidenceHash = (Get-LabRawValue $HermesValues 'cross_sync_task_evidence_sha256').Trim()
    $receiptB64 = (Get-LabRawValue $AtlasValues 'cross_sync_receipt_b64').Trim()
    $atlasHash = (Get-LabRawValue $AtlasValues 'cross_sync_receipt_sha256').Trim()

    $taskResult = [long]0
    if (-not [string]::IsNullOrWhiteSpace($taskResultText)) {
        if ($taskResultText -notmatch '^-?\d+$' -or -not [long]::TryParse($taskResultText, [ref]$taskResult)) {
            return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=invalid_task_result' -CompletedAtUtc $null
        }
        if ($taskResult -ne 0) {
            return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail "task_result=$taskResult" -CompletedAtUtc $null
        }
    }

    if ([string]::IsNullOrWhiteSpace($receiptB64) -and [string]::IsNullOrWhiteSpace($atlasHash)) {
        return New-LabCrossSyncEvidence -State 'SYNC_UNKNOWN' -Detail 'receipt=missing' -CompletedAtUtc $null
    }

    if ([string]::IsNullOrWhiteSpace($taskState) -or
        [string]::IsNullOrWhiteSpace($taskResultText) -or
        [string]::IsNullOrWhiteSpace($taskLastText) -or
        [string]::IsNullOrWhiteSpace($taskEvidenceB64) -or
        [string]::IsNullOrWhiteSpace($taskEvidenceHash) -or
        [string]::IsNullOrWhiteSpace($receiptB64) -or
        [string]::IsNullOrWhiteSpace($atlasHash)) {
        return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=incomplete_transport' -CompletedAtUtc $null
    }
    if ($taskState -cne 'Ready') {
        return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=task_not_ready' -CompletedAtUtc $null
    }

    $receiptTransport = ConvertFrom-LabJsonTransport -Base64 $receiptB64 -ExpectedHash $atlasHash
    if (-not $receiptTransport.Ok) {
        return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail "validation=receipt_$($receiptTransport.Detail)" -CompletedAtUtc $null
    }
    $taskEvidenceTransport = ConvertFrom-LabJsonTransport -Base64 $taskEvidenceB64 -ExpectedHash $taskEvidenceHash
    if (-not $taskEvidenceTransport.Ok) {
        return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail "validation=task_evidence_$($taskEvidenceTransport.Detail)" -CompletedAtUtc $null
    }
    $receipt = $receiptTransport.Document
    $taskEvidence = $taskEvidenceTransport.Document

    $receiptProperties = @('schema_version', 'task_name', 'run_id', 'started_at', 'completed_at', 'result', 'verification', 'directions')
    $taskEvidenceProperties = @('schema_version', 'task_name', 'run_id', 'started_at', 'receipt_completed_at', 'completed_at', 'state', 'result', 'verification', 'atlas_receipt_sha256')
    if (-not (Test-LabExactJsonProperties $receipt $receiptProperties) -or
        -not (Test-LabExactJsonProperties $taskEvidence $taskEvidenceProperties)) {
        return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=invalid_schema' -CompletedAtUtc $null
    }

    $schemaVersion = Get-LabJsonProperty $receipt 'schema_version'
    $taskName = Get-LabJsonProperty $receipt 'task_name'
    $runId = [string](Get-LabJsonProperty $receipt 'run_id')
    $result = Get-LabJsonProperty $receipt 'result'
    $verification = Get-LabJsonProperty $receipt 'verification'
    if (($schemaVersion -isnot [int] -and $schemaVersion -isnot [long]) -or
        $schemaVersion -ne 1 -or
        $taskName -cne 'HermesCrossNodeBackupSync' -or
        $runId -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' -or
        $result -cne 'SUCCESS' -or
        $verification -cne 'SHA256_PASS') {
        return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=invalid_receipt_schema' -CompletedAtUtc $null
    }

    $evidenceSchemaVersion = Get-LabJsonProperty $taskEvidence 'schema_version'
    $evidenceTaskName = Get-LabJsonProperty $taskEvidence 'task_name'
    $evidenceRunId = [string](Get-LabJsonProperty $taskEvidence 'run_id')
    if (($evidenceSchemaVersion -isnot [int] -and $evidenceSchemaVersion -isnot [long]) -or
        $evidenceSchemaVersion -ne 1 -or
        $evidenceTaskName -cne 'HermesCrossNodeBackupSync' -or
        $evidenceRunId -cne $runId -or
        (Get-LabJsonProperty $taskEvidence 'state') -cne 'COMPLETED' -or
        (Get-LabJsonProperty $taskEvidence 'result') -cne 'SUCCESS' -or
        (Get-LabJsonProperty $taskEvidence 'verification') -cne 'SHA256_PASS' -or
        (Get-LabJsonProperty $taskEvidence 'atlas_receipt_sha256') -cne $atlasHash) {
        return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=invalid_task_evidence' -CompletedAtUtc $null
    }

    $directions = @(Get-LabJsonProperty $receipt 'directions')
    if ($directions.Count -ne 2) {
        return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=invalid_directions' -CompletedAtUtc $null
    }
    $expectedDirections = @(
        @{ Name = 'ATLAS_TO_HERMES'; Source = 'atlas'; Destination = 'hermes' },
        @{ Name = 'HERMES_TO_ATLAS'; Source = 'hermes'; Destination = 'atlas' }
    )
    $directionProperties = @('run_id', 'direction', 'source', 'destination', 'file_count', 'manifest_sha256', 'verification')
    for ($index = 0; $index -lt $directions.Count; $index++) {
        $direction = $directions[$index]
        $expectedDirection = $expectedDirections[$index]
        if (-not (Test-LabExactJsonProperties $direction $directionProperties)) {
            return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=invalid_directions' -CompletedAtUtc $null
        }
        $name = Get-LabJsonProperty $direction 'direction'
        $source = Get-LabJsonProperty $direction 'source'
        $destination = Get-LabJsonProperty $direction 'destination'
        $fileCount = Get-LabJsonProperty $direction 'file_count'
        $manifestHash = Get-LabJsonProperty $direction 'manifest_sha256'
        if ((Get-LabJsonProperty $direction 'run_id') -cne $runId -or
            $name -cne $expectedDirection.Name -or
            $source -cne $expectedDirection.Source -or
            $destination -cne $expectedDirection.Destination -or
            ($fileCount -isnot [int] -and $fileCount -isnot [long]) -or
            $fileCount -le 0 -or
            $manifestHash -cnotmatch '^[0-9a-f]{64}$' -or
            (Get-LabJsonProperty $direction 'verification') -cne 'SHA256_PASS') {
            return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=invalid_directions' -CompletedAtUtc $null
        }
    }

    $taskLastUtc = ConvertFrom-LabUtcTimestamp $taskLastText
    $receiptStartedText = [string](Get-LabJsonProperty $receipt 'started_at')
    $receiptCompletedText = [string](Get-LabJsonProperty $receipt 'completed_at')
    $evidenceStartedText = [string](Get-LabJsonProperty $taskEvidence 'started_at')
    $evidenceReceiptCompletedText = [string](Get-LabJsonProperty $taskEvidence 'receipt_completed_at')
    $evidenceCompletedText = [string](Get-LabJsonProperty $taskEvidence 'completed_at')
    if ($receiptStartedText -cne $evidenceStartedText -or $receiptCompletedText -cne $evidenceReceiptCompletedText) {
        return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=timestamp_binding_mismatch' -CompletedAtUtc $null
    }
    $startedUtc = ConvertFrom-LabUtcTimestamp $receiptStartedText
    $receiptCompletedUtc = ConvertFrom-LabUtcTimestamp $receiptCompletedText
    $evidenceCompletedUtc = ConvertFrom-LabUtcTimestamp $evidenceCompletedText
    if ($null -eq $taskLastUtc -or $null -eq $startedUtc -or $null -eq $receiptCompletedUtc -or $null -eq $evidenceCompletedUtc) {
        return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=malformed_receipt_timestamp' -CompletedAtUtc $null
    }
    if ($receiptCompletedUtc -le $startedUtc -or $evidenceCompletedUtc -le $receiptCompletedUtc) {
        return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=completion_before_start' -CompletedAtUtc $null
    }
    $taskObservationGrace = [TimeSpan]::FromMinutes(5)
    if ($taskLastUtc -lt $startedUtc.Subtract($taskObservationGrace) -or
        $taskLastUtc -gt $evidenceCompletedUtc.Add($taskObservationGrace)) {
        return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=task_start_mismatch' -CompletedAtUtc $null
    }
    if ($taskLastUtc -gt $NowUtc.AddMinutes(5) -or
        $startedUtc -gt $NowUtc.AddMinutes(5) -or
        $receiptCompletedUtc -gt $NowUtc.AddMinutes(5) -or
        $evidenceCompletedUtc -gt $NowUtc.AddMinutes(5)) {
        return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=future_completion' -CompletedAtUtc $null
    }

    $detail = "completed=$($evidenceCompletedUtc.ToString('o'))"
    if (($NowUtc - $evidenceCompletedUtc).TotalHours -gt 30) {
        return New-LabCrossSyncEvidence -State 'SYNC_STALE' -Detail $detail -CompletedAtUtc $evidenceCompletedUtc
    }
    New-LabCrossSyncEvidence -State 'SYNC_OK' -Detail $detail -CompletedAtUtc $evidenceCompletedUtc
}

function Get-LabNowUtc {
    [datetime]::UtcNow
}

function Get-HermesProbeCommand {
    $probe = @'
$ErrorActionPreference='SilentlyContinue'
function Out-Kv($k,$v){ if([string]::IsNullOrWhiteSpace([string]$v)){$v='UNKNOWN'}; Write-Output ($k+'='+([string]$v).Trim()) }
function Out-RawKv($k,$v){ Write-Output ($k+'='+[string]$v) }
Out-Kv 'hostname' ([Environment]::MachineName)
Out-Kv 'username' ([Environment]::UserName)
$os=Get-CimInstance Win32_OperatingSystem
Out-Kv 'os' $os.Caption
Out-Kv 'uptime' ((Get-Date)-$os.LastBootUpTime).ToString('d\d\ h\h\ m\m')
$docker=if(Get-Command docker -ErrorAction SilentlyContinue){docker info --format '{{.ServerVersion}}' 2>$null}else{$null}
Out-Kv 'docker' $docker
$ollama=try {
  $response=Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/version' -TimeoutSec 3
  if($response.version){'AVAILABLE '+$response.version}else{'AVAILABLE'}
} catch {
  $container=if(Get-Command docker -ErrorAction SilentlyContinue){docker ps --filter 'name=ollama' --format '{{.Names}}' 2>$null | Select-Object -First 1}else{$null}
  if($container){'UNAVAILABLE_CONTAINER_RUNNING'}else{'NOT_OBSERVED'}
}
Out-Kv 'ollama' $ollama
$gpu=if(Get-Command nvidia-smi -ErrorAction SilentlyContinue){nvidia-smi --query-gpu=name --format=csv,noheader 2>$null | Select-Object -First 1}else{$null}
Out-Kv 'gpu' $gpu
$d=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
if($d){Out-Kv 'disk' ('{0:N0} GB free of {1:N0} GB' -f ($d.FreeSpace/1GB),($d.Size/1GB))}else{Out-Kv 'disk' $null}
$taskState=''
$taskResult=''
$taskLastUtc=''
try {
  $taskState=[string](Get-ScheduledTask -TaskName 'HermesCrossNodeBackupSync' -ErrorAction Stop).State
  $info=Get-ScheduledTaskInfo -TaskName 'HermesCrossNodeBackupSync' -ErrorAction Stop
  $taskResult=[string][long]$info.LastTaskResult
  $taskLastUtc=$info.LastRunTime.ToUniversalTime().ToString('o')
} catch {}
$eb=$null
$ep='D:\CrossNodeBackups\crossnode-sync-task-evidence.json'
try {
  $fs=[System.IO.File]::Open($ep,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete))
  try {
    if($fs.Length -gt 0 -and $fs.Length -le 65536){
      $b=New-Object byte[] ([int]$fs.Length)
      $o=0
      while($o -lt $b.Length){
        $n=$fs.Read($b,$o,$b.Length-$o)
        if($n -le 0){break}
        $o+=$n
      }
      if($o -eq $b.Length){$eb=$b}
    }
  } finally {$fs.Dispose()}
} catch {}
$e64=''
$eh=''
if($null -ne $eb){
  $e64=[Convert]::ToBase64String($eb)
  $sha=[Security.Cryptography.SHA256]::Create()
  try {$eh=[BitConverter]::ToString($sha.ComputeHash($eb)).Replace('-','').ToLowerInvariant()} finally {$sha.Dispose()}
}
Out-RawKv 'cross_sync_task_state' $taskState
Out-RawKv 'cross_sync_task_result' $taskResult
Out-RawKv 'cross_sync_task_last_utc' $taskLastUtc
Out-RawKv 'cross_sync_task_evidence_b64' $e64
Out-RawKv 'cross_sync_task_evidence_sha256' $eh
'@
    $encoded = ConvertTo-LabEncodedPowerShellCommand -Command $probe
    "powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand $encoded"
}

function Get-AtlasProbeCommand {
    $probe = @'
kv(){ v="$2"; [ -n "$v" ] || v=UNKNOWN; printf '%s=%s\n' "$1" "$v"; }
kv_raw(){ printf '%s=%s\n' "$1" "$2"; }
kv hostname "$(hostname 2>/dev/null)"
kv username "$(id -un 2>/dev/null)"
kv os "$(. /etc/os-release 2>/dev/null; printf '%s' "$PRETTY_NAME")"
kv uptime "$(uptime -p 2>/dev/null)"
kv docker "$(docker info --format '{{.ServerVersion}}' 2>/dev/null)"
tcp_listener(){ ss -ltnH 2>/dev/null | awk -v p=":$1" '$4 ~ p"$" {found=1} END {exit !found}'; }
container_for_port(){
  docker ps --format '{{.Names}}|{{.Ports}}' 2>/dev/null |
    awk -F'|' -v p=":$1->" 'index($2,p){print $1; exit}'
}
postgres_probe(){
  if command -v pg_isready >/dev/null 2>&1; then
    pg_isready -q -h 127.0.0.1 -p 5432 && { printf PG_ISREADY_ACCEPTING; return; }
    printf PG_ISREADY_REJECTING; return
  fi
  container="$(container_for_port 5432)"
  if [ -n "$container" ]; then
    docker exec "$container" pg_isready -q 2>/dev/null && { printf CONTAINER_PG_ISREADY_ACCEPTING; return; }
  fi
  tcp_listener 5432 && printf TCP_LISTENER_ONLY || printf NOT_OBSERVED
}
redis_probe(){
  if command -v redis-cli >/dev/null 2>&1; then
    reply="$(redis-cli -h 127.0.0.1 -p 6379 --no-auth-warning ping 2>&1)"
    [ "$reply" = PONG ] && { printf REDIS_PING_PONG; return; }
    printf '%s' "$reply" | grep -Eiq 'NOAUTH|WRONGPASS|authentication required' && { printf REDIS_AUTH_REQUIRED_REACHABLE; return; }
    printf REDIS_CLI_NO_RESPONSE; return
  fi
  container="$(container_for_port 6379)"
  if [ -n "$container" ]; then
    reply="$(docker exec "$container" redis-cli --no-auth-warning ping 2>&1)"
    [ "$reply" = PONG ] && { printf CONTAINER_REDIS_PING_PONG; return; }
    printf '%s' "$reply" | grep -Eiq 'NOAUTH|WRONGPASS|authentication required' && { printf CONTAINER_REDIS_AUTH_REQUIRED_REACHABLE; return; }
  fi
  tcp_listener 6379 && printf TCP_LISTENER_ONLY || printf NOT_OBSERVED
}
mongo_probe(){
  if command -v mongosh >/dev/null 2>&1; then
    reply="$(mongosh --quiet --host 127.0.0.1 --port 27017 --eval 'db.adminCommand({ping:1}).ok' 2>/dev/null | tail -n 1)"
    [ "$reply" = 1 ] && { printf MONGO_PING_OK; return; }
    printf MONGO_PING_FAILED; return
  fi
  container="$(container_for_port 27017)"
  if [ -n "$container" ]; then
    reply="$(docker exec "$container" mongosh --quiet --eval 'db.adminCommand({ping:1}).ok' 2>/dev/null | tail -n 1)"
    [ "$reply" = 1 ] && { printf CONTAINER_MONGO_PING_OK; return; }
  fi
  tcp_listener 27017 && printf TCP_LISTENER_ONLY || printf NOT_OBSERVED
}
container_port_evidence(){
  port="$1"
  row="$(container_for_port "$port")"
  [ -n "$row" ] || { printf NO_EXPLICIT_DOCKER_PORT_MAPPING; return; }
  docker inspect --format 'name={{.Name}} state={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}not-configured{{end}}' "$row" 2>/dev/null | sed 's#name=/#name=#'
}
kv postgres_evidence "$(postgres_probe)"
kv postgres_container_evidence "$(container_port_evidence 5432)"
kv redis_evidence "$(redis_probe)"
kv redis_container_evidence "$(container_port_evidence 6379)"
kv mongo_evidence "$(mongo_probe)"
kv mongo_container_evidence "$(container_port_evidence 27017)"
kv disk "$(df -hP / 2>/dev/null | awk 'NR==2 {print $4 " free of " $2}')"
latest_line="$({
  for d in /home/bs/backups /srv/backups /opt/backups /mnt/backups /backups; do
    [ -d "$d" ] || continue
    find "$d" -maxdepth 2 -type f -printf '%T@|%p\n' 2>/dev/null
  done
} | sort -nr | head -n 1)"
latest=''
if [ -n "$latest_line" ]; then
  latest_epoch="${latest_line%%|*}"
  latest_path="${latest_line#*|}"
  latest_time="$(date -d "@${latest_epoch%.*}" --iso-8601=seconds 2>/dev/null)"
  [ -n "$latest_time" ] || latest_time="$latest_epoch"
  latest="$latest_time|$latest_path"
fi
kv backup "$latest"
receipt='/home/bs/from-hermes/crossnode-sync-receipt.json'
receipt_size="$(stat -c %s "$receipt" 2>/dev/null)"
receipt_b64=''
receipt_hash=''
if [ -n "$receipt_size" ] && [ "$receipt_size" -gt 0 ] && [ "$receipt_size" -le 65536 ]; then
  receipt_b64="$(head -c 65536 -- "$receipt" 2>/dev/null | base64 -w 0)"
  receipt_hash="$(head -c 65536 -- "$receipt" 2>/dev/null | sha256sum | awk '{print $1}')"
  receipt_size_after="$(stat -c %s "$receipt" 2>/dev/null)"
  if [ "$receipt_size_after" != "$receipt_size" ]; then receipt_b64=''; receipt_hash=''; fi
fi
kv_raw cross_sync_receipt_b64 "$receipt_b64"
kv_raw cross_sync_receipt_sha256 "$receipt_hash"
'@
    $encoded = ConvertTo-LabEncodedShellCommand -Command $probe
    "printf %s $encoded | base64 -d | sh"
}

function Get-GenericLinuxProbeCommand {
    $probe = @'
kv(){ v="$2"; [ -n "$v" ] || v=UNKNOWN; printf '%s=%s\n' "$1" "$v"; }
kv hostname "$(hostname 2>/dev/null)"
kv username "$(id -un 2>/dev/null)"
kv os "$(. /etc/os-release 2>/dev/null; printf '%s' "$PRETTY_NAME")"
kv uptime "$(uptime -p 2>/dev/null)"
kv docker "$(docker info --format '{{.ServerVersion}}' 2>/dev/null)"
kv gpu "$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | paste -sd ', ' -)"
kv disk "$(df -hP / 2>/dev/null | awk 'NR==2 {print $4 " free of " $2}')"
'@
    $encoded = ConvertTo-LabEncodedShellCommand -Command $probe
    "printf %s $encoded | base64 -d | sh"
}

function Get-LabRelayCommand {
    param(
        [Parameter(Mandatory)]$Route,
        [Parameter(Mandatory)][string]$RemoteCommand
    )

    $RelayAlias = [string]$Route.sshAlias
    if ($RelayAlias -cnotmatch '^[a-z][a-z0-9-]{0,31}$') {
        throw 'TOPOLOGY_INVALID: unsafe resident relay alias.'
    }
    $escapedCommand = $RemoteCommand.Replace("'", "''")
    $relayTemplate = @'
# LAB_CONTROL_RELAY_TARGET=__RELAY_ALIAS__
$relayAlias = '__RELAY_ALIAS__'
$expectedHost = '__EXPECTED_HOST__'
$expectedUser = '__EXPECTED_USER__'
$expectedPort = '__EXPECTED_PORT__'
$expectedFingerprint = '__EXPECTED_FINGERPRINT__'
$configurationTemp = Join-Path ([IO.Path]::GetTempPath()) ('williamos-lab-ssh-config-' + [Guid]::NewGuid().ToString('N') + '.tmp')
try {
  $configurationCommand = 'ssh.exe -G ' + $relayAlias + ' > "' + $configurationTemp + '" 2>&1'
  & cmd.exe /d /c $configurationCommand
  $configurationExitCode = $LASTEXITCODE
  $configurationLines = if (Test-Path -LiteralPath $configurationTemp -PathType Leaf) {
    @(Get-Content -LiteralPath $configurationTemp)
  } else { @() }
} finally {
  Remove-Item -LiteralPath $configurationTemp -Force -ErrorAction SilentlyContinue
}
if ($configurationExitCode -ne 0 -or $configurationLines.Count -eq 0) {
  Write-Error 'LAB_RELAY_CONFIG_MISMATCH: resident SSH alias cannot be resolved.' -ErrorAction Continue
  exit 64
}
$configuration = @{}
$identityFiles = @()
$knownHostsValues = @()
foreach ($line in $configurationLines) {
  if ($line -match '^([a-z0-9]+)\s+(.*)$') {
    $key = $Matches[1].ToLowerInvariant()
    $value = $Matches[2].Trim()
    if (-not $configuration.ContainsKey($key)) { $configuration[$key] = $value }
    if ($key -eq 'identityfile') { $identityFiles += $value }
    if ($key -eq 'userknownhostsfile') { $knownHostsValues += $value }
  }
}
$hasUnsafeProxy =
  ($configuration.ContainsKey('proxycommand') -and $configuration['proxycommand'] -ne 'none') -or
  ($configuration.ContainsKey('proxyjump') -and $configuration['proxyjump'] -ne 'none')
if ($configuration['hostname'] -cne $expectedHost -or
    $configuration['user'] -cne $expectedUser -or
    $configuration['port'] -cne $expectedPort -or
    $hasUnsafeProxy -or
    @($identityFiles | Where-Object { $_ -and $_ -ne 'none' }).Count -eq 0 -or
    @($knownHostsValues | Where-Object { $_ -and $_ -notmatch '^(?i:none|nul|/dev/null)$' }).Count -eq 0) {
  Write-Error 'LAB_RELAY_CONFIG_MISMATCH: resident SSH alias disagrees with the canonical endpoint or lacks managed trust.' -ErrorAction Continue
  exit 64
}
$hostKeyLookup = if ($expectedPort -eq '22') { $expectedHost } else { "[$expectedHost]:$expectedPort" }
$validatedKeyLines = [Collections.Generic.List[string]]::new()
$fingerprintConflict = $false
foreach ($knownHostsValue in $knownHostsValues) {
  $knownHostsPaths = @()
  $wholeKnownHostsPath = $knownHostsValue.Trim('"')
  if ($wholeKnownHostsPath.StartsWith('~/')) {
    $wholeKnownHostsPath = Join-Path $HOME $wholeKnownHostsPath.Substring(2)
  }
  if (Test-Path -LiteralPath $wholeKnownHostsPath -PathType Leaf) {
    $knownHostsPaths = @($wholeKnownHostsPath)
  } else {
    $knownHostsPathMatches = [regex]::Matches($knownHostsValue, '"(?<quoted>[^"]+)"|(?<bare>\S+)')
    foreach ($knownHostsPathMatch in $knownHostsPathMatches) {
      $candidatePath = if ($knownHostsPathMatch.Groups['quoted'].Success) {
        $knownHostsPathMatch.Groups['quoted'].Value
      } else {
        $knownHostsPathMatch.Groups['bare'].Value
      }
      if ($candidatePath.StartsWith('~/')) {
        $candidatePath = Join-Path $HOME $candidatePath.Substring(2)
      }
      $knownHostsPaths += $candidatePath
    }
  }
  foreach ($knownHostsPath in $knownHostsPaths) {
    if ([string]::IsNullOrWhiteSpace($knownHostsPath)) { continue }
    if (-not (Test-Path -LiteralPath $knownHostsPath -PathType Leaf)) { continue }
    $keyLines = @(& ssh-keygen.exe -F $hostKeyLookup -f $knownHostsPath 2>$null)
    if ($keyLines.Count -eq 0) { continue }
    if (@($keyLines | Where-Object { $_ -cmatch '^@revoked\s+\S+\s+ssh-ed25519\s+\S+(?:\s.*)?$' }).Count -gt 0) {
      $fingerprintConflict = $true
      break
    }
    foreach ($keyLine in @($keyLines | Where-Object { $_ -cmatch '^\S+\s+ssh-ed25519\s+\S+(?:\s.*)?$' })) {
      $fingerprintLines = @($keyLine | & ssh-keygen.exe -lf - -E sha256 2>$null)
      if ($fingerprintLines.Count -ne 1 -or
          $fingerprintLines[0] -cnotmatch '^\s*\d+\s+(?<fingerprint>SHA256:[A-Za-z0-9+/]{43})\s+.*\((?<algorithm>[A-Z0-9-]+)\)\s*$' -or
          $Matches.algorithm -cne 'ED25519' -or
          $Matches.fingerprint -cne $expectedFingerprint) {
        $fingerprintConflict = $true
        break
      }
      $validatedKeyLines.Add([string]$keyLine)
    }
    if ($fingerprintConflict) { break }
  }
  if ($fingerprintConflict) { break }
}
if ($fingerprintConflict -or $validatedKeyLines.Count -eq 0) {
  Write-Error 'LAB_RELAY_FINGERPRINT_MISMATCH: managed known_hosts does not contain the verified route fingerprint.' -ErrorAction Continue
  exit 64
}
$pinnedKnownHostsPath = Join-Path ([IO.Path]::GetTempPath()) ('williamos-lab-known-hosts-' + [Guid]::NewGuid().ToString('N') + '.tmp')
[IO.File]::WriteAllLines($pinnedKnownHostsPath, @($validatedKeyLines), [Text.UTF8Encoding]::new($false))
$arguments = @(
  '-n',
  '-o', "Hostname=$expectedHost",
  '-o', "User=$expectedUser",
  '-o', "Port=$expectedPort",
  '-o', "HostKeyAlias=$hostKeyLookup",
  '-o', 'ProxyCommand=none',
  '-o', 'ProxyJump=none',
  '-o', 'BatchMode=yes',
  '-o', 'IdentitiesOnly=yes',
  '-o', 'IdentityAgent=none',
  '-o', "UserKnownHostsFile=$pinnedKnownHostsPath",
  '-o', 'GlobalKnownHostsFile=none',
  '-o', 'KnownHostsCommand=none',
  '-o', 'StrictHostKeyChecking=yes',
  '-o', 'HostKeyAlgorithms=ssh-ed25519',
  '-o', 'CheckHostIP=yes',
  '-o', 'CanonicalizeHostname=no',
  '-o', 'UpdateHostKeys=no',
  '-o', 'PasswordAuthentication=no',
  '-o', 'KbdInteractiveAuthentication=no',
  '-o', 'PreferredAuthentications=publickey',
  '-o', 'ForwardAgent=no',
  '-o', 'PermitLocalCommand=no',
  '-o', 'ClearAllForwardings=yes',
  '-o', 'RequestTTY=no',
  '-o', 'ControlMaster=no',
  '-o', 'ControlPersist=no',
  '-o', 'ControlPath=none',
  '-o', 'VerifyHostKeyDNS=no',
  '-o', 'ConnectTimeout=5',
  '-o', 'ConnectionAttempts=1',
  '-o', 'ServerAliveInterval=3',
  '-o', 'ServerAliveCountMax=1',
  '--', $relayAlias, '__REMOTE_COMMAND__'
)
$relayExitCode = 1
try {
  & ssh.exe @arguments
  $relayExitCode = $LASTEXITCODE
} finally {
  Remove-Item -LiteralPath $pinnedKnownHostsPath -Force -ErrorAction SilentlyContinue
}
exit $relayExitCode
'@
    $relay = $relayTemplate.
        Replace('__RELAY_ALIAS__', $RelayAlias).
        Replace('__EXPECTED_HOST__', [string]$Route.endpoint.host).
        Replace('__EXPECTED_USER__', [string]$Route.endpoint.user).
        Replace('__EXPECTED_PORT__', [string]$Route.endpoint.port).
        Replace('__EXPECTED_FINGERPRINT__', [string]$Route.hostKeyFingerprint).
        Replace('__REMOTE_COMMAND__', $escapedCommand)
    $encoded = ConvertTo-LabEncodedPowerShellCommand -Command $relay
    "powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand $encoded"
}

function Get-LabLocalSnapshot {
    param(
        [Parameter(Mandatory)]$Node,
        [Parameter(Mandatory)]$Topology
    )

    $hostname = [Environment]::MachineName
    $identityContract = Get-LabIdentityContract -Reference ([string]$Topology.identityContractRef)
    $identityNode = $identityContract.nodes.PSObject.Properties[$Node.id].Value
    $expectedHostnames = @($identityNode.hostnames)
    $identityMatches = @($expectedHostnames | Where-Object { $_ -ieq $hostname }).Count -eq 1
    $os = [Environment]::OSVersion.VersionString
    $uptime = try { (Get-Uptime).ToString() } catch { 'UNKNOWN' }
    $disk = try {
        $drive = Get-PSDrive -Name ((Get-Location).Drive.Name) -PSProvider FileSystem -ErrorAction Stop
        '{0:N0} GB free' -f ($drive.Free / 1GB)
    } catch { 'UNKNOWN' }
    [pscustomobject]@{
        NodeId = $Node.id
        Target = $Node.id
        DisplayName = $Node.displayName
        ProbeProfile = $Node.probeProfile
        Required = $Node.required
        Local = $true
        Reachable = $identityMatches
        ProbeSucceeded = $identityMatches
        FailureKind = if ($identityMatches) { $null } else { 'LOCAL_IDENTITY_MISMATCH' }
        Values = [ordered]@{ hostname = $hostname; os = $os; uptime = $uptime; disk = $disk }
    }
}

function Get-LabNodeSnapshot {
    param(
        [Parameter(Mandatory)]$Node,
        [Parameter(Mandatory)]$Route,
        [Parameter(Mandatory)]$Topology
    )

    $command = switch ($Node.probeProfile) {
        'hermes-windows' { Get-HermesProbeCommand }
        'atlas-linux' { Get-AtlasProbeCommand }
        'linux-generic' { Get-GenericLinuxProbeCommand }
        default { throw "TOPOLOGY_INVALID: unsupported remote probe profile $($Node.probeProfile)." }
    }
    $transportAlias = $Route.sshAlias
    $transportCommand = $command
    if ($Route.routeKind -ceq 'resident-relay') {
        $jumpNodeId = @($Route.viaNodeIds)[0]
        $jumpRoute = @($Topology.managementRoutes | Where-Object toNodeId -CEQ $jumpNodeId)
        if ($jumpRoute.Count -ne 1) {
            throw "TOPOLOGY_INVALID: resident relay route for $($Node.id) has no unique jump route."
        }
        $transportAlias = $jumpRoute[0].sshAlias
        $transportCommand = Get-LabRelayCommand -Route $Route -RemoteCommand $command
        $transportRoute = $jumpRoute[0]
    } else {
        $transportRoute = $Route
    }
    $result = Invoke-LabSsh -Target $transportAlias -RemoteCommand $transportCommand -Route $transportRoute -Topology $Topology
    if (-not $result.Ok) {
        $transportReached = $result.FailureKind -ceq 'REMOTE_COMMAND_FAILED'
        return [pscustomobject]@{
            NodeId = $Node.id
            Target = $Route.sshAlias
            DisplayName = $Node.displayName
            ProbeProfile = $Node.probeProfile
            Required = $Node.required
            Local = $false
            Reachable = $transportReached
            ProbeSucceeded = $false
            FailureKind = $result.FailureKind
            Values = [ordered]@{}
        }
    }
    $values = ConvertFrom-LabKeyValueLines -Lines $result.Lines
    $identityContract = Get-LabIdentityContract -Reference ([string]$Topology.identityContractRef)
    $identityNode = $identityContract.nodes.PSObject.Properties[$Node.id].Value
    $expectedHostnames = @($identityNode.hostnames)
    $observedHostname = Get-LabRawValue -Values $values -Key 'hostname'
    $observedUsername = Get-LabRawValue -Values $values -Key 'username'
    if ([string]::IsNullOrWhiteSpace($observedHostname) -or
        @($expectedHostnames | Where-Object { $_ -ieq $observedHostname }).Count -ne 1 -or
        [string]::IsNullOrWhiteSpace($observedUsername) -or
        $observedUsername -ine [string]$Route.endpoint.user) {
        return [pscustomobject]@{
            NodeId = $Node.id
            Target = $Route.sshAlias
            DisplayName = $Node.displayName
            ProbeProfile = $Node.probeProfile
            Required = $Node.required
            Local = $false
            Reachable = $false
            ProbeSucceeded = $false
            FailureKind = 'SSH_IDENTITY_MISMATCH'
            Values = $values
        }
    }
    [pscustomobject]@{
        NodeId = $Node.id
        Target = $Route.sshAlias
        DisplayName = $Node.displayName
        ProbeProfile = $Node.probeProfile
        Required = $Node.required
        Local = $false
        Reachable = $true
        ProbeSucceeded = $true
        FailureKind = $null
        Values = $values
    }
}

function Get-LabNamedNodeSnapshot {
    param([Parameter(Mandatory)][string]$NodeId)

    $topology = Get-LabTopology
    $node = @($topology.nodes | Where-Object id -CEQ $NodeId)
    $route = @($topology.managementRoutes | Where-Object toNodeId -CEQ $NodeId)
    if ($node.Count -ne 1 -or $route.Count -ne 1) {
        throw "TOPOLOGY_INVALID: node $NodeId has no unique management route."
    }
    $controlNode = @($topology.nodes | Where-Object id -CEQ $topology.controlNodeId)
    if ($controlNode.Count -ne 1) {
        throw 'TOPOLOGY_INVALID: control node is not unique.'
    }
    $local = Get-LabLocalSnapshot -Node $controlNode[0] -Topology $topology
    if (-not $local.Reachable) {
        return [pscustomobject]@{
            NodeId = $node[0].id
            Target = $route[0].sshAlias
            DisplayName = $node[0].displayName
            ProbeProfile = $node[0].probeProfile
            Required = $node[0].required
            Local = $false
            Reachable = $false
            ProbeSucceeded = $false
            FailureKind = 'LOCAL_IDENTITY_MISMATCH'
            Values = [ordered]@{ control_hostname = (Get-LabRawValue -Values $local.Values -Key 'hostname') }
        }
    }
    Get-LabNodeSnapshot -Node $node[0] -Route $route[0] -Topology $topology
}

function Get-LabValue {
    param([System.Collections.IDictionary]$Values, [string]$Key)
    if ($Values.Contains($Key) -and -not [string]::IsNullOrWhiteSpace([string]$Values[$Key])) {
        return $Values[$Key]
    }
    'UNKNOWN'
}

function Write-LabNodeSummary {
    param([Parameter(Mandatory)]$Snapshot)

    Write-Output $Snapshot.DisplayName
    if (-not $Snapshot.Reachable) {
        Write-Output "  reachable: NO ($($Snapshot.FailureKind))"
        return
    }
    if (-not $Snapshot.ProbeSucceeded) {
        Write-Output '  reachable: YES'
        Write-Output "  probe: FAILED ($($Snapshot.FailureKind))"
        return
    }
    if ($Snapshot.Local) {
        Write-Output '  reachable: YES (LOCAL)'
        Write-Output "  hostname: $(Get-LabValue $Snapshot.Values 'hostname')"
        Write-Output "  OS: $(Get-LabValue $Snapshot.Values 'os')"
        Write-Output "  disk: $(Get-LabValue $Snapshot.Values 'disk')"
        return
    }
    Write-Output '  reachable: YES'
    Write-Output "  hostname: $(Get-LabValue $Snapshot.Values 'hostname')"
    Write-Output "  username: $(Get-LabValue $Snapshot.Values 'username')"
    Write-Output "  OS: $(Get-LabValue $Snapshot.Values 'os')"
    Write-Output "  uptime: $(Get-LabValue $Snapshot.Values 'uptime')"
    Write-Output "  Docker: $(Get-LabValue $Snapshot.Values 'docker')"
    if ($Snapshot.ProbeProfile -eq 'hermes-windows') {
        Write-Output "  Ollama: $(Get-LabValue $Snapshot.Values 'ollama')"
        Write-Output "  GPU: $(Get-LabValue $Snapshot.Values 'gpu')"
    } elseif ($Snapshot.ProbeProfile -eq 'atlas-linux') {
        Write-Output "  Postgres evidence: $(Get-LabValue $Snapshot.Values 'postgres_evidence')"
        Write-Output "  Redis evidence: $(Get-LabValue $Snapshot.Values 'redis_evidence')"
        Write-Output "  Mongo evidence: $(Get-LabValue $Snapshot.Values 'mongo_evidence')"
    } else {
        Write-Output "  GPU: $(Get-LabValue $Snapshot.Values 'gpu')"
    }
    Write-Output "  disk: $(Get-LabValue $Snapshot.Values 'disk')"
}

function Invoke-LabStatus {
    try {
        $topology = Get-LabTopology
    } catch {
        Write-Output 'LAB'
        Write-Output "  operator blocker: $($_.Exception.Message)"
        $global:LAB_CONTROL_EXIT_CODE = 2
        return
    }
    $routesByTarget = @{}
    foreach ($route in @($topology.managementRoutes)) { $routesByTarget[$route.toNodeId] = $route }
    $controlNode = @($topology.nodes | Where-Object id -CEQ $topology.controlNodeId)[0]
    $localSnapshot = Get-LabLocalSnapshot -Node $controlNode -Topology $topology
    if (-not $localSnapshot.Reachable) {
        Write-LabNodeSummary $localSnapshot
        Write-Output 'LAB'
        Write-Output '  operator blocker: LOCAL_IDENTITY_MISMATCH (lab-control must run on canonical OMEN)'
        $global:LAB_CONTROL_EXIT_CODE = 2
        return
    }
    $hermesNode = @($topology.nodes | Where-Object id -CEQ 'hermes-node')[0]
    $hermes = Get-LabNodeSnapshot -Node $hermesNode -Route $routesByTarget['hermes-node'] -Topology $topology
    $snapshots = @($localSnapshot, $hermes)
    foreach ($node in @($topology.nodes | Where-Object { $_.id -cnotin @($topology.controlNodeId, 'hermes-node') })) {
        $route = $routesByTarget[$node.id]
        if (-not $hermes.Reachable -and 'hermes-node' -cin @($route.viaNodeIds)) {
            $snapshots += [pscustomobject]@{
                NodeId = $node.id
                Target = $route.sshAlias
                DisplayName = $node.displayName
                ProbeProfile = $node.probeProfile
                Required = $node.required
                Local = $false
                Reachable = $false
                ProbeSucceeded = $false
                FailureKind = 'SSH_RELAY_UNAVAILABLE'
                Values = [ordered]@{}
            }
        } else {
            $snapshots += Get-LabNodeSnapshot -Node $node -Route $route -Topology $topology
        }
    }
    $atlas = @($snapshots | Where-Object NodeId -CEQ 'atlas')[0]
    $nowUtc = Get-LabNowUtc
    $syncEvidence = Get-LabCrossSyncEvidence -HermesValues $hermes.Values -AtlasValues $atlas.Values -NowUtc $nowUtc
    $syncReady = $syncEvidence.State -eq 'SYNC_OK'
    foreach ($snapshot in $snapshots) { Write-LabNodeSummary $snapshot }
    Write-Output 'LAB'
    Write-Output "  latest backup: $(Get-LabValue $atlas.Values 'backup')"
    Write-Output "  latest cross-node sync: $($syncEvidence.State) $($syncEvidence.Detail)"

    $failures = @($snapshots | Where-Object { $_.Required -and (-not $_.Reachable -or -not $_.ProbeSucceeded) })
    if ($failures.Count -eq 0) {
        $requiredValues = @(
            (Get-LabValue $snapshots[0].Values 'hostname'),
            (Get-LabValue $snapshots[0].Values 'os'),
            (Get-LabValue $snapshots[0].Values 'disk'),
            (Get-LabValue $hermes.Values 'docker'),
            (Get-LabValue $hermes.Values 'ollama'),
            (Get-LabValue $hermes.Values 'gpu'),
            (Get-LabValue $hermes.Values 'disk'),
            (Get-LabValue $atlas.Values 'docker'),
            (Get-LabValue $atlas.Values 'disk'),
            (Get-LabValue $atlas.Values 'backup')
        )
        foreach ($generic in @($snapshots | Where-Object ProbeProfile -CEQ 'linux-generic')) {
            $requiredValues += @(
                (Get-LabValue $generic.Values 'hostname'),
                (Get-LabValue $generic.Values 'username'),
                (Get-LabValue $generic.Values 'os'),
                (Get-LabValue $generic.Values 'uptime'),
                (Get-LabValue $generic.Values 'docker'),
                (Get-LabValue $generic.Values 'disk')
            )
            if ($generic.NodeId -ceq 'daedalus') {
                $requiredValues += (Get-LabValue $generic.Values 'gpu')
            }
        }
        $genericIncomplete = @($requiredValues | Where-Object { $_ -match '^(?i:UNKNOWN|UNAVAILABLE|NOT_FOUND|NOT_INSTALLED|NOT_OBSERVED|UNVERIFIED|FAILED)' }).Count -gt 0
        $daedalus = @($snapshots | Where-Object NodeId -CEQ 'daedalus')[0]
        $daedalusGpuReady = [string](Get-LabValue $daedalus.Values 'gpu') -match '(?i)\b(?:NVIDIA|GeForce|RTX|Tesla|Quadro)\b'
        $postgresReady = (Get-LabValue $atlas.Values 'postgres_evidence') -in @('PG_ISREADY_ACCEPTING', 'CONTAINER_PG_ISREADY_ACCEPTING')
        $redisReady = (Get-LabValue $atlas.Values 'redis_evidence') -in @('REDIS_PING_PONG', 'REDIS_AUTH_REQUIRED_REACHABLE', 'CONTAINER_REDIS_PING_PONG', 'CONTAINER_REDIS_AUTH_REQUIRED_REACHABLE')
        $mongoReady = (Get-LabValue $atlas.Values 'mongo_evidence') -in @('MONGO_PING_OK', 'CONTAINER_MONGO_PING_OK')
        if ($genericIncomplete -or -not $daedalusGpuReady -or -not $postgresReady -or -not $redisReady -or -not $mongoReady -or -not $syncReady) {
            Write-Output '  operator blocker: REQUIRED_EVIDENCE_INCOMPLETE (inspect UNKNOWN/unavailable service or continuity fields above)'
            $global:LAB_CONTROL_EXIT_CODE = 2
        } else {
            Write-Output '  operator blocker: NONE'
            $global:LAB_CONTROL_EXIT_CODE = 0
        }
    } elseif (@($failures | Where-Object FailureKind -eq 'SSH_AUTH_BLOCKED').Count -gt 0) {
        Write-Output '  operator blocker: SSH authentication is not configured for one or more aliases'
        $global:LAB_CONTROL_EXIT_CODE = 2
    } elseif (@($failures | Where-Object { $_.Reachable -and -not $_.ProbeSucceeded }).Count -gt 0) {
        Write-Output '  operator blocker: one or more required probes failed; transport reachability is shown separately above'
        $global:LAB_CONTROL_EXIT_CODE = 2
    } else {
        Write-Output '  operator blocker: one or more lab nodes are unreachable; inspect the typed SSH result above'
        $global:LAB_CONTROL_EXIT_CODE = 2
    }
}

function Write-LabDetailedSnapshot {
    param([Parameter(Mandatory)][ValidateSet('hermes', 'atlas', 'aegis', 'daedalus')][string]$Target)

    $nodeId = if ($Target -eq 'hermes') { 'hermes-node' } else { $Target }
    $snapshot = Get-LabNamedNodeSnapshot -NodeId $nodeId
    if (-not $snapshot.Reachable) {
        Write-Output "$($snapshot.DisplayName): UNREACHABLE ($($snapshot.FailureKind))"
        $global:LAB_CONTROL_EXIT_CODE = 2
        return
    }
    if (-not $snapshot.ProbeSucceeded) {
        Write-Output "$($snapshot.DisplayName): REACHABLE"
        Write-Output "  probe: FAILED ($($snapshot.FailureKind))"
        $global:LAB_CONTROL_EXIT_CODE = 2
        return
    }
    Write-Output "$($snapshot.DisplayName): REACHABLE"
    foreach ($entry in $snapshot.Values.GetEnumerator()) {
        Write-Output ("  {0}: {1}" -f $entry.Key, $entry.Value)
    }
    $global:LAB_CONTROL_EXIT_CODE = 0
}

function Invoke-LabHermes { Write-LabDetailedSnapshot -Target hermes }
function Invoke-LabAtlas { Write-LabDetailedSnapshot -Target atlas }
function Invoke-LabAegis { Write-LabDetailedSnapshot -Target aegis }
function Invoke-LabDaedalus { Write-LabDetailedSnapshot -Target daedalus }

function Invoke-LabContainers {
    try {
        $topology = Get-LabTopology
    } catch {
        Write-Output "LAB: $($_.Exception.Message)"
        $global:LAB_CONTROL_EXIT_CODE = 2
        return
    }
    $controlNode = @($topology.nodes | Where-Object id -CEQ $topology.controlNodeId)[0]
    $local = Get-LabLocalSnapshot -Node $controlNode -Topology $topology
    if (-not $local.Reachable) {
        Write-Output 'OMEN: LOCAL_IDENTITY_MISMATCH'
        $global:LAB_CONTROL_EXIT_CODE = 2
        return
    }
    $routesByAlias = @{}
    foreach ($route in @($topology.managementRoutes)) { $routesByAlias[$route.sshAlias] = $route }
    $hermesProbe = @'
$ErrorActionPreference='SilentlyContinue'
docker ps --format "table {{.Names}}`t{{.Image}}`t{{.Status}}`t{{.Ports}}"
'@
    $commands = @{
        hermes = "powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand $(ConvertTo-LabEncodedPowerShellCommand -Command $hermesProbe)"
        atlas = "docker ps --format 'table {{.Names}}`t{{.Image}}`t{{.Status}}`t{{.Ports}}'"
    }
    $failed = $false
    foreach ($target in @('hermes', 'atlas')) {
        Write-Output $target.ToUpperInvariant()
        $result = Invoke-LabSsh -Target $target -RemoteCommand $commands[$target] -Route $routesByAlias[$target] -Topology $topology
        if ($result.Ok) {
            $result.Lines | Write-Output
        } else {
            $state = if ($result.FailureKind -eq 'REMOTE_COMMAND_FAILED') { 'FAILED' } else { 'UNREACHABLE' }
            Write-Output "  $state ($($result.FailureKind))"
            $failed = $true
        }
    }
    $global:LAB_CONTROL_EXIT_CODE = if ($failed) { 2 } else { 0 }
}

function Invoke-LabBackups {
    $hermes = Get-LabNamedNodeSnapshot -NodeId 'hermes-node'
    $atlas = Get-LabNamedNodeSnapshot -NodeId 'atlas'
    if (-not $hermes.Reachable -or -not $hermes.ProbeSucceeded -or -not $atlas.Reachable -or -not $atlas.ProbeSucceeded) {
        foreach ($snapshot in @($hermes, $atlas)) {
            if (-not $snapshot.Reachable) {
                Write-Output "$($snapshot.DisplayName): UNREACHABLE ($($snapshot.FailureKind))"
            } elseif (-not $snapshot.ProbeSucceeded) {
                Write-Output "$($snapshot.DisplayName): REACHABLE; PROBE FAILED ($($snapshot.FailureKind))"
            }
        }
        $global:LAB_CONTROL_EXIT_CODE = 2
        return
    }
    $syncEvidence = Get-LabCrossSyncEvidence -HermesValues $hermes.Values -AtlasValues $atlas.Values -NowUtc (Get-LabNowUtc)
    $probe = @'
printf 'ATLAS BACKUP CANDIDATES\n'
found=0
for d in /home/bs/backups /srv/backups /opt/backups /mnt/backups /backups; do
  [ -d "$d" ] || continue
  found=1
  printf '%s\n' "$d"
  find "$d" -maxdepth 2 -type f -printf '%T@|%p\n' 2>/dev/null | sort -nr | head -n 5 |
    while IFS='|' read -r epoch path; do
      timestamp="$(date -d "@${epoch%.*}" --iso-8601=seconds 2>/dev/null)"
      [ -n "$timestamp" ] || timestamp="$epoch"
      printf '%s %s\n' "$timestamp" "$path"
    done
done
[ "$found" -eq 1 ] || printf 'NO_KNOWN_BACKUP_DIRECTORY_VISIBLE\n'
'@
    $encoded = ConvertTo-LabEncodedShellCommand -Command $probe
    $topology = Get-LabTopology
    $atlasRoute = @($topology.managementRoutes | Where-Object toNodeId -CEQ 'atlas')[0]
    $result = Invoke-LabSsh -Target atlas -RemoteCommand "printf %s $encoded | base64 -d | sh" -Route $atlasRoute -Topology $topology
    if ($result.Ok) {
        $result.Lines | Write-Output
        Write-Output "latest cross-node sync: $($syncEvidence.State) $($syncEvidence.Detail)"
        $global:LAB_CONTROL_EXIT_CODE = if ($syncEvidence.State -eq 'SYNC_OK') { 0 } else { 2 }
    } else {
        $state = if ($result.FailureKind -eq 'REMOTE_COMMAND_FAILED') { 'FAILED' } else { 'UNREACHABLE' }
        Write-Output "ATLAS: $state ($($result.FailureKind))"
        $global:LAB_CONTROL_EXIT_CODE = 2
    }
}

Export-ModuleMember -Function Get-LabTopology, Get-LabSshConfigCandidate, Get-LabCrossSyncEvidence, Invoke-LabStatus, Invoke-LabHermes, Invoke-LabAtlas, Invoke-LabAegis, Invoke-LabDaedalus, Invoke-LabContainers, Invoke-LabBackups
