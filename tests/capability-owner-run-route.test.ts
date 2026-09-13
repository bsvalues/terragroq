import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The owner-run POST gate, tested where the estate's doctrine says it must fail CLOSED:
 * every refusal happens before any seam call, and the seam receives ONLY the bounded
 * server-derived vocabulary (never a browser-authored workload, dataset, command, or path).
 */
const seams = vi.hoisted(() => ({
  getSession: vi.fn(),
  owner: vi.fn(),
  admit: vi.fn(),
  dispatch: vi.fn(),
  settle: vi.fn(),
}))

vi.mock("@/lib/session", () => ({ getSession: seams.getSession }))
vi.mock("@/lib/governance/owner", () => ({
  resolveOwnerUserId: seams.owner,
  assertOwner: (id: string, owner: string | null) =>
    id === owner ? { ok: true } : { ok: false, failure: "NOT_OWNER", detail: "only the owner" },
}))
vi.mock("@/lib/governance/owner-lookup", () => ({ ownerLookup: () => ({}) }))
vi.mock("@/lib/environment/owner-run-dispatch", async () => {
  const surface = await import("@/lib/environment/capability-inventory-surface")
  return {
    OWNER_RUN_MAX_ROWS: 250_000,
    OWNER_RUN_MIN_ROWS: 50_000,
    admitOwnerRunWorkOrder: seams.admit,
    ownerRunWorkloadFor: (id: string) =>
      Object.prototype.hasOwnProperty.call(surface.OWNER_RUNNABLE_COMPUTE, id)
        ? surface.OWNER_RUNNABLE_COMPUTE[id]
        : null,
    ownerRunSeed: () => 4242,
    runOwnerDispatch: seams.dispatch,
    settleOwnerRunGrant: seams.settle,
  }
})

import { POST } from "@/app/api/environment/capability/route"

