#!/usr/bin/node
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { canonicalizeJcs } from "../canonical-json.mjs"

const MANIFEST_PATH = "config/execution-fabric/aegis-remote-dev-prerequisites.json"
const SHA256 = /^[a-f0-9]{64}$/
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EXPECTED_MANIFEST_SHA256 = "1fb6fde76456483a34166b67b6b4413d05c9d69261223f2315d2718de64c359c"
const EXPECTED_BINDINGS = Object.freeze([
  "scripts/execution-fabric/provision/aegis-remote-dev-prerequisites.sh",
  "scripts/execution-fabric/provision/aegis-remote-dev-ssh-entrypoint.mjs",
  "scripts/execution-fabric/live/aegis-remote-dev-network-launcher.mjs",
  "scripts/execution-fabric/live/aegis-resident-network-boundary.mjs",
  "scripts/execution-fabric/live/aegis-remote-dev-worker.sh",
  "config/execution-fabric/aegis-resident-network-boundary.json",
  "config/execution-fabric/remote-dev-offload-v1-activation.json",
])

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex")
}

function canonicalDigest(value) {
  return sha256(Buffer.from(canonicalizeJcs(value), "utf8"))
}

function trustedTextDigest(bytes) {
  return sha256(Buffer.from(Buffer.from(bytes).toString("utf8").replace(/\r\n/g, "\n"), "utf8"))
}

function equal(left, right) {
  return canonicalizeJcs(left) === canonicalizeJcs(right)
}

