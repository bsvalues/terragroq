param(
    [string]$Workspace = "C:\Users\bsval\william-os-devops",
    [switch]$Enable
)

$ErrorActionPreference = "Stop"
$taskName = "WilliamOS Hermes Codex Bridge"
$root = Join-Path $HOME ".williamos\hermes-bridge"
$controlDir = Join-Path $root "control"
$stateDir = Join-Path $root "state"
$worktreeDir = Join-Path $root "worktrees"
$activationPath = Join-Path $controlDir "activation"
$notBeforePath = Join-Path $controlDir "authority-not-before"
$runner = Join-Path $Workspace "scripts\hermes-bridge\run-cycle.ps1"

foreach ($path in @($controlDir, $stateDir, $worktreeDir)) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
}

if (-not (Test-Path -LiteralPath $activationPath)) {
    [IO.File]::WriteAllText($activationPath, "disabled`n", [Text.UTF8Encoding]::new($false))
}
if (-not (Test-Path -LiteralPath $notBeforePath)) {
    [IO.File]::WriteAllText($notBeforePath, ([DateTimeOffset]::UtcNow.ToString("o") + "`n"), [Text.UTF8Encoding]::new($false))
}

$action = New-ScheduledTaskAction -Execute "pwsh.exe" -Argument "-NoLogo -NoProfile -NonInteractive -File `"$runner`" -Workspace `"$Workspace`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 6)
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

if ($Enable) {
    [IO.File]::WriteAllText($activationPath, "enabled`n", [Text.UTF8Encoding]::new($false))
    Start-ScheduledTask -TaskName $taskName
}

[PSCustomObject]@{
    TaskName = $taskName
    Activation = (Get-Content -LiteralPath $activationPath -Raw).Trim()
    Workspace = $Workspace
    RejectedIssue357Reused = $false
}
