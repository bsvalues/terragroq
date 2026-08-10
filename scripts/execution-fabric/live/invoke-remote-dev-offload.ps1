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
    [Parameter(Mandatory = $true)][string]$AegisKnownHostLine,
    [Parameter(Mandatory = $true)][string]$AegisHostKeyFingerprint,
    [int]$SshTimeoutSeconds = 5400
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

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

function Invoke-BoundedProcess {
    param([string]$FileName, [string[]]$Arguments, [int]$TimeoutSeconds, [string]$StandardInput = $null)
    $psi = [Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $FileName
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.RedirectStandardInput = $null -ne $StandardInput
    foreach ($argument in $Arguments) { [void]$psi.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::new(); $process.StartInfo = $psi
    if (-not $process.Start()) { throw 'process did not start' }
    if ($null -ne $StandardInput) { $process.StandardInput.Write($StandardInput); $process.StandardInput.Close() }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync(); $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        try { $process.Kill($true) } catch { try { $process.Kill() } catch {} }
        [void]$process.WaitForExit(5000)
        return @{ TimedOut = $true; ExitCode = 2; Stdout = ''; Stderr = 'bounded process timeout' }
    }
    return @{ TimedOut = $false; ExitCode = $process.ExitCode; Stdout = $stdoutTask.GetAwaiter().GetResult(); Stderr = $stderrTask.GetAwaiter().GetResult() }
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
    $workerPath = Join-Path $scriptRoot 'aegis-remote-dev-worker.sh'
    if (-not (Test-Path -LiteralPath $contractPath -PathType Leaf) -or -not (Test-Path -LiteralPath $workerPath -PathType Leaf)) { Write-ResultAndExit 'INVALID_INPUT' 'IMPLEMENTATION_MISSING' 'contract or fixed worker is unavailable' 64 }

    $node = (Get-Command node -CommandType Application -ErrorAction Stop).Source
    $validateScript = @'
import fs from "node:fs";
import { pathToFileURL } from "node:url";
const [contractPath,policyPath,packetPath,envelopePath]=process.argv.slice(2);
const contract=await import(pathToFileURL(contractPath));
const policy=JSON.parse(fs.readFileSync(policyPath,"utf8"));
const packet=JSON.parse(fs.readFileSync(packetPath,"utf8"));
const dispatchEnvelope=JSON.parse(fs.readFileSync(envelopePath,"utf8"));
const result=contract.bindRemoteDevPacket(packet,policy,{now:new Date().toISOString(),seenRunIds:[],branch:packet.branch,dispatchEnvelope});
if(result.status!=="READY"||JSON.stringify(result.packet)!==JSON.stringify(packet)){process.stdout.write(JSON.stringify({status:"BLOCKED",reasonCode:"PACKET_NOT_PREBOUND",detail:JSON.stringify(result.reasons||[])}));process.exit(64)}
process.stdout.write(JSON.stringify({status:"READY",packet:result.packet,policySha256:result.policySha256}));
'@
    $validation = Invoke-BoundedProcess $node @('--input-type=module', '-e', $validateScript, $policyFull, $contractPath, $policyFull, $packetFull, $envelopeFull) 30
    if ($validation.TimedOut -or $validation.ExitCode -ne 0) { Write-ResultAndExit 'INVALID_INPUT' 'PACKET_VALIDATION_FAILED' ($validation.Stdout + $validation.Stderr) 64 }
    try { $validated = $validation.Stdout | ConvertFrom-Json -Depth 100 }
    catch { Write-ResultAndExit 'INVALID_INPUT' 'PACKET_VALIDATION_MALFORMED' 'local contract validation did not return JSON' 64 }
    if ($validated.status -ne 'READY' -or $validated.packet.bindings.policySha256 -ne $validated.policySha256) { Write-ResultAndExit 'INVALID_INPUT' 'PACKET_VALIDATION_FAILED' 'packet is not Task 1 READY evidence' 64 }
    $packet = $validated.packet
    if ($packet.operations -notcontains $Operation) { Write-ResultAndExit 'INVALID_INPUT' 'OPERATION_NOT_ALLOWED' 'operation is outside packet allowlist' 64 }
    if ($PreviousEvidenceSha256 -ne 'null' -and $PreviousEvidenceSha256 -notmatch '^[a-f0-9]{64}$') { Write-ResultAndExit 'INVALID_INPUT' 'EVIDENCE_CHAIN_INVALID' 'previous evidence digest is invalid' 64 }
    $patchBytes = [IO.File]::ReadAllBytes($patchFull)
    if ((Get-Sha256Hex $patchBytes) -ne $packet.patch.sha256) { Write-ResultAndExit 'INVALID_INPUT' 'PATCH_BINDING_MISMATCH' 'patch digest differs from packet' 64 }

    $knownHostMatch = [regex]::Match($AegisKnownHostLine, '^aegis\s+(ssh-(?:ed25519|rsa)|ecdsa-sha2-nistp(?:256|384|521))\s+([A-Za-z0-9+/]+={0,2})$')
    if (-not $knownHostMatch.Success -or $AegisHostKeyFingerprint -notmatch '^SHA256:[A-Za-z0-9+/]{20,}={0,2}$') { Write-ResultAndExit 'INVALID_INPUT' 'HOST_KEY_PIN_INVALID' 'AEGIS known-host binding is malformed' 64 }
    try { $keyBytes = [Convert]::FromBase64String($knownHostMatch.Groups[2].Value) }
    catch { Write-ResultAndExit 'INVALID_INPUT' 'HOST_KEY_PIN_INVALID' 'AEGIS key bytes are malformed' 64 }
    $fingerprint = 'SHA256:' + [Convert]::ToBase64String(([Security.Cryptography.SHA256]::Create()).ComputeHash($keyBytes)).TrimEnd('=')
    if ($fingerprint -ne $AegisHostKeyFingerprint.TrimEnd('=')) { Write-ResultAndExit 'INVALID_INPUT' 'HOST_KEY_PIN_MISMATCH' 'AEGIS host-key fingerprint differs' 64 }

    $runDirectory = Join-Path ([IO.Path]::GetFullPath($EvidenceRoot)) $packet.runId
    [IO.Directory]::CreateDirectory($runDirectory) | Out-Null
    $runItem = Get-Item -LiteralPath $runDirectory -Force
    if (($runItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Write-ResultAndExit 'INVALID_INPUT' 'EVIDENCE_PATH_REPARSE_POINT' 'evidence directory must not be a reparse point' 64 }

    $policyB64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($policyFull))
    $packetB64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($packetFull))
    $patchB64 = [Convert]::ToBase64String($patchBytes)
    $workerB64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($workerPath))
    $knownHostB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($AegisKnownHostLine))
    $relayValues = @{ policy = $policyB64; packet = $packetB64; patch = $patchB64; worker = $workerB64; knownHost = $knownHostB64; fingerprint = $AegisHostKeyFingerprint; operation = $Operation; attempt = $Attempt; previous = $PreviousEvidenceSha256 }
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
const policyDigest=hash(Buffer.from(jcs(policy),"utf8"));if(policyDigest!=="8e4d17071567ed1f43c01a02251a689d1879cfadcf90af92260267ebd668fd2c")fail("POLICY_DIGEST_MISMATCH","canonical policy differs");
exact(packet,["schemaVersion","runId","workOrderId","repository","baseRef","baseSha","branch","nodeId","workspace","transport","resourceLimits","operations","patch","authority","bindings"],"PACKET_FIELDS_INVALID");
if(packet.schemaVersion!==1||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(packet.runId)||packet.workOrderId!=="WO-TF-REMOTE-DEV-OFFLOAD-001"||packet.repository!=="bsvalues/terrafusion_os_1.0"||packet.baseRef!=="refs/heads/main"||!/^[a-f0-9]{40}$/.test(packet.baseSha)||!/^codex\/wo-tf-remote-dev-offload-001-[a-z0-9-]+$/.test(packet.branch)||packet.nodeId!=="aegis"||packet.workspace!=="/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001")fail("IDENTITY_MISMATCH","immutable packet identity differs");
exact(packet.transport,["controller","relay","worker"],"TRANSPORT_FIELDS_INVALID");if(jcs(packet.transport)!==jcs({controller:"omen",relay:"hermes",worker:"aegis"}))fail("TRANSPORT_MISMATCH","Hermes mediation is mandatory");
exact(packet.resourceLimits,["cpuThreads","memoryBytes","scratchBytes","timeoutSeconds","maxAttempts"],"RESOURCE_FIELDS_INVALID");if(jcs(packet.resourceLimits)!==jcs(limits))fail("RESOURCE_LIMIT_EXCEEDED","resource envelope differs");
if(jcs(packet.operations)!==jcs(operations)||!operations.includes(relay.operation))fail("OPERATION_SET_MISMATCH","operation set differs");
exact(packet.patch,["sha256","generation","changedPaths"],"PATCH_FIELDS_INVALID");if(packet.patch.generation!==1||jcs(packet.patch.changedPaths)!==jcs(paths))fail("PATCH_PATHS_MISMATCH","reserved patch paths differ");if(hash(patch)!==packet.patch.sha256)fail("PATCH_DIGEST_MISMATCH","patch bytes differ");
exact(packet.authority,["grantId","issuedAt","expiresAt","singleUse"],"AUTHORITY_FIELDS_INVALID");const issued=Date.parse(packet.authority.issuedAt),expires=Date.parse(packet.authority.expiresAt),now=Date.now();if(packet.authority.grantId!=="grant-remote-dev-offload-v1"||packet.authority.singleUse!==true||!Number.isFinite(issued)||!Number.isFinite(expires)||issued>=now||expires<=now||expires-issued>14400000)fail("AUTHORITY_INVALID","grant is invalid or expired");
exact(packet.bindings,["policySha256","packetSha256"],"BINDING_FIELDS_INVALID");if(packet.bindings.policySha256!==policyDigest)fail("POLICY_DIGEST_MISMATCH","packet policy binding differs");const unsigned=structuredClone(packet);delete unsigned.bindings;const packetDigest=hash(Buffer.from(jcs(unsigned),"utf8"));if(packet.bindings.packetSha256!==packetDigest)fail("PACKET_DIGEST_MISMATCH","packet digest differs");
if(!Number.isSafeInteger(relay.attempt)||relay.attempt<1||relay.attempt>3)fail("ATTEMPT_INVALID","attempt differs");if(relay.previous!=="null"&&!/^[a-f0-9]{64}$/.test(relay.previous))fail("EVIDENCE_CHAIN_INVALID","previous evidence digest differs");
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
function Fail([string]$code,[string]$detail,[int]$exitCode=2){[Console]::Out.WriteLine((@{status='BLOCKED';reasonCode=$code;detail=$detail}|ConvertTo-Json -Compress));exit $exitCode}
function Hash([byte[]]$bytes){$h=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($h.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
$relayRaw=[Console]::In.ReadToEnd();$relay=$relayRaw|ConvertFrom-Json -Depth 100
$policyBytes=[Convert]::FromBase64String($relay.policy);$packetBytes=[Convert]::FromBase64String($relay.packet);$patchBytes=[Convert]::FromBase64String($relay.patch);$workerBytes=[Convert]::FromBase64String($relay.worker)
$policy=[Text.Encoding]::UTF8.GetString($policyBytes)|ConvertFrom-Json -Depth 100;$packet=[Text.Encoding]::UTF8.GetString($packetBytes)|ConvertFrom-Json -Depth 100
$validatorCompressed=[Convert]::FromBase64String('__VALIDATOR_GZIP__');$sourceStream=[IO.MemoryStream]::new([byte[]]$validatorCompressed);$validatorGzip=[IO.Compression.GZipStream]::new($sourceStream,[IO.Compression.CompressionMode]::Decompress);$targetStream=[IO.MemoryStream]::new();try{$validatorGzip.CopyTo($targetStream)}finally{$validatorGzip.Dispose();$sourceStream.Dispose()};$validatorBytes=$targetStream.ToArray();$targetStream.Dispose();if((Hash $validatorBytes)-ne'__VALIDATOR_SHA__'){Fail 'RELAY_VALIDATOR_MISMATCH' 'validator digest differs' 64}
$validatorPath=Join-Path ([IO.Path]::GetTempPath()) ('remote-dev-relay-'+[Guid]::NewGuid().ToString('N')+'.cjs');[IO.File]::WriteAllBytes($validatorPath,$validatorBytes)
try{$node=@(Get-Command node.exe,node -CommandType Application -ErrorAction SilentlyContinue)[0].Source;if(-not$node){Fail 'RELAY_VALIDATOR_UNAVAILABLE' 'Node is unavailable' 2};$vpsi=[Diagnostics.ProcessStartInfo]::new();$vpsi.FileName=$node;$vpsi.Arguments='"'+$validatorPath+'"';$vpsi.UseShellExecute=$false;$vpsi.CreateNoWindow=$true;$vpsi.RedirectStandardInput=$true;$vpsi.RedirectStandardOutput=$true;$vpsi.RedirectStandardError=$true;$vp=[Diagnostics.Process]::new();$vp.StartInfo=$vpsi;if(-not$vp.Start()){Fail 'RELAY_VALIDATOR_UNAVAILABLE' 'validator did not start' 2};$vp.StandardInput.Write($relayRaw);$vp.StandardInput.Close();$vo=$vp.StandardOutput.ReadToEndAsync();$ve=$vp.StandardError.ReadToEndAsync();if(-not$vp.WaitForExit(30000)){try{$vp.Kill()}catch{};Fail 'RELAY_VALIDATOR_TIMEOUT' 'validator timed out' 2};$validatorOutput=$vo.GetAwaiter().GetResult();if($vp.ExitCode-ne0){[Console]::Out.WriteLine($validatorOutput.Trim());exit $vp.ExitCode};$validated=$validatorOutput|ConvertFrom-Json -Depth 20}finally{Remove-Item -LiteralPath $validatorPath -Force -ErrorAction SilentlyContinue}
$policyDigest=$validated.policySha256;$packetDigest=$validated.packetSha256;$index=[int]$validated.operationIndex;$ops=@('PROVE_PREFLIGHT','CREATE_WORKSPACE','APPLY_RESERVED_PATCH','RESTORE_DOTNET','TEST_WORKFLOW_CONTRACT','TEST_DOTNET_INFORMATIONAL','BUILD_DOTNET_RELEASE','COMMIT_RESERVED_PATHS','PUSH_AUTHORIZED_BRANCH','PROVE_POST_MERGE','CLEAN_EXACT_WORKSPACE')
$knownHost=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($relay.knownHost));$parts=$knownHost-split'\s+';if($parts.Count-ne3-or$parts[0]-ne'aegis'){Fail 'HOST_KEY_PIN_INVALID' 'known host is malformed' 64};$actualFingerprint='SHA256:'+([Convert]::ToBase64String(([Security.Cryptography.SHA256]::Create()).ComputeHash([Convert]::FromBase64String($parts[2]))).TrimEnd('='));if($actualFingerprint-ne([string]$relay.fingerprint).TrimEnd('=')){Fail 'HOST_KEY_PIN_MISMATCH' 'known host fingerprint differs' 64}
$markerRoot=Join-Path $env:ProgramData 'WilliamOS\remote-dev-offload-v1';[IO.Directory]::CreateDirectory($markerRoot)|Out-Null;$statePath=Join-Path $markerRoot ($packet.runId+'.json')
$state=[ordered]@{runId=$packet.runId;policySha256=$policyDigest;packetSha256=$packetDigest;lastOperationIndex=-1;lastAttempt=0}
try{$stream=[IO.File]::Open($statePath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);try{$bytes=[Text.Encoding]::UTF8.GetBytes(($state|ConvertTo-Json -Compress));$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}}catch [IO.IOException]{$existing=Get-Content -LiteralPath $statePath -Raw|ConvertFrom-Json;if($existing.runId-ne$packet.runId-or$existing.policySha256-ne$policyDigest-or$existing.packetSha256-ne$packetDigest){Fail 'RUN_BINDING_MISMATCH' 'run marker differs' 64};$state=[ordered]@{runId=$existing.runId;policySha256=$existing.policySha256;packetSha256=$existing.packetSha256;lastOperationIndex=[int]$existing.lastOperationIndex;lastAttempt=[int]$existing.lastAttempt}}
$attempt=[int]$relay.attempt;if(($index-eq$state.lastOperationIndex-and$attempt-ne($state.lastAttempt+1))-or($index-eq($state.lastOperationIndex+1)-and$attempt-ne1)-or($index-lt$state.lastOperationIndex)-or($index-gt($state.lastOperationIndex+1))){Fail 'RUN_REPLAY_OR_ORDER_INVALID' 'operation replay or order is invalid' 64}
$state.lastOperationIndex=$index;$state.lastAttempt=$attempt;$stateTmp=$statePath+'.'+[Guid]::NewGuid().ToString('N')+'.tmp';[IO.File]::WriteAllText($stateTmp,($state|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false));Move-Item -LiteralPath $stateTmp -Destination $statePath -Force
$knownHosts=Join-Path $markerRoot ($packet.runId+'.known_hosts');[IO.File]::WriteAllText($knownHosts,$knownHost+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
$ssh=@(Get-Command ssh.exe -CommandType Application -ErrorAction Stop)[0].Source;$psi=[Diagnostics.ProcessStartInfo]::new();$psi.FileName=$ssh;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.RedirectStandardInput=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true
$psi.Arguments='-o BatchMode=yes -o ConnectTimeout=10 -o ConnectionAttempts=1 -o StrictHostKeyChecking=yes -o UserKnownHostsFile="'+$knownHosts+'" aegis bash -s -- '+$relay.operation+' '+$relay.packet+' '+$relay.patch+' '+$attempt+' '+$relay.previous
$process=[Diagnostics.Process]::new();$process.StartInfo=$psi;if(-not$process.Start()){Fail 'AEGIS_START_FAILED' 'AEGIS process did not start'};$process.StandardInput.BaseStream.Write($workerBytes,0,$workerBytes.Length);$process.StandardInput.Close();$outTask=$process.StandardOutput.ReadToEndAsync();$errTask=$process.StandardError.ReadToEndAsync();if(-not$process.WaitForExit(([int]$packet.resourceLimits.timeoutSeconds)*1000)){try{$process.Kill()}catch{};Fail 'AEGIS_TIMEOUT' 'AEGIS worker timed out'};$stdout=$outTask.GetAwaiter().GetResult();$stderr=$errTask.GetAwaiter().GetResult()
if($process.ExitCode-ne0){if($stdout.Trim()){[Console]::Out.WriteLine($stdout.Trim())}else{Fail 'AEGIS_WORKER_FAILED' ('AEGIS worker exit '+$process.ExitCode)}}
$lines=@($stdout-split"`r?`n"|Where-Object{$_.Trim()});if($lines.Count-ne1){Fail 'MALFORMED_WORKER_OUTPUT' 'worker must emit one JSON line'};try{$evidence=$lines[0]|ConvertFrom-Json -Depth 100}catch{Fail 'MALFORMED_WORKER_OUTPUT' 'worker JSON is malformed'}
if($evidence.runId-ne$packet.runId-or$evidence.operation-ne$relay.operation-or$evidence.attempt-ne$attempt-or$evidence.policySha256-ne$policyDigest-or$evidence.packetSha256-ne$packetDigest){Fail 'WORKER_EVIDENCE_MISMATCH' 'worker evidence binding differs'}
if($evidence.status-eq'CLEANUP_ABSENCE_PROVEN'){Remove-Item -LiteralPath $statePath -Force};[Console]::Out.WriteLine($lines[0]);exit 0
'@
    $relayScript = $relayScript.Replace('__VALIDATOR_GZIP__', $validatorGzipB64).Replace('__VALIDATOR_SHA__', $validatorSha256)
    $encodedRelay = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($relayScript))

    $sshCommand = @(Get-Command ssh.exe -CommandType Application -ErrorAction Stop)[0].Source
    $remote = Invoke-BoundedProcess $sshCommand @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ConnectionAttempts=1', 'hermes', 'powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', $encodedRelay) $SshTimeoutSeconds $relayInput
    if ($remote.TimedOut) { Write-ResultAndExit 'BLOCKED' 'HERMES_TIMEOUT' 'Hermes relay timed out' 2 }
    if ($remote.ExitCode -ne 0) { Write-ResultAndExit 'BLOCKED' 'HERMES_OR_AEGIS_FAILED' ($remote.Stdout + $remote.Stderr) 2 }
    $lines = @($remote.Stdout -split "`r?`n" | Where-Object { $_.Trim().Length -gt 0 })
    if ($lines.Count -ne 1) { Write-ResultAndExit 'BLOCKED' 'MALFORMED_WORKER_OUTPUT' 'relay must return exactly one JSON line' 2 }
    try { $evidence = $lines[0] | ConvertFrom-Json -Depth 100 }
    catch { Write-ResultAndExit 'BLOCKED' 'MALFORMED_WORKER_OUTPUT' 'relay output is not JSON' 2 }
    if ($evidence.status -eq 'BLOCKED' -or $null -eq $evidence.schemaVersion) { Write-ResultAndExit 'BLOCKED' ([string]$evidence.reasonCode) ([string]$evidence.detail) 2 }

    $historyFiles = @(Get-ChildItem -LiteralPath $runDirectory -File -Filter '*.json' | Sort-Object Name)
    $history = @($historyFiles | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json -Depth 100 })
    $evidenceB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($lines[0]))
    $historyJson = if ($history.Count -eq 0) { '[]' } else { $history | ConvertTo-Json -Compress -Depth 100 }
    $historyB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($historyJson))
    $transitionScript = @'
