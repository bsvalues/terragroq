import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const page = readFileSync("app/(shell)/runtime/page.tsx", "utf8")
const panel = readFileSync("components/systems/system-truth-panel.tsx", "utf8")
const shell = readFileSync("components/workbench/workbench-shell.tsx", "utf8")

describe("SYSTEM cockpit", () => {
  it("grounds ATLAS in a current database readiness query", () => {
    expect(page).toContain("getAuthReadiness({ probeDatabase: true })")
    expect(page).toContain('evidenceKind: "current-query"')
    expect(page).toContain("succeeded: systemReadiness.databaseReady")
    expect(page).toContain("observedAt: systemReadiness.checkedAt")
  })

  it("keeps HERMES and AEGIS configuration separate from liveness", () => {
    expect(page.match(/evidenceKind: "configured"/g)).toHaveLength(2)
    expect(page).toContain('system: "HERMES"')
    expect(page).toContain('system: "AEGIS"')
    expect(page).toContain("Configuration describes role, not current liveness")
  })

  it("renders per-signal truth and provenance instead of the static status surface", () => {
    expect(page).toContain("<SystemTruthPanel signals={systemTruth}")
    expect(page).not.toContain("<SystemsStatusPanel")
    expect(panel).toContain("signal.truthState")
    expect(panel).toContain("signal.source")
    expect(panel).toContain("signal.observedAt")
    expect(panel).toContain("read-only")
  })

  it("still renders ATLAS unknown when supporting database readers are unavailable", () => {
    expect(page).toContain("async function RuntimeSupportingPanels")
    expect(page).toContain("if (!databaseReady)")
    expect(page).toContain("try {")
    expect(page).toContain("catch {")
    expect(page).toContain("Supporting persisted runtime panels are unavailable")
    expect(page).toContain("databaseReady={systemReadiness.databaseReady}")
  })

  it("does not present configuration or owner-run commands as live SYSTEM state", () => {
    expect(page).toContain("Configured runtime · source")
    expect(page).not.toContain("Active runtime · source")
    expect(page).not.toContain("<LocalOperatorPanel")
    expect(shell).toContain("AEGIS</b> unknown")
    expect(shell).toContain("model configured:")
    expect(shell).not.toContain("gateway online")
    expect(shell).not.toContain("bg-success")
  })
})
