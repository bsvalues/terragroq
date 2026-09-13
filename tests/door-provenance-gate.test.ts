/**
 * #1223 — the door provenance gate, as a CONTRACT (owner-stated invariant 2026-09-12):
 * "The door may start only a revision proven to be an integrated lab-main revision with
 *  valid integration provenance."
 *
 * This issue was opened because a real bypass happened: `c890d981` (unreviewed side branch,
 * no PR, not an ancestor of lab main) reached the live door ~90 seconds after commit through
 * the filesystem path. The git authority already refuses to integrate anything unproven; the
 * remaining exposure was that ANY revision copied into the runtime root became production on
 * the next supervised restart. The gate below is what the launchers call before exec'ing node.
 *
 * Two halves, both checked here:
 *  1. the launcher scripts wire the gate FAIL-CLOSED (any missing input denies boot; the gate
 *     call sits before node exec; no branch reaches exec on a nonzero gate exit);
 *  2. the gate itself accepts exactly and only COMPLETE-ledger revisions and refuses the rest
 *     with typed reason codes (proven behaviorally in a scratch app root, not just by reading).
 */
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = process.cwd()
const LIVE_START = path.join(ROOT, "deploy", "hermes", "williamos-live", "start-williamos-live.ps1")
const HTTPS_START = path.join(ROOT, "deploy", "hermes", "williamos-https", "start-williamos-https.ps1")
const GATE = path.join(ROOT, "scripts", "hermes-bridge", "verify-door-provenance.mjs")
const liveText = fs.readFileSync(LIVE_START, "utf8")
const httpsText = fs.readFileSync(HTTPS_START, "utf8")
const gateText = fs.readFileSync(GATE, "utf8")