function blocked(reasonCode, detail, drift = []) {
  return {
    status: "BLOCKED",
    reasonCode,
    detail,
    executionAuthorized: false,
    applyAuthorized: false,
    ownerAuthorityRequired: true,
    drift,
    mutations: [],
  }
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("manifest is not an object")
  if (canonicalDigest(manifest) !== EXPECTED_MANIFEST_SHA256) throw new Error("manifest bytes differ from the reviewed package generation")
  if (manifest.schemaVersion !== 1 || manifest.packageId !== "aegis-remote-dev-prerequisites-issue-734-v1") throw new Error("manifest identity differs")
  if (manifest.status !== "PACKAGE_ONLY_NOT_APPLIED" || manifest.executionAuthorized !== false || manifest.ownerAuthorityRequired !== true) throw new Error("manifest posture differs")
  if (!equal(manifest.trustedMain, { repository: "bsvalues/terragroq", ref: "refs/heads/main", commit: "fea7785fd480d3b5f107c286cc8eb1bac6d04793" })) throw new Error("trusted main differs")
  if (manifest.proof?.workOrderId !== "WO-TF-REMOTE-DEV-OFFLOAD-001" || manifest.proof?.issue?.repository !== "bsvalues/terrafusion_os_1.0" || manifest.proof?.issue?.number !== 734
    || manifest.proof?.activationStatus !== "INACTIVE_PENDING_PREREQUISITES" || manifest.proof?.generalSchedulerEnabled !== false || manifest.proof?.standingAegisAuthorityEnabled !== false) throw new Error("proof scope differs")
  if (manifest.identity?.account !== "williamos-fabric" || manifest.identity?.privilege !== "non-root-no-sudo" || manifest.identity?.machineIdSha256 !== "1b490fe20bf3d61dc1f14e3a6e7fe38fc7de69c14face211fdd5afd0544c9c8b") throw new Error("identity scope differs")
  if (manifest.transport?.account !== "williamos-fabric" || manifest.transport?.sourceHost !== "hermes" || manifest.transport?.sourceAddress !== "192.168.1.154"
    || manifest.transport?.unrestrictedBsWorkerPathAllowed !== false || manifest.transport?.unrestrictedShellAllowed !== false || manifest.transport?.passwordAuthenticationAllowed !== false
    || manifest.transport?.ptyAllowed !== false || manifest.transport?.forwardingAllowed !== false) throw new Error("transport boundary differs")
  const storage = {
    mechanism: "LOOPBACK_XFS_PROJECT_QUOTA_V1",
    backing: {
      hostFilesystem: "ext4",
      imagePath: "/var/lib/williamos/fabric/aegis-remote-dev-workspaces.xfs",
      imageBytes: 107_374_182_400,
      owner: "root",
      group: "root",
      mode: "0600",
      nlink: 1,
      externalDiskUsed: false,
      backupStorageUsed: false,
    },
    loop: {
      dynamicDeviceRequired: true,
      observedDevice: "/dev/loop0",
      observedMajorMinor: "7:0",
      backingImagePath: "/var/lib/williamos/fabric/aegis-remote-dev-workspaces.xfs",
    },
    filesystem: { type: "xfs", uuid: "5744648d-9289-4d4e-ac6a-707e8405a5d6", label: "AEGIS_RDEV" },
    mount: { path: "/srv/william", observedSource: "/dev/loop0", observedSourceMajorMinor: "7:0", requiredOptions: ["rw", "nosuid", "nodev", "prjquota", "exec"] },
    workspaceParent: { path: "/srv/william/workspaces", owner: "williamos-fabric", mode: "0700" },
    workspacePath: "/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001",
    projectQuota: { projectId: 734, inheritFlag: "P", accounting: true, enforcement: true, hardLimitBytes: 85_899_345_920, hardLimitKiB: 83_886_080 },
    formatExistingBlockDeviceAuthorized: false,
    newExternalDiskAuthorized: false,
    backupStorageUseAuthorized: false,
    furtherLiveMutationAuthorized: false,
  }
  if (!equal(manifest.storage, storage)) throw new Error("storage boundary differs")
  const endpoints = [
    { host: "ssh.github.com", port: 443, operations: ["git-fetch", "git-push"] },
    { host: "api.github.com", port: 443, operations: ["github-pr"] },
    { host: "api.nuget.org", port: 443, operations: ["dotnet-restore"] },
    { host: "globalcdn.nuget.org", port: 443, operations: ["dotnet-restore"] },
  ]
  if (manifest.network?.dualStackDefaultDeny !== true || manifest.network?.directNetworkAllowed !== false || manifest.network?.brokerRequired !== true
    || manifest.network?.atlas?.allowed !== false || !equal(manifest.network?.atlas?.addresses, ["192.168.1.156/32", "::ffff:192.168.1.156/128"])
    || !equal(manifest.network?.endpoints, endpoints)) throw new Error("network boundary differs")
  if (manifest.apply?.defaultMode !== "DRY_RUN" || manifest.apply?.liveApplyAuthorized !== false || manifest.apply?.consumeAuthorityBeforeFirstMutation !== true
    || manifest.rollback?.automatic !== false || manifest.rollback?.ownerAuthorityRequired !== true) throw new Error("apply or rollback posture differs")
  if (!Array.isArray(manifest.bindings) || !equal(manifest.bindings.map((entry) => entry.path), EXPECTED_BINDINGS)) throw new Error("package bindings differ")
  return manifest
}

export function validateProvisioningManifest(manifest) {
  return validateManifest(structuredClone(manifest))
}

export function inspectProvisioningPackage(repoRoot) {
  try {
    const manifestBytes = fs.readFileSync(path.join(repoRoot, MANIFEST_PATH))
    const manifest = validateManifest(JSON.parse(manifestBytes.toString("utf8")))
    const drift = []
    for (const binding of manifest.bindings) {
      if (!SHA256.test(binding.sha256)) {
        drift.push(binding.path)
        continue
      }
      const fullPath = path.resolve(repoRoot, binding.path)
      if (!fullPath.startsWith(`${path.resolve(repoRoot)}${path.sep}`)) {
        drift.push(binding.path)
        continue
      }
      let actual
      try { actual = trustedTextDigest(fs.readFileSync(fullPath)) } catch { actual = null }
      if (actual !== binding.sha256) drift.push(binding.path)
    }
    if (drift.length) return { status: "BLOCKED", reasonCode: "PACKAGE_BINDING_DRIFT", executionAuthorized: false, manifestSha256: canonicalDigest(manifest), verifiedPaths: [], drift }
    return { status: "PACKAGE_INTERNAL_CONSISTENCY_ONLY", reasonCode: "EXTERNAL_TRUST_ROOT_REQUIRED", executionAuthorized: false, applyAuthorized: false, manifestSha256: canonicalDigest(manifest), verifiedPaths: [...EXPECTED_BINDINGS], drift: [] }
  } catch (error) {
    return { status: "BLOCKED", reasonCode: "PACKAGE_INVALID", executionAuthorized: false, manifestSha256: null, verifiedPaths: [], drift: [], detail: String(error?.message ?? error) }
  }
}

