import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createAegisStandingHashEpochRecord,
  EPOCH_LOCK_BASENAME,
  initializeAegisStandingHashReplayEpoch,
  JOURNALCTL_BINARY,
  JOURNAL_EPOCH_ID,
  JOURNAL_IDENTIFIER,
  parseAegisStandingHashJournal,
  SYSTEMD_CAT_BINARY,
  validateAegisStandingHashEpochRecord,
} from "../scripts/execution-fabric/provision/aegis-standing-hash-replay-epoch.mjs"
import { canonicalizeJcs } from "../scripts/execution-fabric/canonical-json.mjs"

const UID = 1001
const INITIALIZED_AT = "2026-08-11T18:00:00.000Z"
const FIXED_ENV = {
  HOME: "/home/williamos-fabric",
  LANG: "C",
  LC_ALL: "C",
  LOGNAME: "williamos-fabric",
  PATH: "/usr/bin:/bin",
  USER: "williamos-fabric",
}
const FIXED_OPTIONS = {
  encoding: "utf8",
  env: FIXED_ENV,
  maxBuffer: 4 * 1024 * 1024,
  shell: false,
  timeout: 15_000,
  windowsHide: true,
}
const JOURNAL_QUERY = [
  "--no-pager",
  "--output=json",
  `--identifier=${JOURNAL_IDENTIFIER}`,
]
const modulePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../scripts/execution-fabric/provision/aegis-standing-hash-replay-epoch.mjs",
)
const tempRoots: string[] = []
const BOOT_ID = "12345678-1234-4123-8123-123456789abc"
let uuidSequence = 0

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
  uuidSequence = 0
})

type ChildResult = {
  status: number | null
  stdout?: string
  stderr?: string
  error?: Error
}

type SpawnOptions = {
  encoding: "utf8"
  env: typeof FIXED_ENV
  input?: string
  maxBuffer: number
  shell: false
  timeout: number
  windowsHide: true
}

type InitializeOptions = NonNullable<Parameters<typeof initializeAegisStandingHashReplayEpoch>[0]>
type SpawnSyncApi = NonNullable<InitializeOptions["spawnSyncApi"]>

function epochRecord() {
  return createAegisStandingHashEpochRecord(INITIALIZED_AT)
}

function journalEntry(
  record: Record<string, unknown> = epochRecord(),
  envelopeOverrides: Record<string, unknown> = {},
) {
  return JSON.stringify({
    __CURSOR: "s=epoch-cursor",
    _UID: String(UID),
    SYSLOG_IDENTIFIER: JOURNAL_IDENTIFIER,
    MESSAGE: canonicalizeJcs(record),
    ...envelopeOverrides,
  }) + "\n"
}

function harness({
  initialJournal = "",
  afterAppendJournal = journalEntry(),
  responses,
  onJournalQuery,
  onAppend,
  ...overrides
}: {
  initialJournal?: string
  afterAppendJournal?: string
  responses?: ChildResult[]
  onJournalQuery?: (state: { queryCount: number; journal: string }) => void
  onAppend?: (state: { appendCount: number; input: string }) => void
  [key: string]: unknown
} = {}) {
  let queryCount = 0
  let appendCount = 0
  let journal = initialJournal
  const ledgerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-replay-epoch-"))
  tempRoots.push(ledgerRoot)
  fs.chmodSync(ledgerRoot, 0o700)
  const spawnSyncApi = vi.fn((binary: string, args: string[], processOptions?: SpawnOptions): ChildResult => {
    if (responses) return responses.shift() ?? { status: 0, stdout: "" }
    if (binary === JOURNALCTL_BINARY && args[0] !== "--sync") {
      queryCount += 1
      onJournalQuery?.({ queryCount, journal })
      return { status: 0, stdout: journal, stderr: "" }
    }
    if (binary === SYSTEMD_CAT_BINARY) {
      if (!processOptions) throw new Error("spawn options are required")
      appendCount += 1
      journal = afterAppendJournal
      onAppend?.({ appendCount, input: processOptions.input ?? "" })
    }
    return { status: 0, stdout: "", stderr: "" }
  })
  const options = {
    platform: "linux" as const,
    getuid: () => UID,
    username: () => "williamos-fabric",
    hostname: () => "aegis",
    clock: () => INITIALIZED_AT,
    spawnSyncApi: spawnSyncApi as unknown as SpawnSyncApi,
    ledgerRoot,
    randomUUID: () => `00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, "0")}`,
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
    ...overrides,
  } as InitializeOptions
  return {
    options,
    spawnSyncApi,
    ledgerRoot,
    state: () => ({ queryCount, appendCount, journal }),
  }
}

