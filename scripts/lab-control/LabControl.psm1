Set-StrictMode -Version Latest

$global:LAB_CONTROL_EXIT_CODE = 0

function ConvertTo-LabEncodedPowerShellCommand {
    param([Parameter(Mandatory)][string]$Command)

    [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Command))
}

function ConvertTo-LabEncodedShellCommand {
    param([Parameter(Mandatory)][string]$Command)

    [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Command))
}

function Get-LabFailureKind {
    param([string[]]$Lines)

    $message = ($Lines -join "`n")
    if ($message -match '(?i)permission denied|publickey|authentication failed') {
        return 'SSH_AUTH_BLOCKED'
    }
    if ($message -match '(?i)connection timed out|operation timed out') {
        return 'SSH_TIMEOUT'
    }
    if ($message -match '(?i)connection refused') {
        return 'SSH_REFUSED'
    }
    if ($message -match '(?i)could not resolve hostname|name or service not known') {
        return 'SSH_NAME_ERROR'
    }
    if ($message -match '(?i)host key verification failed|remote host identification has changed') {
        return 'SSH_HOST_KEY_BLOCKED'
    }
    return 'SSH_UNREACHABLE'
}

function Invoke-LabSsh {
    param(
        [Parameter(Mandatory)][ValidateSet('hermes', 'atlas')][string]$Target,
        [Parameter(Mandatory)][string]$RemoteCommand
    )

    $ssh = if ($env:LAB_CONTROL_SSH_EXECUTABLE) {
        $env:LAB_CONTROL_SSH_EXECUTABLE
    } else {
        'ssh'
    }
    $arguments = @(
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=5',
        '-o', 'ConnectionAttempts=1',
        '-o', 'ServerAliveInterval=3',
        '-o', 'ServerAliveCountMax=1',
        '--', $Target, $RemoteCommand
    )

    $output = @(
        & $ssh @arguments 2>&1 |
            ForEach-Object { $_.ToString() -split "`r?`n" } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )
    $exitCode = $LASTEXITCODE
    if ($null -eq $exitCode) { $exitCode = 1 }

    [pscustomobject]@{
        Target = $Target
        Ok = $exitCode -eq 0
        ExitCode = $exitCode
        FailureKind = if ($exitCode -eq 0) { $null } else { Get-LabFailureKind -Lines $output }
        Lines = $output
    }
}

function ConvertFrom-LabKeyValueLines {
    param([string[]]$Lines)

    $result = [ordered]@{}
    foreach ($line in $Lines) {
        if ($line -match '^([^=]+)=(.*)$') {
            $result[$Matches[1].Trim().ToLowerInvariant()] = $Matches[2].Trim()
        }
    }
    $result
}

function Get-LabRawValue {
    param([System.Collections.IDictionary]$Values, [string]$Key)

    if ($null -ne $Values -and $Values.Contains($Key) -and $null -ne $Values[$Key]) {
        return [string]$Values[$Key]
    }
    ''
}

function Get-LabJsonProperty {
    param([object]$Object, [string]$Name)

    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    $property.Value
}

function ConvertFrom-LabUtcTimestamp {
    param([object]$Value)

    if ($Value -is [datetime]) {
        if ($Value.Kind -ne [DateTimeKind]::Utc) { return $null }
        return $Value.ToUniversalTime()
    }
    $text = [string]$Value
    if ([string]::IsNullOrWhiteSpace($text) -or $text -notmatch 'Z$') { return $null }
    $parsed = [datetime]::MinValue
    $styles = [Globalization.DateTimeStyles]::RoundtripKind
    if (-not [datetime]::TryParse($text, [Globalization.CultureInfo]::InvariantCulture, $styles, [ref]$parsed)) {
        return $null
    }
    $parsed.ToUniversalTime()
}

function New-LabCrossSyncEvidence {
    param(
        [Parameter(Mandatory)][string]$State,
        [Parameter(Mandatory)][string]$Detail,
        [AllowNull()][object]$CompletedAtUtc
    )

    [pscustomobject]@{
        State = $State
        Detail = $Detail
        CompletedAtUtc = $CompletedAtUtc
    }
}

function Test-LabExactJsonProperties {
    param([object]$Object, [string[]]$Names)

    if ($null -eq $Object -or $Object -is [array]) { return $false }
    $actualNames = @($Object.PSObject.Properties | ForEach-Object { $_.Name })
    if ($actualNames.Count -ne $Names.Count) { return $false }
    foreach ($name in $Names) {
        if ($name -cnotin $actualNames) { return $false }
    }
    $true
}

