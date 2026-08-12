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
  LEGACY_KEY_GENERATION_MANIFEST_SHA256,
  applyAegisStandingHashPrerequisites,
  assertNoGitAlternates,
  standingProvisioningErrorEvidence,
  validateHermesKeyGenerationEvidence,
} from "../scripts/execution-fabric/provision/apply-aegis-standing-hash-prerequisites.mjs"
import { canonicalizeJcs } from "../scripts/execution-fabric/canonical-json.mjs"
import {
  PREVIOUS_JOURNAL_PREFIX,
  REPAIR_JOURNAL_PREFIX,
  TARGET_PATH as CANONICAL_JSON_TARGET,
  canonicalJsonRepairErrorEvidence,
  canonicalizeRepairJcs,
  repairAegisStandingHashCanonicalJson,
  validateHistoricalReleaseRoot,
  validateHistoricalRootMutationIds,
} from "../scripts/execution-fabric/provision/repair-aegis-standing-hash-canonical-json.mjs"

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
type JsonObject = { [key: string]: JsonValue | undefined }
type ManifestBinding = { path: string, sha256: string, textNormalization: string }
type RootOwnedAsset = JsonObject & {
  id: string, path: string, type: string, owner: string, group: string, mode: string, direct: boolean, singleLink: boolean,
}
type RuntimeRoot = JsonObject & { path: string }
type RootMutation = JsonObject & { id: string }
type RepairMutation = JsonObject & { type: string, path: string, id?: string, sha256?: string }
type InstalledAsset = JsonObject & { id: string, path: string, sha256: string, mode: string }
type RepairManifest = JsonObject & {
  id: string
  sourcePath: string
  previousAppliedManifestSha256: string
  previousRootMutationIds: string[]
  previousPlannedMutations: RepairMutation[]
  installedAssets: InstalledAsset[]
  authorizedKeysPath: string
  trustedReleaseManifestPath: string
}
type ProvisioningManifest = {
  [key: string]: unknown
  schemaVersion: number
  packageId: string
  issue: { number: number, workOrderId: string }
  trustedMain: { repository: string, ref: string, commit: string }
  identity: { hostname: string, machineIdSha256: string, account: string }
  reviewedRelease: {
    repository: string, ref: string, commit: string, releaseRoot: string, releaseManifestPath: string,
    manifestSchemaVersion: string, runtimeClosurePaths: string[], bootstrapSourcePath: string,
  }
  bindings: ManifestBinding[]
  rootOwnedAssets: RootOwnedAsset[]
  existingRuntimeRoots: RuntimeRoot[]
  rootMutations: RootMutation[]
  invocationBoundary: JsonObject
  standingExecutionBoundary: JsonObject
  blockedScope: string[]
  repair: RepairManifest
}
type MutableAuthority = JsonObject & { authorityId: string, rootMutationIds: string[] }
type FixtureProcessApi = { platform: string, getuid?: () => number, [key: string]: unknown }
type FixtureEvent = JsonObject & { kind: string, path?: string, mode?: number }
type ReadyObservation = JsonObject & {
  identity: JsonObject
  reviewedRelease: JsonObject
  rootOwnedAssets: Record<string, JsonObject>
  existingRuntimeRoots: Record<string, JsonObject>
  privateRoots: Record<string, JsonObject>
  replayJournal: JsonObject
  invocationBoundary: JsonObject
  standingExecutionBoundary: JsonObject
}
type ApplyFixtureOptions = NonNullable<Parameters<typeof applyAegisStandingHashPrerequisites>[0]> & {
  authority: MutableAuthority
}
type CheckoutInput = { sourcePath: string, expected: { repository: string, commit: string } }
type CheckoutPublishInput = CheckoutInput & { destination: string }
type RepairFixtureOptions = NonNullable<Parameters<typeof repairAegisStandingHashCanonicalJson>[0]> & {
  authority: RepairAuthority
}
type RepairAuthority = JsonObject & {
  authorityId: string
  previousProvisioningJournalSha256: string
  sourceSha256: string
}
type JournalRecord = JsonObject & {
  record_type?: string
  sequence?: number
  status?: string
  type?: string
  id?: string
  path?: string
  source_path?: string
  commit?: string
  sha256?: string
  planned_mutations?: RepairMutation[]
}

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

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseJsonObject(text: string): JsonObject {
  const value: unknown = JSON.parse(text)
  if (!isJsonObject(value)) throw new TypeError("expected a JSON object")
  return value
}

function isStringArray(value: JsonValue | undefined): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
}

function isRepairMutation(value: JsonValue): value is RepairMutation {
  return isJsonObject(value) && typeof value.type === "string" && typeof value.path === "string"
}

function isInstalledAsset(value: JsonValue): value is InstalledAsset {
  return isJsonObject(value) && typeof value.id === "string" && typeof value.path === "string"
    && typeof value.sha256 === "string" && typeof value.mode === "string"
}

function isProvisioningManifest(value: JsonObject): value is ProvisioningManifest & JsonObject {
  const trustedMain = value.trustedMain
  const identity = value.identity
  const reviewedRelease = value.reviewedRelease
  const repair = value.repair
  return typeof value.schemaVersion === "number" && typeof value.packageId === "string"
    && isJsonObject(value.issue) && isJsonObject(trustedMain) && typeof trustedMain.commit === "string"
    && typeof trustedMain.repository === "string" && typeof trustedMain.ref === "string"
    && isJsonObject(identity) && typeof identity.hostname === "string" && typeof identity.machineIdSha256 === "string"
    && typeof identity.account === "string" && isJsonObject(reviewedRelease)
    && typeof reviewedRelease.releaseRoot === "string" && isStringArray(reviewedRelease.runtimeClosurePaths)
    && Array.isArray(value.bindings) && value.bindings.every((entry) => isJsonObject(entry)
      && typeof entry.path === "string" && typeof entry.sha256 === "string" && typeof entry.textNormalization === "string")
    && Array.isArray(value.rootOwnedAssets) && Array.isArray(value.existingRuntimeRoots) && Array.isArray(value.rootMutations)
    && isJsonObject(value.invocationBoundary) && isJsonObject(value.standingExecutionBoundary)
    && isStringArray(value.blockedScope) && isJsonObject(repair) && typeof repair.id === "string"
    && typeof repair.sourcePath === "string" && typeof repair.previousAppliedManifestSha256 === "string"
    && isStringArray(repair.previousRootMutationIds) && Array.isArray(repair.previousPlannedMutations)
    && repair.previousPlannedMutations.every(isRepairMutation) && Array.isArray(repair.installedAssets)
    && repair.installedAssets.every(isInstalledAsset) && typeof repair.authorizedKeysPath === "string"
    && typeof repair.trustedReleaseManifestPath === "string"
}

function manifest(): ProvisioningManifest {
  const value = parseJsonObject(fs.readFileSync(manifestPath, "utf8"))
  if (!isProvisioningManifest(value)) throw new TypeError("invalid provisioning manifest fixture")
  return value
}

function requiredBinding(value: ProvisioningManifest, bindingPath: string) {
  const binding = value.bindings.find((candidate) => candidate.path === bindingPath)
  if (!binding) throw new Error(`missing manifest binding: ${bindingPath}`)
  return binding
}

