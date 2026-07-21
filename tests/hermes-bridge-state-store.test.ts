import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { createHermesStateStore } from "@/scripts/hermes-bridge/state-store.mjs"

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "hermes-state-")); dirs.push(dir)
  let now = Date.parse("2026-07-21T00:00:00.000Z")
  const store = createHermesStateStore(join(dir, "state.json"), { now: () => now })
  store.initialize()
  return { dir, store, advance: (milliseconds: number) => { now += milliseconds } }
}

describe("Hermes bridge durable state store", () => {
  it("atomically persists lease, metadata, checkpoint sequence, and idempotency", () => {
    const { dir, store } = fixture()
    const request = { outcomeId: "GOAL-1", holderId: "thread-1", leaseDurationMs: 1000, metadata: { threadId: "thread-1", turnId: "turn-1", branch: "codex/work", prNumber: 42 }, idempotencyKey: "acquire-1" }
    const first = store.acquireLease(request)
    expect(store.acquireLease(request)).toMatchObject({ ...first, idempotent: true })
    const checkpoint = store.checkpoint({ outcomeId: "GOAL-1", holderId: "thread-1", fencingToken: first.fencingToken, expectedCheckpointSequence: 0, state: "EXECUTING", idempotencyKey: "checkpoint-1" })
    expect(checkpoint).toMatchObject({ checkpointSequence: 1, state: "EXECUTING" })
    expect(store.read().executions["GOAL-1"].metadata).toMatchObject({ threadId: "thread-1", turnId: "turn-1", branch: "codex/work", prNumber: 42 })
    expect(JSON.parse(readFileSync(join(dir, "state.json"), "utf8"))).toMatchObject({ schemaVersion: 1 })
  })

  it("reclaims only expired leases and fences stale writers", () => {
    const { store, advance } = fixture()
    const first = store.acquireLease({ outcomeId: "GOAL-1", holderId: "one", leaseDurationMs: 100, idempotencyKey: "a" })
    expect(() => store.reclaimLease({ outcomeId: "GOAL-1", holderId: "two", leaseDurationMs: 100, expectedFencingToken: first.fencingToken, idempotencyKey: "early" })).toThrowError(expect.objectContaining({ code: "LEASE_NOT_EXPIRED" }))
    advance(101)
    const second = store.reclaimLease({ outcomeId: "GOAL-1", holderId: "two", leaseDurationMs: 100, expectedFencingToken: first.fencingToken, idempotencyKey: "reclaim" })
    expect(second.fencingToken).toBeGreaterThan(first.fencingToken)
    expect(() => store.checkpoint({ outcomeId: "GOAL-1", holderId: "one", fencingToken: first.fencingToken, expectedCheckpointSequence: 0, state: "STALE", idempotencyKey: "stale" })).toThrowError(expect.objectContaining({ code: "FENCING_TOKEN_CONFLICT" }))
  })

  it("renews a live lease without changing its fencing token", () => {
    const { store, advance } = fixture()
    const first = store.acquireLease({ outcomeId: "GOAL-1", holderId: "one", leaseDurationMs: 1000, idempotencyKey: "a" })
    advance(500)
    const renewed = store.renewLease({
      outcomeId: "GOAL-1", holderId: "one", fencingToken: first.fencingToken,
      leaseDurationMs: 1000, idempotencyKey: "renew",
    })
    expect(renewed.fencingToken).toBe(first.fencingToken)
    expect(Date.parse(renewed.leaseExpiresAt)).toBe(Date.parse("2026-07-21T00:00:01.500Z"))
  })

  it("persists owner-touch counters and enforces the kill switch", () => {
    const { store } = fixture()
    expect(store.recordOwnerTouch({ counter: "ownerDiagnosticTouchCount", idempotencyKey: "touch" }).ownerTouchCounters.OWNER_DIAGNOSTIC_TOUCH_COUNT).toBe(1)
    store.setKillSwitch({ active: true, reason: "operator stop", idempotencyKey: "stop" })
    expect(() => store.acquireLease({ outcomeId: "GOAL-2", holderId: "one", leaseDurationMs: 100, idempotencyKey: "blocked" })).toThrowError(expect.objectContaining({ code: "KILL_SWITCH_ACTIVE" }))
  })
})
