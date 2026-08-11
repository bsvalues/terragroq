param(
    [string]$Workspace = "C:\Users\bsval\william-os-devops",
    [string]$RuntimeRoot = (Join-Path $HOME ".williamos\hermes-bridge"),
    [ValidateRange(1, 3600)][int]$CycleIntervalSeconds = 300,
    [ValidateRange(1, 14400)][int]$CycleBudgetSeconds = 3600,
    [ValidateRange(1, 300)][int]$HeartbeatIntervalSeconds = 30,
    [switch]$RunOnce,
    [scriptblock]$CycleAction,
    [scriptblock]$SleepAction
)

$ErrorActionPreference = "Stop"
$workspacePath = [IO.Path]::GetFullPath($Workspace)
$runtimeRootPath = [IO.Path]::GetFullPath($RuntimeRoot)
$supervisorPath = [IO.Path]::GetFullPath($MyInvocation.MyCommand.Path)
$activationPath = Join-Path $runtimeRootPath "control\activation"
$stateDir = Join-Path $runtimeRootPath "state"
$supervisorStatePath = Join-Path $stateDir "supervisor.json"
$campaignWindowPath = Join-Path $stateDir "campaign-window"
$logDir = Join-Path $runtimeRootPath "logs"
$supervisorLogPath = Join-Path $logDir ("supervisor-{0}.log" -f (Get-Date -Format "yyyyMMdd"))
$cliPath = Join-Path $workspacePath "scripts\hermes-bridge\cli.mjs"
$envPath = Join-Path $workspacePath ".env.local"
$nodeCommand = try {
    Get-Command node -CommandType Application -All -ErrorAction Stop |
        Select-Object -First 1
}
catch {
    $null
}
if ($null -eq $nodeCommand) {
    throw "HERMES_SUPERVISOR_NODE_EXECUTABLE_WALL"
}
$nodePath = [IO.Path]::GetFullPath($nodeCommand.Source)
if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
    throw "HERMES_SUPERVISOR_NODE_EXECUTABLE_WALL"
}
$mutexName = "Global\WilliamOSHermesCodexBridgeSupervisor"
$createdNew = $false
$mutex = [Threading.Mutex]::new($true, $mutexName, [ref]$createdNew)

function ConvertTo-SupervisorToken {
    param(
        [AllowNull()][object]$Value,
        [AllowNull()][string]$Fallback = $null
    )

    $candidate = if ($null -eq $Value) { $null } else { [string]$Value }
    if ($null -ne $candidate -and $candidate -cmatch '^[A-Z][A-Z0-9_]{0,63}$') {
        return $candidate
    }
    return $Fallback
}

function Write-SupervisorState {
    param(
        [Parameter(Mandatory)][System.Collections.IDictionary]$Record,
        [Parameter(Mandatory)][string]$Destination,
        [Parameter(Mandatory)][string]$Nonce
    )

    $temporary = "$Destination.$Nonce.$([Guid]::NewGuid().ToString('N')).tmp"
    try {
        [IO.File]::WriteAllText(
            $temporary,
            (($Record | ConvertTo-Json -Depth 6) + "`n"),
            [Text.UTF8Encoding]::new($false)
        )
        if (Test-Path -LiteralPath $Destination) {
            $backup = "$Destination.$Nonce.backup"
            [IO.File]::Replace($temporary, $Destination, $backup, $true)
            Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
        }
        else {
            [IO.File]::Move($temporary, $Destination)
        }
    }
    finally {
        Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    }
}

function Read-CampaignWindowId {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "HERMES_CAMPAIGN_WINDOW_MISSING"
    }
    $value = [IO.File]::ReadAllText($Path, [Text.UTF8Encoding]::new($false)).Trim()
    if ($value -cnotmatch '\Acampaign:[0-9a-f]{32}\z') {
        throw "HERMES_CAMPAIGN_WINDOW_INVALID"
    }
    return $value
}

