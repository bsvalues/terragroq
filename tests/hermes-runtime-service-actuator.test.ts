import { describe, expect, it } from "vitest"

import {
  ACTUATOR_OPERATION,
  BOUND_SERVICE_IDENTITY,
  REQUIRED_LAUNCH_CONTRACT_FIELDS,
  launchContractMissingFields,
  startWorkspaceRuntimeService,
} from "@/scripts/hermes-bridge/runtime-service-actuator.mjs"

/**
 * The bounded runtime actuator (D5). It validates the whole governed envelope, refuses every
 * mismatch/drift/expiry with a typed reason, has NO arbitrary-command escape hatch, and — with no
 * governed launch contract — refuses LAUNCH_CONTRACT_UNDEFINED and routes the structured DEFINE
 * dependency. LAUNCH_CONTRACT_UNDEFINED for a fully-valid envelope is the intended terminal state.
 */

const EXPECTED = {
  serviceIdentity: BOUND_SERVICE_IDENTITY,
  projectId: 2,
  workOrderId: 55,
  node: "hermes",
  boundRevision: "5a328e728852dc2bb933d704d0daa5c54750728c",
}

function validRequest(over: Record<string, unknown> = {}) {
  return {
    operation: ACTUATOR_OPERATION,
    capability: "runtime_control:control",
    serviceIdentity: BOUND_SERVICE_IDENTITY,
    projectId: 2,
    workOrderId: 55,
    node: "hermes",
    checkoutPath: "C:\\TF-wt-w1-serving",
    boundRevision: "5a328e728852dc2bb933d704d0daa5c54750728c",
    expected: EXPECTED,
    grant: { ref: "DEP-ACQ-GRANT-2-r5" },
    fence: { projectionQueueItemId: 28 },
    ...over,
  }
}

function deps(over: Record<string, unknown> = {}) {
  return {
    readCheckoutRevision: async () => "5a328e728852dc2bb933d704d0daa5c54750728c",
    verifyGrant: async () => ({ ok: true }),
    verifyFence: async () => ({ ok: true }),
    loadLaunchContract: async () => null, // no contract exists today
    artifactExists: async () => false,
    ...over,
  }
}

describe("runtime service actuator — validates the whole governed envelope first", () => {
  it("refuses a wrong operation (source/other capability never performs this)", async () => {
    const r = await startWorkspaceRuntimeService(validRequest({ operation: "IMPLEMENT" }), deps())
    expect(r.ok).toBe(false)
    expect(r.refusal).toBe("WRONG_OPERATION")
  })

  it("refuses a non runtime_control:control capability (source capability cannot reach the actuator)", async () => {
    for (const capability of ["runtime_config:write", "source:write", "delivery:push", "outcome:execute"]) {
      const r = await startWorkspaceRuntimeService(validRequest({ capability }), deps())
      expect(r.ok).toBe(false)
      expect(r.refusal).toBe("WRONG_CAPABILITY")
    }
  })

  it("refuses ANY arbitrary-command escape hatch on the work item", async () => {
    for (const key of ["command", "args", "script", "shell", "exec", "cmd", "run", "powershell", "bash", "port", "path"]) {
      const r = await startWorkspaceRuntimeService(validRequest({ [key]: "anything" }), deps())
      expect(r.ok, `key ${key} must be rejected`).toBe(false)
      expect(r.refusal).toBe("ARBITRARY_COMMAND_REJECTED")
    }
  })

  it("refuses wrong service / project / work order / node", async () => {
    expect((await startWorkspaceRuntimeService(validRequest({ serviceIdentity: "terrafusion/workbench" }), deps())).refusal).toBe("WRONG_SERVICE")
    expect((await startWorkspaceRuntimeService(validRequest({ projectId: 41 }), deps())).refusal).toBe("WRONG_PROJECT")
    expect((await startWorkspaceRuntimeService(validRequest({ workOrderId: 1 }), deps())).refusal).toBe("WRONG_WORK_ORDER")
    expect((await startWorkspaceRuntimeService(validRequest({ node: "atlas" }), deps())).refusal).toBe("WRONG_NODE")
  })

  it("refuses a missing checkout and checkout drift (never mutates the checkout)", async () => {
    expect((await startWorkspaceRuntimeService(validRequest(), deps({ readCheckoutRevision: async () => null }))).refusal).toBe("CHECKOUT_MISSING")
    expect((await startWorkspaceRuntimeService(validRequest(), deps({ readCheckoutRevision: async () => "deadbeef" + "0".repeat(32) }))).refusal).toBe("CHECKOUT_DRIFT")
  })

  it("refuses an expired/revoked grant and a fence mismatch", async () => {
    expect((await startWorkspaceRuntimeService(validRequest(), deps({ verifyGrant: async () => ({ ok: false, detail: "revoked" }) }))).refusal).toBe("GRANT_ABSENT")
    expect((await startWorkspaceRuntimeService(validRequest(), deps({ verifyFence: async () => ({ ok: false, detail: "stale" }) }))).refusal).toBe("FENCE_MISMATCH")
  })
})

