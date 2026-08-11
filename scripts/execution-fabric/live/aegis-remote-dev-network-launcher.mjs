import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const INSTALL_PATH = "/usr/local/libexec/williamos-aegis-remote-dev-network-launcher.mjs"
const RECEIPT_PATH = "/run/williamos-fabric/aegis-remote-dev-network-proof.json"
const LAUNCH_PUBLIC_KEY_PATH = "/etc/williamos-fabric/aegis-remote-dev-launch-authority.pem"
const TICKET_CONSUMPTION_DIRECTORY = "/var/lib/williamos-fabric/remote-dev-launch-tickets"
const CGROUP_ROOT = "/sys/fs/cgroup"
const CGROUP_FILE = "/proc/self/cgroup"
const SLICE_UNIT = "williamos-aegis-remote-dev.slice"
const WORKSPACE_PARENT = "/srv/william/workspaces"
const WORKSPACE = `${WORKSPACE_PARENT}/WO-TF-REMOTE-DEV-OFFLOAD-001`
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SHA256 = /^[a-f0-9]{64}$/
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const DECIMAL_ID = /^(?:0|[1-9][0-9]{0,39})$/
const ENFORCED_SLICE = /^\/user\.slice\/user-([1-9][0-9]*)\.slice\/user@\1\.service\/app\.slice\/williamos-aegis-remote-dev\.slice$/
const ENVELOPE_MAX_BYTES = 65_536
const WORKER_STREAM_MAX_BYTES = 20_000
const EXPECTED_ENDPOINTS = deepFreeze([
  { host: "ssh.github.com", port: 443, operations: ["git-fetch", "git-push"] },
  { host: "api.github.com", port: 443, operations: ["github-pr"] },
  { host: "api.nuget.org", port: 443, operations: ["dotnet-restore"] },
  { host: "globalcdn.nuget.org", port: 443, operations: ["dotnet-restore"] },
])
const EXPECTED_ENFORCEMENT = deepFreeze({
  mechanism: "ROOT_ATTESTED_CGROUP_EGRESS_V1",
  defaultDeny: true,
  directNetworkAllowed: false,
  brokerRequired: true,
  atlas: { allowed: false, addresses: ["192.168.1.156/32"], ports: "ALL" },
  endpoints: EXPECTED_ENDPOINTS,
})
const EXPECTED_OPERATIONS = deepFreeze([
  "PROVE_PREFLIGHT", "CREATE_WORKSPACE", "APPLY_RESERVED_PATCH", "RESTORE_DOTNET",
  "TEST_WORKFLOW_CONTRACT", "TEST_DOTNET_INFORMATIONAL", "BUILD_DOTNET_RELEASE",
  "COMMIT_RESERVED_PATHS", "PUSH_AUTHORIZED_BRANCH", "PROVE_POST_MERGE", "CLEAN_EXACT_WORKSPACE",
])

