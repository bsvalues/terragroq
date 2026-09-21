import { randomUUID } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  APPLICATION_PROPOSAL_LIST_LIMIT,
  addApplicationProposalToListIndex,
  bootstrapApplicationProposalListIndex,
  readApplicationProposalListIndex,
} from "@/lib/applications/proposal-list-index.mjs"

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function runtime() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "application-proposal-list-index-"))
  roots.push(parent)
  return path.join(parent, "runtime")
}

const proposalId = (index: number) => `${index.toString(16).padStart(8, "0")}-0000-4000-8000-${index.toString(16).padStart(12, "0")}`

describe("bounded application proposal list index", () => {
  it("retains only the newest fixed-cap proposal IDs and records truncation", () => {
    const runtimeRoot = runtime()
    bootstrapApplicationProposalListIndex({
      runtimeRoot,
      applicationId: "focus-board",
      describeProposal: () => { throw new Error("empty bootstrap must not describe a proposal") },
    })
    const ids = Array.from({ length: APPLICATION_PROPOSAL_LIST_LIMIT + 1 }, (_, index) => proposalId(index + 1))
    for (const [index, id] of ids.map((id, index) => [index, id] as const).reverse()) {
      addApplicationProposalToListIndex({
        runtimeRoot,
        applicationId: "focus-board",
        proposalId: id,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
        operationToken: randomUUID(),
      })
    }

    const state = readApplicationProposalListIndex({ runtimeRoot, applicationId: "focus-board" })
    expect(state.proposalIds).toHaveLength(APPLICATION_PROPOSAL_LIST_LIMIT)
    expect(state.proposalIds).toEqual(ids.slice(1))
    expect(state.truncated).toBe(true)
  })

  it("isolates indexes by application and refuses linked or malformed index artifacts", () => {
    const runtimeRoot = runtime()
    for (const applicationId of ["focus-board", "notes-pad"]) {
      bootstrapApplicationProposalListIndex({
        runtimeRoot,
        applicationId,
        describeProposal: () => { throw new Error("empty bootstrap must not describe a proposal") },
      })
      addApplicationProposalToListIndex({
        runtimeRoot,
        applicationId,
        proposalId: applicationId === "focus-board" ? proposalId(1) : proposalId(2),
        createdAt: "2026-01-01T00:00:00.000Z",
        operationToken: randomUUID(),
      })
    }
    expect(readApplicationProposalListIndex({ runtimeRoot, applicationId: "focus-board" }).proposalIds).toEqual([proposalId(1)])
    expect(readApplicationProposalListIndex({ runtimeRoot, applicationId: "notes-pad" }).proposalIds).toEqual([proposalId(2)])

    const indexPath = path.join(runtimeRoot, "application-proposals", "focus-board", ".listing.v1.json")
    const escaped = path.join(path.dirname(runtimeRoot), "escaped-listing.json")
    fs.renameSync(indexPath, escaped)
    fs.symlinkSync(escaped, indexPath, "file")
    expect(() => readApplicationProposalListIndex({ runtimeRoot, applicationId: "focus-board" }))
      .toThrow("APPLICATION_PROPOSAL_LISTING_UNCERTAIN")
    expect(fs.readFileSync(escaped, "utf8")).toContain(proposalId(1))
    fs.unlinkSync(indexPath)

    fs.linkSync(escaped, indexPath)
    expect(() => readApplicationProposalListIndex({ runtimeRoot, applicationId: "focus-board" }))
      .toThrow("APPLICATION_PROPOSAL_LISTING_UNCERTAIN")
    expect(fs.readFileSync(escaped, "utf8")).toContain(proposalId(1))
    fs.unlinkSync(indexPath)

    fs.writeFileSync(indexPath, "{\"schemaVersion\":1}\n")
    expect(() => readApplicationProposalListIndex({ runtimeRoot, applicationId: "focus-board" }))
      .toThrow("APPLICATION_PROPOSAL_LISTING_UNCERTAIN")
  })

  it("refuses a same-byte listing replacement during atomic update without deleting either file", () => {
    const runtimeRoot = runtime()
    bootstrapApplicationProposalListIndex({
      runtimeRoot,
      applicationId: "focus-board",
      describeProposal: () => { throw new Error("empty bootstrap must not describe a proposal") },
    })
    addApplicationProposalToListIndex({
      runtimeRoot,
      applicationId: "focus-board",
      proposalId: proposalId(1),
      createdAt: "2026-01-01T00:00:00.000Z",
      operationToken: randomUUID(),
    })
    const indexPath = path.join(runtimeRoot, "application-proposals", "focus-board", ".listing.v1.json")
    const displaced = path.join(path.dirname(runtimeRoot), "displaced-listing.json")
    const replacement = Buffer.from(fs.readFileSync(indexPath))
    expect(() => addApplicationProposalToListIndex({
      runtimeRoot,
      applicationId: "focus-board",
      proposalId: proposalId(2),
      createdAt: "2026-01-02T00:00:00.000Z",
      operationToken: randomUUID(),
      transactionOperations: {
        checkpoint(stage: string) {
          if (stage !== "before_index_private_open") return
          fs.renameSync(indexPath, displaced)
          fs.writeFileSync(indexPath, replacement)
        },
      },
    })).toThrow("APPLICATION_PROPOSAL_LISTING_UNCERTAIN")
    expect(fs.readFileSync(displaced)).toEqual(replacement)
    expect(fs.readFileSync(indexPath)).toEqual(replacement)
  })

  it("refuses a parent junction replacement before private creation without external residue", () => {
    const runtimeRoot = runtime()
    const directory = path.join(runtimeRoot, "application-proposals", "focus-board")
    const displaced = path.join(path.dirname(runtimeRoot), "displaced-focus-board")
    const escaped = path.join(path.dirname(runtimeRoot), "escaped-focus-board")
    fs.mkdirSync(escaped)
    try {
      expect(() => bootstrapApplicationProposalListIndex({
        runtimeRoot,
        applicationId: "focus-board",
        describeProposal: () => { throw new Error("empty bootstrap must not describe a proposal") },
        transactionOperations: {
          checkpoint(stage: string) {
            if (stage !== "before_index_private_open") return
            fs.renameSync(directory, displaced)
            fs.symlinkSync(escaped, directory, process.platform === "win32" ? "junction" : "dir")
          },
        },
      })).toThrow("APPLICATION_PROPOSAL_LISTING_UNCERTAIN")
      expect(fs.readdirSync(escaped)).toEqual([])
      expect(fs.readdirSync(displaced).some((name) => name.endsWith(".write"))).toBe(false)
    } finally {
      if (fs.existsSync(directory)) fs.rmdirSync(directory)
      if (fs.existsSync(displaced)) fs.renameSync(displaced, directory)
    }
  })

  it("refuses an unbounded legacy bootstrap and never scans the permanent store after publication", () => {
    const runtimeRoot = runtime()
    const directory = path.join(runtimeRoot, "application-proposals", "focus-board")
    fs.mkdirSync(directory, { recursive: true })
    for (let index = 0; index < 129; index += 1) fs.writeFileSync(path.join(directory, `legacy-${index}.patch`), "x")
    expect(() => bootstrapApplicationProposalListIndex({
      runtimeRoot,
      applicationId: "focus-board",
      describeProposal: () => { throw new Error("over-cap bootstrap must stop before description") },
    })).toThrow("APPLICATION_PROPOSAL_LISTING_UNCERTAIN")

    fs.rmSync(directory, { recursive: true, force: true })
    bootstrapApplicationProposalListIndex({
      runtimeRoot,
      applicationId: "focus-board",
      describeProposal: () => { throw new Error("empty bootstrap must not describe a proposal") },
    })
    const opendir = vi.spyOn(fs, "opendirSync").mockImplementation(() => {
      throw new Error("steady listing must not enumerate the permanent store")
    })
    expect(readApplicationProposalListIndex({ runtimeRoot, applicationId: "focus-board" }))
      .toEqual(expect.objectContaining({ proposalIds: [], truncated: false }))
    expect(opendir).not.toHaveBeenCalled()
  })

  it("preserves the prior index when an atomic update is interrupted", () => {
    const runtimeRoot = runtime()
    bootstrapApplicationProposalListIndex({
      runtimeRoot,
      applicationId: "focus-board",
      describeProposal: () => { throw new Error("empty bootstrap must not describe a proposal") },
    })
    addApplicationProposalToListIndex({
      runtimeRoot,
      applicationId: "focus-board",
      proposalId: proposalId(1),
      createdAt: "2026-01-01T00:00:00.000Z",
      operationToken: randomUUID(),
    })
    expect(() => addApplicationProposalToListIndex({
      runtimeRoot,
      applicationId: "focus-board",
      proposalId: proposalId(2),
      createdAt: "2026-01-02T00:00:00.000Z",
      operationToken: randomUUID(),
      transactionOperations: { checkpoint: () => { throw new Error("simulated index write interruption") } },
    })).toThrow("APPLICATION_PROPOSAL_LISTING_UNCERTAIN")
    expect(readApplicationProposalListIndex({ runtimeRoot, applicationId: "focus-board" }).proposalIds).toEqual([proposalId(1)])
  })
})
