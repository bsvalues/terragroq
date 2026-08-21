import { describe, expect, it } from "vitest"
import nextConfig from "@/next.config"

describe("security header baseline config", () => {
  it("emits a standalone server artifact for Azure App Service proof packaging", () => {
    expect(nextConfig.output).toBe("standalone")
  })

  it("disables the Next.js powered-by header", () => {
    expect(nextConfig.poweredByHeader).toBe(false)
  })

  it("defines the conservative repo-owned header baseline", async () => {
    expect(nextConfig.headers).toBeTypeOf("function")

    const rules = await nextConfig.headers?.()
    const allRoutes = rules?.find((rule) => rule.source === "/:path*")
    const headers = new Map(allRoutes?.headers.map((header) => [header.key, header.value]))

    expect(headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin")
    // DENY -> SAMEORIGIN, deliberately (2026-08-20, #762 Environment slice one). The Environment's
    // browser surface frames the running application's OWN pages -- a surface is the real thing, and
    // the real thing here is this app. SAMEORIGIN keeps the entire clickjacking threat model intact:
    // every foreign origin is still refused; the only new capability is this origin framing itself.
    // This line moving without a sentence like this one is exactly what this test exists to catch.
    expect(headers.get("X-Frame-Options")).toBe("SAMEORIGIN")
    expect(headers.get("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=()")
    expect(headers.has("Strict-Transport-Security")).toBe(false)
  })

  it("carries only the nonce-free CSP directives, and deliberately no script-src/style-src", async () => {
    // Independent review (2026-08-20) flagged the absent CSP. The answer is a PARTIAL policy: the
    // directives here need no nonce and govern no subresource loading, so they harden the
    // model-rendered Surfaces without breaking Next's inline hydration. A script-src/style-src
    // policy needs App-Router nonce plumbing and is a separate change; its absence is intentional.
    // This test fails if a full CSP is bolted on without that plumbing (which would blank the app).
    const rules = await nextConfig.headers?.()
    const headers = new Map(rules?.find((rule) => rule.source === "/:path*")?.headers.map((h) => [h.key, h.value]))
    const csp = headers.get("Content-Security-Policy") ?? ""
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'self'")
    expect(csp).toContain("form-action 'self'")
    expect(csp).not.toContain("script-src")
    expect(csp).not.toContain("style-src")
    expect(csp).not.toContain("default-src")
  })
})
