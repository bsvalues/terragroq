#!/usr/bin/env node
/**
 * #1223 / #1236 R2–R5 — deployment artifact attestation (attest / verify / seal halves).
 *
 * The self-declared build-provenance sha proves which revision CLAIMS to be deployed; it does
 * not prove the booted BYTES are that revision — a runtime-writer can carry a known-good
 * provenance file along with unauthorized code. This binds the artifact to its CONTENT:
 *
 *   attest:  hashes every file of the product bundle the door boots — .next/** (excluding the
 *            generated cache/diagnostics dirs), server.js, package.json, .env.local, the loose
 *            trees lib, scripts, config, components, public, AND node_modules (round-3 review:
 *            the boot REQUIRES next from there, so unbound dependencies were the bypass). The
 *            summary is signed (Ed25519) with the deployment attestation key whose PRIVATE half
 *            lives only in the administrator-gated trust dir (C:\ProgramData\WilliamOS\trust —
 *            unreadable by the runtime identity), written to lib/generated/deployment-manifest.json.
 *
 *   verify:  the launcher's gate re-hashes the booted tree, recomputes the summary, checks the
 *            signature against the trust ring published INSIDE the trusted gate directory, and
 *            requires manifest.sha == build-provenance sha == a COMPLETE ledger entry.
 *
 *   seal:    records the same fact in an EXTERNAL SIGNED receipt inside the administrator-locked
 *            gate directory (outside the robocopy target), verified with the PUBLIC ring only —
 *            no secret is ever readable at the door.
 *
 * R5 (round-4 review, BLOCKING): trust paths are selected by ARGUMENT ONLY — never by environment
 * variable. The door task runs as the same interactive identity that owns HKCU\Environment, so an
 * env-selected trust root was the same B2 downgrade class under a different name (reviewer proof
 * A10 minted an attacker-signed manifest and booted tampered bytes by pointing
 * WILLIAMOS_DEPLOYMENT_ATTESTATION_KEYS at its own ring). And the anchors it validates are trusted
 * only when THIS identity provably cannot rewrite them: a write probe plus — for anything inside
 * the production ProgramData root — an OWNER check. A self-imposed `icacls /deny` is revocable by
 * the same non-elevated identity (it keeps WRITE_DAC); an owner it cannot become is not
 * (empirically: setowner to BUILTIN\Administrators from non-elevated bs => Access Denied).
 * Production paths are constants here; overrides exist as explicit --flags for tests/repair only.
 *
 * Fail-closed typed reasons: MANIFEST_MISSING / MANIFEST_MALFORMED / MANIFEST_UNSIGNED /
 * MANIFEST_SIGNER_UNKNOWN / MANIFEST_TREE_MISMATCH / MANIFEST_SHA_NOT_BUILD_SEALED /
 * SEAL_RECEIPT_INVALID / NO_TRUST_ROOT / ANCHOR_OWNER_NOT_TRUSTED. A missing trust root REFUSES —
 * it is never a silent downgrade to self-reported provenance.
 */
import crypto from "node:crypto"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Round-3 review (BLOCKING 1): node_modules CONTENT must be bound — server.js requires next at
// boot from it. Only generated build caches are excluded (.next/cache, .next/diagnostics).
const VOLATILE_EXCLUDE = /(^|[/\\])\.next[/\\](cache|diagnostics)([/\\]|$)/
const ATTESTATION_FILES = new Set([
  "lib/generated/deployment-manifest.json",
])

// --- Production trust constants (R5: never env-selectable) ------------------------------------
export const PRODUCTION_GATE_DIR = "C:\\ProgramData\\WilliamOS\\scripts\\hermes-bridge"
export const PRODUCTION_TRUST_ROOT = "C:\\ProgramData\\WilliamOS\\trust"
export const RING_FILENAME = "deployment-attestation-keys.json"
export const RECEIPT_FILENAME = "deployment-attestation.json"
export const KEY_FILENAME = "deployment-attestation-key.json"
// The admission ledger is a COPY the elevated deploy installs inside the locked gate dir; the
// home-dir original is the integration tool's write-side record and is NOT an admission
// authority — the door identity owns HOME, so it can rewrite anything there at will (R5).
export const LEDGER_FILENAME = "integrations.json"
// Anchors under the production root must be owned by one of these: the deploy installs elevated,
// and the door identity (a standard member of Users, not an admin) can neither rewrite nor
// re-take-ownership of what those principals own.
const TRUSTED_ANCHOR_OWNERS = new Set(["BUILTIN\\Administrators", "NT AUTHORITY\\SYSTEM"])

