import { describe, expect, it } from "vitest"
import {
  getOperatorLoginSurface,
  getVisibleOperatorSecondaryActions,
} from "@/lib/operator-login-surface"

describe("operator login surface", () => {
  it("routes operators to the existing sign-in flow without changing auth behavior", () => {
    const surface = getOperatorLoginSurface()

    expect(surface.eyebrow).toBe("WilliamOS Operator Console")
    expect(surface.primaryAction).toMatchObject({
      label: "Sign in as operator",
      href: "/sign-in",
    })
  })

  it("keeps first-operator bootstrap and scoped access distinct", () => {
    const surface = getOperatorLoginSurface()

    expect(surface.secondaryActions).toContainEqual(
      expect.objectContaining({
        label: "Create first operator",
        href: "/sign-up",
      }),
    )
    expect(surface.notices.map((notice) => notice.body).join(" ")).toContain(
      "scoped access links under /access/[token]",
    )
  })

  it("hides first-operator bootstrap when signup is locked", () => {
    const surface = getOperatorLoginSurface()
    const actions = getVisibleOperatorSecondaryActions(surface, {
      signup: { open: false },
    })

    expect(actions).not.toContainEqual(
      expect.objectContaining({
        href: "/sign-up",
      }),
    )
    expect(actions).toContainEqual(
      expect.objectContaining({
        href: "#scoped-access",
      }),
    )
  })

  it("states that recovery is scaffolded but disabled", () => {
    const surface = getOperatorLoginSurface()

    expect(surface.notices).toContainEqual(
      expect.objectContaining({
        title: "Recovery is scaffolded, not enabled",
        tone: "disabled",
      }),
    )
  })

  it("does not claim Groq, xAI, public signup, or runtime authority", () => {
    const { prohibitedClaims: _prohibitedClaims, ...displaySurface } =
      getOperatorLoginSurface()
    const surfaceText = JSON.stringify(displaySurface)

    expect(surfaceText).not.toContain("Groq-powered")
    expect(surfaceText).not.toContain("xAI-powered")
    expect(surfaceText).not.toContain("public signup is available")
    expect(surfaceText).not.toContain("login grants")
  })
})
