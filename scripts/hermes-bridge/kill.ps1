$ErrorActionPreference = "Stop"
$taskName = "WilliamOS Hermes Codex Bridge"
$activationPath = Join-Path $HOME ".williamos\hermes-bridge\control\activation"

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $activationPath) | Out-Null
[IO.File]::WriteAllText($activationPath, "disabled`n", [Text.UTF8Encoding]::new($false))

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($null -ne $task) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}

[PSCustomObject]@{
    TaskName = $taskName
    Activation = "disabled"
    StopRequested = $true
}
