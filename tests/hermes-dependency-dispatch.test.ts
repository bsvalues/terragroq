import { describe, expect, it, vi } from "vitest"

import { evaluateOutcomePolicy } from "@/scripts/hermes-bridge/policy.mjs"
import { createHermesOutcomeQueueRuntime } from "@/scripts/hermes-bridge/outcome-queue-runtime.mjs"

/* ------------------------------------------------------------------ */
/* D1 — dependency-aware policy (structured, never LANE_NOT_ALLOWED)    */
/* ------------------------------------------------------------------ */

const pol = (outcome: unknown) =>
  evaluateOutcomePolicy({ outcome, actor: "bsvalues", repository: "bsvalues/terragroq", enabled: true, standingAuthority: true })

function dep(over: Record<string, unknown> = {}) {
  return {
    executionSubject: { kind: "dependency", ok: true, envelope: { surfaceClass: "runtime_control", capability: "control" } },
    authorityAction: "runtime_control:control",
    riskClass: "R1",
    ...over,
  }
}

describe("D1 — dependency policy", () => {
  it("ALLOWS a well-formed runtime_control:control dependency and NEVER emits LANE_NOT_ALLOWED", () => {
    const r = pol(dep())
    expect(r.allowed).toBe(true)
    expect(r.reasonCode).toBe("DEPENDENCY_POLICY_ALLOWED")
    expect(r.reasonCode).not.toBe("LANE_NOT_ALLOWED")
  })

  it("HARD-DENIES forbidden capability classes even for a dependency (runtime_control is NOT denied)", () => {
    for (const action of ["data:destructive", "delivery:release", "secrets:read", "secrets:write", "external:act"]) {
      const [cls, cap] = action.split(":")
      const r = pol(dep({ authorityAction: action, executionSubject: { kind: "dependency", ok: true, envelope: { surfaceClass: cls, capability: cap } } }))
      expect(r.allowed, action).toBe(false)
      expect(r.reasonCode).toBe("DEPENDENCY_CAPABILITY_FORBIDDEN")
    }
  })

  it("refuses an envelope/action mismatch and a not-ok subject", () => {
    expect(pol(dep({ executionSubject: { kind: "dependency", ok: true, envelope: { surfaceClass: "source", capability: "write" } } })).reasonCode).toBe("DEPENDENCY_ENVELOPE_MISMATCH")
    expect(pol(dep({ executionSubject: { kind: "dependency", ok: false } })).reasonCode).toBe("DEPENDENCY_SUBJECT_NOT_OK")
  })

  it("legacy goal path is unchanged: an allowed lane passes, an unknown lane still LANE_NOT_ALLOWED", () => {
    expect(pol({ lane: "ui", riskClass: "R1", authority: "A2_WRITE_OWN" }).allowed).toBe(true)
    expect(pol({ lane: "banana", riskClass: "R1", authority: "A2_WRITE_OWN" }).reasonCode).toBe("LANE_NOT_ALLOWED")
  })
})

/* ------------------------------------------------------------------ */
/* D4/D2 — capability dispatch to the actuator + lease release on refuse */
/* ------------------------------------------------------------------ */

function runtimeFor(over: Record<string, unknown> = {}) {
  return createHermesOutcomeQueueRuntime({
    databaseUrl: "postgresql://not-used",
    holderId: "resident-hermes",
    campaignWindowId: "campaign-v1-2",
    processIdentity: "supervisor-nonce-1",
    checkpointProofProvider: vi.fn(),
    createPool: vi.fn(async () => ({ query: vi.fn(async () => ({ rows: [] })), end: vi.fn(), on: vi.fn() })),
    loadW1ServiceBinding: async () => ({ projectId: 2, boundRevision: "5a328e72", serviceIdentity: "terrafusion/os-shell", node: "hermes", checkoutPath: "C:\\TF-wt-w1-serving" }),
    ...over,
  })
}

function depOutcome(over: Record<string, unknown> = {}) {
  return {
    id: 28, userId: "owner", outcomeKey: "routed-dependency:2:r5", activeWorkOrderId: 55,
    authorityGrantRef: "DEP-ACQ-GRANT-2-r5", authorityLevel: "A0_READ_ONLY", authoritySubject: "operator",
    authorityAction: "runtime_control:control",
    executionSubject: { kind: "dependency", ok: true, dependencyId: 2, workOrderId: 55, envelope: { resource: "workspace-runtime", surfaceClass: "runtime_control", capability: "control" } },
    queueBinding: {
      userId: "owner", outcomeKey: "routed-dependency:2:r5", expectedVersion: 3,
      executionBinding: "bind-1", leaseHolder: "resident-hermes", leaseToken: "tok-1",
      fencingToken: 2, acquisitionKey: "acq-1",
    },
    ...over,
  }
}

describe("D4/D2 — capability dispatch + lease release", () => {
  it("routes runtime_control:control to the actuator and RELEASES the lease on LAUNCH_CONTRACT_UNDEFINED", async () => {
    const transitionQueue = vi.fn(async () => ({}))
    const startRuntimeService = vi.fn(async () => ({
      ok: false, refusal: "LAUNCH_CONTRACT_UNDEFINED", detail: "no contract",
      routeDependency: { operation: "DEFINE_WORKSPACE_RUNTIME_LAUNCH_CONTRACT" },
    }))
    const runtime = runtimeFor({ transitionQueue, startRuntimeService })
    const result = await runtime.executeDependencySubject(depOutcome())

    expect(startRuntimeService).toHaveBeenCalledOnce()
    const req = (startRuntimeService.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(req.operation).toBe("START_WORKSPACE_RUNTIME_SERVICE")
    expect(req.capability).toBe("runtime_control:control")
    expect(req.command).toBeUndefined() // never carries arbitrary command text
    // D2: lease released under fence, not leaked
    expect(transitionQueue).toHaveBeenCalledOnce()
    const t = (transitionQueue.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(t.toState).toBe("blocked")
    expect(t.lifecycleReason).toBe("ACTUATOR_LAUNCH_CONTRACT_UNDEFINED")
    expect(result.result).toBe("DEPENDENCY_ACTUATOR_REFUSED")
    expect(result.refusal).toBe("LAUNCH_CONTRACT_UNDEFINED")
    expect(result.routeDependency?.operation).toBe("DEFINE_WORKSPACE_RUNTIME_LAUNCH_CONTRACT")
  })

  it("a non runtime_control:control capability is RELEASED and NEVER sent to the actuator (no Codex)", async () => {
    const transitionQueue = vi.fn(async () => ({}))
    const startRuntimeService = vi.fn()
    const runtime = runtimeFor({ transitionQueue, startRuntimeService })
    const result = await runtime.executeDependencySubject(depOutcome({ authorityAction: "source:write" }))
    expect(startRuntimeService).not.toHaveBeenCalled()
    expect(transitionQueue).toHaveBeenCalledOnce()
    expect(result.refusal).toBe("CAPABILITY_NOT_ACTUATED")
  })
})
