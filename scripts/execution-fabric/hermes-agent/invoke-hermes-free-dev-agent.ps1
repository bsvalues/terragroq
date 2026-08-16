param(
    [Parameter(Mandatory = $true)]
    [string]$PacketPath,
    [string]$ComposeFile = "D:\HermesServices\williamos-hermes-agent\compose.yaml",
    [string]$PolicyPath = (Join-Path $PSScriptRoot "hermes-free-dev-agent-v1.policy.json")
    ,[string]$WorkspacePath = ""
    ,[string]$RunId = ""
)

$ErrorActionPreference = "Stop"
$mutex = [Threading.Mutex]::new($false, "Global\WilliamOSHermesFreeDevAgentV1")
$lockHeld = $false
$containerName = $null
$policy = $null
$cleanupRequired = $false
$cleanupWall = $false
$quarantinePath = Join-Path (Split-Path -Parent $PolicyPath) "HERMES_FREE_AGENT_QUARANTINED"

function Remove-ExactAgentContainer {
    param(
        [Parameter(Mandatory = $true)][string]$DockerConfig,
        [Parameter(Mandatory = $true)][string]$Name
    )

    for ($attempt = 1; $attempt -le 3; $attempt++) {
        docker --config $DockerConfig rm --force $Name 2>$null | Out-Null
        $remaining = @(docker --config $DockerConfig ps --all --quiet --filter "name=^/$([regex]::Escape($Name))$")
        if ($LASTEXITCODE -eq 0 -and $remaining.Count -eq 0) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

try {
    $lockHeld = $mutex.WaitOne(0)
    if (-not $lockHeld) { throw "HERMES_FREE_AGENT_CONCURRENCY_WALL" }
    if (Test-Path -LiteralPath $quarantinePath) { throw "HERMES_FREE_AGENT_QUARANTINE_WALL" }

    $policy = Get-Content -Raw -LiteralPath $PolicyPath | ConvertFrom-Json
    $env:DOCKER_CONFIG = $policy.placement.dockerConfig
    $packet = Get-Content -Raw -LiteralPath $PacketPath | ConvertFrom-Json
    $ownedMode = ($policy.placement.workspaceMode -eq "OWNED_WORKTREE")
    if ($ownedMode) {
        $expectedFields = @("maximumTurns", "model", "prompt", "runId", "schemaVersion", "toolsets", "workOrderId", "workspaceMode", "workspacePath")
    } else {
        $expectedFields = @("maximumTurns", "model", "prompt", "schemaVersion", "toolsets", "workOrderId", "workspaceRoot")
    }
    $actualFields = @($packet.PSObject.Properties.Name | Sort-Object)
    if (Compare-Object $actualFields $expectedFields) { throw "HERMES_FREE_AGENT_PACKET_FIELDS_WALL" }
    $expectedSchema = if ($ownedMode) { 2 } else { 1 }
    if (-not ($packet.schemaVersion -is [int] -or $packet.schemaVersion -is [long]) -or $packet.schemaVersion -ne $expectedSchema) { throw "HERMES_FREE_AGENT_PACKET_SCHEMA_WALL" }
    if ($policy.promotion.status -ne "PILOT_AUTHORIZED") { throw "HERMES_FREE_AGENT_PROMOTION_WALL" }
    if ($packet.workOrderId -isnot [string] -or $packet.workOrderId -ne $policy.workOrderId) { throw "HERMES_FREE_AGENT_WORK_ORDER_WALL" }
    $promptMax = if ($ownedMode) { [int]$policy.execution.promptMaxChars } else { 16000 }
    if ($packet.prompt -isnot [string] -or [string]::IsNullOrWhiteSpace($packet.prompt) -or $packet.prompt.Length -gt $promptMax) { throw "HERMES_FREE_AGENT_PROMPT_WALL" }
    if ($packet.model -isnot [string] -or $packet.model -ne $policy.model.id) { throw "HERMES_FREE_AGENT_MODEL_WALL" }
    if (-not ($packet.maximumTurns -is [int] -or $packet.maximumTurns -is [long]) -or $packet.maximumTurns -lt 1 -or $packet.maximumTurns -gt $policy.execution.maximumTurns) { throw "HERMES_FREE_AGENT_TURN_WALL" }
    if ($ownedMode) {
        if ([string]::IsNullOrWhiteSpace($WorkspacePath) -or [string]::IsNullOrWhiteSpace($RunId)) { throw "HERMES_FREE_AGENT_WORKSPACE_MODE_WALL" }
        if ($RunId -notmatch '^[A-Za-z0-9-]{8,64}$' -or $packet.runId -ne $RunId) { throw "HERMES_FREE_AGENT_RUN_ID_WALL" }
        if ($packet.workspaceMode -ne "OWNED_WORKTREE" -or $packet.workspacePath -ne $WorkspacePath) { throw "HERMES_FREE_AGENT_WORKSPACE_MODE_WALL" }
        $resolvedWorkspace = [IO.Path]::GetFullPath($WorkspacePath)
        $allowed = @($policy.placement.allowedWorkspaceRoots | ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\') + '\' })
        if (-not ($allowed | Where-Object { $resolvedWorkspace.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) })) { throw "HERMES_FREE_AGENT_WORKSPACE_ROOT_WALL" }
        $cursor = $resolvedWorkspace
        while ($cursor -and $cursor -ne [IO.Path]::GetPathRoot($cursor)) {
            $item = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "HERMES_FREE_AGENT_WORKSPACE_SYMLINK_WALL" }
            $cursor = Split-Path -Parent $cursor
        }
        $toplevel = (git -C $resolvedWorkspace rev-parse --show-toplevel 2>$null)
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($toplevel)) { throw "HERMES_FREE_AGENT_WORKSPACE_ROOT_WALL" }
        $commonDir = (git -C $resolvedWorkspace rev-parse --path-format=absolute --git-common-dir 2>$null)
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($commonDir)) { throw "HERMES_FREE_AGENT_WORKSPACE_ROOT_WALL" }
        $mainCheckout = Split-Path -Parent ([IO.Path]::GetFullPath($commonDir.Trim()).TrimEnd('\'))
        if ([IO.Path]::GetFullPath($toplevel.Trim()).TrimEnd('\') -ieq $mainCheckout) { throw "HERMES_FREE_AGENT_CANONICAL_REPOSITORY_WALL" }
    } else {
        if ($packet.workspaceRoot -isnot [string] -or $packet.workspaceRoot -ne $policy.placement.workspaceRoot) { throw "HERMES_FREE_AGENT_WORKSPACE_WALL" }
    }
    if ($packet.toolsets -isnot [object[]] -or @($packet.toolsets).Count -ne 2 -or @($packet.toolsets | Select-Object -Unique).Count -ne 2) { throw "HERMES_FREE_AGENT_TOOLSET_WALL" }
    if (@($packet.toolsets | Where-Object { $_ -isnot [string] }).Count -ne 0) { throw "HERMES_FREE_AGENT_TOOLSET_WALL" }
    if (Compare-Object @($packet.toolsets | Sort-Object) @($policy.execution.allowedToolsets | Sort-Object)) { throw "HERMES_FREE_AGENT_TOOLSET_WALL" }
    if (-not (Test-Path -LiteralPath $ComposeFile -PathType Leaf)) { throw "HERMES_FREE_AGENT_COMPOSE_WALL" }
    $image = @(docker --config $policy.placement.dockerConfig image inspect $policy.build.image | ConvertFrom-Json)[0]
    if ($LASTEXITCODE -ne 0 -or $image.Id -ne $policy.build.imageId) { throw "HERMES_FREE_AGENT_IMAGE_ID_WALL" }

    if (-not $ownedMode) {
        $baseline = $policy.placement.baselineWorkspace
        if (-not (Test-Path -LiteralPath (Join-Path $baseline ".git") -PathType Container)) { throw "HERMES_FREE_AGENT_BASELINE_WALL" }
        $baselineHead = (git -C $baseline rev-parse HEAD).Trim()
        $baselineDirty = @(git -C $baseline status --porcelain)
        if ($LASTEXITCODE -ne 0 -or $baselineHead -ne $policy.placement.baselineCommit -or $baselineDirty.Count -ne 0) { throw "HERMES_FREE_AGENT_BASELINE_WALL" }
    }

    if ($ownedMode) {
        $runId = $RunId
        $runWorkspace = $resolvedWorkspace
    } else {
        $runId = [guid]::NewGuid().ToString("N")
        $runRoot = Join-Path $policy.placement.workspaceRoot "runs"
        $runWorkspace = Join-Path $runRoot $runId
        New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
        git clone --local --no-hardlinks $baseline $runWorkspace
        if ($LASTEXITCODE -ne 0) { throw "HERMES_FREE_AGENT_CLONE_WALL" }
        git -C $runWorkspace checkout --detach $policy.placement.baselineCommit
        if ($LASTEXITCODE -ne 0) { throw "HERMES_FREE_AGENT_CLONE_WALL" }
    }

    $env:WILLIAMOS_AGENT_WORKSPACE = $runWorkspace
    docker --config $policy.placement.dockerConfig compose --project-name williamos-hermes-agent --file $ComposeFile up --detach --wait inference-proxy
    if ($LASTEXITCODE -ne 0) { throw "HERMES_FREE_AGENT_PROXY_WALL" }

    $network = @(docker --config $policy.placement.dockerConfig network inspect $policy.containment.network | ConvertFrom-Json)[0]
    $memberNames = @($network.Containers.PSObject.Properties.Value.Name | Sort-Object)
    if (-not $network.Internal -or $network.Labels.'com.williamos.scope' -ne 'hermes-free-dev-agent-v1') { throw "HERMES_FREE_AGENT_NETWORK_WALL" }
    if (Compare-Object $memberNames @("williamos-hermes-inference-proxy")) { throw "HERMES_FREE_AGENT_NETWORK_MEMBERSHIP_WALL" }

    $workspaceSentence = if ($ownedMode) { "You are operating only inside /workspace, the owned WilliamOS worktree for this Work Order. Change only the reserved paths named in the task." } else { "You are operating only inside /workspace, a unique disposable clone of the pinned WilliamOS baseline." }
    $query = @"
Work Order: $($packet.workOrderId)

$workspaceSentence
Do not request credentials, contact the owner, access Docker, use external networks, push Git, or touch production.
Make only the requested changes and report changed paths plus validation evidence.

$($packet.prompt)
"@
    $queryB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($query))
    $containerName = "williamos-hermes-agent-$runId"
    Set-Content -LiteralPath $quarantinePath -Value "ACTIVE_CONTAINER=$containerName" -Encoding Ascii -NoNewline
    $cleanupRequired = $true
    $arguments = @(
        "--config", $policy.placement.dockerConfig, "compose", "--project-name", "williamos-hermes-agent", "--file", $ComposeFile,
        "run", "--detach", "--name", $containerName, "--no-deps", "-T",
        "-e", "WILLIAMOS_QUERY_B64=$queryB64", "-e", "WILLIAMOS_MAX_TURNS=$($packet.maximumTurns)",
        "agent", "python", "/opt/runner/run_agent.py"
    )
    & docker @arguments | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "HERMES_FREE_AGENT_START_WALL" }
    $deadline = [DateTime]::UtcNow.AddSeconds($policy.execution.timeoutSeconds)
    do {
        $container = @(docker --config $policy.placement.dockerConfig container inspect $containerName | ConvertFrom-Json)[0]
        if ($LASTEXITCODE -ne 0) { throw "HERMES_FREE_AGENT_CONTAINER_STATE_WALL" }
        if (-not $container.State.Running) { break }
        Start-Sleep -Seconds 2
    } while ([DateTime]::UtcNow -lt $deadline)
    if ($container.State.Running) {
        throw "HERMES_FREE_AGENT_TIMEOUT_WALL"
    }
    docker --config $policy.placement.dockerConfig logs $containerName
    $containerExitCode = [int]$container.State.ExitCode
    if (-not (Remove-ExactAgentContainer -DockerConfig $policy.placement.dockerConfig -Name $containerName)) {
        throw "HERMES_FREE_AGENT_CLEANUP_WALL"
    }
    $cleanupRequired = $false
    Remove-Item -LiteralPath $quarantinePath -Force
    if ($containerExitCode -ne 0) { throw "HERMES_FREE_AGENT_EXECUTION_WALL" }
    Write-Output "HERMES_FREE_AGENT_COMPLETE runId=$runId workspace=$runWorkspace"
}
finally {
    if ($cleanupRequired -and $null -ne $policy -and -not [string]::IsNullOrWhiteSpace($containerName)) {
        if (Remove-ExactAgentContainer -DockerConfig $policy.placement.dockerConfig -Name $containerName) {
            $cleanupRequired = $false
            Remove-Item -LiteralPath $quarantinePath -Force -ErrorAction SilentlyContinue
        }
        else {
            $cleanupWall = $true
        }
    }
    if ($lockHeld) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
    if ($cleanupWall) { throw "HERMES_FREE_AGENT_CLEANUP_WALL" }
}
