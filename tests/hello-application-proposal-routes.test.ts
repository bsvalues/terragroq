import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({
  applyProposal: vi.fn(),
  assertOwner: vi.fn(),
  createProposal: vi.fn(),
  getProposal: vi.fn(),
  getSession: vi.fn(),
  listProposals: vi.fn(),
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
}))

import { GET, POST } from "@/app/api/projects/hello-application/proposals/route"
import { POST as APPLY } from "@/app/api/projects/hello-application/proposals/[proposalId]/apply/route"

const proposal = {
  proposalId: "11111111-1111-4111-8111-111111111111",
  status: "READY_FOR_REVIEW",
  requestedBy: "owner",
  changedPaths: ["examples/hello-application/src/index.html", "examples/hello-application/src/styles.css"],
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
})

describe("Hello Application proposal routes", () => {
  const mutation = () => new Request("https://williamos.lan:3543/api/projects/hello-application/proposals", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://williamos.lan:3543", host: "williamos.lan:3543" },
  })

  it("starts the fixed resident-agent proposal from server-owned roots", async () => {
    const response = await POST(mutation())

    expect(response.status).toBe(201)
    expect(seams.createProposal).toHaveBeenCalledWith({
      repositoryRoot: expect.stringContaining("source"),
      runtimeRoot: expect.stringContaining("hermes-bridge"),
      requestedBy: "owner",
    })
    await expect(response.json()).resolves.toEqual({ proposal })
  })

  it("lists persisted receipts and applies only through a second explicit request", async () => {
    const listed = await GET()
    await expect(listed.json()).resolves.toEqual({ proposals: [proposal] })
    expect(seams.applyProposal).not.toHaveBeenCalled()

    const applied = await APPLY(new Request(`https://williamos.lan:3543/api/projects/hello-application/proposals/${proposal.proposalId}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://williamos.lan:3543", host: "williamos.lan:3543" },
    }), {
      params: Promise.resolve({ proposalId: proposal.proposalId }),
    })
    expect(applied.status).toBe(200)
    expect(seams.applyProposal).toHaveBeenCalledWith({
      repositoryRoot: expect.stringContaining("source"),
      runtimeRoot: expect.stringContaining("hermes-bridge"),
      requestedBy: "owner",
      proposalId: proposal.proposalId,
    })
  })

  it("rejects cross-origin proposal and apply mutations before invoking the resident lane", async () => {
    const request = new Request("https://williamos.lan:3543/api/projects/hello-application/proposals", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example", host: "williamos.lan:3543" },
    })
    expect((await POST(request)).status).toBe(403)
    expect((await APPLY(request, { params: Promise.resolve({ proposalId: proposal.proposalId }) })).status).toBe(403)
    expect(seams.createProposal).not.toHaveBeenCalled()
    expect(seams.applyProposal).not.toHaveBeenCalled()
  })

  it("does not expose or execute the lane for a non-owner", async () => {
    seams.assertOwner.mockReturnValue({ ok: false, failure: "NOT_OWNER", detail: "owner mismatch" })
    const response = await POST(mutation())
    expect(response.status).toBe(403)
    expect(seams.createProposal).not.toHaveBeenCalled()
  })

  it("keeps invalid owner request errors mapped to HTTP 400", async () => {
    seams.createProposal.mockRejectedValue(new Error("HELLO_PROPOSAL_REQUEST_INVALID"))
    const response = await POST(mutation())
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "HELLO_PROPOSAL_REQUEST_INVALID" })
  })
})
