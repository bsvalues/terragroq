import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { describe, expect, it, vi } from "vitest"

import {
  AUTHORITY_ROOT,
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
    },
    createFileExclusive: (target: string, bytes: Buffer, uid: number, gid: number, mode: number) => {
      maybeFail("COPY_STANDING_KEY_TO_ROOT")
      if (entries.has(target)) throw Object.assign(new Error("exists"), { code: "EEXIST" })
      events.push("COPY_STANDING_KEY_TO_ROOT"); file(target, bytes, uid, gid, mode)
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
      mutations: ["COPY_STANDING_KEY_TO_ROOT", "REPLACE_SSHD_CONFIG", "RELOAD_SSHD"], scheduler_activated: false,
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
    expect(installerSource).toContain('fs.readdirSync("/proc/self/fd")')
    expect(installerSource).toContain("return descriptors.length === 1")
    expect(installerSource).toContain('fs.readFileSync("/proc/locks", "utf8")')
    expect(installerSource).toContain('Number(match[1]) === process.pid')
    expect(installerSource).toContain('const openedBefore = fs.fstatSync(fd, { bigint: true })')
    expect(installerSource).toContain('openedAfter = fs.fstatSync(fd, { bigint: true })')
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
    expect(source).not.toMatch(/\b(?:rmSync|rmdirSync|removePublishedRelease)\b/)
    expect(source).not.toContain("shell: true")
    expect(manifest.mutations).toEqual(["COPY_STANDING_KEY_TO_ROOT", "REPLACE_SSHD_CONFIG", "RELOAD_SSHD"])
  })
})
