param(
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [Parameter(Mandatory = $true)][string]$LaunchManifestPath,
  [Parameter(Mandatory = $true)][string]$CollectionId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'HERMES_OWNERSHIP_ELEVATION_REQUIRED'
}

function Get-Sha256Text([AllowNull()][string]$Value) {
  $bytes = [Text.Encoding]::UTF8.GetBytes([string]$Value)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) } finally { $sha.Dispose() }
}

function New-OwnershipFileSystemSecurity([bool]$Directory) {
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $administratorsSid = [Security.Principal.SecurityIdentifier]::new([Security.Principal.WellKnownSidType]::BuiltinAdministratorsSid, $null)
  $systemSid = [Security.Principal.SecurityIdentifier]::new([Security.Principal.WellKnownSidType]::LocalSystemSid, $null)
  $security = if ($Directory) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
  $security.SetOwner($administratorsSid)
  $security.SetAccessRuleProtection($true, $false)
  $inheritance = if ($Directory) { [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit } else { [Security.AccessControl.InheritanceFlags]::None }
  [void]$security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($currentSid, [Security.AccessControl.FileSystemRights]::ReadAndExecute -bor [Security.AccessControl.FileSystemRights]::Synchronize, $inheritance, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
  [void]$security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($administratorsSid, [Security.AccessControl.FileSystemRights]::FullControl, $inheritance, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
  [void]$security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($systemSid, [Security.AccessControl.FileSystemRights]::FullControl, $inheritance, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
  return $security
}

function New-ElevatedSourceDirectory([string]$Path) {
  $security = New-OwnershipFileSystemSecurity $true
  # Windows PowerShell 5.1 exposes the atomic DirectorySecurity overload directly.
  $directory = [IO.Directory]::CreateDirectory($Path, $security)
  $actual = $directory.GetAccessControl([Security.AccessControl.AccessControlSections]::Owner -bor [Security.AccessControl.AccessControlSections]::Access)
  if ($actual.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Owner -bor [Security.AccessControl.AccessControlSections]::Access) `
    -ne $security.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Owner -bor [Security.AccessControl.AccessControlSections]::Access)) {
    throw 'HERMES_OWNERSHIP_SOURCE_DIRECTORY_ACL_MISMATCH'
  }
  return $directory
}

function New-ElevatedSourceStream([string]$Path) {
  $security = New-OwnershipFileSystemSecurity $false
  $rights = [Security.AccessControl.FileSystemRights]::ReadData -bor [Security.AccessControl.FileSystemRights]::WriteData -bor [Security.AccessControl.FileSystemRights]::ReadAttributes -bor [Security.AccessControl.FileSystemRights]::WriteAttributes -bor [Security.AccessControl.FileSystemRights]::Synchronize
  [IO.FileStream]::new($Path, [IO.FileMode]::CreateNew, $rights, [IO.FileShare]::Read, 4096, [IO.FileOptions]::WriteThrough, $security)
}

$scriptSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $PSCommandPath).Hash.ToLowerInvariant()
$resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
$resolvedManifest = [IO.Path]::GetFullPath($LaunchManifestPath)
if (-not [IO.File]::Exists($resolvedManifest)) { throw 'HERMES_OWNERSHIP_MANIFEST_MISSING' }
$manifestItem = Get-Item -LiteralPath $resolvedManifest -Force
if (($manifestItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'HERMES_OWNERSHIP_MANIFEST_REPARSE_REFUSED' }
$launchManifest = ([IO.File]::ReadAllText($resolvedManifest) -replace '^\uFEFF', '') | ConvertFrom-Json -ErrorAction Stop
$manifestSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedManifest).Hash.ToLowerInvariant()
$manifestKeys = @($launchManifest.PSObject.Properties.Name | Sort-Object)
$expectedManifestKeys = @('authority','binderSha256','boundPathSha256','collectorSha256','dockerSha256','expectedUacPrompts','hostIdentity','nodeSha256','nonce','persistentCredential','powershellSha256','schema','sourcePathSha256','stagedAt','stagerSha256','uacMethod') | Sort-Object
if (($manifestKeys -join '|') -ne ($expectedManifestKeys -join '|') -or $launchManifest.schema -ne 'hermes-ollama-ownership-launch/1' `
  -or [string]$launchManifest.nonce -ne $CollectionId -or $launchManifest.expectedUacPrompts -ne 1 `
  -or $launchManifest.uacMethod -ne 'Start-Process/RunAs' -or $launchManifest.persistentCredential -ne $false `
  -or $launchManifest.authority.readOnly -ne $true -or $launchManifest.authority.hostMutationAuthorized -ne $false) {
  throw 'HERMES_OWNERSHIP_MANIFEST_INVALID'
}
if ($scriptSha256 -ne [string]$launchManifest.collectorSha256) { throw 'HERMES_OWNERSHIP_COLLECTOR_DIGEST_MISMATCH' }
if ((Get-Sha256Text $resolvedOutput) -ne [string]$launchManifest.sourcePathSha256) { throw 'HERMES_OWNERSHIP_OUTPUT_BINDING_MISMATCH' }
$dockerExe = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $dockerExe -ErrorAction Stop).Hash.ToLowerInvariant() -ne [string]$launchManifest.dockerSha256) { throw 'HERMES_OWNERSHIP_DOCKER_DIGEST_MISMATCH' }
$machineGuid = [string](Get-ItemPropertyValue -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid -ErrorAction Stop)
$hostIdentity = [ordered]@{ computerName = [Environment]::MachineName; machineGuidSha256 = Get-Sha256Text $machineGuid }
if ($hostIdentity.computerName -cne [string]$launchManifest.hostIdentity.computerName -or $hostIdentity.machineGuidSha256 -ne [string]$launchManifest.hostIdentity.machineGuidSha256) { throw 'HERMES_OWNERSHIP_HOST_IDENTITY_MISMATCH' }
$outputDirectory = [IO.Path]::GetDirectoryName($resolvedOutput)
$lineageDirectory = [IO.Path]::GetDirectoryName($outputDirectory)
if (-not [IO.Directory]::Exists($lineageDirectory)) { throw 'HERMES_OWNERSHIP_OUTPUT_PARENT_MISSING' }
$lineageDirectoryInfo = Get-Item -LiteralPath $lineageDirectory -Force
if (($lineageDirectoryInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'HERMES_OWNERSHIP_OUTPUT_REPARSE_REFUSED' }
$outputDirectoryInfo = New-ElevatedSourceDirectory $outputDirectory
if (($outputDirectoryInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'HERMES_OWNERSHIP_OUTPUT_REPARSE_REFUSED' }
if ([IO.File]::Exists($resolvedOutput)) { throw 'HERMES_OWNERSHIP_OUTPUT_EXISTS' }

function Protect-Text([AllowNull()][string]$Value) {
  if ($null -eq $Value) { return $null }
  $protected = $Value -replace '(?is)-----BEGIN [^-]+PRIVATE KEY-----.*?-----END [^-]+PRIVATE KEY-----', '[REDACTED_PRIVATE_KEY]'
  $protected = $protected -replace '(?i)(https?|postgres(?:ql)?|mongodb(?:\+srv)?|redis)://[^/@\s:]+:[^/@\s]+@', '$1://[REDACTED]@'
  $protected = $protected -replace '(?i)\b(authorization|proxy-authorization)\s*:\s*(?:bearer|basic)\s+\S+', '$1: [REDACTED]'
  $protected = $protected -replace '(?i)\b(cookie|set-cookie)\s*:\s*[^\r\n]+', '$1: [REDACTED]'
  $protected = $protected -replace '(?i)(--?(?:password|passwd|pwd|secret|token|api[_-]?key|authorization))(?:\s+|=)(?:"[^"]*"|''[^'']*''|\S+)', '$1=[REDACTED]'
  $protected = $protected -replace '(?i)\b(password|passwd|pwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*(?:"[^"]*"|''[^'']*''|\S+)', '$1=[REDACTED]'
  return $protected
}

function Get-CommandProjection([AllowNull()][string]$Command) {
  $value = [string]$Command
  $scriptPaths = @([regex]::Matches($value, '(?i)[A-Z]:\\[^"''\r\n]*?\.ps1') | ForEach-Object { Protect-Text $_.Value } | Sort-Object -Unique)
  [ordered]@{
    sha256 = Get-Sha256Text $value
    scriptPaths = $scriptPaths
    mentionsOllama = [bool]($value -match '(?i)ollama')
    directNativeServe = [bool]($value -match '(?i)ollama(?:\.exe)?(?:"|''|\s)+(?:serve|start)(?:\s|$)')
    requestsCanonicalTask = [bool]($value -match '(?i)(?:Start-ScheduledTask|schtasks(?:\.exe)?\s+/Run).*WilliamOS-HERMES-Ollama')
    role = if ($value -match '(?i)(?:^|\s)serve(?:\s|$)') { 'SERVER' } elseif ($value -match '(?i)(?:^|\s)runner(?:\s|$)') { 'RUNNER' } else { 'OTHER' }
  }
}

function Test-DockerOwnershipSignal([object]$Row, [object]$Inspect) {
  $identitySignal = ([string]$Row.Names + ' ' + [string]$Row.Image + ' ' + [string]$Row.Command) -match '(?i)ollama'
  $publishedSignal = [string]$Row.Ports -match '(?i)(?:^|[\s,:])11434(?:->|/|\b)'
  $portBindings = $Inspect.HostConfig.PortBindings
  $bindingNames = @()
  $bindingValues = @()
  if ($null -ne $portBindings) {
    $bindingNames = @($portBindings.PSObject.Properties.Name)
    $bindingValues = @($portBindings.PSObject.Properties | ForEach-Object { @($_.Value) } | Where-Object { $null -ne $_ } | ForEach-Object { [string]$_.HostPort })
  }
  $bindingSignal = @($bindingNames | Where-Object { $_ -match '(?i)^11434/(?:tcp|udp)$' }).Count -gt 0 -or @($bindingValues | Where-Object { $_ -eq '11434' }).Count -gt 0
  $mountSignal = @($Inspect.Mounts | Where-Object {
    ([string]$_.Source + ' ' + [string]$_.Destination) -match '(?i)(?:^|[\\/])(?:\.ollama|ollama|ollama-service)(?:[\\/]|$)'
  }).Count -gt 0
  return [bool]($identitySignal -or $publishedSignal -or $bindingSignal -or $mountSignal)
}

function Throw-ProbeFailure([string]$TypedClass, [string]$Message, [AllowNull()][Nullable[int]]$ExternalToolExitCode = $null) {
  $exception = [InvalidOperationException]::new($Message)
  $exception.Data['HERMES_TYPED_CLASS'] = $TypedClass
  if ($null -ne $ExternalToolExitCode) { $exception.Data['HERMES_EXTERNAL_TOOL_EXIT_CODE'] = [int]$ExternalToolExitCode }
  throw $exception
}

$script:CollectionStartedAt = (Get-Date).ToUniversalTime().ToString('o')
$script:CurrentSubprobe = [ordered]@{ id = 'collector.envelope'; stage = 'PRECONDITION'; domain = 'collector'; toolIdentity = $null }
$script:PartialObservations = [Collections.Generic.List[object]]::new()

function Enter-OwnershipSubprobe([string]$Id, [string]$Stage, [string]$Domain, [AllowNull()][string]$ToolIdentity = $null) {
  $script:CurrentSubprobe = [ordered]@{ id = $Id; stage = $Stage; domain = $Domain; toolIdentity = $ToolIdentity }
}

function Complete-Subprobe([string]$Id, [object]$Value) {
  $script:PartialObservations.Add([ordered]@{
    subprobeId = $Id
    observedAt = (Get-Date).ToUniversalTime().ToString('o')
    authoritative = $false
    value = $Value
  })
  return $Value
}

function Get-TypedFailure([Management.Automation.ErrorRecord]$Record) {
  $exception = $Record.Exception
  $typedClass = if ($exception.Data.Contains('HERMES_TYPED_CLASS')) { [string]$exception.Data['HERMES_TYPED_CLASS'] }
    elseif ($exception -is [UnauthorizedAccessException] -or [string]$Record.CategoryInfo.Category -eq 'PermissionDenied' -or $exception.HResult -eq -2147024891) { 'ACCESS_DENIED' }
    elseif ([string]$Record.FullyQualifiedErrorId -match '(?i)ConvertFromJson|ParserError|InvalidJson') { 'PARSE_FAILURE' }
    elseif ($exception -is [FormatException]) { 'MALFORMED_RESULT' }
    elseif ($exception -is [Management.Automation.CommandNotFoundException] -or $exception -is [System.ComponentModel.Win32Exception]) { 'API_FAILURE' }
    else { 'UNEXPECTED_EXCEPTION' }
  [ordered]@{
    subprobeId = [string]$script:CurrentSubprobe.id
    probeStage = [string]$script:CurrentSubprobe.stage
    domain = [string]$script:CurrentSubprobe.domain
    typedClass = $typedClass
    exceptionType = $exception.GetType().FullName
    hresult = ('0x{0:X8}' -f ($exception.HResult -band 0xffffffff))
    nativeErrorCode = if ($exception.PSObject.Properties.Name -contains 'NativeErrorCode') { [int]$exception.NativeErrorCode } else { $null }
    fullyQualifiedErrorId = if ([string]::IsNullOrWhiteSpace([string]$Record.FullyQualifiedErrorId)) { $null } else { [string]$Record.FullyQualifiedErrorId }
    category = if ([string]::IsNullOrWhiteSpace([string]$Record.CategoryInfo.Category)) { $null } else { [string]$Record.CategoryInfo.Category }
    toolIdentity = [string]$script:CurrentSubprobe.toolIdentity
    externalToolExitCode = if ($exception.Data.Contains('HERMES_EXTERNAL_TOOL_EXIT_CODE')) { [int]$exception.Data['HERMES_EXTERNAL_TOOL_EXIT_CODE'] } else { $null }
    message = $null
    messageSha256 = Get-Sha256Text ([string]$exception.Message)
  }
}

function New-TerminalPacketBytes([string]$Artifact, [AllowNull()][object]$Observations, [AllowNull()][object]$Failure) {
  $packet = [ordered]@{
    schema = 'hermes-ollama-ownership-source/1'
    artifact = $Artifact
    collectionId = $CollectionId
    startedAt = $script:CollectionStartedAt
    completedAt = (Get-Date).ToUniversalTime().ToString('o')
    collector = [ordered]@{ name = 'diagnose-hermes-ollama-ownership.ps1'; version = '2.0.0'; sha256 = $scriptSha256; readOnly = $true }
    launch = [ordered]@{ nonce = $CollectionId; manifestSha256 = $manifestSha256 }
    hostIdentity = $hostIdentity
    authority = [ordered]@{ elevated = $true; persistentCredential = $false; readOnly = $true; hostMutationAuthorized = $false; hostMutationObserved = $false }
    currentTruthClaim = $Artifact -eq 'HERMES_OLLAMA_OWNERSHIP_OBSERVATION'
  }
  if ($Artifact -eq 'HERMES_OLLAMA_OWNERSHIP_OBSERVATION') { $packet['observations'] = $Observations }
  else {
    $packet['failure'] = $Failure
    $packet['partialObservations'] = @($script:PartialObservations)
  }
  $json = ConvertTo-Json -InputObject $packet -Depth 18
  return ,[Text.UTF8Encoding]::new($false).GetBytes("$json`n")
}

function Write-TerminalPacket([string]$Artifact, [AllowNull()][object]$Observations, [AllowNull()][object]$Failure) {
  $bytes = New-TerminalPacketBytes $Artifact $Observations $Failure
  $stream = New-ElevatedSourceStream $resolvedOutput
  try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
  $expectedSecurity = New-OwnershipFileSystemSecurity $false
  $actualSecurity = (Get-Item -LiteralPath $resolvedOutput -Force).GetAccessControl([Security.AccessControl.AccessControlSections]::Owner -bor [Security.AccessControl.AccessControlSections]::Access)
  if ($actualSecurity.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Owner -bor [Security.AccessControl.AccessControlSections]::Access) `
    -ne $expectedSecurity.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Owner -bor [Security.AccessControl.AccessControlSections]::Access)) {
    throw 'HERMES_OWNERSHIP_SOURCE_FILE_ACL_MISMATCH'
  }
  [IO.File]::SetAttributes($resolvedOutput, [IO.File]::GetAttributes($resolvedOutput) -bor [IO.FileAttributes]::ReadOnly)
}

function Get-ProcessShape([object]$Process) {
  [ordered]@{
    pid = [int]$Process.ProcessId
    ppid = [int]$Process.ParentProcessId
    name = [string]$Process.Name
    exe = Protect-Text ([string]$Process.ExecutablePath)
    command = Get-CommandProjection ([string]$Process.CommandLine)
    createdAt = if ($Process.CreationDate -is [DateTime]) { ([DateTime]$Process.CreationDate).ToUniversalTime().ToString('o') } else { [string]$Process.CreationDate }
  }
}

function Get-ProcessLineage([int]$ProcessId, [object[]]$Processes) {
  $byPid = @{}
  foreach ($process in $Processes) { $byPid[[int]$process.ProcessId] = $process }
  $lineage = [Collections.Generic.List[object]]::new()
  $seen = [Collections.Generic.HashSet[int]]::new()
  $cursor = $ProcessId
  for ($depth = 0; $depth -lt 16 -and $cursor -gt 0 -and $seen.Add($cursor); $depth++) {
    if (-not $byPid.ContainsKey($cursor)) { break }
    $process = $byPid[$cursor]
    $lineage.Add((Get-ProcessShape $process))
    $cursor = [int]$process.ParentProcessId
  }
  return @($lineage)
}

try {
Enter-OwnershipSubprobe 'process.ownership-lineage' 'OBSERVE' 'process' 'Win32_Process/Get-NetTCPConnection'
$allProcesses = @(Get-CimInstance Win32_Process -ErrorAction Stop)
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort 11434 -ErrorAction Stop)
$listenerPids = @($listeners | ForEach-Object { [int]$_.OwningProcess })
$ollamaProcesses = @($allProcesses | Where-Object { $_.Name -match '(?i)^ollama(?:_llama_server)?\.exe$' -or [int]$_.ProcessId -in $listenerPids })

$processEvidence = [ordered]@{
  listeners = @($listeners | ForEach-Object { [ordered]@{ address = [string]$_.LocalAddress; port = [int]$_.LocalPort; pid = [int]$_.OwningProcess; state = [string]$_.State } })
  processes = @($ollamaProcesses | ForEach-Object { [ordered]@{ process = Get-ProcessShape $_; lineage = Get-ProcessLineage ([int]$_.ProcessId) $allProcesses } })
}
$processEvidence = Complete-Subprobe 'process.ownership-lineage' $processEvidence

Enter-OwnershipSubprobe 'task.launch-paths' 'OBSERVE' 'task-scheduler' 'ScheduledTasks'
$allTasks = @(Get-ScheduledTask -ErrorAction Stop)
$taskEvidence = @($allTasks | Where-Object {
  $_.TaskName -eq 'WilliamOS-HERMES-Ollama' -or
  ($_.Actions | Where-Object { (([string]$_.Execute) + ' ' + ([string]$_.Arguments)) -match '(?i)ollama|WilliamOS-HERMES-Ollama' })
} | ForEach-Object {
  $task = $_
  $info = Get-ScheduledTaskInfo -TaskName $task.TaskName -TaskPath $task.TaskPath -ErrorAction Stop
  $xml = Export-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -ErrorAction Stop
  $actions = @($task.Actions | ForEach-Object { [ordered]@{ execute = Protect-Text ([string]$_.Execute); invocation = Get-CommandProjection (([string]$_.Execute) + ' ' + ([string]$_.Arguments)); workingDirectory = Protect-Text ([string]$_.WorkingDirectory) } })
  $directNative = @($actions | Where-Object { $_.invocation.directNativeServe }).Count -gt 0
  $canonical = $task.TaskPath -eq '\' -and $task.TaskName -eq 'WilliamOS-HERMES-Ollama'
  [ordered]@{
    classification = if ($canonical) { 'CANONICAL_OWNER' } elseif ($directNative) { 'UNDECLARED' } else { 'RECOVERY_CALLER' }
    path = [string]$task.TaskPath
    name = [string]$task.TaskName
    state = [string]$task.State
    principal = [ordered]@{ user = [string]$task.Principal.UserId; runLevel = [string]$task.Principal.RunLevel; logonType = [string]$task.Principal.LogonType }
    actions = $actions
    triggers = @($task.Triggers | ForEach-Object { [ordered]@{ type = [string]$_.CimClass.CimClassName; enabled = [bool]$_.Enabled; repetitionInterval = if ($_.Repetition) { [string]$_.Repetition.Interval } else { $null } } })
    lastResult = if ($info) { [int64]$info.LastTaskResult } else { $null }
    lastRunAt = if ($info -and $info.LastRunTime.Year -gt 1900) { $info.LastRunTime.ToUniversalTime().ToString('o') } else { $null }
    nextRunAt = if ($info -and $info.NextRunTime.Year -gt 1900) { $info.NextRunTime.ToUniversalTime().ToString('o') } else { $null }
    xmlSha256 = if ($xml) { $bytes = [Text.Encoding]::UTF8.GetBytes([string]$xml); $sha = [Security.Cryptography.SHA256]::Create(); try { -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) } finally { $sha.Dispose() } } else { $null }
  }
})
$taskEvidence = Complete-Subprobe 'task.launch-paths' ([ordered]@{ tasks = $taskEvidence; bulkErrors = @() })

Enter-OwnershipSubprobe 'service.launch-paths' 'OBSERVE' 'service-control-manager' 'Win32_Service'
$services = @(Get-CimInstance Win32_Service -ErrorAction Stop | Where-Object { ($_.Name + ' ' + $_.DisplayName + ' ' + $_.PathName) -match '(?i)ollama' } | ForEach-Object {
  [ordered]@{ classification = 'UNDECLARED'; name = [string]$_.Name; displayName = [string]$_.DisplayName; state = [string]$_.State; startMode = [string]$_.StartMode; startName = [string]$_.StartName; invocation = Get-CommandProjection ([string]$_.PathName) }
})
$services = Complete-Subprobe 'service.launch-paths' $services
Enter-OwnershipSubprobe 'startup.launch-paths' 'OBSERVE' 'startup' 'Win32_StartupCommand'
$startup = @(Get-CimInstance Win32_StartupCommand -ErrorAction Stop | Where-Object { ($_.Name + ' ' + $_.Command + ' ' + $_.Location) -match '(?i)ollama' } | ForEach-Object {
  [ordered]@{ classification = 'UNDECLARED'; name = [string]$_.Name; invocation = Get-CommandProjection ([string]$_.Command); location = Protect-Text ([string]$_.Location); user = [string]$_.User }
})
$startup = Complete-Subprobe 'startup.launch-paths' $startup

Enter-OwnershipSubprobe 'file.launch-paths' 'OBSERVE' 'filesystem' 'Get-ChildItem/Select-String'
$searchRoots = @('C:\HermesLab', 'C:\ProgramData\WilliamOS') | Where-Object { Test-Path -LiteralPath $_ -PathType Container }
$extensions = @('.ps1', '.psm1', '.cmd', '.bat', '.json', '.yml', '.yaml', '.xml')
$launcherFiles = @()
foreach ($file in @(Get-ChildItem -LiteralPath $searchRoots -Recurse -File -ErrorAction Stop | Where-Object { $_.Extension -in $extensions })) {
  $matches = @(Select-String -LiteralPath $file.FullName -Pattern 'ollama\.exe|ollama\s+serve|WilliamOS-HERMES-Ollama|docker(?:\.exe)?\s+(?:compose\s+up|start|run).*ollama|start-ollama|ollama.*(?:watchdog|recover|restart)' -AllMatches -ErrorAction Stop)
  if ($matches.Count -eq 0) { continue }
  $normalized = $file.FullName.Replace('/', '\')
  $classification = if ($normalized -ieq 'C:\HermesLab\hermes\ollama-service\hermes-ollama-service.ps1') { 'CANONICAL_OWNER' }
    elseif ($normalized -match '(?i)install-hermes-ollama-service\.ps1$') { 'RECOVERY_CALLER' }
    elseif ($normalized -match '(?i)(?:core-online|start-hermes|model-pull|start-ollama|durability)\.ps1$') { 'LEGACY_DISABLED' }
    else { 'UNDECLARED' }
  $launcherFiles += [ordered]@{
    classification = $classification
    path = Protect-Text $file.FullName
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash.ToLowerInvariant()
    matchedLineNumbers = @($matches | ForEach-Object { [int]$_.LineNumber } | Sort-Object -Unique)
  }
}
$launcherFiles = Complete-Subprobe 'file.launch-paths' $launcherFiles

Enter-OwnershipSubprobe 'docker.ownership-signals' 'OBSERVE' 'container-runtime' 'docker.exe'
$docker = & {
  $rows = @(& $dockerExe ps -a --format '{{json .}}' 2>$null)
  if ($LASTEXITCODE -ne 0) { Throw-ProbeFailure 'TOOL_EXIT_NONZERO' 'docker ps failed' $LASTEXITCODE }
  try { $parsedRows = @($rows | ForEach-Object { $_ | ConvertFrom-Json -ErrorAction Stop }) }
  catch { Throw-ProbeFailure 'PARSE_FAILURE' 'docker ps returned malformed JSON' }
  $residents = @($parsedRows | ForEach-Object {
    $row = $_
    $inspectText = @(& $dockerExe inspect $row.ID 2>$null)
    if ($LASTEXITCODE -ne 0) { Throw-ProbeFailure 'TOOL_EXIT_NONZERO' 'docker inspect failed' $LASTEXITCODE }
    try { $inspect = @($inspectText | ConvertFrom-Json -ErrorAction Stop) }
    catch { Throw-ProbeFailure 'PARSE_FAILURE' 'docker inspect returned malformed JSON' }
    if ($inspect.Count -ne 1) { Throw-ProbeFailure 'MALFORMED_RESULT' 'docker inspect result cardinality differs' }
    $item = $inspect[0]
    if (-not (Test-DockerOwnershipSignal $row $item)) { return }
    [ordered]@{
      classification = 'UNDECLARED'
      id = [string]$row.ID
      name = [string]$row.Names
      image = [string]$row.Image
      state = [string]$row.State
      restartPolicy = [string]$item.HostConfig.RestartPolicy.Name
      mounts = @($item.Mounts | ForEach-Object { [ordered]@{ type = [string]$_.Type; source = Protect-Text ([string]$_.Source); destination = Protect-Text ([string]$_.Destination); readWrite = [bool]$_.RW } })
      portBindings = $item.HostConfig.PortBindings
      deviceRequests = $item.HostConfig.DeviceRequests
    }
  })
  [ordered]@{
    coverage = [ordered]@{
      rowsDiscovered = $parsedRows.Count
      rowsInspected = $parsedRows.Count
      candidateCount = $residents.Count
      completeness = 'COMPLETE_OR_PROBE_FAILED'
      signals = @('identity-ollama', 'published-11434', 'bound-11434', 'ollama-service-or-model-mount')
    }
    residents = $residents
  }
}
$docker = Complete-Subprobe 'docker.ownership-signals' $docker

Enter-OwnershipSubprobe 'log.ownership-events' 'OBSERVE' 'logs' 'Get-Content'
$logEvidence = @()
foreach ($logPath in @('C:\ProgramData\WilliamOS\logs\hermes-ollama-service.log', 'C:\ProgramData\WilliamOS\logs\hermes-ollama-serve.log', 'C:\ProgramData\WilliamOS\logs\hermes-ollama-serve.err.log', 'C:\ProgramData\WilliamOS\logs\hermes-ollama-serve.out.log')) {
  if (-not (Test-Path -LiteralPath $logPath -PathType Leaf)) { continue }
  $lines = Get-Content -LiteralPath $logPath -Tail 500 -ErrorAction Stop | Where-Object { $_ -match '(?i)startup|server config|refusing to start|FATAL|serve started pid|serve exited' } | Select-Object -Last 80
  $events = @($lines | ForEach-Object {
    $line = [string]$_
    $pids = @([regex]::Matches($line, '(?i)\bpid(?:=|\s+)(\d+)') | ForEach-Object { [int]$_.Groups[1].Value })
    $allowlistedConfig = [ordered]@{}
    foreach ($name in @('CUDA_VISIBLE_DEVICES', 'OLLAMA_LLM_LIBRARY', 'OLLAMA_NOPRUNE')) {
      $match = [regex]::Match($line, "(?i)${name}(?:=|:)([^,\\s}]+)")
      if ($match.Success) { $allowlistedConfig[$name] = Protect-Text $match.Groups[1].Value }
    }
    [ordered]@{
      lineSha256 = Get-Sha256Text $line
      timestamp = if ($line -match '^(\d{4}-\d{2}-\d{2}T\S+)') { Protect-Text $Matches[1] } else { $null }
      event = if ($line -match '(?i)refusing to start|FATAL') { 'REFUSED_OR_FATAL' } elseif ($line -match '(?i)serve started pid') { 'SERVE_STARTED' } elseif ($line -match '(?i)serve exited') { 'SERVE_EXITED' } elseif ($line -match '(?i)server config') { 'SERVER_CONFIG' } elseif ($line -match '(?i)startup') { 'STARTUP' } else { 'OTHER' }
      pids = $pids
      allowlistedConfig = $allowlistedConfig
    }
  })
  $logEvidence += [ordered]@{ path = $logPath; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $logPath).Hash.ToLowerInvariant(); events = $events }
}
$logEvidence = Complete-Subprobe 'log.ownership-events' $logEvidence

$observations = [ordered]@{
  processEvidence = $processEvidence
  taskEvidence = $taskEvidence
  serviceEvidence = $services
  startupEvidence = $startup
  fileLaunchers = $launcherFiles
  dockerEvidence = $docker
  logEvidence = $logEvidence
}
Write-TerminalPacket 'HERMES_OLLAMA_OWNERSHIP_OBSERVATION' $observations $null
exit 0
} catch {
  $failure = Get-TypedFailure $_
  Write-TerminalPacket 'HERMES_OLLAMA_OWNERSHIP_PROBE_FAILURE' $null $failure
  exit 70
}
