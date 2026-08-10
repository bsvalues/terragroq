import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync, spawnSync } from "node:child_process"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { bindRemoteDevPacket } from "../scripts/execution-fabric/live/remote-dev-offload-contract.mjs"
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

function envelope(baseSha: string) {
  return { schemaVersion: 2, programId: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001", goalId: "GOAL-WOS-MULTI-AGENT-OPERATOR-001", loopId: "LOOP-WOS-MULTI-AGENT-OPERATOR-001", workOrderId: "WO-TF-REMOTE-DEV-OFFLOAD-001", objective: "Deliver the bounded TerraFusion informational CI proof.", riskClass: "R1", repositories: ["bsvalues/terrafusion_os_1.0"], baseRefs: [{ repository: "bsvalues/terrafusion_os_1.0", ref: "refs/heads/main", commitSha: baseSha }], dependencies: [], fanInGate: "ALL", laneId: "LANE-TF-REMOTE-DEV-OFFLOAD", teamRoles: { coordinator: "omen-controller", builder: "aegis-worker", reviewer: "independent-assurance" }, providerRequirements: ["hermes-relay"], preferredProviders: ["hermes-relay"], fallbackProviders: [], reservations: { paths: reservedPaths.map((entry) => ({ repository: "bsvalues/terrafusion_os_1.0", path: entry })), contracts: ["remote-dev-offload-v1"], environments: ["aegis-proof-workspace"] }, allowedActions: ["READ_REPOSITORY", "WRITE_RESERVED_PATHS", "RUN_VALIDATION", "COMMIT_OWN_CHANGES", "PUSH_OWN_BRANCH", "OPEN_DRAFT_PR", "READ_CI_AND_REVIEW", "MERGE_ELIGIBLE_PR", "VERIFY_POST_MERGE"], forbiddenActions: ["OWNER_CONTACT", "CREDENTIAL_ACCESS", "RUNTIME_ACTIVATION", "PRODUCTION_WRITE", "BRANCH_PROTECTION_BYPASS", "DESTRUCTIVE_GIT"], authorityGrantRefs: ["grant-remote-dev-offload-v1"], programActivationGrantRef: "grant-remote-dev-offload-v1", grantStatusEventRefs: ["grant-status-remote-dev-offload-v1"], requiredOutputs: ["policy-bound-packet", "hash-chained-evidence"], requiredValidation: ["focused-vitest"], reviewRequirements: { independentReviewer: true, minimumApprovals: 1, maximumUnresolvedThreads: 0 }, mergeMode: "ASSURANCE_GATED", retryBudget: { maxAttempts: 3, backoffSeconds: 10 }, remediationBudget: { maxCycles: 2 }, reroutePolicy: "NONE", stopConditions: ["authority-wall", "resource-limit"], evidenceTargets: ["branch", "commit", "merge", "cleanup"], ownerDecisionConditions: [], ownerOperationsAllowed: false }
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(testRoot, "case-"))
  const now = Date.now(); const baseSha = "a".repeat(40); const patch = Buffer.from("synthetic patch\n")
  const raw: any = { schemaVersion: 1, runId: crypto.randomUUID(), workOrderId: "WO-TF-REMOTE-DEV-OFFLOAD-001", repository: "bsvalues/terrafusion_os_1.0", baseRef: "refs/heads/main", baseSha, branch: `codex/wo-tf-remote-dev-offload-001-${crypto.randomUUID().slice(0, 8)}`, nodeId: "aegis", workspace: "/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001", transport: { controller: "omen", relay: "hermes", worker: "aegis" }, resourceLimits: { cpuThreads: 12, memoryBytes: 12884901888, scratchBytes: 85899345920, timeoutSeconds: 5400, maxAttempts: 3 }, operations, patch: { sha256: crypto.createHash("sha256").update(patch).digest("hex"), generation: 1, changedPaths: reservedPaths }, authority: { grantId: "grant-remote-dev-offload-v1", issuedAt: new Date(now - 300_000).toISOString(), expiresAt: new Date(now + 3_600_000).toISOString(), singleUse: true }, bindings: { policySha256: "", packetSha256: "" } }
  const dispatch = envelope(baseSha)
  const bound = bindRemoteDevPacket(raw, policy, { now: new Date(now).toISOString(), seenRunIds: [], branch: raw.branch, dispatchEnvelope: dispatch })
  if (bound.status !== "READY") throw new Error(JSON.stringify(bound))
  const packet = bound.packet
  const packetPath = path.join(directory, "packet.json"); fs.writeFileSync(packetPath, JSON.stringify(packet))
  const patchPath = path.join(directory, "patch.bin"); fs.writeFileSync(patchPath, patch)
  const envelopePath = path.join(directory, "envelope.json"); fs.writeFileSync(envelopePath, JSON.stringify(dispatch))
  const evidenceRoot = path.join(root, ".artifacts/execution-fabric/remote-dev-offload-v1"); evidenceRoots.push(path.join(evidenceRoot, packet.runId))
  const keyBytes = Buffer.from("synthetic-aegis-host-key")
  const knownHostLine = `aegis ssh-ed25519 ${keyBytes.toString("base64")}`
  const fingerprint = `SHA256:${crypto.createHash("sha256").update(keyBytes).digest("base64").replace(/=+$/, "")}`
  const startedAt = new Date(now - 120_000).toISOString(); const completedAt = new Date(now - 60_000).toISOString()
  const evidence = { schemaVersion: 1, runId: packet.runId, operation: "PROVE_PREFLIGHT", attempt: 1, startedAt, completedAt, status: "SUCCEEDED", exitCode: 0, nodeId: "aegis", workspace: packet.workspace, branch: packet.branch, baseSha, headSha: baseSha, outputSha256: "d".repeat(64), policySha256: packet.bindings.policySha256, packetSha256: packet.bindings.packetSha256, patchSha256: packet.patch.sha256, patchGeneration: 1, previousEvidenceSha256: null }
  const args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", controller, "-PolicyPath", policyPath, "-PacketPath", packetPath, "-DispatchEnvelopePath", envelopePath, "-PatchPath", patchPath, "-EvidenceRoot", evidenceRoot, "-Operation", "PROVE_PREFLIGHT", "-Attempt", "1", "-PreviousEvidenceSha256", "null", "-AegisKnownHostLine", knownHostLine, "-AegisHostKeyFingerprint", fingerprint, "-SshTimeoutSeconds", "3"]
  return { directory, args, evidence, evidenceRoot }
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

describe("Hermes-mediated remote development controller", () => {
  it("contacts only Hermes with BatchMode, a finite timeout, and an encoded independently validating relay", () => {
    const value = fixture()
    const result = run(value.args, { REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence) })
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    const log = fs.readFileSync(fakeLog, "utf8").trim().split("\t")
    expect(log).toContain("BatchMode=yes")
    expect(log).toContain("ConnectTimeout=10")
    expect(log).toContain("hermes")
    expect(log).not.toContain("aegis")
    expect(log).toContain("-EncodedCommand")
    const encoded = log.at(-1)!
    const relay = Buffer.from(encoded, "base64").toString("utf16le")
    expect(relay).toContain("StrictHostKeyChecking=yes")
    expect(relay).toContain("UserKnownHostsFile=")
    expect(relay).toContain("FileMode]::CreateNew")
    expect(relay).toContain("packetSha256")
    expect(relay).toContain("policySha256")
    expect(relay).not.toContain("StrictHostKeyChecking=no")
    expect(relay).not.toMatch(/PasswordAuthentication=yes|Invoke-Expression/)
    expect(fs.readdirSync(path.join(value.evidenceRoot, value.evidence.runId))).toHaveLength(1)
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
    expect(prepared.status).toBe(0)
    const invocation = fs.readFileSync(fakeLog, "utf8").trim().split("\t")
    const relay = Buffer.from(invocation.at(-1)!, "base64").toString("utf16le")
    const relayInput = JSON.parse(fs.readFileSync(`${fakeLog}.stdin`, "utf8"))
    const packet = JSON.parse(Buffer.from(relayInput.packet, "base64").toString("utf8"))
    packet.patch.changedPaths[0] = "README.md"
    const unsigned = structuredClone(packet); delete unsigned.bindings
    packet.bindings.packetSha256 = crypto.createHash("sha256").update(canonicalizeJcs(unsigned)).digest("hex")
    relayInput.packet = Buffer.from(JSON.stringify(packet)).toString("base64")
    const programData = path.join(value.directory, "program-data"); fs.mkdirSync(programData)
    const innerLog = path.join(value.directory, "inner-ssh.log")
    const result = spawnSync(pwsh, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(relay, "utf16le").toString("base64")], {
      encoding: "utf8", input: JSON.stringify(relayInput), env: { ...process.env, PATH: `${fakeBin};${process.env.PATH}`, ProgramData: programData, REMOTE_DEV_FAKE_SSH_LOG: innerLog, REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence) },
    })
    expect(result.status).toBe(64)
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "BLOCKED", reasonCode: "PATCH_PATHS_MISMATCH" })
    expect(fs.existsSync(innerLog)).toBe(false)
  })

  it("Hermes accepts the exact bound packet once and rejects a replay before a second AEGIS call", () => {
    const value = fixture()
    const prepared = run(value.args, { REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence) })
    expect(prepared.status).toBe(0)
    const invocation = fs.readFileSync(fakeLog, "utf8").trim().split("\t")
    const encodedRelay = invocation.at(-1)!
    const relayInput = fs.readFileSync(`${fakeLog}.stdin`, "utf8")
    const programData = path.join(value.directory, "program-data"); fs.mkdirSync(programData)
    const innerLog = path.join(value.directory, "inner-ssh.log")
    const env = { ...process.env, PATH: `${fakeBin};${process.env.PATH}`, ProgramData: programData, REMOTE_DEV_FAKE_SSH_LOG: innerLog, REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence) }
    const first = spawnSync(pwsh, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedRelay], { encoding: "utf8", input: relayInput, env })
    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0)
    const second = spawnSync(pwsh, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedRelay], { encoding: "utf8", input: relayInput, env })
    expect(second.status).toBe(64)
    expect(JSON.parse(second.stdout)).toMatchObject({ status: "BLOCKED", reasonCode: "RUN_REPLAY_OR_ORDER_INVALID" })
    expect(fs.readFileSync(innerLog, "utf8").trim().split(/\r?\n/)).toHaveLength(1)
  })

  it("fails closed for timeout, Hermes authentication failure, downstream failure, and malformed worker output", () => {
    const timed = fixture(); const timedArgs = [...timed.args]; timedArgs[timedArgs.indexOf("-SshTimeoutSeconds") + 1] = "1"
    expect(run(timedArgs, { REMOTE_DEV_FAKE_SSH_DELAY_MS: "2500", REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(timed.evidence) }).status).toBe(2)
    const auth = fixture(); expect(run(auth.args, { REMOTE_DEV_FAKE_SSH_EXIT: "255", REMOTE_DEV_FAKE_SSH_ERROR: "Permission denied (publickey)." }).status).toBe(2)
    const downstream = fixture(); expect(run(downstream.args, { REMOTE_DEV_FAKE_SSH_EXIT: "2", REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify({ status: "BLOCKED", reasonCode: "AEGIS_TIMEOUT" }) }).status).toBe(2)
    const malformed = fixture(); expect(run(malformed.args, { REMOTE_DEV_FAKE_SSH_OUTPUT: "not-json" }).status).toBe(2)
  }, 15_000)

  it("does not expose credentials or allow password and direct-AEGIS options", () => {
    const value = fixture(); const result = run(value.args, { REMOTE_DEV_FAKE_SSH_OUTPUT: JSON.stringify(value.evidence), GH_TOKEN: "ghp_abcdefghijklmnopqrstuvwxyz123456" })
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    const log = fs.readFileSync(fakeLog, "utf8")
    expect(log).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz123456")
    expect(log).not.toMatch(/PasswordAuthentication=yes|StrictHostKeyChecking=no|\baegis\b/)
  })
})
