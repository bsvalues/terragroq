import { beforeEach, describe, expect, it, vi } from "vitest"

const harness = vi.hoisted(() => ({
  load: vi.fn(),
  request: vi.fn(),
  save: vi.fn(),
}))

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "owner-a" } })),
}))
vi.mock("@/lib/environment/space-persistence", () => ({
  loadOwnedWorkingWorld: harness.load,
  saveOwnedJudgment: harness.save,
}))
vi.mock("@/lib/environment/william-judgment", () => ({
  williamJudgmentBasisFingerprint: () => "a".repeat(64),
  deriveWilliamSafetyFacts: () => [
    { key: "active-file", label: "Active file", value: "src/search.ts", source: "deterministic" },
  ],
  requestWilliamJudgment: harness.request,
}))

import { POST } from "@/app/api/environment/judgment/route"

const judgment = {
  recommendation: "Do not merge this yet.",
  rationale: "The selected file has a red validation.",
  basis: [{ key: "active-file", label: "Active file", value: "src/search.ts" }],
  confidence: 0.9,
  generatedAt: "2026-08-27T18:00:00.000Z",
  basisFingerprint: "a".repeat(64),
  provenance: { provider: "williamos-inference", model: "local-model" },
}

function request() {
  return new Request("https://williamos.test/api/environment/judgment", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://williamos.test" },
    body: JSON.stringify({ worldId: "world-a" }),
  })
}

describe("William judgment route", () => {
  beforeEach(() => vi.clearAllMocks())

  it("generates, persists, and returns judgment beside deterministic safety facts", async () => {
    const world = { intent: "TerraFusion" }
    harness.load.mockResolvedValue(world)
    harness.request.mockResolvedValue(judgment)

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ judgment, safetyFacts: [
      { key: "active-file", label: "Active file", value: "src/search.ts", source: "deterministic" },
    ] })
    expect(harness.save).toHaveBeenCalledWith({
      userId: "owner-a",
      worldId: "world-a",
      judgment,
      expectedBasisFingerprint: "a".repeat(64),
    })
  })

  it("reports unavailable inference truthfully and never persists a fake fallback", async () => {
    harness.load.mockResolvedValue({ intent: "TerraFusion" })
    harness.request.mockRejectedValue(new Error("JUDGMENT_INFERENCE_UNAVAILABLE"))

    const response = await POST(request())

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "JUDGMENT_INFERENCE_UNAVAILABLE" })
    expect(harness.save).not.toHaveBeenCalled()
  })
})
