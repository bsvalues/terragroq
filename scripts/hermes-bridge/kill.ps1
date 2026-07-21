param(
    [string]$Workspace = ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))),
    [string]$StatePath = (Join-Path $HOME ".williamos\hermes-bridge\state\state.json"),
    [string]$ActivationPath = (Join-Path $HOME ".williamos\hermes-bridge\control\activation"),
    [switch]$SkipScheduledTask,
    [scriptblock]$StopProcessAction,
    [scriptblock]$ProcessAliveProbe
)

$ErrorActionPreference = "Stop"
$taskName = "WilliamOS Hermes Codex Bridge"
$StopProcessAction = if ($null -ne $StopProcessAction) { $StopProcessAction } else {
    { param([int]$ProcessId) Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue }
}
$ProcessAliveProbe = if ($null -ne $ProcessAliveProbe) { $ProcessAliveProbe } else {
    { param([int]$ProcessId) $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) }
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ActivationPath) | Out-Null
[IO.File]::WriteAllText($ActivationPath, "disabled`n", [Text.UTF8Encoding]::new($false))

if (-not $SkipScheduledTask) {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($null -ne $task) {
        Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    }
}

$stoppedProcessIds = @()
$ownedCliPath = [IO.Path]::GetFullPath((Join-Path $Workspace "scripts\hermes-bridge\cli.mjs"))

if (Test-Path -LiteralPath $StatePath) {
    $state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
    $activeExecutions = @($state.executions.PSObject.Properties.Value | Where-Object {
        $_.lease.status -eq "ACTIVE" -and -not [string]::IsNullOrWhiteSpace($_.lease.holderId)
    })

    foreach ($execution in $activeExecutions) {
        if ($execution.lease.holderId -notmatch '^([^:]+):(\d+):[0-9a-fA-F-]{36}$') {
            throw "HERMES_KILL_HOLDER_ID_WALL"
        }

        if ($Matches[1] -ne [System.Net.Dns]::GetHostName()) {
            throw "HERMES_KILL_FOREIGN_HOST_WALL"
        }

        $holderPid = [int]$Matches[2]
        $processes = @(Get-CimInstance Win32_Process)
        $holder = $processes | Where-Object ProcessId -eq $holderPid | Select-Object -First 1
        if ($null -eq $holder) { continue }

        $commandLine = [string]$holder.CommandLine
        if ([string]::IsNullOrWhiteSpace($commandLine)) {
            throw "HERMES_KILL_OWNERSHIP_WALL"
        }
        $normalizedCommand = $commandLine.Replace('/', '\')
        $normalizedCliPath = $ownedCliPath.Replace('/', '\')
        $escapedCliPath = [Regex]::Escape($normalizedCliPath)
        if ($holder.Name -notin @("node.exe", "node") -or
            $normalizedCommand -notmatch "(?i)(?:`"|\s)$escapedCliPath(?:`"|\s)" -or
            $normalizedCommand -notmatch '(?i)\s+cycle(?:\s|$)') {
            throw "HERMES_KILL_OWNERSHIP_WALL"
        }

        $childrenByParent = @{}
        foreach ($process in $processes) {
            $parent = [int]$process.ParentProcessId
            if (-not $childrenByParent.ContainsKey($parent)) { $childrenByParent[$parent] = @() }
            $childrenByParent[$parent] += $process
        }

        $ownedTree = [Collections.Generic.List[object]]::new()
        function Add-OwnedDescendants([int]$ParentPid, [int]$Depth) {
            if (-not $childrenByParent.ContainsKey($ParentPid)) { return }
            foreach ($child in $childrenByParent[$ParentPid]) {
                $ownedTree.Add([PSCustomObject]@{ Process = $child; Depth = $Depth })
                Add-OwnedDescendants -ParentPid ([int]$child.ProcessId) -Depth ($Depth + 1)
            }
        }

        Add-OwnedDescendants -ParentPid $holderPid -Depth 1
        $ownedTree.Add([PSCustomObject]@{ Process = $holder; Depth = 0 })

        foreach ($entry in $ownedTree | Sort-Object Depth -Descending) {
            $pidToStop = [int]$entry.Process.ProcessId
            & $StopProcessAction $pidToStop
            if (& $ProcessAliveProbe $pidToStop) {
                throw "HERMES_KILL_PROCESS_SURVIVED_WALL"
            }
            $stoppedProcessIds += $pidToStop
        }
    }
}

[PSCustomObject]@{
    TaskName = $taskName
    Activation = "disabled"
    StopRequested = $true
    StoppedProcessIds = @($stoppedProcessIds | Sort-Object -Unique)
}
