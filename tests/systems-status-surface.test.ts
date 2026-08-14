import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { projectSystemTruth } from "@/lib/system/system-truth"

describe("SYSTEM status surface", () => {
  it("never promotes configured roles to live status", () => {
    const rows = projectSystemTruth([
      {
        system: "HERMES",
        signal: "coordinator-app-host",
        evidenceKind: "configured",
        observedAt: null,
        source: "runtime topology",
        summary: "Configured role only.",
      },
    ])

    expect(rows[0]).toMatchObject({ truthState: "inferred", observedAt: null })
  })

  it("labels source and observation independently for every rendered signal", () => {
    const source = readFileSync("components/systems/system-truth-panel.tsx", "utf8")

    expect(source).toContain("signal.truthState")
    expect(source).toContain("signal.source")
    expect(source).toContain("signal.observedAt")
    expect(source).toContain("Configuration and persisted history never become live status")
  })

  it("preserves the read-only authority boundary", () => {
    const source = readFileSync("components/systems/system-truth-panel.tsx", "utf8")

    expect(source).toContain("SYSTEM is read-only")
    expect(source).toContain("does not start, stop, repair, deploy, or grant authority")
  })
})