function requireSections(observed) {
  return ["platform", "identity", "transport", "repositories", "toolchain", "storage", "network", "github", "rootAssets", "ledger"].filter((key) => !observed || typeof observed[key] !== "object" || observed[key] === null)
}

export function buildProvisioningPlan(rawManifest, observed) {
  let manifest
  try { manifest = validateManifest(structuredClone(rawManifest)) } catch (error) { return blocked("PACKAGE_INVALID", String(error?.message ?? error)) }
  const missingSections = requireSections(observed)
  if (missingSections.length) return blocked("PREFLIGHT_EVIDENCE_INCOMPLETE", `missing observation sections: ${missingSections.join(",")}`)

  const drift = []
  const mutations = []
  const check = (name, actual, expected) => { if (!equal(actual, expected)) drift.push(name) }
  const planIf = (condition, id, detail) => { if (condition) mutations.push({ id, detail }) }

  check("platform", observed.platform, { os: "linux", distribution: "ubuntu", version: "24.04", effectiveUid: 0 })
  check("identity.account", observed.identity.account, manifest.identity.account)
  check("identity.passwordLocked", observed.identity.passwordLocked, true)
  check("identity.shell", observed.identity.shell, "/bin/bash")
  check("identity.sudoCapability", observed.identity.sudoCapability, false)
  check("identity.lingeringUserManager", observed.identity.lingeringUserManager, true)
  check("identity.machineIdSha256", observed.identity.machineIdSha256, manifest.identity.machineIdSha256)
  if (!Number.isSafeInteger(observed.identity.uid) || observed.identity.uid <= 0) drift.push("identity.uid")
  if (!Number.isSafeInteger(observed.identity.primaryGid) || observed.identity.primaryGid <= 0) drift.push("identity.primaryGid")
  planIf(observed.identity.accountExists === false, "CREATE_BOUNDED_ACCOUNT", "create locked non-root no-sudo williamos-fabric identity and user manager")

  check("transport.account", observed.transport.account, manifest.transport.account)
  check("transport.sourceHost", observed.transport.sourceHost, manifest.transport.sourceHost)
  check("transport.sourceAddress", observed.transport.sourceAddress, manifest.transport.sourceAddress)
  check("transport.forcedCommandPath", observed.transport.forcedCommandPath, manifest.transport.forcedCommandPath)
  check("transport.unrestrictedShellAllowed", observed.transport.unrestrictedShellAllowed, false)
  check("transport.passwordAuthenticationAllowed", observed.transport.passwordAuthenticationAllowed, false)
  check("transport.ptyAllowed", observed.transport.ptyAllowed, false)
  check("transport.forwardingAllowed", observed.transport.forwardingAllowed, false)
  check("transport.bsUsedForWorkerDispatch", observed.transport.bsUsedForWorkerDispatch, false)
  planIf(!observed.transport.ownerKeyFingerprint, "INSTALL_FORCED_COMMAND_TRANSPORT", "install owner-approved Hermes key as a restrict forced-command entry")
  if (observed.transport.ownerKeyFingerprint && observed.transport.ownerKeyFingerprint !== manifest.transport.ownerKeyFingerprint) drift.push("transport.ownerKeyFingerprint")

  const control = observed.repositories.controlPlane
  const target = observed.repositories.targetMirror
  check("repositories.controlPlane.path", control?.path, manifest.repositories.controlPlane.path)
  check("repositories.controlPlane.remote", control?.remote, manifest.repositories.controlPlane.remote)
  check("repositories.controlPlane.head", control?.head, manifest.repositories.controlPlane.commit)
  check("repositories.controlPlane.clean", control?.clean, true)
  check("repositories.controlPlane.remoteMainEqual", control?.remoteMainEqual, true)
  check("repositories.targetMirror.path", target?.path, manifest.repositories.targetMirror.path)
  check("repositories.targetMirror.remote", target?.remote, manifest.repositories.targetMirror.remote)
  check("repositories.targetMirror.bare", target?.bare, true)
  planIf(!target?.commitPresent, "INSTALL_PINNED_TARGET_MIRROR", "create/update the bare target mirror and prove the pinned proof base")
  if (target?.commitPresent && target.commitPresent !== manifest.repositories.targetMirror.proofBaseCommit) drift.push("repositories.targetMirror.commitPresent")

  const expectedPaths = Object.fromEntries(Object.entries(manifest.toolchain).map(([key, value]) => [key === "dotnetSdk" ? "dotnet" : key, value.path]))
  check("toolchain.git", observed.toolchain.git, manifest.toolchain.git.version)
  check("toolchain.node", observed.toolchain.node, manifest.toolchain.node.version)
  check("toolchain.corepack", observed.toolchain.corepack, manifest.toolchain.corepack.version)
  check("toolchain.pnpm", observed.toolchain.pnpm, manifest.toolchain.pnpm.version)
  check("toolchain.paths", observed.toolchain.paths, expectedPaths)
  planIf(!observed.toolchain.dotnetSdk, "INSTALL_PINNED_TOOLCHAIN", "install the exact reviewed Node/.NET/Corepack/pnpm toolchain")
  if (observed.toolchain.dotnetSdk && observed.toolchain.dotnetSdk !== manifest.toolchain.dotnetSdk.version) drift.push("toolchain.dotnetSdk")

  check("storage.mechanism", observed.storage.mechanism, manifest.storage.mechanism)
  check("storage.backingFilesystem", observed.storage.backingFilesystem, manifest.storage.backing.hostFilesystem)
  check("storage.backingImagePath", observed.storage.backingImagePath, manifest.storage.backing.imagePath)
  check("storage.backingImageBytes", observed.storage.backingImageBytes, manifest.storage.backing.imageBytes)
  check("storage.backingImageOwner", observed.storage.backingImageOwner, manifest.storage.backing.owner)
  check("storage.backingImageGroup", observed.storage.backingImageGroup, manifest.storage.backing.group)
  check("storage.backingImageMode", observed.storage.backingImageMode, manifest.storage.backing.mode)
  check("storage.backingImageNlink", observed.storage.backingImageNlink, manifest.storage.backing.nlink)
  if (!/^\/dev\/loop[0-9]+$/.test(observed.storage.loopDevice ?? "")) drift.push("storage.loopDevice")
  if (!/^[0-9]+:[0-9]+$/.test(observed.storage.loopDeviceMajorMinor ?? "")) drift.push("storage.loopDeviceMajorMinor")
  check("storage.loopBackingImagePath", observed.storage.loopBackingImagePath, manifest.storage.loop.backingImagePath)
  check("storage.mountSource", observed.storage.mountSource, observed.storage.loopDevice)
  check("storage.mountSourceMajorMinor", observed.storage.mountSourceMajorMinor, observed.storage.loopDeviceMajorMinor)
  check("storage.mountPath", observed.storage.mountPath, manifest.storage.mount.path)
  check("storage.filesystem", observed.storage.filesystem, manifest.storage.filesystem.type)
  check("storage.filesystemUuid", observed.storage.filesystemUuid, manifest.storage.filesystem.uuid)
  check("storage.filesystemLabel", observed.storage.filesystemLabel, manifest.storage.filesystem.label)
  check("storage.mountOptions", [...(observed.storage.mountOptions ?? [])].sort(), [...manifest.storage.mount.requiredOptions].sort())
  check("storage.workspaceParent", observed.storage.workspaceParent, manifest.storage.workspaceParent.path)
  check("storage.workspaceOwner", observed.storage.workspaceOwner, manifest.storage.workspaceParent.owner)
  check("storage.workspaceMode", observed.storage.workspaceMode, manifest.storage.workspaceParent.mode)
  check("storage.workspacePath", observed.storage.workspacePath, manifest.storage.workspacePath)
  check("storage.projectId", observed.storage.projectId, manifest.storage.projectQuota.projectId)
  check("storage.hardLimitBytes", observed.storage.hardLimitBytes, manifest.storage.projectQuota.hardLimitBytes)
  check("storage.quotaAccounting", observed.storage.quotaAccounting, manifest.storage.projectQuota.accounting)
  check("storage.quotaEnforcement", observed.storage.quotaEnforcement, manifest.storage.projectQuota.enforcement)
  check("storage.projectInherit", observed.storage.projectInherit, true)
  check("storage.externalDiskUsed", observed.storage.externalDiskUsed, false)
  check("storage.backupStorageUsed", observed.storage.backupStorageUsed, false)
  if (typeof observed.storage.loopbackVerified !== "boolean") drift.push("storage.loopbackVerified")
  if (typeof observed.storage.hardLimitEnforced !== "boolean") drift.push("storage.hardLimitEnforced")
  planIf(observed.storage.loopbackVerified === false || observed.storage.hardLimitEnforced === false,
    "VERIFY_LOOPBACK_XFS_PROJECT_QUOTA", "verify the existing 100 GiB loopback XFS and exact project 734 80 GiB hard limit; do not format, remount, or allocate storage")

  check("network.mechanism", observed.network.mechanism, manifest.network.mechanism)
  check("network.dualStackDefaultDeny", observed.network.dualStackDefaultDeny, true)
  check("network.directNetworkAllowed", observed.network.directNetworkAllowed, false)
  check("network.brokerRequired", observed.network.brokerRequired, true)
  check("network.atlasDenied", observed.network.atlasDenied, manifest.network.atlas.addresses)
  check("network.endpoints", observed.network.endpoints, manifest.network.endpoints)
  if (observed.network.enforcementGeneration && !GUID.test(observed.network.enforcementGeneration)) drift.push("network.enforcementGeneration")
  planIf(observed.network.brokerEnforced === false, "INSTALL_DUAL_STACK_BROKER_BOUNDARY", "install the root-attested cgroup broker boundary and exact default-deny policy")

  check("github.host", observed.github.host, manifest.github.sshHost)
  check("github.port", observed.github.port, manifest.github.sshPort)
  check("github.knownHostAlgorithm", observed.github.knownHostAlgorithm, manifest.github.knownHostAlgorithm)
  check("github.knownHostFingerprint", observed.github.knownHostFingerprint, manifest.github.knownHostFingerprint)
  check("github.batchMode", observed.github.batchMode, true)
  check("github.strictHostKeyChecking", observed.github.strictHostKeyChecking, true)
  check("github.repositoryAllowlist", observed.github.repositoryAllowlist, manifest.github.repositoryAllowlist)
  planIf(!observed.github.accountKeyFingerprint, "INSTALL_GITHUB_HOST_AUTH_BOUNDARY", "install owner-approved GitHub account key and pinned ssh.github.com:443 host trust")
  if (observed.github.accountKeyFingerprint && observed.github.accountKeyFingerprint !== manifest.github.accountKeyFingerprint) drift.push("github.accountKeyFingerprint")

  const expectedAssets = {
    signingPrivateKeyPath: manifest.rootAssets.signingPrivateKeyPath,
    signingPublicKeyPath: manifest.rootAssets.signingPublicKeyPath,
    signingPrivateKeyMode: manifest.rootAssets.signingPrivateKeyMode,
    signingPublicKeyMode: manifest.rootAssets.signingPublicKeyMode,
    launcherPath: manifest.rootAssets.launcherPath,
    launcherMode: manifest.rootAssets.launcherMode,
    networkReceiptPath: manifest.rootAssets.networkReceiptPath,
    networkReceiptMode: manifest.rootAssets.networkReceiptMode,
    ticketDirectory: manifest.rootAssets.ticketDirectory,
    ticketDirectoryMode: manifest.rootAssets.ticketDirectoryMode,
    ticketDirectoryOwner: "root",
    ticketDirectoryGroup: "williamos-fabric",
    ticketDirectoryAppendOnly: true,
  }
  for (const [key, expected] of Object.entries(expectedAssets)) check(`rootAssets.${key}`, observed.rootAssets[key], expected)
  planIf(observed.rootAssets.bytesMatchTrustedMain === false, "INSTALL_ROOT_OWNED_LAUNCH_ASSETS", "install exact trusted-main launcher/provider/key/slice/receipt/ticket assets")

  check("ledger.path", observed.ledger.path, manifest.ledger.path)
  check("ledger.owner", observed.ledger.owner, manifest.ledger.owner)
  check("ledger.group", observed.ledger.group, manifest.ledger.group)
  check("ledger.mode", observed.ledger.mode, manifest.ledger.mode)
  check("ledger.atomicPublish", observed.ledger.atomicPublish, true)
  check("ledger.appendOnlyEvidence", observed.ledger.appendOnlyEvidence, true)
  planIf(observed.ledger.durableFilesystem === false, "CREATE_DURABLE_LEDGER", "create the durable root-owned evidence ledger")

  if (drift.length) return blocked("PREREQUISITE_DRIFT", "existing prerequisite state differs; overwrite is refused", [...new Set(drift)].sort())
  if (mutations.length) return { status: "DRY_RUN_REQUIRED", reasonCode: "OWNER_AUTHORITY_REQUIRED", executionAuthorized: false, applyAuthorized: false, ownerAuthorityRequired: true, drift: [], mutations }
  return { status: "READY", reasonCode: "PREREQUISITES_ALREADY_MATCH", executionAuthorized: false, applyAuthorized: false, ownerAuthorityRequired: true, drift: [], mutations: [] }
}

