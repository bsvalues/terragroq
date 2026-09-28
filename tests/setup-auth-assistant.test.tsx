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

  it("shows truthful Core Seven mount state and submits only a catalog repository key plus path", async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(Response.json({
      ok: true,
      message: "Saved the Dossier checkout.",
      restartRequired: true,
    }))
    render(
      <AuthSetupAssistant
        initialReadiness={ready}
        defaultAuthUrl="http://localhost:3000"
        defaultTerraFusionRoot={"C:\\repos\\terrafusion_os_1.0"}
        initialTerraFusionRootConfigured
        initialCoreSevenRepositories={[{
          key: "atlas",
          identity: "bsvalues/terrafusion-atlas",
          label: "Atlas",
          role: "suite-source",
          suite: "atlas",
          previewSource: false,
          defaultRepository: false,
          mount: {
            key: "terrafusion:atlas:configured",
            configured: true,
            verified: true,
            branch: "main",
            revision: "a".repeat(40),
            refusal: null,
          },
        }]}
        initialProcessStartedAt={100}
      />,
    )

    expect(screen.getByRole("heading", { name: "Core Seven repository mounts" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Change Atlas" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Connect Dossier" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Connect Dossier" }))
    fireEvent.change(screen.getByLabelText("Dossier checkout"), {
      target: { value: "C:\\Repositories\\terrafusion-dossier" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save repository mount" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      operation: "terrafusion-repository-root",
      repositoryKey: "dossier",
      repositoryRoot: "C:\\Repositories\\terrafusion-dossier",
    })
    expect(await screen.findByText(
      "Dossier mount saved. Restart WilliamOS before the workspace can use it.",
    )).toBeTruthy()
    expect(screen.getByRole("button", { name: "I restarted — check mounts" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Authentication is already configured" })).toBeTruthy()
  })
})
