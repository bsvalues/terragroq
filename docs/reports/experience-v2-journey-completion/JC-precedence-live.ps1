# Which DATABASE_URL does the BUILT server actually use: the one already in process.env, or the one
# in .env.local?
#
# The start script's entire mechanism rests on process.env winning. If it does not, the wiring is a
# no-op that looks like a repair. So it is measured on the real artifact rather than read out of
# Next's bundled loader -- with two BOGUS loopback URLs differing only by PORT, so no credential is
# involved, and the winner is observed AT THE SOCKET by a listener on each port rather than inferred
# from an error message that may not name one.
[CmdletBinding()]
param(
  [string]$Standalone = "C:\HermesLab\expv2-journey-completion\repo\.next\standalone",
  [string]$LaneRoot = "C:\HermesLab\expv2-journey-completion",
  [int]$Port = 3199
)

$ErrorActionPreference = "Stop"

$fromDotenv = "postgresql://probe:probe@127.0.0.1:5551/probe?sslmode=disable"
$fromProcessEnv = "postgresql://probe:probe@127.0.0.1:5552/probe?sslmode=disable"

$envFile = Join-Path $Standalone ".env.local"
if (Test-Path -LiteralPath $envFile) { throw "Refusing to run: $envFile already exists and this probe would overwrite it." }

$out = Join-Path $env:TEMP "jc-precedence.stdout.log"
$err = Join-Path $env:TEMP "jc-precedence.stderr.log"
$listenerOut = Join-Path $env:TEMP "jc-precedence-listener.json"
Remove-Item $out, $err, $listenerOut -Force -ErrorAction SilentlyContinue

$listener = $null
$proc = $null
try {
  $listener = Start-Process -FilePath "C:\Program Files\nodejs\node.exe" `
    -ArgumentList @((Join-Path $LaneRoot "JC-precedence-listener.mjs"), $listenerOut) `
    -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 2

  "DATABASE_URL=$fromDotenv`nWILLIAMOS_OWNER_EMAIL=probe@example.invalid`nBETTER_AUTH_SECRET=probe-secret-that-is-long-enough-for-better-auth-32`n" |
    Out-File -FilePath $envFile -Encoding ascii -NoNewline

  $env:NODE_ENV = "production"
  $env:HOSTNAME = "127.0.0.1"
  $env:PORT = "$Port"
  $env:DATABASE_URL = $fromProcessEnv

  $proc = Start-Process -FilePath "C:\Program Files\nodejs\node.exe" `
    -ArgumentList @((Join-Path $Standalone "server.js")) `
    -WorkingDirectory $Standalone -RedirectStandardOutput $out -RedirectStandardError $err `
    -PassThru -WindowStyle Hidden

  # Hit endpoints that force a database read. /api/health probes the database; /sign-in renders.
  $deadline = (Get-Date).AddSeconds(75)
  $healthBody = $null
  $healthStatus = $null
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 15
      $healthStatus = [int]$r.StatusCode
      $healthBody = $r.Content
      break
    } catch {
      $resp = $_.Exception.Response
      if ($resp) {
        $healthStatus = [int]$resp.StatusCode
        try {
          $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
          $healthBody = $reader.ReadToEnd()
        } catch { $healthBody = "<unreadable>" }
        break
      }
      Start-Sleep -Seconds 3
    }
  }

  Start-Sleep -Seconds 3
  if ($listener -and -not $listener.HasExited) { Stop-Process -Id $listener.Id -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2

  $lines = if (Test-Path $listenerOut) { @(Get-Content $listenerOut | Where-Object { $_.Trim() }) } else { @() }
  $events = @($lines | ForEach-Object { $_ | ConvertFrom-Json })
  $dotenvHits = @($events | Where-Object { $_.port -eq 5551 }).Count
  $processEnvHits = @($events | Where-Object { $_.port -eq 5552 }).Count

  $verdict = if ($processEnvHits -gt 0 -and $dotenvHits -eq 0) { "PROCESS_ENV_WINS" }
             elseif ($dotenvHits -gt 0 -and $processEnvHits -eq 0) { "DOTENV_WINS" }
             elseif ($dotenvHits -gt 0 -and $processEnvHits -gt 0) { "AMBIGUOUS_BOTH_CONNECTED" }
             else { "INCONCLUSIVE_NO_CONNECTION_OBSERVED" }

  [pscustomobject]@{
    verdict            = $verdict
    dotenvPort5551Hits = $dotenvHits
    processEnvPort5552Hits = $processEnvHits
    healthStatus       = $healthStatus
    healthBody         = $healthBody
  } | ConvertTo-Json -Depth 4
} finally {
  foreach ($p in @($proc, $listener)) {
    if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
  }
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $envFile -Force -ErrorAction SilentlyContinue
  Remove-Item $listenerOut -Force -ErrorAction SilentlyContinue
}
