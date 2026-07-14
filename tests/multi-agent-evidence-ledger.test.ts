import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"

import { afterEach, describe, expect, it } from "vitest"

import { canonicalJson } from "../scripts/multi-agent-operator/authority-events.mjs"
import {
  appendEvidenceEvent,
  deriveOwnerTouchMeter,
  EVIDENCE_EVENT_TYPES,
  verifyEvidenceLedger,
} from "../scripts/multi-agent-operator/evidence-ledger.mjs"
import {
  acquireLaneLease,
  checkpointLaneLease,
  inspectLaneLeaseStore,
} from "../scripts/multi-agent-operator/lane-lease-checkpoint.mjs"
import { transitionLifecycle } from "../scripts/multi-agent-operator/lifecycle-state-machine.mjs"

const roots: string[] = []
const storeId = "STORE-MAO-022"
const ledgerId = "LEDGER-MAO-022"
const workOrderId = "WO-MAO-022"
const laneId = "LANE-EVIDENCE"
const workerId = "hosted-codex-evidence"
const holderToken = "lease-holder-material-mao-022"
const hash = (value: unknown) => crypto.createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex")

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mao-evidence-ledger-"))
  roots.push(root)
  return { root, store: path.join(root, "lease.json"), ledger: path.join(root, "evidence") }
}

function establish(store: string, now = 1_000) {
  const checkpointEvidence = { phase: "evidence-ledger", workerId }
  expect(acquireLaneLease(store, storeId, {
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_LANE_LEASE_ACQUIRE_REQUEST",
    workOrderId,
    laneId,
    workerId,
    idempotencyKey: `acquire-evidence-${now}`,
    holderToken,
    leaseDurationMs: 50_000,
    checkpointEvidence,
  }, { now: () => now })).toMatchObject({ ok: true, fencingToken: 1 })
  return checkpointEvidence
}

function attribution(store: string) {
  const lane = inspectLaneLeaseStore(store, storeId).lanes[0]
  return {
    storeId,
    workOrderId,
    laneId,
    workerId,
    fencingToken: lane.fencingToken,
    checkpointSequence: lane.checkpointSequence,
    checkpointEvidenceHash: hash(lane.checkpointEvidence),
  }
}

function event(store: string, eventId: string, eventType = "TEST", payload: Record<string, unknown> = testPayload(), occurredAt = new Date(1_100).toISOString()) {
  return {
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_EVIDENCE_APPEND_REQUEST",
    eventId,
    occurredAt,
    eventType,
    scope: { programId: "PROGRAM-MAO", goalId: "GOAL-MAO", loopId: "LOOP-MAO", workOrderId, laneId, runId: "RUN-MAO-022" },
    writer: { writerId: workerId, writerKind: "BUILDER", role: "builder", providerId: "hosted-codex", adapterId: null, trustGateEvidenceHash: "a".repeat(64) },
    leaseAttribution: attribution(store),
    payload,
    sourceRefs: [],
    sanitized: true,
    rawAuthMaterialIncluded: false,
    rawProviderOutputIncluded: false,
    expectedHead: null,
  }
}

function testPayload() {
  return { suiteId: "suite-mao", status: "PASSED", passed: 3, failed: 0, skipped: 0, durationMs: 12, resultContentHash: "b".repeat(64) }
}

function verifyRequest(expectedAnchor: unknown = null) {
  return { schemaVersion: 1, artifactType: "MULTI_AGENT_EVIDENCE_VERIFY_REQUEST", expectedAnchor }
}

function meterRequest(expectedAnchor: unknown = null) {
  return { schemaVersion: 1, artifactType: "MULTI_AGENT_OWNER_TOUCH_METER_REQUEST", expectedAnchor }
}