function Test-LabJsonElementHasUniqueProperties {
    param([Parameter(Mandatory)][System.Text.Json.JsonElement]$Element)

    if ($Element.ValueKind -eq [System.Text.Json.JsonValueKind]::Object) {
        $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        foreach ($property in $Element.EnumerateObject()) {
            if (-not $names.Add($property.Name)) { return $false }
            if (-not (Test-LabJsonElementHasUniqueProperties -Element $property.Value)) { return $false }
        }
    } elseif ($Element.ValueKind -eq [System.Text.Json.JsonValueKind]::Array) {
        foreach ($item in $Element.EnumerateArray()) {
            if (-not (Test-LabJsonElementHasUniqueProperties -Element $item)) { return $false }
        }
    }
    $true
}

function ConvertFrom-LabJsonTransport {
    param(
        [Parameter(Mandatory)][string]$Base64,
        [Parameter(Mandatory)][string]$ExpectedHash
    )

    if ($ExpectedHash -cnotmatch '^[0-9a-f]{64}$') {
        return [pscustomobject]@{ Ok = $false; Detail = 'invalid_hash'; Document = $null }
    }
    try {
        $bytes = [Convert]::FromBase64String($Base64)
    } catch {
        return [pscustomobject]@{ Ok = $false; Detail = 'invalid_base64'; Document = $null }
    }
    if ($bytes.Length -eq 0 -or $bytes.Length -gt 65536) {
        return [pscustomobject]@{ Ok = $false; Detail = 'invalid_size'; Document = $null }
    }

    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        $computedHash = [BitConverter]::ToString($sha256.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha256.Dispose()
    }
    if ($computedHash -cne $ExpectedHash) {
        return [pscustomobject]@{ Ok = $false; Detail = 'content_hash_mismatch'; Document = $null }
    }

    try {
        $utf8 = New-Object Text.UTF8Encoding($false, $true)
        $json = $utf8.GetString($bytes)
        $jsonDocument = [System.Text.Json.JsonDocument]::Parse($json)
        try {
            if (-not (Test-LabJsonElementHasUniqueProperties -Element $jsonDocument.RootElement)) {
                return [pscustomobject]@{ Ok = $false; Detail = 'duplicate_property'; Document = $null }
            }
        } finally {
            $jsonDocument.Dispose()
        }
        $document = ConvertFrom-Json -InputObject $json -DateKind String -ErrorAction Stop
    } catch {
        return [pscustomobject]@{ Ok = $false; Detail = 'invalid_json'; Document = $null }
    }
    if ($null -eq $document -or $document -is [array]) {
        return [pscustomobject]@{ Ok = $false; Detail = 'invalid_schema'; Document = $null }
    }
    [pscustomobject]@{ Ok = $true; Detail = 'valid'; Document = $document }
}

