#!/usr/bin/node
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const REPAIR_ID = "aegis-ssh-coexistence-repair-issue-595-v1"
const MACHINE_ID_SHA256 = "1b490fe20bf3d61dc1f14e3a6e7fe38fc7de69c14face211fdd5afd0544c9c8b"
const MACHINE_ID = "965def1e302b4ff8a3cb5fefa7458bc4"
const SOURCE_ADDRESS = "192.168.88.9"
const KEY_FINGERPRINT = "SHA256:dlhYn3gjgDUQ09vFt583lXl2JKMhyFQMVoFE0sQpa48"
const STANDING_KEY_SHA256 = "d054724aeea3ff42bf646d4d3aed078be21183e3a67c9ae1f8d4768e97dd2967"
const ENTRYPOINT_SHA256 = "ebcf0d068e11c1a3f98b515f9a59a456955d8d30abdbb8bab7897b9b315caf9a"
const CONFIG_SHA256 = "0f97b3005ab5a90733c7bcde47a4d1232ea1121d375229c0e31630c3b177da99"
const JOURNAL_PREFIX = "/var/lib/williamos-aegis-ssh-coexistence-repair-"
const PROOF_ROOT = "/var/lib/williamos/fabric/ssh-coexistence-repair-auth-proofs"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_AGE_MS = 900_000
const EXPECTED_PHASES = ["AUTHORITY_CONSUMED", "MUTATED_AWAITING_AUTH_PROBE", "AUTH_PROBE_CHALLENGE_ISSUED", "LOCK_RELEASE_PROVEN_AWAITING_AUTH_PROBE"]
const TRUSTED_DIRECTORIES = [
  ["/", 0, 0, 0o755],
  ["/var", 0, 0, 0o755],
  ["/var/lib", 0, 0, 0o755],
  ["/var/lib/williamos", 999, 987, 0o750],
  ["/var/lib/williamos/fabric", 999, 987, 0o700],
  [PROOF_ROOT, 0, 0, 0o700],
]

class FinalizerError extends Error { constructor(code, detail) { super(`${code}: ${detail}`); this.code = code } }
const fail = (code, detail) => { throw new FinalizerError(code, detail) }
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex")
export function canonicalize(value) { if (value === null) return "null"; if (typeof value === "string") return JSON.stringify(value); if (typeof value === "number") return JSON.stringify(value); if (typeof value === "boolean") return String(value); if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`; return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}` }
const canonicalTimestamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value

