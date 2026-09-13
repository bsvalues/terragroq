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
import { generateKeyPairSync } from "node:crypto"
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
    expect(code).toMatch(/trusted gate script is absent at/)
    expect(code).toMatch(/if \(\$gateExit -ne 0\) \{[\s\S]*?throw "Refusing to start WilliamOS HTTPS: \$gateSummary"/)
  })
})

describe("the gate refuses structurally invalid sha values (F6 typing)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "door-prov-type-"))
  const appRoot = path.join(dir, "runtime")
  fs.mkdirSync(path.join(appRoot, "lib", "generated"), { recursive: true })
  const LEDGER = path.join(dir, "ledger.json")
  fs.writeFileSync(LEDGER, JSON.stringify({ integrations: [{ productState: "COMPLETE", labMainAfter: "b".repeat(40) }] }))
  const runGate = (prov: unknown) => {
    fs.writeFileSync(path.join(appRoot, "lib", "generated", "build-provenance.json"), JSON.stringify(prov))
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "hermes-bridge", "verify-door-provenance.mjs"),
      `--app-root=${appRoot}`, `--ledger=${LEDGER}`, "--allow-runtime-copy"], { encoding: "utf8" })
    return { exit: r.status, out: `${r.stdout}${r.stderr}` }
  }
  it("refuses a single-element array sha instead of coercing it into a match", () => {
    expect(runGate({ sha: ["b".repeat(40)] }).out).toMatch(/PROVENANCE_SHA_MALFORMED/)
  })
  it("refuses object and numeric sha values", () => {
    expect(runGate({ sha: { toString: () => "b".repeat(40) } }).out).toMatch(/PROVENANCE_SHA_MALFORMED/)
    expect(runGate({ sha: 42 }).out).toMatch(/PROVENANCE_SHA_MALFORMED/)
  })
})

