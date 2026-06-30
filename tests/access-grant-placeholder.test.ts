import { describe, expect, it } from "vitest"
import { getAccessGrantPlaceholderSurface } from "@/lib/access-grant-placeholder"

describe("access grant placeholder", () => {
  it("presents scoped access as preview-only", () => {
    const surface = getAccessGrantPlaceholderSurface()

    expect(surface.eyebrow).toBe("WilliamOS Scoped Access")
    expect(surface.statusLabel).toBe("Preview only")
    expect(surface.tokenPosture).toBe("Token observed, not validated")
  })

  it("does not claim token validation, account creation, or authority", () => {
    const surface = getAccessGrantPlaceholderSurface()
    const { blockedClaims: _blockedClaims, ...displaySurface } = surface
    const text = JSON.stringify(displaySurface)

    expect(text).toContain("does not create a user")
    expect(text).toContain("does not validate, persist, consume, or display")
    expect(text).toContain("Authority remains separate")
    expect(text).not.toContain("token validated")
    expect(text).not.toContain("account created")
    expect(text).not.toContain("public signup is available")
  })

  it("routes back to operator entry without enabling access", () => {
    const surface = getAccessGrantPlaceholderSurface()

    expect(surface.primaryAction).toMatchObject({
      label: "Return to operator entry",
      href: "/operator",
    })
  })

  it("keeps forbidden runtime and authority claims explicit", () => {
    const surface = getAccessGrantPlaceholderSurface()

    expect(surface.blockedClaims).toEqual(
      expect.arrayContaining([
        "operator authority",
        "Hermes activation",
        "MCP activation",
        "autonomy enabled",
      ]),
    )
  })
})
