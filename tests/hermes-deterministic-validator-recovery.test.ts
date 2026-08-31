import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  buildFocusedValidationCommand,
  canonicalSha256,
  createDeterministicValidatorCircuit,
  createDeterministicValidatorReplacement,
  createDeterministicValidatorWallEvidence,
  transitionDeterministicValidatorCircuit,
} from "@/scripts/hermes-bridge/deterministic-validator-recovery.mjs"
import { createHermesStateStore } from "@/scripts/hermes-bridge/state-store.mjs"

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

function contract() {
  const body = {
    id: "washington-assessor-launch-product-blocker.v1",
    reservations: ["frontend/apps/os-shell/**"],
    validationCommands: [{
      command: "npm", args: ["test", "--", "--run", "tests/existing.test.ts"], timeoutMs: 120_000,
    }],
  }
  return { ...body, digest: canonicalSha256(body) }
}

function recoveryFixture(outcomeId = "44") {
  const oldContract = contract()
  const focusedValidationCommand = buildFocusedValidationCommand({
    command: "npx",
    prefixArgs: ["vitest", "run"],
    testPaths: [
      "tests/unit/counties_hub_terraforge_activation.test.ts",
      "tests/unit/washington_launch_data_proxy.test.ts",
      "tests/unit/washington_launch_startup_contract.test.ts",
    ],
    workingDirectory: "frontend",
    timeoutMs: 120_000,
  })
  const evidence = createDeterministicValidatorWallEvidence({
    outcomeId,
    outcomeKey: "goal:GOAL-0040",
    contract: oldContract,
    worktreeSnapshotHash: "a".repeat(64),
    missingTestPaths: focusedValidationCommand.args.slice(2),
    focusedValidationCommand,
  })
  const replacement = createDeterministicValidatorReplacement({ contract: oldContract, evidence })
  const circuit = createDeterministicValidatorCircuit({
    evidence, replacement, sourceFencingToken: 225, sourceCheckpointSequence: 143,
    observedAt: "2026-08-31T18:00:00.000Z",
  })
  return { oldContract, focusedValidationCommand, evidence, replacement, circuit }
}

describe("Hermes deterministic validator recovery", () => {
  it("binds the wall to outcome, contract, exact worktree snapshot, validator and every missing test", () => {
    const value = recoveryFixture()
    expect(value.evidence.structuredInputs).toMatchObject({
      outcomeId: "44",
      outcomeKey: "goal:GOAL-0040",
      worktreeSnapshotHash: "a".repeat(64),
      missingTestPaths: [
        "tests/unit/counties_hub_terraforge_activation.test.ts",
        "tests/unit/washington_launch_data_proxy.test.ts",
        "tests/unit/washington_launch_startup_contract.test.ts",
      ],
    })
    expect(value.replacement.recoveryAttemptOrdinal).toBe(1)
    expect(value.replacement.replacementContract.validationCommands.at(-1)).toEqual({
      command: "npx",
      args: value.focusedValidationCommand.args,
      workingDirectory: "frontend",
      timeoutMs: 120_000,
    })
    expect(recoveryFixture("45").evidence.fingerprint).not.toBe(value.evidence.fingerprint)
  })

  it("allows one recovery transition and permanently opens the circuit on a second wall", () => {
    const { circuit } = recoveryFixture()
    const active = transitionDeterministicValidatorCircuit(circuit, {
      status: "RECOVERY_ACTIVE", observedAt: "2026-08-31T18:01:00.000Z",
    })
    const recovered = transitionDeterministicValidatorCircuit(active, {
      status: "RECOVERED", observedAt: "2026-08-31T18:02:00.000Z",
    })
    const required = transitionDeterministicValidatorCircuit(recovered, {
      status: "RECOVERY_REQUIRED", fingerprint: "b".repeat(64),
      observedAt: "2026-08-31T18:03:00.000Z",
    })
    expect(required.status).toBe("RECOVERY_REQUIRED")
    expect(required.recoveryAttemptOrdinal).toBe(1)
    expect(() => transitionDeterministicValidatorCircuit(required, {
      status: "RECOVERY_ACTIVE", observedAt: "2026-08-31T18:04:00.000Z",
    })).toThrow()
  })

  it("atomically fences the source lease, survives restart, and admits exactly one replacement lease", () => {
    const dir = mkdtempSync(join(tmpdir(), "hermes-dvr-")); dirs.push(dir)
    const statePath = join(dir, "state.json")
    let now = Date.parse("2026-08-31T18:00:00.000Z")
    const options = { now: () => now }
    const store = createHermesStateStore(statePath, options)
    store.initialize()
    const lease = store.acquireLease({
      idempotencyKey: "acquire-44", outcomeId: "44", holderId: "supervisor-a",
      leaseDurationMs: 60_000, metadata: { outcome: { id: 44 } },
    })
    const { evidence, replacement } = recoveryFixture()
    const circuit = createDeterministicValidatorCircuit({
      evidence, replacement, sourceFencingToken: lease.fencingToken,
      sourceCheckpointSequence: lease.checkpointSequence,
      observedAt: new Date(now).toISOString(),
    })
    const tripped = store.tripDeterministicValidatorCircuit({
      idempotencyKey: "trip-44", outcomeId: "44", holderId: "supervisor-a",
      fencingToken: lease.fencingToken, expectedCheckpointSequence: lease.checkpointSequence, circuit,
    })
    expect(tripped).toMatchObject({
      leaseStatus: "ABANDONED", circuitStatus: "DETERMINISTIC_CONTRACT_RECOVERY",
    })
    expect(() => store.checkpoint({
      idempotencyKey: "stale-write", outcomeId: "44", holderId: "supervisor-a",
      fencingToken: lease.fencingToken, expectedCheckpointSequence: tripped.checkpointSequence,
      state: "SHOULD_NOT_WRITE",
    })).toThrow()

    const restarted = createHermesStateStore(statePath, options)
    expect(restarted.read().executions["44"].metadata.deterministicValidatorCircuit.status)
      .toBe("DETERMINISTIC_CONTRACT_RECOVERY")
    now += 1_000
    const recovery = restarted.activateDeterministicValidatorRecovery({
      idempotencyKey: "activate-44", outcomeId: "44",
      expectedFencingToken: lease.fencingToken,
      expectedCheckpointSequence: tripped.checkpointSequence,
      holderId: "supervisor-b", leaseDurationMs: 60_000,
    })
    expect(recovery.fencingToken).toBeGreaterThan(lease.fencingToken)
    expect(recovery.replacementContract.digest).toBe(replacement.replacementContract.digest)
    expect(() => restarted.activateDeterministicValidatorRecovery({
      idempotencyKey: "activate-44-racer", outcomeId: "44",
      expectedFencingToken: lease.fencingToken,
      expectedCheckpointSequence: tripped.checkpointSequence,
      holderId: "supervisor-c", leaseDurationMs: 60_000,
    })).toThrow()

    const persisted = JSON.parse(readFileSync(statePath, "utf8"))
    expect(persisted.executions["44"].fencingToken).toBe(recovery.fencingToken)
    expect(persisted.executions["44"].metadata.deterministicValidatorCircuit.status)
      .toBe("RECOVERY_ACTIVE")
  })
})
