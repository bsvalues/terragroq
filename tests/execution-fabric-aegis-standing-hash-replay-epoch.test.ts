import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createAegisStandingHashEpochRecord,
  EPOCH_LOCK_BASENAME,
  initializeAegisStandingHashReplayEpoch,
  JOURNAL_EPOCH_ID,
  JOURNAL_IDENTIFIER,
  main,
  validateAegisStandingHashEpochRecord,
} from "../scripts/execution-fabric/provision/aegis-standing-hash-replay-epoch.mjs"
import {
  createAegisStandingHashReplayLedger,
  REPLAY_JOURNAL_BASENAME,
} from "../scripts/execution-fabric/provision/aegis-standing-hash-replay-ledger.mjs"
import { canonicalizeJcs } from "../scripts/execution-fabric/canonical-json.mjs"

const UID = 1001
const GID = 1002
const AT = "2026-08-11T18:00:00.000Z"
const BOOT_ID = "12345678-1234-4123-8123-123456789abc"
const roots: string[] = []
let sequence = 0

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
  sequence = 0
  vi.restoreAllMocks()
})

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-private-replay-"))
  roots.push(root)
  fs.chmodSync(root, 0o700)
  return root
}

function decoratedFs(root: string) {
  const journal = path.join(root, REPLAY_JOURNAL_BASENAME)
  const decorate = (stats: fs.Stats, target: string) => Object.assign(
    Object.create(Object.getPrototypeOf(stats)),
    stats,
    target === journal
      ? { uid: 0, gid: GID, mode: 0o100660 }
      : { uid: UID, gid: GID, mode: stats.isDirectory() ? 0o40700 : 0o100600 },
  )
  const api = Object.create(fs) as typeof fs
  api.lstatSync = ((candidate: fs.PathLike) => decorate(fs.lstatSync(candidate), path.resolve(String(candidate)))) as typeof fs.lstatSync
  api.fstatSync = ((descriptor: number) => {
    const stats = fs.fstatSync(descriptor)
    return Object.assign(Object.create(Object.getPrototypeOf(stats)), stats, { uid: 0, gid: GID, mode: 0o100660 })
  }) as typeof fs.fstatSync
  return api
}

function realLedger(root = tempRoot()) {
  const journal = path.join(root, REPLAY_JOURNAL_BASENAME)
  fs.writeFileSync(journal, "", { mode: 0o660 })
  const fsApi = decoratedFs(root)
  return {
    root,
    journal,
    fsApi,
    ledger: createAegisStandingHashReplayLedger({
      ledgerRoot: root,
      uid: UID,
      gid: GID,
      fsApi,
      clock: () => AT,
      validateDirectory: (stats: fs.Stats) => stats.isDirectory() && !stats.isSymbolicLink(),
      hasAppendOnlyAttribute: () => true,
      syncDirectory: vi.fn(),
    }),
  }
}

function epoch() {
  return createAegisStandingHashEpochRecord(AT)
}

function initializer(overrides: Record<string, unknown> = {}) {
  const value = realLedger()
  return {
    ...value,
    options: {
      platform: "linux",
      getuid: () => UID,
      getgid: () => GID,
      username: () => "williamos-fabric",
      hostname: () => "aegis",
      clock: () => AT,
      fsApi: value.fsApi,
      ledgerRoot: value.root,
      randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
      holderIdentity: (uid: number, token: string) => ({
        pid: 101,
        uid,
        boot_id: BOOT_ID,
        process_start_ticks: "1001",
        token,
      }),
      holderLiveness: () => "ALIVE",
      validateDirectory: (stats: fs.Stats) => stats.isDirectory() && !stats.isSymbolicLink(),
      validateFile: (stats: fs.Stats) => stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1,
      syncDirectory: vi.fn(),
      replayLedger: value.ledger,
      ...overrides,
    },
  }
}

describe("AEGIS private replay ledger", () => {
  it("appends canonical, contiguous, hash-chained records and rereads the exact tail", () => {
    const value = realLedger()
    const first = value.ledger.append(epoch())
    const claim = { record_type: "CLAIM", claim_key_sha256: "1".repeat(64) }
    const second = value.ledger.append(claim)

    expect(value.ledger.read().map(({ record }) => record)).toEqual([epoch(), claim])
    expect(first.sequence).toBe(1)
    expect(second.sequence).toBe(2)
    expect(second.previous_entry_sha256).toBe(first.entry_sha256)
    const lines = fs.readFileSync(value.journal, "utf8").trim().split("\n")
    expect(lines.every((line) => canonicalizeJcs(JSON.parse(line)) === line)).toBe(true)
  })

  it.each([
    ["truncated tail", `${canonicalizeJcs({ broken: true })}`],
    ["malformed JSON", "not-json\n"],
  ])("rejects %s", (_label, bytes) => {
    const value = realLedger()
    fs.writeFileSync(value.journal, bytes)
    expect(() => value.ledger.read()).toThrow("AEGIS_REPLAY_JOURNAL_UNTRUSTED")
  })

  it("rejects a changed chain digest", () => {
    const value = realLedger()
    value.ledger.append(epoch())
    const retained = JSON.parse(fs.readFileSync(value.journal, "utf8"))
    retained.entry_sha256 = "0".repeat(64)
    fs.writeFileSync(value.journal, `${canonicalizeJcs(retained)}\n`)
    expect(() => value.ledger.read()).toThrow("AEGIS_REPLAY_JOURNAL_UNTRUSTED")
  })

  it("rejects a missing append-only fence", () => {
    const root = tempRoot()
    fs.writeFileSync(path.join(root, REPLAY_JOURNAL_BASENAME), "", { mode: 0o660 })
    expect(() => createAegisStandingHashReplayLedger({
      ledgerRoot: root,
      uid: UID,
      gid: GID,
      fsApi: decoratedFs(root),
      validateDirectory: (stats: fs.Stats) => stats.isDirectory(),
      hasAppendOnlyAttribute: () => false,
    })).toThrow("AEGIS_REPLAY_JOURNAL_UNTRUSTED")
  })

  it("rejects a hard-linked journal", () => {
    const value = realLedger()
    fs.linkSync(value.journal, path.join(value.root, "alias"))
    expect(() => value.ledger.read()).toThrow("AEGIS_REPLAY_JOURNAL_UNTRUSTED")
  })
})