class WorkerNetworkError extends Error {}
function fail(detail) { throw new WorkerNetworkError(detail) }
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`); return value }
function exactKeys(value, keys, label) {
  if (JSON.stringify(Object.keys(object(value, label)).sort()) !== JSON.stringify([...keys].sort())) fail(`${label} fields differ`)
}
function canonicalize(value) {
  if (value === null) return "null"
  if (typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number") { if (!Number.isFinite(value)) fail("non-finite number"); return JSON.stringify(value) }
  if (typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`
  return `{${Object.keys(object(value, "canonical value")).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`
}
function same(left, right) { return canonicalize(left) === canonicalize(right) }
function digest(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex") }
function blocked(error) {
  return { status: "BLOCKED", executionAuthorized: false, reasons: [{ code: "WORKER_NETWORK_BOUNDARY_UNPROVEN", detail: String(error?.message ?? error).slice(0, 512) }] }
}
function parseCanonical(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 2 || bytes.length > ENVELOPE_MAX_BYTES) fail("network receipt size differs")
  let text
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes) } catch { fail("network receipt is not UTF-8") }
  let value
  try { value = JSON.parse(text) } catch { fail("network receipt is not JSON") }
  if (!Buffer.from(`${canonicalize(value)}\n`, "utf8").equals(bytes)) fail("network receipt is not canonical JSON")
  return value
}
function validateFile(value, mode, label) {
  exactKeys(value, ["isFile", "isSymbolicLink", "nlink", "uid", "mode", "parentsRootOwnedAndNotWritable"], label)
  if (value.isFile !== true || value.isSymbolicLink !== false || value.nlink !== 1 || value.uid !== 0
    || value.mode !== mode || value.parentsRootOwnedAndNotWritable !== true) fail(`${label} trust differs`)
}
function validateIdentity(value, label) {
  exactKeys(value, ["device", "inode", "ctimeNs"], label)
  if (![value.device, value.inode, value.ctimeNs].every((entry) => typeof entry === "string" && DECIMAL_ID.test(entry))) fail(`${label} differs`)
}
function validateTicketConsumptionDirectory(receipt, current) {
  exactKeys(receipt, ["directoryPath", "directoryIdentity", "ownerUid", "writerGid", "mode", "appendOnly"], "receipt.ticketConsumption")
  exactKeys(receipt.directoryIdentity, ["device", "inode"], "receipt.ticketConsumption.directoryIdentity")
  if (![receipt.directoryIdentity.device, receipt.directoryIdentity.inode].every((entry) => typeof entry === "string" && DECIMAL_ID.test(entry))) fail("receipt.ticketConsumption.directoryIdentity differs")
  exactKeys(current, ["isDirectory", "isSymbolicLink", "uid", "gid", "mode", "appendOnly", "parentsRootOwnedAndNotWritable", "identity"], "currentTicketConsumptionDirectory")
  validateIdentity(current.identity, "currentTicketConsumptionDirectory.identity")
  if (receipt.directoryPath !== TICKET_CONSUMPTION_DIRECTORY || receipt.ownerUid !== 0 || !Number.isSafeInteger(receipt.writerGid) || receipt.writerGid <= 0
    || receipt.mode !== "3770" || receipt.appendOnly !== true || current.isDirectory !== true || current.isSymbolicLink !== false
    || current.uid !== 0 || current.gid !== receipt.writerGid || current.mode !== 0o3770 || current.appendOnly !== true
    || current.parentsRootOwnedAndNotWritable !== true || current.identity.device !== receipt.directoryIdentity.device
    || current.identity.inode !== receipt.directoryIdentity.inode) fail("ticket consumption boundary differs")
}

