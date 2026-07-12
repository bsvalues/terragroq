$ErrorActionPreference = "Stop"
$env:WILLIAMOS_OPERATOR_HOME = "$env:USERPROFILE\.williamos\runtime-operator"
$activation = "$env:WILLIAMOS_OPERATOR_HOME\control\activation"
[IO.File]::WriteAllText($activation, "disabled", [Text.UTF8Encoding]::new($false))
$lock = "$env:WILLIAMOS_OPERATOR_HOME\locks\supervisor.lock.json"
if (Test-Path -LiteralPath $lock -PathType Leaf) {
  try {
    $lease = Get-Content -Raw -LiteralPath $lock | ConvertFrom-Json
    $process = Get-Process -Id $lease.pid -ErrorAction Stop
    if ($process.StartTime.ToUniversalTime().Ticks -eq $lease.startTicks) {
      Stop-Process -Id $process.Id
      $process.WaitForExit(10000) | Out-Null
    }
  } catch { }
}
$env:WILLIAMOS_OPERATOR_HOME = "$env:USERPROFILE\.williamos\runtime-operator"
docker compose -f "$PSScriptRoot\..\..\runtime-operator\compose.yaml" stop