export function buildAuthProof({ authorityId, journalBytes, journalEvents, now }) {
  if (!UUID.test(authorityId) || !canonicalTimestamp(now)) fail("AEGIS_SSH_AUTH_PROOF_ARGUMENT_INVALID", "authority or time differs")
  let records
  try {
    const lines = Buffer.from(journalBytes).toString("utf8").trim().split("\n").filter(Boolean)
    records = lines.map(JSON.parse)
    if (!lines.every((line, index) => line === canonicalize(records[index])) || records.map((record) => record.record_type).join("\0") !== EXPECTED_PHASES.join("\0")) throw new Error("journal sequence")
  } catch { fail("AEGIS_SSH_AUTH_PROOF_JOURNAL_INVALID", "journal is not the canonical awaiting-auth sequence") }
  const consumed = records.filter((record) => record.record_type === "AUTHORITY_CONSUMED")
  const challenges = records.filter((record) => record.record_type === "AUTH_PROBE_CHALLENGE_ISSUED")
  if (consumed.length !== 1 || consumed[0].authority_id !== authorityId || challenges.length !== 1 || !/^[a-f0-9]{64}$/.test(challenges[0].challenge_nonce ?? "") || !canonicalTimestamp(challenges[0].challenge_issued_at)) fail("AEGIS_SSH_AUTH_PROOF_JOURNAL_INVALID", "authority or challenge differs")
  const challengeAt = Date.parse(challenges[0].challenge_issued_at), current = Date.parse(now)
  const matcher = new RegExp(`^Accepted publickey for williamos-fabric from ${SOURCE_ADDRESS.replaceAll(".", "\\.")} port \\d+ ssh2: ED25519 ${KEY_FINGERPRINT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)
  const matches = journalEvents.filter((event) => event._UID === "0" && event._GID === "0" && event._COMM === "sshd" && event._EXE === "/usr/sbin/sshd" && event._SYSTEMD_UNIT === "ssh.service" && event._TRANSPORT === "syslog" && event.SYSLOG_IDENTIFIER === "sshd" && event._HOSTNAME === "aegis" && event._MACHINE_ID === MACHINE_ID && matcher.test(event.MESSAGE ?? "")).map((event) => ({ ...event, at: new Date(Number(event.__REALTIME_TIMESTAMP) / 1000).toISOString() })).filter((event) => canonicalTimestamp(event.at) && Date.parse(event.at) > challengeAt && Date.parse(event.at) <= current && Date.parse(event.at) - challengeAt <= MAX_AGE_MS)
  if (matches.length !== 1 || current - challengeAt > MAX_AGE_MS) fail("AEGIS_SSH_AUTH_PROOF_EVENT_INVALID", "one fresh exact authentication event required")
  return {
    authenticatedAt: matches[0].at,
    authorityId,
    challengeIssuedAt: challenges[0].challenge_issued_at,
    challengeNonce: challenges[0].challenge_nonce,
    repairId: REPAIR_ID,
    result: "STANDING_AUTHENTICATED",
    reviewedConfigSha256: CONFIG_SHA256,
    schemaVersion: 2,
    sourceAddress: SOURCE_ADDRESS,
    standingEntrypointSha256: ENTRYPOINT_SHA256,
    standingKeySha256: STANDING_KEY_SHA256,
  }
}

function readRootFile(target) { const before = fs.lstatSync(target); if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== 0 || before.gid !== 0 || (before.mode & 0o7777) !== 0o600 || fs.realpathSync(target) !== target) fail("AEGIS_SSH_AUTH_PROOF_FILE_UNTRUSTED", `${target} differs`); return fs.readFileSync(target) }
function assertProofRoot() { for (const [target, uid, gid, mode] of TRUSTED_DIRECTORIES) { const stat = fs.lstatSync(target); if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid || stat.gid !== gid || (stat.mode & 0o7777) !== mode || fs.realpathSync(target) !== target) fail("AEGIS_SSH_AUTH_PROOF_PARENT_UNTRUSTED", `${target} differs`) } }
function writeProof(target, value) { assertProofRoot(); const bytes = Buffer.from(`${canonicalize(value)}\n`); const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600); try { fs.fchmodSync(fd, 0o600); fs.fchownSync(fd, 0, 0); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }; assertProofRoot(); const parent = fs.openSync(path.dirname(target), fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)); try { fs.fsyncSync(parent) } finally { fs.closeSync(parent) }; return sha256(bytes) }

export function main(argv = process.argv.slice(2), clock = () => new Date().toISOString()) {
  try {
    if (argv.length !== 2 || argv[0] !== "--authority-id" || !UUID.test(argv[1])) fail("AEGIS_SSH_AUTH_PROOF_ARGUMENT_INVALID", "expected authority id")
    if (process.platform !== "linux" || process.getuid?.() !== 0 || os.hostname() !== "aegis" || sha256(Buffer.from(fs.readFileSync("/etc/machine-id", "utf8").trim())) !== MACHINE_ID_SHA256) fail("AEGIS_SSH_AUTH_PROOF_HOST_REJECTED", "fixed AEGIS identity required")
    const authorityId = argv[1], journalPath = `${JOURNAL_PREFIX}${authorityId}.journal.jsonl`, proofPath = `${PROOF_ROOT}/${authorityId}.json`, journalBytes = readRootFile(journalPath)
    if (fs.existsSync(proofPath)) fail("AEGIS_SSH_AUTH_PROOF_REPLAY", "proof already exists")
    const challenge = Buffer.from(journalBytes).toString("utf8").split("\n").filter(Boolean).map(JSON.parse).find((record) => record.record_type === "AUTH_PROBE_CHALLENGE_ISSUED")?.challenge_issued_at
    if (!canonicalTimestamp(challenge)) fail("AEGIS_SSH_AUTH_PROOF_JOURNAL_INVALID", "challenge missing")
    const result = spawnSync("/usr/bin/journalctl", ["-u", "ssh", "--since", challenge, "--no-pager", "-o", "json"], { encoding: "utf8", shell: false, timeout: 30_000, maxBuffer: 1024 * 1024, env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C" } })
    if (result.error || result.signal || result.status !== 0) fail("AEGIS_SSH_AUTH_PROOF_JOURNALCTL_FAILED", "fixed journal query failed")
    const events = result.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line))
    const proof = buildAuthProof({ authorityId, journalBytes, journalEvents: events, now: clock() })
    const proofSha256 = writeProof(proofPath, proof)
    process.stdout.write(`${JSON.stringify({ status: "AUTH_PROOF_WRITTEN", authority_id: authorityId, proof_path: proofPath, proof_sha256: proofSha256, private_key_accessed: false, scheduler_activated: false, workload_executed: false })}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: "FAILED_CLOSED", code: error?.code ?? "AEGIS_SSH_AUTH_PROOF_FAILED", detail: String(error?.message ?? error), private_key_accessed: false, scheduler_activated: false, workload_executed: false })}\n`)
    return 2
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) process.exitCode = main()
