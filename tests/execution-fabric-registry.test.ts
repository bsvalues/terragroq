import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

type JsonObject = Record<string, unknown>

const repositoryRoot = process.cwd()
const schemaPath = path.join(repositoryRoot, "config/execution-fabric/registry.schema.json")
const seedPath = path.join(repositoryRoot, "config/execution-fabric/registry.seed.json")
const assemblerPath = path.join(repositoryRoot, "scripts/execution-fabric/assemble-registry.mjs")
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8")) as JsonObject
const canonicalSeed = JSON.parse(fs.readFileSync(seedPath, "utf8")) as JsonObject
const temporaryDirectories: string[] = []

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value !== null && typeof value === "object") {
    const object = value as JsonObject
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "execution-fabric-registry-"))
  temporaryDirectories.push(directory)
  return directory
}

function typeMatches(value: unknown, expected: string): boolean {
  if (expected === "null") return value === null
  if (expected === "array") return Array.isArray(value)
  if (expected === "object") return typeof value === "object" && value !== null && !Array.isArray(value)
  if (expected === "integer") return typeof value === "number" && Number.isInteger(value)
  if (expected === "number") return typeof value === "number" && Number.isFinite(value)
  return typeof value === expected
}

function isRfc3339DateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/.exec(value)
  if (!match) return false
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const offsetHour = offsetHourText == null ? 0 : Number(offsetHourText)
  const offsetMinute = offsetMinuteText == null ? 0 : Number(offsetMinuteText)
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 60 || offsetHour > 23 || offsetMinute > 59) return false
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  const parseableValue = second === 60
    ? value.replace(/:(?:60)(?=(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$)/, ":59")
    : value
  return day >= 1 && day <= daysInMonth && Number.isFinite(Date.parse(parseableValue))
}

function assertSchemaConformance(value: unknown, rawRule: unknown, location = "$"): void {
  const rule = rawRule as JsonObject
  if (Array.isArray(rule.oneOf)) {
    const matches = (rule.oneOf as unknown[]).filter((candidate) => {
      try {
        assertSchemaConformance(value, candidate, location)
        return true
      } catch {
        return false
      }
    })
    expect(matches, `${location}: oneOf`).toHaveLength(1)
    return
  }
  if (typeof rule.$ref === "string") {
    const match = /^#\/\$defs\/(.+)$/.exec(rule.$ref)
    expect(match, `${location}: unsupported schema reference`).not.toBeNull()
    const definition = (schema.$defs as JsonObject)[match![1]]
    expect(definition, `${location}: missing schema definition`).toBeDefined()
    assertSchemaConformance(value, definition, location)
    return
  }

  if (Object.hasOwn(rule, "const")) {
    expect(value, `${location}: const`).toEqual(rule.const)
  }
  if (Array.isArray(rule.enum)) {
    expect(rule.enum, `${location}: enum`).toContain(value)
  }

  const expectedTypes = Array.isArray(rule.type) ? rule.type : rule.type ? [rule.type] : []
  if (expectedTypes.length > 0) {
    expect(
      expectedTypes.some((expected) => typeMatches(value, String(expected))),
      `${location}: expected ${expectedTypes.join("|")}`,
    ).toBe(true)
  }

  if (typeof value === "string") {
    if (typeof rule.minLength === "number") expect(value.length, `${location}: minLength`).toBeGreaterThanOrEqual(rule.minLength)
    if (typeof rule.pattern === "string") expect(value, `${location}: pattern`).toMatch(new RegExp(rule.pattern))
    if (rule.format === "date-time") expect(isRfc3339DateTime(value), `${location}: date-time`).toBe(true)
  }
  if (typeof value === "number") {
    if (typeof rule.minimum === "number") expect(value, `${location}: minimum`).toBeGreaterThanOrEqual(rule.minimum)
    if (typeof rule.maximum === "number") expect(value, `${location}: maximum`).toBeLessThanOrEqual(rule.maximum)
  }
  if (Array.isArray(value) && rule.items) {
    value.forEach((item, index) => assertSchemaConformance(item, rule.items, `${location}[${index}]`))
  }
  if (typeMatches(value, "object")) {
    const object = value as JsonObject
    const properties = (rule.properties ?? {}) as JsonObject
    for (const required of (rule.required ?? []) as string[]) {
      expect(Object.hasOwn(object, required), `${location}: required ${required}`).toBe(true)
    }
    if (rule.additionalProperties === false) {
      expect(Object.keys(object).filter((key) => !Object.hasOwn(properties, key)), `${location}: additional properties`).toEqual([])
    }
    for (const [key, child] of Object.entries(object)) {
      if (Object.hasOwn(properties, key)) assertSchemaConformance(child, properties[key], `${location}.${key}`)
    }
  }
}

function nodeById(seed: JsonObject, nodeId: string): JsonObject {
  const node = (seed.nodes as JsonObject[]).find((candidate) => candidate.id === nodeId)
  expect(node, `missing node ${nodeId}`).toBeDefined()
  return node!
}

function probeFor(node: JsonObject, observedAt = new Date().toISOString()): JsonObject {
  const osFamily = (node.os as JsonObject | null)?.family
  const probeName = osFamily === "windows"
    ? "scripts/execution-fabric/probe-windows.ps1"
    : "scripts/execution-fabric/probe-linux.sh"

  return {
    schema_version: "0.1-node-probe",
    node: {
      id: node.id,
      hostname: node.hostname,
      identity: clone(node.identity),
      observed_at: observedAt,
      os: clone(node.os),
      cpus: clone(node.cpus),
      dimms: clone(node.dimms),
      gpus: clone(node.gpus),
      disks: clone(node.disks),
      network: clone(node.network),
      runtimes: clone(node.runtimes),
      warnings: [],
    },
    evidence: {
      observed_at: observedAt,
      probe: probeName,
      probe_version: "test",
      confidence: "observed",
    },
  }
}

function expectProbeDegraded(result: ReturnType<typeof assemble>, nodeId: string): JsonObject {
  expect(result.status, result.stderr).toBe(0)
  const node = nodeById(result.registry!, nodeId)
  expect((node.evidence as JsonObject).confidence).toBe("declared")
  expect(node.constraints).toEqual(expect.arrayContaining(["not-schedulable-without-live-probe"]))
  expect(node.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/^LIVE_PROBE_INVALID /)]))
  return node
}

function disk(id: string, serial: string | null): JsonObject {
  return { id, model: `Disk ${id}`, serial, capacity_bytes: 1000, filesystems: [] }
}

function pinMachineIdentity(node: JsonObject, hash = "a".repeat(64)): void {
  ;(node.identity as JsonObject).machine_id_sha256 = hash
}

