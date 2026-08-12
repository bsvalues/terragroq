import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { spawn, spawnSync } from "node:child_process"

import { describe, expect, it, vi } from "vitest"

import {
  AUTHORITY_ROOT,
  AUTHORIZED_KEYS_ROOT,
  CONFIG_PATH,
  HOME_KEY_PATH,
  INSTALLER_PATH,
  KERNEL_LOCK_PATH,
  LAUNCHER_PATH,
  JOURNAL_PREFIX,
  LOCK_PATH,
  MANIFEST_PATH,
  REMOTE_DEV_KEY_PATH,
  REVIEWED_CONFIG_ASSET,
  RESERVATION_LOCK_PATHS,
  STANDING_ENTRYPOINT_PATH,
  STANDING_ROOT_KEY_PATH,
  canonicalizeRepairJcs,
  main,
  repairAegisSshCoexistence,
  recordRecoverySshProof,
  inspectSshSessionEvidence,
  sshCoexistenceRepairErrorEvidence,
  validateAegisSshCoexistenceRepairManifest,
} from "../scripts/execution-fabric/provision/repair-aegis-ssh-coexistence.mjs"

const root = path.resolve(import.meta.dirname, "..")
const liveManifestBytes = fs.readFileSync(path.join(root, MANIFEST_PATH))
const liveManifest = JSON.parse(liveManifestBytes.toString("utf8"))
const assetBytes = fs.readFileSync(path.join(root, REVIEWED_CONFIG_ASSET))
const installerBytes = fs.readFileSync(path.join(root, INSTALLER_PATH))
const launcherBytes = fs.readFileSync(path.join(root, LAUNCHER_PATH))
const AUTHORITY_ID = "11111111-1111-4111-8111-111111111111"
const NOW = "2026-08-12T20:05:00.000Z"

type Entry = { type: "file" | "directory", bytes?: Buffer, uid: number, gid: number, mode: number,
  direct: boolean, nlink: number }
type Options = {
  platform?: string, euid?: number, hostname?: string, machine?: string, accountDrift?: boolean,
  predecessorBytes?: Buffer, predecessorMode?: number, standingBytes?: Buffer, standingMode?: number,
  occupiedPath?: string, activeRemoteDev?: boolean, authorityExpired?: boolean, authorityConsumed?: boolean,
  failStage?: boolean, failMutation?: string, failAfterMutation?: string, failLive?: boolean,
  failEffective?: boolean, failRollback?: "config" | "key", foreignKeyOnFailure?: boolean,
  failReleaseLock?: boolean, failCommittedJournal?: boolean, authProof?: boolean, prepositionAuthProof?: boolean,
  inactiveAfterMutation?: boolean, entrypointMode?: number, failAcquirePath?: string,
  kernelLockHeld?: boolean, activeWorker?: boolean, untrustedParents?: boolean,
  sourceChangesDuringRead?: boolean,
  authorizedKeysDirectory?: "exact" | "wrong-mode" | "file", failDirectoryRemoval?: boolean,
  daemonDrift?: boolean,
  missingReloadEvidence?: boolean,
  failAfterProofIntent?: boolean, failAfterProofCreate?: boolean,
}

const sha256 = (bytes: Buffer | string) => crypto.createHash("sha256").update(bytes).digest("hex")
const recordBytes = (value: unknown) => Buffer.from(`${canonicalizeRepairJcs(value)}\n`, "utf8")

function standingBytes() {
  return Buffer.from(
    'restrict,from="192.168.88.9",command="/usr/local/libexec/williamos/aegis-standing-hash-ssh-entrypoint.mjs",no-agent-forwarding,no-port-forwarding,no-X11-forwarding,no-pty,no-user-rc ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBmJhq4P/5J2slHqQ06b2KX8K6B0+Q6l6v7EoZ1WlWVy\n',
    "utf8",
  )
}

const fixtureStandingBytes = standingBytes()
const fixtureBlob = Buffer.from(fixtureStandingBytes.toString("utf8").trim().split(" ").at(-1)!, "base64")
const fixtureStandingBinding = {
  recordSha256: sha256(fixtureStandingBytes),
  fingerprint: `SHA256:${crypto.createHash("sha256").update(fixtureBlob).digest("base64").replace(/=+$/, "")}`,
}
const manifest = structuredClone(liveManifest)
manifest.standingKey.recordSha256 = fixtureStandingBinding.recordSha256
manifest.standingKey.fingerprint = fixtureStandingBinding.fingerprint
const fixtureEntrypointBytes = Buffer.from("fixture standing entrypoint\n")
manifest.standingEntrypoint.sha256 = sha256(fixtureEntrypointBytes)
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8")

