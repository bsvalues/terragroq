import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  getOriginDiagnostics,
  resolveAuthBaseUrl,
  resolveTrustedOriginConfig,
} from "@/lib/auth-origins"
import { GET } from "@/app/api/auth/origin-diagnostics/route"

describe("auth trusted origin resolution", () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    process.env.NODE_ENV = "development"
    delete process.env.BETTER_AUTH_URL
    delete process.env.BETTER_AUTH_TRUSTED_ORIGINS
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL
    delete process.env.VERCEL_URL
    delete process.env.V0_RUNTIME_URL
    delete process.env.BETTER_AUTH_SECRET
    delete process.env.DATABASE_URL
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it("uses the same base URL precedence as Better Auth", () => {
    process.env.BETTER_AUTH_URL = "https://auth.example.com"
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "prod.example.com"
    process.env.VERCEL_URL = "preview.example.com"

    expect(resolveAuthBaseUrl()).toBe("https://auth.example.com")
  })

  it("extracts the auth base origin even when BETTER_AUTH_URL includes a path", () => {
    process.env.BETTER_AUTH_URL = "https://auth.example.com/api/auth"

    const config = resolveTrustedOriginConfig()

    expect(config.authBaseOrigin).toBe("https://auth.example.com")
    expect(config.trustedOrigins).toContain("https://auth.example.com")
    expect(config.invalidConfiguredOrigins).toEqual([])
  })

  it("parses configured trusted origins and keeps development defaults", () => {
    process.env.BETTER_AUTH_TRUSTED_ORIGINS =
      "http://localhost:3000, https://operator.example.com\nhttps://preview.example.com"
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "terragroq.vercel.app"

    const config = resolveTrustedOriginConfig()

    expect(config.trustedOrigins).toEqual(
      expect.arrayContaining([
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://operator.example.com",
        "https://preview.example.com",
        "https://terragroq.vercel.app",
      ]),
    )
    expect(config.invalidConfiguredOrigins).toEqual([])
  })

  it("reports invalid configured origins without leaking secret-like env values", () => {
    process.env.BETTER_AUTH_TRUSTED_ORIGINS =
      "https://valid.example.com https://bad.example.com/path javascript:alert(1) https://*.example.com"
    process.env.BETTER_AUTH_SECRET = "super-secret-value-that-must-not-appear"
    process.env.DATABASE_URL = "postgres://user:password@example.com/db"

    const diagnostics = getOriginDiagnostics(
      new Request("https://untrusted.example.com/api/auth/origin-diagnostics", {
        headers: { origin: "https://untrusted.example.com" },
      }),
    )
    const serialized = JSON.stringify(diagnostics)

    expect(diagnostics.trustedOrigins).toContain("https://valid.example.com")
    expect(diagnostics.invalidConfiguredOrigins).toHaveLength(3)
    expect(diagnostics.invalidConfiguredOrigins.map((item) => item.value)).toEqual(
      expect.arrayContaining(["https://bad.example.com/<path>", "<redacted>"]),
    )
    expect(diagnostics.invalidConfiguredOrigins.map((item) => item.reason)).toContain(
      "Wildcard origins are not supported.",
    )
    expect(diagnostics.isCurrentOriginTrusted).toBe(false)
    expect(diagnostics.recoveryActions.join(" ")).toContain("BETTER_AUTH_TRUSTED_ORIGINS")
    expect(serialized).not.toContain("super-secret-value")
    expect(serialized).not.toContain("password@example.com")
    expect(serialized).not.toContain("javascript:alert")
  })

  it("uses the request referer origin when Origin is absent", () => {
    process.env.BETTER_AUTH_TRUSTED_ORIGINS = "https://app.example.com"

    const diagnostics = getOriginDiagnostics(
      new Request("https://app.example.com/api/auth/origin-diagnostics", {
        headers: { referer: "https://app.example.com/sign-in?next=%2F" },
      }),
    )

    expect(diagnostics.currentOrigin).toBe("https://app.example.com")
    expect(diagnostics.isCurrentOriginTrusted).toBe(true)
  })

  it("returns a GET-only safe diagnostics payload", async () => {
    process.env.BETTER_AUTH_URL = "https://terragroq.vercel.app"
    process.env.BETTER_AUTH_TRUSTED_ORIGINS = "https://terragroq.vercel.app"
    process.env.BETTER_AUTH_SECRET = "super-secret-value-that-must-not-appear"

    const response = await GET(
      new Request("https://terragroq.vercel.app/api/auth/origin-diagnostics", {
        headers: { origin: "https://terragroq.vercel.app" },
      }),
    )
    const body = await response.json()
    const serialized = JSON.stringify(body)

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(body.ok).toBe(true)
    expect(body.diagnostics.currentOrigin).toBe("https://terragroq.vercel.app")
    expect(body.diagnostics.isCurrentOriginTrusted).toBe(true)
    expect(serialized).not.toContain("super-secret-value")
  })

  it("redacts configured origin details from production endpoint responses", async () => {
    process.env.NODE_ENV = "production"
    process.env.BETTER_AUTH_URL = "https://terragroq.vercel.app"
    process.env.BETTER_AUTH_TRUSTED_ORIGINS =
      "https://terragroq.vercel.app https://secret.example.com/path?token=abc"

    const response = await GET(
      new Request("https://untrusted.example.com/api/auth/origin-diagnostics", {
        headers: { origin: "https://untrusted.example.com" },
      }),
    )
    const body = await response.json()
    const serialized = JSON.stringify(body)

    expect(response.status).toBe(200)
    expect(body.diagnostics.currentOrigin).toBe("https://untrusted.example.com")
    expect(body.diagnostics.isCurrentOriginTrusted).toBe(false)
    expect(body.diagnostics.trustedOrigins).toBeUndefined()
    expect(body.diagnostics.invalidConfiguredOrigins).toBeUndefined()
    expect(serialized).not.toContain("secret.example.com")
    expect(serialized).not.toContain("token=abc")
  })
})
