// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import path from "node:path"

import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { defaultSpace, normalizeSpace, spaceInViewport, spaceToServer } from "@/components/workspace-shell/types"
import { EMPTY_SPINE } from "@/lib/environment/working-world"

vi.mock("next/dynamic", () => ({
  default: () => function Editor(props: { value: string; onChange: (value: string) => void }) {
    return <textarea aria-label="Source content" value={props.value} onChange={(event) => props.onChange(event.target.value)} />
  },
}))

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 })
})

const judgment = {
  recommendation: "Keep the save path revision-bound.",
  rationale: "The selected file has concurrent writers.",
  basis: [{ key: "selected-path", label: "Selected path", value: "src/workspace-shell.tsx" }],
  confidence: 0.84,
  generatedAt: "2026-08-29T09:00:00.000Z",
  basisFingerprint: "f".repeat(64),
  provenance: { provider: "williamos-inference", model: "local-model" },
}

function selectedFileSpace() {
  const space = defaultSpace(1440, 900, "world-a", "TerraFusion")
  return spaceToServer({
    ...space,
    selectedPath: "src/workspace-shell.tsx",
    editor: {
      openFiles: ["src/workspace-shell.tsx"],
      activePaneId: "primary",
      panes: [{ id: "primary", activePath: "src/workspace-shell.tsx", selection: { anchor: 4, head: 12 } }],
    },
  })
}

function spaceEnvelope() {
  return {
    worldId: "world-a",
    name: "TerraFusion",
    space: selectedFileSpace(),
    spine: EMPTY_SPINE,
    judgment,
    project: { identity: "c:/repos/terrafusion", name: "TerraFusion" },
    storage: "server",
    conversation: [
      { role: "owner", content: "What changed?", at: "2026-08-29T08:58:00.000Z" },
      { role: "williamos", content: "The save path is revision-bound.", at: "2026-08-29T08:58:01.000Z" },
    ],
  }
}

