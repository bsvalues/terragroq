import crypto from "node:crypto"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../scripts/multi-agent-operator/scheduler-trust-registry.mjs", async () => (
  import("./fixtures/scheduler-trust-registry-fixture.mjs")
))

import {
  EligibleSetSchedulerError,
  inspectSchedulerState,
  reapAmbiguousOutcomes,
  recoverSchedulerTransactions,
  recordProviderOutcome,
  scheduleEligibleSet,
  schedulerConfigurationHash,
  schedulerHash,
  schedulerPublicKeyFingerprint,
  schedulerTrustRegistryRecordHash,
  schedulerTrustStatusEventHash,
  signSchedulerArtifact,
} from "../scripts/multi-agent-operator/eligible-set-scheduler.mjs"
import { verifyEvidenceLedger } from "../scripts/multi-agent-operator/evidence-ledger.mjs"
import { inspectLaneLeaseStore } from "../scripts/multi-agent-operator/lane-lease-checkpoint.mjs"
import { inspectReservationLedger } from "../scripts/multi-agent-operator/reservation-ledger.mjs"
import { clearTestSchedulerTrustRecords, installTestSchedulerTrustRecord } from "./fixtures/scheduler-trust-registry-fixture.mjs"

const NOW = Date.parse("2026-07-15T10:00:00.000Z")
const signer = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
const trust = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
const authority = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
const signerPublic = signer.publicKey.export({ type: "spki", format: "pem" }).toString()
const trustPublic = trust.publicKey.export({ type: "spki", format: "pem" }).toString()
const authorityPublic = authority.publicKey.export({ type: "spki", format: "pem" }).toString()
let root: string
let reference: Record<string, unknown>

function writeBundle(overrides: Record<string, unknown> = {}, recordOverrides: Record<string, unknown> = {}, statusTimes = ["2026-07-15T09:30:00.000Z"]) {
  let priorEventHash = "0".repeat(64)
  const statusEvents = statusTimes.map((issuedAt, index) => {
    const statusBody = {
      schemaVersion: 1, artifactType: "SCHEDULER_TRUST_STATUS_EVENT", eventId: `scheduler-trust-active-${index + 1}`,
      sequence: index + 1, priorEventHash, registryId: "test-scheduler-trust-pins", registryVersion: 1,
      bundleId: "bundle-mao-023", status: "ACTIVE", issuedAt,
    }
    const eventHash = schedulerTrustStatusEventHash(statusBody)
    priorEventHash = eventHash
    return signSchedulerArtifact({ ...statusBody, eventHash }, signer.privateKey)
  })
  const eventHash = statusEvents.at(-1)!.eventHash
  const bundle = signSchedulerArtifact({
    schemaVersion: 1,
    artifactType: "SCHEDULER_TRUST_ROOT_BUNDLE",
    bundleId: "bundle-mao-023",
    issuedAt: "2026-07-15T09:30:00.000Z",
    expiresAt: "2026-07-15T12:00:00.000Z",
    status: "ACTIVE",
    revocationChainHead: eventHash,
    trustRoots: { "trust-reviewer": trustPublic },
    authorityRoots: { "authority-registry": authorityPublic },
    rootFingerprints: {
      trust: { "trust-reviewer": schedulerPublicKeyFingerprint(trustPublic) },
      authority: { "authority-registry": schedulerPublicKeyFingerprint(authorityPublic) },
    },
    workerProviderBindings: [{
      workerId: "worker-23",
      providerId: "provider-23",
      adapterId: "adapter-23",
      executionSurfaces: ["HOSTED_NATIVE_TEAM"],
    }],
    ...overrides,
  }, signer.privateKey)
  const registryRecord = {
    schemaVersion: 1, artifactType: "SCHEDULER_TRUST_PIN_RECORD",
    registryId: "test-scheduler-trust-pins", registryVersion: 1, status: "ACTIVE", immutable: true,
    trustBundle: bundle,
    bundleContentHash: schedulerHash(bundle),
    signerFingerprint: schedulerPublicKeyFingerprint(signerPublic),
    signerPublicKeyPem: signerPublic,
    statusEvents, statusHeadHash: eventHash,
    maximumAgeMs: 3_600_000,
    ...recordOverrides,
  }
  installTestSchedulerTrustRecord(registryRecord.registryId, registryRecord.registryVersion, {
    registryRecord,
    pinnedRegistryRecordContentHash: schedulerTrustRegistryRecordHash(registryRecord),
  }, "2026-07-15T10:00:00.000Z")
  reference = { registryId: registryRecord.registryId, registryVersion: registryRecord.registryVersion }
  return bundle
}

function configuration(now = NOW) {
  return {
    statePath: path.join(root, "scheduler.json"),
    stateId: "scheduler-mao-023",
    trustBundleReference: reference,
    reservationLedgerPath: path.join(root, "reservations.json"),
    reservationLedgerId: "reservations-mao-023",
    leaseStorePath: path.join(root, "leases.json"),
    leaseStoreId: "leases-mao-023",
    evidenceLedgerDir: path.join(root, "evidence"),
    evidenceLedgerId: "evidence-mao-023",
    leaseTokenKey: "scheduler-test-key-material-0000000000000001",
    leaseDurationMs: 3_600_000,
    reconciliationBatchCeiling: 2,
    now: () => now,
    lockTimeoutMs: 500,
  }
}

function budgets(global = 3) {
  return {
    global,
    providers: { "provider-23": 3 },
    repositories: { "bsvalues/terragroq": 3 },
    risks: { R0: 3, R1: 3, R2: 3, R3: 3 },
    combined: { "provider-23:bsvalues/terragroq:R1": 3 },
  }
}