function Get-OrCreate-CampaignWindowId {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Nonce
    )

    if (Test-Path -LiteralPath $Path) {
        return Read-CampaignWindowId -Path $Path
    }
    $candidate = "campaign:$([Guid]::NewGuid().ToString('N'))"
    $temporary = "$Path.$Nonce.$([Guid]::NewGuid().ToString('N')).tmp"
    try {
        [IO.File]::WriteAllText($temporary, $candidate, [Text.UTF8Encoding]::new($false))
        try {
            [IO.File]::Move($temporary, $Path)
        }
        catch [IO.IOException] {
            if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw }
        }
        return Read-CampaignWindowId -Path $Path
    }
    finally {
        if (Test-Path -LiteralPath $temporary) {
            Remove-Item -LiteralPath $temporary -Force
        }
    }
}

function Add-CycleLog {
    param(
        [Parameter(Mandatory)][string]$Path,
        [AllowNull()][string]$Content
    )

    if ([string]::IsNullOrEmpty($Content)) { return }
    [IO.File]::AppendAllText(
        $Path,
        ($Content.TrimEnd("`r", "`n") + "`n"),
        [Text.UTF8Encoding]::new($false)
    )
}

function Get-CycleEnvelope {
    param(
        [Parameter(Mandatory)][int]$ExitCode,
        [AllowNull()][object[]]$Output
    )

    $candidate = $null
    for ($index = $Output.Count - 1; $index -ge 0; $index--) {
        try {
            $parsed = ([string]$Output[$index]) | ConvertFrom-Json -ErrorAction Stop
            if ($null -ne $parsed.result) {
                $candidate = $parsed
                break
            }
        }
        catch {
            continue
        }
    }
    $resultFallback = if ($ExitCode -eq 0) { "SUCCESS" } else { "FAILED" }
    $stopFallback = if ($ExitCode -eq 0) { $null } else { "CYCLE_EXIT_NONZERO" }
    $stopCandidate = if ($null -ne $candidate.stopReason) { $candidate.stopReason } else { $candidate.code }
    return [PSCustomObject]@{
        ExitCode = $ExitCode
        Result = ConvertTo-SupervisorToken -Value $candidate.result -Fallback $resultFallback
        StopReason = ConvertTo-SupervisorToken -Value $stopCandidate -Fallback $stopFallback
    }
}

