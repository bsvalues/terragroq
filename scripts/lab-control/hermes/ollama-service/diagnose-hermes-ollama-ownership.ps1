param(
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [Parameter(Mandatory = $true)][string]$ExpectedScriptSha256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'HERMES_1046_ELEVATION_REQUIRED'
}
$scriptSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $PSCommandPath).Hash.ToLowerInvariant()
if ($scriptSha256 -ne $ExpectedScriptSha256.ToLowerInvariant()) {
  throw 'HERMES_1046_SCRIPT_DIGEST_MISMATCH'
}
$resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
$allowedOutputDirectory = 'C:\Users\bs\Documents\Codex\2026-08-27\yes-i-did-not-send-this\outputs\hermes-1046-ownership-diagnostic'
$allowedOutput = Join-Path $allowedOutputDirectory 'hermes-1046-ownership-diagnostic.json'
$outputDigestPath = "$allowedOutput.sha256"
if ($resolvedOutput -ine $allowedOutput) { throw 'HERMES_1046_OUTPUT_NOT_DEDICATED' }
if ([IO.File]::Exists($resolvedOutput) -or [IO.File]::Exists($outputDigestPath)) { throw 'HERMES_1046_OUTPUT_EXISTS' }
if (-not [IO.Directory]::Exists($allowedOutputDirectory)) { throw 'HERMES_1046_OUTPUT_PARENT_MISSING' }
$outputDirectoryInfo = Get-Item -LiteralPath $allowedOutputDirectory -Force
if (($outputDirectoryInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'HERMES_1046_OUTPUT_REPARSE_REFUSED' }

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

function Get-Sha256Text([AllowNull()][string]$Value) {
  $bytes = [Text.Encoding]::UTF8.GetBytes([string]$Value)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) } finally { $sha.Dispose() }
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

function Error-Shape([Management.Automation.ErrorRecord]$Record) {
  [ordered]@{
    exceptionType = $Record.Exception.GetType().FullName
    messageSha256 = Get-Sha256Text ([string]$Record.Exception.Message)
    fullyQualifiedErrorId = [string]$Record.FullyQualifiedErrorId
    category = [string]$Record.CategoryInfo.Category
    hresult = ('0x{0:X8}' -f ($Record.Exception.HResult -band 0xffffffff))
    nativeErrorCode = if ($Record.Exception.PSObject.Properties.Name -contains 'NativeErrorCode') { [int]$Record.Exception.NativeErrorCode } else { $null }
  }
}

function Invoke-Probe([string]$Name, [scriptblock]$Body) {
  try { [ordered]@{ name = $Name; status = 'SUCCESS'; value = (& $Body); error = $null } }
  catch { [ordered]@{ name = $Name; status = 'FAILED'; value = $null; error = Error-Shape $_ } }
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

$allProcesses = @(Get-CimInstance Win32_Process -ErrorAction Stop)
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort 11434 -ErrorAction SilentlyContinue)
$listenerPids = @($listeners | ForEach-Object { [int]$_.OwningProcess })
$ollamaProcesses = @($allProcesses | Where-Object { $_.Name -match '(?i)^ollama(?:_llama_server)?\.exe$' -or [int]$_.ProcessId -in $listenerPids })

$processEvidence = [ordered]@{
  listeners = @($listeners | ForEach-Object { [ordered]@{ address = [string]$_.LocalAddress; port = [int]$_.LocalPort; pid = [int]$_.OwningProcess; state = [string]$_.State } })
  processes = @($ollamaProcesses | ForEach-Object { [ordered]@{ process = Get-ProcessShape $_; lineage = Get-ProcessLineage ([int]$_.ProcessId) $allProcesses } })
}

