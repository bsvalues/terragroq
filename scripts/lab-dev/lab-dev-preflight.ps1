$ErrorActionPreference = "Stop"

function Invoke-CheckedCommand {
  param([string]$Executable, [string[]]$Arguments)
  $output = @(& $Executable @Arguments 2>$null)
  return [PSCustomObject]@{ ExitCode = $LASTEXITCODE; Output = @($output | ForEach-Object { [string]$_ }) }
}

function ConvertTo-RepositoryIdentity {
  param([string]$Remote)
  $value = $Remote.Trim()
  if ($value -match '^git@github\.com:(?<owner>[A-Za-z0-9_.-]+)/(?<repo>[A-Za-z0-9_.-]+?)(?:\.git)?$') { return "$($Matches.owner)/$($Matches.repo)" }
  if ($value -match '^https://github\.com/(?<owner>[A-Za-z0-9_.-]+)/(?<repo>[A-Za-z0-9_.-]+?)(?:\.git)?/?$') { return "$($Matches.owner)/$($Matches.repo)" }
  return $null
}

function Test-SourceContract {
  param($Source, [string]$RepositoryPath, [string]$GitExecutable, [string]$Marker)
  try {
    $remote = Invoke-CheckedCommand $GitExecutable @("-C", $RepositoryPath, "config", "--get", "remote.origin.url")
    if ($remote.ExitCode -ne 0 -or $remote.Output.Count -ne 1 -or (ConvertTo-RepositoryIdentity $remote.Output[0]) -cne $Source.repository) { return "SOURCE_REMOTE_IDENTITY_MISMATCH" }
    $gitDir = Invoke-CheckedCommand $GitExecutable @("-C", $RepositoryPath, "rev-parse", "--git-dir")
    $commonDir = Invoke-CheckedCommand $GitExecutable @("-C", $RepositoryPath, "rev-parse", "--git-common-dir")
    if ($gitDir.ExitCode -ne 0 -or $commonDir.ExitCode -ne 0 -or $gitDir.Output.Count -ne 1 -or $commonDir.Output.Count -ne 1) { return "SOURCE_GIT_FAILURE" }
    if ($gitDir.Output[0].Trim() -eq $commonDir.Output[0].Trim()) { return "SOURCE_SHARED_CHECKOUT" }
    $status = Invoke-CheckedCommand $GitExecutable @("-C", $RepositoryPath, "status", "--porcelain")
    if ($status.ExitCode -ne 0) { return "SOURCE_GIT_FAILURE" }
    if (($status.Output -join "").Trim().Length -ne 0) { return "SOURCE_DIRTY" }
    $branch = Invoke-CheckedCommand $GitExecutable @("-C", $RepositoryPath, "branch", "--show-current")
    if ($branch.ExitCode -ne 0 -or $branch.Output.Count -ne 1 -or [string]::IsNullOrWhiteSpace($branch.Output[0])) { return "SOURCE_BRANCH_UNNAMED" }
    $mainRef = Invoke-CheckedCommand $GitExecutable @("-C", $RepositoryPath, "rev-parse", "refs/heads/$($Source.branch)")
    $ancestor = Invoke-CheckedCommand $GitExecutable @("-C", $RepositoryPath, "merge-base", "--is-ancestor", "refs/heads/$($Source.branch)", "HEAD")
    if ($mainRef.ExitCode -ne 0 -or $ancestor.ExitCode -ne 0) { return "SOURCE_MAIN_NOT_ANCESTOR" }
    if ($Marker -and -not (Test-Path -LiteralPath (Join-Path $RepositoryPath $Marker) -PathType Leaf)) { return "SOURCE_MARKER_MISSING" }
    return "READY"
  } catch { return "SOURCE_GIT_FAILURE" }
}

function Get-RemoteRecords {
  param([string]$SshExecutable, [string]$Alias, [string]$Command)
  return Invoke-CheckedCommand $SshExecutable @("-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "-o", "ConnectionAttempts=1", $Alias, $Command)
}

function Get-ContainerRecords {
  param([string[]]$Output)
  $records = @()
  foreach ($line in $Output) {
    if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith("COMPOSE_SERVICES=")) { continue }
    $parts = $line.Split("|", 5)
    if ($parts.Count -ne 5 -or @($parts | Where-Object { [string]::IsNullOrWhiteSpace($_) }).Count -ne 0) { return $null }
    $records += [PSCustomObject]@{ Name = $parts[0]; Image = $parts[1]; Running = $parts[2]; Health = $parts[3]; PublishedPorts = $parts[4] }
  }
  return @($records)
}