function capabilitySnapshot(overrides: JsonObject = {}): JsonObject {
  const snapshot: JsonObject = {
    schema: "aegis-capability/1",
    canonicalization: "jcs-rfc8785/1",
    node: "aegis",
    observed_at: "2026-08-10T12:00:00Z",
    timestamp: "2026-08-10T12:00:00+00:00",
    status: "ok",
    root_avail_gb: 1747,
    root_use_pct: 1,
    docker_active: "active",
    docker_disk: "Images=786.2MB",
    portainer_agent: "running",
    load1: "0.02",
    cores: 28,
    cpu_temp_c: "36",
    ram_total_mb: 15906,
    ram_avail_pct: 94,
    smart: "sda=PASSED sdb=ABSENT_OR_PHANTOM sdc=PASSED nvme0n1=PASSED",
    nic: "up@1000Mb",
    storage_role: "backup-ready",
    node_health: "WARN",
    compute_capability_health: "READY",
    backup_capability_health: "READY",
    archive_capability_health: "READY",
    backup_reason: "RESTORE_VERIFIED",
    scheduler: "OFF",
    backup: {
      last_backup: "20260810T120000Z",
      last_restore_verify: "20260810T120000Z",
      age_hours: "0.0",
      capability: "READY",
      reason: "RESTORE_VERIFIED",
      threshold_hours: 24,
    },
    issues: "sdb ABSENT_OR_PHANTOM",
    ...overrides,
  }
  const hashInput = clone(snapshot)
  snapshot.snapshot_sha256 = crypto.createHash("sha256").update(canonicalJson(hashInput)).digest("hex")
  return snapshot
}

function healthyAegisProbe(seed: JsonObject, observedAt = "2026-08-10T12:00:00Z"): JsonObject {
  const probe = probeFor(nodeById(seed, "aegis"), observedAt)
  ;(probe.node as JsonObject).disks = [
    {
      ...disk("backup-primary", "W4Y0C392"),
      filesystems: [{ name: "sdc1", fstype: "ext4", label: "BACKUP_PRIMARY", uuid: "0564b327-74f7-4048-9ec1-8738d09dca79", mountpoint: "/backup-primary", size_bytes: 1000 }],
    },
    {
      ...disk("backup-secondary", "6VPAE286"),
      filesystems: [{ name: "sda1", fstype: "ext4", label: "BACKUP_SECONDARY", uuid: "ab119332-259b-4714-a274-8add6dbb9351", mountpoint: "/backup-secondary", size_bytes: 1000 }],
    },
  ]
  ;(probe.node as JsonObject).runtimes = [{
    id: "backup-health",
    kind: "backup",
    version: "1",
    state: "healthy",
    endpoint: null,
    details: {},
  }]
  return probe
}

function backupReceipt(overrides: JsonObject = {}): JsonObject {
  return {
    schema: "aegis-backup-state/1",
    observed_at: "2026-08-10T12:00:00Z",
    backup_generation: "20260810T120000Z",
    last_backup: "20260810T120000Z",
    last_hash_verify: "20260810T120000Z",
    last_restore_verify: "20260810T120000Z",
    primary_result: "RESTORE_VERIFIED/RESTORE_VERIFIED/RESTORE_VERIFIED",
    secondary_result: "OK",
    protected_sources: [
      { source: "atlas:tf-postgres", status: "RESTORE_VERIFIED" },
      { source: "atlas:/forge/terrafusion", status: "RESTORE_VERIFIED" },
      { source: "hermes:HermesLab+ollama-meta", status: "RESTORE_VERIFIED" },
      { source: "atlas:tf-mongo", status: "SKIPPED" },
    ],
    primary_crown_jewel_manifest_sha256: "a".repeat(64),
    secondary_crown_jewel_manifest_sha256: "a".repeat(64),
    primary_free: "867G",
    secondary_free: "870G",
    receipt: "/backup-primary/receipts/20260810T120000Z.json",
    ...overrides,
  }
}

function assemble(
  seed: JsonObject,
  probes: Record<string, JsonObject> = {},
  options: { capabilityEvidence?: JsonObject | string, backupReceipt?: JsonObject | string | null, nowUtc?: string, pinEvidence?: boolean } = {},
) {
  const root = temporaryDirectory()
  const evidenceDirectory = path.join(root, "evidence")
  const testSeedPath = path.join(root, "seed.json")
  const outputPath = path.join(root, "snapshot.json")
  fs.mkdirSync(evidenceDirectory, { recursive: true })
  const capabilityContent = options.capabilityEvidence === undefined
    ? undefined
    : typeof options.capabilityEvidence === "string" ? options.capabilityEvidence : `${JSON.stringify(options.capabilityEvidence, null, 2)}\n`
  const receiptEvidence = options.backupReceipt === undefined ? backupReceipt() : options.backupReceipt
  const receiptContent = receiptEvidence === null ? null : typeof receiptEvidence === "string" ? receiptEvidence : `${JSON.stringify(receiptEvidence, null, 2)}\n`
  if (options.pinEvidence !== false) {
    const policy = nodeById(seed, "aegis").capability_evidence_policy as JsonObject
    if (capabilityContent !== undefined) policy.accepted_capability_file_sha256 = crypto.createHash("sha256").update(capabilityContent).digest("hex")
    if (receiptContent !== null) policy.accepted_backup_receipt_sha256 = crypto.createHash("sha256").update(receiptContent).digest("hex")
  }
  fs.writeFileSync(testSeedPath, `${JSON.stringify(seed, null, 2)}\n`)
  for (const [nodeId, probe] of Object.entries(probes)) {
    fs.writeFileSync(path.join(evidenceDirectory, `${nodeId}.json`), `${JSON.stringify(probe, null, 2)}\n`)
  }
  if (capabilityContent !== undefined) fs.writeFileSync(path.join(evidenceDirectory, "aegis-capability.json"), capabilityContent)
  if (receiptContent !== null) fs.writeFileSync(path.join(evidenceDirectory, "aegis-backup-state.json"), receiptContent)

  const result = spawnSync(
    process.execPath,
    [assemblerPath, "--seed", testSeedPath, "--evidence-dir", evidenceDirectory, "--out", outputPath],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env, ...(options.nowUtc ? { FABRIC_NOW_UTC: options.nowUtc } : {}) },
    },
  )
  const registry = fs.existsSync(outputPath) ? JSON.parse(fs.readFileSync(outputPath, "utf8")) as JsonObject : null
  return { ...result, registry }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe("Execution Fabric registry schema and identity", () => {
  it("keeps the declared seed schema-conformant", () => {
    assertSchemaConformance(canonicalSeed, schema)
  })

  it("uses AEGIS as the canonical secondary node identity", () => {
    const ids = (canonicalSeed.nodes as JsonObject[]).map((node) => node.id)
    const aegis = nodeById(canonicalSeed, "aegis")

    expect(ids).toEqual(["omen", "hermes-node", "atlas", "aegis", "azure"])
    expect(ids).not.toContain("t5810-2")
    expect(aegis).toMatchObject({
      hostname: "aegis",
      availability_class: "secondary",
      constraints: expect.arrayContaining([
        "scheduler-disabled",
        "backup-archive-execution-authority-not-granted",
        "nas-service-and-authority-pending",
      ]),
    })
    expect((aegis.authority as JsonObject).allow).toEqual(expect.arrayContaining(["cpu-batch-candidate", "docker-worker-candidate"]))
    expect((aegis.authority as JsonObject).deny).toEqual(expect.arrayContaining([
      "authoritative-durable-state",
      "backup-archive-execution-authority-not-granted",
      "nas-until-service-and-authority-proven",
      "destructive-disk-action",
    ]))
    expect(aegis.capabilities).toEqual(expect.arrayContaining(["backup-target", "archive-storage"]))
    expect(aegis.capabilities).not.toEqual(expect.arrayContaining(["nas"]))
    expect(canonicalSeed.scheduler).toEqual(expect.objectContaining({ state: "disabled" }))
  })
})