function envelope(workOrderId = "WO-MAO-023", laneId = "LANE-MAO-023", workerId = "worker-23") {
  return {
    artifactType: "WORK_ORDER_ENVELOPE_V2",
    schemaVersion: 2,
    programId: "PROGRAM-MAO-001",
    goalId: "GOAL-MAO-001",
    loopId: "LOOP-MAO-001",
    workOrderId,
    objective: "Run one derived scheduler integration candidate.",
    riskClass: "R1",
    repositories: ["bsvalues/terragroq"],
    baseRefs: [{ repository: "bsvalues/terragroq", ref: "refs/heads/main", commitSha: "27bfd37897d51dde27897a880c4357e0773e8a67" }],
    dependencies: [],
    fanInGate: "ALL",
    laneId,
    teamRoles: { coordinator: "coordinator-23", builder: workerId, reviewer: "reviewer-23" },
    providerRequirements: ["signed-authority", "signed-trust"],
    preferredProviders: ["provider-23"],
    fallbackProviders: [],
    reservations: {
      paths: [{ repository: "bsvalues/terragroq", path: `src/${workOrderId.toLowerCase()}.ts` }],
      contracts: [`contract-${workOrderId.toLowerCase()}`],
      environments: [],
    },
    allowedActions: ["READ_REPOSITORY", "RUN_VALIDATION", "WRITE_RESERVED_PATHS"],
    forbiddenActions: ["CREDENTIAL_ACCESS", "OWNER_CONTACT", "RUNTIME_ACTIVATION"],
    authorityGrantRefs: ["AUTHORITY-MAO-ACTIVE"],
    programActivationGrantRef: "AUTHORITY-MAO-ACTIVE",
    grantStatusEventRefs: ["AUTHORITY-EVENT-MAO-ACTIVE"],
    requiredOutputs: ["implementation", "tests"],
    requiredValidation: ["focused-vitest"],
    reviewRequirements: { independentReviewer: true, minimumApprovals: 1, maximumUnresolvedThreads: 0 },
    mergeMode: "NO_MERGE",
    retryBudget: { maxAttempts: 3, backoffSeconds: 10 },
    remediationBudget: { maxCycles: 2 },
    reroutePolicy: "COMPATIBLE_PROVIDER_ONLY",
    stopConditions: ["authority-wall"],
    evidenceTargets: ["owner-operation-counters"],
    ownerDecisionConditions: [],
    ownerOperationsAllowed: false,
    ownerTouchBudget: { credentialTouches: 0, diagnosticTouches: 0, operationTouches: 0, routineContacts: 0, routineDecisions: 0 },
    communicationPolicy: "FINAL_ONLY",
  }
}

function provider() {
  return {
    schemaVersion: 1, artifactType: "PROVIDER_CAPABILITY_SNAPSHOT",
    providerId: "provider-23", adapterId: "adapter-23", availability: "AVAILABLE",
    riskClasses: ["R0", "R1", "R2", "R3"], requirements: ["signed-authority", "signed-trust"],
    actions: ["READ_REPOSITORY", "RUN_VALIDATION", "WRITE_RESERVED_PATHS"], roles: ["builder"],
    repositories: ["bsvalues/terragroq"], maxConcurrency: 3,
    supportsCancellation: true, supportsArtifacts: true, supportsSanitizedEvidence: true,
    serviceCompatible: true, authorityMintingAllowed: false,
  }
}

function claim(config = configuration(), limit = budgets(), order = envelope(), attempt = 1) {
  const reservationSet = {
    schemaVersion: 1, artifactType: "MULTI_AGENT_RESERVATION_SET", reservationSetId: `reservation-${order.workOrderId.toLowerCase()}-${attempt}`,
    workerId: order.teamRoles.builder, workOrderId: order.workOrderId,
    reservations: { ...order.reservations, repositories: [], protectedResources: [] },
  }
  const configurationHash = schedulerConfigurationHash(config, limit)
  const signedTrust = signSchedulerArtifact({
    schemaVersion: 2, artifactType: "PREVENTIVE_TRUST_ARTIFACT_V2", artifactId: `trust-${order.workOrderId.toLowerCase()}-${attempt}`,
    issuer: "trust-reviewer",
    subject: {
      providerId: "provider-23", adapterId: "adapter-23", workerId: order.teamRoles.builder,
      roles: ["builder"], repositories: order.repositories, actions: order.allowedActions,
    },
    issuedAt: "2026-07-15T09:30:00.000Z", expiresAt: "2026-07-15T12:00:00.000Z", revoked: false,
    priorHash: "a".repeat(64), evidenceHash: "b".repeat(64),
  }, trust.privateKey)
  const reservationContentHash = schedulerHash(reservationSet)
  const authorityGrant = signSchedulerArtifact({
    schemaVersion: 1, artifactType: "SIGNED_WORK_ORDER_AUTHORITY", grantId: `grant-${order.workOrderId.toLowerCase()}-${attempt}`,
    issuer: "authority-registry", programId: order.programId, goalId: order.goalId, loopId: order.loopId,
    workOrderId: order.workOrderId, laneId: order.laneId, providerId: "provider-23", adapterId: "adapter-23",
    workerId: order.teamRoles.builder, role: "builder", executionSurface: "HOSTED_NATIVE_TEAM",
    schedulerRunId: "RUN-MAO-023", attempt, configurationHash, repositories: order.repositories,
    riskClass: order.riskClass, actions: order.allowedActions, reservationSetId: reservationSet.reservationSetId,
    reservationContentHash, issuedAt: "2026-07-15T09:30:00.000Z", expiresAt: "2026-07-15T12:00:00.000Z",
    revoked: false, trustArtifactHash: schedulerHash(signedTrust),
  }, authority.privateKey)
  return {
    schemaVersion: 1, artifactType: "ELIGIBLE_SCHEDULER_WORK",
    programId: order.programId, goalId: order.goalId, loopId: order.loopId,
    workOrderId: order.workOrderId, laneId: order.laneId, providerId: "provider-23", adapterId: "adapter-23",
    workerId: order.teamRoles.builder, requestedRole: "builder", executionSurface: "HOSTED_NATIVE_TEAM",
    schedulerRunId: "RUN-MAO-023", attempt, configurationHash, repositories: order.repositories,
    riskClass: order.riskClass, allowedActions: order.allowedActions, reservationSet, reservationContentHash,
    dispatchId: `dispatch-${order.workOrderId.toLowerCase()}-${attempt}`, trustArtifact: signedTrust, authorityGrant,
  }
}

function input(config = configuration(), limit = budgets(), orders = [envelope()]) {
  return {
    expectedVersion: 0,
    dagInput: {
      schemaVersion: 1, artifactType: "DAG_ELIGIBILITY_INPUT", workOrders: orders,
      workOrderStates: orders.map(({ workOrderId }) => ({ workOrderId, state: "PLANNED", reasonCode: null })),
    },
    dispatchClaims: orders.map((order) => claim(config, limit, order)),
    providerCapabilities: [provider()], budgets: limit,
  }
}

function schedule(config = configuration(), value = input(config)) { return scheduleEligibleSet(config, value) }

function ownerProof(entry: Record<string, unknown>, ownerId = "reconciler-23", expiresAt = "2026-07-15T12:00:00.000Z") {
  const claimValue = {
    schedulerRunId: entry.schedulerRunId,
    attempt: entry.attempt,
    fullIdentityHash: entry.fullIdentityHash,
    schedulerFencingToken: entry.schedulerFencingToken,
    leaseFencingToken: entry.leaseFencingToken,
    reservationFencingToken: entry.reservationFencingToken,
  }
  return signSchedulerArtifact({
    schemaVersion: 1, artifactType: "SIGNED_RECONCILIATION_OWNER_PROOF", proofId: "reconciliation-proof-23",
    issuer: "authority-registry", ownerId, ...claimValue, claimHash: schedulerHash(claimValue),
    issuedAt: "2026-07-15T09:30:00.000Z", expiresAt,
  }, authority.privateKey)
}

