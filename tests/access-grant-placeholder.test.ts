import { describe, expect, it } from "vitest"
import { getAccessGrantPlaceholderSurface } from "@/lib/access-grant-placeholder"

describe("access grant placeholder", () => {
  it("presents access grants as disabled and owner-gated", () => {
    const surface = getAccessGrantPlaceholderSurface()

    expect(surface.eyebrow).toBe("WilliamOS Access Grants")
    expect(surface.statusLabel).toBe("Disabled")
    expect(surface.tokenPosture).toBe("Token observed; no validation active")
    expect(surface.description).toContain("future controlled-access path")
    expect(surface.description).toContain("owner activation")
  })

  it("does not claim token validation, account creation, or authority", () => {
    const surface = getAccessGrantPlaceholderSurface()
    const { blockedClaims: _blockedClaims, ...displaySurface } = surface
    const text = JSON.stringify(displaySurface)

    expect(text).toContain("does not create a user")
    expect(text).toContain("does not validate, persist, consume, display, or exchange")
    expect(text).toContain("Authority remains separate")
    expect(text).not.toContain("token validated")
    expect(text).not.toContain("account created")
    expect(text).not.toContain("public signup is available")
  })

  it("makes issue, accept, validation, and owner activation gates explicit", () => {
    const surface = getAccessGrantPlaceholderSurface()
    const readiness = new Map(surface.readiness.map((item) => [item.label, item]))

    expect(readiness.get("Issue route")).toMatchObject({
      value: "disabled",
    })
    expect(readiness.get("Accept route")).toMatchObject({
      value: "disabled",
    })
    expect(readiness.get("Validation")).toMatchObject({
      value: "not active",
    })
    expect(readiness.get("Authority gate")).toMatchObject({
      value: "owner activation required",
    })
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
        "issue route enabled",
        "accept route enabled",
        "validation active",
        "live access",
        "operator authority",
        "Hermes activation",
        "MCP activation",
        "autonomy enabled",
      ]),
    )
  })

  it("avoids invite, signup, team onboarding, and token-magic copy", () => {
    const surface = getAccessGrantPlaceholderSurface()
    const { blockedClaims: _blockedClaims, ...displaySurface } = surface
    const text = JSON.stringify(displaySurface)

    expect(text).not.toMatch(
      /invite users|send invite|accept invite|grant access now|team onboarding|sign up|activate now|live access|token magic/i,
    )
  })
})