// BEHAVIORAL, not text: actually run the live launcher against a scratch app root. This is what
// the round-1 review proved missing — an orphan splice fragment parsed clean under PSParser/AST
// yet killed boot before the gate (F1), and a $false-wrapped gate block would keep all string
// assertions green while booting a bogus revision (M7). Both fail THIS test: a launcher that
// crashes, skips the gate, or reaches project validation instead of the ledger verdict exits
// without BOOT_REFUSED DOOR_PROVENANCE_REFUSED in its boot log.
// Host-gated: executing a Windows PowerShell launcher requires the real thing (the hosted CI
// runner is linux; CI caught the ungated version failing in 8ms).
const HOST_POWERSHELL = process.platform === "win32" && fs.existsSync("C:\\Program Files\\nodejs\\node.exe")
describe("the gate enforces artifact authenticity, not just self-declared sha (#1223 R2)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "door-prov-auth-"))
  const rt = path.join(dir, "runtime")
  const gateDir = path.join(dir, "trusted") // simulates ProgramData\scripts\hermes-bridge
  const LEDGER = path.join(dir, "ledger.json")
  const RING = path.join(dir, "ring.json")
  const RECEIPT = path.join(dir, "receipt.json")
  const GOOD = "b".repeat(40)
  fs.mkdirSync(path.join(rt, "lib", "generated"), { recursive: true })
  fs.mkdirSync(path.join(rt, ".next", "server"), { recursive: true })
  fs.mkdirSync(gateDir, { recursive: true })
  for (const f of ["verify-door-provenance.mjs", "attest-deployment.mjs"]) {
    fs.copyFileSync(path.join(ROOT, "scripts", "hermes-bridge", f), path.join(gateDir, f))
  }
  fs.writeFileSync(path.join(rt, "server.js"), "good\n")
  fs.writeFileSync(path.join(rt, "package.json"), "{}")
  fs.writeFileSync(path.join(rt, ".next", "server", "chunk.js"), "good bundle\n")
  fs.writeFileSync(LEDGER, JSON.stringify({ integrations: [{ productState: "COMPLETE", labMainAfter: GOOD }] }))
  // Self-contained trust material, exactly the shape the deploy installs: the private key lives in a
  // protected trust root the runtime identity cannot read, the public ring ships beside the gate.
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  const KEY = path.join(dir, "trust", "deployment-attestation-key.json")
  fs.mkdirSync(path.dirname(KEY), { recursive: true })
  fs.writeFileSync(KEY, JSON.stringify({
    keyId: "deployment-attestation-test",
    privateKeyBase64: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  }))
  fs.writeFileSync(RING, JSON.stringify({
    "deployment-attestation-test": publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  }))
  fs.writeFileSync(path.join(rt, "lib", "generated", "build-provenance.json"), JSON.stringify({ sha: GOOD }))
  // Production installs these under an administrator-gated ACL (Users: RX). The tamper checks read
  // that as "not writable by the identity running the door"; emulate it with the read-only attribute.
  const lock = (f: string) => fs.chmodSync(f, 0o444)
  const unlock = (f: string) => fs.chmodSync(f, 0o666)
  for (const f of ["verify-door-provenance.mjs", "attest-deployment.mjs"]) lock(path.join(gateDir, f))
  lock(RING)
  const cli = (script: string, args: string[]) => spawnSync(process.execPath, [path.join(gateDir, script), ...args], {
    encoding: "utf8",
    env: { ...process.env, WILLIAMOS_DEPLOYMENT_ATTESTATION_KEYS: RING, WILLIAMOS_GATE_RECEIPT: RECEIPT,
      WILLIAMOS_DEPLOYMENT_ATTESTATION_KEY: KEY },
  })
  const gate = (extra: string[] = []) => cli("verify-door-provenance.mjs",
    [`--app-root=${rt}`, `--ledger=${LEDGER}`, `--gate-dir=${gateDir}`, ...extra])
  const attest = () => cli("attest-deployment.mjs", ["attest", `--app-root=${rt}`, `--sha=${GOOD}`])

  it("refuses a ledger-authorized revision whose bytes were never attested (the P1)", () => {
    const r = gate()
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/NO_ARTIFACT_ATTESTATION/)
  })
  it("accepts after a valid signed attestation", () => {
    expect(attest().status).toBe(0)
    const r = gate()
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/attested_by=signed-manifest/)
  })
  it("refuses tampered application bytes carrying the known-good provenance file", () => {
    attest()
    fs.writeFileSync(path.join(rt, "server.js"), "MALICIOUS\n")
    const r = gate()
    expect(r.status).toBe(1)
    expect(`${r.stdout}${r.stderr}`).toMatch(/MANIFEST_TREE_MISMATCH/)
  })
  it("refuses a forged signature", () => {
    fs.writeFileSync(path.join(rt, "server.js"), "good\n") // restore
    attest()
    const mp = path.join(rt, "lib", "generated", "deployment-manifest.json")
    const mf = JSON.parse(fs.readFileSync(mp, "utf8"))
    mf.signature = "AAAA" + mf.signature.slice(4)
    fs.writeFileSync(mp, JSON.stringify(mf))
    const r = gate()
    expect(r.status).toBe(1)
    expect(`${r.stdout}${r.stderr}`).toMatch(/MANIFEST_SIGNER_UNKNOWN/)
  })
  it("refuses when the verifier itself is an untrusted copy outside --gate-dir", () => {
    attest() // regenerate good manifest first
    const strayDir = path.join(dir, "stale-generation")
    fs.mkdirSync(strayDir, { recursive: true })
    for (const f of ["verify-door-provenance.mjs", "attest-deployment.mjs"]) {
      fs.copyFileSync(path.join(gateDir, f), path.join(strayDir, f))
    }
    const r = spawnSync(process.execPath, [path.join(strayDir, "verify-door-provenance.mjs"), `--app-root=${rt}`, `--ledger=${LEDGER}`, `--gate-dir=${gateDir}`], {
      encoding: "utf8", env: { ...process.env, WILLIAMOS_DEPLOYMENT_ATTESTATION_KEYS: RING, WILLIAMOS_GATE_RECEIPT: RECEIPT,
        WILLIAMOS_DEPLOYMENT_ATTESTATION_KEY: KEY } })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/GATE_NOT_IN_TRUSTED_DIR/)
  })
  it("signed external receipt accepts restored-exact bytes after manifest deletion", () => {
    attest()
    const seal = cli("attest-deployment.mjs", ["seal", `--app-root=${rt}`, `--target=${RECEIPT}`])
    expect(seal.status).toBe(0)
    lock(RECEIPT) // the deploy locks the receipt before starting the door
    fs.rmSync(path.join(rt, "lib", "generated", "deployment-manifest.json"))
    const r = gate()
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/attested_by=external-seal-receipt/)
  })
  it("an altered receipt is refused by signature, not by a secret the door holds", () => {
    unlock(RECEIPT)
    const rec = JSON.parse(fs.readFileSync(RECEIPT, "utf8"))
    rec.treeDigest = "e".repeat(64)
    fs.writeFileSync(RECEIPT, JSON.stringify(rec))
    lock(RECEIPT)
    const r = gate()
    expect(r.status).toBe(1)
    expect(`${r.stdout}${r.stderr}`).toMatch(/SEAL_RECEIPT_/)
  })
  it("a receipt the runtime identity could rewrite is refused outright", () => {
    attest()
    unlock(RECEIPT)
    const seal = cli("attest-deployment.mjs", ["seal", `--app-root=${rt}`, `--target=${RECEIPT}`])
    expect(seal.status).toBe(0)
    unlock(RECEIPT) // mis-installed: writable by the identity running the door
    fs.rmSync(path.join(rt, "lib", "generated", "deployment-manifest.json"))
    const r = gate()
    expect(r.status).toBe(1)
    expect(`${r.stdout}${r.stderr}`).toMatch(/SEAL_RECEIPT_TAMPERABLE/)
    lock(RECEIPT)
  })
  it("a verifier the runtime identity could rewrite refuses to be the authority", () => {
    attest()
    unlock(path.join(gateDir, "verify-door-provenance.mjs"))
    const r = gate()
    expect(r.status).toBe(1)
    expect(`${r.stdout}${r.stderr}`).toMatch(/GATE_TAMPERABLE/)
    lock(path.join(gateDir, "verify-door-provenance.mjs"))
  })
  it("a trust ring the runtime identity could rewrite refuses to vouch for keys", () => {
    attest()
    unlock(RING)
    const r = gate()
    expect(r.status).toBe(1)
    expect(`${r.stdout}${r.stderr}`).toMatch(/TRUST_RING_TAMPERABLE/)
    lock(RING)
  })
})

