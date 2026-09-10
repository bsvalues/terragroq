import { beforeEach, describe, expect, it, vi } from "vitest"

const harness = vi.hoisted(() => ({ getSession: vi.fn() }))

vi.mock("@/lib/session", () => ({ getSession: harness.getSession }))

import { GET } from "@/app/api/loom/models/route"

beforeEach(() => {
  harness.getSession.mockReset().mockResolvedValue({ user: { id: "owner-1" } })
  vi.unstubAllGlobals()
})

describe("GET /api/loom/models", () => {
  it("names an installed chat model as the default when the compiled preference is absent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ models: [
      { name: "nomic-embed-text:latest", size: 274_302_450 },
      { name: "qwen2.5:14b-instruct-q4_K_M", size: 8_988_124_069 },
      { name: "qwen2.5:7b-instruct", size: 4_683_087_332 },
    ] })))

    const response = await GET()
    const payload = await response.json()

    expect(payload.default).toBe("qwen2.5:7b-instruct")
    expect(payload.models.map((model: { name: string }) => model.name)).toEqual([
      "qwen2.5:14b-instruct-q4_K_M",
      "qwen2.5:7b-instruct",
    ])
  })
})