describe("runtime service actuator — refuses LAUNCH_CONTRACT_UNDEFINED (this pass's success)", () => {
  it("with a full valid envelope and no contract, refuses and routes DEFINE with every required field", async () => {
    const r = await startWorkspaceRuntimeService(validRequest(), deps())
    expect(r.ok).toBe(false)
    expect(r.refusal).toBe("LAUNCH_CONTRACT_UNDEFINED")
    expect(r.routeDependency?.operation).toBe("DEFINE_WORKSPACE_RUNTIME_LAUNCH_CONTRACT")
    expect(r.routeDependency?.requiredContractFields).toEqual([...REQUIRED_LAUNCH_CONTRACT_FIELDS])
    expect(r.routeDependency?.missing).toEqual([...REQUIRED_LAUNCH_CONTRACT_FIELDS])
    // It never improvises a command/port.
    expect(JSON.stringify(r)).not.toMatch(/vite|:5199|npm run|pnpm|dotnet run/)
  })

  it("refuses a PARTIAL contract, naming exactly the missing fields", async () => {
    const partial = { serviceIdentity: BOUND_SERVICE_IDENTITY, launchMode: "served", command: "x" }
    const r = await startWorkspaceRuntimeService(validRequest(), deps({ loadLaunchContract: async () => partial }))
    expect(r.refusal).toBe("LAUNCH_CONTRACT_UNDEFINED")
    expect(r.routeDependency?.missing).not.toContain("serviceIdentity")
    expect(r.routeDependency?.missing).not.toContain("command")
    expect(r.routeDependency?.missing).toContain("portPolicy")
    expect(r.routeDependency?.missing).toContain("readinessProbe")
  })

  it("validates the ENVELOPE before ever consulting the contract (order matters)", async () => {
    let contractConsulted = false
    const d = deps({ loadLaunchContract: async () => { contractConsulted = true; return null } })
    // A bad capability must refuse WITHOUT loading a contract.
    const r = await startWorkspaceRuntimeService(validRequest({ capability: "source:write" }), d)
    expect(r.refusal).toBe("WRONG_CAPABILITY")
    expect(contractConsulted).toBe(false)
  })
})

describe("launchContractMissingFields", () => {
  it("treats a full, non-blank contract as defined", () => {
    const full: Record<string, unknown> = {}
    for (const f of REQUIRED_LAUNCH_CONTRACT_FIELDS) full[f] = "value"
    full.requiredEnvNames = ["DATABASE_URL"]
    full.prerequisiteServices = []
    expect(launchContractMissingFields(full)).toEqual([])
  })
  it("reports blanks, nulls, and non-array list fields as missing", () => {
    const full: Record<string, unknown> = {}
    for (const f of REQUIRED_LAUNCH_CONTRACT_FIELDS) full[f] = "value"
    full.command = "  "
    full.portPolicy = null
    full.requiredEnvNames = "DATABASE_URL" // not an array
    const missing = launchContractMissingFields(full)
    expect(missing).toContain("command")
    expect(missing).toContain("portPolicy")
    expect(missing).toContain("requiredEnvNames")
  })
})
