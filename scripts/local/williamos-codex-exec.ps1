[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Workspace,
  [Parameter(Mandatory)][string]$PromptFile,
  [Parameter(Mandatory)][string]$ResultFile,
  [int]$TimeoutSeconds = 1800
)

$ErrorActionPreference = "Stop"
Import-Module "$PSScriptRoot\..\..\runtime-operator\native\WilliamOS.RuntimeExecution.psm1" -Force
$auth = & "$PSScriptRoot\williamos-codex-auth-status.ps1"
if ($auth -ne "CODEX_AUTH_STATUS=READY_CHATGPT_KEYRING") { throw "CODEX_AUTHORITY_WALL" }
$schema = "$PSScriptRoot\..\..\runtime-operator\codex-output.schema.json"
$prompt = Get-Content -Raw -LiteralPath $PromptFile
$result = Invoke-BoundedProcess codex @("--ask-for-approval", "never", "exec", "--sandbox", "workspace-write", "--output-schema", $schema, "--output-last-message", $ResultFile, "-") $Workspace $TimeoutSeconds 1048576 $prompt
if ($result.exitCode -ne 0) { throw "CODEX_EXECUTION_WALL" }
if (-not (Test-Path -LiteralPath $ResultFile -PathType Leaf) -or (Get-Item -LiteralPath $ResultFile).Length -gt 1048576) { throw "CODEX_RESULT_WALL" }
Write-Output "CODEX_EXECUTION_STATUS=RESULT_READY"
