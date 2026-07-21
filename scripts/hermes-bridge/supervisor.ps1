param(
    [string]$Workspace = "C:\Users\bsval\william-os-devops",
    [string]$RuntimeRoot = (Join-Path $HOME ".williamos\hermes-bridge"),
    [ValidateRange(1, 3600)][int]$CycleIntervalSeconds = 300,
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
$logDir = Join-Path $runtimeRootPath "logs"
$supervisorLogPath = Join-Path $logDir ("supervisor-{0}.log" -f (Get-Date -Format "yyyyMMdd"))
$cliPath = Join-Path $workspacePath "scripts\hermes-bridge\cli.mjs"
$envPath = Join-Path $workspacePath ".env.local"
$mutexName = "Global\WilliamOSHermesCodexBridgeSupervisor"
$createdNew = $false
$mutex = [Threading.Mutex]::new($true, $mutexName, [ref]$createdNew)

if (-not $createdNew) {
    $mutex.Dispose()
    [PSCustomObject]@{ Result = "ALREADY_RUNNING"; HostMode = "INTERACTIVE_USER_RESIDENT" }
    exit 0
}

$CycleAction = if ($null -ne $CycleAction) { $CycleAction } else {
    {
        param([string]$OwnedWorkspace, [string]$OwnedCliPath, [string]$OwnedRuntimeRoot)
        $env:WILLIAMOS_HERMES_RUNTIME_ROOT = $OwnedRuntimeRoot
        $ownedCycleExitCode = 1
        Push-Location $OwnedWorkspace
        try {
            $cycleLogPath = Join-Path $logDir ("cycle-{0}.log" -f (Get-Date -Format "yyyyMMdd"))
            & node "--env-file=$envPath" $OwnedCliPath cycle *>> $cycleLogPath
            $ownedCycleExitCode = $LASTEXITCODE
        }
        finally {
            Pop-Location
        }
        return $ownedCycleExitCode
    }
}
$SleepAction = if ($null -ne $SleepAction) { $SleepAction } else {
    { param([int]$Seconds) Start-Sleep -Seconds $Seconds }
}

$nonce = [Guid]::NewGuid().ToString()
$record = [ordered]@{
    schemaVersion = 1
    hostName = [System.Net.Dns]::GetHostName()
    processId = $PID
    nonce = $nonce
    workspace = $workspacePath
    supervisorPath = $supervisorPath
    hostMode = "INTERACTIVE_USER_RESIDENT"
    startedAt = [DateTimeOffset]::UtcNow.ToString("o")
}

New-Item -ItemType Directory -Force -Path $stateDir, $logDir | Out-Null
$temporaryStatePath = "$supervisorStatePath.$nonce.tmp"

try {
    [IO.File]::WriteAllText(
        $temporaryStatePath,
        (($record | ConvertTo-Json -Depth 4) + "`n"),
        [Text.UTF8Encoding]::new($false)
    )
    Move-Item -LiteralPath $temporaryStatePath -Destination $supervisorStatePath -Force

    do {
        if (-not (Test-Path -LiteralPath $activationPath) -or
            (Get-Content -LiteralPath $activationPath -Raw).Trim() -ne "enabled") {
            break
        }

        try {
            $cycleExitCode = [int](& $CycleAction $workspacePath $cliPath $runtimeRootPath)
        }
        catch {
            $cycleExitCode = 1
            [IO.File]::AppendAllText(
                $supervisorLogPath,
                "$( [DateTimeOffset]::UtcNow.ToString('o') ) HERMES_SUPERVISOR_CYCLE_EXCEPTION`n",
                [Text.UTF8Encoding]::new($false)
            )
        }
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
    Remove-Item -LiteralPath $temporaryStatePath -Force -ErrorAction SilentlyContinue
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
