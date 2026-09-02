import { generateKeyPairSync } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { hashRecord } from "@/lib/governance/hash"

const seams = vi.hoisted(() => ({
  getSession: vi.fn(),
  load: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  save: vi.fn(),
  defaultSpace: vi.fn(),
  resolveBinding: vi.fn(),
  resolveOwner: vi.fn(),
  assertOwner: vi.fn(),
}))

vi.mock("@/lib/session", () => ({ getSession: seams.getSession }))
vi.mock("@/lib/governance/owner", () => ({
  resolveOwnerUserId: seams.resolveOwner,
  assertOwner: seams.assertOwner,
}))
vi.mock("@/lib/governance/owner-lookup", () => ({ ownerLookup: () => ({}) }))
vi.mock("@/lib/projects/workspace-project-binding", () => ({
  resolveCanonicalWorkspaceProjectBinding: seams.resolveBinding,
}))
vi.mock("@/lib/environment/space-persistence", () => ({
  workspaceProjectFromRoot: () => ({ identity: "c:/project", name: "Project" }),
  browserSpaceStorageKey: () => "opaque-browser-key",
  createDefaultSpace: seams.defaultSpace,
  loadOrCreateOwnedSpace: seams.load,
  listOwnedProjectSpaces: seams.list,
  createOwnedProjectSpace: seams.create,
  saveOwnedSpace: seams.save,
}))
vi.mock("@/lib/environment/workspace-app", () => ({
  admitWorkspaceApp: async () => ({ ok: false }),
  williamOsOrigin: () => "http://localhost",
}))

import {
  GET,
  PATCH,
  POST,
  PUT,
} from "@/app/api/environment/space/route"

const current = { worldId: "a", name: "Alpha", space: { revision: 2 }, spine: {}, judgment: null, project: { identity: "c:/project", name: "Project" } }

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__williamosMergedExternalFinalizationDependencies
  seams.getSession.mockReset().mockResolvedValue({ user: { id: "owner" } })
  seams.load.mockReset().mockResolvedValue(current)
  seams.list.mockReset().mockResolvedValue([{ worldId: "a", name: "Alpha", space: { revision: 2 }, updatedAt: "2026-08-28T00:00:00Z" }])
  seams.create.mockReset().mockResolvedValue({ ...current, worldId: "b", name: "Beta", space: { revision: 0 } })
  seams.save.mockReset()
  seams.defaultSpace.mockReset().mockReturnValue({ schemaVersion: 1, revision: 0, windows: [], openFiles: [], panes: [], selection: null, activeWindowId: null, activePaneId: null, runningAppUrl: null })
  seams.resolveBinding.mockReset().mockResolvedValue({ ok: true, binding: {
    workspaceAppUrl: null,
    project: { identity: "c:/project", name: "Project" },
  } })
  seams.resolveOwner.mockReset().mockResolvedValue("owner")
  seams.assertOwner.mockReset().mockReturnValue({ ok: true })
})