function Test-ContainerTopology {
  param([object[]]$Records, $RequiredContainers, $AdvertisedContainers)
  $expected = @{}
  foreach ($property in $RequiredContainers.PSObject.Properties) { $expected[$property.Name] = [int]$property.Value }
  foreach ($property in $AdvertisedContainers.PSObject.Properties) { $expected[$property.Name] = [int]$property.Value }
  $actualNames = @($Records | ForEach-Object { $_.Name } | Sort-Object -Unique)
  $expectedNames = @($expected.Keys | Sort-Object)
  if (Compare-Object -ReferenceObject $expectedNames -DifferenceObject $actualNames) { return $false }
  foreach ($name in $expectedNames) {
    $record = @($Records | Where-Object { $_.Name -eq $name })
    if ($record.Count -ne 1 -or $record[0].Running -ne "running" -or $record[0].Health -notin @("healthy", "none")) { return $false }
    if ($record[0].PublishedPorts -notmatch "(^|,)$($expected[$name])(,|$)") { return $false }
  }
  return $true
}

function Get-ComposeServices {
  param([string[]]$Output)
  $line = @($Output | Where-Object { $_.StartsWith("COMPOSE_SERVICES=") })
  if ($line.Count -ne 1) { return $null }
  return @($line[0].Substring("COMPOSE_SERVICES=".Length).Split(",") | Where-Object { $_ })
}

function Test-DatabaseIsolation {
  param([string]$WilliamOsPath)
  try {
    $readme = Get-Content -LiteralPath (Join-Path $WilliamOsPath "README.md") -Raw
    $runbook = Get-Content -LiteralPath (Join-Path $WilliamOsPath "docs/runbooks/local-williamos-operator-runbook.md") -Raw
    if ($readme -notmatch '(?i)\bNeon\b') { return "NEON_CONTRACT_MISSING" }
    if ($runbook -notmatch '(?i)point\s+WilliamOS\s+`DATABASE_URL`\s+at\s+TerraFusion\s+PostgreSQL') { return "TERRAFUSION_DATABASE_PROHIBITION_MISSING" }
    return "PRESERVED"
  } catch { return "DATABASE_ISOLATION_EVIDENCE_MISSING" }
}

try {
  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
  $manifest = Get-Content -LiteralPath (Join-Path $repoRoot "config/lab-dev-topology.json") -Raw | ConvertFrom-Json
  if ($manifest.schemaVersion -ne 1 -or $manifest.workOrderId -ne "WO-OMEN-STAGE5-DEV-PREFLIGHT-001") { throw "Invalid topology manifest" }
  if ($env:LAB_DEV_NOW_UTC) { [DateTime]::Parse($env:LAB_DEV_NOW_UTC).ToUniversalTime() | Out-Null }
  $gitExecutable = if ($env:LAB_DEV_GIT_EXECUTABLE) { $env:LAB_DEV_GIT_EXECUTABLE } else { "git" }
  $sshExecutable = if ($env:LAB_DEV_SSH_EXECUTABLE) { $env:LAB_DEV_SSH_EXECUTABLE } else { "ssh" }
  $terrafusionPath = if ($env:TERRAFUSION_REPO_PATH) { $env:TERRAFUSION_REPO_PATH } else { "C:\Users\bsval\terrafusion_os_1.0" }
  $williamosPath = if ($env:WILLIAMOS_REPO_PATH) { $env:WILLIAMOS_REPO_PATH } else { $repoRoot }

  $results = [ordered]@{}
  $results.TERRAFUSION_SOURCE = Test-SourceContract $manifest.sources.terrafusion $terrafusionPath $gitExecutable $manifest.sources.terrafusion.canonicalMarker
  $results.WILLIAMOS_SOURCE = Test-SourceContract $manifest.sources.williamos $williamosPath $gitExecutable

  $hermesPayload = @'
docker ps --format '{{.Names}}|{{.Image}}|{{.State}}|{{.Status}}|{{.Ports}}' | ForEach-Object {
  $fields = $_.Split('|', 5)
  $health = if ($fields[3] -match '\((healthy|unhealthy)\)') { $Matches[1] } else { 'none' }
  $ports = @([regex]::Matches($fields[4], ':(\d+)->') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique) -join ','
  "$($fields[0])|$($fields[1])|$($fields[2])|$health|$ports"
}
'@
  $hermesEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($hermesPayload))
  $hermesProbe = Get-RemoteRecords $sshExecutable $manifest.nodes.hermes.sshAlias "powershell -NoProfile -NonInteractive -EncodedCommand $hermesEncoded"
  $hermesRecords = Get-ContainerRecords $hermesProbe.Output
  $results.HERMES_COMPUTE = if ($hermesProbe.ExitCode -eq 0 -and $hermesRecords -and (Test-ContainerTopology $hermesRecords $manifest.nodes.hermes.requiredContainers $manifest.nodes.hermes.advertisedContainers)) { "AVAILABLE" } else { "HERMES_METADATA_UNAVAILABLE" }

  $atlasPayload = @'
