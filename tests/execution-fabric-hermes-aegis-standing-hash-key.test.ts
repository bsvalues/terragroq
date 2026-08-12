import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { describe, expect, it, vi } from "vitest"

import {
  EVIDENCE_PATH,
  GENERATION_ACCOUNT,
  ICACLS_PATH,
  JOURNAL_PATH,
  KEY_COMMENT,
  PRIVATE_KEY_PATH,
  PUBLIC_KEY_PATH,
  RECOVERY_CLAIM_PATH,
  SSH_KEYGEN_PATH,
  WHOAMI_PATH,
  canonicalize,
  canonicalSha256,
  createHermesAegisStandingHashKey,
} from "../scripts/execution-fabric/provision/create-hermes-aegis-standing-hash-key.mjs"

type Json = Record<string, any>

const repoRoot = path.resolve(import.meta.dirname, "..")
const manifestPath = path.join(repoRoot, "config", "execution-fabric", "aegis-standing-hash-provisioning-package.v1.json")
const modulePath = path.join(
  repoRoot,
  "scripts",
  "execution-fabric",
  "provision",
  "create-hermes-aegis-standing-hash-key.mjs",
)
const NOW = "2026-08-11T18:05:00.000Z"
const PURPOSE = "GENERATE_DEDICATED_HERMES_AEGIS_STANDING_HASH_TRANSPORT_KEY"
const LEGACY_MANIFEST_SHA256 = "614a0723adae356aa729966b29aeae7dcd5859c78ab99beda1dc256c6dd0e9fd"

function manifest(): Json {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"))
}

function authority(overrides: Json = {}): Json {
  const value = manifest()
  return {
    schemaVersion: 1,
    authorityId: "c1a03f4b-e6d8-4ba5-8b2d-8df07069b525",
    purpose: PURPOSE,
    packageId: value.packageId,
    manifestSha256: canonicalSha256(value),
    generationHost: "hermes",
    generationAccount: "bs",
    sourceAddress: "192.168.1.154",
    algorithm: "ssh-ed25519",
    privateKeyPath: PRIVATE_KEY_PATH,
    publicKeyPath: PUBLIC_KEY_PATH,
    evidencePath: EVIDENCE_PATH,
    issuedAt: "2026-08-11T18:00:00.000Z",
    expiresAt: "2026-08-11T18:15:00.000Z",
    singleUse: true,
    consumed: false,
    recovery: null,
    ...overrides,
  }
}

function ed25519PublicKey() {
  const algorithm = Buffer.from("ssh-ed25519", "ascii")
  const key = Buffer.alloc(32, 0x5a)
  const length = (bytes: Buffer) => {
    const prefix = Buffer.alloc(4)
    prefix.writeUInt32BE(bytes.length)
    return Buffer.concat([prefix, bytes])
  }
  const blob = Buffer.concat([length(algorithm), length(key)])
  const line = `ssh-ed25519 ${blob.toString("base64")} ${KEY_COMMENT}\n`
  const fingerprint = `SHA256:${crypto.createHash("sha256").update(blob).digest("base64").replace(/=+$/, "")}`
  return { line, fingerprint }
}

type NodeValue = {
  kind: "file" | "directory" | "symlink"
  bytes: Buffer
  nlink: number
  dev: number
  ino: number
  mode: number
  mtimeMs: number
  ctimeMs: number
}

