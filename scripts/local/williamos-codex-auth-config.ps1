[CmdletBinding()]
param([string]$CodexHome = "$env:USERPROFILE\.codex")

$ErrorActionPreference = "Stop"
$configPath = Join-Path $CodexHome "config.toml"
$fallbackPath = Join-Path $CodexHome "auth.json"

if ((Test-Path -LiteralPath $fallbackPath -PathType Leaf) -and (Get-Item -LiteralPath $fallbackPath).Length -gt 0) {
  throw "PLAINTEXT_FALLBACK_WALL: nonempty auth.json exists; login and runtime remain blocked"
}

New-Item -ItemType Directory -Force -Path $CodexHome | Out-Null
$lines = [Collections.Generic.List[string]]::new()
if (Test-Path -LiteralPath $configPath -PathType Leaf) {
  Get-Content -LiteralPath $configPath | ForEach-Object { $lines.Add([string]$_) }
}

function Set-RootTomlValue([string]$Key, [string]$Value) {
  $tableIndex = $lines.Count
  for ($index = 0; $index -lt $lines.Count; $index++) {
    if ($lines[$index] -match '^\s*\[') { $tableIndex = $index; break }
  }
  $matchIndex = -1
  for ($index = 0; $index -lt $tableIndex; $index++) {
    if ($lines[$index] -match "^\s*$([regex]::Escape($Key))\s*=") { $matchIndex = $index; break }
  }
  $entry = "$Key = `"$Value`""
  if ($matchIndex -ge 0) { $lines[$matchIndex] = $entry } else { $lines.Insert($tableIndex, $entry) }
}

Set-RootTomlValue "forced_login_method" "chatgpt"
Set-RootTomlValue "cli_auth_credentials_store" "keyring"
[IO.File]::WriteAllLines($configPath, $lines, [Text.UTF8Encoding]::new($false))

Write-Host "Codex authentication contract configured: method=chatgpt store=keyring"
Write-Host "No login was initiated and no credential material was inspected."