function Invoke-OwnedNodeCycle {
    param(
        [Parameter(Mandatory)][string]$OwnedWorkspace,
        [Parameter(Mandatory)][string]$OwnedNodePath,
        [Parameter(Mandatory)][string]$OwnedCliPath,
        [Parameter(Mandatory)][string]$OwnedRuntimeRoot,
        [Parameter(Mandatory)][string]$OwnedEnvPath,
        [Parameter(Mandatory)][string]$CampaignWindowId,
        [Parameter(Mandatory)][string]$ProcessIdentity,
        [Parameter(Mandatory)][string]$CycleLogPath,
        [Parameter(Mandatory)][int]$BudgetMilliseconds,
        [Parameter(Mandatory)][int]$PulseMilliseconds,
        [Parameter(Mandatory)][scriptblock]$Pulse
    )

    $process = $null
    $processStarted = $false
    try {
        $startInfo = [Diagnostics.ProcessStartInfo]::new()
        $startInfo.FileName = $OwnedNodePath
        $startInfo.WorkingDirectory = $OwnedWorkspace
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true
        $startInfo.Environment["WILLIAMOS_HERMES_RUNTIME_ROOT"] = $OwnedRuntimeRoot
        $startInfo.Environment["HERMES_CAMPAIGN_WINDOW_ID"] = $CampaignWindowId
        $startInfo.Environment["HERMES_PROCESS_IDENTITY"] = $ProcessIdentity
        $startInfo.ArgumentList.Add("--env-file=$OwnedEnvPath")
        $startInfo.ArgumentList.Add($OwnedCliPath)
        $startInfo.ArgumentList.Add("cycle")
        $process = [Diagnostics.Process]::new()
        $process.StartInfo = $startInfo
        if (-not $process.Start()) { throw "HERMES_SUPERVISOR_CYCLE_START_FAILED" }
        $processStarted = $true
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $deadline = [DateTimeOffset]::UtcNow.AddMilliseconds($BudgetMilliseconds)
        while (-not $process.HasExited) {
            $remaining = [Math]::Max(1, [int][Math]::Ceiling(
                ($deadline - [DateTimeOffset]::UtcNow).TotalMilliseconds
            ))
            $waitMilliseconds = [Math]::Min($PulseMilliseconds, $remaining)
            if ($process.WaitForExit($waitMilliseconds)) { break }
            & $Pulse
            if ([DateTimeOffset]::UtcNow -ge $deadline) {
                $process.Kill($true)
                $process.WaitForExit()
                Add-CycleLog -Path $CycleLogPath -Content $stdout.GetAwaiter().GetResult()
                Add-CycleLog -Path $CycleLogPath -Content $stderr.GetAwaiter().GetResult()
                return [PSCustomObject]@{
                    ExitCode = 124
                    Result = "WALL"
                    StopReason = "CYCLE_BUDGET_EXCEEDED"
                }
            }
        }
        $stdoutText = $stdout.GetAwaiter().GetResult()
        $stderrText = $stderr.GetAwaiter().GetResult()
        Add-CycleLog -Path $CycleLogPath -Content $stdoutText
        Add-CycleLog -Path $CycleLogPath -Content $stderrText
        return Get-CycleEnvelope -ExitCode $process.ExitCode -Output @(
            $stdoutText -split "\r?\n" | Where-Object { $_ -ne "" }
        )
    }
    finally {
        if ($null -ne $process) {
            if ($processStarted -and -not $process.HasExited) {
                $process.Kill($true)
                $process.WaitForExit()
            }
            $process.Dispose()
        }
    }
}

function Invoke-OwnedCustomCycle {
    param(
        [Parameter(Mandatory)][scriptblock]$Action,
        [Parameter(Mandatory)][object[]]$Arguments,
        [Parameter(Mandatory)][int]$BudgetMilliseconds,
        [Parameter(Mandatory)][int]$PulseMilliseconds,
        [Parameter(Mandatory)][scriptblock]$Pulse
    )

    $pipeline = [PowerShell]::Create()
    try {
        $null = $pipeline.AddScript($Action.ToString())
        foreach ($argument in $Arguments) { $null = $pipeline.AddArgument($argument) }
        $pending = $pipeline.BeginInvoke()
        $deadline = [DateTimeOffset]::UtcNow.AddMilliseconds($BudgetMilliseconds)
        while (-not $pending.IsCompleted) {
            $remaining = [Math]::Max(1, [int][Math]::Ceiling(
                ($deadline - [DateTimeOffset]::UtcNow).TotalMilliseconds
            ))
            $waitMilliseconds = [Math]::Min($PulseMilliseconds, $remaining)
            if ($pending.AsyncWaitHandle.WaitOne($waitMilliseconds)) { break }
            & $Pulse
            if ([DateTimeOffset]::UtcNow -ge $deadline) {
                $pipeline.Stop()
                return [PSCustomObject]@{
                    ExitCode = 124
                    Result = "WALL"
                    StopReason = "CYCLE_BUDGET_EXCEEDED"
                }
            }
        }
        $output = @($pipeline.EndInvoke($pending))
        if ($pipeline.HadErrors) { throw "HERMES_SUPERVISOR_CUSTOM_CYCLE_FAILED" }
        if ($output.Count -eq 0) { throw "HERMES_SUPERVISOR_CUSTOM_CYCLE_RESULT_MISSING" }
        $candidate = $output[-1]
        if ($candidate -is [int] -or $candidate -is [long]) {
            return Get-CycleEnvelope -ExitCode ([int]$candidate) -Output @()
        }
        if ($null -eq $candidate.ExitCode) { throw "HERMES_SUPERVISOR_CUSTOM_CYCLE_RESULT_INVALID" }
        $candidateExitCode = [int]$candidate.ExitCode
        $resultFallback = if ($candidateExitCode -eq 0) { "SUCCESS" } else { "FAILED" }
        $stopFallback = if ($candidateExitCode -eq 0) { $null } else { "CYCLE_EXIT_NONZERO" }
        return [PSCustomObject]@{
            ExitCode = $candidateExitCode
            Result = ConvertTo-SupervisorToken -Value $candidate.Result -Fallback $resultFallback
            StopReason = ConvertTo-SupervisorToken -Value $candidate.StopReason -Fallback $stopFallback
        }
    }
    finally {
        $pipeline.Dispose()
    }
}

