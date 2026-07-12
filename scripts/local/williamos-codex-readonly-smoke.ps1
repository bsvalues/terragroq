[CmdletBinding()]
param([int]$TimeoutSeconds = 300)

$ErrorActionPreference = "Stop"
$root = "$env:USERPROFILE\.williamos\runtime-operator"
$activation = Join-Path $root "control\activation"
if (-not (Test-Path -LiteralPath $activation -PathType Leaf) -or (Get-Content -Raw -LiteralPath $activation) -cne "disabled") { throw "SMOKE_REQUIRES_DISABLED_ACTIVATION" }

$workspace = Join-Path $root "workspace\authenticated-readonly-smoke"
if (Test-Path -LiteralPath $workspace) { throw "SMOKE_WORKSPACE_EXISTS_WALL" }
New-Item -ItemType Directory -Path $workspace | Out-Null
try {
  [IO.File]::WriteAllText((Join-Path $workspace "SMOKE.md"), "WilliamOS authenticated read-only smoke. No repository change is requested.", [Text.UTF8Encoding]::new($false))
  $prompt = Join-Path $workspace "prompt.md"
  $result = Join-Path $workspace "result.json"
  [IO.File]::WriteAllText($prompt, "Inspect SMOKE.md. Make no changes. Return JSON matching the supplied schema with schemaVersion 1, workOrderId WO-RUNTIME-IDENTITY-027, result NO_CHANGE, a short summary, and unifiedPatch as an empty string.", [Text.UTF8Encoding]::new($false))
  & "$PSScriptRoot\williamos-codex-exec.ps1" -Workspace $workspace -PromptFile $prompt -ResultFile $result -TimeoutSeconds $TimeoutSeconds | Out-Null
  $parsed = Get-Content -Raw -LiteralPath $result | ConvertFrom-Json
  if ($parsed.schemaVersion -ne 1 -or $parsed.workOrderId -ne "WO-RUNTIME-IDENTITY-027" -or $parsed.result -ne "NO_CHANGE" -or $parsed.unifiedPatch) { throw "SMOKE_RESULT_WALL" }
  Write-Output "CODEX_READONLY_SMOKE=PASS"
} finally {
  Start-Sleep -Milliseconds 500
  if (Test-Path -LiteralPath $workspace) { Remove-Item -LiteralPath $workspace -Recurse -Force -ErrorAction Stop }
}
