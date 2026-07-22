import { describe, expect, it, vi } from "vitest"

import { recoverValidationInfrastructureWall, runCliEntrypoint, sanitizeBridgeMessage } from "../scripts/hermes-bridge/cli.mjs"

describe("Hermes bridge CLI", () => {
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
        reopenValidationInfrastructureWall: vi.fn(() => { calls.push("state"); return {} }),
      },
    }
    const recordProof = vi.fn(async () => { calls.push("proof"); return true })
    const recoverOutcome = vi.fn(async () => { calls.push("database"); return true })

    await expect(recoverValidationInfrastructureWall({ orchestrator, recordProof, recoverOutcome }))
      .resolves.toMatchObject({ result: "RECOVERED", outcomeId: "5", proofRecorded: true })
    expect(calls).toEqual(["state", "proof", "database"])
    expect(recordProof.mock.calls[0][0]).toMatchObject({ outcomeId: 5, fencingToken: 14 })
    expect(recoverOutcome.mock.calls[0][0].proofDigest).toMatch(/^[0-9a-f]{64}$/)
  })
})
