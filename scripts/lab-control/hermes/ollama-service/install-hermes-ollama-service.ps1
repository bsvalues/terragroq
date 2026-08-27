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
    # How often the task re-fires to check that the one owner is still there. A firing is a no-op
    # while the service is healthy (MultipleInstances = IgnoreNew) and a recovery when it is not.
    [int]$RecheckMinutes = 2,
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

# Triggers, and why RestartCount is not one of them.
#
# MEASURED ON THIS HOST, not assumed. With `RestartCount 3 / RestartInterval 1m` registered exactly
# as it is below, the startup script was made to exit non-zero (its `ollama serve` was killed). The
# task went to `Ready` with `LastTaskResult 0xFFFFFFFF` and **no retry was ever attempted**, over
# more than four minutes. Windows applies restart-on-failure to a task that fails to RUN, not to one
# whose action ran and returned a failure code. So the automatic recovery the commissioning record
# leaned on -- the same `restart_count=3` review reasoned about -- did not exist at all. Review
# expected three retries that each refused; there were none.
#
# `RestartCount` is kept below because it still covers the case it genuinely handles -- a task that
# fails to launch -- but it is not the recovery mechanism and is no longer described as one.
# TWO triggers, because neither alone recovers anything.
#
#   the boot trigger    starts the one owner at boot, as before.
#   the recheck trigger is what makes recovery real, and it has to be a TIME trigger rather than a
#                       repetition hung off the boot trigger. Measured here: a repetition attached to
#                       a boot trigger has no active window until the next boot -- registered
#                       post-boot with `PT2M`, the task sat at `Ready` with LastRunTime "never" and
#                       fired nothing for over three minutes.
#
# A firing while the service is healthy costs nothing: `MultipleInstances = IgnoreNew` drops it
# without running the action, so the running instance and its LastTaskResult are untouched. A firing
# while the task is `Ready` starts the script, whose one-owner guard reclaims any orphaned runner on
# the way in. Worst case outage is one recheck interval instead of forever.
#
# This is only safe because that guard is now correct. Under the old name-only guard, a recheck
# would have found the orphan, refused, and logged a failure every two minutes forever.
$bootTrigger = New-ScheduledTaskTrigger -AtStartup
$recheckTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes $RecheckMinutes)
$trigger = @($bootTrigger, $recheckTrigger)

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
        -Description "Canonical HERMES Ollama service: native Windows, Tesla P40 (TCC) only, loopback 127.0.0.1:11434, 150W startup cap reconciled every boot, re-fired every $RecheckMinutes minutes so a dead server is reclaimed and restarted (a firing while healthy is ignored). Supersedes the ollama stanza in C:\HermesLab\hermes\docker-compose.yml (#997)." | Out-Null
    Write-Output "REGISTERED $TaskName -> $ScriptPath"
}
