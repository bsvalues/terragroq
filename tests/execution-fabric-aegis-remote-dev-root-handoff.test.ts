import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"

import { canonicalizeJcs } from "../scripts/execution-fabric/canonical-json.mjs"
import {
  buildRootHandoffPlan,
  executeRootHandoffTransaction,
  hasExactStorageMountSemantics,
  inspectRootHandoffBundle,
  isProofWorkerUnitName as isVerifierProofWorkerUnitName,
  validateOwnerAuthority,
  validateRootHandoffManifest,
} from "../scripts/execution-fabric/provision/aegis-remote-dev-root-handoff.mjs"
import { isTrustedAtomicInstallSourceMode } from "../scripts/execution-fabric/provision/aegis-remote-dev-root-os-adapter.mjs"
import { exactLedgerAncestorContract, exactNftBoundaryJson, exactNftBoundaryLines, inspectBrokerReadinessSamples, inspectDurableLedgerReconciliation, inspectExactInertNetworkPredecessor, inspectForcedCommandTransportReconciliation, inspectNftTableList, inspectNoSudoCapabilityEvidence, inspectRootAdapterContract, inspectRootClaimWindow, inspectTrustedRepositoryReconciliation, isProofWorkerUnitName as isAdapterProofWorkerUnitName } from "../scripts/execution-fabric/provision/aegis-remote-dev-root-os-adapter.mjs"
import { allowedHostForOperation, isDeniedDestination } from "../scripts/execution-fabric/provision/assets/aegis-remote-dev-runtime-authority.mjs"