const RECEIPT_VERSION = "williamos-door-receipt.v2"
const MANIFEST_VERSION = "williamos-deployment-manifest.v3" // v3: links bind raw targets too
const MAX_HASH_FILES = 300_000

function hashFile(abs) {
  return crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex")
}

/**
 * Bind every byte the boot can execute. Rules (round-3: pnpm lays node_modules out as directories
 * of links; a link whose TARGET was outside the attested root was a free-bytes channel;
 * round-4 NOTE: an ADDED link was invisible to the digest at all):
 *  - every symlink/junction binds its RAW TARGET STRING (LINK\t<target>), so adding, removing, or
 *    repointing a link changes the digest even when the target's canonical bytes are elsewhere;
 *  - a link resolving OUTSIDE the tree additionally hashes the resolved FILE's bytes under the
 *    link's name, and a resolved DIRECTORY is walked (cycle-guarded) — reachable code is bound
 *    wherever it lives;
 *  - a link resolving INSIDE the tree: its canonical content is hashed by the real walk;
 *  - every path is sorted, so the digest is order-stable.
 */
export function hashTree(appRoot) {
  const roots = [".next", "lib", "scripts", "config", "components", "public", "node_modules"]
  const singles = ["server.js", "package.json", ".env.local"]
  const lines = []
  let fileCount = 0
  let baseReal
  try { baseReal = fs.realpathSync(appRoot) } catch { baseReal = path.resolve(appRoot) }
  const basePrefix = baseReal.toLowerCase() + path.sep
  const insideTree = (real) => real.toLowerCase().startsWith(basePrefix)
  const visitedExtDirs = new Set()
  const bump = () => {
    if (++fileCount > MAX_HASH_FILES) {
      throw new Error(`HASH_FILE_BUDGET_EXCEEDED ${fileCount}>${MAX_HASH_FILES}; refusing an unbounded digest`)
    }
  }
  const bind = (rel, abs) => { lines.push(`${rel}\t${hashFile(abs)}`); bump() }
  function walk(rel, abs) {
    let entries
    try { entries = fs.readdirSync(abs, { withFileTypes: true }) } catch { return }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name
      if (VOLATILE_EXCLUDE.test(childRel)) continue
      const childAbs = path.join(abs, e.name)
      let st
      try { st = fs.lstatSync(childAbs) } catch { continue }
      if (st.isSymbolicLink()) {
        let rawTarget
        try { rawTarget = fs.readlinkSync(childAbs) } catch { rawTarget = "(unreadable-target)" }
        lines.push(`${childRel}\tLINK\t${rawTarget}`) // R5: the link ITSELF is bound
        bump()
        let real
        try { real = fs.realpathSync(childAbs) } catch { continue }
        if (insideTree(real)) continue // canonical bytes are walked once from inside the tree
        let realSt
        try { realSt = fs.statSync(real) } catch { continue }
        if (realSt.isDirectory()) {
          if (visitedExtDirs.has(real)) continue
          visitedExtDirs.add(real)
          walk(childRel, childAbs) // readdir follows the link; content bound under this name
        } else if (realSt.isFile()) {
          bind(childRel, real)
        }
        continue
      }
      if (st.isDirectory()) { walk(childRel, childAbs); continue }
      if (st.isFile()) {
        if (ATTESTATION_FILES.has(childRel)) continue
        bind(childRel, childAbs)
      }
    }
  }
  for (const f of singles) {
    const abs = path.join(appRoot, f)
    let st
    try { st = fs.lstatSync(abs) } catch { continue }
    if (st.isSymbolicLink()) {
      let rawTarget
      try { rawTarget = fs.readlinkSync(abs) } catch { rawTarget = "(unreadable-target)" }
      lines.push(`${f}\tLINK\t${rawTarget}`)
      bump()
      let real
      try { real = fs.realpathSync(abs) } catch { real = null }
      if (real && fs.statSync(real).isFile()) bind(f, real)
      continue
    }
    if (st.isFile()) bind(f, abs)
  }
  for (const r of roots) {
    const abs = path.join(appRoot, r)
    let st
    try { st = fs.lstatSync(abs) } catch { continue }
    if (st.isSymbolicLink()) continue // attest() refuses a reparse-point node_modules outright
    if (st.isDirectory()) walk(r, abs)
  }
  const treeDigest = crypto.createHash("sha256").update(lines.sort().join("\n")).digest("hex")
  return { treeDigest, fileCount }
}

