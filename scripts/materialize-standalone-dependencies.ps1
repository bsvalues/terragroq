[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$SourceNodeModules,
  [Parameter(Mandatory = $true)]
  [string]$DestinationNodeModules
)

$ErrorActionPreference = "Stop"

function Copy-DirectoryContents {
  param([string]$Source, [string]$Destination)

  $null = New-Item -ItemType Directory -Path $Destination -Force
  $null = robocopy $Source $Destination /E /XJ /NFL /NDL /NJH /NJS /NP
  if ($LASTEXITCODE -ge 8) {
    throw "robocopy failed copying '$Source' to '$Destination' (exit $LASTEXITCODE)"
  }
}

$resolvedSource = (Resolve-Path -LiteralPath $SourceNodeModules).ProviderPath.TrimEnd('\')
$sourceStore = Join-Path $resolvedSource ".pnpm"
if (-not (Test-Path -LiteralPath $sourceStore -PathType Container)) {
  throw "The standalone dependency tree has no pnpm virtual store at '$sourceStore'"
}

$resolvedTemp = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
$resolvedDestination = [IO.Path]::GetFullPath($DestinationNodeModules).TrimEnd('\')
$destinationParent = Split-Path -Parent $resolvedDestination
if (
  [IO.Path]::GetFileName($resolvedDestination) -ine "node_modules" -or
  -not $destinationParent.StartsWith($resolvedTemp + '\', [StringComparison]::OrdinalIgnoreCase) -or
  [IO.Path]::GetFileName($destinationParent) -notmatch '^williamos-standalone-dependencies-[0-9a-f]{32}$'
) {
  throw "Refusing unsafe standalone dependency destination '$resolvedDestination'"
}

if (Test-Path -LiteralPath $DestinationNodeModules) {
  Remove-Item -LiteralPath $DestinationNodeModules -Recurse -Force
}
$null = New-Item -ItemType Directory -Path $DestinationNodeModules -Force

# The standalone trace contains the exact packages in pnpm's virtual store, but Windows deployment
# cannot preserve the store's symlink topology. Materialize each traced package as a real directory.
Get-ChildItem -LiteralPath $sourceStore -Directory | Sort-Object Name | ForEach-Object {
  $storeNodeModules = Join-Path $_.FullName "node_modules"
  if (Test-Path -LiteralPath $storeNodeModules -PathType Container) {
    Get-ChildItem -LiteralPath $storeNodeModules -Directory | Sort-Object Name | ForEach-Object {
      if ($_.Name.StartsWith("@")) {
        $scopeTarget = Join-Path $DestinationNodeModules $_.Name
        $null = New-Item -ItemType Directory -Path $scopeTarget -Force
        Get-ChildItem -LiteralPath $_.FullName -Directory | Sort-Object Name | ForEach-Object {
          $target = Join-Path $scopeTarget $_.Name
          if (-not (Test-Path -LiteralPath $target)) {
            Copy-DirectoryContents -Source $_.FullName -Destination $target
          }
        }
      } else {
        $target = Join-Path $DestinationNodeModules $_.Name
        if (-not (Test-Path -LiteralPath $target)) {
          Copy-DirectoryContents -Source $_.FullName -Destination $target
        }
      }
    }
  }
}

foreach ($required in @("next\package.json", "styled-jsx\package.json", "@swc\helpers\package.json")) {
  $requiredPath = Join-Path $DestinationNodeModules $required
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "Materialized standalone dependencies are incomplete: missing '$required'"
  }
}

if (Get-ChildItem -LiteralPath $DestinationNodeModules -Recurse -Attributes ReparsePoint -ErrorAction SilentlyContinue | Select-Object -First 1) {
  throw "Materialized standalone dependencies still contain a reparse point"
}

Write-Output $DestinationNodeModules
