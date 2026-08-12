import fs from "node:fs"
import crypto from "node:crypto"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  buildStandingProvisioningPlan,
  confinedPath,
  inspectStandingProvisioningPackage,
  validateStandingProvisioningAuthority,
  validateStandingProvisioningManifest,
} from "../scripts/execution-fabric/provision/aegis-standing-hash-prerequisites.mjs"
import {
  applyAegisStandingHashPrerequisites,
  assertNoGitAlternates,
  standingProvisioningErrorEvidence,
} from "../scripts/execution-fabric/provision/apply-aegis-standing-hash-prerequisites.mjs"
import { canonicalizeJcs } from "../scripts/execution-fabric/canonical-json.mjs"

type Json = Record<string, any>

const repoRoot = path.resolve(import.meta.dirname, "..")
const reviewedCheckoutSourcePath = "/opt/williamos/source/terragroq"
const manifestRelativePath = "config/execution-fabric/aegis-standing-hash-provisioning-package.v1.json"
const manifestPath = path.join(repoRoot, ...manifestRelativePath.split("/"))
const modulePath = path.join(
  repoRoot,
  "scripts",
  "execution-fabric",
  "provision",
  "aegis-standing-hash-prerequisites.mjs",
)
const applyModulePath = path.join(
  repoRoot,
  "scripts",
  "execution-fabric",
  "provision",
  "apply-aegis-standing-hash-prerequisites.mjs",
)
const temporaryRoots: string[] = []
const NOW = "2026-08-11T18:05:00.000Z"
const TRANSPORT_PUBLIC_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBmJhq4P/5J2slHqQ06b2KX8K6B0+Q6l6v7EoZ1WlWVy williamos-aegis-standing-hash"

function publicKeyFingerprint(publicKey = TRANSPORT_PUBLIC_KEY): string {
  const encoded = publicKey.trim().split(/\s+/)[1]
  return `SHA256:${crypto.createHash("sha256").update(Buffer.from(encoded, "base64")).digest("base64").replace(/=+$/, "")}`
}

function publicKeySha256(publicKey = TRANSPORT_PUBLIC_KEY): string {
  return crypto.createHash("sha256").update(`${publicKey.trim()}\n`, "utf8").digest("hex")
}

function manifest(): Json {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"))
}

function readyObservation(value = manifest()): Json {
  const exactClosure = Object.fromEntries(
    value.reviewedRelease.runtimeClosurePaths.map((closurePath: string) => {
      const binding = value.bindings.find(({ path: bindingPath }: Json) => bindingPath === closurePath)
      return [closurePath, binding.sha256]
    }),
  )
  const rootOwnedAssets = Object.fromEntries(
    value.rootOwnedAssets.map((asset: Json) => [
      asset.id,
      {
        exists: true,
        path: asset.path,
        type: asset.type,
        owner: asset.owner,
        group: asset.group,
        mode: asset.mode,
        direct: asset.direct,
        singleLink: asset.singleLink,
      },
    ]),
  )

  return {
    platform: { os: "linux", effectiveUid: 0, readOnlyObservation: true },
    identity: {
      exists: true,
      nodeId: "aegis",
      hostname: "aegis",
      machineIdSha256: value.identity.machineIdSha256,
      account: "williamos-fabric",
      privilege: "non-root-no-sudo",
      rootExecutionAllowed: false,
      sudoAllowed: false,
    },
    existingRuntimeRoots: Object.fromEntries(value.existingRuntimeRoots.map((root: Json) => [
      root.path,
      { exists: true, ...root },
    ])),
    reviewedRelease: {
      exists: true,
      gitCheckoutRequired: true,
      cleanCheckoutRequired: true,
      repository: "bsvalues/terragroq",
      ref: "refs/heads/main",
      commit: value.trustedMain.commit,
      reviewed: true,
      releaseRoot: value.reviewedRelease.releaseRoot,
      releaseManifestPath: "/etc/williamos/fabric/trusted-main-release.json",
      manifestSchemaVersion: "1.0-williamos-trusted-main-release",
      exactClosure,
    },
    rootOwnedAssets,
    privateRoots: {
      request: {
        exists: true,
        path: "/var/lib/williamos/fabric/standing-hash-requests",
        owner: "williamos-fabric",
        group: "williamos-fabric",
        mode: "0700",
        purpose: "ephemeral-private-request",
      },
      ledger: {
        exists: true,
        path: "/var/lib/williamos/fabric/standing-hash-ledger",
        owner: "williamos-fabric",
        group: "williamos-fabric",
        mode: "0700",
        purpose: "durable-control-evidence",
        atomicPublishRequired: true,
        immutableCompletionRequired: true,
      },
      nodeLease: {
        exists: true,
        path: "/var/lib/williamos/fabric/ledger",
        owner: "williamos-fabric",
        group: "williamos-fabric",
        mode: "0700",
        purpose: "shared-node-lease",
        atomicPublishRequired: true,
        durable: true,
      },
    },
    replayJournal: {
      exists: true,
      provider: "systemd-journal",
      identifier: "williamos-aegis-standing-hash",
      epochId: "aegis-standing-hash-replay-epoch-v1",
      retained: true,
      reconstructionAllowed: false,
    },
    invocationBoundary: {
      exists: true,
      ...value.invocationBoundary,
      dedicatedTransportKeyFingerprint: `SHA256:${"A".repeat(43)}`,
    },
    standingExecutionBoundary: {
      exists: true,
      ...value.standingExecutionBoundary,
      blockedScope: value.blockedScope,
    },
  }
}

