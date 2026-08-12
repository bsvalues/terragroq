import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import {
  ACTIVATION_MARKER_PATH,
  AUTHORITY_ROOT,
  canonicalizePromotionJcs,
  LEDGER_MUTATION_LOCK_PATH,
  NODE_LEASE_PATH,
  NODE_MUTATION_LOCK_PATH,
  PROMOTION_INSTALLER_PATH,
  PROMOTION_MANIFEST_PATH,
  REPLAY_JOURNAL_PATH,
  REQUEST_ROOT,
  TRUSTED_RELEASE_MANIFEST_PATH,
  admissionReleasePromotionErrorEvidence,
  main,
  promoteAegisStandingHashAdmissionRelease,
  validateAegisStandingHashAdmissionReleasePromotionManifest,
} from "../scripts/execution-fabric/provision/promote-aegis-standing-hash-admission-release.mjs"

const CONFIG_PATH = path.resolve("config/execution-fabric/aegis-standing-hash-admission-release-promotion.v1.json")
const PRIOR = "b1637a0d16394361dff74e1fb85851ba61f91235"
const EVIDENCE = "c".repeat(40)
const RELEASE = "d".repeat(40)
const PACKAGE = "e".repeat(40)
const AUTHORITY_ID = "11111111-1111-4111-8111-111111111111"
const UPGRADE_AUTHORITY_ID = "22222222-2222-4222-8222-222222222222"
const ACCOUNT = { uid: 734, gid: 734, home: "/var/empty/williamos-fabric", shell: "/bin/bash" }
const NOW = "2026-08-12T18:05:00.000Z"
const EPOCH_AT = "2026-08-12T18:00:00.000Z"
const ISSUED_AT = "2026-08-12T18:01:00.000Z"
const EXPIRES_AT = "2026-08-12T18:10:00.000Z"

type Entry = {
  type: "file" | "directory"
  bytes?: Buffer
  uid: number
  gid: number
  mode: number
  direct: boolean
  nlink: number
  appendOnly?: boolean
}

type FixtureOptions = {
  platform?: string
  euid?: number
  hostname?: string
  authorityConsumed?: boolean
  authorityExpired?: boolean
  replayClaim?: boolean
  replayCorrupt?: boolean
  epochEnvelopeAfterAdmission?: boolean
  upgradeUncommitted?: boolean
  markerUpgradeMismatch?: boolean
  occupiedPath?: string
  checkoutDrift?: string
  ancestryDrift?: boolean
  artifactDrift?: "request" | "admission" | "input"
  staleAdmission?: boolean
  failMutation?: string
  failAfterMutation?: string
  failCommittedJournal?: boolean
  failFailedJournal?: boolean
  failReleaseLock?: string
  failRollback?: "manifest" | "marker" | "request"
}

const sha256 = (bytes: Buffer | string) => crypto.createHash("sha256").update(bytes).digest("hex")
const canonicalSha256 = (value: unknown) => sha256(Buffer.from(canonicalizePromotionJcs(value), "utf8"))
const recordBytes = (record: unknown) => Buffer.from(`${canonicalizePromotionJcs(record)}\n`, "utf8")

function epochReplay(options: FixtureOptions) {
  const epochBody = { record_type: "EPOCH", epoch_id: "aegis-standing-hash-replay-epoch-v1", initialized_at: EPOCH_AT }
  const epoch = { ...epochBody, journal_record_sha256: canonicalSha256(epochBody) }
  const firstBody = { sequence: 1, previous_entry_sha256: null,
    recorded_at: options.epochEnvelopeAfterAdmission ? "2026-08-12T18:02:00.000Z" : EPOCH_AT, record: epoch }
  const entries: any[] = [{ ...firstBody, entry_sha256: canonicalSha256(firstBody) }]
  if (options.replayClaim) {
    const claim = { record_type: "CLAIM", claim_key_sha256: "9".repeat(64) }
    const claimBody = { sequence: 2, previous_entry_sha256: entries[0].entry_sha256,
      recorded_at: "2026-08-12T18:02:00.000Z", record: claim }
    entries.push({ ...claimBody, entry_sha256: canonicalSha256(claimBody) })
  }
  if (options.replayCorrupt) entries[0].entry_sha256 = "0".repeat(64)
  return Buffer.from(`${entries.map(canonicalizePromotionJcs).join("\n")}\n`, "utf8")
}

