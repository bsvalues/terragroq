import { execFileSync, spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  acquireLaneLease,
  checkpointLaneLease,
  expireLaneLease,
  heartbeatLaneLease,
  inspectLaneLeaseStore,
  reclaimLaneLease,
  releaseLaneLease,
  renewLaneLease,
  settleExpiredTerminalLaneLease,
} from "../scripts/multi-agent-operator/lane-lease-checkpoint.mjs"

const roots: string[] = []
const storeId = "STORE-MAO-TEST-001"
const holderA = "holder-secret-material-a-123456"
const holderB = "holder-secret-material-b-123456"

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mao-lane-lease-"))
  roots.push(root)
  return { root, store: path.join(root, "state", "lane-leases.json") }
}

function acquire(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_LANE_LEASE_ACQUIRE_REQUEST",
    workOrderId: "WO-MAO-101",
    laneId: "LANE-A",
    workerId: "hosted-codex-a",
    idempotencyKey: "acquire-operation-0001",
    holderToken: holderA,
    leaseDurationMs: 1_000,
    checkpointEvidence: { workerId: "hosted-codex-a", note: "local lease established" },
    ...overrides,
  }
}

function holder(artifactType: string, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    artifactType,
    workOrderId: "WO-MAO-101",
    laneId: "LANE-A",
    workerId: "hosted-codex-a",
    idempotencyKey: "holder-operation-0001",
    holderToken: holderA,
    fencingToken: 1,
    ...overrides,
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("per-lane lease and durable checkpoint store", () => {
  it("acquires independent per-WO/per-lane leases and persists only holder digests", () => {
    const { store } = workspace()
    const first = acquireLaneLease(store, storeId, acquire(), { now: () => 1_000 })
    const second = acquireLaneLease(store, storeId, acquire({
      laneId: "LANE-B", idempotencyKey: "acquire-operation-0002", holderToken: holderB,
    }), { now: () => 1_100 })
    expect(first).toMatchObject({ ok: true, status: "LANE_LEASE_ACQUIRED", fencingToken: 1, lifecycleState: "LEASED" })
    expect(second).toMatchObject({ ok: true, fencingToken: 2, laneId: "LANE-B" })
    const persisted = fs.readFileSync(store, "utf8")
    expect(persisted).not.toContain(holderA)
    expect(persisted).not.toContain(holderB)
    expect(JSON.parse(persisted).lanes[0].holderTokenDigest).toMatch(/^[a-f0-9]{64}$/)
  })

  it("makes acquire and every mutation idempotent while rejecting key reuse", () => {
    const { store } = workspace()
    const request = acquire()
    expect(acquireLaneLease(store, storeId, request, { now: () => 1_000 }).idempotent).toBe(false)
    expect(acquireLaneLease(store, storeId, request, { now: () => 9_000 })).toMatchObject({
      status: "LANE_LEASE_ACQUIRED_IDEMPOTENT", idempotent: true, storeVersion: 1,
    })
    expect(acquireLaneLease(store, storeId, { ...request, leaseDurationMs: 2_000 })).toMatchObject({ ok: false, status: "IDEMPOTENCY_KEY_REUSE_WALL" })
  })

  it("replays the original response snapshot after later checkpoint, expiry, and reclaim mutations", () => {
    const { store } = workspace()
    const request = acquire({ leaseDurationMs: 100 })
    const first = acquireLaneLease(store, storeId, request, { now: () => 1_000 })
    checkpointLaneLease(store, storeId, holder("MULTI_AGENT_LANE_CHECKPOINT_REQUEST", {
      idempotencyKey: "checkpoint-after-acquire",
      expectedCheckpointSequence: 1,
      transition: { from: "LEASED", to: "PROVIDER_DISPATCHED", reasonCode: null, failureClass: null, authorityGap: { present: false, condition: null, conditionRef: null } },
      evidence: { checkpoint: "later state" },
    }), { now: () => 1_050 })
    expireLaneLease(store, storeId, {
      schemaVersion: 1, artifactType: "MULTI_AGENT_LANE_LEASE_EXPIRE_REQUEST",
      workOrderId: "WO-MAO-101", laneId: "LANE-A", workerId: "hosted-codex-a",
      idempotencyKey: "expire-after-acquire", expectedFencingToken: 1,
    }, { now: () => 1_100 })
    reclaimLaneLease(store, storeId, {
      schemaVersion: 1, artifactType: "MULTI_AGENT_LANE_LEASE_RECLAIM_REQUEST",
      workOrderId: "WO-MAO-101", laneId: "LANE-A", workerId: "hosted-codex-a",
      idempotencyKey: "reclaim-after-acquire", holderToken: holderB,
      leaseDurationMs: 1_000, expectedFencingToken: 1,
      checkpointEvidence: { checkpoint: "reclaimed later state" },
    }, { now: () => 1_200 })

    expect(acquireLaneLease(store, storeId, request, { now: () => 9_000 })).toMatchObject({
      status: "LANE_LEASE_ACQUIRED_IDEMPOTENT", idempotent: true,
      storeVersion: first.storeVersion, fencingToken: first.fencingToken,
      leaseStatus: first.leaseStatus, expiresAt: first.expiresAt,
      checkpointSequence: first.checkpointSequence, lifecycleState: first.lifecycleState,
    })
  })

  it("renews with version and expiry compare-and-swap and records heartbeats independently", () => {
    const { store } = workspace()
    acquireLaneLease(store, storeId, acquire(), { now: () => 1_000 })
    const renew = holder("MULTI_AGENT_LANE_LEASE_RENEW_REQUEST", {
      idempotencyKey: "renew-operation-000001", expectedVersion: 1,
      expectedExpiresAt: new Date(2_000).toISOString(), leaseDurationMs: 2_000,
    })
    expect(renewLaneLease(store, storeId, renew, { now: () => 1_500 })).toMatchObject({
      ok: true, storeVersion: 2, expiresAt: new Date(3_500).toISOString(),
    })
    expect(renewLaneLease(store, storeId, { ...renew, idempotencyKey: "renew-operation-000002", expectedVersion: 1 }, { now: () => 1_600 })).toMatchObject({ status: "LANE_LEASE_VERSION_CONFLICT" })
    const heartbeat = holder("MULTI_AGENT_LANE_LEASE_HEARTBEAT_REQUEST", {
      idempotencyKey: "heartbeat-operation-01", fencingToken: 1, expectedVersion: 2,
      expectedHeartbeatAt: new Date(1_000).toISOString(),
    })
    expect(heartbeatLaneLease(store, storeId, heartbeat, { now: () => 1_700 })).toMatchObject({ ok: true, status: "LANE_LEASE_HEARTBEAT_RECORDED", storeVersion: 3 })
    expect(heartbeatLaneLease(store, storeId, {
      ...heartbeat, idempotencyKey: "heartbeat-wrong-worker", expectedVersion: 3,
      workerId: "hosted-codex-b", expectedHeartbeatAt: new Date(1_700).toISOString(),
    }, { now: () => 1_750 })).toMatchObject({ status: "LANE_LEASE_NOT_HOLDER" })
    expect(heartbeatLaneLease(store, storeId, { ...heartbeat, idempotencyKey: "heartbeat-operation-02", expectedVersion: 3 }, { now: () => 1_800 })).toMatchObject({ status: "LANE_LEASE_HEARTBEAT_CONFLICT" })
  })

  it("binds checkpoint writes to canonical lifecycle transitions and sequence CAS", () => {
    const { store } = workspace()
    acquireLaneLease(store, storeId, acquire(), { now: () => 1_000 })
    const checkpoint = holder("MULTI_AGENT_LANE_CHECKPOINT_REQUEST", {
      idempotencyKey: "checkpoint-operation-01",
      expectedCheckpointSequence: 1,
      transition: { from: "LEASED", to: "PROVIDER_DISPATCHED", reasonCode: null, failureClass: null, authorityGap: { present: false, condition: null, conditionRef: null } },
      evidence: {
        evidenceLedgerId: "ledger-mao-001", eventCount: 7,
        headEventHash: "a".repeat(64), manifestHash: "b".repeat(64),
      },
    })
    expect(checkpointLaneLease(store, storeId, checkpoint, { now: () => 1_100 })).toMatchObject({
      ok: true, checkpointSequence: 2, lifecycleState: "PROVIDER_DISPATCHED",
    })
    expect(inspectLaneLeaseStore(store, storeId)).toMatchObject({
      lanes: [{ checkpointEvidence: checkpoint.evidence, workerId: "hosted-codex-a" }],
    })
    expect(checkpointLaneLease(store, storeId, { ...checkpoint, idempotencyKey: "checkpoint-operation-02", expectedCheckpointSequence: 1 }, { now: () => 1_200 })).toMatchObject({ status: "LANE_CHECKPOINT_SEQUENCE_CONFLICT" })
    expect(checkpointLaneLease(store, storeId, {
      ...checkpoint, idempotencyKey: "checkpoint-operation-03", expectedCheckpointSequence: 2,
      transition: { ...checkpoint.transition, from: "PROVIDER_DISPATCHED", to: "MERGED" },
    }, { now: () => 1_300 })).toMatchObject({ status: "LANE_CHECKPOINT_LIFECYCLE_WALL" })
    expect(checkpointLaneLease(store, storeId, {
      ...checkpoint, idempotencyKey: "checkpoint-holder-leak", expectedCheckpointSequence: 2,
      transition: { ...checkpoint.transition, from: "PROVIDER_DISPATCHED", to: "EXECUTING" },
      evidence: { note: `do-not-persist-${holderA}` },
    }, { now: () => 1_300 })).toMatchObject({ status: "CHECKPOINT_EVIDENCE_UNSAFE" })
    expect(inspectLaneLeaseStore(store, storeId)).toMatchObject({ ok: true, storeVersion: 2, lanes: [{ checkpointSequence: 2 }] })
  })

  it("makes terminal checkpoints immutable", () => {
    const { store } = workspace()
    acquireLaneLease(store, storeId, acquire(), { now: () => 1_000 })
    expect(checkpointLaneLease(store, storeId, holder("MULTI_AGENT_LANE_CHECKPOINT_REQUEST", {
      idempotencyKey: "checkpoint-to-terminal-001", expectedCheckpointSequence: 1,
      transition: { from: "LEASED", to: "FAILED_TERMINAL", reasonCode: "BOUNDED_RECOVERY_EXHAUSTED", failureClass: "TRANSIENT_TRANSPORT", authorityGap: { present: false, condition: null, conditionRef: null } },
      evidence: { outcome: "terminal" },
    }), { now: () => 1_050 })).toMatchObject({ ok: true, lifecycleState: "FAILED_TERMINAL" })
    const request = holder("MULTI_AGENT_LANE_CHECKPOINT_REQUEST", {
      idempotencyKey: "checkpoint-terminal-0001", expectedCheckpointSequence: 2,
      transition: { from: "FAILED_TERMINAL", to: "PLANNED", reasonCode: null, failureClass: null, authorityGap: { present: false, condition: null, conditionRef: null } },
      evidence: {},
    })
    expect(checkpointLaneLease(store, storeId, request, { now: () => 1_100 })).toMatchObject({ status: "LANE_CHECKPOINT_TERMINAL_IMMUTABILITY_WALL" })
  })

  it("rejects expired holders, atomically records expiry, and reclaims with a monotonic fence", () => {
    const { store } = workspace()
    acquireLaneLease(store, storeId, acquire({ leaseDurationMs: 100 }), { now: () => 1_000 })
    const heartbeat = holder("MULTI_AGENT_LANE_LEASE_HEARTBEAT_REQUEST", {
      idempotencyKey: "heartbeat-expired-0001", expectedHeartbeatAt: new Date(1_000).toISOString(),
    })
    expect(heartbeatLaneLease(store, storeId, heartbeat, { now: () => 1_100 })).toMatchObject({ status: "LANE_LEASE_EXPIRED" })
    expect(expireLaneLease(store, storeId, {
      schemaVersion: 1, artifactType: "MULTI_AGENT_LANE_LEASE_EXPIRE_REQUEST",
      workOrderId: "WO-MAO-101", laneId: "LANE-A", workerId: "coordinator-codex", idempotencyKey: "expire-operation-0001", expectedVersion: 1, expectedFencingToken: 1,
    }, { now: () => 1_100 })).toMatchObject({ ok: true, status: "LANE_LEASE_EXPIRED_RECORDED" })
    const recoveryEvidence = {
      evidenceLedgerId: "ledger-recovery-001", eventCount: 3,
      headEventHash: "c".repeat(64), manifestHash: "d".repeat(64),
    }
    expect(reclaimLaneLease(store, storeId, {
      schemaVersion: 1, artifactType: "MULTI_AGENT_LANE_LEASE_RECLAIM_REQUEST",
      workOrderId: "WO-MAO-101", laneId: "LANE-A", workerId: "hosted-codex-b", idempotencyKey: "reclaim-prior-holder-leak",
      holderToken: holderB, leaseDurationMs: 500, expectedFencingToken: 1, expectedVersion: 2,
      checkpointEvidence: { note: holderA },
    }, { now: () => 1_200 })).toMatchObject({ status: "CHECKPOINT_EVIDENCE_UNSAFE" })
    expect(inspectLaneLeaseStore(store, storeId)).toMatchObject({ storeVersion: 2, recoveryEvents: [] })
    expect(reclaimLaneLease(store, storeId, {
      schemaVersion: 1, artifactType: "MULTI_AGENT_LANE_LEASE_RECLAIM_REQUEST",
      workOrderId: "WO-MAO-101", laneId: "LANE-A", workerId: "hosted-codex-b", idempotencyKey: "reclaim-operation-001",
      holderToken: holderB, leaseDurationMs: 500, expectedFencingToken: 1, expectedVersion: 2,
      checkpointEvidence: recoveryEvidence,
    }, { now: () => 1_200 })).toMatchObject({ ok: true, status: "LANE_LEASE_RECLAIMED", fencingToken: 2, storeVersion: 3 })
    expect(inspectLaneLeaseStore(store, storeId)).toMatchObject({
      recoveryEvents: [{
        workOrderId: "WO-MAO-101", laneId: "LANE-A", workerId: "hosted-codex-b",
        fencingToken: 2, recoveryEvidence, recoveryEvidenceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }],
      lanes: [{ lifecycleState: "LEASED", checkpointSequence: 1 }],
    })
    expect(releaseLaneLease(store, storeId, holder("MULTI_AGENT_LANE_LEASE_RELEASE_REQUEST", {
      idempotencyKey: "stale-release-operation", workerId: "hosted-codex-a", holderToken: holderA, fencingToken: 1,
    }), { now: () => 1_300 })).toMatchObject({ status: "LANE_LEASE_NOT_HOLDER" })
    const tampered = JSON.parse(fs.readFileSync(store, "utf8"))
    tampered.operations[2].recoveryEvidence.eventCount = 4
    fs.writeFileSync(store, JSON.stringify(tampered))
    expect(inspectLaneLeaseStore(store, storeId)).toMatchObject({ status: "LANE_LEASE_STORE_CORRUPT" })
  })

  it("releases a live lease and preserves idempotent release evidence", () => {
    const { store } = workspace()
    acquireLaneLease(store, storeId, acquire(), { now: () => 1_000 })
    const request = holder("MULTI_AGENT_LANE_LEASE_RELEASE_REQUEST", { idempotencyKey: "release-operation-0001" })
    expect(releaseLaneLease(store, storeId, request, { now: () => 1_100 })).toMatchObject({ ok: true, leaseStatus: "RELEASED" })
    expect(releaseLaneLease(store, storeId, request, { now: () => 9_000 })).toMatchObject({ status: "LANE_LEASE_RELEASED_IDEMPOTENT", idempotent: true })
  })

  it("settles only an exactly fenced terminal expired lane and preserves idempotent evidence", () => {
    const { store } = workspace()
    acquireLaneLease(store, storeId, acquire({ leaseDurationMs: 100 }), { now: () => 1_000 })
    const checkpointEvidence = { fullIdentityHash: "a".repeat(64), configurationHash: "b".repeat(64), leaseFence: 1 }
    checkpointLaneLease(store, storeId, holder("MULTI_AGENT_LANE_CHECKPOINT_REQUEST", {
      idempotencyKey: "terminal-settlement-checkpoint", expectedCheckpointSequence: 1,
      transition: { from: "LEASED", to: "FAILED_TERMINAL", reasonCode: "BOUNDED_RECOVERY_EXHAUSTED", failureClass: "TRANSIENT_TRANSPORT", authorityGap: { present: false, condition: null, conditionRef: null } },
      evidence: checkpointEvidence,
    }), { now: () => 1_050 })
    expireLaneLease(store, storeId, {
      schemaVersion: 1, artifactType: "MULTI_AGENT_LANE_LEASE_EXPIRE_REQUEST",
      workOrderId: "WO-MAO-101", laneId: "LANE-A", workerId: "hosted-codex-a",
      idempotencyKey: "terminal-settlement-expire", expectedFencingToken: 1,
    }, { now: () => 1_100 })
    const settlement = {
      schemaVersion: 1, artifactType: "MULTI_AGENT_LANE_LEASE_SETTLE_TERMINAL_REQUEST",
      workOrderId: "WO-MAO-101", laneId: "LANE-A", workerId: "hosted-codex-a",
      idempotencyKey: "terminal-settlement-release", holderToken: holderA,
      expectedFencingToken: 1, expectedCheckpointSequence: 2,
      expectedLifecycleState: "FAILED_TERMINAL", expectedCheckpointEvidence: checkpointEvidence,
    }
    expect(settleExpiredTerminalLaneLease(store, storeId, { ...settlement, expectedCheckpointEvidence: { ...checkpointEvidence, leaseFence: 2 } }, { now: () => 1_101 }))
      .toMatchObject({ status: "LANE_LEASE_EXPIRED_TERMINAL_SETTLEMENT_EVIDENCE_WALL" })
    expect(settleExpiredTerminalLaneLease(store, storeId, settlement, { now: () => 1_102 }))
      .toMatchObject({ ok: true, status: "LANE_LEASE_EXPIRED_TERMINAL_RELEASED", leaseStatus: "RELEASED", lifecycleState: "FAILED_TERMINAL" })
    expect(settleExpiredTerminalLaneLease(store, storeId, settlement, { now: () => 9_000 }))
      .toMatchObject({ ok: true, status: "LANE_LEASE_EXPIRED_TERMINAL_RELEASED_IDEMPOTENT", idempotent: true, leaseStatus: "RELEASED" })

    const { store: nonterminalStore } = workspace()
    acquireLaneLease(nonterminalStore, storeId, acquire({ leaseDurationMs: 100 }), { now: () => 1_000 })
    expireLaneLease(nonterminalStore, storeId, {
      schemaVersion: 1, artifactType: "MULTI_AGENT_LANE_LEASE_EXPIRE_REQUEST",
      workOrderId: "WO-MAO-101", laneId: "LANE-A", workerId: "hosted-codex-a",
      idempotencyKey: "nonterminal-settle-expire", expectedFencingToken: 1,
    }, { now: () => 1_100 })
    expect(settleExpiredTerminalLaneLease(nonterminalStore, storeId, {
      ...settlement, idempotencyKey: "nonterminal-settle-release", expectedCheckpointSequence: 1,
      expectedCheckpointEvidence: acquire().checkpointEvidence,
    }, { now: () => 1_101 })).toMatchObject({ status: "LANE_LEASE_EXPIRED_TERMINAL_SETTLEMENT_REQUIRED" })
  })

  it("rejects secret-shaped evidence, unknown request fields, and malformed durable state", () => {
    const { store } = workspace()
    expect(acquireLaneLease(store, storeId, acquire({ checkpointEvidence: { apiToken: "do-not-store" } }))).toMatchObject({ status: "CHECKPOINT_EVIDENCE_UNSAFE" })
    expect(acquireLaneLease(store, storeId, acquire({ checkpointEvidence: { apiKey: "not-even-a-real-key" } }))).toMatchObject({ status: "CHECKPOINT_EVIDENCE_UNSAFE" })
    expect(acquireLaneLease(store, storeId, acquire({ checkpointEvidence: { holder: "do-not-store" } }))).toMatchObject({ status: "CHECKPOINT_EVIDENCE_UNSAFE" })
    expect(acquireLaneLease(store, storeId, acquire({ checkpointEvidence: { note: `embedded:${holderA}` } }))).toMatchObject({ status: "CHECKPOINT_EVIDENCE_UNSAFE" })
    expect(acquireLaneLease(store, storeId, acquire({ checkpointEvidence: { note: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signaturepayload" } }))).toMatchObject({ status: "CHECKPOINT_EVIDENCE_UNSAFE" })
    for (const residual of ["password=abc", "token=x", "safe prefix; pwd:'v'", "cookie: short"]) {
      expect(acquireLaneLease(store, storeId, acquire({ checkpointEvidence: { note: residual } }))).toMatchObject({ status: "CHECKPOINT_EVIDENCE_UNSAFE" })
    }
    expect(acquireLaneLease(store, storeId, acquire({ surprise: true }))).toMatchObject({ status: "MULTI_AGENT_LANE_LEASE_ACQUIRE_REQUEST_INVALID" })
    fs.mkdirSync(path.dirname(store), { recursive: true })
    fs.writeFileSync(store, "{malformed")
    expect(inspectLaneLeaseStore(store, storeId)).toMatchObject({ ok: false, status: "LANE_LEASE_STORE_CORRUPT" })
  })

  it("validates configuration before creating storage and rejects invalid or backward clocks", () => {
    const { store } = workspace()
    expect(acquireLaneLease(store, "bad store id", acquire(), { now: () => 1_000 })).toMatchObject({ status: "LANE_LEASE_CONFIGURATION_WALL" })
    expect(fs.existsSync(store)).toBe(false)
    expect(acquireLaneLease(store, storeId, acquire(), { now: () => Number.NaN })).toMatchObject({ status: "LANE_LEASE_CLOCK_WALL" })
    expect(acquireLaneLease(store, storeId, acquire(), { now: () => Number.POSITIVE_INFINITY })).toMatchObject({ status: "LANE_LEASE_CLOCK_WALL" })
    expect(fs.existsSync(store)).toBe(false)
    expect(acquireLaneLease(store, storeId, acquire(), { now: () => 1_000 })).toMatchObject({ ok: true })
    expect(heartbeatLaneLease(store, storeId, holder("MULTI_AGENT_LANE_LEASE_HEARTBEAT_REQUEST", {
      idempotencyKey: "heartbeat-backward-clock", expectedHeartbeatAt: new Date(1_000).toISOString(),
    }), { now: () => 999 })).toMatchObject({ status: "LANE_LEASE_CLOCK_WALL", detail: "backward-clock" })
  })

  it("requires a committed expiry operation before reclaim", () => {
    const { store } = workspace()
    acquireLaneLease(store, storeId, acquire({ leaseDurationMs: 100 }), { now: () => 1_000 })
    expect(reclaimLaneLease(store, storeId, {
      schemaVersion: 1, artifactType: "MULTI_AGENT_LANE_LEASE_RECLAIM_REQUEST",
      workOrderId: "WO-MAO-101", laneId: "LANE-A", workerId: "hosted-codex-b",
      idempotencyKey: "reclaim-without-expiry", holderToken: holderB, leaseDurationMs: 500,
      expectedFencingToken: 1, expectedVersion: 1, checkpointEvidence: { recoveredBy: "coordinator" },
    }, { now: () => 1_100 })).toMatchObject({ status: "LANE_LEASE_RECLAIM_REQUIRES_DURABLE_EXPIRY" })
    expect(inspectLaneLeaseStore(store, storeId)).toMatchObject({ ok: true, storeVersion: 1, operationCount: 1 })
  })

  it("requires renewal to strictly extend the committed expiry", () => {
    const { store } = workspace()
    acquireLaneLease(store, storeId, acquire(), { now: () => 1_000 })
    expect(renewLaneLease(store, storeId, holder("MULTI_AGENT_LANE_LEASE_RENEW_REQUEST", {
      idempotencyKey: "renew-not-extending-001", expectedVersion: 1,
      expectedExpiresAt: new Date(2_000).toISOString(), leaseDurationMs: 800,
    }), { now: () => 1_100 })).toMatchObject({ status: "LANE_LEASE_RENEWAL_NOT_EXTENDING" })
    expect(inspectLaneLeaseStore(store, storeId)).toMatchObject({ ok: true, storeVersion: 1 })
  })

  it("enforces the exact evidence-ledger anchor schema, count, and hashes", () => {
    const invalidAnchors = [
      { evidenceLedgerId: "ledger-1", eventCount: 0, headEventHash: "a".repeat(64), manifestHash: "b".repeat(64) },
      { evidenceLedgerId: "ledger-1", eventCount: 1, headEventHash: "A".repeat(64), manifestHash: "b".repeat(64) },
      { evidenceLedgerId: "ledger-1", eventCount: 1, headEventHash: "a".repeat(64), manifestHash: "b".repeat(63) },
      { evidenceLedgerId: "ledger-1", eventCount: 1, headEventHash: "a".repeat(64), manifestHash: "b".repeat(64), extra: true },
      { eventCount: 1 },
      { nested: { evidenceLedgerId: "ledger-1", eventCount: 1 } },
    ]
    for (const [index, checkpointEvidence] of invalidAnchors.entries()) {
      const { store } = workspace()
      expect(acquireLaneLease(store, storeId, acquire({
        idempotencyKey: `invalid-anchor-acquire-${index}`, checkpointEvidence,
      }))).toMatchObject({ status: "CHECKPOINT_EVIDENCE_ANCHOR_INVALID" })
      expect(fs.existsSync(store)).toBe(false)
    }
  })

  it("rejects gaps and contradictions in the durable operation journal", () => {
    type DurableStore = { updatedAt: string; operations: Array<Record<string, unknown>>; lanes: Array<Record<string, unknown>> }
    const mutations: Array<(raw: DurableStore) => void> = [
      (raw) => { raw.operations = [] },
      (raw) => { raw.operations[0].storeVersion = 2 },
      (raw) => { raw.operations[0].status = "LANE_LEASE_RENEWED" },
      (raw) => { raw.operations[0].workerId = "different-worker" },
      (raw) => { raw.lanes[0].generation = 2 },
      (raw) => { raw.updatedAt = new Date(1_001).toISOString() },
      (raw) => { raw.lanes[0].heartbeatAt = new Date(1_001).toISOString() },
    ]
    for (const mutate of mutations) {
      const { store } = workspace()
      acquireLaneLease(store, storeId, acquire(), { now: () => 1_000 })
      const raw = JSON.parse(fs.readFileSync(store, "utf8"))
      mutate(raw)
      fs.writeFileSync(store, JSON.stringify(raw))
      expect(inspectLaneLeaseStore(store, storeId)).toMatchObject({ ok: false, status: "LANE_LEASE_STORE_CORRUPT" })
    }
  })

  it("binds durable checkpoint lifecycle and evidence to the operation journal", () => {
    const first = workspace()
    acquireLaneLease(first.store, storeId, acquire(), { now: () => 1_000 })
    const stateTamper = JSON.parse(fs.readFileSync(first.store, "utf8"))
    stateTamper.lanes[0].checkpoint.lifecycleState = "MERGE_ELIGIBLE"
    stateTamper.operations[0].checkpointLifecycleState = "MERGE_ELIGIBLE"
    fs.writeFileSync(first.store, JSON.stringify(stateTamper))
    expect(inspectLaneLeaseStore(first.store, storeId)).toMatchObject({ status: "LANE_LEASE_STORE_CORRUPT" })

    const second = workspace()
    acquireLaneLease(second.store, storeId, acquire(), { now: () => 1_000 })
    const evidenceTamper = JSON.parse(fs.readFileSync(second.store, "utf8"))
    evidenceTamper.lanes[0].checkpoint.evidence.note = "tampered after journal commit"
    fs.writeFileSync(second.store, JSON.stringify(evidenceTamper))
    expect(inspectLaneLeaseStore(second.store, storeId)).toMatchObject({ status: "LANE_LEASE_STORE_CORRUPT" })
  })

  it("binds checkpoint recordedAt to the exact acquisition and checkpoint journal times", () => {
    const acquisition = workspace()
    acquireLaneLease(acquisition.store, storeId, acquire(), { now: () => 1_000 })
    const acquiredTamper = JSON.parse(fs.readFileSync(acquisition.store, "utf8"))
    acquiredTamper.lanes[0].checkpoint.recordedAt = new Date(500).toISOString()
    acquiredTamper.operations[0].checkpointRecordedAt = new Date(500).toISOString()
    fs.writeFileSync(acquisition.store, JSON.stringify(acquiredTamper))
    expect(inspectLaneLeaseStore(acquisition.store, storeId)).toMatchObject({ status: "LANE_LEASE_STORE_CORRUPT" })

    const checkpointed = workspace()
    acquireLaneLease(checkpointed.store, storeId, acquire(), { now: () => 1_000 })
    checkpointLaneLease(checkpointed.store, storeId, holder("MULTI_AGENT_LANE_CHECKPOINT_REQUEST", {
      idempotencyKey: "checkpoint-time-binding-01", expectedCheckpointSequence: 1,
      transition: { from: "LEASED", to: "PROVIDER_DISPATCHED", reasonCode: null, failureClass: null, authorityGap: { present: false, condition: null, conditionRef: null } },
      evidence: { outcome: "dispatched" },
    }), { now: () => 1_050 })
    const checkpointTamper = JSON.parse(fs.readFileSync(checkpointed.store, "utf8"))
    checkpointTamper.lanes[0].checkpoint.recordedAt = new Date(1_025).toISOString()
    checkpointTamper.operations[1].checkpointRecordedAt = new Date(1_025).toISOString()
    fs.writeFileSync(checkpointed.store, JSON.stringify(checkpointTamper))
    expect(inspectLaneLeaseStore(checkpointed.store, storeId)).toMatchObject({ status: "LANE_LEASE_STORE_CORRUPT" })
  })

  it("recovers an abandoned stale lock but never steals a live lock", () => {
    const { store } = workspace()
    const lock = `${store}.lock`
    fs.mkdirSync(lock, { recursive: true })
    fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: 99_999_999, hostname: os.hostname() }))
    const old = new Date(Date.now() - 60_000)
    fs.utimesSync(lock, old, old)
    expect(acquireLaneLease(store, storeId, acquire(), { staleLockMs: 1, now: () => 1_000 })).toMatchObject({ ok: true })
    expect(fs.existsSync(lock)).toBe(false)

    const other = workspace()
    fs.mkdirSync(`${other.store}.lock`, { recursive: true })
    fs.writeFileSync(path.join(`${other.store}.lock`, "owner.json"), JSON.stringify({ pid: process.pid, hostname: os.hostname() }))
    expect(acquireLaneLease(other.store, storeId, acquire(), { lockTimeoutMs: 0, staleLockMs: 60_000 })).toMatchObject({ status: "LANE_LEASE_LOCK_TIMEOUT" })
  })

  it("serializes cross-process acquisition races so exactly one holder wins", async () => {
    const { root, store } = workspace()
    const cli = path.resolve("scripts/multi-agent-operator/lane-lease-checkpoint-cli.mjs")
    const requests = Array.from({ length: 8 }, (_, index) => {
      const requestPath = path.join(root, `request-${index}.json`)
      fs.writeFileSync(requestPath, JSON.stringify(acquire({
        idempotencyKey: `race-acquire-operation-${String(index).padStart(4, "0")}`,
        holderToken: `race-holder-material-${String(index).padStart(4, "0")}-secret`,
      })))
      return requestPath
    })
    const outcomes = await Promise.all(requests.map((requestPath) => new Promise<Record<string, unknown>>((resolve, reject) => {
      const child = spawn(process.execPath, [cli, "acquire", store, storeId, requestPath])
      let stdout = ""
      child.stdout.on("data", (chunk) => { stdout += chunk })
      child.on("error", reject)
      child.on("close", () => resolve(JSON.parse(stdout)))
    })))
    expect(outcomes.filter((entry) => entry.status === "LANE_LEASE_ACQUIRED")).toHaveLength(1)
    expect(outcomes.filter((entry) => entry.status === "LANE_LEASE_ALREADY_EXISTS")).toHaveLength(7)
    expect(inspectLaneLeaseStore(store, storeId)).toMatchObject({ ok: true, operationCount: 1 })
  })

  it("exposes a local-file-only CLI with typed exit behavior", () => {
    const { root, store } = workspace()
    const requestPath = path.join(root, "acquire.json")
    fs.writeFileSync(requestPath, JSON.stringify(acquire()))
    const cli = path.resolve("scripts/multi-agent-operator/lane-lease-checkpoint-cli.mjs")
    const acquired = JSON.parse(execFileSync(process.execPath, [cli, "acquire", store, storeId, requestPath], { encoding: "utf8" }))
    expect(acquired).toMatchObject({ ok: true, localContractOnly: true, providerDispatchPerformed: false, authorityGranted: false })
    const inspected = JSON.parse(execFileSync(process.execPath, [cli, "inspect", store, storeId], { encoding: "utf8" }))
    expect(inspected).toMatchObject({ ok: true, status: "LANE_LEASE_STORE_VALID", rawHolderTokenPersisted: false })
    const invalid = spawnSync(process.execPath, [cli, "bad-operation", store, storeId], { encoding: "utf8" })
    expect(invalid.status).toBe(2)
    expect(JSON.parse(invalid.stdout)).toMatchObject({ ok: false, status: "LANE_LEASE_CHECKPOINT_CLI_USAGE_WALL" })
  })

  it("reports all five owner-operation counters as zero on success and walls", () => {
    const { store } = workspace()
    for (const output of [acquireLaneLease(store, storeId, acquire()), inspectLaneLeaseStore(`${store}.missing`, storeId)]) {
      expect(output).toMatchObject({
        ownerOperationTouchCount: 0, ownerCredentialTouchCount: 0, ownerDiagnosticTouchCount: 0,
        ownerRoutineDecisionCount: 0, ownerRoutineContactCount: 0,
      })
    }
  })
})
