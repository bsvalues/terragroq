import { spawnSync } from "node:child_process"
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

  if (Object.prototype.hasOwnProperty.call(rule, "const")) {
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
    if (rule.format === "date-time") expect(Number.isFinite(Date.parse(value)), `${location}: date-time`).toBe(true)
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
      expect(Object.prototype.hasOwnProperty.call(object, required), `${location}: required ${required}`).toBe(true)
    }
    if (rule.additionalProperties === false) {
      expect(Object.keys(object).filter((key) => !(key in properties)), `${location}: additional properties`).toEqual([])
    }
    for (const [key, child] of Object.entries(object)) {
      if (properties[key]) assertSchemaConformance(child, properties[key], `${location}.${key}`)
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

function assemble(seed: JsonObject, probes: Record<string, JsonObject> = {}) {
  const root = temporaryDirectory()
  const evidenceDirectory = path.join(root, "evidence")
  const testSeedPath = path.join(root, "seed.json")
  const outputPath = path.join(root, "snapshot.json")
  fs.mkdirSync(evidenceDirectory, { recursive: true })
  fs.writeFileSync(testSeedPath, `${JSON.stringify(seed, null, 2)}\n`)
  for (const [nodeId, probe] of Object.entries(probes)) {
    fs.writeFileSync(path.join(evidenceDirectory, `${nodeId}.json`), `${JSON.stringify(probe, null, 2)}\n`)
  }

  const result = spawnSync(
    process.execPath,
    [assemblerPath, "--seed", testSeedPath, "--evidence-dir", evidenceDirectory, "--out", outputPath],
    { cwd: repositoryRoot, encoding: "utf8" },
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
      constraints: expect.arrayContaining(["scheduler-disabled", "storage-capability-pending"]),
    })
    expect((aegis.authority as JsonObject).allow).toEqual(expect.arrayContaining(["cpu-batch-candidate", "docker-worker-candidate"]))
    expect((aegis.authority as JsonObject).deny).toEqual(expect.arrayContaining([
      "authoritative-durable-state",
      "backup-archive-until-storage-proven",
      "nas-until-storage-proven",
      "destructive-disk-action",
    ]))
    expect(aegis.capabilities).not.toEqual(expect.arrayContaining(["backup-archive", "nas"]))
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
  })
})

describe("Execution Fabric semantic invariants", () => {
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
    expect(result.stderr).toContain(`${nodeId}: authority ${list} set differs from canonical v0.1 policy`)
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

  it("keeps scheduler activation absent in v0.1", () => {
    const readme = fs.readFileSync(path.join(repositoryRoot, "scripts/execution-fabric/README.md"), "utf8")
    const assembler = fs.readFileSync(assemblerPath, "utf8")
    const schemaProperties = schema.properties as JsonObject
    const schedulerRule = schemaProperties.scheduler as JsonObject

    expect(readme).toContain("scheduling remains disabled in v0.1")
    expect((schema.required as string[])).toContain("scheduler")
    expect(schedulerRule).toBeDefined()
    expect(JSON.stringify(schedulerRule)).toContain('"disabled"')
    expect(schemaProperties).not.toHaveProperty("placement")
    expect(assembler).not.toMatch(/\b(dispatch|placeWorkload|scheduleWorkload|activateScheduler)\s*\(/)
  })
})
