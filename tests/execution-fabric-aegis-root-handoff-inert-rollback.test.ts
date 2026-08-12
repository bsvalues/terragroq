import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect, it } from "vitest"
import { inspectInertRollbackObservation, inspectInertRollbackWindow } from "../scripts/execution-fabric/provision/aegis-root-handoff-inert-rollback.mjs"

const exact = () => Object.fromEntries(["journalTerminalExact", "claimExact", "successReceiptAbsent", "nftBoundaryAbsent", "unitsInactive", "listenerAbsent", "networkReceiptAbsent", "forcedCommandAbsent", "workerAbsent", "workspaceAbsent", "dispatchAbsent", "standingAuthorityAbsent"].map(key => [key, true]))
describe("AEGIS inert rollback evidence", () => {
  it("accepts only the complete inactive observation", () => expect(inspectInertRollbackObservation(exact())).toMatchObject({ status: "ROLLBACK_INERT_PROVEN", executionAuthorized: false }))
  it("fails closed for every missing, false, or extra proof", () => {
    for (const key of Object.keys(exact())) { const missing: any = exact(); delete missing[key]; expect(inspectInertRollbackObservation(missing)).toMatchObject({ status: "BLOCKED" }); const drift: any = exact(); drift[key] = false; expect(inspectInertRollbackObservation(drift)).toMatchObject({ status: "BLOCKED" }) }
    expect(inspectInertRollbackObservation({ ...exact(), extra: true })).toMatchObject({ status: "BLOCKED" })
  })
  it("requires authority freshness again at settlement", () => {
    expect(inspectInertRollbackWindow("2026-08-12T12:00:00.000Z", "2026-08-12T12:15:00.000Z", "2026-08-12T12:14:59.999Z")).toBe(true)
    expect(inspectInertRollbackWindow("2026-08-12T12:00:00.000Z", "2026-08-12T12:15:00.000Z", "2026-08-12T12:15:00.000Z")).toBe(false)
  })
  it("imports as a standalone installed verifier without repository dependencies", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-inert-verifier-")); const destination = path.join(directory, "verifier.mjs")
    fs.copyFileSync(path.resolve(import.meta.dirname, "../scripts/execution-fabric/provision/aegis-root-handoff-inert-rollback.mjs"), destination)
    await expect(import(`${pathToFileURL(destination).href}?isolated=1`)).resolves.toMatchObject({ inspectInertRollbackObservation: expect.any(Function) })
    fs.rmSync(directory, { recursive: true, force: true })
  })
})