export function inspectWorkerNetworkBinding(input) {
  try {
    exactKeys(input, ["receiptBytes", "receiptFile", "launcherBytes", "launcherFile", "now", "expectedProofId", "expectedRunId", "expectedTicketId", "workerControlGroup", "currentEnforcedControlGroupIdentity", "currentTicketConsumptionDirectory"], "input")
    validateFile(input.receiptFile, 0o444, "receiptFile")
    validateFile(input.launcherFile, 0o555, "launcherFile")
    if (!RUN_ID.test(input.expectedProofId) || !RUN_ID.test(input.expectedRunId)) fail("expected proof or run differs")
    const receipt = parseCanonical(input.receiptBytes)
    exactKeys(receipt, ["schemaVersion", "proofId", "providerId", "activationId", "authorityReference", "runId", "observedAt", "expiresAt", "bootId", "controlGroup", "controlGroupIdentity", "enforcementGeneration", "launcherSha256", "workerSha256", "launchAuthority", "ticketConsumption", "nodeId", "account", "machineIdSha256", "controlPlaneCommit", "policySha256", "activationSha256", "providerSha256", "enforcement"], "receipt")
    if (receipt.schemaVersion !== 1 || !RUN_ID.test(receipt.proofId) || receipt.providerId !== "aegis-remote-dev-root-attested-egress-v1"
      || receipt.activationId !== "remote-dev-offload-v1-issue-734-single-use-001"
      || receipt.authorityReference !== "issue-734-terrafusion-remote-dev-single-use-001"
      || receipt.proofId !== input.expectedProofId || receipt.runId !== input.expectedRunId
      || receipt.nodeId !== "aegis" || receipt.account !== "williamos-fabric" || !SHA256.test(receipt.workerSha256)) fail("network receipt proof, run, or identity differs")
    exactKeys(receipt.launchAuthority, ["algorithm", "publicKeyPath", "publicKeySha256"], "receipt.launchAuthority")
    if (receipt.launchAuthority.algorithm !== "Ed25519" || receipt.launchAuthority.publicKeyPath !== LAUNCH_PUBLIC_KEY_PATH
      || !SHA256.test(receipt.launchAuthority.publicKeySha256)) fail("launch authority differs")
    if (!UTC.test(receipt.observedAt) || !UTC.test(receipt.expiresAt) || !UTC.test(input.now)) fail("network receipt time differs")
    const observed = Date.parse(receipt.observedAt); const expires = Date.parse(receipt.expiresAt); const now = Date.parse(input.now)
    if (![observed, expires, now].every(Number.isFinite) || expires - observed !== 30_000 || observed > now || now >= expires) fail("network receipt is stale or future-dated")
    if (!ENFORCED_SLICE.test(receipt.controlGroup)) fail("attested cgroup is not the fixed enforced slice")
    if (!RUN_ID.test(input.expectedTicketId)) fail("expected launch ticket differs")
    const expectedWorker = `${receipt.controlGroup}/williamos-aegis-remote-dev-${input.expectedTicketId}.service`
    if (input.workerControlGroup !== expectedWorker) fail("worker is outside the exact run scope beneath the enforced slice")
    validateIdentity(receipt.controlGroupIdentity, "receipt.controlGroupIdentity")
    validateIdentity(input.currentEnforcedControlGroupIdentity, "currentEnforcedControlGroupIdentity")
    if (!same(receipt.controlGroupIdentity, input.currentEnforcedControlGroupIdentity)) fail("enforced slice object differs from receipt")
    validateTicketConsumptionDirectory(receipt.ticketConsumption, input.currentTicketConsumptionDirectory)
    exactKeys(receipt.enforcementGeneration, ["generationId", "rulesetSha256"], "receipt.enforcementGeneration")
    if (!RUN_ID.test(receipt.enforcementGeneration.generationId) || !SHA256.test(receipt.enforcementGeneration.rulesetSha256)
      || receipt.enforcementGeneration.rulesetSha256 !== digest(Buffer.from(canonicalize(receipt.enforcement), "utf8"))) fail("enforcement generation differs")
    if (!same(receipt.enforcement, EXPECTED_ENFORCEMENT)) fail("network enforcement differs")
    if (!SHA256.test(receipt.launcherSha256) || receipt.launcherSha256 !== digest(input.launcherBytes)) fail("installed launcher bytes differ from root receipt")
    return {
      status: "WORKER_NETWORK_BOUNDARY_VERIFIED",
      executionAuthorized: false,
      proofId: receipt.proofId,
      runId: receipt.runId,
      enforcedControlGroup: receipt.controlGroup,
      controlGroupIdentity: receipt.controlGroupIdentity,
      enforcementGenerationId: receipt.enforcementGeneration.generationId,
    }
  } catch (error) { return blocked(error) }
}

