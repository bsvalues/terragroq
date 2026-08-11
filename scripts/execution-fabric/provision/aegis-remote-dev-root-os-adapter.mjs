import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

const EVIDENCE_ROOT = "/var/lib/williamos-fabric/remote-dev-prerequisite-handoff"
const BUNDLE_ROOT = "/usr/local/share/williamos/aegis-root-handoff-bundle"
const STAGED_ROOT = `${EVIDENCE_ROOT}/staged`
const CLAIM_ROOT = `${EVIDENCE_ROOT}/claims`
const JOURNAL_ROOT = `${EVIDENCE_ROOT}/journal`
const LAUNCH_PRIVATE_KEY = "/etc/williamos-fabric/aegis-remote-dev-launch-authority.key"
const LAUNCH_PUBLIC_KEY = "/etc/williamos-fabric/aegis-remote-dev-launch-authority.pem"
const FIXED_ENV = Object.freeze({ HOME: "/nonexistent", PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_NO_REPLACE_OBJECTS: "1" })
const STEPS = Object.freeze([
  "RECONCILE_BOUNDED_IDENTITY", "INSTALL_ROOT_LAUNCH_ASSETS", "INSTALL_DUAL_STACK_BROKER_BOUNDARY",
  "INSTALL_GITHUB_HOST_AUTH_BOUNDARY", "RECONCILE_TRUSTED_REPOSITORIES", "INSTALL_PINNED_TOOLCHAIN",
  "CREATE_DURABLE_LEDGER", "INSTALL_FORCED_COMMAND_TRANSPORT",
])
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex")
const canonical = (value) => value === null ? "null" : typeof value === "string" ? JSON.stringify(value) : typeof value === "number" ? JSON.stringify(value) : typeof value === "boolean" ? String(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
const same = (left, right) => canonical(left) === canonical(right)

function fail(code, detail) { const error = new Error(detail); error.code = code; throw error }
function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, { encoding: "utf8", shell: false, windowsHide: true, timeout: options.timeout ?? 30_000, maxBuffer: 4 * 1024 * 1024, env: { ...FIXED_ENV, ...(options.env ?? {}) }, cwd: options.cwd, input: options.input })
  if (result.error || !(options.statuses ?? [0]).includes(result.status)) fail(options.code ?? "ROOT_COMMAND_FAILED", `${path.basename(executable)} ${args[0] ?? ""} failed`)
  return String(result.stdout ?? "").trim()
}
function trustedParents(file) {
  let cursor = "/"
  for (const segment of path.dirname(file).slice(1).split("/").filter(Boolean)) {
    cursor = path.join(cursor, segment); const stat = fs.lstatSync(cursor)
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022) !== 0) return false
  }
  return true
}
function exactFile(file, expectedSha, owner = 0, group = 0, mode) {
  try {
    const stat = fs.lstatSync(file)
    return trustedParents(file) && stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.uid === owner && stat.gid === group && (mode === undefined || (stat.mode & 0o7777) === mode) && sha(fs.readFileSync(file)) === expectedSha
  } catch { return false }
}
function lexists(file) { try { fs.lstatSync(file); return true } catch (error) { if (error?.code === "ENOENT") return false; throw error } }
function readCanonicalRootJson(file, mode = 0o400) {
  const stat = fs.lstatSync(file)
  if (!trustedParents(file) || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o7777) !== mode || stat.size < 3 || stat.size > 1_048_576) fail("EVIDENCE_FILE_UNTRUSTED", `${file} trust differs`)
  const bytes = fs.readFileSync(file); let value
  try { value = JSON.parse(bytes.toString("utf8")) } catch { fail("EVIDENCE_FILE_INVALID", `${file} is not JSON`) }
  if (!bytes.equals(Buffer.from(`${canonical(value)}\n`, "utf8"))) fail("EVIDENCE_FILE_INVALID", `${file} is not canonical JSON`)
  return value
}
function ensureRootDirectory(directory, mode = 0o755) {
  let cursor = "/"
  for (const segment of directory.slice(1).split("/").filter(Boolean)) {
    cursor = path.join(cursor, segment)
    if (!fs.existsSync(cursor)) fs.mkdirSync(cursor, { mode })
    const stat = fs.lstatSync(cursor)
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022) !== 0) fail("DESTINATION_PARENT_UNTRUSTED", `${cursor} is not root-controlled`)
  }
}
function atomicInstall(source, destination, expectedSha, mode, uid = 0, gid = 0) {
  const parent = path.dirname(destination); ensureRootDirectory(parent)
  if (!exactFile(source, expectedSha, 0, 0, 0o444) && !exactFile(source, expectedSha, 0, 0, 0o555)) fail("BUNDLE_ASSET_UNTRUSTED", `${source} differs from signed bytes`)
  if (fs.existsSync(destination)) {
    if (!exactFile(destination, expectedSha, uid, gid, mode)) fail("EXISTING_STATE_DRIFT", `${destination} differs; overwrite refused`)
    return
  }
  const temporary = `${destination}.${process.pid}.tmp`
  const bytes = fs.readFileSync(source); const handle = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, mode)
  fs.writeFileSync(handle, bytes); fs.fsyncSync(handle); fs.fchownSync(handle, uid, gid); fs.fchmodSync(handle, mode); fs.closeSync(handle); fs.renameSync(temporary, destination)
  const directory = fs.openSync(parent, fs.constants.O_RDONLY); fs.fsyncSync(directory); fs.closeSync(directory)
}
function staged(name, expectedSha, mode) {
  const file = path.join(STAGED_ROOT, name)
  if (!exactFile(file, expectedSha, 0, 0, mode)) fail("SIGNED_INPUT_UNAVAILABLE", `${name} does not match signed authority`)
  return file
}
function accountIds(name) {
  const line = run("/usr/bin/getent", ["passwd", name], { statuses: [0, 2], code: "IDENTITY_QUERY_FAILED" })
  if (!line) return null
  const fields = line.split(":"); const uid = Number(fields[2]); const gid = Number(fields[3])
  if (!Number.isSafeInteger(uid) || uid <= 0 || !Number.isSafeInteger(gid) || gid <= 0) fail("IDENTITY_DRIFT", "bounded account identifiers differ")
  return { uid, gid, home: fields[5], shell: fields[6] }
}
function supplementaryGroups(name) {
  try { return run("/usr/bin/id", ["-G", name]).split(/\s+/).filter(Boolean).map(Number) } catch { return [] }
}
function exactSharedGitGroup(gid) {
  try {
    const group = run("/usr/bin/getent", ["group", "williamos-fabric"]).split(":")
    const primary = run("/usr/bin/getent", ["passwd"]).split(/\r?\n/).filter(Boolean).map((line) => line.split(":"))
      .filter((fields) => Number(fields[3]) === gid).map((fields) => fields[0]).sort()
    return group.length === 4 && group[3] === "" && same(primary, ["williamos-fabric", "williamos-git-broker"])
  } catch { return false }
}
function userProcesses(uid) {
  const result = spawnSync("/usr/bin/pgrep", ["-u", String(uid)], { encoding: "utf8", shell: false, timeout: 5000, env: FIXED_ENV })
  if (result.error || ![0, 1].includes(result.status)) return { proven: false, pids: [], onlyManager: false }
  const pids = result.status === 1 ? [] : String(result.stdout ?? "").trim().split(/\s+/).filter(Boolean)
  let onlyManager = true
  for (const pid of pids) {
    try {
      const argv = fs.readFileSync(`/proc/${pid}/cmdline`).toString("utf8").split("\0").filter(Boolean)
      if (![/^\/usr\/lib\/systemd\/systemd$/, /^\/lib\/systemd\/systemd$/].some((pattern) => pattern.test(argv[0] ?? "")) || !argv.includes("--user")) onlyManager = false
    } catch { onlyManager = false }
  }
  return { proven: true, pids, onlyManager }
}
function sharedGroupProcessesExact(gid, allowedUids) {
  try {
    const allowed = new Set(allowedUids.map(String))
    for (const entry of fs.readdirSync("/proc")) {
      if (!/^[1-9][0-9]*$/.test(entry)) continue
      let status
      try { status = fs.readFileSync(`/proc/${entry}/status`, "utf8") } catch (error) { if (error?.code === "ENOENT") continue; return false }
      const gids = [...(/^[G]id:\s+(.+)$/m.exec(status)?.[1] ?? "").trim().split(/\s+/), ...(/^[G]roups:\s*(.*)$/m.exec(status)?.[1] ?? "").trim().split(/\s+/)].filter(Boolean)
      if (!gids.includes(String(gid))) continue
      const uids = (/^[U]id:\s+(.+)$/m.exec(status)?.[1] ?? "").trim().split(/\s+/).filter(Boolean)
      if (!uids.length || uids.some((uid) => !allowed.has(uid))) return false
    }
    return true
  } catch { return false }
}

