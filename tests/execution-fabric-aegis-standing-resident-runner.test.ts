import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import {
  createStandingLedgerProviders,
  createStandingTrustedProof,
  parseStandingArguments,
  readPrivateStandingRequest,
  readResidentMachineIdentity,
  readStandingArtifact,
  readTrustedClosureFile,
  STANDING_TRUSTED_FILES,
} from "../scripts/execution-fabric/bounded-dispatch/run-resident-aegis-standing-hash.mjs"

type Json = Record<string, any>

const sha256 = (value: crypto.BinaryLike) => crypto.createHash("sha256").update(value).digest("hex")
const canonical = (value: any): string => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value)
const sha256Object = (value: any) => sha256(canonical(value))
const journalByRoot = new Map<string, Array<{ record: Json; realtime_ms: number; uid: number; identifier: string }>>()

function tempRoot(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function write(root: string, relative: string, bytes: Buffer | string) {
  const target = path.join(root, ...relative.split("/"))
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, bytes)
  return target
}

function trackedGit(paths: Set<string>) {
  return vi.fn((args: string[]) => {
    if (args[0] === "ls-files" && args[1] === "--error-unmatch" && args[2] === "--") {
      const relative = args[3]
      if (!paths.has(relative)) throw new Error("not tracked")
      return Buffer.from(`${relative}\n`)
    }
    throw new Error(`unexpected Git call: ${JSON.stringify(args)}`)
  })
}

function clock(...instants: string[]) {
  const values = [...instants]
  return () => values.shift() ?? instants.at(-1)!
}

function claimBinding(id = "001"): Json {
  return {
    authority_id: "aegis-standing-compute-authority-v1",
    authority_sha256: "1".repeat(64),
    job_id: `job-standing-${id}`,
    admission_id: `admission-standing-${id}`,
    admission_sha256: id === "001" ? "2".repeat(64) : "3".repeat(64),
    request_sha256: id === "001" ? "4".repeat(64) : "5".repeat(64),
    request_binding_sha256: id === "001" ? "6".repeat(64) : "7".repeat(64),
    claim_id: `claim-standing-${id}`,
    admission_issued_at: "2026-08-10T21:59:00.000Z",
    admission_expires_at: "2026-08-11T21:59:00.000Z",
  }
}

function leaseBinding(id = "001"): Json {
  return {
    ...claimBinding(id),
    lease_id: `lease-standing-${id}`,
    fencing_token: Number(id),
  }
}

function completion(binding = leaseBinding()): Json {
  const body = {
    schema_version: "1.0-aegis-standing-hash-completion",
    status: "COMPLETED",
    result: "VERIFIED",
    authority_id: binding.authority_id,
    authority_sha256: binding.authority_sha256,
    job_id: binding.job_id,
    admission: {
      admission_id: binding.admission_id,
      admission_sha256: binding.admission_sha256,
    },
    claim: { claim_id: binding.claim_id },
    lease: { lease_id: binding.lease_id, fencing_token: binding.fencing_token },
    request_binding_sha256: binding.request_binding_sha256,
    immutable: true,
  }
  return { ...body, evidence_sha256: sha256Object(body) }
}

function claimFailure(binding = claimBinding()): Json {
  const body = {
    schema_version: "1.0-aegis-standing-hash-completion",
    status: "FAILED_CLOSED",
    result: "CONCURRENCY_LIMIT_REACHED",
    authority_id: binding.authority_id,
    admission: {
      admission_id: binding.admission_id,
      admission_sha256: binding.admission_sha256,
    },
    claim: { claim_id: binding.claim_id },
    lease: null,
    request_binding_sha256: binding.request_binding_sha256,
    immutable: true,
  }
  return { ...body, evidence_sha256: sha256Object(body) }
}

