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
  // Production layout (R4): ring and receipt live INSIDE the administrator-locked gate directory.
  const RING = path.join(gateDir, "ring.json")
  const RECEIPT = path.join(gateDir, "receipt.json")
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
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  const KEY = path.join(dir, "trust", "deployment-attestation-key.json") // admin-only trust root
  fs.mkdirSync(path.dirname(KEY), { recursive: true })
  fs.writeFileSync(KEY, JSON.stringify({
    keyId: "deployment-attestation-test",
    privateKeyBase64: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  }))
  fs.writeFileSync(RING, JSON.stringify({
    "deployment-attestation-test": publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  }))
  fs.writeFileSync(path.join(rt, "lib", "generated", "build-provenance.json"), JSON.stringify({ sha: GOOD }))
  // Production installs the anchors under an administrator-gated ACL, and the R4 probes check TWO
  // orthogonal properties (round-3 review: a read-only FILE in a writable DIRECTORY is substitutable):
  //   file writability  -> the read-only attribute (chmod; Node's r+ probe respects it on Windows)
  //   directory mutation -> icacls deny Everyone:(CI)(AD,WD) (container-inherited ONLY, so it
  //                          blocks create/delete in the dir without touching file semantics)
  // The deploy/seal side (elevated in production) lifts the directory protection while it writes.
  const IS_WIN = process.platform === "win32"
  const lock = (f: string) => { try { fs.chmodSync(f, 0o444) } catch { /* absent: nothing to lock */ } }
  const unlock = (f: string) => { try { fs.chmodSync(f, 0o666) } catch { /* absent */ } }
  let dirProtected = false
  const protectDir = () => {
    if (dirProtected) return
    if (IS_WIN) {
      const r = spawnSync("icacls", [gateDir, "/deny", "Everyone:(CI)(AD,WD)"], { encoding: "utf8" })
      expect(r.status, `icacls deny failed: ${r.stdout}${r.stderr}`).toBe(0)
    } else fs.chmodSync(gateDir, 0o555)
    dirProtected = true
  }
  const unprotectDir = () => {
    if (!dirProtected) return
    if (IS_WIN) {
      const r = spawnSync("icacls", [gateDir, "/remove:d", "Everyone"], { encoding: "utf8" })
      expect(r.status, `icacls clear failed: ${r.stdout}${r.stderr}`).toBe(0)
    } else fs.chmodSync(gateDir, 0o755)
    dirProtected = false
  }
  for (const f of ["verify-door-provenance.mjs", "attest-deployment.mjs"]) lock(path.join(gateDir, f))
  const cli = (script: string, args: string[]) => {
    if (args[0] === "attest" || args[0] === "seal") unprotectDir() // the writer unlocks its target dir
    return spawnSync(process.execPath, [path.join(gateDir, script), ...args], {
      encoding: "utf8",
      env: { ...process.env, WILLIAMOS_DEPLOYMENT_ATTESTATION_KEYS: RING, WILLIAMOS_GATE_RECEIPT: RECEIPT,
        WILLIAMOS_DEPLOYMENT_ATTESTATION_KEY: KEY },
    })
  }
  const gate = (extra: string[] = []) => {
    lock(RING)
    protectDir() // the door's identity sees: no-create directory; file attrs govern the rest
    return cli("verify-door-provenance.mjs",
      [`--app-root=${rt}`, `--ledger=${LEDGER}`, `--gate-dir=${gateDir}`, ...extra])
  }
  const attest = () => cli("attest-deployment.mjs", ["attest", `--app-root=${rt}`, `--sha=${GOOD}`])
  const seal = () => cli("attest-deployment.mjs", ["seal", `--app-root=${rt}`])
  const rmManifest = () => fs.rmSync(path.join(rt, "lib", "generated", "deployment-manifest.json"), { force: true })
  const gateDirect = () => cli("verify-door-provenance.mjs",
    [`--app-root=${rt}`, `--ledger=${LEDGER}`, `--gate-dir=${gateDir}`])

  it("refuses a ledger-authorized revision whose bytes were never attested (the P1)", () => {
    const r = gate()
    expect(r.status).toBe(1)
    expect(`${r.stdout}${r.stderr}`).toMatch(/NO_ARTIFACT_ATTESTATION/)
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
  it("refuses a tampered dependency inside node_modules (round-3 BLOCKING: deps are bound now)", () => {
    fs.writeFileSync(path.join(rt, "server.js"), "good\n") // restore
    fs.mkdirSync(path.join(rt, "node_modules", "next"), { recursive: true })
    fs.writeFileSync(path.join(rt, "node_modules", "next", "index.js"), "module.exports = {}\n")
    attest()
    fs.writeFileSync(path.join(rt, "node_modules", "next", "index.js"), "module.exports = PWNED\n")
    const r = gate()
    expect(r.status).toBe(1)
    expect(`${r.stdout}${r.stderr}`).toMatch(/MANIFEST_TREE_MISMATCH/)
  })
  it("refuses an edited .env.local with the authorized manifest still in place (round-3 HIGH)", () => {
    fs.writeFileSync(path.join(rt, "node_modules", "next", "index.js"), "module.exports = {}\n")
    fs.writeFileSync(path.join(rt, ".env.local"), "DATABASE_URL=postgres://safe\n")
    attest()
    fs.writeFileSync(path.join(rt, ".env.local"), "DATABASE_URL=postgres://attacker\n")
    const r = gate()
    expect(r.status).toBe(1)
    expect(`${r.stdout}${r.stderr}`).toMatch(/MANIFEST_TREE_MISMATCH/)
  })
  it("refuses a forged signature", () => {
    fs.writeFileSync(path.join(rt, ".env.local"), "DATABASE_URL=postgres://safe\n")
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
    expect(seal().status).toBe(0)
    lock(RECEIPT) // the deploy locks the receipt before starting the door
    rmManifest()
    const r = gate()
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/attested_by=external-seal-receipt/)
  })
  it("an altered receipt is refused by signature, not by a secret the door holds", () => {
    attest()
    unprotectDir()
    fs.rmSync(RECEIPT, { force: true })
    expect(seal().status).toBe(0) // fresh receipt matching the current tree
    lock(RECEIPT)
    const rec = JSON.parse(fs.readFileSync(RECEIPT, "utf8"))
    rec.treeDigest = "e".repeat(64)
    unlock(RECEIPT)
    fs.writeFileSync(RECEIPT, JSON.stringify(rec)) // attacker edits, then re-locks to hide intent
    lock(RECEIPT)
    rmManifest()
    const r = gate() // protected install: only the ALTERED CONTENT can be what refuses it
    expect(r.status).toBe(1)
    expect(`${r.stdout}${r.stderr}`).toMatch(/SEAL_RECEIPT_SIGNATURE_INVALID/)
  })
  it("a receipt the runtime identity could rewrite is refused outright", () => {
    unprotectDir()
    rmManifest()
    fs.rmSync(RECEIPT, { force: true }) // prior tests locked it; seal must write a fresh receipt
    expect(seal().status).toBe(0)
    lock(path.join(gateDir, "verify-door-provenance.mjs"))
    lock(path.join(gateDir, "attest-deployment.mjs"))
    lock(RING)
    protectDir() // healthy directory...
    // ...except the receipt FILE stays writable (never locked): substitution is possible -> refuse
    const broken = gateDirect()
    expect(broken.status).toBe(1)
    expect(`${broken.stdout}${broken.stderr}`).toMatch(/SEAL_RECEIPT_TAMPERABLE/)
    lock(RECEIPT)
  })
  it("a verifier the runtime identity could rewrite refuses to be the authority", () => {
    attest()
    lock(RECEIPT)
    lock(RING)
    unlock(path.join(gateDir, "verify-door-provenance.mjs"))
    const r = gateDirect()
    expect(r.status).toBe(1)
    expect(`${r.stdout}${r.stderr}`).toMatch(/GATE_TAMPERABLE/)
    lock(path.join(gateDir, "verify-door-provenance.mjs"))
  })
  it("a READ-ONLY verifier in a directory the door identity can write is still refused (R4 substitution)", () => {
    // The round-3 BLOCKING probe: file attributes alone are not enough — directory substitution
    // (delete the real verifier, re-add a stub printing DOOR_PROVENANCE_OK) is the actual attack.
    attest()
    lock(path.join(gateDir, "verify-door-provenance.mjs")) // explicitly read-only
    lock(path.join(gateDir, "attest-deployment.mjs"))
    lock(RING)
    lock(RECEIPT)
    unprotectDir() // the mis-install: anchor DIRECTORY writable while every FILE is read-only
    const r = gateDirect()
    expect(r.status).toBe(1)
    expect(`${r.stdout}${r.stderr}`).toMatch(/GATE_TAMPERABLE/)
  })
  it("a trust ring the runtime identity could rewrite refuses to vouch for keys", () => {
    attest()
    lock(path.join(gateDir, "verify-door-provenance.mjs"))
    lock(path.join(gateDir, "attest-deployment.mjs"))
    lock(RECEIPT)
    protectDir() // gate dir locked down...
    unlock(RING) // ...but the ring file itself writable (dir deny covers creation, not chmod)
    const r = gateDirect()
    expect(r.status, "GATE_TAMPERABLE masking means an anchor lost its lock").toBe(1)
    expect(`${r.stdout}${r.stderr}`).toMatch(/TRUST_RING_TAMPERABLE/)
    lock(RING)
  })
  it("the env escape hatch to ledger-only boot no longer exists (round-3 BLOCKING: HKCU forgeable)", () => {
    // The gate cannot tell an operator from the runtime-writer identity, and that identity can set
    // HKCU\\Environment persistently — any env-var downgrade of the authenticity half is a bypass.
    const gateText = fs.readFileSync(path.join(gateDir, "verify-door-provenance.mjs"), "utf8")
    expect(gateText).not.toMatch(/ALLOW_UNSIGNED_LEDGER_ONLY|LEDGER_ONLY_ESCAPER/)
    attest()
    rmManifest()
    fs.rmSync(RECEIPT, { force: true }) // unattested state
    lock(RECEIPT) // absent files cannot be tampered; keep the install healthy so the ESCAPE path
    // (not a tamper probe) is what the refusal must come from — with the escape gone: NO_ARTIFACT
    lock(RING)
    protectDir()
    const r = spawnSync(process.execPath, [path.join(gateDir, "verify-door-provenance.mjs"),
      `--app-root=${rt}`, `--ledger=${LEDGER}`, `--gate-dir=${gateDir}`],
    { encoding: "utf8", env: { ...process.env, WILLIAMOS_DEPLOYMENT_ATTESTATION_KEYS: RING,
      WILLIAMOS_GATE_RECEIPT: RECEIPT, WILLIAMOS_DEPLOYMENT_ATTESTATION_KEY: KEY,
      WILLIAMOS_GATE_ALLOW_UNSIGNED_LEDGER_ONLY: "1" } })
    expect(r.status).toBe(1)
    expect(`${r.stdout}${r.stderr}`).toMatch(/NO_ARTIFACT_ATTESTATION/)
    lock(RECEIPT) // absent file: lock() would throw; guard for re-run stability
  })
})

