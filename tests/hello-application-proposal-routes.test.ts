import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({
  applyProposal: vi.fn(),
  assertOwner: vi.fn(),
  createProposal: vi.fn(),
  getProposal: vi.fn(),
  getSession: vi.fn(),
  listProposals: vi.fn(),
  rejectProposal: vi.fn(),
  resolveBinding: vi.fn(),
  resolveOwnerUserId: vi.fn(),
}))

vi.mock("@/lib/session", () => ({ getSession: seams.getSession }))
vi.mock("@/lib/governance/owner", () => ({
  assertOwner: seams.assertOwner,
  resolveOwnerUserId: seams.resolveOwnerUserId,
}))
vi.mock("@/lib/governance/owner-lookup", () => ({ ownerLookup: vi.fn(() => ({})) }))
vi.mock("@/lib/projects/workspace-project-binding", () => ({
  resolveCanonicalWorkspaceProjectBinding: seams.resolveBinding,
}))
vi.mock("@/lib/hello-application/proposal-service.mjs", () => ({
  applyHelloApplicationProposal: seams.applyProposal,
  createHelloApplicationProposal: seams.createProposal,
  getHelloApplicationProposal: seams.getProposal,
  listHelloApplicationProposals: seams.listProposals,
  rejectHelloApplicationProposal: seams.rejectProposal,
}))

import { GET, maxDuration, POST } from "@/app/api/projects/hello-application/proposals/route"
import { POST as APPLY } from "@/app/api/projects/hello-application/proposals/[proposalId]/apply/route"
import * as PROPOSAL_DETAIL from "@/app/api/projects/hello-application/proposals/[proposalId]/route"

const proposal = {
  proposalId: "11111111-1111-4111-8111-111111111111",
  status: "READY_FOR_REVIEW",
  requestedBy: "owner",
  changedPaths: ["examples/hello-application/src/index.html", "examples/hello-application/src/styles.css"],
}

const mutation = (
  body: BodyInit | null = JSON.stringify({ requestText: "Change the footer" }),
  origin = "https://williamos.lan:3543",
) => new Request("https://williamos.lan:3543/api/projects/hello-application/proposals", {
  method: "POST",
  headers: { "content-type": "application/json", origin, host: "williamos.lan:3543" },
  body,
  ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
} as RequestInit)

async function readChunks(response: Response) {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(decoder.decode(value, { stream: true }))
  }
  const remainder = decoder.decode()
  if (remainder) chunks.push(remainder)
  return chunks
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.WILLIAMOS_HERMES_RUNTIME_ROOT = "C:/runtime/hermes-bridge"
  seams.getSession.mockResolvedValue({ user: { id: "owner" } })
  seams.resolveOwnerUserId.mockResolvedValue("owner")
  seams.assertOwner.mockReturnValue({ ok: true })
  seams.resolveBinding.mockResolvedValue({
    ok: true,
    binding: { workspaceRoot: "C:/runtime/source/examples/hello-application" },
  })
  seams.createProposal.mockResolvedValue(proposal)
  seams.applyProposal.mockResolvedValue({ ...proposal, status: "APPLIED" })
  seams.listProposals.mockReturnValue([proposal])
  seams.rejectProposal.mockReturnValue({
    ...proposal,
    status: "REJECTED",
    rejectedAt: "2026-09-20T18:00:00.000Z",
    rejectionReason: "Superseded by a clearer owner request.",
  })
})