function Get-LabCrossSyncEvidence {
    param(
        [Parameter(Mandatory)][System.Collections.IDictionary]$HermesValues,
        [Parameter(Mandatory)][System.Collections.IDictionary]$AtlasValues,
        [Parameter(Mandatory)][datetime]$NowUtc
    )

    $NowUtc = $NowUtc.ToUniversalTime()
    $taskState = (Get-LabRawValue $HermesValues 'cross_sync_task_state').Trim()
    $taskResultText = (Get-LabRawValue $HermesValues 'cross_sync_task_result').Trim()
    $taskLastText = (Get-LabRawValue $HermesValues 'cross_sync_task_last_utc').Trim()
    $taskEvidenceB64 = (Get-LabRawValue $HermesValues 'cross_sync_task_evidence_b64').Trim()
    $taskEvidenceHash = (Get-LabRawValue $HermesValues 'cross_sync_task_evidence_sha256').Trim()
    $receiptB64 = (Get-LabRawValue $AtlasValues 'cross_sync_receipt_b64').Trim()
    $atlasHash = (Get-LabRawValue $AtlasValues 'cross_sync_receipt_sha256').Trim()

    $taskResult = [long]0
    if (-not [string]::IsNullOrWhiteSpace($taskResultText)) {
        if ($taskResultText -notmatch '^-?\d+$' -or -not [long]::TryParse($taskResultText, [ref]$taskResult)) {
            return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=invalid_task_result' -CompletedAtUtc $null
        }
        if ($taskResult -ne 0) {
            return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail "task_result=$taskResult" -CompletedAtUtc $null
        }
    }

    if ([string]::IsNullOrWhiteSpace($receiptB64) -and [string]::IsNullOrWhiteSpace($atlasHash)) {
        return New-LabCrossSyncEvidence -State 'SYNC_UNKNOWN' -Detail 'receipt=missing' -CompletedAtUtc $null
    }

    if ([string]::IsNullOrWhiteSpace($taskState) -or
        [string]::IsNullOrWhiteSpace($taskResultText) -or
        [string]::IsNullOrWhiteSpace($taskLastText) -or
        [string]::IsNullOrWhiteSpace($taskEvidenceB64) -or
        [string]::IsNullOrWhiteSpace($taskEvidenceHash) -or
        [string]::IsNullOrWhiteSpace($receiptB64) -or
        [string]::IsNullOrWhiteSpace($atlasHash)) {
        return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=incomplete_transport' -CompletedAtUtc $null
    }
    if ($taskState -cne 'Ready') {
        return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=task_not_ready' -CompletedAtUtc $null
    }

    $receiptTransport = ConvertFrom-LabJsonTransport -Base64 $receiptB64 -ExpectedHash $atlasHash
    if (-not $receiptTransport.Ok) {
        return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail "validation=receipt_$($receiptTransport.Detail)" -CompletedAtUtc $null
    }
    $taskEvidenceTransport = ConvertFrom-LabJsonTransport -Base64 $taskEvidenceB64 -ExpectedHash $taskEvidenceHash
    if (-not $taskEvidenceTransport.Ok) {
        return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail "validation=task_evidence_$($taskEvidenceTransport.Detail)" -CompletedAtUtc $null
    }
    $receipt = $receiptTransport.Document
    $taskEvidence = $taskEvidenceTransport.Document

    $receiptProperties = @('schema_version', 'task_name', 'run_id', 'started_at', 'completed_at', 'result', 'verification', 'directions')
    $taskEvidenceProperties = @('schema_version', 'task_name', 'run_id', 'started_at', 'receipt_completed_at', 'completed_at', 'state', 'result', 'verification', 'atlas_receipt_sha256')
    if (-not (Test-LabExactJsonProperties $receipt $receiptProperties) -or
        -not (Test-LabExactJsonProperties $taskEvidence $taskEvidenceProperties)) {
        return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=invalid_schema' -CompletedAtUtc $null
    }

    $schemaVersion = Get-LabJsonProperty $receipt 'schema_version'
    $taskName = Get-LabJsonProperty $receipt 'task_name'
    $runId = [string](Get-LabJsonProperty $receipt 'run_id')
    $result = Get-LabJsonProperty $receipt 'result'
    $verification = Get-LabJsonProperty $receipt 'verification'
    if (($schemaVersion -isnot [int] -and $schemaVersion -isnot [long]) -or
        $schemaVersion -ne 1 -or
        $taskName -cne 'HermesCrossNodeBackupSync' -or
        $runId -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' -or
        $result -cne 'SUCCESS' -or
        $verification -cne 'SHA256_PASS') {
        return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=invalid_receipt_schema' -CompletedAtUtc $null
    }

    $evidenceSchemaVersion = Get-LabJsonProperty $taskEvidence 'schema_version'
    $evidenceTaskName = Get-LabJsonProperty $taskEvidence 'task_name'
    $evidenceRunId = [string](Get-LabJsonProperty $taskEvidence 'run_id')
    if (($evidenceSchemaVersion -isnot [int] -and $evidenceSchemaVersion -isnot [long]) -or
        $evidenceSchemaVersion -ne 1 -or
        $evidenceTaskName -cne 'HermesCrossNodeBackupSync' -or
        $evidenceRunId -cne $runId -or
        (Get-LabJsonProperty $taskEvidence 'state') -cne 'COMPLETED' -or
        (Get-LabJsonProperty $taskEvidence 'result') -cne 'SUCCESS' -or
        (Get-LabJsonProperty $taskEvidence 'verification') -cne 'SHA256_PASS' -or
        (Get-LabJsonProperty $taskEvidence 'atlas_receipt_sha256') -cne $atlasHash) {
        return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=invalid_task_evidence' -CompletedAtUtc $null
    }

    $directions = @(Get-LabJsonProperty $receipt 'directions')
    if ($directions.Count -ne 2) {
        return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=invalid_directions' -CompletedAtUtc $null
    }
    $expectedDirections = @(
        @{ Name = 'ATLAS_TO_HERMES'; Source = 'atlas'; Destination = 'hermes' },
        @{ Name = 'HERMES_TO_ATLAS'; Source = 'hermes'; Destination = 'atlas' }
    )
    $directionProperties = @('run_id', 'direction', 'source', 'destination', 'file_count', 'manifest_sha256', 'verification')
    for ($index = 0; $index -lt $directions.Count; $index++) {
        $direction = $directions[$index]
        $expectedDirection = $expectedDirections[$index]
        if (-not (Test-LabExactJsonProperties $direction $directionProperties)) {
            return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=invalid_directions' -CompletedAtUtc $null
        }
        $name = Get-LabJsonProperty $direction 'direction'
        $source = Get-LabJsonProperty $direction 'source'
        $destination = Get-LabJsonProperty $direction 'destination'
        $fileCount = Get-LabJsonProperty $direction 'file_count'
        $manifestHash = Get-LabJsonProperty $direction 'manifest_sha256'
        if ((Get-LabJsonProperty $direction 'run_id') -cne $runId -or
            $name -cne $expectedDirection.Name -or
            $source -cne $expectedDirection.Source -or
            $destination -cne $expectedDirection.Destination -or
            ($fileCount -isnot [int] -and $fileCount -isnot [long]) -or
            $fileCount -le 0 -or
            $manifestHash -cnotmatch '^[0-9a-f]{64}$' -or
            (Get-LabJsonProperty $direction 'verification') -cne 'SHA256_PASS') {
            return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=invalid_directions' -CompletedAtUtc $null
        }
    }

    $taskLastUtc = ConvertFrom-LabUtcTimestamp $taskLastText
    $receiptStartedText = [string](Get-LabJsonProperty $receipt 'started_at')
    $receiptCompletedText = [string](Get-LabJsonProperty $receipt 'completed_at')
    $evidenceStartedText = [string](Get-LabJsonProperty $taskEvidence 'started_at')
    $evidenceReceiptCompletedText = [string](Get-LabJsonProperty $taskEvidence 'receipt_completed_at')
    $evidenceCompletedText = [string](Get-LabJsonProperty $taskEvidence 'completed_at')
    if ($receiptStartedText -cne $evidenceStartedText -or $receiptCompletedText -cne $evidenceReceiptCompletedText) {
        return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=timestamp_binding_mismatch' -CompletedAtUtc $null
    }
    $startedUtc = ConvertFrom-LabUtcTimestamp $receiptStartedText
    $receiptCompletedUtc = ConvertFrom-LabUtcTimestamp $receiptCompletedText
    $evidenceCompletedUtc = ConvertFrom-LabUtcTimestamp $evidenceCompletedText
    if ($null -eq $taskLastUtc -or $null -eq $startedUtc -or $null -eq $receiptCompletedUtc -or $null -eq $evidenceCompletedUtc) {
        return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=malformed_receipt_timestamp' -CompletedAtUtc $null
    }
    if ($receiptCompletedUtc -lt $startedUtc -or $evidenceCompletedUtc -lt $receiptCompletedUtc) {
        return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=completion_before_start' -CompletedAtUtc $null
    }
    if ($taskLastUtc -gt $startedUtc) {
        return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=task_start_mismatch' -CompletedAtUtc $null
    }
    $taskStartDelta = $startedUtc.Subtract($taskLastUtc)
    if ($taskStartDelta -gt [TimeSpan]::FromMinutes(5)) {
        return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=task_start_mismatch' -CompletedAtUtc $null
    }
    if ($taskLastUtc -gt $NowUtc.AddMinutes(5) -or
        $startedUtc -gt $NowUtc.AddMinutes(5) -or
        $receiptCompletedUtc -gt $NowUtc.AddMinutes(5) -or
        $evidenceCompletedUtc -gt $NowUtc.AddMinutes(5)) {
        return New-LabCrossSyncEvidence -State 'SYNC_FAILED' -Detail 'validation=future_completion' -CompletedAtUtc $null
    }

    $detail = "completed=$($evidenceCompletedUtc.ToString('o'))"
    if (($NowUtc - $evidenceCompletedUtc).TotalHours -gt 30) {
        return New-LabCrossSyncEvidence -State 'SYNC_STALE' -Detail $detail -CompletedAtUtc $evidenceCompletedUtc
    }
    New-LabCrossSyncEvidence -State 'SYNC_OK' -Detail $detail -CompletedAtUtc $evidenceCompletedUtc
}