function upgradeJournal(options: FixtureOptions) {
  const prepared = {
    schema_version: "1.0-aegis-standing-hash-replay-ledger-upgrade-journal",
    record_type: "PREPARED",
    phase: 1,
    authority_id: UPGRADE_AUTHORITY_ID,
    authority_sha256: "3".repeat(64),
    manifest_sha256: (options.markerUpgradeMismatch ? "5" : "4").repeat(64),
    new_commit: PRIOR,
  }
  const committed = {
    record_type: options.upgradeUncommitted ? "FAILED_PARTIAL" : "COMMITTED",
    phase: 2,
    completed_mutations: [
      "PUBLISH_CONTENT_ADDRESSED_RELEASE", "CREATE_EMPTY_REPLAY_JOURNAL", "SET_AND_VERIFY_APPEND_ONLY",
      "INSTALL_REPLAY_HELPER", "REPLACE_REPLAY_INITIALIZER", "REPLACE_BOOTSTRAP",
      "CREATE_ACTIVATION_MARKER", "REPLACE_TRUSTED_RELEASE_MANIFEST",
    ],
    replay_epoch_initialized: false,
    operational: false,
  }
  return Buffer.from(`${canonicalizePromotionJcs(prepared)}\n${canonicalizePromotionJcs(committed)}\n`, "utf8")
}