describe("Hello Application proposal routes", () => {
  it("reserves bounded host overhead around the 90-minute resident transaction", () => {
    expect(maxDuration).toBe(7_200)
  })

  it("returns immediately and streams allowlisted observed milestones before one proposal terminal", async () => {
    let resolveProposal!: (value: typeof proposal) => void
    let onProgress!: (event: Record<string, unknown>) => void
    seams.createProposal.mockImplementation((options) => {
      onProgress = options.onProgress
      return new Promise((resolve) => { resolveProposal = resolve })
    })

    const response = await POST(mutation(JSON.stringify({ requestText: "  Change the footer  " })))

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8")
    expect(response.headers.get("cache-control")).toBe("no-store, no-transform")
    expect(response.headers.get("x-accel-buffering")).toBe("no")
    await vi.waitFor(() => expect(seams.createProposal).toHaveBeenCalledOnce())
    const forwarded = seams.createProposal.mock.calls[0][0]
    expect(Object.keys(forwarded).sort()).toEqual([
      "onProgress",
      "repositoryRoot",
      "requestText",
      "requestedBy",
      "runtimeRoot",
    ])
    expect(forwarded).toEqual({
      repositoryRoot: expect.stringContaining("source"),
      runtimeRoot: expect.stringContaining("hermes-bridge"),
      requestedBy: "owner",
      requestText: "Change the footer",
      onProgress: expect.any(Function),
    })

    onProgress({ stage: "accepted", detail: "Request accepted", at: "2026-09-19T20:00:00.000Z" })
    onProgress({ stage: "not_a_real_stage", detail: "must not cross the route", at: "2026-09-19T20:00:00.500Z" })
    onProgress({ stage: "resident_started", detail: "HERMES is editing the isolated workspace", at: "2026-09-19T20:00:01.000Z", stderr: "secret" })
    resolveProposal(proposal)

    const chunks = await readChunks(response)
    expect(chunks).toEqual([
      `${JSON.stringify({ type: "progress", stage: "accepted", detail: "Request accepted", at: "2026-09-19T20:00:00.000Z" })}\n`,
      `${JSON.stringify({ type: "progress", stage: "resident_started", detail: "HERMES is editing the isolated workspace", at: "2026-09-19T20:00:01.000Z" })}\n`,
      `${JSON.stringify({ type: "proposal", proposal })}\n`,
    ])
    expect(() => onProgress({ stage: "ready_for_review", detail: "late", at: "2026-09-19T20:00:02.000Z" })).not.toThrow()
  })

  it("parses a valid request split across incoming body chunks", async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"request'))
        controller.enqueue(encoder.encode('Text":"Change the footer"}'))
        controller.close()
      },
    })

    const response = await POST(mutation(body))

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe(`${JSON.stringify({ type: "proposal", proposal })}\n`)
    expect(seams.createProposal.mock.calls[0][0].requestText).toBe("Change the footer")
  })

  it.each([
    ["malformed JSON", "{"],
    ["null", "null"],
    ["an array", "[]"],
    ["a missing key", "{}"],
    ["an unknown key", '{"unknown":"value"}'],
    ["an extra key", '{"requestText":"Change it","extra":true}'],
    ["a non-string request", '{"requestText":42}'],
    ["an empty request", '{"requestText":"   "}'],
    ["a NUL request", JSON.stringify({ requestText: "bad\0request" })],
    ["an over-character request", JSON.stringify({ requestText: "x".repeat(2_001) })],
  ])("rejects %s as JSON 400 before starting the service", async (_label, body) => {
    const response = await POST(mutation(body))

    expect(response.status).toBe(400)
    expect(response.headers.get("content-type")).toContain("application/json")
    await expect(response.json()).resolves.toEqual({ error: "HELLO_PROPOSAL_REQUEST_INVALID" })
    expect(seams.createProposal).not.toHaveBeenCalled()
  })

  it("stops reading an over-byte body and returns JSON 400 before starting the service", async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(40_000))
      },
      cancel,
    })

    const response = await POST(mutation(body))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "HELLO_PROPOSAL_REQUEST_INVALID" })
    expect(cancel).toHaveBeenCalledOnce()
    expect(seams.createProposal).not.toHaveBeenCalled()
  })

  it("sanitizes a post-start service failure into exactly one terminal error", async () => {
    seams.createProposal.mockRejectedValue(new Error("sensitive stderr and stack detail"))

    const response = await POST(mutation())

    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toBe(`${JSON.stringify({ type: "error", error: "HELLO_PROPOSAL_FAILED" })}\n`)
    expect(body).not.toContain("sensitive")
  })

  it.each([
    ["HELLO_PROPOSAL_ARTIFACT_CLEANUP_FAILED", "HELLO_PROPOSAL_ARTIFACT_CLEANUP_FAILED"],
    ["HELLO_PROPOSAL_VALIDATION_FAILED", "HELLO_PROPOSAL_VALIDATION_FAILED"],
    ["HELLO_PROPOSAL_SOURCE_SIZE_REFUSED", "HELLO_PROPOSAL_SOURCE_SIZE_REFUSED"],
    ["HELLO_PROPOSAL_PATCH_SIZE_REFUSED", "HELLO_PROPOSAL_PATCH_SIZE_REFUSED"],
    ["HELLO_PROPOSAL_RESIDENT_TIMEOUT:kernel detail must not cross", "HELLO_PROPOSAL_RESIDENT_TIMEOUT"],
    ["HELLO_PROPOSAL_VALIDATION_FAILED:container stderr must not cross", "HELLO_PROPOSAL_VALIDATION_FAILED"],
    ["HELLO_PROPOSAL_UNKNOWN_INTERNAL:secret detail", "HELLO_PROPOSAL_FAILED"],
  ])("emits only an allowlisted stable terminal code for %s", async (message, expected) => {
    seams.createProposal.mockRejectedValue(new Error(message))

    const response = await POST(mutation())

    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toBe(`${JSON.stringify({ type: "error", error: expected })}\n`)
    expect(body).not.toContain("stderr must not cross")
    expect(body).not.toContain("secret detail")
  })

  it("absorbs cancellation, late progress, and late failure without a duplicate terminal or unhandled rejection", async () => {
    let rejectProposal!: (reason: Error) => void
    let onProgress!: (event: Record<string, unknown>) => void
    seams.createProposal.mockImplementation((options) => {
      onProgress = options.onProgress
      return new Promise((_resolve, reject) => { rejectProposal = reject })
    })
    const unhandled = vi.fn()
    process.on("unhandledRejection", unhandled)
    try {
      const response = await POST(mutation())
      await vi.waitFor(() => expect(seams.createProposal).toHaveBeenCalledOnce())
      await response.body!.getReader().cancel("reader left")
      expect(() => onProgress({ stage: "accepted", detail: "late", at: "2026-09-19T20:00:00.000Z" })).not.toThrow()
      rejectProposal(new Error("late sensitive failure"))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off("unhandledRejection", unhandled)
    }
  })

  it("lists persisted receipts as JSON and applies only through a second explicit JSON request", async () => {
    const listed = await GET()
    expect(listed.headers.get("content-type")).toContain("application/json")
    await expect(listed.json()).resolves.toEqual({ proposals: [proposal] })
    expect(seams.applyProposal).not.toHaveBeenCalled()

    const applied = await APPLY(mutation(), {
      params: Promise.resolve({ proposalId: proposal.proposalId }),
    })
    expect(applied.status).toBe(200)
    expect(applied.headers.get("content-type")).toContain("application/json")
    expect(seams.applyProposal).toHaveBeenCalledWith({
      repositoryRoot: expect.stringContaining("source"),
      runtimeRoot: expect.stringContaining("hermes-bridge"),
      requestedBy: "owner",
      proposalId: proposal.proposalId,
    })
  })

  it("rejects a proposal only through an explicit owner DELETE with one bounded audit reason", async () => {
    const request = new Request(`https://williamos.lan:3543/api/projects/hello-application/proposals/${proposal.proposalId}`, {
      method: "DELETE",
      headers: { "content-type": "application/json", origin: "https://williamos.lan:3543", host: "williamos.lan:3543" },
      body: JSON.stringify({ reason: "Superseded by a clearer owner request." }),
    })
    const reject = (PROPOSAL_DETAIL as typeof PROPOSAL_DETAIL & {
      DELETE: (request: Request, context: { params: Promise<{ proposalId: string }> }) => Promise<Response>
    }).DELETE

    const response = await reject(request, { params: Promise.resolve({ proposalId: proposal.proposalId }) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      proposal: {
        status: "REJECTED",
        rejectionReason: "Superseded by a clearer owner request.",
      },
    })
    expect(seams.rejectProposal).toHaveBeenCalledWith({
      repositoryRoot: expect.stringContaining("source"),
      runtimeRoot: expect.stringContaining("hermes-bridge"),
      requestedBy: "owner",
      proposalId: proposal.proposalId,
      reason: "Superseded by a clearer owner request.",
    })
  })

  it.each([
    ["malformed JSON", "{"],
    ["a missing reason", "{}"],
    ["an extra field", JSON.stringify({ reason: "No longer wanted.", extra: true })],
    ["an empty reason", JSON.stringify({ reason: "   " })],
    ["a multiline reason", JSON.stringify({ reason: "first\nsecond" })],
    ["a Unicode line-separator reason", JSON.stringify({ reason: "first\u2028second" })],
    ["a Unicode paragraph-separator reason", JSON.stringify({ reason: "first\u2029second" })],
    ["a leading Unicode line-separator reason", JSON.stringify({ reason: "\u2028first" })],
    ["a trailing Unicode paragraph-separator reason", JSON.stringify({ reason: "last\u2029" })],
    ["an over-limit reason", JSON.stringify({ reason: "x".repeat(501) })],
  ])("rejects %s before calling the rejection service", async (_label, body) => {
    const request = new Request(`https://williamos.lan:3543/api/projects/hello-application/proposals/${proposal.proposalId}`, {
      method: "DELETE",
      headers: { "content-type": "application/json", origin: "https://williamos.lan:3543", host: "williamos.lan:3543" },
      body,
    })
    const reject = (PROPOSAL_DETAIL as typeof PROPOSAL_DETAIL & {
      DELETE: (request: Request, context: { params: Promise<{ proposalId: string }> }) => Promise<Response>
    }).DELETE

    const response = await reject(request, { params: Promise.resolve({ proposalId: proposal.proposalId }) })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "HELLO_PROPOSAL_REJECTION_INVALID" })
    expect(seams.rejectProposal).not.toHaveBeenCalled()
  })

  it("maps repeated rejection to a stable conflict without leaking service detail", async () => {
    seams.rejectProposal.mockImplementation(() => { throw new Error("HELLO_PROPOSAL_NOT_APPLICABLE:receipt path") })
    const request = new Request(`https://williamos.lan:3543/api/projects/hello-application/proposals/${proposal.proposalId}`, {
      method: "DELETE",
      headers: { "content-type": "application/json", origin: "https://williamos.lan:3543", host: "williamos.lan:3543" },
      body: JSON.stringify({ reason: "Repeated rejection." }),
    })
    const reject = (PROPOSAL_DETAIL as typeof PROPOSAL_DETAIL & {
      DELETE: (request: Request, context: { params: Promise<{ proposalId: string }> }) => Promise<Response>
    }).DELETE

    const response = await reject(request, { params: Promise.resolve({ proposalId: proposal.proposalId }) })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: "HELLO_PROPOSAL_NOT_APPLICABLE" })
  })

  it("rejects cross-origin proposal and apply mutations before invoking the resident lane", async () => {
    const createRequest = mutation(null, "https://evil.example")
    const applyRequest = mutation(null, "https://evil.example")
    expect((await POST(createRequest)).status).toBe(403)
    expect((await APPLY(applyRequest, { params: Promise.resolve({ proposalId: proposal.proposalId }) })).status).toBe(403)
    expect(seams.createProposal).not.toHaveBeenCalled()
    expect(seams.applyProposal).not.toHaveBeenCalled()
  })

  it("does not expose or execute the lane for a non-owner", async () => {
    seams.assertOwner.mockReturnValue({ ok: false, failure: "NOT_OWNER", detail: "owner mismatch" })
    const response = await POST(mutation())
    expect(response.status).toBe(403)
    expect(seams.createProposal).not.toHaveBeenCalled()
  })
})
