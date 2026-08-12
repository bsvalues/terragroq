import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

export const TRANSACTION_ID = "6ad8e3e2-0b51-42a2-9c20-317c44f32a04"
export const RECEIPT_SHA256 = "41ea35adc284b37e381f1162e5cd2315f8a0ef2da5c2326e1a224c15e4fa541c"
const AUTHORITY_ID = "5368f65d-41ae-4141-93f6-bdc5f34a8ee6"
const AUTHORITY_FILE_SHA256 = "f443476d292839bb2c6c27d131bdf8c91b508be14e791344f6e64762475ffc50"
const AUTHORITY_PAYLOAD_SHA256 = "d4d98c6fe634e9979ca5c70cb5aa3172c7e68b8d9850b168ff7122d3f22c794b"
const CLAIM_FILE_SHA256 = "2b35f7b1537ef43843a11f211f23eb7eefd5b9764022149a26e2e0484f3917d5"
const JOURNAL_HEAD = "725afe6748dab29e955261b1d0c736a816f291f1aaf5e0c9d826b2b01f04fcd5"
const REVIEWED_GENERATION = "98b458b998010f8ccfe9902fd307d75c0ec8c309"
const MACHINE_ID_SHA256 = "1b490fe20bf3d61dc1f14e3a6e7fe38fc7de69c14face211fdd5afd0544c9c8b"
const ROOT = "/var/lib/williamos-fabric/remote-dev-prerequisite-handoff"
const RECEIPT = "/var/lib/williamos-fabric/remote-dev-prerequisite-verified.json"
const CLAIM = `${ROOT}/claims/${AUTHORITY_ID}.claimed`
const AUTHORITY = `${ROOT}/authorities/${AUTHORITY_ID}.json`
const JOURNAL = `${ROOT}/journal`
const OWNER_KEY = "/etc/williamos-fabric/owner-prerequisite-authority.pem"
const TRUST_FILE = "/etc/williamos-fabric/aegis-success-receipt-mode-settlement-trust.json"
const INSTALLED_SELF = "/usr/local/libexec/williamos-aegis-success-receipt-mode-settlement.mjs"
const BUNDLED_SELF = "/usr/local/share/williamos/aegis-root-handoff-bundle/scripts/execution-fabric/provision/aegis-success-receipt-mode-settlement.mjs"
const JOURNAL_RECORDS = Object.freeze([
  "5256b2d806cf21facaceeff0049ba285952e806c5261cc61bf0852c3d260b807",
  "ad098b9a61d4a28a31c8f275d5a183cc347ceff49446a431cf41efc5fc886690",
  "f28689042cc1a257f0a06f7936dd1eb54052ab02d006dc5051491c5b8046e91b",
  "3a2f9d99caef69db7305790a061fb03a030b6cbb725c2206ebcbc0dec88a4e16",
  "40498127b82f45bcc5a58d2f82308d52bd517078a4f7c1dc28068c657235a476",
  "dc33fec762e3bd3d7550540f75684ab5932f56e35cd76b99de8d52d2d6d3565f",
  "e3bdc00dbf6b3a838e93058c0be0a61cc3217dc5d9cc60ef08d4e19107ccc3df",
  "be537269310399c8dff1434308dfc695d607b187133357a2818b9968a78ab61b",
  JOURNAL_HEAD,
])

const sha = value => crypto.createHash("sha256").update(value).digest("hex")
const canonical = value => {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
  throw new TypeError("unsupported canonical JSON value")
}
const exactKeys = (value, keys) => JSON.stringify(Object.keys(value ?? {}).sort()) === JSON.stringify([...keys].sort())

function trustedParents(file) {
  let cursor = "/"
  for (const part of path.dirname(file).slice(1).split("/").filter(Boolean)) {
    cursor = path.join(cursor, part)
    const stat = fs.lstatSync(cursor)
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022) !== 0) return false
  }
  return true
}

function exactRootFile(file, mode) {
  const stat = fs.lstatSync(file)
  if (!trustedParents(file) || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o7777) !== mode) throw new Error(`${file} trust differs`)
  return fs.readFileSync(file)
}

function canonicalRootJson(file, mode) {
  const bytes = exactRootFile(file, mode)
  const value = JSON.parse(bytes)
  if (!bytes.equals(Buffer.from(`${canonical(value)}\n`))) throw new Error(`${file} canonical bytes differ`)
  return { bytes, value }
}

export function inspectReceiptModeSettlement(observation) {
  const keys = ["transactionId", "receiptSha256", "receiptMode", "receiptMetadataExact", "receiptContentExact", "claimExact", "authorityExact", "journalChainExact", "journalTerminalExact", "installedGenerationExact"]
  const exact = observation && exactKeys(observation, keys)
    && observation.transactionId === TRANSACTION_ID
    && observation.receiptSha256 === RECEIPT_SHA256
    && ["receiptMetadataExact", "receiptContentExact", "claimExact", "authorityExact", "journalChainExact", "journalTerminalExact", "installedGenerationExact"].every(key => observation[key] === true)
  if (!exact || ![0o400, 0o444].includes(observation.receiptMode)) return { status: "BLOCKED", reasonCode: "SUCCESS_RECEIPT_MODE_SETTLEMENT_DRIFT", mutationRequired: false, executionAuthorized: false, activationAuthorized: false }
  return observation.receiptMode === 0o400
    ? { status: "RECONCILE_EXACT_RECEIPT_MODE", mutationRequired: true, executionAuthorized: false, activationAuthorized: false }
    : { status: "SUCCESS_RECEIPT_MODE_SETTLED", mutationRequired: false, executionAuthorized: false, activationAuthorized: false }
}

