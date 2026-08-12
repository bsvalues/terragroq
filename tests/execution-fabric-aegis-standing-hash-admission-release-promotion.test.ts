import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { describe, expect, it, vi } from "vitest"

import { evaluateAegisStandingEligibility } from "../scripts/execution-fabric/admission/evaluate-aegis-standing-authority.mjs"
import { issueAegisStandingHashAdmission } from "../scripts/execution-fabric/admission/issue-aegis-standing-hash-admission.mjs"
import { validatePromotionArtifacts } from "../scripts/execution-fabric/admission/validate-aegis-standing-promotion-artifacts.mjs"

import {
  ACTIVATION_MARKER_PATH,
  AUTHORITY_ROOT,
  canonicalizePromotionJcs,
  LEDGER_MUTATION_LOCK_PATH,
  NODE_LEASE_PATH,
  NODE_MUTATION_LOCK_PATH,
  PROMOTION_INSTALLER_PATH,
  PROMOTION_MANIFEST_PATH,
  PROMOTION_VALIDATOR_PATH,
  REPLAY_JOURNAL_PATH,
  REQUEST_ROOT,
  STANDING_AUTHORITY_PATH,
  STANDING_EVALUATOR_PATH,
  TRUSTED_RELEASE_MANIFEST_PATH,
  admissionReleasePromotionErrorEvidence,
  main,
  promoteAegisStandingHashAdmissionRelease,
  validateAegisStandingHashAdmissionReleasePromotionManifest,
  validateCheckoutAncestorChain,
} from "../scripts/execution-fabric/provision/promote-aegis-standing-hash-admission-release.mjs"