function providerResponse(entry: Record<string, unknown>, state = "SUCCEEDED") {
  return {
    schemaVersion: 1, artifactType: "PROVIDER_STATUS", providerId: entry.providerId, adapterId: entry.adapterId,
    dispatchId: entry.dispatchId, workOrderId: entry.workOrderId, laneId: entry.laneId,
    providerState: state, reasonCode: ["FAILED", "CANCELLED", "UNKNOWN"].includes(state) ? `PROVIDER_${state}` : null,
    sanitized: true, authorityGranted: false, progressMarker: state.toLowerCase(),
  }
}

function outcomeInput(entry: Record<string, unknown>, delivery: Record<string, unknown>, reconciliation: unknown = null, expectedVersion = 5) {
  return {
    expectedVersion,
    claim: {
      schedulerRunId: entry.schedulerRunId, attempt: entry.attempt, fullIdentityHash: entry.fullIdentityHash,
      schedulerFencingToken: entry.schedulerFencingToken, leaseFencingToken: entry.leaseFencingToken, reservationFencingToken: entry.reservationFencingToken,
    },
    delivery,
    reconciliation,
  }
}

function resignTrust(value: ReturnType<typeof claim>, overrides: Record<string, unknown>) {
  const trustBody = { ...value.trustArtifact, ...overrides } as Record<string, unknown>
  delete trustBody.signature
  value.trustArtifact = signSchedulerArtifact(trustBody, trust.privateKey)
  const authorityBody = { ...value.authorityGrant, trustArtifactHash: schedulerHash(value.trustArtifact) } as Record<string, unknown>
  delete authorityBody.signature
  value.authorityGrant = signSchedulerArtifact(authorityBody, authority.privateKey)
}

function expectWall(callback: () => unknown, code: string) {
  try { callback(); throw new Error("expected scheduler wall") } catch (error) {
    expect(error).toBeInstanceOf(EligibleSetSchedulerError)
    expect(error).toMatchObject({ code })
  }
}

type MutableSchedulerStateEntry = {
  lastEvidenceEventId: string
  configurationHash: string
  leaseFencingToken: number
  reservationFencingToken: number
  [key: string]: unknown
}

type MutableSchedulerState = {
  active: MutableSchedulerStateEntry[]
  stateHash: string | null
  [key: string]: unknown
}

function mutateSchedulerState(config: ReturnType<typeof configuration>, mutate: (state: MutableSchedulerState) => void) {
  const state = JSON.parse(fs.readFileSync(config.statePath, "utf8")) as MutableSchedulerState
  mutate(state)
  state.stateHash = null
  state.stateHash = schedulerHash(state)
  fs.writeFileSync(config.statePath, `${JSON.stringify(state, null, 2)}\n`)
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mao-023-remediation-"))
  writeBundle()
})
afterEach(() => { clearTestSchedulerTrustRecords(); fs.rmSync(root, { recursive: true, force: true }) })

