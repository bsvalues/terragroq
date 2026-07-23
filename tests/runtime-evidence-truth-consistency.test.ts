import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { getEvidenceSpineSurface } from "@/components/evidence/evidence-spine-surface"
import {
  buildRuntimeExecutionTruth,
  projectRuntimeExecutionQuery,
  type RuntimeExecutionGovernanceEventRecord,
  type RuntimeExecutionWorkOrderRecord,
} from "@/components/runtime/runtime-execution-model"
import { projectRuntimeExecutionTruth } from "@/components/trace/runtime-trace-projection"

describe("AC-11 evidence truth consistency", () => {
  it("projects one persisted execution consistently into Runtime, Trace, and Eval truth", () => {
    const workOrder: RuntimeExecutionWorkOrderRecord = {
      id: 42,
      userId: "owner-user",
      ref: "WO-HERMES-OUTCOME-8",
      title: "Bounded Runtime evidence window",
      goal: "GOAL-0004",
      lane: "read_model",
      status: "blocked",
      result: "PARTIAL",
      commitRef: null,
      evidence: ["issue:#448"],
      createdAt: new Date("2026-07-23T19:20:00.000Z"),
      updatedAt: new Date("2026-07-23T19:28:00.000Z"),
      closedAt: null,
      completedAt: null,
    }
    const events: RuntimeExecutionGovernanceEventRecord[] = [
      {
        id: 101,
        userId: "owner-user",
        eventType: "HERMES_RUNTIME_CHECKPOINT",
        entityType: "work_order",
        entityId: "42",
        actor: "hermes-codex-bridge",
        reason: "Provider wall remained observable",
        metadata: {
          idempotencyKey: "hermes-outcome:8:attempt:1:checkpoint:5",
          attempt: 1,
          checkpointSequence: 5,
          checkpointState: "RETRYABLE_PROVIDER_WALL",
          checkpointDetail: "bounded retry",
          payloadDigest: "a".repeat(64),
        },
        createdAt: new Date("2026-07-23T19:28:00.000Z"),
      },
      {
        id: 102,
        userId: "owner-user",
        eventType: "HERMES_RUNTIME_FAILURE_EVAL",
        entityType: "work_order",
        entityId: "42",
        actor: "hermes-codex-bridge",
        reason: "Typed provider failure",
        metadata: {
          sourceCheckpointId: 101,
          sourceCheckpointKey: "hermes-outcome:8:attempt:1:checkpoint:5",
          attempt: 1,
          checkpointSequence: 5,
          checkpointState: "RETRYABLE_PROVIDER_WALL",
          failureClass: "TRANSIENT_RUNTIME_FAILURE",
          disposition: "retryable",
          evidenceDigest: "b".repeat(64),
        },
        createdAt: new Date("2026-07-23T19:28:01.000Z"),
      },
      {
        id: 103,
        userId: "owner-user",
        eventType: "HERMES_RUNTIME_LEASE",
        entityType: "work_order",
        entityId: "42",
        actor: "hermes-codex-bridge",
        reason: "Lease abandoned for bounded retry",
        metadata: {
          idempotencyKey: "hermes-outcome:8:attempt:1:lease:ABANDONED",
          attempt: 1,
          checkpointSequence: 5,
          leaseStatus: "ABANDONED",
          leaseExpiresAt: "2026-07-23T19:28:02.000Z",
          payloadDigest: "c".repeat(64),
        },
        createdAt: new Date("2026-07-23T19:28:02.000Z"),
      },
    ]

    const query = projectRuntimeExecutionQuery(
      buildRuntimeExecutionTruth("owner-user", [workOrder], events),
    )
    const runtimeAttempt = query.activeAttempts[0]
    const trace = projectRuntimeExecutionTruth(query)
    const evalEvent = trace.find((event) => event.eventType === "HERMES_RUNTIME_FAILURE_EVAL")

    expect(runtimeAttempt).toMatchObject({
      workOrderRef: "WO-HERMES-OUTCOME-8",
      checkpointSequence: 5,
      checkpointState: "RETRYABLE_PROVIDER_WALL",
      leaseStatus: "ABANDONED",
      failureEvaluation: {
        failureClass: "TRANSIENT_RUNTIME_FAILURE",
        disposition: "retryable",
        evidenceDigest: "b".repeat(64),
      },
    })
    expect(evalEvent).toMatchObject({
      state: "RETRYABLE_PROVIDER_WALL",
      failureClass: "TRANSIENT_RUNTIME_FAILURE",
      disposition: "retryable",
      evidenceDigest: "b".repeat(64),
      provenance: {
        entity: "work_order:WO-HERMES-OUTCOME-8",
        sourceCheckpoint: "hermes-outcome:8:attempt:1:checkpoint:5",
      },
    })
  })

  it("classifies persisted user-scoped evidence/runtime data as current and the Evidence Spine as historical", () => {
    const surface = getEvidenceSpineSurface()

    expect(surface.truthReconciliation).toEqual({
      currentTruthSource: "USER_SCOPED_PERSISTED_EVIDENCE_AND_RUNTIME",
      retainedRecordMode: "HISTORICAL_STATIC",
      readOnly: true,
      excludedScope: [
        "command execution",
        "runtime control",
        "production mutation",
        "secret disclosure",
        "LAN exposure",
        "authority creation",
      ],
    })
  })

  it("keeps stale global no-persistence and no-background-worker claims out of current copy", () => {
    const surface = getEvidenceSpineSurface()
    const safetyCopy = surface.safetyProofCards
      .flatMap((card) => [card.label, card.value, card.description])
      .join(" ")

    expect(safetyCopy).toContain("Persisted Hermes/runtime truth")
    expect(safetyCopy).toContain("neither creates nor controls")
    expect(safetyCopy).not.toContain("No persistent service")
    expect(safetyCopy).not.toContain("No persistence or service/schedule")
    expect(safetyCopy).not.toContain("Hermes, MCP, Brain Council action, and autonomy remain blocked")
  })

  it("wires audit reads to current-user persisted evidence/runtime truth before static records", () => {
    const page = readFileSync("app/(shell)/audit/page.tsx", "utf8")
    const action = readFileSync("app/actions/evidence.ts", "utf8")
    const workOrdersAction = readFileSync("app/actions/work-orders.ts", "utf8")

    expect(page).toContain("getPersistedEvidenceTruth(RUNTIME_EVIDENCE_HISTORY_LIMIT + 1)")
    expect(page).toContain("projectRuntimeEvidenceHistory(persistedEvidence.records)")
    expect(page).toContain("<RuntimeEvidencePanel {...evidenceHistory} />")
    expect(page).toContain("getRuntimeExecutionQuery()")
    expect(page).toContain("Current persisted truth")
    expect(page).toContain("Retained historical/static records")
    expect(page.indexOf("<RuntimeEvidencePanel")).toBeLessThan(page.indexOf("<EvidenceSpinePanel"))
    expect(page.indexOf("<RuntimeExecutionPanel")).toBeLessThan(page.indexOf("<EvidenceSpinePanel"))

    expect(action).toContain('scope: "CURRENT_USER"')
    expect(action).toContain("eq(evidenceRecord.userId, userId)")
    expect(action).toContain("MAX_PERSISTED_EVIDENCE_RECORDS")
    expect(workOrdersAction).toContain("export async function getWorkOrders()")
    expect(workOrdersAction).toContain("eq(workOrder.userId, userId)")
    expect(workOrdersAction).toContain("orderBy(desc(workOrder.createdAt))")
  })

  it("defines persisted failure evaluations as the read-only Eval view inside Trace", () => {
    const tracePage = readFileSync("app/(shell)/trace/page.tsx", "utf8")
    const tracePanel = readFileSync("components/trace/runtime-trace-panel.tsx", "utf8")

    expect(tracePage).toContain("RuntimeTracePanel")
    expect(tracePanel).toContain('title="Failure evaluations"')
    expect(tracePanel).toContain("RUNTIME_FAILURE_EVENT")
    expect(tracePanel).toContain("No evaluator, replay")
    expect(tracePanel).not.toMatch(/<button|onClick=|executeEval|runEval/)
  })

  it("preserves excluded-scope boundaries without adding an eval, command, runtime control, or mutation path", () => {
    const page = readFileSync("app/(shell)/audit/page.tsx", "utf8")
    const surface = getEvidenceSpineSurface()
    const source = `${page}\n${JSON.stringify(surface)}`

    expect(surface.safety.commandExecutionAdded).toBe(false)
    expect(surface.safety.commandRunnerAdded).toBe(false)
    expect(surface.safety.localRuntimeControlAdded).toBe(false)
    expect(surface.safety.lanExposureEnabled).toBe(false)
    expect(surface.safety.secretsDisclosed).toBe(false)
    expect(surface.safety.autonomyAuthorized).toBe(false)
    expect(source).not.toMatch(/<button|onClick=|runEval|executeEval|startWorker|runCommand|cancelExecution/)
  })
})
