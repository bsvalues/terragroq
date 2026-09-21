import fs from "node:fs/promises"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({
  user: "owner" as string | null,
  create: vi.fn(),
  list: vi.fn(),
  page: vi.fn(),
  get: vi.fn(),
  reject: vi.fn(),
  apply: vi.fn(),
  bridgeReady: vi.fn(),
  reconcile: vi.fn(),
}))
vi.mock("@/lib/session", () => ({ getSession: async () => seams.user ? { user: { id: seams.user } } : null }))
vi.mock("@/lib/governance/owner-lookup", () => ({ ownerLookup: () => ({}) }))
vi.mock("@/lib/governance/owner", () => ({ resolveOwnerUserId: async () => "owner", assertOwner: (user: string) => user === "owner" ? { ok: true } : { ok: false, failure: "NOT_OWNER" } }))
vi.mock("@/lib/applications/application-proposal-service.mjs", () => ({
  applyApplicationProposal: seams.apply,
  createApplicationProposal: seams.create,
  getApplicationProposal: seams.get,
  listApplicationProposals: seams.list,
  listApplicationProposalPage: seams.page,
  rejectApplicationProposal: seams.reject,
  reconcileApplicationProposalCreateIntents: seams.reconcile,
}))
vi.mock("@/lib/applications/cerebras-turn.mjs", async (importOriginal) => ({
  ...await importOriginal() as object,
  cerebrasCredentialBridgeReady: seams.bridgeReady,
}))

import { GET as GET_ROUTES } from "@/app/api/projects/[projectKey]/application-execution-routes/route"
import { GET, POST } from "@/app/api/projects/[projectKey]/application-proposals/route"
import { GET as GET_DETAIL, PATCH } from "@/app/api/projects/[projectKey]/application-proposals/[proposalId]/route"
import { POST as APPLY } from "@/app/api/projects/[projectKey]/application-proposals/[proposalId]/apply/route"
import { fixture } from "./application-runtime-fixture"