if (-not $createdNew) {
    $mutex.Dispose()
    [PSCustomObject]@{ Result = "ALREADY_RUNNING"; HostMode = "INTERACTIVE_USER_RESIDENT" }
    exit 0
}
$customCycleAction = $CycleAction
$SleepAction = if ($null -ne $SleepAction) { $SleepAction } else {
    { param([int]$Seconds) Start-Sleep -Seconds $Seconds }
}

New-Item -ItemType Directory -Force -Path $stateDir, $logDir | Out-Null

$nonce = [Guid]::NewGuid().ToString()
$campaignWindowId = Get-OrCreate-CampaignWindowId -Path $campaignWindowPath -Nonce $nonce
$record = [ordered]@{
    schemaVersion = 2
    hostName = [System.Net.Dns]::GetHostName()
    processId = $PID
    nonce = $nonce
    campaignWindowId = $campaignWindowId
    workspace = $workspacePath
    supervisorPath = $supervisorPath
    hostMode = "INTERACTIVE_USER_RESIDENT"
    startedAt = [DateTimeOffset]::UtcNow.ToString("o")
    heartbeatAt = [DateTimeOffset]::UtcNow.ToString("o")
    cycleBudgetMs = $CycleBudgetSeconds * 1000
    cycle = [ordered]@{
        sequence = 0
        status = "STARTING"
        startedAt = $null
        completedAt = $null
        result = $null
        stopReason = $null
        exitCode = $null
        consecutiveFailures = 0
    }
}