set -eu
docker ps --format '{{.Names}}|{{.Image}}|{{.State}}|{{.Status}}|{{.Ports}}' | awk -F'|' '{
  health = "none"
  if ($4 ~ /\(healthy\)/) health = "healthy"
  if ($4 ~ /\(unhealthy\)/) health = "unhealthy"
  ports = ""
  if (match($5, /:[0-9][0-9]*->/)) ports = substr($5, RSTART + 1, RLENGTH - 3)
  print $1 "|" $2 "|" $3 "|" health "|" ports
}'
docker compose -f '__COMPOSE_FILE__' config --services | sort | paste -sd, - | sed 's/^/COMPOSE_SERVICES=/'
'@.Replace("__COMPOSE_FILE__", [string]$manifest.nodes.'atlas-node'.composeFile)
  $atlasEncoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($atlasPayload))
  $atlasProbe = Get-RemoteRecords $sshExecutable $manifest.nodes.'atlas-node'.sshAlias "printf %s $atlasEncoded | base64 -d | sh"
  $atlasRecords = Get-ContainerRecords $atlasProbe.Output
  $atlasExpected = $manifest.nodes.'atlas-node'.advertisedContainers
  $atlasNames = @($atlasExpected.PSObject.Properties | ForEach-Object { $_.Name } | Sort-Object)
  $composeNames = Get-ComposeServices $atlasProbe.Output
  $composeMatches = $composeNames -and -not (Compare-Object -ReferenceObject $atlasNames -DifferenceObject @($composeNames | Sort-Object))
  $results.ATLAS_STATE_ENDPOINTS = if ($atlasProbe.ExitCode -eq 0 -and $atlasRecords -and $composeMatches -and (Test-ContainerTopology $atlasRecords ([PSCustomObject]@{}) $atlasExpected)) { "ADVERTISED" } else { "ATLAS_METADATA_UNAVAILABLE" }
  $results.WILLIAMOS_DB_ISOLATION = Test-DatabaseIsolation $williamosPath
  $allGreen = $results.TERRAFUSION_SOURCE -eq "READY" -and $results.WILLIAMOS_SOURCE -eq "READY" -and $results.HERMES_COMPUTE -eq "AVAILABLE" -and $results.ATLAS_STATE_ENDPOINTS -eq "ADVERTISED" -and $results.WILLIAMOS_DB_ISOLATION -eq "PRESERVED"
  $results.PRODUCT_FLOW = if ($allGreen) { "READY_FOR_DISPOSABLE_CONFIGURATION_PROOF" } else { "BLOCKED" }
  foreach ($entry in $results.GetEnumerator()) { Write-Output "$($entry.Key)=$($entry.Value)" }
  if (-not $allGreen) {
    $blocker = @($results.GetEnumerator() | Where-Object { $_.Key -ne "PRODUCT_FLOW" -and $_.Value -notin @("READY", "AVAILABLE", "ADVERTISED", "PRESERVED") } | Select-Object -First 1)[0]
    Write-Output "BLOCKER=$($blocker.Key)_$($blocker.Value)"
    exit 2
  }
  exit 0
} catch {
  Write-Output "TERRAFUSION_SOURCE=SOURCE_CONFIGURATION_INVALID"
  Write-Output "WILLIAMOS_SOURCE=SOURCE_CONFIGURATION_INVALID"
  Write-Output "HERMES_COMPUTE=HERMES_METADATA_UNAVAILABLE"
  Write-Output "ATLAS_STATE_ENDPOINTS=ATLAS_METADATA_UNAVAILABLE"
  Write-Output "WILLIAMOS_DB_ISOLATION=DATABASE_ISOLATION_EVIDENCE_MISSING"
  Write-Output "PRODUCT_FLOW=BLOCKED"
  Write-Output "BLOCKER=PRECHECK_CONFIGURATION_INVALID"
  exit 2
}
