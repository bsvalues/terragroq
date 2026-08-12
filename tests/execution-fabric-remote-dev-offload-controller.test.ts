import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import zlib from "node:zlib"
import { execFileSync, spawn, spawnSync } from "node:child_process"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { bindRemoteDevPacket, evaluateRemoteDevTransition } from "../scripts/execution-fabric/live/remote-dev-offload-contract.mjs"
import { canonicalizeJcs } from "../scripts/execution-fabric/canonical-json.mjs"

const root = process.cwd()
const controller = path.join(root, "scripts/execution-fabric/live/invoke-remote-dev-offload.ps1")
const policyPath = path.join(root, "config/execution-fabric/remote-dev-offload-v1.policy.json")
const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"))
const pwsh = "pwsh.exe"
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "remote-dev-controller-"))
const fakeBin = path.join(testRoot, "bin")
const fakeLog = path.join(testRoot, "ssh.log")
const evidenceRoots: string[] = []
const reservedPaths = [".github/workflows/dotnet-test.yml", ".github/workflows/terrafusion-ci.yml", "tests/ci-terrafusion-unit-informational.test.ts", "docs/brain/evidence/WO-TF-REMOTE-DEV-OFFLOAD-001-proof.md"]
const operations = ["PROVE_PREFLIGHT", "CREATE_WORKSPACE", "APPLY_RESERVED_PATCH", "RESTORE_DOTNET", "TEST_WORKFLOW_CONTRACT", "TEST_DOTNET_INFORMATIONAL", "BUILD_DOTNET_RELEASE", "COMMIT_RESERVED_PATHS", "PUSH_AUTHORIZED_BRANCH", "PROVE_POST_MERGE", "CLEAN_EXACT_WORKSPACE"]
const approvedAegisKey = "AAAAC3NzaC1lZDI1NTE5AAAAIGZ/ADhMtzZwM46u+K2IK8hiThC/Jk1FD4//ly+ouxZE"
const approvedAegisFingerprint = "SHA256:N+YNbMg3nUb0tX7ZYLJfJSt9f0dUOukBUNLyYb1WByo"
const jcsDigest = (value: unknown) => crypto.createHash("sha256").update(canonicalizeJcs(value)).digest("hex")

function envelope(baseSha: string) {
  return { schemaVersion: 2, programId: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001", goalId: "GOAL-WOS-MULTI-AGENT-OPERATOR-001", loopId: "LOOP-WOS-MULTI-AGENT-OPERATOR-001", workOrderId: "WO-TF-REMOTE-DEV-OFFLOAD-001", objective: "Deliver the bounded TerraFusion informational CI proof.", riskClass: "R1", repositories: ["bsvalues/terrafusion_os_1.0"], baseRefs: [{ repository: "bsvalues/terrafusion_os_1.0", ref: "refs/heads/main", commitSha: baseSha }], dependencies: [], fanInGate: "ALL", laneId: "LANE-TF-REMOTE-DEV-OFFLOAD", teamRoles: { coordinator: "omen-controller", builder: "aegis-worker", reviewer: "independent-assurance" }, providerRequirements: ["hermes-relay"], preferredProviders: ["hermes-relay"], fallbackProviders: [], reservations: { paths: reservedPaths.map((entry) => ({ repository: "bsvalues/terrafusion_os_1.0", path: entry })), contracts: ["remote-dev-offload-v1"], environments: ["aegis-proof-workspace"] }, allowedActions: ["READ_REPOSITORY", "WRITE_RESERVED_PATHS", "RUN_VALIDATION", "COMMIT_OWN_CHANGES", "PUSH_OWN_BRANCH", "OPEN_DRAFT_PR", "READ_CI_AND_REVIEW", "MERGE_ELIGIBLE_PR", "VERIFY_POST_MERGE"], forbiddenActions: ["OWNER_CONTACT", "CREDENTIAL_ACCESS", "RUNTIME_ACTIVATION", "PRODUCTION_WRITE", "BRANCH_PROTECTION_BYPASS", "DESTRUCTIVE_GIT"], authorityGrantRefs: ["grant-remote-dev-offload-v1"], programActivationGrantRef: "grant-remote-dev-offload-v1", grantStatusEventRefs: ["grant-status-remote-dev-offload-v1"], requiredOutputs: ["policy-bound-packet", "hash-chained-evidence"], requiredValidation: ["focused-vitest"], reviewRequirements: { independentReviewer: true, minimumApprovals: 1, maximumUnresolvedThreads: 0 }, mergeMode: "ASSURANCE_GATED", retryBudget: { maxAttempts: 3, backoffSeconds: 10 }, remediationBudget: { maxCycles: 2 }, reroutePolicy: "NONE", stopConditions: ["authority-wall", "resource-limit"], evidenceTargets: ["branch", "commit", "merge", "cleanup"], ownerDecisionConditions: [], ownerOperationsAllowed: false }
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(testRoot, "case-"))
  const now = Date.now(); const baseSha = "a".repeat(40); const patch = Buffer.from("synthetic patch\n")
  const raw: any = { schemaVersion: 1, runId: crypto.randomUUID(), workOrderId: "WO-TF-REMOTE-DEV-OFFLOAD-001", repository: "bsvalues/terrafusion_os_1.0", baseRef: "refs/heads/main", baseSha, branch: `codex/wo-tf-remote-dev-offload-001-${crypto.randomUUID().slice(0, 8)}`, nodeId: "aegis", workspace: "/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001", transport: { controller: "omen", relay: "hermes", worker: "aegis" }, resourceLimits: { cpuThreads: 12, memoryBytes: 12884901888, scratchBytes: 85899345920, timeoutSeconds: 5400, maxAttempts: 3 }, operations, patch: { sha256: crypto.createHash("sha256").update(patch).digest("hex"), generation: 1, changedPaths: reservedPaths }, authority: { grantId: "grant-remote-dev-offload-v1", issuedAt: new Date(now - 300_000).toISOString(), expiresAt: new Date(now + 3_600_000).toISOString(), singleUse: true }, bindings: { policySha256: "", packetSha256: "" } }
  const dispatch = envelope(baseSha)
  const bound = bindRemoteDevPacket(raw, policy, { now: new Date(now).toISOString(), seenRunIds: [], branch: raw.branch, dispatchEnvelope: dispatch })
  if (bound.status !== "INACTIVE_TRUSTED_MAIN_READY") throw new Error(JSON.stringify(bound))
  const packet = bound.packet
  const packetPath = path.join(directory, "packet.json"); fs.writeFileSync(packetPath, JSON.stringify(packet))
  const patchPath = path.join(directory, "patch.bin"); fs.writeFileSync(patchPath, patch)
  const ticketPath = path.join(directory, "launch-ticket.json"); fs.writeFileSync(ticketPath, "{}\n")
  const envelopePath = path.join(directory, "envelope.json"); fs.writeFileSync(envelopePath, JSON.stringify(dispatch))
  const evidenceRoot = path.join(root, ".artifacts/execution-fabric/remote-dev-offload-v1"); evidenceRoots.push(path.join(evidenceRoot, packet.runId))
  const knownHostLine = `aegis ssh-ed25519 ${approvedAegisKey}`
  const startedAt = new Date(now - 120_000).toISOString(); const completedAt = new Date(now - 60_000).toISOString()
  const evidence = { schemaVersion: 1, runId: packet.runId, operation: "PROVE_PREFLIGHT", attempt: 1, startedAt, completedAt, status: "SUCCEEDED", exitCode: 0, nodeId: "aegis", workspace: packet.workspace, branch: packet.branch, baseSha, headSha: baseSha, outputSha256: "d".repeat(64), policySha256: packet.bindings.policySha256, packetSha256: packet.bindings.packetSha256, patchSha256: packet.patch.sha256, patchGeneration: 1, previousEvidenceSha256: null }
  const args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", controller, "-PolicyPath", policyPath, "-PacketPath", packetPath, "-DispatchEnvelopePath", envelopePath, "-PatchPath", patchPath, "-EvidenceRoot", evidenceRoot, "-Operation", "PROVE_PREFLIGHT", "-Attempt", "1", "-PreviousEvidenceSha256", "null", "-LaunchTicketPath", ticketPath, "-AegisKnownHostLine", knownHostLine, "-SshTimeoutSeconds", "10"]
  return { directory, args, evidence, evidenceRoot, packet }
}

