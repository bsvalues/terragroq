import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

/**
 * The retained settlement driver, `RS-00-settle-stamp-identity.mjs`.
 *
 * `WILLIAMOS-EXPERIENCE-V2-RUNTIME-SETTLEMENT-001` retains this file as the artifact
 * `CONT-EXPV2-FIRST-ACTION-RUNTIME-SETTLEMENT` is run through again once ATLAS is reachable, so the
 * run that matters is the NEXT one. Three defects were found in it after the run that produced the
 * record, and all three would only ever have hurt that next run:
 *
 *   1. it could not start from the location it is retained at (`ERR_MODULE_NOT_FOUND`),
 *   2. its authority lookup dropped the route's `"userId"` predicate, so any operator's grant
 *      satisfied it,
 *   3. the branch reached when authority PASSES recorded `executed: false` and still emitted the
 *      success verdict `PROCEEDED`.
 *
 * Two and three were one failure path: another operator's grant authorising a governed mutation
 * that never ran. These tests hold each of the three closed.
 */
const REPO = process.cwd()
const DRIVER = path.join(REPO, "docs", "reports", "experience-v2-runtime-settlement", "RS-00-settle-stamp-identity.mjs")
const ROUTE = path.join(REPO, "app", "api", "system", "node", "stamp-identity", "route.ts")
const RETAINED_RELATIVE = ["docs", "reports", "experience-v2-runtime-settlement"]

const driverSource = fs.readFileSync(DRIVER, "utf8")
const routeSource = fs.readFileSync(ROUTE, "utf8")

const trees: string[] = []
afterEach(() => {
  while (trees.length) fs.rmSync(trees.pop() as string, { recursive: true, force: true })
})

/** A clean tree holding only what the driver needs to locate the repository root from where it sits. */
function retainedLocationTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "expv2-driver-"))
  trees.push(root)
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true })
  fs.copyFileSync(path.join(REPO, "scripts", "repo-alias-loader.mjs"), path.join(root, "scripts", "repo-alias-loader.mjs"))
  const retained = path.join(root, ...RETAINED_RELATIVE)
  fs.mkdirSync(retained, { recursive: true })
  const driver = path.join(retained, "RS-00-settle-stamp-identity.mjs")
  fs.copyFileSync(DRIVER, driver)
  return { root, driver }
}

describe("RS-00 runs from the location it is retained at", () => {
  it("resolves the repository root instead of counting parents", () => {
    const { driver } = retainedLocationTree()
    const run = spawnSync(process.execPath, [driver], { encoding: "utf8" })
    // The defect: `path.resolve(import.meta.dirname, "..")` made `root` equal to `docs/reports`, and
    // the alias loader import failed before the settlement could begin.
    expect(run.stderr).not.toContain("ERR_MODULE_NOT_FOUND")
    expect(run.stderr).toContain("usage:")
  })

  it("sets WILLIAMOS_PROJECT_ROOT to the repository root, not to a documentation directory", () => {
    const { root, driver } = retainedLocationTree()
    fs.writeFileSync(path.join(root, ".env.local"), "DATABASE_URL=postgresql://u:p@127.0.0.1:1/db\n")
    const run = spawnSync(process.execPath, [driver, path.join(root, ".env.local")], { encoding: "utf8" })
    // LEG 0 digests canonical files relative to `root`. In this bare tree they are absent, and the
    // path it reports is therefore the root it resolved -- the one `WILLIAMOS_PROJECT_ROOT` is set
    // to on the line above it. `#1002` introduced that variable so the deployed root is not guessed.
    expect(run.stderr).toContain(path.join(root, "app", "api", "system", "node", "stamp-identity", "route.ts"))
    expect(run.stderr).not.toContain(path.join(root, "docs", "reports", "app"))
  })
})

describe("RS-00 authority lookup is the route's lookup", () => {
  it("carries the route's user-scoping predicate verbatim", () => {
    // `route.ts` names this clause `criterion 8` in a comment written to stop exactly this drift.
    expect(routeSource).toMatch(/WHERE "scope" = \$1\s*\n\s*AND "userId" = \$2/)
    expect(driverSource).toMatch(/WHERE "scope" = \$1\s*\n\s*AND "userId" = \$2/)
  })

  it("issues no query against authority_grant that is not user-scoped", () => {
    const queries = driverSource.split(/FROM authority_grant/).slice(1)
    expect(queries.length).toBeGreaterThan(0)
    for (const query of queries) {
      expect(query.slice(0, 200)).toContain('"userId" = $2')
    }
  })

  it("refuses rather than widening the lookup when no actor is identified", () => {
    // Unable to scope is not scoped to everyone.
    expect(driverSource).toContain("AUTHORITY_UNVERIFIABLE_NO_ACTOR")
    const scopedQuery = driverSource.indexOf("GRANT_COLUMNS, [")
    expect(scopedQuery).toBeGreaterThan(-1)
    // The scoped query is only reachable from the branch that has an actor.
    expect(driverSource.slice(0, scopedQuery)).toMatch(/else if \(authority\.registryReadable\) \{/)
  })

  it("keeps `AUTHORITY_UNREADABLE` distinct from both absence and no-actor", () => {
    for (const state of [
      "AUTHORITY_UNREADABLE",
      "AUTHORITY_UNVERIFIABLE_NO_ACTOR",
      "AUTHORITY_NOT_GRANTED_NO_ROWS",
      "AUTHORITY_NOT_GRANTED_NO_COVERAGE",
    ]) {
      expect(driverSource).toContain(state)
    }
  })
})

describe("RS-00 verdicts describe what ran", () => {
  it("cannot emit a success verdict from the authority result", () => {
    // The removed line was: report.verdict = authorised ? "PROCEEDED" : ...
    expect(driverSource).not.toContain('"PROCEEDED"')
    expect(driverSource).not.toMatch(/report\.verdict\s*=\s*authorised\s*\?/)
  })

  it("gates settlement on execution, a separate post-state observation, and its durable record", () => {
    const verdict = driverSource.slice(driverSource.indexOf("report.verdict = "))
    expect(verdict).toContain("mutation.executed")
    expect(verdict).toContain("mutation.postState?.verified")
    expect(verdict).toContain("mutation.postStateRecorded")
    expect(verdict).toContain("SETTLED_MUTATION_EXECUTED")
    expect(driverSource).toContain('report.settled = report.verdict === "SETTLED_MUTATION_EXECUTED"')
  })

  it("names the authority-passed-but-nothing-executed state instead of hiding it", () => {
    expect(driverSource).toContain("AUTHORISED_NOT_EXECUTED")
  })

  it("performs the route's own mutation and verification sequence when authority passes", () => {
    for (const call of ["observeCommand", "assertObservedIdentity", "stampCommand", "verifyCommand", "verifyPostState"]) {
      expect(driverSource).toContain(call)
    }
    // `requireAudit: true` on the one call that changes anything, as in the route.
    expect(driverSource).toMatch(/action: stamp\.operation, requireAudit: true/)
  })
})