export function inspectNoSudoCapabilityEvidence(result) {
  if (!result || result.error != null || result.signal !== null || ![0, 1].includes(result.status)) return false
  const stdout = String(result.stdout ?? ""); const stderr = String(result.stderr ?? "")
  if ((stdout.length > 0) === (stderr.length > 0)) return false
  const output = stdout || stderr
  const exactDenial = /^(?:User williamos-fabric is not allowed to run sudo on|Sorry, user williamos-fabric may not run sudo on) [A-Za-z0-9._-]+\.\r?\n?$/.test(output)
  if (!exactDenial) return false
  return result.status === 1 || (result.status === 0 && stdout.length > 0 && /^User williamos-fabric is not allowed to run sudo on /.test(stdout))
}

export function inspectDurableLedgerReconciliation({ ledgerExact, ledgerExists, ledgerRecordsExact, ticketExact, ticketExists }) {
  if (![ledgerExact, ledgerExists, ledgerRecordsExact, ticketExact, ticketExists].every((value) => typeof value === "boolean")) return "DRIFT"
  if ((ledgerExact && !ledgerExists) || (ticketExact && !ticketExists)) return "DRIFT"
  if (ledgerExact && ledgerExists && ledgerRecordsExact && ticketExact && ticketExists) return "MATCH"
  if (ledgerExact && ledgerExists && ledgerRecordsExact && !ticketExact && !ticketExists) return "ABSENT"
  return "DRIFT"
}

function closedHashLedgerRecordsExact(manifest, ids) {
  try {
    if (!ids) return false
    const claimBinding = manifest.trustedEvidence.find((entry) => entry.path === "docs/reports/bounded-dispatch/WO-EF-DISPATCH-AEGIS-001-claim.json")
    const releaseBinding = manifest.trustedEvidence.find((entry) => entry.path === "docs/reports/bounded-dispatch/WO-EF-DISPATCH-AEGIS-001-release.json")
    if (!claimBinding || !releaseBinding) return false
    const claimSource = path.join(BUNDLE_ROOT, ...claimBinding.path.split("/")); const releaseSource = path.join(BUNDLE_ROOT, ...releaseBinding.path.split("/"))
    if (!exactFile(claimSource, claimBinding.sha256, 0, 0, 0o444) || !exactFile(releaseSource, releaseBinding.sha256, 0, 0, 0o444)) return false
    const claim = JSON.parse(fs.readFileSync(claimSource, "utf8")); const release = JSON.parse(fs.readFileSync(releaseSource, "utf8"))
    if (!/^[0-9a-f]{64}$/.test(claim.claim_key_sha256 ?? "") || !/^lease-[0-9a-f]{24}$/.test(release.lease_id ?? "") || release.claim_id !== claim.claim_id) return false
    const expected = new Map([
      [`claim-${claim.claim_key_sha256}.json`, claimBinding.sha256],
      [`release-${release.lease_id}.json`, releaseBinding.sha256],
    ])
    const ledgerRoot = "/var/lib/williamos/fabric/ledger"; const entries = fs.readdirSync(ledgerRoot)
    if (!same([...entries].sort(), [...expected.keys()].sort())) return false
    for (const [name, expectedSha] of expected) {
      const entry = path.join(ledgerRoot, name); const stat = fs.lstatSync(entry)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== ids.uid || stat.gid !== ids.gid || (stat.mode & 0o7777) !== 0o600 || sha(fs.readFileSync(entry)) !== expectedSha) return false
    }
    return true
  } catch { return false }
}
function noSudoCapability() {
  return inspectNoSudoCapabilityEvidence(spawnSync("/usr/bin/sudo", ["-n", "-l", "-U", "williamos-fabric"], { encoding: "utf8", shell: false, timeout: 5000, env: FIXED_ENV }))
}
function version(executable, args, pattern) {
  try { return pattern.exec(run(executable, args, { timeout: 10_000 }))?.[1] ?? null } catch { return null }
}
function toolchainState(manifest, authority) {
  const wrapper = manifest.appliedAssets.find((asset) => asset.destination === "/usr/bin/dotnet")
  if (!wrapper) return "DRIFT"
  if (lexists("/usr/bin/dotnet") && !exactFile("/usr/bin/dotnet", wrapper.sha256, 0, 0, 0o555)) {
    const command = fs.lstatSync("/usr/bin/dotnet")
    if (!command.isSymbolicLink() || fs.readlinkSync("/usr/bin/dotnet") !== "/usr/share/dotnet/dotnet") return "DRIFT"
  }
  const exact = [["git", "/usr/bin/git", ["--version"], /git version (\S+)/], ["node", "/usr/bin/node", ["--version"], /v(\S+)/], ["dotnetSdk", "/usr/share/dotnet/dotnet", ["--version"], /(\S+)/], ["corepack", "/usr/bin/corepack", ["--version"], /(\S+)/], ["pnpm", "/usr/bin/pnpm", ["--version"], /(\S+)/]]
  let missing = false
  for (const [name, executable, args, pattern] of exact) {
    const observed = version(executable, args, pattern)
    if (observed === authority.inputs.toolchain[name].version) {
      if (name !== "dotnetSdk" && !exactFile(executable, authority.inputs.toolchain[name].sha256, 0, 0, 0o755)) return "DRIFT"
      if (name === "dotnetSdk" && !exactFile("/usr/bin/dotnet", wrapper.sha256, 0, 0, 0o555)) {
        if (lexists("/usr/bin/dotnet")) {
          const command = fs.lstatSync("/usr/bin/dotnet")
          if (!command.isSymbolicLink() || fs.readlinkSync("/usr/bin/dotnet") !== "/usr/share/dotnet/dotnet") return "DRIFT"
        }
        missing = true
      }
      continue
    }
    if (name === "dotnetSdk" && !fs.existsSync("/usr/share/dotnet")) { missing = true; continue }
    if (!fs.existsSync(executable)) { missing = true; continue }
    return "DRIFT"
  }
  return missing ? "ABSENT" : "MATCH"
}

function rootOwnedRepositoryTree(directory) {
  try {
    const stat = fs.lstatSync(directory)
    if (!trustedParents(directory) || !stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o022) !== 0) return false
    return run("/usr/bin/find", [directory, "-xdev", "(", "!", "-user", "root", "-o", "-perm", "/022", ")", "-print", "-quit"]) === ""
  } catch { return false }
}

