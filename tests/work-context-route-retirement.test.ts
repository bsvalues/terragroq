import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({
  getSession: vi.fn(),
  poolQuery: vi.fn(),
  appendGovernanceEvent: vi.fn(),
}))

vi.mock("@/lib/session", () => ({ getSession: seams.getSession }))
vi.mock("@/lib/db", () => ({ pool: { query: seams.poolQuery } }))
vi.mock("@/lib/governance/events", () => ({ appendGovernanceEvent: seams.appendGovernanceEvent }))

import { POST } from "@/app/api/governance/work-context/route"

describe("legacy work-context issuance retirement", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    seams.getSession.mockResolvedValue({ user: { id: "owner-1" } })
  })

  it("refuses to mint a new receipt merely because a client presents work-order claims", async () => {
    const response = await POST(new Request("http://localhost/api/governance/work-context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workOrderRef: "WO-NEW-FOR-THIS-PR",
        existingSubsystem: "integrating",
        topologySource: "canonical-registry",
        collisions: [],
        remainingParentAcceptance: "keep working",
      }),
    }))

    expect(response.status).toBe(410)
    expect(await response.json()).toEqual({
      error: "LEGACY_WORK_CONTEXT_RECEIPT_RETIRED",
      detail: "Delivery authority comes from an existing Space-bound assignment; this endpoint cannot mint it.",
    })
    expect(seams.poolQuery).not.toHaveBeenCalled()
    expect(seams.appendGovernanceEvent).not.toHaveBeenCalled()
  })

  it("the legacy CLI cannot create a local or ledger receipt", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "retired-work-context-"))
    try {
      await expect(promisify(execFile)("node", [path.resolve(__dirname, "..", "scripts", "governance", "establish-work-context.mjs")], {
        cwd: root,
        env: { ...process.env, WILLIAMOS_PROJECT_ROOT: root },
      })).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("LEGACY_WORK_CONTEXT_RECEIPT_RETIRED") })
      expect(fs.existsSync(path.join(root, ".williamos", "work-context.json"))).toBe(false)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
