import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  CHATTR,
  LSATTR,
  ACTIVATION_MARKER_PATH,
  AUTHORITY_ROOT,
  LEDGER_MUTATION_LOCK_PATH,
  NODE_MUTATION_LOCK_PATH,
  canonicalizeUpgradeJcs,
  main,
  replayLedgerUpgradeErrorEvidence,
  upgradeAegisStandingHashReplayLedger,
  validateAegisStandingHashReplayLedgerUpgradeManifest,
} from "../scripts/execution-fabric/provision/upgrade-aegis-standing-hash-replay-ledger.mjs"
import { validateActivationMarker } from "../scripts/execution-fabric/bounded-dispatch/bootstrap-aegis-standing-hash.mjs"

const CONFIG_PATH = path.resolve("config/execution-fabric/aegis-standing-hash-replay-ledger-upgrade.v1.json")
const NOW = "2026-08-12T18:00:00.000Z"
const AUTHORITY_ID = "10000000-0000-4000-8000-000000000001"
const PROVISION_ID = "10000000-0000-4000-8000-000000000002"
const REPAIR_ID = "10000000-0000-4000-8000-000000000003"
const NEW_COMMIT = "a".repeat(40)
const PACKAGE_COMMIT = "b".repeat(40)
const EVIDENCE_COMMIT = "c".repeat(40)
const ACCOUNT = { uid: 734, gid: 734, home: "/var/empty/williamos-fabric", shell: "/bin/bash" }
const sha256 = (bytes: crypto.BinaryLike) => crypto.createHash("sha256").update(bytes).digest("hex")
const canonicalSha256 = (value: unknown) => sha256(Buffer.from(canonicalizeUpgradeJcs(value), "utf8"))

type Entry = {
  type: "file" | "directory"
  bytes?: Buffer
  uid: number
  gid: number
  mode: number
  direct: boolean
  nlink: number
  appendOnly?: boolean
}

function loadFinalizedManifest() {
  const manifest = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"))
  manifest.newRelease.commit = NEW_COMMIT
  manifest.newRelease.reviewedCheckoutPath = "/root/reviewed/new"
  manifest.newRelease.releaseRoot = `/opt/williamos/releases/${NEW_COMMIT}`
  manifest.packageRelease.commit = PACKAGE_COMMIT
  manifest.packageRelease.checkoutPath = "/root/reviewed/package"
  for (const source of Object.keys(manifest.newRelease.closure)) {
    manifest.newRelease.closure[source] = sha256(Buffer.from(`new:${source}\n`))
  }
  for (const source of Object.keys(manifest.newRelease.installerBindings)) {
    manifest.newRelease.installerBindings[source] = sha256(Buffer.from(`new:${source}\n`))
  }
  return manifest
}

function provisioningJournal() {
  return Buffer.from([
    JSON.stringify({ schema_version: "1.0-aegis-standing-hash-mutation-journal", record_type: "AUTHORITY_CONSUMED", sequence: 0 }),
    JSON.stringify({ record_type: "APPLY_COMPLETE", sequence: 1 }),
  ].join("\n") + "\n")
}

function repairJournal() {
  return Buffer.from([
    JSON.stringify({ schema_version: "1.0-aegis-standing-hash-canonical-json-repair-journal", record_type: "AUTHORITY_CONSUMED", sequence: 0 }),
    JSON.stringify({ record_type: "REPAIR_COMPLETE", sequence: 1 }),
  ].join("\n") + "\n")
}

