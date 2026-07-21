param(
    [string]$Workspace = ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))),
    [string]$StatePath = (Join-Path $HOME ".williamos\hermes-bridge\state\state.json"),
    [string]$SupervisorStatePath = (Join-Path $HOME ".williamos\hermes-bridge\state\supervisor.json"),
    [string]$ActivationPath = (Join-Path $HOME ".williamos\hermes-bridge\control\activation"),
    [string]$OwnedCliPath = ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot "cli.mjs"))),
    [string]$OwnedSupervisorPath = ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot "supervisor.ps1"))),
    [switch]$SkipScheduledTask,
    [switch]$SkipSupervisor,
    [scriptblock]$StopProcessAction
)

$ErrorActionPreference = "Stop"
$taskName = "WilliamOS Hermes Codex Bridge"
$StopProcessAction = if ($null -ne $StopProcessAction) { $StopProcessAction } else {
    { param([int]$ProcessId) Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue }
}

if ($null -eq ("HermesNativeCommandLine" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class HermesNativeCommandLine {
    [DllImport("shell32.dll", SetLastError = true)]
    private static extern IntPtr CommandLineToArgvW(
        [MarshalAs(UnmanagedType.LPWStr)] string commandLine,
        out int argumentCount);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr pointer);

    public static string[] Split(string commandLine) {
        int argumentCount;
        IntPtr argumentPointer = CommandLineToArgvW(commandLine, out argumentCount);
        if (argumentPointer == IntPtr.Zero) throw new Win32Exception();
        try {
            string[] arguments = new string[argumentCount];
            for (int index = 0; index < argumentCount; index++) {
                arguments[index] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(argumentPointer, index * IntPtr.Size));
            }
            return arguments;
        }
        finally { LocalFree(argumentPointer); }
    }
}
"@
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
$ownedCliPath = [IO.Path]::GetFullPath($OwnedCliPath)
$ownedEnvPath = [IO.Path]::GetFullPath((Join-Path $Workspace ".env.local"))

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
        $arguments = [HermesNativeCommandLine]::Split($commandLine)
        $scriptIndex = 1
        if ($arguments.Count -gt 1 -and $arguments[1] -eq "--env-file=$ownedEnvPath") {
            $scriptIndex = 2
        }
        if ($holder.Name -notin @("node.exe", "node") -or
            $arguments.Count -ne ($scriptIndex + 2) -or
            -not [IO.Path]::GetFullPath($arguments[$scriptIndex]).Equals($ownedCliPath, [StringComparison]::OrdinalIgnoreCase) -or
            $arguments[$scriptIndex + 1] -ne "cycle") {
            throw "HERMES_KILL_OWNERSHIP_WALL"
        }

        $knownOwnedPids = [Collections.Generic.HashSet[int]]::new()
        [void]$knownOwnedPids.Add($holderPid)
        $treeStopped = $false

        for ($attempt = 0; $attempt -lt 20; $attempt++) {
            $processes = @(Get-CimInstance Win32_Process)
            $depthByPid = @{}
            foreach ($knownPid in $knownOwnedPids) { $depthByPid[$knownPid] = 0 }

            $discovered = $true
            while ($discovered) {
                $discovered = $false
                foreach ($process in $processes) {
                    $processId = [int]$process.ProcessId
                    $parentId = [int]$process.ParentProcessId
                    if (-not $depthByPid.ContainsKey($processId) -and $depthByPid.ContainsKey($parentId)) {
                        $depthByPid[$processId] = [int]$depthByPid[$parentId] + 1
                        [void]$knownOwnedPids.Add($processId)
                        $discovered = $true
                    }
                }
            }

            $ownedTree = @($processes | Where-Object { $depthByPid.ContainsKey([int]$_.ProcessId) } | ForEach-Object {
                [PSCustomObject]@{ Process = $_; Depth = [int]$depthByPid[[int]$_.ProcessId] }
            })
            if ($ownedTree.Count -eq 0) {
                $treeStopped = $true
                break
            }

            foreach ($entry in $ownedTree | Sort-Object Depth -Descending) {
                $pidToStop = [int]$entry.Process.ProcessId
                & $StopProcessAction $pidToStop
                $stoppedProcessIds += $pidToStop
            }
            Start-Sleep -Milliseconds 100
        }

        if (-not $treeStopped) {
            throw "HERMES_KILL_PROCESS_SURVIVED_WALL"
        }
    }
}