function Get-LabNowUtc {
    if ([string]::IsNullOrWhiteSpace($env:LAB_CONTROL_NOW_UTC)) {
        return [datetime]::UtcNow
    }
    $override = ConvertFrom-LabUtcTimestamp $env:LAB_CONTROL_NOW_UTC
    if ($null -eq $override) {
        throw 'LAB_CONTROL_NOW_UTC must be an ISO-8601 UTC timestamp.'
    }
    $override
}

function Get-HermesProbeCommand {
    $probe = @'
$ErrorActionPreference='SilentlyContinue'
function Out-Kv($k,$v){ if([string]::IsNullOrWhiteSpace([string]$v)){$v='UNKNOWN'}; Write-Output ($k+'='+([string]$v).Trim()) }
function Out-RawKv($k,$v){ Write-Output ($k+'='+[string]$v) }
Out-Kv 'hostname' $env:COMPUTERNAME
$os=Get-CimInstance Win32_OperatingSystem
Out-Kv 'os' $os.Caption
Out-Kv 'uptime' ((Get-Date)-$os.LastBootUpTime).ToString('d\d\ h\h\ m\m')
$docker=if(Get-Command docker -ErrorAction SilentlyContinue){docker info --format '{{.ServerVersion}}' 2>$null}else{$null}
Out-Kv 'docker' $docker
$ollama=try {
  $response=Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/version' -TimeoutSec 3
  if($response.version){'AVAILABLE '+$response.version}else{'AVAILABLE'}
} catch {
  $container=if(Get-Command docker -ErrorAction SilentlyContinue){docker ps --filter 'name=ollama' --format '{{.Names}}' 2>$null | Select-Object -First 1}else{$null}
  if($container){'UNAVAILABLE_CONTAINER_RUNNING'}else{'NOT_OBSERVED'}
}
Out-Kv 'ollama' $ollama
$gpu=if(Get-Command nvidia-smi -ErrorAction SilentlyContinue){nvidia-smi --query-gpu=name --format=csv,noheader 2>$null | Select-Object -First 1}else{$null}
Out-Kv 'gpu' $gpu
$d=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
if($d){Out-Kv 'disk' ('{0:N0} GB free of {1:N0} GB' -f ($d.FreeSpace/1GB),($d.Size/1GB))}else{Out-Kv 'disk' $null}
$taskState=''
$taskResult=''
$taskLastUtc=''
try {
  $taskState=[string](Get-ScheduledTask -TaskName 'HermesCrossNodeBackupSync' -ErrorAction Stop).State
  $info=Get-ScheduledTaskInfo -TaskName 'HermesCrossNodeBackupSync' -ErrorAction Stop
  $taskResult=[string][long]$info.LastTaskResult
  $taskLastUtc=$info.LastRunTime.ToUniversalTime().ToString('o')
} catch {}
$eb=$null
$ep='D:\CrossNodeBackups\crossnode-sync-task-evidence.json'
try {
  $fs=[System.IO.File]::Open($ep,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete))
  try {
    if($fs.Length -gt 0 -and $fs.Length -le 65536){
      $b=New-Object byte[] ([int]$fs.Length)
      $o=0
      while($o -lt $b.Length){
        $n=$fs.Read($b,$o,$b.Length-$o)
        if($n -le 0){break}
        $o+=$n
      }
      if($o -eq $b.Length){$eb=$b}
    }
  } finally {$fs.Dispose()}
} catch {}
$e64=''
$eh=''
if($null -ne $eb){
  $e64=[Convert]::ToBase64String($eb)
  $sha=[Security.Cryptography.SHA256]::Create()
  try {$eh=[BitConverter]::ToString($sha.ComputeHash($eb)).Replace('-','').ToLowerInvariant()} finally {$sha.Dispose()}
}
Out-RawKv 'cross_sync_task_state' $taskState
Out-RawKv 'cross_sync_task_result' $taskResult
Out-RawKv 'cross_sync_task_last_utc' $taskLastUtc
Out-RawKv 'cross_sync_task_evidence_b64' $e64
Out-RawKv 'cross_sync_task_evidence_sha256' $eh
'@
    $encoded = ConvertTo-LabEncodedPowerShellCommand -Command $probe
    "powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand $encoded"
}

