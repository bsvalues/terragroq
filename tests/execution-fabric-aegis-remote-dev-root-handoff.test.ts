import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"

import { canonicalizeJcs } from "../scripts/execution-fabric/canonical-json.mjs"
import {
  buildRootHandoffPlan,
  executeRootHandoffTransaction,
  inspectRootHandoffBundle,
  validateOwnerAuthority,
  validateRootHandoffManifest,
} from "../scripts/execution-fabric/provision/aegis-remote-dev-root-handoff.mjs"
import { inspectRootAdapterContract } from "../scripts/execution-fabric/provision/aegis-remote-dev-root-os-adapter.mjs"

const root = path.resolve(import.meta.dirname, "..")
const manifestPath = path.join(root, "config/execution-fabric/aegis-remote-dev-root-handoff.json")
const loadManifest = () => JSON.parse(fs.readFileSync(manifestPath, "utf8"))
const sha = (bytes: crypto.BinaryLike) => crypto.createHash("sha256").update(bytes).digest("hex")
const rawSha = (file: string) => {
  const trusted = spawnSync("git", ["show", `HEAD:${file}`], { cwd: root, encoding: null, shell: false })
  return sha(trusted.status === 0 ? trusted.stdout : fs.readFileSync(path.join(root, file)))
}

function completeObservation(manifest = loadManifest()) {
  return {
    platform: { os: "linux", effectiveUid: 0, hostname: "aegis", machineIdSha256: manifest.target.machineIdSha256 },
    bootstrap: { verifierRootOwned: true, verifierMode: "0555", ownerPublicKeyRootOwned: true, ownerPublicKeyMode: "0444" },
    trustedMain: { remote: "https://github.com/bsvalues/terragroq.git", ref: "refs/heads/main", commit: manifest.trustedMain.commit, exactCleanHead: true, replaceObjectsDisabled: true, configIsolation: true, criticalBytesMatch: true },
    storage: {
      verified: true, mutationRequested: false, backingImageRealPath: manifest.storage.backingImageRealPath,
      backingImageBytes: manifest.storage.backingImageBytes, backingImageOwner: "root", backingImageGroup: "root", backingImageMode: "0600", backingImageNlink: 1,
      backingHostFilesystem: "ext4", backingDevice: "2049", backingInode: "734", backingCtimeNs: "1786497600000000000",
      loopDevice: "/dev/loop7", loopBackingImageRealPath: manifest.storage.backingImageRealPath, mountSource: "/dev/loop7", mountSourceMajorMinor: "7:7",
      loopMajorMinor: "7:7", filesystemType: "xfs", filesystemUuid: manifest.storage.filesystemUuid, filesystemLabel: "AEGIS_RDEV",
      mountPath: "/srv/william", mountOptions: ["rw", "nosuid", "nodev", "prjquota", "exec"], projectId: 734,
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
    trustedMainCommit: manifest.trustedMain.commit,
    rootHandoffManifestSha256: sha(Buffer.from(canonicalizeJcs(manifest), "utf8")),
    verifierSha256: rawSha("scripts/execution-fabric/provision/aegis-remote-dev-root-handoff.mjs"),
    prerequisiteManifestJcsSha256: manifest.prerequisitePackage.manifestJcsSha256,
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
    issuedAt: "2026-08-11T20:00:00.000Z", expiresAt: "2026-08-11T20:15:00.000Z", singleUse: true,
    ...overrides,
  }
  const bytes = Buffer.from(canonicalizeJcs(payload), "utf8")
  return { envelope: { payload, signature: crypto.sign(null, bytes, privateKey).toString("base64") }, publicKey }
}

describe("AEGIS root-owned prerequisite handoff", () => {
  it("pins the merged prerequisite generation and every applied asset exactly", () => {
    const manifest = validateRootHandoffManifest(loadManifest())
    expect(manifest.trustedMain.commit).toBe("bcca6069a917d706314f7c8cb7b3cd40cdd910da")
    expect(manifest.prerequisitePackage).toMatchObject({ packageId: "aegis-remote-dev-prerequisites-issue-734-v1", manifestJcsSha256: "cf39e367f9f5437d43f7d93456b16414f5aa47c44954e59b0ecf9b8b89018d6a" })
    expect(manifest.appliedAssets.length).toBeGreaterThanOrEqual(7)
    for (const asset of manifest.appliedAssets) expect(rawSha(asset.source)).toBe(asset.sha256)
    expect(inspectRootHandoffBundle(root)).toMatchObject({ status: "BUNDLE_INTERNAL_CONSISTENCY_ONLY", externalTrustRootRequired: true, applyAuthorized: false, drift: [] })
  })

  it("rejects manifest, asset, scheduler, standing-authority, and closed-HASH drift", () => {
    for (const mutate of [
      (v: any) => { v.trustedMain.commit = "0".repeat(40) },
      (v: any) => { v.prerequisitePackage.manifestJcsSha256 = "0".repeat(64) },
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
      { trustedMainCommit: "0".repeat(40) },
      { verifierSha256: "0".repeat(64) },
      { allowedSteps: good.envelope.payload.allowedSteps.slice(1) },
      { storage: { ...good.envelope.payload.storage, mode: "MUTATE" } },
    ]
    for (const changed of cases) {
      const candidate = signedAuthority(manifest, changed)
      expect(validateOwnerAuthority(manifest, candidate.envelope, candidate.publicKey, "2026-08-11T20:05:00.000Z", false).status).toBe("BLOCKED")
    }
    expect(validateOwnerAuthority(manifest, good.envelope, good.publicKey, "2026-08-11T20:16:00.000Z", false).reasonCode).toBe("OWNER_AUTHORITY_EXPIRED")
    expect(validateOwnerAuthority(manifest, good.envelope, good.publicKey, "2026-08-11T20:05:00.000Z", true).reasonCode).toBe("OWNER_AUTHORITY_CONSUMED")
  })

  it("blocks any storage absence or drift and never plans format, mount, remount, quota, or workspace creation", () => {
    const manifest = loadManifest()
    for (const mutate of [
      (o: any) => { o.storage.verified = false },
      (o: any) => { o.storage.mutationRequested = true },
      (o: any) => { o.storage.loopBackingImageRealPath = "/other" },
      (o: any) => { o.storage.mountSourceMajorMinor = "7:8" },
      (o: any) => { o.storage.quotaEnforcement = false },
      (o: any) => { o.storage.hardLimitBytes = 1 },
    ]) {
      const observed = completeObservation(manifest); mutate(observed)
      expect(buildRootHandoffPlan(manifest, observed)).toMatchObject({ status: "BLOCKED", reasonCode: "STORAGE_VERIFY_ONLY_DRIFT", mutations: [] })
    }
    const plan = buildRootHandoffPlan(manifest, completeObservation(manifest))
    expect(plan.status).toBe("READY_FOR_SIGNED_AUTHORITY")
    expect(plan.mutations.map((entry: any) => entry.id)).not.toEqual(expect.arrayContaining(["FORMAT_STORAGE", "MOUNT_STORAGE", "REMOUNT_STORAGE", "CREATE_WORKSPACE", "SET_QUOTA"]))
  })

  it("fails closed on root, Linux, machine, trusted-main, key, toolchain, and prerequisite drift", () => {
    const manifest = loadManifest()
    const mutations = [
      (o: any) => { o.platform.effectiveUid = 1000 },
      (o: any) => { o.platform.os = "windows" },
      (o: any) => { o.platform.machineIdSha256 = "0".repeat(64) },
      (o: any) => { o.trustedMain.commit = "0".repeat(40) },
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
      acquireLease: async () => true, releaseLease: async () => undefined, reprove: async () => observed,
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
    expect((await executeRootHandoffTransaction(manifest, signed.envelope, signed.publicKey, "2026-08-11T20:05:00.000Z", adapter)).status).toBe("BLOCKED")
    expect(state.applyCalls).toBe(1)
    state.crash = false
    expect(await executeRootHandoffTransaction(manifest, signed.envelope, signed.publicKey, "2026-08-11T20:06:00.000Z", adapter)).toMatchObject({ status: "PREREQUISITES_APPLIED_VERIFIED" })
    expect(state.applyCalls).toBe(manifest.steps.length)
  })

  it("ships an exact dual-stack default-deny policy broker with Atlas denied and no fail-open delete/apply gap", () => {
    const broker = fs.readFileSync(path.join(root, "scripts/execution-fabric/provision/assets/aegis-remote-dev-egress-broker.mjs"), "utf8")
    const enforcer = fs.readFileSync(path.join(root, "scripts/execution-fabric/provision/assets/aegis-remote-dev-egress-enforcer.mjs"), "utf8")
    const service = fs.readFileSync(path.join(root, "scripts/execution-fabric/provision/assets/williamos-aegis-remote-dev-egress.service"), "utf8")
    const nft = fs.readFileSync(path.join(root, "scripts/execution-fabric/provision/assets/williamos-aegis-remote-dev-egress.nft"), "utf8")
    for (const endpoint of ["ssh.github.com", "api.github.com", "api.nuget.org", "globalcdn.nuget.org"]) expect(broker).toContain(endpoint)
    expect(broker).toContain('address === "192.168.1.156"')
    expect(broker).toContain('lower === "::ffff:192.168.1.156"')
    expect(broker).not.toContain('delete table')
    expect(enforcer).toContain("flush chain inet")
    expect(enforcer).not.toContain("delete table")
    expect(service).toContain("ExecStop=/usr/bin/node /usr/local/libexec/williamos-aegis-remote-dev-egress-enforcer.mjs --enforce")
    expect(nft).toContain('meta skuid "williamos-fabric" ip daddr 192.168.1.156 reject')
    expect(nft).toContain('meta skuid "williamos-fabric" ip6 daddr ::ffff:192.168.1.156 reject')
    expect(nft.match(/meta skuid "williamos-fabric" reject/g)).toHaveLength(1)
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
    expect(adapter).not.toContain("process.env.HOME")
    expect(adapter).not.toContain("shell: true")
    expect(adapter).toContain("fs.constants.O_EXCL")
    expect(adapter).toContain("recoverJournal(authority)")
    expect(verifier).toContain('const OWNER_PUBLIC_KEY_PATH = "/etc/williamos-fabric/owner-prerequisite-authority.pem"')
    expect(verifier).toContain('const INSTALLED_VERIFIER_PATH = "/usr/local/libexec/williamos-aegis-root-handoff.mjs"')
    expect(cli).toContain("/usr/bin/flock")
    expect(cli).toContain("/usr/local/libexec/williamos-aegis-root-handoff.mjs")
    expect(cli).not.toContain("eval ")
  })
})
