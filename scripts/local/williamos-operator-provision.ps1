[CmdletBinding()]
param([string]$OperatorHome = "$env:USERPROFILE\.williamos\runtime-operator")

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path "$OperatorHome\secrets", "$OperatorHome\control" | Out-Null

function Initialize-OperatorFile([string]$Path, [string]$InitialValue = "") {
  if (Test-Path -LiteralPath $Path -PathType Container) {
    if (Get-ChildItem -LiteralPath $Path -Force) { throw "Refusing to replace non-empty directory at $Path" }
    Remove-Item -LiteralPath $Path
  }
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    Set-Content -NoNewline -Encoding ascii -LiteralPath $Path -Value $InitialValue
  }
}

Initialize-OperatorFile "$OperatorHome\control\activation" "disabled"
foreach ($name in "openai_api_key", "github_token") {
  Initialize-OperatorFile "$OperatorHome\secrets\$name"
}
Write-Host "Local operator home prepared at $OperatorHome"
Write-Host "Zero-byte credential placeholders were created if absent. No credential was generated or stored."