export function validateApplyAuthority(rawManifest, authority, now) {
  let manifest
  try { manifest = validateManifest(structuredClone(rawManifest)) } catch (error) { return blocked("PACKAGE_INVALID", String(error?.message ?? error)) }
  if (!authority || typeof authority !== "object" || !GUID.test(authority.authorityId ?? "") || authority.schemaVersion !== 1 || authority.singleUse !== true) return blocked("OWNER_AUTHORITY_INVALID", "owner authority format differs")
  if (authority.consumed === true) return blocked("OWNER_AUTHORITY_CONSUMED", "owner authority was already consumed")
  const expected = {
    packageId: manifest.packageId,
    manifestSha256: canonicalDigest(manifest),
    machineIdSha256: manifest.identity.machineIdSha256,
    hermesTransportKeyFingerprint: manifest.transport.ownerKeyFingerprint,
    githubAccountKeyFingerprint: manifest.github.accountKeyFingerprint,
  }
  for (const [key, value] of Object.entries(expected)) if (authority[key] !== value) return blocked("OWNER_AUTHORITY_SCOPE_MISMATCH", `owner authority ${key} differs`)
  if (authority.xfsFilesystemUuid !== manifest.storage.filesystem.uuid) return blocked("OWNER_AUTHORITY_SCOPE_MISMATCH", "owner authority XFS UUID differs")
  const issued = Date.parse(authority.issuedAt)
  const expires = Date.parse(authority.expiresAt)
  const current = Date.parse(now)
  if (![issued, expires, current].every(Number.isFinite) || expires - issued !== 900_000 || current < issued || current >= expires) return blocked("OWNER_AUTHORITY_EXPIRED", "owner authority is outside its exact 15-minute window")
  return blocked("LIVE_APPLY_OWNER_HANDOFF_REQUIRED", "the package can validate scope but cannot authorize or perform live mutation")
}

function cli() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
  const [command = "inspect", argument] = process.argv.slice(2)
  if (command === "inspect") {
    const result = inspectProvisioningPackage(repoRoot)
    process.stdout.write(`${JSON.stringify(result)}\n`)
    process.exitCode = 2
    return
  }
  if (command === "dry-run" && argument) {
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, MANIFEST_PATH), "utf8"))
    const observed = JSON.parse(fs.readFileSync(path.resolve(argument), "utf8"))
    const result = buildProvisioningPlan(manifest, observed)
    process.stdout.write(`${JSON.stringify(result)}\n`)
    process.exitCode = result.status === "READY" || result.status === "DRY_RUN_REQUIRED" ? 0 : 2
    return
  }
  process.stdout.write(`${JSON.stringify(blocked("USAGE_INVALID", "use inspect or dry-run <observation.json>"))}\n`)
  process.exitCode = 64
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli()
