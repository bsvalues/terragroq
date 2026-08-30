import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({ getSession: vi.fn() }))

vi.mock("@/lib/session", () => ({ getSession: seams.getSession }))

function htmlResponse() {
  const response = new Response("<title>TerraFusion</title>", {
    status: 200,
    headers: { "content-type": "text/html" },
  })
  Object.defineProperty(response, "url", { value: "http://tf.test:5000/app" })
  return response
}

beforeEach(() => {
  vi.resetModules()
  seams.getSession.mockReset().mockResolvedValue({ user: { id: "owner-a" } })
  process.env.WILLIAMOS_WORKSPACE_APP_URL = "http://tf.test:5000/app"
  process.env.BETTER_AUTH_URL = "https://williamos.test"
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete process.env.WILLIAMOS_WORKSPACE_APP_URL
  delete process.env.BETTER_AUTH_URL
})

describe("Experience V2 Preview evidence route", () => {
  it("returns only exact server-configured Preview evidence and ignores client URL or status claims", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse()))
    const { GET } = await import("@/app/api/environment/preview/route")

    const response = await GET(new Request(
      "https://williamos.test/api/environment/preview?url=https%3A%2F%2Fattacker.test&status=attached",
    ))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(payload).toMatchObject({ evidence: {
      status: "attached",
      reason: null,
      configuredUrl: "http://tf.test:5000/app",
      admittedUrl: "http://tf.test:5000/app",
      origin: "http://tf.test:5000",
      identity: "TerraFusion",
      reachable: true,
      frameable: true,
      limitations: { dom: "unavailable", console: "unavailable", network: "unavailable" },
    } })
    expect(JSON.stringify(payload)).not.toContain("attacker.test")
  })

  it("refuses unauthenticated inspection before probing the configured runtime", async () => {
    seams.getSession.mockResolvedValueOnce(null)
    const probe = vi.fn(async () => htmlResponse())
    vi.stubGlobal("fetch", probe)
    const { GET } = await import("@/app/api/environment/preview/route")

    const response = await GET(new Request("https://williamos.test/api/environment/preview"))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "UNAUTHENTICATED" })
    expect(probe).not.toHaveBeenCalled()
  })
})
