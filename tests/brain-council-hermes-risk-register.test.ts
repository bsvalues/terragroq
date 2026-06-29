import { describe, expect, it } from "vitest"
import { getHermesActivationRiskRegister } from "@/components/brain-council/brain-council-hermes-risk-register"

describe("Hermes activation risk register", () => {
  it("keeps the activation posture denied", () => {
    const register = getHermesActivationRiskRegister()

    expect(register.posture).toBe("ACTIVATION_DENIED_RISK_REGISTER_ONLY")
    expect(register.risks.length).toBeGreaterThanOrEqual(4)
  })

  it("tracks high-risk escalation topics", () => {
    const register = getHermesActivationRiskRegister()

    expect(register.escalationOnly).toContain("MCP activation")
    expect(register.escalationOnly).toContain("production data write")
  })

  it("does not grant activation or mutation capability", () => {
    const register = getHermesActivationRiskRegister()

    expect(register.safety).toEqual({
      changesPolicy: false,
      grantsActivation: false,
      createsRuntime: false,
      mutatesDatabase: false,
      changesEnvironment: false,
      productionWrite: false,
    })
  })
})
