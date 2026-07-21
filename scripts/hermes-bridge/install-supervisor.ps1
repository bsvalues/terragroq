param(
    [string]$Workspace = "C:\Users\bsval\william-os-devops",
    [string]$RuntimeRoot = (Join-Path $HOME ".williamos\hermes-bridge"),
    [string]$StartupPath = [Environment]::GetFolderPath("Startup"),
    [switch]$SkipLaunch,
    [switch]$Enable
)

$ErrorActionPreference = "Stop"
$taskName = "WilliamOS Hermes Codex Bridge"
$root = [IO.Path]::GetFullPath($RuntimeRoot)
$controlDir = Join-Path $root "control"
$stateDir = Join-Path $root "state"
$worktreeDir = Join-Path $root "worktrees"
$activationPath = Join-Path $controlDir "activation"
$notBeforePath = Join-Path $controlDir "authority-not-before"
$supervisor = [IO.Path]::GetFullPath((Join-Path $Workspace "scripts\hermes-bridge\supervisor.ps1"))
$pwsh = (Get-Command pwsh.exe -ErrorAction Stop).Source
$shortcutPath = Join-Path $StartupPath "$taskName.lnk"

foreach ($path in @($controlDir, $stateDir, $worktreeDir)) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
}

if (-not (Test-Path -LiteralPath $activationPath)) {
    [IO.File]::WriteAllText($activationPath, "disabled`n", [Text.UTF8Encoding]::new($false))
}
if (-not (Test-Path -LiteralPath $notBeforePath)) {
    [IO.File]::WriteAllText($notBeforePath, ([DateTimeOffset]::UtcNow.ToString("o") + "`n"), [Text.UTF8Encoding]::new($false))
}

$legacyTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($null -ne $legacyTask) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

New-Item -ItemType Directory -Force -Path $StartupPath | Out-Null
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $pwsh
$shortcut.Arguments = "-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -File `"$supervisor`" -Workspace `"$Workspace`" -RuntimeRoot `"$root`""
$shortcut.WorkingDirectory = [IO.Path]::GetFullPath($Workspace)
$shortcut.WindowStyle = 7
$shortcut.Description = "WilliamOS Hermes-to-Codex interactive-user supervisor"
$shortcut.Save()

if ($Enable) {
    [IO.File]::WriteAllText($activationPath, "enabled`n", [Text.UTF8Encoding]::new($false))
    if (-not $SkipLaunch) {
        $process = Start-Process -FilePath $pwsh -ArgumentList @(
            "-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden",
            "-File", $supervisor, "-Workspace", $Workspace, "-RuntimeRoot", $root
        ) -WindowStyle Hidden -PassThru
    }
}

[PSCustomObject]@{
    TaskName = $taskName
    Activation = (Get-Content -LiteralPath $activationPath -Raw).Trim()
    Workspace = $Workspace
    HostMode = "INTERACTIVE_USER_RESIDENT"
    StartupShortcut = $shortcutPath
    SupervisorPid = if ($null -ne $process) { $process.Id } else { $null }
    RejectedIssue357Reused = $false
}