function fixture(options: Options = {}) {
  const entries = new Map<string, Entry>()
  const events: string[] = []
  const injected = new Set<string>()
  const file = (target: string, bytes: Buffer, uid: number, gid: number, mode: number) => entries.set(target,
    { type: "file", bytes: Buffer.from(bytes), uid, gid, mode, direct: true, nlink: 1 })
  const directory = (target: string, uid: number, gid: number, mode: number) => entries.set(target,
    { type: "directory", uid, gid, mode, direct: true, nlink: 1 })
  const predecessor = options.predecessorBytes ?? Buffer.from(manifest.predecessor.configBase64, "base64")
  file(CONFIG_PATH, predecessor, 0, 0, options.predecessorMode ?? 0o444)
  file(HOME_KEY_PATH, options.standingBytes ?? standingBytes(), 999, 987, options.standingMode ?? 0o600)
  file(STANDING_ENTRYPOINT_PATH, fixtureEntrypointBytes, 0, 0, options.entrypointMode ?? 0o555)
  directory(manifest.inactivity.ticketDirectory, 0, 987, 0o3770)
  if (options.authorizedKeysDirectory === "exact") directory(AUTHORIZED_KEYS_ROOT, 0, 0, 0o755)
  if (options.authorizedKeysDirectory === "wrong-mode") directory(AUTHORIZED_KEYS_ROOT, 0, 0, 0o777)
  if (options.authorizedKeysDirectory === "file") file(AUTHORIZED_KEYS_ROOT, Buffer.from("occupied\n"), 0, 0, 0o755)
  if (options.occupiedPath) file(options.occupiedPath, Buffer.from("foreign\n"), 0, 0, 0o444)

  const authority = {
    schemaVersion: 1, authorityId: AUTHORITY_ID, repairId: manifest.repairId,
    manifestSha256: sha256(manifestBytes), machineIdSha256: manifest.identity.machineIdSha256,
    predecessorConfigSha256: manifest.predecessor.sha256,
    standingAuthorizedKeySha256: manifest.standingKey.recordSha256,
    standingEntrypointSha256: manifest.standingEntrypoint.sha256,
    reviewedConfigSha256: manifest.reviewedConfig.sha256, installerSha256: manifest.installer.sha256,
    launcherSha256: manifest.launcher.sha256,
    issuedAt: options.authorityExpired ? "2026-08-12T19:00:00.000Z" : "2026-08-12T20:00:00.000Z",
    expiresAt: options.authorityExpired ? "2026-08-12T19:10:00.000Z" : "2026-08-12T20:10:00.000Z",
    singleUse: true, consumed: false,
  }
  const journalPath = `${JOURNAL_PREFIX}${AUTHORITY_ID}.journal.jsonl`
  const proofPath = `${manifest.authProof.root}/${AUTHORITY_ID}.json`
  let clockTick = 0
  const nextTime = () => new Date(Date.parse(NOW) + clockTick++ * 1000).toISOString()
  const maybeFail = (name: string) => {
    if (options.failMutation === name && !injected.has(`before:${name}`)) {
      injected.add(`before:${name}`)
      throw Object.assign(new Error(`injected ${name}`), { code: "INJECTED_FAILURE" })
    }
  }
  const after = (name: string) => {
    if (options.failAfterMutation === name && !injected.has(`after:${name}`)) {
      injected.add(`after:${name}`)
      throw Object.assign(new Error(`injected post ${name}`), { code: "INJECTED_POST_FAILURE" })
    }
  }
  const effective = [
    "passwordauthentication no", "kbdinteractiveauthentication no", "hostbasedauthentication no",
    "pubkeyauthentication yes", "authenticationmethods publickey", "forcecommand none",
    "allowagentforwarding no", "allowtcpforwarding no", "x11forwarding no", "permittty no",
    "permittunnel no", "gatewayports no", "permituserenvironment no", "permituserrc no",
    `authorizedkeysfile ${REMOTE_DEV_KEY_PATH} ${STANDING_ROOT_KEY_PATH}`,
    "authorizedkeyscommand none", "authorizedprincipalscommand none", "trustedusercakeys none",
  ].join("\n")
  const io = {
    platform: () => options.platform ?? "linux",
    euid: () => options.euid ?? 0,
    hostname: () => options.hostname ?? "aegis",
    inspect: (target: string) => {
      const entry = entries.get(target)
      return entry ? { type: entry.type, uid: entry.uid, gid: entry.gid, mode: entry.mode,
        direct: entry.direct, nlink: entry.nlink } : null
    },
    read: (target: string) => {
      const entry = entries.get(target)
      if (!entry?.bytes) throw Object.assign(new Error(`missing ${target}`), { code: "ENOENT" })
      return Buffer.from(entry.bytes)
    },
    readStable: (target: string, expected: { uid: number, gid: number, mode: number }, code = "AEGIS_SSH_REPAIR_AUTHORITY_FILE_UNTRUSTED") => {
      const entry = entries.get(target)
      if (!entry?.bytes || entry.uid !== expected.uid || entry.gid !== expected.gid || entry.mode !== expected.mode || !entry.direct || entry.nlink !== 1) throw Object.assign(new Error("unstable file"), { code })
      const bytes = Buffer.from(entry.bytes)
      if (options.sourceChangesDuringRead && target === HOME_KEY_PATH) {
        entry.bytes = Buffer.from("changed during read\n")
        throw Object.assign(new Error("changed during read"), { code })
      }
      return bytes
    },
    account: () => options.accountDrift
      ? { uid: 734, gid: 734, home: "/tmp", shell: "/bin/bash" }
      : { uid: 999, gid: 987, home: "/var/empty/williamos-fabric", shell: "/bin/bash" },
    parentsTrusted: () => !options.untrustedParents,
    kernelLockHeld: () => options.kernelLockHeld !== false,
    remoteDevInactive: () => !options.activeRemoteDev && !(options.inactiveAfterMutation && entries.has(STANDING_ROOT_KEY_PATH)),
    workerUnitsInactive: () => !options.activeWorker,
    validateStagedSshd: (asset: string) => {
      events.push("VALIDATE_STAGED_SSHD")
      if (!path.isAbsolute(asset)) throw Object.assign(new Error("relative staged config"), { code: "RELATIVE_STAGED_CONFIG" })
      if (options.failStage) throw Object.assign(new Error("staged invalid"), { code: "STAGED_INVALID" })
    },
    validateLiveSshd: () => {
      events.push("VALIDATE_LIVE_SSHD")
      if (options.failLive && !injected.has("live")) {
        injected.add("live")
        if (options.foreignKeyOnFailure) file(STANDING_ROOT_KEY_PATH, Buffer.from("foreign\n"), 0, 0, 0o444)
        throw Object.assign(new Error("live invalid"), { code: "LIVE_INVALID" })
      }
    },
    reloadSshd: () => { events.push("RELOAD_SSHD") },
    effectiveSshd: (address: string) => {
      events.push(`EFFECTIVE_SSHD:${address}`)
      return options.failEffective ? effective.replace("forcecommand none", "forcecommand /bin/sh") : effective
    },
    standingAuthProof: (_target: string, challenge: { challenge_nonce: string, challenge_issued_at: string }) => options.authProof === false ? null : ({
      schemaVersion: 2, authorityId: AUTHORITY_ID, repairId: manifest.repairId,
      result: manifest.authProof.result, sourceAddress: manifest.authProof.sourceAddress,
      standingKeySha256: manifest.standingKey.recordSha256,
      standingEntrypointSha256: manifest.standingEntrypoint.sha256,
      reviewedConfigSha256: manifest.reviewedConfig.sha256,
      challengeNonce: challenge.challenge_nonce,
      challengeIssuedAt: challenge.challenge_issued_at,
      authenticatedAt: new Date(Date.parse(challenge.challenge_issued_at) + 1).toISOString(),
    }),
    sshDaemonIdentity: () => options.daemonDrift
      ? { mainPid: 4322, startTimestampMonotonic: "987654322" }
      : { mainPid: 4321, startTimestampMonotonic: "987654321" },
    sshReloadEvidence: (_target: string, daemon: any) => {
      if (options.missingReloadEvidence) throw Object.assign(new Error("reload absent"), { code: "AEGIS_SSH_REPAIR_RELOAD_EVIDENCE_INVALID" })
      return { daemonIdentity: daemon, configCtime: "2026-08-12T16:40:18.000Z",
        reloadAt: "2026-08-12T16:40:18.305Z", ipv4ListeningAt: "2026-08-12T16:40:18.324Z",
        ipv6ListeningAt: "2026-08-12T16:40:18.325Z" }
    },
    sshSessionEvidence: () => ({ sourceAddress: "192.168.88.9", sourcePort: 42123,
      targetAddress: "192.168.88.6", targetPort: 22, socketInode: "173400", loginUid: 1000, auditSessionId: 734,
      sshdAncestorPid: 4000, sshdAncestorStartTimeTicks: "987650000",
      sshdAncestorCmdlineSha256: "a".repeat(64) }),
    recoveryAuthProof: (target: string) => {
      const entry = entries.get(target)
      return entry?.bytes ? JSON.parse(entry.bytes.toString("utf8")) : null
    },
    acquireLock: (target: string, bytes: Buffer, uid: number, gid: number, mode: number, resume: boolean) => {
      if (options.failAcquirePath === target) throw Object.assign(new Error("reservation busy"), { code: "LOCK_OCCUPIED" })
      if (entries.has(target)) {
        const current = entries.get(target)
        if (resume && current?.bytes?.equals(bytes) && current.uid === uid && current.gid === gid && current.mode === mode && current.direct && current.nlink === 1) return
        throw Object.assign(new Error("lock occupied"), { code: "LOCK_OCCUPIED" })
      }
      events.push(`LOCK_ACQUIRED:${target}`); file(target, bytes, uid, gid, mode)
    },
    releaseLock: (target: string) => {
      if (options.failReleaseLock && !injected.has("unlock")) {
        injected.add("unlock"); throw Object.assign(new Error("unlock failed"), { code: "LOCK_RELEASE_FAILED" })
      }
      events.push(`LOCK_RELEASED:${target}`); entries.delete(target)
    },
    createJournal: (target: string, record: unknown) => {
      if (entries.has(target)) throw Object.assign(new Error("journal exists"), { code: "EEXIST" })
      events.push("JOURNAL_AUTHORITY_CONSUMED"); file(target, recordBytes(record), 0, 0, 0o600)
    },
    appendJournal: (target: string, record: any) => {
      if (record.record_type === "COMMITTED" && options.failCommittedJournal) {
        throw Object.assign(new Error("commit journal failed"), { code: "EIO" })
      }
      events.push(`JOURNAL_${record.record_type}`)
      const entry = entries.get(target)!
      entry.bytes = Buffer.concat([entry.bytes!, recordBytes(record)])
      if (record.record_type === "NORMAL_SSH_PROOF_INTENT" && options.failAfterProofIntent && !injected.has("proof-intent")) {
        injected.add("proof-intent"); throw Object.assign(new Error("crash after proof intent"), { code: "INJECTED_PROOF_INTENT_CRASH" })
      }
    },
    ensureDirectoryExact: (target: string, uid: number, gid: number, mode: number, resumeOwnedPartial = false) => {
      const current = entries.get(target)
      if (current) {
        if (resumeOwnedPartial && current.type === "directory" && current.uid === uid && current.gid === gid && current.mode === 0o700) {
          current.mode = mode; events.push("RECOVER_AUTHORIZED_KEYS_DIRECTORY"); return true
        }
        if (current.type !== "directory" || current.uid !== uid || current.gid !== gid || current.mode !== mode) throw Object.assign(new Error("directory drift"), { code: "DIRECTORY_DRIFT" })
        return false
      }
      entries.set(target, { type: "directory", uid, gid, mode, direct: true, nlink: 1 })
      events.push("CREATE_AUTHORIZED_KEYS_DIRECTORY")
      return true
    },
    removeDirectoryExactEmpty: (target: string) => {
      if (options.failDirectoryRemoval) throw Object.assign(new Error("directory not empty"), { code: "DIRECTORY_NOT_EMPTY" })
      entries.delete(target); events.push("ROLLBACK_AUTHORIZED_KEYS_DIRECTORY")
    },
    createFileExclusive: (target: string, bytes: Buffer, uid: number, gid: number, mode: number) => {
      maybeFail("COPY_STANDING_KEY_TO_ROOT")
      if (entries.has(target)) throw Object.assign(new Error("exists"), { code: "EEXIST" })
      events.push("COPY_STANDING_KEY_TO_ROOT"); file(target, bytes, uid, gid, mode)
      if (target.endsWith(".recovery.json") && options.failAfterProofCreate && !injected.has("proof-create")) {
        injected.add("proof-create"); throw Object.assign(new Error("crash after proof create"), { code: "INJECTED_PROOF_CREATE_CRASH" })
      }
      after("COPY_STANDING_KEY_TO_ROOT")
    },
    atomicReplace: (target: string, bytes: Buffer, uid: number, gid: number, mode: number) => {
      maybeFail("REPLACE_SSHD_CONFIG")
      events.push("REPLACE_SSHD_CONFIG"); file(target, bytes, uid, gid, mode)
      after("REPLACE_SSHD_CONFIG")
    },
    restoreConfigExact: (target: string, bytes: Buffer, predecessorSha: string, reviewedSha: string,
      uid: number, gid: number, mode: number) => {
      if (options.failRollback === "config") throw Object.assign(new Error("rollback failed"), { code: "ROLLBACK_FAILED" })
      const current = entries.get(target)
      if (!current?.bytes || ![predecessorSha, reviewedSha].includes(sha256(current.bytes))) {
        throw Object.assign(new Error("foreign config"), { code: "FOREIGN_DATA" })
      }
      events.push("ROLLBACK_REPLACE_SSHD_CONFIG"); file(target, bytes, uid, gid, mode)
    },
    removeExactOrAbsent: (target: string, expectedSha: string) => {
      if (options.failRollback === "key") throw Object.assign(new Error("rollback failed"), { code: "ROLLBACK_FAILED" })
      const current = entries.get(target)
      if (!current) { events.push("ROLLBACK_STANDING_KEY_ABSENT"); return }
      if (!current.bytes || sha256(current.bytes) !== expectedSha) throw Object.assign(new Error("foreign key"), { code: "FOREIGN_DATA" })
      events.push("ROLLBACK_COPY_STANDING_KEY_TO_ROOT"); entries.delete(target)
    },
  }
  if (options.prepositionAuthProof) file(proofPath, Buffer.from("{}\n"), 0, 0, 0o600)
  if (options.authorityConsumed) file(journalPath, Buffer.from("consumed\n"), 0, 0, 0o600)
  return { entries, events, authority, journalPath, proofPath, io, nextTime }
}

