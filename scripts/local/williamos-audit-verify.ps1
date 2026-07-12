[CmdletBinding()]
param([string]$Path = "$env:USERPROFILE\.williamos\runtime-operator\audit\native-events.jsonl")

$ErrorActionPreference = "Stop"
$previous = "GENESIS"
$count = 0
foreach ($line in Get-Content -LiteralPath $Path) {
  $entry = $line | ConvertFrom-Json -DateKind String
  if ($entry.previousHash -ne $previous) { throw "AUDIT_CHAIN_WALL_AT_$count" }
  $record = [ordered]@{ at = $entry.at; event = $entry.event; previousHash = $entry.previousHash; fields = $entry.fields }
  $bytes = [Text.Encoding]::UTF8.GetBytes(($record | ConvertTo-Json -Compress -Depth 5))
  $computed = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
  if ($entry.hash -ne $computed) { throw "AUDIT_HASH_WALL_AT_$count" }
  $previous = $entry.hash; $count++
}
Write-Output "AUDIT_STATUS=VALID RECORDS=$count"
