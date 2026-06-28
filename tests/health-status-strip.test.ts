import { describe, expect, it } from "vitest"
import { getSignupStatus } from "@/components/shell/health-status"
import type { AuthReadiness } from "@/lib/auth-readiness"

function readiness(overrides: Partial<AuthReadiness>): AuthReadiness {
  return {
    ready: true,
    databaseReady: true,
    authReady: true,
    signup: {
      mode: "bootstrap",
      open: false,
      reason: "Operator sign-up is not available. Contact your platform administrator.",
    },
    checkedAt: "2026-06-28T00:00:00.000Z",
    checks: {
      databaseUrl: { ok: true },
      databaseConnectivity: { ok: true, latencyMs: 2 },
      authSecret: { ok: true },
      baseUrl: { ok: true },
    },
    issues: [],
    ...overrides,
  }
}

describe("HealthStatusStrip signup status", () => {
  it("treats healthy bootstrap-locked signup as secured, not destructive", () => {
    const status = getSignupStatus(readiness({}))

    expect(status.tone).toBe("ready")
    expect(status.label).toBe("Signup: secured")
    expect(status.title).toContain("operator account already exists")
  })

  it("keeps signup destructive when auth readiness is not trustworthy", () => {
    const status = getSignupStatus(
      readiness({
        ready: false,
        databaseReady: false,
        authReady: false,
        issues: [
          {
            code: "DATABASE_URL_MISSING",
            severity: "error",
            message: "DATABASE_URL is not configured.",
          },
        ],
      }),
    )

    expect(status.tone).toBe("blocked")
    expect(status.label).toBe("Signup: bootstrap")
  })

  it("shows policy-closed signup as a warning when auth itself is ready", () => {
    const status = getSignupStatus(
      readiness({
        signup: {
          mode: "closed",
          open: false,
          reason: "Public sign-up is disabled by policy.",
        },
      }),
    )

    expect(status.tone).toBe("warn")
    expect(status.label).toBe("Signup: closed")
    expect(status.title).toBe("Public sign-up is disabled by policy.")
  })
})
