<#
.SYNOPSIS
  Install and run WilliamOS County Development without Docker, WSL, a Windows service, or elevation.

.DESCRIPTION
  The extracted package is distribution media. Program files are copied into the current user's
  LocalAppData, while database, model, logs, secrets, and process state remain in a separate user-only
  data directory. Every network listener is loopback-only. This script never changes Firewall, RDP,
  OpenSSH, UAC, scheduled tasks, services, or machine-wide environment variables.
#>
[CmdletBinding()]
param(
  [ValidateSet("Launch", "Install", "Start", "Stop", "Status", "Uninstall")]
  [string]$Action = "Launch",
  [string]$InstallRoot = "$env:LOCALAPPDATA\Programs\WilliamOSCountyDevelopment",
  [string]$DataRoot = "$env:LOCALAPPDATA\WilliamOSCountyDevelopment",
  [string]$OwnerEmail,
  [string]$TerraFusionRoot,
  [string]$DeploymentId,
  [string]$PreviewUrl,
  [string]$ModelSource,
  [switch]$NonInteractive,
  [switch]$SkipCockpit,
  [switch]$AllowMissingModels,
  [switch]$PurgeData
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$PackageRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$DataRoot = [IO.Path]::GetFullPath($DataRoot)
$ConfigPath = Join-Path $DataRoot "county-development.config.json"
$SecretsPath = Join-Path $DataRoot "secrets.json"
$StateRoot = Join-Path $DataRoot "state"
$LogRoot = Join-Path $DataRoot "logs"
$PostgresData = Join-Path $DataRoot "postgres\data"
$OllamaModels = Join-Path $DataRoot "ollama\models"
$AppPidPath = Join-Path $StateRoot "williamos.pid"
$OllamaPidPath = Join-Path $StateRoot "ollama.pid"

function Write-Event {
  param([string]$Code, [string]$Detail)
  $line = "$([DateTimeOffset]::UtcNow.ToString('o')) $Code $Detail"
  if (Test-Path -LiteralPath $LogRoot) {
    $line | Out-File -LiteralPath (Join-Path $LogRoot "county-development.log") -Append -Encoding utf8
  }
  Write-Host $line
}

function Deny {
  param([string]$Code, [string]$Detail)
  Write-Event "REFUSED:$Code" $Detail
  throw "$Code`: $Detail"
}

function Ensure-Directory {
  param([string]$Path)
  New-Item -ItemType Directory -Path $Path -Force | Out-Null
}

function Copy-Tree {
  param([string]$Source, [string]$Destination, [string[]]$ExcludeDirectories = @())
  Ensure-Directory $Destination
  $arguments = @($Source, $Destination, "/MIR", "/XJ", "/R:2", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/NP")
  if ($ExcludeDirectories.Count -gt 0) {
    $arguments += "/XD"
    $arguments += $ExcludeDirectories
  }
  & robocopy.exe @arguments | Out-Null
  if ($LASTEXITCODE -ge 8) { Deny "COPY_FAILED" "$Source -> $Destination (robocopy $LASTEXITCODE)" }
}

function New-Secret {
  param([int]$Bytes = 32)
  $buffer = New-Object byte[] $Bytes
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($buffer)
  } finally {
    $rng.Dispose()
  }
  return [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Protect-CurrentUserFile {
  param([string]$Path)
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  & icacls.exe $Path /inheritance:r /grant:r "$identity`:(F)" | Out-Null
  if ($LASTEXITCODE -ne 0) { Deny "SECRET_ACL_FAILED" "Could not restrict $Path to $identity" }
}

function Test-LoopbackUrl {
  param([string]$Value, [string[]]$Protocols)
  try { $uri = [Uri]$Value } catch { return $false }
  return $uri.IsAbsoluteUri -and $Protocols.Contains($uri.Scheme) -and $uri.Host -in @("127.0.0.1", "localhost", "::1")
}

function Invoke-Git {
  param([string]$Root, [string[]]$Arguments)
  $output = & git.exe -C $Root @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  return ("$output").Trim()
}

function Assert-TerraFusionCheckout {
  param([string]$Root)
  if (-not $Root -or -not [IO.Path]::IsPathRooted($Root)) {
    Deny "TERRAFUSION_ROOT_REQUIRED" "Provide an absolute path to the local TerraFusion checkout."
  }
  if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
    Deny "TERRAFUSION_ROOT_MISSING" "The TerraFusion checkout does not exist: $Root"
  }
  $resolved = (Resolve-Path -LiteralPath $Root).ProviderPath.TrimEnd('\')
  $top = Invoke-Git $resolved @("rev-parse", "--show-toplevel")
  if (-not $top) { Deny "TERRAFUSION_ROOT_NOT_GIT" "$resolved is not a Git worktree." }
  $top = ($top -replace '/', '\').TrimEnd('\')
  if ($top -ine $resolved) { Deny "TERRAFUSION_ROOT_NOT_TOPLEVEL" "Use the Git top-level: $top" }
  $origin = Invoke-Git $resolved @("remote", "get-url", "origin")
  if (-not $origin) { Deny "TERRAFUSION_ORIGIN_MISSING" "The checkout has no origin remote." }
  $normalized = $origin.Trim() -replace '\.git$', ''
  if ($normalized -match '^git@github\.com:(.+)$') { $normalized = $Matches[1] }
  elseif ($normalized -match '^https?://github\.com/(.+)$') { $normalized = $Matches[1] }
  elseif ($normalized -match '^ssh://git@ssh\.github\.com(?::443)?/(.+)$') { $normalized = $Matches[1] }
  if ($normalized.Trim('/').ToLowerInvariant() -ne "bsvalues/terrafusion_os_1.0") {
    Deny "TERRAFUSION_ORIGIN_MISMATCH" "The checkout is not bsvalues/terrafusion_os_1.0."
  }
  return $resolved
}

function Test-PackageManifest {
  param([string]$Root)
  $manifestPath = Join-Path $Root "manifest.json"
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    Deny "PACKAGE_MANIFEST_MISSING" "manifest.json is missing from the extracted package."
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.schema -ne "williamos.county-development.bundle.v1") {
    Deny "PACKAGE_MANIFEST_INVALID" "Unexpected package schema."
  }
  foreach ($entry in @($manifest.files)) {
    $candidate = Join-Path $Root ([string]$entry.path)
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      Deny "PACKAGE_FILE_MISSING" ([string]$entry.path)
    }
    $actual = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne ([string]$entry.sha256).ToLowerInvariant()) {
      Deny "PACKAGE_HASH_MISMATCH" ([string]$entry.path)
    }
  }
  return $manifest
}

function Read-JsonFile {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Write-JsonFile {
  param([string]$Path, [object]$Value, [switch]$Protect)
  Ensure-Directory (Split-Path -Parent $Path)
  $Value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Path -Encoding utf8
  if ($Protect) { Protect-CurrentUserFile $Path }
}

function Resolve-InitialConfiguration {
  param([object]$Manifest)
  $existing = Read-JsonFile $ConfigPath
  if ($existing) { return $existing }

  $email = $OwnerEmail
  $root = $TerraFusionRoot
  if (-not $NonInteractive) {
    if (-not $email) { $email = Read-Host "County owner email" }
    if (-not $root) { $root = Read-Host "Absolute path to the local terrafusion_os_1.0 checkout" }
  }
  if (-not $email -or $email -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
    Deny "OWNER_EMAIL_REQUIRED" "Provide the County account that will become this installation's owner."
  }
  $resolvedRoot = Assert-TerraFusionCheckout $root
  $preview = if ($PreviewUrl) { $PreviewUrl.Trim() } else { "http://127.0.0.1:3102/" }
  if (-not (Test-LoopbackUrl $preview @('http', 'https'))) {
    Deny "PREVIEW_URL_INVALID" "County developer Preview must be one loopback HTTP(S) URL."
  }
  $preview = ([Uri]$preview).AbsoluteUri
  $id = if ($DeploymentId) { $DeploymentId } else { "benton-county-development-$($env:COMPUTERNAME.ToLowerInvariant())" }
  if ($id -notmatch '^[a-z0-9][a-z0-9.-]{2,79}$') {
    Deny "DEPLOYMENT_ID_INVALID" "Use 3-80 lowercase letters, digits, dots, or hyphens."
  }
  $config = [ordered]@{
    schema = "williamos.county-development.config.v1"
    deploymentProfile = "county-development"
    deploymentId = $id
    ownerEmail = $email.Trim().ToLowerInvariant()
    terraFusionRoot = $resolvedRoot
    appPort = 3200
    postgresPort = 15434
    aiPort = 11434
    chatModel = "qwen2.5-coder:1.5b"
    embeddingModel = "snowflake-arctic-embed2"
    previewUrl = $preview
    packageSourceSha = [string]$Manifest.sourceSha
  }
  Write-JsonFile $ConfigPath $config
  return Read-JsonFile $ConfigPath
}

function Ensure-Secrets {
  $existing = Read-JsonFile $SecretsPath
  if ($existing) { return $existing }
  $secrets = [ordered]@{
    schema = "williamos.county-development.secrets.v1"
    postgresPassword = New-Secret 36
    authSecret = New-Secret 48
  }
  Write-JsonFile $SecretsPath $secrets -Protect
  return Read-JsonFile $SecretsPath
}

function Assert-InstalledPayload {
  foreach ($required in @(
    "app\server.js",
    "runtime\node\node.exe",
    "runtime\postgres\bin\initdb.exe",
    "runtime\postgres\bin\pg_ctl.exe",
    "runtime\postgres\bin\psql.exe",
    "runtime\postgres\share\extension\vector.control",
    "runtime\ollama\ollama.exe",
    "cockpit\williamos-cockpit.exe",
    "cockpit\WebView2Loader.dll",
    "schema\0000_williamos_init.sql"
  )) {
    if (-not (Test-Path -LiteralPath (Join-Path $InstallRoot $required) -PathType Leaf)) {
      Deny "INSTALLED_PAYLOAD_INCOMPLETE" $required
    }
  }
}

function With-PostgresPassword {
  param([object]$Secrets, [scriptblock]$ActionBlock)
  $previous = $env:PGPASSWORD
  try {
    $env:PGPASSWORD = [string]$Secrets.postgresPassword
    & $ActionBlock
  } finally {
    $env:PGPASSWORD = $previous
  }
}

function Start-Postgres {
  param([object]$Config, [object]$Secrets)
  $bin = Join-Path $InstallRoot "runtime\postgres\bin"
  $initdb = Join-Path $bin "initdb.exe"
  $pgCtl = Join-Path $bin "pg_ctl.exe"
  $psql = Join-Path $bin "psql.exe"
  $createdb = Join-Path $bin "createdb.exe"
  $port = [int]$Config.postgresPort
  Ensure-Directory (Split-Path -Parent $PostgresData)
  Ensure-Directory $LogRoot

  if (-not (Test-Path -LiteralPath (Join-Path $PostgresData "PG_VERSION") -PathType Leaf)) {
    $passwordFile = Join-Path $env:TEMP ("williamos-pg-{0}.txt" -f [guid]::NewGuid().ToString('N'))
    try {
      [string]$Secrets.postgresPassword | Set-Content -LiteralPath $passwordFile -NoNewline -Encoding ascii
      & $initdb -D $PostgresData -U williamos -A scram-sha-256 --pwfile=$passwordFile --encoding=UTF8 --locale=C | Out-Null
      if ($LASTEXITCODE -ne 0) { Deny "POSTGRES_INIT_FAILED" "initdb exited $LASTEXITCODE" }
    } finally {
      Remove-Item -LiteralPath $passwordFile -Force -ErrorAction SilentlyContinue
    }
    @"
listen_addresses = '127.0.0.1'
port = $port
max_connections = 24
shared_buffers = '256MB'
log_timezone = 'UTC'
timezone = 'UTC'
"@ | Add-Content -LiteralPath (Join-Path $PostgresData "postgresql.conf") -Encoding ascii
    @"
local all all scram-sha-256
host all all 127.0.0.1/32 scram-sha-256
host all all ::1/128 scram-sha-256
"@ | Set-Content -LiteralPath (Join-Path $PostgresData "pg_hba.conf") -Encoding ascii
  }

  & $pgCtl status -D $PostgresData *> $null
  if ($LASTEXITCODE -ne 0) {
    & $pgCtl start -D $PostgresData -l (Join-Path $LogRoot "postgres.log") -o "-h 127.0.0.1 -p $port" -w | Out-Null
    if ($LASTEXITCODE -ne 0) { Deny "POSTGRES_START_FAILED" "pg_ctl exited $LASTEXITCODE" }
  }

  With-PostgresPassword $Secrets {
    $exists = & $psql -h 127.0.0.1 -p $port -U williamos -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='williamos'" 2>$null
    if (("$exists").Trim() -ne "1") {
      & $createdb -h 127.0.0.1 -p $port -U williamos williamos
      if ($LASTEXITCODE -ne 0) { Deny "POSTGRES_DATABASE_CREATE_FAILED" "createdb exited $LASTEXITCODE" }
    }
    & $psql -h 127.0.0.1 -p $port -U williamos -d williamos -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS vector" | Out-Null
    if ($LASTEXITCODE -ne 0) { Deny "PGVECTOR_ENABLE_FAILED" "The packaged pgvector extension could not be enabled." }
    $schemaPresent = & $psql -h 127.0.0.1 -p $port -U williamos -d williamos -tAc 'SELECT CASE WHEN to_regclass(''public."user"'') IS NULL THEN 0 ELSE 1 END;' 2>$null
    if (("$schemaPresent").Trim() -ne "1") {
      & $psql -h 127.0.0.1 -p $port -U williamos -d williamos -v ON_ERROR_STOP=1 -f (Join-Path $InstallRoot "schema\0000_williamos_init.sql") | Out-Null
      if ($LASTEXITCODE -ne 0) { Deny "WILLIAMOS_SCHEMA_APPLY_FAILED" "psql exited $LASTEXITCODE" }
    }
  }
}

function Import-Models {
  if (-not $ModelSource) {
    $candidate = Join-Path $PackageRoot "models"
    if (Test-Path -LiteralPath $candidate -PathType Container) { $script:ModelSource = $candidate }
  }
  if (-not $ModelSource) { return }
  if (-not (Test-Path -LiteralPath $ModelSource -PathType Container)) {
    Deny "MODEL_SOURCE_MISSING" "The local model source does not exist: $ModelSource"
  }
  $resolved = (Resolve-Path -LiteralPath $ModelSource).ProviderPath
  $source = if (Test-Path -LiteralPath (Join-Path $resolved "models") -PathType Container) {
    Join-Path $resolved "models"
  } else {
    $resolved
  }
  Copy-Tree $source $OllamaModels
}

function Wait-JsonEndpoint {
  param([string]$Url, [int]$Seconds = 60)
  $deadline = [DateTimeOffset]::UtcNow.AddSeconds($Seconds)
  do {
    try { return Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 5 -UseBasicParsing }
    catch { Start-Sleep -Milliseconds 750 }
  } while ([DateTimeOffset]::UtcNow -lt $deadline)
  return $null
}

function Normalize-OllamaModelName {
  param([string]$Name)
  $trimmed = ("$Name").Trim()
  if (-not $trimmed) { return $trimmed }
  $lastSlash = $trimmed.LastIndexOf('/')
  $lastColon = $trimmed.LastIndexOf(':')
  if ($lastColon -gt $lastSlash) { return $trimmed }
  return "$trimmed`:latest"
}

function Remove-StalePidFile {
  param([string]$PidPath, [string]$Detail)
  Write-Event "STALE_PID_DISCARDED" $Detail
  Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
}

function Get-TrackedProcess {
  param(
    [string]$PidPath,
    [string]$ExpectedExecutable,
    [string]$ExpectedCommandToken,
    [string]$Label
  )
  if (-not (Test-Path -LiteralPath $PidPath -PathType Leaf)) { return $null }
  [int]$pidValue = 0
  $raw = (Get-Content -LiteralPath $PidPath -Raw).Trim()
  if (-not [int]::TryParse($raw, [ref]$pidValue) -or $pidValue -le 0) {
    Remove-StalePidFile $PidPath "$Label invalid-pid=$raw"
    return $null
  }

  $record = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $pidValue" -ErrorAction SilentlyContinue
  if (-not $record) {
    Remove-StalePidFile $PidPath "$Label absent-pid=$pidValue"
    return $null
  }

  $expectedPath = [IO.Path]::GetFullPath($ExpectedExecutable)
  $actualPath = if ($record.ExecutablePath) { [IO.Path]::GetFullPath([string]$record.ExecutablePath) } else { "" }
  $commandLine = [string]$record.CommandLine
  $pathMatches = $actualPath -and $actualPath.Equals($expectedPath, [StringComparison]::OrdinalIgnoreCase)
  $commandMatches = -not $ExpectedCommandToken -or $commandLine.IndexOf($ExpectedCommandToken, [StringComparison]::OrdinalIgnoreCase) -ge 0
  if (-not $pathMatches -or -not $commandMatches) {
    Remove-StalePidFile $PidPath "$Label reused-pid=$pidValue"
    return $null
  }
  return $record
}

function Start-Ollama {
  param([object]$Config)
  Import-Models
  Ensure-Directory $OllamaModels
  Ensure-Directory $StateRoot
  Ensure-Directory $LogRoot
  $ollama = Join-Path $InstallRoot "runtime\ollama\ollama.exe"
  $tracked = Get-TrackedProcess $OllamaPidPath $ollama "serve" "Ollama"
  if (-not $tracked) {
    $env:OLLAMA_HOST = "127.0.0.1:$([int]$Config.aiPort)"
    $env:OLLAMA_MODELS = $OllamaModels
    $process = Start-Process -FilePath $ollama -ArgumentList "serve" -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput (Join-Path $LogRoot "ollama.stdout.log") `
      -RedirectStandardError (Join-Path $LogRoot "ollama.stderr.log")
    $process.Id | Set-Content -LiteralPath $OllamaPidPath -Encoding ascii
  }
  $tags = Wait-JsonEndpoint "http://127.0.0.1:$([int]$Config.aiPort)/api/tags" 60
  if (-not $tags) { Deny "OLLAMA_START_FAILED" "The loopback Ollama endpoint did not become ready." }
  $names = @($tags.models | ForEach-Object { Normalize-OllamaModelName ([string]$_.name) })
  $required = @([string]$Config.chatModel, [string]$Config.embeddingModel)
  $missing = @($required | Where-Object { (Normalize-OllamaModelName $_) -notin $names })
  if ($missing.Count -gt 0 -and -not $AllowMissingModels) {
    Deny "LOCAL_MODEL_NOT_INSTALLED" ("Extract the model artifact beside the package or pass -ModelSource. Missing: " + ($missing -join ', '))
  }
}

function Clear-RemoteProviderSecrets {
  foreach ($key in @("ANTHROPIC_API_KEY", "GROQ_API_KEY", "OPENAI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "AI_GATEWAY_API_KEY", "VERCEL_AI_GATEWAY_API_KEY")) {
    if ([Environment]::GetEnvironmentVariable($key, "Process")) {
      Write-Event "COUNTY_DEVELOPMENT_REMOTE_PROVIDER_SECRET_FORBIDDEN" "$key removed from the County child runtime"
    }
    [Environment]::SetEnvironmentVariable($key, $null, "Process")
  }
}

function Test-HealthyCountyRuntime {
  param([object]$Health, [object]$Config)
  if (-not $Health) { return $false }
  return $Health.deployment.profile -eq "county-development" -and
    $Health.deployment.deploymentId -eq [string]$Config.deploymentId -and
    [bool]$Health.deployment.valid -and
    [bool]$Health.deployment.localOnlyInference -and
    $Health.deployment.serviceOrigin -eq "http://127.0.0.1:$([int]$Config.appPort)" -and
    [bool]$Health.checks.runtime.ok -and
    $Health.checks.runtime.chatModel -eq [string]$Config.chatModel -and
    $Health.checks.runtime.embeddingModel -eq [string]$Config.embeddingModel
}

function Start-WilliamOS {
  param([object]$Config, [object]$Secrets)
  Ensure-Directory $StateRoot
  Ensure-Directory $LogRoot

  $port = [int]$Config.appPort
  $origin = "http://127.0.0.1:$port"
  if (-not (Test-LoopbackUrl $origin @('http'))) { Deny "SERVICE_ORIGIN_INVALID" $origin }
  $databaseUrl = "postgresql://williamos:$([string]$Secrets.postgresPassword)@127.0.0.1:$([int]$Config.postgresPort)/williamos?sslmode=disable"
  $node = Join-Path $InstallRoot "runtime\node\node.exe"
  $app = Join-Path $InstallRoot "app"

  $tracked = Get-TrackedProcess $AppPidPath $node "server.js" "WilliamOS"
  if ($tracked) {
    $existingHealth = Wait-JsonEndpoint "$origin/api/health" 10
    if (Test-HealthyCountyRuntime $existingHealth $Config) { return }
    Stop-Process -Id ([int]$tracked.ProcessId) -Force
    Remove-Item -LiteralPath $AppPidPath -Force -ErrorAction SilentlyContinue
    Write-Event "UNHEALTHY_PROCESS_RESTARTED" "WilliamOS pid=$([int]$tracked.ProcessId)"
  }

  Clear-RemoteProviderSecrets
  $env:NODE_ENV = "production"
  $env:HOSTNAME = "127.0.0.1"
  $env:PORT = "$port"
  $env:DATABASE_URL = $databaseUrl
  $env:BETTER_AUTH_SECRET = [string]$Secrets.authSecret
  $env:BETTER_AUTH_URL = $origin
  $env:BETTER_AUTH_TRUSTED_ORIGINS = $origin
  $env:AUTH_SIGNUP_MODE = "bootstrap"
  $env:LOCAL_SETUP_ENABLED = "false"
  $env:WILLIAMOS_OWNER_EMAIL = [string]$Config.ownerEmail
  $env:WILLIAMOS_TERRAFUSION_ROOT = [string]$Config.terraFusionRoot
  $env:WILLIAMOS_TERRAFUSION_SPACE_IDENTITY = [string]$Config.terraFusionRoot
  $env:WILLIAMOS_DEPLOYMENT_PROFILE = "county-development"
  $env:WILLIAMOS_DEPLOYMENT_ID = [string]$Config.deploymentId
  $env:WILLIAMOS_AI_BASE_URL = "http://127.0.0.1:$([int]$Config.aiPort)/v1"
  $env:WILLIAMOS_AI_MODEL = [string]$Config.chatModel
  $env:WILLIAMOS_EMBEDDING_MODEL = [string]$Config.embeddingModel
  if ($Config.previewUrl) { $env:WILLIAMOS_WORKSPACE_APP_URL = [string]$Config.previewUrl }
  else { Remove-Item Env:WILLIAMOS_WORKSPACE_APP_URL -ErrorAction SilentlyContinue }

  $process = Start-Process -FilePath $node -ArgumentList "server.js" -WorkingDirectory $app `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $LogRoot "williamos.stdout.log") `
    -RedirectStandardError (Join-Path $LogRoot "williamos.stderr.log")
  $process.Id | Set-Content -LiteralPath $AppPidPath -Encoding ascii

  $health = Wait-JsonEndpoint "$origin/api/health" 90
  if (-not $health) { Deny "WILLIAMOS_START_FAILED" "The local WilliamOS health endpoint did not answer." }
  if (-not (Test-HealthyCountyRuntime $health $Config)) {
    $detail = if ($health.deployment.violations) { $health.deployment.violations -join ', ' } else { "Exact County runtime/model health was not proven." }
    Deny "COUNTY_BOUNDARY_UNPROVEN" $detail
  }
}

function Get-OwnerCount {
  param([object]$Config, [object]$Secrets)
  $psql = Join-Path $InstallRoot "runtime\postgres\bin\psql.exe"
  $previous = $env:PGPASSWORD
  try {
    $env:PGPASSWORD = [string]$Secrets.postgresPassword
    $result = & $psql -h 127.0.0.1 -p ([int]$Config.postgresPort) -U williamos -d williamos -tAc 'SELECT count(*) FROM "user";' 2>$null
    if ($LASTEXITCODE -ne 0) { return 0 }
    return [int](("$result").Trim())
  } finally {
    $env:PGPASSWORD = $previous
  }
}

function Open-OwnerSurface {
  param([object]$Config, [object]$Secrets)
  $origin = "http://127.0.0.1:$([int]$Config.appPort)"
  if ((Get-OwnerCount $Config $Secrets) -eq 0) {
    Write-Event "OWNER_BOOTSTRAP_REQUIRED" "$origin/sign-up"
    if (-not $NonInteractive) { Start-Process "$origin/sign-up" }
    return
  }
  if ($SkipCockpit -or $NonInteractive) { return }
  $cockpit = Join-Path $InstallRoot "cockpit\williamos-cockpit.exe"
  Start-Process -FilePath $cockpit -WorkingDirectory (Split-Path -Parent $cockpit) | Out-Null
}

function Stop-TrackedProcess {
  param(
    [string]$PidPath,
    [string]$Label,
    [string]$ExpectedExecutable,
    [string]$ExpectedCommandToken
  )
  $process = Get-TrackedProcess $PidPath $ExpectedExecutable $ExpectedCommandToken $Label
  if ($process) {
    Stop-Process -Id ([int]$process.ProcessId) -Force
    Write-Event "STOPPED" "$Label pid=$([int]$process.ProcessId)"
  }
  Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
}

function Stop-All {
  Stop-TrackedProcess $AppPidPath "WilliamOS" (Join-Path $InstallRoot "runtime\node\node.exe") "server.js"
  Stop-TrackedProcess $OllamaPidPath "Ollama" (Join-Path $InstallRoot "runtime\ollama\ollama.exe") "serve"
  $pgCtl = Join-Path $InstallRoot "runtime\postgres\bin\pg_ctl.exe"
  if ((Test-Path $pgCtl) -and (Test-Path (Join-Path $PostgresData "PG_VERSION"))) {
    & $pgCtl status -D $PostgresData *> $null
    if ($LASTEXITCODE -eq 0) {
      & $pgCtl stop -D $PostgresData -m fast -w | Out-Null
      Write-Event "STOPPED" "PostgreSQL"
    }
  }
}

function Get-StatusObject {
  $config = Read-JsonFile $ConfigPath
  $origin = if ($config) { "http://127.0.0.1:$([int]$config.appPort)" } else { $null }
  $health = $null
  if ($origin) {
    try { $health = Invoke-RestMethod -Uri "$origin/api/health" -TimeoutSec 5 -UseBasicParsing }
    catch { $health = $null }
  }
  $app = Get-TrackedProcess $AppPidPath (Join-Path $InstallRoot "runtime\node\node.exe") "server.js" "WilliamOS"
  $ollama = Get-TrackedProcess $OllamaPidPath (Join-Path $InstallRoot "runtime\ollama\ollama.exe") "serve" "Ollama"
  return [ordered]@{
    schema = "williamos.county-development.status.v1"
    installed = Test-Path -LiteralPath (Join-Path $InstallRoot "app\server.js")
    configured = $null -ne $config
    installRoot = $InstallRoot
    dataRoot = $DataRoot
    serviceOrigin = $origin
    health = $health
    appProcess = if ($app) { [int]$app.ProcessId } else { $null }
    ollamaProcess = if ($ollama) { [int]$ollama.ProcessId } else { $null }
    observedAt = [DateTimeOffset]::UtcNow.ToString('o')
  }
}

function Install-Package {
  $manifest = Test-PackageManifest $PackageRoot
  if ($PackageRoot -ine $InstallRoot) {
    Copy-Tree $PackageRoot $InstallRoot @((Join-Path $PackageRoot "models"))
  }
  Ensure-Directory $DataRoot
  Ensure-Directory $StateRoot
  Ensure-Directory $LogRoot
  Assert-InstalledPayload
  $config = Resolve-InitialConfiguration $manifest
  $secrets = Ensure-Secrets
  Start-Postgres $config $secrets
  Start-Ollama $config
  Start-WilliamOS $config $secrets
  Open-OwnerSurface $config $secrets
  Write-Event "COUNTY_DEVELOPMENT_RUNNING" ([string]$config.deploymentId)
}

function Start-Installed {
  Assert-InstalledPayload
  $config = Read-JsonFile $ConfigPath
  $secrets = Read-JsonFile $SecretsPath
  if (-not $config -or -not $secrets) { Deny "COUNTY_CONFIGURATION_MISSING" "Run Install from the extracted package first." }
  Assert-TerraFusionCheckout ([string]$config.terraFusionRoot) | Out-Null
  Start-Postgres $config $secrets
  Start-Ollama $config
  Start-WilliamOS $config $secrets
  Open-OwnerSurface $config $secrets
  Write-Event "COUNTY_DEVELOPMENT_RUNNING" ([string]$config.deploymentId)
}

switch ($Action) {
  "Launch" {
    $installationComplete = (Test-Path -LiteralPath (Join-Path $InstallRoot "app\server.js") -PathType Leaf) -and
      (Test-Path -LiteralPath $ConfigPath -PathType Leaf) -and
      (Test-Path -LiteralPath $SecretsPath -PathType Leaf)
    if ($installationComplete) { Start-Installed }
    else { Install-Package }
  }
  "Install" { Install-Package }
  "Start" { Start-Installed }
  "Stop" { Stop-All }
  "Status" { Get-StatusObject | ConvertTo-Json -Depth 10 }
  "Uninstall" {
    Stop-All
    if (Test-Path -LiteralPath $InstallRoot) { Remove-Item -LiteralPath $InstallRoot -Recurse -Force }
    if ($PurgeData -and (Test-Path -LiteralPath $DataRoot)) { Remove-Item -LiteralPath $DataRoot -Recurse -Force }
    Write-Host "WilliamOS County Development program files removed. Data purged: $([bool]$PurgeData)"
  }
}