function repositoryState(manifest, authority) {
  const control = "/var/lib/williamos/fabric/workspaces/terragroq"
  const mirror = "/var/lib/williamos/fabric/repositories/terrafusion_os_1.0.git"
  const controlExists = fs.existsSync(control); const mirrorExists = fs.existsSync(mirror)
  try {
    let controlMatch = false; let mirrorMatch = false
    if (controlExists) {
      if (!rootOwnedRepositoryTree(control)
        || run("/usr/bin/git", ["remote", "get-url", "origin"], { cwd: control }) !== "ssh://git@ssh.github.com:443/bsvalues/terragroq.git"
        || run("/usr/bin/git", ["status", "--porcelain"], { cwd: control }) !== "") return "DRIFT"
      controlMatch = run("/usr/bin/git", ["--no-replace-objects", "rev-parse", "HEAD"], { cwd: control }) === authority.trustedMainCommit
        && run("/usr/bin/git", ["--no-replace-objects", "rev-parse", "refs/remotes/origin/main"], { cwd: control }) === authority.trustedMainCommit
    }
    if (mirrorExists) {
      if (!rootOwnedRepositoryTree(mirror)
        || run("/usr/bin/git", [`--git-dir=${mirror}`, "remote", "get-url", "origin"]) !== "ssh://git@ssh.github.com:443/bsvalues/terrafusion_os_1.0.git") return "DRIFT"
      mirrorMatch = spawnSync("/usr/bin/git", [`--git-dir=${mirror}`, "cat-file", "-e", "ffd2fa35f5152de2b95e7f63b220050d18193d7a^{commit}"], { shell: false, timeout: 5000, env: FIXED_ENV }).status === 0
    }
    return controlMatch && mirrorMatch ? "MATCH" : "ABSENT"
  } catch { return controlExists || mirrorExists ? "DRIFT" : "ABSENT" }
}
function rootAssetsState(manifest, authority) {
  const ids = accountIds("williamos-fabric"); let missing = false
  for (const asset of manifest.appliedAssets) {
    if (asset.destination === "/usr/bin/dotnet") continue
    if (!fs.existsSync(asset.destination)) { missing = true; continue }
    if (!exactFile(asset.destination, asset.sha256, 0, asset.group === "williamos-fabric" ? ids?.gid : 0, Number.parseInt(asset.mode, 8))) return "DRIFT"
  }
  const privateExists = fs.existsSync(LAUNCH_PRIVATE_KEY); const publicExists = fs.existsSync(LAUNCH_PUBLIC_KEY)
  if (privateExists !== publicExists || ((privateExists || publicExists) && !launchKeyEvidence(authority).match)) return "DRIFT"
  if (!privateExists) missing = true
  return missing ? "ABSENT" : "MATCH"
}
function launchKeyEvidence(authority) {
  try {
    const privateStat = fs.lstatSync(LAUNCH_PRIVATE_KEY); const publicStat = fs.lstatSync(LAUNCH_PUBLIC_KEY)
    if (!trustedParents(LAUNCH_PRIVATE_KEY) || !trustedParents(LAUNCH_PUBLIC_KEY) || !privateStat.isFile() || !publicStat.isFile() || privateStat.isSymbolicLink() || publicStat.isSymbolicLink()
      || privateStat.nlink !== 1 || publicStat.nlink !== 1 || privateStat.uid !== 0 || privateStat.gid !== 0 || publicStat.uid !== 0 || publicStat.gid !== 0
      || (privateStat.mode & 0o7777) !== 0o400 || (publicStat.mode & 0o7777) !== 0o444) return { match: false }
    const privateBytes = fs.readFileSync(LAUNCH_PRIVATE_KEY); const publicBytes = fs.readFileSync(LAUNCH_PUBLIC_KEY)
    const privateKey = crypto.createPrivateKey(privateBytes); const publicKey = crypto.createPublicKey(publicBytes)
    const derived = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" }); const observed = publicKey.export({ type: "spki", format: "der" })
    if (!Buffer.from(derived).equals(Buffer.from(observed))) return { match: false }
    const publicSha256 = sha(publicBytes); const privateSha256 = sha(privateBytes); const fingerprint = `SHA256:${crypto.createHash("sha256").update(observed).digest("base64").replace(/=+$/, "")}`
    if (authority.inputs.launchSigningKeyAction === "ADOPT_EXACT_EXISTING" && (authority.inputs.launchSigningPrivateKeySha256 !== privateSha256 || authority.inputs.launchSigningPublicKeySha256 !== publicSha256 || authority.inputs.launchSigningKeyFingerprint !== fingerprint)) return { match: false }
    return { match: true, privateSha256, publicSha256, fingerprint }
  } catch { return { match: false } }
}

function applyLaunchKey(authority) {
  const existingPrivate = fs.existsSync(LAUNCH_PRIVATE_KEY); const existingPublic = fs.existsSync(LAUNCH_PUBLIC_KEY)
  if (existingPrivate || existingPublic) {
    if (!existingPrivate || !existingPublic || !launchKeyEvidence(authority).match) fail("LAUNCH_KEY_DRIFT", "existing root launch keypair differs; overwrite refused")
    return
  }
  if (authority.inputs.launchSigningKeyAction !== "GENERATE_ON_AEGIS") fail("LAUNCH_KEY_ABSENT", "exact adopted launch key is absent")
  ensureRootDirectory("/etc/williamos-fabric", 0o755)
  const privateTemp = `${LAUNCH_PRIVATE_KEY}.${authority.transactionId}.tmp`; const publicTemp = `${LAUNCH_PUBLIC_KEY}.${authority.transactionId}.tmp`
  run("/usr/bin/openssl", ["genpkey", "-algorithm", "ED25519", "-out", privateTemp])
  run("/usr/bin/openssl", ["pkey", "-in", privateTemp, "-pubout", "-out", publicTemp])
  for (const [file, mode] of [[privateTemp, 0o400], [publicTemp, 0o444]]) { fs.chownSync(file, 0, 0); fs.chmodSync(file, mode); const handle = fs.openSync(file, fs.constants.O_RDONLY); fs.fsyncSync(handle); fs.closeSync(handle) }
  fs.renameSync(privateTemp, LAUNCH_PRIVATE_KEY); fs.renameSync(publicTemp, LAUNCH_PUBLIC_KEY); const parent = fs.openSync("/etc/williamos-fabric", fs.constants.O_RDONLY); fs.fsyncSync(parent); fs.closeSync(parent)
  if (!launchKeyEvidence(authority).match) fail("LAUNCH_KEY_DRIFT", "generated root launch keypair verification failed")
}
function storageObservation() {
  const image = "/var/lib/williamos/fabric/aegis-remote-dev-workspaces.xfs"
  try {
    const stat = fs.lstatSync(image); const real = fs.realpathSync(image)
    const loopLine = run("/usr/sbin/losetup", ["-j", image, "--noheadings", "--output", "NAME,BACK-FILE"]).split(/\r?\n/).filter(Boolean)
    if (loopLine.length !== 1) throw new Error("loop ambiguity")
    const loopDevice = loopLine[0].trim().split(/\s+/)[0]
    const loopBacking = run("/usr/sbin/losetup", ["--noheadings", "--output", "BACK-FILE", loopDevice])
    const majorMinor = run("/usr/bin/lsblk", ["-dn", "-o", "MAJ:MIN", loopDevice])
    const backingMount = run("/usr/bin/findmnt", ["-n", "-o", "FSTYPE", "--target", image])
    const mount = run("/usr/bin/findmnt", ["-n", "-o", "SOURCE,MAJ:MIN,FSTYPE,OPTIONS", "--target", "/srv/william"]).split(/\s+/, 4)
    const uuid = run("/usr/sbin/blkid", ["-s", "UUID", "-o", "value", loopDevice]); const label = run("/usr/sbin/blkid", ["-s", "LABEL", "-o", "value", loopDevice])
    const xfs = run("/usr/sbin/xfs_io", ["-c", "stat", "/srv/william/workspaces"]); const projectId = Number(/projid = (\d+)/.exec(xfs)?.[1])
    const quotaState = run("/usr/sbin/xfs_quota", ["-x", "-c", "state -p", "/srv/william"])
    const report = run("/usr/sbin/xfs_quota", ["-x", "-c", "report -p -b -n -N", "/srv/william"])
    const row = report.split(/\r?\n/).map((line) => line.trim().split(/\s+/)).find((fields) => fields[0] === "#734" || fields[0] === "734")
    const hardKiB = Number(row?.[3])
    return { verified: true, mutationRequested: false, backingHostFilesystem: backingMount, backingImageRealPath: real, backingImageBytes: stat.size, backingImageOwner: stat.uid === 0 ? "root" : String(stat.uid), backingImageGroup: stat.gid === 0 ? "root" : String(stat.gid), backingImageMode: (stat.mode & 0o777).toString(8).padStart(4, "0"), backingImageNlink: stat.nlink, backingDevice: String(stat.dev), backingInode: String(stat.ino), backingCtimeNs: stat.ctimeNs?.toString() ?? String(Math.trunc(stat.ctimeMs * 1e6)), loopDevice, loopBackingImageRealPath: fs.realpathSync(loopBacking), loopMajorMinor: majorMinor, mountSource: mount[0], mountSourceMajorMinor: mount[1], filesystemType: mount[2], filesystemUuid: uuid, filesystemLabel: label, mountPath: "/srv/william", mountOptions: mount[3].split(","), projectId, projectInherit: /proj-inherit|\[[^\]]*P[^\]]*\]/.test(xfs), quotaAccounting: /Accounting:\s+ON/i.test(quotaState), quotaEnforcement: /Enforcement:\s+ON/i.test(quotaState), hardLimitBytes: hardKiB * 1024 }
  } catch { return { verified: false, mutationRequested: false } }
}

