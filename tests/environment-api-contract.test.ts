import { describe, expect, it, vi } from "vitest"
import fs from "node:fs"

import { verifyEndpointLiveness, type UnverifiedWorldEndpoint } from "@/lib/environment/endpoint-liveness"
import { createWorkingWorld, withSurface } from "@/lib/environment/working-world"
import {
  createEnvironmentWorldProjection,
  validateEnvironmentWorldProjection,
  type EnvironmentWorldProjection,
  type WorldEndpointIdentity,
} from "@/lib/environment/world-projection"
import {
  createEnvironmentWorldService,
  distinctEndpointConflicts,
  type EnvironmentWorldRepository,
  type ResourceCandidate,
  type StoredEnvironmentWorld,
} from "@/lib/environment/world-service"
import { createHttpEnvironmentComparisonPort } from "@/lib/environment/http-comparison-port"

const instant = "2026-08-20T19:00:00.000Z"

class MemoryRepository implements EnvironmentWorldRepository {
  candidates = new Map<string, readonly ResourceCandidate[]>()
  worlds = new Map<string, Map<string, StoredEnvironmentWorld>>()

  async listResourceCandidates(userId: string) {
    return this.candidates.get(userId) ?? []
  }
  async loadExact(userId: string, worldId: string) {
    return this.worlds.get(userId)?.get(worldId) ?? null
  }
  async loadLatest(userId: string) {
    return [...(this.worlds.get(userId)?.values() ?? [])]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.world.id.localeCompare(a.world.id))[0] ?? null
  }
  async insert(userId: string, world: EnvironmentWorldProjection, now: string) {
    const owned = this.worlds.get(userId) ?? new Map<string, StoredEnvironmentWorld>()
    if (owned.has(world.id)) throw new Error("WORLD_EXISTS")
    owned.set(world.id, { world, updatedAt: now })
    this.worlds.set(userId, owned)
  }
  async update(userId: string, world: EnvironmentWorldProjection, now: string) {
    const owned = this.worlds.get(userId)
    if (!owned?.has(world.id)) return false
    owned.set(world.id, { world, updatedAt: now })
    return true
  }
}

function endpoint(worldId: string, resourceIdentity: string, suffix = worldId): WorldEndpointIdentity {
  return {
    id: `endpoint-${suffix}`,
    worldId,
    resourceIdentity,
    sandboxId: `sandbox-${suffix}`,
    appUrl: `http://127.0.0.1:${suffix === "one" ? 4101 : 4102}`,
    branch: `environment/${suffix}`,
    filesystemRoot: `/worktrees/${suffix}`,
    terminalStreamRef: `terminal://${suffix}`,
    testStreamRef: `tests://${suffix}`,
    provenance: {
      source: "runtime_registry",
      evidenceRef: `registry:${suffix}`,
      capturedAt: instant,
      liveness: { status: "reachable", httpStatus: 200, observedAt: instant, evidenceRef: `probe:${suffix}` },
    },
  }
}

