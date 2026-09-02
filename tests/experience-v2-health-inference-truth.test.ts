import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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

const deploymentEnvKeys = [
  "WILLIAMOS_DEPLOYMENT_PROFILE",
  "WILLIAMOS_DEPLOYMENT_ID",
  "WILLIAMOS_OWNER_EMAIL",
  "BETTER_AUTH_URL",
  "DATABASE_URL",
  "WILLIAMOS_AI_BASE_URL",
  "WILLIAMOS_AI_MODEL",
  "WILLIAMOS_EMBEDDING_MODEL",
  "WILLIAMOS_WORKSPACE_APP_URL",
  "ANTHROPIC_API_KEY",
  "GROQ_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "AI_GATEWAY_API_KEY",
  "VERCEL_AI_GATEWAY_API_KEY",
] as const
const originalDeploymentEnv = new Map(
  deploymentEnvKeys.map((key) => [key, process.env[key]] as const),
)

function restoreDeploymentEnv() {
  for (const key of deploymentEnvKeys) {
    const original = originalDeploymentEnv.get(key)
    if (original === undefined) delete process.env[key]
    else process.env[key] = original
  }
}

beforeEach(() => {
  restoreDeploymentEnv()
  harness.getAuthReadiness.mockReset().mockResolvedValue({
    ready: true,
    databaseReady: true,
    authReady: true,
    checks: { databaseConnectivity: { ok: true } },
    issues: [],
  })
  vi.unstubAllGlobals()
})

afterEach(() => {
  restoreDeploymentEnv()
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

  it("degrades County Development when Ollama falls back to a different installed model", async () => {
    Object.assign(process.env, {
      WILLIAMOS_DEPLOYMENT_PROFILE: "county-development",
      WILLIAMOS_DEPLOYMENT_ID: "benton-county-development-test",
      WILLIAMOS_OWNER_EMAIL: "owner@example.gov",
      BETTER_AUTH_URL: "http://127.0.0.1:3200",
      DATABASE_URL: "postgresql://user:secret@127.0.0.1:15434/williamos?sslmode=disable",
      WILLIAMOS_AI_BASE_URL: "http://127.0.0.1:11434/v1",
      WILLIAMOS_AI_MODEL: "missing-default",
      WILLIAMOS_EMBEDDING_MODEL: "nomic-embed-text:latest",
    })
    for (const key of deploymentEnvKeys.filter((key) => key.endsWith("API_KEY"))) {
      delete process.env[key]
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ models: [
      { name: "nomic-embed-text:latest", size: 274_302_450 },
      { name: "qwen2.5:7b-instruct", size: 4_683_087_332 },
    ] })))

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.deployment).toMatchObject({ profile: "county-development", valid: true })
    expect(body.checks.runtime).toMatchObject({
      ok: false,
      chatModel: "qwen2.5:7b-instruct",
      detail: "Configured County model missing-default is not installed.",
    })
  })
})
