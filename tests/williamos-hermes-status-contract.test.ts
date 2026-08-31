import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { validateHermesStatus } from "@/lib/hermes/status-contract"
import { describeHermesForOwner, readHermesStatus, verifyHermesInference } from "@/lib/hermes/status-source"

const healthyDomain = { state: "HEALTHY", headline: "Current", facts: [{ label: "Proof", value: "Pass" }] }
const fixture = () => ({
  schema: "hermes-console-status/1",
  applianceVersion: "HERMES_APPLIANCE_V1",
  observedAt: "2026-08-31T15:00:00.000Z",
  overallState: "HEALTHY",
  alerts: [],
  ownerActions: [],
  activeWork: { state: "IDLE", headline: "No active repair" },
  domains: Object.fromEntries(
    ["appliance", "inference", "protection", "storage", "security", "doctrine", "workbench"]
      .map((name) => [name, structuredClone(healthyDomain)]),
  ),
})

const tempRoots: string[] = []
afterEach(async () => {
  delete process.env.HERMES_STATUS_PATH
  vi.restoreAllMocks()
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function statusFile(status = fixture()) {
  const root = await mkdtemp(path.join(os.tmpdir(), "williamos-hermes-status-"))
  tempRoots.push(root)
  const file = path.join(root, "current.json")
  await writeFile(file, JSON.stringify(status), "utf8")
  return file
}

describe("WilliamOS HERMES status contract", () => {
  it("accepts an internally consistent fresh packet and preserves its source digest", async () => {
    const file = await statusFile()
    const status = await readHermesStatus({ path: file, now: new Date("2026-08-31T15:01:00Z") })
    expect(status.ownerState).toBe("HEALTHY")
    expect(status.freshness).toEqual({ state: "FRESH", ageSeconds: 60, maxAgeSeconds: 300 })
    expect(status.source.sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it("suppresses a green claim when the same valid packet is stale", async () => {
    const file = await statusFile()
    const status = await readHermesStatus({ path: file, now: new Date("2026-08-31T16:00:00Z") })
    expect(status.overallState).toBe("HEALTHY")
    expect(status.ownerState).toBe("UNKNOWN")
    expect(status.freshness.state).toBe("STALE")
    expect(describeHermesForOwner(status)).toContain("making no green claim")
    expect(describeHermesForOwner(status)).toContain("cannot determine whether owner authority is needed")
  })

  it("rejects false green and an unknown parallel domain", () => {
    const degraded = fixture()
    degraded.domains.security.state = "UNKNOWN"
    expect(() => validateHermesStatus(degraded, { now: new Date("2026-08-31T15:01:00Z") }))
      .toThrow("HERMES_STATUS_OVERALL_STATE_FALSE")

    const duplicate = fixture() as ReturnType<typeof fixture> & { domains: Record<string, typeof healthyDomain> }
    duplicate.domains.secondHealthOracle = structuredClone(healthyDomain)
    expect(() => validateHermesStatus(duplicate, { now: new Date("2026-08-31T15:01:00Z") }))
      .toThrow("HERMES_STATUS_DOMAIN_SET_INVALID")
  })

  it("returns explicit unknown state when the native packet cannot be read", async () => {
    const missingPath = path.join(os.tmpdir(), "does-not-exist-hermes.json")
    const status = await readHermesStatus({ path: missingPath })
    expect(status.ownerState).toBe("UNKNOWN")
    expect(status.source.sha256).toBeNull()
    expect(status.domains.inference.state).toBe("UNKNOWN")
    expect(status.activeWork.headline).not.toContain(missingPath)
    expect(status.freshness.ageSeconds).toBeGreaterThan(status.freshness.maxAgeSeconds)
  })
})

describe("bounded local AI verification", () => {
  it("proves a real expected response and GPU-loaded golden model without changing HERMES", async () => {
    const status = fixture()
    status.domains.inference.facts = [
      { label: "Golden model", value: "williamos-qwen3-4b:64k" },
      { label: "P40", value: "25 C | 150 W cap | TCC" },
      { label: "Owner", value: "WilliamOS-HERMES-Ollama | fresh" },
      { label: "Listener", value: "Loopback-only 127.0.0.1:11434 | pid 31736" },
    ]
    const file = await statusFile(status)
    process.env.HERMES_STATUS_PATH = file
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/api/generate")) return Response.json({ response: "HERMES_READY", model: "williamos-qwen3-4b:64k" })
      if (url.endsWith("/api/ps")) return Response.json({ models: [{ name: "williamos-qwen3-4b:64k", size_vram: 2_000_000_000 }] })
      throw new Error(`unexpected ${url}`)
    }) as typeof fetch

    const receipt = await verifyHermesInference({ fetcher, now: new Date("2026-08-31T15:01:00Z") })
    expect(receipt.result).toBe("PASS")
    expect(receipt.canonicalP40EvidenceFresh).toBe(true)
    expect(receipt.receiptSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("fails closed before generation when P40 evidence is stale", async () => {
    const file = await statusFile()
    process.env.HERMES_STATUS_PATH = file
    const fetcher = vi.fn() as unknown as typeof fetch
    const receipt = await verifyHermesInference({ fetcher, now: new Date("2026-08-31T16:00:00Z") })
    expect(receipt.result).toBe("FAIL")
    expect(receipt.canonicalP40EvidenceFresh).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("fails when Ollama attributes the response to a different model", async () => {
    const status = fixture()
    status.domains.inference.facts = [
      { label: "Golden model", value: "williamos-qwen3-4b:64k" },
      { label: "P40", value: "25 C | 150 W cap | TCC" },
      { label: "Owner", value: "WilliamOS-HERMES-Ollama | fresh" },
      { label: "Listener", value: "Loopback-only 127.0.0.1:11434 | pid 31736" },
    ]
    const file = await statusFile(status)
    process.env.HERMES_STATUS_PATH = file
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/api/generate")) return Response.json({ response: "HERMES_READY", model: "different-model" })
      if (url.endsWith("/api/ps")) return Response.json({ models: [{ name: "williamos-qwen3-4b:64k", size_vram: 2_000_000_000 }] })
      throw new Error(`unexpected ${url}`)
    }) as typeof fetch

    const receipt = await verifyHermesInference({ fetcher, now: new Date("2026-08-31T15:01:00Z") })
    expect(receipt.result).toBe("FAIL")
    expect(receipt.generatedExpectedToken).toBe(false)
    expect(receipt.modelLoadedInGpuMemory).toBe(true)
  })

  it.each([
    ["P40", "present"],
    ["Owner", "not WilliamOS-HERMES-Ollama"],
    ["Listener", "not 127.0.0.1:11434"],
  ])("rejects misleading %s text instead of substring-matching it", async (label, value) => {
    const status = fixture()
    status.domains.inference.facts = [
      { label: "Golden model", value: "williamos-qwen3-4b:64k" },
      { label: "P40", value: "25 C | 150 W cap | TCC" },
      { label: "Owner", value: "WilliamOS-HERMES-Ollama | fresh" },
      { label: "Listener", value: "Loopback-only 127.0.0.1:11434 | pid 31736" },
    ].map((fact) => fact.label === label ? { ...fact, value } : fact)
    const file = await statusFile(status)
    process.env.HERMES_STATUS_PATH = file
    const fetcher = vi.fn() as unknown as typeof fetch
    const receipt = await verifyHermesInference({ fetcher, now: new Date("2026-08-31T15:01:00Z") })
    expect(receipt.result).toBe("FAIL")
    expect(receipt.canonicalP40EvidenceFresh).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(["Golden model", "P40", "Owner", "Listener"])(
    "rejects duplicate %s proof facts even when the first value is valid",
    async (label) => {
      const status = fixture()
      status.domains.inference.facts = [
        { label: "Golden model", value: "williamos-qwen3-4b:64k" },
        { label: "P40", value: "25 C | 150 W cap | TCC" },
        { label: "Owner", value: "WilliamOS-HERMES-Ollama | fresh" },
        { label: "Listener", value: "Loopback-only 127.0.0.1:11434 | pid 31736" },
        { label, value: "contradictory duplicate" },
      ]
      const file = await statusFile(status)
      process.env.HERMES_STATUS_PATH = file
      const fetcher = vi.fn() as unknown as typeof fetch
      const receipt = await verifyHermesInference({ fetcher, now: new Date("2026-08-31T15:01:00Z") })
      expect(receipt.result).toBe("FAIL")
      expect(receipt.canonicalP40EvidenceFresh).toBe(false)
      expect(fetcher).not.toHaveBeenCalled()
    },
  )
})
