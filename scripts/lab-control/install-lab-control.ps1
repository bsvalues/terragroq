#requires -Version 7.5

[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'WilliamOS\LabControl\bin'),
    [switch]$SkipUserPath,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$commands = @('lab-status', 'lab-hermes', 'lab-atlas', 'lab-aegis', 'lab-daedalus', 'lab-containers', 'lab-backups', 'lab-ssh-config')
$sourceEntries = @(
    [pscustomobject]@{ Name = 'LabControl.psm1'; Source = (Join-Path $PSScriptRoot 'LabControl.psm1') }
    foreach ($command in $commands) {
        [pscustomobject]@{ Name = "$command.ps1"; Source = (Join-Path $PSScriptRoot "$command.ps1") }
        [pscustomobject]@{ Name = "$command.cmd"; Source = (Join-Path $PSScriptRoot "$command.cmd") }
    }
    [pscustomobject]@{
        Name = 'lab-management-topology.v1.json'
        Source = (Join-Path $PSScriptRoot '..\..\config\lab-control\lab-management-topology.v1.json')
    }
    [pscustomobject]@{
        Name = 'lab-management-topology.v1.schema.json'
        Source = (Join-Path $PSScriptRoot '..\..\config\lab-control\lab-management-topology.v1.schema.json')
    }
    [pscustomobject]@{
        Name = 'node-identity-contract.json'
        Source = (Join-Path $PSScriptRoot '..\..\config\execution-fabric\node-identity-contract.json')
    }
)

$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$volumeRoot = [IO.Path]::GetPathRoot($InstallRoot)
$installParentInfo = [IO.Directory]::GetParent($InstallRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar))
if ($null -eq $installParentInfo -or
    $InstallRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) -ieq
        $volumeRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)) {
    throw 'Refusing to install into a filesystem root.'
}
$installParent = $installParentInfo.FullName
$installLeaf = [IO.Path]::GetFileName($InstallRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar))
if ((Test-Path -LiteralPath $InstallRoot) -and -not (Test-Path -LiteralPath $InstallRoot -PathType Container)) {
    throw 'Refusing to continue because the existing install root is not a directory.'
}

$backupNamePattern = '^\.' + [regex]::Escape($installLeaf) + '\.backup\.[0-9a-f]{32}$'
$orphanBackups = @(
    if (Test-Path -LiteralPath $installParent -PathType Container) {
        Get-ChildItem -LiteralPath $installParent -Force |
            Where-Object { $_.Name -cmatch $backupNamePattern }
    }
)
if (-not (Test-Path -LiteralPath $InstallRoot) -and $orphanBackups.Count -gt 0) {
    if ($orphanBackups.Count -ne 1 -or -not $orphanBackups[0].PSIsContainer) {
        throw 'Refusing ambiguous interrupted-install recovery; expected exactly one backup directory.'
    }
    $orphanPath = [IO.Path]::GetFullPath($orphanBackups[0].FullName)
    $orphanParent = [IO.Directory]::GetParent($orphanPath)
    if ($null -eq $orphanParent -or $orphanParent.FullName -ine $installParent) {
        throw 'Interrupted-install recovery path escaped the intended parent directory.'
    }
    if (-not $PSCmdlet.ShouldProcess($InstallRoot, "Recover interrupted lab-control install from $orphanPath")) {
        return
    }
    Move-Item -LiteralPath $orphanPath -Destination $InstallRoot -ErrorAction Stop
}

$preparedSources = @(
    foreach ($entry in $sourceEntries) {
        $source = [IO.Path]::GetFullPath($entry.Source)
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            throw "Installation source is unavailable: $source"
        }
        [pscustomobject]@{
            Name = $entry.Name
            Source = $source
            Hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
        }
    }
)
if (@($preparedSources.Name | Select-Object -Unique).Count -ne $preparedSources.Count) {
    throw 'Installation source manifest contains duplicate destination names.'
}

if (-not $Force) {
    $conflicts = @(
        foreach ($entry in $preparedSources) {
            $source = $entry.Source
            $destination = Join-Path $InstallRoot $entry.Name
            if (Test-Path -LiteralPath $destination) {
                $same = $entry.Hash -eq (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
                if (-not $same) { $destination }
            }
        }
    )
    if ($conflicts.Count -gt 0) {
        throw "Refusing to overwrite modified managed file(s): $($conflicts -join ', '). Re-run with -Force only after review."
    }
}

if (-not $PSCmdlet.ShouldProcess($InstallRoot, 'Install OMEN lab-control command files')) {
    return
}

$transactionId = [Guid]::NewGuid().ToString('N')
$stagingRoot = Join-Path $installParent ".$installLeaf.stage.$transactionId"
$backupRoot = Join-Path $installParent ".$installLeaf.backup.$transactionId"
foreach ($transactionPath in @($stagingRoot, $backupRoot)) {
    $transactionParent = [IO.Directory]::GetParent($transactionPath)
    if ($null -eq $transactionParent -or $transactionParent.FullName -ine $installParent) {
        throw 'Installer transaction path escaped the intended parent directory.'
    }
}

New-Item -ItemType Directory -Path $installParent -Force | Out-Null
$oldInstallMoved = $false
$newInstallActivated = $false
try {
    New-Item -ItemType Directory -Path $stagingRoot -ErrorAction Stop | Out-Null
    if (Test-Path -LiteralPath $InstallRoot -PathType Container) {
        foreach ($child in @(Get-ChildItem -LiteralPath $InstallRoot -Force)) {
            Copy-Item -LiteralPath $child.FullName -Destination $stagingRoot -Recurse -Force -ErrorAction Stop
        }
    }
    foreach ($entry in $preparedSources) {
        Copy-Item -LiteralPath $entry.Source -Destination (Join-Path $stagingRoot $entry.Name) -Force -ErrorAction Stop
    }
    foreach ($entry in $preparedSources) {
        $stagedFile = Join-Path $stagingRoot $entry.Name
        if (-not (Test-Path -LiteralPath $stagedFile -PathType Leaf) -or
            (Get-FileHash -LiteralPath $stagedFile -Algorithm SHA256).Hash -ne $entry.Hash) {
            throw "Staged installation verification failed for $($entry.Name)."
        }
    }

    if (Test-Path -LiteralPath $InstallRoot) {
        Move-Item -LiteralPath $InstallRoot -Destination $backupRoot -ErrorAction Stop
        $oldInstallMoved = $true
    }
    try {
        Move-Item -LiteralPath $stagingRoot -Destination $InstallRoot -ErrorAction Stop
        $newInstallActivated = $true
    } catch {
        if ($oldInstallMoved -and
            -not (Test-Path -LiteralPath $InstallRoot) -and
            (Test-Path -LiteralPath $backupRoot -PathType Container)) {
            Move-Item -LiteralPath $backupRoot -Destination $InstallRoot -ErrorAction Stop
            $oldInstallMoved = $false
        }
        throw
    }
} finally {
    if (-not $newInstallActivated -and (Test-Path -LiteralPath $stagingRoot)) {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
if ($oldInstallMoved -and (Test-Path -LiteralPath $backupRoot -PathType Container)) {
    try {
        Remove-Item -LiteralPath $backupRoot -Recurse -Force -ErrorAction Stop
    } catch {
        Write-Warning "Installation succeeded, but the recoverable previous directory remains at $backupRoot"
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
