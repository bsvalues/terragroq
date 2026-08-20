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
    expect(headers.has("Content-Security-Policy")).toBe(false)
    expect(headers.has("Strict-Transport-Security")).toBe(false)
  })
})
