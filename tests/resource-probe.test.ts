import { describe, expect, it } from "vitest"

import { isSafeProbePath, probeCommand, probeTargetsFor, readObservation, recordedBytesFrom } from "../lib/resource/probe"
import type { ResourceRecord } from "../lib/resource/resolve"

const record = (over: Partial<ResourceRecord> = {}): ResourceRecord => ({
  identity: "PACS",
  project: { key: "terrafusion", name: "TerraFusion" },
  workloadOwner: { identity: "aegis", label: "AEGIS" },
  sources: [],
  runtime: [],
  derivatives: [],
  completionEvidence: [],
  allowedOperations: ["read", "verify"],
  ratified: false,
  ...over,
})

describe("choosing what may be looked at", () => {
  it("takes the node and path from the recorded identity", () => {
    const targets = probeTargetsFor(
      record({ completionEvidence: [{ identity: "atlas:/forge/mssql/data", label: "738 GB restore" }] }),
    )
    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({ node: "atlas", path: "/forge/mssql/data", kind: "exists-size" })
  })

  it("skips an identity with no node, rather than choosing a machine", () => {
    // Choosing a machine for a bare path is the inference this whole outcome exists to replace.
    const targets = probeTargetsFor(record({ sources: [{ identity: "/forge/x.bak", label: "x", type: "data_source" }] }))
    expect(targets).toEqual([])
  })

  it("reads the recorded size out of the label", () => {
    expect(recordedBytesFrom("PACS OLTP backup, 102,359,101,440 bytes; VERIFY_RESULT=PASS")).toBe(102359101440)
    expect(recordedBytesFrom("no size stated")).toBeNull()
  })
})

describe("a path can never become a command", () => {
  it("refuses anything that could influence a shell", () => {
    for (const path of [
      "/forge/x; rm -rf /",
      "/forge/$(whoami)",
      "/forge/`id`",
      "/forge/x'y",
      "/forge/x\ny",
      "/forge/x|cat",
      "/forge/x&&id",
    ]) {
      expect(isSafeProbePath(path)).toBe(false)
    }
  })

  it("accepts ordinary paths on both platforms", () => {
    expect(isSafeProbePath("/forge/sources/pacs/pacs_oltp_backup_2026_01_15_170502_7994110.bak")).toBe(true)
    expect(isSafeProbePath("C:/HermesLab/runtime")).toBe(true)
  })

  it("skips an unsafe path when selecting targets, so it never reaches a command", () => {
    const targets = probeTargetsFor(
      record({ completionEvidence: [{ identity: "atlas:/forge/$(id)", label: "hostile" }] }),
    )
    expect(targets).toEqual([])
  })

  it("throws rather than emitting a command for an unsafe path", () => {
    expect(() =>
      probeCommand({ identity: "atlas:x", node: "atlas", path: "/forge/`id`", kind: "exists-size", recordedBytes: null }),
    ).toThrowError(/PROBE_PATH_REFUSED/)
  })

  it("builds the same shape of command regardless of the record", () => {
    const command = probeCommand({
      identity: "atlas:/forge/mssql/data",
      node: "atlas",
      path: "/forge/mssql/data",
      kind: "exists-size",
      recordedBytes: null,
    })
    expect(command).toContain("/forge/mssql/data")
    expect(command).toContain("du -sb")
    // Read-only by construction: nothing in the catalogue writes.
    expect(command).not.toMatch(/rm |mv |cp |tee |> /)
  })
})

describe("comparing what was seen against what was recorded", () => {
  const target = {
    identity: "atlas:/forge/sources/pacs/pacs_oltp.bak",
    node: "atlas",
    path: "/forge/sources/pacs/pacs_oltp.bak",
    kind: "exists-size" as const,
    recordedBytes: 102359101440,
  }

  it("confirms the record when the size matches", () => {
    const observation = readObservation(target, "102359101440\n")
    expect(observation.exists).toBe(true)
    expect(observation.agrees).toBe(true)
  })

  it("contradicts the record when the size differs, and states both numbers", () => {
    const observation = readObservation(target, "99\n")
    expect(observation.agrees).toBe(false)
    expect(observation.detail).toContain("99")
    expect(observation.detail).toContain("102359101440")
  })

  it("reports a missing artefact as absent rather than as an error", () => {
    const observation = readObservation(target, "MISSING")
    expect(observation.exists).toBe(false)
    expect(observation.agrees).toBe(false)
  })

  it("does not claim agreement when the record states no size", () => {
    // Saying "agrees" here would invent a check that never happened.
    const observation = readObservation({ ...target, recordedBytes: null }, "512\n")
    expect(observation.agrees).toBeNull()
    expect(observation.observedBytes).toBe(512)
  })
})
