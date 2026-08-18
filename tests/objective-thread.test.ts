import { describe, expect, it } from "vitest"

import { buildThreadItems, summariseThread } from "../lib/objective/thread"
import type { ResourceRecord } from "../lib/resource/resolve"

const record: ResourceRecord = {
  identity: "PACS",
  project: { key: "terrafusion", name: "TerraFusion" },
  workloadOwner: { identity: "aegis", label: "AEGIS" },
  sources: [{ identity: "atlas:/forge/sources/pacs/pacs_oltp.bak", label: "102 GB backup", type: "data_source" }],
  runtime: [],
  derivatives: [{ identity: "omen:terrafusion_benton_demo", label: "capture", type: "database" }],
  completionEvidence: [{ identity: "atlas:/forge/mssql/data", label: "738 GB restore" }],
  allowedOperations: ["read", "verify", "restore"],
  ratified: false,
}

const reconciliation = {
  identity: "PACS",
  classification: "CONFLICTING" as const,
  agreements: [],
  disagreements: [
    { what: "restore", declared: "aegis", recorded: "atlas", detail: "atlas:/forge/mssql/data is recorded on atlas, but aegis is declared" },
  ],
  severity: "high" as const,
  summary: "PACS is declared to aegis, but recorded artefacts sit on atlas.",
  provisional: true,
}

const verification = {
  observedAt: "2026-08-18T23:00:00.000Z",
  probed: 4,
  confirmed: 2,
  contradicted: 0,
  unreachable: 0,
  observations: [{ identity: "atlas:/forge/sources/pacs/pacs_oltp.bak", detail: "present at the recorded size", agrees: true }],
}

const objective = "Determine what the recovered OMEN Benton database is…"

describe("returning the answer to the thread that asked", () => {
  it("opens with the objective as recorded owner intent", () => {
    const items = buildThreadItems({ workOrderRef: "WO-0004", objective, record, reconciliation: null, refusal: null, verification: null })
    expect(items[0]).toMatchObject({ kind: "OWNER_INTENT", basis: "PERSISTED", state: "RECORDED" })
    expect(items[0].source).toEqual({ type: "work_order", id: "WO-0004" })
  })

  it("distinguishes what was recorded from what was observed", () => {
    // The distinction the whole outcome turns on: a record is not a sighting.
    const items = buildThreadItems({ workOrderRef: "WO-0004", objective, record, reconciliation, refusal: null, verification })
    const recordItem = items.find((item) => item.source.type === "resource")
    const observedItem = items.find((item) => item.basis === "LIVE_OBSERVATION")
    expect(recordItem).toMatchObject({ basis: "PERSISTED", state: "RECORDED" })
    expect(observedItem).toMatchObject({ basis: "LIVE_OBSERVATION", state: "CURRENT" })
  })

  it("does not claim a record is current merely because it exists", () => {
    const items = buildThreadItems({ workOrderRef: "WO-0004", objective, record, reconciliation: null, refusal: null, verification: null })
    expect(items.every((item) => item.state !== "CURRENT")).toBe(true)
  })

  it("says the record is unratified rather than presenting it as settled", () => {
    const items = buildThreadItems({ workOrderRef: "WO-0004", objective, record, reconciliation: null, refusal: null, verification: null })
    expect(items.find((item) => item.source.type === "resource")?.summary).toContain("not ratified")
  })

  it("carries the contradiction as CONFLICTING rather than burying it", () => {
    const items = buildThreadItems({ workOrderRef: "WO-0004", objective, record, reconciliation, refusal: null, verification: null })
    const validation = items.find((item) => item.source.type === "reconciliation")
    expect(validation?.state).toBe("CONFLICTING")
    expect(validation?.detail?.[0]).toContain("recorded on atlas")
  })

  it("reports an observation that contradicts the record as CONFLICTING too", () => {
    const items = buildThreadItems({
      workOrderRef: "WO-0004",
      objective,
      record,
      reconciliation: null,
      refusal: null,
      verification: { ...verification, contradicted: 1 },
    })
    expect(items.find((item) => item.basis === "LIVE_OBSERVATION")?.state).toBe("CONFLICTING")
  })

  it("does not claim currency when a node could not be reached", () => {
    const items = buildThreadItems({
      workOrderRef: "WO-0004",
      objective,
      record,
      reconciliation: null,
      refusal: null,
      verification: { ...verification, unreachable: 1 },
    })
    expect(items.find((item) => item.basis === "LIVE_OBSERVATION")?.state).toBe("UNKNOWN")
  })

  it("includes the refusal as a decision, with its reason", () => {
    const items = buildThreadItems({
      workOrderRef: "WO-0004",
      objective,
      record,
      reconciliation: null,
      refusal: { operation: "restore", refusal: "BLOCKED_BY_CONFLICT", detail: "CONFLICT-0001 is open" },
      verification: null,
    })
    const decision = items.find((item) => item.kind === "DECISION")
    expect(decision?.summary).toContain("restore was refused")
    expect(decision?.detail?.[0]).toContain("CONFLICT-0001")
  })

  it("answers plainly when the resource is not declared at all", () => {
    const items = buildThreadItems({ workOrderRef: "WO-0004", objective, record: null, reconciliation: null, refusal: null, verification: null })
    expect(items[1]).toMatchObject({ basis: "UNKNOWN", state: "MISSING" })
  })

  it("summarises from the items, so the summary cannot drift from them", () => {
    const conflicted = buildThreadItems({ workOrderRef: "WO-0004", objective, record, reconciliation, refusal: null, verification })
    expect(summariseThread(conflicted)).toContain("unresolved contradiction")

    const clean = buildThreadItems({ workOrderRef: "WO-0004", objective, record, reconciliation: null, refusal: null, verification })
    expect(summariseThread(clean)).toContain("confirmed by observation")
  })
})
