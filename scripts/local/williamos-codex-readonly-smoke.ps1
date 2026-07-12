[CmdletBinding()]
param([int]$TimeoutSeconds = 300, [ValidateRange(1, 3)][int]$MaxAttempts = 3)

$ErrorActionPreference = "Stop"
$root = "$env:USERPROFILE\.williamos\runtime-operator"
$activation = Join-Path $root "control\activation"
if (-not (Test-Path -LiteralPath $activation -PathType Leaf) -or (Get-Content -Raw -LiteralPath $activation) -cne "disabled") { throw "SMOKE_REQUIRES_DISABLED_ACTIVATION" }

$workspace = Join-Path $root "workspace\authenticated-readonly-smoke"
if (Test-Path -LiteralPath $workspace) {
  $stale = Get-Item -LiteralPath $workspace -Force
  if (-not $stale.PSIsContainer -or $stale.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) { throw "SMOKE_WORKSPACE_EXISTS_WALL" }
  if (Get-ChildItem -LiteralPath $workspace -Force | Select-Object -First 1) { throw "SMOKE_WORKSPACE_EXISTS_WALL" }
  $referenced = Get-CimInstance Win32_Process | Where-Object {
    $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains($workspace, [StringComparison]::OrdinalIgnoreCase)
  } | Select-Object -First 1
  if ($referenced) { throw "SMOKE_WORKSPACE_ACTIVE_WALL" }
  Remove-Item -LiteralPath $workspace -Force
}
New-Item -ItemType Directory -Path $workspace | Out-Null
try {
  [IO.File]::WriteAllText((Join-Path $workspace "SMOKE.md"), "WilliamOS authenticated read-only smoke. No repository change is requested.", [Text.UTF8Encoding]::new($false))
  $prompt = Join-Path $workspace "prompt.md"
  $result = Join-Path $workspace "result.json"
  [IO.File]::WriteAllText($prompt, "Inspect SMOKE.md. Make no changes. Return JSON matching the supplied schema with schemaVersion 1, workOrderId WO-RUNTIME-IDENTITY-027, result NO_CHANGE, a short summary, and unifiedPatch as an empty string.", [Text.UTF8Encoding]::new($false))
  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    try {
      & "$PSScriptRoot\williamos-codex-exec.ps1" -Workspace $workspace -PromptFile $prompt -ResultFile $result -TimeoutSeconds $TimeoutSeconds | Out-Null
      break
    } catch {
      if ($_.Exception.Message -ne "CODEX_NETWORK_WALL" -or $attempt -eq $MaxAttempts) { throw }
      Start-Sleep -Seconds (15 * $attempt)
    }
  }
  $parsed = Get-Content -Raw -LiteralPath $result | ConvertFrom-Json
  if ($parsed.schemaVersion -ne 1 -or $parsed.workOrderId -ne "WO-RUNTIME-IDENTITY-027" -or $parsed.result -ne "NO_CHANGE" -or $parsed.unifiedPatch) { throw "SMOKE_RESULT_WALL" }
  Write-Output "CODEX_READONLY_SMOKE=PASS"
} finally {
  Start-Sleep -Milliseconds 500
  if (Test-Path -LiteralPath $workspace) { Remove-Item -LiteralPath $workspace -Recurse -Force -ErrorAction Stop }
}