describe("Environment world service", () => {
  it("binds the exact resource chosen by S1 instead of a repository constant", async () => {
    const repository = new MemoryRepository()
    repository.candidates.set("owner", [
      { candidateId: "a", canonicalIdentity: "repo:a", label: "A", weight: 1 },
      { candidateId: "b", canonicalIdentity: "repo:b", label: "B", weight: 9 },
    ])
    const resolve = vi.fn(async ({ worldId, resource }: { worldId: string; resource: ResourceCandidate }) =>
      endpoint(worldId, resource.canonicalIdentity, "one"))
    const service = createEnvironmentWorldService({
      repository,
      endpointResolver: { resolve },
      id: () => "world-one",
      now: () => instant,
    })

    const reply = await service.submitLine("owner", { text: "Fix the broken sign-in" })

    expect(reply.world.resource?.canonicalIdentity).toBe("repo:b")
    expect(reply.world.endpoints[0].resourceIdentity).toBe("repo:b")
    expect(reply.world.surfaces.every((surface) => surface.provenance.evidenceRef)).toBe(true)
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ resource: expect.objectContaining({ candidateId: "b" }) }))
  })

  it("restores the latest or an exact world and fences every lookup by user", async () => {
    const repository = new MemoryRepository()
    repository.candidates.set("alice", [{ candidateId: "a", canonicalIdentity: "repo:a", label: "A" }])
    let nextId = 0
    let tick = 0
    const service = createEnvironmentWorldService({
      repository,
      id: () => `world-${++nextId}`,
      now: () => `2026-08-20T19:00:0${tick++}.000Z`,
    })
    const first = await service.submitLine("alice", { text: "first work" })
    const second = await service.submitLine("alice", { text: "second work" })

    expect((await service.load("alice"))?.worldId).toBe(second.world.worldId)
    expect((await service.load("alice", first.world.worldId))?.intent).toBe("first work")
    expect(await service.load("bob", first.world.worldId)).toBeNull()
    await expect(service.submitLine("bob", { worldId: first.world.worldId, text: "steal" })).rejects.toThrow("WORLD_NOT_FOUND")
  })

  it("persists a no-resource sentence while refusing any execution claim", async () => {
    const repository = new MemoryRepository()
    const service = createEnvironmentWorldService({ repository, id: () => "waiting", now: () => instant })

    const reply = await service.submitLine("owner", { text: "Investigate the failure" })

    expect(reply.state).toBe("waiting_for_resource")
    expect(reply.say).toContain("have not changed anything")
    expect(reply.say).not.toMatch(/resource binding|execution endpoint|work order|queue/i)
    expect((await service.load("owner", "waiting"))?.intent).toBe("Investigate the failure")
    expect(reply.world.execution).toEqual({ state: "not_started", evidenceRefs: [] })
  })

  it("rejects success-shaped execution truth without admitted endpoint evidence", () => {
    const world = createEnvironmentWorldProjection({
      id: "world",
      resource: { candidateId: "a", canonicalIdentity: "repo:a", label: "A" },
      meaning: createWorkingWorld({ intent: "work", resources: ["repo:a"] }),
    })

    expect(() => validateEnvironmentWorldProjection({
      ...world,
      execution: { state: "observed_succeeded", summary: "done", endpointId: "not-admitted", evidenceRefs: [] },
    })).toThrow(/EXECUTION_ENDPOINT_NOT_ADMITTED|EXECUTION_EVIDENCE_REQUIRED/)
  })

  it("requires genuinely distinct endpoint isolation before Job 4 comparison", async () => {
    const repository = new MemoryRepository()
    repository.candidates.set("owner", [{ candidateId: "a", canonicalIdentity: "repo:a", label: "A" }])
    let nextId = 0
    const compare = vi.fn()
    const service = createEnvironmentWorldService({
      repository,
      id: () => `world-${++nextId}`,
      now: () => instant,
      endpointResolver: {
        resolve: async ({ worldId, resource }) => ({
          ...endpoint(worldId, resource.canonicalIdentity, worldId),
          sandboxId: "shared-sandbox",
        }),
      },
      comparisonPort: { compare },
    })
    const left = await service.submitLine("owner", { text: "left" })
    const right = await service.submitLine("owner", { text: "right" })

    const result = await service.compare("owner", {
      leftWorldId: left.world.worldId,
      rightWorldId: right.world.worldId,
    })

    expect(result.state).toBe("waiting_for_distinct_endpoints")
    expect(result.conflicts).toContain("SAME_SANDBOX")
    expect(compare).not.toHaveBeenCalled()
    expect(distinctEndpointConflicts(
      (await repository.loadExact("owner", left.world.worldId))!.world,
      (await repository.loadExact("owner", right.world.worldId))!.world,
    )).toContain("SAME_SANDBOX")
  })

  it("materializes Job 4 in one world only after two live isolated endpoints are observed", async () => {
    const repository = new MemoryRepository()
    repository.candidates.set("owner", [{ candidateId: "a", canonicalIdentity: "repo:a", label: "A" }])
    const compare = vi.fn(async () => ({
      artifactRef: "artifact:compare",
      evidenceRef: "evidence:compare",
      observedAt: instant,
      subject: "left beside right",
      conflicts: [],
      content: { left: "200 · left", right: "200 · right", summary: "Two observed implementations." },
    }))
    const service = createEnvironmentWorldService({
      repository,
      id: () => "world-compare",
      now: () => instant,
      comparisonPort: { compare },
    })
    const created = await service.submitLine("owner", { text: "Try both approaches" })

    await service.admitEndpoint("owner", created.world.worldId, endpoint(created.world.worldId, "repo:a", "one"))
    const compared = await service.admitEndpoint("owner", created.world.worldId, endpoint(created.world.worldId, "repo:a", "two"))

    expect(compared.endpoints).toHaveLength(2)
    expect(compared.endpoints[0].sandboxId).not.toBe(compared.endpoints[1].sandboxId)
    expect(compared.surfaces.filter((surface) => surface.kind === "browser")).toHaveLength(2)
    expect(compared.surfaces.find((surface) => surface.kind === "compare")).toMatchObject({
      provenance: { artifactRef: "artifact:compare", evidenceRef: "evidence:compare" },
    })
    expect(compare).toHaveBeenCalledTimes(1)
  })

  it("does not evict owner-pinned surfaces to satisfy the breathing cap", () => {
    let world = createWorkingWorld({ intent: "work" })
    for (let index = 0; index < 14; index += 1) {
      world = withSurface(world, { kind: "document", subject: `pin-${index}`, pinned: true })
    }
    world = withSurface(world, { kind: "trace", subject: "recent" })
    expect(world.surfaces.filter((surface) => surface.pinned)).toHaveLength(14)
    expect(world.surfaces.some((surface) => surface.subject === "recent")).toBe(false)
  })

  it("ships the Environment projection in the fresh sovereign bootstrap", () => {
    const bootstrap = fs.readFileSync("drizzle/0000_williamos_init.sql", "utf8")
    const migration = fs.readFileSync("drizzle/0013_environment_world.sql", "utf8")
    expect(bootstrap).toContain('CREATE TABLE "environment_world"')
    expect(bootstrap).toContain('CREATE INDEX "environment_world_user_updated_idx"')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "environment_world"')
  })
})

