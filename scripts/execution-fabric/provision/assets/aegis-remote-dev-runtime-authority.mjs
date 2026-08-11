#!/usr/bin/node
import crypto from "node:crypto"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"

const RECEIPT_PATH = "/run/williamos-fabric/aegis-remote-dev-network-proof.json"
const PUBLIC_KEY_PATH = "/etc/williamos-fabric/aegis-remote-dev-launch-authority.pem"
const CGROUP_ROOT = "/sys/fs/cgroup"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SHA256 = /^[a-f0-9]{64}$/
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const OPERATION_HOSTS = Object.freeze({
  PROVE_PREFLIGHT: Object.freeze(["ssh.github.com"]),
  CREATE_WORKSPACE: Object.freeze(["ssh.github.com"]),
  RESTORE_DOTNET: Object.freeze(["api.nuget.org", "globalcdn.nuget.org"]),
  PUSH_AUTHORIZED_BRANCH: Object.freeze(["ssh.github.com"]),
  PROVE_POST_MERGE: Object.freeze(["ssh.github.com"]),
})

function fail(detail) { throw new Error(detail) }
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`); return value }
function exactKeys(value, keys, label) { if (JSON.stringify(Object.keys(object(value, label)).sort()) !== JSON.stringify([...keys].sort())) fail(`${label} fields differ`) }
function canonical(value) {
  if (value === null) return "null"
  if (typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number") { if (!Number.isFinite(value)) fail("non-finite number"); return JSON.stringify(value) }
  if (typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  return `{${Object.keys(object(value, "canonical value")).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
}
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex")
function canonicalBase64(value, maximumBytes) {
  if (typeof value !== "string" || !BASE64.test(value)) fail("base64 encoding differs")
  const bytes = Buffer.from(value, "base64")
  if (bytes.length < 1 || bytes.length > maximumBytes || bytes.toString("base64") !== value) fail("base64 encoding is non-canonical")
  return bytes
}
function parseCanonical(bytes, label) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 3 || bytes.length > 1_048_576) fail(`${label} size differs`)
  let value
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) } catch { fail(`${label} is invalid`) }
  if (!bytes.equals(Buffer.from(`${canonical(value)}\n`, "utf8"))) fail(`${label} is not canonical JSON`)
  return value
}
function trustedRootFile(file, mode) {
  let cursor = "/"
  for (const segment of path.dirname(file).slice(1).split("/").filter(Boolean)) {
    cursor = path.join(cursor, segment)
    const parent = fs.lstatSync(cursor)
    if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== 0 || (parent.mode & 0o022) !== 0) fail("runtime authority parent is untrusted")
  }
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o7777) !== mode) fail("runtime authority file is untrusted")
  return fs.readFileSync(file)
}