let f: Awaited<ReturnType<typeof fixture>>
let application: Awaited<ReturnType<typeof f.app>>
const origin = "https://williamos.test"
const context = (projectKey = "first-board") => ({ params: Promise.resolve({ projectKey }) })
const detailContext = (projectKey = "first-board", proposalId = "11111111-1111-4111-8111-111111111111") => ({ params: Promise.resolve({ projectKey, proposalId }) })
const request = (url: string, method = "GET", body?: object, requestOrigin = origin) => new Request(`${origin}${url}`, {
  method,
  headers: { origin: requestOrigin, "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

beforeEach(async () => {
  f = await fixture()
  application = await f.app()
  vi.stubEnv("WILLIAMOS_APPLICATIONS_ROOT", f.apps)
  vi.stubEnv("WILLIAMOS_APPLICATION_RUNTIME_ROOT", path.join(f.root, "proposal-runtime"))
  vi.stubEnv("WILLIAMOS_APPLICATION_CEREBRAS_ROUTING_ENABLED", "true")
  seams.user = "owner"
  vi.clearAllMocks()
  seams.list.mockReturnValue([{ proposalId: "existing" }])
  seams.page.mockReturnValue({ proposals: [{ proposalId: "existing" }], truncated: false })
  seams.get.mockReturnValue({ proposalId: "detail" })
  seams.reject.mockResolvedValue({ proposalId: "detail", status: "REJECTED" })
  seams.apply.mockResolvedValue({ proposalId: "detail", status: "APPLIED" })
  seams.bridgeReady.mockResolvedValue(true)
  seams.reconcile.mockResolvedValue(undefined)
  seams.create.mockImplementation(async ({ onProgress }: any) => {
    onProgress({ stage: "accepted", detail: "Request accepted", at: "2026-09-20T00:00:00.000Z" })
    return { proposalId: "created", status: "READY_FOR_REVIEW" }
  })
})
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(f.root, { recursive: true, force: true }) })

describe("generic application proposal routes", () => {
  it("lists literal execution routes and creates an immediate one-terminal-record NDJSON stream", async () => {
    const routes = await GET_ROUTES(request("/api/projects/first-board/application-execution-routes"), context())
    expect(await routes.json()).toEqual(expect.objectContaining({
      schemaVersion: 1,
      defaultRoute: "hermes-local",
      routes: expect.arrayContaining([expect.objectContaining({ id: "cerebras-qwen-3-8-27b", model: "qwen-3.8-27b", available: true })]),
    }))
    const response = await POST(request("/api/projects/first-board/application-proposals", "POST", {
      requestText: "Add reset behavior",
      executionRoute: "cerebras-qwen-3-8-27b",
      externalEgressApproved: true,
    }), context())
    expect(response.headers.get("content-type")).toContain("application/x-ndjson")
    const records = (await response.text()).trim().split("\n").map((line) => JSON.parse(line))
    expect(records).toEqual([
      { type: "progress", stage: "accepted", detail: "Request accepted", at: "2026-09-20T00:00:00.000Z" },
      { type: "proposal", proposal: { proposalId: "created", status: "READY_FOR_REVIEW" } },
    ])
    expect(seams.create).toHaveBeenCalledWith(expect.objectContaining({
      application: expect.objectContaining({ repositoryRoot: application.repositoryRoot, manifestDigest: application.manifestDigest }),
      runtimeRoot: path.join(f.root, "proposal-runtime"),
      requestedBy: "owner",
      requestText: "Add reset behavior",
      executionRoute: "cerebras-qwen-3-8-27b",
      externalEgressApproved: true,
    }))
  })

  it("gets, rejects with PATCH, and applies only from catalog-bound context", async () => {
    expect(await (await GET(request("/api/projects/first-board/application-proposals"), context())).json()).toEqual({ proposals: [{ proposalId: "existing" }] })
    expect(await (await GET_DETAIL(request("/api/projects/first-board/application-proposals/id"), detailContext())).json()).toEqual({ proposal: { proposalId: "detail" } })
    const rejected = await PATCH(request("/api/projects/first-board/application-proposals/id", "PATCH", { reason: "Discard this draft" }), detailContext())
    const applied = await APPLY(request("/api/projects/first-board/application-proposals/id/apply", "POST"), detailContext())
    expect(await rejected.json()).toEqual({ proposal: { proposalId: "detail", status: "REJECTED" } })
    expect(await applied.json()).toEqual({ proposal: { proposalId: "detail", status: "APPLIED" } })
    expect(seams.reject).toHaveBeenCalledWith(expect.objectContaining({ application: expect.objectContaining({ manifest: expect.objectContaining({ id: "first-board" }) }), reason: "Discard this draft" }))
    expect(seams.apply).toHaveBeenCalledWith(expect.objectContaining({ application: expect.objectContaining({ manifest: expect.objectContaining({ id: "first-board" }) }) }))
  })

  it("lets terminal rejection replay reconcile cleanup when the retry reason is invalid or omitted", async () => {
    seams.reject.mockResolvedValue({
      proposalId: "detail",
      status: "REJECTED",
      rejectionReason: "Original durable reason",
    })

    const invalid = await PATCH(request(
      "/api/projects/first-board/application-proposals/id",
      "PATCH",
      { reason: "\u0000Different invalid retry reason" },
    ), detailContext())
    const omitted = await PATCH(request(
      "/api/projects/first-board/application-proposals/id",
      "PATCH",
    ), detailContext())

    for (const response of [invalid, omitted]) {
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        proposal: {
          proposalId: "detail",
          status: "REJECTED",
          rejectionReason: "Original durable reason",
        },
      })
    }
    expect(seams.reject).toHaveBeenCalledTimes(2)
    expect(seams.reject).toHaveBeenNthCalledWith(1, expect.objectContaining({ reason: undefined }))
    expect(seams.reject).toHaveBeenNthCalledWith(2, expect.objectContaining({ reason: undefined }))

    seams.reject.mockRejectedValueOnce(new Error("APPLICATION_PROPOSAL_REJECTION_INVALID"))
    const nonterminal = await PATCH(request(
      "/api/projects/first-board/application-proposals/id",
      "PATCH",
    ), detailContext())
    expect(nonterminal.status).toBe(400)
    expect(await nonterminal.json()).toEqual({ error: "APPLICATION_PROPOSAL_REJECTION_INVALID" })
  })

  it("preserves the stable CREATE recovery quarantine code on proposal listing", async () => {
    seams.reconcile.mockRejectedValueOnce(new Error("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN"))
    const response = await GET(request("/api/projects/first-board/application-proposals"), context())
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN" })
    expect(seams.list).not.toHaveBeenCalled()
  })

  it("surfaces bounded-list truncation and sanitizes listing uncertainty", async () => {
    seams.page.mockReturnValueOnce({ proposals: [{ proposalId: "newest" }], truncated: true })
    const truncated = await GET(request("/api/projects/first-board/application-proposals"), context())
    expect(await truncated.json()).toEqual({ proposals: [{ proposalId: "newest" }], truncated: true })

    seams.reconcile.mockRejectedValueOnce(new Error("APPLICATION_PROPOSAL_LISTING_UNCERTAIN"))
    const uncertain = await GET(request("/api/projects/first-board/application-proposals"), context())
    expect(uncertain.status).toBe(503)
    expect(await uncertain.json()).toEqual({ error: "APPLICATION_PROPOSAL_LISTING_UNCERTAIN" })
    expect(seams.page).toHaveBeenCalledTimes(1)
  })

  it("accepts an explicit local route without external approval and preserves route-unavailable truth", async () => {
    const local = await POST(request("/api/projects/first-board/application-proposals", "POST", {
      requestText: "Keep this local",
      executionRoute: "hermes-local",
    }), context())
    expect(local.status).toBe(200)
    await local.text()
    expect(seams.create).toHaveBeenCalledWith(expect.objectContaining({
      requestText: "Keep this local",
      executionRoute: "hermes-local",
    }))
    expect(seams.create.mock.calls[0][0]).not.toHaveProperty("externalEgressApproved")

    vi.stubEnv("WILLIAMOS_APPLICATION_CEREBRAS_ROUTING_ENABLED", "false")
    const unavailable = await POST(request("/api/projects/first-board/application-proposals", "POST", {
      requestText: "Use external inference",
      executionRoute: "cerebras-qwen-3-8-27b",
      externalEgressApproved: true,
    }), context())
    expect(unavailable.status).toBe(503)
    expect(await unavailable.json()).toEqual({ error: "APPLICATION_EXECUTION_ROUTE_UNAVAILABLE" })
  })

  it("does not advertise Cerebras for a valid app whose source exceeds the provider envelope", async () => {
    await fs.writeFile(path.join(application.repositoryRoot, ...application.manifest.source.script.split("/")), "x".repeat(64_001))
    const response = await GET_ROUTES(request("/api/projects/first-board/application-execution-routes"), context())
    const payload = await response.json()
    expect(payload.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "hermes-local", available: true }),
      expect.objectContaining({ id: "cerebras-qwen-3-8-27b", available: false }),
    ]))
  })

  it("does not advertise or dispatch Cerebras when the fixed credential bridge is not ready", async () => {
    seams.bridgeReady.mockResolvedValue(false)
    const routes = await GET_ROUTES(request("/api/projects/first-board/application-execution-routes"), context())
    expect((await routes.json()).routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "cerebras-qwen-3-8-27b", available: false }),
    ]))
    const response = await POST(request("/api/projects/first-board/application-proposals", "POST", {
      requestText: "Use external inference",
      executionRoute: "cerebras-qwen-3-8-27b",
      externalEgressApproved: true,
    }), context())
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "APPLICATION_EXECUTION_ROUTE_UNAVAILABLE" })
    expect(seams.create).not.toHaveBeenCalled()
  })

  it("rejects caller roots/models/commands, cross-origin mutation, unknown apps, and unsanitized errors", async () => {
    const invalid = await POST(request("/api/projects/first-board/application-proposals", "POST", {
      requestText: "Change it", model: "caller-model", root: "C:/escape", command: "evil",
    }), context())
    expect(invalid.status).toBe(400)
    expect((await POST(request("/api/projects/first-board/application-proposals", "POST", { requestText: "Change it" }, "https://evil.test"), context())).status).toBe(403)
    expect((await GET(request("/api/projects/missing/application-proposals"), context("missing"))).status).toBe(404)
    seams.get.mockImplementationOnce(() => { throw new Error("host root C:\\secret\\repo and key WILLIAMOS_SECRET_SENTINEL") })
    const failed = await GET_DETAIL(request("/api/projects/first-board/application-proposals/id"), detailContext())
    expect(failed.status).toBe(503)
    expect(await failed.json()).toEqual({ error: "APPLICATION_PROPOSAL_UNAVAILABLE" })
    expect(seams.create).not.toHaveBeenCalled()
  })

  it("refuses a proposal runtime nested inside the applications catalog root", async () => {
    vi.stubEnv("WILLIAMOS_APPLICATION_RUNTIME_ROOT", path.join(f.apps, "proposal-runtime"))
    const response = await GET(request("/api/projects/first-board/application-proposals"), context())
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "APPLICATION_RUNTIME_ROOT_INVALID" })
    expect(seams.list).not.toHaveBeenCalled()
  })

  it("continues proposal creation when the browser cancels the response stream", async () => {
    let finish!: (value: unknown) => void
    seams.create.mockImplementationOnce(({ onProgress }: any) => new Promise((resolve) => {
      onProgress({ stage: "accepted", detail: "Request accepted", at: "2026-09-20T00:00:00.000Z" })
      finish = resolve
    }))
    const response = await POST(request("/api/projects/first-board/application-proposals", "POST", { requestText: "Keep working" }), context())
    const reader = response.body!.getReader()
    await reader.read()
    await reader.cancel()
    finish({ proposalId: "after-cancel", status: "READY_FOR_REVIEW" })
    await vi.waitFor(() => expect(seams.create).toHaveBeenCalledTimes(1))
  })
})