function uuid(index: number) { return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}` }

function payloads() {
  const transition = transitionLifecycle({ from: "LEASED", to: "PROVIDER_DISPATCHED", reasonCode: null, failureClass: null, authorityGap: { present: false, condition: null, conditionRef: null } })
  return {
    AUTHORITY: { grantId: "grant-mao", authorityDecisionId: "decision-mao", status: "ACTIVE", contentHash: "1".repeat(64) },
    WORKER: { workerId, role: "builder", action: "STARTED", reasonCode: null },
    PROVIDER: { providerId: "hosted-codex", adapterId: "native-team", dispatchId: "dispatch-mao", state: "RUNNING", reasonCode: null, responseContentHash: "2".repeat(64) },
    RESERVATION: { reservationSetId: "reservation-mao", action: "ACQUIRED", ledgerVersion: 1, fencingToken: 7, reasonCodes: [], resultContentHash: "3".repeat(64) },
    TRANSITION: { from: "LEASED", to: "PROVIDER_DISPATCHED", reasonCode: null, failureClass: null, authorityGap: { present: false, condition: null, conditionRef: null }, transitionContentHash: hash(transition) },
    TEST: testPayload(),
    COMMIT: { repository: "bsvalues/terragroq", branch: "codex/mao", commitSha: "4".repeat(40), treeSha: "5".repeat(40), changedPaths: [{ path: "scripts/a.mjs", contentHash: "6".repeat(64) }] },
    PR: { repository: "bsvalues/terragroq", prNumber: 400, action: "OPENED", state: "DRAFT", baseRef: "main", headSha: "7".repeat(40), mergeMode: "DRAFT_PR_ONLY" },
    REVIEW: { repository: "bsvalues/terragroq", prNumber: 400, reviewerId: "assurance-a", verdict: "APPROVED", headSha: "7".repeat(40), threadCount: 2, unresolvedThreadCount: 0 },
    MERGE: { repository: "bsvalues/terragroq", prNumber: 400, mergeSha: "8".repeat(40), method: "SQUASH", verified: true },
    CLEANUP: { resourceType: "WORKTREE", resourceId: "worktree-mao", action: "REMOVED", status: "SUCCEEDED", resultContentHash: "9".repeat(64) },
    FAILURE: { failureClass: "TRANSIENT_TRANSPORT", reasonCode: "NETWORK_RESET", lifecycleState: "RETRY_SCHEDULED", attempt: 1, terminal: false, detailContentHash: "a".repeat(64) },
    OWNER_CONTACT: { contactClass: "GENUINE_AUTHORITY_DECISION", touchKinds: [], authorityGap: { present: true, condition: "MATERIAL_PRODUCT_SCOPE", conditionRef: "authority-gap-mao" }, decisionId: "decision-mao" },
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("append-only multi-agent evidence ledger", () => {
  it("persists every required event type in one immutable attributed hash chain", () => {
    const { store, ledger } = workspace(); establish(store)
    const samples = payloads()
    for (const [index, type] of EVIDENCE_EVENT_TYPES.entries()) {
      const result = appendEvidenceEvent(ledger, ledgerId, event(store, uuid(index + 1), type, samples[type]), { leaseStorePath: store, leaseStoreId: storeId, now: () => 1_100 + index })
      expect(result).toMatchObject({ ok: true, status: "EVIDENCE_EVENT_APPENDED", event: { sequence: index + 1, eventType: type, authorityGranted: false } })
    }
    const verified = verifyEvidenceLedger(ledger, ledgerId, verifyRequest())
    expect(verified).toMatchObject({ ok: true, valid: true, eventCount: 13, anchorVerified: false, independentlyAnchored: false, certified: false, authorityGranted: false })
    expect(fs.readdirSync(path.join(ledger, "events"))).toHaveLength(13)
    expect(fs.readFileSync(path.join(ledger, "events", fs.readdirSync(path.join(ledger, "events"))[0]), "utf8")).not.toContain(holderToken)
  })

  it("makes immutable event IDs idempotent and rejects changed reuse", () => {
    const { store, ledger } = workspace(); establish(store)
    const request = event(store, uuid(1))
    const first = appendEvidenceEvent(ledger, ledgerId, request, { leaseStorePath: store, leaseStoreId: storeId, now: () => 1_100 })
    expect(appendEvidenceEvent(ledger, ledgerId, request, { leaseStorePath: store, leaseStoreId: storeId, now: () => 1_200 })).toMatchObject({ ok: true, idempotent: true, status: "EVIDENCE_EVENT_APPEND_IDEMPOTENT" })
    expect(appendEvidenceEvent(ledger, ledgerId, { ...request, payload: { ...request.payload, passed: 4 } }, { leaseStorePath: store, leaseStoreId: storeId, now: () => 1_200 })).toMatchObject({ ok: false, status: "EVIDENCE_EVENT_ID_REUSE_WALL" })
    expect(first.headAnchor.eventCount).toBe(1)
  })

  it("rejects canonical lowercase filename violations even when event content is unchanged", () => {
    const { store, ledger } = workspace(); establish(store)
    appendEvidenceEvent(ledger, ledgerId, event(store, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), { leaseStorePath: store, leaseStoreId: storeId, now: () => 1_100 })
    const events = path.join(ledger, "events"); const name = fs.readdirSync(events)[0]
    fs.renameSync(path.join(events, name), path.join(events, name.toUpperCase().replace(".JSON", ".json")))
    expect(verifyEvidenceLedger(ledger, ledgerId, verifyRequest())).toMatchObject({ ok: false, status: "EVIDENCE_LEDGER_CORRUPT" })
  })

  it("verifies an external head anchor and detects suffix truncation", () => {
    const { store, ledger } = workspace(); establish(store)
    appendEvidenceEvent(ledger, ledgerId, event(store, uuid(1)), { leaseStorePath: store, leaseStoreId: storeId, now: () => 1_100 })
    const second = appendEvidenceEvent(ledger, ledgerId, event(store, uuid(2), "TEST", testPayload(), new Date(1_101).toISOString()), { leaseStorePath: store, leaseStoreId: storeId, now: () => 1_101 })
    expect(verifyEvidenceLedger(ledger, ledgerId, verifyRequest(second.headAnchor))).toMatchObject({ ok: true, anchorVerified: true, independentlyAnchored: true })
    fs.rmSync(path.join(ledger, "events", fs.readdirSync(path.join(ledger, "events")).sort()[1]))
    expect(verifyEvidenceLedger(ledger, ledgerId, verifyRequest(second.headAnchor))).toMatchObject({ ok: false, status: "EVIDENCE_LEDGER_ANCHOR_WALL" })
  })

  it("enforces optional head CAS without losing the committed chain", () => {
    const { store, ledger } = workspace(); establish(store)
    const first = appendEvidenceEvent(ledger, ledgerId, event(store, uuid(1)), { leaseStorePath: store, leaseStoreId: storeId, now: () => 1_100 })
    const stale = event(store, uuid(2), "TEST", testPayload(), new Date(1_101).toISOString())
    stale.expectedHead = { eventCount: 0, headEventHash: null }
    expect(appendEvidenceEvent(ledger, ledgerId, stale, { leaseStorePath: store, leaseStoreId: storeId, now: () => 1_101 })).toMatchObject({ ok: false, status: "EVIDENCE_LEDGER_HEAD_CONFLICT" })
    expect(verifyEvidenceLedger(ledger, ledgerId, verifyRequest(first.headAnchor))).toMatchObject({ ok: true, eventCount: 1 })
  })

  it("detects mutation, sequence gaps, filename mismatches, and corrupt manifests without repair", () => {
    const cases = ["payload", "gap", "filename", "manifest"]
    for (const [caseIndex, kind] of cases.entries()) {
      const { store, ledger } = workspace(); establish(store, 1_000 + caseIndex * 100)
      const now = 1_100 + caseIndex * 100
      appendEvidenceEvent(ledger, ledgerId, event(store, uuid(caseIndex + 1), "TEST", testPayload(), new Date(now).toISOString()), { leaseStorePath: store, leaseStoreId: storeId, now: () => now })
      const events = path.join(ledger, "events"); const name = fs.readdirSync(events)[0]
      if (kind === "payload") { const value = JSON.parse(fs.readFileSync(path.join(events, name), "utf8")); value.payload.passed = 99; fs.writeFileSync(path.join(events, name), JSON.stringify(value)) }
      if (kind === "gap") fs.renameSync(path.join(events, name), path.join(events, name.replace("000000000001", "000000000002")))
      if (kind === "filename") fs.renameSync(path.join(events, name), path.join(events, `000000000001-${uuid(99)}.json`))
      if (kind === "manifest") { const value = JSON.parse(fs.readFileSync(path.join(ledger, "manifest.json"), "utf8")); value.ledgerId = "OTHER"; fs.writeFileSync(path.join(ledger, "manifest.json"), JSON.stringify(value)) }
      expect(verifyEvidenceLedger(ledger, ledgerId, verifyRequest())).toMatchObject({ ok: false, status: "EVIDENCE_LEDGER_CORRUPT" })
    }
  })

  it("ignores an uncommitted crash-temp sibling but rejects an unexpected committed event member", () => {
    const { root, store, ledger } = workspace(); establish(store)
    const appended = appendEvidenceEvent(ledger, ledgerId, event(store, uuid(1)), { leaseStorePath: store, leaseStoreId: storeId, now: () => 1_100 })
    fs.writeFileSync(path.join(root, ".evidence-pending-dead-process"), "{incomplete")
    expect(verifyEvidenceLedger(ledger, ledgerId, verifyRequest(appended.headAnchor))).toMatchObject({ ok: true, anchorVerified: true })
    fs.writeFileSync(path.join(ledger, "events", "unexpected.tmp"), "{incomplete")
    expect(verifyEvidenceLedger(ledger, ledgerId, verifyRequest(appended.headAnchor))).toMatchObject({ ok: false, status: "EVIDENCE_LEDGER_CORRUPT" })
  })

  it("binds writer, lane, fence, checkpoint sequence, evidence hash, and active expiry", () => {
    const { store, ledger } = workspace(); establish(store)
    for (const changed of [
      { workerId: "other-worker" }, { workOrderId: "WO-OTHER" }, { laneId: "LANE-OTHER" },
      { fencingToken: 2 }, { checkpointSequence: 2 }, { checkpointEvidenceHash: "f".repeat(64) },
    ]) {
      const request = event(store, crypto.randomUUID())
      request.leaseAttribution = { ...request.leaseAttribution, ...changed }
      if (changed.workerId) request.writer = { ...request.writer, writerId: changed.workerId }
      if (changed.workOrderId) request.scope = { ...request.scope, workOrderId: changed.workOrderId }
      if (changed.laneId) request.scope = { ...request.scope, laneId: changed.laneId }
      expect(appendEvidenceEvent(ledger, ledgerId, request, { leaseStorePath: store, leaseStoreId: storeId, now: () => 1_100 })).toMatchObject({ ok: false, status: "EVIDENCE_LEASE_ATTRIBUTION_WALL" })
    }
    expect(appendEvidenceEvent(ledger, ledgerId, event(store, uuid(9), "TEST", testPayload(), new Date(60_000).toISOString()), { leaseStorePath: store, leaseStoreId: storeId, now: () => 60_000 })).toMatchObject({ ok: false, status: "EVIDENCE_LEASE_ATTRIBUTION_WALL" })
  })

  it("hash-compares every persisted string against every persisted lease-holder digest", () => {
    const { store, ledger } = workspace(); establish(store)
    const foreignHolder = "foreign-holder-material-mao-022"
    expect(acquireLaneLease(store, storeId, {
      schemaVersion: 1, artifactType: "MULTI_AGENT_LANE_LEASE_ACQUIRE_REQUEST", workOrderId: "WO-MAO-FOREIGN",
      laneId: "LANE-FOREIGN", workerId: "foreign-worker", idempotencyKey: "acquire-foreign-holder-001",
      holderToken: foreignHolder, leaseDurationMs: 50_000, checkpointEvidence: { phase: "foreign-lane" },
    }, { now: () => 1_050 })).toMatchObject({ ok: true })
    for (const [index, rawHolder] of [holderToken, foreignHolder].entries()) {
      const request = event(store, uuid(index + 30), "TEST", { ...testPayload(), suiteId: rawHolder })
      const result = appendEvidenceEvent(ledger, ledgerId, request, { leaseStorePath: store, leaseStoreId: storeId, now: () => 1_100 })
      expect(result).toMatchObject({ ok: false, status: "EVIDENCE_HOLDER_MATERIAL_WALL" })
      expect(JSON.stringify(result)).not.toContain(rawHolder)
    }
    expect(fs.existsSync(ledger)).toBe(false)
  })

  it("rejects provider identity contradiction and invalid lifecycle/failure projections", () => {
    const { store, ledger } = workspace(); establish(store)
    const provider = event(store, uuid(1), "PROVIDER", payloads().PROVIDER)
    provider.writer = { ...provider.writer, writerKind: "PROVIDER_ADAPTER", providerId: "other-provider", adapterId: "native-team" }
    expect(appendEvidenceEvent(ledger, ledgerId, provider, { leaseStorePath: store, leaseStoreId: storeId, now: () => 1_100 })).toMatchObject({ ok: false, status: "EVIDENCE_WRITER_ATTRIBUTION_WALL" })
    const transition = { ...payloads().TRANSITION, to: "MERGED" }
    expect(appendEvidenceEvent(ledger, ledgerId, event(store, uuid(2), "TRANSITION", transition), { leaseStorePath: store, leaseStoreId: storeId, now: () => 1_100 })).toMatchObject({ ok: false, status: "EVIDENCE_TRANSITION_WALL" })
    const failure = { ...payloads().FAILURE, lifecycleState: "FAILED_TERMINAL", terminal: false }
    expect(appendEvidenceEvent(ledger, ledgerId, event(store, uuid(3), "FAILURE", failure), { leaseStorePath: store, leaseStoreId: storeId, now: () => 1_100 })).toMatchObject({ ok: false, status: "EVIDENCE_LEDGER_SEMANTIC_WALL" })
  })

  it("rejects raw-output flags, secret aliases and values without persisting or echoing them", () => {
    const { store, ledger } = workspace(); establish(store)
    const secret = "Bearer abcdefghijklmnopqrstuvwxyz"
    const attempts = [
      { ...event(store, uuid(1)), rawAuthMaterialIncluded: true },
      { ...event(store, uuid(2)), payload: { ...testPayload(), apiToken: "not-real" } },
      { ...event(store, uuid(3)), payload: { ...testPayload(), suiteId: secret } },
      { ...event(store, uuid(4), "COMMIT", payloads().COMMIT), payload: { ...payloads().COMMIT, changedPaths: [{ path: "../escape", contentHash: "a".repeat(64) }] } },
    ]
    for (const request of attempts) {
      const result = appendEvidenceEvent(ledger, ledgerId, request, { leaseStorePath: store, leaseStoreId: storeId, now: () => 1_100 })
      expect(result.ok).toBe(false)
      expect(JSON.stringify(result)).not.toContain(secret)
    }
    expect(fs.existsSync(ledger)).toBe(false)
  })

  it("never echoes attacker-controlled key names in typed schema or sanitization walls", () => {
    const { store, ledger } = workspace(); establish(store)
    const attackerKeys = ["password=abc", "attackerControlledKey"]
    const payloadA = { ...testPayload(), [attackerKeys[0]]: "x" }
    const payloadB = { ...testPayload(), [attackerKeys[1]]: "Bearer abcdefghijklmnopqrstuvwxyz" }
    for (const [index, payload] of [payloadA, payloadB].entries()) {
      const result = appendEvidenceEvent(ledger, ledgerId, event(store, uuid(index + 40), "TEST", payload), { leaseStorePath: store, leaseStoreId: storeId, now: () => 1_100 })
      expect(result.ok).toBe(false)
      for (const attackerKey of attackerKeys) expect(JSON.stringify(result)).not.toContain(attackerKey)
      expect(result.field).toMatch(/\{key:[a-f0-9]{64}\}|payload/)
    }
  })

  it("derives all five owner counters and fails babysitting without accepting supplied deltas", () => {
    const { store, ledger } = workspace(); establish(store)
    const prohibited = { contactClass: "PROHIBITED_ROUTINE", touchKinds: ["OPERATION", "CREDENTIAL", "DIAGNOSTIC", "ROUTINE_DECISION"], authorityGap: { present: false, condition: null, conditionRef: null }, decisionId: null }
    const result = appendEvidenceEvent(ledger, ledgerId, event(store, uuid(1), "OWNER_CONTACT", prohibited), { leaseStorePath: store, leaseStoreId: storeId, now: () => 1_100 })
    expect(result.event.payload.touchKinds).toContain("ROUTINE_CONTACT")
    expect(deriveOwnerTouchMeter(ledger, ledgerId, meterRequest(result.headAnchor))).toMatchObject({
      ok: true, lifecycleState: "FAILED_OWNER_BABYSITTING", reasonCode: "FAIL_OWNER_BABYSITTING", certified: false,
      counters: {
        OWNER_OPERATION_TOUCH_COUNT: 1, OWNER_CREDENTIAL_TOUCH_COUNT: 1,
        OWNER_DIAGNOSTIC_TOUCH_COUNT: 1, OWNER_ROUTINE_DECISION_COUNT: 1,
        OWNER_ROUTINE_CONTACT_COUNT: 1,
      },
    })
    expect(appendEvidenceEvent(ledger, ledgerId, { ...event(store, uuid(2)), ownerCounterDelta: {} }, { leaseStorePath: store, leaseStoreId: storeId, now: () => 1_200 })).toMatchObject({ ok: false, status: "EVIDENCE_LEDGER_SCHEMA_WALL" })
  })

  it("records genuine authority contact with zero counters and rejects operational masquerade", () => {
    const { store, ledger } = workspace(); establish(store)
    const genuine = payloads().OWNER_CONTACT
    const appended = appendEvidenceEvent(ledger, ledgerId, event(store, uuid(1), "OWNER_CONTACT", genuine), { leaseStorePath: store, leaseStoreId: storeId, now: () => 1_100 })
    expect(deriveOwnerTouchMeter(ledger, ledgerId, meterRequest(appended.headAnchor))).toMatchObject({ lifecycleState: "UNVERIFIED_ZERO_OWNER_OPERATIONS", counters: { OWNER_ROUTINE_CONTACT_COUNT: 0 }, certified: false })
    const fake = { ...genuine, authorityGap: { present: true, condition: "CODEX_NETWORK_WALL", conditionRef: "transport" } }
    expect(appendEvidenceEvent(ledger, ledgerId, event(store, uuid(2), "OWNER_CONTACT", fake), { leaseStorePath: store, leaseStoreId: storeId, now: () => 1_200 })).toMatchObject({ ok: false, status: "EVIDENCE_OWNER_CONTACT_WALL" })
  })

  it("persists a returned evidence head through WO021 and binds the next writer event", () => {
    const { store, ledger } = workspace(); establish(store)
    const first = appendEvidenceEvent(ledger, ledgerId, event(store, uuid(1)), { leaseStorePath: store, leaseStoreId: storeId, now: () => 1_100 })
    const checkpointEvidence = { evidenceLedgerId: ledgerId, eventCount: first.headAnchor.eventCount, headEventHash: first.headAnchor.headEventHash, manifestHash: first.headAnchor.manifestHash }
    expect(checkpointLaneLease(store, storeId, {
      schemaVersion: 1, artifactType: "MULTI_AGENT_LANE_CHECKPOINT_REQUEST", workOrderId, laneId, workerId,
      idempotencyKey: "checkpoint-evidence-anchor-01", holderToken, fencingToken: 1, expectedCheckpointSequence: 1,
      transition: { from: "LEASED", to: "PROVIDER_DISPATCHED", reasonCode: null, failureClass: null, authorityGap: { present: false, condition: null, conditionRef: null } },
      evidence: checkpointEvidence,
    }, { now: () => 1_150 })).toMatchObject({ ok: true, checkpointSequence: 2 })
    const second = appendEvidenceEvent(ledger, ledgerId, event(store, uuid(2), "TEST", testPayload(), new Date(1_160).toISOString()), { leaseStorePath: store, leaseStoreId: storeId, now: () => 1_160 })
    expect(second).toMatchObject({ ok: true, event: { leaseAttribution: { checkpointSequence: 2 } } })
    expect(inspectLaneLeaseStore(store, storeId).lanes[0].checkpointEvidence).toEqual(checkpointEvidence)
  })

  it("serializes two child-process appends without loss or overwrite", async () => {
    const { root, store, ledger } = workspace(); const now = Date.now(); establish(store, now)
    const binding = path.join(root, "binding.json"); fs.writeFileSync(binding, JSON.stringify({ leaseStorePath: store, leaseStoreId: storeId }))
    const paths = [1, 2].map((index) => {
      const file = path.join(root, `request-${index}.json`)
      fs.writeFileSync(file, JSON.stringify(event(store, uuid(index), "TEST", testPayload(), new Date(now + 1).toISOString())))
      return file
    })
    const run = (file: string) => new Promise<number | null>((resolve) => {
      const child = spawn(process.execPath, ["scripts/multi-agent-operator/evidence-ledger-cli.mjs", "append", ledger, ledgerId, file, binding], { cwd: process.cwd(), env: {}, stdio: ["ignore", "ignore", "ignore"] })
      child.on("close", resolve)
    })
    expect(await Promise.all(paths.map(run))).toEqual([0, 0])
    expect(verifyEvidenceLedger(ledger, ledgerId, verifyRequest())).toMatchObject({ ok: true, eventCount: 2 })
  })

  it("never breaks a live lock and recovers only an abandoned stale same-host lock", () => {
    const { store, ledger } = workspace(); establish(store)
    const lock = `${ledger}.lock`; fs.mkdirSync(lock, { recursive: true }); fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid, hostname: os.hostname(), createdAt: new Date(0).toISOString() }))
    expect(appendEvidenceEvent(ledger, ledgerId, event(store, uuid(1)), { leaseStorePath: store, leaseStoreId: storeId, now: () => 1_100, lockTimeoutMs: 1, staleLockMs: 0 })).toMatchObject({ ok: false, status: "EVIDENCE_LEDGER_LOCK_TIMEOUT" })
    fs.rmSync(lock, { recursive: true, force: true }); fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: 999_999_999, hostname: os.hostname(), createdAt: new Date(0).toISOString() })); const old = new Date(0); fs.utimesSync(lock, old, old)
    expect(appendEvidenceEvent(ledger, ledgerId, event(store, uuid(1)), { leaseStorePath: store, leaseStoreId: storeId, now: () => 1_100, staleLockMs: 1 })).toMatchObject({ ok: true })
    expect(fs.readdirSync(path.dirname(ledger)).filter((name) => name.includes(".lock.stale-"))).toEqual([])
  })

  it("fails closed on stale malformed, foreign-host, or unverifiable lock owners", () => {
    for (const [index, owner] of [
      { pid: 999_999_999, hostname: os.hostname() },
      { pid: 999_999_999, hostname: "foreign-host", createdAt: new Date(0).toISOString() },
      { pid: "not-a-pid", hostname: os.hostname(), createdAt: new Date(0).toISOString() },
    ].entries()) {
      const { store, ledger } = workspace(); establish(store, 1_000 + index * 10)
      const lock = `${ledger}.lock`; fs.mkdirSync(lock, { recursive: true }); fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify(owner)); const old = new Date(0); fs.utimesSync(lock, old, old)
      const result = appendEvidenceEvent(ledger, ledgerId, event(store, uuid(index + 50), "TEST", testPayload(), new Date(1_100 + index * 10).toISOString()), { leaseStorePath: store, leaseStoreId: storeId, now: () => 1_100 + index * 10, lockTimeoutMs: 1, staleLockMs: 0 })
      expect(result).toMatchObject({ ok: false, status: "EVIDENCE_LEDGER_LOCK_TIMEOUT" })
      expect(fs.existsSync(lock)).toBe(true)
    }
  })

  it("returns deterministic CLI exits for verify, meter, usage, and corruption", async () => {
    const { root, store, ledger } = workspace(); const now = Date.now(); establish(store, now)
    const request = path.join(root, "event.json"); const binding = path.join(root, "binding.json")
    fs.writeFileSync(request, JSON.stringify(event(store, uuid(1), "TEST", testPayload(), new Date(now + 1).toISOString())))
    fs.writeFileSync(binding, JSON.stringify({ leaseStorePath: store, leaseStoreId: storeId }))
    const exec = (args: string[]) => new Promise<{ code: number | null, out: string }>((resolve) => {
      const child = spawn(process.execPath, ["scripts/multi-agent-operator/evidence-ledger-cli.mjs", ...args], { cwd: process.cwd(), env: {}, stdio: ["ignore", "pipe", "ignore"] }); let out = ""
      child.stdout.on("data", (chunk) => { out += chunk }); child.on("close", (code) => resolve({ code, out }))
    })
    expect((await exec(["append", ledger, ledgerId, request, binding])).code).toBe(0)
    const verifyFile = path.join(root, "verify.json"); fs.writeFileSync(verifyFile, JSON.stringify(verifyRequest()))
    const meterFile = path.join(root, "meter.json"); fs.writeFileSync(meterFile, JSON.stringify(meterRequest()))
    expect((await exec(["verify", ledger, ledgerId, verifyFile])).code).toBe(0)
    expect((await exec(["meter", ledger, ledgerId, meterFile])).code).toBe(0)
    expect((await exec(["meter", ledger, ledgerId, verifyFile])).code).toBe(2)
    expect((await exec([])).code).toBe(2)
  })
})
