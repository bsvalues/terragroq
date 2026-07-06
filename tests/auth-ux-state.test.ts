import { describe, expect, it } from "vitest"
import { getAuthUxState, type AuthUxReadiness } from "@/lib/auth-ux-state"

const readyBootstrapOpen: AuthUxReadiness = {
  ready: true,
  issues: [],
  signup: { mode: "bootstrap", open: true },
}

const readyBootstrapLocked: AuthUxReadiness = {
  ready: true,
  issues: [],
  signup: {
    mode: "bootstrap",
    open: false,
    reason: "Owner provisioning is not available. Contact the Primary Operator.",
  },
}

describe("auth UX state classification", () => {
  it("shows setup required when readiness has blocking issues", () => {
    const state = getAuthUxState("sign-in", {
      ready: false,
      issues: [
        {
          code: "AUTH_BASE_URL_MISSING",
          severity: "error",
          message: "Auth base URL is not configured.",
        },
      ],
    })

    expect(state.state).toBe("setup-required")
    expect(state.primaryAction).toBe("Authentication blocked")
    expect(state.secondaryAction?.href).toBe("/setup")
  })

  it("treats bootstrap as controlled owner provisioning, not account creation", () => {
    const state = getAuthUxState("sign-up", readyBootstrapOpen)

    expect(state.state).toBe("owner-provisioning")
    expect(state.label).toBe("Owner provisioning")
    expect(state.title).toBe("Provision Primary Operator")
    expect(state.primaryAction).toBe("Provision Primary Operator")
    expect(JSON.stringify(state)).not.toMatch(/create account|create primary|request access|sign up|signup/i)
  })

  it("shows completed bootstrap as locked owner provisioning", () => {
    const state = getAuthUxState("sign-up", readyBootstrapLocked)

    expect(state.state).toBe("provisioning-locked")
    expect(state.title).toBe("Bootstrap is complete")
    expect(state.tone).toBe("neutral")
    expect(state.secondaryAction?.href).toBe("/sign-in")
    expect(JSON.stringify(state)).not.toMatch(/create account|request access|sign up|signup/i)
  })

  it("shows normal sign-in without exposing provisioning or signup actions", () => {
    const state = getAuthUxState("sign-in", readyBootstrapLocked)

    expect(state.state).toBe("sign-in")
    expect(state.tone).toBe("ready")
    expect(state.label).toBe("Primary Operator access")
    expect(state.primaryAction).toBe("Enter WilliamOS")
    expect(state.secondaryAction).toBeUndefined()
    expect(JSON.stringify(state)).not.toMatch(/\/sign-up|create account|request access|sign up|signup/i)
  })

  it("shows policy-closed sign-in without SaaS account creation copy", () => {
    const state = getAuthUxState("sign-in", {
      ready: true,
      issues: [],
      signup: {
        mode: "closed",
        open: false,
        reason: "Owner provisioning is disabled by policy.",
      },
    })

    expect(state.state).toBe("sign-in")
    expect(state.description).toContain("Owner provisioning is disabled by policy")
    expect(state.description).not.toContain("operator already exists")
    expect(JSON.stringify(state)).not.toMatch(/create account|request access|sign up|signup/i)
  })

  it("does not surface /sign-up from sign-in even when policy is open", () => {
    const state = getAuthUxState("sign-in", {
      ready: true,
      issues: [],
      signup: { mode: "open", open: true },
    })

    expect(state.secondaryAction).toBeUndefined()
    expect(JSON.stringify(state)).not.toContain("/sign-up")
  })

  it("does not treat open policy as public access request UX", () => {
    const state = getAuthUxState("sign-up", {
      ready: true,
      issues: [],
      signup: { mode: "open", open: true },
    })

    expect(state.state).toBe("provisioning-disabled")
    expect(state.title).toBe("Owner provisioning is unavailable")
    expect(state.primaryAction).toBe("Enter WilliamOS instead")
    expect(JSON.stringify(state)).not.toMatch(/request access|create account|sign up|signup/i)
  })

  it("treats missing signup policy as unavailable rather than open self-service", () => {
    const state = getAuthUxState("sign-up", {
      ready: true,
      issues: [],
    })

    expect(state.state).toBe("provisioning-disabled")
    expect(state.tone).toBe("warning")
  })
})
