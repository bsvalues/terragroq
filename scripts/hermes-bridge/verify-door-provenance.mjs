#!/usr/bin/env node
/**
 * #1223 — the door provenance gate.
 *
 * Owner-stated invariant: "The door may start only a revision proven to be an integrated
 * lab-main revision with valid integration provenance." The git path enforces its half
 * (integrate-lab-main.mjs refuses to integrate anything unproven); this enforces the boot half.
 *
 * TWO independent proofs must BOTH hold before the door starts:
 *
 *  A. AUTHORITY (revision): the bundle's build-provenance.json sha must equal the labMainAfter
 *     of a productState COMPLETE entry in the authoritative ledger
 *     (~/.williamos/integrations.json — written only by integrate-lab-main.mjs after
 *     seal + signed review + tree verification). Without this, an unauthorized revision cannot
 *     boot even WITH a valid manifest (a re-attested tree is still not an integrated revision).
 *
 *  B. AUTHENTICITY (bytes): the booted tree's content must match what was attested. Accepted
 *     via either of two mechanisms whose trust roots live OUTSIDE the robocopy target:
 *       - a signed deployment manifest (verify-door-provenance calls attest-deployment.verify):
 *         signed by the deployment attestation key, whose private half is in the operator home
 *         and whose public ring sits in the administrator-gated ProgramData — a runtime-writer
 *         can copy or forge manifest bytes but cannot produce a valid signature; and
 *       - an external HMAC seal receipt (ProgramData, outside the tree) for the same tree
 *         digest + sha, recorded by the deploy procedure after staging.
 *     Without B, carrying a known-good provenance file over unauthorized bytes works — the
 *     owner's P1 on the round-1 design: self-declared sha inside the writable tree is not
 *     authenticity.
 *
 * Fail-closed, typed refusals, no network, no fallback. Exit 0 ONLY on
 * DOOR_PROVENANCE_OK with both proofs; the accepted line echoes the ledger seal witness AND the
 * authenticity source so the boot log is self-describing.
 *
 * Env: WILLIAMOS_INTEGRATIONS_LEDGER overrides the ledger path (tests only).
 *      WILLIAMOS_DEPLOYMENT_ATTESTATION_KEYS overrides the ring path (tests only).
 *      WILLIAMOS_GATE_ALLOW_UNSIGNED_LEDGER_ONLY=1 downgrades B to advisory — used ONLY as the
 *      operator escape during catastrophic key loss; it is LOUDLY logged and is not a test hook.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { verify as verifyManifest, verifySealReceipt } from "./attest-deployment.mjs"

const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const i = a.indexOf("=")
  return i < 0 ? [a.replace(/^--/, ""), "true"] : [a.slice(2, i), a.slice(i + 1)]
}))
const fail = (code, detail) => {
  console.error(`DOOR_PROVENANCE_REFUSED ${code} ${String(detail).slice(0, 300)}`)
  process.exit(1)
}

const appRoot = argv["app-root"]
if (!appRoot) fail("ARGS_INVALID", "--app-root=<runtime root> is required")

// Placement check: this verifier is trusted BYTES, so it must run from the trusted directory it
// ships in (ProgramData, beside the launchers, administrator-gated). An old copy carried inside a
// robocopied runtime — e.g. a previous generation's scripts/hermes-bridge — may be stale code
// that predates today's checks; running it would let an attacker pick which verifier admits them.
// --allow-runtime-copy is reserved for tests and emergency repair.
const trustedDir = argv["gate-dir"] || process.env.WILLIAMOS_TRUSTED_GATE_DIR || "C:\\ProgramData\\WilliamOS\\scripts\\hermes-bridge"
if (!argv["allow-runtime-copy"]) {
  let self
  try { self = fs.realpathSync(fileURLToPath(import.meta.url)) } catch { self = "" }
  if (!self) fail("GATE_IDENTITY_UNKNOWN", "cannot resolve this verifier's own path; refusing to guess trust")
  if (self.toLowerCase() !== path.join(trustedDir, "verify-door-provenance.mjs").toLowerCase()) {
    fail("GATE_NOT_IN_TRUSTED_DIR", `${self} is not the trusted ${path.join(trustedDir, "verify-door-provenance.mjs")}`)
  }
}

// --- A. authority: ledger membership -----------------------------------------------------------
const provPath = path.join(appRoot, "lib", "generated", "build-provenance.json")
let prov
try { prov = JSON.parse(fs.readFileSync(provPath, "utf8")) }
catch (error) { fail("PROVENANCE_FILE_UNREADABLE", `${provPath}: ${error?.message ?? error}`) }
const shaRaw = prov?.sha
if (typeof shaRaw !== "string") {
  fail("PROVENANCE_SHA_MALFORMED", `build-provenance.json sha type=${Array.isArray(shaRaw) ? "array" : typeof shaRaw} value=${JSON.stringify(String(shaRaw).slice(0, 64))}`)
}
const sha = shaRaw.toLowerCase()
if (!/^[0-9a-f]{40}$/.test(sha)) {
  fail("PROVENANCE_SHA_MALFORMED", `build-provenance.json sha=${JSON.stringify(shaRaw.slice(0, 64))}`)
}

const ledgerPath = argv["ledger"]
  || process.env.WILLIAMOS_INTEGRATIONS_LEDGER
  || path.join(process.env.USERPROFILE || process.env.HOME || "", ".williamos", "integrations.json")
let ledger
try { ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8")) }
catch (error) { fail("LEDGER_UNREADABLE", `${ledgerPath}: ${error?.message ?? error}`) }

const entries = Array.isArray(ledger?.integrations) ? ledger.integrations : []
const authorized = new Map()
for (const e of entries) {
  if (e?.productState === "COMPLETE" && typeof e?.labMainAfter === "string") {
    authorized.set(e.labMainAfter.toLowerCase(), e)
  }
}
if (authorized.size === 0) fail("LEDGER_EMPTY", `no COMPLETE integration entries in ${ledgerPath}`)
if (!authorized.has(sha)) {
  fail("REVISION_NOT_INTEGRATED", `${sha.slice(0, 12)} is not an authorized integrated lab-main revision per ${ledgerPath}`)
}

// --- B. authenticity: attested bytes ------------------------------------------------------------
let auth = null
try {
  const m = verifyManifest(appRoot)
  if (m.ok) auth = { source: "signed-manifest", treeDigest: m.treeDigest, keyId: m.keyId }
  else auth = { failedManifest: m }
} catch (error) { auth = { crashedManifest: String(error?.message ?? error) } }
if (!auth || auth.failedManifest || auth.crashedManifest) {
  const seal = verifySealReceipt(appRoot)
  if (seal.ok) auth = { source: "external-seal-receipt", treeDigest: seal.treeDigest }
  else if (process.env.WILLIAMOS_GATE_ALLOW_UNSIGNED_LEDGER_ONLY === "1") {
    console.error(`DOOR_PROVENANCE_WARNING authenticity not attested (manifest: ${JSON.stringify((auth?.failedManifest ?? auth?.crashedManifest))}, seal: ${seal.code} ${seal.detail}); ledger-only boot authorized by WILLIAMOS_GATE_ALLOW_UNSIGNED_LEDGER_ONLY`)
    auth = { source: "LEDGER_ONLY_ESCAPER" }
  } else {
    const mf = auth?.failedManifest
    const mfDetail = mf ? `${mf.code} ${mf.detail}` : (auth?.crashedManifest ?? "no manifest attempt")
    fail("NO_ARTIFACT_ATTESTATION", `revision ${sha.slice(0, 12)} is in the ledger, but the booted bytes are not attested: manifest [${mfDetail}]; seal receipt [${seal.code} ${seal.detail}]`)
  }
}

const witness = authorized.get(sha)
console.log(`DOOR_PROVENANCE_OK ${sha} authorized_at=${witness.at ?? ""} sealKey=${witness.sealKey ?? ""} reviewerKey=${witness.reviewerKey ?? ""} attested_by=${auth.source} tree=${String(auth.treeDigest ?? "").slice(0, 12)}`)
process.exit(0)
