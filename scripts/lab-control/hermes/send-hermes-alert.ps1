# send-hermes-alert.ps1 — bounded push alerting for HERMES lab (WO-HERMES-APPL-006A / #1031)
# Sends ONE coarse alert to the configured ntfy topic. Never includes secrets,
# key material, fingerprints, credentials, or arbitrary file paths.
# Inert (no-op, exit 0) when HERMES_NTFY_TOPIC is unset.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('FAIL','WARN','RECOVERY')][string]$Severity,
  [Parameter(Mandatory=$true)][ValidateLength(1,160)][string]$Message,
  [ValidateLength(0,200)][string]$ReportPath = ''
)
$ErrorActionPreference = 'Stop'
$topic = [Environment]::GetEnvironmentVariable('HERMES_NTFY_TOPIC','User')
if (-not $topic) { $topic = [Environment]::GetEnvironmentVariable('HERMES_NTFY_TOPIC','Machine') }
if (-not $topic) { exit 0 }   # inert when not wired

# coarse-content guard: strip anything that looks like a secret or over-long path detail
$clean = $Message -replace '[A-Za-z0-9+/]{40,}={0,2}', '[redacted]' -replace '([A-Za-z]:\\[^\s]+)', '[path]'
$clean = $clean.Trim()
if ($clean.Length -gt 160) { $clean = $clean.Substring(0,160) }

$prio = @{ FAIL='5'; WARN='3'; RECOVERY='2' }[$Severity]
$title = "HERMES $Severity"
$body = $clean
if ($ReportPath) { $body += " (report: hermes-morning-latest.md)" }
$tags = 'warning'
if ($Severity -eq 'FAIL') { $tags = 'rotating_light' }
elseif ($Severity -eq 'RECOVERY') { $tags = 'white_check_mark' }

try {
  Invoke-RestMethod -Uri "https://ntfy.sh/$topic" -Method Post -Body $body -TimeoutSec 10 `
    -Headers @{ 'Title' = $title; 'Priority' = $prio; 'Tags' = $tags } | Out-Null
  exit 0
} catch {
  # alerting must never crash the caller
  exit 0
}
