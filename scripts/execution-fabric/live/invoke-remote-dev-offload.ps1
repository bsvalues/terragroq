[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PolicyPath,
    [Parameter(Mandatory = $true)][string]$PacketPath,
    [Parameter(Mandatory = $true)][string]$DispatchEnvelopePath,
    [Parameter(Mandatory = $true)][string]$PatchPath,
    [Parameter(Mandatory = $true)][string]$EvidenceRoot,
    [Parameter(Mandatory = $true)][string]$Operation,
    [Parameter(Mandatory = $true)][int]$Attempt,
    [Parameter(Mandatory = $true)][string]$PreviousEvidenceSha256,
    [Parameter(Mandatory = $true)][string]$LaunchTicketPath,
    [Parameter(Mandatory = $true)][string]$AegisKnownHostLine,
    [int]$SshTimeoutSeconds = 5400
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$trustedAegisFingerprint = 'SHA256:N+YNbMg3nUb0tX7ZYLJfJSt9f0dUOukBUNLyYb1WByo'
$trustedWorkerSha256 = '7e9286b38d76e88eef13aa37628e69151aca2527b6bdfd50d9b835de0a5cb022'

function Write-ResultAndExit {
    param([string]$Status, [string]$ReasonCode, [string]$Detail, [int]$ExitCode)
    $safe = [regex]::Replace([string]$Detail, '(?i)(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+\S+)', '[REDACTED]')
    if ($safe.Length -gt 512) { $safe = $safe.Substring(0, 512) }
    [Console]::Out.WriteLine((@{ status = $Status; reasonCode = $ReasonCode; detail = $safe } | ConvertTo-Json -Compress))
    exit $ExitCode
}

function Resolve-InputFile {
    param([string]$PathValue, [string]$Label)
    if (-not (Test-Path -LiteralPath $PathValue -PathType Leaf)) { Write-ResultAndExit 'INVALID_INPUT' 'INPUT_FILE_MISSING' "$Label is unavailable" 64 }
    $item = Get-Item -LiteralPath $PathValue -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Write-ResultAndExit 'INVALID_INPUT' 'INPUT_PATH_REPARSE_POINT' "$Label must not be a reparse point" 64 }
    return $item.FullName
}

function Get-Sha256Hex {
    param([byte[]]$Bytes)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}

