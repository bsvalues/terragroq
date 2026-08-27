import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { runOperationalKernelCycle } from "../scripts/runtime-operator/operational-kernel.mjs"

/**
 * Owner direction (2026-08-24), successor to the rule #957 locked:
 *
 *   "Session and surface limitations are never owner gates."
 *
 * #957 proved that an actor's *capability* failure stays internal. This is the class the owner named
 * next: the same failure dressed as a polite request. An agent that cannot start a lane, cannot run a
 * command in its session, cannot merge an already-green PR from its surface, or cannot carry a report
 * between two tools has discovered a property of ITSELF. It has two permitted moves -- route the work
 * to an approved actor that already holds the capability, or persist a typed continuation packet for
 * automatic pickup -- and one forbidden move: handing the owner an errand.
 *
 * Doctrine: docs/governance/owner-directed-execution-doctrine.md
 *
 * WHAT THIS TEST PROVES -- stated exactly, because an earlier revision of this comment claimed more
 * than the kernel supports and an independent review caught it.
 *
 * The courier cases assert two things, and only these two:
 *
 *   1. a courier-shaped failure never reaches the owner gate; and
 *   2. it is still RECORDED -- `failureCode` survives onto the checkpoint -- because a limitation
 *      that is silently swallowed cannot be re-routed either. "Don't ask the owner" and "drop it on
 *      the floor" are different failures, and only the first one is fixed by not asking.
 *
 * They do NOT prove that the kernel recognises these codes individually. It does not: every
 * unrecognised message reaches the generic branch at operational-kernel.mjs:464 and becomes
 * FAILED_TERMINAL with ownerDecisionRequired false, so twelve arbitrary strings would pass these
 * cases identically.
 *
 * The load-bearing assertion is therefore the PAIR, not either half alone. The six positive controls
 * below are exactly the regex of `isOwnerWall` (operational-kernel.mjs:417), so the moment anyone
 * widens that predicate to admit a courier-shaped code -- the precise regression this doctrine
 * exists to prevent -- the courier cases turn red. That tripwire is the contract. It is worth having,
 * and it is smaller than "the kernel routes courier failures", which is not true yet.
 *
 * The gap that leaves is recorded in the doctrine's "What that test proves, and what it does not":
 * §1 wants routed-or-persisted, and FAILED_TERMINAL is neither. Closing it needs a courier
 * classification plus a canonical REROUTE_PENDING state AND a consumer for it, which the kernel does
 * not have. A state with no consumer would be a second slogan, so it is not added here.
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
    invokeCodex: async () => {
      throw new Error(message)
    },
  }
}

let root: string | null = null
afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true })
  root = null
})

async function cycle(prefix: string, message: string) {
  root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  return runOperationalKernelCycle({ root, registry: REGISTRY, adapters: adaptersThrowing(message) })
}

describe("session and surface limitations never become owner work", () => {
  // Each of these is one of the asks the doctrine names, in the form the kernel would actually see
  // it: the lane hit its own edge and the tempting next move is "ask William to do this part".
  it.each([
    ["cannot start an agent/lane", "SESSION_SURFACE_UNAVAILABLE: this session cannot launch a builder lane"],
    ["cannot re-enter a prompt", "SESSION_SURFACE_UNAVAILABLE: interactive prompt entry unavailable in this mode"],
    ["cannot transfer a report between surfaces", "ACTOR_CAPABILITY_UNAVAILABLE: cannot move the review report to the PR surface"],
    ["cannot run a command from this session", "EXECUTION_PATH_FAILED: non-interactive session cannot execute the authorized command"],
    ["cannot merge an already-green PR", "MERGE_PATH_BLOCKED: this surface cannot execute the authorized merge"],
    ["cannot relay context to another agent", "ACTOR_CAPABILITY_UNAVAILABLE: no channel to hand context to the reviewing lane"],
    ["a tool/CLI is missing on this actor", "TOOL_UNAVAILABLE: codex cli is not on PATH for this actor"],
    ["the working directory or environment is wrong", "ACTOR_CAPABILITY_UNAVAILABLE: cwd is outside the reserved worktree"],
    ["an optional provider is unauthenticated", "PROVIDER_UNAVAILABLE: reviewer integration is not authenticated on this surface"],
    // The last three of the doctrine's nine named asks. An earlier revision had nine cases and nine
    // named asks and assumed they lined up; three of the asks were in fact uncovered while two cases
    // tested capability conditions the doctrine does not name. Matching counts are not coverage.
    ["asking for a permission that only works around this surface", "ACTOR_CAPABILITY_UNAVAILABLE: needs a grant that exists only to bypass this actor's surface"],
    ["asking to repair or restart infrastructure", "NODE_UNAVAILABLE: the node needs a restart before this lane can proceed"],
    ["asking to re-decide what active authority already decides", "AUTHORITY_ALREADY_RECORDED: the active Work Order already covers this action"],
  ])("%s → internal, never ownerDecisionRequired", async (_label, message) => {
    const result = await cycle("williamos-session-surface-", message)

    // Half one: it does not become owner work.
    expect(result.ownerDecisionRequired ?? false).toBe(false)
    expect(result.state).not.toBe("BLOCKED")

    // Half two: it is still recorded, so a coordinator can actually re-route it. A limitation that
    // vanishes without trace is not "handled" -- it is the same outage with no forwarding address.
    expect(result.failureCode).toBe(message)
  })

  // The exception the owner kept. Enumerated exhaustively over the walls the kernel recognises, so
  // that widening that set with a courier-shaped code -- the exact regression this doctrine exists to
  // prevent -- fails here loudly instead of quietly re-teaching agents to escalate.
  it.each([
    ["activation authority", "AUTHORITY_ACTIVATION_WALL"],
    ["owner gate authority", "AUTHORITY_OWNER_GATE_WALL"],
    ["owner revocation verifier", "OWNER_REVOCATION_EVENT_VERIFIER_WALL"],
    ["codex authority", "CODEX_AUTHORITY_WALL"],
    ["github authority", "GITHUB_AUTHORITY_WALL"],
    ["runtime readiness", "RUNTIME_READINESS_WALL"],
  ])("%s wall is genuinely non-delegable and still gates", async (_label, message) => {
    const result = await cycle("williamos-authority-wall-", message)
    expect(result.ownerDecisionRequired).toBe(true)
    expect(result.state).toBe("BLOCKED")
  })

  it("a provider rate limit is a wait, not an owner gate and not a failure", async () => {
    // Sovereignty clause, AGENTS.md: quota exhaustion on an optional provider must never convert into
    // owner babysitting. The kernel already parks and retries; this pins that it keeps doing so.
    //
    // `retry-<n>` is EPOCH SECONDS, not a delay -- operational-kernel.mjs:432 computes
    // `new Date(Number(n) * 1000)`. An earlier revision passed `retry-60`, which is
    // 1970-01-01T00:01:00Z: `toBeTruthy()` passed on it, but a wait already in the past is not a
    // wait. runCycle's guard at operational-kernel.mjs:291 requires `retryAfter > now` to hold the
    // lane, so that fixture asserted the opposite of what it claimed.
    const retryAtEpochSeconds = Math.floor(Date.now() / 1000) + 600
    const result = await cycle("williamos-rate-limit-", `PROVIDER_RATE_LIMIT_WALL:retry-${retryAtEpochSeconds}`)
    expect(result.ownerDecisionRequired).toBe(false)
    expect(result.state).toBe("WAITING_PROVIDER")
    // The wait must actually be in the future, or the lane redispatches immediately and "parks and
    // retries" is a claim the test never checked.
    expect(Date.parse(result.retryAfter)).toBeGreaterThan(Date.now())
    expect(result.failureCode).toBe("PROVIDER_RATE_LIMIT_WALL")
  })
})
