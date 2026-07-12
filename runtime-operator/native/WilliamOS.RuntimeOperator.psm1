Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:CheckpointStates = @("READY", "LEASED", "PATCH_PREPARED", "VALIDATING", "PR_OPEN", "REVIEW_REMEDIATION", "MERGE_READY", "COMPLETED", "BLOCKED", "FAILED_RECOVERABLE", "FAILED_TERMINAL")

function Test-ReparsePoint([string]$Path) {
  return (Get-Item -LiteralPath $Path -Force).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)
}

function Initialize-WilliamOSRuntimeRoot([string]$Root = "$env:USERPROFILE\.williamos\runtime-operator") {
  $current = [Security.Principal.WindowsIdentity]::GetCurrent()
  New-Item -ItemType Directory -Force -Path $Root | Out-Null
  if (Test-ReparsePoint $Root) { throw "RUNTIME_ROOT_REPARSE_WALL" }
  foreach ($child in @("control", "state", "audit", "workspace", "locks")) {
    $path = Join-Path $Root $child
    New-Item -ItemType Directory -Force -Path $path | Out-Null
    if (Test-ReparsePoint $path) { throw "RUNTIME_CHILD_REPARSE_WALL: $child" }
  }
  $acl = Get-Acl -LiteralPath $Root
  if ($acl.Owner -notmatch [regex]::Escape(($current.Name -split '\\')[-1])) { throw "RUNTIME_ROOT_OWNER_WALL" }
  $unsafe = $acl.Access | Where-Object {
    $_.AccessControlType -eq "Allow" -and
    $_.IdentityReference -match 'Everyone|BUILTIN\\Users|Authenticated Users' -and
    ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Write) -ne 0
  }
  if ($unsafe) { throw "RUNTIME_ROOT_PERMISSIVE_ACL_WALL" }
  return $Root
}

function Get-WilliamOSActivation([string]$Root) {
  $path = Join-Path $Root "control\activation"
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return "disabled" }
  if (Test-ReparsePoint $path) { return "disabled" }
  if ((Get-Content -Raw -LiteralPath $path) -ceq "enabled") { return "enabled" }
  return "disabled"
}

function Set-WilliamOSDisabled([string]$Root) {
  $path = Join-Path $Root "control\activation"
  [IO.File]::WriteAllText($path, "disabled", [Text.UTF8Encoding]::new($false))
}

function Write-WilliamOSAudit([string]$Root, [string]$Event, [hashtable]$Fields = @{}) {
  $forbidden = ($Fields.Keys | Where-Object { $_ -match '(?i)token|secret|prompt|patch|environment|auth(output|cache)?' })
  if ($forbidden) { throw "AUDIT_FIELD_WALL" }
  $path = Join-Path $Root "audit\native-events.jsonl"
  $previousHash = "GENESIS"
  if (Test-Path -LiteralPath $path -PathType Leaf) {
    $last = Get-Content -LiteralPath $path -Tail 1
    if ($last) { try { $previousHash = ($last | ConvertFrom-Json).hash } catch { $previousHash = "INVALID_PREVIOUS_RECORD" } }
  }
  $record = [ordered]@{ at = [DateTimeOffset]::UtcNow.ToString("o"); event = $Event; previousHash = $previousHash; fields = $Fields }
  $canonical = $record | ConvertTo-Json -Compress -Depth 5
  $bytes = [Text.Encoding]::UTF8.GetBytes($canonical)
  $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
  Add-Content -LiteralPath $path -Encoding utf8 -Value (($record + @{ hash = $hash }) | ConvertTo-Json -Compress -Depth 5)
}

function Enter-WilliamOSHostLock([string]$Root) {
  $path = Join-Path $Root "locks\supervisor.lock.json"
  if (Test-Path -LiteralPath $path -PathType Leaf) {
    try {
      $existing = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
      $process = Get-Process -Id $existing.pid -ErrorAction Stop
      if ($process.StartTime.ToUniversalTime().Ticks -eq $existing.startTicks) { throw "ACTIVE_SUPERVISOR_LOCK" }
    } catch {
      if ($_.Exception.Message -eq "ACTIVE_SUPERVISOR_LOCK") { throw }
      Remove-Item -LiteralPath $path -Force
    }
  }
  $process = Get-Process -Id $PID
  $payload = @{ pid = $PID; startTicks = $process.StartTime.ToUniversalTime().Ticks; createdAt = [DateTimeOffset]::UtcNow.ToString("o") } | ConvertTo-Json -Compress
  try {
    $stream = [IO.File]::Open($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    $writer = [IO.StreamWriter]::new($stream, [Text.UTF8Encoding]::new($false))
    $writer.Write($payload); $writer.Dispose()
  } catch { throw "ACTIVE_SUPERVISOR_LOCK" }
  return $path
}

function Exit-WilliamOSHostLock([string]$LockPath) {
  if (Test-Path -LiteralPath $LockPath -PathType Leaf) { Remove-Item -LiteralPath $LockPath -Force }
}

function Write-WilliamOSCheckpoint([string]$Root, [hashtable]$Checkpoint) {
  if ($Checkpoint.state -notin $script:CheckpointStates) { throw "CHECKPOINT_STATE_WALL" }
  foreach ($key in @("repository", "goal", "loop", "workOrder", "baseSha", "branch", "attempt")) {
    if (-not $Checkpoint.ContainsKey($key)) { throw "CHECKPOINT_SCHEMA_WALL: $key" }
  }
  if ($Checkpoint.Keys | Where-Object { $_ -match '(?i)token|secret|prompt|modelOutput|environment' }) { throw "CHECKPOINT_FIELD_WALL" }
  $payload = [ordered]@{ schemaVersion = 1 } + $Checkpoint
  $path = Join-Path $Root "state\checkpoint.json"
  $temp = "$path.$PID.tmp"
  [IO.File]::WriteAllText($temp, ($payload | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temp -Destination $path -Force
  return $path
}

function Read-WilliamOSCheckpoint([string]$Root) {
  $path = Join-Path $Root "state\checkpoint.json"
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
  try {
    $value = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
    if ($value.schemaVersion -ne 1 -or $value.state -notin $script:CheckpointStates) { throw "invalid" }
    return $value
  } catch {
    Copy-Item -LiteralPath $path -Destination "$path.corrupt.$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())" -ErrorAction SilentlyContinue
    throw "CORRUPT_CHECKPOINT_WALL"
  }
}

Export-ModuleMember -Function Initialize-WilliamOSRuntimeRoot, Get-WilliamOSActivation, Set-WilliamOSDisabled, Write-WilliamOSAudit, Enter-WilliamOSHostLock, Exit-WilliamOSHostLock, Write-WilliamOSCheckpoint, Read-WilliamOSCheckpoint
