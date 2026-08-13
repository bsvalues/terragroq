import crypto from "node:crypto"

import { describe, expect, it } from "vitest"

import { canonicalizeJcs } from "../scripts/execution-fabric/canonical-json.mjs"
import {
  inspectResidentNetworkBoundaryEvidence,
  proveResidentAegisNetworkBoundary,
} from "../scripts/execution-fabric/live/aegis-resident-network-boundary.mjs"
import { inspectReceiptTicketDirectoryIdentity } from "../scripts/execution-fabric/live/aegis-remote-dev-activation-host.mjs"

const endpoints = Object.freeze([
  { host: "ssh.github.com", port: 443, operations: ["git-fetch", "git-push"] },
  { host: "api.github.com", port: 443, operations: ["github-pr"] },
  { host: "api.nuget.org", port: 443, operations: ["dotnet-restore"] },
  { host: "globalcdn.nuget.org", port: 443, operations: ["dotnet-restore"] },
].map((endpoint) => Object.freeze({ ...endpoint, operations: Object.freeze([...endpoint.operations]) })))
const cloneEndpoints = () => endpoints.map((endpoint) => ({ ...endpoint, operations: [...endpoint.operations] }))

const sha = (bytes: Buffer | string) => crypto.createHash("sha256").update(bytes).digest("hex")
const canonical = (value: unknown) => Buffer.from(`${canonicalizeJcs(value)}\n`, "utf8")

function policy() {
  return {
    schemaVersion: 1,
    policyId: "aegis-remote-dev-root-attested-egress-v1",
    provider: "proveResidentAegisNetworkBoundary",
    nodeId: "aegis",
    executionIdentity: { account: "williamos-fabric", machineIdSha256: "1b490fe20bf3d61dc1f14e3a6e7fe38fc7de69c14face211fdd5afd0544c9c8b" },
    trustedMain: { repository: "bsvalues/terragroq", ref: "refs/heads/main", minimumCommit: "f04c816dbcba96990f7754b4767ff16ae7b9b5c9" },
    receipt: { path: "/run/williamos-fabric/aegis-remote-dev-network-proof.json", ownerUid: 0, mode: "0444", maximumAgeSeconds: 30, bootIdPath: "/proc/sys/kernel/random/boot_id", controlGroupRootPath: "/sys/fs/cgroup", enforcedSliceUnit: "williamos-aegis-remote-dev.slice" },
    workerLaunch: {
      launcherPath: "scripts/execution-fabric/live/aegis-remote-dev-network-launcher.mjs",
      installedPath: "/usr/local/libexec/williamos-aegis-remote-dev-network-launcher.mjs",
      nodePath: "/usr/bin/node",
      systemdRunPath: "/usr/bin/systemd-run",
      sliceUnit: "williamos-aegis-remote-dev.slice",
      workerMustBeExactRunScopeDescendant: true,
      receiptLauncherDigestRequired: true,
      launchAuthorityPublicKeyPath: "/etc/williamos-fabric/aegis-remote-dev-launch-authority.pem",
      signedSingleOperationTicketRequired: true,
      canonicalWorkerDigestRequired: true,
      ticketConsumptionDirectory: "/var/lib/williamos-fabric/remote-dev-launch-tickets",
      atomicTicketTombstoneRequired: true,
      appendOnlyDirectoryRequired: true,
    },
    enforcement: {
      mechanism: "ROOT_ATTESTED_CGROUP_EGRESS_V1",
      defaultDeny: true,
      directNetworkAllowed: false,
      brokerRequired: true,
      atlas: { allowed: false, addresses: ["192.168.1.156/32"], ports: "ALL" },
      endpoints: cloneEndpoints(),
    },
    bindings: {
      activationPath: "config/execution-fabric/remote-dev-offload-v1-activation.json",
      providerPath: "scripts/execution-fabric/live/aegis-resident-network-boundary.mjs",
      launcherPath: "scripts/execution-fabric/live/aegis-remote-dev-network-launcher.mjs",
      identityPath: "config/execution-fabric/aegis-resident-identity.json",
    },
  }
}

