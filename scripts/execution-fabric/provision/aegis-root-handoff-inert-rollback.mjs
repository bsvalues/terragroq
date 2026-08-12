import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
function canonicalizeJcs(value) {
  if (typeof value === "string" || value === null || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalizeJcs).join(",")}]`
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalizeJcs(value[key])}`).join(",")}}`
  throw new TypeError("unsupported canonical JSON value")
}

const TX = "53730e34-f199-49c0-8285-4567ea653730"
const FAILED_HEAD = "79359f0a6b0789d281390e576c63582debc83e15db442279751b29d97ebd509b"
const APPLY_AUTHORITY = "5f1945d1-9383-4665-b993-650b2314af96"
const APPLY_AUTHORITY_SHA256 = "e7f5f642d509f471edc5e01879055b2122afffbbe51d0b07a403aad783ee574a"
const INSTALLED_SELF = "/usr/local/libexec/williamos-aegis-root-handoff-inert-rollback.mjs"
const MACHINE = "1b490fe20bf3d61dc1f14e3a6e7fe38fc7de69c14face211fdd5afd0544c9c8b"
const ROOT = "/var/lib/williamos-fabric/remote-dev-prerequisite-handoff"
const RECEIPT = `${ROOT}/rollback-inert-${TX}.json`
const OWNER_KEY = "/etc/williamos-fabric/owner-prerequisite-authority.pem"
const INACTIVE_SCOPE_SHA256 = "d16d6d842d66d78c1f4cb2b99e93617ab6d2e7721c87e872c90c02d6599cbea9"
const ENV = Object.freeze({ HOME: "/nonexistent", PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C" })
const sha = value => crypto.createHash("sha256").update(value).digest("hex")
const exact = (value, keys) => JSON.stringify(Object.keys(value ?? {}).sort()) === JSON.stringify([...keys].sort())
function run(file, args, statuses = [0]) { const r = spawnSync(file, args, { encoding: "utf8", shell: false, timeout: 10_000, env: ENV }); if (r.error || !statuses.includes(r.status)) throw new Error(`${path.basename(file)} proof failed`); return String(r.stdout ?? "").trim() }
function trustedParents(file) { let cursor = "/"; for (const part of path.dirname(file).slice(1).split("/").filter(Boolean)) { cursor = path.join(cursor, part); const s = fs.lstatSync(cursor); if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== 0 || (s.mode & 0o022)) return false } return true }
function exactRootFile(file, mode) { const s = fs.lstatSync(file); if (!trustedParents(file) || !s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.uid !== 0 || s.gid !== 0 || (s.mode & 0o7777) !== mode) throw new Error(`${file} trust differs`); return fs.readFileSync(file) }
function canonicalRootJson(file, mode = 0o400) { const bytes = exactRootFile(file, mode); const value = JSON.parse(bytes); if (!bytes.equals(Buffer.from(`${canonicalizeJcs(value)}\n`))) throw new Error(`${file} canonical bytes differ`); return value }
function lexists(file) { try { fs.lstatSync(file); return true } catch (e) { if (e?.code === "ENOENT") return false; throw e } }

export function inspectInertRollbackObservation(o) {
  const booleans = ["journalTerminalExact", "claimExact", "successReceiptAbsent", "nftBoundaryAbsent", "unitsInactive", "listenerAbsent", "networkReceiptAbsent", "forcedCommandAbsent", "workerAbsent", "workspaceAbsent", "dispatchAbsent", "standingAuthorityAbsent"]
  return o && exact(o, booleans) && booleans.every(key => o[key] === true)
    ? { status: "ROLLBACK_INERT_PROVEN", rollbackAuthorized: false, executionAuthorized: false }
    : { status: "BLOCKED", reasonCode: "ROLLBACK_INERT_DRIFT", rollbackAuthorized: false, executionAuthorized: false }
}
export function inspectInertRollbackWindow(issuedAt, expiresAt, now) { const issued = Date.parse(issuedAt), expires = Date.parse(expiresAt), current = Date.parse(now); return [issued, expires, current].every(Number.isFinite) && expires - issued === 900_000 && issued <= current && current < expires }

function validateAuthority(bytes, publicKey, now) {
  const envelope = JSON.parse(bytes)
  if (`${canonicalizeJcs(envelope)}\n` !== bytes || !exact(envelope, ["payload", "signature"])) throw new Error("rollback authority canonical bytes differ")
  const p = envelope.payload
  if (!exact(p, ["schemaVersion", "operation", "authorityId", "transactionId", "failedJournalHeadSha256", "applyAuthorityId", "applyAuthoritySha256", "verifierSha256", "machineIdSha256", "bootId", "trustedMainCommit", "issuedAt", "expiresAt", "singleUse", "preserve"])) throw new Error("rollback authority fields differ")
  if (p.schemaVersion !== 1 || p.operation !== "AEGIS_ROLLBACK_INERT_VERIFIED" || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(p.authorityId) || p.transactionId !== TX || p.failedJournalHeadSha256 !== FAILED_HEAD || p.applyAuthorityId !== APPLY_AUTHORITY || p.applyAuthoritySha256 !== APPLY_AUTHORITY_SHA256 || !/^[0-9a-f]{64}$/.test(p.verifierSha256) || p.machineIdSha256 !== MACHINE || !/^[0-9a-f]{40}$/.test(p.trustedMainCommit) || p.singleUse !== true) throw new Error("rollback authority binding differs")
  if (canonicalizeJcs(p.preserve) !== canonicalizeJcs(["journal", "evidence", "storage", "signingKeys", "ticketTombstones", "closedHashLedger", "repositories", "standingRuntime", "installedState"])) throw new Error("rollback preserve set differs")
  if (!inspectInertRollbackWindow(p.issuedAt, p.expiresAt, new Date(now).toISOString())) throw new Error("rollback authority window differs")
  const sig = Buffer.from(envelope.signature, "base64")
  if (!crypto.verify(null, Buffer.from(canonicalizeJcs(p)), publicKey, sig)) throw new Error("rollback signature differs")
  return p
}

function liveObservation(p) {
  const names = fs.readdirSync(`${ROOT}/journal`).filter(name => name.startsWith(`${TX}.`)).sort(); if (names.length !== 7) throw new Error("journal record set differs")
  let previous = "0".repeat(64), failed
  const phases = ["AUTHORITY_CONSUMED", "STEP_INTENT", "STEP_APPLIED", "STEP_INTENT", "STEP_APPLIED", "STEP_INTENT", "FAILED_PARTIAL"]
  const steps = [null, "RECONCILE_BOUNDED_IDENTITY", "RECONCILE_BOUNDED_IDENTITY", "INSTALL_ROOT_LAUNCH_ASSETS", "INSTALL_ROOT_LAUNCH_ASSETS", "INSTALL_DUAL_STACK_BROKER_BOUNDARY", null]
  for (let index = 0; index < names.length; index++) { const record = canonicalRootJson(`${ROOT}/journal/${names[index]}`); if (!exact(record, ["schemaVersion", "sequence", "previousSha256", "phase", "detail", "recordSha256"])) throw new Error("journal record schema differs"); const claimed = record.recordSha256; const unsigned = { schemaVersion: record.schemaVersion, sequence: record.sequence, previousSha256: record.previousSha256, phase: record.phase, detail: record.detail }; const recomputed = sha(Buffer.from(canonicalizeJcs(unsigned))); const expectedName = `${TX}.${String(index + 1).padStart(6, "0")}.${claimed}.json`; if (names[index] !== expectedName || record.schemaVersion !== 1 || record.sequence !== index + 1 || record.previousSha256 !== previous || claimed !== recomputed || record.phase !== phases[index] || (steps[index] && (!exact(record.detail, ["stepId"]) || record.detail.stepId !== steps[index]))) throw new Error("journal chain differs"); if (index === 0 && (!exact(record.detail, ["authorityId", "transactionId"]) || record.detail.authorityId !== APPLY_AUTHORITY || record.detail.transactionId !== TX)) throw new Error("journal authority differs"); previous = claimed; failed = record }
  const claim = canonicalRootJson(`${ROOT}/claims/${APPLY_AUTHORITY}.claimed`)
  for (const unit of ["williamos-aegis-remote-dev-egress.service", "williamos-aegis-remote-dev-broker.service", "williamos-aegis-remote-dev-git-broker.socket"]) { const r = spawnSync("/usr/bin/systemctl", ["is-active", unit], { encoding: "utf8", env: ENV, timeout: 5000 }); if (r.error || r.signal || r.status !== 3 || !["inactive\n", "failed\n"].includes(r.stdout)) throw new Error(`${unit} inactivity differs`) }
  const tables = run("/usr/sbin/nft", ["list", "tables"])
  const listener = run("/usr/bin/ss", ["-H", "-ltn", "sport = :17734"], [0])
  const workers = run("/usr/bin/systemctl", ["list-units", "--all", "--plain", "--no-legend", "williamos-aegis-remote-dev-*.service"], [0, 1])
  return {
    journalTerminalExact: failed.phase === "FAILED_PARTIAL" && failed.recordSha256 === FAILED_HEAD && failed.detail?.detail === "exact broker/default-deny/Atlas boundary differs after apply",
    claimExact: exact(claim, ["authorityId", "transactionId", "authoritySha256"]) && claim.authorityId === APPLY_AUTHORITY && claim.transactionId === TX && claim.authoritySha256 === APPLY_AUTHORITY_SHA256,
    successReceiptAbsent: !lexists("/var/lib/williamos-fabric/remote-dev-prerequisite-verified.json"),
    nftBoundaryAbsent: !tables.split(/\r?\n/).includes("table inet williamos_aegis_remote_dev"),
    unitsInactive: true,
    listenerAbsent: listener === "",
    networkReceiptAbsent: !lexists("/run/williamos-fabric/network-proof.json") && !lexists("/run/williamos-fabric/egress-generation.json"),
    forcedCommandAbsent: !lexists("/etc/ssh/authorized_keys/williamos-fabric"),
    workerAbsent: !/\b(?:activating|active|deactivating)\b/.test(workers),
    workspaceAbsent: !lexists("/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001"),
    dispatchAbsent: !/williamos-aegis-remote-dev-[0-9a-f-]{36}\.service/.test(workers),
    standingAuthorityAbsent: (() => { const file = "/usr/local/share/williamos/aegis-root-handoff-bundle/config/execution-fabric/remote-dev-offload-v1-inactive-scope.json"; const bytes = exactRootFile(file, 0o444); if (sha(bytes) !== INACTIVE_SCOPE_SHA256) return false; const scope = JSON.parse(bytes); return scope.scheduler?.state === "disabled" && scope.scheduler?.standingAegisAuthority === false && scope.scheduler?.autonomousDispatch === false })(),
  }
}

export function main(argument) {
  if (process.platform !== "linux" || process.getuid?.() !== 0) throw new Error("root Linux required")
  if (path.resolve(process.argv[1] ?? "") !== INSTALLED_SELF) throw new Error("fixed installed verifier path required")
  const authorityPath = `${ROOT}/authorities/${path.basename(argument ?? "")}`
  if (argument !== authorityPath || !/^[0-9a-f-]{36}\.json$/.test(path.basename(argument))) throw new Error("rollback authority path differs")
  const now = Date.parse(run("/usr/bin/date", ["-u", "+%Y-%m-%dT%H:%M:%S.%3NZ"])); const p = validateAuthority(exactRootFile(argument, 0o400).toString("utf8"), exactRootFile(OWNER_KEY, 0o444), now)
  if (sha(exactRootFile(INSTALLED_SELF, 0o555)) !== p.verifierSha256) throw new Error("installed verifier bytes differ")
  if (sha(Buffer.from(fs.readFileSync("/etc/machine-id", "utf8").trim())) !== MACHINE || fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() !== p.bootId) throw new Error("resident identity differs")
  if (run("/usr/bin/git", ["--no-replace-objects", "ls-remote", "https://github.com/bsvalues/terragroq.git", "refs/heads/main"], [0]).split(/\s+/)[0] !== p.trustedMainCommit) throw new Error("fresh trusted main differs")
  const observation = liveObservation(p); const result = inspectInertRollbackObservation(observation)
  if (result.status !== "ROLLBACK_INERT_PROVEN") return result
  const settledAt = run("/usr/bin/date", ["-u", "+%Y-%m-%dT%H:%M:%S.%3NZ"]); if (!inspectInertRollbackWindow(p.issuedAt, p.expiresAt, settledAt)) throw new Error("rollback authority expired before settlement")
  const receipt = { schemaVersion: 1, status: "ROLLBACK_INERT_VERIFIED", transactionId: TX, applyAuthorityId: APPLY_AUTHORITY, rollbackAuthorityId: p.authorityId, failedJournalHeadSha256: FAILED_HEAD, verifiedAt: settledAt, trustedMainCommit: p.trustedMainCommit, machineIdSha256: MACHINE, observation, mutations: ["PUBLISH_ROLLBACK_INERT_RECEIPT"], executionAuthorized: false, activationAuthorized: false, rollbackAuthorized: false }
  const bytes = Buffer.from(`${canonicalizeJcs(receipt)}\n`)
  if (lexists(RECEIPT)) { const current = canonicalRootJson(RECEIPT); if (canonicalizeJcs({ ...current, verifiedAt: receipt.verifiedAt }) !== canonicalizeJcs(receipt)) throw new Error("existing inert receipt differs"); return current }
  const fd = fs.openSync(RECEIPT, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o400); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); const parent = fs.openSync(ROOT, fs.constants.O_RDONLY); fs.fsyncSync(parent); fs.closeSync(parent); return receipt
}

if (process.argv[1] === new URL(import.meta.url).pathname) { try { console.log(canonicalizeJcs(main(process.argv[2]))); } catch (e) { console.log(canonicalizeJcs({ status: "BLOCKED", reasonCode: "ROLLBACK_INERT_BLOCKED", detail: String(e.message), executionAuthorized: false, rollbackAuthorized: false })); process.exitCode = 1 } }
