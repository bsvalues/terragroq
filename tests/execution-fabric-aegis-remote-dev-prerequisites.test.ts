import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  buildProvisioningPlan,
  inspectProvisioningPackage,
  validateApplyAuthority,
  validateProvisioningManifest,
} from "../scripts/execution-fabric/provision/aegis-remote-dev-prerequisites.mjs"
import { parseBoundedSshCommand } from "../scripts/execution-fabric/provision/aegis-remote-dev-ssh-entrypoint.mjs"

const repoRoot = path.resolve(import.meta.dirname, "..")
const manifestPath = path.join(repoRoot, "config", "execution-fabric", "aegis-remote-dev-prerequisites.json")

function manifest() {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"))
}

function readyObservation() {
  return {
    platform: { os: "linux", distribution: "ubuntu", version: "24.04", effectiveUid: 0 },
    identity: {
      account: "williamos-fabric",
      accountExists: true,
      passwordLocked: true,
      uid: 991,
      primaryGid: 991,
      shell: "/bin/bash",
      sudoCapability: false,
      lingeringUserManager: true,
      machineIdSha256: "1b490fe20bf3d61dc1f14e3a6e7fe38fc7de69c14face211fdd5afd0544c9c8b",
    },
    transport: {
      account: "williamos-fabric",
      sourceHost: "hermes",
      sourceAddress: "192.168.88.9",
      targetHost: "aegis",
      targetAddress: "192.168.88.6",
      forcedCommandPath: "/usr/local/libexec/williamos-aegis-remote-dev-ssh-entrypoint.mjs",
      unrestrictedShellAllowed: false,
      passwordAuthenticationAllowed: false,
      ptyAllowed: false,
      forwardingAllowed: false,
      ownerKeyFingerprint: "SHA256:owner-approved-hermes-transport-key",
      bsUsedForWorkerDispatch: false,
    },
    repositories: {
      controlPlane: {
        path: "/var/lib/williamos-remote-dev/control/terragroq",
        remote: "https://github.com/bsvalues/terragroq.git",
        head: "fea7785fd480d3b5f107c286cc8eb1bac6d04793",
        clean: true,
        remoteMainEqual: true,
      },
      targetMirror: {
        path: "/var/lib/williamos-remote-dev/repositories/terrafusion_os_1.0.git",
        remote: "https://github.com/bsvalues/terrafusion_os_1.0.git",
        commitPresent: "ffd2fa35f5152de2b95e7f63b220050d18193d7a",
        bare: true,
      },
    },
    toolchain: {
      git: "2.43.0",
      node: "22.18.0",
      dotnetSdk: "8.0.423",
      corepack: "0.34.0",
      pnpm: "9.0.0",
      paths: {
        git: "/usr/bin/git",
        node: "/usr/bin/node",
        dotnet: "/usr/bin/dotnet",
        corepack: "/usr/bin/corepack",
        pnpm: "/usr/bin/pnpm",
      },
    },
    storage: {
      mechanism: "LOOPBACK_XFS_PROJECT_QUOTA_V1",
      backingFilesystem: "ext4",
      backingImagePath: "/var/lib/williamos/fabric/aegis-remote-dev-workspaces.xfs",
      backingImageBytes: 107374182400,
      backingImageOwner: "root",
      backingImageGroup: "root",
      backingImageMode: "0600",
      backingImageNlink: 1,
      loopDevice: "/dev/loop0",
      loopDeviceMajorMinor: "7:0",
      loopBackingImagePath: "/var/lib/williamos/fabric/aegis-remote-dev-workspaces.xfs",
      mountSource: "/dev/loop0",
      mountSourceMajorMinor: "7:0",
      mountPath: "/srv/william",
      filesystem: "xfs",
      filesystemUuid: "5744648d-9289-4d4e-ac6a-707e8405a5d6",
      filesystemLabel: "AEGIS_RDEV",
      mountOptions: ["rw", "nosuid", "nodev", "prjquota", "exec"],
      workspaceParent: "/srv/william/workspaces",
      workspaceOwner: "williamos-fabric",
      workspaceMode: "0700",
      workspacePath: "/srv/william/workspaces/WO-TF-REMOTE-DEV-OFFLOAD-001",
      projectId: 734,
      hardLimitBytes: 85899345920,
      hardLimitEnforced: true,
      quotaAccounting: true,
      quotaEnforcement: true,
      projectInherit: true,
      loopbackVerified: true,
      externalDiskUsed: false,
      backupStorageUsed: false,
    },
    network: {
      mechanism: "ROOT_ATTESTED_CGROUP_EGRESS_V1",
      dualStackDefaultDeny: true,
      directNetworkAllowed: false,
      brokerRequired: true,
      brokerEnforced: true,
      atlasDenied: ["192.168.1.156/32", "::ffff:192.168.1.156/128"],
      endpoints: [
        { host: "ssh.github.com", port: 443, operations: ["git-fetch", "git-push"] },
        { host: "api.github.com", port: 443, operations: ["github-pr"] },
        { host: "api.nuget.org", port: 443, operations: ["dotnet-restore"] },
        { host: "globalcdn.nuget.org", port: 443, operations: ["dotnet-restore"] },
      ],
      enforcementGeneration: "8f14e45f-ea7b-4f26-8a13-f39c3f73b1b8",
    },
    github: {
      host: "ssh.github.com",
      port: 443,
      knownHostAlgorithm: "ssh-ed25519",
      knownHostFingerprint: "SHA256:github-published-ed25519-host-key",
      accountKeyFingerprint: "SHA256:owner-approved-github-key",
      batchMode: true,
      strictHostKeyChecking: true,
      repositoryAllowlist: ["bsvalues/terragroq", "bsvalues/terrafusion_os_1.0"],
    },
    rootAssets: {
      signingPrivateKeyPath: "/etc/williamos-fabric/aegis-remote-dev-launch-authority.key",
      signingPublicKeyPath: "/etc/williamos-fabric/aegis-remote-dev-launch-authority.pem",
      signingPrivateKeyMode: "0600",
      signingPublicKeyMode: "0644",
      launcherPath: "/usr/local/libexec/williamos-aegis-remote-dev-network-launcher.mjs",
      launcherMode: "0555",
      networkReceiptPath: "/run/williamos-fabric/aegis-remote-dev-network-proof.json",
      networkReceiptMode: "0444",
      ticketDirectory: "/var/lib/williamos-fabric/remote-dev-launch-tickets",
      ticketDirectoryMode: "3770",
      ticketDirectoryOwner: "root",
      ticketDirectoryGroup: "williamos-fabric",
      ticketDirectoryAppendOnly: true,
      bytesMatchTrustedMain: true,
    },
    ledger: {
      path: "/var/lib/williamos-fabric/remote-dev-ledger",
      owner: "root",
      group: "williamos-fabric",
      mode: "2750",
      durableFilesystem: true,
      atomicPublish: true,
      appendOnlyEvidence: true,
    },
  }
}

