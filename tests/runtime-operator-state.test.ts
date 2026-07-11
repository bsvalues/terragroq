import { describe, expect, it } from "vitest"

import {
  buildCheckpoint,
  buildLease,
  chooseNextWorkOrder,
  isLeaseExpired,
  evaluatePullRequestGate,
} from "@/scripts/runtime-operator/state.mjs"

describe("runtime operator durable state", () => {
  const issues = [
    { number: 12, created_at: "2026-07-10T02:00:00Z", labels: [{ name: "williamos:ready" }] },
    { number: 9, created_at: "2026-07-10T01:00:00Z", labels: [{ name: "williamos:ready" }] },
    { number: 3, created_at: "2026-07-09T01:00:00Z", labels: [{ name: "williamos:blocked" }] },
  ]

  it("leases the oldest ready Work Order deterministically", () => {
    expect(chooseNextWorkOrder(issues)).toMatchObject({ number: 9 })
  })

  it("creates an idempotent lease identity for issue and attempt", () => {
    expect(buildLease({ issueNumber: 9, runId: "123", attempt: 2, now: "2026-07-10T03:00:00Z" })).toMatchObject({
      leaseId: "wo-9-run-123-attempt-2",
      issueNumber: 9,
      status: "LEASED",
    })
  })

  it("expires abandoned leases and emits append-only checkpoints", () => {
    expect(isLeaseExpired("2026-07-10T01:00:00Z", "2026-07-10T03:01:00Z", 120)).toBe(true)
    expect(buildCheckpoint({ leaseId: "lease-1", state: "PR_OPEN", detail: "PR #400", at: "2026-07-10T03:00:00Z" })).toEqual({
      schemaVersion: 1,
      leaseId: "lease-1",
      state: "PR_OPEN",
      detail: "PR #400",
      at: "2026-07-10T03:00:00Z",
    })
  })

  it("merges checks-only PRs without requiring legacy status contexts", () => {
    expect(evaluatePullRequestGate({
      legacyStatuses: [],
      checkRuns: [{ status: "completed", conclusion: "success" }],
      unresolvedThreads: 0,
    })).toEqual({ decision: "MERGE" })
    expect(evaluatePullRequestGate({
      legacyStatuses: [],
      checkRuns: [{ status: "in_progress", conclusion: null }],
      unresolvedThreads: 0,
    })).toEqual({ decision: "WAIT" })
  })
})