export function inspectRootAdapterContract() {
  return { status: "ROOT_OS_ADAPTER_CONTRACT_VERIFIED", executionAuthorized: false, applyAuthorized: false, storageMode: "VERIFY_ONLY", schedulerEnabled: false, standingAuthority: false, steps: [...STEPS] }
}

function appendOnly(directory) {
  try { return /^[A-Za-z-]*a[A-Za-z-]*\s+/.test(run("/usr/bin/lsattr", ["-d", "--", directory])) } catch { return false }
}
const EXPECTED_NFT_BOUNDARY_LINES = Object.freeze([
  "table inet williamos_aegis_remote_dev {",
  "chain output {",
  "type filter hook output priority filter; policy accept;",
  'meta skuid "williamos-fabric" ip daddr 192.168.1.156 reject',
  'meta skuid "williamos-fabric" ip6 daddr ::ffff:192.168.1.156 reject',
  'meta skuid "williamos-fabric" ip daddr 127.0.0.1 tcp dport 17734 accept',
  'meta skuid "williamos-git-broker" ip daddr 127.0.0.1 tcp dport 17734 accept',
  'ip daddr 127.0.0.1 tcp dport 17734 reject',
  'meta skuid "williamos-fabric" reject',
  "}",
  "}",
])
export function exactNftBoundaryLines(lines) {
  return Array.isArray(lines) && same(lines, EXPECTED_NFT_BOUNDARY_LINES)
}
function networkBoundaryMatches() {
  try {
    const rules = run("/usr/sbin/nft", ["list", "chain", "inet", "williamos_aegis_remote_dev", "output"])
    const lines = rules.split(/\r?\n/).map((line) => line.trim().replace(/\s+/g, " ")).filter(Boolean)
    if (!exactNftBoundaryLines(lines)) return false
    for (const unit of ["williamos-aegis-remote-dev-egress.service", "williamos-aegis-remote-dev-broker.service", "williamos-aegis-remote-dev-git-broker.socket"]) {
      if (run("/usr/bin/systemctl", ["is-active", unit]) !== "active" || run("/usr/bin/systemctl", ["is-enabled", unit]) !== "enabled") return false
    }
    const listener = run("/usr/bin/ss", ["-H", "-ltn", "sport = :17734"])
    return listener.split(/\r?\n/).filter(Boolean).length === 1 && listener.includes("127.0.0.1:17734")
  } catch { return false }
}
function activeProofWorkerExists() {
  try {
    const active = run("/usr/bin/systemctl", ["list-units", "--all", "--plain", "--no-legend", "williamos-aegis-remote-dev-*.service"], { statuses: [0, 1] })
    if (active.split(/\r?\n/).some((line) => isProofWorkerUnitName(line.trim().split(/\s+/, 1)[0] ?? "") && /\b(?:activating|active|deactivating)\b/.test(line))) return true
    const root = "/sys/fs/cgroup"
    return fs.readdirSync(root, { recursive: true }).some((entry) => isProofWorkerUnitName(path.basename(String(entry))))
  } catch { return true }
}

export function isProofWorkerUnitName(value) {
  return /^williamos-aegis-remote-dev-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.service$/i.test(String(value))
}

