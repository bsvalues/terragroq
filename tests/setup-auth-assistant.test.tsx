// @vitest-environment jsdom

import React from "react"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AuthSetupAssistant } from "@/components/setup/auth-setup-assistant"
import type { AuthReadiness } from "@/lib/auth-readiness"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock("sonner", () => ({ toast }))

const ready: AuthReadiness = {
  ready: true,
  databaseReady: true,
  authReady: true,
  signup: { mode: "closed", open: false, reason: "Owner provisioning is closed." },
  checkedAt: "2026-08-30T00:00:00.000Z",
  checks: {
    databaseUrl: { ok: true },
    databaseConnectivity: { ok: true },
    authSecret: { ok: true },
    baseUrl: { ok: true },
  },
  emailOtp: {
    enabled: false,
    configured: false,
    provider: "resend",
    providerLabel: "Resend",
    fromConfigured: false,
    replyToConfigured: false,
    reason: "disabled",
  },
  accessGrants: {
    enabled: false,
    configured: false,
    runtimeMode: "disabled",
    issueRoute: "disabled",
    acceptRoute: "disabled",
    persistence: "scaffolded-disabled",
    auditWriter: "scaffolded-disabled",
    limiter: "scaffolded-disabled",
    reason: "disabled",
  },
  issues: [],
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("auth-ready TerraFusion checkout setup", () => {
  it("keeps the target checkout setup visible after authentication is ready", () => {
    render(
      <AuthSetupAssistant
        initialReadiness={ready}
        defaultAuthUrl="http://localhost:3000"
        defaultTerraFusionRoot=""
        initialTerraFusionRootConfigured={false}
        initialProcessStartedAt={100}
      />,
    )

    expect(screen.getByRole("heading", { name: "Authentication is already configured" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Connect the TerraFusion checkout" })).toBeTruthy()
    expect(screen.getByLabelText("TerraFusion checkout")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Save TerraFusion checkout" })).toBeTruthy()
  })

  it("requests the narrow root-only operation without resubmitting auth secrets", async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(Response.json({
      ok: true,
      message: "Saved the TerraFusion checkout.",
      restartRequired: true,
    }))
    render(
      <AuthSetupAssistant
        initialReadiness={ready}
        defaultAuthUrl="http://localhost:3000"
        defaultTerraFusionRoot=""
        initialTerraFusionRootConfigured={false}
        initialProcessStartedAt={100}
      />,
    )

    fireEvent.change(screen.getByLabelText("TerraFusion checkout"), {
      target: { value: "C:\\repos\\terrafusion_os_1.0" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save TerraFusion checkout" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const request = fetchMock.mock.calls[0]
    expect(request[0]).toBe("/api/setup/local-config")
    expect(JSON.parse(String(request[1]?.body))).toEqual({
      operation: "terrafusion-root",
      terraFusionRoot: "C:\\repos\\terrafusion_os_1.0",
    })
    expect(String(request[1]?.body)).not.toContain("databaseUrl")
    expect(String(request[1]?.body)).not.toContain("authSecret")
  })

  it("lets an auth-ready owner replace a configured checkout that moved or became stale", () => {
    render(
      <AuthSetupAssistant
        initialReadiness={ready}
        defaultAuthUrl="http://localhost:3000"
        defaultTerraFusionRoot={"C:\\repos\\terrafusion_os_1.0"}
        initialTerraFusionRootConfigured
        initialProcessStartedAt={100}
      />,
    )

    expect(screen.getByRole("heading", { name: "TerraFusion checkout connected" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Change TerraFusion checkout" }))
    expect(screen.getByRole("heading", { name: "Change the TerraFusion checkout" })).toBeTruthy()
    expect(screen.getByLabelText("TerraFusion checkout")).toHaveProperty(
      "value",
      "C:\\repos\\terrafusion_os_1.0",
    )
    expect(screen.getByRole("button", { name: "Save TerraFusion checkout" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Keep current checkout" })).toBeTruthy()
  })
})