function injectedWindowsFs(
  existing: Array<{ target: string, kind?: NodeValue["kind"], bytes?: string, nlink?: number }> = [],
  temporaryUnlinkFailures = 0,
) {
  const normalize = (candidate: fs.PathLike) => path.win32.normalize(String(candidate)).toLowerCase()
  const nodes = new Map<string, NodeValue>()
  const descriptors = new Map<number, { target: string, offset: number, real?: number }>()
  const events: Json[] = []
  let nextDescriptor = 20_000
  let nextInode = 100

  const add = (target: string, kind: NodeValue["kind"], bytes: Buffer | string = Buffer.alloc(0), mode = 0o600) => {
    nodes.set(normalize(target), {
      kind,
      bytes: Buffer.from(bytes),
      nlink: 1,
      dev: 7,
      ino: nextInode++,
      mode,
      mtimeMs: 1,
      ctimeMs: 1,
    })
  }
  add(path.win32.dirname(PRIVATE_KEY_PATH), "directory", "", 0o700)
  add(SSH_KEYGEN_PATH, "file")
  add(ICACLS_PATH, "file")
  add(WHOAMI_PATH, "file")
  for (const item of existing) {
    add(item.target, item.kind ?? "file", item.bytes ?? "existing")
    if (item.nlink !== undefined) nodes.get(normalize(item.target))!.nlink = item.nlink
  }

  const missing = () => Object.assign(new Error("ENOENT"), { code: "ENOENT" })
  const stats = (value: NodeValue) => ({
    ...value,
    size: value.bytes.length,
    isFile: () => value.kind === "file",
    isDirectory: () => value.kind === "directory",
    isSymbolicLink: () => value.kind === "symlink",
  })
  const api: any = {
    constants: fs.constants,
    lstatSync(candidate: fs.PathLike) {
      if (path.resolve(String(candidate)) === manifestPath) return fs.lstatSync(manifestPath)
      const value = nodes.get(normalize(candidate))
      if (!value) throw missing()
      return stats(value)
    },
    realpathSync(candidate: fs.PathLike) {
      if (path.resolve(String(candidate)) === manifestPath) return fs.realpathSync(manifestPath)
      const value = nodes.get(normalize(candidate))
      if (!value) throw missing()
      return String(candidate)
    },
    openSync(candidate: fs.PathLike, flags: number, mode?: number) {
      if (path.resolve(String(candidate)) === manifestPath) {
        const real = fs.openSync(manifestPath, flags)
        const descriptor = nextDescriptor++
        descriptors.set(descriptor, { target: manifestPath, offset: 0, real })
        return descriptor
      }
      const target = normalize(candidate)
      let value = nodes.get(target)
      if ((flags & fs.constants.O_CREAT) !== 0) {
        if (value && (flags & fs.constants.O_EXCL) !== 0) throw Object.assign(new Error("EEXIST"), { code: "EEXIST" })
        if (!value) {
          add(String(candidate), "file", "", mode ?? 0o600)
          value = nodes.get(target)!
          events.push({ kind: "create", target: String(candidate) })
        }
      }
      if (!value || value.kind !== "file") throw missing()
      const descriptor = nextDescriptor++
      descriptors.set(descriptor, { target, offset: (flags & fs.constants.O_APPEND) !== 0 ? value.bytes.length : 0 })
      return descriptor
    },
    fstatSync(descriptor: number) {
      const opened = descriptors.get(descriptor)
      if (!opened) throw missing()
      return opened.real !== undefined ? fs.fstatSync(opened.real) : stats(nodes.get(opened.target)!)
    },
    readFileSync(candidate: fs.PathLike | number) {
      if (typeof candidate === "number") {
        const opened = descriptors.get(candidate)!
        if (opened.real !== undefined) return fs.readFileSync(opened.real)
        events.push({ kind: "read", target: opened.target })
        return Buffer.from(nodes.get(opened.target)!.bytes)
      }
      const target = normalize(candidate)
      events.push({ kind: "read", target })
      const value = nodes.get(target)
      if (!value) throw missing()
      return Buffer.from(value.bytes)
    },
    writeSync(descriptor: number, bytes: Buffer, offset: number, length: number) {
      const opened = descriptors.get(descriptor)!
      const value = nodes.get(opened.target)!
      const chunk = Buffer.from(bytes).subarray(offset, offset + length)
      const before = value.bytes.subarray(0, opened.offset)
      const afterOffset = opened.offset + chunk.length
      const after = afterOffset < value.bytes.length ? value.bytes.subarray(afterOffset) : Buffer.alloc(0)
      value.bytes = Buffer.concat([before, chunk, after])
      opened.offset = afterOffset
      events.push({ kind: "write", target: opened.target, bytes: chunk.length })
      return chunk.length
    },
    fsyncSync(descriptor: number) {
      events.push({ kind: "fsync", target: descriptors.get(descriptor)!.target })
    },
    closeSync(descriptor: number) {
      const opened = descriptors.get(descriptor)
      if (opened?.real !== undefined) fs.closeSync(opened.real)
      descriptors.delete(descriptor)
    },
    linkSync(source: fs.PathLike, destination: fs.PathLike) {
      const value = nodes.get(normalize(source))
      if (!value) throw missing()
      if (nodes.has(normalize(destination))) throw Object.assign(new Error("EEXIST"), { code: "EEXIST" })
      value.nlink += 1
      nodes.set(normalize(destination), value)
      events.push({ kind: "link", source: normalize(source), target: normalize(destination) })
    },
    unlinkSync(candidate: fs.PathLike) {
      const target = normalize(candidate)
      if (target.endsWith(".tmp") && temporaryUnlinkFailures > 0) {
        temporaryUnlinkFailures -= 1
        events.push({ kind: "unlink-failed", target })
        throw Object.assign(new Error("EBUSY"), { code: "EBUSY" })
      }
      const value = nodes.get(target)
      if (!value) throw missing()
      value.nlink -= 1
      nodes.delete(target)
      events.push({ kind: "unlink", target })
    },
  }
  return {
    api,
    events,
    addFile: (target: string, bytes: Buffer | string) => add(target, "file", bytes),
    bytesAt: (target: string) => nodes.get(normalize(target))?.bytes,
    has: (target: string) => nodes.has(normalize(target)),
    normalize,
  }
}