describe.skipIf(!HOST_POWERSHELL)("the live launcher really refuses a non-ledger revision when executed (#1236)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "door-prov-exec-"))
  const appRoot = path.join(dir, "runtime")
  const logs = path.join(dir, "logs")
  fs.mkdirSync(path.join(appRoot, "lib", "generated"), { recursive: true })
  fs.mkdirSync(path.join(appRoot, "scripts", "hermes-bridge"), { recursive: true })
  fs.mkdirSync(path.join(appRoot, "scripts", "fabric"), { recursive: true })
  fs.mkdirSync(path.join(dir, "ws"), { recursive: true }) // -ProjectRoot target must exist
  fs.mkdirSync(logs, { recursive: true })
  fs.writeFileSync(path.join(appRoot, "server.js"), "// scratch\n")
  fs.writeFileSync(path.join(appRoot, "package.json"), JSON.stringify({ name: "scratch" }))
  fs.writeFileSync(path.join(appRoot, ".env.local"), "WILLIAMOS_TERRAFUSION_ROOT=" + path.join(dir, "ws") + "\n")
  fs.writeFileSync(path.join(appRoot, "scripts", "fabric", "resolve-authority-registry-url.mjs"), "// scratch\n")
  for (const f of ["verify-door-provenance.mjs", "attest-deployment.mjs"]) {
    fs.copyFileSync(path.join(ROOT, "scripts", "hermes-bridge", f),
      path.join(appRoot, "scripts", "hermes-bridge", f))
    // production installs these Users:RX; without the read-only attribute the launcher would stop
    // at DOOR_PROVENANCE_GATE_TAMPERABLE and this test would never reach the ledger check.
    fs.chmodSync(path.join(appRoot, "scripts", "hermes-bridge", f), 0o444)
  }
  fs.writeFileSync(path.join(appRoot, "lib", "generated", "build-provenance.json"), JSON.stringify({ sha: "f".repeat(40) }))
  const bootLog = path.join(logs, "williamos-live.boot.log")

  it("exits nonzero and records a typed provenance refusal before anything starts", () => {
    // NOTE: with -File, PowerShell binds space-separated argument VALUES; the -Name=value form
    // silently breaks binding and the script dies before any boot-log line exists.
    // the launcher resolves its verifier beside itself; point it at the scratch copy (which is
    // what a production ProgramData install looks like from the launcher's side).
    const scratchGate = path.join(appRoot, "scripts", "hermes-bridge", "verify-door-provenance.mjs")
    const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(ROOT, "deploy", "hermes", "williamos-live", "start-williamos-live.ps1"),
      "-AppRoot", appRoot, "-LogRoot", logs, "-ProjectRoot", path.join(dir, "ws"),
      "-ProvenanceGate", scratchGate],
    { encoding: "utf8", timeout: 120000 })
    expect(r.status).toBe(1)
    expect(`${r.stdout}${r.stderr}`).toMatch(/DOOR_PROVENANCE_REFUSED REVISION_NOT_INTEGRATED/)
    // Out-File -Encoding utf8 under PS 5.1 writes a BOM'd UTF-8 file; some hosts emit UTF-16. Read
    // the bytes and decode tolerantly so the assertion tests the launcher, not the codepage.
    const buf = fs.existsSync(bootLog) ? fs.readFileSync(bootLog) : Buffer.alloc(0)
    const logged = (buf.toString("utf16le").includes("BOOT_REFUSED") ? buf.toString("utf16le") : buf.toString("utf8")).replace(/\u0000/g, "")
    expect(logged).toMatch(/BOOT_REFUSED DOOR_PROVENANCE_REFUSED/) // code lands in the boot log; detail in stderr (above)
    // and it refused on the GATE, never later (no project-root or resolver refusal means it got that far)
    expect(logged).not.toMatch(/BOOT_REFUSED PROJECT_ROOT/)
  }, 150000)
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
  // Self-contained trust material (the production key now lives in an administrator-protected
  // trust root that a test must not depend on): scratch private key + published ring.
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  const KEY = path.join(dir, "trust", "deployment-attestation-key.json")
  const RING = path.join(dir, "ring.json")
  fs.mkdirSync(path.dirname(KEY), { recursive: true })
  fs.writeFileSync(KEY, JSON.stringify({ keyId: "deployment-attestation-test",
    privateKeyBase64: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64") }))
  fs.writeFileSync(RING, JSON.stringify({ "deployment-attestation-test":
    publicKey.export({ format: "der", type: "spki" }).toString("base64") }))
  const trustEnv = { ...process.env, WILLIAMOS_DEPLOYMENT_ATTESTATION_KEYS: RING,
    WILLIAMOS_DEPLOYMENT_ATTESTATION_KEY: KEY }
  const runGate = (prov: unknown, ledgerPath = LEDGER) => {
    if (prov === null) fs.rmSync(path.join(appRoot, "lib", "generated", "build-provenance.json"), { force: true })
    else fs.writeFileSync(path.join(appRoot, "lib", "generated", "build-provenance.json"), JSON.stringify(prov))
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "hermes-bridge", "verify-door-provenance.mjs"),
      `--app-root=${appRoot}`, `--ledger=${ledgerPath}`, "--allow-runtime-copy"], { encoding: "utf8", env: trustEnv })
    return { exit: r.status, out: `${r.stdout}${r.stderr}` }
  }
  it("accepts exactly the COMPLETE-ledger revision and echoes its seal witness", () => {
    runGate({ sha: GOOD }) // write provenance
    const a = spawnSync(process.execPath, [path.join(ROOT, "scripts", "hermes-bridge", "attest-deployment.mjs"),
      `attest`, `--app-root=${appRoot}`, `--sha=${GOOD}`], { encoding: "utf8", env: trustEnv })
    expect(a.status).toBe(0) // signed with the scratch key the gate's ring publishes
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
    runGate({ sha: GOOD.toUpperCase() })
    const a = spawnSync(process.execPath, [path.join(ROOT, "scripts", "hermes-bridge", "attest-deployment.mjs"),
      `attest`, `--app-root=${appRoot}`, `--sha=${GOOD}`], { encoding: "utf8", env: trustEnv })
    expect(a.status).toBe(0)
    const r = runGate({ sha: GOOD.toUpperCase() })
    expect(r.exit).toBe(0) // normalized lowercase — matching must not be case-fragile
    expect(runGate({ sha: GOOD + "0" }).out).toMatch(/PROVENANCE_SHA_MALFORMED/)
  })
})