function Get-AtlasProbeCommand {
    $probe = @'
kv(){ v="$2"; [ -n "$v" ] || v=UNKNOWN; printf '%s=%s\n' "$1" "$v"; }
kv_raw(){ printf '%s=%s\n' "$1" "$2"; }
kv hostname "$(hostname 2>/dev/null)"
kv os "$(. /etc/os-release 2>/dev/null; printf '%s' "$PRETTY_NAME")"
kv uptime "$(uptime -p 2>/dev/null)"
kv docker "$(docker info --format '{{.ServerVersion}}' 2>/dev/null)"
tcp_listener(){ ss -ltnH 2>/dev/null | awk -v p=":$1" '$4 ~ p"$" {found=1} END {exit !found}'; }
container_for_port(){
  docker ps --format '{{.Names}}|{{.Ports}}' 2>/dev/null |
    awk -F'|' -v p=":$1->" 'index($2,p){print $1; exit}'
}
postgres_probe(){
  if command -v pg_isready >/dev/null 2>&1; then
    pg_isready -q -h 127.0.0.1 -p 5432 && { printf PG_ISREADY_ACCEPTING; return; }
    printf PG_ISREADY_REJECTING; return
  fi
  container="$(container_for_port 5432)"
  if [ -n "$container" ]; then
    docker exec "$container" pg_isready -q 2>/dev/null && { printf CONTAINER_PG_ISREADY_ACCEPTING; return; }
  fi
  tcp_listener 5432 && printf TCP_LISTENER_ONLY || printf NOT_OBSERVED
}
redis_probe(){
  if command -v redis-cli >/dev/null 2>&1; then
    reply="$(redis-cli -h 127.0.0.1 -p 6379 --no-auth-warning ping 2>&1)"
    [ "$reply" = PONG ] && { printf REDIS_PING_PONG; return; }
    printf '%s' "$reply" | grep -Eiq 'NOAUTH|WRONGPASS|authentication required' && { printf REDIS_AUTH_REQUIRED_REACHABLE; return; }
    printf REDIS_CLI_NO_RESPONSE; return
  fi
  container="$(container_for_port 6379)"
  if [ -n "$container" ]; then
    reply="$(docker exec "$container" redis-cli --no-auth-warning ping 2>&1)"
    [ "$reply" = PONG ] && { printf CONTAINER_REDIS_PING_PONG; return; }
    printf '%s' "$reply" | grep -Eiq 'NOAUTH|WRONGPASS|authentication required' && { printf CONTAINER_REDIS_AUTH_REQUIRED_REACHABLE; return; }
  fi
  tcp_listener 6379 && printf TCP_LISTENER_ONLY || printf NOT_OBSERVED
}
mongo_probe(){
  if command -v mongosh >/dev/null 2>&1; then
    reply="$(mongosh --quiet --host 127.0.0.1 --port 27017 --eval 'db.adminCommand({ping:1}).ok' 2>/dev/null | tail -n 1)"
    [ "$reply" = 1 ] && { printf MONGO_PING_OK; return; }
    printf MONGO_PING_FAILED; return
  fi
  container="$(container_for_port 27017)"
  if [ -n "$container" ]; then
    reply="$(docker exec "$container" mongosh --quiet --eval 'db.adminCommand({ping:1}).ok' 2>/dev/null | tail -n 1)"
    [ "$reply" = 1 ] && { printf CONTAINER_MONGO_PING_OK; return; }
  fi
  tcp_listener 27017 && printf TCP_LISTENER_ONLY || printf NOT_OBSERVED
}
container_port_evidence(){
  port="$1"
  row="$(container_for_port "$port")"
  [ -n "$row" ] || { printf NO_EXPLICIT_DOCKER_PORT_MAPPING; return; }
  docker inspect --format 'name={{.Name}} state={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}not-configured{{end}}' "$row" 2>/dev/null | sed 's#name=/#name=#'
}
kv postgres_evidence "$(postgres_probe)"
kv postgres_container_evidence "$(container_port_evidence 5432)"
kv redis_evidence "$(redis_probe)"
kv redis_container_evidence "$(container_port_evidence 6379)"
kv mongo_evidence "$(mongo_probe)"
kv mongo_container_evidence "$(container_port_evidence 27017)"
kv disk "$(df -hP / 2>/dev/null | awk 'NR==2 {print $4 " free of " $2}')"
latest_line="$({
  for d in /home/bs/backups /srv/backups /opt/backups /mnt/backups /backups; do
    [ -d "$d" ] || continue
    find "$d" -maxdepth 2 -type f -printf '%T@|%p\n' 2>/dev/null
  done
} | sort -nr | head -n 1)"
latest=''
if [ -n "$latest_line" ]; then
  latest_epoch="${latest_line%%|*}"
  latest_path="${latest_line#*|}"
  latest_time="$(date -d "@${latest_epoch%.*}" --iso-8601=seconds 2>/dev/null)"
  [ -n "$latest_time" ] || latest_time="$latest_epoch"
  latest="$latest_time|$latest_path"