beforeAll(() => {
  fs.mkdirSync(fakeBin, { recursive: true })
  const source = path.join(testRoot, "FakeSsh.cs")
  fs.writeFileSync(source, `using System; using System.IO; using System.Threading; public static class FakeSsh { public static int Main(string[] args) { var log=Environment.GetEnvironmentVariable("REMOTE_DEV_FAKE_SSH_LOG"); if(!String.IsNullOrEmpty(log)) File.AppendAllText(log, String.Join("\\t", args)+Environment.NewLine); var input=Console.In.ReadToEnd(); if(!String.IsNullOrEmpty(log)) File.WriteAllText(log+".stdin", input); int delay=0; Int32.TryParse(Environment.GetEnvironmentVariable("REMOTE_DEV_FAKE_SSH_DELAY_MS"), out delay); if(delay>0) Thread.Sleep(delay); var output=Environment.GetEnvironmentVariable("REMOTE_DEV_FAKE_SSH_OUTPUT"); if(output!=null) Console.WriteLine(output); var error=Environment.GetEnvironmentVariable("REMOTE_DEV_FAKE_SSH_ERROR"); if(error!=null) Console.Error.WriteLine(error); int code=0; Int32.TryParse(Environment.GetEnvironmentVariable("REMOTE_DEV_FAKE_SSH_EXIT"), out code); return code; } }`)
  const compiled = spawnSync("C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe", ["/nologo", `/out:${path.join(fakeBin, "ssh.exe")}`, source], { encoding: "utf8" })
  if (compiled.status !== 0) throw new Error(compiled.stderr)
})

afterAll(() => { for (const entry of evidenceRoots) fs.rmSync(entry, { recursive: true, force: true }); fs.rmSync(testRoot, { recursive: true, force: true }) })

function run(args: string[], env: Record<string, string> = {}) {
  fs.rmSync(fakeLog, { force: true })
  fs.rmSync(`${fakeLog}.stdin`, { force: true })
  return spawnSync(pwsh, args, { encoding: "utf8", timeout: 15_000, env: { ...process.env, PATH: `${fakeBin};${process.env.PATH}`, REMOTE_DEV_FAKE_SSH_LOG: fakeLog, ...env } })
}

function decodedRelay(encodedBootstrap: string) {
  const bootstrap = Buffer.from(encodedBootstrap, "base64").toString("utf16le")
  const compressed = bootstrap.match(/FromBase64String\('([^']+)'\)/)?.[1]
  if (!compressed) throw new Error("relay payload is absent")
  return zlib.gunzipSync(Buffer.from(compressed, "base64")).toString("utf8")
}

function encodedRelay(relay: string) {
  const bytes = Buffer.from(relay)
  const compressed = zlib.gzipSync(bytes).toString("base64")
  const digest = crypto.createHash("sha256").update(bytes).digest("hex")
  const bootstrap = `$raw=[Convert]::FromBase64String('${compressed}');$s=[IO.MemoryStream]::new([byte[]]$raw);$g=[IO.Compression.GZipStream]::new($s,[IO.Compression.CompressionMode]::Decompress);$t=[IO.MemoryStream]::new();$g.CopyTo($t);$g.Dispose();$s.Dispose();$b=$t.ToArray();$t.Dispose();$h=[Security.Cryptography.SHA256]::Create();$a=([BitConverter]::ToString($h.ComputeHash($b))).Replace('-','').ToLowerInvariant();$h.Dispose();if($a-ne'${digest}'){exit 64};$p=Join-Path ([IO.Path]::GetTempPath()) ('relay-'+[Guid]::NewGuid().ToString('N')+'.ps1');try{[IO.File]::WriteAllBytes($p,$b);& $p;exit $LASTEXITCODE}finally{Remove-Item $p -Force -ErrorAction SilentlyContinue}`
  return Buffer.from(bootstrap, "utf16le").toString("base64")
}

function summaryFor(evidence: any) {
  const value = { schemaVersion: 1, operation: evidence.operation, startedAt: evidence.startedAt, completedAt: evidence.completedAt, status: evidence.status, exitCode: evidence.exitCode, resourceObservations: { cpuThreads: 12, memoryBytes: 12884901888, scratchBeforeBytes: 1, scratchAfterBytes: 1 }, testCounts: null }
  return `REMOTE_DEV_SUMMARY\t${Buffer.from(JSON.stringify(value)).toString("base64")}`
}