function canonicalBody(body) {
  const clone = JSON.parse(JSON.stringify(body))
  delete clone.signature
  delete clone.keyId
  const sorted = {}
  for (const k of Object.keys(clone).sort()) sorted[k] = clone[k]
  return JSON.stringify(sorted)
}

function createPrivateKeyDer(b64) {
  return crypto.createPrivateKey({ key: Buffer.from(b64, "base64"), format: "der", type: "pkcs8" })
}
function createPublicKeyDer(b64) {
  return crypto.createPublicKey({ key: Buffer.from(b64, "base64"), format: "der", type: "spki" })
}

function resolveKeyFile(flags) {
  return typeof flags["key"] === "string" && flags["key"]
    ? flags["key"] : path.join(PRODUCTION_TRUST_ROOT, KEY_FILENAME)
}

export function attest(appRoot, sha, builtAt, flags = {}) {
  if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) throw new Error("ATTEST_SHA_REQUIRED 40-hex sha of the integrated revision")
  const keyFile = resolveKeyFile(flags)
  if (!fs.existsSync(keyFile)) throw new Error("ATTEST_KEY_MISSING " + keyFile)
  // A junctioned/symlinked node_modules keeps its bytes OUTSIDE the tree (walkFiles skips links),
  // so a manifest minted over it would claim to bind dependencies it cannot see. Refuse; the
  // deploy materializes real files for exactly this reason.
  const modules = path.join(appRoot, "node_modules")
  try {
    if (fs.existsSync(modules) && fs.lstatSync(modules).isSymbolicLink()) {
      throw new Error("ATTEST_MODULES_NOT_PHYSICAL node_modules is a reparse point; materialize it before attesting")
    }
  } catch (error) {
    if (String(error?.message ?? error).startsWith("ATTEST_MODULES_NOT_PHYSICAL")) throw error
  }
  const record = JSON.parse(fs.readFileSync(keyFile, "utf8"))
  const priv = createPrivateKeyDer(record.privateKeyBase64)
  const { treeDigest, fileCount } = hashTree(appRoot)
  const body = {
    version: MANIFEST_VERSION,
    sha: sha.toLowerCase(), builtAt: builtAt ?? new Date().toISOString(),
    treeDigest, fileCount,
  }
  const signature = crypto.sign(null, Buffer.from(canonicalBody(body)), priv).toString("base64")
  const out = { ...body, keyId: record.keyId, signature }
  fs.mkdirSync(path.join(appRoot, "lib", "generated"), { recursive: true })
  fs.writeFileSync(path.join(appRoot, "lib", "generated", "deployment-manifest.json"), JSON.stringify(out, null, 2) + "\n")
  return { treeDigest, fileCount, keyId: record.keyId }
}

function signBody(canonical, flags) {
  const record = JSON.parse(fs.readFileSync(resolveKeyFile(flags), "utf8"))
  const priv = createPrivateKeyDer(record.privateKeyBase64)
  return { keyId: record.keyId, signature: crypto.sign(null, Buffer.from(canonical, "utf8"), priv).toString("base64") }
}

// --- Anchor trust ------------------------------------------------------------------------------
/**
 * True when THIS identity can modify the anchor — writing the file itself, OR creating/deleting
 * entries in its parent directory (a read-only file inside a writable directory can simply be
 * substituted; round-3 review). The directory probe creates and removes a unique temp file.
 */