function jsonRequest(body: unknown) {
  return new Request("https://hermes.local:3443/api/environment/capability", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("capability owner-run POST", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    seams.getSession.mockResolvedValue({ user: { id: "owner-1" } })
    seams.owner.mockResolvedValue("owner-1")
    seams.admit.mockResolvedValue({ ok: true, woId: 7, woRef: "WO-1" })
    seams.dispatch.mockResolvedValue({ status: "SUCCEEDED", outcome: "EXECUTED", placement: "CUDA_DEVICE" })
    seams.settle.mockResolvedValue({ ok: true })
  })

  it("refuses the unauthenticated and the non-owner before touching the seam", async () => {
    seams.getSession.mockResolvedValue(null)
    expect((await POST(jsonRequest({ capabilityId: "gpu-tabular-ml" }))).status).toBe(401)
    seams.getSession.mockResolvedValue({ user: { id: "intruder" } })
    const refused = await POST(jsonRequest({ capabilityId: "gpu-tabular-ml" }))
    expect(refused.status).toBe(403)
    expect(await refused.json()).toMatchObject({ error: "NOT_OWNER" })
    expect(seams.dispatch).not.toHaveBeenCalled()
    expect(seams.admit).not.toHaveBeenCalled()
  })

  it("refuses a non-runnable or unknown capability by name (screening and rejected paths)", async () => {
    for (const capabilityId of ["gpu-anomaly-screening", "gpu-dimensional-reduction", "kernel-client", ""]) {
      const response = await POST(jsonRequest({ capabilityId }))
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: "CAPABILITY_NOT_OWNER_RUNNABLE" })
    }
    expect(seams.admit).not.toHaveBeenCalled()
    expect(seams.dispatch).not.toHaveBeenCalled()
  })

  it("refuses out-of-bound row counts; the seam never sees them", async () => {
    // Every arm asserts, including the non-integer and string arms: an earlier version skipped
    // the status assertion for 1.5 and "60000" and leaned on the trailing dispatch check, which
    // is how a defaulting regression could have hidden inside this test.
    for (const parcels of [49_999, 250_001, -5, 1.5, "60000", null]) {
      const response = await POST(jsonRequest({ capabilityId: "gpu-tabular-ml", parcels }))
      expect(response.status, `parcels=${JSON.stringify(parcels)} must be refused`).toBe(400)
      expect(await response.json()).toMatchObject({ error: "PARCELS_OUT_OF_BOUNDS" })
    }
    expect(seams.admit).not.toHaveBeenCalled()
    expect(seams.dispatch).not.toHaveBeenCalled()
  })

  it("dispatches ONLY the server-derived vocabulary: workload and seed are not browser-settable", async () => {
    const response = await POST(jsonRequest({
      capabilityId: "gpu-clustering",
      parcels: 60_000,
      // forged fields the route must ignore entirely:
      workload: "drop-tables", command: "rm -rf /", dataset: "pacs_valuation", devicePolicy: "force-cpu",
    }))
    expect(response.status).toBe(200)
    expect(seams.dispatch).toHaveBeenCalledTimes(1)
    const submission = seams.dispatch.mock.calls[0][0]
    expect(submission).toEqual({
      workOrderRef: "WO-1",
      workload: "clustering",
      synthetic: { parcels: 60_000, seed: 4242 },
      devicePolicy: "auto",
    })
    const body = await response.json()
    expect(body).toMatchObject({ status: "SUCCEEDED", workOrderRef: "WO-1", syntheticDataOnly: true })
    expect(body.authorization.settled).toBe(true)
  })

  it("defaults parcels to the measurement-floor scale (50k) when absent", async () => {
    await POST(jsonRequest({ capabilityId: "gpu-tabular-ml" }))
    expect(seams.dispatch.mock.calls[0][0].synthetic.parcels).toBe(50_000)
  })

  it("settles the grant on every path, and reports a settle failure instead of swallowing it", async () => {
    seams.dispatch.mockResolvedValue({ status: "REFUSED", outcome: "SCREENING_ONLY_NOT_AUTHORITATIVE" })
    const refused = await POST(jsonRequest({ capabilityId: "gpu-aggregation", parcels: 60_000 }))
    expect(refused.status).toBe(200)
    expect(await refused.json()).toMatchObject({ status: "REFUSED" })
    expect(seams.settle).toHaveBeenCalledTimes(1)

    seams.settle.mockResolvedValue({ ok: false, error: "OWNER_RUN_WO_SETTLE_REFUSED", detail: "no edge" })
    const sticky = await POST(jsonRequest({ capabilityId: "gpu-tabular-ml", parcels: 60_000 }))
    expect((await sticky.json()).authorization).toMatchObject({ settled: false, settleError: "OWNER_RUN_WO_SETTLE_REFUSED" })
  })

  it("a throwing seam still settles the grant and answers as a typed transport error", async () => {
    seams.dispatch.mockRejectedValue(new Error("ssh channel lost"))
    const response = await POST(jsonRequest({ capabilityId: "gpu-tabular-ml", parcels: 60_000 }))
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: "DISPATCH_TRANSPORT_ERROR", detail: "ssh channel lost" })
    expect(seams.settle).toHaveBeenCalledTimes(1)
  })

  it("admission refusals stop before any dispatch", async () => {
    seams.admit.mockResolvedValue({ ok: false, error: "OWNER_RUN_WO_APPROVE_REFUSED", detail: "A2 requires explicit approval" })
    const response = await POST(jsonRequest({ capabilityId: "gpu-tabular-ml", parcels: 60_000 }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: "OWNER_RUN_WO_APPROVE_REFUSED" })
    expect(seams.dispatch).not.toHaveBeenCalled()
  })

  it("malformed JSON bodies are refused without reaching any seam", async () => {
    const response = await POST(new Request("https://x/api/environment/capability", { method: "POST", body: "{" }))
    expect(response.status).toBe(400)
    expect(seams.dispatch).not.toHaveBeenCalled()
  })
})