function harness(overrides: Json = {}) {
  const virtual = injectedWindowsFs(overrides.existing, overrides.temporaryUnlinkFailures)
  const publicKey = ed25519PublicKey()
  const responses = [...(overrides.responses ?? [])]
  const spawnSyncApi = vi.fn((executable: string, args: string[], options: Json) => {
    virtual.events.push({ kind: "spawn", executable, args, options })
    const injected = responses.shift()
    if (executable === SSH_KEYGEN_PATH && args[0] === "-q") {
      const result = injected ?? { status: 0, stdout: "", stderr: "" }
      if (result.status === 0 && !result.error && !result.signal) {
        virtual.addFile(PRIVATE_KEY_PATH, "PRIVATE KEY BYTES MUST NEVER BE READ")
        virtual.addFile(PUBLIC_KEY_PATH, publicKey.line)
      }
      return result
    }
    if (executable === ICACLS_PATH && args.length === 1) {
      return injected ?? { status: 0, stdout: `${PRIVATE_KEY_PATH}\\${GENERATION_ACCOUNT}:(F)\r\n`, stderr: "" }
    }
    if (executable === SSH_KEYGEN_PATH && args[0] === "-lf") {
      return injected ?? { status: 0, stdout: `256 ${publicKey.fingerprint} ${KEY_COMMENT} (ED25519)\n`, stderr: "" }
    }
    return injected ?? { status: 0, stdout: "", stderr: "" }
  })
  return {
    virtual,
    spawnSyncApi,
    publicKey,
    options: {
      authority: overrides.authority ?? authority(),
      mode: overrides.mode,
      repoRoot,
      fsApi: virtual.api,
      processApi: overrides.processApi ?? { platform: "win32" },
      hostname: overrides.hostname ?? (() => "hermes"),
      userInfo: overrides.userInfo ?? (() => ({ username: "bs", homedir: "C:\\Users\\bs" })),
      isElevated: Object.prototype.hasOwnProperty.call(overrides, "isElevated")
        ? overrides.isElevated
        : false,
      clock: overrides.clock ?? (() => NOW),
      spawnSyncApi,
    },
  }
}

function errorCode(action: () => unknown) {
  try {
    action()
    return "NO_ERROR"
  } catch (error) {
    return (error as Json).code
  }
}