fi
kv backup "$latest"
receipt='/home/bs/from-hermes/crossnode-sync-receipt.json'
receipt_size="$(stat -c %s "$receipt" 2>/dev/null)"
receipt_b64=''
receipt_hash=''
if [ -n "$receipt_size" ] && [ "$receipt_size" -gt 0 ] && [ "$receipt_size" -le 65536 ]; then
  receipt_b64="$(head -c 65536 -- "$receipt" 2>/dev/null | base64 -w 0)"
  receipt_hash="$(head -c 65536 -- "$receipt" 2>/dev/null | sha256sum | awk '{print $1}')"
  receipt_size_after="$(stat -c %s "$receipt" 2>/dev/null)"
  if [ "$receipt_size_after" != "$receipt_size" ]; then receipt_b64=''; receipt_hash=''; fi
fi
kv_raw cross_sync_receipt_b64 "$receipt_b64"
kv_raw cross_sync_receipt_sha256 "$receipt_hash"
'@
    $encoded = ConvertTo-LabEncodedShellCommand -Command $probe
    "printf %s $encoded | base64 -d | sh"
}

function Get-LabNodeSnapshot {
    param([Parameter(Mandatory)][ValidateSet('hermes', 'atlas')][string]$Target)

    $command = if ($Target -eq 'hermes') { Get-HermesProbeCommand } else { Get-AtlasProbeCommand }
    $result = Invoke-LabSsh -Target $Target -RemoteCommand $command
    if (-not $result.Ok) {
        return [pscustomobject]@{
            Target = $Target
            Reachable = $false
            FailureKind = $result.FailureKind
            Values = [ordered]@{}
        }
    }
    [pscustomobject]@{
        Target = $Target
        Reachable = $true
        FailureKind = $null
        Values = ConvertFrom-LabKeyValueLines -Lines $result.Lines
    }
}

