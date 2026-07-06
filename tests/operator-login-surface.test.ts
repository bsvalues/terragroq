import { describe, expect, it } from "vitest"
import {
  getOperatorLoginSurface,
  getVisibleOperatorSecondaryActions,
} from "@/lib/operator-login-surface"

describe("operator login surface", () => {
  it("routes operators to Primary Access without changing auth behavior", () => {
    const surface = getOperatorLoginSurface()

    expect(surface.eyebrow).toBe("WilliamOS Operator Console")
    expect(surface.primaryAction).toMatchObject({
      label: "Enter as Primary Operator",
      href: "/sign-in",
    })
  })

  it("does not expose self-service owner provisioning from normal operator entry", () => {
    const surface = getOperatorLoginSurface()
    const actions = getVisibleOperatorSecondaryActions(surface, {
      signup: { open: true },
    })

    expect(surface.secondaryActions).not.toContainEqual(
      expect.objectContaining({
        href: "/sign-up",
      }),
    )
    expect(actions).not.toContainEqual(
      expect.objectContaining({
        href: "/sign-up",
      }),
    )
    expect(actions).toContainEqual(
      expect.objectContaining({
        href: "/access/preview",
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

  it("does not claim SaaS signup, workspace, team, or runtime authority", () => {
    const { prohibitedClaims: _prohibitedClaims, ...displaySurface } =
      getOperatorLoginSurface()
    const surfaceText = JSON.stringify(displaySurface)

    expect(surfaceText).not.toMatch(/Groq-powered|xAI-powered|public signup|login grants|signing into TerraGroq/i)
    expect(surfaceText).not.toMatch(/create account|create primary|request access|sign up|signup|workspace|team|organization|user onboarding/i)
  })
})