describe("Experience V2 Space route", () => {
  it("refuses an unverified Project binding instead of fabricating a TerraFusion Space", async () => {
    seams.resolveBinding.mockResolvedValueOnce({ ok: false, error: "WORKSPACE_ROOT_PROJECT_MISMATCH" })
    const response = await GET(new Request("http://localhost/api/environment/space"))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "WORKSPACE_ROOT_PROJECT_MISMATCH" })
    expect(seams.load).not.toHaveBeenCalled()
  })

  it("returns the exact current envelope with the bounded real collection and opaque preference namespace", async () => {
    const response = await GET(new Request("http://localhost/api/environment/space?worldId=a"))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      worldId: "a", name: "Alpha", spaces: [{ worldId: "a", name: "Alpha" }],
      multiSpaceAvailable: true, preferenceStorageKey: "opaque-browser-key",
    })
    expect(seams.load).toHaveBeenCalledWith(expect.objectContaining({ worldId: "a", userId: "owner" }))
  })

  it("creates from name only and ignores client repository, path and snapshot widening", async () => {
    const response = await POST(new Request("http://localhost/api/environment/space", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: " Beta ", worldId: "client", project: { identity: "foreign" }, space: { openFiles: ["secret"] } }),
    }))
    expect(response.status).toBe(201)
    expect(seams.create).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner", name: " Beta " }))
    expect(seams.create.mock.calls[0][0]).not.toHaveProperty("worldId")
    expect(seams.create.mock.calls[0][0]).not.toHaveProperty("space")
  })

  it("selects only the canonical WilliamOS Project while keeping TerraFusion as the default", async () => {
    const response = await POST(new Request("http://localhost/api/environment/space", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "WilliamOS delivery", projectKey: "williamos" }),
    }))
    expect(response.status).toBe(201)
    expect(seams.resolveBinding).toHaveBeenCalledWith("owner", "williamos")

    await GET(new Request("http://localhost/api/environment/space"))
    expect(seams.resolveBinding).toHaveBeenLastCalledWith("owner", "terrafusion")
  })

  it.each([
    ["GET", () => GET(new Request("http://localhost/api/environment/space?projectKey=foreign"))],
    ["POST", () => POST(new Request("http://localhost/api/environment/space", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectKey: "foreign" }),
    }))],
    ["PUT", () => PUT(new Request("http://localhost/api/environment/space", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ worldId: "a", space: {}, projectKey: { repository: "bsvalues/terragroq" } }),
    }))],
    ["PATCH", () => PATCH(new Request("http://localhost/api/environment/space", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "FINALIZE_MERGED_EXTERNAL_DELIVERY", worldId: "a", projectKey: "foreign" }),
    }))],
  ])("rejects an unregistered %s project selector before binding or persistence", async (_method, invoke) => {
    seams.resolveBinding.mockClear()
    const response = await invoke()
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "SPACE_PROJECT_INVALID" })
    expect(seams.resolveBinding).not.toHaveBeenCalled()
  })

  it("never degrades an exact missing or project-mismatched lookup into browser state", async () => {
    seams.load.mockResolvedValueOnce(null)
    const missing = await GET(new Request("http://localhost/api/environment/space?worldId=foreign"))
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: "WORLD_NOT_FOUND" })

    seams.load.mockRejectedValueOnce(new Error("SPACE_PROJECT_MISMATCH"))
    const mismatch = await GET(new Request("http://localhost/api/environment/space?worldId=stale"))
    expect(mismatch.status).toBe(400)
    expect(await mismatch.json()).toEqual({ error: "SPACE_PROJECT_MISMATCH" })
  })

  it("uses one truthful browser-local Space only for default persistence degradation", async () => {
    seams.load.mockRejectedValueOnce(new Error("database unavailable"))
    seams.resolveBinding.mockResolvedValueOnce({ ok: true, binding: {
      workspaceAppUrl: null,
      project: { identity: "c:/williamos", name: "WilliamOS" },
    } })
    const response = await GET(new Request("http://localhost/api/environment/space?projectKey=williamos"))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      worldId: "browser-local", storage: "browser", multiSpaceAvailable: false,
      spaces: [{ worldId: "browser-local", name: "WilliamOS" }],
    })
    expect(seams.defaultSpace).toHaveBeenCalledWith(null, "WilliamOS")
  })

  it("keeps a successful server GET when only collection listing degrades", async () => {
    seams.list.mockRejectedValueOnce(new Error("list unavailable"))
    const response = await GET(new Request("http://localhost/api/environment/space?worldId=a"))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      worldId: "a", storage: "server", collectionAvailable: false,
      collectionReason: "SPACE_COLLECTION_UNAVAILABLE",
      spaces: [{ worldId: "a", name: "Alpha", space: { revision: 2 } }],
    })
  })

  it("returns a committed creation when only post-insert collection listing fails", async () => {
    seams.list.mockRejectedValueOnce(new Error("list unavailable"))
    const response = await POST(new Request("http://localhost/api/environment/space", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Beta" }),
    }))
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      worldId: "b", name: "Beta", collectionAvailable: false,
      collectionReason: "SPACE_COLLECTION_UNAVAILABLE",
      spaces: [{ worldId: "b", name: "Beta", space: { revision: 0 } }],
    })
  })

  it("returns the exact server-authored persistence timestamp without dropping existing save fields", async () => {
    seams.save.mockResolvedValueOnce({
      ...current,
      updatedAt: "2026-08-29T18:42:03.456Z",
      conversation: [{ role: "owner", text: "Keep building." }],
    })
    const response = await PUT(new Request("http://localhost/api/environment/space", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ worldId: "a", space: { revision: 3 } }),
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      worldId: "a",
      space: { revision: 2 },
      updatedAt: "2026-08-29T18:42:03.456Z",
      conversation: [{ role: "owner", text: "Keep building." }],
    })
  })

  it("returns 503 when creation persistence fails instead of fabricating a Space", async () => {
    seams.create.mockRejectedValueOnce(new Error("db down"))
    const response = await POST(new Request("http://localhost/api/environment/space", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Beta" }),
    }))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "SPACE_PERSISTENCE_UNAVAILABLE" })
  })

  it("returns a typed conflict when the bounded project collection already has twelve Spaces", async () => {
    seams.create.mockRejectedValueOnce(new Error("SPACE_LIMIT_REACHED"))
    const response = await POST(new Request("http://localhost/api/environment/space", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Thirteen" }),
    }))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: "SPACE_LIMIT_REACHED" })
  })
})

