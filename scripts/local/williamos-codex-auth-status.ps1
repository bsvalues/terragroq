[CmdletBinding()]
param([string]$CodexHome = "$env:USERPROFILE\.codex")

$ErrorActionPreference = "Stop"
$configPath = Join-Path $CodexHome "config.toml"
$fallbackPath = Join-Path $CodexHome "auth.json"
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { throw "CODEX_CONFIG_MISSING" }
if ((Test-Path -LiteralPath $fallbackPath -PathType Leaf) -and (Get-Item -LiteralPath $fallbackPath).Length -gt 0) { throw "PLAINTEXT_FALLBACK_WALL" }

$contract = Get-Content -LiteralPath $configPath | Where-Object { $_ -match '^(forced_login_method|cli_auth_credentials_store)\s*=' }
if ($contract -notcontains 'forced_login_method = "chatgpt"') { throw "CODEX_LOGIN_METHOD_WALL" }
if ($contract -notcontains 'cli_auth_credentials_store = "keyring"') { throw "CODEX_CREDENTIAL_STORE_WALL" }

$status = & codex login status 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or $status -notmatch '(?i)logged in.*chatgpt') {
  Write-Output "CODEX_AUTH_STATUS=OWNER_LOGIN_REQUIRED"
  exit 2
}
Write-Output "CODEX_AUTH_STATUS=READY_CHATGPT_KEYRING"