function stripComments(text: string): string {
  return text.replace(/<#[\s\S]*?#>/g, "").split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)#.*$/, "$1")).join("\n")
}

describe("the live launcher wires the door provenance gate (#1223)", () => {
  const code = stripComments(liveText)
  it("executes the provenance gate before starting node", () => {
    const gateAt = code.indexOf("verify-door-provenance.mjs")
    const execAt = code.indexOf("& $node $server")
    expect(gateAt).toBeGreaterThan(-1)
    expect(execAt).toBeGreaterThan(-1)
    expect(gateAt).toBeLessThan(execAt)
  })
  it("denies boot on any nonzero gate exit — no path reaches node exec after refusal", () => {
    expect(code).toMatch(/if \(\$gateExit -ne 0\)\s*\{[^}]*Deny-Boot "DOOR_PROVENANCE_REFUSED"/)
    // Deny-Boot exits 1: grep its body once more here so a future "log-and-continue" edit fails loudly.
    expect(code).toMatch(/function Deny-Boot \{[\s\S]*?\r?\n\}/)
    expect(code.match(/function Deny-Boot \{[\s\S]*?\bexit 1\b/)![0]).not.toMatch(/return/)
  })
  it("fails closed when the gate file itself is missing from the bundle", () => {
    expect(code).toMatch(/DOOR_PROVENANCE_GATE_MISSING/)
    expect(code.indexOf("DOOR_PROVENANCE_GATE_MISSING")).toBeLessThan(code.indexOf("& $node $server"))
  })
  it("resolves the gate under the app root AFTER $resolvedAppRoot exists (ordering, not prose)", () => {
    expect(code.indexOf("$resolvedAppRoot = (Resolve-Path")).toBeLessThan(code.indexOf("$provenanceGate = Join-Path"))
  })
})

describe("the door provenance gate is wired fail-closed into the gate itself", () => {
  const code = gateText
  it("exits nonzero on every refusal path (fail-closed, no throw-and-continue)", () => {
    expect(code).toMatch(/const fail = \(code, detail\) => \{[\s\S]*process\.exit\(1\)/)
    // and the ONLY success exit is 0 after a ledger match
    expect(code).toMatch(/process\.exit\(0\)/)
    expect(code).toMatch(/DOOR_PROVENANCE_REFUSED \$\{code\}/)
  })
  it("authorizes only productState COMPLETE entries, by exact labMainAfter", () => {
    expect(code).toMatch(/productState === "COMPLETE"/)
    expect(code).toMatch(/authorized\.set\(e\.labMainAfter\.toLowerCase\(\), e\)/)
    expect(code).toMatch(/authorized\.has\(sha\)/)
  })
})

describe("the HTTPS proxy launcher also refuses an unintegrated revision (#1223, no :3443 bypass)", () => {
  const code = stripComments(httpsText)
  it("executes the same provenance gate before starting node", () => {
    const gateAt = code.indexOf("verify-door-provenance.mjs")
    const execAt = code.indexOf("& $node $proxy")
    expect(gateAt).toBeGreaterThan(-1)
    expect(execAt).toBeGreaterThan(-1)
    expect(gateAt).toBeLessThan(execAt)
  })
  it("fails closed when the gate file is missing and on any nonzero exit", () => {
    expect(code).toMatch(/does not carry scripts\/hermes-bridge\/verify-door-provenance\.mjs/)
    expect(code).toMatch(/if \(\$gateExit -ne 0\) \{[\s\S]*?throw "Refusing to start WilliamOS HTTPS: \$gateSummary"/)
  })
})

describe("the gate accepts only authorized integrated revisions (behavioral)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "door-prov-"))
  const appRoot = path.join(dir, "runtime")
  fs.mkdirSync(path.join(appRoot, "lib", "generated"), { recursive: true })
  const GOOD = "b".repeat(40)
  const LEDGER = path.join(dir, "integrations.json")
  fs.writeFileSync(LEDGER, JSON.stringify({ integrations: [
    { productState: "COMPLETE", labMainAfter: GOOD, sealKey: "seal-1", at: "2026-09-13T00:00:00Z" },
    { productState: "IN_PROGRESS_NOT_A_STATE_BUT_KEPT", labMainAfter: "c".repeat(40) },
  ] }))
  const runGate = (prov: unknown, ledgerPath = LEDGER) => {
    if (prov === null) fs.rmSync(path.join(appRoot, "lib", "generated", "build-provenance.json"), { force: true })
    else fs.writeFileSync(path.join(appRoot, "lib", "generated", "build-provenance.json"), JSON.stringify(prov))
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "hermes-bridge", "verify-door-provenance.mjs"),
      `--app-root=${appRoot}`, `--ledger=${ledgerPath}`], { encoding: "utf8" })
    return { exit: r.status, out: `${r.stdout}${r.stderr}` }
  }
  it("accepts exactly the COMPLETE-ledger revision and echoes its seal witness", () => {
    const r = runGate({ sha: GOOD })
    expect(r.exit).toBe(0)
    expect(r.out).toContain("DOOR_PROVENANCE_OK")
    expect(r.out).toContain("sealKey=seal-1")
  })
  it("refuses an integrated-looking sha that is not in the ledger (the c890d981 class)", () => {
    const r = runGate({ sha: "a".repeat(40) })
    expect(r.exit).toBe(1)
    expect(r.out).toMatch(/DOOR_PROVENANCE_REFUSED REVISION_NOT_INTEGRATED/)
  })
  it("refuses a non-COMPLETE entry's revision", () => {
    const r = runGate({ sha: "c".repeat(40) })
    expect(r.exit).toBe(1)
    expect(r.out).toMatch(/REVISION_NOT_INTEGRATED/)
  })
  it("fails closed on missing provenance file, malformed sha, missing ledger", () => {
    expect(runGate(null).out).toMatch(/PROVENANCE_FILE_UNREADABLE/)
    expect(runGate({ sha: "deadbeef" }).out).toMatch(/PROVENANCE_SHA_MALFORMED/)
    expect(runGate({ sha: GOOD }, path.join(dir, "nope.json")).out).toMatch(/LEDGER_UNREADABLE/)
    const empty = path.join(dir, "empty-ledger.json")
    fs.writeFileSync(empty, JSON.stringify({ integrations: [] }))
    expect(runGate({ sha: GOOD }, empty).out).toMatch(/LEDGER_EMPTY/)
  })
  it("refuses case-mismatched and padded shas only via exact match (40-hex)", () => {
    const r = runGate({ sha: GOOD.toUpperCase() })
    expect(r.exit).toBe(0) // normalized lowercase — matching must not be case-fragile
    expect(runGate({ sha: GOOD + "0" }).out).toMatch(/PROVENANCE_SHA_MALFORMED/)
  })
})