export function isWritableByThisIdentity(p) {
  try { fs.closeSync(fs.openSync(p, "r+")); return true } catch { /* file not openable r+; try the directory */ }
  try {
    const probe = path.join(path.dirname(p), `.tamper-probe-${process.pid}-${Date.now()}`)
    fs.writeFileSync(probe, "")
    fs.unlinkSync(probe)
    return true
  } catch { return false }
}

/** Owner of an absolute path (Windows: name via Get-Acl; POSIX: uid, 0 = root). null = unknown. */
export function anchorOwner(p) {
  if (process.platform === "win32") {
    try {
      const escaped = String(p).replace(/'/g, "''")
      const out = execFileSync("powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", `(Get-Acl -LiteralPath '${escaped}').Owner`],
        { encoding: "utf8", timeout: 30000, windowsHide: true }).trim()
      return out || null
    } catch { return null }
  }
  try { return String(fs.statSync(p).uid) } catch { return null }
}

/**
 * The R4 blocking lesson in code: an access-mask probe cannot see OWNERSHIP. A standard user who
 * stages an anchor and slaps `icacls /deny` on it passes the write probe — and can revoke the deny
 * at will (WRITE_DAC is retained). For anything inside the production root, "an administrator
 * installed this" must be visible in the OWNER, not just in the ACL. Outside the production root
 * (scratch/test/repair paths) the write probe is the only meaningful rule — those paths can only
 * be selected by explicit argv, which the launchers never do.
 */
export function anchorUntrustedReason(abs) {
  if (isWritableByThisIdentity(abs)) return "writable"
  if (process.platform !== "win32") return null
  const norm = abs.toLowerCase().replace(/\//g, "\\")
  const underRoot = norm.includes("programdata\\williamos\\") || norm === "c:\\programdata\\williamos" || norm.endsWith("programdata\\williamos")
  if (!underRoot) return null
  const owner = anchorOwner(abs)
  if (owner === null) return "owner-unreadable"
  if (!TRUSTED_ANCHOR_OWNERS.has(owner)) return "owner=" + owner
  return null
}

/** Ring path for a gate dir: derived, never a separate knob (attacker cannot redirect ring without
 *  also relocating the whole trusted dir, which the placement check forbids). */
export function ringPathFor(gateDir) { return path.join(gateDir || PRODUCTION_GATE_DIR, RING_FILENAME) }
export function receiptPathFor(gateDir) { return path.join(gateDir || PRODUCTION_GATE_DIR, RECEIPT_FILENAME) }
export function trustRingPath(gateDir) { return ringPathFor(gateDir) } // kept for the gate's probe

function readRing(flags) {
  const ringPath = typeof flags["ring"] === "string" && flags["ring"] ? flags["ring"] : ringPathFor(flags["gate-dir"])
  if (!fs.existsSync(ringPath)) return { code: "NO_TRUST_ROOT", detail: "attestation ring absent: " + ringPath }
  try { return { ring: JSON.parse(fs.readFileSync(ringPath, "utf8")), ringPath } }
  catch (error) { return { code: "NO_TRUST_ROOT", detail: "ring unreadable: " + (error?.message ?? error) } }
}

export function verify(appRoot, flags = {}) {
  const manifestPath = path.join(appRoot, "lib", "generated", "deployment-manifest.json")
  if (!fs.existsSync(manifestPath)) return { ok: false, code: "MANIFEST_MISSING", detail: manifestPath }
  let manifest
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) }
  catch { return { ok: false, code: "MANIFEST_MALFORMED", detail: "deployment-manifest.json is not JSON" } }
  if (manifest?.version !== MANIFEST_VERSION || typeof manifest.treeDigest !== "string"
    || typeof manifest.sha !== "string") {
    return { ok: false, code: "MANIFEST_MALFORMED", detail: "version/shape" }
  }
  if (typeof manifest.signature !== "string" || manifest.signature.length < 32) {
    return { ok: false, code: "MANIFEST_UNSIGNED", detail: "no signature field" }
  }
  const r = readRing(flags)
  if (r.code) return { ok: false, code: r.code, detail: r.detail }
  const pubB64 = r.ring[manifest.keyId]
  if (!pubB64) return { ok: false, code: "MANIFEST_SIGNER_UNKNOWN", detail: `keyId=${String(manifest.keyId).slice(0, 40)} is not in the deployment attestation ring` }
  let verified = false
  try {
    const key = createPublicKeyDer(pubB64)
    verified = crypto.verify(null, Buffer.from(canonicalBody(manifest)), key, Buffer.from(manifest.signature, "base64"))
  } catch { verified = false }
  if (!verified) return { ok: false, code: "MANIFEST_SIGNER_UNKNOWN", detail: "signature does not verify under its claimed ring key" }
  // Signed binding first, then content: the booted tree must digest to what the signature promises.
  const { treeDigest } = hashTree(appRoot)
  if (treeDigest !== manifest.treeDigest) {
    return { ok: false, code: "MANIFEST_TREE_MISMATCH", detail: `booted tree digests ${treeDigest.slice(0, 12)}… but the signed manifest promises ${manifest.treeDigest.slice(0, 12)}… — application bytes are NOT the attested artifact` }
  }
  const provPath = path.join(appRoot, "lib", "generated", "build-provenance.json")
  let prov
  try { prov = JSON.parse(fs.readFileSync(provPath, "utf8")) }
  catch { return { ok: false, code: "MANIFEST_SHA_NOT_BUILD_SEALED", detail: "build-provenance.json unreadable" } }
  const sha = typeof prov?.sha === "string" ? prov.sha.toLowerCase() : ""
  if (sha !== manifest.sha) {
    return { ok: false, code: "MANIFEST_SHA_NOT_BUILD_SEALED", detail: `provenance claims ${sha.slice(0, 12)}… but the attested artifact is ${manifest.sha.slice(0, 12)}…` }
  }
  return { ok: true, sha, treeDigest, keyId: String(manifest.keyId), source: "manifest" }
}