export function inspectSignedLaunchAuthorization(input) {
  try {
    exactKeys(input, ["ticketBytes", "publicKeyBytes", "publicKeyFile", "receipt", "workerBytes", "operation", "packetBytes", "patchBytes", "attempt", "previousEvidenceSha256", "now"], "launch input")
    validateFile(input.publicKeyFile, 0o444, "publicKeyFile")
    const ticket = parseCanonical(input.ticketBytes)
    exactKeys(ticket, ["payload", "signature"], "ticket")
    exactKeys(ticket.payload, ["schemaVersion", "ticketId", "activationId", "authorityReference", "runId", "proofId", "claimId", "leaseId", "operation", "attempt", "previousEvidenceSha256", "packetSha256", "patchSha256", "workerSha256", "issuedAt", "expiresAt"], "ticket.payload")
    const payload = ticket.payload
    if (payload.schemaVersion !== 1 || !RUN_ID.test(payload.ticketId) || payload.activationId !== input.receipt.activationId
      || payload.authorityReference !== input.receipt.authorityReference || payload.runId !== input.receipt.runId
      || payload.proofId !== input.receipt.proofId || !/^[A-Za-z0-9._:-]{1,128}$/.test(payload.claimId)
      || !/^[A-Za-z0-9._:-]{1,128}$/.test(payload.leaseId) || payload.operation !== input.operation
      || payload.attempt !== Number(input.attempt) || payload.previousEvidenceSha256 !== (input.previousEvidenceSha256 === "null" ? null : input.previousEvidenceSha256)
      || payload.packetSha256 !== digest(input.packetBytes) || payload.patchSha256 !== digest(input.patchBytes)
      || payload.workerSha256 !== digest(input.workerBytes) || payload.workerSha256 !== input.receipt.workerSha256) fail("signed launch ticket binding differs")
    const issued = Date.parse(payload.issuedAt); const expires = Date.parse(payload.expiresAt); const now = Date.parse(input.now)
    const receiptObserved = Date.parse(input.receipt.observedAt); const receiptExpires = Date.parse(input.receipt.expiresAt)
    if (![issued, expires, now, receiptObserved, receiptExpires].every(Number.isFinite) || issued < receiptObserved || issued > now || now >= expires
      || expires > receiptExpires || expires - issued > 30_000) fail("signed launch ticket time differs")
    if (digest(input.publicKeyBytes) !== input.receipt.launchAuthority.publicKeySha256 || !/^[A-Za-z0-9+/]+={0,2}$/.test(ticket.signature)) fail("launch public key or signature encoding differs")
    const signature = Buffer.from(ticket.signature, "base64")
    if (signature.length !== 64 || signature.toString("base64") !== ticket.signature) fail("launch signature is non-canonical")
    let key
    try { key = crypto.createPublicKey(input.publicKeyBytes) } catch { fail("launch public key is invalid") }
    if (key.asymmetricKeyType !== "ed25519" || !crypto.verify(null, Buffer.from(canonicalize(payload), "utf8"), key, signature)) fail("launch ticket signature differs")
    return { status: "SIGNED_LAUNCH_AUTHORIZED", executionAuthorized: false, ticketId: payload.ticketId, proofId: payload.proofId, runId: payload.runId, claimId: payload.claimId, leaseId: payload.leaseId }
  } catch (error) { return blocked(error) }
}

export function fixedTicketUnitContract(ticketId) {
  if (!RUN_ID.test(ticketId)) fail("signed launch ticket id differs")
  return deepFreeze({
    unitName: `williamos-aegis-remote-dev-${ticketId}`,
    properties: ["RefuseManualStop=yes", "RemainAfterExit=yes"],
    wait: false,
    collect: false,
  })
}

function decodeEnvelopeBase64(value, label) {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail(`${label} encoding differs`)
  const bytes = Buffer.from(value, "base64")
  if (bytes.length > WORKER_STREAM_MAX_BYTES || bytes.toString("base64") !== value) fail(`${label} encoding differs`)
  return bytes
}

export function inspectWorkerExecutionEnvelope(envelopeBytes, expectedTicketId) {
  if (!RUN_ID.test(expectedTicketId)) fail("expected execution ticket differs")
  const envelope = parseCanonical(envelopeBytes)
  exactKeys(envelope, ["schemaVersion", "ticketId", "workerExitCode", "workerStdoutBase64", "workerStderrBase64"], "worker execution envelope")
  if (envelope.schemaVersion !== 1 || envelope.ticketId !== expectedTicketId
    || !Number.isSafeInteger(envelope.workerExitCode) || envelope.workerExitCode < 0 || envelope.workerExitCode > 255) fail("worker execution envelope binding differs")
  return {
    workerExitCode: envelope.workerExitCode,
    workerStdout: decodeEnvelopeBase64(envelope.workerStdoutBase64, "worker stdout"),
    workerStderr: decodeEnvelopeBase64(envelope.workerStderrBase64, "worker stderr"),
  }
}

export function createTicketTombstone(directory, ticketId) {
  if (!RUN_ID.test(ticketId)) fail("ticket tombstone input differs")
  const tombstonePath = path.join(directory, `${ticketId}.consumed`)
  let file
  try {
    file = fs.openSync(tombstonePath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o000)
    fs.fsyncSync(file)
  } finally {
    if (file !== undefined) fs.closeSync(file)
  }
  let directoryHandle
  try {
    directoryHandle = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY)
    if (process.platform === "linux") fs.fsyncSync(directoryHandle)
  } finally {
    if (directoryHandle !== undefined) fs.closeSync(directoryHandle)
  }
}

function encodeWorkerExecutionEnvelope(ticketId, exitCode, stdout, stderr) {
  const envelope = Buffer.from(`${canonicalize({
    schemaVersion: 1,
    ticketId,
    workerExitCode: exitCode,
    workerStdoutBase64: stdout.toString("base64"),
    workerStderrBase64: stderr.toString("base64"),
  })}\n`, "utf8")
  if (envelope.length > ENVELOPE_MAX_BYTES) fail("worker execution envelope exceeds the transport budget")
  return envelope
}

