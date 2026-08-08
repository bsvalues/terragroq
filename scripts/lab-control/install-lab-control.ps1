[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'WilliamOS\LabControl\bin'),
    [switch]$SkipUserPath,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$commands = @('lab-status', 'lab-hermes', 'lab-atlas', 'lab-containers', 'lab-backups')
$sourceFiles = @('LabControl.psm1') + @($commands | ForEach-Object { "$_.ps1"; "$_.cmd" })

if (-not $Force) {
    $conflicts = @(
        foreach ($name in $sourceFiles) {
            $source = Join-Path $PSScriptRoot $name
            $destination = Join-Path $InstallRoot $name
            if (Test-Path -LiteralPath $destination) {
                $same = (Get-FileHash -LiteralPath $source).Hash -eq (Get-FileHash -LiteralPath $destination).Hash
                if (-not $same) { $destination }
            }
        }
    )
    if ($conflicts.Count -gt 0) {
        throw "Refusing to overwrite modified managed file(s): $($conflicts -join ', '). Re-run with -Force only after review."
    }
}

if ($PSCmdlet.ShouldProcess($InstallRoot, 'Install OMEN lab-control command files')) {
    New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
    foreach ($name in $sourceFiles) {
        $source = Join-Path $PSScriptRoot $name
        $destination = Join-Path $InstallRoot $name
        if (Test-Path -LiteralPath $destination) {
            $same = (Get-FileHash -LiteralPath $source).Hash -eq (Get-FileHash -LiteralPath $destination).Hash
            if ($same) { continue }
        }
        Copy-Item -LiteralPath $source -Destination $destination -Force:$Force
    }
}

if ($SkipUserPath) {
    Write-Output "Installed lab-control commands in $InstallRoot. User PATH unchanged."
    exit 0
}

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$entries = @($userPath -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$alreadyPresent = @($entries | Where-Object { $_.TrimEnd('\') -ieq $InstallRoot.TrimEnd('\') }).Count -gt 0
if (-not $alreadyPresent -and $PSCmdlet.ShouldProcess('User PATH', "Append $InstallRoot")) {
    $newPath = (@($entries) + $InstallRoot) -join ';'
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    Write-Output "Installed lab-control commands and appended $InstallRoot to the user PATH. Open a new terminal before use."
} elseif ($alreadyPresent) {
    Write-Output "Installed lab-control commands. User PATH already contains $InstallRoot."
}