// The external receipt is SIGNED, not MAC'd: the door verifies it with the public ring alone, so no
// secret ever has to be readable by the runtime identity. It is the anchor that survives a
// runtime-writer deleting the in-runtime manifest, and its file ACL denies that identity write.
export function sealReceipt(appRoot, target, flags = {}) {
  let prov
  try { prov = JSON.parse(fs.readFileSync(path.join(appRoot, "lib", "generated", "build-provenance.json"), "utf8")) }
  catch (error) { throw new Error("SEAL_PROVENANCE_UNREADABLE " + String(error?.message ?? error)) }
  if (typeof prov?.sha !== "string" || !/^[0-9a-f]{40}$/i.test(prov.sha)) throw new Error("SEAL_SHA_MALFORMED")
  const { treeDigest } = hashTree(appRoot)
  const body = { version: RECEIPT_VERSION, sha: prov.sha.toLowerCase(), treeDigest, sealedAt: new Date().toISOString() }
  const { keyId, signature } = signBody(canonicalBody(body), flags)
  const out = target || receiptPathFor(flags["gate-dir"])
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify({ ...body, keyId, signature }, null, 2) + "\n")
  return body
}

export function verifySealReceipt(appRoot, target, flags = {}) {
  const out = target || receiptPathFor(flags["gate-dir"])
  if (!fs.existsSync(out)) return { ok: false, code: "SEAL_RECEIPT_INVALID", detail: "no external sealed receipt at " + out }
  const reason = anchorUntrustedReason(out)
  if (reason === "writable") {
    return { ok: false, code: "SEAL_RECEIPT_TAMPERABLE", detail: out + " is writable by the runtime identity, so its seal proves nothing" }
  }
  if (reason) {
    return { ok: false, code: "ANCHOR_OWNER_NOT_TRUSTED", detail: out + " anchor is not installed by a trusted owner (" + reason + "); a self-imposed deny is revocable by its owner" }
  }
  let rec
  try { rec = JSON.parse(fs.readFileSync(out, "utf8")) } catch { return { ok: false, code: "SEAL_RECEIPT_INVALID", detail: "unreadable" } }
  if (rec?.version !== RECEIPT_VERSION) return { ok: false, code: "SEAL_RECEIPT_INVALID", detail: "unexpected receipt version" }
  const { keyId, signature, ...receipt } = rec
  const r = readRing(flags)
  if (r.code) return { ok: false, code: r.code, detail: r.detail }
  const publicKey = r.ring[String(keyId)]
  if (!publicKey) return { ok: false, code: "SEAL_RECEIPT_KEY_UNTRUSTED", detail: "keyId " + keyId + " is not in the trust ring" }
  let signatureOk
  try {
    signatureOk = crypto.verify(null, Buffer.from(canonicalBody(receipt), "utf8"),
      createPublicKeyDer(publicKey), Buffer.from(String(signature ?? ""), "base64"))
  } catch (error) { return { ok: false, code: "SEAL_RECEIPT_INVALID", detail: String(error?.message ?? error) } }
  if (!signatureOk) return { ok: false, code: "SEAL_RECEIPT_SIGNATURE_INVALID", detail: "receipt signature does not verify against the trust ring" }
  let treeDigest
  try { treeDigest = hashTree(appRoot).treeDigest }
  catch (error) { return { ok: false, code: "SEAL_RECEIPT_INVALID", detail: "booted tree unreadable: " + String(error?.message ?? error) } }
  if (treeDigest !== receipt.treeDigest) return { ok: false, code: "SEAL_RECEIPT_INVALID", detail: "booted tree differs from the externally sealed digest" }
  let prov
  try { prov = JSON.parse(fs.readFileSync(path.join(appRoot, "lib", "generated", "build-provenance.json"), "utf8")) }
  catch { return { ok: false, code: "SEAL_RECEIPT_INVALID", detail: "build-provenance.json unreadable at seal check" } }
  if (String(prov?.sha).toLowerCase() !== receipt.sha) return { ok: false, code: "SEAL_RECEIPT_INVALID", detail: "provenance sha differs from sealed sha" }
  return { ok: true, sha: String(receipt.sha).toLowerCase(), treeDigest, source: "seal-receipt" }
}

