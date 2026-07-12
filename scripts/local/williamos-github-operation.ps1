[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet("issue-view", "pr-view", "pr-checks", "pr-create", "pr-merge")][string]$Operation,
  [string]$Number,
  [string]$Head,
  [string]$Title,
  [string]$BodyFile,
  [ValidateSet("R0", "R1")][string]$RiskClass = "R0",
  [switch]$ChecksGreen,
  [switch]$ThreadsResolved
)

$ErrorActionPreference = "Stop"
if ((Test-Path Env:GH_TOKEN) -or (Test-Path Env:GITHUB_TOKEN)) { throw "GITHUB_ENV_TOKEN_WALL" }
$repo = "bsvalues/terragroq"
$auth = & "$PSScriptRoot\williamos-github-auth-status.ps1"
if ($auth -ne "GITHUB_AUTH_STATUS=READY_BROWSER_KEYRING_ACCOUNT_bsvalues") { throw "GITHUB_AUTHORITY_WALL" }
if ($Operation -eq "pr-merge" -and (-not $ChecksGreen -or -not $ThreadsResolved -or $RiskClass -notin @("R0", "R1"))) { throw "MERGE_GATE_WALL" }
switch ($Operation) {
  "issue-view" { & gh issue view $Number --repo $repo --json number,state,title }
  "pr-view" { & gh pr view $Number --repo $repo --json number,state,headRefName,baseRefName,mergeable }
  "pr-checks" { & gh pr checks $Number --repo $repo --json name,state,workflow }
  "pr-create" { & gh pr create --repo $repo --base main --head $Head --title $Title --body-file $BodyFile }
  "pr-merge" { & gh pr merge $Number --repo $repo --squash --delete-branch }
}
if ($LASTEXITCODE -ne 0) { throw "GITHUB_OPERATION_WALL" }
