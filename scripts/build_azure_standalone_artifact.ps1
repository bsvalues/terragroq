param(
  [string]$ArtifactRoot = "$env:TEMP\williamos-azure-standalone",
  [string]$ZipPath = "$env:TEMP\williamos-azure-standalone.zip"
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$standaloneRoot = Join-Path $repoRoot ".next\standalone"
$staticRoot = Join-Path $repoRoot ".next\static"
$publicRoot = Join-Path $repoRoot "public"

if (-not (Test-Path (Join-Path $standaloneRoot "server.js"))) {
  throw "Missing .next\standalone\server.js. Run npm run build first."
}

function Copy-DirectoryContents {
  param(
    [string]$Source,
    [string]$Destination,
    [string[]]$ExcludeDirs = @()
  )

  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  $args = @($Source, $Destination, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/XJ")
  if ($ExcludeDirs.Count -gt 0) {
    $args += "/XD"
    $args += $ExcludeDirs
  }
  & robocopy @args | Out-Null
  if ($LASTEXITCODE -gt 7) {
    throw "robocopy failed copying $Source to $Destination with exit code $LASTEXITCODE"
  }
}

Remove-Item -LiteralPath $ArtifactRoot -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $ZipPath -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $ArtifactRoot -Force | Out-Null

Copy-DirectoryContents -Source $standaloneRoot -Destination $ArtifactRoot -ExcludeDirs @("node_modules")

$sourcePnpmStore = Join-Path $standaloneRoot "node_modules\.pnpm"
$artifactPnpmStore = Join-Path $ArtifactRoot "node_modules\.pnpm"
Copy-DirectoryContents -Source $sourcePnpmStore -Destination $artifactPnpmStore

$staticDest = Join-Path $ArtifactRoot ".next\static"
Copy-DirectoryContents -Source $staticRoot -Destination $staticDest

if (Test-Path $publicRoot) {
  Copy-DirectoryContents -Source $publicRoot -Destination (Join-Path $ArtifactRoot "public")
}

# pnpm keeps many traced dependencies in its virtual store. The Next.js
# standalone trace can include those store entries without materializing every
# node_modules package path that the runtime require hook expects on Azure.
$pnpmStore = Join-Path $ArtifactRoot "node_modules\.pnpm"
if (Test-Path $pnpmStore) {
  Get-ChildItem $pnpmStore -Directory | ForEach-Object {
    $storeNodeModules = Join-Path $_.FullName "node_modules"
    if (Test-Path $storeNodeModules) {
      Get-ChildItem $storeNodeModules -Directory | ForEach-Object {
        $source = $_.FullName
        if ($_.Name.StartsWith("@")) {
          $scopeTarget = Join-Path $ArtifactRoot "node_modules\$($_.Name)"
          New-Item -ItemType Directory -Path $scopeTarget -Force | Out-Null
          Get-ChildItem $source -Directory | ForEach-Object {
            $target = Join-Path $scopeTarget $_.Name
            if ((Test-Path $target) -and ((Get-Item $target).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
              Remove-Item -LiteralPath $target -Force -Recurse
            }
            if (-not (Test-Path $target)) {
              Copy-DirectoryContents -Source $_.FullName -Destination $target
            }
          }
        } else {
          $target = Join-Path $ArtifactRoot "node_modules\$($_.Name)"
          if ((Test-Path $target) -and ((Get-Item $target).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            Remove-Item -LiteralPath $target -Force -Recurse
          }
          if (-not (Test-Path $target)) {
            Copy-DirectoryContents -Source $source -Destination $target
          }
        }
      }
    }
  }
}

Get-ChildItem -Path $ArtifactRoot -Recurse -Force -Filter ".env*" | Remove-Item -Force

Compress-Archive -Path (Join-Path $ArtifactRoot "*") -DestinationPath $ZipPath -Force

$hash = (Get-FileHash -Path $ZipPath -Algorithm SHA256).Hash
$size = (Get-Item $ZipPath).Length
$envFiles = @(Get-ChildItem -Path $ArtifactRoot -Recurse -Force -Filter ".env*").Count

[pscustomobject]@{
  artifactRoot = $ArtifactRoot
  zipPath = $ZipPath
  size = $size
  sha256 = $hash
  serverJs = Test-Path (Join-Path $ArtifactRoot "server.js")
  packageJson = Test-Path (Join-Path $ArtifactRoot "package.json")
  staticAssets = Test-Path (Join-Path $ArtifactRoot ".next\static")
  styledJsx = Test-Path (Join-Path $ArtifactRoot "node_modules\styled-jsx")
  swcHelpers = Test-Path (Join-Path $ArtifactRoot "node_modules\@swc\helpers")
  envFiles = $envFiles
} | ConvertTo-Json
