import fs from "node:fs"
import { describe, expect, it, vi } from "vitest"

import { recoverExternalToolWall, recoverValidationInfrastructureWall, runCliEntrypoint, sanitizeBridgeMessage } from "../scripts/hermes-bridge/cli.mjs"

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
})
