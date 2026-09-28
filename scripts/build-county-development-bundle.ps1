[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$NodeExe,
  [Parameter(Mandatory = $true)][string]$PostgresRoot,
  [Parameter(Mandatory = $true)][string]$OllamaRoot,
  [Parameter(Mandatory = $true)][string]$CockpitExe,
  [Parameter(Mandatory = $true)][string]$WebView2Loader,
  [Parameter(Mandatory = $true)][string]$SourceSha,
  [string]$ModelRoot,
  [string]$OutputRoot = "$env:RUNNER_TEMP\williamos-county-development-output"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).ProviderPath
$stageRoot = Join-Path $OutputRoot "WilliamOS-County-Development"
$appStage = Join-Path $env:TEMP "williamos-county-app"
$appZip = Join-Path $env:TEMP "williamos-county-app.zip"
$shortSha = $SourceSha.Substring(0, [Math]::Min(12, $SourceSha.Length))
$bundleZip = Join-Path $OutputRoot "WilliamOS-County-Development-$shortSha.zip"
$modelZip = Join-Path $OutputRoot "WilliamOS-County-Models-$shortSha.zip"

function Copy-Tree {
  param([string]$Source, [string]$Destination)
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  & robocopy.exe $Source $Destination /E /XJ /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed copying $Source to $Destination ($LASTEXITCODE)" }
}

function Require-File {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Required file missing: $Path" }
  return (Resolve-Path -LiteralPath $Path).ProviderPath
}

function Require-Directory {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw "Required directory missing: $Path" }
  return (Resolve-Path -LiteralPath $Path).ProviderPath
}

$NodeExe = Require-File $NodeExe
$PostgresRoot = Require-Directory $PostgresRoot
$OllamaRoot = Require-Directory $OllamaRoot
$CockpitExe = Require-File $CockpitExe
$WebView2Loader = Require-File $WebView2Loader
Require-File (Join-Path $repoRoot ".next\standalone\server.js") | Out-Null
Require-File (Join-Path $repoRoot "drizzle\0000_williamos_init.sql") | Out-Null
Require-File (Join-Path $PostgresRoot "share\extension\vector.control") | Out-Null
Require-File (Join-Path $OllamaRoot "ollama.exe") | Out-Null

Remove-Item -LiteralPath $OutputRoot -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $appStage -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $appZip -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null

# Reuse the already-proven standalone materializer rather than creating another Next trace copier.
& (Join-Path $repoRoot "scripts\build_azure_standalone_artifact.ps1") -ArtifactRoot $appStage -ZipPath $appZip | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Standalone application materialization failed ($LASTEXITCODE)" }
Copy-Tree $appStage (Join-Path $stageRoot "app")

New-Item -ItemType Directory -Path (Join-Path $stageRoot "runtime\node") -Force | Out-Null
Copy-Item -LiteralPath $NodeExe -Destination (Join-Path $stageRoot "runtime\node\node.exe") -Force

# The EnterpriseDB/Chocolatey source tree may contain a build-only initialized data cluster.
# County media carries only the portable PostgreSQL runtime, never that cluster, password verifier,
# configuration, or log state.
$postgresStage = Join-Path $stageRoot "runtime\postgres"
foreach ($directory in @("bin", "lib", "share")) {
  Copy-Tree (Require-Directory (Join-Path $PostgresRoot $directory)) (Join-Path $postgresStage $directory)
}
foreach ($notice in @("COPYRIGHT", "LICENSE", "README")) {
  $candidate = Join-Path $PostgresRoot $notice
  if (Test-Path -LiteralPath $candidate -PathType Leaf) {
    Copy-Item -LiteralPath $candidate -Destination (Join-Path $postgresStage $notice) -Force
  }
}
if (Test-Path -LiteralPath (Join-Path $postgresStage "data")) {
  throw "PORTABLE_POSTGRES_DATA_REFUSED: a build-time database cluster entered the County bundle"
}

Copy-Tree $OllamaRoot (Join-Path $stageRoot "runtime\ollama")

New-Item -ItemType Directory -Path (Join-Path $stageRoot "cockpit") -Force | Out-Null
Copy-Item -LiteralPath $CockpitExe -Destination (Join-Path $stageRoot "cockpit\williamos-cockpit.exe") -Force
Copy-Item -LiteralPath $WebView2Loader -Destination (Join-Path $stageRoot "cockpit\WebView2Loader.dll") -Force