function ledger(root = tempRoot("aegis-standing-ledger-"), overrides: Json = {}) {
  fs.chmodSync(root, 0o700)
  const journal = journalByRoot.get(root) ?? [{
    record: (() => {
      const value = { record_type: "EPOCH", epoch_id: "aegis-standing-hash-replay-epoch-v1", initialized_at: "2026-08-10T21:58:00.000Z" } as Json
      value.journal_record_sha256 = sha256Object(value)
      return value
    })(),
    realtime_ms: Date.parse("2026-08-10T21:58:00.000Z"),
    uid: process.getuid?.() ?? 1000,
    identifier: "williamos-aegis-standing-hash",
  }]
  journalByRoot.set(root, journal)
  return createStandingLedgerProviders({
    ledgerRoot: root,
    fsApi: fs,
    platform: "linux",
    getuid: () => process.getuid?.() ?? 1000,
    username: () => "williamos-fabric",
    validateDirectory: (stats: fs.Stats) => stats.isDirectory() && !stats.isSymbolicLink(),
    validateFile: (stats: fs.Stats) => stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1,
    clock: clock(
      "2026-08-10T22:00:00.000Z",
      "2026-08-10T22:00:01.000Z",
      "2026-08-10T22:00:02.000Z",
      "2026-08-10T22:00:03.000Z",
      "2026-08-10T22:00:04.000Z",
    ),
    holderIdentity: () => ({ pid: 100, boot_id: "boot-a", process_start_ticks: "10" }),
    holderIsAlive: () => true,
    syncDirectory: vi.fn(),
    readJournal: () => structuredClone(journal),
    appendJournal: (record: Json) => { journal.push({
      record: structuredClone(record),
      realtime_ms: Date.parse(record.claimed_at ?? record.initialized_at),
      uid: process.getuid?.() ?? 1000,
      identifier: "williamos-aegis-standing-hash",
    }) },
    ...overrides,
  })
}

