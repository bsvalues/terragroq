// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { HermesOperationalSurface } from "@/components/hermes/hermes-operational-surface"
import { defaultSpace, normalizeSpace, spaceToServer } from "@/components/workspace-shell/types"
import { classifyDismissal, classifySummon } from "@/lib/environment/summon"

const domain = { state: "HEALTHY", headline: "Current", facts: [{ label: "Proof", value: "Pass" }] }
const status = {
  schema: "hermes-console-status/1",
  applianceVersion: "HERMES_APPLIANCE_V1",
  observedAt: "2026-08-31T15:00:00.000Z",
  overallState: "DEGRADED",
  ownerState: "DEGRADED",
  freshness: { state: "FRESH", ageSeconds: 30, maxAgeSeconds: 300 },
  alerts: [],
  ownerActions: [],
  activeWork: { state: "IN_PROGRESS", headline: "Finishing HERMES Appliance V1" },
  domains: {
    appliance: structuredClone(domain),
    inference: { state: "HEALTHY", headline: "P40 inference is serving correctly", facts: [{ label: "Golden model", value: "williamos-qwen3-4b:64k" }] },
    protection: { state: "DEGRADED", headline: "Recovery proof needs attention", facts: [{ label: "Generation", value: "20260828_153240" }] },
    storage: structuredClone(domain),
    security: { state: "UNKNOWN", headline: "Exact firewall evidence is unavailable", facts: [{ label: "Evidence", value: "Unavailable" }] },
    doctrine: structuredClone(domain),
    workbench: structuredClone(domain),
  },
  source: { label: "HERMES native status", sha256: "a".repeat(64) },
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("HERMES inside the WilliamOS environment", () => {
  it("opens and closes by ordinary owner language", () => {
    expect(classifySummon("open HERMES")).toBe("hermes")
    expect(classifySummon("how is HERMES")).toBe("hermes")
    expect(classifyDismissal("close HERMES")).toBe("hermes")
    expect(classifySummon("open the HERMES route source")).toBeNull()
  })

  it("round-trips the HERMES surface without persisting stale appliance evidence", () => {
    const base = defaultSpace(1400, 900)
    const geometry = { x: 160, y: 80, width: 760, height: 620, z: 12, minimized: false }
    const persisted = spaceToServer({
      ...base,
      inspectorWindows: { "inspector-hermes": geometry },
      inspectorSeeds: { "inspector-hermes": { kind: "hermes", subject: "HERMES appliance" } },
      activeWindowId: "inspector-hermes",
    })
    const restored = normalizeSpace(persisted, base, { width: 1400, height: 900 })
    expect(restored.inspectorSeeds["inspector-hermes"]).toEqual({
      kind: "hermes",
      subject: "HERMES appliance",
    })
    expect(restored.inspectorWindows["inspector-hermes"]).toEqual(geometry)
    expect(restored.activeWindowId).toBe("inspector-hermes")
  })

  it("answers the owner first and keeps infrastructure detail progressive", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(status)))
    render(<HermesOperationalSurface />)
    expect(await screen.findByText("HERMES is operating with exceptions.")).toBeTruthy()
    expect(screen.getByText("Nothing")).toBeTruthy()
    expect(screen.getByText("P40 inference is serving correctly", { exact: false })).toBeTruthy()
    expect(screen.getByText("Recovery proof needs attention", { exact: false })).toBeTruthy()
    expect(screen.getByText("Exact firewall evidence is unavailable", { exact: false })).toBeTruthy()
    expect(screen.getByText("20260828_153240")).toBeTruthy()
  })

  it("runs the bounded local-AI check and displays its receipt", async () => {
    const receipt = {
      schema: "hermes-inference-verification/1",
      receiptId: "receipt-1",
      observedAt: "2026-08-31T15:01:00.000Z",
      result: "PASS",
      model: "williamos-qwen3-4b:64k",
      generatedExpectedToken: true,
      modelLoadedInGpuMemory: true,
      canonicalP40EvidenceFresh: true,
      sourceStatusSha256: "a".repeat(64),
      receiptSha256: "b".repeat(64),
    }
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "POST"
      ? Response.json({ receipt })
      : Response.json(status))
    vi.stubGlobal("fetch", fetcher)
    render(<HermesOperationalSurface />)
    await screen.findByText("HERMES is operating with exceptions.")
    fireEvent.click(screen.getByRole("button", { name: "Verify local AI" }))
    expect(await screen.findByText("Local AI verification: PASS")).toBeTruthy()
    expect(screen.getByText("receipt-1")).toBeTruthy()
    expect(screen.getByText("Verified")).toBeTruthy()
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/environment/hermes", expect.objectContaining({ method: "POST" })))
  })

  it("removes a PASS receipt when the next status refresh fails", async () => {
    const receipt = {
      schema: "hermes-inference-verification/1", receiptId: "receipt-stale", observedAt: status.observedAt,
      result: "PASS", model: "williamos-qwen3-4b:64k", generatedExpectedToken: true,
      modelLoadedInGpuMemory: true, canonicalP40EvidenceFresh: true,
      sourceStatusSha256: status.source.sha256, receiptSha256: "b".repeat(64),
    }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json(status))
      .mockResolvedValueOnce(Response.json({ receipt }))
      .mockResolvedValueOnce(Response.json({ error: "unavailable" }, { status: 503 }))
    vi.stubGlobal("fetch", fetcher)
    render(<HermesOperationalSurface />)
    await screen.findByText("HERMES is operating with exceptions.")
    fireEvent.click(screen.getByRole("button", { name: "Verify local AI" }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    expect(await screen.findByText("HERMES current state is unknown.")).toBeTruthy()
    expect(screen.queryByText("Local AI verification: PASS")).toBeNull()
  })

  it("removes a PASS receipt when the native evidence digest changes", async () => {
    const receipt = {
      schema: "hermes-inference-verification/1", receiptId: "receipt-old-source", observedAt: status.observedAt,
      result: "PASS", model: "williamos-qwen3-4b:64k", generatedExpectedToken: true,
      modelLoadedInGpuMemory: true, canonicalP40EvidenceFresh: true,
      sourceStatusSha256: status.source.sha256, receiptSha256: "b".repeat(64),
    }
    const changed = { ...status, source: { ...status.source, sha256: "c".repeat(64) } }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json(status))
      .mockResolvedValueOnce(Response.json({ receipt }))
      .mockResolvedValueOnce(Response.json(changed))
    vi.stubGlobal("fetch", fetcher)
    render(<HermesOperationalSurface />)
    await screen.findByText("HERMES is operating with exceptions.")
    fireEvent.click(screen.getByRole("button", { name: "Verify local AI" }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    expect(screen.queryByText("Local AI verification: PASS")).toBeNull()
  })

  it("makes no green claim when the status endpoint is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "unavailable" }, { status: 503 })))
    render(<HermesOperationalSurface />)
    expect(await screen.findByText("HERMES current state is unknown.")).toBeTruthy()
    expect(screen.getByText("Unknown")).toBeTruthy()
    expect(screen.getByRole("alert").textContent).toContain("No green claim")
  })

  it("discards a prior green packet when the next poll cannot refresh it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const healthy = { ...status, overallState: "HEALTHY", ownerState: "HEALTHY", domains: Object.fromEntries(
      Object.entries(status.domains).map(([name, value]) => [name, { ...value, state: "HEALTHY" }]),
    ) }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json(healthy))
      .mockResolvedValue(Response.json({ error: "unavailable" }, { status: 503 }))
    vi.stubGlobal("fetch", fetcher)
    render(<HermesOperationalSurface />)
    expect(await screen.findByText("HERMES is healthy.")).toBeTruthy()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await screen.findByText("HERMES current state is unknown.")).toBeTruthy()
    expect(screen.queryByText("HERMES is healthy.")).toBeNull()
    expect(screen.getByText("Unknown")).toBeTruthy()
  })
})