describe("AEGIS remote-dev prerequisite package", () => {
  it("binds the moved Hermes source and AEGIS target without widening transport", () => {
    const value = manifest()
    expect(value.transport).toMatchObject({
      sourceHost: "hermes",
      sourceAddress: "192.168.88.9",
      targetHost: "aegis",
      targetAddress: "192.168.88.6",
      passwordAuthenticationAllowed: false,
      ptyAllowed: false,
      forwardingAllowed: false,
      unrestrictedShellAllowed: false,
    })
    for (const [field, stale] of [["sourceAddress", "192.168.1.154"], ["targetAddress", "192.168.1.157"]] as const) {
      const drift = structuredClone(value)
      drift.transport[field] = stale
      expect(() => validateProvisioningManifest(drift)).toThrow()
    }
    const observed = readyObservation()
    observed.transport.targetHost = "not-aegis"
    expect(buildProvisioningPlan(value, observed)).toMatchObject({ status: "BLOCKED", reasonCode: "PREREQUISITE_DRIFT" })
  })
  it("binds the package to the trusted merge, inactive proof scope, and exact audited boundary", () => {
    const value = manifest()

    expect(value.status).toBe("PACKAGE_ONLY_NOT_APPLIED")
    expect(value.executionAuthorized).toBe(false)
    expect(value.trustedMain.commit).toBe("fea7785fd480d3b5f107c286cc8eb1bac6d04793")
    expect(value.proof.workOrderId).toBe("WO-TF-REMOTE-DEV-OFFLOAD-001")
    expect(value.proof.issue).toEqual({ repository: "bsvalues/terrafusion_os_1.0", number: 734 })
    expect(value.proof.activationStatus).toBe("INACTIVE_PENDING_PREREQUISITES")
    expect(value.identity.account).toBe("williamos-fabric")
    expect(value.transport.unrestrictedBsWorkerPathAllowed).toBe(false)
    expect(value.toolchain.dotnetSdk.version).toBe("8.0.423")
    expect(value.toolchain.pnpm.version).toBe("9.0.0")
    expect(value.storage.mechanism).toBe("LOOPBACK_XFS_PROJECT_QUOTA_V1")
    expect(value.storage.backing.imagePath).toBe("/var/lib/williamos/fabric/aegis-remote-dev-workspaces.xfs")
    expect(value.storage.backing.imageBytes).toBe(107374182400)
    expect(value.storage.filesystem.uuid).toBe("5744648d-9289-4d4e-ac6a-707e8405a5d6")
    expect(value.storage.newExternalDiskAuthorized).toBe(false)
    expect(value.storage.backupStorageUseAuthorized).toBe(false)
    expect(value.network.atlas.allowed).toBe(false)
    expect(value.network.endpoints).toEqual(readyObservation().network.endpoints)
    expect(value.bindings.some((entry: { path: string }) => entry.path.endsWith("aegis-remote-dev-prerequisites.mjs"))).toBe(false)
  })

  it("fails closed without a complete observation and never authorizes execution", () => {
    const result = buildProvisioningPlan(manifest(), {})

    expect(result).toMatchObject({
      status: "BLOCKED",
      executionAuthorized: false,
      applyAuthorized: false,
      reasonCode: "PREFLIGHT_EVIDENCE_INCOMPLETE",
    })
    expect(result.mutations).toEqual([])
  })

  it("blocks drift instead of overwriting an existing identity, checkout, or boundary", () => {
    const observed = readyObservation()
    observed.identity.machineIdSha256 = "0".repeat(64)
    observed.transport.account = "bs"
    observed.repositories.controlPlane.head = "1".repeat(40)
    observed.storage.loopDevice = "/dev/sda"
    observed.network.atlasDenied = []

    const result = buildProvisioningPlan(manifest(), observed)

    expect(result.status).toBe("BLOCKED")
    expect(result.reasonCode).toBe("PREREQUISITE_DRIFT")
    expect(result.executionAuthorized).toBe(false)
    expect(result.applyAuthorized).toBe(false)
    expect(result.drift).toEqual(expect.arrayContaining([
      "identity.machineIdSha256",
      "transport.account",
      "repositories.controlPlane.head",
      "storage.loopDevice",
      "network.atlasDenied",
    ]))
    expect(result.mutations).toEqual([])
  })

  it("is idempotent when every exact prerequisite is already present", () => {
    const result = buildProvisioningPlan(manifest(), readyObservation())

    expect(result).toMatchObject({
      status: "READY",
      reasonCode: "PREREQUISITES_ALREADY_MATCH",
      executionAuthorized: false,
      applyAuthorized: false,
    })
    expect(result.mutations).toEqual([])
    expect(result.ownerAuthorityRequired).toBe(true)
  })

  it("requires explicit loopback/quota verification and binds the mount to the same loop object", () => {
    for (const mutate of [
      (value: any) => { delete value.storage.loopbackVerified },
      (value: any) => { delete value.storage.hardLimitEnforced },
      (value: any) => { value.storage.mountSource = "/dev/loop1" },
      (value: any) => { value.storage.mountSourceMajorMinor = "7:1" },
    ]) {
      const observed = readyObservation()
      mutate(observed)
      expect(buildProvisioningPlan(manifest(), observed)).toMatchObject({
        status: "BLOCKED",
        reasonCode: "PREREQUISITE_DRIFT",
        executionAuthorized: false,
        applyAuthorized: false,
      })
    }
  })

  it("returns an exact dry-run mutation plan for absent state without applying it", () => {
    const observed = readyObservation()
    observed.identity.accountExists = false
    observed.transport.ownerKeyFingerprint = null as unknown as string
    observed.repositories.targetMirror.commitPresent = null as unknown as string
    observed.toolchain.dotnetSdk = null as unknown as string
    observed.storage.loopbackVerified = false
    observed.storage.hardLimitEnforced = false
    observed.network.brokerEnforced = false
    observed.github.accountKeyFingerprint = null as unknown as string
    observed.rootAssets.bytesMatchTrustedMain = false
    observed.ledger.durableFilesystem = false

    const result = buildProvisioningPlan(manifest(), observed)

    expect(result.status).toBe("DRY_RUN_REQUIRED")
    expect(result.executionAuthorized).toBe(false)
    expect(result.applyAuthorized).toBe(false)
    expect(result.mutations.map((entry: { id: string }) => entry.id)).toEqual([
      "CREATE_BOUNDED_ACCOUNT",
      "INSTALL_FORCED_COMMAND_TRANSPORT",
      "INSTALL_PINNED_TARGET_MIRROR",
      "INSTALL_PINNED_TOOLCHAIN",
      "VERIFY_LOOPBACK_XFS_PROJECT_QUOTA",
      "INSTALL_DUAL_STACK_BROKER_BOUNDARY",
      "INSTALL_GITHUB_HOST_AUTH_BOUNDARY",
      "INSTALL_ROOT_OWNED_LAUNCH_ASSETS",
      "CREATE_DURABLE_LEDGER",
    ])
  })

  it("treats even an exact proposed owner authority as non-authorizing until a separate live handoff", () => {
    const value = manifest()
    const authority = {
      schemaVersion: 1,
      authorityId: "0f8fad5b-d9cb-469f-a165-70867728950e",
      packageId: value.packageId,
      manifestSha256: inspectProvisioningPackage(repoRoot).manifestSha256,
      machineIdSha256: value.identity.machineIdSha256,
      xfsFilesystemUuid: "5744648d-9289-4d4e-ac6a-707e8405a5d6",
      hermesTransportKeyFingerprint: "SHA256:owner-approved-hermes-transport-key",
      githubAccountKeyFingerprint: "SHA256:owner-approved-github-key",
      issuedAt: "2026-08-11T17:00:00.000Z",
      expiresAt: "2026-08-11T17:15:00.000Z",
      singleUse: true,
      consumed: false,
    }

    expect(validateApplyAuthority(value, authority, "2026-08-11T17:05:00.000Z")).toMatchObject({
      status: "BLOCKED",
      reasonCode: "LIVE_APPLY_OWNER_HANDOFF_REQUIRED",
      applyAuthorized: false,
      executionAuthorized: false,
    })
    expect(validateApplyAuthority(value, { ...authority, consumed: true }, "2026-08-11T17:05:00.000Z")).toMatchObject({
      status: "BLOCKED",
      reasonCode: "OWNER_AUTHORITY_CONSUMED",
    })
    expect(validateApplyAuthority(value, { ...authority, manifestSha256: "0".repeat(64) }, "2026-08-11T17:05:00.000Z")).toMatchObject({
      status: "BLOCKED",
      reasonCode: "OWNER_AUTHORITY_SCOPE_MISMATCH",
    })
    expect(validateApplyAuthority(value, authority, "2026-08-11T17:16:00.000Z")).toMatchObject({
      status: "BLOCKED",
      reasonCode: "OWNER_AUTHORITY_EXPIRED",
    })
  })

  it("checks internal artifact digests without claiming an external trust root", () => {
    const inspection = inspectProvisioningPackage(repoRoot)

    expect(inspection.status).toBe("PACKAGE_INTERNAL_CONSISTENCY_ONLY")
    expect(inspection.reasonCode).toBe("EXTERNAL_TRUST_ROOT_REQUIRED")
    expect(inspection.executionAuthorized).toBe(false)
    expect(inspection.drift).toEqual([])
    expect(inspection.verifiedPaths).toEqual([
      "scripts/execution-fabric/provision/aegis-remote-dev-prerequisites.sh",
      "scripts/execution-fabric/provision/aegis-remote-dev-ssh-entrypoint.mjs",
      "scripts/execution-fabric/live/aegis-remote-dev-network-launcher.mjs",
      "scripts/execution-fabric/live/aegis-resident-network-boundary.mjs",
      "scripts/execution-fabric/live/aegis-remote-dev-worker.sh",
      "config/execution-fabric/aegis-resident-network-boundary.json",
    ])
  })

  it("rejects unknown fields and every activation-critical manifest drift instead of self-attesting it", () => {
    expect(() => validateProvisioningManifest(manifest())).not.toThrow()
    const cases: Array<(value: any) => void> = [
      (value) => { value.unknown = true },
      (value) => { value.toolchain.node.version = "latest" },
      (value) => { value.storage.loop.dynamicDeviceRequired = false },
      (value) => { value.storage.mount.requiredOptions = ["prjquota"] },
      (value) => { value.network.mechanism = "DIRECT_EGRESS" },
      (value) => { value.network.allOtherIpv6Denied = false },
      (value) => { value.network.atlas.ports = "443" },
      (value) => { value.github.strictHostKeyChecking = false },
      (value) => { value.github.repositoryAllowlist.push("attacker/repository") },
      (value) => { value.rootAssets.ticketDirectoryAppendOnly = false },
      (value) => { value.ledger.appendOnlyEvidenceRequired = false },
      (value) => { value.rollback.preserveLedgerEvidence = false },
      (value) => { value.rollback.steps = [] },
      (value) => { value.apply.mutationJournalRequired = false },
    ]

    for (const mutate of cases) {
      const value = manifest()
      mutate(value)
      expect(() => validateProvisioningManifest(value)).toThrow()
    }
  })

  it("keeps rollback bounded to package-managed configuration and preserves durable evidence and data", () => {
    const rollback = manifest().rollback

    expect(rollback).toMatchObject({
      automatic: false,
      ownerAuthorityRequired: true,
      preserveWorkspaceData: true,
      preserveSigningKey: true,
      preserveTicketTombstones: true,
      preserveLedgerEvidence: true,
      neverFormatOrUnmountStorage: true,
    })
    expect(rollback.steps).toEqual([
      "disable-new-dispatch",
      "stop-proof-specific-units",
      "remove-proof-specific-egress-rules",
      "disable-forced-command-key",
      "restore-package-managed-files-from-journal",
      "verify-no-proof-processes",
      "retain-durable-evidence-for-owner-review",
    ])
  })

  it("accepts only the exact forced-command launcher grammar and never a general shell", () => {
    const packet = "eyJydW5JZCI6IjBmOGZhZDViLWQ5Y2ItNDY5Zi1hMTY1LTcwODY3NzI4OTUwZSJ9"
    const accepted = `/usr/bin/node /usr/local/libexec/williamos-aegis-remote-dev-network-launcher.mjs e30= PROVE_PREFLIGHT ${packet} '' 1 null`

    expect(parseBoundedSshCommand(accepted)).toEqual({
      executable: "/usr/bin/node",
      args: [
        "/usr/local/libexec/williamos-aegis-remote-dev-network-launcher.mjs",
        "e30=", "PROVE_PREFLIGHT", packet, "", "1", "null",
      ],
    })
    for (const rejected of [
      "bash -lc id",
      `${accepted}; id`,
      `${accepted}\n/usr/bin/id`,
      accepted.replace("PROVE_PREFLIGHT", "ARBITRARY_COMMAND"),
      accepted.replace(" 1 null", " 4 null"),
      accepted.replace(" null", " deadbeef"),
      accepted.replace(" '' 1 null", " 'cGF0Y2gK';id 1 null"),
    ]) expect(() => parseBoundedSshCommand(rejected)).toThrow()
  })
})