function fixture(options: FixtureOptions = {}) {
  const manifest = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"))
  manifest.priorState.replayUpgradeJournalPath =
    `/var/lib/williamos-aegis-standing-hash-replay-ledger-upgrade-${UPGRADE_AUTHORITY_ID}.journal.jsonl`
  manifest.evidenceRelease = {
    sourceCommit: PRIOR,
    admissionPath: "docs/reports/standing-dispatch/admission-job-595.json",
    admissionSha256: "0".repeat(64),
    inputPath: "docs/reports/standing-dispatch/inputs/WO-EF-AEGIS-STANDING-001-fabric-integrity.json",
    inputSha256: "0".repeat(64),
  }
  const evidenceCheckoutPath = `/root/reviewed/evidence-${EVIDENCE}`
  manifest.newRelease.commit = RELEASE
  manifest.newRelease.checkoutPath = `/root/reviewed/release-${RELEASE}`
  manifest.newRelease.releaseRoot = `/opt/williamos/releases/${RELEASE}`
  manifest.packageRelease = {
    commit: PACKAGE,
    checkoutPath: `/root/reviewed/package-${PACKAGE}`,
    installerSha256: "0".repeat(64),
  }
  manifest.install.requestId = "issue-595-admission-001"
  manifest.install.requestPath = `${REQUEST_ROOT}/${manifest.install.requestId}.json`

  const inputBytes = Buffer.from('{"proof":"issue-595"}\n', "utf8")
  const request: any = {
    schema_version: "1.0-aegis-standing-admission-request",
    job_id: "job-issue-595-001",
    outcome: { outcome_id: "outcome-595", origin: "WILLIAMOS_NATIVE", risk_class: "R1",
      approval_status: "APPROVED", dependency_status: "CLEARED" },
    work_order_id: "WO-EF-AEGIS-STANDING-001",
    source: { repository: "bsvalues/terragroq", commit_sha: PRIOR },
    workload: { workload_class: "HASH_VERIFY", template_id: "aegis.hash-verify.v1",
      adapter_id: "resident-aegis-hash-verify-v1", profile_id: "resident-aegis-bounded-hash-verify-v1" },
    execution_identity: { node_id: "aegis", machine_id_sha256: manifest.machine.machineIdSha256,
      execution_account: "williamos-fabric", privilege: "non-root" },
    reviewed_binding: { fixture: true },
    input: {
      relative_path: manifest.evidenceRelease.inputPath.replace("docs/reports/standing-dispatch/", ""),
      expected_sha256: sha256(inputBytes),
      expected_byte_length: inputBytes.length,
    },
    limits: { cpu_threads: 1, memory_bytes: 1024, runtime_ms: 1000, output_bytes: 1024, scratch_write_bytes: 1 },
    boundary: { network: false, scheduler: false },
  }
  const jobScope = {
    schema_version: request.schema_version, job_id: request.job_id, outcome: request.outcome,
    work_order_id: request.work_order_id, source: request.source, workload: request.workload,
    execution_identity: request.execution_identity, reviewed_binding: request.reviewed_binding,
    input: request.input, limits: request.limits, boundary: request.boundary,
  }
  const admission = {
    schema_version: "1.0-aegis-standing-job-admission",
    admission_id: "admission-issue-595-001",
    status: "ACTIVE",
    single_use: true,
    consumption_count: 0,
    consumed_at: null,
    revoked_at: null,
    job_scope: jobScope,
    job_scope_sha256: canonicalSha256(jobScope),
    issued_at: options.staleAdmission ? "2026-08-12T17:00:00.000Z" : ISSUED_AT,
    expires_at: options.staleAdmission ? "2026-08-12T17:10:00.000Z" : EXPIRES_AT,
  }
  const admissionBytes = recordBytes(admission)
  request.claim = { claim_id: "claim-issue-595-001", admission_sha256: canonicalSha256(admission) }
  const requestBytes = recordBytes(request)
  const installerBytes = fs.readFileSync(path.resolve(PROMOTION_INSTALLER_PATH))
  manifest.evidenceRelease.admissionSha256 = sha256(admissionBytes)
  manifest.evidenceRelease.inputSha256 = sha256(inputBytes)
  manifest.newRelease.trustArtifacts = {
    requestSourcePath: "docs/reports/standing-dispatch/private-requests/issue-595-admission-001.json",
    requestSha256: sha256(requestBytes),
    admissionPath: manifest.evidenceRelease.admissionPath,
    admissionSha256: sha256(admissionBytes),
    inputPath: manifest.evidenceRelease.inputPath,
    inputSha256: sha256(inputBytes),
  }
  for (const key of Object.keys(manifest.newRelease.closure)) {
    manifest.newRelease.closure[key] = sha256(Buffer.from(`release:${key}\n`, "utf8"))
  }
  manifest.packageRelease.installerSha256 = sha256(installerBytes)

  const replayBytes = epochReplay(options)
  const upgradeBytes = upgradeJournal(options)
  manifest.priorState.replayJournalSha256 = sha256(replayBytes)
  manifest.priorState.replayUpgradeJournalSha256 = sha256(upgradeBytes)

  const entries = new Map<string, Entry>()
  const events: string[] = []
  const injected = new Set<string>()
  const file = (target: string, bytes: Buffer, uid: number, gid: number, mode: number) => entries.set(target, {
    type: "file", bytes: Buffer.from(bytes), uid, gid, mode, direct: true, nlink: 1,
  })
  const directory = (target: string, uid: number, gid: number, mode: number) => entries.set(target, {
    type: "directory", uid, gid, mode, direct: true, nlink: 1,
  })
  const placeClosure = (checkout: string, closure: Record<string, string>, prefix: string) => {
    directory(checkout, 0, 0, 0o755)
    for (const relative of Object.keys(closure)) {
      file(path.posix.join(checkout, relative), Buffer.from(`${prefix}:${relative}\n`, "utf8"), 0, 0, 0o444)
    }
  }

  directory(REQUEST_ROOT, ACCOUNT.uid, ACCOUNT.gid, 0o700)
  directory(manifest.priorState.releaseRoot, 0, 0, 0o755)
  for (const relative of Object.keys(manifest.priorState.closure)) {
    file(path.posix.join(manifest.priorState.releaseRoot, relative),
      execFileSync("git", ["show", `${PRIOR}:${relative}`], { encoding: null }), 0, 0, 0o444)
  }
  directory(evidenceCheckoutPath, 0, 0, 0o755)
  file(path.posix.join(evidenceCheckoutPath, manifest.evidenceRelease.admissionPath),
    admissionBytes, 0, 0, 0o444)
  file(path.posix.join(evidenceCheckoutPath, manifest.evidenceRelease.inputPath),
    inputBytes, 0, 0, 0o444)
  placeClosure(manifest.newRelease.checkoutPath, manifest.newRelease.closure, "release")
  file(path.posix.join(manifest.newRelease.checkoutPath, manifest.newRelease.trustArtifacts.requestSourcePath),
    requestBytes, 0, 0, 0o444)
  file(path.posix.join(manifest.newRelease.checkoutPath, manifest.newRelease.trustArtifacts.admissionPath),
    admissionBytes, 0, 0, 0o444)
  file(path.posix.join(manifest.newRelease.checkoutPath, manifest.newRelease.trustArtifacts.inputPath),
    inputBytes, 0, 0, 0o444)
  directory(manifest.packageRelease.checkoutPath, 0, 0, 0o755)
  file(path.posix.join(manifest.packageRelease.checkoutPath, PROMOTION_INSTALLER_PATH), installerBytes, 0, 0, 0o444)

  if (options.artifactDrift) {
    const artifactPath = options.artifactDrift === "request"
      ? manifest.newRelease.trustArtifacts.requestSourcePath
      : options.artifactDrift === "admission"
        ? manifest.newRelease.trustArtifacts.admissionPath
        : manifest.newRelease.trustArtifacts.inputPath
    entries.get(path.posix.join(manifest.newRelease.checkoutPath, artifactPath))!.bytes = Buffer.from("drift\n")
  }

  const marker = {
    schema_version: "1.0-aegis-standing-hash-activation-marker",
    upgrade_id: "aegis-standing-hash-replay-ledger-upgrade-v1",
    authority_id: UPGRADE_AUTHORITY_ID,
    new_commit: PRIOR,
    runtime_closure_sha256: manifest.priorState.closure,
    manifest_sha256: "4".repeat(64),
    prepared_at: "2026-08-12T17:55:00.000Z",
  }
  const markerBytes = recordBytes(marker)
  const releaseBody = {
    schema_version: "1.0-williamos-trusted-main-release",
    repository: "bsvalues/terragroq",
    trusted_ref: "refs/heads/main",
    head_commit: PRIOR,
    release_root: manifest.priorState.releaseRoot,
    reviewed: true,
    deployed_at: "2026-08-12T17:55:01.000Z",
    file_sha256: manifest.priorState.closure,
    activation_marker_path: ACTIVATION_MARKER_PATH,
    activation_marker_sha256: canonicalSha256(marker),
  }
  const releaseBytes = recordBytes({ ...releaseBody, release_manifest_sha256: canonicalSha256(releaseBody) })
  const authorizedKeysBytes = Buffer.from("restrict ssh-ed25519 AAAAfixture\n")
  file(ACTIVATION_MARKER_PATH, markerBytes, 0, 0, 0o444)
  file(TRUSTED_RELEASE_MANIFEST_PATH, releaseBytes, 0, 0, 0o444)
  file(REPLAY_JOURNAL_PATH, replayBytes, 0, ACCOUNT.gid, 0o660)
  entries.get(REPLAY_JOURNAL_PATH)!.appendOnly = true
  file(manifest.priorState.replayUpgradeJournalPath, upgradeBytes, 0, 0, 0o600)
  file(manifest.priorState.authorizedKeysPath, authorizedKeysBytes, ACCOUNT.uid, ACCOUNT.gid, 0o600)
  if (options.occupiedPath) file(options.occupiedPath, Buffer.from("occupied\n"), ACCOUNT.uid, ACCOUNT.gid, 0o600)

  const manifestBytes = Buffer.from(`${canonicalizePromotionJcs(manifest)}\n`, "utf8")
  file(path.posix.join(evidenceCheckoutPath, PROMOTION_MANIFEST_PATH), manifestBytes, 0, 0, 0o444)
  const authority = {
    schemaVersion: 1,
    authorityId: AUTHORITY_ID,
    promotionId: manifest.promotionId,
    repository: manifest.repository,
    machineIdSha256: manifest.machine.machineIdSha256,
    priorCommit: PRIOR,
    newCommit: RELEASE,
    evidenceCommit: EVIDENCE,
    packageCommit: PACKAGE,
    manifestSha256: sha256(manifestBytes),
    priorReleaseManifestSha256: sha256(releaseBytes),
    priorActivationMarkerSha256: sha256(markerBytes),
    replayUpgradeJournalSha256: sha256(upgradeBytes),
    replayJournalSha256: sha256(replayBytes),
    priorAuthorizedKeysSha256: sha256(authorizedKeysBytes),
    newClosureSha256: manifest.newRelease.closure,
    trustArtifactSha256: {
      request: sha256(requestBytes), admission: sha256(admissionBytes), input: sha256(inputBytes),
    },
    reviewedCheckoutPath: manifest.newRelease.checkoutPath,
    evidenceCheckoutPath,
    packageCheckoutPath: manifest.packageRelease.checkoutPath,
    issuedAt: options.authorityExpired ? "2026-08-12T17:00:00.000Z" : "2026-08-12T18:00:00.000Z",
    expiresAt: options.authorityExpired ? "2026-08-12T17:10:00.000Z" : "2026-08-12T18:15:00.000Z",
    singleUse: true,
    consumed: options.authorityConsumed ?? false,
  }
  const mutationJournal = `${manifest.install.journalPrefix}${AUTHORITY_ID}.journal.jsonl`

  const maybeFail = (name: string) => {
    if (options.failMutation === name && !injected.has(`before:${name}`)) {
      injected.add(`before:${name}`)
      throw Object.assign(new Error(`injected ${name}`), { code: "INJECTED_FAILURE" })
    }
  }
  const after = (name: string) => {
    if (options.failAfterMutation === name && !injected.has(`after:${name}`)) {
      injected.add(`after:${name}`)
      throw Object.assign(new Error(`injected post-${name}`), { code: "INJECTED_POST_FAILURE" })
    }
  }
  const io = {
    platform: () => options.platform ?? "linux",
    euid: () => options.euid ?? 0,
    hostname: () => options.hostname ?? "aegis",
    inspect: (target: string) => {
      const entry = entries.get(target)
      return entry ? { type: entry.type, direct: entry.direct, nlink: entry.nlink,
        uid: entry.uid, gid: entry.gid, mode: entry.mode } : null
    },
    read: (target: string) => {
      const entry = entries.get(target)
      if (!entry || entry.type !== "file") throw Object.assign(new Error(`missing ${target}`), { code: "ENOENT" })
      return Buffer.from(entry.bytes!)
    },
    account: () => ({ ...ACCOUNT }),
    hasAppendOnly: (target: string) => entries.get(target)?.appendOnly === true,
    verifyCheckout: (checkout: string, commit: string, repository: string, closure: Record<string, string>) => {
      events.push(`VERIFY:${checkout}`)
      if (options.checkoutDrift === checkout) throw Object.assign(new Error("dirty checkout"),
        { code: "AEGIS_ADMISSION_PROMOTION_CHECKOUT_DRIFT" })
      expect(repository).toBe("bsvalues/terragroq")
      const expectedCommit = checkout === manifest.priorState.releaseRoot ? PRIOR
        : checkout === evidenceCheckoutPath ? EVIDENCE
          : checkout === manifest.packageRelease.checkoutPath ? PACKAGE : RELEASE
      expect(commit).toBe(expectedCommit)
      for (const relative of Object.keys(closure)) expect(entries.has(path.posix.join(checkout, relative))).toBe(true)
    },
    verifyAncestry: (_checkout: string, _ancestor: string, _descendant: string) => {
      events.push("ANCESTRY")
      if (options.ancestryDrift) throw Object.assign(new Error("not ancestor"), { code: "ANCESTRY_DRIFT" })
    },
    publishRelease: (source: string, destination: string) => {
      maybeFail("PUBLISH_CONTENT_ADDRESSED_RELEASE")
      events.push("PUBLISH_CONTENT_ADDRESSED_RELEASE")
      directory(destination, 0, 0, 0o755)
      for (const [target, entry] of [...entries]) {
        if (target.startsWith(`${source}/`) && entry.type === "file") {
          file(`${destination}${target.slice(source.length)}`, entry.bytes!, 0, 0, entry.mode)
        }
      }
      after("PUBLISH_CONTENT_ADDRESSED_RELEASE")
    },
    removePublishedRelease: (destination: string) => {
      events.push("ROLLBACK_PUBLISH_CONTENT_ADDRESSED_RELEASE")
      for (const target of [...entries.keys()]) {
        if (target === destination || target.startsWith(`${destination}/`)) entries.delete(target)
      }
    },
    createFileExclusive: (target: string, bytes: Buffer, uid: number, gid: number, mode: number) => {
      maybeFail("INSTALL_PRIVATE_REQUEST")
      if (entries.has(target)) throw Object.assign(new Error("exists"), { code: "EEXIST" })
      events.push("INSTALL_PRIVATE_REQUEST")
      file(target, bytes, uid, gid, mode)
      after("INSTALL_PRIVATE_REQUEST")
    },
    atomicReplace: (target: string, bytes: Buffer, uid: number, gid: number, mode: number) => {
      const name = target === ACTIVATION_MARKER_PATH ? "REPLACE_ACTIVATION_MARKER" : "REPLACE_TRUSTED_RELEASE_MANIFEST"
      const rollback = target === ACTIVATION_MARKER_PATH ? bytes.equals(markerBytes) : bytes.equals(releaseBytes)
      if (rollback && options.failRollback === (target === ACTIVATION_MARKER_PATH ? "marker" : "manifest")) {
        throw Object.assign(new Error("rollback failed"), { code: "ROLLBACK_FAILED" })
      }
      if (!rollback) maybeFail(name)
      events.push(rollback ? `ROLLBACK_${name}` : name)
      file(target, bytes, uid, gid, mode)
      if (!rollback) after(name)
    },
    removeExact: (target: string) => {
      if (options.failRollback === "request") throw Object.assign(new Error("rollback failed"), { code: "ROLLBACK_FAILED" })
      events.push("ROLLBACK_INSTALL_PRIVATE_REQUEST")
      entries.delete(target)
    },
    acquireLock: (target: string, bytes: Buffer, uid: number, gid: number, mode: number) => {
      if (entries.has(target)) throw Object.assign(new Error("occupied"), { code: "AEGIS_ADMISSION_PROMOTION_LOCK_OCCUPIED" })
      events.push(`LOCK_ACQUIRED:${target}`)
      file(target, bytes, uid, gid, mode)
    },
    releaseLock: (target: string) => {
      if (options.failReleaseLock === target && !injected.has(`unlock:${target}`)) {
        injected.add(`unlock:${target}`)
        throw Object.assign(new Error("unlock failed"), { code: "LOCK_RELEASE_FAILED" })
      }
      events.push(`LOCK_RELEASED:${target}`)
      entries.delete(target)
    },
    createJournal: (target: string, record: unknown) => {
      events.push("JOURNAL_PREPARED")
      file(target, recordBytes(record), 0, 0, 0o600)
    },
    appendJournal: (target: string, record: any) => {
      if (record.record_type === "COMMITTED" && options.failCommittedJournal) {
        throw Object.assign(new Error("commit journal failed"), { code: "EIO" })
      }
      if (record.record_type === "FAILED_PARTIAL" && options.failFailedJournal) {
        throw Object.assign(new Error("failure journal failed"), { code: "EIO" })
      }
      events.push(`JOURNAL_${record.record_type}`)
      const retained = entries.get(target)!
      retained.bytes = Buffer.concat([retained.bytes!, recordBytes(record)])
    },
  }
  return {
    manifest, manifestBytes, authority, entries, events, io, mutationJournal,
    requestBytes, admissionBytes, inputBytes, markerBytes, releaseBytes, replayBytes, upgradeBytes, authorizedKeysBytes,
  }
}