import fs from "node:fs";import {pathToFileURL} from "node:url";
const [contractPath,packetPath,envelopePath,evidenceB64,historyB64]=process.argv.slice(2);const c=await import(pathToFileURL(contractPath));const packet=JSON.parse(fs.readFileSync(packetPath,"utf8"));const dispatchEnvelope=JSON.parse(fs.readFileSync(envelopePath,"utf8"));const evidence=JSON.parse(Buffer.from(evidenceB64,"base64").toString("utf8"));const evidenceHistory=JSON.parse(Buffer.from(historyB64,"base64").toString("utf8"));const result=c.evaluateRemoteDevTransition(packet,evidence,{now:new Date().toISOString(),seenRunIds:[],branch:packet.branch,dispatchEnvelope,evidenceHistory});process.stdout.write(JSON.stringify(result));if(result.status==="BLOCKED")process.exit(2);
'@
    $transition = Invoke-BoundedProcess $node @('--input-type=module', '-e', $transitionScript, $policyFull, $contractPath, $packetFull, $envelopeFull, $evidenceB64, $historyB64) 30
    if ($transition.TimedOut -or $transition.ExitCode -ne 0) { Write-ResultAndExit 'BLOCKED' 'EVIDENCE_VALIDATION_FAILED' ($transition.Stdout + $transition.Stderr) 2 }
    try { $transitionResult = $transition.Stdout | ConvertFrom-Json -Depth 100 }
    catch { Write-ResultAndExit 'BLOCKED' 'EVIDENCE_VALIDATION_MALFORMED' 'transition validator did not return JSON' 2 }
    if ($transitionResult.status -ne 'RUNNING' -and $transitionResult.status -ne 'COMPLETE') { Write-ResultAndExit 'BLOCKED' 'EVIDENCE_VALIDATION_FAILED' 'transition is not valid' 2 }

    $index = [Array]::IndexOf([object[]]$packet.operations, $Operation)
    $evidenceFile = Join-Path $runDirectory ('{0:D2}-{1}-{2}.json' -f $index, $Operation.ToLowerInvariant(), $Attempt)
    $temporaryEvidence = $evidenceFile + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    [IO.File]::WriteAllText($temporaryEvidence, $lines[0] + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporaryEvidence -Destination $evidenceFile
    [Console]::Out.WriteLine($lines[0])
    exit 0
}
catch {
    Write-ResultAndExit 'INVALID_INPUT' 'CONTROLLER_INPUT_INVALID' $_.Exception.Message 64
}
