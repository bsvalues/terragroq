#!/usr/bin/env node
/**
 * #1223 / #1236 R2 — deployment artifact attestation (attest / verify / seal halves).
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
 *            The gate and this attester are installed OUTSIDE the runtime (ProgramData) by the
 *            deploy, so their bytes are protected by directory ACL, not self-hashing.
 *
 *   verify:  the launcher's gate re-hashes the booted tree, recomputes the summary, checks the
 *            signature against the trust ring published beside the installed gate under
 *            C:\ProgramData\WilliamOS\scripts\hermes-bridge (administrator-locked directory;
 *            Users:RX), and requires
 *            manifest.sha == build-provenance sha == a COMPLETE ledger entry. Each single input
 *            is forgeable by a runtime-writer; the triple is not, because the signing key is not
 *            inside the tree being admitted.
 *
 *   seal:    records the same fact in an EXTERNAL SIGNED receipt (ProgramData, outside the
 *            robocopy target) verified with the PUBLIC ring only — no secret is ever readable at
 *            the door. It is the second accepted attestation source and stamps a fresh build
 *            after staging but before it is ever booted.
 *
 * Fail-closed typed reasons: MANIFEST_MISSING / MANIFEST_MALFORMED / MANIFEST_UNSIGNED /
 * MANIFEST_SIGNER_UNKNOWN / MANIFEST_TREE_MISMATCH / MANIFEST_BODY_MISMATCH /
 * MANIFEST_SHA_NOT_BUILDSALED / SEAL_RECEIPT_INVALID / NO_TRUST_ROOT. A missing trust root
 * REFUSES — it is never a silent downgrade to self-reported provenance.
 */
import crypto, { createPublicKey } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Round-3 review (BLOCKING 1): node_modules CONTENT must be bound — server.js requires next at
// boot from it. Only generated build caches are excluded (.next/cache, .next/diagnostics).
const VOLATILE_EXCLUDE = /(^|[/\\])\.next[/\\](cache|diagnostics)([/\\]|$)/
const ATTESTATION_FILES = new Set([
  "lib/generated/deployment-manifest.json",
])
const RING_PATH_DEFAULT = process.env.WILLIAMOS_DEPLOYMENT_ATTESTATION_KEYS
  || "C:\\ProgramData\\WilliamOS\\scripts\\hermes-bridge\\deployment-attestation-keys.json"
// The signing key lives in an administrator-protected trust directory: a filesystem writer running
// as the runtime identity can read neither it nor the home directory it used to sit in, so it
// cannot mint a manifest for the bytes it substituted. There is deliberately no fallback path.
const TRUST_ROOT_DEFAULT = "C:\\ProgramData\\WilliamOS\\trust"
const KEY_FILE_DEFAULT = process.env.WILLIAMOS_DEPLOYMENT_ATTESTATION_KEY
  || path.join(TRUST_ROOT_DEFAULT, "deployment-attestation-key.json")
// The receipt lives INSIDE the administrator-locked gate directory (round-3 review: the probe that
// checks the containing directory correctly flagged the old user-writable ProgramData location).
// That also makes rollback capture/restore cover it with the trusted-dir robocopy.
const SEAL_RECEIPT_DEFAULT = process.env.WILLIAMOS_GATE_RECEIPT || "C:\\ProgramData\\WilliamOS\\scripts\\hermes-bridge\\deployment-attestation.json"
const RECEIPT_VERSION = "williamos-door-receipt.v2"

const MAX_HASH_FILES = 300_000

function hashFile(abs) {
  return crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex")
}

/**
 * Bind every byte the boot can execute (round-3 review: pnpm lays node_modules out as
 * directories of links; a link whose TARGET is outside the attested root was a free-bytes
 * channel — repoint or swap its content and no hashed file changed). Rules:
 *  - a link resolving INSIDE the tree: its canonical content is hashed by the real walk, so
 *    the link itself adds no line;
 *  - a link resolving OUTSIDE: the resolved FILE's bytes are hashed under the link's name, and
 *    a resolved DIRECTORY is walked (cycle-guarded) — the reachable code is bound wherever it
 *    lives; an unresolvable link is bound by name;
 *  - every path is sorted, so the digest is order-stable.
 */