const root = path.resolve(import.meta.dirname, "..")
const manifestPath = path.join(root, "config/execution-fabric/aegis-remote-dev-root-handoff.json")
const loadManifest = () => JSON.parse(fs.readFileSync(manifestPath, "utf8"))
const sha = (bytes: crypto.BinaryLike) => crypto.createHash("sha256").update(bytes).digest("hex")
const rawSha = (file: string) => {
  const trusted = spawnSync("git", ["--no-replace-objects", "show", `HEAD:${file}`], { cwd: root, encoding: null, shell: false, env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" } })
  return sha(trusted.status === 0 ? trusted.stdout : fs.readFileSync(path.join(root, file)))
}
const currentRawSha = (file: string) => sha(fs.readFileSync(path.join(root, file)))

function completeObservation(manifest = loadManifest()) {
  return {
    platform: { os: "linux", effectiveUid: 0, hostname: "aegis", machineIdSha256: manifest.target.machineIdSha256 },
    bootstrap: { verifierRootOwned: true, verifierMode: "0555", ownerPublicKeyRootOwned: true, ownerPublicKeyMode: "0444" },
    trustedMain: { remote: "https://github.com/bsvalues/terragroq.git", ref: "refs/heads/main", minimumCommit: manifest.trustedMain.minimumCommit, authorityCommit: "d".repeat(40), freshRemoteAuthorityEquality: true, exactCleanHead: true, replaceObjectsDisabled: true, configIsolation: true, criticalBytesMatch: true },
    storage: {
      verified: true, mutationRequested: false, backingImageRealPath: manifest.storage.backingImageRealPath,
      backingImageBytes: manifest.storage.backingImageBytes, backingImageOwner: "root", backingImageGroup: "root", backingImageMode: "0600", backingImageNlink: 1,
      backingHostFilesystem: "ext4", backingDevice: "2049", backingInode: "734", backingCtimeNs: "1786497600000000000",
      loopDevice: "/dev/loop7", loopBackingImageRealPath: manifest.storage.backingImageRealPath, mountSource: "/dev/loop7", mountSourceMajorMinor: "7:7",
      loopMajorMinor: "7:7", filesystemType: "xfs", filesystemUuid: manifest.storage.filesystemUuid, filesystemLabel: "AEGIS_RDEV",
      mountPath: "/srv/william", mountOptions: ["rw", "nosuid", "nodev", "relatime", "attr2", "inode64", "prjquota"], projectId: 734,
      projectInherit: true, quotaAccounting: true, quotaEnforcement: true, hardLimitBytes: 85899345920,
    },
    prerequisites: Object.fromEntries(manifest.steps.map((step: { id: string }) => [step.id, "ABSENT"])),
    scheduler: { enabled: false, standingAuthority: false, dispatchOccurred: false },
    closedHash: { changed: false },
  }
}

function signedAuthority(manifest = loadManifest(), overrides: Record<string, unknown> = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
  const payload = {
    schemaVersion: 1,
    authorityId: "b6726cab-1f13-47da-9d25-1a199bb52c0f",
    transactionId: "2ac672df-eb80-48df-a887-e2bc26bf401b",
    operation: "APPLY_PREREQUISITES",
    workOrderId: "WO-TF-REMOTE-DEV-OFFLOAD-001",
    issue: { repository: "bsvalues/terrafusion_os_1.0", number: 734 },
    machineIdSha256: manifest.target.machineIdSha256,
    bootId: "8f8c3601-3767-4d13-9cc6-b3a911a5fba9",
      trustedMainCommit: "d".repeat(40),
    rootHandoffManifestSha256: sha(Buffer.from(canonicalizeJcs(manifest), "utf8")),
    verifierSha256: currentRawSha("scripts/execution-fabric/provision/aegis-remote-dev-root-handoff.mjs"),
    historicalPreflightManifestJcsSha256: manifest.prerequisitePackage.supersededPreflight.manifestJcsSha256,
    appliedAssets: manifest.appliedAssets,
    inputs: {
      hermesTransportPublicKeySha256: "1".repeat(64), hermesTransportKeyFingerprint: "SHA256:real-hermes-key",
      githubAccountPublicKeySha256: "2".repeat(64), githubAccountKeyFingerprint: "SHA256:real-github-key",
      githubAccountPrivateKeySha256: "8".repeat(64), githubHostKnownHostsSha256: "9".repeat(64),
      githubHostKeyFingerprint: "SHA256:real-github-host-key",
      toolchain: {
        git: { version: "2.43.0", source: "PREINSTALLED:/usr/bin/git", sha256: "3".repeat(64) },
        node: { version: "22.18.0", source: "PREINSTALLED:/usr/bin/node", sha256: "4".repeat(64) },
        dotnetSdk: { version: "8.0.423", source: "STAGED:dotnet-sdk-8.0.423-linux-x64.tar.gz", sha256: "5".repeat(64) },
        corepack: { version: "0.34.0", source: "PREINSTALLED:/usr/bin/corepack", sha256: "6".repeat(64) },
        pnpm: { version: "9.0.0", source: "PREINSTALLED:/usr/bin/pnpm", sha256: "7".repeat(64) },
      },
      launchSigningKeyAction: "GENERATE_ON_AEGIS",
      launchSigningPrivateKeySha256: null, launchSigningPublicKeySha256: null, launchSigningKeyFingerprint: null,
    },
    storage: { mode: "VERIFY_ONLY", filesystemUuid: manifest.storage.filesystemUuid, projectId: 734, hardLimitBytes: 85899345920 },
    allowedSteps: manifest.steps.map((step: { id: string }) => step.id),
    rollback: { automatic: false, separateSignedAuthorityRequired: true, preserveEvidence: true, preserveStorage: true },
    issuedAt: "2026-08-11T20:00:00.000Z", expiresAt: "2026-08-11T20:15:00.000Z",
    resumeExpiresAt: "2026-08-11T20:45:00.000Z", singleUse: true,
    ...overrides,
  }
  const bytes = Buffer.from(canonicalizeJcs(payload), "utf8")
  return { envelope: { payload, signature: crypto.sign(null, bytes, privateKey).toString("base64") }, publicKey }
}

describe("AEGIS root-owned prerequisite handoff", () => {
  it("accepts exact root-owned 0400 signed staging inputs for atomic installation", () => {
    expect(isTrustedAtomicInstallSourceMode(0o400)).toBe(true)
    expect(isTrustedAtomicInstallSourceMode(0o444)).toBe(true)
    expect(isTrustedAtomicInstallSourceMode(0o555)).toBe(true)
    expect(isTrustedAtomicInstallSourceMode(0o600)).toBe(false)
  })
  it("adopts only the exact restrictive predecessor with its egress oneshot enabled and inactive", () => {
    const exact = { firstReceiptExact: true, secondReceiptExact: true, nftSemanticExact: true,
      egressEnabledInactive: true, brokerInactiveDisabled: true, gitSocketInactiveDisabled: true,
      gitServiceInactive: true, listenerConnectionsAbsent: true, workerWorkspaceDispatchAbsent: true }
    expect(inspectExactInertNetworkPredecessor(exact)).toBe("RECONCILE_EXACT_INERT_PREDECESSOR")
    expect(inspectExactInertNetworkPredecessor({ ...exact, egressEnabledInactive: false })).toBe("DRIFT")
    expect(inspectExactInertNetworkPredecessor({ ...exact, egressActiveEnabled: true })).toBe("DRIFT")
    const adapter = fs.readFileSync(path.join(root, "scripts/execution-fabric/provision/aegis-remote-dev-root-os-adapter.mjs"), "utf8")
    expect(adapter).toContain("partial-network-inert-afd68274-062e-4b1e-8ff3-a5542898c8e4.json")
    expect(adapter).toContain("a6e5222382cd23682fd9fb887d1baca186a7c2aeef48d8dd69f3a40eb15ef6a1")
  })
  it("binds a stable reviewed package while proving fresh-main ancestry and critical-byte equality", () => {
    const verifier = fs.readFileSync(path.join(root, "scripts/execution-fabric/provision/aegis-remote-dev-root-handoff.mjs"), "utf8")
    const adapter = fs.readFileSync(path.join(root, "scripts/execution-fabric/provision/aegis-remote-dev-root-os-adapter.mjs"), "utf8")
    for (const expected of ["reviewedPackageCommit", "observedFreshMainCommit", "merge-base", "critical bytes differ", "--no-replace-objects"]) expect(verifier).toContain(expected)
    for (const expected of ["reviewedPackageCommit", "observedFreshMainCommit"]) expect(adapter).toContain(expected)
  })
  it("resumes from the durable observed main after harmless current-main advancement", () => {
    const adapter = fs.readFileSync(path.join(root, "scripts/execution-fabric/provision/aegis-remote-dev-root-os-adapter.mjs"), "utf8")
    expect(adapter).toContain("observedFreshMainCommit:existing.observedFreshMainCommit")
    expect(adapter).not.toContain("existing.observedFreshMainCommit===trust.trustedMain.observedFreshMainCommit")
  })
  it("requires stable repeated staged-input evidence with exact diagnostics", () => {
    const source = fs.readFileSync(path.join(root, "scripts/execution-fabric/provision/aegis-remote-dev-root-os-adapter.mjs"), "utf8")
    expect(source).toContain("const first=inspect(),second=inspect()")
    expect(source).toContain("stable signed-input predicate differs")
    expect(source).toContain("expectedSha,expectedMode:mode")
  })
  it("bounds broker readiness and fails closed on timeout", () => {
    expect(inspectBrokerReadinessSamples([false, false, true])).toBe("BROKER_READY")
    expect(inspectBrokerReadinessSamples(Array(50).fill(false))).toBe("BROKER_READINESS_TIMEOUT")
    expect(inspectBrokerReadinessSamples([])).toBe("BROKER_READINESS_UNPROVEN")
    expect(inspectBrokerReadinessSamples(Array(51).fill(false))).toBe("BROKER_READINESS_UNPROVEN")
  })
  it("detects the governed nft table in multiline output", () => {
    expect(inspectNftTableList("table inet foreign\ntable inet williamos_aegis_remote_dev\n")).toBe(true)
    expect(inspectNftTableList("table inet foreign\ntable inet other\n")).toBe(false)
  })
  it("binds the moved endpoints and permits only the exact predecessor transport migration", () => {
    const manifest = validateRootHandoffManifest(loadManifest())
    expect(manifest.target).toMatchObject({ hostname: "aegis", transportAddress: "192.168.88.6" })
    expect(manifest.transport).toEqual({ sourceHost: "hermes", sourceAddress: "192.168.88.9", targetHost: "aegis", targetAddress: "192.168.88.6" })
    const key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixedReviewedKey hermes"
    const command = 'restrict,command="/usr/bin/node /usr/local/libexec/williamos-aegis-remote-dev-ssh-entrypoint.mjs"'
    const expected = `from="192.168.88.9",${command} ${key}\n`
    const predecessor = `from="192.168.1.154",${command} ${key}\n`
    expect(inspectForcedCommandTransportReconciliation({ current: expected, expected, predecessor, currentMetadataExact: true })).toBe("MATCH")
    expect(inspectForcedCommandTransportReconciliation({ current: expected, expected, predecessor, currentMetadataExact: false })).toBe("DRIFT")
    expect(inspectForcedCommandTransportReconciliation({ current: predecessor, expected, predecessor, predecessorMetadataExact: true })).toBe("RECONCILE_EXACT_PREDECESSOR")
    expect(inspectForcedCommandTransportReconciliation({ current: predecessor, expected, predecessor, predecessorMetadataExact: false })).toBe("DRIFT")
    expect(inspectForcedCommandTransportReconciliation({ current: "", expected, predecessor, pathOccupied: false })).toBe("ABSENT")
    expect(inspectForcedCommandTransportReconciliation({ current: "", expected, predecessor, pathOccupied: true })).toBe("DRIFT")
    expect(inspectForcedCommandTransportReconciliation({ current: `${predecessor}ssh-ed25519 foreign\n`, expected, predecessor, pathOccupied: true })).toBe("DRIFT")
    const adapterSource = fs.readFileSync(path.join(root, "scripts/execution-fabric/provision/aegis-remote-dev-root-os-adapter.mjs"), "utf8")
    expect(adapterSource).toContain("exactFile(snapshot, sha(Buffer.from(predecessor)), 0, 0, 0o400)")
    expect(adapterSource).toContain("exactFile(temporary, sha(Buffer.from(line)), 0, 0, 0o444)")
    expect(adapterSource).toContain('current: currentMetadataExact ? expected : predecessorMetadataExact ? predecessor : "OCCUPIED_UNTRUSTED"')
    expect(adapterSource).toContain("const stagedParent = fs.openSync(directory, fs.constants.O_RDONLY); fs.fsyncSync(stagedParent)")
  })

  it("lets each exact authorized key select its forced command without opening account-wide shell access", () => {
    const sshdAsset = fs.readFileSync(path.join(root,
      "scripts/execution-fabric/provision/assets/90-williamos-fabric-remote-dev.conf"), "utf8")
    expect(sshdAsset).toContain(
      "AuthorizedKeysFile /etc/ssh/authorized_keys/williamos-fabric /etc/ssh/authorized_keys/williamos-fabric-standing-hash")
    expect(sshdAsset).not.toMatch(/^\s*ForceCommand\b/m)
    expect(sshdAsset).not.toMatch(/^\s*PermitUserEnvironment\b/m)
    for (const restriction of [
      "PasswordAuthentication no", "KbdInteractiveAuthentication no", "AuthenticationMethods publickey",
      "AllowAgentForwarding no", "AllowTcpForwarding no", "X11Forwarding no", "PermitTTY no",
      "PermitTunnel no", "GatewayPorts no", "PermitUserRC no",
    ]) expect(sshdAsset).toContain(restriction)

    const adapter = fs.readFileSync(path.join(root,
      "scripts/execution-fabric/provision/aegis-remote-dev-root-os-adapter.mjs"), "utf8")
    expect(adapter).toContain('"forcecommand none"')
    expect(adapter).toContain(
      '"authorizedkeysfile /etc/ssh/authorized_keys/williamos-fabric /etc/ssh/authorized_keys/williamos-fabric-standing-hash"')
    expect(adapter).toContain('const STANDING_ROOT_KEY_SHA256 = "d054724aeea3ff42bf646d4d3aed078be21183e3a67c9ae1f8d4768e97dd2967"')
    expect(adapter).toContain('const STANDING_ENTRYPOINT_SHA256 = "ebcf0d068e11c1a3f98b515f9a59a456955d8d30abdbb8bab7897b9b315caf9a"')
    expect(adapter).toContain("exactFile(STANDING_ROOT_KEY_PATH, STANDING_ROOT_KEY_SHA256, 0, 0, 0o444)")
    expect(adapter).toContain("exactFile(STANDING_ENTRYPOINT_PATH, STANDING_ENTRYPOINT_SHA256, 0, 0, 0o555)")
    expect(adapter).toContain("const standingTransportExact = exactFile(STANDING_ROOT_KEY_PATH")
    expect(adapter).toContain("INSTALL_FORCED_COMMAND_TRANSPORT: standingTransportExact && transportLines.expected")
    for (const effectiveRestriction of [
      "allowagentforwarding no", "allowtcpforwarding no", "x11forwarding no", "permittty no",
      "permittunnel no", "gatewayports no", "permituserenvironment no", "permituserrc no",
    ]) expect(adapter).toContain(`"${effectiveRestriction}"`)

    const remoteDevCommand = 'restrict,command="/usr/bin/node /usr/local/libexec/williamos-aegis-remote-dev-ssh-entrypoint.mjs"'
    const standingCommand = 'command="/usr/local/libexec/williamos/aegis-standing-hash-ssh-entrypoint.mjs"'
    expect(adapter).toContain(remoteDevCommand)
    const standingManifest = JSON.parse(fs.readFileSync(path.join(root,
      "config/execution-fabric/aegis-standing-hash-provisioning-package.v1.json"), "utf8"))
    expect(standingManifest.invocationBoundary.authorizedKeyOptions).toContain(standingCommand)
  })
  it("pins the merged prerequisite generation and every applied asset exactly", () => {
    const manifest = validateRootHandoffManifest(loadManifest())
    expect(manifest.trustedMain.minimumCommit).toBe("bcca6069a917d706314f7c8cb7b3cd40cdd910da")
    expect(manifest.prerequisitePackage).toMatchObject({ packageId: "aegis-remote-dev-root-prerequisites-issue-734-v2", semanticSupersession: true, historicalSuccessClaimed: false, supersededPreflight: { manifestJcsSha256: "8b956f9e7ae53cf37ba3d2a916d9848522f159ef17afa8c261e7d1454f397034" } })
    expect(manifest.appliedAssets.length).toBeGreaterThanOrEqual(7)
    for (const asset of manifest.appliedAssets) expect(rawSha(asset.source)).toBe(asset.sha256)
    expect(inspectRootHandoffBundle(root)).toMatchObject({ status: "BUNDLE_INTERNAL_CONSISTENCY_ONLY", externalTrustRootRequired: true, applyAuthorized: false, drift: [] })
  }, 15_000)

  it("rejects manifest, asset, scheduler, standing-authority, and closed-HASH drift", () => {
    for (const mutate of [
      (v: any) => { v.trustedMain.minimumCommit = "0".repeat(40) },
      (v: any) => { v.prerequisitePackage.supersededPreflight.manifestJcsSha256 = "0".repeat(64) },
      (v: any) => { v.appliedAssets[0].sha256 = "0".repeat(64) },
      (v: any) => { v.posture.generalSchedulerEnabled = true },
      (v: any) => { v.posture.standingAegisAuthorityEnabled = true },
      (v: any) => { v.posture.closedHashMutationAllowed = true },
    ]) {
      const value = loadManifest(); mutate(value)
      expect(() => validateRootHandoffManifest(value)).toThrow()
    }
  })

  it("requires signed exact single-use owner authority and rejects placeholders, drift, expiry, and reuse", () => {
    const manifest = loadManifest(); const good = signedAuthority(manifest)
    expect(validateOwnerAuthority(manifest, good.envelope, good.publicKey, "2026-08-11T20:05:00.000Z", false)).toMatchObject({ status: "OWNER_AUTHORITY_VERIFIED", applyAuthorized: false })
    const cases = [
      { inputs: { ...good.envelope.payload.inputs, hermesTransportKeyFingerprint: "SHA256:owner-approved-hermes-transport-key" } },
      { machineIdSha256: "0".repeat(64) },
      { verifierSha256: "0".repeat(64) },
      { allowedSteps: good.envelope.payload.allowedSteps.slice(1) },
      { storage: { ...good.envelope.payload.storage, mode: "MUTATE" } },
    ]
    for (const changed of cases) {
      const candidate = signedAuthority(manifest, changed)
      expect(validateOwnerAuthority(manifest, candidate.envelope, candidate.publicKey, "2026-08-11T20:05:00.000Z", false).status).toBe("BLOCKED")
    }
    expect(validateOwnerAuthority(manifest, good.envelope, good.publicKey, "2026-08-11T20:16:00.000Z", false).status).toBe("OWNER_AUTHORITY_RESUME_ONLY_VERIFIED")
    expect(validateOwnerAuthority(manifest, good.envelope, good.publicKey, "2026-08-11T20:05:00.000Z", true).reasonCode).toBe("OWNER_AUTHORITY_CONSUMED")
  })

  it("blocks any storage absence or drift and never plans format, mount, remount, quota, or workspace creation", () => {
    const manifest = loadManifest()
    for (const mutate of [
      (o: any) => { o.storage.verified = false },
      (o: any) => { o.storage.mutationRequested = true },
      (o: any) => { o.storage.loopBackingImageRealPath = "/other" },
      (o: any) => { o.storage.mountSourceMajorMinor = "7:8" },
      (o: any) => { o.storage.mountOptions.push("noexec") },
      (o: any) => { o.storage.quotaEnforcement = false },
      (o: any) => { o.storage.hardLimitBytes = 1 },
    ]) {
      const observed = completeObservation(manifest); mutate(observed)
      expect(buildRootHandoffPlan(manifest, observed)).toMatchObject({ status: "BLOCKED", reasonCode: "STORAGE_VERIFY_ONLY_DRIFT", mutations: [] })
    }
    const plan = buildRootHandoffPlan(manifest, completeObservation(manifest))
    expect(plan.status).toBe("READY_FOR_SIGNED_AUTHORITY")
    expect(plan.mutations.map((entry: any) => entry.id)).not.toEqual(expect.arrayContaining(["FORMAT_STORAGE", "MOUNT_STORAGE", "REMOUNT_STORAGE", "CREATE_WORKSPACE", "SET_QUOTA"]))
    expect(hasExactStorageMountSemantics(["rw", "nosuid", "nodev", "relatime", "attr2", "inode64", "prjquota"])).toBe(true)
    expect(hasExactStorageMountSemantics(["rw", "nosuid", "nodev", "prjquota", "noexec"])).toBe(false)
  })

  it("classifies only UUID-named transient proof workers as recovery blockers", () => {
    const transient = "williamos-aegis-remote-dev-7bc3ef49-0812-4dc8-a679-ff359887ca1d.service"
    for (const classifier of [isVerifierProofWorkerUnitName, isAdapterProofWorkerUnitName]) {
      expect(classifier(transient)).toBe(true)
      expect(classifier("williamos-aegis-remote-dev-broker.service")).toBe(false)
      expect(classifier("williamos-aegis-remote-dev-egress.service")).toBe(false)
      expect(classifier("williamos-aegis-remote-dev-git-broker.service")).toBe(false)
    }
  })

  it("fails closed on root, Linux, machine, trusted-main, key, toolchain, and prerequisite drift", () => {
    const manifest = loadManifest()
    const mutations = [
      (o: any) => { o.platform.effectiveUid = 1000 },
      (o: any) => { o.platform.os = "windows" },
      (o: any) => { o.platform.machineIdSha256 = "0".repeat(64) },
      (o: any) => { o.trustedMain.authorityCommit = "0" },
      (o: any) => { o.trustedMain.replaceObjectsDisabled = false },
      (o: any) => { o.bootstrap.verifierRootOwned = false },
      (o: any) => { o.scheduler.enabled = true },
      (o: any) => { o.closedHash.changed = true },
      (o: any) => { o.prerequisites.INSTALL_PINNED_TOOLCHAIN = "DRIFT" },
    ]
    for (const mutate of mutations) {
      const observed = completeObservation(manifest); mutate(observed)
      expect(buildRootHandoffPlan(manifest, observed).status).toBe("BLOCKED")
    }
  })

  it("consumes once before mutation, journals intent/applied records, and resumes only the same transaction", async () => {
    const manifest = loadManifest(); const observed = completeObservation(manifest); const signed = signedAuthority(manifest)
    const state = { claimed: false, records: [] as any[], effects: new Set<string>(), lease: false, receiptHead: null as string | null }
    const adapter = {
      acquireLease: async () => { if (state.lease) return false; state.lease = true; return true },
      releaseLease: async () => { state.lease = false },
      reprove: async () => observed,
      claim: async () => { if (state.claimed) return false; state.claimed = true; return true },
      append: async (record: any) => { state.records.push(record) },
      effectApplied: async (id: string) => state.effects.has(id),
      apply: async (id: string) => { state.effects.add(id) },
      verify: async () => {
        const verified = completeObservation(manifest)
        verified.prerequisites = Object.fromEntries(manifest.steps.map((step: { id: string }) => [step.id, "MATCH"]))
        return verified
      },
      publishSuccess: async (_payload: any, head: string) => { state.receiptHead = head },
    }
    const first = await executeRootHandoffTransaction(manifest, signed.envelope, signed.publicKey, "2026-08-11T20:05:00.000Z", adapter)
    expect(first).toMatchObject({ status: "PREREQUISITES_APPLIED_VERIFIED", executionAuthorized: false })
    expect(state.records[0].phase).toBe("AUTHORITY_CONSUMED")
    expect(state.records.some((record) => record.phase === "STEP_INTENT")).toBe(true)
    expect(state.records.at(-1).phase).toBe("COMMITTED")
    expect(state.receiptHead).toBe(state.records.at(-1).recordSha256)
    const again = await executeRootHandoffTransaction(manifest, signed.envelope, signed.publicKey, "2026-08-11T20:06:00.000Z", adapter)
    expect(again.reasonCode).toBe("OWNER_AUTHORITY_CONSUMED")
  })

  it("keeps failure partial and inert and requires separate signed rollback authority", async () => {
    const manifest = loadManifest(); const signed = signedAuthority(manifest); let claimed = false
    const adapter = {
      acquireLease: async () => true, releaseLease: async () => undefined, reprove: async () => completeObservation(manifest),
      claim: async () => { claimed = true; return true }, append: async () => undefined, effectApplied: async () => false,
      apply: async () => { throw new Error("synthetic failure") }, verify: async () => completeObservation(manifest),
      publishSuccess: async () => { throw new Error("must not publish") },
    }
    const result = await executeRootHandoffTransaction(manifest, signed.envelope, signed.publicKey, "2026-08-11T20:05:00.000Z", adapter)
    expect(claimed).toBe(true)
    expect(result).toMatchObject({ status: "BLOCKED", reasonCode: "PARTIAL_APPLY_INERT", executionAuthorized: false, rollbackAuthorized: false })
  })

  it("resumes the same consumed transaction after an effect-before-applied crash without reapplying the effect", async () => {
    const manifest = loadManifest(); const signed = signedAuthority(manifest); const observed = completeObservation(manifest)
    const state = { claimed: false, records: [] as any[], effects: new Set<string>(), crash: true, applyCalls: 0 }
    const adapter = {
      acquireLease: async () => true, releaseLease: async () => undefined,
      reprove: async () => {
        const value = structuredClone(observed)
        for (const id of state.effects) value.prerequisites[id] = "MATCH"
        return value
      },
      claim: async () => state.claimed ? { resume: true } : (state.claimed = true),
      recover: async () => ({ records: state.records, committed: false }),
      append: async (record: any) => {
        if (state.crash && record.phase === "STEP_APPLIED") throw new Error("synthetic process loss")
        if (state.crash && record.phase === "FAILED_PARTIAL") throw new Error("process is gone")
        state.records.push(record)
      },
      effectApplied: async (id: string) => state.effects.has(id),
      apply: async (id: string) => { state.applyCalls += 1; state.effects.add(id) },
      verify: async () => { const value = completeObservation(manifest); value.prerequisites = Object.fromEntries(manifest.steps.map((step: { id: string }) => [step.id, "MATCH"])); return value },
      publishSuccess: async () => undefined,
    }
    const firstResult = await executeRootHandoffTransaction(manifest, signed.envelope, signed.publicKey, "2026-08-11T20:05:00.000Z", adapter)
    expect(firstResult).toMatchObject({ status: "BLOCKED", reasonCode: "PARTIAL_APPLY_INERT" })
    expect(state.applyCalls).toBe(1)
    state.crash = false
    expect(await executeRootHandoffTransaction(manifest, signed.envelope, signed.publicKey, "2026-08-11T20:06:00.000Z", adapter)).toMatchObject({ status: "PREREQUISITES_APPLIED_VERIFIED" })
    expect(state.applyCalls).toBe(manifest.steps.length)
    const firstIntent = state.records.findIndex((record) => record.phase === "STEP_INTENT")
    expect(state.records[firstIntent + 1]).toMatchObject({ phase: "STEP_APPLIED", detail: { stepId: manifest.steps[0].id } })
  })

  it("allows only the exact consumed transaction to resume after the initial authority window", async () => {
    const manifest = loadManifest(); const signed = signedAuthority(manifest); const observed = completeObservation(manifest)
    const state = { claimed: true, claimCalls: [] as boolean[], records: [] as any[] }
    const verified = completeObservation(manifest)
    verified.prerequisites = Object.fromEntries(manifest.steps.map((step: { id: string }) => [step.id, "MATCH"]))
    const adapter = {
      acquireLease: async () => true, releaseLease: async () => undefined, reprove: async () => observed,
      claim: async (_authorityId: string, _transactionId: string, allowCreate: boolean) => {
        state.claimCalls.push(allowCreate)
        return state.claimed ? { resume: true } : (allowCreate ? (state.claimed = true) : false)
      },
      recover: async () => ({ records: state.records, committed: false }),
      append: async (record: any) => { state.records.push(record) }, effectApplied: async () => true,
      apply: async () => { throw new Error("must not apply") }, verify: async () => verified, publishSuccess: async () => undefined,
    }
    expect(await executeRootHandoffTransaction(manifest, signed.envelope, signed.publicKey, "2026-08-11T20:20:00.000Z", adapter)).toMatchObject({ status: "PREREQUISITES_APPLIED_VERIFIED" })
    expect(state.claimCalls).toEqual([false])

    state.claimed = false; state.records = []; state.claimCalls = []
    expect(await executeRootHandoffTransaction(manifest, signed.envelope, signed.publicKey, "2026-08-11T20:20:00.000Z", adapter)).toMatchObject({ status: "BLOCKED", reasonCode: "OWNER_AUTHORITY_EXPIRED" })
    expect(state.claimCalls).toEqual([false])
    expect(await executeRootHandoffTransaction(manifest, signed.envelope, signed.publicKey, "2026-08-11T20:45:00.000Z", adapter)).toMatchObject({ status: "BLOCKED", reasonCode: "OWNER_AUTHORITY_EXPIRED" })
  })

  it("re-samples trusted time at the durable claim boundary and rejects delayed create or resume", async () => {
    const manifest = loadManifest(); const signed = signedAuthority(manifest); const observed = completeObservation(manifest)
    expect(inspectRootClaimWindow(signed.envelope.payload, "2026-08-11T20:14:59.999Z")).toEqual({ createAllowed: true, resumeAllowed: true })
    expect(inspectRootClaimWindow(signed.envelope.payload, "2026-08-11T20:15:00.000Z")).toEqual({ createAllowed: false, resumeAllowed: true })
    expect(inspectRootClaimWindow(signed.envelope.payload, "2026-08-11T20:45:00.000Z")).toEqual({ createAllowed: false, resumeAllowed: false })
    const delayedAdapter = (boundaryNow: string, claimed: boolean) => ({
      acquireLease: async () => true, releaseLease: async () => undefined, reprove: async () => observed,
      claim: async () => {
        const window = inspectRootClaimWindow(signed.envelope.payload, boundaryNow)
        if (!window.resumeAllowed || (!claimed && !window.createAllowed)) return { expired: true }
        return claimed ? { resume: true } : true
      },
      recover: async () => ({ records: [], committed: false }), append: async () => undefined,
      effectApplied: async () => true, apply: async () => undefined, verify: async () => observed, publishSuccess: async () => undefined,
    })
    expect(await executeRootHandoffTransaction(manifest, signed.envelope, signed.publicKey, "2026-08-11T20:14:59.000Z", delayedAdapter("2026-08-11T20:15:00.000Z", false))).toMatchObject({ status: "BLOCKED", reasonCode: "OWNER_AUTHORITY_EXPIRED" })
    expect(await executeRootHandoffTransaction(manifest, signed.envelope, signed.publicKey, "2026-08-11T20:20:00.000Z", delayedAdapter("2026-08-11T20:45:00.000Z", true))).toMatchObject({ status: "BLOCKED", reasonCode: "OWNER_AUTHORITY_EXPIRED" })
  })

  it("resumes from durable post-apply verification by committing without duplicating the verification record", async () => {
    const manifest = loadManifest(); const signed = signedAuthority(manifest); let claimed = false; let crash = true
    const records: any[] = []
    const verified = completeObservation(manifest)
    verified.prerequisites = Object.fromEntries(manifest.steps.map((step: { id: string }) => [step.id, "MATCH"]))
    const adapter = {
      acquireLease: async () => true, releaseLease: async () => undefined, reprove: async () => verified,
      claim: async () => claimed ? { resume: true } : (claimed = true),
      recover: async () => ({ records, committed: false }),
      append: async (record: any) => {
        if (crash && (record.phase === "COMMITTED" || record.phase === "FAILED_PARTIAL")) throw new Error("synthetic process loss")
        records.push(record)
      },
      effectApplied: async () => true, apply: async () => { throw new Error("must not apply") }, verify: async () => verified,
      publishSuccess: async () => undefined,
    }
    expect(await executeRootHandoffTransaction(manifest, signed.envelope, signed.publicKey, "2026-08-11T20:05:00.000Z", adapter)).toMatchObject({ status: "BLOCKED", reasonCode: "PARTIAL_APPLY_INERT" })
    expect(records.filter((record) => record.phase === "POST_APPLY_VERIFIED")).toHaveLength(1)
    crash = false
    expect(await executeRootHandoffTransaction(manifest, signed.envelope, signed.publicKey, "2026-08-11T20:06:00.000Z", adapter)).toMatchObject({ status: "PREREQUISITES_APPLIED_VERIFIED" })
    expect(records.filter((record) => record.phase === "POST_APPLY_VERIFIED")).toHaveLength(1)
    expect(records.at(-1).phase).toBe("COMMITTED")
  })

  it("refuses commit when current prerequisite state disappears after durable post-apply verification", async () => {
    const manifest = loadManifest(); const signed = signedAuthority(manifest); let claimed = false; let crash = true; let drift = false
    const records: any[] = []
    const observation = () => { const value = completeObservation(manifest); value.prerequisites = Object.fromEntries(manifest.steps.map((step: { id: string }) => [step.id, "MATCH"])); if (drift) value.prerequisites[manifest.steps[0].id] = "ABSENT"; return value }
    const adapter = {
      acquireLease: async () => true, releaseLease: async () => undefined, reprove: async () => observation(),
      claim: async () => claimed ? { resume: true } : (claimed = true), recover: async () => ({ records, committed: false }),
      append: async (record: any) => { if (crash && (record.phase === "COMMITTED" || record.phase === "FAILED_PARTIAL")) throw new Error("synthetic process loss"); records.push(record) },
      effectApplied: async () => true, apply: async () => { throw new Error("must not apply") }, verify: async () => observation(), publishSuccess: async () => { throw new Error("must not publish") },
    }
    expect(await executeRootHandoffTransaction(manifest, signed.envelope, signed.publicKey, "2026-08-11T20:05:00.000Z", adapter)).toMatchObject({ status: "BLOCKED", reasonCode: "PARTIAL_APPLY_INERT" })
    drift = true; crash = false
    expect(await executeRootHandoffTransaction(manifest, signed.envelope, signed.publicKey, "2026-08-11T20:06:00.000Z", adapter)).toMatchObject({ status: "BLOCKED", reasonCode: "PARTIAL_APPLY_INERT" })
    expect(records.some((record) => record.phase === "COMMITTED")).toBe(false)
  })

  it("accepts only an exact conclusive sudo denial and rejects password, signal, or ambiguous errors", () => {
    expect(inspectNoSudoCapabilityEvidence({ status: 1, signal: null, error: null, stdout: "", stderr: "User williamos-fabric is not allowed to run sudo on aegis.\n" })).toBe(true)
    expect(inspectNoSudoCapabilityEvidence({ status: 1, signal: null, error: null, stdout: "", stderr: "Sorry, user williamos-fabric may not run sudo on aegis.\n" })).toBe(true)
    expect(inspectNoSudoCapabilityEvidence({ status: 0, signal: null, error: null, stdout: "User williamos-fabric is not allowed to run sudo on aegis.\n", stderr: "" })).toBe(true)
    for (const value of [
      { status: 0, signal: null, error: null, stdout: "allowed", stderr: "" },
      { status: 0, signal: null, error: null, stdout: "", stderr: "User williamos-fabric is not allowed to run sudo on aegis.\n" },
      { status: 1, signal: null, error: null, stdout: "", stderr: "a password is required\n" },
      { status: 1, signal: "SIGTERM", error: null, stdout: "", stderr: "User williamos-fabric is not allowed to run sudo on aegis.\n" },
      { status: 1, signal: null, error: new Error("spawn failed"), stdout: "", stderr: "User williamos-fabric is not allowed to run sudo on aegis.\n" },
      { status: 2, signal: null, error: null, stdout: "", stderr: "User williamos-fabric is not allowed to run sudo on aegis.\n" },
    ]) expect(inspectNoSudoCapabilityEvidence(value)).toBe(false)
  })

  it("isolates trusted remote-development repositories from the preserved standing runtime root", () => {
    const prerequisite = JSON.parse(fs.readFileSync(path.join(root, "config/execution-fabric/aegis-remote-dev-prerequisites.json"), "utf8"))
    const adapter = fs.readFileSync(path.join(root, "scripts/execution-fabric/provision/aegis-remote-dev-root-os-adapter.mjs"), "utf8")
    const report = fs.readFileSync(path.join(root, "docs/reports/WO-TF-REMOTE-DEV-OFFLOAD-001-prerequisite-provisioning.md"), "utf8")
    expect(prerequisite.repositories.controlPlane.path).toBe("/var/lib/williamos-remote-dev/control/terragroq")
    expect(prerequisite.repositories.targetMirror.path).toBe("/var/lib/williamos-remote-dev/repositories/terrafusion_os_1.0.git")
    expect(adapter).toContain('const CONTROL_REPOSITORY = "/var/lib/williamos-remote-dev/control/terragroq"')
    expect(adapter).toContain('const TARGET_MIRROR = "/var/lib/williamos-remote-dev/repositories/terrafusion_os_1.0.git"')
    expect(adapter).toContain("const controlExists = lexists(control); const mirrorExists = lexists(mirror)")
    expect(adapter).toContain("parentsExact: trustedRepositoryParents()")
    expect(adapter).not.toContain("const controlExists = fs.existsSync(control)")
    expect(adapter).not.toContain('/var/lib/williamos/fabric/workspaces/terragroq')
    expect(adapter).not.toContain('/var/lib/williamos/fabric/repositories/terrafusion_os_1.0.git')
    const repositoryFunction = adapter.slice(adapter.indexOf("function repositoryState"), adapter.indexOf("function rootAssetsState"))
    expect(repositoryFunction.indexOf("try {")).toBeLessThan(repositoryFunction.indexOf("const controlExists = lexists(control)"))
    expect(report).toContain("`1fb6fde76456483a34166b67b6b4413d05c9d69261223f2315d2718de64c359c`")
    expect(report).not.toContain("`cf39e367f9f5437d43f7d93456b16414f5aa47c44954e59b0ecf9b8b89018d6a`")
  })

  it("treats only two truly absent repositories under safe parents as reconcilable", () => {
    expect(inspectTrustedRepositoryReconciliation({ parentsExact: true, controlExists: false, controlExact: false, mirrorExists: false, mirrorExact: false })).toBe("ABSENT")
    expect(inspectTrustedRepositoryReconciliation({ parentsExact: true, controlExists: true, controlExact: true, mirrorExists: true, mirrorExact: true })).toBe("MATCH")
    for (const state of [
      { parentsExact: false, controlExists: false, controlExact: false, mirrorExists: false, mirrorExact: false },
      { parentsExact: true, controlExists: true, controlExact: false, mirrorExists: false, mirrorExact: false },
      { parentsExact: true, controlExists: true, controlExact: true, mirrorExists: false, mirrorExact: false },
      { parentsExact: true, controlExists: false, controlExact: false, mirrorExists: true, mirrorExact: true },
      { parentsExact: true, controlExists: true, controlExact: true, mirrorExists: true, mirrorExact: false },
      { parentsExact: true, controlExists: undefined, controlExact: false, mirrorExists: false, mirrorExact: false },
    ]) expect(inspectTrustedRepositoryReconciliation(state)).toBe("DRIFT")
  })

  it("reconciles only an exact preserved closed HASH ledger when the new ticket directory alone is absent", () => {
    const exactAncestors = [
      { path: "/var", uid: 0, gid: 0, mode: 0o755, directory: true, symlink: false },
      { path: "/var/lib", uid: 0, gid: 0, mode: 0o755, directory: true, symlink: false },
      { path: "/var/lib/williamos", uid: 999, gid: 987, mode: 0o750, directory: true, symlink: false },
      { path: "/var/lib/williamos/fabric", uid: 999, gid: 987, mode: 0o700, directory: true, symlink: false },
      { path: "/var/lib/williamos/fabric/ledger", uid: 999, gid: 987, mode: 0o700, directory: true, symlink: false },
    ]
    expect(exactLedgerAncestorContract(exactAncestors, 999, 987)).toBe(true)
    expect(exactLedgerAncestorContract(exactAncestors.map((entry) => entry.path.endsWith("/fabric") ? { ...entry, uid: 0 } : entry), 999, 987)).toBe(false)
    expect(exactLedgerAncestorContract(exactAncestors.map((entry) => entry.path.endsWith("/fabric") ? { ...entry, mode: 0o770 } : entry), 999, 987)).toBe(false)
    expect(exactLedgerAncestorContract(exactAncestors.map((entry) => entry.path.endsWith("/fabric") ? { ...entry, symlink: true } : entry), 999, 987)).toBe(false)
    const adapter = fs.readFileSync(path.join(root, "scripts/execution-fabric/provision/aegis-remote-dev-root-os-adapter.mjs"), "utf8")
    expect(adapter).toContain('ticketExists: lexists("/var/lib/williamos-fabric/remote-dev-launch-tickets")')
    expect(adapter).not.toContain('ticketExists: fs.existsSync("/var/lib/williamos-fabric/remote-dev-launch-tickets")')
    expect(inspectDurableLedgerReconciliation({ ledgerExact: true, ledgerExists: true, ledgerRecordsExact: true, ticketExact: false, ticketExists: false })).toBe("ABSENT")
    expect(inspectDurableLedgerReconciliation({ ledgerExact: true, ledgerExists: true, ledgerRecordsExact: true, ticketExact: true, ticketExists: true })).toBe("MATCH")
    for (const state of [
      { ledgerExact: false, ledgerExists: false, ledgerRecordsExact: false, ticketExact: false, ticketExists: false },
      { ledgerExact: false, ledgerExists: true, ledgerRecordsExact: false, ticketExact: false, ticketExists: false },
      { ledgerExact: true, ledgerExists: true, ledgerRecordsExact: false, ticketExact: false, ticketExists: false },
      { ledgerExact: true, ledgerExists: true, ledgerRecordsExact: true, ticketExact: false, ticketExists: true },
      { ledgerExact: false, ledgerExists: false, ledgerRecordsExact: false, ticketExact: true, ticketExists: true },
      { ledgerExact: false, ledgerExists: true, ledgerRecordsExact: false, ticketExact: true, ticketExists: true },
      { ledgerExact: true, ledgerExists: false, ledgerRecordsExact: true, ticketExact: true, ticketExists: true },
      { ledgerExact: true, ledgerExists: true, ledgerRecordsExact: true, ticketExact: true, ticketExists: false },
      { ledgerExact: true, ledgerExists: true, ledgerRecordsExact: true, ticketExact: false, ticketExists: undefined },
    ]) expect(inspectDurableLedgerReconciliation(state)).toBe("DRIFT")
  })

  it("ships an exact dual-stack default-deny policy broker with Atlas denied and no fail-open delete/apply gap", () => {
    const broker = fs.readFileSync(path.join(root, "scripts/execution-fabric/provision/assets/aegis-remote-dev-egress-broker.mjs"), "utf8")
    const runtimeAuthority = fs.readFileSync(path.join(root, "scripts/execution-fabric/provision/assets/aegis-remote-dev-runtime-authority.mjs"), "utf8")
    const enforcer = fs.readFileSync(path.join(root, "scripts/execution-fabric/provision/assets/aegis-remote-dev-egress-enforcer.mjs"), "utf8")
    expect(enforcer).toContain("fixed nft enforcement failed: status=")
    expect(enforcer).toContain("process.stderr.write")
    expect(enforcer).toContain("/run/williamos-aegis-remote-dev-egress/egress-enforcement-${process.pid}.nft")
    expect(enforcer).toContain("O_CREAT | fs.constants.O_EXCL")
    expect(enforcer).not.toContain('["-f", "-"]')
    const service = fs.readFileSync(path.join(root, "scripts/execution-fabric/provision/assets/williamos-aegis-remote-dev-egress.service"), "utf8")
    expect(service).toContain("RuntimeDirectory=williamos-aegis-remote-dev-egress")
    expect(service).toContain("ReadWritePaths=/run/williamos-aegis-remote-dev-egress")
    const nft = fs.readFileSync(path.join(root, "scripts/execution-fabric/provision/assets/williamos-aegis-remote-dev-egress.nft"), "utf8")
    for (const endpoint of ["ssh.github.com", "api.github.com", "api.nuget.org", "globalcdn.nuget.org"]) expect(broker).toContain(endpoint)
    expect(runtimeAuthority).toContain('normalized === "192.168.1.156"')
    expect(runtimeAuthority).toContain("mappedIpv4")
    expect(broker).not.toContain('delete table')
    expect(enforcer).toContain("flush chain inet")
    expect(enforcer).not.toContain("delete table")
    expect(service).toContain("ExecStop=/usr/bin/node /usr/local/libexec/williamos-aegis-remote-dev-egress-enforcer.mjs --enforce")
    expect(nft).toContain('meta skuid "williamos-fabric" ip daddr 192.168.1.156 reject')
    expect(nft).toContain('meta skuid "williamos-fabric" ip6 daddr ::ffff:192.168.1.156 reject')
    const fabricProxy = 'meta skuid "williamos-fabric" ip daddr 127.0.0.1 tcp dport 17734 accept'
    const gitBrokerProxy = 'meta skuid "williamos-git-broker" ip daddr 127.0.0.1 tcp dport 17734 accept'
    const allOtherUsersDenied = 'ip daddr 127.0.0.1 tcp dport 17734 reject'
    expect(nft).toContain(fabricProxy)
    expect(nft).toContain(gitBrokerProxy)
    expect(nft.indexOf(fabricProxy)).toBeLessThan(nft.indexOf(allOtherUsersDenied))
    expect(nft.indexOf(gitBrokerProxy)).toBeLessThan(nft.indexOf(allOtherUsersDenied))
    expect(nft.match(/meta skuid "williamos-fabric" reject/g)).toHaveLength(1)
    expect(enforcer).toContain('meta skuid "williamos-git-broker" ip daddr 127.0.0.1 tcp dport 17734 accept')
    const exactLiveLines = nft.split(/\r?\n/).map((line) => line.trim().replace(/\s+/g, " ")).filter(Boolean)
    expect(exactNftBoundaryLines(exactLiveLines)).toBe(true)
    for (const drift of [
      exactLiveLines.filter((line) => !line.includes('skuid "williamos-git-broker"')),
      exactLiveLines.filter((line) => !line.includes('skuid "williamos-fabric" ip daddr 127.0.0.1')),
      [...exactLiveLines.slice(0, 6), exactLiveLines[7], exactLiveLines[6], ...exactLiveLines.slice(8)],
      [...exactLiveLines.slice(0, -2), 'meta skuid "other" accept', ...exactLiveLines.slice(-2)],
    ]) expect(exactNftBoundaryLines(drift)).toBe(false)
    const uid = (right: number) => ({ match: { op: "==", left: { meta: { key: "skuid" } }, right } })
    const ip = (protocol: string, right: string) => ({ match: { op: "==", left: { payload: { protocol, field: "daddr" } }, right } })
    const port = { match: { op: "==", left: { payload: { protocol: "tcp", field: "dport" } }, right: 17734 } }
    const rule = (expr: any[]) => ({ rule: { family: "inet", table: "williamos_aegis_remote_dev", chain: "output", expr } })
    const semantic = [{ table: { family: "inet", name: "williamos_aegis_remote_dev" } }, { chain: { family: "inet", table: "williamos_aegis_remote_dev", name: "output", type: "filter", hook: "output", prio: 0, policy: "accept" } },
      rule([uid(999), ip("ip", "192.168.1.156"), { reject: { type: "icmp", expr: "port-unreachable" } }]), rule([uid(999), ip("ip6", "::ffff:192.168.1.156"), { reject: { type: "icmpv6", expr: "port-unreachable" } }]), rule([uid(999), ip("ip", "127.0.0.1"), port, { accept: null }]), rule([uid(995), ip("ip", "127.0.0.1"), port, { accept: null }]), rule([ip("ip", "127.0.0.1"), port, { reject: { type: "icmp", expr: "port-unreachable" } }]), rule([uid(999), { reject: { type: "icmpx", expr: "port-unreachable" } }])]
    expect(exactNftBoundaryJson(semantic, 999, 995)).toBe(true)
    expect(exactNftBoundaryJson(semantic, 998, 995)).toBe(false)
    expect(exactNftBoundaryJson(semantic, 999, 999)).toBe(false)
    expect(exactNftBoundaryJson(semantic, 0, 995)).toBe(false)
    expect(exactNftBoundaryJson(semantic, -1, 995)).toBe(false)
  })

  it("scopes every CONNECT destination to the signed operation and rejects private or mapped-private destinations", () => {
    expect(allowedHostForOperation("CREATE_WORKSPACE", "ssh.github.com")).toBe(true)
    expect(allowedHostForOperation("RESTORE_DOTNET", "api.nuget.org")).toBe(true)
    expect(allowedHostForOperation("RESTORE_DOTNET", "globalcdn.nuget.org")).toBe(true)
    expect(allowedHostForOperation("PUSH_AUTHORIZED_BRANCH", "ssh.github.com")).toBe(true)
    expect(allowedHostForOperation("BUILD_DOTNET_RELEASE", "ssh.github.com")).toBe(false)
    expect(allowedHostForOperation("RESTORE_DOTNET", "ssh.github.com")).toBe(false)
    for (const address of ["192.168.1.156", "::ffff:192.168.1.156", "::ffff:c0a8:019c", "10.0.0.1", "100.64.0.1", "127.0.0.1", "172.16.0.1", "169.254.1.1", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "fc00::1", "fd00::1", "fe80::1", "::1"]) {
      expect(isDeniedDestination(address)).toBe(true)
    }
    const authority = fs.readFileSync(path.join(root, "scripts/execution-fabric/provision/assets/aegis-remote-dev-runtime-authority.mjs"), "utf8")
    expect(authority).toContain("const current = Date.now()")
    expect(authority).toContain("current >= expires")
    expect(authority).toContain("continueConnectAuthorization")
    expect(authority).toContain("issued + 5_400_000")
    expect(isDeniedDestination("140.82.112.36")).toBe(false)
    expect(isDeniedDestination("2606:50c0:8000::154")).toBe(false)
  })

  it("keeps GitHub private credentials outside worker-readable configuration and uses a signed PUSH broker", () => {
    const ssh = fs.readFileSync(path.join(root, "scripts/execution-fabric/provision/assets/90-williamos-aegis-github.conf"), "utf8")
    const worker = fs.readFileSync(path.join(root, "scripts/execution-fabric/live/aegis-remote-dev-worker.sh"), "utf8")
    const launcher = fs.readFileSync(path.join(root, "scripts/execution-fabric/live/aegis-remote-dev-network-launcher.mjs"), "utf8")
    expect(ssh).not.toContain("github-account.key")
    expect(worker).not.toContain('push origin "HEAD:refs/heads/$BRANCH"')
    expect(worker).toContain("williamos-aegis-remote-dev-git-client.mjs")
    expect(launcher).toContain("WILLIAMOS_NETWORK_TICKET_B64")
    expect(launcher).toContain("WILLIAMOS_NETWORK_PACKET_B64")
    expect(launcher).toContain('bound.operation === "RESTORE_DOTNET"')
    expect(launcher).toContain("HTTPS_PROXY: proxy")
    const dotnet = fs.readFileSync(path.join(root, "scripts/execution-fabric/provision/assets/williamos-dotnet-broker-wrapper"), "utf8")
    expect(dotnet).toContain('"${HTTPS_PROXY:-}" == "$expected"')
    expect(dotnet).toContain('"${https_proxy:-}" == "$expected"')
    expect(dotnet).not.toContain("export HTTPS_PROXY=http://127.0.0.1:17734")
    const broker = fs.readFileSync(path.join(root, "scripts/execution-fabric/provision/assets/aegis-remote-dev-egress-broker.mjs"), "utf8")
    expect(broker).toContain('decoded.subarray(0, separator).toString("ascii") !== "WilliamOS"')
    expect(broker).toContain("separator !== 9")
    expect(broker).toContain("authorizeBrokerConnect(authorization.ticket, authorization.operation")
    expect(broker).toContain("407 Proxy Authentication Required")
    expect(broker).toContain('request.headers["proxy-authorization"] === undefined ? 407 : 403')
    const gitBroker = fs.readFileSync(path.join(root, "scripts/execution-fabric/provision/assets/aegis-remote-dev-git-broker.mjs"), "utf8").replace(/\r\n/g, "\n")
    const gitClient = fs.readFileSync(path.join(root, "scripts/execution-fabric/provision/assets/aegis-remote-dev-git-client.mjs"), "utf8")
    const gitService = fs.readFileSync(path.join(root, "scripts/execution-fabric/provision/assets/williamos-aegis-remote-dev-git-broker.service"), "utf8")
    expect(gitBroker).toContain('bound.runId !== authorization.payload.runId')
    expect(gitBroker).toContain("fs.constants.O_EXCL")
    expect(gitBroker).toContain(".git-consumed")
    expect(gitBroker).toContain("consumeGitTicket(authorization.payload)\n  exactCredential()")
    expect(gitService).toContain("User=williamos-git-broker")
    expect(gitService).toContain("Group=williamos-fabric")
    expect(gitService).toContain("IPAddressDeny=any")
    expect(gitService).toContain("IPAddressAllow=localhost")
    expect(gitService).toContain("/var/lib/williamos-fabric/remote-dev-launch-tickets")
    expect(gitService).not.toContain("User=williamos-fabric")
    expect(gitBroker).toContain('name.startsWith("url.")')
    expect(gitBroker).toContain('"remote", "get-url", "--push", "--all", "origin"')
    expect(gitBroker).toContain('"push", REMOTE')
    expect(gitClient).toContain("PROVE_PREFLIGHT: 920_000")
    expect(gitClient).toContain("socket.setTimeout(OPERATION_TIMEOUT_MS[operation])")
    expect(gitClient).not.toContain("socket.setTimeout(30_000)")
    expect(worker).toContain('chmod 2770 -- "$PHYSICAL_WORKSPACE"')
    expect(worker).toContain("umask 077")
    expect(worker).toContain("run_shared_git_capture()")
    expect(worker).toContain("GIT_CONFIG_KEY_0=safe.directory")
    expect(worker).toContain('GIT_CONFIG_VALUE_0="$REPO_DIR"')
    expect(worker).toContain("umask 007")
    expect(worker).toContain("umask \"$previous_umask\"")
    expect(worker).toContain('chmod 0640 -- "$marker_tmp"')
    expect(dotnet).toContain("TEST_DOTNET_INFORMATIONAL|BUILD_DOTNET_RELEASE")
  })

  it("accepts only the exact authenticated restore proxy and explicit non-network dotnet modes", () => {
    const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/usr/bin/bash"
    const wrapper = path.join(root, "scripts/execution-fabric/provision/assets/williamos-dotnet-broker-wrapper")
    const base = { ...process.env, HTTPS_PROXY: "", https_proxy: "", NO_PROXY: "", no_proxy: "" }
    const preflight = spawnSync(bash, [wrapper, "--version"], { env: { ...base, WILLIAMOS_NETWORK_OPERATION: "PROVE_PREFLIGHT", WILLIAMOS_NETWORK_TICKET_B64: "e30=" }, shell: false })
    expect(preflight.status).not.toBe(64)
    const ticket = "e30="; const proxy = `http://WilliamOS:${encodeURIComponent(ticket)}@127.0.0.1:17734`
    const restore = spawnSync(bash, [wrapper, "restore"], { env: { ...base, WILLIAMOS_NETWORK_OPERATION: "RESTORE_DOTNET", WILLIAMOS_NETWORK_TICKET_B64: ticket, HTTPS_PROXY: proxy, https_proxy: proxy }, shell: false })
    expect(restore.status).not.toBe(64)
    const unauthenticated = spawnSync(bash, [wrapper, "restore"], { env: { ...base, WILLIAMOS_NETWORK_OPERATION: "RESTORE_DOTNET" }, shell: false })
    expect(unauthenticated.status).toBe(64)
    const networkedBuild = spawnSync(bash, [wrapper, "build", "--no-restore"], { env: { ...base, WILLIAMOS_NETWORK_OPERATION: "BUILD_DOTNET_RELEASE", HTTPS_PROXY: "http://127.0.0.1:17734" }, shell: false })
    expect(networkedBuild.status).toBe(64)
  })

  it("ships one fixed production OS adapter and CLI with no caller provider, clock, path, or command injection", () => {
    expect(inspectRootAdapterContract()).toMatchObject({
      status: "ROOT_OS_ADAPTER_CONTRACT_VERIFIED",
      executionAuthorized: false,
      storageMode: "VERIFY_ONLY",
      schedulerEnabled: false,
      standingAuthority: false,
    })
    const adapter = fs.readFileSync(path.join(root, "scripts/execution-fabric/provision/aegis-remote-dev-root-os-adapter.mjs"), "utf8")
    const verifier = fs.readFileSync(path.join(root, "scripts/execution-fabric/provision/aegis-remote-dev-root-handoff.mjs"), "utf8")
    const cli = fs.readFileSync(path.join(root, "scripts/execution-fabric/provision/aegis-remote-dev-root-handoff.sh"), "utf8")
    expect(adapter).toContain('const EVIDENCE_ROOT = "/var/lib/williamos-fabric/remote-dev-prerequisite-handoff"')
    expect(adapter).toContain('const BUNDLE_ROOT = "/usr/local/share/williamos/aegis-root-handoff-bundle"')
    expect(adapter).toContain('["--check", "/usr/local/libexec/aegis-remote-dev-runtime-authority.mjs"]')
    expect(adapter).not.toContain('["--check", "/usr/local/libexec/williamos-aegis-remote-dev-runtime-authority.mjs"]')
    expect(adapter).not.toContain("process.env.HOME")
    expect(adapter).not.toContain("shell: true")
    expect(adapter).toContain("fs.constants.O_EXCL")
    expect(adapter).toContain("recoverJournal(authority)")
    expect(adapter).toContain('run("/usr/sbin/usermod", ["-G", "", "--home", "/var/empty/williamos-fabric"')
    expect(adapter).toContain('"williamos-git-broker"')
    expect(adapter).toContain('"merge-base", "--is-ancestor", manifest.trustedMain.minimumCommit, authority.trustedMainCommit')
    expect(adapter).toContain("existingReceiptMatches")
    expect(adapter).toContain("proveRootServiceFence")
    expect(adapter).toContain("sharedGroupProcessesExact")
    expect(adapter).toContain("isProofWorkerUnitName(path.basename(String(entry)))")
    expect(adapter).toContain('version("/usr/share/dotnet/dotnet"')
    expect(adapter).toContain('fs.readlinkSync("/usr/bin/dotnet") !== "/usr/share/dotnet/dotnet"')
    expect(cli).toContain("KillMode=control-group")
    expect(cli).toContain("--wait --pipe --collect")
    expect(cli).toContain("williamos-aegis-root-handoff.service")
    expect(adapter.indexOf('run("/usr/bin/loginctl", ["terminate-user", "williamos-fabric"]')).toBeLessThan(adapter.indexOf("applyAssets(manifest, authority)"))
    expect(adapter).toContain("exactNftBoundaryLines(lines)")
    expect(verifier).toContain('const OWNER_PUBLIC_KEY_PATH = "/etc/williamos-fabric/owner-prerequisite-authority.pem"')
    expect(verifier).toContain('const INSTALLED_VERIFIER_PATH = "/usr/local/libexec/williamos-aegis-root-handoff.mjs"')
    expect(cli).toContain("/usr/bin/flock")
    expect(cli).toContain("/usr/local/libexec/williamos-aegis-root-handoff.mjs")
    expect(cli).not.toContain("eval ")
  })
})
