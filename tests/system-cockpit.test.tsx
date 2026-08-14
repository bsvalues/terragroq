// @vitest-environment jsdom

import React from "react"
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import SystemPage from "@/app/(shell)/system/page"

const dependencies = vi.hoisted(() => ({
  getAuthReadiness: vi.fn(),
  getOperatorState: vi.fn(),
  buildRuntimeStatus: vi.fn(),
}))

vi.mock("@/lib/auth-readiness", () => ({ getAuthReadiness: dependencies.getAuthReadiness }))
vi.mock("@/lib/operator/operator-state", () => ({ getOperatorState: dependencies.getOperatorState }))
vi.mock("@/lib/ai/runtime", () => ({ buildRuntimeStatus: dependencies.buildRuntimeStatus }))

const readiness = {
  ready: true,
  databaseReady: true,
  authReady: true,
  signup: {},
  checkedAt: "2026-08-14T10:10:00.000Z",
  checks: {
    databaseUrl: { ok: true },
    databaseConnectivity: { ok: true, latencyMs: 9 },
    authSecret: { ok: true },
    baseUrl: { ok: true },
  },
  emailOtp: {},
  accessGrants: {},
  issues: [],
}

const runtime = {
  chatModel: "configured-model",
  embeddingModel: "configured-embedding",
  embeddingDimensions: 1024,
  gateway: "configured-gateway",
  provider: "configured-provider",
  fallback: false,
  fallbackPolicy: "explicit only",
  source: "lib/ai/config.ts",
  ts: "2026-08-14T10:10:00.000Z",
}

describe("System cockpit rendered truth contract", () => {
  beforeEach(() => {
    dependencies.getAuthReadiness.mockReset()
    dependencies.getOperatorState.mockReset()
    dependencies.buildRuntimeStatus.mockReset()
    dependencies.getAuthReadiness.mockResolvedValue(readiness)
    dependencies.buildRuntimeStatus.mockReturnValue(runtime)
    dependencies.getOperatorState.mockResolvedValue({
      now: { truthState: "idle-empty", value: { activeExecutions: 0, queueDepth: 0 } },
      knowledge: { value: { evidence: 75, governance: 711, memory: 0, documents: 0 } },
    })
  })

  afterEach(cleanup)

  it("renders ATLAS from a current probe while configuration remains explicitly non-live", async () => {
    render(await SystemPage())

    expect(dependencies.getAuthReadiness).toHaveBeenCalledWith({ probeDatabase: true })
    expect(screen.getByRole("heading", { name: "System" })).toBeTruthy()
    expect(screen.getByText(/System does not start, stop, repair, deploy, or grant authority to any runtime/)).toBeTruthy()

    const atlas = screen.getByRole("heading", { name: "ATLAS" }).closest("li")
    if (!atlas) throw new Error("ATLAS signal row was not rendered")
    expect(within(atlas).getByText(/^live$/i)).toBeTruthy()
    expect(within(atlas).getByText("2026-08-14T10:10:00.000Z")).toBeTruthy()
    expect(atlas.textContent).toContain("getAuthReadiness database connectivity probe")

    for (const system of ["HERMES", "AEGIS"]) {
      const signal = screen.getByRole("heading", { name: system }).closest("li")
      if (!signal) throw new Error(`${system} signal row was not rendered`)
      expect(within(signal).getByText(/^inferred$/i)).toBeTruthy()
      expect(within(signal).getByText("No live observation")).toBeTruthy()
      expect(signal.textContent).toContain("Configuration describes role, not current liveness")
    }

    expect(screen.getByText("Configuration (not a liveness probe)")).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Configured runtime" })).toBeTruthy()
    expect(document.body.textContent).not.toContain("Active runtime")
    expect(document.body.textContent).not.toContain("gateway online")
  })

  it("keeps System truth visible when the supporting operator projection fails", async () => {
    dependencies.getOperatorState.mockRejectedValue(new Error("ATLAS supporting read failed"))

    render(await SystemPage())

    expect(screen.getByText("Current state-database query succeeded.")).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Unavailable" })).toBeTruthy()
    expect(screen.getByText(/Operator load is unavailable because the state read-model query did not succeed/)).toBeTruthy()
    expect(screen.getByText("System is read-only. Configuration and persisted history never become live status.")).toBeTruthy()
  })

  it("renders ATLAS unknown when the current database probe does not succeed", async () => {
    dependencies.getAuthReadiness.mockResolvedValue({
      ...readiness,
      ready: false,
      databaseReady: false,
      checks: {
        ...readiness.checks,
        databaseConnectivity: { ok: false },
      },
    })
    dependencies.getOperatorState.mockRejectedValue(new Error("ATLAS unavailable"))

    render(await SystemPage())

    const atlas = screen.getByRole("heading", { name: "ATLAS" }).closest("li")
    if (!atlas) throw new Error("ATLAS signal row was not rendered")
    expect(atlas.textContent).toContain("unknown")
    expect(atlas.textContent).toContain("No live observation")
    expect(atlas.textContent).toContain("Current state-database query did not succeed")
    expect(screen.getByText("System is read-only. Configuration and persisted history never become live status.")).toBeTruthy()
  })
})
