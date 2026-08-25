# Registers (or removes) the ONE canonical Ollama service owner on HERMES.
#
# Realised as a Task Scheduler definition rather than an SCM service on purpose. `ollama.exe` is not
# a service binary -- it never answers the Service Control Manager, so sc.exe would report it failed
# to start and kill it -- and the alternative is installing a third-party service wrapper (nssm,
# winsw) that is not on this machine. Task Scheduler is the mechanism HERMES already runs its own
# work through (HermesLabHealth, HermesVolumeBackup, HermesCrossNodeBackupSync), it starts at boot
# with no interactive logon, and TCC exists precisely so CUDA works in session 0.
#
#   -Uninstall  removes the task. That is the rollback for this step, and it is exact: the task did
#               not exist before, so removing it restores the prior state completely.

[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$TaskName = 'WilliamOS-HERMES-Ollama',
    [string]$ScriptPath = 'C:\HermesLab\hermes\ollama-service\hermes-ollama-service.ps1',
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

if ($Uninstall) {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $existing) { Write-Output "ABSENT $TaskName"; return }
    if ($PSCmdlet.ShouldProcess($TaskName, 'Unregister scheduled task')) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Output "REMOVED $TaskName"
    }
    return
}

if (-not (Test-Path $ScriptPath)) { throw "service script not found: $ScriptPath" }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$ScriptPath`""

# SYSTEM, highest privileges: the startup path reapplies the P40 power cap with nvidia-smi, which
# needs administrator rights, and nothing here may depend on a user being logged in.
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

$trigger = New-ScheduledTaskTrigger -AtStartup

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero)
# ExecutionTimeLimit zero = no limit. The default is 72 hours, and a long-running inference service
# that Task Scheduler terminates after three days would look exactly like an unexplained outage.

if ($PSCmdlet.ShouldProcess($TaskName, 'Register scheduled task')) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Register-ScheduledTask -TaskName $TaskName -Action $action -Principal $principal `
        -Trigger $trigger -Settings $settings `
        -Description 'Canonical HERMES Ollama service: native Windows, Tesla P40 (TCC) only, loopback 127.0.0.1:11434, 150W startup cap reconciled every boot. Supersedes the ollama stanza in C:\HermesLab\hermes\docker-compose.yml (#997).' | Out-Null
    Write-Output "REGISTERED $TaskName -> $ScriptPath"
}
