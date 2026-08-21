import fs from "node:fs"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import {
  captureRuntimeAgreement,
  createResidentHermesOrchestrator,
  recoverExternalToolWall,
  recoverOrphanedValidationCycle,
  recoverPostMergeCleanupWall,
  recoverActivePostMergeCleanupWall,
  recoverReviewedMerge,
  recoverTerminalPostMergeCleanupWall,
  recoverValidationInfrastructureWall,
  redactHermesStatus,
  resolveHermesSmokeCwd,
  runHermesTransportSmoke,
  printHermesCycleResult,
  runHermesQueueDrain,
  runCliEntrypoint,
  sanitizeBridgeMessage,
} from "../scripts/hermes-bridge/cli.mjs"
import { initializeHermesState } from "../scripts/hermes-bridge/state-store.mjs"
import { resolveHermesWorkContract } from "../scripts/hermes-bridge/work-contract.mjs"

const agentEntrypoint = fs.readFileSync(path.join(process.cwd(), "AGENTS.md"), "utf8")

function exactIssue911Outcome(id: number, ref: string) {
  const outcome = {
    id, ref,
    command: "record structured #911 reliability remediation without host mutation",
    lane: "operator-objective",
    mode: "implement",
    risk: "R1",
    authority: "A2_WRITE_OWN",
    status: "classified",
    outcomeKey: `goal:${ref}`,
  }
  const contract = resolveHermesWorkContract(outcome)
  if (!contract) throw new Error("exact #911 test contract missing")
  const queueBinding = {
    userId: "user-911",
    outcomeKey: outcome.outcomeKey,
    expectedVersion: 3,
    executionBinding: `execution-${id}`,
    leaseToken: `lease-${id}`,
    leaseHolder: "hermes-bridge",
    acquisitionKey: `acquisition-${id}`,
    fencingToken: 2,
  }
  return {
    ...outcome,
    queueBinding,
    verifiedQueueWorkContract: {
      contract,
      provenance: {
        operation: "workbench_execution.authorize",
        outcomeKey: outcome.outcomeKey,
        workOrderRef: `WO-HERMES-OUTCOME-${id}`,
      },
    },
  }
}