describe("injected Hermes AEGIS standing HASH dedicated-key generation", () => {
  it("defaults to a mutation-free dry-run", () => {
    const value = harness()
    const result = createHermesAegisStandingHashKey(value.options)

    expect(result).toMatchObject({
      status: "DRY_RUN",
      mode: "DRY-RUN",
      generationHost: "hermes",
      generationAccount: "bs",
      algorithm: "ssh-ed25519",
      authorityConsumed: false,
      generatedFresh: false,
      privateKeyInspected: false,
      networkAccessed: false,
      schedulerActivated: false,
      workloadExecuted: false,
    })
    expect(value.spawnSyncApi).not.toHaveBeenCalled()
    expect(value.virtual.events.filter(({ kind }) => ["create", "write", "link", "unlink", "spawn"].includes(kind))).toEqual([])
  })

  it("accepts Windows component-store hard links for the fixed system executables", () => {
    const value = harness({
      existing: [
        { target: WHOAMI_PATH, nlink: 2 },
        { target: SSH_KEYGEN_PATH, nlink: 2 },
        { target: ICACLS_PATH, nlink: 2 },
      ],
    })

    expect(createHermesAegisStandingHashKey(value.options)).toMatchObject({ status: "DRY_RUN" })
    expect(value.spawnSyncApi).not.toHaveBeenCalled()
  })

  it("still rejects an indirect fixed system executable", () => {
    const value = harness({ existing: [{ target: WHOAMI_PATH, kind: "symlink" }] })

    expect(errorCode(() => createHermesAegisStandingHashKey(value.options))).toBe("HERMES_KEY_EXECUTABLE_UNTRUSTED")
    expect(value.spawnSyncApi).not.toHaveBeenCalled()
  })

  it.each([0, Number.NaN])("rejects malformed fixed-executable link count %s", (nlink) => {
    const value = harness({ existing: [{ target: WHOAMI_PATH, nlink }] })

    expect(errorCode(() => createHermesAegisStandingHashKey(value.options))).toBe("HERMES_KEY_EXECUTABLE_UNTRUSTED")
    expect(value.spawnSyncApi).not.toHaveBeenCalled()
  })

  it.each([
    ["non-Windows", { processApi: { platform: "linux" }, isElevated: undefined }, "HERMES_KEY_WINDOWS_REQUIRED"],
    ["wrong host", { hostname: () => "omen" }, "HERMES_KEY_HOST_REJECTED"],
    ["wrong account", { userInfo: () => ({ username: "admin", homedir: "C:\\Users\\admin" }) }, "HERMES_KEY_ACCOUNT_REJECTED"],
    ["wrong profile", { userInfo: () => ({ username: "bs", homedir: "D:\\Users\\bs" }) }, "HERMES_KEY_ACCOUNT_REJECTED"],
    ["elevated", { isElevated: true }, "HERMES_KEY_ELEVATION_REJECTED"],
  ])("rejects the %s identity gate without spawning or writing", (_label, overrides, code) => {
    const value = harness({ ...overrides, mode: "apply" })
    expect(errorCode(() => createHermesAegisStandingHashKey(value.options))).toBe(code)
    expect(value.spawnSyncApi).not.toHaveBeenCalled()
    expect(value.virtual.events.some(({ kind }) => ["create", "write", "link"].includes(kind))).toBe(false)
  })

  it.each([
    ["purpose", { purpose: "GENERIC_KEY" }, "HERMES_KEY_AUTHORITY_INVALID"],
    ["package", { packageId: "other" }, "HERMES_KEY_AUTHORITY_SCOPE_MISMATCH"],
    ["host", { generationHost: "omen" }, "HERMES_KEY_AUTHORITY_SCOPE_MISMATCH"],
    ["account", { generationAccount: "Administrator" }, "HERMES_KEY_AUTHORITY_SCOPE_MISMATCH"],
    ["source", { sourceAddress: "0.0.0.0" }, "HERMES_KEY_AUTHORITY_SCOPE_MISMATCH"],
    ["algorithm", { algorithm: "ssh-rsa" }, "HERMES_KEY_AUTHORITY_SCOPE_MISMATCH"],
    ["private path", { privateKeyPath: "C:\\temp\\id" }, "HERMES_KEY_AUTHORITY_SCOPE_MISMATCH"],
    ["public path", { publicKeyPath: "C:\\temp\\id.pub" }, "HERMES_KEY_AUTHORITY_SCOPE_MISMATCH"],
    ["evidence path", { evidencePath: "C:\\temp\\evidence.json" }, "HERMES_KEY_AUTHORITY_SCOPE_MISMATCH"],
    ["not single-use", { singleUse: false }, "HERMES_KEY_AUTHORITY_INVALID"],
    ["consumed", { consumed: true }, "HERMES_KEY_AUTHORITY_REPLAY"],
    ["extra field", { scopeExpansion: true }, "HERMES_KEY_AUTHORITY_INVALID"],
  ])("rejects authority with invalid %s", (_label, changed, code) => {
    const value = harness({ authority: authority(changed), mode: "apply" })
    expect(errorCode(() => createHermesAegisStandingHashKey(value.options))).toBe(code)
    expect(value.spawnSyncApi).not.toHaveBeenCalled()
    expect(value.virtual.has(JOURNAL_PATH)).toBe(false)
  })

  it.each([
    ["expired", "2026-08-11T18:15:00.000Z", authority()],
    ["not yet valid", "2026-08-11T17:59:59.999Z", authority()],
    ["overlong", NOW, authority({ expiresAt: "2026-08-11T18:15:00.001Z" })],
  ])("rejects %s authority before key generation", (_label, now, grant) => {
    const value = harness({ authority: grant, mode: "apply", clock: () => now })
    expect(errorCode(() => createHermesAegisStandingHashKey(value.options))).toBe("HERMES_KEY_AUTHORITY_EXPIRED")
    expect(value.spawnSyncApi).not.toHaveBeenCalled()
    expect(value.virtual.has(JOURNAL_PATH)).toBe(false)
  })

  it.each([
    [PRIVATE_KEY_PATH, "file", "HERMES_KEY_EXISTING_TARGET_REJECTED"],
    [PUBLIC_KEY_PATH, "file", "HERMES_KEY_EXISTING_TARGET_REJECTED"],
    [EVIDENCE_PATH, "file", "HERMES_KEY_EXISTING_TARGET_REJECTED"],
    [PRIVATE_KEY_PATH, "symlink", "HERMES_KEY_SYMLINK_REJECTED"],
  ])("fail-closes after a power loss when %s %s remains, even if the journal is missing", (target, kind, code) => {
    const value = harness({ existing: [{ target, kind }], mode: "apply" })
    expect(errorCode(() => createHermesAegisStandingHashKey(value.options))).toBe(code)
    expect(value.spawnSyncApi).not.toHaveBeenCalled()
    expect(value.virtual.events.some(({ kind: eventKind }) => eventKind === "write")).toBe(false)
  })

  it("rejects a retained journal as consumed authority", () => {
    const value = harness({ existing: [{ target: JOURNAL_PATH, kind: "file" }], mode: "apply" })
    expect(errorCode(() => createHermesAegisStandingHashKey(value.options))).toBe("HERMES_KEY_AUTHORITY_REPLAY")
    expect(value.spawnSyncApi).not.toHaveBeenCalled()
  })

  it("durably consumes authority before the fixed keygen call", () => {
    const value = harness({ mode: "apply" })
    createHermesAegisStandingHashKey(value.options)

    const firstSpawn = value.virtual.events.findIndex(({ kind }) => kind === "spawn")
    const journalWrite = value.virtual.events.findIndex(({ kind, target }) => kind === "write" && target === value.virtual.normalize(JOURNAL_PATH))
    const journalFsync = value.virtual.events.findIndex(({ kind, target }) => kind === "fsync" && target === value.virtual.normalize(JOURNAL_PATH))
    expect(journalWrite).toBeGreaterThanOrEqual(0)
    expect(journalFsync).toBeGreaterThan(journalWrite)
    expect(firstSpawn).toBeGreaterThan(journalFsync)
    expect(JSON.parse(value.virtual.bytesAt(JOURNAL_PATH)!.toString("utf8").split("\n")[0])).toMatchObject({
      recordType: "AUTHORITY_CONSUMED",
      authorityId: authority().authorityId,
      parentDirectoryDurability: "WINDOWS_DIRECTORY_FSYNC_UNAVAILABLE",
      recoveryFence: "RETAINED_ARTIFACT_OR_JOURNAL_REJECTS_REUSE",
    })
  })

  it("uses only fixed shell-free ssh-keygen and icacls calls with a closed environment", () => {
    const originalNodeOptions = process.env.NODE_OPTIONS
    process.env.NODE_OPTIONS = "--require=C:\\attacker.cjs"
    try {
      const value = harness({ mode: "apply" })
      createHermesAegisStandingHashKey(value.options)
      expect(value.spawnSyncApi.mock.calls.map(([executable, args]) => [executable, args])).toEqual([
        [SSH_KEYGEN_PATH, ["-q", "-t", "ed25519", "-f", PRIVATE_KEY_PATH, "-N", "", "-C", KEY_COMMENT]],
        [ICACLS_PATH, [PRIVATE_KEY_PATH, "/inheritance:r", "/remove:g", "*S-1-5-18", "*S-1-5-32-544", "*S-1-1-0", "*S-1-5-11", "/grant:r", "bs:(F)"]],
        [ICACLS_PATH, [PRIVATE_KEY_PATH]],
        [SSH_KEYGEN_PATH, ["-lf", PUBLIC_KEY_PATH, "-E", "sha256"]],
      ])
      for (const [, , options] of value.spawnSyncApi.mock.calls) {
        expect(options).toMatchObject({ shell: false, windowsHide: true, input: "", timeout: 30_000 })
        expect(options.env).toEqual({
          SystemRoot: "C:\\Windows",
          WINDIR: "C:\\Windows",
          SystemDrive: "C:",
          COMSPEC: "C:\\Windows\\System32\\cmd.exe",
          OS: "Windows_NT",
          PATH: "C:\\Windows\\System32\\OpenSSH;C:\\Windows\\System32",
          PATHEXT: ".COM;.EXE;.BAT;.CMD",
          USERNAME: "bs",
          USERDOMAIN: "HERMES",
          USERPROFILE: "C:\\Users\\bs",
          HOMEDRIVE: "C:",
          HOMEPATH: "\\Users\\bs",
          HOME: "C:\\Users\\bs",
          LOCALAPPDATA: "C:\\Users\\bs\\AppData\\Local",
          APPDATA: "C:\\Users\\bs\\AppData\\Roaming",
          PROGRAMDATA: "C:\\ProgramData",
          TEMP: "C:\\Users\\bs\\AppData\\Local\\Temp",
          TMP: "C:\\Users\\bs\\AppData\\Local\\Temp",
        })
        expect(options.env).not.toHaveProperty("NODE_OPTIONS")
      }
    } finally {
      if (originalNodeOptions === undefined) delete process.env.NODE_OPTIONS
      else process.env.NODE_OPTIONS = originalNodeOptions
    }
  })

  it("derives evidence from the public key only and never reads the private key", () => {
    const value = harness({ mode: "apply" })
    const result = createHermesAegisStandingHashKey(value.options)

    expect(result).toMatchObject({
      status: "GENERATED",
      generatedFresh: true,
      existedBefore: false,
      privateKeyPath: PRIVATE_KEY_PATH,
      publicKeyPath: PUBLIC_KEY_PATH,
      privateKeyInspected: false,
      privateKeyLocalOnly: true,
      publicKeySha256: crypto.createHash("sha256").update(value.publicKey.line).digest("hex"),
      publicKeyFingerprint: value.publicKey.fingerprint,
    })
    expect(value.virtual.events.filter(({ kind, target }) => kind === "read" && target === value.virtual.normalize(PRIVATE_KEY_PATH))).toEqual([])
    const evidenceText = value.virtual.bytesAt(EVIDENCE_PATH)!.toString("utf8")
    expect(evidenceText).not.toContain("PRIVATE KEY BYTES")
    expect(evidenceText).not.toMatch(/privateKey(?:Bytes|Content|Sha256)/)
  })

  it("publishes evidence atomically only after a durable temporary write", () => {
    const value = harness({ mode: "apply" })
    createHermesAegisStandingHashKey(value.options)

    const evidence = value.virtual.normalize(EVIDENCE_PATH)
    const link = value.virtual.events.findIndex(({ kind, target }) => kind === "link" && target === evidence)
    const temporaryFsync = value.virtual.events.findIndex(({ kind, target }) => kind === "fsync" && target.endsWith(".tmp"))
    const directEvidenceCreate = value.virtual.events.find(
      ({ kind, target }) => kind === "create" && value.virtual.normalize(target) === evidence,
    )
    expect(temporaryFsync).toBeGreaterThanOrEqual(0)
    expect(link).toBeGreaterThan(temporaryFsync)
    expect(directEvidenceCreate).toBeUndefined()
    expect(value.virtual.events.slice(link + 1).some(({ kind, target }) => kind === "unlink" && target.endsWith(".tmp"))).toBe(true)
  })

  it("retries temporary cleanup after evidence publication without duplicating the target", () => {
    const value = harness({ mode: "apply", temporaryUnlinkFailures: 1 })
    const result = createHermesAegisStandingHashKey(value.options)

    expect(result.status).toBe("GENERATED")
    expect(value.virtual.has(EVIDENCE_PATH)).toBe(true)
    expect(value.virtual.events.filter(({ kind }) => kind === "unlink-failed")).toHaveLength(1)
    expect(value.virtual.events.filter(({ kind, target }) => kind === "unlink" && target.endsWith(".tmp"))).toHaveLength(1)
    expect(value.virtual.events.filter(({ kind, target }) => kind === "link" && target === value.virtual.normalize(EVIDENCE_PATH))).toHaveLength(1)
  })

  it.each([
    [`${PRIVATE_KEY_PATH}\\${GENERATION_ACCOUNT}:(F) BUILTIN\\Administrators:(F)\r\n`],
    [`${PRIVATE_KEY_PATH}\\${GENERATION_ACCOUNT}:(F) NT AUTHORITY\\SYSTEM:(F)\r\n`],
  ])("rejects a forbidden Windows principal in the private-key ACL", (aclOutput) => {
    const value = harness({
      mode: "apply",
      responses: [
        { status: 0, stdout: "", stderr: "" },
        { status: 0, stdout: "", stderr: "" },
        { status: 0, stdout: aclOutput, stderr: "" },
      ],
    })

    try {
      createHermesAegisStandingHashKey(value.options)
      throw new Error("EXPECTED_REJECTION")
    } catch (error) {
      expect(error).toMatchObject({
        code: "HERMES_KEY_PARTIAL_STATE",
        causeCode: "HERMES_KEY_PRIVATE_ACL_INVALID",
        authorityConsumed: true,
      })
    }
    const records = value.virtual.bytesAt(JOURNAL_PATH)!.toString("utf8").trim().split("\n").map((line) => JSON.parse(line))
    expect(records.at(-1)).toMatchObject({
      recordType: "GENERATION_FAILED_PARTIAL_STATE",
      failureCode: "HERMES_KEY_PRIVATE_ACL_INVALID",
    })
    expect(value.spawnSyncApi.mock.calls.map(([executable, args]) => [executable, args])).toEqual([
      [SSH_KEYGEN_PATH, ["-q", "-t", "ed25519", "-f", PRIVATE_KEY_PATH, "-N", "", "-C", KEY_COMMENT]],
      [ICACLS_PATH, [PRIVATE_KEY_PATH, "/inheritance:r", "/remove:g", "*S-1-5-18", "*S-1-5-32-544", "*S-1-1-0", "*S-1-5-11", "/grant:r", "bs:(F)"]],
      [ICACLS_PATH, [PRIVATE_KEY_PATH]],
    ])
  })

  it.each([
    ["keygen spawn failure", [{ status: null, error: new Error("spawn failed") }], "HERMES_KEY_GENERATION_FAILED"],
    ["keygen nonzero", [{ status: 1, stderr: "failed" }], "HERMES_KEY_GENERATION_FAILED"],
    ["ACL hardening", [{ status: 0 }, { status: 1, stderr: "denied" }], "HERMES_KEY_ACL_HARDENING_FAILED"],
    ["ACL validation", [{ status: 0 }, { status: 0 }, { status: 1, stderr: "denied" }], "HERMES_KEY_ACL_VALIDATION_FAILED"],
    [
      "fingerprint",
      [
        { status: 0 },
        { status: 0 },
        { status: 0, stdout: `${PRIVATE_KEY_PATH}\\${GENERATION_ACCOUNT}:(F)\r\n` },
        { status: 1 },
      ],
      "HERMES_KEY_FINGERPRINT_FAILED",
    ],
  ])("retains consumed authority and durable partial evidence after %s", (_label, responses, causeCode) => {
    const value = harness({ mode: "apply", responses })
    try {
      createHermesAegisStandingHashKey(value.options)
      throw new Error("EXPECTED_REJECTION")
    } catch (error) {
      expect(error).toMatchObject({ code: "HERMES_KEY_PARTIAL_STATE", causeCode, authorityConsumed: true })
    }
    const records = value.virtual.bytesAt(JOURNAL_PATH)!.toString("utf8").trim().split("\n").map((line) => JSON.parse(line))
    expect(records[0].recordType).toBe("AUTHORITY_CONSUMED")
    expect(records.at(-1)).toMatchObject({
      recordType: "GENERATION_FAILED_PARTIAL_STATE",
      failureCode: causeCode,
      privateKeyInspected: false,
      automaticCleanupPerformed: false,
    })
    expect(value.virtual.has(JOURNAL_PATH)).toBe(true)
  })

  it("permits one fresh-authority retry only after the exact no-artifact keygen failure", () => {
    const value = harness({
      mode: "apply",
      responses: [{ status: 255, stdout: "", stderr: "" }],
      clock: () => "2026-08-11T18:04:00.000Z",
    })
    expect(() => createHermesAegisStandingHashKey(value.options)).toThrowError(expect.objectContaining({
      code: "HERMES_KEY_PARTIAL_STATE",
      causeCode: "HERMES_KEY_GENERATION_FAILED",
    }))

    const terminalJournalSha256 = crypto.createHash("sha256").update(value.virtual.bytesAt(JOURNAL_PATH)!).digest("hex")
    value.options.authority = authority({
      authorityId: "62da20c9-ec34-4b91-95e3-180dfb6a9469",
      issuedAt: "2026-08-11T18:04:30.000Z",
      recovery: {
        priorAuthorityId: authority().authorityId,
        priorAuthoritySha256: canonicalSha256(authority()),
        terminalJournalSha256,
      },
    })
    value.options.clock = () => NOW
    const result = createHermesAegisStandingHashKey(value.options)

    expect(result).toMatchObject({ status: "GENERATED", privateKeyInspected: false })
    const records = value.virtual.bytesAt(JOURNAL_PATH)!.toString("utf8").trim().split("\n").map((line) => JSON.parse(line))
    expect(records.map(({ recordType }) => recordType)).toEqual([
      "AUTHORITY_CONSUMED",
      "KEY_GENERATION_STARTED",
      "GENERATION_FAILED_PARTIAL_STATE",
      "RECOVERY_AUTHORITY_CONSUMED",
      "KEY_GENERATION_STARTED",
      "GENERATION_COMPLETE",
    ])
    expect(records[3]).toMatchObject({
      sequence: 3,
      authorityId: value.options.authority.authorityId,
      priorAuthorityId: authority().authorityId,
      recoveryBasis: "EXACT_NO_ARTIFACT_KEYGEN_FAILURE",
      privateKeyInspected: false,
    })
    expect(value.virtual.has(RECOVERY_CLAIM_PATH)).toBe(true)
    const recoveryClaimFsync = value.virtual.events.findIndex(
      ({ kind, target }) => kind === "fsync" && target === value.virtual.normalize(RECOVERY_CLAIM_PATH),
    )
    const secondKeygen = value.virtual.events
      .map(({ kind, executable }, index) => ({ kind, executable, index }))
      .filter(({ kind, executable }) => kind === "spawn" && executable === SSH_KEYGEN_PATH)[1].index
    expect(recoveryClaimFsync).toBeGreaterThanOrEqual(0)
    expect(recoveryClaimFsync).toBeLessThan(secondKeygen)
  })

  it("recovers the exact retained no-artifact journal from the pre-upgrade manifest", () => {
    const source = harness({
      mode: "apply",
      responses: [{ status: 255, stdout: "", stderr: "" }],
      clock: () => "2026-08-11T18:04:00.000Z",
    })
    expect(() => createHermesAegisStandingHashKey(source.options)).toThrow()
    const records = source.virtual.bytesAt(JOURNAL_PATH)!.toString("utf8").trimEnd()
      .split("\n").map((line) => JSON.parse(line))
    records[0].manifestSha256 = LEGACY_MANIFEST_SHA256
    const journal = `${records.map((record) => canonicalize(record)).join("\n")}\n`
    const terminalJournalSha256 = crypto.createHash("sha256").update(journal).digest("hex")
    const value = harness({ existing: [{ target: JOURNAL_PATH, bytes: journal }], mode: "apply" })
    value.options.authority = authority({
      authorityId: "62da20c9-ec34-4b91-95e3-180dfb6a9469",
      issuedAt: "2026-08-11T18:04:30.000Z",
      recovery: {
        priorAuthorityId: records[0].authorityId,
        priorAuthoritySha256: records[0].authoritySha256,
        terminalJournalSha256,
      },
    })

    expect(createHermesAegisStandingHashKey(value.options)).toMatchObject({ status: "GENERATED" })
    expect(value.virtual.has(RECOVERY_CLAIM_PATH)).toBe(true)
  })

  it("reports recovery authority consumed when journal append fails after the exclusive claim", () => {
    const source = harness({
      mode: "apply",
      responses: [{ status: 255, stdout: "", stderr: "" }],
      clock: () => "2026-08-11T18:04:00.000Z",
    })
    expect(() => createHermesAegisStandingHashKey(source.options)).toThrow()
    const retained = source.virtual.bytesAt(JOURNAL_PATH)!
    const value = harness({ existing: [{ target: JOURNAL_PATH, bytes: retained }], mode: "apply" })
    value.options.authority = authority({
      authorityId: "62da20c9-ec34-4b91-95e3-180dfb6a9469",
      issuedAt: "2026-08-11T18:04:30.000Z",
      recovery: {
        priorAuthorityId: authority().authorityId,
        priorAuthoritySha256: canonicalSha256(authority()),
        terminalJournalSha256: crypto.createHash("sha256").update(retained).digest("hex"),
      },
    })
    const openSync = value.virtual.api.openSync.bind(value.virtual.api)
    value.virtual.api.openSync = (candidate: fs.PathLike, flags: number, mode?: number) => {
      if (value.virtual.has(RECOVERY_CLAIM_PATH)
        && value.virtual.normalize(candidate) === value.virtual.normalize(JOURNAL_PATH)) {
        throw Object.assign(new Error("EIO"), { code: "EIO" })
      }
      return openSync(candidate, flags, mode)
    }

    try {
      createHermesAegisStandingHashKey(value.options)
      throw new Error("EXPECTED_REJECTION")
    } catch (error) {
      expect(error).toMatchObject({ code: "EIO", authorityConsumed: true, recoveryClaimPath: RECOVERY_CLAIM_PATH })
    }
    expect(value.virtual.has(RECOVERY_CLAIM_PATH)).toBe(true)
    expect(value.spawnSyncApi).not.toHaveBeenCalled()
  })

  it("rejects a recovery authority that is stale or not bound to the terminal journal", () => {
    const value = harness({
      mode: "apply",
      responses: [{ status: 255, stdout: "", stderr: "" }],
      clock: () => "2026-08-11T18:04:00.000Z",
    })
    expect(() => createHermesAegisStandingHashKey(value.options)).toThrow()
    value.options.clock = () => NOW
    value.options.authority = authority({
      authorityId: "62da20c9-ec34-4b91-95e3-180dfb6a9469",
      issuedAt: "2026-08-11T18:04:30.000Z",
      recovery: {
        priorAuthorityId: authority().authorityId,
        priorAuthoritySha256: canonicalSha256(authority()),
        terminalJournalSha256: "0".repeat(64),
      },
    })

    expect(errorCode(() => createHermesAegisStandingHashKey(value.options))).toBe("HERMES_KEY_AUTHORITY_SCOPE_MISMATCH")
    expect(value.virtual.has(RECOVERY_CLAIM_PATH)).toBe(false)
  })

  it("rejects noncanonical and nonmonotonic retained recovery journals", () => {
    const source = harness({
      mode: "apply",
      responses: [{ status: 255, stdout: "", stderr: "" }],
      clock: () => "2026-08-11T18:04:00.000Z",
    })
    expect(() => createHermesAegisStandingHashKey(source.options)).toThrow()
    const canonicalJournal = source.virtual.bytesAt(JOURNAL_PATH)!.toString("utf8")
    const records = canonicalJournal.trimEnd().split("\n").map((line) => JSON.parse(line))
    records[1].startedAt = "2026-08-11T18:05:00.000Z"
    records[2].failedAt = "2026-08-11T18:04:00.000Z"
    const nonmonotonic = `${records.map((record) => canonicalize(record)).join("\n")}\n`

    for (const journal of [canonicalJournal.replaceAll("\n", "\r\n"), `${canonicalJournal}\n`, ` ${canonicalJournal}`, nonmonotonic]) {
      const value = harness({ existing: [{ target: JOURNAL_PATH, bytes: journal }], mode: "apply" })
      expect(errorCode(() => createHermesAegisStandingHashKey(value.options))).toBe("HERMES_KEY_AUTHORITY_REPLAY")
      expect(value.spawnSyncApi).not.toHaveBeenCalled()
    }
  })

  it("rejects a preexisting exclusive recovery claim before spawning", () => {
    const value = harness({
      mode: "apply",
      responses: [{ status: 255, stdout: "", stderr: "" }],
      clock: () => "2026-08-11T18:04:00.000Z",
    })
    expect(() => createHermesAegisStandingHashKey(value.options)).toThrow()
    value.virtual.addFile(RECOVERY_CLAIM_PATH, "claimed")
    value.options.clock = () => NOW

    expect(errorCode(() => createHermesAegisStandingHashKey(value.options))).toBe("HERMES_KEY_AUTHORITY_REPLAY")
    expect(value.spawnSyncApi).toHaveBeenCalledTimes(1)
  })

  it("contains no network, scheduler, workload, shell, or private-key-read primitive", () => {
    const source = fs.readFileSync(modulePath, "utf8")

    expect(source).not.toMatch(/node:(?:net|http|https|http2|tls|dgram|dns)/)
    expect(source).not.toMatch(/\b(?:fetch|WebSocket)\s*\(/)
    expect(source).not.toMatch(/["'](?:systemctl|schtasks|crontab|cron|at|batch)["']/)
    expect(source).not.toMatch(/\b(?:HASH_VERIFY|run-resident|scheduler-activation|autonomous-selection)\b/)
    expect(source).not.toMatch(/childProcess\.(?:exec|execSync|execFile|execFileSync|fork)\s*\(/)
    expect(source).not.toMatch(/shell\s*:\s*true/)
    expect(source).not.toMatch(/readStableFile\(fsApi,\s*PRIVATE_KEY_PATH/)
    expect(source).toContain("privateKeyInspected: false")
    expect(source).toContain("networkAccessed: false")
    expect(source).toContain("schedulerActivated: false")
    expect(source).toContain("workloadExecuted: false")
  })
})