New-Item -ItemType Directory -Path (Join-Path $stageRoot "schema") -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot "drizzle\0000_williamos_init.sql") -Destination (Join-Path $stageRoot "schema\0000_williamos_init.sql") -Force
Copy-Tree (Join-Path $repoRoot "deploy\county-development") (Join-Path $stageRoot "deploy\county-development")
Copy-Item -LiteralPath (Join-Path $repoRoot "deploy\county-development\county-development.config.example.json") -Destination (Join-Path $stageRoot "county-development.config.example.json") -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "deploy\county-development\THIRD_PARTY_NOTICES.md") -Destination (Join-Path $stageRoot "THIRD_PARTY_NOTICES.md") -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "deploy\county-development\WilliamOS-County-Development.cmd") -Destination (Join-Path $stageRoot "WilliamOS-County-Development.cmd") -Force

$versionEvidence = [ordered]@{
  node = (& $NodeExe --version).Trim()
  postgres = (& (Join-Path $PostgresRoot "bin\postgres.exe") --version).Trim()
  ollama = (& (Join-Path $OllamaRoot "ollama.exe") --version 2>$null | Select-Object -First 1).Trim()
  cockpit = "0.1.7"
  pgvector = (Get-Content -LiteralPath (Join-Path $PostgresRoot "share\extension\vector.control") | Where-Object { $_ -match '^default_version' } | Select-Object -First 1).Trim()
}

$files = Get-ChildItem -LiteralPath $stageRoot -Recurse -File | Sort-Object FullName | ForEach-Object {
  [ordered]@{
    path = [IO.Path]::GetRelativePath($stageRoot, $_.FullName).Replace('\', '/')
    bytes = $_.Length
    sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}
$manifest = [ordered]@{
  schema = "williamos.county-development.bundle.v1"
  sourceRepository = "bsvalues/terragroq"
  sourceSha = $SourceSha
  deploymentProfile = "county-development"
  serviceOrigin = "http://127.0.0.1:3200"
  localInferenceOrigin = "http://127.0.0.1:11434/v1"
  createdAt = [DateTimeOffset]::UtcNow.ToString('o')
  runtimes = $versionEvidence
  signed = $false
  files = @($files)
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $stageRoot "manifest.json") -Encoding utf8

Push-Location $stageRoot
try {
  & tar.exe -a -cf $bundleZip *
  if ($LASTEXITCODE -ne 0) { throw "tar failed creating $bundleZip ($LASTEXITCODE)" }
} finally {
  Pop-Location
}

$modelArtifact = $null
if ($ModelRoot) {
  $ModelRoot = Require-Directory $ModelRoot
  $modelStage = Join-Path $OutputRoot "WilliamOS-County-Models"
  New-Item -ItemType Directory -Path $modelStage -Force | Out-Null
  Copy-Tree $ModelRoot (Join-Path $modelStage "models")
  $modelFiles = Get-ChildItem -LiteralPath $modelStage -Recurse -File | Sort-Object FullName | ForEach-Object {
    [ordered]@{
      path = [IO.Path]::GetRelativePath($modelStage, $_.FullName).Replace('\', '/')
      bytes = $_.Length
      sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
  [ordered]@{
    schema = "williamos.county-development.models.v1"
    sourceSha = $SourceSha
    models = @("qwen2.5-coder:1.5b", "snowflake-arctic-embed2")
    createdAt = [DateTimeOffset]::UtcNow.ToString('o')
    files = @($modelFiles)
  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $modelStage "model-manifest.json") -Encoding utf8
  Push-Location $modelStage
  try {
    & tar.exe -a -cf $modelZip *
    if ($LASTEXITCODE -ne 0) { throw "tar failed creating $modelZip ($LASTEXITCODE)" }
  } finally {
    Pop-Location
  }
  $modelArtifact = [ordered]@{
    path = $modelZip
    bytes = (Get-Item $modelZip).Length
    sha256 = (Get-FileHash -LiteralPath $modelZip -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

[ordered]@{
  schema = "williamos.county-development.build-result.v1"
  bundle = [ordered]@{
    path = $bundleZip
    bytes = (Get-Item $bundleZip).Length
    sha256 = (Get-FileHash -LiteralPath $bundleZip -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  models = $modelArtifact
  stageRoot = $stageRoot
} | ConvertTo-Json -Depth 6