try {
    Write-SupervisorState -Record $record -Destination $supervisorStatePath -Nonce $nonce

    do {
        if (-not (Test-Path -LiteralPath $activationPath) -or
            (Get-Content -LiteralPath $activationPath -Raw).Trim() -ne "enabled") {
            break
        }

        $cycleStartedAt = [DateTimeOffset]::UtcNow.ToString("o")
        $record.heartbeatAt = $cycleStartedAt
        $record.cycle.sequence = [int]$record.cycle.sequence + 1
        $record.cycle.status = "IN_FLIGHT"
        $record.cycle.startedAt = $cycleStartedAt
        $record.cycle.completedAt = $null
        $record.cycle.result = $null
        $record.cycle.stopReason = $null
        $record.cycle.exitCode = $null
        Write-SupervisorState -Record $record -Destination $supervisorStatePath -Nonce $nonce

        $cycleLogPath = Join-Path $logDir ("cycle-{0}.log" -f (Get-Date -Format "yyyyMMdd"))
        $pulseAction = {
            $record.heartbeatAt = [DateTimeOffset]::UtcNow.ToString("o")
            Write-SupervisorState -Record $record -Destination $supervisorStatePath -Nonce $nonce
        }
        try {
            if ($null -ne $customCycleAction) {
                $cycleEnvelope = Invoke-OwnedCustomCycle `
                    -Action $customCycleAction `
                    -Arguments @($workspacePath, $cliPath, $runtimeRootPath, $campaignWindowId, $nonce) `
                    -BudgetMilliseconds ($CycleBudgetSeconds * 1000) `
                    -PulseMilliseconds ($HeartbeatIntervalSeconds * 1000) `
                    -Pulse $pulseAction
            }
            else {
                $cycleEnvelope = Invoke-OwnedNodeCycle `
                    -OwnedWorkspace $workspacePath `
                    -OwnedNodePath $nodePath `
                    -OwnedCliPath $cliPath `
                    -OwnedRuntimeRoot $runtimeRootPath `
                    -OwnedEnvPath $envPath `
                    -CampaignWindowId $campaignWindowId `
                    -ProcessIdentity $nonce `
                    -CycleLogPath $cycleLogPath `
                    -BudgetMilliseconds ($CycleBudgetSeconds * 1000) `
                    -PulseMilliseconds ($HeartbeatIntervalSeconds * 1000) `
                    -Pulse $pulseAction
            }
            $cycleExitCode = [int]$cycleEnvelope.ExitCode
            $cycleResult = $cycleEnvelope.Result
            $cycleStopReason = $cycleEnvelope.StopReason
        }
        catch {
            $cycleExitCode = 1
            $cycleResult = "WALL"
            $cycleStopReason = "CYCLE_EXCEPTION"
            [IO.File]::AppendAllText(
                $supervisorLogPath,
                "$( [DateTimeOffset]::UtcNow.ToString('o') ) HERMES_SUPERVISOR_CYCLE_EXCEPTION type=$($_.Exception.GetType().Name)`n",
                [Text.UTF8Encoding]::new($false)
            )
        }
        $cycleCompletedAt = [DateTimeOffset]::UtcNow.ToString("o")
        $record.heartbeatAt = $cycleCompletedAt
        $record.cycle.status = "IDLE"
        $record.cycle.completedAt = $cycleCompletedAt
        $record.cycle.result = $cycleResult
        $record.cycle.stopReason = $cycleStopReason
        $record.cycle.exitCode = $cycleExitCode
        $record.cycle.consecutiveFailures = if ($cycleExitCode -eq 0) {
            0
        } else {
            [int]$record.cycle.consecutiveFailures + 1
        }
        Write-SupervisorState -Record $record -Destination $supervisorStatePath -Nonce $nonce
        if ($cycleExitCode -ne 0) {
            [IO.File]::AppendAllText(
                $supervisorLogPath,
                "$( [DateTimeOffset]::UtcNow.ToString('o') ) HERMES_SUPERVISOR_CYCLE_FAILED exitCode=$cycleExitCode`n",
                [Text.UTF8Encoding]::new($false)
            )
        }
        if ($RunOnce) { break }

        for ($elapsed = 0; $elapsed -lt $CycleIntervalSeconds; $elapsed++) {
            if (-not (Test-Path -LiteralPath $activationPath) -or
                (Get-Content -LiteralPath $activationPath -Raw).Trim() -ne "enabled") {
                break
            }
            & $SleepAction 1
        }
    } while ((Test-Path -LiteralPath $activationPath) -and
        (Get-Content -LiteralPath $activationPath -Raw).Trim() -eq "enabled")
}
finally {
    if (Test-Path -LiteralPath $supervisorStatePath) {
        try {
            $current = Get-Content -LiteralPath $supervisorStatePath -Raw | ConvertFrom-Json
            if ($current.nonce -eq $nonce -and [int]$current.processId -eq $PID) {
                Remove-Item -LiteralPath $supervisorStatePath -Force
            }
        }
        catch {
            [IO.File]::AppendAllText(
                $supervisorLogPath,
                "$( [DateTimeOffset]::UtcNow.ToString('o') ) HERMES_SUPERVISOR_STATE_CLEANUP_FAILED`n",
                [Text.UTF8Encoding]::new($false)
            )
        }
    }
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}

[PSCustomObject]@{
    Result = "STOPPED"
    HostMode = "INTERACTIVE_USER_RESIDENT"
    RejectedIssue357Reused = $false
}