function context() {
  const value = policy()
  const policySha256 = sha(canonical(value))
  const activationSha256 = "a".repeat(64)
  const providerSha256 = "b".repeat(64)
  const launcherSha256 = "c".repeat(64)
  const workerSha256 = "d".repeat(64)
  const controlGroupIdentity = { device: "29", inode: "74319", ctimeNs: "1786410000000000000" }
  const ticketConsumptionDirectoryIdentity = inspectReceiptTicketDirectoryIdentity({ device: "29", inode: "88301" })!
  const receipt = {
    schemaVersion: 1,
    proofId: "0f8fad5b-d9cb-469f-a165-70867728950e",
    providerId: value.policyId,
    activationId: "remote-dev-offload-v1-issue-734-single-use-001",
    authorityReference: "issue-734-terrafusion-remote-dev-single-use-001",
    runId: "56b41a96-3bbf-4c80-907b-d37db1437e9d",
    observedAt: "2026-08-11T05:00:00.000Z",
    expiresAt: "2026-08-11T05:00:30.000Z",
    bootId: "11111111-2222-4333-8444-555555555555",
    controlGroup: "/user.slice/user-1001.slice/user@1001.service/app.slice/williamos-aegis-remote-dev.slice",
    controlGroupIdentity,
    nodeId: "aegis",
    account: "williamos-fabric",
    machineIdSha256: value.executionIdentity.machineIdSha256,
    controlPlaneCommit: value.trustedMain.minimumCommit,
    policySha256,
    activationSha256,
    providerSha256,
    launcherSha256,
    workerSha256,
    launchAuthority: { algorithm: "Ed25519", publicKeyPath: "/etc/williamos-fabric/aegis-remote-dev-launch-authority.pem", publicKeySha256: "e".repeat(64) },
    ticketConsumption: {
      directoryPath: "/var/lib/williamos-fabric/remote-dev-launch-tickets",
      directoryIdentity: ticketConsumptionDirectoryIdentity,
      ownerUid: 0,
      writerGid: 1001,
      mode: "3770",
      appendOnly: true,
    },
    enforcementGeneration: {
      generationId: "8f14e45f-ea7b-4f26-8a13-f39c3f73b1b8",
      rulesetSha256: sha(canonicalizeJcs(value.enforcement)),
    },
    enforcement: structuredClone(value.enforcement),
  }
  return {
    policy: value,
    receipt,
    input: {
      policy: value,
      receiptBytes: canonical(receipt),
      receiptFile: { isFile: true, isSymbolicLink: false, nlink: 1, uid: 0, mode: 0o444, parentsRootOwnedAndNotWritable: true },
      now: "2026-08-11T05:00:10.000Z",
      bootId: receipt.bootId,
      enforcedControlGroup: receipt.controlGroup,
      currentControlGroupIdentity: { ...controlGroupIdentity },
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
      identity: { node_id: "aegis", hostname: "aegis", machine_id_sha256: value.executionIdentity.machineIdSha256, agent_identity: "resident-aegis", provider_identity: "resident-aegis" },
      trustedMain: { verified: true, clean: true, trusted_ref: "refs/heads/main", head_commit: value.trustedMain.minimumCommit },
      policySha256,
      activationSha256,
      providerSha256,
      launcherSha256,
      activation: { activationId: receipt.activationId, authorityReference: receipt.authorityReference, runId: receipt.runId, workerSha256, network: { defaultDeny: true, atlasAllowed: false, enforcementProofRequired: true, endpoints: cloneEndpoints() } },
    },
  }
}

function resealReceipt(value: any) {
  const proofId = value.receipt.proofId
  value.receipt.enforcementGeneration.rulesetSha256 = sha(canonicalizeJcs(value.receipt.enforcement))
  value.receiptBytes = canonical(value.receipt)
  expect(value.receipt.proofId).toBe(proofId)
}