function recoverableCleanupFailure(value: ReturnType<typeof fixture>, previous: string, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1, status: "BLOCKED", reasonCode: "CLEANUP_QUARANTINED_RECOVERABLE", detail: "quarantined cleanup requires same-run retry",
    runId: value.packet.runId, operation: "CLEAN_EXACT_WORKSPACE", attempt: 1, nodeId: "aegis", workspace: value.packet.workspace,
    quarantinePath: `${path.posix.dirname(value.packet.workspace)}/.williamos-quarantine-WO-TF-REMOTE-DEV-OFFLOAD-001-${value.packet.runId}`,
    originalAbsent: true, branch: value.packet.branch, baseSha: value.packet.baseSha, headSha: value.packet.baseSha,
    policySha256: value.packet.bindings.policySha256, packetSha256: value.packet.bindings.packetSha256,
    patchSha256: value.packet.patch.sha256, patchGeneration: 1, previousEvidenceSha256: previous,
    causeCode: "CLEANUP_WORKSPACE_IN_USE", ...overrides,
  }
}

function seedPostMergeState(programData: string, value: ReturnType<typeof fixture>, previous: string) {
  const markerRoot = path.join(programData, "WilliamOS", "remote-dev-offload-v1"); fs.mkdirSync(markerRoot, { recursive: true })
  fs.writeFileSync(path.join(markerRoot, `${value.packet.runId}.json`), JSON.stringify({
    runId: value.packet.runId, policySha256: value.packet.bindings.policySha256, packetSha256: value.packet.bindings.packetSha256,
    lastOperationIndex: 9, lastAttempt: 1, lastEvidenceSha256: previous, lastCompletedAt: value.evidence.completedAt,
    inFlightOperation: null, terminalStatus: "ACTIVE", terminalReason: null, recoverableHeadSha: null, cleanupFailures: [],
  }))
  return path.join(markerRoot, `${value.packet.runId}.json`)
}

function runRelay(encoded: string, input: string, env: NodeJS.ProcessEnv) {
  return new Promise<{ status: number | null, stdout: string, stderr: string }>((resolve) => {
    const child = spawn(pwsh, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { env })
    let stdout = ""; let stderr = ""
    child.stdout.setEncoding("utf8").on("data", (value) => { stdout += value })
    child.stderr.setEncoding("utf8").on("data", (value) => { stderr += value })
    child.on("close", (status) => resolve({ status, stdout, stderr }))
    child.stdin.end(input)
  })
}

function isolatedProgramDataEnv(programData: string, extra: NodeJS.ProcessEnv = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra }
  for (const key of Object.keys(env)) if (key.toLowerCase() === "programdata") delete env[key]
  env.ProgramData = programData
  return env
}

describe("inactive Hermes-mediated remote development controller", () => {
  it("owns activation start and terminal settlement in the reviewed relay", () => {
    const source=fs.readFileSync(controller,"utf8")
    expect(source).toContain("@{action='start'}")
    expect(source).toContain("@{action='settle'}")
    expect(source).toContain("leaseReleased-ne$true")
    expect(source).toContain("replayRejected-ne$true")
    expect(source).toContain("if($script:activationStarted-and(Get-Command InvokeActivation")
    expect(source).toContain("'ACTIVATION_SETTLEMENT_FAILED' -NoFail")
    expect(source).toContain("$script:activationStarted=$true;$started=InvokeActivation")
    expect(source).toContain("resources:{canonicalProfileEquivalent:false,...packet.resourceLimits}")
    expect(source).toContain("if($stdout.Trim()){ExitTerminalOutput $stdout.Trim()}")
    expect(source).toContain("CLEANUP_RECOVERY_EXHAUSTED';SaveState;ExitTerminalOutput")
  })
  it("blocks before SSH while the trusted-main proof scope is inactive", () => {
    const value = fixture()
    const result = run(value.args)
    expect(result.status).toBe(2)
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "BLOCKED", reasonCode: "REMOTE_DEV_SCOPE_INACTIVE" })
    expect(fs.existsSync(fakeLog)).toBe(false)
  })

  it("routes the streamed worker only through the fixed root-installed enforced-slice launcher", () => {
    const source = fs.readFileSync(controller, "utf8")
    expect(source).toContain("/usr/local/libexec/williamos-aegis-remote-dev-network-launcher.mjs")
    expect(source).not.toContain("aegis bash -s --")
    expect(source).toContain("$remotePatchArgument=\"'\"+$relay.patch+\"'\"")
    expect(source).toContain("+$remotePatchArgument+")
  })
})