/**
 * Parse an argv list into flags. Bare `--name` means true; `--name=0|false|off` means FALSE
 * (round-4 MINOR: `--allow-runtime-copy=0` used to be the string "0" — truthy — silently DISARMING
 * the placement check for a caller who meant to keep it armed). Anything else is a string value.
 */
export function parseFlags(argvList) {
  const flags = {}
  for (const a of argvList) {
    if (!a.startsWith("--")) { const i = a.indexOf("="); if (i >= 0) flags[a.slice(0, i)] = a.slice(i + 1); continue }
    const body = a.slice(2)
    const i = body.indexOf("=")
    if (i < 0) { flags[body] = true; continue }
    const name = body.slice(0, i)
    const value = body.slice(i + 1)
    flags[name] = /^(0|false|off)$/i.test(value) ? false : (value === "" ? true : value)
  }
  return flags
}

const invokedDirectly = (() => {
  try {
    return !!process.argv[1]
      && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))
  } catch { return false }
})()
if (invokedDirectly) {
  const [, , mode, ...rest] = process.argv
  const flags = parseFlags(rest)
  try {
    if (mode === "attest") console.log(JSON.stringify(attest(flags["app-root"], flags.sha, flags["built-at"] ?? null, flags)))
    else if (mode === "verify") { const r = verify(flags["app-root"], flags); console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }
    else if (mode === "seal") console.log(JSON.stringify(sealReceipt(flags["app-root"], flags.target ?? undefined, flags)))
    else if (mode === "verify-seal") { const r = verifySealReceipt(flags["app-root"], flags.target ?? undefined, flags); console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }
    else { console.error("usage: attest --app-root= --sha= [built-at=] | verify --app-root= | seal --app-root= [--target=] | verify-seal --app-root= [--target=]"); process.exit(2) }
  } catch (error) {
    console.error("DEPLOY_ATTEST_ERROR " + String(error?.message ?? error))
    process.exit(1)
  }
}
