import { describe, expect, it } from "vitest"
import { getAuthRecoveryCopy } from "@/lib/auth-error-copy"

describe("auth recovery copy", () => {
  it("maps invalid credentials to a recoverable sign-in message", () => {
    const copy = getAuthRecoveryCopy({
      mode: "sign-in",
      rawMessage: "Invalid email or password",
      readiness: { ready: true, issues: [] },
    })

    expect(copy.code).toBe("INVALID_CREDENTIALS")
    expect(copy.title).toBe("Email or password did not match")
    expect(copy.recovery.join(" ")).toContain("Password reset is not available yet")
  })

  it("maps setup blockers before exposing raw auth failures", () => {
    const copy = getAuthRecoveryCopy({
      mode: "sign-in",
      rawMessage: "Internal server error: postgres://secret:secret@example/db",
      readiness: {
        ready: false,
        issues: [
          {
            code: "DATABASE_URL_MISSING",
            severity: "error",
            message: "DATABASE_URL is not configured.",
          },
        ],
      },
    })

    expect(copy.code).toBe("SETUP_REQUIRED")
    expect(JSON.stringify(copy)).not.toContain("postgres://secret")
  })

  it("does not classify unrelated user messages as invalid credentials", () => {
    const copy = getAuthRecoveryCopy({
      mode: "sign-up",
      rawMessage: "User already exists",
      readiness: { ready: true, issues: [] },
    })

    expect(copy.code).toBe("UNEXPECTED_AUTH_FAILURE")
    expect(copy.message).toContain("Raw failure details are not shown")
  })

  it("distinguishes bootstrap signup lock from policy-disabled signup", () => {
    const locked = getAuthRecoveryCopy({
      mode: "sign-up",
      rawMessage: "SIGNUP_DISABLED",
      readiness: {
        ready: true,
        issues: [],
        signup: { mode: "bootstrap", open: false },
      },
    })
    const disabled = getAuthRecoveryCopy({
      mode: "sign-up",
      rawMessage: "SIGNUP_DISABLED",
      readiness: {
        ready: true,
        issues: [],
        signup: { mode: "closed", open: false },
      },
    })

    expect(locked.code).toBe("SIGNUP_LOCKED")
    expect(locked.message).toContain("Bootstrap")
    expect(disabled.code).toBe("SIGNUP_DISABLED")
    expect(disabled.message).toContain("public account creation")
  })

  it("maps explicit signup-disabled server errors even when readiness is stale", () => {
    const copy = getAuthRecoveryCopy({
      mode: "sign-up",
      rawMessage: "SIGNUP_DISABLED",
      readiness: {
        ready: true,
        issues: [],
        signup: { mode: "bootstrap", open: true },
      },
    })

    expect(copy.code).toBe("SIGNUP_DISABLED")
    expect(copy.title).toBe("Signup is not available")
    expect(copy.recovery.join(" ")).toContain("refresh the page")
  })

  it("maps untrusted origin failures to diagnostics guidance", () => {
    const copy = getAuthRecoveryCopy({
      mode: "sign-in",
      rawMessage: "Invalid origin: https://bad.example.com is not trusted",
      readiness: { ready: true, issues: [] },
    })

    expect(copy.code).toBe("ORIGIN_NOT_TRUSTED")
    expect(copy.recovery.join(" ")).toContain("/api/auth/origin-diagnostics")
    expect(JSON.stringify(copy)).not.toContain("bad.example.com")
  })

  it("maps unavailable social providers without enabling them", () => {
    const copy = getAuthRecoveryCopy({
      mode: "sign-in",
      rawMessage: "OAuth provider google is not configured",
      readiness: { ready: true, issues: [] },
    })

    expect(copy.code).toBe("PROVIDER_UNAVAILABLE")
    expect(copy.message).toContain("email and password")
    expect(copy.recovery.join(" ")).toContain("require separate setup")
  })
})
