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

function Get-HermesProbeCommand {
    $probe = @'
$ErrorActionPreference='SilentlyContinue'
function Out-Kv($k,$v){ if([string]::IsNullOrWhiteSpace([string]$v)){$v='UNKNOWN'}; Write-Output ($k+'='+([string]$v).Trim()) }
Out-Kv 'hostname' $env:COMPUTERNAME
$os=Get-CimInstance Win32_OperatingSystem
Out-Kv 'os' $os.Caption
Out-Kv 'uptime' ((Get-Date)-$os.LastBootUpTime).ToString('d\d\ h\h\ m\m')
$docker=if(Get-Command docker -ErrorAction SilentlyContinue){docker info --format '{{.ServerVersion}}' 2>$null}else{$null}
Out-Kv 'docker' $docker
$ollama=if(Get-Command ollama -ErrorAction SilentlyContinue){$o=ollama list 2>$null; if($LASTEXITCODE -eq 0){'AVAILABLE'}else{'UNAVAILABLE'}}else{'NOT_INSTALLED'}
Out-Kv 'ollama' $ollama
$gpu=if(Get-Command nvidia-smi -ErrorAction SilentlyContinue){nvidia-smi --query-gpu=name --format=csv,noheader 2>$null | Select-Object -First 1}else{$null}
Out-Kv 'gpu' $gpu
$d=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
if($d){Out-Kv 'disk' ('{0:N0} GB free of {1:N0} GB' -f ($d.FreeSpace/1GB),($d.Size/1GB))}else{Out-Kv 'disk' $null}
'@
    $encoded = ConvertTo-LabEncodedPowerShellCommand -Command $probe
    "powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand $encoded"
}

function Get-AtlasProbeCommand {
    $probe = @'
kv(){ v="$2"; [ -n "$v" ] || v=UNKNOWN; printf '%s=%s\n' "$1" "$v"; }
kv hostname "$(hostname 2>/dev/null)"
kv os "$(. /etc/os-release 2>/dev/null; printf '%s' "$PRETTY_NAME")"
kv uptime "$(uptime -p 2>/dev/null)"
kv docker "$(docker info --format '{{.ServerVersion}}' 2>/dev/null)"
tcp_listener(){ ss -ltnH 2>/dev/null | awk -v p=":$1" '$4 ~ p"$" {found=1} END {exit !found}'; }
postgres_probe(){
  if command -v pg_isready >/dev/null 2>&1; then
    pg_isready -q -h 127.0.0.1 -p 5432 && { printf PG_ISREADY_ACCEPTING; return; }
    printf PG_ISREADY_REJECTING; return
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
  tcp_listener 6379 && printf TCP_LISTENER_ONLY || printf NOT_OBSERVED
}
mongo_probe(){
  if command -v mongosh >/dev/null 2>&1; then
    reply="$(mongosh --quiet --host 127.0.0.1 --port 27017 --eval 'db.adminCommand({ping:1}).ok' 2>/dev/null | tail -n 1)"
    [ "$reply" = 1 ] && { printf MONGO_PING_OK; return; }
    printf MONGO_PING_FAILED; return
  fi
  tcp_listener 27017 && printf TCP_LISTENER_ONLY || printf NOT_OBSERVED
}
container_port_evidence(){
  port="$1"
  row="$(docker ps --format '{{.Names}}|{{.Ports}}' 2>/dev/null | awk -F'|' -v p=":$port->" 'index($2,p){print $1; exit}')"
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
latest="$({
  for d in /srv/backups /var/backups /opt/backups /mnt/backups /backups; do
    [ -d "$d" ] || continue
    find "$d" -maxdepth 2 -type f -printf '%T@|%TY-%Tm-%TdT%TH:%TM:%TS%z|%p\n' 2>/dev/null
  done
} | sort -nr | head -n 1 | cut -d'|' -f2-)"
kv backup "$latest"
kv cross_sync UNKNOWN
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
    Write-LabNodeSummary $hermes
    Write-LabNodeSummary $atlas
    Write-Output 'LAB'
    Write-Output "  latest backup: $(Get-LabValue $atlas.Values 'backup')"
    Write-Output "  latest cross-node sync: $(Get-LabValue $atlas.Values 'cross_sync')"

    $failures = @($hermes, $atlas | Where-Object { -not $_.Reachable })
    if ($failures.Count -eq 0) {
        $requiredValues = @(
            (Get-LabValue $hermes.Values 'docker'),
            (Get-LabValue $hermes.Values 'ollama'),
            (Get-LabValue $hermes.Values 'gpu'),
            (Get-LabValue $hermes.Values 'disk'),
            (Get-LabValue $atlas.Values 'docker'),
            (Get-LabValue $atlas.Values 'disk'),
            (Get-LabValue $atlas.Values 'backup'),
            (Get-LabValue $atlas.Values 'cross_sync')
        )
        $genericIncomplete = @($requiredValues | Where-Object { $_ -match '^(?i:UNKNOWN|UNAVAILABLE|NOT_FOUND|NOT_INSTALLED|NOT_OBSERVED)' }).Count -gt 0
        $postgresReady = (Get-LabValue $atlas.Values 'postgres_evidence') -eq 'PG_ISREADY_ACCEPTING'
        $redisReady = (Get-LabValue $atlas.Values 'redis_evidence') -in @('REDIS_PING_PONG', 'REDIS_AUTH_REQUIRED_REACHABLE')
        $mongoReady = (Get-LabValue $atlas.Values 'mongo_evidence') -eq 'MONGO_PING_OK'
        if ($genericIncomplete -or -not $postgresReady -or -not $redisReady -or -not $mongoReady) {
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
    $commands = @{
        hermes = "powershell.exe -NoLogo -NoProfile -NonInteractive -Command `$ErrorActionPreference='SilentlyContinue'; docker ps --format 'table {{.Names}}`t{{.Image}}`t{{.Status}}`t{{.Ports}}'"
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
    $probe = @'
printf 'ATLAS BACKUP CANDIDATES\n'
found=0
for d in /srv/backups /var/backups /opt/backups /mnt/backups /backups; do
  [ -d "$d" ] || continue
  found=1
  printf '%s\n' "$d"
  find "$d" -maxdepth 2 -type f -printf '%TY-%Tm-%TdT%TH:%TM:%TS%z %p\n' 2>/dev/null | sort -r | head -n 5
done
[ "$found" -eq 1 ] || printf 'NO_KNOWN_BACKUP_DIRECTORY_VISIBLE\n'
printf 'CROSS_NODE_SYNC\nUNKNOWN (no verified marker path configured)\n'
'@
    $encoded = ConvertTo-LabEncodedShellCommand -Command $probe
    $result = Invoke-LabSsh -Target atlas -RemoteCommand "printf %s $encoded | base64 -d | sh"
    if ($result.Ok) {
        $result.Lines | Write-Output
        $global:LAB_CONTROL_EXIT_CODE = 0
    } else {
        Write-Output "ATLAS: UNREACHABLE ($($result.FailureKind))"
        $global:LAB_CONTROL_EXIT_CODE = 2
    }
}

Export-ModuleMember -Function Invoke-LabStatus, Invoke-LabHermes, Invoke-LabAtlas, Invoke-LabContainers, Invoke-LabBackups