describe("Execution Fabric fail-closed assembly", () => {
  it("marks every node unschedulable when live probes are missing", () => {
    const result = assemble(clone(canonicalSeed))

    expect(result.status, result.stderr).toBe(0)
    expect(result.registry!.scheduler).toEqual(expect.objectContaining({ state: "disabled" }))
    for (const node of result.registry!.nodes as JsonObject[]) {
      expect(node.warnings).toEqual(expect.arrayContaining(["LIVE_PROBE_MISSING"]))
      expect(node.constraints).toEqual(expect.arrayContaining(["not-schedulable-without-live-probe"]))
    }
  })

  it("marks stale probe evidence unschedulable", () => {
    const seed = clone(canonicalSeed)
    const omen = nodeById(seed, "omen")
    const staleProbe = probeFor(omen, "2000-01-01T00:00:00.000Z")
    const result = assemble(seed, { omen: staleProbe })
    const assembledOmen = nodeById(result.registry!, "omen")

    expect(result.status, result.stderr).toBe(0)
    expect(assembledOmen.constraints).toEqual(expect.arrayContaining(["not-schedulable-stale-evidence"]))
    expect(assembledOmen.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/^LIVE_PROBE_STALE age_seconds=/)]))
    expect((assembledOmen.evidence as JsonObject).ttl_seconds).toBe(300)
  })

  it("fences fresh evidence when capability inventory is incomplete", () => {
    const seed = clone(canonicalSeed)
    const aegis = nodeById(seed, "aegis")
    const incompleteProbe = probeFor(aegis)
    ;(incompleteProbe.node as JsonObject).runtimes = []
    const result = assemble(seed, { aegis: incompleteProbe })
    const assembledAegis = nodeById(result.registry!, "aegis")

    expect(result.status, result.stderr).toBe(0)
    expect((assembledAegis.evidence as JsonObject).confidence).toBe("observed")
    expect(assembledAegis.constraints).toEqual(expect.arrayContaining(["not-schedulable-incomplete-inventory"]))
    expect(assembledAegis.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/^LIVE_PROBE_INCOMPLETE /)]))
  })

  it("fails closed on a future-dated probe", () => {
    const seed = clone(canonicalSeed)
    const omen = nodeById(seed, "omen")
    const futureProbe = probeFor(omen, "2999-01-01T00:00:00.000Z")
    const result = assemble(seed, { omen: futureProbe })
    const assembledOmen = nodeById(result.registry!, "omen")

    expect(result.status, result.stderr).toBe(0)
    expect(assembledOmen.constraints).toEqual(expect.arrayContaining(["not-schedulable-stale-evidence"]))
    expect(assembledOmen.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/^LIVE_PROBE_FUTURE /)]))
  })

  it.each([
    "2026-08-09",
    "2026-08-09T12:30:00",
    "2026-02-30T12:30:00Z",
  ])("rejects non-RFC3339 observed_at value %s", (observedAt) => {
    const seed = clone(canonicalSeed)
    const omen = nodeById(seed, "omen")
    const malformedProbe = probeFor(omen, observedAt)
    const result = assemble(seed, { omen: malformedProbe })

    expectProbeDegraded(result, "omen")
  })

  it.each([
    "2026-08-09t12:30:00z",
    "2026-08-09T12:30:60Z",
  ])("accepts RFC3339-permitted observed_at value %s", (observedAt) => {
    const seed = clone(canonicalSeed)
    const omen = nodeById(seed, "omen")
    const result = assemble(seed, { omen: probeFor(omen, observedAt) })

    expect(result.status, result.stderr).toBe(0)
    expect((nodeById(result.registry!, "omen").evidence as JsonObject).confidence).toBe("observed")
  })

  it("rejects malformed probe shape without publishing it as observed", () => {
    const seed = clone(canonicalSeed)
    const aegis = nodeById(seed, "aegis")
    const malformedProbe = probeFor(aegis)
    ;(malformedProbe.node as JsonObject).gpus = {}
    const result = assemble(seed, { aegis: malformedProbe })
    const assembledAegis = nodeById(result.registry!, "aegis")

    expect(result.status, result.stderr).toBe(0)
    expect((assembledAegis.evidence as JsonObject).confidence).toBe("declared")
    expect(assembledAegis.constraints).toEqual(expect.arrayContaining(["not-schedulable-without-live-probe"]))
    expect(assembledAegis.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/^LIVE_PROBE_INVALID /)]))
  })

  it("degrades a probe with a malformed nested disk instead of aborting assembly", () => {
    const seed = clone(canonicalSeed)
    const aegis = nodeById(seed, "aegis")
    const malformedProbe = probeFor(aegis)
    ;(malformedProbe.node as JsonObject).disks = [null]
    const result = assemble(seed, { aegis: malformedProbe })

    expect(result.status, result.stderr).toBe(0)
    expectProbeDegraded(result, "aegis")
    expect(result.stderr).not.toContain("TypeError")
  })

  it("rejects invalid nested probe data before publishing any observed inventory", () => {
    const seed = clone(canonicalSeed)
    const omen = nodeById(seed, "omen")
    const invalidProbe = probeFor(omen)
    ;(invalidProbe.node as JsonObject).cpus = [
      { id: "untrusted-cpu", model: "Impossible CPU", cores: 0, threads: 32 },
    ]
    const result = assemble(seed, { omen: invalidProbe })
    const assembledOmen = expectProbeDegraded(result, "omen")

    expect(assembledOmen.cpus).toEqual(omen.cpus)
    expect(JSON.stringify(assembledOmen)).not.toContain("untrusted-cpu")
    expect(JSON.stringify(assembledOmen)).not.toContain("Impossible CPU")
  })

  it.each([
    ["os", (probe: JsonObject) => {
      ;((probe.node as JsonObject).os as JsonObject).untrusted = "claim"
    }],
    ["filesystem", (probe: JsonObject) => {
      ;(probe.node as JsonObject).disks = [{
        ...disk("disk-a", "SERIAL-A"),
        filesystems: [{ size_bytes: 100, untrusted: "claim" }],
      }]
    }],
    ["runtime details", (probe: JsonObject) => {
      ;(probe.node as JsonObject).runtimes = [{
        id: "runtime-a",
        kind: "test",
        version: null,
        state: "healthy",
        endpoint: null,
        details: { untrusted: "claim" },
      }]
    }],
  ])("rejects arbitrary nested %s claims", (_field, mutate) => {
    const seed = clone(canonicalSeed)
    const omen = nodeById(seed, "omen")
    const malformedProbe = probeFor(omen)
    mutate(malformedProbe)
    const result = assemble(seed, { omen: malformedProbe })

    expectProbeDegraded(result, "omen")
  })

  it("rejects an untrusted probe name before publishing observed evidence", () => {
    const seed = clone(canonicalSeed)
    const omen = nodeById(seed, "omen")
    const untrustedProbe = probeFor(omen)
    ;(untrustedProbe.evidence as JsonObject).probe = "attacker-controlled-probe"
    const result = assemble(seed, { omen: untrustedProbe })
    const assembledOmen = expectProbeDegraded(result, "omen")

    expect((assembledOmen.evidence as JsonObject).probe).not.toBe("attacker-controlled-probe")
  })

  it("rejects an observed OS family that conflicts with the trusted node declaration", () => {
    const seed = clone(canonicalSeed)
    const omen = nodeById(seed, "omen")
    const conflictingProbe = probeFor(omen)
    ;(conflictingProbe.node as JsonObject).os = {
      family: "linux",
      name: "Copied identity host",
      version: "24.04",
    }
    const result = assemble(seed, { omen: conflictingProbe })

    expectProbeDegraded(result, "omen")
  })

  it("requires a probe to carry machine identity binding", () => {
    const seed = clone(canonicalSeed)
    const omen = nodeById(seed, "omen")
    const unboundProbe = probeFor(omen)
    delete (unboundProbe.node as JsonObject).identity
    const result = assemble(seed, { omen: unboundProbe })

    expectProbeDegraded(result, "omen")
  })

  it("rejects a probe whose machine identity does not match the declared node", () => {
    const seed = clone(canonicalSeed)
    const omen = nodeById(seed, "omen")
    const mismatchedProbe = probeFor(omen)
    ;((mismatchedProbe.node as JsonObject).identity as JsonObject).machine_id_sha256 = "f".repeat(64)
    const result = assemble(seed, { omen: mismatchedProbe })

    expectProbeDegraded(result, "omen")
  })

  it("accepts an exact machine identity match as observed evidence", () => {
    const seed = clone(canonicalSeed)
    const omen = nodeById(seed, "omen")
    const result = assemble(seed, { omen: probeFor(omen) })
    const assembledOmen = nodeById(result.registry!, "omen")

    expect(result.status, result.stderr).toBe(0)
    expect((assembledOmen.evidence as JsonObject).confidence).toBe("observed")
    expect(assembledOmen.identity).toEqual(omen.identity)
    expect(assembledOmen.constraints).not.toEqual(expect.arrayContaining(["not-schedulable-without-live-probe"]))
  })

  it("produces a schema-conformant snapshot from fresh probes", () => {
    const seed = clone(canonicalSeed)
    const probes = Object.fromEntries((seed.nodes as JsonObject[]).map((node) => [String(node.id), probeFor(node)]))
    const result = assemble(seed, probes)

    expect(result.status, result.stderr).toBe(0)
    assertSchemaConformance(result.registry, schema)
    expect((nodeById(result.registry!, "azure").evidence as JsonObject).confidence).toBe("declared")
    for (const nodeId of ["omen", "hermes-node", "atlas", "aegis"]) {
      expect((nodeById(result.registry!, nodeId).evidence as JsonObject).confidence).toBe("observed")
    }
  })
})

