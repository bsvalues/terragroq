import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { createTicketTombstone, createWorkerExecutionEnvelope, createWorkerOverflowEnvelope, fixedTicketUnitContract, inspectSignedLaunchAuthorization, inspectWorkerExecutionEnvelope, inspectWorkerNetworkBinding } from "../scripts/execution-fabric/live/aegis-remote-dev-network-launcher.mjs"
import { inspectReceiptTicketDirectoryIdentity } from "../scripts/execution-fabric/live/aegis-remote-dev-activation-host.mjs"

const jcs = (value: any): string => value === null ? "null"
  : typeof value === "string" ? JSON.stringify(value)
    : typeof value === "number" ? JSON.stringify(value)
      : typeof value === "boolean" ? String(value)
        : Array.isArray(value) ? `[${value.map(jcs).join(",")}]`
          : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${jcs(value[key])}`).join(",")}}`
const canonical = (value: unknown) => Buffer.from(`${jcs(value)}\n`, "utf8")
const sha = (bytes: Buffer | string) => crypto.createHash("sha256").update(bytes).digest("hex")

const enforcedSlice = "/user.slice/user-1001.slice/user@1001.service/app.slice/williamos-aegis-remote-dev.slice"
const workerScope = `${enforcedSlice}/williamos-aegis-remote-dev-34d1f58a-5c15-4e62-845f-f54f73829e2f.service`

function fixture() {
  const launcherBytes = Buffer.from("reviewed launcher bytes\n")
  const ticketConsumptionDirectoryIdentity = inspectReceiptTicketDirectoryIdentity({ device: "29", inode: "88301" })!
  const enforcement = {
    mechanism: "ROOT_ATTESTED_CGROUP_EGRESS_V1",
    defaultDeny: true,
    directNetworkAllowed: false,
    brokerRequired: true,
    atlas: { allowed: false, addresses: ["192.168.1.156/32"], ports: "ALL" },
    endpoints: [
      { host: "ssh.github.com", port: 443, operations: ["git-fetch", "git-push"] },
      { host: "api.github.com", port: 443, operations: ["github-pr"] },
      { host: "api.nuget.org", port: 443, operations: ["dotnet-restore"] },
      { host: "globalcdn.nuget.org", port: 443, operations: ["dotnet-restore"] },
    ],
  }
  const receipt = {
    schemaVersion: 1,
    proofId: "0f8fad5b-d9cb-469f-a165-70867728950e",
    providerId: "aegis-remote-dev-root-attested-egress-v1",
    activationId: "remote-dev-offload-v1-issue-734-single-use-001",
    authorityReference: "issue-734-terrafusion-remote-dev-single-use-001",
    runId: "56b41a96-3bbf-4c80-907b-d37db1437e9d",
    observedAt: "2026-08-11T05:00:00.000Z",
    expiresAt: "2026-08-11T05:00:30.000Z",
    bootId: "11111111-2222-4333-8444-555555555555",
    controlGroup: enforcedSlice,
    controlGroupIdentity: { device: "29", inode: "74319", ctimeNs: "1786410000000000000" },
    enforcementGeneration: { generationId: "8f14e45f-ea7b-4f26-8a13-f39c3f73b1b8", rulesetSha256: sha(jcs(enforcement)) },
    launcherSha256: sha(launcherBytes),
    workerSha256: "d".repeat(64),
    launchAuthority: { algorithm: "Ed25519", publicKeyPath: "/etc/williamos-fabric/aegis-remote-dev-launch-authority.pem", publicKeySha256: "e".repeat(64) },
    ticketConsumption: {
      directoryPath: "/var/lib/williamos-fabric/remote-dev-launch-tickets",
      directoryIdentity: ticketConsumptionDirectoryIdentity,
      ownerUid: 0,
      writerGid: 1001,
      mode: "3770",
      appendOnly: true,
    },
    nodeId: "aegis",
    account: "williamos-fabric",
    machineIdSha256: "1b490fe20bf3d61dc1f14e3a6e7fe38fc7de69c14face211fdd5afd0544c9c8b",
    controlPlaneCommit: "f04c816dbcba96990f7754b4767ff16ae7b9b5c9",
    policySha256: "a".repeat(64),
    activationSha256: "b".repeat(64),
    providerSha256: "c".repeat(64),
    enforcement,
  }
  return {
    receipt,
    input: {
      receiptBytes: canonical(receipt),
      receiptFile: { isFile: true, isSymbolicLink: false, nlink: 1, uid: 0, mode: 0o444, parentsRootOwnedAndNotWritable: true },
      launcherBytes,
      launcherFile: { isFile: true, isSymbolicLink: false, nlink: 1, uid: 0, mode: 0o555, parentsRootOwnedAndNotWritable: true },
      now: "2026-08-11T05:00:10.000Z",
      expectedProofId: receipt.proofId,
      expectedRunId: receipt.runId,
      expectedTicketId: "34d1f58a-5c15-4e62-845f-f54f73829e2f",
      workerControlGroup: workerScope,
      currentEnforcedControlGroupIdentity: { ...receipt.controlGroupIdentity },
      currentTicketConsumptionDirectory: {
        isDirectory: true,
        isSymbolicLink: false,
        uid: 0,
        gid: 1001,
        mode: 0o3770,
        appendOnly: true,
        parentsRootOwnedAndNotWritable: true,
        identity: { ...ticketConsumptionDirectoryIdentity, ctimeNs: "1786410000000000100" },
      },
    },
  }
}

