[CmdletBinding()]
param([Parameter(Mandatory)][string]$Workspace)

$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath($Workspace)
$profile = [IO.Path]::GetFullPath($env:USERPROFILE)
if ($root.StartsWith($profile + [IO.Path]::DirectorySeparatorChar) -and -not $root.StartsWith([IO.Path]::GetFullPath("$env:USERPROFILE\.williamos\runtime-operator\workspace") + [IO.Path]::DirectorySeparatorChar)) { throw "USER_PROFILE_TRAVERSAL_WALL" }
foreach ($name in @("OPENAI_API_KEY", "GH_TOKEN", "GITHUB_TOKEN")) { if (Test-Path "Env:$name") { throw "SECRET_ENVIRONMENT_WALL" } }
foreach ($protected in @(".codex", ".ssh", "AppData", "auth.json", "hosts.yml", ".env")) {
  if (Get-ChildItem -LiteralPath $Workspace -Recurse -Force -ErrorAction Stop | Where-Object { $_.Name -eq $protected }) { throw "PROTECTED_MATERIAL_WALL" }
}
Write-Output "SECRET_DEFENSE_STATUS=PASS"
