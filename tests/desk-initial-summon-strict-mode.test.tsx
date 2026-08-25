// @vitest-environment jsdom
import { StrictMode } from "react"

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Desk } from "@/components/desk/desk"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("an addressed summon under React Strict Mode", () => {
  it("keeps the first response readable after effect cleanup and replay", async () => {
    let resolveRequest!: (response: {
      ok: boolean
      json: () => Promise<unknown>
    }) => void
    const request = new Promise<{
      ok: boolean
      json: () => Promise<unknown>
    }>((resolve) => {
      resolveRequest = resolve
    })
    const fetchStub = vi.fn(() => request)
    vi.stubGlobal("fetch", fetchStub)

    render(
      <StrictMode>
        <Desk initialSummon="work-orders" />
      </StrictMode>,
    )

    // React has now performed the development cleanup/replay. The addressed arrival remains one
    // request; its result still has to belong to the mounted replay rather than the cleaned-up pass.
    expect(fetchStub).toHaveBeenCalledTimes(1)
    resolveRequest({
      ok: true,
      json: async () => ({
        worldId: "world-strict",
        say: "The governed work is here.",
        surfaces: [
          {
            kind: "work-orders",
            subject: "work orders",
            payload: [
              {
                ref: "WO-STRICT-1",
                title: "Strict Mode summon survives replay",
                status: "in_progress",
                agent: "aegis",
                phase: "validation",
              },
            ],
          },
        ],
      }),
    })

    await waitFor(() => expect(screen.getByText("WO-STRICT-1")).toBeTruthy())
    expect(screen.getAllByText("WO-STRICT-1")).toHaveLength(1)
    expect(screen.getAllByText("The governed work is here.")).toHaveLength(1)
    expect(screen.queryByText("What are we working on?")).toBeNull()
  })
})