describe("WO-MAO-023 remediated real-store scheduler", () => {
  it("derives eligibility through the Phase2 DAG resolver and commits real reservation/lease/evidence stores", () => {
    const result = schedule()
    expect(result).toMatchObject({ code: "ELIGIBLE_SET_SCHEDULED", derivedEligibleWorkOrderIds: ["WO-MAO-023"], stateVersion: 5 })
    const entry = result.scheduled[0]
    expect(entry).toMatchObject({ goalId: "GOAL-MAO-001", loopId: "LOOP-MAO-001", executionSurface: "HOSTED_NATIVE_TEAM", schedulerRunId: "RUN-MAO-023", attempt: 1 })
    expect(inspectReservationLedger(configuration().reservationLedgerPath, configuration().reservationLedgerId, { schemaVersion: 1, artifactType: "MULTI_AGENT_RESERVATION_INSPECT_REQUEST" })).toMatchObject({ valid: true, reservations: [{ fencingToken: entry.reservationFencingToken }] })
    expect(inspectLaneLeaseStore(configuration().leaseStorePath, configuration().leaseStoreId)).toMatchObject({ ok: true, lanes: [{ status: "ACTIVE", fencingToken: entry.leaseFencingToken, lifecycleState: "PROVIDER_DISPATCHED" }] })
    expect(verifyEvidenceLedger(configuration().evidenceLedgerDir, configuration().evidenceLedgerId, { schemaVersion: 1, artifactType: "MULTI_AGENT_EVIDENCE_VERIFY_REQUEST", expectedAnchor: null })).toMatchObject({ ok: true, eventCount: 1 })
  })

  it("does not accept caller-selected eligibility or incomplete/extra DAG claims", () => {
    const value = input()
    value.dispatchClaims = []
    expectWall(() => schedule(configuration(), value), "SCHEDULER_DAG_WALL")
    expect(fs.existsSync(configuration().statePath)).toBe(false)
  })

  it("rejects caller trust material and a tampered, stale, revoked, or status-chain-substituted registry record", () => {
    expectWall(() => scheduleEligibleSet({ ...configuration(), trustRoots: { x: trustPublic } }, input()), "SCHEDULER_UNKNOWN_FIELD_WALL")
    for (const mutate of [
      () => writeBundle({ status: "REVOKED" }),
      () => writeBundle({ expiresAt: "2026-07-15T09:59:00.000Z" }),
      () => writeBundle({ revocationChainHead: "d".repeat(64) }),
      () => writeBundle({ rootFingerprints: { trust: { "trust-reviewer": "f".repeat(64) }, authority: { "authority-registry": schedulerPublicKeyFingerprint(authorityPublic) } } }),
      () => writeBundle({}, { statusHeadHash: "d".repeat(64) }),
    ]) {
      clearTestSchedulerTrustRecords(); mutate()
      expectWall(() => schedule(), "SCHEDULER_TRUST_BUNDLE_WALL")
    }
    writeBundle()
    reference = { ...reference, signerFingerprint: "f".repeat(64) }
    expectWall(() => schedule(), "SCHEDULER_TRUST_BUNDLE_WALL")
  })

  it("rejects cryptographically identical trust/authority keys despite different PEM encodings", () => {
    const alternatePem = trust.publicKey.export({ type: "pkcs1", format: "pem" }).toString()
    writeBundle({
      authorityRoots: { "authority-registry": alternatePem },
      rootFingerprints: {
        trust: { "trust-reviewer": schedulerPublicKeyFingerprint(trustPublic) },
        authority: { "authority-registry": schedulerPublicKeyFingerprint(alternatePem) },
      },
    })
    const value = input()
    const body = { ...value.dispatchClaims[0].authorityGrant } as Record<string, unknown>; delete body.signature
    value.dispatchClaims[0].authorityGrant = signSchedulerArtifact(body, trust.privateKey)
    expectWall(() => schedule(configuration(), value), "SCHEDULER_TRUST_BUNDLE_WALL")
  })

  it.each([
    ["future", ["2026-07-15T10:01:00.000Z"]],
    ["out-of-order", ["2026-07-15T09:45:00.000Z", "2026-07-15T09:44:00.000Z"]],
  ])("rejects %s trust status time", (_name, times) => {
    clearTestSchedulerTrustRecords(); writeBundle({}, {}, times)
    expectWall(() => schedule(), "SCHEDULER_TRUST_STATUS_WALL")
  })

  it.each([
    ["forged", (value: ReturnType<typeof claim>) => { value.trustArtifact = { ...value.trustArtifact, signature: Buffer.from("forged").toString("base64") } }],
    ["stale", (value: ReturnType<typeof claim>) => resignTrust(value, { expiresAt: "2026-07-15T09:59:00.000Z" })],
    ["revoked", (value: ReturnType<typeof claim>) => resignTrust(value, { revoked: true })],
    ["provider substitution", (value: ReturnType<typeof claim>) => resignTrust(value, { subject: { ...value.trustArtifact.subject, providerId: "other-provider" } })],
  ])("rejects %s candidate trust before every Phase2 side effect", (_name, mutate) => {
    const value = input(); mutate(value.dispatchClaims[0])
    expect(() => schedule(configuration(), value)).toThrow()
    expect(fs.existsSync(configuration().reservationLedgerPath)).toBe(false)
    expect(fs.existsSync(configuration().leaseStorePath)).toBe(false)
  })

  it("binds complete configuration, reservation content, worker/work order, and signed identity scope", () => {
    const mutations = [
      (value: ReturnType<typeof input>) => { value.dispatchClaims[0].goalId = "GOAL-SUBSTITUTED" },
      (value: ReturnType<typeof input>) => { value.dispatchClaims[0].executionSurface = "LOCAL_RUNTIME" },
      (value: ReturnType<typeof input>) => { value.dispatchClaims[0].attempt = 2 },
      (value: ReturnType<typeof input>) => { value.dispatchClaims[0].configurationHash = "f".repeat(64) },
      (value: ReturnType<typeof input>) => { value.dispatchClaims[0].reservationSet.workerId = "other-worker" },
      (value: ReturnType<typeof input>) => { value.dispatchClaims[0].reservationSet.reservations.paths[0].path = "src/substitution.ts" },
    ]
    for (const mutate of mutations) {
      const value = input(); mutate(value)
      expect(() => schedule(configuration(), value)).toThrow()
      expect(fs.existsSync(configuration().statePath)).toBe(false)
    }
  })

  it("uses DAG-derived all-work scheduling while enforcing an atomic global ceiling", () => {
    const second = envelope("WO-MAO-024", "LANE-MAO-024", "worker-23")
    const limit = budgets(1)
    const config = configuration()
    const result = schedule(config, input(config, limit, [envelope(), second]))
    expect(result.scheduled).toHaveLength(1)
    expect(result.blocked).toEqual([{ workOrderId: "WO-MAO-024", code: "GLOBAL_CAPACITY_EXHAUSTED" }])
  })

  it("runs two Work Orders for one worker/run without lease idempotency-key collision", () => {
    const orders = [envelope(), envelope("WO-MAO-024", "LANE-MAO-024", "worker-23")]
    const config = configuration()
    const result = schedule(config, input(config, budgets(3), orders))
    expect(result.scheduled).toHaveLength(2)
    expect(inspectLaneLeaseStore(config.leaseStorePath, config.leaseStoreId).lanes).toMatchObject([
      { workOrderId: "WO-MAO-023", status: "ACTIVE" }, { workOrderId: "WO-MAO-024", status: "ACTIVE" },
    ])
  })

  it("compensates candidate one when candidate two fails after cross-store mutation", () => {
    const orders = [envelope(), envelope("WO-MAO-024", "LANE-MAO-024", "worker-23")]
    let evidenceBoundary = 0
    const config = { ...configuration(), failureInjector: (point: string) => {
      if (point === "SCHEDULE:EVIDENCE" && ++evidenceBoundary === 2) throw new Error("INJECTED:CANDIDATE_TWO")
    } }
    expect(() => schedule(config, input(config, budgets(3), orders))).toThrow("INJECTED:CANDIDATE_TWO")
    expect(inspectLaneLeaseStore(config.leaseStorePath, config.leaseStoreId).lanes.every((lane: Record<string, unknown>) => lane.status !== "ACTIVE")).toBe(true)
    expect(inspectReservationLedger(config.reservationLedgerPath, config.reservationLedgerId, { schemaVersion: 1, artifactType: "MULTI_AGENT_RESERVATION_INSPECT_REQUEST" }).reservations).toEqual([])
    expect(fs.existsSync(config.statePath)).toBe(false)
  })

  it.each([
    ["global", (value: ReturnType<typeof budgets>) => { value.global = 1 }, "GLOBAL_CAPACITY_EXHAUSTED"],
    ["provider", (value: ReturnType<typeof budgets>) => { value.providers["provider-23"] = 1 }, "CAPACITY_EXHAUSTED:providers:provider-23"],
    ["repository", (value: ReturnType<typeof budgets>) => { value.repositories["bsvalues/terragroq"] = 1 }, "CAPACITY_EXHAUSTED:repositories:bsvalues/terragroq"],
    ["risk", (value: ReturnType<typeof budgets>) => { value.risks.R1 = 1 }, "CAPACITY_EXHAUSTED:risks:R1"],
    ["combined", (value: ReturnType<typeof budgets>) => { value.combined["provider-23:bsvalues/terragroq:R1"] = 1 }, "CAPACITY_EXHAUSTED:combined:provider-23:bsvalues/terragroq:R1"],
  ])("holds the real Phase2 claim while enforcing %s ceiling", (_name, mutate, reason) => {
    const limit = budgets(); mutate(limit)
    const config = configuration()
    const orders = [envelope(), envelope("WO-MAO-024", "LANE-MAO-024", "worker-23")]
    const result = schedule(config, input(config, limit, orders))
    expect(result.scheduled).toHaveLength(1)
    expect(result.blocked).toEqual([{ workOrderId: "WO-MAO-024", code: reason }])
    expect(inspectReservationLedger(config.reservationLedgerPath, config.reservationLedgerId, { schemaVersion: 1, artifactType: "MULTI_AGENT_RESERVATION_INSPECT_REQUEST" }).reservations).toHaveLength(1)
  })

  it.each(["SUCCEEDED", "FAILED", "CANCELLED"])("validates provider response %s and releases real stores only after checkpoint/evidence", (state) => {
    const entry = schedule().scheduled[0]
    const result = recordProviderOutcome(configuration(NOW + 1), outcomeInput(entry, {
      kind: "PROVIDER_RESPONSE", providerResponse: providerResponse(entry, state), reasonCode: null, evidence: { state },
    }))
    expect(result).toMatchObject({ code: "OUTCOME_TERMINAL_RELEASED", capacityReleased: true, stateVersion: 9 })
    expect(inspectLaneLeaseStore(configuration().leaseStorePath, configuration().leaseStoreId).lanes[0].status).toBe("RELEASED")
    expect(inspectReservationLedger(configuration().reservationLedgerPath, configuration().reservationLedgerId, { schemaVersion: 1, artifactType: "MULTI_AGENT_RESERVATION_INSPECT_REQUEST" }).reservations).toEqual([])
    expect(verifyEvidenceLedger(configuration().evidenceLedgerDir, configuration().evidenceLedgerId, { schemaVersion: 1, artifactType: "MULTI_AGENT_EVIDENCE_VERIFY_REQUEST", expectedAnchor: null })).toMatchObject({ ok: true, eventCount: 2 })
  })

  it("returns the stored terminal result for identical delivery replay and rejects a differing replay", () => {
    const entry = schedule().scheduled[0]
    const delivery = { kind: "PROVIDER_RESPONSE", providerResponse: providerResponse(entry, "SUCCEEDED"), reasonCode: null, evidence: { digest: "same" } }
    const first = recordProviderOutcome(configuration(NOW + 1), outcomeInput(entry, delivery))
    const replay = recordProviderOutcome(configuration(NOW + 2), outcomeInput(entry, structuredClone(delivery), null, first.stateVersion))
    expect(replay).toMatchObject({ code: "OUTCOME_TERMINAL_RELEASED", idempotent: true, outcome: "SUCCEEDED", lifecycleState: "DEPENDENTS_RELEASED", stateVersion: first.stateVersion })
    expectWall(() => recordProviderOutcome(configuration(NOW + 3), outcomeInput(entry, { ...structuredClone(delivery), evidence: { digest: "different" } }, null, first.stateVersion)), "SCHEDULER_TERMINAL_REPLAY_WALL")
  })

  it.each(["ACCEPTED", "RUNNING"])("validates and checkpoints nonterminal provider state %s in the real lease/evidence stores", (state) => {
    const entry = schedule().scheduled[0]
    const result = recordProviderOutcome(configuration(NOW + 1), outcomeInput(entry, {
      kind: "PROVIDER_RESPONSE", providerResponse: providerResponse(entry, state), reasonCode: null, evidence: { state },
    }))
    expect(result).toMatchObject({ code: "OUTCOME_CHECKPOINTED", capacityReleased: false, lifecycleState: "EXECUTING" })
    expect(inspectLaneLeaseStore(configuration().leaseStorePath, configuration().leaseStoreId).lanes[0]).toMatchObject({ status: "ACTIVE", lifecycleState: "EXECUTING" })
  })

  it("accepts ACCEPTED then RUNNING and keeps repeated RUNNING lifecycle-idempotent", () => {
    const entry = schedule().scheduled[0]
    const accepted = recordProviderOutcome(configuration(NOW + 1), outcomeInput(entry, {
      kind: "PROVIDER_RESPONSE", providerResponse: providerResponse(entry, "ACCEPTED"), reasonCode: null, evidence: { sequence: 1 },
    }))
    const running = recordProviderOutcome(configuration(NOW + 2), outcomeInput(entry, {
      kind: "PROVIDER_RESPONSE", providerResponse: providerResponse(entry, "RUNNING"), reasonCode: null, evidence: { sequence: 2 },
    }, null, accepted.stateVersion))
    const repeated = recordProviderOutcome(configuration(NOW + 3), outcomeInput(entry, {
      kind: "PROVIDER_RESPONSE", providerResponse: providerResponse(entry, "RUNNING"), reasonCode: null, evidence: { sequence: 3 },
    }, null, running.stateVersion))
    expect(repeated).toMatchObject({ code: "OUTCOME_CHECKPOINTED", lifecycleState: "EXECUTING", capacityReleased: false })
    expect(inspectLaneLeaseStore(configuration().leaseStorePath, configuration().leaseStoreId).lanes[0]).toMatchObject({ status: "ACTIVE", lifecycleState: "EXECUTING", checkpointSequence: 3 })
  })

  it.each(["SCHEDULE:INTENT", "SCHEDULE:RESERVATION", "SCHEDULE:LEASE", "SCHEDULE:CHECKPOINT", "SCHEDULE:EVIDENCE", "SCHEDULE:SCHEDULER_STATE"])("durably rolls back a schedule failure at %s", (failurePoint) => {
    let injected = false
    const config = { ...configuration(), failureInjector: (point: string) => { if (!injected && point === failurePoint) { injected = true; throw new Error(`INJECTED:${point}`) } } }
    expect(() => schedule(config, input(config))).toThrow()
    if (fs.existsSync(config.leaseStorePath)) expect(inspectLaneLeaseStore(config.leaseStorePath, config.leaseStoreId).lanes.every((lane: Record<string, unknown>) => lane.status !== "ACTIVE")).toBe(true)
    if (fs.existsSync(config.reservationLedgerPath)) expect(inspectReservationLedger(config.reservationLedgerPath, config.reservationLedgerId, { schemaVersion: 1, artifactType: "MULTI_AGENT_RESERVATION_INSPECT_REQUEST" }).reservations).toEqual([])
    expect(recoverSchedulerTransactions(configuration())).toMatchObject({ code: "SCHEDULER_TRANSACTION_RECOVERY_COMPLETE" })
  })

  it("fails before all outcome side effects when the durable outcome intent cannot be written", () => {
    const entry = schedule().scheduled[0]
    const config = { ...configuration(NOW + 1), failureInjector: (point: string) => { if (point === "OUTCOME:INTENT") throw new Error("INJECTED:OUTCOME:INTENT") } }
    expect(() => recordProviderOutcome(config, outcomeInput(entry, {
      kind: "PROVIDER_RESPONSE", providerResponse: providerResponse(entry, "SUCCEEDED"), reasonCode: null, evidence: {},
    }))).toThrow("INJECTED:OUTCOME:INTENT")
    expect(inspectSchedulerState(config.statePath, config.stateId).state.active).toHaveLength(1)
    expect(inspectLaneLeaseStore(config.leaseStorePath, config.leaseStoreId).lanes[0]).toMatchObject({ status: "ACTIVE", lifecycleState: "PROVIDER_DISPATCHED" })
  })

  it.each(["OUTCOME:CHECKPOINT:VALIDATING", "OUTCOME:EVIDENCE", "OUTCOME:LEASE_RELEASE", "OUTCOME:RESERVATION_RELEASE", "OUTCOME:SCHEDULER_STATE"])("recovers terminal outcome failure at %s without ACTIVE/released split-brain", (failurePoint) => {
    const entry = schedule().scheduled[0]
    let injected = false
    const config = { ...configuration(NOW + 1), failureInjector: (point: string) => { if (!injected && point === failurePoint) { injected = true; throw new Error(`INJECTED:${point}`) } } }
    const terminal = recordProviderOutcome(config, outcomeInput(entry, {
      kind: "PROVIDER_RESPONSE", providerResponse: providerResponse(entry, "SUCCEEDED"), reasonCode: null, evidence: { failurePoint },
    }))
    expect(terminal).toMatchObject({ code: "OUTCOME_TERMINAL_RELEASED", lifecycleState: "DEPENDENTS_RELEASED" })
    expect(inspectSchedulerState(config.statePath, config.stateId).state).toMatchObject({ active: [], released: [{ status: "RELEASED", lifecycleState: "DEPENDENTS_RELEASED" }] })
    expect(inspectLaneLeaseStore(config.leaseStorePath, config.leaseStoreId).lanes[0].status).toBe("RELEASED")
    expect(inspectReservationLedger(config.reservationLedgerPath, config.reservationLedgerId, { schemaVersion: 1, artifactType: "MULTI_AGENT_RESERVATION_INSPECT_REQUEST" }).reservations).toEqual([])
  })

  it("rejects malformed common-provider response without mutating scheduler or Phase2 stores", () => {
    const entry = schedule().scheduled[0]
    expect(() => recordProviderOutcome(configuration(NOW + 1), outcomeInput(entry, {
      kind: "PROVIDER_RESPONSE", providerResponse: { ...providerResponse(entry), surprise: true }, reasonCode: null, evidence: {},
    }))).toThrow()
    expect(inspectSchedulerState(configuration().statePath, configuration().stateId).state.version).toBe(5)
    expect(inspectLaneLeaseStore(configuration().leaseStorePath, configuration().leaseStoreId).lanes[0].status).toBe("ACTIVE")
  })

  it("reclaims an expired fenced lease and completes the terminal outcome without capacity leak", () => {
    const initial = { ...configuration(NOW), leaseDurationMs: 100 }
    const entry = schedule(initial, input(initial)).scheduled[0]
    const result = recordProviderOutcome({ ...configuration(NOW + 101), leaseDurationMs: 100 }, outcomeInput(entry, {
      kind: "PROVIDER_RESPONSE", providerResponse: providerResponse(entry, "SUCCEEDED"), reasonCode: null, evidence: { expired: true },
    }))
    expect(result).toMatchObject({ code: "OUTCOME_TERMINAL_RELEASED", lifecycleState: "DEPENDENTS_RELEASED" })
    const lane = inspectLaneLeaseStore(initial.leaseStorePath, initial.leaseStoreId).lanes[0]
    expect(lane.status).toBe("RELEASED")
    expect(lane.fencingToken).toBeGreaterThan(entry.leaseFencingToken)
  })

  it("recovery detects a missing reservation store and safely compensates the scheduler claim", () => {
    const config = configuration()
    schedule(config)
    fs.rmSync(config.reservationLedgerPath)
    const recovered = recoverSchedulerTransactions(configuration(NOW + 1))
    expect(recovered.code).toBe("SCHEDULER_TRANSACTION_RECOVERY_COMPLETE")
    expect(inspectSchedulerState(config.statePath, config.stateId).state).toMatchObject({ active: [], released: [{ outcome: "STORE_DIVERGENCE_COMPENSATED" }] })
    expect(inspectLaneLeaseStore(config.leaseStorePath, config.leaseStoreId).lanes[0].status).not.toBe("ACTIVE")
  })

  it("recovery detects a missing lease store and releases the surviving reservation", () => {
    const config = configuration()
    schedule(config)
    fs.rmSync(config.leaseStorePath)
    recoverSchedulerTransactions(configuration(NOW + 1))
    expect(inspectSchedulerState(config.statePath, config.stateId).state).toMatchObject({ active: [], released: [{ outcome: "STORE_DIVERGENCE_COMPENSATED" }] })
    expect(inspectReservationLedger(config.reservationLedgerPath, config.reservationLedgerId, { schemaVersion: 1, artifactType: "MULTI_AGENT_RESERVATION_INSPECT_REQUEST" }).reservations).toEqual([])
  })

  it("recovery rejects a tampered checkpoint store and compensates every still-verifiable claim", () => {
    const config = configuration()
    schedule(config)
    const leaseStore = JSON.parse(fs.readFileSync(config.leaseStorePath, "utf8"))
    leaseStore.lanes[0].checkpoint.evidence.configurationHash = "f".repeat(64)
    fs.writeFileSync(config.leaseStorePath, JSON.stringify(leaseStore))
    recoverSchedulerTransactions(configuration(NOW + 1))
    expect(inspectSchedulerState(config.statePath, config.stateId).state).toMatchObject({ active: [], released: [{ outcome: "STORE_DIVERGENCE_COMPENSATED" }] })
    expect(inspectReservationLedger(config.reservationLedgerPath, config.reservationLedgerId, { schemaVersion: 1, artifactType: "MULTI_AGENT_RESERVATION_INSPECT_REQUEST" }).reservations).toEqual([])
  })

  it("canonical evidence-chain verification detects tampering and compensates all durable capacity", () => {
    const config = configuration()
    schedule(config)
    const eventPath = path.join(config.evidenceLedgerDir, "events", fs.readdirSync(path.join(config.evidenceLedgerDir, "events"))[0])
    const event = JSON.parse(fs.readFileSync(eventPath, "utf8"))
    event.payload.transitionContentHash = "f".repeat(64)
    fs.writeFileSync(eventPath, JSON.stringify(event))
    recoverSchedulerTransactions(configuration(NOW + 1))
    expect(inspectSchedulerState(config.statePath, config.stateId).state).toMatchObject({ active: [], released: [{ outcome: "STORE_DIVERGENCE_COMPENSATED" }] })
    expect(inspectLaneLeaseStore(config.leaseStorePath, config.leaseStoreId).lanes[0].status).toBe("RELEASED")
    expect(inspectReservationLedger(config.reservationLedgerPath, config.reservationLedgerId, { schemaVersion: 1, artifactType: "MULTI_AGENT_RESERVATION_INSPECT_REQUEST" }).reservations).toEqual([])
  })

  it("compensates a claim whose bound evidence event is missing", () => {
    const config = configuration()
    schedule(config)
    const events = path.join(config.evidenceLedgerDir, "events")
    fs.rmSync(path.join(events, fs.readdirSync(events)[0]))
    recoverSchedulerTransactions(configuration(NOW + 1))
    expect(inspectSchedulerState(config.statePath, config.stateId).state).toMatchObject({ active: [], released: [{ outcome: "STORE_DIVERGENCE_COMPENSATED" }] })
    expect(inspectLaneLeaseStore(config.leaseStorePath, config.leaseStoreId).lanes[0].status).toBe("RELEASED")
  })

  it("rejects substitution of another valid Work Order evidence event", () => {
    const config = configuration()
    const orders = [envelope(), envelope("WO-MAO-024", "LANE-MAO-024", "worker-23")]
    schedule(config, input(config, budgets(3), orders))
    mutateSchedulerState(config, (state) => { state.active[0].lastEvidenceEventId = state.active[1].lastEvidenceEventId })
    recoverSchedulerTransactions(configuration(NOW + 1))
    const state = inspectSchedulerState(config.statePath, config.stateId).state
    expect(state.active).toHaveLength(1)
    expect(state.active[0].workOrderId).toBe("WO-MAO-024")
    expect(state.released[0]).toMatchObject({ workOrderId: "WO-MAO-023", outcome: "STORE_DIVERGENCE_COMPENSATED" })
  })

  it("rejects substituted scheduler checkpoint/config projection and uses durable store fences to compensate", () => {
    const config = configuration()
    schedule(config)
    mutateSchedulerState(config, (state) => {
      state.active[0].configurationHash = "f".repeat(64)
      state.active[0].leaseFencingToken = 999
      state.active[0].reservationFencingToken = 999
    })
    recoverSchedulerTransactions(configuration(NOW + 1))
    expect(inspectSchedulerState(config.statePath, config.stateId).state.active).toEqual([])
    expect(inspectLaneLeaseStore(config.leaseStorePath, config.leaseStoreId).lanes[0].status).toBe("RELEASED")
    expect(inspectReservationLedger(config.reservationLedgerPath, config.reservationLedgerId, { schemaVersion: 1, artifactType: "MULTI_AGENT_RESERVATION_INSPECT_REQUEST" }).reservations).toEqual([])
  })

  it("reclaims expiry with a new canonically verified evidence projection and second recovery is idempotent", () => {
    const config = { ...configuration(NOW), leaseDurationMs: 100 }
    schedule(config, input(config))
    const first = recoverSchedulerTransactions({ ...configuration(NOW + 101), leaseDurationMs: 100 })
    const stateAfterFirst = inspectSchedulerState(config.statePath, config.stateId).state
    const entry = stateAfterFirst.active[0]
    expect(entry.leaseFencingToken).toBeGreaterThan(1)
    expect(verifyEvidenceLedger(config.evidenceLedgerDir, config.evidenceLedgerId, { schemaVersion: 1, artifactType: "MULTI_AGENT_EVIDENCE_VERIFY_REQUEST", expectedAnchor: null })).toMatchObject({ ok: true, eventCount: 2 })
    const second = recoverSchedulerTransactions({ ...configuration(NOW + 102), leaseDurationMs: 100 })
    const stateAfterSecond = inspectSchedulerState(config.statePath, config.stateId).state
    expect(second.stateVersion).toBe(first.stateVersion)
    expect(stateAfterSecond.version).toBe(stateAfterFirst.version)
    expect(stateAfterSecond.active[0].lastEvidenceEventId).toBe(entry.lastEvidenceEventId)
  })

  it.each(["TRANSPORT_ERROR", "AUTHENTICATION_ERROR", "RATE_LIMIT", "SERVER_ERROR", "TIMEOUT", "MALFORMED_RESPONSE"])("treats %s as delivery-ambiguous and retains real capacity/reservation", (kind) => {
    const entry = schedule().scheduled[0]
    const proof = ownerProof(entry)
    const result = recordProviderOutcome(configuration(NOW + 1), outcomeInput(entry, {
      kind, providerResponse: null, reasonCode: `${kind}_WALL`, evidence: { kind },
    }, { ownerId: "reconciler-23", deadline: "2026-07-15T10:05:00.000Z", ownerProof: proof }))
    expect(result).toMatchObject({ code: "OUTCOME_RECONCILIATION_REQUIRED", capacityReleased: false, fencedForReconciliation: true, stateVersion: 9 })
    expect(inspectLaneLeaseStore(configuration().leaseStorePath, configuration().leaseStoreId).lanes[0]).toMatchObject({ status: "ACTIVE", lifecycleState: "REROUTE_PENDING" })
    expect(inspectReservationLedger(configuration().reservationLedgerPath, configuration().reservationLedgerId, { schemaVersion: 1, artifactType: "MULTI_AGENT_RESERVATION_INSPECT_REQUEST" }).reservations).toHaveLength(1)
  })

  it("treats validated UNKNOWN provider state as delivery-ambiguous", () => {
    const entry = schedule().scheduled[0]
    const result = recordProviderOutcome(configuration(NOW + 1), outcomeInput(entry, {
      kind: "PROVIDER_RESPONSE", providerResponse: providerResponse(entry, "UNKNOWN"), reasonCode: null, evidence: {},
    }, { ownerId: "reconciler-23", deadline: "2026-07-15T10:05:00.000Z", ownerProof: ownerProof(entry) }))
    expect(result).toMatchObject({ code: "OUTCOME_RECONCILIATION_REQUIRED", capacityReleased: false })
  })

  it("treats attribution mismatch as ambiguous instead of releasing", () => {
    const entry = schedule().scheduled[0]
    const response = providerResponse(entry, "RUNNING")
    response.dispatchId = "wrong-dispatch"
    const result = recordProviderOutcome(configuration(NOW + 1), outcomeInput(entry, {
      kind: "PROVIDER_RESPONSE", providerResponse: response, reasonCode: null, evidence: {},
    }, { ownerId: "reconciler-23", deadline: "2026-07-15T10:05:00.000Z", ownerProof: ownerProof(entry) }))
    expect(result).toMatchObject({ outcome: "ATTRIBUTION_MISMATCH", capacityReleased: false })
  })

  it("reaper requires the exact original owner proof, identity/fences, deadline, batch ceiling, and CAS", () => {
    const entry = schedule().scheduled[0]
    const proof = ownerProof(entry, "reconciler-23", "2026-07-15T10:05:00.000Z")
    recordProviderOutcome(configuration(NOW + 1), outcomeInput(entry, {
      kind: "TRANSPORT_ERROR", providerResponse: null, reasonCode: "TRANSPORT_WALL", evidence: {},
    }, { ownerId: "reconciler-23", deadline: "2026-07-15T10:05:00.000Z", ownerProof: proof }))
    const claimValue = {
      schedulerRunId: entry.schedulerRunId, attempt: entry.attempt, fullIdentityHash: entry.fullIdentityHash,
      schedulerFencingToken: entry.schedulerFencingToken, leaseFencingToken: entry.leaseFencingToken, reservationFencingToken: entry.reservationFencingToken, ownerProof: proof,
    }
    expectWall(() => reapAmbiguousOutcomes(configuration(NOW + 2), { expectedVersion: 9, claims: [claimValue], maxBatch: 1 }), "SCHEDULER_RECONCILIATION_WALL")
    expectWall(() => reapAmbiguousOutcomes(configuration(Date.parse("2026-07-15T10:06:00.000Z")), { expectedVersion: 9, claims: [{ ...claimValue, leaseFencingToken: 999 }], maxBatch: 1 }), "SCHEDULER_SCOPE_WALL")
    expectWall(() => reapAmbiguousOutcomes(configuration(Date.parse("2026-07-15T10:06:00.000Z")), { expectedVersion: 9, claims: [{ ...claimValue, reservationFencingToken: 999 }], maxBatch: 1 }), "SCHEDULER_SCOPE_WALL")
    expectWall(() => reapAmbiguousOutcomes(configuration(Date.parse("2026-07-15T10:06:00.000Z")), { expectedVersion: 9, claims: [claimValue], maxBatch: 3 }), "SCHEDULER_RECONCILIATION_WALL")
    expectWall(() => reapAmbiguousOutcomes(configuration(Date.parse("2026-07-15T10:06:00.000Z")), { expectedVersion: 8, claims: [claimValue], maxBatch: 1 }), "SCHEDULER_CAS_WALL")
    const otherOwnerProof = ownerProof(entry, "other-reconciler")
    expectWall(() => reapAmbiguousOutcomes(configuration(Date.parse("2026-07-15T10:06:00.000Z")), { expectedVersion: 9, claims: [{ ...claimValue, ownerProof: otherOwnerProof }], maxBatch: 1 }), "SCHEDULER_RECONCILIATION_WALL")
    const reaped = reapAmbiguousOutcomes(configuration(Date.parse("2026-07-15T10:06:00.000Z")), { expectedVersion: 9, claims: [claimValue], maxBatch: 1 })
    expect(reaped).toMatchObject({ capacityRecovered: 1, stateVersion: 10 })
    expect(inspectLaneLeaseStore(configuration().leaseStorePath, configuration().leaseStoreId).lanes[0].status).toBe("RELEASED")
  })

  it("prevalidates an entire two-claim reaper batch so a wrong second fence releases neither", () => {
    const config = configuration()
    const orders = [envelope(), envelope("WO-MAO-024", "LANE-MAO-024", "worker-23")]
    const entries = schedule(config, input(config, budgets(3), orders)).scheduled
    let version = 10
    const claims = entries.map((entry: Record<string, unknown>) => {
      const proof = ownerProof(entry, "reconciler-23", "2026-07-15T10:05:00.000Z")
      const outcome = recordProviderOutcome(configuration(NOW + 1), outcomeInput(entry, {
        kind: "TRANSPORT_ERROR", providerResponse: null, reasonCode: "TRANSPORT_WALL", evidence: { workOrderId: entry.workOrderId },
      }, { ownerId: "reconciler-23", deadline: "2026-07-15T10:05:00.000Z", ownerProof: proof }, version))
      version = outcome.stateVersion
      return {
        schedulerRunId: entry.schedulerRunId, attempt: entry.attempt, fullIdentityHash: entry.fullIdentityHash,
        schedulerFencingToken: entry.schedulerFencingToken, leaseFencingToken: entry.leaseFencingToken,
        reservationFencingToken: entry.reservationFencingToken, ownerProof: proof,
      }
    })
    const reapConfig = configuration(Date.parse("2026-07-15T10:06:00.000Z"))
    expectWall(() => reapAmbiguousOutcomes(reapConfig, { expectedVersion: version, claims: [claims[0], { ...claims[1], reservationFencingToken: 999 }], maxBatch: 2 }), "SCHEDULER_SCOPE_WALL")
    expect(inspectLaneLeaseStore(config.leaseStorePath, config.leaseStoreId).lanes.every((lane: Record<string, unknown>) => lane.status === "ACTIVE")).toBe(true)
    expect(inspectReservationLedger(config.reservationLedgerPath, config.reservationLedgerId, { schemaVersion: 1, artifactType: "MULTI_AGENT_RESERVATION_INSPECT_REQUEST" }).reservations).toHaveLength(2)
    let releaseBoundary = 0
    const recoveringReapConfig = { ...reapConfig, failureInjector: (point: string) => {
      if (point === "OUTCOME:LEASE_RELEASE" && ++releaseBoundary === 2) throw new Error("INJECTED:SECOND_REAPER_RELEASE")
    } }
    const reaped = reapAmbiguousOutcomes(recoveringReapConfig, { expectedVersion: version, claims, maxBatch: 2 })
    expect(reaped).toMatchObject({ capacityRecovered: 2 })
    expect(inspectSchedulerState(config.statePath, config.stateId).state.reconciliation).toEqual([])
  })

  it("rejects a reconciliation proof that expires before its deadline", () => {
    const entry = schedule().scheduled[0]
    expectWall(() => recordProviderOutcome(configuration(NOW + 1), outcomeInput(entry, {
      kind: "TIMEOUT", providerResponse: null, reasonCode: "TIMEOUT_WALL", evidence: {},
    }, { ownerId: "reconciler-23", deadline: "2026-07-15T10:05:00.000Z", ownerProof: ownerProof(entry, "reconciler-23", "2026-07-15T10:04:59.000Z") })), "SCHEDULER_RECONCILIATION_WALL")
  })

  it("passes only the opaque registry reference to the CLI and production fails closed without a preconfigured record", () => {
    const config = configuration()
    const configPath = path.join(root, "cli-config.json")
    const inputPath = path.join(root, "cli-input.json")
    fs.writeFileSync(configPath, JSON.stringify({ ...config, now: NOW }))
    fs.writeFileSync(inputPath, JSON.stringify(input(config)))
    const cli = path.resolve("scripts/multi-agent-operator/eligible-set-scheduler-cli.mjs")
    const processResult = spawnSync(process.execPath, [cli, "schedule", configPath, inputPath], { encoding: "utf8" })
    expect(processResult.status).toBe(2)
    expect(JSON.parse(processResult.stdout)).toMatchObject({ ok: false, code: "SCHEDULER_TRUST_REGISTRY_WALL" })
    expect(config.trustBundleReference).toEqual({ registryId: "test-scheduler-trust-pins", registryVersion: 1 })
  })
})
