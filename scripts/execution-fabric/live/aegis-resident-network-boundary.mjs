import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { canonicalizeJcs } from "../canonical-json.mjs"
import {
  createTrustedProofProviders,
  trustedResidentIdentity,
} from "../bounded-dispatch/run-resident-aegis-hash-verify.mjs"

const SHA256 = /^[a-f0-9]{64}$/
const SHA40 = /^[a-f0-9]{40}$/
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const ENFORCED_SLICE = /^\/user\.slice\/user-([1-9][0-9]*)\.slice\/user@\1\.service\/app\.slice\/williamos-aegis-remote-dev\.slice$/

const ROOT = new URL("../../../", import.meta.url)
const REPOSITORY_ROOT = fileURLToPath(ROOT)
const POLICY_PATH = "config/execution-fabric/aegis-resident-network-boundary.json"
const ACTIVATION_PATH = "config/execution-fabric/remote-dev-offload-v1-activation.json"
const IDENTITY_PATH = "config/execution-fabric/aegis-resident-identity.json"
const PROVIDER_PATH = "scripts/execution-fabric/live/aegis-resident-network-boundary.mjs"
const LAUNCHER_PATH = "scripts/execution-fabric/live/aegis-remote-dev-network-launcher.mjs"
const LAUNCHER_INSTALL_PATH = "/usr/local/libexec/williamos-aegis-remote-dev-network-launcher.mjs"
const LAUNCH_PUBLIC_KEY_PATH = "/etc/williamos-fabric/aegis-remote-dev-launch-authority.pem"
const TICKET_CONSUMPTION_DIRECTORY = "/var/lib/williamos-fabric/remote-dev-launch-tickets"
const RECEIPT_PATH = "/run/williamos-fabric/aegis-remote-dev-network-proof.json"
const BOOT_ID_PATH = "/proc/sys/kernel/random/boot_id"
const CONTROL_GROUP_ROOT_PATH = "/sys/fs/cgroup"
const DECIMAL_ID = /^(?:0|[1-9][0-9]{0,39})$/
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
const EXPECTED_WORKER_LAUNCH = deepFreeze({
  launcherPath: LAUNCHER_PATH,
  installedPath: LAUNCHER_INSTALL_PATH,
  nodePath: "/usr/bin/node",
  systemdRunPath: "/usr/bin/systemd-run",
  sliceUnit: "williamos-aegis-remote-dev.slice",
  workerMustBeExactRunScopeDescendant: true,
  receiptLauncherDigestRequired: true,
  launchAuthorityPublicKeyPath: LAUNCH_PUBLIC_KEY_PATH,
  signedSingleOperationTicketRequired: true,
  canonicalWorkerDigestRequired: true,
  ticketConsumptionDirectory: TICKET_CONSUMPTION_DIRECTORY,
  atomicTicketTombstoneRequired: true,
  appendOnlyDirectoryRequired: true,
})
const CRITICAL_PATHS = [
  POLICY_PATH,
  PROVIDER_PATH,
  LAUNCHER_PATH,
  ACTIVATION_PATH,
  IDENTITY_PATH,
  "scripts/execution-fabric/canonical-json.mjs",
  "scripts/execution-fabric/bounded-dispatch/run-resident-aegis-hash-verify.mjs",
]
const TRUSTED_GIT_ENV = Object.freeze({
  HOME: "/nonexistent",
  PATH: "/usr/bin:/bin",
  LANG: "C",
  LC_ALL: "C",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  GIT_NO_REPLACE_OBJECTS: "1",
})

class NetworkBoundaryError extends Error {
  constructor(detail) { super(detail) }
}

