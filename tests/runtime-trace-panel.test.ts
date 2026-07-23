import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import {
  RUNTIME_CHECKPOINT_EVENT,
  RUNTIME_FAILURE_EVENT,
  type RuntimeExecutionQueryResult,
} from "../components/runtime/runtime-execution-model"
import { projectRuntimeExecutionTruth } from "../components/trace/runtime-trace-projection"

function query(): RuntimeExecutionQueryResult {
  return {
    executions: [],
    attempts: [],
    activeAttempts: [],
    terminalAttempts: [],
    completedAttempts: [],
    events: [
      {
        id: 11,
        eventType: RUNTIME_CHECKPOINT_EVENT,
        entityType: "work_order",
        entityId: "WO-HERMES-OUTCOME-7",
        actor: "hermes-codex-bridge",
        createdAt: new Date("2026-07-23T01:00:00.000Z"),
        metadata: {
          attempt: 1,
          checkpointSequence: 3,
          checkpointState: "HOST_VALIDATION_PASSED",
          payloadDigest: "a".repeat(64),
        },
      },
      {
        id: 12,
        eventType: RUNTIME_FAILURE_EVENT,
        entityType: "work_order",
        entityId: "WO-HERMES-OUTCOME-7",
        actor: "hermes-codex-bridge",
        createdAt: new Date("2026-07-23T01:01:00.000Z"),
        metadata: {
          attempt: 1,
          checkpointSequence: 4,
          checkpointState: "RETRYABLE_WALL",
          failureClass: "TRANSIENT_RUNTIME_FAILURE",
          disposition: "retryable",
          sourceCheckpointKey: "hermes-outcome:7:attempt:1:checkpoint:4",
          evidenceDigest: "b".repeat(64),
        },
      },
    ],
  }
}

describe("runtime trace panel contract", () => {
  it("projects typed persisted events without re-hashing or exposing raw metadata", () => {
    expect(projectRuntimeExecutionTruth(query())).toEqual([
      expect.objectContaining({
        id: "GEV-12",
        eventType: RUNTIME_FAILURE_EVENT,
        evidenceDigest: "b".repeat(64),
        state: "RETRYABLE_WALL",
        failureClass: "TRANSIENT_RUNTIME_FAILURE",
        provenance: expect.objectContaining({
          sourceCheckpoint: "hermes-outcome:7:attempt:1:checkpoint:4",
        }),
      }),
      expect.objectContaining({
        id: "GEV-11",
        eventType: RUNTIME_CHECKPOINT_EVENT,
        evidenceDigest: "a".repeat(64),
        state: "HOST_VALIDATION_PASSED",
      }),
    ])
  })

  it("renders persisted checkpoint and failure-eval provenance", () => {
    const panel = readFileSync("components/trace/runtime-trace-panel.tsx", "utf8")
    for (const marker of [
      "RUNTIME_CHECKPOINT_EVENT",
      "RUNTIME_FAILURE_EVENT",
      "Persisted runtime trace",
      "Failure evaluations",
      "Evidence digest",
      "Source checkpoint",
    ]) {
      expect(panel).toContain(marker)
    }
  })

  it("keeps the runtime trace read-only and excludes raw secret surfaces", () => {
    const panel = readFileSync("components/trace/runtime-trace-panel.tsx", "utf8")
    expect(panel).toContain("No evaluator, replay")
    expect(panel).not.toMatch(/<button|onClick=|password|cookie|session value/i)
  })

  it("labels the historical ledger separately from persisted execution truth", () => {
    const page = readFileSync("app/(shell)/trace/page.tsx", "utf8")
    expect(page).toContain("Historical / static Trace Ledger")
    expect(page).toContain("RuntimeTracePanel")
    expect(page).toContain("TraceLedgerPanel")
  })

  it("uses a bounded user-scoped runtime action without cross-execution starvation", () => {
    const action = readFileSync("app/actions/runtime-executions.ts", "utf8")
    const runtimePage = readFileSync("app/(shell)/runtime/page.tsx", "utf8")
    const tracePage = readFileSync("app/(shell)/trace/page.tsx", "utf8")

    expect(action).toContain("RUNTIME_EXECUTION_LIMIT = 50")
    expect(action).toContain("RUNTIME_EVENTS_PER_EXECUTION_LIMIT = 500")
    expect(action).toContain("Promise.all(workOrderIds.map")
    expect(action).toContain("eq(governanceEvent.entityId, workOrderId)")
    expect(action).not.toContain("inArray(governanceEvent.entityId, workOrderIds)")
    expect(action.match(/\.limit\(/g)).toHaveLength(2)
    expect(action).not.toContain("function getRuntimeExecutionTruth")
    expect(runtimePage).toContain("getRuntimeExecutions")
    expect(tracePage).toContain("getRuntimeExecutions")
  })
})