function signedLaunchFixture() {
  const value = fixture()
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
  const publicKeyBytes = Buffer.from(publicKey.export({ type: "spki", format: "pem" }))
  const workerBytes = Buffer.from("fixed canonical worker\n")
  const packetBytes = Buffer.from('{"runId":"56b41a96-3bbf-4c80-907b-d37db1437e9d"}')
  const patchBytes = Buffer.from("synthetic patch\n")
  value.receipt.workerSha256 = sha(workerBytes)
  value.receipt.launchAuthority.publicKeySha256 = sha(publicKeyBytes)
  const payload = {
    schemaVersion: 1,
    ticketId: value.input.expectedTicketId,
    activationId: value.receipt.activationId,
    authorityReference: value.receipt.authorityReference,
    runId: value.receipt.runId,
    proofId: value.receipt.proofId,
    claimId: "claim-single-use-001",
    leaseId: "lease-node-exclusive-001",
    operation: "PROVE_PREFLIGHT",
    attempt: 1,
    previousEvidenceSha256: null,
    packetSha256: sha(packetBytes),
    patchSha256: sha(patchBytes),
    workerSha256: sha(workerBytes),
    issuedAt: "2026-08-11T05:00:05.000Z",
    expiresAt: "2026-08-11T05:00:25.000Z",
  }
  const ticket = { payload, signature: crypto.sign(null, Buffer.from(jcs(payload)), privateKey).toString("base64") }
  return {
    ticket,
    input: {
      ticketBytes: canonical(ticket),
      publicKeyBytes,
      publicKeyFile: { isFile: true, isSymbolicLink: false, nlink: 1, uid: 0, mode: 0o444, parentsRootOwnedAndNotWritable: true },
      receipt: value.receipt,
      workerBytes,
      operation: payload.operation,
      packetBytes,
      patchBytes,
      attempt: String(payload.attempt),
      previousEvidenceSha256: "null",
      now: "2026-08-11T05:00:10.000Z",
    },
  }
}