describe("AEGIS replay epoch initializer", () => {
  it("creates and validates one canonical digest-bound epoch", () => {
    expect(epoch()).toEqual({
      record_type: "EPOCH",
      epoch_id: JOURNAL_EPOCH_ID,
      initialized_at: AT,
      journal_record_sha256: "220faa88aff3c05bc69ed0aa14ba38e6483beac798df7bdcf687fe2681410e23",
    })
    expect(validateAegisStandingHashEpochRecord(epoch())).toEqual(epoch())
  })

  it.each([
    ["wrong platform", { platform: "win32" }, "AEGIS_REPLAY_LINUX_REQUIRED"],
    ["root", { getuid: () => 0 }, "AEGIS_REPLAY_IDENTITY_REJECTED"],
    ["missing group", { getgid: null }, "AEGIS_REPLAY_IDENTITY_REJECTED"],
    ["wrong account", { username: () => "root" }, "AEGIS_REPLAY_IDENTITY_REJECTED"],
    ["wrong host", { hostname: () => "hermes" }, "AEGIS_REPLAY_HOST_REJECTED"],
  ])("rejects %s before mutation", (_label, overrides, code) => {
    const value = initializer(overrides)
    expect(() => initializeAegisStandingHashReplayEpoch(value.options)).toThrow(code)
    expect(value.ledger.read()).toEqual([])
  })

  it("establishes once and returns idempotent retained evidence", () => {
    const value = initializer()
    expect(initializeAegisStandingHashReplayEpoch(value.options)).toMatchObject({
      status: "ESTABLISHED",
      already_established: false,
      identifier: JOURNAL_IDENTIFIER,
      epoch_count: 1,
      workload_executed: false,
      scheduler_activated: false,
      network_accessed: false,
    })
    expect(initializeAegisStandingHashReplayEpoch(value.options)).toMatchObject({
      status: "ALREADY_ESTABLISHED",
      already_established: true,
      epoch_count: 1,
    })
    expect(value.ledger.read()).toHaveLength(1)
  })

  it("refuses reconstruction when a claim exists without an epoch", () => {
    const value = initializer()
    value.ledger.append({ record_type: "CLAIM", claim_key_sha256: "1".repeat(64) })
    expect(() => initializeAegisStandingHashReplayEpoch(value.options)).toThrow(
      "AEGIS_REPLAY_EPOCH_PREEXISTING_RECORDS",
    )
  })

  it("holds the shared mutation lock while initializing", () => {
    const value = initializer()
    const lock = path.join(value.root, EPOCH_LOCK_BASENAME)
    let observed = false
    const replayLedger = {
      read: () => value.ledger.read(),
      append: (record: Record<string, unknown>) => {
        observed = fs.existsSync(lock)
        return value.ledger.append(record)
      },
    }
    expect(initializeAegisStandingHashReplayEpoch({ ...value.options, replayLedger })).toMatchObject({ status: "ESTABLISHED" })
    expect(observed).toBe(true)
    expect(fs.existsSync(lock)).toBe(false)
  })

  it("rejects CLI arguments before initialization", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    expect(main(["--unexpected"])).toBe(2)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("AEGIS_REPLAY_ARGUMENT_REJECTED"))
  })

  it("contains no system journal, network, scheduler, privilege escalation, or shell path", () => {
    const modulePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts/execution-fabric/provision/aegis-standing-hash-replay-epoch.mjs")
    const source = fs.readFileSync(modulePath, "utf8")
    expect(source).not.toMatch(/journalctl|systemd-cat/)
    expect(source).not.toMatch(/\b(?:fetch|WebSocket|XMLHttpRequest|curl|wget|ssh|scp|sudo|su|pkexec)\b/)
    expect(source).not.toMatch(/shell\s*:\s*true/)
    expect(source).toContain(`export const LEDGER_ROOT = "/var/lib/williamos/fabric/standing-hash-ledger"`)
    expect(source).toContain(`export const EPOCH_LOCK_BASENAME = "standing-hash-mutation.lock"`)
  })
})