describe("the deploy and its restore script agree on the rollback contract (#1236 round-2 N1)", () => {
  // N1: deploy@57e1df9c added a file to its rollback manifest that restore@57e1df9c did not expect,
  // so restore rejected every manifest its paired deploy wrote. Text-level tests missed it because
  // nothing coupled the two lists. These assertions make that drift impossible to ship again.
  const deploy = fs.readFileSync(path.join(ROOT, "scripts", "deploy-hermes-runtime.ps1"), "utf8")
  const restore = fs.readFileSync(path.join(ROOT, "scripts", "restore-hermes-runtime.ps1"), "utf8")
  const grab = (text: string, marker: string) => {
    const i = text.indexOf(marker)
    expect(i, `missing ${marker}`).toBeGreaterThan(-1)
    const j = text.indexOf(")", i)
    return [...text.slice(i + marker.length, j).matchAll(/"([^"]+)"/g)].map((m) => m[1])
  }
  const deployFiles = grab(deploy, "$rollbackFiles = @(")
  const restoreFiles = grab(restore, "$expectedRollbackFiles = @(")
  const versionConditionals = [...restore.matchAll(/if \(\$manifestVersion -ge (\d+)\) \{\s*\$expectedRollbackFiles \+= "([^"]+)" \}/g)]

  it("names exactly the runtime file set the restore script will accept", () => {
    const expected = new Set([...restoreFiles, ...versionConditionals.map((m) => m[2])])
    expect([...deployFiles].sort()).toEqual([...expected].sort())
  })
  it("keeps every version-conditional entry consistent with the manifest version it mints", () => {
    // The deploy states its manifest version inline (version = N); restore adds conditional entries
    // (v4 pnpm-lock, v8 deployment-manifest). A deploy minting a version below a conditional would
    // write a manifest restore rejects (the round-2 N1 defect class).
    const mintedVersion = /version = (\d+)/.exec(deploy)
    expect(mintedVersion, "deploy must state the manifest version it writes").toBeTruthy()
    expect(versionConditionals.length).toBeGreaterThanOrEqual(2)
    for (const m of versionConditionals) {
      expect(Number(mintedVersion![1]), `conditional entry ${m[2]} at v${m[1]}`).toBeGreaterThanOrEqual(Number(m[1]))
    }
  })
  it("re-attests and re-seals the restored generation before starting the door", () => {
    // A rollback rotates bytes back to a previous generation; without a fresh manifest+receipt the
    // gate would deny its own rolled-back door (round-3 MAJOR). Restore must attest+seal after
    // copying, before Start-ScheduledTask, and lock the receipt down again.
    const i = restore.indexOf("restored generation re-attested and sealed")
    expect(i, "restore must re-attest the restored bytes").toBeGreaterThan(-1)
    expect(restore.slice(i).indexOf("Start-ScheduledTask")).toBeGreaterThan(-1)
    expect(restore).toMatch(/attest --app-root=/)
    expect(restore).toMatch(/icacls \$ReceiptTarget \/inheritance:r/)
  })
  it("ships the gate to the trusted ProgramData directory, never into the runtime", () => {
    // A runtime copy is substitutable by exactly the writer the gate distrusts (R2/R3 finding).
    expect(deploy).toMatch(/\$gateTargetDir = Join-Path \(Split-Path -Parent \$LiveStartTarget\) "scripts\\hermes-bridge"/)
    expect(deploy).not.toMatch(/Copy-Item[^\n]*verify-door-provenance\.mjs[^\n]*\$Runtime/)
    expect(deploy).not.toMatch(/\$provenanceGateRelative/)
  })
  it("captures the trusted gate directory and restores it with the launchers", () => {
    expect(deploy).toMatch(/trustDir = \[ordered\]@\{ target = \$gateTargetDir/)
    expect(restore).toMatch(/\$trustDirCaptured = \(\$null -ne \$manifest\.trustDir\)/)
    expect(restore).toMatch(/if \(\$trustDirCaptured\) \{/)
  })
  it("locks every anchor to the runtime identity's read-only access", () => {
    expect(deploy).toMatch(/icacls \$gateTargetDir \/inheritance:r \/grant:r .*Users:\(OI\)\(CI\)RX/)
    expect(deploy).toMatch(/icacls \$trustRootDir \/inheritance:r \/grant:r "SYSTEM:\(OI\)\(CI\)F" "BUILTIN\\Administrators:\(OI\)\(CI\)F"/)
    expect(deploy).toMatch(/icacls \$receiptTarget \/inheritance:r/)
  })
})

describe("the gate refuses structurally hostile provenance without ever coercing it (round-2 O1)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "door-prov-o1-"))
  const appRoot = path.join(dir, "runtime")
  fs.mkdirSync(path.join(appRoot, "lib", "generated"), { recursive: true })
  const LEDGER = path.join(dir, "ledger.json")
  fs.writeFileSync(LEDGER, JSON.stringify({ integrations: [{ productState: "COMPLETE", labMainAfter: "b".repeat(40) }] }))
  const runGate = (prov: unknown) => {
    fs.writeFileSync(path.join(appRoot, "lib", "generated", "build-provenance.json"), JSON.stringify(prov))
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "hermes-bridge", "verify-door-provenance.mjs"),
      `--app-root=${appRoot}`, `--ledger=${LEDGER}`, "--allow-runtime-copy"], { encoding: "utf8" })
    return `${r.stdout}${r.stderr}`
  }
  it("an object with an uncoercible toString is a typed refusal, not a crash", () => {
    const out = runGate({ sha: { toString: null, valueOf: null } })
    expect(out).toMatch(/PROVENANCE_SHA_MALFORMED/)
    expect(out).not.toMatch(/Cannot convert object to primitive value/)
  })
  it("arrays, numbers, null and short strings all refuse in the same typed way", () => {
    for (const v of [["b".repeat(40)], 42, null, "deadbeef"]) {
      expect(runGate({ sha: v })).toMatch(/PROVENANCE_SHA_MALFORMED/)
    }
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
  const scratchGateDir = path.join(appRoot, "scripts", "hermes-bridge")
  for (const f of ["verify-door-provenance.mjs", "attest-deployment.mjs"]) {
    fs.copyFileSync(path.join(ROOT, "scripts", "hermes-bridge", f), path.join(scratchGateDir, f))
    // production installs these Users:RX (read-only files, no-create directory). Without BOTH the
    // R4 probes stop at DOOR_PROVENANCE_GATE_TAMPERABLE and the ledger check never runs.
    fs.chmodSync(path.join(scratchGateDir, f), 0o444)
  }
  if (process.platform === "win32") {
    const acl = spawnSync("icacls", [scratchGateDir, "/deny", "Everyone:(CI)(AD,WD)"], { encoding: "utf8" })
    if (acl.status !== 0) throw new Error(`icacls deny failed: ${acl.stdout}${acl.stderr}`)
  } else fs.chmodSync(scratchGateDir, 0o555)
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