function recoverJournal(authority) {
  if (activeProofWorkerExists()) fail("RECOVERY_WORKER_ACTIVE", "proof worker or transient unit remains active")
  const prefix = `${authority.transactionId}.`; const files = fs.readdirSync(JOURNAL_ROOT).filter((name) => name.startsWith(prefix))
  const records = []; let previous = "0".repeat(64); let sequence = 0; let pending = null; let lastStep = -1; let postVerified = false; let terminal = false
  for (const name of files.sort()) {
    if (!new RegExp(`^${authority.transactionId.replaceAll("-", "\\-")}\\.[0-9]{6}\\.[a-f0-9]{64}\\.json$`).test(name)) fail("JOURNAL_CHAIN_INVALID", "journal filename differs")
    const record = readCanonicalRootJson(path.join(JOURNAL_ROOT, name))
    const unsigned = { schemaVersion: record.schemaVersion, sequence: record.sequence, previousSha256: record.previousSha256, phase: record.phase, detail: record.detail }
    const digest = sha(Buffer.from(canonical(unsigned), "utf8"))
    if (record.schemaVersion !== 1 || record.sequence !== sequence + 1 || record.previousSha256 !== previous || record.recordSha256 !== digest || !name.includes(`.${String(record.sequence).padStart(6, "0")}.${digest}.`)) fail("JOURNAL_CHAIN_INVALID", "journal sequence or digest differs")
    if (!["AUTHORITY_CONSUMED", "STEP_INTENT", "STEP_APPLIED", "POST_APPLY_VERIFIED", "COMMITTED", "FAILED_PARTIAL"].includes(record.phase)) fail("JOURNAL_CHAIN_INVALID", "journal phase differs")
    if (terminal || (record.sequence === 1 && record.phase !== "AUTHORITY_CONSUMED") || (record.phase === "AUTHORITY_CONSUMED" && (record.sequence !== 1 || record.detail?.authorityId !== authority.authorityId || record.detail?.transactionId !== authority.transactionId))) fail("JOURNAL_CHAIN_INVALID", "journal authority or terminal order differs")
    if (record.phase === "STEP_INTENT") {
      const index = STEPS.indexOf(record.detail?.stepId)
      if (pending !== null || postVerified || index <= lastStep) fail("JOURNAL_CHAIN_INVALID", "step intent order differs")
      pending = record.detail.stepId
    } else if (record.phase === "STEP_APPLIED") {
      if (pending === null || record.detail?.stepId !== pending) fail("JOURNAL_CHAIN_INVALID", "step apply is not bound to its intent")
      lastStep = STEPS.indexOf(pending); pending = null
    } else if (record.phase === "POST_APPLY_VERIFIED") {
      if (pending !== null || postVerified) fail("JOURNAL_CHAIN_INVALID", "post-apply verification order differs")
      postVerified = true
    } else if (record.phase === "COMMITTED") {
      if (!postVerified || pending !== null || record.detail?.transactionId !== authority.transactionId) fail("JOURNAL_CHAIN_INVALID", "commit order differs")
      terminal = true
    } else if (record.phase === "FAILED_PARTIAL") terminal = true
    sequence = record.sequence; previous = digest; records.push(record)
  }
  if (records.some((record) => record.phase === "FAILED_PARTIAL")) fail("AUTHORITY_FAILED_CONSUMED", "failed authority can never be resumed")
  const committed = records.at(-1)?.phase === "COMMITTED"
  return { records, committed }
}
function observe(manifest, authority, trust) {
  const ids = accountIds("williamos-fabric")
  const brokerIds = accountIds("williamos-egress-broker")
  const gitBrokerIds = accountIds("williamos-git-broker")
  const transportPath = "/etc/ssh/authorized_keys/williamos-fabric"
  const transport = fs.existsSync(transportPath) ? fs.readFileSync(transportPath, "utf8") : ""
  const rootAssets = rootAssetsState(manifest, authority)
  const nft = networkBoundaryMatches()
  const repositories = repositoryState(manifest, authority)
  const toolchain = toolchainState(manifest, authority)
  const ledger = (() => { try { const s = fs.lstatSync("/var/lib/williamos/fabric/ledger"); return trustedParents("/var/lib/williamos/fabric/ledger") && s.isDirectory() && !s.isSymbolicLink() && s.uid === ids?.uid && s.gid === ids?.gid && (s.mode & 0o7777) === 0o700 && run("/usr/bin/findmnt", ["-n", "-o", "FSTYPE", "--target", "/var/lib/williamos/fabric/ledger"]) === "ext4" } catch { return false } })()
  const ledgerRecordsExact = closedHashLedgerRecordsExact(manifest, ids)
  const processState = ids ? userProcesses(ids.uid) : { proven: true, pids: [], onlyManager: true }
  const brokerProcessState = brokerIds ? userProcesses(brokerIds.uid) : { proven: true, pids: [], onlyManager: true }
  const gitBrokerProcessState = gitBrokerIds ? userProcesses(gitBrokerIds.uid) : { proven: true, pids: [], onlyManager: true }
  const identityMatch = (() => { try { const shadow = run("/usr/bin/getent", ["shadow", "williamos-fabric"]).split(":")[1]; const linger = fs.existsSync(`/var/lib/systemd/linger/williamos-fabric`); return ids?.home === "/var/empty/williamos-fabric" && ids?.shell === "/bin/bash" && /^!/.test(shadow) && linger && noSudoCapability() && same(supplementaryGroups("williamos-fabric"), [ids.gid]) && processState.proven && processState.onlyManager && brokerIds?.home === "/var/empty/williamos-egress-broker" && brokerIds?.shell === "/usr/sbin/nologin" && brokerProcessState.proven && same(supplementaryGroups("williamos-egress-broker"), [brokerIds.gid]) && gitBrokerIds?.home === "/var/empty/williamos-git-broker" && gitBrokerIds?.shell === "/usr/sbin/nologin" && gitBrokerIds.gid === ids.gid && gitBrokerProcessState.proven && gitBrokerProcessState.pids.length === 0 && same(supplementaryGroups("williamos-git-broker"), [ids.gid]) && exactSharedGitGroup(ids.gid) && sharedGroupProcessesExact(ids.gid, [ids.uid, gitBrokerIds.uid]) } catch { return false } })()
  const expectedTransport = (() => { try { const key = fs.readFileSync(path.join(STAGED_ROOT, "hermes-transport.pub"), "utf8").trim(); return `from="192.168.1.154",restrict,command="/usr/bin/node /usr/local/libexec/williamos-aegis-remote-dev-ssh-entrypoint.mjs" ${key}\n` } catch { return null } })()
  const githubMatch = exactFile("/etc/williamos-fabric/github_known_hosts", authority.inputs.githubHostKnownHostsSha256, 0, 0, 0o444) && exactFile("/etc/williamos-fabric/github-account.key", authority.inputs.githubAccountPrivateKeySha256, 0, 0, 0o400)
  const states = {
    RECONCILE_BOUNDED_IDENTITY: identityMatch ? "MATCH" : ids && (!processState.proven || (processState.pids.length > 0 && !processState.onlyManager) || !brokerProcessState.proven || brokerProcessState.pids.length > 0 || !gitBrokerProcessState.proven || gitBrokerProcessState.pids.length > 0 || !noSudoCapability()) ? "DRIFT" : "ABSENT",
    INSTALL_ROOT_LAUNCH_ASSETS: rootAssets,
    INSTALL_DUAL_STACK_BROKER_BOUNDARY: nft ? "MATCH" : (() => { try { const table = spawnSync("/usr/sbin/nft", ["list", "table", "inet", "williamos_aegis_remote_dev"], { encoding: "utf8", shell: false, timeout: 5000, env: FIXED_ENV }); const active = ["williamos-aegis-remote-dev-egress.service", "williamos-aegis-remote-dev-broker.service"].some((unit) => spawnSync("/usr/bin/systemctl", ["is-active", "--quiet", unit], { shell: false, timeout: 5000, env: FIXED_ENV }).status === 0); return table.status === 0 || active ? "DRIFT" : "ABSENT" } catch { return "DRIFT" } })(),
    INSTALL_GITHUB_HOST_AUTH_BOUNDARY: githubMatch ? "MATCH" : fs.existsSync("/etc/williamos-fabric/github_known_hosts") || fs.existsSync("/etc/williamos-fabric/github-account.key") ? "DRIFT" : "ABSENT",
    RECONCILE_TRUSTED_REPOSITORIES: repositories,
    INSTALL_PINNED_TOOLCHAIN: toolchain,
    CREATE_DURABLE_LEDGER: inspectDurableLedgerReconciliation({ ledgerExact: ledger, ledgerExists: fs.existsSync("/var/lib/williamos/fabric/ledger"), ledgerRecordsExact, ticketExact: appendOnly("/var/lib/williamos-fabric/remote-dev-launch-tickets"), ticketExists: lexists("/var/lib/williamos-fabric/remote-dev-launch-tickets") }),
    INSTALL_FORCED_COMMAND_TRANSPORT: transport === expectedTransport && exactFile(transportPath, sha(Buffer.from(expectedTransport)), 0, 0, 0o444) ? "MATCH" : transport ? "DRIFT" : "ABSENT",
  }
  return { platform: { os: process.platform, effectiveUid: process.getuid?.(), hostname: run("/usr/bin/hostname", ["-s"]), machineIdSha256: sha(Buffer.from(fs.readFileSync("/etc/machine-id", "utf8").trim(), "utf8")) }, ...trust, trustedMain: { ...trust.trustedMain, exactCleanHead: repositories === "MATCH", criticalBytesMatch: rootAssets }, storage: storageObservation(), prerequisites: states }
}