function run(value: ReturnType<typeof fixture>, mode: "dry-run" | "apply" = "dry-run") {
  return repairAegisSshCoexistence({ manifest, manifestBytes, authority: value.authority, mode,
    io: value.io as any, assetBytes, assetSourcePath: `/bundle/${REVIEWED_CONFIG_ASSET}`,
    installerBytes, launcherBytes, standingKeyBinding: fixtureStandingBinding,
    entrypointSha256: manifest.standingEntrypoint.sha256, clock: value.nextTime,
    challengeNonce: () => "ab".repeat(32),
    machineIdentitySha256: manifest.identity.machineIdSha256 })
}

function expectCode(action: () => unknown, code: string) {
  let caught: any
  try { action() } catch (error) { caught = error }
  expect(caught?.code).toBe(code)
  return caught
}

describe("AEGIS Issue #595 SSH coexistence one-shot root repair", () => {
  it("binds finalized predecessor, standing key, reviewed config, and installer bytes", () => {
    expect(validateAegisSshCoexistenceRepairManifest(liveManifest, { assetBytes, installerBytes, launcherBytes }))
      .toMatchObject({ repairId: "aegis-ssh-coexistence-repair-issue-595-v1", status: "FINAL_REVIEWED_ONE_SHOT_PACKAGE" })
    expect(liveManifest.identity).toMatchObject({ uid: 999, gid: 987 })
    expect(liveManifest.standingKey).toMatchObject({
      recordSha256: "d054724aeea3ff42bf646d4d3aed078be21183e3a67c9ae1f8d4768e97dd2967",
      fingerprint: "SHA256:dlhYn3gjgDUQ09vFt583lXl2JKMhyFQMVoFE0sQpa48",
    })
    expect(sha256(Buffer.from(liveManifest.predecessor.configBase64, "base64"))).toBe(liveManifest.predecessor.sha256)
    expect(sha256(assetBytes)).toBe(liveManifest.reviewedConfig.sha256)
    expect(sha256(installerBytes)).toBe(liveManifest.installer.sha256)
    expect(sha256(launcherBytes)).toBe(liveManifest.launcher.sha256)
    expect(liveManifest.standingEntrypoint).toMatchObject({
      sha256: "ebcf0d068e11c1a3f98b515f9a59a456955d8d30abdbb8bab7897b9b315caf9a",
      owner: "root", group: "root", mode: "0555", trustedParentChain: true,
    })
    expect(liveManifest.trustedServiceParents).toEqual([
      { path: "/home/williamos-fabric", uid: 999, gid: 987, mode: "0755" },
      { path: "/home/williamos-fabric/.ssh", uid: 999, gid: 987, mode: "0700" },
      { path: "/var/lib/williamos", uid: 999, gid: 987, mode: "0750" },
      { path: "/var/lib/williamos/fabric", uid: 999, gid: 987, mode: "0700" },
      { path: "/var/lib/williamos/fabric/ledger", uid: 999, gid: 987, mode: "0700" },
      { path: "/var/lib/williamos/fabric/standing-hash-ledger", uid: 999, gid: 987, mode: "0700" },
    ])
    expect(liveManifest.kernelLock).toEqual({ path: KERNEL_LOCK_PATH, owner: "root", group: "root", mode: "0600", mechanism: "FLOCK_INHERITED_FD" })
    expect(liveManifest.failedRecovery).toEqual({
      operations: ["SETTLE_FAILED_RECOVERY", "SETTLE_POST_MUTATION"],
      failedAuthorityId: "babd50b8-b42c-4fef-bd4f-39c152256ddc",
      failedAuthoritySha256: "f01b973bad66b1facd92e116f476ec854a6b6632de5ea28c163ee1cceff53623",
      failedManifestSha256: "3aa8f73203cbf7e5b89c91cbbdc421e2d2eeef3e00bd3a085d4c2715f4267761",
      normalSshProofSuffix: ".recovery.json", maximumResumeSeconds: 1800,
    })
  })

  it("rejects forged or wrong server-observed SSH socket provenance", () => {
    const value = fixture()
    const exact = value.io.sshSessionEvidence()
    expect(inspectSshSessionEvidence(exact)).toBe(true)
    expect(inspectSshSessionEvidence({ ...exact, sourceAddress: "192.168.88.10" })).toBe(false)
    expect(inspectSshSessionEvidence({ ...exact, targetAddress: "127.0.0.1" })).toBe(false)
    expect(inspectSshSessionEvidence({ ...exact, socketInode: "0" })).toBe(false)
  })

  it("dry-runs staged validation without authority consumption or host mutation", () => {
    const value = fixture()
    const before = [...value.entries].map(([key, entry]) => [key, entry.bytes?.toString("hex")])
    expect(run(value)).toMatchObject({ status: "DRY_RUN", authority_consumed: false, mutations: [],
      scheduler_activated: false, workload_executed: false, network_accessed: false })
    expect([...value.entries].map(([key, entry]) => [key, entry.bytes?.toString("hex")])).toEqual(before)
    expect(value.events).toEqual(["VALIDATE_STAGED_SSHD"])
  })

  it("copies only the standing key, replaces only the config, and commits after live proof", () => {
    const value = fixture()
    expect(run(value, "apply")).toMatchObject({ status: "COMMITTED", authority_consumed: true,
      mutations: ["CREATE_AUTHORIZED_KEYS_DIRECTORY", "COPY_STANDING_KEY_TO_ROOT", "REPLACE_SSHD_CONFIG", "RELOAD_SSHD"], scheduler_activated: false,
      workload_executed: false, network_accessed: false })
    expect(value.entries.get(STANDING_ROOT_KEY_PATH)).toMatchObject({ uid: 0, gid: 0, mode: 0o444 })
    expect(value.entries.get(STANDING_ROOT_KEY_PATH)!.bytes).toEqual(standingBytes())
    expect(value.entries.get(CONFIG_PATH)!.bytes).toEqual(assetBytes)
    expect(value.entries.has(REMOTE_DEV_KEY_PATH)).toBe(false)
    expect(value.entries.has(LOCK_PATH)).toBe(false)
    expect(value.events.indexOf("VALIDATE_LIVE_SSHD")).toBeGreaterThan(value.events.indexOf("REPLACE_SSHD_CONFIG"))
    expect(value.events).toContain("RELOAD_SSHD")
    expect(value.events.indexOf("JOURNAL_COMMITTED")).toBeLessThan(value.events.findIndex((event) => event.startsWith("LOCK_RELEASED:")))
    const records = value.entries.get(value.journalPath)!.bytes!.toString("utf8").trim().split("\n").map(JSON.parse)
    expect(records.map(({ record_type }) => record_type)).toEqual([
      "AUTHORITY_CONSUMED", "MUTATED_AWAITING_AUTH_PROBE", "AUTH_PROBE_CHALLENGE_ISSUED", "COMMITTED", "LOCK_RELEASE_PROVEN",
    ])
    for (const lock of RESERVATION_LOCK_PATHS) expect(value.entries.has(lock)).toBe(false)
  })

  it.each([
    ["platform", { platform: "win32" }, "AEGIS_SSH_REPAIR_LINUX_REQUIRED"],
    ["root", { euid: 1000 }, "AEGIS_SSH_REPAIR_ROOT_REQUIRED"],
    ["hostname", { hostname: "hermes" }, "AEGIS_SSH_REPAIR_HOST_REJECTED"],
    ["machine", { machine: "0".repeat(64) }, "AEGIS_SSH_REPAIR_HOST_REJECTED"],
    ["account", { accountDrift: true }, "AEGIS_SSH_REPAIR_ACCOUNT_DRIFT"],
    ["predecessor bytes", { predecessorBytes: Buffer.from("drift\n") }, "AEGIS_SSH_REPAIR_PREDECESSOR_DRIFT"],
    ["predecessor metadata", { predecessorMode: 0o644 }, "AEGIS_SSH_REPAIR_PREDECESSOR_DRIFT"],
    ["standing bytes", { standingBytes: Buffer.from("drift\n") }, "AEGIS_SSH_REPAIR_STANDING_KEY_DRIFT"],
    ["standing metadata", { standingMode: 0o644 }, "AEGIS_SSH_REPAIR_STANDING_KEY_DRIFT"],
    ["entrypoint metadata", { entrypointMode: 0o755 }, "AEGIS_SSH_REPAIR_ENTRYPOINT_DRIFT"],
    ["remote-dev key", { occupiedPath: REMOTE_DEV_KEY_PATH }, "AEGIS_SSH_REPAIR_INACTIVE_STATE_REQUIRED"],
    ["standing root copy", { occupiedPath: STANDING_ROOT_KEY_PATH }, "AEGIS_SSH_REPAIR_INACTIVE_STATE_REQUIRED"],
    ["activation", { activeRemoteDev: true }, "AEGIS_SSH_REPAIR_INACTIVE_STATE_REQUIRED"],
    ["transient worker", { activeWorker: true }, "AEGIS_SSH_REPAIR_INACTIVE_STATE_REQUIRED"],
    ["kernel reservation", { kernelLockHeld: false }, "AEGIS_SSH_REPAIR_KERNEL_LOCK_REQUIRED"],
    ["trusted parent chain", { untrustedParents: true }, "AEGIS_SSH_REPAIR_STANDING_KEY_DRIFT"],
    ["standing key read race", { sourceChangesDuringRead: true }, "AEGIS_SSH_REPAIR_STANDING_KEY_DRIFT"],
    ["expired authority", { authorityExpired: true }, "AEGIS_SSH_REPAIR_AUTHORITY_EXPIRED"],
  ])("rejects %s drift before authority consumption", (_label, options, code) => {
    const value = fixture(options as Options)
    const machine = (options as Options).machine ?? manifest.identity.machineIdSha256
    expectCode(() => repairAegisSshCoexistence({ manifest, manifestBytes, authority: value.authority, mode: "apply",
      io: value.io as any, assetBytes, assetSourcePath: `/bundle/${REVIEWED_CONFIG_ASSET}`,
      installerBytes, launcherBytes, standingKeyBinding: fixtureStandingBinding,
      entrypointSha256: manifest.standingEntrypoint.sha256,
      clock: () => NOW, machineIdentitySha256: machine }), code)
    expect(value.events).not.toContain("JOURNAL_AUTHORITY_CONSUMED")
  })

  it("rejects only a terminal authority replay and recovers nonterminal journals", () => {
    const value = fixture()
    expect(run(value, "apply")).toMatchObject({ status: "COMMITTED" })
    value.events.length = 0
    expectCode(() => run(value, "apply"), "AEGIS_SSH_REPAIR_AUTHORITY_REPLAY")
    expect(value.events.some((event) => event.startsWith("LOCK_ACQUIRED:"))).toBe(false)
  })

  it("requires staged sshd validation before authority consumption", () => {
    const value = fixture({ failStage: true })
    expectCode(() => run(value, "apply"), "STAGED_INVALID")
    expect(value.events).toEqual(["VALIDATE_STAGED_SSHD"])
  })

  it.each([
    ["key create", { failMutation: "COPY_STANDING_KEY_TO_ROOT" }, "INJECTED_FAILURE"],
    ["key durability", { failAfterMutation: "COPY_STANDING_KEY_TO_ROOT" }, "INJECTED_POST_FAILURE"],
    ["config replace", { failMutation: "REPLACE_SSHD_CONFIG" }, "INJECTED_FAILURE"],
    ["config durability", { failAfterMutation: "REPLACE_SSHD_CONFIG" }, "INJECTED_POST_FAILURE"],
    ["live sshd", { failLive: true }, "LIVE_INVALID"],
    ["effective restrictions", { failEffective: true }, "AEGIS_SSH_REPAIR_SSHD_INVALID"],
    ["commit journal", { failCommittedJournal: true }, "EIO"],
  ])("restores exact predecessor and removes the exact key after %s failure", (_label, options, code) => {
    const value = fixture(options as Options)
    expectCode(() => run(value, "apply"), code)
    expect(value.entries.get(CONFIG_PATH)!.bytes).toEqual(Buffer.from(manifest.predecessor.configBase64, "base64"))
    expect(value.entries.has(STANDING_ROOT_KEY_PATH)).toBe(false)
    expect(value.entries.has(LOCK_PATH)).toBe(false)
    const records = value.entries.get(value.journalPath)!.bytes!.toString("utf8").trim().split("\n").map(JSON.parse)
    expect(records.map(({ record_type }) => record_type)).toEqual(expect.arrayContaining(["AUTHORITY_CONSUMED", "FAILED_PARTIAL", "FAILED_LOCK_RELEASE_PROVEN"]))
    expect(records.some(({ record_type }) => record_type === "COMMITTED")).toBe(false)
    expect(records.find(({ record_type }) => record_type === "FAILED_PARTIAL")).toMatchObject({ scheduler_activated: false, workload_executed: false, network_accessed: false })
  })

  it("fails recovery closed and preserves foreign key bytes", () => {
    const value = fixture({ failLive: true, foreignKeyOnFailure: true })
    const failure = expectCode(() => run(value, "apply"), "AEGIS_SSH_REPAIR_RECOVERY_UNCERTAIN")
    expect(value.entries.get(STANDING_ROOT_KEY_PATH)!.bytes).toEqual(Buffer.from("foreign\n"))
    expect(sshCoexistenceRepairErrorEvidence(failure)).toMatchObject({
      authority_consumed: true, original_failure_code: "LIVE_INVALID", cause_code: "FOREIGN_DATA",
      scheduler_activated: false, workload_executed: false,
    })
  })

  it("recovers a post-COMMITTED lock release failure without inventing release proof", () => {
    const value = fixture({ failReleaseLock: true })
    expectCode(() => run(value, "apply"), "LOCK_RELEASE_FAILED")
    let records = value.entries.get(value.journalPath)!.bytes!.toString("utf8").trim().split("\n").map(JSON.parse)
    expect(records.at(-1)?.record_type).toBe("COMMITTED")
    expect(records.some(({ record_type }) => record_type === "LOCK_RELEASE_PROVEN")).toBe(false)
    expect(run(value, "apply")).toMatchObject({ status: "COMMITTED", recovered: true })
    records = value.entries.get(value.journalPath)!.bytes!.toString("utf8").trim().split("\n").map(JSON.parse)
    expect(records.at(-1)?.record_type).toBe("LOCK_RELEASE_PROVEN")
  })

  it("waits without COMMITTED until an exact standing authentication proof is supplied, then resumes", () => {
    const options: Options = { authProof: false }
    const value = fixture(options)
    expect(run(value, "apply")).toMatchObject({ status: "AWAITING_AUTH_PROBE", authority_consumed: true })
    let records = value.entries.get(value.journalPath)!.bytes!.toString("utf8").trim().split("\n").map(JSON.parse)
    expect(records.some(({ record_type }) => record_type === "COMMITTED")).toBe(false)
    expect(records.find(({ record_type }) => record_type === "AUTH_PROBE_CHALLENGE_ISSUED")).toMatchObject({
      challenge_nonce: "ab".repeat(32),
    })
    for (const lock of RESERVATION_LOCK_PATHS) expect(value.entries.has(lock)).toBe(false)
    options.authProof = true
    expect(run(value, "apply")).toMatchObject({ status: "COMMITTED", authority_consumed: true })
    records = value.entries.get(value.journalPath)!.bytes!.toString("utf8").trim().split("\n").map(JSON.parse)
    expect(records.slice(-2).map(({ record_type }) => record_type)).toEqual(["COMMITTED", "LOCK_RELEASE_PROVEN"])
  })

  it("rejects an authentication proof positioned before the post-reload challenge", () => {
    const value = fixture({ prepositionAuthProof: true })
    expectCode(() => run(value, "apply"), "AEGIS_SSH_REPAIR_AUTH_PROOF_PREPOSITIONED")
    expect(value.events).not.toContain("JOURNAL_AUTHORITY_CONSUMED")
  })

  it("binds authentication proof to the exact durable challenge and chronology", () => {
    const value = fixture()
    value.io.standingAuthProof = (_target: string, challenge: any) => ({
      schemaVersion: 2, authorityId: AUTHORITY_ID, repairId: manifest.repairId,
      result: manifest.authProof.result, sourceAddress: manifest.authProof.sourceAddress,
      standingKeySha256: manifest.standingKey.recordSha256,
      standingEntrypointSha256: manifest.standingEntrypoint.sha256,
      reviewedConfigSha256: manifest.reviewedConfig.sha256,
      challengeNonce: `${challenge.challenge_nonce.slice(0, -1)}0`,
      challengeIssuedAt: challenge.challenge_issued_at,
      authenticatedAt: new Date(Date.parse(challenge.challenge_issued_at) + 1).toISOString(),
    })
    expectCode(() => run(value, "apply"), "AEGIS_SSH_REPAIR_AUTH_PROOF_INVALID")
  })

  it("does not roll back unlocked when a resume cannot acquire every reservation", () => {
    const options: Options = { authProof: false }
    const value = fixture(options)
    expect(run(value, "apply")).toMatchObject({ status: "AWAITING_AUTH_PROBE" })
    options.authProof = true
    options.failAcquirePath = RESERVATION_LOCK_PATHS[1]
    expectCode(() => run(value, "apply"), "LOCK_OCCUPIED")
    expect(value.entries.get(CONFIG_PATH)!.bytes).toEqual(assetBytes)
    expect(value.entries.get(STANDING_ROOT_KEY_PATH)!.bytes).toEqual(standingBytes())
    options.failAcquirePath = undefined
    expect(run(value, "apply")).toMatchObject({ status: "COMMITTED" })
  })

  it("rejects a digest-matching stale reservation with noncanonical metadata", () => {
    const options: Options = { authProof: false }
    const value = fixture(options)
    expect(run(value, "apply")).toMatchObject({ status: "AWAITING_AUTH_PROBE" })
    const lockBytes = recordBytes({ schema_version: "1.0-aegis-ssh-coexistence-repair-lock", authority_id: AUTHORITY_ID, repair_id: manifest.repairId })
    value.entries.set(RESERVATION_LOCK_PATHS[0], { type: "file", bytes: lockBytes, uid: 999, gid: 987, mode: 0o600, direct: true, nlink: 1 })
    options.authProof = true
    expectCode(() => run(value, "apply"), "LOCK_OCCUPIED")
    expect(value.events).not.toContain("JOURNAL_COMMITTED")
  })

  it("recovers exact failed-phase lock release evidence without repeating mutation", () => {
    const value = fixture({ failMutation: "COPY_STANDING_KEY_TO_ROOT" })
    expectCode(() => run(value, "apply"), "INJECTED_FAILURE")
    const journal = value.entries.get(value.journalPath)!
    const lines = journal.bytes!.toString("utf8").trim().split("\n")
    journal.bytes = Buffer.from(`${lines.slice(0, -1).join("\n")}\n`)
    value.events.length = 0
    expectCode(() => run(value, "apply"), "AEGIS_SSH_REPAIR_AUTHORITY_REPLAY")
    expect(value.events).not.toContain("COPY_STANDING_KEY_TO_ROOT")
    expect(journal.bytes!.toString("utf8")).toContain('"record_type":"FAILED_LOCK_RELEASE_PROVEN"')
  })

  it("requires the external pinned launcher before reading a valid authority path", () => {
    const readStable = vi.fn()
    const stderr = { value: "", write(chunk: string) { this.value += chunk } }
    expect(main(["--apply", "--authority", `${AUTHORITY_ROOT}/${AUTHORITY_ID}.json`],
      { io: { readStable }, stderr, repoRoot: root } as any)).toBe(2)
    expect(readStable).not.toHaveBeenCalled()
    expect(stderr.value).toContain("AEGIS_SSH_REPAIR_LAUNCHER_REQUIRED")
    expect(launcherBytes.toString("utf8")).toContain(`INSTALLER_SHA256=${liveManifest.installer.sha256}`)
    expect(launcherBytes.toString("utf8")).toContain('/usr/bin/flock --exclusive --nonblock --no-fork "$KERNEL_LOCK" "$LAUNCHER" "$@"')
    expect(launcherBytes.toString("utf8")).toContain("WILLIAMOS_SSH_REPAIR_LAUNCHER_PATH")
    expect(launcherBytes.toString("utf8")).toContain('[ ! -L "$LAUNCHER" ]')
    expect(launcherBytes.toString("utf8")).toContain('[ ! -L "$SOURCE" ]')
    const installerSource = installerBytes.toString("utf8")
    expect(launcherBytes.toString("utf8")).not.toContain("--no-fork 9")
    expect(launcherBytes.toString("utf8")).toContain('[ -f "$KERNEL_LOCK" ]')
    expect(launcherBytes.toString("utf8")).toContain("stat -Lc '%u:%g:%a' \"$KERNEL_LOCK\"")
    expect(launcherBytes.toString("utf8")).not.toContain("stat -Lc '%u:%g:%a:%F' \"$KERNEL_LOCK\"")
    expect(installerSource).toMatch(/fs\s*\.readdirSync\("\/proc\/self\/fd"\)/)
    expect(installerSource).toContain("trustedKernelLockParent()")
    expect(installerSource).toContain('(lock.mode & 0o7777) === 0o1777')
    expect(installerSource).toMatch(/function trustedParentFor\(target\)[\s\S]*target === LOCK_PATH[\s\S]*trustedKernelLockParent\(\)/)
    expect(installerSource).toContain("parentsTrusted: trustedParentFor")
    expect(installerSource).toMatch(/if\s*\(!trustedParentFor\(target\)\)\s*fail\(code/)
    expect(installerSource).toContain("return descriptors.length === 1")
    expect(installerSource).toContain('fs.readFileSync("/proc/locks", "utf8")')
    expect(installerSource).toContain('fs.realpathSync(`/proc/${current}/exe`)')
    expect(installerSource).toContain('executable === "/usr/sbin/sshd"')
    expect(installerSource).toContain('/^sshd: [A-Za-z0-9._-]+@notty$/')
    expect(installerSource).toContain('sshdSessionSocket(ancestor.sshdAncestorPid)')
    expect(installerSource).toContain('Number(match[1]) === process.pid')
    expect(installerSource).toContain('const openedBefore = fs.fstatSync(fd, { bigint: true })')
    expect(installerSource).toContain('openedAfter = fs.fstatSync(fd, { bigint: true })')
  })

  it("settles exact post-mutation babd state without rewriting or reloading after an independent normal SSH proof", () => {
    const options: Options = {}
    const value = fixture(options)
    const failedId = "babd50b8-b42c-4fef-bd4f-39c152256ddc"
    const failedJournal = `${JOURNAL_PREFIX}${failedId}.journal.jsonl`
    const failedFirst = {
      authority_id: failedId,
      authority_sha256: "f01b973bad66b1facd92e116f476ec854a6b6632de5ea28c163ee1cceff53623",
      consumed_at: "2026-08-12T16:35:05.184Z",
      manifest_sha256: "3aa8f73203cbf7e5b89c91cbbdc421e2d2eeef3e00bd3a085d4c2715f4267761",
      phase: 0, record_type: "AUTHORITY_CONSUMED",
      schema_version: "1.0-aegis-ssh-coexistence-repair-journal",
    }
    value.entries.set(failedJournal, { type: "file", bytes: recordBytes(failedFirst), uid: 0, gid: 0, mode: 0o600, direct: true, nlink: 1 })
    const recoveryAuthority = {
      schemaVersion: 1, operation: "SETTLE_POST_MUTATION",
      authorityId: "22222222-2222-4222-8222-222222222222", repairId: manifest.repairId,
      manifestSha256: sha256(manifestBytes), machineIdSha256: manifest.identity.machineIdSha256,
      failedAuthorityId: failedId, failedAuthoritySha256: failedFirst.authority_sha256,
      failedManifestSha256: failedFirst.manifest_sha256,
      predecessorConfigSha256: manifest.predecessor.sha256,
      standingAuthorizedKeySha256: manifest.standingKey.recordSha256,
      standingEntrypointSha256: manifest.standingEntrypoint.sha256,
      installerSha256: manifest.installer.sha256, launcherSha256: manifest.launcher.sha256,
      issuedAt: "2026-08-12T20:00:00.000Z", expiresAt: "2026-08-12T20:10:00.000Z",
      resumeExpiresAt: "2026-08-12T20:30:00.000Z", singleUse: true, consumed: false,
    }
    value.entries.set(CONFIG_PATH, { type: "file", bytes: Buffer.from(assetBytes), uid: 0, gid: 0, mode: 0o444, direct: true, nlink: 1 })
    value.entries.set(AUTHORIZED_KEYS_ROOT, { type: "directory", uid: 0, gid: 0, mode: 0o755, direct: true, nlink: 1 })
    value.entries.set(STANDING_ROOT_KEY_PATH, { type: "file", bytes: standingBytes(), uid: 0, gid: 0, mode: 0o444, direct: true, nlink: 1 })
    const invoke = () => repairAegisSshCoexistence({ manifest, manifestBytes, authority: recoveryAuthority,
      mode: "apply", io: value.io as any, assetBytes, assetSourcePath: `/bundle/${REVIEWED_CONFIG_ASSET}`,
      installerBytes, launcherBytes, standingKeyBinding: fixtureStandingBinding,
      entrypointSha256: manifest.standingEntrypoint.sha256, clock: value.nextTime,
      challengeNonce: () => "cd".repeat(32), machineIdentitySha256: manifest.identity.machineIdSha256 })
    options.missingReloadEvidence = true
    expectCode(invoke, "AEGIS_SSH_REPAIR_RELOAD_EVIDENCE_INVALID")
    options.missingReloadEvidence = false
    const waiting: any = invoke()
    expect(waiting).toMatchObject({ status: "AWAITING_RECOVERY_AUTH_PROBE", authority_consumed: true })
    options.daemonDrift = true
    expectCode(invoke, "AEGIS_SSH_REPAIR_DAEMON_IDENTITY_DRIFT")
    options.daemonDrift = false
    const recoveryJournal = `${JOURNAL_PREFIX}${recoveryAuthority.authorityId}.recovery.journal.jsonl`
    const releaseRecord = value.entries.get(recoveryJournal)!.bytes!.toString("utf8").trim().split("\n").map(JSON.parse)
      .find(({ record_type }) => record_type === "LOCK_RELEASE_PROVEN_AWAITING_AUTH_PROBE")
    const proof = { schemaVersion: 2, operation: "NORMAL_SSH_AUTHENTICATED",
        producer: "/usr/local/libexec/williamos-aegis-ssh-coexistence-repair.mjs",
        producerSha256: manifest.installer.sha256,
        recoveryAuthorityId: recoveryAuthority.authorityId, failedAuthorityId: failedId,
        challengeNonce: waiting.auth_challenge.challenge_nonce,
        challengeIssuedAt: waiting.auth_challenge.challenge_issued_at,
        releaseProvenAt: releaseRecord.released_at,
        daemonIdentity: waiting.auth_challenge.daemon_identity,
        session: value.io.sshSessionEvidence(),
        authenticatedAt: new Date(Date.parse(releaseRecord.released_at) + 1000).toISOString() }
    value.entries.set(waiting.auth_proof_path, { type: "file", uid: 0, gid: 0, mode: 0o600, direct: true, nlink: 1, bytes: recordBytes(proof) })
    expectCode(invoke, "AEGIS_SSH_REPAIR_AUTH_PROOF_INVALID")
    value.entries.delete(waiting.auth_proof_path)
    const produce = () => recordRecoverySshProof({ manifest, manifestBytes, authority: recoveryAuthority, io: value.io as any,
      assetBytes, assetSourcePath: `/bundle/${REVIEWED_CONFIG_ASSET}`, installerBytes, launcherBytes,
      standingKeyBinding: fixtureStandingBinding, entrypointSha256: manifest.standingEntrypoint.sha256,
      clock: value.nextTime, machineIdentitySha256: manifest.identity.machineIdSha256 })
    options.failAfterProofIntent = true
    expectCode(produce, "INJECTED_PROOF_INTENT_CRASH")
    options.failAfterProofIntent = false; options.failAfterProofCreate = true
    expectCode(produce, "INJECTED_PROOF_CREATE_CRASH")
    options.failAfterProofCreate = false
    expect(produce()).toMatchObject({ status: "RECOVERY_AUTH_PROOF_RECORDED" })
    expect(invoke()).toMatchObject({ status: "FAILED_RECOVERY_SETTLED", daemon_identity_unchanged: true, normal_ssh_proven: true })
    expect(value.events).not.toContain("RELOAD_SSHD")
    expect(value.events).not.toContain("REPLACE_SSHD_CONFIG")
    expectCode(invoke, "AEGIS_SSH_REPAIR_AUTHORITY_REPLAY")
    const phases = value.entries.get(failedJournal)!.bytes!.toString("utf8").trim().split("\n").map(JSON.parse)
    expect(phases.map(({ record_type }) => record_type)).toEqual(["AUTHORITY_CONSUMED", "FAILED_PARTIAL", "FAILED_LOCK_RELEASE_PROVEN"])
  })

  it("refuses post-mutation settlement when a crash preceded the reviewed-config reload", () => {
    const source = fs.readFileSync(path.join(root, INSTALLER_PATH), "utf8")
    expect(source).toContain("sshReloadEvidence(CONFIG_PATH, daemon)")
    expect(source).toContain("io.validateLiveSshd()")
    expect(source).toContain("verifyEffective(io)")
  })

  it("creates the exact authorized_keys directory and records its transaction ownership", () => {
    const value = fixture()
    expect(run(value, "apply")).toMatchObject({ status: "COMMITTED" })
    expect(value.entries.get(AUTHORIZED_KEYS_ROOT)).toMatchObject({ type: "directory", uid: 0, gid: 0, mode: 0o755, direct: true })
    const first = JSON.parse(value.entries.get(value.journalPath)!.bytes!.toString("utf8").split("\n")[0])
    expect(first.authorized_keys_directory_preexisted).toBe(false)
  })

  it.each(["wrong-mode", "file"] as const)("rejects an occupied %s authorized_keys path before consumption", (authorizedKeysDirectory) => {
    const value = fixture({ authorizedKeysDirectory })
    expectCode(() => run(value, "apply"), "AEGIS_SSH_REPAIR_AUTHORIZED_KEYS_DIRECTORY_DRIFT")
    expect(value.events).not.toContain("JOURNAL_AUTHORITY_CONSUMED")
  })

  it("preserves a preexisting exact authorized_keys directory during rollback", () => {
    const value = fixture({ authorizedKeysDirectory: "exact", failMutation: "COPY_STANDING_KEY_TO_ROOT" })
    expectCode(() => run(value, "apply"), "INJECTED_FAILURE")
    expect(value.entries.get(AUTHORIZED_KEYS_ROOT)).toMatchObject({ type: "directory", uid: 0, gid: 0, mode: 0o755 })
    expect(value.events).not.toContain("ROLLBACK_AUTHORIZED_KEYS_DIRECTORY")
  })

  it("resumes after a crash during the transaction-owned directory metadata transition", () => {
    const value = fixture()
    value.entries.set(AUTHORIZED_KEYS_ROOT, { type: "directory", uid: 0, gid: 0, mode: 0o700, direct: true, nlink: 1 })
    const consumed = {
      schema_version: "1.0-aegis-ssh-coexistence-repair-journal", record_type: "AUTHORITY_CONSUMED", phase: 0,
      authority_id: value.authority.authorityId, authority_sha256: sha256(Buffer.from(canonicalizeRepairJcs(value.authority))),
      manifest_sha256: sha256(manifestBytes), authorized_keys_directory_preexisted: false,
      consumed_at: "2026-08-12T20:04:00.000Z",
    }
    value.entries.set(value.journalPath, { type: "file", bytes: recordBytes(consumed), uid: 0, gid: 0, mode: 0o600, direct: true, nlink: 1 })
    expect(run(value, "apply")).toMatchObject({ status: "COMMITTED" })
    expect(value.entries.get(AUTHORIZED_KEYS_ROOT)).toMatchObject({ type: "directory", mode: 0o755 })
    expect(value.events).toContain("RECOVER_AUTHORIZED_KEYS_DIRECTORY")
  })

  it("repairs a crash after recovery challenge by durably proving release before reading a later SSH proof", () => {
    const value = fixture()
    const failedId = "babd50b8-b42c-4fef-bd4f-39c152256ddc"
    const failedJournal = `${JOURNAL_PREFIX}${failedId}.journal.jsonl`
    value.entries.set(failedJournal, { type: "file", uid: 0, gid: 0, mode: 0o600, direct: true, nlink: 1, bytes: recordBytes({
      authority_id: failedId, authority_sha256: "f01b973bad66b1facd92e116f476ec854a6b6632de5ea28c163ee1cceff53623",
      consumed_at: "2026-08-12T16:35:05.184Z", manifest_sha256: "3aa8f73203cbf7e5b89c91cbbdc421e2d2eeef3e00bd3a085d4c2715f4267761",
      phase: 0, record_type: "AUTHORITY_CONSUMED", schema_version: "1.0-aegis-ssh-coexistence-repair-journal",
    }) })
    const authority: any = { schemaVersion: 1, operation: "SETTLE_FAILED_RECOVERY",
      authorityId: "22222222-2222-4222-8222-222222222222", repairId: manifest.repairId,
      manifestSha256: sha256(manifestBytes), machineIdSha256: manifest.identity.machineIdSha256,
      failedAuthorityId: failedId, failedAuthoritySha256: "f01b973bad66b1facd92e116f476ec854a6b6632de5ea28c163ee1cceff53623",
      failedManifestSha256: "3aa8f73203cbf7e5b89c91cbbdc421e2d2eeef3e00bd3a085d4c2715f4267761",
      predecessorConfigSha256: manifest.predecessor.sha256, standingAuthorizedKeySha256: manifest.standingKey.recordSha256,
      standingEntrypointSha256: manifest.standingEntrypoint.sha256, installerSha256: manifest.installer.sha256,
      launcherSha256: manifest.launcher.sha256, issuedAt: "2026-08-12T20:00:00.000Z",
      expiresAt: "2026-08-12T20:10:00.000Z", resumeExpiresAt: "2026-08-12T20:30:00.000Z", singleUse: true, consumed: false }
    const recoveryJournal = `${JOURNAL_PREFIX}${authority.authorityId}.recovery.journal.jsonl`
    const first = { schema_version: "1.0-aegis-ssh-failed-recovery-journal", record_type: "AUTHORITY_CONSUMED", phase: 0,
      authority_id: authority.authorityId, authority_sha256: sha256(Buffer.from(canonicalizeRepairJcs(authority))),
      manifest_sha256: sha256(manifestBytes), failed_authority_id: failedId,
      failed_authority_sha256: authority.failedAuthoritySha256, failed_manifest_sha256: authority.failedManifestSha256,
      consumed_at: "2026-08-12T20:04:00.000Z" }
    const challenge = { record_type: "RECOVERY_CHALLENGE_ISSUED", phase: 1, challenge_nonce: "ef".repeat(32),
      challenge_issued_at: "2026-08-12T20:04:01.000Z", daemon_identity: { mainPid: 4321, startTimestampMonotonic: "987654321" } }
    value.entries.set(recoveryJournal, { type: "file", uid: 0, gid: 0, mode: 0o600, direct: true, nlink: 1,
      bytes: Buffer.concat([recordBytes(first), recordBytes(challenge)]) })
    const invoke = () => repairAegisSshCoexistence({ manifest, manifestBytes, authority, mode: "apply", io: value.io as any,
      assetBytes, assetSourcePath: `/bundle/${REVIEWED_CONFIG_ASSET}`, installerBytes, launcherBytes,
      standingKeyBinding: fixtureStandingBinding, entrypointSha256: manifest.standingEntrypoint.sha256,
      clock: value.nextTime, challengeNonce: () => "00".repeat(32), machineIdentitySha256: manifest.identity.machineIdSha256 })
    const waiting: any = invoke()
    expect(waiting.status).toBe("AWAITING_RECOVERY_AUTH_PROBE")
    let records = value.entries.get(recoveryJournal)!.bytes!.toString("utf8").trim().split("\n").map(JSON.parse)
    expect(records.at(-1).record_type).toBe("LOCK_RELEASE_PROVEN_AWAITING_AUTH_PROBE")
    expect(recordRecoverySshProof({ manifest, manifestBytes, authority, io: value.io as any,
      assetBytes, assetSourcePath: `/bundle/${REVIEWED_CONFIG_ASSET}`, installerBytes, launcherBytes,
      standingKeyBinding: fixtureStandingBinding, entrypointSha256: manifest.standingEntrypoint.sha256,
      clock: value.nextTime, machineIdentitySha256: manifest.identity.machineIdSha256 }))
      .toMatchObject({ status: "RECOVERY_AUTH_PROOF_RECORDED" })
    expect(invoke()).toMatchObject({ status: "FAILED_RECOVERY_SETTLED" })
  })

  it("fails recovery closed when a transaction-created authorized_keys directory is no longer exact and empty", () => {
    const value = fixture({ failMutation: "COPY_STANDING_KEY_TO_ROOT", failDirectoryRemoval: true })
    const failure = expectCode(() => run(value, "apply"), "AEGIS_SSH_REPAIR_RECOVERY_UNCERTAIN")
    expect(failure.causeCode).toBe("DIRECTORY_NOT_EMPTY")
    expect(value.entries.has(AUTHORIZED_KEYS_ROOT)).toBe(true)
  })

  it.runIf(process.platform === "linux")("retains the repair pathname flock across exec and releases it only on child exit", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-ssh-flock-"))
    const lock = path.join(root, "repair.lock"), ready = path.join(root, "ready")
    const first = spawn("/usr/bin/flock", ["--exclusive", "--nonblock", "--no-fork", lock,
      "/bin/sh", "-c", `echo $$ > '${ready}'; exec sleep 30`], { stdio: "ignore" })
    try {
      for (let index = 0; index < 100 && !fs.existsSync(ready); index += 1) await new Promise((resolve) => setTimeout(resolve, 10))
      expect(fs.existsSync(ready)).toBe(true)
      const ownerPid = Number(fs.readFileSync(ready, "utf8").trim())
      expect(ownerPid).toBe(first.pid)
      expect(fs.readFileSync("/proc/locks", "utf8")).toMatch(new RegExp(`FLOCK\\s+ADVISORY\\s+WRITE\\s+${ownerPid}\\s+`))
      expect(spawnSync("/usr/bin/flock", ["--exclusive", "--nonblock", lock, "/bin/true"]).status).not.toBe(0)
    } finally {
      first.kill("SIGTERM")
      await new Promise<void>((resolve) => first.once("exit", resolve))
    }
    expect(spawnSync("/usr/bin/flock", ["--exclusive", "--nonblock", lock, "/bin/true"]).status).toBe(0)
    fs.rmSync(root, { recursive: true, force: true })
  })

  it("rechecks inactivity after mutation while all reservations remain held", () => {
    const value = fixture({ inactiveAfterMutation: true })
    expectCode(() => run(value, "apply"), "AEGIS_SSH_REPAIR_INACTIVE_STATE_REQUIRED")
    const failureIndex = value.events.indexOf("JOURNAL_FAILED_PARTIAL")
    expect(failureIndex).toBeGreaterThan(-1)
    expect(value.events.findIndex((event) => event.startsWith("LOCK_RELEASED:"))).toBeGreaterThan(failureIndex)
  })

  it("rejects CLI authority paths outside the fixed root before reading authority bytes", () => {
    const readStable = vi.fn()
    const stderr = { value: "", write(chunk: string) { this.value += chunk } }
    expect(main(["--dry-run", "--authority", "/tmp/authority.json"], { io: { readStable }, stderr } as any)).toBe(2)
    expect(readStable).not.toHaveBeenCalled()
    expect(stderr.value).toContain("AEGIS_SSH_REPAIR_AUTHORITY_PATH_INVALID")
    expect(AUTHORITY_ROOT).toBe("/var/lib/williamos/fabric/ssh-coexistence-repair-authorities")
  })

  it("contains no scheduler, workload execution, service activation, network, or broad deletion primitive", () => {
    const source = installerBytes.toString("utf8")
    expect(source).not.toMatch(/\b(?:fetch|WebSocket|curl|wget|systemctl"\s*,\s*\["(?:start|enable|restart)|execFile|execSync)\b/)
    expect(source).not.toMatch(/\b(?:rmSync|removePublishedRelease)\b/)
    expect(source).toContain("fs.rmdirSync(target)")
    expect(source).not.toContain("shell: true")
    expect(manifest.mutations).toEqual(["CREATE_AUTHORIZED_KEYS_DIRECTORY", "COPY_STANDING_KEY_TO_ROOT", "REPLACE_SSHD_CONFIG", "RELOAD_SSHD"])
  })
})