function fail(detail) { throw new NetworkBoundaryError(detail) }
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`); return value }
function exactKeys(value, keys, label) {
  const actual = Object.keys(object(value, label)).sort()
  if (JSON.stringify(actual) !== JSON.stringify([...keys].sort())) fail(`${label} fields differ`)
}
function same(left, right) { return canonicalizeJcs(left) === canonicalizeJcs(right) }
function digest(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex") }
function normalizedDigest(bytes) { return digest(Buffer.from(Buffer.from(bytes).toString("utf8").replace(/\r\n/g, "\n"), "utf8")) }
function blocked(error) {
  return { status: "BLOCKED", executionAuthorized: false, reasons: [{ code: "NETWORK_BOUNDARY_UNPROVEN", detail: String(error?.message ?? error).slice(0, 512) }] }
}
function timestamp(value, label) {
  if (typeof value !== "string" || !UTC.test(value) || !Number.isFinite(Date.parse(value))) fail(`${label} is not an exact UTC timestamp`)
  return Date.parse(value)
}

function validatePolicy(policy) {
  exactKeys(policy, ["schemaVersion", "policyId", "provider", "nodeId", "executionIdentity", "trustedMain", "receipt", "workerLaunch", "enforcement", "bindings"], "policy")
  if (policy.schemaVersion !== 1 || policy.policyId !== "aegis-remote-dev-root-attested-egress-v1"
    || policy.provider !== proveResidentAegisNetworkBoundary.name || policy.nodeId !== "aegis") fail("network policy identity differs")
  exactKeys(policy.executionIdentity, ["account", "machineIdSha256"], "policy.executionIdentity")
  if (policy.executionIdentity.account !== "williamos-fabric" || policy.executionIdentity.machineIdSha256 !== "1b490fe20bf3d61dc1f14e3a6e7fe38fc7de69c14face211fdd5afd0544c9c8b") fail("network policy execution identity differs")
  exactKeys(policy.trustedMain, ["repository", "ref", "minimumCommit"], "policy.trustedMain")
  if (!same(policy.trustedMain, { repository: "bsvalues/terragroq", ref: "refs/heads/main", minimumCommit: "f04c816dbcba96990f7754b4767ff16ae7b9b5c9" })) fail("network policy trusted-main binding differs")
  exactKeys(policy.receipt, ["path", "ownerUid", "mode", "maximumAgeSeconds", "bootIdPath", "controlGroupRootPath", "enforcedSliceUnit"], "policy.receipt")
  if (!same(policy.receipt, { path: RECEIPT_PATH, ownerUid: 0, mode: "0444", maximumAgeSeconds: 30, bootIdPath: BOOT_ID_PATH, controlGroupRootPath: CONTROL_GROUP_ROOT_PATH, enforcedSliceUnit: "williamos-aegis-remote-dev.slice" })) fail("network receipt contract differs")
  if (!same(policy.workerLaunch, EXPECTED_WORKER_LAUNCH)) fail("network worker launch contract differs")
  if (!same(policy.enforcement, EXPECTED_ENFORCEMENT)) fail("network enforcement contract differs")
  exactKeys(policy.bindings, ["activationPath", "providerPath", "launcherPath", "identityPath"], "policy.bindings")
  if (!same(policy.bindings, { activationPath: ACTIVATION_PATH, providerPath: PROVIDER_PATH, launcherPath: LAUNCHER_PATH, identityPath: IDENTITY_PATH })) fail("network policy paths differ")
}

function validateDirectoryIdentity(value, label, current = false) {
  exactKeys(value, current ? ["device", "inode", "ctimeNs"] : ["device", "inode"], label)
  const entries = current ? [value.device, value.inode, value.ctimeNs] : [value.device, value.inode]
  if (!entries.every((entry) => typeof entry === "string" && DECIMAL_ID.test(entry))) fail(`${label} differs`)
}

function validateTicketConsumptionDirectory(receipt, current) {
  exactKeys(receipt, ["directoryPath", "directoryIdentity", "ownerUid", "writerGid", "mode", "appendOnly"], "receipt.ticketConsumption")
  if (receipt.directoryPath !== TICKET_CONSUMPTION_DIRECTORY || receipt.ownerUid !== 0
    || !Number.isSafeInteger(receipt.writerGid) || receipt.writerGid <= 0 || receipt.mode !== "3770" || receipt.appendOnly !== true) fail("ticket consumption receipt differs")
  validateDirectoryIdentity(receipt.directoryIdentity, "receipt.ticketConsumption.directoryIdentity")
  exactKeys(current, ["isDirectory", "isSymbolicLink", "uid", "gid", "mode", "appendOnly", "parentsRootOwnedAndNotWritable", "identity"], "currentTicketConsumptionDirectory")
  validateDirectoryIdentity(current.identity, "currentTicketConsumptionDirectory.identity", true)
  if (current.isDirectory !== true || current.isSymbolicLink !== false || current.uid !== 0 || current.gid !== receipt.writerGid
    || current.mode !== 0o3770 || current.appendOnly !== true || current.parentsRootOwnedAndNotWritable !== true
    || current.identity.device !== receipt.directoryIdentity.device || current.identity.inode !== receipt.directoryIdentity.inode) fail("current ticket consumption directory differs")
}

function parseCanonicalReceipt(receiptBytes) {
  if (!Buffer.isBuffer(receiptBytes) || receiptBytes.length === 0 || receiptBytes.length > 65_536) fail("network receipt size is invalid")
  if (receiptBytes.length >= 3 && receiptBytes[0] === 0xef && receiptBytes[1] === 0xbb && receiptBytes[2] === 0xbf) fail("network receipt contains a BOM")
  let text
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(receiptBytes) } catch { fail("network receipt is not UTF-8") }
  let receipt
  try { receipt = JSON.parse(text) } catch { fail("network receipt is not JSON") }
  const canonical = Buffer.from(`${canonicalizeJcs(receipt)}\n`, "utf8")
  if (!canonical.equals(receiptBytes)) fail("network receipt is not canonical JSON")
  return receipt
}

function validateReceiptFile(file) {
  exactKeys(file, ["isFile", "isSymbolicLink", "nlink", "uid", "mode", "parentsRootOwnedAndNotWritable"], "receiptFile")
  if (file.isFile !== true || file.isSymbolicLink !== false || file.nlink !== 1 || file.uid !== 0
    || file.mode !== 0o444 || file.parentsRootOwnedAndNotWritable !== true) fail("network receipt filesystem trust differs")
}

export function inspectResidentNetworkBoundaryEvidence(input) {
  try {
    exactKeys(input, ["policy", "receiptBytes", "receiptFile", "now", "bootId", "enforcedControlGroup", "currentControlGroupIdentity", "currentTicketConsumptionDirectory", "identity", "trustedMain", "policySha256", "activationSha256", "providerSha256", "launcherSha256", "activation"], "input")
    validatePolicy(input.policy)
    validateReceiptFile(input.receiptFile)
    if (![input.policySha256, input.activationSha256, input.providerSha256, input.launcherSha256].every((value) => typeof value === "string" && SHA256.test(value))) fail("trusted byte digest is invalid")
    exactKeys(input.identity, ["node_id", "hostname", "machine_id_sha256", "agent_identity", "provider_identity"], "identity")
    if (input.identity.node_id !== "aegis" || input.identity.hostname !== "aegis"
      || input.identity.machine_id_sha256 !== input.policy.executionIdentity.machineIdSha256
      || input.identity.agent_identity !== "resident-aegis" || input.identity.provider_identity !== "resident-aegis") fail("resident identity differs")
    exactKeys(input.trustedMain, ["verified", "clean", "trusted_ref", "head_commit"], "trustedMain")
    if (input.trustedMain.verified !== true || input.trustedMain.clean !== true || input.trustedMain.trusted_ref !== input.policy.trustedMain.ref || !SHA40.test(input.trustedMain.head_commit)) fail("trusted-main proof differs")

    const receipt = parseCanonicalReceipt(input.receiptBytes)
    exactKeys(receipt, ["schemaVersion", "proofId", "providerId", "activationId", "authorityReference", "runId", "observedAt", "expiresAt", "bootId", "controlGroup", "controlGroupIdentity", "enforcementGeneration", "launcherSha256", "workerSha256", "launchAuthority", "ticketConsumption", "nodeId", "account", "machineIdSha256", "controlPlaneCommit", "policySha256", "activationSha256", "providerSha256", "enforcement"], "receipt")
    if (receipt.schemaVersion !== 1 || !GUID.test(receipt.proofId) || receipt.providerId !== input.policy.policyId
      || receipt.nodeId !== "aegis" || receipt.account !== "williamos-fabric"
      || receipt.machineIdSha256 !== input.identity.machine_id_sha256 || receipt.controlPlaneCommit !== input.trustedMain.head_commit
      || receipt.policySha256 !== input.policySha256 || receipt.activationSha256 !== input.activationSha256 || receipt.providerSha256 !== input.providerSha256
      || receipt.launcherSha256 !== input.launcherSha256 || receipt.workerSha256 !== input.activation.workerSha256) fail("network receipt binding differs")
    exactKeys(receipt.launchAuthority, ["algorithm", "publicKeyPath", "publicKeySha256"], "receipt.launchAuthority")
    if (receipt.launchAuthority.algorithm !== "Ed25519" || receipt.launchAuthority.publicKeyPath !== LAUNCH_PUBLIC_KEY_PATH
      || !SHA256.test(receipt.launchAuthority.publicKeySha256)) fail("network launch authority differs")
    const observedAt = timestamp(receipt.observedAt, "receipt.observedAt")
    const expiresAt = timestamp(receipt.expiresAt, "receipt.expiresAt")
    const now = timestamp(input.now, "now")
    if (expiresAt - observedAt !== input.policy.receipt.maximumAgeSeconds * 1000 || observedAt > now || now >= expiresAt) fail("network receipt is stale or future-dated")
    if (!GUID.test(receipt.bootId) || receipt.bootId !== input.bootId || receipt.controlGroup !== input.enforcedControlGroup || !ENFORCED_SLICE.test(receipt.controlGroup)) fail("network receipt boot or enforced-slice binding differs")
    for (const [label, value] of [["receipt.controlGroupIdentity", receipt.controlGroupIdentity], ["currentControlGroupIdentity", input.currentControlGroupIdentity]]) {
      exactKeys(value, ["device", "inode", "ctimeNs"], label)
      if (![value.device, value.inode, value.ctimeNs].every((entry) => typeof entry === "string" && DECIMAL_ID.test(entry))) fail(`${label} differs`)
    }
    if (!same(receipt.controlGroupIdentity, input.currentControlGroupIdentity)) fail("current cgroup object differs from attested generation")
    validateTicketConsumptionDirectory(receipt.ticketConsumption, input.currentTicketConsumptionDirectory)
    exactKeys(receipt.enforcementGeneration, ["generationId", "rulesetSha256"], "receipt.enforcementGeneration")
    if (!GUID.test(receipt.enforcementGeneration.generationId)
      || receipt.enforcementGeneration.rulesetSha256 !== digest(Buffer.from(canonicalizeJcs(receipt.enforcement), "utf8"))) fail("network enforcement generation differs")
    if (!same(receipt.enforcement, EXPECTED_ENFORCEMENT)) fail("network receipt enforcement differs")

    exactKeys(input.activation, ["activationId", "authorityReference", "runId", "workerSha256", "network"], "activation")
    if (receipt.activationId !== input.activation.activationId || receipt.authorityReference !== input.activation.authorityReference || receipt.runId !== input.activation.runId
      || !same(input.activation.network, { defaultDeny: true, atlasAllowed: false, enforcementProofRequired: true, endpoints: EXPECTED_ENDPOINTS })) fail("activation network binding differs")
    return {
      status: "RESIDENT_NETWORK_BOUNDARY_VERIFIED",
      executionAuthorized: false,
      proofId: receipt.proofId,
      runId: receipt.runId,
      enforcedControlGroup: receipt.controlGroup,
      controlGroupIdentity: receipt.controlGroupIdentity,
      enforcementGenerationId: receipt.enforcementGeneration.generationId,
      launcherSha256: receipt.launcherSha256,
      workerSha256: receipt.workerSha256,
      launchAuthorityPublicKeySha256: receipt.launchAuthority.publicKeySha256,
      ticketConsumptionDirectoryIdentity: receipt.ticketConsumption.directoryIdentity,
      defaultDeny: true,
      atlasAllowed: false,
      endpoints: EXPECTED_ENDPOINTS,
    }
  } catch (error) { return blocked(error) }
}

function readRepository(relativePath) { return fs.readFileSync(new URL(relativePath, ROOT)) }
function trustedGit(args, encoding = null, acceptedStatuses = [0]) {
  const result = spawnSync("/usr/bin/git", args, { cwd: REPOSITORY_ROOT, encoding, shell: false, windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024, env: TRUSTED_GIT_ENV })
  if (result.error || !acceptedStatuses.includes(result.status)) fail("fixed trusted-main Git proof failed")
  return result
}
function proveCriticalFiles() {
  const root = fs.realpathSync(REPOSITORY_ROOT)
  for (const relativePath of CRITICAL_PATHS) {
    const lexical = path.join(root, ...relativePath.split("/"))
    let cursor = root
    for (const segment of relativePath.split("/")) {
      cursor = path.join(cursor, segment)
      if (fs.lstatSync(cursor).isSymbolicLink()) fail("activation-critical path contains a symbolic link")
    }
    const real = fs.realpathSync(lexical)
    const relative = path.relative(root, real)
    const stats = fs.statSync(real)
    if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !stats.isFile() || stats.nlink !== 1) fail("activation-critical path is unsafe")
    const trusted = Buffer.from(trustedGit(["--no-replace-objects", "show", `refs/heads/main:${relativePath}`]).stdout ?? [])
    if (!trusted.equals(fs.readFileSync(real))) fail("activation-critical bytes differ from trusted main")
  }
}
function readRootOwnedReceipt() {
  let cursor = path.parse(RECEIPT_PATH).root
  for (const segment of RECEIPT_PATH.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment)
    const stats = fs.lstatSync(cursor)
    if (stats.isSymbolicLink()) fail("network receipt path contains a symbolic link")
    if (cursor !== RECEIPT_PATH && (!stats.isDirectory() || stats.uid !== 0 || (stats.mode & 0o022) !== 0)) fail("network receipt parent is not root-controlled")
  }
  const stats = fs.lstatSync(RECEIPT_PATH)
  if (!stats.isFile() || stats.nlink !== 1 || stats.uid !== 0 || (stats.mode & 0o777) !== 0o444 || stats.size < 1 || stats.size > 65_536) fail("network receipt file trust differs")
  return {
    bytes: fs.readFileSync(RECEIPT_PATH),
    file: { isFile: true, isSymbolicLink: false, nlink: stats.nlink, uid: stats.uid, mode: stats.mode & 0o777, parentsRootOwnedAndNotWritable: true },
  }
}
function trustedNow() {
  const result = spawnSync("/usr/bin/date", ["-u", "+%Y-%m-%dT%H:%M:%S.%3NZ"], { encoding: "utf8", shell: false, windowsHide: true, timeout: 5000, env: { HOME: "/nonexistent", PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" } })
  if (result.status !== 0 || !UTC.test(result.stdout?.trim() ?? "")) fail("trusted UTC clock is unavailable")
  return result.stdout.trim()
}
function currentControlGroupIdentity(controlGroup) {
  if (!ENFORCED_SLICE.test(controlGroup)) fail("enforced worker slice path differs")
  const root = fs.realpathSync(CONTROL_GROUP_ROOT_PATH)
  const lexical = path.join(root, ...controlGroup.slice(1).split("/"))
  const relative = path.relative(root, lexical)
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail("resident process cgroup escapes cgroup v2")
  let cursor = root
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment)
    if (fs.lstatSync(cursor).isSymbolicLink()) fail("resident process cgroup contains a symbolic link")
  }
  const real = fs.realpathSync(lexical)
  if (real !== lexical) fail("resident process cgroup path is not exact")
  const stats = fs.statSync(real, { bigint: true })
  if (!stats.isDirectory()) fail("resident process cgroup is not a directory")
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
  const attributes = spawnSync("/usr/bin/lsattr", ["-d", "--", TICKET_CONSUMPTION_DIRECTORY], { encoding: "utf8", shell: false, windowsHide: true, timeout: 5000, env: { HOME: "/nonexistent", PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" } })
  if (attributes.status !== 0 || !/^[A-Za-z-]*a[A-Za-z-]*\s+/.test(attributes.stdout ?? "")) fail("ticket consumption directory append-only state is unproven")
  return {
    isDirectory: stats.isDirectory(), isSymbolicLink: false, uid: Number(stats.uid), gid: Number(stats.gid), mode: Number(stats.mode & 0o7777n), appendOnly: true,
    parentsRootOwnedAndNotWritable: true,
    identity: { device: stats.dev.toString(), inode: stats.ino.toString(), ctimeNs: stats.ctimeNs.toString() },
  }
}

export async function proveResidentAegisNetworkBoundary() {
  try {
    if (process.platform !== "linux") fail("resident network proof requires Linux")
    const policyBytes = readRepository(POLICY_PATH)
    const policy = JSON.parse(policyBytes)
    validatePolicy(policy)
    const identity = trustedResidentIdentity()
    const trustedMain = createTrustedProofProviders().proveTrustedCheckout()
    const ancestry = trustedGit(["--no-replace-objects", "merge-base", "--is-ancestor", policy.trustedMain.minimumCommit, trustedMain.head_commit], "utf8", [0, 1])
    if (ancestry.status !== 0) fail("network provider minimum trusted-main ancestry is unproven")
    proveCriticalFiles()
    const activationBytes = readRepository(ACTIVATION_PATH)
    const activationAuthority = JSON.parse(activationBytes)
    const receipt = readRootOwnedReceipt()
    const parsedReceipt = parseCanonicalReceipt(receipt.bytes)
    const enforcedControlGroup = parsedReceipt.controlGroup
    return inspectResidentNetworkBoundaryEvidence({
      policy,
      receiptBytes: receipt.bytes,
      receiptFile: receipt.file,
      now: trustedNow(),
      bootId: fs.readFileSync(BOOT_ID_PATH, "utf8").trim(),
      enforcedControlGroup,
      currentControlGroupIdentity: currentControlGroupIdentity(enforcedControlGroup),
      currentTicketConsumptionDirectory: currentTicketConsumptionDirectory(),
      identity,
      trustedMain,
      policySha256: normalizedDigest(policyBytes),
      activationSha256: normalizedDigest(activationBytes),
      providerSha256: normalizedDigest(fs.readFileSync(fileURLToPath(import.meta.url))),
      launcherSha256: normalizedDigest(readRepository(LAUNCHER_PATH)),
      activation: { activationId: activationAuthority.activationId, authorityReference: activationAuthority.authorityReference, runId: activationAuthority.run?.runId, workerSha256: activationAuthority.bindings?.worker?.sha256, network: activationAuthority.network },
    })
  } catch (error) { return blocked(error) }
}