describe("resident AEGIS network boundary proof", () => {
  it("accepts only a fresh root-owned attestation for the exact default-deny boundary", () => {
    expect(inspectResidentNetworkBoundaryEvidence(context().input)).toMatchObject({
      status: "RESIDENT_NETWORK_BOUNDARY_VERIFIED",
      executionAuthorized: false,
      defaultDeny: true,
      atlasAllowed: false,
      endpoints,
      proofId: context().receipt.proofId,
    })
  })

  it("binds a fresh receipt to the immutable current cgroup object and enforcement generation", () => {
    expect(inspectResidentNetworkBoundaryEvidence(context().input)).toMatchObject({
      status: "RESIDENT_NETWORK_BOUNDARY_VERIFIED",
      executionAuthorized: false,
    })
  })

  it("rejects a receipt from a replaced cgroup even when boot id and path are unchanged", () => {
    const value: any = context().input
    value.currentControlGroupIdentity = { ...value.currentControlGroupIdentity, inode: "74320", ctimeNs: "1786410001000000000" }
    expect(inspectResidentNetworkBoundaryEvidence(value)).toMatchObject({
      status: "BLOCKED",
      executionAuthorized: false,
      reasons: [{ code: "NETWORK_BOUNDARY_UNPROVEN" }],
    })
  })

  it("binds replay consumption to the current root-owned append-only directory generation", () => {
    expect(inspectResidentNetworkBoundaryEvidence(context().input)).toMatchObject({
      status: "RESIDENT_NETWORK_BOUNDARY_VERIFIED",
      executionAuthorized: false,
      ticketConsumptionDirectoryIdentity: context().receipt.ticketConsumption.directoryIdentity,
    })
  })

  it("allows expected ticket-entry ctime changes while retaining the same append-only directory inode", () => {
    const value: any = context().input
    value.currentTicketConsumptionDirectory.identity.ctimeNs = "1786410000000000200"
    expect(inspectResidentNetworkBoundaryEvidence(value)).toMatchObject({
      status: "RESIDENT_NETWORK_BOUNDARY_VERIFIED",
      executionAuthorized: false,
    })
  })

  it.each([
    ["non-root receipt", (value: any) => { value.receiptFile.uid = 1001 }],
    ["writable receipt", (value: any) => { value.receiptFile.mode = 0o664 }],
    ["unsafe parent", (value: any) => { value.receiptFile.parentsRootOwnedAndNotWritable = false }],
    ["stale receipt", (value: any) => { value.now = "2026-08-11T05:00:31.000Z" }],
    ["other boot", (value: any) => { value.bootId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }],
    ["authorizer scope instead of enforced slice", (value: any) => { value.receipt.controlGroup = value.receipt.controlGroup.replace(/\.slice$/, ".scope") }],
    ["mismatched user slice", (value: any) => { value.receipt.controlGroup = value.receipt.controlGroup.replace("user@1001", "user@1002"); value.enforcedControlGroup = value.receipt.controlGroup }],
    ["other enforced slice", (value: any) => { value.enforcedControlGroup += "-other" }],
    ["recreated ticket directory", (value: any) => { value.currentTicketConsumptionDirectory.identity.inode = "88302" }],
    ["non-root ticket directory", (value: any) => { value.currentTicketConsumptionDirectory.uid = 1001 }],
    ["ticket directory group drift", (value: any) => { value.currentTicketConsumptionDirectory.gid = 1002 }],
    ["ticket directory mode drift", (value: any) => { value.currentTicketConsumptionDirectory.mode = 0o770 }],
    ["ticket directory not append-only", (value: any) => { value.currentTicketConsumptionDirectory.appendOnly = false }],
    ["unsafe ticket directory parent", (value: any) => { value.currentTicketConsumptionDirectory.parentsRootOwnedAndNotWritable = false }],
    ["other machine", (value: any) => { value.identity.machine_id_sha256 = "0".repeat(64) }],
    ["other main", (value: any) => { value.trustedMain.head_commit = "c".repeat(40) }],
    ["other policy bytes", (value: any) => { value.policySha256 = "d".repeat(64) }],
    ["other activation bytes", (value: any) => { value.activationSha256 = "d".repeat(64) }],
    ["other provider bytes", (value: any) => { value.providerSha256 = "d".repeat(64) }],
    ["other launcher bytes", (value: any) => { value.launcherSha256 = "d".repeat(64) }],
    ["default allow", (value: any) => { value.receipt.enforcement.defaultDeny = false }],
    ["direct egress", (value: any) => { value.receipt.enforcement.directNetworkAllowed = true }],
    ["Atlas allowed", (value: any) => { value.receipt.enforcement.atlas.allowed = true }],
    ["Atlas address omitted", (value: any) => { value.receipt.enforcement.atlas.addresses = [] }],
    ["allowlist widened", (value: any) => { value.receipt.enforcement.endpoints.push({ host: "example.com", port: 443, operations: ["other"] }) }],
    ["allowlist port drift", (value: any) => { value.receipt.enforcement.endpoints[0].port = 22 }],
    ["activation network drift", (value: any) => { value.activation.network.endpoints[0].host = "github.com" }],
  ])("fails closed for %s", (_label, mutate) => {
    const value: any = context().input
    value.receipt = JSON.parse(value.receiptBytes.toString("utf8"))
    mutate(value)
    resealReceipt(value)
    delete value.receipt
    expect(inspectResidentNetworkBoundaryEvidence(value)).toMatchObject({ status: "BLOCKED", executionAuthorized: false, reasons: [{ code: "NETWORK_BOUNDARY_UNPROVEN" }] })
  })

  it("rejects non-canonical and duplicate-key receipt bytes", () => {
    const pretty: any = context().input
    pretty.receiptBytes = Buffer.from(`${JSON.stringify(context().receipt, null, 2)}\n`)
    expect(inspectResidentNetworkBoundaryEvidence(pretty)).toMatchObject({ status: "BLOCKED", reasons: [{ code: "NETWORK_BOUNDARY_UNPROVEN" }] })
    const duplicate: any = context().input
    duplicate.receiptBytes = Buffer.from('{"schemaVersion":1,"schemaVersion":1}\n')
    expect(inspectResidentNetworkBoundaryEvidence(duplicate)).toMatchObject({ status: "BLOCKED", reasons: [{ code: "NETWORK_BOUNDARY_UNPROVEN" }] })
  })

  it("does not accept caller-supplied proof data through the live zero-argument provider", () => {
    expect(proveResidentAegisNetworkBoundary).toHaveLength(0)
    return expect(proveResidentAegisNetworkBoundary(context().input as any)).resolves.toMatchObject({ status: "BLOCKED", executionAuthorized: false })
  })
})