function workerOutputTruncatedEnvelope(ticketId, exitCode, stdoutBytes, stderrBytes, stderr = Buffer.alloc(0)) {
  const blockedOutput = Buffer.from(`${canonicalize({
    status: "BLOCKED",
    executionAuthorized: false,
    reasonCode: "WORKER_OUTPUT_TRUNCATED",
    workerExitCode: Number.isSafeInteger(exitCode) ? exitCode : null,
    workerStdoutBytes: stdoutBytes,
    workerStderrBytes: stderrBytes,
  })}\n`, "utf8")
  const diagnostic = Buffer.concat([
    Buffer.from(`WORKER_OUTPUT_TRUNCATED\tstdoutBytes=${stdoutBytes}\tstderrBytes=${stderrBytes}\tworkerExitCode=${Number.isSafeInteger(exitCode) ? exitCode : "unavailable"}\n`, "utf8"),
    stderr.subarray(0, 4096),
  ])
  return encodeWorkerExecutionEnvelope(ticketId, 2, blockedOutput, diagnostic)
}

export function createWorkerExecutionEnvelope(ticketId, exitCode, stdout, stderr) {
  if (!RUN_ID.test(ticketId) || !Number.isSafeInteger(exitCode) || exitCode < 0 || exitCode > 255
    || !Buffer.isBuffer(stdout) || !Buffer.isBuffer(stderr)) fail("worker execution result differs")
  if (stdout.length > WORKER_STREAM_MAX_BYTES || stderr.length > WORKER_STREAM_MAX_BYTES) {
    return workerOutputTruncatedEnvelope(ticketId, exitCode, stdout.length, stderr.length, stderr)
  }
  return encodeWorkerExecutionEnvelope(ticketId, exitCode, stdout, stderr)
}

export function createWorkerOverflowEnvelope(ticketId, exitCode, stdout, stderr) {
  if (!RUN_ID.test(ticketId) || (exitCode !== null && (!Number.isSafeInteger(exitCode) || exitCode < 0 || exitCode > 255))
    || !Buffer.isBuffer(stdout) || !Buffer.isBuffer(stderr)) fail("worker overflow result differs")
  return workerOutputTruncatedEnvelope(ticketId, exitCode, stdout.length, stderr.length, stderr)
}

