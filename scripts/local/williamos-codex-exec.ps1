[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Workspace,
  [Parameter(Mandatory)][string]$PromptFile,
  [Parameter(Mandatory)][string]$ResultFile,
  [ValidateSet("read-only", "workspace-write")][string]$Sandbox = "workspace-write",
  [int]$TimeoutSeconds = 1800
)

$ErrorActionPreference = "Stop"
Import-Module "$PSScriptRoot\..\..\runtime-operator\native\WilliamOS.RuntimeExecution.psm1" -Force
$auth = & "$PSScriptRoot\williamos-codex-auth-status.ps1"
if ($auth -ne "CODEX_AUTH_STATUS=READY_CHATGPT_KEYRING") { throw "CODEX_AUTHORITY_WALL" }
$schema = "$PSScriptRoot\..\..\runtime-operator\codex-output.schema.json"
$prompt = Get-Content -Raw -LiteralPath $PromptFile
$codex = Get-Command codex -ErrorAction Stop
$arguments = @("--ask-for-approval", "never", "exec", "--skip-git-repo-check", "--sandbox", $Sandbox, "--output-schema", $schema, "--output-last-message", $ResultFile, "-")
if ($codex.Source.EndsWith(".ps1", [StringComparison]::OrdinalIgnoreCase)) {
  $baseDirectory = Split-Path $codex.Source -Parent
  $node = Join-Path $baseDirectory "node.exe"
  if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { $node = (Get-Command node.exe -ErrorAction Stop).Source }
  $entrypoint = Join-Path $baseDirectory "node_modules\@openai\codex\bin\codex.js"
  if (-not (Test-Path -LiteralPath $entrypoint -PathType Leaf)) { throw "CODEX_ENTRYPOINT_WALL" }
  $arguments = @($entrypoint) + $arguments
  $executable = $node
} else {
  $executable = $codex.Source
}
$result = Invoke-BoundedProcess $executable $arguments $Workspace $TimeoutSeconds 1048576 $prompt
if ($result.exitCode -ne 0) {
  $failure = switch -Regex ($result.stderr) {
    '(?i)not logged in|login required|authentication (failed|required)|credentials? (missing|unavailable)|\b401\b' { "CODEX_AUTHORITY_WALL"; break }
    '(?i)invalid.{0,40}schema|schema.{0,40}(invalid|error|unsupported)|failed to parse.{0,20}json' { "CODEX_SCHEMA_WALL"; break }
    '(?i)rate.?limit|too many requests|\b429\b' { "CODEX_RATE_LIMIT_WALL"; break }
    '(?i)network|connect|timed? out|ECONN|TLS|socket' { "CODEX_NETWORK_WALL"; break }
    '(?i)sandbox|approval|permission|access denied' { "CODEX_SANDBOX_WALL"; break }
    default { "CODEX_EXECUTION_WALL" }
  }
  throw $failure
}
if (-not (Test-Path -LiteralPath $ResultFile -PathType Leaf) -or (Get-Item -LiteralPath $ResultFile).Length -gt 1048576) { throw "CODEX_RESULT_WALL" }
Write-Output "CODEX_EXECUTION_STATUS=RESULT_READY"
