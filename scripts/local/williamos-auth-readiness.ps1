[CmdletBinding()]
param([string]$ExpectedGitHubAccount = "bsvalues")

$ErrorActionPreference = "Stop"
$scriptRoot = $PSScriptRoot

function Invoke-SanitizedStatus([string]$Script, [string[]]$Arguments = @()) {
  $output = & pwsh -NoProfile -File (Join-Path $scriptRoot $Script) @Arguments 2>$null | Out-String
  return $output.Trim()
}

$codexResult = Invoke-SanitizedStatus "williamos-codex-auth-status.ps1"
$githubResult = Invoke-SanitizedStatus "williamos-github-auth-status.ps1" @("-ExpectedAccount", $ExpectedGitHubAccount)
$identityResult = Invoke-SanitizedStatus "williamos-identity-context.ps1"
$activationPath = "$env:USERPROFILE\.williamos\runtime-operator\control\activation"
$activation = if ((Test-Path -LiteralPath $activationPath -PathType Leaf) -and (Get-Content -Raw -LiteralPath $activationPath) -ceq "enabled") { "enabled" } else { "disabled" }

$codexAuth = if ($codexResult -eq "CODEX_AUTH_STATUS=READY_CHATGPT_KEYRING") { "ready" } elseif ($codexResult -eq "CODEX_AUTH_STATUS=OWNER_LOGIN_REQUIRED") { "missing" } else { "unknown" }
$githubAuth = if ($githubResult -eq "GITHUB_AUTH_STATUS=READY_BROWSER_KEYRING_ACCOUNT_$ExpectedGitHubAccount") { "ready" } elseif ($githubResult -eq "GITHUB_AUTH_STATUS=OWNER_LOGIN_REQUIRED") { "missing" } else { "unknown" }
$identityContext = if ($identityResult -eq "IDENTITY_CONTEXT=EXPECTED_NON_ELEVATED_WINDOWS_USER") { "expected" } else { "unexpected" }

[ordered]@{
  codexAuth = $codexAuth
  githubAuth = $githubAuth
  activation = $activation
  identityContext = $identityContext
  ready = $codexAuth -eq "ready" -and $githubAuth -eq "ready" -and $identityContext -eq "expected" -and $activation -eq "enabled"
} | ConvertTo-Json -Compress