function fixture(options: {
  leasePresent?: boolean
  dirtyCheckout?: boolean
  appendOnlyPostcheck?: boolean
  failMutation?: string
  failAfterReplace?: string
  failTerminalJournal?: boolean
  occupiedLock?: string
  ancestryValid?: boolean
  authorityMode?: number
  failAcquireLock?: string
  failReleaseLock?: string
  failRestoreMutation?: string
} = {}) {
  const manifest = loadFinalizedManifest()
  const entries = new Map<string, Entry>()
  const events: string[] = []
  const file = (target: string, bytes: Buffer, uid: number, gid: number, mode: number) => entries.set(target, {
    type: "file", bytes: Buffer.from(bytes), uid, gid, mode, direct: true, nlink: 1,
  })
  const directory = (target: string, uid: number, gid: number, mode: number) => entries.set(target, {
    type: "directory", uid, gid, mode, direct: true, nlink: 1,
  })

  const priorClosure = {
    "scripts/execution-fabric/bounded-dispatch/aegis-standing-hash-runtime.mjs": sha256(Buffer.from("prior runtime\n")),
  }
  const packageBytes = Buffer.from(`${JSON.stringify({
    packageId: "aegis-standing-hash-provisioning-issue-595-v1",
    trustedMain: { commit: manifest.priorState.commit },
    reviewedRelease: {
      releaseRoot: manifest.priorState.releaseRoot,
      runtimeClosurePaths: Object.keys(priorClosure),
    },
    bindings: Object.entries(priorClosure).map(([bindingPath, digest]) => ({ path: bindingPath, sha256: digest })),
  })}\n`)
  manifest.priorState.provisioningManifestSha256 = sha256(packageBytes)
  file(path.resolve("C:/fixture", ...manifest.priorState.provisioningManifestPath.split("/")), packageBytes, 1000, 1000, 0o644)
  for (const root of manifest.priorState.privateRoots) directory(root.path, ACCOUNT.uid, ACCOUNT.gid, Number.parseInt(root.mode, 8))
  directory(manifest.priorState.releaseRoot, 0, 0, 0o755)
  for (const installed of manifest.priorState.installedFiles) {
    const bytes = Buffer.from(`prior:${installed.id}\n`)
    installed.sha256 = sha256(bytes)
    file(installed.path, bytes, 0, 0, Number.parseInt(installed.mode, 8))
  }
  const authorizedKeys = Buffer.from(`${manifest.priorState.authorizedKeyPrefix}AAAAfixturekey\n`)
  file(manifest.priorState.authorizedKeysPath, authorizedKeys, ACCOUNT.uid, ACCOUNT.gid, 0o600)
  const priorRelease = Buffer.from(`${JSON.stringify({
    repository: manifest.repository,
    head_commit: manifest.priorState.commit,
    release_root: manifest.priorState.releaseRoot,
    reviewed: true,
  })}\n`)
  file(manifest.priorState.trustedReleaseManifestPath, priorRelease, 0, 0, 0o444)
  const provisionBytes = provisioningJournal()
  const repairBytes = repairJournal()
  const provisionPath = `${manifest.priorState.provisioningJournalPrefix}${PROVISION_ID}.mutation-journal.jsonl`
  const repairPath = `${manifest.priorState.repairJournalPrefix}${REPAIR_ID}.journal.jsonl`
  file(provisionPath, provisionBytes, 0, 0, 0o600)
  file(repairPath, repairBytes, 0, 0, 0o600)
  if (options.leasePresent) file(manifest.priorState.inactivePaths[0], Buffer.from("{}\n"), ACCOUNT.uid, ACCOUNT.gid, 0o600)
  directory(manifest.newRelease.reviewedCheckoutPath, 0, 0, 0o755)
  for (const source of Object.keys(manifest.newRelease.closure)) {
    file(path.posix.join(manifest.newRelease.reviewedCheckoutPath, source), Buffer.from(`new:${source}\n`), 0, 0, 0o444)
  }
  directory(manifest.packageRelease.checkoutPath, 0, 0, 0o755)
  for (const source of Object.keys(manifest.newRelease.installerBindings)) {
    file(path.posix.join(manifest.packageRelease.checkoutPath, source), Buffer.from(`new:${source}\n`), 0, 0, 0o444)
  }

  const manifestBytes = Buffer.from(`${canonicalizeUpgradeJcs(manifest)}\n`)
  const evidenceCheckoutPath = "/root/reviewed/evidence"
  directory(evidenceCheckoutPath, 0, 0, 0o755)
  file(path.posix.join(evidenceCheckoutPath,
    "config/execution-fabric/aegis-standing-hash-replay-ledger-upgrade.v1.json"), manifestBytes, 0, 0, 0o444)

  const authority = {
    schemaVersion: 1,
    authorityId: AUTHORITY_ID,
    upgradeId: manifest.upgradeId,
    repository: manifest.repository,
    machineIdSha256: manifest.machine.machineIdSha256,
    priorCommit: manifest.priorState.commit,
    newCommit: manifest.newRelease.commit,
    manifestSha256: sha256(manifestBytes),
    priorProvisioningAuthorityId: PROVISION_ID,
    priorProvisioningJournalSha256: sha256(provisionBytes),
    priorRepairAuthorityId: REPAIR_ID,
    priorRepairJournalSha256: sha256(repairBytes),
    priorReleaseManifestSha256: sha256(priorRelease),
    priorAuthorizedKeysSha256: sha256(authorizedKeys),
    priorInstalledSha256: Object.fromEntries(manifest.priorState.installedFiles.map((item: any) => [item.id, item.sha256])),
    newClosureSha256: manifest.newRelease.closure,
    newInstallerSha256: manifest.newRelease.installerBindings,
    reviewedCheckoutPath: manifest.newRelease.reviewedCheckoutPath,
    packageCommit: manifest.packageRelease.commit,
    packageCheckoutPath: manifest.packageRelease.checkoutPath,
    evidenceCommit: EVIDENCE_COMMIT,
    evidenceCheckoutPath,
    issuedAt: "2026-08-12T17:55:00.000Z",
    expiresAt: "2026-08-12T18:05:00.000Z",
    singleUse: true,
    consumed: false,
  }
  const authorityPath = `${AUTHORITY_ROOT}/${AUTHORITY_ID}.json`
  file(authorityPath, Buffer.from(`${canonicalizeUpgradeJcs(authority)}\n`), 0, 0, options.authorityMode ?? 0o600)
  if (options.occupiedLock) file(options.occupiedLock, Buffer.from("occupied\n"), ACCOUNT.uid, ACCOUNT.gid, 0o600)

  const mutationJournal = `${manifest.install.journalPrefix}${AUTHORITY_ID}.journal.jsonl`
  const injectedFailures = new Set<string>()
  const maybeFail = (name: string) => {
    if (options.failMutation === name && !injectedFailures.has(name)) {
      injectedFailures.add(name)
      const error = new Error(`injected ${name}`) as Error & { code?: string }
      error.code = "INJECTED_FAILURE"
      throw error
    }
  }
  const io = {
    platform: () => "linux",
    euid: () => 0,
    hostname: () => "aegis",
    inspect: (target: string) => {
      const entry = entries.get(target)
      return entry ? { type: entry.type, direct: entry.direct, nlink: entry.nlink, uid: entry.uid, gid: entry.gid, mode: entry.mode } : null
    },
    read: (target: string) => {
      const entry = entries.get(target)
      if (!entry || entry.type !== "file") throw Object.assign(new Error(`missing ${target}`), { code: "ENOENT" })
      return Buffer.from(entry.bytes!)
    },
    readStable: (target: string, expected: { uid: number, gid: number, mode: number }) => {
      const entry = entries.get(target)
      if (!entry || entry.type !== "file" || !entry.direct || entry.nlink !== 1
        || entry.uid !== expected.uid || entry.gid !== expected.gid || entry.mode !== expected.mode) {
        throw Object.assign(new Error("authority metadata differs"), { code: "AEGIS_REPLAY_UPGRADE_AUTHORITY_FILE_UNTRUSTED" })
      }
      return Buffer.from(entry.bytes!)
    },
    account: () => ({ ...ACCOUNT }),
    verifyCheckout: (checkout: string, commit: string, repository: string, closure: Record<string, string>) => {
      events.push(`verify:${checkout}`)
      if (options.dirtyCheckout && checkout === manifest.newRelease.reviewedCheckoutPath) {
        throw Object.assign(new Error("AEGIS_REPLAY_UPGRADE_CHECKOUT_DRIFT: dirty"),
          { code: "AEGIS_REPLAY_UPGRADE_CHECKOUT_DRIFT" })
      }
      const prior = checkout === manifest.priorState.releaseRoot
      const packageCheckout = checkout === manifest.packageRelease.checkoutPath
      const evidenceCheckout = checkout === evidenceCheckoutPath
      expect(commit).toBe(prior ? manifest.priorState.commit : packageCheckout ? manifest.packageRelease.commit
        : evidenceCheckout ? EVIDENCE_COMMIT : manifest.newRelease.commit)
      expect(repository).toBe(manifest.repository)
      expect(closure).toEqual(prior ? priorClosure : packageCheckout ? manifest.newRelease.installerBindings : evidenceCheckout ? {
        "config/execution-fabric/aegis-standing-hash-replay-ledger-upgrade.v1.json": sha256(manifestBytes),
      } : manifest.newRelease.closure)
    },
    verifyAncestry: (checkout: string, ancestor: string, descendant: string) => {
      events.push(`ancestry:${checkout}`)
      if (checkout === manifest.packageRelease.checkoutPath) {
        expect(ancestor).toBe(manifest.newRelease.commit)
        expect(descendant).toBe(manifest.packageRelease.commit)
      } else {
        expect(checkout).toBe(evidenceCheckoutPath)
        expect(ancestor).toBe(manifest.packageRelease.commit)
        expect(descendant).toBe(EVIDENCE_COMMIT)
      }
      if (options.ancestryValid === false) throw Object.assign(new Error("not ancestor"), { code: "CHECKOUT_DRIFT" })
    },
    publishRelease: (source: string, destination: string) => {
      maybeFail("PUBLISH_CONTENT_ADDRESSED_RELEASE")
      events.push("PUBLISH_CONTENT_ADDRESSED_RELEASE")
      directory(destination, 0, 0, 0o755)
      for (const [target, entry] of [...entries]) {
        if (target.startsWith(`${source}/`)) file(`${destination}${target.slice(source.length)}`, entry.bytes!, 0, 0, entry.mode)
      }
    },
    createFileExclusive: (target: string, bytes: Buffer, uid: number, gid: number, mode: number) => {
      const name = target === manifest.install.replayJournalPath ? "CREATE_EMPTY_REPLAY_JOURNAL"
        : target === manifest.install.activationMarkerPath ? "CREATE_ACTIVATION_MARKER" : "INSTALL_REPLAY_HELPER"
      maybeFail(name)
      if (entries.has(target)) throw Object.assign(new Error("exists"), { code: "EEXIST" })
      events.push(name)
      file(target, bytes, uid, gid, mode)
    },
    acquireLock: (target: string, bytes: Buffer, uid: number, gid: number, mode: number) => {
      if (entries.has(target) || options.failAcquireLock === target) {
        throw Object.assign(new Error("AEGIS_REPLAY_UPGRADE_LOCK_OCCUPIED: occupied"),
          { code: "AEGIS_REPLAY_UPGRADE_LOCK_OCCUPIED" })
      }
      events.push(`LOCK_ACQUIRED:${target}`)
      file(target, bytes, uid, gid, mode)
    },
    releaseLock: (target: string, bytes: Buffer, uid: number, gid: number, mode: number) => {
      const entry = entries.get(target)
      expect(entry).toMatchObject({ uid, gid, mode, direct: true, nlink: 1 })
      expect(entry!.bytes).toEqual(bytes)
      if (options.failReleaseLock === target) throw Object.assign(new Error("release failed"), { code: "EIO" })
      events.push(`LOCK_RELEASED:${target}`)
      entries.delete(target)
    },
    atomicReplace: (target: string, bytes: Buffer, uid: number, gid: number, mode: number) => {
      const name = target === manifest.install.replayInitializerPath ? "REPLACE_REPLAY_INITIALIZER"
        : target === manifest.install.bootstrapPath ? "REPLACE_BOOTSTRAP" : "REPLACE_TRUSTED_RELEASE_MANIFEST"
      if (options.failRestoreMutation === name && events.includes(name)) {
        throw Object.assign(new Error(`injected restore ${name}`), { code: "INJECTED_RESTORE_FAILURE" })
      }
      maybeFail(name)
      events.push(name)
      file(target, bytes, uid, gid, mode)
      if (options.failAfterReplace === name && !injectedFailures.has(`after:${name}`)) {
        injectedFailures.add(`after:${name}`)
        throw Object.assign(new Error(`injected post-replace ${name}`), { code: "INJECTED_POST_REPLACE_FAILURE" })
      }
    },
    run: (binary: string, args: string[]) => {
      if (binary === CHATTR) {
        maybeFail("SET_AND_VERIFY_APPEND_ONLY")
        events.push("SET_AND_VERIFY_APPEND_ONLY")
        entries.get(args.at(-1)!)!.appendOnly = true
        return { status: 0, stdout: "", stderr: "" }
      }
      expect(binary).toBe(LSATTR)
      const appendOnly = options.appendOnlyPostcheck !== false && entries.get(args.at(-1)!)?.appendOnly
      return { status: 0, stdout: `${appendOnly ? "-----a-------" : "-------------"} ${args.at(-1)}\n`, stderr: "" }
    },
    createJournal: (target: string, record: unknown) => {
      events.push("JOURNAL_PREPARED")
      if (entries.has(target)) throw Object.assign(new Error("exists"), { code: "EEXIST" })
      file(target, Buffer.from(`${canonicalizeUpgradeJcs(record)}\n`), 0, 0, 0o600)
    },
    appendJournal: (target: string, record: any) => {
      if (options.failTerminalJournal) throw Object.assign(new Error("journal fsync failed"), { code: "EIO" })
      events.push(`JOURNAL_${record.record_type}`)
      const entry = entries.get(target)!
      entry.bytes = Buffer.concat([entry.bytes!, Buffer.from(`${canonicalizeUpgradeJcs(record)}\n`)])
    },
  }
  return { manifest, manifestBytes, authority, authorityPath, entries, events, io, mutationJournal, priorRelease,
    authorizedKeys, provisionBytes, repairBytes }
}

