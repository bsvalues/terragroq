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
$supervisorPath = [IO.Path]::GetFullPath($MyInvocation.MyCommand.Path)
$activationPath = Join-Path $RuntimeRoot "control\activation"
$stateDir = Join-Path $RuntimeRoot "state"
$supervisorStatePath = Join-Path $stateDir "supervisor.json"
$runner = Join-Path $workspacePath "scripts\hermes-bridge\run-cycle.ps1"
$mutexName = "Local\WilliamOSHermesCodexBridgeSupervisor"
$createdNew = $false
$mutex = [Threading.Mutex]::new($true, $mutexName, [ref]$createdNew)

if (-not $createdNew) {
    $mutex.Dispose()
    [PSCustomObject]@{ Result = "ALREADY_RUNNING"; HostMode = "INTERACTIVE_USER_RESIDENT" }
    exit 0
}

$CycleAction = if ($null -ne $CycleAction) { $CycleAction } else {
    {
        param([string]$OwnedWorkspace, [string]$OwnedRunner)
        & pwsh.exe -NoLogo -NoProfile -NonInteractive -File $OwnedRunner -Workspace $OwnedWorkspace
        return $LASTEXITCODE
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

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
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

        [void](& $CycleAction $workspacePath $runner)
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
        catch {}
    }
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}

[PSCustomObject]@{
    Result = "STOPPED"
    HostMode = "INTERACTIVE_USER_RESIDENT"
    RejectedIssue357Reused = $false
}