function Get-LabValue {
    param([System.Collections.IDictionary]$Values, [string]$Key)
    if ($Values.Contains($Key) -and -not [string]::IsNullOrWhiteSpace([string]$Values[$Key])) {
        return $Values[$Key]
    }
    'UNKNOWN'
}

function Write-LabNodeSummary {
    param([Parameter(Mandatory)]$Snapshot)

    Write-Output $Snapshot.Target.ToUpperInvariant()
    if (-not $Snapshot.Reachable) {
        Write-Output "  reachable: NO ($($Snapshot.FailureKind))"
        return
    }
    Write-Output '  reachable: YES'
    Write-Output "  Docker: $(Get-LabValue $Snapshot.Values 'docker')"
    if ($Snapshot.Target -eq 'hermes') {
        Write-Output "  Ollama: $(Get-LabValue $Snapshot.Values 'ollama')"
        Write-Output "  GPU: $(Get-LabValue $Snapshot.Values 'gpu')"
    } else {
        Write-Output "  Postgres evidence: $(Get-LabValue $Snapshot.Values 'postgres_evidence')"
        Write-Output "  Redis evidence: $(Get-LabValue $Snapshot.Values 'redis_evidence')"
        Write-Output "  Mongo evidence: $(Get-LabValue $Snapshot.Values 'mongo_evidence')"
    }
    Write-Output "  disk: $(Get-LabValue $Snapshot.Values 'disk')"
}

function Invoke-LabStatus {
    $hermes = Get-LabNodeSnapshot -Target hermes
    $atlas = Get-LabNodeSnapshot -Target atlas
    $nowUtc = Get-LabNowUtc
    $syncEvidence = Get-LabCrossSyncEvidence -HermesValues $hermes.Values -AtlasValues $atlas.Values -NowUtc $nowUtc
    $syncReady = $syncEvidence.State -eq 'SYNC_OK'
    Write-LabNodeSummary $hermes
    Write-LabNodeSummary $atlas
    Write-Output 'LAB'
    Write-Output "  latest backup: $(Get-LabValue $atlas.Values 'backup')"
    Write-Output "  latest cross-node sync: $($syncEvidence.State) $($syncEvidence.Detail)"

    $failures = @($hermes, $atlas | Where-Object { -not $_.Reachable })
    if ($failures.Count -eq 0) {
        $requiredValues = @(
            (Get-LabValue $hermes.Values 'docker'),
            (Get-LabValue $hermes.Values 'ollama'),
            (Get-LabValue $hermes.Values 'gpu'),
            (Get-LabValue $hermes.Values 'disk'),
            (Get-LabValue $atlas.Values 'docker'),
            (Get-LabValue $atlas.Values 'disk'),
            (Get-LabValue $atlas.Values 'backup')
        )
        $genericIncomplete = @($requiredValues | Where-Object { $_ -match '^(?i:UNKNOWN|UNAVAILABLE|NOT_FOUND|NOT_INSTALLED|NOT_OBSERVED|UNVERIFIED|FAILED)' }).Count -gt 0
        $postgresReady = (Get-LabValue $atlas.Values 'postgres_evidence') -in @('PG_ISREADY_ACCEPTING', 'CONTAINER_PG_ISREADY_ACCEPTING')
        $redisReady = (Get-LabValue $atlas.Values 'redis_evidence') -in @('REDIS_PING_PONG', 'REDIS_AUTH_REQUIRED_REACHABLE', 'CONTAINER_REDIS_PING_PONG', 'CONTAINER_REDIS_AUTH_REQUIRED_REACHABLE')
        $mongoReady = (Get-LabValue $atlas.Values 'mongo_evidence') -in @('MONGO_PING_OK', 'CONTAINER_MONGO_PING_OK')
        if ($genericIncomplete -or -not $postgresReady -or -not $redisReady -or -not $mongoReady -or -not $syncReady) {
            Write-Output '  operator blocker: REQUIRED_EVIDENCE_INCOMPLETE (inspect UNKNOWN/unavailable service or continuity fields above)'
            $global:LAB_CONTROL_EXIT_CODE = 2
        } else {
            Write-Output '  operator blocker: NONE'
            $global:LAB_CONTROL_EXIT_CODE = 0
        }
    } elseif (@($failures | Where-Object FailureKind -eq 'SSH_AUTH_BLOCKED').Count -gt 0) {
        Write-Output '  operator blocker: SSH authentication is not configured for one or more aliases'
        $global:LAB_CONTROL_EXIT_CODE = 2
    } else {
        Write-Output '  operator blocker: one or more lab nodes are unreachable; inspect the typed SSH result above'
        $global:LAB_CONTROL_EXIT_CODE = 2
    }
}