export function hashTree(appRoot) {
  // v2 (round-3 review): binds node_modules content (including links that resolve OUTSIDE the
  // root) and .env.local per the header above; a junctioned top-level node_modules is refused.
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
        let real
        try { real = fs.realpathSync(childAbs) } catch { lines.push(`${childRel}\tLINK_UNRESOLVED`); bump(); continue }
        if (insideTree(real)) continue // canonical bytes are walked once from inside the tree
        let realSt
        try { realSt = fs.statSync(real) } catch { lines.push(`${childRel}\tLINK_UNRESOLVED`); bump(); continue }
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
      let real
      try { real = fs.realpathSync(abs) } catch { real = null }
      if (real && insideTree(real) && fs.statSync(real).isFile()) bind(f, real)
      else if (real && fs.statSync(real).isFile()) bind(f, real)
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

export function attest(appRoot, sha, builtAt) {
  if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) throw new Error("ATTEST_SHA_REQUIRED 40-hex sha of the integrated revision")
  if (!fs.existsSync(KEY_FILE_DEFAULT)) throw new Error("ATTEST_KEY_MISSING " + KEY_FILE_DEFAULT)
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
  const record = JSON.parse(fs.readFileSync(KEY_FILE_DEFAULT, "utf8"))
  const priv = createPrivateKeyDer(record.privateKeyBase64)
  const { treeDigest, fileCount } = hashTree(appRoot)
  const body = {
    version: "williamos-deployment-manifest.v2",
    sha: sha.toLowerCase(), builtAt: builtAt ?? new Date().toISOString(),
    treeDigest, fileCount,
  }
  const signature = crypto.sign(null, Buffer.from(canonicalBody(body)), priv).toString("base64")
  const out = { ...body, keyId: record.keyId, signature }
  fs.mkdirSync(path.join(appRoot, "lib", "generated"), { recursive: true })
  fs.writeFileSync(path.join(appRoot, "lib", "generated", "deployment-manifest.json"), JSON.stringify(out, null, 2) + "\n")
  return { treeDigest, fileCount, keyId: record.keyId }
}
function createPrivateKeyDer(b64) {
  return crypto.createPrivateKey({ key: Buffer.from(b64, "base64"), format: "der", type: "pkcs8" })
}
function createPublicKeyDer(b64) {
  return crypto.createPublicKey({ key: Buffer.from(b64, "base64"), format: "der", type: "spki" })
}
function signBody(canonical) {
  const record = JSON.parse(fs.readFileSync(KEY_FILE_DEFAULT, "utf8"))
  const priv = createPrivateKeyDer(record.privateKeyBase64)
  return { keyId: record.keyId, signature: crypto.sign(null, Buffer.from(canonical, "utf8"), priv).toString("base64") }
}

export function verify(appRoot) {
  const manifestPath = path.join(appRoot, "lib", "generated", "deployment-manifest.json")
  if (!fs.existsSync(manifestPath)) return { ok: false, code: "MANIFEST_MISSING", detail: manifestPath }
  let manifest
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) }
  catch { return { ok: false, code: "MANIFEST_MALFORMED", detail: "deployment-manifest.json is not JSON" } }
  if (manifest?.version !== "williamos-deployment-manifest.v2" || typeof manifest.treeDigest !== "string"
    || typeof manifest.sha !== "string") {
    return { ok: false, code: "MANIFEST_MALFORMED", detail: "version/shape" }
  }
  if (typeof manifest.signature !== "string" || manifest.signature.length < 32) {
    return { ok: false, code: "MANIFEST_UNSIGNED", detail: "no signature field" }
  }
  const ringPath = process.env.WILLIAMOS_DEPLOYMENT_ATTESTATION_KEYS || RING_PATH_DEFAULT
  if (!fs.existsSync(ringPath)) return { ok: false, code: "NO_TRUST_ROOT", detail: "attestation ring absent: " + ringPath }
  let ring
  try { ring = JSON.parse(fs.readFileSync(ringPath, "utf8")) }
  catch (error) { return { ok: false, code: "NO_TRUST_ROOT", detail: "ring unreadable: " + (error?.message ?? error) } }
  const pubB64 = ring[manifest.keyId]
  if (!pubB64) return { ok: false, code: "MANIFEST_SIGNER_UNKNOWN", detail: `keyId=${String(manifest.keyId).slice(0, 40)} is not in the deployment attestation ring` }
  let verified = false
  try {
    const key = createPublicKey({ key: Buffer.from(pubB64, "base64"), format: "der", type: "spki" })
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
  catch { return { ok: false, code: "MANIFEST_SHA_NOT_BUILDSALED", detail: "build-provenance.json unreadable" } }
  const sha = typeof prov?.sha === "string" ? prov.sha.toLowerCase() : ""
  if (sha !== manifest.sha) {
    return { ok: false, code: "MANIFEST_SHA_NOT_BUILDSALED", detail: `provenance claims ${sha.slice(0, 12)}… but the attested artifact is ${manifest.sha.slice(0, 12)}…` }
  }
  return { ok: true, sha, treeDigest, keyId: String(manifest.keyId), source: "manifest" }
}