export function inspectSettlementTrustPayload(payload, settlementSha256, now) {
  const keys = ["schemaVersion", "operation", "transactionId", "applyAuthorityId", "journalHeadSha256", "receiptSha256", "settlementSha256", "reviewedCommit", "issuedAt", "expiresAt"]
  const issued = Date.parse(payload?.issuedAt)
  const expires = Date.parse(payload?.expiresAt)
  const current = Date.parse(now)
  return !!payload && exactKeys(payload, keys) && payload.schemaVersion === 1 && payload.operation === "AEGIS_SUCCESS_RECEIPT_MODE_SETTLEMENT_TRUST"
    && payload.transactionId === TRANSACTION_ID && payload.applyAuthorityId === AUTHORITY_ID && payload.journalHeadSha256 === JOURNAL_HEAD
    && payload.receiptSha256 === RECEIPT_SHA256 && payload.settlementSha256 === settlementSha256 && payload.reviewedCommit === REVIEWED_GENERATION
    && [issued, expires, current].every(Number.isFinite) && expires - issued === 900_000 && issued <= current && current < expires
}

function trustedTime() {
  const result = spawnSync("/usr/bin/date", ["-u", "+%Y-%m-%dT%H:%M:%S.%3NZ"], { encoding: "utf8", shell: false, timeout: 5000, env: { HOME: "/nonexistent", PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C" } })
  if (result.error || result.signal || result.status !== 0 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\n$/.test(result.stdout)) throw new Error("trusted settlement time differs")
  return result.stdout.trim()
}

function proveExternalTrust(installed) {
  const trust = canonicalRootJson(TRUST_FILE, 0o444).value
  if (!exactKeys(trust, ["payload", "signature"])) throw new Error("settlement trust envelope differs")
  const installedSha = sha(installed)
  if (!inspectSettlementTrustPayload(trust.payload, installedSha, trustedTime())) throw new Error("settlement trust payload differs")
  if (!crypto.verify(null, Buffer.from(canonical(trust.payload)), exactRootFile(OWNER_KEY, 0o444), Buffer.from(trust.signature, "base64"))) throw new Error("settlement trust signature differs")
  return trust.payload
}

function proveAuthorityAndClaim() {
  const authority = canonicalRootJson(AUTHORITY, 0o400)
  const claim = canonicalRootJson(CLAIM, 0o400)
  if (sha(authority.bytes) !== AUTHORITY_FILE_SHA256 || sha(claim.bytes) !== CLAIM_FILE_SHA256) throw new Error("authority or claim bytes differ")
  if (!exactKeys(authority.value, ["payload", "signature"]) || sha(Buffer.from(canonical(authority.value.payload))) !== AUTHORITY_PAYLOAD_SHA256) throw new Error("authority payload differs")
  if (authority.value.payload.authorityId !== AUTHORITY_ID || authority.value.payload.transactionId !== TRANSACTION_ID || authority.value.payload.trustedMainCommit !== REVIEWED_GENERATION) throw new Error("authority generation differs")
  if (!crypto.verify(null, Buffer.from(canonical(authority.value.payload)), exactRootFile(OWNER_KEY, 0o444), Buffer.from(authority.value.signature, "base64"))) throw new Error("authority signature differs")
  if (!exactKeys(claim.value, ["authorityId", "authoritySha256", "observedFreshMainCommit", "reviewedPackageCommit", "transactionId"])
    || claim.value.authorityId !== AUTHORITY_ID || claim.value.authoritySha256 !== AUTHORITY_PAYLOAD_SHA256 || claim.value.transactionId !== TRANSACTION_ID
    || claim.value.observedFreshMainCommit !== REVIEWED_GENERATION || claim.value.reviewedPackageCommit !== REVIEWED_GENERATION) throw new Error("claim binding differs")
}

function proveJournal() {
  const names = fs.readdirSync(JOURNAL).filter(name => name.startsWith(`${TRANSACTION_ID}.`)).sort()
  const expectedNames = JOURNAL_RECORDS.map((recordSha, index) => `${TRANSACTION_ID}.${String(index + 1).padStart(6, "0")}.${recordSha}.json`)
  if (canonical(names) !== canonical(expectedNames)) throw new Error("journal record set differs")
  let previous = "0".repeat(64)
  for (let index = 0; index < names.length; index++) {
    const { value: record } = canonicalRootJson(`${JOURNAL}/${names[index]}`, 0o400)
    if (!exactKeys(record, ["schemaVersion", "sequence", "previousSha256", "phase", "detail", "recordSha256"])) throw new Error("journal schema differs")
    const unsigned = { schemaVersion: record.schemaVersion, sequence: record.sequence, previousSha256: record.previousSha256, phase: record.phase, detail: record.detail }
    if (record.schemaVersion !== 1 || record.sequence !== index + 1 || record.previousSha256 !== previous || record.recordSha256 !== JOURNAL_RECORDS[index] || sha(Buffer.from(canonical(unsigned))) !== record.recordSha256) throw new Error("journal chain differs")
    previous = record.recordSha256
  }
  const terminal = canonicalRootJson(`${JOURNAL}/${names.at(-1)}`, 0o400).value
  if (terminal.phase !== "COMMITTED" || terminal.recordSha256 !== JOURNAL_HEAD) throw new Error("journal terminal differs")
}

function proveReceiptContent(bytes) {
  if (sha(bytes) !== RECEIPT_SHA256) return false
  const receipt = JSON.parse(bytes)
  if (!bytes.equals(Buffer.from(`${canonical(receipt)}\n`))) return false
  return receipt.status === "PREREQUISITES_VERIFIED" && receipt.transactionId === TRANSACTION_ID && receipt.authorityId === AUTHORITY_ID
    && receipt.journalHeadSha256 === JOURNAL_HEAD && receipt.reviewedPackageCommit === REVIEWED_GENERATION && receipt.observedFreshMainCommit === REVIEWED_GENERATION
    && receipt.executionAuthorized === false && receipt.activationAuthorized === false && receipt.schedulerEnabled === false && receipt.standingAuthority === false
    && receipt.dispatchOccurred === false && receipt.closedHashMutation === false
}

function openExactReceipt() {
  if (!trustedParents(RECEIPT)) throw new Error("receipt parents differ")
  const fd = fs.openSync(RECEIPT, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const stat = fs.fstatSync(fd)
    const mode = stat.mode & 0o7777
    const bytes = fs.readFileSync(fd)
    const observation = {
      transactionId: TRANSACTION_ID,
      receiptSha256: sha(bytes),
      receiptMode: mode,
      receiptMetadataExact: stat.isFile() && stat.nlink === 1 && stat.uid === 0 && stat.gid === 0,
      receiptContentExact: proveReceiptContent(bytes),
      claimExact: true,
      authorityExact: true,
      journalChainExact: true,
      journalTerminalExact: true,
      installedGenerationExact: true,
    }
    return { fd, observation }
  } catch (error) {
    fs.closeSync(fd)
    throw error
  }
}

export function main() {
  if (process.platform !== "linux" || process.getuid?.() !== 0) throw new Error("root Linux required")
  if (path.resolve(process.argv[1] ?? "") !== INSTALLED_SELF) throw new Error("fixed installed settlement path required")
  const installed = exactRootFile(INSTALLED_SELF, 0o555)
  if (!installed.equals(exactRootFile(BUNDLED_SELF, 0o444))) throw new Error("installed settlement generation differs")
  const trust = proveExternalTrust(installed)
  if (sha(Buffer.from(fs.readFileSync("/etc/machine-id", "utf8").trim())) !== MACHINE_ID_SHA256) throw new Error("resident machine differs")
  proveAuthorityAndClaim()
  proveJournal()
  const opened = openExactReceipt()
  try {
    const result = inspectReceiptModeSettlement(opened.observation)
    if (result.status === "BLOCKED") throw new Error(result.reasonCode)
    if (result.mutationRequired) {
      if (!inspectSettlementTrustPayload(trust, sha(installed), trustedTime())) throw new Error("settlement trust expired before mutation")
      fs.fchmodSync(opened.fd, 0o444)
      fs.fsyncSync(opened.fd)
    }
  } finally {
    fs.closeSync(opened.fd)
  }
  const parentFd = fs.openSync(path.dirname(RECEIPT), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY)
  try { fs.fsyncSync(parentFd) } finally { fs.closeSync(parentFd) }
  const verified = openExactReceipt()
  try {
    const result = inspectReceiptModeSettlement(verified.observation)
    if (result.status !== "SUCCESS_RECEIPT_MODE_SETTLED") throw new Error("receipt mode postcondition differs")
    return { schemaVersion: 1, status: result.status, transactionId: TRANSACTION_ID, authorityId: AUTHORITY_ID, journalHeadSha256: JOURNAL_HEAD, receiptSha256: RECEIPT_SHA256, receiptMode: "0444", mutation: "FCHMOD_EXACT_CANONICAL_RECEIPT_ONLY", executionAuthorized: false, activationAuthorized: false }
  } finally {
    fs.closeSync(verified.fd)
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try { console.log(canonical(main())) }
  catch (error) { console.log(canonical({ status: "BLOCKED", reasonCode: "SUCCESS_RECEIPT_MODE_SETTLEMENT_BLOCKED", detail: String(error.message), executionAuthorized: false, activationAuthorized: false })); process.exitCode = 1 }
}