function readyObservation(value = manifest()): ReadyObservation {
  const exactClosure = Object.fromEntries(
    value.reviewedRelease.runtimeClosurePaths.map((closurePath: string) => {
      const binding = requiredBinding(value, closurePath)
      return [closurePath, binding.sha256]
    }),
  )
  const rootOwnedAssets = Object.fromEntries(
    value.rootOwnedAssets.map((asset) => [
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
    existingRuntimeRoots: Object.fromEntries(value.existingRuntimeRoots.map((root) => [
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

function proposedAuthority(value = manifest()): MutableAuthority {
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
    rootMutationIds: value.rootMutations.map(({ id }) => id),
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
        sourceAddress: "192.168.88.9",
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
      repair: {
        id: "aegis-standing-hash-canonical-json-repair-v1",
        sourcePath: "scripts/execution-fabric/canonical-json.mjs",
        targetPath: "/usr/local/libexec/canonical-json.mjs",
        previousAppliedManifestSha256: "adb43b325199e3eb167298887ed01e7c434a88b0838ace17f1086132ae0f46ec",
        previousProvisioningJournalRequired: true,
        authorityMaximumAgeSeconds: 900,
        singleUseAuthorityRequired: true,
        missingTargetOnly: true,
        overwriteAllowed: false,
        adoptionAllowed: false,
        atomicExclusiveInstallRequired: true,
        durableRepairJournalRequired: true,
        networkAllowed: false,
        schedulerAllowed: false,
        workloadAllowed: false,
      },
    })
    expect(value.bindings).toEqual([
      { path: "scripts/execution-fabric/bounded-dispatch/bootstrap-aegis-standing-hash.mjs", sha256: "7d4b713c00f73726ce39f20856c53a69865968d98d2daf08e2ce038c612ce14b", textNormalization: "LF" },
      { path: "scripts/execution-fabric/bounded-dispatch/run-resident-aegis-standing-hash.mjs", sha256: "1e817dc0c87803a93d503d29183b6af66bd776173812d0270985b5e261db54a1", textNormalization: "LF" },
      { path: "scripts/execution-fabric/bounded-dispatch/aegis-standing-hash-runtime.mjs", sha256: "eb1cf0517caf3a4c4a1935ed8bea73c53fed64cc1ad3effa3963e6e237c22be2", textNormalization: "LF" },
      { path: "scripts/execution-fabric/bounded-dispatch/aegis-hash-core.mjs", sha256: "c5965a206b5f26c0db21176a609775d1ca176409b644bbc241fde74565bd8d8f", textNormalization: "LF" },
      { path: "scripts/execution-fabric/admission/evaluate-aegis-standing-authority.mjs", sha256: "0775904a9ceb7fae71e1ce9100f5017c5f05885c1a16e380f52971a4ac4665f8", textNormalization: "LF" },
      { path: "scripts/execution-fabric/canonical-json.mjs", sha256: "b1df628a845cdb43374e5850bb4e1b43cd203eb4baf9c0a32244578112ad9b21", textNormalization: "LF" },
      { path: "scripts/execution-fabric/provision/aegis-standing-hash-ssh-entrypoint.mjs", sha256: "ebcf0d068e11c1a3f98b515f9a59a456955d8d30abdbb8bab7897b9b315caf9a", textNormalization: "LF" },
      { path: "scripts/execution-fabric/provision/aegis-standing-hash-replay-epoch.mjs", sha256: "c796c9742052ada8e7744385a55ca630245a236a694632566ec0e1a232f40802", textNormalization: "LF" },
      { path: "scripts/execution-fabric/provision/apply-aegis-standing-hash-prerequisites.mjs", sha256: "05724974cd0248fd30aaeb1483649a1d908e3d9f4d5a29019c0df1194cb0a222", textNormalization: "LF" },
      { path: "scripts/execution-fabric/provision/create-hermes-aegis-standing-hash-key.mjs", sha256: "72d343f3cdae8e84acc31edf7726982f4596a9a0cdd1c37692f2b85db009aeba", textNormalization: "LF" },
      { path: "scripts/execution-fabric/provision/repair-aegis-standing-hash-canonical-json.mjs", sha256: "2ac9e9fa764f3882b4de34c9c8efe9b12e2548e57ecefe4c0d097b7c41f08b92", textNormalization: "LF" },
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
    Reflect.deleteProperty(observed, "replayJournal")

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
    Reflect.deleteProperty(missing, "existingRuntimeRoots")
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
      manifest().rootOwnedAssets.map(({ id }) => [id, { exists: false }]),
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
      { id: "INSTALL_ROOT_OWNED_CANONICAL_JSON", asset: "rootOwnedAssets.canonical-json" },
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
    ["consumed", (authority: JsonObject) => { authority.consumed = true }, "2026-08-11T18:05:00.000Z", "PROVISIONING_AUTHORITY_CONSUMED"],
    ["expired", () => {}, "2026-08-11T18:15:00.000Z", "PROVISIONING_AUTHORITY_EXPIRED"],
    ["extra field", (authority: JsonObject) => { authority.unreviewed = true }, "2026-08-11T18:05:00.000Z", "PROVISIONING_AUTHORITY_INVALID"],
    ["malformed consumed", (authority: JsonObject) => { authority.consumed = true; authority.unreviewed = true }, "2026-08-11T18:05:00.000Z", "PROVISIONING_AUTHORITY_INVALID"],
    ["noncanonical timestamp", (authority: JsonObject) => { authority.issuedAt = "2026-08-11T18:00:00Z" }, "2026-08-11T18:05:00.000Z", "PROVISIONING_AUTHORITY_EXPIRED"],
    ["relative checkout", (authority: JsonObject) => { authority.reviewedCheckoutSourcePath = "tmp/checkout" }, "2026-08-11T18:05:00.000Z", "PROVISIONING_AUTHORITY_SCOPE_MISMATCH"],
    ["non-normalized checkout", (authority: JsonObject) => { authority.reviewedCheckoutSourcePath = "/opt/williamos/source/../source/terragroq" }, "2026-08-11T18:05:00.000Z", "PROVISIONING_AUTHORITY_SCOPE_MISMATCH"],
    ["scope mismatch", (authority: JsonObject & { rootMutationIds: string[] }) => { authority.rootMutationIds = [...authority.rootMutationIds].reverse() }, "2026-08-11T18:05:00.000Z", "PROVISIONING_AUTHORITY_SCOPE_MISMATCH"],
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
    const packageFiles = [manifestRelativePath, ...value.bindings.map(({ path: bindingPath }) => bindingPath)]
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
function keyGenerationEvidence(value = manifest(), publicKey = TRANSPORT_PUBLIC_KEY): JsonObject {
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
    sourceAddress: "192.168.88.9",
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

describe("dedicated key generation evidence compatibility", () => {
  it("rejects null evidence with the contract-specific failure code", () => {
    expect(() => validateHermesKeyGenerationEvidence(manifest(), null, {
      fingerprint: publicKeyFingerprint(),
      fileSha256: publicKeySha256(),
    })).toThrow(expect.objectContaining({ code: "AEGIS_PROVISION_KEY_GENERATION_EVIDENCE_INVALID" }))
  })

  it("accepts the exact reviewed pre-remediation manifest generation", () => {
    const approvedHistoricalManifestSha256 =
      "5774d4e98ba2620a9bf0433c00c795f69357ef473e91d85e6e8338ada8c2821c"
    expect(LEGACY_KEY_GENERATION_MANIFEST_SHA256).toBe(approvedHistoricalManifestSha256)
    const value = manifest()
    const evidence = keyGenerationEvidence(value)
    evidence.manifestSha256 = approvedHistoricalManifestSha256
    evidence.sourceAddress = "192.168.1.154"

    expect(validateHermesKeyGenerationEvidence(value, evidence, {
      fingerprint: publicKeyFingerprint(),
      fileSha256: publicKeySha256(),
    })).toMatchObject({ evidence })
  })

  it("rejects any other stale key-generation manifest", () => {
    const value = manifest()
    const evidence = keyGenerationEvidence(value)
    evidence.manifestSha256 = "0".repeat(64)

    expect(() => validateHermesKeyGenerationEvidence(value, evidence, {
      fingerprint: publicKeyFingerprint(),
      fileSha256: publicKeySha256(),
    })).toThrow(expect.objectContaining({ code: "AEGIS_PROVISION_KEY_GENERATION_EVIDENCE_INVALID" }))
  })

  it("rejects the historical manifest with a non-historical source address", () => {
    const value = manifest()
    const evidence = keyGenerationEvidence(value)
    evidence.manifestSha256 = LEGACY_KEY_GENERATION_MANIFEST_SHA256

    expect(() => validateHermesKeyGenerationEvidence(value, evidence, {
      fingerprint: publicKeyFingerprint(),
      fileSha256: publicKeySha256(),
    })).toThrow(expect.objectContaining({ code: "AEGIS_PROVISION_KEY_GENERATION_EVIDENCE_INVALID" }))
  })
})

function applyAuthority(value = manifest(), evidence = keyGenerationEvidence(value), publicKey = TRANSPORT_PUBLIC_KEY, sourcePath = reviewedCheckoutSourcePath): MutableAuthority {
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
  'from="192.168.88.9"',
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
    bytes?: Buffer
    nlink?: number
  }>
  failPath?: string
  failWritePath?: string
  partialWrite?: { path: string, recordType: string, bytes: number }
  failFsync?: { path: string, occurrence: number }
  failJournalRecordType?: string
} = {}) {
  const nodes = new Map<string, VirtualNode>()
  const descriptors = new Map<number, { kind: "real" | "virtual", fd?: number, path?: string }>()
  const virtualOpenFlags = new Map<number, number>()
  const virtualWriteOffsets = new Map<number, number>()
  const fsyncCounts = new Map<string, number>()
  let partialWriteInjected = false
  const events: FixtureEvent[] = []
  let identityProvider = () => ({ uid: 0, gid: 0 })
  let nextDescriptor = 10_000
  let nextInode = 100
  const normalize = (candidate: fs.PathLike) => String(candidate).startsWith("/")
    ? path.posix.resolve(String(candidate))
    : path.resolve(String(candidate))
  const node = (kind: VirtualNode["kind"], mode: number, bytes: Buffer = Buffer.alloc(0), uid = 0, gid = 0): VirtualNode => ({
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
    const installed = node(
      kind,
      entry.mode ?? (kind === "directory" ? 0o755 : 0o644),
      entry.bytes ?? Buffer.alloc(0),
      entry.uid ?? 0,
      entry.gid ?? 0,
    )
    if (entry.nlink !== undefined) installed.nlink = entry.nlink
    nodes.set(normalize(entry.path), installed)
  }
  const failPath = options.failPath ? normalize(options.failPath) : null
  const failWritePath = options.failWritePath ? normalize(options.failWritePath) : null
  const missing = () => Object.assign(new Error("ENOENT"), { code: "ENOENT" })
  const stats = (value: VirtualNode) => ({
    ...value,
    size: value.bytes.length,
    isFile: () => value.kind === "file",
    isDirectory: () => value.kind === "directory",
    isSymbolicLink: () => value.kind === "symlink",
  })
  function readVirtualFileSync(candidate: number | fs.PathLike): Buffer
  function readVirtualFileSync(candidate: number | fs.PathLike, encoding: BufferEncoding): string
  function readVirtualFileSync(candidate: number | fs.PathLike, encoding?: BufferEncoding): Buffer | string {
    if (typeof candidate !== "number") {
      return encoding ? fs.readFileSync(candidate, { encoding }) : fs.readFileSync(candidate)
    }
    const value = descriptors.get(candidate)
    if (!value) throw new Error("BAD_DESCRIPTOR")
    if (value.kind === "real") {
      return encoding ? fs.readFileSync(value.fd!, { encoding }) : fs.readFileSync(value.fd!)
    }
    const bytes = Buffer.from(nodes.get(value.path!)!.bytes)
    return encoding ? bytes.toString(encoding) : bytes
  }
  const isRepoPath = (candidate: fs.PathLike) => {
    const relative = path.relative(repoRoot, normalize(candidate))
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
  }
  const api = {
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
        if (target === failPath || (failPath && target.startsWith(`${failPath}.`))) {
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
    readFileSync: readVirtualFileSync,
    closeSync(descriptor: number) {
      const value = descriptors.get(descriptor)
      if (!value) throw new Error("BAD_DESCRIPTOR")
      if (value.kind === "real") fs.closeSync(value.fd!)
      descriptors.delete(descriptor)
      virtualOpenFlags.delete(descriptor)
      virtualWriteOffsets.delete(descriptor)
      events.push({ kind: "close", descriptor })
    },
    mkdirSync(candidate: fs.PathLike, config: { mode?: number }) {
      const target = normalize(candidate)
      if (target === failPath) throw Object.assign(new Error("INJECTED_WRITE_FAILURE"), { code: "EIO" })
      if (nodes.has(target)) throw Object.assign(new Error("EEXIST"), { code: "EEXIST" })
      const identity = identityProvider()
      nodes.set(target, node("directory", config.mode ?? 0o777, Buffer.alloc(0), identity.uid, identity.gid))
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
      if (failWritePath && (target === failWritePath || target.startsWith(`${failWritePath}.`))) {
        throw Object.assign(new Error("INJECTED_WRITE_FAILURE"), { code: "EIO" })
      }
      const bytes = Buffer.from(data.buffer, data.byteOffset + offset, length)
      const partial = options.partialWrite
      if (!partialWriteInjected && partial && target === normalize(partial.path)
        && bytes.toString("utf8").includes(`\"record_type\":\"${partial.recordType}\"`)) {
        const retained = bytes.subarray(0, Math.min(partial.bytes, bytes.length))
        value.bytes = Buffer.concat([value.bytes, retained])
        partialWriteInjected = true
        events.push({ kind: "partial-write", path: target, bytes: retained.length })
        throw Object.assign(new Error("INJECTED_PARTIAL_WRITE_FAILURE"), { code: "EIO" })
      }
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
      const count = (fsyncCounts.get(target) ?? 0) + 1
      fsyncCounts.set(target, count)
      events.push({ kind: "fsync", path: target })
      if (options.failFsync && target === normalize(options.failFsync.path)
        && count === options.failFsync.occurrence) {
        throw Object.assign(new Error("INJECTED_FSYNC_FAILURE"), { code: "EIO" })
      }
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
    readdirSync(candidate: fs.PathLike) {
      const directory = normalize(candidate)
      const prefix = `${directory}/`
      return [...nodes.keys()]
        .filter((entry) => entry.startsWith(prefix) && !entry.slice(prefix.length).includes("/"))
        .map((entry) => entry.slice(prefix.length))
    },
    renameSync(oldPath: fs.PathLike, newPath: fs.PathLike) {
      const source = normalize(oldPath)
      const target = normalize(newPath)
      const value = nodes.get(source)
      if (!value) throw missing()
      if (nodes.has(target)) throw Object.assign(new Error("EEXIST"), { code: "EEXIST" })
      nodes.set(target, value)
      nodes.delete(source)
    },
    rmdirSync(candidate: fs.PathLike) {
      const target = normalize(candidate)
      if ([...nodes.keys()].some((entry) => entry.startsWith(`${target}/`))) {
        throw Object.assign(new Error("ENOTEMPTY"), { code: "ENOTEMPTY" })
      }
      nodes.delete(target)
    },
    rmSync(candidate: fs.PathLike, options: { recursive?: boolean, force?: boolean }) {
      const target = normalize(candidate)
      const matches = [...nodes.keys()].filter((entry) => entry === target || (options.recursive && entry.startsWith(`${target}/`)))
      if (matches.length === 0 && !options.force) throw missing()
      for (const entry of matches) nodes.delete(entry)
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
  const events: FixtureEvent[] = []
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

function implementationInput(overrides: {
  virtualOptions?: Parameters<typeof injectedLinuxFs>[0]
  processFailure?: Parameters<typeof injectedRootProcess>[0]
  publicKey?: string
  keyGenerationEvidence?: JsonObject
  reviewedCheckoutSourcePath?: string
  authority?: MutableAuthority
  checkoutApi?: ApplyFixtureOptions["checkoutApi"]
  mode?: string
  processApi?: FixtureProcessApi
  hostnameApi?: () => string
  clock?: () => string
} = {}) {
  const virtual = injectedLinuxFs(overrides.virtualOptions)
  const rootProcess = injectedRootProcess(overrides.processFailure)
  virtual.setIdentityProvider(rootProcess.identity)
  const publicKey = overrides.publicKey ?? TRANSPORT_PUBLIC_KEY + "\n"
  const normalizedPublicKey = publicKey.trim()
  const keyEvidence = overrides.keyGenerationEvidence ?? keyGenerationEvidence(manifest(), normalizedPublicKey)
  const checkoutSourcePath = overrides.reviewedCheckoutSourcePath ?? reviewedCheckoutSourcePath
  const authority = overrides.authority ?? applyAuthority(manifest(), keyEvidence, normalizedPublicKey, checkoutSourcePath)
  const checkoutApi = overrides.checkoutApi ?? {
    inspect: ({ sourcePath, expected }: CheckoutInput) => ({
      sourcePath,
      repository: expected.repository,
      headCommit: expected.commit,
      clean: true,
      gitMetadata: true,
    }),
    publish: ({ destination, sourcePath, expected }: CheckoutPublishInput) => {
      virtual.installCheckout(destination)
      return { sourcePath, destination, repository: expected.repository, headCommit: expected.commit, clean: true, gitMetadata: true, published: true }
    },
  }
  const packageClosure = new Map(
    manifest().bindings.map(({ path: bindingPath }) => [
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
    } satisfies ApplyFixtureOptions,
    processEvents: rootProcess.events,
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as { code?: string })?.code
}

function isJournalRecord(value: JsonObject): value is JournalRecord {
  return (value.record_type === undefined || typeof value.record_type === "string")
    && (value.sequence === undefined || typeof value.sequence === "number")
    && (value.status === undefined || typeof value.status === "string")
    && (value.type === undefined || typeof value.type === "string")
    && (value.sha256 === undefined || typeof value.sha256 === "string")
    && (value.planned_mutations === undefined || (Array.isArray(value.planned_mutations)
      && value.planned_mutations.every(isRepairMutation)))
}

function parseJournalRecord(line: string): JournalRecord {
  const value = parseJsonObject(line)
  if (!isJournalRecord(value)) throw new TypeError("invalid journal record fixture")
  return value
}

function journalRecords(virtual: ReturnType<typeof injectedLinuxFs>, authorityId: string): JournalRecord[] {
  const journal = virtual.bytesAt("/var/lib/williamos-aegis-standing-hash-" + authorityId + ".mutation-journal.jsonl")
  if (!journal) return []
  const text = journal.toString("utf8").trimEnd()
  return text ? text.split("\n").map(parseJournalRecord) : []
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
    ["package", (authority: MutableAuthority) => { authority.packageId = "other" }, NOW, "AEGIS_PROVISION_AUTHORITY_SCOPE_MISMATCH"],
    ["manifest", (authority: MutableAuthority) => { authority.manifestSha256 = "0".repeat(64) }, NOW, "AEGIS_PROVISION_AUTHORITY_SCOPE_MISMATCH"],
    ["work order", (authority: MutableAuthority) => { authority.workOrderId = "WO-OTHER" }, NOW, "AEGIS_PROVISION_AUTHORITY_SCOPE_MISMATCH"],
    ["mutation order", (authority: MutableAuthority) => { authority.rootMutationIds.reverse() }, NOW, "AEGIS_PROVISION_AUTHORITY_SCOPE_MISMATCH"],
    ["extra field", (authority: MutableAuthority) => { authority.unreviewed = true }, NOW, "AEGIS_PROVISION_AUTHORITY_INVALID"],
    ["checkout source", (authority: MutableAuthority) => { authority.reviewedCheckoutSourcePath = "/tmp/unbound" }, NOW, "AEGIS_PROVISION_AUTHORITY_SCOPE_MISMATCH"],
    ["expired", () => {}, "2026-08-11T18:15:00.000Z", "AEGIS_PROVISION_AUTHORITY_EXPIRED"],
    ["consumed", (authority: MutableAuthority) => { authority.consumed = true }, NOW, "AEGIS_PROVISION_AUTHORITY_REPLAY"],
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
      ["/usr/local/libexec/canonical-json.mjs", 0, 0, 0o444],
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
  ] as const)("rejects preserved %s drift before consuming authority", (_label, existing) => {
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
    let caught: unknown
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

function canonicalDigest(value: unknown): string {
  return crypto.createHash("sha256").update(canonicalizeJcs(value)).digest("hex")
}

function repairFixture(overrides: {
  authority?: (value: RepairAuthority) => void
  clock?: string
  hostname?: string
  machineIdentitySha256?: string
  rootUid?: number
  target?: { kind?: VirtualNode["kind"], mode?: number, bytes?: Buffer }
  priorAsset?: { id: string, kind?: VirtualNode["kind"], mode?: number, bytes?: Buffer }
  previousJournalBytes?: Buffer
  omitMutationPath?: string
  omitArtifactPath?: string
  mutateHistoricalPlan?: (planned: RepairMutation[]) => void
  mutateHistoricalRecords?: (records: JournalRecord[], planned: RepairMutation[]) => void
  directoryDrift?: { path: string, uid?: number, gid?: number, mode?: number }
  gitConfigBytes?: Buffer
  gitOrigin?: string
  gitStatus?: string
  gitSymbolicHead?: boolean
  gitAlternates?: boolean
  trackedModes?: Record<string, "100644" | "100755">
  checkoutFileMode?: { path: string, mode: number }
  checkoutAncestorDrift?: { path: string, kind?: VirtualNode["kind"], mode?: number, uid?: number, gid?: number }
  targetParentDrift?: { kind?: VirtualNode["kind"], mode?: number, uid?: number, gid?: number }
  failPath?: string
  failWritePath?: string
  partialWrite?: { recordType: string, bytes: number }
  failFsync?: { path: "repair-journal" | "journal-parent", occurrence: number }
} = {}) {
  const value = manifest()
  const repair = value.repair
  const binding = requiredBinding(value, repair.sourcePath)
  const releaseBody = {
    schema_version: value.reviewedRelease.manifestSchemaVersion,
    repository: value.trustedMain.repository,
    trusted_ref: value.trustedMain.ref,
    head_commit: value.trustedMain.commit,
    release_root: value.reviewedRelease.releaseRoot,
    reviewed: true,
    deployed_at: NOW,
    file_sha256: Object.fromEntries(value.reviewedRelease.runtimeClosurePaths.map((relativePath: string) => [
      relativePath,
      requiredBinding(value, relativePath).sha256,
    ])),
  }
  const release = { ...releaseBody, release_manifest_sha256: canonicalDigest(releaseBody) }
  const releaseBytes = Buffer.from(`${canonicalizeJcs(release)}\n`, "utf8")
  const previousAuthorityId = "9d730a84-0000-4000-8000-000000000001"
  const repairAuthorityId = "9d730a84-0000-4000-8000-000000000002"
  const repairJournalPath = `${REPAIR_JOURNAL_PREFIX}${repairAuthorityId}.journal.jsonl`
  const sourceById: Record<string, string> = {
    bootstrap: "scripts/execution-fabric/bounded-dispatch/bootstrap-aegis-standing-hash.mjs",
    "ssh-entrypoint": "scripts/execution-fabric/provision/aegis-standing-hash-ssh-entrypoint.mjs",
    "replay-epoch-initializer": "scripts/execution-fabric/provision/aegis-standing-hash-replay-epoch.mjs",
  }
  const historicalAuthorizedKeyRecord = authorizedKeyRecord.replace(/ williamos-aegis-standing-hash$/, "")
  const authorizedKeyBytes = Buffer.from(`${historicalAuthorizedKeyRecord}\n`, "utf8")
  const planned: RepairMutation[] = [
    { type: "CREATE_DIRECTORY", path: "/opt/williamos" },
    { type: "CREATE_DIRECTORY", path: "/opt/williamos/releases" },
    { type: "CREATE_DIRECTORY", path: "/usr/local/libexec/williamos" },
    { type: "CREATE_DIRECTORY", path: "/etc/williamos" },
    { type: "CREATE_DIRECTORY", path: "/etc/williamos/fabric" },
    { type: "CREATE_DIRECTORY", path: "/var/lib/williamos/fabric/standing-hash-requests" },
    { type: "CREATE_DIRECTORY", path: "/var/lib/williamos/fabric/standing-hash-ledger" },
    { type: "CREATE_DIRECTORY", path: "/var/lib/williamos/fabric/ledger" },
    { type: "CREATE_DIRECTORY", path: "/home/williamos-fabric/.ssh" },
    {
      type: "INSTALL_REVIEWED_CHECKOUT",
      path: value.reviewedRelease.releaseRoot,
      source_path: "/opt/williamos/source/terragroq",
      commit: value.trustedMain.commit,
    },
    ...repair.installedAssets.map((asset) => ({
      type: "INSTALL_FILE",
      id: asset.id,
      path: asset.path,
    })),
    {
      type: "INSTALL_FILE",
      id: "authorized-keys",
      path: repair.authorizedKeysPath,
    },
    {
      type: "INSTALL_FILE",
      id: "release-manifest",
      path: repair.trustedReleaseManifestPath,
    },
  ].filter(({ path: operationPath }) => operationPath !== overrides.omitMutationPath)
  overrides.mutateHistoricalPlan?.(planned)
  const recordedFileSha256: Record<string, string> = {
    ...Object.fromEntries(repair.installedAssets.map(({ id, sha256 }) => [id, sha256])),
    "authorized-keys": crypto.createHash("sha256").update(authorizedKeyBytes).digest("hex"),
    "release-manifest": crypto.createHash("sha256").update(releaseBytes).digest("hex"),
  }
  const records: JournalRecord[] = [{
    schema_version: "1.0-aegis-standing-hash-mutation-journal",
    record_type: "AUTHORITY_CONSUMED",
    sequence: 0,
    authority_id: previousAuthorityId,
    authority_sha256: "a".repeat(64),
    package_id: value.packageId,
    manifest_sha256: repair.previousAppliedManifestSha256,
    consumed_at: NOW,
    planned_mutations: planned,
  }]
  let sequence = 1
  for (const description of planned) {
    const recordedDescription = description.type === "INSTALL_FILE" && typeof description.id === "string"
      ? { ...description, sha256: recordedFileSha256[description.id] }
      : description
    records.push({ record_type: "MUTATION_STARTED", sequence: sequence++, ...recordedDescription })
    records.push({
      record_type: "MUTATION_COMPLETED",
      sequence: sequence++,
      ...recordedDescription,
    })
  }
  records.push({
    record_type: "APPLY_COMPLETE",
    sequence,
    completed_at: NOW,
    completed_mutation_count: planned.length,
    replay_epoch_initialized: false,
    workload_executed: false,
    scheduler_activated: false,
  })
  overrides.mutateHistoricalRecords?.(records, planned)
  const previousJournalBytes = overrides.previousJournalBytes
    ?? Buffer.from(records.map((record) => canonicalizeJcs(record)).join("\n") + "\n", "utf8")
  const previousJournalPath = `${PREVIOUS_JOURNAL_PREFIX}${previousAuthorityId}.mutation-journal.jsonl`
  const gitConfigBytes = overrides.gitConfigBytes ?? Buffer.from([
    "[core]",
    "\trepositoryformatversion = 0",
    "\tfilemode = true",
    "\tbare = false",
    "\tlogallrefupdates = true",
    "[remote \"origin\"]",
    "\turl = https://github.com/bsvalues/terragroq.git",
    "\tfetch = +refs/heads/*:refs/remotes/origin/*",
    "",
  ].join("\n"), "utf8")
  const checkoutAncestorPaths = [...new Set(value.reviewedRelease.runtimeClosurePaths.flatMap((relativePath: string) => {
    const ancestors: string[] = []
    let ancestor = path.posix.dirname(relativePath)
    while (ancestor !== ".") {
      ancestors.push(`${value.reviewedRelease.releaseRoot}/${ancestor}`)
      ancestor = path.posix.dirname(ancestor)
    }
    return ancestors
  }))]
  const existing: NonNullable<Parameters<typeof injectedLinuxFs>[0]>["existing"] = [
    ...(overrides.targetParentDrift ? [{
      path: "/usr/local/libexec",
      kind: overrides.targetParentDrift.kind ?? "directory",
      mode: overrides.targetParentDrift.mode ?? 0o755,
      uid: overrides.targetParentDrift.uid ?? 0,
      gid: overrides.targetParentDrift.gid ?? 0,
    }] : []),
    { path: "/opt/williamos", kind: "directory", mode: 0o755 },
    { path: "/opt/williamos/releases", kind: "directory", mode: 0o755 },
    { path: "/usr/local/libexec/williamos", kind: "directory", mode: 0o755 },
    { path: "/etc/williamos", kind: "directory", mode: 0o755 },
    { path: "/etc/williamos/fabric", kind: "directory", mode: 0o755 },
    { path: "/var/lib/williamos/fabric/standing-hash-requests", kind: "directory", mode: 0o700, uid: 734, gid: 734 },
    { path: "/var/lib/williamos/fabric/standing-hash-ledger", kind: "directory", mode: 0o700, uid: 734, gid: 734 },
    { path: "/var/lib/williamos/fabric/ledger", kind: "directory", mode: 0o700, uid: 734, gid: 734 },
    { path: "/home/williamos-fabric/.ssh", kind: "directory", mode: 0o700, uid: 734, gid: 734 },
    { path: repair.authorizedKeysPath, mode: 0o600, uid: 734, gid: 734, bytes: authorizedKeyBytes },
    { path: value.reviewedRelease.releaseRoot, kind: "directory", mode: 0o755 },
    ...checkoutAncestorPaths.map((ancestorPath) => ({ path: ancestorPath, kind: "directory" as const, mode: 0o755 })),
    { path: `${value.reviewedRelease.releaseRoot}/.git`, kind: "directory", mode: 0o755 },
    { path: `${value.reviewedRelease.releaseRoot}/.git/config`, mode: 0o644, bytes: gitConfigBytes },
    { path: `${value.reviewedRelease.releaseRoot}/.git/HEAD`, mode: 0o444, bytes: Buffer.from(`${value.trustedMain.commit}\n`) },
    { path: previousJournalPath, mode: 0o600, bytes: previousJournalBytes },
    { path: repair.trustedReleaseManifestPath, mode: 0o444, bytes: releaseBytes },
  ]
  for (const relativePath of value.reviewedRelease.runtimeClosurePaths) {
    existing.push({
      path: `${value.reviewedRelease.releaseRoot}/${relativePath}`,
      mode: overrides.trackedModes?.[relativePath] === "100755" ? 0o755 : 0o644,
      bytes: Buffer.from(fs.readFileSync(path.join(repoRoot, ...relativePath.split("/"))).toString("utf8").replace(/\r\n/g, "\n")),
    })
  }
  if (overrides.gitAlternates) existing.push({
    path: `${value.reviewedRelease.releaseRoot}/.git/objects/info/alternates`,
    mode: 0o644,
    bytes: Buffer.from("/foreign/objects\n"),
  })
  for (const asset of repair.installedAssets) {
    const priorOverride = overrides.priorAsset?.id === asset.id ? overrides.priorAsset : undefined
    existing.push({
      path: asset.path,
      kind: priorOverride?.kind ?? "file",
      mode: priorOverride?.mode ?? Number.parseInt(asset.mode, 8),
      bytes: priorOverride?.bytes ?? Buffer.from(
        fs.readFileSync(path.join(repoRoot, ...sourceById[asset.id].split("/"))).toString("utf8").replace(/\r\n/g, "\n"),
        "utf8",
      ),
    })
  }
  if (overrides.target) existing.push({
    path: CANONICAL_JSON_TARGET,
    kind: overrides.target.kind ?? "file",
    mode: overrides.target.mode ?? 0o444,
    bytes: overrides.target.bytes ?? Buffer.from("foreign\n"),
  })
  if (overrides.omitArtifactPath) {
    for (let index = existing.length - 1; index >= 0; index -= 1) {
      const artifactPath = existing[index].path
      if (artifactPath === overrides.omitArtifactPath || artifactPath.startsWith(`${overrides.omitArtifactPath}/`)) {
        existing.splice(index, 1)
      }
    }
  }
  if (overrides.directoryDrift) {
    const artifact = existing.find(({ path: artifactPath }) => artifactPath === overrides.directoryDrift?.path)
    if (!artifact) throw new Error(`unknown directory drift path: ${overrides.directoryDrift.path}`)
    Object.assign(artifact, overrides.directoryDrift)
  }
  if (overrides.checkoutFileMode) {
    const artifact = existing.find(({ path: artifactPath }) => artifactPath === overrides.checkoutFileMode?.path)
    if (!artifact) throw new Error(`unknown checkout file mode path: ${overrides.checkoutFileMode.path}`)
    artifact.mode = overrides.checkoutFileMode.mode
  }
  if (overrides.checkoutAncestorDrift) {
    const artifact = existing.find(({ path: artifactPath }) => artifactPath === overrides.checkoutAncestorDrift?.path)
    if (!artifact) throw new Error(`unknown checkout ancestor path: ${overrides.checkoutAncestorDrift.path}`)
    Object.assign(artifact, overrides.checkoutAncestorDrift)
  }
  const virtual = injectedLinuxFs({
    existing,
    failPath: overrides.failPath,
    failWritePath: overrides.failWritePath,
    partialWrite: overrides.partialWrite ? {
      path: repairJournalPath,
      recordType: overrides.partialWrite.recordType,
      bytes: overrides.partialWrite.bytes,
    } : undefined,
    failFsync: overrides.failFsync ? {
      path: overrides.failFsync.path === "repair-journal" ? repairJournalPath : "/var/lib",
      occurrence: overrides.failFsync.occurrence,
    } : undefined,
  })
  const authority: RepairAuthority = {
    schemaVersion: 1,
    authorityId: repairAuthorityId,
    repairId: repair.id,
    packageId: value.packageId,
    manifestSha256: canonicalDigest(value),
    repository: value.trustedMain.repository,
    trustedMainCommit: value.trustedMain.commit,
    machineIdSha256: value.identity.machineIdSha256,
    previousProvisioningAuthorityId: previousAuthorityId,
    previousProvisioningManifestSha256: repair.previousAppliedManifestSha256,
    previousProvisioningJournalSha256: crypto.createHash("sha256").update(previousJournalBytes).digest("hex"),
    previousProvisioningPlanSha256: canonicalDigest(planned),
    installedReleaseManifestSha256: crypto.createHash("sha256").update(releaseBytes).digest("hex"),
    installedAuthorizedKeysSha256: crypto.createHash("sha256").update(authorizedKeyBytes).digest("hex"),
    installedAssetSha256: Object.fromEntries(repair.installedAssets.map(({ id, sha256 }) => [id, sha256])),
    sourceSha256: binding.sha256,
    targetPath: CANONICAL_JSON_TARGET,
    issuedAt: "2026-08-11T18:00:00.000Z",
    expiresAt: "2026-08-11T18:10:00.000Z",
    singleUse: true,
    consumed: false,
  }
  overrides.authority?.(authority)
  return {
    authority,
    planned,
    records,
    virtual,
    options: {
      authority,
      repoRoot,
      fsApi: virtual.fsApi,
      processApi: { platform: "linux", getuid: () => overrides.rootUid ?? 0 },
      hostname: () => overrides.hostname ?? "aegis",
      clock: () => overrides.clock ?? NOW,
      machineIdentitySha256: overrides.machineIdentitySha256 ?? value.identity.machineIdSha256,
      randomUUID: () => "9d730a84-0000-4000-8000-000000000003",
      gitRunner: (args: string[]) => {
        const operation = args.slice(2).join(" ")
        if (operation === "rev-parse --show-toplevel") {
          return { status: 0, stdout: Buffer.from(value.reviewedRelease.releaseRoot) }
        }
        if (operation === "rev-parse --verify HEAD^{commit}") {
          return { status: 0, stdout: Buffer.from(value.trustedMain.commit) }
        }
        if (operation === "symbolic-ref -q HEAD") {
          return overrides.gitSymbolicHead
            ? { status: 0, stdout: Buffer.from("refs/heads/main\n") }
            : { status: 1, stdout: Buffer.alloc(0) }
        }
        if (operation === "remote get-url --all origin") {
          return { status: 0, stdout: Buffer.from(`${overrides.gitOrigin ?? "https://github.com/bsvalues/terragroq.git"}\n`) }
        }
        if (operation === "status --porcelain=v1 --untracked-files=all") {
          return { status: 0, stdout: Buffer.from(overrides.gitStatus ?? "") }
        }
        if (operation === "ls-files --stage -z") {
          const entries = value.reviewedRelease.runtimeClosurePaths.map((relativePath: string) =>
            `${overrides.trackedModes?.[relativePath] ?? "100644"} ${"a".repeat(40)} 0\t${relativePath}\0`)
          return { status: 0, stdout: Buffer.from(entries.join("")) }
        }
        throw new Error(`unexpected fixed Git operation: ${operation}`)
      },
    } satisfies RepairFixtureOptions,
  }
}

describe("AEGIS canonical JSON one-shot root repair", () => {
  it.each([
    ["nested string", { nested: ["valid", "\ud800"] }],
    ["object key", { ["bad\udc00"]: true }],
  ])("rejects a recursive lone surrogate in a %s exactly like repository JCS", (_label, value) => {
    expect(() => canonicalizeRepairJcs(value)).toThrow("JCS strings must not contain lone surrogates")
    expect(() => canonicalizeJcs(value)).toThrow("JCS strings must not contain lone surrogates")
  })

  it("binds the reviewed release root to the exact historical checkout operation and trusted commit", () => {
    const value = manifest()
    expect(validateHistoricalReleaseRoot(value, value.repair.previousPlannedMutations))
      .toBe(`/opt/williamos/releases/${value.trustedMain.commit}`)
    const drifted = structuredClone(value)
    drifted.reviewedRelease.releaseRoot = "/opt/williamos/releases/foreign"
    expect(() => validateHistoricalReleaseRoot(drifted, drifted.repair.previousPlannedMutations))
      .toThrow(expect.objectContaining({ code: "AEGIS_CANONICAL_REPAIR_PACKAGE_INVALID" }))
  })

  it.each(manifest().repair.previousRootMutationIds as string[])("rejects historical root mutation omission: %s", (omittedId: string) => {
    const incomplete = manifest().repair.previousRootMutationIds.filter((id: string) => id !== omittedId)
    expect(() => validateHistoricalRootMutationIds(incomplete)).toThrow(expect.objectContaining({
      code: "AEGIS_CANONICAL_REPAIR_PACKAGE_INVALID",
    }))
  })

  it("dry-runs without consuming authority, then installs and journals the exact missing source", () => {
    const fixture = repairFixture()
    expect(repairAegisStandingHashCanonicalJson(fixture.options)).toMatchObject({
      status: "DRY_RUN",
      authority_consumed: false,
      target_installed: false,
      workload_executed: false,
      scheduler_activated: false,
      network_accessed: false,
    })
    expect(fixture.virtual.statAt(CANONICAL_JSON_TARGET)).toBeUndefined()

    const result = repairAegisStandingHashCanonicalJson({ ...fixture.options, mode: "apply" })
    expect(result).toMatchObject({ status: "REPAIRED", authority_consumed: true, target_installed: true })
    const installed = fixture.virtual.statAt(CANONICAL_JSON_TARGET)
    expect({ uid: installed?.uid, gid: installed?.gid, mode: (installed?.mode ?? 0) & 0o777, nlink: installed?.nlink })
      .toEqual({ uid: 0, gid: 0, mode: 0o444, nlink: 1 })
    expect(crypto.createHash("sha256").update(fixture.virtual.bytesAt(CANONICAL_JSON_TARGET)!).digest("hex"))
      .toBe(fixture.authority.sourceSha256)
    const journal = fixture.virtual.bytesAt(`${REPAIR_JOURNAL_PREFIX}${fixture.authority.authorityId}.journal.jsonl`)!
      .toString("utf8").trimEnd().split("\n").map(parseJournalRecord)
    expect(journal.map(({ record_type }) => record_type)).toEqual(["AUTHORITY_CONSUMED", "REPAIR_COMPLETE"])
  })

  it("accepts the actual apply journal shape with digest-free planned files and digested execution records", () => {
    const fixture = repairFixture()
    const plannedMutations = fixture.records[0]?.planned_mutations
    if (!plannedMutations) throw new TypeError("historical authority record is missing planned mutations")
    const plannedFiles = plannedMutations.filter(({ type }) => type === "INSTALL_FILE")
    const startedFiles = fixture.records.filter(({ record_type }) => record_type === "MUTATION_STARTED")
      .filter(({ type }) => type === "INSTALL_FILE")
    const completedFiles = fixture.records.filter(({ record_type }) => record_type === "MUTATION_COMPLETED")
      .filter(({ type }) => type === "INSTALL_FILE")
    expect(plannedFiles.every((operation) => operation.sha256 === undefined)).toBe(true)
    expect([...startedFiles, ...completedFiles].every((operation) =>
      typeof operation.sha256 === "string" && /^[a-f0-9]{64}$/.test(operation.sha256))).toBe(true)
    expect(repairAegisStandingHashCanonicalJson(fixture.options)).toMatchObject({ status: "DRY_RUN" })
  })

  it("rejects self-consistent started and completed file digest drift", () => {
    const fixture = repairFixture({
      mutateHistoricalRecords: (records) => {
        for (const record of records) {
          if (typeof record.record_type === "string" && ["MUTATION_STARTED", "MUTATION_COMPLETED"].includes(record.record_type)
            && record.id === "replay-epoch-initializer") record.sha256 = "0".repeat(64)
        }
      },
    })
    expect(() => repairAegisStandingHashCanonicalJson(fixture.options)).toThrow(expect.objectContaining({
      code: "AEGIS_CANONICAL_REPAIR_PRIOR_JOURNAL_INVALID",
    }))
  })

  it("rejects self-consistent started and completed file records that omit the recorded digest", () => {
    const fixture = repairFixture({
      mutateHistoricalRecords: (records) => {
        for (const record of records) {
          if (typeof record.record_type === "string" && ["MUTATION_STARTED", "MUTATION_COMPLETED"].includes(record.record_type)
            && record.id === "authorized-keys") delete record.sha256
        }
      },
    })
    expect(() => repairAegisStandingHashCanonicalJson(fixture.options)).toThrow(expect.objectContaining({
      code: "AEGIS_CANONICAL_REPAIR_PRIOR_JOURNAL_INVALID",
    }))
  })

  it.each([
    ["wrong host", { hostname: "hermes" }, "AEGIS_CANONICAL_REPAIR_HOST_REJECTED"],
    ["wrong machine", { machineIdentitySha256: "0".repeat(64) }, "AEGIS_CANONICAL_REPAIR_MACHINE_REJECTED"],
    ["non-root caller", { rootUid: 734 }, "AEGIS_CANONICAL_REPAIR_ROOT_REQUIRED"],
    ["stale authority", { clock: "2026-08-11T18:10:00.000Z" }, "AEGIS_CANONICAL_REPAIR_AUTHORITY_EXPIRED"],
  ])("rejects %s before repair journal creation", (_label, overrides, code) => {
    const fixture = repairFixture(overrides)
    expect(() => repairAegisStandingHashCanonicalJson({ ...fixture.options, mode: "apply" }))
      .toThrow(expect.objectContaining({ code }))
    expect(fixture.virtual.bytesAt(`${REPAIR_JOURNAL_PREFIX}${fixture.authority.authorityId}.journal.jsonl`)).toBeUndefined()
  })

  it("rejects replay of a consumed repair authority", () => {
    const fixture = repairFixture()
    repairAegisStandingHashCanonicalJson({ ...fixture.options, mode: "apply" })
    expect(() => repairAegisStandingHashCanonicalJson({ ...fixture.options, mode: "apply" }))
      .toThrow(expect.objectContaining({ code: "AEGIS_CANONICAL_REPAIR_AUTHORITY_REPLAY" }))
  })

  it.each(["file", "symlink"] as const)("refuses an existing %s target without overwrite or adoption", (kind) => {
    const fixture = repairFixture({ target: { kind } })
    expect(() => repairAegisStandingHashCanonicalJson({ ...fixture.options, mode: "apply" }))
      .toThrow(expect.objectContaining({ code: "AEGIS_CANONICAL_REPAIR_TARGET_EXISTS" }))
  })

  it("rejects previous journal hash drift", () => {
    const fixture = repairFixture({ authority: (authority) => { authority.previousProvisioningJournalSha256 = "0".repeat(64) } })
    expect(() => repairAegisStandingHashCanonicalJson({ ...fixture.options, mode: "apply" }))
      .toThrow(expect.objectContaining({ code: "AEGIS_CANONICAL_REPAIR_PRIOR_STATE_DRIFT" }))
  })

  it.each(manifest().repair.previousPlannedMutations.map(({ path: mutationPath }) => mutationPath))(
    "rejects a self-consistent historical journal omitting required mutation %s", (omittedPath: string) => {
    const fixture = repairFixture({ omitMutationPath: omittedPath })
    expect(() => repairAegisStandingHashCanonicalJson(fixture.options)).toThrow(expect.objectContaining({
      code: "AEGIS_CANONICAL_REPAIR_PRIOR_PLAN_INVALID",
    }))
    },
  )

  it("rejects a self-consistent historical journal with the complete plan out of order", () => {
    const fixture = repairFixture({ mutateHistoricalPlan: (planned) => {
      [planned[0], planned[1]] = [planned[1], planned[0]]
    } })
    expect(() => repairAegisStandingHashCanonicalJson(fixture.options)).toThrow(expect.objectContaining({
      code: "AEGIS_CANONICAL_REPAIR_PRIOR_PLAN_INVALID",
    }))
  })

  it.each([
    "/opt/williamos",
    "/opt/williamos/releases",
    "/usr/local/libexec/williamos",
    "/etc/williamos",
    "/etc/williamos/fabric",
    "/var/lib/williamos/fabric/standing-hash-requests",
    "/var/lib/williamos/fabric/standing-hash-ledger",
    "/var/lib/williamos/fabric/ledger",
    "/home/williamos-fabric/.ssh",
    ...manifest().repair.installedAssets.map(({ path: assetPath }) => assetPath),
    "/home/williamos-fabric/.ssh/authorized_keys",
    manifest().reviewedRelease.releaseRoot,
    `${manifest().reviewedRelease.releaseRoot}/.git`,
    `${manifest().reviewedRelease.releaseRoot}/.git/config`,
    `${manifest().reviewedRelease.releaseRoot}/.git/HEAD`,
    ...manifest().reviewedRelease.runtimeClosurePaths.map((relativePath: string) =>
      `${manifest().reviewedRelease.releaseRoot}/${relativePath}`),
    "/etc/williamos/fabric/trusted-main-release.json",
  ])("rejects missing historical live artifact %s", (omittedPath) => {
    const fixture = repairFixture({ omitArtifactPath: omittedPath })
    expect(() => repairAegisStandingHashCanonicalJson(fixture.options)).toThrow()
  })

  const historicalDirectories = [
    ["/opt/williamos", 0, 0, 0o755],
    ["/opt/williamos/releases", 0, 0, 0o755],
    ["/usr/local/libexec/williamos", 0, 0, 0o755],
    ["/etc/williamos", 0, 0, 0o755],
    ["/etc/williamos/fabric", 0, 0, 0o755],
    ["/var/lib/williamos/fabric/standing-hash-requests", 734, 734, 0o700],
    ["/var/lib/williamos/fabric/standing-hash-ledger", 734, 734, 0o700],
    ["/var/lib/williamos/fabric/ledger", 734, 734, 0o700],
    ["/home/williamos-fabric/.ssh", 734, 734, 0o700],
    [manifest().reviewedRelease.releaseRoot, 0, 0, 0o755],
  ] as const
  it.each(historicalDirectories.flatMap(([directoryPath, uid, gid, mode]) => [
    [`${directoryPath} owner`, { path: directoryPath, uid: uid === 0 ? 734 : 0 }],
    [`${directoryPath} group`, { path: directoryPath, gid: gid === 0 ? 734 : 0 }],
    [`${directoryPath} mode`, { path: directoryPath, mode: mode === 0o755 ? 0o775 : 0o750 }],
  ] as const))("rejects historical directory drift: %s", (_label, directoryDrift) => {
    const fixture = repairFixture({ directoryDrift })
    expect(() => repairAegisStandingHashCanonicalJson(fixture.options)).toThrow(expect.objectContaining({
      code: "AEGIS_CANONICAL_REPAIR_PRIOR_STATE_DRIFT",
    }))
  })

  const checkoutFile = `${manifest().reviewedRelease.releaseRoot}/${manifest().reviewedRelease.runtimeClosurePaths[0]}`
  it.each([
    ["writable mode drift", 0o664],
    ["setuid special bit", 0o4644],
    ["Git non-executable owner execute drift", 0o744],
  ])("rejects historical tracked-file %s", (_label, mode) => {
    const fixture = repairFixture({ checkoutFileMode: { path: checkoutFile, mode } })
    expect(() => repairAegisStandingHashCanonicalJson(fixture.options)).toThrow(expect.objectContaining({
      code: "AEGIS_CANONICAL_REPAIR_CHECKOUT_FILE_METADATA_DRIFT",
    }))
    expect(fixture.virtual.bytesAt(`${REPAIR_JOURNAL_PREFIX}${fixture.authority.authorityId}.journal.jsonl`)).toBeUndefined()
  })

  it("accepts the authentic commentless historical authorized-key record", () => {
    const fixture = repairFixture()
    expect(fixture.virtual.bytesAt("/home/williamos-fabric/.ssh/authorized_keys")?.toString("utf8"))
      .toBe(`${authorizedKeyRecord.replace(/ williamos-aegis-standing-hash$/, "")}\n`)
    expect(repairAegisStandingHashCanonicalJson(fixture.options)).toMatchObject({ status: "DRY_RUN" })
  })

  it.each([0o400, 0o440, 0o444, 0o600, 0o640])(
    "accepts historically hardened restrictive regular-file mode %o", (mode) => {
      const fixture = repairFixture({ checkoutFileMode: { path: checkoutFile, mode } })
      expect(repairAegisStandingHashCanonicalJson(fixture.options)).toMatchObject({ status: "DRY_RUN" })
    },
  )

  it("accepts executable metadata only when the Git index proves mode 100755", () => {
    const relativePath = manifest().reviewedRelease.runtimeClosurePaths[0]
    const fixture = repairFixture({ trackedModes: { [relativePath]: "100755" } })
    expect(repairAegisStandingHashCanonicalJson(fixture.options)).toMatchObject({ status: "DRY_RUN" })
  })

  const trackedPathAncestor = `${manifest().reviewedRelease.releaseRoot}/scripts/execution-fabric`
  it.each([
    ["writable", { path: trackedPathAncestor, mode: 0o775 }],
    ["symlinked", { path: trackedPathAncestor, kind: "symlink" as const }],
  ])("rejects a %s tracked-path ancestor before authority consumption", (_label, checkoutAncestorDrift) => {
    const fixture = repairFixture({ checkoutAncestorDrift })
    expect(() => repairAegisStandingHashCanonicalJson({ ...fixture.options, mode: "apply" }))
      .toThrow(expect.objectContaining({ code: "AEGIS_CANONICAL_REPAIR_CHECKOUT_DIRECTORY_METADATA_DRIFT" }))
    expect(fixture.virtual.bytesAt(`${REPAIR_JOURNAL_PREFIX}${fixture.authority.authorityId}.journal.jsonl`)).toBeUndefined()
  })

  it.each([0o500, 0o550, 0o555, 0o700, 0o750])(
    "accepts historically hardened restrictive ancestor mode %o", (mode) => {
      const fixture = repairFixture({ checkoutAncestorDrift: { path: trackedPathAncestor, mode } })
      expect(repairAegisStandingHashCanonicalJson(fixture.options)).toMatchObject({ status: "DRY_RUN" })
    },
  )

  it.each([
    ["writable", { mode: 0o775 }],
    ["symlinked", { kind: "symlink" as const }],
    ["foreign owner", { uid: 734 }],
  ])("rejects %s /usr/local/libexec before authority consumption", (_label, targetParentDrift) => {
    const fixture = repairFixture({ targetParentDrift })
    expect(() => repairAegisStandingHashCanonicalJson({ ...fixture.options, mode: "apply" }))
      .toThrow(expect.objectContaining({ code: "AEGIS_CANONICAL_REPAIR_PARENT_UNTRUSTED" }))
    expect(fixture.virtual.bytesAt(`${REPAIR_JOURNAL_PREFIX}${fixture.authority.authorityId}.journal.jsonl`)).toBeUndefined()
  })

  it.each([
    ["unsupported local config", { gitConfigBytes: Buffer.from("[include]\n\tpath = /foreign/config\n") },
      "AEGIS_CANONICAL_REPAIR_CHECKOUT_CONFIG_INVALID"],
    ["foreign config origin", { gitConfigBytes: Buffer.from([
      "[core]", "repositoryformatversion = 0", "filemode = true", "bare = false",
      "[remote \"origin\"]", "url = https://github.com/foreign/repository.git",
      "fetch = +refs/heads/*:refs/remotes/origin/*", "",
    ].join("\n")) }, "AEGIS_CANONICAL_REPAIR_CHECKOUT_REPOSITORY_REJECTED"],
    ["wrong origin", { gitOrigin: "https://github.com/foreign/repository.git" },
      "AEGIS_CANONICAL_REPAIR_CHECKOUT_REPOSITORY_REJECTED"],
    ["object alternates", { gitAlternates: true }, "AEGIS_CANONICAL_REPAIR_CHECKOUT_ALTERNATES_REJECTED"],
    ["symbolic HEAD", { gitSymbolicHead: true }, "AEGIS_CANONICAL_REPAIR_CHECKOUT_HEAD_MISMATCH"],
    ["dirty tracked state", { gitStatus: " M scripts/execution-fabric/canonical-json.mjs\n" },
      "AEGIS_CANONICAL_REPAIR_CHECKOUT_DIRTY"],
    ["untracked state", { gitStatus: "?? untracked.txt\n" }, "AEGIS_CANONICAL_REPAIR_CHECKOUT_DIRTY"],
  ] as const)("rejects historical checkout %s before authority consumption", (_label, overrides, code) => {
    const fixture = repairFixture(overrides)
    expect(() => repairAegisStandingHashCanonicalJson({ ...fixture.options, mode: "apply" }))
      .toThrow(expect.objectContaining({ code }))
    expect(fixture.virtual.bytesAt(`${REPAIR_JOURNAL_PREFIX}${fixture.authority.authorityId}.journal.jsonl`)).toBeUndefined()
  })

  it("rejects installed asset hash drift", () => {
    const fixture = repairFixture({ priorAsset: { id: "replay-epoch-initializer", bytes: Buffer.from("drift\n") } })
    expect(() => repairAegisStandingHashCanonicalJson({ ...fixture.options, mode: "apply" }))
      .toThrow(expect.objectContaining({ code: "AEGIS_CANONICAL_REPAIR_PRIOR_STATE_DRIFT" }))
  })

  it.each([
    ["symlink", 0o555],
    ["file", 0o777],
  ] as const)("rejects prior asset %s or writable permissions", (kind, mode) => {
    const fixture = repairFixture({ priorAsset: { id: "ssh-entrypoint", kind, mode } })
    expect(() => repairAegisStandingHashCanonicalJson({ ...fixture.options, mode: "apply" }))
      .toThrow(/AEGIS_CANONICAL_REPAIR_(STATE_UNTRUSTED|SYMLINK_REJECTED)/)
  })

  it("durably records an exclusive-install write failure without creating the target", () => {
    const fixture = repairFixture({ failWritePath: CANONICAL_JSON_TARGET })
    expect(() => repairAegisStandingHashCanonicalJson({ ...fixture.options, mode: "apply" }))
      .toThrow(expect.objectContaining({ code: "AEGIS_CANONICAL_REPAIR_WRITE_FAILED", causeCode: "EIO" }))
    expect(fixture.virtual.statAt(CANONICAL_JSON_TARGET)).toBeUndefined()
    expect([...fixture.virtual.nodes.keys()].some((target) => target.startsWith(`${CANONICAL_JSON_TARGET}.repair-`))).toBe(false)
    const journal = fixture.virtual.bytesAt(`${REPAIR_JOURNAL_PREFIX}${fixture.authority.authorityId}.journal.jsonl`)!
      .toString("utf8").trimEnd().split("\n").map(parseJournalRecord)
    expect(journal.map(({ record_type }) => record_type)).toEqual(["AUTHORITY_CONSUMED", "REPAIR_FAILED"])
    expect(journal[1]).toMatchObject({
      failure_code: "AEGIS_CANONICAL_REPAIR_WRITE_FAILED",
      failure_cause_code: "EIO",
      target_installed: false,
      workload_executed: false,
      network_accessed: false,
    })
  })

  it.each([
    ["exclusive create", { failPath: `${REPAIR_JOURNAL_PREFIX}9d730a84-0000-4000-8000-000000000002.journal.jsonl` }],
    ["partial consumption write", { partialWrite: { recordType: "AUTHORITY_CONSUMED", bytes: 23 } }],
    ["consumption file fsync", { failFsync: { path: "repair-journal", occurrence: 1 } }],
    ["consumption parent fsync", { failFsync: { path: "journal-parent", occurrence: 1 } }],
  ] as const)("reports consumed and uncertain when %s fails", (_label, fault) => {
    const fixture = repairFixture(fault)
    let caught: unknown
    try { repairAegisStandingHashCanonicalJson({ ...fixture.options, mode: "apply" }) } catch (error) { caught = error }
    expect(caught).toMatchObject({
      authorityConsumed: true,
      journalMayExist: true,
      journalDurability: "UNCERTAIN",
      terminalRecordState: "NOT_STARTED",
    })
    expect(canonicalJsonRepairErrorEvidence(caught)).toMatchObject({
      authority_consumed: true,
      journal_may_exist: true,
      journal_durability: "UNCERTAIN",
      terminal_record_state: "NOT_STARTED",
      target_installed: false,
    })
    const journal = fixture.virtual.bytesAt(`${REPAIR_JOURNAL_PREFIX}${fixture.authority.authorityId}.journal.jsonl`)
    expect(journal?.toString("utf8") ?? "").not.toContain('"record_type":"REPAIR_FAILED"')
  })

  it("reports consumed and uncertain when the consumption record write fails before progress", () => {
    const journalPath = `${REPAIR_JOURNAL_PREFIX}9d730a84-0000-4000-8000-000000000002.journal.jsonl`
    const fixture = repairFixture({ failWritePath: journalPath })
    let caught: unknown
    try { repairAegisStandingHashCanonicalJson({ ...fixture.options, mode: "apply" }) } catch (error) { caught = error }
    expect(canonicalJsonRepairErrorEvidence(caught)).toMatchObject({
      code: "AEGIS_CANONICAL_REPAIR_CONSUMPTION_UNCERTAIN",
      authority_consumed: true,
      journal_may_exist: true,
      journal_durability: "UNCERTAIN",
      terminal_record_state: "NOT_STARTED",
    })
    expect(fixture.virtual.statAt(journalPath)).toBeDefined()
    expect(fixture.virtual.bytesAt(journalPath)).toHaveLength(0)
  })

  it.each([
    ["partial completion append", { partialWrite: { recordType: "REPAIR_COMPLETE", bytes: 29 } }],
    ["completion file fsync", { failFsync: { path: "repair-journal", occurrence: 2 } }],
    ["completion parent fsync", { failFsync: { path: "journal-parent", occurrence: 2 } }],
  ] as const)("does not append a duplicate terminal record after %s", (_label, fault) => {
    const fixture = repairFixture(fault)
    let caught: unknown
    try { repairAegisStandingHashCanonicalJson({ ...fixture.options, mode: "apply" }) } catch (error) { caught = error }
    expect(caught).toMatchObject({
      code: "AEGIS_CANONICAL_REPAIR_TERMINAL_STATE_UNCERTAIN",
      authorityConsumed: true,
      journalDurability: "UNCERTAIN",
      terminalRecordState: "ABSENT_PARTIAL_OR_DURABILITY_UNCERTAIN",
      targetInstalled: true,
    })
    const bytes = fixture.virtual.bytesAt(`${REPAIR_JOURNAL_PREFIX}${fixture.authority.authorityId}.journal.jsonl`)!
    expect(bytes.toString("utf8")).not.toContain('"record_type":"REPAIR_FAILED"')
    expect(fixture.virtual.events.filter(({ kind, path: eventPath }) =>
      kind === "write" && eventPath === `${REPAIR_JOURNAL_PREFIX}${fixture.authority.authorityId}.journal.jsonl`).length)
      .toBeLessThanOrEqual(2)
  })

  it("does not retry a partially appended failure terminal record", () => {
    const fixture = repairFixture({
      failWritePath: CANONICAL_JSON_TARGET,
      partialWrite: { recordType: "REPAIR_FAILED", bytes: 31 },
    })
    let caught: unknown
    try { repairAegisStandingHashCanonicalJson({ ...fixture.options, mode: "apply" }) } catch (error) { caught = error }
    expect(caught).toMatchObject({
      code: "AEGIS_CANONICAL_REPAIR_EVIDENCE_WRITE_FAILED",
      authorityConsumed: true,
      journalDurability: "UNCERTAIN",
      terminalRecordState: "ABSENT_PARTIAL_OR_DURABILITY_UNCERTAIN",
      targetInstalled: false,
    })
    const bytes = fixture.virtual.bytesAt(`${REPAIR_JOURNAL_PREFIX}${fixture.authority.authorityId}.journal.jsonl`)!
    expect(bytes.toString("utf8").split('"record_type":"REPAIR_FAILED"')).toHaveLength(1)
    expect(fixture.virtual.events.filter(({ kind }) => kind === "partial-write")).toHaveLength(1)
  })

  it("uses only fixed sanitized Git and contains no network, scheduler, workload, or shell primitive", () => {
    const source = fs.readFileSync(path.join(
      repoRoot,
      "scripts/execution-fabric/provision/repair-aegis-standing-hash-canonical-json.mjs",
    ), "utf8")
    expect(source).not.toMatch(/node:(?:net|http|https|http2|tls|dgram|dns)/)
    expect(source).not.toMatch(/\b(?:WebSocket|systemctl|crontab|schtasks|fork)\b/)
    expect(source).not.toMatch(/\bexec(?:File)?Sync\s*\(/)
    expect(source).not.toMatch(/\bfetch\s*\(/)
    expect(source).toContain('const GIT_EXECUTABLE = "/usr/bin/git"')
    expect(source).toContain('GIT_CONFIG_NOSYSTEM: "1"')
    expect(source).toContain('GIT_CONFIG_GLOBAL: "/dev/null"')
    expect(source).not.toMatch(/shell\s*:\s*true/)
  })
})
