[CmdletBinding()]
param([Parameter(Mandatory)][string]$Workspace)

$ErrorActionPreference = "Stop"
Import-Module "$PSScriptRoot\..\..\runtime-operator\native\WilliamOS.RuntimeExecution.psm1" -Force
$changed = (Invoke-BoundedProcess git @("diff", "--cached", "--name-only", "-z") $Workspace 30).stdout -split "`0" | Where-Object { $_ }
$forbidden = @('.github/workflows/', '.env', 'auth.json', 'package.json', 'package-lock.json', 'drizzle/', 'migrations/', 'vercel.json')
foreach ($path in $changed) {
  $forbiddenMatch = $forbidden | Where-Object { $path.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) }
  if ([IO.Path]::IsPathRooted($path) -or $path -match '(^|[\\/])\.\.([\\/]|$)' -or $forbiddenMatch) { throw "PATCH_PATH_POLICY_WALL: $path" }
  $full = [IO.Path]::GetFullPath((Join-Path $Workspace $path))
  if (-not $full.StartsWith([IO.Path]::GetFullPath($Workspace) + [IO.Path]::DirectorySeparatorChar)) { throw "PATCH_ESCAPE_WALL" }
  if ((Get-Item -LiteralPath $full -Force).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) { throw "PATCH_SYMLINK_WALL" }
  $bytes = [IO.File]::ReadAllBytes($full)
  if ($bytes -contains 0) { throw "PATCH_BINARY_WALL" }
}
Write-Output "PATCH_POLICY_STATUS=PASS"