function mappedIpv4(address) {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)?.[1]
  if (dotted && net.isIP(dotted) === 4) return dotted
  const hexadecimal = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address)
  if (!hexadecimal) return null
  const high = Number.parseInt(hexadecimal[1], 16); const low = Number.parseInt(hexadecimal[2], 16)
  if (![high, low].every((value) => Number.isInteger(value) && value >= 0 && value <= 0xffff)) return null
  return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`
}

export function isDeniedDestination(address) {
  const normalized = String(address ?? "").toLowerCase()
  const mapped = mappedIpv4(normalized)
  if (mapped) return isDeniedDestination(mapped)
  if (net.isIP(normalized) === 4) {
    const octets = normalized.split(".").map(Number)
    return normalized === "192.168.1.156" || octets[0] === 10 || octets[0] === 127 || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168)
      || octets[0] === 0 || octets[0] >= 224
  }
  if (net.isIP(normalized) === 6) return !/^[23][0-9a-f]{0,3}:/.test(normalized)
  return true
}

export function allowedHostForOperation(operation, host) {
  return Object.hasOwn(OPERATION_HOSTS, operation) && OPERATION_HOSTS[operation].includes(host)
}

function verifyCgroup(receipt, ticketId) {
  if (typeof receipt.controlGroup !== "string" || !receipt.controlGroup.startsWith("/user.slice/") || receipt.controlGroup.includes("..")) fail("receipt cgroup differs")
  const expected = path.join(CGROUP_ROOT, receipt.controlGroup, `williamos-aegis-remote-dev-${ticketId}.service`)
  const real = fs.realpathSync(expected)
  if (real !== expected || !real.startsWith(`${CGROUP_ROOT}${path.sep}`)) fail("ticket cgroup path differs")
  const stat = fs.lstatSync(real)
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("ticket cgroup object differs")
  const processes = fs.readFileSync(path.join(real, "cgroup.procs"), "utf8").trim().split(/\s+/).filter(Boolean)
  if (!processes.length || !processes.every((pid) => /^[1-9][0-9]*$/.test(pid))) fail("ticket cgroup is not live")
}

function fixedRuntimeAuthorization(ticketB64, expectedOperation, packetB64 = null) {
  const receiptBytes = trustedRootFile(RECEIPT_PATH, 0o444)
  const publicKeyBytes = trustedRootFile(PUBLIC_KEY_PATH, 0o444)
  const receipt = parseCanonical(receiptBytes, "network receipt")
  const ticketBytes = canonicalBase64(ticketB64, 65_536)
  const ticket = parseCanonical(ticketBytes, "launch ticket")
  exactKeys(ticket, ["payload", "signature"], "launch ticket")
  exactKeys(ticket.payload, ["schemaVersion", "ticketId", "activationId", "authorityReference", "runId", "proofId", "claimId", "leaseId", "operation", "attempt", "previousEvidenceSha256", "packetSha256", "patchSha256", "workerSha256", "issuedAt", "expiresAt"], "launch ticket payload")
  const payload = ticket.payload
  if (payload.schemaVersion !== 1 || !UUID.test(payload.ticketId) || payload.operation !== expectedOperation || payload.activationId !== receipt.activationId
    || payload.authorityReference !== receipt.authorityReference || payload.runId !== receipt.runId || payload.proofId !== receipt.proofId
    || !SHA256.test(payload.packetSha256) || !SHA256.test(payload.patchSha256) || !SHA256.test(payload.workerSha256)
    || payload.workerSha256 !== receipt.workerSha256 || !Number.isInteger(payload.attempt) || payload.attempt < 1 || payload.attempt > 3) fail("runtime ticket binding differs")
  const issued = Date.parse(payload.issuedAt); const expires = Date.parse(payload.expiresAt); const observed = Date.parse(receipt.observedAt); const receiptExpires = Date.parse(receipt.expiresAt)
  if (![issued, expires, observed, receiptExpires].every(Number.isFinite) || issued < observed || expires > receiptExpires || expires <= issued || expires - issued > 30_000) fail("runtime ticket time binding differs")
  if (packetB64 !== null && digest(canonicalBase64(packetB64, 1_048_576)) !== payload.packetSha256) fail("runtime packet binding differs")
  const signature = canonicalBase64(ticket.signature, 128)
  if (signature.length !== 64 || digest(publicKeyBytes) !== receipt.launchAuthority?.publicKeySha256) fail("runtime signing authority differs")
  let key
  try { key = crypto.createPublicKey(publicKeyBytes) } catch { fail("runtime signing key is invalid") }
  if (key.asymmetricKeyType !== "ed25519" || !crypto.verify(null, Buffer.from(canonical(payload), "utf8"), key, signature)) fail("runtime ticket signature differs")
  const bootId = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()
  if (receipt.bootId !== bootId) fail("runtime receipt boot differs")
  verifyCgroup(receipt, payload.ticketId)
  return Object.freeze({ payload, receipt })
}

export function authorizeConnect(ticketB64, operation, host) {
  if (!allowedHostForOperation(operation, host)) fail("operation endpoint denied")
  return fixedRuntimeAuthorization(ticketB64, operation)
}

export function authorizeGitOperation(ticketB64, packetB64, operation) {
  if (!["PROVE_PREFLIGHT", "CREATE_WORKSPACE", "PUSH_AUTHORIZED_BRANCH", "PROVE_POST_MERGE"].includes(operation)) fail("Git operation denied")
  return fixedRuntimeAuthorization(ticketB64, operation, packetB64)
}