describe("Hermes bridge CLI", () => {
  it.each([
    [{}, "HERMES_RESIDENT_AEGIS_REQUIRED"],
    [{ WILLIAMOS_CODEX_EXEC_NODE: "local" }, "HERMES_RESIDENT_AEGIS_REQUIRED"],
    [{ WILLIAMOS_CODEX_EXEC_NODE: "worker-2" }, "HERMES_RESIDENT_AEGIS_REQUIRED"],
    [{ WILLIAMOS_CODEX_EXEC_NODE: "aegis" }, "HERMES_RESIDENT_AEGIS_REPOSITORY_WALL"],
    [{ WILLIAMOS_CODEX_EXEC_NODE: "aegis", WILLIAMOS_AEGIS_REPOSITORY_ROOT: "relative/repo" }, "HERMES_RESIDENT_AEGIS_REPOSITORY_WALL"],
  ])("fails the resident AEGIS gate before queue construction for %j", (environment, code) => {
    const createQueueRuntime = vi.fn()
    expect(() => createResidentHermesOrchestrator({
      requireAegis: true,
      environment,
      createQueueRuntime,
    })).toThrow(code)
    expect(createQueueRuntime).not.toHaveBeenCalled()
  })

  it("rejects a selected local backend before resident queue construction", () => {
    const createQueueRuntime = vi.fn()
    expect(() => createResidentHermesOrchestrator({
      requireAegis: true,
      environment: {
        WILLIAMOS_CODEX_EXEC_NODE: "aegis",
        WILLIAMOS_AEGIS_REPOSITORY_ROOT: "/home/bs/terragroq",
      },
      selectExecutionBackend: () => ({ isLocal: true }),
      createQueueRuntime,
    })).toThrow("HERMES_RESIDENT_LOCAL_BACKEND_WALL")
    expect(createQueueRuntime).not.toHaveBeenCalled()
  })

  it("passes the exact non-local AEGIS backend into the resident orchestrator", async () => {
    const executionBackend = { isLocal: false }
    const queueRuntime = {
      selectOutcome: vi.fn(), completeOutcome: vi.fn(), terminalizeOutcome: vi.fn(),
      deferOutcome: vi.fn(), renewOutcomeLease: vi.fn(), bindWorkOrder: vi.fn(),
      refreshOutcome: vi.fn(), resumeAfterOwnerDecision: vi.fn(),
      resumeAfterValidationRecovery: vi.fn(), resumeAfterReviewRecovery: vi.fn(),
      close: vi.fn(async () => {}),
    }
    const createOrchestrator = vi.fn(() => ({ cycle: vi.fn() }))
    const resident = createResidentHermesOrchestrator({
      requireAegis: true,
      environment: {
        WILLIAMOS_CODEX_EXEC_NODE: "aegis",
        WILLIAMOS_AEGIS_REPOSITORY_ROOT: "/home/bs/terragroq",
      },
      selectExecutionBackend: () => executionBackend,
      queueRuntime,
      createOrchestrator,
    })
    expect(createOrchestrator).toHaveBeenCalledWith(expect.objectContaining({ executionBackend }))
    expect(queueRuntime.selectOutcome).not.toHaveBeenCalled()
    await resident.close()
  })

  it("uses the configured AEGIS repository for remote transport smoke", () => {
    expect(resolveHermesSmokeCwd({
      WILLIAMOS_CODEX_EXEC_NODE: "aegis",
      WILLIAMOS_AEGIS_REPOSITORY_ROOT: "/home/bs/terragroq",
    })).toBe("/home/bs/terragroq")
  })

  it("fails closed when remote transport smoke has no explicit AEGIS repository", () => {
    expect(() => resolveHermesSmokeCwd({
      WILLIAMOS_CODEX_EXEC_NODE: "aegis",
    })).toThrow("HERMES_SMOKE_REMOTE_CWD_WALL")
  })

  it("rejects a smoke that could fall back to the local execution backend", () => {
    expect(() => resolveHermesSmokeCwd({})).toThrow("HERMES_SMOKE_AEGIS_REQUIRED")
  })

  it("rejects a non-AEGIS smoke target instead of attesting it as AEGIS", () => {
    expect(() => resolveHermesSmokeCwd({
      WILLIAMOS_CODEX_EXEC_NODE: "worker-2",
      WILLIAMOS_AEGIS_REPOSITORY_ROOT: "/home/bs/terragroq",
    })).toThrow("HERMES_SMOKE_AEGIS_REQUIRED")
  })

  it("rejects the filesystem root as an AEGIS smoke repository", () => {
    expect(() => resolveHermesSmokeCwd({
      WILLIAMOS_CODEX_EXEC_NODE: "aegis",
      WILLIAMOS_AEGIS_REPOSITORY_ROOT: "/",
    })).toThrow("HERMES_SMOKE_REMOTE_CWD_WALL")
  })

  it("runs the transport smoke through the selected AEGIS execution backend", async () => {
    const calls: unknown[] = []
    const client = {
      connect: vi.fn(async () => {}),
      startThread: vi.fn(async (request) => { calls.push(request); return "thread-1" }),
      runTurn: vi.fn(async (request) => {
        calls.push(request)
        return { status: "completed", finalText: "HERMES_APP_SERVER_READY" }
      }),
      close: vi.fn(),
    }
    const executionBackend = {
      runCodexClient: vi.fn(async (request) => { calls.push(request); return client }),
    }
    await expect(runHermesTransportSmoke({
      environment: {
        WILLIAMOS_CODEX_EXEC_NODE: "aegis",
        WILLIAMOS_AEGIS_REPOSITORY_ROOT: "/home/bs/terragroq",
      },
      executionBackend,
      timeoutMs: 42,
    })).resolves.toEqual({
      result: "PASS",
      transport: "AEGIS_SSH_CODEX_APP_SERVER_STDIO",
      rejectedIssue357Reused: false,
    })
    expect(executionBackend.runCodexClient).toHaveBeenCalledWith({
      workspacePath: "/home/bs/terragroq",
      timeoutMs: 42,
    })
    expect(calls).toContainEqual({
      cwd: "/home/bs/terragroq",
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true,
    })
    expect(client.close).toHaveBeenCalledOnce()
  })

  it("wires durable review recovery through the resident queue runtime", async () => {
    const resumeAfterReviewRecovery = vi.fn()
    const close = vi.fn(async () => {})
    const queueRuntime = {
      selectOutcome: vi.fn(), completeOutcome: vi.fn(), terminalizeOutcome: vi.fn(),
      deferOutcome: vi.fn(), renewOutcomeLease: vi.fn(), bindWorkOrder: vi.fn(),
      refreshOutcome: vi.fn(), resumeAfterOwnerDecision: vi.fn(),
      resumeAfterValidationRecovery: vi.fn(), resumeAfterReviewRecovery, close,
    }
    const createOrchestrator = vi.fn(() => ({ cycle: vi.fn() }))

    const resident = createResidentHermesOrchestrator({ queueRuntime, createOrchestrator })

    expect(createOrchestrator).toHaveBeenCalledWith(expect.objectContaining({
      resumeQueueAfterReviewRecovery: resumeAfterReviewRecovery,
    }))
    await resident.close()
    expect(close).toHaveBeenCalledOnce()
  })

  it("delegates orphaned validation recovery to the guarded orchestrator operation", async () => {
    const recoverOrphanedValidationCycleLease = vi.fn(async () => ({
      result: "RECOVERED", outcomeId: "12", fencingToken: 78, replayed: false,
    }))

    await expect(recoverOrphanedValidationCycle({
      orchestrator: { recoverOrphanedValidationCycleLease },
    })).resolves.toEqual({ result: "RECOVERED", outcomeId: "12", fencingToken: 78, replayed: false })
    expect(recoverOrphanedValidationCycleLease).toHaveBeenCalledOnce()
  })

  it("runs the real read-only status command without supervisor proof context", () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-cli-status-"))
    const statePath = path.join(runtimeRoot, "state", "state.json")
    initializeHermesState(statePath, { now: () => new Date("2026-07-28T12:00:00.000Z") })

    try {
      const result = spawnSync(
        process.execPath,
        ["scripts/hermes-bridge/cli.mjs", "status"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            WILLIAMOS_HERMES_RUNTIME_ROOT: runtimeRoot,
            HERMES_CAMPAIGN_WINDOW_ID: "",
            HERMES_PROCESS_IDENTITY: "",
          },
        },
      )

      expect(result.status).toBe(0)
      expect(result.stderr).toBe("")
      expect(JSON.parse(result.stdout.trim())).toMatchObject({
        schemaVersion: 1,
        storeId: "hermes-bridge",
        revision: 0,
      })
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true })
    }
  })

  it("captures the production agreement through sanitized runtime-owned paths", async () => {
    const producer = vi.fn(async () => ({
      schemaVersion: 1,
      observedAt: "2026-07-28T18:00:00.000Z",
      mode: "HEALTHY_IDLE",
      queue: null,
      local: null,
      workOrder: null,
    }))
    const root = path.resolve(path.sep, "runtime-agreement")

    await expect(captureRuntimeAgreement({
      runtimeRoot: root,
      databaseUrl: "configured-outside-output",
      producer,
      now: () => 1,
    })).resolves.toMatchObject({ mode: "HEALTHY_IDLE" })
    expect(producer).toHaveBeenCalledWith({
      statePath: path.join(root, "state", "state.json"),
      outputPath: path.join(root, "evidence", "queue-runtime-agreement.json"),
      databaseUrl: "configured-outside-output",
      query: undefined,
      createPool: undefined,
      now: expect.any(Function),
    })
    expect(JSON.stringify(await producer.mock.results[0].value)).not.toMatch(
      /leaseToken|executionBinding|acquisitionKey/,
    )
  })

  it("redacts durable queue capabilities from status projections at every depth", () => {
    const status = redactHermesStatus({
      executions: {
        "77": {
          metadata: {
            outcome: {
              queueBinding: {
                outcomeKey: "outcome:77",
                leaseToken: "lease-secret",
                executionBinding: "execution-secret",
                acquisitionKey: "acquisition-secret",
                fencingToken: 3,
              },
            },
          },
        },
      },
      idempotency: {
        acquire: {
          result: {
            metadata: {
              outcome: {
                queueBinding: {
                  leaseToken: "receipt-lease",
                  acquisitionKey: "receipt-acquisition",
                },
              },
            },
          },
        },
      },
    })

    expect(JSON.stringify(status)).not.toMatch(/lease-secret|execution-secret|acquisition-secret|receipt-lease|receipt-acquisition/)
    expect(status.executions["77"].metadata.outcome.queueBinding).toEqual({
      outcomeKey: "outcome:77",
      fencingToken: 3,
    })
  })

  it("continues immediately through settled queue outcomes until the queue is drained", async () => {
    const cycle = vi.fn()
      .mockResolvedValueOnce({ result: "COMPLETE", outcomeId: "77", prNumber: 475, mergeSha: "a".repeat(40) })
      .mockResolvedValueOnce({ result: "FAILED_TERMINAL", outcomeId: "78", nextState: "VALIDATION_FAILED" })
      .mockResolvedValueOnce({ result: "NO_ELIGIBLE_OUTCOME" })

    await expect(runHermesQueueDrain({ orchestrator: { cycle }, maxOutcomes: 3 }))
      .resolves.toEqual({
        result: "QUEUE_DRAINED",
        settled: [
          { result: "COMPLETE", outcomeId: "77", prNumber: 475, mergeSha: "a".repeat(40) },
          { result: "FAILED_TERMINAL", outcomeId: "78", nextState: "VALIDATION_FAILED" },
        ],
        stopReason: "NO_ELIGIBLE_OUTCOME",
      })
    expect(cycle).toHaveBeenCalledTimes(3)
  })

  it("consumes a Primary decision exactly once before the first queue cycle", async () => {
    const calls: string[] = []
    const consumeDecision = vi.fn(async () => {
      calls.push("decision")
      return { status: "NO_PENDING_PRIMARY_DECISION" }
    })
    const cycle = vi.fn(async () => {
      calls.push("cycle")
      return { result: "NO_ELIGIBLE_OUTCOME" }
    })

    await expect(runHermesQueueDrain({ orchestrator: { cycle }, consumeDecision }))
      .resolves.toEqual({ result: "NO_ELIGIBLE_OUTCOME" })
    expect(consumeDecision).toHaveBeenCalledOnce()
    expect(cycle).toHaveBeenCalledOnce()
    expect(calls).toEqual(["decision", "cycle"])
  })

  it("consumes finding backlog before cycles and loops when a NO_ELIGIBLE result creates child work", async () => {
    const calls: string[] = []
    const consumeRuntimeFindings = vi.fn()
      .mockImplementationOnce(async () => { calls.push("findings:backlog"); return { queuedChildren: 0 } })
      .mockImplementationOnce(async () => { calls.push("findings:post-empty"); return { queuedChildren: 1 } })
      .mockImplementationOnce(async () => { calls.push("findings:post-child"); return { queuedChildren: 0 } })
      .mockImplementationOnce(async () => { calls.push("findings:post-drain"); return { queuedChildren: 0 } })
    const cycle = vi.fn()
      .mockImplementationOnce(async () => { calls.push("cycle:empty"); return { result: "NO_ELIGIBLE_OUTCOME" } })
      .mockImplementationOnce(async () => { calls.push("cycle:child"); return { result: "COMPLETE", outcomeId: "derived" } })
      .mockImplementationOnce(async () => { calls.push("cycle:drain"); return { result: "NO_ELIGIBLE_OUTCOME" } })

    await expect(runHermesQueueDrain({
      orchestrator: { cycle, consumeRuntimeFindings }, maxOutcomes: 3,
    })).resolves.toMatchObject({
      result: "QUEUE_DRAINED", stopReason: "NO_ELIGIBLE_OUTCOME",
      settled: [{ result: "COMPLETE", outcomeId: "derived" }],
    })
    expect(calls).toEqual([
      "findings:backlog", "cycle:empty", "findings:post-empty", "cycle:child",
      "findings:post-child", "cycle:drain", "findings:post-drain",
    ])
  })

  it("aborts before another cycle when post-cycle finding consumption walls, then permits a clean retry", async () => {
    const parent = { lifecycleState: "active", leaseToken: "lease-parent" as string | null }
    const wall = Object.assign(new Error("consumer wall"), {
      code: "HERMES_RUNTIME_FINDING_CONSUMER_WALL",
    })
    const consumeRuntimeFindings = vi.fn()
      .mockResolvedValueOnce({ queuedChildren: 0 })
      .mockRejectedValueOnce(wall)
    const cycle = vi.fn(async () => {
      parent.lifecycleState = "completed"
      parent.leaseToken = null
      return { result: "COMPLETE", outcomeId: "parent" }
    })
    await expect(runHermesQueueDrain({ orchestrator: { cycle, consumeRuntimeFindings } }))
      .rejects.toBe(wall)
    expect(cycle).toHaveBeenCalledOnce()

    const retryConsumer = vi.fn(async () => {
      expect(parent).toEqual({ lifecycleState: "completed", leaseToken: null })
      return { queuedChildren: 0 }
    })
    const retryCycle = vi.fn(async () => ({ result: "NO_ELIGIBLE_OUTCOME" }))
    await expect(runHermesQueueDrain({
      orchestrator: { cycle: retryCycle, consumeRuntimeFindings: retryConsumer },
    })).resolves.toEqual({ result: "NO_ELIGIBLE_OUTCOME" })
    expect(retryConsumer).toHaveBeenCalledTimes(2)
    expect(retryCycle).toHaveBeenCalledOnce()
  })

  it("re-reads and presents a newly gated backlog Primary request in the same drain", async () => {
    const pending = {
      status: "PENDING_PRIMARY_DECISION", sourceKind: "RUNTIME_FINDING",
      prompt: "WILLIAMOS_PRIMARY_DECISION_REQUEST:new-gate",
    }
    const consumeDecision = vi.fn()
      .mockResolvedValueOnce({ status: "NO_PENDING_PRIMARY_DECISION" })
      .mockResolvedValueOnce(pending)
    const consumeRuntimeFindings = vi.fn()
      .mockResolvedValueOnce({ gated: 1, queuedChildren: 0 })
      .mockResolvedValueOnce({ gated: 0, queuedChildren: 0 })
    const cycle = vi.fn(async () => ({ result: "NO_ELIGIBLE_OUTCOME" }))

    await expect(runHermesQueueDrain({
      orchestrator: { cycle, consumeRuntimeFindings }, consumeDecision,
    })).resolves.toEqual(pending)
    expect(consumeDecision).toHaveBeenCalledTimes(2)
    expect(cycle).toHaveBeenCalledOnce()
  })

  it("returns an exact pending Primary request only after the ordinary queue is empty", async () => {
    const pending = {
      status: "PENDING_PRIMARY_DECISION",
      outcomeId: 77,
      requestDigest: "a".repeat(64),
      prompt: "WILLIAMOS_PRIMARY_DECISION_REQUEST:exact",
    }
    const consumeDecision = vi.fn(async () => pending)
    const cycle = vi.fn(async () => ({ result: "NO_ELIGIBLE_OUTCOME" }))

    await expect(runHermesQueueDrain({ orchestrator: { cycle }, consumeDecision }))
      .resolves.toEqual(pending)
    expect(consumeDecision).toHaveBeenCalledOnce()
    expect(cycle).toHaveBeenCalledOnce()
  })

  it("drains ordinary siblings before presenting a retained Primary request", async () => {
    const pending = {
      status: "PENDING_PRIMARY_DECISION",
      sourceKind: "RUNTIME_FINDING",
      requestDigest: "a".repeat(64),
      prompt: "WILLIAMOS_PRIMARY_DECISION_REQUEST:exact",
    }
    const consumeDecision = vi.fn(async () => pending)
    const cycle = vi.fn()
      .mockResolvedValueOnce({ result: "COMPLETE", outcomeId: "ordinary-sibling" })
      .mockResolvedValueOnce({ result: "NO_ELIGIBLE_OUTCOME" })

    await expect(runHermesQueueDrain({ orchestrator: { cycle }, consumeDecision }))
      .resolves.toEqual(pending)
    expect(cycle).toHaveBeenCalledTimes(2)
    expect(consumeDecision).toHaveBeenCalledTimes(2)
  })

  it("suppresses a stale runtime-finding prompt when post-drain revalidation loses actionability", async () => {
    const consumeDecision = vi.fn()
      .mockResolvedValueOnce({
        status: "PENDING_PRIMARY_DECISION",
        sourceKind: "RUNTIME_FINDING",
        requestDigest: "a".repeat(64),
        prompt: "WILLIAMOS_PRIMARY_DECISION_REQUEST:stale",
      })
      .mockResolvedValueOnce({ status: "NO_PENDING_PRIMARY_DECISION" })
    const cycle = vi.fn()
      .mockResolvedValueOnce({ result: "COMPLETE", outcomeId: "ordinary-sibling" })
      .mockResolvedValueOnce({ result: "NO_ELIGIBLE_OUTCOME" })

    await expect(runHermesQueueDrain({ orchestrator: { cycle }, consumeDecision }))
      .resolves.toEqual({
        result: "QUEUE_DRAINED",
        settled: [{ result: "COMPLETE", outcomeId: "ordinary-sibling" }],
        stopReason: "NO_ELIGIBLE_OUTCOME",
      })
    expect(consumeDecision).toHaveBeenCalledTimes(2)
  })

  it("prints only the canonical prompt for a pending Primary decision", () => {
    const writes: string[] = []
    printHermesCycleResult({
      status: "PENDING_PRIMARY_DECISION",
      outcomeId: 77,
      requestDigest: "a".repeat(64),
      prompt: "WILLIAMOS_PRIMARY_DECISION_REQUEST:exact\nReply only Approve or Deny",
    }, (value) => writes.push(String(value)))

    expect(writes).toEqual([
      "WILLIAMOS_PRIMARY_DECISION_REQUEST:exact\nReply only Approve or Deny",
    ])
    expect(agentEntrypoint).toContain(
      "emit that text byte-for-byte as the entire final assistant message",
    )
    expect(agentEntrypoint).toContain("Stop all tool use")
  })

  it("surfaces a recorded Primary decision with the resulting queue state", async () => {
    const decision = {
      status: "PRIMARY_DECISION_RECORDED",
      outcomeId: 77,
      choice: "APPROVE",
      resumeReleased: true,
      decisionRef: "OWNER-DECISION-77-120",
    }
    const consumeDecision = vi.fn(async () => decision)
    const cycle = vi.fn(async () => ({ result: "NO_ELIGIBLE_OUTCOME" }))

    await expect(runHermesQueueDrain({ orchestrator: { cycle }, consumeDecision }))
      .resolves.toEqual({ result: "NO_ELIGIBLE_OUTCOME", decision })
  })

  it("does not start a queue cycle when Primary decision intake fails", async () => {
    const wall = Object.assign(new Error("decision provenance unavailable"), {
      code: "PRIMARY_DECISION_PROVENANCE_WALL",
    })
    const consumeDecision = vi.fn().mockRejectedValue(wall)
    const cycle = vi.fn()

    await expect(runHermesQueueDrain({ orchestrator: { cycle }, consumeDecision }))
      .rejects.toBe(wall)
    expect(consumeDecision).toHaveBeenCalledOnce()
    expect(cycle).not.toHaveBeenCalled()
  })

  it("preserves settled outcomes when the bounded drain budget is exhausted", async () => {
    const cycle = vi.fn()
      .mockResolvedValueOnce({ result: "COMPLETE", outcomeId: "77", mergeSha: "a".repeat(40) })
      .mockResolvedValueOnce({ result: "FAILED_TERMINAL", outcomeId: "78", nextState: "VALIDATION_FAILED" })

    await expect(runHermesQueueDrain({ orchestrator: { cycle }, maxOutcomes: 2 }))
      .rejects.toMatchObject({
        code: "HERMES_QUEUE_DRAIN_BUDGET_WALL",
        settled: [
          { result: "COMPLETE", outcomeId: "77", mergeSha: "a".repeat(40) },
          { result: "FAILED_TERMINAL", outcomeId: "78", nextState: "VALIDATION_FAILED" },
        ],
      })
  })

  it("abandons any exact cycle-owned lease when queue draining exits", async () => {
    const abandonOwnedCycleLease = vi.fn(() => ({ abandoned: true, outcomeId: "77" }))
    const cycle = vi.fn().mockRejectedValue(
      Object.assign(new Error("projection unavailable"), { code: "HERMES_RUNTIME_PROJECTION_WALL" }),
    )

    await expect(runHermesQueueDrain({ orchestrator: { cycle, abandonOwnedCycleLease } }))
      .rejects.toMatchObject({ code: "HERMES_RUNTIME_PROJECTION_WALL" })
    expect(abandonOwnedCycleLease).toHaveBeenCalledOnce()
  })

  it("preserves the primary cycle wall when exit cleanup also fails", async () => {
    const cycleWall = Object.assign(new Error("projection unavailable"), {
      code: "HERMES_RUNTIME_PROJECTION_WALL",
    })
    const cleanupWall = Object.assign(new Error("cleanup projection unavailable"), {
      code: "HERMES_EXECUTION_CONCURRENCY_WALL",
    })
    const abandonOwnedCycleLease = vi.fn().mockRejectedValue(cleanupWall)
    const cycle = vi.fn().mockRejectedValue(cycleWall)

    await expect(runHermesQueueDrain({ orchestrator: { cycle, abandonOwnedCycleLease } }))
      .rejects.toBe(cycleWall)
    expect(abandonOwnedCycleLease).toHaveBeenCalledOnce()
  })

  it("redacts credential-bearing database URLs from structured wall output", () => {
    expect(sanitizeBridgeMessage("connect failed for postgresql://owner:opaque-password@db.example.test/app"))
      .toBe("connect failed for postgresql://[REDACTED]@db.example.test/app")
  })

  it("flushes output and exits after a completed one-shot command", async () => {
    const events: string[] = []

    await runCliEntrypoint("cycle", {
      run: async (command: string) => {
        events.push(`run:${command}`)
        return 0
      },
      flush: async () => { events.push("flush") },
      exit: (code: number) => { events.push(`exit:${code}`) },
    })

    expect(events).toEqual(["run:cycle", "flush", "exit:0"])
  })

  it("propagates a failed command exit code after flushing output", async () => {
    const events: string[] = []

    await runCliEntrypoint("cycle", {
      run: async () => 1,
      flush: async () => { events.push("flush") },
      exit: (code: number) => { events.push(`exit:${code}`) },
    })

    expect(events).toEqual(["flush", "exit:1"])
  })

  it("reopens local validation state before persisting proof and recovering the outcome", async () => {
    const calls: string[] = []
    const validationFailure = "Error: spawn EPERM"
    const candidate = {
      outcomeId: "5", fencingToken: 14,
      lease: { status: "RELEASED" },
      checkpoint: { sequence: 9, state: "FAILED_TERMINAL", detail: "VALIDATION_REMEDIATION_EXHAUSTED" },
      metadata: { validationFailure },
    }
    const orchestrator = {
      state: {
        read: () => ({
          ownerTouchCounters: {
            OWNER_OPERATION_TOUCH_COUNT: 0, OWNER_CREDENTIAL_TOUCH_COUNT: 0,
            OWNER_DIAGNOSTIC_TOUCH_COUNT: 0, OWNER_ROUTINE_DECISION_COUNT: 0,
            OWNER_ROUTINE_CONTACT_COUNT: 0,
          },
          executions: { "5": candidate },
        }),
        reopenValidationInfrastructureWall: vi.fn(() => { calls.push("state"); return { fencingToken: 15 } }),
      },
    }
    const recordProof = vi.fn(async () => { calls.push("proof"); return true })
    const recoverOutcome = vi.fn(async () => { calls.push("database"); return true })

    await expect(recoverValidationInfrastructureWall({ orchestrator, recordProof, recoverOutcome }))
      .resolves.toMatchObject({ result: "RECOVERED", outcomeId: "5", proofRecorded: true })
    expect(calls).toEqual(["proof", "state", "database"])
    expect(recordProof.mock.calls[0][0]).toMatchObject({ outcomeId: 5, fencingToken: 14 })
    expect(recoverOutcome.mock.calls[0][0].proofDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it("leaves local validation state untouched when durable terminal proof is absent", async () => {
    const reopenValidationInfrastructureWall = vi.fn()
    const orchestrator = {
      state: {
        read: () => ({
          ownerTouchCounters: {
            OWNER_OPERATION_TOUCH_COUNT: 0, OWNER_CREDENTIAL_TOUCH_COUNT: 0,
            OWNER_DIAGNOSTIC_TOUCH_COUNT: 0, OWNER_ROUTINE_DECISION_COUNT: 0,
            OWNER_ROUTINE_CONTACT_COUNT: 0,
          },
          executions: { "12": {
            outcomeId: "12", fencingToken: 72,
            lease: { status: "RELEASED" },
            checkpoint: {
              sequence: 86, state: "FAILED_TERMINAL",
              detail: "VALIDATION_REMEDIATION_EXHAUSTED",
            },
            metadata: { validationFailure: "Error: spawn EPERM" },
          } },
        }),
        reopenValidationInfrastructureWall,
      },
    }
    const recoverOutcome = vi.fn()

    await expect(recoverValidationInfrastructureWall({
      orchestrator,
      recordProof: vi.fn(async () => false),
      recoverOutcome,
    })).rejects.toMatchObject({ code: "HERMES_VALIDATION_RECOVERY_PROOF_WALL" })
    expect(reopenValidationInfrastructureWall).not.toHaveBeenCalled()
    expect(recoverOutcome).not.toHaveBeenCalled()
  })

  it("classifies a missing isolated-worktree Vitest executable as recoverable infrastructure", async () => {
    const validationFailure = "npx vitest run tests/focused.test.ts exited 1\n'vitest' is not recognized as an internal or external command"
    const candidate = {
      outcomeId: "12", fencingToken: 54,
      lease: { status: "RELEASED" },
      checkpoint: { sequence: 25, state: "FAILED_TERMINAL", detail: "VALIDATION_REMEDIATION_EXHAUSTED" },
      metadata: { validationFailure },
    }
    const reopenValidationInfrastructureWall = vi.fn(() => ({ checkpointSequence: 26, fencingToken: 55 }))
    const orchestrator = {
      state: {
        read: () => ({
          ownerTouchCounters: {
            OWNER_OPERATION_TOUCH_COUNT: 0, OWNER_CREDENTIAL_TOUCH_COUNT: 0,
            OWNER_DIAGNOSTIC_TOUCH_COUNT: 0, OWNER_ROUTINE_DECISION_COUNT: 0,
            OWNER_ROUTINE_CONTACT_COUNT: 0,
          },
          executions: { "12": candidate },
        }),
        reopenValidationInfrastructureWall,
      },
    }
    const recordProof = vi.fn(async () => true)
    const recoverOutcome = vi.fn(async () => true)

    await expect(recoverValidationInfrastructureWall({ orchestrator, recordProof, recoverOutcome }))
      .resolves.toMatchObject({ result: "RECOVERED", outcomeId: "12", proofRecorded: true })
    expect(reopenValidationInfrastructureWall).toHaveBeenCalledOnce()
  })

  it("reopens validation infrastructure after an exact cycle-exit abandonment", async () => {
    const validationFailure = "npm run lint exited 1\nFailed to load plugin 'react-hooks' declared in eslint-config-next: Cannot find module 'eslint-plugin-react-hooks'"
    const abandonedAt = "2026-08-06T07:27:19.027Z"
    const candidate = {
      outcomeId: "12", fencingToken: 72,
      lease: {
        status: "ACTIVE", abandonedAt, expiresAt: abandonedAt,
        abandonReason: "HERMES_CYCLE_PROCESS_EXIT",
      },
      checkpoint: {
        sequence: 86, state: "FAILED_TERMINAL",
        detail: "VALIDATION_REMEDIATION_EXHAUSTED",
      },
      metadata: { validationFailure },
    }
    const reopenValidationInfrastructureWall = vi.fn(() => ({ checkpointSequence: 87, fencingToken: 73 }))
    const orchestrator = {
      state: {
        read: () => ({
          ownerTouchCounters: {
            OWNER_OPERATION_TOUCH_COUNT: 0, OWNER_CREDENTIAL_TOUCH_COUNT: 0,
            OWNER_DIAGNOSTIC_TOUCH_COUNT: 0, OWNER_ROUTINE_DECISION_COUNT: 0,
            OWNER_ROUTINE_CONTACT_COUNT: 0,
          },
          executions: { "12": candidate },
        }),
        reopenValidationInfrastructureWall,
      },
    }

    await expect(recoverValidationInfrastructureWall({
      orchestrator,
      recordProof: vi.fn(async ({ fencingToken }) => fencingToken === 72),
      recoverOutcome: vi.fn(async () => true),
    })).resolves.toMatchObject({ result: "RECOVERED", outcomeId: "12" })
    expect(reopenValidationInfrastructureWall).toHaveBeenCalledOnce()
  })

  it.each([
    [{ status: "ACTIVE", expiresAt: "2026-08-06T07:27:19.027Z" }, "missing abandonment"],
    [{
      status: "ACTIVE",
      abandonedAt: "2026-08-06T07:27:18.000Z",
      expiresAt: "2026-08-06T07:27:19.027Z",
      abandonReason: "HERMES_CYCLE_PROCESS_EXIT",
    }, "mismatched abandonment"],
    [{
      status: "ACTIVE",
      abandonedAt: "2026-08-06T07:27:19.027Z",
      expiresAt: "2026-08-06T07:27:19.027Z",
      abandonReason: "MANUAL",
    }, "non-cycle-exit abandonment"],
  ])("rejects an ACTIVE validation terminal with %s", async (lease) => {
    const validationFailure = "npm run lint exited 1\nFailed to load plugin 'react-hooks' declared in eslint-config-next: Cannot find module 'eslint-plugin-react-hooks'"
    const orchestrator = {
      state: {
        read: () => ({
          ownerTouchCounters: {
            OWNER_OPERATION_TOUCH_COUNT: 0, OWNER_CREDENTIAL_TOUCH_COUNT: 0,
            OWNER_DIAGNOSTIC_TOUCH_COUNT: 0, OWNER_ROUTINE_DECISION_COUNT: 0,
            OWNER_ROUTINE_CONTACT_COUNT: 0,
          },
          executions: { "12": {
            outcomeId: "12", fencingToken: 72, lease,
            checkpoint: {
              sequence: 86, state: "FAILED_TERMINAL",
              detail: "VALIDATION_REMEDIATION_EXHAUSTED",
            },
            metadata: { validationFailure },
          } },
        }),
        reopenValidationInfrastructureWall: vi.fn(),
      },
    }

    await expect(recoverValidationInfrastructureWall({ orchestrator }))
      .rejects.toMatchObject({ code: "HERMES_VALIDATION_RECOVERY_CANDIDATE_WALL" })
    expect(orchestrator.state.reopenValidationInfrastructureWall).not.toHaveBeenCalled()
  })

  it("recovers one contained external-tool wall through the supported CLI path", () => {
    const recover = vi.fn(() => ({ checkpointSequence: 8 }))
    const root = process.cwd()
    const orchestrator = {
      runtimeRoot: root,
      state: {
        read: () => ({ executions: { "5": {
          outcomeId: "5", fencingToken: 20,
          lease: { status: "ACTIVE", holderId: "stopped-holder" },
          checkpoint: { state: "RETRYABLE_WALL", detail: "APP_SERVER_EXTERNAL_TOOL_WALL" },
        } } }),
        recoverExternalToolWall: recover,
      },
    }
    const read = vi.spyOn(fs, "existsSync")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
    expect(recoverExternalToolWall({ orchestrator })).toMatchObject({
      result: "RECOVERED", outcomeId: "5", checkpointSequence: 8,
    })
    expect(recover).toHaveBeenCalledWith(expect.objectContaining({
      expectedFencingToken: 20, expectedHolderId: "stopped-holder", activationDisabled: true,
    }))
    read.mockRestore()
  })

  it("recovers one exact post-merge cleanup wall through the supported CLI path", () => {
    const recover = vi.fn(() => ({ checkpointSequence: 9 }))
    const root = process.cwd()
    const orchestrator = {
      runtimeRoot: root,
      state: {
        read: () => ({ executions: { "5": {
          outcomeId: "5", fencingToken: 21,
          lease: { status: "ACTIVE", holderId: "stopped-holder" },
          checkpoint: { state: "PR_MERGED", detail: "PR #440 merged" },
          metadata: { prNumber: 440, headRefOid: "a".repeat(40), mergeSha: "b".repeat(40) },
        } } }),
        recoverPostMergeCleanupWall: recover,
      },
    }
    const read = vi.spyOn(fs, "existsSync").mockReturnValue(false)
    expect(recoverPostMergeCleanupWall({ orchestrator })).toMatchObject({
      result: "RECOVERED", outcomeId: "5", checkpointSequence: 9,
    })
    expect(recover).toHaveBeenCalledWith(expect.objectContaining({
      expectedFencingToken: 21, expectedHolderId: "stopped-holder", activationDisabled: true,
    }))
    read.mockRestore()
  })

  it("verifies cleanup before reopening one exhausted terminal post-merge wall", async () => {
    const candidate = {
      outcomeId: "5",
      fencingToken: 22,
      lease: { status: "RELEASED" },
      checkpoint: {
        sequence: 12,
        state: "FAILED_TERMINAL",
        detail: "POST_MERGE_CLEANUP_REMEDIATION_EXHAUSTED",
      },
      metadata: {
        outcome: exactIssue911Outcome(5, "GOAL-0005"),
        branch: "codex/hermes-goal-0005-5",
        worktreePath: "C:\\owned\\hermes-goal-0005-5",
        prNumber: 440,
        headRefOid: "a".repeat(40),
        mergeSha: "b".repeat(40),
        postMergeCleanupRetryCount: 3,
      },
    }
    const beginRecovery = vi.fn(() => ({ checkpointSequence: 13 }))
    const finalizeRecovery = vi.fn(() => ({ checkpointSequence: 14 }))
    const orchestrator = {
      runtimeRoot: process.cwd(),
      state: {
        read: vi.fn().mockReturnValue({
          ownerTouchCounters: {
            OWNER_OPERATION_TOUCH_COUNT: 0,
            OWNER_CREDENTIAL_TOUCH_COUNT: 0,
            OWNER_DIAGNOSTIC_TOUCH_COUNT: 0,
            OWNER_ROUTINE_DECISION_COUNT: 0,
            OWNER_ROUTINE_CONTACT_COUNT: 0,
          },
          executions: { "5": candidate },
        }),
        beginTerminalPostMergeCleanupRecovery: beginRecovery,
        finalizeTerminalPostMergeCleanupRecovery: finalizeRecovery,
      },
    }
    const lifecycle = {
      inspectPullRequest: vi.fn(async () => ({
        state: "MERGED",
        baseRefName: "main",
        headRefName: candidate.metadata.branch,
        headRefOid: candidate.metadata.headRefOid,
        mergeCommit: { oid: candidate.metadata.mergeSha },
        unresolvedThreadCount: 0,
      })),
      verifyOriginMainContains: vi.fn(async () => true),
      resumeOwnedWorktree: vi.fn(async () => ({ resumed: true })),
      removeTerminalRecoveryDependencies: vi.fn(async () => ({
        removed: true,
        headRefOid: candidate.metadata.headRefOid,
      })),
      cleanupOwnedWorktree: vi.fn(async () => ({ cleaned: true })),
    }
    const projectCheckpoint = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("temporary dns"), { code: "ENOTFOUND" }))
      .mockResolvedValue(true)
    const authorizeProjection = vi.fn(async () => ({ eventId: 91, replayed: false }))
    const recoverOutcome = vi.fn(async () => true)
    const read = vi.spyOn(fs, "existsSync").mockImplementation((target) =>
      target === candidate.metadata.worktreePath)

    try {
      await expect(recoverTerminalPostMergeCleanupWall({
        orchestrator, lifecycle, projectCheckpoint, recoverOutcome, authorizeProjection,
        projectionSleep: async () => {},
      })).resolves.toMatchObject({
        result: "RECOVERED",
        outcomeId: "5",
        prNumber: 440,
        mergeSha: "b".repeat(40),
        checkpointSequence: 14,
      })
      expect(lifecycle.cleanupOwnedWorktree).toHaveBeenCalledWith({
        branch: candidate.metadata.branch,
        worktreePath: candidate.metadata.worktreePath,
        mergeCommitSha: candidate.metadata.mergeSha,
        expectedHeadSha: candidate.metadata.headRefOid,
      })
      expect(beginRecovery).toHaveBeenCalledBefore(lifecycle.cleanupOwnedWorktree)
      expect(authorizeProjection).toHaveBeenCalledBefore(beginRecovery)
      expect(authorizeProjection).toHaveBeenCalledWith(expect.objectContaining({
        recoveryKind: "terminal-cleanup",
        runtimeAttempt: 22,
      }))
      expect(finalizeRecovery).toHaveBeenCalledAfter(lifecycle.cleanupOwnedWorktree)
      expect(projectCheckpoint).toHaveBeenCalledWith({
        outcomeId: 5,
        attempt: 22,
        workContract: {
          id: "issue-911-runtime-reliability-evidence.v1",
          digest: expect.stringMatching(/^[0-9a-f]{64}$/),
          version: "hermes-work-contract.v1",
          repository: "bsvalues/terragroq",
          lane: "operator-objective",
          allowedFiles: ["docs/reports/WO-OUTCOME-762-911-runtime-reliability.md"],
          validators: ["git diff --check", "npx vitest run tests/hermes-work-contract.test.ts"],
          projection: { issueNumber: 911, completionOwned: false },
          delivery: {
            authorityLevel: "A2_WRITE_OWN", allowedActions: ["implement"],
            commitAllowed: true, tagAllowed: false, pushAllowed: true,
          },
        },
        executionBinding: {
          userId: "user-911", outcomeKey: "goal:GOAL-0005", expectedVersion: 3,
          executionBinding: "execution-5", leaseToken: "lease-5",
          leaseHolder: "hermes-bridge", acquisitionKey: "acquisition-5", fencingToken: 2,
        },
        checkpoint: {
          sequence: 14,
          state: "POST_MERGE_CLEANUP_RECOVERED",
          detail: "PR #440",
          metadata: {
            prNumber: 440,
            headRefOid: candidate.metadata.headRefOid,
            mergeSha: candidate.metadata.mergeSha,
            terminalCleanupRecoveryProofDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
            workContractId: "issue-911-runtime-reliability-evidence.v1",
            workContractDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
          },
        },
      })
      expect(projectCheckpoint).toHaveBeenCalledTimes(2)
      expect(recoverOutcome).toHaveBeenCalledWith({
        outcomeId: 5,
        prNumber: 440,
        reviewedHeadSha: candidate.metadata.headRefOid,
        mergeSha: candidate.metadata.mergeSha,
        proofDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      })
    } finally {
      read.mockRestore()
    }
  })

  it("routes reviewed-merge repository verification through the resident AEGIS backend", async () => {
    const runtimeRoot = path.join(os.tmpdir(), "hermes-reviewed-merge-aegis")
    const executionBackend = { isLocal: false }
    const environment = {
      WILLIAMOS_CODEX_EXEC_NODE: "aegis",
      WILLIAMOS_AEGIS_REPOSITORY_ROOT: "/home/bs/terragroq",
    }
    const selectExecutionBackend = vi.fn(() => executionBackend)
    const createLifecycle = vi.fn(() => ({}))
    const orchestrator = {
      runtimeRoot,
      state: {
        read: () => ({
          ownerTouchCounters: {
            OWNER_OPERATION_TOUCH_COUNT: 0,
            OWNER_CREDENTIAL_TOUCH_COUNT: 0,
            OWNER_DIAGNOSTIC_TOUCH_COUNT: 0,
            OWNER_ROUTINE_DECISION_COUNT: 0,
            OWNER_ROUTINE_CONTACT_COUNT: 0,
          },
          executions: {},
        }),
      },
    }

    await expect(recoverReviewedMerge({
      orchestrator,
      environment,
      selectExecutionBackend,
      createLifecycle,
    })).rejects.toMatchObject({ code: "HERMES_REVIEW_RECOVERY_CANDIDATE_WALL" })
    expect(selectExecutionBackend).toHaveBeenCalledOnce()
    expect(selectExecutionBackend).toHaveBeenCalledWith(environment)
    expect(createLifecycle).toHaveBeenCalledWith({
      workspaceRoot: process.cwd(),
      ownedWorktreeRoot: path.join(runtimeRoot, "worktrees"),
      executionBackend,
    })
  })

  it("settles the exact expired active cleanup epoch without acquiring fence seven", async () => {
    const outcome = exactIssue911Outcome(5, "GOAL-0005")
    const resolvedBinding = {
      ...outcome.queueBinding,
      expectedVersion: 8,
      fencingToken: 6,
      activeWorkOrderId: 51,
      reviewRecoveryResumeState: "REVIEW_REMEDIATION_RECOVERY_RECLAIMED",
      reviewRecoverySourceExpectedVersion: 4,
      reviewRecoverySourceFencingToken: 2,
      reviewRecoverySourceRuntimeAttempt: 5,
      reviewRecoveryReclaimEventId: 961,
      reviewRecoveryReclaimPayloadDigest: "c".repeat(64),
      reviewRecoveryStaleReacquisition: {
        disposition: "RECLAIMED", priorExpectedVersion: 6, priorFencingToken: 4,
        expectedVersion: 7, fencingToken: 5, receiptLatestFencingToken: 5,
        lifecycleReason: "STALE_LEASE_RECOVERED",
        leaseExpiresAt: "2026-08-21T06:30:00.000Z",
        checkpointDigest: "d".repeat(64),
      },
      reviewRecoveryStaleContinuation: {
        disposition: "RECLAIMED", priorExpectedVersion: 7, priorFencingToken: 5,
        expectedVersion: 8, fencingToken: 6, receiptLatestFencingToken: 6,
        lifecycleReason: "STALE_LEASE_RECOVERED",
        priorLeaseExpiresAt: "2026-08-21T06:30:00.000Z",
        leaseExpiresAt: "2026-08-21T06:45:00.000Z",
        checkpointDigest: "e".repeat(64),
      },
    }
    const binding = { ...resolvedBinding, expectedVersion: 7, fencingToken: 5 }
    delete (binding as any).reviewRecoveryStaleReacquisition
    delete (binding as any).reviewRecoveryStaleContinuation
    outcome.queueBinding = binding
    const candidate = {
      outcomeId: "5", fencingToken: 9,
      lease: {
        status: "ACTIVE", holderId: "hermes-bridge",
        acquiredAt: "2026-08-21T05:00:00.000Z",
        expiresAt: "2026-08-21T06:00:00.000Z",
        abandonedAt: "2026-08-21T06:00:00.000Z",
        abandonReason: "HERMES_RUNTIME_PROJECTION_WALL",
      },
      checkpoint: {
        sequence: 46, state: "POST_MERGE_CLEANUP_RETRY",
        detail: "HERMES_POST_MERGE_CLEANUP_WALL", recordedAt: "2026-08-21T05:30:00.000Z",
      },
      metadata: {
        outcome, postMergeCleanupRetryCount: 1, postMergeCleanupCauseCode: null,
        reviewRecoveryProofDigest: "f".repeat(64), prNumber: 929,
        branch: "codex/hermes-goal-0005-5", worktreePath: "C:\\owned\\hermes-goal-0005-5",
        headRefOid: "a".repeat(40), mergeSha: "b".repeat(40),
      },
    }
    const calls: string[] = []
    const orchestrator = {
      runtimeRoot: process.cwd(),
      state: {
        read: vi.fn(() => ({
          ownerTouchCounters: {
            OWNER_OPERATION_TOUCH_COUNT: 0, OWNER_CREDENTIAL_TOUCH_COUNT: 0,
            OWNER_DIAGNOSTIC_TOUCH_COUNT: 0, OWNER_ROUTINE_DECISION_COUNT: 0,
            OWNER_ROUTINE_CONTACT_COUNT: 0,
          },
          executions: { "5": candidate },
        })),
        completeActivePostMergeCleanupRecovery: vi.fn(() => {
          calls.push("local-complete")
          return { checkpointSequence: 47 }
        }),
      },
    }
    const lifecycle = {
      repository: "bsvalues/terragroq",
      verifyRepositoryOrigin: vi.fn(async () => true),
      inspectPullRequest: vi.fn(async () => ({
        state: "MERGED", baseRefName: "main", headRefName: candidate.metadata.branch,
        headRefOid: candidate.metadata.headRefOid, mergeCommit: { oid: candidate.metadata.mergeSha },
        unresolvedThreadCount: 0, reviewed: true, reviewCompleted: true,
      })),
      inspectPullRequestFiles: vi.fn(async () => [
        "docs/reports/WO-OUTCOME-762-911-runtime-reliability.md",
      ]),
      verifyOriginMainContains: vi.fn(async () => true),
      cleanupOwnedWorktree: vi.fn(async () => { calls.push("cleanup"); return { cleaned: true } }),
    }
    const resolveProvenance = vi.fn(async () => {
      calls.push("resolve")
      return { alreadyStaleReacquired: true, binding: resolvedBinding }
    })
    const verifyContinuation = vi.fn(async () => { calls.push("verify"); return true })
    const resolveSettlement = vi.fn(async () => null)
    const authorizeCleanup = vi.fn(async () => {
      calls.push("authorize")
      return { eventId: 970, payloadDigest: "3".repeat(64), confirmed: false, settled: false }
    })
    const confirmCleanup = vi.fn(async () => {
      calls.push("confirm")
      return { eventId: 971, payloadDigest: "4".repeat(64) }
    })
    const settleCleanup = vi.fn(async () => {
      calls.push("settle")
      return {
        checkpointEventId: 972, queueVersion: 9, fencingToken: 6,
        settlementEventId: 973, payloadDigest: "5".repeat(64), replayed: false,
        completionEventId: 974, completionPayloadDigest: "6".repeat(64),
      }
    })
    const exists = vi.spyOn(fs, "existsSync").mockReturnValue(false)
    try {
      lifecycle.repository = "other/repository"
      await expect(recoverActivePostMergeCleanupWall({
        orchestrator, lifecycle, now: () => new Date("2026-08-21T07:00:00.000Z"),
        resolveProvenance, verifyContinuation, resolveSettlement,
        authorizeCleanup, confirmCleanup, settleCleanup,
      })).rejects.toMatchObject({ code: "HERMES_ACTIVE_POST_MERGE_CLEANUP_REPOSITORY_WALL" })
      expect(calls).toEqual([])
      expect(authorizeCleanup).not.toHaveBeenCalled()
      expect(lifecycle.cleanupOwnedWorktree).not.toHaveBeenCalled()
      expect(orchestrator.state.completeActivePostMergeCleanupRecovery).not.toHaveBeenCalled()
      lifecycle.repository = "bsvalues/terragroq"
      calls.length = 0

      lifecycle.inspectPullRequestFiles.mockResolvedValueOnce([".github/workflows/host.yml"])
      await expect(recoverActivePostMergeCleanupWall({
        orchestrator, lifecycle, now: () => new Date("2026-08-21T07:00:00.000Z"),
        resolveProvenance, verifyContinuation, resolveSettlement,
        authorizeCleanup, confirmCleanup, settleCleanup,
      })).rejects.toMatchObject({ code: "HERMES_ACTIVE_POST_MERGE_CLEANUP_CONTRACT_WALL" })
      expect(calls).toEqual([])
      expect(authorizeCleanup).not.toHaveBeenCalled()
      expect(lifecycle.cleanupOwnedWorktree).not.toHaveBeenCalled()
      calls.length = 0

      await expect(recoverActivePostMergeCleanupWall({
        orchestrator, lifecycle, now: () => new Date("2026-08-21T07:00:00.000Z"),
        resolveProvenance, verifyContinuation, resolveSettlement,
        authorizeCleanup, confirmCleanup, settleCleanup,
      })).resolves.toMatchObject({
        result: "COMPLETE", outcomeId: "5", checkpointSequence: 47,
        queueVersion: 9, fencingToken: 6,
      })
      expect(calls).toEqual(["resolve", "verify", "authorize", "cleanup", "confirm", "settle", "local-complete"])
      expect(settleCleanup).toHaveBeenCalledWith(expect.objectContaining({
        expectedVersion: 8, fencingToken: 6, checkpointSequence: 47,
      }))
      expect(orchestrator.state.completeActivePostMergeCleanupRecovery).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedWorktreePath: candidate.metadata.worktreePath,
          expectedPostMergeCleanupRetryCount: 1,
          expectedPostMergeCleanupCauseCode: null,
          expectedOutcomeDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      )
      expect(calls).not.toContain("acquire")

      const durableSettlement = {
        executionBinding: resolvedBinding,
        queueVersion: 9, fencingToken: 6, replayed: true,
        authorizationEventId: 970, confirmationEventId: 971,
        settlementEventId: 973, completionEventId: 974,
        authorizationPayloadDigest: "3".repeat(64),
        confirmationPayloadDigest: "4".repeat(64), payloadDigest: "5".repeat(64),
        completionPayloadDigest: "6".repeat(64),
      }
      const partialSettlement = { ...durableSettlement,
        executionBinding: { ...resolvedBinding, reviewRecoveryStaleContinuation: undefined } }
      calls.length = 0
      resolveSettlement.mockResolvedValueOnce(partialSettlement)
      const completedCalls = orchestrator.state.completeActivePostMergeCleanupRecovery.mock.calls.length
      await expect(recoverActivePostMergeCleanupWall({
        orchestrator, lifecycle, now: () => new Date("2026-08-21T07:00:00.000Z"),
        resolveProvenance, verifyContinuation, resolveSettlement,
        authorizeCleanup, confirmCleanup, settleCleanup,
      })).rejects.toMatchObject({ code: "HERMES_ACTIVE_POST_MERGE_CLEANUP_CANDIDATE_WALL" })
      expect(resolveProvenance).toHaveBeenCalledTimes(1)
      expect(orchestrator.state.completeActivePostMergeCleanupRecovery).toHaveBeenCalledTimes(completedCalls)
      expect(lifecycle.cleanupOwnedWorktree).toHaveBeenCalledTimes(1)

      calls.length = 0
      resolveSettlement.mockResolvedValueOnce(durableSettlement)
      await expect(recoverActivePostMergeCleanupWall({
        orchestrator, lifecycle, now: () => new Date("2026-08-21T07:00:00.000Z"),
        resolveProvenance, verifyContinuation, resolveSettlement,
        authorizeCleanup, confirmCleanup, settleCleanup,
      })).resolves.toMatchObject({ result: "COMPLETE", replayed: true, queueVersion: 9 })
      expect(calls).toEqual(["local-complete"])
      expect(resolveProvenance).toHaveBeenCalledTimes(1)
      expect(authorizeCleanup).toHaveBeenCalledTimes(1)
      expect(confirmCleanup).toHaveBeenCalledTimes(1)
      expect(settleCleanup).toHaveBeenCalledTimes(1)
      expect(lifecycle.cleanupOwnedWorktree).toHaveBeenCalledTimes(1)
      expect(orchestrator.state.completeActivePostMergeCleanupRecovery).toHaveBeenLastCalledWith(
        expect.objectContaining({ resolvedQueueBinding: resolvedBinding,
          completionEventId: 974, completionDigest: "6".repeat(64) }),
      )

      const baseMarkedBinding = { ...binding,
        reviewRecoveryStaleReacquisition: resolvedBinding.reviewRecoveryStaleReacquisition }
      outcome.queueBinding = baseMarkedBinding
      calls.length = 0
      resolveSettlement.mockResolvedValueOnce(durableSettlement)
      await expect(recoverActivePostMergeCleanupWall({
        orchestrator, lifecycle, now: () => new Date("2026-08-21T07:00:00.000Z"),
        resolveProvenance, verifyContinuation, resolveSettlement,
        authorizeCleanup, confirmCleanup, settleCleanup,
      })).resolves.toMatchObject({ result: "COMPLETE", replayed: true, queueVersion: 9 })
      expect(calls).toEqual(["local-complete"])
      expect(resolveProvenance).toHaveBeenCalledTimes(1)
      outcome.queueBinding = binding

      calls.length = 0
      authorizeCleanup.mockResolvedValueOnce({
        eventId: 970, confirmed: true, settled: false,
        confirmation: { eventId: 971, payloadDigest: "9".repeat(64) },
      })
      await recoverActivePostMergeCleanupWall({
        orchestrator, lifecycle, now: () => new Date("2026-08-21T07:00:00.000Z"),
        resolveProvenance, verifyContinuation, resolveSettlement,
        authorizeCleanup, confirmCleanup, settleCleanup,
      })
      expect(calls).toEqual(["resolve", "verify", "settle", "local-complete"])
      expect(authorizeCleanup).toHaveBeenCalledTimes(2)
      expect(lifecycle.cleanupOwnedWorktree).toHaveBeenCalledTimes(1)
      expect(confirmCleanup).toHaveBeenCalledTimes(1)

      const completed = {
        ...candidate,
        lease: { ...candidate.lease, status: "RELEASED", releaseReason: "COMPLETE",
          releasedAt: "2026-08-21T07:00:00.000Z" },
        checkpoint: { sequence: 47, state: "COMPLETE", detail: "PR #929 merged, verified, and cleaned" },
        metadata: {
          ...candidate.metadata,
          postMergeCleanupRetryCount: 0, postMergeCleanupCauseCode: null,
          outcome: { ...outcome, status: "complete", queueBinding: { ...resolvedBinding, expectedVersion: 9 } },
          activePostMergeCleanupProofDigest: "2".repeat(64),
          activePostMergeCleanupAuthorizationEventId: 970,
          activePostMergeCleanupAuthorizationDigest: "3".repeat(64),
          activePostMergeCleanupConfirmationEventId: 971,
          activePostMergeCleanupConfirmationDigest: "4".repeat(64),
          activePostMergeCleanupSettlementEventId: 973,
          activePostMergeCleanupSettlementDigest: "5".repeat(64),
          activePostMergeCleanupCompletionEventId: 974,
          activePostMergeCleanupCompletionDigest: "6".repeat(64),
        },
      }
      orchestrator.state.read.mockReturnValue({
        ownerTouchCounters: {
          OWNER_OPERATION_TOUCH_COUNT: 0, OWNER_CREDENTIAL_TOUCH_COUNT: 0,
          OWNER_DIAGNOSTIC_TOUCH_COUNT: 0, OWNER_ROUTINE_DECISION_COUNT: 0,
          OWNER_ROUTINE_CONTACT_COUNT: 0,
        }, executions: { "5": completed },
      })
      const verifySettlement = vi.fn(async () => ({
        queueVersion: 9, fencingToken: 6, replayed: true,
        authorizationPayloadDigest: "3".repeat(64),
        confirmationPayloadDigest: "4".repeat(64), payloadDigest: "5".repeat(64),
        completionEventId: 974, completionPayloadDigest: "6".repeat(64),
      }))
      await expect(recoverActivePostMergeCleanupWall({
        orchestrator, lifecycle, verifySettlement,
        now: () => new Date("2026-08-21T07:00:00.000Z"),
      })).resolves.toMatchObject({ result: "COMPLETE", replayed: true, queueVersion: 9, fencingToken: 6 })
      expect(verifySettlement).toHaveBeenCalledOnce()
      expect(lifecycle.cleanupOwnedWorktree).toHaveBeenCalledTimes(1)
      expect(settleCleanup).toHaveBeenCalledTimes(2)

      orchestrator.state.read.mockReturnValue({
        ownerTouchCounters: {
          OWNER_OPERATION_TOUCH_COUNT: 0, OWNER_CREDENTIAL_TOUCH_COUNT: 0,
          OWNER_DIAGNOSTIC_TOUCH_COUNT: 0, OWNER_ROUTINE_DECISION_COUNT: 0,
          OWNER_ROUTINE_CONTACT_COUNT: 0,
        }, executions: { "5": { ...completed,
          lease: { ...completed.lease, releaseReason: "DRIFTED" } } },
      })
      await expect(recoverActivePostMergeCleanupWall({
        orchestrator, lifecycle, verifySettlement,
        now: () => new Date("2026-08-21T07:00:00.000Z"),
      })).rejects.toMatchObject({ code: "HERMES_ACTIVE_POST_MERGE_CLEANUP_CANDIDATE_WALL" })
      expect(verifySettlement).toHaveBeenCalledOnce()
    } finally {
      exists.mockRestore()
    }
  })

  it("refuses a local reviewed-merge repository lifecycle before construction", async () => {
    const createLifecycle = vi.fn()
    await expect(recoverReviewedMerge({
      orchestrator: { runtimeRoot: os.tmpdir() },
      environment: {
        WILLIAMOS_CODEX_EXEC_NODE: "aegis",
        WILLIAMOS_AEGIS_REPOSITORY_ROOT: "/home/bs/terragroq",
      },
      selectExecutionBackend: () => ({ isLocal: true }),
      createLifecycle,
    })).rejects.toMatchObject({ code: "HERMES_RESIDENT_LOCAL_BACKEND_WALL" })
    expect(createLifecycle).not.toHaveBeenCalled()
  })

  it("verifies and finalizes one exact reviewed merge after remediation exhaustion", async () => {
    const candidate = {
      outcomeId: "7",
      fencingToken: 28,
      lease: { status: "RELEASED" },
      checkpoint: {
        sequence: 31,
        state: "FAILED_TERMINAL",
        detail: "REVIEW_REMEDIATION_EXHAUSTED",
      },
      metadata: {
        outcome: exactIssue911Outcome(7, "GOAL-0007"),
        branch: "codex/hermes-goal-0003-7",
        prNumber: 447, headRefOid: "a".repeat(40), mergeSha: null as string | null,
        reviewRecoveryProofDigest: null as string | null,
        reviewProjectionReconciledFromSequence: null as number | null,
      },
    }
    const beginRecovery = vi.fn(() => ({ checkpointSequence: 32 }))
    const recordMerge = vi.fn(() => ({ checkpointSequence: 33 }))
    const finalizeRecovery = vi.fn(() => ({ checkpointSequence: 34 }))
    const reconcileRecoveryProjection = vi.fn(() => ({ checkpointSequence: 35 }))
    const verifyProjectionCollision = vi.fn(async () => true)
    const cycle = vi.fn(async () => ({ result: "COMPLETE" }))
    const orchestrator = {
      state: {
        read: () => ({
          ownerTouchCounters: {
            OWNER_OPERATION_TOUCH_COUNT: 0, OWNER_CREDENTIAL_TOUCH_COUNT: 0,
            OWNER_DIAGNOSTIC_TOUCH_COUNT: 0, OWNER_ROUTINE_DECISION_COUNT: 0,
            OWNER_ROUTINE_CONTACT_COUNT: 0,
          },
          executions: { "7": candidate },
        }),
        beginReviewRemediationRecovery: beginRecovery,
        recordReviewRemediationMerge: recordMerge,
        finalizeReviewRemediationRecovery: finalizeRecovery,
        reconcileReviewRemediationProjection: reconcileRecoveryProjection,
      },
      cycle,
    }
    const lifecycle = {
      inspectPullRequest: vi.fn(async () => ({
        state: "MERGED", baseRefName: "main",
        headRefName: "codex/hermes-goal-0003-7", unresolvedThreadCount: 0,
        checksGreen: true, reviewed: true, headRefOid: "b".repeat(40),
        mergeCommit: { oid: "c".repeat(40) },
      })),
      verifyOriginMainContains: vi.fn(async () => true),
    }
    const projectCheckpoint = vi.fn(async () => ({ workOrderId: 77 }))
    const recoverOutcome = vi.fn(async () => true)
    const authorizeProjection = vi.fn(async () => ({ eventId: 92, replayed: false }))
    const authorizedOutcome = candidate.metadata.outcome

    candidate.metadata.outcome = { ...authorizedOutcome, verifiedQueueWorkContract: undefined } as any
    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome, verifyProjectionCollision,
      authorizeProjection,
    })).rejects.toMatchObject({ code: "HERMES_WORK_CONTRACT_WALL" })
    expect(beginRecovery).not.toHaveBeenCalled()
    expect(projectCheckpoint).not.toHaveBeenCalled()

    candidate.metadata.outcome = {
      ...authorizedOutcome,
      queueBinding: { ...authorizedOutcome.queueBinding, leaseToken: "" },
    }
    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome, verifyProjectionCollision,
      authorizeProjection,
    })).rejects.toMatchObject({ code: "OUTCOME_WORK_ORDER_AUTHORIZATION_WALL" })
    expect(beginRecovery).not.toHaveBeenCalled()
    expect(projectCheckpoint).not.toHaveBeenCalled()
    candidate.metadata.outcome = authorizedOutcome

    beginRecovery.mockImplementationOnce(() => {
      throw Object.assign(new Error("stale fence"), { code: "FENCING_TOKEN_CONFLICT" })
    })
    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome, verifyProjectionCollision,
      authorizeProjection,
    })).rejects.toMatchObject({ code: "FENCING_TOKEN_CONFLICT" })
    expect(projectCheckpoint).not.toHaveBeenCalled()
    expect(recoverOutcome).not.toHaveBeenCalled()
    expect(cycle).not.toHaveBeenCalled()

    projectCheckpoint.mockRejectedValueOnce(new Error("simulated projection crash"))
    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome, verifyProjectionCollision,
      authorizeProjection,
    })).rejects.toThrow("simulated projection crash")
    expect(recoverOutcome).not.toHaveBeenCalled()
    expect(finalizeRecovery).not.toHaveBeenCalled()
    candidate.checkpoint = {
      sequence: 33,
      state: "PR_MERGED",
      detail: "Recovered reviewed PR #447",
    }
    candidate.metadata.headRefOid = "b".repeat(40)
    candidate.metadata.mergeSha = "c".repeat(40)
    candidate.metadata.reviewRecoveryPriorHeadRefOid = "a".repeat(40)
    candidate.metadata.reviewRecoveryProofDigest = beginRecovery.mock.calls[1][0].proofDigest

    cycle.mockRejectedValueOnce(new Error("simulated cycle crash"))
    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome, verifyProjectionCollision,
      authorizeProjection,
    })).rejects.toThrow("simulated cycle crash")
    expect(projectCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      outcomeId: 7,
      attempt: 28,
      workContract: {
        id: "issue-911-runtime-reliability-evidence.v1",
        digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        version: "hermes-work-contract.v1",
        repository: "bsvalues/terragroq",
        lane: "operator-objective",
        allowedFiles: ["docs/reports/WO-OUTCOME-762-911-runtime-reliability.md"],
        validators: ["git diff --check", "npx vitest run tests/hermes-work-contract.test.ts"],
        projection: { issueNumber: 911, completionOwned: false },
        delivery: {
          authorityLevel: "A2_WRITE_OWN", allowedActions: ["implement"],
          commitAllowed: true, tagAllowed: false, pushAllowed: true,
        },
      },
      executionBinding: {
        userId: "user-911", outcomeKey: "goal:GOAL-0007", expectedVersion: 3,
        executionBinding: "execution-7", leaseToken: "lease-7",
        leaseHolder: "hermes-bridge", acquisitionKey: "acquisition-7", fencingToken: 2,
      },
      checkpoint: expect.objectContaining({
        sequence: 33, state: "PR_MERGED",
        metadata: expect.objectContaining({
          headRefOid: "b".repeat(40), mergeSha: "c".repeat(40),
          workContractId: "issue-911-runtime-reliability-evidence.v1",
          workContractDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      }),
    }))
    expect(recoverOutcome).toHaveBeenCalledWith(expect.objectContaining({
      outcomeId: 7, prNumber: 447,
      reviewedHeadSha: "b".repeat(40), mergeSha: "c".repeat(40),
    }))
    expect(beginRecovery).toHaveBeenCalledWith(expect.objectContaining({
      expectedFencingToken: 28,
      expectedPriorHeadRefOid: "a".repeat(40),
      headRefOid: "b".repeat(40),
      proofDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    }))
    expect(authorizeProjection.mock.invocationCallOrder[0])
      .toBeLessThan(beginRecovery.mock.invocationCallOrder[0])
    expect(finalizeRecovery).toHaveBeenCalledWith(expect.objectContaining({
      expectedFencingToken: 28,
      headRefOid: "b".repeat(40),
      proofDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    }))
    expect(cycle).toHaveBeenCalledWith({
      outcome: expect.objectContaining({ id: 7, ref: "GOAL-0007" }),
    })
    expect(projectCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      workContract: expect.objectContaining({
        id: "issue-911-runtime-reliability-evidence.v1",
        allowedFiles: ["docs/reports/WO-OUTCOME-762-911-runtime-reliability.md"],
      }),
      executionBinding: expect.objectContaining({
        outcomeKey: "goal:GOAL-0007", executionBinding: "execution-7", fencingToken: 2,
      }),
      checkpoint: expect.objectContaining({
        sequence: 34,
        state: "REVIEW_REMEDIATION_RECOVERED",
        detail: "REVIEW_REMEDIATION_EXHAUSTED",
        metadata: expect.objectContaining({
          workContractId: "issue-911-runtime-reliability-evidence.v1",
          workContractDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      }),
    }))

    candidate.lease.status = "ABANDONED"
    candidate.checkpoint = {
      sequence: 34,
      state: "REVIEW_REMEDIATION_RECOVERED",
      detail: "REVIEW_REMEDIATION_EXHAUSTED",
    }
    candidate.metadata.headRefOid = "b".repeat(40)
    candidate.metadata.mergeSha = "c".repeat(40)
    candidate.metadata.reviewRecoveryPriorHeadRefOid = "a".repeat(40)
    candidate.metadata.reviewProjectionReconciledFromSequence = null
    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome, verifyProjectionCollision,
      authorizeProjection,
    })).resolves.toMatchObject({
      result: "COMPLETE", outcomeId: "7", prNumber: 447,
      mergeSha: "c".repeat(40), checkpointSequence: 34,
    })
    expect(projectCheckpoint).toHaveBeenLastCalledWith(expect.objectContaining({
      checkpoint: expect.objectContaining({
        sequence: 34,
        state: "REVIEW_REMEDIATION_RECOVERED",
        detail: "REVIEW_REMEDIATION_EXHAUSTED",
      }),
    }))

    projectCheckpoint.mockRejectedValueOnce(Object.assign(
      new Error("non-legacy sequence collision"),
      { code: "OUTCOME_PROJECTION_IDEMPOTENCY_CONFLICT" },
    ))
    verifyProjectionCollision.mockResolvedValueOnce(false)
    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome, verifyProjectionCollision,
      authorizeProjection,
    })).rejects.toMatchObject({ code: "OUTCOME_PROJECTION_IDEMPOTENCY_CONFLICT" })
    expect(reconcileRecoveryProjection).not.toHaveBeenCalled()

    projectCheckpoint.mockRejectedValueOnce(Object.assign(
      new Error("verified legacy sequence collision"),
      { code: "OUTCOME_PROJECTION_IDEMPOTENCY_CONFLICT" },
    ))
    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome, verifyProjectionCollision,
      authorizeProjection,
    })).resolves.toMatchObject({ result: "COMPLETE", checkpointSequence: 35 })
    expect(beginRecovery).toHaveBeenCalledTimes(2)
    expect(recordMerge).toHaveBeenCalledOnce()
    expect(finalizeRecovery).toHaveBeenCalledOnce()
    expect(reconcileRecoveryProjection).toHaveBeenCalledWith(expect.objectContaining({
      expectedCheckpointSequence: 34,
      expectedFencingToken: 28,
      proofDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    }))
    expect(verifyProjectionCollision).toHaveBeenCalledWith(expect.objectContaining({
      outcomeId: 7,
      attempt: 28,
      checkpointSequence: 34,
      checkpointDetail: "Recovered reviewed PR #447",
    }))
    expect(cycle).toHaveBeenCalledTimes(3)
    expect(cycle).toHaveBeenLastCalledWith({
      outcome: expect.objectContaining({ id: 7, ref: "GOAL-0007" }),
    })

    candidate.checkpoint.sequence = 35
    candidate.metadata.reviewProjectionReconciledFromSequence = 34
    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome, verifyProjectionCollision,
      authorizeProjection,
    })).resolves.toMatchObject({ result: "COMPLETE", checkpointSequence: 35 })
    expect(reconcileRecoveryProjection).toHaveBeenCalledOnce()
    expect(cycle).toHaveBeenCalledTimes(4)
    expect(projectCheckpoint).toHaveBeenCalledTimes(8)
    expect(recoverOutcome).toHaveBeenCalledTimes(5)
    expect(recoverOutcome).toHaveBeenLastCalledWith(expect.objectContaining({
      proofDigest: beginRecovery.mock.calls[0][0].proofDigest,
    }))
  })

  it("replays the persisted PR_MERGED sequence 44 with exact authority bindings", async () => {
    const outcome = exactIssue911Outcome(27, "GOAL-0023")
    const reviewedHeadSha = "b".repeat(40)
    const mergeSha = "c".repeat(40)
    const proofDigest = createHash("sha256").update(JSON.stringify({
      outcomeId: 27,
      prNumber: 929,
      reviewedHeadSha,
      mergeSha,
      unresolvedThreadCount: 0,
      reviewMode: "DIRECT",
      checksGreen: true,
      reviewed: true,
      remediationProof: [],
    })).digest("hex")
    const candidate = {
      outcomeId: "27", fencingToken: 5,
      lease: { status: "RELEASED" },
      checkpoint: { sequence: 44, state: "PR_MERGED", detail: "Recovered reviewed PR #929" },
      metadata: {
        outcome, branch: "codex/hermes-goal-0023-27", prNumber: 929,
        headRefOid: reviewedHeadSha, mergeSha, reviewRecoveryPriorHeadRefOid: "a".repeat(40),
        reviewRecoveryProofDigest: proofDigest,
      },
    }
    const beginRecovery = vi.fn()
    const recordMerge = vi.fn()
    const finalizeRecovery = vi.fn(() => ({ checkpointSequence: 45 }))
    const cycle = vi.fn(async () => ({ result: "COMPLETE" }))
    const orchestrator = {
      state: {
        read: () => ({
          ownerTouchCounters: {
            OWNER_OPERATION_TOUCH_COUNT: 0, OWNER_CREDENTIAL_TOUCH_COUNT: 0,
            OWNER_DIAGNOSTIC_TOUCH_COUNT: 0, OWNER_ROUTINE_DECISION_COUNT: 0,
            OWNER_ROUTINE_CONTACT_COUNT: 0,
          },
          executions: { "27": candidate },
        }),
        beginReviewRemediationRecovery: beginRecovery,
        recordReviewRemediationMerge: recordMerge,
        finalizeReviewRemediationRecovery: finalizeRecovery,
      },
      cycle,
    }
    const lifecycle = {
      inspectPullRequest: vi.fn(async () => ({
        state: "MERGED", baseRefName: "main", headRefName: candidate.metadata.branch,
        headRefOid: reviewedHeadSha, mergeCommit: { oid: mergeSha }, unresolvedThreadCount: 0,
        checksGreen: true, reviewed: true,
      })),
      inspectReviewRemediationClaims: vi.fn(async () => []),
      verifyOriginMainContains: vi.fn(async () => true),
    }
    const projectCheckpoint = vi.fn(async () => ({ workOrderId: 27 }))
    const authorizeProjection = vi.fn(async () => ({ eventId: 956, replayed: false }))
    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, authorizeProjection,
      recoverOutcome: vi.fn(async () => true),
    })).resolves.toMatchObject({ result: "COMPLETE", checkpointSequence: 45 })
    expect(beginRecovery).not.toHaveBeenCalled()
    expect(recordMerge).not.toHaveBeenCalled()
    expect(authorizeProjection).toHaveBeenCalledOnce()
    expect(authorizeProjection).toHaveBeenCalledWith(expect.objectContaining({
      outcomeId: 27,
      recoveryKind: "review-remediation",
      runtimeAttempt: 5,
      executionBinding: expect.objectContaining({
        outcomeKey: "goal:GOAL-0023", acquisitionKey: "acquisition-27", fencingToken: 2,
      }),
      prNumber: 929, reviewedHeadSha, mergeSha, proofDigest,
    }))
    expect(authorizeProjection.mock.invocationCallOrder[0])
      .toBeLessThan(projectCheckpoint.mock.invocationCallOrder[0])
    expect(projectCheckpoint).toHaveBeenNthCalledWith(1, expect.objectContaining({
      workContract: expect.objectContaining({ id: "issue-911-runtime-reliability-evidence.v1" }),
      executionBinding: expect.objectContaining({
        outcomeKey: "goal:GOAL-0023", acquisitionKey: expect.any(String),
      }),
      checkpoint: expect.objectContaining({
        sequence: 44, state: "PR_MERGED",
        metadata: expect.objectContaining({ reviewRecoveryProofDigest: proofDigest }),
      }),
    }))
    expect(projectCheckpoint).toHaveBeenNthCalledWith(2, expect.objectContaining({
      workContract: expect.objectContaining({ id: "issue-911-runtime-reliability-evidence.v1" }),
      executionBinding: expect.objectContaining({ outcomeKey: "goal:GOAL-0023" }),
      checkpoint: expect.objectContaining({
        sequence: 45, state: "REVIEW_REMEDIATION_RECOVERED",
        metadata: expect.objectContaining({ reviewRecoveryProofDigest: proofDigest }),
      }),
    }))
  })

  it("accepts a bounded exact-head-reviewed remediation chain for a rate-limited original review", async () => {
    const candidate = {
      outcomeId: "9",
      fencingToken: 37,
      lease: { status: "RELEASED" },
      checkpoint: {
        sequence: 28,
        state: "FAILED_TERMINAL",
        detail: "REVIEW_REMEDIATION_EXHAUSTED",
      },
      metadata: {
        outcome: exactIssue911Outcome(9, "GOAL-0005"),
        branch: "codex/hermes-goal-0005-9",
        prNumber: 464,
        headRefOid: "a".repeat(40),
        mergeSha: null,
        reviewRecoveryProofDigest: null,
        reviewRecoveryPriorHeadRefOid: null as string | null,
      },
    }
    const beginRecovery = vi.fn(() => ({ checkpointSequence: 29 }))
    const recordMerge = vi.fn(() => ({ checkpointSequence: 30 }))
    const finalizeRecovery = vi.fn(() => ({ checkpointSequence: 31 }))
    const cycle = vi.fn(async () => ({ result: "COMPLETE" }))
    const orchestrator = {
      state: {
        read: () => ({
          ownerTouchCounters: {
            OWNER_OPERATION_TOUCH_COUNT: 0, OWNER_CREDENTIAL_TOUCH_COUNT: 0,
            OWNER_DIAGNOSTIC_TOUCH_COUNT: 0, OWNER_ROUTINE_DECISION_COUNT: 0,
            OWNER_ROUTINE_CONTACT_COUNT: 0,
          },
          executions: { "9": candidate },
        }),
        beginReviewRemediationRecovery: beginRecovery,
        recordReviewRemediationMerge: recordMerge,
        finalizeReviewRemediationRecovery: finalizeRecovery,
      },
      cycle,
    }
    const remediationHead = "d".repeat(40)
    const remediationMerge = "e".repeat(40)
    const remediationPath = "docs/reports/WO-OUTCOME-762-911-runtime-reliability.md"
    const digestFor = (files: string[]) => createHash("sha256")
      .update(JSON.stringify([...files].sort())).digest("hex")
    let filesDigest = digestFor([remediationPath])
    const remediationFiles = vi.fn(async () => [remediationPath])
    const lifecycle = {
      inspectPullRequest: vi.fn(async () => ({
        state: "MERGED", baseRefName: "main",
        headRefName: "codex/hermes-goal-0005-9", unresolvedThreadCount: 0,
        checksGreen: false, reviewed: false, codeRabbitRateLimited: true,
        failedChecks: [], pendingChecks: [{ name: "CodeRabbit", state: "PENDING" }],
        headRefOid: "b".repeat(40), mergeCommit: { oid: "c".repeat(40) },
      })),
      inspectReviewRemediationClaims: vi.fn(async (number: number) => number === 464 ? [{
        threadIds: ["PRRT_review"], prNumber: 466,
        headRefOid: remediationHead, mergeSha: remediationMerge, filesDigest,
      }] : []),
      inspectRemediationPullRequest: vi.fn(async () => ({
        state: "MERGED", baseRefName: "main", unresolvedThreadCount: 0,
        checksGreen: true, reviewed: true, headRefOid: remediationHead,
        mergeCommit: { oid: remediationMerge },
      })),
      inspectPullRequestFiles: remediationFiles,
      verifyCommitAncestor: vi.fn(async () => true),
      verifyOriginMainContains: vi.fn(async () => true),
    }
    const projectCheckpoint = vi.fn(async () => ({ workOrderId: 99 }))
    const recoverOutcome = vi.fn(async () => true)
    const authorizeProjection = vi.fn(async () => ({ eventId: 93, replayed: false }))

    for (const blockedPath of [
      "docs/governance/runtime-policy.md",
      "docs/reports/nested/runtime-reliability.md",
      "docs/report/WO-OUTCOME-762-911-runtime-reliability.md",
      ".github/workflows/receipt.yml",
      "package.json",
      "docs/reports/../governance/runtime-policy.md",
      `${remediationPath}\n`,
      `${remediationPath}\r`,
      `${remediationPath}\0`,
      `${remediationPath}\t`,
      "app/components/runtime.ts\n",
      "tests/runtime.test.ts\0",
      "scripts/hermes-bridge//cli.mjs",
    ]) {
      filesDigest = digestFor([blockedPath])
      remediationFiles.mockResolvedValueOnce([blockedPath])
      await expect(recoverReviewedMerge({
        orchestrator, lifecycle, projectCheckpoint, recoverOutcome, authorizeProjection,
      })).rejects.toMatchObject({ code: "HERMES_REVIEW_RECOVERY_PROOF_WALL" })
    }

    filesDigest = digestFor(["docs/reports/different-report.md"])
    remediationFiles.mockResolvedValueOnce([remediationPath])
    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome, authorizeProjection,
    })).rejects.toMatchObject({ code: "HERMES_REVIEW_RECOVERY_PROOF_WALL" })
    expect(beginRecovery).not.toHaveBeenCalled()

    filesDigest = digestFor([remediationPath])
    cycle.mockRejectedValueOnce(new Error("simulated chained cycle crash"))
    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome, authorizeProjection,
    })).rejects.toThrow("simulated chained cycle crash")
    expect(beginRecovery).toHaveBeenCalledWith(expect.objectContaining({
      expectedFencingToken: 37,
      expectedPriorHeadRefOid: "a".repeat(40),
      headRefOid: "b".repeat(40),
      mergeSha: "c".repeat(40),
      proofDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    }))
    expect(authorizeProjection.mock.invocationCallOrder[0])
      .toBeLessThan(beginRecovery.mock.invocationCallOrder[0])
    expect(recordMerge).toHaveBeenCalledWith(expect.objectContaining({
      expectedFencingToken: 37,
      headRefOid: "b".repeat(40),
      mergeSha: "c".repeat(40),
      mergeDetail: "Recovered PR #464 through reviewed remediation chain",
      proofDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    }))
    expect(finalizeRecovery).toHaveBeenCalledWith(expect.objectContaining({
      expectedFencingToken: 37,
      mergeDetail: "Recovered PR #464 through reviewed remediation chain",
    }))
    expect(projectCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: expect.objectContaining({
        sequence: 30,
        state: "PR_MERGED",
        metadata: expect.objectContaining({ remediationPullRequests: [466] }),
      }),
    }))
    expect(projectCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: expect.objectContaining({
        sequence: 31,
        state: "REVIEW_REMEDIATION_RECOVERED",
        detail: "REVIEW_REMEDIATION_EXHAUSTED",
      }),
    }))
    candidate.lease.status = "ABANDONED"
    candidate.checkpoint = {
      sequence: 31,
      state: "REVIEW_REMEDIATION_RECOVERED",
      detail: "REVIEW_REMEDIATION_EXHAUSTED",
    }
    candidate.metadata.headRefOid = "b".repeat(40)
    candidate.metadata.mergeSha = "c".repeat(40)
    candidate.metadata.reviewRecoveryPriorHeadRefOid = "a".repeat(40)
    candidate.metadata.reviewRecoveryProofDigest = beginRecovery.mock.calls[0][0].proofDigest
    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome, authorizeProjection,
    })).resolves.toMatchObject({
      result: "COMPLETE", outcomeId: "9", prNumber: 464,
      mergeSha: "c".repeat(40), checkpointSequence: 31,
    })
    expect(projectCheckpoint).toHaveBeenLastCalledWith(expect.objectContaining({
      checkpoint: expect.objectContaining({
        sequence: 31,
        state: "REVIEW_REMEDIATION_RECOVERED",
        detail: "REVIEW_REMEDIATION_EXHAUSTED",
      }),
    }))
    expect(cycle).toHaveBeenCalledTimes(2)
    expect(recoverOutcome).toHaveBeenCalledTimes(2)
    expect(recoverOutcome).toHaveBeenLastCalledWith(expect.objectContaining({
      proofDigest: beginRecovery.mock.calls[0][0].proofDigest,
    }))
    expect(lifecycle.verifyOriginMainContains).toHaveBeenCalledWith("c".repeat(40))
    expect(lifecycle.verifyOriginMainContains).toHaveBeenCalledWith(remediationMerge)
    expect(lifecycle.verifyCommitAncestor).toHaveBeenCalledWith("c".repeat(40), remediationMerge)
  })
})