function Write-LabDetailedSnapshot {
    param([Parameter(Mandatory)][ValidateSet('hermes', 'atlas')][string]$Target)

    $snapshot = Get-LabNodeSnapshot -Target $Target
    if (-not $snapshot.Reachable) {
        Write-Output "$($Target.ToUpperInvariant()): UNREACHABLE ($($snapshot.FailureKind))"
        $global:LAB_CONTROL_EXIT_CODE = 2
        return
    }
    Write-Output "$($Target.ToUpperInvariant()): REACHABLE"
    foreach ($entry in $snapshot.Values.GetEnumerator()) {
        Write-Output ("  {0}: {1}" -f $entry.Key, $entry.Value)
    }
    $global:LAB_CONTROL_EXIT_CODE = 0
}

function Invoke-LabHermes { Write-LabDetailedSnapshot -Target hermes }
function Invoke-LabAtlas { Write-LabDetailedSnapshot -Target atlas }

function Invoke-LabContainers {
    $hermesProbe = @'
$ErrorActionPreference='SilentlyContinue'
docker ps --format "table {{.Names}}`t{{.Image}}`t{{.Status}}`t{{.Ports}}"
'@
    $commands = @{
        hermes = "powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand $(ConvertTo-LabEncodedPowerShellCommand -Command $hermesProbe)"
        atlas = "docker ps --format 'table {{.Names}}`t{{.Image}}`t{{.Status}}`t{{.Ports}}'"
    }
    $failed = $false
    foreach ($target in @('hermes', 'atlas')) {
        Write-Output $target.ToUpperInvariant()
        $result = Invoke-LabSsh -Target $target -RemoteCommand $commands[$target]
        if ($result.Ok) {
            $result.Lines | Write-Output
        } else {
            Write-Output "  UNREACHABLE ($($result.FailureKind))"
            $failed = $true
        }
    }
    $global:LAB_CONTROL_EXIT_CODE = if ($failed) { 2 } else { 0 }
}

function Invoke-LabBackups {
    $hermes = Get-LabNodeSnapshot -Target hermes
    $atlas = Get-LabNodeSnapshot -Target atlas
    $syncEvidence = Get-LabCrossSyncEvidence -HermesValues $hermes.Values -AtlasValues $atlas.Values -NowUtc (Get-LabNowUtc)
    $probe = @'
printf 'ATLAS BACKUP CANDIDATES\n'
found=0
for d in /home/bs/backups /srv/backups /opt/backups /mnt/backups /backups; do
  [ -d "$d" ] || continue
  found=1
  printf '%s\n' "$d"
  find "$d" -maxdepth 2 -type f -printf '%T@|%p\n' 2>/dev/null | sort -nr | head -n 5 |
    while IFS='|' read -r epoch path; do
      timestamp="$(date -d "@${epoch%.*}" --iso-8601=seconds 2>/dev/null)"
      [ -n "$timestamp" ] || timestamp="$epoch"
      printf '%s %s\n' "$timestamp" "$path"
    done
done
[ "$found" -eq 1 ] || printf 'NO_KNOWN_BACKUP_DIRECTORY_VISIBLE\n'
'@
    $encoded = ConvertTo-LabEncodedShellCommand -Command $probe
    $result = Invoke-LabSsh -Target atlas -RemoteCommand "printf %s $encoded | base64 -d | sh"
    if ($result.Ok) {
        $result.Lines | Write-Output
        Write-Output "latest cross-node sync: $($syncEvidence.State) $($syncEvidence.Detail)"
        $global:LAB_CONTROL_EXIT_CODE = if ($syncEvidence.State -eq 'SYNC_OK') { 0 } else { 2 }
    } else {
        Write-Output "ATLAS: UNREACHABLE ($($result.FailureKind))"
        $global:LAB_CONTROL_EXIT_CODE = 2
    }
}

Export-ModuleMember -Function Get-LabCrossSyncEvidence, Invoke-LabStatus, Invoke-LabHermes, Invoke-LabAtlas, Invoke-LabContainers, Invoke-LabBackups