const CONFIG_PATH = path.resolve("config/execution-fabric/aegis-standing-hash-admission-release-promotion.v1.json")
const BOOTSTRAP_PATH = "scripts/execution-fabric/bounded-dispatch/bootstrap-aegis-standing-hash.mjs"
const STANDING_AUTHORITY = JSON.parse(fs.readFileSync(
  path.resolve("config/execution-fabric/aegis-standing-compute-authority.v1.json"), "utf8"))
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
  incompleteArtifact?: "request" | "admission"
  changedBootstrapDigest?: boolean
  writableClosureAncestor?: boolean
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
    outcome: { outcome_id: "outcome-595", origin: STANDING_AUTHORITY.outcome_eligibility.origin, risk_class: "R1",
      approval_status: STANDING_AUTHORITY.outcome_eligibility.approval_status,
      dependency_status: STANDING_AUTHORITY.outcome_eligibility.dependency_status },
    work_order_id: "WO-EF-AEGIS-STANDING-001",
    source: { repository: "bsvalues/terragroq", commit_sha: PRIOR },
    workload: { workload_class: "HASH_VERIFY", template_id: "aegis.hash-verify.v1",
      adapter_id: "resident-aegis-hash-verify-v1", profile_id: "resident-aegis-bounded-hash-verify-v1" },
    execution_identity: {
      node_id: STANDING_AUTHORITY.node_identity.node_id,
      machine_id_sha256: STANDING_AUTHORITY.node_identity.machine_id_sha256,
      execution_account: STANDING_AUTHORITY.node_identity.execution_account,
      privilege: STANDING_AUTHORITY.node_identity.privilege,
    },
    reviewed_binding: {
      adapter_sha256: STANDING_AUTHORITY.workload_adapters[1].adapter_sha256,
      template_sha256: STANDING_AUTHORITY.workload_adapters[1].template_sha256,
      profile_sha256: STANDING_AUTHORITY.workload_adapters[1].profile_sha256,
      operation_core_sha256: STANDING_AUTHORITY.standing_integration.operation_core_sha256,
      runtime_sha256: STANDING_AUTHORITY.standing_integration.runtime_sha256,
      resident_runner_sha256: STANDING_AUTHORITY.standing_integration.resident_runner_sha256,
      replay_ledger_sha256: STANDING_AUTHORITY.standing_integration.replay_ledger_sha256,
      standing_contract_sha256: STANDING_AUTHORITY.standing_integration.standing_contract_sha256,
    },
    input: {
      relative_path: manifest.evidenceRelease.inputPath.replace("docs/reports/standing-dispatch/", ""),
      expected_sha256: sha256(inputBytes),
      expected_byte_length: inputBytes.length,
    },
    placement_evidence: {
      evidence_id: "placement-job-issue-595-001", node_id: "aegis",
      machine_id_sha256: manifest.machine.machineIdSha256,
      observed_at: "2026-08-12T18:00:00.000Z", expires_at: "2026-08-12T18:10:00.000Z",
      evidence_sha256: "0".repeat(64),
    },
    capability_evidence: {
      evidence_id: "capability-job-issue-595-001", node_id: "aegis",
      machine_id_sha256: manifest.machine.machineIdSha256,
      observed_at: "2026-08-12T18:00:00.000Z", expires_at: "2026-08-12T18:10:00.000Z",
      evidence_sha256: "0".repeat(64), available_cpu_threads: 12,
      available_memory_bytes: 8589934592, free_scratch_bytes: 112742891520,
    },
    limits: { cpu_threads: 1, memory_bytes: 1024, runtime_ms: 1000, output_bytes: 1024, scratch_write_bytes: 1 },
    boundary: structuredClone(STANDING_AUTHORITY.execution_boundary),
    lease: { lease_id: "lease-job-issue-595-001", fencing_token: 1 },
    claim: { claim_id: "claim-issue-595-001", admission_sha256: "0".repeat(64) },
  }
  for (const field of ["placement_evidence", "capability_evidence"]) {
    const { evidence_sha256: _ignored, ...body } = request[field]
    request[field].evidence_sha256 = canonicalSha256(body)
  }
  const issued = issueAegisStandingHashAdmission({
    authority: structuredClone(STANDING_AUTHORITY), request,
    admission_id: "admission-issue-595-001", issued_at: ISSUED_AT, expires_at: EXPIRES_AT,
  })
  const issuedRequest: any = issued.request
  const admission: any = issued.admission
  if (options.staleAdmission) {
    admission.issued_at = "2026-08-12T17:00:00.000Z"
    admission.expires_at = "2026-08-12T17:10:00.000Z"
    issuedRequest.claim.admission_sha256 = canonicalSha256(admission)
  }
  if (options.incompleteArtifact === "request") delete issuedRequest.placement_evidence
  if (options.incompleteArtifact === "admission") delete admission.approval_provenance
  const admissionBytes = recordBytes(admission)
  const requestBytes = recordBytes(issuedRequest)
  const installerBytes = fs.readFileSync(path.resolve(PROMOTION_INSTALLER_PATH))
  const validatorBytes = fs.readFileSync(path.resolve(PROMOTION_VALIDATOR_PATH))
  const evaluatorBytes = fs.readFileSync(path.resolve(STANDING_EVALUATOR_PATH))
  const standingAuthorityBytes = fs.readFileSync(path.resolve(STANDING_AUTHORITY_PATH))
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
  const priorClosureBytes = new Map<string, Buffer>()
  for (const key of Object.keys(manifest.priorState.closure)) {
    const bytes = Buffer.from(`prior:${key}\n`, "utf8")
    priorClosureBytes.set(key, bytes)
    manifest.priorState.closure[key] = sha256(bytes)
  }
  const releaseClosureBytes = new Map<string, Buffer>()
  for (const key of Object.keys(manifest.newRelease.closure)) {
    const bytes = key === BOOTSTRAP_PATH && !options.changedBootstrapDigest
      ? priorClosureBytes.get(key)!
      : Buffer.from(`release:${key}\n`, "utf8")
    releaseClosureBytes.set(key, bytes)
    manifest.newRelease.closure[key] = sha256(bytes)
  }
  manifest.packageRelease.installerSha256 = sha256(installerBytes)
  manifest.packageRelease.validatorSha256 = sha256(validatorBytes)
  manifest.packageRelease.evaluatorSha256 = sha256(evaluatorBytes)
  manifest.packageRelease.standingAuthoritySha256 = sha256(standingAuthorityBytes)

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
  const placeRootOwnedFile = (checkout: string, relative: string, bytes: Buffer) => {
    let parent = path.posix.dirname(path.posix.join(checkout, relative))
    while (parent !== checkout) {
      if (!entries.has(parent)) directory(parent, 0, 0, 0o755)
      parent = path.posix.dirname(parent)
    }
    file(path.posix.join(checkout, relative), bytes, 0, 0, 0o444)
  }
  const placeClosure = (checkout: string, closure: Record<string, string>, bytesByPath: Map<string, Buffer>) => {
    directory(checkout, 0, 0, 0o755)
    for (const relative of Object.keys(closure)) {
      placeRootOwnedFile(checkout, relative, bytesByPath.get(relative)!)
    }
  }

  directory(REQUEST_ROOT, ACCOUNT.uid, ACCOUNT.gid, 0o700)
  directory(manifest.priorState.releaseRoot, 0, 0, 0o755)
  for (const relative of Object.keys(manifest.priorState.closure)) {
    placeRootOwnedFile(manifest.priorState.releaseRoot, relative, priorClosureBytes.get(relative)!)
  }
  directory(evidenceCheckoutPath, 0, 0, 0o755)
  placeRootOwnedFile(evidenceCheckoutPath, manifest.evidenceRelease.admissionPath, admissionBytes)
  placeRootOwnedFile(evidenceCheckoutPath, manifest.evidenceRelease.inputPath, inputBytes)
  placeClosure(manifest.newRelease.checkoutPath, manifest.newRelease.closure, releaseClosureBytes)
  if (options.writableClosureAncestor) {
    const nested = Object.keys(manifest.newRelease.closure).find((relative) => relative.includes("/"))!
    entries.get(path.posix.join(manifest.newRelease.checkoutPath, path.posix.dirname(nested)))!.mode = 0o775
  }
  placeRootOwnedFile(manifest.newRelease.checkoutPath,
    manifest.newRelease.trustArtifacts.requestSourcePath, requestBytes)
  placeRootOwnedFile(manifest.newRelease.checkoutPath,
    manifest.newRelease.trustArtifacts.admissionPath, admissionBytes)
  placeRootOwnedFile(manifest.newRelease.checkoutPath,
    manifest.newRelease.trustArtifacts.inputPath, inputBytes)
  directory(manifest.packageRelease.checkoutPath, 0, 0, 0o755)
  placeRootOwnedFile(manifest.packageRelease.checkoutPath, PROMOTION_INSTALLER_PATH, installerBytes)
  placeRootOwnedFile(manifest.packageRelease.checkoutPath, PROMOTION_VALIDATOR_PATH, validatorBytes)
  placeRootOwnedFile(manifest.packageRelease.checkoutPath, STANDING_EVALUATOR_PATH, evaluatorBytes)
  placeRootOwnedFile(manifest.packageRelease.checkoutPath, STANDING_AUTHORITY_PATH, standingAuthorityBytes)

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
  placeRootOwnedFile(evidenceCheckoutPath, PROMOTION_MANIFEST_PATH, manifestBytes)
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
      validateCheckoutAncestorChain((target) => {
        const entry = entries.get(target)
        return entry ? { type: entry.type, direct: entry.direct, uid: entry.uid, gid: entry.gid, mode: entry.mode } : null
      }, checkout, closure)
      for (const relative of Object.keys(closure)) expect(entries.has(path.posix.join(checkout, relative))).toBe(true)
    },
    verifyAncestry: (_checkout: string, _ancestor: string, _descendant: string) => {
      events.push("ANCESTRY")
      if (options.ancestryDrift) throw Object.assign(new Error("not ancestor"), { code: "ANCESTRY_DRIFT" })
    },
    evaluateStandingArtifacts: (_validatorPath: string, payload: unknown) => validatePromotionArtifacts(payload),
    publishRelease: (source: string, destination: string) => {
      maybeFail("PUBLISH_CONTENT_ADDRESSED_RELEASE")
      events.push("PUBLISH_CONTENT_ADDRESSED_RELEASE")
      directory(destination, 0, 0, 0o755)
      for (const [target, entry] of [...entries]) {
        if (target.startsWith(`${source}/`)) {
          const published = `${destination}${target.slice(source.length)}`
          if (entry.type === "directory") directory(published, 0, 0, entry.mode)
          else file(published, entry.bytes!, 0, 0, entry.mode)
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
    request: issuedRequest, admission, requestBytes, admissionBytes, inputBytes,
    markerBytes, releaseBytes, replayBytes, upgradeBytes, authorizedKeysBytes,
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

  it("rejects a writable closure ancestor before mutation", () => {
    const value = fixture({ writableClosureAncestor: true })
    expectFailureCode(() => run(value, "apply"), "AEGIS_ADMISSION_PROMOTION_CHECKOUT_DRIFT")
    expect(value.events).not.toContain("PUBLISH_CONTENT_ADDRESSED_RELEASE")
  })

  it("rejects a changed bootstrap digest before mutation", () => {
    const value = fixture({ changedBootstrapDigest: true })
    expectFailureCode(() => run(value, "apply"), "AEGIS_ADMISSION_PROMOTION_MANIFEST_INVALID")
    expect(value.events).not.toContain("PUBLISH_CONTENT_ADDRESSED_RELEASE")
  })

  it.each(["request", "admission"] as const)(
    "rejects an incomplete %s under the actual standing runtime eligibility contract", (incompleteArtifact) => {
      const value = fixture({ incompleteArtifact })
      expect(evaluateAegisStandingEligibility({
        authority: STANDING_AUTHORITY,
        request: value.request,
        candidateAdmission: value.admission,
        now: () => Date.parse(NOW),
      })).toMatchObject({ status: "REJECTED", execution_authorized: false })
      expectFailureCode(() => run(value, "apply"), "AEGIS_ADMISSION_PROMOTION_ARTIFACT_INVALID")
      expect(value.events).not.toContain("PUBLISH_CONTENT_ADDRESSED_RELEASE")
    },
  )

  it.each([
    "REPLACE_ACTIVATION_MARKER", "REPLACE_TRUSTED_RELEASE_MANIFEST",
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

  it("does not mark or roll back a private request when exclusive creation fails", () => {
    const value = fixture({ failMutation: "INSTALL_PRIVATE_REQUEST" })
    expectFailureCode(() => run(value, "apply"), "INJECTED_FAILURE")
    expect(value.entries.has(value.manifest.install.requestPath)).toBe(false)
    expect(value.events).not.toContain("ROLLBACK_INSTALL_PRIVATE_REQUEST")
    const records = value.entries.get(value.mutationJournal)!.bytes!.toString("utf8").trim().split("\n").map(JSON.parse)
    expect(records.at(-1)).toMatchObject({
      record_type: "FAILED_PARTIAL",
      private_request_installed: false,
      private_request_removed: false,
    })
    expect(records.at(-1).completed_mutations).not.toContain("INSTALL_PRIVATE_REQUEST")
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

  it("retains one COMMITTED terminal when an initial lock release failure is recovered", () => {
    const value = fixture({ failReleaseLock: LEDGER_MUTATION_LOCK_PATH })
    expect(run(value, "apply")).toMatchObject({ status: "COMMITTED", lock_release_retried: true })
    expect(value.entries.get(ACTIVATION_MARKER_PATH)!.bytes).not.toEqual(value.markerBytes)
    expect(value.entries.get(TRUSTED_RELEASE_MANIFEST_PATH)!.bytes).not.toEqual(value.releaseBytes)
    expect(value.entries.has(value.manifest.install.requestPath)).toBe(true)
    expect(value.entries.has(LEDGER_MUTATION_LOCK_PATH)).toBe(false)
    const records = value.entries.get(value.mutationJournal)!.bytes!.toString("utf8").trim().split("\n").map(JSON.parse)
    expect(records.map(({ record_type }) => record_type)).toEqual(["AUTHORITY_CONSUMED", "COMMITTED"])
  })

  it("recovers stale owned locks from one exact durable committed journal after restart", () => {
    const value = fixture()
    expect(run(value, "apply")).toMatchObject({ status: "COMMITTED" })
    const prepared = JSON.parse(value.entries.get(value.mutationJournal)!.bytes!.toString("utf8").split("\n")[0])
    const lockBytes = recordBytes({
      schema_version: "1.0-aegis-standing-hash-promotion-lock",
      authority_id: AUTHORITY_ID,
      promotion_id: value.manifest.promotionId,
      acquired_at: prepared.prepared_at,
    })
    value.entries.set(NODE_MUTATION_LOCK_PATH, {
      type: "file", bytes: lockBytes, uid: ACCOUNT.uid, gid: ACCOUNT.gid,
      mode: 0o600, direct: true, nlink: 1,
    })
    expect(run(value, "apply")).toMatchObject({
      status: "COMMITTED_RECOVERED",
      authority_consumed: true,
      stale_owned_locks_released: true,
    })
    expect(value.entries.has(NODE_MUTATION_LOCK_PATH)).toBe(false)
    const records = value.entries.get(value.mutationJournal)!.bytes!.toString("utf8").trim().split("\n").map(JSON.parse)
    expect(records.map(({ record_type }) => record_type)).toEqual(["AUTHORITY_CONSUMED", "COMMITTED"])
  })

  it("rejects replay of a committed authority when no stale owned lock remains", () => {
    const value = fixture()
    expect(run(value, "apply")).toMatchObject({ status: "COMMITTED" })
    expectFailureCode(() => run(value, "apply"), "AEGIS_ADMISSION_PROMOTION_AUTHORITY_REPLAY")
  })

  it("refuses committed recovery when a preserved replay invariant drifted", () => {
    const value = fixture()
    expect(run(value, "apply")).toMatchObject({ status: "COMMITTED" })
    const prepared = JSON.parse(value.entries.get(value.mutationJournal)!.bytes!.toString("utf8").split("\n")[0])
    value.entries.set(NODE_MUTATION_LOCK_PATH, {
      type: "file",
      bytes: recordBytes({ schema_version: "1.0-aegis-standing-hash-promotion-lock",
        authority_id: AUTHORITY_ID, promotion_id: value.manifest.promotionId, acquired_at: prepared.prepared_at }),
      uid: ACCOUNT.uid, gid: ACCOUNT.gid, mode: 0o600, direct: true, nlink: 1,
    })
    value.entries.get(REPLAY_JOURNAL_PATH)!.appendOnly = false
    expectFailureCode(() => run(value, "apply"), "AEGIS_ADMISSION_PROMOTION_RECOVERY_UNCERTAIN")
    expect(value.entries.has(NODE_MUTATION_LOCK_PATH)).toBe(true)
  })

  it("reports recovery uncertainty after independently attempting every rollback", () => {
    const value = fixture({ failCommittedJournal: true, failRollback: "marker" })
    let failure: any
    try { run(value, "apply") } catch (error) { failure = error }
    expect(failure.code).toBe("AEGIS_ADMISSION_PROMOTION_RECOVERY_UNCERTAIN")
    expect(value.events).toContain("ROLLBACK_REPLACE_TRUSTED_RELEASE_MANIFEST")
    expect(value.events).toContain("ROLLBACK_INSTALL_PRIVATE_REQUEST")
    const records = value.entries.get(value.mutationJournal)!.bytes!.toString("utf8").trim().split("\n").map(JSON.parse)
    expect(records.at(-1)).toMatchObject({ record_type: "FAILED_PARTIAL", lock_release_proven: true })
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

  it.each([
    ["missing", undefined],
    ["relative", "reviewed/evidence"],
  ])("rejects a %s evidenceCheckoutPath before reading the manifest", (_label, evidenceCheckoutPath) => {
    const value = fixture()
    const authority: any = { ...value.authority }
    if (evidenceCheckoutPath === undefined) delete authority.evidenceCheckoutPath
    else authority.evidenceCheckoutPath = evidenceCheckoutPath
    const read = vi.fn(() => { throw new Error("manifest read must not occur") })
    const stderr = { value: "", write(chunk: string) { this.value += chunk } }
    const status = main([
      "--dry-run", "--authority", `${AUTHORITY_ROOT}/${AUTHORITY_ID}.json`,
    ], {
      io: { readStable: () => recordBytes(authority), read }, stderr,
    } as any)
    expect(status).toBe(2)
    expect(read).not.toHaveBeenCalled()
    expect(stderr.value).toContain("AEGIS_ADMISSION_PROMOTION_AUTHORITY_INVALID")
  })

  it("rejects a githubXcom origin spoof in the production origin normalization", () => {
    const source = fs.readFileSync(path.resolve(PROMOTION_INSTALLER_PATH), "utf8")
    expect(source).toContain("replace(/^https:\\/\\/github\\.com\\//, \"\")")
    expect("https://githubXcom/bsvalues/terragroq.git".replace(/^https:\/\/github\.com\//, "")
      .replace(/\.git$/, "")).not.toBe("bsvalues/terragroq")
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