describe("Execution Fabric AEGIS capability evidence", () => {
  const nowUtc = "2026-08-10T12:00:00Z"

  function assembleAegis(capabilityEvidence?: JsonObject | string, probeObservedAt = nowUtc, receipt: JsonObject | string = backupReceipt()) {
    const seed = clone(canonicalSeed)
    return assemble(
      seed,
      { aegis: healthyAegisProbe(seed, probeObservedAt) },
      { capabilityEvidence, backupReceipt: receipt, nowUtc },
    )
  }

  function aegisHealth(result: ReturnType<typeof assemble>): JsonObject {
    expect(result.status, result.stderr).toBe(0)
    return nodeById(result.registry!, "aegis").capability_health as JsonObject
  }

  it("promotes fresh evidence-backed backup and archive capability only", () => {
    const snapshot = capabilitySnapshot()
    const result = assembleAegis(snapshot)
    const health = aegisHealth(result)

    expect(health.compute).toMatchObject({ state: "READY", reason: "COMPUTE_CAPABILITY_READY" })
    expect(health.backup_target).toMatchObject({
      state: "READY",
      reason: "RESTORE_VERIFIED",
      observed_at: nowUtc,
      expires_at: "2026-08-11T12:00:00.000Z",
      snapshot_sha256: snapshot.snapshot_sha256,
      evidence_ref: "aegis-capability.json",
    })
    expect(health.archive_storage).toMatchObject({ state: "READY", reason: "RESTORE_VERIFIED" })
    expect(health.nas).toEqual({
      state: "PENDING",
      reason: "NAS_SERVICE_UNPROVEN",
      observed_at: null,
      expires_at: null,
      snapshot_sha256: null,
      evidence_ref: null,
    })
    assertSchemaConformance(result.registry, schema)
  })

  it("retains pending backup and archive axes when capability evidence is missing", () => {
    const result = assembleAegis()
    const aegis = nodeById(result.registry!, "aegis")
    const health = aegisHealth(result)

    expect(health.compute).toMatchObject({ state: "UNKNOWN", reason: "CAPABILITY_EVIDENCE_MISSING" })
    expect(health.backup_target).toMatchObject({ state: "PENDING", reason: "CAPABILITY_EVIDENCE_MISSING" })
    expect(health.archive_storage).toMatchObject({ state: "PENDING", reason: "CAPABILITY_EVIDENCE_MISSING" })
    expect(aegis.warnings).toEqual(expect.arrayContaining(["CAPABILITY_EVIDENCE_MISSING"]))
  })

  it("fails capability axes closed for malformed JSON without failing assembly", () => {
    const result = assembleAegis("{not-json")
    const health = aegisHealth(result)

    expect(health.compute).toMatchObject({ state: "DEGRADED", reason: "CAPABILITY_EVIDENCE_MALFORMED" })
    expect(health.backup_target).toMatchObject({ state: "FAIL_CLOSED", reason: "CAPABILITY_EVIDENCE_MALFORMED" })
    expect((nodeById(result.registry!, "aegis").warnings as string[]).join(" ")).toContain("CAPABILITY_EVIDENCE_MALFORMED")
  })

  it("fails capability axes closed on a self-hash mismatch", () => {
    const snapshot = capabilitySnapshot()
    snapshot.snapshot_sha256 = "0".repeat(64)
    const health = aegisHealth(assembleAegis(snapshot))

    expect(health.backup_target).toMatchObject({ state: "FAIL_CLOSED", reason: "CAPABILITY_HASH_MISMATCH" })
    expect(health.archive_storage).toMatchObject({ state: "FAIL_CLOSED", reason: "CAPABILITY_HASH_MISMATCH" })
  })

  it("fails backup and archive closed at the freshness threshold", () => {
    const seed = clone(canonicalSeed)
    const result = assemble(
      seed,
      { aegis: healthyAegisProbe(seed, "2026-08-11T12:00:00Z") },
      { capabilityEvidence: capabilitySnapshot(), nowUtc: "2026-08-11T12:00:00Z" },
    )
    const health = aegisHealth(result)

    expect(health.backup_target).toMatchObject({ state: "FAIL_CLOSED", reason: "BACKUP_STALE" })
    expect(health.archive_storage).toMatchObject({ state: "FAIL_CLOSED", reason: "BACKUP_STALE" })
  })

  it("rejects future-dated capability evidence without failing assembly", () => {
    const snapshot = capabilitySnapshot({ observed_at: "2026-08-10T12:00:01Z" })
    const health = aegisHealth(assembleAegis(snapshot))

    expect(health.backup_target).toMatchObject({ state: "FAIL_CLOSED", reason: "CAPABILITY_EVIDENCE_FUTURE" })
  })

  it("rejects capability evidence unless its scheduler posture is exactly OFF", () => {
    const snapshot = capabilitySnapshot({ scheduler: "ON" })
    const health = aegisHealth(assembleAegis(snapshot))

    expect(health.backup_target).toMatchObject({ state: "FAIL_CLOSED", reason: "CAPABILITY_SCHEDULER_NOT_OFF" })
  })

  it.each([
    ["non-RFC3339 timestamp", { timestamp: "2026-08-10 12:00:00Z" }],
    ["timestamp instant mismatch", { timestamp: "2026-08-10T12:00:01Z" }],
    ["status", { status: "ready" }],
    ["node health", { node_health: "DEGRADED" }],
    ["root availability", { root_avail_gb: 0 }],
    ["root use percentage", { root_use_pct: 101 }],
    ["core count", { cores: 0 }],
    ["RAM", { ram_total_mb: 0 }],
    ["RAM percentage", { ram_avail_pct: -1 }],
    ["READY compute without active Docker", { docker_active: "inactive" }],
    ["backup/archive disagreement", { archive_capability_health: "FAIL_CLOSED" }],
  ])("rejects tampered %s evidence", (_field, overrides) => {
    const health = aegisHealth(assembleAegis(capabilitySnapshot(overrides)))

    expect(health.backup_target).toMatchObject({ state: "FAIL_CLOSED", reason: "CAPABILITY_EVIDENCE_INVALID" })
  })

  it.each([
    ["malformed backup time", {
      last_backup: "2026-08-10T12:00:00Z",
      last_restore_verify: "20260810T120000Z",
    }],
    ["future backup time", {
      last_backup: "20260810T120001Z",
      last_restore_verify: "20260810T120001Z",
    }],
    ["restore before backup", {
      last_backup: "20260810T115900Z",
      last_restore_verify: "20260810T115800Z",
    }],
  ])("rejects READY evidence with %s", (_case, times) => {
    const snapshot = capabilitySnapshot({
      backup: {
        ...clone((capabilitySnapshot().backup as JsonObject)),
        ...times,
      },
    })
    const health = aegisHealth(assembleAegis(snapshot))

    expect(health.backup_target).toMatchObject({ state: "FAIL_CLOSED", reason: "CAPABILITY_EVIDENCE_INVALID" })
  })

  it("rejects READY health when backup.capability does not match both axes", () => {
    const snapshot = capabilitySnapshot({
      backup: {
        ...clone((capabilitySnapshot().backup as JsonObject)),
        capability: "FAIL_CLOSED",
      },
    })
    const health = aegisHealth(assembleAegis(snapshot))

    expect(health.backup_target).toMatchObject({ state: "FAIL_CLOSED", reason: "CAPABILITY_EVIDENCE_INVALID" })
  })

  it("rejects an unrecognized READY reason", () => {
    const snapshot = capabilitySnapshot({
      backup_reason: "COPIED",
      backup: {
        ...clone((capabilitySnapshot().backup as JsonObject)),
        reason: "COPIED",
      },
    })
    const health = aegisHealth(assembleAegis(snapshot))

    expect(health.backup_target).toMatchObject({ state: "FAIL_CLOSED", reason: "CAPABILITY_EVIDENCE_INVALID" })
  })

  it("fails READY backup and restore receipts closed when either exceeds the threshold", () => {
    const snapshot = capabilitySnapshot({
      backup: {
        ...clone((capabilitySnapshot().backup as JsonObject)),
        last_backup: "20260810T105900Z",
        last_restore_verify: "20260810T110000Z",
        threshold_hours: 1,
      },
    })
    const seed = clone(canonicalSeed)
    const result = assemble(seed, { aegis: healthyAegisProbe(seed) }, {
      capabilityEvidence: snapshot,
      backupReceipt: backupReceipt({
        observed_at: "2026-08-10T11:00:00Z",
        backup_generation: "20260810T105900Z",
        last_backup: "20260810T105900Z",
        last_hash_verify: "20260810T110000Z",
        last_restore_verify: "20260810T110000Z",
        receipt: "/backup-primary/receipts/20260810T105900Z.json",
      }),
      nowUtc,
    })
    const health = aegisHealth(result)

    expect(health.backup_target).toMatchObject({ state: "FAIL_CLOSED", reason: "BACKUP_STALE" })
    expect(health.archive_storage).toMatchObject({ state: "FAIL_CLOSED", reason: "BACKUP_STALE" })
  })

  it.each([
    ["schema", { schema: "aegis-capability/2" }],
    ["node", { node: "omen" }],
    ["canonicalization", { canonicalization: "plain-json" }],
    ["positive threshold", {
      backup: {
        last_backup: "20260810T120000Z",
        last_restore_verify: "20260810T120000Z",
        age_hours: "0.0",
        capability: "READY",
        reason: "RESTORE_VERIFIED",
        threshold_hours: 0,
      },
    }],
  ])("rejects an invalid %s contract value", (_field, overrides) => {
    const health = aegisHealth(assembleAegis(capabilitySnapshot(overrides)))

    expect(health.backup_target).toMatchObject({ state: "FAIL_CLOSED", reason: "CAPABILITY_EVIDENCE_INVALID" })
  })

  it("rejects additional nested backup keys", () => {
    const snapshot = capabilitySnapshot()
    ;(snapshot.backup as JsonObject).untrusted = true
    const health = aegisHealth(assembleAegis(snapshot))

    expect(health.backup_target).toMatchObject({ state: "FAIL_CLOSED", reason: "CAPABILITY_EVIDENCE_INVALID" })
  })

  it("preserves READY compute and the producer reason when storage evidence fails closed", () => {
    const snapshot = capabilitySnapshot({
      backup_capability_health: "FAIL_CLOSED",
      archive_capability_health: "FAIL_CLOSED",
      backup_reason: "RESTORE_VERIFICATION_FAILED",
      backup: {
        last_backup: "20260810T120000Z",
        last_restore_verify: "20260810T120000Z",
        age_hours: "0.0",
        capability: "FAIL_CLOSED",
        reason: "RESTORE_VERIFICATION_FAILED",
        threshold_hours: 24,
      },
    })
    const health = aegisHealth(assembleAegis(snapshot))

    expect(health.compute).toMatchObject({ state: "READY" })
    expect(health.backup_target).toMatchObject({ state: "FAIL_CLOSED", reason: "RESTORE_VERIFICATION_FAILED" })
    expect(health.archive_storage).toMatchObject({ state: "FAIL_CLOSED", reason: "RESTORE_VERIFICATION_FAILED" })
  })

  it("degrades compute and independently fails storage closed for a stale node probe", () => {
    const health = aegisHealth(assembleAegis(capabilitySnapshot(), "2026-08-10T11:50:00Z"))

    expect(health.compute).toMatchObject({ state: "DEGRADED", reason: "LIVE_PROBE_STALE" })
    expect(health.backup_target).toMatchObject({ state: "FAIL_CLOSED", reason: "LIVE_PROBE_STALE" })
    expect(health.archive_storage).toMatchObject({ state: "FAIL_CLOSED", reason: "LIVE_PROBE_STALE" })
  })

  it("does not mutate scheduler or authority while projecting capability health", () => {
    const seed = clone(canonicalSeed)
    const authority = clone(nodeById(seed, "aegis").authority)
    const scheduler = clone(seed.scheduler)
    const result = assemble(
      seed,
      { aegis: healthyAegisProbe(seed) },
      { capabilityEvidence: capabilitySnapshot(), nowUtc },
    )

    expect(result.status, result.stderr).toBe(0)
    expect(result.registry!.scheduler).toEqual(scheduler)
    expect(nodeById(result.registry!, "aegis").authority).toEqual(authority)
  })

  it("rejects an attempted NAS field and never promotes NAS", () => {
    const snapshot = capabilitySnapshot()
    snapshot.nas = { state: "READY", reason: "UNTRUSTED", threshold_hours: 24 }
    const result = assembleAegis(snapshot)
    const health = aegisHealth(result)

    expect(health.backup_target).toMatchObject({ state: "FAIL_CLOSED", reason: "CAPABILITY_EVIDENCE_INVALID" })
    expect(health.nas).toMatchObject({ state: "PENDING", reason: "NAS_SERVICE_UNPROVEN" })
  })

  it("bounds producer TTL by the trusted policy maximum", () => {
    const seed = clone(canonicalSeed)
    ;(nodeById(seed, "aegis").capability_evidence_policy as JsonObject).max_ttl_hours = 12
    const health = aegisHealth(assemble(seed, { aegis: healthyAegisProbe(seed) }, {
      capabilityEvidence: capabilitySnapshot(),
      nowUtc,
    }))

    expect(health.backup_target).toMatchObject({ state: "FAIL_CLOSED", reason: "CAPABILITY_TTL_EXCEEDS_POLICY" })
  })

  it("rejects altered capability bytes against the trusted pin before parsing", () => {
    const seed = clone(canonicalSeed)
    const capabilityContent = `${JSON.stringify(capabilitySnapshot(), null, 2)}\n`
    const receiptContent = `${JSON.stringify(backupReceipt(), null, 2)}\n`
    const policy = nodeById(seed, "aegis").capability_evidence_policy as JsonObject
    policy.accepted_capability_file_sha256 = crypto.createHash("sha256").update(capabilityContent).digest("hex")
    policy.accepted_backup_receipt_sha256 = crypto.createHash("sha256").update(receiptContent).digest("hex")
    const result = assemble(seed, { aegis: healthyAegisProbe(seed) }, {
      capabilityEvidence: `${capabilityContent} `,
      backupReceipt: receiptContent,
      nowUtc,
      pinEvidence: false,
    })

    expect(aegisHealth(result).backup_target).toMatchObject({ state: "FAIL_CLOSED", reason: "CAPABILITY_FILE_HASH_MISMATCH" })
  })

  it("rejects duplicate receipt JSON against the trusted exact-byte pin before parsing", () => {
    const seed = clone(canonicalSeed)
    const capabilityContent = `${JSON.stringify(capabilitySnapshot(), null, 2)}\n`
    const receiptContent = `${JSON.stringify(backupReceipt(), null, 2)}\n`
    const duplicateJson = receiptContent.replace('"schema": "aegis-backup-state/1",', '"schema": "aegis-backup-state/1",\n  "schema": "aegis-backup-state/1",')
    const policy = nodeById(seed, "aegis").capability_evidence_policy as JsonObject
    policy.accepted_capability_file_sha256 = crypto.createHash("sha256").update(capabilityContent).digest("hex")
    policy.accepted_backup_receipt_sha256 = crypto.createHash("sha256").update(receiptContent).digest("hex")
    const result = assemble(seed, { aegis: healthyAegisProbe(seed) }, {
      capabilityEvidence: capabilityContent,
      backupReceipt: duplicateJson,
      nowUtc,
      pinEvidence: false,
    })
    const health = aegisHealth(result)

    expect(health.compute).toMatchObject({ state: "READY" })
    expect(health.backup_target).toMatchObject({ state: "FAIL_CLOSED", reason: "BACKUP_RECEIPT_HASH_MISMATCH" })
  })

  it("fails storage closed when the pinned backup receipt is missing", () => {
    const seed = clone(canonicalSeed)
    const health = aegisHealth(assemble(seed, { aegis: healthyAegisProbe(seed) }, {
      capabilityEvidence: capabilitySnapshot(),
      backupReceipt: null,
      nowUtc,
    }))

    expect(health.compute).toMatchObject({ state: "READY" })
    expect(health.backup_target).toMatchObject({ state: "FAIL_CLOSED", reason: "BACKUP_RECEIPT_MISSING" })
  })

  it.each([
    ["additional receipt key", { untrusted: true }],
    ["hash before backup", { last_hash_verify: "20260810T115959Z" }],
    ["unverified source", { protected_sources: [{ source: "atlas:tf-postgres", status: "OK" }] }],
    ["manifest disagreement", { secondary_crown_jewel_manifest_sha256: "b".repeat(64) }],
    ["incorrect primary result", { primary_result: "OK" }],
    ["incorrect secondary result", { secondary_result: "RESTORE_VERIFIED" }],
  ])("fails storage closed for %s", (_case, overrides) => {
    const health = aegisHealth(assembleAegis(capabilitySnapshot(), nowUtc, backupReceipt(overrides)))

    expect(health.compute).toMatchObject({ state: "READY" })
    expect(health.backup_target).toMatchObject({ state: "FAIL_CLOSED", reason: "BACKUP_RECEIPT_INVALID" })
    expect(health.archive_storage).toMatchObject({ state: "FAIL_CLOSED", reason: "BACKUP_RECEIPT_INVALID" })
  })

  it("requires exact capability and receipt cross-field agreement", () => {
    const health = aegisHealth(assembleAegis(capabilitySnapshot(), nowUtc, backupReceipt({
      backup_generation: "20260810T115900Z",
      last_backup: "20260810T115900Z",
      last_hash_verify: "20260810T115900Z",
      last_restore_verify: "20260810T115900Z",
      receipt: "/backup-primary/receipts/20260810T115900Z.json",
    })))

    expect(health.backup_target).toMatchObject({ state: "FAIL_CLOSED", reason: "BACKUP_RECEIPT_MISMATCH" })
  })

  it("requires the raw probe to bind the exact trusted machine identity", () => {
    const seed = clone(canonicalSeed)
    const probe = healthyAegisProbe(seed)
    ;((probe.node as JsonObject).identity as JsonObject).machine_id_sha256 = "f".repeat(64)
    const health = aegisHealth(assemble(seed, { aegis: probe }, { capabilityEvidence: capabilitySnapshot(), nowUtc }))

    expect(health.compute).toMatchObject({ state: "DEGRADED", reason: "LIVE_PROBE_INVALID" })
    expect(health.backup_target).toMatchObject({ state: "FAIL_CLOSED", reason: "LIVE_PROBE_INVALID" })
  })

  it("requires exact primary and secondary serial, label, UUID, and mountpoint", () => {
    const seed = clone(canonicalSeed)
    const probe = healthyAegisProbe(seed)
    ;((((probe.node as JsonObject).disks as JsonObject[])[1].filesystems as JsonObject[])[0]).uuid = "wrong-uuid"
    const health = aegisHealth(assemble(seed, { aegis: probe }, { capabilityEvidence: capabilitySnapshot(), nowUtc }))

    expect(health.compute).toMatchObject({ state: "READY" })
    expect(health.backup_target).toMatchObject({ state: "FAIL_CLOSED", reason: "AEGIS_REQUIRED_MOUNTS_MISMATCH" })
  })

  it("fails storage closed for an incomplete raw probe while preserving compute classification", () => {
    const seed = clone(canonicalSeed)
    const probe = healthyAegisProbe(seed)
    ;(probe.node as JsonObject).disks = []
    const health = aegisHealth(assemble(seed, { aegis: probe }, { capabilityEvidence: capabilitySnapshot(), nowUtc }))

    expect(health.compute).toMatchObject({ state: "DEGRADED", reason: "LIVE_PROBE_INCOMPLETE" })
    expect(health.backup_target).toMatchObject({ state: "FAIL_CLOSED", reason: "LIVE_PROBE_INCOMPLETE" })
  })
})

