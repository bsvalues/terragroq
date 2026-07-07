import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const governanceDoc = (file: string) => `docs/governance/${file}`
const academyDoc = (file: string) => `docs/academy/operator-training/${file}`
const wikiDoc = (file: string) => `docs/wiki/concepts/${file}`
const reportDoc = (file: string) => `docs/reports/${file}`

const docs = {
  doctrine: governanceDoc("hermes-sidecar-boundary-doctrine.md"),
  stateModel: governanceDoc("hermes-state-model.md"),
  workerPacket: governanceDoc("hermes-worker-packet-schema.md"),
  activationReview: governanceDoc("hermes-activation-review-packet-schema.md"),
  authorityRules: governanceDoc("hermes-authority-boundary-rules.md"),
  deniedUx: governanceDoc("hermes-denied-blocked-ux-doctrine.md"),
  relationshipMap: governanceDoc("hermes-relationship-map.md"),
  safetyMatrix: governanceDoc("hermes-safety-classification-matrix.md"),
  revocation: governanceDoc("hermes-revocation-expiration-doctrine.md"),
  academy: academyDoc("safe-hermes-use.md"),
  wiki: wikiDoc("hermes-boundary.md"),
  safetySweep: reportDoc("WO-HERMES-028-hermes-boundary-safety-sweep.md"),
  rollup: reportDoc("WO-HERMES-029-hermes-boundary-rollup-next-lane.md"),
} as const

function readDoc(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8")
}

describe("Hermes boundary doctrine docs", () => {
  it("creates the required Hermes doctrine and schema documents", () => {
    expect(readDoc(docs.doctrine)).toContain("# Hermes Sidecar Boundary Doctrine")
    expect(readDoc(docs.stateModel)).toContain("# Hermes State Model")
    expect(readDoc(docs.workerPacket)).toContain("# Hermes Worker Packet Schema")
    expect(readDoc(docs.activationReview)).toContain("# Hermes Activation Review Packet Schema")
    expect(readDoc(docs.authorityRules)).toContain("# Hermes Authority Boundary Rules")
    expect(readDoc(docs.deniedUx)).toContain("# Hermes Denied / Blocked UX Doctrine")
    expect(readDoc(docs.relationshipMap)).toContain("# Hermes Relationship Map")
    expect(readDoc(docs.safetyMatrix)).toContain("# Hermes Safety Classification Matrix")
    expect(readDoc(docs.revocation)).toContain("# Hermes Revocation and Expiration Doctrine")
    expect(readDoc(docs.academy)).toContain("# Safe Hermes Use")
    expect(readDoc(docs.wiki)).toContain("# Hermes Boundary")
    expect(readDoc(docs.safetySweep)).toContain("# WO-HERMES-028 - Hermes Boundary Safety Sweep")
    expect(readDoc(docs.rollup)).toContain("# WO-HERMES-029 - Hermes Boundary Rollup + Next-Lane Decision")
  })

  it("keeps Hermes report filename and heading work-order ids aligned and unique", () => {
    const reportRecords: { file: string; filenameId: string; headingId?: string }[] = []

    for (const file of readdirSync(join(process.cwd(), "docs/reports"))) {
      const filenameId = file.match(/^(WO-HERMES-\d+)/)?.[1]

      if (!filenameId) {
        continue
      }

      const content = readDoc(reportDoc(file))
      const headingId = content.match(/^# (WO-HERMES-\d+)/m)?.[1]

      reportRecords.push({ file, filenameId, headingId })
    }

    const missingHeadingIds = reportRecords.filter((record) => !record.headingId)
    const headingIds = reportRecords.map((record) => record.headingId)
    const filenameIds = reportRecords.map((record) => record.filenameId)
    const uniqueHeadingIds = new Set(headingIds)

    expect(missingHeadingIds).toEqual([])
    expect(filenameIds).toEqual(headingIds)
    expect(uniqueHeadingIds.size).toBe(headingIds.length)
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
    expect(readDoc(docs.doctrine)).toContain("the Owner has explicitly approved")
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
