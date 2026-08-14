// @vitest-environment jsdom

import React from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { SystemTruthPanel } from "@/components/systems/system-truth-panel"
import { projectSystemTruth } from "@/lib/system/system-truth"

describe("System status rendered surface", () => {
  afterEach(cleanup)

  it("renders source and observation independently without promoting configuration to live", () => {
    const signals = projectSystemTruth([
      {
        system: "ATLAS",
        signal: "state-database",
        evidenceKind: "current-query",
        succeeded: true,
        observedAt: "2026-08-14T10:10:00.000Z",
        source: "database readiness probe",
        summary: "Current query succeeded.",
      },
      {
        system: "HERMES",
        signal: "coordinator-app-host",
        evidenceKind: "configured",
        observedAt: null,
        source: "runtime topology",
        summary: "Configured role only.",
      },
    ])

    render(<SystemTruthPanel signals={signals} />)

    const atlas = screen.getByRole("heading", { name: "ATLAS" }).closest("li")
    const hermes = screen.getByRole("heading", { name: "HERMES" }).closest("li")
    if (!atlas || !hermes) throw new Error("System signal rows were not rendered")

    expect(atlas.textContent).toContain("live")
    expect(atlas.textContent).toContain("database readiness probe")
    expect(atlas.textContent).toContain("2026-08-14T10:10:00.000Z")
    expect(hermes.textContent).toContain("inferred")
    expect(hermes.textContent).toContain("runtime topology")
    expect(hermes.textContent).toContain("No live observation")
    expect(hermes.textContent).not.toContain("live2026")
  })

  it("renders the read-only authority boundary", () => {
    render(<SystemTruthPanel signals={[]} />)

    expect(screen.getByText("System is read-only. Configuration and persisted history never become live status.")).toBeTruthy()
  })
})