describe("Execution Fabric semantic invariants", () => {
  it("returns the fail-closed exit contract for an unreadable seed", () => {
    const root = temporaryDirectory()
    const result = spawnSync(
      process.execPath,
      [assemblerPath, "--seed", path.join(root, "missing.json"), "--out", path.join(root, "snapshot.json")],
      { cwd: repositoryRoot, encoding: "utf8" },
    )

    expect(result.status).toBe(2)
    expect(result.stderr).toContain("FABRIC_REGISTRY_INVALID: unable to read seed")
  })

  it.each([
    ["missing", (seed: JsonObject) => {
      seed.nodes = (seed.nodes as JsonObject[]).filter((node) => node.id !== "azure")
    }],
    ["additional", (seed: JsonObject) => {
      const extra = clone(nodeById(seed, "aegis"))
      extra.id = "shadow-node"
      ;(seed.nodes as JsonObject[]).push(extra)
    }],
  ])("rejects a %s node because the canonical roster must match exactly", (_case, mutate) => {
    const seed = clone(canonicalSeed)
    mutate(seed)
    const result = assemble(seed)

    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/canonical.*roster|roster.*canonical/i)
    expect(result.registry).toBeNull()
  })

  it("rejects duplicate node identity", () => {
    const seed = clone(canonicalSeed)
    ;(seed.nodes as JsonObject[]).push(clone(nodeById(seed, "aegis")))
    const result = assemble(seed)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain("FABRIC_REGISTRY_INVALID: duplicate node id: aegis")
    expect(result.registry).toBeNull()
  })

  it("rejects duplicate immutable disk identity across nodes", () => {
    const seed = clone(canonicalSeed)
    const omen = nodeById(seed, "omen")
    const aegis = nodeById(seed, "aegis")
    pinMachineIdentity(aegis)
    const omenProbe = probeFor(omen)
    const aegisProbe = probeFor(aegis)
    ;(omenProbe.node as JsonObject).disks = [
      { id: "disk-a", model: "Disk A", serial: "SERIAL-1", capacity_bytes: 1000, filesystems: [] },
    ]
    ;(aegisProbe.node as JsonObject).disks = [
      { id: "disk-b", model: "Disk B", serial: "SERIAL-1", capacity_bytes: 1000, filesystems: [] },
    ]
    const result = assemble(seed, { omen: omenProbe, aegis: aegisProbe })

    expect(result.status).toBe(2)
    expect(result.stderr).toContain("disk serial SERIAL-1")
    expect(result.stderr).toContain("omen")
    expect(result.stderr).toContain("aegis")
    expect(result.registry).toBeNull()
  })

  it("removes a previous snapshot when a later assembly fails validation", () => {
    const root = temporaryDirectory()
    const evidenceDirectory = path.join(root, "evidence")
    const testSeedPath = path.join(root, "seed.json")
    const outputPath = path.join(root, "snapshot.json")
    fs.mkdirSync(evidenceDirectory, { recursive: true })
    fs.writeFileSync(outputPath, "{\"stale\":true}\n")
    const invalidSeed = clone(canonicalSeed)
    ;((nodeById(invalidSeed, "omen").authority as JsonObject).allow as string[]).push("interactive-development")
    fs.writeFileSync(testSeedPath, `${JSON.stringify(invalidSeed, null, 2)}\n`)

    const result = spawnSync(
      process.execPath,
      [assemblerPath, "--seed", testSeedPath, "--evidence-dir", evidenceDirectory, "--out", outputPath],
      { cwd: repositoryRoot, encoding: "utf8" },
    )

    expect(result.status).toBe(2)
    expect(fs.existsSync(outputPath)).toBe(false)
    expect(fs.readdirSync(root).filter((name) => name.endsWith(".tmp"))).toEqual([])
  })

  it("normalizes disk serial case and whitespace before collision detection", () => {
    const seed = clone(canonicalSeed)
    const omen = nodeById(seed, "omen")
    const aegis = nodeById(seed, "aegis")
    pinMachineIdentity(aegis)
    const omenProbe = probeFor(omen)
    const aegisProbe = probeFor(aegis)
    ;(omenProbe.node as JsonObject).disks = [disk("disk-a", "  Serial-1  ")]
    ;(aegisProbe.node as JsonObject).disks = [disk("disk-b", "sERIAL-1")]
    const result = assemble(seed, { omen: omenProbe, aegis: aegisProbe })

    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/disk serial.*serial-1|serial-1.*disk serial/i)
    expect(result.registry).toBeNull()
  })

  it("rejects duplicate disk ids within one node", () => {
    const seed = clone(canonicalSeed)
    const omen = nodeById(seed, "omen")
    const omenProbe = probeFor(omen)
    ;(omenProbe.node as JsonObject).disks = [disk("disk-a", null), disk("disk-a", null)]
    const result = assemble(seed, { omen: omenProbe })

    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/omen.*duplicate disk id.*disk-a/i)
    expect(result.registry).toBeNull()
  })

  it("rejects a blank disk serial", () => {
    const seed = clone(canonicalSeed)
    const omen = nodeById(seed, "omen")
    const omenProbe = probeFor(omen)
    ;(omenProbe.node as JsonObject).disks = [disk("disk-a", "   ")]
    const result = assemble(seed, { omen: omenProbe })

    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/omen.*disk.*serial.*blank|omen.*blank.*disk.*serial/i)
    expect(result.registry).toBeNull()
  })

  it("continues to allow a null disk serial", () => {
    const seed = clone(canonicalSeed)
    const omen = nodeById(seed, "omen")
    const omenProbe = probeFor(omen)
    ;(omenProbe.node as JsonObject).disks = [disk("disk-a", null)]
    const result = assemble(seed, { omen: omenProbe })

    expect(result.status, result.stderr).toBe(0)
    expect((nodeById(result.registry!, "omen").disks as JsonObject[])[0]).toMatchObject({
      id: "disk-a",
      serial: null,
    })
  })

  it("retains an unknown-capacity physical disk while fencing storage placement", () => {
    const seed = clone(canonicalSeed)
    const aegis = nodeById(seed, "aegis")
    pinMachineIdentity(aegis)
    const aegisProbe = probeFor(aegis)
    ;(aegisProbe.node as JsonObject).disks = [{
      ...disk("disk-failed", "CORRUPTED-IDENTITY"),
      capacity_bytes: null,
    }]
    ;(aegisProbe.node as JsonObject).warnings = [
      "disk failed: reported non-positive capacity; retained as unknown and unschedulable",
    ]

    const result = assemble(seed, { aegis: aegisProbe })
    const assembledAegis = nodeById(result.registry!, "aegis")

    expect(result.status, result.stderr).toBe(0)
    expect((assembledAegis.evidence as JsonObject).confidence).toBe("observed")
    expect((assembledAegis.disks as JsonObject[])[0]).toMatchObject({
      id: "disk-failed",
      capacity_bytes: null,
    })
    expect(assembledAegis.constraints).toEqual(expect.arrayContaining([
      "not-schedulable-unknown-disk-capacity",
    ]))
    expect(assembledAegis.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/non-positive capacity/),
    ]))
  })

  it("rejects authority entries that conflict between allow and deny", () => {
    const seed = clone(canonicalSeed)
    const aegis = nodeById(seed, "aegis")
    ;((aegis.authority as JsonObject).allow as string[]).push("destructive-disk-action")
    const result = assemble(seed)

    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/aegis.*authority.*allow.*deny|aegis.*allow.*deny.*authority/i)
    expect(result.registry).toBeNull()
  })

  it.each(["allow", "deny"])("rejects duplicate authority %s entries", (list) => {
    const seed = clone(canonicalSeed)
    const omen = nodeById(seed, "omen")
    const authority = omen.authority as JsonObject
    ;(authority[list] as string[]).push((authority[list] as string[])[0])
    const result = assemble(seed)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain(`omen: duplicate authority ${list} entry`)
    expect(result.registry).toBeNull()
  })

  it.each([
    ["omen", "deny", "authoritative-durable-state"],
    ["hermes-node", "deny", "authoritative-durable-state"],
    ["aegis", "deny", "destructive-disk-action"],
    ["azure", "deny", "implicit-use"],
    ["atlas", "allow", "authoritative-durable-state"],
  ])("requires %s authority %s boundary %s", (nodeId, list, boundary) => {
    const seed = clone(canonicalSeed)
    const node = nodeById(seed, nodeId)
    const authority = node.authority as JsonObject
    authority[list] = (authority[list] as string[]).filter((entry) => entry !== boundary)
    const result = assemble(seed)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain(`${nodeId}: authority ${list} set differs from canonical v0.2 policy`)
    expect(result.registry).toBeNull()
  })

  it("requires ATLAS to retain durable-state authority", () => {
    const seed = clone(canonicalSeed)
    const atlas = nodeById(seed, "atlas")
    ;(atlas.authority as JsonObject).allow = []
    const result = assemble(seed)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain("FABRIC_REGISTRY_INVALID: atlas must retain durable-state authority")
    expect(result.registry).toBeNull()
  })

  it("rejects a node with no authority record", () => {
    const seed = clone(canonicalSeed)
    const azure = nodeById(seed, "azure")
    delete azure.authority
    const result = assemble(seed)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain("FABRIC_REGISTRY_INVALID: azure: missing authority")
    expect(result.registry).toBeNull()
  })

  it.each(["omen", "hermes-node", "aegis"])("rejects implicit durable-state authority for %s", (nodeId) => {
    const seed = clone(canonicalSeed)
    const node = nodeById(seed, nodeId)
    ;((node.authority as JsonObject).allow as string[]).push("authoritative-durable-state")
    const result = assemble(seed)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain(`FABRIC_REGISTRY_INVALID: ${nodeId} must not gain durable-state authority implicitly`)
    expect(result.registry).toBeNull()
  })
})

