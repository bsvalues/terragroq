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
    reason: "Operator sign-up is not available. Contact your platform administrator.",
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
    expect(state.primaryAction).toBe("Open setup assistant")
    expect(state.secondaryAction?.href).toBe("/setup")
  })

  it("shows first-operator creation when bootstrap signup is open", () => {
    const state = getAuthUxState("sign-up", readyBootstrapOpen)

    expect(state.state).toBe("create-first-operator")
    expect(state.label).toBe("First operator")
    expect(state.primaryAction).toBe("Provision operator")
  })

  it("shows bootstrap locked as normal secured state, not setup failure", () => {
    const state = getAuthUxState("sign-up", readyBootstrapLocked)

    expect(state.state).toBe("signup-locked")
    expect(state.title).toBe("Bootstrap is complete")
    expect(state.tone).toBe("neutral")
    expect(state.secondaryAction?.href).toBe("/sign-in")
  })

  it("shows normal sign-in when auth is ready even if signup is locked", () => {
    const state = getAuthUxState("sign-in", readyBootstrapLocked)

    expect(state.state).toBe("sign-in")
    expect(state.tone).toBe("ready")
    expect(state.primaryAction).toBe("Enter the shell")
  })

  it("distinguishes policy-disabled signup from completed bootstrap", () => {
    const state = getAuthUxState("sign-up", {
      ready: true,
      issues: [],
      signup: {
        mode: "closed",
        open: false,
        reason: "Public account creation is disabled by policy.",
      },
    })

    expect(state.state).toBe("signup-disabled")
    expect(state.tone).toBe("warning")
    expect(state.description).toContain("disabled")
  })
})