function applyIdentity() {
  let ids = accountIds("williamos-fabric")
  if (!ids) { run("/usr/sbin/useradd", ["--no-create-home", "--home-dir", "/var/empty/williamos-fabric", "--shell", "/bin/bash", "williamos-fabric"]); ids = accountIds("williamos-fabric") }
  run("/usr/bin/loginctl", ["disable-linger", "williamos-fabric"], { statuses: [0, 1] })
  run("/usr/bin/loginctl", ["terminate-user", "williamos-fabric"], { statuses: [0, 1] })
  const stopped = userProcesses(ids.uid); if (!stopped.proven || stopped.pids.length) fail("IDENTITY_ACTIVE", "bounded identity still owns a process after termination")
  ensureRootDirectory("/var/empty/williamos-fabric", 0o755)
  run("/usr/sbin/usermod", ["-G", "", "--home", "/var/empty/williamos-fabric", "--shell", "/bin/bash", "--lock", "williamos-fabric"])
  ids = accountIds("williamos-fabric")
  if (!ids || !same(supplementaryGroups("williamos-fabric"), [ids.gid]) || !noSudoCapability()) fail("IDENTITY_DRIFT", "exact primary-only no-sudo identity is unproven")
  let broker = accountIds("williamos-egress-broker")
  if (!broker) { run("/usr/sbin/useradd", ["--system", "--home-dir", "/var/empty/williamos-egress-broker", "--shell", "/usr/sbin/nologin", "--no-create-home", "williamos-egress-broker"]); broker = accountIds("williamos-egress-broker") }
  const brokerProcesses = userProcesses(broker.uid); if (!brokerProcesses.proven || brokerProcesses.pids.length) fail("IDENTITY_ACTIVE", "egress broker identity unexpectedly owns a process before network apply")
  ensureRootDirectory("/var/empty/williamos-egress-broker", 0o755)
  run("/usr/sbin/usermod", ["-G", "", "--home", "/var/empty/williamos-egress-broker", "--shell", "/usr/sbin/nologin", "--lock", "williamos-egress-broker"])
  broker = accountIds("williamos-egress-broker")
  if (!broker || !same(supplementaryGroups("williamos-egress-broker"), [broker.gid])) fail("IDENTITY_DRIFT", "egress broker identity retains supplementary groups")
  let gitBroker = accountIds("williamos-git-broker")
  if (!gitBroker) { run("/usr/sbin/useradd", ["--system", "--gid", "williamos-fabric", "--home-dir", "/var/empty/williamos-git-broker", "--shell", "/usr/sbin/nologin", "--no-create-home", "williamos-git-broker"]); gitBroker = accountIds("williamos-git-broker") }
  const gitBrokerProcesses = userProcesses(gitBroker.uid); if (!gitBrokerProcesses.proven || gitBrokerProcesses.pids.length) fail("IDENTITY_ACTIVE", "Git broker identity unexpectedly owns a process before asset apply")
  ensureRootDirectory("/var/empty/williamos-git-broker", 0o755)
  run("/usr/sbin/usermod", ["-G", "", "--gid", "williamos-fabric", "--home", "/var/empty/williamos-git-broker", "--shell", "/usr/sbin/nologin", "--lock", "williamos-git-broker"])
  gitBroker = accountIds("williamos-git-broker")
  if (!gitBroker || gitBroker.gid !== ids.gid || !same(supplementaryGroups("williamos-git-broker"), [ids.gid]) || !exactSharedGitGroup(ids.gid) || !sharedGroupProcessesExact(ids.gid, [ids.uid, gitBroker.uid])) fail("IDENTITY_DRIFT", "Git broker identity, live retained group holders, or exact shared primary group differs")
}
function applyAssets(manifest, authority) {
  for (const asset of manifest.appliedAssets) {
    if (asset.destination === "/usr/bin/dotnet") continue
    const source = path.join(BUNDLE_ROOT, ...asset.source.split("/")); const ids = asset.group === "williamos-fabric" ? accountIds("williamos-fabric") : null
    atomicInstall(source, asset.destination, asset.sha256, Number.parseInt(asset.mode, 8), 0, ids?.gid ?? 0)
  }
  applyLaunchKey(authority)
  run("/usr/bin/systemctl", ["daemon-reload"])
}
function applyNetwork(authority) {
  if (!fs.existsSync("/etc/williamos-fabric/williamos-aegis-remote-dev-egress.nft")) fail("ROOT_ASSET_MISSING", "default-deny asset is missing")
  run("/usr/bin/systemd-analyze", ["verify", "/etc/systemd/system/williamos-aegis-remote-dev-egress.service", "/etc/systemd/system/williamos-aegis-remote-dev-broker.service", "/etc/systemd/system/williamos-aegis-remote-dev-git-broker.socket", "/etc/systemd/system/williamos-aegis-remote-dev-git-broker.service"])
  run("/usr/bin/node", ["--check", "/usr/local/libexec/williamos-aegis-remote-dev-egress-enforcer.mjs"])
  run("/usr/bin/node", ["--check", "/usr/local/libexec/williamos-aegis-remote-dev-egress-broker.mjs"])
  run("/usr/bin/node", ["--check", "/usr/local/libexec/aegis-remote-dev-runtime-authority.mjs"])
  run("/usr/bin/node", ["--check", "/usr/local/libexec/williamos-aegis-remote-dev-git-broker.mjs"])
  run("/usr/bin/node", ["--check", "/usr/local/libexec/williamos-aegis-remote-dev-git-client.mjs"])
  const worker = accountIds("williamos-fabric"); const gitBroker = accountIds("williamos-git-broker")
  if (!worker || !gitBroker || !sharedGroupProcessesExact(worker.gid, [worker.uid, gitBroker.uid])) fail("IDENTITY_DRIFT", "retained shared-group process exists before broker socket enable")
  run("/usr/bin/systemctl", ["enable", "--now", "williamos-aegis-remote-dev-egress.service", "williamos-aegis-remote-dev-broker.service", "williamos-aegis-remote-dev-git-broker.socket"])
  if (!networkBoundaryMatches()) fail("NETWORK_BOUNDARY_UNPROVEN", "exact broker/default-deny/Atlas boundary differs after apply")
}
function applyGithub(authority) {
  const known = staged("github_known_hosts", authority.inputs.githubHostKnownHostsSha256, 0o400)
  const key = staged("github-account.key", authority.inputs.githubAccountPrivateKeySha256, 0o400)
  atomicInstall(known, "/etc/williamos-fabric/github_known_hosts", authority.inputs.githubHostKnownHostsSha256, 0o444)
  atomicInstall(key, "/etc/williamos-fabric/github-account.key", authority.inputs.githubAccountPrivateKeySha256, 0o400)
  const fingerprint = run("/usr/bin/ssh-keygen", ["-lf", "/etc/williamos-fabric/github-account.key", "-E", "sha256"])
  if (!fingerprint.includes(authority.inputs.githubAccountKeyFingerprint)) fail("GITHUB_KEY_DRIFT", "GitHub account key fingerprint differs")
}
function applyTransport(authority) {
  const source = staged("hermes-transport.pub", authority.inputs.hermesTransportPublicKeySha256, 0o400)
  const fingerprint = run("/usr/bin/ssh-keygen", ["-lf", source, "-E", "sha256"])
  if (!fingerprint.includes(authority.inputs.hermesTransportKeyFingerprint)) fail("TRANSPORT_KEY_DRIFT", "Hermes transport key fingerprint differs")
  const directory = "/etc/ssh/authorized_keys"; ensureRootDirectory(directory, 0o755)
  const key = fs.readFileSync(source, "utf8").trim(); const line = `from="192.168.1.154",restrict,command="/usr/bin/node /usr/local/libexec/williamos-aegis-remote-dev-ssh-entrypoint.mjs" ${key}\n`
  const destination = `${directory}/williamos-fabric`; if (fs.existsSync(destination)) { if (!exactFile(destination, sha(Buffer.from(line)), 0, 0, 0o444)) fail("TRANSPORT_DRIFT", "existing forced-command transport differs") }
  else { const handle = fs.openSync(destination, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o444); fs.writeFileSync(handle, line); fs.fsyncSync(handle); fs.closeSync(handle); const parent = fs.openSync(directory, fs.constants.O_RDONLY); fs.fsyncSync(parent); fs.closeSync(parent) }
  run("/usr/sbin/sshd", ["-t"])
  for (const address of ["192.168.1.154", "192.168.1.155"]) {
    const effective = run("/usr/sbin/sshd", ["-T", "-C", `user=williamos-fabric,host=aegis,addr=${address}`])
    for (const required of ["passwordauthentication no", "kbdinteractiveauthentication no", "hostbasedauthentication no", "pubkeyauthentication yes", "authenticationmethods publickey", "forcecommand /usr/bin/node /usr/local/libexec/williamos-aegis-remote-dev-ssh-entrypoint.mjs", "allowtcpforwarding no", "permittty no", "permituserenvironment no", "permituserrc no", "authorizedkeysfile /etc/ssh/authorized_keys/williamos-fabric", "authorizedkeyscommand none", "authorizedprincipalscommand none", "trustedusercakeys none"]) if (!effective.includes(required)) fail("TRANSPORT_DRIFT", "effective SSH restriction differs")
  }
  run("/usr/bin/loginctl", ["enable-linger", "williamos-fabric"])
}
function applyRepositories(manifest, authority) {
  const control = "/var/lib/williamos/fabric/workspaces/terragroq"; const mirror = "/var/lib/williamos/fabric/repositories/terrafusion_os_1.0.git"
  const rootSsh = "/usr/bin/ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o GlobalKnownHostsFile=/etc/williamos-fabric/github_known_hosts -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o IdentityFile=/etc/williamos-fabric/github-account.key -o ProxyCommand=none"
  const gitOptions = { timeout: 300_000, env: { GIT_SSH_COMMAND: rootSsh } }
  ensureRootDirectory("/var/lib/williamos/fabric/workspaces")
  ensureRootDirectory("/var/lib/williamos/fabric/repositories")
  if ((fs.existsSync(control) || fs.existsSync(mirror)) && repositoryState(manifest, authority) === "DRIFT") fail("REPOSITORY_DRIFT", "existing control checkout or target mirror is not root-controlled and clean")
  if (!fs.existsSync(control)) run("/usr/bin/git", ["clone", "--no-checkout", "ssh://git@ssh.github.com:443/bsvalues/terragroq.git", control], gitOptions)
  run("/usr/bin/git", ["fetch", "--force", "origin", `+refs/heads/main:refs/remotes/origin/main`], { ...gitOptions, cwd: control })
  if (run("/usr/bin/git", ["--no-replace-objects", "rev-parse", "refs/remotes/origin/main"], { cwd: control }) !== authority.trustedMainCommit) fail("REPOSITORY_DRIFT", "fresh control-plane main differs from signed authority")
  run("/usr/bin/git", ["--no-replace-objects", "merge-base", "--is-ancestor", manifest.trustedMain.minimumCommit, authority.trustedMainCommit], { cwd: control })
  if (run("/usr/bin/git", ["status", "--porcelain"], { cwd: control }) !== "") fail("REPOSITORY_DRIFT", "control checkout is dirty")
  run("/usr/bin/git", ["checkout", "-B", "main", authority.trustedMainCommit], { cwd: control })
  if (!fs.existsSync(mirror)) run("/usr/bin/git", ["clone", "--mirror", "ssh://git@ssh.github.com:443/bsvalues/terrafusion_os_1.0.git", mirror], gitOptions)
  run("/usr/bin/git", [`--git-dir=${mirror}`, "fetch", "--force", "origin", "+refs/heads/main:refs/heads/main"], gitOptions)
  run("/usr/bin/git", [`--git-dir=${mirror}`, "cat-file", "-e", "ffd2fa35f5152de2b95e7f63b220050d18193d7a^{commit}"])
  if (repositoryState(manifest, authority) !== "MATCH") fail("REPOSITORY_DRIFT", "trusted repositories differ after reconciliation")
}
function applyToolchain(manifest, authority) {
  const dotnet = authority.inputs.toolchain.dotnetSdk
  if (version("/usr/share/dotnet/dotnet", ["--version"], /(\S+)/) !== dotnet.version) {
    if (fs.existsSync("/usr/share/dotnet")) fail("PINNED_TOOLCHAIN_DRIFT", "existing .NET installation differs; overwrite refused")
    const archive = staged("dotnet-sdk-8.0.423-linux-x64.tar.gz", dotnet.sha256, 0o400)
    const entries = run("/usr/bin/tar", ["-tzf", archive], { timeout: 30_000 }).split(/\r?\n/).filter(Boolean)
    if (!entries.length || entries.some((entry) => entry.startsWith("/") || entry.split("/").includes(".."))) fail("PINNED_TOOLCHAIN_ARCHIVE_INVALID", ".NET archive contains an unsafe path")
    ensureRootDirectory("/usr/share")
    const temporary = `/usr/share/dotnet.${authority.transactionId}.tmp`
    if (fs.existsSync(temporary)) {
      const partial = fs.lstatSync(temporary)
      if (!trustedParents(temporary) || !partial.isDirectory() || partial.isSymbolicLink() || partial.uid !== 0 || partial.gid !== 0 || !temporary.startsWith("/usr/share/dotnet.") || !temporary.endsWith(".tmp")) fail("PINNED_TOOLCHAIN_PARTIAL", "transaction .NET staging path is unsafe")
      fs.rmSync(temporary, { recursive: true, force: false })
    }
    fs.mkdirSync(temporary, { mode: 0o755 })
    run("/usr/bin/tar", ["-xzf", archive, "--no-same-owner", "-C", temporary], { timeout: 300_000 })
    fs.chmodSync(temporary, 0o755)
    const unsafeType = run("/usr/bin/find", [temporary, "-xdev", "(", "-type", "l", "-o", "-type", "s", "-o", "-type", "p", "-o", "-type", "b", "-o", "-type", "c", "-o", "-type", "f", "-links", "+1", ")", "-print", "-quit"])
    const unsafeMode = run("/usr/bin/find", [temporary, "-xdev", "(", "!", "-user", "root", "-o", "-perm", "/022", "-o", "-type", "d", "!", "-perm", "-0555", "-o", "-type", "f", "!", "-perm", "-0444", ")", "-print", "-quit"])
    if (unsafeType || unsafeMode) fail("PINNED_TOOLCHAIN_ARCHIVE_INVALID", ".NET SDK tree type, ownership, or worker-readable mode differs")
    if (version(`${temporary}/dotnet`, ["--version"], /(\S+)/) !== dotnet.version) fail("PINNED_TOOLCHAIN_ARCHIVE_INVALID", "staged .NET SDK version differs")
    run("/usr/bin/sync", ["-f", temporary])
    fs.renameSync(temporary, "/usr/share/dotnet"); const parent = fs.openSync("/usr/share", fs.constants.O_RDONLY); fs.fsyncSync(parent); fs.closeSync(parent)
  }
  const wrapper = manifest.appliedAssets.find((asset) => asset.destination === "/usr/bin/dotnet")
  if (!wrapper) fail("PINNED_TOOLCHAIN_DRIFT", "reviewed dotnet wrapper asset is absent")
  const source = path.join(BUNDLE_ROOT, ...wrapper.source.split("/"))
  if (lexists("/usr/bin/dotnet") && !exactFile("/usr/bin/dotnet", wrapper.sha256, 0, 0, 0o555)) {
    const stat = fs.lstatSync("/usr/bin/dotnet")
    if (!stat.isSymbolicLink() || fs.readlinkSync("/usr/bin/dotnet") !== "/usr/share/dotnet/dotnet") fail("PINNED_TOOLCHAIN_DRIFT", "existing dotnet command is neither reviewed wrapper nor canonical SDK symlink")
    fs.unlinkSync("/usr/bin/dotnet")
  }
  atomicInstall(source, "/usr/bin/dotnet", wrapper.sha256, 0o555)
  const exact = [["git", "/usr/bin/git", ["--version"], /git version (\S+)/], ["node", "/usr/bin/node", ["--version"], /v(\S+)/], ["dotnetSdk", "/usr/share/dotnet/dotnet", ["--version"], /(\S+)/], ["corepack", "/usr/bin/corepack", ["--version"], /(\S+)/], ["pnpm", "/usr/bin/pnpm", ["--version"], /(\S+)/]]
  for (const [name, executable, args, pattern] of exact) if (version(executable, args, pattern) !== authority.inputs.toolchain[name].version) fail("PINNED_TOOLCHAIN_UNAVAILABLE", `${name} must be pre-staged and installed by the signed package provenance before this transaction`)
}
function applyLedger() {
  run("/usr/bin/systemd-tmpfiles", ["--create", "/etc/tmpfiles.d/williamos-aegis-remote-dev.conf"])
  run("/usr/bin/chattr", ["+a", "/var/lib/williamos-fabric/remote-dev-launch-tickets"])
}
function publishReceipt(manifest, authority, journalHeadSha256) {
  const launchKey = launchKeyEvidence(authority); if (!launchKey.match) fail("LAUNCH_KEY_DRIFT", "root launch key evidence differs at publication")
  const receipt = { schemaVersion: 1, status: "PREREQUISITES_VERIFIED", workOrderId: "WO-TF-REMOTE-DEV-OFFLOAD-001", transactionId: authority.transactionId, authorityId: authority.authorityId, completedAt: run("/usr/bin/date", ["-u", "+%Y-%m-%dT%H:%M:%S.%3NZ"]), machineIdSha256: manifest.target.machineIdSha256, trustedMainCommit: authority.trustedMainCommit, rootHandoffManifestSha256: authority.rootHandoffManifestSha256, historicalPreflightManifestJcsSha256: manifest.prerequisitePackage.supersededPreflight.manifestJcsSha256, appliedAssets: manifest.appliedAssets, authoritySha256: sha(Buffer.from(canonical(authority), "utf8")), inputsSha256: sha(Buffer.from(canonical(authority.inputs), "utf8")), launchAuthorityPublicKeySha256: launchKey.publicSha256, storage: authority.storage, journalHeadSha256, schedulerEnabled: false, standingAuthority: false, dispatchOccurred: false, closedHashMutation: false, executionAuthorized: false, activationAuthorized: false }
  const bytes = Buffer.from(`${canonical(receipt)}\n`, "utf8"); const destination = "/var/lib/williamos-fabric/remote-dev-prerequisite-verified.json"
  if (fs.existsSync(destination)) {
    const current = readCanonicalRootJson(destination, 0o444)
    if (!existingReceiptMatches(current, receipt)) fail("SUCCESS_RECEIPT_CONFLICT", "canonical success receipt belongs to another transaction or journal head")
    return sha(Buffer.from(`${canonical(current)}\n`, "utf8"))
  }
  let handle
  try { handle = fs.openSync(destination, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o444) } catch (error) { fail("SUCCESS_RECEIPT_CONFLICT", `canonical success receipt publication failed: ${error?.code ?? "unknown"}`) }
  fs.writeFileSync(handle, bytes); fs.fsyncSync(handle); fs.closeSync(handle); const directory = fs.openSync("/var/lib/williamos-fabric", fs.constants.O_RDONLY); fs.fsyncSync(directory); fs.closeSync(directory)
  return sha(bytes)
}

