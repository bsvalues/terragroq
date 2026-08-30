// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"
import { EMPTY_SPINE } from "@/lib/environment/working-world"

vi.mock("next/dynamic", () => ({
  default: () => function Editor() { return <textarea aria-label="Source content" readOnly /> },
}))

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("Experience V2 selected Space actions", () => {
  it("opens dedicated Summarize in the transient Line and requests only the server-grounded Space context", async () => {
    const serverSpace = spaceToServer({
      ...defaultSpace(1440, 900, "world-a", "TerraFusion"),
      activeWindowId: null,
    })
    const requests: Record<string, unknown>[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json({
        worldId: "world-a", name: "TerraFusion", space: serverSpace,
        project: { identity: "c:/repos/terrafusion", name: "TerraFusion" }, storage: "server", spine: EMPTY_SPINE,
      })
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body))
        return Response.json({ worldId: body.worldId, space: body.space, updatedAt: "2026-08-30T05:00:00.000Z" })
      }
      if (url === "/api/environment/line") {
        requests.push(JSON.parse(String(init?.body)))
        return Response.json({ worldId: "world-a", say: "Grounded summary", surfaces: [], spine: EMPTY_SPINE })
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      return Response.json({ error: "UNAVAILABLE" }, { status: 503 })
    }))
    render(<WorkspaceShell />)

    fireEvent.click(await screen.findByRole("button", { name: "Summarize" }))
    const line = screen.getByRole("dialog", { name: "The Line" })
    const input = within(line).getByRole("textbox", { name: "The Line" }) as HTMLInputElement
    expect(input.value).toBe("Summarize this exact current Space: ")
    fireEvent.change(input, { target: { value: "Summarize this exact current Space." } })
    fireEvent.click(within(line).getByRole("button", { name: "Send" }))

    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toEqual({
      worldId: "world-a",
      text: "Summarize this exact current Space.",
      lineContext: "space-summary",
    })
    expect(screen.getByText("Grounded summary")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Close The Line" }))
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    const genericLine = screen.getByRole("dialog", { name: "The Line" })
    const genericInput = within(genericLine).getByRole("textbox", { name: "The Line" })
    fireEvent.change(genericInput, { target: { value: "A separate ordinary question." } })
    fireEvent.click(within(genericLine).getByRole("button", { name: "Send" }))
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1]).toEqual({ worldId: "world-a", text: "A separate ordinary question." })
  })
})
