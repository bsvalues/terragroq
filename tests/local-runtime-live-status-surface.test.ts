import { describe, expect, it } from "vitest"

import {
  LOCAL_RUNTIME_BOUNDARY_ITEMS,
  LOCAL_RUNTIME_EVIDENCE_REFERENCES,
  LOCAL_RUNTIME_SEMANTIC_ITEMS,
  LOCAL_RUNTIME_STATE_EXPLAINERS,
  LOCAL_RUNTIME_STATUS_BOUNDARY_COPY,
} from "@/components/local/local-runtime-live-status-surface"

describe("Local runtime live status surface model", () => {
  it("shows static read-only evidence references for the first live status slice", () => {
    expect(LOCAL_RUNTIME_EVIDENCE_REFERENCES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "docs/reports/WO-LOCAL-079-get-only-local-runtime-status-api.md",
        }),
        expect.objectContaining({
          path: "docs/reports/WO-LOCAL-081-runtime-surface-live-status-integration.md",
        }),
        expect.objectContaining({
          path: "docs/reports/WO-LOCAL-107-resume-williamos-proof-image-refresh.md",
        }),
      ]),
    )

    for (const reference of LOCAL_RUNTIME_EVIDENCE_REFERENCES) {
      expect(reference.path).toMatch(/^docs\/reports\//)
      expect(reference.summary).not.toContain("DATABASE_URL")
      expect(reference.summary).not.toContain("BETTER_AUTH_SECRET")
    }
  })

  it("keeps the UI copy scoped to status display rather than local control", () => {
    const copy = Object.values(LOCAL_RUNTIME_STATUS_BOUNDARY_COPY).join(" ")

    expect(copy).toContain("WilliamOS reports local runtime posture")
    expect(copy).toContain("Host-loopback checks may show unknown")
    expect(copy).toContain("refreshed OMEN app image")
    expect(copy).toContain("No start, stop, restart, repair")
    expect(copy).toContain("command execution")
    expect(copy).not.toContain("Run wrapper")
    expect(copy).not.toContain("Execute wrapper")
    expect(copy).not.toContain("Start Docker")
    expect(copy).not.toContain("Reset Docker")
  })

  it("explains all supported states without implying automated repair", () => {
    expect(LOCAL_RUNTIME_STATE_EXPLAINERS.map((item) => item.state)).toEqual([
      "ready",
      "degraded",
      "stopped",
      "unknown",
      "stale",
    ])

    const explainerText = LOCAL_RUNTIME_STATE_EXPLAINERS
      .map((item) => `${item.meaning} ${item.operatorGuidance}`)
      .join(" ")

    expect(explainerText).toContain("manual wrappers")
    expect(explainerText).toContain("proof container namespace")
    expect(explainerText).toContain("not as permission to repair automatically")
    expect(explainerText).not.toContain("Click to start")
    expect(explainerText).not.toContain("Auto-repair")
  })

  it("separates status route, host-loopback checks, and the compatibility alias", () => {
    expect(LOCAL_RUNTIME_SEMANTIC_ITEMS).toEqual([
      expect.objectContaining({
        label: "Status route",
        description: expect.stringContaining("Route/status API truth"),
      }),
      expect.objectContaining({
        label: "Host-loopback checks",
        description: expect.stringContaining("separate from route status"),
      }),
      expect.objectContaining({
        label: "Compatibility alias",
        description: expect.stringContaining("not the primary operator-facing concept"),
      }),
    ])

    const text = LOCAL_RUNTIME_SEMANTIC_ITEMS.map((item) => item.description).join(" ")

    expect(text).toContain("checks.appHttp")
    expect(text).toContain("checks.app")
    expect(text).not.toContain("Start app")
    expect(text).not.toContain("Stop app")
  })

  it("keeps boundary chips focused on blocked capabilities rather than metadata expansion", () => {
    expect(LOCAL_RUNTIME_BOUNDARY_ITEMS).toContain("No UI command execution")
    expect(LOCAL_RUNTIME_BOUNDARY_ITEMS).toContain("No Docker metadata")
    expect(LOCAL_RUNTIME_BOUNDARY_ITEMS).toContain("No backup metadata")
    expect(LOCAL_RUNTIME_BOUNDARY_ITEMS).toContain("No port status")
    expect(LOCAL_RUNTIME_BOUNDARY_ITEMS).toContain("No persistence or LAN exposure")
  })
})
