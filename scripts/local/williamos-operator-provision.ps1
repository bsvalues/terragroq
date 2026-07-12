[CmdletBinding()]
param([string]$OperatorHome = "$env:USERPROFILE\.williamos\runtime-operator")

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path "$OperatorHome\control" | Out-Null

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

function Remove-LegacyCredentialPath([string]$Path) {
  if (Test-Path -LiteralPath $Path -PathType Container) {
    if (Get-ChildItem -LiteralPath $Path -Force) { throw "MIGRATION_WALL_NONEMPTY_LEGACY_CREDENTIAL: $Path" }
    Remove-Item -LiteralPath $Path
    return
  }
  if (Test-Path -LiteralPath $Path -PathType Leaf) {
    if ((Get-Item -LiteralPath $Path).Length -ne 0) { throw "MIGRATION_WALL_NONEMPTY_LEGACY_CREDENTIAL: $Path" }
    Remove-Item -LiteralPath $Path
  }
}

foreach ($name in "openai_api_key", "github_token") {
  Remove-LegacyCredentialPath "$OperatorHome\secrets\$name"
}
if ((Test-Path -LiteralPath "$OperatorHome\secrets" -PathType Container) -and -not (Get-ChildItem -LiteralPath "$OperatorHome\secrets" -Force)) {
  Remove-Item -LiteralPath "$OperatorHome\secrets"
}
Write-Host "Local operator home prepared at $OperatorHome"
Write-Host "Zero-byte legacy credential placeholders were retired. Non-empty paths stop at a migration wall."