function run(value: ReturnType<typeof fixture>, mode: "dry-run" | "apply" = "dry-run") {
  return promoteAegisStandingHashAdmissionRelease({
    manifest: value.manifest,
    manifestBytes: value.manifestBytes,
    authority: value.authority,
    mode,
    io: value.io as any,
    repoRoot: "C:/fixture",
    clock: () => NOW,
    machineIdentitySha256: value.manifest.machine.machineIdSha256,
  })
}

function expectFailureCode(action: () => unknown, code: string) {
  let failure: any
  try { action() } catch (error) { failure = error }
  expect(failure?.code).toBe(code)
  return failure
}

describe("AEGIS standing HASH admission release promotion", () => {
  it("keeps the checked-in promotion package fail-closed until final reviewed values are substituted", () => {
    const manifest = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"))
    expect(() => validateAegisStandingHashAdmissionReleasePromotionManifest(manifest))
      .toThrow("AEGIS_ADMISSION_PROMOTION_NOT_FINALIZED")
  })

  it("performs a complete dry-run without consuming authority or mutating host state", () => {
    const value = fixture()
    const before = [...value.entries].map(([key, entry]) => [key, entry.bytes?.toString("hex")])
    const result = run(value)
    expect(result).toMatchObject({ status: "DRY_RUN", authority_consumed: false, activated: false,
      request_id: "issue-595-admission-001", replay_journal_mutated: false, authorized_keys_mutated: false })
    expect([...value.entries].map(([key, entry]) => [key, entry.bytes?.toString("hex")])).toEqual(before)
    expect(value.events.every((event) => event.startsWith("VERIFY:") || event === "ANCESTRY")).toBe(true)
  })

  it("loads the promotion manifest from the external authority evidence checkout", () => {
    const value = fixture()
    expect(value.entries.has(path.posix.join(value.manifest.packageRelease.checkoutPath, PROMOTION_MANIFEST_PATH))).toBe(false)
    expect(value.entries.has(path.posix.join(value.manifest.newRelease.checkoutPath, PROMOTION_MANIFEST_PATH))).toBe(false)
    expect(value.entries.has(path.posix.join(value.authority.evidenceCheckoutPath, PROMOTION_MANIFEST_PATH))).toBe(true)
    expect(run(value)).toMatchObject({ status: "DRY_RUN", authority_consumed: false })
  })

  it("applies the exact bounded mutation order and installs only one private request", () => {
    const value = fixture()
    const result = run(value, "apply")
    expect(result).toMatchObject({ status: "COMMITTED", authority_consumed: true, activated: true,
      completed_mutations: [
        "PUBLISH_CONTENT_ADDRESSED_RELEASE", "INSTALL_PRIVATE_REQUEST",
        "REPLACE_ACTIVATION_MARKER", "REPLACE_TRUSTED_RELEASE_MANIFEST",
      ] })
    expect(value.entries.get(value.manifest.install.requestPath)).toMatchObject({
      uid: ACCOUNT.uid, gid: ACCOUNT.gid, mode: 0o600, direct: true, nlink: 1,
    })
    expect(value.entries.get(value.manifest.install.requestPath)!.bytes).toEqual(value.requestBytes)
    expect(value.entries.has(NODE_MUTATION_LOCK_PATH)).toBe(false)
    expect(value.entries.has(LEDGER_MUTATION_LOCK_PATH)).toBe(false)
    const records = value.entries.get(value.mutationJournal)!.bytes!.toString("utf8").trim().split("\n").map(JSON.parse)
    expect(records.map(({ record_type }) => record_type)).toEqual(["AUTHORITY_CONSUMED", "COMMITTED"])
  })

  it("preserves replay, upgrade evidence, authorized_keys, account, and scheduler state byte-for-byte", () => {
    const value = fixture()
    run(value, "apply")
    expect(value.entries.get(REPLAY_JOURNAL_PATH)!.bytes).toEqual(value.replayBytes)
    expect(value.entries.get(value.manifest.priorState.replayUpgradeJournalPath)!.bytes).toEqual(value.upgradeBytes)
    expect(value.entries.get(value.manifest.priorState.authorizedKeysPath)!.bytes).toEqual(value.authorizedKeysBytes)
    expect(value.entries.has(NODE_LEASE_PATH)).toBe(false)
  })

  it("rejects replay before mutation when the authority journal already exists", () => {
    const value = fixture()
    value.entries.set(value.mutationJournal, { type: "file", bytes: Buffer.from("retained\n"),
      uid: 0, gid: 0, mode: 0o600, direct: true, nlink: 1 })
    expect(() => run(value, "apply")).toThrow("AEGIS_ADMISSION_PROMOTION_AUTHORITY_REPLAY")
    expect(value.events.some((event) => event === "JOURNAL_PREPARED")).toBe(false)
  })

  it.each([
    ["wrong platform", { platform: "win32" }, "AEGIS_ADMISSION_PROMOTION_LINUX_REQUIRED"],
    ["non-root", { euid: 1000 }, "AEGIS_ADMISSION_PROMOTION_ROOT_REQUIRED"],
    ["wrong host", { hostname: "hermes" }, "AEGIS_ADMISSION_PROMOTION_HOST_REJECTED"],
    ["consumed authority", { authorityConsumed: true }, "AEGIS_ADMISSION_PROMOTION_AUTHORITY_REPLAY"],
    ["expired authority", { authorityExpired: true }, "AEGIS_ADMISSION_PROMOTION_AUTHORITY_EXPIRED"],
    ["uncommitted replay upgrade", { upgradeUncommitted: true }, "AEGIS_ADMISSION_PROMOTION_REPLAY_UPGRADE_INVALID"],
    ["activation marker/replay upgrade mismatch", { markerUpgradeMismatch: true }, "AEGIS_ADMISSION_PROMOTION_PRIOR_STATE_DRIFT"],
    ["replay claim", { replayClaim: true }, "AEGIS_ADMISSION_PROMOTION_REPLAY_STATE_INVALID"],
    ["corrupt replay chain", { replayCorrupt: true }, "AEGIS_ADMISSION_PROMOTION_REPLAY_STATE_INVALID"],
    ["backdated epoch body with later durable envelope", { epochEnvelopeAfterAdmission: true }, "AEGIS_ADMISSION_PROMOTION_ARTIFACT_INVALID"],
    ["active node lease", { occupiedPath: NODE_LEASE_PATH }, "AEGIS_ADMISSION_PROMOTION_PRIOR_STATE_DRIFT"],
    ["occupied node lock", { occupiedPath: NODE_MUTATION_LOCK_PATH }, "AEGIS_ADMISSION_PROMOTION_PRIOR_STATE_DRIFT"],
    ["existing request", { occupiedPath: `${REQUEST_ROOT}/issue-595-admission-001.json` }, "AEGIS_ADMISSION_PROMOTION_PRIOR_STATE_DRIFT"],
    ["stale admission", { staleAdmission: true }, "AEGIS_ADMISSION_PROMOTION_ARTIFACT_INVALID"],
  ])("fails closed for %s", (_label, options, code) => {
    const value = fixture(options as FixtureOptions)
    expect(() => run(value, "apply")).toThrow(code)
    expect(value.events).not.toContain("PUBLISH_CONTENT_ADDRESSED_RELEASE")
  })

  it.each(["request", "admission", "input"] as const)("rejects exact %s byte drift", (artifactDrift) => {
    const value = fixture({ artifactDrift })
    expect(() => run(value, "apply")).toThrow("AEGIS_ADMISSION_PROMOTION_CHECKOUT_DRIFT")
    expect(value.events).not.toContain("PUBLISH_CONTENT_ADDRESSED_RELEASE")
  })

  it("requires all package, evidence, and release checkouts to be exact and ancestrally ordered", () => {
    const dirty = fixture({ checkoutDrift: `/root/reviewed/evidence-${EVIDENCE}` })
    expectFailureCode(() => run(dirty), "AEGIS_ADMISSION_PROMOTION_CHECKOUT_DRIFT")
    const ancestry = fixture({ ancestryDrift: true })
    expectFailureCode(() => run(ancestry), "AEGIS_ADMISSION_PROMOTION_CHECKOUT_DRIFT")
  })

  it.each([
    "INSTALL_PRIVATE_REQUEST", "REPLACE_ACTIVATION_MARKER", "REPLACE_TRUSTED_RELEASE_MANIFEST",
  ])("rolls back prior activation and private request when %s fails", (failMutation) => {
    const value = fixture({ failMutation })
    expectFailureCode(() => run(value, "apply"), "INJECTED_FAILURE")
    expect(value.entries.get(ACTIVATION_MARKER_PATH)!.bytes).toEqual(value.markerBytes)
    expect(value.entries.get(TRUSTED_RELEASE_MANIFEST_PATH)!.bytes).toEqual(value.releaseBytes)
    expect(value.entries.has(value.manifest.install.requestPath)).toBe(false)
    expect(value.entries.has(value.manifest.newRelease.releaseRoot)).toBe(false)
    expect(value.events).toContain("ROLLBACK_PUBLISH_CONTENT_ADDRESSED_RELEASE")
    const records = value.entries.get(value.mutationJournal)!.bytes!.toString("utf8").trim().split("\n").map(JSON.parse)
    expect(records.at(-1).record_type).toBe("FAILED_PARTIAL")
  })

  it.each(["REPLACE_ACTIVATION_MARKER", "REPLACE_TRUSTED_RELEASE_MANIFEST"])(
    "restores prior activation when durability fails after %s rename", (failAfterMutation) => {
      const value = fixture({ failAfterMutation })
      expectFailureCode(() => run(value, "apply"), "INJECTED_POST_FAILURE")
      expect(value.entries.get(ACTIVATION_MARKER_PATH)!.bytes).toEqual(value.markerBytes)
      expect(value.entries.get(TRUSTED_RELEASE_MANIFEST_PATH)!.bytes).toEqual(value.releaseBytes)
      expect(value.entries.has(value.manifest.install.requestPath)).toBe(false)
    },
  )

  it("restores prior activation when COMMITTED evidence cannot be persisted", () => {
    const value = fixture({ failCommittedJournal: true })
    expectFailureCode(() => run(value, "apply"), "EIO")
    expect(value.entries.get(ACTIVATION_MARKER_PATH)!.bytes).toEqual(value.markerBytes)
    expect(value.entries.get(TRUSTED_RELEASE_MANIFEST_PATH)!.bytes).toEqual(value.releaseBytes)
    expect(value.entries.has(value.manifest.install.requestPath)).toBe(false)
    const records = value.entries.get(value.mutationJournal)!.bytes!.toString("utf8").trim().split("\n").map(JSON.parse)
    expect(records.map(({ record_type }) => record_type)).toEqual(["AUTHORITY_CONSUMED", "FAILED_PARTIAL"])
  })

  it("restores prior activation and fails closed when lock release cannot be proven", () => {
    const value = fixture({ failReleaseLock: LEDGER_MUTATION_LOCK_PATH })
    expectFailureCode(() => run(value, "apply"), "LOCK_RELEASE_FAILED")
    expect(value.entries.get(ACTIVATION_MARKER_PATH)!.bytes).toEqual(value.markerBytes)
    expect(value.entries.get(TRUSTED_RELEASE_MANIFEST_PATH)!.bytes).toEqual(value.releaseBytes)
    expect(value.entries.has(value.manifest.install.requestPath)).toBe(false)
    expect(value.entries.has(LEDGER_MUTATION_LOCK_PATH)).toBe(false)
  })

  it("reports recovery uncertainty after independently attempting every rollback", () => {
    const value = fixture({ failCommittedJournal: true, failRollback: "marker" })
    let failure: any
    try { run(value, "apply") } catch (error) { failure = error }
    expect(failure.code).toBe("AEGIS_ADMISSION_PROMOTION_RECOVERY_UNCERTAIN")
    expect(value.events).toContain("ROLLBACK_REPLACE_TRUSTED_RELEASE_MANIFEST")
    expect(value.events).toContain("ROLLBACK_INSTALL_PRIVATE_REQUEST")
    expect(admissionReleasePromotionErrorEvidence(failure)).toMatchObject({
      status: "FAILED_CLOSED", authority_consumed: true, original_failure_code: "EIO", cause_code: "ROLLBACK_FAILED",
    })
  })

  it("reports evidence uncertainty when FAILED_PARTIAL cannot be made durable", () => {
    const value = fixture({ failMutation: "INSTALL_PRIVATE_REQUEST", failFailedJournal: true })
    let failure: any
    try { run(value, "apply") } catch (error) { failure = error }
    expect(failure.code).toBe("AEGIS_ADMISSION_PROMOTION_EVIDENCE_UNCERTAIN")
    expect(admissionReleasePromotionErrorEvidence(failure)).toMatchObject({
      status: "FAILED_CLOSED", authority_consumed: true, original_failure_code: "INJECTED_FAILURE", cause_code: "EIO",
    })
  })

  it("rejects CLI authority paths outside the fixed root", () => {
    const stderr = { value: "", write(chunk: string) { this.value += chunk } }
    expect(main(["--dry-run", "--authority", "/tmp/authority.json"], { stderr } as any)).toBe(2)
    expect(stderr.value).toContain("AEGIS_ADMISSION_PROMOTION_AUTHORITY_PATH_INVALID")
    expect(AUTHORITY_ROOT).toBe("/var/lib/williamos/fabric/standing-hash-promotion-authorities")
  })

  it("contains no network, workload, scheduler, account, authorized_keys, privilege, or replay mutation primitive", () => {
    const source = fs.readFileSync(path.resolve(PROMOTION_INSTALLER_PATH), "utf8")
    expect(source).not.toMatch(/node:(?:net|http|https|http2|tls|dgram|dns)/)
    expect(source).not.toMatch(/\b(?:fetch|WebSocket|systemctl|crontab|schtasks)\s*\(?/)
    expect(source).not.toMatch(/\b(?:sudo|doas|pkexec|useradd|usermod|groupadd)\b/)
    expect(source).not.toMatch(/shell\s*:\s*true/)
    expect(source).not.toMatch(/(?:atomicReplace|createFileExclusive)\([^\n]*(?:authorizedKeys|REPLAY_JOURNAL)/)
  })
})
