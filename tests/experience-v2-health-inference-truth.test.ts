import { beforeEach, describe, expect, it, vi } from "vitest"

const harness = vi.hoisted(() => ({
  getAuthReadiness: vi.fn(),
}))

vi.mock("@/lib/auth-readiness", () => ({ getAuthReadiness: harness.getAuthReadiness }))
vi.mock("@/lib/build-provenance", () => ({ getBuildProvenance: () => ({ commit: "test" }) }))
vi.mock("@/lib/ai/config", () => ({
  CHAT_MODEL: "missing-default",
  EMBEDDING_DIMENSIONS: 1024,
  INFERENCE_BASE_URL: "http://127.0.0.1:11434/v1",
  RUNTIME: {
    chatModel: "missing-default",
    embeddingModel: "nomic-embed-text:latest",
    inferenceBaseUrl: "http://127.0.0.1:11434/v1",
    gateway: "williamos-openai-compatible",
  },
}))

import { GET } from "@/app/api/health/route"

beforeEach(() => {
  harness.getAuthReadiness.mockReset().mockResolvedValue({
    ready: true,
    databaseReady: true,
    authReady: true,
    checks: { databaseConnectivity: { ok: true } },
    issues: [],
  })
  vi.unstubAllGlobals()
})

describe("GET /api/health inference truth", () => {
  it("reports the installed executable chat model rather than an absent configured default", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ models: [
      { name: "nomic-embed-text:latest", size: 274_302_450 },
      { name: "qwen2.5:7b-instruct", size: 4_683_087_332 },
    ] })))

    const response = await GET()
    const body = await response.json()

    expect(body.checks.runtime).toMatchObject({ ok: true, chatModel: "qwen2.5:7b-instruct" })
  })

  it("marks runtime unavailable instead of advertising the configured model as executable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")))

    const response = await GET()
    const body = await response.json()

    expect(body.checks.runtime).toMatchObject({ ok: false, chatModel: null, detail: "LOCAL_INFERENCE_UNAVAILABLE" })
  })
})
