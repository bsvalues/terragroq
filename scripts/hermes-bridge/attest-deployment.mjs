#!/usr/bin/env node
/**
 * #1223 / #1236 R2 — deployment artifact attestation (attest / verify / seal halves).
 *
 * The self-declared build-provenance sha proves which revision CLAIMS to be deployed; it does
 * not prove the booted BYTES are that revision — a runtime-writer can carry a known-good
 * provenance file along with unauthorized code. This binds the artifact to its CONTENT:
 *
 *   attest:  hashes every file of the product bundle the door boots (.next/** minus
 *            cache/diagnostics, server.js, package.json, and the loose trees lib, scripts,
 *            config, components, public), EXCLUDING generated attestation files. The summary is
 *            signed (Ed25519) with the deployment attestation key whose PRIVATE half lives
 *            OUTSIDE the runtime (~/.williamos), written to lib/generated/deployment-manifest.json.
 *            The gate and this attester are installed OUTSIDE the runtime (ProgramData) by the
 *            deploy, so their bytes are protected by directory ACL, not self-hashing.
 *
 *   verify:  the launcher's gate re-hashes the booted tree, recomputes the summary, checks the
 *            signature against the trust ring at
 *            C:\ProgramData\WilliamOS\deployment-attestation-keys.json (administrator-gated
 *            location, same placement as the launcher and task definitions), and requires
 *            manifest.sha == build-provenance sha == a COMPLETE ledger entry. Each single input
 *            is forgeable by a runtime-writer; the triple is not, because the signing key is not
 *            inside the tree being admitted.
 *
 *   seal:    records the same fact in an EXTERNAL HMAC-bound receipt (ProgramData, outside the
 *            robocopy target), used as a second accepted attestation source and to stamp a fresh
 *            build after staging but before it is ever booted.
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

const VOLATILE_EXCLUDE = /(^|[/\\])(cache|diagnostics|node_modules)([/\\]|$)/
const ATTESTATION_FILES = new Set([
  "lib/generated/deployment-manifest.json",
])
const RING_PATH_DEFAULT = "C:\\ProgramData\\WilliamOS\\deployment-attestation-keys.json"
const KEY_FILE_DEFAULT = path.join(process.env.USERPROFILE || process.env.HOME || "", ".williamos", "deployment-attestation-key.json")
const SEAL_SECRET_DEFAULT = path.join(process.env.USERPROFILE || process.env.HOME || "", ".williamos", "deployment-seal-secret.bin")
const SEAL_RECEIPT_DEFAULT = process.env.WILLIAMOS_GATE_RECEIPT || "C:\\ProgramData\\WilliamOS\\deployment-attestation.json"

function* walkFiles(root, dir) {
  let entries
  try { entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true }) } catch { return }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const e of entries) {
    const rel = dir ? `${dir}/${e.name}` : e.name
    if (VOLATILE_EXCLUDE.test(rel)) continue
    const abs = path.join(root, rel)
    let st
    try { st = fs.lstatSync(abs) } catch { continue }
    if (st.isSymbolicLink()) continue // junction targets are not part of the artifact
    if (st.isDirectory()) yield* walkFiles(root, rel)
    else if (st.isFile()) yield rel
  }
}

export function hashTree(appRoot) {
  const roots = [".next", "lib", "scripts", "config", "components", "public"]
  const singles = ["server.js", "package.json"]
  const lines = []
  let fileCount = 0
  for (const f of singles) {
    const abs = path.join(appRoot, f)
    if (!fs.existsSync(abs)) continue
    lines.push(`${f}\t${crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex")}`)
    fileCount++
  }
  for (const r of roots) {
    const abs = path.join(appRoot, r)
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) continue
    for (const rel of walkFiles(appRoot, r)) {
      if (ATTESTATION_FILES.has(rel)) continue
      lines.push(`${rel}\t${crypto.createHash("sha256").update(fs.readFileSync(path.join(appRoot, rel))).digest("hex")}`)
      fileCount++
    }
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
  const record = JSON.parse(fs.readFileSync(KEY_FILE_DEFAULT, "utf8"))
  const priv = createPrivateKeyDer(record.privateKeyBase64)
  const { treeDigest, fileCount } = hashTree(appRoot)
  const body = {
    version: "williamos-deployment-manifest.v1",
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

export function verify(appRoot) {
  const manifestPath = path.join(appRoot, "lib", "generated", "deployment-manifest.json")
  if (!fs.existsSync(manifestPath)) return { ok: false, code: "MANIFEST_MISSING", detail: manifestPath }
  let manifest
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) }
  catch { return { ok: false, code: "MANIFEST_MALFORMED", detail: "deployment-manifest.json is not JSON" } }
  if (manifest?.version !== "williamos-deployment-manifest.v1" || typeof manifest.treeDigest !== "string"
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

export function sealReceipt(appRoot, target = SEAL_RECEIPT_DEFAULT) {
  if (!fs.existsSync(SEAL_SECRET_DEFAULT)) throw new Error("SEAL_SECRET_MISSING " + SEAL_SECRET_DEFAULT)
  const prov = JSON.parse(fs.readFileSync(path.join(appRoot, "lib", "generated", "build-provenance.json"), "utf8"))
  if (typeof prov?.sha !== "string" || !/^[0-9a-f]{40}$/i.test(prov.sha)) throw new Error("SEAL_SHA_MALFORMED")
  const { treeDigest } = hashTree(appRoot)
  const receipt = { sha: prov.sha.toLowerCase(), treeDigest, sealedAt: new Date().toISOString() }
  const mac = crypto.createHmac("sha256", fs.readFileSync(SEAL_SECRET_DEFAULT))
    .update(JSON.stringify(receipt, Object.keys(receipt).sort())).digest("hex")
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify({ ...receipt, mac }, null, 2) + "\n")
  return receipt
}

export function verifySealReceipt(appRoot, target = SEAL_RECEIPT_DEFAULT) {
  if (!fs.existsSync(target)) return { ok: false, code: "SEAL_RECEIPT_INVALID", detail: "no external sealed receipt at " + target }
  if (!fs.existsSync(SEAL_SECRET_DEFAULT)) return { ok: false, code: "SEAL_RECEIPT_INVALID", detail: "seal secret unavailable; cannot trust the receipt" }
  let rec
  try { rec = JSON.parse(fs.readFileSync(target, "utf8")) } catch { return { ok: false, code: "SEAL_RECEIPT_INVALID", detail: "unreadable" } }
  const { mac, ...receipt } = rec ?? {}
  if (typeof mac !== "string" || !/^[0-9a-f]{64}$/.test(mac)) return { ok: false, code: "SEAL_RECEIPT_INVALID", detail: "no HMAC" }
  let want
  try {
    want = Buffer.from(crypto.createHmac("sha256", fs.readFileSync(SEAL_SECRET_DEFAULT))
      .update(JSON.stringify(receipt, Object.keys(receipt).sort())).digest("hex"))
  } catch (error) { return { ok: false, code: "SEAL_RECEIPT_INVALID", detail: String(error?.message ?? error) } }
  const got = Buffer.from(mac)
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) {
    return { ok: false, code: "SEAL_RECEIPT_INVALID", detail: "HMAC does not verify" }
  }
  const { treeDigest } = hashTree(appRoot)
  if (treeDigest !== receipt.treeDigest) return { ok: false, code: "SEAL_RECEIPT_INVALID", detail: "booted tree differs from the externally sealed digest" }
  const prov = JSON.parse(fs.readFileSync(path.join(appRoot, "lib", "generated", "build-provenance.json"), "utf8"))
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