function Assert-NoReparseAncestor {
    param([string]$Root, [string]$Target)
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $targetFull = [IO.Path]::GetFullPath($Target).TrimEnd('\')
    if ($targetFull -ne $rootFull -and -not $targetFull.StartsWith($rootFull + '\', [StringComparison]::OrdinalIgnoreCase)) { Write-ResultAndExit 'INVALID_INPUT' 'EVIDENCE_ROOT_INVALID' 'evidence path escapes its ignored root' 64 }
    $current = $rootFull
    foreach ($segment in $targetFull.Substring($rootFull.Length).TrimStart('\').Split('\', [StringSplitOptions]::RemoveEmptyEntries)) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Write-ResultAndExit 'INVALID_INPUT' 'EVIDENCE_ANCESTOR_REPARSE_POINT' 'evidence ancestor is a reparse point' 64 }
        }
        $current = Join-Path $current $segment
    }
    if (Test-Path -LiteralPath $current) {
        $item = Get-Item -LiteralPath $current -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Write-ResultAndExit 'INVALID_INPUT' 'EVIDENCE_ANCESTOR_REPARSE_POINT' 'evidence run directory is a reparse point' 64 }
    }
}

function ConvertTo-WindowsArgument {
    param([AllowEmptyString()][string]$Value)
    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
    $builder = [Text.StringBuilder]::new(); [void]$builder.Append('"'); $slashes = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq '\') { $slashes++; continue }
        if ($character -eq '"') { [void]$builder.Append(('\' * (($slashes * 2) + 1))); [void]$builder.Append('"'); $slashes = 0; continue }
        if ($slashes -gt 0) { [void]$builder.Append(('\' * $slashes)); $slashes = 0 }
        [void]$builder.Append($character)
    }
    if ($slashes -gt 0) { [void]$builder.Append(('\' * ($slashes * 2))) }
    [void]$builder.Append('"'); return $builder.ToString()
}

function Invoke-BoundedProcess {
    param([string]$FileName, [string[]]$Arguments, [int]$TimeoutSeconds, [string]$StandardInput = $null)
    $psi = [Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $FileName
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.RedirectStandardInput = $null -ne $StandardInput
    $psi.Arguments = (($Arguments | ForEach-Object { ConvertTo-WindowsArgument ([string]$_) }) -join ' ')
    $process = [Diagnostics.Process]::new(); $process.StartInfo = $psi
    if (-not $process.Start()) { throw 'process did not start' }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync(); $stderrTask = $process.StandardError.ReadToEndAsync()
    if ($null -ne $StandardInput) { $process.StandardInput.Write($StandardInput); $process.StandardInput.Close() }
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        try { $process.Kill($true) } catch { try { $process.Kill() } catch {} }
        [void]$process.WaitForExit(5000)
        return @{ TimedOut = $true; ExitCode = 2; Stdout = ''; Stderr = 'bounded process timeout' }
    }
    return @{ TimedOut = $false; ExitCode = $process.ExitCode; Stdout = $stdoutTask.GetAwaiter().GetResult(); Stderr = $stderrTask.GetAwaiter().GetResult() }
}

function Get-ControllerValidationArguments {
    param([string]$Contract, [string]$Activation, [string]$Authority, [string]$Policy, [string]$Packet, [string]$Envelope)
    return @($Contract, $Activation, $Authority, $Policy, $Packet, $Envelope)
}

$allowedOperations = @('PROVE_PREFLIGHT','CREATE_WORKSPACE','APPLY_RESERVED_PATCH','RESTORE_DOTNET','TEST_WORKFLOW_CONTRACT','TEST_DOTNET_INFORMATIONAL','BUILD_DOTNET_RELEASE','COMMIT_RESERVED_PATHS','PUSH_AUTHORIZED_BRANCH','PROVE_POST_MERGE','CLEAN_EXACT_WORKSPACE')
if ($allowedOperations -notcontains $Operation) { Write-ResultAndExit 'INVALID_INPUT' 'OPERATION_NOT_ALLOWED' 'operation is outside the fixed allowlist' 64 }
if ($Attempt -lt 1 -or $Attempt -gt 3) { Write-ResultAndExit 'INVALID_INPUT' 'ATTEMPT_INVALID' 'attempt must be 1, 2, or 3' 64 }
if ($SshTimeoutSeconds -lt 1 -or $SshTimeoutSeconds -gt 5400) { Write-ResultAndExit 'INVALID_INPUT' 'TIMEOUT_INVALID' 'SSH timeout must remain within the packet ceiling' 64 }

try {
    $policyFull = Resolve-InputFile $PolicyPath 'policy'
    $packetFull = Resolve-InputFile $PacketPath 'packet'
    $envelopeFull = Resolve-InputFile $DispatchEnvelopePath 'dispatch envelope'
    $patchFull = Resolve-InputFile $PatchPath 'patch'
    $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
    $repositoryRoot = [IO.Path]::GetFullPath((Join-Path $scriptRoot '..\..\..'))
    $allowedEvidenceRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot '.artifacts\execution-fabric\remote-dev-offload-v1'))
    $requestedEvidenceRoot = [IO.Path]::GetFullPath($EvidenceRoot)
    if ($requestedEvidenceRoot.TrimEnd('\') -ne $allowedEvidenceRoot.TrimEnd('\')) { Write-ResultAndExit 'INVALID_INPUT' 'EVIDENCE_ROOT_INVALID' 'evidence root must be the proof-scoped ignored runtime tree' 64 }
    $contractPath = Join-Path $scriptRoot 'remote-dev-offload-contract.mjs'
    $activationPath = Join-Path $scriptRoot 'remote-dev-offload-activation.mjs'
    $activationAuthorityPath = Join-Path $repositoryRoot 'config\execution-fabric\remote-dev-offload-v1-activation.json'
    $workerPath = Join-Path $scriptRoot 'aegis-remote-dev-worker.sh'
    if (-not (Test-Path -LiteralPath $contractPath -PathType Leaf) -or -not (Test-Path -LiteralPath $workerPath -PathType Leaf)) { Write-ResultAndExit 'INVALID_INPUT' 'IMPLEMENTATION_MISSING' 'contract or fixed worker is unavailable' 64 }
    $workerText = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($workerPath)).Replace("`r`n", "`n")
    $workerBytes = [Text.UTF8Encoding]::new($false).GetBytes($workerText)
    if ((Get-Sha256Hex $workerBytes) -ne $trustedWorkerSha256) { Write-ResultAndExit 'INVALID_INPUT' 'WORKER_DIGEST_MISMATCH' 'local fixed worker differs from the reviewed digest' 64 }

    try {
        $nodeCommands = @(Get-Command node -CommandType Application -ErrorAction Stop)
        $nodeCommand = @($nodeCommands | Where-Object { $_.Source -match '[\\/]nodejs[\\/]node\.exe$' })[0]
        if (-not $nodeCommand) { $nodeCommand = $nodeCommands[0] }
        $node = $nodeCommand.Source
    }
    catch { Write-ResultAndExit 'BLOCKED' 'NODE_UNAVAILABLE' 'local packet validator is unavailable' 2 }
    $validateScript = @'
import fs from "node:fs";
import { pathToFileURL } from "node:url";
const [contractPath,activationPath,activationAuthorityPath,policyPath,packetPath,envelopePath]=process.argv.slice(2);
const contract=await import(pathToFileURL(contractPath));
const activation=await import(pathToFileURL(activationPath));
const authority=JSON.parse(fs.readFileSync(activationAuthorityPath,"utf8"));
const policy=JSON.parse(fs.readFileSync(policyPath,"utf8"));
const packet=JSON.parse(fs.readFileSync(packetPath,"utf8"));
const dispatchEnvelope=JSON.parse(fs.readFileSync(envelopePath,"utf8"));
let result=contract.bindRemoteDevPacket(packet,policy,{now:new Date().toISOString(),seenRunIds:[],branch:packet.branch,dispatchEnvelope});
if(result.status==="INACTIVE_TRUSTED_MAIN_READY"&&result.executionAuthorized===false&&JSON.stringify(result.packet)===JSON.stringify(packet)){
 const candidate={runId:packet.runId,workOrderId:authority.workOrderId,issue:authority.issue,repository:packet.repository,baseRef:packet.baseRef,baseSha:packet.baseSha,nodeId:packet.nodeId,workspace:packet.workspace,branch:packet.branch,operations:packet.operations,resources:{canonicalProfileEquivalent:false,...packet.resourceLimits},network:authority.network,executionIdentity:authority.executionIdentity};
 const active=activation.validateRemoteDevActivationAuthority(authority,candidate);
 if(active.status!=="ACTIVATION_AUTHORITY_MATCHED"){process.stdout.write(JSON.stringify({status:"BLOCKED",reasonCode:"REMOTE_DEV_SCOPE_INACTIVE",detail:"trusted-main proof scope is reviewed but inactive"}));process.exit(2)}
 result={status:"READY",packet:result.packet,policySha256:result.policySha256};
}
if(result.status!=="READY"||JSON.stringify(result.packet)!==JSON.stringify(packet)){process.stdout.write(JSON.stringify({status:"BLOCKED",reasonCode:"PACKET_NOT_PREBOUND",detail:JSON.stringify(result.reasons||[])}));process.exit(64)}
process.stdout.write(JSON.stringify({status:"READY",packet:result.packet,policySha256:result.policySha256}));
'@
    $validationFiles = Get-ControllerValidationArguments $contractPath $activationPath $activationAuthorityPath $policyFull $packetFull $envelopeFull
    $validation = Invoke-BoundedProcess $node (@('--input-type=module', '-e', $validateScript, $node) + $validationFiles) 30
    if ($validation.ExitCode -eq 2) {
        try { $inactive = $validation.Stdout | ConvertFrom-Json } catch { $inactive = $null }
        if ($inactive.reasonCode -eq 'REMOTE_DEV_SCOPE_INACTIVE') { Write-ResultAndExit 'BLOCKED' 'REMOTE_DEV_SCOPE_INACTIVE' 'trusted-main proof scope is reviewed but inactive' 2 }
    }
    if ($validation.TimedOut -or $validation.ExitCode -ne 0) { Write-ResultAndExit 'INVALID_INPUT' 'PACKET_VALIDATION_FAILED' ($validation.Stdout + $validation.Stderr) 64 }
    try { $validated = $validation.Stdout | ConvertFrom-Json }
    catch { Write-ResultAndExit 'INVALID_INPUT' 'PACKET_VALIDATION_MALFORMED' 'local contract validation did not return JSON' 64 }
    if ($validated.status -ne 'READY' -or $validated.packet.bindings.policySha256 -ne $validated.policySha256) { Write-ResultAndExit 'INVALID_INPUT' 'PACKET_VALIDATION_FAILED' 'packet is not Task 1 READY evidence' 64 }
    $packet = $validated.packet
    if ($packet.operations -notcontains $Operation) { Write-ResultAndExit 'INVALID_INPUT' 'OPERATION_NOT_ALLOWED' 'operation is outside packet allowlist' 64 }
    if ($PreviousEvidenceSha256 -ne 'null' -and $PreviousEvidenceSha256 -notmatch '^[a-f0-9]{64}$') { Write-ResultAndExit 'INVALID_INPUT' 'EVIDENCE_CHAIN_INVALID' 'previous evidence digest is invalid' 64 }
    $ticketFull = Resolve-InputFile $LaunchTicketPath 'activation session handle'
    $ticketBytes = [IO.File]::ReadAllBytes($ticketFull)
    try { $sessionHandle = [Text.Encoding]::UTF8.GetString($ticketBytes) | ConvertFrom-Json } catch { Write-ResultAndExit 'INVALID_INPUT' 'ACTIVATION_SESSION_INVALID' 'activation session handle is malformed' 64 }
    if ((@($sessionHandle.PSObject.Properties.Name) -join ',') -ne 'runId' -or $sessionHandle.runId -ne $packet.runId) { Write-ResultAndExit 'INVALID_INPUT' 'ACTIVATION_SESSION_INVALID' 'activation session run differs' 64 }
    $patchBytes = [IO.File]::ReadAllBytes($patchFull)
    if ((Get-Sha256Hex $patchBytes) -ne $packet.patch.sha256) { Write-ResultAndExit 'INVALID_INPUT' 'PATCH_BINDING_MISMATCH' 'patch digest differs from packet' 64 }

    $knownHostMatch = [regex]::Match($AegisKnownHostLine, '^aegis\s+(ssh-(?:ed25519|rsa)|ecdsa-sha2-nistp(?:256|384|521))\s+([A-Za-z0-9+/]+={0,2})$')
    if (-not $knownHostMatch.Success) { Write-ResultAndExit 'INVALID_INPUT' 'HOST_KEY_PIN_INVALID' 'AEGIS known-host binding is malformed' 64 }
    try { $keyBytes = [Convert]::FromBase64String($knownHostMatch.Groups[2].Value) }
    catch { Write-ResultAndExit 'INVALID_INPUT' 'HOST_KEY_PIN_INVALID' 'AEGIS key bytes are malformed' 64 }
    $fingerprint = 'SHA256:' + [Convert]::ToBase64String(([Security.Cryptography.SHA256]::Create()).ComputeHash($keyBytes)).TrimEnd('=')
    if ($fingerprint -ne $trustedAegisFingerprint) { Write-ResultAndExit 'INVALID_INPUT' 'HOST_KEY_PIN_MISMATCH' 'AEGIS host-key fingerprint differs from immutable approval' 64 }

    $runDirectory = Join-Path ([IO.Path]::GetFullPath($EvidenceRoot)) $packet.runId
    Assert-NoReparseAncestor $repositoryRoot $requestedEvidenceRoot
    Assert-NoReparseAncestor $repositoryRoot $runDirectory
    try { [IO.Directory]::CreateDirectory($runDirectory) | Out-Null }
    catch { Write-ResultAndExit 'BLOCKED' 'EVIDENCE_WRITE_FAILED' 'evidence run directory could not be created' 2 }
    $runItem = Get-Item -LiteralPath $runDirectory -Force
    if (($runItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Write-ResultAndExit 'INVALID_INPUT' 'EVIDENCE_PATH_REPARSE_POINT' 'evidence directory must not be a reparse point' 64 }

    $policyB64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($policyFull))
    $packetB64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($packetFull))
    $patchB64 = [Convert]::ToBase64String($patchBytes)
    $workerB64 = [Convert]::ToBase64String($workerBytes)
    $knownHostB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($AegisKnownHostLine))
    $ticketB64 = [Convert]::ToBase64String($ticketBytes)
    $relayValues = @{ policy = $policyB64; packet = $packetB64; patch = $patchB64; worker = $workerB64; knownHost = $knownHostB64; ticket = $ticketB64; operation = $Operation; attempt = $Attempt; previous = $PreviousEvidenceSha256 }
    $relayInput = $relayValues | ConvertTo-Json -Compress

    $relayValidator = @'
const crypto=require("node:crypto"),fs=require("node:fs");
const fail=(code,detail)=>{process.stdout.write(JSON.stringify({status:"BLOCKED",reasonCode:code,detail}));process.exit(64)};
const exact=(v,keys,code)=>{if(!v||typeof v!=="object"||Array.isArray(v)||JSON.stringify(Object.keys(v).sort())!==JSON.stringify([...keys].sort()))fail(code,"field set differs")};
const jcs=v=>v===null?"null":typeof v==="string"?JSON.stringify(v):typeof v==="number"?(Number.isFinite(v)?JSON.stringify(v):fail("NUMBER_INVALID","non-finite number")):typeof v==="boolean"?String(v):Array.isArray(v)?`[${v.map(jcs).join(",")}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${jcs(v[k])}`).join(",")}}`;
const hash=b=>crypto.createHash("sha256").update(b).digest("hex");let relay,policy,packet,patch;
try{relay=JSON.parse(fs.readFileSync(0,"utf8"));policy=JSON.parse(Buffer.from(relay.policy,"base64").toString("utf8"));packet=JSON.parse(Buffer.from(relay.packet,"base64").toString("utf8"));patch=Buffer.from(relay.patch,"base64")}catch{fail("RELAY_INPUT_INVALID","relay input is malformed")}
const operations=["PROVE_PREFLIGHT","CREATE_WORKSPACE","APPLY_RESERVED_PATCH","RESTORE_DOTNET","TEST_WORKFLOW_CONTRACT","TEST_DOTNET_INFORMATIONAL","BUILD_DOTNET_RELEASE","COMMIT_RESERVED_PATHS","PUSH_AUTHORIZED_BRANCH","PROVE_POST_MERGE","CLEAN_EXACT_WORKSPACE"];
const paths=[".github/workflows/dotnet-test.yml",".github/workflows/terrafusion-ci.yml","tests/ci-terrafusion-unit-informational.test.ts","docs/brain/evidence/WO-TF-REMOTE-DEV-OFFLOAD-001-proof.md"];
const limits={cpuThreads:12,memoryBytes:12884901888,scratchBytes:85899345920,timeoutSeconds:5400,maxAttempts:3};
const policyDigest=hash(Buffer.from(jcs(policy),"utf8"));if(policyDigest!=="8061e269ff6d68782c69d6f2ecc1cdbb0ff0efb309335e895d90caf0d3788132")fail("POLICY_DIGEST_MISMATCH","canonical policy differs");
exact(packet,["schemaVersion","runId","workOrderId","repository","baseRef","baseSha","branch","nodeId","workspace","transport","resourceLimits","operations","patch","authority","bindings"],"PACKET_FIELDS_INVALID");
if(packet.schemaVersion!==1||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(packet.runId)||packet.workOrderId!=="WO-TF-REMOTE-DEV-OFFLOAD-001"||packet.repository!=="bsvalues/terrafusion_os_1.0"||packet.baseRef!=="refs/heads/main"||!/^[a-f0-9]{40}$/.test(packet.baseSha)||!/^codex\/wo-tf-remote-dev-offload-001-[a-z0-9-]+$/.test(packet.branch)||packet.nodeId!=="aegis"||packet.workspace!=="/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001")fail("IDENTITY_MISMATCH","immutable packet identity differs");
exact(packet.transport,["controller","relay","worker"],"TRANSPORT_FIELDS_INVALID");if(jcs(packet.transport)!==jcs({controller:"omen",relay:"hermes",worker:"aegis"}))fail("TRANSPORT_MISMATCH","Hermes mediation is mandatory");
exact(packet.resourceLimits,["cpuThreads","memoryBytes","scratchBytes","timeoutSeconds","maxAttempts"],"RESOURCE_FIELDS_INVALID");if(jcs(packet.resourceLimits)!==jcs(limits))fail("RESOURCE_LIMIT_EXCEEDED","resource envelope differs");
if(jcs(packet.operations)!==jcs(operations)||!operations.includes(relay.operation))fail("OPERATION_SET_MISMATCH","operation set differs");
exact(packet.patch,["sha256","generation","changedPaths"],"PATCH_FIELDS_INVALID");if(packet.patch.generation!==1||jcs(packet.patch.changedPaths)!==jcs(paths))fail("PATCH_PATHS_MISMATCH","reserved patch paths differ");if(hash(patch)!==packet.patch.sha256)fail("PATCH_DIGEST_MISMATCH","patch bytes differ");
exact(packet.authority,["grantId","issuedAt","expiresAt","singleUse"],"AUTHORITY_FIELDS_INVALID");const issued=Date.parse(packet.authority.issuedAt),expires=Date.parse(packet.authority.expiresAt),now=Date.now();if(packet.authority.grantId!=="grant-remote-dev-offload-v1"||packet.authority.singleUse!==true||!Number.isFinite(issued)||!Number.isFinite(expires)||issued>=now||expires<=now||expires-issued>14400000)fail("AUTHORITY_INVALID","grant is invalid or expired");
exact(packet.bindings,["policySha256","packetSha256"],"BINDING_FIELDS_INVALID");if(packet.bindings.policySha256!==policyDigest)fail("POLICY_DIGEST_MISMATCH","packet policy binding differs");const unsigned=structuredClone(packet);delete unsigned.bindings;const packetDigest=hash(Buffer.from(jcs(unsigned),"utf8"));if(packet.bindings.packetSha256!==packetDigest)fail("PACKET_DIGEST_MISMATCH","packet digest differs");
if(!Number.isSafeInteger(relay.attempt)||relay.attempt<1||relay.attempt>3)fail("ATTEMPT_INVALID","attempt differs");if(relay.previous!=="null"&&!/^[a-f0-9]{64}$/.test(relay.previous))fail("EVIDENCE_CHAIN_INVALID","previous evidence digest differs");if(typeof relay.ticket!=="string"||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(relay.ticket)||Buffer.from(relay.ticket,"base64").length>65536)fail("SIGNED_LAUNCH_TICKET_INVALID","signed launch ticket encoding differs");
process.stdout.write(JSON.stringify({status:"READY",runId:packet.runId,policySha256:policyDigest,packetSha256:packetDigest,operationIndex:operations.indexOf(relay.operation)}));
'@
    $validatorBytes = [Text.Encoding]::UTF8.GetBytes($relayValidator)
    $validatorSha256 = Get-Sha256Hex $validatorBytes
    $validatorStream = [IO.MemoryStream]::new()
    $gzip = [IO.Compression.GZipStream]::new($validatorStream, [IO.Compression.CompressionMode]::Compress, $true)
    try { $gzip.Write($validatorBytes, 0, $validatorBytes.Length) } finally { $gzip.Dispose() }
    $validatorGzipB64 = [Convert]::ToBase64String($validatorStream.ToArray()); $validatorStream.Dispose()

    $relayScript = @'
$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
$script:activationStarted=$false
function Fail([string]$code,[string]$detail,[int]$exitCode=2){if($script:activationStarted-and(Get-Command InvokeActivation -ErrorAction SilentlyContinue)){try{$s=InvokeActivation ([ordered]@{action='settle'}) 'ACTIVATION_SETTLEMENT_FAILED' -NoFail;if(-not$s-or$s.Value.status-ne'CONSUMED_SINGLE_USE'-or$s.Value.leaseReleased-ne$true-or$s.Value.replayRejected-ne$true){$code='ACTIVATION_SETTLEMENT_FAILED';$detail='terminal failure settlement proof differs'}}catch{$code='ACTIVATION_SETTLEMENT_FAILED';$detail='terminal failure settlement failed'}};[Console]::Out.WriteLine((@{status='BLOCKED';reasonCode=$code;detail=$detail}|ConvertTo-Json -Compress));exit $exitCode}
function Hash([byte[]]$bytes){$h=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($h.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
$relayRaw=[Console]::In.ReadToEnd();$relay=$relayRaw|ConvertFrom-Json
$policyBytes=[Convert]::FromBase64String($relay.policy);$packetBytes=[Convert]::FromBase64String($relay.packet);$patchBytes=[Convert]::FromBase64String($relay.patch);$workerBytes=[Convert]::FromBase64String($relay.worker)
$policy=[Text.Encoding]::UTF8.GetString($policyBytes)|ConvertFrom-Json;$packetText=[Text.Encoding]::UTF8.GetString($packetBytes);$packet=$packetText|ConvertFrom-Json
$validatorCompressed=[Convert]::FromBase64String('__VALIDATOR_GZIP__');$sourceStream=[IO.MemoryStream]::new([byte[]]$validatorCompressed);$validatorGzip=[IO.Compression.GZipStream]::new($sourceStream,[IO.Compression.CompressionMode]::Decompress);$targetStream=[IO.MemoryStream]::new();try{$validatorGzip.CopyTo($targetStream)}finally{$validatorGzip.Dispose();$sourceStream.Dispose()};$validatorBytes=$targetStream.ToArray();$targetStream.Dispose();if((Hash $validatorBytes)-ne'__VALIDATOR_SHA__'){Fail 'RELAY_VALIDATOR_MISMATCH' 'validator digest differs' 64}
$validatorPath=Join-Path ([IO.Path]::GetTempPath()) ('remote-dev-relay-'+[Guid]::NewGuid().ToString('N')+'.cjs');[IO.File]::WriteAllBytes($validatorPath,$validatorBytes)
try{$nodeCommands=@(Get-Command node.exe,node -CommandType Application -ErrorAction SilentlyContinue);$nodeCommand=@($nodeCommands|Where-Object{$_.Source-match'[\\/]nodejs[\\/]node\.exe$'})[0];if(-not$nodeCommand){$nodeCommand=$nodeCommands[0]};$node=$nodeCommand.Source;if(-not$node){Fail 'RELAY_VALIDATOR_UNAVAILABLE' 'Node is unavailable' 2};$vpsi=[Diagnostics.ProcessStartInfo]::new();$vpsi.FileName=$node;$vpsi.Arguments='"'+$validatorPath+'"';$vpsi.UseShellExecute=$false;$vpsi.CreateNoWindow=$true;$vpsi.RedirectStandardInput=$true;$vpsi.RedirectStandardOutput=$true;$vpsi.RedirectStandardError=$true;$vp=[Diagnostics.Process]::new();$vp.StartInfo=$vpsi;if(-not$vp.Start()){Fail 'RELAY_VALIDATOR_UNAVAILABLE' 'validator did not start' 2};$vp.StandardInput.Write($relayRaw);$vp.StandardInput.Close();$vo=$vp.StandardOutput.ReadToEndAsync();$ve=$vp.StandardError.ReadToEndAsync();if(-not$vp.WaitForExit(30000)){try{$vp.Kill()}catch{};Fail 'RELAY_VALIDATOR_TIMEOUT' 'validator timed out' 2};$validatorOutput=$vo.GetAwaiter().GetResult();if($vp.ExitCode-ne0){[Console]::Out.WriteLine($validatorOutput.Trim());exit $vp.ExitCode};$validated=$validatorOutput|ConvertFrom-Json}finally{Remove-Item -LiteralPath $validatorPath -Force -ErrorAction SilentlyContinue}
$policyDigest=$validated.policySha256;$packetDigest=$validated.packetSha256;$index=[int]$validated.operationIndex;$ops=@('PROVE_PREFLIGHT','CREATE_WORKSPACE','APPLY_RESERVED_PATCH','RESTORE_DOTNET','TEST_WORKFLOW_CONTRACT','TEST_DOTNET_INFORMATIONAL','BUILD_DOTNET_RELEASE','COMMIT_RESERVED_PATHS','PUSH_AUTHORIZED_BRANCH','PROVE_POST_MERGE','CLEAN_EXACT_WORKSPACE')
function CanonicalDigest([string]$json){$source='const crypto=require("node:crypto");let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=v=>v===null?"null":typeof v==="string"?JSON.stringify(v):typeof v==="number"?JSON.stringify(v):typeof v==="boolean"?String(v):Array.isArray(v)?"["+v.map(c).join(",")+"]":"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+c(v[k])).join(",")+"}";process.stdout.write(crypto.createHash("sha256").update(c(JSON.parse(s))).digest("hex"))})';$path=Join-Path ([IO.Path]::GetTempPath()) ('remote-dev-jcs-'+[Guid]::NewGuid().ToString('N')+'.cjs');[IO.File]::WriteAllText($path,$source,[Text.UTF8Encoding]::new($false));try{$pinfo=[Diagnostics.ProcessStartInfo]::new();$pinfo.FileName=$node;$pinfo.Arguments='"'+$path+'"';$pinfo.UseShellExecute=$false;$pinfo.CreateNoWindow=$true;$pinfo.RedirectStandardInput=$true;$pinfo.RedirectStandardOutput=$true;$pinfo.RedirectStandardError=$true;$cp=[Diagnostics.Process]::new();$cp.StartInfo=$pinfo;if(-not$cp.Start()){Fail 'CANONICAL_DIGEST_FAILED' 'canonical digest process did not start' 2};$cp.StandardInput.Write($json);$cp.StandardInput.Close();$co=$cp.StandardOutput.ReadToEndAsync();$ce=$cp.StandardError.ReadToEndAsync();if(-not$cp.WaitForExit(10000)){try{$cp.Kill()}catch{};Fail 'CANONICAL_DIGEST_FAILED' 'canonical digest timed out' 2};$value=$co.GetAwaiter().GetResult().Trim();if($cp.ExitCode-ne0-or$value-notmatch'^[a-f0-9]{64}$'){Fail 'CANONICAL_DIGEST_FAILED' 'canonical digest failed' 2};return $value}finally{Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue}}
$knownHost=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($relay.knownHost));$parts=$knownHost-split'\s+';if($parts.Count-ne3-or$parts[0]-ne'aegis'){Fail 'HOST_KEY_PIN_INVALID' 'known host is malformed' 64};$actualFingerprint='SHA256:'+([Convert]::ToBase64String(([Security.Cryptography.SHA256]::Create()).ComputeHash([Convert]::FromBase64String($parts[2]))).TrimEnd('='));if($actualFingerprint-ne'__AEGIS_FINGERPRINT__'){Fail 'HOST_KEY_PIN_MISMATCH' 'known host fingerprint differs from immutable approval' 64}
if((Hash $workerBytes)-ne'__WORKER_SHA__'){Fail 'WORKER_DIGEST_MISMATCH' 'worker bytes differ from immutable review' 64}
$markerRoot=Join-Path $env:ProgramData 'WilliamOS\remote-dev-offload-v1';[IO.Directory]::CreateDirectory($markerRoot)|Out-Null;$statePath=Join-Path $markerRoot ($packet.runId+'.json');$lockPath=Join-Path $markerRoot ($packet.runId+'.lock')
try{$runLock=[IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}catch [IO.IOException]{Fail 'RUN_LOCK_BUSY' 'another dispatch for this run is active' 2}
function SaveState {$tmp=$statePath+'.'+[Guid]::NewGuid().ToString('N')+'.tmp';[IO.File]::WriteAllText($tmp,($state|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false));Move-Item -LiteralPath $tmp -Destination $statePath -Force}
$state=[ordered]@{runId=$packet.runId;policySha256=$policyDigest;packetSha256=$packetDigest;lastOperationIndex=-1;lastAttempt=0;lastEvidenceSha256=$null;lastCompletedAt=$null;inFlightOperation=$null;terminalStatus='ACTIVE';terminalReason=$null;recoverableHeadSha=$null;cleanupFailures=@()}
if(Test-Path -LiteralPath $statePath){try{$existingRaw=Get-Content -LiteralPath $statePath -Raw;$existing=$existingRaw|ConvertFrom-Json}catch{Fail 'RUN_STATE_INVALID' 'run marker is malformed' 64};if($existing.runId-ne$packet.runId-or$existing.policySha256-ne$policyDigest-or$existing.packetSha256-ne$packetDigest){Fail 'RUN_BINDING_MISMATCH' 'run marker differs' 64};$lastCompletedMatch=[regex]::Match($existingRaw,'"lastCompletedAt":"([^"]+)"');$lastCompletedValue=if($lastCompletedMatch.Success){$lastCompletedMatch.Groups[1].Value}else{$null};$state=[ordered]@{runId=$existing.runId;policySha256=$existing.policySha256;packetSha256=$existing.packetSha256;lastOperationIndex=[int]$existing.lastOperationIndex;lastAttempt=[int]$existing.lastAttempt;lastEvidenceSha256=$existing.lastEvidenceSha256;lastCompletedAt=$lastCompletedValue;inFlightOperation=$existing.inFlightOperation;terminalStatus=$existing.terminalStatus;terminalReason=$existing.terminalReason;recoverableHeadSha=$existing.recoverableHeadSha;cleanupFailures=@($existing.cleanupFailures)}}
$attempt=[int]$relay.attempt;$expectedPrevious=if($relay.previous-eq'null'){$null}else{$relay.previous};$isCleanupRecovery=$false
if($state.terminalStatus-ne'ACTIVE'){
  if($state.terminalStatus-ne'RECOVERABLE_CLEAN_BLOCKED'-or$state.terminalReason-ne'CLEANUP_QUARANTINED_RECOVERABLE'){Fail 'RUN_REPLAY_OR_ORDER_INVALID' 'terminal run tombstone forbids reuse' 64}
  $failures=@($state.cleanupFailures);if($failures.Count-lt1){Fail 'RUN_STATE_INVALID' 'recoverable cleanup tombstone has no failure history' 64};$lastFailure=$failures[-1]
  $failureFields=@('attempt','branch','causeCode','headSha','operation','originalAbsent','packetSha256','policySha256','previousEvidenceSha256','quarantinePath','reasonCode','resultSha256','runId');if((@($lastFailure.PSObject.Properties.Name|Sort-Object)-join',')-ne($failureFields-join',')){Fail 'RUN_STATE_INVALID' 'recoverable cleanup tombstone fields differ' 64}
  $expectedQuarantine='/srv/william/workspaces/.williamos-quarantine-WO-TF-REMOTE-DEV-OFFLOAD-001-'+$packet.runId
  if($index -ne 10 -or $relay.operation -ne 'CLEAN_EXACT_WORKSPACE' -or $state.lastOperationIndex -ne 9 -or $attempt -ne ($state.lastAttempt+1) -or $attempt -gt [int]$packet.resourceLimits.maxAttempts -or $state.inFlightOperation -or $expectedPrevious -ne $state.lastEvidenceSha256 -or $lastFailure.attempt -ne $state.lastAttempt -or $lastFailure.runId -ne $packet.runId -or $lastFailure.operation -ne 'CLEAN_EXACT_WORKSPACE' -or $lastFailure.reasonCode -ne 'CLEANUP_QUARANTINED_RECOVERABLE' -or $lastFailure.originalAbsent -ne $true -or $lastFailure.policySha256 -ne $policyDigest -or $lastFailure.packetSha256 -ne $packetDigest -or $lastFailure.branch -ne $packet.branch -or $lastFailure.headSha -ne $state.recoverableHeadSha -or $lastFailure.previousEvidenceSha256 -ne $state.lastEvidenceSha256 -or $lastFailure.quarantinePath -ne $expectedQuarantine -or $lastFailure.resultSha256 -notmatch '^[a-f0-9]{64}$'){Fail 'RUN_REPLAY_OR_ORDER_INVALID' 'cleanup recovery binding differs' 64}
  $isCleanupRecovery=$true
}
if($state.inFlightOperation){$state.terminalStatus='BLOCKED';$state.terminalReason='RUN_INCOMPLETE_PREVIOUS_DISPATCH';SaveState;Fail 'RUN_INCOMPLETE_PREVIOUS_DISPATCH' 'a previous dispatch did not settle cleanly' 2};if(-not$isCleanupRecovery-and($index-ne($state.lastOperationIndex+1)-or$attempt-ne1)){Fail 'RUN_REPLAY_OR_ORDER_INVALID' 'operation replay or order is invalid' 64};if($expectedPrevious-ne$state.lastEvidenceSha256){Fail 'EVIDENCE_CHAIN_INVALID' 'previous evidence digest is not Task 1 canonical JCS' 64}
$knownHosts=Join-Path $markerRoot ($packet.runId+'.known_hosts');[IO.File]::WriteAllText($knownHosts,$knownHost+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
try{$ssh=@(Get-Command ssh.exe -CommandType Application -ErrorAction Stop)[0].Source}catch{Fail 'AEGIS_SSH_UNAVAILABLE' 'SSH is unavailable' 2};$psi=[Diagnostics.ProcessStartInfo]::new();$psi.FileName=$ssh;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.RedirectStandardInput=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true
$aegisSsh='-F NUL -l williamos-fabric -o IdentitiesOnly=yes -i "C:\Users\bs\.ssh\id_ed25519" -o BatchMode=yes -o ConnectTimeout=10 -o ConnectionAttempts=1 -o StrictHostKeyChecking=yes -o UserKnownHostsFile="'+$knownHosts+'" -o HostKeyAlias=aegis 192.168.88.6'
function InvokeActivation([hashtable]$request,[string]$code,[switch]$NoFail){$b64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($request|ConvertTo-Json -Compress -Depth 10)));$ap=[Diagnostics.ProcessStartInfo]::new();$ap.FileName=$ssh;$ap.UseShellExecute=$false;$ap.CreateNoWindow=$true;$ap.RedirectStandardOutput=$true;$ap.RedirectStandardError=$true;$ap.Arguments=$aegisSsh+' activation '+$b64;$p=[Diagnostics.Process]::new();$p.StartInfo=$ap;if(-not$p.Start()){if($NoFail){return $null}else{Fail $code 'activation request did not start'}};$out=$p.StandardOutput.ReadToEndAsync();$err=$p.StandardError.ReadToEndAsync();if(-not$p.WaitForExit(75000)){try{$p.Kill()}catch{};if($NoFail){return $null}else{Fail $code 'activation request timed out'}};$text=$out.GetAwaiter().GetResult();if($p.ExitCode-ne0){if($NoFail){return $null}else{Fail $code 'activation request failed'}};try{$value=$text|ConvertFrom-Json}catch{if($NoFail){return $null}else{Fail $code 'activation response is malformed'}};return @{Text=$text;Value=$value}}
function ExitTerminalOutput([string]$text){$settled=InvokeActivation ([ordered]@{action='settle'}) 'ACTIVATION_SETTLEMENT_FAILED' -NoFail;if(-not$settled-or$settled.Value.status-ne'CONSUMED_SINGLE_USE'-or$settled.Value.leaseReleased-ne$true-or$settled.Value.replayRejected-ne$true){Fail 'ACTIVATION_SETTLEMENT_FAILED' 'terminal failure settlement proof differs'};$script:activationStarted=$false;[Console]::Out.WriteLine($text);exit 2}
$started=InvokeActivation ([ordered]@{action='start'}) 'ACTIVATION_START_FAILED';if($started.Value.payload.runId-ne$packet.runId-or$started.Value.signature-notmatch'^[A-Za-z0-9+/]+={0,2}$'){Fail 'ACTIVATION_START_FAILED' 'activation session binding differs'};$script:activationStarted=$true;$state.inFlightOperation=$relay.operation;SaveState
$remotePatchArgument="'"+$relay.patch+"'"
$mintRequest=[ordered]@{action='mint';request=[ordered]@{operation=$relay.operation;attempt=$attempt;previousEvidenceSha256=if($relay.previous-eq'null'){$null}else{$relay.previous};packetSha256=$packetDigest;patchSha256=$packet.patch.sha256};packetBase64=$relay.packet;patchBase64=$relay.patch}
$mintB64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($mintRequest|ConvertTo-Json -Compress -Depth 10)))
$mintPsi=[Diagnostics.ProcessStartInfo]::new();$mintPsi.FileName=$ssh;$mintPsi.UseShellExecute=$false;$mintPsi.CreateNoWindow=$true;$mintPsi.RedirectStandardOutput=$true;$mintPsi.RedirectStandardError=$true;$mintPsi.Arguments=$aegisSsh+' activation '+$mintB64
$mintProcess=[Diagnostics.Process]::new();$mintProcess.StartInfo=$mintPsi;if(-not$mintProcess.Start()){Fail 'ACTIVATION_MINT_FAILED' 'activation mint did not start'};$mintOut=$mintProcess.StandardOutput.ReadToEndAsync();$mintErr=$mintProcess.StandardError.ReadToEndAsync();if(-not$mintProcess.WaitForExit(15000)){try{$mintProcess.Kill()}catch{};Fail 'ACTIVATION_MINT_FAILED' 'activation mint timed out'};$mintBytes=[Text.Encoding]::UTF8.GetBytes($mintOut.GetAwaiter().GetResult());if($mintProcess.ExitCode-ne0-or$mintBytes.Length-lt2-or$mintBytes.Length-gt65536){Fail 'ACTIVATION_MINT_FAILED' 'activation mint failed'};$relay.ticket=[Convert]::ToBase64String($mintBytes)
$psi.Arguments=$aegisSsh+' /usr/bin/node /usr/local/libexec/williamos-aegis-remote-dev-network-launcher.mjs '+$relay.ticket+' '+$relay.operation+' '+$relay.packet+' '+$remotePatchArgument+' '+$attempt+' '+$relay.previous
$process=[Diagnostics.Process]::new();$process.StartInfo=$psi;if(-not$process.Start()){Fail 'AEGIS_START_FAILED' 'AEGIS process did not start'};$process.StandardInput.BaseStream.Write($workerBytes,0,$workerBytes.Length);$process.StandardInput.Close();$outTask=$process.StandardOutput.ReadToEndAsync();$errTask=$process.StandardError.ReadToEndAsync();if(-not$process.WaitForExit(([int]$packet.resourceLimits.timeoutSeconds)*1000)){try{$process.Kill()}catch{};$state.terminalStatus='BLOCKED';$state.terminalReason='AEGIS_TIMEOUT';SaveState;Fail 'AEGIS_TIMEOUT' 'AEGIS worker timed out'};$stdout=$outTask.GetAwaiter().GetResult();$stderr=$errTask.GetAwaiter().GetResult()
if($process.ExitCode-ne0){
  $recoverable=$null;$workerLines=@($stdout-split"`r?`n"|Where-Object{$_.Trim()});if($process.ExitCode-eq2-and$workerLines.Count-eq1){try{$recoverable=$workerLines[0]|ConvertFrom-Json}catch{$recoverable=$null}}
  $recoverableFields=@('attempt','baseSha','branch','causeCode','detail','headSha','nodeId','operation','originalAbsent','packetSha256','patchGeneration','patchSha256','policySha256','previousEvidenceSha256','quarantinePath','reasonCode','runId','schemaVersion','status','workspace');$expectedQuarantine='/srv/william/workspaces/.williamos-quarantine-WO-TF-REMOTE-DEV-OFFLOAD-001-'+$packet.runId;$allowedCause=@('CLEANUP_DURABILITY_FAILED','CLEANUP_NESTED_MOUNT','CLEANUP_PROCESS_SCAN_FAILED','CLEANUP_WORKSPACE_IN_USE')
  $validRecoverable=$recoverable -and ((@($recoverable.PSObject.Properties.Name|Sort-Object)-join',') -eq ($recoverableFields-join',')) -and $recoverable.schemaVersion -eq 1 -and $recoverable.status -eq 'BLOCKED' -and $recoverable.reasonCode -eq 'CLEANUP_QUARANTINED_RECOVERABLE' -and $recoverable.detail -eq 'quarantined cleanup requires same-run retry' -and $recoverable.runId -eq $packet.runId -and $recoverable.operation -eq 'CLEAN_EXACT_WORKSPACE' -and $recoverable.attempt -eq $attempt -and $recoverable.nodeId -eq 'aegis' -and $recoverable.workspace -eq $packet.workspace -and $recoverable.quarantinePath -eq $expectedQuarantine -and $recoverable.originalAbsent -eq $true -and $recoverable.branch -eq $packet.branch -and $recoverable.baseSha -eq $packet.baseSha -and $recoverable.headSha -match '^[a-f0-9]{40}$' -and $recoverable.policySha256 -eq $policyDigest -and $recoverable.packetSha256 -eq $packetDigest -and $recoverable.patchSha256 -eq $packet.patch.sha256 -and $recoverable.patchGeneration -eq 1 -and $recoverable.previousEvidenceSha256 -eq $expectedPrevious -and $allowedCause -contains $recoverable.causeCode -and $relay.operation -eq 'CLEAN_EXACT_WORKSPACE' -and $index -eq 10
  if($validRecoverable){
    if($isCleanupRecovery -and $recoverable.headSha -ne $state.recoverableHeadSha){$state.inFlightOperation=$null;$state.terminalStatus='BLOCKED';$state.terminalReason='CLEANUP_RECOVERY_BINDING_MISMATCH';SaveState;Fail 'CLEANUP_RECOVERY_BINDING_MISMATCH' 'cleanup recovery HEAD differs from the immutable first failure' 2}
    $failureDigest=CanonicalDigest $workerLines[0];$failureRecord=[ordered]@{attempt=$attempt;branch=$packet.branch;causeCode=$recoverable.causeCode;headSha=$recoverable.headSha;operation='CLEAN_EXACT_WORKSPACE';originalAbsent=$true;packetSha256=$packetDigest;policySha256=$policyDigest;previousEvidenceSha256=$expectedPrevious;quarantinePath=$expectedQuarantine;reasonCode='CLEANUP_QUARANTINED_RECOVERABLE';resultSha256=$failureDigest;runId=$packet.runId};$state.lastAttempt=$attempt;$state.inFlightOperation=$null;if(-not$isCleanupRecovery){$state.recoverableHeadSha=$recoverable.headSha};$state.cleanupFailures=@($state.cleanupFailures)+@($failureRecord)
    if($attempt -ge [int]$packet.resourceLimits.maxAttempts){$state.terminalStatus='BLOCKED';$state.terminalReason='CLEANUP_RECOVERY_EXHAUSTED';SaveState;ExitTerminalOutput (@{status='BLOCKED';reasonCode='CLEANUP_RECOVERY_EXHAUSTED';detail='cleanup recovery attempt budget exhausted';runId=$packet.runId;operation='CLEAN_EXACT_WORKSPACE';attempt=$attempt;previousEvidenceSha256=$expectedPrevious;headSha=$recoverable.headSha;failureResultSha256=$failureDigest;causeCode=$recoverable.causeCode}|ConvertTo-Json -Compress)}
    $state.terminalStatus='RECOVERABLE_CLEAN_BLOCKED';$state.terminalReason='CLEANUP_QUARANTINED_RECOVERABLE';SaveState;[Console]::Out.WriteLine((@{status='BLOCKED';reasonCode='CLEANUP_QUARANTINED_RECOVERABLE';detail='quarantined cleanup requires same-run retry';runId=$packet.runId;operation='CLEAN_EXACT_WORKSPACE';attempt=$attempt;previousEvidenceSha256=$expectedPrevious;headSha=$recoverable.headSha;failureResultSha256=$failureDigest;causeCode=$recoverable.causeCode}|ConvertTo-Json -Compress));exit 2
  }
  $state.terminalStatus='BLOCKED';$state.terminalReason='AEGIS_WORKER_FAILED';SaveState;if($stdout.Trim()){ExitTerminalOutput $stdout.Trim()}else{Fail 'AEGIS_WORKER_FAILED' ('AEGIS worker exit '+$process.ExitCode)}
}
$lines=@($stdout-split"`r?`n"|Where-Object{$_.Trim()});if($lines.Count-ne1){$state.terminalStatus='BLOCKED';SaveState;Fail 'MALFORMED_WORKER_OUTPUT' 'worker must emit one JSON line'};try{$evidence=$lines[0]|ConvertFrom-Json}catch{$state.terminalStatus='BLOCKED';SaveState;Fail 'MALFORMED_WORKER_OUTPUT' 'worker JSON is malformed'}
$requiredEvidence=@('attempt','baseSha','branch','completedAt','exitCode','headSha','nodeId','operation','outputSha256','packetSha256','patchGeneration','patchSha256','policySha256','previousEvidenceSha256','runId','schemaVersion','startedAt','status','workspace');if((@($evidence.PSObject.Properties.Name|Sort-Object)-join',')-ne($requiredEvidence-join',')){$state.terminalStatus='BLOCKED';SaveState;Fail 'WORKER_EVIDENCE_MISMATCH' 'worker evidence fields differ'}
if($evidence.runId-ne$packet.runId-or$evidence.operation-ne$relay.operation-or$evidence.attempt-ne$attempt-or$evidence.policySha256-ne$policyDigest-or$evidence.packetSha256-ne$packetDigest-or$evidence.nodeId-ne'aegis'-or$evidence.workspace-ne$packet.workspace-or$evidence.branch-ne$packet.branch-or$evidence.baseSha-ne$packet.baseSha-or$evidence.patchSha256-ne$packet.patch.sha256-or$evidence.patchGeneration-ne1-or$evidence.previousEvidenceSha256-ne$expectedPrevious-or$evidence.headSha-notmatch'^[a-f0-9]{40}$'-or$evidence.outputSha256-notmatch'^[a-f0-9]{64}$'-or($isCleanupRecovery-and$evidence.headSha-ne$state.recoverableHeadSha)){$state.terminalStatus='BLOCKED';$state.terminalReason='WORKER_EVIDENCE_MISMATCH';SaveState;Fail 'WORKER_EVIDENCE_MISMATCH' 'worker evidence binding differs'}
$startedText=[regex]::Match($lines[0],'"startedAt":"([^"]+)"').Groups[1].Value;$completedText=[regex]::Match($lines[0],'"completedAt":"([^"]+)"').Groups[1].Value;$issuedText=[regex]::Match($packetText,'"issuedAt":"([^"]+)"').Groups[1].Value;$expiresText=[regex]::Match($packetText,'"expiresAt":"([^"]+)"').Groups[1].Value;if($startedText -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' -or $completedText -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'){$state.terminalStatus='BLOCKED';SaveState;Fail 'WORKER_EVIDENCE_TIME_INVALID' 'worker timestamps are malformed'};try{$started=[DateTimeOffset]::Parse($startedText);$completed=[DateTimeOffset]::Parse($completedText);$issued=[DateTimeOffset]::Parse($issuedText);$expires=[DateTimeOffset]::Parse($expiresText)}catch{$state.terminalStatus='BLOCKED';SaveState;Fail 'WORKER_EVIDENCE_TIME_INVALID' 'worker timestamps are malformed'};if($completed -le $started -or $started -lt $issued -or $completed -gt $expires -or ($completed-$started).TotalSeconds -gt [double]$packet.resourceLimits.timeoutSeconds -or ($state.lastCompletedAt -and $started -le [DateTimeOffset]::Parse([string]$state.lastCompletedAt))){$state.terminalStatus='BLOCKED';SaveState;Fail 'WORKER_EVIDENCE_TIME_INVALID' 'worker timestamps are not strictly ordered'}
$validStatus=($evidence.status-eq'SUCCEEDED'-and$evidence.exitCode-eq0)-or($relay.operation-eq'TEST_DOTNET_INFORMATIONAL'-and$evidence.status-eq'OBSERVED_FAILURE'-and$evidence.exitCode-ne0)-or($relay.operation-eq'PROVE_POST_MERGE'-and$evidence.status-eq'MERGE_ANCESTRY_PROVEN'-and$evidence.exitCode-eq0)-or($relay.operation-eq'CLEAN_EXACT_WORKSPACE'-and$evidence.status-eq'CLEANUP_ABSENCE_PROVEN'-and$evidence.exitCode-eq0);if(-not$validStatus){$state.terminalStatus='BLOCKED';SaveState;Fail 'WORKER_EVIDENCE_STATUS_INVALID' 'worker status or exit truth differs'}
$summaryLine=@($stderr-split"`r?`n"|Where-Object{$_.StartsWith("REMOTE_DEV_SUMMARY`t")});if($summaryLine.Count-ne1){$state.terminalStatus='BLOCKED';SaveState;Fail 'WORKER_SUMMARY_INVALID' 'sanitized worker summary is missing'};try{$summary=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($summaryLine[0]-split"`t",2)[1]))|ConvertFrom-Json}catch{$state.terminalStatus='BLOCKED';SaveState;Fail 'WORKER_SUMMARY_INVALID' 'sanitized worker summary is malformed'}
$evidenceDigest=CanonicalDigest $lines[0];$state.lastOperationIndex=$index;$state.lastAttempt=$attempt;$state.lastEvidenceSha256=$evidenceDigest;$state.lastCompletedAt=$completedText;$state.inFlightOperation=$null;if($evidence.status-eq'CLEANUP_ABSENCE_PROVEN'){$settled=InvokeActivation ([ordered]@{action='settle'}) 'ACTIVATION_SETTLEMENT_FAILED';if($settled.Value.status-ne'CONSUMED_SINGLE_USE'-or$settled.Value.leaseReleased-ne$true-or$settled.Value.replayRejected-ne$true){Fail 'ACTIVATION_SETTLEMENT_FAILED' 'activation settlement proof differs'};$script:activationStarted=$false;$state.terminalStatus='COMPLETE'};SaveState
$runLock.Dispose();[Console]::Out.WriteLine((@{evidence=$evidence;summary=$summary}|ConvertTo-Json -Compress -Depth 30));exit 0
'@
    $relayScript = $relayScript.Replace('__VALIDATOR_GZIP__', $validatorGzipB64).Replace('__VALIDATOR_SHA__', $validatorSha256).Replace('__AEGIS_FINGERPRINT__', $trustedAegisFingerprint).Replace('__WORKER_SHA__', $trustedWorkerSha256).Replace('ConvertFrom-Json -Depth 100','ConvertFrom-Json').Replace('ConvertFrom-Json -Depth 40','ConvertFrom-Json').Replace('ConvertFrom-Json -Depth 30','ConvertFrom-Json').Replace('ConvertFrom-Json -Depth 20','ConvertFrom-Json')
    $relayBytes = [Text.Encoding]::UTF8.GetBytes($relayScript)
    $relaySha256 = Get-Sha256Hex $relayBytes
    $relayStream = [IO.MemoryStream]::new()
    $relayGzip = [IO.Compression.GZipStream]::new($relayStream, [IO.Compression.CompressionMode]::Compress, $true)
    try { $relayGzip.Write($relayBytes, 0, $relayBytes.Length) } finally { $relayGzip.Dispose() }
    $relayGzipB64 = [Convert]::ToBase64String($relayStream.ToArray()); $relayStream.Dispose()
    $transportInput = @{ relayGzip = $relayGzipB64; relayInput = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($relayInput)); relaySha256 = $relaySha256 } | ConvertTo-Json -Compress
    $transportBytes = [Text.Encoding]::UTF8.GetBytes($transportInput)
    $transportSha256 = Get-Sha256Hex $transportBytes
    $transportId = [Guid]::NewGuid().ToString('N')
    $localTransportPath = Join-Path $runDirectory ('.hermes-relay-' + $transportId + '.json')
    $remoteTransportPath = 'C:/Users/bs/.williamos/remote-dev-relay/' + $transportId + '.json'
    $remoteRelayPath = 'C:/Users/bs/.williamos/remote-dev-relay/' + $transportId + '.ps1'
    $remoteMarkerPath = 'C:/Users/bs/.williamos/remote-dev-relay/' + $transportId + '.marker'
    $remoteCancellationPath = 'C:/Users/bs/.williamos/remote-dev-relay/' + $transportId + '.cancelled'
    $relayBootstrap = @'
$ErrorActionPreference='Stop'
$expected='__RELAY_SHA__';$expectedEnvelope='__ENVELOPE_SHA__';$envelopePath='__ENVELOPE_PATH__';$relayPath='__RELAY_PATH__';$markerPath='__MARKER_PATH__';$cancellationPath='__CANCELLATION_PATH__';$transportId='__TRANSPORT_ID__'
$mutex=$null;$lockTaken=$false;$ownsMarker=$false;$ownsRelay=$false;$p=$null
try {
  $mutex=[Threading.Mutex]::new($false,('Global\WilliamOSRemoteDevRelay-'+$transportId))
  try{$lockTaken=$mutex.WaitOne(30000)}catch [Threading.AbandonedMutexException]{$lockTaken=$true}
  if(-not$lockTaken){exit 64}
  if(Get-Item -LiteralPath $cancellationPath -Force -ErrorAction SilentlyContinue){exit 64}
  $jobNativeSource='using System;using System.Runtime.InteropServices;public static class WilliamOSRelayJobNative{public const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE=0x2000;[StructLayout(LayoutKind.Sequential)]public struct IO_COUNTERS{public ulong ReadOperationCount,WriteOperationCount,OtherOperationCount,ReadTransferCount,WriteTransferCount,OtherTransferCount;}[StructLayout(LayoutKind.Sequential)]public struct JOBOBJECT_BASIC_LIMIT_INFORMATION{public long PerProcessUserTimeLimit,PerJobUserTimeLimit;public uint LimitFlags;public UIntPtr MinimumWorkingSetSize,MaximumWorkingSetSize;public uint ActiveProcessLimit;public UIntPtr Affinity;public uint PriorityClass,SchedulingClass;}[StructLayout(LayoutKind.Sequential)]public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION{public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;public IO_COUNTERS IoInfo;public UIntPtr ProcessMemoryLimit,JobMemoryLimit,PeakProcessMemoryUsed,PeakJobMemoryUsed;}[DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)]public static extern IntPtr CreateJobObject(IntPtr a,string n);[DllImport("kernel32.dll",SetLastError=true)]public static extern bool SetInformationJobObject(IntPtr h,int c,IntPtr i,uint l);[DllImport("kernel32.dll",SetLastError=true)]public static extern bool AssignProcessToJobObject(IntPtr h,IntPtr p);}'
  if(-not('WilliamOSRelayJobNative' -as [type])){Add-Type -TypeDefinition $jobNativeSource}
  $job=[WilliamOSRelayJobNative]::CreateJobObject([IntPtr]::Zero,('Global\WilliamOSRemoteDevRelayJob-'+$transportId));if($job-eq[IntPtr]::Zero){exit 64}
  $jobInfo=New-Object WilliamOSRelayJobNative+JOBOBJECT_EXTENDED_LIMIT_INFORMATION;$jobInfo.BasicLimitInformation.LimitFlags=[WilliamOSRelayJobNative]::JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;$jobSize=[Runtime.InteropServices.Marshal]::SizeOf($jobInfo);$jobPointer=[Runtime.InteropServices.Marshal]::AllocHGlobal($jobSize)
  try{[Runtime.InteropServices.Marshal]::StructureToPtr($jobInfo,$jobPointer,$false);if(-not[WilliamOSRelayJobNative]::SetInformationJobObject($job,9,$jobPointer,[uint32]$jobSize)){exit 64}}finally{[Runtime.InteropServices.Marshal]::FreeHGlobal($jobPointer)}
  if(-not[WilliamOSRelayJobNative]::AssignProcessToJobObject($job,[Diagnostics.Process]::GetCurrentProcess().Handle)){exit 64}
  $self=[Diagnostics.Process]::GetCurrentProcess();$marker=[Text.Encoding]::UTF8.GetBytes(($transportId+':'+$PID+':'+$self.StartTime.ToUniversalTime().Ticks))
  try{$markerStream=[IO.File]::Open($markerPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)}catch [IO.IOException]{exit 64}
  $ownsMarker=$true;try{$markerStream.Write($marker,0,$marker.Length);$markerStream.Flush($true)}finally{$markerStream.Dispose()}
  if(Get-Item -LiteralPath $cancellationPath -Force -ErrorAction SilentlyContinue){exit 64}
  $item=Get-Item -LiteralPath $envelopePath -Force
  if(($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0-or$item.PSIsContainer-or$item.Length-lt2-or$item.Length-gt2097152){exit 64}
  $envelopeBytes=[IO.File]::ReadAllBytes($envelopePath);$hash=[Security.Cryptography.SHA256]::Create()
  try{$envelopeActual=([BitConverter]::ToString($hash.ComputeHash($envelopeBytes))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
  if($envelopeActual-ne$expectedEnvelope){exit 64}
  $envelope=[Text.Encoding]::UTF8.GetString($envelopeBytes)|ConvertFrom-Json
  if((@($envelope.PSObject.Properties.Name|Sort-Object)-join',')-ne'relayGzip,relayInput,relaySha256'-or$envelope.relaySha256-ne$expected){exit 64}
  $raw=[Convert]::FromBase64String($envelope.relayGzip);$source=[IO.MemoryStream]::new([byte[]]$raw);$gzip=[IO.Compression.GZipStream]::new($source,[IO.Compression.CompressionMode]::Decompress);$target=[IO.MemoryStream]::new()
  try{$gzip.CopyTo($target)}finally{$gzip.Dispose();$source.Dispose()};$bytes=$target.ToArray();$target.Dispose();$hash=[Security.Cryptography.SHA256]::Create()
  try{$actual=([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
  if($actual-ne$expected){exit 64}
  try{$relayStream=[IO.File]::Open($relayPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)}catch [IO.IOException]{exit 64}
  $ownsRelay=$true;try{$relayStream.Write($bytes,0,$bytes.Length);$relayStream.Flush($true)}finally{$relayStream.Dispose()}
  $relayItem=Get-Item -LiteralPath $relayPath -Force
  if(($relayItem.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0-or$relayItem.PSIsContainer-or$relayItem.Length-ne$bytes.Length){exit 64}
  if(Get-Item -LiteralPath $cancellationPath -Force -ErrorAction SilentlyContinue){exit 64}
  $psi=[Diagnostics.ProcessStartInfo]::new();$psi.FileName='powershell.exe';$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.RedirectStandardInput=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true;$psi.Arguments='-NoProfile -NonInteractive -File "'+$relayPath+'"'
  $p=[Diagnostics.Process]::new();$p.StartInfo=$psi;if(-not$p.Start()){exit 2}
  $mutex.ReleaseMutex();$lockTaken=$false
  $out=$p.StandardOutput.ReadToEndAsync();$err=$p.StandardError.ReadToEndAsync();$p.StandardInput.Write([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($envelope.relayInput)));$p.StandardInput.Close()
  if(-not$p.WaitForExit(5400000)){try{$p.Kill()}catch{};exit 2}
  [Console]::Out.Write($out.GetAwaiter().GetResult());[Console]::Error.Write($err.GetAwaiter().GetResult());exit $p.ExitCode
}
finally {
  if($p -and -not $p.HasExited){try{$p.Kill()}catch{}}
  if($lockTaken){try{$mutex.ReleaseMutex()}catch{}}
  if($mutex){$mutex.Dispose()}
  if($ownsRelay){Remove-Item -LiteralPath $relayPath -Force -ErrorAction SilentlyContinue}
  if($ownsMarker){Remove-Item -LiteralPath $markerPath -Force -ErrorAction SilentlyContinue}
  Remove-Item -LiteralPath $envelopePath -Force -ErrorAction SilentlyContinue
}
'@
    $relayBootstrap = $relayBootstrap.Replace('__RELAY_SHA__', $relaySha256).Replace('__ENVELOPE_SHA__', $transportSha256).Replace('__ENVELOPE_PATH__', $remoteTransportPath).Replace('__RELAY_PATH__',$remoteRelayPath).Replace('__TRANSPORT_ID__',$transportId).Replace('__MARKER_PATH__',$remoteMarkerPath).Replace('__CANCELLATION_PATH__',$remoteCancellationPath)
    $encodedRelay = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($relayBootstrap))

    try { $sshCommand = @(Get-Command ssh.exe -CommandType Application -ErrorAction Stop)[0].Source }
    catch { Write-ResultAndExit 'BLOCKED' 'SSH_UNAVAILABLE' 'Windows OpenSSH client is unavailable' 2 }
    try { $scpCommand = @(Get-Command scp.exe -CommandType Application -ErrorAction Stop)[0].Source }
    catch { Write-ResultAndExit 'BLOCKED' 'SCP_UNAVAILABLE' 'Windows OpenSSH copy client is unavailable' 2 }
    $prepareScript = '$ErrorActionPreference=''Stop'';$root=''C:\Users\bs\.williamos\remote-dev-relay'';if(Test-Path -LiteralPath $root){$i=Get-Item -LiteralPath $root -Force;if(-not$i.PSIsContainer-or($i.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){exit 64}}else{[IO.Directory]::CreateDirectory($root)|Out-Null};foreach($path in @(''' + $remoteTransportPath.Replace('/','\') + ''',''' + $remoteRelayPath.Replace('/','\') + ''',''' + $remoteMarkerPath.Replace('/','\') + ''',''' + $remoteCancellationPath.Replace('/','\') + ''')){if(Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue){exit 64}}'
    $prepareEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($prepareScript))
    $prepare = Invoke-BoundedProcess $sshCommand @('-o','BatchMode=yes','-o','ConnectTimeout=10','-o','ConnectionAttempts=1','hermes','powershell.exe','-NoProfile','-NonInteractive','-EncodedCommand',$prepareEncoded) 30
    if($prepare.TimedOut-or$prepare.ExitCode-ne0){Write-ResultAndExit 'BLOCKED' 'HERMES_TRANSPORT_PREPARE_FAILED' 'Hermes relay file scope is unavailable' 2}
    $cleanupScript = '$ErrorActionPreference=''Stop'';$transportId='''+$transportId+''';$relay='''+$remoteRelayPath.Replace('/','\')+''';$envelope='''+$remoteTransportPath.Replace('/','\')+''';$marker='''+$remoteMarkerPath.Replace('/','\')+''';$cancel='''+$remoteCancellationPath.Replace('/','\')+''';$mutex=[Threading.Mutex]::new($false,(''Global\WilliamOSRemoteDevRelay-''+$transportId));$lockTaken=$false;$cancellationCreated=$false;try{try{$lockTaken=$mutex.WaitOne(30000)}catch [Threading.AbandonedMutexException]{$lockTaken=$true};if(-not$lockTaken){exit 64};$cancelStream=$null;try{$cancelStream=[IO.File]::Open($cancel,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);$cancellationCreated=$true;$cancelStream.Flush($true)}catch [IO.IOException]{$cancelItem=Get-Item -LiteralPath $cancel -Force -ErrorAction Stop;if(($cancelItem.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0-or$cancelItem.PSIsContainer-or$cancelItem.Length-ne0){exit 64}}finally{if($cancelStream){$cancelStream.Dispose()}};$jobSource=''using System;using System.Runtime.InteropServices;public static class WilliamOSRelayJobCleanup{[DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)]public static extern IntPtr OpenJobObject(uint a,bool i,string n);[DllImport("kernel32.dll",SetLastError=true)]public static extern bool TerminateJobObject(IntPtr h,uint e);[DllImport("kernel32.dll")]public static extern bool CloseHandle(IntPtr h);}'';if(-not(''WilliamOSRelayJobCleanup''-as[type])){Add-Type -TypeDefinition $jobSource};$markerItem=Get-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue;if($markerItem){if(($markerItem.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0-or$markerItem.PSIsContainer-or$markerItem.Length-lt38-or$markerItem.Length-gt96){exit 64};$parts=([IO.File]::ReadAllText($marker)-split'':'');if($parts.Count-ne3-or$parts[0]-ne$transportId-or$parts[1]-notmatch''^[1-9][0-9]*$''-or$parts[2]-notmatch''^[1-9][0-9]*$''){exit 64};$rootPid=[int]$parts[1];$root=Get-Process -Id $rootPid -ErrorAction SilentlyContinue;if($root -and $root.StartTime.ToUniversalTime().Ticks-ne[long]$parts[2]){exit 64};$job=[WilliamOSRelayJobCleanup]::OpenJobObject(8,$false,(''Global\WilliamOSRemoteDevRelayJob-''+$transportId));if($job-eq[IntPtr]::Zero){exit 64};try{if(-not[WilliamOSRelayJobCleanup]::TerminateJobObject($job,64)){exit 64}}finally{[void][WilliamOSRelayJobCleanup]::CloseHandle($job)};Start-Sleep -Milliseconds 250;if(Get-Process -Id $rootPid -ErrorAction SilentlyContinue){exit 64}};Remove-Item -LiteralPath $relay,$envelope,$marker -Force -ErrorAction SilentlyContinue;foreach($path in @($relay,$envelope,$marker)){if(Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue){exit 64}};$cancelItem=Get-Item -LiteralPath $cancel -Force;if(($cancelItem.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0-or$cancelItem.PSIsContainer-or$cancelItem.Length-ne0){exit 64}}finally{if($lockTaken){try{$mutex.ReleaseMutex()}catch{}};$mutex.Dispose()}'
    $cleanupEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cleanupScript))
    $transportFailure=$null;$remote=$null;$cleanup=$null
    try {[IO.File]::WriteAllBytes($localTransportPath,$transportBytes);$copy=Invoke-BoundedProcess $scpCommand @('-q','-o','BatchMode=yes','-o','ConnectTimeout=10','-o','ConnectionAttempts=1',$localTransportPath,('hermes:'+$remoteTransportPath)) 60;if($copy.TimedOut-or$copy.ExitCode-ne0){$transportFailure='HERMES_TRANSPORT_COPY_FAILED'}else{$remote=Invoke-BoundedProcess $sshCommand @('-o','BatchMode=yes','-o','ConnectTimeout=10','-o','ConnectionAttempts=1','hermes','powershell.exe','-NoProfile','-NonInteractive','-EncodedCommand',$encodedRelay) $SshTimeoutSeconds}}
    catch{$transportFailure='HERMES_START_FAILED'}
    finally{Remove-Item -LiteralPath $localTransportPath -Force -ErrorAction SilentlyContinue;try{$cleanup=Invoke-BoundedProcess $sshCommand @('-o','BatchMode=yes','-o','ConnectTimeout=10','hermes','powershell.exe','-NoProfile','-NonInteractive','-EncodedCommand',$cleanupEncoded) 30}catch{$cleanup=$null}}
    if($null-eq$cleanup-or$cleanup.TimedOut-or$cleanup.ExitCode-ne0){Write-ResultAndExit 'BLOCKED' 'HERMES_TRANSPORT_CLEANUP_UNPROVEN' 'Hermes relay process or file absence is unproven' 2}
    if($transportFailure){Write-ResultAndExit 'BLOCKED' $transportFailure 'Hermes relay transport failed' 2}
    if ($remote.TimedOut) { Write-ResultAndExit 'BLOCKED' 'HERMES_TIMEOUT' 'Hermes relay timed out' 2 }
    if ($remote.ExitCode -ne 0) {
        $failureLines = @($remote.Stdout -split "`r?`n" | Where-Object { $_.Trim().Length -gt 0 }); $cleanupFailure = $null
        if ($remote.ExitCode -eq 2 -and $failureLines.Count -eq 1) { try { $cleanupFailure = $failureLines[0] | ConvertFrom-Json } catch { $cleanupFailure = $null } }
        $cleanupFailureFields = @('attempt','causeCode','detail','failureResultSha256','headSha','operation','previousEvidenceSha256','reasonCode','runId','status')
        $expectedPrevious = if ($PreviousEvidenceSha256 -eq 'null') { $null } else { $PreviousEvidenceSha256 }
        $failureDispositionValid = $false
        if ($cleanupFailure) { $failureDispositionValid = ($cleanupFailure.reasonCode -eq 'CLEANUP_QUARANTINED_RECOVERABLE' -and $cleanupFailure.detail -eq 'quarantined cleanup requires same-run retry' -and $Attempt -lt [int]$packet.resourceLimits.maxAttempts) -or ($cleanupFailure.reasonCode -eq 'CLEANUP_RECOVERY_EXHAUSTED' -and $cleanupFailure.detail -eq 'cleanup recovery attempt budget exhausted' -and $Attempt -eq [int]$packet.resourceLimits.maxAttempts) }
        $validCleanupFailure = $cleanupFailure -and ((@($cleanupFailure.PSObject.Properties.Name | Sort-Object) -join ',') -eq ($cleanupFailureFields -join ',')) -and $cleanupFailure.status -eq 'BLOCKED' -and $failureDispositionValid -and $cleanupFailure.runId -eq $packet.runId -and $cleanupFailure.operation -eq 'CLEAN_EXACT_WORKSPACE' -and $cleanupFailure.attempt -eq $Attempt -and $cleanupFailure.previousEvidenceSha256 -eq $expectedPrevious -and $cleanupFailure.headSha -match '^[a-f0-9]{40}$' -and $cleanupFailure.failureResultSha256 -match '^[a-f0-9]{64}$' -and @('CLEANUP_DURABILITY_FAILED','CLEANUP_NESTED_MOUNT','CLEANUP_PROCESS_SCAN_FAILED','CLEANUP_WORKSPACE_IN_USE') -contains $cleanupFailure.causeCode
        if ($validCleanupFailure) {
            $failureSuffix = if ($cleanupFailure.reasonCode -eq 'CLEANUP_RECOVERY_EXHAUSTED') { 'exhausted' } else { 'recoverable-failure' }; $failureFile = Join-Path $runDirectory ('10-clean_exact_workspace-{0}-{1}.json' -f $Attempt,$failureSuffix); $temporaryFailure = $failureFile + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
            if (Test-Path -LiteralPath $failureFile) { Write-ResultAndExit 'BLOCKED' 'EVIDENCE_WRITE_FAILED' 'recoverable failure receipt already exists' 2 }
            try { [IO.File]::WriteAllText($temporaryFailure, (($cleanupFailure | ConvertTo-Json -Compress -Depth 40) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false)); Move-Item -LiteralPath $temporaryFailure -Destination $failureFile }
            catch { Write-ResultAndExit 'BLOCKED' 'EVIDENCE_WRITE_FAILED' 'recoverable cleanup failure receipt could not be published' 2 }
            [Console]::Out.WriteLine(($cleanupFailure | ConvertTo-Json -Compress -Depth 40)); exit 2
        }
        Write-ResultAndExit 'BLOCKED' 'HERMES_OR_AEGIS_FAILED' ($remote.Stdout + $remote.Stderr) 2
    }
    $lines = @($remote.Stdout -split "`r?`n" | Where-Object { $_.Trim().Length -gt 0 })
    if ($lines.Count -ne 1) { Write-ResultAndExit 'BLOCKED' 'MALFORMED_WORKER_OUTPUT' 'relay must return exactly one JSON line' 2 }
    try { $relayResult = $lines[0] | ConvertFrom-Json }
    catch { Write-ResultAndExit 'BLOCKED' 'MALFORMED_WORKER_OUTPUT' 'relay output is not JSON' 2 }
    if ($relayResult.status -eq 'BLOCKED') { Write-ResultAndExit 'BLOCKED' ([string]$relayResult.reasonCode) ([string]$relayResult.detail) 2 }
    if ($relayResult.PSObject.Properties.Name -contains 'evidence') { $evidence = $relayResult.evidence; $operationSummary = $relayResult.summary }
    else { $evidence = $relayResult; $operationSummary = @{ schemaVersion = 1; operation = $Operation; startedAt = $evidence.startedAt; completedAt = $evidence.completedAt; status = $evidence.status; exitCode = $evidence.exitCode; resourceObservations = @{ cpuThreads = $packet.resourceLimits.cpuThreads; memoryBytes = $packet.resourceLimits.memoryBytes; scratchBeforeBytes = $null; scratchAfterBytes = $null }; testCounts = $null } }
    if ($null -eq $evidence.schemaVersion) { Write-ResultAndExit 'BLOCKED' 'MALFORMED_WORKER_OUTPUT' 'relay evidence is absent' 2 }
    $evidenceJson = $evidence | ConvertTo-Json -Compress -Depth 100

    $historyFiles = @(Get-ChildItem -LiteralPath $runDirectory -File -Filter '*.json' | Where-Object { $_.Name -match '^\d{2}-[a-z0-9_-]+-\d+\.json$' } | Sort-Object Name)
    $history = @($historyFiles | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json })
    $evidenceB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($evidenceJson))
    $historyJson = ConvertTo-Json -InputObject @($history) -Compress -Depth 100
    $historyB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($historyJson))
    $transitionScript = @'
import fs from "node:fs";import {pathToFileURL} from "node:url";
const [contractPath,packetPath,envelopePath,evidenceB64,historyB64]=process.argv.slice(2);const c=await import(pathToFileURL(contractPath));const packet=JSON.parse(fs.readFileSync(packetPath,"utf8"));const dispatchEnvelope=JSON.parse(fs.readFileSync(envelopePath,"utf8"));const evidence=JSON.parse(Buffer.from(evidenceB64,"base64").toString("utf8"));const evidenceHistory=JSON.parse(Buffer.from(historyB64,"base64").toString("utf8"));const result=c.evaluateRemoteDevTransition(packet,evidence,{now:new Date().toISOString(),seenRunIds:[],branch:packet.branch,dispatchEnvelope,evidenceHistory});process.stdout.write(JSON.stringify(result));if(result.status==="BLOCKED")process.exit(2);
'@
    $transition = Invoke-BoundedProcess $node @('--input-type=module', '-e', $transitionScript, $policyFull, $contractPath, $packetFull, $envelopeFull, $evidenceB64, $historyB64) 30
    if ($transition.TimedOut -or $transition.ExitCode -ne 0) { Write-ResultAndExit 'BLOCKED' 'EVIDENCE_VALIDATION_FAILED' ($transition.Stdout + $transition.Stderr) 2 }
    try { $transitionResult = $transition.Stdout | ConvertFrom-Json }
    catch { Write-ResultAndExit 'BLOCKED' 'EVIDENCE_VALIDATION_MALFORMED' 'transition validator did not return JSON' 2 }
    if ($transitionResult.status -ne 'RUNNING' -and $transitionResult.status -ne 'COMPLETE') { Write-ResultAndExit 'BLOCKED' 'EVIDENCE_VALIDATION_FAILED' 'transition is not valid' 2 }

    $index = [Array]::IndexOf([object[]]$packet.operations, $Operation)
    $evidenceFile = Join-Path $runDirectory ('{0:D2}-{1}-{2}.json' -f $index, $Operation.ToLowerInvariant(), $Attempt)
    $temporaryEvidence = $evidenceFile + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    $summaryFile = Join-Path $runDirectory ('{0:D2}-{1}-{2}-operation-summary.json' -f $index, $Operation.ToLowerInvariant(), $Attempt)
    try {
        [IO.File]::WriteAllText($temporaryEvidence, $evidenceJson + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $temporaryEvidence -Destination $evidenceFile
        $summaryJson = $operationSummary | Select-Object schemaVersion, operation, startedAt, completedAt, status, exitCode, resourceObservations, testCounts | ConvertTo-Json -Compress -Depth 20
        [IO.File]::WriteAllText($summaryFile, $summaryJson + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
    }
    catch { Write-ResultAndExit 'BLOCKED' 'EVIDENCE_WRITE_FAILED' 'sanitized evidence could not be published' 2 }
    [Console]::Out.WriteLine($evidenceJson)
    if ($transitionResult.status -eq 'COMPLETE') { exit 0 }
    exit 2
}
catch {
    Write-ResultAndExit 'INVALID_INPUT' 'CONTROLLER_INPUT_INVALID' $_.Exception.Message 64
}
