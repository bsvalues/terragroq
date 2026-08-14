import { describe, expect, it } from "vitest"

import { projectConfiguredSystemRoleTruth, projectSystemTruth } from "@/lib/system/system-truth"

describe("system truth projection", () => {
  it("shares configured AEGIS role truth without claiming current liveness", () => {
    expect(projectConfiguredSystemRoleTruth("AEGIS")).toEqual({
      system: "AEGIS",
      signal: "worker-node",
      truthState: "inferred",
      observedAt: null,
      source: "issue #762 runtime topology contract",
      summary: "Configured as a worker node. Configuration describes role, not current liveness.",
    })
  })

  it("reports ATLAS live only when a current database query succeeds", () => {
    const observedAt = "2026-08-13T18:42:00.000Z"

    const [atlas] = projectSystemTruth([
      {
        system: "ATLAS",
        signal: "state-database",
        evidenceKind: "current-query",
        succeeded: true,
        observedAt,
        source: "operator-state database query",
        summary: "Read-model query returned.",
      },
    ])

    expect(atlas).toEqual({
      system: "ATLAS",
      signal: "state-database",
      truthState: "live",
      observedAt,
      source: "operator-state database query",
      summary: "Read-model query returned.",
    })
  })

  it("keeps recent HERMES and AEGIS events persisted rather than live", () => {
    const signals = projectSystemTruth([
      {
        system: "HERMES",
        signal: "coordinator-activity",
        evidenceKind: "persisted-event",
        observedAt: "2026-08-13T18:40:00.000Z",
        source: "governance_event",
        summary: "A coordinator event was recorded.",
      },
      {
        system: "AEGIS",
        signal: "worker-activity",
        evidenceKind: "persisted-event",
        observedAt: "2026-08-13T18:41:00.000Z",
        source: "governance_event",
        summary: "A worker event was recorded.",
      },
    ])

    expect(signals.map(({ system, truthState, observedAt, source }) => ({
      system,
      truthState,
      observedAt,
      source,
    }))).toEqual([
      {
        system: "HERMES",
        truthState: "persisted",
        observedAt: "2026-08-13T18:40:00.000Z",
        source: "governance_event",
      },
      {
        system: "AEGIS",
        truthState: "persisted",
        observedAt: "2026-08-13T18:41:00.000Z",
        source: "governance_event",
      },
    ])
  })

  it("labels configured system roles inferred without inventing an observation time", () => {
    expect(projectSystemTruth([
      {
        system: "HERMES",
        signal: "coordinator-role",
        evidenceKind: "configured",
        observedAt: null,
        source: "execution fabric configuration",
        summary: "Configured as the coordinator host.",
      },
    ])).toEqual([
      {
        system: "HERMES",
        signal: "coordinator-role",
        truthState: "inferred",
        observedAt: null,
        source: "execution fabric configuration",
        summary: "Configured as the coordinator host.",
      },
    ])
  })

  it("does not call a failed current ATLAS query live", () => {
    const [atlas] = projectSystemTruth([
      {
        system: "ATLAS",
        signal: "state-database",
        evidenceKind: "current-query",
        succeeded: false,
        observedAt: "2026-08-13T18:45:00.000Z",
        source: "operator-state database query",
        summary: "The read-model query did not complete successfully.",
      },
    ])

    expect(atlas).toMatchObject({
      system: "ATLAS",
      truthState: "unknown",
      observedAt: null,
      source: "operator-state database query",
    })
  })
})
