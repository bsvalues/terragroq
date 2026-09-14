// @vitest-environment jsdom
// Pins the two owner-run board defects found in the v2 head review:
// 1) the run control must send parcels AT the capability's measured threshold (else
//    gpu-aggregation, whose GPU threshold is 100k rows, can never reach the GPU path);
// 2) the seam returns evidenceRef as {evidenceId, ref, receipt} — the board must render
//    the persisted EV-GPU-... ref, never "[object Object]".
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CapabilityBoard } from "@/components/fabric/capability-board"

const inventory = {
  source: "computed",
  ownerRun: { minRows: 50_000, maxRows: 250_000 },
  capabilities: [
    {
      capabilityId: "gpu-aggregation",
      label: "GPU aggregation",
      status: "PROVEN",
      executionClass: "gpu",
      runtimeReality: "reviewed binding",
      claim: "measured",
      reasonCode: "GPU_ELIGIBLE_ABOVE_MEASURED_THRESHOLD",
      dispatch: { allowed: true, reasonCode: "allowed" },
      evidenceState: { state: "VALID", finishedAt: null, digest: "a".repeat(64) },
      thresholdRows: 100_000,
      thresholdIsAtMeasurementFloor: false,
      binding: { nodeId: "daedalus", device: "cuda", observed: null, matchesReview: true, healthy: true, queriedAt: "2026-09-14T00:00:00Z", detail: "ok" },
      placementProbe: { workload: "aggregation", rows: 100_000, placement: "CUDA_DEVICE", reasonCode: "GPU_ELIGIBLE_ABOVE_MEASURED_THRESHOLD" },
      restrictions: [],
      evidenceRefs: [],
      ownerRunnable: true,
    },
    {
      capabilityId: "gpu-tabular-ml",
      label: "GPU tabular ML",
      status: "PROVEN",
      executionClass: "gpu",
      runtimeReality: "reviewed binding",
      claim: "measured",
      reasonCode: "GPU_ELIGIBLE_ABOVE_MEASURED_THRESHOLD",
      dispatch: { allowed: true, reasonCode: "allowed" },
      evidenceState: { state: "VALID", finishedAt: null, digest: "b".repeat(64) },
      thresholdRows: 50_000,
      thresholdIsAtMeasurementFloor: true,
      binding: { nodeId: "daedalus", device: "cuda", observed: null, matchesReview: true, healthy: true, queriedAt: "2026-09-14T00:00:00Z", detail: "ok" },
      placementProbe: { workload: "regression", rows: 50_000, placement: "CUDA_DEVICE", reasonCode: "GPU_ELIGIBLE_ABOVE_MEASURED_THRESHOLD" },
      restrictions: [],
      evidenceRefs: [],
      ownerRunnable: true,
    },
  ],
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("capability board owner-run controls", () => {
  it("sends parcels equal to the capability's measured GPU threshold (aggregation keeps its GPU path)", async () => {
    const seen: string[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      seen.push(String(url) + " " + String(init?.method ?? "GET"))
      if (String(url).endsWith("/api/environment/capability") && init?.method === "POST") {
        return jsonResponse({ status: "SUCCEEDED", outcome: "SUCCEEDED", dispatchId: "d",
          evidenceRef: { evidenceId: 7, ref: "EV-GPU-abc", receipt: {} } })
      }
      return jsonResponse(inventory)
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<CapabilityBoard />)
    await screen.findByText("GPU aggregation")
    const runs = screen.getAllByRole("button", { name: /Run once/i })
    fireEvent.click(runs[0]) // gpu-aggregation is the first capability

    await waitFor(() => {
      const post = seen.find((s) => s.includes("/api/environment/capability") && s.includes("POST"))
      expect(post, "a POST must have been issued").toBeTruthy()
    })
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")
    expect(postCall).toBeTruthy()
    const body = JSON.parse(String((postCall![1] as RequestInit).body))
    expect(body.capabilityId).toBe("gpu-aggregation")
    // The whole point of the fix: 100k threshold rows, not the 50k floor — otherwise
    // the adapter routes aggregation to CPU forever (CPU_BELOW_MEASURED_THRESHOLD).
    expect(body.parcels).toBe(100_000)
  })

  it("renders the persisted EV-GPU-... ref when the seam returns the evidence object", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/environment/capability") && init?.method === "POST") {
        return jsonResponse({ status: "SUCCEEDED", outcome: "SUCCEEDED", dispatchId: "d",
          evidenceRef: { evidenceId: 9, ref: "EV-GPU-deadbeef123", receipt: { schemaVersion: "williamos-gpu-tabular-dispatch-receipt/1" } } })
      }
      return jsonResponse(inventory)
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<CapabilityBoard />)
    await screen.findByText("GPU aggregation")
    const runs = screen.getAllByRole("button", { name: /Run once/i })
    fireEvent.click(runs[0])

    await waitFor(() => {
      // The persisted ref must appear as text, never "[object Object]".
      expect(document.body.textContent).toContain("EV-GPU-deadbeef123")
    })
    expect(document.body.textContent).not.toContain("[object Object]")
  })
})