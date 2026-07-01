import { describe, expect, it } from "vitest"
import { getReadinessNativeArea } from "@/components/runtime/readiness-native-area"

describe("Readiness native area", () => {
  it("frames Readiness as WilliamOS pre-action safety", () => {
    const area = getReadinessNativeArea()

    expect(area.title).toBe("Readiness")
    expect(area.eyebrow).toBe("WilliamOS Pre-Action Safety")
    expect(area.description).toContain("pre-action safety layer")
    expect(area.description).toContain("safe to proceed")
  })

  it("shows production, auth, security, access-grant, authority, and no-action signals", () => {
    const area = getReadinessNativeArea()
    const signals = new Map(area.signals.map((signal) => [signal.label, signal.state]))

    expect(signals.get("Production health")).toBe("verified")
    expect(signals.get("Auth readiness")).toBe("configured")
    expect(signals.get("Security headers")).toBe("verified")
    expect(signals.get("Access Grants")).toBe("disabled")
    expect(signals.get("Authority")).toBe("requires authority")
    expect(signals.get("Action")).toBe("no action taken")
  })

  it("keeps endpoint behavior, remediation, and runtime authority blocked or unchanged", () => {
    const area = getReadinessNativeArea()
    const boundaries = new Map(area.boundaries.map((boundary) => [boundary.label, boundary.blocked]))

    expect(boundaries.get("Endpoint behavior")).toBe("unchanged")
    expect(boundaries.get("Remediation")).toBe("blocked")
    expect(boundaries.get("Runtime authority")).toBe("blocked")
  })

  it("does not change readiness, auth, production checks, DB, env, deploy, or autonomy", () => {
    const area = getReadinessNativeArea()

    expect(area.safety).toEqual({
      readOnly: true,
      changesReadinessEndpoint: false,
      changesAuthBehavior: false,
      changesProductionChecks: false,
      mutatesDatabase: false,
      changesSchema: false,
      changesEnv: false,
      changesPackages: false,
      changesVercelSettings: false,
      deploys: false,
      releases: false,
      tags: false,
      activatesHermes: false,
      activatesMcp: false,
      enablesAutonomy: false,
      writesProduction: false,
    })
  })

  it("avoids generic health dashboard and auto-remediation copy", () => {
    const area = getReadinessNativeArea()
    const text = [
      area.title,
      area.eyebrow,
      area.description,
      ...area.signals.flatMap((signal) => [
        signal.label,
        signal.state,
        signal.description,
      ]),
      ...area.boundaries.flatMap((boundary) => [
        boundary.label,
        boundary.blocked,
        boundary.description,
      ]),
    ].join(" ")

    expect(text).not.toMatch(
      /uptime dashboard|DevOps console|admin health|team status|auto-remediate|one-click fix/i,
    )
  })
})