describe("durable William conversation rail", () => {
  it("opens a focused editable override draft for the exact validated judgment and sends it through William", async () => {
    const lineBodies: Array<{ worldId: string; text: string }> = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json(spaceEnvelope())
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { space: unknown }
        return Response.json({ ...spaceEnvelope(), space: body.space })
      }
      if (url === "/api/environment/line" && init?.method === "POST") {
        lineBodies.push(JSON.parse(String(init.body)) as { worldId: string; text: string })
        return Response.json({ worldId: "world-a", say: "I have reconsidered it against your reason.", spine: EMPTY_SPINE })
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))

    render(<WorkspaceShell />)

    const override = await screen.findByRole("button", { name: "Override William judgment" })
    await userEvent.click(override)

    const composer = screen.getByRole("textbox", { name: "Message William" }) as HTMLTextAreaElement
    const draft = "Override William's recommendation:\n> Keep the save path revision-bound.\n\nReason: "
    expect(composer.value).toBe(draft)
    await waitFor(() => expect(document.activeElement).toBe(composer))
    expect(lineBodies).toEqual([])

    await userEvent.type(composer, "A narrower reservation already prevents concurrent writes.")
    await userEvent.click(screen.getByRole("button", { name: "Send to William" }))

    await screen.findByText("I have reconsidered it against your reason.")
    expect(lineBodies).toEqual([{
      worldId: "world-a",
      text: `${draft}A narrower reservation already prevents concurrent writes.`,
    }])
  })

  it("does not offer Override for fallback system facts without a validated judgment", async () => {
    const envelope = { ...spaceEnvelope(), judgment: null }
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json(envelope)
      if (url === "/api/environment/judgment" && init?.method === "POST") {
        return Response.json({ error: "JUDGMENT_UNAVAILABLE" }, { status: 503 })
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))

    render(<WorkspaceShell />)

    await screen.findByText(/System fact:/)
    expect(screen.queryByRole("button", { name: "Override William judgment" })).toBeNull()
  })

  it("does not offer Override for an unvalidated judgment-shaped value", async () => {
    const envelope = { ...spaceEnvelope(), judgment: { ...judgment, basis: [] } }
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json(envelope)
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))

    render(<WorkspaceShell />)

    await screen.findByText("Keep the save path revision-bound.")
    expect(screen.queryByRole("button", { name: "Override William judgment" })).toBeNull()
  })

  it("restores the Space conversation and sends grounded selected-object context through the Line", async () => {
    const lineBodies: Array<{ worldId: string; text: string }> = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json(spaceEnvelope())
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { worldId: string; space: unknown }
        return Response.json({ ...spaceEnvelope(), space: body.space })
      }
      if (url === "/api/environment/line" && init?.method === "POST") {
        lineBodies.push(JSON.parse(String(init.body)) as { worldId: string; text: string })
        return Response.json({ worldId: "world-a", say: "I would keep the narrow revision check.", spine: EMPTY_SPINE })
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))

    render(<WorkspaceShell />)

    const rail = await screen.findByRole("complementary", { name: "William conversation" })
    expect(rail.textContent).toContain("What changed?")
    expect(rail.textContent).toContain("The save path is revision-bound.")

    await userEvent.type(screen.getByRole("textbox", { name: "Message William" }), "Should we keep it narrow?")
    await userEvent.click(screen.getByRole("button", { name: "Send to William" }))

    await screen.findByText("I would keep the narrow revision check.")
    expect(lineBodies).toEqual([{ worldId: "world-a", text: "Should we keep it narrow?" }])
    expect(screen.queryByRole("dialog", { name: "The Line" })).toBeNull()
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    expect(screen.getByRole("dialog", { name: "The Line" })).toBeTruthy()
  })

  it("keeps an edited override draft visible and gives a useful retry state when inference fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json(spaceEnvelope())
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { space: unknown }
        return Response.json({ ...spaceEnvelope(), space: body.space })
      }
      if (url === "/api/environment/line" && init?.method === "POST") {
        return Response.json({ error: "INFERENCE_UNAVAILABLE" }, { status: 503 })
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))

    render(<WorkspaceShell />)
    await userEvent.click(await screen.findByRole("button", { name: "Override William judgment" }))
    const composer = screen.getByRole("textbox", { name: "Message William" }) as HTMLTextAreaElement
    await userEvent.type(composer, "Do not lose this reason")
    const exactDraft = composer.value
    await userEvent.click(screen.getByRole("button", { name: "Send to William" }))

    await screen.findByText((_content, element) => element?.tagName === "P" && element.textContent === exactDraft)
    expect((await screen.findByText(/INFERENCE_UNAVAILABLE.*question is still here/i)).textContent).toContain("INFERENCE_UNAVAILABLE")
    expect((screen.getByRole("textbox", { name: "Message William" }) as HTMLTextAreaElement).value).toBe(exactDraft)
  })

  it("persists the exact selected context first and rejects an inference reply after that context changes", async () => {
    let resolveLine!: (response: Response) => void
    const lineResponse = new Promise<Response>((resolve) => { resolveLine = resolve })
    const order: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json(spaceEnvelope())
      if (url === "/api/environment/space" && init?.method === "PUT") {
        order.push("persist")
        const body = JSON.parse(String(init.body)) as { space: unknown }
        return Response.json({ ...spaceEnvelope(), space: body.space })
      }
      if (url === "/api/environment/line" && init?.method === "POST") {
        order.push("line")
        return lineResponse
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))

    render(<WorkspaceShell />)
    await userEvent.click(await screen.findByRole("button", { name: "Focus Developer preview" }))
    await userEvent.click(screen.getByRole("button", { name: "Focus Source" }))
    await userEvent.type(await screen.findByRole("textbox", { name: "Message William" }), "Hold the selected context")
    await userEvent.click(screen.getByRole("button", { name: "Send to William" }))
    await waitFor(() => expect(order).toContain("line"))
    expect(order.indexOf("persist")).toBeLessThan(order.indexOf("line"))

    await userEvent.click(screen.getByRole("button", { name: "Focus Developer preview" }))
    resolveLine(Response.json({ worldId: "world-a", say: "This answer is stale.", spine: EMPTY_SPINE }))
    await waitFor(() => expect((screen.getByRole("button", { name: "Send to William" }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.queryByText("This answer is stale.")).toBeNull()
    expect((screen.getByRole("textbox", { name: "Message William" }) as HTMLTextAreaElement).value).toBe("Hold the selected context")
  })

  it("keeps the rail available as an accessible drawer on a narrow viewport", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 680 })
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      media: "(max-width: 1040px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })))
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/environment/space" && !init?.method) return Response.json(spaceEnvelope())
      if (url === "/api/environment/space" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { space: unknown }
        return Response.json({ ...spaceEnvelope(), space: body.space })
      }
      if (url.startsWith("/api/loom/files")) return Response.json({ kind: "directory", entries: [] })
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }))

    render(<WorkspaceShell />)
    const trigger = await screen.findByRole("button", { name: "Open William conversation" })
    const closedRail = screen.getByTestId("william-conversation-rail")
    expect(closedRail.getAttribute("aria-hidden")).toBe("true")
    expect(closedRail.hasAttribute("inert")).toBe(true)
    fireEvent.click(trigger)
    const rail = screen.getByRole("complementary", { name: "William conversation" })
    expect(rail.getAttribute("data-open")).toBe("true")
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    expect(screen.getByRole("dialog", { name: "The Line" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Close The Line" }))
    fireEvent.click(screen.getByRole("button", { name: "Close William conversation" }))
    expect(document.activeElement).toBe(trigger)
  })

  it("keeps restored durable and inspector title bars reachable inside the desktop work area", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "components/workspace-shell/experience-spatial.module.css"), "utf8")
    const layer = css.match(/\.windowLayer\s*\{([^}]+)\}/)?.[1] ?? ""
    expect(layer).toMatch(/inset:\s*89px\s+348px\s+0\s+0/)
    const usableDesktopWidth = 1440 - 348
    const preview = defaultSpace(1440, 900).windows["running-app"]
    expect(preview.x + preview.width).toBeLessThanOrEqual(usableDesktopWidth)
    const restored = normalizeSpace({
      windows: [{
        id: "inspector-far", kind: "inspector", title: "Far inspector",
        frame: { x: 1380, y: 30, width: 600, height: 500 }, z: 8, minimized: false,
        surfaceKind: "evidence", surfaceSubject: "far",
      }],
    }, defaultSpace(1440, 900), { width: 1440, height: 900 })
    expect(restored.inspectorWindows["inspector-far"].x).toBeLessThanOrEqual(usableDesktopWidth - 180)
    expect(spaceInViewport(restored, { width: 1440, height: 900 }).inspectorWindows["inspector-far"].x)
      .toBeLessThanOrEqual(usableDesktopWidth - 180)
  })
})
