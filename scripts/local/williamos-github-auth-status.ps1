[CmdletBinding()]
param(
  [string]$ExpectedAccount = "bsvalues",
  [string]$ConfigHome = "$env:APPDATA\GitHub CLI"
)

$ErrorActionPreference = "Stop"
if (Test-Path Env:GH_TOKEN) { throw "GITHUB_ENV_TOKEN_WALL: GH_TOKEN is not accepted" }
if (Test-Path Env:GITHUB_TOKEN) { throw "GITHUB_ENV_TOKEN_WALL: GITHUB_TOKEN is not accepted" }

$hostsPath = Join-Path $ConfigHome "hosts.yml"
if (Test-Path -LiteralPath $hostsPath -PathType Leaf) {
  if (Select-String -LiteralPath $hostsPath -Pattern '^\s*oauth_token\s*:' -Quiet) {
    throw "GITHUB_PLAINTEXT_FALLBACK_WALL"
  }
}

$status = & gh auth status --hostname github.com --active 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) {
  Write-Output "GITHUB_AUTH_STATUS=OWNER_LOGIN_REQUIRED"
  exit 2
}
if ($status -notmatch "(?im)account\s+$([regex]::Escape($ExpectedAccount))\b|logged in to github\.com account $([regex]::Escape($ExpectedAccount))\b") {
  throw "GITHUB_PRINCIPAL_WALL"
}
Write-Output "GITHUB_AUTH_STATUS=READY_BROWSER_KEYRING_ACCOUNT_$ExpectedAccount"