describe("fixed AEGIS enforced-slice worker launcher", () => {
  it("launches Bash only through the fixed sandboxed service after child verification", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "scripts/execution-fabric/live/aegis-remote-dev-network-launcher.mjs"), "utf8")
    const systemdLaunch = source.indexOf('spawnSync("/usr/bin/systemd-run"')
    const childProof = source.indexOf("inspectWorkerNetworkBinding({", source.indexOf("function child"))
    const workerLaunch = source.indexOf('spawnSync("/usr/bin/bash"', childProof)
    expect(systemdLaunch).toBeGreaterThanOrEqual(0)
    expect(source).toContain('`--slice=${SLICE_UNIT}`')
    expect(source).toContain('`--unit=${service.unitName}`')
    expect(source).toContain('"--service-type=exec"')
    expect(source).not.toContain('"--scope"')
    expect(source).toContain("InaccessiblePaths=-/run/user/${uid}/bus -/run/user/${uid}/systemd/private")
    expect(source).toContain('"/usr/bin/env", "-i"')
    expect(source).toContain('"NoNewPrivileges=yes"')
    expect(source).toContain('"RefuseManualStop=yes"')
    expect(childProof).toBeGreaterThanOrEqual(0)
    expect(workerLaunch).toBeGreaterThan(childProof)
    expect(source).not.toContain("shell: true")
  })

  it("verifies a signed opaque-session ticket and the canonical stdin worker in both launcher stages", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "scripts/execution-fabric/live/aegis-remote-dev-network-launcher.mjs"), "utf8")
    expect(source.match(/const authorization = authorizeRuntime\(bound, files, workerBytes\)/g)).toHaveLength(2)
    expect(source.match(/const workerBytes = readWorkerBytes\(\)/g)).toHaveLength(2)
    expect(source).toContain('payload.workerSha256 !== digest(input.workerBytes)')
    expect(source).toContain('payload.claimId')
    expect(source).toContain('payload.leaseId')
    expect(source).toContain('crypto.verify(null')
    expect(source).toContain('input: workerBytes, stdio: ["pipe", "pipe", "pipe"]')
    expect(source).toContain("bound.previous, authorization.ticketId")
  })

  it("retains the exact per-ticket unit as a concurrent replay fence", () => {
    const ticketId = fixture().input.expectedTicketId
    const first = fixedTicketUnitContract(ticketId)
    const second = fixedTicketUnitContract(ticketId)
    const activeUnits = new Set<string>()
    const start = (unit: ReturnType<typeof fixedTicketUnitContract>) => {
      if (activeUnits.has(unit.unitName)) return false
      activeUnits.add(unit.unitName)
      return true
    }

    expect(first).toEqual({
      unitName: `williamos-aegis-remote-dev-${ticketId}`,
      properties: ["RefuseManualStop=yes", "RemainAfterExit=yes"],
      wait: false,
      collect: false,
    })
    expect(start(first)).toBe(true)
    expect(start(second)).toBe(false)

    const source = fs.readFileSync(path.join(process.cwd(), "scripts/execution-fabric/live/aegis-remote-dev-network-launcher.mjs"), "utf8")
    expect(source).not.toContain('"--wait"')
    expect(source).not.toContain('"--collect"')
  })

  it("atomically consumes a ticket outside the user manager so manager restart cannot replay it", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-ticket-consumption-"))
    const ticketId = fixture().input.expectedTicketId
    try {
      createTicketTombstone(directory, ticketId)
      expect(() => createTicketTombstone(directory, ticketId)).toThrow()
      expect(fs.existsSync(path.join(directory, `${ticketId}.consumed`))).toBe(true)
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it("ignores same-identity tombstone content mutation because only the append-only name is authority", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-ticket-content-"))
    const ticketId = fixture().input.expectedTicketId
    const tombstonePath = path.join(directory, `${ticketId}.consumed`)
    try {
      createTicketTombstone(directory, ticketId)
      fs.chmodSync(tombstonePath, 0o600)
      fs.writeFileSync(tombstonePath, "untrusted rewritten content")
      expect(() => createTicketTombstone(directory, ticketId)).toThrow()
      expect(fs.existsSync(tombstonePath)).toBe(true)
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it("consumes the durable ticket tombstone before entering the user-manager launch boundary", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "scripts/execution-fabric/live/aegis-remote-dev-network-launcher.mjs"), "utf8")
    const parent = source.indexOf("function parent(args)")
    const consume = source.indexOf("consumeRuntimeTicket(files.parsedReceipt, authorization)", parent)
    const systemd = source.indexOf('spawnSync("/usr/bin/systemd-run"', parent)
    expect(parent).toBeGreaterThanOrEqual(0)
    expect(consume).toBeGreaterThan(parent)
    expect(systemd).toBeGreaterThan(consume)
    expect(source).toContain("fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW")
  })

  it("preserves worker result truth through the successful retained service process", () => {
    const ticketId = fixture().input.expectedTicketId
    const workerStdout = Buffer.from('{"status":"BLOCKED"}\n')
    const workerStderr = Buffer.from("bounded failure\n")
    const envelope = canonical({
      schemaVersion: 1,
      ticketId,
      workerExitCode: 2,
      workerStdoutBase64: workerStdout.toString("base64"),
      workerStderrBase64: workerStderr.toString("base64"),
    })

    expect(inspectWorkerExecutionEnvelope(envelope, ticketId)).toEqual({
      workerExitCode: 2,
      workerStdout,
      workerStderr,
    })
  })

  it("keeps the maximum valid dual-stream result inside the canonical transport envelope", () => {
    const ticketId = fixture().input.expectedTicketId
    const stdout = Buffer.alloc(20_000, 0x61)
    const stderr = Buffer.alloc(20_000, 0x62)
    const envelope = createWorkerExecutionEnvelope(ticketId, 17, stdout, stderr)

    expect(envelope.length).toBeLessThanOrEqual(65_536)
    expect(inspectWorkerExecutionEnvelope(envelope, ticketId)).toEqual({ workerExitCode: 17, workerStdout: stdout, workerStderr: stderr })
  })

  it("returns an explicit bounded truncation result instead of an oversized envelope", () => {
    const ticketId = fixture().input.expectedTicketId
    const envelope = createWorkerExecutionEnvelope(ticketId, 17, Buffer.alloc(20_001, 0x61), Buffer.from("diagnostic\n"))
    const result = inspectWorkerExecutionEnvelope(envelope, ticketId)

    expect(envelope.length).toBeLessThanOrEqual(65_536)
    expect(result.workerExitCode).toBe(2)
    expect(JSON.parse(result.workerStdout.toString("utf8"))).toMatchObject({
      status: "BLOCKED", executionAuthorized: false, reasonCode: "WORKER_OUTPUT_TRUNCATED",
      workerExitCode: 17, workerStdoutBytes: 20_001, workerStderrBytes: 11,
    })
    expect(result.workerStderr.toString("utf8")).toContain("WORKER_OUTPUT_TRUNCATED")
  })

  it("reports the observed stream counts truthfully when only one live capture overflows", () => {
    const ticketId = fixture().input.expectedTicketId
    const result = inspectWorkerExecutionEnvelope(
      createWorkerOverflowEnvelope(ticketId, null, Buffer.alloc(20_002, 0x61), Buffer.alloc(0)),
      ticketId,
    )

    expect(JSON.parse(result.workerStdout.toString("utf8"))).toMatchObject({
      reasonCode: "WORKER_OUTPUT_TRUNCATED",
      workerExitCode: null,
      workerStdoutBytes: 20_002,
      workerStderrBytes: 0,
    })
  })

  it.each([
    ["other ticket", (value: any) => { value.ticketId = "0f8fad5b-d9cb-469f-a165-70867728950e" }],
    ["invalid exit", (value: any) => { value.workerExitCode = 256 }],
    ["non-canonical base64", (value: any) => { value.workerStdoutBase64 = "A===" }],
    ["extra field", (value: any) => { value.untrusted = true }],
  ])("rejects worker execution envelope drift: %s", (_label, mutate) => {
    const ticketId = fixture().input.expectedTicketId
    const value: any = {
      schemaVersion: 1,
      ticketId,
      workerExitCode: 0,
      workerStdoutBase64: Buffer.from("ok\n").toString("base64"),
      workerStderrBase64: "",
    }
    mutate(value)
    expect(() => inspectWorkerExecutionEnvelope(canonical(value), ticketId)).toThrow()
  })

  it("lets Node drain pipe-backed launcher output before exiting", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "scripts/execution-fabric/live/aegis-remote-dev-network-launcher.mjs"), "utf8")
    expect(source).not.toContain("process.exit(")
    expect(source.match(/process\.exitCode =/g)).toHaveLength(3)
  })

  it("accepts only a worker process beneath the exact attested slice generation", () => {
    expect(inspectWorkerNetworkBinding(fixture().input)).toMatchObject({
      status: "WORKER_NETWORK_BOUNDARY_VERIFIED",
      executionAuthorized: false,
      proofId: fixture().receipt.proofId,
      runId: fixture().receipt.runId,
      enforcedControlGroup: enforcedSlice,
    })
  })

  it("requires an Ed25519 ticket bound to the claim, lease, proof, operation, payload, and canonical worker", () => {
    expect(inspectSignedLaunchAuthorization(signedLaunchFixture().input)).toMatchObject({
      status: "SIGNED_LAUNCH_AUTHORIZED",
      executionAuthorized: false,
      claimId: "claim-single-use-001",
      leaseId: "lease-node-exclusive-001",
    })
  })

  it.each([
    ["arbitrary worker", (value: any) => { value.workerBytes = Buffer.from("arbitrary bash\n") }],
    ["other operation", (value: any) => { value.operation = "CREATE_WORKSPACE" }],
    ["other packet", (value: any) => { value.packetBytes = Buffer.from("{}") }],
    ["forged signature", (value: any) => { const ticket = JSON.parse(value.ticketBytes); ticket.signature = Buffer.alloc(64).toString("base64"); value.ticketBytes = canonical(ticket) }],
    ["mutable key", (value: any) => { value.publicKeyFile.mode = 0o644 }],
    ["stale ticket", (value: any) => { value.now = "2026-08-11T05:00:25.000Z" }],
  ])("rejects signed-launch drift: %s", (_label, mutate) => {
    const value: any = signedLaunchFixture().input
    mutate(value)
    expect(inspectSignedLaunchAuthorization(value)).toMatchObject({ status: "BLOCKED", executionAuthorized: false })
  })

  it.each([
    ["outside slice", (value: any) => { value.workerControlGroup = "/user.slice/user-1001.slice/user@1001.service/app.slice/other.scope" }],
    ["recreated slice", (value: any) => { value.currentEnforcedControlGroupIdentity.inode = "74320" }],
    ["other run", (value: any) => { value.expectedRunId = "0f8fad5b-d9cb-469f-a165-70867728950e" }],
    ["other proof", (value: any) => { value.expectedProofId = "8f14e45f-ea7b-4f26-8a13-f39c3f73b1b8" }],
    ["stale receipt", (value: any) => { value.now = "2026-08-11T05:00:30.000Z" }],
    ["unreviewed launcher", (value: any) => { value.launcherBytes = Buffer.from("other launcher\n") }],
    ["mutable launcher", (value: any) => { value.launcherFile.mode = 0o755 }],
    ["mutable receipt", (value: any) => { value.receiptFile.mode = 0o644 }],
    ["recreated ticket directory", (value: any) => { value.currentTicketConsumptionDirectory.identity.inode = "88302" }],
    ["ticket directory not append-only", (value: any) => { value.currentTicketConsumptionDirectory.appendOnly = false }],
    ["ticket directory group drift", (value: any) => { value.currentTicketConsumptionDirectory.gid = 1002 }],
  ])("fails closed for %s", (_label, mutate) => {
    const value: any = fixture().input
    mutate(value)
    expect(inspectWorkerNetworkBinding(value)).toMatchObject({ status: "BLOCKED", executionAuthorized: false, reasons: [{ code: "WORKER_NETWORK_BOUNDARY_UNPROVEN" }] })
  })
})
