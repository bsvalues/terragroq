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
 *     of a productState COMPLETE entry in the ledger copy installed INSIDE the administrator-
 *     locked gate directory by the deploy (~/.williamos/integrations.json is the integration
 *     tool's write-side record; a runtime-identity-writable file can never be the admission
 *     authority — the door's identity is the same one that owns HOME).
 *
 *  B. AUTHENTICITY (bytes): the booted tree's content must match what was attested, accepted via
 *     either of two mechanisms whose trust anchors live OUTSIDE the robocopy target AND outside
 *     anything the door identity can rewrite: a signed deployment manifest verified against the
 *     ring inside the gate dir, or an external SIGNED seal receipt in the same locked dir.
 *
 * R5 (round-4 review): trust paths are selected by ARGUMENT ONLY, never by environment variable —
 * the door task runs as the identity that owns HKCU\Environment, so env-selected anchors were the
 * B2 downgrade class under a new name. And every anchor must pass BOTH a write probe AND an
 * OWNER check when production-scoped: an access mask alone cannot tell "an administrator locked
 * this" from "the attacker locked it against itself" (deny entries are revocable by their owner;
 * ownership is not re-takable without elevation — empirically verified on this box).
 *
 * Fail-closed, typed refusals, no network, no fallback. Exit 0 ONLY on DOOR_PROVENANCE_OK with
 * both proofs; the accepted line echoes the ledger seal witness AND the authenticity source.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  verify as verifyManifest, verifySealReceipt, isWritableByThisIdentity, anchorUntrustedReason,
  parseFlags, PRODUCTION_GATE_DIR, RING_FILENAME, LEDGER_FILENAME,
} from "./attest-deployment.mjs"

const argv = parseFlags(process.argv.slice(2))
const armed = (v) => v === true || (typeof v === "string" && !/^(0|false|off)$/i.test(v))
const allowRuntimeCopy = argv["allow-runtime-copy"] === true

const fail = (code, detail) => {
  console.error(`DOOR_PROVENANCE_REFUSED ${code} ${String(detail).slice(0, 300)}`)
  process.exit(1)
}

const appRoot = argv["app-root"]
if (!appRoot) fail("ARGS_INVALID", "--app-root=<runtime root> is required")

// #1223 R6 (BLOCKING B6-1): node-injecting environment variables are an authority channel, not a
// convenience. Node honours NODE_OPTIONS/NODE_PATH/NODE_REPL_EXTERNAL_MODULE for the process itself,
// so a value set in the door identity's own HKCU\Environment can --require attacker code into THIS
// process, print DOOR_PROVENANCE_OK and exit 0 without verifying anything (executed on the real
// launcher before this check existed). The launchers clear these; the gate refuses if any survived,
// so a launcher edit cannot silently reopen the channel.
// Only the CODE-LOADING channel is refused: a bare NODE_OPTIONS value (tuning flags such as
// --no-warnings) is normal in build/test environments and must not block an honest boot, while
// --require/-r/--import/--loader make this process's verdict manufacturable.
const CODE_LOADING = /(^|\s)(--require|-r|--import|--loader|--experimental-loader)(=|\s|$)/
for (const injectVar of ["NODE_OPTIONS", "NODE_REPL_EXTERNAL_MODULE"]) {
  const injectValue = process.env[injectVar]
  if (typeof injectValue === "string" && injectValue.trim() !== "" && (injectVar !== "NODE_OPTIONS" || CODE_LOADING.test(injectValue))) {
    fail("NODE_INJECTION_ENV", `${injectVar}=${injectValue.slice(0, 120)} loads code into this process, so its verdict cannot be trusted as provenance; the launchers clear it (#1223 R6)`)
  }
}
// NODE_PATH is deliberately NOT refused here: it only affects BARE specifiers, while this gate's
// imports are relative or node: builtins, so it cannot manufacture this process's verdict. The
// launchers still clear it (measured: vitest legitimately sets NODE_PATH in tooling environments,
// so a presence-based refusal would refuse honest runs — narrowness is the point).
// NODE_OPTIONS reaches node as real exec args, so read them directly: a preload that returns instead
// of exiting is visible here. (A preload that exits 0 first is caught by the launcher's scrub — the
// load-bearing control — not by this file, and this comment says so on purpose.)
for (const execArg of process.execArgv) {
  if (/^(--require|-r|--import|--loader|--experimental-loader)(=|$)/.test(execArg)) {
    fail("NODE_INJECTION_EXECARGV", `this process was started with ${execArg}; an injected preload can manufacture a verdict, so no verdict from it counts (#1223)`)
  }
}