describe("resident AEGIS standing HASH_VERIFY runner", () => {
  it("accepts only one exact --request and --admission path pair", () => {
    expect(parseStandingArguments([
      "--request", "job-standing-001",
      "--admission", "docs/reports/standing-dispatch/admission.json",
    ])).toEqual({
      request: "job-standing-001",
      admission: "docs/reports/standing-dispatch/admission.json",
    })

    expect(() => parseStandingArguments(["--request", "x", "--admission", "y", "--request", "z"]))
      .toThrow("ARGUMENT_INVALID")
    expect(() => parseStandingArguments(["--request", "x", "--admission", "y", "--command", "id"]))
      .toThrow("ARGUMENT_INVALID")
    expect(() => parseStandingArguments(["--request", "x"])).toThrow("ARGUMENT_INVALID")
    expect(() => parseStandingArguments(["--admission", "y"])).toThrow("ARGUMENT_INVALID")
    expect(() => parseStandingArguments(["request", "x", "--admission", "y"])).toThrow("ARGUMENT_INVALID")
  })

  it("reads a private ephemeral request only from the fixed owner-only root", () => {
    const root = tempRoot("aegis-standing-private-request-")
    const target = write(root, "job-standing-001.json", "{\"request\":true}\n")
    const injectedFs = Object.create(fs) as typeof fs
    const uid = 1000
    const decorate = (stats: fs.Stats) => Object.assign(Object.create(Object.getPrototypeOf(stats)), stats, { uid, mode: stats.isDirectory() ? 0o40700 : 0o100600 })
    injectedFs.lstatSync = ((candidate: fs.PathLike) => decorate(fs.lstatSync(candidate))) as typeof fs.lstatSync
    injectedFs.fstatSync = ((descriptor: number) => decorate(fs.fstatSync(descriptor))) as typeof fs.fstatSync

    expect(readPrivateStandingRequest("job-standing-001", { requestRoot: root, fsApi: injectedFs, uid }).toString("utf8"))
      .toBe("{\"request\":true}\n")
    expect(() => readPrivateStandingRequest("../outside", { requestRoot: root, fsApi: injectedFs, uid })).toThrow("IDENTIFIER_INVALID")
    fs.linkSync(target, path.join(root, "job-standing-002.json"))
    expect(() => readPrivateStandingRequest("job-standing-002", { requestRoot: root, fsApi: injectedFs, uid })).toThrow("REQUEST_UNTRUSTED")
  })

  it("reads only tracked single-link artifacts beneath docs/reports/standing-dispatch", () => {
    const root = tempRoot("aegis-standing-artifact-")
    const relative = "docs/reports/standing-dispatch/request.json"
    const target = write(root, relative, "{\"request\":true}\n")
    const tracked = new Set([relative])
    const runGit = trackedGit(tracked)
    const options = { repositoryRoot: root, fsApi: fs, runGit }

    expect(readStandingArtifact(relative, options).toString("utf8")).toBe("{\"request\":true}\n")
    expect(runGit).toHaveBeenCalledWith(["ls-files", "--error-unmatch", "--", relative])
    expect(() => readStandingArtifact("docs/reports/request.json", options)).toThrow("PATH_ESCAPE")
    expect(() => readStandingArtifact("docs/reports/standing-dispatch/../outside.json", options)).toThrow("PATH_ESCAPE")
    expect(() => readStandingArtifact(path.resolve(target), options)).toThrow("PATH_ESCAPE")
    expect(() => readStandingArtifact("docs\\reports\\standing-dispatch\\request.json", options)).toThrow("PATH_ESCAPE")

    const untracked = "docs/reports/standing-dispatch/untracked.json"
    write(root, untracked, "{}\n")
    expect(() => readStandingArtifact(untracked, options)).toThrow("ARTIFACT_UNTRACKED")

    const outside = write(root, "outside.json", "{}\n")
    const hardlink = "docs/reports/standing-dispatch/hardlink.json"
    fs.linkSync(outside, path.join(root, ...hardlink.split("/")))
    tracked.add(hardlink)
    expect(() => readStandingArtifact(hardlink, options)).toThrow("PATH_INVALID")
  })

  it("rejects symbolic links through the injected filesystem on Windows-compatible tests", () => {
    const root = tempRoot("aegis-standing-symlink-")
    const relative = "docs/reports/standing-dispatch/linked.json"
    const target = write(root, relative, "{}\n")
    const injectedFs = Object.create(fs) as typeof fs
    injectedFs.lstatSync = ((candidate: fs.PathLike) => {
      if (path.resolve(String(candidate)) === path.resolve(target)) {
        return { ...fs.lstatSync(target), isSymbolicLink: () => true }
      }
      return fs.lstatSync(candidate)
    }) as typeof fs.lstatSync

    expect(() => readStandingArtifact(relative, {
      repositoryRoot: root,
      fsApi: injectedFs,
      runGit: trackedGit(new Set([relative])),
    })).toThrow("PATH_ESCAPE")
  })

  it("durably claims the exact authority, admission, and request once", async () => {
    const root = tempRoot("aegis-standing-claim-")
    const providers = ledger(root)
    const binding = claimBinding()
    const first = await providers.claimAdmission(binding)
    const replay = await providers.claimAdmission(structuredClone(binding))

    expect(first).toMatchObject({ claimed: true, ...binding })
    expect(replay).toMatchObject({ claimed: false, ...binding })
    expect(fs.readdirSync(root).filter((name) => name.startsWith("claim-"))).toHaveLength(1)

    const claimPath = path.join(root, fs.readdirSync(root).find((name) => name.startsWith("claim-"))!)
    const retained = JSON.parse(fs.readFileSync(claimPath, "utf8"))
    retained.request_sha256 = "f".repeat(64)
    fs.writeFileSync(claimPath, `${JSON.stringify(retained)}\n`)
    await expect(providers.claimAdmission(binding)).rejects.toThrow("LEDGER_UNTRUSTED")
  })

  it("reads trusted closure bytes through a no-follow descriptor and rejects inode drift", () => {
    const root = tempRoot("aegis-standing-closure-descriptor-")
    const relative = "scripts/execution-fabric/closure.mjs"
    write(root, relative, "export const trusted = true\n")
    const descriptorReads: Array<number | fs.PathLike> = []
    const injectedFs = Object.create(fs) as typeof fs
    injectedFs.readFileSync = ((candidate: number | fs.PathLike, ...args: any[]) => {
      descriptorReads.push(candidate)
      return (fs.readFileSync as any)(candidate, ...args)
    }) as typeof fs.readFileSync

    expect(readTrustedClosureFile(injectedFs, root, relative).toString("utf8"))
      .toBe("export const trusted = true\n")
    expect(descriptorReads.some((candidate) => typeof candidate === "number")).toBe(true)

    const driftedFs = new Proxy(fs, {
      get(target, property, receiver) {
        if (property === "lstatSync") return (candidate: fs.PathLike) => {
          const stats = fs.lstatSync(candidate)
          return new Proxy(stats, {
            get(statsTarget, statsProperty, statsReceiver) {
              if (statsProperty === "ino") return statsTarget.ino + 1
              return Reflect.get(statsTarget, statsProperty, statsReceiver)
            },
          })
        }
        return Reflect.get(target, property, receiver)
      },
    }) as typeof fs
    expect(() => readTrustedClosureFile(driftedFs, root, relative)).toThrow("TRUSTED_MAIN_MISMATCH")
  })

  it("binds execution to an immutable root-owned resident machine identity", () => {
    const root = tempRoot("aegis-standing-machine-id-")
    const machineIdPath = write(root, "machine-id", "0123456789abcdef0123456789abcdef\n")
    const descriptorReads: Array<number | fs.PathLike> = []
    const injectedFs = Object.create(fs) as typeof fs
    const decorate = (stats: fs.Stats) => Object.assign(Object.create(Object.getPrototypeOf(stats)), stats, {
      uid: 0,
      mode: 0o100444,
    })
    injectedFs.lstatSync = ((candidate: fs.PathLike) => decorate(fs.lstatSync(candidate))) as typeof fs.lstatSync
    injectedFs.fstatSync = ((descriptor: number) => decorate(fs.fstatSync(descriptor))) as typeof fs.fstatSync
    injectedFs.readFileSync = ((candidate: number | fs.PathLike, ...args: any[]) => {
      descriptorReads.push(candidate)
      return (fs.readFileSync as any)(candidate, ...args)
    }) as typeof fs.readFileSync

    expect(readResidentMachineIdentity({ fsApi: injectedFs, machineIdPath })).toEqual({
      node_id: "aegis",
      machine_id_sha256: sha256("0123456789abcdef0123456789abcdef"),
    })
    expect(descriptorReads.some((candidate) => typeof candidate === "number")).toBe(true)

    fs.writeFileSync(machineIdPath, "not-a-machine-id\n")
    expect(() => readResidentMachineIdentity({ fsApi: injectedFs, machineIdPath })).toThrow("MACHINE_ID_UNTRUSTED")
  })

  it("fails closed until a retained privileged journal epoch predates admission", async () => {
    const root = tempRoot("aegis-standing-epoch-")
    journalByRoot.set(root, [])
    const providers = ledger(root)

    await expect(providers.claimAdmission(claimBinding())).rejects.toThrow("JOURNAL_EPOCH_NOT_ESTABLISHED")
    expect(journalByRoot.get(root)?.map((entry) => entry.record.record_type)).toEqual(["EPOCH"])

    await expect(providers.claimAdmission({
      ...claimBinding(),
      admission_issued_at: "2026-08-10T22:00:02.000Z",
    })).resolves.toMatchObject({ claimed: true })
  })

  it("rejects replay from the privileged journal even if the local claim is deleted", async () => {
    const root = tempRoot("aegis-standing-journal-replay-")
    const providers = ledger(root)
    const binding = claimBinding()
    await expect(providers.claimAdmission(binding)).resolves.toMatchObject({ claimed: true })
    fs.unlinkSync(path.join(root, fs.readdirSync(root).find((name) => name.startsWith("claim-"))!))

    await expect(providers.claimAdmission(binding)).resolves.toMatchObject({ claimed: false })
    expect(fs.readdirSync(root).filter((name) => name.startsWith("claim-"))).toHaveLength(0)
  })

  it("persists immutable claim-only failure evidence when no lease is acquired", async () => {
    const root = tempRoot("aegis-standing-claim-failure-")
    const providers = ledger(root)
    const binding = claimBinding()
    const evidence = claimFailure(binding)
    await providers.claimAdmission(binding)

    await expect(providers.persistClaimFailure(evidence)).resolves.toEqual({
      persisted: true,
      evidence_sha256: evidence.evidence_sha256,
    })
    expect(providers.runtimeEvidence().result_sha256).toBe(evidence.evidence_sha256)
    await expect(providers.persistClaimFailure({ ...evidence, result: "CHANGED" })).rejects.toThrow("LEDGER_UNTRUSTED")
  })

  it("fails closed on a malformed retained journal claim", async () => {
    const root = tempRoot("aegis-standing-journal-tamper-")
    const providers = ledger(root)
    const binding = claimBinding()
    await providers.claimAdmission(binding)
    const journal = journalByRoot.get(root)!
    journal.find((entry) => entry.record.record_type === "CLAIM")!.record.request_binding_sha256 = "f".repeat(64)

    await expect(providers.claimAdmission(binding)).rejects.toThrow("JOURNAL_UNTRUSTED")
  })

  it("atomically recovers a mutation lock only when its exact holder is dead", async () => {
    const root = tempRoot("aegis-standing-mutation-recovery-")
    const lockRoot = path.join(root, "standing-hash-mutation.lock")
    fs.mkdirSync(lockRoot, { mode: 0o700 })
    fs.writeFileSync(path.join(lockRoot, "holder.json"), `${JSON.stringify({ pid: 99, boot_id: "boot-old", process_start_ticks: "9" })}\n`)
    const holderIsAlive = vi.fn(() => false)
    const providers = ledger(root, { holderIsAlive })

    await expect(providers.claimAdmission(claimBinding())).resolves.toMatchObject({ claimed: true })
    expect(holderIsAlive).toHaveBeenCalledWith({ pid: 99, boot_id: "boot-old", process_start_ticks: "9" })
    expect(fs.existsSync(lockRoot)).toBe(false)
    expect(fs.readdirSync(root).some((name) => name.startsWith("mutation-recovery-"))).toBe(false)
  })

  it("recovers an exact empty lock left before holder publication", async () => {
    const root = tempRoot("aegis-standing-empty-mutation-lock-")
    const lockRoot = path.join(root, "standing-hash-mutation.lock")
    fs.mkdirSync(lockRoot, { mode: 0o700 })
    const providers = ledger(root)

    await expect(providers.claimAdmission(claimBinding())).resolves.toMatchObject({ claimed: true })
    expect(fs.existsSync(lockRoot)).toBe(false)
    expect(fs.readdirSync(root).some((name) => name.startsWith("mutation-lock-candidate-"))).toBe(false)
    expect(fs.readdirSync(root).some((name) => name.startsWith("mutation-recovery-"))).toBe(false)
  })

  it("enforces one exact lease and strictly increasing fencing", async () => {
    const providers = ledger()
    const firstClaim = claimBinding()
    const firstLease = leaseBinding()
    await expect(providers.claimAdmission(firstClaim)).resolves.toMatchObject({ claimed: true })
    await expect(providers.acquireLease(firstLease)).resolves.toMatchObject({ acquired: true, ...firstLease })

    const secondLease = leaseBinding("002")
    await expect(providers.acquireLease(secondLease)).resolves.toMatchObject({ acquired: false })
    await expect(providers.releaseLease(firstLease)).rejects.toThrow("RESULT_REQUIRED")
    await expect(providers.persistResult(completion(firstLease))).resolves.toMatchObject({
      persisted: true,
      evidence_sha256: completion(firstLease).evidence_sha256,
    })
    await expect(providers.releaseLease({ ...firstLease, fencing_token: 2 })).rejects.toThrow("LEASE_FENCE_MISMATCH")
    await expect(providers.releaseLease(firstLease)).resolves.toMatchObject({ released: true, ...firstLease })

    await expect(providers.claimAdmission(claimBinding("002"))).resolves.toMatchObject({ claimed: true })
    await expect(providers.acquireLease({ ...secondLease, fencing_token: 1 })).rejects.toThrow("FENCING_REPLAY")
    await expect(providers.acquireLease(secondLease)).resolves.toMatchObject({ acquired: true, ...secondLease })
  })

  it("rejects path-like lease identifiers before creating an active lease", async () => {
    const root = tempRoot("aegis-standing-lease-path-")
    const providers = ledger(root)
    await expect(providers.acquireLease({
      ...leaseBinding(),
      lease_id: "../../outside",
    })).rejects.toThrow("IDENTIFIER_INVALID")
    expect(fs.existsSync(path.join(root, "standing-hash-active.json"))).toBe(false)
  })

  it("recovers only an exact holder proven dead", async () => {
    const root = tempRoot("aegis-standing-recovery-")
    const first = ledger(root)
    await first.claimAdmission(claimBinding())
    await expect(first.acquireLease(leaseBinding())).resolves.toMatchObject({ acquired: true })

    const alive = ledger(root, {
      holderIdentity: () => ({ pid: 200, boot_id: "boot-a", process_start_ticks: "20" }),
      holderIsAlive: vi.fn(() => true),
    })
    await alive.claimAdmission(claimBinding("002"))
    await expect(alive.acquireLease(leaseBinding("002"))).resolves.toMatchObject({ acquired: false })
    expect(fs.readdirSync(root).filter((name) => name.startsWith("recovery-"))).toHaveLength(0)

    const holderIsAlive = vi.fn(() => false)
    const dead = ledger(root, {
      holderIdentity: () => ({ pid: 300, boot_id: "boot-b", process_start_ticks: "30" }),
      holderIsAlive,
    })
    await expect(dead.acquireLease(leaseBinding("002"))).resolves.toMatchObject({ acquired: true, ...leaseBinding("002") })
    expect(holderIsAlive).toHaveBeenCalledWith({ pid: 100, boot_id: "boot-a", process_start_ticks: "10" })
    expect(fs.readdirSync(root).filter((name) => name.startsWith("recovery-"))).toHaveLength(1)
  })

  it("rejects a conflicting retained recovery without removing the active lease", async () => {
    const root = tempRoot("aegis-standing-recovery-conflict-")
    const first = ledger(root)
    const binding = leaseBinding()
    await first.claimAdmission(claimBinding())
    await first.acquireLease(binding)
    const activePath = path.join(root, "standing-hash-active.json")
    const active = JSON.parse(fs.readFileSync(activePath, "utf8"))
    const recovery = {
      schema_version: "1.0-aegis-standing-lease-recovery",
      lease_id: binding.lease_id,
      fencing_token: 999,
      lease_record_sha256: "f".repeat(64),
      recovered_at: "2026-08-10T22:00:03.000Z",
      reason: "PROVEN_DEAD_HOLDER",
    } as Json
    recovery.recovery_sha256 = sha256Object(recovery)
    const recoveryPath = path.join(root, `recovery-${sha256Object({ lease_id: binding.lease_id })}.json`)
    fs.writeFileSync(recoveryPath, `${JSON.stringify(recovery)}\n`)

    const dead = ledger(root, { holderIsAlive: vi.fn(() => false) })
    await expect(dead.acquireLease(leaseBinding("002"))).rejects.toThrow("LEDGER_UNTRUSTED")
    expect(JSON.parse(fs.readFileSync(activePath, "utf8"))).toEqual(active)

    const extendedRecovery = {
      schema_version: "1.0-aegis-standing-lease-recovery",
      lease_id: active.lease_id,
      fencing_token: active.fencing_token,
      lease_record_sha256: active.lease_record_sha256,
      recovered_at: "2026-08-10T22:00:02.000Z",
      reason: "PROVEN_DEAD_HOLDER",
      unexpected: true,
    } as Json
    extendedRecovery.recovery_sha256 = sha256Object(extendedRecovery)
    fs.writeFileSync(recoveryPath, `${JSON.stringify(extendedRecovery)}\n`)
    await expect(dead.acquireLease(leaseBinding("002"))).rejects.toThrow("LEDGER_UNTRUSTED")
    expect(JSON.parse(fs.readFileSync(activePath, "utf8"))).toEqual(active)
  })

  it("persists an immutable exact result before release and rejects retained-result tampering", async () => {
    const root = tempRoot("aegis-standing-result-")
    const providers = ledger(root)
    const binding = leaseBinding()
    await providers.claimAdmission(claimBinding())
    await providers.acquireLease(binding)
    const evidence = completion(binding)
    await expect(providers.persistResult(evidence)).resolves.toEqual({
      persisted: true,
      evidence_sha256: evidence.evidence_sha256,
    })
    const resultFiles = fs.readdirSync(root).filter((name) => name.startsWith("result-"))
    expect(resultFiles).toHaveLength(1)

    const resultPath = path.join(root, resultFiles[0])
    const retained = JSON.parse(fs.readFileSync(resultPath, "utf8"))
    retained.result = "CHANGED"
    fs.writeFileSync(resultPath, `${JSON.stringify(retained)}\n`)
    await expect(providers.persistResult(evidence)).rejects.toThrow("LEDGER_UNTRUSTED")
    await expect(providers.releaseLease(binding)).rejects.toThrow("LEDGER_UNTRUSTED")
  })

  it("rejects a conflicting retained release without removing the active lease", async () => {
    const root = tempRoot("aegis-standing-release-conflict-")
    const providers = ledger(root)
    const binding = leaseBinding()
    await providers.claimAdmission(claimBinding())
    await providers.acquireLease(binding)
    await providers.persistResult(completion(binding))
    const release = {
      schema_version: "1.0-aegis-standing-lease-release",
      lease_id: binding.lease_id,
      fencing_token: 999,
      claim_id: binding.claim_id,
      lease_record_sha256: "f".repeat(64),
      released_at: "2026-08-10T22:00:04.000Z",
    } as Json
    release.release_sha256 = sha256Object(release)
    const releasePath = path.join(root, `release-${sha256Object({ lease_id: binding.lease_id })}.json`)
    fs.writeFileSync(releasePath, `${JSON.stringify(release)}\n`)

    await expect(providers.releaseLease(binding)).rejects.toThrow("LEDGER_UNTRUSTED")
    expect(fs.existsSync(path.join(root, "standing-hash-active.json"))).toBe(true)
  })

  it("proves a clean reviewed detached release checkout and exact tracked closure bytes", () => {
    const root = tempRoot("aegis-standing-proof-")
    const admissionPath = "docs/reports/standing-dispatch/admission.json"
    const inputPath = "docs/reports/standing-dispatch/inputs/input.bin"
    const closure: Record<string, Buffer> = {
      ...Object.fromEntries(STANDING_TRUSTED_FILES.map((relative) => [relative, Buffer.from(`trusted:${relative}`)])),
      [admissionPath]: Buffer.from("admission"),
      [inputPath]: Buffer.from("input"),
    }
    for (const [relative, bytes] of Object.entries(closure)) write(root, relative, bytes)

    const commit = "a".repeat(40)
    const releaseBody = {
      schema_version: "1.0-williamos-trusted-main-release",
      repository: "bsvalues/terragroq",
      trusted_ref: "refs/heads/main",
      head_commit: commit,
      release_root: `/opt/williamos/releases/${commit}`,
      reviewed: true,
      deployed_at: "2026-08-10T21:58:00.000Z",
      file_sha256: Object.fromEntries([
        "scripts/execution-fabric/bounded-dispatch/bootstrap-aegis-standing-hash.mjs",
        "scripts/execution-fabric/bounded-dispatch/run-resident-aegis-standing-hash.mjs",
        "scripts/execution-fabric/bounded-dispatch/aegis-standing-hash-runtime.mjs",
        "scripts/execution-fabric/bounded-dispatch/aegis-hash-core.mjs",
        "scripts/execution-fabric/admission/evaluate-aegis-standing-authority.mjs",
      ].map((relative) => [relative, sha256(closure[relative])])),
    }
    const releaseManifest = { ...releaseBody, release_manifest_sha256: sha256Object(releaseBody) }
    const calls: string[][] = []
    const runGit = vi.fn((args: string[]) => {
      calls.push(args)
      if (args[0] === "rev-parse") return Buffer.from(`${commit}\n`)
      if (args[0] === "status") return Buffer.alloc(0)
      if (args[0] === "merge-base") return Buffer.alloc(0)
      if (args[0] === "ls-files") {
        const relative = args[3]
        if (!Object.hasOwn(closure, relative)) throw new Error("untracked")
        return Buffer.from(`${relative}\n`)
      }
      if (args[0] === "show") return closure[args[1].slice(args[1].indexOf(":") + 1)]
      throw new Error(`unexpected Git call: ${JSON.stringify(args)}`)
    })

    expect(createStandingTrustedProof({
      repositoryRoot: root,
      admissionPath,
      inputPath,
      sourceCommit: commit,
      fsApi: fs,
      runGit,
      readReleaseManifest: () => structuredClone(releaseManifest),
    })).toMatchObject({
      schema_version: "1.0-aegis-standing-trusted-proof",
      trusted_ref: "refs/heads/main",
      head_commit: commit,
      source_commit: commit,
      source_is_ancestor: true,
      clean: true,
      exact_file_count: Object.keys(closure).length,
      verified: true,
    })
    expect(calls).toContainEqual(["rev-parse", "--verify", "HEAD"])
    expect(calls.some((args) => args[0] === "symbolic-ref")).toBe(false)
    for (const relative of Object.keys(closure)) {
      expect(calls).toContainEqual(["ls-files", "--error-unmatch", "--", relative])
      expect(calls).toContainEqual(["show", `${commit}:${relative}`])
    }

    const dirtyGit = (args: string[]) => args[0] === "status" ? Buffer.from(" M changed.mjs\n") : runGit(args)
    expect(() => createStandingTrustedProof({
      repositoryRoot: root, admissionPath, inputPath, sourceCommit: commit, fsApi: fs, runGit: dirtyGit,
      readReleaseManifest: () => structuredClone(releaseManifest),
    })).toThrow("TRUSTED_MAIN_MISMATCH")

    const wrongReleaseBody = { ...releaseBody, head_commit: "b".repeat(40) }
    expect(() => createStandingTrustedProof({
      repositoryRoot: root, admissionPath, inputPath, sourceCommit: commit, fsApi: fs, runGit,
      readReleaseManifest: () => ({ ...wrongReleaseBody, release_manifest_sha256: sha256Object(wrongReleaseBody) }),
    })).toThrow("RELEASE_MANIFEST_UNTRUSTED")

    fs.writeFileSync(path.join(root, ...admissionPath.split("/")), "tampered")
    expect(() => createStandingTrustedProof({
      repositoryRoot: root, admissionPath, inputPath, sourceCommit: commit, fsApi: fs, runGit,
      readReleaseManifest: () => structuredClone(releaseManifest),
    })).toThrow("TRUSTED_MAIN_MISMATCH")
  })

  it("contains only fixed Git and journal process boundaries with no shell, network, or scheduler API", () => {
    const source = fs.readFileSync(path.join(
      process.cwd(), "scripts/execution-fabric/bounded-dispatch/run-resident-aegis-standing-hash.mjs",
    ), "utf8")
    expect(source).toContain('const GIT_BINARY = "/usr/bin/git"')
    expect(source).toContain('const JOURNALCTL_BINARY = "/usr/bin/journalctl"')
    expect(source).toContain('const SYSTEMD_CAT_BINARY = "/usr/bin/systemd-cat"')
    expect(source).toContain('spawnSync(GIT_BINARY, ["--no-replace-objects", ...args]')
    expect(source).toContain("spawnSync(binary, args")
    expect(source.match(/spawnSync\(/g)).toHaveLength(2)
    expect(source).not.toMatch(/\b(?:fetch|WebSocket|XMLHttpRequest|createConnection|connect)\s*\(/)
    expect(source).not.toMatch(/node:(?:http|https|net|tls|dns)|\bssh\b|api\.github\.com|\bgh\b/)
    expect(source).not.toMatch(/\b(?:exec|execFile|fork)Sync?\s*\(|shell:\s*true/)
    expect(source).not.toMatch(/--command|workloadCommand|fallbackProvider|scheduler\.(?:start|run)|setInterval/)
  })

  it("requires the root-owned bootstrap to hash the complete executable closure before import", () => {
    const source = fs.readFileSync(path.join(
      process.cwd(), "scripts/execution-fabric/bounded-dispatch/bootstrap-aegis-standing-hash.mjs",
    ), "utf8")
    expect(source).toContain('const BOOTSTRAP_PATH = "/usr/local/libexec/williamos/aegis-standing-hash-bootstrap.mjs"')
    expect(source).toContain('const RELEASE_MANIFEST_PATH = "/etc/williamos/fabric/trusted-main-release.json"')
    expect(source).toContain('const RELEASES_ROOT = "/opt/williamos/releases"')
    expect(source).toContain("verifyRootOwnedDirectoryChain(releaseRoot)")
    expect(source).toContain("verifyRootOwnedDirectoryChain(path.dirname(candidate))")
    expect(source).toContain("manifest.release_root !== releaseRoot")
    expect(source).toContain("before.uid !== 0")
    expect(source).toContain("sha256(readRootOwnedFile(candidate, 1024 * 1024)) !== expected")
    expect(source).toMatch(/const \{ manifest, releaseRoot \} = verifiedManifest\(\)/)
    expect(source.indexOf("= verifiedManifest()")).toBeGreaterThan(-1)
    expect(source.indexOf("= verifiedManifest()")).toBeLessThan(source.indexOf("await import("))
    expect(source).not.toMatch(/node:child_process|\b(?:exec|execFile|spawn|fork)Sync?\s*\(|shell:\s*true/)
    expect(source).not.toMatch(/node:(?:http|https|net|tls|dns)|\bssh\b|api\.github\.com|\bgh\b/)
  })
})
