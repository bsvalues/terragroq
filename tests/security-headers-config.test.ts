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
    expect(headers.get("X-Frame-Options")).toBe("DENY")
    expect(headers.get("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=()")
    expect(headers.has("Content-Security-Policy")).toBe(false)
    expect(headers.has("Strict-Transport-Security")).toBe(false)
  })
})
