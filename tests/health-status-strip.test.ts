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
      reason: "Owner provisioning is not available. Contact the Primary Operator.",
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

describe("HealthStatusStrip owner provisioning status", () => {
  it("treats healthy bootstrap-locked owner provisioning as secured, not destructive", () => {
    const status = getSignupStatus(readiness({}))

    expect(status.tone).toBe("ready")
    expect(status.label).toBe("Provisioning: secured")
    expect(status.title).toContain("Primary Operator already exists")
  })

  it("keeps owner provisioning destructive when auth readiness is not trustworthy", () => {
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
    expect(status.label).toBe("Provisioning: bootstrap")
    expect(status.title).toContain("auth/database readiness")
  })

  it("does not mark failed bootstrap policy checks as secured", () => {
    const status = getSignupStatus(
      readiness({
        signup: {
          mode: "bootstrap",
          open: false,
          reason: 'Bootstrap owner provisioning check failed: relation "user" does not exist.',
        },
      }),
    )

    expect(status.tone).toBe("blocked")
    expect(status.label).toBe("Provisioning: bootstrap check failed")
    expect(status.title).toContain("Bootstrap owner provisioning check failed")
  })

  it("shows policy-closed owner provisioning as a warning when auth itself is ready", () => {
    const status = getSignupStatus(
      readiness({
        signup: {
          mode: "closed",
          open: false,
          reason: "Owner provisioning is disabled by policy.",
        },
      }),
    )

    expect(status.tone).toBe("warn")
    expect(status.label).toBe("Provisioning: closed")
    expect(status.title).toBe("Owner provisioning is disabled by policy.")
  })
})