describe("merged external Space delivery finalization", () => {
  it("accepts only the signed active version or its exact completed replay successor", () => {
    const versionIsExact = (globalThis as Record<string, unknown>).__williamosMergedExternalOutcomeVersionIsExact as (input: {
      signedVersion: number
      persistedVersion: number
      lifecycleState: unknown
      workOrderStatus: unknown
    }) => boolean
    expect(versionIsExact({
      signedVersion: 3, persistedVersion: 3, lifecycleState: "active", workOrderStatus: "active",
    })).toBe(true)
    expect(versionIsExact({
      signedVersion: 3, persistedVersion: 4, lifecycleState: "completed", workOrderStatus: "closed",
    })).toBe(true)
    expect(versionIsExact({
      signedVersion: 3, persistedVersion: 5, lifecycleState: "completed", workOrderStatus: "closed",
    })).toBe(false)
    expect(versionIsExact({
      signedVersion: 3, persistedVersion: 4, lifecycleState: "active", workOrderStatus: "active",
    })).toBe(false)
  })

  it("requires the exact live Space lease and every grant to remain unexpired", () => {
    const authorityIsFresh = (globalThis as Record<string, unknown>).__williamosMergedExternalActiveAuthorityIsFresh as (input: Record<string, unknown>) => boolean
    const now = new Date("2026-09-01T12:00:00.000Z")
    const expiry = new Date("2026-09-01T13:00:00.000Z")
    const base = {
      leaseHolder: "space:space-1", leaseToken: "lease-token", leaseExpiresAt: expiry,
      admittedExpiry: expiry.toISOString(), expectedLeaseHolder: "space:space-1",
      expectedLeaseToken: "lease-token", now,
      grants: [{ status: "active", revokedAt: null, expiresAt: expiry }],
    }
    expect(authorityIsFresh(base)).toBe(true)
    expect(authorityIsFresh({ ...base, leaseExpiresAt: now, admittedExpiry: now.toISOString() })).toBe(false)
    expect(authorityIsFresh({ ...base, grants: [{ status: "active", revokedAt: null, expiresAt: now }] })).toBe(false)
    expect(authorityIsFresh({ ...base, leaseToken: "stale" })).toBe(false)
  })

  it("requires the persisted Work Order ref and version to match the signed snapshot", () => {
    const workOrderIsExact = (globalThis as Record<string, unknown>).__williamosMergedExternalWorkOrderIsExact as (input: Record<string, unknown>) => boolean
    const updatedAt = new Date("2026-09-01T12:00:00.000Z")
    const base = {
      persistedRef: "WO-74", persistedUpdatedAt: updatedAt,
      persistedClosedAt: null, persistedCompletedAt: null,
      signedRef: "WO-74", signedVersion: updatedAt.toISOString(),
      workOrderStatus: "active", outcomeLifecycleState: "active", outcomeTerminalAt: null,
    }
    expect(workOrderIsExact(base)).toBe(true)
    expect(workOrderIsExact({ ...base, persistedRef: "WO-75" })).toBe(false)
    expect(workOrderIsExact({ ...base, signedVersion: "2026-09-01T11:00:00.000Z" })).toBe(false)
    const terminalAt = new Date("2026-09-01T13:00:00.000Z")
    const replay = {
      ...base, persistedUpdatedAt: terminalAt, persistedClosedAt: terminalAt,
      persistedCompletedAt: terminalAt, workOrderStatus: "closed",
      outcomeLifecycleState: "completed", outcomeTerminalAt: terminalAt,
    }
    expect(workOrderIsExact(replay)).toBe(true)
    expect(workOrderIsExact({ ...replay, persistedCompletedAt: updatedAt })).toBe(false)
  })

  it("compares authority actions and terminal evidence refs literally", () => {
    const exact = (globalThis as Record<string, unknown>).__williamosMergedExternalExactLiteralStrings as (left: string[], right: string[]) => boolean
    const expected = ["implementation:mutate", "authority:widen", "artifact:retarget"]
    expect(exact(expected, [...expected])).toBe(true)
    expect(exact([` ${expected[0]}`, ...expected.slice(1)], expected)).toBe(false)
    expect(exact([...expected, expected[0]], expected)).toBe(false)
    expect(exact([...expected].reverse(), expected)).toBe(false)
    const queueBlocked = ["production:mutate", "release:create", "secret:access", "spend:increase"]
    expect(exact(queueBlocked, [...queueBlocked])).toBe(true)
    expect(exact(["owner/path.ts"], queueBlocked)).toBe(false)
  })

  it("requires the locked Space revision to equal the signed revision", () => {
    const exact = (globalThis as Record<string, unknown>).__williamosMergedExternalSpaceRevisionIsExact as (input: Record<string, unknown>) => boolean
    const active = { persistedRevision: 7, signedRevision: 7, lifecycleState: "active", workOrderStatus: "active" }
    expect(exact(active)).toBe(true)
    expect(exact({ ...active, persistedRevision: 8 })).toBe(false)
    expect(exact({ ...active, persistedRevision: "7" })).toBe(false)
    const replay = { ...active, lifecycleState: "completed", workOrderStatus: "closed" }
    expect(exact({ ...replay, persistedRevision: 8 })).toBe(true)
    expect(exact({ ...replay, persistedRevision: 6 })).toBe(false)
  })

  it("keeps the signed artifact reservation distinct from its hash-bound anchor reservation", () => {
    const exact = (globalThis as Record<string, unknown>).__williamosMergedExternalAuthorizationBindingIsExact as (input: Record<string, unknown>) => boolean
    const anchorAllowed = ["app/api/environment/space/route.ts", "lib/environment/space-persistence.ts", "tests/experience-v2-space-route.test.ts"]
    const artifactAllowed = [anchorAllowed[0], anchorAllowed[2]]
    const forbidden = ["production:mutate", "release:create", "secret:access", "spend:increase"]
    const context = {
      owner: "owner", worldId: "space-1", spaceRevision: 0,
      workspace: "C:/HermesLab/williamos-source", repository: "https://github.com/bsvalues/terragroq",
      pullRequest: 1124, admittedHeadSha: "a".repeat(40),
      outcome: { id: 48, key: "external:anchor", version: 1 },
      workOrder: { id: 74, ref: "WO-74", version: "2026-09-01T19:07:15.475Z" },
      grant: { id: 79, ref: "GRANT-79", version: "b".repeat(64), expiresAt: "2026-09-04T19:07:15.475Z" },
      anchorReservation: { allowed: anchorAllowed, forbidden },
      reservation: { allowed: artifactAllowed, forbidden, version: "c".repeat(64) },
    }
    const artifact = {
      pullRequest: 1124, headSha: "a".repeat(40), pullRequestBaseSha: "d".repeat(40),
      baseRefSha: "e".repeat(40), baseSha: "f".repeat(40), paths: artifactAllowed,
    }
    const previewDigest = hashRecord({ version: "williamos-delivery-seal.v2", value: { context, artifact } })
    const idempotencyKey = "adopt-1124"
    const adoptionHash = hashRecord({
      version: "williamos-delivery-seal.v2", authorityKind: "prospective_artifact_adoption",
      previewDigest, idempotencyKey,
    })
    const base = {
      authorizationMetadata: { adoptionHash, previewDigest, idempotencyKey, context, artifact },
      userId: "owner", worldId: "space-1", repository: "bsvalues/terragroq",
      pullRequest: 1124, headSha: "a".repeat(40), spaceRevision: 0,
      outcome: context.outcome, workOrder: context.workOrder,
      implementationGrant: { id: 79, ref: "GRANT-79", version: "b".repeat(64) },
      anchorAllowed, anchorForbidden: forbidden,
      admittedAllowed: anchorAllowed, admittedForbidden: forbidden,
      implementationAllowed: anchorAllowed, implementationBlocked: forbidden,
      signedAdoptionHash: adoptionHash, signedReservation: context.reservation,
    }
    expect(exact(base)).toBe(true)
    expect(exact({ ...base, anchorAllowed: artifactAllowed })).toBe(false)
    expect(exact({ ...base, admittedAllowed: artifactAllowed })).toBe(false)
    expect(exact({ ...base, admittedForbidden: [...forbidden].reverse() })).toBe(false)
    expect(exact({ ...base, implementationAllowed: artifactAllowed })).toBe(false)
    expect(exact({ ...base, signedReservation: { ...context.reservation, allowed: anchorAllowed } })).toBe(false)
    expect(exact({ ...base, authorizationMetadata: { ...base.authorizationMetadata, previewDigest: "0".repeat(64) } })).toBe(false)
  })

  it("loads an exact delivery subset without conflating it with the full anchor reservation", () => {
    const exact = (globalThis as Record<string, unknown>).__williamosMergedExternalDeliveryPathsAreExact as (input: Record<string, unknown>) => boolean
    const anchorPaths = [
      "app/api/environment/space/route.ts",
      "lib/environment/space-persistence.ts",
      "tests/experience-v2-space-route.test.ts",
    ]
    const artifactPaths = [anchorPaths[0], anchorPaths[2]]
    const base = { anchorPaths, artifactPaths, reservationPaths: artifactPaths, deliveryPaths: artifactPaths }
    expect(exact(base)).toBe(true)
    expect(exact({ ...base, artifactPaths: [anchorPaths[1], ...artifactPaths] })).toBe(false)
    expect(exact({ ...base, reservationPaths: anchorPaths })).toBe(false)
    expect(exact({ ...base, deliveryPaths: anchorPaths })).toBe(false)
    expect(exact({ ...base, anchorPaths: [artifactPaths[0]] })).toBe(false)
    const directoryArtifactPaths = ["app/api/environment/space/route.ts", "tests/experience-v2-space-route.test.ts"]
    expect(exact({
      anchorPaths: ["app/**", "tests/**"], artifactPaths: directoryArtifactPaths,
      reservationPaths: directoryArtifactPaths, deliveryPaths: directoryArtifactPaths,
    })).toBe(true)
    expect(exact({
      anchorPaths: ["app/**", "tests/**"], artifactPaths: ["testosterone/escape.ts"],
      reservationPaths: ["testosterone/escape.ts"], deliveryPaths: ["testosterone/escape.ts"],
    })).toBe(false)
  })

  it("loads historical Ed25519 verification keys from the configured public-key ring", () => {
    const configuredKeys = (globalThis as Record<string, unknown>).__williamosConfiguredDeliveryVerificationKeys as () => Record<string, unknown>
    const priorRing = process.env.WILLIAMOS_DELIVERY_SEAL_PUBLIC_KEYS_JSON
    const { publicKey } = generateKeyPairSync("ed25519")
    process.env.WILLIAMOS_DELIVERY_SEAL_PUBLIC_KEYS_JSON = JSON.stringify({
      "historical-key": publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    })
    try {
      expect(Object.keys(configuredKeys())).toContain("historical-key")
    } finally {
      if (priorRing === undefined) delete process.env.WILLIAMOS_DELIVERY_SEAL_PUBLIC_KEYS_JSON
      else process.env.WILLIAMOS_DELIVERY_SEAL_PUBLIC_KEYS_JSON = priorRing
    }
  })

  const headSha = "a".repeat(40)
  const mergeSha = "b".repeat(40)
  const context = {
    worldId: "space-1",
    outcomeKey: "external:outcome",
    outcomeId: 7,
    outcomeVersion: 3,
    workOrderId: 74,
    implementationGrantId: 90,
    queueGrantId: 91,
    deliveryGrantId: 92,
    repository: "bsvalues/terragroq",
    pullRequest: 1120,
    headSha,
    paths: ["app/api/environment/space/route.ts", "tests/experience-v2-space-route.test.ts"],
    admissionDigest: "c".repeat(64),
    seal: { payload: { version: "williamos-delivery-seal.v2" }, signature: "signed" } as never,
    terminal: false,
  }

  it("accepts the issuer's default-sort canonical order for mixed-case repository paths", async () => {
    const paths = ["README.md", "app/api/environment/space/route.ts"]
    const mixedContext = { ...context, paths }
    const mixedInspection = { ...inspection, paths }
    const complete = vi.fn().mockResolvedValue({ replayed: false })
    ;(globalThis as Record<string, unknown>).__williamosMergedExternalFinalizationDependencies = dependencies({
      load: vi.fn().mockResolvedValue(mixedContext),
      inspect: vi.fn().mockResolvedValue(mixedInspection),
      complete,
    })
    const response = await PATCH(new Request("http://localhost/api/environment/space", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "FINALIZE_MERGED_EXTERNAL_DELIVERY", worldId: "space-1", projectKey: "williamos" }),
    }))
    expect(response.status).toBe(200)
    expect(complete).toHaveBeenCalledWith("owner", mixedContext, mixedInspection)
  })
  const inspection = {
    pullRequest: 1120,
    state: "MERGED",
    baseRefName: "main",
    unresolvedThreadCount: 0,
    headSha,
    mergeSha,
    paths: [...context.paths],
    protectedMainContainsMerge: true,
  }

  it("rejects an authenticated session that is not the current configured owner", async () => {
    seams.assertOwner.mockReturnValueOnce({ ok: false, failure: "NOT_OWNER", detail: "current owner required" })
    const response = await PATCH(new Request("http://localhost/api/environment/space", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "FINALIZE_MERGED_EXTERNAL_DELIVERY", worldId: "space-1", projectKey: "williamos" }),
    }))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: "NOT_OWNER", detail: "current owner required" })
  })

  it.each([null, [], "invalid"])('rejects malformed JSON value %j before enumerating request fields', async (value) => {
    const response = await PATCH(new Request("http://localhost/api/environment/space", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(value),
    }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "MERGED_EXTERNAL_DELIVERY_REQUEST_INVALID" })
  })

  function dependencies(overrides: Record<string, unknown> = {}) {
    return {
      load: vi.fn().mockResolvedValue(context),
      inspect: vi.fn().mockResolvedValue(inspection),
      complete: vi.fn().mockResolvedValue({ replayed: false }),
      ...overrides,
    }
  }

  it("terminalizes only after the exact sealed head and paths are merged into protected main", async () => {
    const deps = dependencies()
    ;(globalThis as Record<string, unknown>).__williamosMergedExternalFinalizationDependencies = deps
    const response = await PATCH(new Request("http://localhost/api/environment/space", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "FINALIZE_MERGED_EXTERNAL_DELIVERY", worldId: "space-1", projectKey: "williamos" }),
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      status: "FINALIZED", replayed: false, worldId: "space-1",
      pullRequest: 1120, headSha, mergeSha,
    })
    expect(deps.complete).toHaveBeenCalledWith("owner", context, inspection)
  })

  it.each([
    ["open PR", { state: "OPEN" }],
    ["non-main base", { baseRefName: "release" }],
    ["unresolved review thread", { unresolvedThreadCount: 1 }],
    ["changed head", { headSha: "d".repeat(40) }],
    ["changed paths", { paths: [context.paths[0]] }],
    ["reordered paths", { paths: [...context.paths].reverse() }],
    ["whitespace path drift", { paths: [` ${context.paths[0]}`, context.paths[1]] }],
    ["duplicate path drift", { paths: [context.paths[0], context.paths[0], context.paths[1]] }],
    ["separator path drift", { paths: [context.paths[0].replaceAll("/", "\\"), context.paths[1]] }],
    ["uncontained merge", { protectedMainContainsMerge: false }],
  ])("fails closed for %s", async (_name, drift) => {
    const complete = vi.fn()
    const deps = dependencies({
      inspect: vi.fn().mockResolvedValue({ ...inspection, ...drift }),
      complete,
    })
    ;(globalThis as Record<string, unknown>).__williamosMergedExternalFinalizationDependencies = deps
    const response = await PATCH(new Request("http://localhost/api/environment/space", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "FINALIZE_MERGED_EXTERNAL_DELIVERY", worldId: "space-1", projectKey: "williamos" }),
    }))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: "MERGED_EXTERNAL_DELIVERY_NOT_PROVEN" })
    expect(complete).not.toHaveBeenCalled()
  })

  it("re-proves the immutable merge before replaying the exact terminal receipt", async () => {
    const inspect = vi.fn().mockResolvedValue(inspection)
    const complete = vi.fn().mockResolvedValue({ replayed: true })
    const deps = dependencies({
      load: vi.fn().mockResolvedValue({ ...context, terminal: true }),
      inspect,
      complete,
    })
    ;(globalThis as Record<string, unknown>).__williamosMergedExternalFinalizationDependencies = deps
    const response = await PATCH(new Request("http://localhost/api/environment/space", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "FINALIZE_MERGED_EXTERNAL_DELIVERY", worldId: "space-1", projectKey: "williamos" }),
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: "FINALIZED", replayed: true })
    expect(inspect).toHaveBeenCalledWith(expect.objectContaining({ terminal: true, headSha }))
    expect(complete).toHaveBeenCalledWith("owner", expect.objectContaining({ terminal: true }), inspection)
  })
})