$taskErrors = @()
$allTasks = @(Get-ScheduledTask -ErrorAction SilentlyContinue -ErrorVariable +taskErrors)
$taskEvidence = @($allTasks | Where-Object {
  $_.TaskName -eq 'WilliamOS-HERMES-Ollama' -or
  ($_.Actions | Where-Object { (([string]$_.Execute) + ' ' + ([string]$_.Arguments)) -match '(?i)ollama|WilliamOS-HERMES-Ollama' })
} | ForEach-Object {
  $task = $_
  $info = Get-ScheduledTaskInfo -TaskName $task.TaskName -TaskPath $task.TaskPath -ErrorAction SilentlyContinue
  $xml = Export-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -ErrorAction SilentlyContinue
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

$services = @(Get-CimInstance Win32_Service -ErrorAction Stop | Where-Object { ($_.Name + ' ' + $_.DisplayName + ' ' + $_.PathName) -match '(?i)ollama' } | ForEach-Object {
  [ordered]@{ classification = 'UNDECLARED'; name = [string]$_.Name; displayName = [string]$_.DisplayName; state = [string]$_.State; startMode = [string]$_.StartMode; startName = [string]$_.StartName; invocation = Get-CommandProjection ([string]$_.PathName) }
})
$startup = @(Get-CimInstance Win32_StartupCommand -ErrorAction Stop | Where-Object { ($_.Name + ' ' + $_.Command + ' ' + $_.Location) -match '(?i)ollama' } | ForEach-Object {
  [ordered]@{ classification = 'UNDECLARED'; name = [string]$_.Name; invocation = Get-CommandProjection ([string]$_.Command); location = Protect-Text ([string]$_.Location); user = [string]$_.User }
})

$searchRoots = @('C:\HermesLab', 'C:\ProgramData\WilliamOS') | Where-Object { Test-Path -LiteralPath $_ -PathType Container }
$extensions = @('.ps1', '.psm1', '.cmd', '.bat', '.json', '.yml', '.yaml', '.xml')
$launcherFiles = @()
foreach ($file in @(Get-ChildItem -LiteralPath $searchRoots -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in $extensions })) {
  $matches = @(Select-String -LiteralPath $file.FullName -Pattern 'ollama\.exe|ollama\s+serve|WilliamOS-HERMES-Ollama|docker(?:\.exe)?\s+(?:compose\s+up|start|run).*ollama|start-ollama|ollama.*(?:watchdog|recover|restart)' -AllMatches -ErrorAction SilentlyContinue)
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

$docker = Invoke-Probe 'docker-ollama-residents' {
  $dockerExe = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
  $rows = @(& $dockerExe ps -a --format '{{json .}}' 2>$null)
  if ($LASTEXITCODE -ne 0) { throw "docker ps exit=$LASTEXITCODE" }
  $parsedRows = @($rows | ForEach-Object { $_ | ConvertFrom-Json })
  $residents = @($parsedRows | ForEach-Object {
    $row = $_
    $inspect = @(& $dockerExe inspect $row.ID 2>$null | ConvertFrom-Json)
    if ($LASTEXITCODE -ne 0 -or $inspect.Count -ne 1) { throw "docker inspect failed id=$($row.ID)" }
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

$logEvidence = @()
foreach ($logPath in @('C:\ProgramData\WilliamOS\logs\hermes-ollama-service.log', 'C:\ProgramData\WilliamOS\logs\hermes-ollama-serve.log', 'C:\ProgramData\WilliamOS\logs\hermes-ollama-serve.err.log', 'C:\ProgramData\WilliamOS\logs\hermes-ollama-serve.out.log')) {
  if (-not (Test-Path -LiteralPath $logPath -PathType Leaf)) { continue }
  $lines = Get-Content -LiteralPath $logPath -Tail 500 -ErrorAction SilentlyContinue | Where-Object { $_ -match '(?i)startup|server config|refusing to start|FATAL|serve started pid|serve exited' } | Select-Object -Last 80
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

$packet = [ordered]@{
  schema = 'hermes-ollama-ownership-diagnostic/1'
  artifact = 'HERMES_1046_READ_ONLY_OWNERSHIP_INVENTORY'
  collectedAt = (Get-Date).ToUniversalTime().ToString('o')
  authority = [ordered]@{ elevated = $true; scriptSha256 = $scriptSha256; mutationAllowed = $false }
  processEvidence = $processEvidence
  taskEvidence = [ordered]@{ tasks = $taskEvidence; bulkErrors = @($taskErrors | ForEach-Object { Error-Shape $_ }) }
  serviceEvidence = $services
  startupEvidence = $startup
  fileLaunchers = $launcherFiles
  dockerEvidence = $docker
  logEvidence = $logEvidence
}

$json = $packet | ConvertTo-Json -Depth 16
$bytes = [Text.UTF8Encoding]::new($false).GetBytes("$json`n")
$stream = [IO.FileStream]::new($resolvedOutput, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
$packetSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedOutput).Hash.ToLowerInvariant()
$digestBytes = [Text.UTF8Encoding]::new($false).GetBytes("$packetSha256  $([IO.Path]::GetFileName($resolvedOutput))`n")
$digestStream = [IO.FileStream]::new($outputDigestPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
try { $digestStream.Write($digestBytes, 0, $digestBytes.Length); $digestStream.Flush($true) } finally { $digestStream.Dispose() }
[IO.File]::SetAttributes($resolvedOutput, [IO.File]::GetAttributes($resolvedOutput) -bor [IO.FileAttributes]::ReadOnly)
[IO.File]::SetAttributes($outputDigestPath, [IO.File]::GetAttributes($outputDigestPath) -bor [IO.FileAttributes]::ReadOnly)
