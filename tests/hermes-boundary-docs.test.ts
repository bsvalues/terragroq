import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const docs = {
  doctrine: "docs/governance/hermes-sidecar-boundary-doctrine.md",
  stateModel: "docs/governance/hermes-state-model.md",
  workerPacket: "docs/governance/hermes-worker-packet-schema.md",
  activationReview: "docs/governance/hermes-activation-review-packet-schema.md",
  authorityRules: "docs/governance/hermes-authority-boundary-rules.md",
  deniedUx: "docs/governance/hermes-denied-blocked-ux-doctrine.md",
  relationshipMap: "docs/governance/hermes-relationship-map.md",
  safetyMatrix: "docs/governance/hermes-safety-classification-matrix.md",
  revocation: "docs/governance/hermes-revocation-expiration-doctrine.md",
  academy: "docs/academy/operator-training/safe-hermes-use.md",
  wiki: "docs/wiki/concepts/hermes-boundary.md",
  safetySweep: "docs/reports/WO-HERMES-011-hermes-boundary-safety-sweep.md",
  rollup: "docs/reports/WO-HERMES-012-hermes-boundary-rollup-next-lane.md",
} as const

function readDoc(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8")
}

describe("Hermes boundary doctrine docs", () => {
  it("creates the required Hermes doctrine and schema documents", () => {
    for (const path of Object.values(docs)) {
      expect(readDoc(path).trim().length).toBeGreaterThan(200)
    }
  })

  it("keeps Hermes disabled by default and blocks runtime activation", () => {
    const doctrine = readDoc(docs.doctrine)
    const safety = readDoc(docs.safetySweep)

    expect(doctrine).toContain("Hermes is disabled by default")
    expect(doctrine).toContain("Hermes cannot execute commands, tools, MCP, workers, or sidecar processes in this lane")
    expect(safety).toContain("Hermes activation: not added")
    expect(safety).toContain("MCP activation: not added")
    expect(safety).toContain("worker runtime: not added")
    expect(safety).toContain("command runner: not added")
  })

  it("defines the requested state model without runtime state machinery", () => {
    const stateModel = readDoc(docs.stateModel)

    expect(stateModel).toContain("`DISABLED`")
    expect(stateModel).toContain("`PROPOSED`")
    expect(stateModel).toContain("`BLOCKED`")
    expect(stateModel).toContain("`REVIEW_READY`")
    expect(stateModel).toContain("`AUTHORIZED`")
    expect(stateModel).toContain("`ACTIVE_LIMITED_FUTURE` is only a named future state")
    expect(stateModel).toContain("not a runtime state machine")
  })

  it("defines worker and activation review packets as non-executable artifacts", () => {
    const workerPacket = readDoc(docs.workerPacket)
    const activationReview = readDoc(docs.activationReview)

    expect(workerPacket).toContain("`production_write_allowed`: `false`")
    expect(workerPacket).toContain("`command_execution_allowed`: `false`")
    expect(workerPacket).toContain("A packet is not permission")
    expect(activationReview).toContain("No activation without explicit Owner authority")
    expect(activationReview).toContain("No broad wildcard permissions")
  })

  it("documents denied UX, authority boundaries, safety classes, and revocation", () => {
    expect(readDoc(docs.deniedUx)).toContain("Hermes is disabled by design")
    expect(readDoc(docs.authorityRules)).toContain("Hermes authority is never self-granted")
    expect(readDoc(docs.safetyMatrix)).toContain("`COMMAND_EXECUTION`")
    expect(readDoc(docs.safetyMatrix)).toContain("only doctrine and static docs are allowed")
    expect(readDoc(docs.revocation)).toContain("Revoked Hermes cannot continue")
  })

  it("adds Academy and Wiki linkage without granting activation", () => {
    const academy = readDoc(docs.academy)
    const wiki = readDoc(docs.wiki)

    expect(academy).toContain("Not an active worker")
    expect(academy).toContain("A Worker Packet is not permission and does not execute")
    expect(wiki).toContain("Hermes is not active in the current system")
    expect(wiki).toContain("explicit Owner authority")
  })

  it("rolls up the lane with Hermes activation still blocked", () => {
    const rollup = readDoc(docs.rollup)

    expect(rollup).toContain("GOAL-WOS-002 - Work Order Engine Integration")
    expect(rollup).toContain("Hermes activation remains blocked")
    expect(rollup).toContain("This batch added doctrine, schemas, review language, safety classification, revocation doctrine, Academy training, Wiki linkage, and reports only")
  })
})