function run(value: ReturnType<typeof fixture>, mode: "dry-run" | "apply" = "dry-run") {
  return upgradeAegisStandingHashReplayLedger({
    manifest: value.manifest,
    manifestBytes: value.manifestBytes,
    authority: value.authority,
    mode,
    repoRoot: "C:/fixture",
    io: value.io as any,
    clock: () => NOW,
    machineIdentitySha256: value.manifest.machine.machineIdSha256,
  })
}

describe("AEGIS standing hash replay-ledger one-shot upgrade", () => {
  it("pins the checked-in package to the exact reviewed runtime and installer release", () => {
    const manifest = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"))
    expect(validateAegisStandingHashReplayLedgerUpgradeManifest(manifest)).toMatchObject({
      newRelease: { commit: "b1637a0d16394361dff74e1fb85851ba61f91235" },
      packageRelease: { commit: "b1637a0d16394361dff74e1fb85851ba61f91235" },
    })
  })

  it("performs a complete dry-run without consuming authority or mutating state", () => {
    const value = fixture()
    const before = structuredClone([...value.entries].map(([key, entry]) => [key, { ...entry, bytes: entry.bytes?.toString("hex") }]))
    const evidence = run(value)

    expect(evidence).toMatchObject({ status: "DRY_RUN", authority_consumed: false, activated: false,
      completed_mutations: [], authorized_keys_mutated: false, network_accessed: false })
    expect(value.events.filter((event) => !event.startsWith("verify:") && !event.startsWith("ancestry:"))).toEqual([])
    expect([...value.entries].map(([key, entry]) => [key, { ...entry, bytes: entry.bytes?.toString("hex") }])).toEqual(before)
  })

  it("applies in the exact order and makes the release manifest the final activation mutation", () => {
    const value = fixture()
    const result = run(value, "apply")

    expect(result.status).toBe("COMMITTED")
    expect(value.events.filter((event) => !event.startsWith("verify:") && !event.startsWith("ancestry:"))).toEqual([
      `LOCK_ACQUIRED:${NODE_MUTATION_LOCK_PATH}`,
      `LOCK_ACQUIRED:${LEDGER_MUTATION_LOCK_PATH}`,
      "JOURNAL_PREPARED",
      "PUBLISH_CONTENT_ADDRESSED_RELEASE",
      "CREATE_EMPTY_REPLAY_JOURNAL",
      "SET_AND_VERIFY_APPEND_ONLY",
      "INSTALL_REPLAY_HELPER",
      "REPLACE_REPLAY_INITIALIZER",
      "REPLACE_BOOTSTRAP",
      "CREATE_ACTIVATION_MARKER",
      "REPLACE_TRUSTED_RELEASE_MANIFEST",
      "JOURNAL_COMMITTED",
      `LOCK_RELEASED:${LEDGER_MUTATION_LOCK_PATH}`,
      `LOCK_RELEASED:${NODE_MUTATION_LOCK_PATH}`,
    ])
    const replay = value.entries.get(value.manifest.install.replayJournalPath)!
    expect(replay).toMatchObject({ uid: 0, gid: ACCOUNT.gid, mode: 0o660, appendOnly: true })
    expect(replay.bytes).toHaveLength(0)
    expect(value.entries.get(value.manifest.priorState.releaseRoot)).toBeDefined()
    expect(value.entries.get(value.manifest.priorState.authorizedKeysPath)!.bytes).toEqual(value.authorizedKeys)
    expect(value.entries.get(`${value.manifest.priorState.provisioningJournalPrefix}${PROVISION_ID}.mutation-journal.jsonl`)!.bytes).toEqual(value.provisionBytes)
    expect(value.entries.get(`${value.manifest.priorState.repairJournalPrefix}${REPAIR_ID}.journal.jsonl`)!.bytes).toEqual(value.repairBytes)
    const records = value.entries.get(value.mutationJournal)!.bytes!.toString("utf8").trim().split("\n").map(JSON.parse)
    expect(records.map(({ record_type }) => record_type)).toEqual(["PREPARED", "COMMITTED"])
    expect(records[1].completed_mutations).toEqual(value.manifest.install.activationOrder)
    expect(result).toMatchObject({ replay_epoch_initialized: false, operational: false,
      next_non_root_step: "INITIALIZE_REPLAY_EPOCH_AS_WILLIAMOS_FABRIC" })
    const markerBytes = value.entries.get(ACTIVATION_MARKER_PATH)!.bytes!
    const marker = JSON.parse(markerBytes.toString("utf8"))
    expect(Object.keys(marker).sort()).toEqual([
      "authority_id", "manifest_sha256", "new_commit", "prepared_at", "runtime_closure_sha256",
      "schema_version", "upgrade_id",
    ])
    expect(marker.runtime_closure_sha256).toEqual(value.manifest.newRelease.closure)
    expect(value.entries.get(ACTIVATION_MARKER_PATH)).toMatchObject({ uid: 0, gid: 0, mode: 0o444, nlink: 1, direct: true })
    const trusted = JSON.parse(value.entries.get(value.manifest.priorState.trustedReleaseManifestPath)!.bytes!.toString("utf8"))
    expect(trusted).toMatchObject({ activation_marker_path: ACTIVATION_MARKER_PATH,
      activation_marker_sha256: canonicalSha256(marker) })
    expect(validateActivationMarker(trusted, markerBytes)).toEqual(marker)
  })

  it.each([
    ["consumed authority", (value: ReturnType<typeof fixture>) => { value.authority.consumed = true }, "AEGIS_REPLAY_UPGRADE_AUTHORITY_REPLAY"],
    ["expired authority", (value: ReturnType<typeof fixture>) => { value.authority.expiresAt = NOW }, "AEGIS_REPLAY_UPGRADE_AUTHORITY_EXPIRED"],
    ["future authority", (value: ReturnType<typeof fixture>) => { value.authority.issuedAt = "2026-08-12T18:01:00.000Z" }, "AEGIS_REPLAY_UPGRADE_AUTHORITY_EXPIRED"],
    ["scope mismatch", (value: ReturnType<typeof fixture>) => { value.authority.newCommit = "b".repeat(40) }, "AEGIS_REPLAY_UPGRADE_AUTHORITY_SCOPE_MISMATCH"],
  ])("rejects %s before authority-journal creation", (_label, mutate, code) => {
    const value = fixture()
    mutate(value)
    expect(() => run(value, "apply")).toThrow(code)
    expect(value.entries.has(value.mutationJournal)).toBe(false)
  })

  it("refuses authority replay when its durable journal already exists", () => {
    const value = fixture()
    value.entries.set(value.mutationJournal, { type: "file", bytes: Buffer.from("retained\n"), uid: 0, gid: 0,
      mode: 0o600, direct: true, nlink: 1 })
    expect(() => run(value, "apply")).toThrow("AEGIS_REPLAY_UPGRADE_AUTHORITY_REPLAY")
  })

  it.each([
    ["active node lease", { leasePresent: true }, "AEGIS_REPLAY_UPGRADE_PRIOR_STATE_DRIFT"],
    ["dirty reviewed checkout", { dirtyCheckout: true }, "AEGIS_REPLAY_UPGRADE_CHECKOUT_DRIFT"],
  ])("refuses %s before mutation", (_label, options, code) => {
    const value = fixture(options)
    expect(() => run(value, "apply")).toThrow(code)
    expect(value.entries.has(value.mutationJournal)).toBe(false)
  })

  it("refuses a prior installed digest mismatch before mutation", () => {
    const value = fixture()
    value.entries.get(value.manifest.priorState.installedFiles[0].path)!.bytes = Buffer.from("drift\n")
    expect(() => run(value, "apply")).toThrow("AEGIS_REPLAY_UPGRADE_PRIOR_STATE_DRIFT")
    expect(value.entries.has(value.mutationJournal)).toBe(false)
  })

  it("binds the privileged upgrader and replay initializer to the clean package checkout", () => {
    const value = fixture()
    expect(Object.keys(value.manifest.newRelease.installerBindings).sort()).toEqual([
      "scripts/execution-fabric/provision/aegis-standing-hash-replay-epoch.mjs",
      "scripts/execution-fabric/provision/upgrade-aegis-standing-hash-replay-ledger.mjs",
    ])
    const upgrader = "scripts/execution-fabric/provision/upgrade-aegis-standing-hash-replay-ledger.mjs"
    value.entries.get(path.posix.join(value.manifest.packageRelease.checkoutPath, upgrader))!.bytes = Buffer.from("drift\n")
    expect(() => run(value, "apply")).toThrow("AEGIS_REPLAY_UPGRADE_CHECKOUT_DRIFT")
    expect(value.entries.has(value.mutationJournal)).toBe(false)
  })

  it("requires the runtime PR checkout commit to be an ancestor of the package commit", () => {
    const value = fixture({ ancestryValid: false })
    expect(() => run(value, "apply")).toThrow("AEGIS_REPLAY_UPGRADE_CHECKOUT_DRIFT")
    expect(value.entries.has(value.mutationJournal)).toBe(false)
  })

  it("binds finalized manifest bytes through a later evidence checkout without a self-referential package commit", () => {
    const value = fixture()
    run(value)
    expect(value.events).toContain(`verify:${value.authority.evidenceCheckoutPath}`)
    expect(value.events).toContain(`ancestry:${value.authority.evidenceCheckoutPath}`)
    expect(value.authority.evidenceCommit).not.toBe(value.manifest.packageRelease.commit)
  })

  it.each([NODE_MUTATION_LOCK_PATH, LEDGER_MUTATION_LOCK_PATH])("fails closed when %s is occupied", (lockPath) => {
    const value = fixture({ occupiedLock: lockPath })
    expect(() => run(value, "apply")).toThrow("AEGIS_REPLAY_UPGRADE_LOCK_OCCUPIED")
    expect(value.entries.has(value.mutationJournal)).toBe(false)
  })

  it("releases the first lock if atomic acquisition of the second lock loses contention", () => {
    const value = fixture({ failAcquireLock: LEDGER_MUTATION_LOCK_PATH })
    expect(() => run(value, "apply")).toThrow("AEGIS_REPLAY_UPGRADE_LOCK_OCCUPIED")
    expect(value.entries.has(NODE_MUTATION_LOCK_PATH)).toBe(false)
    expect(value.entries.has(value.mutationJournal)).toBe(false)
  })

  it("fails closed instead of returning committed when lock release cannot be proven", () => {
    const value = fixture({ failReleaseLock: LEDGER_MUTATION_LOCK_PATH })
    let failure: any
    try { run(value, "apply") } catch (error) { failure = error }
    expect(failure.code).toBe("AEGIS_REPLAY_UPGRADE_LOCK_RELEASE_UNCERTAIN")
    expect(failure.authorityConsumed).toBe(true)
    expect(value.entries.has(LEDGER_MUTATION_LOCK_PATH)).toBe(true)
    expect(value.entries.has(NODE_MUTATION_LOCK_PATH)).toBe(false)
  })

  it("rejects a CLI authority outside the fixed UUID path before reading it", () => {
    const stderr = { value: "", write(chunk: string) { this.value += chunk } }
    const status = main(["--dry-run", "--authority", "/tmp/authority.json"], { stderr })
    expect(status).toBe(2)
    expect(stderr.value).toContain("AEGIS_REPLAY_UPGRADE_AUTHORITY_PATH_INVALID")
  })

  it("requires root-owned direct nlink-1 mode-0600 authority metadata through stable read", () => {
    const value = fixture({ authorityMode: 0o640 })
    const stderr = { value: "", write(chunk: string) { this.value += chunk } }
    const status = main(["--dry-run", "--authority", value.authorityPath], {
      io: value.io, stderr, repoRoot: "C:/fixture", clock: () => NOW,
      machineIdentitySha256: value.manifest.machine.machineIdSha256,
    })
    expect(status).toBe(2)
    expect(stderr.value).toContain("AEGIS_REPLAY_UPGRADE_AUTHORITY_FILE_UNTRUSTED")
  })

  it("fails closed when lsattr does not prove the append-only fence", () => {
    const value = fixture({ appendOnlyPostcheck: false })
    let failure: any
    try { run(value, "apply") } catch (error) { failure = error }

    expect(failure.code).toBe("AEGIS_REPLAY_UPGRADE_APPEND_ONLY_FAILED")
    expect(failure.authorityConsumed).toBe(true)
    expect(failure.completedMutations).toEqual(["PUBLISH_CONTENT_ADDRESSED_RELEASE", "CREATE_EMPTY_REPLAY_JOURNAL"])
    expect(value.events).not.toContain("INSTALL_REPLAY_HELPER")
    const records = value.entries.get(value.mutationJournal)!.bytes!.toString("utf8").trim().split("\n").map(JSON.parse)
    expect(records.map(({ record_type }) => record_type)).toEqual(["PREPARED", "FAILED_PARTIAL"])
  })

  it("records an exact partial failure and leaves final activation untouched", () => {
    const value = fixture({ failMutation: "REPLACE_BOOTSTRAP" })
    const priorManifest = Buffer.from(value.entries.get(value.manifest.priorState.trustedReleaseManifestPath)!.bytes!)
    let failure: any
    try { run(value, "apply") } catch (error) { failure = error }

    expect(failure.code).toBe("INJECTED_FAILURE")
    expect(failure.completedMutations).toEqual(value.manifest.install.activationOrder.slice(0, 5))
    expect(value.entries.get(value.manifest.priorState.trustedReleaseManifestPath)!.bytes).toEqual(priorManifest)
    const records = value.entries.get(value.mutationJournal)!.bytes!.toString("utf8").trim().split("\n").map(JSON.parse)
    expect(records[1]).toMatchObject({ record_type: "FAILED_PARTIAL", activation_manifest_replaced: false })
  })

  it("creates the activation marker before manifest replacement and restores executables on activation failure", () => {
    const value = fixture({ failMutation: "REPLACE_TRUSTED_RELEASE_MANIFEST" })
    const oldBootstrap = Buffer.from(value.entries.get(value.manifest.install.bootstrapPath)!.bytes!)
    const oldInitializer = Buffer.from(value.entries.get(value.manifest.install.replayInitializerPath)!.bytes!)
    let failure: any
    try { run(value, "apply") } catch (error) { failure = error }

    expect(failure.code).toBe("INJECTED_FAILURE")
    expect(failure.completedMutations.at(-1)).toBe("CREATE_ACTIVATION_MARKER")
    expect(value.manifest.install.activationOrder.indexOf("CREATE_ACTIVATION_MARKER")).toBe(
      value.manifest.install.activationOrder.indexOf("REPLACE_TRUSTED_RELEASE_MANIFEST") - 1,
    )
    expect(value.entries.get(value.manifest.install.bootstrapPath)!.bytes).toEqual(oldBootstrap)
    expect(value.entries.get(value.manifest.install.replayInitializerPath)!.bytes).toEqual(oldInitializer)
    expect(value.entries.get(value.manifest.priorState.trustedReleaseManifestPath)!.bytes).toEqual(value.priorRelease)
    expect(value.entries.get(ACTIVATION_MARKER_PATH)).toBeDefined()
    const records = value.entries.get(value.mutationJournal)!.bytes!.toString("utf8").trim().split("\n").map(JSON.parse)
    expect(records[1]).toMatchObject({ prior_bootstrap_restored: true, prior_initializer_restored: true,
      activation_manifest_replaced: true, prior_release_manifest_restored: true })
  })

  it("restores the prior manifest when durability fails after its rename", () => {
    const value = fixture({ failAfterReplace: "REPLACE_TRUSTED_RELEASE_MANIFEST" })
    const priorManifest = Buffer.from(value.entries.get(value.manifest.priorState.trustedReleaseManifestPath)!.bytes!)
    let failure: any
    try { run(value, "apply") } catch (error) { failure = error }

    expect(failure.code).toBe("INJECTED_POST_REPLACE_FAILURE")
    expect(value.entries.get(value.manifest.priorState.trustedReleaseManifestPath)!.bytes).toEqual(priorManifest)
    const records = value.entries.get(value.mutationJournal)!.bytes!.toString("utf8").trim().split("\n").map(JSON.parse)
    expect(records[1]).toMatchObject({ record_type: "FAILED_PARTIAL", activation_manifest_replaced: true,
      prior_release_manifest_restored: true })
  })

  it("attempts the prior manifest restoration even when an earlier executable restoration fails", () => {
    const value = fixture({ failAfterReplace: "REPLACE_TRUSTED_RELEASE_MANIFEST", failRestoreMutation: "REPLACE_BOOTSTRAP" })
    let failure: any
    try { run(value, "apply") } catch (error) { failure = error }
    expect(failure.code).toBe("AEGIS_REPLAY_UPGRADE_RECOVERY_UNCERTAIN")
    expect(value.entries.get(value.manifest.priorState.trustedReleaseManifestPath)!.bytes).toEqual(value.priorRelease)
    const records = value.entries.get(value.mutationJournal)!.bytes!.toString("utf8").trim().split("\n").map(JSON.parse)
    expect(records[1]).toMatchObject({ prior_bootstrap_restored: false, prior_initializer_restored: true,
      prior_release_manifest_restored: true })
  })

  it("reports uncertain evidence if a partial failure cannot be durably terminalized", () => {
    const value = fixture({ failMutation: "INSTALL_REPLAY_HELPER", failTerminalJournal: true })
    let failure: any
    try { run(value, "apply") } catch (error) { failure = error }

    expect(failure.code).toBe("AEGIS_REPLAY_UPGRADE_EVIDENCE_UNCERTAIN")
    expect(replayLedgerUpgradeErrorEvidence(failure)).toMatchObject({
      status: "FAILED_CLOSED",
      authority_consumed: true,
      original_failure_code: "INJECTED_FAILURE",
      cause_code: "EIO",
      completed_mutations: ["PUBLISH_CONTENT_ADDRESSED_RELEASE", "CREATE_EMPTY_REPLAY_JOURNAL", "SET_AND_VERIFY_APPEND_ONLY"],
    })
  })

  it("restores the prior activation state if committed-journal persistence fails after manifest replacement", () => {
    const value = fixture({ failTerminalJournal: true })
    const oldBootstrap = Buffer.from(value.entries.get(value.manifest.install.bootstrapPath)!.bytes!)
    const oldInitializer = Buffer.from(value.entries.get(value.manifest.install.replayInitializerPath)!.bytes!)
    let failure: any
    try { run(value, "apply") } catch (error) { failure = error }

    expect(failure.code).toBe("AEGIS_REPLAY_UPGRADE_EVIDENCE_UNCERTAIN")
    expect(failure.completedMutations).toEqual(value.manifest.install.activationOrder)
    expect(value.entries.get(value.manifest.install.bootstrapPath)!.bytes).toEqual(oldBootstrap)
    expect(value.entries.get(value.manifest.install.replayInitializerPath)!.bytes).toEqual(oldInitializer)
    expect(value.entries.get(value.manifest.priorState.trustedReleaseManifestPath)!.bytes).toEqual(value.priorRelease)
    expect(value.entries.get(ACTIVATION_MARKER_PATH)).toBeDefined()
    expect(value.entries.has(NODE_MUTATION_LOCK_PATH)).toBe(false)
    expect(value.entries.has(LEDGER_MUTATION_LOCK_PATH)).toBe(false)
  })

  it("contains no network, workload, scheduler, account, authorized_keys, sudo, or shell mutation primitive", () => {
    const source = fs.readFileSync(path.resolve("scripts/execution-fabric/provision/upgrade-aegis-standing-hash-replay-ledger.mjs"), "utf8")
    expect(source).not.toMatch(/node:(?:net|http|https|http2|tls|dgram|dns)/)
    expect(source).not.toMatch(/\b(?:fetch|WebSocket|systemctl|crontab|schtasks)\s*\(?/)
    expect(source).not.toMatch(/\b(?:sudo|doas|pkexec|useradd|usermod|groupadd)\b/)
    expect(source).not.toMatch(/shell\s*:\s*true/)
    expect(source).not.toMatch(/atomicReplace\([^\n]*authorizedKeysPath/)
    expect(source).toContain(`export const CHATTR = "${CHATTR}"`)
    expect(source).toContain(`export const LSATTR = "${LSATTR}"`)
  })
})
