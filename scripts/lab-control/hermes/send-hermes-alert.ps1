# send-hermes-alert.ps1 — bounded writer for the canonical native HERMES alert log.
# No network transport or external dependency is used by Appliance V1.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('FAIL','WARN','RECOVERY')][string]$Severity,
  [Parameter(Mandatory=$true)][string]$Message,
  [string]$ReportPath = '',
  [string]$AlertPath = 'C:\ProgramData\Hermes\health\alerts.log'
)
$ErrorActionPreference = 'Stop'

# coarse-content guard: strip anything that looks like a secret or over-long path detail
$clean = $Message -replace '[A-Za-z0-9+/]{40,}={0,2}', '[redacted]' -replace '([A-Za-z]:\\[^\s]+)', '[path]'
$clean = $clean.Trim()
if (-not $clean) { $clean = 'HERMES condition requires attention' }
if ($clean.Length -gt 160) { $clean = $clean.Substring(0,160) }
$line = "{0} [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $Severity, $clean
$parent = Split-Path -Parent $AlertPath
if($parent -and -not (Test-Path -LiteralPath $parent -PathType Container)){ New-Item -ItemType Directory -Path $parent -Force | Out-Null }
Add-Content -LiteralPath $AlertPath -Value $line -Encoding UTF8
Write-Output 'HERMES_NATIVE_ALERT_RECORDED'
