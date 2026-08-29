import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({
  getSession: vi.fn(),
  retire: vi.fn(),
}))

vi.mock("@/lib/session", () => ({ getSession: seams.getSession }))
vi.mock("@/lib/environment/ceremonial-context-retirement", () => ({
  retireCeremonialContexts: seams.retire,
  CeremonialContextRetirementError: class CeremonialContextRetirementError extends Error {
    name = "CeremonialContextRetirementError"
    constructor(public code: string) { super(code) }
  },
}))

import { POST } from "@/app/api/internal/experience-v2/retire-ceremonial-context/route"
import { CeremonialContextRetirementError } from "@/lib/environment/ceremonial-context-retirement"

const OWNER = "YCAbP6TPTU1sxkpf4gVl5FcX9Nf4lrwZ"

function request(body = "", headers: Record<string, string> = {}) {
  return new Request("http://127.0.0.1:3000/api/internal/experience-v2/retire-ceremonial-context", {
    method: "POST",
    headers: { "content-type": "application/json", host: "127.0.0.1:3000", ...headers },
    body,
  })
}

describe("internal ceremonial context retirement route", () => {
  beforeEach(() => {
    seams.getSession.mockReset().mockResolvedValue({
      user: { id: OWNER, email: "bsvalues@gmail.com" },
    })
    seams.retire.mockReset().mockResolvedValue({
      status: "RETIRED",
      operationId: "WILLIAMOS_RETIRE_CEREMONIAL_CONTEXT_20260829",
      grantIds: [13, 14], workOrderIds: [17, 18],
    })
  })

  it("is parameterless and rejects client-selected ids, reasons, or paths", async () => {
    for (const body of [
      { grantIds: [13, 14] },
      { workOrderIds: [17, 18] },
      { reason: "client choice" },
      { paths: ["app/**"] },
    ]) {
      const response = await POST(request(JSON.stringify(body)))
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: "REQUEST_FIELDS_INVALID" })
    }
    expect(seams.retire).not.toHaveBeenCalled()
  })

  it("executes only for the exact authenticated primary owner", async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(seams.retire).toHaveBeenCalledWith({ userId: OWNER })

    seams.getSession.mockResolvedValue({ user: { id: OWNER, email: "other@example.test" } })
    const nonPrimaryEmail = await POST(request())
    expect(nonPrimaryEmail.status).toBe(403)

    seams.getSession.mockResolvedValue({ user: { id: "other", email: "bsvalues@gmail.com" } })
    const nonOwnerId = await POST(request())
    expect(nonOwnerId.status).toBe(403)
  })

  it("rejects unauthenticated and cross-origin calls before invoking cleanup", async () => {
    seams.getSession.mockResolvedValue(null)
    expect((await POST(request())).status).toBe(401)
    expect(seams.retire).not.toHaveBeenCalled()

    seams.getSession.mockResolvedValue({ user: { id: OWNER, email: "bsvalues@gmail.com" } })
    expect((await POST(request("", { origin: "https://evil.example" }))).status).toBe(403)
    expect(seams.retire).not.toHaveBeenCalled()
  })

  it("maps typed drift and audit failures without exposing internal storage details", async () => {
    for (const [code, status] of [
      ["TARGET_MISSING", 409],
      ["TARGET_FOREIGN", 403],
      ["TARGET_DRIFTED", 409],
      ["TARGET_MIXED", 409],
      ["AUDIT_INCOMPLETE", 409],
      ["CONCURRENT_CHANGE", 409],
    ] as const) {
      seams.retire.mockRejectedValueOnce(new CeremonialContextRetirementError(code))
      const response = await POST(request())
      expect(response.status).toBe(status)
      expect(await response.json()).toEqual({ error: code })
    }
  })

  it("returns a generic unavailable result for unexpected storage failure", async () => {
    seams.retire.mockRejectedValue(new Error("database password should not leak"))
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "CEREMONIAL_CONTEXT_RETIREMENT_UNAVAILABLE" })
  })
})