describe("real endpoint liveness seam", () => {
  it("requires a concrete HTTP observation and preserves its evidence", async () => {
    const candidate: UnverifiedWorldEndpoint = {
      ...endpoint("world", "repo:a", "one"),
      provenance: { source: "runtime_registry", evidenceRef: "registry:one", capturedAt: instant },
    }
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch

    const verified = await verifyEndpointLiveness(candidate, { fetchImpl, evidenceRef: "acceptance:probe", now: () => instant })

    expect(verified.provenance.liveness).toEqual({
      status: "reachable", httpStatus: 200, observedAt: instant, evidenceRef: "acceptance:probe",
    })
    expect(fetchImpl).toHaveBeenCalledWith(new URL(candidate.appUrl), expect.objectContaining({ redirect: "manual" }))
  })

  it("refuses an erroring listener as a ready application endpoint", async () => {
    const candidate: UnverifiedWorldEndpoint = {
      ...endpoint("world", "repo:a", "one"),
      provenance: { source: "runtime_registry", evidenceRef: "registry:one", capturedAt: instant },
    }
    const fetchImpl = vi.fn(async () => new Response("broken", { status: 500 })) as unknown as typeof fetch

    await expect(verifyEndpointLiveness(candidate, {
      fetchImpl,
      evidenceRef: "acceptance:probe",
      now: () => instant,
    })).rejects.toThrow("ENDPOINT_NOT_READY")
  })

  it("refuses redirects and non-allowlisted origins before they can masquerade as a world", async () => {
    const candidate: UnverifiedWorldEndpoint = {
      ...endpoint("world", "repo:a", "one"),
      provenance: { source: "runtime_registry", evidenceRef: "registry:one", capturedAt: instant },
    }
    const redirectingFetch = vi.fn(async () => new Response(null, { status: 302 })) as unknown as typeof fetch
    await expect(verifyEndpointLiveness(candidate, {
      fetchImpl: redirectingFetch,
      evidenceRef: "acceptance:probe",
    })).rejects.toThrow("ENDPOINT_NOT_READY")

    const publicCandidate = { ...candidate, appUrl: "http://169.254.169.254/latest/meta-data" }
    const forbiddenFetch = vi.fn() as unknown as typeof fetch
    await expect(verifyEndpointLiveness(publicCandidate, {
      fetchImpl: forbiddenFetch,
      evidenceRef: "acceptance:probe",
    })).rejects.toThrow("ENDPOINT_ORIGIN_NOT_ALLOWED")
    expect(forbiddenFetch).not.toHaveBeenCalled()
  })
})

describe("real Job 4 comparison seam", () => {
  it("compares two observed application responses and binds a content digest", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => new Response(
      String(input).includes("4101") ? "left implementation" : "right implementation",
      { status: 200, headers: { "content-type": "text/html" } },
    )) as unknown as typeof fetch
    const port = createHttpEnvironmentComparisonPort({ fetchImpl, now: () => instant })

    const evidence = await port.compare({
      userId: "owner",
      left: endpoint("left-world", "repo:a", "one"),
      right: endpoint("right-world", "repo:a", "two"),
    })

    expect(evidence?.artifactRef).toMatch(/^environment-compare:sha256:/)
    expect(evidence?.conflicts).toContain("RESPONSE_CONTENT_DIFFERS")
    expect(evidence?.content).toMatchObject({ summary: "Observed 1 concrete response difference." })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("refuses oversized comparison responses before reading the body", async () => {
    const fetchImpl = vi.fn(async () => new Response("small", {
      status: 200,
      headers: { "content-length": "2000001" },
    })) as unknown as typeof fetch
    const port = createHttpEnvironmentComparisonPort({ fetchImpl, now: () => instant })

    await expect(port.compare({
      userId: "owner",
      left: endpoint("left-world", "repo:a", "one"),
      right: endpoint("right-world", "repo:a", "two"),
    })).rejects.toThrow("COMPARISON_RESPONSE_TOO_LARGE")
  })
})