describe("AEGIS standing hash replay epoch", () => {
  it("creates and validates one canonical, digest-bound epoch record", () => {
    expect(epochRecord()).toEqual({
      record_type: "EPOCH",
      epoch_id: JOURNAL_EPOCH_ID,
      initialized_at: INITIALIZED_AT,
      journal_record_sha256: "220faa88aff3c05bc69ed0aa14ba38e6483beac798df7bdcf687fe2681410e23",
    })
    expect(validateAegisStandingHashEpochRecord(epochRecord())).toEqual(epochRecord())
  })

  it.each([
    ["noncanonical timestamp", "2026-08-11T18:00:00Z"],
    ["invalid timestamp", "not-a-date"],
    ["non-string timestamp", 1_754_934_400_000],
  ])("rejects %s when creating a record", (_label, initializedAt) => {
    expect(() => createAegisStandingHashEpochRecord(initializedAt)).toThrow(
      "AEGIS_REPLAY_EPOCH_TIME_INVALID",
    )
  })

  it.each([
    ["extra key", { ...epochRecord(), unexpected: true }],
    ["wrong record type", { ...epochRecord(), record_type: "ADMISSION" }],
    ["wrong epoch ID", { ...epochRecord(), epoch_id: `${JOURNAL_EPOCH_ID}-foreign` }],
    ["wrong timestamp", { ...epochRecord(), initialized_at: "2026-08-11T18:00:00Z" }],
    ["invalid digest", { ...epochRecord(), journal_record_sha256: "0".repeat(64) }],
  ])("rejects a malformed or conflicting record: %s", (_label, record) => {
    expect(() => validateAegisStandingHashEpochRecord(record)).toThrow(
      "AEGIS_REPLAY_EPOCH_INVALID",
    )
  })

  it.each([
    ["non-Linux platform", { platform: "win32" }, "AEGIS_REPLAY_LINUX_REQUIRED"],
    ["missing UID API", { getuid: undefined }, "AEGIS_REPLAY_IDENTITY_REJECTED"],
    ["root UID", { getuid: () => 0 }, "AEGIS_REPLAY_IDENTITY_REJECTED"],
    ["unsafe UID", { getuid: () => Number.NaN }, "AEGIS_REPLAY_IDENTITY_REJECTED"],
    ["wrong account", { username: () => "root" }, "AEGIS_REPLAY_IDENTITY_REJECTED"],
    ["wrong hostname", { hostname: () => "hermes" }, "AEGIS_REPLAY_HOST_REJECTED"],
  ])("rejects %s before journal access", (_label, overrides, code) => {
    const { options, spawnSyncApi } = harness(overrides)

    expect(() => initializeAegisStandingHashReplayEpoch(options)).toThrow(code)
    expect(spawnSyncApi).not.toHaveBeenCalled()
  })

  it("returns synchronized idempotent evidence for the exact existing epoch without writing", () => {
    const { options, spawnSyncApi } = harness({ initialJournal: journalEntry() })

    expect(initializeAegisStandingHashReplayEpoch(options)).toEqual({
      schema_version: "1.0-aegis-standing-hash-replay-epoch-evidence",
      status: "ALREADY_ESTABLISHED",
      already_established: true,
      identifier: JOURNAL_IDENTIFIER,
      uid: UID,
      ...epochRecord(),
      epoch_count: 1,
      workload_executed: false,
      scheduler_activated: false,
      network_accessed: false,
    })
    expect(spawnSyncApi.mock.calls).toEqual([
      [JOURNALCTL_BINARY, JOURNAL_QUERY, FIXED_OPTIONS],
      [JOURNALCTL_BINARY, ["--sync"], FIXED_OPTIONS],
      [JOURNALCTL_BINARY, JOURNAL_QUERY, FIXED_OPTIONS],
    ])
  })

  it("appends the canonical epoch, synchronizes it, and verifies by rereading", () => {
    const { options, spawnSyncApi } = harness()

    expect(initializeAegisStandingHashReplayEpoch(options)).toEqual({
      schema_version: "1.0-aegis-standing-hash-replay-epoch-evidence",
      status: "ESTABLISHED",
      already_established: false,
      identifier: JOURNAL_IDENTIFIER,
      uid: UID,
      ...epochRecord(),
      epoch_count: 1,
      workload_executed: false,
      scheduler_activated: false,
      network_accessed: false,
    })
    expect(spawnSyncApi.mock.calls).toEqual([
      [JOURNALCTL_BINARY, JOURNAL_QUERY, FIXED_OPTIONS],
      [SYSTEMD_CAT_BINARY, [
        `--identifier=${JOURNAL_IDENTIFIER}`,
        "--priority=info",
        "--level-prefix=false",
      ], {
        ...FIXED_OPTIONS,
        input: `${canonicalizeJcs(epochRecord())}\n`,
      }],
      [JOURNALCTL_BINARY, ["--sync"], FIXED_OPTIONS],
      [JOURNALCTL_BINARY, JOURNAL_QUERY, FIXED_OPTIONS],
    ])
  })

  it("serializes simultaneous first-time initializers so only one appends", () => {
    let contenderError: unknown
    let contenderStarted = false
    let sharedOptions: InitializeOptions
    const value = harness({
      onJournalQuery: ({ queryCount }) => {
        if (queryCount !== 1 || contenderStarted) return
        contenderStarted = true
        try { initializeAegisStandingHashReplayEpoch(sharedOptions) } catch (error) { contenderError = error }
      },
    })
    sharedOptions = value.options

    expect(initializeAegisStandingHashReplayEpoch(value.options)).toMatchObject({ status: "ESTABLISHED" })
    expect(contenderError).toMatchObject({ code: "AEGIS_REPLAY_LOCK_BUSY" })
    expect(value.state()).toMatchObject({ appendCount: 1 })
    expect(fs.existsSync(path.join(value.ledgerRoot, EPOCH_LOCK_BASENAME))).toBe(false)
  })

  it("holds the exclusive lock while synchronizing and reverifying an existing epoch", () => {
    let contenderError: unknown
    let contenderStarted = false
    let sharedOptions: InitializeOptions
    const value = harness({
      initialJournal: journalEntry(),
      onJournalQuery: ({ queryCount }) => {
        if (queryCount !== 1 || contenderStarted) return
        contenderStarted = true
        try { initializeAegisStandingHashReplayEpoch(sharedOptions) } catch (error) { contenderError = error }
      },
    })
    sharedOptions = value.options

    expect(initializeAegisStandingHashReplayEpoch(value.options)).toMatchObject({
      status: "ALREADY_ESTABLISHED",
      already_established: true,
    })
    expect(contenderError).toMatchObject({ code: "AEGIS_REPLAY_LOCK_BUSY" })
    expect(value.state()).toMatchObject({ queryCount: 2, appendCount: 0 })
    expect(value.spawnSyncApi.mock.calls).toEqual([
      [JOURNALCTL_BINARY, JOURNAL_QUERY, FIXED_OPTIONS],
      [JOURNALCTL_BINARY, ["--sync"], FIXED_OPTIONS],
      [JOURNALCTL_BINARY, JOURNAL_QUERY, FIXED_OPTIONS],
    ])
  })

  it("atomically isolates the owned lock before cleanup so a contender never sees an empty public lock", () => {
    const value = harness({ initialJournal: journalEntry() })
    const lockPath = path.join(value.ledgerRoot, EPOCH_LOCK_BASENAME)
    let releaseRenameObserved = false
    let contenderResult: ReturnType<typeof initializeAegisStandingHashReplayEpoch> | undefined
    const fsApi = new Proxy(fs, {
      get(target, property, receiver) {
        if (property !== "renameSync") return Reflect.get(target, property, receiver)
        return (sourcePath: fs.PathLike, destinationPath: fs.PathLike) => {
          fs.renameSync(sourcePath, destinationPath)
          if (String(sourcePath) === lockPath
            && String(destinationPath).includes(".aegis-replay-epoch-release-")
            && !releaseRenameObserved) {
            releaseRenameObserved = true
            expect(fs.existsSync(lockPath)).toBe(false)
            contenderResult = initializeAegisStandingHashReplayEpoch(value.options)
          }
        }
      },
    })

    expect(initializeAegisStandingHashReplayEpoch({ ...value.options, fsApi })).toMatchObject({
      status: "ALREADY_ESTABLISHED",
    })
    expect(releaseRenameObserved).toBe(true)
    expect(contenderResult).toMatchObject({ status: "ALREADY_ESTABLISHED" })
    expect(fs.existsSync(lockPath)).toBe(false)
    expect(fs.readdirSync(value.ledgerRoot)).toEqual([])
  })

  it("rejects existing epoch evidence that disappears after synchronization", () => {
    const value = harness({ responses: [
      { status: 0, stdout: journalEntry() },
      { status: 0, stdout: "" },
      { status: 0, stdout: "" },
    ] })

    expect(() => initializeAegisStandingHashReplayEpoch(value.options)).toThrow(
      "AEGIS_REPLAY_EPOCH_NOT_RETAINED",
    )
    expect(fs.existsSync(path.join(value.ledgerRoot, EPOCH_LOCK_BASENAME))).toBe(false)
  })

  it("accepts a retained epoch only after synchronization and reread under the lock", () => {
    const value = harness({ responses: [
      { status: 0, stdout: journalEntry() },
      { status: 0, stdout: "" },
      { status: 0, stdout: journalEntry() },
    ] })

    expect(initializeAegisStandingHashReplayEpoch(value.options)).toMatchObject({
      status: "ALREADY_ESTABLISHED",
      already_established: true,
    })
    expect(value.spawnSyncApi).toHaveBeenCalledTimes(3)
    expect(fs.existsSync(path.join(value.ledgerRoot, EPOCH_LOCK_BASENAME))).toBe(false)
  })

  it("reclaims a valid retained lock only when its holder is provably dead", () => {
    const value = harness({ holderLiveness: () => "DEAD" })
    const lockPath = path.join(value.ledgerRoot, EPOCH_LOCK_BASENAME)
    fs.mkdirSync(lockPath, { mode: 0o700 })
    fs.writeFileSync(path.join(lockPath, "holder.json"), `${JSON.stringify({
      pid: 99,
      uid: UID,
      boot_id: BOOT_ID,
      process_start_ticks: "999",
      token: "00000000-0000-4000-8000-999999999999",
    })}\n`, { mode: 0o600 })

    expect(initializeAegisStandingHashReplayEpoch(value.options)).toMatchObject({ status: "ESTABLISHED" })
    expect(value.state()).toMatchObject({ appendCount: 1 })
    expect(fs.existsSync(lockPath)).toBe(false)
  })

  it("retries when a competing lock disappears before inspection", () => {
    const value = harness()
    const lockPath = path.join(value.ledgerRoot, EPOCH_LOCK_BASENAME)
    let candidateInstallAttempts = 0
    const fsApi = new Proxy(fs, {
      get(target, property, receiver) {
        if (property !== "renameSync") return Reflect.get(target, property, receiver)
        return (sourcePath: fs.PathLike, destinationPath: fs.PathLike) => {
          if (String(destinationPath) === lockPath && candidateInstallAttempts++ === 0) {
            const error = new Error("competing lock disappeared") as NodeJS.ErrnoException
            error.code = "EEXIST"
            throw error
          }
          return fs.renameSync(sourcePath, destinationPath)
        }
      },
    })

    expect(initializeAegisStandingHashReplayEpoch({ ...value.options, fsApi })).toMatchObject({
      status: "ESTABLISHED",
    })
    expect(candidateInstallAttempts).toBe(2)
    expect(value.state()).toMatchObject({ appendCount: 1 })
    expect(fs.existsSync(lockPath)).toBe(false)
  })

  it.each(["ALIVE", "UNKNOWN"])('does not reclaim a holder whose liveness is %s', (liveness) => {
    const value = harness({ holderLiveness: () => liveness })
    const lockPath = path.join(value.ledgerRoot, EPOCH_LOCK_BASENAME)
    fs.mkdirSync(lockPath, { mode: 0o700 })
    fs.writeFileSync(path.join(lockPath, "holder.json"), `${JSON.stringify({
      pid: 99,
      uid: UID,
      boot_id: BOOT_ID,
      process_start_ticks: "999",
      token: "00000000-0000-4000-8000-999999999999",
    })}\n`, { mode: 0o600 })

    expect(() => initializeAegisStandingHashReplayEpoch(value.options)).toThrow("AEGIS_REPLAY_LOCK_BUSY")
    expect(fs.existsSync(lockPath)).toBe(true)
    expect(value.state()).toMatchObject({ appendCount: 0 })
  })

  it("does not reclaim a retained lock when holder liveness cannot be checked", () => {
    const value = harness({ holderLiveness: () => { throw new Error("probe unavailable") } })
    const lockPath = path.join(value.ledgerRoot, EPOCH_LOCK_BASENAME)
    fs.mkdirSync(lockPath, { mode: 0o700 })
    fs.writeFileSync(path.join(lockPath, "holder.json"), `${JSON.stringify({
      pid: 99,
      uid: UID,
      boot_id: BOOT_ID,
      process_start_ticks: "999",
      token: "00000000-0000-4000-8000-999999999999",
    })}\n`, { mode: 0o600 })

    expect(() => initializeAegisStandingHashReplayEpoch(value.options)).toThrow("AEGIS_REPLAY_LOCK_BUSY")
    expect(fs.existsSync(lockPath)).toBe(true)
  })

  it("fails closed for malformed retained lock identity without deleting it", () => {
    const value = harness({ holderLiveness: () => "DEAD" })
    const lockPath = path.join(value.ledgerRoot, EPOCH_LOCK_BASENAME)
    fs.mkdirSync(lockPath, { mode: 0o700 })
    fs.writeFileSync(path.join(lockPath, "holder.json"), '{"pid":99}\n', { mode: 0o600 })

    expect(() => initializeAegisStandingHashReplayEpoch(value.options)).toThrow("AEGIS_REPLAY_LOCK_UNTRUSTED")
    expect(fs.existsSync(lockPath)).toBe(true)
    expect(value.state()).toMatchObject({ appendCount: 0 })
  })

  it("rejects a ledger path whose resolved identity differs before lock mutation", () => {
    const value = harness()
    const fsApi = new Proxy(fs, {
      get(target, property, receiver) {
        if (property === "realpathSync") return () => `${value.ledgerRoot}-redirected`
        return Reflect.get(target, property, receiver)
      },
    })

    expect(() => initializeAegisStandingHashReplayEpoch({ ...value.options, fsApi })).toThrow(
      "AEGIS_REPLAY_LOCK_PATH_REJECTED",
    )
    expect(value.state()).toMatchObject({ appendCount: 0 })
  })

  it("uses a closed environment for every child and ignores attacker-controlled values", () => {
    const originalNodeOptions = process.env.NODE_OPTIONS
    const originalLdPreload = process.env.LD_PRELOAD
    process.env.NODE_OPTIONS = "--require=/tmp/attacker.cjs"
    process.env.LD_PRELOAD = "/tmp/attacker.so"
    try {
      const { options, spawnSyncApi } = harness()
      initializeAegisStandingHashReplayEpoch(options)
      for (const call of spawnSyncApi.mock.calls) {
        const processOptions = call[2]
        expect(processOptions).toMatchObject({ env: FIXED_ENV, shell: false })
        if (!processOptions) throw new Error("spawn options are required")
        expect(processOptions.env).not.toHaveProperty("NODE_OPTIONS")
        expect(processOptions.env).not.toHaveProperty("LD_PRELOAD")
        expect(processOptions.env).not.toHaveProperty("SUDO_COMMAND")
      }
    } finally {
      if (originalNodeOptions === undefined) delete process.env.NODE_OPTIONS
      else process.env.NODE_OPTIONS = originalNodeOptions
      if (originalLdPreload === undefined) delete process.env.LD_PRELOAD
      else process.env.LD_PRELOAD = originalLdPreload
    }
  })

  it.each([
    ["malformed envelope JSON", "not-json\n", "AEGIS_REPLAY_JOURNAL_UNTRUSTED"],
    ["array envelope", "[]\n", "AEGIS_REPLAY_JOURNAL_UNTRUSTED"],
    ["malformed message JSON", journalEntry({}, { MESSAGE: "not-json" }), "AEGIS_REPLAY_JOURNAL_UNTRUSTED"],
    ["wrong UID", journalEntry(epochRecord(), { _UID: "1002" }), "AEGIS_REPLAY_JOURNAL_UNTRUSTED"],
    ["root UID", journalEntry(epochRecord(), { _UID: "0" }), "AEGIS_REPLAY_JOURNAL_UNTRUSTED"],
    ["wrong identifier", journalEntry(epochRecord(), { SYSLOG_IDENTIFIER: "foreign-service" }), "AEGIS_REPLAY_JOURNAL_UNTRUSTED"],
    ["wrong epoch ID", journalEntry({ ...epochRecord(), epoch_id: "foreign-epoch" }), "AEGIS_REPLAY_EPOCH_INVALID"],
    ["conflicting digest", journalEntry({ ...epochRecord(), journal_record_sha256: "0".repeat(64) }), "AEGIS_REPLAY_EPOCH_INVALID"],
    ["multiple epochs", journalEntry() + journalEntry(), "AEGIS_REPLAY_EPOCH_MULTIPLE"],
  ])("fails closed for retained journal evidence with %s", (_label, output, code) => {
    expect(() => parseAegisStandingHashJournal(output, UID)).toThrow(code)
  })

  it("refuses to establish an epoch after any retained standing record", () => {
    const priorClaim = {
      record_type: "CLAIM",
      claim_key_sha256: "a".repeat(64),
    }
    const { options, spawnSyncApi } = harness({ initialJournal: journalEntry(priorClaim) })

    expect(() => initializeAegisStandingHashReplayEpoch(options)).toThrow(
      "AEGIS_REPLAY_EPOCH_PREEXISTING_RECORDS",
    )
    expect(spawnSyncApi).toHaveBeenCalledOnce()
  })

  it.each([
    ["initial query spawn failure", [{ status: null, error: new Error("spawn failed") }]],
    ["initial query nonzero exit", [{ status: 1, stdout: "", stderr: "denied" }]],
    ["append spawn failure", [
      { status: 0, stdout: "" },
      { status: null, error: new Error("spawn failed") },
    ]],
    ["append nonzero exit", [
      { status: 0, stdout: "" },
      { status: 1, stderr: "denied" },
    ]],
    ["sync failure", [
      { status: 0, stdout: "" },
      { status: 0 },
      { status: 1, stderr: "sync failed" },
    ]],
    ["verification query failure", [
      { status: 0, stdout: "" },
      { status: 0 },
      { status: 0 },
      { status: 1, stderr: "read failed" },
    ]],
  ])("fails closed when %s", (_label, responses) => {
    const { options } = harness({ responses })
    expect(() => initializeAegisStandingHashReplayEpoch(options)).toThrow(
      "AEGIS_REPLAY_JOURNAL_UNAVAILABLE",
    )
  })

  it.each([
    ["missing reread epoch", ""],
    ["different canonical reread epoch", journalEntry(createAegisStandingHashEpochRecord("2026-08-11T18:00:01.000Z"))],
  ])("fails verification after append for %s", (_label, afterAppendJournal) => {
    const { options, spawnSyncApi } = harness({ afterAppendJournal })

    expect(() => initializeAegisStandingHashReplayEpoch(options)).toThrow(
      "AEGIS_REPLAY_EPOCH_NOT_RETAINED",
    )
    expect(spawnSyncApi).toHaveBeenCalledTimes(4)
    expect(fs.existsSync(path.join((options as any).ledgerRoot, EPOCH_LOCK_BASENAME))).toBe(false)
  })

  it("contains no network, scheduler, privilege-escalation, root-mutation, or shell primitive", () => {
    const source = fs.readFileSync(modulePath, "utf8")

    expect(source).not.toMatch(/node:(?:net|http|https|http2|tls|dgram|dns)/)
    expect(source).not.toMatch(/\b(?:fetch|WebSocket)\s*\(/)
    expect(source).not.toMatch(/\b(?:systemctl|crontab|schtasks)\b/i)
    expect(source).not.toMatch(/["'`][^"'`]*\/(?:at|batch|cron)\b/i)
    expect(source).not.toMatch(/\b(?:sudo|doas|pkexec|setpriv)\b/)
    expect(source).not.toMatch(/\b(?:chmod|chown|setuid|setgid|capset|mount|umount)\b/)
    expect(source).not.toMatch(/recursive\s*:\s*true/)
    expect(source).toContain(`export const LEDGER_ROOT = "/var/lib/williamos/fabric/ledger"`)
    expect(source).toContain(`export const EPOCH_LOCK_BASENAME = "${EPOCH_LOCK_BASENAME}"`)
    expect(source).not.toMatch(/\b(?:exec|execFile|fork)\s*\(/)
    expect(source).not.toMatch(/shell\s*:\s*true/)
    expect(source).not.toMatch(/["']\/(?:bin|usr\/bin)\/(?:sh|bash|dash|zsh)["']/)
  })
})
