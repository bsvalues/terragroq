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
    expect(state.primaryAction).toBe("Authentication blocked")
    expect(state.secondaryAction?.href).toBe("/setup")
  })

  it("shows first-operator creation when bootstrap signup is open", () => {
    const state = getAuthUxState("sign-up", readyBootstrapOpen)

    expect(state.state).toBe("create-first-operator")
    expect(state.label).toBe("Primary Operator")
    expect(state.primaryAction).toBe("Create Primary Operator")
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
    expect(state.label).toBe("Primary Operator access")
    expect(state.primaryAction).toBe("Enter WilliamOS")
    expect(state.secondaryAction).toBeUndefined()
  })

  it("shows policy-closed sign-in without implying an operator already exists", () => {
    const state = getAuthUxState("sign-in", {
      ready: true,
      issues: [],
      signup: {
        mode: "closed",
        open: false,
        reason: "Public account creation is disabled by policy.",
      },
    })

    expect(state.state).toBe("sign-in")
    expect(state.description).toContain("disabled by policy")
    expect(state.description).not.toContain("operator already exists")
  })

  it("uses generic account creation copy when signup is open by policy", () => {
    const state = getAuthUxState("sign-in", {
      ready: true,
      issues: [],
      signup: { mode: "open", open: true },
    })

    expect(state.secondaryAction).toMatchObject({
      href: "/sign-up",
      label: "Request access",
    })
  })

  it("does not call policy-open signup first-operator bootstrap", () => {
    const state = getAuthUxState("sign-up", {
      ready: true,
      issues: [],
      signup: { mode: "open", open: true },
    })

    expect(state.label).toBe("Access open")
    expect(state.title).toBe("Request WilliamOS access")
    expect(state.primaryAction).toBe("Request access")
  })

  it("treats missing signup policy as open-compatible rather than disabled", () => {
    const state = getAuthUxState("sign-up", {
      ready: true,
      issues: [],
    })

    expect(state.state).toBe("create-first-operator")
    expect(state.tone).toBe("ready")
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