/**
 * True when THIS identity can modify the anchor — writing the file itself, OR creating/deleting
 * entries in its parent directory (a read-only file inside a writable directory can simply be
 * substituted; round-3 review). The directory probe creates and removes a unique temp file.
 */
export function trustRingPath() { return RING_PATH_DEFAULT }
export function isWritableByThisIdentity(p) {
  try { fs.closeSync(fs.openSync(p, "r+")); return true } catch { /* file not openable r+; try the directory */ }
  try {
    const probe = path.join(path.dirname(p), `.tamper-probe-${process.pid}-${Date.now()}`)
    fs.writeFileSync(probe, "")
    fs.unlinkSync(probe)
    return true
  } catch { return false }
}

// The external receipt is SIGNED, not MAC'd: the door verifies it with the public ring alone, so no
// secret ever has to be readable by the runtime identity. It is the anchor that survives a
// runtime-writer deleting the in-runtime manifest, and its file ACL denies that identity write.
export function sealReceipt(appRoot, target = SEAL_RECEIPT_DEFAULT) {
  let prov
  try { prov = JSON.parse(fs.readFileSync(path.join(appRoot, "lib", "generated", "build-provenance.json"), "utf8")) }
  catch (error) { throw new Error("SEAL_PROVENANCE_UNREADABLE " + String(error?.message ?? error)) }
  if (typeof prov?.sha !== "string" || !/^[0-9a-f]{40}$/i.test(prov.sha)) throw new Error("SEAL_SHA_MALFORMED")
  const { treeDigest } = hashTree(appRoot)
  const body = { version: RECEIPT_VERSION, sha: prov.sha.toLowerCase(), treeDigest, sealedAt: new Date().toISOString() }
  const { keyId, signature } = signBody(canonicalBody(body))
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify({ ...body, keyId, signature }, null, 2) + "\n")
  return body
}

export function verifySealReceipt(appRoot, target = SEAL_RECEIPT_DEFAULT) {
  if (!fs.existsSync(target)) return { ok: false, code: "SEAL_RECEIPT_INVALID", detail: "no external sealed receipt at " + target }
  if (isWritableByThisIdentity(target)) {
    return { ok: false, code: "SEAL_RECEIPT_TAMPERABLE", detail: target + " is writable by the runtime identity, so its seal proves nothing" }
  }
  let rec
  try { rec = JSON.parse(fs.readFileSync(target, "utf8")) } catch { return { ok: false, code: "SEAL_RECEIPT_INVALID", detail: "unreadable" } }
  if (rec?.version !== RECEIPT_VERSION) return { ok: false, code: "SEAL_RECEIPT_INVALID", detail: "unexpected receipt version" }
  const { keyId, signature, ...receipt } = rec
  const ringPath = process.env.WILLIAMOS_DEPLOYMENT_ATTESTATION_KEYS || RING_PATH_DEFAULT
  if (!fs.existsSync(ringPath)) return { ok: false, code: "NO_TRUST_ROOT", detail: "no readable trust ring at " + ringPath }
  let ring
  try { ring = JSON.parse(fs.readFileSync(ringPath, "utf8")) }
  catch (error) { return { ok: false, code: "NO_TRUST_ROOT", detail: "ring unreadable: " + (error?.message ?? error) } }
  const publicKey = ring[String(keyId)]
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

const invokedDirectly = (() => {
  try {
    return !!process.argv[1]
      && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))
  } catch { return false }
})()
if (invokedDirectly) {
  const [, , mode, ...rest] = process.argv
  const flags = Object.fromEntries(rest.map((a) => { const i = a.indexOf("="); return i < 0 ? [a.replace(/^--/, ""), "true"] : [a.slice(2, i), a.slice(i + 1)] }))
  try {
    if (mode === "attest") console.log(JSON.stringify(attest(flags["app-root"], flags.sha, flags["built-at"] ?? null)))
    else if (mode === "verify") { const r = verify(flags["app-root"]); console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }
    else if (mode === "seal") console.log(JSON.stringify(sealReceipt(flags["app-root"], flags.target ?? undefined)))
    else if (mode === "verify-seal") { const r = verifySealReceipt(flags["app-root"], flags.target ?? undefined); console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }
    else { console.error("usage: attest --app-root= --sha= [built-at=] | verify --app-root= | seal --app-root= [--target=] | verify-seal --app-root= [--target=]"); process.exit(2) }
  } catch (error) {
    console.error("DEPLOY_ATTEST_ERROR " + String(error?.message ?? error))
    process.exit(1)
  }
}
