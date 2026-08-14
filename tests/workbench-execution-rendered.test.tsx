// @vitest-environment jsdom

import React from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { WorkbenchExecution } from "@/components/workbench/workbench-execution"
import type { WorkbenchExecutionProjection } from "@/lib/workbench/execution-projection"

const drilldown = { mode: "EXACT" as const, href: "/audit?evidence=evidence%3A61#evidence-record-evidence-61" }

const projection: WorkbenchExecutionProjection = {
  availability: "available",
  scope: { projectId: 7, threadId: "thread-alpha" },
  truthState: "persisted",
  observedAt: "2026-08-14T12:30:00.000Z",
  latestPersistedAt: "2026-08-14T12:19:00.000Z",
  freshness: { state: "stale", detail: "The persisted active lease is expired." },
  work: {
    outcomes: [{ id: "OUT-7", title: "Usable cockpit", state: "active", updatedAt: "2026-08-14T12:10:00.000Z", drilldown: { mode: "REGISTER", href: "/goal-console" } }],
    workOrders: [{ id: 11, ref: "WO-11", title: "Implementation", state: "active", result: null, updatedAt: "2026-08-14T12:11:00.000Z", drilldown: { mode: "EXACT", href: "/work-orders#work-order-11" } }],
  },
  agents: [{ id: "agent-1", kind: "claim", agent: "codex", state: "EVIDENCE_BACKED", summary: "Persisted agent claim; not live telemetry.", occurredAt: "2026-08-14T12:12:00.000Z", truthState: "persisted", drilldown: { mode: "REGISTER", href: "/goal-console" } }],
  attempts: [{ attempt: 1, currentState: "CI_PASSED", updatedAt: "2026-08-14T12:15:00.000Z", checkpoints: [{ eventId: 81, sequence: 2, state: "CI_PASSED", detail: "Checkpoint persisted after CI", recordedAt: "2026-08-14T12:15:00.000Z", drilldown: { mode: "EXACT", href: "/trace?trace=trace%3A81#trace-record-trace-81" } }] }],
  validations: [{ id: "validation-1", state: "CI_PASSED", summary: "12 tests passed", occurredAt: "2026-08-14T12:15:00.000Z", truthState: "persisted", drilldown }],
  reviews: [{ id: "review-1", state: "REVIEW_APPROVED", summary: "Sovereign review passed", occurredAt: "2026-08-14T12:16:00.000Z", truthState: "persisted", drilldown }],
  remediations: [{ id: "remediation-1", state: "REMEDIATING", summary: "Repairing finding", occurredAt: "2026-08-14T12:17:00.000Z", truthState: "persisted", drilldown }],
  deliveries: [{ id: "delivery-1", state: "PR_MERGED", summary: "Merged", occurredAt: "2026-08-14T12:18:00.000Z", truthState: "persisted", drilldown }],
  events: [{ id: "event-1", state: "CI_PASSED", summary: "CI passed", occurredAt: "2026-08-14T12:15:00.000Z", truthState: "persisted", drilldown }],
  evidence: [{ id: "evidence-1", state: "PASS", summary: "Focused suite passed", occurredAt: "2026-08-14T12:14:00.000Z", truthState: "persisted", drilldown }],
  recoveries: [{ id: "recovery-1", state: "PROVIDER_RECOVERED", summary: "Worker recovered", occurredAt: "2026-08-14T12:19:00.000Z", truthState: "persisted", drilldown }],
  coverage: { truncated: true, truncatedKinds: ["governance_event"], missing: ["conversation"], conflicts: ["MIRROR_CONFLICT:81"] },
  controls: { terminal: false, steer: false, pause: false, stop: false },
}

describe("WorkbenchExecution rendered truth", () => {
  afterEach(cleanup)

  it("distinguishes a read failure from an empty selected Thread", () => {
    render(<WorkbenchExecution loadState="error" />)

    expect(screen.getByRole("alert").textContent).toBe(
      "Execution evidence could not be read. Thread context was not changed.",
    )
    expect(screen.getByText("No governed terminal protocol is available.")).toBeTruthy()
  })

  it("renders selected-Thread persisted truth, recovery, coverage, and fixed drilldowns", () => {
    render(<WorkbenchExecution loadState="ready" projection={projection} />)

    expect(screen.getByText("Persisted · stale")).toBeTruthy()
    expect(screen.getByText("The persisted active lease is expired.")).toBeTruthy()
    expect(screen.getByText("codex")).toBeTruthy()
    expect(screen.getByText("Usable cockpit")).toBeTruthy()
    expect(screen.getByText("Attempt 1 · CI_PASSED")).toBeTruthy()
    expect(screen.getByText("Checkpoint persisted after CI")).toBeTruthy()
    expect(screen.getByText("12 tests passed")).toBeTruthy()
    expect(screen.getByText("Sovereign review passed")).toBeTruthy()
    expect(screen.getByText("Worker recovered")).toBeTruthy()
    expect(screen.getByText(/Bounded execution history/)).toBeTruthy()
    expect(screen.getByText(/MIRROR_CONFLICT:81/)).toBeTruthy()
    expect(screen.getByRole("link", { name: "Open persisted proof" }).getAttribute("href")).toBe(drilldown.href)
    expect(screen.queryByRole("button", { name: /Terminal|Steer|Pause|Stop|Retry/i })).toBeNull()
  })

  it.each([
    ["unavailable", "No exact persisted execution membership is available for this Thread."],
    ["degraded", "Execution evidence is degraded. Only the explicitly bound records below are shown."],
  ] as const)("renders %s availability without implying live control", (availability, expected) => {
    render(<WorkbenchExecution
      loadState="ready"
      projection={{
        ...projection,
        availability,
        work: { outcomes: [], workOrders: [] },
        agents: [], attempts: [], validations: [], reviews: [], remediations: [],
        deliveries: [], events: [], evidence: [], recoveries: [],
      }}
    />)

    expect(screen.getByText(expected)).toBeTruthy()
    expect(screen.getByText("No governed terminal protocol is available.")).toBeTruthy()
  })

  it("distinguishes an empty bound projection from unavailable membership", () => {
    render(<WorkbenchExecution
      loadState="ready"
      projection={{
        ...projection,
        freshness: { state: "fresh", detail: null },
        work: { outcomes: [], workOrders: [] },
        agents: [], attempts: [], validations: [], reviews: [], remediations: [],
        deliveries: [], events: [], evidence: [], recoveries: [],
        coverage: { truncated: false, truncatedKinds: [], missing: [], conflicts: [] },
      }}
    />)

    expect(screen.getByText("No explicit execution records are bound to this Thread.")).toBeTruthy()
    expect(screen.queryByText(/No exact persisted execution membership/)).toBeNull()
  })
})