function readRootControlledFile(file, mode) {
  let cursor = path.parse(file).root
  for (const segment of file.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment)
    const stats = fs.lstatSync(cursor)
    if (stats.isSymbolicLink()) fail("trusted path contains a symbolic link")
    if (cursor !== file && (!stats.isDirectory() || stats.uid !== 0 || (stats.mode & 0o022) !== 0)) fail("trusted parent is mutable")
  }
  const stats = fs.lstatSync(file)
  if (!stats.isFile() || stats.nlink !== 1 || stats.uid !== 0 || (stats.mode & 0o777) !== mode || stats.size < 1 || stats.size > 1_048_576) fail("trusted file metadata differs")
  return {
    bytes: fs.readFileSync(file),
    file: { isFile: true, isSymbolicLink: false, nlink: stats.nlink, uid: stats.uid, mode: stats.mode & 0o777, parentsRootOwnedAndNotWritable: true },
  }
}
function currentControlGroup() {
  const lines = fs.readFileSync(CGROUP_FILE, "utf8").trim().split("\n")
  if (lines.length !== 1 || !lines[0].startsWith("0::")) fail("unified process cgroup is unavailable")
  return lines[0].slice(3)
}
function cgroupIdentity(controlGroup) {
  if (!ENFORCED_SLICE.test(controlGroup)) fail("enforced slice path differs")
  const root = fs.realpathSync(CGROUP_ROOT)
  const lexical = path.join(root, ...controlGroup.slice(1).split("/"))
  const relative = path.relative(root, lexical)
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail("enforced slice escapes cgroup v2")
  let cursor = root
  for (const segment of relative.split(path.sep)) { cursor = path.join(cursor, segment); if (fs.lstatSync(cursor).isSymbolicLink()) fail("enforced slice contains a symbolic link") }
  if (fs.realpathSync(lexical) !== lexical) fail("enforced slice path is not exact")
  const stats = fs.statSync(lexical, { bigint: true })
  if (!stats.isDirectory()) fail("enforced slice is unavailable")
  return { device: stats.dev.toString(), inode: stats.ino.toString(), ctimeNs: stats.ctimeNs.toString() }
}
function currentTicketConsumptionDirectory() {
  let cursor = path.parse(TICKET_CONSUMPTION_DIRECTORY).root
  for (const segment of TICKET_CONSUMPTION_DIRECTORY.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment)
    const stats = fs.lstatSync(cursor)
    if (stats.isSymbolicLink()) fail("ticket consumption path contains a symbolic link")
    if (cursor !== TICKET_CONSUMPTION_DIRECTORY && (!stats.isDirectory() || stats.uid !== 0 || (stats.mode & 0o022) !== 0)) fail("ticket consumption parent is not root-controlled")
  }
  const stats = fs.statSync(TICKET_CONSUMPTION_DIRECTORY, { bigint: true })
  const attributes = spawnSync("/usr/bin/lsattr", ["-d", "--", TICKET_CONSUMPTION_DIRECTORY], { encoding: "utf8", env: { HOME: "/nonexistent", PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, timeout: 5000 })
  if (attributes.status !== 0 || !/^[A-Za-z-]*a[A-Za-z-]*\s+/.test(attributes.stdout ?? "")) fail("ticket consumption append-only state is unproven")
  return {
    isDirectory: stats.isDirectory(), isSymbolicLink: false, uid: Number(stats.uid), gid: Number(stats.gid), mode: Number(stats.mode & 0o7777n), appendOnly: true,
    parentsRootOwnedAndNotWritable: true,
    identity: { device: stats.dev.toString(), inode: stats.ino.toString(), ctimeNs: stats.ctimeNs.toString() },
  }
}
function packetRunId(packetB64) {
  if (typeof packetB64 !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(packetB64)) fail("packet encoding differs")
  const bytes = Buffer.from(packetB64, "base64")
  if (bytes.toString("base64") !== packetB64 || bytes.length > 1_048_576) fail("packet encoding is non-canonical")
  let packet
  try { packet = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) } catch { fail("packet is invalid") }
  if (!RUN_ID.test(packet?.runId)) fail("packet run differs")
  return packet.runId
}
function exactRuntimeInput(args) {
  if (args.length !== 6) fail("launcher argument count differs")
  const [ticketB64, operation, packetB64, patchB64, attempt, previous] = args
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(ticketB64)) fail("launcher ticket encoding differs")
  if (!EXPECTED_OPERATIONS.includes(operation) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(patchB64)
    || !/^[1-3]$/.test(attempt) || (previous !== "null" && !SHA256.test(previous))) fail("launcher argument binding differs")
  return { ticketB64, operation, packetB64, patchB64, attempt, previous, runId: packetRunId(packetB64) }
}
function runtimeFiles() {
  const receipt = readRootControlledFile(RECEIPT_PATH, 0o444)
  const launcher = readRootControlledFile(INSTALL_PATH, 0o555)
  const publicKey = readRootControlledFile(LAUNCH_PUBLIC_KEY_PATH, 0o444)
  return { receipt, launcher, publicKey, parsedReceipt: parseCanonical(receipt.bytes) }
}
function decodeCanonicalBase64(value, label, maximumBytes = 1_048_576) {
  const bytes = Buffer.from(value, "base64")
  if (bytes.length < 1 || bytes.length > maximumBytes || bytes.toString("base64") !== value) fail(`${label} encoding differs`)
  return bytes
}
function readWorkerBytes() {
  const bytes = fs.readFileSync(0)
  if (bytes.length < 1 || bytes.length > 1_048_576) fail("worker payload size differs")
  return bytes
}
function authorizeRuntime(bound, files, workerBytes) {
  const ticketBytes = decodeCanonicalBase64(bound.ticketB64, "ticket", 65_536)
  const packetBytes = decodeCanonicalBase64(bound.packetB64, "packet")
  const patchBytes = bound.patchB64 === "" ? Buffer.alloc(0) : decodeCanonicalBase64(bound.patchB64, "patch")
  const result = inspectSignedLaunchAuthorization({
    ticketBytes, publicKeyBytes: files.publicKey.bytes, publicKeyFile: files.publicKey.file,
    receipt: files.parsedReceipt, workerBytes, operation: bound.operation, packetBytes, patchBytes,
    attempt: bound.attempt, previousEvidenceSha256: bound.previous, now: new Date().toISOString(),
  })
  if (result.status !== "SIGNED_LAUNCH_AUTHORIZED") fail(result.reasons?.[0]?.detail ?? "signed launch authority differs")
  return result
}
function executionUid() {
  const uid = process.getuid?.()
  if (!Number.isSafeInteger(uid) || uid <= 0) fail("launcher must run as a dedicated non-root identity")
  const user = spawnSync("/usr/bin/id", ["-un"], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, timeout: 5000 })
  if (user.status !== 0 || user.stdout.trim() !== "williamos-fabric") fail("launcher identity differs")
  return uid
}
function consumeRuntimeTicket(receipt, authorization) {
  const current = currentTicketConsumptionDirectory()
  validateTicketConsumptionDirectory(receipt.ticketConsumption, current)
  const gid = process.getgid?.()
  if (!Number.isSafeInteger(gid) || gid !== receipt.ticketConsumption.writerGid) fail("ticket consumption writer identity differs")
  createTicketTombstone(TICKET_CONSUMPTION_DIRECTORY, authorization.ticketId)
}
function managerEnvironment(uid) {
  return Object.freeze({
    HOME: "/nonexistent", PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C",
    XDG_RUNTIME_DIR: `/run/user/${uid}`,
    DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${uid}/bus`,
  })
}
function workerEnvironment(bound) {
  const environment = { HOME: "/nonexistent", PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", WILLIAMOS_NETWORK_OPERATION: bound.operation }
  if (["PROVE_PREFLIGHT", "CREATE_WORKSPACE", "RESTORE_DOTNET", "PUSH_AUTHORIZED_BRANCH", "PROVE_POST_MERGE"].includes(bound.operation)) {
    Object.assign(environment, { WILLIAMOS_NETWORK_TICKET_B64: bound.ticketB64, WILLIAMOS_NETWORK_PACKET_B64: bound.packetB64 })
  }
  if (bound.operation === "RESTORE_DOTNET") {
    const proxy = `http://WilliamOS:${encodeURIComponent(bound.ticketB64)}@127.0.0.1:17734`
    Object.assign(environment, { HTTPS_PROXY: proxy, https_proxy: proxy, NO_PROXY: "", no_proxy: "" })
  }
  return Object.freeze(environment)
}
function fixedServiceProperties(operation, uid) {
  const properties = [
    "AllowedCPUs=0-11", "CPUQuota=1200%", "MemoryMax=12884901888", "TasksMax=64",
    "RuntimeMaxSec=5400", "ProtectSystem=strict", "ProtectHome=read-only", "NoNewPrivileges=yes",
    "RestrictSUIDSGID=yes", "LockPersonality=yes",
    `InaccessiblePaths=-/run/user/${uid}/bus -/run/user/${uid}/systemd/private`,
  ]
  if (operation === "PROVE_PREFLIGHT") {
    properties.push("TemporaryFileSystem=/tmp:size=4294967296,mode=0700", `ReadOnlyPaths=/var/tmp /run/user/${uid}`, "WorkingDirectory=/tmp")
  } else if (operation === "CREATE_WORKSPACE" || operation === "CLEAN_EXACT_WORKSPACE") {
    properties.push(`ReadWritePaths=${WORKSPACE_PARENT}`, `ReadOnlyPaths=/tmp /var/tmp /run/user/${uid}`, `WorkingDirectory=${WORKSPACE_PARENT}`)
  } else {
    properties.push(`ReadWritePaths=${WORKSPACE}`, `ReadOnlyPaths=/tmp /var/tmp /run/user/${uid}`, `WorkingDirectory=${WORKSPACE}`)
  }
  return properties.flatMap((property) => ["-p", property])
}
function child(args) {
  const bound = exactRuntimeInput(args)
  const files = runtimeFiles()
  const workerBytes = readWorkerBytes()
  const authorization = authorizeRuntime(bound, files, workerBytes)
  try {
    const workerControlGroup = currentControlGroup()
    const receiptControlGroup = files.parsedReceipt.controlGroup
    const result = inspectWorkerNetworkBinding({
      receiptBytes: files.receipt.bytes,
      receiptFile: files.receipt.file,
      launcherBytes: files.launcher.bytes,
      launcherFile: files.launcher.file,
      now: new Date().toISOString(),
      expectedProofId: authorization.proofId,
      expectedRunId: bound.runId,
      expectedTicketId: authorization.ticketId,
      workerControlGroup,
      currentEnforcedControlGroupIdentity: cgroupIdentity(receiptControlGroup),
      currentTicketConsumptionDirectory: currentTicketConsumptionDirectory(),
    })
    if (result.status !== "WORKER_NETWORK_BOUNDARY_VERIFIED") fail(result.reasons?.[0]?.detail ?? "worker network boundary differs")
    executionUid()
    const worker = spawnSync("/usr/bin/bash", ["-s", "--", bound.operation, bound.packetB64, bound.patchB64, bound.attempt, bound.previous, authorization.ticketId], {
      input: workerBytes, stdio: ["pipe", "pipe", "pipe"], env: workerEnvironment(bound), maxBuffer: WORKER_STREAM_MAX_BYTES + 1,
    })
    if (worker.error?.code === "ENOBUFS") {
      return createWorkerOverflowEnvelope(authorization.ticketId, worker.status, worker.stdout ?? Buffer.alloc(0), worker.stderr ?? Buffer.alloc(0))
    }
    if (worker.error || worker.status === null) fail("worker process did not settle cleanly")
    return createWorkerExecutionEnvelope(authorization.ticketId, worker.status, worker.stdout, worker.stderr)
  } catch (error) {
    return createWorkerExecutionEnvelope(authorization.ticketId, 2, Buffer.from(`${JSON.stringify(blocked(error))}\n`, "utf8"), Buffer.alloc(0))
  }
}
function parent(args) {
  const bound = exactRuntimeInput(args)
  const files = runtimeFiles()
  const workerBytes = readWorkerBytes()
  const authorization = authorizeRuntime(bound, files, workerBytes)
  if (files.parsedReceipt.proofId !== authorization.proofId || files.parsedReceipt.runId !== bound.runId
    || files.parsedReceipt.launcherSha256 !== digest(files.launcher.bytes)) fail("root receipt does not bind this launcher proof and run")
  const uid = executionUid()
  consumeRuntimeTicket(files.parsedReceipt, authorization)
  const env = managerEnvironment(uid)
  const service = fixedTicketUnitContract(authorization.ticketId)
  const launched = spawnSync("/usr/bin/systemd-run", [
    "--user", "--quiet", "--pipe", "--service-type=exec", "--expand-environment=no",
    `--slice=${SLICE_UNIT}`, `--unit=${service.unitName}`,
    ...service.properties.flatMap((property) => ["-p", property]),
    ...fixedServiceProperties(bound.operation, uid),
    "/usr/bin/env", "-i", "HOME=/nonexistent", "PATH=/usr/bin:/bin", "LANG=C", "LC_ALL=C",
    `WILLIAMOS_NETWORK_TICKET_B64=${bound.ticketB64}`, `WILLIAMOS_NETWORK_PACKET_B64=${bound.packetB64}`, `WILLIAMOS_NETWORK_OPERATION=${bound.operation}`,
    "/usr/bin/node", INSTALL_PATH, "--child", ...args,
  ], { input: workerBytes, stdio: ["pipe", "pipe", "pipe"], env, maxBuffer: ENVELOPE_MAX_BYTES })
  if (launched.error || launched.status !== 0) fail("fixed enforced-slice launch failed")
  const outcome = inspectWorkerExecutionEnvelope(launched.stdout, authorization.ticketId)
  process.stdout.write(outcome.workerStdout)
  process.stderr.write(outcome.workerStderr)
  return outcome.workerExitCode
}
function main() {
  try {
    if (process.platform !== "linux" || process.execPath !== "/usr/bin/node") fail("launcher requires fixed resident Linux Node")
    const args = process.argv.slice(2)
    if (args[0] === "--child") {
      process.stdout.write(child(args.slice(1)))
      process.exitCode = 0
      return
    }
    process.exitCode = parent(args)
    return
  } catch (error) {
    process.stdout.write(`${JSON.stringify(blocked(error))}\n`)
    process.exitCode = 2
    return
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main()