describe("Execution Fabric probe and scheduler boundaries", () => {
  it.each([
    ["probe-windows.ps1", "0.1-node-probe", "probe-windows.ps1"],
    ["probe-linux.sh", "0.1-node-probe", "probe-linux.sh"],
  ])("keeps %s on the read-only evidence contract", (fileName, schemaVersion, evidenceName) => {
    const source = fs.readFileSync(path.join(repositoryRoot, "scripts/execution-fabric", fileName), "utf8")

    expect(source).toContain(schemaVersion)
    expect(source).toContain(evidenceName)
    for (const field of ["observed_at", "cpus", "dimms", "gpus", "disks", "network", "runtimes", "confidence"]) {
      expect(source).toContain(field)
    }
    expect(source).not.toMatch(/\b(Remove-Item|Start-Service|Stop-Service|Restart-Service|Enable-ScheduledTask|Disable-ScheduledTask)\b/i)
    expect(source).not.toMatch(/\b(mkfs|wipefs|parted|fdisk|systemctl\s+(?:start|stop|restart|enable|disable)|docker\s+(?:run|start|stop|rm))\b/i)
  })

  it("normalizes probe disk identity and capacity without inventing storage facts", () => {
    const linux = fs.readFileSync(path.join(repositoryRoot, "scripts/execution-fabric/probe-linux.sh"), "utf8")
    const windows = fs.readFileSync(path.join(repositoryRoot, "scripts/execution-fabric/probe-windows.ps1"), "utf8")

    expect(linux).toContain("child_size = int(c.get('size') or 0)")
    expect(linux).toContain("if child_size <= 0")
    expect(linux).toContain("'size_bytes':child_size")
    expect(linux).toContain("'serial': serial")
    expect(windows).toContain("function Convert-PositiveInt64")
    expect(windows).toContain("function Convert-NonBlankString")
    expect(windows).toContain("capacity_bytes = $capacity")
    expect(windows).toContain("serial = Convert-NonBlankString")
    expect(windows).toContain("ConvertTo-Json -InputObject $result")
    expect(windows).toContain("[System.IO.Path]::IsPathRooted($OutputPath)")
    expect(windows).toContain("GetFullPath")
    expect(linux).toContain("def systemctl_state(unit)")
    expect(linux).toContain("'--property=LoadState'")
    expect(linux).toContain("'hostname':canonical_hostname")
  })

  it("keeps scheduler activation absent in v0.2", () => {
    const readme = fs.readFileSync(path.join(repositoryRoot, "scripts/execution-fabric/README.md"), "utf8")
    const assembler = fs.readFileSync(assemblerPath, "utf8")
    const schemaProperties = schema.properties as JsonObject
    const schedulerRule = schemaProperties.scheduler as JsonObject

    expect(readme).toContain("scheduling remains disabled in v0.2")
    expect((schema.required as string[])).toContain("scheduler")
    expect(schedulerRule).toBeDefined()
    expect(JSON.stringify(schedulerRule)).toContain('"disabled"')
    expect(schemaProperties).not.toHaveProperty("placement")
    expect(assembler).not.toMatch(/\b(dispatch|placeWorkload|scheduleWorkload|activateScheduler)\s*\(/)
  })
})