function proposedAuthority(value = manifest()): Json {
  return {
    schemaVersion: 1,
    authorityId: "0f8fad5b-d9cb-469f-a165-70867728950e",
    packageId: value.packageId,
    manifestSha256: inspectStandingProvisioningPackage(repoRoot).manifestSha256,
    repository: value.trustedMain.repository,
    trustedMainCommit: value.trustedMain.commit,
    machineIdSha256: value.identity.machineIdSha256,
    account: value.identity.account,
    workOrderId: value.issue.workOrderId,
    issueNumber: value.issue.number,
    rootMutationIds: value.rootMutations.map(({ id }: Json) => id),
    dedicatedTransportKeyFingerprint: `SHA256:${"A".repeat(43)}`,
    dedicatedTransportPublicKeySha256: "b".repeat(64),
    dedicatedTransportKeyGenerationEvidenceSha256: "c".repeat(64),
    reviewedCheckoutSourcePath,
    issuedAt: "2026-08-11T18:00:00.000Z",
    expiresAt: "2026-08-11T18:15:00.000Z",
    singleUse: true,
    consumed: false,
  }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("AEGIS standing HASH prerequisite provisioning package", () => {
  it.each([
    ["absolute POSIX", "/etc/passwd"],
    ["absolute-looking drive", "C:/Windows/System32"],
    ["backslash", "scripts\\execution-fabric/file.mjs"],
    ["parent segment", "scripts/../config/file.json"],
    ["current segment", "scripts/./file.mjs"],
    ["empty segment", "scripts//file.mjs"],
  ])("rejects %s binding paths before repository confinement", (_label, bindingPath) => {
    expect(() => confinedPath(repoRoot, bindingPath)).toThrow(/relative POSIX|normalized/)
  })

  it("accepts only a normalized relative POSIX binding path", () => {
    expect(confinedPath(repoRoot, "scripts/execution-fabric/file.mjs"))
      .toBe(path.join(repoRoot, "scripts", "execution-fabric", "file.mjs"))
  })

  it("pins the exact reviewed package posture, bindings, and standing execution boundary", () => {
    const value = manifest()

    expect(() => validateStandingProvisioningManifest(structuredClone(value))).not.toThrow()
    expect(value).toMatchObject({
      schemaVersion: 1,
      packageId: "aegis-standing-hash-provisioning-issue-595-v1",
      status: "PACKAGE_ONLY_NOT_APPLIED",
      applyAuthorized: false,
      executionAuthorized: false,
      ownerAuthorityRequired: true,
      issue: {
        repository: "bsvalues/terragroq",
        number: 595,
        workOrderId: "WO-EF-AEGIS-STANDING-001",
      },
      trustedMain: {
        repository: "bsvalues/terragroq",
        ref: "refs/heads/main",
        commit: "13709f5789c25dea408283730a6bd35e8fd894ab",
        reviewed: true,
      },
      identity: {
        nodeId: "aegis",
        account: "williamos-fabric",
        privilege: "non-root-no-sudo",
        rootExecutionAllowed: false,
        sudoAllowed: false,
      },
      existingRuntimeRoots: [
        {
          path: "/var/lib/williamos",
          owner: "williamos-fabric",
          group: "williamos-fabric",
          mode: "0750",
          preserveExisting: true,
          mutationAllowed: false,
        },
        {
          path: "/var/lib/williamos/fabric",
          owner: "williamos-fabric",
          group: "williamos-fabric",
          mode: "0700",
          preserveExisting: true,
          mutationAllowed: false,
        },
      ],
      standingExecutionBoundary: {
        workloadClass: "HASH_VERIFY",
        networkScope: "none",
        durableWorkloadStorageAllowed: false,
        maximumConcurrency: 1,
        maximumInputBytes: 1_048_576,
        maximumRuntimeMs: 30_000,
        schedulerState: "disabled",
        schedulerAuthority: "not-granted",
        autonomousSelection: false,
        singleAdmissionRequired: true,
        singleUseClaimRequired: true,
        exclusiveLeaseAndFenceRequired: true,
      },
      invocationBoundary: {
        sourceAddress: "192.168.1.154",
        targetHostEd25519Fingerprint: "SHA256:N+YNbMg3nUb0tX7ZYLJfJSt9f0dUOukBUNLyYb1WByo",
        account: "williamos-fabric",
        dedicatedTransportKeyRequired: true,
        dedicatedTransportKeyAlgorithm: "ssh-ed25519",
        dedicatedTransportKeyGenerationHost: "hermes",
        dedicatedTransportPrivateKeyLocalOnly: true,
        dedicatedTransportPrivateKeyInspectionAllowed: false,
        existingKeyReuseAllowed: false,
        authorizedKeyRecordExactRequired: true,
        passwordAuthenticationAllowed: false,
        unrestrictedShellAllowed: false,
      },
    })
    expect(value.bindings).toEqual([
      { path: "scripts/execution-fabric/bounded-dispatch/bootstrap-aegis-standing-hash.mjs", sha256: "7d4b713c00f73726ce39f20856c53a69865968d98d2daf08e2ce038c612ce14b", textNormalization: "LF" },
      { path: "scripts/execution-fabric/bounded-dispatch/run-resident-aegis-standing-hash.mjs", sha256: "1e817dc0c87803a93d503d29183b6af66bd776173812d0270985b5e261db54a1", textNormalization: "LF" },
      { path: "scripts/execution-fabric/bounded-dispatch/aegis-standing-hash-runtime.mjs", sha256: "eb1cf0517caf3a4c4a1935ed8bea73c53fed64cc1ad3effa3963e6e237c22be2", textNormalization: "LF" },
      { path: "scripts/execution-fabric/bounded-dispatch/aegis-hash-core.mjs", sha256: "c5965a206b5f26c0db21176a609775d1ca176409b644bbc241fde74565bd8d8f", textNormalization: "LF" },
      { path: "scripts/execution-fabric/admission/evaluate-aegis-standing-authority.mjs", sha256: "0775904a9ceb7fae71e1ce9100f5017c5f05885c1a16e380f52971a4ac4665f8", textNormalization: "LF" },
      { path: "scripts/execution-fabric/canonical-json.mjs", sha256: "b1df628a845cdb43374e5850bb4e1b43cd203eb4baf9c0a32244578112ad9b21", textNormalization: "LF" },
      { path: "scripts/execution-fabric/provision/aegis-standing-hash-ssh-entrypoint.mjs", sha256: "c18ecec38a5086788d7f4532b471efc6548cd293c27f3983a92934464015fb16", textNormalization: "LF" },
      { path: "scripts/execution-fabric/provision/aegis-standing-hash-replay-epoch.mjs", sha256: "c796c9742052ada8e7744385a55ca630245a236a694632566ec0e1a232f40802", textNormalization: "LF" },
      { path: "scripts/execution-fabric/provision/apply-aegis-standing-hash-prerequisites.mjs", sha256: "2c69221e56659d3f358c8a81236e59dc61e8994bae7a98b558c6648fee5021d6", textNormalization: "LF" },
      { path: "scripts/execution-fabric/provision/create-hermes-aegis-standing-hash-key.mjs", sha256: "a6614aa312ca0d2247536b35a24fb704cc186e9339b3ca8badc76e67c623017e", textNormalization: "LF" },
    ])
    expect(value.blockedScope).toEqual(expect.arrayContaining([
      "scheduler-activation",
      "autonomous-selection",
      "generic-runner",
      "network-access",
      "persistent-workload-storage",
      "root-workload",
      "sudo",
      "terrafusion",
      "county-pacs",
      "production-mutation",
      "destructive-operation",
      "issue-357-reuse",
    ]))
  })

  it("fails closed when any required observation section is incomplete", () => {
    const observed = readyObservation()
    delete observed.replayJournal

    expect(buildStandingProvisioningPlan(manifest(), observed)).toMatchObject({
      status: "BLOCKED",
      reasonCode: "PREFLIGHT_EVIDENCE_INCOMPLETE",
      executionAuthorized: false,
      applyAuthorized: false,
      ownerAuthorityRequired: true,
      mutations: [],
    })
  })

  it("cannot report READY without exact preserved runtime-root observations", () => {
    const missing = readyObservation()
    delete missing.existingRuntimeRoots
    expect(buildStandingProvisioningPlan(manifest(), missing)).toMatchObject({
      status: "BLOCKED",
      reasonCode: "PREFLIGHT_EVIDENCE_INCOMPLETE",
    })

    for (const [path, field, value] of [
      ["/var/lib/williamos", "exists", false],
      ["/var/lib/williamos", "owner", "root"],
      ["/var/lib/williamos", "mode", "0755"],
      ["/var/lib/williamos/fabric", "group", "root"],
      ["/var/lib/williamos/fabric", "mutationAllowed", true],
    ] as const) {
      const observed = readyObservation()
      observed.existingRuntimeRoots[path][field] = value
      const result = buildStandingProvisioningPlan(manifest(), observed)
      expect(result).toMatchObject({ status: "BLOCKED", reasonCode: "PROVISIONING_DRIFT" })
      expect(result.drift).toContain(`existingRuntimeRoots.${path}.${field}`)
    }
  })

  it("blocks existing drift without proposing or performing mutations", () => {
    const observed = readyObservation()
    observed.identity.account = "bs"
    observed.rootOwnedAssets.bootstrap.mode = "0777"
    observed.privateRoots.ledger.owner = "root"
    observed.standingExecutionBoundary.schedulerState = "enabled"

    const result = buildStandingProvisioningPlan(manifest(), observed)

    expect(result).toMatchObject({
      status: "BLOCKED",
      reasonCode: "PROVISIONING_DRIFT",
      executionAuthorized: false,
      applyAuthorized: false,
      mutations: [],
    })
    expect(result.drift).toEqual(expect.arrayContaining([
      "identity.account",
      "rootOwnedAssets.bootstrap.mode",
      "privateRoots.ledger.owner",
      "standingExecutionBoundary.schedulerState",
    ]))
  })

  it("returns the exact ordered dry-run mutation list for safely absent assets", () => {
    const observed = readyObservation()
    observed.reviewedRelease = { exists: false }
    observed.rootOwnedAssets = Object.fromEntries(
      manifest().rootOwnedAssets.map(({ id }: Json) => [id, { exists: false }]),
    )
    observed.privateRoots = {
      request: { exists: false },
      ledger: { exists: false },
      nodeLease: { exists: false },
    }
    observed.replayJournal = { exists: false }
    observed.invocationBoundary = { exists: false }

    const result = buildStandingProvisioningPlan(manifest(), observed)

    expect(result).toMatchObject({
      status: "DRY_RUN_REQUIRED",
      reasonCode: "ROOT_PROVISIONING_AUTHORITY_REQUIRED",
      executionAuthorized: false,
      applyAuthorized: false,
      ownerAuthorityRequired: true,
      drift: [],
    })
    expect(result.mutations).toEqual([
      { id: "INSTALL_REVIEWED_RELEASE_CLOSURE", asset: "reviewedRelease" },
      { id: "INSTALL_ROOT_OWNED_BOOTSTRAP", asset: "rootOwnedAssets.bootstrap" },
      { id: "INSTALL_ROOT_OWNED_RELEASE_MANIFEST", asset: "rootOwnedAssets.release-manifest" },
      { id: "INSTALL_ROOT_OWNED_SSH_ENTRYPOINT", asset: "rootOwnedAssets.ssh-entrypoint" },
      { id: "INSTALL_ROOT_OWNED_REPLAY_EPOCH_INITIALIZER", asset: "rootOwnedAssets.replay-epoch-initializer" },
      { id: "CREATE_PRIVATE_REQUEST_ROOT", asset: "privateRoots.request" },
      { id: "CREATE_PRIVATE_LEDGER_ROOT", asset: "privateRoots.ledger" },
      { id: "CREATE_PRIVATE_NODE_LEASE_ROOT", asset: "privateRoots.nodeLease" },
      { id: "ESTABLISH_REPLAY_JOURNAL_EPOCH", asset: "replayJournal" },
      { id: "INSTALL_FORCED_COMMAND_AUTHORIZED_KEY", asset: "invocationBoundary" },
    ])
  })

  it("reports exact matching state as READY while remaining non-authorizing", () => {
    expect(buildStandingProvisioningPlan(manifest(), readyObservation())).toEqual({
      status: "READY",
      reasonCode: "PREREQUISITES_ALREADY_MATCH",
      executionAuthorized: false,
      applyAuthorized: false,
      ownerAuthorityRequired: true,
      drift: [],
      mutations: [],
    })
  })

  it("keeps an exact unexpired single-use authority proposal blocked at the live root handoff", () => {
    expect(validateStandingProvisioningAuthority(
      manifest(),
      proposedAuthority(),
      "2026-08-11T18:05:00.000Z",
    )).toMatchObject({
      status: "BLOCKED",
      reasonCode: "LIVE_ROOT_APPLY_AUTHORITY_REQUIRED",
      executionAuthorized: false,
      applyAuthorized: false,
      mutations: [],
    })
  })

  it.each([
    ["consumed", (authority: Json) => { authority.consumed = true }, "2026-08-11T18:05:00.000Z", "PROVISIONING_AUTHORITY_CONSUMED"],
    ["expired", (_authority: Json) => {}, "2026-08-11T18:15:00.000Z", "PROVISIONING_AUTHORITY_EXPIRED"],
    ["extra field", (authority: Json) => { authority.unreviewed = true }, "2026-08-11T18:05:00.000Z", "PROVISIONING_AUTHORITY_INVALID"],
    ["malformed consumed", (authority: Json) => { authority.consumed = true; authority.unreviewed = true }, "2026-08-11T18:05:00.000Z", "PROVISIONING_AUTHORITY_INVALID"],
    ["noncanonical timestamp", (authority: Json) => { authority.issuedAt = "2026-08-11T18:00:00Z" }, "2026-08-11T18:05:00.000Z", "PROVISIONING_AUTHORITY_EXPIRED"],
    ["relative checkout", (authority: Json) => { authority.reviewedCheckoutSourcePath = "tmp/checkout" }, "2026-08-11T18:05:00.000Z", "PROVISIONING_AUTHORITY_SCOPE_MISMATCH"],
    ["non-normalized checkout", (authority: Json) => { authority.reviewedCheckoutSourcePath = "/opt/williamos/source/../source/terragroq" }, "2026-08-11T18:05:00.000Z", "PROVISIONING_AUTHORITY_SCOPE_MISMATCH"],
    ["scope mismatch", (authority: Json) => { authority.rootMutationIds = [...authority.rootMutationIds].reverse() }, "2026-08-11T18:05:00.000Z", "PROVISIONING_AUTHORITY_SCOPE_MISMATCH"],
  ])("returns the typed failure for %s authority", (_label, mutate, now, reasonCode) => {
    const authority = proposedAuthority()
    mutate(authority)

    expect(validateStandingProvisioningAuthority(manifest(), authority, now)).toMatchObject({
      status: "BLOCKED",
      reasonCode,
      executionAuthorized: false,
      applyAuthorized: false,
      mutations: [],
    })
  })

  it("contains no execution, network, write, timer, or scheduler-activation primitive", () => {
    const source = fs.readFileSync(modulePath, "utf8")

    expect(source).not.toMatch(/node:(?:child_process|net|http|https|tls|dgram)/)
    expect(source).not.toMatch(/\b(?:spawn|spawnSync|exec|execFile|execFileSync|fork)\s*\(/)
    expect(source).not.toMatch(/\bfs\.(?:write|append|truncate|rename|rm|unlink|mkdir|copyFile|cp|chmod|chown|utimes|symlink|link)[A-Za-z]*\s*\(/)
    expect(source).not.toMatch(/node:timers|\b(?:setTimeout|setInterval|setImmediate|queueMicrotask)\s*\(/)
    expect(source).not.toMatch(/scheduler\.(?:start|run|enable|activate)\s*\(/i)
    expect(source).not.toMatch(/process\.(?:exit|kill|stdin|stdout|stderr|env|argv)/)
  })

  it("detects bound-file drift from an isolated package copy", () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-standing-package-"))
    temporaryRoots.push(temporaryRoot)
    const value = manifest()
    const packageFiles = [manifestRelativePath, ...value.bindings.map(({ path: bindingPath }: Json) => bindingPath)]
    for (const relativePath of packageFiles) {
      const destination = path.join(temporaryRoot, ...relativePath.split("/"))
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.copyFileSync(path.join(repoRoot, ...relativePath.split("/")), destination)
    }
    const changedPath = value.bindings[2].path
    fs.appendFileSync(path.join(temporaryRoot, ...changedPath.split("/")), "\n// drift\n")

    expect(inspectStandingProvisioningPackage(temporaryRoot)).toMatchObject({
      status: "BLOCKED",
      reasonCode: "PACKAGE_BINDING_DRIFT",
      executionAuthorized: false,
      applyAuthorized: false,
      verifiedPaths: [],
      drift: expect.arrayContaining([changedPath]),
      mutations: [],
    })
  })
})
function keyGenerationEvidence(value = manifest(), publicKey = TRANSPORT_PUBLIC_KEY): Json {
  return {
    schemaVersion: "1.0-hermes-aegis-standing-hash-key-evidence",
    status: "GENERATED",
    packageId: value.packageId,
    manifestSha256: crypto.createHash("sha256").update(canonicalizeJcs(value)).digest("hex"),
    generationAuthorityId: "c1a03f4b-e6d8-4ba5-8b2d-8df07069b525",
    generationAuthoritySha256: "d".repeat(64),
    generatedAt: "2026-08-11T17:59:00.000Z",
    generationHost: "hermes",
    generationAccount: "bs",
    sourceAddress: "192.168.1.154",
    algorithm: "ssh-ed25519",
    privateKeyPath: value.invocationBoundary.dedicatedTransportPrivateKeyPath,
    publicKeyPath: value.invocationBoundary.dedicatedTransportPublicKeyPath,
    generatedFresh: true,
    existedBefore: false,
    privateKeyInspected: false,
    privateKeyLocalOnly: true,
    publicKeySha256: publicKeySha256(publicKey),
    publicKeyFingerprint: publicKeyFingerprint(publicKey),
  }
}

function applyAuthority(value = manifest(), evidence = keyGenerationEvidence(value), publicKey = TRANSPORT_PUBLIC_KEY, sourcePath = reviewedCheckoutSourcePath): Json {
  return {
    ...proposedAuthority(value),
    dedicatedTransportKeyFingerprint: publicKeyFingerprint(publicKey),
    dedicatedTransportPublicKeySha256: publicKeySha256(publicKey),
    dedicatedTransportKeyGenerationEvidenceSha256: crypto.createHash("sha256").update(canonicalizeJcs(evidence)).digest("hex"),
    reviewedCheckoutSourcePath: sourcePath,
  }
}

const authorizedKeyRecord = [
  "restrict",
  'from="192.168.1.154"',
  'command="/usr/local/libexec/williamos/aegis-standing-hash-ssh-entrypoint.mjs"',
  "no-agent-forwarding",
  "no-port-forwarding",
  "no-X11-forwarding",
  "no-pty",
  "no-user-rc",
].join(",") + " " + TRANSPORT_PUBLIC_KEY

type VirtualNode = {
  kind: "file" | "directory" | "symlink"
  bytes: Buffer
  uid: number
  gid: number
  mode: number
  nlink: number
  dev: number
  ino: number
  mtimeMs: number
  ctimeMs: number
}

function injectedLinuxFs(options: {
  existing?: Array<{
    path: string
    kind?: VirtualNode["kind"]
    mode?: number
    uid?: number
    gid?: number
  }>
  failPath?: string
  failJournalRecordType?: string
} = {}) {
  const nodes = new Map<string, VirtualNode>()
  const descriptors = new Map<number, { kind: "real" | "virtual", fd?: number, path?: string }>()
  const virtualOpenFlags = new Map<number, number>()
  const virtualWriteOffsets = new Map<number, number>()
  const events: Json[] = []
  let identityProvider = () => ({ uid: 0, gid: 0 })
  let nextDescriptor = 10_000
  let nextInode = 100
  const normalize = (candidate: fs.PathLike) => String(candidate).startsWith("/")
    ? path.posix.resolve(String(candidate))
    : path.resolve(String(candidate))
  const node = (kind: VirtualNode["kind"], mode: number, bytes = Buffer.alloc(0), uid = 0, gid = 0): VirtualNode => ({
    kind,
    bytes: Buffer.from(bytes),
    uid,
    gid,
    mode: (kind === "directory" ? 0o040000 : kind === "symlink" ? 0o120000 : 0o100000) | mode,
    nlink: 1,
    dev: 1,
    ino: nextInode++,
    mtimeMs: 1,
    ctimeMs: 1,
  })
  const putDirectory = (candidate: string, mode = 0o755, uid = 0, gid = 0) => {
    nodes.set(normalize(candidate), node("directory", mode, Buffer.alloc(0), uid, gid))
  }
  for (const directory of ["/", "/opt", "/usr", "/usr/local", "/usr/local/libexec", "/etc", "/var", "/var/lib", "/home"]) {
    putDirectory(directory)
  }
  putDirectory("/home/williamos-fabric", 0o755, 734, 734)
  putDirectory("/var/lib/williamos", 0o750, 734, 734)
  putDirectory("/var/lib/williamos/fabric", 0o700, 734, 734)
  nodes.set(normalize("/etc/machine-id"), node("file", 0o444, Buffer.from("00000000000000000000000000000000\n")))
  nodes.set(normalize("/etc/passwd"), node("file", 0o444, Buffer.from("williamos-fabric:x:734:734::/home/williamos-fabric:/bin/bash\n")))
  nodes.set(normalize("/etc/group"), node("file", 0o444, Buffer.from("williamos-fabric:x:734:\n")))
  for (const entry of options.existing ?? []) {
    const kind = entry.kind ?? "file"
    nodes.set(normalize(entry.path), node(
      kind,
      entry.mode ?? (kind === "directory" ? 0o755 : 0o644),
      Buffer.alloc(0),
      entry.uid ?? 0,
      entry.gid ?? 0,
    ))
  }
  const failPath = options.failPath ? normalize(options.failPath) : null
  const missing = () => Object.assign(new Error("ENOENT"), { code: "ENOENT" })
  const stats = (value: VirtualNode) => ({
    ...value,
    size: value.bytes.length,
    isFile: () => value.kind === "file",
    isDirectory: () => value.kind === "directory",
    isSymbolicLink: () => value.kind === "symlink",
  })
  const isRepoPath = (candidate: fs.PathLike) => {
    const relative = path.relative(repoRoot, normalize(candidate))
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
  }
  const api: any = {
    constants: fs.constants,
    lstatSync(candidate: fs.PathLike) {
      if (isRepoPath(candidate)) return fs.lstatSync(candidate)
      const value = nodes.get(normalize(candidate))
      if (!value) throw missing()
      return stats(value)
    },
    realpathSync(candidate: fs.PathLike) {
      if (isRepoPath(candidate)) return fs.realpathSync(candidate)
      const value = nodes.get(normalize(candidate))
      if (!value) throw missing()
      return value.kind === "symlink" ? normalize(candidate) + "-target" : normalize(candidate)
    },
    openSync(candidate: fs.PathLike, flags: number, mode?: number) {
      if (isRepoPath(candidate)) {
        const fd = fs.openSync(candidate, flags, mode)
        const descriptor = nextDescriptor++
        descriptors.set(descriptor, { kind: "real", fd })
        return descriptor
      }
      const target = normalize(candidate)
      const create = (flags & fs.constants.O_CREAT) !== 0
      if (create) {
        if (target === failPath || (failPath && target.startsWith(`${failPath}.provisioning-`))) {
          throw Object.assign(new Error("INJECTED_WRITE_FAILURE"), { code: "EIO" })
        }
        if (nodes.has(target) && (flags & fs.constants.O_EXCL) !== 0) {
          throw Object.assign(new Error("EEXIST"), { code: "EEXIST" })
        }
        const identity = identityProvider()
        nodes.set(target, node("file", mode ?? 0o666, Buffer.alloc(0), identity.uid, identity.gid))
        events.push({ kind: "open-create", path: target, flags, mode })
      } else if (!nodes.has(target)) {
        throw missing()
      }
      const descriptor = nextDescriptor++
      descriptors.set(descriptor, { kind: "virtual", path: target })
      virtualOpenFlags.set(descriptor, flags)
      virtualWriteOffsets.set(descriptor, 0)
      events.push({ kind: "open", path: target, flags })
      return descriptor
    },
    fstatSync(descriptor: number) {
      const value = descriptors.get(descriptor)
      if (!value) throw new Error("BAD_DESCRIPTOR")
      return value.kind === "real" ? fs.fstatSync(value.fd!) : stats(nodes.get(value.path!)!)
    },
    readFileSync(candidate: number | fs.PathLike, encoding?: BufferEncoding) {
      if (typeof candidate !== "number") return fs.readFileSync(candidate, encoding as any)
      const value = descriptors.get(candidate)
      if (!value) throw new Error("BAD_DESCRIPTOR")
      if (value.kind === "real") return fs.readFileSync(value.fd!, encoding as any)
      const bytes = Buffer.from(nodes.get(value.path!)!.bytes)
      return encoding ? bytes.toString(encoding) : bytes
    },
    closeSync(descriptor: number) {
      const value = descriptors.get(descriptor)
      if (!value) throw new Error("BAD_DESCRIPTOR")
      if (value.kind === "real") fs.closeSync(value.fd!)
      descriptors.delete(descriptor)
      virtualOpenFlags.delete(descriptor)
      virtualWriteOffsets.delete(descriptor)
      events.push({ kind: "close", descriptor })
    },
    mkdirSync(candidate: fs.PathLike, config: Json) {
      const target = normalize(candidate)
      if (target === failPath) throw Object.assign(new Error("INJECTED_WRITE_FAILURE"), { code: "EIO" })
      if (nodes.has(target)) throw Object.assign(new Error("EEXIST"), { code: "EEXIST" })
      const identity = identityProvider()
      nodes.set(target, node("directory", config.mode, Buffer.alloc(0), identity.uid, identity.gid))
      events.push({ kind: "mkdir", path: target, mode: config.mode })
    },
    chownSync(candidate: fs.PathLike, uid: number, gid: number) {
      const target = normalize(candidate)
      Object.assign(nodes.get(target)!, { uid, gid })
      events.push({ kind: "chown", path: target, uid, gid })
    },
    chmodSync(candidate: fs.PathLike, mode: number) {
      const target = normalize(candidate)
      const value = nodes.get(target)!
      value.mode = (value.mode & 0o170000) | mode
      events.push({ kind: "chmod", path: target, mode })
    },
    fchownSync(descriptor: number, uid: number, gid: number) {
      const target = descriptors.get(descriptor)!.path!
      Object.assign(nodes.get(target)!, { uid, gid })
      events.push({ kind: "fchown", path: target, uid, gid })
    },
    fchmodSync(descriptor: number, mode: number) {
      const target = descriptors.get(descriptor)!.path!
      const value = nodes.get(target)!
      value.mode = (value.mode & 0o170000) | mode
      events.push({ kind: "fchmod", path: target, mode })
    },
    writeSync(descriptor: number, data: NodeJS.ArrayBufferView, offset: number, length: number) {
      const target = descriptors.get(descriptor)!.path!
      const value = nodes.get(target)!
      const bytes = Buffer.from(data.buffer, data.byteOffset + offset, length)
      if (options.failJournalRecordType && target.startsWith("/var/lib/williamos-aegis-standing-hash-")
        && bytes.toString("utf8").includes(`\"record_type\":\"${options.failJournalRecordType}\"`)) {
        throw Object.assign(new Error("INJECTED_JOURNAL_FAILURE"), { code: "EIO" })
      }
      if (((virtualOpenFlags.get(descriptor) ?? 0) & fs.constants.O_APPEND) !== 0) {
        value.bytes = Buffer.concat([value.bytes, bytes])
      } else {
        const position = virtualWriteOffsets.get(descriptor) ?? 0
        const end = position + bytes.length
        const next = Buffer.alloc(Math.max(value.bytes.length, end))
        value.bytes.copy(next)
        bytes.copy(next, position)
        value.bytes = next
        virtualWriteOffsets.set(descriptor, end)
      }
      events.push({ kind: "write", path: target, bytes: bytes.length })
      return bytes.length
    },
    fsyncSync(descriptor: number) {
      const target = descriptors.get(descriptor)!.path!
      events.push({ kind: "fsync", path: target })
    },
    linkSync(existingPath: fs.PathLike, newPath: fs.PathLike) {
      const source = normalize(existingPath)
      const target = normalize(newPath)
      if (nodes.has(target)) throw Object.assign(new Error("EEXIST"), { code: "EEXIST" })
      const value = nodes.get(source)
      if (!value) throw missing()
      value.nlink += 1
      nodes.set(target, value)
      events.push({ kind: "link", source, path: target })
    },
    unlinkSync(candidate: fs.PathLike) {
      const target = normalize(candidate)
      const value = nodes.get(target)
      if (!value) throw missing()
      value.nlink -= 1
      nodes.delete(target)
      events.push({ kind: "unlink", path: target })
    },
  }
  return {
    fsApi: api,
    events,
    nodes,
    pathOf: normalize,
    bytesAt: (candidate: string) => nodes.get(normalize(candidate))?.bytes,
    statAt: (candidate: string) => nodes.get(normalize(candidate)),
    setIdentityProvider(provider: () => { uid: number, gid: number }) {
      identityProvider = provider
    },
    installCheckout(candidate: string) {
      const checkoutRoot = normalize(candidate)
      const directories = [
        checkoutRoot,
        `${checkoutRoot}/.git`,
        `${checkoutRoot}/config`,
        `${checkoutRoot}/config/execution-fabric`,
        `${checkoutRoot}/scripts`,
        `${checkoutRoot}/scripts/execution-fabric`,
        `${checkoutRoot}/scripts/execution-fabric/admission`,
        `${checkoutRoot}/docs`,
        `${checkoutRoot}/docs/reports`,
        `${checkoutRoot}/docs/reports/standing-dispatch`,
        `${checkoutRoot}/docs/reports/standing-dispatch/inputs`,
      ]
      for (const directory of directories) putDirectory(directory, 0o755, 0, 0)
      for (const [target, bytes] of [
        [`${checkoutRoot}/.git/HEAD`, Buffer.from(`detached ${manifest().trustedMain.commit}\n`)],
        [`${checkoutRoot}/config/execution-fabric/aegis-resident-identity.json`, Buffer.from("{}\n")],
        [`${checkoutRoot}/scripts/execution-fabric/admission/evaluate-aegis-standing-authority.mjs`, Buffer.from("export {}\n")],
        [`${checkoutRoot}/docs/reports/standing-dispatch/inputs/proof.bin`, Buffer.from("proof")],
      ] as const) nodes.set(normalize(target), node("file", 0o444, bytes, 0, 0))
      events.push({ kind: "install-checkout", path: checkoutRoot })
    },
  }
}

function injectedRootProcess(failOperation?: string | string[] | { operation: string, occurrence: number }) {
  let uid = 0
  let gid = 0
  let groups = [0]
  const events: Json[] = []
  const failureSpecs = (Array.isArray(failOperation) ? failOperation : failOperation ? [failOperation] : [])
    .map((entry) => typeof entry === "string" ? { operation: entry, occurrence: 1 } : entry)
  const operationCounts = new Map<string, number>()
  const reject = (operation: string) => {
    const occurrence = (operationCounts.get(operation) ?? 0) + 1
    operationCounts.set(operation, occurrence)
    if (failureSpecs.some((entry) => entry.operation === operation && entry.occurrence === occurrence)) {
      throw Object.assign(new Error(`INJECTED_${operation.toUpperCase()}_FAILURE`), { code: "EPERM" })
    }
  }
  return {
    events,
    identity: () => ({ uid, gid }),
    api: {
      platform: "linux",
      getuid: () => uid,
      geteuid: () => uid,
      getegid: () => gid,
      getgroups: () => [...groups],
      seteuid(next: number) {
        reject(next === 0 ? "restore-euid" : "drop-euid")
        events.push({ kind: "seteuid", from: uid, to: next })
        uid = next
      },
      setegid(next: number) {
        reject(next === 0 ? "restore-egid" : "drop-egid")
        events.push({ kind: "setegid", from: gid, to: next })
        gid = next
      },
      setgroups(next: number[]) {
        reject(next.length === 1 && next[0] === 734 ? "drop-groups" : "restore-groups")
        events.push({ kind: "setgroups", from: [...groups], to: [...next] })
        groups = [...next]
      },
    },
  }
}

function implementationInput(overrides: Json = {}) {
  const virtual = injectedLinuxFs(overrides.virtualOptions)
  const rootProcess = injectedRootProcess(overrides.processFailure)
  virtual.setIdentityProvider(rootProcess.identity)
  const publicKey = overrides.publicKey ?? TRANSPORT_PUBLIC_KEY + "\n"
  const normalizedPublicKey = publicKey.trim()
  const keyEvidence = overrides.keyGenerationEvidence ?? keyGenerationEvidence(manifest(), normalizedPublicKey)
  const checkoutSourcePath = overrides.reviewedCheckoutSourcePath ?? reviewedCheckoutSourcePath
  const authority = overrides.authority ?? applyAuthority(manifest(), keyEvidence, normalizedPublicKey, checkoutSourcePath)
  const checkoutApi = overrides.checkoutApi ?? {
    inspect: ({ sourcePath, expected }: Json) => ({
      sourcePath,
      repository: expected.repository,
      headCommit: expected.commit,
      clean: true,
      gitMetadata: true,
    }),
    publish: ({ destination, sourcePath, expected }: Json) => {
      virtual.installCheckout(destination)
      return { sourcePath, destination, repository: expected.repository, headCommit: expected.commit, clean: true, gitMetadata: true, published: true }
    },
  }
  const packageClosure = new Map(
    manifest().bindings.map(({ path: bindingPath }: Json) => [
      bindingPath,
      Buffer.from(fs.readFileSync(path.join(repoRoot, ...bindingPath.split("/"))).toString("utf8").replace(/\r\n/g, "\n"), "utf8"),
    ]),
  )
  return {
    virtual,
    options: {
      repoRoot,
      authority,
      publicKeyBytes: publicKey,
      keyGenerationEvidence: keyEvidence,
      mode: overrides.mode,
      fsApi: virtual.fsApi,
      processApi: overrides.processApi ?? rootProcess.api,
      hostname: overrides.hostnameApi ?? (() => "aegis"),
      clock: overrides.clock ?? (() => NOW),
      machineIdentitySha256: manifest().identity.machineIdSha256,
      accountIdentity: { uid: 734, gid: 734, home: "/home/williamos-fabric" },
      reviewedCheckoutSourcePath: checkoutSourcePath,
      checkoutApi,
      packageClosure,
    },
    processEvents: rootProcess.events,
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as { code?: string })?.code
}

function journalRecords(virtual: ReturnType<typeof injectedLinuxFs>, authorityId: string): Json[] {
  const journal = virtual.bytesAt("/var/lib/williamos-aegis-standing-hash-" + authorityId + ".mutation-journal.jsonl")
  if (!journal) return []
  const text = journal.toString("utf8").trimEnd()
  return text ? text.split("\n").map((line) => JSON.parse(line)) : []
}

describe("injected AEGIS standing HASH prerequisite apply", () => {
  it("defaults to dry-run without consuming authority or writing", () => {
    const { virtual, options } = implementationInput()
    const result = applyAegisStandingHashPrerequisites(options)

    expect(result).toMatchObject({
      status: "DRY_RUN",
      mode: "DRY-RUN",
      authority_consumed: false,
      private_key_generated: false,
      private_key_inspected: false,
      workload_executed: false,
      scheduler_activated: false,
      network_accessed: false,
    })
    expect(virtual.events.filter(({ kind }) => ["open-create", "mkdir", "write", "chmod", "chown", "fchmod", "fchown"].includes(kind))).toEqual([])
  })

  it.each([
    ["non-Linux", { platform: "darwin", getuid: () => 0 }, () => "aegis", "AEGIS_PROVISION_LINUX_REQUIRED"],
    ["non-root", { platform: "linux", getuid: () => 1000 }, () => "aegis", "AEGIS_PROVISION_ROOT_REQUIRED"],
    ["wrong host", { platform: "linux", getuid: () => 0 }, () => "omen", "AEGIS_PROVISION_HOST_REJECTED"],
  ])("rejects %s before reading or writing targets", (_label, processApi, hostnameApi, code) => {
    const { virtual, options } = implementationInput({ processApi, hostnameApi, mode: "apply" })

    expect(() => applyAegisStandingHashPrerequisites(options)).toThrow(expect.objectContaining({ code }))
    expect(virtual.events.filter(({ kind }) => ["open-create", "mkdir", "write", "chmod", "chown", "fchmod", "fchown"].includes(kind))).toEqual([])
  })

  it.each([
    ["package", (authority: Json) => { authority.packageId = "other" }, NOW, "AEGIS_PROVISION_AUTHORITY_SCOPE_MISMATCH"],
    ["manifest", (authority: Json) => { authority.manifestSha256 = "0".repeat(64) }, NOW, "AEGIS_PROVISION_AUTHORITY_SCOPE_MISMATCH"],
    ["work order", (authority: Json) => { authority.workOrderId = "WO-OTHER" }, NOW, "AEGIS_PROVISION_AUTHORITY_SCOPE_MISMATCH"],
    ["mutation order", (authority: Json) => { authority.rootMutationIds.reverse() }, NOW, "AEGIS_PROVISION_AUTHORITY_SCOPE_MISMATCH"],
    ["extra field", (authority: Json) => { authority.unreviewed = true }, NOW, "AEGIS_PROVISION_AUTHORITY_INVALID"],
    ["checkout source", (authority: Json) => { authority.reviewedCheckoutSourcePath = "/tmp/unbound" }, NOW, "AEGIS_PROVISION_AUTHORITY_SCOPE_MISMATCH"],
    ["expired", (_authority: Json) => {}, "2026-08-11T18:15:00.000Z", "AEGIS_PROVISION_AUTHORITY_EXPIRED"],
    ["consumed", (authority: Json) => { authority.consumed = true }, NOW, "AEGIS_PROVISION_AUTHORITY_REPLAY"],
  ])("rejects invalid %s authority without writes", (_label, mutate, now, code) => {
    const authority = applyAuthority()
    mutate(authority)
    const { virtual, options } = implementationInput({ authority, mode: "apply", clock: () => now })

    try {
      applyAegisStandingHashPrerequisites(options)
      throw new Error("EXPECTED_REJECTION")
    } catch (error) {
      expect(errorCode(error)).toBe(code)
    }
    expect(virtual.events.filter(({ kind }) => ["open-create", "mkdir", "write", "chmod", "chown", "fchmod", "fchown"].includes(kind))).toEqual([])
  })

  it("refuses symlinks, existing drift, and a replay journal before consuming", () => {
    const authority = applyAuthority()
    const cases = [
      ["/usr/local/libexec/williamos/aegis-standing-hash-bootstrap.mjs", "symlink", "AEGIS_PROVISION_SYMLINK_REJECTED"],
      ["/etc/williamos/fabric/trusted-main-release.json", "file", "AEGIS_PROVISION_PARTIAL_STATE_AMBIGUOUS"],
      ["/var/lib/williamos/fabric/standing-hash-requests", "directory", "AEGIS_PROVISION_PARTIAL_STATE_AMBIGUOUS"],
      ["/var/lib/williamos/fabric/standing-hash-ledger", "directory", "AEGIS_PROVISION_PARTIAL_STATE_AMBIGUOUS"],
      ["/var/lib/williamos-aegis-standing-hash-" + authority.authorityId + ".mutation-journal.jsonl", "file", "AEGIS_PROVISION_AUTHORITY_REPLAY"],
    ] as const
    for (const [target, kind, code] of cases) {
      const { virtual, options } = implementationInput({
        authority,
        mode: "apply",
        virtualOptions: { existing: [{ path: target, kind }] },
      })
      try {
        applyAegisStandingHashPrerequisites(options)
        throw new Error("EXPECTED_REJECTION")
      } catch (error) {
        expect(errorCode(error)).toBe(code)
      }
      expect(journalRecords(virtual, authority.authorityId)).toEqual([])
      expect(virtual.events.some(({ kind: eventKind }) => eventKind === "write")).toBe(false)
    }
  })

  it("durably consumes authority before the first managed mutation", () => {
    const authority = applyAuthority()
    const { virtual, options } = implementationInput({ authority, mode: "apply" })
    applyAegisStandingHashPrerequisites(options)

    const journalPath = virtual.pathOf("/var/lib/williamos-aegis-standing-hash-" + authority.authorityId + ".mutation-journal.jsonl")
    const consumedWrite = virtual.events.findIndex(({ kind, path: target }) => kind === "write" && target === journalPath)
    const consumedFsync = virtual.events.findIndex(({ kind, path: target }) => kind === "fsync" && target === journalPath)
    const parentFsync = virtual.events.findIndex(({ kind, path: target }) => kind === "fsync" && target === virtual.pathOf("/var/lib"))
    const firstManagedCreate = virtual.events.findIndex(({ kind, path: target }) =>
      ["mkdir", "open-create"].includes(kind) && target !== journalPath)
    expect(consumedWrite).toBeGreaterThanOrEqual(0)
    expect(consumedFsync).toBeGreaterThan(consumedWrite)
    expect(parentFsync).toBeGreaterThan(consumedFsync)
    expect(firstManagedCreate).toBeGreaterThan(parentFsync)
    expect(journalRecords(virtual, authority.authorityId)[0]).toMatchObject({
      record_type: "AUTHORITY_CONSUMED",
      authority_id: authority.authorityId,
    })
  })

  it("installs the exact ordered assets with exact modes and owners", () => {
    const authority = applyAuthority()
    const { virtual, options, processEvents } = implementationInput({ authority, mode: "apply" })
    const result = applyAegisStandingHashPrerequisites(options)
    const records = journalRecords(virtual, authority.authorityId)
    const completed = records
      .filter(({ record_type }) => record_type === "MUTATION_COMPLETED")
      .map(({ type, id, path: target, source_path, commit }) => ({
        type,
        ...(id ? { id } : {}),
        path: target,
        ...(source_path ? { source_path, commit } : {}),
      }))

    expect(result).toMatchObject({
      status: "APPLIED",
      authority_consumed: true,
      workload_executed: false,
      scheduler_activated: false,
    })
    expect(completed).toEqual(result.planned_mutations)
    expect(completed).toContainEqual({
      type: "INSTALL_REVIEWED_CHECKOUT",
      path: manifest().reviewedRelease.releaseRoot,
      source_path: reviewedCheckoutSourcePath,
      commit: manifest().trustedMain.commit,
    })
    for (const target of [
      `${manifest().reviewedRelease.releaseRoot}/.git/HEAD`,
      `${manifest().reviewedRelease.releaseRoot}/config/execution-fabric/aegis-resident-identity.json`,
      `${manifest().reviewedRelease.releaseRoot}/scripts/execution-fabric/admission/evaluate-aegis-standing-authority.mjs`,
      `${manifest().reviewedRelease.releaseRoot}/docs/reports/standing-dispatch/inputs/proof.bin`,
    ]) expect(virtual.statAt(target), target).toBeDefined()
    const expected = [
      ["/usr/local/libexec/williamos/aegis-standing-hash-bootstrap.mjs", 0, 0, 0o555],
      ["/etc/williamos/fabric/trusted-main-release.json", 0, 0, 0o444],
      ["/usr/local/libexec/williamos/aegis-standing-hash-ssh-entrypoint.mjs", 0, 0, 0o555],
      ["/usr/local/libexec/williamos/aegis-standing-hash-replay-epoch.mjs", 0, 0, 0o555],
      ["/var/lib/williamos/fabric/standing-hash-requests", 734, 734, 0o700],
      ["/var/lib/williamos/fabric/standing-hash-ledger", 734, 734, 0o700],
      ["/var/lib/williamos/fabric/ledger", 734, 734, 0o700],
      ["/home/williamos-fabric/.ssh/authorized_keys", 734, 734, 0o600],
    ] as const
    for (const [target, uid, gid, mode] of expected) {
      const value = virtual.statAt(target)
      expect(value, target).toBeDefined()
      expect({ uid: value!.uid, gid: value!.gid, mode: value!.mode & 0o777 }).toEqual({ uid, gid, mode })
    }
    expect(processEvents).toContainEqual({ kind: "setegid", from: 0, to: 734 })
    expect(processEvents).toContainEqual({ kind: "seteuid", from: 0, to: 734 })
    expect(processEvents).toContainEqual({ kind: "setgroups", from: [0], to: [734] })
    expect(processEvents).toContainEqual({ kind: "seteuid", from: 734, to: 0 })
    expect(processEvents).toContainEqual({ kind: "setegid", from: 734, to: 0 })
    expect(processEvents).toContainEqual({ kind: "setgroups", from: [734], to: [0] })
    expect(virtual.events).not.toContainEqual(expect.objectContaining({ kind: "chown", uid: 734 }))
    expect(virtual.events).not.toContainEqual(expect.objectContaining({ kind: "fchown", uid: 734 }))
  })

  it("rejects an unavailable privilege transition before consuming authority", () => {
    const authority = applyAuthority()
    const { virtual, options } = implementationInput({
      authority,
      mode: "apply",
      processApi: { platform: "linux", getuid: () => 0 },
    })
    expect(() => applyAegisStandingHashPrerequisites(options)).toThrow(expect.objectContaining({
      code: "AEGIS_PROVISION_PRIVILEGE_DROP_UNAVAILABLE",
    }))
    expect(journalRecords(virtual, authority.authorityId)).toEqual([])
  })

  it.each([
    "drop-groups",
    "drop-egid",
    "drop-euid",
    "restore-euid",
    "restore-egid",
    "restore-groups",
  ])("exercises and restores the %s transition before consuming authority", (processFailure) => {
    const authority = applyAuthority()
    const { virtual, options } = implementationInput({ authority, mode: "apply", processFailure })
    expect(() => applyAegisStandingHashPrerequisites(options)).toThrow(/AEGIS_PROVISION_PRIVILEGE_(DROP|RESTORE)_FAILED/)
    expect(journalRecords(virtual, authority.authorityId)).toEqual([])
  })

  it("retains the original drop failure when restoration also fails", () => {
    const authority = applyAuthority()
    const { virtual, options } = implementationInput({
      authority,
      mode: "apply",
      processFailure: ["drop-euid", "restore-egid"],
    })
    try {
      applyAegisStandingHashPrerequisites(options)
      throw new Error("EXPECTED_REJECTION")
    } catch (error) {
      expect(error).toMatchObject({
        code: "AEGIS_PROVISION_PRIVILEGE_DROP_FAILED",
        causeCode: "EPERM",
        restoreFailureCode: "AEGIS_PROVISION_PRIVILEGE_RESTORE_FAILED",
        restoreFailureCauseCode: "EPERM",
      })
    }
    expect(journalRecords(virtual, authority.authorityId)).toEqual([])
  })

  it("preserves the exact existing service-owned runtime roots without mutating them", () => {
    const { virtual, options } = implementationInput({ mode: "apply" })
    const result = applyAegisStandingHashPrerequisites(options)

    expect(result.preserved_runtime_roots).toEqual([
      {
        path: "/var/lib/williamos",
        owner: "williamos-fabric",
        group: "williamos-fabric",
        mode: "0750",
        preserved: true,
        mutated: false,
      },
      {
        path: "/var/lib/williamos/fabric",
        owner: "williamos-fabric",
        group: "williamos-fabric",
        mode: "0700",
        preserved: true,
        mutated: false,
      },
    ])
    expect(virtual.statAt("/var/lib/williamos")).toMatchObject({ uid: 734, gid: 734, mode: 0o040750 })
    expect(virtual.statAt("/var/lib/williamos/fabric")).toMatchObject({ uid: 734, gid: 734, mode: 0o040700 })
    const mutations = virtual.events.filter(({ kind }) => ["mkdir", "chown", "chmod", "open-create", "write"].includes(kind))
    expect(mutations).not.toContainEqual(expect.objectContaining({ path: virtual.pathOf("/var/lib/williamos") }))
    expect(mutations).not.toContainEqual(expect.objectContaining({ path: virtual.pathOf("/var/lib/williamos/fabric") }))
  })

  it.each([
    ["runtime owner", { path: "/var/lib/williamos", kind: "directory", mode: 0o750, uid: 0, gid: 0 }],
    ["runtime group", { path: "/var/lib/williamos", kind: "directory", mode: 0o750, uid: 734, gid: 0 }],
    ["runtime mode", { path: "/var/lib/williamos", kind: "directory", mode: 0o755, uid: 734, gid: 734 }],
    ["runtime type", { path: "/var/lib/williamos", kind: "file", mode: 0o750, uid: 734, gid: 734 }],
    ["fabric owner", { path: "/var/lib/williamos/fabric", kind: "directory", mode: 0o700, uid: 0, gid: 734 }],
    ["fabric group", { path: "/var/lib/williamos/fabric", kind: "directory", mode: 0o700, uid: 734, gid: 0 }],
    ["fabric mode", { path: "/var/lib/williamos/fabric", kind: "directory", mode: 0o750, uid: 734, gid: 734 }],
    ["fabric symlink", { path: "/var/lib/williamos/fabric", kind: "symlink", mode: 0o700, uid: 734, gid: 734 }],
  ])("rejects preserved %s drift before consuming authority", (_label, existing) => {
    const { virtual, options } = implementationInput({
      mode: "apply",
      virtualOptions: { existing: [existing] },
    })

    expect(() => applyAegisStandingHashPrerequisites(options)).toThrow(expect.objectContaining({
      code: "AEGIS_PROVISION_DIRECTORY_DRIFT",
    }))
    expect(journalRecords(virtual, options.authority.authorityId)).toEqual([])
  })

  it("writes exactly one restricted authorized_keys record bound to the public key", () => {
    const { virtual, options } = implementationInput({ mode: "apply" })
    applyAegisStandingHashPrerequisites(options)

    const encoded = TRANSPORT_PUBLIC_KEY.split(/\s+/)[1]
    const expected = authorizedKeyRecord.replace(TRANSPORT_PUBLIC_KEY, "ssh-ed25519 " + encoded) + "\n"
    expect(virtual.bytesAt("/home/williamos-fabric/.ssh/authorized_keys")?.toString("utf8")).toBe(expected)
    expect(expected).not.toMatch(/(?:permitopen|environment=|cert-authority|principals=)/)
  })

  it("rejects Git alternates before source inspection and staged checkout use", () => {
    const checkoutRoot = "/opt/williamos/source/terragroq"
    const alternatesPath = `${checkoutRoot}/.git/objects/info/alternates`
    const virtual = injectedLinuxFs({ existing: [{ path: alternatesPath, kind: "file" }] })

    expect(() => assertNoGitAlternates(checkoutRoot, virtual.fsApi)).toThrow(expect.objectContaining({
      code: "AEGIS_PROVISION_CHECKOUT_ALTERNATES_REJECTED",
    }))

    const source = fs.readFileSync(applyModulePath, "utf8")
    const sourceFence = source.indexOf("assertNoGitAlternates(checkoutRoot, fsApi)")
    const sourceGitInspection = source.indexOf('runFixedGit(["-C", lexical, "rev-parse", "--show-toplevel"]')
    const clone = source.indexOf('runFixedGit(["clone", "--local", "--no-hardlinks", "--no-checkout"')
    const stagingFence = source.indexOf("assertNoGitAlternates(temporary, fsApi)", clone)
    const stagingGitUse = source.indexOf('runFixedGit(["-C", temporary, "remote", "set-url"', clone)

    expect(sourceFence).toBeGreaterThanOrEqual(0)
    expect(sourceFence).toBeLessThan(sourceGitInspection)
    expect(clone).toBeGreaterThanOrEqual(0)
    expect(stagingFence).toBeGreaterThan(clone)
    expect(stagingFence).toBeLessThan(stagingGitUse)
  })

  it.each([
    ["dirty checkout", { sourcePath: repoRoot, repository: "bsvalues/terragroq", headCommit: manifest().trustedMain.commit, clean: false, gitMetadata: true }],
    ["missing Git metadata", { sourcePath: repoRoot, repository: "bsvalues/terragroq", headCommit: manifest().trustedMain.commit, clean: true, gitMetadata: false }],
    ["wrong head", { sourcePath: repoRoot, repository: "bsvalues/terragroq", headCommit: "0".repeat(40), clean: true, gitMetadata: true }],
  ])("rejects %s inspection before authority consumption", (_label, inspection) => {
    const checkoutApi = { inspect: () => inspection, publish: () => { throw new Error("UNREACHABLE") } }
    const { virtual, options } = implementationInput({ mode: "apply", checkoutApi })

    expect(() => applyAegisStandingHashPrerequisites(options)).toThrow(expect.objectContaining({
      code: "AEGIS_PROVISION_CHECKOUT_INSPECTION_INVALID",
    }))
    expect(journalRecords(virtual, options.authority.authorityId)).toEqual([])
  })

  it.each([
    ["wrong algorithm", TRANSPORT_PUBLIC_KEY.replace("ssh-ed25519", "ssh-rsa"), "AEGIS_PROVISION_PUBLIC_KEY_INVALID"],
    ["multiple records", TRANSPORT_PUBLIC_KEY + "\n" + TRANSPORT_PUBLIC_KEY, "AEGIS_PROVISION_PUBLIC_KEY_INVALID"],
    ["key binding drift", TRANSPORT_PUBLIC_KEY.replace("WlWVy", "WlWVz"), "AEGIS_PROVISION_KEY_GENERATION_EVIDENCE_INVALID"],
  ])("rejects %s public key before authority consumption", (_label, publicKey, code) => {
    const authority = applyAuthority()
    const { virtual, options } = implementationInput({ authority, publicKey, mode: "apply" })
    try {
      applyAegisStandingHashPrerequisites(options)
      throw new Error("EXPECTED_REJECTION")
    } catch (error) {
      expect(errorCode(error)).toBe(code)
    }
    expect(journalRecords(virtual, authority.authorityId)).toEqual([])
  })

  it("keeps partial failure authority consumed and durably evidenced", () => {
    const authority = applyAuthority()
    const failedPath = "/usr/local/libexec/williamos/aegis-standing-hash-ssh-entrypoint.mjs"
    const { virtual, options } = implementationInput({
      authority,
      mode: "apply",
      virtualOptions: { failPath: failedPath },
    })

    try {
      applyAegisStandingHashPrerequisites(options)
      throw new Error("EXPECTED_REJECTION")
    } catch (error) {
      expect(error).toMatchObject({
        code: "AEGIS_PROVISION_PARTIAL_STATE_AMBIGUOUS",
        authorityConsumed: true,
      })
    }
    const records = journalRecords(virtual, authority.authorityId)
    expect(records[0].record_type).toBe("AUTHORITY_CONSUMED")
    expect(records.at(-1)).toMatchObject({
      record_type: "APPLY_FAILED_PARTIAL_STATE",
      failure_code: "EIO",
    })
    const journalPath = virtual.pathOf("/var/lib/williamos-aegis-standing-hash-" + authority.authorityId + ".mutation-journal.jsonl")
    const journalWrites = virtual.events.filter(({ kind, path: target }) => kind === "write" && target === journalPath)
    const journalFsyncs = virtual.events.filter(({ kind, path: target }) => kind === "fsync" && target === journalPath)
    expect(journalFsyncs).toHaveLength(journalWrites.length)
  })

  it("retains combined mutation and identity-restoration failure evidence in the journal and CLI shape", () => {
    const authority = applyAuthority()
    const { virtual, options } = implementationInput({
      authority,
      mode: "apply",
      virtualOptions: { failPath: "/var/lib/williamos/fabric/standing-hash-requests" },
      processFailure: { operation: "restore-egid", occurrence: 2 },
    })
    let caught: any
    try {
      applyAegisStandingHashPrerequisites(options)
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({
      code: "AEGIS_PROVISION_PARTIAL_STATE_AMBIGUOUS",
      originalFailureCode: "EIO",
      restoreFailureCode: "AEGIS_PROVISION_PRIVILEGE_RESTORE_FAILED",
      restoreFailureReason: "root applier identity restoration failed",
      restoreFailureCauseCode: "EPERM",
      authorityConsumed: true,
    })
    expect(journalRecords(virtual, authority.authorityId).at(-1)).toMatchObject({
      record_type: "APPLY_FAILED_PARTIAL_STATE",
      failure_code: "EIO",
      restore_failure_code: "AEGIS_PROVISION_PRIVILEGE_RESTORE_FAILED",
      restore_failure_reason: "root applier identity restoration failed",
      restore_failure_cause_code: "EPERM",
    })
    expect(standingProvisioningErrorEvidence(caught)).toMatchObject({
      code: "AEGIS_PROVISION_PARTIAL_STATE_AMBIGUOUS",
      original_failure_code: "EIO",
      restore_failure_code: "AEGIS_PROVISION_PRIVILEGE_RESTORE_FAILED",
      restore_failure_reason: "root applier identity restoration failed",
      restore_failure_cause_code: "EPERM",
      authority_consumed: true,
    })
  })

  it("returns a typed evidence failure when partial-state journaling cannot be retained", () => {
    const authority = applyAuthority()
    const failedPath = "/usr/local/libexec/williamos/aegis-standing-hash-ssh-entrypoint.mjs"
    const { options } = implementationInput({
      authority,
      mode: "apply",
      virtualOptions: {
        failPath: failedPath,
        failJournalRecordType: "APPLY_FAILED_PARTIAL_STATE",
      },
    })

    expect(() => applyAegisStandingHashPrerequisites(options)).toThrow(expect.objectContaining({
      code: "AEGIS_PROVISION_EVIDENCE_WRITE_FAILED",
      causeCode: "EIO",
      originalFailureCode: "EIO",
      authorityConsumed: true,
    }))
  })

  it("retains restoration evidence when partial-state journaling also fails", () => {
    const authority = applyAuthority()
    const { options } = implementationInput({
      authority,
      mode: "apply",
      virtualOptions: {
        failPath: "/var/lib/williamos/fabric/standing-hash-requests",
        failJournalRecordType: "APPLY_FAILED_PARTIAL_STATE",
      },
      processFailure: { operation: "restore-egid", occurrence: 2 },
    })
    expect(() => applyAegisStandingHashPrerequisites(options)).toThrow(expect.objectContaining({
      code: "AEGIS_PROVISION_EVIDENCE_WRITE_FAILED",
      originalFailureCode: "EIO",
      restoreFailureCode: "AEGIS_PROVISION_PRIVILEGE_RESTORE_FAILED",
      restoreFailureReason: "root applier identity restoration failed",
      restoreFailureCauseCode: "EPERM",
      authorityConsumed: true,
    }))
  })

  it("has only fixed local Git publication and no shell, network, private-key, scheduler, or workload surface", () => {
    const source = fs.readFileSync(applyModulePath, "utf8")

    expect(source).not.toMatch(/node:(?:net|http|https|tls|dgram|dns)/)
    expect(source).not.toMatch(/(?<!\.)\b(?:exec|execSync|execFile|execFileSync|fork|fetch|WebSocket)\s*\(/)
    expect(source).toContain('const GIT_EXECUTABLE = "/usr/bin/git"')
    expect(source).toContain('import { canonicalizeJcs } from "../canonical-json.mjs"')
    expect(source).toContain("const canonicalize = canonicalizeJcs")
    expect(source).toContain("shell: false")
    expect(source).toContain('"-c", "core.fsmonitor=false"')
    expect(source).toContain('GIT_TERMINAL_PROMPT: "0"')
    expect(source).toContain("validateLocalGitConfig(lexical, fsApi)")
    expect(source).toContain('stats.uid !== 0 || stats.gid !== 0 || (stats.mode & 0o022) !== 0')
    expect(source).toContain('fsApi.mkdirSync(destination, { recursive: false, mode: 0o700 })')
    expect(source).toContain("fsApi.chmodSync(destination, 0o755)")
    expect(source).not.toContain("fsApi.renameSync(temporary, destination)")
    expect(source).toContain("if (!path.posix.isAbsolute(targetPath))")
    expect(source).toContain("if (temporaryCreated) {")
    expect(source).not.toMatch(/runFixedGit\(\[\s*["'](?:fetch|pull|push)["']/)
    expect(source).not.toMatch(/\b(?:readPrivateKey|writePrivateKey)\b/)
    expect(source).not.toMatch(/\b(?:start|run|enable|activate)Scheduler\s*\(|\b(?:run|execute|invoke)Workload\s*\(/i)
    const { options } = implementationInput({ mode: "apply" })
    expect(applyAegisStandingHashPrerequisites(options)).toMatchObject({
      workload_executed: false,
      scheduler_activated: false,
      next_non_root_step: {
        status: "REQUIRED_NOT_RUN",
        reason_code: "AEGIS_REPLAY_EPOCH_INITIALIZATION_REQUIRED",
      },
    })
  })
})
