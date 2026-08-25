// @vitest-environment jsdom
import { StrictMode } from "react"

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function deferredResponse() {
  let resolve!: (response: { ok: boolean; status: number; json: () => Promise<unknown> }) => void
  const promise = new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("WorkspaceShell addressed arrival under React Strict Mode", () => {
  it("shares in-flight re-entry and summon requests so replay cannot strand the workspace", async () => {
    const reentry = deferredResponse()
    const summon = deferredResponse()
    const fetchStub = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return reentry.promise
      if (url === "/api/environment/line" && init?.method === "POST") return summon.promise
      if (url.startsWith("/api/loom/files")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ entries: [] }) })
      }
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    })
    vi.stubGlobal("fetch", fetchStub)

    render(
      <StrictMode>
        <WorkspaceShell initialSummon="work-orders" />
      </StrictMode>,
    )

    expect(fetchStub.mock.calls.filter(([input]) => String(input) === "/api/environment/space")).toHaveLength(1)
    reentry.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        worldId: "world-strict",
        space: spaceToServer(defaultSpace()),
      }),
    })

    await waitFor(() => {
      expect(fetchStub.mock.calls.filter(([input]) => String(input) === "/api/environment/line")).toHaveLength(1)
    })
    summon.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        worldId: "world-strict",
        say: "The governed work is here.",
        surfaces: [{
          kind: "work-orders",
          subject: "work orders",
          payload: [{
            ref: "WO-STRICT-1",
            title: "Strict Mode summon survives replay",
            status: "in_progress",
            agent: "aegis",
            phase: "validation",
          }],
        }],
      }),
    })

    await waitFor(() => expect(screen.getByText("WO-STRICT-1")).toBeTruthy())
    expect(screen.getAllByText("WO-STRICT-1")).toHaveLength(1)
    expect(screen.getByRole("region", { name: "Source window" })).toBeTruthy()
    expect(screen.queryByText("opening space")).toBeNull()
    expect(screen.queryByText("working…")).toBeNull()
  })
})