describe.skip("future-activation Hermes-mediated remote development controller", () => {
  it("contacts only Hermes with BatchMode, a finite timeout, and an encoded independently validating relay", () => {
    const value = fixture()
    const result = run(value.args, { REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence) })
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2)
    const log = fs.readFileSync(fakeLog, "utf8").trim().split("\t")
    expect(log).toContain("BatchMode=yes")
    expect(log).toContain("ConnectTimeout=10")
    expect(log).toContain("hermes")
    expect(log).not.toContain("aegis")
    expect(log).toContain("-EncodedCommand")
    const encoded = log.at(-1)!
    const relay = decodedRelay(encoded)
    expect(relay).toContain("StrictHostKeyChecking=yes")
    expect(relay).toContain("UserKnownHostsFile=")
    expect(relay).toContain("FileMode]::OpenOrCreate")
    expect(relay).toContain("packetSha256")
    expect(relay).toContain("policySha256")
    expect(relay).toContain(approvedAegisFingerprint)
    expect(relay).toContain("WORKER_DIGEST_MISMATCH")
    expect(relay).not.toContain("StrictHostKeyChecking=no")
    expect(relay).not.toMatch(/PasswordAuthentication=yes|Invoke-Expression/)
    expect(fs.readdirSync(path.join(value.evidenceRoot, value.evidence.runId)).sort()).toEqual([
      "00-prove_preflight-1-operation-summary.json",
      "00-prove_preflight-1.json",
    ])
  })

  it("rejects invalid input before SSH with exit 64", () => {
    const value = fixture()
    const packetPath = value.args[value.args.indexOf("-PacketPath") + 1]
    const packet = JSON.parse(fs.readFileSync(packetPath, "utf8")); packet.workspace = "/tmp/other"; fs.writeFileSync(packetPath, JSON.stringify(packet))
    const result = run(value.args, { REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence) })
    expect(result.status).toBe(64)
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "INVALID_INPUT" })
    expect(fs.existsSync(fakeLog)).toBe(false)
  })

  it("returns the typed invalid-input contract for an operation outside the fixed allowlist", () => {
    const value = fixture()
    const args = [...value.args]
    args[args.indexOf("-Operation") + 1] = "ARBITRARY_SHELL"
    const result = run(args, { REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence) })
    expect(result.status).toBe(64)
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "INVALID_INPUT", reasonCode: "OPERATION_NOT_ALLOWED" })
    expect(fs.existsSync(fakeLog)).toBe(false)
  })

  it("confines sanitized evidence to the repository ignored runtime tree", () => {
    const value = fixture()
    const args = [...value.args]
    args[args.indexOf("-EvidenceRoot") + 1] = path.join(value.directory, "outside-evidence")
    const result = run(args, { REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence) })
    expect(result.status).toBe(64)
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "INVALID_INPUT", reasonCode: "EVIDENCE_ROOT_INVALID" })
    expect(fs.existsSync(fakeLog)).toBe(false)
  })

  it("Hermes independently rejects a self-consistent reserved-path drift before contacting AEGIS", () => {
    const value = fixture()
    const prepared = run(value.args, { REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence) })
    expect(prepared.status).toBe(2)
    const invocation = fs.readFileSync(fakeLog, "utf8").trim().split("\t")
    const relay = decodedRelay(invocation.at(-1)!)
    const relayInput = JSON.parse(fs.readFileSync(`${fakeLog}.stdin`, "utf8"))
    const packet = JSON.parse(Buffer.from(relayInput.packet, "base64").toString("utf8"))
    packet.patch.changedPaths[0] = "README.md"
    const unsigned = structuredClone(packet); delete unsigned.bindings
    packet.bindings.packetSha256 = crypto.createHash("sha256").update(canonicalizeJcs(unsigned)).digest("hex")
    relayInput.packet = Buffer.from(JSON.stringify(packet)).toString("base64")
    const programData = path.join(value.directory, "program-data"); fs.mkdirSync(programData)
    const innerLog = path.join(value.directory, "inner-ssh.log")
    const result = spawnSync(pwsh, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedRelay(relay)], {
      encoding: "utf8", input: JSON.stringify(relayInput), env: isolatedProgramDataEnv(programData, { PATH: `${fakeBin};${process.env.PATH}`, REMOTE_DEV_FAKE_SSH_LOG: innerLog, REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence) }),
    })
    expect(result.status).toBe(64)
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "BLOCKED", reasonCode: "PATCH_PATHS_MISMATCH" })
    expect(fs.existsSync(innerLog)).toBe(false)
  })

  it("Hermes accepts the exact bound packet once and rejects a replay before a second AEGIS call", () => {
    const value = fixture()
    const prepared = run(value.args, { REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence) })
    expect(prepared.status).toBe(2)
    const invocation = fs.readFileSync(fakeLog, "utf8").trim().split("\t")
    const encodedRelay = invocation.at(-1)!
    const relayInput = fs.readFileSync(`${fakeLog}.stdin`, "utf8")
    const programData = path.join(value.directory, "program-data"); fs.mkdirSync(programData)
    const innerLog = path.join(value.directory, "inner-ssh.log")
    const env = isolatedProgramDataEnv(programData, { PATH: `${fakeBin};${process.env.PATH}`, REMOTE_DEV_FAKE_SSH_LOG: innerLog, REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence), REMOTE_DEV_FAKE_SSH_ERROR: summaryFor(value.evidence) })
    const first = spawnSync(pwsh, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedRelay], { encoding: "utf8", input: relayInput, env })
    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0)
    const second = spawnSync(pwsh, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedRelay], { encoding: "utf8", input: relayInput, env })
    expect(second.status).toBe(64)
    expect(JSON.parse(second.stdout)).toMatchObject({ status: "BLOCKED", reasonCode: "RUN_REPLAY_OR_ORDER_INVALID" })
    expect(fs.readFileSync(innerLog, "utf8").trim().split(/\r?\n/)).toHaveLength(1)
  }, 15_000)

  it("uses the exact Task 1 canonical JCS digest across consecutive Hermes operations", () => {
    const value = fixture()
    run(value.args, { REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence) })
    const invocation = fs.readFileSync(fakeLog, "utf8").trim().split("\t")
    const encoded = invocation.at(-1)!
    const firstInput = JSON.parse(fs.readFileSync(`${fakeLog}.stdin`, "utf8"))
    const programData = path.join(value.directory, "canonical-chain-program-data"); fs.mkdirSync(programData)
    const innerLog = path.join(value.directory, "canonical-chain-inner.log")
    const baseEnv = isolatedProgramDataEnv(programData, { PATH: `${fakeBin};${process.env.PATH}`, REMOTE_DEV_FAKE_SSH_LOG: innerLog })
    const first = spawnSync(pwsh, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { encoding: "utf8", input: JSON.stringify(firstInput), env: { ...baseEnv, REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence), REMOTE_DEV_FAKE_SSH_ERROR: summaryFor(value.evidence) } })
    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0)
    const canonicalPrevious = jcsDigest(value.evidence)
    const secondEvidence = { ...value.evidence, operation: "CREATE_WORKSPACE", startedAt: new Date(Date.parse(value.evidence.completedAt) + 1_000).toISOString(), completedAt: new Date(Date.parse(value.evidence.completedAt) + 2_000).toISOString(), previousEvidenceSha256: canonicalPrevious }
    const secondInput = { ...firstInput, operation: "CREATE_WORKSPACE", previous: canonicalPrevious }
    const second = spawnSync(pwsh, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { encoding: "utf8", input: JSON.stringify(secondInput), env: { ...baseEnv, REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(secondEvidence), REMOTE_DEV_FAKE_SSH_ERROR: summaryFor(secondEvidence) } })
    expect(second.status, `${second.stdout}\n${second.stderr}`).toBe(0)
    expect(evaluateRemoteDevTransition(value.packet, value.evidence, { now: new Date().toISOString(), seenRunIds: [], branch: value.packet.branch, dispatchEnvelope: envelope(value.evidence.baseSha), evidenceHistory: [] })).toMatchObject({ status: "RUNNING", evidenceSha256: canonicalPrevious })
    expect(evaluateRemoteDevTransition(value.packet, secondEvidence, { now: new Date().toISOString(), seenRunIds: [], branch: value.packet.branch, dispatchEnvelope: envelope(value.evidence.baseSha), evidenceHistory: [value.evidence] })).toMatchObject({ status: "RUNNING", evidenceSha256: jcsDigest(secondEvidence) })
  }, 15_000)

  it("rejects a raw-JSON previous digest when Task 1 canonical JCS differs", () => {
    const value = fixture()
    run(value.args, { REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence) })
    const invocation = fs.readFileSync(fakeLog, "utf8").trim().split("\t")
    const encoded = invocation.at(-1)!; const firstInput = JSON.parse(fs.readFileSync(`${fakeLog}.stdin`, "utf8"))
    const programData = path.join(value.directory, "raw-chain-program-data"); fs.mkdirSync(programData)
    const innerLog = path.join(value.directory, "raw-chain-inner.log")
    const baseEnv = isolatedProgramDataEnv(programData, { PATH: `${fakeBin};${process.env.PATH}`, REMOTE_DEV_FAKE_SSH_LOG: innerLog })
    expect(spawnSync(pwsh, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { encoding: "utf8", input: JSON.stringify(firstInput), env: { ...baseEnv, REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence), REMOTE_DEV_FAKE_SSH_ERROR: summaryFor(value.evidence) } }).status).toBe(0)
    const rawPrevious = crypto.createHash("sha256").update(JSON.stringify(value.evidence)).digest("hex")
    expect(rawPrevious).not.toBe(jcsDigest(value.evidence))
    const secondInput = { ...firstInput, operation: "CREATE_WORKSPACE", previous: rawPrevious }
    const blocked = spawnSync(pwsh, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { encoding: "utf8", input: JSON.stringify(secondInput), env: { ...baseEnv, REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence), REMOTE_DEV_FAKE_SSH_ERROR: summaryFor(value.evidence) } })
    expect(blocked.status).toBe(64)
    expect(blocked.stdout).toContain("EVIDENCE_CHAIN_INVALID")
    expect(fs.readFileSync(innerLog, "utf8").trim().split(/\r?\n/)).toHaveLength(1)
  }, 15_000)

  it("enumerates underscore-bearing evidence filenames through the complete lifecycle", () => {
    const value = fixture(); const args = [...value.args]
    let previous: string | null = null; const history: any[] = []
    for (let index = 0; index < operations.length; index += 1) {
      const startedAt = new Date(Date.parse(value.evidence.startedAt) + index * 2_000).toISOString()
      const completedAt = new Date(Date.parse(startedAt) + 1_000).toISOString()
      const status = index === operations.length - 2 ? "MERGE_ANCESTRY_PROVEN" : index === operations.length - 1 ? "CLEANUP_ABSENCE_PROVEN" : "SUCCEEDED"
      const evidence = { ...value.evidence, operation: operations[index], startedAt, completedAt, status, previousEvidenceSha256: previous }
      args[args.indexOf("-Operation") + 1] = operations[index]
      args[args.indexOf("-PreviousEvidenceSha256") + 1] = previous ?? "null"
      const result = run(args, { REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(evidence) })
      expect(result.status, `${operations[index]}\n${result.stdout}\n${result.stderr}`).toBe(index === operations.length - 1 ? 0 : 2)
      history.push(evidence); previous = jcsDigest(evidence)
    }
    const files = fs.readdirSync(path.join(value.evidenceRoot, value.evidence.runId)).filter((name) => !name.includes("operation-summary"))
    expect(files).toHaveLength(operations.length)
    expect(files).toContain("00-prove_preflight-1.json")
    expect(files).toContain("10-clean_exact_workspace-1.json")
  }, 60_000)

  it("fails closed for timeout, Hermes authentication failure, downstream failure, and malformed worker output", () => {
    const timed = fixture(); const timedArgs = [...timed.args]; timedArgs[timedArgs.indexOf("-SshTimeoutSeconds") + 1] = "1"
    expect(run(timedArgs, { REMOTE_DEV_FAKE_SSH_DELAY_MS: "2500", REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(timed.evidence) }).status).toBe(2)
    const auth = fixture(); const authResult = run(auth.args, { REMOTE_DEV_FAKE_SSH_EXIT: "255", REMOTE_DEV_FAKE_SSH_ERROR: "Permission denied (publickey)." }); expect(authResult.status, `${authResult.stdout}\n${authResult.stderr}`).toBe(2)
    const downstream = fixture(); expect(run(downstream.args, { REMOTE_DEV_FAKE_SSH_EXIT: "2", REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify({ status: "BLOCKED", reasonCode: "AEGIS_TIMEOUT" }) }).status).toBe(2)
    const malformed = fixture(); expect(run(malformed.args, { REMOTE_DEV_FAKE_SSH_OUTPUT: "not-json" }).status).toBe(2)
  }, 15_000)

  it("does not expose credentials or allow password and direct-AEGIS options", () => {
    const value = fixture(); const result = run(value.args, { REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence), GH_TOKEN: "ghp_abcdefghijklmnopqrstuvwxyz123456" })
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2)
    const log = fs.readFileSync(fakeLog, "utf8")
    expect(log).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz123456")
    expect(log).not.toMatch(/PasswordAuthentication=yes|StrictHostKeyChecking=no|\baegis\b/)
  })

  it("binds the approved AEGIS identity and rejects a caller-selected host key", () => {
    const value = fixture()
    const args = [...value.args]
    args[args.indexOf("-AegisKnownHostLine") + 1] = `aegis ssh-ed25519 ${Buffer.from("attacker-key").toString("base64")}`
    const result = run(args, { REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence) })
    expect(result.status).toBe(64)
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "INVALID_INPUT", reasonCode: "HOST_KEY_PIN_MISMATCH" })
    expect(fs.existsSync(fakeLog)).toBe(false)
  })

  it("makes a failed blocking operation terminal and never advances to commit or push", () => {
    const source = fs.readFileSync(controller, "utf8")
    expect(source).toContain("terminalStatus='BLOCKED'")
    expect(source).toContain("if($state.terminalStatus-ne'ACTIVE')")
    expect(source.indexOf("WORKER_EVIDENCE_MISMATCH")).toBeLessThan(source.indexOf("lastOperationIndex=$index"))
  })

  it("serializes replay validation and preserves terminal tombstones", () => {
    const source = fs.readFileSync(controller, "utf8")
    expect(source).toContain("[IO.FileShare]::None")
    expect(source).toContain("RUN_LOCK_BUSY")
    expect(source).not.toContain("Remove-Item -LiteralPath $statePath")
  })

  it("admits exactly one concurrent dispatch for a single-use run", async () => {
    const value = fixture()
    run(value.args, { REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence) })
    const invocation = fs.readFileSync(fakeLog, "utf8").trim().split("\t")
    const encoded = invocation.at(-1)!
    const relayInput = fs.readFileSync(`${fakeLog}.stdin`, "utf8")
    const programData = path.join(value.directory, "concurrent-program-data"); fs.mkdirSync(programData)
    const innerLog = path.join(value.directory, "concurrent-inner.log")
    const env = isolatedProgramDataEnv(programData, { PATH: `${fakeBin};${process.env.PATH}`, REMOTE_DEV_FAKE_SSH_LOG: innerLog, REMOTE_DEV_FAKE_SSH_DELAY_MS: "2500", REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence), REMOTE_DEV_FAKE_SSH_ERROR: summaryFor(value.evidence) })
    const first = runRelay(encoded, relayInput, env)
    const second = runRelay(encoded, relayInput, env)
    const results = await Promise.all([first, second])
    expect(results.map((entry) => entry.status).sort()).toEqual([0, 2])
    expect(results.some((entry) => entry.stdout.includes("RUN_LOCK_BUSY"))).toBe(true)
    expect(fs.readFileSync(innerLog, "utf8").trim().split(/\r?\n/)).toHaveLength(1)
  }, 20_000)

  it("makes a nonzero worker result terminal before commit or push can dispatch", () => {
    const value = fixture()
    run(value.args, { REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence) })
    const invocation = fs.readFileSync(fakeLog, "utf8").trim().split("\t")
    const encoded = invocation.at(-1)!
    const initialInput = JSON.parse(fs.readFileSync(`${fakeLog}.stdin`, "utf8"))
    const programData = path.join(value.directory, "terminal-program-data"); fs.mkdirSync(programData)
    const innerLog = path.join(value.directory, "terminal-inner.log")
    const blockedEnv = isolatedProgramDataEnv(programData, { PATH: `${fakeBin};${process.env.PATH}`, REMOTE_DEV_FAKE_SSH_LOG: innerLog, REMOTE_DEV_FAKE_SSH_EXIT: "2", REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify({ status: "BLOCKED", reasonCode: "BLOCKING_OPERATION_FAILED" }) })
    const first = spawnSync(pwsh, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { encoding: "utf8", input: JSON.stringify(initialInput), env: blockedEnv })
    expect(first.status).toBe(2)
    initialInput.operation = "COMMIT_RESERVED_PATHS"
    const second = spawnSync(pwsh, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { encoding: "utf8", input: JSON.stringify(initialInput), env: blockedEnv })
    expect(second.status).toBe(64)
    expect(second.stdout).toContain("RUN_REPLAY_OR_ORDER_INVALID")
    expect(fs.readFileSync(innerLog, "utf8").trim().split(/\r?\n/)).toHaveLength(1)
  }, 15_000)

  it("allows exactly one bound same-run cleanup retry and retains the failed-attempt tombstone", () => {
    const value = fixture(); run(value.args, { REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence) })
    const invocation = fs.readFileSync(fakeLog, "utf8").trim().split("\t"); const encoded = invocation.at(-1)!
    const relayInput = JSON.parse(fs.readFileSync(`${fakeLog}.stdin`, "utf8")); const previous = "e".repeat(64)
    relayInput.operation = "CLEAN_EXACT_WORKSPACE"; relayInput.attempt = 1; relayInput.previous = previous
    const programData = path.join(value.directory, "cleanup-retry-program-data"); const statePath = seedPostMergeState(programData, value, previous)
    const innerLog = path.join(value.directory, "cleanup-retry-inner.log")
    const baseEnv = isolatedProgramDataEnv(programData, { PATH: `${fakeBin};${process.env.PATH}`, REMOTE_DEV_FAKE_SSH_LOG: innerLog })
    const failure = recoverableCleanupFailure(value, previous)
    const first = spawnSync(pwsh, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { encoding: "utf8", input: JSON.stringify(relayInput), env: { ...baseEnv, REMOTE_DEV_FAKE_SSH_EXIT: "2", REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(failure) } })
    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(2)
    expect(JSON.parse(first.stdout)).toMatchObject({ reasonCode: "CLEANUP_QUARANTINED_RECOVERABLE", attempt: 1 })
    expect(JSON.parse(fs.readFileSync(statePath, "utf8"))).toMatchObject({ terminalStatus: "RECOVERABLE_CLEAN_BLOCKED", terminalReason: "CLEANUP_QUARANTINED_RECOVERABLE", lastAttempt: 1, cleanupFailures: [{ attempt: 1, reasonCode: "CLEANUP_QUARANTINED_RECOVERABLE" }] })

    relayInput.attempt = 2
    const startedAt = new Date(Date.parse(value.evidence.completedAt) + 1_000).toISOString(); const completedAt = new Date(Date.parse(startedAt) + 1_000).toISOString()
    const recovered = { ...value.evidence, operation: "CLEAN_EXACT_WORKSPACE", attempt: 2, startedAt, completedAt, status: "CLEANUP_ABSENCE_PROVEN", previousEvidenceSha256: previous }
    const second = spawnSync(pwsh, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { encoding: "utf8", input: JSON.stringify(relayInput), env: { ...baseEnv, REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(recovered), REMOTE_DEV_FAKE_SSH_ERROR: summaryFor(recovered) } })
    expect(second.status, `${second.stdout}\n${second.stderr}`).toBe(0)
    expect(JSON.parse(second.stdout).evidence).toMatchObject({ status: "CLEANUP_ABSENCE_PROVEN", attempt: 2 })
    expect(JSON.parse(fs.readFileSync(statePath, "utf8"))).toMatchObject({ terminalStatus: "COMPLETE", lastAttempt: 2, cleanupFailures: [{ attempt: 1 }] })
    expect(fs.readFileSync(innerLog, "utf8").trim().split(/\r?\n/)).toHaveLength(2)
  }, 20_000)

  it("publishes a bounded recoverable-cleanup receipt without adding it to Task 1 evidence history", () => {
    const value = fixture(); const args = [...value.args]; const previous = "e".repeat(64)
    args[args.indexOf("-Operation") + 1] = "CLEAN_EXACT_WORKSPACE"; args[args.indexOf("-PreviousEvidenceSha256") + 1] = previous
    const relayFailure = {
      status: "BLOCKED", reasonCode: "CLEANUP_QUARANTINED_RECOVERABLE", detail: "quarantined cleanup requires same-run retry",
      runId: value.packet.runId, operation: "CLEAN_EXACT_WORKSPACE", attempt: 1, previousEvidenceSha256: previous,
      headSha: value.packet.baseSha, failureResultSha256: "f".repeat(64), causeCode: "CLEANUP_WORKSPACE_IN_USE",
    }
    const result = run(args, { REMOTE_DEV_FAKE_SSH_EXIT: "2", REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(relayFailure) })
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2)
    const runDirectory = path.join(value.evidenceRoot, value.packet.runId)
    expect(JSON.parse(fs.readFileSync(path.join(runDirectory, "10-clean_exact_workspace-1-recoverable-failure.json"), "utf8"))).toMatchObject(relayFailure)
    expect(fs.readdirSync(runDirectory).filter((name) => /^\d{2}-[a-z0-9_-]+-\d+\.json$/.test(name))).toHaveLength(0)
  })

  it("never ratchets the trusted cleanup HEAD across recoverable attempts", () => {
    const value = fixture(); run(value.args, { REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence) })
    const invocation = fs.readFileSync(fakeLog, "utf8").trim().split("\t"); const encoded = invocation.at(-1)!
    const relayInput = JSON.parse(fs.readFileSync(`${fakeLog}.stdin`, "utf8")); const previous = "e".repeat(64)
    relayInput.operation = "CLEAN_EXACT_WORKSPACE"; relayInput.attempt = 1; relayInput.previous = previous
    const programData = path.join(value.directory, "cleanup-head-program-data"); const statePath = seedPostMergeState(programData, value, previous)
    const innerLog = path.join(value.directory, "cleanup-head-inner.log"); const baseEnv = isolatedProgramDataEnv(programData, { PATH: `${fakeBin};${process.env.PATH}`, REMOTE_DEV_FAKE_SSH_LOG: innerLog })
    const firstFailure = recoverableCleanupFailure(value, previous)
    expect(spawnSync(pwsh, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { encoding: "utf8", input: JSON.stringify(relayInput), env: { ...baseEnv, REMOTE_DEV_FAKE_SSH_EXIT: "2", REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(firstFailure) } }).status).toBe(2)
    relayInput.attempt = 2
    const changedHead = "f".repeat(40); const changed = recoverableCleanupFailure(value, previous, { attempt: 2, headSha: changedHead })
    const second = spawnSync(pwsh, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { encoding: "utf8", input: JSON.stringify(relayInput), env: { ...baseEnv, REMOTE_DEV_FAKE_SSH_EXIT: "2", REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(changed) } })
    expect(second.status).toBe(2)
    expect(JSON.parse(second.stdout)).toMatchObject({ reasonCode: "CLEANUP_RECOVERY_BINDING_MISMATCH" })
    expect(JSON.parse(fs.readFileSync(statePath, "utf8"))).toMatchObject({ terminalStatus: "BLOCKED", terminalReason: "CLEANUP_RECOVERY_BINDING_MISMATCH", recoverableHeadSha: value.packet.baseSha, cleanupFailures: [{ headSha: value.packet.baseSha }] })
  }, 20_000)

  it("turns attempt three into cleanup recovery exhaustion and never dispatches attempt four", () => {
    const value = fixture(); run(value.args, { REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence) })
    const invocation = fs.readFileSync(fakeLog, "utf8").trim().split("\t"); const encoded = invocation.at(-1)!
    const relayInput = JSON.parse(fs.readFileSync(`${fakeLog}.stdin`, "utf8")); const previous = "e".repeat(64)
    relayInput.operation = "CLEAN_EXACT_WORKSPACE"; relayInput.previous = previous
    const programData = path.join(value.directory, "cleanup-exhausted-program-data"); const statePath = seedPostMergeState(programData, value, previous)
    const innerLog = path.join(value.directory, "cleanup-exhausted-inner.log"); const baseEnv = isolatedProgramDataEnv(programData, { PATH: `${fakeBin};${process.env.PATH}`, REMOTE_DEV_FAKE_SSH_LOG: innerLog })
    for (const attempt of [1, 2, 3]) {
      relayInput.attempt = attempt; const failure = recoverableCleanupFailure(value, previous, { attempt })
      const result = spawnSync(pwsh, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { encoding: "utf8", input: JSON.stringify(relayInput), env: { ...baseEnv, REMOTE_DEV_FAKE_SSH_EXIT: "2", REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(failure) } })
      expect(result.status).toBe(2)
      expect(JSON.parse(result.stdout)).toMatchObject({ reasonCode: attempt < 3 ? "CLEANUP_QUARANTINED_RECOVERABLE" : "CLEANUP_RECOVERY_EXHAUSTED", attempt })
    }
    expect(JSON.parse(fs.readFileSync(statePath, "utf8"))).toMatchObject({ terminalStatus: "BLOCKED", terminalReason: "CLEANUP_RECOVERY_EXHAUSTED", lastAttempt: 3, cleanupFailures: [{ attempt: 1 }, { attempt: 2 }, { attempt: 3 }] })
    relayInput.attempt = 4
    const fourth = spawnSync(pwsh, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { encoding: "utf8", input: JSON.stringify(relayInput), env: { ...baseEnv, REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence) } })
    expect(fourth.status).not.toBe(0)
    expect(fs.readFileSync(innerLog, "utf8").trim().split(/\r?\n/)).toHaveLength(3)
  }, 30_000)

  it("publishes exhaustion evidence without promising a fourth recoverable attempt", () => {
    const value = fixture(); const args = [...value.args]; const previous = "e".repeat(64)
    args[args.indexOf("-Operation") + 1] = "CLEAN_EXACT_WORKSPACE"; args[args.indexOf("-Attempt") + 1] = "3"; args[args.indexOf("-PreviousEvidenceSha256") + 1] = previous
    const exhausted = { status: "BLOCKED", reasonCode: "CLEANUP_RECOVERY_EXHAUSTED", detail: "cleanup recovery attempt budget exhausted", runId: value.packet.runId, operation: "CLEAN_EXACT_WORKSPACE", attempt: 3, previousEvidenceSha256: previous, headSha: value.packet.baseSha, failureResultSha256: "f".repeat(64), causeCode: "CLEANUP_WORKSPACE_IN_USE" }
    const result = run(args, { REMOTE_DEV_FAKE_SSH_EXIT: "2", REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(exhausted) })
    expect(result.status).toBe(2)
    const runDirectory = path.join(value.evidenceRoot, value.packet.runId)
    expect(fs.existsSync(path.join(runDirectory, "10-clean_exact_workspace-3-exhausted.json"))).toBe(true)
    expect(fs.existsSync(path.join(runDirectory, "10-clean_exact_workspace-3-recoverable-failure.json"))).toBe(false)
  })

  it("rejects a different run, wrong attempt, wrong terminal reason, or non-clean recovery before AEGIS dispatch", () => {
    const cases = ["different-run", "wrong-attempt", "wrong-reason", "non-clean"] as const
    for (const scenario of cases) {
      const value = fixture(); run(value.args, { REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence) })
      const invocation = fs.readFileSync(fakeLog, "utf8").trim().split("\t"); const encoded = invocation.at(-1)!
      const relayInput = JSON.parse(fs.readFileSync(`${fakeLog}.stdin`, "utf8")); const previous = "e".repeat(64)
      relayInput.operation = "CLEAN_EXACT_WORKSPACE"; relayInput.attempt = 1; relayInput.previous = previous
      const programData = path.join(value.directory, `${scenario}-program-data`); const statePath = seedPostMergeState(programData, value, previous)
      const innerLog = path.join(value.directory, `${scenario}-inner.log`); const baseEnv = isolatedProgramDataEnv(programData, { PATH: `${fakeBin};${process.env.PATH}`, REMOTE_DEV_FAKE_SSH_LOG: innerLog })
      const failure = recoverableCleanupFailure(value, previous)
      const first = spawnSync(pwsh, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { encoding: "utf8", input: JSON.stringify(relayInput), env: { ...baseEnv, REMOTE_DEV_FAKE_SSH_EXIT: "2", REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(failure) } })
      expect(first.status).toBe(2)
      if (scenario === "different-run") {
        const other = fixture(); const otherPacketPath = other.args[other.args.indexOf("-PacketPath") + 1]
        relayInput.packet = fs.readFileSync(otherPacketPath).toString("base64")
      }
      if (scenario === "wrong-attempt") relayInput.attempt = 3
      else relayInput.attempt = 2
      if (scenario === "wrong-reason") { const state = JSON.parse(fs.readFileSync(statePath, "utf8")); state.terminalReason = "BLOCKING_OPERATION_FAILED"; fs.writeFileSync(statePath, JSON.stringify(state)) }
      if (scenario === "non-clean") relayInput.operation = "COMMIT_RESERVED_PATHS"
      const before = fs.readFileSync(innerLog, "utf8").trim().split(/\r?\n/).length
      const blocked = spawnSync(pwsh, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { encoding: "utf8", input: JSON.stringify(relayInput), env: { ...baseEnv, REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence) } })
      expect(blocked.status).not.toBe(0)
      expect(fs.readFileSync(innerLog, "utf8").trim().split(/\r?\n/)).toHaveLength(before)
    }
  }, 45_000)

  it("pins the reviewed worker digest and independently verifies it on Hermes", () => {
    const source = fs.readFileSync(controller, "utf8")
    const match = source.match(/trustedWorkerSha256\s*=\s*'([a-f0-9]{64})'/i)
    expect(match?.[1]).toBeTruthy()
    const workerDigest = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "scripts/execution-fabric/live/aegis-remote-dev-worker.sh"))).digest("hex")
    expect(match?.[1]).toBe(workerDigest)
    expect(source.match(/WORKER_DIGEST_MISMATCH/g)?.length).toBeGreaterThanOrEqual(2)
    expect(source).toContain("LaunchTicketPath")
    expect(source).toContain("SIGNED_LAUNCH_TICKET_INVALID")
    expect(source).not.toContain("NetworkProofId")
  })

  it("Hermes rejects altered worker bytes before an AEGIS process starts", () => {
    const value = fixture()
    run(value.args, { REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence) })
    const invocation = fs.readFileSync(fakeLog, "utf8").trim().split("\t")
    const relayInput = JSON.parse(fs.readFileSync(`${fakeLog}.stdin`, "utf8")); relayInput.worker = Buffer.from("unreviewed worker").toString("base64")
    const programData = path.join(value.directory, "digest-program-data"); fs.mkdirSync(programData)
    const innerLog = path.join(value.directory, "digest-inner.log")
    const result = spawnSync(pwsh, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", invocation.at(-1)!], { encoding: "utf8", input: JSON.stringify(relayInput), env: isolatedProgramDataEnv(programData, { PATH: `${fakeBin};${process.env.PATH}`, REMOTE_DEV_FAKE_SSH_LOG: innerLog }) })
    expect(result.status).toBe(64)
    expect(result.stdout).toContain("WORKER_DIGEST_MISMATCH")
    expect(fs.existsSync(innerLog)).toBe(false)
  })

  it("checks every evidence ancestor and retains only bounded sanitized summaries", () => {
    const source = fs.readFileSync(controller, "utf8")
    expect(source).toContain("EVIDENCE_ANCESTOR_REPARSE_POINT")
    expect(source).toContain("operation-summary.json")
    expect(source).toContain("resourceLimits")
    expect(source).not.toMatch(/Stdout\s*=.*WriteAllText|Stderr\s*=.*WriteAllText/)
  })

  it("rejects a reparse-point run directory before SSH or evidence publication", () => {
    const value = fixture()
    const runDirectory = path.join(value.evidenceRoot, value.evidence.runId)
    const outside = path.join(value.directory, "outside-evidence"); fs.mkdirSync(outside, { recursive: true })
    fs.mkdirSync(value.evidenceRoot, { recursive: true }); fs.symlinkSync(outside, runDirectory, "junction")
    const result = run(value.args, { REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence) })
    expect(result.status).toBe(64)
    expect(JSON.parse(result.stdout)).toMatchObject({ reasonCode: "EVIDENCE_ANCESTOR_REPARSE_POINT" })
    expect(fs.existsSync(fakeLog)).toBe(false)
  })

  it("uses exit 0 only for COMPLETE and maps process or evidence-write failures to operational exit 2", () => {
    const source = fs.readFileSync(controller, "utf8")
    expect(source).toContain("$transitionResult.status -eq 'COMPLETE'")
    expect(source).toContain("EVIDENCE_WRITE_FAILED")
    expect(source).toContain("SSH_UNAVAILABLE")
  })
})