function existingReceiptMatches(current, expected) {
  const completed = Date.parse(current?.completedAt)
  return Number.isFinite(completed) && canonical({ ...current, completedAt: expected.completedAt }) === canonical(expected)
}

function proveRootServiceFence() {
  const cgroup = fs.readFileSync("/proc/self/cgroup", "utf8").trim()
  if (cgroup !== "0::/system.slice/williamos-aegis-root-handoff.service") fail("ROOT_HANDOFF_FENCE_UNPROVEN", "root verifier is not in the fixed system service cgroup")
  const pids = fs.readFileSync("/sys/fs/cgroup/system.slice/williamos-aegis-root-handoff.service/cgroup.procs", "utf8").trim().split(/\s+/).filter(Boolean)
  if (!pids.length || !pids.includes(String(process.pid)) || pids.some((pid) => !/^[1-9][0-9]*$/.test(pid))) fail("ROOT_HANDOFF_FENCE_UNPROVEN", "root verifier cgroup identity differs")
}

function exactRootDirectory(directory, mode, append = false) { try { const s = fs.lstatSync(directory); return trustedParents(directory) && s.isDirectory() && !s.isSymbolicLink() && s.uid === 0 && s.gid === 0 && (s.mode & 0o7777) === mode && (!append || appendOnly(directory)) } catch { return false } }
export function inspectRootClaimWindow(authority, now) {
  const issued = Date.parse(authority?.issuedAt); const expires = Date.parse(authority?.expiresAt)
  const resumeExpires = Date.parse(authority?.resumeExpiresAt); const current = Date.parse(now)
  if (![issued, expires, resumeExpires, current].every(Number.isFinite) || expires - issued !== 900_000 || resumeExpires - expires !== 1_800_000 || current < issued) return { createAllowed: false, resumeAllowed: false }
  return { createAllowed: current < expires, resumeAllowed: current < resumeExpires }
}
export function createRootProductionAdapter(manifest, authority, trust) {
  if (process.platform !== "linux" || process.getuid?.() !== 0) fail("ROOT_LINUX_REQUIRED", "fixed adapter runs only as root on Linux")
  if (!exactRootDirectory(EVIDENCE_ROOT, 0o700, true) || !exactRootDirectory(CLAIM_ROOT, 0o700, true) || !exactRootDirectory(JOURNAL_ROOT, 0o700, true) || !exactRootDirectory(STAGED_ROOT, 0o700)) fail("EXTERNAL_BOOTSTRAP_INCOMPLETE", "root evidence, claim, journal, or staged directory trust differs")
  let head = "0".repeat(64); let sequence = 0
  return Object.freeze({
    acquireLease: async () => { proveRootServiceFence(); return true },
    releaseLease: async () => undefined,
    reprove: async () => observe(manifest, authority, trust),
    claim: async (authorityId, transactionId, allowCreate) => {
      const destination = `${CLAIM_ROOT}/${authorityId}.claimed`; let handle
      const claimWindow = inspectRootClaimWindow(authority, run("/usr/bin/date", ["-u", "+%Y-%m-%dT%H:%M:%S.%3NZ"]))
      if (!claimWindow.resumeAllowed) return { expired: true }
      const existingClaim = () => {
        const existing = readCanonicalRootJson(destination)
        return existing.authorityId === authorityId && existing.transactionId === transactionId && existing.authoritySha256 === sha(Buffer.from(canonical(authority), "utf8")) ? { resume: true } : false
      }
      try { return existingClaim() } catch (error) { if (error?.code !== "ENOENT") throw error }
      if (!claimWindow.createAllowed) return { expired: true }
      if (allowCreate !== true) return false
      try { handle = fs.openSync(destination, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o400) } catch (error) {
        if (error?.code !== "EEXIST") throw error
        return existingClaim()
      }
      fs.writeFileSync(handle, `${canonical({ authorityId, transactionId, authoritySha256: sha(Buffer.from(canonical(authority), "utf8")) })}\n`); fs.fsyncSync(handle); fs.closeSync(handle); const directory = fs.openSync(CLAIM_ROOT, fs.constants.O_RDONLY); fs.fsyncSync(directory); fs.closeSync(directory); return true
    },
    recover: async () => {
      const recovered = recoverJournal(authority)
      sequence = recovered.records.at(-1)?.sequence ?? 0; head = recovered.records.at(-1)?.recordSha256 ?? "0".repeat(64)
      return recovered
    },
    append: async (record) => {
      if (record.sequence !== sequence + 1 || record.previousSha256 !== head) fail("JOURNAL_CHAIN_INVALID", "journal record sequence differs")
      const file = `${JOURNAL_ROOT}/${authority.transactionId}.${String(record.sequence).padStart(6, "0")}.${record.recordSha256}.json`; const handle = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o400); fs.writeFileSync(handle, `${canonical(record)}\n`); fs.fsyncSync(handle); fs.closeSync(handle); const directory = fs.openSync(JOURNAL_ROOT, fs.constants.O_RDONLY); fs.fsyncSync(directory); fs.closeSync(directory); sequence = record.sequence; head = record.recordSha256
    },
    effectApplied: async (id) => observe(manifest, authority, trust).prerequisites[id] === "MATCH",
    apply: async (id) => {
      if (id === "RECONCILE_BOUNDED_IDENTITY") applyIdentity()
      else if (id === "INSTALL_ROOT_LAUNCH_ASSETS") applyAssets(manifest, authority)
      else if (id === "INSTALL_DUAL_STACK_BROKER_BOUNDARY") applyNetwork(authority)
      else if (id === "INSTALL_GITHUB_HOST_AUTH_BOUNDARY") applyGithub(authority)
      else if (id === "RECONCILE_TRUSTED_REPOSITORIES") applyRepositories(manifest, authority)
      else if (id === "INSTALL_PINNED_TOOLCHAIN") applyToolchain(manifest, authority)
      else if (id === "CREATE_DURABLE_LEDGER") applyLedger()
      else if (id === "INSTALL_FORCED_COMMAND_TRANSPORT") applyTransport(authority)
      else fail("STEP_NOT_ALLOWLISTED", "root handoff step differs")
    },
    verify: async () => observe(manifest, authority, trust),
    publishSuccess: async (_payload, journalHeadSha256) => { publishReceipt(manifest, authority, journalHeadSha256) },
  })
}
