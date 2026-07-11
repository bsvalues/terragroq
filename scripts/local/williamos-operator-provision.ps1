[CmdletBinding()]
param([string]$OperatorHome = "$env:USERPROFILE\.williamos\runtime-operator")

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path "$OperatorHome\secrets", "$OperatorHome\control" | Out-Null
if (-not (Test-Path "$OperatorHome\control\activation")) {
  Set-Content -NoNewline -Encoding ascii "$OperatorHome\control\activation" "disabled"
}
foreach ($name in "openai_api_key", "github_token") {
  $path = "$OperatorHome\secrets\$name"
  if (-not (Test-Path $path)) { New-Item -ItemType File -Path $path | Out-Null }
}
Write-Host "Local operator home prepared at $OperatorHome"
Write-Host "Zero-byte credential placeholders were created if absent. No credential was generated or stored."
