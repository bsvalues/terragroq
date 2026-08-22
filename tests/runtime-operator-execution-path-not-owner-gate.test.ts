import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { runOperationalKernelCycle } from "../scripts/runtime-operator/operational-kernel.mjs"

/**
 * Owner rule (2026-08-22): "Agent/session permission boundaries are internal implementation
 * boundaries. They do not create owner work."
 *
 * This regression exists because the same design failure recurred three times under three names: a
 * lane/actor could not execute an already-authorized, review-clean, CI-green delivery step (a PR
 * merge), and the response was to hand the owner a chore ("you merge it" / "grant me the permission")
 * instead of routing to a lane that already holds the authority. The blocker was the CURRENT ACTOR'S
 * CAPABILITY, not a governance decision.
 *
 * The kernel encodes exactly one place where a failure becomes owner work: `ownerDecisionRequired`.
 * So the rule is testable as a real contract — an actor-capability failure must NEVER reach the owner
 * gate. It must stay internal (FAILED_TERMINAL / FAILED_RECOVERABLE), leaving the system to re-route.
 *
 * The owner gate is reserved for a genuinely non-delegable AUTHORITY decision (activation, owner-gate,
 * revocation-verifier walls) — never for "this actor can't do it".
 */

const REGISTRY = {
  schemaVersion: 1,
  repository: "bsvalues/terragroq",
  workOrders: [
    {
      workOrderId: "WO-TEST",
      adapterId: "williamos-resident-v1",
      authority: "APPROVED",
      riskClass: "R1",
      ownerGateRequired: false,
      protectedScope: false,
      baseBranch: "main",
      mergeMode: "AUTO_ELIGIBLE",
      allowedPaths: ["lib/**"],
      requiredValidation: ["test"],
      dependencies: [],
      task: "test task",
    },
  ],
}

function adaptersThrowing(message: string) {
  return {
    adapterId: "williamos-resident-v1",
    assertRuntime: async () => {},
    listQueue: async () => [
      { issueNumber: 890, workOrderId: "WO-TEST", state: "READY", createdAt: "2026-08-19T00:00:00Z" },
    ],
    resolveBaseSha: async () => "a".repeat(40),
    lease: async () => {},
    prepareWorkspace: async () => path.join(os.tmpdir(), "wo-test-fake"),
    invokeCodex: async () => { throw new Error(message) },
  }
}

let root: string | null = null
afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true })
  root = null
})

describe("actor-capability failures never become owner work", () => {
  // Every one of these is a variant of the same excuse the owner named: "my classifier blocks merge",
  // "my browser crashed", "my CLI can't do it", "this lane can't write that resource", "Codex owns that
  // file", "Claude can't access that API". Each is internal routing work.
  it.each([
    ["classifier blocked the merge tool call", "EXECUTION_PATH_FAILED: permission classifier denied gh merge"],
    ["merge path blocked for this session", "MERGE_PATH_BLOCKED: session cannot execute the authorized merge"],
    ["actor lacks a capability", "ACTOR_CAPABILITY_UNAVAILABLE: this lane cannot write that resource"],
    ["a tool/CLI is unavailable", "TOOL_UNAVAILABLE: gh cli is not installed on this actor"],
    ["another lane owns the file", "LANE_OWNERSHIP_CONFLICT: Codex owns that file"],
    ["a browser/session surface died", "SESSION_SURFACE_FAILED: automation browser crashed"],
  ])("%s → internal failure, never ownerDecisionRequired", async (_label, message) => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "williamos-execution-path-"))
    const result = await runOperationalKernelCycle({
      root, registry: REGISTRY, adapters: adaptersThrowing(message),
    })
    // The contract: the cycle records the failure for internal re-routing and does NOT raise an owner gate.
    expect(result.ownerDecisionRequired ?? false).toBe(false)
    expect(result.state).not.toBe("BLOCKED")
  })

  it("still raises the owner gate for a genuinely non-delegable AUTHORITY wall", async () => {
    // The exception the owner kept: interrupt only when the operation itself needs a NEW,
    // non-delegable owner authority decision. This half must keep working, or the rule above would
    // just be "never ask" — which is a different failure.
    root = fs.mkdtempSync(path.join(os.tmpdir(), "williamos-authority-wall-"))
    const result = await runOperationalKernelCycle({
      root, registry: REGISTRY, adapters: adaptersThrowing("AUTHORITY_OWNER_GATE_WALL"),
    })
    expect(result.ownerDecisionRequired).toBe(true)
    expect(result.state).toBe("BLOCKED")
  })
})