// Placement check: this verifier is trusted BYTES, so it must run from the trusted directory it
// ships in (ProgramData, beside the launchers, administrator-owned). An old copy carried inside a
// robocopied runtime may be stale code that predates today's checks; running it would let an
// attacker pick which verifier admits them. --allow-runtime-copy is reserved for tests/repair.
const trustedDir = typeof argv["gate-dir"] === "string" && argv["gate-dir"]
  ? argv["gate-dir"] : PRODUCTION_GATE_DIR

// #1223 R6 (B6-3): the PRODUCTION gate has no relaxed modes. An independent lane executed
// `gate --app-root=<fake> --allow-runtime-copy --ledger=<attacker> --ring=<attacker>` and got
// DOOR_PROVENANCE_OK for unattested bytes; with the boot route's argv reachable that is a bypass, and
// a flag any caller may pass is not a boundary. Repair/inspection of a staged runtime uses the lane
// copy of this verifier, never the installed one.
// Keyed on where THIS verifier file actually lives, not on a defaulted --gate-dir: a lane/test copy
// stays usable (it is not the installed gate), while the installed gate has no relaxed modes.
const selfDir = path.dirname(fileURLToPath(import.meta.url))
const productionScoped = /programdata[\\/]+williamos/i.test(selfDir)
if (productionScoped) {
  if (allowRuntimeCopy) {
    fail("REPAIR_FLAG_ON_PRODUCTION_GATE", "--allow-runtime-copy is refused when the gate runs from the production trusted directory; inspect a staged runtime with the lane copy of this verifier instead (#1223 R6)")
  }
  for (const overrideFlag of ["ring", "ledger", "target"]) {
    if (typeof argv[overrideFlag] === "string" && argv[overrideFlag] !== "") {
      fail("TRUST_OVERRIDE_ON_PRODUCTION_GATE", `--${overrideFlag}= is refused on the production gate: trust anchors are fixed by the elevated deploy, and a caller-supplied anchor is exactly the bypass this gate exists to close (#1223 R6)`)
    }
  }
}
if (!allowRuntimeCopy) {
  let self
  try { self = fs.realpathSync(fileURLToPath(import.meta.url)) } catch { self = "" }
  if (!self) fail("GATE_IDENTITY_UNKNOWN", "cannot resolve this verifier's own path; refusing to guess trust")
  const trustedSelf = path.join(trustedDir, "verify-door-provenance.mjs")
  if (self.toLowerCase() !== trustedSelf.toLowerCase()) {
    fail("GATE_NOT_IN_TRUSTED_DIR", `${self} is not the trusted ${path.join(trustedDir, "verify-door-provenance.mjs")}`)
  }
}

// Anchor probes. An anchor is only an anchor if the identity running the door cannot rewrite it
// AND cannot re-take what it "locked" against itself. Check every file the verdict will read:
// this verifier, the attester beside it (verify() executes through that import), the ring, and
// the ledger copy — each under the same rule.
// Probe the ring that will ACTUALLY be read (argv override or the gate-dir default) — a probe of
// a constant file the run never loads would vouch for a ring an attacker still controls.
const ringAnchor = typeof argv["ring"] === "string" && argv["ring"] ? argv["ring"] : path.join(trustedDir, RING_FILENAME)
const anchorsToProbe = [
  { path: fileURLToPath(import.meta.url), writableCode: "GATE_TAMPERABLE" },
  { path: path.join(trustedDir, "attest-deployment.mjs"), writableCode: "GATE_TAMPERABLE" },
  { path: ringAnchor, writableCode: "TRUST_RING_TAMPERABLE" },
  { path: path.join(trustedDir, LEDGER_FILENAME), writableCode: "ANCHOR_TAMPERABLE" },
]
if (!allowRuntimeCopy) {
  for (const anchor of anchorsToProbe) {
    if (!fs.existsSync(anchor.path)) continue // absence is handled by the typed check that reads it
    const reason = anchorUntrustedReason(anchor.path)
    if (reason === "writable") {
      fail(anchor.writableCode,
        `${anchor.path} is writable by the identity running the door; it cannot be the authority for bytes it can rewrite`)
    }
    if (reason) {
      fail("ANCHOR_OWNER_NOT_TRUSTED", `${anchor.path} anchor ${reason}; an owner can revoke its own deny — only an administrator-owned anchor proves anything`)
    }
  }
}