if (-not $SkipSupervisor -and (Test-Path -LiteralPath $SupervisorStatePath)) {
    $supervisorState = Get-Content -LiteralPath $SupervisorStatePath -Raw | ConvertFrom-Json
    if ($supervisorState.hostName -ne [System.Net.Dns]::GetHostName() -or
        [string]$supervisorState.nonce -notmatch '^[0-9a-fA-F-]{36}$' -or
        [int]$supervisorState.processId -le 0) {
        throw "HERMES_KILL_SUPERVISOR_STATE_WALL"
    }

    $supervisorPid = [int]$supervisorState.processId
    $ownedSupervisorPath = [IO.Path]::GetFullPath($OwnedSupervisorPath)
    if (-not [IO.Path]::GetFullPath([string]$supervisorState.supervisorPath).Equals(
        $ownedSupervisorPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw "HERMES_KILL_SUPERVISOR_OWNERSHIP_WALL"
    }

    $processes = @(Get-CimInstance Win32_Process)
    $supervisor = $processes | Where-Object ProcessId -eq $supervisorPid | Select-Object -First 1
    if ($null -ne $supervisor) {
        $arguments = [HermesNativeCommandLine]::Split([string]$supervisor.CommandLine)
        $fileIndex = -1
        for ($index = 0; $index -lt $arguments.Count; $index++) {
            if ($arguments[$index].Equals("-File", [StringComparison]::OrdinalIgnoreCase)) {
                $fileIndex = $index
                break
            }
        }
        if ($supervisor.Name -notin @("pwsh.exe", "pwsh") -or
            $fileIndex -lt 0 -or $fileIndex + 1 -ge $arguments.Count -or
            -not [IO.Path]::GetFullPath($arguments[$fileIndex + 1]).Equals(
                $ownedSupervisorPath, [StringComparison]::OrdinalIgnoreCase)) {
            throw "HERMES_KILL_SUPERVISOR_OWNERSHIP_WALL"
        }

        $depthByPid = @{ $supervisorPid = 0 }
        $discovered = $true
        while ($discovered) {
            $discovered = $false
            foreach ($process in $processes) {
                $processId = [int]$process.ProcessId
                $parentId = [int]$process.ParentProcessId
                if (-not $depthByPid.ContainsKey($processId) -and $depthByPid.ContainsKey($parentId)) {
                    $depthByPid[$processId] = [int]$depthByPid[$parentId] + 1
                    $discovered = $true
                }
            }
        }
        foreach ($entry in @($processes | Where-Object { $depthByPid.ContainsKey([int]$_.ProcessId) } | ForEach-Object {
            [PSCustomObject]@{ Process = $_; Depth = [int]$depthByPid[[int]$_.ProcessId] }
        }) | Sort-Object Depth -Descending) {
            $pidToStop = [int]$entry.Process.ProcessId
            & $StopProcessAction $pidToStop
            $stoppedProcessIds += $pidToStop
        }

        for ($attempt = 0; $attempt -lt 20; $attempt++) {
            if ($null -eq (Get-Process -Id $supervisorPid -ErrorAction SilentlyContinue)) { break }
            Start-Sleep -Milliseconds 100
        }
        if ($null -ne (Get-Process -Id $supervisorPid -ErrorAction SilentlyContinue)) {
            throw "HERMES_KILL_SUPERVISOR_SURVIVED_WALL"
        }
    }
    Remove-Item -LiteralPath $SupervisorStatePath -Force -ErrorAction SilentlyContinue
}

[PSCustomObject]@{
    TaskName = $taskName
    Activation = "disabled"
    StopRequested = $true
    StoppedProcessIds = @($stoppedProcessIds | Sort-Object -Unique)
}