// --- A. authority: ledger membership -----------------------------------------------------------
const provPath = path.join(appRoot, "lib", "generated", "build-provenance.json")
let prov
try { prov = JSON.parse(fs.readFileSync(provPath, "utf8")) }
catch (error) { fail("PROVENANCE_FILE_UNREADABLE", `${provPath}: ${error?.message ?? error}`) }
const shaRaw = prov?.sha
if (typeof shaRaw !== "string") {
  // Describe the value without ever coercing it: an object with an uncoercible toString would throw
  // here, turning a typed refusal into crash text (round-2 review O1).
  const kind = Array.isArray(shaRaw) ? "array" : typeof shaRaw
  let rendered = "(unprintable)"
  try { rendered = JSON.stringify(String(shaRaw)).slice(0, 80) } catch { rendered = `(uncoercible ${kind})` }
  fail("PROVENANCE_SHA_MALFORMED", `build-provenance.json sha type=${kind} value=${rendered}`)
}
const sha = shaRaw.toLowerCase()
if (!/^[0-9a-f]{40}$/.test(sha)) {
  fail("PROVENANCE_SHA_MALFORMED", `build-provenance.json sha=${JSON.stringify(shaRaw.slice(0, 64))}`)
}

// R5: the admission ledger is the copy the elevated deploy installed INSIDE the locked gate dir.
// --ledger exists for tests/repair only (it pairs with --allow-runtime-copy; a production boot
// never passes either).
let ledgerPath
if (typeof argv["ledger"] === "string" && argv["ledger"]) {
  // argv overrides are the tests/repair surface: the production launcher hardcodes its call and
  // a filesystem-writer cannot inject arguments into the scheduled-task boot path (only env,
  // which R5 removed as a trust channel entirely).
  ledgerPath = argv["ledger"]
} else {
  ledgerPath = path.join(trustedDir, LEDGER_FILENAME)
}
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
const verifierFlags = { "gate-dir": trustedDir, "ring": typeof argv["ring"] === "string" ? argv["ring"] : undefined }
const receiptTarget = typeof argv["target"] === "string" && argv["target"] ? argv["target"] : undefined
let auth = null
try {
  const m = verifyManifest(appRoot, verifierFlags)
  if (m.ok) auth = { source: "signed-manifest", treeDigest: m.treeDigest, keyId: m.keyId }
  else auth = { failedManifest: m }
} catch (error) { auth = { crashedManifest: String(error?.message ?? error) } }
if (!auth || auth.failedManifest || auth.crashedManifest) {
  const seal = verifySealReceipt(appRoot, receiptTarget, verifierFlags)
  if (seal.ok) auth = { source: "external-seal-receipt", treeDigest: seal.treeDigest }
  else {
    const mf = auth?.failedManifest
    const mfDetail = mf ? `${mf.code} ${mf.detail}` : (auth?.crashedManifest ?? "no manifest attempt")
    fail("NO_ARTIFACT_ATTESTATION", `revision ${sha.slice(0, 12)} is in the ledger, but the booted bytes are not attested: manifest [${mfDetail}]; seal receipt [${seal.code} ${seal.detail}]`)
  }
}

const witness = authorized.get(sha)
console.log(`DOOR_PROVENANCE_OK ${sha} authorized_at=${witness.at ?? ""} sealKey=${witness.sealKey ?? ""} reviewerKey=${witness.reviewerKey ?? ""} attested_by=${auth.source} tree=${String(auth.treeDigest ?? "").slice(0, 12)}`)
process.exit(0)
